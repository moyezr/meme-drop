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
`OPENROUTER_AUTO_TAG_MODEL` for saved-image vision tagging. Offline trend enrichment uses
`OPENROUTER_TREND_MODEL`; offline catalog generation separately uses `OPENROUTER_TEMPLATE_MODEL`,
which the API runtime does not read.

## Trend memory

Trend collection is an offline refresh job; the request path never calls Tavily. The collector has
a hard application cap of 900 Tavily credits per calendar month, with claims and local credit
reservations coordinated in PostgreSQL. Before it reserves a search credit, each refresh validates
the Tavily credential through its non-search usage endpoint and includes the provider-reported key
usage separately in its operator output. PostgreSQL is the lifecycle-aware source of truth for
normalized trend cards and evidence metadata. A successful refresh publishes an immutable snapshot
and switches the versioned Redis serving index only after the new namespace is complete. A refresh
where every claimed query fails exits non-zero and leaves the prior PostgreSQL snapshot and Redis
pointer unchanged.

Suggestion and standalone-caption requests derive bounded structured lookup context locally. A
short OpenRouter query-embedding request supplements the Redis signal index with at most 12
pgvector candidates, restricted to the configured embedding model and exact card versions in the
latest published snapshot. Lifecycle, vitality, semantic distance, and lexical fit rerank the
combined candidates. At most two cards and 1,200 characters of compact, explicitly untrusted
cultural context reach a prompt. The post and catalog-owned template grammar remain canonical, and
prompts prohibit forced, mismatched, or stale references. Raw Tavily snippets and source-post text
are not persisted or logged, and post text never appears in plaintext cache keys. Redis,
query-embedding, or pgvector unavailability fails open to the existing Redis/deterministic
suggestion and caption fallback; Tavily unavailability cannot add a request-time dependency.

Apply the current Alembic migrations before refreshing; they create the trend memory, immutable
snapshot, collection-claim, and monthly credit-ledger schema. Local refreshes require PostgreSQL
with pgvector, Redis, Tavily, and OpenRouter credentials in the ignored environment files. Trend
enrichment uses `google/gemini-3.7-flash` through OpenRouter and does not call Google's direct
Gemini API. Before publishing a snapshot, active serving cards without a current semantic vector
are embedded in bounded batches with `google/gemini-embedding-2` through OpenRouter. The embedding
document contains normalized trend-card semantics only—never Tavily evidence, excerpts, or URLs.
Each vector stores its OpenRouter model and a SHA-256 fingerprint of that semantic document.
Unchanged model-and-fingerprint pairs keep their existing vectors; a semantic card or configured
model change invalidates the vector and the next refresh replaces it. Any embedding-provider or
response failure leaves the previous published PostgreSQL snapshot and Redis pointer in place:

```sh
npm run db:up
npm run db:migrate
npm run trends:refresh
# Direct API-workspace entry point:
uv run --project apps/api memedrop-trend-refresh
```

Set `MEMEDROP_TRENDS_ENABLED=true` for both the refresh job and request-time Redis lookup. The
default refresh runs the pulse, daily, and weekly profiles together; deterministic UTC scan buckets
make repeated daily and weekly work idempotently skip until its cadence advances. For isolated
runs, repeat `--profile pulse`, `--profile daily`, or `--profile weekly` as needed.

The checked-in Hobby-compatible Vercel schedule calls `GET /internal/cron/trends/refresh` once
daily at 02:00 UTC and therefore runs only one of the pulse profile's four-hour buckets each day. It
uses approximately 321 basic searches per 30 days before retries. This is the current preview
cadence, not the intended launch cadence. Before production launch, upgrade the API project to
Vercel Pro (or use an equivalent external scheduler) and change the trend schedule to
`0 */4 * * *`; that activates every pulse bucket and uses an estimated 771 searches per 30 days.
The PostgreSQL ledger enforces the 900-credit ceiling in either case.

The scheduled endpoint must be given `CRON_SECRET`; Vercel sends it as
`Authorization: Bearer $CRON_SECRET`, and the API
rejects missing or mismatched values without running the job. A Redis lease prevents overlapping or
duplicate scheduler deliveries from doing provider work; the one-hour lease bounds a stuck worker,
and an overlap returns a successful
`{"status":"skipped","reason":"in_progress"}` result.

