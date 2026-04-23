import { db } from "../db/index.js";
import { sql } from "drizzle-orm";

/**
 * A rough preference signal derived from a user's recent `used` events.
 * Tracks which emotions and use_cases they actually pick (not which we
 * suggest). We apply this as a small multiplicative boost during scoring so
 * "cold" users behave normally, and the nudge only kicks in once there's
 * real signal (min threshold of interactions).
 */
export interface UserPreferences {
  totalUsed: number;
  emotionWeights: Map<string, number>; // normalized 0..1
  useCaseWeights: Map<string, number>; // normalized 0..1
  recentlyUsedMemeIds: Set<string>; // used in last 48h
}

const LOOKBACK_DAYS = 30;
const RECENT_HOURS = 48;

export async function loadUserPreferences(
  userId: string
): Promise<UserPreferences> {
  const events = await db.execute(sql`
    SELECT
      u.action,
      u.created_at,
      u.global_meme_id,
      u.user_meme_id,
      COALESCE(m.system_tags, um.system_tags) AS system_tags
    FROM usage_events u
    LEFT JOIN memes m ON m.id = u.global_meme_id
    LEFT JOIN user_memes um ON um.id = u.user_meme_id
    WHERE u.user_id = ${userId}
      AND u.created_at > NOW() - INTERVAL '${sql.raw(String(LOOKBACK_DAYS))} days'
      AND u.action = 'used'
  `);

  const emotionCounts = new Map<string, number>();
  const useCaseCounts = new Map<string, number>();
  const recent = new Set<string>();
  const recencyCutoff = Date.now() - RECENT_HOURS * 60 * 60 * 1000;
  let total = 0;

  for (const row of events.rows) {
    total++;
    const tags = (row.system_tags as {
      emotion?: string;
      use_cases?: string[];
    } | null) || {};

    if (tags.emotion) {
      emotionCounts.set(tags.emotion, (emotionCounts.get(tags.emotion) || 0) + 1);
    }
    for (const uc of tags.use_cases || []) {
      useCaseCounts.set(uc, (useCaseCounts.get(uc) || 0) + 1);
    }

    const createdAt = row.created_at
      ? new Date(row.created_at as string).getTime()
      : 0;
    if (createdAt > recencyCutoff) {
      const id = (row.global_meme_id || row.user_meme_id) as string | null;
      if (id) recent.add(id);
    }
  }

  const normalize = (counts: Map<string, number>): Map<string, number> => {
    const max = Math.max(1, ...counts.values());
    return new Map(
      Array.from(counts.entries()).map(([k, v]) => [k, v / max])
    );
  };

  return {
    totalUsed: total,
    emotionWeights: normalize(emotionCounts),
    useCaseWeights: normalize(useCaseCounts),
    recentlyUsedMemeIds: recent,
  };
}

interface PreferenceAdjustedCandidate {
  meme_id: string;
  similarity: number;
  system_tags: {
    emotion?: string;
    use_cases?: string[];
  };
}

/**
 * Applies preference + recency adjustments.
 * Returns an adjusted score in roughly the same 0..1 range as similarity,
 * with small nudges applied so the LLM re-ranker still has real work to do.
 */
export function applyPreferences<T extends PreferenceAdjustedCandidate>(
  candidate: T,
  prefs: UserPreferences
): number {
  let score = candidate.similarity;

  // Only start personalizing once we have enough signal. Below the
  // threshold the prefs map is noisy and would actively mislead.
  const confident = prefs.totalUsed >= 5;

  if (confident) {
    const emo = candidate.system_tags.emotion;
    const emoBoost = emo ? (prefs.emotionWeights.get(emo) || 0) * 0.08 : 0;

    let useCaseBoost = 0;
    for (const uc of candidate.system_tags.use_cases || []) {
      useCaseBoost = Math.max(
        useCaseBoost,
        (prefs.useCaseWeights.get(uc) || 0) * 0.08
      );
    }

    score += emoBoost + useCaseBoost;
  }

  // Recency penalty — don't repeat a meme they used this week.
  if (prefs.recentlyUsedMemeIds.has(candidate.meme_id)) {
    score -= 0.25;
  }

  return score;
}
