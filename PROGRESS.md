# MemeDrop progress

This is the current session handoff. Replace stale state; git retains history. The
[launch plan](docs/production-launch-plan.md) owns the backlog and
[DECISIONS.md](DECISIONS.md) owns durable choices. Local checks do not establish hosted readiness.

## Live suggestion QA and release follow-up — 2026-10-23

- Requested outcome: reload the production extension, verify actual X/LinkedIn captioned suggestions
  and native draft attachments, remove all QA attachments, publish nothing, and safely commit/roll
  out necessary repairs through `moyezr` before restoring `moyez-dev`. Baseline `56edd32`;
  preserve unrelated progress edits and the local October 19 assessment.
- Live LinkedIn exposed Comment links and a native HTML dialog outside its source post. Added
  bounded explicit-action composer binding, panel placement inside the native top layer, and
  cancellation on closure. Capture only the exact image input synchronously activated by that
  composer's Share photo control; cancel its chooser and remove the temporary listener immediately.
  Never search arbitrary global file inputs. Require a new decoded native removable image preview,
  including the verified blob/figure/link/Dismiss structure; unconfirmed attempts remain copied.
- Production extension version 0.0.3 was built, reloaded and exercised in signed-in Chrome.
  LinkedIn produced a captioned card and a native image draft without a file chooser. Both platforms showed
  captioned cards and native draft attachments on final 0.0.3. X exposed Edit media/Remove media
  and enabled Reply; each image was removed before closing its empty draft. X card selection used
  the page DevTools UI because its modal hides the body panel from accessibility and monitor mapping
  prevented reliable coordinate selection. No social reply was published. Safe production version-2
  aggregates: shown 5, clicked 5, inserted 2, copied 3; copied attempts did not become insertions.
- Live worker tracing observed client cancellation at 6.4s with no response headers before a warm
  request succeeded. Local reproduction proved the earlier route timer excluded rate limiting.
  The five-second application deadline now starts at middleware entry and covers rate checks/body
  parsing; rate checks cap at 500ms and fail closed. Pass remaining allowance into the service;
  retain route `total` and add `rate-limit`/headers-ready `http-app` timings. The same CORS policy now
  covers middleware errors. Serverless startup/network transit remain outside these measurements;
  the live cold-timeout cause is not yet established. Independent backend review found no issues.
- Verification on current runtime: 504 API tests, 28 PostgreSQL/Redis integration tests, 69 extension
  tests, 30 web tests, and 16 packaged Chromium/FastAPI browser scenarios passed, including actual
  native-dialog markup, exact external-input ownership, chooser suppression, unrelated blob/avatar
  rejection, cancellation and fallback. API process smoke and full release dry run passed, including
  workspace typechecks/tests/lint/build, metadata/catalog gates and packaging. No ranking/model or
  promotion threshold changed. Final local tuning preserves relevance/case-level baselines but
  exceeded the unchanged 50ms scale latency ceiling under host load (p95 55.6–87.8ms); container
  liveness also missed its unchanged eight-second startup check. Require independent CI evidence
  before main/production promotion. CI now always runs the provider-free tuning gate.
  PR CI `39841467994` passed all required jobs, including scale p95 21.108ms against the unchanged
  50ms ceiling, packaged browser flow, PostgreSQL/Redis integration, and container liveness.
  Optional live-model evaluation remains skipped; the deterministic gate always runs.
- Fresh security auditing found critical Next.js advisories; updated only Next 16.4.0 to the first
  patched 16.4.1 and matching lock entries. Web tests/typecheck/build and complete npm/Python audits
  pass. No security exception or permission expansion. Existing TikTok Sans build warning remains.
- Fresh production backup `20261022T191930Z` contains 100 objects and 18 tables at schema
  `20261021_0011`; restored/verified in an isolated database, archived with the existing AES-256
  Keychain workflow, and plaintext removed. Migration already precedes API deployment; no further
  schema change is needed. Disposable test services were stopped; unrelated services remain.
