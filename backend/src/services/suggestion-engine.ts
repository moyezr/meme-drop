import {
  analyzeTweet,
  heuristicTweetContext,
  type TweetContext,
} from "./context-analyzer.js";
import { generateEmbedding } from "./embedding.js";
import { buildTweetDescriptor } from "./descriptor.js";
import {
  retrieveCandidates,
  retrieveFallbackCandidates,
  type Candidate,
} from "./retrieval.js";
import { loadUserPreferences, applyPreferences } from "./personalization.js";
import { rerankCandidates, type RerankInput } from "./reranker.js";
import { mmrSelect } from "./diversity.js";

const DEV_USER_ID = "00000000-0000-0000-0000-000000000001";

const SUGGESTION_CACHE_TTL_MS = 5 * 60 * 1000;
const SUGGESTION_CACHE_MAX = 200;
const DEFAULT_SUGGESTION_LIMIT = 10;
const MAX_SUGGESTION_LIMIT = 20;
const EMBEDDING_TIMEOUT_MS = 1200;

interface CacheEntry {
  result: SuggestionResult[];
  expiresAt: number;
}

const suggestionCache = new Map<string, CacheEntry>();

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

/**
 * Clear all cached suggestions. Called when the meme library changes so
 * stale responses don't hide a newly-saved meme.
 */
export function invalidateSuggestionCache() {
  suggestionCache.clear();
}

export interface SuggestionResult {
  meme_id: string;
  name: string;
  image_url: string;
  use_case_label: string; // the "punch reason" from the re-ranker
  match_explanation: string;
  score: number;
  source: "user" | "global";
  tweet_context?: TweetContext;
  score_breakdown?: {
    similarity: number;
    personalized: number;
    rerank?: number;
    diversity: number;
  };
}

export interface SuggestionOptions {
  limit?: number;
  source?: "all" | "user" | "global";
  refresh?: boolean;
  mode?: "fast" | "smart";
}

/**
 * Pipeline:
 *   1. Analyze tweet  → structured context + natural-language "ideal vibe"
 *   2. Embed the vibe descriptor
 *   3. Retrieve top candidates from user + global memes (pgvector)
 *   4. Personalize scores using recent usage events
 *   5. LLM re-rank top 20 with punchy explanations
 *   6. MMR diversity pass so the returned strip isn't 5 near-dupes
 *
 * Every stage has a graceful degradation path so local dev works even if
 * one service hiccups (e.g. re-ranker times out → fall back to vector score).
 */
export async function getSuggestions(
  tweetText: string,
  options: SuggestionOptions = {}
): Promise<SuggestionResult[]> {
  const limit = normalizeLimit(options.limit);
  const source = options.source || "all";
  const mode = options.mode || "fast";
  const cacheKey = `${normalizeCacheKey(tweetText)}|limit:${limit}|source:${source}|mode:${mode}`;
  if (!options.refresh) {
    const cached = readCache(cacheKey);
    if (cached) return cached;
  }

  // Prefs don't depend on the tweet, so start them up front and let them
  // overlap with the (serial) LLM + embed + retrieve chain.
  const prefsPromise = loadUserPreferences(DEV_USER_ID);

  const context =
    mode === "smart" ? await analyzeTweet(tweetText) : heuristicTweetContext(tweetText);

  const descriptor = buildTweetDescriptor({
    tweet_text: tweetText,
    sentiment: context.sentiment,
    tone: context.tone,
    topic: context.topic,
    intent: context.intent,
    reply_style: context.reply_style,
    ideal_meme_vibe: context.ideal_meme_vibe,
  });
  const queryEmbedding = await withTimeout(
    generateEmbedding(descriptor),
    EMBEDDING_TIMEOUT_MS,
    null
  );

  const [candidates, prefs] = await Promise.all([
    queryEmbedding && isUsableEmbedding(queryEmbedding)
      ? retrieveCandidates({
          userId: DEV_USER_ID,
          queryEmbedding,
          userLimit: source === "user" ? 40 : 20,
          globalLimit: source === "global" ? 40 : 30,
          source,
        })
      : retrieveFallbackCandidates({
          userId: DEV_USER_ID,
          userLimit: source === "user" ? 40 : 20,
          globalLimit: source === "global" ? 40 : 30,
          source,
        }),
    prefsPromise,
  ]);

  if (candidates.length === 0) {
    return [];
  }

  // Personalized score (similarity + emotion/use_case nudges + recency penalty).
  const personalized = candidates.map((c) => ({
    ...c,
    adjusted_score: scoreCandidate(c, context, prefs),
  }));

  personalized.sort((a, b) => b.adjusted_score - a.adjusted_score);
  const rerankPool = personalized.slice(0, Math.max(20, limit * 2));

  // LLM re-rank is intentionally opt-in. The extension needs sub-second
  // results; vector + heuristic scoring is the default fast path.
  let rerankResults: Awaited<ReturnType<typeof rerankCandidates>> = [];
  if (mode === "smart") {
    try {
      const input: RerankInput[] = rerankPool.map((c) => ({
        meme_id: c.meme_id,
        name: c.name,
        emotion: c.system_tags.emotion,
        use_cases: c.system_tags.use_cases || [],
        vibes: c.system_tags.vibes || [],
        example_contexts: c.system_tags.example_contexts || [],
        prior_score: c.adjusted_score,
      }));
      rerankResults = await rerankCandidates(
        tweetText,
        context,
        input,
        Math.min(12, rerankPool.length)
      );
    } catch (err) {
      console.warn("[MemeDrop] Re-rank failed, falling back to vector order:", err);
    }
  }

  // Stitch re-rank results back onto the candidate objects.
  const rerankById = new Map(rerankResults.map((r) => [r.meme_id, r]));

  const finalScored = rerankPool.map((c) => {
    const r = rerankById.get(c.meme_id);
    const rerankScore = r
      ? Math.max(0, 1 - (r.rank - 1) / Math.max(1, rerankResults.length)) *
          0.85 +
        r.confidence * 0.15
      : undefined;
    const score =
      rerankScore === undefined
        ? c.adjusted_score
        : c.adjusted_score * 0.45 + rerankScore * 0.55;
    return {
      ...c,
      punch_reason: r?.punch_reason,
      score,
      score_breakdown: {
        similarity: roundScore(c.similarity),
        personalized: roundScore(c.adjusted_score),
        rerank: rerankScore === undefined ? undefined : roundScore(rerankScore),
        diversity: roundScore(score),
      },
    };
  });

  // MMR to spread the top results across vibes.
  const mmrInput = finalScored.map((c) => ({
    id: c.meme_id,
    score: c.score,
    embedding: c.embedding,
    _ref: c,
  }));
  const diversified = mmrSelect(mmrInput, limit, 0.72).map((item) => item._ref);

  const result: SuggestionResult[] = diversified.map((c) => ({
    meme_id: c.meme_id,
    name: c.name,
    image_url: c.image_url,
    use_case_label:
      c.punch_reason ||
      (c.system_tags.use_cases?.[0] || "reaction").replace(/_/g, " "),
    match_explanation: buildMatchExplanation(c, context),
    score: roundScore(c.score),
    source: c.source,
    tweet_context: context,
    score_breakdown: c.score_breakdown,
  }));

  writeCache(cacheKey, result);
  return result;
}

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return DEFAULT_SUGGESTION_LIMIT;
  return Math.max(1, Math.min(MAX_SUGGESTION_LIMIT, Math.floor(limit!)));
}