## Generated-image retention

Every durable generated asset expires 30 days after creation. Vercel Cron calls the protected
`GET /internal/cron/assets/cleanup` route daily at 03:30 UTC using the same `CRON_SECRET` bearer
authentication as trend refresh. A separate owner-fenced Redis lease prevents overlapping cleanup
runs. Each run claims no more than 100 expired records with PostgreSQL `FOR UPDATE SKIP LOCKED`,
deletes only the exact object key stored on each record, and retains categorical success or failure
state for bounded retries. It never lists, empties, creates, or deletes a bucket.

The response contains only status, counts, stale-generation reconciliation count, remaining retryable
backlog, and oldest deletion lag; it never includes object keys, account identifiers, captions, or
source text. Configure
`MEMEDROP_GENERATED_ASSET_CLEANUP_BATCH_SIZE`,
`MEMEDROP_GENERATED_ASSET_CLEANUP_CLAIM_TIMEOUT_SECONDS`, and
`MEMEDROP_GENERATED_ASSET_CLEANUP_LOCK_TTL_SECONDS` only when the defaults are unsuitable. The
claim timeout must be at least as long as the Redis lease. Production requires `CRON_SECRET` even
when trend collection is disabled; development remains usable without it, and the cron route then
rejects every request.

The report separates retryable backlog from `blocked_expired_assets`. A permanent key failure, an
exhausted failed record, or a max-attempt pending claim whose lease has gone stale remains blocked
and continuously makes the cron return HTTP 503 until an operator repairs it. A fresh pending claim
is still considered in flight and is not reported as blocked until the configured claim timeout.

`/health` remains the monitoring endpoint. When trends are enabled, it also reports the latest
published snapshot's content-free age and returns HTTP 503 when no snapshot exists, it contains no
serving cards, or it is older than `MEMEDROP_TREND_SNAPSHOT_MAX_AGE_SECONDS` (eight hours by
default). Alert on any non-200
health response. Production trend refresh requires `TAVILY_API_KEY`, `OPENROUTER_API_KEY`,
`REDIS_URL`, and `CRON_SECRET`; keep all four in the deployment secret store.

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

## Agent meme API

`POST /api/v1/memes/generate` is the minimal interface for an AI agent that needs a finished meme.
The JSON body stays small: only `input` is required. Public-agent calls must also send an issued
Bearer API credential and an `Idempotency-Key`; install IDs are not accepted as agent
authentication. The server infers humor context, chooses verified templates, renders the result,
and returns durable media records without persisting or returning source text or captions.

```json
{
  "input": "We postponed the launch again because someone found another timezone bug."
}
```

The optional `options` object accepts:

- `direction`: a 1-280 character creative preference, such as `dry and self-aware`. It cannot
  override catalog, safety, region, or length constraints.
- `count`: the requested number of memes from 1 through 5. It defaults to 1.

`input` is trimmed and must contain 1-12,000 characters. Unknown request fields are rejected. These
bounds, the five-result maximum, the verified-template shortlist, and server-owned `/memes/...`
media keep work and external calls bounded.

```sh
curl --request POST http://localhost:3001/api/v1/memes/generate \
  --header 'Authorization: Bearer key_….<secret>' \
  --header 'Idempotency-Key: launch-reply-001' \
  --header 'Content-Type: application/json' \
  --data '{"input":"We postponed the launch again because someone found another timezone bug."}'

curl --request POST http://localhost:3001/api/v1/memes/generate \
  --header 'Authorization: Bearer key_….<secret>' \
  --header 'Idempotency-Key: build-reply-001' \
  --header 'Content-Type: application/json' \
  --data '{"input":"The build passed on the fifth attempt.","options":{"direction":"dry and self-aware","count":2}}'
```

A successful response returns ready-to-use, captioned images rather than blank templates or drawing
instructions:

```json
{
  "status": "ok",
  "memes": [
    {
      "id": "asset_0123456789abcdef012345",
      "image_url": "http://localhost:3001/api/v1/memes/assets/asset_0123456789abcdef012345",
      "expires_at": "2026-09-23T12:00:00Z"
    }
  ]
}
```

