# MemeDrop production launch plan

Last updated: 2026-10-23 (evaluation and suggestion measurement; other status retains recorded evidence)

This document is the source of truth for the work required to launch MemeDrop as a reliable
"humor layer for AI agents." Update task status and acceptance evidence here as implementation
progresses. [PROGRESS.md](../PROGRESS.md) owns the current session handoff; [DECISIONS.md](../DECISIONS.md)
owns accepted choices and rationale. Detailed implementation notes may live beside the relevant
application, but they should link back to a task in this plan.

## Status legend

- `[ ]` Not started
- `[~]` In progress
- `[x]` Complete and verified
- `[?]` Product or technical decision required

## Current delivery boundary

The API/web private-beta infrastructure and release are live. Production deployment, monitoring,
restore and rollback drills, and a successful external-agent generation are verified. Inviting the
first bounded tester group is a separate operator step. Chrome Web Store submission, paid checkout,
and public self-service remain later release tracks. Production Dodo configuration is disabled, so
beta credits can be granted only through the explicit operator flow.

Repository readiness is enforced by `npm run quality:deployment-readiness`. The gate accepts only
loopback PostgreSQL and Redis test services and a disposable test database name; clears provider and
storage credentials; and blocks on static analysis, all deterministic tests and builds, recommendation
tuning, the complete migration/integration suite, API and backend-image smoke tests, and dependency
security audits. It deliberately does not make provider calls or validate hosted configuration.

## Confirmed product decisions

Accepted decisions now live in [DECISIONS.md](../DECISIONS.md): runtime boundaries (D002), catalog
quality (D003), privacy/storage (D004), customer ownership and dashboard (D005), agent contract and
credits (D006), trend ingestion (D007), and private-beta/payment boundaries (D008). Update those
records when a decision changes; keep implementation status and acceptance checks in this plan.

## Launch definition

MemeDrop is ready for an initial production launch when an external AI agent can:

1. create or receive a secure API credential;
2. send one small, documented request to the generation endpoint;
3. receive a relevant, readable, safe, ready-to-use meme or a stable `no_fit` response;
4. understand whether a credit was consumed;
5. retrieve the returned image throughout its documented 30-day lifetime; and
6. inspect usage, remaining credits, and credential status through the management experience.

The service must preserve the last known-good catalog and trend index through provider failures,
avoid leaking post text or secrets, enforce tenant boundaries, and expose enough telemetry to
diagnose latency, quality, cost, and availability regressions.

Repository completion and hosted deployment are separate gates. Checked-in routes, schedules,
validation, and documentation may be marked complete from local evidence; Vercel plan upgrades,
environment-secret changes, managed-service provisioning, DNS changes, production migrations, and
live smoke tests remain incomplete until an operator performs and verifies those external actions.

## Critical path

### P0 — Make trend ingestion operational and safe

- [x] Validate the rotated Tavily key with Tavily's authenticated, non-search usage endpoint.
- [x] Add a provider preflight that rejects missing or invalid credentials before reserving local
  search credits.
- [x] Return a non-zero CLI status when every claimed query fails.
- [x] Report bounded, non-sensitive failure categories such as `tavily_auth`,
  `tavily_rate_limit`, `tavily_timeout`, `openrouter_timeout`, and `schema_rejected`.
- [x] Preserve the last published PostgreSQL snapshot and Redis pointer when a refresh produces no
  successful query results because of provider or infrastructure failure.
- [x] Distinguish local credit reservations from provider-reported Tavily usage in operator output.
- [x] Set the application monthly ceiling to 900 Tavily credits.
- [x] Change the pulse profile from a six-hour cadence to a four-hour cadence after the safe-failure
  work is deployed. The code supports four-hour buckets; production now invokes all
  profiles once daily at 00:00 UTC and uses approximately 321 searches per 30 days.
- [x] Add a protected, idempotent cron entry point suitable for Vercel Cron Jobs. It authenticates
  the scheduler, uses deterministic UTC scan buckets, and prevents overlapping executions.
