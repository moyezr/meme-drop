import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

process.env.DATABASE_URL ||= "postgresql://test";

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(import.meta.dirname, "..", "..", "..");
const validatorPath = path.join(
  rootDir,
  "tools",
  "template-tools",
  "scripts",
  "validate-template-review-decisions.ts"
);
const initializerPath = path.join(
  rootDir,
  "tools",
  "template-tools",
  "scripts",
  "init-template-review-decisions.ts"
);

test("template review decision example validates", async () => {
  const { stdout } = await execFileAsync(
    "node",
    [
      "--import",
      "tsx",
      validatorPath,
      "--file",
      "tools/template-tools/evals/template-review-decisions.example.json",
    ],
    { cwd: rootDir }
  );

  assert.match(stdout, /reviewed=2 approved=1 needsWork=1 rejected=0 errors=0/);
});

test("template review decision initializer creates a valid conservative review file", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "memedrop-review-init-"));
  const decisionsPath = path.join(tmpDir, "template-review-decisions.json");

  const initResult = await execFileAsync(
    "node",
    [
      "--import",
      "tsx",
      initializerPath,
      "--out",
      decisionsPath,
      "--limit",
      "3",
      "--reviewer",
      "test-reviewer",
    ],
    { cwd: rootDir }
  );

  assert.match(initResult.stdout, /initialized \d+ new template review decisions/);

  const raw = await fs.readFile(decisionsPath, "utf8");
  const decisions = JSON.parse(raw) as {
    reviewer: string;
    decisions: Array<{ status: string; issues?: string[]; notes?: string }>;
  };
  assert.equal(decisions.reviewer, "test-reviewer");
  assert.ok(decisions.decisions.length <= 3);
  assert.ok(decisions.decisions.every((decision) => decision.status === "needs_work"));
  assert.ok(decisions.decisions.every((decision) => (decision.issues || []).length > 0));

  const validateResult = await execFileAsync(
    "node",
    ["--import", "tsx", validatorPath, "--file", decisionsPath],
    { cwd: rootDir }
  );
  assert.match(validateResult.stdout, /errors=0/);
});

test("template review decision initializer can append without changing existing decisions", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "memedrop-review-append-"));
  const decisionsPath = path.join(tmpDir, "template-review-decisions.json");
  const existing = {
    version: 1,
    reviewed_at: "2026-06-13T00:00:00.000Z",
    reviewer: "human-reviewer",
    decisions: [
      {
        template_id: "absolute-cinema",
        status: "approved",
        benchmark_case_id: "absolute-cinema",
        notes: "Rendered QA is clean, readable, and clear of the key face and gesture.",
      },
    ],
  };
  await fs.writeFile(decisionsPath, `${JSON.stringify(existing, null, 2)}\n`);

  const initResult = await execFileAsync(
    "node",
    [
      "--import",
      "tsx",
      initializerPath,
      "--out",
      decisionsPath,
      "--append",
      "--limit",
      "2",
    ],
    { cwd: rootDir }
  );

  assert.match(initResult.stdout, /preserved 1 existing review decisions/);

  const raw = await fs.readFile(decisionsPath, "utf8");
  const decisions = JSON.parse(raw) as {
    reviewer: string;
    decisions: Array<{ template_id: string; status: string }>;
  };
  assert.equal(decisions.reviewer, "human-reviewer");
  assert.deepEqual(decisions.decisions[0], existing.decisions[0]);
  assert.equal(decisions.decisions.length, 3);
  assert.equal(decisions.decisions.filter((decision) => decision.template_id === "absolute-cinema").length, 1);
  assert.ok(decisions.decisions.slice(1).every((decision) => decision.status === "needs_work"));

  const validateResult = await execFileAsync(
    "node",
    ["--import", "tsx", validatorPath, "--file", decisionsPath],
    { cwd: rootDir }
  );
  assert.match(validateResult.stdout, /reviewed=3 approved=1 needsWork=2 rejected=0 errors=0/);
});

