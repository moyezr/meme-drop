import { useEffect, useState } from "react";

import type { CreateDraftInput } from "../types";

interface CreateDialogProps {
  open: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onCreate: (input: CreateDraftInput) => void;
}

const emptyForm = {
  name: "",
  templateId: "",
  baseTemplateId: "",
  sourceImageUrl: "",
  aliases: "",
};

export function CreateDialog({ open, busy, error, onClose, onCreate }: CreateDialogProps) {
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    if (!open) setForm(emptyForm);
  }, [open]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section aria-labelledby="create-title" aria-modal="true" className="create-dialog" role="dialog">
        <div className="create-dialog-header">
          <div>
            <span className="section-kicker">Catalog intake</span>
            <h2 id="create-title">Add a meme template</h2>
            <p>Copy the source into development storage and begin a human-owned annotation.</p>
          </div>
          <button aria-label="Close" disabled={busy} onClick={onClose} type="button">×</button>
        </div>
        <div className="create-dialog-body">
          <div className="source-preview">
            {form.sourceImageUrl ? (
              <img alt="Source preview" src={form.sourceImageUrl} />
            ) : (
              <div><span>▧</span><strong>Source preview</strong><p>Paste a public image URL to inspect the template before ingestion.</p></div>
            )}
            <span className="draft-ribbon">Draft only</span>
          </div>
          <form
            className="create-fields"
            id="create-template-form"
            onSubmit={(event) => {
              event.preventDefault();
              onCreate({
                name: form.name.trim(),
                ...(form.templateId.trim() ? { template_id: form.templateId.trim() } : {}),
                ...(form.baseTemplateId.trim()
                  ? { base_template_id: form.baseTemplateId.trim() }
                  : {}),
                source_image_url: form.sourceImageUrl.trim(),
                aliases: form.aliases.split("\n").map((value) => value.trim()).filter(Boolean),
              });
            }}
          >
            <label>
              <span>Template name</span>
              <input autoFocus maxLength={120} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Boardroom suggestion" required value={form.name} />
            </label>
            <label>
              <span>Source image URL</span>
              <input onChange={(event) => setForm({ ...form, sourceImageUrl: event.target.value })} placeholder="https://…" required type="url" value={form.sourceImageUrl} />
            </label>
            <div className="create-grid">
              <label>
                <span>Template ID <small>optional</small></span>
                <input onChange={(event) => setForm({ ...form, templateId: event.target.value })} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="generated-from-name" value={form.templateId} />
              </label>
              <label>
                <span>Copy annotations <small>optional</small></span>
                <input onChange={(event) => setForm({ ...form, baseTemplateId: event.target.value })} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="existing-template-id" value={form.baseTemplateId} />
              </label>
            </div>
            <label>
              <span>Aliases <small>one per line</small></span>
              <textarea onChange={(event) => setForm({ ...form, aliases: event.target.value })} placeholder="Common nickname\nAlternate spelling" value={form.aliases} />
            </label>
            {error ? <div className="form-error"><span>!</span>{error}</div> : null}
          </form>
        </div>
        <div className="create-dialog-footer">
          <div><span className="storage-light" /> Stored in the configured development bucket</div>
          <div className="dialog-actions">
            <button disabled={busy} onClick={onClose} type="button">Cancel</button>
            <button className="primary-button" disabled={busy} form="create-template-form" type="submit">
              {busy ? "Ingesting…" : "Create catalog draft"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
