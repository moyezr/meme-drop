# MemeDrop private-beta deployment

This is the executable production sequence for the current MemeDrop architecture. The landing page,
FastAPI service, and Chrome extension are independent deployments. Begin with private or unlisted
testers: anonymous install IDs isolate browser data but are not strong user authentication.

The shorter release contract and manual QA checklist remain in [`docs/release.md`](release.md).

## 1. Prepare one release commit

Merge the reviewed feature branch into the branch used by Vercel, normally `main`. From a clean
checkout of that exact commit:

```sh
npm ci
uv sync --project apps/api --frozen
npm run release:dry-run
npm run quality:backend-image
```

Do not package or deploy from a working tree containing unrelated local changes.

## 2. Provision production infrastructure

Create these resources in nearby regions where possible:

- a managed PostgreSQL database with pgvector;
- a manually created Supabase Storage bucket named exactly `meme-drop-prod`;
- server-side Supabase S3 credentials for that bucket;
- managed Redis with a `rediss://` connection URL;
- an OpenRouter production key;
- two Vercel projects and stable HTTPS origins for the public site and API;
- a Chrome Web Store developer account.

Use Supabase's transaction-pooler URL, normally port `6543`, as the Vercel `DATABASE_URL`. Use a
direct or session-pooler connection for controlled migrations. Never put database, Redis, OpenRouter,
or S3 credentials in the landing page, extension, or any `VITE_*` variable.

## 3. Create the Vercel projects

Import the repository twice.

Landing project:

- Root Directory: `apps/landing`
- Framework: Next.js
- Build Command: leave at the Next.js default (`npm run build`)
- Output Directory: leave unset/default; `next.config.ts` enables static export and Vercel detects
  `out/` automatically
- Backend secrets: none

Do not set the Vercel Output Directory to `out`. With the Next.js framework preset, that override
causes Vercel to look for `out/routes-manifest.json`, even though Next.js correctly writes the
framework manifest to `.next/routes-manifest.json`. The repository's `apps/landing/vercel.json`
keeps automatic output detection enabled.

API project:

- Root Directory: `apps/api`
- Framework: FastAPI/Python
- Entry point: `app.py`
- Python: 3.13 from `.python-version`
- Environment: production secrets from the ignored `.env.prod`

Attach the final domains before packaging the extension. The current public site is
`https://memedrop.moyezrabbani.dev`; deploy the API on a separate origin such as
`https://api.memedrop.moyezrabbani.dev` or its Vercel production URL.

`VITE_API_BASE_URL` must use that API origin. Do not set it to the landing-page origin unless the
landing project is explicitly configured to proxy every API route to FastAPI; the two projects in
this repository do not do that.

## 4. Bootstrap the Chrome extension ID

The extension needs the final API origin, while the API CORS configuration needs the final Chrome
extension ID. Once the API origin is reserved, build a preliminary package:

```sh
VITE_API_BASE_URL=https://<production-api-origin> npm run build:extension:release
npm run package:extension:release
```

Create a Chrome Web Store draft and upload the package to obtain the final 32-character extension
ID. Then configure the API with:

```text
MEMEDROP_CORS_ORIGINS=chrome-extension://<final-extension-id>
```

## 5. Configure and validate the API environment

Supply real production values through `.env.prod` locally and Vercel's production secret store:

```text
MEMEDROP_ENV=production
DATABASE_URL=<supabase-transaction-pooler-url>

OPENROUTER_API_KEY=<production-key>
OPENROUTER_SITE_URL=https://<production-api-origin>
OPENROUTER_APP_NAME=MemeDrop
OPENROUTER_SUGGESTION_MODEL=openai/gpt-5.4-mini
OPENROUTER_CAPTION_MODEL=openai/gpt-5.4-mini
OPENROUTER_AUTO_TAG_MODEL=qwen/qwen3.6-plus

MEMEDROP_CORS_ORIGINS=chrome-extension://<final-extension-id>
MEMEDROP_RATE_LIMIT_STORE=redis
REDIS_URL=<managed-rediss-url>
MEMEDROP_REQUIRE_INSTALL_ID=true
MEMEDROP_USE_DRAFT_TEMPLATES=false

MEMEDROP_STORAGE_BACKEND=s3
S3_BUCKET_NAME=meme-drop-prod
S3_ENDPOINT=<supabase-s3-endpoint>
S3_REGION=<region>
S3_ACCESS_KEY_ID=<server-access-key>
S3_SECRET_ACCESS_KEY=<server-secret-key>

MEMEDROP_RATE_LIMIT_WINDOW_MS=60000
MEMEDROP_RATE_LIMIT_MAX=600
MEMEDROP_EXPENSIVE_RATE_LIMIT_WINDOW_MS=60000
MEMEDROP_EXPENSIVE_RATE_LIMIT_MAX=180
MEMEDROP_IMAGE_DOWNLOAD_TIMEOUT_MS=10000
MEMEDROP_MAX_IMAGE_BYTES=8388608
```

