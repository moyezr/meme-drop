import assert from "node:assert/strict";
import test from "node:test";

const {
  buildSuggestionCacheKey,
  createSuggestionRequestId,
  hasSteeringInstructionChanged,
  isCurrentSuggestionGeneration,
  isCurrentSuggestionMessage,
  MAX_STEERING_INSTRUCTION_LENGTH,
  normalizeSteeringInstruction,
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

test("isolates steered suggestions without retaining the instruction in the cache key", async () => {
  const automatic = await buildSuggestionCacheKey("Source post", "183726451");
  const first = await buildSuggestionCacheKey(
    "Source post",
    "183726451",
    "  Make it about too many meetings  "
  );
  const second = await buildSuggestionCacheKey(
    "Source post",
    "183726451",
    "Make it about too many meetings"
  );
  const different = await buildSuggestionCacheKey(
    "Source post",
    "183726451",
    "Make it celebratory"
  );

  assert.equal(first, second);
  assert.notEqual(first, automatic);
  assert.notEqual(first, different);
  assert.match(first, /^tweet:183726451\|steering:sha256:[a-f0-9]{64}$/);
  assert.equal(first.includes("meetings"), false);
});

test("normalizes and bounds optional steering instructions", () => {
  assert.equal(normalizeSteeringInstruction("   "), undefined);
  assert.equal(normalizeSteeringInstruction(null), undefined);
  assert.equal(normalizeSteeringInstruction(" more   sarcastic "), "more sarcastic");
  assert.equal(
    normalizeSteeringInstruction("x".repeat(MAX_STEERING_INSTRUCTION_LENGTH + 10))?.length,
    MAX_STEERING_INSTRUCTION_LENGTH
  );
});

test("treats reapplying equivalent guidance as a no-op", () => {
  assert.equal(hasSteeringInstructionChanged(undefined, "  "), false);
  assert.equal(hasSteeringInstructionChanged("more sarcastic", " more   sarcastic "), false);
  assert.equal(hasSteeringInstructionChanged("more sarcastic", "make it wholesome"), true);
  assert.equal(hasSteeringInstructionChanged("more sarcastic", ""), true);
});

test("submission and clear generations cannot accept each other's results", async () => {
  const submittedKey = await buildSuggestionCacheKey("Source post", "183726451", "sarcastic");
  const clearedKey = await buildSuggestionCacheKey("Source post", "183726451", "");
  const submittedRequestId = createSuggestionRequestId(12);
  const clearedRequestId = createSuggestionRequestId(13);

  assert.notEqual(submittedKey, clearedKey);
  assert.equal(isCurrentSuggestionMessage({ request_id: submittedRequestId }, clearedRequestId), false);
  assert.equal(isCurrentSuggestionMessage({ request_id: clearedRequestId }, clearedRequestId), true);
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
