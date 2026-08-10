# Production release

This is the operational checklist for the independently deployed landing page, FastAPI service, and
Chrome extension. `npm run release:dry-run` proves the repository can build and package; it does not
prove that external services, domains, credentials, or store metadata are ready.

## 1. Repository gates

From a clean checkout:

```sh
npm ci
uv sync --project apps/api --frozen
npm run release:dry-run
npm run quality:backend-image
```

CI runs the same release dry-run and Docker smoke. `quality:security` permits only the exact,
time-limited dependency risks described in `QUALITY.md`; review them again before their 2026-09-01
expiry.

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

Landing project:

- Root Directory: `apps/landing`
- Framework: Next.js
- Build Command: leave at the Next.js default (`npm run build`)
- Output Directory: leave unset/default; `next.config.ts` enables static export and Vercel detects
  `out/` automatically
- Secrets: none from the backend; never copy API/S3 credentials here

Do not override the Output Directory with `out`. The Next.js preset needs its build metadata from
`.next/` and publishes the static `out/` export automatically. The checked-in landing
`vercel.json` explicitly keeps automatic output detection enabled.

API project:

- Root Directory: `apps/api`
- Framework: FastAPI/Python
- Entry point: `app.py`
- Python: 3.13 from `.python-version`
- Environment: load the ignored `.env.prod` values into Vercel's production secret store

At minimum the API needs the managed PostgreSQL and Redis URLs, OpenRouter key/model settings, final
Chrome extension CORS origin, Redis rate limiting, required install IDs, compact/redacted logs, and
the production Supabase S3 endpoint/region/key pair with
`S3_BUCKET_NAME=meme-drop-prod`.

Before deploying with those values loaded:

```sh
npm run quality:production-env
```

After deploy, verify `GET /live`, `GET /health`, one suggestion request, media loading through
`/memes/...`, a library save/delete, account export/delete isolation, and request IDs. Check Vercel
function duration and memory during model timeouts and image operations. The landing project and API
project do not share runtime code or environment merely because they come from one repository.

## 4. Extension release

Create a Chrome Web Store draft to obtain the final 32-character extension ID, then set:

```text
MEMEDROP_CORS_ORIGINS=chrome-extension://<published-extension-id>
VITE_API_BASE_URL=https://<production-api-origin>
```

Prepare real listing metadata:

```sh
npm run store-listing:init -- \
  --privacy-policy-url https://<public-site>/privacy \
  --support-email <real-support-email>
```

Add at least two real PNG/JPEG screenshots under `apps/extension/store-assets`; at least one must be
`1280x800`. Replace the privacy-policy contact placeholder, host the final policy, and make provider
and retention disclosures match production settings.

Build and validate the exact artifact submitted to Chrome:

```sh
VITE_API_BASE_URL=https://<production-api-origin> npm run release:candidate
npm run launch:status
```

The strict candidate checks production API configuration, store metadata/assets, suggestion quality,
CORS, privacy placeholders, and the packaged zip. Bump the extension package and manifest versions
together before a new submission.

## 5. Manual production QA

- Install the packaged extension, not a development build.
- On `x.com`, verify suggestions, refresh, caption generation, click insertion, and drag/drop.
- Exercise model timeout/failure and confirm local suggestions/captions still work.
- Save, edit, load, and delete a meme; confirm the object is in `meme-drop-prod`, not the dev bucket.
- Confirm shown/clicked/used/saved/dismissed outcomes are recorded for the correct install.
- Confirm account export and deletion do not reveal or delete another install's records.
- Inspect logs: no raw tweet text, secrets, signed object URLs, or full request bodies.
- Measure warm and cold suggestion latency plus storage round-trip latency from production.
- Confirm the public landing page, hosted privacy page, support contact, and API all use HTTPS.

Start with private/unlisted testers. Anonymous install IDs are isolation keys, not authentication;
broader launch requires an explicit risk decision plus abuse monitoring, or a real account/session
model.

## Current external blockers

The repository gates pass, but release remains blocked until all of these are supplied and tested:

- a usable S3 secret and successful live checks for both Supabase buckets;
- successful managed PostgreSQL and Redis connectivity plus the production migration/seed;
- the final API origin and final Chrome Web Store extension ID/CORS origin;
- a real privacy/support contact, hosted policy URL, verified provider log retention, listing copy,
  and screenshots;
- end-to-end latency and behavior checks in the chosen Vercel/Supabase regions;
- explicit acceptance or replacement of anonymous install identity for the intended launch audience.
