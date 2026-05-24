import { generateObject } from "ai";
import { z } from "zod";
import { openrouter, QWEN_PLUS_MODEL } from "./llm-provider.js";

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
    "self-deprecating",
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
  joke_target: z
    .string()
    .describe(
      "Who or what the meme reply should make fun of, sympathize with, or spotlight. Use a concrete noun phrase from the tweet when possible."
    ),
  social_dynamic: z
    .string()
    .describe(
      "The social move the reply should make, e.g. 'mocking a predictable self-own', 'joining the complaint', 'calling out rebrand nonsense', 'celebrating a clean win'."
    ),
  humor_angle: z
    .string()
    .describe(
      "A short description of the funniest angle for a meme reply. Name the tension, reversal, or absurdity; do not write the caption."
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
      model: openrouter.chat(QWEN_PLUS_MODEL),
      schema,
      temperature: 0.3,
      maxOutputTokens: 700,
      system: `You classify tweets to pick the funniest meme reply a human would actually post. Return JSON only. Do not include reasoning, markdown, or extra keys.

The JSON must contain exactly these keys:
- sentiment: one of positive, negative, neutral
- tone: one of sarcastic, earnest, rant, celebratory, hot-take, question, absurdist, wholesome, self-deprecating
- topic: one of tech, finance, politics, sports, entertainment, personal, culture, relationships, other
- intent: one of counter-argument, agreement, sharing-opinion, venting, asking, celebrating, dunking, self-deprecating
- intensity: number from 0 to 1
- reply_style: string
- ideal_meme_vibe: string
- joke_target: string
- social_dynamic: string
- humor_angle: string
- keywords: array of 2 to 6 strings

Focus on the social move, not just topic or emotion:
- Who or what is the joke aimed at?
- Is the reply joining the complaint, dunking on someone, self-owning, celebrating, or pointing out absurdity?
- What meme energy would make the reply land without explaining the joke?

Lean toward bold, specific reply_style descriptions — 'perfect dunk', 'sincere cheers', 'exhausted agreement' — not generic ones like 'neutral response'. The ideal_meme_vibe should sound like something a meme connoisseur would say out loud.`,
      prompt: `Analyze this tweet and return only the required JSON object:\n\n"${tweetText}"`,
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
    joke_target: pickJokeTarget(tweetText, keywords),
    social_dynamic:
      intent === "dunking"
        ? "mocking a predictable self-own"
        : intent === "venting"
          ? "joining the complaint with exhausted agreement"
          : intent === "agreement"
            ? "agreeing with the point in a punchy way"
            : "reacting to the absurdity without over-explaining it",
    humor_angle:
      intent === "dunking"
        ? "the predictable consequence is the joke"
        : intent === "venting"
          ? "everyone is pretending the bad situation is normal"
          : "the funniest part is the obvious tension in the post",
    keywords: keywords.length >= 2 ? keywords.slice(0, 6) : ["tweet", "reaction"],
  };
}

function pickJokeTarget(tweetText: string, keywords: string[]): string {
  const usefulKeyword = keywords.find((keyword) => keyword.length >= 4);
  if (usefulKeyword) return usefulKeyword;

  const words = tweetText
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[@#][\w-]+/g, "")
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !COMMON_WORDS.has(word));

  return words[0] || "the situation";
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
