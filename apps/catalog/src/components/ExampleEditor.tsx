import type { RegionAnnotation } from "../types";

interface ExampleEditorProps {
  label: string;
  tone: "good" | "bad";
  examples: Array<Record<string, string>>;
  regions: RegionAnnotation[];
  onChange: (examples: Array<Record<string, string>>) => void;
}

export function ExampleEditor({ label, tone, examples, regions, onChange }: ExampleEditorProps) {
  function addExample() {
    onChange([...examples, Object.fromEntries(regions.map((region) => [region.id, ""]))]);
  }

  function updateExample(index: number, regionId: string, value: string) {
    onChange(
      examples.map((example, candidateIndex) =>
        candidateIndex === index ? { ...example, [regionId]: value } : example,
      ),
    );
  }

  return (
    <div className="field-group example-group">
      <div className="field-heading">
        <label>{label}</label>
        <button className="text-button" disabled={!regions.length} onClick={addExample} type="button">
          + Add example
        </button>
      </div>
      {!examples.length ? (
        <button className={`example-empty ${tone}`} disabled={!regions.length} onClick={addExample} type="button">
          <span>{tone === "good" ? "✓" : "×"}</span>
          {regions.length ? `Add a ${tone} caption example` : "Add a region first"}
        </button>
      ) : (
        <div className="example-list">
          {examples.map((example, index) => (
            <div className={`example-card ${tone}`} key={`${tone}-${index}`}>
              <div className="example-card-header">
                <span>{tone === "good" ? "Good fit" : "Avoid"} · {index + 1}</span>
                <button
                  aria-label={`Remove ${label.toLowerCase()} ${index + 1}`}
                  onClick={() => onChange(examples.filter((_, candidate) => candidate !== index))}
                  type="button"
                >
                  ×
                </button>
              </div>
              {regions.map((region) => (
                <label className="example-row" key={region.id}>
                  <span>{region.id}</span>
                  <input
                    onChange={(event) => updateExample(index, region.id, event.target.value)}
                    placeholder={region.role}
                    value={example[region.id] ?? ""}
                  />
                </label>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
