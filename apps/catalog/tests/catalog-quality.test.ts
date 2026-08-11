import assert from "node:assert/strict";
import test from "node:test";

import { qualityChecks, qualityScore, relativeUpdatedAt, statusLabel } from "../src/catalog-quality";
import type { TemplateAnnotation } from "../src/types";

function annotation(): TemplateAnnotation {
  return {
    template_id: "quality-meme",
    name: "Quality Meme",
    aliases: [],
    source_image: "/memes/catalog/quality.png",
    supports_overlay: true,
    quality: "draft",
    regions: [],
    caption_guidance: { pattern: "", good_examples: [], bad_examples: [] },
    retrieval: { version: 1, joke_shapes: [], positive_hints: [], anti_hints: [] },
    editorial: { description: "", use_cases: [], anti_use_cases: [] },
  };
}

test("quality score reflects human annotation completeness", () => {
  const value = annotation();
  assert.equal(qualityScore(value), 0);
  value.editorial.description = "A visibly exasperated person reacting to an avoidable failure.";
  value.editorial.use_cases = ["avoidable failure"];
  value.editorial.anti_use_cases = ["quiet success"];
  value.caption_guidance.pattern = "Set up the confident claim, then reveal its obvious failure.";
  value.caption_guidance.good_examples = [{ top: "The plan", bottom: "The result" }];
  value.caption_guidance.bad_examples = [{ top: "Generic", bottom: "Generic" }];
  value.retrieval = {
    version: 1,
    joke_shapes: ["expectation versus reality"],
    positive_hints: ["confident plan fails"],
    anti_hints: ["uncomplicated success"],
  };
  value.regions = [
    {
      id: "top",
      role: "Confident setup",
      x: 0.1,
      y: 0.05,
      width: 0.8,
      height: 0.2,
      align: "center",
      valign: "middle",
      max_lines: 2,
      max_chars: 32,
      font: { family: "Impact", min_size: 18, max_size: 48, stroke_ratio: 0.1 },
    },
  ];
  assert.equal(qualityScore(value), 100);
  assert.ok(qualityChecks(value).every((check) => check.complete));
});

test("workflow labels and relative dates are concise", () => {
  assert.equal(statusLabel("in_review"), "In review");
  const now = new Date("2026-08-12T12:00:00Z").getTime();
  assert.equal(relativeUpdatedAt("2026-08-12T11:48:00Z", now), "12m ago");
});
