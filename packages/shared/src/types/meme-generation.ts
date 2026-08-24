/** Optional creative controls for callers that want to steer the result. */
export interface MemeGenerateOptions {
  direction?: string;
  count?: 1 | 2 | 3 | 4 | 5;
}

/** Minimal public input for an agent requesting a finished meme. */
export interface MemeGenerateRequest {
  input: string;
  options?: MemeGenerateOptions;
}

/** A durable generated image. The URL requires the caller's Bearer credential. */
export interface GeneratedMeme {
  id: string;
  image_url: string;
  expires_at: string;
}

export interface MemeGenerateResponse {
  status: "ok" | "no_fit";
  memes: GeneratedMeme[];
}
