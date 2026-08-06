/** The panel is intentionally a short decision set, not a result feed. */
export const MAX_SUGGESTIONS = 5;

export function clampSuggestionLimit(limit?: number): number {
  if (!Number.isFinite(limit)) return MAX_SUGGESTIONS;
  return Math.max(1, Math.min(Math.floor(limit as number), MAX_SUGGESTIONS));
}

export function limitSuggestions<T>(suggestions: T[]): T[] {
  return suggestions.slice(0, MAX_SUGGESTIONS);
}
