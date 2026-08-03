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

interface BenchmarkFile {
  cases?: BenchmarkCase[];
}

interface CasePack {
  source_templates?: Array<{
    template_id?: string;
    name?: string;
  }>;
  cases?: BenchmarkCase[];
}

interface Finding {
  case_id?: string;
  message: string;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..", "..", "..");
const args = parseArgs(process.argv.slice(2));
const inputPath = path.resolve(
  rootDir,
  String(args.file || ".memedrop/suggestion-benchmark-stubs.json")
);
const benchmarkPath = path.resolve(
  rootDir,
  String(args.benchmark || path.join("tools", "template-tools", "evals", "suggestion-benchmark.json"))
);
const outPath = args.out
  ? path.resolve(rootDir, String(args.out))
  : benchmarkPath;
const shouldWrite = Boolean(args.write || args.out);
const maxExpectedFamilyShare = Number(args["max-expected-family-share"] || 0.35);
const maxRejectedFamilyShare = Number(args["max-rejected-family-share"] || 0.3);

function main() {
  const existing = readBenchmarkFile(benchmarkPath);
  const pack = readCasePack(inputPath);
  const cases = pack.cases || [];
  const pendingNames = pendingTemplateNames(pack);
  const findings = validateCases(cases, existing.cases || [], pendingNames);
  findings.push(
    ...validateMergedFamilyBalance(
      [...(existing.cases || []), ...cases],
      maxExpectedFamilyShare,
      maxRejectedFamilyShare
    )
  );

  printReport(cases, findings, pendingNames);

  if (findings.length > 0) {
    process.exitCode = 1;
    return;
  }

  if (!shouldWrite) {
    console.log("[MemeDrop] dry run only; pass --write or --out to write imported benchmark cases.");
    return;
  }

  const nextBenchmark = {
    ...existing,
    cases: [...(existing.cases || []), ...cases],
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(nextBenchmark, null, 2)}\n`);
  console.log(`[MemeDrop] wrote ${cases.length} benchmark cases to ${path.relative(rootDir, outPath)}`);
}

function readBenchmarkFile(filePath: string): BenchmarkFile {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as BenchmarkFile;
}

function readCasePack(filePath: string): CasePack {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as CasePack | BenchmarkCase[];
  if (Array.isArray(raw)) return { cases: raw };
  return raw;
}

function pendingTemplateNames(pack: CasePack): Set<string> {
  const names = new Set<string>();
  for (const template of pack.source_templates || []) {
    if (template.name) names.add(normalizeTemplateName(template.name));
    if (template.template_id) names.add(normalizeTemplateName(template.template_id));
  }
  return names;
}

function validateCases(
  cases: BenchmarkCase[],
  existingCases: BenchmarkCase[],
  pendingNames: Set<string>
): Finding[] {
  const findings: Finding[] = [];
  const existingIds = new Set(existingCases.map((testCase) => testCase.id).filter(Boolean));
  const newIds = new Set<string>();

  if (cases.length === 0) {
    findings.push({ message: "case pack has no cases to import" });
    return findings;
  }

  for (const testCase of cases) {
    const caseId = testCase.id || "<missing-id>";
    if (!testCase.id || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(testCase.id)) {
      findings.push({ case_id: caseId, message: "id must be kebab-case" });
    } else if (existingIds.has(testCase.id)) {
      findings.push({ case_id: caseId, message: "case id already exists in benchmark" });
    } else if (newIds.has(testCase.id)) {
      findings.push({ case_id: caseId, message: "duplicate case id in import file" });
    }
    if (testCase.id) newIds.add(testCase.id);

    if (!testCase.category?.trim()) {
      findings.push({ case_id: caseId, message: "category is required" });
    }

    const tweet = testCase.tweet || "";
    if (tweet.length < 40) {
      findings.push({ case_id: caseId, message: "tweet is too short" });
    }
    if (tweet.length > 280) {
      findings.push({ case_id: caseId, message: "tweet exceeds X post length" });
    }
    if (hasPlaceholderText(tweet)) {
      findings.push({ case_id: caseId, message: "tweet still contains benchmark-stub placeholder text" });
    }

    const expected = testCase.expected_memes || [];
    const rejected = testCase.rejected_memes || [];
    const keywords = testCase.keywords || [];
    if (expected.length < 3) {
      findings.push({ case_id: caseId, message: "needs at least 3 expected meme families" });
    }
    if (rejected.length < 1) {
      findings.push({ case_id: caseId, message: "needs at least 1 rejected meme family" });
    }
    if (keywords.length < 3) {
      findings.push({ case_id: caseId, message: "needs at least 3 specificity keywords" });
    }

    const expectedSet = new Set<string>();
    for (const memeName of expected) {
      const normalized = normalizeTemplateName(memeName);
      if (expectedSet.has(normalized)) {
        findings.push({ case_id: caseId, message: `duplicate expected meme: ${memeName}` });
      }
      expectedSet.add(normalized);
      if (!pendingNames.has(normalized)) {
        assertVerifiedTemplate(findings, caseId, memeName, "expected");
      }
    }

    const rejectedSet = new Set<string>();
    for (const rejectedMeme of rejected) {
      const memeName = rejectedMeme.name || "";
      const normalized = normalizeTemplateName(memeName);
      if (!memeName) {
        findings.push({ case_id: caseId, message: "rejected meme is missing name" });
        continue;
      }
      if (rejectedSet.has(normalized)) {
        findings.push({ case_id: caseId, message: `duplicate rejected meme: ${memeName}` });
      }
      rejectedSet.add(normalized);
      if (expectedSet.has(normalized)) {
        findings.push({ case_id: caseId, message: `meme cannot be both expected and rejected: ${memeName}` });
      }
      if ((rejectedMeme.reason || "").trim().length < 20) {
        findings.push({ case_id: caseId, message: `rejected meme needs a useful reason: ${memeName}` });
      }
      if (hasPlaceholderText(rejectedMeme.reason || "")) {
        findings.push({ case_id: caseId, message: `rejected meme reason still has placeholder text: ${memeName}` });
      }
      assertVerifiedTemplate(findings, caseId, memeName, "rejected");
    }
  }

  return findings;
}

function validateMergedFamilyBalance(
  cases: BenchmarkCase[],
  maxExpectedShare: number,
  maxRejectedShare: number
): Finding[] {
  const findings: Finding[] = [];
  const expectedFamilies = new Map<string, { label: string; count: number }>();
  const rejectedFamilies = new Map<string, { label: string; count: number }>();

  for (const testCase of cases) {
    for (const memeName of testCase.expected_memes || []) {
      incrementFamily(expectedFamilies, memeName);
    }
    for (const rejectedMeme of testCase.rejected_memes || []) {
      if (rejectedMeme.name) incrementFamily(rejectedFamilies, rejectedMeme.name);
    }
  }

  validateFamilyShare(findings, expectedFamilies, cases.length, maxExpectedShare, "expected");
  validateFamilyShare(findings, rejectedFamilies, cases.length, maxRejectedShare, "rejected");

  return findings;
}

function incrementFamily(
  counts: Map<string, { label: string; count: number }>,
  label: string
) {
  const normalized = normalizeTemplateName(label);
  const current = counts.get(normalized) || { label, count: 0 };
  current.count += 1;
  counts.set(normalized, current);
}

function validateFamilyShare(
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
        message: `${role} meme family "${family.label}" appears in ${pct(share)} of merged benchmark cases; max is ${pct(maxShare)}`,
      });
    }
  }
}

function assertVerifiedTemplate(
  findings: Finding[],
  caseId: string,
  memeName: string,
  role: "expected" | "rejected"
) {
  const template = findMemeTemplate(memeName);
  if (!template) {
    findings.push({ case_id: caseId, message: `missing verified template for ${role} meme: ${memeName}` });
    return;
  }
  if (template.quality !== "verified") {
    findings.push({ case_id: caseId, message: `${role} meme is not verified: ${memeName}` });
  }
  if (!template.supports_overlay) {
    findings.push({ case_id: caseId, message: `${role} meme does not support overlays: ${memeName}` });
  }
}

function hasPlaceholderText(value: string): boolean {
  return /replace this|top-tier reply|not just a keyword match|tempting but wrong/i.test(value);
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function printReport(cases: BenchmarkCase[], findings: Finding[], pendingNames: Set<string>) {
  console.log(
    `MemeDrop benchmark case import: cases=${cases.length} pendingTemplateNames=${pendingNames.size} errors=${findings.length}`
  );
  for (const finding of findings.slice(0, 50)) {
    const target = finding.case_id ? `${finding.case_id}: ` : "";
    console.log(`ERROR ${target}${finding.message}`);
  }
  if (findings.length > 50) {
    console.log(`... ${findings.length - 50} more findings omitted`);
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
