import type { CatalogDraft, ScaleReviewItem, ScaleReviewLane, ScaleReviewPlan } from "./types";

export type ScaleReviewFilter = "" | ScaleReviewLane | "warnings";

export function scaleReviewItemsById(plan: ScaleReviewPlan | null): Map<string, ScaleReviewItem> {
  return new Map((plan?.queue || []).map((item) => [item.template_id, item]));
}

export function prioritizeCatalogDrafts(
  drafts: CatalogDraft[],
  plan: ScaleReviewPlan | null,
  filter: ScaleReviewFilter,
): CatalogDraft[] {
  const byId = scaleReviewItemsById(plan);
  return drafts
    .filter((draft) => {
      if (!filter) return true;
      const item = byId.get(draft.template_id);
      if (filter === "warnings") return Boolean(item?.mechanical_warnings.length);
      return item?.lane === filter;
    })
    .sort((left, right) => {
      const priorityDifference =
        (byId.get(right.template_id)?.priority || 0) -
        (byId.get(left.template_id)?.priority || 0);
      return priorityDifference || left.name.localeCompare(right.name);
    });
}

export function scaleReviewLaneLabel(lane: ScaleReviewLane): string {
  return {
    benchmark_family: "Benchmark",
    high_exposure: "Exposure",
    compare_verified: "Compare",
    novel: "Novel",
  }[lane];
}
