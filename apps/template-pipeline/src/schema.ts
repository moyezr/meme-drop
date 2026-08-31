import type { ErrorObject, ValidateFunction } from "ajv";
import Ajv2020 from "ajv/dist/2020.js";

import type { MemeTemplateDraft } from "./types.js";

const stringList = (minItems: number, maxItems: number) => ({
  type: "array",
  minItems,
  maxItems,
  uniqueItems: true,
  items: { type: "string", minLength: 2, maxLength: 240 },
});

const exampleSchema = {
  type: "object",
  minProperties: 1,
  maxProperties: 8,
  additionalProperties: { type: "string", minLength: 1, maxLength: 90 },
};

export const MEME_TEMPLATE_DRAFT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://memedrop.local/schemas/meme-template-draft-v2.json",
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "template_id",
    "name",
    "aliases",
    "source_image",
    "image_width",
    "image_height",
    "image_aspect_ratio",
    "supports_overlay",
    "quality",
    "regions",
    "caption_guidance",
    "retrieval",
    "editorial",
    "safety",
    "source",
    "annotation_meta",
  ],
  properties: {
    schema_version: { const: 2 },
    template_id: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$", maxLength: 120 },
    name: { type: "string", minLength: 2, maxLength: 120 },
    aliases: stringList(1, 12),
    source_image: { type: "string", pattern: "^/memes/catalog/scraped/imgflip/" },
    image_width: { type: "integer", minimum: 32, maximum: 12000 },
    image_height: { type: "integer", minimum: 32, maximum: 12000 },
    image_aspect_ratio: { type: "number", exclusiveMinimum: 0, maximum: 20 },
    supports_overlay: { type: "boolean" },
    quality: { const: "draft" },
    regions: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id", "role", "x", "y", "width", "height", "align", "valign",
          "max_lines", "max_chars", "padding_ratio", "text_transform", "font", "notes",
        ],
        properties: {
          id: { type: "string", pattern: "^[a-z0-9]+(?:_[a-z0-9]+)*$", maxLength: 80 },
          role: { type: "string", minLength: 8, maxLength: 160 },
          x: { type: "number", minimum: 0, maximum: 1 },
          y: { type: "number", minimum: 0, maximum: 1 },
          width: { type: "number", minimum: 0.04, maximum: 1 },
          height: { type: "number", minimum: 0.04, maximum: 1 },
          align: { enum: ["left", "center", "right"] },
          valign: { enum: ["top", "middle", "bottom"] },
          max_lines: { type: "integer", minimum: 1, maximum: 4 },
          max_chars: { type: "integer", minimum: 8, maximum: 90 },
          padding_ratio: { type: "number", minimum: 0, maximum: 0.2 },
          text_transform: { enum: ["uppercase", "none", "mocking"] },
          font: {
            type: "object",
            additionalProperties: false,
            required: [
              "family", "weight", "min_size", "max_size", "fill_color", "stroke_color",
              "stroke_ratio", "line_height_ratio",
            ],
            properties: {
              family: { enum: ["Impact", "Anton", "Inter"] },
              weight: { enum: [400, 700, 900] },
              min_size: { type: "integer", minimum: 10, maximum: 96 },
              max_size: { type: "integer", minimum: 10, maximum: 120 },
              fill_color: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
              stroke_color: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
              stroke_ratio: { type: "number", minimum: 0, maximum: 0.25 },
              line_height_ratio: { type: "number", minimum: 0.8, maximum: 1.5 },
            },
          },
          notes: { type: "string", maxLength: 300 },
        },
      },
    },
    caption_guidance: {
      type: "object",
      additionalProperties: false,
      required: ["pattern", "good_examples", "bad_examples"],
      properties: {
        pattern: { type: "string", minLength: 20, maxLength: 600 },
        good_examples: { type: "array", minItems: 2, maxItems: 3, items: exampleSchema },
        bad_examples: { type: "array", minItems: 1, maxItems: 3, items: exampleSchema },
      },
    },
    retrieval: {
      type: "object",
      additionalProperties: false,
      required: ["version", "joke_shapes", "positive_hints", "anti_hints"],
      properties: {
        version: { const: 1 },
        joke_shapes: stringList(1, 6),
        positive_hints: stringList(3, 12),
        anti_hints: stringList(3, 12),
      },
    },
    editorial: {
      type: "object",
      additionalProperties: false,
      required: [
        "description", "canonical_meaning", "use_cases", "anti_use_cases", "tone_tags",
        "trend_notes", "freshness",
      ],
      properties: {
        description: { type: "string", minLength: 20, maxLength: 800 },
        canonical_meaning: { type: "string", minLength: 20, maxLength: 600 },
        use_cases: stringList(3, 12),
        anti_use_cases: stringList(3, 12),
        tone_tags: stringList(1, 8),
        trend_notes: stringList(0, 6),
        freshness: { enum: ["evergreen", "current", "saturated", "unknown"] },
      },
    },
    safety: {
      type: "object",
      additionalProperties: false,
      required: ["sensitive_topics", "brand_risks"],
      properties: {
        sensitive_topics: stringList(0, 8),
        brand_risks: stringList(0, 8),
      },
    },
    source: {
      type: "object",
      additionalProperties: false,
      required: ["provider", "source_id", "source_url", "page_url", "content_sha256"],
      properties: {
        provider: { const: "imgflip" },
        source_id: { type: "string", minLength: 2, maxLength: 120 },
        source_url: { type: "string", format: "uri" },
        page_url: { type: "string", format: "uri" },
        content_sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
      },
    },
    annotation_meta: {
      type: "object",
      additionalProperties: false,
      required: [
        "status", "requires_human_review", "semantic_model", "vision_model",
        "geometry_source", "prompt_version", "input_sha256", "generated_at",
      ],
      properties: {
        status: { const: "machine_generated" },
        requires_human_review: { const: true },
        semantic_model: { type: "string", minLength: 3, maxLength: 160 },
        vision_model: { type: ["string", "null"], maxLength: 160 },
        geometry_source: { enum: ["vision_model", "text_only_fallback"] },
        prompt_version: { type: "string", minLength: 3, maxLength: 80 },
        input_sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
        generated_at: { type: "string", format: "date-time" },
      },
    },
  },
} as const;

