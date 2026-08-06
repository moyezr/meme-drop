import assert from "node:assert/strict";
import test from "node:test";

const { PANEL_STYLES, getPreviewDimensions } = await import("../src/content/suggestion-panel.ts");

test("captioned previews are capped while preserving their aspect ratio", () => {
  assert.deepEqual(getPreviewDimensions(1600, 900), { width: 480, height: 270 });
  assert.deepEqual(getPreviewDimensions(900, 1600), { width: 270, height: 480 });
  assert.deepEqual(getPreviewDimensions(320, 180), { width: 320, height: 180 });
});

test("suggestion panel uses flat dark surfaces without gradients", () => {
  assert.doesNotMatch(PANEL_STYLES, /(?:linear|radial|conic)-gradient/i);
  assert.match(PANEL_STYLES, /background: rgba\(17, 20, 24, 0\.94\)/);
  assert.match(PANEL_STYLES, /backdrop-filter: blur\(20px\)/);
  assert.match(PANEL_STYLES, /calc\(100vw - 48px\)/);
});

test("suggestion panel keeps typography restrained", () => {
  const weights = [...PANEL_STYLES.matchAll(/font-weight:\s*(\d+)/g)].map((match) =>
    Number(match[1])
  );

  assert.ok(weights.length > 0);
  assert.ok(weights.every((weight) => weight <= 500));
});

test("suggestion panel respects reduced motion preferences", () => {
  assert.match(PANEL_STYLES, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(PANEL_STYLES, /\.meme-strip \{ scroll-behavior: auto; \}/);
});
