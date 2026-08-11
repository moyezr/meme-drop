const apiRoot = "/internal/api/catalog/templates";
let drafts = [];
let current = null;
let selectedRegionId = null;
let interaction = null;
let dirty = false;
let searchTimer = null;
const previewText = new Map();

const $ = (id) => document.getElementById(id);
const list = $("draft-list");
const editor = $("editor");
const emptyState = $("empty-state");
const image = $("source-image");
const stage = $("stage");
const layer = $("region-layer");
const saveButton = $("save");
const dialog = $("create-dialog");

$("new-template").addEventListener("click", () => dialog.showModal());
$("close-dialog").addEventListener("click", () => dialog.close());
$("cancel-create").addEventListener("click", () => dialog.close());
$("create-form").addEventListener("submit", createDraft);
saveButton.addEventListener("click", saveDraft);
$("add-region").addEventListener("click", addRegion);
$("remove-region").addEventListener("click", removeRegion);
$("status-filter").addEventListener("change", loadDrafts);
$("search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadDrafts, 180);
});
image.addEventListener("load", renderRegions);
window.addEventListener("resize", renderRegions);
stage.addEventListener("pointermove", moveRegion);
stage.addEventListener("pointerup", endInteraction);
stage.addEventListener("pointercancel", endInteraction);

bindText("name", (value) => { current.annotation.name = value; $("editor-title").textContent = value; });
bindLines("aliases", (value) => { current.annotation.aliases = value; });
bindText("description", (value) => { current.annotation.editorial.description = value; });
bindLines("use-cases", (value) => { current.annotation.editorial.use_cases = value; });
bindLines("anti-use-cases", (value) => { current.annotation.editorial.anti_use_cases = value; });
bindLines("joke-shapes", (value) => { current.annotation.retrieval.joke_shapes = value; });
bindLines("positive-hints", (value) => { current.annotation.retrieval.positive_hints = value; });
bindLines("anti-hints", (value) => { current.annotation.retrieval.anti_hints = value; });
bindText("caption-pattern", (value) => { current.annotation.caption_guidance.pattern = value; });
$("draft-status").addEventListener("change", () => { current.status = $("draft-status").value; markDirty(); });
$("preview-text").addEventListener("input", () => {
  previewText.set(selectedRegionId, $("preview-text").value);
  updateRegionLabels();
});

for (const id of [
  "region-role", "region-x", "region-y", "region-width", "region-height", "region-align",
  "region-valign", "region-lines", "region-chars", "font-min", "font-max", "font-stroke",
  "region-notes",
]) {
  $(id).addEventListener("input", updateSelectedRegion);
}
for (const id of ["good-examples", "bad-examples"]) {
  $(id).addEventListener("input", markDirty);
}

await loadDrafts();

async function loadDrafts() {
  const query = new URLSearchParams();
  const status = $("status-filter").value;
  const search = $("search").value.trim();
  if (status) query.set("status", status);
  if (search) query.set("search", search);
  try {
    const result = await api(`${apiRoot}?${query}`);
    drafts = result.drafts;
    renderDraftList();
  } catch (error) {
    list.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
  }
}

function renderDraftList() {
  list.replaceChildren();
  if (!drafts.length) {
    const message = document.createElement("p");
    message.className = "help";
    message.textContent = "No catalog drafts match this view.";
    list.append(message);
    return;
  }
  for (const draft of drafts) {
    const button = document.createElement("button");
    button.className = "draft-card" + (current?.id === draft.id ? " active" : "");
    button.type = "button";
    const thumb = document.createElement("img");
    thumb.src = draft.thumbnail_path || draft.asset_path;
    thumb.alt = "";
    const text = document.createElement("div");
    const name = document.createElement("div");
    name.className = "draft-name";
    name.textContent = draft.name;
    const meta = document.createElement("div");
    meta.className = "draft-meta";
    meta.textContent = draft.status.replaceAll("_", " ") + " · r" + draft.revision;
    text.append(name, meta);
    button.append(thumb, text);
    button.addEventListener("click", () => selectDraft(draft.id));
    list.append(button);
  }
}

