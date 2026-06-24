import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import generatedManifest from "../../shared/src/data/meme-template-manifest.generated.json" with { type: "json" };
import { MEME_TEMPLATE_MANIFEST } from "../../shared/src/data/meme-template-manifest.js";
import type { MemeTemplate } from "../../shared/src/types/template-manifest.js";

interface ReviewTemplate extends MemeTemplate {
  qa_visual_warnings: string[];
  qa_has_verified_duplicate: boolean;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..", "..");
const args = parseArgs(process.argv.slice(2));
const outPath = path.resolve(rootDir, String(args.out || ".memedrop/taste-review.html"));
const scope = String(args.scope || "expansion");
const limit = Number(args.limit || 0);
const backendBaseUrl = process.env.MEMEDROP_QA_IMAGE_BASE_URL || "http://localhost:3001";

const templates = selectTemplates();

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, buildHtml(templates), "utf8");

console.log(`[MemeDrop] wrote taste review page to ${path.relative(rootDir, outPath)}`);
console.log(`scope=${scope} templates=${templates.length}`);
console.log("Start the backend first so /memes/* image URLs resolve.");

function selectTemplates(): ReviewTemplate[] {
  const verifiedIds = new Set(
    MEME_TEMPLATE_MANIFEST.templates.map((template) => template.template_id)
  );
  const requestedIds = String(args.template || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const requested = new Set(requestedIds);

  let selected = (generatedManifest.templates as MemeTemplate[])
    .filter((template) => template.supports_overlay && template.quality === "draft")
    .map((template): ReviewTemplate => ({
      ...template,
      qa_visual_warnings: visualWarningsForTemplate(template),
      qa_has_verified_duplicate: verifiedIds.has(template.template_id),
    }));

  if (requested.size > 0) {
    selected = selected.filter((template) => requested.has(template.template_id) || requested.has(template.name));
  } else if (scope === "expansion") {
    selected = selected.filter(
      (template) => !template.qa_has_verified_duplicate && template.qa_visual_warnings.length === 0
    );
  } else if (scope === "needs-work") {
    selected = selected.filter((template) => template.qa_visual_warnings.length > 0);
  } else if (scope === "all") {
    selected = selected.filter((template) => args["include-duplicates"] || !template.qa_has_verified_duplicate);
  } else {
    fail(`Unsupported scope "${scope}". Use expansion, needs-work, all, or --template id.`);
  }

  selected.sort((a, b) => a.template_id.localeCompare(b.template_id));
  return limit > 0 ? selected.slice(0, limit) : selected;
}

function buildHtml(templatesForReview: ReviewTemplate[]): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MemeDrop Taste Review</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #101114;
      --panel: #181a20;
      --panel-2: #20232b;
      --line: #30333d;
      --text: #f4f4f5;
      --muted: #a1a1aa;
      --good: #86efac;
      --warn: #fde68a;
      --bad: #fca5a5;
      --accent: #7dd3fc;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font: 14px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    header { position: sticky; top: 0; z-index: 10; padding: 18px 22px; border-bottom: 1px solid var(--line); background: rgba(16, 17, 20, 0.96); backdrop-filter: blur(14px); }
    h1 { margin: 0 0 6px; font-size: 20px; letter-spacing: -0.02em; }
    p { margin: 0; color: var(--muted); line-height: 1.45; }
    main { display: grid; grid-template-columns: minmax(360px, 560px) minmax(360px, 1fr); gap: 18px; padding: 18px; align-items: start; }
    aside, article { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; }
    aside { position: sticky; top: 92px; padding: 16px; }
    article { overflow: hidden; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
    button, select, input, textarea {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel-2);
      color: var(--text);
      font: inherit;
    }
    button { cursor: pointer; padding: 9px 12px; font-weight: 650; }
    button.primary { background: #0c4a6e; border-color: #0284c7; }
    button.good { background: #064e3b; border-color: #059669; }
    button.warn { background: #713f12; border-color: #ca8a04; }
    button.bad { background: #7f1d1d; border-color: #dc2626; }
    .grid { display: grid; gap: 18px; }
    .card-header { display: flex; justify-content: space-between; gap: 12px; padding: 14px 16px; border-bottom: 1px solid var(--line); }
    .title { min-width: 0; }
    h2 { margin: 0 0 4px; font-size: 16px; letter-spacing: -0.01em; }
    .meta, .hint, .small { color: var(--muted); font-size: 12px; line-height: 1.4; }
    .badge { align-self: flex-start; white-space: nowrap; border-radius: 999px; padding: 4px 9px; background: #27272a; color: #e4e4e7; font-size: 12px; }
    .badge.clean { background: #052e16; color: var(--good); }
    .badge.warn { background: #422006; color: var(--warn); }
    .preview { padding: 14px 16px; background: #090a0d; }
    canvas { display: block; max-width: 100%; width: 100%; height: auto; border-radius: 8px; background: #050505; }
    .form { display: grid; gap: 12px; padding: 16px; }
    .row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    label { display: grid; gap: 5px; color: #d4d4d8; font-size: 12px; font-weight: 650; }
    input, textarea, select { width: 100%; padding: 9px; }
    textarea { min-height: 72px; resize: vertical; }
    .checks { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .checks label { display: flex; align-items: center; gap: 8px; padding: 8px; background: var(--panel-2); border-radius: 8px; font-weight: 500; }
    .checks input { width: auto; }
    ul { margin: 8px 0 0; padding-left: 18px; color: var(--bad); font-size: 12px; }
    pre { max-height: 360px; overflow: auto; padding: 12px; border-radius: 8px; background: #090a0d; border: 1px solid var(--line); color: #d4d4d8; white-space: pre-wrap; }
    .decision { display: flex; flex-wrap: wrap; gap: 8px; }
    @media (max-width: 1000px) {
      main { grid-template-columns: 1fr; }
      aside { position: static; }
    }
  </style>
</head>
<body>
  <header>
    <h1>MemeDrop Taste Review</h1>
    <p>Approve only memes that are readable, culturally recognizable, and add a joke shape the product needs. This page stores drafts in localStorage and exports review decisions plus benchmark-case drafts.</p>
  </header>
  <main>
    <aside>
      <h2>Reviewer Job</h2>
      <p>For each meme, decide whether it has product taste. A good approval explains <strong>when it is funny</strong>, <strong>when it is wrong</strong>, and includes a real tweet-shaped benchmark example.</p>
      <div class="toolbar">
        <button class="primary" id="export-decisions">Export decisions JSON</button>
        <button id="export-benchmark">Export benchmark JSON</button>
        <button id="copy-summary">Copy summary</button>
        <button class="bad" id="clear-local">Clear local draft</button>
      </div>
      <p class="hint" style="margin-top:12px">Save exported decisions as <code>.memedrop/template-review-decisions.json</code>. Save benchmark cases as <code>.memedrop/suggestion-benchmark-stubs.edited.json</code>, then import with the benchmark importer.</p>
      <pre id="summary"></pre>
    </aside>
    <section class="grid" id="cards"></section>
  </main>
  <script>
    const IMAGE_BASE_URL = ${JSON.stringify(backendBaseUrl)};
    const templates = ${JSON.stringify(templatesForReview)};
    const storageKey = "memedrop:taste-review:v1:" + templates.map((template) => template.template_id).join(",");
    const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
    const cards = document.getElementById("cards");
    const summary = document.getElementById("summary");

    for (const template of templates) {
      cards.appendChild(createCard(template));
    }
    updateSummary();

    document.getElementById("export-decisions").addEventListener("click", () => downloadJson("template-review-decisions.json", buildDecisionFile()));
    document.getElementById("export-benchmark").addEventListener("click", () => downloadJson("suggestion-benchmark-stubs.edited.json", buildBenchmarkFile()));
    document.getElementById("copy-summary").addEventListener("click", async () => {
      await navigator.clipboard.writeText(summary.textContent || "");
    });
    document.getElementById("clear-local").addEventListener("click", () => {
      if (!confirm("Clear local review draft for this page?")) return;
      localStorage.removeItem(storageKey);
      location.reload();
    });

    function createCard(template) {
      const state = saved[template.template_id] || defaultState(template);
      const article = document.createElement("article");
      article.dataset.templateId = template.template_id;
      article.innerHTML = \`
        <div class="card-header">
          <div class="title">
            <h2></h2>
            <div class="meta"></div>
          </div>
          <span class="badge"></span>
        </div>
        <div class="preview"></div>
        <div class="form">
          <div class="decision">
            <button class="good" data-status="approved">Approve</button>
            <button class="warn" data-status="needs_work">Needs work</button>
            <button class="bad" data-status="rejected">Reject</button>
          </div>
          <div class="row">
            <label>Taste score 1-5
              <select data-field="taste_score">
                <option value="1">1 - stale/confusing</option>
                <option value="2">2 - weak</option>
                <option value="3">3 - useful sometimes</option>
                <option value="4">4 - strong</option>
                <option value="5">5 - must-have</option>
              </select>
            </label>
            <label>Benchmark case id
              <input data-field="benchmark_case_id" />
            </label>
          </div>
          <div class="checks">
            <label><input type="checkbox" data-field="recognizable" /> recognizable</label>
            <label><input type="checkbox" data-field="readable" /> readable text</label>
            <label><input type="checkbox" data-field="distinct_joke" /> distinct joke shape</label>
            <label><input type="checkbox" data-field="not_duplicate" /> not just a duplicate</label>
          </div>
          <label>When this meme is funny
            <textarea data-field="best_fit_when" placeholder="Example: when a tweet needs a dramatic verdict, over-the-top praise, or cinematic approval."></textarea>
          </label>
          <label>When this meme is wrong
            <textarea data-field="bad_fit_when" placeholder="Example: not for nuanced disagreement or low-energy factual replies."></textarea>
          </label>
          <label>Benchmark tweet
            <textarea data-field="benchmark_tweet" placeholder="Write a realistic tweet/reply context where this meme should be a good suggestion."></textarea>
          </label>
          <div class="row">
            <label>Expected meme families, comma-separated
              <input data-field="expected_memes" />
            </label>
            <label>Rejected meme families, comma-separated
              <input data-field="rejected_memes" />
            </label>
          </div>
          <label>Reviewer notes / issues
            <textarea data-field="notes"></textarea>
          </label>
        </div>
      \`;
      article.querySelector("h2").textContent = template.name;
      article.querySelector(".meta").textContent = template.template_id + " - " + template.regions.length + " regions";
      const badge = article.querySelector(".badge");
      badge.textContent = template.qa_visual_warnings.length ? "warnings" : "clean draft";
      badge.classList.add(template.qa_visual_warnings.length ? "warn" : "clean");
      if (template.qa_visual_warnings.length) {
        const list = document.createElement("ul");
        for (const warning of template.qa_visual_warnings) {
          const item = document.createElement("li");
          item.textContent = warning;
          list.appendChild(item);
        }
        article.querySelector(".preview").appendChild(list);
      }

      const canvas = document.createElement("canvas");
      article.querySelector(".preview").prepend(canvas);
      renderTemplate(template, canvas).catch((error) => {
        const fallback = document.createElement("p");
        fallback.className = "hint";
        fallback.textContent = "Render failed: " + error.message;
        canvas.replaceWith(fallback);
      });

      hydrateForm(article, state);
      article.addEventListener("input", () => persist(article));
      article.addEventListener("click", (event) => {
        const status = event.target && event.target.dataset ? event.target.dataset.status : "";
        if (!status) return;
        setField(article, "status", status);
        persist(article);
      });
      return article;
    }

    function defaultState(template) {
      return {
        template_id: template.template_id,
        status: "needs_work",
        taste_score: "3",
        benchmark_case_id: template.template_id + "-fit",
        recognizable: false,
        readable: false,
        distinct_joke: false,
        not_duplicate: !template.qa_has_verified_duplicate,
        best_fit_when: "",
        bad_fit_when: "",
        benchmark_tweet: "",
        expected_memes: template.name,
        rejected_memes: "This Is Fine",
        notes: template.qa_has_verified_duplicate ? "Duplicate of an existing verified template." : "",
      };
    }

    function hydrateForm(article, state) {
      setField(article, "status", state.status);
      for (const [field, value] of Object.entries(state)) {
        const input = article.querySelector("[data-field='" + field + "']");
        if (!input) continue;
        if (input.type === "checkbox") input.checked = Boolean(value);
        else input.value = Array.isArray(value) ? value.join(", ") : String(value || "");
      }
    }

    function persist(article) {
      const templateId = article.dataset.templateId;
      saved[templateId] = readForm(article);
      localStorage.setItem(storageKey, JSON.stringify(saved));
      updateSummary();
    }

    function readForm(article) {
      const state = { template_id: article.dataset.templateId, status: article.dataset.status || "needs_work" };
      for (const input of article.querySelectorAll("[data-field]")) {
        state[input.dataset.field] = input.type === "checkbox" ? input.checked : input.value;
      }
      return state;
    }

    function setField(article, field, value) {
      if (field === "status") {
        article.dataset.status = value;
        for (const button of article.querySelectorAll("[data-status]")) {
          button.style.outline = button.dataset.status === value ? "2px solid var(--accent)" : "";
        }
      }
      const input = article.querySelector("[data-field='" + field + "']");
      if (!input) return;
      if (input.type === "checkbox") input.checked = Boolean(value);
      else input.value = String(value || "");
    }

    function currentStates() {
      return templates.map((template) => {
        const article = document.querySelector("[data-template-id='" + template.template_id + "']");
        return article ? readForm(article) : saved[template.template_id] || defaultState(template);
      });
    }

    function buildDecisionFile() {
      return {
        version: 1,
        reviewed_at: new Date().toISOString(),
        reviewer: "meme-taste-review",
        decisions: currentStates().map((state) => ({
          template_id: state.template_id,
          status: state.status,
          benchmark_case_id: state.benchmark_case_id || undefined,
          notes: [
            "Taste score: " + state.taste_score + "/5.",
            state.best_fit_when ? "Best fit: " + state.best_fit_when : "",
            state.bad_fit_when ? "Bad fit: " + state.bad_fit_when : "",
            state.notes || "",
          ].filter(Boolean).join(" "),
          issues: state.status === "approved" ? undefined : [state.notes || "Reviewer did not approve this template."],
        })),
      };
    }

    function buildBenchmarkFile() {
      const approved = currentStates().filter((state) => state.status === "approved");
      return {
        version: 1,
        source: "taste-review",
        pending_template_names: approved.map((state) => templateName(state.template_id)),
        cases: approved.map((state) => ({
          id: state.benchmark_case_id,
          category: "human-taste-review",
          tweet: state.benchmark_tweet,
          expected_memes: splitList(state.expected_memes),
          rejected_memes: splitList(state.rejected_memes),
          keywords: keywordsFrom(state),
          notes: state.best_fit_when,
          source_templates: [templateName(state.template_id)],
        })),
      };
    }

    function updateSummary() {
      const states = currentStates();
      const counts = states.reduce((acc, state) => {
        acc[state.status] = (acc[state.status] || 0) + 1;
        return acc;
      }, {});
      const incompleteApproved = states
        .filter((state) => state.status === "approved")
        .filter((state) => !state.benchmark_tweet.trim() || splitList(state.expected_memes).length < 3 || !state.best_fit_when.trim() || !state.bad_fit_when.trim())
        .map((state) => state.template_id);
      summary.textContent = JSON.stringify({
        templates: states.length,
        approved: counts.approved || 0,
        needs_work: counts.needs_work || 0,
        rejected: counts.rejected || 0,
        incomplete_approved: incompleteApproved,
        approval_rule: "Approve only if recognizable, readable, distinct, and backed by a benchmark tweet with at least 3 expected meme families.",
      }, null, 2);
    }

    function splitList(value) {
      return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
    }

    function keywordsFrom(state) {
      return Array.from(new Set((state.best_fit_when + " " + state.bad_fit_when + " " + state.benchmark_tweet).toLowerCase().match(/[a-z0-9]{4,}/g) || [])).slice(0, 8);
    }

    function templateName(templateId) {
      const template = templates.find((item) => item.template_id === templateId);
      return template ? template.name : templateId;
    }

    function downloadJson(filename, payload) {
      const blob = new Blob([JSON.stringify(payload, null, 2) + "\\n"], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    }

    async function renderTemplate(template, canvas) {
      if (!template.source_image) throw new Error("missing source_image");
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
      ctx.strokeStyle = "rgba(125, 211, 252, 0.82)";
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
  const padding = Math.max(4, Math.min(width, height) * 0.055);
  const safeX = x + padding;
  const safeY = y + padding;
  const safeWidth = Math.max(8, width - padding * 2);
  const safeHeight = Math.max(8, height - padding * 2);
  const minFont = Math.max(10, (region.font && region.font.min_size) || 12);
  const maxFont = (region.font && region.font.max_size) || 52;
  const maxLines = region.max_lines || 4;
  let fontSize = estimateImpactFontSize(ctx, text, safeWidth, safeHeight, { minFont, maxFont });
  let lines = wrapImpactLines(ctx, text, safeWidth, fontSize, maxLines);
  while (fontSize - 0.5 >= minFont && (lines.length * fontSize * 1.08 > safeHeight || lines.some((line) => measureImpactText(ctx, line, fontSize) > safeWidth))) {
    fontSize -= 0.5;
    lines = wrapImpactLines(ctx, text, safeWidth, fontSize, maxLines);
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(safeX, safeY, safeWidth, safeHeight);
  ctx.clip();
  ctx.textAlign = region.align || "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
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
    const test = current ? current + " " + word : word;
    if (ctx.measureText(test).width <= maxWidth) current = test;
    else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length <= maxLines ? lines : lines.slice(0, Math.max(1, maxLines));
}
function estimateImpactFontSize(ctx, text, width, height, options) {
  const words = text.split(/\s+/).filter(Boolean);
  const longestWordLength = words.reduce((max, word) => Math.max(max, word.length), 1);
  const targetLineCount = Math.max(1, Math.min(4, Math.ceil(text.length / 18)));
  const roughByLength = width / Math.max(longestWordLength * 0.72, text.length * 0.24);
  const roughByHeight = height / (targetLineCount * 1.08);
  return Math.min(options.maxFont, Math.max(options.minFont, roughByLength, roughByHeight));
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

function visualWarningsForTemplate(template: MemeTemplate): string[] {
  const warnings: string[] = [];
  if (!template.source_image) warnings.push("missing source_image");
  if (template.regions.length === 0) warnings.push("missing overlay regions");
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
  return warnings;
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

function fail(message: string): never {
  console.error(`[MemeDrop] ${message}`);
  process.exit(1);
}
