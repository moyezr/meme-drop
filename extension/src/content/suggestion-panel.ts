/**
 * Suggestion panel — Shadow DOM component injected into X.com
 * Shows meme suggestions in a horizontal strip when a reply composer is detected.
 */

import { SELECTORS } from "./selectors";

const API_BASE_URL = "http://localhost:3001";
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
  .header-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .refresh-btn {
    background: none;
    border: none;
    color: rgba(255,255,255,0.62);
    cursor: pointer;
    font-size: 14px;
    padding: 3px 6px;
    border-radius: 4px;
    line-height: 1;
  }
  .refresh-btn:hover { color: #fff; background: rgba(255,255,255,0.1); }
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
  .source-badge {
    position: absolute;
    top: 5px;
    left: 5px;
    padding: 2px 4px;
    border-radius: 4px;
    background: rgba(0,0,0,0.68);
    color: rgba(255,255,255,0.86);
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 0;
    text-transform: uppercase;
  }
  .tailored-badge {
    position: absolute;
    top: 5px;
    right: 5px;
    padding: 2px 4px;
    border-radius: 4px;
    background: rgba(29,155,240,0.88);
    color: #fff;
    font-size: 8px;
    font-weight: 800;
    letter-spacing: 0;
    text-transform: uppercase;
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
      <div class="header-actions">
        <button class="refresh-btn" title="Refresh suggestions">↻</button>
        <button class="close-btn" title="Close">&times;</button>
      </div>
    </div>
    <div class="loading">Finding the perfect meme...</div>
  `;

  panel.querySelector(".close-btn")!.addEventListener("click", hidePanel);
  panel.querySelector(".refresh-btn")!.addEventListener("click", requestRefresh);
  setupDrag(panel);
  shadowRoot.appendChild(panel);
}

function renderSuggestions(suggestions: Suggestion[]) {
  if (!shadowRoot) return;
  currentSuggestions = suggestions;
  usedSuggestionIds.clear();

  const existing = shadowRoot.querySelector(".panel");
  if (existing) existing.remove();

  const panel = document.createElement("div");
  panel.className = "panel";

  if (suggestions.length === 0) {
    panel.innerHTML = `
      <div class="header">
        <span class="title"><span class="title-icon">&#x1f4a7;</span> MemeDrop</span>
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
      <span class="title"><span class="title-icon">&#x1f4a7;</span> MemeDrop</span>
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

      const name = document.createElement("div");
      name.className = "meme-name";
      name.textContent = (s.name || "").trim() || "";

      card.appendChild(img);
      card.appendChild(badge);
      if (s.tailored_overlay?.enabled) card.appendChild(tailoredBadge);
      card.appendChild(reason);
      if (name.textContent) card.appendChild(name);

      hydrateTailoredPreview(s, img);

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
            imageDataUrl: s.tailored_image_data_url ?? s.image_data_url ?? undefined,
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

async function insertMemeIntoComposer(suggestion: Suggestion) {
  if (suggestion.tailored_overlay?.enabled && !suggestion.tailored_image_data_url) {
    suggestion.tailored_image_data_url = await renderTailoredMemeDataUrl(suggestion).catch(
      () => null
    );
  }

  await insertMemeByUrl({
    imageUrl: suggestion.image_url,
    imageDataUrl: suggestion.tailored_image_data_url ?? suggestion.image_data_url ?? null,
    memeId: suggestion.meme_id,
    source: suggestion.source,
  });
}

type InsertMemeInput = {
  imageUrl: string;
  imageDataUrl?: string | null;
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

  const raw = await resolveMemeBlob(suggestion.image_url, suggestion.image_data_url);
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
  }
}

export function isPanelVisible(): boolean {
  return panelHost?.style.display !== "none" && panelHost !== null;
}
