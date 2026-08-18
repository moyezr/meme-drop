import { useCallback, useEffect, useMemo, useState } from "react";

import { ApiError, createDraft, getDraft, getScaleReviewPlan, listDrafts, updateDraft } from "./api";
import type { ScaleReviewFilter } from "./catalog-priority";
import { qualityScore, renderInputsChanged, statusLabel } from "./catalog-quality";
import { Canvas } from "./components/Canvas";
import { CatalogSidebar } from "./components/CatalogSidebar";
import { CreateDialog } from "./components/CreateDialog";
import { Inspector } from "./components/Inspector";
import type {
  CatalogDraft,
  CatalogStatus,
  CreateDraftInput,
  RegionAnnotation,
  ScaleReviewPlan,
  TemplateAnnotation,
  VisualQaAnnotation,
} from "./types";

export function App() {
  const [drafts, setDrafts] = useState<CatalogDraft[]>([]);
  const [current, setCurrent] = useState<CatalogDraft | null>(null);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<CatalogStatus | "">("");
  const [reviewFilter, setReviewFilter] = useState<ScaleReviewFilter>("");
  const [reviewPlan, setReviewPlan] = useState<ScaleReviewPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; error?: boolean } | null>(null);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    try {
      setDrafts(await listDrafts({ status: status || undefined, search: search.trim() || undefined }));
    } catch (error) {
      showNotice(messageFor(error), true);
    } finally {
      setLoading(false);
    }
  }, [search, status]);

  useEffect(() => {
    const timeout = window.setTimeout(loadCatalog, search ? 180 : 0);
    return () => window.clearTimeout(timeout);
  }, [loadCatalog, search]);

  useEffect(() => {
    getScaleReviewPlan()
      .then(setReviewPlan)
      .catch((error) => showNotice(messageFor(error), true));
  }, []);

  const save = useCallback(async () => {
    if (!current || !dirty || saving) return;
    setSaving(true);
    try {
      const saved = await updateDraft({
        id: current.id,
        revision: current.revision,
        status: current.status,
        annotation: current.annotation,
      });
      setCurrent(saved);
      setDirty(false);
      setDrafts((values) => values.map((value) => (value.id === saved.id ? saved : value)));
      showNotice(`Revision ${saved.revision} saved. Runtime catalog unchanged.`);
    } catch (error) {
      showNotice(messageFor(error), true);
    } finally {
      setSaving(false);
    }
  }, [current, dirty, saving]);

  useEffect(() => {
    function handleKeyboard(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    }
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, [save]);

  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent) {
      if (!dirty) return;
      event.preventDefault();
    }
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  async function selectDraft(id: string) {
    if (current?.id === id) return;
    if (dirty && !window.confirm("Discard your unsaved annotation changes?")) return;
    try {
      const draft = await getDraft(id);
      setCurrent(draft);
      setSelectedRegionId(draft.annotation.regions[0]?.id ?? null);
      setDirty(false);
    } catch (error) {
      showNotice(messageFor(error), true);
    }
  }

  async function create(input: CreateDraftInput) {
    setCreating(true);
    setCreateError(null);
    try {
      const draft = await createDraft(input);
      setCreateOpen(false);
      setCurrent(draft);
      setSelectedRegionId(draft.annotation.regions[0]?.id ?? null);
      setDirty(false);
      await loadCatalog();
      showNotice("Source copied to development storage. Start with the visual description.");
    } catch (error) {
      setCreateError(messageFor(error));
    } finally {
      setCreating(false);
    }
  }

  function changeAnnotation(annotation: TemplateAnnotation) {
    if (!current) return;
    const visual_qa = renderInputsChanged(current.annotation, annotation)
      ? null
      : annotation.visual_qa;
    setCurrent({ ...current, name: annotation.name, annotation: { ...annotation, visual_qa } });
    setDirty(true);
  }

  function changeVisualQa(visual_qa: VisualQaAnnotation | null) {
    if (!current) return;
    changeAnnotation({ ...current.annotation, visual_qa });
  }

  function changeStatus(nextStatus: CatalogStatus) {
    if (!current) return;
    setCurrent({ ...current, status: nextStatus });
    setDirty(true);
  }

  function changeRegion(region: RegionAnnotation) {
    if (!current) return;
    const annotation = structuredClone(current.annotation);
    annotation.regions = annotation.regions.map((candidate) =>
      candidate.id === region.id ? region : candidate,
    );
    changeAnnotation(annotation);
  }

  function addRegion() {
    if (!current || current.annotation.regions.length >= 8) return;
    const annotation = structuredClone(current.annotation);
    const ids = new Set(annotation.regions.map((region) => region.id));
    let index = annotation.regions.length + 1;
    while (ids.has(`region_${index}`)) index += 1;
    const region: RegionAnnotation = {
      id: `region_${index}`,
      role: "Describe what this caption contributes to the joke",
      x: 0.1,
      y: 0.08,
      width: 0.8,
      height: 0.22,
      align: "center",
      valign: "middle",
      max_lines: 2,
      max_chars: 42,
      padding_ratio: 0.055,
      text_transform: "uppercase",
      font: {
        family: "Impact",
        weight: 900,
        min_size: 18,
        max_size: 48,
        fill_color: "#FFFFFF",
        stroke_color: "#000000",
        stroke_ratio: 0.1,
        line_height_ratio: 1.08,
      },
      notes: null,
    };
    annotation.regions.push(region);
    changeAnnotation(annotation);
    setSelectedRegionId(region.id);
  }

  function removeRegion() {
    if (!current || !selectedRegionId) return;
    const annotation = structuredClone(current.annotation);
    const index = annotation.regions.findIndex((region) => region.id === selectedRegionId);
    annotation.regions = annotation.regions.filter((region) => region.id !== selectedRegionId);
    changeAnnotation(annotation);
    setSelectedRegionId(
      annotation.regions[Math.min(index, annotation.regions.length - 1)]?.id ?? null,
    );
  }

  function showNotice(message: string, error = false) {
    setNotice({ message, error });
    window.setTimeout(() => setNotice(null), 3600);
  }

  const score = useMemo(() => (current ? qualityScore(current.annotation) : 0), [current]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-block">
          <div className="brand-mark">M</div>
          <div>
            <strong>MemeDrop</strong>
            <span>Catalog Studio</span>
          </div>
        </div>
        {current ? (
          <div className="document-heading">
            <span>Catalog / {current.template_id}</span>
            <div>
              <h1>{current.annotation.name}</h1>
              <span className={`status-pill ${current.status}`}>
                <i /> {statusLabel(current.status)}
              </span>
            </div>
          </div>
        ) : (
          <div className="document-heading"><span>Human-reviewed meme intelligence</span><h1>Catalog Studio</h1></div>
        )}
        <div className="header-actions">
          {current ? (
            <div className="quality-summary">
              <span>Quality</span>
              <strong>{score}%</strong>
              <i><b style={{ width: `${score}%` }} /></i>
            </div>
          ) : null}
          <div className={`save-state ${dirty ? "dirty" : ""}`}>
            <i />
            {saving ? "Saving…" : dirty ? "Unsaved changes" : current ? `Revision ${current.revision}` : "Ready"}
          </div>
          <button className="save-button" disabled={!current || !dirty || saving} onClick={() => void save()} type="button">
            <span>⌘S</span> Save
          </button>
        </div>
      </header>

      <div className="workspace-shell">
        <CatalogSidebar
          drafts={drafts}
          loading={loading}
          onCreate={() => { setCreateError(null); setCreateOpen(true); }}
          onReviewFilter={setReviewFilter}
          onSearch={setSearch}
          onSelect={(id) => void selectDraft(id)}
          onStatus={setStatus}
          reviewFilter={reviewFilter}
          reviewPlan={reviewPlan}
          search={search}
          selectedId={current?.id ?? null}
          status={status}
        />

        {current ? (
          <main className="editor-workspace">
            <Canvas
              imageUrl={current.asset_path}
              name={current.annotation.name}
              annotation={current.annotation}
              onAddRegion={addRegion}
              onChangeRegion={changeRegion}
              onSelectRegion={setSelectedRegionId}
              regions={current.annotation.regions}
              selectedRegionId={selectedRegionId}
              onVisualQaChange={changeVisualQa}
            />
            <Inspector
              draft={current}
              key={current.id}
              onAddRegion={addRegion}
              onAnnotationChange={changeAnnotation}
              onRemoveRegion={removeRegion}
              onSelectRegion={setSelectedRegionId}
              onStatusChange={changeStatus}
              reviewItem={reviewPlan?.queue.find((item) => item.template_id === current.template_id)}
              selectedRegionId={selectedRegionId}
            />
          </main>
        ) : (
          <main className="welcome-workspace">
            <div className="welcome-orbit"><span>1</span><span>2</span><span>3</span><i>MD</i></div>
            <span className="section-kicker">Quality starts with the catalog</span>
            <h1>Turn a meme image into<br />reliable creative intelligence.</h1>
            <p>Define what the image communicates, where captions belong, and when the recommendation system should—or should not—use it.</p>
            <button className="primary-button large" onClick={() => setCreateOpen(true)} type="button">+ Add your first meme</button>
            <div className="workflow-steps">
              <span><b>1</b><strong>Ingest</strong><small>Source image</small></span>
              <i />
              <span><b>2</b><strong>Annotate</strong><small>Meaning + layout</small></span>
              <i />
              <span><b>3</b><strong>Review</strong><small>Human quality gate</small></span>
            </div>
          </main>
        )}
      </div>

      <CreateDialog
        busy={creating}
        error={createError}
        onClose={() => !creating && setCreateOpen(false)}
        onCreate={(input) => void create(input)}
        open={createOpen}
      />
      {notice ? <div className={`toast ${notice.error ? "error" : ""}`}><span>{notice.error ? "!" : "✓"}</span>{notice.message}</div> : null}
    </div>
  );
}

function messageFor(error: unknown): string {
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return "Something went wrong. Try again.";
}