const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
const validate = ajv.compile(MEME_TEMPLATE_DRAFT_SCHEMA) as ValidateFunction<MemeTemplateDraft>;

export function validateTemplateDraft(value: unknown): MemeTemplateDraft {
  if (!validate(value)) {
    throw new Error(`Invalid template annotation: ${formatErrors(validate.errors)}`);
  }
  const template = value as MemeTemplateDraft;
  for (const region of template.regions) {
    if (region.x + region.width > 1.0001 || region.y + region.height > 1.0001) {
      throw new Error(`Invalid template annotation: region ${region.id} leaves the image`);
    }
    if (region.font.min_size > region.font.max_size) {
      throw new Error(`Invalid template annotation: region ${region.id} has reversed font bounds`);
    }
  }
  const regionIds = new Set(template.regions.map((region) => region.id));
  const regionById = new Map(template.regions.map((region) => [region.id, region]));
  if (regionIds.size !== template.regions.length) {
    throw new Error("Invalid template annotation: region ids must be unique");
  }
  for (const [kind, examples] of [
    ["good", template.caption_guidance.good_examples],
    ["bad", template.caption_guidance.bad_examples],
  ] as const) {
    for (const [index, example] of examples.entries()) {
      const unknown = Object.keys(example).filter((key) => !regionIds.has(key));
      if (unknown.length) {
        throw new Error(
          `Invalid template annotation: ${kind} example ${index + 1} has unknown regions ${unknown.join(", ")}`,
        );
      }
      if (kind === "good") {
        const missing = [...regionIds].filter((key) => !Object.hasOwn(example, key));
        if (missing.length) {
          throw new Error(
            `Invalid template annotation: good example ${index + 1} is missing regions ${missing.join(", ")}`,
          );
        }
      }
      if (kind === "good") {
        for (const [regionId, copy] of Object.entries(example)) {
          const region = regionById.get(regionId);
          if (region && copy.length > region.max_chars) {
            throw new Error(
              `Invalid template annotation: good example ${index + 1} exceeds ${regionId} max_chars`,
            );
          }
        }
      }
    }
  }
  return template;
}

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors || [])
    .slice(0, 8)
    .map((error) => `${error.instancePath || "/"} ${error.message || "is invalid"}`)
    .join("; ");
}
