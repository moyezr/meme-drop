import { analyzeTweet, type TweetContext } from "./context-analyzer.js";
import { generateEmbedding } from "./embedding.js";
import { buildTweetDescriptor } from "./descriptor.js";
import { retrieveCandidates, type Candidate } from "./retrieval.js";
import { loadUserPreferences, applyPreferences } from "./personalization.js";
import { rerankCandidates, type RerankInput } from "./reranker.js";
import { mmrSelect } from "./diversity.js";

const DEV_USER_ID = "00000000-0000-0000-0000-000000000001";

const SUGGESTION_CACHE_TTL_MS = 5 * 60 * 1000;
const SUGGESTION_CACHE_MAX = 200;

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
  tweetText: string
): Promise<SuggestionResult[]> {
  const cacheKey = normalizeCacheKey(tweetText);
  const cached = readCache(cacheKey);
  if (cached) return cached;

  // Prefs don't depend on the tweet, so start them up front and let them
  // overlap with the (serial) LLM + embed + retrieve chain.
  const prefsPromise = loadUserPreferences(DEV_USER_ID);

  const context = await analyzeTweet(tweetText);

  const descriptor = buildTweetDescriptor({
    tweet_text: tweetText,
    sentiment: context.sentiment,
    tone: context.tone,
    topic: context.topic,
    intent: context.intent,
    reply_style: context.reply_style,
    ideal_meme_vibe: context.ideal_meme_vibe,
  });
  const queryEmbedding = await generateEmbedding(descriptor);

  const [candidates, prefs] = await Promise.all([
    retrieveCandidates({
      userId: DEV_USER_ID,
      queryEmbedding,
      userLimit: 15,
      globalLimit: 20,
    }),
    prefsPromise,
  ]);

  if (candidates.length === 0) {
    return [];
  }

  // Personalized score (similarity + emotion/use_case nudges + recency penalty).
  const personalized = candidates.map((c) => ({
    ...c,
    adjusted_score: applyPreferences(
      { meme_id: c.meme_id, similarity: c.similarity, system_tags: c.system_tags },
      prefs
    ),
  }));

  personalized.sort((a, b) => b.adjusted_score - a.adjusted_score);
  const rerankPool = personalized.slice(0, 20);

  // LLM re-rank → punchy explanations.
  let rerankResults: Awaited<ReturnType<typeof rerankCandidates>> = [];
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
    rerankResults = await rerankCandidates(tweetText, context, input, 12);
  } catch (err) {
    console.warn("[MemeDrop] Re-rank failed, falling back to vector order:", err);
  }

  // Stitch re-rank results back onto the candidate objects.
  const rerankById = new Map(rerankResults.map((r) => [r.meme_id, r]));

  const finalScored = rerankPool.map((c) => {
    const r = rerankById.get(c.meme_id);
    // If the re-ranker picked this meme, use its rank (inverted to a score
    // so higher=better); else fall back to the adjusted vector score.
    const score = r
      ? 1 - (r.rank - 1) * 0.05 + r.confidence * 0.1
      : c.adjusted_score * 0.8; // slight penalty so re-ranked picks win ties
    return {
      ...c,
      punch_reason: r?.punch_reason,
      score,
    };
  });

  // MMR to spread the top results across vibes.
  const mmrInput = finalScored.map((c) => ({
    id: c.meme_id,
    score: c.score,
    embedding: c.embedding,
    _ref: c,
  }));
  const diversified = mmrSelect(mmrInput, 10, 0.7).map((item) => item._ref);

  const result: SuggestionResult[] = diversified.map((c) => ({
    meme_id: c.meme_id,
    name: c.name,
    image_url: c.image_url,
    use_case_label:
      c.punch_reason ||
      (c.system_tags.use_cases?.[0] || "reaction").replace(/_/g, " "),
    match_explanation: buildMatchExplanation(c, context),
    score: c.score,
    source: c.source,
    tweet_context: context,
  }));

  writeCache(cacheKey, result);
  return result;
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
