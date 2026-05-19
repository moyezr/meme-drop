import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MEME_TEMPLATE_MANIFEST } from "../../shared/src/data/meme-template-manifest.js";
import generatedManifest from "../../shared/src/data/meme-template-manifest.generated.json" with { type: "json" };
import type { MemeTemplate } from "../../shared/src/types/template-manifest.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..", "..");
const outputPath = path.join(rootDir, ".memedrop", "template-qa.html");
const backendBaseUrl = process.env.MEMEDROP_QA_IMAGE_BASE_URL || "http://localhost:3001";

const generatedTemplates = generatedManifest.templates as MemeTemplate[];
const sourceImageByName = new Map<string, string>();
for (const template of generatedTemplates) {
  if (template.source_image) {
    sourceImageByName.set(normalizeName(template.template_id), template.source_image);
    sourceImageByName.set(normalizeName(template.name), template.source_image);
  }
}

const templates = MEME_TEMPLATE_MANIFEST.templates
  .filter((template) => template.supports_overlay && template.quality === "verified")
  .map((template) => ({
    ...template,
    source_image:
      template.source_image ||
      sourceImageByName.get(normalizeName(template.template_id)) ||
      sourceImageByName.get(normalizeName(template.name)) ||
      "",
  }));

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, buildHtml(templates), "utf8");

console.log(`Wrote template QA contact sheet to ${path.relative(rootDir, outputPath)}`);
console.log("Start the backend first so /memes/* image URLs resolve.");