- Committed `b02bc89`, pushed through verified `moyezr`, and merged PR #2 only after required CI
  passed; main release is `1d273d7`. GitHub CLI returned to verified `moyez-dev` after push and merge.
  API preview refused to build without production credentials; no secrets were copied into preview.
  Production configuration validates with zero warnings. API deployment
  `dpl_6qxrZJmUTRtkniyEX9sF7uEmTNmu` and web `dpl_22LRcRq773tXmhMS1YM3n8f9x2em` are READY
  at runtime release `1d273d7`; independent canonical alias lookups resolve to those IDs. Main CI
  `39842023588` also passed all required jobs. No production secrets or schema changed.
- Final package `.memedrop/memedrop-extension-v0.0.3.zip` is 330543 bytes, SHA-256
  `b9452eeaed07dd6ca5014aaf5041baa3273abdcb9903312500ee052edbe099de`. ZIP files match
  production dist, version/hosts validate, and no localhost permission is packaged. Reloaded this
  final production build into Chrome after dry-run restoration. Disposable QA containers removed.
- Hosted verification: `/live`, `/health`, and privacy return 200; trend snapshot 156 is fresh.
  Privacy disclosures/effective date match source (the first check incorrectly searched internal
  event names rather than public prose; corrected check passes). First observed suggestion request
  returned 200 in 5533.4ms, cached repeat in 1322.7ms; both were empty for that fixed fixture. A
  second reviewed fallback fixture returned one captioned suggestion in 5224.2ms after provider
  timeout, within the 6.5s client allowance. New `rate-limit` and `http-app` timings and allowed-origin
  CORS headers were verified; application duration was approximately 4752ms on fallback. These
  samples do not establish cold-start or population p95 performance. No free source/caption retained.
- Status: live suggestions/native draft attachments, neutral/confirmed feedback, current source
  gates, migration-first production rollout, final package, and GitHub-account restoration are
  verified. Nothing was published on either social platform. Next action: observe beta latency
  and corrected feedback aggregates; broader human taste evaluation remains the assessment backlog.

## Suggestion production rollout — 2026-10-21

- Requested outcome: commit/push the deadline, measurement, feedback and privacy changes through
  GitHub `moyezr`, restore `moyez-dev`, apply production migration first, deploy API/privacy,
  build the production extension, and verify live X/LinkedIn suggestions and native attachment.
  Preserve unrelated historical progress edits and the local assessment artifact.
- Acceptance: fresh release gates and verified encrypted production backup; migration readback
  before any Git-triggered deployment; healthy API/web from the committed release; production
  extension package with confirmed live suggestion/attachment and corrected event evidence;
  no published social replies; active GitHub account restored to `moyez-dev`.
- Preflight: production configuration passed without warnings; existing API/web deployments and
  healthy snapshot 156 recorded for rollback. Backup `20261021T093724Z` contains 99 objects and
  18 tables at schema `20260902_0010`; restored/verified on isolated port 55433, encrypted with the
  existing AES-256/Keychain workflow, and the verified plaintext copy removed.
- Fresh release gates exposed Vite, certifi, and Pillow advisories. Update the affected locks to
  patched Vite 8.3.5, certifi 2026.10.19, and Pillow 13.0.0 without exceptions. Extension manifest/
  package advance together to 0.0.2; the package-test fixture now follows that version dynamically.
- Fresh full readiness passed with 499 API tests, 28 integration tests, all static/build/process/
  image/tuning gates, and clean npm/Python audits after those dependency updates. Release dry-run
  packaging also passed. GitHub Actions run `39580005586` passed, including the packaged browser
  flow, static, database/Redis integration, and backend image jobs; the conditional live model
  quality job was skipped. Benchmarks and promotion gates were not weakened.
- Release `56edd32` committed and pushed to `main` using the SSH identity verified as `moyezr`.
  The first HTTPS push was refused because the existing token lacks workflow scope; no scopes were
  expanded. GitHub CLI was restored to `moyez-dev` after both attempts and verified again afterward.
  Unrelated historical progress edits and the local assessment artifact remain unstaged.
