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

test("records API and fetched preview/original byte milestones only once", () => {
  let now = 100;
  const tracker = new SuggestionPerformanceTracker(() => now);
  tracker.setSuggestions(2, false);
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
    preview_render_failure_count: 0,
    media_failure_count: 0,
    api_response_ms: 42.5,
    first_preview_bytes_ms: 20,
    all_preview_bytes_ms: 50,
    all_original_bytes_ms: 80,
    server_timing: { model: 31.2 },
  });
});

test("records media failures and a final all-settled milestone without media identifiers", () => {
  let now = 100;
  const tracker = new SuggestionPerformanceTracker(() => now);
  tracker.setSuggestions(2, false);

  now = 170;
  tracker.markMediaFailure();
  tracker.markMediaFailure();
  tracker.markMediaSettled();
  now = 220;
  tracker.markMediaSettled();

  assert.deepEqual(tracker.snapshot(), {
    suggestion_count: 2,
    cache_hit: false,
    preview_render_failure_count: 0,
    media_failure_count: 2,
    media_settled_ms: 70,
  });
});


test("usable previews include trigger-to-render time and stay separate from fetched bytes", () => {
  let now = 250;
  const tracker = new SuggestionPerformanceTracker(() => now, 100);
  tracker.setSuggestions(2);
  tracker.markPreviewReady("one");
  assert.equal(tracker.snapshot().first_usable_preview_ms, undefined);
  now = 400;
  tracker.markUsablePreview("one");
  now = 500;
  tracker.markUsablePreview("one");
  tracker.markPreviewRenderFailure();
  tracker.markUsablePreview("two");
  assert.equal(tracker.snapshot().first_usable_preview_ms, 300);
  assert.equal(tracker.snapshot().all_usable_previews_ms, 400);
  assert.equal(tracker.snapshot().preview_render_failure_count, 1);
});


test("browser-local snapshots do not label an unknown transport cache result as a miss", () => {
  const tracker = new SuggestionPerformanceTracker(() => 100);
  tracker.startBrowserRequest();
  tracker.setSuggestions(2);
  assert.equal(Object.hasOwn(tracker.snapshot(), "cache_hit"), false);
  tracker.setSuggestions(2, true);
  assert.equal(tracker.snapshot().cache_hit, true);
  tracker.setSuggestions(2, false);
  assert.equal(tracker.snapshot().cache_hit, false);
});
