import {
  findMemeTemplateForCandidate,
  type MemeTemplate,
  type SuggestionResult,
} from "@memedrop/shared";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { memes } from "../db/schema.js";
import { DEV_USER_ID } from "../routes/identity.js";
import {
  getOpenRouterApiKey,
  MEME_QUALITY_MODEL,
  openRouterHeaders,
  OPENROUTER_BASE_URL,
} from "./llm-provider.js";
import { buildTailoredOverlays, type MemeTextOverlay } from "./meme-text.js";
import type { Candidate } from "./candidate.js";

export type { SuggestionResult } from "@memedrop/shared";

const SUGGESTION_CACHE_TTL_MS = 5 * 60 * 1000;
const SUGGESTION_CACHE_MAX = 200;
const DEFAULT_SUGGESTION_LIMIT = 5;
const MAX_SUGGESTION_LIMIT = 5;
const TEMPLATE_SELECTION_TIMEOUT_MS = Number(
  process.env.MEMEDROP_TEMPLATE_SELECTION_TIMEOUT_MS || 15000
);
const SUGGESTION_LOG_MODE =
  process.env.MEMEDROP_SUGGESTION_LOGS ||
  (process.env.NODE_ENV === "production" ? "compact" : "pretty");

interface CacheEntry {
  result: SuggestionResult[];
  expiresAt: number;
}

interface TemplateCandidate {
  candidate: Candidate;
  template: MemeTemplate;
}

interface TemplateSelection {
  template_id: string;
  reason: string;
  score: number;
}

interface TemplateSelectionResponse {
  suggestions?: Array<{
    template_id?: string;
    reason?: string;
    score?: number;
  }>;
}

const suggestionCache = new Map<string, CacheEntry>();

export interface SuggestionOptions {
  limit?: number;
  refresh?: boolean;
  cacheKey?: string;
  userId?: string;
}

/**
 * Simple pipeline:
 *   1. Load valid overlay meme templates that exist in the global meme table.
 *   2. Ask the model for the five templates that would be the best meme reply.
 *   3. Generate captions for those five templates in parallel.
 */
export async function getSuggestions(
  tweetText: string,
  options: SuggestionOptions = {}
): Promise<SuggestionResult[]> {
  const limit = normalizeLimit(options.limit);
  const userId = options.userId || DEV_USER_ID;
  const cacheKey = `user:${userId}|${options.cacheKey || `text:${normalizeCacheKey(tweetText)}`}|limit:${limit}|simple:v1`;
  if (!options.refresh) {
    const cached = readCache(cacheKey);
    if (cached) return cached;
  }

  const startedAtMs = performance.now();
  const timings: Array<{ label: string; ms: number }> = [];
  let stageStartedAtMs = startedAtMs;
  const markStage = (label: string) => {
    const nowMs = performance.now();
    timings.push({ label, ms: Math.max(0, Math.round(nowMs - stageStartedAtMs)) });
    stageStartedAtMs = nowMs;
  };

  const available = await loadValidTemplateCandidates();
  markStage("load");

  if (available.length === 0) {
    return [];
  }

  const selections = await selectReplyTemplates(tweetText, available, limit);
  const selected = selections
    .map((selection) => {
      const item = available.find(
        (candidate) => candidate.template.template_id === selection.template_id
      );
      return item ? { ...item, selection } : null;
    })
    .filter((item): item is TemplateCandidate & { selection: TemplateSelection } => Boolean(item));
  markStage("select");

  const overlays = await buildTailoredOverlays(
    tweetText,
    selected.map((item) => item.candidate)
  );
  markStage("captions");

  const result: SuggestionResult[] = selected.map((item, index) => ({
    meme_id: item.candidate.meme_id,
    name: item.candidate.name,
    image_url: item.candidate.image_url,
    tailored_overlay: overlays.get(item.candidate.meme_id) || null,
    use_case_label: "meme reply",
    match_explanation: item.selection.reason || item.template.caption_guidance.pattern,
    score: roundScore(item.selection.score || 1 - index * 0.08),
    source: item.candidate.source,
  }));

  writeCache(cacheKey, result);
  logSuggestionPipeline({
    cacheKey,
    tweetText,
    limit,
    availableCount: available.length,
    returnedCount: result.length,
    overlayCount: overlays.size,
    timings,
    result,
    totalMs: sumTimings(timings),
    wallMs: Math.max(0, Math.round(performance.now() - startedAtMs)),
  });

  return result;
}

