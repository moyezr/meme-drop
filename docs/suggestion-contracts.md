# Suggestion and catalog contracts

Read this when changing ranking, captions, feedback, cache identity, catalog annotations, or shared
rendering. These constraints were moved from AGENTS.md at `3819bf6`; [architecture.md](../architecture.md)
explains the flow and [QUALITY.md](../QUALITY.md) owns evaluation and promotion procedures.

## Input, privacy, and caching

- Source-post text is canonical. Optional user steering is an untrusted creative preference and
  cannot bypass template eligibility, region, safety, or length constraints.
- Keep free text out of logs, persistence, usage events, and plaintext cache keys. Telemetry may
  retain only reviewed categorical context such as `suggestion_mode`.
- Include every request-shaping input in both client and server cache identity. Hash sensitive
  values, and use request generations so stale results or media cannot replace newer suggestions.
- New feedback persists only mode, sentiment, tone, topic, intent, and intensity plus random
  event/impression identity, bounded position, and telemetry version. Version 2 `shown` requires a
  visible rendered preview; `inserted` requires native confirmation. Copy, close/abandonment, and
  attachment failure are neutral. Deduplicate retries atomically before counting insertion or
  learning; ambiguous legacy events must not enter version 2 learning/reports.
- Separate performance samples allow only random retry UUID, X/LinkedIn, extension version,
  bounded durations/counts and reviewed outcome/cache/generation enums. Never attach installation,
  account, request, impression, template or content identity, free text, or URLs. Derive measurements
  directly from the extension's active request; do not collect page-dispatched diagnostic events.
  Use best-effort bounded memory queues. Reports use at most 30 days and suppress rates/percentiles
  below 20 observations per denominator/metric; unknown metadata stays unknown. Expired samples
  are pruned on ingest and weekly maintenance, with a visible failure for remaining expiry backlog.

## Selection and availability

- Preserve the deterministic ranker fallback and return only verified templates by default.
- Keep external calls bounded, along with the model shortlist and visible result count. The
  current request budgets and flow are documented in [architecture.md](../architecture.md#suggestion-pipeline).
- Reserve local fallback time within the overall service deadline and keep client transport margin.
  A caller cancellation must not cancel a shared computation needed by another caller. Browser
  timing/attachment outcomes and late media must respect the active request generation.
- An explicit LinkedIn Meme action may focus the unique visible editor owned by that post,
  including an already mounted editor, without replacing draft text or scrolling. Native Comment
  alone stays native. Ambiguous composers and nested/foreign file inputs cannot authorize insertion.
- Do not add retrieval infrastructure for anticipated scale. Change retrieval only when benchmark
  recall or measured latency regresses; retain evidence for the change.

## Catalog and rendering

- Internal tools create drafts only. Human review, rendered QA, benchmark coverage, and the
  existing promotion gates remain required before templates become eligible for suggestions.
- Keep typography and placement catalog-owned and render them through `packages/shared`.
  Bundled fonts must not add a request-time CDN dependency.
- Any render-input change must invalidate visual QA; machine annotations cannot supply human
  sign-off. Workbench approval alone does not promote a template into the serving catalog.
- Ranking, caption, annotation, and feedback changes require focused tests and the benchmark,
  suggestion, and dataset-plan gates. Quality tuning also requires `quality:tuning`; regenerate
  the checked-in baseline only after reviewing every reported case-level regression.

Revisit these contracts only with an explicit product/architecture decision and corresponding
tests, benchmarks, and review gates. Record the rationale in [DECISIONS.md](../DECISIONS.md).
