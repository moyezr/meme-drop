import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadUsageFeedbackReport,
  summarizeUsageFeedback,
  type UsageFeedbackReport,
  type UsageFeedbackRow,
} from "../src/services/usage-feedback-report.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..", "..");
const args = parseArgs(process.argv.slice(2));

const lookbackDays = Number(args.days || 30);
const minimumShown = Number(args["min-shown"] || 20);
const limit = Number(args.limit || 50);

try {
  const report = args.input
    ? summarizeUsageFeedback(readInputRows(String(args.input)), {
        lookbackDays,
        minimumShown,
        limit,
      })
    : await loadUsageFeedbackReport({
        lookbackDays,
        minimumShown,
        limit,
      });

  if (args.out) {
    const outPath = path.resolve(rootDir, String(args.out));
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }
} finally {
  if (!args.input) {
    const { pool } = await import("../src/db/index.js");
    await pool.end();
  }
}

function readInputRows(inputPath: string): UsageFeedbackRow[] {
  const resolvedPath = path.resolve(rootDir, inputPath);
  const data = JSON.parse(fs.readFileSync(resolvedPath, "utf8")) as {
    rows?: UsageFeedbackRow[];
  } | UsageFeedbackRow[];
  return Array.isArray(data) ? data : data.rows || [];
}

function printReport(report: UsageFeedbackReport) {
  console.log("MemeDrop usage feedback report");
  console.log(
    `lookback=${report.lookback_days}d minShown=${report.minimum_shown} memes=${report.summary.memes} ` +
      `shown=${report.summary.shown} clicked=${report.summary.clicked} used=${report.summary.used} ` +
      `saved=${report.summary.saved} dismissed=${report.summary.dismissed} ` +
      `promote=${report.summary.promote_candidates} review=${report.summary.review_candidates}`
  );

  for (const item of report.items) {
    console.log(
      `- ${item.meme_name} [${item.meme_source}, ${item.quality_signal}] ` +
        `shown=${item.shown} ctr=${pct(item.click_through_rate)} use=${pct(item.use_rate)} ` +
        `save=${pct(item.save_rate)} dismiss=${pct(item.dismissal_rate)} id=${item.meme_id}`
    );
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
