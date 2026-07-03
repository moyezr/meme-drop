/**
 * Suggestion panel — Shadow DOM component injected into X.com
 * Shows meme suggestions in a horizontal strip when a reply composer is detected.
 */

import { SELECTORS } from "./selectors";
import { showToast } from "./toast";
import { API_BASE_URL } from "../shared/config";

const MEME_DROP_MIME_TYPE = "application/x-memedrop-meme";
const IMAGE_PLACEHOLDER =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

interface Suggestion {
  meme_id: string;
  name: string;
  image_url: string;
  tailored_overlay?: MemeTextOverlay | null;
  tailored_image_data_url?: string | null;
  image_data_url?: string | null;
  use_case_label: string;
  match_explanation: string;
  score: number;
  source: "user" | "global";
  tweet_text?: string;
  tweet_context?: Record<string, unknown>;
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

let panelHost: HTMLDivElement | null = null;
let shadowRoot: ShadowRoot | null = null;
let isDragging = false;
let dragListenersInstalled = false;
let dragOffset = { x: 0, y: 0 };
let currentSuggestions: Suggestion[] = [];
let usedSuggestionIds = new Set<string>();
let shownSuggestionIds = new Set<string>();
let insertingSuggestionId: string | null = null;

const PANEL_STYLES = `
  :host {
    all: initial;
    position: fixed;
    z-index: 10001;
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif;
    color: #f8efe2;
  }
  .panel {
    position: relative;
    overflow: hidden;
    background:
      radial-gradient(circle at 14% 2%, rgba(245, 170, 62, 0.18), transparent 34%),
      radial-gradient(circle at 100% 0%, rgba(238, 82, 52, 0.2), transparent 28%),
      rgba(18, 16, 13, 0.94);
    border: 1px solid rgba(255,255,255,0.14);
    border-radius: 22px;
    padding: 14px;
    box-shadow: 0 20px 70px rgba(0,0,0,0.52), inset 0 1px 0 rgba(255,255,255,0.08);
    max-width: min(560px, calc(100vw - 28px));
    min-width: min(360px, calc(100vw - 28px));
    cursor: grab;
    user-select: none;
    backdrop-filter: blur(18px);
    animation: panel-in 220ms cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  .panel.dragging { cursor: grabbing; }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 14px;
    margin-bottom: 12px;
  }
  .title {
    min-width: 0;
    color: #fff8ec;
    font-size: 14px;
    font-weight: 850;
    display: flex;
    align-items: center;
    gap: 8px;
    letter-spacing: -0.01em;
  }
  .title-icon {
    display: grid;
    width: 24px;
    height: 24px;
    place-items: center;
    border-radius: 999px;
    color: #17120d;
    background: #f4b23c;
    font-size: 13px;
    font-weight: 950;
  }
  .subtitle {
    display: block;
    margin-top: 2px;
    color: rgba(248,239,226,0.56);
    font-size: 11px;
    font-weight: 650;
    letter-spacing: 0;
  }
  .close-btn,
  .refresh-btn {
    display: grid;
    width: 30px;
    height: 30px;
    place-items: center;
    background: rgba(255,255,255,0.07);
    border: none;
    color: rgba(255,255,255,0.66);
    cursor: pointer;
    font-size: 15px;
    padding: 0;
    border-radius: 999px;
    line-height: 1;
    transition: color 140ms ease, background 140ms ease, transform 140ms ease;
  }
  .close-btn:hover,
  .refresh-btn:hover {
    color: #fff;
    background: rgba(255,255,255,0.14);
    transform: translateY(-1px);
  }
  .header-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .meme-strip {
    display: flex;
    gap: 10px;
    overflow-x: auto;
    scroll-behavior: smooth;
    padding: 1px 1px 8px;
    overscroll-behavior-x: contain;
  }
  .meme-strip::-webkit-scrollbar { height: 4px; }
  .meme-strip::-webkit-scrollbar-track { background: transparent; }
  .meme-strip::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.22); border-radius: 999px; }
  .meme-card {
    flex-shrink: 0;
    width: 118px;
    cursor: pointer;
    border-radius: 16px;
    overflow: hidden;
    border: 1px solid rgba(255,255,255,0.1);
    transition: border-color 0.16s ease, transform 0.16s ease, background 0.16s ease, box-shadow 0.16s ease;
    background: rgba(255,255,255,0.065);
    position: relative;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);
  }
  .meme-card:hover {
    border-color: rgba(244,178,60,0.82);
    transform: translateY(-3px) rotate(-0.6deg);
    background: rgba(255,255,255,0.1);
    box-shadow: 0 14px 32px rgba(0,0,0,0.26);
  }
  .meme-card.is-busy {
    pointer-events: none;
    border-color: rgba(244,178,60,0.92);
  }
  .meme-card img {
    width: 118px;
    height: 118px;
    object-fit: cover;
    display: block;
    background: linear-gradient(115deg, rgba(255,255,255,0.07), rgba(255,255,255,0.14), rgba(255,255,255,0.07));
  }
  .source-badge {
    position: absolute;
    top: 7px;
    left: 7px;
    padding: 3px 6px;
    border-radius: 999px;
    background: rgba(0,0,0,0.66);
    color: rgba(255,255,255,0.9);
    font-size: 8px;
    font-weight: 900;
    letter-spacing: 0;
    text-transform: uppercase;
    backdrop-filter: blur(8px);
  }
  .tailored-badge {
    position: absolute;
    top: 7px;
    right: 7px;
    padding: 3px 6px;
    border-radius: 999px;
    background: rgba(244,178,60,0.95);
    color: #17120d;
    font-size: 8px;
    font-weight: 950;
    letter-spacing: 0;
    text-transform: uppercase;
  }
  .meme-reason {
    padding: 8px 8px 3px;
    font-size: 11px;
    font-weight: 850;
    color: #fff;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    letter-spacing: -0.01em;
  }
  .meme-name {
    padding: 0 8px 8px;
    font-size: 9.5px;
    font-weight: 650;
    color: rgba(255,255,255,0.46);
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .card-overlay {
    position: absolute;
    inset: 0;
    display: none;
    align-items: center;
    justify-content: center;
    padding: 12px;
    color: #fff8ec;
    background: rgba(12,10,8,0.74);
    backdrop-filter: blur(6px);
    text-align: center;
    font-size: 11px;
    font-weight: 850;
    line-height: 1.25;
  }
  .meme-card.is-busy .card-overlay {
    display: flex;
  }
  .spinner {
    width: 18px;
    height: 18px;
    margin: 0 auto 8px;
    border: 2px solid rgba(255,255,255,0.28);
    border-top-color: #f4b23c;
    border-radius: 50%;
    animation: spin 650ms linear infinite;
  }
  .loading {
    color: rgba(255,255,255,0.66);
    font-size: 12px;
    font-weight: 700;
    padding: 6px 2px 2px;
  }
  .loading-copy {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }
  .loading-copy strong {
    color: #fff8ec;
    font-size: 13px;
  }
  .loading-copy span {
    color: rgba(255,255,255,0.48);
    font-size: 11px;
  }
  .skeleton-row {
    display: flex;
    gap: 10px;
  }
  .skeleton-card {
    width: 118px;
    flex: 0 0 118px;
  }
  .skeleton-img,
  .skeleton-line,
  .skeleton-short {
    border-radius: 14px;
    background: linear-gradient(100deg, rgba(255,255,255,0.06) 20%, rgba(255,255,255,0.14) 36%, rgba(255,255,255,0.06) 52%);
    background-size: 220% 100%;
    animation: shimmer 1050ms linear infinite;
  }
  .skeleton-img {
    height: 118px;
    margin-bottom: 8px;
  }
  .skeleton-line {
    height: 10px;
    margin: 0 8px 6px;
  }
  .skeleton-short {
    width: 64%;
    height: 8px;
    margin: 0 auto;
  }
  .empty {
    color: rgba(255,255,255,0.58);
    font-size: 12px;
    font-weight: 700;
    text-align: center;
    padding: 18px 10px 14px;
  }
  .nav-hint {
    color: rgba(255,255,255,0.36);
    font-size: 10.5px;
    font-weight: 700;
    text-align: center;
    margin-top: 2px;
  }
  @keyframes panel-in {
    from { opacity: 0; transform: translateY(8px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  @keyframes shimmer {
    to { background-position-x: -220%; }
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
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
      <span class="title">
        <span class="title-icon">M</span>
        <span>MemeDrop<span class="subtitle">ranking visual matches first</span></span>
      </span>
      <div class="header-actions">
        <button class="refresh-btn" title="Refresh suggestions">↻</button>
        <button class="close-btn" title="Close">&times;</button>
      </div>
    </div>
    <div class="loading">
      <div class="loading-copy">
        <strong>Finding the right meme...</strong>
        <span>analyzing context and punchline fit</span>
      </div>
      <div class="skeleton-row" aria-hidden="true">
        ${Array.from({ length: 4 })
          .map(
            () => `
              <div class="skeleton-card">
                <div class="skeleton-img"></div>
                <div class="skeleton-line"></div>
                <div class="skeleton-short"></div>
              </div>
            `
          )
          .join("")}
      </div>
    </div>
  `;

