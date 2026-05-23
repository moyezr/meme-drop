import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSuggestions, type SuggestionResult } from "../src/services/suggestion-engine.js";
import {
  getOpenRouterApiKey,
  openRouterHeaders,
  OPENROUTER_BASE_URL,
  QWEN_PLUS_MODEL,
} from "../src/services/llm-provider.js";

interface BenchmarkCase {
  id: string;
  category?: string;
  tweet: string;
  expected_memes: string[];
  keywords: string[];
}

interface BenchmarkFile {
  cases: BenchmarkCase[];
}

interface CaseResult {
  id: string;
  top1Hit: boolean;
  top3Hit: boolean;
  top5Hit: boolean;
  bestRank: number | null;
  captionScore: number;
  judge?: JudgeResult;
  suggestions: Array<{
    rank: number;
    name: string;
    source: "user" | "global";
    score: number;
    captions: string[];
    issues: string[];
  }>;
}

interface JudgeResult {
  meme_fit: number;
  caption_quality: number;
  specificity: number;
  brevity: number;
  internet_voice: number;
  overall: number;
  notes: string;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_BENCHMARK_PATH = path.join(__dirname, "..", "evals", "suggestion-benchmark.json");
const GENERIC_CAPTION_PATTERNS = [
  /\b(me rn|bad idea|more vibes|post through it|plot twist)\b/i,
  /\b(it'?s fine|making it worse|staying normal|acting shocked)\b/i,
  /\b(this|that|the whole problem)\b/i,
];

const args = parseArgs(process.argv.slice(2));
const mode = args.mode === "smart" ? "smart" : "fast";
const source = args.source === "all" || args.source === "user" ? args.source : "global";
const limit = Number(args.limit || 5);
const benchmarkPath = path.resolve(args.file || DEFAULT_BENCHMARK_PATH);

async function main() {
  const benchmark = JSON.parse(fs.readFileSync(benchmarkPath, "utf8")) as BenchmarkFile;
  const results: CaseResult[] = [];

  for (const testCase of benchmark.cases) {
    const suggestions = await getSuggestions(testCase.tweet, {
      limit,
      mode,
      source,
      refresh: true,
    });
    const result = scoreCase(testCase, suggestions);
    if (args.judge) {
      result.judge = await judgeCase(testCase, result);
    }
    results.push(result);
  }

  const summary = summarize(results);
  const report = {
    generated_at: new Date().toISOString(),
    mode,
    source,
    limit,
    summary,
    results,
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  printHumanReport(report);
}

function scoreCase(testCase: BenchmarkCase, suggestions: SuggestionResult[]): CaseResult {
  const expected = testCase.expected_memes.map(normalizeName);
  const ranked = suggestions.slice(0, limit);
  const bestIndex = ranked.findIndex((suggestion) =>
    expected.some((name) => normalizeName(suggestion.name).includes(name) || name.includes(normalizeName(suggestion.name)))
  );
  const captionChecks = ranked.map((suggestion, index) => {
    const captions = suggestion.tailored_overlay?.regions.map((region) => region.text) || [];
    const issues = captionIssues(testCase, suggestion);
    return {
      rank: index + 1,
      name: suggestion.name,
      source: suggestion.source,
      score: suggestion.score,
      captions,
      issues,
    };
  });

  const captionScore =
    captionChecks.length === 0
      ? 0
      : round(
          captionChecks.reduce((sum, item) => {
            const hasCaption = item.captions.length > 0;
            const penalty = Math.min(0.8, item.issues.length * 0.25);
            return sum + Math.max(0, (hasCaption ? 1 : 0.25) - penalty);
          }, 0) / captionChecks.length
        );

  return {
    id: testCase.id,
    top1Hit: bestIndex === 0,
    top3Hit: bestIndex >= 0 && bestIndex < 3,
    top5Hit: bestIndex >= 0 && bestIndex < 5,
    bestRank: bestIndex >= 0 ? bestIndex + 1 : null,
    captionScore,
    suggestions: captionChecks,
  };
}

function captionIssues(testCase: BenchmarkCase, suggestion: SuggestionResult): string[] {
  const issues: string[] = [];
  const overlay = suggestion.tailored_overlay;
  if (!overlay || overlay.regions.length === 0) return ["missing overlay"];

  const allText = overlay.regions.map((region) => region.text).join(" ").toLowerCase();
  if (GENERIC_CAPTION_PATTERNS.some((pattern) => pattern.test(allText))) {
    issues.push("generic/fallback phrasing");
  }
  if (!testCase.keywords.some((keyword) => allText.includes(keyword.toLowerCase()))) {
    issues.push("not specific to tweet keywords");
  }
  for (const region of overlay.regions) {
    if (region.max_chars && region.text.length > region.max_chars) {
      issues.push(`region ${region.id} exceeds max_chars`);
    }
    if (region.text.split(/\s+/).length > 8) {
      issues.push(`region ${region.id} is wordy`);
    }
  }
  return issues;
}

function summarize(results: CaseResult[]) {
  const total = results.length || 1;
  return {
    cases: results.length,
    top1: round(results.filter((item) => item.top1Hit).length / total),
    top3: round(results.filter((item) => item.top3Hit).length / total),
    top5: round(results.filter((item) => item.top5Hit).length / total),
    mean_caption_score: round(results.reduce((sum, item) => sum + item.captionScore, 0) / total),
    user_source_suggestions: results.reduce(
      (sum, item) => sum + item.suggestions.filter((suggestion) => suggestion.source === "user").length,
      0
    ),
    mean_judge_score: round(
      results.reduce((sum, item) => sum + (item.judge?.overall || 0), 0) /
        Math.max(1, results.filter((item) => item.judge).length)
    ),
  };
}

async function judgeCase(testCase: BenchmarkCase, result: CaseResult): Promise<JudgeResult | undefined> {
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) return undefined;

  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...openRouterHeaders(),
    },
    body: JSON.stringify({
      model: QWEN_PLUS_MODEL,
      temperature: 0,
      max_tokens: 500,
      reasoning: { effort: "none", exclude: true },
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "You judge meme reply suggestions for X posts.",
            "Score harshly from 1 to 5. 3 means usable but forgettable. 5 means a human would likely choose it.",
            "Reward meme-template fit, post-specific captions, brevity, and natural internet voice.",
            "Penalize generic captions, brand voice, confusing setups, stale filler, and mismatched templates.",
            "Return JSON only with keys: meme_fit, caption_quality, specificity, brevity, internet_voice, overall, notes.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              tweet: testCase.tweet,
              expected_meme_families: testCase.expected_memes,
              suggestions: result.suggestions.slice(0, 3),
            },
            null,
            2
          ),
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter evaluation judge failed ${response.status}: ${body.slice(0, 400)}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) return undefined;
  const parsed = JSON.parse(stripJsonFence(content)) as JudgeResult;
  return {
    meme_fit: clampJudgeScore(parsed.meme_fit),
    caption_quality: clampJudgeScore(parsed.caption_quality),
    specificity: clampJudgeScore(parsed.specificity),
    brevity: clampJudgeScore(parsed.brevity),
    internet_voice: clampJudgeScore(parsed.internet_voice),
    overall: clampJudgeScore(parsed.overall),
    notes: stringifyNote(parsed.notes).slice(0, 240),
  };
}