export async function getTailoredOverlayForMeme(
  tweetText: string,
  memeId: string
): Promise<MemeTextOverlay | null> {
  const [meme] = await db.select().from(memes).where(eq(memes.id, memeId)).limit(1);
  if (!meme) return null;

  const candidate = rowToCandidate({
    id: meme.id,
    name: meme.name,
    filePath: meme.filePath,
    systemTags: meme.systemTags,
    isEvergreen: meme.isEvergreen,
  });

  const overlays = await buildTailoredOverlays(tweetText, [candidate]);
  return overlays.get(memeId) || null;
}

async function loadValidTemplateCandidates(): Promise<TemplateCandidate[]> {
  const rows = await db.select().from(memes);
  const seenTemplateIds = new Set<string>();
  const result: TemplateCandidate[] = [];

  for (const row of rows) {
    const template = findMemeTemplateForCandidate(row.name, row.id);
    if (!template || !isUsableTemplate(template)) continue;
    if (seenTemplateIds.has(template.template_id)) continue;

    seenTemplateIds.add(template.template_id);
    result.push({
      candidate: rowToCandidate({
        id: row.id,
        name: row.name,
        filePath: row.filePath,
        systemTags: row.systemTags,
        isEvergreen: row.isEvergreen,
      }),
      template,
    });
  }

  return result.sort((a, b) => a.template.name.localeCompare(b.template.name));
}

function rowToCandidate(row: {
  id: string;
  name: string;
  filePath: string;
  systemTags: unknown;
  isEvergreen?: boolean | null;
}): Candidate {
  return {
    meme_id: row.id,
    source: "global",
    name: row.name || "Untitled",
    image_url: row.filePath,
    system_tags: (row.systemTags as Candidate["system_tags"]) || {},
    is_evergreen: row.isEvergreen ?? true,
  };
}

async function selectReplyTemplates(
  tweetText: string,
  available: TemplateCandidate[],
  limit: number
): Promise<TemplateSelection[]> {
  try {
    const modelSelections = await requestTemplateSelection(tweetText, available, limit);
    return fillTemplateSelections(modelSelections, fallbackTemplateSelections(tweetText, available, limit), limit);
  } catch (err) {
    console.warn("[MemeDrop] Template selection failed, using local fallback:", err);
    return fallbackTemplateSelections(tweetText, available, limit);
  }
}

async function requestTemplateSelection(
  tweetText: string,
  available: TemplateCandidate[],
  limit: number
): Promise<TemplateSelection[]> {
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) return [];

  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(TEMPLATE_SELECTION_TIMEOUT_MS),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...openRouterHeaders(),
    },
    body: JSON.stringify({
      model: MEME_QUALITY_MODEL,
      temperature: 0.25,
      max_tokens: 900,
      reasoning: { effort: "low", exclude: true },
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Pick meme templates that would be strong replies to a tweet. Choose templates, not captions. Return JSON only.",
        },
        {
          role: "user",
          content: buildTemplateSelectionPrompt(tweetText, available, limit),
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter template selection failed ${response.status}: ${body.slice(0, 400)}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) return [];

  const parsed = JSON.parse(stripJsonFence(content)) as TemplateSelectionResponse;
  const validIds = new Set(available.map((item) => item.template.template_id));
  const seen = new Set<string>();
  const selections: TemplateSelection[] = [];

  for (const item of parsed.suggestions || []) {
    const templateId = String(item.template_id || "").trim();
    if (!validIds.has(templateId) || seen.has(templateId)) continue;
    seen.add(templateId);
    selections.push({
      template_id: templateId,
      reason: String(item.reason || "").trim() || "Good meme reply fit.",
      score: clampUnitInterval(Number(item.score) || 0.8),
    });
    if (selections.length >= limit) break;
  }

  return selections;
}

