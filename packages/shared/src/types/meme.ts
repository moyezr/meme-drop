export type Emotion =
  | "sarcastic"
  | "absurdist"
  | "wholesome"
  | "savage"
  | "confused"
  | "celebratory";

export type FormatType = "reaction_image" | "text_overlay";

export type UseCase =
  | "counter_argument"
  | "agreement"
  | "self_deprecation"
  | "dunking"
  | "relatability"
  | "confusion";

export interface SystemTags {
  emotion: Emotion;
  use_cases: UseCase[];
  example_contexts: string[];
}

export interface Meme {
  id: string;
  name: string;
  file_path: string;
  format_type: FormatType;
  is_evergreen: boolean;
  system_tags: SystemTags;
  embedding?: number[];
  source_url: string | null;
  created_at: string;
}

export interface UserMeme {
  id: string;
  user_id: string;
  global_meme_id: string | null;
  file_path: string;
  user_name: string;
  user_tags: string[];
  system_tags: SystemTags;
  embedding?: number[];
  use_count: number;
  last_used_at: string | null;
  created_at: string;
}