- Applied production migration `20261021_0011` before pushing/deploying, with five-second lock and
  thirty-second statement limits; independent readback confirmed the schema and widened event
  constraint. This additive change does not rewrite historical events. No production env changed.
- API deployment `dpl_HBcpWoYU7bFZCWojAq3DYMN66dTq` and web deployment
  `dpl_5NNGUinPXkHHU8BcKZjfGaSzfMBw` are READY at `56edd32`; canonical aliases independently
  resolve to those deployments. `/live` and `/health` return 200; trend snapshot 156 remains fresh.
  Hosted privacy policy returns 200 and includes the October 21 corrected feedback disclosures.
- Built and validated the production-only extension 0.0.2 after the API became ready:
  `.memedrop/memedrop-extension-v0.0.2.zip` (329845 bytes), SHA-256
  `9e0706828a988db81ce47fd64a8d20fd5738e0102f73299564a58e9e4307f33b`.
  Manifest hosts include production API, X/Twitter, and LinkedIn; no localhost permission.
- Hosted black-box agent smoke passed with a fixed benchmark fixture: valid generation, identical
  idempotent replay, authenticated 56132-byte WebP, request IDs, and exactly one-credit settlement.
  Generation 3793.89ms, replay 215.45ms. Temporary operator key was revoked in `finally`; balance
  returned to zero and no active operator keys remain. No source text/captions/credentials retained.
- Live Chrome verification remains pending: signed-in X/LinkedIn and the existing unpacked
  extension were located, but concurrent window/tab changes interrupt native automation. Requested
  a brief idle personal Chrome window. Version 0.0.2 has not yet been reloaded into Chrome, no live
  draft attachments or corrected feedback events have been verified, and no replies were published.
  Production QA aggregates contain no version-2 events yet. Fixture success does not establish
  compatibility with today's platform DOM. Next action: reload the existing extension from its
  production `dist`, reload both social tabs, verify visible captions/native draft attachment,
  discard drafts, and inspect only safe feedback aggregates.
- Cleanup: release-only PostgreSQL/Redis containers were removed; unrelated services remain.
  Production backup is encrypted, temporary API keys are revoked, and `moyez-dev` remains active.

## Suggestion deadline, measurements, and feedback — 2026-10-21

- Requested outcome: implement the assessment's deadline and measurement fixes, correct feedback
  semantics, and verify the suggestion flow. Baseline `149d4b7`; preserve the existing progress
  edits and untracked October 19 assessment. Parallel agents own server budgets, feedback
  contract/persistence, and browser rendering/attachment behavior; integration and docs stay here.
- Bounded scope: one total server suggestion budget with fallback reserve and client transport
  margin; timings from explicit request to visible captioned preview and confirmed insertion;
  visible-impression, confirmed-insertion, clipboard, explicit-negative, and neutral-abandonment
  events with safe metadata and retry deduplication. No prompt/model, catalog, platform expansion,
  production deployment, or new analytics service.
- Acceptance: slow optional enrichment/provider cannot outlast the client before fallback;
  stale responses/media never update the active request; displayed timing waits for actual render;
  insertion requires native attachment confirmation; copying/closing are not positive/negative
  training signals; retried events count once. Verify focused and full repository gates plus a
  real Chromium suggestion/attachment fixture flow and PostgreSQL persistence integration.
- Implemented: five-second service budget/250ms fallback reserve; remaining model allowance capped
  at 4.5s; optional trend/feedback capped at 1.25s/1s; 6.5s client deadline including body reads.
  Provider timeout still opens cooldown; caller cancellation preserves shared inference. Browser
  diagnostics separate bytes from foreground-visible decoded caption previews and confirmed native
  attachments, with empty/failure/cancellation outcomes and no fabricated cache status.
- Feedback version 2 emits visible `shown`, selection `clicked`, confirmed `inserted`, `copied`,
  explicit `rejected`, neutral `abandoned`, `attachment_failed`, and `saved`. Copy/ordinary close
  do not imply insertion/rejection. PostgreSQL primary-key conflict handling deduplicates random
  tenant-scoped event identities before library increments; legacy records remain exportable but
  no longer train corrected ranking/reports. Only six reviewed context categories persist, plus
  random impression identity, bounded position, and version. No source/caption text is retained.
