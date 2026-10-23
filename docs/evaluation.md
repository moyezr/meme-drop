# Human evaluation and suggestion baseline

These workflows answer different questions: people judge whether a rendered reply works; anonymous
browser measurements describe availability and speed. Neither automatically changes ranking.

## Synthetic evaluation corpus

`apps/api/src/memedrop_api/data/human_evaluation_cases.json` contains 48 authored English scenarios:
24 X and 24 LinkedIn, grouped into 32 development and 16 holdout cases. Related variations stay in
one split; the loader rejects duplicate IDs, split leakage and highly overlapping cross-split text.
Slices include short/long input, quoted stance, ambiguity, sensitive situations, ordinary replies
and cases where abstaining or requesting context is appropriate. No examples are copied from real
posts. Initial judgments are provisional seed labels, not human-approved ground truth. Preserve the
existing 104-case deterministic benchmark and its gates.

Use development cases to iterate. Keep holdout cases for a separately recorded final comparison;
do not select prompts or regenerate labels from holdout results. Add synthetic scenarios for gaps
identified by categorical feedback, never by retaining a user's text or a paraphrase of their post.

## Capture and score

From the repository root, after building shared assets and installing the API environment:

```sh
npm run build:shared
npm run eval:human -- capture --out .memedrop/human-review.html
```

The default uses the real suggestion service, verified catalog and deterministic fallback without
provider calls. It uses no production database, personalized feedback or trend lookup. To explicitly
capture the configured live model, load the ignored operator environment and opt in:

```sh
uv run --env-file .env.prod --project apps/api memedrop-human-eval capture \
  --confirm-live-provider --variant baseline-a --out .memedrop/human-review-model.html
```

Select a bounded subset with repeatable `--case-id`, or use `--split holdout` for final evaluation.
Only canonical corpus IDs are accepted; the CLI has no arbitrary post-text input. `--model` names a
candidate without changing production settings. A capture records corpus/catalog/pipeline
fingerprints, actual model and service timing. Per-case joint outcomes distinguish model, timeout,
fallback, cache and errors; a model-stage success does not prove every caption avoided fallback.
Service-only timing excludes production transport, database, trends and browser rendering.

Open the self-contained HTML locally. It embeds synthetic contexts, generated captions, catalog
art and bundled fonts, and renders through the shared production renderer without network requests.
The UI hides variant/template names during scoring. Judge each case as reply, abstain or
context-needed; rate each rendered suggestion from 1–5 for post fit, comic turn, template fit and
caption readability, then answer whether you would use it. A 1 is unusable/wrong, 3 is acceptable
with reservations, and 5 is ready to use. Review meaning and readable pixels, not just grammatical
caption text. Leave unknowns unrated. A missing/failed render cannot receive quality ratings.

Export scores to an ignored `.memedrop/` file; import the same export to resume. Exports contain
only canonical IDs, ratings, booleans and enums, with no contexts, captions or freeform notes.
The companion manifest and stdout also exclude text. Review HTML intentionally contains only
synthetic material and generated output; never replace it with customer inputs.

```sh
npm run eval:human -- summary --manifest .memedrop/human-review.manifest.json \
  --scores .memedrop/human-review-scores.json
```

Use `--compare-manifest` and `--compare` for a paired run. Compare the same case IDs with the same
reviewer and separately named variants; balance A/B order between reviewers. The summary reports
coverage, unrated cases, empty/error cases and dimension means over scored suggestions. Paired
comparisons use complete-case means so cases with more suggestions do not dominate the delta.
Use a second reviewer on an overlapping subset, discuss severe disagreements and record rubric
changes before expanding the corpus. This small synthetic seed establishes workflow coverage;
it cannot establish population humor quality, inter-rater reliability or statistical superiority.
Do not accept average gains that introduce severe contextual failures or weaken existing gates.

## Production baseline

Extension 0.0.4 sends one terminal sample per explicit suggestion request and one per attachment
attempt. Visible decoded captioned previews and new native image previews define usability and
insertion; bytes, clipboard copies and publication are different outcomes. Samples contain only
bounded durations/counts, platform/version, enums and a random retry UUID. They contain no user,
installation, impression, template, request or content identity, post text, direction, captions or
URLs. Strict API validation rejects extra fields without echoing their values. Delivery is
best-effort and bounded in memory, so browser closure, offline operation or queue pressure can lose
samples; counts are observed samples, not all requests or unique people.

After migration `20261023_0012`, deploy API and privacy before distributing the extension. Capture
an aggregate report with the production environment loaded:

```sh
uv run --env-file .env.prod --project apps/api memedrop-performance-baseline \
  --days 30 --since <UTC-timestamp-after-operator-QA> \
  --out .memedrop/production-baseline.json
```

The report executes read-only aggregate SQL, separates request and attachment attempts, exposes
cache/model coverage and unknown categories, and reports corrected v2 visible-card feedback
separately. It suppresses rates below 20 denominator observations and p50/p95 below 20 measured
values; missing metrics remain null. This minimum is a reporting floor, not statistical confidence.
Cached replies may have unknown original model/fallback mode. No sample establishes cold-start
status. Do not mix operator QA with beta-user evidence or call the initial empty window a baseline.
Record the cutover timestamp, extension version, observation window and known rollout coverage.
See [operations](private-beta-operations.md) for retention cleanup and monitoring.