  panel.querySelector(".close-btn")!.addEventListener("click", dismissPanel);
  panel.querySelector(".refresh-btn")!.addEventListener("click", requestRefresh);
  setupDrag(panel);
  shadowRoot.appendChild(panel);
}

function renderSuggestions(suggestions: Suggestion[]) {
  if (!shadowRoot) return;
  currentSuggestions = suggestions;
  insertingSuggestionId = null;
  usedSuggestionIds.clear();
  shownSuggestionIds.clear();

  const existing = shadowRoot.querySelector(".panel");
  if (existing) existing.remove();

  const panel = document.createElement("div");
  panel.className = "panel";

  if (suggestions.length === 0) {
    panel.innerHTML = `
      <div class="header">
        <span class="title">
          <span class="title-icon">M</span>
          <span>MemeDrop<span class="subtitle">no strong match yet</span></span>
        </span>
        <div class="header-actions">
          <button class="refresh-btn" title="Refresh suggestions">↻</button>
          <button class="close-btn" title="Close">&times;</button>
        </div>
      </div>
      <div class="empty">No meme suggestions yet. Try refreshing.</div>
    `;
  } else {
    const header = document.createElement("div");
    header.className = "header";
    header.innerHTML = `
      <span class="title">
        <span class="title-icon">M</span>
        <span>MemeDrop<span class="subtitle">click or drag into the reply</span></span>
      </span>
      <div class="header-actions">
        <button class="refresh-btn" title="Refresh suggestions">↻</button>
        <button class="close-btn" title="Close">&times;</button>
      </div>
    `;

    const strip = document.createElement("div");
    strip.className = "meme-strip";

    for (const s of suggestions.slice(0, 10)) {
      const card = document.createElement("div");
      card.className = "meme-card";
      card.dataset.memeId = s.meme_id;
      card.title = getCardTitle(s);
      card.draggable = true;

      const img = document.createElement("img");
      img.src = getBestImageSrc(s);
      img.alt = s.name;
      img.loading = "lazy";
      img.draggable = false;

      const reason = document.createElement("div");
      reason.className = "meme-reason";
      reason.textContent = getPunchReason(s);

      const badge = document.createElement("div");
      badge.className = "source-badge";
      badge.textContent = s.source === "user" ? "saved" : "global";

      const tailoredBadge = document.createElement("div");
      tailoredBadge.className = "tailored-badge";
      tailoredBadge.textContent = "text";

      const cardOverlay = document.createElement("div");
      cardOverlay.className = "card-overlay";
      cardOverlay.innerHTML = `
        <span>
          <span class="spinner"></span>
          Preparing caption...
        </span>
      `;

      const name = document.createElement("div");
      name.className = "meme-name";
      name.textContent = (s.name || "").trim() || "";

      card.appendChild(img);
      card.appendChild(badge);
      if (s.tailored_overlay?.enabled) card.appendChild(tailoredBadge);
      card.appendChild(reason);
      if (name.textContent) card.appendChild(name);
      card.appendChild(cardOverlay);

      if (s.image_data_url) {
        if (s.tailored_overlay?.enabled) {
          hydrateTailoredPreview(s, img);
        } else {
          img.src = s.image_data_url;
        }
      }

      card.addEventListener("click", (e) => {
        e.stopPropagation();
        logSuggestionUsage(s, "clicked");
        insertMemeIntoComposer(s).catch((err) => {
          console.error("[MemeDrop] Insert from suggestion failed:", err);
          showToast("Could not attach meme", "error");
        });
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
            tailoredImageDataUrl: s.tailored_image_data_url ?? undefined,
            tailoredOverlay: s.tailored_overlay ?? undefined,
            source: s.source,
          })
        );

        // Fallback for generic drop targets — but only ever an http(s) URL.
        // A `data:` URL in text/uri-list breaks other consumers (including
        // our own older drop handling) and is what caused the
        // "could not load image" regression.
        const httpUrl = getFetchableImageUrl(s);
        e.dataTransfer.setData("text/uri-list", httpUrl);
        e.dataTransfer.setData("text/plain", httpUrl);

        if (img.complete && img.naturalWidth > 0) {
          e.dataTransfer.setDragImage(img, img.width / 2, img.height / 2);
        }
      });

      strip.appendChild(card);
      logSuggestionUsage(s, "shown");
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

  panel.querySelector(".close-btn")!.addEventListener("click", dismissPanel);
  panel.querySelector(".refresh-btn")!.addEventListener("click", requestRefresh);
  setupDrag(panel);
  shadowRoot.appendChild(panel);
}

