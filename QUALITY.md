# MemeDrop Quality Playbook

This project should optimize for one thing first: a user opens a reply box, sees a meme that feels context-aware and funny, and trusts that clicking it will produce a clean image.

## What Good Looks Like

- The meme family matches the social shape of the post, not just a keyword.
- The caption uses one concrete noun or action from the tweet when it helps the joke.
- Overlay text is short enough to read at thumbnail and full size.
- Text sits in intentional regions and does not cover the face, gesture, or punchline of the source image.
- The result sounds like a human meme reply, not a brand account or explanation.

## Annotation Workflow

Use template annotations as the source of truth for caption quality. For every meme template:

1. Mark only known-good templates as `verified`; keep generated or uncertain templates as `draft`.
2. Define regions over empty visual space or canonical text areas, not over faces or key gestures.
3. Set `max_chars` from visual capacity, not from what would be nice to say.
4. Add good examples that obey the same `max_chars` and region layout constraints users will get at runtime.
5. Add bad examples for generic, wordy, or structurally wrong captions.
6. Run `npm run manifest:audit --workspace=@memedrop/template-tools` before promoting any draft template.
7. Run `npm run manifest:audit:all --workspace=@memedrop/template-tools` when working through the full draft/generated backlog.
8. Run `npm run manifest:review-queue --workspace=@memedrop/template-tools` to prioritize draft templates by benchmark relevance and visual-fit risk.
9. Run `npm run manifest:qa:queue --workspace=@memedrop/template-tools` to generate `.memedrop/template-qa-queue.html` for the highest-priority draft templates.
10. Open the QA sheet against a running backend and promote only templates whose rendered text is readable, correctly placed, and not covering the meme's key face/gesture/punchline.

The verified-template audit must reach zero errors before a template is treated as production-quality. Warnings are review prompts; they are acceptable only when visually checked with the QA contact sheet. The all-template audit is intentionally stricter and may fail while draft templates are still being curated.

The review queue should drive promotion work. Templates with high expected-hit counts affect the benchmark most; templates with visual warnings need region/font/example cleanup before visual QA.

## Dataset Expansion Loop

Use a promotion funnel, not a bulk import:

1. Add or generate candidate templates as `draft` with source images and overlay regions.
2. Run `npm run manifest:fix-examples --workspace=@memedrop/template-tools` after model-generated batches to shorten examples mechanically.
3. Run `npm run manifest:audit:all --workspace=@memedrop/template-tools` and fix any errors before visual review.
4. Run `npm run dataset:expansion-report` to write `.memedrop/template-expansion-report.json`.
5. Use the expansion report to pick novel draft templates with zero mechanical warnings; these are candidates for rendered QA, not automatic promotion.
6. Run `npm run manifest:review-queue --workspace=@memedrop/template-tools -- --limit 20` to choose high-impact drafts that overlap existing benchmark expectations.
7. Run `npm run dataset:qa-expansion` and inspect `.memedrop/template-qa-expansion.html` for novel clean drafts.
8. Run `npm run manifest:qa:queue --workspace=@memedrop/template-tools` and inspect `.memedrop/template-qa-queue.html` for benchmark-overlap or warning-driven drafts.
9. Run `npm run dataset:taste-review` to generate `.memedrop/taste-review.html`. This is the default human review page for deciding whether a draft template has product taste.
10. Open `.memedrop/taste-review.html` with the backend running, review each template, and export review decisions plus benchmark-case drafts from the page.
11. Save exported decisions as `.memedrop/template-review-decisions.json`. For later batches, use `npm run dataset:review-decisions:init -- --append` only if you need a plain JSON scaffold instead of the taste-review page.
12. Record visual QA decisions in `.memedrop/template-review-decisions.json` using `tools/template-tools/evals/template-review-decisions.example.json` as the schema. Change a template to `approved` only after rendered QA is clean, culturally recognizable, and backed by a realistic benchmark case.
13. Run `npm run dataset:review-decisions` to validate the review file before editing the runtime manifest.
14. Run `npm run dataset:promotion-plan` to write `.memedrop/template-promotion-plan.json`. Use it to separate `approved_ready` templates from approvals still blocked by missing benchmark coverage or stale visual warnings.
15. Run `npm run dataset:benchmark-stubs` to write `.memedrop/suggestion-benchmark-stubs.json` with copy-ready benchmark case drafts for ready or blocked candidates, or use the benchmark draft exported by `.memedrop/taste-review.html`.
16. Replace placeholder tweets/rejected reasons and expand each case to at least three expected meme families.
17. Dry-run the edited case pack with `npm run dataset:benchmark-import -- --file .memedrop/suggestion-benchmark-stubs.json`.
18. Import the clean edited cases with `npm run dataset:benchmark-import -- --file .memedrop/suggestion-benchmark-stubs.json --write`, then run `npm run dataset:review-decisions:promotion`.
19. Run `npm run quality:dataset-plan` before promotion so approved-but-blocked templates do not silently accumulate.
20. Run `npm run dataset:promote-reviewed` to compile approved decisions into `packages/shared/src/data/meme-template-manifest.promoted.json`.
21. Promote only a small batch at a time, then run `npm run quality:promotion` and `npm run quality:suggestions`.

