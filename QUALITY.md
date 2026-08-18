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
npm run quality:tuning
```

The benchmark corpus covers reply intents and records several acceptable families plus explicit
rejections. The deterministic API evaluation enforces:

- acceptable-family retrieval of at least 70% at top 1, 80% at top 3, 90% at top 5, and 98% in
  the 12-template model shortlist;
- avoidance of explicitly wrong families in both the visible top five and model shortlist;
- specific, short, non-generic captions;
- text that fits verified overlay regions;
- overlay availability for returned templates;
- graceful model failure and deterministic fallback behavior.

It also creates a synthetic 5,000-template catalog from the verified metadata and fails if warm
local ranking p95 exceeds 50ms. Keep the scale fixture separate from relevance evaluation: it guards
algorithmic cost, not taste. Do not weaken benchmark cases or thresholds to accommodate a ranker
change.

`quality:tuning` is the pre-tuning acceptance gate. In addition to aggregate floors, it compares
every deterministic benchmark result with `suggestion-ranking-baseline.json`. Any worse acceptable
rank or newly introduced wrong-family result fails even when aggregate metrics still look healthy.
If a reviewed trade-off is intentional, regenerate the baseline explicitly and review its diff:

```sh
cd apps/api
uv run memedrop-suggestion-eval --write-baseline
```

The same gate runs shared production-renderer tests and the verified catalog audit. The catalog has
25 recorded annotation warnings today (missing contrastive examples or incomplete region examples),
so the gate permits at most that known debt and fails if tuning introduces more. Reduce this ceiling
as those annotations are repaired; do not raise it to make a change pass.

Deterministic tests cannot honestly grade whether a joke is funny. Before changing the joint prompt,
post context, trend context, or hosted model, capture the same fixed 12-case live sample before and
after the change:

```sh
npm run eval:captions -- --out .memedrop/caption-eval-before.json
npm run eval:captions -- --model <candidate-model> \
  --out .memedrop/caption-eval-candidate.json
```

The report records shortlist, selected template, raw region captions, strict contract validity, and
provider latency. Score every suggestion from 1–5 for post fit, comic turn, template fit, and caption
readability using the empty `human_review` fields. Compare the same case IDs; do not accept an
average improvement that introduces a severe failure or materially worsens p95. Reports remain
under ignored `.memedrop/` because they are experiment artifacts, while the fixed sample definition
is reviewed in the repository.

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
- record the reviewed font family/weight, fill and stroke colors, line height, padding, text
  transform, alignment, normalized coordinates, line count, and rendered character capacity for
  every region;
- set `max_chars` to actual rendered capacity;
- write realistic good examples that fit and bad examples that identify common failures;
- document reusable joke shapes, use cases, anti-use cases, aliases, and semantic tags;
- visually inspect the rendered meme rather than approving JSON alone.

The durable internal catalog workbench uses local PostgreSQL for draft metadata and the configured
development storage backend for media. Start it with:

```sh
npm run db:up
npm run db:migrate
npm run dev:api
npm run dev:catalog
```

Open `http://localhost:5174`. The internal API routes are not mounted in production.
Set `MEMEDROP_STORAGE_BACKEND=s3` and `S3_BUCKET_NAME=meme-drop-dev` in the ignored development
environment when source media should live in Supabase Storage. A draft may copy an existing
template's annotations, but local `approved` state still does not alter the runtime catalog.

Before local approval, open **Render QA**, inspect every good example with the production renderer,
and resolve missing copy, truncation, or overflow. Recording a clean review stores a server-owned
fingerprint. Any later edit to caption regions, font treatment, or good examples clears that review
and requires another visual pass. Impact preserves the legacy fast path. Anton and Inter are bundled
with both the workbench and extension, so a selected custom face is loaded locally and rendered the
same way in QA and the published meme; no font CDN is used at request time. Custom preview copy is
exploratory and does not count as review evidence.

For a disposable, database-free annotation page, generate the older browser-local workbench:

```sh
npm run dataset:annotate-template -- --template <template-id>
```

