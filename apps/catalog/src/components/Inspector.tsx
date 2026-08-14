import { useEffect, useState } from "react";

import { formatVisualQaTimestamp, qualityChecks, qualityScore, statusLabel, visualQaComplete } from "../catalog-quality";
import type {
  CatalogDraft,
  CatalogStatus,
  RegionAnnotation,
  TemplateAnnotation,
} from "../types";
import { ExampleEditor } from "./ExampleEditor";
import { QualityRing } from "./QualityRing";
import { TagEditor } from "./TagEditor";

type InspectorTab = "content" | "retrieval" | "layout" | "review";

interface InspectorProps {
  draft: CatalogDraft;
  selectedRegionId: string | null;
  onSelectRegion: (id: string) => void;
  onAnnotationChange: (annotation: TemplateAnnotation) => void;
  onStatusChange: (status: CatalogStatus) => void;
  onAddRegion: () => void;
  onRemoveRegion: () => void;
}

export function Inspector({
  draft,
  selectedRegionId,
  onSelectRegion,
  onAnnotationChange,
  onStatusChange,
  onAddRegion,
  onRemoveRegion,
}: InspectorProps) {
  const [tab, setTab] = useState<InspectorTab>("content");
  const annotation = draft.annotation;
  const selectedRegion = annotation.regions.find((region) => region.id === selectedRegionId) ?? null;

  function change(mutator: (value: TemplateAnnotation) => void) {
    const next = structuredClone(annotation);
    mutator(next);
    onAnnotationChange(next);
  }

  function updateRegion(mutator: (value: RegionAnnotation) => void) {
    if (!selectedRegion) return;
    change((next) => {
      const region = next.regions.find((candidate) => candidate.id === selectedRegion.id);
      if (region) mutator(region);
    });
  }

  return (
    <aside className="inspector">
      <nav className="inspector-tabs" aria-label="Annotation sections">
        {([
          ["content", "Content"],
          ["retrieval", "Retrieval"],
          ["layout", `Layout · ${annotation.regions.length}`],
          ["review", "Review"],
        ] as Array<[InspectorTab, string]>).map(([value, label]) => (
          <button className={tab === value ? "active" : ""} key={value} onClick={() => setTab(value)} type="button">
            {label}
          </button>
        ))}
      </nav>

      <div className="inspector-content">
        {tab === "content" ? (
          <ContentPanel annotation={annotation} change={change} />
        ) : null}
        {tab === "retrieval" ? (
          <RetrievalPanel annotation={annotation} change={change} />
        ) : null}
        {tab === "layout" ? (
          <LayoutPanel
            regions={annotation.regions}
            selectedRegion={selectedRegion}
            onSelect={onSelectRegion}
            onAdd={onAddRegion}
            onRemove={onRemoveRegion}
            updateRegion={updateRegion}
          />
        ) : null}
        {tab === "review" ? (
          <ReviewPanel draft={draft} onStatusChange={onStatusChange} onNavigate={setTab} />
        ) : null}
      </div>
    </aside>
  );
}

function ContentPanel({
  annotation,
  change,
}: {
  annotation: TemplateAnnotation;
  change: (mutator: (value: TemplateAnnotation) => void) => void;
}) {
  return (
    <div className="inspector-section">
      <SectionIntro
        kicker="Meaning and joke grammar"
        title="Teach the system what people see"
        description="Describe the visual beat first, then show how captions turn it into a joke."
      />
      <Field label="Template name" hint="Human-readable catalog label">
        <input
          maxLength={120}
          onChange={(event) => change((next) => (next.name = event.target.value))}
          value={annotation.name}
        />
      </Field>
      <TagEditor
        label="Aliases"
        description="Names people may search"
        placeholder="e.g. Boromir, one simply…"
        values={annotation.aliases}
        onChange={(values) => change((next) => (next.aliases = values))}
      />
      <Field label="Visual description" hint={`${annotation.editorial.description.length}/800`}>
        <textarea
          className="large-textarea"
          maxLength={800}
          onChange={(event) =>
            change((next) => (next.editorial.description = event.target.value))
          }
          placeholder="Describe the subjects, expressions, composition, and emotional beat. Do not explain a specific caption."
          value={annotation.editorial.description}
        />
      </Field>
      <div className="section-divider" />
      <Field label="Caption pattern" hint="Reusable visual joke structure">
        <textarea
          onChange={(event) =>
            change((next) => (next.caption_guidance.pattern = event.target.value))
          }
          placeholder="Example: Set up an apparently simple action, then name the obvious obstacle that makes it impossible."
          value={annotation.caption_guidance.pattern}
        />
      </Field>
      <ExampleEditor
        examples={annotation.caption_guidance.good_examples}
        label="Good examples"
        onChange={(examples) =>
          change((next) => (next.caption_guidance.good_examples = examples))
        }
        regions={annotation.regions}
        tone="good"
      />
      <ExampleEditor
        examples={annotation.caption_guidance.bad_examples}
        label="Bad examples"
        onChange={(examples) =>
          change((next) => (next.caption_guidance.bad_examples = examples))
        }
        regions={annotation.regions}
        tone="bad"
      />
    </div>
  );
}

