import assert from "node:assert/strict";
import test from "node:test";
import {
  attachmentImageSnapshot,
  hasNewReadyAttachment,
  waitForNativeAttachment,
} from "../src/content/attachment-confirmation.ts";

function fixture() {
  const state = { images: [], busy: false };
  const scope = {
    isConnected: true,
    querySelectorAll: () => state.images,
    querySelector: () => state.busy ? {} : null,
  };
  return { state, scope };
}
const image = (src = "blob:fixture") => ({ currentSrc: src, complete: true, naturalWidth: 320 });

test("event dispatch alone and pre-existing attachments cannot confirm insertion", () => {
  const { state, scope } = fixture();
  const existing = image();
  state.images = [existing];
  const before = attachmentImageSnapshot(scope, "img");
  assert.equal(hasNewReadyAttachment(scope, "img", "busy", before), false);
  existing.currentSrc = "blob:new-selection";
  assert.equal(hasNewReadyAttachment(scope, "img", "busy", before), true);
});

test("new attachment must decode, finish native progress, and remain in the active scope", () => {
  const { state, scope } = fixture();
  const before = attachmentImageSnapshot(scope, "img");
  const selected = image();
  state.images = [selected];
  selected.complete = false;
  assert.equal(hasNewReadyAttachment(scope, "img", "busy", before), false);
  selected.complete = true;
  selected.naturalWidth = 0;
  assert.equal(hasNewReadyAttachment(scope, "img", "busy", before), false);
  selected.naturalWidth = 320;
  state.busy = true;
  assert.equal(hasNewReadyAttachment(scope, "img", "busy", before), false);
  state.busy = false;
  assert.equal(hasNewReadyAttachment(scope, "img", "busy", before), true);
  scope.isConnected = false;
  assert.equal(hasNewReadyAttachment(scope, "img", "busy", before), false);
});

test("confirmation waits are bounded and abandon stale generations", async () => {
  const { state, scope } = fixture();
  const before = new Map();
  state.images = [image()];
  assert.equal(await waitForNativeAttachment(scope, "img", "busy", before, () => false), false);
  assert.equal(await waitForNativeAttachment(scope, "img", "busy", before, () => true), true);
  state.images = [];
  assert.equal(await waitForNativeAttachment(scope, "img", "busy", before, () => true, 0), false);
});
