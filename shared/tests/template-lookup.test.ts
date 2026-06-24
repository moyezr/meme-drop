import assert from "node:assert/strict";
import test from "node:test";
import generatedManifest from "../src/data/meme-template-manifest.generated.json" with {
  type: "json",
};
import promotedManifest from "../src/data/meme-template-manifest.promoted.json" with {
  type: "json",
};
import { MEME_TEMPLATE_MANIFEST } from "../src/data/meme-template-manifest.js";
import {
  findMemeTemplate,
  findMemeTemplateForCandidate,
  normalizeTemplateName,
} from "../src/data/template-lookup.js";
import type { MemeTemplate } from "../src/types/template-manifest.js";

const promotedTemplateIds = new Set(
  (promotedManifest.templates as MemeTemplate[]).map((template) => template.template_id)
);
const manualRuntimeTemplateIds = new Set(
  MEME_TEMPLATE_MANIFEST.templates.map((template) => template.template_id)
);
const generatedDraft = (generatedManifest.templates as MemeTemplate[]).find(
  (template) =>
    template.supports_overlay &&
    template.quality === "draft" &&
    !promotedTemplateIds.has(template.template_id) &&
    !manualRuntimeTemplateIds.has(template.template_id)
);
const promotedTemplates = promotedManifest.templates as MemeTemplate[];

test("normalizeTemplateName removes punctuation and normalizes whitespace", () => {
  assert.equal(
    normalizeTemplateName("  They're   The-Same Picture!! "),
    "theyre the same picture"
  );
});

test("default runtime lookup finds verified manual templates", () => {
  const template = findMemeTemplate("Drake Hotline Bling");
  assert.equal(template?.template_id, "drake-hotline-bling");
  assert.equal(template?.quality, "verified");
});

test("default runtime lookup excludes generated draft templates by name and meme id", () => {
  assert.ok(generatedDraft, "expected at least one generated draft template fixture");

  const byName = findMemeTemplate(generatedDraft.name);
  const byCandidate = findMemeTemplateForCandidate(
    generatedDraft.name,
    generatedDraft.meme_id
  );

  assert.notEqual(byName?.template_id, generatedDraft.template_id);
  assert.notEqual(byCandidate?.template_id, generatedDraft.template_id);
});

test("promoted manifest only contains verified runtime templates", () => {
  for (const template of promotedTemplates) {
    assert.equal(template.supports_overlay, true);
    assert.equal(template.quality, "verified");
  }
});

test("review lookup can include generated draft templates explicitly", () => {
  assert.ok(generatedDraft, "expected at least one generated draft template fixture");

  const template = findMemeTemplateForCandidate(
    generatedDraft.name,
    generatedDraft.meme_id,
    { includeDrafts: true }
  );

  assert.equal(template?.template_id, generatedDraft.template_id);
  assert.equal(template?.quality, "draft");
});
