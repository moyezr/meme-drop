import { API_BASE_URL, apiUrl } from "../shared/config";
import { apiErrorFromResponse, withApiRequestHeaders } from "../shared/api";
import { clampSuggestionLimit, limitSuggestions } from "../shared/suggestion-limits";
import { getSuggestionMediaUrls } from "../shared/suggestion-media";
import { createSingleFlight } from "../shared/single-flight";
import {
  UsageTelemetryQueue,
  type UsageEvent,
  type UsageEventInput,
} from "./usage-telemetry";

interface Suggestion {
  meme_id: string;
  name: string;
  image_url: string;
  preview_image_url?: string | null;
  tailored_overlay?: MemeTextOverlay | null;
  use_case_label: string;
  match_explanation: string;
  score: number;
  source: "user" | "global";
  tweet_text?: string;
  feedback_context?: Record<string, unknown>;
  image_data_url?: string | null;
  preview_image_data_url?: string | null;
}

interface MemeTextOverlay {
  enabled: boolean;
  style: "impact";
  template_id?: string;
  alt_text: string;
  regions: MemeTextRegion[];
}

interface MemeTextRegion {
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

interface CacheEntry {
  suggestions: Suggestion[];
  expiresAt: number;
}

const SUGGESTION_TTL_MS = 5 * 60 * 1000;
const SUGGESTION_CACHE_MAX = 100;
const MEDIA_CACHE_MAX = 40;
const SUGGESTION_REQUEST_TIMEOUT_MS = 5_000;
const suggestionCache = new Map<string, CacheEntry>();
const suggestionInflight = new Map<string, Promise<Suggestion[]>>();
const mediaDataUrlCache = new Map<string, string>();
const mediaDataUrlInflight = createSingleFlight<string>();
const usageTelemetry = new UsageTelemetryQueue({
  sendBatch: postUsageBatch,
});

function normalizeTweetText(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function readCachedSuggestions(key: string): Suggestion[] | null {
  const entry = suggestionCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    suggestionCache.delete(key);
    return null;
  }
  // Refresh LRU ordering.
  suggestionCache.delete(key);
  suggestionCache.set(key, entry);
  return entry.suggestions;
}

function writeCachedSuggestions(key: string, suggestions: Suggestion[]) {
  suggestionCache.set(key, {
    suggestions,
    expiresAt: Date.now() + SUGGESTION_TTL_MS,
  });
  if (suggestionCache.size > SUGGESTION_CACHE_MAX) {
    const oldestKey = suggestionCache.keys().next().value;
    if (oldestKey) suggestionCache.delete(oldestKey);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_SUGGESTIONS") {
    let sentInitialSuggestions = false;
    fetchSuggestions(message.payload.tweet_text, {
      refresh: message.payload.refresh,
      limit: message.payload.limit,
      cacheKey: message.payload.cache_key,
      onInitial: (suggestions) => {
        sentInitialSuggestions = true;
        if (sender.tab?.id) {
          chrome.tabs.sendMessage(sender.tab.id, {
            type: "SUGGESTIONS_RESULT",
            cache_key: message.payload.cache_key,
            suggestions,
          });
        }
      },
      onPreview: (suggestion) => {
        if (sender.tab?.id && suggestion.preview_image_data_url) {
          chrome.tabs.sendMessage(sender.tab.id, {
            type: "SUGGESTION_PREVIEW_READY",
            cache_key: message.payload.cache_key,
            meme_id: suggestion.meme_id,
            image_data_url: suggestion.preview_image_data_url,
          });
        }
      },
      onOriginal: (suggestion) => {
        if (sender.tab?.id && suggestion.image_data_url) {
          chrome.tabs.sendMessage(sender.tab.id, {
            type: "SUGGESTION_ORIGINAL_READY",
            cache_key: message.payload.cache_key,
            meme_id: suggestion.meme_id,
            image_data_url: suggestion.image_data_url,
          });
        }
      },
    })
      .then((suggestions) => {
        if (!sentInitialSuggestions && sender.tab?.id) {
          chrome.tabs.sendMessage(sender.tab.id, {
            type: "SUGGESTIONS_RESULT",
            cache_key: message.payload.cache_key,
            suggestions,
          });
        }
        sendResponse({ suggestions });
      })
      .catch((err) => {
        console.error("[MemeDrop] Suggestion error:", err);
        if (sender.tab?.id) {
          chrome.tabs.sendMessage(sender.tab.id, {
            type: "SUGGESTIONS_RESULT",
            cache_key: message.payload.cache_key,
            suggestions: [],
          });
        }
        sendResponse({ suggestions: [], error: err?.message });
      });
    return true;
  }

  if (message.type === "SAVE_MEME") {
    saveMeme(message.payload.image_url, message.payload.source_tweet_id)
      .then((meme) => sendResponse({ meme }))
      .catch((err) => {
        console.error("[MemeDrop] Save error:", err);
        sendResponse({ meme: null, error: err?.message });
      });
    return true;
  }

  if (message.type === "GET_CAPTION") {
    fetchCaption(message.payload.tweet_text, message.payload.meme_id)
      .then((tailored_overlay) => sendResponse({ tailored_overlay }))
      .catch((err) => {
        console.error("[MemeDrop] Caption error:", err);
        sendResponse({ tailored_overlay: null, error: err?.message });
      });
    return true;
  }

  if (message.type === "LOG_USAGE") {
    usageTelemetry.enqueue(message.payload as UsageEventInput);
    return false;
  }

  if (message.type === "FETCH_MEDIA_DATA_URL") {
    const imageUrl = toAbsoluteMediaUrl(message.payload.image_url);
    fetchMediaDataUrl(imageUrl)
      .then((image_data_url) => sendResponse({ image_data_url }))
      .catch((err) => {
        console.error("[MemeDrop] Media fetch error:", err);
        sendResponse({ image_data_url: null, error: err?.message });
      });
    return true;
  }
});

