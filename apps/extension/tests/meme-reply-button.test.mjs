import assert from "node:assert/strict";
import test from "node:test";

const { MEME_REPLY_BUTTON_STYLES } = await import(
  "../src/content/meme-reply-button.ts"
);

test("MemeDrop reply action is visually distinct from native platform actions", () => {
  assert.match(MEME_REPLY_BUTTON_STYLES, /background: rgba\(249, 24, 128, 0\.13\)/);
  assert.match(MEME_REPLY_BUTTON_STYLES, /border: 1px solid/);
  assert.match(MEME_REPLY_BUTTON_STYLES, /font-weight: 700/);
  assert.doesNotMatch(MEME_REPLY_BUTTON_STYLES, /background: transparent/);
});