Open the generated `.memedrop/template-annotation-<template-id>.html` file while the backend is
running. Both workbenches create drafts only. Continue through the normal audit, rendered QA,
review, benchmark, and promotion steps; never copy an editor result directly into the verified
runtime catalog.

This reviewed catalog is product data, not incidental configuration. It is the reusable layer that
lets the same caption model understand how each image communicates and lets new templates improve
without extension releases. Prefer adding a general joke shape and labeling templates that enact it
over adding a template-ID special case to the ranker.

Quality is allowed to reduce result count. The model may omit weak templates, and the service must
not refill those slots merely to reach five. When the provider is unavailable, return only captions
from reviewed, template-specific fallback strategies; never populate arbitrary regions with generic
post fragments. A caption that repeats a region with a filler suffix such as `again` is invalid.

Normal review loop:

```sh
npm run manifest:audit:all --workspace=@memedrop/template-tools
npm run dataset:qa-expansion
npm run dataset:taste-review
npm run dataset:review-decisions
npm run dataset:promotion-plan
npm run dataset:benchmark-stubs
```

For the development-only 1,000-source experiment, rank the completed machine drafts before opening
the human review queue. Supplying the draft-catalog evaluation report adds real top-five and
shortlist exposure to the priority score:

```sh
uv run --project apps/api memedrop-suggestion-eval \
  --catalog .memedrop/template-pipeline/manifest.json \
  --include-drafts --no-baseline \
  --out .memedrop/template-pipeline/suggestion-eval.json
npm run manifest:scale-review-plan --workspace=@memedrop/template-tools -- \
  --evaluation .memedrop/template-pipeline/suggestion-eval.json
```

This plan is a triage artifact, not approval evidence. It prioritizes benchmark families, frequently
returned drafts, popular sources, novel families, and mechanically suspicious annotations. Human
rendered QA and benchmark review remain mandatory.

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

1. rank every verified candidate locally, using catalog-owned positive/anti BM25 signals plus
   structural, semantic, feedback, and diversity signals;
2. cache catalog candidates and short-lived feedback scores, and share concurrent identical work;
3. perform independent candidate and feedback reads in parallel on a cold request;
4. send a diversified shortlist of no more than 12 templates to one joint select-and-caption call;
5. return no more than five results, with a 4.5-second provider deadline and local fallback/cooldown;
6. render thumbnail previews while prefetching original assets for attachment in parallel;
7. inspect API `Server-Timing` and local extension ready-to-attach timings before changing
   infrastructure.

The joint call reuses the deterministic context analysis as a bounded comedy brief: reply voice,
joke target, social dynamic, comic tension, humor angle, and at most three caption anchors. Each
shortlisted template contributes its reviewed visual grammar, joke shapes, region roles and limits,
and one contrastive good/bad example. These are hints rather than facts; the raw post remains
canonical. Captions must enact the post's comic turn through every required visual region, not
paraphrase the post or copy an example. This adds no model call or network hop.

The interactive joint call uses a small general model with reasoning disabled, a 600-token output
ceiling, and latency-first provider routing. Large long-horizon reasoning models are intentionally
excluded from this path: their extra deliberation does not improve this bounded creative task enough
to justify regularly exhausting the request deadline. Record live taste and latency samples before
changing `OPENROUTER_SUGGESTION_MODEL`; deterministic tests alone cannot qualify a hosted model.

Model configuration is purpose-specific. `OPENROUTER_SUGGESTION_MODEL` owns the hot joint
selection-and-caption request, `OPENROUTER_CAPTION_MODEL` owns the explicit caption endpoint,
`OPENROUTER_AUTO_TAG_MODEL` owns saved-image vision tagging, and `OPENROUTER_TEMPLATE_MODEL` is
loaded only by offline template-generation tools. Do not reintroduce one shared model variable: the
latency, vision, and quality requirements of these paths are different.

The catalog seeder produces the thumbnail path for new rows and backfills missing ones on rerun. Run
`npm run db:seed-memes` as a controlled release operation after deploying this pipeline; never seed
inside a serverless build.

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
from `apps/api/uv.lock` for `pip-audit`. Any npm or Python advisory fails the gate; update to a
patched dependency rather than adding a standing exception.

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