async function selectDraft(id) {
  if (dirty && !window.confirm("Discard unsaved changes and open another draft?")) return;
  try {
    const result = await api(`${apiRoot}/${id}`);
    current = structuredClone(result.draft);
    selectedRegionId = current.annotation.regions[0]?.id || null;
    previewText.clear();
    dirty = false;
    emptyState.classList.add("hidden");
    editor.classList.remove("hidden");
    image.src = current.asset_path;
    image.alt = current.name;
    syncEditor();
    renderDraftList();
  } catch (error) {
    toast(error.message, true);
  }
}

function syncEditor() {
  $("editor-title").textContent = current.annotation.name;
  $("revision").textContent = "revision " + current.revision;
  $("draft-status").value = current.status;
  $("name").value = current.annotation.name;
  $("aliases").value = linesText(current.annotation.aliases);
  $("description").value = current.annotation.editorial.description;
  $("use-cases").value = linesText(current.annotation.editorial.use_cases);
  $("anti-use-cases").value = linesText(current.annotation.editorial.anti_use_cases);
  $("joke-shapes").value = linesText(current.annotation.retrieval.joke_shapes);
  $("positive-hints").value = linesText(current.annotation.retrieval.positive_hints);
  $("anti-hints").value = linesText(current.annotation.retrieval.anti_hints);
  $("caption-pattern").value = current.annotation.caption_guidance.pattern;
  $("good-examples").value = JSON.stringify(current.annotation.caption_guidance.good_examples, null, 2);
  $("bad-examples").value = JSON.stringify(current.annotation.caption_guidance.bad_examples, null, 2);
  renderRegionTabs();
  syncRegionForm();
  renderRegions();
  updateSaveState();
}

function renderRegionTabs() {
  const tabs = $("region-tabs");
  tabs.replaceChildren();
  for (const region of current.annotation.regions) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = region.id;
    button.classList.toggle("active", region.id === selectedRegionId);
    button.addEventListener("click", () => {
      selectedRegionId = region.id;
      renderRegionTabs();
      syncRegionForm();
      renderRegions();
    });
    tabs.append(button);
  }
}

function renderRegions() {
  layer.replaceChildren();
  if (!current) return;
  for (const region of current.annotation.regions) {
    const box = document.createElement("div");
    box.className = "region" + (region.id === selectedRegionId ? " selected" : "");
    box.dataset.regionId = region.id;
    positionBox(box, region);
    box.style.alignItems = { top: "flex-start", middle: "center", bottom: "flex-end" }[region.valign];
    box.style.justifyContent = { left: "flex-start", center: "center", right: "flex-end" }[region.align];
    box.style.textAlign = region.align;
    box.style.fontSize = `${Math.max(12, Math.min(34, region.font.max_size * .48))}px`;
    const tag = document.createElement("span");
    tag.className = "region-tag";
    tag.textContent = region.id;
    const caption = document.createElement("span");
    caption.className = "region-preview";
    caption.textContent = previewText.get(region.id) || region.role;
    const handle = document.createElement("span");
    handle.className = "resize-handle";
    handle.addEventListener("pointerdown", (event) => beginInteraction(event, region.id, "resize"));
    box.addEventListener("pointerdown", (event) => beginInteraction(event, region.id, "move"));
    box.append(caption, tag, handle);
    layer.append(box);
  }
}

function updateRegionLabels() {
  for (const box of layer.querySelectorAll(".region")) {
    const region = regionById(box.dataset.regionId);
    box.querySelector(".region-preview").textContent = previewText.get(region.id) || region.role;
  }
}

function positionBox(box, region) {
  box.style.left = `${region.x * 100}%`;
  box.style.top = `${region.y * 100}%`;
  box.style.width = `${region.width * 100}%`;
  box.style.height = `${region.height * 100}%`;
}

