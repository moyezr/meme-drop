# MemeDrop architecture

## Boundaries

MemeDrop is one source repository with three independent runtimes. Turborepo coordinates local and
CI tasks; it does not couple their deployments.

```text
apps/landing (static Next.js)        apps/extension (Chrome/React)
        separate Vercel project                |
                                                v
                                      apps/api (FastAPI/Vercel)
                                   /        |       |        \
                           PostgreSQL    Redis  OpenRouter  Supabase S3
                            + pgvector
```

| Workspace | Owns |
| --- | --- |
| `apps/api` | HTTP contract, ranking/caption services, persistence, storage, Python tests |
| `apps/extension` | X integration, service worker, suggestion UI, popup/library |
| `apps/landing` | Public static marketing pages |
| `packages/shared` | TypeScript contracts and source template manifests |
| `tools/template-tools` | Offline dataset QA, review, benchmarks, and promotion |

`apps/api` is a standalone uv project so it can be deployed from that directory. The production
backend is FastAPI only; no Fastify runtime remains.

## Request and media flow

The extension sends an anonymous install ID in `x-memedrop-install-id`. Production requires it;
development may use a fixed seed identity. This separates libraries and feedback but is not strong
authentication.

Suggestion inference is explicitly user-triggered. X's native Reply action remains untouched and
opens a normal composer without contacting MemeDrop. A separate MemeDrop action is injected into
each timeline post; it transiently captures that post's text/id, forwards to X's native Reply action,
and arms exactly one suggestion request when the composer route opens. Abandoned intent expires and
post text is never persisted by the extension.

FastAPI preserves camelCase `/api/v1` responses for the extension:

| Endpoint | Purpose |
| --- | --- |
| `GET /live` | process liveness |
| `GET /health`, `GET /health/ready` | database-backed readiness |
| `GET /api/v1/memes` | browse the global catalog |
| `POST /api/v1/suggest` | rank templates and produce overlays |
| `POST /api/v1/suggest/caption` | caption one selected template |
| `POST /api/v1/library/save` | validate, tag, and save a remote image |
| `GET /api/v1/library` | list/search saved memes |
| `PUT`, `DELETE /api/v1/library/{id}` | update or remove a saved meme |
| `POST /api/v1/usage` | record recommendation outcomes |
| `GET /api/v1/account/export` | export install-scoped data |
| `DELETE /api/v1/account` | delete install-scoped data and media |
| `GET /memes/{path}` | serve local or S3-backed media |

Saving an image rejects local/private network targets and unsafe redirects, streams within time and
size limits, validates decoded image content, then stores the asset and database row. Hosted assets
live in Supabase S3: `meme-drop-dev` for development and `meme-drop-prod` for production. The API
proxies `/memes/...` responses with cache headers, so object credentials and bucket topology never
enter the extension.

## Suggestion pipeline

```text
tweet context
  -> deterministic context analysis
  -> cached verified catalog/database candidates + cached feedback (parallel on a cold request)
  -> deterministic rank across the whole catalog
  -> diversified shortlist of at most 12 templates
  -> bounded comedy brief + catalog-owned visual grammar for each shortlisted template
  -> one bounded OpenRouter selection + caption call for at most five results
  -> deterministic contextual caption fallback
  -> five-or-fewer overlays + feedback context + timings
```

The packaged catalog at `apps/api/src/memedrop_api/data/meme_catalog.json` is generated from the
TypeScript source manifests. It contains aliases, semantic tags, use/anti-use cases, caption rules,
and overlay regions. Generated drafts remain excluded until human review, visual QA, benchmark
coverage, and promotion succeed.

The API returns at most five user-visible suggestions. The model call has a dedicated 2.5-second
deadline. A failed call opens a short, process-local provider cooldown and immediately uses the local
selection and contextual captions, rather than retrying on the user-visible path. Catalog candidates
and short-lived per-install feedback scores are cached; concurrent identical requests use
singleflight so one calculation serves all waiters. Raw post text is never logged in production;
request and cache identifiers are logged only as short hashes.

### Local ranker and scale boundary

