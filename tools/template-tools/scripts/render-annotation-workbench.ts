import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MEME_TEMPLATE_MANIFEST } from "../../../packages/shared/src/data/meme-template-manifest.js";
import generatedManifest from "../../../packages/shared/src/data/meme-template-manifest.generated.json" with { type: "json" };
import type { MemeTemplate } from "../../../packages/shared/src/types/template-manifest.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const requestedTemplate = String(args.template || "").trim();
  if (!requestedTemplate) {
    fail("Pass exactly one draft with --template <template-id>.");
  }

  const template = selectTemplate(requestedTemplate, Boolean(args["include-verified"]));
  const outputPath = path.resolve(
    rootDir,
    String(args.out || ".memedrop/template-annotation-" + template.template_id + ".html")
  );
  const imageBaseUrl = process.env.MEMEDROP_QA_IMAGE_BASE_URL || "http://localhost:3001";

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, buildHtml(template, imageBaseUrl), "utf8");

  console.log("[MemeDrop] wrote annotation workbench to " + path.relative(rootDir, outputPath));
  console.log("template=" + template.template_id + " regions=" + template.regions.length);
  console.log("Start the backend first when source_image uses a /memes/* URL.");
}

function selectTemplate(input: string, includeVerified: boolean): MemeTemplate {
  const wanted = normalizeName(input);
  const generated = (generatedManifest.templates as MemeTemplate[]).filter(matches);
  const manual = MEME_TEMPLATE_MANIFEST.templates.filter(matches);
  const candidates = [...generated, ...(includeVerified ? manual : [])];
  const selected =
    candidates.find((item) => normalizeName(item.template_id) === wanted) ||
    candidates.find((item) => normalizeName(item.name) === wanted) ||
    candidates[0];

  if (!selected || (!includeVerified && selected.quality !== "draft")) {
    fail(
      'No draft template matched "' +
        input +
        '". Use a generated draft id or pass --include-verified for inspection.'
    );
  }

  const sourceImage =
    selected.source_image ||
    generated.find((item) => item.source_image)?.source_image ||
    (generatedManifest.templates as MemeTemplate[]).find(
      (item) => normalizeName(item.template_id) === normalizeName(selected.template_id)
    )?.source_image;

  if (!sourceImage) {
    fail('Template "' + selected.template_id + '" has no source_image to annotate.');
  }

  return {
    ...structuredClone(selected),
    source_image: sourceImage,
    quality: "draft",
  };

  function matches(item: MemeTemplate): boolean {
    return [item.template_id, item.name, ...item.aliases].some(
      (value) => normalizeName(value) === wanted
    );
  }
}

function buildHtml(templateValue: MemeTemplate, baseUrl: string): string {
  return WORKBENCH_HTML.replace("__PAGE_TITLE__", escapeHtml(templateValue.name))
    .replace("__IMAGE_BASE_URL__", scriptJson(baseUrl))
    .replace("__TEMPLATE_JSON__", scriptJson(templateValue));
}

