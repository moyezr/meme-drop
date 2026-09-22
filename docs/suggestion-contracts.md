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

## Selection and availability

- Preserve the deterministic ranker fallback and return only verified templates by default.
- Keep external calls bounded, along with the model shortlist and visible result count. The
  current request budgets and flow are documented in [architecture.md](../architecture.md#suggestion-pipeline).
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