- Migration `20261021_0011` widens the historical event-action constraint, with a matching ORM
  check. It does not rewrite rows. Apply it before the API and then extension rollout. Verified
  on a second disposable database: fresh upgrade, downgrade refusal preserving a corrected event,
  and successful downgrade/re-upgrade after removing only that synthetic fixture. The first
  manual fixture lacked the required install email; corrected the fixture and reran successfully.
- Verification: original API suggestion/config baseline 68 passed, extension baseline 61 passed.
  Full `quality:deployment-readiness` passed: 499 API tests plus 28 real PostgreSQL/Redis
  integration tests, all workspace typechecks/tests/lint/builds, FastAPI process and Docker image
  smoke, deterministic tuning/dataset/render gates, and clean npm/Python security audits. The first
  concurrent run exceeded the unchanged scale latency ceiling; isolated rerun passed at 16.013ms,
  and the complete sequential rerun passed at 15.500ms (50ms ceiling), with no ranking changes.
- Final `quality:static` passed after the last cache-diagnostic/privacy changes; extension now
  69 tests, all passing. Store-readiness disclosure validation passed after naming the corrected
  outcomes and legacy compatibility; existing disclosure gates remain and now require new outcomes.
  Privacy sources, architecture, contracts, D011, and launch task are aligned. Final diff/link/
  anchor checks passed; AGENTS.md remains 73 lines. Pre-existing edits are preserved; no commits.
- `quality:suggestion-browser` / final packaged Chromium smoke passed nine scenarios through real
  loopback FastAPI with a stubbed provider: X/LinkedIn render+confirmed insert, unconfirmed upload
  copied only, neutral close, hanging trend/provider fallback, native Reply without inference,
  catalog failure, broken media without false impressions, and ignored late navigation results.
  Synthetic fixture screenshots were visually inspected. CI now runs this provider-free flow.
  Local run used an existing full Chromium executable via `MEMEDROP_CHROMIUM_EXECUTABLE`;
  normal/CI setup installs Playwright Chromium. No remote platform traffic or live model calls.
- Status: requested local implementation/verification complete. No hosted deployment, production
  data, credentials, model/prompt, or catalog changes. Diagnostics remain local; no new analytics
  service. Test containers/processes started here were removed; unrelated services stayed intact.
  Next action: review/commit the coherent change, then controlled migration/API/extension and privacy
  page rollout with real X/LinkedIn DOM QA. Local fixtures do not establish hosted compatibility.

## Luna production migration — 2026-10-19

- Requested outcome: switch the purpose-specific chat/vision model settings to
  `openai/gpt-6-luna` and deploy the API to production. The operator explicitly chose Luna's
  cost tradeoff after the comparative live samples and authorized production deployment.
- Scope: runtime and offline-tool defaults/examples, explicit local and production operator
  overrides, deployed model settings, and the saved-image tagging output schema needed for a
  working Luna path. Preserve embeddings, cadence, budgets, strict validation, and fallback.
- Acceptance: focused/live changed-path checks, full repository readiness and release dry-run,
  a fresh verified/encrypted production backup, a committed clean release, production environment
  model readback, healthy deployment, and a bounded hosted user-flow smoke. Inspect deployed
  embedding configuration before syncing any operator-file drift. Existing progress edits and
  evaluation reports remain intact.
- Implementation: four runtime defaults and all offline template defaults/examples now select
  Luna; matching ignored local/operator overrides are updated. Deployed readback confirmed Gemini
  Embedding 2, and the stale operator-file value was reconciled to it without changing hosted
  embeddings. Saved-image tagging now sends its existing strict JSON schema; two live fixture
  calls returned non-fallback, valid seven-field tags. No catalog data or prompt taste changes.
