import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { findMemeTemplate } from "@memedrop/shared";

process.env.DATABASE_URL ||= "postgresql://test";

interface BenchmarkCase {
  id: string;
  category: string;
  tweet: string;
  expected_memes: string[];
  rejected_memes: Array<{ name: string; reason: string }>;
  keywords: string[];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
const rootDir = path.resolve(__dirname, "..", "..", "..");
const benchmarkPath = path.join(__dirname, "..", "evals", "suggestion-benchmark.json");
const benchmarkAuditPath = path.join(__dirname, "..", "scripts", "validate-suggestion-benchmark.ts");
const benchmark = JSON.parse(fs.readFileSync(benchmarkPath, "utf8")) as {
  cases: BenchmarkCase[];
};

test("suggestion benchmark cases have enough signal for quality evaluation", () => {
  assert.ok(Array.isArray(benchmark.cases), "benchmark cases must be an array");
  assert.ok(benchmark.cases.length >= 20, "benchmark should cover at least 20 cases");

  const ids = new Set<string>();
  for (const testCase of benchmark.cases) {
    assert.match(testCase.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `${testCase.id}: id must be kebab-case`);
    assert.equal(ids.has(testCase.id), false, `${testCase.id}: duplicate case id`);
    ids.add(testCase.id);

    assert.ok(testCase.category?.trim(), `${testCase.id}: category is required`);
    assert.ok(testCase.tweet.length >= 40, `${testCase.id}: tweet is too short`);
    assert.ok(testCase.tweet.length <= 280, `${testCase.id}: tweet exceeds X post length`);
    assert.ok(testCase.expected_memes.length >= 3, `${testCase.id}: needs at least 3 expected meme families`);
    assert.ok(testCase.rejected_memes.length >= 1, `${testCase.id}: needs at least 1 rejected meme family`);
    assert.ok(testCase.keywords.length >= 3, `${testCase.id}: needs at least 3 specificity keywords`);
    for (const rejected of testCase.rejected_memes) {
      assert.ok(rejected.reason.length >= 20, `${testCase.id}: rejected meme needs a useful reason`);
    }
  }
});

test("all expected benchmark meme families resolve to verified runtime templates", () => {
  for (const testCase of benchmark.cases) {
    for (const memeName of testCase.expected_memes) {
      const template = findMemeTemplate(memeName);
      assert.ok(template, `${testCase.id}: missing verified template for ${memeName}`);
      assert.equal(template.quality, "verified", `${testCase.id}: ${memeName} must resolve to verified template`);
      assert.equal(template.supports_overlay, true, `${testCase.id}: ${memeName} must support overlays`);
    }
    for (const rejected of testCase.rejected_memes) {
      const template = findMemeTemplate(rejected.name);
      assert.ok(template, `${testCase.id}: missing verified rejected template for ${rejected.name}`);
      assert.equal(template.quality, "verified", `${testCase.id}: ${rejected.name} must resolve to verified template`);
      assert.equal(template.supports_overlay, true, `${testCase.id}: ${rejected.name} must support overlays`);
    }
  }
});

test("suggestion benchmark audit script passes the production benchmark", async () => {
  const { stdout } = await execFileAsync(
    "node",
    ["--import", "tsx", benchmarkAuditPath],
    { cwd: rootDir }
  );

  assert.match(stdout, /errors=0/);
});

test("suggestion benchmark audit rejects expected and rejected overlap", async () => {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "memedrop-benchmark-"));
  const badBenchmarkPath = path.join(tmpDir, "bad-benchmark.json");
  await fsp.writeFile(
    badBenchmarkPath,
    `${JSON.stringify(
      {
        cases: [
          {
            id: "overlap-case",
            category: "bad fixture",
            tweet: "This deliberately long benchmark fixture has an overlapping expected and rejected meme.",
            expected_memes: ["This Is Fine", "Change My Mind", "Surprised Pikachu"],
            rejected_memes: [
              {
                name: "This Is Fine",
                reason: "This fixture intentionally overlaps with the expected list.",
              },
            ],
            keywords: ["benchmark", "overlap", "fixture"],
          },
        ],
      },
      null,
      2
    )}\n`
  );

  await assert.rejects(
    execFileAsync(
      "node",
      [
        "--import",
        "tsx",
        benchmarkAuditPath,
        "--file",
        badBenchmarkPath,
        "--min-cases",
        "1",
        "--min-categories",
        "1",
        "--min-expected-families",
        "1",
        "--min-rejected-families",
        "1",
      ],
      { cwd: rootDir }
    ),
    (error: unknown) => {
      const err = error as { stdout?: string };
      assert.match(err.stdout || "", /meme cannot be both expected and rejected/);
      return true;
    }
  );
});