test("approved review decisions require benchmark case ids", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "memedrop-review-"));
  const decisionsPath = path.join(tmpDir, "bad-review.json");
  await fs.writeFile(
    decisionsPath,
    JSON.stringify(
      {
        version: 1,
        reviewed_at: "2026-06-13T00:00:00.000Z",
        reviewer: "test",
        decisions: [
          {
            template_id: "absolute-cinema",
            status: "approved",
            notes: "Text regions look clean and this template should be benchmarked.",
          },
        ],
      },
      null,
      2
    )
  );

  await assert.rejects(
    execFileAsync("node", ["--import", "tsx", validatorPath, "--file", decisionsPath], {
      cwd: rootDir,
    }),
    (error: unknown) => {
      const err = error as { stdout?: string };
      assert.match(err.stdout || "", /approved templates require a kebab-case benchmark_case_id/);
      return true;
    }
  );
});

test("promotion review decisions require benchmark case ids to exist", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "memedrop-review-"));
  const decisionsPath = path.join(tmpDir, "review-missing-benchmark.json");
  await fs.writeFile(
    decisionsPath,
    JSON.stringify(
      {
        version: 1,
        reviewed_at: "2026-06-13T00:00:00.000Z",
        reviewer: "test",
        decisions: [
          {
            template_id: "absolute-cinema",
            status: "approved",
            benchmark_case_id: "not-yet-added",
            notes: "Text regions look clean and this template should be benchmarked.",
          },
        ],
      },
      null,
      2
    )
  );

  await assert.rejects(
    execFileAsync(
      "node",
      ["--import", "tsx", validatorPath, "--file", decisionsPath, "--require-benchmark-present"],
      { cwd: rootDir }
    ),
    (error: unknown) => {
      const err = error as { stdout?: string };
      assert.match(err.stdout || "", /benchmark_case_id "not-yet-added" does not exist/);
      return true;
    }
  );
});

test("promotion review decisions require benchmark cases to include approved templates", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "memedrop-review-"));
  const decisionsPath = path.join(tmpDir, "review-mismatched-benchmark.json");
  await fs.writeFile(
    decisionsPath,
    JSON.stringify(
      {
        version: 1,
        reviewed_at: "2026-06-13T00:00:00.000Z",
        reviewer: "test",
        decisions: [
          {
            template_id: "absolute-cinema",
            status: "approved",
            benchmark_case_id: "prod-fire-calm",
            notes: "Text regions look clean and this template should be benchmarked.",
          },
        ],
      },
      null,
      2
    )
  );

  await assert.rejects(
    execFileAsync(
      "node",
      ["--import", "tsx", validatorPath, "--file", decisionsPath, "--require-benchmark-present"],
      { cwd: rootDir }
    ),
    (error: unknown) => {
      const err = error as { stdout?: string };
      assert.match(
        err.stdout || "",
        /benchmark_case_id "prod-fire-calm" must include "Absolute Cinema" in expected_memes/
      );
      return true;
    }
  );
});

test("promotion review decisions pass when benchmark case includes approved template", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "memedrop-review-"));
  const decisionsPath = path.join(tmpDir, "review-existing-benchmark.json");
  const benchmarkPath = path.join(tmpDir, "suggestion-benchmark.json");
  await fs.writeFile(
    decisionsPath,
    JSON.stringify(
      {
        version: 1,
        reviewed_at: "2026-06-13T00:00:00.000Z",
        reviewer: "test",
        decisions: [
          {
            template_id: "absolute-cinema",
            status: "approved",
            benchmark_case_id: "dramatic-overanalysis",
            notes: "Text regions look clean and this template should be benchmarked.",
          },
        ],
      },
      null,
      2
    )
  );
  await fs.writeFile(
    benchmarkPath,
    JSON.stringify(
      {
        cases: [
          {
            id: "dramatic-overanalysis",
            expected_memes: ["Absolute Cinema", "Change My Mind", "This Is Fine"],
          },
        ],
      },
      null,
      2
    )
  );

  const { stdout } = await execFileAsync(
    "node",
    [
      "--import",
      "tsx",
      validatorPath,
      "--file",
      decisionsPath,
      "--benchmark",
      benchmarkPath,
      "--require-benchmark-present",
    ],
    { cwd: rootDir }
  );

  assert.match(stdout, /reviewed=1 approved=1 needsWork=0 rejected=0 errors=0/);
});
