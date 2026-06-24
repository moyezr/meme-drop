import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import generatedManifest from "../../shared/src/data/meme-template-manifest.generated.json";
import { MEME_TEMPLATE_MANIFEST, type MemeTemplate } from "@memedrop/shared";

type ReviewStatus = "approved" | "needs_work" | "rejected";

interface ReviewDecision {
  template_id: string;
  status: ReviewStatus;
  benchmark_case_id?: string;
  notes?: string;
  issues?: string[];
}

interface ReviewDecisionFile {
  version: number;
  reviewed_at: string;
  reviewer: string;
  decisions: ReviewDecision[];
}

interface BenchmarkCase {
  id?: string;
  expected_memes?: string[];
}

interface Finding {
  severity: "error" | "warn";
  template_id?: string;
  message: string;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..", "..");
const args = parseArgs(process.argv.slice(2));
const defaultDecisionsPath = ".memedrop/template-review-decisions.json";
const decisionsPath = path.resolve(rootDir, String(args.file || defaultDecisionsPath));
const benchmarkPath = path.resolve(
  rootDir,
  String(args.benchmark || path.join("backend", "evals", "suggestion-benchmark.json"))
);
const generatedTemplates = generatedManifest.templates as MemeTemplate[];
const verifiedIds = new Set(MEME_TEMPLATE_MANIFEST.templates.map((template) => template.template_id));
const generatedDrafts = generatedTemplates.filter(
  (template) => template.supports_overlay && template.quality === "draft"
);
const draftById = new Map(generatedDrafts.map((template) => [template.template_id, template]));
const benchmarkCasesById = loadBenchmarkCasesById();

function main() {
  if (!fs.existsSync(decisionsPath)) {
    console.log(`No template review decisions found at ${path.relative(rootDir, decisionsPath)}`);
    console.log(
      "Copy backend/evals/template-review-decisions.example.json to .memedrop/template-review-decisions.json after visual QA."
    );
    if (args["fail-on-missing"]) process.exitCode = 1;
    return;
  }

  const file = JSON.parse(fs.readFileSync(decisionsPath, "utf8")) as ReviewDecisionFile;
  const findings = validateDecisionFile(file);
  printReport(file, findings);

  if (findings.some((finding) => finding.severity === "error")) {
    process.exitCode = 1;
  }
}

function validateDecisionFile(file: ReviewDecisionFile): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();

  if (file.version !== 1) {
    findings.push({ severity: "error", message: "version must be 1" });
  }
  if (!file.reviewer?.trim()) {
    findings.push({ severity: "error", message: "reviewer is required" });
  }
  if (!isIsoDate(file.reviewed_at)) {
    findings.push({ severity: "error", message: "reviewed_at must be an ISO timestamp" });
  }
  if (!Array.isArray(file.decisions)) {
    findings.push({ severity: "error", message: "decisions must be an array" });
    return findings;
  }

