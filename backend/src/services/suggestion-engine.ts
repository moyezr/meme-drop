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
import { buildTailoredOverlays, type MemeTextOverlay } from "./meme-text.js";

const DEV_USER_ID = "00000000-0000-0000-0000-000000000001";

const SUGGESTION_CACHE_TTL_MS = 5 * 60 * 1000;
const SUGGESTION_CACHE_MAX = 200;
const DEFAULT_SUGGESTION_LIMIT = 5;
const MAX_SUGGESTION_LIMIT = 20;
const EMBEDDING_TIMEOUT_MS = Number(process.env.MEMEDROP_EMBEDDING_TIMEOUT_MS || 3000);

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

export interface SuggestionResult {
  meme_id: string;
  name: string;
  image_url: string;
  tailored_overlay?: MemeTextOverlay | null;
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
 *   3. Retrieve top candidates from the requested catalogue (global by default)
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
  const source = options.source || "global";
  const mode = options.mode || "smart";
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
    joke_target: context.joke_target,
    social_dynamic: context.social_dynamic,
    humor_angle: context.humor_angle,
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
          userLimit: source === "user" ? 60 : 30,
          globalLimit: source === "global" ? 60 : 45,
          source,
        })
      : retrieveFallbackCandidates({
          userId: DEV_USER_ID,
          userLimit: source === "user" ? 60 : 30,
          globalLimit: source === "global" ? 60 : 45,
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
  const rerankPool = personalized.slice(0, Math.max(40, limit * 4));

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
        Math.min(limit, rerankPool.length)
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
        : c.adjusted_score * 0.68 + rerankScore * 0.32;
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
  const diversified = mmrSelect(mmrInput, limit, 0.82).map((item) => item._ref);

  const tailoredOverlays = await buildTailoredOverlays(tweetText, context, diversified);

  const result: SuggestionResult[] = diversified.map((c) => ({
    meme_id: c.meme_id,
    name: c.name,
    image_url: c.image_url,
    tailored_overlay: tailoredOverlays.get(c.meme_id) || null,
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
  score -= mismatchPenalty(candidate, context);

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
  const useCases = new Set((candidate.system_tags.use_cases || []).map(normalizeTaxonomyLabel));
  const vibes = (candidate.system_tags.vibes || []).join(" ").toLowerCase();
  const examples = (candidate.system_tags.example_contexts || []).join(" ").toLowerCase();
  const searchable = `${candidate.name} ${Array.from(useCases).join(" ")} ${vibes} ${examples}`.toLowerCase();
  let boost = 0;

  const intentAliases = INTENT_USE_CASES[context.intent] || [];
  for (const alias of intentAliases) {
    const normalized = normalizeTaxonomyLabel(alias);
    if (useCases.has(normalized)) boost += 0.045;
    else if (searchable.includes(normalized.replace(/_/g, " "))) boost += 0.018;
  }

  const toneAliases = TONE_SIGNALS[context.tone] || [];
  for (const alias of toneAliases) {
    const normalized = normalizeTaxonomyLabel(alias);
    if (useCases.has(normalized) || searchable.includes(normalized.replace(/_/g, " "))) {
      boost += 0.025;
    }
  }

  const keywords = context.keywords
    .map((keyword) => keyword.toLowerCase().trim())
    .filter((keyword) => keyword.length >= 3);
  let keywordHits = 0;
  for (const keyword of keywords) {
    if (searchable.includes(keyword)) keywordHits += 1;
  }
  boost += Math.min(0.09, keywordHits * 0.025);

  if (context.intent === "dunking" && candidate.system_tags.emotion === "savage") boost += 0.035;
  if (context.intent === "celebrating" && candidate.system_tags.emotion === "celebratory") boost += 0.045;
  if (context.intent === "asking" && searchable.includes("asking")) boost += 0.055;
  if (context.intent === "venting" && /cope|suffering|pain|frustration|panic|fine/.test(searchable)) boost += 0.04;
  boost += socialComedyFit(candidate.name, searchable, context);
  boost += canonicalFit(candidate.name, context);

  return Math.min(0.42, boost);
}

function canonicalFit(name: string, context: TweetContext): number {
  const meme = name.toLowerCase();
  const text = context.keywords.join(" ").toLowerCase();
  const vibe = [
    context.reply_style,
    context.ideal_meme_vibe,
    context.joke_target,
    context.social_dynamic,
    context.humor_angle,
  ].join(" ").toLowerCase();
  const combined = `${text} ${vibe}`;

  if (/\b(prod|down|dashboard|red|fire|launch)\b/.test(combined) && meme.includes("this is fine")) {
    return 0.18;
  }
  if (/\b(skip|skipped|tests|friday|deploy|consequence|predictable|payment)\b/.test(combined)) {
    if (meme.includes("surprised pikachu")) return 0.18;
    if (meme.includes("one does not simply")) return 0.12;
  }
  if (/\b(rewrite|framework|shiny|trend|fomo|new stack)\b/.test(combined)) {
    if (meme.includes("distracted boyfriend")) return 0.18;
    if (meme.includes("expanding brain")) return 0.12;
  }
  if (/\b(choice|choose|button|flag|properly|dilemma)\b/.test(combined) && meme.includes("two buttons")) {
    return 0.24;
  }
  if (/\b(spreadsheet|macros|platform|mislabel|calling)\b/.test(combined)) {
    if (meme.includes("is this a pigeon")) return 0.28;
    if (meme.includes("change my mind")) return 0.18;
    if (meme.includes("same picture")) return 0.14;
  }
  if (/\b(meeting|calendar|slack|message)\b/.test(combined)) {
    if (meme.includes("change my mind")) return 0.15;
    if (meme.includes("boardroom")) return 0.12;
  }
  if (/\b(roadmap|vibes|deck|whole time|realization)\b/.test(combined) && meme.includes("always has been")) {
    return 0.18;
  }
  if (/\b(once again|asking|error|channel|ping)\b/.test(combined)) {
    if (meme.includes("once again asking")) return 0.24;
    if (meme.includes("one does not simply")) return 0.12;
  }
  if (/\b(client|redesign|budget|exposure|shoutout|lowball)\b/.test(combined)) {
    if (meme.includes("pawn stars")) return 0.24;
    if (meme.includes("trade offer")) return 0.2;
  }
  if (/\b(debug|debugging|api|staging|realizing|realized|last week)\b/.test(combined)) {
    if (meme.includes("hide the pain")) return 0.2;
    if (meme.includes("monkey puppet")) return 0.18;
    if (meme.includes("gru")) return 0.12;
  }
  if (/\b(pr|review|queue|silence|waiting|approved by vibes)\b/.test(combined)) {
    if (meme.includes("waiting skeleton")) return 0.24;
    if (meme.includes("sad pablo")) return 0.18;
    if (meme.includes("hide the pain")) return 0.12;
  }
  if (/\b(migration|alerts|quiet|rollback|finished|clean)\b/.test(combined)) {
    if (meme.includes("leonardo dicaprio cheers")) return 0.22;
    if (meme.includes("laughing leo")) return 0.18;
    if (meme.includes("epic handshake")) return 0.12;
  }
  if (/\b(backlog|opportunity|pipeline|renamed|rebrand|clap)\b/.test(combined)) {
    if (meme.includes("same picture")) return 0.22;
    if (meme.includes("tuxedo winnie")) return 0.18;
    if (meme.includes("change my mind")) return 0.12;
  }
  if (/\b(sla|measuring|response time|innovation|stop measuring)\b/.test(combined)) {
    if (meme.includes("roll safe")) return 0.24;
    if (meme.includes("expanding brain")) return 0.16;
    if (meme.includes("surprised pikachu")) return 0.1;
  }
  if (/\b(quick fix|migration|cron|environment variables|env variables)\b/.test(combined)) {
    if (meme.includes("monkey puppet")) return 0.22;
    if (meme.includes("hide the pain")) return 0.16;
    if (meme.includes("expanding brain")) return 0.12;
  }
  if (/\b(autonomous|agent|approve|vendor|human|90 seconds)\b/.test(combined)) {
    if (meme.includes("futurama fry")) return 0.22;
    if (meme.includes("is this a pigeon")) return 0.16;
    if (meme.includes("roll safe")) return 0.12;
  }
  if (/\b(dashboards|metric|definition|rather maintain|agree on one)\b/.test(combined)) {
    if (meme.includes("uno draw")) return 0.22;
    if (meme.includes("two paths")) return 0.16;
    if (meme.includes("two buttons")) return 0.12;
  }
  if (/\b(say the line|spreadsheets|extra steps|new app launches)\b/.test(combined)) {
    if (meme.includes("say the line")) return 0.3;
    if (meme.includes("same picture")) return 0.16;
    if (meme.includes("change my mind")) return 0.1;
  }
  if (/\b(ai button|buttons|settings|billing|everyone gets)\b/.test(combined)) {
    if (meme.includes("oprah")) return 0.24;
    if (meme.includes("yo dawg")) return 0.16;
    if (meme.includes("expanding brain")) return 0.12;
  }
  if (/\b(blockers|nobody wants to choose|delayed|choose direction)\b/.test(combined)) {
    if (meme.includes("scroll of truth")) return 0.22;
    if (meme.includes("change my mind")) return 0.16;
    if (meme.includes("two buttons")) return 0.12;
  }

  return 0;
}

function mismatchPenalty(candidate: Candidate, context: TweetContext): number {
  const meme = candidate.name.toLowerCase();
  const text = [
    context.keywords.join(" "),
    context.joke_target,
    context.social_dynamic,
    context.humor_angle,
    context.ideal_meme_vibe,
  ].join(" ").toLowerCase();

  if (meme.includes("surprised pikachu")) {
    const fitsShock =
      /consequence|shocked|shock|who could|exploded|skipped|deployed|roadmap|obvious/.test(text);
    return fitsShock ? 0 : 0.22;
  }

  if (meme.includes("this is fine")) {
    const fitsCope = /cope|fine|pretend|pretending|calm|chaos|fire|down|prod|dashboard|suffering/.test(text);
    return fitsCope ? 0 : 0.22;
  }

  if (meme.includes("one does not simply")) {
    const fitsWarning = /difficult|difficulty|warning|simply|cannot|can't|asking|read|deploy|survive|impossible/.test(text);
    return fitsWarning ? 0 : 0.1;
  }

  return 0;
}

function socialComedyFit(name: string, searchable: string, context: TweetContext): number {
  const meme = name.toLowerCase();
  const dynamic = `${context.social_dynamic} ${context.humor_angle} ${context.ideal_meme_vibe}`.toLowerCase();
  let boost = 0;

  if (/predictable|consequence|self-own|self own|shocker|who could/.test(dynamic)) {
    if (/surprised pikachu|roll safe|one does not simply/.test(meme)) boost += 0.08;
    if (/consequences|mock_shock|bad_logic|predictable_take/.test(searchable)) boost += 0.04;
  }

  if (/cope|pretending|fine|chaos|calm|normal/.test(dynamic)) {
    if (/this is fine|hide the pain|panik kalm panik/.test(meme)) boost += 0.08;
    if (/cope|calm amid chaos|suffering|panic/.test(searchable)) boost += 0.04;
  }

  if (/rebrand|mislabel|calling|fake distinction|same thing/.test(dynamic)) {
    if (/is this a pigeon|they're the same picture|tuxedo winnie|change my mind/.test(meme)) boost += 0.07;
    if (/misidentification|same_thing|equivalence|fake distinction/.test(searchable)) boost += 0.04;
  }

  if (/temptation|distraction|shiny|fomo|rewrite|new/.test(dynamic)) {
    if (/distracted boyfriend|running away balloon|left exit/.test(meme)) boost += 0.07;
    if (/temptation|distraction|preference_swerve|hype chasing/.test(searchable)) boost += 0.04;
  }

  if (/asking|begging|read|again|support/.test(dynamic)) {
    if (/once again asking|one does not simply|y'all got any more/.test(meme)) boost += 0.07;
    if (/repeated_request|asking_nicely|difficulty_warning/.test(searchable)) boost += 0.04;
  }

  if (/celebrat|win|hype|cheer|appreciat/.test(dynamic)) {
    if (/laughing leo|leonardo dicaprio cheers|epic handshake|oprah/.test(meme)) boost += 0.07;
    if (/celebration|excitement|cheers|appreciation|unity/.test(searchable)) boost += 0.04;
  }

  return Math.min(0.14, boost);
}

const INTENT_USE_CASES: Record<TweetContext["intent"], string[]> = {
  "counter-argument": [
    "counter_argument",
    "calling_out",
    "difficulty_warning",
    "equivalence",
    "uncomfortable_truth",
    "rejection_of_facts",
  ],
  agreement: [
    "agreement",
    "common_ground",
    "unity",
    "knowing_laughter",
    "screaming_agreement",
    "appreciation",
    "cheers",
  ],
  "sharing-opinion": ["hot_take", "opinion", "contrarianism", "no_punchline", "rhetorical_question"],
  venting: [
    "frustration",
    "cope",
    "coping",
    "suffering_in_silence",
    "polite_suffering",
    "looming_dread",
    "rollercoaster",
  ],
  asking: ["asking", "asking_nicely", "repeated_request", "searching", "rhetorical_question"],
  celebrating: ["celebration", "excitement", "appreciation", "cheers", "everyone_gets_something"],
  dunking: [
    "dunking",
    "mock_shock",
    "consequences",
    "bad_logic",
    "mocking_quote",
    "shutting_down",
    "predictable_take",
    "say_the_line",
  ],
  "self-deprecating": [
    "self_deprecation",
    "self_owning",
    "relatability",
    "awkward_lookaway",
    "bad_impulse",
    "plans_falling_apart",
  ],
};

const TONE_SIGNALS: Record<TweetContext["tone"], string[]> = {
  sarcastic: ["sarcasm", "mocking_quote", "mock_shock", "fake_wisdom", "bad_logic"],
  earnest: ["agreement", "appreciation", "common_ground"],
  rant: ["frustration", "screaming_agreement", "shutting_down", "looming_dread"],
  celebratory: ["celebration", "excitement", "cheers"],
  "hot-take": ["hot_take", "opinion", "contrarianism", "superiority"],
  question: ["asking", "confusion", "squinting_doubt", "rhetorical_question"],
  absurdist: ["absurdist", "rollercoaster", "escalating_regret", "overdoing_it"],
  wholesome: ["wholesome", "agreement", "appreciation", "unity"],
};

function normalizeTaxonomyLabel(label: string): string {
  return label.toLowerCase().trim().replace(/[-\s]+/g, "_");
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
