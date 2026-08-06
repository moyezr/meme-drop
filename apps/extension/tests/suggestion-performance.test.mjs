import assert from "node:assert/strict";
import test from "node:test";

const {
  parseServerTimingHeader,
  SuggestionPerformanceTracker,
} = await import("../src/shared/suggestion-performance.ts");

test("parses duration values from a Server-Timing response header", () => {
  assert.deepEqual(
    parseServerTimingHeader('catalog;dur=12.4, model;desc="joint inference";dur=820'),
    { catalog: 12.4, model: 820 }
  );
  assert.equal(parseServerTimingHeader("cache;desc=hit"), undefined);
});

test("records API, preview, and ready-to-attach milestones only once", () => {
  let now = 100;
  const tracker = new SuggestionPerformanceTracker(() => now);
  tracker.setSuggestions(2);
  tracker.markApiResponse(42.46, "model;dur=31.2");

  now = 120;
  tracker.markPreviewReady("first");
  now = 130;
  tracker.markPreviewReady("first");
  tracker.markOriginalReady("first");
  now = 150;
  tracker.markPreviewReady("second");
  now = 180;
  tracker.markOriginalReady("second");

  assert.deepEqual(tracker.snapshot(), {
    suggestion_count: 2,
    cache_hit: false,
    media_failure_count: 0,
    api_response_ms: 42.5,
    first_preview_ready_ms: 20,
    all_previews_ready_ms: 50,
    ready_to_attach_ms: 80,
    server_timing: { model: 31.2 },
  });
});

test("records media failures and a final all-settled milestone without media identifiers", () => {
  let now = 100;
  const tracker = new SuggestionPerformanceTracker(() => now);
  tracker.setSuggestions(2);

  now = 170;
  tracker.markMediaFailure();
  tracker.markMediaFailure();
  tracker.markMediaSettled();
  now = 220;
  tracker.markMediaSettled();

  assert.deepEqual(tracker.snapshot(), {
    suggestion_count: 2,
    cache_hit: false,
    media_failure_count: 2,
    media_settled_ms: 70,
  });
});
