# MemeDrop repository guide

## Product and architecture

MemeDrop is a Chrome extension that suggests and captions meme replies for X. This repository is a
Turborepo monorepo with three independently deployable applications:

- `apps/api/`: FastAPI, SQLAlchemy, Alembic, PostgreSQL/pgvector, Supabase S3 storage, and pytest.
- `apps/extension/`: React, Vite, Tailwind, and CRXJS Chrome extension.
- `apps/landing/`: statically exported Next.js landing page, deployed as its own Vercel project.
- `packages/shared/`: TypeScript contracts and the source meme-template manifests.
- `tools/template-tools/`: offline catalog QA, benchmark, review, and promotion tools.

The FastAPI workspace is deliberately self-contained. It owns `pyproject.toml`, `uv.lock`,
`.python-version`, `alembic.ini`, migrations, `app.py`, runtime catalog data, and tests so Vercel can
build it with `apps/api` as the project root. Do not add a second backend or move Python metadata to
the repository root.

## Tooling

- Node.js 22.12+ and npm 11 manage the workspace and Turbo 2.x orchestration.
- Python 3.13 and uv manage only `apps/api`.
- Keep dependencies locked exactly. Update npm with `npm install` and Python with
  `uv lock --project apps/api --upgrade`.
- TypeScript is 7.x except in `apps/landing`, which stays on 6.x until stable Next.js supports the
  TypeScript 7 compiler API. `@types/node` stays on major 22 to match production Node.
- Prefer direct, readable code. Do not introduce abstractions without a current second use case;
  localized `Any`/`any` is acceptable when it makes an untyped boundary clearer.

## Essential commands

```sh
npm ci
uv sync --project apps/api --frozen
npm run dev:api
npm run dev:extension
npm run dev:landing
npm run typecheck
npm test
npm run lint
npm run build
npm run release:dry-run
```

For API changes, also run `npm run test:api`, `npm run lint:api`, and
`npm run quality:api-process`. For persistence changes, start PostgreSQL with `npm run db:up` and
run the integration suite with `MEMEDROP_TEST_DATABASE_URL` set. Run
`npm run quality:backend-image` for container-related changes.

## Recommendation quality

Suggestion quality and latency are the product priorities. Preserve the local deterministic ranker
as a fallback, keep external-model calls bounded, and return only verified templates by default.
Changes to ranking, captions, catalog annotations, or feedback must include focused tests and pass:

```sh
npm run quality:benchmark
npm run quality:suggestions
npm run quality:dataset-plan
```

Do not promote generated templates directly. Use the review and benchmark workflow documented in
`QUALITY.md`. Usage events (`shown`, `clicked`, `used`, `saved`, `dismissed`) are learning signals;
do not log raw tweet text in production.

## Storage and environment isolation

Meme assets use Supabase's S3-compatible API in hosted environments:

- development: `meme-drop-dev`
- production: `meme-drop-prod`

Configuration rejects the wrong bucket for the active environment, and production rejects local
storage. Never auto-create, empty, or delete either bucket. Never expose S3 access keys to the
extension or landing page. Validate access with `npm run storage:check`; use
`npm run storage:latency` only when a temporary write/read/delete probe is intended.

Keep secrets in ignored `.env` files or deployment secret stores. Update `.env.example` and
`.env.production.example` when configuration changes, using placeholders only.

## Tests, docs, and commits

Add tests at the closest boundary: pytest for API/service behavior, Node tests for shared/tooling,
and extension tests for browser-facing logic. Test failures must not be hidden with broad skips.

Keep only durable documentation. Update `README.md`, `architecture.md`, `QUALITY.md`,
`docs/release.md`, and this file when their contracts change. App-specific detail belongs in the
app's README.

Use concise imperative commits and commit only a working, coherent change. Do not stage unrelated
or untracked user files. Before pushing a dependency or release change, run
`npm run quality:security`; its reviewed exceptions are exact and time-limited, not a blanket audit
waiver.
