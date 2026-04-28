const API_BASE_URL = "http://localhost:3001";

interface Suggestion {
  meme_id: string;
  name: string;
  image_url: string;
  use_case_label: string;
  match_explanation: string;
  score: number;
  image_data_url?: string | null;
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
    fetchSuggestions(message.payload.tweet_text)
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

async function fetchSuggestions(tweetText: string): Promise<Suggestion[]> {
  const cacheKey = normalizeTweetText(tweetText);
  const cached = readCachedSuggestions(cacheKey);
  if (cached) return cached;

  const res = await fetch(`${API_BASE_URL}/api/v1/suggest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tweet_text: tweetText }),
  });
  if (!res.ok) {
    throw new Error(`Suggest request failed with status ${res.status}`);
  }
  const data = await res.json();
  const raw = (data.suggestions ?? []) as Suggestion[];

  // No pre-fetch of image data URLs here — the panel loads images directly
  // via <img src="http://localhost:3001/memes/...">, which streams in
  // parallel with the response. The old Promise.all over 10 fetches +
  // base64 encodes was adding multiple seconds of latency for no benefit.
  const suggestions = raw.map((suggestion) => ({
    ...suggestion,
    name: (suggestion.name || "").trim(),
    image_url: toAbsoluteMediaUrl(suggestion.image_url),
    image_data_url: null,
  }));

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
  // A fresh save invalidates any prior suggestion responses — the new meme
  // should be eligible to appear next time.
  suggestionCache.clear();
  const data = await res.json();
  return data.meme;
}

async function logUsage(payload: {
  meme_id: string;
  action: string;
  tweet_context: Record<string, unknown>;
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