function scoreCandidate(
  candidate: Candidate,
  context: TweetContext,
  prefs: Awaited<ReturnType<typeof loadUserPreferences>>
): number {
  let score = applyPreferences(
    {
      meme_id: candidate.meme_id,
      similarity: candidate.similarity,
      system_tags: candidate.system_tags,
    },
    prefs
  );

  if (candidate.source === "user") score += 0.06;
  if (!candidate.is_evergreen) score -= 0.04;
  score += taxonomyFit(candidate, context);

  if (candidate.use_count > 0 && candidate.last_used_at) {
    const daysSinceUsed =
      (Date.now() - new Date(candidate.last_used_at).getTime()) /
      (24 * 60 * 60 * 1000);
    if (Number.isFinite(daysSinceUsed) && daysSinceUsed < 7) {
      score -= (7 - daysSinceUsed) * 0.015;
    }
  }

  return Math.max(0, Math.min(1.25, score));
}

function taxonomyFit(candidate: Candidate, context: TweetContext): number {
  const useCases = new Set(candidate.system_tags.use_cases || []);
  const vibes = (candidate.system_tags.vibes || []).join(" ").toLowerCase();
  let boost = 0;

  if (context.intent === "dunking" && useCases.has("dunking")) boost += 0.08;
  if (context.intent === "venting" && useCases.has("venting")) boost += 0.07;
  if (context.intent === "agreement" && useCases.has("agreement")) boost += 0.06;
  if (context.intent === "asking" && useCases.has("asking")) boost += 0.05;
  if (context.tone === "sarcastic" && vibes.includes("sarcastic")) boost += 0.04;
  if (context.tone === "wholesome" && vibes.includes("wholesome")) boost += 0.04;

  return boost;
}

function roundScore(score: number): number {
  return Math.round(score * 1000) / 1000;
}

function isUsableEmbedding(embedding: number[]): boolean {
  return embedding.some((value) => Math.abs(value) > 0.000001);
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function buildMatchExplanation(
  c: { similarity: number; system_tags: { emotion?: string; vibes?: string[] } },
  ctx: TweetContext
): string {
  const pct = Math.round(Math.max(0, Math.min(1, c.similarity)) * 100);
  const vibe = (c.system_tags.vibes || [])[0];
  const emo = c.system_tags.emotion;
  const parts: string[] = [`${pct}% vibe match`];
  if (vibe) parts.push(vibe);
  else if (emo) parts.push(emo);
  parts.push(`for ${ctx.tone} ${ctx.intent.replace(/_/g, " ")}`);
  return parts.join(" • ");
}
