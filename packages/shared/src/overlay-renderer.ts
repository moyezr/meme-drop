import type { MemeTextFont, MemeTextOverlay, MemeTextRegion } from "./types/suggestion.js";

export const DEFAULT_MEME_TEXT_FONT = {
  family: "Impact",
  weight: 900,
  fillColor: "#FFFFFF",
  strokeColor: "#000000",
  strokeRatio: 0.12,
  lineHeightRatio: 1.08,
} as const;

export const DEFAULT_MEME_TEXT_PADDING_RATIO = 0.055;

export interface ResolvedMemeTextFont {
  family: "Impact" | "Anton" | "Inter";
  /** Anton only ships a 400 face, so it must never be synthetically weighted. */
  weight: 400 | 700 | 900;
  fillColor: string;
  strokeColor: string;
  strokeRatio: number;
  lineHeightRatio: number;
}

/**
 * The computed result of laying out one caption region. The renderer returns
 * this alongside drawing so authoring tools can apply the same visual rules
 * that the extension uses without duplicating the layout algorithm.
 */
export interface MemeTextRegionRenderDiagnostics {
  regionId: string;
  text: string;
  lines: string[];
  fontSize: number;
  lineHeight: number;
  truncated: boolean;
  overflowed: boolean;
  widthOverflow: boolean;
  heightOverflow: boolean;
  charLimitExceeded: boolean;
  safeBounds: { x: number; y: number; width: number; height: number };
}

export interface MemeTextOverlayRenderDiagnostics {
  regions: MemeTextRegionRenderDiagnostics[];
  hasOverflow: boolean;
  hasTruncation: boolean;
}

type RegionLayout = MemeTextRegionRenderDiagnostics & {
  textX: number;
  startY: number;
  strokeWidth: number;
  font: ResolvedMemeTextFont;
};

/** Draw all caption regions and return the exact layout diagnostics. */
export function drawMemeTextOverlay(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  overlay: Pick<MemeTextOverlay, "regions">
): MemeTextOverlayRenderDiagnostics {
  const regions = overlay.regions.map((region) =>
    drawMemeTextRegion(ctx, canvasWidth, canvasHeight, region)
  );
  return {
    regions,
    hasOverflow: regions.some((region) => region.overflowed),
    hasTruncation: regions.some((region) => region.truncated),
  };
}

/** Draw one caption region and return its computed layout diagnostics. */
export function drawMemeTextRegion(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  region: MemeTextRegion
): MemeTextRegionRenderDiagnostics {
  const layout = layoutMemeTextRegion(ctx, canvasWidth, canvasHeight, region);
  if (!layout.text) return layout;

  ctx.save();
  ctx.beginPath();
  ctx.rect(
    layout.safeBounds.x,
    layout.safeBounds.y,
    layout.safeBounds.width,
    layout.safeBounds.height
  );
  ctx.clip();
  ctx.textAlign = region.align || "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.font = memeCanvasFont(layout.fontSize, layout.font);
  ctx.fillStyle = layout.font.fillColor;
  ctx.strokeStyle = layout.font.strokeColor;
  ctx.lineWidth = layout.strokeWidth;

  for (let index = 0; index < layout.lines.length; index += 1) {
    const lineY = layout.startY + index * layout.lineHeight;
    if (layout.strokeWidth > 0) {
      ctx.strokeText(layout.lines[index], layout.textX, lineY);
    }
    ctx.fillText(layout.lines[index], layout.textX, lineY);
  }
  ctx.restore();

  return layout;
}

/** Calculate one caption region without painting it. */
export function measureMemeTextRegion(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  region: MemeTextRegion
): MemeTextRegionRenderDiagnostics {
  return layoutMemeTextRegion(ctx, canvasWidth, canvasHeight, region);
}