- Verification: focused baseline 67 passed; updated focused suite 68 passed and template pipeline
  nine passed. Full `quality:deployment-readiness` passed: 479 API tests, 26 integration tests,
  static analysis/builds, process smoke, deterministic tuning, backend image smoke, and clean npm/
  Python audits. The first integration setup lacked schema privileges because the cached local
  pgvector-tagged image uses Supabase roles; corrected only the disposable test container role and
  database ownership, then reran the complete gate successfully. `release:dry-run` passed.
- Production environment preflight passed with zero warnings. Backup `20261019T064705Z` contains
  98 objects and 18 tables, schema `20260902_0010`; restored/verified on isolated port 55433,
  archived with the existing AES-256/Keychain workflow, and removed the verified plaintext copy.
  Release commit, environment synchronization, deployment, and hosted smoke are next.

## Three-model evaluation rerun — 2026-10-19

- Outcome: compare DeepSeek V4.1 Flash 1017, GPT-6 Luna, and Claude Haiku 5.5 now that DeepSeek
  has eligible endpoints. Scope: development-key live fixture evaluations only; no production
  configuration, data, catalog, privacy, or scheduler changes.
- Acceptance: identical fixed cases and current production budgets, balanced model ordering,
  repeated measurements of successful usable output, strict caption validity, family relevance,
  latency and provider-reported charges; equal secondary-path checks and a qualified recommendation.
  Human humor judgment remains separate from mechanical scores. Baseline `05a4abe`; preserve the
  existing PROGRESS.md edits and October 17 evaluation report.
- Completed [three-model rerun](docs/model-evaluation-2026-10-19.md): 36 primary interactive calls
  per model with balanced ordering, identical per-case payloads apart from model, and unchanged
  production budgets. DeepSeek/Luna each returned usable captions on 35/36 calls; Haiku 33/36.
  DeepSeek led strict validity (82.3% versus 76.2%/76.9%), valid-caption yield (144 versus 93/120),
  and acceptable-family coverage (34/36 versus 31/36 and 30/36). Median latency 1.76s versus
  3.23s/3.19s. Reported primary charges: $0.02354/$0.00773/$0.02246, excluding unreturned timeout
  charges. Prefer DeepSeek for interactive quality/speed; Luna remains the minimum-cost choice.
- Equal exploratory price-routing pass, twelve calls each: DeepSeek fell to 8/12 usable versus
  Luna 12/12 and Haiku 9/12. Keep latency-first routing for the DeepSeek interactive candidate.
  Three trend fixtures passed for all models; DeepSeek/Luna trend charges were effectively tied.
  Explicit caption cases: DeepSeek/Luna 2/2, Haiku 1/2; Luna cheaper. One-image pipeline checks
  passed for all; image tagging still falls back for all and needs a schema/prompt repair.
- 171 measured calls report $0.07504 in usage; eight cancelled calls have unknown returned cost.
  All used the development key. Fixed-fixture raw results and an anonymous review sheet remain
  ignored in `.memedrop/model-eval-20261019/`. Human humor scores remain blank; no model judge or
  fabricated human review. No production, privacy, storage, or catalog changes were made.
- Fresh baseline: 31 focused tests passed; deterministic 104-case benchmark and case-level
  baseline passed, 5000-template warm p95 14.97ms. Documentation links, credential-pattern and
  whitespace checks, anonymous-sheet identity/resource checks, the 73-line AGENTS.md limit, and
  `git diff --check` passed. Development-key usage increased $0.07805 during the run. Next action:
  human taste review and a purpose-specific migration with applicable tuning/release gates.

## Model cost evaluation — 2026-10-17

- October 19 follow-up: DeepSeek is now accessible with the existing development key. A minimal
  probe and a JSON/reasoning/routing-compatible probe returned HTTP 200; the latter used Together.
  Public metadata now lists fifteen endpoints versus the one observed October 17. No privacy or
  application setting was changed. Earlier blocking is historical; DeepSeek task quality remains
  unmeasured, and the model comparison should be completed before treating Luna as the final choice.
