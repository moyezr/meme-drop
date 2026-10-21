# MemeDrop decisions

Record durable choices with context, consequences, evidence, and a condition for reconsideration.
Use stable IDs and `accepted`, `proposed`, or `superseded` status. A proposal is not authorization to
change a contract. Supersede a decision with a linked replacement rather than silently reversing it.
Routine task updates belong in [PROGRESS.md](PROGRESS.md).

Entries D002–D008 were recorded on 2026-09-09 from the repository at `3819bf6`; this is a recording
date, not a claim about their original adoption date. Runtime settings and procedures remain in
their owning code and linked documents. Add entries only when a future session needs the rationale.

## D001 — Keep guidance small and separate durable state

Status: accepted · Date: 2026-09-09

- Context: the repository has established runbooks and executable gates but lacked session and
  decision records. The maintainer requested the harness engineering course's repository structure.
- Decision: keep AGENTS.md under 100 lines as the entry point; link task-specific rules. Use
  PROGRESS.md for the latest handoff and this file for durable decisions. Keep the existing launch
  plan as the product backlog with its acceptance criteria.
- Consequence: use existing npm/uv commands and quality gates. A second feature list or initializer
  would duplicate current task and setup sources; add one only if a concrete automation needs it.
- Maintenance: before adding a rule, identify its scope and owner. When code changes, update or
  remove obsolete guidance. Archive lengthy rationale under `docs/` with an index here if needed.
