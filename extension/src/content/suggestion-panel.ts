/**
 * Suggestion panel — Shadow DOM component injected into X.com
 * Shows meme suggestions in a horizontal strip when a reply composer is detected.
 */

const API_BASE_URL = "http://localhost:3001";

interface Suggestion {
  meme_id: string;
  name: string;
  image_url: string;
  image_data_url?: string | null;
  use_case_label: string;
  match_explanation: string;
  score: number;
}

let panelHost: HTMLDivElement | null = null;
let shadowRoot: ShadowRoot | null = null;
let isDragging = false;
let dragOffset = { x: 0, y: 0 };
let currentSuggestions: Suggestion[] = [];

const PANEL_STYLES = `
  :host {
    all: initial;
    position: fixed;
    z-index: 10001;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  .panel {
    background: #1a1a2e;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 12px;
    padding: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    max-width: 500px;
    min-width: 320px;
    cursor: grab;
    user-select: none;
  }
  .panel.dragging { cursor: grabbing; }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
    padding-bottom: 8px;
    border-bottom: 1px solid rgba(255,255,255,0.1);
  }
  .title {
    color: #fff;
    font-size: 13px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .title-icon { font-size: 16px; }
  .close-btn {
    background: none;
    border: none;
    color: rgba(255,255,255,0.5);
    cursor: pointer;
    font-size: 18px;
    padding: 2px 6px;
    border-radius: 4px;
    line-height: 1;
  }
  .close-btn:hover { color: #fff; background: rgba(255,255,255,0.1); }
  .meme-strip {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    scroll-behavior: smooth;
    padding-bottom: 4px;
  }
  .meme-strip::-webkit-scrollbar { height: 4px; }
  .meme-strip::-webkit-scrollbar-track { background: transparent; }
  .meme-strip::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 2px; }
  .meme-card {
    flex-shrink: 0;
    width: 88px;
    cursor: pointer;
    border-radius: 8px;
    overflow: hidden;
    border: 2px solid transparent;
    transition: border-color 0.15s, transform 0.15s;
    background: rgba(255,255,255,0.05);
  }
  .meme-card:hover {
    border-color: #1d9bf0;
    transform: translateY(-2px);
  }
  .meme-card img {
    width: 88px;
    height: 88px;
    object-fit: cover;
    display: block;
  }
  .meme-label {
    padding: 4px 6px;
    font-size: 10px;
    color: rgba(255,255,255,0.7);
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .loading {
    color: rgba(255,255,255,0.5);
    font-size: 12px;
    text-align: center;
    padding: 20px;
  }
  .empty {
    color: rgba(255,255,255,0.4);
    font-size: 12px;
    text-align: center;
    padding: 16px;
  }
  .nav-hint {
    color: rgba(255,255,255,0.3);
    font-size: 10px;
    text-align: center;
    margin-top: 6px;
  }
`;

function createPanel(): { host: HTMLDivElement; shadow: ShadowRoot } {
  const host = document.createElement("div");
  host.id = "memedrop-suggestion-panel";
  Object.assign(host.style, {
    position: "fixed",
    bottom: "80px",
    right: "24px",
    zIndex: "10001",
  });

  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = PANEL_STYLES;
  shadow.appendChild(style);

  document.body.appendChild(host);
  return { host, shadow };
}

function renderLoading() {
  if (!shadowRoot) return;
  const existing = shadowRoot.querySelector(".panel");
  if (existing) existing.remove();

  const panel = document.createElement("div");
  panel.className = "panel";
  panel.innerHTML = `
    <div class="header">
      <span class="title"><span class="title-icon">&#x1f4a7;</span> MemeDrop</span>
      <button class="close-btn">&times;</button>
    </div>
    <div class="loading">Finding the perfect meme...</div>
  `;

  panel.querySelector(".close-btn")!.addEventListener("click", hidePanel);
  setupDrag(panel);
  shadowRoot.appendChild(panel);
}

