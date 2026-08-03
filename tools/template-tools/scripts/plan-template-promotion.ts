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

type ReviewStatus = "approved" | "needs_work" | "rejected";
type PlanStatus =
  | "approved_ready"
  | "approved_blocked"
  | "ready_for_review"
  | "needs_work"
  | "rejected"
  | "verified_duplicate";

interface ReviewDecision {
  template_id: string;
  status: ReviewStatus;
  benchmark_case_id?: string;
  notes?: string;
  issues?: string[];
}

interface ReviewDecisionFile {
  decisions?: ReviewDecision[];
}

interface BenchmarkCase {
  id?: string;
  category?: string;
  tweet?: string;
  expected_memes?: string[];
  rejected_memes?: Array<{ name?: string; reason?: string }>;
  keywords?: string[];
}

interface PlannedTemplate {
  template_id: string;
  name: string;
  status: PlanStatus;
  score: number;
  benchmark_case_id?: string;
  blockers: string[];
  warnings: string[];
  suggested_next_step: string;
  benchmark_stub?: BenchmarkCase;
}

interface PromotionPlan {
  generated_at: string;
  summary: {
    generated_drafts: number;
    verified_runtime_templates: number;
    reviewed_decisions: number;
    approved_ready: number;
    approved_blocked: number;
    ready_for_review: number;
    needs_work: number;
    rejected: number;
    verified_duplicates: number;
    selected_for_next_batch: number;
  };
  batch_policy: {
    max_batch_size: number;
    max_same_category: number;
  };
  selected_for_next_batch: PlannedTemplate[];
  templates: PlannedTemplate[];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..", "..", "..");
const args = parseArgs(process.argv.slice(2));
const decisionsPath = path.resolve(
  rootDir,
  String(args.file || ".memedrop/template-review-decisions.json")
);
const benchmarkPath = path.resolve(
  rootDir,
  String(args.benchmark || path.join("tools", "template-tools", "evals", "suggestion-benchmark.json"))
);
const maxBatchSize = Number(args["max-batch-size"] || 5);
const maxSameCategory = Number(args["max-same-category"] || 2);
const limit = Number(args.limit || 25);

function main() {
  const generatedDrafts = (generatedManifest.templates as MemeTemplate[]).filter(
    (template) => template.supports_overlay && template.quality === "draft"
  );
  const verifiedTemplates = MEME_TEMPLATE_MANIFEST.templates.filter(
    (template) => template.supports_overlay && template.quality === "verified"
  );
  const promotedTemplates = (promotedManifest.templates as MemeTemplate[]).filter(
    (template) => template.supports_overlay && template.quality === "verified"
  );
  const verifiedIds = new Set(verifiedTemplates.map((template) => template.template_id));
  for (const template of promotedTemplates) {
    verifiedIds.add(template.template_id);
  }
  const decisions = loadDecisions(decisionsPath);
  const decisionByTemplateId = new Map(decisions.map((decision) => [decision.template_id, decision]));
  const benchmarkCases = loadBenchmarkCases(benchmarkPath);
  const benchmarkById = new Map(
    benchmarkCases
      .filter((testCase): testCase is BenchmarkCase & { id: string } => Boolean(testCase.id))
      .map((testCase) => [testCase.id, testCase])
  );

  const templates = generatedDrafts
    .map((template) =>
      planTemplate(template, {
        decision: decisionByTemplateId.get(template.template_id),
        verifiedIds,
        benchmarkById,
      })
    )
    .sort(comparePlannedTemplates);

  const selectedForNextBatch = selectNextBatch(
    templates.filter((template) => template.status === "approved_ready"),
    maxBatchSize,
    maxSameCategory
  );

  const report: PromotionPlan = {
    generated_at: new Date().toISOString(),
    summary: {
      generated_drafts: generatedDrafts.length,
      verified_runtime_templates: verifiedTemplates.length + promotedTemplates.length,
      reviewed_decisions: decisions.length,
      approved_ready: countStatus(templates, "approved_ready"),
      approved_blocked: countStatus(templates, "approved_blocked"),
      ready_for_review: countStatus(templates, "ready_for_review"),
      needs_work: countStatus(templates, "needs_work"),
      rejected: countStatus(templates, "rejected"),
      verified_duplicates: countStatus(templates, "verified_duplicate"),
      selected_for_next_batch: selectedForNextBatch.length,
    },
    batch_policy: {
      max_batch_size: maxBatchSize,
      max_same_category: maxSameCategory,
    },
    selected_for_next_batch: selectedForNextBatch,
    templates,
  };

  if (args.out) {
    const outPath = path.resolve(rootDir, String(args.out));
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          ...report,
          templates: report.templates.slice(0, limit),
        },
        null,
        2
      )
    );
  } else {
    printReport(report, limit);
  }

  if (args["fail-on-blocked"] && report.summary.approved_blocked > 0) {
    process.exitCode = 1;
  }
}

