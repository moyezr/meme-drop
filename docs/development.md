# Development and verification

Read this for code, dependency, test, or build changes. These rules carry forward the repository
guide at `3819bf6`; [DECISIONS.md](../DECISIONS.md) records the durable boundaries and review triggers.

## Toolchain and ownership

- Use Node.js 22.12+, npm 11, and Python 3.13 with uv for `apps/api` only.
- Use `npm ci` and `uv sync --project apps/api --frozen` for reproducible setup. Keep dependency
  locks exact; update the owning manifest and lockfile together for intentional dependency changes.
- TypeScript stays on 7.x except `apps/web`, which stays on 6.x for framework compatibility.
  `@types/node` stays on major 22. Revisit these holds during dependency maintenance.
- Keep the backend self-contained. Do not move Python metadata out of `apps/api` or add a second
  backend. Consult the [workspace map](../README.md) before choosing where code belongs.
- Browser code must not acquire storage credentials or perform catalog promotion. The local
  template pipeline creates machine drafts; it does not become a serving backend.
- Add regression tests at the closest changed boundary. Do not hide failures with broad skips or
  depend on live model providers for deterministic tests.

## Choose checks from the change

Run a focused check before and during implementation, then the applicable gates before completion.
Run commands from the repository root. Multiple matching rows are cumulative; a combined gate can
satisfy its constituent checks without rerunning them on the same unchanged code.

| Change | Required verification |
| --- | --- |
| Documentation only | Review instructions against code/scripts, check local links and anchors, verify AGENTS.md remains under 100 lines, and run `git diff --check`. Runtime suites are unnecessary unless behavior or configuration also changes. |
| Application, shared, or tooling code | Focused boundary tests, then `npm run typecheck`, `npm test`, `npm run lint`, and `npm run build`. |
| API | Also `npm run test:api`, `npm run lint:api`, and `npm run quality:api-process`. |
| Extension suggestion timing, rendering, or attachment | Also `npm run quality:suggestion-browser`; see [browser setup and scope](../QUALITY.md#latency-and-availability). |
| Persistence or migrations | Also start local services with `npm run db:up` and run migrations/integration tests against a disposable database as below. |
| Containers | Also `npm run quality:backend-image` (Docker required). |
| Ranking, captions, catalog annotations, or feedback | Focused tests plus `npm run quality:benchmark`, `npm run quality:suggestions`, and `npm run quality:dataset-plan`. Read [QUALITY.md](../QUALITY.md). |
| Quality tuning | Also `npm run quality:tuning`; inspect every case-level regression before regenerating a ranking baseline. |
| Dependency or release changes | Run `npm run quality:security` before pushing. Use the [release gates](release.md) for a release candidate, including `npm run release:dry-run`. |

For migration/integration verification, provision a disposable local PostgreSQL/pgvector database;
the URLs below assume it already exists. Keep test services separate from production and user data.

```sh
npm run db:up
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/memedrop_integration \
MEMEDROP_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/memedrop_integration \
MEMEDROP_TEST_REDIS_URL=redis://localhost:6379/0 \
  npm run quality:api-integration
```

`quality:api-integration` applies Alembic migrations and invokes `test:api:integration`. Missing
services or skipped integration tests are a verification gap, not a passing persistence check.
For a complete local release proof, follow `quality:deployment-readiness` in [release.md](release.md).
CI's enforced gates live in [quality.yml](../.github/workflows/quality.yml).

## Verify the outcome and leave evidence

- For changed behavior, exercise the affected API or browser workflow, including its relevant
  failure path. Use API process smoke, real database integration, or browser QA as appropriate;
  compilation alone cannot verify a user flow.
- For an authorized hosted generation smoke, use [apps/smoke-agent](../apps/smoke-agent/README.md).
  It consumes credits on a new successful generation; it is not a local bootstrap check.
- Use existing request IDs, health checks, `Server-Timing`, categorical events, and test assertions
  to diagnose failures. Keep source text and credentials out of retained evidence. Operational
  diagnosis belongs with the [runbooks](private-beta-operations.md).
- In [PROGRESS.md](../PROGRESS.md), record the command, result, tested revision/scope, and any
  missing verification. Link sanitized durable evidence when available; ignored `.memedrop/`
  reports alone will not be available in a fresh checkout.
- Review `git diff` and `git status --short`; preserve other people's work. A clean handoff means
  understood, documented changes, even when the user already has an unfinished working tree.