function renderSuggestions(suggestions: Suggestion[]) {
  if (!shadowRoot) return;
  currentSuggestions = suggestions;

  const existing = shadowRoot.querySelector(".panel");
  if (existing) existing.remove();

  const panel = document.createElement("div");
  panel.className = "panel";

  if (suggestions.length === 0) {
    panel.innerHTML = `
      <div class="header">
        <span class="title"><span class="title-icon">&#x1f4a7;</span> MemeDrop</span>
        <button class="close-btn">&times;</button>
      </div>
      <div class="empty">No meme suggestions yet. Save some memes first!</div>
    `;
  } else {
    const header = document.createElement("div");
    header.className = "header";
    header.innerHTML = `
      <span class="title"><span class="title-icon">&#x1f4a7;</span> MemeDrop</span>
      <button class="close-btn">&times;</button>
    `;

    const strip = document.createElement("div");
    strip.className = "meme-strip";

    for (const s of suggestions.slice(0, 10)) {
      const card = document.createElement("div");
      card.className = "meme-card";
      card.title = `${s.name}\n${s.match_explanation}`;

      const img = document.createElement("img");
      img.src = getBestImageSrc(s);
      img.alt = s.name;
      img.loading = "lazy";

      const label = document.createElement("div");
      label.className = "meme-label";
      label.textContent = getDisplayName(s);

      card.appendChild(img);
      card.appendChild(label);

      card.addEventListener("click", (e) => {
        e.stopPropagation();
        insertMemeIntoComposer(s);
      });

      strip.appendChild(card);
    }

    panel.appendChild(header);
    panel.appendChild(strip);

    if (suggestions.length > 5) {
      const hint = document.createElement("div");
      hint.className = "nav-hint";
      hint.textContent = "Scroll for more →";
      panel.appendChild(hint);
    }
  }

  panel.querySelector(".close-btn")!.addEventListener("click", hidePanel);
  setupDrag(panel);
  shadowRoot.appendChild(panel);
}

function setupDrag(panel: HTMLElement) {
  panel.addEventListener("mousedown", (e) => {
    const target = e.target as HTMLElement;
    // Don't drag when clicking cards or close button
    if (target.closest(".meme-card") || target.closest(".close-btn")) return;

    isDragging = true;
    panel.classList.add("dragging");

    const hostRect = panelHost!.getBoundingClientRect();
    dragOffset.x = e.clientX - hostRect.left;
    dragOffset.y = e.clientY - hostRect.top;

    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!isDragging || !panelHost) return;
    panelHost.style.left = `${e.clientX - dragOffset.x}px`;
    panelHost.style.top = `${e.clientY - dragOffset.y}px`;
    panelHost.style.right = "auto";
    panelHost.style.bottom = "auto";
  });

  document.addEventListener("mouseup", () => {
    if (isDragging) {
      isDragging = false;
      const p = shadowRoot?.querySelector(".panel");
      if (p) p.classList.remove("dragging");
    }
  });
}

async function insertMemeIntoComposer(suggestion: Suggestion) {
  await insertMemeByUrl({
    imageUrl: suggestion.image_url,
    imageDataUrl: suggestion.image_data_url ?? null,
    memeId: suggestion.meme_id,
  });
}

type InsertMemeInput = {
  imageUrl: string;
  imageDataUrl?: string | null;
  memeId?: string;
};