- [x] Replace the single-invocation Vercel trend cron with a QStash Workflow, now scheduled once daily.
  A production measurement on 2026-09-05 reached Vercel's 60-second function limit and
  returned HTTP 504 after successful Tavily and OpenRouter calls, so QStash must coordinate bounded
  steps rather than call the existing full-refresh endpoint once. Each query and embedding batch
  now runs as a signed, retried step, followed by the existing atomic snapshot-publication gate.
  The expected approximately 321 searches leave approximately 579 retry credits under the
  900-credit ceiling.
- [x] Add stale-snapshot monitoring: `/health` returns HTTP 503 with content-free snapshot age
  details when no usable snapshot has been published within the 48-hour window. cron-job.org job
  `8391201` checks the production endpoint every ten minutes and alerts after two failures and on
  recovery.
- [x] Embed active serving trend cards in bounded OpenRouter batches before snapshot publication.
  Semantic or configured-model changes invalidate stored vectors using durable model-and-document
  fingerprint metadata, unchanged cards skip recomputation, and embedding failures preserve the
  previously published PostgreSQL snapshot and Redis pointer.
- [x] Add bounded hybrid suggestion-time retrieval. Redis lexical matches and pgvector semantic
  candidates are reranked with lifecycle and vitality signals; semantic queries are restricted to
  exact card versions in the latest published snapshot and fail open on provider or database error.
- [x] Run a real refresh and verify the full path: Tavily discovery, OpenRouter enrichment,
  PostgreSQL cards and observations, embeddings, immutable snapshot, Redis publication, and bounded
  prompt retrieval. The signed production QStash workflow completed and published snapshot v14;
  `/health` reports it as fresh with nine serving cards.

Done when: a scheduled refresh can be replayed safely, provider failure leaves the last good index
available, operators receive an actionable failure category, and a live suggestion can retrieve a
relevant trend card without adding more than the existing bounded prompt allowance.

### P0 — Harden the agent meme-generation API

- [x] Treat the existing `POST /api/v1/memes/generate` implementation as a vertical slice and audit
  every dependency for production behavior rather than creating a second endpoint.
- [x] Preserve the minimal contract:

  ```json
  {
    "input": "We deployed on Friday and immediately broke checkout"
  }
  ```

- [x] Keep optional `direction` and `count` controls under `options`, with strict size and range
  bounds and unknown-field rejection.
- [x] Define a compact ID specification with typed prefixes and sufficient entropy. The generator
  must use a cryptographically secure random source, have deterministic validation, and retry on a
  database uniqueness conflict.
- [x] Decide the migration boundary for existing UUID-backed browser/install data. Existing UUID
  records remain unchanged for the initial agent launch. Any future rewrite requires an explicit
  inventory of the affected tables, foreign keys, URLs, and rollback plan.
- [x] Use `u_`, `k_`, `g_`, and `a_` plus 12 non-ambiguous Base58 characters for public user, API
  key, generation, and generated-asset IDs. Internal credit transactions use database identities.
- [x] Add API-key authentication for agent routes. Store only a one-way hash of each secret; retain
  a short public key identifier for lookup, display, rotation, and audit.
- [x] Support credential creation, naming, rotation, revocation, and last-used metadata through the
  explicit private-beta operator CLI and create/revoke entry points through the authenticated
  dashboard.
- [x] Enforce tenant-scoped rate limits and credit limits. An install ID must not be accepted as
  authentication for an external production agent.
- [x] Require the raw API caller to send `Idempotency-Key`; a matching retry cannot create a second
  charge or duplicate asset, while reuse with a different request is rejected.
- [x] Define stable machine-readable errors for invalid input, invalid credentials, insufficient
  credits, rate limiting, provider timeout, `no_fit`, and internal failure.
- [x] Return an absolute HTTPS `image_url` using the production API origin.
- [x] Keep provider calls, shortlist size, result count, rendering, media reads, and response size
  bounded.
- [x] Verify deterministic fallback behavior and define when fallback results are acceptable for
  a paid generation.
- [x] Add provider-free end-to-end boundary tests covering authentication, credit debit, idempotent
  replay, model success/failure, rendering, object persistence, and media retrieval. A live hosted
  provider smoke remains an external deployment check.
- [x] Add an independent black-box smoke agent under `apps/smoke-agent`. It uses only the public
  HTTPS contract, verifies hosted readiness before spending credits, replays the exact request,
  downloads private media with the caller credential, and emits no request input or secret.