function beginInteraction(event, regionId, mode) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  selectedRegionId = regionId;
  const region = regionById(regionId);
  interaction = {
    pointerId: event.pointerId,
    mode,
    startX: event.clientX,
    startY: event.clientY,
    original: { x: region.x, y: region.y, width: region.width, height: region.height },
  };
  stage.setPointerCapture(event.pointerId);
  renderRegionTabs();
  syncRegionForm();
  renderRegions();
}

function moveRegion(event) {
  if (!interaction || event.pointerId !== interaction.pointerId || !image.clientWidth || !image.clientHeight) return;
  const region = selectedRegion();
  if (!region) return;
  const dx = (event.clientX - interaction.startX) / image.clientWidth;
  const dy = (event.clientY - interaction.startY) / image.clientHeight;
  if (interaction.mode === "move") {
    region.x = clamp(interaction.original.x + dx, 0, 1 - region.width);
    region.y = clamp(interaction.original.y + dy, 0, 1 - region.height);
  } else {
    region.width = clamp(interaction.original.width + dx, .04, 1 - region.x);
    region.height = clamp(interaction.original.height + dy, .04, 1 - region.y);
  }
  roundRegion(region);
  markDirty();
  syncRegionForm();
  const box = layer.querySelector(`[data-region-id="${CSS.escape(region.id)}"]`);
  if (box) positionBox(box, region);
}

function endInteraction(event) {
  if (!interaction || event.pointerId !== interaction.pointerId) return;
  interaction = null;
}

function syncRegionForm() {
  const region = selectedRegion();
  const controls = $("region-editor").querySelectorAll("input, textarea, select");
  for (const control of controls) control.disabled = !region;
  $("remove-region").disabled = !region;
  if (!region) return;
  $("region-id").value = region.id;
  $("region-role").value = region.role;
  $("region-x").value = region.x;
  $("region-y").value = region.y;
  $("region-width").value = region.width;
  $("region-height").value = region.height;
  $("region-align").value = region.align;
  $("region-valign").value = region.valign;
  $("region-lines").value = region.max_lines;
  $("region-chars").value = region.max_chars;
  $("font-min").value = region.font.min_size;
  $("font-max").value = region.font.max_size;
  $("font-stroke").value = region.font.stroke_ratio;
  $("region-notes").value = region.notes || "";
  $("preview-text").value = previewText.get(region.id) || "";
}

function updateSelectedRegion() {
  const region = selectedRegion();
  if (!region) return;
  region.role = $("region-role").value;
  region.x = numberValue("region-x", region.x);
  region.y = numberValue("region-y", region.y);
  region.width = numberValue("region-width", region.width);
  region.height = numberValue("region-height", region.height);
  region.width = clamp(region.width, .04, 1 - region.x);
  region.height = clamp(region.height, .04, 1 - region.y);
  region.align = $("region-align").value;
  region.valign = $("region-valign").value;
  region.max_lines = numberValue("region-lines", region.max_lines);
  region.max_chars = numberValue("region-chars", region.max_chars);
  region.font.min_size = numberValue("font-min", region.font.min_size);
  region.font.max_size = numberValue("font-max", region.font.max_size);
  region.font.stroke_ratio = numberValue("font-stroke", region.font.stroke_ratio);
  region.notes = $("region-notes").value || null;
  roundRegion(region);
  markDirty();
  renderRegions();
}

function addRegion() {
  if (!current || current.annotation.regions.length >= 8) return toast("A template can have at most eight regions.", true);
  const used = new Set(current.annotation.regions.map((region) => region.id));
  let number = current.annotation.regions.length + 1;
  while (used.has(`region_${number}`)) number += 1;
  const region = {
    id: `region_${number}`,
    role: "Describe what this caption contributes to the joke",
    x: .1,
    y: .08,
    width: .8,
    height: .22,
    align: "center",
    valign: "middle",
    max_lines: 2,
    max_chars: 42,
    font: { family: "Impact", min_size: 18, max_size: 48, stroke_ratio: .1 },
    notes: null,
  };
  current.annotation.regions.push(region);
  selectedRegionId = region.id;
  markDirty();
  renderRegionTabs();
  syncRegionForm();
  renderRegions();
}

