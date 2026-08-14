import type { CatalogDraft, FontAnnotation, FontFamily, FontWeight, RegionAnnotation, TemplateAnnotation, TextTransform } from "./types";

const DEFAULT_FONT: Pick<FontAnnotation, "family" | "weight" | "fill_color" | "stroke_color" | "stroke_ratio" | "line_height_ratio"> = {
  family: "Impact",
  weight: 900,
  fill_color: "#FFFFFF",
  stroke_color: "#000000",
  stroke_ratio: 0.1,
  line_height_ratio: 1.08,
};

const DEFAULT_PADDING_RATIO = 0.055;
const DEFAULT_TEXT_TRANSFORM: TextTransform = "uppercase";

/** Adds new render-contract defaults to older local drafts before they enter the editor. */
export function normalizeCatalogDraft(draft: CatalogDraft): CatalogDraft {
  return {
    ...draft,
    annotation: normalizeAnnotation(draft.annotation),
  };
}

export function normalizeAnnotation(annotation: TemplateAnnotation): TemplateAnnotation {
  return {
    ...annotation,
    regions: annotation.regions.map(normalizeRegion),
  };
}

export function normalizeRegion(region: RegionAnnotation): RegionAnnotation {
  const font = region.font ?? ({} as FontAnnotation);
  const family = normalizeFamily(font.family);
  return {
    ...region,
    padding_ratio: clampNumber(region.padding_ratio, 0, 0.2, DEFAULT_PADDING_RATIO),
    text_transform: normalizeTextTransform(region.text_transform),
    font: {
      ...font,
      family,
      weight: normalizeWeight(font.weight, family),
      fill_color: normalizeColor(font.fill_color, DEFAULT_FONT.fill_color),
      stroke_color: normalizeColor(font.stroke_color, DEFAULT_FONT.stroke_color),
      stroke_ratio: clampNumber(font.stroke_ratio, 0, 0.25, DEFAULT_FONT.stroke_ratio),
      line_height_ratio: clampNumber(font.line_height_ratio, 0.8, 1.5, DEFAULT_FONT.line_height_ratio),
    },
  };
}

function normalizeFamily(value: unknown): FontFamily {
  return value === "Anton" || value === "Inter" || value === "Impact" ? value : DEFAULT_FONT.family;
}

function normalizeWeight(value: unknown, family: FontFamily): FontWeight {
  if (family === "Anton") return 400;
  return value === 400 || value === 700 || value === 900 ? value : DEFAULT_FONT.weight;
}

function normalizeTextTransform(value: unknown): TextTransform {
  return value === "none" || value === "mocking" || value === "uppercase" ? value : DEFAULT_TEXT_TRANSFORM;
}

function normalizeColor(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : fallback;
}

function clampNumber(value: unknown, minimum: number, maximum: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, value));
}
