/**
 * Suggestion panel — Shadow DOM component injected into X.com
 * Shows meme suggestions in a horizontal strip when a reply composer is detected.
 */

import { SELECTORS } from "./selectors";

const API_BASE_URL = "http://localhost:3001";
const MEME_DROP_MIME_TYPE = "application/x-memedrop-meme";

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
    width: 96px;
    cursor: pointer;
    border-radius: 8px;
    overflow: hidden;
    border: 2px solid transparent;
    transition: border-color 0.15s, transform 0.15s;
    background: rgba(255,255,255,0.05);
    position: relative;
  }
  .meme-card:hover {
    border-color: #1d9bf0;
    transform: translateY(-2px);
  }
  .meme-card img {
    width: 96px;
    height: 96px;
    object-fit: cover;
    display: block;
  }
  .meme-reason {
    padding: 5px 6px 3px;
    font-size: 10.5px;
    font-weight: 600;
    color: #fff;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    letter-spacing: 0.2px;
  }
  .meme-name {
    padding: 0 6px 5px;
    font-size: 9px;
    color: rgba(255,255,255,0.45);
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
      card.draggable = true;

      const img = document.createElement("img");
      img.src = getBestImageSrc(s);
      img.alt = s.name;
      img.loading = "lazy";
      img.draggable = false;

      const reason = document.createElement("div");
      reason.className = "meme-reason";
      reason.textContent = getPunchReason(s);

      const name = document.createElement("div");
      name.className = "meme-name";
      name.textContent = (s.name || "").trim() || "";

      card.appendChild(img);
      card.appendChild(reason);
      if (name.textContent) card.appendChild(name);

      card.addEventListener("click", (e) => {
        e.stopPropagation();
        insertMemeIntoComposer(s);
      });

      card.addEventListener("dragstart", (e) => {
        if (!e.dataTransfer) return;
        e.stopPropagation();
        e.dataTransfer.effectAllowed = "copy";

        // Our custom payload is the reliable path — the drop handler reads
        // meme_id + the original backend URL directly, so we don't have to
        // round-trip through a data URL at drag time.
        e.dataTransfer.setData(
          MEME_DROP_MIME_TYPE,
          JSON.stringify({
            imageUrl: s.image_url,
            memeId: s.meme_id,
            imageDataUrl: s.image_data_url ?? undefined,
          })
        );

        // Fallback for generic drop targets — but only ever an http(s) URL.
        // A `data:` URL in text/uri-list breaks other consumers (including
        // our own older drop handling) and is what caused the
        // "could not load image" regression.
        const httpUrl = /^https?:\/\//i.test(s.image_url)
          ? s.image_url
          : `${API_BASE_URL}${s.image_url.startsWith("/") ? "" : "/"}${s.image_url}`;
        e.dataTransfer.setData("text/uri-list", httpUrl);
        e.dataTransfer.setData("text/plain", httpUrl);

        if (img.complete && img.naturalWidth > 0) {
          e.dataTransfer.setDragImage(img, img.width / 2, img.height / 2);
        }
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

/**
 * Re-encode the blob as PNG through a canvas.
 *
 * Why: (1) `ClipboardItem` reliably accepts only image/png in Chrome — jpeg
 * sometimes throws NotAllowedError. (2) X's upload handler prefers PNG/JPEG
 * Files coming through its file input; re-encoding normalizes everything
 * (including unknown types served by `/memes/...`) into a format X accepts.
 */
async function toPngFile(blob: Blob, filename = "meme.png"): Promise<File> {
  if (blob.type === "image/png") {
    return new File([blob], filename, { type: "image/png" });
  }

  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2d context unavailable");
  ctx.drawImage(bitmap, 0, 0);

  const pngBlob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
      "image/png"
    );
  });

  return new File([pngBlob], filename, { type: "image/png" });
}

/**
 * Hand the file to X's real upload pipeline via its hidden file input.
 *
 * This is the only approach that consistently triggers X's image-attach
 * flow. Synthetic paste events don't — X reads `isTrusted` in a few places
 * and the React tree ignores un-trusted clipboard events in some layouts.
 */
