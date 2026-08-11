import type { CatalogDraft, TemplateAnnotation } from "./types";

export interface QualityCheck {
  id: string;
  label: string;
  complete: boolean;
  section: "content" | "retrieval" | "layout";
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
  ];
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