Generated media URLs are absolute and require the same Bearer credential. Their expiry is thirty
days after generation. Configure `MEMEDROP_API_PUBLIC_ORIGIN=http://localhost:3001` locally and
the exact HTTPS API origin (`https://api.memedrop.moyezrabbani.dev`) in production. Generic
`/memes/generated/agents/...` paths intentionally do not serve generated agent images.

If no verified suggestion can be rendered, the endpoint still returns HTTP 200 with an explicit
empty result:

```json
{
  "status": "no_fit",
  "memes": []
}
```

Retrieval returns verified templates only. A new request reserves one credit; a successful image
commits it only after the full durable asset set is stored transactionally. `no_fit`, rendering,
storage, cancellation, and internal failures release the reservation. A terminal idempotent replay
returns the stored media without invoking retrieval, rendering, or storage again.

The protected daily generated-asset maintenance cron also performs bounded stale-generation
reconciliation. After `MEMEDROP_AGENT_GENERATION_STALE_TIMEOUT_SECONDS` (30 minutes by default),
it holds the account and generation locks, lists at most the fixed five-result output bound plus one object
under that exact account-and-generation prefix, and deletes only those keys. An overflow, listing,
or deletion failure leaves the generation processing and its credit reserved for the next protected
delivery; it never falls back to a bucket-wide scan. Only after cleanup succeeds does it mark the
request `generation_timeout` and release the reservation exactly once.

Raw `input`, `options.direction`, and plaintext captions are not logged or persisted as request or
usage metadata. The rendered image is stored so its returned URL remains usable; sensitive request
values are hashed wherever they participate in cache identity.

## Private-beta user administration

The authenticated dashboard provisions customer users from their GitHub or Google identity, shows
their remaining credits, and lets them create or revoke their own API keys. The server-side operator
CLI remains the controlled path for initial user bootstrap, credit grants, key rotation, and support
operations. Run migrations first, then create a user with the same stable identity-provider subject
that Auth.js supplies and use the returned compact `u_...` ID in later commands:

```sh
npm run db:migrate
npm run agent:admin -- user-create --auth-provider github \
  --auth-subject <provider-user-id> --email <customer-email> --confirm
npm run agent:admin -- key-issue --user-id u_... --name "Production" --confirm
npm run agent:admin -- credits-grant --user-id u_... --credits 25 \
  --idempotency-key acme-initial-20260830 --confirm
npm run agent:admin -- status --user-id u_...
```

`key-issue` prints the complete Bearer credential exactly once. Transfer that value directly to an
approved password manager or equivalent secret-delivery channel; do not redirect it into this
repository, a ticket, terminal scrollback capture, or shared logs. Treat stdout as secret-bearing for issuance and
rotation, and ensure terminal capture, CI logs, and command auditing cannot retain it. The database
stores only its SHA-256 hash, so the credential cannot be retrieved later. Status output contains
only operator-safe user/key metadata, compact IDs, categorical states, timestamps, and the current
credit balance.

Rotate or revoke a key with its owning user ID:

```sh
npm run agent:admin -- key-rotate --user-id u_... --key-id k_... \
  --name "Production replacement" --confirm
npm run agent:admin -- key-revoke --user-id u_... --key-id k_... --confirm
```

Rotation atomically revokes the old key and prints the replacement credential exactly once.
Every mutation requires `--confirm`. Credit grants accept 1 through 1,000,000 credits and are
idempotent within the addressed user: replay the same `--idempotency-key` and amount for a safe
retry, and use a unique operator key for each intended grant. Reusing that user/key pair with a
different amount fails instead of silently changing a grant. The dashboard shows each newly issued
credential once, stores only its hash, caps a user at five active keys, and requires an idempotency
key for safe issuance retries. Recharge, payment integration, usage history, generation history,
billing receipts, and general account self-service remain outside the current private-beta slice.

## Vercel

Create a dedicated Vercel project with Root Directory set to `apps/api`. The app has its own
`pyproject.toml`, `uv.lock`, Python version, catalog data, migrations, and recognized `app.py`
entrypoint. Configure production environment variables from the ignored root `.env.prod` in the
project dashboard, then run `npm run db:migrate` and `npm run db:seed-memes` as controlled release
steps rather than during a serverless build.