async function attachViaFileInput(file: File): Promise<boolean> {
  const inputs = Array.from(
    document.querySelectorAll<HTMLInputElement>(SELECTORS.composerFileInput)
  );

  // Fallback lookup: any image-accepting file input nearby.
  const candidates =
    inputs.length > 0
      ? inputs
      : Array.from(
          document.querySelectorAll<HTMLInputElement>('input[type="file"]')
        ).filter((i) => (i.accept || "").includes("image"));

  if (candidates.length === 0) return false;

  // Prefer one that is currently in the DOM *and* not disabled. Most X
  // layouts only have one composer open at a time, but reply-from-feed
  // modals can coexist with an inline composer — pick the last one since
  // that's typically the most recently opened.
  const input = candidates[candidates.length - 1];

  const dt = new DataTransfer();
  dt.items.add(file);
  // `files` is a read-only FileList on the prototype, but setting it on the
  // instance works in Chromium and is the standard trick used across the
  // extension community.
  input.files = dt.files;

  input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  return true;
}

/**
 * Fallback — synthetic paste event into the contentEditable composer. Works
 * on some X surface variants, and when it does it produces the same result
 * as a real paste (X auto-attaches the pasted image).
 */
function attachViaPasteEvent(file: File): boolean {
  const composer = document.querySelector<HTMLElement>(
    SELECTORS.tweetTextarea
  );
  if (!composer) return false;

  composer.focus();

  const dt = new DataTransfer();
  dt.items.add(file);

  const evt = new ClipboardEvent("paste", {
    bubbles: true,
    cancelable: true,
    clipboardData: dt,
  });
  composer.dispatchEvent(evt);
  return true;
}

export async function insertMemeByUrl(payload: InsertMemeInput) {
  let file: File | null = null;

  try {
    const raw = await resolveMemeBlob(payload.imageUrl, payload.imageDataUrl);
    file = await toPngFile(raw);
  } catch (err) {
    console.error("[MemeDrop] Could not load meme image:", err);
    const { showToast } = await import("./toast");
    showToast("Could not load meme image", "error");
    return;
  }

  const logUsage = () => {
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
  };

  // Strategy 1: file input — the reliable path.
  try {
    if (await attachViaFileInput(file)) {
      logUsage();
      setTimeout(() => hidePanel(), 400);
      return;
    }
  } catch (err) {
    console.warn("[MemeDrop] File input attach failed:", err);
  }

  // Strategy 2: synthetic paste event on the contentEditable composer.
  try {
    if (attachViaPasteEvent(file)) {
      logUsage();
      setTimeout(() => hidePanel(), 400);
      return;
    }
  } catch (err) {
    console.warn("[MemeDrop] Synthetic paste failed:", err);
  }

  // Strategy 3: put the PNG on the clipboard so Cmd+V into the composer
  // works. We deliberately do NOT writeText here — a text URL on the
  // clipboard would paste as a link / base64 blob into X's text field,
  // which is exactly the bug we're fixing.
  try {
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": file }),
    ]);
    const { showToast } = await import("./toast");
    showToast("Meme copied — click composer then Cmd+V", "success");
    logUsage();
  } catch (err) {
    console.error("[MemeDrop] Clipboard fallback failed:", err);
    const { showToast } = await import("./toast");
    showToast("Couldn't attach meme — open the image tab in X first", "error");
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

function getPunchReason(suggestion: Suggestion): string {
  const label = (suggestion.use_case_label || "").trim();
  if (label) return label.replace(/_/g, " ");

  const cleanedName = (suggestion.name || "").trim();
  if (cleanedName && !/^unnamed\s+meme$/i.test(cleanedName)) {
    return cleanedName;
  }
  return "use it";
}

async function resolveMemeBlob(
  imageUrl: string,
  imageDataUrl?: string | null
): Promise<Blob> {
  if (imageDataUrl) {
    const response = await fetch(imageDataUrl);
    return response.blob();
  }

  // A data: URL can flow in through drag-and-drop (text/uri-list) or
  // through direct calls. `fetch` handles it natively.
  if (imageUrl.startsWith("data:")) {
    const response = await fetch(imageUrl);
    return response.blob();
  }

  const directUrl = /^https?:\/\//i.test(imageUrl)
    ? imageUrl
    : `${API_BASE_URL}${imageUrl.startsWith("/") ? "" : "/"}${imageUrl}`;

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
