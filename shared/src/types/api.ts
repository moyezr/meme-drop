import type { SuggestionRequest, SuggestionResult, TweetContext } from "./suggestion.js";
import type { Meme, UserMeme } from "./meme.js";

// POST /api/v1/suggest
export interface SuggestRequest {
  Body: SuggestionRequest;
}
export interface SuggestResponse {
  suggestions: SuggestionResult[];
}

// POST /api/v1/usage
export interface UsageRequest {
  Body: {
    meme_id: string;
    action: "suggested" | "used" | "dismissed";
    tweet_context: TweetContext;
  };
}

// POST /api/v1/library/save
export interface LibrarySaveRequest {
  Body: {
    image_url: string;
    source_tweet_id?: string;
  };
}
export interface LibrarySaveResponse {
  meme: UserMeme;
}

// GET /api/v1/library
export interface LibraryListQuery {
  search?: string;
  tag?: string;
  format?: string;
  sort?: "recent" | "most_used" | "alphabetical";
  page?: number;
}
export interface LibraryListResponse {
  memes: UserMeme[];
  total: number;
  page: number;
}

// PUT /api/v1/library/:id
export interface LibraryUpdateRequest {
  Body: {
    user_name?: string;
    user_tags?: string[];
  };
  Params: { id: string };
}

// DELETE /api/v1/library/:id
export interface LibraryDeleteRequest {
  Params: { id: string };
}

// GET /api/v1/memes/browse
export interface MemesBrowseQuery {
  format?: string;
  emotion?: string;
  search?: string;
}
export interface MemesBrowseResponse {
  memes: Meme[];
}
