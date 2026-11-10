import assert from "node:assert/strict";
import test from "node:test";

test("worker validates Reddit context, separates both sources in cache and evicts expired replies", async (t) => {
  const originalChrome = globalThis.chrome;
  const originalFetch = globalThis.fetch;
  const calls = [];
  let listener;
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  globalThis.chrome = {
    runtime: {
      onMessage: { addListener: (callback) => { listener = callback; } },
      onSuspend: { addListener: () => {} }, getManifest: () => ({ version: "0.0.5" }),
    },
    tabs: { sendMessage: async () => {} },
    storage: { local: { get: async () => ({ memedrop_install_id: "11111111-1111-4111-8111-111111111111" }) } },
  };
  globalThis.fetch = async (_url, request) => {
    calls.push(JSON.parse(request.body));
    return new Response(JSON.stringify({ suggestions: [] }), { status: 200 });
  };
  const context = { platform: "reddit", target_kind: "comment", post_title: "Synthetic title",
    post_body: "Synthetic original post", truncated: false };
  try {
    await import("../src/background/background.ts");
    const request = (text = "Synthetic selected comment", root = context, url = "https://www.reddit.com/r/fixture/") =>
      new Promise((resolve) => listener({ type: "GET_SUGGESTIONS", payload: {
        tweet_text: text, reply_context: root, cache_key: "same-client-key", request_id: "request",
      } }, { tab: { id: 1, url } }, resolve));
    assert.ok((await request(undefined, context, "https://www.linkedin.com/")).error);
    assert.ok((await request(undefined, { ...context, username: "private" })).error);
    assert.equal(calls.length, 0, "invalid context never reaches FastAPI");
    await request();
    await request();
    assert.equal(calls.length, 1, "identical context reuses one response");
    assert.deepEqual(calls[0].reply_context, context);
    await request("A different selected comment");
    await request(undefined, { ...context, post_body: "A changed original post" });
    assert.equal(calls.length, 3, "a reused caller key cannot hide either source changing");
    t.mock.timers.tick(5 * 60 * 1000);
    // Roll wall time back: a lazy expiry check would reuse the still-retained entry.
    t.mock.timers.setTime(1_000_000);
    await request();
    assert.equal(calls.length, 4, "expired entries are physically removed without needing a read");
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.fetch = originalFetch;
    t.mock.timers.reset();
  }
});
