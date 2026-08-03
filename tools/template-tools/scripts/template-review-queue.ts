import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import generatedManifest from "../../../packages/shared/src/data/meme-template-manifest.generated.json";
import promotedManifest from "../../../packages/shared/src/data/meme-template-manifest.promoted.json";
import {
  MEME_TEMPLATE_MANIFEST,
  normalizeTemplateName,
  type MemeTemplate,
} from "@memedrop/shared";

interface BenchmarkCase {
  expected_memes: string[];
}

interface QueueItem {
  template_id: string;
  name: string;
  quality: string;
  expected_hits: number;
  has_verified_duplicate: boolean;
  visual_warnings: string[];
  promotion_notes: string[];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..", "..", "..");
const benchmarkPath = path.join(rootDir, "tools", "template-tools", "evals", "suggestion-benchmark.json");
const args = parseArgs(process.argv.slice(2));

function main() {
  const benchmark = JSON.parse(fs.readFileSync(benchmarkPath, "utf8")) as {
    cases: BenchmarkCase[];
  };
  const expectedCounts = expectedMemeCounts(benchmark.cases);
  const verifiedIds = new Set(MEME_TEMPLATE_MANIFEST.templates.map((template) => template.template_id));
  for (const template of promotedManifest.templates as MemeTemplate[]) {
    if (template.supports_overlay && template.quality === "verified") {
      verifiedIds.add(template.template_id);
    }
  }
  const generated = generatedManifest.templates as MemeTemplate[];

  const queue = generated
    .filter((template) => template.supports_overlay && template.quality !== "disabled")
    .map((template): QueueItem => {
      const visualWarnings = visualWarningsForTemplate(template);
      const expectedHits = expectedHitsForTemplate(template, expectedCounts);
      const hasVerifiedDuplicate = verifiedIds.has(template.template_id);
      return {
        template_id: template.template_id,
        name: template.name,
        quality: template.quality,
        expected_hits: expectedHits,
        has_verified_duplicate: hasVerifiedDuplicate,
        visual_warnings: visualWarnings,
        promotion_notes: promotionNotes(template, expectedHits, hasVerifiedDuplicate, visualWarnings),
      };
    })
    .filter((item) => {
      if (!args["include-duplicates"] && item.has_verified_duplicate) return false;
      return item.expected_hits > 0 || item.visual_warnings.length > 0;
    })
    .sort((a, b) => {
      const priorityA = priorityScore(a);
      const priorityB = priorityScore(b);
      return priorityB - priorityA || a.template_id.localeCompare(b.template_id);
    });

  if (args.json) {
    console.log(JSON.stringify({ generated_at: new Date().toISOString(), queue }, null, 2));
    if (args["fail-on-items"] && queue.length > 0) {
      process.exitCode = 1;
    }
    return;
  }

  printQueue(queue, Number(args.limit || 40));
  if (args["fail-on-items"] && queue.length > 0) {
    process.exitCode = 1;
  }
}

function expectedMemeCounts(cases: BenchmarkCase[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const testCase of cases) {
    for (const name of testCase.expected_memes) {
      const normalized = normalizeTemplateName(name);
      counts.set(normalized, (counts.get(normalized) || 0) + 1);
    }
  }
  return counts;
}

function expectedHitsForTemplate(template: MemeTemplate, expectedCounts: Map<string, number>): number {
  const names = [template.name, ...template.aliases, template.template_id].map(normalizeTemplateName);
  let hits = 0;
  for (const [expected, count] of expectedCounts) {
    if (names.some((name) => name.includes(expected) || expected.includes(name))) {
      hits += count;
    }
  }
  return hits;
}

function visualWarningsForTemplate(template: MemeTemplate): string[] {
  const warnings: string[] = [];
  for (const region of template.regions) {
    if (region.font.max_size > 72) {
      warnings.push(`${region.id}: font max_size=${region.font.max_size}`);
    }
    if (region.max_chars > 42 && region.width < 0.45) {
      warnings.push(`${region.id}: max_chars=${region.max_chars} may be high for width=${region.width}`);
    }
    const capacity = estimateRegionCapacity(region);
    if (capacity < region.max_chars * 0.75) {
      warnings.push(`${region.id}: capacity ${Math.floor(capacity)} < max_chars ${region.max_chars}`);
    }
  }

  for (const [exampleIndex, example] of template.caption_guidance.good_examples.entries()) {
    for (const [regionId, text] of Object.entries(example)) {
      const region = template.regions.find((item) => item.id === regionId);
      if (!region) continue;
      const fit = estimateTextFit(region, String(text));
      if (fit) warnings.push(`example ${exampleIndex + 1}/${regionId}: ${fit}`);
    }
  }
  return warnings;
}

function promotionNotes(
  template: MemeTemplate,
  expectedHits: number,
  hasVerifiedDuplicate: boolean,
  visualWarnings: string[]
): string[] {
  const notes: string[] = [];
  if (hasVerifiedDuplicate) {
    notes.push("already has verified hand-authored template; review only if generated regions are better");
  }
  if (expectedHits > 0) {
    notes.push(`appears in ${expectedHits} expected benchmark meme slot${expectedHits === 1 ? "" : "s"}`);
  }
  if (visualWarnings.length === 0) {
    notes.push("no mechanical visual warnings; ready for rendered QA");
  } else {
    notes.push("fix visual warnings before promotion");
  }
  if (template.quality === "draft") {
    notes.push("currently excluded from runtime unless draft templates are enabled");
  }
  return notes;
}

function priorityScore(item: QueueItem): number {
  return item.expected_hits * 100 - item.visual_warnings.length * 8 - (item.has_verified_duplicate ? 12 : 0);
}

function estimateRegionCapacity(region: MemeTemplate["regions"][number]): number {
  const widthPx = region.width * 1000;
  const heightPx = region.height * 833;
  const padding = Math.max(4, Math.min(widthPx, heightPx) * 0.055);
  const safeWidth = Math.max(8, widthPx - padding * 2);
  const safeHeight = Math.max(8, heightPx - padding * 2);
  const lineCount = Math.max(1, Math.min(region.max_lines, Math.floor(safeHeight / (region.font.min_size * 1.08))));
  return lineCount * (safeWidth / (region.font.min_size * 0.62));
}

function estimateTextFit(region: MemeTemplate["regions"][number], rawText: string): string | null {
  const text = rawText.trim().toUpperCase();
  const words = text.split(/\s+/).filter(Boolean);
  const widthPx = region.width * 1000;
  const heightPx = region.height * 833;
  const padding = Math.max(4, Math.min(widthPx, heightPx) * 0.055);
  const safeWidth = Math.max(8, widthPx - padding * 2);
  const safeHeight = Math.max(8, heightPx - padding * 2);
  let fontSize = region.font.max_size;
  let lines = wrapApproxLines(words, safeWidth, fontSize, region.max_lines);

  while (
    fontSize - 0.5 >= region.font.min_size &&
    (lines.length * fontSize * 1.08 > safeHeight ||
      lines.some((line) => approximateImpactWidth(line, fontSize) > safeWidth))
  ) {
    fontSize -= 0.5;
    lines = wrapApproxLines(words, safeWidth, fontSize, region.max_lines);
  }

  const naturalLines = wrapApproxLines(words, safeWidth, fontSize, Number.POSITIVE_INFINITY);
  const warnings: string[] = [];
  if (naturalLines.length > region.max_lines) warnings.push("truncates");
  if (fontSize <= region.font.min_size + 0.5 && (text.length > 14 || words.length > 3)) {
    warnings.push(`falls to ${fontSize}px`);
  }
  return warnings.length ? warnings.join(", ") : null;
}

function wrapApproxLines(words: string[], maxWidth: number, fontSize: number, maxLines: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (approximateImpactWidth(test, fontSize) <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length <= maxLines ? lines : lines.slice(0, Math.max(1, maxLines));
}

function approximateImpactWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const char of text) {
    if (char === " ") units += 0.32;
    else if (/[ilI1|]/.test(char)) units += 0.32;
    else if (/[mwMW]/.test(char)) units += 0.92;
    else if (/[A-Z0-9]/.test(char)) units += 0.66;
    else units += 0.58;
  }
  return units * fontSize;
}

function printQueue(queue: QueueItem[], limit: number) {
  console.log(`MemeDrop template review queue: ${queue.length} templates needing benchmark or visual review`);
  if (!args["include-duplicates"]) {
    console.log("Verified duplicates hidden; pass --include-duplicates to compare generated alternatives.");
  }
  for (const item of queue.slice(0, limit)) {
    const duplicate = item.has_verified_duplicate ? "verified-duplicate" : "new";
    console.log(
      `${item.template_id} [${item.quality}, ${duplicate}, expected=${item.expected_hits}, visual=${item.visual_warnings.length}]`
    );
    for (const warning of item.visual_warnings.slice(0, 3)) {
      console.log(`  visual: ${warning}`);
    }
    for (const note of item.promotion_notes.slice(0, 2)) {
      console.log(`  note: ${note}`);
    }
  }
}

function parseArgs(rawArgs: string[]): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {};
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = rawArgs[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}

main();
