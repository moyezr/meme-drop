import assert from "node:assert/strict";
import test from "node:test";

import { qualityChecks, qualityScore, relativeUpdatedAt, renderInputsChanged, statusLabel } from "../src/catalog-quality";
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
    editorial: {
      description: "",
      canonical_meaning: "",
      use_cases: [],
      anti_use_cases: [],
      tone_tags: [],
      trend_notes: [],
      freshness: "unknown",
    },
    safety: { sensitive_topics: [], brand_risks: [] },
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
      font: { family: "Impact", weight: 900, min_size: 18, max_size: 48, fill_color: "#FFFFFF", stroke_color: "#000000", stroke_ratio: 0.1, line_height_ratio: 1.08 },
      padding_ratio: 0.055,
      text_transform: "uppercase",
    },
  ];
  value.visual_qa = {
    status: "passed",
    render_fingerprint: "f".repeat(64),
    reviewed_region_ids: ["top"],
    reviewed_example_indexes: [0],
    reviewed_at: "2026-08-12T12:00:00Z",
  };
  assert.equal(qualityScore(value), 100);
  assert.ok(qualityChecks(value).every((check) => check.complete));
});

test("rendered QA becomes incomplete when a region or a good example has not been reviewed", () => {
  const value = annotation();
  value.regions = [
    {
      id: "top",
      role: "Short setup caption",
      x: 0,
      y: 0,
      width: 1,
      height: 0.2,
      align: "center",
      valign: "top",
      max_lines: 2,
      max_chars: 30,
      font: { family: "Impact", weight: 900, min_size: 18, max_size: 42, fill_color: "#FFFFFF", stroke_color: "#000000", stroke_ratio: 0.1, line_height_ratio: 1.08 },
      padding_ratio: 0.055,
      text_transform: "uppercase",
    },
  ];
  value.caption_guidance.good_examples = [{ top: "A short caption" }, { top: "A second caption" }];
  value.visual_qa = {
    status: "passed",
    render_fingerprint: "f".repeat(64),
    reviewed_region_ids: ["top"],
    reviewed_example_indexes: [0],
    reviewed_at: "2026-08-12T12:00:00Z",
  };
  assert.equal(qualityChecks(value).find((check) => check.id === "rendered-qa")?.complete, false);
});

test("only rendering inputs invalidate a visual QA record", () => {
  const previous = annotation();
  previous.regions = [
    {
      id: "top",
      role: "Setup copy",
      x: 0,
      y: 0,
      width: 1,
      height: 0.2,
      align: "center",
      valign: "top",
      max_lines: 2,
      max_chars: 30,
      font: { family: "Impact", weight: 900, min_size: 18, max_size: 42, fill_color: "#FFFFFF", stroke_color: "#000000", stroke_ratio: 0.1, line_height_ratio: 1.08 },
      padding_ratio: 0.055,
      text_transform: "uppercase",
    },
  ];
  previous.caption_guidance.good_examples = [{ top: "Short setup" }];
  const retrievalEdit = structuredClone(previous);
  retrievalEdit.editorial.description = "An unrelated retrieval description is not a render input.";
  assert.equal(renderInputsChanged(previous, retrievalEdit), false);

  const captionEdit = structuredClone(previous);
  captionEdit.caption_guidance.good_examples[0].top = "A changed caption";
  assert.equal(renderInputsChanged(previous, captionEdit), true);
});

test("workflow labels and relative dates are concise", () => {
  assert.equal(statusLabel("in_review"), "In review");
  const now = new Date("2026-08-12T12:00:00Z").getTime();
  assert.equal(relativeUpdatedAt("2026-08-12T11:48:00Z", now), "12m ago");
});
