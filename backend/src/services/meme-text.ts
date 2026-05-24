import { findMemeTemplateForCandidate, type MemeTemplate } from "@memedrop/shared";
import type { TweetContext } from "./context-analyzer.js";
import type { Candidate } from "./retrieval.js";
import {
  getOpenRouterApiKey,
  openRouterHeaders,
  OPENROUTER_BASE_URL,
  QWEN_PLUS_MODEL,
} from "./llm-provider.js";

export interface MemeTextOverlay {
  enabled: boolean;
  style: "impact";
  template_id?: string;
  alt_text: string;
  regions: MemeTextRegion[];
}

export interface MemeTextRegion {
  id: string;
  text: string;
  text_transform?: "uppercase" | "mocking" | "none";
  x: number;
  y: number;
  width: number;
  height: number;
  align?: "left" | "center" | "right";
  valign?: "top" | "middle" | "bottom";
  font_scale?: number;
  max_lines?: number;
  max_chars?: number;
  font?: {
    family: "Impact";
    min_size: number;
    max_size: number;
    stroke_ratio: number;
  };
}

interface CaptionCandidate {
  meme_id: string;
  name: string;
  template: MemeTemplate;
}

interface CaptionResponse {
  regions?: Record<string, string>;
}

const CAPTION_TIMEOUT_MS = Number(process.env.MEMEDROP_CAPTION_TIMEOUT_MS || 8000);
const CAPTION_CACHE_TTL_MS = 30 * 60 * 1000;
const CAPTION_CACHE_MAX = 400;
const USE_DRAFT_TEMPLATES = process.env.MEMEDROP_USE_DRAFT_TEMPLATES === "true";
const USE_CONTEXTUAL_FALLBACK = process.env.MEMEDROP_USE_CONTEXTUAL_CAPTION_FALLBACK !== "false";
const GENERIC_CAPTION_PATTERNS = [
  /\b(me rn|bad idea|more vibes|new meeting|post through it|plot twist)\b/i,
  /\b(it'?s fine|making it worse|staying normal|trying to stay normal|acting shocked|the real question)\b/i,
  /\b(the obvious part|the whole problem|properly, right|ignore plan)\b/i,
];

const captionCache = new Map<string, { expiresAt: number; regions: Record<string, string> }>();

export async function buildTailoredOverlays(
  tweetText: string,
  context: TweetContext,
  candidates: Candidate[]
): Promise<Map<string, MemeTextOverlay>> {
  const captionCandidates = candidates
    .map((candidate) => {
      const template = findMemeTemplateForCandidate(candidate.name, candidate.meme_id, {
        includeDrafts: USE_DRAFT_TEMPLATES,
      });
      return template ? { meme_id: candidate.meme_id, name: candidate.name, template } : null;
    })
    .filter((item): item is CaptionCandidate => Boolean(item))
    .slice(0, 5);

  if (captionCandidates.length === 0) return new Map();

  const captions = await generateCaptions(tweetText, context, captionCandidates);
  const overlays = new Map<string, MemeTextOverlay>();

  for (const item of captionCandidates) {
    const regions = captions.get(item.meme_id) || fallbackCaptions(tweetText, context, item.template);
    if (!regions) continue;
    const overlay = buildOverlay(item, regions);
    if (overlay) overlays.set(item.meme_id, overlay);
  }

  return overlays;
}

function buildOverlay(
  item: CaptionCandidate,
  textByRegion: Record<string, string>
): MemeTextOverlay | null {
  const regions = item.template.regions
    .map((region): MemeTextRegion | null => {
      const rawText = textByRegion[region.id] || "";
      const text = sanitizeText(rawText, region.max_chars);
      if (!text) return null;

      return {
        id: region.id,
        text,
        text_transform: textTransform(item.template),
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height,
        align: region.align,
        valign: region.valign,
        max_lines: region.max_lines,
        max_chars: region.max_chars,
        font: region.font,
      };
    })
    .filter((region): region is MemeTextRegion => Boolean(region));

  if (regions.length === 0) return null;

  return {
    enabled: true,
    style: "impact",
    template_id: item.template.template_id,
    alt_text: `Personalized ${item.name} meme`,
    regions,
  };
}

async function generateCaptions(
  tweetText: string,
  context: TweetContext,
  candidates: CaptionCandidate[]
): Promise<Map<string, Record<string, string>>> {
  const result = new Map<string, Record<string, string>>();
  const uncached: CaptionCandidate[] = [];

  for (const candidate of candidates) {
    const cached = readCache(cacheKey(tweetText, candidate.template));
    if (cached) {
      result.set(candidate.meme_id, cached);
    } else {
      uncached.push(candidate);
    }
  }

  if (uncached.length === 0) return result;

  const generated = await Promise.allSettled(
    uncached.map(async (candidate) => {
      const regions = await withTimeout(
        requestCaption(tweetText, context, candidate),
        CAPTION_TIMEOUT_MS,
        null
      );
      return { candidate, regions };
    })
  );

  for (const item of generated) {
    if (item.status === "rejected") {
      console.warn("[MemeDrop] Tailored caption generation failed:", item.reason);
      continue;
    }

    const { candidate, regions } = item.value;
    try {
      if (!regions) continue;
      const cleaned = cleanGeneratedRegions(regions, candidate.template, tweetText, context);
      if (Object.keys(cleaned).length === 0) continue;
      result.set(candidate.meme_id, cleaned);
      writeCache(cacheKey(tweetText, candidate.template), cleaned);
    } catch (err) {
      console.warn("[MemeDrop] Tailored caption cleanup failed:", err);
    }
  }

  return result;
}

async function requestCaption(
  tweetText: string,
  context: TweetContext,
  candidate: CaptionCandidate
): Promise<Record<string, string> | null> {
  return requestOpenRouterCaption(tweetText, context, candidate);
}

async function requestOpenRouterCaption(
  tweetText: string,
  context: TweetContext,
  candidate: CaptionCandidate
): Promise<Record<string, string> | null> {
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) return null;

  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...openRouterHeaders(),
    },
    body: JSON.stringify({
      model: QWEN_PLUS_MODEL,
      temperature: 0.8,
      max_tokens: 450,
      reasoning: { effort: "none", exclude: true },
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: captionSystemPrompt(),
        },
        {
          role: "user",
          content: buildCaptionPrompt(tweetText, context, candidate),
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter caption request failed ${response.status}: ${body.slice(0, 400)}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) return null;

  return parseCaptionResponse(content);
}

