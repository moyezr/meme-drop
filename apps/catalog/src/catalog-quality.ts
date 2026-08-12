import type { CatalogDraft, TemplateAnnotation, VisualQaAnnotation } from "./types";

export interface QualityCheck {
  id: string;
  label: string;
  complete: boolean;
  section: "content" | "retrieval" | "layout" | "review";
}

export function qualityChecks(annotation: TemplateAnnotation): QualityCheck[] {
  return [
    {
      id: "description",
      label: "Visual description",
      complete: annotation.editorial.description.trim().length >= 20,
      section: "content",
    },
    {
      id: "use-cases",
      label: "Use and anti-use cases",
      complete:
        annotation.editorial.use_cases.length > 0 && annotation.editorial.anti_use_cases.length > 0,
      section: "content",
    },
    {
      id: "caption-pattern",
      label: "Caption grammar",
      complete: annotation.caption_guidance.pattern.trim().length >= 20,
      section: "content",
    },
    {
      id: "examples",
      label: "Good and bad examples",
      complete:
        annotation.caption_guidance.good_examples.length > 0 &&
        annotation.caption_guidance.bad_examples.length > 0,
      section: "content",
    },
    {
      id: "retrieval",
      label: "Retrieval labels",
      complete:
        annotation.retrieval.joke_shapes.length > 0 &&
        annotation.retrieval.positive_hints.length > 0 &&
        annotation.retrieval.anti_hints.length > 0,
      section: "retrieval",
    },
    {
      id: "regions",
      label: "Caption regions",
      complete: annotation.regions.length > 0,
      section: "layout",
    },
    {
      id: "region-roles",
      label: "Region roles and limits",
      complete:
        annotation.regions.length > 0 &&
        annotation.regions.every(
          (region) => region.role.trim().length >= 8 && region.max_chars >= 8 && region.max_lines > 0,
        ),
      section: "layout",
    },
    {
      id: "rendered-qa",
      label: "Rendered visual QA",
      complete: visualQaComplete(annotation),
      section: "review",
    },
  ];
}

/** QA is deliberately complete only when every current region and good example was reviewed. */
export function visualQaComplete(annotation: TemplateAnnotation): boolean {
  const qa = annotation.visual_qa;
  if (!qa || !qa.render_fingerprint) return false;
  return (
    annotation.regions.every((region) => qa.reviewed_region_ids.includes(region.id)) &&
    annotation.caption_guidance.good_examples.every((_, index) =>
      qa.reviewed_example_indexes.includes(index),
    )
  );
}

/** Only the visual output inputs invalidate a previously reviewed render. */
export function renderInputsChanged(
  previous: TemplateAnnotation,
  next: TemplateAnnotation,
): boolean {
  return JSON.stringify({
    regions: previous.regions,
    examples: previous.caption_guidance.good_examples,
  }) !== JSON.stringify({
    regions: next.regions,
    examples: next.caption_guidance.good_examples,
  });
}

export function formatVisualQaTimestamp(value: VisualQaAnnotation["reviewed_at"] | undefined): string {
  if (!value) return "Not reviewed";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not reviewed" : date.toLocaleString();
}

export function qualityScore(annotation: TemplateAnnotation): number {
  const checks = qualityChecks(annotation);
  return Math.round((checks.filter((check) => check.complete).length / checks.length) * 100);
}

export function statusLabel(status: CatalogDraft["status"]): string {
  return {
    draft: "Draft",
    in_review: "In review",
    needs_work: "Needs work",
    approved: "Approved locally",
    rejected: "Rejected",
  }[status];
}

export function relativeUpdatedAt(value: string, now = Date.now()): string {
  const elapsed = Math.max(0, now - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
