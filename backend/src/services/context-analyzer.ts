import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

const schema = z.object({
  sentiment: z.enum(["positive", "negative", "neutral"]),
  tone: z.enum([
    "sarcastic",
    "earnest",
    "rant",
    "celebratory",
    "hot-take",
    "question",
    "absurdist",
    "wholesome",
  ]),
  topic: z.enum([
    "tech",
    "finance",
    "politics",
    "sports",
    "entertainment",
    "personal",
    "culture",
    "relationships",
    "other",
  ]),
  intent: z.enum([
    "counter-argument",
    "agreement",
    "sharing-opinion",
    "venting",
    "asking",
    "celebrating",
    "dunking",
    "self-deprecating",
  ]),
  intensity: z.number().min(0).max(1),
  reply_style: z
    .string()
    .describe(
      "Two to four words describing the ideal reply style, e.g. 'sarcastic agreement', 'exaggerated disappointment', 'calm dunk'"
    ),
  ideal_meme_vibe: z
    .string()
    .describe(
      "One sentence describing the vibe of the ideal meme reply. Should read like meme taxonomy: e.g. 'calm-above-the-chaos energy — This Is Fine territory', or 'loud mocking repetition with deranged face'. 12-20 words."
    ),
  keywords: z
    .array(z.string())
    .min(2)
    .max(6)
    .describe(
      "2-6 salient keywords from the tweet itself (nouns, named entities, distinctive verbs) that would help match a meme about those specific things."
    ),
});

export type TweetContext = z.infer<typeof schema>;

export async function analyzeTweet(tweetText: string): Promise<TweetContext> {
  const { object } = await generateObject({
    model: openai("gpt-4o-mini"),
    schema,
    temperature: 0.3,
    system: `You classify tweets to pick the perfect meme reply. Lean toward bold, specific reply_style descriptions — 'perfect dunk', 'sincere cheers', 'exhausted agreement' — not generic ones like 'neutral response'. The ideal_meme_vibe should sound like something a meme connoisseur would say out loud.`,
    prompt: `Analyze this tweet:\n\n"${tweetText}"`,
  });
  return object;
}
