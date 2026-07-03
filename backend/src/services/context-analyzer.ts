import type { TweetContext } from "@memedrop/shared";

export type { TweetContext } from "@memedrop/shared";

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
  const positive =
    /\b(good|great|love|best|win|won|happy|nice|amazing|lol|lmao)\b/.test(text) ||
    /\b(finished|succeeded|successful|shipped|launched)\b/.test(text) &&
      /\b(quiet|clean|green|without|nobody had to|no rollback)\b/.test(text);
  const sarcastic = /\b(sure|totally|obviously|of course|yeah right|lol|lmao)\b/.test(text);
  const question = tweetText.includes("?");
  const rhetoricalQuestion =
    question &&
    /\b(who could have predicted|what could (?:possibly )?go wrong|how could this happen|who saw that coming|somehow)\b/.test(
      text
    );
  const rant = /!{2,}|\b(always|never|again|ridiculous|insane)\b/.test(text);

  const tone: TweetContext["tone"] = rhetoricalQuestion
    ? "sarcastic"
    : question
      ? "question"
      : sarcastic
      ? "sarcastic"
      : rant
        ? "rant"
        : positive
          ? "celebratory"
          : "hot-take";

  const intent: TweetContext["intent"] = rhetoricalQuestion
    ? "dunking"
    : question
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
    core_claim: tweetText.trim().replace(/\s+/g, " "),
    implied_context:
      intent === "dunking"
        ? "the speaker's claim or behavior creates an obvious self-own"
        : intent === "venting"
          ? "the audience recognizes this as a recurring shared frustration"
          : "the audience is expected to recognize the unstated contrast",
    comedic_tension:
      intent === "dunking"
        ? "what they expected vs the predictable consequence"
        : intent === "venting"
          ? "what should be normal vs the recurring mess"
          : "the stated point vs the obvious subtext",
    caption_anchors: buildHeuristicCaptionAnchors(tweetText, keywords),
    keywords: keywords.length >= 2 ? keywords.slice(0, 6) : ["tweet", "reaction"],
  };
}

function buildHeuristicCaptionAnchors(tweetText: string, keywords: string[]): string[] {
  const lowerTweet = tweetText.toLowerCase();
  const words = Array.from(lowerTweet.matchAll(/[a-z0-9][a-z0-9_'’-]*/g)).map(
    (match, index) => ({
      word: match[0],
      index,
      start: match.index,
      end: match.index + match[0].length,
    })
  );
  const candidates: Array<{ phrase: string; score: number; index: number }> = [];

  for (const { word, index } of words) {
    if (word.length < 3 || isWeakAnchorWord(word)) continue;
    candidates.push({ phrase: word, score: termSpecificity(word), index });
  }

  for (let i = 0; i < words.length - 1; i += 1) {
    const first = words[i];
    const second = words[i + 1];
    const separator = lowerTweet.slice(first.end, second.start);
    if (
      !/^\s+$/.test(separator) ||
      first.word.length < 3 ||
      second.word.length < 3 ||
      isWeakAnchorWord(first.word) ||
      isWeakAnchorWord(second.word)
    ) {
      continue;
    }
    const actionBonus = /(ed|ing)$/.test(first.word) ? 2 : 0;
    candidates.push({
      phrase: `${first.word} ${second.word}`,
      score: termSpecificity(first.word) + termSpecificity(second.word) + actionBonus,
      index: first.index,
    });
  }

  for (let i = 0; i < words.length - 2; i += 1) {
    const first = words[i];
    const second = words[i + 1];
    const third = words[i + 2];
    const firstSeparator = lowerTweet.slice(first.end, second.start);
    const secondSeparator = lowerTweet.slice(second.end, third.start);
    if (
      !/^\s+$/.test(firstSeparator) ||
      !/^\s+$/.test(secondSeparator) ||
      [first.word, second.word, third.word].some(
        (word) => word.length < 3 || isWeakAnchorWord(word)
      )
    ) {
      continue;
    }
    const outcomeBonus = /(explode|exploded|broken|broke|failed|failing|down)$/.test(third.word)
      ? 6
      : 0;
    candidates.push({
      phrase: `${first.word} ${second.word} ${third.word}`,
      score:
        termSpecificity(first.word) +
        termSpecificity(second.word) +
        termSpecificity(third.word) +
        outcomeBonus,
      index: first.index,
    });
  }

  for (const keyword of keywords) {
    const index = words.find((item) => item.word === keyword.toLowerCase())?.index ?? words.length;
    candidates.push({
      phrase: keyword.toLowerCase(),
      score: termSpecificity(keyword) + 1,
      index,
    });
  }

  const anchors = Array.from(
    new Map(
      candidates
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .map((candidate) => [candidate.phrase, candidate])
    ).values()
  )
    .slice(0, 6)
    .map((candidate) => candidate.phrase);

  return anchors.length >= 2 ? anchors : ["tweet", "reaction"];
}

function termSpecificity(term: string): number {
  let score = term.length >= 7 ? 2 : 1;
  if (
    /prod|dashboard|launch|test|deploy|payment|rewrite|framework|bug|flag|spreadsheet|macro|platform|meeting|calendar|slack|message|roadmap|deck|error|review|migration|agent/.test(
      term
    )
  ) {
    score += 4;
  }
  return score;
}

function isWeakAnchorWord(word: string): boolean {
  return COMMON_WORDS.has(word) || new Set([
    "a",
    "after",
    "an",
    "and",
    "before",
    "but",
    "could",
    "every",
    "everyone",
    "how",
    "into",
    "not",
    "only",
    "or",
    "someone",
    "somehow",
    "the",
    "predicted",
    "really",
    "than",
    "then",
    "while",
    "who",
    "why",
    "thing",
    "things",
    "would",
  ]).has(word);
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
