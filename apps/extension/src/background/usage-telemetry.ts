export type UsageAction = "shown" | "clicked" | "used" | "saved" | "dismissed";
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
}

export interface UsageEvent {
  meme_id: string;
  action: UsageAction;
  source?: UsageSource;
  tweet_context: Record<string, unknown>;
}

const SAFE_FEEDBACK_CONTEXT_KEYS = new Set([
  "suggestion_mode",
  "sentiment",
  "tone",
  "topic",
  "intent",
  "intensity",
  "reply_style",
  "ideal_meme_vibe",
  "social_dynamic",
  "humor_angle",
]);

function safeFeedbackContext(values: Record<string, unknown> | undefined) {
  return Object.fromEntries(
    Object.entries(values ?? {}).filter(([key]) => SAFE_FEEDBACK_CONTEXT_KEYS.has(key))
  );
}

export function projectUsageEvent(input: UsageEventInput): UsageEvent {
  return {
    meme_id: input.meme_id,
    action: input.action,
    ...(input.source ? { source: input.source } : {}),
    // Keep the API's existing field name at the transport boundary. An empty
    // context is valid for saved-library events and for older suggestions.
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
    this.onError = options.onError ?? ((error, attempt) => {
      console.error(`[MemeDrop] Usage batch failed (attempt ${attempt}/2):`, error);
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