Keep verified templates conservative. Draft volume can grow quickly; verified runtime volume should grow only when the template has passed mechanical audit, rendered QA, and suggestion evals.

The expansion report is intentionally different from the promotion queue:

- `manifest:review-queue` protects current quality by finding drafts that already matter to the benchmark or have visual risks.
- `dataset:expansion-report` grows the catalogue by surfacing novel generated drafts that are mechanically clean enough to review.
- A novel draft should not become `verified` until it has a matching benchmark case that explains the joke shape it improves.
- `dataset:review-decisions` validates the human QA record. Approved templates must be novel, warning-free, documented, and tied to a future benchmark case ID.
- `dataset:taste-review` writes `.memedrop/taste-review.html`, a local reviewer page that renders draft templates, captures approve/needs-work/reject decisions, asks for the taste rationale, and exports both review-decision JSON and benchmark-case drafts. It is the preferred workflow for human curation because it records why the meme is funny and when it is wrong.
- `dataset:review-decisions:init` creates a conservative review file from mechanically clean expansion candidates so reviewers edit decisions instead of writing JSON from scratch. It refuses to overwrite an existing review file unless `--force` is passed, and `--append` preserves existing decisions while adding new unreviewed candidates.
- `dataset:promotion-plan` writes a deterministic promotion plan that shows ready approvals, blocked approvals, unreviewed mechanically clean candidates, and benchmark-case stubs for missing coverage. The default batch policy selects at most five ready approvals and avoids overloading a release with one joke category.
- `dataset:benchmark-stubs` extracts benchmark-case drafts from the current promotion plan into `.memedrop/suggestion-benchmark-stubs.json`. These stubs are scaffolding only: replace placeholder tweets, add enough expected/rejected meme families, and run `npm run quality:benchmark` before treating them as real eval coverage.
- `dataset:benchmark-import` validates an edited benchmark case pack before appending it to `tools/template-tools/evals/suggestion-benchmark.json`. It rejects placeholders, duplicate case IDs, missing signal, unknown meme families, and imports that would make one meme family dominate the merged benchmark. Draft templates listed in the case pack's `source_templates` are allowed as pending expected families; all other expected and rejected families must already resolve to verified runtime templates.
- `dataset:review-decisions:promotion` is stricter: the local review file must exist and every approved `benchmark_case_id` must already exist in `tools/template-tools/evals/suggestion-benchmark.json`.
- `dataset:promote-reviewed` is the only supported bulk-promotion path. It re-runs strict review validation, copies only approved generated drafts, marks them `verified`, and writes the promoted runtime manifest.

## Evaluation Workflow

Run the deterministic FastAPI suggestion quality suite:

```bash
npm run quality:suggestions
```

Inspect real usage outcomes before changing personalization weights:

```bash
DATABASE_URL=postgresql://... npm run dataset:usage-feedback -- --min-shown 20
```

Audit the benchmark corpus itself before adding or promoting templates:

```bash
npm run quality:benchmark
```

The benchmark audit checks case count, category diversity, expected/rejected family diversity, no expected/rejected overlap inside a case, verified overlay-template coverage, and caps any single meme family from dominating the benchmark.

The quality gate checks:

- `top3`: expected meme family appears near the top.
- `top5`: expected meme family appears somewhere in the strip.
- `caption`: generated captions are specific, short, and non-generic.
- `layout`: generated captions fit their annotated regions.
- `overlay`: suggested memes actually have overlay templates.
- `rejected_avoidance`: explicitly rejected meme families stay out of the top results.

Model-backed selection and captions are separately covered with deterministic gateway tests; the
local ranker remains the release floor so provider downtime cannot erase relevance.

## Automated Tests

Run the full monorepo tests with:

```bash
npm test
```

These tests currently cover:

- Shared template lookup behavior, especially excluding generated drafts from default runtime suggestions.
- Suggestion benchmark corpus quality, including expected meme families resolving to verified runtime templates.
- FastAPI route contracts, identity, failures, downloads, rate limits, persistence, and account data.
- Suggestion context, ranking, personalization feedback, captions, caching, and privacy-safe logs.
- Real PostgreSQL/pgvector repository behavior when `MEMEDROP_TEST_DATABASE_URL` is set.

