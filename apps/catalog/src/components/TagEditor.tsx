import { useState } from "react";

interface TagEditorProps {
  label: string;
  description?: string;
  placeholder: string;
  values: string[];
  onChange: (values: string[]) => void;
}

export function TagEditor({
  label,
  description,
  placeholder,
  values,
  onChange,
}: TagEditorProps) {
  const [input, setInput] = useState("");

  function addValue() {
    const normalized = input.trim().replace(/\s+/g, " ");
    if (!normalized || values.includes(normalized)) return;
    onChange([...values, normalized]);
    setInput("");
  }

  return (
    <div className="field-group">
      <div className="field-heading">
        <label>{label}</label>
        {description ? <span>{description}</span> : null}
      </div>
      <div className="tag-editor">
        <div className="tag-list">
          {values.map((value) => (
            <span className="tag" key={value}>
              {value}
              <button
                aria-label={`Remove ${value}`}
                onClick={() => onChange(values.filter((candidate) => candidate !== value))}
                type="button"
              >
                ×
              </button>
            </span>
          ))}
          <input
            aria-label={`${label} value`}
            onBlur={addValue}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                addValue();
              }
            }}
            placeholder={values.length ? "Add another…" : placeholder}
            value={input}
          />
        </div>
      </div>
    </div>
  );
}
