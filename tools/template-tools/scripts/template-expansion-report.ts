import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import generatedManifest from "../../../shared/src/data/meme-template-manifest.generated.json";
import promotedManifest from "../../../shared/src/data/meme-template-manifest.promoted.json";
import {
  MEME_TEMPLATE_MANIFEST,
  normalizeTemplateName,
  type MemeTemplate,
  type MemeTextTemplateRegion,
} from "@memedrop/shared";

interface BenchmarkCase {
  id: string;
  expected_memes: string[];
  rejected_memes: Array<{ name: string; reason?: string }>;
}

interface BenchmarkFamily {
  name: string;
  normalized: string;
  expected_count: number;
  rejected_count: number;
  status: "verified" | "draft_only" | "missing";
  template_id?: string;
}

interface ExpansionCandidate {
  template_id: string;
  name: string;
  quality: string;
  duplicate_status: "novel" | "verified_duplicate";
  visual_warnings: string[];
  source_image?: string;
  suggested_next_step: string;
}

interface ExpansionReport {
  generated_at: string;
  summary: {
    verified_runtime_templates: number;
    generated_drafts: number;
    benchmark_families: number;
    benchmark_missing: number;
    benchmark_draft_only: number;
    novel_draft_candidates: number;
    mechanically_ready_novel_candidates: number;
  };
  benchmark_families: BenchmarkFamily[];
  expansion_candidates: ExpansionCandidate[];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..", "..", "..");
const benchmarkPath = path.join(rootDir, "tools", "template-tools", "evals", "suggestion-benchmark.json");
const args = parseArgs(process.argv.slice(2));

function main() {
  const benchmark = JSON.parse(fs.readFileSync(benchmarkPath, "utf8")) as {
    cases: BenchmarkCase[];
  };
  const generatedTemplates = generatedManifest.templates as MemeTemplate[];
  const verifiedTemplates = MEME_TEMPLATE_MANIFEST.templates.filter(
    (template) => template.supports_overlay && template.quality === "verified"
  );
  const promotedTemplates = (promotedManifest.templates as MemeTemplate[]).filter(
    (template) => template.supports_overlay && template.quality === "verified"
  );
  const runtimeVerifiedTemplates = [...verifiedTemplates, ...promotedTemplates];
  const verifiedIds = new Set(runtimeVerifiedTemplates.map((template) => template.template_id));
  const generatedDrafts = generatedTemplates.filter(
    (template) => template.supports_overlay && template.quality === "draft"
  );

  const benchmarkFamilies = benchmarkFamilyCoverage(
    benchmark.cases,
    runtimeVerifiedTemplates,
    generatedDrafts
  );
  const expansionCandidates = generatedDrafts
    .map((template): ExpansionCandidate => {
      const visualWarnings = visualWarningsForTemplate(template);
      const duplicateStatus = verifiedIds.has(template.template_id)
        ? "verified_duplicate"
        : "novel";
      return {
        template_id: template.template_id,
        name: template.name,
        quality: template.quality,
        duplicate_status: duplicateStatus,
        visual_warnings: visualWarnings,
        source_image: template.source_image,
        suggested_next_step: suggestedNextStep(duplicateStatus, visualWarnings),
      };
    })
    .filter((candidate) => {
      if (args["include-duplicates"]) return true;
      return candidate.duplicate_status === "novel";
    })
    .sort((a, b) => {
      const scoreA = candidateScore(a);
      const scoreB = candidateScore(b);
      return scoreB - scoreA || a.template_id.localeCompare(b.template_id);
    });

  const report: ExpansionReport = {
    generated_at: new Date().toISOString(),
    summary: {
      verified_runtime_templates: runtimeVerifiedTemplates.length,
      generated_drafts: generatedDrafts.length,
      benchmark_families: benchmarkFamilies.length,
      benchmark_missing: benchmarkFamilies.filter((family) => family.status === "missing").length,
      benchmark_draft_only: benchmarkFamilies.filter((family) => family.status === "draft_only").length,
      novel_draft_candidates: expansionCandidates.filter(
        (candidate) => candidate.duplicate_status === "novel"
      ).length,
      mechanically_ready_novel_candidates: expansionCandidates.filter(
        (candidate) =>
          candidate.duplicate_status === "novel" && candidate.visual_warnings.length === 0
      ).length,
    },
    benchmark_families: benchmarkFamilies,
    expansion_candidates: expansionCandidates,
  };

  const limit = Number(args.limit || 25);
  const printableReport = {
    ...report,
    expansion_candidates: report.expansion_candidates.slice(0, limit),
  };

  if (args.out) {
    const outPath = path.resolve(rootDir, String(args.out));
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (args.json) {
    console.log(JSON.stringify(printableReport, null, 2));
  } else {
    printReport(report, limit);
  }

  if (
    args["fail-on-gaps"] &&
    (report.summary.benchmark_missing > 0 || report.summary.benchmark_draft_only > 0)
  ) {
    process.exitCode = 1;
  }
}

function benchmarkFamilyCoverage(
  cases: BenchmarkCase[],
  verifiedTemplates: MemeTemplate[],
  draftTemplates: MemeTemplate[]
): BenchmarkFamily[] {
  const familyCounts = new Map<
    string,
    { name: string; expected_count: number; rejected_count: number }
  >();

  for (const testCase of cases) {
    for (const name of testCase.expected_memes || []) {
      const normalized = normalizeTemplateName(name);
      const current = familyCounts.get(normalized) || {
        name,
        expected_count: 0,
        rejected_count: 0,
      };
      current.expected_count += 1;
      familyCounts.set(normalized, current);
    }

    for (const rejected of testCase.rejected_memes || []) {
      const normalized = normalizeTemplateName(rejected.name);
      const current = familyCounts.get(normalized) || {
        name: rejected.name,
        expected_count: 0,
        rejected_count: 0,
      };
      current.rejected_count += 1;
      familyCounts.set(normalized, current);
    }
  }

  return Array.from(familyCounts.entries())
    .map(([normalized, counts]) => {
      const verified = findTemplateByName(counts.name, verifiedTemplates);
      if (verified) {
        return {
          name: counts.name,
          normalized,
          expected_count: counts.expected_count,
          rejected_count: counts.rejected_count,
          status: "verified" as const,
          template_id: verified.template_id,
        };
      }

      const draft = findTemplateByName(counts.name, draftTemplates);
      return {
        name: counts.name,
        normalized,
        expected_count: counts.expected_count,
        rejected_count: counts.rejected_count,
        status: draft ? ("draft_only" as const) : ("missing" as const),
        template_id: draft?.template_id,
      };
    })
    .sort((a, b) => {
      const countA = a.expected_count + a.rejected_count;
      const countB = b.expected_count + b.rejected_count;
      return countB - countA || a.name.localeCompare(b.name);
    });
}

function findTemplateByName(name: string, templates: MemeTemplate[]): MemeTemplate | null {
  const normalized = normalizeTemplateName(name);
  for (const template of templates) {
    const names = [template.name, ...template.aliases, template.template_id].map(normalizeTemplateName);
    if (names.some((candidate) => candidate === normalized)) return template;
  }
  return null;
}

function visualWarningsForTemplate(template: MemeTemplate): string[] {
  const warnings: string[] = [];
  if (!template.source_image) warnings.push("missing source_image");
  if (template.regions.length === 0) warnings.push("missing overlay regions");

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
      if (!region) {
        warnings.push(`example ${exampleIndex + 1}/${regionId}: unknown region`);
        continue;
      }
      const fit = estimateTextFit(region, String(text));
      if (fit) warnings.push(`example ${exampleIndex + 1}/${regionId}: ${fit}`);
    }
  }

