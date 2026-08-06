import assert from "node:assert/strict";
import test from "node:test";

const {
  buildSuggestionCacheKey,
  createSuggestionRequestId,
  isCurrentSuggestionGeneration,
  isCurrentSuggestionMessage,
} = await import("../src/shared/suggestion-request.ts");

test("uses the canonical tweet id without retaining tweet text in a cache key", async () => {
  assert.equal(
    await buildSuggestionCacheKey("A private source post", "183726451"),
    "tweet:183726451"
  );
});

test("hashes text-only cache keys deterministically instead of embedding source text", async () => {
  const sourceText = "  A private   source post  ";
  const first = await buildSuggestionCacheKey(sourceText);
  const second = await buildSuggestionCacheKey("a private source post");

  assert.equal(first, second);
  assert.match(first, /^text:sha256:[a-f0-9]{64}$/);
  assert.equal(first.includes("private"), false);
  assert.equal(first.includes(sourceText.trim()), false);
});

test("accepts only messages from the active compose request generation", () => {
  const activeRequestId = createSuggestionRequestId(8);

  assert.equal(
    isCurrentSuggestionMessage({ request_id: activeRequestId }, activeRequestId),
    true
  );
  assert.equal(
    isCurrentSuggestionMessage({ request_id: createSuggestionRequestId(7) }, activeRequestId),
    false
  );
  assert.equal(isCurrentSuggestionMessage({}, activeRequestId), false);
});

test("allows a current request generation to send before it becomes active", () => {
  const generation = 8;
  const priorActiveRequestId = createSuggestionRequestId(7);

  assert.equal(isCurrentSuggestionGeneration(generation, generation), true);
  assert.notEqual(createSuggestionRequestId(generation), priorActiveRequestId);
  assert.equal(isCurrentSuggestionGeneration(generation, generation + 1), false);
});
