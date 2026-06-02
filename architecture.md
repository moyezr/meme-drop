# MemeDrop Architecture

MemeDrop is a Chrome extension plus local Fastify backend that suggests meme replies for X posts. The repository is an npm workspace with three packages:

- `extension/`: Chrome extension UI, X content scripts, background worker, popup library.
- `backend/`: Fastify API, Postgres/pgvector access, OpenRouter integration, caption generation, seed scripts.
- `shared/`: TypeScript contracts and meme template manifests used by both backend and extension.

## High-Level Flow

```text
X reply composer
  -> extension content script extracts tweet text
  -> extension background calls POST /api/v1/suggest
  -> backend analyzes tweet, retrieves/ranks curated global memes, generates overlays
  -> extension renders suggestion panel
  -> user clicks/drags meme into composer
  -> backend logs usage for personalization
```

## Suggestion Request Flow

The content script in `extension/src/content/content.ts` detects an active X composer and extracts the source tweet text. It sends a `GET_SUGGESTIONS` message with `{ tweet_text, limit, source, mode }` to the background worker.

The background worker in `extension/src/background/background.ts` calls `POST /api/v1/suggest`. It caches results by normalized tweet text, source, limit, and mode. The main compose experience requests `{ source: "global", mode: "smart" }`, which means recommendations come only from the curated global catalogue and favor quality over the previous fast heuristic-only path.

## Backend Suggestion Pipeline

`backend/src/routes/suggest.ts` validates the request and calls `getSuggestions()` in `backend/src/services/suggestion-engine.ts`.

The pipeline is:

1. Analyze the tweet into `TweetContext`.
   - `smart` mode calls the LLM analyzer.
   - `fast` mode uses `heuristicTweetContext()`.
   - The context includes not only tone/topic/intent, but also `joke_target`, `social_dynamic`, and `humor_angle` so ranking can optimize for the comedic move.
2. Build a natural-language tweet descriptor.
3. Generate an `openai/text-embedding-3-small` embedding through OpenRouter.
4. Retrieve meme candidates from Postgres using pgvector similarity. The main compose flow uses global memes only.
5. Apply taxonomy aliases, keyword overlap, social-dynamic matching, canonical meme-family boosts, and mismatch penalties for over-generic templates.
6. Optionally rerank with an LLM in `smart` mode. The reranker is a helper, not the dominant signal; deterministic humor-shape scoring carries more weight.
7. Apply MMR diversity so the strip is not all near-duplicates.
8. Generate tailored text overlays for templates that support captions.

If embeddings fail or time out, the backend falls back to a database ordering path and still applies deterministic scoring.

## Meme Data Model

Global seed memes live in the `memes` table. User-saved memes live in `user_memes`. Both store:

- image path
- format type
- `system_tags` such as emotion, use cases, example contexts, and vibes
- embedding vector

Seed data is curated in `backend/src/db/seed-memes.ts`; descriptors are built by `backend/src/services/descriptor.ts` before embedding.

Saved memes are intentionally not part of the main recommendation engine right now. The lower-level `/suggest` API can still accept `source: "user"` for future work, but the production compose path sends `source: "global"`. A later suggestion-panel tab can use the user source without contaminating the curated recommendation/caption benchmark.

## Caption Overlay Flow

`backend/src/services/meme-text.ts` finds a matching template from `shared/src/data/*template*`. Templates define text regions, roles, character limits, and examples.

Captions are generated through OpenRouter. The backend sanitizes text, enforces region limits, rejects generic or repeated fallback captions, and returns `tailored_overlay` metadata. The extension renders the final meme image client-side from the base image plus overlay regions.

## Saving And Personalization

When a user saves a meme, `POST /api/v1/library/save` downloads the image, tags it with the vision auto-tagger, stores it locally under `backend/data/memes`, embeds it, and inserts it into `user_memes`. This powers the library and future saved-meme suggestion tab, not the main recommendation feed.

When a user uses or dismisses a suggestion, `POST /api/v1/usage` records the event. `personalization.ts` uses recent `used` events to boost preferred emotions/use cases and penalize recently repeated memes.

## Evaluation

Suggestion quality is benchmarked with:

```bash
npm run eval:suggestions --workspace=backend -- --mode smart --limit 5
npm run eval:suggestions --workspace=backend -- --mode smart --limit 5 --judge
```

Cases live in `backend/evals/suggestion-benchmark.json`. The benchmark covers multiple social moves such as coping, predictable consequences, rebrand nonsense, self-owning, celebration, lowball offers, waiting, suspicion, and stubborn refusal. It reports top-k expected meme hits, caption quality checks, saved/user-source leakage, and optional LLM-judged quality.
