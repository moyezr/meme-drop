import type { SuggestionPerformanceSnapshot } from "./suggestion-performance";

type Platform = "x" | "linkedin";
type RequestOutcome = "usable" | "empty" | "failed" | "timeout" | "cancelled";
interface SampleBase {
  event_id: string;
  platform: Platform;
  extension_version: string;
  elapsed_ms: number;
}
export interface RequestPerformanceSample extends SampleBase {
  kind: "request";
  outcome: RequestOutcome;
  suggestion_count: number;
  first_usable_preview_ms?: number;
  api_response_ms?: number;
  cache_status: "hit" | "miss" | "unknown";
  generation_mode: "model" | "fallback" | "unknown";
}
export interface AttachmentPerformanceSample extends SampleBase {
  kind: "attachment";
  outcome: "inserted" | "copied" | "attachment_failed" | "cancelled";
  selected_preparation_ms?: number;
  native_attachment_confirmation_ms?: number;
}
export type PerformanceSample = RequestPerformanceSample | AttachmentPerformanceSample;

const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VERSION = /^(0|[1-9]\d{0,3})(\.(0|[1-9]\d{0,3})){2,3}$/;
const duration = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 120_000;
const oneOf = <T extends string>(value: unknown, values: readonly T[]): value is T =>
  typeof value === "string" && values.includes(value as T);

/** Project runtime messages onto the complete content-free collection allowlist. */
export function projectPerformanceSample(value: unknown, version?: string): PerformanceSample | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const extensionVersion = version ?? input.extension_version;
  if (typeof input.event_id !== "string" || !UUID4.test(input.event_id) ||
      !oneOf(input.platform, ["x", "linkedin"]) ||
      typeof extensionVersion !== "string" || !VERSION.test(extensionVersion) ||
      !duration(input.elapsed_ms)) return null;
  const base: SampleBase = {
    event_id: input.event_id, platform: input.platform,
    extension_version: extensionVersion, elapsed_ms: input.elapsed_ms,
  };
  if (input.kind === "request") {
    if (!oneOf(input.outcome, ["usable", "empty", "failed", "timeout", "cancelled"]) ||
        typeof input.suggestion_count !== "number" || !Number.isInteger(input.suggestion_count) ||
        input.suggestion_count < 0 || input.suggestion_count > 5 ||
        !oneOf(input.cache_status, ["hit", "miss", "unknown"]) ||
        !oneOf(input.generation_mode, ["model", "fallback", "unknown"])) return null;
    if (input.api_response_ms !== undefined &&
        (!duration(input.api_response_ms) || input.api_response_ms > base.elapsed_ms)) return null;
    if (input.first_usable_preview_ms !== undefined &&
        (!duration(input.first_usable_preview_ms) || input.first_usable_preview_ms > base.elapsed_ms)) return null;
    if (input.outcome === "usable" && (!duration(input.first_usable_preview_ms) || input.suggestion_count === 0)) return null;
    if (input.outcome !== "usable" && input.first_usable_preview_ms !== undefined) return null;
    if (input.outcome === "empty" && input.suggestion_count !== 0) return null;
    return { ...base, kind: "request", outcome: input.outcome, suggestion_count: input.suggestion_count,
      cache_status: input.cache_status, generation_mode: input.generation_mode,
      ...(duration(input.api_response_ms) ? { api_response_ms: input.api_response_ms } : {}),
      ...(duration(input.first_usable_preview_ms) ? { first_usable_preview_ms: input.first_usable_preview_ms } : {}),
    };
  }
  if (input.kind !== "attachment" ||
      !oneOf(input.outcome, ["inserted", "copied", "attachment_failed", "cancelled"])) return null;
  for (const key of ["selected_preparation_ms", "native_attachment_confirmation_ms"] as const) {
    if (input[key] !== undefined && (!duration(input[key]) || input[key] > base.elapsed_ms)) return null;
  }
  if (input.outcome === "inserted" && !duration(input.native_attachment_confirmation_ms)) return null;
  if (input.outcome !== "inserted" && input.native_attachment_confirmation_ms !== undefined) return null;
  return { ...base, kind: "attachment", outcome: input.outcome,
    ...(duration(input.selected_preparation_ms) ? { selected_preparation_ms: input.selected_preparation_ms } : {}),
    ...(duration(input.native_attachment_confirmation_ms) ? { native_attachment_confirmation_ms: input.native_attachment_confirmation_ms } : {}),
  };
}

/** One terminal sample per explicit request, independent of per-card feedback. */
export class SuggestionBaselineTracker {
  private readonly eventId = crypto.randomUUID();
  private transport: Partial<RequestPerformanceSample> = {};
  private terminal: SuggestionPerformanceSnapshot | null = null;
  private terminalElapsed = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private sent = false;
  private failure: "failed" | "timeout" = "failed";

  constructor(
    private readonly metadata: { platform: Platform; extension_version: string },
    private readonly startedAt: number,
    private readonly send: (sample: PerformanceSample) => void,
    private readonly now = () => performance.now(),
  ) {}

  updateTransport(snapshot: SuggestionPerformanceSnapshot): void {
    if (this.sent) return;
    if (this.terminal && duration(snapshot.api_response_ms) &&
        snapshot.api_response_ms > this.terminalElapsed) return;
    if (duration(snapshot.api_response_ms)) this.transport.api_response_ms = snapshot.api_response_ms;
    this.transport.cache_status = snapshot.cache_hit === true || snapshot.server_cache_hit === true ? "hit"
      : snapshot.server_cache_hit === false ? "miss" : "unknown";
    this.transport.generation_mode = snapshot.generation_mode ?? "unknown";
  }

  setFailure(outcome: "failed" | "timeout"): void { this.failure = outcome; }

  observe(snapshot: SuggestionPerformanceSnapshot): void {
    if (this.sent || this.terminal || !snapshot.preview_state || snapshot.preview_state === "pending") return;
    this.terminal = { ...snapshot };
    this.terminalElapsed = snapshot.first_usable_preview_ms ?? this.now() - this.startedAt;
    // Let the worker's following metadata message arrive without delaying UI.
    this.timer = setTimeout(() => this.flush(), 50);
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.sent || !this.terminal) return;
    this.sent = true;
    const snapshot = this.terminal;
    const outcome = snapshot.preview_state === "failed" ? this.failure : snapshot.preview_state;
    const elapsed = this.terminalElapsed;
    const sample = projectPerformanceSample({ ...this.metadata, ...this.transport,
      event_id: this.eventId, kind: "request", outcome, elapsed_ms: Math.round(elapsed * 10) / 10,
      suggestion_count: snapshot.suggestion_count,
      cache_status: this.transport.cache_status ?? "unknown",
      generation_mode: this.transport.generation_mode ?? "unknown",
      ...(snapshot.first_usable_preview_ms === undefined ? {} : { first_usable_preview_ms: snapshot.first_usable_preview_ms }),
    });
    if (sample) {
      try { this.send(sample); }
      catch { /* An invalidated extension context must not affect the reply UI. */ }
    }
  }
}
