export interface SuggestionRequestObserver<T> {
  onInitial?: (suggestions: T[], cacheHit: boolean) => void;
  onApiResponse?: (durationMs: number, serverTiming: string | null) => void;
  onPreview?: (suggestion: T) => void;
  onOriginal?: (suggestion: T) => void;
}

/**
 * Shares one suggestion/media request while ensuring every interested tab gets
 * the same progressive updates. It replays completed milestones to listeners
 * that join after the API response but before media hydration finishes.
 */
export class SuggestionRequestObservers<T> {
  private readonly observers = new Set<SuggestionRequestObserver<T>>();
  private initial: { suggestions: T[]; cacheHit: boolean } | undefined;
  private apiResponse: { durationMs: number; serverTiming: string | null } | undefined;
  private readonly previews: T[] = [];
  private readonly originals: T[] = [];

  subscribe(observer: SuggestionRequestObserver<T>): void {
    this.observers.add(observer);
    if (this.apiResponse) observer.onApiResponse?.(this.apiResponse.durationMs, this.apiResponse.serverTiming);
    if (this.initial) observer.onInitial?.(this.initial.suggestions, this.initial.cacheHit);
    for (const suggestion of this.previews) observer.onPreview?.(suggestion);
    for (const suggestion of this.originals) observer.onOriginal?.(suggestion);
  }

  notifyInitial(suggestions: T[], cacheHit: boolean): void {
    this.initial = { suggestions, cacheHit };
    this.forEach((observer) => observer.onInitial?.(suggestions, cacheHit));
  }

  notifyApiResponse(durationMs: number, serverTiming: string | null): void {
    this.apiResponse = { durationMs, serverTiming };
    this.forEach((observer) => observer.onApiResponse?.(durationMs, serverTiming));
  }

  notifyPreview(suggestion: T): void {
    this.previews.push(suggestion);
    this.forEach((observer) => observer.onPreview?.(suggestion));
  }

  notifyOriginal(suggestion: T): void {
    this.originals.push(suggestion);
    this.forEach((observer) => observer.onOriginal?.(suggestion));
  }

  private forEach(callback: (observer: SuggestionRequestObserver<T>) => void): void {
    for (const observer of this.observers) callback(observer);
  }
}
