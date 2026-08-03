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
- catalog-backed template ranking with benchmarked local fallback
- optional OpenRouter template selection and batched caption generation
- deterministic contextual overlays for model outages

FastAPI has route parity and is the runtime used by root development, build, database, container,
and deployment commands.

## Development

From the repository root:

```sh
uv sync --all-packages
npm run dev:api
npm run lint:api
npm run test:api
uv run --package memedrop-api mypy apps/api/src apps/api/tests
npm run catalog:export
npm run db:init
npm run db:seed-memes
npm run quality:api-process
```

Meme files use Supabase's S3-compatible API. Development is pinned to `meme-drop-dev` and
production to `meme-drop-prod`; configuration rejects a bucket from the wrong environment. Keep
S3 credentials server-side. Validate access without writing, or measure the full object round trip:

```sh
uv run --package memedrop-api memedrop-storage-check
uv run --package memedrop-api memedrop-storage-check --latency
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

The suggestion tests also run the offline benchmark at
`tools/template-tools/evals/suggestion-benchmark.json`. They enforce a minimum relevance floor for the local
ranker, which remains available when OpenRouter is not configured or temporarily fails.
