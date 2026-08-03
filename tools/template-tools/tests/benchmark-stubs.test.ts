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
const exporterPath = path.join(rootDir, "tools", "template-tools", "scripts", "export-benchmark-stubs.ts");

test("benchmark stub exporter writes copy-ready cases from a promotion plan", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "memedrop-benchmark-stubs-"));
  const planPath = path.join(tmpDir, "promotion-plan.json");
  const outPath = path.join(tmpDir, "stubs.json");
  await writePromotionPlan(planPath);

  const { stdout } = await execFileAsync(
    "node",
    [
      "--import",
      "tsx",
      exporterPath,
      "--plan",
      planPath,
      "--out",
      outPath,
    ],
    { cwd: rootDir }
  );

  const output = JSON.parse(await fs.readFile(outPath, "utf8")) as {
    summary: { cases: number };
    source_templates: Array<{ template_id: string }>;
    cases: Array<{ id: string; expected_memes: string[] }>;
  };

  assert.match(stdout, /exported 2 benchmark stubs/);
  assert.equal(output.summary.cases, 2);
  assert.deepEqual(output.source_templates.map((item) => item.template_id), [
    "absolute-cinema",
    "batman-slapping-robin",
  ]);
  assert.equal(output.cases[0]?.id, "absolute-cinema-fit");
  assert.deepEqual(output.cases[1]?.expected_memes, ["Batman Slapping Robin"]);
});

test("benchmark stub exporter supports status filtering", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "memedrop-benchmark-stubs-"));
  const planPath = path.join(tmpDir, "promotion-plan.json");
  const outPath = path.join(tmpDir, "stubs.json");
  await writePromotionPlan(planPath);

  await execFileAsync(
    "node",
    [
      "--import",
      "tsx",
      exporterPath,
      "--plan",
      planPath,
      "--out",
      outPath,
      "--status",
      "approved_blocked",
    ],
    { cwd: rootDir }
  );

  const output = JSON.parse(await fs.readFile(outPath, "utf8")) as {
    summary: { cases: number };
    source_templates: Array<{ template_id: string }>;
  };

  assert.equal(output.summary.cases, 1);
  assert.equal(output.source_templates[0]?.template_id, "batman-slapping-robin");
});

test("benchmark stub exporter fails clearly when promotion plan is missing", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "memedrop-benchmark-stubs-"));
  const planPath = path.join(tmpDir, "missing.json");

  await assert.rejects(
    execFileAsync(
      "node",
      ["--import", "tsx", exporterPath, "--plan", planPath],
      { cwd: rootDir }
    ),
    (error: unknown) => {
      const err = error as { stderr?: string };
      assert.match(err.stderr || "", /Promotion plan not found/);
      return true;
    }
  );
});

async function writePromotionPlan(planPath: string) {
  await fs.writeFile(
    planPath,
    `${JSON.stringify(
      {
        generated_at: "2026-06-14T00:00:00.000Z",
        templates: [
          {
            template_id: "absolute-cinema",
            name: "Absolute Cinema",
            status: "ready_for_review",
            blockers: [],
            warnings: [],
            benchmark_stub: {
              id: "absolute-cinema-fit",
              category: "general-reaction",
              tweet: "Replace this with a real tweet where Absolute Cinema is a top-tier reply.",
              expected_memes: ["Absolute Cinema"],
              keywords: ["absolute", "cinema", "verdict"],
              rejected_memes: [
                {
                  name: "This Is Fine",
                  reason: "Replace with a tempting but wrong verified meme family.",
                },
              ],
            },
          },
          {
            template_id: "batman-slapping-robin",
            name: "Batman Slapping Robin",
            status: "approved_blocked",
            blockers: ["benchmark case does not exist"],
            warnings: [],
            benchmark_stub: {
              id: "batman-slapping-robin-fit",
              category: "correction",
              tweet: "Replace this with a real tweet where abrupt correction is the joke.",
              expected_memes: ["Batman Slapping Robin"],
              keywords: ["abrupt", "correction", "argument"],
              rejected_memes: [
                {
                  name: "Change My Mind",
                  reason: "Debate framing is too calm for the slap correction format.",
                },
              ],
            },
          },
          {
            template_id: "always-has-been",
            name: "Always Has Been",
            status: "verified_duplicate",
            blockers: [],
            warnings: [],
          },
        ],
      },
      null,
      2
    )}\n`
  );
}
