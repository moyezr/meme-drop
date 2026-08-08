import assert from "node:assert/strict";
import test from "node:test";

const {
  MEME_REPLY_INTENT_TTL_MS,
  MemeReplyIntent,
  tweetIdFromStatusHref,
} = await import("../src/shared/meme-reply-intent.ts");

test("only an explicitly armed MemeDrop reply can be consumed", () => {
  const intent = new MemeReplyIntent();

  assert.equal(intent.consume(1_000), null);

  intent.arm({ tweetText: "deploying on Friday", tweetId: "12345" }, 1_000);
  assert.deepEqual(intent.consume(1_001), {
    tweetText: "deploying on Friday",
    tweetId: "12345",
  });
  assert.equal(intent.consume(1_002), null);
});

test("abandoned meme reply intent expires and cannot affect a later native reply", () => {
  const intent = new MemeReplyIntent();
  intent.arm({ tweetText: "source post", tweetId: "987" }, 2_000);

  assert.equal(intent.consume(2_000 + MEME_REPLY_INTENT_TTL_MS + 1), null);
});

test("clearing intent keeps X native reply inference-free", () => {
  const intent = new MemeReplyIntent();
  intent.arm({ tweetText: "source post", tweetId: null }, 3_000);
  intent.clear();

  assert.equal(intent.consume(3_001), null);
});

test("extracts canonical tweet ids without retaining the full status URL", () => {
  assert.equal(tweetIdFromStatusHref("/memedrop/status/1900123456789"), "1900123456789");
  assert.equal(
    tweetIdFromStatusHref("https://x.com/memedrop/status/1900123456789/analytics"),
    "1900123456789"
  );
  assert.equal(tweetIdFromStatusHref("https://x.com/home"), null);
  assert.equal(tweetIdFromStatusHref("not a status"), null);
});
