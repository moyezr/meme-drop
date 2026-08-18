import { qualityScore, relativeUpdatedAt, statusLabel } from "../catalog-quality";
import {
  prioritizeCatalogDrafts,
  scaleReviewItemsById,
  scaleReviewLaneLabel,
  type ScaleReviewFilter,
} from "../catalog-priority";
import type { CatalogDraft, CatalogStatus, ScaleReviewPlan } from "../types";
import { QualityRing } from "./QualityRing";

interface CatalogSidebarProps {
  drafts: CatalogDraft[];
  selectedId: string | null;
  search: string;
  status: CatalogStatus | "";
  loading: boolean;
  reviewPlan: ScaleReviewPlan | null;
  reviewFilter: ScaleReviewFilter;
  onSearch: (value: string) => void;
  onStatus: (value: CatalogStatus | "") => void;
  onReviewFilter: (value: ScaleReviewFilter) => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
}

export function CatalogSidebar({
  drafts,
  selectedId,
  search,
  status,
  loading,
  reviewPlan,
  reviewFilter,
  onSearch,
  onStatus,
  onReviewFilter,
  onSelect,
  onCreate,
}: CatalogSidebarProps) {
  const reviewItems = scaleReviewItemsById(reviewPlan);
  const visibleDrafts = prioritizeCatalogDrafts(drafts, reviewPlan, reviewFilter);
  return (
    <aside className="catalog-sidebar">
      <div className="catalog-sidebar-header">
        <div>
          <span className="section-kicker">Library</span>
          <h2>Catalog</h2>
        </div>
        <span className="count-badge">{visibleDrafts.length}</span>
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
        <select
          aria-label="Filter review priority"
          className="priority-filter"
          onChange={(event) => onReviewFilter(event.target.value as ScaleReviewFilter)}
          value={reviewFilter}
        >
          <option value="">All review priorities</option>
          <option value="benchmark_family">Benchmark families</option>
          <option value="high_exposure">High exposure</option>
          <option value="compare_verified">Compare verified</option>
          <option value="novel">Novel candidates</option>
          <option value="warnings">Warnings</option>
        </select>
      </div>
      <div className="catalog-list" aria-live="polite">
        {loading ? <CatalogSkeleton /> : null}
        {!loading && !visibleDrafts.length ? (
          <div className="catalog-empty">
            <span>◇</span>
            <strong>No drafts found</strong>
            <p>Change the filter or add a meme to begin.</p>
          </div>
        ) : null}
        {!loading
          ? visibleDrafts.map((draft) => {
              const score = qualityScore(draft.annotation);
              const priority = reviewItems.get(draft.template_id);
              return (
                <button
                  className={`catalog-item ${selectedId === draft.id ? "selected" : ""}`}
                  key={draft.id}
                  onClick={() => onSelect(draft.id)}
                  type="button"
                >
                  <img alt="" loading="lazy" src={draft.thumbnail_path || draft.asset_path} />
                  <span className="catalog-item-body">
                    <strong>{draft.name}</strong>
                    <span className="catalog-item-meta">
                      <i className={`status-dot ${draft.status}`} />
                      {statusLabel(draft.status)} · {relativeUpdatedAt(draft.updated_at)}
                      {priority ? (
                        <b className={`priority-label ${priority.lane}`}>
                          {scaleReviewLaneLabel(priority.lane)}
                          {priority.mechanical_warnings.length ? " !" : ""}
                        </b>
                      ) : null}
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