function layoutMemeTextRegion(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  region: MemeTextRegion
): RegionLayout {
  const x = region.x * canvasWidth;
  const y = region.y * canvasHeight;
  const width = region.width * canvasWidth;
  const height = region.height * canvasHeight;
  const rawText = region.text.trim();
  const font = resolveMemeTextFont(region.font);
  const maxChars = region.max_chars || 120;
  const charLimitExceeded = rawText.length > maxChars;
  const text = transformOverlayText(rawText.slice(0, maxChars), region.text_transform);
  const paddingRatio = clampNumber(
    region.padding_ratio,
    0,
    0.2,
    DEFAULT_MEME_TEXT_PADDING_RATIO
  );
  const padding =
    paddingRatio === 0 ? 0 : Math.max(4, Math.min(width, height) * paddingRatio);
  const safeBounds = {
    x: x + padding,
    y: y + padding,
    width: Math.max(8, width - padding * 2),
    height: Math.max(8, height - padding * 2),
  };

  if (!text) {
    return emptyLayout(region.id, text, charLimitExceeded, safeBounds);
  }

  const fontScale = region.font_scale ?? 1;
  const manifestMax = region.font?.max_size ?? 52;
  const manifestMin = region.font?.min_size ?? 12;
  const minFont = Math.max(10, manifestMin);
  const maxFont = estimateImpactFontSize(ctx, text, safeBounds.width, safeBounds.height, {
    minFont,
    maxFont: manifestMax,
    fontScale,
    font,
  });
  const maxLines = region.max_lines || 4;
  let fontSize = maxFont;
  let wrapped = wrapMemeTextLines(ctx, text, safeBounds.width, fontSize, maxLines, font);

  while (
    fontSize - 0.5 >= minFont &&
    (wrapped.lines.length * fontSize * font.lineHeightRatio > safeBounds.height ||
      wrapped.lines.some((line) => measureMemeText(ctx, line, fontSize, font) > safeBounds.width))
  ) {
    fontSize -= 0.5;
    wrapped = wrapMemeTextLines(ctx, text, safeBounds.width, fontSize, maxLines, font);
  }

  fontSize = Math.max(minFont, fontSize);
  wrapped = wrapMemeTextLines(ctx, text, safeBounds.width, fontSize, maxLines, font);
  const lineHeight = fontSize * font.lineHeightRatio;
  const widthOverflow = wrapped.lines.some(
    (line) => measureMemeText(ctx, line, fontSize, font) > safeBounds.width
  );
  const heightOverflow = wrapped.lines.length * lineHeight > safeBounds.height;
  const totalHeight = Math.min(lineHeight * wrapped.lines.length, safeBounds.height);
  const startY =
    region.valign === "top"
      ? safeBounds.y + lineHeight / 2
      : region.valign === "bottom"
        ? safeBounds.y + safeBounds.height - totalHeight + lineHeight / 2
        : safeBounds.y + safeBounds.height / 2 - totalHeight / 2 + lineHeight / 2;
  const textX =
    region.align === "left"
      ? safeBounds.x
      : region.align === "right"
        ? safeBounds.x + safeBounds.width
        : safeBounds.x + safeBounds.width / 2;

  return {
    regionId: region.id,
    text,
    lines: wrapped.lines,
    fontSize,
    lineHeight,
    truncated: charLimitExceeded || wrapped.truncated,
    overflowed: widthOverflow || heightOverflow,
    widthOverflow,
    heightOverflow,
    charLimitExceeded,
    safeBounds,
    textX,
    startY,
    strokeWidth: font.strokeRatio === 0 ? 0 : Math.max(2, fontSize * font.strokeRatio),
    font,
  };
}

function emptyLayout(
  regionId: string,
  text: string,
  charLimitExceeded: boolean,
  safeBounds: RegionLayout["safeBounds"]
): RegionLayout {
  return {
    regionId,
    text,
    lines: [],
    fontSize: 0,
    lineHeight: 0,
    truncated: charLimitExceeded,
    overflowed: false,
    widthOverflow: false,
    heightOverflow: false,
    charLimitExceeded,
    safeBounds,
    textX: safeBounds.x + safeBounds.width / 2,
    startY: safeBounds.y + safeBounds.height / 2,
    strokeWidth: 0,
    font: resolveMemeTextFont(),
  };
}

function wrapMemeTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  fontSize: number,
  maxLines: number,
  font: ResolvedMemeTextFont
): { lines: string[]; truncated: boolean } {
  ctx.font = memeCanvasFont(fontSize, font);
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
  if (lines.length <= maxLines) return { lines, truncated: false };

  const visible = lines.slice(0, Math.max(1, maxLines));
  let last = visible[visible.length - 1];
  while (last.length > 1 && ctx.measureText(`${last}...`).width > maxWidth) {
    last = last.slice(0, -1).trim();
  }
  visible[visible.length - 1] = last ? `${last}...` : "...";
  return { lines: visible, truncated: true };
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
  options: {
    minFont: number;
    maxFont: number;
    fontScale: number;
    font: ResolvedMemeTextFont;
  }
): number {
  const words = text.split(/\s+/).filter(Boolean);
  const longestWordLength = words.reduce((max, word) => Math.max(max, word.length), 1);
  const targetLineCount = Math.max(1, Math.min(4, Math.ceil(text.length / 18)));
  const roughByLength = width / Math.max(longestWordLength * 0.72, text.length * 0.24);
  const roughByHeight = height / (targetLineCount * options.font.lineHeightRatio);
  let size = Math.min(options.maxFont, Math.max(options.minFont, roughByLength, roughByHeight));
  size *= options.fontScale;
  size = Math.min(options.maxFont, Math.max(options.minFont, size));

  ctx.font = memeCanvasFont(size, options.font);
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

function measureMemeText(
  ctx: CanvasRenderingContext2D,
  text: string,
  fontSize: number,
  font: ResolvedMemeTextFont
): number {
  ctx.font = memeCanvasFont(fontSize, font);
  return ctx.measureText(text).width;
}

/** Resolve untrusted persisted annotations to the narrow rendering contract. */
export function resolveMemeTextFont(font?: MemeTextFont): ResolvedMemeTextFont {
  const family = isFontFamily(font?.family) ? font.family : DEFAULT_MEME_TEXT_FONT.family;
  const requestedWeight = isFontWeight(font?.weight) ? font.weight : DEFAULT_MEME_TEXT_FONT.weight;

  return {
    family,
    weight: family === "Anton" ? 400 : requestedWeight,
    fillColor: normalizeColor(font?.fill_color, DEFAULT_MEME_TEXT_FONT.fillColor),
    strokeColor: normalizeColor(font?.stroke_color, DEFAULT_MEME_TEXT_FONT.strokeColor),
    strokeRatio: clampNumber(font?.stroke_ratio, 0, 0.25, DEFAULT_MEME_TEXT_FONT.strokeRatio),
    lineHeightRatio: clampNumber(
      font?.line_height_ratio,
      0.8,
      1.5,
      DEFAULT_MEME_TEXT_FONT.lineHeightRatio
    ),
  };
}

/**
 * Return the exact canvas font declaration used for both measuring and
 * drawing. Impact intentionally keeps its original declaration for backward
 * compatible rendering; Anton is only distributed at weight 400.
 */
export function memeCanvasFont(fontSize: number, font: ResolvedMemeTextFont): string {
  const size = Math.floor(fontSize);
  if (font.family === "Impact") {
    return `${size}px Impact, Haettenschweiler, 'Arial Black', sans-serif`;
  }
  if (font.family === "Anton") {
    return `400 ${size}px Anton, Impact, Haettenschweiler, 'Arial Black', sans-serif`;
  }
  return `${font.weight} ${size}px Inter, Arial, sans-serif`;
}

function isFontFamily(value: unknown): value is ResolvedMemeTextFont["family"] {
  return value === "Impact" || value === "Anton" || value === "Inter";
}

function isFontWeight(value: unknown): value is ResolvedMemeTextFont["weight"] {
  return value === 400 || value === 700 || value === 900;
}

function normalizeColor(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : fallback;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}