function buildHtml(templates: MemeTemplate[]): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MemeDrop Template QA</title>
  <style>
    body { margin: 0; background: #101114; color: #f4f4f5; font: 14px system-ui, sans-serif; }
    header { position: sticky; top: 0; z-index: 1; background: #101114; border-bottom: 1px solid #2b2d33; padding: 16px 20px; }
    h1 { margin: 0 0 4px; font-size: 18px; }
    p { margin: 0; color: #a1a1aa; }
    main { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 18px; padding: 18px; }
    article { background: #181a20; border: 1px solid #2b2d33; border-radius: 8px; padding: 12px; }
    h2 { margin: 0 0 10px; font-size: 14px; font-weight: 650; }
    canvas { width: 100%; background: #050505; border-radius: 6px; display: block; }
    .missing { aspect-ratio: 4 / 3; display: grid; place-items: center; color: #fca5a5; background: #241515; border-radius: 6px; padding: 14px; text-align: center; }
    .meta { margin-top: 8px; color: #a1a1aa; font-size: 12px; }
  </style>
</head>
<body>
  <header>
    <h1>MemeDrop Template QA</h1>
    <p>Verified templates rendered with example text. Red flags: clipped faces, unreadable text, cramped edges, tiny fonts.</p>
  </header>
  <main id="templates"></main>
  <script>
    const IMAGE_BASE_URL = ${JSON.stringify(backendBaseUrl)};
    const templates = ${JSON.stringify(templates)};
    const root = document.getElementById("templates");

    for (const template of templates) {
      const article = document.createElement("article");
      article.innerHTML = "<h2></h2>";
      article.querySelector("h2").textContent = template.name;

      if (!template.source_image) {
        const missing = document.createElement("div");
        missing.className = "missing";
        missing.textContent = "No source_image found. Add one before approving this template.";
        article.appendChild(missing);
        root.appendChild(article);
        continue;
      }

      const canvas = document.createElement("canvas");
      article.appendChild(canvas);
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = template.template_id + " - " + template.regions.length + " regions";
      article.appendChild(meta);
      root.appendChild(article);

      renderTemplate(template, canvas).catch((err) => {
        const missing = document.createElement("div");
        missing.className = "missing";
        missing.textContent = "Render failed: " + err.message;
        canvas.replaceWith(missing);
      });
    }

    async function renderTemplate(template, canvas) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = IMAGE_BASE_URL + template.source_image;
      await img.decode();
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const example = Object.assign({}, ...template.caption_guidance.good_examples);
      for (const region of template.regions) {
        drawImpactText(ctx, canvas.width, canvas.height, {
          ...region,
          text: example[region.id] || region.role,
          text_transform: template.template_id === "mocking-spongebob" ? "mocking" : "uppercase",
        });
        drawRegionBox(ctx, canvas.width, canvas.height, region);
      }
    }

    function drawRegionBox(ctx, canvasWidth, canvasHeight, region) {
      ctx.save();
      ctx.strokeStyle = "rgba(56, 189, 248, 0.78)";
      ctx.lineWidth = Math.max(2, canvasWidth * 0.002);
      ctx.setLineDash([8, 6]);
      ctx.strokeRect(region.x * canvasWidth, region.y * canvasHeight, region.width * canvasWidth, region.height * canvasHeight);
      ctx.restore();
    }

    ${rendererSource()}
  </script>
</body>
</html>
`;
}

function rendererSource(): string {
  return String.raw`
function drawImpactText(ctx, canvasWidth, canvasHeight, region) {
  const x = region.x * canvasWidth;
  const y = region.y * canvasHeight;
  const width = region.width * canvasWidth;
  const height = region.height * canvasHeight;
  const text = transformOverlayText(String(region.text || "").trim().slice(0, region.max_chars || 120), region.text_transform);
  if (!text) return;
  const fontScale = region.font_scale || 1;
  const manifestMax = (region.font && region.font.max_size) || 52;
  const manifestMin = (region.font && region.font.min_size) || 12;
  const padding = Math.max(4, Math.min(width, height) * 0.055);
  const safeX = x + padding;
  const safeY = y + padding;
  const safeWidth = Math.max(8, width - padding * 2);
  const safeHeight = Math.max(8, height - padding * 2);
  const minFont = Math.max(10, manifestMin);
  const maxFont = estimateImpactFontSize(ctx, text, safeWidth, safeHeight, { minFont, maxFont: manifestMax, fontScale });
  const maxLines = region.max_lines || 4;
  let fontSize = maxFont;
  let lines = wrapImpactLines(ctx, text, safeWidth, fontSize, maxLines);
  while (fontSize - 0.5 >= minFont && (lines.length * fontSize * 1.08 > safeHeight || lines.some((line) => measureImpactText(ctx, line, fontSize) > safeWidth))) {
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
  const startY = region.valign === "top" ? safeY + lineHeight / 2 : region.valign === "bottom" ? safeY + safeHeight - totalHeight + lineHeight / 2 : safeY + safeHeight / 2 - totalHeight / 2 + lineHeight / 2;
  const textX = region.align === "left" ? safeX : region.align === "right" ? safeX + safeWidth : safeX + safeWidth / 2;
  ctx.font = impactFont(fontSize);
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#000";
  ctx.lineWidth = Math.max(2, fontSize * ((region.font && region.font.stroke_ratio) || 0.12));
  for (let i = 0; i < lines.length; i++) {
    const lineY = startY + i * lineHeight;
    ctx.strokeText(lines[i], textX, lineY);
    ctx.fillText(lines[i], textX, lineY);
  }
  ctx.restore();
}
function wrapImpactLines(ctx, text, maxWidth, fontSize, maxLines) {
  ctx.font = impactFont(fontSize);
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const pieces = breakLongWord(ctx, word, maxWidth);
    for (const piece of pieces) {
      const test = current ? current + " " + piece : piece;
      if (ctx.measureText(test).width <= maxWidth) current = test;
      else {
        if (current) lines.push(current);
        current = piece;
      }
    }
  }
  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;
  const visible = lines.slice(0, Math.max(1, maxLines));
  let last = visible[visible.length - 1];
  while (last.length > 1 && ctx.measureText(last + "...").width > maxWidth) last = last.slice(0, -1).trim();
  visible[visible.length - 1] = last ? last + "..." : "...";
  return visible;
}
function breakLongWord(ctx, word, maxWidth) {
  if (ctx.measureText(word).width <= maxWidth) return [word];
  const pieces = [];
  let current = "";
  for (const char of word) {
    const test = current + char;
    if (!current || ctx.measureText(test).width <= maxWidth) current = test;
    else {
      pieces.push(current);
      current = char;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}
function estimateImpactFontSize(ctx, text, width, height, options) {
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
function transformOverlayText(text, transform) {
  if (transform === "none") return text;
  if (transform === "mocking") return toMockingCase(text);
  return text.toUpperCase();
}
function toMockingCase(text) {
  let upper = false;
  return text.toLowerCase().split("").map((char) => {
    if (!/[a-z]/.test(char)) return char;
    upper = !upper;
    return upper ? char.toUpperCase() : char;
  }).join("");
}
function measureImpactText(ctx, text, fontSize) {
  ctx.font = impactFont(fontSize);
  return ctx.measureText(text).width;
}
function impactFont(fontSize) {
  return Math.floor(fontSize) + "px Impact, Haettenschweiler, 'Arial Black', sans-serif";
}`;
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
