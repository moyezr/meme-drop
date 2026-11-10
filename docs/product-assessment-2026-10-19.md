# Product and evaluation assessment — October 19, 2026

MemeDrop's next improvement should be a faster path to one reply a person actually wants to
use. The existing engineering gates are valuable, but neither benchmark-family recall nor
valid caption JSON establishes that experience. Prioritize deadline correctness, browser
measurement, human taste evaluation, and control over the reply before expanding infrastructure
or the catalog indiscriminately.

This is an assessment and proposed sequence, not an accepted roadmap or authorization to
change production. Adopted implementation tasks belong in the existing
[launch plan](production-launch-plan.md). Code reviewed at `149d4b7`; the pre-existing
PROGRESS.md modification was preserved. No runtime, provider, deployment, or catalog changes
were made, and no live inference calls or customer-data queries were run for this assessment.

## What the evidence establishes

Fresh local checks on the current checkout:

| Measurement | Result | Interpretation |
| --- | --- | --- |
| Deterministic retrieval corpus | 104 cases | Regression coverage, not a representative user sample |
| At least one acceptable family at top 1 / 3 / 5 / 12 | 74.0% / 90.4% / 99.0% / 99.0% | Top-five success means one matching family, not five good replies |
| Cases with an explicitly rejected family at top 5 / 12 | 10/104 / 23/104 | The current passing result still includes known unsuitable choices |
| Warm local ranking p95 | 0.414 ms | In-process ranker only; excludes browser, network, stores, model, and media |
| Synthetic 5,000-template warm ranking p95 | 15.841 ms | Current ranking scale is not evidence for needing another retrieval service |
| Packaged catalog | 49 verified, 63 draft | More sources are not the immediate serving-quality constraint |
| Evaluation tests / selected extension tests | 16 / 22 passed | Boundary checks, not live browser or human taste verification |

The [October 19 live comparison](model-evaluation-2026-10-19.md) is historical evidence from
`05a4abe`, not a fresh production measurement. It found Luna's model-call median/p95 of
3.23/4.48 seconds, 93 valid captions out of 122 returned, and 31/36 attempts with an
acceptable-family valid caption. DeepSeek measured 1.76/4.30 seconds and 34/36 acceptable-family
attempts. Those 36 attempts per model were three repeats of **12 distinct posts**.

