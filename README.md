# MemeDrop

MemeDrop is a Chrome extension that suggests relevant meme replies for X, generates concise overlay
text, accepts optional guidance about the joke direction, and learns from which suggestions people
use or dismiss.

This is a Turborepo monorepo, but its applications deploy independently:

| Path | Responsibility | Deployment |
| --- | --- | --- |
| `apps/api` | FastAPI, recommendation pipeline, PostgreSQL, object storage | Vercel project rooted at `apps/api` |
| `apps/catalog` | React/Vite internal catalog annotation workbench | Local development only |
| `apps/template-pipeline` | Idempotent template discovery, media ingest, and machine draft annotation | Local development only |
| `apps/extension` | React/Vite Chrome extension for X | Chrome Web Store package |
| `apps/web` | Next.js marketing, docs, and customer application | Vercel project rooted at `apps/web` |
| `apps/smoke-agent` | Black-box TypeScript consumer of the public agent API | Local/CI smoke tooling |
| `packages/shared` | TypeScript API contracts and template manifests | workspace dependency |
| `tools/template-tools` | Offline catalog QA and evaluation tools | local/CI tooling |

The landing page and API share source control and Turbo tasks, not a runtime. Each Vercel project
has its own root, build, environment, and deployment.

## Requirements

- Node.js 22.12 or newer
- npm 11 or newer
- Python 3.13 and [uv](https://docs.astral.sh/uv/)
- Docker for local PostgreSQL/pgvector, Redis, and container smoke tests
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

The meme seeder uploads legacy local image files into the configured object store, updates their
database paths, and downloads only verified catalog templates that are still missing. It also
backfills the 480px WebP preview thumbnail for catalog rows that do not have one. It is safe to
rerun; existing catalog objects, rows, and thumbnails are skipped. Migration stops before uploading
if any referenced legacy file is missing. Run `npm run db:seed-memes` as a controlled production
release step after this change to backfill thumbnails for the deployed catalog.

The intentionally small `.env.example` contains only service credentials and deliberate model,
rate-limit-store, and storage selections. Runtime tuning uses safe code defaults and does not need
to be copied into every environment. The example connects to PostgreSQL and Redis in Docker while
using the `meme-drop-dev` Supabase S3 bucket. For fully offline work, change
`MEMEDROP_STORAGE_BACKEND` to `local`; set `MEME_STORAGE_PATH` only if the default temporary storage
directory is not suitable.

Run the applications in separate terminals:

```sh
npm run dev:api
npm run dev:catalog
npm run dev:extension
npm run dev:web
```

FastAPI listens on `http://localhost:3001`; the catalog workbench opens at
`http://localhost:5174`. Load `apps/extension/dist` from
`chrome://extensions` after enabling Developer mode. Normal extension builds always target the
local API, even if a shell has a production `VITE_API_BASE_URL`; only the explicit release build
uses that variable. Development accepts valid unpacked Chrome extension origins automatically;
production still requires the exact published extension origin in `MEMEDROP_CORS_ORIGINS`.

## Common commands

```sh
npm run typecheck             # TypeScript plus mypy through Turbo
npm test                      # root, API, extension, shared, and tooling tests
npm run lint                  # Ruff and workspace lint tasks
npm run build                 # all buildable workspaces
npm run quality:security      # npm graph and locked Python production dependencies
npm run quality:deployment-readiness # local-only repository release-candidate proof
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

Authenticated agent API smoke:

```sh
MEMEDROP_API_BASE_URL=https://api.memedrop.moyezrabbani.dev \
MEMEDROP_API_KEY=<issued-agent-credential> \
npm run smoke:agent -- --confirm-generation
```

The smoke agent calls only public HTTPS routes, repeats the exact generation request to verify
idempotency, and downloads returned private media with the same Bearer credential. Each durable
meme returned by a new run consumes one credit; its replay consumes none. See
`apps/smoke-agent/README.md` for safe custom-input options.

Recommendation and catalog quality:

```sh
npm run quality:benchmark
npm run quality:suggestions
npm run quality:tuning
npm run quality:suggestion-browser # Chromium fixture flow; see QUALITY.md for browser setup
npm run quality:dataset-plan
npm run dataset:taste-review
```

Large-catalog development experiment:

```sh
npm run dataset:scale:scrape -- --limit 1000
npm run dataset:scale:annotate -- --limit 1000
npm run dataset:scale:status
```

The scale pipeline writes only to `meme-drop-dev`, exports machine-generated drafts, and never
bypasses human review, rendered QA, benchmark coverage, or the existing promotion gates. See
`apps/template-pipeline/README.md` for its checkpoint, retry, and evaluation workflow.

See `QUALITY.md` before changing template annotations, benchmarks, ranking, captions, or promotion
data. The deterministic local ranker is the availability and release-quality floor even when model
reranking is enabled.

## Suggestion path

Each X post yields **at most five** user-visible, ready-to-attach replies. The API scores every
verified catalog candidate locally, sends no more than 12 strong and varied candidates to one joint
model call, then asks that call to select up to five and write their captions together. This avoids
paying to caption templates the user will never see. A five-second service budget reserves local
fallback time and gives the model the remaining allowance up to 4.5 seconds. A short provider
cooldown after a failure and deterministic selection/caption fallback keep a provider outage from
blocking the strip.

Catalog and per-install feedback scores are cached; concurrent identical suggestion requests share
one in-flight calculation, and the first candidate and feedback reads run in parallel. Cards use a
small preview thumbnail while the extension prefetches the original image in parallel for attachment.
The response exposes stage durations through `Server-Timing`, while the extension records local
API/media byte durations separately from actually visible captioned previews and native-confirmed
attachment, without retaining post text or captions. Clipboard completion and ordinary closure
are neutral feedback outcomes. See QUALITY.md for the version 2 event and migration contract.

## Object storage

Hosted assets use Supabase Storage through its S3-compatible API. Environments are deliberately
isolated:

| Environment | Required bucket |
| --- | --- |
| development | `meme-drop-dev` |
| production | `meme-drop-prod` |

Set the active bucket explicitly with `S3_BUCKET_NAME`; FastAPI rejects a missing S3 bucket or the
wrong environment pairing on startup. It stores object keys in PostgreSQL and serves media
through `/memes/...`, keeping S3 credentials server-side and the extension's API contract stable.
The API response applies shared-cache headers. `storage:latency` measures a real temporary
upload/read/delete round trip and cleans up the probe object.

Do not put S3 keys in either browser application. Supabase S3 access keys are backend credentials
and must live in ignored env files or the FastAPI project's secret store.

## Deployment

Create two independent Vercel projects from this repository:

1. Web project: Root Directory `apps/web`.
2. API project: Root Directory `apps/api`.

The API workspace owns its Python lockfile, migrations, catalog, and `app.py` entrypoint. Apply
migrations and seed memes as controlled release steps; do not do either during a serverless build.
Load the ignored `.env.prod` file into the FastAPI Vercel project and run the production preflight
before deployment. Production requires managed PostgreSQL, Redis, and Supabase S3:

```sh
npm run quality:production-env
VITE_API_BASE_URL=https://your-api.example npm run release:candidate
```

The extension release build requires an HTTPS API origin and rejects localhost permissions. The
remaining production handoff and manual checks are in `docs/release.md`.

## Documentation

Start coding sessions at [AGENTS.md](AGENTS.md). Read the linked topics for the task at hand;
keep detailed rules in their owning documents.

| Document | Owns |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Short agent entry point, hard constraints, and session workflow |
| [PROGRESS.md](PROGRESS.md) | Latest handoff, verification evidence, blockers, and next action |
| [DECISIONS.md](DECISIONS.md) | Durable choices, rationale, sources, and reconsideration conditions |
| [Development guide](docs/development.md) | Toolchain rules and checks required for each change |
| [Architecture](architecture.md) | Runtime boundaries and recommendation flow |
| [Suggestion contracts](docs/suggestion-contracts.md) | Input, cache, fallback, catalog, and rendering invariants |
| [Quality playbook](QUALITY.md) | Evaluation, template curation, and promotion procedures |
| [Storage and secrets](docs/storage-and-secrets.md) | Environment isolation and credential-handling rules |
| [Launch plan](docs/production-launch-plan.md) | Product backlog, acceptance criteria, and unresolved questions |
| [Release checklist](docs/release.md) | Repository, deployment, and Chrome Web Store gates |
| [Private-beta deployment](docs/private-beta-deployment.md) | End-to-end production setup and beta sequence |
| [Private-beta operations](docs/private-beta-operations.md) | Monitoring, backup/restore, rollback, rotation, and incidents |
| [Release record](docs/private-beta-release-2026-09-06.md) | Dated production verification evidence |
| [Privacy disclosure](PRIVACY.md) | Current data-handling disclosure draft |
| [API README](apps/api/README.md) | FastAPI development, agent API, and Vercel notes |

## License

No license has been selected. Add one before distributing the source as a reusable open-source
project.