function RetrievalPanel({
  annotation,
  change,
}: {
  annotation: TemplateAnnotation;
  change: (mutator: (value: TemplateAnnotation) => void) => void;
}) {
  return (
    <div className="inspector-section">
      <SectionIntro
        kicker="Recommendation quality"
        title="Define when this meme wins"
        description="Positive labels improve recall. Negative labels prevent a visually plausible but tonally wrong suggestion."
      />
      <div className="signal-card positive">
        <span className="signal-mark">+</span>
        <TagEditor
          label="Use this meme when…"
          placeholder="e.g. a simple request hides a hard constraint"
          values={annotation.editorial.use_cases}
          onChange={(values) => change((next) => (next.editorial.use_cases = values))}
        />
      </div>
      <div className="signal-card negative">
        <span className="signal-mark">−</span>
        <TagEditor
          label="Avoid this meme when…"
          placeholder="e.g. celebrating an uncomplicated success"
          values={annotation.editorial.anti_use_cases}
          onChange={(values) => change((next) => (next.editorial.anti_use_cases = values))}
        />
      </div>
      <div className="section-divider" />
      <TagEditor
        label="Joke shapes"
        description="Reusable mechanics, not topics"
        placeholder="expectation versus reality"
        values={annotation.retrieval.joke_shapes}
        onChange={(values) => change((next) => (next.retrieval.joke_shapes = values))}
      />
      <TagEditor
        label="Positive retrieval hints"
        description="Language patterns and situations"
        placeholder="confident claim meets obvious obstacle"
        values={annotation.retrieval.positive_hints}
        onChange={(values) => change((next) => (next.retrieval.positive_hints = values))}
      />
      <TagEditor
        label="Negative retrieval hints"
        description="Hard contrastive boundaries"
        placeholder="easy success with no tension"
        values={annotation.retrieval.anti_hints}
        onChange={(values) => change((next) => (next.retrieval.anti_hints = values))}
      />
    </div>
  );
}

