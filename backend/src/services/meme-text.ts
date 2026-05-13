import type { TweetContext } from "./context-analyzer.js";
import type { Candidate } from "./retrieval.js";

export interface MemeTextOverlay {
  enabled: boolean;
  style: "impact";
  alt_text: string;
  regions: MemeTextRegion[];
}

export interface MemeTextRegion {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  align?: "left" | "center" | "right";
  valign?: "top" | "middle" | "bottom";
  font_scale?: number;
}

type RegionTemplate = Omit<MemeTextRegion, "text"> & {
  role: string;
};

interface OverlayTemplate {
  match: RegExp;
  regions: RegionTemplate[];
  build: (args: BuildArgs) => Record<string, string>;
}

interface BuildArgs {
  tweetText: string;
  context: TweetContext;
  candidate: Candidate;
  subject: string;
  shortSubject: string;
}

const TEMPLATE_REGISTRY: OverlayTemplate[] = [
  {
    match: /drake hotline/i,
    regions: [
      topRegion("reject", "bad option"),
      bottomRegion("approve", "better option"),
    ],
    build: ({ context, shortSubject }) => ({
      reject: context.intent === "celebrating" ? "playing it cool" : `being normal about ${shortSubject}`,
      approve: context.intent === "celebrating" ? `${shortSubject} victory lap` : `making it about ${shortSubject}`,
    }),
  },
  {
    match: /two buttons/i,
    regions: [
      box("left_button", "first choice", 0.13, 0.14, 0.26, 0.13, 0.72),
      box("right_button", "second choice", 0.48, 0.14, 0.26, 0.13, 0.72),
      box("person", "person stuck choosing", 0.28, 0.69, 0.46, 0.12, 0.86),
    ],
    build: ({ shortSubject }) => ({
      left_button: "post through it",
      right_button: "log off",
      person: shortSubject,
    }),
  },
  {
    match: /distracted boyfriend/i,
    regions: [
      box("boyfriend", "person making the choice", 0.33, 0.37, 0.2, 0.11, 0.74),
      box("girlfriend", "responsible option", 0.58, 0.34, 0.22, 0.11, 0.74),
      box("temptation", "tempting bad option", 0.02, 0.22, 0.28, 0.13, 0.78),
    ],
    build: ({ shortSubject }) => ({
      boyfriend: shortSubject,
      girlfriend: "reasonable take",
      temptation: "choosing chaos",
    }),
  },
  {
    match: /change my mind/i,
    regions: [box("sign", "hot take", 0.18, 0.39, 0.42, 0.18, 0.86)],
    build: ({ shortSubject, context }) => ({
      sign: `${verdictFor(context)} ${shortSubject}. change my mind`,
    }),
  },
  {
    match: /one does not simply/i,
    regions: [box("caption", "solemn warning", 0.05, 0.05, 0.9, 0.2, 0.9)],
    build: ({ shortSubject }) => ({
      caption: `one does not simply survive ${shortSubject}`,
    }),
  },
  {
    match: /always has been/i,
    regions: [
      box("realization", "realization", 0.05, 0.05, 0.45, 0.18, 0.84),
      box("answer", "answer", 0.5, 0.07, 0.42, 0.16, 0.84),
    ],
    build: ({ shortSubject }) => ({
      realization: `wait, it's all ${shortSubject}?`,
      answer: "always has been",
    }),
  },
  {
    match: /bernie/i,
    regions: [box("ask", "repeated ask", 0.07, 0.06, 0.86, 0.2, 0.92)],
    build: ({ shortSubject }) => ({
      ask: `i am once again asking about ${shortSubject}`,
    }),
  },
  {
    match: /trade offer/i,
    regions: [
      box("i_receive", "what I get", 0.05, 0.16, 0.32, 0.18, 0.8),
      box("you_receive", "what you get", 0.62, 0.16, 0.32, 0.18, 0.8),
    ],
    build: ({ shortSubject }) => ({
      i_receive: `${shortSubject} discourse`,
      you_receive: "one reaction meme",
    }),
  },
  {
    match: /roll safe/i,
    regions: [box("wisdom", "bad logic", 0.05, 0.05, 0.9, 0.2, 0.92)],
    build: ({ shortSubject }) => ({
      wisdom: `can't lose ${shortSubject} discourse if you never had hope`,
    }),
  },
  {
    match: /evil kermit/i,
    regions: [
      box("good", "good impulse", 0.05, 0.05, 0.9, 0.14, 0.82),
      box("bad", "bad impulse", 0.05, 0.82, 0.9, 0.14, 0.82),
    ],
    build: ({ shortSubject }) => ({
      good: `me: be normal about ${shortSubject}`,
      bad: "also me: post the meme",
    }),
  },
  {
    match: /panik kalm panik/i,
    regions: [
      box("panic_1", "first panic", 0.48, 0.05, 0.46, 0.14, 0.72),
      box("calm", "calm", 0.48, 0.38, 0.46, 0.14, 0.72),
      box("panic_2", "second panic", 0.48, 0.72, 0.46, 0.14, 0.72),
    ],
    build: ({ shortSubject }) => ({
      panic_1: `${shortSubject} happened`,
      calm: "it's probably fine",
      panic_2: "the replies loaded",
    }),
  },
  {
    match: /surprised pikachu/i,
    regions: [topRegion("caption", "predictable consequence")],
    build: ({ shortSubject }) => ({
      caption: `${shortSubject} has consequences`,
    }),
  },
  {
    match: /this is fine/i,
    regions: [topRegion("caption", "calm denial")],
    build: ({ shortSubject }) => ({
      caption: `${shortSubject} is fine`,
    }),
  },
  {
    match: /mocking spongebob/i,
    regions: [topRegion("caption", "mocking quote")],
    build: ({ subject }) => ({
      caption: toMockingCase(subject),
    }),
  },
];