function setupDrag(panel: HTMLElement) {
  panel.addEventListener("mousedown", (e) => {
    const target = e.target as HTMLElement;
    // Don't drag when clicking cards or close button
    if (target.closest(".meme-card") || target.closest(".close-btn") || target.closest(".refresh-btn")) return;

    isDragging = true;
    panel.classList.add("dragging");

    const hostRect = panelHost!.getBoundingClientRect();
    dragOffset.x = e.clientX - hostRect.left;
    dragOffset.y = e.clientY - hostRect.top;

    e.preventDefault();
  });

  if (dragListenersInstalled) return;
  dragListenersInstalled = true;

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

function requestRefresh(e: Event) {
  e.stopPropagation();
  window.dispatchEvent(new CustomEvent("memedrop:refresh-suggestions"));
}

function dismissPanel(e: Event) {
  e.stopPropagation();
  window.dispatchEvent(new CustomEvent("memedrop:suggestions-dismissed"));
  hidePanel();
}

async function insertMemeIntoComposer(suggestion: Suggestion) {
  setCardBusy(suggestion.meme_id, true, "Preparing caption...");

  try {
    if (!suggestion.tailored_overlay?.enabled && suggestion.tweet_text) {
      const overlay = await requestTailoredCaption(suggestion).catch(() => null);
      if (overlay?.enabled) {
        suggestion.tailored_overlay = overlay;
      }
    }

    if (suggestion.tailored_overlay?.enabled && !suggestion.tailored_image_data_url) {
      setCardBusy(suggestion.meme_id, true, "Rendering meme...");
      suggestion.tailored_image_data_url = await renderTailoredMemeDataUrl(suggestion).catch(
        () => null
      );
    }

    setCardBusy(suggestion.meme_id, true, "Attaching to X...");
    await insertMemeByUrl({
      imageUrl: suggestion.image_url,
      imageDataUrl: suggestion.image_data_url ?? null,
      tailoredImageDataUrl: suggestion.tailored_image_data_url ?? null,
      tailoredOverlay: suggestion.tailored_overlay ?? null,
      memeId: suggestion.meme_id,
      source: suggestion.source,
    });
  } finally {
    setCardBusy(suggestion.meme_id, false);
  }
}

function setCardBusy(memeId: string, busy: boolean, label = "Preparing meme...") {
  insertingSuggestionId = busy ? memeId : insertingSuggestionId === memeId ? null : insertingSuggestionId;
  const card = Array.from(shadowRoot?.querySelectorAll<HTMLElement>(".meme-card") || [])
    .find((item) => item.dataset.memeId === memeId);
  if (!card) return;
  card.classList.toggle("is-busy", busy);
  card.setAttribute("aria-busy", busy ? "true" : "false");
  const overlay = card.querySelector<HTMLElement>(".card-overlay span");
  if (overlay) {
    overlay.innerHTML = busy ? `<span class="spinner"></span>${label}` : "";
  }
}

async function requestTailoredCaption(
  suggestion: Suggestion
): Promise<MemeTextOverlay | null> {
  if (!suggestion.tweet_text) return null;

  const result = await chrome.runtime.sendMessage({
    type: "GET_CAPTION",
    payload: {
      tweet_text: suggestion.tweet_text,
      meme_id: suggestion.meme_id,
    },
  });

  return result?.tailored_overlay ?? null;
}

type InsertMemeInput = {
  imageUrl: string;
  imageDataUrl?: string | null;
  tailoredImageDataUrl?: string | null;
  tailoredOverlay?: MemeTextOverlay | null;
  memeId?: string;
  source?: "user" | "global";
  composerTarget?: Element | null;
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

async function hydrateTailoredPreview(suggestion: Suggestion, img: HTMLImageElement) {
  if (!suggestion.tailored_overlay?.enabled) return;

  try {
    const dataUrl = await renderTailoredMemeDataUrl(suggestion);
    suggestion.tailored_image_data_url = dataUrl;
    if (currentSuggestions.some((s) => s.meme_id === suggestion.meme_id)) {
      img.src = dataUrl;
    }
  } catch (err) {
    console.warn("[MemeDrop] Tailored meme preview failed:", err);
  }
}

async function renderTailoredMemeDataUrl(suggestion: Suggestion): Promise<string> {
  if (suggestion.tailored_image_data_url) return suggestion.tailored_image_data_url;
  const overlay = suggestion.tailored_overlay;
  if (!overlay?.enabled || overlay.regions.length === 0) {
    return suggestion.image_data_url || suggestion.image_url;
  }

  return renderMemeWithOverlay(suggestion.image_url, suggestion.image_data_url, overlay);
}

async function renderMemeWithOverlay(
  imageUrl: string,
  imageDataUrl: string | null | undefined,
  overlay: MemeTextOverlay
): Promise<string> {
  const raw = await resolveMemeBlob(imageUrl, imageDataUrl);
  const bitmap = await createImageBitmap(raw);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2d context unavailable");

  ctx.drawImage(bitmap, 0, 0);

  for (const region of overlay.regions) {
    drawImpactText(ctx, canvas.width, canvas.height, region);
  }

  return canvas.toDataURL("image/png");
}

function drawImpactText(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  region: MemeTextRegion
) {
  const x = region.x * canvasWidth;
  const y = region.y * canvasHeight;
  const width = region.width * canvasWidth;
  const height = region.height * canvasHeight;
  const text = transformOverlayText(
    region.text.trim().slice(0, region.max_chars || 120),
    region.text_transform
  );
  if (!text) return;

  const fontScale = region.font_scale ?? 1;
  const manifestMax = region.font?.max_size || 52;
  const manifestMin = region.font?.min_size || 12;
  const padding = Math.max(4, Math.min(width, height) * 0.055);
  const safeX = x + padding;
  const safeY = y + padding;
  const safeWidth = Math.max(8, width - padding * 2);
  const safeHeight = Math.max(8, height - padding * 2);
  const minFont = Math.max(10, manifestMin);
  const maxFont = estimateImpactFontSize(ctx, text, safeWidth, safeHeight, {
    minFont,
    maxFont: manifestMax,
    fontScale,
  });
  const maxLines = region.max_lines || 4;
  let fontSize = maxFont;
  let lines = wrapImpactLines(ctx, text, safeWidth, fontSize, maxLines);

  while (
    fontSize - 0.5 >= minFont &&
    (lines.length * fontSize * 1.08 > safeHeight ||
      lines.some((line) => measureImpactText(ctx, line, fontSize) > safeWidth))
  ) {
    fontSize -= 0.5;
    lines = wrapImpactLines(ctx, text, safeWidth, fontSize, maxLines);
  }

  fontSize = Math.max(minFont, fontSize);
  lines = wrapImpactLines(ctx, text, safeWidth, fontSize, maxLines);

  ctx.save();
  ctx.beginPath();
  ctx.rect(safeX, safeY, safeWidth, safeHeight);
  ctx.clip();
  ctx.textAlign = region.align || "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;

  const lineHeight = fontSize * 1.08;
  const totalHeight = Math.min(lineHeight * lines.length, safeHeight);
  const startY =
    region.valign === "top"
      ? safeY + lineHeight / 2
      : region.valign === "bottom"
        ? safeY + safeHeight - totalHeight + lineHeight / 2
        : safeY + safeHeight / 2 - totalHeight / 2 + lineHeight / 2;
  const textX =
    region.align === "left"
      ? safeX
      : region.align === "right"
        ? safeX + safeWidth
        : safeX + safeWidth / 2;

  ctx.font = impactFont(fontSize);
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#000";
  ctx.lineWidth = Math.max(2, fontSize * (region.font?.stroke_ratio || 0.12));

  for (let i = 0; i < lines.length; i++) {
    const lineY = startY + i * lineHeight;
    ctx.strokeText(lines[i], textX, lineY);
    ctx.fillText(lines[i], textX, lineY);
  }
  ctx.restore();
}

function wrapImpactLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  fontSize: number,
  maxLines: number
): string[] {
  ctx.font = impactFont(fontSize);
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const pieces = breakLongWord(ctx, word, maxWidth);
    for (const piece of pieces) {
      const test = current ? `${current} ${piece}` : piece;
      if (ctx.measureText(test).width <= maxWidth) {
        current = test;
      } else {
        if (current) lines.push(current);
        current = piece;
      }
    }
  }

  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;

  const visible = lines.slice(0, Math.max(1, maxLines));
  let last = visible[visible.length - 1];
  while (last.length > 1 && ctx.measureText(`${last}...`).width > maxWidth) {
    last = last.slice(0, -1).trim();
  }
  visible[visible.length - 1] = last ? `${last}...` : "...";
  return visible;
}

