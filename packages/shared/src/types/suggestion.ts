export interface FeedbackContext {
  sentiment: "positive" | "negative" | "neutral";
  tone:
    | "sarcastic"
    | "earnest"
    | "rant"
    | "celebratory"
    | "hot-take"
    | "question"
    | "absurdist"
    | "wholesome"
    | "self-deprecating";
  topic:
    | "tech"
    | "finance"
    | "politics"
    | "sports"
    | "entertainment"
    | "personal"
    | "culture"
    | "relationships"
    | "other";
  intent:
    | "counter-argument"
    | "agreement"
    | "sharing-opinion"
    | "venting"
    | "asking"
    | "celebrating"
    | "dunking"
    | "self-deprecating";
  intensity: number;
  reply_style: string;
  ideal_meme_vibe: string;
  social_dynamic: string;
  humor_angle: string;
}

export interface TweetContext extends FeedbackContext {
  /** Internal caption-generation detail; never send this with usage telemetry. */
  joke_target: string;
  core_claim: string;
  implied_context: string;
  comedic_tension: string;
  caption_anchors: string[];
  /** Internal source-derived terms; never send this with usage telemetry. */
  keywords: string[];
}

export interface SuggestionRequest {
  tweet_text: string;
  /** At most five user-facing suggestions; retrieval may consider more internally. */
  limit?: 1 | 2 | 3 | 4 | 5;
  refresh?: boolean;
  cache_key?: string;
}

export interface SuggestionResult {
  meme_id: string;
  name: string;
  image_url: string;
  /** A smaller card-preview asset. `image_url` always remains the attachment original. */
  preview_image_url?: string | null;
  tailored_overlay?: MemeTextOverlay | null;
  use_case_label: string;
  match_explanation: string;
  score: number;
  source: "user" | "global";
  feedback_context?: FeedbackContext;
}

export interface MemeTextOverlay {
  enabled: boolean;
  style: "impact";
  template_id?: string;
  alt_text: string;
  regions: MemeTextRegion[];
}

export interface MemeTextRegion {
  id: string;
  text: string;
  /** Defaults to 5.5% of the smaller region dimension. */
  padding_ratio?: number;
  text_transform?: "uppercase" | "mocking" | "none";
  x: number;
  y: number;
  width: number;
  height: number;
  align?: "left" | "center" | "right";
  valign?: "top" | "middle" | "bottom";
  font_scale?: number;
  max_lines?: number;
  max_chars?: number;
  font?: MemeTextFont;
}

/**
 * Typography is catalog-owned rather than model-owned. Defaults preserve the
 * original Impact rendering for older template records.
 */
export interface MemeTextFont {
  family?: "Impact" | "Anton" | "Inter";
  weight?: 400 | 700 | 900;
  min_size?: number;
  max_size?: number;
  fill_color?: string;
  stroke_color?: string;
  stroke_ratio?: number;
  line_height_ratio?: number;
}
