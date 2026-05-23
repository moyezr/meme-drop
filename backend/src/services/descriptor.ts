/**
 * Meme descriptor = the natural-language paragraph we embed.
 *
 * Embedding a bag of keywords ("sarcastic agreement dunking") produces noisy
 * vectors. Embedding a short paragraph that *describes* the meme's vibe
 * (who'd reach for it and when) puts similar-purpose memes nearer in vector
 * space and — more importantly — puts them close to paragraphs that describe
 * tweet-reply intent. The retrieval + re-rank pipeline depends on this
 * alignment, so the seed, save, and query paths all use this helper.
 */

interface MemeDescriptorInput {
  name: string;
  emotion: string;
  format_type: string;
  use_cases: string[];
  example_contexts: string[];
  vibes?: string[];
}

export function buildMemeDescriptor(m: MemeDescriptorInput): string {
  const useCases = m.use_cases.join(", ").replace(/_/g, " ");
  const vibes = (m.vibes || []).join(", ");
  const examples = m.example_contexts
    .map((c) => `- ${c}`)
    .join("\n");

  return [
    `${m.name} is a ${m.emotion} ${m.format_type.replace(/_/g, " ")} meme.`,
    vibes ? `Vibe: ${vibes}.` : "",
    useCases ? `Use it for: ${useCases}.` : "",
    examples ? `Perfect when:\n${examples}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Tweet descriptor = the natural-language paragraph we embed for the query.
 * Must line up stylistically with buildMemeDescriptor so cosine similarity
 * compares apples to apples.
 */
interface TweetDescriptorInput {
  tweet_text: string;
  sentiment: string;
  tone: string;
  topic: string;
  intent: string;
  reply_style: string;
  ideal_meme_vibe: string;
  joke_target?: string;
  social_dynamic?: string;
  humor_angle?: string;
}

export function buildTweetDescriptor(t: TweetDescriptorInput): string {
  return [
    `A ${t.tone} ${t.sentiment} tweet about ${t.topic}.`,
    `Intent: ${t.intent.replace(/_/g, " ")}.`,
    `Ideal reply style: ${t.reply_style}.`,
    `The perfect meme reply would feel like: ${t.ideal_meme_vibe}.`,
    t.joke_target ? `The meme should point at: ${t.joke_target}.` : "",
    t.social_dynamic ? `Social dynamic: ${t.social_dynamic}.` : "",
    t.humor_angle ? `Humor angle: ${t.humor_angle}.` : "",
    `Original tweet: "${t.tweet_text}"`,
  ]
    .filter(Boolean)
    .join("\n");
}
