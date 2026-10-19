# Three-model evaluation rerun — October 19, 2026

**DeepSeek V4.1 Flash 1017 is the preferred candidate for interactive meme replies on the
new evidence. GPT-6 Luna remains the lowest-cost choice.** DeepSeek produced more usable
captions, better benchmark-family relevance, and a substantially lower median latency under
the unchanged production request settings. Its measured interactive-call charges were about
three times Luna's. Haiku offered no compelling overall advantage in this experiment.

This replaces the [October 17 provisional comparison](model-evaluation-2026-10-17.md), in which
DeepSeek had no eligible provider. These results qualify a candidate recommendation, not a
production rollout or a claim that a model is objectively funnier. No model settings, deployments,
schedulers, account privacy controls, storage, catalog eligibility, prompts, or quality gates changed.

## Method and limits

- Revision `05a4abe`; preserve the existing progress edits and October 17 report. The unchanged
  twelve-case caption taste sample and verified catalog were evaluated three times per model:
  **36 calls each, 108 primary interactive calls**. These are twelve distinct cases, not 36.
- DeepSeek: `deepseek/deepseek-v4.1-flash-1017`; Luna: `openai/gpt-6-luna`;
  Haiku: `anthropic/claude-haiku-5.5`. Only the development OpenRouter key was used.
- Actual production gateway and prompt builders, twelve-template shortlist, up to five results,
  600-token completion ceiling, reasoning disabled, JSON mode, latency-first routing, preferred
  provider p90 latency 2.5 seconds, and hard 4500 ms joint-call deadline. No retries or model-specific
  prompt adjustments. Fresh gateways prevent one failure from suppressing later measured calls
  through the circuit breaker. A wrapper catches failures and continues the experiment.
- Calls were sequential within each pass, interleaved by case with model order rotated. Across
  the three rounds every model occupied every order position for each case. Request-body hashes
  confirmed that each case's primary requests were identical except for the model field.
- All models received the same three trend fixtures, two explicit-caption cases, two saved-image
  tagging fixtures, and one offline vision-plus-semantic pipeline fixture. Secondary checks used
  existing production payloads and budgets. Trend observation timestamps advance between models;
  these secondary prompts are not byte-identical across time.
- A separate exploratory price-routing pass ran twelve cases once per model, changing only
  `joint_provider_sort` to `price`. Its results are reported separately from the main comparison.
- Local pipeline checks and some secondary/price calls overlapped; this was not a controlled
  load experiment. External traffic, provider selection, caching, and day-to-day variance affect
  results. Repeated fixed prompts especially favor warm caches; costs are not a forecast for
  unique production posts. No LLM judge or invented human scores were used.

## Primary interactive results: current latency-first routing

All counts below use the full 36-attempt denominator, including failures. A usable case means
at least one model caption survived the existing strict region checks. It does not count a
deterministic fallback as successful model output. Latency includes failed attempts.

| Metric | DeepSeek | Luna | Haiku |
| --- | ---: | ---: | ---: |
| Usable cases | 35/36 | 35/36 | 33/36 |
| Timeouts / invalid JSON | 1 / 0 | 1 / 0 | 2 / 1 |
| Median latency | **1.76 s** | 3.23 s | 3.19 s |
| p95 latency | 4.30 s | 4.48 s | 4.51 s |
| Valid captions / returned captions | **144/175 (82.3%)** | 93/122 (76.2%) | 120/156 (76.9%) |
| Valid captions per attempted request | **4.00** | 2.58 | 3.33 |
| First valid template in an acceptable benchmark family | **30/36** | 25/36 | 26/36 |
| Any valid template in an acceptable benchmark family | **34/36** | 31/36 | 30/36 |
| Valid captions using an explicitly rejected family | **0** | 2 | 4 |
| Reported charges for 36 attempts | $0.02354 | **$0.00773** | $0.02246 |
| Reported cost per usable case | $0.000673 | **$0.000221** | $0.000681 |
| Reported cost per valid caption | $0.000164 | **$0.000083** | $0.000187 |

DeepSeek led caption yield in all three rounds: 47/51/46 valid captions versus Luna's 30/34/29
and Haiku's 37/46/37. Its one timeout was `bad-label`, round three. Its only completed case
without an acceptable-family caption was `regatta-lightning-spin`, round one. Luna's timeout
was `silent-yoga-jackhammer`, round two; it missed an acceptable family on four other attempts.
Haiku had a truncated JSON response on `prod-fire-calm` and timeouts on `false-choice` and
`regatta-lightning-spin`.

