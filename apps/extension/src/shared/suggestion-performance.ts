/**
 * Small, local-only timings for the suggestion path. They are deliberately
 * counts and durations only: post text, captions, URLs, and template ids are
 * never part of a diagnostic snapshot.
 */
export interface SuggestionPerformanceSnapshot {
  suggestion_count: number;
  cache_hit?: boolean;
  api_response_ms?: number;
  first_preview_bytes_ms?: number;
  all_preview_bytes_ms?: number;
  all_original_bytes_ms?: number;
  media_settled_ms?: number;
  media_failure_count: number;
  first_usable_preview_ms?: number;
  all_usable_previews_ms?: number;
  preview_render_failure_count: number;
  preview_state?: "pending" | "usable" | "empty" | "failed" | "cancelled";
  server_timing?: Record<string, number>;
}

export type Clock = () => number;

export function parseServerTimingHeader(header: string | null): Record<string, number> | undefined {
  if (!header?.trim()) return undefined;

  const timings: Record<string, number> = {};
  for (const entry of header.split(",")) {
    const [rawName, ...parameters] = entry.trim().split(";");
    const name = rawName?.trim();
    if (!name) continue;
    const duration = parameters.find((parameter) => /^dur\s*=/i.test(parameter.trim()));
    if (!duration) continue;
    const parsed = Number(duration.split("=").slice(1).join("=").trim().replace(/^"|"$/g, ""));
    if (Number.isFinite(parsed) && parsed >= 0) timings[name] = parsed;
  }

  return Object.keys(timings).length > 0 ? timings : undefined;
}

export class SuggestionPerformanceTracker {
  private readonly startedAt: number;
  private suggestionCount = 0;
  private cacheHit: boolean | undefined;
  private apiResponseMs: number | undefined;
  private firstPreviewReadyMs: number | undefined;
  private allPreviewsReadyMs: number | undefined;
  private readyToAttachMs: number | undefined;
  private mediaSettledMs: number | undefined;
  private mediaFailureCount = 0;
  private serverTiming: Record<string, number> | undefined;
  private previewState: SuggestionPerformanceSnapshot["preview_state"];
  private firstUsablePreviewMs: number | undefined;
  private allUsablePreviewsMs: number | undefined;
  private previewRenderFailureCount = 0;
  private readonly usablePreviewIds = new Set<string>();
  private readonly previewIds = new Set<string>();
  private readonly originalIds = new Set<string>();

  constructor(private readonly now: Clock = () => performance.now(), startedAt = now()) {
    this.startedAt = startedAt;
  }

  setSuggestions(suggestionCount: number, cacheHit?: boolean): void {
    this.suggestionCount = Math.max(0, suggestionCount);
    this.cacheHit = cacheHit;
  }

  markApiResponse(durationMs: number, serverTimingHeader: string | null): void {
    this.apiResponseMs = roundDuration(durationMs);
    this.serverTiming = parseServerTimingHeader(serverTimingHeader);
  }

  markPreviewReady(memeId: string): void {
    if (this.suggestionCount === 0 || this.previewIds.has(memeId)) return;
    this.previewIds.add(memeId);
    const elapsed = this.elapsed();
    this.firstPreviewReadyMs ??= elapsed;
    if (this.previewIds.size >= this.suggestionCount) this.allPreviewsReadyMs ??= elapsed;
  }

  markOriginalReady(memeId: string): void {
    if (this.suggestionCount === 0 || this.originalIds.has(memeId)) return;
    this.originalIds.add(memeId);
    if (this.originalIds.size >= this.suggestionCount) this.readyToAttachMs ??= this.elapsed();
  }

  startBrowserRequest(): void {
    this.previewState = "pending";
  }

  markPreviewState(state: NonNullable<SuggestionPerformanceSnapshot["preview_state"]>): void {
    this.previewState = state;
  }

  markUsablePreview(memeId: string): void {
    if (this.suggestionCount === 0 || this.usablePreviewIds.has(memeId)) return;
    this.usablePreviewIds.add(memeId);
    this.previewState = "usable";
    this.firstUsablePreviewMs ??= this.elapsed();
    if (this.usablePreviewIds.size >= this.suggestionCount) this.allUsablePreviewsMs ??= this.elapsed();
  }

  markPreviewRenderFailure(): void {
    this.previewRenderFailureCount += 1;
  }

  markMediaFailure(): void {
    this.mediaFailureCount += 1;
  }

  markMediaSettled(): void {
    this.mediaSettledMs ??= this.elapsed();
  }

  snapshot(): SuggestionPerformanceSnapshot {
    return {
      suggestion_count: this.suggestionCount,
      ...(this.cacheHit === undefined ? {} : { cache_hit: this.cacheHit }),
      media_failure_count: this.mediaFailureCount,
      preview_render_failure_count: this.previewRenderFailureCount,
      ...(this.previewState ? { preview_state: this.previewState } : {}),
      ...(this.firstUsablePreviewMs === undefined ? {} : { first_usable_preview_ms: this.firstUsablePreviewMs }),
      ...(this.allUsablePreviewsMs === undefined ? {} : { all_usable_previews_ms: this.allUsablePreviewsMs }),
      ...(this.apiResponseMs === undefined ? {} : { api_response_ms: this.apiResponseMs }),
      ...(this.firstPreviewReadyMs === undefined
        ? {}
        : { first_preview_bytes_ms: this.firstPreviewReadyMs }),
      ...(this.allPreviewsReadyMs === undefined
        ? {}
        : { all_preview_bytes_ms: this.allPreviewsReadyMs }),
      ...(this.readyToAttachMs === undefined
        ? {}
        : { all_original_bytes_ms: this.readyToAttachMs }),
      ...(this.mediaSettledMs === undefined ? {} : { media_settled_ms: this.mediaSettledMs }),
      ...(this.serverTiming ? { server_timing: this.serverTiming } : {}),
    };
  }

  private elapsed(): number {
    return roundDuration(this.now() - this.startedAt);
  }
}

export function roundDuration(durationMs: number): number {
  return Math.max(0, Math.round(durationMs * 10) / 10);
}