  for (const decision of file.decisions) {
    const templateId = decision.template_id;
    if (!templateId?.trim()) {
      findings.push({ severity: "error", message: "decision is missing template_id" });
      continue;
    }
    if (seen.has(templateId)) {
      findings.push({
        severity: "error",
        template_id: templateId,
        message: "duplicate decision for template",
      });
    }
    seen.add(templateId);

    const template = draftById.get(templateId);
    if (!template) {
      findings.push({
        severity: "error",
        template_id: templateId,
        message: "template_id is not a generated draft template",
      });
      continue;
    }

    if (!isReviewStatus(decision.status)) {
      findings.push({
        severity: "error",
        template_id: templateId,
        message: "status must be approved, needs_work, or rejected",
      });
      continue;
    }

    const visualWarnings = visualWarningsForTemplate(template);
    const isVerifiedDuplicate = verifiedIds.has(templateId);
    const notesLength = decision.notes?.trim().length || 0;

    if (notesLength < 20) {
      findings.push({
        severity: "error",
        template_id: templateId,
        message: "notes must explain the visual QA decision in at least 20 characters",
      });
    }

    if (decision.status === "approved") {
      if (isVerifiedDuplicate && !args["allow-duplicates"]) {
        findings.push({
          severity: "error",
          template_id: templateId,
          message: "approved template duplicates an existing verified template",
        });
      }
      if (visualWarnings.length > 0) {
        findings.push({
          severity: "error",
          template_id: templateId,
          message: `approved template still has mechanical warnings: ${visualWarnings.join("; ")}`,
        });
      }
      if (!decision.benchmark_case_id || !isKebabCase(decision.benchmark_case_id)) {
        findings.push({
          severity: "error",
          template_id: templateId,
          message: "approved templates require a kebab-case benchmark_case_id before promotion",
        });
      } else if (
        args["require-benchmark-present"] &&
        !benchmarkCasesById.has(decision.benchmark_case_id)
      ) {
        findings.push({
          severity: "error",
          template_id: templateId,
          message: `benchmark_case_id "${decision.benchmark_case_id}" does not exist in suggestion-benchmark.json`,
        });
      } else if (args["require-benchmark-present"] && decision.benchmark_case_id) {
        const benchmarkCase = benchmarkCasesById.get(decision.benchmark_case_id);
        if (benchmarkCase && !benchmarkCaseIncludesTemplate(benchmarkCase, template)) {
          findings.push({
            severity: "error",
            template_id: templateId,
            message: `benchmark_case_id "${decision.benchmark_case_id}" must include "${template.name}" in expected_memes`,
          });
        }
      }
    } else if (!decision.issues || decision.issues.length === 0) {
      findings.push({
        severity: "error",
        template_id: templateId,
        message: `${decision.status} decisions require at least one issue`,
      });
    }
  }

  if (args["fail-on-unreviewed"]) {
    const reviewedIds = new Set(file.decisions.map((decision) => decision.template_id));
    for (const template of generatedDrafts) {
      if (verifiedIds.has(template.template_id)) continue;
      if (visualWarningsForTemplate(template).length > 0) continue;
      if (reviewedIds.has(template.template_id)) continue;
      findings.push({
        severity: "error",
        template_id: template.template_id,
        message: "mechanically ready novel draft has no visual QA decision",
      });
    }
  }

  return findings;
}

function loadBenchmarkCasesById(): Map<string, BenchmarkCase> {
  try {
    const benchmark = JSON.parse(fs.readFileSync(benchmarkPath, "utf8")) as {
      cases?: BenchmarkCase[];
    };
    return new Map(
      (benchmark.cases || [])
        .filter((testCase): testCase is BenchmarkCase & { id: string } => Boolean(testCase.id))
        .map((testCase) => [testCase.id, testCase])
    );
  } catch {
    return new Map();
  }
}

function benchmarkCaseIncludesTemplate(testCase: BenchmarkCase, template: MemeTemplate): boolean {
  const templateNames = [template.name, ...template.aliases, template.template_id].map(normalizeName);
  return (testCase.expected_memes || [])
    .map(normalizeName)
    .some((expectedName) => templateNames.includes(expectedName));
}

function printReport(file: ReviewDecisionFile, findings: Finding[]) {
  const approved = file.decisions.filter((decision) => decision.status === "approved").length;
  const needsWork = file.decisions.filter((decision) => decision.status === "needs_work").length;
  const rejected = file.decisions.filter((decision) => decision.status === "rejected").length;
  const errors = findings.filter((finding) => finding.severity === "error").length;
  const warnings = findings.filter((finding) => finding.severity === "warn").length;

  console.log(
    `MemeDrop template review decisions: reviewed=${file.decisions.length} approved=${approved} needsWork=${needsWork} rejected=${rejected} errors=${errors} warnings=${warnings}`
  );

  for (const finding of findings.slice(0, 40)) {
    const target = finding.template_id ? `${finding.template_id}: ` : "";
    console.log(`${finding.severity.toUpperCase()} ${target}${finding.message}`);
  }
  if (findings.length > 40) {
    console.log(`... ${findings.length - 40} more findings omitted`);
  }
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

function isReviewStatus(value: string): value is ReviewStatus {
  return value === "approved" || value === "needs_work" || value === "rejected";
}

function isIsoDate(value: string): boolean {
  if (!value || Number.isNaN(Date.parse(value))) return false;
  return /\d{4}-\d{2}-\d{2}T/.test(value);
}

function isKebabCase(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
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
