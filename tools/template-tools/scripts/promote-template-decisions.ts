import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import generatedManifest from "../../../packages/shared/src/data/meme-template-manifest.generated.json";
import { MEME_TEMPLATE_MANIFEST, type MemeTemplate } from "@memedrop/shared";

type ReviewStatus = "approved" | "needs_work" | "rejected";

interface ReviewDecision {
  template_id: string;
  status: ReviewStatus;
  benchmark_case_id?: string;
  notes?: string;
}

interface ReviewDecisionFile {
  version: number;
  reviewed_at: string;
  reviewer: string;
  decisions: ReviewDecision[];
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
const outPath = path.resolve(
  rootDir,
  String(
    args.out || path.join("packages", "shared", "src", "data", "meme-template-manifest.promoted.json")
  )
);

main();

function main() {
  runDecisionValidator();

  const decisions = JSON.parse(fs.readFileSync(decisionsPath, "utf8")) as ReviewDecisionFile;
  const generatedById = new Map(
    (generatedManifest.templates as MemeTemplate[]).map((template) => [template.template_id, template])
  );
  const verifiedIds = new Set(
    MEME_TEMPLATE_MANIFEST.templates.map((template) => template.template_id)
  );
  const approvedIds = decisions.decisions
    .filter((decision) => decision.status === "approved")
    .map((decision) => decision.template_id);
  const promotedTemplates: MemeTemplate[] = [];

  for (const templateId of approvedIds) {
    const template = generatedById.get(templateId);
    if (!template) {
      fail(`Approved template is not in generated manifest: ${templateId}`);
    }
    if (verifiedIds.has(templateId) && !args["allow-duplicates"]) {
      fail(`Approved template already exists in verified runtime manifest: ${templateId}`);
    }
    if (template.quality !== "draft") {
      fail(`Approved template is not a draft candidate: ${templateId}`);
    }
    promotedTemplates.push(normalizeTypography({ ...template, quality: "verified" }));
  }

  promotedTemplates.sort((a, b) => a.template_id.localeCompare(b.template_id));

  const promotedManifest = {
    version: 1,
    generated_at: new Date().toISOString(),
    source_review: {
      file: path.relative(rootDir, decisionsPath),
      reviewed_at: decisions.reviewed_at,
      reviewer: decisions.reviewer,
      approved_count: promotedTemplates.length,
    },
    templates: promotedTemplates,
  };

  const payload = `${JSON.stringify(promotedManifest, null, 2)}\n`;
  if (args["dry-run"]) {
    console.log(payload);
    return;
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, payload);
  console.log(
    `[MemeDrop] promoted ${promotedTemplates.length} reviewed templates to ${path.relative(rootDir, outPath)}`
  );
}

/**
 * Promotion is the compatibility boundary between historical annotations and
 * runtime manifests. New records are authored with these fields, while old
 * reviewed records receive the same explicit rendering contract on export.
 */
function normalizeTypography(template: MemeTemplate): MemeTemplate {
  return {
    ...template,
    regions: template.regions.map((region) => {
      const typography = region as unknown as Record<string, unknown>;
      const font = region.font as Record<string, unknown>;
      const family = oneOf(font.family, ["Impact", "Anton", "Inter"], "Impact");
      return {
        ...region,
        padding_ratio: clampNumber(typography.padding_ratio, 0, 0.2, 0.055),
        text_transform: oneOf(typography.text_transform, ["uppercase", "none", "mocking"], "uppercase"),
        font: {
          ...font,
          family,
          weight: family === "Anton" ? 400 : oneOf(font.weight, [400, 700, 900], 900),
          fill_color: normalizeHexColor(font.fill_color, "#FFFFFF"),
          stroke_color: normalizeHexColor(font.stroke_color, "#000000"),
          stroke_ratio: clampNumber(font.stroke_ratio, 0, 0.25, 0.12),
          line_height_ratio: clampNumber(font.line_height_ratio, 0.8, 1.5, 1.08),
        },
      };
    }),
  } as MemeTemplate;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function oneOf<T extends string | number>(value: unknown, values: readonly T[], fallback: T): T {
  return values.includes(value as T) ? (value as T) : fallback;
}

function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized.toUpperCase() : fallback;
}

function runDecisionValidator() {
  const validatorPath = path.join(__dirname, "validate-template-review-decisions.ts");
  const commandArgs = [
    "--import",
    "tsx",
    validatorPath,
    "--file",
    decisionsPath,
    "--benchmark",
    benchmarkPath,
    "--require-benchmark-present",
  ];
  if (args["allow-duplicates"]) commandArgs.push("--allow-duplicates");

  const result = spawnSync(process.execPath, commandArgs, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    process.exit(result.status || 1);
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

function fail(message: string): never {
  console.error(`[MemeDrop] ${message}`);
  process.exit(1);
}
