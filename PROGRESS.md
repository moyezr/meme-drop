# MemeDrop progress

This is the current session handoff. Replace stale state; git retains history. The
[launch plan](docs/production-launch-plan.md) owns the backlog and
[DECISIONS.md](DECISIONS.md) owns durable choices. Local checks do not establish hosted readiness.

## Current maintenance change — 2026-10-07

- Baseline: `b19fd28` on `main`; the working tree was clean at startup.
- Requested outcome: reduce production trend refresh to daily and both cleanup jobs to weekly.
- Scope: QStash daily at 00:00 UTC, Vercel/backup cleanup Sundays at 03:30/03:40 UTC,
  a 48-hour freshness bound, matching configuration, maintenance/privacy documentation, and tests.
- Acceptance: live scheduler readbacks show the requested cadence; deployed `/health` uses the
  new freshness bound; applicable local gates pass; expired media still becomes inaccessible at
  30 days; the published privacy disclosure reflects weekly physical cleanup.
- Status: local gates verified; production rollout pending. Focused baseline: 44 passed;
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
- Runtime code/runbooks show a four-hour QStash trend refresh, a ten-minute health monitor, and
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
- No spending controls were changed. Next cost-reduction work should address idle trend refresh,
  avoid unnecessary workflow steps, and measure health-check/cold-start CPU. Any cadence or pause
  change must account for the existing eight-hour trend-freshness readiness contract.
- Hosted analytics ingestion is now observed; this does not establish broader release readiness.
- Documentation-only handoff reviewed against captured aggregates and source contracts;
  `git diff --check` passed. Runtime behavior did not change, so runtime suites were not run.

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
