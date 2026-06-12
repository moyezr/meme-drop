import { generateObject } from "ai";
import { z } from "zod";
import type { TweetContext } from "./context-analyzer.js";
import { openrouter, QWEN_PLUS_MODEL } from "./llm-provider.js";

export interface RerankInput {
  meme_id: string;
  name: string;
  emotion?: string;
  use_cases: string[];
  vibes: string[];
  example_contexts: string[];
  prior_score: number;
}

export interface RerankResult {
  meme_id: string;
  rank: number;
  punch_reason: string;
  confidence: number;
}

const schema = z.object({
  picks: z
    .array(
      z.object({
        meme_id: z.string(),
        rank: z
          .number()
          .int()
          .min(1)
          .describe("1 = best fit. Lower is better."),
        punch_reason: z
          .string()
          .describe(
            "2-4 word tag shown to the user, e.g. 'perfect dunk', 'calm cope', 'mocking repeat', 'self-owning arc'. Punchy meme-culture phrasing, no punctuation."
          ),
        confidence: z
          .number()
          .min(0)
          .max(1)
          .describe("How sure you are this meme lands as a reply."),
      })
    )
    .min(1),
});

/**
 * Asks the LLM to re-rank the pre-filtered candidates against the tweet.
 * The LLM sees meme descriptions (not images) — this is the secret sauce
 * that turns cold cosine similarity into "huh, that's actually perfect".
 */
export async function rerankCandidates(
  tweetText: string,
  context: TweetContext,
  candidates: RerankInput[],
  topN: number
): Promise<RerankResult[]> {
  if (candidates.length === 0) return [];

  const candidateText = candidates
    .map((c, i) => {
      const vibes = c.vibes.length ? ` | vibe: ${c.vibes.join(", ")}` : "";
      const useCases = c.use_cases.length
        ? ` | use: ${c.use_cases.join(", ").replace(/_/g, " ")}`
        : "";
      const examples = c.example_contexts.length
        ? ` | eg: ${c.example_contexts[0]}`
        : "";
      return `#${i + 1} [id=${c.meme_id}] ${c.name} (${c.emotion || "?"}, prior=${c.prior_score.toFixed(3)})${vibes}${useCases}${examples}`;
    })
    .join("\n");

  const { object } = await generateObject({
    model: openrouter.chat(QWEN_PLUS_MODEL),
    schema,
    temperature: 0.4,
    maxOutputTokens: 600,
    system: `You are a meme curator picking the funniest, most on-point meme replies to a tweet. Return JSON only. Do not include reasoning, markdown, or extra keys.

The JSON must contain exactly this shape:
{
  "picks": [
    {
      "meme_id": "id from candidate list",
      "rank": 1,
      "punch_reason": "2-4 word tag",
      "confidence": 0.8
    }
  ]
}

Rules:
- Optimize for "would a funny human actually post this?", not "is this semantically related?"
- Prefer memes whose classic joke structure matches the social dynamic and joke target.
- The best pick often highlights the absurdity, contradiction, predictable consequence, self-own, or cope in the tweet.
- A meme that's slightly lower in prior score but a perfect comedic fit beats a high-score mismatch.
- Prefer recognizable meme formats when they fit cleanly; avoid obscure or generic reaction images.
- Avoid picking multiple memes with the same joke shape — one per vibe-family.
- punch_reason must sound like something a friend would text — punchy, concrete, no generic words like "reaction" or "relevant".
- Do not reward a meme just because it shares a keyword with the tweet.

Return exactly ${topN} picks in order, each with a punch_reason and confidence.
Only use meme_ids from the candidate list.`,
    prompt: `Tweet: "${tweetText}"

Tweet analysis:
- tone: ${context.tone}, sentiment: ${context.sentiment}, topic: ${context.topic}
- intent: ${context.intent}, intensity: ${context.intensity.toFixed(2)}
- ideal reply style: ${context.reply_style}
- ideal meme vibe: ${context.ideal_meme_vibe}
- joke target: ${context.joke_target}
- social dynamic: ${context.social_dynamic}
- humor angle: ${context.humor_angle}
- keywords: ${context.keywords.join(", ")}

Candidates:
${candidateText}

Pick exactly ${topN} candidates as meme replies. Rank them 1..${topN}. Do not include more than ${topN} picks. Return only the required JSON object.`,
  });

  // Dedupe ids (LLM sometimes returns same id twice), keep lowest rank.
  const seen = new Map<string, RerankResult>();
  for (const p of object.picks) {
    const existing = seen.get(p.meme_id);
    if (!existing || p.rank < existing.rank) {
      seen.set(p.meme_id, p);
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.rank - b.rank);
}