function printHumanReport(report: {
  mode: string;
  source: string;
  limit: number;
  summary: ReturnType<typeof summarize>;
  results: CaseResult[];
}) {
  console.log(`MemeDrop suggestion benchmark (${report.mode}, ${report.source}, top ${report.limit})`);
  console.log(
    `top1=${pct(report.summary.top1)} top3=${pct(report.summary.top3)} top5=${pct(report.summary.top5)} caption=${pct(report.summary.mean_caption_score)} userSource=${report.summary.user_source_suggestions} judge=${judgePct(report.summary.mean_judge_score)}`
  );
  console.log("");

  for (const result of report.results) {
    const hit = result.bestRank ? `hit@${result.bestRank}` : "miss";
    const judge = result.judge ? `, judge=${result.judge.overall}/5` : "";
    console.log(`${result.id}: ${hit}, caption=${pct(result.captionScore)}${judge}`);
    for (const suggestion of result.suggestions.slice(0, 3)) {
      const captions = suggestion.captions.length ? ` | "${suggestion.captions.join(" / ")}"` : "";
      const issues = suggestion.issues.length ? ` [${suggestion.issues.join("; ")}]` : "";
      console.log(`  ${suggestion.rank}. ${suggestion.name} [${suggestion.source}] (${suggestion.score})${captions}${issues}`);
    }
    if (result.judge?.notes) console.log(`  judge: ${result.judge.notes}`);
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

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function judgePct(value: number | undefined): string {
  return value ? `${value}/5` : "n/a";
}

function clampJudgeScore(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(5, round(value)));
}

function stripJsonFence(content: string): string {
  return content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function stringifyNote(note: unknown): string {
  if (typeof note === "string") return note;
  if (!note) return "";
  return JSON.stringify(note);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
