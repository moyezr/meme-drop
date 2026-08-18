import assert from "node:assert/strict";
import test from "node:test";

import type { MemeTemplate } from "@memedrop/shared";

import { buildScaleReviewPlan } from "../scripts/plan-scale-review.js";

function template(id: string, name: string): MemeTemplate & {
  annotation_meta: { semantic_model: string; geometry_source: string };
} {
  return {
    template_id: id,
    name,
    aliases: [],
    supports_overlay: true,
    quality: "draft",
    regions: [{
      id: "top",
      role: "setup caption",
      x: 0.1,
      y: 0.1,
      width: 0.8,
      height: 0.2,
      align: "center",
      valign: "middle",
      max_lines: 2,
      max_chars: 30,
      font: { family: "Impact", min_size: 18, max_size: 48 },
    }],
    caption_guidance: {
      pattern: "Setup followed by a reversal.",
      good_examples: [{ top: "THE PLAN" }, { top: "THE RESULT" }],
      bad_examples: [{ top: "GENERIC" }],
    },
    retrieval: {
      version: 1,
      joke_shapes: ["expectation versus reality"],
      positive_hints: ["plan fails", "obvious reversal", "predictable outcome"],
      anti_hints: ["quiet success", "neutral update", "sincere condolence"],
    },
    annotation_meta: { semantic_model: "gemini-3.7-flash", geometry_source: "vision_model" },
  };
}

test("review plan prioritizes benchmark families and incorporates exposure and source rank", () => {
  const benchmarkTemplate = template("expected", "Expected Meme");
  const exposedTemplate = template("exposed", "Often Returned");
  const plan = buildScaleReviewPlan({
    templates: [exposedTemplate, benchmarkTemplate],
    records: [
      { source: { rank: 50 }, annotation: { template_id: "expected" } },
      { source: { rank: 1 }, annotation: { template_id: "exposed" } },
    ],
    benchmarkCases: [{ expected_memes: ["Expected Meme"] }],
    evaluationCases: [{ selected_templates: ["Often Returned", "Expected Meme"] }],
    verifiedTemplates: [],
    generatedAt: "2026-08-18T00:00:00Z",
  });

  assert.equal(plan.queue[0].template_id, "expected");
  assert.equal(plan.queue[0].lane, "benchmark_family");
  assert.equal(plan.queue[1].lane, "high_exposure");
  assert.equal(plan.queue[1].top_5_appearances, 1);
  assert.equal(plan.summary.novel_candidates, 2);
});

test("review plan flags verified-family comparisons and mechanical annotation problems", () => {
  const generated = template("generated", "Known Meme");
  generated.caption_guidance.good_examples[0] = {};
  generated.retrieval!.anti_hints = [];
  const verified = { ...template("verified", "Known Meme"), quality: "verified" as const };
  const plan = buildScaleReviewPlan({
    templates: [generated],
    records: [],
    benchmarkCases: [],
    verifiedTemplates: [verified],
    generatedAt: "2026-08-18T00:00:00Z",
  });

  assert.equal(plan.queue[0].lane, "compare_verified");
  assert.equal(plan.queue[0].verified_family_match, "Known Meme");
  assert.ok(plan.queue[0].mechanical_warnings.some((warning) => warning.includes("misses top")));
  assert.ok(plan.queue[0].mechanical_warnings.includes("fewer than 3 anti hints"));
});

test("machine aliases do not count as benchmark-family coverage", () => {
  const generated = template("unrelated", "Unrelated Canonical Name");
  generated.aliases = ["Expected Meme"];
  const verified = { ...template("verified", "Expected Meme"), quality: "verified" as const };
  const plan = buildScaleReviewPlan({
    templates: [generated],
    records: [],
    benchmarkCases: [{ expected_memes: ["Expected Meme"] }],
    verifiedTemplates: [verified],
    generatedAt: "2026-08-18T00:00:00Z",
  });

  assert.equal(plan.queue[0].benchmark_expected_hits, 0);
  assert.equal(plan.queue[0].lane, "compare_verified");
  assert.ok(plan.queue[0].mechanical_warnings.includes(
    "verified-family match comes only from a machine alias",
  ));
});
