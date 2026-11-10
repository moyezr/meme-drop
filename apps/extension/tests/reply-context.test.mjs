import assert from "node:assert/strict";
import test from "node:test";
import { readReplyContext } from "../src/shared/reply-context.ts";
import { buildSuggestionCacheKey } from "../src/shared/suggestion-request.ts";
import { redditPostId } from "../src/content/reddit-adapter.ts";
import { platformForUrl } from "../src/shared/platform.ts";

const context = {
  platform: "reddit", target_kind: "comment", post_title: "A synthetic launch",
  post_body: "The team shipped without tests.", truncated: false,
};

test("reply cache identity includes the selected comment, root post, target and steering", async () => {
  const key = (text = "I warned them", id = "reddit:t1_a", root = context, steering) =>
    buildSuggestionCacheKey(text, id, steering, root);
  const first = await key();
  assert.match(first, /^reply:sha256:[a-f0-9]{64}$/);
  assert.equal(first, await key());
  for (const variant of [
    key("I agreed with them"), key(undefined, "reddit:t1_b"),
    key(undefined, undefined, { ...context, post_title: "A different topic" }),
    key(undefined, undefined, { ...context, post_body: "We wrote the tests first." }),
    key(undefined, undefined, context, "make it wholesome"),
  ]) assert.notEqual(first, await variant);
  assert.ok(!first.includes("warned"));
});

test("runtime reply context is bounded and rejects text-bearing extra fields", () => {
  assert.deepEqual(readReplyContext(context), context);
  assert.equal(readReplyContext(undefined), undefined);
  for (const invalid of [null, {}, { ...context, post_title: " " },
    { ...context, post_title: "a".repeat(301) }, { ...context, post_body: "a".repeat(1201) },
    { ...context, username: "private" }, { ...context, truncated: "false" },
    { ...context, platform: "reddit.attacker.test" },
  ]) assert.throws(() => readReplyContext(invalid), /Invalid reply context/);
});

test("desktop Reddit routing and worker trust reject unsupported and lookalike origins", () => {
  assert.equal(redditPostId("https://www.reddit.com/r/fixture/comments/abc123/title/def456/"), "t3_abc123");
  for (const url of ["https://www.reddit.com/", "https://old.reddit.com/r/a/comments/abc/title/",
    "https://www.reddit.com.attacker.test/comments/abc/title/", "http://www.reddit.com/comments/abc/"])
    assert.equal(redditPostId(url), null);
  assert.equal(platformForUrl("https://www.reddit.com/r/fixture/"), "reddit");
  for (const url of ["https://www.reddit.com.attacker.test/", "https://old.reddit.com/", "not a url"])
    assert.equal(platformForUrl(url), null);
});
