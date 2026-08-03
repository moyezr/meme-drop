# MemeDrop architecture

## Migration status

FastAPI under `apps/api/` is the production backend. It implements the complete extension-facing
HTTP surface, including suggestions and tailored captions. Root development, database, build,
container, and release commands all target FastAPI. The retired Fastify source remains temporarily
only while its TypeScript catalog and evaluation tools are reorganized.

New backend runtime work belongs in FastAPI. The legacy server must not gain new features.

## System map

```text
X reply composer                         Extension popup
       |                                       |
       +---- Chrome extension service worker --+
                              |
                         FastAPI :3001
                         /       |       \
                   PostgreSQL  OpenRouter  Supabase Storage
                    + pgvector
```

The monorepo is organized by deployable app and reusable package:

| Path | Responsibility |
| --- | --- |
| `apps/api/` | FastAPI HTTP API, services, persistence, and Python tests |
| `apps/extension/` | X integration, background worker, injected panel, and popup |
| `apps/landing/` | Public Next.js landing page |
| `packages/shared/` | TypeScript API contracts and source template data |
| `tools/template-tools/` | Offline TypeScript catalog QA, benchmark, and promotion tools |

## HTTP surface

FastAPI preserves the extension's existing `/api/v1` JSON contract and camelCase response fields.

| Endpoint | Purpose |
| --- | --- |
| `GET /health/live` | Process liveness |
| `GET /health` and `GET /health/ready` | PostgreSQL readiness |
| `GET /api/v1/memes` | Browse the global meme catalog |
| `POST /api/v1/suggest` | Rank templates and generate contextual overlays |
| `POST /api/v1/suggest/caption` | Generate an overlay for one meme |
| `POST /api/v1/library/save` | Download, validate, store, and AI-tag an image |
| `GET /api/v1/library` | Search and sort saved memes |
| `PUT /api/v1/library/{id}` | Rename or tag a saved meme |
| `DELETE /api/v1/library/{id}` | Delete a saved meme and local image |
| `POST /api/v1/usage` | Record shown, used, and dismissed feedback |
| `GET /api/v1/account/export` | Export saved memes and usage history |
| `DELETE /api/v1/account` | Delete an install's data |
| `GET /memes/{file}` | Serve stored meme media |

Install identity is carried in `x-memedrop-install-id`. Development can use the configured default
identity; production can require the header. Rate limiting supports in-memory local operation and a
PostgreSQL-backed mode for multiple API replicas.

## Suggestion path

```text
tweet text
  -> deterministic context analysis
  -> match database memes to verified catalog templates
  -> local semantic ranking (always available)
  -> optional OpenRouter structured template selection
  -> one batched OpenRouter caption request
  -> contextual deterministic caption fallback
  -> overlay regions + structured tweet context
```

The language-neutral catalog is generated at
`apps/api/src/memedrop_api/data/meme_catalog.json`. It records each
template's aliases, use cases, anti-use cases, semantic tags, caption grammar, and layout regions.
FastAPI loads verified curated and promoted templates by default; generated drafts remain opt-in.

The local ranker is the availability fallback and the quality baseline. Its benchmark test enforces
minimum expected-family retrieval rates at top 3 and top 5. A model can reorder candidates, but an
unavailable or malformed model response cannot make the endpoint fail. Caption generation is batched
to keep latency bounded and every supported template has a deterministic contextual fallback.

Suggestions return `tweet_context` with the recommendation. The extension sends that context back in
usage events so future ranking changes can learn from shown, dismissed, and used outcomes without
storing raw tweet text in logs. Recommendation cache keys and application logs hash or redact tweet
content.

## Library path

Saving a meme follows this sequence:

```text
source image URL
  -> reject private/loopback hosts and unsafe redirects
  -> stream with byte and timeout limits
  -> verify image content type and decoded dimensions
  -> persist under configured meme storage
  -> optional OpenRouter vision tags
  -> insert user_memes row
```

Saved memes are available in the popup library but are not yet mixed into automatic suggestions.
This separation avoids surfacing a private or low-quality saved image before personalized retrieval
has explicit quality controls.

## Persistence

SQLAlchemy models preserve the existing PostgreSQL tables so the runtime can change without a data
migration: `users`, `memes`, `user_memes`, `usage_events`, and `rate_limits`. pgvector columns remain
available for learned/embedding retrieval work.

Repository methods form the boundary between API/service tests and PostgreSQL. The default suite uses
deterministic in-memory collaborators; the integration marker runs the same repository against a real
PostgreSQL instance with pgvector.

## Recommendation evolution

Recommendation changes should improve measured relevance without sacrificing latency or fallback
behavior. The intended progression is:

1. Preserve reliable structured usage events and request context.
2. Establish offline benchmark gates for retrieval, diversity, captions, and latency.
3. Derive per-template and per-context outcome features from shown/used/dismissed events.
4. Introduce a versioned learned reranker behind the existing local candidate generator.
5. Compare model versions offline, then in an observable rollout with an immediate fallback.

This keeps the HTTP API stable while allowing the ranking implementation to evolve independently.

## Testing boundaries

- Unit tests cover configuration, identity, context analysis, catalog lookup, captions, ranking,
  downloads, vision responses, rate limiting, and repository-independent services.
- HTTP tests cover every route, validation contract, failure response, and ownership boundary.
- PostgreSQL integration tests exercise every repository data feature and pgvector-compatible schema.
- The extension retains TypeScript contract and UI tests; release smoke tests will target the FastAPI
  process and container once deployment migration is complete.
