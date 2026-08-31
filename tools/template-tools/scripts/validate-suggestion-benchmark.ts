import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMemeTemplate, normalizeTemplateName } from "@memedrop/shared";

interface BenchmarkCase {
  id?: string;
  category?: string;
  tweet?: string;
  expected_memes?: string[];
  rejected_memes?: Array<{ name?: string; reason?: string }>;
  keywords?: string[];
}

interface Finding {
  severity: "error" | "warn";
  case_id?: string;
  message: string;
}

const MAX_SOURCE_POST_LENGTH = 20_000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..", "..", "..");
const args = parseArgs(process.argv.slice(2));
const benchmarkPath = path.resolve(
  rootDir,
  String(args.file || path.join("tools", "template-tools", "evals", "suggestion-benchmark.json"))
);
const minCases = Number(args["min-cases"] || 20);
const minCategories = Number(args["min-categories"] || 12);
const minExpectedFamilies = Number(args["min-expected-families"] || 25);
const minRejectedFamilies = Number(args["min-rejected-families"] || 8);
const maxExpectedFamilyShare = Number(args["max-expected-family-share"] || 0.35);
const maxRejectedFamilyShare = Number(args["max-rejected-family-share"] || 0.3);

main();

function main() {
  const benchmark = JSON.parse(fs.readFileSync(benchmarkPath, "utf8")) as {
    cases?: BenchmarkCase[];
  };
  const findings = validateBenchmark(benchmark.cases || []);
  printReport(benchmark.cases || [], findings);

  if (findings.some((finding) => finding.severity === "error")) {
    process.exitCode = 1;
  }
}

function validateBenchmark(cases: BenchmarkCase[]): Finding[] {
  const findings: Finding[] = [];
  const ids = new Set<string>();
  const categories = new Map<string, number>();
  const expectedFamilies = new Map<string, { label: string; count: number }>();
  const rejectedFamilies = new Map<string, { label: string; count: number }>();

  if (cases.length < minCases) {
    findings.push({
      severity: "error",
      message: `benchmark needs at least ${minCases} cases; found ${cases.length}`,
    });
  }

  for (const testCase of cases) {
    const caseId = testCase.id || "<missing-id>";
    if (!testCase.id || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(testCase.id)) {
      findings.push({ severity: "error", case_id: caseId, message: "id must be kebab-case" });
    } else if (ids.has(testCase.id)) {
      findings.push({ severity: "error", case_id: caseId, message: "duplicate case id" });
    }
    if (testCase.id) ids.add(testCase.id);

    const category = testCase.category?.trim();
    if (!category) {
      findings.push({ severity: "error", case_id: caseId, message: "category is required" });
    } else {
      categories.set(category, (categories.get(category) || 0) + 1);
    }

    const tweet = testCase.tweet || "";
    if (tweet.length < 40) {
      findings.push({ severity: "error", case_id: caseId, message: "tweet is too short" });
    }
    if (tweet.length > MAX_SOURCE_POST_LENGTH) {
      findings.push({
        severity: "error",
        case_id: caseId,
        message: "source post exceeds 20,000 characters",
      });
    }

    const expected = testCase.expected_memes || [];
    const rejected = testCase.rejected_memes || [];
    const keywords = testCase.keywords || [];
    if (expected.length < 3) {
      findings.push({ severity: "error", case_id: caseId, message: "needs at least 3 expected meme families" });
    }
    if (rejected.length < 1) {
      findings.push({ severity: "error", case_id: caseId, message: "needs at least 1 rejected meme family" });
    }
    if (keywords.length < 3) {
      findings.push({ severity: "error", case_id: caseId, message: "needs at least 3 specificity keywords" });
    }

    const expectedSet = new Set<string>();
    for (const memeName of expected) {
      const normalized = normalizeTemplateName(memeName);
      if (expectedSet.has(normalized)) {
        findings.push({ severity: "error", case_id: caseId, message: `duplicate expected meme: ${memeName}` });
      }
      expectedSet.add(normalized);
      incrementFamily(expectedFamilies, normalized, memeName);
      assertVerifiedTemplate(findings, caseId, memeName, "expected");
    }

    const rejectedSet = new Set<string>();
    for (const rejectedMeme of rejected) {
      const memeName = rejectedMeme.name || "";
      const normalized = normalizeTemplateName(memeName);
      if (!memeName) {
        findings.push({ severity: "error", case_id: caseId, message: "rejected meme is missing name" });
        continue;
      }
      if (rejectedSet.has(normalized)) {
        findings.push({ severity: "error", case_id: caseId, message: `duplicate rejected meme: ${memeName}` });
      }
      rejectedSet.add(normalized);
      if (expectedSet.has(normalized)) {
        findings.push({
          severity: "error",
          case_id: caseId,
          message: `meme cannot be both expected and rejected: ${memeName}`,
        });
      }
      if ((rejectedMeme.reason || "").trim().length < 20) {
        findings.push({ severity: "error", case_id: caseId, message: `rejected meme needs a useful reason: ${memeName}` });
      }
      incrementFamily(rejectedFamilies, normalized, memeName);
      assertVerifiedTemplate(findings, caseId, memeName, "rejected");
    }
  }

  if (categories.size < minCategories) {
    findings.push({
      severity: "error",
      message: `benchmark needs at least ${minCategories} categories; found ${categories.size}`,
    });
  }
  if (expectedFamilies.size < minExpectedFamilies) {
    findings.push({
      severity: "error",
      message: `benchmark needs at least ${minExpectedFamilies} unique expected meme families; found ${expectedFamilies.size}`,
    });
  }
  if (rejectedFamilies.size < minRejectedFamilies) {
    findings.push({
      severity: "error",
      message: `benchmark needs at least ${minRejectedFamilies} unique rejected meme families; found ${rejectedFamilies.size}`,
    });
  }

  validateFamilyBalance(findings, expectedFamilies, cases.length, maxExpectedFamilyShare, "expected");
  validateFamilyBalance(findings, rejectedFamilies, cases.length, maxRejectedFamilyShare, "rejected");

  return findings;
}

