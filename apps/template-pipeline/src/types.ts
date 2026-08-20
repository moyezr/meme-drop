export type PipelineStage =
  | "discovered"
  | "stored"
  | "vision_ready"
  | "annotated"
  | "duplicate"
  | "failed";

export interface ScrapedTemplate {
  provider: "imgflip";
  source_id: string;
  name: string;
  source_url: string;
  thumbnail_url?: string;
  page_url: string;
  rank: number;
}

export interface StoredAsset {
  bucket: "meme-drop-dev";
  object_key: string;
  public_path: string;
  content_sha256: string;
  mime_type: "image/jpeg" | "image/png" | "image/webp";
  byte_size: number;
  width: number;
  height: number;
}

export interface VisionRegionProposal {
  id: string;
  role: string;
  x: number;
  y: number;
  width: number;
  height: number;
  align: "left" | "center" | "right";
  valign: "top" | "middle" | "bottom";
  max_lines: number;
  notes: string;
}

export interface VisionFacts {
  description: string;
  subjects: string[];
  existing_text: string[];
  visual_tone: string[];
  supports_overlay: boolean;
  region_proposals: VisionRegionProposal[];
  placement_risks: string[];
  geometry_source: "vision_model" | "text_only_fallback";
}

export interface PipelineRecord {
  source: ScrapedTemplate;
  stage: PipelineStage;
  asset?: StoredAsset;
  vision?: VisionFacts;
  annotation?: MemeTemplateDraft;
  annotation_input_sha256?: string;
  duplicate_of?: string;
  attempts: number;
  error?: string;
  updated_at: string;
}

export interface PipelineState {
  version: 1;
  records: Record<string, PipelineRecord>;
}

export interface MemeTemplateDraft {
  schema_version: 2;
  template_id: string;
  name: string;
  aliases: string[];
  source_image: string;
  image_width: number;
  image_height: number;
  image_aspect_ratio: number;
  supports_overlay: boolean;
  quality: "draft";
  regions: MemeTemplateRegion[];
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
  source: {
    provider: "imgflip";
    source_id: string;
    source_url: string;
    page_url: string;
    content_sha256: string;
  };
  annotation_meta: {
    status: "machine_generated";
    requires_human_review: true;
    semantic_model: string;
    vision_model: string | null;
    geometry_source: "vision_model" | "text_only_fallback";
    prompt_version: string;
    input_sha256: string;
    generated_at: string;
  };
}

export interface MemeTemplateRegion {
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
  text_transform: "uppercase" | "none" | "mocking";
  font: {
    family: "Impact" | "Anton" | "Inter";
    weight: 400 | 700 | 900;
    min_size: number;
    max_size: number;
    fill_color: string;
    stroke_color: string;
    stroke_ratio: number;
    line_height_ratio: number;
  };
  notes: string;
}

export interface PipelineManifest {
  version: 2;
  generated_at: string;
  generator: {
    app: "@memedrop/template-pipeline";
    semantic_model: string;
    note: string;
  };
  templates: MemeTemplateDraft[];
}
