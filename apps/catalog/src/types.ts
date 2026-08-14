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
    use_cases: string[];
    anti_use_cases: string[];
  };
  /** Local rendered review evidence. The API verifies its fingerprint before approval. */
  visual_qa?: VisualQaAnnotation | null;
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