function removeRegion() {
  const index = current.annotation.regions.findIndex((region) => region.id === selectedRegionId);
  if (index < 0) return;
  current.annotation.regions.splice(index, 1);
  selectedRegionId = current.annotation.regions[Math.min(index, current.annotation.regions.length - 1)]?.id || null;
  markDirty();
  renderRegionTabs();
  syncRegionForm();
  renderRegions();
}

async function createDraft(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const payload = {
    name: String(data.get("name") || "").trim(),
    source_image_url: String(data.get("source_image_url") || "").trim(),
    aliases: lineValues(String(data.get("aliases") || "")),
  };
  for (const key of ["template_id", "base_template_id"]) {
    const value = String(data.get(key) || "").trim();
    if (value) payload[key] = value;
  }
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  $("create-error").textContent = "";
  try {
    const result = await api(apiRoot, { method: "POST", body: JSON.stringify(payload) });
    dialog.close();
    form.reset();
    await loadDrafts();
    await selectDraft(result.draft.id);
    toast("Source image copied to development storage and draft created.");
  } catch (error) {
    $("create-error").textContent = error.message;
  } finally {
    submit.disabled = false;
  }
}

async function saveDraft() {
  if (!current) return;
  try {
    current.annotation.caption_guidance.good_examples = parseExamples("good-examples");
    current.annotation.caption_guidance.bad_examples = parseExamples("bad-examples");
  } catch (error) {
    return toast(error.message, true);
  }
  saveButton.disabled = true;
  $("save-state").textContent = "Saving…";
  try {
    const result = await api(`${apiRoot}/${current.id}`, {
      method: "PUT",
      body: JSON.stringify({ revision: current.revision, status: current.status, annotation: current.annotation }),
    });
    current = structuredClone(result.draft);
    dirty = false;
    syncEditor();
    await loadDrafts();
    toast("Draft saved. Runtime catalog unchanged.");
  } catch (error) {
    updateSaveState();
    toast(error.message, true);
  }
}

function parseExamples(id) {
  const value = $(id).value.trim();
  if (!value) return [];
  let parsed;
  try { parsed = JSON.parse(value); } catch { throw new Error(`${id === "good-examples" ? "Good" : "Bad"} examples must be valid JSON.`); }
  if (!Array.isArray(parsed) || parsed.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
    throw new Error("Examples must be a JSON array of region maps.");
  }
  return parsed;
}

function bindText(id, setter) {
  $(id).addEventListener("input", () => { if (!current) return; setter($(id).value); markDirty(); });
}

function bindLines(id, setter) {
  $(id).addEventListener("input", () => { if (!current) return; setter(lineValues($(id).value)); markDirty(); });
}

function markDirty() {
  if (!current) return;
  dirty = true;
  updateSaveState();
}

function updateSaveState() {
  saveButton.disabled = !current || !dirty;
  $("save-state").textContent = !current ? "Select a draft" : dirty ? "Unsaved changes" : `Saved revision ${current.revision}`;
}

function selectedRegion() { return regionById(selectedRegionId); }
function regionById(id) { return current?.annotation.regions.find((region) => region.id === id) || null; }
function lineValues(value) { return [...new Set(value.split("\n").map((item) => item.trim()).filter(Boolean))]; }
function linesText(values) { return (values || []).join("\n"); }
function numberValue(id, fallback) { const value = Number($(id).value); return Number.isFinite(value) ? value : fallback; }
function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }
function roundRegion(region) { for (const key of ["x", "y", "width", "height"]) region[key] = Math.round(region[key] * 1000) / 1000; }
function escapeHtml(value) { return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]); }

async function api(url, options = {}) {
  const response = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = Array.isArray(body.details) ? body.details.map((item) => `${item.path || "request"}: ${item.message}`).join("; ") : "";
    throw new Error(details || body.error || `Request failed (${response.status})`);
  }
  return body;
}

function toast(message, isError = false) {
  const element = $("toast");
  element.textContent = message;
  element.style.color = isError ? "#fecaca" : "";
  element.classList.add("visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("visible"), 3200);
}