function incrementFamily(
  counts: Map<string, { label: string; count: number }>,
  normalized: string,
  label: string
) {
  const current = counts.get(normalized) || { label, count: 0 };
  current.count += 1;
  counts.set(normalized, current);
}

function assertVerifiedTemplate(
  findings: Finding[],
  caseId: string,
  memeName: string,
  role: "expected" | "rejected"
) {
  const template = findMemeTemplate(memeName);
  if (!template) {
    findings.push({ severity: "error", case_id: caseId, message: `missing verified template for ${role} meme: ${memeName}` });
    return;
  }
  if (template.quality !== "verified") {
    findings.push({ severity: "error", case_id: caseId, message: `${role} meme is not verified: ${memeName}` });
  }
  if (!template.supports_overlay) {
    findings.push({ severity: "error", case_id: caseId, message: `${role} meme does not support overlays: ${memeName}` });
  }
}

function validateFamilyBalance(
  findings: Finding[],
  families: Map<string, { label: string; count: number }>,
  totalCases: number,
  maxShare: number,
  role: "expected" | "rejected"
) {
  if (totalCases === 0) return;
  for (const family of families.values()) {
    const share = family.count / totalCases;
    if (share > maxShare) {
      findings.push({
        severity: "error",
        message: `${role} meme family "${family.label}" appears in ${pct(share)} of cases; max is ${pct(maxShare)}`,
      });
    }
  }
}

function printReport(cases: BenchmarkCase[], findings: Finding[]) {
  const errors = findings.filter((finding) => finding.severity === "error").length;
  const warnings = findings.filter((finding) => finding.severity === "warn").length;
  const categories = new Set(cases.map((testCase) => testCase.category).filter(Boolean));
  const expectedFamilies = new Set(
    cases.flatMap((testCase) => testCase.expected_memes || []).map(normalizeTemplateName)
  );
  const rejectedFamilies = new Set(
    cases.flatMap((testCase) => testCase.rejected_memes || []).map((item) => normalizeTemplateName(item.name || ""))
  );

  console.log(
    `MemeDrop suggestion benchmark audit: cases=${cases.length} categories=${categories.size} ` +
      `expectedFamilies=${expectedFamilies.size} rejectedFamilies=${rejectedFamilies.size} errors=${errors} warnings=${warnings}`
  );

  for (const finding of findings.slice(0, 50)) {
    const target = finding.case_id ? `${finding.case_id}: ` : "";
    console.log(`${finding.severity.toUpperCase()} ${target}${finding.message}`);
  }
  if (findings.length > 50) {
    console.log(`... ${findings.length - 50} more findings omitted`);
  }
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
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
