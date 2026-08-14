export type ManifestQuality = "verified" | "draft" | "disabled";

export interface MemeTemplateManifest {
  version: number;
  generated_at: string;
  templates: MemeTemplate[];
}

export interface MemeTemplate {
  template_id: string;
  meme_id?: string;
  name: string;
  aliases: string[];
  source_image?: string;
  image_width?: number;
  image_height?: number;
  image_aspect_ratio?: number;
  supports_overlay: boolean;
  quality: ManifestQuality;
  regions: MemeTextTemplateRegion[];
  caption_guidance: MemeCaptionGuidance;
  /**
   * Catalog-owned signals for retrieval. These are deliberately separate from
   * caption guidance: they describe when a meme's joke grammar fits a post,
   * rather than copy that should be shown to a caption model.
   */
  retrieval?: MemeRetrievalMetadata;
}

export interface MemeTextTemplateRegion {
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
  padding_ratio?: number;
  text_transform?: "uppercase" | "mocking" | "none";
  font: {
    family: "Impact" | "Anton" | "Inter";
    weight?: 400 | 700 | 900;
    min_size: number;
    max_size: number;
    fill_color?: string;
    stroke_color?: string;
    stroke_ratio?: number;
    line_height_ratio?: number;
  };
  notes?: string;
}

export interface MemeCaptionGuidance {
  pattern: string;
  good_examples: Array<Record<string, string>>;
  bad_examples: Array<Record<string, string>>;
}

export interface MemeRetrievalMetadata {
  /** Schema version for retrieval annotations, independent of manifest version. */
  version: 1;
  joke_shapes: string[];
  positive_hints: string[];
  anti_hints: string[];
}
