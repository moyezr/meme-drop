import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { PipelineConfig } from "../src/config.js";
import { annotateBatch, annotationInputHash } from "../src/openrouter.js";
import { detectImage } from "../src/image.js";
import { shouldHaltProvider } from "../src/pipeline.js";
import { parseImgflipTemplatePage, scrapeImgflipTemplates } from "../src/scrape.js";
import { validateTemplateDraft } from "../src/schema.js";
import { loadState, saveState, summarizeState, writeManifest } from "../src/state.js";
import type { MemeTemplateDraft, PipelineRecord, PipelineState } from "../src/types.js";
import { extractVisionFacts } from "../src/vision.js";

test("Imgflip page parsing derives full-resolution stable source identities", () => {
  const html = `
    <div class="mt-box">
      <h3 class="mt-title"><a href="/meme/Drake-Hotline-Bling">Drake Hotline Bling</a></h3>
      <div class="mt-img-wrap"><img src="//i.imgflip.com/4/30b1gx.jpg"></div>
    </div>`;

  assert.deepEqual(parseImgflipTemplatePage(html, 40), [
    {
      provider: "imgflip",
      source_id: "30b1gx",
      name: "Drake Hotline Bling",
      source_url: "https://i.imgflip.com/30b1gx.jpg",
      thumbnail_url: "https://i.imgflip.com/4/30b1gx.jpg",
      page_url: "https://imgflip.com/meme/Drake-Hotline-Bling",
      rank: 41,
    },
  ]);
});

test("Imgflip discovery assigns contiguous ranks after source deduplication", async () => {
  const box = (id: string, name: string) => `
    <div class="mt-box">
      <h3 class="mt-title"><a href="/meme/${name}">${name}</a></h3>
      <div class="mt-img-wrap"><img src="//i.imgflip.com/4/${id}.jpg"></div>
    </div>`;
  const pages = [box("same", "First") + box("same", "Renamed"), box("next", "Second")];
  let call = 0;
  const templates = await scrapeImgflipTemplates({
    limit: 2,
    delayMs: 0,
    fetchImpl: async () => new Response(pages[call++] || "", { status: 200 }),
  });

  assert.deepEqual(templates.map(({ source_id, rank }) => ({ source_id, rank })), [
    { source_id: "same", rank: 1 },
    { source_id: "next", rank: 2 },
  ]);
});

test("image detection reads PNG and JPEG dimensions without trusting response headers", () => {
  const png = new Uint8Array(24);
  png.set([137, 80, 78, 71, 13, 10, 26, 10]);
  new DataView(png.buffer).setUint32(16, 640);
  new DataView(png.buffer).setUint32(20, 480);
  assert.deepEqual(detectImage(png), {
    mime_type: "image/png",
    extension: "png",
    width: 640,
    height: 480,
  });

  const jpeg = new Uint8Array([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);
  assert.deepEqual(detectImage(jpeg), {
    mime_type: "image/jpeg",
    extension: "jpg",
    width: 640,
    height: 480,
  });
});

test("OpenRouter Gemini Flash provides pixel-derived visual facts", async () => {
  const record = validRecord();
  const settings = config();
  let requestedUrl = "";
  let captured: Record<string, unknown> = {};
  let capturedHeaders: HeadersInit | undefined;
  const facts = await extractVisionFacts(
    record.source,
    {
      bytes: new Uint8Array([1, 2, 3]),
      content_sha256: "a".repeat(64),
      mime_type: "image/jpeg",
      extension: "jpg",
      width: 800,
      height: 600,
      resolved_url: record.source.source_url,
    },
    settings,
    {
      allowTextOnly: false,
      fetchImpl: async (input, init) => {
        requestedUrl = String(input);
        captured = JSON.parse(String(init?.body)) as Record<string, unknown>;
        capturedHeaders = init?.headers;
        return new Response(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify(record.vision) } }] }),
        );
      },
    },
  );

  assert.equal(requestedUrl, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(captured.model, "google/gemini-3.7-flash");
  assert.equal(new Headers(capturedHeaders).get("authorization"), "Bearer openrouter-test-key");
  assert.equal(facts.geometry_source, "vision_model");
});

test("draft schema enforces geometry and complete good examples", () => {
  const draft = validDraft();
  assert.equal(validateTemplateDraft(draft).quality, "draft");

  const outside = structuredClone(draft);
  outside.regions[0].x = 0.8;
  assert.throws(() => validateTemplateDraft(outside), /leaves the image/);

  const incomplete = structuredClone(draft);
  incomplete.caption_guidance.good_examples[0] = {};
  assert.throws(() => validateTemplateDraft(incomplete), /fewer than 1 properties|missing regions/);
});