Retrieval is catalog-owned rather than a generic embedding lookup. Each verified template declares
joke shapes plus positive and anti-use hints. A prebuilt BM25 index scores positive and anti signals
separately; a domain-neutral mechanic classifier maps paired language concepts onto those reviewed
joke shapes. New templates therefore inherit retrieval behavior from their metadata without adding
template IDs to ranking code. The ranker combines those signals with structural cues, bounded
feedback adjustment, and an evergreen preference. It retains only a small top-relevance pool with a
heap, then softly diversifies joke shapes before the 12-template shortlist. This is `O(N log k)` for
a bounded `k`, not a linear sort of the full catalog.

The offline evaluator runs the production ranker against a synthetic catalog of 5,000 distinct
templates and fails when warm p95 ranking exceeds 50ms. pgvector remains available for future
retrieval experiments and feedback joins; it is not a synchronous dependency of the current hot path.

### Media and timing

Catalog seeding creates a 480px WebP thumbnail at `catalog/thumbnails/<template-id>.webp`. Suggestion
cards fetch that preview and the original attachment asset concurrently; previews can render before
the full file is ready, while attachment always uses the original. Rerun `npm run db:seed-memes` as a
controlled production release step to backfill thumbnails for existing catalog rows.

The suggestion response emits non-sensitive `Server-Timing` stages for candidate load, local rank,
joint model/fallback, response assembly, and total duration. The extension additionally measures API
response, first/all preview readiness, all-originals ready-to-attach, and aggregate media failures
and settlement locally. Media fetches have a 2.5-second deadline and can be retried on attachment.
These diagnostics contain durations and counts only, never post text, captions, URLs, or template
IDs. Text-only extension cache keys are SHA-256 hashes, and request generations prevent an older
same-post response from overwriting a refresh.

## Learning loop

Suggestion responses contain a bounded, categorical `feedback_context`. The extension returns it
with outcome events: shown, clicked, used, saved, and dismissed. Source-derived targets and keywords
remain server-internal for captioning and are never persisted as feedback. PostgreSQL therefore
retains enough aggregate context to evaluate template performance without raw post storage or
request logging.

Improvement should remain incremental and measurable:

1. Maintain a human-reviewed golden benchmark with acceptable and rejected meme families.
2. Measure top-k relevance, rejection avoidance, caption specificity/layout, diversity, and stage
   latency for every ranking change.
3. Aggregate outcome rates by template and structured context only after enough impressions.
4. Add versioned retrieval/reranking features behind the current candidate generator.
5. Compare versions offline, then roll out observably with an immediate local fallback.

PostgreSQL plus pgvector is appropriate while the catalog is modest and feedback joins matter. A
separate vector database is justified only after measured retrieval latency or scale requires it;
today external inference is the more likely latency bottleneck.

## Persistence and operations

SQLAlchemy owns `users`, `memes`, `user_memes`, and `usage_events`; Alembic owns schema changes.
Redis provides atomic, expiring rate-limit counters shared across FastAPI instances. Development
runs PostgreSQL and Redis in Docker; production uses managed services through `DATABASE_URL` and
`REDIS_URL`.
Migrations and catalog seeding are controlled release operations, never import-time or build-time
side effects.

Configuration enforces production invariants including S3 storage, the production bucket, explicit
CORS, install IDs, and OpenRouter credentials. `/live` does not require PostgreSQL; readiness does.
Request IDs are echoed for diagnostics. Suggestion logs record only operational metadata and never
raw tweet text.

## Verification boundaries

- API unit/HTTP tests cover every route, configuration, storage behavior, ranking/caption fallback,
  download safety, identity, rate limiting, and data ownership boundary.
- Marked integration tests run repositories against real PostgreSQL/pgvector.
- Shared/tool tests verify contracts, catalog integrity, benchmark quality, and promotion policy.
- Extension tests verify API mapping and browser-facing logic.
- Release checks build all workspaces, start the FastAPI wheel, smoke the Docker image, audit locked
  dependencies, validate the extension manifest, and package the Chrome artifact.
