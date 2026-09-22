# MemeDrop Interview Prep

Use this as a speaking guide when someone asks, “What is MemeDrop and how does it work?” The goal is to sound clear on the product, the architecture, and the tradeoffs.

## 30-Second Pitch

MemeDrop is a local-first Chrome extension that helps people reply on X/Twitter with relevant meme suggestions. When you open a reply composer, the extension reads the tweet context, asks a local Fastify backend for ranked meme suggestions, shows them in an injected panel, and lets you insert or save memes with one click. The backend handles ranking, caption generation, library management, and image serving, while shared TypeScript contracts keep the browser extension and API in sync.

## One-Minute Architecture Overview

The repo is split into three main workspaces:

- `extension/`: Chrome extension UI, content scripts, background worker, popup library
- `backend/`: Fastify API, Drizzle database access, recommendation pipeline, image and library routes
- `shared/`: API contracts, types, and the meme template manifest used by both sides

The extension is the user-facing product. The backend is the intelligence and storage layer. The shared package prevents drift between request/response shapes and meme template metadata.

## End-to-End Flow

### 1. Reply composer opens on X

The content script watches X SPA route changes and detects when the user is in a reply composer. It then extracts the tweet text the user is replying to.

### 2. The extension requests suggestions

The content script sends a `GET_SUGGESTIONS` message to the background worker. The background worker bridges to the backend API at `/api/v1/suggest`.

### 3. The backend ranks memes

The backend analyzes the tweet, finds candidate meme templates, ranks them, adds tailored captions, and returns a list of suggestions with scores and explanations.

### 4. The panel renders

The content script receives suggestions and injects a shadow-DOM panel into X. The panel shows preview cards, explanations, and badges for the meme source and tailored captions.

### 5. User inserts or saves

If the user clicks a meme, the extension attaches the generated image into X’s composer. If the user hovers an image and clicks save, the extension sends the image to the backend, which stores it in the user library and auto-tags it.

## What The Backend Actually Does

The Fastify app is assembled in `backend/src/app.ts` and started from `backend/src/server.ts`. It registers:

- health checks
- suggestion routes
- library routes
- meme image serving
- usage logging
- account/identity helpers

The important public endpoints are:

- `POST /api/v1/suggest` for meme recommendations
- `POST /api/v1/suggest/caption` for a single tailored overlay
- `POST /api/v1/library/save` for saving an image into the user library
- `GET /api/v1/library` for browsing saved memes
- `PUT /api/v1/library/:id` for renaming or tagging
- `DELETE /api/v1/library/:id` for removing a saved meme
- `POST /api/v1/usage` for recording usage and dismissal signals
- `GET /memes/:file` for serving local meme images

## Recommendation Pipeline

The core ranking logic lives in `backend/src/services/suggestion-engine.ts`.

At a high level, the flow is:

1. Load usable meme templates from the curated meme table.
2. Convert the tweet into the kind of context the model can reason about.
3. Ask the model which templates are best fits for the tweet.
4. Fall back to a local heuristic scorer if the model path is unavailable.
5. Generate tailored captions for the selected templates.
6. Return the final suggestions with explanation, score, source, and overlay metadata.

If the model path fails, the backend falls back to a local heuristic path. That matters in an interview because it shows the system is designed to degrade gracefully rather than hard-fail when the AI layer is unavailable.

The most important thing to say is that this is not just “keyword matching.” The pipeline starts with a curated meme catalog, then ranks candidates using meme-aware template knowledge, model selection, and fallback scoring based on the tweet text, meme tags, and template examples. The model is being asked to pick the best meme format, not to invent the meme from scratch.

### How embeddings fit in

Embeddings are stored on meme rows in Postgres as 1536-dimensional vectors. The database schema adds a vector column to both the global `memes` table and the personal `user_memes` table, and the global table has an HNSW index with cosine distance support.

In the current codebase, embeddings are most clearly used in the seed pipeline: each seed meme gets a descriptive natural-language paragraph, that paragraph is embedded through OpenRouter, and the result is stored with the meme row. That means the system can support semantic search or ranking later without re-embedding everything.

So if someone asks “what are embeddings doing here?”, the honest answer is:

- they turn meme descriptions into vectors that are useful for semantic similarity
- they are precomputed and stored in the database
- they make vector search and future retrieval faster
- the current live suggestion path is still mostly template-selection driven, but the data model is ready for embedding-based retrieval

### Important detail

The current suggestion feed only searches the curated global meme table. Saved memes are available in the popup library, but they are intentionally excluded from automatic suggestion ranking for now.

## Extension Flow

The extension has three main jobs:

- detect when the user is composing a reply on X
- render the suggestion panel and handle interactions
- bridge user actions back to the backend through the background worker

The content script in `extension/src/content/content.ts` is responsible for route detection, tweet extraction, and request orchestration. The background worker in `extension/src/background/background.ts` handles caching, backend calls, and converting image URLs into data URLs so X’s CSP does not block rendering.

