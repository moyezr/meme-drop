import assert from "node:assert/strict";
import test from "node:test";

const {
  MAX_SUGGESTIONS,
  clampSuggestionLimit,
  limitSuggestions,
} = await import("../src/shared/suggestion-limits.ts");

test("suggestion limit is capped at five for API and panel callers", () => {
  assert.equal(MAX_SUGGESTIONS, 5);
  assert.equal(clampSuggestionLimit(), 5);
  assert.equal(clampSuggestionLimit(12), 5);
  assert.equal(clampSuggestionLimit(3.9), 3);
  assert.equal(clampSuggestionLimit(0), 1);
});

test("only the first five suggestions are displayed", () => {
  assert.deepEqual(limitSuggestions([1, 2, 3, 4, 5, 6]), [1, 2, 3, 4, 5]);
});
