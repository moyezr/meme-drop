import assert from "node:assert/strict";
import test from "node:test";

import { normalizeRegion } from "../src/annotation-normalization";
import type { RegionAnnotation } from "../src/types";

function olderRegion(): RegionAnnotation {
  return {
    id: "top",
    role: "Setup caption",
    x: 0,
    y: 0,
    width: 1,
    height: 0.2,
    align: "center",
    valign: "top",
    max_lines: 2,
    max_chars: 30,
    font: { family: "Impact", min_size: 18, max_size: 42, stroke_ratio: 0.1 } as RegionAnnotation["font"],
  } as RegionAnnotation;
}

test("older catalog regions gain safe typography and spacing defaults", () => {
  const value = normalizeRegion(olderRegion());
  assert.deepEqual(value.font, {
    family: "Impact",
    weight: 900,
    min_size: 18,
    max_size: 42,
    fill_color: "#FFFFFF",
    stroke_color: "#000000",
    stroke_ratio: 0.1,
    line_height_ratio: 1.08,
  });
  assert.equal(value.padding_ratio, 0.055);
  assert.equal(value.text_transform, "uppercase");
});

test("normalization clamps unsafe render-contract values and keeps Anton at regular", () => {
  const region = olderRegion();
  region.padding_ratio = 3;
  region.text_transform = "unexpected" as RegionAnnotation["text_transform"];
  region.font = {
    ...region.font,
    family: "Anton",
    weight: 900,
    fill_color: "not-a-color",
    stroke_color: "#1a2b3c",
    stroke_ratio: -1,
    line_height_ratio: 4,
  };
  const value = normalizeRegion(region);
  assert.equal(value.font.family, "Anton");
  assert.equal(value.font.weight, 400);
  assert.equal(value.font.fill_color, "#FFFFFF");
  assert.equal(value.font.stroke_color, "#1A2B3C");
  assert.equal(value.font.stroke_ratio, 0);
  assert.equal(value.font.line_height_ratio, 1.5);
  assert.equal(value.padding_ratio, 0.2);
  assert.equal(value.text_transform, "uppercase");
});