function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function parseArgs(rawArgs: string[]): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = rawArgs[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fail(message: string): never {
  console.error("[MemeDrop] " + message);
  process.exit(1);
}

const WORKBENCH_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MemeDrop annotation — __PAGE_TITLE__</title>
  <style>
    :root { color-scheme: dark; --bg:#0d0f12; --panel:#171a20; --line:#303640; --text:#f5f7fa; --muted:#9ba6b2; --accent:#38bdf8; --danger:#f87171; }
    * { box-sizing: border-box; }
    body { margin:0; background:var(--bg); color:var(--text); font:14px ui-sans-serif,system-ui,sans-serif; }
    header { display:flex; justify-content:space-between; gap:16px; align-items:center; padding:14px 18px; border-bottom:1px solid var(--line); background:#11141a; }
    h1 { margin:0 0 3px; font-size:18px; }
    p { margin:0; color:var(--muted); line-height:1.4; }
    button,input,select,textarea { border:1px solid var(--line); border-radius:7px; background:#20252d; color:var(--text); font:inherit; }
    button { padding:8px 11px; cursor:pointer; font-weight:650; }
    button.primary { background:#075985; border-color:#0284c7; }
    button.danger { color:#fecaca; }
    button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
    .actions { display:flex; flex-wrap:wrap; gap:8px; justify-content:flex-end; }
    main { display:grid; grid-template-columns:minmax(440px,1.5fr) minmax(330px,0.8fr); gap:16px; padding:16px; align-items:start; }
    .panel { border:1px solid var(--line); border-radius:10px; background:var(--panel); overflow:hidden; }
    .panel-title { padding:11px 13px; border-bottom:1px solid var(--line); font-weight:700; }
    .stage-wrap { padding:14px; background:#070809; }
    .stage { position:relative; max-width:100%; width:max-content; margin:auto; touch-action:none; user-select:none; }
    .stage img { display:block; max-width:100%; max-height:calc(100vh - 150px); width:auto; height:auto; border-radius:7px; }
    .region { position:absolute; display:flex; align-items:center; justify-content:center; border:2px dashed rgba(56,189,248,.9); background:rgba(14,165,233,.12); color:#fff; text-align:center; text-shadow:1px 1px 2px #000; font-family:Impact,Haettenschweiler,"Arial Black",sans-serif; cursor:move; overflow:hidden; padding:3px; }
    .region.selected { border-style:solid; background:rgba(14,165,233,.22); box-shadow:0 0 0 2px rgba(255,255,255,.7); }
    .region-id { position:absolute; top:2px; left:3px; padding:1px 4px; border-radius:4px; background:rgba(0,0,0,.7); font:10px ui-monospace,monospace; text-shadow:none; }
    .resize { position:absolute; right:-1px; bottom:-1px; width:14px; height:14px; border:1px solid #fff; background:var(--accent); cursor:nwse-resize; }
    .hint { padding:10px 13px; border-top:1px solid var(--line); color:var(--muted); font-size:12px; }
    form { display:grid; gap:11px; padding:13px; }
    .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:9px; }
    label { display:grid; gap:5px; color:#d5dbe3; font-size:12px; font-weight:650; }
    input,select,textarea { width:100%; padding:8px; }
    textarea { min-height:58px; resize:vertical; }
    .region-list { display:flex; gap:7px; flex-wrap:wrap; padding:11px 13px; border-bottom:1px solid var(--line); }
    .region-list button.active { background:#075985; border-color:#38bdf8; }
    .status { min-height:20px; padding:0 13px 13px; color:var(--muted); font-size:12px; }
    .status.error { color:var(--danger); }
    code { color:#bae6fd; }
    @media (max-width:900px) { main { grid-template-columns:1fr; } .stage img { max-height:none; } }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Template annotation workbench</h1>
      <p id="template-meta"></p>
    </div>
    <div class="actions">
      <button id="add-region">Add region</button>
      <button id="copy-json">Copy JSON</button>
      <button class="primary" id="export-json">Export draft JSON</button>
      <button class="danger" id="reset">Reset</button>
    </div>
  </header>
  <main>
    <section class="panel">
      <div class="panel-title">Visual regions</div>
      <div class="stage-wrap">
        <div class="stage" id="stage">
          <img id="source-image" alt="" />
          <div id="regions"></div>
        </div>
      </div>
      <div class="hint">Drag a region to move it. Drag its lower-right handle to resize it. Coordinates are normalized, so the same annotation works at every rendered size.</div>
    </section>
    <aside class="panel">
      <div class="panel-title">Selected region</div>
      <div class="region-list" id="region-list"></div>
      <form id="editor">
        <div class="grid">
          <label>Region id<input data-field="id" disabled /></label>
          <label>Preview text<input id="sample-text" maxlength="120" /></label>
        </div>
        <label>Role<textarea data-field="role" maxlength="120"></textarea></label>
        <div class="grid">
          <label>X<input data-field="x" data-number type="number" step="0.001" min="0" max="1" /></label>
          <label>Y<input data-field="y" data-number type="number" step="0.001" min="0" max="1" /></label>
          <label>Width<input data-field="width" data-number type="number" step="0.001" min="0.04" max="1" /></label>
          <label>Height<input data-field="height" data-number type="number" step="0.001" min="0.04" max="1" /></label>
        </div>
        <div class="grid">
          <label>Horizontal alignment<select data-field="align"><option>left</option><option>center</option><option>right</option></select></label>
          <label>Vertical alignment<select data-field="valign"><option>top</option><option>middle</option><option>bottom</option></select></label>
          <label>Maximum lines<input data-field="max_lines" data-number type="number" min="1" max="4" /></label>
          <label>Maximum characters<input data-field="max_chars" data-number type="number" min="8" max="90" /></label>
          <label>Minimum font<input data-field="font.min_size" data-number type="number" min="10" max="96" /></label>
          <label>Maximum font<input data-field="font.max_size" data-number type="number" min="10" max="120" /></label>
          <label>Stroke ratio<input data-field="font.stroke_ratio" data-number type="number" step="0.01" min="0.06" max="0.2" /></label>
        </div>
        <label>Notes<textarea data-field="notes" maxlength="180"></textarea></label>
        <button class="danger" id="remove-region" type="button">Remove selected region</button>
      </form>
      <div class="status" id="status"></div>
    </aside>
  </main>
  <script>
    const IMAGE_BASE_URL = __IMAGE_BASE_URL__;
    const original = __TEMPLATE_JSON__;
    const storageKey = "memedrop:annotation:v1:" + original.template_id;
    const saved = readSaved();
    let template = saved || JSON.parse(JSON.stringify(original));
    template.quality = "draft";
    let selectedId = template.regions[0] && template.regions[0].id;
    const sampleText = {};
    let interaction = null;

    const stage = document.getElementById("stage");
    const image = document.getElementById("source-image");
    const regionRoot = document.getElementById("regions");
    const regionList = document.getElementById("region-list");
    const editor = document.getElementById("editor");
    const status = document.getElementById("status");
    const sampleInput = document.getElementById("sample-text");

    document.getElementById("template-meta").textContent = template.name + " · " + template.template_id + " · draft-only export";
    image.alt = template.name;
    image.src = imageUrlFor(template.source_image);
    image.addEventListener("load", render);
    window.addEventListener("resize", positionRegions);

    document.getElementById("add-region").addEventListener("click", addRegion);
    document.getElementById("remove-region").addEventListener("click", removeRegion);
    document.getElementById("copy-json").addEventListener("click", copyJson);
    document.getElementById("export-json").addEventListener("click", exportJson);
    document.getElementById("reset").addEventListener("click", resetDraft);
    sampleInput.addEventListener("input", function () {
      sampleText[selectedId] = sampleInput.value;
      updateRegionText();
    });
    editor.addEventListener("input", updateSelectedFromForm);

    stage.addEventListener("pointermove", onPointerMove);
    stage.addEventListener("pointerup", endInteraction);
    stage.addEventListener("pointercancel", endInteraction);

    render();

    function render() {
      renderRegionList();
      renderRegions();
      syncForm();
      showStatus("Changes are saved in this browser. Export JSON for review; this tool never edits the runtime catalog.");
    }

    function renderRegionList() {
      regionList.replaceChildren();
      for (const region of template.regions) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = region.id;
        button.classList.toggle("active", region.id === selectedId);
        button.addEventListener("click", function () {
          selectedId = region.id;
          render();
        });
        regionList.appendChild(button);
      }
    }

    function renderRegions() {
      regionRoot.replaceChildren();
      for (const region of template.regions) {
        const box = document.createElement("div");
        box.className = "region" + (region.id === selectedId ? " selected" : "");
        box.dataset.regionId = region.id;
        box.setAttribute("role", "button");
        box.setAttribute("aria-label", "Edit " + region.id);
        box.innerHTML = '<span class="region-id"></span><span class="region-text"></span><span class="resize" aria-hidden="true"></span>';
        box.querySelector(".region-id").textContent = region.id;
        box.querySelector(".region-text").textContent = previewFor(region);
        box.addEventListener("pointerdown", function (event) {
          beginInteraction(event, region.id, event.target.classList.contains("resize") ? "resize" : "move");
        });
        regionRoot.appendChild(box);
      }
      positionRegions();
    }

    function positionRegions() {
      for (const region of template.regions) {
        const box = regionRoot.querySelector('[data-region-id="' + CSS.escape(region.id) + '"]');
        if (!box) continue;
        box.style.left = region.x * 100 + "%";
        box.style.top = region.y * 100 + "%";
        box.style.width = region.width * 100 + "%";
        box.style.height = region.height * 100 + "%";
        box.style.alignItems = region.valign === "top" ? "flex-start" : region.valign === "bottom" ? "flex-end" : "center";
        box.style.justifyContent = region.align === "left" ? "flex-start" : region.align === "right" ? "flex-end" : "center";
        box.style.textAlign = region.align;
      }
    }

    function beginInteraction(event, regionId, mode) {
      event.preventDefault();
      selectedId = regionId;
      const region = selectedRegion();
      if (!region) return;
      interaction = {
        pointerId: event.pointerId,
        mode: mode,
        startX: event.clientX,
        startY: event.clientY,
        region: JSON.parse(JSON.stringify(region))
      };
      stage.setPointerCapture(event.pointerId);
      renderRegionList();
      syncForm();
      for (const box of regionRoot.querySelectorAll(".region")) {
        box.classList.toggle("selected", box.dataset.regionId === selectedId);
      }
    }

    function onPointerMove(event) {
      if (!interaction || interaction.pointerId !== event.pointerId) return;
      const region = selectedRegion();
      const rect = stage.getBoundingClientRect();
      if (!region || rect.width <= 0 || rect.height <= 0) return;
      const dx = (event.clientX - interaction.startX) / rect.width;
      const dy = (event.clientY - interaction.startY) / rect.height;
      if (interaction.mode === "move") {
        region.x = round(clamp(interaction.region.x + dx, 0, 1 - region.width));
        region.y = round(clamp(interaction.region.y + dy, 0, 1 - region.height));
      } else {
        region.width = round(clamp(interaction.region.width + dx, 0.04, 1 - region.x));
        region.height = round(clamp(interaction.region.height + dy, 0.04, 1 - region.y));
      }
      positionRegions();
      syncCoordinateFields(region);
      persist();
    }

    function endInteraction(event) {
      if (!interaction || interaction.pointerId !== event.pointerId) return;
      interaction = null;
      if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
      syncForm();
    }

    function syncForm() {
      const region = selectedRegion();
      editor.hidden = !region;
      if (!region) return;
      for (const input of editor.querySelectorAll("[data-field]")) {
        const value = getPath(region, input.dataset.field);
        input.value = value == null ? "" : String(value);
      }
      sampleInput.value = sampleText[region.id] || previewFor(region);
    }

    function syncCoordinateFields(region) {
      for (const field of ["x", "y", "width", "height"]) {
        const input = editor.querySelector('[data-field="' + field + '"]');
        if (input) input.value = String(region[field]);
      }
    }

    function updateSelectedFromForm(event) {
      const input = event.target;
      const field = input.dataset && input.dataset.field;
      const region = selectedRegion();
      if (!field || !region || input.disabled) return;
      const value = input.hasAttribute("data-number") ? Number(input.value) : input.value;
      setPath(region, field, value);
      normalizeRegion(region);
      persist();
      renderRegions();
      syncForm();
    }

    function addRegion() {
      let index = template.regions.length + 1;
      while (template.regions.some(function (region) { return region.id === "region_" + index; })) index += 1;
      const region = {
        id: "region_" + index,
        role: "describe this caption region",
        x: 0.1,
        y: 0.1,
        width: 0.4,
        height: 0.16,
        align: "center",
        valign: "middle",
        max_lines: 2,
        max_chars: 32,
        font: { family: "Impact", min_size: 18, max_size: 44, stroke_ratio: 0.12 },
        notes: ""
      };
      template.regions.push(region);
      selectedId = region.id;
      persist();
      render();
    }

    function removeRegion() {
      if (template.regions.length <= 1) {
        showStatus("At least one region is required for an overlay template.", true);
        return;
      }
      const index = template.regions.findIndex(function (region) { return region.id === selectedId; });
      if (index < 0) return;
      template.regions.splice(index, 1);
      selectedId = template.regions[Math.max(0, index - 1)].id;
      persist();
      render();
    }

    function previewFor(region) {
      const good = template.caption_guidance.good_examples || [];
      for (const example of good) {
        if (example[region.id]) return example[region.id];
      }
      return region.role;
    }

    function updateRegionText() {
      const box = regionRoot.querySelector('[data-region-id="' + CSS.escape(selectedId) + '"] .region-text');
      if (box) box.textContent = sampleText[selectedId] || previewFor(selectedRegion());
    }

    function validate() {
      const errors = [];
      const ids = new Set();
      for (const region of template.regions) {
        if (!region.id || ids.has(region.id)) errors.push("Region ids must be non-empty and unique.");
        ids.add(region.id);
        if (!String(region.role || "").trim()) errors.push(region.id + ": role is required.");
        if (region.x < 0 || region.y < 0 || region.x + region.width > 1 || region.y + region.height > 1) {
          errors.push(region.id + ": region must stay inside the image.");
        }
        if (region.font.min_size > region.font.max_size) errors.push(region.id + ": minimum font exceeds maximum font.");
      }
      return Array.from(new Set(errors));
    }

    function buildExport() {
      template.quality = "draft";
      return { version: 1, generated_at: new Date().toISOString(), templates: [template] };
    }

    async function copyJson() {
      const errors = validate();
      if (errors.length) return showStatus(errors.join(" "), true);
      await navigator.clipboard.writeText(JSON.stringify(buildExport(), null, 2));
      showStatus("Draft JSON copied. Save it under .memedrop/ and run the existing audit and QA workflow.");
    }

    function exportJson() {
      const errors = validate();
      if (errors.length) return showStatus(errors.join(" "), true);
      const blob = new Blob([JSON.stringify(buildExport(), null, 2) + "\\n"], { type: "application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "template-annotation-" + template.template_id + ".json";
      link.click();
      URL.revokeObjectURL(link.href);
      showStatus("Draft exported. Move it under .memedrop/; export never changes the runtime catalog.");
    }

    function resetDraft() {
      if (!confirm("Reset all local annotation changes for this template?")) return;
      localStorage.removeItem(storageKey);
      template = JSON.parse(JSON.stringify(original));
      template.quality = "draft";
      selectedId = template.regions[0] && template.regions[0].id;
      render();
    }

    function selectedRegion() {
      return template.regions.find(function (region) { return region.id === selectedId; });
    }

    function normalizeRegion(region) {
      region.x = round(clamp(Number(region.x) || 0, 0, 0.96));
      region.y = round(clamp(Number(region.y) || 0, 0, 0.96));
      region.width = round(clamp(Number(region.width) || 0.04, 0.04, 1 - region.x));
      region.height = round(clamp(Number(region.height) || 0.04, 0.04, 1 - region.y));
      region.max_lines = Math.round(clamp(Number(region.max_lines) || 1, 1, 4));
      region.max_chars = Math.round(clamp(Number(region.max_chars) || 8, 8, 90));
      region.font.min_size = Math.round(clamp(Number(region.font.min_size) || 10, 10, 96));
      region.font.max_size = Math.round(clamp(Number(region.font.max_size) || 10, 10, 120));
      region.font.stroke_ratio = round(clamp(Number(region.font.stroke_ratio) || 0.12, 0.06, 0.2));
    }

    function getPath(object, dotted) {
      return dotted.split(".").reduce(function (value, key) { return value && value[key]; }, object);
    }

    function setPath(object, dotted, value) {
      const parts = dotted.split(".");
      const last = parts.pop();
      const target = parts.reduce(function (current, key) { return current[key]; }, object);
      target[last] = value;
    }

    function persist() {
      localStorage.setItem(storageKey, JSON.stringify(template));
    }

    function readSaved() {
      try {
        const value = JSON.parse(localStorage.getItem(storageKey) || "null");
        return value && value.template_id === original.template_id ? value : null;
      } catch {
        return null;
      }
    }

    function imageUrlFor(source) {
      if (/^(https?:|data:|blob:|file:)/.test(String(source || ""))) return source;
      return String(IMAGE_BASE_URL || "").replace(/\/+$/, "") + (String(source).startsWith("/") ? source : "/" + source);
    }

    function clamp(value, minimum, maximum) {
      return Math.min(maximum, Math.max(minimum, value));
    }

    function round(value) {
      return Math.round(value * 10000) / 10000;
    }

    function showStatus(message, error) {
      status.textContent = message;
      status.classList.toggle("error", Boolean(error));
    }
  </script>
</body>
</html>
`;

await main();