function loadDecisions(filePath: string): ReviewDecision[] {
  if (!fs.existsSync(filePath)) return [];
  const file = JSON.parse(fs.readFileSync(filePath, "utf8")) as ReviewDecisionFile;
  return Array.isArray(file.decisions) ? file.decisions : [];
}

function loadBenchmarkCases(filePath: string): BenchmarkCase[] {
  const benchmark = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
    cases?: BenchmarkCase[];
  };
  return Array.isArray(benchmark.cases) ? benchmark.cases : [];
}

function planTemplate(
  template: MemeTemplate,
  context: {
    decision?: ReviewDecision;
    verifiedIds: Set<string>;
    benchmarkById: Map<string, BenchmarkCase>;
  }
): PlannedTemplate {
  const visualWarnings = visualWarningsForTemplate(template);
  const blockers: string[] = [];
  const warnings: string[] = [];
  const isVerifiedDuplicate = context.verifiedIds.has(template.template_id);

  if (isVerifiedDuplicate) {
    return basePlan(template, "verified_duplicate", {
      score: -100,
      warnings: ["a verified runtime template with this template_id already exists"],
      suggested_next_step: "compare visually only if this generated layout is clearly better than the existing verified template",
    });
  }

  const decision = context.decision;
  if (!decision) {
    const status = visualWarnings.length === 0 ? "ready_for_review" : "needs_work";
    return basePlan(template, status, {
      score: status === "ready_for_review" ? 60 : 10 - visualWarnings.length * 5,
      warnings: visualWarnings,
      suggested_next_step:
        status === "ready_for_review"
          ? "render in QA, add a visual review decision, and create a benchmark case if approved"
          : "fix mechanical region/example warnings before visual QA",
      benchmark_stub: status === "ready_for_review" ? benchmarkStubForTemplate(template) : undefined,
    });
  }

  if (decision.status === "rejected") {
    return basePlan(template, "rejected", {
      score: -80,
      warnings: decision.issues || [],
      suggested_next_step: "leave as draft unless a future source image or layout fixes the rejection reason",
    });
  }

  if (decision.status === "needs_work") {
    return basePlan(template, "needs_work", {
      score: 0,
      warnings: [...visualWarnings, ...(decision.issues || [])],
      suggested_next_step: "resolve the recorded issues, regenerate QA, then update the review decision",
      benchmark_case_id: decision.benchmark_case_id,
    });
  }

  if (visualWarnings.length > 0) {
    blockers.push(`mechanical warnings remain: ${visualWarnings.join("; ")}`);
  }
  if (!decision.benchmark_case_id) {
    blockers.push("approved decision is missing benchmark_case_id");
  } else {
    const benchmarkCase = context.benchmarkById.get(decision.benchmark_case_id);
    if (!benchmarkCase) {
      blockers.push(`benchmark case does not exist: ${decision.benchmark_case_id}`);
    } else if (!benchmarkCaseIncludesTemplate(benchmarkCase, template)) {
      blockers.push(`benchmark case must include "${template.name}" in expected_memes`);
    }
  }
  if ((decision.notes || "").trim().length < 20) {
    blockers.push("approved decision needs visual QA notes");
  }

  const status = blockers.length > 0 ? "approved_blocked" : "approved_ready";
  return basePlan(template, status, {
    score: status === "approved_ready" ? 100 : 35 - blockers.length * 10,
    blockers,
    warnings: visualWarnings,
    suggested_next_step:
      status === "approved_ready"
        ? "include in the next small promotion batch, then run quality:promotion and quality:suggestions"
        : "fix blockers before promotion; use the benchmark stub as the starting point if coverage is missing",
    benchmark_case_id: decision.benchmark_case_id,
    benchmark_stub: decision.benchmark_case_id && !context.benchmarkById.has(decision.benchmark_case_id)
      ? benchmarkStubForTemplate(template, decision.benchmark_case_id)
      : undefined,
  });
}

