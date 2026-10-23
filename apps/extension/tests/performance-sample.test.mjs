import assert from "node:assert/strict";
import test from "node:test";

const {
  projectPerformanceSample,
  SuggestionBaselineTracker,
} = await import("../src/shared/performance-sample.ts");
const { PerformanceTelemetryQueue } = await import("../src/background/performance-telemetry.ts");
const { SuggestionPerformanceTracker } = await import("../src/shared/suggestion-performance.ts");

const version = "0.0.4";
const request = (overrides = {}) => ({
  event_id: crypto.randomUUID(), kind: "request", platform: "x", extension_version: version,
  outcome: "usable", elapsed_ms: 400, suggestion_count: 2, first_usable_preview_ms: 400,
  api_response_ms: 200, cache_status: "unknown", generation_mode: "unknown", ...overrides,
});
const snapshot = (overrides = {}) => ({
  suggestion_count: 2, media_failure_count: 0, preview_render_failure_count: 0,
  preview_state: "pending", ...overrides,
});

test("runtime projection strips text, URLs, content IDs, and unreviewed metadata", () => {
  const safe = request();
  const extra = {
    tweet_text: "PRIVATE_SOURCE_SENTINEL", caption: "PRIVATE_CAPTION_SENTINEL",
    steering_instruction: "PRIVATE_GUIDANCE_SENTINEL", url: "https://x.com/private/status/123",
    request_id: "content-derived", meme_id: "template-id", impression_id: crypto.randomUUID(),
    install_id: crypto.randomUUID(), cache_key: "PRIVATE_SOURCE_SENTINEL",
    server_timing: { PRIVATE_SOURCE_SENTINEL: 10 }, error: new Error("PRIVATE_ERROR_SENTINEL"),
  };
  const projected = projectPerformanceSample({ ...safe, ...extra });
  assert.deepEqual(projected, safe);
  assert.doesNotMatch(JSON.stringify(projected), /PRIVATE_|https:|content-derived|template-id/);
  assert.equal(projectPerformanceSample(request({ event_id: "raw-post-text" })), null);
  assert.equal(projectPerformanceSample(request({ platform: "https://x.com" })), null);
  assert.equal(projectPerformanceSample(request({ generation_mode: "raw model text" })), null);
  assert.equal(projectPerformanceSample(request({ cache_status: "raw cache key" })), null);
  assert.equal(projectPerformanceSample(request({ extension_version: "private text" })), null);
  assert.equal(
    projectPerformanceSample(request({ extension_version: "private text" }), version).extension_version,
    version,
  );
});

test("request projection rejects invalid component timings and contradictory outcomes", () => {
  for (const elapsed_ms of [-1, NaN, Infinity, 120_001, "400", null]) {
    assert.equal(projectPerformanceSample(request({ elapsed_ms })), null);
  }
  for (const api_response_ms of [-1, NaN, Infinity, 401, "200", null]) {
    assert.equal(projectPerformanceSample(request({ api_response_ms })), null);
  }
  for (const first_usable_preview_ms of [-1, NaN, Infinity, 401, undefined]) {
    assert.equal(projectPerformanceSample(request({ first_usable_preview_ms })), null);
  }
  for (const suggestion_count of [-1, 6, 1.5, "2", null]) {
    assert.equal(projectPerformanceSample(request({ suggestion_count })), null);
  }
  assert.equal(projectPerformanceSample(request({ suggestion_count: 0 })), null);
  assert.equal(projectPerformanceSample(request({ outcome: "empty" })), null);
  assert.equal(projectPerformanceSample(request({ outcome: "failed" })), null);
  assert.equal(projectPerformanceSample(request({ outcome: "timeout" })), null);
  assert.equal(projectPerformanceSample(request({ outcome: "cancelled" })), null);
  const empty = request({ outcome: "empty", suggestion_count: 0, first_usable_preview_ms: undefined });
  delete empty.first_usable_preview_ms;
  assert.deepEqual(projectPerformanceSample(empty), empty);
});

