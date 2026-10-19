# OpenRouter model cost evaluation — October 17, 2026

**Superseded:** the [October 19 three-model rerun](model-evaluation-2026-10-19.md) includes
DeepSeek and prefers it for interactive output quality/speed, while Luna remains cheaper.
The recommendation and provider availability below describe the earlier experiment.

**October 19 availability update:** DeepSeek connectivity now succeeds with the same development
key, including the evaluation's JSON/reasoning/routing options. OpenRouter lists fifteen endpoints
where October 17 inspection found one; the new probe was served by Together. No account or
application settings were changed by this investigation. Additional provider availability is a
plausible explanation; account-setting history was not inspected. The earlier privacy-block result
is historical, and DeepSeek's task quality still needs the same evaluation before choosing a model.

**Recommendation: prefer `openai/gpt-6-luna` for the text-model migration, starting with
trend enrichment.** It was faster, more reliable, and cheaper in the measured runs than
Haiku. DeepSeek could not be evaluated for quality under the account's existing privacy
policy. This is a candidate recommendation, not production approval: caption taste review,
image-tagging contract repair, and release verification remain required before rollout.
No application settings, deployments, schedulers, privacy settings, catalogs, or storage changed.

## Current refresh frequency and spending

Read-only inspection on October 17, around 10:00 UTC (15:30 IST):

- Live QStash schedule `scd_65aL78hRe3wTQPur3VQFoEJVmfVY` targets the production
  trend workflow with cron `0 0 * * *`: **daily at 00:00 UTC / 05:30 IST**, with three retries.
  This confirms the October 7 reduction from every four hours.
- Production `/health` returned HTTP 200, a fresh snapshot, version 154, five cards, and a
  172800-second (48-hour) freshness limit. PostgreSQL records its publication at
  October 17, 00:00:13 UTC.
- A normal successful daily run scans three pulse queries and six daily queries; twelve
  weekly queries run once per seven-day scan bucket. The workflow still visits all 21 query
  steps, including idempotently skipped weekly steps. Pulse's internal four-hour bucket is
  **not** a separate four-hour scheduler. Expected steady-state volume is about 321 searches
  per 30 days, and at most one enrichment call per search with nonempty evidence, before
  retries. Embeddings run in additional batches when card semantics/model fingerprints change.
- Production aggregates confirm nine completed queries on most recent days, 21 on October 8
  and 15, and eight on October 14. October's Tavily reservation ledger totals 286 credits;
  the configured 900-credit limit applies to Tavily reservations, **not OpenRouter dollars**.
- The production OpenRouter key reports $1.06505128 month-to-date, $0.24188078 this week,
  and $0.029883 today before evaluation probes. These are key totals, not trend-only charges.
  October includes the earlier, heavier cadence. Do not extrapolate that month's average
  as the current daily-refresh cost.
- There were zero customer generations in the last 30 days and zero lifetime extension usage
  events. Background maintenance is the leading spend explanation; exact per-role historical
  billing attribution is unavailable. Health monitoring does not itself make model calls.
- Models are called through OpenRouter. Embeddings are a separate workload and cannot use
  these chat-model replacements. The latest published snapshot's five persisted vectors use
  `google/gemini-embedding-2`; the ignored production operator file instead names
  `openai/text-embedding-3-small`. That is configuration/evidence drift to reconcile before a
  deployment, not proof that the operator file matches deployed settings. Neither was changed.

## Pricing verified from current provider metadata

USD per million tokens for short prompts, excluding cache writes, routing premiums, taxes,
reasoning-output volume, and other services:

| Model | Uncached input | Output | Cached input |
| --- | ---: | ---: | ---: |
| Gemini 3.7 Flash | $0.75 | $3.75 | $0.075 |
| DeepSeek V4.1 Flash 1017 | $0.15–$0.30 | $0.60–$1.20 | $0.003–$0.006 |
| GPT-6 Luna | $0.10 | $0.50 | $0.01 |
| Claude Haiku 5.5 | $0.10 | $0.50 | $0.01 |

DeepSeek's endpoint advertises time-dependent peak/off-peak pricing; Saturday's rates were
$0.15/$0.60. Its cached input is cheapest, but its uncached input/output are more expensive
than Luna and Haiku. Both Luna and Haiku reduce the listed short-context text-token rates
by **86.7% versus Gemini**. Actual savings depend on tokens, caching, retries, and routing;
this does not reduce Tavily, hosting, or embedding charges by 86.7%.

