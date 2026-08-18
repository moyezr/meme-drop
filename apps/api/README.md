# MemeDrop FastAPI

This workspace is the production MemeDrop backend. It preserves the established HTTP paths,
response field casing, PostgreSQL tables, pgvector
columns, install identity semantics, and extension-facing error contract.

## Implemented

- process liveness and PostgreSQL readiness
- request IDs, safe errors, CORS, object-backed meme media, and rate limiting
- install identity creation and enforcement
- global meme browsing
- saved-meme download, SSRF protection, vision tagging, listing, editing, and deletion
- usage feedback validation and persistence
- account data export and deletion
- catalog-owned, benchmarked ranking across every verified template
- optional, bounded user guidance for the joke direction, tone, or template
- one optional OpenRouter selection-and-caption call over a 12-template shortlist
- deterministic contextual overlays for model outages
- five-result response cap, cached candidates/feedback, and singleflight request sharing
- preview-thumbnail/original-attachment media path and `Server-Timing` diagnostics

FastAPI has route parity and is the runtime used by root development, build, database, container,
and deployment commands.

Runtime OpenRouter models are independently configurable: `OPENROUTER_SUGGESTION_MODEL` for the
interactive joint call, `OPENROUTER_CAPTION_MODEL` for the explicit caption endpoint, and
`OPENROUTER_AUTO_TAG_MODEL` for saved-image vision tagging. Offline catalog generation separately
uses `OPENROUTER_TEMPLATE_MODEL`; the API runtime does not read it.

## Development

From the repository root:

```sh
npm install
npm run dev:api
npm run lint:api
npm run test:api
npm run typecheck --workspace=@memedrop/api
npm run catalog:export
npm run db:init
npm run db:seed-memes
npm run quality:api-process
```

For human catalog authoring, apply migrations, run `npm run dev:api` and `npm run dev:catalog` from
the repository root, then visit `http://localhost:5174`. Draft annotations live in local PostgreSQL;
source images and thumbnails use the configured storage backend. Configure the Supabase S3 API with the
`meme-drop-dev` bucket for the normal shared development workflow. Workbench approval is not a
runtime or production promotion.

`db:seed-memes` first migrates legacy local `/memes/...` files into the active S3 bucket under
`catalog/legacy/`, then inserts any missing verified catalog templates. It creates a 480px WebP
thumbnail under `catalog/thumbnails/` and backfills rows lacking `thumbnail_path` on rerun. Database
path updates are transactional, source files are retained after S3 upload, and reruns skip migrated
rows and existing thumbnails. It validates every referenced legacy file before the first upload so
missing data cannot be silently ignored. Rerun this command as a controlled production release step
to backfill existing catalog previews.

Machine-generated scale drafts can be prefilled into the local human-review catalog without copying
their source media. The importer is development-only, requires `meme-drop-dev`, dry-runs by default,
and protects every existing catalog row from overwrite:

```sh
uv run --project apps/api memedrop-catalog-import
uv run --project apps/api memedrop-catalog-import --write
```

The default input is `.memedrop/template-pipeline/manifest.json`. Imported records remain drafts,
retain their model/source provenance, and start without visual QA evidence.

Meme files use Supabase's S3-compatible API. Set `S3_BUCKET_NAME` explicitly to `meme-drop-dev` in
development and `meme-drop-prod` in production; configuration rejects a missing S3 bucket or a
bucket from the wrong environment. Keep
S3 credentials server-side. Validate access without writing, or measure the full object round trip:

```sh
npm run storage:check
npm run storage:latency
```

The latency probe writes a small `_health/` object and removes it before returning JSON timings.
Set `MEMEDROP_STORAGE_BACKEND=local` only for offline development or tests.

The default test suite uses in-memory collaborators for deterministic HTTP tests. The repository
integration suite runs against PostgreSQL and pgvector:

```sh
npm run db:up
MEMEDROP_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/memedrop \
  npm run test:api:integration
```

Integration records use generated IDs and are removed after each run.

Development rate limits use the Redis service in `docker-compose.yml`. Production requires a
managed `REDIS_URL`; the in-memory store is only for isolated tests/offline work. Test both local
data services with:

```sh
MEMEDROP_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/memedrop \
MEMEDROP_TEST_REDIS_URL=redis://localhost:6379/0 npm run test:api:integration
```

On Vercel, use Supabase's transaction pooler URL on port 6543 for `DATABASE_URL`. The database layer
automatically disables psycopg prepared statements for transaction-pooler connections. A direct
Supabase URL is intended for IPv6-capable persistent clients or controlled database operations, not
the serverless runtime.

The suggestion tests also run the offline benchmark at
`tools/template-tools/evals/suggestion-benchmark.json`. They enforce a minimum relevance floor for the local
ranker, which remains available when OpenRouter is not configured or temporarily fails. The evaluator
requires at least 70% top-1, 80% top-3, and 90% top-5 acceptable-family retrieval, while keeping
rejected-family intrusion at or below 15%. It also checks warm p95 local ranking at a 5,000-template
catalog is no slower than 50ms.

`POST /api/v1/suggest` always returns at most five results. The service scores the full verified
catalog locally, diversifies a 12-template shortlist, and makes at most one joint OpenRouter request
to select and caption the user-visible results. That request has a 4.5-second deadline; failure opens
a short per-process cooldown and returns deterministic selection/captions without a retry. Candidate
and feedback reads run in parallel when cold, caches avoid repeat reads, and singleflight merges
concurrent identical requests. `Server-Timing` reports non-sensitive stage durations; clients should
use thumbnail URLs for fast card rendering and prefetch the original image for attachment.

The request may include `steering_instruction` as a trimmed 1-280 character creative preference.
The service keeps source-post context analysis separate, hashes steering into cache identity, and
passes it to OpenRouter as untrusted JSON data. It is not returned, persisted, or logged. Safe
feedback contains only `suggestion_mode` so automatic and steered outcome rates can be compared.

The same request includes the already-computed comedy brief plus each template's visual grammar,
joke shapes, ordered region roles, physical text limits, and contrastive examples. It asks the model
to turn a specific post anchor into a new implication or reframe. No extra inference step is added,
and incomplete or overlong model overlays fall back locally instead of rendering a clipped joke.

## Vercel

Create a dedicated Vercel project with Root Directory set to `apps/api`. The app has its own
`pyproject.toml`, `uv.lock`, Python version, catalog data, migrations, and recognized `app.py`
entrypoint. Configure production environment variables from the ignored root `.env.prod` in the
project dashboard, then run `npm run db:migrate` and `npm run db:seed-memes` as controlled release
steps rather than during a serverless build.