The acceptable/rejected family labels are a reproducible relevance proxy. They are not exhaustive
human judgments about every generated joke. Strict validity checks missing/overlong/duplicate
regions; it cannot establish comic quality or visual readability after rendering. The application
may replace rejected captions with its existing contextual fallback, which this model-only
evaluation deliberately does not credit to the provider.

Valid-caption counts for rounds one/two/three, preserving all failures as zero:

| Case ID | DeepSeek | Luna | Haiku |
| --- | --- | --- | --- |
| prod-fire-calm | 4/4/3 | 3/3/1 | 0/3/3 |
| false-choice | 4/5/5 | 5/3/3 | 0/3/5 |
| bad-label | 5/5/0 | 2/4/3 | 3/4/4 |
| lowball-client | 5/4/5 | 3/4/3 | 4/5/4 |
| celebrate-clean-ship | 4/4/5 | 3/3/3 | 3/4/4 |
| relationship-no-gift-board | 2/3/4 | 2/2/3 | 5/4/3 |
| silent-yoga-jackhammer | 5/4/4 | 2/0/2 | 3/3/2 |
| cafe-vibe-rebuttal | 4/5/5 | 2/2/2 | 4/3/4 |
| luthier-exposure-offer | 3/5/4 | 2/3/2 | 2/4/3 |
| regatta-lightning-spin | 3/5/4 | 2/4/2 | 5/4/0 |
| masonry-shortcut-collapse | 5/4/4 | 3/2/3 | 3/4/2 |
| campus-hiring-scale-comparison | 3/3/3 | 1/4/2 | 5/5/3 |

## Price routing is a separate tradeoff