function parseCaptionResponse(content: string): Record<string, string> | null {
  const parsed = JSON.parse(stripJsonFence(content)) as CaptionResponse;
  return parsed.regions || null;
}

function captionSystemPrompt(): string {
  return [
    "Write concise meme overlay captions for a reply on X.",
    "Return JSON only with one key: regions.",
    "Use the original post's concrete nouns or named things.",
    "Match the meme template's joke structure.",
    "Keep each region short and under its hard character limit.",
    "Do not explain the joke. Do not use hashtags, brand voice, or generic filler.",
  ].join(" ");
}

function buildCaptionPrompt(
  tweetText: string,
  context: TweetContext,
  candidate: CaptionCandidate
): string {
  const template = {
    meme_name: candidate.name,
    template_id: candidate.template.template_id,
    pattern: candidate.template.caption_guidance.pattern,
    regions: candidate.template.regions.map((region) => ({
      id: region.id,
      role: region.role,
      max_chars: region.max_chars,
      max_lines: region.max_lines,
      hard_limit: `${region.max_chars} characters including spaces`,
    })),
    examples: candidate.template.caption_guidance.good_examples.slice(0, 2),
  };

  return `Post to reply to:
"${tweetText}"

Useful post context:
- tone: ${context.tone}
- intent: ${context.intent}
- joke target: ${context.joke_target}
- social dynamic: ${context.social_dynamic}
- humor angle: ${context.humor_angle}
- reply style: ${context.reply_style}
- keywords: ${context.keywords.join(", ")}

Selected meme:
${JSON.stringify(template, null, 2)}

Rules:
- Write only for this one meme.
- At least one region must include a concrete term from the post when it fits.
- Default to 2-5 words per region. Use fewer words when the region is small.
- Never exceed max_chars.
- If there are multiple regions, make them work as one joke.
- Return JSON only:
{
  "regions": {
    "region_id": "caption text"
  }
}`;
}

function fallbackCaptions(
  tweetText: string,
  context: TweetContext,
  template: MemeTemplate
): Record<string, string> | null {
  if (!USE_CONTEXTUAL_FALLBACK) return null;

  const subject = pickSubject(tweetText, context);
  const contrast = pickContrast(context);
  const result: Record<string, string> = {};

  for (const region of template.regions) {
    const text = fallbackTextForRegion(template.template_id, region.id, region.role, subject, contrast);
    result[region.id] = sanitizeText(text, region.max_chars);
  }

  return isCaptionSetAcceptable(result, template, tweetText, context, true) ? result : null;
}

function cleanGeneratedRegions(
  regions: Record<string, string>,
  template: MemeTemplate,
  tweetText: string,
  context: TweetContext
): Record<string, string> {
  const cleaned: Record<string, string> = {};
  const allowed = new Map(template.regions.map((region) => [region.id, region]));

  for (const [id, text] of Object.entries(regions)) {
    const region = allowed.get(id);
    if (!region) continue;
    const sanitized = sanitizeText(shortenMemeText(text, region.max_chars), region.max_chars);
    if (sanitized) cleaned[id] = sanitized;
  }

  if (!isCaptionSetAcceptable(cleaned, template, tweetText, context, false)) {
    return {};
  }

  return cleaned;
}

