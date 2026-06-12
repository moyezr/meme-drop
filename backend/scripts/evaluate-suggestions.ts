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
  id?: string;
  category?: string;
  tweet: string;
  expected_memes?: string[];
  keywords?: string[];
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
  layoutFitScore: number;
  overlayCoverage: number;
  judge?: JudgeResult;
  suggestions: Array<{
    rank: number;
    name: string;
    source: "user" | "global";
    score: number;
    captions: string[];
    issues: string[];
    layout: LayoutFitSummary | null;
  }>;
}

interface LayoutFitSummary {
  fit_score: number;
  min_font_px: number;
  too_small_regions: string[];
  overflow_regions: string[];
  truncated_regions: string[];
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

interface BenchmarkSummary {
  cases: number;
  top1: number;
  top3: number;
  top5: number;
  mean_caption_score: number;
  mean_layout_fit_score: number;
  overlay_coverage: number;
  user_source_suggestions: number;
  mean_judge_score: number;
}

interface QualityGate {
  metric: keyof BenchmarkSummary;
  min: number;
  actual: number;
  passed: boolean;
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
const qualityGates = buildQualityGates(args);

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
  const gates = evaluateQualityGates(summary, qualityGates);
  const report = {
    generated_at: new Date().toISOString(),
    mode,
    source,
    limit,
    summary,
    gates,
    results,
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    if (gates.some((gate) => !gate.passed)) process.exitCode = 1;
    return;
  }

