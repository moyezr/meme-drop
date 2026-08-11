import { useState } from "react";

import { qualityChecks, qualityScore, statusLabel } from "../catalog-quality";
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
          <div className="compact-grid four">
            <NumberField label="X" value={selectedRegion.x} step={0.001} onChange={(value) => updateRegion((region) => (region.x = value))} />
            <NumberField label="Y" value={selectedRegion.y} step={0.001} onChange={(value) => updateRegion((region) => (region.y = value))} />
            <NumberField label="W" value={selectedRegion.width} step={0.001} onChange={(value) => updateRegion((region) => (region.width = value))} />
            <NumberField label="H" value={selectedRegion.height} step={0.001} onChange={(value) => updateRegion((region) => (region.height = value))} />
          </div>
          <div className="compact-grid">
            <SelectField label="Align" value={selectedRegion.align} options={["left", "center", "right"]} onChange={(value) => updateRegion((region) => (region.align = value as RegionAnnotation["align"]))} />
            <SelectField label="Vertical" value={selectedRegion.valign} options={["top", "middle", "bottom"]} onChange={(value) => updateRegion((region) => (region.valign = value as RegionAnnotation["valign"]))} />
            <NumberField label="Lines" value={selectedRegion.max_lines} onChange={(value) => updateRegion((region) => (region.max_lines = value))} />
            <NumberField label="Characters" value={selectedRegion.max_chars} onChange={(value) => updateRegion((region) => (region.max_chars = value))} />
          </div>
          <div className="section-divider" />
          <div className="compact-grid">
            <NumberField label="Min font" value={selectedRegion.font.min_size} onChange={(value) => updateRegion((region) => (region.font.min_size = value))} />
            <NumberField label="Max font" value={selectedRegion.font.max_size} onChange={(value) => updateRegion((region) => (region.font.max_size = value))} />
            <NumberField label="Stroke" value={selectedRegion.font.stroke_ratio} step={0.01} onChange={(value) => updateRegion((region) => (region.font.stroke_ratio = value))} />
          </div>
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
      <div className="section-divider" />
      <Field label="Workflow state" hint={`Currently ${statusLabel(draft.status).toLowerCase()}`}>
        <select onChange={(event) => onStatusChange(event.target.value as CatalogStatus)} value={draft.status}>
          <option value="draft">Draft</option>
          <option value="in_review">In review</option>
          <option value="needs_work">Needs work</option>
          <option value="approved">Approved locally</option>
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

function NumberField({ label, value, step = 1, onChange }: { label: string; value: number; step?: number; onChange: (value: number) => void }) {
  return <label className="mini-field"><span>{label}</span><input type="number" step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <label className="mini-field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option}>{option}</option>)}</select></label>;
}
