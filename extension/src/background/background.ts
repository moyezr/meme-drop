const API_BASE_URL = "http://localhost:3001";

interface Suggestion {
  meme_id: string;
  name: string;
  image_url: string;
  tailored_overlay?: MemeTextOverlay | null;
  use_case_label: string;
  match_explanation: string;
  score: number;
  source: "user" | "global";
  tweet_context?: Record<string, unknown>;
  score_breakdown?: {
    similarity: number;
    personalized: number;
    rerank?: number;
    diversity: number;
  };
  image_data_url?: string | null;
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
const suggestionCache = new Map<string, CacheEntry>();

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
    fetchSuggestions(message.payload.tweet_text, {
      refresh: message.payload.refresh,
      limit: message.payload.limit,
      source: message.payload.source,
      mode: message.payload.mode,
      onInitial: (suggestions) => {
        if (sender.tab?.id) {
          chrome.tabs.sendMessage(sender.tab.id, {
            type: "SUGGESTIONS_RESULT",
            suggestions,
          });
        }
      },
    })
      .then((suggestions) => {
        if (sender.tab?.id) {
          chrome.tabs.sendMessage(sender.tab.id, {
            type: "SUGGESTIONS_RESULT",
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

  if (message.type === "LOG_USAGE") {
    logUsage(message.payload).catch((err) => {
      console.error("[MemeDrop] Usage log error:", err);
    });
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

async function fetchSuggestions(
  tweetText: string,
  options: {
    refresh?: boolean;
    limit?: number;
    source?: "all" | "user" | "global";
    mode?: "fast" | "smart";
    onInitial?: (suggestions: Suggestion[]) => void;
  } = {}
): Promise<Suggestion[]> {
  const mode = options.mode || "smart";
  const source = options.source || "global";
  const cacheKey = `${normalizeTweetText(tweetText)}|limit:${options.limit || 5}|source:${source}|mode:${mode}`;
  if (!options.refresh) {
    const cached = readCachedSuggestions(cacheKey);
    if (cached) return cached;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/v1/suggest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        tweet_text: tweetText,
        limit: options.limit,
        source,
        refresh: options.refresh,
        mode,
      }),
    });
    if (!res.ok) {
      throw new Error(`Suggest request failed with status ${res.status}`);
    }
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json();
  const raw = (data.suggestions ?? []) as Suggestion[];

  const suggestions: Suggestion[] = raw.map((suggestion) => ({
    ...suggestion,
    name: (suggestion.name || "").trim(),
    image_url: toAbsoluteMediaUrl(suggestion.image_url),
    image_data_url: null,
  }));

  options.onInitial?.(suggestions);

  // X's page CSP can block injected localhost images. Fetch through the
  // extension background and render data URLs so cards display reliably.
  await Promise.allSettled(
    suggestions.map(async (suggestion) => {
      suggestion.image_data_url = await fetchMediaDataUrl(suggestion.image_url);
    })
  );

  writeCachedSuggestions(cacheKey, suggestions);
  return suggestions;
}

async function saveMeme(imageUrl: string, sourceTweetId?: string) {
  const res = await fetch(`${API_BASE_URL}/api/v1/library/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_url: imageUrl, source_tweet_id: sourceTweetId }),
  });
  if (!res.ok) {
    throw new Error(`Save request failed with status ${res.status}`);
  }
  const data = await res.json();
  return data.meme;
}

async function logUsage(payload: {
  meme_id: string;
  action: string;
  tweet_context: Record<string, unknown>;
  source?: "user" | "global";
}) {
  await fetch(`${API_BASE_URL}/api/v1/usage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function toAbsoluteMediaUrl(imageUrl: string): string {
  if (!imageUrl) return imageUrl;
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  if (/^(data:|blob:|filesystem:)/i.test(imageUrl)) return imageUrl;
  return `${API_BASE_URL}${imageUrl.startsWith("/") ? "" : "/"}${imageUrl}`;
}

async function fetchMediaDataUrl(imageUrl: string): Promise<string> {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch media (${response.status})`);
  }

  const blob = await response.blob();
  const buffer = await blob.arrayBuffer();
  const base64 = arrayBufferToBase64(buffer);
  const mimeType = blob.type || guessMimeType(imageUrl);
  return `data:${mimeType};base64,${base64}`;
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