- [x] Add contract checks shared by the FastAPI implementation, TypeScript types, and published
  docs.

Done when: a newly issued API key can make an idempotent generation request, receive a finished
image with a compact public ID, observe one correct credit transaction, and retry without being
charged or stored twice.

### P0 — Build credits, accounting, and unit economics

- [x] Store each user's whole-credit balance for atomic checks and keep compact, typed credit
  transactions for purchases, grants, generation reservations, and refunds.
- [x] Implement atomic reserve and refund behavior around generation so concurrent requests cannot
  overspend a user's balance.
- [x] Consume one credit for each finished meme asset durably recorded and returned. Reserve the
  requested count before work and refund every unused reservation during settlement.
- [x] `no_fit`, provider or internal failure, cancellation, and matching idempotent replay are free.
  Each deterministic fallback asset that is successfully returned consumes one credit.
- [ ] Record internal per-generation cost without storing raw prompt text: OpenRouter model and
  tokens, rendering/storage cost estimate, Tavily allocation, infrastructure allocation, and
  payment-processing allowance.
- [ ] Build a unit-economics worksheet from measured p50/p95 model usage rather than advertised
  maximums.
- [ ] Define packages, price per credit, minimum gross-margin target, free trial, expiration/refund
  rules, and abuse limits.
- [x] Implement Dodo Payments checkout and fulfillment in test mode, with production configuration
  disabled until the credit transactions, economics, pricing, and refund model are reviewed.
- [x] Add signature-verified, idempotent `payment.succeeded` fulfillment for later test/live use;
  refund handling and live-provider approval remain in the paid-launch track.
- [x] Add the remaining-credit balance to the tenant-scoped dashboard overview.
- [ ] Add credit-transaction and usage endpoints for the dashboard.
- [x] Add bounded stale-reservation reconciliation and idempotent operator grant tooling. General
  post-billing adjustments remain part of the future payment workflow.

Done when: accounting remains correct under concurrency and retries, a generation's fully loaded
cost is measurable, pricing meets the chosen margin target, and a payment retry cannot add credits
twice.

### P0 — Enforce the 30-day generated-image lifecycle

- [x] Add a durable generated-asset record containing compact ID, owning user, object key,
  content type, content hash, created time, expiry time, generation ID, and deletion state.
- [x] Set `expires_at` to 30 days after successful generation.
- [x] Prevent cross-tenant asset enumeration and access.
- [x] Define private, no-store cache headers and authenticated URL behavior before and after expiry.
- [x] Add a protected, idempotent cleanup job suitable for Vercel Cron Jobs. The bounded,
  retry-safe service is protected by constant-time bearer authentication and a Redis lease.
- [x] Delete expired objects from the correct environment bucket in bounded batches, then record
  deletion success. Retry failures without losing the durable expiry record.
- [x] Ensure idempotent generation does not extend retention unless that behavior is explicitly
  selected and accounted for.
- [~] Add storage-volume, deletion-lag, and cleanup-failure metrics. The scheduled response exposes
  bounded cleanup outcomes, backlog count, and oldest retryable lag; production metrics export,
  storage-volume aggregation, and alerting remain.
- [x] Document the 30-day policy in the API docs and privacy policy.

Done when: every generated object is attributable to one user and generation, becomes
unavailable after its documented expiry, and is eventually removed without broad or unsafe bucket
operations.

### P1 — Ship agent documentation and management UI

- [x] Create `apps/web` route `/docs`.
- [x] Publish the minimal quickstart first: authentication, one curl request, one TypeScript
  example, one Python example, response schema, credit behavior, retention, errors, rate limits,
  idempotency, and production base URL.
- [x] Validate documentation assertions against the implemented API source and shared contract in
  the landing build and CI.
- [x] Document timeout and retry guidance for agents.
- [ ] Keep a versioned changelog and compatibility policy.
- [x] Implement Auth.js JWT authentication and document account recovery through the configured
  identity provider.
- [x] Build the tenant-scoped dashboard overview for remaining credits and API-key creation and
  revocation. A newly issued credential is shown once and only its one-way hash is retained.
- [x] Add accessibility, responsive-layout, loading, empty-state, and error-state coverage for the
  current dashboard slice.
- [ ] Add recharge, credit usage, generation history, asset expiry, billing receipts, and general
  account self-service to the dashboard.

