export type SuggestionMessageIdentity = {
  cache_key?: string;
  request_id?: string;
};

/**
 * Produces a stable, non-plaintext key for the small number of replies kept
 * in the extension's in-memory suggestion cache. Tweet ids are already the
 * canonical public identifier; text-only contexts must never become cache
 * keys or console output.
 */
export async function buildSuggestionCacheKey(
  tweetText: string,
  canonicalTweetId?: string | null
): Promise<string> {
  if (canonicalTweetId) return `tweet:${canonicalTweetId}`;

  const normalized = tweetText.trim().replace(/\s+/g, " ").toLowerCase();
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normalized)
  );
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `text:sha256:${hash}`;
}

/** A request generation distinguishes a refresh from an earlier same-tweet request. */
export function createSuggestionRequestId(generation: number): string {
  return `compose-${generation}`;
}

/** A request may send when its extraction generation has not been superseded. */
export function isCurrentSuggestionGeneration(
  generation: number,
  currentGeneration: number
): boolean {
  return generation === currentGeneration;
}

export function isCurrentSuggestionMessage(
  message: SuggestionMessageIdentity,
  activeRequestId: string | null
): boolean {
  return Boolean(activeRequestId && message.request_id === activeRequestId);
}
