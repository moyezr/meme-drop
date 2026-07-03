export interface Candidate {
  meme_id: string;
  source: "user" | "global";
  name: string;
  image_url: string;
  system_tags: {
    emotion?: string;
    use_cases?: string[];
    example_contexts?: string[];
    vibes?: string[];
  };
  is_evergreen: boolean;
}
