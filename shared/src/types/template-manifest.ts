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
  font: {
    family: "Impact";
    min_size: number;
    max_size: number;
    stroke_ratio: number;
  };
  notes?: string;
}

export interface MemeCaptionGuidance {
  pattern: string;
  good_examples: Array<Record<string, string>>;
  bad_examples: Array<Record<string, string>>;
}
