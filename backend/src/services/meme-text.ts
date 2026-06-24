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
const CAPTION_BATCH_TIMEOUT_MS = Number(
  process.env.MEMEDROP_CAPTION_BATCH_TIMEOUT_MS || CAPTION_TIMEOUT_MS + 1000
);
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
    const regions =
      captions.get(item.meme_id) ||
      fallbackCaptions(tweetText, context, item.template) ||
      guaranteedFallbackCaptions(tweetText, context, item.template);
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

  const batchController = new AbortController();
  let batchTimer: ReturnType<typeof setTimeout> | null = null;

  const generatedPromise = Promise.allSettled(
    uncached.map(async (candidate) => {
      const regions = await requestCaption(
        tweetText,
        context,
        candidate,
        combineAbortSignals([
          batchController.signal,
          AbortSignal.timeout(CAPTION_TIMEOUT_MS),
        ])
      );
      return { candidate, regions };
    })
  );
  const timeoutPromise = new Promise<null>((resolve) => {
    batchTimer = setTimeout(() => {
      batchController.abort(new Error("caption batch timeout"));
      console.warn(
        `[MemeDrop] Tailored caption batch timed out after ${CAPTION_BATCH_TIMEOUT_MS}ms`
      );
      resolve(null);
    }, CAPTION_BATCH_TIMEOUT_MS);
  });

  const generated = await Promise.race([
    generatedPromise,
    timeoutPromise,
  ]).finally(() => {
    if (batchTimer) clearTimeout(batchTimer);
  });

  if (!generated) return result;

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

function combineAbortSignals(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener(
      "abort",
      () => {
        if (!controller.signal.aborted) controller.abort(signal.reason);
      },
      { once: true }
    );
  }
  return controller.signal;
}

async function requestCaption(
  tweetText: string,
  context: TweetContext,
  candidate: CaptionCandidate,
  signal?: AbortSignal
): Promise<Record<string, string> | null> {
  return requestOpenRouterCaption(tweetText, context, candidate, signal);
}

async function requestOpenRouterCaption(
  tweetText: string,
  context: TweetContext,
  candidate: CaptionCandidate,
  signal?: AbortSignal
): Promise<Record<string, string> | null> {
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) return null;

  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...openRouterHeaders(),
    },
    body: JSON.stringify({
      model: QWEN_PLUS_MODEL,
      temperature: 0.65,
      max_tokens: 550,
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
    "You write meme overlay text for reply images on X that should feel like a human made the meme, not like a bot summarized the post.",
    "Return JSON only with exactly one key: regions.",
    "Every caption must be readable on an image: short, concrete, and punchy.",
    "Write labels and punchlines, not explanations, summaries, advice, or complete tweet replies.",
    "Follow the template's joke structure and each region's role.",
    "Use the post's concrete nouns, named things, or distinctive verbs when they fit.",
    "Prefer one specific joke over broad commentary. Make the meme about the social tension, hypocrisy, cope, bad decision, or absurd contrast in the post.",
    "Avoid generic filler such as 'me rn', 'it's fine', 'plot twist', 'bad idea', or 'the real question'.",
    "Avoid corporate-safe language, therapy-speak, essay phrasing, and neutral descriptions of the image.",
    "Do not explain the joke, add hashtags, add quotation marks, mention X, or invent brand voice.",
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
      position: `${region.align}/${region.valign}`,
      max_chars: region.max_chars,
      max_lines: region.max_lines,
      hard_limit: `${region.max_chars} characters including spaces`,
      notes: region.notes,
    })),
    good_examples: candidate.template.caption_guidance.good_examples.slice(0, 2),
    avoid_examples: candidate.template.caption_guidance.bad_examples.slice(0, 2),
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
- Use only the listed region ids.
- Write text meant to be placed directly on the image, not a tweet reply sentence.
- At least one region must include a concrete term from the post unless it would make the joke worse.
- Default to 1-5 words per region. Use fewer words for small or side-label regions.
- Preserve the template's contrast or escalation. Do not make every region say the same thing.
- Make setup regions understandable and make punchline/verdict/reveal regions do the turn.
- Punchline regions should contain the funniest turn, not a neutral restatement.
- If a region is a character/object label, use a compact noun phrase. If it is a reaction/punchline, use a compact human-sounding reaction.
- Avoid copying the good examples; use them only for structure.
- Do not follow the avoid_examples.
- Do not write captions that sound like documentation, analysis, moral judgment, or a content moderation note.
- Never exceed max_chars.
- If a region cannot add to the joke, use the shortest useful label rather than filler.
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
  const contrast = pickContrast(context, subject);
  const result: Record<string, string> = {};

  for (const region of template.regions) {
    const text = fallbackTextForRegion(template.template_id, region.id, region.role, subject, contrast);
    result[region.id] = sanitizeText(text, region.max_chars);
  }

  return isCaptionSetAcceptable(result, template, tweetText, context, true) ? result : null;
}

function guaranteedFallbackCaptions(
  tweetText: string,
  context: TweetContext,
  template: MemeTemplate
): Record<string, string> | null {
  if (!USE_CONTEXTUAL_FALLBACK) return null;

  const subject = pickSubject(tweetText, context);
  const contrast = pickContrast(context, subject);
  const result: Record<string, string> = {};

  for (const region of template.regions) {
    const roleText = shouldUseContrast(region.id, region.role) ? contrast : subject;
    const text =
      fallbackTextForRegion(template.template_id, region.id, region.role, subject, contrast) ||
      roleText ||
      context.joke_target ||
      "reaction";
    const sanitized = sanitizeText(text, region.max_chars);
    if (sanitized) result[region.id] = sanitized;
  }

  return Object.keys(result).length > 0 ? result : null;
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

function pickContrast(context: TweetContext, subject: string): string {
  const shortSubject = sanitizeText(subject, 18);
  if (context.intent === "celebrating") return `${shortSubject} somehow won`;
  if (context.intent === "dunking") return `${shortSubject} consequences`;
  if (context.intent === "counter-argument") return `they skipped ${shortSubject}`;
  if (context.intent === "venting") return `${shortSubject} again`;
  if (context.tone === "sarcastic") return `${shortSubject} did this`;
  if (context.tone === "question") return `so... ${shortSubject}?`;
  return `${shortSubject} reveal`;
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
      return shouldUseContrast(regionId, role) ? contrast : subject;
  }
}

function shouldUseContrast(regionId: string, role: string): boolean {
  const descriptor = `${regionId} ${role}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
  return /\b(punch|answer|verdict|reveal|result|bad|wrong|weak|timid|inferior|worse|after|right|bottom|cheems)\b/.test(
    descriptor
  );
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
  return `${normalizeTweet(tweetText)}|template:${template.template_id}|provider:openrouter|model:${QWEN_PLUS_MODEL}|v3`;
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
