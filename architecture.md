# MemeDrop Architecture

MemeDrop is a Chrome extension plus local Fastify backend that suggests meme replies for X posts. The repository is an npm workspace with three packages:

- `extension/`: Chrome extension UI, X content scripts, background worker, popup library.
- `backend/`: Fastify API, Postgres/pgvector access, OpenAI/DeepSeek integration, caption generation, seed scripts.
- `shared/`: TypeScript contracts and meme template manifests used by both backend and extension.

## High-Level Flow

```text
X reply composer
  -> extension content script extracts tweet text
  -> extension background calls POST /api/v1/suggest
  -> backend analyzes tweet, retrieves/ranks memes, generates overlays
  -> extension renders suggestion panel
  -> user clicks/drags meme into composer
  -> backend logs usage for personalization
```

## Suggestion Request Flow

The content script in `extension/src/content/content.ts` detects an active X composer and extracts the source tweet text. It sends a `GET_SUGGESTIONS` message with `{ tweet_text, limit, source, mode }` to the background worker.

The background worker in `extension/src/background/background.ts` calls `POST /api/v1/suggest`. It caches results by normalized tweet text, source, limit, and mode. The extension now requests `smart` mode by default, which favors quality over the previous fast heuristic-only path.

## Backend Suggestion Pipeline

`backend/src/routes/suggest.ts` validates the request and calls `getSuggestions()` in `backend/src/services/suggestion-engine.ts`.

The pipeline is:

1. Analyze the tweet into `TweetContext`.
   - `smart` mode calls the LLM analyzer.
   - `fast` mode uses `heuristicTweetContext()`.
2. Build a natural-language tweet descriptor.
3. Generate a `text-embedding-3-small` embedding.
4. Retrieve user and global meme candidates from Postgres using pgvector similarity.
5. Apply personalization, taxonomy aliases, keyword overlap, and canonical meme boosts.
6. Optionally rerank with an LLM in `smart` mode.
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

## Caption Overlay Flow

`backend/src/services/meme-text.ts` finds a matching template from `shared/src/data/*template*`. Templates define text regions, roles, character limits, and examples.

Captions are generated in batches with OpenAI by default, or DeepSeek if configured. The backend sanitizes text, enforces region limits, rejects generic or repeated fallback captions, and returns `tailored_overlay` metadata. The extension renders the final meme image client-side from the base image plus overlay regions.

## Saving And Personalization

When a user saves a meme, `POST /api/v1/library/save` downloads the image, tags it with the vision auto-tagger, stores it locally under `backend/data/memes`, embeds it, and inserts it into `user_memes`.

When a user uses or dismisses a suggestion, `POST /api/v1/usage` records the event. `personalization.ts` uses recent `used` events to boost preferred emotions/use cases and penalize recently repeated memes.

## Evaluation

Suggestion quality is benchmarked with:

```bash
npm run eval:suggestions --workspace=backend -- --mode smart --limit 5
npm run eval:suggestions --workspace=backend -- --mode smart --limit 5 --judge
```

Cases live in `backend/evals/suggestion-benchmark.json`. The benchmark reports top-k expected meme hits, caption quality checks, and optional LLM-judged quality.
