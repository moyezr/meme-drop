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
const plannerPath = path.join(rootDir, "tools", "template-tools", "scripts", "plan-template-promotion.ts");

test("promotion planner identifies mechanically ready unreviewed drafts", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "memedrop-promotion-plan-"));
  const decisionsPath = path.join(tmpDir, "missing-decisions.json");

  const { stdout } = await execFileAsync(
    "node",
    [
      "--import",
      "tsx",
      plannerPath,
      "--file",
      decisionsPath,
      "--json",
      "--limit",
      "10",
    ],
    { cwd: rootDir }
  );

  const report = JSON.parse(stdout) as {
    summary: { ready_for_review: number; selected_for_next_batch: number };
    templates: Array<{ status: string; benchmark_stub?: unknown }>;
  };

  assert.ok(report.summary.ready_for_review > 0);
  assert.equal(report.summary.selected_for_next_batch, 0);
  assert.ok(report.templates.some((template) => template.status === "ready_for_review" && template.benchmark_stub));
});

test("promotion planner blocks approved templates until benchmark coverage exists", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "memedrop-promotion-plan-blocked-"));
  const decisionsPath = path.join(tmpDir, "decisions.json");
  await writeDecisions(decisionsPath, [
    {
      template_id: "american-chopper-argument",
      status: "approved",
      benchmark_case_id: "american-chopper-argument-fit",
      notes: "Rendered QA is clean, readable, and clear of the important face and gesture.",
    },
  ]);

  const { stdout } = await execFileAsync(
    "node",
    [
      "--import",
      "tsx",
      plannerPath,
      "--file",
      decisionsPath,
      "--json",
      "--limit",
      "100",
    ],
    { cwd: rootDir }
  );

  const report = JSON.parse(stdout) as {
    summary: { approved_blocked: number; approved_ready: number };
    templates: Array<{ template_id: string; status: string; blockers: string[]; benchmark_stub?: unknown }>;
  };
  const planned = report.templates.find((template) => template.template_id === "american-chopper-argument");

  assert.equal(report.summary.approved_ready, 0);
  assert.equal(report.summary.approved_blocked, 1);
  assert.equal(planned?.status, "approved_blocked");
  assert.match(planned?.blockers.join("\n") || "", /benchmark case does not exist/);
  assert.ok(planned?.benchmark_stub);
});

test("promotion planner selects covered approved templates for a small batch", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "memedrop-promotion-plan-ready-"));
  const decisionsPath = path.join(tmpDir, "decisions.json");
  const benchmarkPath = path.join(tmpDir, "benchmark.json");
  await writeDecisions(decisionsPath, [
    {
      template_id: "american-chopper-argument",
      status: "approved",
      benchmark_case_id: "american-chopper-argument-fit",
      notes: "Rendered QA is clean, readable, and clear of the important face and gesture.",
    },
  ]);
  await fs.writeFile(
    benchmarkPath,
    `${JSON.stringify(
      {
        cases: [
          {
            id: "american-chopper-argument-fit",
            category: "escalating argument",
            tweet: "The lead said the migration was a five minute fix and now three people are arguing over the broken deploy.",
            expected_memes: ["American Chopper Argument", "Woman Yelling At Cat", "This Is Fine"],
            keywords: ["migration", "deploy", "arguing"],
            rejected_memes: [
              {
                name: "Surprised Pikachu",
                reason: "predictable shock misses the escalating argument format",
              },
            ],
          },
        ],
      },
      null,
      2
    )}\n`
  );

  const { stdout } = await execFileAsync(
    "node",
    [
      "--import",
      "tsx",
      plannerPath,
      "--file",
      decisionsPath,
      "--benchmark",
      benchmarkPath,
      "--json",
      "--limit",
      "5",
    ],
    { cwd: rootDir }
  );

  const report = JSON.parse(stdout) as {
    summary: { approved_ready: number; selected_for_next_batch: number };
    selected_for_next_batch: Array<{ template_id: string; status: string }>;
  };

  assert.equal(report.summary.approved_ready, 1);
  assert.equal(report.summary.selected_for_next_batch, 1);
  assert.equal(report.selected_for_next_batch[0]?.template_id, "american-chopper-argument");
  assert.equal(report.selected_for_next_batch[0]?.status, "approved_ready");
});

async function writeDecisions(
  filePath: string,
  decisions: Array<Record<string, string>>
) {
  await fs.writeFile(
    filePath,
    `${JSON.stringify(
      {
        version: 1,
        reviewed_at: "2026-06-13T00:00:00.000Z",
        reviewer: "test-reviewer",
        decisions,
      },
      null,
      2
    )}\n`
  );
}
