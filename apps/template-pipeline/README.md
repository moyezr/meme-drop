# MemeDrop template pipeline

This development-only app discovers meme templates, stores immutable source media in
`meme-drop-dev`, extracts pixel-derived visual facts, asks the configured model for semantic catalog
annotations in small batches, and exports a draft manifest for real-catalog retrieval tests.

It is deliberately not a backend and never promotes a template. Every generated record remains
`quality=draft`, records its source and content hash, and requires human review, rendered QA,
benchmark coverage, and the existing promotion gates.

## Why annotation has two model stages

OpenRouter routes both stages to `google/gemini-3.7-flash`. The vision stage returns bounded visual
facts and normalized region proposals from pixels. The semantic stage then owns joke grammar,
scenarios, anti-scenarios, retrieval hints, examples, safety notes, and typography constraints. It
receives the visual facts and prior machine draft as context and is instructed to preserve the
observed geometry. The pipeline has no direct Google or secondary model-provider request path.

`--allow-text-only-layout` is available only for a retrieval-scale experiment. It creates visibly
marked fallback top/bottom regions that must not be treated as visually annotated.

## Commands

```sh
# Pilot the source and development-bucket path first.
npm run dataset:scale:scrape -- --limit 10
npm run dataset:scale:annotate -- --limit 10

# Refine existing machine drafts with the configured semantic model.
npm run dataset:scale:refine -- --limit 1000 --batch-size 3 --concurrency 1 --cooldown-ms 15000

# Resume the idempotent pipeline to 1,000 drafts.
npm run dataset:scale:run -- --limit 1000

# Inspect checkpoints without external calls.
npm run dataset:scale:status
```

State and the exported manifest live under `.memedrop/template-pipeline/` by default. Both are
ignored experiment artifacts. Object keys are deterministic and content-addressed. The app refuses
to start unless `S3_BUCKET_NAME=meme-drop-dev`; it never creates, empties, or deletes a bucket.

The default semantic batch size is five templates with two concurrent requests and a 15-second
cooldown between request waves. For the 971-draft refinement, use the documented concurrency of one
so the cooldown occurs after every batch. HTTP 429 and transient 5xx responses use bounded
exponential backoff. Exhausted quota, billing, and authorization failures stop the run after the
current wave is checkpointed, so a later invocation resumes without replacing the last valid draft.

`TEMPLATE_PIPELINE_SEMANTIC_MODEL=google/gemini-3.7-flash` makes Gemini refine the semantic metadata
through OpenRouter. `dataset:scale:refine` includes the prior draft as editable context, preserves
vision-owned geometry, checkpoints each wave atomically, skips drafts already refined with the same
model/prompt/input hash, and retains the last valid draft if a refresh fails.

Imgflip's top-all-time template pages are fetched sequentially with a one-second delay. Source page,
image URL, rank, source ID, and content SHA-256 are retained for attribution and duplicate control.

## Scale evaluation

The exported manifest is compatible with the FastAPI catalog reader. Run the existing production
ranker against the real draft annotations with:

```sh
cd apps/api
uv run memedrop-suggestion-eval \
  --catalog ../../.memedrop/template-pipeline/manifest.json \
  --include-drafts --no-baseline

# Inspect the real shortlist for one post.
uv run memedrop-suggestion-eval \
  --catalog ../../.memedrop/template-pipeline/manifest.json \
  --include-drafts --query "We renamed the same spreadsheet a modern data platform."

# Make one real selection+caption call and save a human-reviewable result.
uv run memedrop-caption-eval \
  --catalog ../../.memedrop/template-pipeline/manifest.json \
  --include-drafts --case-id production-fire \
  --out ../../.memedrop/template-pipeline/live-caption-smoke.json
```

The deterministic command measures retrieval relevance and latency. The live command records the
bounded 12-template shortlist, up to five generated captions, contract validity, hosted-model
latency, and empty human-review score fields. Live trends remain a separate input: the annotator
never invents trend claims, and a large catalog test cannot establish trend freshness by itself.