function breakLongWord(ctx: CanvasRenderingContext2D, word: string, maxWidth: number): string[] {
  if (ctx.measureText(word).width <= maxWidth) return [word];

  const pieces: string[] = [];
  let current = "";
  for (const char of word) {
    const test = `${current}${char}`;
    if (!current || ctx.measureText(test).width <= maxWidth) {
      current = test;
    } else {
      pieces.push(current);
      current = char;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

function estimateImpactFontSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  width: number,
  height: number,
  options: { minFont: number; maxFont: number; fontScale: number }
): number {
  const words = text.split(/\s+/).filter(Boolean);
  const longestWordLength = words.reduce((max, word) => Math.max(max, word.length), 1);
  const targetLineCount = Math.max(1, Math.min(4, Math.ceil(text.length / 18)));
  const roughByLength = width / Math.max(longestWordLength * 0.72, text.length * 0.24);
  const roughByHeight = height / (targetLineCount * 1.08);
  let size = Math.min(options.maxFont, Math.max(options.minFont, roughByLength, roughByHeight));
  size *= options.fontScale;
  size = Math.min(options.maxFont, Math.max(options.minFont, size));

  ctx.font = impactFont(size);
  if (ctx.measureText(text).width <= width) return size;

  return Math.max(options.minFont, Math.min(size, width / Math.max(1, text.length * 0.54)));
}

function transformOverlayText(
  text: string,
  transform: MemeTextRegion["text_transform"] = "uppercase"
): string {
  if (transform === "none") return text;
  if (transform === "mocking") return toMockingCase(text);
  return text.toUpperCase();
}

function toMockingCase(text: string): string {
  let upper = false;
  return text
    .toLowerCase()
    .split("")
    .map((char) => {
      if (!/[a-z]/.test(char)) return char;
      upper = !upper;
      return upper ? char.toUpperCase() : char;
    })
    .join("");
}

function measureImpactText(
  ctx: CanvasRenderingContext2D,
  text: string,
  fontSize: number
): number {
  ctx.font = impactFont(fontSize);
  return ctx.measureText(text).width;
}

function impactFont(fontSize: number): string {
  return `${Math.floor(fontSize)}px Impact, Haettenschweiler, 'Arial Black', sans-serif`;
}

/**
 * Hand the file to X's real upload pipeline via its hidden file input.
 *
 * This is the only approach that consistently triggers X's image-attach
 * flow. Synthetic paste events don't — X reads `isTrusted` in a few places
 * and the React tree ignores un-trusted clipboard events in some layouts.
 */
async function attachViaFileInput(
  file: File,
  composerTarget?: Element | null
): Promise<boolean> {
  const scope = findComposerScope(composerTarget);
  const scopedInputs = scope
    ? Array.from(scope.querySelectorAll<HTMLInputElement>(SELECTORS.composerFileInput))
    : [];
  const allInputs = Array.from(
    document.querySelectorAll<HTMLInputElement>(SELECTORS.composerFileInput)
  );

  // Fallback lookup: any image-accepting file input nearby.
  const candidates =
    scopedInputs.length > 0
      ? scopedInputs
      : allInputs.length > 0
        ? preferDialogElements(allInputs)
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
function attachViaPasteEvent(
  file: File,
  composerTarget?: Element | null
): boolean {
  const scope = findComposerScope(composerTarget);
  const composer =
    scope.querySelector<HTMLElement>(SELECTORS.tweetTextarea) ||
    findVisibleModalComposer() ||
    document.querySelector<HTMLElement>(SELECTORS.tweetTextarea);
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

function findComposerScope(preferredTarget?: Element | null): Element | Document {
  const preferredDialog = preferredTarget?.closest(SELECTORS.composeDialog);
  if (preferredDialog && preferredDialog.querySelector(SELECTORS.tweetTextarea)) {
    return preferredDialog;
  }

  const activeDialog = findVisibleComposeDialog();
  if (activeDialog) return activeDialog;

  const activeComposer = document.activeElement?.closest(SELECTORS.tweetTextarea);
  const activeScope = activeComposer?.closest(SELECTORS.composeDialog);
  if (activeScope) return activeScope;

  return document;
}

function findVisibleComposeDialog(): HTMLElement | null {
  const dialogs = Array.from(
    document.querySelectorAll<HTMLElement>(SELECTORS.composeDialog)
  ).filter((dialog) => {
    if (!dialog.querySelector(SELECTORS.tweetTextarea)) return false;
    const rect = dialog.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });

  return dialogs.at(-1) || null;
}

function findVisibleModalComposer(): HTMLElement | null {
  return findVisibleComposeDialog()?.querySelector<HTMLElement>(
    SELECTORS.tweetTextarea
  ) || null;
}

function preferDialogElements<T extends Element>(elements: T[]): T[] {
  const dialog = findVisibleComposeDialog();
  if (!dialog) return elements;
  const scoped = elements.filter((element) => dialog.contains(element));
  return scoped.length > 0 ? scoped : elements;
}

export async function insertMemeByUrl(payload: InsertMemeInput) {
  let file: File | null = null;

  try {
    const tailoredImageDataUrl =
      payload.tailoredImageDataUrl ||
      (payload.tailoredOverlay?.enabled
        ? await renderMemeWithOverlay(
            payload.imageUrl,
            payload.imageDataUrl,
            payload.tailoredOverlay
          ).catch((err) => {
            console.warn("[MemeDrop] Tailored insert render failed:", err);
            return null;
          })
        : null);
    const raw = await resolveMemeBlob(
      payload.imageUrl,
      tailoredImageDataUrl ?? payload.imageDataUrl
    );
    file = await toPngFile(raw);
  } catch (err) {
    console.error("[MemeDrop] Could not load meme image:", err);
    showToast("Could not load meme image", "error");
    return;
  }

  const logUsage = () => {
    if (payload.memeId) {
      const suggestion = currentSuggestions.find((s) => s.meme_id === payload.memeId);
      usedSuggestionIds.add(payload.memeId);
      chrome.runtime.sendMessage({
        type: "LOG_USAGE",
        payload: {
          meme_id: payload.memeId,
          action: "used",
          source: suggestion?.source || payload.source,
          tweet_context: suggestion?.tweet_context || {},
        },
      });
    }
  };

  // Strategy 1: file input — the reliable path.
  try {
    if (await attachViaFileInput(file, payload.composerTarget)) {
      logUsage();
      setTimeout(() => hidePanel(), 400);
      return;
    }
  } catch (err) {
    console.warn("[MemeDrop] File input attach failed:", err);
  }

  // Strategy 2: synthetic paste event on the contentEditable composer.
  try {
    if (attachViaPasteEvent(file, payload.composerTarget)) {
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
    showToast("Meme copied — click composer then Cmd+V", "success");
    logUsage();
  } catch (err) {
    console.error("[MemeDrop] Clipboard fallback failed:", err);
    showToast("Couldn't attach meme — open the image tab in X first", "error");
  }
}

function getBestImageSrc(suggestion: Suggestion): string {
  if (suggestion.tailored_image_data_url) {
    return suggestion.tailored_image_data_url;
  }

  if (suggestion.image_data_url) {
    return suggestion.image_data_url;
  }

  if (/^(data:|blob:|filesystem:)/i.test(suggestion.image_url)) {
    return suggestion.image_url;
  }

  // Avoid broken localhost images inside X while the background worker is
  // still hydrating data URLs.
  return IMAGE_PLACEHOLDER;
}

function getCardTitle(suggestion: Suggestion): string {
  const overlayText = suggestion.tailored_overlay?.regions
    .map((region) => region.text)
    .filter(Boolean)
    .join(" / ");
  return [suggestion.name, overlayText, suggestion.match_explanation]
    .filter(Boolean)
    .join("\n");
}

function getFetchableImageUrl(suggestion: Suggestion): string {
  if (/^https?:\/\//i.test(suggestion.image_url)) {
    return suggestion.image_url;
  }

  return `${API_BASE_URL}${suggestion.image_url.startsWith("/") ? "" : "/"}${suggestion.image_url}`;
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

export function showSuggestionError(message: string) {
  if (!panelHost || !shadowRoot) {
    const { host, shadow } = createPanel();
    panelHost = host;
    shadowRoot = shadow;
  }

  const existing = shadowRoot.querySelector(".panel");
  if (existing) existing.remove();

  const panel = document.createElement("div");
  panel.className = "panel";
  panel.innerHTML = `
    <div class="header">
      <span class="title">
        <span class="title-icon">M</span>
        <span>MemeDrop<span class="subtitle">needs attention</span></span>
      </span>
      <div class="header-actions">
        <button class="close-btn" title="Close">&times;</button>
      </div>
    </div>
    <div class="empty"></div>
  `;

  const empty = panel.querySelector<HTMLElement>(".empty");
  if (empty) empty.textContent = message;
  panel.querySelector(".close-btn")!.addEventListener("click", dismissPanel);
  setupDrag(panel);
  shadowRoot.appendChild(panel);
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

export function updateSuggestionMedia(memeId: string, imageDataUrl: string) {
  const suggestion = currentSuggestions.find((item) => item.meme_id === memeId);
  if (!suggestion) return;
  suggestion.image_data_url = imageDataUrl;

  const card = Array.from(shadowRoot?.querySelectorAll<HTMLElement>(".meme-card") || [])
    .find((item) => item.dataset.memeId === memeId);
  const img = card?.querySelector<HTMLImageElement>("img");
  if (!img) return;

  if (suggestion.tailored_overlay?.enabled) {
    hydrateTailoredPreview(suggestion, img);
  } else {
    img.src = imageDataUrl;
  }
}

export function hidePanel() {
  if (panelHost) {
    panelHost.style.display = "none";
  }

  // Log dismissal if suggestions were showing
  if (currentSuggestions.length > 0) {
    for (const s of currentSuggestions) {
      if (usedSuggestionIds.has(s.meme_id)) continue;
      chrome.runtime.sendMessage({
        type: "LOG_USAGE",
        payload: {
          meme_id: s.meme_id,
          action: "dismissed",
          source: s.source,
          tweet_context: s.tweet_context || {},
        },
      });
    }
    currentSuggestions = [];
    usedSuggestionIds.clear();
    shownSuggestionIds.clear();
  }
}

function logSuggestionUsage(
  suggestion: Suggestion,
  action: "shown" | "clicked" | "used" | "dismissed"
) {
  if (action === "shown") {
    if (shownSuggestionIds.has(suggestion.meme_id)) return;
    shownSuggestionIds.add(suggestion.meme_id);
  }

  chrome.runtime.sendMessage({
    type: "LOG_USAGE",
    payload: {
      meme_id: suggestion.meme_id,
      action,
      source: suggestion.source,
      tweet_context: suggestion.tweet_context || {},
    },
  });
}

export function isPanelVisible(): boolean {
  return panelHost?.style.display !== "none" && panelHost !== null;
}
