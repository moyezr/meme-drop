export type SuggestionMessageIdentity = {
  cache_key?: string;
  request_id?: string;
};

export const MAX_STEERING_INSTRUCTION_LENGTH = 280;

/**
 * Keeps optional guidance within the API contract without retaining empty or
 * whitespace-only values. This is repeated in the background worker because
 * runtime messages are not a trusted type boundary.
 */
export function normalizeSteeringInstruction(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, MAX_STEERING_INSTRUCTION_LENGTH) : undefined;
}

export function hasSteeringInstructionChanged(
  current: string | undefined,
  requested: unknown
): boolean {
  return current !== normalizeSteeringInstruction(requested);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

/**
 * Produces a stable, non-plaintext key for the small number of replies kept
 * in the extension's in-memory suggestion cache. Tweet ids are already the
 * canonical public identifier; text-only contexts must never become cache
 * keys or console output.
 */
export async function buildSuggestionCacheKey(
  tweetText: string,
  canonicalTweetId?: string | null,
  steeringInstruction?: string
): Promise<string> {
  const baseKey = canonicalTweetId
    ? `tweet:${canonicalTweetId}`
    : `text:sha256:${await sha256(tweetText.trim().replace(/\s+/g, " ").toLowerCase())}`;
  const normalizedSteering = normalizeSteeringInstruction(steeringInstruction);
  if (!normalizedSteering) return baseKey;

  return `${baseKey}|steering:sha256:${await sha256(normalizedSteering)}`;
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