- Outcome: verify current trend refresh cadence and compare the three requested OpenRouter
  candidates against Gemini 3.7 Flash for quality, latency, compatibility, and cost.
- Scope: read-only hosted inspection and bounded live evaluations using repository fixtures;
  no production model, scheduler, storage, or catalog changes. Acceptance: live scheduler readback,
  current provider pricing, comparable case-level results under existing timeouts, and a documented
  recommendation with unverified paths and human-review requirements explicit.
- Baseline: `05a4abe`; the pre-existing uncommitted October 13 PROGRESS.md section is preserved.
  Focused caption evaluation, trend enrichment, and trend runtime tests: 31 passed.
- Completed [comparison and recommendation](docs/model-evaluation-2026-10-17.md): live QStash
  confirms daily 00:00 UTC / 05:30 IST; health is fresh, snapshot 154, five cards, 48-hour limit.
  Production key spending before probes: $1.06505 this month, $0.029883 today. Read-only production
  aggregates show no customer generations in 30 days; scheduled maintenance remains the leading
  attribution. About 321 search/enrichment opportunities per 30 days at the current cadence.
- Prefer Luna for a text-model migration: 24/24 joint cases completed versus Haiku 20/24;
  measured p95 3.53s versus 4.51s. Luna's strictly valid-caption rate was lower (74.2% versus
  81.4%), so this is a candidate recommendation pending human taste review, not rollout approval.
  Both passed three trend fixtures, two explicit-caption cases, and a one-image offline pipeline
  smoke. DeepSeek is blocked by existing account training/privacy policy, preserved unchanged;
  Gemini joint requests reject reasoning disabled. Auto-tagging falls back for all tested models;
  accessible finalists' diagnostics confirm response/schema mismatch requiring a prompt repair.
- Live metadata shows Luna/Haiku $0.10/$0.50 per million uncached input/output tokens, versus
  Gemini $0.75/$3.75. DeepSeek $0.15/$0.60 off-peak is not cheapest for uncached requests.
  Total development-key usage today at final inspection: $0.04334; one production-key connectivity
  probe added $0.0000072. No production settings, scheduler, privacy policy, catalogs, or storage
  were changed. Latest published vectors use Gemini Embedding 2, while the ignored operator file
  names OpenAI embeddings; reconcile that drift before any future deployment.
- Deterministic fallback benchmark: all gates passed on 104 cases, no baseline regressions;
  5000-template warm p95 14.79ms. Reports and fixture-only review artifacts remain ignored under
  `.memedrop/model-eval-20261017/`; sanitized results and remaining rollout requirements are in
  the linked report. Documentation local-link checks, credential-pattern inspection, the 73-line
  AGENTS.md limit, and final diff/whitespace review passed. Next action: human taste review and
  a purpose-specific Luna migration, beginning with trends; resolve tagging/schema and embedding
  configuration findings before any production rollout.

## Current maintenance change — 2026-10-07

- Baseline: `b19fd28` on `main`; the working tree was clean at startup.
- Requested outcome: reduce production trend refresh to daily and both cleanup jobs to weekly.
- Scope: QStash daily at 00:00 UTC, Vercel/backup cleanup Sundays at 03:30/03:40 UTC,
  a 48-hour freshness bound, matching configuration, maintenance/privacy documentation, and tests.
- Acceptance: live scheduler readbacks show the requested cadence; deployed `/health` uses the
  new freshness bound; applicable local gates pass; expired media still becomes inaccessible at
  30 days; the published privacy disclosure reflects weekly physical cleanup.
