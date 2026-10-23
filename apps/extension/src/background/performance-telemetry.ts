import { projectPerformanceSample, type PerformanceSample } from "../shared/performance-sample";

/** Bounded in-memory, best-effort delivery; UI never waits and retries reuse UUIDs. */
export class PerformanceTelemetryQueue {
  private pending: PerformanceSample[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<void> | undefined;
  constructor(private readonly send: (samples: PerformanceSample[]) => Promise<void>) {}

  enqueue(value: unknown, extensionVersion: string): void {
    const sample = projectPerformanceSample(value, extensionVersion);
    if (!sample || this.pending.length >= 100) return;
    this.pending.push(sample);
    if (!this.timer && !this.inFlight) this.timer = setTimeout(() => void this.flush(), 350);
  }

  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.drain().finally(() => {
      this.inFlight = undefined;
      if (this.pending.length) void this.flush();
    });
    return this.inFlight;
  }

  private async drain(): Promise<void> {
    while (this.pending.length) {
      const batch = this.pending.splice(0, 20);
      try { await this.send(batch); }
      catch {
        try { await this.send(batch); }
        catch { console.warn("[MemeDrop] Performance sample delivery dropped after one retry"); }
      }
    }
  }
}
