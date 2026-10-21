export type UsageAction =
  | "shown" | "clicked" | "inserted" | "copied"
  | "saved" | "rejected" | "abandoned" | "attachment_failed";
export type UsageSource = "user" | "global";

/**
 * The content script is deliberately only allowed to provide the safe context
 * returned with a suggestion. In particular, `tweet_context` is not accepted
 * here: it can contain the post text and must never be forwarded as telemetry.
 */
export interface UsageEventInput {
  meme_id: string;
  action: UsageAction;
  source?: UsageSource;
  feedback_context?: Record<string, unknown>;
  impression_id?: string;
  position?: number;
}

export interface UsageEvent {
  event_id: string;
  telemetry_version: 2;
  impression_id?: string;
  position?: number;
  meme_id: string;
  action: UsageAction;
  source?: UsageSource;
  tweet_context: Record<string, unknown>;
}

// Validate values as well as keys: runtime messages are not type checked.
const SAFE_FEEDBACK_VALUES: Record<string, ReadonlySet<string>> = {
  suggestion_mode: new Set(["automatic", "steered"]),
  sentiment: new Set(["positive", "negative", "neutral"]),
  tone: new Set([
    "sarcastic", "earnest", "rant", "celebratory", "hot-take",
    "question", "absurdist", "wholesome", "self-deprecating",
  ]),
  topic: new Set([
    "tech", "finance", "politics", "sports", "entertainment",
    "personal", "culture", "relationships", "other",
  ]),
  intent: new Set([
    "counter-argument", "agreement", "sharing-opinion", "venting",
    "asking", "celebrating", "dunking", "self-deprecating",
  ]),
};
const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeFeedbackContext(values: Record<string, unknown> | undefined) {
  return Object.fromEntries(
    Object.entries(values ?? {}).filter(([key, value]) => {
      if (key === "intensity") {
        return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
      }
      return typeof value === "string"
        && Object.hasOwn(SAFE_FEEDBACK_VALUES, key)
        && SAFE_FEEDBACK_VALUES[key]?.has(value);
    })
  );
}

export function projectUsageEvent(input: UsageEventInput): UsageEvent {
  return {
    event_id: crypto.randomUUID(),
    telemetry_version: 2,
    meme_id: input.meme_id,
    action: input.action,
    ...(input.source ? { source: input.source } : {}),
    ...(typeof input.impression_id === "string" && UUID4.test(input.impression_id)
      ? { impression_id: input.impression_id } : {}),
    ...(Number.isInteger(input.position) && input.position! >= 1 && input.position! <= 5
      ? { position: input.position } : {}),
    // Keep the API's existing field name at the transport boundary.
    tweet_context: safeFeedbackContext(input.feedback_context),
  };
}

export interface UsageTelemetryQueueOptions {
  sendBatch: (events: UsageEvent[]) => Promise<void>;
  flushDelayMs?: number;
  maxBatchSize?: number;
  onError?: (error: unknown, attempt: 1 | 2) => void;
}

/**
 * Best-effort service-worker telemetry. Events are never allowed to delay the
 * UI: callers enqueue synchronously and the queue flushes in the background.
 * Each failed batch is retried exactly once, then dropped with a visible error.
 */
export class UsageTelemetryQueue {
  private readonly sendBatch: (events: UsageEvent[]) => Promise<void>;
  private readonly flushDelayMs: number;
  private readonly maxBatchSize: number;
  private readonly onError: (error: unknown, attempt: 1 | 2) => void;
  private events: UsageEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> | null = null;

  constructor(options: UsageTelemetryQueueOptions) {
    this.sendBatch = options.sendBatch;
    this.flushDelayMs = options.flushDelayMs ?? 350;
    this.maxBatchSize = options.maxBatchSize ?? 50;
    this.onError = options.onError ?? ((_error, attempt) => {
      console.error(`[MemeDrop] Usage batch failed (attempt ${attempt}/2)`);
    });
  }

  enqueue(input: UsageEventInput): void {
    this.events.push(projectUsageEvent(input));
    if (this.events.length >= this.maxBatchSize) {
      void this.flush();
      return;
    }
    this.scheduleFlush();
  }

  /** Flushes pending events, intended for tests and service-worker shutdown. */
  flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.flushing) return this.flushing;

    this.flushing = this.flushPending().finally(() => {
      this.flushing = null;
      if (this.events.length > 0) void this.flush();
    });
    return this.flushing;
  }

  private scheduleFlush(): void {
    if (this.flushTimer || this.flushing) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, this.flushDelayMs);
  }

  private async flushPending(): Promise<void> {
    while (this.events.length > 0) {
      const batch = this.events.splice(0, this.maxBatchSize);
      await this.sendWithSingleRetry(batch);
    }
  }

  private async sendWithSingleRetry(batch: UsageEvent[]): Promise<void> {
    try {
      await this.sendBatch(batch);
    } catch (error) {
      this.onError(error, 1);
      try {
        await this.sendBatch(batch);
      } catch (retryError) {
        this.onError(retryError, 2);
      }
    }
  }
}