function buildTemplateSelectionPrompt(
  tweetText: string,
  available: TemplateCandidate[],
  limit: number
): string {
  const catalog = available.map((item) => ({
    template_id: item.template.template_id,
    name: item.template.name,
    pattern: item.template.caption_guidance.pattern,
    slots: item.template.regions.map((region) => region.role),
  }));

  return `TWEET
${JSON.stringify(tweetText)}

VALID MEME TEMPLATES
${JSON.stringify(catalog)}

TASK
Pick exactly ${limit} templates that would make the best visual meme reply to this tweet.
- Prefer templates whose established joke grammar fits the tweet.
- Do not pick a template just because one keyword overlaps.
- Pick different joke shapes when possible.
- Only use template_id values from the catalog.
- Return JSON only: {"suggestions":[{"template_id":"...","reason":"short reason","score":0.0}]}`;
}

function fallbackTemplateSelections(
  tweetText: string,
  available: TemplateCandidate[],
  limit: number
): TemplateSelection[] {
  const tweetTokens = tokenize(tweetText);
  const scored = available.map((item, index) => {
    const searchable = [
      item.template.name,
      item.template.aliases.join(" "),
      item.template.caption_guidance.pattern,
      ...item.template.caption_guidance.good_examples.flatMap((example) => Object.values(example)),
      item.candidate.system_tags.emotion || "",
      ...(item.candidate.system_tags.use_cases || []),
      ...(item.candidate.system_tags.vibes || []),
      ...(item.candidate.system_tags.example_contexts || []),
    ].join(" ");
    const templateTokens = new Set(tokenize(searchable));
    let hits = 0;
    for (const token of tweetTokens) {
      if (templateTokens.has(token)) hits += 1;
    }
    const evergreenBoost = item.candidate.is_evergreen ? 0.05 : 0;
    const classicBoost = Math.max(0, 0.08 - index * 0.002);
    const score = Math.min(1, 0.45 + hits * 0.08 + evergreenBoost + classicBoost);
    return { item, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ item, score }) => ({
      template_id: item.template.template_id,
      reason: item.template.caption_guidance.pattern,
      score,
    }));
}

function fillTemplateSelections(
  primary: TemplateSelection[],
  fallback: TemplateSelection[],
  limit: number
): TemplateSelection[] {
  const seen = new Set<string>();
  const result: TemplateSelection[] = [];

  for (const item of [...primary, ...fallback]) {
    if (seen.has(item.template_id)) continue;
    seen.add(item.template_id);
    result.push(item);
    if (result.length >= limit) break;
  }

  return result;
}

function isUsableTemplate(template: MemeTemplate): boolean {
  return (
    template.supports_overlay &&
    template.quality !== "disabled" &&
    template.regions.length > 0
  );
}

function tokenize(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .match(/[a-z0-9][a-z0-9_'’-]*/g)
        ?.filter((token) => token.length > 2) || []
    )
  );
}

function normalizeCacheKey(tweetText: string): string {
  return tweetText.trim().replace(/\s+/g, " ").toLowerCase();
}

function readCache(key: string): SuggestionResult[] | null {
  const entry = suggestionCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    suggestionCache.delete(key);
    return null;
  }
  suggestionCache.delete(key);
  suggestionCache.set(key, entry);
  return entry.result;
}