Done when: a developer unfamiliar with MemeDrop can obtain a credential and complete a successful
generation using only `/docs`, and a user can manage keys and credits without database or operator
access.

### P1 — Add production observability and abuse controls

- [ ] Emit structured, redacted metrics for request count, latency, status, `no_fit`, fallback,
  OpenRouter outcome, render/storage outcome, credit outcome, and trend snapshot age.
- [ ] Track p50/p95/p99 end-to-end latency and provider latency separately.
- [~] Correct browser suggestion deadlines, local measurements, and outcome feedback. The October
  21 implementation bounds service work, separates visible captioned previews/native-confirmed
  attachments from byte arrivals/copies, and adds version 2 retry-safe feedback. Local acceptance
  includes packaged Chromium fixture flows and PostgreSQL integration; hosted rollout and real
  X/LinkedIn DOM QA remain separate. Apply `20261021_0011` before API then extension deployment.
  Verification is recorded in [PROGRESS.md](../PROGRESS.md).
- [~] Build a human evaluation and production baseline workflow. The 48-case authored-synthetic
  grouped corpus, offline rendered scoring/export, and content-free browser collection/aggregate
  report are implemented; see [evaluation](evaluation.md). Human labels remain provisional and
  real reviewer scores/population measurements are still required. Apply `20261023_0012` before
  API/privacy then extension 0.0.4. Keep QA outside the observation window and report low coverage.
- [ ] Track estimated and reconciled cost per successful generation and per customer.
- [~] Add dashboards and alerts for elevated errors, provider timeouts, stale trends, Redis or
  PostgreSQL failures, credit-transaction anomalies, storage cleanup lag, and unusual user usage.
  Private-beta health and cleanup alerts are active; broader public-launch metrics remain.
- [x] Confirm logs never contain raw source posts, generated captions, API secrets, signed URLs, or
  request bodies.
- [ ] Add per-user and global circuit breakers, concurrency limits, and abuse monitoring.
- [x] Define incident response, key rotation, provider outage, rollback, and credit-correction
  procedures.

Done when: an operator can explain a failed or slow request using request ID and categorical
telemetry without reading user content, and automated limits bound financial exposure.

### P1 — Complete production deployment

- [x] Provision managed PostgreSQL with pgvector, managed Redis, OpenRouter credentials, Tavily
  credentials, and the manually created `meme-drop-prod` bucket.
- [x] Configure the frontend origin as `https://memedrop.moyezrabbani.dev`.
- [x] Configure the API origin as `https://api.memedrop.moyezrabbani.dev`.
- [x] Configure OpenRouter attribution and all returned media URLs for the API origin.
- [x] Apply migrations using a direct or session-pooler connection and use the transaction pooler
  for runtime traffic where appropriate.
- [x] Seed all 49 verified templates and verify that production writes only to `meme-drop-prod`.
- [x] Run the production environment, storage, migration, static, API process, integration,
  security, Vercel build/deploy, and end-to-end smoke gates from the release source.
- [x] Smoke the current source and locked Python requirements in the existing backend image. A
  fresh registry-backed `Dockerfile.backend` build remains a container-deployment gate and does not
  block the Vercel Python runtime used for this private beta.
- [x] Establish backups, restore testing, rollback procedure, and credential rotation.
- [ ] Start with a bounded private beta before enabling public self-service signup.

Done when: both origins serve the intended applications over HTTPS, migrations and storage are
verified in the production region, rollback is tested, and a real external agent completes the
documented flow.

### P1 — Publish privacy and operational policies

- [x] Add the landing route `/privacy-policy` with an initial disclosure covering submitted text,
  generated images, API/account metadata, OpenRouter and Tavily processing, object storage,
  operational logs, billing data, and the 30-day generated-image retention period.
- [x] Add a real privacy/support contact.
- [x] Add an agent-focused landing page with curated visual examples, the existing extension
  demo, crawlable product metadata, `/llms.txt`, and public `/terms/` and `/refund-policy/` routes.
  These pages describe the current private beta, not an enabled paid offering.
- [ ] Approve and publish credit-pack prices, expiry, and monetary refund terms; implement and
  verify payment fulfillment before submitting the site for live payment-provider approval.