chrome.runtime.onSuspend.addListener(() => {
  void usageTelemetry.flush();
});

async function fetchSuggestions(
  tweetText: string,
  options: {
    refresh?: boolean;
    limit?: number;
    cacheKey?: string;
    onInitial?: (suggestions: Suggestion[]) => void;
    onPreview?: (suggestion: Suggestion) => void;
    onOriginal?: (suggestion: Suggestion) => void;
  } = {}
): Promise<Suggestion[]> {
  const limit = clampSuggestionLimit(options.limit);
  const requestOptions = { ...options, limit };
  const cacheKey = `${options.cacheKey || `text:${normalizeTweetText(tweetText)}`}|limit:${limit}|quality:v1`;
  if (!options.refresh) {
    const cached = readCachedSuggestions(cacheKey);
    if (cached) return cached;

    const inflight = suggestionInflight.get(cacheKey);
    if (inflight) return inflight;
  }

  const request = fetchFreshSuggestions(tweetText, requestOptions, cacheKey);
  if (!options.refresh) {
    suggestionInflight.set(cacheKey, request);
  }
  try {
    return await request;
  } finally {
    suggestionInflight.delete(cacheKey);
  }
}

async function fetchFreshSuggestions(
  tweetText: string,
  options: {
    refresh?: boolean;
    limit?: number;
    cacheKey?: string;
    onInitial?: (suggestions: Suggestion[]) => void;
    onPreview?: (suggestion: Suggestion) => void;
    onOriginal?: (suggestion: Suggestion) => void;
  },
  cacheKey: string
): Promise<Suggestion[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUGGESTION_REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(apiUrl("/api/v1/suggest"), {
      method: "POST",
      headers: await withApiRequestHeaders(),
      signal: controller.signal,
      body: JSON.stringify({
        tweet_text: tweetText,
        limit: options.limit,
        refresh: options.refresh,
        cache_key: options.cacheKey,
      }),
    });
    if (!res.ok) {
      throw await apiErrorFromResponse(res);
    }
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json();
  const raw = (data.suggestions ?? []) as Suggestion[];

  const suggestions: Suggestion[] = limitSuggestions(raw).map((suggestion) => ({
    ...suggestion,
    name: (suggestion.name || "").trim(),
    image_url: toAbsoluteMediaUrl(suggestion.image_url),
    preview_image_url: suggestion.preview_image_url
      ? toAbsoluteMediaUrl(suggestion.preview_image_url)
      : undefined,
    tweet_text: tweetText,
    image_data_url: null,
    preview_image_data_url: null,
  }));

  options.onInitial?.(suggestions);
  writeCachedSuggestions(cacheKey, suggestions);

  // X's page CSP can block injected localhost images. Fetch through the
  // extension background and render data URLs so cards display reliably.
  // Preview assets are delivered independently so captioned cards can appear
  // before their full-quality originals. Originals are still prefetched for
  // attachment, but never used to render the capped card canvas.
  void Promise.allSettled(
    suggestions.map((suggestion) => hydrateSuggestionMedia(suggestion, options))
  );

  return suggestions;
}