function writeCache(key: string, result: SuggestionResult[]) {
  suggestionCache.set(key, {
    result,
    expiresAt: Date.now() + SUGGESTION_CACHE_TTL_MS,
  });
  if (suggestionCache.size > SUGGESTION_CACHE_MAX) {
    const oldestKey = suggestionCache.keys().next().value;
    if (oldestKey) suggestionCache.delete(oldestKey);
  }
}

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return DEFAULT_SUGGESTION_LIMIT;
  return Math.max(1, Math.min(MAX_SUGGESTION_LIMIT, Math.floor(limit!)));
}

function clampUnitInterval(value: number): number {
  if (!Number.isFinite(value)) return 0.8;
  return Math.max(0, Math.min(1, value));
}

function roundScore(n: number): number {
  return Math.round(Math.max(0, Math.min(1, n)) * 1000) / 1000;
}

function stripJsonFence(content: string): string {
  return content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
}

function sumTimings(timings: Array<{ ms: number }>): number {
  return timings.reduce((sum, item) => sum + item.ms, 0);
}

function logSuggestionPipeline(input: {
  cacheKey: string;
  tweetText: string;
  limit: number;
  availableCount: number;
  returnedCount: number;
  overlayCount: number;
  timings: Array<{ label: string; ms: number }>;
  result: SuggestionResult[];
  totalMs: number;
  wallMs: number;
}) {
  if (SUGGESTION_LOG_MODE === "off") return;

  if (SUGGESTION_LOG_MODE === "compact") {
    const driftText =
      Math.abs(input.wallMs - input.totalMs) > 1000 ? ` wall=${input.wallMs}ms` : "";
    console.log(
      `[MemeDrop] suggestions cache=${safeLogCacheKey(input.cacheKey)} total=${input.totalMs}ms ` +
        `stages=${compactTimingText(input.timings)}${driftText} ` +
        `limit=${input.limit} templates=${input.availableCount} returned=${input.returnedCount} captions=${input.overlayCount}`
    );
    return;
  }

  const timingText = input.timings
    .map((item) => `${item.label.padEnd(10)} ${String(item.ms).padStart(5)}ms`)
    .join("\n");
  const resultText = input.result
    .map((suggestion, index) => {
      const caption = suggestion.tailored_overlay?.enabled ? "caption" : "plain";
      return `${String(index + 1).padStart(2)}. ${suggestion.name} (${suggestion.score}) ${caption}`;
    })
    .join("\n");

  console.log(`
[MemeDrop] Suggestion pipeline
--------------------------------
cache      ${safeLogCacheKey(input.cacheKey)}
total      ${input.totalMs}ms
wall       ${input.wallMs}ms
tweet      ${safeLogTweetText(input.tweetText)}

budgets
  limit       ${input.limit}
  templates   ${input.availableCount}
  returned    ${input.returnedCount}
  captions    ${input.overlayCount}

timings
${timingText}

results
${resultText}
`);
}

function compactTimingText(timings: Array<{ label: string; ms: number }>): string {
  return timings.map((item) => `${item.label}:${item.ms}`).join(",");
}

function previewLogText(text: string, maxLength = 180): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3)}...`;
}

export function safeLogCacheKey(cacheKey: string): string {
  return `sha256:${createHash("sha256").update(cacheKey).digest("hex").slice(0, 16)}`;
}

export function safeLogTweetText(text: string): string {
  const mode = suggestionLogTextMode();
  if (mode === "full") return text.trim().replace(/\s+/g, " ");
  if (mode === "preview") return previewLogText(text);
  return `[redacted:${createHash("sha256").update(text).digest("hex").slice(0, 12)}]`;
}

function suggestionLogTextMode(): "full" | "preview" | "redacted" {
  const configured = process.env.MEMEDROP_SUGGESTION_LOG_TEXT;
  if (configured === "full" || configured === "preview" || configured === "redacted") {
    return configured;
  }
  return process.env.NODE_ENV === "production" ? "redacted" : "preview";
}