Sources: live [OpenRouter model metadata](https://openrouter.ai/api/v1/models),
[DeepSeek endpoint metadata](https://openrouter.ai/api/v1/models/deepseek/deepseek-v4.1-flash-1017/endpoints),
[Gemini pricing](https://openrouter.ai/google/gemini-3.7-flash),
[Luna pricing](https://openrouter.ai/openai/gpt-6-luna),
[Haiku pricing](https://openrouter.ai/anthropic/claude-haiku-5.5/), and
[official Luna capabilities](https://developers.openai.com/api/docs/models/gpt-6-luna).

## Evaluation method and results

Revision: `05a4abe`, with a pre-existing documentation-only PROGRESS.md modification preserved.
Used the unchanged verified catalog, fixed twelve-case caption sample, production prompt builders,
600-token joint output cap, reasoning disabled, latency-first routing, and 4500 ms deadline.
No prompt tuning or provider-policy changes were made. Each case used a fresh gateway so a
failure was counted independently rather than suppressing subsequent calls via the circuit breaker.
The experiment wrapper caught individual failures and recorded sanitized timing/usage metadata.

Ran twelve joint cases per model, then repeated all twelve for Luna and Haiku in reverse model
order after observing latency/contract concerns. Calls within each run were sequential; this was
not a blinded or randomized benchmark. The small sample measures compatibility and supports a
provisional choice, not a statistically established reliability rate or a human humor score.

| Interactive result | Luna, 24 attempts | Haiku, 24 attempts |
| --- | ---: | ---: |
| Completed and returned at least one strictly valid caption | 24/24 | 20/24 |
| Timeout / malformed JSON failures | 0 / 0 | 3 / 1 |
| Latency p50 | 2.81 s | 3.37 s |
| Latency p95, including failed attempts | 3.53 s | 4.51 s |
| Strictly valid captions / all returned captions | 69/93 (74.2%) | 79/97 (81.4%) |
| First valid template in benchmark's acceptable family | 19/24 | 16/24 |
| Any valid template in benchmark's acceptable family | 21/24 | 18/24 |
| Valid captions using an explicitly rejected family | 1 | 1 |
| Reported joint-call charges | $0.00655 | $0.01385 |

Haiku's caption-validity rate and total valid-caption yield were higher, but its failures and
slower tail latency make it a weaker interactive default under the current deadline. Cost figures
include observed cache behavior and provider/token differences. Haiku's timed-out requests can
still be charged, so returned usage is not a complete accounting of them.

- **Gemini:** all twelve joint calls returned HTTP 400: reasoning is mandatory for the available
  endpoint and cannot be disabled. This demonstrates an incompatibility with the current joint
  request, not a zero score for Gemini's creative ability. The application has deterministic
  fallback; a production customer generation was not triggered to reproduce this failure.
- **DeepSeek:** all nineteen initial role calls returned HTTP 404. A diagnostic request identified
  `paid-model-training-violation-by-account`: its sole available endpoint was excluded by the
  existing account privacy setting. No settings were relaxed. Its output quality and latency
  therefore remain **unmeasured**, rather than scored as inferior.
- **Trends:** Gemini, Luna, and Haiku each passed three synthetic fixtures: supported trend
  evidence produced one card/two observations; generic weak evidence produced none; unsafe
  evidence containing malicious instructions produced none. All used the production strict
  schema and 20-second timeout. Three-call reported costs were $0.00648 / $0.00043 / $0.00084,
  respectively. The supported case took 11.43 / 4.11 / 7.78 seconds. Luna's fixture cost was
  about 93% lower than Gemini's; this small fixture mix is not a monthly bill forecast.
- **Explicit caption endpoint:** Luna and Haiku passed strict region validation on both cases;
  Gemini passed one of two. This path retains its production 20-second deadline.
- **Saved-image auto-tagging:** all four models returned fallback for both sample images.
  For the three accessible models the HTTP responses succeeded, so fallback alone must not be
  mistaken for successful tagging. Extra Luna/Haiku diagnostics confirmed missing required keys
  and unexpected keys against `AutoTagResult`. The current prompt does not provide that schema.
  Repair and verify this boundary before changing its model; switching models alone did not fix it.
- **Offline template pipeline:** Luna and Haiku each completed pixel analysis and semantic
  annotation for one local Disaster Girl image through the actual pipeline functions. Corrected
  fixtures passed draft validation, produced two regions, and retained mandatory human review.
  An initial fixture used an invalid local public-path prefix; its failures were excluded from
  model scoring after correcting the fixture. No storage requests, catalog writes, or promotion
  occurred. One image does not establish rendered placement quality or broad catalog readiness.

Caption rejection must remain enabled. In the first run, twelve of Luna's thirteen invalid
captions exceeded region limits; the other triggered a duplicate-content guard. Both models
also produced a rejected-family selection across the repeats. Stable concerns include the
cafe-vibe and regatta cases; Luna's repeated false-choice case also selected a rejected family.
These require case-level taste review. No human scores have been supplied or inferred from
mechanical checks, and no quality threshold or benchmark baseline was changed.

Case-level valid/returned counts for run 1 and run 2:

| Fixed case ID | Luna | Haiku |
| --- | --- | --- |
| prod-fire-calm | 4/5, 4/5 | 4/5, 4/5 |
| false-choice | 5/5, 5/5 | 4/5, 4/5 |
| bad-label | 3/4, 1/3 | 5/5, 5/5 |
| lowball-client | 2/4, 3/3 | 4/4, JSON failure |
| celebrate-clean-ship | 3/3, 2/2 | timeout, 3/4 |
| relationship-no-gift-board | 4/4, 4/5 | 5/5, 4/5 |
| silent-yoga-jackhammer | 1/3, 3/4 | 2/5, 3/5 |
| cafe-vibe-rebuttal | 2/3, 2/4 | 3/5, timeout |
| luthier-exposure-offer | 3/4, 2/3 | 5/5, timeout |
| regatta-lightning-spin | 2/5, 3/4 | 4/5, 5/5 |
| masonry-shortcut-collapse | 1/3, 3/4 | 5/5, 4/4 |
| campus-hiring-scale-comparison | 4/4, 3/4 | 2/5, 4/5 |

## Verification, provenance, and next action

- Baseline command: `uv run --project apps/api --frozen pytest
  apps/api/tests/test_caption_evaluation.py apps/api/tests/test_trend_enricher.py
  apps/api/tests/test_trend_runtime.py -q`: **31 passed**.
- Deterministic fallback: `uv run --project apps/api --frozen memedrop-suggestion-eval
  --out .memedrop/model-eval-20261017/deterministic.json`: **all gates passed**, 104 cases;
  top-1/3/5/12 acceptable rates 74.0%/90.4%/99.0%/99.0%; no baseline regressions;
  5000-template scale warm p95 14.79 ms.
- Live experiment commands used ignored `run.py`, `pipeline.mts`, and inline repeat/diagnostic
  wrappers under `.memedrop/model-eval-20261017/`. Raw fixed-fixture caption review reports,
  sanitized usage records, and aggregate summaries remain there, outside version control, as
  prescribed by QUALITY.md. No customer posts were used. The standard starting point to
  reproduce a successful sample is `npm run eval:captions -- --model <model> --out <ignored-path>`;
  its unwrapped CLI stops on provider failures rather than collecting subsequent cases.
- Measured evaluation requests reported $0.04229 in charges, including the corrected and initial
  pipeline fixture runs. Small diagnostic probes and potentially billed cancelled calls are
  additional. The development key's entire usage today was $0.04334 at the final readback;
  only one 16-token Luna connectivity probe used the production key ($0.0000072).
- SHA-256, caption sample: `8de29bfffd0c67ac1dc39a05e01fb78b940798cb18880612ee02fe617c7a42c4`.
- SHA-256, benchmark: `0c0bb8f78a9ac5f7bc1dd59f43d25b9c52c4cdcc734256987704c51e1cd5147c`.
- SHA-256, catalog: `765b307092da941c550e139b899327f8fca55d48cdf377d8cf5ab1e3732aa74f`.

Keep the daily cadence while testing the cheaper trend model: that directly targets idle provider
spend without changing the 48-hour freshness contract. A further cadence reduction is a separate
freshness decision. Migrate purpose-specific settings, retain strict caption rejection and fallback,
review every live sample as required by QUALITY.md, repair auto-tag schema prompting, reconcile
the embedding configuration drift, and run applicable tuning/release gates before production.
No production migration has been performed by this evaluation.
