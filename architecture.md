• Mental Model
  MemeDrop is a Chrome extension backed by a local recommendation API.

  X page
    -> Chrome extension content script
    -> Extension background service worker
    -> Fastify backend on localhost:3001
    -> Postgres + pgvector
    -> OpenRouter APIs

  Popup library
    -> Fastify backend
    -> Local meme image storage + Postgres

  The repository has three npm workspaces:

  ┌────────────┬──────────────────────────────────────────────────────────────────────┐
  │ Package    │ Responsibility                                                       │
  ├────────────┼──────────────────────────────────────────────────────────────────────┤
  │ extension/ │ X integration, injected suggestion panel, save button, popup library │
  │ backend/   │ API, recommendation pipeline, OpenRouter calls, database access      │
  │ shared/    │ Shared contracts and meme text-overlay template data                 │
  └────────────┴──────────────────────────────────────────────────────────────────────┘

  Backend Surface
  The Fastify server starts in backend/src/server.ts:15.

  ┌──────────────────────────────┬──────────────────────────────────────┐
  │ Endpoint                     │ Purpose                              │
  ├──────────────────────────────┼──────────────────────────────────────┤
  │ GET /health                  │ Verify database connectivity         │
  │ POST /api/v1/suggest         │ Generate meme recommendations        │
  │ POST /api/v1/suggest/caption │ Generate a caption for one meme      │
  │ POST /api/v1/library/save    │ Save and AI-tag an image             │
  │ GET /api/v1/library          │ List saved memes                     │
  │ PUT /api/v1/library/:id      │ Rename or tag a saved meme           │
  │ DELETE /api/v1/library/:id   │ Delete a saved meme                  │
  │ POST /api/v1/usage           │ Record used or dismissed suggestions │
  │ GET /memes/:file             │ Serve locally stored image files     │
  └──────────────────────────────┴──────────────────────────────────────┘

  Suggestion Flow
  When a user opens an X reply composer:

  Reply composer opens
    -> content script extracts original tweet text
    -> GET_SUGGESTIONS Chrome message
    -> background worker calls POST /api/v1/suggest
    -> backend returns ranked memes and optional text overlays
    -> panel displays previews
    -> user clicks or drags a meme
    -> extension attaches a PNG through X's hidden file input
    -> usage event is recorded

  The content script detects X SPA route changes and extracts the tweet being replied to in extension/src/content/
  content.ts:311. It sends the request to the background worker at extension/src/content/content.ts:400.

  The background worker is the HTTP bridge. It calls POST /api/v1/suggest, caches results for five minutes, and converts
  backend images into data URLs because X page CSP can block injected localhost images: extension/src/background/
  background.ts:169.

  Recommendation Pipeline
  The core ranking logic is in backend/src/services/suggestion-engine.ts:98.

  Tweet text
    -> OpenRouter tweet analysis
    -> structured TweetContext
    -> natural-language tweet descriptor
    -> OpenRouter embedding
    -> pgvector nearest-neighbor search
    -> deterministic scoring + preference adjustments
    -> OpenRouter LLM reranking
    -> MMR diversity pass
    -> tailored caption generation
    -> suggestion response

  The structured context includes tone, intent, topic, joke target, social dynamic, keywords, and humor angle. If
  OpenRouter analysis fails, a heuristic analyzer is used: backend/src/services/context-analyzer.ts:72.

  The descriptor becomes a 1536-dimensional embedding using OpenRouter: backend/src/services/embedding.ts:8.

  Postgres uses pgvector cosine distance to retrieve relevant memes: backend/src/services/retrieval.ts:36. If embeddings
  fail or exceed the timeout, the backend uses a cheaper database-order fallback.

  After retrieval:

  1. Taxonomy rules add boosts and mismatch penalties.
  2. Usage history adds small preference boosts and recent-repeat penalties.
  3. OpenRouter reranks likely candidates for comedic fit.
  4. MMR removes near-duplicate recommendations.
  5. The top candidates receive tailored overlay captions.

  Caption Rendering
  The backend does not generate final image files for recommendations. It returns text plus normalized layout regions:

  {
    text: "THE DEPLOYMENT IS FINE",
    x: 0.05,
    y: 0.05,
    width: 0.9,
    height: 0.2
  }

  Caption generation lives in backend/src/services/meme-text.ts:63. Template geometry comes from the shared manifest.

  The extension draws Impact-style text onto a canvas and converts the result into a PNG data URL: extension/src/
  content/suggestion-panel.ts:535. It then attaches the PNG through X's upload input.

  Save And Library Flow
  Hovering over an image on X displays a save button: extension/src/content/save-button.ts:75.

  User saves X image
    -> SAVE_MEME message
    -> POST /api/v1/library/save
    -> backend downloads image to backend/data/memes
    -> OpenRouter vision auto-tags image
    -> backend builds meme descriptor
    -> row inserted into user_memes
    -> saved meme appears in popup library

  The backend implementation is in backend/src/routes/library.ts:14. The popup loads and manages saved memes in
  extension/src/popup/pages/Library.tsx:53.

  Saved memes can be dragged from the popup into an X composer.

  Database Model
  The Drizzle schema is in backend/src/db/schema.ts:13.

  ┌──────────────┬────────────────────────────────────────────────────────┐
  │ Table        │ Purpose                                                │
  ├──────────────┼────────────────────────────────────────────────────────┤
  │ users        │ Minimal user record                                    │
  │ memes        │ Curated global meme catalogue with tags and embeddings │
  │ user_memes   │ Images saved by the user                               │
  │ usage_events │ Used and dismissed meme events for personalization     │
  └──────────────┴────────────────────────────────────────────────────────┘

  The app currently uses one hard-coded development user ID. Authentication and real multi-user support are not
  implemented.

  Important Current Boundary
  The recommendation feed currently searches only the curated global memes table:

  userLimit: 0,
  globalLimit: 60,
  source: "global"

  See backend/src/services/suggestion-engine.ts:133.

  Saved memes live in user_memes and are usable from the popup, but they are intentionally excluded from automatic
  suggestions for now.

  OpenRouter Usage
  All live AI requests now use OpenRouter:

  ┌─────────────────────┬──────────────────────────────────────────────────┐
  │ Task                │ Model path                                       │
  ├─────────────────────┼──────────────────────────────────────────────────┤
  │ Tweet analysis      │ qwen/qwen3.6-plus                                │
  │ Meme reranking      │ qwen/qwen3.6-plus                                │
  │ Caption generation  │ qwen/qwen3.6-plus                                │
  │ Vision auto-tagging │ qwen/qwen3.6-plus                                │
  │ Embeddings          │ openai/text-embedding-3-small through OpenRouter │
  └─────────────────────┴──────────────────────────────────────────────────┘

  Provider configuration is centralized in backend/src/services/llm-provider.ts:3.
