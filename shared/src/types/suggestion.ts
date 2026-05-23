export interface TweetContext {
  sentiment: "positive" | "negative" | "neutral";
  tone:
    | "sarcastic"
    | "earnest"
    | "rant"
    | "celebratory"
    | "hot-take"
    | "question"
    | "absurdist"
    | "wholesome";
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
  joke_target: string;
  social_dynamic: string;
  humor_angle: string;
  keywords: string[];
}

export interface SuggestionRequest {
  tweet_text: string;
  limit?: number;
  /**
   * Main compose recommendations should use "global". "user" is reserved for
   * a future saved-memes tab, and "all" is only for explicit experiments.
   */
  source?: "all" | "user" | "global";
  refresh?: boolean;
  mode?: "fast" | "smart";
}

export interface SuggestionResult {
  meme_id: string;
  name: string;
  image_url: string;
  tailored_overlay?: MemeTextOverlay | null;
  use_case_label: string;
  match_explanation: string;
  score: number;
  source: "user" | "global";
  tweet_context?: TweetContext;
  score_breakdown?: {
    similarity: number;
    personalized: number;
    rerank?: number;
    diversity: number;
  };
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
  font?: {
    family: "Impact";
    min_size: number;
    max_size: number;
    stroke_ratio: number;
  };
}