export function buildTailoredOverlay(
  tweetText: string,
  context: TweetContext,
  candidate: Candidate
): MemeTextOverlay | null {
  const template = TEMPLATE_REGISTRY.find((t) => t.match.test(candidate.name));
  const subject = readableSubject(context, tweetText);
  const shortSubject = limitWords(subject, 4);
  const selected = template || genericTopBottomTemplate();
  const textByRegion = selected.build({
    tweetText,
    context,
    candidate,
    subject,
    shortSubject,
  });

  const regions = selected.regions
    .map((region) => ({
      ...region,
      text: sanitizeOverlayText(textByRegion[region.id] || textByRegion[region.role] || subject),
    }))
    .filter((region) => region.text.length > 0);

  if (regions.length === 0) return null;

  return {
    enabled: true,
    style: "impact",
    alt_text: `Personalized ${candidate.name} meme about ${shortSubject}`,
    regions,
  };
}

function genericTopBottomTemplate(): OverlayTemplate {
  return {
    match: /.*/,
    regions: [topRegion("setup", "setup"), bottomRegion("punchline", "punchline")],
    build: ({ context, shortSubject }) => ({
      setup: setupFor(context, shortSubject),
      punchline: punchlineFor(context, shortSubject),
    }),
  };
}

function topRegion(id: string, role: string): RegionTemplate {
  return box(id, role, 0.04, 0.04, 0.92, 0.2, 1);
}

function bottomRegion(id: string, role: string): RegionTemplate {
  return box(id, role, 0.04, 0.76, 0.92, 0.2, 1);
}

function box(
  id: string,
  role: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fontScale = 1
): RegionTemplate {
  return {
    id,
    role,
    x,
    y,
    width,
    height,
    align: "center",
    valign: "middle",
    font_scale: fontScale,
  };
}

function readableSubject(context: TweetContext, tweetText: string): string {
  const keywordSubject = context.keywords
    .map((k) => k.trim())
    .filter((k) => k.length > 2 && !GENERIC_KEYWORDS.has(k.toLowerCase()))
    .slice(0, 3)
    .join(" ");
  if (keywordSubject) return keywordSubject;

  const words = tweetText.match(/[a-z0-9][a-z0-9_'’-]*/gi) || [];
  const fallback = words
    .filter((w) => w.length > 3 && !GENERIC_KEYWORDS.has(w.toLowerCase()))
    .slice(0, 3)
    .join(" ");
  return fallback || context.topic || "the timeline";
}

function setupFor(context: TweetContext, subject: string): string {
  if (context.intent === "asking") return `trying to understand ${subject}`;
  if (context.intent === "celebrating" || context.sentiment === "positive") return `${subject} just dropped`;
  if (context.intent === "self-deprecating") return `me handling ${subject}`;
  if (context.intent === "venting") return `pretending ${subject} is fine`;
  return `the ${subject} discourse`;
}

function punchlineFor(context: TweetContext, subject: string): string {
  if (context.intent === "asking") return "the timeline has no answers";
  if (context.intent === "celebrating" || context.sentiment === "positive") return "absolute cinema";
  if (context.intent === "self-deprecating") return "skill issue, apparently";
  if (context.intent === "venting") return "it is not fine";
  if (context.intent === "dunking") return "beating the allegations challenge failed";
  return `${subject} got meme'd`;
}

function verdictFor(context: TweetContext): string {
  if (context.intent === "celebrating" || context.sentiment === "positive") return "big win for";
  if (context.intent === "asking") return "nobody understands";
  if (context.intent === "venting") return "we need to discuss";
  return "not beating";
}

function toMockingCase(input: string): string {
  return limitWords(input, 7)
    .split("")
    .map((char, index) => (index % 2 === 0 ? char.toLowerCase() : char.toUpperCase()))
    .join("");
}

function limitWords(input: string, maxWords: number): string {
  const words = input.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, maxWords).join(" ");
}

function sanitizeOverlayText(input: string): string {
  return input
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim()
    .slice(0, 96);
}

const GENERIC_KEYWORDS = new Set([
  "tweet",
  "reaction",
  "post",
  "this",
  "that",
  "with",
  "from",
  "they",
  "have",
  "just",
  "about",
]);