- [ ] Verify and document the actual retention configured at Vercel, PostgreSQL, Redis, OpenRouter,
  Tavily, object storage, analytics, and the payment provider.
- [ ] Define account deletion, data export, API-key revocation, and billing-record retention.
- [ ] Define meme-template provenance, copyright/takedown, and generated-content complaint
  procedures before a public launch.
- [ ] Select a source-code license before distributing the repository as reusable open-source
  software.

Done when: the hosted policy matches deployed behavior and providers, operational requests have an
owner and procedure, and the release gate contains no placeholder privacy values.

## Parallel quality track — Expand the verified template catalog

This track improves product quality continuously but does not block the infrastructure work above.
It still controls which templates can appear in production suggestions.

- [ ] Evaluate and rank the 971 successfully annotated drafts by source popularity, model
  confidence, benchmark exposure, novelty, and mechanical QA findings.
- [ ] Retry or correct the 16 failed annotations separately.
- [ ] Review duplicate classification for the 13 duplicates when convenient.
- [ ] Select an initial promotion cohort of approximately 100–200 high-value templates.
- [ ] Perform human taste review and rendered visual QA for every promoted template.
- [ ] Correct retrieval metadata, usage scenarios, anti-use cases, regions, typography, character
  limits, and examples where needed.
- [ ] Add realistic benchmark coverage before promotion.
- [ ] Promote in small, reversible batches and run the ranking, suggestion, rendering, dataset-plan,
  and tuning gates after every batch.
- [ ] Monitor production shown/used/dismissed feedback to prioritize later review cohorts.

Done is continuous: production uses only verified templates, every promoted batch passes existing
quality gates, and catalog growth does not regress relevance, readability, safety, or latency.

## Open architecture and product decisions

Accepted choices have moved to [DECISIONS.md](../DECISIONS.md). The unresolved decisions and external
readiness below remain part of launch planning; `in progress` does not establish production readiness.

- [?] Credit package sizes, price, tax treatment, refunds, expiry, and target gross margin.
- [~] Complete Dodo refund handling and verify live-mode merchant approval, currencies, payout
  eligibility, and production behavior. D008 records the provider choice and test-mode boundary.
- [?] Whether customers can explicitly delete generated images before expiry.
- [?] Initial public content-safety policy and appeal/takedown process.
- [~] Complete Chrome Web Store developer-account enrollment and obtain a final extension ID before
  store submission. D008 records the independently released API/web private-beta boundary.

## Verification commands

Run the smallest relevant checks during implementation. Before a production release candidate, run
the complete repository and production gates from a clean checkout:

```sh
npm ci
uv sync --project apps/api --frozen
npm run quality:static
npm run quality:api-process
npm run quality:backend-image
npm run quality:security
npm run quality:tuning
npm run test:api:integration
npm run quality:production-env
npm run storage:check
npm run storage:latency
npm run release:candidate
npm run launch:status
npm run launch:status -- --private-beta
```

Provider-backed smoke tests must use bounded test accounts and must not print or persist secrets,
raw user text, or generated captions.

## Change log

- 2026-09-09: Moved accepted decisions to DECISIONS.md and linked PROGRESS.md for session continuity.
  Existing product task statuses and historical release evidence were not reverified by this edit.
- 2026-09-07: Disabled stale Dodo test configuration in production so beta credits remain
  operator-controlled. Exercised the live dashboard assertion and key lifecycle, then fixed
  content-identical trend publications so successful QStash refreshes advance health freshness
  without changing immutable snapshot content.
- 2026-09-06: Deployed API commit `646ec52`, verified QStash refresh, production generation and
  cleanup, monitoring, log safety, key rotation, backup restore, and Vercel rollback. The API/web
  private-beta gate is ready; tester invitations remain separate.
- 2026-08-30: Confirmed the canonical API origin and privacy/support email, and deferred Chrome Web
  Store submission without blocking an API/web private beta.
- 2026-08-30: Added the authenticated dashboard bridge, remaining-credit overview, idempotent
  one-time API-key issuance and revocation, and explicit follow-up scope for billing and history.
- 2026-08-24: Created the production plan from the agreed trend, agent API, compact-ID, credits,
  30-day retention, documentation/dashboard, domain, privacy-page, and asynchronous catalog
  decisions.
