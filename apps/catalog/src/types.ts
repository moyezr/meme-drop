export type CatalogStatus = "draft" | "in_review" | "needs_work" | "approved" | "rejected";

export type FontFamily = "Impact" | "Anton" | "Inter";
export type FontWeight = 400 | 700 | 900;
export type TextTransform = "uppercase" | "none" | "mocking";

export interface FontAnnotation {
  family: FontFamily;
  weight: FontWeight;
  min_size: number;
  max_size: number;
  fill_color: string;
  stroke_color: string;
  stroke_ratio: number;
  line_height_ratio: number;
}

export interface RegionAnnotation {
  id: string;
  role: string;
  x: number;
  y: number;
  width: number;
  height: number;
  align: "left" | "center" | "right";
  valign: "top" | "middle" | "bottom";
  max_lines: number;
  max_chars: number;
  padding_ratio: number;
  text_transform: TextTransform;
  font: FontAnnotation;
  notes?: string | null;
}

export interface TemplateAnnotation {
  template_id: string;
  name: string;
  aliases: string[];
  source_image: string;
  supports_overlay: boolean;
  quality: "draft";
  regions: RegionAnnotation[];
  caption_guidance: {
    pattern: string;
    good_examples: Array<Record<string, string>>;
    bad_examples: Array<Record<string, string>>;
  };
  retrieval: {
    version: 1;
    joke_shapes: string[];
    positive_hints: string[];
    anti_hints: string[];
  };
  editorial: {
    description: string;
    canonical_meaning: string;
    use_cases: string[];
    anti_use_cases: string[];
    tone_tags: string[];
    trend_notes: string[];
    freshness: "evergreen" | "current" | "saturated" | "unknown";
  };
  safety: {
    sensitive_topics: string[];
    brand_risks: string[];
  };
  machine_provenance?: MachineProvenance | null;
  /** Local rendered review evidence. The API verifies its fingerprint before approval. */
  visual_qa?: VisualQaAnnotation | null;
}

export interface MachineProvenance {
  status: "machine_generated";
  requires_human_review: true;
  semantic_model: string;
  vision_model: string | null;
  geometry_source: "vision_model" | "text_only_fallback";
  prompt_version: string;
  input_sha256: string;
  generated_at: string;
  source_provider: "imgflip";
  source_id: string;
  source_content_sha256: string;
}

export interface VisualQaAnnotation {
  status: "passed";
  render_fingerprint: string;
  reviewed_region_ids: string[];
  reviewed_example_indexes: number[];
  reviewed_at: string;
}

export interface CatalogDraft {
  id: string;
  template_id: string;
  name: string;
  status: CatalogStatus;
  asset_path: string;
  thumbnail_path: string | null;
  source_url: string | null;
  annotation: TemplateAnnotation;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface CreateDraftInput {
  name: string;
  template_id?: string;
  base_template_id?: string;
  aliases: string[];
  source_image_url: string;
}
