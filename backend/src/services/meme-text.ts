import { findMemeTemplate, type MemeTemplate } from "@memedrop/shared";
import type { TweetContext } from "./context-analyzer.js";
import type { Candidate } from "./retrieval.js";

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

interface CaptionBatchResponse {
  captions?: Array<{
    meme_id?: string;
    regions?: Record<string, string>;
  }>;
}

const CAPTION_TIMEOUT_MS = 1800;
const CAPTION_CACHE_TTL_MS = 30 * 60 * 1000;
const CAPTION_CACHE_MAX = 400;

const captionCache = new Map<string, { expiresAt: number; regions: Record<string, string> }>();

export async function buildTailoredOverlays(
  tweetText: string,
  context: TweetContext,
  candidates: Candidate[]
): Promise<Map<string, MemeTextOverlay>> {
  const captionCandidates = candidates
    .map((candidate) => {
      const template = findMemeTemplate(candidate.name);
      return template ? { meme_id: candidate.meme_id, name: candidate.name, template } : null;
    })
    .filter((item): item is CaptionCandidate => Boolean(item))
    .slice(0, 8);

  if (captionCandidates.length === 0) return new Map();

  const captions = await generateCaptions(tweetText, context, captionCandidates);
  const overlays = new Map<string, MemeTextOverlay>();

  for (const item of captionCandidates) {
    const regions = captions.get(item.meme_id) || fallbackCaptions(item.template);
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

  try {
    const generated = await withTimeout(
      requestDeepSeekCaptions(tweetText, context, uncached),
      CAPTION_TIMEOUT_MS,
      null
    );

    for (const candidate of uncached) {
      const regions = generated?.get(candidate.meme_id);
      if (!regions) continue;
      const cleaned = cleanGeneratedRegions(regions, candidate.template);
      if (Object.keys(cleaned).length === 0) continue;
      result.set(candidate.meme_id, cleaned);
      writeCache(cacheKey(tweetText, candidate.template), cleaned);
    }
  } catch (err) {
    console.warn("[MemeDrop] Tailored caption generation failed:", err);
  }

  return result;
}

async function requestDeepSeekCaptions(
  tweetText: string,
  context: TweetContext,
  candidates: CaptionCandidate[]
): Promise<Map<string, Record<string, string>>> {
  if (!process.env.DEEPSEEK_API_KEY) return new Map();

  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.MEMEDROP_CAPTION_MODEL || "deepseek-chat",
      response_format: { type: "json_object" },
      temperature: 0.75,
      max_tokens: 1400,
      messages: [
        {
          role: "system",
          content:
            "You write genuinely funny, internet-native meme overlay captions. Return JSON only. No markdown. Keep text short enough to fit each region.",
        },
        {
          role: "user",
          content: buildCaptionPrompt(tweetText, context, candidates),
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`DeepSeek caption request failed ${response.status}: ${body.slice(0, 400)}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) return new Map();

  const parsed = JSON.parse(stripJsonFence(content)) as CaptionBatchResponse;
  const map = new Map<string, Record<string, string>>();
  for (const item of parsed.captions || []) {
    if (!item.meme_id || !item.regions) continue;
    map.set(item.meme_id, item.regions);
  }
  return map;
}

function buildCaptionPrompt(
  tweetText: string,
  context: TweetContext,
  candidates: CaptionCandidate[]
): string {
  const templates = candidates.map((candidate) => ({
    meme_id: candidate.meme_id,
    meme_name: candidate.name,
    template_id: candidate.template.template_id,
    pattern: candidate.template.caption_guidance.pattern,
    regions: candidate.template.regions.map((region) => ({
      id: region.id,
      role: region.role,
      max_chars: region.max_chars,
      max_lines: region.max_lines,
    })),
    good_examples: candidate.template.caption_guidance.good_examples.slice(0, 2),
    bad_examples: candidate.template.caption_guidance.bad_examples.slice(0, 1),
  }));

  return `Post to reply to:
"${tweetText}"

Post analysis:
- tone: ${context.tone}
- sentiment: ${context.sentiment}
- topic: ${context.topic}
- intent: ${context.intent}
- ideal reply style: ${context.reply_style}
- keywords: ${context.keywords.join(", ")}

Write meme overlay captions for these templates:
${JSON.stringify(templates, null, 2)}

Rules:
- Sound like a sharp meme reply, not an explanation.
- Avoid corporate phrasing, SEO phrasing, hashtags, and long noun piles.
- Prefer concrete, simple, conversational words.
- Respect max_chars for every region.
- Use each meme's pattern and examples.
- If a meme has multiple regions, the regions must work together as one joke.
- Return JSON only with this exact shape:
{
  "captions": [
    {
      "meme_id": "same id from input",
      "regions": {
        "region_id": "caption text"
      }
    }
  ]
}`;
}

function fallbackCaptions(template: MemeTemplate): Record<string, string> {
  const example = template.caption_guidance.good_examples[0];
  if (example) return example;
  return Object.fromEntries(template.regions.map((region) => [region.id, region.role]));
}

function cleanGeneratedRegions(
  regions: Record<string, string>,
  template: MemeTemplate
): Record<string, string> {
  const cleaned: Record<string, string> = {};
  const allowed = new Map(template.regions.map((region) => [region.id, region]));

  for (const [id, text] of Object.entries(regions)) {
    const region = allowed.get(id);
    if (!region) continue;
    const sanitized = sanitizeText(text, region.max_chars);
    if (sanitized) cleaned[id] = sanitized;
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

function cacheKey(tweetText: string, template: MemeTemplate): string {
  return `${normalizeTweet(tweetText)}|template:${template.template_id}|v1`;
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