test("attachment projection requires native confirmation and never turns copying into insertion", () => {
  const attachment = {
    event_id: crypto.randomUUID(), kind: "attachment", platform: "linkedin",
    extension_version: version, outcome: "inserted", elapsed_ms: 150,
    selected_preparation_ms: 40, native_attachment_confirmation_ms: 110,
  };
  assert.deepEqual(projectPerformanceSample({ ...attachment, text: "PRIVATE_SOURCE_SENTINEL" }), attachment);
  assert.equal(projectPerformanceSample({ ...attachment, native_attachment_confirmation_ms: undefined }), null);
  assert.equal(projectPerformanceSample({ ...attachment, native_attachment_confirmation_ms: 151 }), null);
  assert.equal(projectPerformanceSample({ ...attachment, selected_preparation_ms: -1 }), null);
  for (const outcome of ["copied", "attachment_failed", "cancelled"]) {
    assert.equal(projectPerformanceSample({ ...attachment, outcome }), null);
    const neutral = { ...attachment, outcome };
    delete neutral.native_attachment_confirmation_ms;
    assert.deepEqual(projectPerformanceSample(neutral), neutral);
  }
});

test("first usable sample waits for rendered readiness rather than fetched bytes, once per request", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let now = 100;
  const samples = [];
  const browser = new SuggestionPerformanceTracker(() => now, 0);
  const baseline = new SuggestionBaselineTracker({ platform: "x", extension_version: version }, 0,
    (sample) => samples.push(sample), () => now);
  browser.startBrowserRequest();
  browser.setSuggestions(2);
  browser.markPreviewReady("PRIVATE_TEMPLATE_ID");
  baseline.observe(browser.snapshot());
  assert.equal(samples.length, 0);
  assert.equal(browser.snapshot().first_usable_preview_ms, undefined);

  now = 400;
  browser.markUsablePreview("PRIVATE_TEMPLATE_ID");
  baseline.observe(browser.snapshot());
  baseline.updateTransport(snapshot({ api_response_ms: 200, server_cache_hit: false, generation_mode: "model" }));
  now = 450;
  t.mock.timers.tick(50);
  assert.equal(samples.length, 1);
  assert.equal(samples[0].elapsed_ms, 400);
  assert.equal(samples[0].first_usable_preview_ms, 400);
  assert.equal(samples[0].cache_status, "miss");
  assert.equal(samples[0].generation_mode, "model");
  assert.doesNotMatch(JSON.stringify(samples), /PRIVATE_TEMPLATE_ID|first_preview_bytes/);

  now = 800;
  browser.markUsablePreview("ANOTHER_TEMPLATE_ID");
  baseline.observe(browser.snapshot());
  baseline.flush();
  t.mock.timers.tick(50);
  assert.equal(samples.length, 1);
});

test("terminal empty, failed, timeout and cancelled samples preserve the observation clock", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const outcome of ["empty", "failed", "timeout", "cancelled"]) {
    let now = 260;
    const samples = [];
    const baseline = new SuggestionBaselineTracker({ platform: "linkedin", extension_version: version }, 100,
      (sample) => samples.push(sample), () => now);
    if (outcome === "timeout") baseline.setFailure("timeout");
    baseline.observe(snapshot({ suggestion_count: 0, preview_state: outcome === "timeout" ? "failed" : outcome }));
    now = 2_000;
    baseline.flush();
    baseline.flush();
    assert.equal(samples.length, 1);
    assert.equal(samples[0].outcome, outcome);
    assert.equal(samples[0].elapsed_ms, 160);
    assert.equal(samples[0].cache_status, "unknown");
    assert.equal(samples[0].generation_mode, "unknown");
  }
});

test("cache and generation classification uses explicit transport evidence", () => {
  for (const [header, cache, generation] of [
    ['joint-model;dur=25;desc="model"', "miss", "model"],
    ['joint-model;dur=25;desc="fallback"', "miss", "fallback"],
    ['joint-model;dur=25;desc="timeout"', "miss", "fallback"],
    ['joint-model;dur=0;desc="cache", cache;desc="hit"', "hit", "unknown"],
    [null, "unknown", "unknown"],
    ['joint-model;dur=25;desc="arbitrary model text"', "unknown", "unknown"],
  ]) {
    const transport = new SuggestionPerformanceTracker(() => 0);
    transport.setSuggestions(1, false);
    transport.markApiResponse(25, header);
    const samples = [];
    const baseline = new SuggestionBaselineTracker({ platform: "x", extension_version: version }, 0,
      (sample) => samples.push(sample), () => 50);
    baseline.updateTransport(transport.snapshot());
    baseline.observe(snapshot({ suggestion_count: 0, preview_state: "empty" }));
    baseline.flush();
    assert.equal(samples[0].cache_status, cache);
    assert.equal(samples[0].generation_mode, generation);
  }
});

