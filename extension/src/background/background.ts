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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_SUGGESTIONS") {
    fetchSuggestions(message.payload.tweet_text)
      .then((suggestions) => {
        // Forward results to the content script tab
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
        sendResponse({ suggestions: [], error: err.message });
      });
    return true; // keep message channel open for async response
  }

  if (message.type === "SAVE_MEME") {
    saveMeme(message.payload.image_url, message.payload.source_tweet_id)
      .then((meme) => sendResponse({ meme }))
      .catch((err) => {
        console.error("[MemeDrop] Save error:", err);
        sendResponse({ meme: null, error: err.message });
      });
    return true;
  }

  if (message.type === "LOG_USAGE") {
    logUsage(message.payload).catch(console.error);
    return false;
  }

  if (message.type === "FETCH_MEDIA_DATA_URL") {
    const imageUrl = toAbsoluteMediaUrl(message.payload.image_url);
    fetchMediaDataUrl(imageUrl)
      .then((image_data_url) => sendResponse({ image_data_url }))
      .catch((err) => {
        console.error("[MemeDrop] Media fetch error:", err);
        sendResponse({ image_data_url: null, error: err.message });
      });
    return true;
  }
});

async function fetchSuggestions(tweetText: string) {
  const res = await fetch(`${API_BASE_URL}/api/v1/suggest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tweet_text: tweetText }),
  });
  const data = await res.json();
  const suggestions = (data.suggestions ?? []) as Suggestion[];

  return Promise.all(
    suggestions.map(async (suggestion) => {
      const absoluteImageUrl = toAbsoluteMediaUrl(suggestion.image_url);
      let imageDataUrl: string | null = null;

      try {
        imageDataUrl = await fetchMediaDataUrl(absoluteImageUrl);
      } catch (err) {
        console.warn("[MemeDrop] Could not resolve suggestion media:", err);
      }

      return {
        ...suggestion,
        name: normalizeSuggestionName(
          suggestion.name,
          suggestion.use_case_label
        ),
        image_url: absoluteImageUrl,
        image_data_url: imageDataUrl,
      };
    })
  );
}

async function saveMeme(imageUrl: string, sourceTweetId?: string) {
  const res = await fetch(`${API_BASE_URL}/api/v1/library/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_url: imageUrl, source_tweet_id: sourceTweetId }),
  });
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

function normalizeSuggestionName(name: string, useCaseLabel: string): string {
  const cleaned = (name || "").trim();
  if (cleaned && !/^unnamed\s+meme$/i.test(cleaned)) {
    return cleaned;
  }

  if (useCaseLabel?.trim()) {
    return useCaseLabel.replace(/_/g, " ");
  }

  return "Untitled meme";
}

console.log("[MemeDrop] Background service worker started");
