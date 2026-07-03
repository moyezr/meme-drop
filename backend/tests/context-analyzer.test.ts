import assert from "node:assert/strict";
import test from "node:test";
import { heuristicTweetContext } from "../src/services/context-analyzer.js";

test("heuristic context recognizes rhetorical failure questions as sarcasm", () => {
  const context = heuristicTweetContext(
    "We skipped tests, deployed Friday night, and the payment flow exploded. Who could have predicted this?"
  );

  assert.equal(context.tone, "sarcastic");
  assert.equal(context.intent, "dunking");
  assert.ok(context.caption_anchors.some((anchor) => anchor.includes("payment flow")));
  assert.ok(context.caption_anchors.some((anchor) => anchor.includes("skipped tests")));
});