Add tests for new production guardrails as they are introduced.

The static release gate includes tests:

```bash
npm run quality:static
```

Before promoting templates or cutting a release candidate, run the stricter promotion gate:

```bash
npm run quality:promotion
```

This runs static quality, requires the template review queue to be empty, validates extension release metadata, and validates the Chrome extension release manifest configuration.
It also runs the benchmark coverage gate, which fails if any expected or explicitly rejected meme family is missing from verified runtime templates, and the dataset promotion-plan gate, which fails if an approved draft is still blocked by missing benchmark coverage or stale QA warnings.

## Human Data Collection

The best annotation data should be human-curated, not only model-generated.

- Use `.memedrop/taste-review.html` for library curation. Use the live X extension only after curation to test product behavior, insertion, latency, and whether suggestions feel right in the real timeline.
- Automation can collect candidates, detect duplicates, render QA sheets, flag mechanical layout risks, generate review scaffolds, validate benchmark coverage, and prioritize which memes deserve review.
- Human review must decide recognizability, cultural fit, joke usefulness, stale/overused feel, whether the meme adds a distinct suggestion shape, and the exact benchmark truth for realistic tweets.
- Build a golden set of tweets covering common reply intents: dunking, agreement, self-own, disbelief, celebration, suspicion, fake tradeoff, and predictable consequence.
- For each tweet, store 3-5 acceptable meme families and 1-3 rejected families with reasons.
- For each accepted meme, write at least one caption that a human would actually post.
- Review examples against the rendered image, not just JSON.
- Track user actions later: shown, clicked, inserted/used, saved, dismissed, and regenerated. Click-through, save rate, and repeat use are stronger quality signals than model scores.

After tester traffic exists, summarize runtime feedback before promoting or pruning templates:

```bash
npm run dataset:usage-feedback -- --days 30 --min-shown 20 --out .memedrop/usage-feedback-report.json
```

Use `promote` items to prioritize similar joke shapes or template variants, and use `review` items to inspect whether the template is visually weak, mismatched by retrieval, or simply stale. Treat the report as a prioritization signal, not an automatic promotion rule.

## Tech Stack Read

Postgres plus pgvector is the right starting point for this product. The quality problem is not primarily the database.

Keep pgvector while:

- The catalogue is in the hundreds or low thousands.
- You need joins against tags, usage events, and user libraries.
- You want simple local development and one operational database.

Consider a dedicated vector store only if:

- Candidate retrieval becomes a measured bottleneck after indexing and caching.
- The catalogue grows into hundreds of thousands of embeddings.
- You need advanced hybrid retrieval features that are painful in Postgres.

## Pipeline Priorities

The slow path is LLM work, not vector search.

Recommended order:

1. Keep LLM context analysis and meme reranking enabled for every user-facing request.
2. Cache tweet analysis and embeddings by normalized tweet text.
3. Retrieve candidates with pgvector, then rerank a bounded shortlist with the quality model.
4. Caption only the top few verified templates.
5. Precompute richer meme descriptors, example contexts, and humor tags offline.
6. Stream partial suggestions without captions, then hydrate captioned previews as they finish.
7. Measure stage timings from the existing suggestion pipeline before replacing infrastructure.

## Dependency Security

Run `npm run quality:security` after lockfile or deployment changes. It audits the complete npm
workspace and the locked FastAPI production environment. The script fails on every new advisory.
Two narrowly version-pinned exceptions expire on 2026-09-01: Next.js build dependencies used only
to export the static landing site, and the Vite 5 copy embedded by the current CRXJS build plugin.
Neither dependency set is shipped in the extension runtime or a landing server. Any package change,
new advisory, or review-date expiry makes the gate fail until the exception is reviewed again.

## Chrome Extension Release Gate

Use the normal extension build for local development:

```bash
npm run build:extension
```

Use the release build for Chrome Web Store packages:

```bash
VITE_API_BASE_URL=https://your-production-api.example npm run build:extension:release
```

The release build refuses localhost API URLs, requires `https://`, and checks the generated manifest host permissions. Do not submit a Web Store build produced with the local development API origin.

Run the store-readiness metadata audit before preparing screenshots or Web Store copy:

```bash
npm run quality:store-readiness
```

Before public submission, create `apps/extension/store-listing.json` from `apps/extension/store-listing.example.json` and run:

```bash
npm run store-listing:init -- \
  --privacy-policy-url https://your-production-site.example/privacy \
  --support-email support@your-production-site.example
node apps/extension/scripts/validate-store-readiness.mjs --strict --file apps/extension/store-listing.json
```
