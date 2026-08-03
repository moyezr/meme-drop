# MemeDrop FastAPI

This workspace is the production backend replacement for the legacy Fastify service. During the
migration it preserves the existing HTTP paths, response field casing, PostgreSQL tables, pgvector
columns, install identity semantics, and extension-facing error contract.

## Implemented

- process liveness and PostgreSQL readiness
- request IDs, safe errors, CORS, static meme media, and rate limiting
- install identity creation and enforcement
- global meme browsing
- saved-meme download, SSRF protection, vision tagging, listing, editing, and deletion
- usage feedback validation and persistence
- account data export and deletion

The suggestion and caption pipeline remains on the compatibility backend until its benchmark and
fallback behavior has been ported.

## Development

From the repository root:

```sh
uv sync --all-packages
npm run dev:api
npm run lint:api
npm run test:api
uv run --package memedrop-api mypy apps/api/src apps/api/tests
```

The default test suite uses in-memory collaborators for deterministic HTTP tests. The repository
integration suite runs against PostgreSQL and pgvector:

```sh
npm run db:up
MEMEDROP_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/memedrop \
  npm run test:api:integration
```

Integration records use generated IDs and are removed after each run.
