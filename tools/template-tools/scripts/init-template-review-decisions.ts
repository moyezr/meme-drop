import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import generatedManifest from "../../../shared/src/data/meme-template-manifest.generated.json";
import { MEME_TEMPLATE_MANIFEST, type MemeTemplate } from "@memedrop/shared";

type ReviewStatus = "approved" | "needs_work" | "rejected";

interface ReviewDecision {
  template_id: string;
  status: ReviewStatus;
  benchmark_case_id?: string;
  notes: string;
  issues?: string[];
}

interface ReviewDecisionFile {
  version: number;
  reviewed_at: string;
  reviewer: string;
  decisions: ReviewDecision[];
}

interface ReviewCandidate {
  template: MemeTemplate;
  visualWarnings: string[];
  hasVerifiedDuplicate: boolean;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..", "..", "..");
const args = parseArgs(process.argv.slice(2));
const outPath = path.resolve(
  rootDir,
  String(args.out || ".memedrop/template-review-decisions.json")
);
const scope = String(args.scope || "expansion");
const limit = Number(args.limit || 12);

main();

function main() {
  if (args.force && args.append) {
    fail("Use either --force or --append, not both.");
  }

  const existingFile = fs.existsSync(outPath) ? loadExistingDecisionFile(outPath) : null;
  if (existingFile && !args.force && !args.append && !args["dry-run"]) {
    fail(`${path.relative(rootDir, outPath)} already exists. Pass --append to add new candidates or --force to overwrite.`);
  }

  const existingIds =
    existingFile && args.append
      ? new Set(existingFile.decisions.map((decision) => decision.template_id))
      : new Set<string>();
  const candidates = selectCandidates(existingIds);
  const newDecisions = candidates.map(toDecision);
  const reviewer = String(args.reviewer || existingFile?.reviewer || "visual-qa-reviewer");
  const decisionsFile: ReviewDecisionFile = {
    version: 1,
    reviewed_at: new Date().toISOString(),
    reviewer,
    decisions: args.append && existingFile
      ? [...existingFile.decisions, ...newDecisions]
      : newDecisions,
  };
  const payload = `${JSON.stringify(decisionsFile, null, 2)}\n`;

  if (args["dry-run"]) {
    process.stdout.write(payload);
    return;
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, payload);
  console.log(
    `[MemeDrop] initialized ${newDecisions.length} new template review decisions at ${path.relative(rootDir, outPath)}`
  );
  if (args.append && existingFile) {
    console.log(`[MemeDrop] preserved ${existingFile.decisions.length} existing review decisions.`);
  }
  console.log("Edit approved templates manually after rendered QA, then add benchmark coverage before promotion.");
}

function loadExistingDecisionFile(filePath: string): ReviewDecisionFile {
  const file = JSON.parse(fs.readFileSync(filePath, "utf8")) as ReviewDecisionFile;
  if (file.version !== 1) {
    fail(`${path.relative(rootDir, filePath)} has unsupported version ${String(file.version)}.`);
  }
  if (!Array.isArray(file.decisions)) {
    fail(`${path.relative(rootDir, filePath)} must contain a decisions array.`);
  }
  return file;
}

function selectCandidates(excludedIds: Set<string>): ReviewCandidate[] {
  const verifiedIds = new Set(
    MEME_TEMPLATE_MANIFEST.templates.map((template) => template.template_id)
  );
  const generatedTemplates = generatedManifest.templates as MemeTemplate[];
  const candidates = generatedTemplates
    .filter((template) => template.supports_overlay && template.quality === "draft")
    .filter((template) => !excludedIds.has(template.template_id))
    .map((template): ReviewCandidate => {
      const visualWarnings = visualWarningsForTemplate(template);
      return {
        template,
        visualWarnings,
        hasVerifiedDuplicate: verifiedIds.has(template.template_id),
      };
    })
    .filter((candidate) => {
      if (!args["include-duplicates"] && candidate.hasVerifiedDuplicate) return false;
      if (scope === "expansion") return candidate.visualWarnings.length === 0;
      if (scope === "warnings") return candidate.visualWarnings.length > 0;
      if (scope === "all") return true;
      fail(`Unsupported scope "${scope}". Use expansion, warnings, or all.`);
    })
    .sort((a, b) => candidateScore(b) - candidateScore(a) || a.template.template_id.localeCompare(b.template.template_id));

  return limit > 0 ? candidates.slice(0, limit) : candidates;
}

function toDecision(candidate: ReviewCandidate): ReviewDecision {
  const { template, visualWarnings, hasVerifiedDuplicate } = candidate;
  if (hasVerifiedDuplicate) {
    return {
      template_id: template.template_id,
      status: "rejected",
      notes:
        "Generated draft duplicates an existing verified runtime template, so keep it out unless manual QA proves the regions are materially better.",
      issues: ["Duplicate of an existing verified template."],
    };
  }

  const issues =
    visualWarnings.length > 0
      ? visualWarnings.slice(0, 5)
      : [
          "Pending rendered QA in the contact sheet.",
          "Needs a benchmark case before approval if this adds a new joke shape.",
        ];

  return {
    template_id: template.template_id,
    status: "needs_work",
    benchmark_case_id: suggestedBenchmarkCaseId(template),
    notes:
      "Initialized from the generated draft queue. Replace this with the rendered QA outcome before changing status to approved.",
    issues,
  };
}

function candidateScore(candidate: ReviewCandidate): number {
  return (
    (candidate.hasVerifiedDuplicate ? -100 : 0) -
    candidate.visualWarnings.length * 10 +
    (candidate.template.source_image ? 5 : 0)
  );
}

function suggestedBenchmarkCaseId(template: MemeTemplate): string {
  return template.template_id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
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

function fail(message: string): never {
  console.error(`[MemeDrop] ${message}`);
  process.exit(1);
}