function basePlan(
  template: MemeTemplate,
  status: PlanStatus,
  overrides: Partial<PlannedTemplate>
): PlannedTemplate {
  return {
    template_id: template.template_id,
    name: template.name,
    status,
    score: overrides.score || 0,
    benchmark_case_id: overrides.benchmark_case_id,
    blockers: overrides.blockers || [],
    warnings: overrides.warnings || [],
    suggested_next_step: overrides.suggested_next_step || "",
    benchmark_stub: overrides.benchmark_stub,
  };
}

function selectNextBatch(
  approvedReady: PlannedTemplate[],
  batchSize: number,
  sameCategoryLimit: number
): PlannedTemplate[] {
  const selected: PlannedTemplate[] = [];
  const categoryCounts = new Map<string, number>();

  for (const template of approvedReady) {
    if (selected.length >= batchSize) break;
    const category = templateCategory(template);
    const count = categoryCounts.get(category) || 0;
    if (count >= sameCategoryLimit) continue;
    selected.push(template);
    categoryCounts.set(category, count + 1);
  }

  return selected;
}

function benchmarkStubForTemplate(template: MemeTemplate, id = `${template.template_id}-fit`): BenchmarkCase {
  const examples = template.caption_guidance.good_examples.flatMap((example) =>
    Object.values(example).map(String)
  );
  const keywords = Array.from(
    new Set(
      [template.name, ...template.aliases, ...examples]
        .join(" ")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length >= 4)
    )
  ).slice(0, 5);

  return {
    id,
    category: templateCategory({ template_id: template.template_id, name: template.name }),
    tweet: `Replace this with a real tweet where "${template.name}" is a top-tier reply, not just a keyword match.`,
    expected_memes: [template.name],
    keywords: keywords.length >= 3 ? keywords.slice(0, 3) : [template.name, "reaction", "context"],
    rejected_memes: [
      {
        name: "This Is Fine",
        reason: "Replace with a verified meme family that would be tempting but wrong for this joke shape.",
      },
    ],
  };
}

function benchmarkCaseIncludesTemplate(testCase: BenchmarkCase, template: MemeTemplate): boolean {
  const names = [template.name, ...template.aliases, template.template_id].map(normalizeTemplateName);
  return (testCase.expected_memes || [])
    .map(normalizeTemplateName)
    .some((expected) => names.includes(expected));
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

function countStatus(templates: PlannedTemplate[], status: PlanStatus): number {
  return templates.filter((template) => template.status === status).length;
}

function comparePlannedTemplates(a: PlannedTemplate, b: PlannedTemplate): number {
  return b.score - a.score || a.template_id.localeCompare(b.template_id);
}

function templateCategory(template: Pick<PlannedTemplate, "template_id" | "name">): string {
  const value = `${template.template_id} ${template.name}`.toLowerCase();
  if (/button|choice|path|draw|offer|deal|trade/.test(value)) return "choice-tradeoff";
  if (/brain|safe|wisdom|think|logic/.test(value)) return "bad-logic";
  if (/skeleton|waiting|pablo|harold|pain/.test(value)) return "waiting-pain";
  if (/pikachu|surprised|fry|pigeon|suspicious/.test(value)) return "confusion-suspicion";
  if (/cheers|laugh|oprah|celebrat/.test(value)) return "celebration-hype";
  if (/same|truth|mind|line|label/.test(value)) return "truth-labeling";
  return "general-reaction";
}

function printReport(report: PromotionPlan, printLimit: number) {
  console.log("MemeDrop template promotion plan");
  console.log(
    `drafts=${report.summary.generated_drafts} reviewed=${report.summary.reviewed_decisions} ` +
      `approvedReady=${report.summary.approved_ready} approvedBlocked=${report.summary.approved_blocked} ` +
      `readyForReview=${report.summary.ready_for_review} needsWork=${report.summary.needs_work} ` +
      `selected=${report.summary.selected_for_next_batch}`
  );

  if (report.selected_for_next_batch.length > 0) {
    console.log("\nSelected for next promotion batch");
    for (const template of report.selected_for_next_batch) {
      console.log(`- ${template.template_id} (${template.name}) benchmark=${template.benchmark_case_id}`);
    }
  }

  console.log(`\nTop planned templates (${Math.min(printLimit, report.templates.length)} of ${report.templates.length})`);
  for (const template of report.templates.slice(0, printLimit)) {
    console.log(`- ${template.template_id} [${template.status}, score=${template.score}] ${template.name}`);
    for (const blocker of template.blockers.slice(0, 2)) {
      console.log(`  blocker: ${blocker}`);
    }
    for (const warning of template.warnings.slice(0, 2)) {
      console.log(`  warning: ${warning}`);
    }
    console.log(`  next: ${template.suggested_next_step}`);
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
