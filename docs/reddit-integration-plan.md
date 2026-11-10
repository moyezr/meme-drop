# Reddit integration action plan

Prepared November 4, 2026 against checkout `07094cd`; updated November 5 after draft-only live QA.
Status: experimental local implementation with live desktop draft/attachment evidence;
Reddit permissions, human quality review and rollout remain unverified. The
[launch backlog](production-launch-plan.md#reddit-extension-pilot) owns task status.
The user-confirmed context and shared-UI requirements are recorded in
[D013](../DECISIONS.md#d013--share-the-extension-experience-and-bound-reddit-reply-context).

Implementation checkpoint: the working tree includes the shared-panel Reddit adapter, separately
validated reply/root context, content-aware hashed caches, bounded extraction, exact native composer
binding and anonymous measurement migration `20261104_0013`. Local browser fixtures cover post and
comment replies, open/closed shadow roots, huge/deep threads, unavailable capabilities and stale
context. User-authorized live QA in Moyez Personal exercised post/comment drafts and native image
attachments, first through local fallback and then through the configured hosted OpenRouter model.
Both live hosted requests returned three validated model captions without cache/fallback, and two
native attachments preserved their draft text. QA media and the new synthetic post draft were
removed without publication; the pre-existing comment draft remains intact and open. Native body
projection, image toolbar, host ownership and focus-triggered opening have regression coverage.
This is limited functional evidence, with no deployment or formal human quality approval.
Shared caption fitting now uses available wrapped lines before shrinking, cards preserve the full
image, and every platform has a larger review image with selectable captions and explicit Attach.
All 50 browser cases pass. A subsequent live dense-caption post/comment retest in Personal passed
with hosted-model output and preserved drafts; its temporary extension and services were removed.
Scoped evidence is in [PROGRESS.md](../PROGRESS.md).

Recommendation: extend the existing Chrome extension to desktop `www.reddit.com`, starting with
post-detail pages in a few SFW communities that allow image comments. A user clicks Meme, chooses
a captioned suggestion, reviews its native draft attachment, then submits through Reddit.
FastAPI remains the only application backend. This is a separate extension delivery track;
the existing API/web beta does not depend on it.

## Scope and approach

| Approach | Fit | Proposed action |
| --- | --- | --- |
| Existing Chrome extension | Closest to the current X/LinkedIn experience; reuses rendering, media preparation, suggestions and feedback | First implementation candidate, subject to permitted access and a working native uploader |
| Devvit app | Reddit-native distribution, with a different app surface, review and permissions model | Revisit if Reddit requires this route or community demand justifies it; prove the reply/image workflow first |
| Public API bot or agent | Could serve an explicit automated-reply product, but adds account, access and posting responsibilities | Defer; the current request does not require automated posting |

Initial coverage: top-level comments on a submission and replies to individual comments on the
same detail page. Implement those as separate milestones; both are required before the Reddit
pilot. Exclude feed injection, old Reddit,
mobile apps/web, DMs/chat, creating submissions, image understanding, thread crawling, voting and
automatic submission. Do not promise compatibility with every Reddit frontend or editor mode.

## External dependencies to resolve first

Reddit documents image comments as community-controlled and SFW-only. Native composer capability
must be checked for the actual user and target, rather than inferred solely from a subreddit name.
[Image-comment help](https://support.reddithelp.com/hc/en-us/articles/10516331142932-How-do-I-add-images-in-comments),
[community settings](https://support.reddithelp.com/hc/en-us/articles/15484546290068-Community-settings).

Reddit requires explicit API access approval and written approval for commercial data use.
Its developer-service guidance includes free features offered as part of an upsell within commercial
use. Resolve the applicable permission, contract and any fees for MemeDrop's intended distribution.
[Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/16471395473812-Moderation-Bots-Tooling),
[developer access guidance](https://support.reddithelp.com/hc/en-us/articles/14945211791892-Developer-Platform-Accessing-Reddit-Data).

The User Agreement also restricts collecting content and prohibits scraping without prior written
consent. **Planning inference:** reading an open page from an extension is not established here as
an exemption. Describe the exact user-triggered extraction and external processing flow when
clarifying the permitted route; do not switch to undocumented JSON/GraphQL or page scraping to
bypass API restrictions. [User Agreement](https://redditinc.com/policies/user-agreement).

Devvit has its own approved-LLM rules, explicit user-action requirements and deletion obligations.
If choosing Devvit, confirm whether MemeDrop's FastAPI → OpenRouter → model chain is approved;
an underlying model name alone does not establish approval of that chain. Do not change the global
model or provider just for this integration. [Devvit Rules](https://developers.reddit.com/docs/devvit_rules).

These dependencies do not prevent local development against authored synthetic fixtures. No
Reddit outreach, app registration or live processing is performed by this planning task.

## Implementation sequence

Effort estimates assume one engineer familiar with the repository. Allow approximately 11–16
engineering days, plus Reddit decisions/review, live QA scheduling and a one-to-two-week pilot.
The estimates are planning ranges, not delivery commitments.

| Phase | Work and owner | Exit criteria | Effort |
| --- | --- | --- | --- |
| 0. Resolve feasibility | Maintainer: permitted access/distribution and external AI handling. Engineer: define supported composer modes, verify upload formats/limits and Shadow DOM boundaries in an allowed test environment | Written route decision and a bounded prototype demonstrating one correct native image draft; unresolved items stay explicit | 1–2 days, excluding external wait |
| 1. Top-level comment milestone | Extension: shared UI/adapter boundary, Reddit adapter, explicit Meme action, post context, exact composer binding, capability check, native insertion | One click produces suggestions for the selected submission through the common UI; card selection attaches only there; unsupported composers make zero suggestion calls | 3–4 days |
| 2. Nested replies and context | Extension/API/shared: exact parent plus root-post context, bounded extraction, cache separation and cancellation | Both comment and post influence the reply; two visible reply boxes cannot cross-bind; context work stays bounded on huge threads | 2–3 days |
| 3. Quality, measurement and regression | Extension/API: additive Reddit measurement support, synthetic human review, packaged browser cases and unchanged existing gates | Correct native confirmation and content-free samples; all X/LinkedIn cases pass; human review has actual recorded ratings | 3–4 days |
| 4. Controlled pilot | Maintainer: release candidate, permitted live draft QA, opt-in testers, observations and rollback | Native draft flow verified, QA separated from ordinary traffic, pilot criteria met before broader support claims | 2–3 engineering days plus observation |

### 1. Prove capability before generation

- Bind the explicitly selected submission/comment to one visible native composer. Opening Reddit's
  ordinary Comment/Reply controls alone must cause zero MemeDrop requests.
- Inspect the bound composer's enabled image control before generation. If its availability is
  unknown, locked, signed-out, restricted or absent, show a short unavailable state and do not call
  inference. A rich-text image button does not establish Markdown-mode support.
- Check capability again before attachment. If it disappears after suggestions were generated,
  explain the failure and offer explicit copy/download where available. Do not silently insert
  a URL, change editor mode, overwrite a draft or bypass a community restriction.
- Inspect open Shadow DOM where needed. If closed roots or inaccessible controls prevent exact
  binding, treat that surface as unsupported instead of searching arbitrary global inputs.
- Verify accepted MIME types, bytes and dimensions in the spike. Reddit's help currently describes
  a 240px maximum width/height; test actual acceptance and readability at the documented size before
  setting an upload policy. Inspect the existing PNG output path first. A successful file-input
  assignment is insufficient evidence. [Image-comment help](https://support.reddithelp.com/hc/en-us/articles/10516331142932-How-do-I-add-images-in-comments).

### 2. Preserve reply meaning and ownership

- For top-level comments, use the selected submission's title and bounded body. For a reply to a
  comment at any depth, use **both the exact comment being replied to and the root submission's
  title/body**. The selected comment determines the immediate reply target; the root post supplies
  the topic and framing. Keep these as separate labeled fields through request validation,
  generation and deterministic fallback so neither is mistaken for the other.
- Bound work independently of thread size: extract from the selected comment's own body and the
  known root-post container, excluding nested child text. Use a bounded ancestor walk only to find
  ownership; do not serialize the comment tree, concatenate all visible comments, expand branches,
  load more comments or run an extra model call to summarize the thread. Reuse only active-session
  root context and invalidate it on root content/navigation changes.
- Define explicit per-field and total character/token limits within the existing request budget,
  with deterministic truncation and internal missing/truncated flags. Reserve space for the selected
  comment and post title before allocating remaining space to the post body. Test long individual
  comments as well as long posts. An image/link-only post uses its title and available text; no image
  understanding or external article fetch is implied. If the selected comment or root context cannot
  be resolved reliably, explain that context is unavailable instead of using an unrelated source.
- Exclude siblings, descendants, usernames, votes and unrelated thread text. Intermediate ancestors
  may become a later bounded enhancement; the initial pilot requires the selected comment and root
  post without crawling the ancestor conversation.
- Add a small platform-neutral internal source shape because three platforms now need it. Keep
  legacy `tweetText`/`tweetId` compatibility at existing boundaries; do not require a broad API rename.
  Add structured reply context for Reddit comment replies, with strict size limits,
  backward-compatible defaults for existing callers and corresponding prompt/cache/fallback tests.
- Namespace Reddit target identity by submission/comment type (`t3`/`t1`). Include target, parent,
  context, steering and every other request-shaping input in hashed cache identity. Keep source and
  steering in active-session memory; never place their text in logs, persistence or plaintext keys.
- Cancel on navigation, target change, editor close, parent removal or ambiguous ownership. Clear
  session data and reject late responses/media before they can affect a new composer.
- Attach only through the exact owned native input/control. Preserve draft text and existing
  media. Mark `inserted` only after a new decoded, removable native image preview appears in that
  composer and its upload is no longer busy. Never click Submit/Comment.

### 3. Keep one shared UI across platforms

All supported platforms must use the same MemeDrop panel, cards, steering controls, loading/error
states, feedback interactions, accessibility behavior and design tokens. A change to a shared
component or style must reach X, LinkedIn and Reddit through one implementation.

- Evolve the existing shared `suggestion-panel.ts` and action rendering rather than copying them
  into a Reddit panel. Keep common layout, visual styles, keyboard behavior and state transitions
  together; split cohesive components only where the implementation needs them.
- Keep platform-specific work in adapters: source extraction, native action placement, composer
  ownership/lifecycle, mounting anchors, capability detection and attachment/confirmation. Move
  existing platform branches behind these boundaries as the Reddit work touches them, preserving
  behavior. Extend the current adapter directly; do not add a plugin framework.
- Pass normalized reply context, session state, mount information and semantic capabilities into
  the shared UI. The UI may show a shared unavailable state when attachments are unsupported;
  it must not choose a separate card layout or theme by hostname. Native placement may differ.
- Keep generic button appearance/labels in common rendering while adapters provide the insertion
  anchor and native action. Centralize reusable styles/tokens so spacing, typography, color and
  interaction changes have one source of truth across extension platform surfaces.
- Exercise common states with X/LinkedIn/Reddit adapter fixtures and visual/accessibility checks.
  Acceptance: a representative shared card/control style change needs one component/style edit
  and is reflected on all three platforms, without per-platform UI patches. Preserve tests for
  platform-specific mounting, top-layer dialogs and exact native attachment separately.

### 4. Change the complete platform boundary

| Area | Existing locations to extend |
| --- | --- |
| Detection, context and native integration | `apps/extension/src/content/platform-adapter.ts`, `content.ts`, `apps/extension/src/shared/meme-reply-intent.ts`; isolate platform ownership and capabilities here |
| Common UI and actions | `apps/extension/src/content/suggestion-panel.ts`, `meme-reply-button.ts`, `toast.ts`; common components/styles, with adapter-provided mounting and actions |
| Media and confirmation | `apps/extension/src/content/attachment-confirmation.ts` and existing media preparation; shared renderer only if the verified upload policy requires it |
| Browser trust and packaging | `apps/extension/manifest.json`, service-worker sender-host checks in `apps/extension/src/background/background.ts`, release/store validators and their tests |
| API/context and cache | `packages/shared/src/types/suggestion.ts`, `apps/api/src/memedrop_api/schemas.py`, and the relevant request/prompt/cache code |
| Anonymous measurements | `apps/extension/src/shared/performance-sample.ts`, `apps/api/src/memedrop_api/performance_metrics.py`, `db.py`, migration and report tests |
| Fixtures and documentation | `apps/extension/scripts/smoke-suggestions-browser.mjs`, adapter/intent/media tests; architecture, README, suggestion contracts, privacy and store copy |

Grant only verified desktop Reddit origins, initially `https://www.reddit.com/*`, alongside existing
hosts. Update validators to require that reviewed allowlist while retaining rejection of wildcards,
unexpected hosts and localhost in production packages.

The current database explicitly constrains measurement platform to X/LinkedIn. Add Reddit through
an additive migration inside `apps/api`, then deploy a compatible API before the extension emits
Reddit samples. Keep retention, deduplication, sender validation and small-sample suppression.
Define rollback behavior for existing Reddit rows rather than deleting them to downgrade.

Keep the existing verified catalog, five-result cap, deadlines and deterministic fallback. Any
new reply-context prompt behavior requires the existing recommendation gates. Reddit identity and
community names must not enter operational measurements. Review existing derived feedback categories
against the permitted Reddit use; do not persist Reddit-derived profiling categories by default.

## Acceptance and verification

Required packaged-extension/FastAPI/Chromium scenarios:

- Native Comment/Reply alone: zero requests. Unsupported image capability: zero generation calls.
- Top-level and nested replies: correct source, correct composer, preserved draft and existing media.
- Nested replies: hold the root post fixed and change the selected comment, then hold the comment
  fixed and change the post; verify both reach generation/fallback and distinguish cache identity.
  Include conflicting parent/post stances to prove the joke answers the comment in the post's context.
- Huge synthetic threads: correct context and target with bounded extraction/output, including deep
  nesting, unrelated branches, virtualized/remounted comments, long text and missing root context.
- Shared panel states, controls, styles and keyboard behavior render across X/LinkedIn/Reddit;
  generic UI changes require no duplicated platform-specific implementation.
- Two open editors, pre-opened editor, remount, Shadow DOM and unrelated file input: exact ownership
  or explicit failure; never cross-insert.
- Locked/deleted/removed targets, signed-out state, unsupported editor mode, image permission change,
  navigation and delayed responses: no stale attachment or unwanted generation.
- Usable card, no-fit, provider timeout/fallback, media preparation failure, upload failure and copy
  path: truthful visible states and feedback. Failed copy must not report success.
- New decoded removable native preview: one insertion; event dispatch or an existing image: none.
- Measurement schema rejects text/URLs/identity; origin checks reject forged platform claims;
  migration and aggregate reporting accept Reddit without changing X/LinkedIn results.

Add 24 authored-synthetic Reddit evaluation cases: eight submission replies, eight nested replies
and eight restraint/no-fit cases, grouped into development and holdout splits. Include sarcasm,
agreement, disagreement, missing context and sensitive situations. Do not collect real Reddit
threads for fixtures or benchmarks. Human-score relevance, joke target, humor, safety and readability
using the existing [evaluation workflow](evaluation.md); report unrated cases honestly.

Run focused tests, then the cumulative checks in [development guidance](development.md): workspace
typecheck/tests/lint/build; API lint/process and disposable migration/integration checks; packaged
suggestion-browser scenarios; benchmark/suggestion/dataset gates for context/prompt changes.
Run tuning and security plus [release gates](release.md) before a release candidate. Keep every
existing benchmark, test and promotion gate intact.

After the access decision, verify the exact production package in signed-in Chrome on an allowed
test target: suggestions, native attachment, removal, clean draft, no publication. Record formats,
composer mode, extension version and categorical outcomes without storing thread text or captions.
Automated fixtures alone cannot qualify today's live Reddit DOM.

## Pilot and expansion decision

Start with 5–10 opt-in desktop users across 2–3 suitable communities where the pilot and AI-assisted
meme replies are allowed. Recruit only after permission, native draft QA and human review pass.
Observe for one to two weeks; low traffic extends observation rather than manufacturing confidence.

Proposed expansion criteria, to finalize before the pilot:

- Zero observed wrong-parent attachments, draft loss or unintended submissions; any such incident
  stops the pilot pending a fix.
- At least 20 eligible attachment attempts, with at least 90% native-confirmed success. Report
  actual denominators and keep copy/unsupported outcomes separate; this is a pilot signal.
- At least 80% of nonempty synthetic cases have a human-approved relevant, readable, safe option;
  report humor ratings separately and review all restraint cases before release.
- Compare time to visible usable preview and native attachment separately for Reddit, under existing
  budgets. Show sample counts, cache/fallback coverage and suppressed small-sample metrics; investigate
  material regression before expansion.

Rollback: stop distribution and disable Reddit through a tested extension switch/release, retaining
X/LinkedIn behavior and the compatible additive API schema. Expand to feed entry points, further
editor modes or Devvit only after the supported detail-page workflow earns it.

Next bounded action after local implementation verification: resolve the exact permitted
access/data-flow route, then validate current live native composers and uploader behavior under
that route. Complete the authored Reddit human-review set and actual scoring before the pilot.
The common UI and adapter fixtures must remain the regression floor for subsequent UX changes.
