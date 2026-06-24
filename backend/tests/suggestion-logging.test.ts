import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ||= "postgresql://test";

const { safeLogCacheKey, safeLogTweetText } = await import("../src/services/suggestion-engine.js");

test("safeLogCacheKey hashes cache keys instead of exposing tweet text", () => {
  const cacheKey = "user:abc|text:prod is down and leadership wants launch|limit:5|mode:fast";
  const logged = safeLogCacheKey(cacheKey);

  assert.match(logged, /^sha256:[a-f0-9]{16}$/);
  assert.equal(logged.includes("prod is down"), false);
});

test("safeLogTweetText redacts tweet text in production mode", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousLogText = process.env.MEMEDROP_SUGGESTION_LOG_TEXT;
  process.env.NODE_ENV = "production";
  delete process.env.MEMEDROP_SUGGESTION_LOG_TEXT;

  try {
    const logged = safeLogTweetText("Prod is down and the dashboard is red");
    assert.match(logged, /^\[redacted:[a-f0-9]{12}\]$/);
    assert.equal(logged.includes("Prod is down"), false);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousLogText === undefined) delete process.env.MEMEDROP_SUGGESTION_LOG_TEXT;
    else process.env.MEMEDROP_SUGGESTION_LOG_TEXT = previousLogText;
  }
});

test("safeLogTweetText supports explicit preview mode for local debugging", () => {
  const previousLogText = process.env.MEMEDROP_SUGGESTION_LOG_TEXT;
  process.env.MEMEDROP_SUGGESTION_LOG_TEXT = "preview";

  try {
    assert.equal(safeLogTweetText("  short   tweet  "), "short tweet");
  } finally {
    if (previousLogText === undefined) delete process.env.MEMEDROP_SUGGESTION_LOG_TEXT;
    else process.env.MEMEDROP_SUGGESTION_LOG_TEXT = previousLogText;
  }
});