  printHumanReport(report);
  if (gates.some((gate) => !gate.passed)) process.exitCode = 1;
}

function scoreCase(testCase: BenchmarkCase, suggestions: SuggestionResult[]): CaseResult {
  const expected = (testCase.expected_memes || []).map(normalizeName);
  const ranked = suggestions.slice(0, limit);
  const bestIndex = ranked.findIndex((suggestion) => {
    const normalizedName = normalizeName(suggestion.name);
    const normalizedId = normalizeName(suggestion.meme_id);
    return expected.some(
      (name) =>
        normalizedName.includes(name) ||
        name.includes(normalizedName) ||
        normalizedId.includes(name) ||
        name.includes(normalizedId)
    );
  });
  const captionChecks = ranked.map((suggestion, index) => {
    const captions = suggestion.tailored_overlay?.regions.map((region) => region.text) || [];
    const issues = captionIssues(testCase, suggestion);
    const layout = layoutFitSummary(suggestion);
    return {
      rank: index + 1,
      name: suggestion.name,
      source: suggestion.source,
      score: suggestion.score,
      captions,
      issues,
      layout,
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
  const layoutChecks = captionChecks
    .map((item) => item.layout)
    .filter((item): item is LayoutFitSummary => Boolean(item));
  const layoutFitScore =
    layoutChecks.length === 0
      ? 0
      : round(
          layoutChecks.reduce((sum, item) => sum + item.fit_score, 0) /
            layoutChecks.length
        );
  const overlayCoverage = round(layoutChecks.length / Math.max(1, captionChecks.length));

  return {
    id: testCase.id || previewText(testCase.tweet, 48),
    top1Hit: bestIndex === 0,
    top3Hit: bestIndex >= 0 && bestIndex < 3,
    top5Hit: bestIndex >= 0 && bestIndex < 5,
    bestRank: bestIndex >= 0 ? bestIndex + 1 : null,
    captionScore,
    layoutFitScore,
    overlayCoverage,
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
  const keywords = testCase.keywords || [];
  if (keywords.length > 0 && !keywords.some((keyword) => allText.includes(keyword.toLowerCase()))) {
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

function layoutFitSummary(suggestion: SuggestionResult): LayoutFitSummary | null {
  const overlay = suggestion.tailored_overlay;
  if (!overlay || overlay.regions.length === 0) return null;

  const tooSmallRegions: string[] = [];
  const overflowRegions: string[] = [];
  const truncatedRegions: string[] = [];
  let minFont = Number.POSITIVE_INFINITY;
  let totalRegionScore = 0;

  for (const region of overlay.regions) {
    const fit = estimateRegionFit(region);
    minFont = Math.min(minFont, fit.fontSize);
    if (fit.isTooSmall) tooSmallRegions.push(region.id);
    if (fit.overflows) overflowRegions.push(region.id);
    if (fit.truncated) truncatedRegions.push(region.id);
    totalRegionScore += fit.score;
  }

  return {
    fit_score: round(totalRegionScore / overlay.regions.length),
    min_font_px: round(Number.isFinite(minFont) ? minFont : 0),
    too_small_regions: tooSmallRegions,
    overflow_regions: overflowRegions,
    truncated_regions: truncatedRegions,
  };
}

function estimateRegionFit(region: NonNullable<SuggestionResult["tailored_overlay"]>["regions"][number]) {
  const text = transformOverlayText(
    region.text.trim().slice(0, region.max_chars || 120),
    region.text_transform
  );
  const words = text.split(/\s+/).filter(Boolean);
  const maxLines = region.max_lines || 4;
  const fontMin = Math.max(10, region.font?.min_size || 12);
  const fontMax = region.font?.max_size || 52;

  // Use a 1000px-wide virtual canvas. Regions are normalized, so this keeps
  // the check deterministic while matching the renderer's proportions.
  const canvasWidth = 1000;
  const canvasHeight = Math.max(1, canvasWidth / 1.2);
  const boxWidth = region.width * canvasWidth;
  const boxHeight = region.height * canvasHeight;
  const padding = Math.max(4, Math.min(boxWidth, boxHeight) * 0.055);
  const safeWidth = Math.max(8, boxWidth - padding * 2);
  const safeHeight = Math.max(8, boxHeight - padding * 2);

  let fontSize = fontMax;
  let lines = wrapApproxLines(words, safeWidth, fontSize, maxLines);
  while (
    fontSize - 0.5 >= fontMin &&
    (lines.length * fontSize * 1.08 > safeHeight ||
      lines.some((line) => approximateImpactWidth(line, fontSize) > safeWidth))
  ) {
    fontSize -= 0.5;
    lines = wrapApproxLines(words, safeWidth, fontSize, maxLines);
  }

  const naturalLines = wrapApproxLines(words, safeWidth, fontSize, Number.POSITIVE_INFINITY);
  const truncated = naturalLines.length > maxLines;
  const overflows =
    lines.length * fontSize * 1.08 > safeHeight ||
    lines.some((line) => approximateImpactWidth(line, fontSize) > safeWidth);
  const isTooSmall = fontSize <= fontMin + 0.5 && (text.length > 14 || words.length > 3);
  const score =
    1 -
    (truncated ? 0.35 : 0) -
    (overflows ? 0.45 : 0) -
    (isTooSmall ? 0.2 : 0);

  return {
    fontSize,
    truncated,
    overflows,
    isTooSmall,
    score: Math.max(0, round(score)),
  };
}

function wrapApproxLines(words: string[], maxWidth: number, fontSize: number, maxLines: number): string[] {
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const pieces = breakApproxWord(word, maxWidth, fontSize);
    for (const piece of pieces) {
      const test = current ? `${current} ${piece}` : piece;
      if (approximateImpactWidth(test, fontSize) <= maxWidth) {
        current = test;
      } else {
        if (current) lines.push(current);
        current = piece;
      }
    }
  }

  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;
  return lines.slice(0, Math.max(1, maxLines));
}

function breakApproxWord(word: string, maxWidth: number, fontSize: number): string[] {
  if (approximateImpactWidth(word, fontSize) <= maxWidth) return [word];

  const pieces: string[] = [];
  let current = "";
  for (const char of word) {
    const test = `${current}${char}`;
    if (!current || approximateImpactWidth(test, fontSize) <= maxWidth) {
      current = test;
    } else {
      pieces.push(current);
      current = char;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

function approximateImpactWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const char of text) {
    if (char === " ") units += 0.32;
    else if (/[ilI1|]/.test(char)) units += 0.32;
    else if (/[mwMW]/.test(char)) units += 0.92;
    else if (/[A-Z0-9]/.test(char)) units += 0.66;
    else units += 0.58;
  }
  return units * fontSize;
}

function transformOverlayText(
  text: string,
  transform: NonNullable<SuggestionResult["tailored_overlay"]>["regions"][number]["text_transform"] = "uppercase"
): string {
  if (transform === "none") return text;
  if (transform === "mocking") return text;
  return text.toUpperCase();
}

function previewText(text: string, maxLength: number): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function summarize(results: CaseResult[]): BenchmarkSummary {
  const total = results.length || 1;
  return {
    cases: results.length,
    top1: round(results.filter((item) => item.top1Hit).length / total),
    top3: round(results.filter((item) => item.top3Hit).length / total),
    top5: round(results.filter((item) => item.top5Hit).length / total),
    mean_caption_score: round(results.reduce((sum, item) => sum + item.captionScore, 0) / total),
    mean_layout_fit_score: round(results.reduce((sum, item) => sum + item.layoutFitScore, 0) / total),
    overlay_coverage: round(results.reduce((sum, item) => sum + item.overlayCoverage, 0) / total),
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

function buildQualityGates(rawArgs: Record<string, string | boolean>): Array<Omit<QualityGate, "actual" | "passed">> {
  const gateArgs: Array<[keyof BenchmarkSummary, string]> = [
    ["top1", "min-top1"],
    ["top3", "min-top3"],
    ["top5", "min-top5"],
    ["mean_caption_score", "min-caption"],
    ["mean_layout_fit_score", "min-layout"],
    ["overlay_coverage", "min-overlay"],
    ["mean_judge_score", "min-judge"],
  ];

  return gateArgs.flatMap(([metric, argName]) => {
    const raw = rawArgs[argName];
    if (raw === undefined || raw === false || raw === true) return [];
    const min = Number(raw);
    if (!Number.isFinite(min) || min < 0) {
      throw new Error(`Invalid --${argName} value: ${String(raw)}`);
    }
    return [{ metric, min }];
  });
}

function evaluateQualityGates(
  summary: BenchmarkSummary,
  gates: Array<Omit<QualityGate, "actual" | "passed">>
): QualityGate[] {
  return gates.map((gate) => {
    const actual = summary[gate.metric];
    return {
      ...gate,
      actual,
      passed: actual >= gate.min,
    };
  });
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
  summary: BenchmarkSummary;
  gates: QualityGate[];
  results: CaseResult[];
}) {
  console.log(`MemeDrop suggestion benchmark (${report.mode}, ${report.source}, top ${report.limit})`);
  console.log(
    `top1=${pct(report.summary.top1)} top3=${pct(report.summary.top3)} top5=${pct(report.summary.top5)} caption=${pct(report.summary.mean_caption_score)} layout=${pct(report.summary.mean_layout_fit_score)} overlay=${pct(report.summary.overlay_coverage)} userSource=${report.summary.user_source_suggestions} judge=${judgePct(report.summary.mean_judge_score)}`
  );
  console.log("");

  for (const result of report.results) {
    const hit = result.bestRank ? `hit@${result.bestRank}` : "miss";
    const judge = result.judge ? `, judge=${result.judge.overall}/5` : "";
    console.log(`${result.id}: ${hit}, caption=${pct(result.captionScore)}, layout=${pct(result.layoutFitScore)}, overlay=${pct(result.overlayCoverage)}${judge}`);
    for (const suggestion of result.suggestions.slice(0, 3)) {
      const captions = suggestion.captions.length ? ` | "${suggestion.captions.join(" / ")}"` : "";
      const issues = suggestion.issues.length ? ` [${suggestion.issues.join("; ")}]` : "";
      const layoutIssues = layoutIssueText(suggestion.layout);
      console.log(`  ${suggestion.rank}. ${suggestion.name} [${suggestion.source}] (${suggestion.score})${captions}${issues}${layoutIssues}`);
    }
    if (result.judge?.notes) console.log(`  judge: ${result.judge.notes}`);
  }

  if (report.gates.length > 0) {
    console.log("");
    for (const gate of report.gates) {
      const status = gate.passed ? "PASS" : "FAIL";
      console.log(
        `${status} ${gate.metric} actual=${formatGateValue(gate.metric, gate.actual)} min=${formatGateValue(gate.metric, gate.min)}`
      );
    }
  }
}

function layoutIssueText(layout: LayoutFitSummary | null): string {
  if (!layout) return " [no overlay template]";

  const issues: string[] = [];
  if (layout.too_small_regions.length) {
    issues.push(`tiny text: ${layout.too_small_regions.join(",")}`);
  }
  if (layout.overflow_regions.length) {
    issues.push(`overflow: ${layout.overflow_regions.join(",")}`);
  }
  if (layout.truncated_regions.length) {
    issues.push(`truncated: ${layout.truncated_regions.join(",")}`);
  }
  if (issues.length === 0) return "";
  return ` [layout ${pct(layout.fit_score)} min=${layout.min_font_px}px; ${issues.join("; ")}]`;
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

function formatGateValue(metric: keyof BenchmarkSummary, value: number): string {
  return metric === "mean_judge_score" ? judgePct(value) : pct(value);
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