The suggestion panel in `extension/src/content/suggestion-panel.ts` is injected into a shadow DOM so it stays isolated from X’s styles. It renders meme cards, shows the rationale for each suggestion, and supports dragging or clicking a meme into the composer.

## Save And Library Flow

When a user hovers over an image on X, the extension shows a save button. Saving does this:

1. Capture the image URL from the X page.
2. Send `SAVE_MEME` to the background worker.
3. The backend downloads the image to local storage.
4. The backend auto-tags the image through the vision model.
5. The backend inserts the meme into the `user_memes` table.
6. The popup library can then list, rename, tag, or delete it.

This is a nice point to emphasize in an interview because it demonstrates a full user-generated content loop: discovery, capture, storage, and reuse.

## Data Model

The main tables in the backend database are:

- `users`: minimal user record
- `memes`: curated global meme catalog with tags and embeddings
- `user_memes`: images saved by the user
- `usage_events`: used and dismissed meme events for personalization

The app currently uses a single hard-coded development user ID. Multi-user auth is not fully implemented yet, so if asked about production readiness, be honest about that boundary.

The meme storage model is worth knowing in a little more detail:

- Global memes live in `memes`.
- Saved memes live in `user_memes`.
- Each row stores the local file path, human-readable names, JSON tags, and optional embedding data.
- The actual image files are stored on disk under the backend meme storage directory and served back through the backend's static file route.
- `user_memes.globalMemeId` can link a saved meme back to a global meme, but that relationship is optional.

That means the database is not storing raw image blobs in Postgres. It stores metadata and pointers, while the image files themselves stay on the filesystem.

## AI And Fallbacks

MemeDrop uses OpenRouter for all live AI requests. The backend uses the model layer for tweet analysis, reranking, caption generation, image auto-tagging, and embeddings.

The important engineering point is that the system is not “AI only.” It has fallbacks:

- heuristic tweet context analysis if model analysis fails
- local fallback template selection if remote selection times out
- database fallback paths when embedding/retrieval steps are not available

That makes the app more resilient and easier to demo locally.

## Tradeoffs Worth Mentioning

- It is local-first by design, so the full experience works well on a developer machine.
- The extension/backend split keeps browser concerns separate from recommendation logic.
- Shadow DOM keeps the injected UI from being broken by X’s styles.
- Caching is used in both the extension and backend to keep repeat replies fast.
- Saved memes are intentionally separated from automatic recommendations to keep the first version simpler.

## Good Interview Answers

### “What problem does it solve?”

It reduces the time needed to find a relevant meme reply on X by surfacing context-aware suggestions instead of making the user search manually.

### “Why have both a content script and a background worker?”

The content script is closest to the page and can read reply context, but the background worker is the clean bridge for backend requests, caching, and media handling.

### “Why does the backend return text overlays instead of final images?”

It keeps the backend lightweight and lets the extension render the final PNG in the browser, which is a better fit for the X upload flow and avoids unnecessary server-side image generation.

### “How does the system handle failures?”

It falls back to heuristics, local retrieval, or cached paths instead of depending on a single remote AI call.

### “What would you improve next?”

The most obvious next steps are stronger multi-user support, better personalization from saved memes, and more formal test coverage around the page-injection and recommendation pipeline.

## Likely Deep-Dive Topics

- How the content script detects X SPA navigations
- Why the panel uses shadow DOM
- How tweet context becomes a recommendation query
- How meme templates are chosen and captioned
- How image saving works end to end
- What the current production boundaries are

## Short Demo Script

If you need to walk someone through the project live, say this:

“MemeDrop watches the X reply composer, extracts the tweet context, sends it to a local Fastify backend, and gets back ranked meme suggestions with optional captions. The extension renders those suggestions in an isolated panel and can also save images into a local meme library. The system uses OpenRouter when available, but it falls back gracefully so the app still works locally.”

## Files To Know

- `backend/src/server.ts`: backend startup
- `backend/src/app.ts`: Fastify app wiring and route registration
- `backend/src/services/suggestion-engine.ts`: recommendation pipeline
- `backend/src/routes/suggest.ts`: public suggestion endpoints
- `backend/src/routes/library.ts`: saved meme library endpoints
- `extension/src/content/content.ts`: X composer detection and orchestration
- `extension/src/background/background.ts`: API bridge and media caching
- `extension/src/content/suggestion-panel.ts`: injected suggestion UI
- `extension/src/content/save-button.ts`: save-to-library UI on hovered images
- `shared/src/index.ts`: shared types and template manifest exports

## Final Reminder

If the interviewer asks what makes MemeDrop interesting, the best answer is not “it uses AI.” The stronger answer is that it combines page-aware browser integration, a recommendation backend, local storage, and graceful fallbacks into a practical workflow that actually fits X’s reply UI.