- Sources: [repository knowledge](https://walkinglabs.github.io/learn-harness-engineering/en/lectures/lecture-03-why-the-repository-must-become-the-system-of-record/),
  [small entry files](https://walkinglabs.github.io/learn-harness-engineering/en/lectures/lecture-04-why-one-giant-instruction-file-fails/),
  [session continuity](https://walkinglabs.github.io/learn-harness-engineering/en/lectures/lecture-05-why-long-running-tasks-lose-continuity/),
  and [evidence before completion](https://walkinglabs.github.io/learn-harness-engineering/en/lectures/lecture-09-why-agents-declare-victory-too-early/).

## D002 — One backend with independently deployed applications

Status: accepted · Recorded: 2026-09-09

- Context: the web app and API deploy as separate Vercel projects; the extension ships separately.
- Decision: FastAPI in `apps/api` owns application services, Python metadata, migrations, and tests.
  Turborepo shares development tasks without coupling runtimes. Catalog and template-pipeline apps
  remain development-only. Do not introduce another backend.
- Consequence: keep credentials/promotion server-side and use the owning workspace's toolchain.
  TypeScript 6 is held for `apps/web` because of Next.js compatibility; other TS workspaces use 7.x,
  and Node types stay on 22. Revisit version holds during dependency maintenance.
- Evidence: [architecture boundaries](architecture.md#boundaries), [tooling](docs/development.md),
  and [dependency compatibility](QUALITY.md#dependency-security).

## D003 — Catalog-owned quality and bounded deterministic fallback

Status: accepted · Recorded: 2026-09-09

- Context: external inference can be slow or unavailable, and machine labels do not establish
  template suitability or readable placement.
- Decision: preserve local ranking/fallback and verified-only suggestions. Human review, rendered
  QA, benchmarks, and promotion establish eligibility; shared rendering uses catalog-owned regions
  and bundled typography. Source posts remain canonical; steering cannot bypass constraints.
- Consequence: bound inference and returned results; measure recall and latency before changing
  retrieval infrastructure. Template expansion proceeds independently of platform launch work.
- Reconsider when measured quality or latency fails the existing gates, with case-level evidence.
- Evidence: [suggestion contracts](docs/suggestion-contracts.md), [quality playbook](QUALITY.md),
  and [suggestion architecture](architecture.md#suggestion-pipeline).

## D004 — Isolate environments and retain only reviewed telemetry

Status: accepted · Recorded: 2026-09-09

- Context: media and credentials cross browser, API, and storage boundaries; development tools
  must not alter production data or expose user input.
- Decision: keep S3 credentials server-side and buckets environment-specific. Production secret
  sync goes from the ignored operator file to the deployment store; never overwrite that file with
  pulled Sensitive references. Keep free text out of persistence/logs/events and plaintext cache keys.
- Consequence: hash sensitive cache inputs, include all request-shaping inputs, and guard stale
  responses with request generations. Retain categorical diagnostics rather than source text.
- Reconsider only with an explicit privacy/security contract change and boundary tests.
- Evidence: [storage rules](docs/storage-and-secrets.md), [suggestion rules](docs/suggestion-contracts.md),
  and [deployment configuration](docs/private-beta-deployment.md).

## D005 — Direct customer ownership and a thin authenticated dashboard

Status: accepted · Recorded: 2026-09-09

- Context: the initial agent product needs credentials, credits, usage, and account management;
  shared team ownership is not required.
- Decision: a customer User directly owns keys, credits, generations, and assets. Dashboard
  authentication uses Auth.js JWT sessions; FastAPI owns customer data and credit enforcement.
  Defer team/workspace/membership abstractions until shared ownership is needed.
- Consequence: the web application hosts developer documentation at `/docs`, the management
  dashboard, and `/privacy-policy`. Billing/history capabilities remain tracked implementation work.
  The canonical origins are `https://memedrop.moyezrabbani.dev` (web) and
  `https://api.memedrop.moyezrabbani.dev` (API).
- Reconsider when product ownership or deployment boundaries change; policies must follow behavior.
- Evidence: [launch plan](docs/production-launch-plan.md), [API administration](apps/api/README.md#private-beta-user-administration),
  and [deployment](docs/private-beta-deployment.md).

## D006 — Minimal agent contract with durable, idempotent credit accounting

Status: accepted · Recorded: 2026-09-09

- Decision: `POST /api/v1/memes/generate` requires only `input` in its JSON body; optional controls
  live under `options`. Authentication and the required idempotency key remain part of the contract.
  Charge one credit per successful durable returned asset, including deterministic fallback;
  release unused reservations for `no_fit`, partial output, or failure. Matching replay never recharges.
- Consequence: generated media requires the owning user's Bearer credential for 30 days and returns
  gone after expiry. Public IDs use `u_`, `k_`, `g_`, or `a_` plus 12 characters from a 57-character URL-safe,
  non-ambiguous alphabet (about 70 bits of CSPRNG entropy), with uniqueness checks and bounded retry.
  Existing UUID install/browser identities are not rewritten for this launch.
- Rationale: keep integrations small, ownership explicit, retry costs predictable, and identifiers
  non-sequential. Verify the customer path using a black-box client, without backend imports or
  direct persistence access.
- Reconsider through a versioned API/retention/accounting change, with compatibility and replay tests.
- Evidence: [agent API](apps/api/README.md#agent-meme-api), [smoke agent](apps/smoke-agent/README.md),
  and [launch acceptance](docs/production-launch-plan.md#launch-definition).

## D007 — Coordinate bounded trend refresh steps through QStash

Status: accepted · Recorded: 2026-09-09

- Context: a production full-refresh invocation exceeded Vercel's 60-second function limit.
- Decision: QStash Workflow coordinates bounded, retried steps running on Vercel. Tavily handles
  discovery; OpenRouter handles model calls, with an embedding-specific model for trend retrieval.
- Consequence: retain last-known-good snapshots through failure and publish atomically. Recorded
  selections are `google/gemini-3.7-flash` for suggestion/caption/enrichment/annotation and
  `google/gemini-embedding-2` with 1,536 dimensions for embeddings, all through OpenRouter rather
  than direct Google calls. Current API defaults live in [config.py](apps/api/src/memedrop_api/config.py).
  D010 supersedes the chat/vision model selection; workflow and embedding choices remain in force.
- Reconsider provider/model choices using measured quality, cost, and latency; a scheduler change
  must preserve bounded execution, retry safety, and publication semantics.
- Evidence: [trend memory](apps/api/README.md#trend-memory) and [release verification](docs/private-beta-release-2026-09-06.md).

## D008 — Release the API/web private beta separately from paid and store launches

Status: accepted · Recorded: 2026-09-09

- Context: API/web beta verification is recorded while Chrome Web Store enrollment and paid
  offering decisions remain unfinished.
- Decision: run the beta with operator-granted credits and production checkout disabled. Tester
  invitations are a separate operator step. Store submission, public self-service, and paid checkout
  remain later tracks; catalog expansion does not block the platform release.
- Consequence: Dodo Payments replaces Lemon Squeezy as the planned payment provider. Test-mode
  checkout and replay-safe fulfillment are recorded as implemented; the application ledger remains
  authoritative. This does not establish live payment readiness. Prices, refunds, tax/currencies,
  payout eligibility, merchant approval, and production verification remain open launch work.
- Reconsider when the corresponding product decisions and hosted release checks are complete.
- Evidence: [release boundary](docs/release.md#current-release-boundaries), [release record](docs/private-beta-release-2026-09-06.md),
  and [open launch decisions](docs/production-launch-plan.md#open-architecture-and-product-decisions).

## D009 — Reduce idle production maintenance frequency

Status: accepted · Date: 2026-10-07

- Context: production has no customer accounts or recent customer generations, while scheduled
  work accounts for roughly 9,000 monthly API invocations and consumes provider credits.
- Decision: at the operator's request, run the QStash trend workflow daily at 00:00 UTC and both
  generated-asset cleanup deliveries weekly on Sundays, at 03:30 and 03:40 UTC. Keep the health
  monitor every ten minutes. Set trend freshness to 48 hours, preserving two scheduled intervals
  of tolerance and stale/missing/empty snapshot failures. Keep the 900-credit ceiling and workflow
  retry, signature, publication, and deterministic fallback safeguards.
- Consequence: trend discovery is less current; expired media remains inaccessible at 30 days,
  but physical deletion and stale-generation refunds can wait up to a week plus retry delays.
  Database/object backup procedures remain separate and unchanged.
- Reconsider cadence when testers become active or measured freshness, deletion lag, or refund
  delay becomes unacceptable.
- Evidence: current aggregate investigation in [PROGRESS.md](PROGRESS.md), schedule contracts in
  [operations](docs/private-beta-operations.md), and [API maintenance](apps/api/README.md).

## D010 — Select Luna for the cost-focused model migration

Status: accepted · Date: 2026-10-19

- Context: the operator chose `openai/gpt-6-luna` after the three-model evaluation and authorized
  production deployment, prioritizing provider cost over DeepSeek's stronger interactive sample.
- Decision: use Luna through OpenRouter for purpose-specific suggestion, caption, saved-image
  tagging, trend enrichment, and offline template-model defaults. Keep independent overrides,
  existing reasoning/deadline/token budgets, deterministic fallback, and verified-only eligibility.
  Saved-image tagging supplies its existing strict output schema so the provider can satisfy the
  unchanged validation contract. Human catalog promotion and rendered QA remain mandatory.
- Consequence: the primary sample matched DeepSeek's 35/36 usable cases at roughly one-third the
  reported interactive charges, while producing fewer valid captions and weaker family relevance.
  This is the operator's explicit cost tradeoff, not a claim of human humor approval. Gemini
  Embedding 2 remains unchanged; reconcile the stale local production operator embedding value
  to the deployed setting without migrating stored vectors.
- Reconsider on observed caption rejection, poor user feedback, provider errors, or latency/cost
  regression. Evidence: [evaluation](docs/model-evaluation-2026-10-19.md) and rollout in PROGRESS.md.

## D011 — Bound the whole suggestion path and version corrected feedback

Status: accepted · Date: 2026-10-21

- Context: the browser's five-second deadline was shorter than serial optional enrichment plus
  inference allowances. Byte readiness did not measure a visible captioned preview, and legacy
  `used`/`dismissed` events could mean copying/ordinary close rather than insertion/rejection.
- Decision: use one five-second suggestion-service budget with a 250ms fallback reserve and
  6.5-second client allowance. Keep the 4.5-second maximum provider budget, existing prompts/models,
  verified-only ranking, and fallback. Measure actual rendering/visibility and native-confirmed
  attachment locally. Version 2 events separate insertion, copying, explicit rejection, neutral
  abandonment, and failure; learn only from corrected events and keep legacy records exportable.
- Consequence: random client event IDs deduplicate atomically through installation-scoped existing
  PostgreSQL primary keys. Retain only reviewed categorical context, random impression identity,
  bounded position, and version; do not introduce content-derived analytics or another service.
  Migration `20261021_0011` widens the existing event action constraint before API/extension release.
  No historical data is rewritten. New-action data blocks an unsafe constraint downgrade.
- Reconsider on measured fallback availability, transport/attachment latency, platform DOM changes,
  or insufficient signal; use boundary tests, browser fixtures, and hosted QA as appropriate.
- Evidence: [suggestion contracts](docs/suggestion-contracts.md), [quality workflow](QUALITY.md),
  and implementation/checks in [PROGRESS.md](PROGRESS.md).
