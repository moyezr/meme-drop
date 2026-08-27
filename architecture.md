# MemeDrop architecture

## Boundaries

MemeDrop is one source repository with three deployable runtimes and development-only internal apps.
Turborepo coordinates local and CI tasks; it does not couple their deployments.

```text
apps/landing (static Next.js)        apps/extension (Chrome/React)
        separate Vercel project                |
                                                v
                                      apps/api (FastAPI/Vercel)
                                   /        |       |        \
                           PostgreSQL    Redis  OpenRouter  Supabase S3
                            + pgvector

apps/catalog (local React/Vite) -> development-only catalog API
apps/template-pipeline (local Node CLI) -> sources + OpenRouter + meme-drop-dev
apps/smoke-agent (local TypeScript CLI) -> public HTTPS agent API only
```

| Workspace | Owns |
| --- | --- |
| `apps/api` | HTTP contract, ranking/caption services, persistence, storage, Python tests |
| `apps/catalog` | Local human annotation workflow, visual region editor, quality checklist |
| `apps/template-pipeline` | Development-only template discovery, machine draft annotation, and real-catalog scale fixtures |
| `apps/extension` | X integration, service worker, suggestion UI, popup/library |
| `apps/landing` | Public static marketing pages |
| `apps/smoke-agent` | Black-box public agent API generation, replay, and media verification |
| `packages/shared` | TypeScript contracts and source template manifests |
| `tools/template-tools` | Offline dataset QA, review, benchmarks, and promotion |

### Internal catalog workbench

`apps/catalog` is a dedicated React/Vite human annotation tool backed by the development-only API
and the `catalog_drafts` PostgreSQL table. Its Vite server proxies API and media requests to FastAPI,
so the browser never receives storage credentials. The API ingests validated remote images into the
active development storage backend under `catalog/drafts/`, creates thumbnails, and keeps the full
annotation plus an optimistic revision counter. Draft workflow state is separate from the global
`memes` table and packaged verified catalog, so even a locally approved draft cannot enter
suggestions.

The workbench records visual description, use and anti-use cases, retrieval hints, caption grammar,
examples, and normalized rendering regions. Its Render QA mode uses the same shared canvas renderer
as the extension and reports the actual wrapping, font size, truncation, and overflow for every good
example. Human sign-off stores a server-generated fingerprint of the image, regions, fonts, and
examples; changing any render input makes that evidence stale, and the API rejects local approval
until every region and good example has current visual QA. These labels remain human-owned. Future
AI helpers may propose bounded field values, but they must not save, approve, or promote a template.
Internal routes are not mounted when `MEMEDROP_ENV=production`.

Production catalog transfer is intentionally a release operation: an approved local batch will be
exported as a deterministic, checksummed bundle, verified against QA and suggestion benchmarks,
then applied by a separately authorized script to `meme-drop-prod` and Supabase PostgreSQL. The
runtime never copies development drafts or buckets during startup.

`apps/api` is a standalone uv project so it can be deployed from that directory. The production
backend is FastAPI only; no Fastify runtime remains.

### Agent smoke boundary

`apps/smoke-agent` behaves like an external customer integration even though its source is kept in
the monorepo. It calls only `/live`, `/health`, `POST /api/v1/memes/generate`, and the authenticated
`image_url` returned by that endpoint. It cannot import backend services, query PostgreSQL or Redis,
or read object storage. Before sending a generation that can consume one credit, it requires an
explicit operator confirmation and verifies hosted readiness. It then replays the exact request and
idempotency key and fetches media only when its origin and compact asset path match the configured
API origin. Reports contain IDs, categories, sizes, and timings, never source input or credentials.

## Request and media flow

The extension sends an anonymous install ID in `x-memedrop-install-id`. Production requires it;
development may use a fixed seed identity. This separates libraries and feedback but is not strong
authentication.

Suggestion inference is explicitly user-triggered. X's native Reply action remains untouched and
opens a normal composer without contacting MemeDrop. A separate MemeDrop action is injected into
each timeline post; it transiently captures that post's text/id, forwards to X's native Reply action,
and arms exactly one suggestion request when the composer route opens. Abandoned intent expires and
post text is never persisted by the extension.

The suggestion panel also offers an optional, bounded instruction for users who already have a joke
angle, tone, or template in mind. Automatic suggestions remain the default. The instruction lives
only for the active composer, is hashed into client and server cache identity, and is never included
in logs or usage telemetry. Clearing it creates a distinct automatic request generation so stale
steered media or results cannot replace the automatic response.

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
live in Supabase S3: `meme-drop-dev` for development and `meme-drop-prod` for production. The active
name comes from the required server-side `S3_BUCKET_NAME` variable; the API
proxies `/memes/...` responses with cache headers, so object credentials and bucket topology never
enter the extension.

## Suggestion pipeline

```text
tweet context
  -> deterministic context analysis
  -> optional user direction applied as an untrusted creative preference
  -> cached verified catalog/database candidates + cached feedback (parallel on a cold request)
  -> deterministic rank across the whole catalog
  -> diversified shortlist of at most 12 templates
  -> bounded comedy brief + catalog-owned visual grammar for each shortlisted template
  -> one bounded OpenRouter selection + caption call for at most five results
  -> reviewed template-specific fallback when available
  -> five-or-fewer overlays + feedback context + timings
```

The packaged catalog at `apps/api/src/memedrop_api/data/meme_catalog.json` is generated from the
TypeScript source manifests. It contains aliases, semantic tags, use/anti-use cases, caption rules,
and overlay regions. Generated drafts remain excluded until human review, visual QA, benchmark
coverage, and promotion succeed.

The catalog is the durable quality layer: each template owns its font and stroke treatment,
normalized overlay coordinates, physical text limits, visual joke grammar, reusable joke shapes,
positive and anti-use cases, and contrastive examples. Caption or retrieval behavior should normally
improve through these reviewed labels so catalog additions remain server-side data changes rather
than extension releases.

The API returns at most five user-visible suggestions. The model call has a dedicated 4.5-second
deadline. A failed call opens a short, process-local provider cooldown and immediately uses the local
selection and a reviewed template-specific caption when one exists, rather than retrying on the
user-visible path. The API may return fewer than five results instead of filling model omissions or
fabricating generic fallback text. Catalog candidates
and short-lived per-install feedback scores are cached; concurrent identical requests use
singleflight so one calculation serves all waiters. Raw post text is never logged in production;
request and cache identifiers are logged only as short hashes.

`POST /api/v1/suggest` accepts an optional `steering_instruction` of at most 280 characters. The
original post remains the source of truth for context analysis; steering may influence retrieval,
selection, and captions but cannot change verified-template eligibility, output structure, overlay
regions, or text limits. OpenRouter receives it as JSON-encoded untrusted data. Suggestion feedback
contains only `suggestion_mode: automatic|steered`, which permits outcome comparison without
retaining the instruction.

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