test("best-effort request collection cannot throw through the caller", () => {
  const baseline = new SuggestionBaselineTracker({ platform: "x", extension_version: version }, 0,
    () => { throw new Error("Extension context invalidated"); }, () => 25);
  baseline.observe(snapshot({ suggestion_count: 0, preview_state: "empty" }));
  assert.doesNotThrow(() => baseline.flush());
  assert.doesNotThrow(() => baseline.flush());
});

test("late API metadata cannot erase or extend an already-cancelled request", () => {
  let now = 100;
  const samples = [];
  const baseline = new SuggestionBaselineTracker({ platform: "x", extension_version: version }, 0,
    (sample) => samples.push(sample), () => now);
  baseline.observe(snapshot({ suggestion_count: 0, preview_state: "cancelled" }));
  now = 130;
  baseline.updateTransport(snapshot({ api_response_ms: 120, server_cache_hit: false, generation_mode: "model" }));
  baseline.flush();
  assert.equal(samples.length, 1);
  assert.equal(samples[0].outcome, "cancelled");
  assert.equal(samples[0].elapsed_ms, 100);
  assert.equal(samples[0].api_response_ms, undefined);
  assert.equal(samples[0].cache_status, "unknown");
  assert.equal(samples[0].generation_mode, "unknown");
});

test("queue projects hostile payloads, uses trusted version, and limits pending samples to 100", async () => {
  const batches = [];
  const queue = new PerformanceTelemetryQueue(async (batch) => batches.push(structuredClone(batch)));
  for (let index = 0; index < 125; index++) {
    queue.enqueue(request({ extension_version: "PRIVATE_SOURCE_SENTINEL", url: "https://x.com/private" }), version);
  }
  await queue.flush();
  assert.deepEqual(batches.map((batch) => batch.length), [20, 20, 20, 20, 20]);
  assert.equal(new Set(batches.flat().map((sample) => sample.event_id)).size, 100);
  assert.ok(batches.flat().every((sample) => sample.extension_version === version));
  assert.doesNotMatch(JSON.stringify(batches), /PRIVATE_|https:/);
});

test("in-flight batches remain 20 with at most another 100 pending during delivery", async () => {
  const batches = [];
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const queue = new PerformanceTelemetryQueue(async (batch) => {
    batches.push(structuredClone(batch));
    if (batches.length === 1) await blocked;
  });
  for (let index = 0; index < 20; index++) queue.enqueue(request(), version);
  const inFlight = queue.flush();
  for (let index = 0; index < 125; index++) queue.enqueue(request(), version);
  assert.equal(queue.flush(), inFlight);
  release();
  await inFlight;
  assert.deepEqual(batches.map((batch) => batch.length), [20, 20, 20, 20, 20, 20]);
});

test("queue retries a batch once with unchanged event UUIDs and suppresses delivery failures", async (t) => {
  const batches = [];
  const warnings = [];
  t.mock.method(console, "warn", (...args) => warnings.push(args));
  const queue = new PerformanceTelemetryQueue(async (batch) => {
    batches.push(structuredClone(batch));
    throw new Error("PRIVATE_NETWORK_ERROR_SENTINEL");
  });
  queue.enqueue(request(), version);
  await assert.doesNotReject(queue.flush());
  assert.equal(batches.length, 2);
  assert.deepEqual(batches[0], batches[1]);
  assert.match(batches[0][0].event_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(warnings.length, 1);
  assert.doesNotMatch(JSON.stringify(warnings), /PRIVATE_NETWORK_ERROR_SENTINEL/);
  queue.enqueue(request({ outcome: "invalid" }), version);
  await queue.flush();
  assert.equal(batches.length, 2);
});
