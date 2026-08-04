import assert from "node:assert/strict";
import test from "node:test";

const { PANEL_STYLES } = await import("../src/content/suggestion-panel.ts");

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
