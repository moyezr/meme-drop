import { qualityScore, relativeUpdatedAt, statusLabel } from "../catalog-quality";
import type { CatalogDraft, CatalogStatus } from "../types";
import { QualityRing } from "./QualityRing";

interface CatalogSidebarProps {
  drafts: CatalogDraft[];
  selectedId: string | null;
  search: string;
  status: CatalogStatus | "";
  loading: boolean;
  onSearch: (value: string) => void;
  onStatus: (value: CatalogStatus | "") => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
}

export function CatalogSidebar({
  drafts,
  selectedId,
  search,
  status,
  loading,
  onSearch,
  onStatus,
  onSelect,
  onCreate,
}: CatalogSidebarProps) {
  return (
    <aside className="catalog-sidebar">
      <div className="catalog-sidebar-header">
        <div>
          <span className="section-kicker">Library</span>
          <h2>Catalog</h2>
        </div>
        <span className="count-badge">{drafts.length}</span>
      </div>
      <button className="add-meme-button" onClick={onCreate} type="button">
        <span>+</span>
        Add a meme
      </button>
      <div className="catalog-filters">
        <label className="search-field">
          <span aria-hidden="true">⌕</span>
          <input
            aria-label="Search catalog"
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search name or ID"
            type="search"
            value={search}
          />
        </label>
        <div className="status-tabs" role="group" aria-label="Filter by status">
          {[
            ["", "All"],
            ["draft", "Draft"],
            ["in_review", "Review"],
            ["needs_work", "Fix"],
          ].map(([value, label]) => (
            <button
              className={status === value ? "active" : ""}
              key={value}
              onClick={() => onStatus(value as CatalogStatus | "")}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="catalog-list" aria-live="polite">
        {loading ? <CatalogSkeleton /> : null}
        {!loading && !drafts.length ? (
          <div className="catalog-empty">
            <span>◇</span>
            <strong>No drafts found</strong>
            <p>Change the filter or add a meme to begin.</p>
          </div>
        ) : null}
        {!loading
          ? drafts.map((draft) => {
              const score = qualityScore(draft.annotation);
              return (
                <button
                  className={`catalog-item ${selectedId === draft.id ? "selected" : ""}`}
                  key={draft.id}
                  onClick={() => onSelect(draft.id)}
                  type="button"
                >
                  <img alt="" src={draft.thumbnail_path || draft.asset_path} />
                  <span className="catalog-item-body">
                    <strong>{draft.name}</strong>
                    <span className="catalog-item-meta">
                      <i className={`status-dot ${draft.status}`} />
                      {statusLabel(draft.status)} · {relativeUpdatedAt(draft.updated_at)}
                    </span>
                  </span>
                  <QualityRing score={score} size="small" />
                </button>
              );
            })
          : null}
      </div>
      <div className="sidebar-footer">
        <span className="storage-light" />
        Development catalog
        <small>PostgreSQL + configured storage</small>
      </div>
    </aside>
  );
}

function CatalogSkeleton() {
  return (
    <div className="catalog-skeleton" aria-label="Loading catalog">
      {[0, 1, 2, 3].map((value) => (
        <span key={value} />
      ))}
    </div>
  );
}