- Status: completed; API/web deployments, all three scheduler cadences, health freshness,
  and the published privacy disclosure verified. Focused baseline: 44 passed;
  updated focused boundary suite: 49 passed.
  Fresh production backup completed with 98 objects. Local readiness gate initially failed on a
  privacy contract assertion that still required daily cleanup; that assertion now matches weekly
  cleanup. Default local service ports belong to another project, so tests use isolated ports.
  Runtime, tuning, 26 database/Redis integration tests, and backend image smoke subsequently passed.
  The security gate then reported pre-existing locked npm vulnerabilities in Next.js, sharp,
  fast-uri, source-map-js, and undici, followed by PyJWT and urllib3; compatible dependency updates
  are included to unblock deployment, with no audit exceptions. Both npm and Python audits now pass.
  Fresh extension tests also exposed two stale tests assuming the live privacy document contained
  launch placeholders. Those cases now use an explicit draft-policy fixture via a validator input;
  all original placeholder/screenshot assertions remain intact and default policy validation is
  unchanged. Extension tests: 61 passed; root launch-status tests: eight passed.

## Production evidence

Checked on 2026-10-07 against the configured production services:

- PostgreSQL queries ran in an explicitly read-only transaction with a 12-second statement timeout;
  only aggregates, categorical values, and timestamps were returned. No customer free text or
  credentials were captured.
- Customer `users`: one account, with `auth_provider=operator`; zero customer OAuth accounts and
  zero new accounts in the last 30 days. Anonymous extension `install_users`: zero; usage events: zero.
- API keys: six historical keys, all revoked; zero owners active in the last 7 or 30 days.
- Generations: four lifetime attempts (two succeeded, two `no_fit`), all from the operator account;
  zero attempts in the last 30 days. Latest successful generation: 2026-09-06 08:55 UTC.
- Production `/health`: HTTP 200, database available, fresh trend snapshot, version 146, 15 cards.
- Tavily usage API: 172 of 1,000 account plan credits used; production key search usage also 172.
  Application ledger agrees for October; September reserved 707 credits. Ledger entries are
  reservations, not an independent measurement of provider charges.
- OpenRouter production key: $3.83744487 lifetime usage, $0.63647103 this month, $0.22363404 this
  week, $0.05617451 today. Account-wide purchased credits: $10; usage: $9.785148967; remaining:
  $0.214851033. Account spending outside this key is not attributed to production.
- Vercel dashboards inspected in Chrome profile `Moyez (Moyez Personal)`:
  - Landing analytics, last 7 days: two visitors, four page views, zero currently online.
    Analytics was added on October 5; visitors are not authenticated customer counts.
  - API usage, last 30 days (September 7–October 7): approximately 9,500 function invocations,
    5h 9m Fluid Active CPU, 19.5 GB-hours Fluid Provisioned Memory, eight build CPU minutes.
    Active CPU exceeds the documented four-hour Hobby monthly allowance; this rolling window
    does not establish the exact current billing-cycle percentage.
  - Landing usage, same rolling window: ten function invocations and memory rounded to zero GB-hours.
  - API observability, last 12 hours: approximately 165 invocations and 17s CPU; 46.9% cold starts.
    The function table groups the backend under `/fastapi`. Exact request-path breakdown requires
    Pro and displayed demo data, which was excluded from findings.
- Before this change, runtime code/runbooks showed a four-hour QStash trend refresh, a ten-minute health monitor, and
  daily primary/backup asset cleanup. Trend workflows run each of 21 curated queries as a separate
  step, including queries whose daily/weekly scan bucket has already completed. Background work is
  the leading explanation for spend with no recent customer generation; historical CPU attribution
  between workflow, health checks, cold starts, and other requests remains unverified.

## Limitations and next action

- Vercel CLI authentication worked, but current-period and October custom-range usage commands
  returned `Costs not found (404)`; the browser dashboard supplied usage evidence.
- Follow-up attribution: the configured regional QStash host returned HTTP 200 and confirmed the
  trend schedule is active, `0 */4 * * *`, with three retries. The default host used earlier was
  incorrect for this account. Live cron-job.org details confirmed the health monitor is enabled
  every ten minutes and backup cleanup is enabled daily at 03:40 UTC, both without response capture.
- Expected background volume per 30 days: health checks 4,320; trend workflow steps approximately
  4,500–5,400 (180 refreshes, roughly 25–30 HTTP invocations each); cleanup approximately 60.
  This is a schedule/code estimate, not exact historical route attribution. The workflow includes
  21 query steps and four fixed coordination steps, plus initial/final requests and embedding batches;
  daily/weekly collection skips still execute a workflow HTTP step.
