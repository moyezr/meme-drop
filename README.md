# MemeDrop

MemeDrop is a Chrome extension that suggests relevant meme replies for X, generates concise overlay
text, and learns from which suggestions people use or dismiss.

This is a Turborepo monorepo, but its applications deploy independently:

| Path | Responsibility | Deployment |
| --- | --- | --- |
| `apps/api` | FastAPI, recommendation pipeline, PostgreSQL, object storage | Vercel project rooted at `apps/api` |
| `apps/extension` | React/Vite Chrome extension for X | Chrome Web Store package |
| `apps/landing` | Static Next.js marketing site | Vercel project rooted at `apps/landing` |
| `packages/shared` | TypeScript API contracts and template manifests | workspace dependency |
| `tools/template-tools` | Offline catalog QA and evaluation tools | local/CI tooling |

The landing page and API share source control and Turbo tasks, not a runtime. Each Vercel project
has its own root, build, environment, and deployment.

## Requirements

- Node.js 22.12 or newer
- npm 11 or newer
- Python 3.13 and [uv](https://docs.astral.sh/uv/)
- Docker for local PostgreSQL/pgvector and container smoke tests
- Chrome or another Chromium browser
- Optional OpenRouter key; deterministic suggestion and caption fallbacks work without it locally

## Setup

```sh
npm ci
uv sync --project apps/api --frozen
cp .env.example .env
npm run db:up
npm run db:init
npm run db:seed-memes
```

The default `.env.example` uses the `meme-drop-dev` Supabase S3 bucket. For fully offline work,
change `MEMEDROP_STORAGE_BACKEND` to `local`; generated files then live under
`apps/api/data/memes` and stay ignored by Git.

Run the applications in separate terminals:

```sh
npm run dev:api
npm run dev:extension
npm run dev:landing
```

FastAPI listens on `http://localhost:3001`. Load `apps/extension/dist` from
`chrome://extensions` after enabling Developer mode. Set `VITE_API_BASE_URL` in
`apps/extension/.env.local` only when the API is not on the default origin.

## Common commands

```sh
npm run typecheck             # TypeScript plus mypy through Turbo
npm test                      # root, API, extension, shared, and tooling tests
npm run lint                  # Ruff and workspace lint tasks
npm run build                 # all buildable workspaces
npm run quality:security      # npm graph and locked Python production dependencies
npm run release:dry-run       # CI-safe promotion, security, and extension packaging gates
```

API and infrastructure:

```sh
npm run test:api
npm run test:api:integration
npm run quality:api-process
npm run quality:backend-image
npm run db:migrate
npm run storage:check
npm run storage:latency
```

Recommendation and catalog quality:

```sh
npm run quality:benchmark
npm run quality:suggestions
npm run quality:dataset-plan
npm run dataset:taste-review
```

See `QUALITY.md` before changing template annotations, benchmarks, ranking, captions, or promotion
data. The deterministic local ranker is the availability and release-quality floor even when model
reranking is enabled.

## Object storage

Hosted assets use Supabase Storage through its S3-compatible API. Environments are deliberately
isolated:

| Environment | Required bucket |
| --- | --- |
| development | `meme-drop-dev` |
| production | `meme-drop-prod` |

FastAPI validates this pairing on startup. It stores object keys in PostgreSQL and serves media
through `/memes/...`, keeping S3 credentials server-side and the extension's API contract stable.
The API response applies shared-cache headers. `storage:latency` measures a real temporary
upload/read/delete round trip and cleans up the probe object.

Do not put S3 keys in either browser application. Supabase S3 access keys are backend credentials
and must live in ignored env files or the FastAPI project's secret store.

## Deployment

Create two independent Vercel projects from this repository:

1. Landing project: Root Directory `apps/landing`.
2. API project: Root Directory `apps/api`.

The API workspace owns its Python lockfile, migrations, catalog, and `app.py` entrypoint. Apply
migrations and seed memes as controlled release steps; do not do either during a serverless build.
Use `.env.production.example` as the configuration schema, replace every placeholder, and run the
production preflight before deployment:

```sh
npm run quality:production-env
VITE_API_BASE_URL=https://your-api.example npm run release:candidate
```

The extension release build requires an HTTPS API origin and rejects localhost permissions. The
remaining production handoff and manual checks are in `docs/release.md`.

## Documentation

- `architecture.md`: runtime boundaries and recommendation evolution
- `QUALITY.md`: evaluation, template curation, and security gates
- `docs/release.md`: deployment and Chrome Web Store checklist
- `PRIVACY.md`: current data-handling disclosure draft
- `apps/api/README.md`: FastAPI development and Vercel notes
- `AGENTS.md`: durable repository rules for future coding sessions

## License

No license has been selected. Add one before distributing the source as a reusable open-source
project.