The report correctly separates model output from deterministic fallback, includes failures,
balances model order, and qualifies incomplete timeout charges. Its human humor fields are
blank. It supports a candidate comparison; it does not prove either model produces jokes
people want to post. Luna remains the accepted cost-focused production choice in
[D010](../DECISIONS.md#d010--select-luna-for-the-cost-focused-model-migration).

## 1. Make the first usable result arrive reliably

### Fix the deadline composition first

The extension aborts its suggestion fetch after **5,000 ms** in
[background.ts](../apps/extension/src/background/background.ts). The API first awaits trend
retrieval, then candidate/feedback loading, then a joint model call with a **4,500 ms** budget.
The optional hybrid trend lookup has a **1,250 ms** deadline, after its bounded lexical lookup.
This work happens before the service checks its completed suggestion cache. See
[suggestion service](../apps/api/src/memedrop_api/services/suggestion_engine.py),
[hybrid retrieval](../apps/api/src/memedrop_api/services/hybrid_trend_retrieval.py), and
[configuration](../apps/api/src/memedrop_api/config.py).

These maximum stage budgets cannot fit inside the client budget even before transport and
cold-start costs. This is a code-level risk, not a measured production timeout frequency.
Server fallback can be correct and still arrive after the browser has abandoned it.

Use one end-to-end server deadline, allocate the model only the remaining time, and reserve
time for fallback and response delivery. Set the client deadline above the full server budget
with measured network margin. Do not merely increase every timeout: that makes waiting longer
without making useful output arrive earlier. Add a boundary scenario with slow trend retrieval
plus a slow provider and verify the browser receives fallback before its own deadline.

### Test whether synchronous trend enrichment earns its delay

Candidate and feedback reads already run together; media previews and originals already hydrate
independently. Preserve those optimizations. The next experiment should compare the actual
production path with lexical-only trend context and tightly budgeted hybrid context, particularly
on posts that do not need cultural context. Keep only enrichment with a demonstrated improvement
in human-rated fit or humor. Snapshot-aware caching must retain publication/version correctness.
Do not add live web search to every reply or change the background refresh cadence in this work.

### Measure the browser milestones correctly

The existing [performance tracker](../apps/extension/src/shared/suggestion-performance.ts)
starts in the background worker. Its first-preview event means preview bytes are available,
before the page necessarily decodes and renders the captioned image. Its `ready_to_attach_ms`
waits for **all original images**, and does not include the selected meme's full rendering or
confirmation by the platform uploader. Separate click-to-rendered-preview, first usable card,
all-card readiness, selected-image preparation, and confirmed attachment.

Suggested initial goals, to validate against a real baseline rather than claim as current:

| User milestone | Proposed goal |
| --- | --- |
| Visible response to explicit Meme action | Under 100 ms |
| First fully captioned usable card, fresh request | p50 under 2 s; p95 under 3.5 s |
| Click on a prepared card to platform-confirmed attachment | p95 under 500 ms |
| Fallback or actionable error | Before the client deadline |

Report cold/warm requests, cache hits, failures, and slow connections separately. Keep durations,
bounded categorical outcomes, and random request identifiers; do not retain source posts,
captions, steering, URLs, or content-derived identifiers as analytics dimensions.

Prioritize the leading card's preview, decode, and rendering. Originals currently prefetch for
every result; measure whether that competes with the first preview on a slow connection, then
use bounded scheduling if needed. Prepare the selected or leading image without rendering every
full-size card unnecessarily.

Showing three strong options is a worthwhile experiment against five. A smaller output can
reduce generation and decision time, but must preserve choice usefulness. Keep the current
12-template retrieval shortlist until recall evidence supports changing it. Incremental delivery
is a later option: raw streaming JSON alone cannot show a valid captioned card, and an arriving
result must not replace a card someone is already inspecting.

## 2. Improve the joke and the user's control over it

The text-only source extraction and English regex-based context hints are the current limits.
The model already receives template grammar, examples, optional guidance, and a comedy brief;
adding another general instruction to “be funny” is unlikely to solve a missing target or wrong
stance. See [platform adapter](../apps/extension/src/content/platform-adapter.ts),
[context analyzer](../apps/api/src/memedrop_api/services/context_analyzer.py), and
[joint prompt](../apps/api/src/memedrop_api/services/openrouter.py).

Prioritize these experiments:

1. **Make stance easy to express.** Extend the existing Guide field with optional choices such
   as agree, playful disagreement, self-own, wholesome, and dry. Keep free-form direction.
   Default to a reaction rather than assuming the poster should be mocked. A sarcastic source
   post does not determine the user's intended reply.
2. **Use bounded reply context.** On X distinguish the intended source from a quoted post; on
   Reddit distinguish the parent comment from the submission title/body. Offer user-triggered
   image understanding for image-led posts and screenshots when the text is insufficient.
   Keep source input transient under the existing privacy boundary. Do not silently summarize
   a whole feed or unrelated comments.
3. **Judge distinct ideas, not just different images.** Reward options that express different
   useful comic turns. The prompt already requests diversity, so evaluate the actual results
   before adding more instructions or another model call.
4. **Repair frequent caption failures.** Label missing regions, excessive length, repetition,
   wrong target, copied examples, and paraphrase-only jokes separately. Improve reviewed region
   examples and compact wording on the highest-exposure templates. The measured 76.2% Luna
   strict-validity rate is a raw model-output result, not the final service's success rate.
5. **Let people finish a nearly good result.** Add a small caption editor with live region-fit
   rendering and a per-card alternative-caption action. Keep the template and existing choices
   stable while that action runs. Editing should not require regenerating the whole strip.
6. **Offer saved reactions alongside generated overlays where useful.** The product already has
   a library, but the normal serving path builds global verified overlay results. A reviewed
   no-overlay reaction or a user's saved meme can be the right social response; introduce that
   as an explicit serving/evaluation contract, preserving verified-template requirements.

Expand the verified catalog from observed unmet intents, repeat fatigue, and render failures.
Prefer a small, reviewed batch filling those gaps over promoting hundreds of machine drafts.
Keep deterministic fallback, strict validation, and human promotion gates.

A future model experiment should score usable rendered replies per request, time to first
usable reply, and cost per accepted reply. The previous DeepSeek/Luna returned-charge difference
was about **$0.44 per 1,000 attempted requests**, by arithmetic on the 36-call totals. This excludes
unknown cancelled-call charges and is affected by repeated-prompt caching; it is not a forecast.
It makes speed and actual acceptance worth measuring, while retaining Luna until a deliberate
cost/quality decision changes D010.

## 3. Make browsing and replying feel native

The current extension supports **X and LinkedIn**, not Reddit: both the adapter and manifest
confirm this. It already has an explicit Meme action, loading placeholders, keyboard activation,
drag/drop, optional guidance, and progressive media hydration. Preserve those useful behaviors.

For X, anchor a compact strip beside the active composer, keep text and native reply controls
visible, enlarge a card on deliberate preview, and provide clear inserted/copy/download states.
Test timeline replies, detail-page replies, quoted posts, simultaneous composers, navigation
during generation, narrow screens, zoom, keyboard use, and DOM remounts. Keep inference explicitly
triggered. Starting work at the Meme click may overlap composer opening; do not generate on
every scroll, hover, or native Reply click.

Add a composer entry point and a keyboard shortcut so someone who already opened a reply does
not have to close it and return to the timeline. Prefer a small contextual onboarding example
showing the action and first insertion over a multi-step setup tour. The popup currently opens
the library directly; a supported-site/status hint would make initial discovery clearer.

For Reddit, begin with desktop reddit.com and a small set of communities that allow image
comments. Detect attachment capability before requesting generation. Reddit confirms that image
comments are community-controlled and unavailable in NSFW communities; see
[Reddit's image-comment documentation](https://support.reddithelp.com/hc/en-us/articles/10516331142932-How-do-I-add-images-in-comments).
If images are unavailable, explain that state and offer an explicit export option; do not imply
that copying an image will insert it into a text-only comment field. Validate nested replies,
multiple editors, source selection, and native upload confirmation before broadening surfaces.
Do not assume an X-style upload adapter is enough for Reddit.

## 4. Is the evaluation set good enough?

**It is a useful deterministic regression suite and a small compatibility/taste sample. It is
not yet enough to substantiate overall suggestion quality or the social browsing experience.**

Specific gaps found by inspecting the corpus and evaluators:

- All **104 cases have exactly three expected families** and at least one rejected family.
  There are zero no-fit cases. The validator requires three expected families, so abstention
  needs a separate case type or suite, not forced labels for unsuitable posts.
- All source inputs are **66–166 characters**. The validator rejects inputs under 40 characters,
  while the API accepts up to 20,000. Very short reactions, ambiguous fragments, and long threads
  are not covered by this corpus.
- There are **104 distinct category strings for 104 cases**. Those labels describe examples
  but provide no repeated observations for stable per-category conclusions. Use coarser,
  multi-label slices with several independent cases each.
- Cases have no platform, provenance, language, collection-time, or development/holdout fields.
  The corpus cannot establish representative sampling or resistance to repeated tuning.
- “At least one accepted family in five” cannot tell whether the other four are redundant,
  poor, unreadable, or embarrassing. Explicit rejections are partial judgments; an unlisted
  template is not automatically wrong or good.
- The [retrieval evaluator](../apps/api/src/memedrop_api/suggestion_evaluation.py) calls the
  production deterministic ranker, but does not exercise the full live service, personalized
  store metadata, trend retrieval, caption generation/validation/fallback, rendered media, or
  attachment. Placeholder media cannot verify real image availability.
- The [caption evaluator](../apps/api/src/memedrop_api/caption_evaluation.py) calls the real
  prompt/gateway, but the standard sample omits user steering, live trend context, rendering,
  and browser attachment. The CLI stops on provider exceptions; the recent comparison's ignored
  wrapper handles failures more completely. That repeatable harness should become maintained
  tooling, with every attempt retained in the denominator.
- Twelve repeated posts are not 36 independent examples. The experiment measures stochastic
  variation and routing compatibility, but its p95 and relevance differences remain uncertain.
  It also intentionally bypasses cross-request cooldown effects by using fresh gateways.
- The current family comparison uses normalized-name substring matching. Stable family IDs
  would make judgments and catalog evolution less fragile.

Keep every existing regression gate. Add a product evaluation layer rather than replacing a
strict engineering suite with a single subjective score.

## 5. A practical evaluation upgrade

### A bounded next dataset

Start with **240 independent scenarios** as a practical first target, not a statistical guarantee:
160 meme-appropriate scenarios split between X and Reddit, 40 cases requiring restraint/no-fit or
more context, and 40 explicit steering, ambiguity, or difficult rendering/context cases. Track
platform attachment capabilities as separate browser fixtures. Rebalance after observing users;
the initial quotas are coverage choices, not estimates of production traffic.

Use authored or permissioned scenarios and purpose-built fixtures. Do not turn ordinary private
product input into a retained dataset. Include brief posts, long/nested context, quoted material,
image-led posts, different tones and targets, unfamiliar topics, Unicode/emoji, prompt injection,
and intentional no-fit inputs. Evaluate languages we claim to support; label unsupported cases.

Create a 160-case development partition and an **80-case sealed holdout**, stratified by these
types. Keep related topics, paraphrases, threads, and source families together when splitting.
Use a time-based refresh set for cultural drift. Keep case IDs, provenance, rubric versions,
catalog/prompt/model hashes, provider settings, and review history. The current 104 cases remain
the regression suite rather than becoming a supposedly unseen holdout.

### Score what the user sees

Review fully rendered cards at strip size and attachment size. Blind and randomize candidate A/B
order, include ties and **neither is worth posting**, and ask whether the reviewer would use
any option. Collect three target-user judgments per scenario for consequential comparisons;
begin with a smaller calibration batch so rubric disagreements can be resolved first.

Retain the existing fit, comic-turn, template-fit, and readability dimensions. Add a primary
binary “would use at least one” judgment, target/stance correctness, repetition across the set,
and severe unwanted outcomes. Rate raw model output and final service output separately, and
include deterministic fallback as a candidate so model value is visible.

Report paired preference wins/ties/losses, usable-set rate, best-card quality, top-three judged
precision, distinct useful angles, abstention correctness, strict validity, and pixel/render
failures. Use judged candidate pools; leave unjudged families unknown. For latency report all
attempts and timeout rate, plus successful-output latency, rather than dropping failures.
Confidence intervals should resample by independent scenario, keeping repeats/cards/ratings
clustered. Do not treat hundreds of captions from twelve posts as hundreds of independent tests.

Model judges can triage obvious mismatches, repetition, or rubric failures after calibration
against humans. They should not certify humor or select their own model as the winner. Known
position, verbosity, and self-preference biases are documented in
[MT-Bench/Chatbot Arena research](https://arxiv.org/abs/2306.05685). Combining mechanical, model,
and human checks follows the layered approach described in
[Anthropic's evaluation guidance](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents).

### Exercise the full browser and feedback path

Use a provider-stubbed browser suite for deterministic attachment/error behavior, plus bounded
live samples across different days, cold/warm starts, and representative connection conditions.
Check the actual platform attachment preview, not only event dispatch.

The existing feedback currently needs semantic repair before it drives more personalization:

- `shown` is emitted when a card is constructed, before verified visibility or readable rendering;
- `used` can mean dispatching upload events, synthetic paste, or merely copying to clipboard;
- closing the panel marks every unselected suggestion dismissed, including when one was selected;
- retries can redeliver batches, and event payloads have no per-impression identity/position.

See [panel events](../apps/extension/src/content/suggestion-panel.ts) and
[telemetry queue](../apps/extension/src/background/usage-telemetry.ts). Separate rendered/visible,
selected, attachment-confirmed, copied, explicit-negative, and abandoned outcomes. Add random
impression/event IDs, position and experiment categories through the reviewed telemetry schema.
Do not infer rejection from ordinary panel closure, or publication from copying/attachment.
Keep best-effort delivery and privacy constraints explicit; deduplicate retried events.

An initial product metric should be **confirmed attachments per explicitly requested session**,
including failed/empty sessions in the denominator. Report selection among sessions with readable
cards separately, paired with request-to-usable time, failure/abandonment rates, and repeat usage.
This is still a proxy for a wanted reply, so pair it with human “would use”
reviews and voluntary tester feedback. Do not optimize click-through or infer social engagement
from these events.

## Proposed order and decision points

1. **First: make measurement trustworthy.** Fix deadline composition, define the browser
   milestones, separate attachment/copy/dismissal outcomes, and capture a packaged-extension
   baseline. Acceptance: a slow provider returns usable fallback before client abort, and a
   reported attachment corresponds to a native attachment preview.
2. **Then: establish a taste baseline and improve control.** Complete the existing anonymous
   review, build the calibration/holdout data, add quick stance choices and caption editing,
   and test three versus five options. Change one major factor at a time. Acceptance: blinded
   paired improvement without new severe regressions or worse tail latency; choose practical
   effect thresholds before seeing results.
3. **Then: run a narrow Reddit pilot.** Add capability-aware source extraction and insertion;
   recruit a small group of intended users for both platforms. Acceptance: correct parent
   context and confirmed insertion on supported fixtures, honest unavailable states elsewhere,
   and observed repeat use. A small pilot is discovery evidence, not a powered A/B test.
4. **After that: invest in the measured constraint.** Consider selective trend enrichment,
   better model routing, a reviewed catalog batch, or incremental responses based on observed
   failures. Fine-tuning, a second retrieval stack, mass catalog promotion, and per-post live
   search have weaker justification today.

The launch plan currently centers the agent API while this request centers browser consumers.
For this improvement cycle, define the primary audience as people replying on X and Reddit and
keep API contracts stable. Learn from a small recruited user group before widening both product
tracks. The absence of customer usage in earlier operations reports is historical; no fresh
production adoption check was made here.

## Verification and limits

- `uv run --project apps/api --frozen pytest apps/api/tests/test_suggestion_evaluation.py
  apps/api/tests/test_caption_evaluation.py -q`: **16 passed**.
- `uv run --project apps/api --frozen memedrop-suggestion-eval --out
  .memedrop/product-assessment-20261019/deterministic.json`: **passed**, including case-level
  baseline and scale gates. The first invocation lacked the output directory; it was created
  and the command rerun successfully.
- `npm run quality:benchmark`: **passed**, 104 cases, 104 category strings, 49 normalized
  expected families, 17 rejected families, zero errors/warnings.
- `node --import tsx --test apps/extension/tests/suggestion-performance.test.mjs
  apps/extension/tests/suggestion-request.test.mjs apps/extension/tests/suggestion-panel.test.mjs
  apps/extension/tests/platform-adapter.test.mjs`: **22 passed**. An initial direct Node
  strip-types invocation used the wrong loader and failed; the repository's `tsx` loader passed.
- Corpus/catalog statistics were calculated from the checked-in JSON. Local report output remains
  ignored. Documentation links and whitespace were checked; no full build/release gate was
  required for this assessment-only change.
- No fresh hosted performance test, packaged-extension visual QA, live model sampling, human
  humor review, user interview, or adoption query was performed. Proposed improvements remain
  hypotheses until those checks and experiments establish their effect.
