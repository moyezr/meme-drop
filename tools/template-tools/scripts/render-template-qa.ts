import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MEME_TEMPLATE_MANIFEST } from "../../../shared/src/data/meme-template-manifest.js";
import generatedManifest from "../../../shared/src/data/meme-template-manifest.generated.json" with { type: "json" };
import type { MemeTemplate } from "../../../shared/src/types/template-manifest.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..", "..", "..");
const args = parseArgs(process.argv.slice(2));
const scope = String(args.scope || "verified");
const outputPath = path.resolve(
  rootDir,
  String(args.out || `.memedrop/template-qa-${scope}.html`)
);
const backendBaseUrl = process.env.MEMEDROP_QA_IMAGE_BASE_URL || "http://localhost:3001";
const benchmarkPath = path.join(rootDir, "tools", "template-tools", "evals", "suggestion-benchmark.json");

interface RenderTemplate extends MemeTemplate {
  qa_source?: "manual" | "generated";
  source_image?: string;
  qa_expected_hits?: number;
  qa_has_verified_duplicate?: boolean;
  qa_visual_warnings?: string[];
  qa_review_notes?: string[];
}

const generatedTemplates = generatedManifest.templates as MemeTemplate[];
const sourceImageByName = new Map<string, string>();
for (const template of generatedTemplates) {
  if (template.source_image) {
    sourceImageByName.set(normalizeName(template.template_id), template.source_image);
    sourceImageByName.set(normalizeName(template.name), template.source_image);
  }
}

const expectedCounts = await loadExpectedCounts();
const templates = selectTemplates(scope, expectedCounts);

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, buildHtml(templates), "utf8");

console.log(`Wrote template QA contact sheet to ${path.relative(rootDir, outputPath)}`);
console.log(`scope=${scope} templates=${templates.length}`);
console.log("Start the backend first so /memes/* image URLs resolve.");

async function loadExpectedCounts(): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  try {
    const raw = await fs.readFile(benchmarkPath, "utf8");
    const benchmark = JSON.parse(raw) as {
      cases?: Array<{ expected_memes?: string[] }>;
    };
    for (const testCase of benchmark.cases || []) {
      for (const name of testCase.expected_memes || []) {
        const normalized = normalizeName(name);
        counts.set(normalized, (counts.get(normalized) || 0) + 1);
      }
    }
  } catch (err) {
    console.warn("[MemeDrop] Could not load benchmark expected memes:", err);
  }
  return counts;
}

function selectTemplates(scope: string, expectedCounts: Map<string, number>): RenderTemplate[] {
  const requestedIds = String(args.template || "")
    .split(",")
    .map((item) => normalizeName(item))
    .filter(Boolean);
  const limit = Number(args.limit || 0);
  const verifiedIds = new Set(
    MEME_TEMPLATE_MANIFEST.templates.map((template) => normalizeName(template.template_id))
  );
  const allTemplates = [
    ...MEME_TEMPLATE_MANIFEST.templates.map((template) => ({ template, source: "manual" as const })),
    ...generatedTemplates.map((template) => ({ template, source: "generated" as const })),
  ]
    .filter(({ template }) => template.supports_overlay && template.quality !== "disabled")
    .map(({ template, source }): RenderTemplate => {
      const expectedHits = expectedHitsForTemplate(template, expectedCounts);
      const visualWarnings = visualWarningsForTemplate(template);
      const hasVerifiedDuplicate = verifiedIds.has(normalizeName(template.template_id));
      return {
        ...template,
        qa_source: source,
        source_image:
          template.source_image ||
          sourceImageByName.get(normalizeName(template.template_id)) ||
          sourceImageByName.get(normalizeName(template.name)) ||
          "",
        qa_expected_hits: expectedHits,
        qa_has_verified_duplicate: hasVerifiedDuplicate,
        qa_visual_warnings: visualWarnings,
        qa_review_notes: reviewNotesForTemplate(template, expectedHits, hasVerifiedDuplicate, visualWarnings),
      };
    });

  let selected = allTemplates;
  if (requestedIds.length > 0) {
    selected = selected.filter((template) =>
      [template.template_id, template.name, ...template.aliases]
        .map(normalizeName)
        .some((name) => requestedIds.includes(name))
    );
  } else if (scope === "verified") {
    selected = selected.filter(
      (template) => template.quality === "verified" && template.qa_source === "manual"
    );
  } else if (scope === "draft") {
    selected = selected.filter((template) => template.quality === "draft");
  } else if (scope === "queue") {
    selected = selected
      .filter(
        (template) =>
          template.quality === "draft" &&
          (args["include-duplicates"] || !template.qa_has_verified_duplicate) &&
          ((template.qa_expected_hits || 0) > 0 || (template.qa_visual_warnings || []).length > 0)
      )
      .sort((a, b) => priorityScore(b) - priorityScore(a) || a.template_id.localeCompare(b.template_id));
  } else if (scope === "expansion") {
    selected = selected
      .filter(
        (template) =>
          template.quality === "draft" &&
          !template.qa_has_verified_duplicate &&
          (template.qa_visual_warnings || []).length === 0
      )
      .sort((a, b) => a.template_id.localeCompare(b.template_id));
  } else if (scope !== "all") {
    throw new Error(`Unsupported scope "${scope}". Use verified, draft, queue, expansion, all, or --template id.`);
  }

  return limit > 0 ? selected.slice(0, limit) : selected;
}