function LayoutPanel({
  regions,
  selectedRegion,
  onSelect,
  onAdd,
  onRemove,
  updateRegion,
}: {
  regions: RegionAnnotation[];
  selectedRegion: RegionAnnotation | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRemove: () => void;
  updateRegion: (mutator: (value: RegionAnnotation) => void) => void;
}) {
  return (
    <div className="inspector-section">
      <SectionIntro
        kicker="Rendering quality"
        title="Shape the caption regions"
        description="Regions are normalized to the source image and used for every generated caption."
      />
      <div className="region-selector-list">
        {regions.map((region, index) => (
          <button className={selectedRegion?.id === region.id ? "active" : ""} key={region.id} onClick={() => onSelect(region.id)} type="button">
            <span>{index + 1}</span>
            <strong>{region.id.replaceAll("_", " ")}</strong>
            <small>{region.max_chars} chars</small>
          </button>
        ))}
        <button className="new-region-card" disabled={regions.length >= 8} onClick={onAdd} type="button">
          + New caption region
        </button>
      </div>
      {selectedRegion ? (
        <>
          <Field label="Role" hint="What this beat contributes">
            <textarea
              onChange={(event) => updateRegion((region) => (region.role = event.target.value))}
              value={selectedRegion.role}
            />
          </Field>
          <LayoutGroup title="Region geometry" hint="Normalized to the source image (0–1).">
            <div className="compact-grid four">
              <NumberField label="X" max={1 - selectedRegion.width} min={0} step={0.001} value={selectedRegion.x} onChange={(value) => updateRegion((region) => (region.x = value))} />
              <NumberField label="Y" max={1 - selectedRegion.height} min={0} step={0.001} value={selectedRegion.y} onChange={(value) => updateRegion((region) => (region.y = value))} />
              <NumberField label="W" max={1 - selectedRegion.x} min={0.04} step={0.001} value={selectedRegion.width} onChange={(value) => updateRegion((region) => (region.width = value))} />
              <NumberField label="H" max={1 - selectedRegion.y} min={0.04} step={0.001} value={selectedRegion.height} onChange={(value) => updateRegion((region) => (region.height = value))} />
            </div>
          </LayoutGroup>
          <LayoutGroup title="Copy and spacing" hint="Use the padding to keep type off the region edge.">
            <div className="compact-grid">
              <SelectField label="Align" options={["left", "center", "right"]} value={selectedRegion.align} onChange={(value) => updateRegion((region) => (region.align = value as RegionAnnotation["align"]))} />
              <SelectField label="Vertical" options={["top", "middle", "bottom"]} value={selectedRegion.valign} onChange={(value) => updateRegion((region) => (region.valign = value as RegionAnnotation["valign"]))} />
              <SelectField label="Transform" options={["uppercase", "none", "mocking"]} value={selectedRegion.text_transform} onChange={(value) => updateRegion((region) => (region.text_transform = value as RegionAnnotation["text_transform"]))} />
            </div>
            <div className="compact-grid">
              <NumberField label="Lines" max={4} min={1} value={selectedRegion.max_lines} onChange={(value) => updateRegion((region) => (region.max_lines = value))} />
              <NumberField label="Characters" max={90} min={8} value={selectedRegion.max_chars} onChange={(value) => updateRegion((region) => (region.max_chars = value))} />
              <NumberField hint="0–0.2 of region size" label="Padding" max={0.2} min={0} step={0.005} value={selectedRegion.padding_ratio} onChange={(value) => updateRegion((region) => (region.padding_ratio = value))} />
            </div>
          </LayoutGroup>
          <LayoutGroup title="Typography" hint="The production renderer uses these exact choices in Render QA.">
            <div className="compact-grid">
              <SelectField label="Family" options={["Impact", "Anton", "Inter"]} value={selectedRegion.font.family} onChange={(value) => updateRegion((region) => {
                region.font.family = value as RegionAnnotation["font"]["family"];
                if (region.font.family === "Anton") region.font.weight = 400;
              })} />
              <SelectField disabled={selectedRegion.font.family === "Anton"} hint={selectedRegion.font.family === "Anton" ? "Anton is regular only" : undefined} label="Weight" options={["400", "700", "900"]} value={String(selectedRegion.font.weight)} onChange={(value) => updateRegion((region) => (region.font.weight = Number(value) as RegionAnnotation["font"]["weight"]))} />
              <NumberField label="Line height" max={1.5} min={0.8} step={0.01} value={selectedRegion.font.line_height_ratio} onChange={(value) => updateRegion((region) => (region.font.line_height_ratio = value))} />
            </div>
            <div className="compact-grid">
              <NumberField label="Min font" max={Math.min(96, selectedRegion.font.max_size)} min={10} value={selectedRegion.font.min_size} onChange={(value) => updateRegion((region) => (region.font.min_size = Math.min(value, region.font.max_size)))} />
              <NumberField label="Max font" max={120} min={Math.max(10, selectedRegion.font.min_size)} value={selectedRegion.font.max_size} onChange={(value) => updateRegion((region) => (region.font.max_size = Math.max(value, region.font.min_size)))} />
              <NumberField hint="0–0.25 of type size" label="Stroke width" max={0.25} min={0} step={0.01} value={selectedRegion.font.stroke_ratio} onChange={(value) => updateRegion((region) => (region.font.stroke_ratio = value))} />
            </div>
            <div className="compact-grid color-grid">
              <ColorField label="Fill color" value={selectedRegion.font.fill_color} onChange={(value) => updateRegion((region) => (region.font.fill_color = value))} />
              <ColorField label="Stroke color" value={selectedRegion.font.stroke_color} onChange={(value) => updateRegion((region) => (region.font.stroke_color = value))} />
            </div>
          </LayoutGroup>
          <Field label="Placement notes" hint="Occlusion, contrast, or subject boundaries">
            <textarea
              onChange={(event) => updateRegion((region) => (region.notes = event.target.value || null))}
              placeholder="Keep clear of the face and high-detail background…"
              value={selectedRegion.notes || ""}
            />
          </Field>
          <button className="danger-button" onClick={onRemove} type="button">Remove this region</button>
        </>
      ) : (
        <div className="panel-empty"><span>▣</span><p>Select a region on the canvas to edit it.</p></div>
      )}
    </div>
  );
}