The API also recognizes Vercel's system-provided `VERCEL_ENV=production` when `MEMEDROP_ENV` is
absent, but setting `MEMEDROP_ENV=production` explicitly keeps local preflight and hosted runtime
configuration identical. Ensure **Automatically expose System Environment Variables** remains
enabled in the Vercel project.

With those variables loaded into an operator shell:

```sh
npm run quality:production-env
npm run storage:check
npm run storage:latency
```

The latency probe writes, reads, and deletes one temporary `_health/` object. Confirm cleanup in the
bucket afterward.

## 6. Apply database changes and seed the catalog

Use a direct or session-pooler database connection for this controlled operation:

```sh
npm run db:migrate
npm run db:seed-memes
```

Do not run either operation during a Vercel build or function startup. Confirm that the schema and
pgvector extension exist, meme rows were created, original images and thumbnails are in
`meme-drop-prod`, and nothing was written to `meme-drop-dev`.

## 7. Publish the site and privacy policy

Before Chrome submission:

- replace every placeholder in `PRIVACY.md`, including the contact email;
- confirm provider and data-retention disclosures;
- publish the policy at a stable HTTPS route such as `/privacy`;
- configure a real support email;
- deploy the landing project and verify the policy without authentication.

The repository currently contains the policy document but still needs a hosted landing-page privacy
route for launch.

## 8. Deploy and verify the API

Deploy the API project from the release commit after its production environment passes validation.
Then verify:

```sh
curl -fsS https://<production-api-origin>/live
curl -fsS https://<production-api-origin>/health

curl -X POST https://<production-api-origin>/api/v1/suggest \
  -H 'Content-Type: application/json' \
  -H 'X-MemeDrop-Install-Id: <uuid-v4>' \
  -d '{"tweet_text":"We skipped every test and deployed Friday. What could go wrong?","limit":5}'
```

Also confirm meme media loads through `/memes/...`, `Server-Timing` is present, model timeout uses
the deterministic fallback, library save/delete works, usage events are written, and logs contain no
raw post text, captions, secrets, signed URLs, or request bodies.

## 9. Prepare the final store listing and artifact

Create real listing metadata:

```sh
npm run store-listing:init -- \
  --privacy-policy-url https://<public-site>/privacy \
  --support-email <real-support-email>
```

Add at least two real PNG/JPEG screenshots under `apps/extension/store-assets`; at least one must be
`1280x800`. Keep `apps/extension/package.json` and `apps/extension/manifest.json` versions identical.

With the production environment loaded, build and validate the exact submission artifact:

```sh
VITE_API_BASE_URL=https://<production-api-origin> npm run release:candidate
npm run launch:status
```

Do not submit until `launch:status` has no blockers. Install and manually test the packaged artifact,
not a development build.

## 10. Release privately and observe

Publish as private or unlisted and invite a small group first. Verify on `x.com`:

- X's native Reply opens without calling MemeDrop;
- the separate MemeDrop reply button opens the native composer and requests suggestions once;
- refresh, caption preview, click insertion, and drag/drop work;
- model failure still returns local suggestions;
- saved media goes only to `meme-drop-prod`;
- shown, clicked, used, saved, and dismissed events belong to the correct install.

Monitor suggestion latency, timeouts, OpenRouter cost, Redis and PostgreSQL errors, storage failures,
Vercel duration/memory, dismiss-all frequency, and actual meme usage. Keep Vercel rollback and the
previous Chrome package available during the beta.
