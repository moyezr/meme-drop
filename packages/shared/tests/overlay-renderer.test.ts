import assert from "node:assert/strict";
import test from "node:test";
import {
  drawMemeTextOverlay,
  measureMemeTextRegion,
} from "../src/overlay-renderer.js";
import type { MemeTextRegion } from "../src/types/suggestion.js";

class TestCanvasContext {
  font = "10px sans-serif";
  textAlign: CanvasTextAlign = "start";
  textBaseline: CanvasTextBaseline = "alphabetic";
  lineJoin: CanvasLineJoin = "miter";
  miterLimit = 10;
  lineWidth = 1;
  fillStyle: string | CanvasGradient | CanvasPattern = "#000";
  strokeStyle: string | CanvasGradient | CanvasPattern = "#000";
  readonly painted: string[] = [];

  constructor(private readonly characterWidth = 0.6) {}

  measureText(text: string): TextMetrics {
    const fontSize = Number.parseFloat(this.font) || 10;
    return { width: text.length * fontSize * this.characterWidth } as TextMetrics;
  }

  save() {}
  restore() {}
  beginPath() {}
  rect() {}
  clip() {}
  strokeText(text: string) {
    this.painted.push(`stroke:${text}`);
  }
  fillText(text: string) {
    this.painted.push(`fill:${text}`);
  }
}

function region(overrides: Partial<MemeTextRegion> = {}): MemeTextRegion {
  return {
    id: "caption",
    text: "one two three four five",
    x: 0,
    y: 0,
    width: 0.25,
    height: 0.25,
    align: "center",
    valign: "middle",
    max_lines: 2,
    max_chars: 120,
    font: { family: "Impact", min_size: 20, max_size: 20, stroke_ratio: 0.12 },
    ...overrides,
  };
}

test("renderer transforms text and reports line-limit truncation", () => {
  const ctx = new TestCanvasContext() as unknown as CanvasRenderingContext2D;
  const diagnostics = measureMemeTextRegion(ctx, 400, 400, region());

  assert.deepEqual(diagnostics.lines, ["ONE TWO", "THRE..."]);
  assert.equal(diagnostics.fontSize, 20);
  assert.equal(diagnostics.truncated, true);
  assert.equal(diagnostics.charLimitExceeded, false);
  assert.equal(diagnostics.overflowed, false);
});

test("renderer flags an unrenderable glyph that cannot fit at its minimum font size", () => {
  const ctx = new TestCanvasContext(100) as unknown as CanvasRenderingContext2D;
  const diagnostics = measureMemeTextRegion(
    ctx,
    100,
    100,
    region({ text: "W", width: 0.2, height: 0.2, max_lines: 1 })
  );

  assert.equal(diagnostics.widthOverflow, true);
  assert.equal(diagnostics.overflowed, true);
});

test("overlay drawing returns aggregate diagnostics and paints transformed copy", () => {
  const canvas = new TestCanvasContext();
  const diagnostics = drawMemeTextOverlay(
    canvas as unknown as CanvasRenderingContext2D,
    400,
    400,
    {
      regions: [
        region({ text: "mocking case", text_transform: "mocking", max_lines: 3 }),
        region({ id: "limited", text: "too much text", max_chars: 3 }),
      ],
    }
  );

  assert.equal(diagnostics.regions[0].text, "MoCkInG cAsE");
  assert.equal(diagnostics.regions[1].charLimitExceeded, true);
  assert.equal(diagnostics.hasTruncation, true);
  assert.ok(canvas.painted.some((entry) => entry.startsWith("fill:MoCkInG")));
});