test("state writes atomically and exports annotated records only", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "memedrop-pipeline-"));
  const statePath = path.join(directory, "state.json");
  const manifestPath = path.join(directory, "manifest.json");
  const record = validRecord();
  const state: PipelineState = {
    version: 1,
    records: {
      "imgflip:source-1": { ...record, stage: "annotated", annotation: validDraft() },
      "imgflip:source-2": {
        ...record,
        source: { ...record.source, source_id: "source-2", rank: 2 },
        stage: "stored",
      },
    },
  };

  await saveState(statePath, state);
  assert.deepEqual(summarizeState(await loadState(statePath)), {
    total: 2,
    discovered: 0,
    stored: 1,
    vision_ready: 0,
    annotated: 1,
    duplicate: 0,
    failed: 0,
  });
  const manifest = await writeManifest(manifestPath, state);
  assert.equal(manifest.templates.length, 1);
  assert.equal(manifest.templates[0].quality, "draft");
});

test("OpenRouter batching uses Gemini Flash and preserves vision-owned geometry", async () => {
  const record = validRecord();
  const captured: Record<string, unknown> = {};
  let requestedUrl = "";
  let capturedHeaders: HeadersInit | undefined;
  const semantic = {
    source_id: record.source.source_id,
    aliases: ["Demo alias"],
    supports_overlay: true,
    regions: validDraft().regions.map((region) => ({ ...region, x: 0.9, y: 0.9 })),
    caption_guidance: {
      ...validDraft().caption_guidance,
      good_examples: ["X".repeat(100), "WHAT COULD GO WRONG"],
      bad_examples: ["A GENERIC REACTION"],
    },
    retrieval: validDraft().retrieval,
    editorial: validDraft().editorial,
    safety: validDraft().safety,
  };
  const mockFetch: typeof fetch = async (input, init) => {
    requestedUrl = String(input);
    capturedHeaders = init?.headers;
    Object.assign(captured, JSON.parse(String(init?.body)));
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify({ annotations: [semantic] }) } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const result = await annotateBatch([record], config(), mockFetch);
  const annotation = result.get(record.source.source_id)!;

  assert.equal(requestedUrl, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(new Headers(capturedHeaders).get("authorization"), "Bearer openrouter-test-key");
  assert.equal(captured.model, "google/gemini-3.7-flash");
  assert.deepEqual(captured.reasoning, { effort: "none", exclude: true });
  assert.equal(annotation.regions[0].x, record.vision!.region_proposals[0].x);
  assert.deepEqual(Object.keys(annotation.caption_guidance.good_examples[0]), ["top_caption"]);
  assert.equal(annotation.caption_guidance.good_examples[0].top_caption.length, 36);
  assert.equal(annotation.annotation_meta.requires_human_review, true);
  assert.equal(annotation.quality, "draft");
  assert.equal(
    annotationInputHash(record, "google/gemini-3.7-flash"),
    annotation.annotation_meta.input_sha256,
  );
});

test("OpenRouter semantic refinement uses structured JSON and preserves draft invariants", async () => {
  const record = { ...validRecord(), annotation: validDraft(), stage: "annotated" as const };
  const semantic = {
    source_id: record.source.source_id,
    aliases: ["Refined alias"],
    supports_overlay: true,
    regions: validDraft().regions,
    caption_guidance: validDraft().caption_guidance,
    retrieval: validDraft().retrieval,
    editorial: validDraft().editorial,
    safety: validDraft().safety,
  };
  let requestedUrl = "";
  let captured: Record<string, unknown> = {};
  const settings = {
    ...config(),
    semanticModel: "google/gemini-3.7-flash",
  };
  const result = await annotateBatch([record], settings, async (input, init) => {
    requestedUrl = String(input);
    captured = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ annotations: [semantic] }) } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  const annotation = result.get(record.source.source_id)!;
  const responseFormat = captured.response_format as Record<string, unknown>;

  assert.equal(requestedUrl, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(responseFormat.type, "json_object");
  assert.equal(annotation.annotation_meta.semantic_model, "google/gemini-3.7-flash");
  assert.equal(annotation.annotation_meta.requires_human_review, true);
  assert.equal(annotation.quality, "draft");
  assert.equal(annotation.regions[0].x, record.vision!.region_proposals[0].x);
  assert.equal(
    annotationInputHash(record, "google/gemini-3.7-flash", "google/gemini-3.7-flash"),
    annotation.annotation_meta.input_sha256,
  );
});

test("provider-wide quota and authorization failures halt a resumable run", () => {
  assert.equal(shouldHaltProvider("OpenRouter returned 429: quota exceeded"), true);
  assert.equal(shouldHaltProvider("OpenRouter returned 402: insufficient balance"), true);
  assert.equal(shouldHaltProvider("OpenRouter returned 500: temporary upstream failure"), false);
  assert.equal(shouldHaltProvider("Invalid template annotation: missing regions"), false);
});

function config(): PipelineConfig {
  return {
    semanticModel: "google/gemini-3.7-flash",
    openRouterApiKey: "openrouter-test-key",
    visionModel: "google/gemini-3.7-flash",
    s3Endpoint: "https://s3.example.test",
    s3Region: "test",
    s3AccessKeyId: "access",
    s3SecretAccessKey: "secret",
    bucket: "meme-drop-dev",
    statePath: "/tmp/state.json",
    manifestPath: "/tmp/manifest.json",
    batchSize: 5,
    batchConcurrency: 2,
    cooldownMs: 0,
    scrapeDelayMs: 0,
  };
}

function validRecord(): PipelineRecord {
  return {
    source: {
      provider: "imgflip",
      source_id: "source-1",
      name: "Demo Template",
      source_url: "https://i.imgflip.com/source-1.jpg",
      page_url: "https://imgflip.com/meme/Demo-Template",
      rank: 1,
    },
    stage: "vision_ready",
    asset: {
      bucket: "meme-drop-dev",
      object_key: "catalog/scraped/imgflip/source-1-aaaaaaaaaaaa.jpg",
      public_path: "/memes/catalog/scraped/imgflip/source-1-aaaaaaaaaaaa.jpg",
      content_sha256: "a".repeat(64),
      mime_type: "image/jpeg",
      byte_size: 100,
      width: 800,
      height: 600,
    },
    vision: {
      description: "Two people react on opposite sides of a blank image.",
      subjects: ["two people"],
      existing_text: [],
      visual_tone: ["contrast"],
      supports_overlay: true,
      region_proposals: [
        {
          id: "top_caption",
          role: "setup that establishes the expectation",
          x: 0.1,
          y: 0.05,
          width: 0.8,
          height: 0.2,
          align: "center",
          valign: "middle",
          max_lines: 2,
          notes: "Keep clear of both faces.",
        },
      ],
      placement_risks: ["faces"],
      geometry_source: "vision_model",
    },
    attempts: 0,
    updated_at: "2026-08-17T00:00:00.000Z",
  };
}

function validDraft(): MemeTemplateDraft {
  return {
    schema_version: 2,
    template_id: "demo-template-imgflip-source-1",
    name: "Demo Template",
    aliases: ["Demo Template"],
    source_image: "/memes/catalog/scraped/imgflip/source-1-aaaaaaaaaaaa.jpg",
    image_width: 800,
    image_height: 600,
    image_aspect_ratio: 1.3333,
    supports_overlay: true,
    quality: "draft",
    regions: [
      {
        id: "top_caption",
        role: "setup that establishes the expectation",
        x: 0.1,
        y: 0.05,
        width: 0.8,
        height: 0.2,
        align: "center",
        valign: "middle",
        max_lines: 2,
        max_chars: 36,
        padding_ratio: 0.055,
        text_transform: "uppercase",
        font: {
          family: "Impact",
          weight: 900,
          min_size: 18,
          max_size: 48,
          fill_color: "#FFFFFF",
          stroke_color: "#000000",
          stroke_ratio: 0.12,
          line_height_ratio: 1.08,
        },
        notes: "Keep clear of both faces.",
      },
    ],
    caption_guidance: {
      pattern: "Set up a confident expectation and contrast it with an obviously worse outcome.",
      good_examples: [
        { top_caption: "THE SIMPLE PLAN" },
        { top_caption: "WHAT COULD GO WRONG" },
      ],
      bad_examples: [{ top_caption: "A GENERIC REACTION" }],
    },
    retrieval: {
      version: 1,
      joke_shapes: ["expectation versus reality"],
      positive_hints: ["confident plan fails", "obvious reversal", "predictable consequence"],
      anti_hints: ["quiet success", "balanced choice", "unrelated celebration"],
    },
    editorial: {
      description: "Two people react on opposite sides of a blank image.",
      canonical_meaning: "A confident expectation is contrasted with a predictably worse reality.",
      use_cases: ["a plan backfires", "confidence meets evidence", "an obvious consequence arrives"],
      anti_use_cases: ["an uncomplicated success", "a neutral announcement", "a sincere condolence"],
      tone_tags: ["sarcastic"],
      trend_notes: [],
      freshness: "unknown",
    },
    safety: { sensitive_topics: [], brand_risks: [] },
    source: {
      provider: "imgflip",
      source_id: "source-1",
      source_url: "https://i.imgflip.com/source-1.jpg",
      page_url: "https://imgflip.com/meme/Demo-Template",
      content_sha256: "a".repeat(64),
    },
    annotation_meta: {
      status: "machine_generated",
      requires_human_review: true,
      semantic_model: "google/gemini-3.7-flash",
      vision_model: "google/gemini-3.7-flash",
      geometry_source: "vision_model",
      prompt_version: "semantic-template-v6",
      input_sha256: "b".repeat(64),
      generated_at: "2026-08-17T00:00:00.000Z",
    },
  };
}
