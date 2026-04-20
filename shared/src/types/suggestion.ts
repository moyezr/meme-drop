export interface TweetContext {
  sentiment: "positive" | "negative" | "neutral";
  tone:
    | "sarcastic"
    | "earnest"
    | "rant"
    | "celebratory"
    | "hot-take"
    | "question";
  topic:
    | "tech"
    | "finance"
    | "politics"
    | "sports"
    | "entertainment"
    | "personal"
    | "culture";
  intent:
    | "counter-argument"
    | "agreement"
    | "sharing-opinion"
    | "venting"
    | "asking";
  intensity: number;
}

export interface SuggestionRequest {
  tweet_text: string;
}

export interface SuggestionResult {
  meme_id: string;
  name: string;
  image_url: string;
  use_case_label: string;
  match_explanation: string;
  score: number;
}
