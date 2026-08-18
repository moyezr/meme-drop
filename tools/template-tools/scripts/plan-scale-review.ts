import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MEME_TEMPLATE_MANIFEST, normalizeTemplateName, type MemeTemplate } from "@memedrop/shared";

interface PipelineTemplate extends MemeTemplate {
  editorial?: { description?: string; use_cases?: string[]; anti_use_cases?: string[] };
  annotation_meta?: { semantic_model?: string; prompt_version?: string; geometry_source?: string };
  source?: { source_id?: string };
}

interface PipelineRecord {
  source?: { rank?: number };
  annotation?: { template_id?: string };
}

interface BenchmarkCase {
  expected_memes?: string[];
}

interface EvaluationCase {
  selected_templates?: string[];
}

export interface ScaleReviewItem {
  priority: number;
  lane: "benchmark_family" | "high_exposure" | "compare_verified" | "novel";
  template_id: string;
  name: string;
  semantic_model: string;
  source_rank: number | null;
  benchmark_expected_hits: number;
  shortlist_appearances: number;
  top_5_appearances: number;
  verified_family_match: string | null;
  mechanical_warnings: string[];
  reasons: string[];
}

export interface ScaleReviewPlan {
  version: 1;
  generated_at: string;
  summary: {
    templates: number;
    benchmark_family_candidates: number;
    high_exposure_candidates: number;
    verified_family_matches: number;
    novel_candidates: number;
    templates_with_warnings: number;
  };
  queue: ScaleReviewItem[];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..", "..", "..");

export function buildScaleReviewPlan(input: {
  templates: PipelineTemplate[];
  records: PipelineRecord[];
  benchmarkCases: BenchmarkCase[];
  evaluationCases?: EvaluationCase[];
  verifiedTemplates: MemeTemplate[];
  generatedAt?: string;
}): ScaleReviewPlan {
  const sourceRanks = new Map(
    input.records.flatMap((record) => {
      const templateId = record.annotation?.template_id;
      const rank = record.source?.rank;
      return templateId && Number.isInteger(rank) ? [[templateId, Number(rank)] as const] : [];
    }),
  );
  const expectedCounts = countNames(input.benchmarkCases.flatMap((item) => item.expected_memes || []));
  const shortlistCounts = new Map<string, number>();
  const topFiveCounts = new Map<string, number>();
  for (const testCase of input.evaluationCases || []) {
    for (const [index, name] of (testCase.selected_templates || []).entries()) {
      increment(shortlistCounts, normalizeTemplateName(name));
      if (index < 5) increment(topFiveCounts, normalizeTemplateName(name));
    }
  }
  const verifiedNames = input.verifiedTemplates.flatMap((template) =>
    [template.name, ...template.aliases].map((name) => ({
      normalized: normalizeTemplateName(name),
      canonical: template.name,
    })),
  );

  const queue = input.templates.map((template): ScaleReviewItem => {
    const names = [template.name, ...template.aliases].map(normalizeTemplateName);
    const canonicalName = normalizeTemplateName(template.name);
    const benchmarkHits = sumFamilyMatches(canonicalName, expectedCounts);
    const shortlistAppearances = shortlistCounts.get(canonicalName) || 0;
    const topFiveAppearances = topFiveCounts.get(canonicalName) || 0;
    const canonicalVerifiedMatch = verifiedNames.find((candidate) =>
      sameFamily(canonicalName, candidate.normalized),
    );
    const verifiedMatch = canonicalVerifiedMatch || verifiedNames.find((candidate) =>
      names.slice(1).some((name) => sameFamily(name, candidate.normalized)),
    );
    const aliasOnlyVerifiedMatch = Boolean(verifiedMatch && !canonicalVerifiedMatch);
    const warnings = mechanicalWarnings(template, aliasOnlyVerifiedMatch);
    const sourceRank = sourceRanks.get(template.template_id) ?? null;
    const lane = reviewLane({
      benchmarkHits,
      topFiveAppearances,
      verifiedMatch: verifiedMatch?.canonical,
    });
    const priority =
      benchmarkHits * 1_000 +
      topFiveAppearances * 40 +
      shortlistAppearances * 8 +
      (sourceRank === null ? 0 : Math.max(0, 1_001 - sourceRank) / 20) +
      (verifiedMatch ? 0 : 25) -
      warnings.length * 100;
    const reasons = [
      ...(benchmarkHits ? [`expected by ${benchmarkHits} benchmark cases`] : []),
      ...(topFiveAppearances ? [`appears in ${topFiveAppearances} benchmark top-five results`] : []),
      ...(shortlistAppearances && !topFiveAppearances
        ? [`appears in ${shortlistAppearances} benchmark shortlists`]
        : []),
      ...(sourceRank !== null ? [`source popularity rank ${sourceRank}`] : []),
      ...(verifiedMatch ? [`compare with verified ${verifiedMatch.canonical}`] : ["novel family candidate"]),
      ...warnings.map((warning) => `warning: ${warning}`),
    ];
    return {
      priority: Math.round(priority * 100) / 100,
      lane,
      template_id: template.template_id,
      name: template.name,
      semantic_model: template.annotation_meta?.semantic_model || "unknown",
      source_rank: sourceRank,
      benchmark_expected_hits: benchmarkHits,
      shortlist_appearances: shortlistAppearances,
      top_5_appearances: topFiveAppearances,
      verified_family_match: verifiedMatch?.canonical || null,
      mechanical_warnings: warnings,
      reasons,
    };
  }).sort((left, right) => right.priority - left.priority || left.template_id.localeCompare(right.template_id));

  return {
    version: 1,
    generated_at: input.generatedAt || new Date().toISOString(),
    summary: {
      templates: queue.length,
      benchmark_family_candidates: queue.filter((item) => item.lane === "benchmark_family").length,
      high_exposure_candidates: queue.filter((item) => item.lane === "high_exposure").length,
      verified_family_matches: queue.filter((item) => item.verified_family_match).length,
      novel_candidates: queue.filter((item) => !item.verified_family_match).length,
      templates_with_warnings: queue.filter((item) => item.mechanical_warnings.length).length,
    },
    queue,
  };
}

function reviewLane(input: {
  benchmarkHits: number;
  topFiveAppearances: number;
  verifiedMatch?: string;
}): ScaleReviewItem["lane"] {
  if (input.benchmarkHits) return "benchmark_family";
  if (input.topFiveAppearances) return "high_exposure";
  if (input.verifiedMatch) return "compare_verified";
  return "novel";
}

function mechanicalWarnings(
  template: PipelineTemplate,
  aliasOnlyVerifiedMatch: boolean,
): string[] {
  const warnings: string[] = [];
  if (aliasOnlyVerifiedMatch) warnings.push("verified-family match comes only from a machine alias");
  if (!template.regions.length) warnings.push("no caption regions");
  const regionIds = new Set(template.regions.map((region) => region.id));
  for (const [index, example] of template.caption_guidance.good_examples.entries()) {
    const missing = [...regionIds].filter((regionId) => !Object.hasOwn(example, regionId));
    if (missing.length) warnings.push(`good example ${index + 1} misses ${missing.join(", ")}`);
    for (const [regionId, copy] of Object.entries(example)) {
      const region = template.regions.find((candidate) => candidate.id === regionId);
      if (region && copy.length > region.max_chars) {
        warnings.push(`good example ${index + 1}/${regionId} exceeds max_chars`);
      }
    }
  }
  if (!template.retrieval?.joke_shapes.length) warnings.push("no joke shapes");
  if ((template.retrieval?.positive_hints.length || 0) < 3) warnings.push("fewer than 3 positive hints");
  if ((template.retrieval?.anti_hints.length || 0) < 3) warnings.push("fewer than 3 anti hints");
  if (template.annotation_meta?.geometry_source !== "vision_model") {
    warnings.push("geometry was not produced by a vision model");
  }
  return [...new Set(warnings)];
}

function countNames(names: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const name of names) increment(counts, normalizeTemplateName(name));
  return counts;
}

