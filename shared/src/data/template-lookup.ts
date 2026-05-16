import { MEME_TEMPLATE_MANIFEST } from "./meme-template-manifest.js";
import generatedManifest from "./meme-template-manifest.generated.json";
import type { MemeTemplate } from "../types/template-manifest.js";

const templates = MEME_TEMPLATE_MANIFEST.templates.filter(
  (template) => template.supports_overlay && template.quality !== "disabled"
);
const generatedTemplates = (generatedManifest.templates as MemeTemplate[]).filter(
  (template) => template.supports_overlay && template.quality !== "disabled"
);
const runtimeTemplates = [...templates, ...generatedTemplates];

export function findMemeTemplate(name: string): MemeTemplate | null {
  const normalizedName = normalizeTemplateName(name);
  if (!normalizedName) return null;

  let best: MemeTemplate | null = null;
  let bestScore = 0;

  for (const template of runtimeTemplates) {
    const candidates = [template.name, ...template.aliases, template.template_id];
    for (const candidate of candidates) {
      const score = matchScore(normalizedName, normalizeTemplateName(candidate));
      if (score > bestScore) {
        best = template;
        bestScore = score;
      }
    }
  }

  return bestScore >= 0.82 ? best : null;
}

export function normalizeTemplateName(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function matchScore(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) {
    return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  }

  const aTokens = new Set(a.split(" "));
  const bTokens = new Set(b.split(" "));
  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap++;
  }
  return overlap / Math.max(aTokens.size, bTokens.size);
}