- Recent Vercel request logs exposed eight retained requests: seven successful `/health` requests
  and one `/` request returning 404. No customer generation was present in that sample. This limited
  sample cannot rule out older unsolicited traffic. QStash delivered-log filtering for the public
  workflow URL returned no records; it did not provide a historical invocation count.
- Cadence changes are now applied to the live schedulers. The ten-minute health monitor remains
  enabled and accounts for an expected 4,320 monthly invocations. Future cost work can measure
  health-check/cold-start CPU and avoid unnecessary workflow steps. Trend freshness is now 48 hours.
- Hosted analytics ingestion is now observed; this does not establish broader release readiness.
- The initial investigation was read-only; the subsequent maintenance rollout is verified by
  the local and hosted evidence below.

## Maintenance release verification

- Full `quality:deployment-readiness`: passed against isolated PostgreSQL/pgvector at port 55433
  and Redis at port 56380. Includes typecheck, tests (478 API tests plus 26 integration tests), lint,
  all builds, API process smoke, deterministic tuning, backend image smoke, and clean npm/Python
  security audits. New freshness tests preserve missing/empty/stale failures and check the 48-hour
  boundary, including an overdue daily refresh. Existing expiry/media and cleanup safeguards pass.
- `release:dry-run`: passed, including release metadata and extension package validation.
- Production configuration preflight with the proposed 172800-second freshness setting: no errors
  or warnings. Documentation links, the 73-line AGENTS.md, and `git diff --check`: passed.
- Production backup 20261007T111609Z: 18 tables, schema 20260902_0010, 98 objects; hashes and
  restore verified in the isolated local database. Archived with the existing AES-256/Keychain
  workflow and removed the verified plaintext copy. The restore helper was temporarily adapted
  only to the isolated local port because another project owns port 5432.

## Hosted maintenance rollout

- Committed implementation: `af3cfb7`; deployments use a clean Git archive of that commit, excluding
  ignored operator credentials and local artifacts. Updated the ignored production operator file
  and Vercel production setting one-way to `MEMEDROP_TREND_SNAPSHOT_MAX_AGE_SECONDS=172800`.
- API deployment `dpl_8oKuEWY4hb9DcbpLoLyXB864PRMr`: READY. Live project cron definitions show
  `/internal/cron/assets/cleanup` with `30 3 * * 0` (Sundays at 03:30 UTC). Production `/health`
  returns HTTP 200 with a fresh snapshot and the 172800-second freshness limit.
- Existing QStash schedule `scd_65aL78hRe3wTQPur3VQFoEJVmfVY`: updated in place to `0 0 * * *`
  and read back active with three retries. Destination, method, headers, body, and retry count
  match the previous configuration. No duplicate schedule was created.
- cron-job.org cleanup job `8393375`: updated in place to Sunday at 03:40 UTC and read back
  enabled with response capture disabled. Other request, notification, and credential settings
  were compared in memory and preserved. No cleanup or paid trend refresh was manually triggered.

- Web deployment `dpl_HawmFz4L1FNG5az6GwPmEoAHa6Xj`: READY. Production landing, docs,
  privacy policy, and sign-in routes return HTTP 200. Published privacy HTML contains weekly cleanup,
  the preserved 30-day access expiry, and effective date October 7, 2026. API `/live` and `/health`
  both return HTTP 200. Read back the unchanged, enabled ten-minute health monitor.
- Next scheduled executions remain future events; no paid refresh or destructive cleanup was
  forced for verification. Expected background invocations fall to roughly 5,100–5,200 per 30 days;
  the unchanged health monitor still contributes 4,320. Trend refresh frequency falls by 83%.
- Isolated test containers were stopped and removed; other projects' running services were left
  intact. Temporary deployment archives and diagnostic files were removed after recording evidence.
- Implementation and rollout handoff were pushed to GitHub `main` after the direct production
  deployment was verified, preserving the new configuration for future Git-based deployments.
