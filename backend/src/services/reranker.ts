import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import type { TweetContext } from "./context-analyzer.js";

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

  // Trim candidate list to reasonable size for the re-ranker (cost + latency).
  const input = candidates.slice(0, 20);

  const candidateText = input
    .map((c, i) => {
      const vibes = c.vibes.length ? ` | vibe: ${c.vibes.join(", ")}` : "";
      const useCases = c.use_cases.length
        ? ` | use: ${c.use_cases.join(", ").replace(/_/g, " ")}`
        : "";
      const examples = c.example_contexts.length
        ? ` | eg: ${c.example_contexts[0]}`
        : "";
      return `#${i + 1} [id=${c.meme_id}] ${c.name} (${c.emotion || "?"})${vibes}${useCases}${examples}`;
    })
    .join("\n");

  const { object } = await generateObject({
    model: openai(process.env.MEMEDROP_RERANK_MODEL || "gpt-4o-mini"),
    schema,
    temperature: 0.4,
    system: `You are a meme curator picking the funniest, most on-point meme replies to a tweet.

Rules:
- Prefer a meme whose vibe matches the *reply intent*, not just the tweet topic.
- A meme that's slightly lower in similarity but a perfect comedic fit beats a high-similarity mismatch.
- Avoid picking multiple memes with the same vibe — one per vibe-family.
- punch_reason must sound like something a friend would text — punchy, concrete, no generic words like "reaction" or "relevant".

Return the top ${topN} in order, each with a punch_reason and confidence.
Only use meme_ids from the candidate list.`,
    prompt: `Tweet: "${tweetText}"

Tweet analysis:
- tone: ${context.tone}, sentiment: ${context.sentiment}, topic: ${context.topic}
- intent: ${context.intent}, intensity: ${context.intensity.toFixed(2)}
- ideal reply style: ${context.reply_style}
- ideal meme vibe: ${context.ideal_meme_vibe}
- keywords: ${context.keywords.join(", ")}

Candidates:
${candidateText}

Pick the top ${topN} candidates as meme replies. Rank them 1..${topN}.`,
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
