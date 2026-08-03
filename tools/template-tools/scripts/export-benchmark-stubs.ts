import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type PlanStatus =
  | "approved_ready"
  | "approved_blocked"
  | "ready_for_review"
  | "needs_work"
  | "rejected"
  | "verified_duplicate";

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
  benchmark_stub?: BenchmarkCase;
  blockers?: string[];
  warnings?: string[];
}

interface PromotionPlan {
  generated_at?: string;
  templates?: PlannedTemplate[];
}

interface BenchmarkStubExport {
  generated_at: string;
  source_plan: string;
  statuses: PlanStatus[];
  summary: {
    templates_with_stubs: number;
    cases: number;
  };
  source_templates: Array<{
    template_id: string;
    name: string;
    status: PlanStatus;
    blockers: string[];
    warnings: string[];
  }>;
  cases: BenchmarkCase[];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..", "..", "..");
const args = parseArgs(process.argv.slice(2));
const planPath = path.resolve(
  rootDir,
  String(args.plan || ".memedrop/template-promotion-plan.json")
);
const outPath = path.resolve(
  rootDir,
  String(args.out || ".memedrop/suggestion-benchmark-stubs.json")
);
const statuses = parseStatuses(String(args.status || "ready_for_review,approved_blocked"));
const limit = Number(args.limit || 50);

function main() {
  if (!fs.existsSync(planPath)) {
    fail(`Promotion plan not found at ${path.relative(rootDir, planPath)}. Run npm run dataset:promotion-plan first.`);
  }

  const plan = JSON.parse(fs.readFileSync(planPath, "utf8")) as PromotionPlan;
  const plannedTemplates = Array.isArray(plan.templates) ? plan.templates : [];
  const templatesWithStubs = plannedTemplates
    .filter((template) => statuses.includes(template.status))
    .filter((template) => template.benchmark_stub)
    .slice(0, limit);

  const output: BenchmarkStubExport = {
    generated_at: new Date().toISOString(),
    source_plan: path.relative(rootDir, planPath),
    statuses,
    summary: {
      templates_with_stubs: templatesWithStubs.length,
      cases: templatesWithStubs.length,
    },
    source_templates: templatesWithStubs.map((template) => ({
      template_id: template.template_id,
      name: template.name,
      status: template.status,
      blockers: template.blockers || [],
      warnings: template.warnings || [],
    })),
    cases: templatesWithStubs.map((template) => template.benchmark_stub as BenchmarkCase),
  };

  if (args["fail-on-empty"] && output.cases.length === 0) {
    fail("No benchmark stubs matched the requested promotion-plan statuses.");
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`);

  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(
      `[MemeDrop] exported ${output.cases.length} benchmark stubs to ${path.relative(rootDir, outPath)}`
    );
    for (const template of output.source_templates.slice(0, 20)) {
      console.log(`- ${template.template_id} [${template.status}] ${template.name}`);
    }
    if (output.source_templates.length > 20) {
      console.log(`... ${output.source_templates.length - 20} more omitted`);
    }
  }
}

function parseStatuses(value: string): PlanStatus[] {
  const parsed = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  for (const status of parsed) {
    if (!isPlanStatus(status)) {
      fail(`Invalid promotion-plan status: ${status}`);
    }
  }
  return parsed as PlanStatus[];
}

function isPlanStatus(value: string): value is PlanStatus {
  return [
    "approved_ready",
    "approved_blocked",
    "ready_for_review",
    "needs_work",
    "rejected",
    "verified_duplicate",
  ].includes(value);
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

main();
