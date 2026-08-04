# MemeDrop quality playbook

The release standard is simple: the first suggestions should fit the social shape of the post,
captions should feel human and remain readable, and the strip should arrive quickly even when an
external model is slow or unavailable.

## Automated gates

Use the smallest relevant check while developing, then run the release gate before a deployable
checkpoint:

```sh
npm run typecheck
npm test
npm run lint
npm run build
npm run quality:api-process
npm run quality:backend-image
npm run quality:security
npm run release:dry-run
```

`quality:static` combines monorepo typechecks, tests, lint, builds, and verified-template audit.
`quality:promotion` adds FastAPI process startup, benchmark/catalog gates, extension metadata, store
template validation, and the release-origin build. `release:dry-run` adds security auditing and a
validated extension zip.

The API suite uses deterministic in-memory collaborators by default. Test real SQLAlchemy/Alembic
behavior against PostgreSQL/pgvector with:

```sh
npm run db:up
MEMEDROP_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/memedrop \
  npm run test:api:integration
```

New features need tests at each boundary they change. Do not replace route tests with service-only
tests, and do not make model-backed tests depend on a live provider.

## Suggestion evaluation

```sh
npm run quality:benchmark
npm run quality:suggestions
```

The benchmark corpus covers reply intents and records several acceptable families plus explicit
rejections. The deterministic API evaluation enforces:

- expected-family retrieval at top 3 and top 5;
- avoidance of explicitly wrong families;
- specific, short, non-generic captions;
- text that fits verified overlay regions;
- overlay availability for returned templates;
- graceful model failure and deterministic fallback behavior.

When changing ranking, record stage timings and compare results on the same corpus. Relevance,
diversity, caption quality, fallback availability, and p95 latency are joint constraints; an average
score improvement does not justify a slow or brittle request path.

Inspect accumulated product feedback before changing personalization weights:

```sh
DATABASE_URL=postgresql://... npm run dataset:usage-feedback -- \
  --days 30 --min-shown 20 --out .memedrop/usage-feedback-report.json
```

Treat outcome rates as prioritization signals, not automatic truth. Low use can mean poor retrieval,
weak art, stale cultural fit, or simply too few impressions.

## Template curation

Only `verified` templates enter normal suggestions. Generated templates start as `draft` and must
pass mechanical checks, human taste review, rendered QA, benchmark coverage, and promotion.

For every template:

- place overlay regions on canonical text/empty space, away from faces and the visual punchline;
- set `max_chars` to actual rendered capacity;
- write realistic good examples that fit and bad examples that identify common failures;
- document use cases, anti-use cases, aliases, and semantic tags;
- visually inspect the rendered meme rather than approving JSON alone.

Normal review loop:

```sh
npm run manifest:audit:all --workspace=@memedrop/template-tools
npm run dataset:qa-expansion
npm run dataset:taste-review
npm run dataset:review-decisions
npm run dataset:promotion-plan
npm run dataset:benchmark-stubs
```

Edit exported benchmark stubs into realistic cases with at least three acceptable families and clear
rejections. Then validate/import them and promote only the reviewed batch:

```sh
npm run dataset:benchmark-import -- --file .memedrop/suggestion-benchmark-stubs.json
npm run dataset:benchmark-import -- \
  --file .memedrop/suggestion-benchmark-stubs.json --write
npm run dataset:review-decisions:promotion
npm run quality:dataset-plan
npm run dataset:promote-reviewed
npm run quality:promotion
npm run quality:suggestions
```

Generated QA, plans, and review files belong under `.memedrop/` and remain untracked. Promote a small
batch at a time so a regression is attributable and reversible.

## Latency and availability

The external inference path is more likely to dominate latency than PostgreSQL or pgvector. Keep the
pipeline ordered around that fact:

1. retrieve and rank a bounded local candidate set;
2. cache normalized context analysis where privacy permits;
3. make optional model reranking/captioning bounded and timed;
4. batch caption work for only the top verified candidates;
5. retain contextual deterministic captions for timeout/provider failure;
6. use measured stage timings before changing infrastructure.

Measure the hosted object-storage round trip from the deployment region with:

```sh
npm run storage:check
npm run storage:latency
```

The latency form temporarily writes, reads, and deletes `_health/<uuid>.txt`. Run it against both
environment buckets after credentials and regions are configured.

Rate-limit behavior has deterministic unit coverage and a real Redis integration test. Run the
integration suite with both local services available:

```sh
MEMEDROP_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/memedrop \
MEMEDROP_TEST_REDIS_URL=redis://localhost:6379/0 npm run test:api:integration
```

## Dependency security

`npm run quality:security` audits the complete npm lock graph and exports the FastAPI production set
from `apps/api/uv.lock` for `pip-audit`. Any new Python advisory fails immediately. npm findings pass
only when every advisory exactly matches one of two reviewed, version-pinned policies:

- build-time packages pulled by the latest Next.js static-export stack;
- the nested Vite 5/esbuild copy inside the latest CRXJS build plugin.

Those packages are not landing server or extension runtime code, but they still remain tracked risk.
The exceptions expire on 2026-09-01. A dependency version change, advisory change, or expiry fails
the gate and requires a fresh review; the command does not mean `npm audit` reports zero findings.

The landing workspace intentionally holds TypeScript 6 until stable Next.js supports the TypeScript
7 compiler API. `@types/node` stays on major 22 to model the deployed Node 22 runtime. Revisit both
holds during dependency maintenance rather than overriding framework/runtime compatibility.

## Human release QA

After automated gates pass, test the packaged extension against the production API on X:

- suggestions load and recover from provider failure;
- captions are readable at preview and inserted size;
- click and drag/drop insert the expected image;
- saving, listing, editing, and deleting library images work;
- shown/clicked/used/saved/dismissed events reach the correct install identity;
- account export and deletion affect only the current install;
- cross-origin media loads from `/memes/...` without exposing object-store URLs or keys.

Public release metadata, domains, privacy, and store assets are tracked in `docs/release.md`.
