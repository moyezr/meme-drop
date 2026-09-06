# Production release

This is the operational checklist for the independently deployed web app, FastAPI service, and
Chrome extension. `npm run release:dry-run` proves the repository can build and package; it does not
prove that external services, domains, credentials, or store metadata are ready.

## 1. Repository gates

From a clean checkout:

```sh
npm ci
uv sync --project apps/api --frozen
MEMEDROP_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/memedrop_readiness \
MEMEDROP_TEST_REDIS_URL=redis://localhost:6379/0 \
  npm run quality:deployment-readiness
```

`quality:deployment-readiness` is the single repository-owned release-candidate gate. It accepts
only loopback PostgreSQL and Redis test URLs, requires a disposable database name containing
`test`, `integration`, or `readiness`, suppresses product-provider and storage credentials,
and composes static analysis, deterministic tests, all workspace builds, the built API smoke, the
blocking benchmark, suggestion, rendering, and dataset-plan tuning gates, the full Alembic and
data-service integration gate, the backend image smoke, and locked dependency security audits. The
static build is reused by the API process smoke instead of rebuilding it.

This command does not provision infrastructure, call Tavily or OpenRouter, validate production
secrets, deploy, inspect hosted services, or validate extension-store metadata. `release:candidate`
remains the operator-facing packaging and final production-configuration gate; `launch:status`
tracks hosted, legal, domain, and store-launch inputs. CI runs the deterministic constituent gates
in parallel jobs and provides a fresh empty pgvector database for the integration job.

`quality:security` has no standing exceptions. Any npm or Python advisory fails the gate and must be
resolved before release.

## 2. Supabase

Production uses managed PostgreSQL/pgvector and Redis from `DATABASE_URL` and `REDIS_URL`. Create two
Supabase Storage buckets manually:

- development: `meme-drop-dev`
- production: `meme-drop-prod`

Do not let application startup create, rename, empty, or delete buckets. Generate separate
server-side S3 access credentials where practical. S3 credentials bypass normal browser/user access
controls and must never be put in `VITE_*`, Next.js public variables, extension code, logs, or Git.

Validate development access:

```sh
MEMEDROP_ENV=development S3_BUCKET_NAME=meme-drop-dev npm run storage:check
MEMEDROP_ENV=development S3_BUCKET_NAME=meme-drop-dev npm run storage:latency
```

Run the same commands with the production environment loaded and `meme-drop-prod`. The latency probe
writes, reads, and deletes one temporary `_health/` object; confirm cleanup in the bucket afterward.
Record results from a machine or function in the intended deployment region.

Apply production database changes as a controlled operation using the real environment:

```sh
npm run db:migrate
npm run db:seed-memes
```

Do not run migrations or seed downloads during a Vercel build or function startup.

For Vercel runtime traffic, `DATABASE_URL` should be Supabase's transaction pooler URL (normally
`pooler.supabase.com:6543`), not the direct `db.<project>.supabase.co:5432` endpoint. FastAPI disables
psycopg automatic prepared statements on port 6543 because Supavisor transaction mode does not
support them. Use a direct or session-pooler connection for controlled migrations when the operator
network supports it.

## 3. Vercel projects

Import this GitHub repository twice.

Web project:

- Root Directory: `apps/web`
- Framework: Next.js
- Build Command: leave at the Next.js default (`npm run build`)
- Output Directory: leave unset/default so Vercel publishes the server-rendered `.next/` output
- Server-only environment: Auth.js secret/provider credentials, `MEMEDROP_API_BASE_URL`, and the
  dashboard bridge token secret; never copy database, Redis, OpenRouter, or S3 credentials here

Do not override the Output Directory with `out`. Auth.js and the same-origin dashboard bridge need
Next.js server routes. `MEMEDROP_DASHBOARD_TOKEN_SECRET` must contain 32–512 characters and match
the API deployment exactly. Keep it and `MEMEDROP_API_BASE_URL` server-only; neither may use a
`NEXT_PUBLIC_` prefix. OAuth callback URLs end in `/api/auth/callback/github` or
`/api/auth/callback/google` on the production web origin. The Vercel production build validates
these values, requires at least one complete OAuth provider pair, and accepts only
`https://api.memedrop.moyezrabbani.dev` as the dashboard API origin; local builds do not require
deployed secrets.

API project:

- Root Directory: `apps/api`
- Framework: FastAPI/Python
- Entry point: `app.py`
- Python: 3.13 from `.python-version`
- Environment: load the ignored `.env.prod` values into Vercel's production secret store

At minimum the API needs the managed PostgreSQL and Redis URLs, OpenRouter key/model settings, the
production web CORS origin, Redis rate limiting, required install IDs, compact/redacted logs, and the
production Supabase S3 endpoint/region/key pair with
`S3_BUCKET_NAME=meme-drop-prod`. It also needs the same
`MEMEDROP_DASHBOARD_TOKEN_SECRET` configured in the web project. `.env.example` is for local
development; keep the production source in the ignored `.env.prod` operator file and synchronize
it one-way into deployment secret stores. Add the final Chrome extension origin only for the later
Web Store release.

Before deploying with those values loaded:

```sh
npm run quality:production-env
```

After an API/web private-beta deploy, verify `GET /live`, `GET /health`, the black-box agent flow,
authenticated media, idempotent replay, one-credit settlement, dashboard overview, API-key
issue/revoke, and request IDs. Check Vercel function duration and memory during model timeouts and
image operations. The landing project and API project do not share runtime code or environment
merely because they come from one repository. Legacy suggestion, library, usage, and browser-account
checks belong to the extension release below.

## 4. Extension release

Create a Chrome Web Store draft to obtain the final 32-character extension ID, then append its
origin to the web origin already allowed by the API:

```text
MEMEDROP_CORS_ORIGINS=https://memedrop.moyezrabbani.dev,chrome-extension://<published-extension-id>
VITE_API_BASE_URL=https://<production-api-origin>
```

Prepare real listing metadata:

```sh
npm run store-listing:init -- \
  --privacy-policy-url https://memedrop.moyezrabbani.dev/privacy-policy/ \
  --support-email moyezrabbani.work@gmail.com
```

Add at least two real PNG/JPEG screenshots under `apps/extension/store-assets`; at least one must be
`1280x800`. Host the final policy and make provider and retention disclosures match production
settings.

Build and validate the exact artifact submitted to Chrome:

```sh
VITE_API_BASE_URL=https://api.memedrop.moyezrabbani.dev npm run release:candidate
npm run launch:status
```

Chrome Web Store submission remains deferred until developer-account enrollment succeeds and the
store provides the final extension ID. For an API/web private beta before then, configure
`MEMEDROP_CORS_ORIGINS=https://memedrop.moyezrabbani.dev`; append the exact published extension
origin only after it exists.

The strict candidate checks production API configuration, store metadata/assets, suggestion quality,
CORS, privacy placeholders, and the packaged zip. Bump the extension package and manifest versions
together before a new submission.

## 5. Extension production QA

- Install the packaged extension, not a development build.
- On `x.com`, verify suggestions, refresh, caption generation, click insertion, and drag/drop.
- Exercise model timeout/failure and confirm local suggestions/captions still work.
- Save, edit, load, and delete a meme; confirm the object is in `meme-drop-prod`, not the dev bucket.
- Confirm shown/clicked/used/saved/dismissed outcomes are recorded for the correct install.
- Confirm account export and deletion do not reveal or delete another install's records.
- Inspect logs: no raw tweet text, secrets, signed object URLs, or full request bodies.
- Measure warm and cold suggestion latency plus storage round-trip latency from production.
- Confirm the public landing page, hosted privacy page, support contact, and API all use HTTPS.

Run this section only when preparing the Chrome extension track. Anonymous install IDs are isolation
keys, not authentication; broader extension distribution requires an explicit risk decision plus
abuse monitoring, or a real account/session model.

## Current release boundaries

The API/web private-beta prerequisites are complete: managed persistence and storage, production
domains, OAuth and dashboard bridging, migrations and the 49-template verified catalog, QStash trend
refresh, health and cleanup monitoring, backup/restore, credential rotation, rollback, log-safety
review, and a charged black-box generation have all been exercised against production. Paid
checkout is disabled; beta credits remain operator-granted. Inviting and onboarding the first small
tester group is the next operator step and is intentionally outside this checklist.

The later Chrome/public/paid tracks still require the final Web Store extension ID and CORS origin,
listing screenshots and manual X QA, measured unit economics and pricing, payment/refund approval,
provider-retention review, broader metrics and abuse controls, content/licensing procedures, and
public self-service policy decisions. A fresh `Dockerfile.backend` build is required only if a
container deployment becomes a release target; the current private beta runs on Vercel's Python
runtime.
