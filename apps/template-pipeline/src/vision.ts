import type { PipelineConfig } from "./config.js";
import type { DownloadedImage } from "./image.js";
import type { ScrapedTemplate, VisionFacts, VisionRegionProposal } from "./types.js";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export async function extractVisionFacts(
  template: ScrapedTemplate,
  image: DownloadedImage,
  config: PipelineConfig,
  options: { allowTextOnly: boolean; fetchImpl?: typeof fetch },
): Promise<VisionFacts> {
  if (!config.openRouterApiKey) {
    if (!options.allowTextOnly) {
      throw new Error(
        "OPENROUTER_API_KEY is required for visual geometry. Pass --allow-text-only-layout only for a retrieval-scale experiment.",
      );
    }
    return textOnlyFallback(template, image);
  }
  const request = options.fetchImpl || fetch;
  return extractOpenRouterVision(template, image, config, request);
}

async function extractOpenRouterVision(
  template: ScrapedTemplate,
  image: DownloadedImage,
  config: PipelineConfig,
  request: typeof fetch,
): Promise<VisionFacts> {
  const response = await request(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.openRouterApiKey}`,
      "HTTP-Referer": "http://localhost:3001",
      "X-Title": "MemeDrop Template Pipeline",
    },
    body: JSON.stringify({
      model: config.visionModel,
      temperature: 0.1,
      max_tokens: 1400,
      reasoning: { effort: "none", exclude: true },
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Inspect meme template pixels and return JSON visual facts only. Do not infer current events or hidden biographical facts.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: visionPrompt(template, image),
            },
            {
              type: "image_url",
              image_url: {
                url: `data:${image.mime_type};base64,${Buffer.from(image.bytes).toString("base64")}`,
                detail: "high",
              },
            },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(`Vision model returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const raw = body.choices?.[0]?.message?.content;
  if (!raw) throw new Error("Vision model returned no content");
  const parsed = JSON.parse(stripFence(raw)) as Partial<VisionFacts>;
  return normalizeVisionFacts(parsed);
}

function visionPrompt(template: ScrapedTemplate, image: DownloadedImage): string {
  return `Analyze the blank meme template named ${JSON.stringify(template.name)} (${image.width}x${image.height}).

Return this JSON shape:
{
  "description": "literal visual composition",
  "subjects": ["visible subject"],
  "existing_text": ["text already printed in the image"],
  "visual_tone": ["visible emotional tone"],
  "supports_overlay": true,
  "region_proposals": [{
    "id": "semantic_snake_case_id",
    "role": "what this caption contributes",
    "x": 0.0, "y": 0.0, "width": 0.5, "height": 0.2,
    "align": "center", "valign": "middle", "max_lines": 2,
    "notes": "faces, objects, contrast, or printed text to avoid"
  }],
  "placement_risks": ["specific visual risk"]
}

Coordinates are normalized. Every box must remain within the image. Prefer 1-4 large, readable,
high-confidence regions. Avoid faces, bodies, existing printed text, logos, and the visual punchline.
Use the classic layout only when the pixels support it. If no safe useful caption area exists, set
supports_overlay=false and return no regions.`;
}

export function textOnlyFallback(
  template: ScrapedTemplate,
  image: Pick<DownloadedImage, "width" | "height">,
): VisionFacts {
  const wide = image.width / image.height >= 1.55;
  return {
    description: `Visual details for ${template.name} were not inspected by a vision model.`,
    subjects: [],
    existing_text: [],
    visual_tone: [],
    supports_overlay: true,
    region_proposals: wide
      ? [fallbackRegion("top_caption", "setup or label", 0.05, 0.04, 0.9, 0.24, "top")]
      : [
          fallbackRegion("top_caption", "setup", 0.06, 0.04, 0.88, 0.2, "top"),
          fallbackRegion("bottom_caption", "punchline", 0.06, 0.76, 0.88, 0.2, "bottom"),
        ],
    placement_risks: ["Geometry is a deterministic text-only fallback and requires visual review."],
    geometry_source: "text_only_fallback",
  };
}

function fallbackRegion(
  id: string,
  role: string,
  x: number,
  y: number,
  width: number,
  height: number,
  valign: "top" | "bottom",
): VisionRegionProposal {
  return { id, role, x, y, width, height, align: "center", valign, max_lines: 2, notes: "Unverified fallback placement." };
}

function normalizeVisionFacts(value: Partial<VisionFacts>): VisionFacts {
  const supportsOverlay = value.supports_overlay !== false;
  const proposals = supportsOverlay
    ? (Array.isArray(value.region_proposals) ? value.region_proposals : [])
        .slice(0, 8)
        .map(normalizeRegion)
    : [];
  if (supportsOverlay && !proposals.length) {
    throw new Error("Vision model claimed overlay support without a usable region");
  }
  return {
    description: boundedString(value.description, "No visual description returned.", 800),
    subjects: stringArray(value.subjects, 12),
    existing_text: stringArray(value.existing_text, 20),
    visual_tone: stringArray(value.visual_tone, 10),
    supports_overlay: supportsOverlay,
    region_proposals: proposals,
    placement_risks: stringArray(value.placement_risks, 12),
    geometry_source: "vision_model",
  };
}

function normalizeRegion(value: Partial<VisionRegionProposal>, index: number): VisionRegionProposal {
  const width = clamp(value.width, 0.04, 1, 0.8);
  const height = clamp(value.height, 0.04, 1, 0.2);
  return {
    id: snakeCase(value.id || `region_${index + 1}`),
    role: boundedString(value.role, `caption beat ${index + 1}`, 160),
    x: round(clamp(value.x, 0, 1 - width, 0.1)),
    y: round(clamp(value.y, 0, 1 - height, 0.1)),
    width: round(width),
    height: round(height),
    align: oneOf(value.align, ["left", "center", "right"], "center"),
    valign: oneOf(value.valign, ["top", "middle", "bottom"], "middle"),
    max_lines: Math.round(clamp(value.max_lines, 1, 4, 2)),
    notes: boundedString(value.notes, "", 300),
  };
}

function stringArray(value: unknown, limit: number): string[] {
  return Array.isArray(value)
    ? Array.from(new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))).slice(0, limit)
    : [];
}

function boundedString(value: unknown, fallback: string, limit: number): string {
  return (typeof value === "string" && value.trim() ? value.trim() : fallback).slice(0, limit);
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

function snakeCase(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "caption";
}

function stripFence(value: string): string {
  return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}
