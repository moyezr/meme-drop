import assert from "node:assert/strict";
import test from "node:test";
import {
  drawMemeTextOverlay,
  memeCanvasFont,
  measureMemeTextRegion,
  resolveMemeTextFont,
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

test("legacy typography resolves to the original Impact canvas declaration", () => {
  const font = resolveMemeTextFont();

  assert.deepEqual(font, {
    family: "Impact",
    weight: 900,
    fillColor: "#FFFFFF",
    strokeColor: "#000000",
    strokeRatio: 0.12,
    lineHeightRatio: 1.08,
  });
  assert.equal(
    memeCanvasFont(20, font),
    "20px Impact, Haettenschweiler, 'Arial Black', sans-serif"
  );
});

test("renderer applies catalog typography, colour, line-height, case, and zero padding", () => {
  const canvas = new TestCanvasContext();
  const diagnostics = drawMemeTextOverlay(
    canvas as unknown as CanvasRenderingContext2D,
    400,
    400,
    {
      regions: [
        region({
          text: "Keep this case",
          text_transform: "none",
          padding_ratio: 0,
          font: {
            family: "Inter",
            weight: 700,
            min_size: 20,
            max_size: 20,
            fill_color: "#12ab34",
            stroke_color: "#A1B2C3",
            stroke_ratio: 0,
            line_height_ratio: 1.3,
          },
        }),
      ],
    }
  );

  const [layout] = diagnostics.regions;
  assert.equal(layout.text, "Keep this case");
  assert.equal(layout.lineHeight, 26);
  assert.deepEqual(layout.safeBounds, { x: 0, y: 0, width: 100, height: 100 });
  assert.equal(canvas.fillStyle, "#12AB34");
  assert.equal(canvas.strokeStyle, "#A1B2C3");
  assert.equal(canvas.lineWidth, 0);
  assert.ok(canvas.painted.every((entry) => !entry.startsWith("stroke:")));
  assert.equal(canvas.font, "700 20px Inter, Arial, sans-serif");
});

test("Anton always uses its bundled 400 face and invalid values fall back safely", () => {
  const anton = resolveMemeTextFont({
    family: "Anton",
    weight: 900,
    fill_color: "orange",
    stroke_ratio: 10,
    line_height_ratio: 0.2,
  });

  assert.equal(anton.weight, 400);
  assert.equal(memeCanvasFont(24, anton), "400 24px Anton, Impact, Haettenschweiler, 'Arial Black', sans-serif");
  assert.equal(anton.fillColor, "#FFFFFF");
  assert.equal(anton.strokeRatio, 0.25);
  assert.equal(anton.lineHeightRatio, 0.8);
});