export async function insertMemeByUrl(payload: InsertMemeInput) {
  try {
    const blob = await resolveMemeBlob(payload.imageUrl, payload.imageDataUrl);

    // Create a File object
    const ext = payload.imageUrl.split(".").pop() || "jpg";
    const mimeType = blob.type || `image/${ext === "jpg" ? "jpeg" : ext}`;
    const file = new File([blob], `meme.${ext}`, { type: mimeType });

    // Use clipboard API to paste into the compose box
    const clipboardItem = new ClipboardItem({ [mimeType]: blob });
    await navigator.clipboard.write([clipboardItem]);

    // Focus the composer and simulate paste
    const composer = document.querySelector(
      'div[data-testid="tweetTextarea_0"]'
    ) as HTMLElement;
    if (composer) {
      composer.focus();

      // Dispatch paste event with the file
      const dt = new DataTransfer();
      dt.items.add(file);
      const pasteEvent = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: dt,
      });
      composer.dispatchEvent(pasteEvent);
    }

    // Log usage
    if (payload.memeId) {
      chrome.runtime.sendMessage({
        type: "LOG_USAGE",
        payload: {
          meme_id: payload.memeId,
          action: "used",
          tweet_context: {},
        },
      });
    }

    // Brief visual feedback then hide
    setTimeout(() => hidePanel(), 500);
  } catch (err) {
    console.error("[MemeDrop] Failed to insert meme:", err);
    // Fallback: copy image URL to clipboard
    try {
      await navigator.clipboard.writeText(payload.imageUrl);
      const { showToast } = await import("./toast");
      showToast("Image URL copied — paste it manually", "success");
    } catch {
      const { showToast } = await import("./toast");
      showToast("Could not insert meme", "error");
    }
  }
}

function getBestImageSrc(suggestion: Suggestion): string {
  if (suggestion.image_data_url) {
    return suggestion.image_data_url;
  }

  if (/^https?:\/\//i.test(suggestion.image_url)) {
    return suggestion.image_url;
  }

  return `${API_BASE_URL}${suggestion.image_url}`;
}

function getDisplayName(suggestion: Suggestion): string {
  const cleanedName = (suggestion.name || "").trim();
  if (cleanedName && !/^unnamed\s+meme$/i.test(cleanedName)) {
    return cleanedName;
  }

  if (suggestion.use_case_label?.trim()) {
    return suggestion.use_case_label.replace(/_/g, " ");
  }

  return "Untitled meme";
}

async function resolveMemeBlob(
  imageUrl: string,
  imageDataUrl?: string | null
): Promise<Blob> {
  if (imageDataUrl) {
    const response = await fetch(imageDataUrl);
    return response.blob();
  }

  const directUrl = /^https?:\/\//i.test(imageUrl)
    ? imageUrl
    : `${API_BASE_URL}${imageUrl}`;

  try {
    const directResponse = await fetch(directUrl);
    if (directResponse.ok) {
      return directResponse.blob();
    }
  } catch {
    // Fall through to background fetch bridge.
  }

  const bridgeResult = await chrome.runtime.sendMessage({
    type: "FETCH_MEDIA_DATA_URL",
    payload: { image_url: directUrl },
  });

  if (!bridgeResult?.image_data_url) {
    throw new Error(bridgeResult?.error || "Could not resolve media data");
  }

  const bridgedResponse = await fetch(bridgeResult.image_data_url as string);
  return bridgedResponse.blob();
}

export function showSuggestionPanel() {
  // Create panel if it doesn't exist
  if (!panelHost || !shadowRoot) {
    const { host, shadow } = createPanel();
    panelHost = host;
    shadowRoot = shadow;
  }

  renderLoading();
  panelHost.style.display = "block";
}

export function updateSuggestions(suggestions: Suggestion[]) {
  if (!shadowRoot) {
    const { host, shadow } = createPanel();
    panelHost = host;
    shadowRoot = shadow;
  }
  renderSuggestions(suggestions);
  panelHost!.style.display = "block";
}

export function hidePanel() {
  if (panelHost) {
    panelHost.style.display = "none";
  }

  // Log dismissal if suggestions were showing
  if (currentSuggestions.length > 0) {
    for (const s of currentSuggestions) {
      chrome.runtime.sendMessage({
        type: "LOG_USAGE",
        payload: {
          meme_id: s.meme_id,
          action: "dismissed",
          tweet_context: {},
        },
      });
    }
    currentSuggestions = [];
  }
}

export function isPanelVisible(): boolean {
  return panelHost?.style.display !== "none" && panelHost !== null;
}
