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
  try {
    const { object } = await generateObject({
      model: openai(process.env.MEMEDROP_ANALYSIS_MODEL || "gpt-4o-mini"),
      schema,
      temperature: 0.3,
      system: `You classify tweets to pick the perfect meme reply. Lean toward bold, specific reply_style descriptions — 'perfect dunk', 'sincere cheers', 'exhausted agreement' — not generic ones like 'neutral response'. The ideal_meme_vibe should sound like something a meme connoisseur would say out loud.`,
      prompt: `Analyze this tweet:\n\n"${tweetText}"`,
    });
    return object;
  } catch (err) {
    console.warn("[MemeDrop] Tweet analysis failed, using heuristic context:", err);
    return heuristicTweetContext(tweetText);
  }
}

export function heuristicTweetContext(tweetText: string): TweetContext {
  const text = tweetText.toLowerCase();
  const words = tweetText.match(/[a-z0-9][a-z0-9_'’-]*/gi) || [];
  const keywords = Array.from(
    new Set(
      words
        .filter((w) => w.length > 3)
        .filter((w) => !COMMON_WORDS.has(w.toLowerCase()))
        .slice(0, 6)
    )
  );

  const negative = /\b(bad|broken|hate|awful|terrible|worst|angry|mad|fail|failed|annoying)\b/.test(text);
  const positive = /\b(good|great|love|best|win|won|happy|nice|amazing|finally|lol|lmao)\b/.test(text);
  const sarcastic = /\b(sure|totally|obviously|of course|yeah right|lol|lmao)\b/.test(text);
  const question = tweetText.includes("?");
  const rant = /!{2,}|\b(always|never|again|ridiculous|insane)\b/.test(text);

  const tone: TweetContext["tone"] = question
    ? "question"
    : sarcastic
      ? "sarcastic"
      : rant
        ? "rant"
        : positive
          ? "celebratory"
          : "hot-take";

  const intent: TweetContext["intent"] = question
    ? "asking"
    : negative && (sarcastic || rant)
      ? "dunking"
      : negative
        ? "venting"
        : positive
          ? "agreement"
          : "sharing-opinion";

  return {
    sentiment: negative ? "negative" : positive ? "positive" : "neutral",
    tone,
    topic: inferTopic(text),
    intent,
    intensity: rant || sarcastic ? 0.75 : question ? 0.45 : 0.55,
    reply_style: intent === "dunking" ? "sharp dunk" : intent === "venting" ? "exhausted agreement" : "wry reaction",
    ideal_meme_vibe:
      intent === "dunking"
        ? "mocking disbelief that makes the take look self-defeating without needing extra explanation"
        : intent === "venting"
          ? "tired acceptance energy that validates the complaint while keeping it funny"
          : "clear reaction image energy that matches the tweet's emotional temperature",
    keywords: keywords.length >= 2 ? keywords.slice(0, 6) : ["tweet", "reaction"],
  };
}

function inferTopic(text: string): TweetContext["topic"] {
  if (/\b(ai|software|app|code|developer|iphone|startup|tech)\b/.test(text)) return "tech";
  if (/\b(stock|market|money|bank|crypto|price|fed)\b/.test(text)) return "finance";
  if (/\b(election|policy|senate|president|government|vote)\b/.test(text)) return "politics";
  if (/\b(game|team|score|nba|nfl|soccer|cricket|sports)\b/.test(text)) return "sports";
  if (/\b(movie|show|music|album|celebrity|streaming)\b/.test(text)) return "entertainment";
  if (/\b(date|friend|family|relationship|partner)\b/.test(text)) return "relationships";
  if (/\b(internet|trend|meme|culture|timeline)\b/.test(text)) return "culture";
  return "other";
}

const COMMON_WORDS = new Set([
  "about",
  "after",
  "again",
  "because",
  "been",
  "being",
  "from",
  "have",
  "just",
  "like",
  "that",
  "this",
  "when",
  "with",
  "would",
  "your",
]);