function ReviewPanel({
  draft,
  onStatusChange,
  onNavigate,
}: {
  draft: CatalogDraft;
  onStatusChange: (status: CatalogStatus) => void;
  onNavigate: (tab: InspectorTab) => void;
}) {
  const checks = qualityChecks(draft.annotation);
  const score = qualityScore(draft.annotation);
  const qaComplete = visualQaComplete(draft.annotation);
  const visualQa = draft.annotation.visual_qa;
  return (
    <div className="inspector-section review-section">
      <div className="review-score-card">
        <QualityRing score={score} />
        <div>
          <span className="section-kicker">Annotation quality</span>
          <h3>{score === 100 ? "Ready for human review" : "Complete the quality layer"}</h3>
          <p>{checks.filter((check) => check.complete).length} of {checks.length} checks complete</p>
        </div>
      </div>
      <div className="quality-checklist">
        {checks.map((check) => (
          <button key={check.id} onClick={() => onNavigate(check.section)} type="button">
            <span className={check.complete ? "check complete" : "check"}>{check.complete ? "✓" : "·"}</span>
            <strong>{check.label}</strong>
            <span>›</span>
          </button>
        ))}
      </div>
      <div className={qaComplete ? "visual-qa-state passed" : "visual-qa-state"}>
        <span className="visual-qa-icon">{qaComplete ? "✓" : "!"}</span>
        <div>
          <strong>{qaComplete ? "Rendered QA is current" : "Rendered QA still needs sign-off"}</strong>
          <p>
            {qaComplete
              ? `Reviewed ${visualQa?.reviewed_example_indexes.length ?? 0} good example${(visualQa?.reviewed_example_indexes.length ?? 0) === 1 ? "" : "s"} · ${formatVisualQaTimestamp(visualQa?.reviewed_at)}`
              : "Open Render QA in the canvas, inspect every good example, then record a clean server-verified check."}
          </p>
        </div>
      </div>
      <div className="section-divider" />
      <Field label="Workflow state" hint={`Currently ${statusLabel(draft.status).toLowerCase()}`}>
        <select onChange={(event) => onStatusChange(event.target.value as CatalogStatus)} value={draft.status}>
          <option value="draft">Draft</option>
          <option value="in_review">In review</option>
          <option value="needs_work">Needs work</option>
          <option disabled={!qaComplete} value="approved">Approved locally{qaComplete ? "" : " (requires rendered QA)"}</option>
          <option value="rejected">Rejected</option>
        </select>
      </Field>
      <div className="promotion-boundary">
        <span>⌁</span>
        <div>
          <strong>Approval stops here</strong>
          <p>This status never publishes a template. Production still requires QA, benchmark coverage, and the promotion script.</p>
        </div>
      </div>
    </div>
  );
}

function SectionIntro({ kicker, title, description }: { kicker: string; title: string; description: string }) {
  return <div className="section-intro"><span className="section-kicker">{kicker}</span><h3>{title}</h3><p>{description}</p></div>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <div className="field-group"><div className="field-heading"><label>{label}</label>{hint ? <span>{hint}</span> : null}</div>{children}</div>;
}

function LayoutGroup({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return <section className="layout-control-group"><div><strong>{title}</strong><span>{hint}</span></div>{children}</section>;
}

function NumberField({ label, value, step = 1, min, max, hint, onChange }: { label: string; value: number; step?: number; min?: number; max?: number; hint?: string; onChange: (value: number) => void }) {
  return <label className="mini-field"><span>{label}{hint ? <small>{hint}</small> : null}</span><input max={max} min={min} type="number" step={step} value={value} onChange={(event) => {
    const next = Number(event.target.value);
    if (!Number.isFinite(next)) return;
    onChange(Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, next)));
  }} /></label>;
}

function SelectField({ label, value, options, hint, disabled = false, onChange }: { label: string; value: string; options: string[]; hint?: string; disabled?: boolean; onChange: (value: string) => void }) {
  return <label className="mini-field"><span>{label}{hint ? <small>{hint}</small> : null}</span><select disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const inputId = `color-${label.replaceAll(" ", "-")}`;
  const [draftValue, setDraftValue] = useState(value);
  useEffect(() => setDraftValue(value), [value]);
  const isValid = /^#[0-9a-f]{6}$/i.test(draftValue);
  return <div className="mini-field color-field"><label htmlFor={inputId}>{label}</label><div><input aria-label={`${label} picker`} id={inputId} type="color" value={isValid ? draftValue : value} onChange={(event) => {
    const next = event.target.value.toUpperCase();
    setDraftValue(next);
    onChange(next);
  }} /><input aria-label={`${label} hex value`} maxLength={7} pattern="#[0-9A-Fa-f]{6}" type="text" value={draftValue} onBlur={() => {
    if (isValid) onChange(draftValue.toUpperCase());
    else setDraftValue(value);
  }} onChange={(event) => setDraftValue(event.target.value.toUpperCase())} /></div></div>;
}