DeepSeek's current [provider list](https://openrouter.ai/deepseek/deepseek-v4.1-flash-1017)
has several prices. Endpoint metadata lists Morph at $0.059/$0.60 and Together at $0.30/$1.20
per million uncached input/output tokens. The primary test's successful DeepSeek requests all
used Together. Model-level starting prices therefore do not describe its measured bill.
Provider choices and caching also explain why identical listed token prices do not imply equal
request cost. [OpenRouter routing documentation](https://openrouter.ai/docs/guides/routing/provider-selection)

The exploratory pass kept the same deadline and p90 preference, changing only sort order:

| Price-routing result | DeepSeek | Luna | Haiku |
| --- | ---: | ---: | ---: |
| Usable cases | 8/12 | **12/12** | 9/12 |
| Timeouts / invalid JSON | 4 / 0 | 0 / 0 | 0 / 3 |
| Strictly valid captions | 32/40 (80.0%) | 30/44 (68.2%) | 36/43 (83.7%) |
| Median / p95 latency | 3.11 / 4.52 s | 3.41 / 3.84 s | 3.28 / 4.36 s |
| Reported charges | $0.00306 | **$0.00160** | $0.00805 |

DeepSeek's successful requests used Together four times, Morph three times, and InferenceNet
once. Four cancelled calls did not return provider/usage metadata. Luna stayed on OpenAI, while
Haiku used Google. Price sorting reduced DeepSeek's returned charges but made availability worse
in this small pass. **Do not switch its interactive path to price sorting on this evidence.**
This later pass had warmer caches, different providers, and one repetition rather than three;
its dollar totals cannot be compared directly with the primary three-round totals as savings.
Cancelled requests may still be billed, so returned usage is incomplete for both passes.

## Other model roles

| Check | DeepSeek | Luna | Haiku |
| --- | --- | --- | --- |
| Trend fixtures | 3/3 passed | 3/3 passed | 3/3 passed |
| Three trend calls: reported cost | $0.000414 | $0.000417 | $0.000787 |
| Supported-trend fixture latency | 3.61 s | 4.73 s | 6.65 s |
| Explicit-caption strict validity | 2/2 | 2/2 | 1/2 |
| Two explicit-caption calls: reported cost | $0.001413 | $0.000344 | $0.000757 |
| Saved-image tagging | 2/2 fallback | 2/2 fallback | 2/2 fallback |
| One-image offline pipeline | Valid draft | Valid draft | Valid draft |

- Trend fixtures were the unchanged supported airport-tray reference, generic weak evidence,
  and unsafe evidence containing malicious instructions. Each model produced one card/two
  observations for supported evidence and no cards for the latter two cases under the strict
  schema and 20-second timeout. DeepSeek and Luna's three-call costs were effectively tied;
  the sub-cent difference is not evidence of a meaningful long-run advantage. No Tavily search,
  production trend refresh, database write, or snapshot publication was invoked.
- The explicit caption endpoint has a separate 20-second budget and uses low reasoning rather
  than the interactive path's disabled reasoning. DeepSeek used 2561 reasoning tokens across
  two calls versus Luna's 389; Luna was cheaper on this path. That is a reason to retain
  purpose-specific model settings rather than replacing every model variable together.
- Image-tagging HTTP responses succeeded, but all fixtures returned the app's fallback.
  The existing schema/prompt mismatch remains a blocker for a successful tagging migration;
  fallback is not a passing tagging result. No schema checks were weakened.
- Pixel analysis and semantic annotation used each model through the actual offline pipeline
  functions for one local Disaster Girl image. All produced valid drafts with two regions and
  `requires_human_review=true`. No storage requests or promotion occurred. This establishes
  small-sample compatibility, not rendered geometry quality or catalog readiness.

## Recommendation and next action

Use **DeepSeek with the existing latency-first routing for the main interactive suggestion call**
if prioritizing reply relevance, useful choice count, and typical response time. It now has direct
task evidence and supersedes the earlier default preference for Luna. Keep strict caption
rejection, the 600-token budget, the deadline, deterministic fallback, and privacy controls.

For minimum interactive spend, **Luna is still the better choice**: it matched DeepSeek's usable
case count at roughly one-third the reported cost, with fewer captions and lower family relevance.
The result is a measurable cost-versus-output tradeoff, not one universal winner.

For background trend enrichment, either DeepSeek or Luna is a reasonable cheaper candidate to
Gemini; these three fixtures did not establish a meaningful cost winner between them. Prefer
Luna for the separate explicit-caption endpoint if its measured cost advantage is the priority.
Haiku is not the first choice under the current prompts and budgets. Repair saved-image tagging
before migrating that role, and keep embedding-model changes outside this chat-model comparison.

Before accepting a production switch, perform the human taste review and applicable tuning/release
verification in [QUALITY.md](../QUALITY.md). An anonymous local review sheet was generated with
provider identity shuffled independently for every case/round, no provider names or network
resources in the page, and human score fields left blank. No human assessment was fabricated.
The evaluation request is complete; no production migration has been performed.

## Evidence and verification

- Focused baseline: `uv run --project apps/api --frozen pytest
  apps/api/tests/test_caption_evaluation.py apps/api/tests/test_trend_enricher.py
  apps/api/tests/test_trend_runtime.py -q`: **31 passed**.
- Fresh deterministic ranker run: `uv run --project apps/api --frozen memedrop-suggestion-eval
  --out .memedrop/model-eval-20261019/deterministic.json`: all gates passed on 104 cases,
  top-1/3/5/12 acceptable 74.0%/90.4%/99.0%/99.0%, no case-level baseline regressions,
  5000-template warm ranking p95 14.97 ms.
- Ignored operator wrappers: `.memedrop/model-eval-20261019/run.py`, `price.py`, `pipeline.mts`,
  `summarize.py`, and `blind_review.py`; they reuse the prior fixture helper and production
  evaluators. Raw fixed-fixture caption artifacts, sanitized request/usage metadata, model and
  endpoint metadata, summaries, and anonymous review files remain in that directory. No customer
  source posts were used or placed in logs or handoff documentation.
- 171 measured requests: 108 primary interactive, 36 price-routing, 21 secondary, six pipeline.
  Returned usage reports sum to **$0.07504**. Eight cancelled calls lack returned charge data;
  the development key's usage increased **$0.07805** during the experiment. These are separate
  observations, not a complete per-request invoice reconciliation; usage rollups can update later.
- Documentation links, credential-pattern and whitespace checks, anonymous-sheet identity/resource
  checks, the unchanged 73-line AGENTS.md, and `git diff --check` passed. Application behavior and
  deployment settings were unchanged, so the full build/release gates were not rerun.
- Same input hashes as October 17: sample
  `8de29bfffd0c67ac1dc39a05e01fb78b940798cb18880612ee02fe617c7a42c4`;
  benchmark `0c0bb8f78a9ac5f7bc1dd59f43d25b9c52c4cdcc734256987704c51e1cd5147c`;
  catalog `765b307092da941c550e139b899327f8fca55d48cdf377d8cf5ab1e3732aa74f`.
- Sources for current provider capabilities/prices: [OpenRouter model metadata](https://openrouter.ai/api/v1/models)
  and each model's `/api/v1/models/{author}/{slug}/endpoints` response. The public model pages are
  [DeepSeek](https://openrouter.ai/deepseek/deepseek-v4.1-flash-1017),
  [Luna](https://openrouter.ai/openai/gpt-6-luna), and
  [Haiku](https://openrouter.ai/anthropic/claude-haiku-5.5/). Measured quality and latency above come
  from this repository's experiment, not those providers' published benchmarks.
