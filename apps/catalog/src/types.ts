export type CatalogStatus = "draft" | "in_review" | "needs_work" | "approved" | "rejected";

export interface FontAnnotation {
  family: "Impact";
  min_size: number;
  max_size: number;
  stroke_ratio: number;
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