  return warnings;
}

function suggestedNextStep(
  duplicateStatus: ExpansionCandidate["duplicate_status"],
  visualWarnings: string[]
): string {
  if (duplicateStatus === "verified_duplicate") {
    return "compare against the verified hand-authored template only if generated regions look better";
  }
  if (visualWarnings.length > 0) {
    return "fix region/example warnings, then render in the QA sheet";
  }
  return "render in QA, add at least one benchmark case if it represents a new joke shape, then promote";
}

function candidateScore(candidate: ExpansionCandidate): number {
  return (
    (candidate.duplicate_status === "novel" ? 100 : 0) -
    candidate.visual_warnings.length * 12
  );
}

function estimateRegionCapacity(region: MemeTextTemplateRegion): number {
  const widthPx = region.width * 1000;
  const heightPx = region.height * 833;
  const padding = Math.max(4, Math.min(widthPx, heightPx) * 0.055);
  const safeWidth = Math.max(8, widthPx - padding * 2);
  const safeHeight = Math.max(8, heightPx - padding * 2);
  const lineCount = Math.max(1, Math.min(region.max_lines, Math.floor(safeHeight / (region.font.min_size * 1.08))));
  return lineCount * (safeWidth / (region.font.min_size * 0.62));
}

function estimateTextFit(region: MemeTextTemplateRegion, rawText: string): string | null {
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

function printReport(report: ExpansionReport, limit: number) {
  console.log("MemeDrop template expansion report");
  console.log(
    `verified=${report.summary.verified_runtime_templates} generatedDrafts=${report.summary.generated_drafts} ` +
      `benchmarkFamilies=${report.summary.benchmark_families} missing=${report.summary.benchmark_missing} ` +
      `draftOnly=${report.summary.benchmark_draft_only} novelDrafts=${report.summary.novel_draft_candidates} ` +
      `readyNovel=${report.summary.mechanically_ready_novel_candidates}`
  );

  const gaps = report.benchmark_families.filter((family) => family.status !== "verified");
  if (gaps.length > 0) {
    console.log("\nBenchmark coverage gaps");
    for (const gap of gaps) {
      console.log(
        `- ${gap.name} [${gap.status}] expected=${gap.expected_count} rejected=${gap.rejected_count}` +
          (gap.template_id ? ` template=${gap.template_id}` : "")
      );
    }
  }

  console.log(`\nTop expansion candidates (${Math.min(limit, report.expansion_candidates.length)} of ${report.expansion_candidates.length})`);
  for (const candidate of report.expansion_candidates.slice(0, limit)) {
    console.log(
      `- ${candidate.template_id} [${candidate.duplicate_status}, warnings=${candidate.visual_warnings.length}] ${candidate.name}`
    );
    for (const warning of candidate.visual_warnings.slice(0, 2)) {
      console.log(`  warning: ${warning}`);
    }
    console.log(`  next: ${candidate.suggested_next_step}`);
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