async function hydrateSuggestionMedia(
  suggestion: Suggestion,
  options: {
    onPreview?: (suggestion: Suggestion) => void;
    onOriginal?: (suggestion: Suggestion) => void;
  }
): Promise<void> {
  const { previewUrl, originalUrl, sharesAsset } = getSuggestionMediaUrls(
    suggestion.image_url,
    suggestion.preview_image_url
  );

  // A catalog without generated thumbnails has the same URL for each use.
  // Fetch it once, while preserving separate ready notifications for the
  // preview renderer and attachment path.
  if (sharesAsset) {
    const dataUrl = await fetchMediaDataUrl(originalUrl);
    suggestion.preview_image_data_url = dataUrl;
    options.onPreview?.(suggestion);
    suggestion.image_data_url = dataUrl;
    options.onOriginal?.(suggestion);
    return;
  }

  await Promise.all([
    fetchMediaDataUrl(previewUrl).then((dataUrl) => {
      suggestion.preview_image_data_url = dataUrl;
      options.onPreview?.(suggestion);
    }),
    fetchMediaDataUrl(originalUrl).then((dataUrl) => {
      suggestion.image_data_url = dataUrl;
      options.onOriginal?.(suggestion);
    }),
  ]);
}

async function saveMeme(imageUrl: string, sourceTweetId?: string) {
  const res = await fetch(apiUrl("/api/v1/library/save"), {
    method: "POST",
    headers: await withApiRequestHeaders(),
    body: JSON.stringify({ image_url: imageUrl, source_tweet_id: sourceTweetId }),
  });
  if (!res.ok) {
    throw await apiErrorFromResponse(res);
  }
  const data = await res.json();
  return data.meme;
}

async function fetchCaption(tweetText: string, memeId: string): Promise<MemeTextOverlay | null> {
  const res = await fetch(apiUrl("/api/v1/suggest/caption"), {
    method: "POST",
    headers: await withApiRequestHeaders(),
    body: JSON.stringify({ tweet_text: tweetText, meme_id: memeId }),
  });
  if (!res.ok) {
    throw await apiErrorFromResponse(res);
  }
  const data = await res.json();
  return data.tailored_overlay ?? null;
}

async function postUsageBatch(events: UsageEvent[]): Promise<void> {
  const response = await fetch(apiUrl("/api/v1/usage/batch"), {
    method: "POST",
    headers: await withApiRequestHeaders(),
    body: JSON.stringify({ events }),
  });
  if (!response.ok) {
    throw await apiErrorFromResponse(response);
  }
}

function toAbsoluteMediaUrl(imageUrl: string): string {
  if (!imageUrl) return imageUrl;
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  if (/^(data:|blob:|filesystem:)/i.test(imageUrl)) return imageUrl;
  return `${API_BASE_URL}${imageUrl.startsWith("/") ? "" : "/"}${imageUrl}`;
}

async function fetchMediaDataUrl(imageUrl: string): Promise<string> {
  const cached = mediaDataUrlCache.get(imageUrl);
  if (cached) {
    mediaDataUrlCache.delete(imageUrl);
    mediaDataUrlCache.set(imageUrl, cached);
    return cached;
  }

  return mediaDataUrlInflight.run(imageUrl, async () => {
    // The first request may have populated the LRU before this caller entered
    // the single-flight path.
    const populated = mediaDataUrlCache.get(imageUrl);
    if (populated) return populated;

    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch media (${response.status})`);
    }

    const blob = await response.blob();
    const buffer = await blob.arrayBuffer();
    const base64 = arrayBufferToBase64(buffer);
    const mimeType = blob.type || guessMimeType(imageUrl);
    const dataUrl = `data:${mimeType};base64,${base64}`;
    mediaDataUrlCache.set(imageUrl, dataUrl);
    if (mediaDataUrlCache.size > MEDIA_CACHE_MAX) {
      const oldestKey = mediaDataUrlCache.keys().next().value;
      if (oldestKey) mediaDataUrlCache.delete(oldestKey);
    }
    return dataUrl;
  });
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function guessMimeType(imageUrl: string): string {
  const ext = imageUrl.split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}
