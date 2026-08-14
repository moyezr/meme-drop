import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("template promotion compiles approved reviewed drafts into verified templates", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "memedrop-promotion-"));
  const decisionsPath = path.join(tempDir, "decisions.json");
  const benchmarkPath = path.join(tempDir, "benchmark.json");
  const outPath = path.join(tempDir, "promoted.json");

  fs.writeFileSync(
    decisionsPath,
    `${JSON.stringify(
      {
        version: 1,
        reviewed_at: "2026-06-13T00:00:00.000Z",
        reviewer: "test-reviewer",
        decisions: [
          {
            template_id: "absolute-cinema",
            status: "approved",
            benchmark_case_id: "absolute-cinema-launch",
            notes:
              "Visual QA keeps the caption boxes clear of faces and hands while adding a useful verdict format.",
          },
        ],
      },
      null,
      2
    )}\n`
  );
  fs.writeFileSync(
    benchmarkPath,
    `${JSON.stringify(
      {
        cases: [
          {
            id: "absolute-cinema-launch",
            tweet_text: "This production launch checklist is finally strict enough.",
            expected_memes: ["Absolute Cinema"],
            rejected_memes: [],
          },
        ],
      },
      null,
      2
    )}\n`
  );

  const result = runPromotion(decisionsPath, benchmarkPath, outPath);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const promoted = JSON.parse(fs.readFileSync(outPath, "utf8")) as {
    templates: Array<{
      template_id: string;
      quality: string;
      regions: Array<{
        padding_ratio: number;
        text_transform: string;
        font: {
          family: string;
          weight: number;
          fill_color: string;
          stroke_color: string;
          stroke_ratio: number;
          line_height_ratio: number;
        };
      }>;
    }>;
  };
  assert.equal(promoted.templates.length, 1);
  assert.equal(promoted.templates[0]?.template_id, "absolute-cinema");
  assert.equal(promoted.templates[0]?.quality, "verified");
  assert.deepEqual(promoted.templates[0]?.regions[0] && {
    padding_ratio: promoted.templates[0].regions[0].padding_ratio,
    text_transform: promoted.templates[0].regions[0].text_transform,
    family: promoted.templates[0].regions[0].font.family,
    weight: promoted.templates[0].regions[0].font.weight,
    fill_color: promoted.templates[0].regions[0].font.fill_color,
    stroke_color: promoted.templates[0].regions[0].font.stroke_color,
    stroke_ratio: promoted.templates[0].regions[0].font.stroke_ratio,
    line_height_ratio: promoted.templates[0].regions[0].font.line_height_ratio,
  }, {
    padding_ratio: 0.055,
    text_transform: "uppercase",
    family: "Impact",
    weight: 900,
    fill_color: "#FFFFFF",
    stroke_color: "#000000",
    stroke_ratio: 0.12,
    line_height_ratio: 1.08,
  });
});

test("template promotion rejects approved drafts without benchmark coverage", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "memedrop-promotion-"));
  const decisionsPath = path.join(tempDir, "decisions.json");
  const benchmarkPath = path.join(tempDir, "benchmark.json");
  const outPath = path.join(tempDir, "promoted.json");

  fs.writeFileSync(
    decisionsPath,
    `${JSON.stringify(
      {
        version: 1,
        reviewed_at: "2026-06-13T00:00:00.000Z",
        reviewer: "test-reviewer",
        decisions: [
          {
            template_id: "absolute-cinema",
            status: "approved",
            benchmark_case_id: "missing-case",
            notes:
              "Visual QA keeps the caption boxes clear of faces and hands while adding a useful verdict format.",
          },
        ],
      },
      null,
      2
    )}\n`
  );
  fs.writeFileSync(benchmarkPath, `${JSON.stringify({ cases: [] }, null, 2)}\n`);

  const result = runPromotion(decisionsPath, benchmarkPath, outPath);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /benchmark_case_id "missing-case" does not exist/);
  assert.equal(fs.existsSync(outPath), false);
});

function runPromotion(decisionsPath: string, benchmarkPath: string, outPath: string) {
  return spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/promote-template-decisions.ts",
      "--file",
      decisionsPath,
      "--benchmark",
      benchmarkPath,
      "--out",
      outPath,
    ],
    {
      cwd: process.cwd(),
      env: {
        PATH: process.env.PATH || "",
      },
      encoding: "utf8",
    }
  );
}