function increment(counts: Map<string, number>, key: string): void {
  if (key) counts.set(key, (counts.get(key) || 0) + 1);
}

function sumFamilyMatches(name: string, counts: Map<string, number>): number {
  let total = 0;
  for (const [candidate, count] of counts) {
    if (sameFamily(name, candidate)) total += count;
  }
  return total;
}

function sameFamily(left: string, right: string): boolean {
  return Boolean(left && right && (left.includes(right) || right.includes(left)));
}

function parseArgs(values: string[]): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) parsed[key] = true;
    else { parsed[key] = next; index += 1; }
  }
  return parsed;
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const manifestPath = path.resolve(rootDir, String(args.manifest || ".memedrop/template-pipeline/manifest.json"));
  const statePath = path.resolve(rootDir, String(args.state || ".memedrop/template-pipeline/state.json"));
  const benchmarkPath = path.resolve(rootDir, String(args.benchmark || "tools/template-tools/evals/suggestion-benchmark.json"));
  const evaluationPath = args.evaluation ? path.resolve(rootDir, String(args.evaluation)) : null;
  const outPath = path.resolve(rootDir, String(args.out || ".memedrop/template-pipeline/review-plan.json"));
  const manifest = readJson(manifestPath) as { templates?: PipelineTemplate[] };
  const state = readJson(statePath) as { records?: Record<string, PipelineRecord> };
  const benchmark = readJson(benchmarkPath) as { cases?: BenchmarkCase[] };
  const evaluation = evaluationPath ? readJson(evaluationPath) as { cases?: EvaluationCase[] } : {};
  if (!Array.isArray(manifest.templates)) throw new Error("Scale manifest has no templates array.");
  if (!state.records || typeof state.records !== "object") throw new Error("Pipeline state has no records.");
  if (!Array.isArray(benchmark.cases)) throw new Error("Suggestion benchmark has no cases array.");
  const plan = buildScaleReviewPlan({
    templates: manifest.templates,
    records: Object.values(state.records),
    benchmarkCases: benchmark.cases,
    evaluationCases: evaluation.cases,
    verifiedTemplates: MEME_TEMPLATE_MANIFEST.templates,
  });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  console.log(`MemeDrop scale review plan: ${JSON.stringify(plan.summary)}`);
  console.log(`Wrote ${path.relative(rootDir, outPath)}`);
  for (const item of plan.queue.slice(0, Number(args.limit || 20))) {
    console.log(`- [${item.lane}] ${item.name} (${item.template_id}) score=${item.priority}`);
    console.log(`  ${item.reasons.join("; ")}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