function buildHtml(templates: RenderTemplate[]): string {
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
    h2 { margin: 0 0 10px; font-size: 14px; font-weight: 650; display: flex; gap: 8px; align-items: center; justify-content: space-between; }
    canvas { width: 100%; background: #050505; border-radius: 6px; display: block; }
    .missing { aspect-ratio: 4 / 3; display: grid; place-items: center; color: #fca5a5; background: #241515; border-radius: 6px; padding: 14px; text-align: center; }
    .meta { margin-top: 8px; color: #a1a1aa; font-size: 12px; }
    .badge { border-radius: 999px; padding: 2px 8px; font-size: 11px; background: #27272a; color: #e4e4e7; }
    .badge.draft { background: #422006; color: #fde68a; }
    .badge.verified { background: #052e16; color: #86efac; }
    .warnings, .notes { margin: 8px 0 0; padding-left: 18px; font-size: 12px; line-height: 1.4; }
    .warnings { color: #fca5a5; }
    .notes { color: #bae6fd; }
  </style>
</head>
<body>
  <header>
    <h1>MemeDrop Template QA</h1>
    <p>Scope: ${escapeHtml(scope)}. Red flags: clipped faces, unreadable text, cramped edges, tiny fonts. Promote drafts only after rendered QA looks clean.</p>
  </header>
  <main id="templates"></main>
  <script>
    const IMAGE_BASE_URL = ${JSON.stringify(backendBaseUrl)};
    const templates = ${JSON.stringify(templates)};
    const root = document.getElementById("templates");

    for (const template of templates) {
      const article = document.createElement("article");
      article.innerHTML = "<h2><span></span><span></span></h2>";
      article.querySelector("h2 span:first-child").textContent = template.name;
      const badge = article.querySelector("h2 span:last-child");
      badge.className = "badge " + template.quality;
      badge.textContent = template.quality;

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
      meta.textContent = template.template_id + " - " + template.regions.length + " regions - expected hits: " + (template.qa_expected_hits || 0);
      article.appendChild(meta);
      appendList(article, "warnings", template.qa_visual_warnings || []);
      appendList(article, "notes", template.qa_review_notes || []);
      root.appendChild(article);

      renderTemplate(template, canvas).catch((err) => {
        const missing = document.createElement("div");
        missing.className = "missing";
        missing.textContent = "Render failed: " + err.message;
        canvas.replaceWith(missing);
      });
    }

    function appendList(article, className, items) {
      if (!items.length) return;
      const list = document.createElement("ul");
      list.className = className;
      for (const item of items.slice(0, 5)) {
        const li = document.createElement("li");
        li.textContent = item;
        list.appendChild(li);
      }
      article.appendChild(list);
    }

    async function renderTemplate(template, canvas) {
      const img = new Image();
      img.src = imageUrlFor(template.source_image);
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

    function imageUrlFor(sourceImage) {
      const source = String(sourceImage || "");
      if (/^(https?:|data:|blob:|file:)/.test(source)) return source;
      const base = String(IMAGE_BASE_URL || "").replace(/\\/+$/, "");
      const path = source.startsWith("/") ? source : "/" + source;
      return base + path;
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

function expectedHitsForTemplate(template: MemeTemplate, expectedCounts: Map<string, number>): number {
  const names = [template.name, ...template.aliases, template.template_id].map(normalizeName);
  let hits = 0;
  for (const [expected, count] of expectedCounts) {
    if (names.some((name) => name.includes(expected) || expected.includes(name))) {
      hits += count;
    }
  }
  return hits;
}

function visualWarningsForTemplate(template: MemeTemplate): string[] {
  const warnings: string[] = [];

  for (const region of template.regions) {
    if (region.font.max_size > 72) {
      warnings.push(`${region.id}: font max_size=${region.font.max_size}`);
    }
    if (region.max_chars > 42 && region.width < 0.45) {
      warnings.push(`${region.id}: max_chars=${region.max_chars} may be high for width=${region.width}`);
    }
    const capacity = estimateRegionCapacity(region);
    if (capacity < region.max_chars * 0.75) {
      warnings.push(`${region.id}: capacity ${Math.floor(capacity)} < max_chars ${region.max_chars}`);
    }
  }

  for (const [exampleIndex, example] of template.caption_guidance.good_examples.entries()) {
    for (const [regionId, text] of Object.entries(example)) {
      const region = template.regions.find((item) => item.id === regionId);
      if (!region) continue;
      const fit = estimateTextFit(region, String(text));
      if (fit) warnings.push(`example ${exampleIndex + 1}/${regionId}: ${fit}`);
    }
  }

  return warnings;
}

function reviewNotesForTemplate(
  template: MemeTemplate,
  expectedHits: number,
  hasVerifiedDuplicate: boolean,
  visualWarnings: string[]
): string[] {
  const notes: string[] = [];
  if (hasVerifiedDuplicate && template.quality !== "verified") {
    notes.push("verified hand-authored template already exists; promote only if this layout is better");
  }
  if (expectedHits > 0) {
    notes.push(`appears in ${expectedHits} expected benchmark meme slot${expectedHits === 1 ? "" : "s"}`);
  }
  if (!hasVerifiedDuplicate && template.quality === "draft") {
    notes.push("novel draft; add a benchmark case for its joke shape before promotion");
  }
  if (visualWarnings.length === 0) {
    notes.push("mechanically clean; visual QA decides promotion");
  } else {
    notes.push("fix mechanical warnings before promotion");
  }
  if (template.quality === "draft") {
    notes.push("runtime-excluded unless MEMEDROP_USE_DRAFT_TEMPLATES=true");
  }
  return notes;
}

function priorityScore(template: RenderTemplate): number {
  const duplicatePenalty =
    template.qa_source === "generated" &&
    MEME_TEMPLATE_MANIFEST.templates.some(
      (item) => normalizeName(item.template_id) === normalizeName(template.template_id)
    )
      ? 12
      : 0;
  return (template.qa_expected_hits || 0) * 100 - (template.qa_visual_warnings || []).length * 8 - duplicatePenalty;
}

function estimateRegionCapacity(region: MemeTemplate["regions"][number]): number {
  const widthPx = region.width * 1000;
  const heightPx = region.height * 833;
  const padding = Math.max(4, Math.min(widthPx, heightPx) * 0.055);
  const safeWidth = Math.max(8, widthPx - padding * 2);
  const safeHeight = Math.max(8, heightPx - padding * 2);
  const lineCount = Math.max(1, Math.min(region.max_lines, Math.floor(safeHeight / (region.font.min_size * 1.08))));
  return lineCount * (safeWidth / (region.font.min_size * 0.62));
}

function estimateTextFit(region: MemeTemplate["regions"][number], rawText: string): string | null {
  const text = rawText.trim().toUpperCase();
  const words = text.split(/\s+/).filter(Boolean);
  const widthPx = region.width * 1000;
  const heightPx = region.height * 833;
  const padding = Math.max(4, Math.min(widthPx, heightPx) * 0.055);
  const safeWidth = Math.max(8, widthPx - padding * 2);
  const safeHeight = Math.max(8, heightPx - padding * 2);
  let fontSize = region.font.max_size;
  let lines = wrapApproxLines(words, safeWidth, fontSize, region.max_lines);

  while (
    fontSize - 0.5 >= region.font.min_size &&
    (lines.length * fontSize * 1.08 > safeHeight ||
      lines.some((line) => approximateImpactWidth(line, fontSize) > safeWidth))
  ) {
    fontSize -= 0.5;
    lines = wrapApproxLines(words, safeWidth, fontSize, region.max_lines);
  }

  const naturalLines = wrapApproxLines(words, safeWidth, fontSize, Number.POSITIVE_INFINITY);
  const warnings: string[] = [];
  if (naturalLines.length > region.max_lines) warnings.push("truncates");
  if (fontSize <= region.font.min_size + 0.5 && (text.length > 14 || words.length > 3)) {
    warnings.push(`falls to ${fontSize}px`);
  }
  return warnings.length ? warnings.join(", ") : null;
}

function wrapApproxLines(words: string[], maxWidth: number, fontSize: number, maxLines: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (approximateImpactWidth(test, fontSize) <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length <= maxLines ? lines : lines.slice(0, Math.max(1, maxLines));
}

function approximateImpactWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const char of text) {
    if (char === " ") units += 0.32;
    else if (/[ilI1|]/.test(char)) units += 0.32;
    else if (/[mwMW]/.test(char)) units += 0.92;
    else if (/[A-Z0-9]/.test(char)) units += 0.66;
    else units += 0.58;
  }
  return units * fontSize;
}

function parseArgs(rawArgs: string[]): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {};
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = rawArgs[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
