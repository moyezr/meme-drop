import type { MemeTextOverlay, MemeTextRegion } from "./types/suggestion.js";

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
  ctx.font = impactFont(layout.fontSize);
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#000";
  ctx.lineWidth = layout.strokeWidth;

  for (let index = 0; index < layout.lines.length; index += 1) {
    const lineY = layout.startY + index * layout.lineHeight;
    ctx.strokeText(layout.lines[index], layout.textX, lineY);
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
  const maxChars = region.max_chars || 120;
  const charLimitExceeded = rawText.length > maxChars;
  const text = transformOverlayText(rawText.slice(0, maxChars), region.text_transform);
  const padding = Math.max(4, Math.min(width, height) * 0.055);
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
  const manifestMax = region.font?.max_size || 52;
  const manifestMin = region.font?.min_size || 12;
  const minFont = Math.max(10, manifestMin);
  const maxFont = estimateImpactFontSize(ctx, text, safeBounds.width, safeBounds.height, {
    minFont,
    maxFont: manifestMax,
    fontScale,
  });
  const maxLines = region.max_lines || 4;
  let fontSize = maxFont;
  let wrapped = wrapImpactLines(ctx, text, safeBounds.width, fontSize, maxLines);

  while (
    fontSize - 0.5 >= minFont &&
    (wrapped.lines.length * fontSize * 1.08 > safeBounds.height ||
      wrapped.lines.some((line) => measureImpactText(ctx, line, fontSize) > safeBounds.width))
  ) {
    fontSize -= 0.5;
    wrapped = wrapImpactLines(ctx, text, safeBounds.width, fontSize, maxLines);
  }

  fontSize = Math.max(minFont, fontSize);
  wrapped = wrapImpactLines(ctx, text, safeBounds.width, fontSize, maxLines);
  const lineHeight = fontSize * 1.08;
  const widthOverflow = wrapped.lines.some(
    (line) => measureImpactText(ctx, line, fontSize) > safeBounds.width
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
    strokeWidth: Math.max(2, fontSize * (region.font?.stroke_ratio || 0.12)),
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
  };
}

function wrapImpactLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  fontSize: number,
  maxLines: number
): { lines: string[]; truncated: boolean } {
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