function sanitizeText(input: string, maxChars: number): string {
  const text = String(input || "")
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/^["']|["']$/g, "")
    .trim();

  if (text.length <= maxChars) return text;

  const words = text.split(" ");
  let result = "";
  for (const word of words) {
    const next = result ? `${result} ${word}` : word;
    if (next.length > maxChars) break;
    result = next;
  }
  return result || text.slice(0, maxChars).trim();
}

function shortenMemeText(input: string, maxChars: number): string {
  let text = String(input || "")
    .replace(/\b(very|really|actually|basically|literally|just|kind of|sort of)\b/gi, "")
    .replace(/\bthe\b/gi, "")
    .replace(/\ba\b/gi, "")
    .replace(/\ban\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length <= maxChars) return text;

  text = text
    .replace(/\bwith\b/gi, "w/")
    .replace(/\bwithout\b/gi, "w/o")
    .replace(/\bbecause\b/gi, "bc")
    .replace(/\bpeople\b/gi, "ppl")
    .replace(/\bsomething\b/gi, "smth")
    .replace(/\bprobably\b/gi, "prob")
    .replace(/\s+/g, " ")
    .trim();

  return text;
}

function pickSubject(tweetText: string, context: TweetContext): string {
  const terms = getSpecificTerms(tweetText, context);
  const compound = findCompoundSubject(tweetText, terms);
  if (compound) return sanitizeText(compound, 26);
  if (terms[0]) return sanitizeText(terms[0], 26);

  const words = tweetText
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[@#][\w-]+/g, "")
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !isWeakKeyword(word));

  return sanitizeText(words.slice(0, 2).join(" ") || context.topic || "this", 26);
}

function pickContrast(context: TweetContext): string {
  if (context.intent === "celebrating") return "somehow still winning";
  if (context.intent === "dunking") return "predictable consequences";
  if (context.intent === "counter-argument") return "the part they skipped";
  if (context.intent === "venting") return "trying to stay normal";
  if (context.tone === "sarcastic") return "shocking outcome";
  if (context.tone === "question") return "asking the obvious";
  return "the reveal";
}

function fallbackTextForRegion(
  templateId: string,
  regionId: string,
  role: string,
  subject: string,
  contrast: string
): string {
  switch (templateId) {
    case "drake-hotline-bling":
      return regionId === "reject" ? `ignoring ${subject}` : contrast;
    case "two-buttons":
      if (regionId.includes("left")) return `fix ${subject}`;
      if (regionId.includes("right")) return `hide ${subject}`;
      return `${subject} choice`;
    case "distracted-boyfriend":
      if (regionId === "temptation") return `new ${subject}`;
      if (regionId === "boyfriend") return "me";
      return subject;
    case "change-my-mind":
      return `${subject} is the whole problem`;
    case "always-has-been":
      return regionId === "answer" ? "always has been" : `wait, it's ${subject}?`;
    case "anakin-padme-4-panel":
      if (regionId === "promise") return `we'll handle ${subject}`;
      if (regionId === "hope") return `${subject} gets fixed, right?`;
      if (regionId === "silence") return "...";
      return `${subject} gets fixed, right?`;
    case "trade-offer":
      return regionId === "i_receive" ? subject : contrast;
    case "bernie-i-am-once-again-asking-for-your-support":
      return `once again asking about ${subject}`;
    case "roll-safe-think-about-it":
      return `can't fail ${subject} if you never try`;
    case "evil-kermit":
      return regionId === "me" ? `me: ignore ${subject}` : `also me: ${contrast}`;
    case "panik-kalm-panik":
      if (regionId === "panic_1") return subject;
      if (regionId === "calm") return `${subject} contained`;
      return contrast;
    case "gru-s-plan":
      if (regionId === "step_1") return `notice ${subject}`;
      if (regionId === "step_2") return `plan for ${subject}`;
      if (regionId === "step_3") return `forget ${subject}`;
      return `forget ${subject}`;
    case "boardroom-meeting-suggestion":
      if (regionId === "good_idea") return betterIdeaForSubject(subject);
      return regionId.endsWith("2") ? "add follow-up" : "schedule meeting";
    case "mocking-spongebob":
      return subject;
    default:
      return role.includes("punch") || role.includes("answer") || role.includes("verdict")
        ? contrast
        : subject;
  }
}

function isWeakKeyword(word: string): boolean {
  return new Set([
    "this",
    "that",
    "with",
    "from",
    "have",
    "just",
    "like",
    "what",
    "when",
    "will",
    "they",
    "them",
    "your",
    "about",
    "there",
    "their",
    "would",
    "could",
    "should",
    "once",
    "again",
    "people",
    "half",
    "whole",
    "somehow",
    "naturally",
    "finally",
    "today",
    "still",
    "thing",
    "things",
    "asked",
    "asking",
    "were",
    "we're",
    "debating",
    "naturally",
    "really",
    "very",
    "right",
  ]).has(word.toLowerCase());
}

function betterIdeaForSubject(subject: string): string {
  if (/slack|message|meeting|calendar/.test(subject)) return "send Slack";
  if (/bug|error|prod|payment|dashboard/.test(subject)) return "fix root cause";
  if (/rewrite|framework|app/.test(subject)) return "keep stable app";
  if (/roadmap|deck|vibes/.test(subject)) return "write actual plan";
  return `fix ${subject}`;
}

function isCaptionSetAcceptable(
  regions: Record<string, string>,
  template: MemeTemplate,
  tweetText: string,
  context: TweetContext,
  isFallback: boolean
): boolean {
  const values = Object.values(regions).map((value) => sanitizeText(value, 120)).filter(Boolean);
  if (values.length === 0) return false;

  const combined = values.join(" ").toLowerCase();
  const uniqueValues = new Set(values.map((value) => value.toLowerCase()));
  if (values.length >= 2 && uniqueValues.size === 1) return false;

  const hasGenericText = GENERIC_CAPTION_PATTERNS.some((pattern) => pattern.test(combined));
  const terms = getSpecificTerms(tweetText, context);
  const hasSpecificTerm = terms.some((term) => combined.includes(term.toLowerCase()));
  const canonicalOk =
    template.template_id === "always-has-been" && combined.includes("always has been");

  if (hasGenericText && (!hasSpecificTerm || isFallback)) return false;
  if (!hasSpecificTerm && !canonicalOk) return false;
  if (values.some((value) => value.split(/\s+/).length > 10)) return false;

  return true;
}

function getSpecificTerms(tweetText: string, context: TweetContext): string[] {
  const fromContext = context.keywords
    .flatMap((keyword) =>
      keyword
        .toLowerCase()
        .replace(/[^a-z0-9\s'-]/g, " ")
        .split(/\s+/)
    )
    .filter((keyword) => keyword.length >= 3 && !isWeakKeyword(keyword));
  const fromTweet = tweetText
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[@#][\w-]+/g, "")
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !isWeakKeyword(word));
  return Array.from(new Set([...fromContext, ...fromTweet]))
    .sort((a, b) => termScore(b) - termScore(a))
    .slice(0, 10);
}

function findCompoundSubject(tweetText: string, terms: string[]): string | null {
  const lowerTweet = tweetText.toLowerCase();
  for (let i = 0; i < terms.length; i += 1) {
    for (let j = i + 1; j < Math.min(terms.length, i + 4); j += 1) {
      const phrase = `${terms[i]} ${terms[j]}`;
      if (lowerTweet.includes(phrase)) return phrase;
    }
  }
  return null;
}

function termScore(term: string): number {
  let score = term.length > 7 ? 2 : 1;
  if (
    /prod|dashboard|launch|test|deploy|payment|rewrite|framework|bug|flag|spreadsheet|macro|platform|meeting|calendar|slack|message|roadmap|vibes|deck|error|channel/.test(
      term
    )
  ) {
    score += 4;
  }
  if (/ing$/.test(term)) score -= 1;
  return score;
}

function textTransform(template: MemeTemplate): "uppercase" | "mocking" | "none" {
  return template.template_id === "mocking-spongebob" ? "mocking" : "uppercase";
}

function cacheKey(tweetText: string, template: MemeTemplate): string {
  return `${normalizeTweet(tweetText)}|template:${template.template_id}|provider:openrouter|model:${QWEN_PLUS_MODEL}|v2`;
}

function readCache(key: string): Record<string, string> | null {
  const entry = captionCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    captionCache.delete(key);
    return null;
  }
  captionCache.delete(key);
  captionCache.set(key, entry);
  return entry.regions;
}

function writeCache(key: string, regions: Record<string, string>) {
  captionCache.set(key, {
    regions,
    expiresAt: Date.now() + CAPTION_CACHE_TTL_MS,
  });

  if (captionCache.size > CAPTION_CACHE_MAX) {
    const oldest = captionCache.keys().next().value;
    if (oldest) captionCache.delete(oldest);
  }
}

function normalizeTweet(tweetText: string): string {
  return tweetText.trim().replace(/\s+/g, " ").toLowerCase();
}

function stripJsonFence(content: string): string {
  return content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
}

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
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
