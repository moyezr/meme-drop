import assert from "node:assert/strict";
import test from "node:test";

import { prioritizeCatalogDrafts } from "../src/catalog-priority";
import type { CatalogDraft, ScaleReviewPlan } from "../src/types";

function draft(templateId: string): CatalogDraft {
  return {
    id: templateId,
    template_id: templateId,
    name: templateId,
    status: "draft",
    asset_path: `/memes/${templateId}.jpg`,
    thumbnail_path: null,
    source_url: null,
    revision: 1,
    created_at: "2026-08-18T00:00:00Z",
    updated_at: "2026-08-18T00:00:00Z",
    annotation: {
      template_id: templateId,
      name: templateId,
      aliases: [],
      source_image: `/memes/${templateId}.jpg`,
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
    },
  };
}

const plan: ScaleReviewPlan = {
  version: 1,
  generated_at: "2026-08-18T00:00:00Z",
  summary: { templates: 3 },
  queue: [
    {
      priority: 10,
      lane: "novel",
      template_id: "low",
      name: "low",
      semantic_model: "gemini",
      source_rank: 2,
      benchmark_expected_hits: 0,
      shortlist_appearances: 0,
      top_5_appearances: 0,
      verified_family_match: null,
      mechanical_warnings: [],
      reasons: [],
    },
    {
      priority: 100,
      lane: "benchmark_family",
      template_id: "high",
      name: "high",
      semantic_model: "gemini",
      source_rank: 1,
      benchmark_expected_hits: 2,
      shortlist_appearances: 1,
      top_5_appearances: 1,
      verified_family_match: "Known",
      mechanical_warnings: ["inspect alias"],
      reasons: [],
    },
  ],
};

test("catalog priority sorts planned drafts first", () => {
  assert.deepEqual(
    prioritizeCatalogDrafts([draft("low"), draft("unplanned"), draft("high")], plan, "")
      .map((item) => item.template_id),
    ["high", "low", "unplanned"],
  );
});

test("catalog priority filters by lane and warnings", () => {
  const drafts = [draft("low"), draft("high")];
  assert.deepEqual(
    prioritizeCatalogDrafts(drafts, plan, "benchmark_family").map((item) => item.template_id),
    ["high"],
  );
  assert.deepEqual(
    prioritizeCatalogDrafts(drafts, plan, "warnings").map((item) => item.template_id),
    ["high"],
  );
});
