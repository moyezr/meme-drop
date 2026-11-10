# MemeDrop progress

This is the current session handoff. Replace stale state; git retains history. The
[launch plan](docs/production-launch-plan.md) owns the backlog and
[DECISIONS.md](DECISIONS.md) owns durable choices. Local checks do not establish hosted readiness.

## Merge all open PRs — 2026-11-11

- Requested outcome: integrate all open PRs into main, using `moyezr` for GitHub changes and
  restoring `moyez-dev`; publish nothing on social. Baseline main `07094cd`, PR #5 `eb64d0d`,
  PR #6 `e1f4fa2`. PR #1's head `5aca04f` is already an ancestor of main, with no unique commits.
- Bounded scope: reconcile #5 into #6, preserving the stronger portrait/landscape/narrow review
  assertions plus Reddit context/attachment coverage and coordinated extension version 0.0.7.
  Preserve historical notes and the installed production 0.0.5 directory via an isolated checkout.
- Acceptance: full fresh combined local gates and packaged browser cases; fresh restored/encrypted
  production backup, migration-first compatible schema, normal GitHub merges without fabricated
  statuses/protection changes, all open PRs resolved, main/source identity and account restored.
- GitHub jobs remain unable to start because of the owner's billing lock. The user explicitly
  requested all merges after this was reported. Use normal merge controls with transparent local
  evidence; if GitHub enforces a block, report it without administrative bypass.
- Conflict resolution keeps #5's unobstructed badge/contain assertions and complete selectable
  portrait/landscape review at 820×560 and 390×400, extending both cases to Reddit with the same
  native-draft/no-submit/240px bounds. No benchmark, assertion or deadline is relaxed.
- Fresh focused baseline: 12 reply-context API tests pass. Combined `quality:deployment-readiness`
  passes: 593 API tests, 85 extension tests, 18 renderer tests, workspace static/build/catalog,
  143 API process checks, 32 separate PostgreSQL/Redis integration cases, backend image smoke and
  clean locked npm/Python audits. Default 32 environment-bound skips are exercised separately.
  Ranking: zero regressions/new rejects, 5k warm p95 14.506ms; existing 25 catalog warnings remain.
- All 53 packaged real-FastAPI/Chromium scenarios pass, including six dense review cases at both
  short/narrow sizes, native draft preservation and no submit. Checked 129 local documentation
  paths, 73-line AGENTS.md and whitespace. No provider calls or social publication were needed.
- Fresh production backup `20261110T190727Z` (UTC): 103 objects, 19 tables, schema 0012; restored
  on task-owned loopback PostgreSQL 55440, verified, encrypted with the existing Keychain/AES
  workflow, plaintext removed. Production configuration validates with zero warnings.
- Applied exact Alembic 0012→0013 generated SQL in one session-pooler transaction, with explicit
  local 5s lock/30s statement bounds and expected-version guard. Independent readback confirms
  schema `20261104_0013`, x/linkedin/reddit constraint and unchanged measurement row count.
  No storage, credentials, catalog eligibility, production data rows or provider settings changed.
- PR #1 was closed as redundant using `moyezr`: GitHub rejects retargeting it to main because
  there are no new commits between its head and main. Its head is already fully included in main;
  no old API implementation was reapplied. Restored and verified `moyez-dev` afterward.
- Production-origin `release:dry-run` passes. Validation-only 0.0.7 ZIP: 336955 bytes,
  SHA-256 `b0c51995ae954f47c83c03e3b53350f2580724bd6d8bfb0ffa1c247b1819926e`, 29 files;
  X/Twitter/LinkedIn/Reddit/canonical API hosts only. It is not installed or distributed.
  Canonical API `/live` and `/health` return 200 after migration, before the Git merges.
- Complete: #5 merged as `a656004`, #6 merged as `f729157`, through normal merge controls;
  no protections or check statuses changed. Main contains #5 head `eb64d0d`, reconciled #6 head
  `de276eb` and redundant #1 head `5aca04f`. No open PRs remain. GitHub run `42882858326`
  still refused jobs before any steps due to the confirmed account billing lock; fresh local
  verification above covers the identical merged application tree.
- Local checkout fast-forwarded to main with clean source; installed unpacked extension still
  reports 0.0.5. Task-owned PostgreSQL/Redis containers and volumes were removed, shared services
  left intact. Every GitHub mutation batch used verified `moyezr` and restored `moyez-dev`.
- Both main production deployments are Ready/success: API `dpl_51ReBBM47vVWpu8H21HvpwTWgWWJ`,
  web `dpl_GunzhCH4r23GjDeaHwBw9dDBz9Yd`. Canonical API `/live` and `/health` return 200,
  `/openapi.json` exposes reply context and the hosted privacy page includes Reddit. No paid
  hosted generation/credit-settlement smoke was run for this merge task.
  This source merge does not distribute/reload the extension, establish Reddit access permission,
  human quality approval or a pilot, or publish social content.


## Push all pending product work — 2026-11-11

- Requested outcome: push all remaining product source and documentation to GitHub, using
  `moyezr` and restoring `moyez-dev`. Baseline `07094cd`; readability remains separately available
  on PR #5. The user now explicitly authorizes including the previously untracked product files
  and historical notes. Ignored credentials, backups, generated builds and QA data remain local.
- Scope: shared readability implementation, experimental Reddit adapter/context/measurement
  migration, privacy/contracts, tests, planning/assessment documents and complete handoff history.
  Preserve the existing code and gates; coordinate this combined candidate as extension 0.0.7.
- Acceptance: all selected source is committed and verified on a remote branch/PR, applicable
  fresh local gates pass (including migration/browser/security checks), account restoration is
  verified, and ignored private/generated data is excluded. This push does not apply production
  migrations, enable Reddit distribution, reload the installed extension or publish social replies.
- Baseline: 12 reply-context API tests and four focused extension tests pass. Reviewed all 53
  initially pending source/documentation files for inclusion and credential patterns; no private
  or generated artifacts are selected. Full checks will use an isolated checkout so the installed
  unpacked production extension directory is not overwritten by development builds.
- Complete source snapshot `699588a` includes all 55 pending product files (the original 53 plus
  coordinated package/lock version updates). New source/tests, migration, privacy updates,
  assessment/Reddit plan and historical handoff notes are included. Readability PR #5 remains
  independent; this combined candidate is not a production rollout.
- Fresh verification of `699588a` in the isolated `all-pending-verification` checkout passes:
  `quality:deployment-readiness` (593 API tests, 85 extension tests, 18 renderer tests, all
  workspace static/build/catalog checks, 143 process checks, 32 separate PostgreSQL/Redis
  integration tests, backend image smoke and clean npm/Python audits), all 50 packaged browser
  scenarios, and `release:dry-run`. Default tests skip 32 environment-bound cases; the separate
  integration run exercises them. Recommendation gates retain zero regressions/new rejects,
  with 5k warm p95 16.018ms. Catalog warnings remain the existing 25; no gates were weakened.
- The initial readiness run missed the unchanged eight-second process-startup bound; a complete
  rerun passed with identical source/deadlines. Tests used disposable loopback PostgreSQL/Redis
  on 55439/56390; task-owned containers/volumes and browser fixture profiles/media were removed.
  Verified 91 local documentation paths, the 73-line AGENTS.md and `git diff --check`.
- GitHub handoff branch: `codex/all-pending-product-work`. Use verified `moyezr` for remote writes
  with guaranteed restoration of `moyez-dev`; confirm remote HEAD matches before finishing.
  The installed unpacked directory remains production 0.0.5. No production migration/configuration,
  browser reload, social publication or third-party access/distribution change was performed.
- Next release gates remain CI availability, migration-first compatible backend/privacy rollout,
  permitted Reddit access/distribution, real human review and a bounded pilot. Pushing source does
  not establish those external approvals or hosted readiness.

## Readability release preparation — 2026-11-06

- Requested outcome: ship the existing readability improvements; use `moyezr` for GitHub writes
  and restore the original account; publish nothing on social platforms. Baseline `07094cd`.
- Isolated release checkout: `codex/readability-release` at
  `/Users/moyezrabbani/.codex/worktrees/readability-release/meme-drop`. Preserve this working
  tree's unfinished Reddit implementation and existing notes. Port only wrapped caption fitting,
  uncropped cards and readable review, then bump the production extension to 0.0.6.
- Acceptance: catalog constraints preserved, complete captions/keyboard review work at short and
  narrow viewports, reviewing triggers no inference/upload, exact native attachment remains
  explicit; required local/CI/release gates pass; committed production package is reloaded and
  live draft-only review/attachment/cleanup verified. No Reddit permissions, API contract or
  migration are included. Record package identity, QA interval and account restoration.
- Candidate `eb64d0d` is committed/pushed as `moyezr` on
  [PR #5](https://github.com/moyezr/meme-drop/pull/5), then `moyez-dev` was restored and independently
  verified. The isolated release contains only readability, synthetic fixtures/contracts and the
  coordinated 0.0.6 version bump; this checkout's Reddit work and existing notes remain intact.
- Fresh full `quality:deployment-readiness` and production-origin `release:dry-run` pass: 580 API
  tests, 31 separate PostgreSQL/Redis integration tests, 80 extension tests, 18 renderer tests,
  143 process checks, all static/build/catalog/tuning gates, backend image smoke and clean security
  audits. All 25 packaged browser scenarios pass, including complete portrait/landscape review on
  X/LinkedIn at 820×560 and 390×400. No deadlines, benchmarks or assertions were weakened.
- Committed production package: 333461 bytes, SHA-256
  `315916aff5f6f69f94b59045c74512f605dd2efb53cbb0df429f75cecf31277e`, 24 files, only the existing
  X/Twitter/LinkedIn/canonical API hosts. An immutable copy and content-free metadata are under
  ignored `.memedrop/readability-release-20261106/`; production configuration validates with zero
  warnings. The installed production extension remains the verified 0.0.5 while CI is blocked.
- Backup `20261106T142942Z`: 102 objects, 19 tables, schema 0012, restored/verified on isolated
  port 55438, encrypted through the existing Keychain/AES workflow and plaintext removed. Removed
  only the task-owned readiness containers/volumes; unrelated local services are intact.
- Blocker: GitHub run `42234924801` refused all four required jobs before any test step started.
  Its annotation states: "The job was not started because your account is locked due to a billing
  issue." User input requested to resolve the `moyezr` billing lock. Do not substitute fabricated
  CI statuses or merge/reload while the required checks cannot run. Nothing was published on social.
- Next after billing is resolved: rerun PR #5 CI, require all four jobs, merge as `moyezr` and
  restore `moyez-dev`, then reload the pinned 0.0.6 package and verify live review/attachment and
  cleanup without publication. Detailed release evidence is in the isolated checkout's PROGRESS.

## LinkedIn production extension QA — 2026-11-06

- Requested outcome: reload the committed extension and verify the pre-opened LinkedIn editor
  fix live without publication, then recommend product improvements. Baseline `07094cd` plus
  unrelated uncommitted Reddit/readability work; preserve that implementation and existing drafts.
- Bounded scope: existing Personal-profile MemeDrop installation, exact committed 0.0.5 artifact,
  production API, at most four explicit suggestion requests, native draft attachment and cleanup.
  Acceptance: version/hosts verified after reload, one Meme click binds an unfocused pre-opened
  editor beyond mount grace, draft text preserved, native image confirmed and removed, no publish.
- Preflight: six adapter tests pass. Root 0.0.5 ZIP was overwritten by an experimental build
  using a placeholder API/Reddit hosts; leave it untouched. The task worktree retains the original
  332584-byte production ZIP with SHA-256
  `5f4f2d5f2e526e9d86031badb4fc36c52311b6c4cdff9c70c9bb9e10ffa1fe88`, matching the recorded
  release and production-only X/Twitter/LinkedIn/API host allowlist. Installed Chrome is 0.0.4.
- Reloaded that exact ZIP at the existing unpacked path in Moyez Personal. Chrome and its worker
  independently report 0.0.5; runtime manifest contains only X/Twitter/LinkedIn/canonical API hosts,
  with no localhost/Reddit grants. All 24 package files match the ZIP after QA. The prior generated
  build is preserved under ignored `.memedrop/linkedin-live-20261106/preexisting-dist/`; unrelated
  source changes and the overwritten experimental ZIP were not modified.
- Opened a native inline editor first, added a synthetic draft, then moved focus to another
  page control. One Meme action focused the intended pre-opened editor and returned one usable
  captioned card. It remained bound for another 10.398 seconds beyond the observed ready state;
  draft text stayed unchanged. Card selection produced a decoded, removable native image in that
  editor. Removed it with native Dismiss, cleared only the synthetic text, and verified the empty
  placeholder with photo control re-enabled and submission control absent. Nothing was published.
- The first attempt timed out with a generic API error; retry succeeded. Read-only production
  aggregates confirm exactly two 0.0.5 LinkedIn request samples (one timeout, one usable model/cache
  miss) and one confirmed attachment sample. These counts do not establish rates or population
  latency; normal suppression below 20 observations remains. Cold-start cause is not established.
- Operator QA exclusion interval: `2026-11-06T14:04:49.480187+00:00` through
  `2026-11-06T14:11:20.815716+00:00`. Keep it out of ordinary-use evidence; a fresh 0.0.5 observation
  window may start after that end. Ignored session/aggregate records contain categorical outcomes
  and timestamps only, with no live source, steering, draft text or captions.
- `/live` and `/health` return 200; snapshot 166 is fresh. Closed only the task's fresh LinkedIn
  tab, extension-manager tab and worker inspector. No task-owned service was started. Verified
  hashes of 51 unrelated modified/untracked files unchanged. Documentation/source review,
  existing local links, the 73-line AGENTS.md and `git diff --check` pass. Broader runtime suites
  were not rerun for this artifact reload/documentation task; no application source was changed.
- Product next steps: release the existing shared readability improvements after their release
  gates, investigate first-request reliability and improve explicit retry/error states, add caption
  editing/one-card rewriting and quick stance choices, and complete real human scoring plus a
  bounded tester pilot before model/ranking/catalog expansion. Reddit remains its own unreleased
  implementation/access/migration/review track; this reload includes the committed LinkedIn fix.

## Dense-caption readability — 2026-11-05

- Requested outcome: fix dense multi-panel caption readability in the shared platform UI and
  retest hosted-model post/comment replies on live Reddit in Moyez Personal, preserving drafts
  and publishing nothing. Baseline `07094cd` plus existing uncommitted implementation/docs.
- Bounded next step: measure reviewed synthetic dense examples at their source/preview/240px
  output sizes, fix shared fit/presentation without changing template eligibility or model,
  then run rendering/workspace/browser gates and live draft-only QA. Preserve unrelated edits.
- Acceptance: complete captions remain visible, wrapping uses available lines before shrinking,
  catalog typography/region constraints hold, common behavior remains across X/LinkedIn/Reddit,
  dense post/comment images are readable in live native previews, existing drafts unchanged,
  no submission, task-only QA artifacts removed. Record limits or failures explicitly.
- Baseline: 85 extension tests pass. Current cards crop to a 116px square with badges over the
  image; shared font estimation may shrink to a single-line width before wrapping. Reddit's
  current official help still specifies 240px maximum dimensions; retain that native bound.
- Implemented shared largest-complete-wrapped fitting without changing catalog font/region bounds,
  uncropped 160px cards with badges below the image, and an explicit larger readable review with
  selectable caption text. Review makes no generation/upload call and preserves keyboard return.
  A short-window regression caught the expanded host's old 80px anchor; review now anchors within
  24px margins, scrolls its content, hides Guide temporarily and restores the strip's position.
- Synthetic 240px comparison: authored Two Buttons labels grew from 4.1/4.9px to 7.0/10.3px;
  other multi-panel cases retain/improve size without new source-resolution truncation. Current
  240px direct rendering still cannot fit every template, so do not switch to that path or loosen
  minimum sizes. Inspected before/after artifact; catalog inputs/eligibility and provider prompt
  remain unchanged. Standalone viewport checks pass at 820×560 and 390×400.
- Initial hosted live post attempt timed out under the normal deadline. One explicit dense-template
  retry returned a validated model caption in 2,440 ms (no fallback/cache), was reviewed through
  the new surface and attached with text unchanged. Confirmed native image at 240px and removed
  only the new post image/sentinel. Pre-existing comment draft stayed intact in its original tab.
  Final viewport build and all 50 browser scenarios pass, including dense review/attachment
  across X, LinkedIn and Reddit with Guide open at 820×560.
- Final checks on the current implementation: `quality:static` passes (593 API tests, 32
  environment-dependent skips, 85 extension tests, 18 shared tests, workspace typecheck/lint/build
  and catalog audit; 25 existing annotation warnings). `quality:tuning` and `quality:api-process`
  pass, with zero ranking regressions/new rejects, 5k ranking p95 25.737 ms and 143 process checks.
  `git diff --check` passes. These do not establish deployment or human quality approval.
- Resumed after the user's explicit pause, verified Moyez Personal and completed the live comment
  retest against current local FastAPI → hosted `openai/gpt-6-luna`. A fresh disposable PostgreSQL
  database on 55437 was migrated through `0013` and seeded with 49 verified existing local image
  references. One comment request returned four validated model captions (two multi-panel) in
  2,219 ms, with `joint_outcome=model` and `cache_hit=false`. Metadata confirmed a 94-character
  selected target plus nonempty post title/body; no source, steering or captions were retained.
  Total provider attempts across this readability task: three of the six-attempt ceiling.
- Inspected the complete four-region review with Guide previously open: header, full image,
  selectable transcript and Attach were visible. Escape returned focus to its preview button and
  restored Guide. Reviewing added no generation/click/insertion. Explicit Attach produced one
  confirmed native comment insertion; visually inspected the complete 240px image and unchanged
  draft. The resumed database recorded three shown, one clicked and one inserted event.
- Removed only the new comment image using Reddit's selected-image trash control. Verified the
  existing text unchanged and Image re-enabled, closed only the fresh QA tab, then verified the
  original preserved Reddit draft remained open with no editable image. No Comment/Submit action
  occurred. Unrelated Personal tabs and all other profiles were left intact.
- Uninstalled only `MemeDrop Readability QA` (`ogjndhpkcloelohealgfdmmkgfgablea`): name/ID absent
  in the extension manager; original MemeDrop 0.0.4 still enabled and not reloaded. Closed the QA
  manager tab. Stopped the task-owned loopback API, removed the disposable database container,
  and removed the ignored QA build/helper, synthetic measurements and temporary logs. No production
  data, env file, storage or original MemeDrop installation changed. The requested retest and
  cleanup are complete; release route, formal human quality review and pilot gates remain.

## Hosted-model Reddit QA — 2026-11-05

- Completed the requested hosted-model live Reddit post/comment tests in Moyez Personal. Baseline
  `07094cd` plus the previously verified uncommitted implementation; no application source changes,
  commit, rollout or production migration. Existing documentation/assessment work is preserved.
- Deployed `/live` succeeds, but deployed OpenAPI has no Reddit reply-context contract. Exercised
  current FastAPI locally against the configured `openai/gpt-6-luna` hosted OpenRouter model using
  only the development model credential server-side. Used disposable PostgreSQL at port 55436,
  migrations through `20261104_0013`, and 49 verified existing local catalog references. No production
  database, storage, buckets or credentials were changed. Trends were disabled for the isolated test.
- Kept normal provider deadlines, caption/region validation, fallback and verified-template gates.
  Metadata-only observer counted provider outcomes, validated captions, durations, request kinds and
  context lengths; retained no live source, usernames, draft text, steering or captions. Disabled
  body-bearing exception/access logs. Six-attempt ceiling; only three provider calls were needed.
- Synthetic provider preflight returned two validated model captions in 2,054 ms. Live post and
  selected-comment requests each returned three validated model captions, in 2,081 and 2,416 ms.
  All three runs had `joint_outcome=model`, `cache_hit=false`; none relied on deterministic fallback.
  Live comment metadata confirmed a distinct selected target plus nonempty original title/body.
  Visual spot-check showed the comment response used comment-specific context.
- Through the shared panel, one live post suggestion and one live comment suggestion attached only
  to their intended native editors. The isolated database recorded two `inserted` events and six
  shown suggestions. Both draft texts stayed unchanged while both editors/images coexisted.
  No native Comment/Submit action occurred; no Reddit post/comment was published.
- A comment draft already existed before this run (restored by Reddit after the previous QA).
  Preserved its text, removed only the newly attached image through Reddit's selected-image trash
  control, and left that draft open with Image re-enabled and no editable image present. Cleared
  only this run's synthetic post draft/image and cancelled that empty composer. The Reddit test tab
  stays open specifically to preserve/review the existing comment draft; unrelated tabs are intact.
- Cleanup verified in Personal: `MemeDrop Hosted QA` name/ID absent after uninstall; original
  MemeDrop 0.0.4 still enabled and not reloaded. QA manager tab closed. Task-owned API stopped,
  disposable database container removed, ignored QA build/helper and temporary build log removed.
  The development env file was read selectively and never modified; no secret reached the browser.
- Checks: 12 reply-context tests and the scoped extension build passed. Previous 47 browser
  regressions/full workspace gate cover the unchanged application source; this run adds actual
  hosted-provider/native-Reddit evidence. `git diff --check` passes. No human-scored quality or
  broad frontend compatibility claim: dense multi-panel text is small after 240px preparation,
  so caption readability/humor review remains a pilot requirement. No render/quality gate was relaxed.
- Next: permitted release route, formal human review, broader frontend coverage and opt-in pilot
  remain in the launch plan. The requested hosted-model live testing and cleanup are complete.

## Live Reddit QA — 2026-11-05 (continued from November 4)

- Requested outcome: test live Reddit post/comment replies in Moyez Personal Chrome, preserve
  existing drafts, remove QA artifacts and publish nothing. Baseline `07094cd` with the existing
  uncommitted implementation, documentation and assessment work preserved. No commit or rollout.
- Acceptance: correct profile/build; common UI; exact native editor ownership; selected-comment plus
  post title/body context; draft text retained during attachment; native confirmation and cleanup;
  no submission; applicable regression gates pass. Hosted model quality remains a separate check.
- Test boundary: separately named Reddit-only `MemeDrop Reddit QA` extension, actual local FastAPI,
  disposable PostgreSQL at port 55435 with migrations through `20261104_0013`, 49 verified existing
  local catalog images, no model key or storage credentials. Original installed MemeDrop 0.0.4 was
  not reloaded or removed. No production migration, deployment, bucket or credential changes.
- Live evidence in explicitly selected Moyez Personal: shared panel post/comment flows each attached
  to the intended native editor while two synthetic drafts stayed unchanged. The isolated database
  recorded two confirmed `inserted` events. Native image upload/removal baseline also passed.
  QA images and synthetic text were removed afterward; empty test tabs were closed. No Comment/
  Submit action occurred. Unrelated drafts/tabs were left intact. No live source, usernames,
  draft text, steering or captions were copied into repository evidence or retained server logs.
- Short image-post sources initially returned no local fallback. The shared Guide control selected
  a reviewed fallback template for attachment QA. A later text-post comment produced an automatic
  local suggestion. These checks establish UI/context/upload behavior, not hosted caption quality.
- Metadata-only API observation verified post/comment target kinds, selected target distinct from
  the root post, and nonempty original title/body fields on a text post. The image post correctly
  had an empty body. Final live retest verified direct post opening and one-click switching from
  an active post session to a newly mounted comment editor.
- Fixed native DOM gaps: slotted Reply trackers; post action versus collapsed composer opener;
  external `comment-composer-host` with `post-id`/`parent-id`; nested image/video shadow toolbars;
  source text budget 512 versus bounded native-UI discovery 2,048; decoded keyboard-removable
  Lexical image identity/key confirmation; nested projected text-body slots treated as one field,
  while sibling bodies remain ambiguous. Focus the unique native opener before clicking it.
- Fixed session switching: during asynchronous native mounting, the binding timer owns the pending
  intent. Same-URL compose-state changes cannot cancel it merely because a previous target was
  active. Actual navigation, bound-editor closure, changed context and ambiguity still cancel.
  Shared panel/cards/styles remain unchanged across platforms.
- Final verification on this working tree: `npm run quality:static` passes (593 API tests, 32
  environment-bound skips; 85 extension tests; workspace typecheck/test/lint/build/catalog audit).
  `npm run quality:suggestion-browser` passes all 47 real-FastAPI/packaged-extension/Chromium
  scenarios: prior 40 plus native-host/media, body projection/ambiguity and delayed target-switch
  regressions. Existing 25 catalog annotation warnings remain. `git diff --check` passes.
- Cleanup complete after the user made Personal available: removed only `MemeDrop Reddit QA`
  through Chrome and confirmed its name/ID no longer appears. Original MemeDrop 0.0.4 remains
  enabled and was not reloaded. Closed the task's extension-manager tab; the original Personal tab
  remains. Prior QA tabs were closed after visible cleanup; the later hosted check found a restored
  comment draft and preserved it as described above.
  Task-owned API/helper, disposable PostgreSQL container, scoped ignored QA build and temporary
  task logs are removed/stopped. No production or work-profile extension was modified.
- Next: release permission, hosted model/human quality review, broader frontend coverage and
  opt-in pilot remain pending in the launch plan. Local live draft QA does not establish hosted
  Reddit readiness. The requested live testing and cleanup are complete; no publish/commit/deploy.

## Reddit integration implementation — 2026-11-04

- Requested outcome: start the Reddit extension flow with shared UI and selected-comment plus
  root-post context. Baseline `07094cd`; preserve existing documentation edits and assessment.
- Bounded implementation: desktop detail-page adapters, bounded structured context/cache handling,
  exact composer ownership and capability checks, shared panel/actions, additive anonymous Reddit
  measurements, synthetic browser regression coverage. No deployment or live Reddit processing.
- Acceptance: top-level and nested fixture replies render through the common panel; both comment
  and post reach generation/fallback and affect cache identity; unrelated editors/media stay intact;
  missing capability/context never starts inference; navigation invalidates late work. Existing
  X/LinkedIn browser cases and applicable development gates must pass. Live DOM, permitted access
  and human quality review remain separate pilot prerequisites.
- Baseline: 18 focused extension adapter/intent/request tests and 27 API performance tests pass.
- Implemented experimental desktop detail-page post/comment adapters using the existing shared
  panel, cards, controls, action markup and styles. Native open-shadow action groups and composers
  are supported; closed/inaccessible, ambiguous, wrong-root or image-ineligible targets fail closed.
  A pre-opened reply is reused without toggling native Reply again. Draft text and existing media
  are preserved; a new decoded, removable native preview is required for insertion. No submission.
- Selected comments (2,000 characters) and root-post title/body (300/1,200) remain separate through
  strict request validation and joint prompts; both shape deterministic retrieval/fallback and
  hashed cache identity. Selected-comment stance stays primary. Node reads prune other reply
  branches, used-context changes invalidate sessions, and root/target IDs isolate browser caches.
  Session references clear on closure; worker cache entries are physically evicted after five
  minutes. Source/steering/permalink slugs stay out of diagnostics and operational measurements.
- Added optional compatible `/suggest` and `/suggest/caption` context contracts and additive
  `20261104_0013` for anonymous Reddit performance samples. Reddit-derived feedback categories are
  omitted. Updated architecture, privacy source/disclosures, exact-host validators and launch notes.
- Verification: `quality:static` passed, followed by final affected-path reruns after the pre-opened
  editor change: 593 API tests pass (32 environment-bound skips), 85 extension tests pass, API and
  extension typechecks, API lint and extension build pass. Workspace lint/build and catalog audit
  pass; the existing 25 catalog annotation warnings are unchanged. `quality:api-process` passes.
- Final immutable-artifact browser run passes all 40 real-FastAPI/packaged-extension/Chromium
  scenarios: the existing 21 X/LinkedIn cases plus 19 Reddit cases, including 2,000 direct child
  comments/deep nesting, bounded long inputs, shared card appearance, open/closed shadow roots,
  pre-opened drafts, native upload disable/re-enable, zero-inference capability failures and stale
  source/navigation cancellation. Inspected synthetic screenshots of the common panel. Fixture
  waits finish prior impression/measurement delivery before resetting; stale-result assertions
  remain intact. No live Reddit DOM was accessed by these fixtures.
- All 32 PostgreSQL/Redis integration tests pass on isolated ports 55434/56381, including migration
  upgrade/rollback preservation and rejection while Reddit rows exist; schema readback is 0013.
  `quality:tuning` passes with zero case-level ranking regressions and 5,000-template warm p95
  14.552ms. npm/Python security audits pass. Example-HTTPS extension packaging/permission validation
  passes; its ignored ZIP is a validation artifact, not a production release candidate.
- Documentation/local-anchor/new-file whitespace checks and `git diff --check` pass; AGENTS.md
  remains 73 lines. No credentials, production configuration/data/schema, extension reload,
  deployment, publication, staging or commit changes. Pre-existing documentation/assessment work
  is preserved. Only task-owned test services and temporary browser artifacts were cleaned up.
- Next: resolve permitted live access/external inference, validate current signed-in Reddit native
  drafts without publication, author/score the Reddit human-review set, and meet the linked pilot
  gates. Before any rollout, apply 0013, deploy the compatible API/privacy source, and prepare a
  new appropriately versioned production-origin extension package through the release runbooks.

## Reddit integration planning — 2026-11-04

- Requested outcome: an actionable plan to add Reddit alongside X/LinkedIn. Baseline `07094cd`;
  pre-existing PROGRESS edits and the untracked October 19 product assessment are preserved.
- Added [Reddit action plan](docs/reddit-integration-plan.md) and linked a proposed track in the
  launch backlog. Scope: desktop detail-page extension pilot, capability-first generation,
  top-level then nested replies, exact parent/composer ownership, native confirmation, anonymous
  measurements, synthetic human review, release proof and explicit pilot criteria.
- Reviewed source architecture, adapters, intent/attachment paths, packaging validators and the
  X/LinkedIn-only API/database measurement constraint. Checked current official Reddit image,
  access/commercial, collection and Devvit AI rules; sources and unresolved applicability are
  recorded in the plan. Access and external inference approval are dependencies, not established.
- Acceptance for this documentation task: concrete phased work, implementation locations,
  observable exit criteria, estimates, validation and rollout/rollback; local links and whitespace
  checks pass and AGENTS.md remains 73 lines. No runtime/configuration/data changes or live Reddit
  checks were performed; runtime suites are unnecessary for this docs-only scope.
- Next: resolve the exact permitted data flow and build authored local composer fixtures; validate
  live upload behavior only under that route. Existing LinkedIn live QA remains deferred.
- User refinement: nested replies must use both the exact selected comment and root-post context,
  with bounded extraction for huge/deep threads. Both reply types are required before the pilot.
  Future UI/UX changes must propagate across X/LinkedIn/Reddit through common components/styles;
  adapters own native integration. Updated the plan/backlog and recorded design requirement D013.
  Added acceptance for context/cache/fallback separation, huge-thread fixtures and shared UI
  verification. Documentation links/anchors and whitespace checks pass; runtime remains unchanged.
## Readability production release — 2026-11-06

- Requested outcome: ship wrapped caption fitting, uncropped cards and larger readable review;
  use `moyezr` for GitHub writes and restore `moyez-dev`; publish nothing on social platforms.
  Baseline `07094cd`; release checkout `codex/readability-release` excludes unfinished Reddit work.
- Acceptance: preserve catalog fonts/regions/limits and existing eligibility; review keeps all
  captions visible at short/narrow viewports, restores keyboard focus and makes no inference or
  upload; explicit native attachment and preserved drafts stay intact. Fresh local/CI/release
  gates and exact production 0.0.6 reload/live draft verification are required before completion.
- Ported only the renderer/panel changes and dense synthetic fixtures from the existing local
  implementation. Extension package/manifest/lock advance together to 0.0.6. Baseline renderer
  suite: 16 passed; updated suite: 18 passed. No new platform/API contract or migration is included.
- All 25 packaged Chromium/FastAPI scenarios pass, including four portrait/landscape review cases
  on X/LinkedIn with unobstructed images, selectable complete captions, Guide previously open,
  820×560 and 390×400 viewports, keyboard return and explicit native attachment preserving drafts.
  Initial browser startup and slow-fixture readiness attempts failed; added bounded categorical
  diagnostics, then focused and complete runs passed with unchanged deadlines/assertions.
- Fresh `quality:deployment-readiness` passes: workspace typecheck/tests/lint/build/catalog audit,
  580 API tests, 31 separate PostgreSQL/Redis integration tests, 80 extension and 18 shared tests,
  143 API process checks, backend image build/smoke and clean npm/Python audits. Default API test
  pass includes 31 environment-bound skips; the integration run exercises them separately.
  Recommendation gates retain zero case regressions/new rejects; 5k warm p95 is 14.582ms.
  Production-origin `release:dry-run` passes. Catalog limits/gates remain unchanged.
- Backup `20261106T142942Z`: 102 objects, 19 tables, schema `20261023_0012`; restored/verified in
  the task-owned database on 55438, archived with the existing Keychain/AES workflow and plaintext
  removed. The initially cached pg15 image contained unrelated initialization scripts and failed;
  replaced only this task's disposable container with the official pg17 image. No shared service
  or production configuration/data changed. Redis tests use isolated loopback port 56389.
- Next: require fresh PR CI, merge using `moyezr` and restore `moyez-dev`, package committed source
  for the canonical API, reload the exact artifact, then verify live readable review/attachment
  and cleanup without publication. Existing 0.0.5 remains installed until that final step.

## LinkedIn fix checkout reconciliation — 2026-11-02

- Requested outcome: commit/push the LinkedIn fix through `moyezr`, then restore `moyez-dev`.
  Pre-push fetch found that this checkout was behind: PR #4 already merged the fix and browser
  fixture follow-up into main at `430d259`. The earlier local variant was superseded by that
  implementation, including exact editor/input ownership and delayed-dialog priority.
- Synchronized this checkout to the merged extension 0.0.5 implementation, preserving unrelated
  historical PROGRESS edits and the untracked assessment. No duplicate runtime patch is needed.
  This follow-up commits only the current handoff and launch-plan status.
- GitHub reports main CI `40673727242` successful for `430d259`. The prior local 19-scenario
  result applied to the superseded variant; the merged implementation's 21-scenario evidence is
  recorded below. All four required CI jobs passed; the optional live-model job was skipped.
  Reviewed the documentation against the merged source, existing links and 73-line AGENTS.md;
  working-tree/staged whitespace checks pass. Runtime suites need no rerun for this docs-only delta.
- Live reload/LinkedIn QA remains explicitly deferred. Next: resume it only when requested;
  no publication, production configuration, schema, credentials or storage changes are included.

## PR #4 navigation-cancellation CI — 2026-10-28

- Requested outcome: fix the failing cancellation check without weakening tests, push through
  `moyezr`, restore `moyez-dev`, and keep live QA deferred. Baseline `e93c1f1`, clean task branch
  `codex/linkedin-editor-focus`; [PR #4](https://github.com/moyezr/meme-drop/pull/4).
- CI run `40660420654` passed static, backend-image and API integration jobs; browser scenarios
  passed 20/21 before `abandoned request completion` timed out. The same failure was reproduced
  locally against the immutable extension artifact. Diagnostic polling changed from HTTP 200 to
  429 near the final scenario: earlier scenarios consumed the shared loopback status-route quota.
  The runner interpreted the 429 body as state and hid the actual cause behind a timeout.
- Bounded fix: reset the fixture-owned memory rate limiter alongside other per-scenario state,
  retain normal per-scenario limits, and assert successful control responses immediately. No
  production application or rate-limit changes. Preserve the original 10-second cancellation
  bound and all existing assertions; also require exactly one content-free cancellation sample
  and no insertion after the abandoned request completes.
- Focused regression fails without the reset (429 after scenario reset) and passes with it;
  it also proves a normal API route still returns 429 when its quota is exhausted. Acceptance:
  full browser suite and applicable code gates pass locally, then fresh CI passes for the pushed
  revision. Live signed-in Chrome remains deferred; no reload, publication or production QA.
- Verification: all 21 real-FastAPI/packaged-extension/Chromium scenarios pass with the strengthened
  cancellation case. `quality:static` passes (580 API tests, 80 extension tests; 31 environment-bound
  API tests skipped), along with `quality:api-process`, clean npm/Python `quality:security`, and
  `git diff --check`. These results cover the fixture/runner changes atop `e93c1f1`; hosted CI must
  still confirm the pushed revision. The API preview's missing configuration remains separate.

## LinkedIn pre-opened editor focus — 2026-10-26

- Requested outcome: one Meme click must show suggestions for an already visible LinkedIn editor
  without an extra editor click. Preserve existing draft content, native Comment behavior, exact
  composer ownership, dialog support and content-free measurements. Publish nothing.
- Baseline `5dacec8`; this clean managed checkout is on `codex/linkedin-editor-focus`.
  Bounded change: bind and focus only the unique visible editor owned by the explicitly selected
  post, including a pre-mounted unfocused editor. Keep dialog priority and reject ambiguous or
  unrelated editors. No backend, prompt, ranking, schema or telemetry contract change.
- Acceptance: packaged regression fails before the fix and passes afterward with one Meme click,
  preserved synthetic draft text, no unrelated focus/input assignment, stable request lifecycle and
  confirmed native attachment. Existing X/dialog/cancellation cases stay green; verify the same
  pre-opened editor flow with the production package in signed-in Chrome, remove QA media and do
  not publish. Existing normal-use baseline must not include these operator checks.
- Implemented for extension 0.0.5: bind/focus the unique owned pre-mounted editor with
  `preventScroll`, preserve delayed native-dialog priority and close cancellation, and reject
  ambiguous composers or nested/foreign file inputs before insertion. Draft text is untouched.
- Verification on October 27: reproduced the original focus failure against the old build;
  all 21 packaged-extension/real-FastAPI/Chromium scenarios pass against an immutable development
  artifact, including preserved synthetic drafts, no-scroll focus, delayed dialogs, exact input
  ownership and X/navigation cancellation. `quality:static` passes (579 API and 80 extension tests;
  31 environment-dependent API tests skipped). No tests or gates were weakened.
- Fresh `release:dry-run` passes, including promotion gates, package validation and clean npm/Python
  security audits. Production-origin 0.0.5 packaging also passes; the ZIP is ready for the pending
  reload. The currently installed extension has not been changed by these checks.
- Production package: 332584 bytes; SHA-256
  `5f4f2d5f2e526e9d86031badb4fc36c52311b6c4cdff9c70c9bb9e10ffa1fe88`.
  Independently checked ZIP version 0.0.5, canonical API permission and absence of localhost grants.
- Live QA is explicitly deferred at the user's request on October 27. No extension reload or live
  suggestion action was attempted; no production QA samples were added and nothing was published.
  Code checks are complete. The user authorized committing/pushing the task branch using `moyezr`
  and restoring `moyez-dev`, while keeping live QA deferred. Next action after that handoff: resume
  signed-in LinkedIn QA only when requested; do not treat automated checks as live verification.

## Evaluation production rollout — 2026-10-26

- Requested outcome: migration-first rollout, merge PR #3, deploy API/privacy, reload extension
  0.0.4 and verify collection on X/LinkedIn without publication. Use `moyezr` for GitHub mutations
  and restore `moyez-dev`. Preserve unrelated progress history and the local product assessment.
- Baseline `8a73168`; CI `39988722933` passed all four required repository jobs. API preview failed
  because production configuration is intentionally absent there; no production secrets copied.
  Acceptance: fresh verified encrypted backup, schema 0012 readback before merge/deployment,
  healthy canonical API/privacy at the merged release, exact production package reloaded,
  content-free request/attachment samples from both platforms, post-QA baseline cutoff, no posts.
- Fresh audit found new transitive fast-uri/undici advisories. Patch only fast-uri 3.1.8→3.1.9
  and undici 7.30.0→7.30.1 lock entries (template-pipeline dependencies). Nine pipeline tests,
  its typecheck/build, and complete npm/Python audit pass without exceptions or runtime changes.
- Backup `20261026T100515Z`: 100 objects, 18 tables, schema `20261021_0011`; restored in an isolated
  database, encrypted through the existing Keychain/AES workflow, plaintext removed. Production
  config validates with zero warnings. Previous healthy API `dpl_DMWmLBW4aRe7P48o99TifAWXQEoR`
  and web `dpl_Dn4VgudB6iJ8836nBxrVCJU22ZEh` recorded for rollback. Production remains unchanged.
- Patch release `162c09b` passed fresh CI `40304954538` (all four required jobs) and a clean-checkout
  release dry-run. No benchmark, security or promotion exception. Initial configuration/launch
  checks omitted the operator environment; corrected invocations explicitly load ignored `.env.prod`
  and pass. The preview still has no production secrets.
- Applied `20261023_0012` before merge/deployment through the session pooler. Startup options did
  not enforce limits, so the Alembic transaction explicitly set and verified 5s lock/30s statement
  limits. Independent readback matches the exact 14 ORM columns, version 0012 and zero initial rows;
  no installation/account/content fields exist. No prior schema or data was rewritten.
- Merged PR #3 as `b2daac0` using verified `moyezr`, immediately restored verified `moyez-dev`.
  Main CI `40305324161` passed all required jobs; optional live-model job skipped as designed.
  API `dpl_GqvcjG9Q1D5qGRhfgD2JcokKdAuS` and web `dpl_GmERpidJGVvJQ7YeHZ2MdEnZjtux` are READY;
  build logs identify main/b2daac0, and independent canonical lookups resolve to those IDs.
- Hosted `/live`, `/health` and privacy return 200. Privacy matches October 23 measurement
  disclosures. A synthetic collector probe records once, deduplicates retry and rejects an unknown
  text field with generic 400/no input echo; allowed-origin CORS verified. This probe is QA only.
- Exact production extension 0.0.4 ZIP: 332428 bytes, SHA-256
  `8ad0a0be2dbf33406cc3aa64cde6b5cf841e2db3a071af65238a34b4062ca793`.
  ZIP matches dist; only production API/X/Twitter/LinkedIn hosts. Built from the clean merged tree,
  copied to the existing unpacked path and reloaded. Worker inspector confirms version 0.0.4 and
  production-only manifest hosts; the extension details page retains an older grant display.
- Live X: one usable request (cache miss/reviewed fallback), one native-confirmed attachment.
  DevTools UI selected the rendered card because X hides its body strip from accessibility and
  coordinate selection did not activate it. Native Edit media/Remove media appeared; image removed,
  empty Reply disabled and draft closed. Measurements are independent of per-card feedback.
- Live LinkedIn: the first pre-opened inline-editor attempt cancelled; explicitly focusing that
  editor after Meme made binding succeed. One usable model-stage request and one native-confirmed
  attachment reached production. Removed the image with its native Dismiss control and verified an
  empty placeholder editor. This editor-focus friction is a concrete UX follow-up, not a collection
  failure. Both platforms' typed aggregate counts verified without reading raw measurement rows.
- No social post/comment was published. Temporary DevTools/QA window closed, disposable restore
  service and temporary generated dist backup removed; unrelated browser windows/services intact.
  Production baseline starts `2026-10-26T10:22:38.413230+00:00` after all QA, extension 0.0.4.
  Initial normal-use sample/impression counts are zero; rates/percentiles remain unavailable below
  20 observations. Collection is active, but no population baseline or human quality result exists.
  Private-beta launch status passes with production environment loaded and zero warnings.
- Next: human-score the existing synthetic packet, observe ordinary browsing using this cutoff,
  and fix the LinkedIn pre-opened editor focus friction as a separate bounded UX task. Preserve
  current model, ranking and promotion gates until that evidence exists.

## Evaluation and content-free production baseline — 2026-10-23

- Requested outcome: build a practical evaluation corpus and human scoring workflow, and start
  collecting a production baseline without retaining user source posts, steering, or captions.
  Baseline `4984c9e`; preserve existing historical progress edits and the local assessment.
- Bounded scope: a separate authored-synthetic seed corpus with grouped development/holdout splits,
  rendered local human review and structured scores, anonymous bounded browser timing/outcome
  samples with aggregate reporting and expiry, and a controlled migration/API/privacy/extension
  rollout. Keep existing benchmarks, model, prompts, ranking, and catalog promotion unchanged.
- Acceptance: no real/public/customer post text enters the corpus or reports; score exports contain
  IDs, ratings and enums only; unrated/missing/empty cases stay explicit. Request measurements
  reflect visible decoded captions and confirmed native attachments, with truthful cache/fallback
  coverage and no fake cold-start label. Production storage has a strict bounded schema, random
  retry identity, aggregate-only reporting, retention cleanup, and no installation/content identity.
- Parallel ownership: agents build the synthetic corpus/validator, local human scoring workflow,
  and FastAPI sample collection/reporting. Root integrates extension sampling, contracts/privacy,
  tests and production baseline activation. No automatic quality promotion or new analytics service.
- Initial read-only production aggregate captured under ignored `.memedrop/`; prior v2 feedback
  includes operator QA and cannot establish request denominators or browser latency percentiles.
- Implemented 48 authored-synthetic cases (24 X/24 LinkedIn, grouped 32 development/16 holdout),
  strict validation and offline production-renderer human review with structured export/resume and
  paired summaries. Judgments remain provisional; no human quality ratings have been invented.
- Extension 0.0.4 collects one terminal request/attachment measurement through a strict projection,
  trusted runtime messaging and bounded in-memory retry queue. FastAPI accepts bounded typed batches,
  stores random UUID retry identity without installation/account/content identity, and prunes expiry
  during ingest and existing weekly maintenance. Aggregate SQL reports expose coverage and suppress
  rates/quantiles below 20 observations. Detailed diagnostics remain local; ranking is unchanged.
- Verified full deployment-readiness: 577 API tests, 31 PostgreSQL/Redis integration tests, 80 extension
  tests, workspace typecheck/lint/build, process/container smoke and clean npm/Python security audits.
  Existing tuning gates passed unchanged (5,000-template warm p95 15.942ms against 50ms ceiling).
  Release dry-run and 16 packaged Chromium/FastAPI scenarios passed, including content-free sample
  ingestion and confirmed native attachment. Local review rendered with bundled fonts, exported,
  summarized and resumed with no HTTP requests; automated fixture scores are UI tests only.
- Fixed local-review configuration isolation after an initial capture rejected inherited production
  S3 settings before making provider calls. Final API verification passes 579 tests plus lint/mypy;
  regression checks prove production database/storage/Redis/QStash settings cannot enter review.
  Explicit live capture of 12 development cases produced nine suggestions across four cases,
  eight empty results and zero errors; joint stages were four model, one timeout and seven fallback.
  All nine catalog images were available. The ignored review packet is ready for human scoring;
  this service-only run excludes production database feedback/trends and is not quality approval.
  Final packet QA rendered all nine previews without layout warnings, missing media, HTTP requests
  or page errors; exported scores validate with all human ratings still null.
- Production read-only aggregate confirms collection is not deployed yet: six corrected visible-card
  impressions, three matched insertions, and insufficient data; prior records include operator QA.
  No production migration/deployment has been performed for this change. Commit `af37036` is pushed
  on `codex/evaluation-and-production-baseline`; PR #3 is open with CI running. Push/PR creation used
  verified `moyezr`, then restored verified `moyez-dev`. Unrelated history/assessment remain unstaged;
  disposable QA services were removed. Next: require CI, then migration `20261023_0012` before
  API/privacy and extension rollout, verify ingestion,
  and record a post-QA observation cutoff. Actual human scoring and beta traffic remain necessary.

## Live suggestion QA and release follow-up — 2026-10-23

- Requested outcome: reload the production extension, verify actual X/LinkedIn captioned suggestions
  and native draft attachments, remove all QA attachments, publish nothing, and safely commit/roll
  out necessary repairs through `moyezr` before restoring `moyez-dev`. Baseline `56edd32`;
  preserve unrelated progress edits and the local October 19 assessment.
- Live LinkedIn exposed Comment links and a native HTML dialog outside its source post. Added
  bounded explicit-action composer binding, panel placement inside the native top layer, and
  cancellation on closure. Capture only the exact image input synchronously activated by that
  composer's Share photo control; cancel its chooser and remove the temporary listener immediately.
  Never search arbitrary global file inputs. Require a new decoded native removable image preview,
  including the verified blob/figure/link/Dismiss structure; unconfirmed attempts remain copied.
- Production extension version 0.0.3 was built, reloaded and exercised in signed-in Chrome.
  LinkedIn produced a captioned card and a native image draft without a file chooser. Both platforms showed
  captioned cards and native draft attachments on final 0.0.3. X exposed Edit media/Remove media
  and enabled Reply; each image was removed before closing its empty draft. X card selection used
  the page DevTools UI because its modal hides the body panel from accessibility and monitor mapping
  prevented reliable coordinate selection. No social reply was published. Safe production version-2
  aggregates: shown 5, clicked 5, inserted 2, copied 3; copied attempts did not become insertions.
- Live worker tracing observed client cancellation at 6.4s with no response headers before a warm
  request succeeded. Local reproduction proved the earlier route timer excluded rate limiting.
  The five-second application deadline now starts at middleware entry and covers rate checks/body
  parsing; rate checks cap at 500ms and fail closed. Pass remaining allowance into the service;
  retain route `total` and add `rate-limit`/headers-ready `http-app` timings. The same CORS policy now
  covers middleware errors. Serverless startup/network transit remain outside these measurements;
  the live cold-timeout cause is not yet established. Independent backend review found no issues.
- Verification on current runtime: 504 API tests, 28 PostgreSQL/Redis integration tests, 69 extension
  tests, 30 web tests, and 16 packaged Chromium/FastAPI browser scenarios passed, including actual
  native-dialog markup, exact external-input ownership, chooser suppression, unrelated blob/avatar
  rejection, cancellation and fallback. API process smoke and full release dry run passed, including
  workspace typechecks/tests/lint/build, metadata/catalog gates and packaging. No ranking/model or
  promotion threshold changed. Final local tuning preserves relevance/case-level baselines but
  exceeded the unchanged 50ms scale latency ceiling under host load (p95 55.6–87.8ms); container
  liveness also missed its unchanged eight-second startup check. Require independent CI evidence
  before main/production promotion. CI now always runs the provider-free tuning gate.
  PR CI `39841467994` passed all required jobs, including scale p95 21.108ms against the unchanged
  50ms ceiling, packaged browser flow, PostgreSQL/Redis integration, and container liveness.
  Optional live-model evaluation remains skipped; the deterministic gate always runs.
- Fresh security auditing found critical Next.js advisories; updated only Next 16.4.0 to the first
  patched 16.4.1 and matching lock entries. Web tests/typecheck/build and complete npm/Python audits
  pass. No security exception or permission expansion. Existing TikTok Sans build warning remains.
- Fresh production backup `20261022T191930Z` contains 100 objects and 18 tables at schema
  `20261021_0011`; restored/verified in an isolated database, archived with the existing AES-256
  Keychain workflow, and plaintext removed. Migration already precedes API deployment; no further
  schema change is needed. Disposable test services were stopped; unrelated services remain.
- Committed `b02bc89`, pushed through verified `moyezr`, and merged PR #2 only after required CI
  passed; main release is `1d273d7`. GitHub CLI returned to verified `moyez-dev` after push and merge.
  API preview refused to build without production credentials; no secrets were copied into preview.
  Production configuration validates with zero warnings. API deployment
  `dpl_6qxrZJmUTRtkniyEX9sF7uEmTNmu` and web `dpl_22LRcRq773tXmhMS1YM3n8f9x2em` are READY
  at runtime release `1d273d7`; independent canonical alias lookups resolve to those IDs. Main CI
  `39842023588` also passed all required jobs. No production secrets or schema changed.
- Final package `.memedrop/memedrop-extension-v0.0.3.zip` is 330543 bytes, SHA-256
  `b9452eeaed07dd6ca5014aaf5041baa3273abdcb9903312500ee052edbe099de`. ZIP files match
  production dist, version/hosts validate, and no localhost permission is packaged. Reloaded this
  final production build into Chrome after dry-run restoration. Disposable QA containers removed.
- Hosted verification: `/live`, `/health`, and privacy return 200; trend snapshot 156 is fresh.
  Privacy disclosures/effective date match source (the first check incorrectly searched internal
  event names rather than public prose; corrected check passes). First observed suggestion request
  returned 200 in 5533.4ms, cached repeat in 1322.7ms; both were empty for that fixed fixture. A
  second reviewed fallback fixture returned one captioned suggestion in 5224.2ms after provider
  timeout, within the 6.5s client allowance. New `rate-limit` and `http-app` timings and allowed-origin
  CORS headers were verified; application duration was approximately 4752ms on fallback. These
  samples do not establish cold-start or population p95 performance. No free source/caption retained.
- Status: live suggestions/native draft attachments, neutral/confirmed feedback, current source
  gates, migration-first production rollout, final package, and GitHub-account restoration are
  verified. Nothing was published on either social platform. Next action: observe beta latency
  and corrected feedback aggregates; broader human taste evaluation remains the assessment backlog.

## Suggestion production rollout — 2026-10-21

- Requested outcome: commit/push the deadline, measurement, feedback and privacy changes through
  GitHub `moyezr`, restore `moyez-dev`, apply production migration first, deploy API/privacy,
  build the production extension, and verify live X/LinkedIn suggestions and native attachment.
  Preserve unrelated historical progress edits and the local assessment artifact.
- Acceptance: fresh release gates and verified encrypted production backup; migration readback
  before any Git-triggered deployment; healthy API/web from the committed release; production
  extension package with confirmed live suggestion/attachment and corrected event evidence;
  no published social replies; active GitHub account restored to `moyez-dev`.
- Preflight: production configuration passed without warnings; existing API/web deployments and
  healthy snapshot 156 recorded for rollback. Backup `20261021T093724Z` contains 99 objects and
  18 tables at schema `20260902_0010`; restored/verified on isolated port 55433, encrypted with the
  existing AES-256/Keychain workflow, and the verified plaintext copy removed.
- Fresh release gates exposed Vite, certifi, and Pillow advisories. Update the affected locks to
  patched Vite 8.3.5, certifi 2026.10.19, and Pillow 13.0.0 without exceptions. Extension manifest/
  package advance together to 0.0.2; the package-test fixture now follows that version dynamically.
- Fresh full readiness passed with 499 API tests, 28 integration tests, all static/build/process/
  image/tuning gates, and clean npm/Python audits after those dependency updates. Release dry-run
  packaging also passed. GitHub Actions run `39580005586` passed, including the packaged browser
  flow, static, database/Redis integration, and backend image jobs; the conditional live model
  quality job was skipped. Benchmarks and promotion gates were not weakened.
- Release `56edd32` committed and pushed to `main` using the SSH identity verified as `moyezr`.
  The first HTTPS push was refused because the existing token lacks workflow scope; no scopes were
  expanded. GitHub CLI was restored to `moyez-dev` after both attempts and verified again afterward.
  Unrelated historical progress edits and the local assessment artifact remain unstaged.
- Applied production migration `20261021_0011` before pushing/deploying, with five-second lock and
  thirty-second statement limits; independent readback confirmed the schema and widened event
  constraint. This additive change does not rewrite historical events. No production env changed.
- API deployment `dpl_HBcpWoYU7bFZCWojAq3DYMN66dTq` and web deployment
  `dpl_5NNGUinPXkHHU8BcKZjfGaSzfMBw` are READY at `56edd32`; canonical aliases independently
  resolve to those deployments. `/live` and `/health` return 200; trend snapshot 156 remains fresh.
  Hosted privacy policy returns 200 and includes the October 21 corrected feedback disclosures.
- Built and validated the production-only extension 0.0.2 after the API became ready:
  `.memedrop/memedrop-extension-v0.0.2.zip` (329845 bytes), SHA-256
  `9e0706828a988db81ce47fd64a8d20fd5738e0102f73299564a58e9e4307f33b`.
  Manifest hosts include production API, X/Twitter, and LinkedIn; no localhost permission.
- Hosted black-box agent smoke passed with a fixed benchmark fixture: valid generation, identical
  idempotent replay, authenticated 56132-byte WebP, request IDs, and exactly one-credit settlement.
  Generation 3793.89ms, replay 215.45ms. Temporary operator key was revoked in `finally`; balance
  returned to zero and no active operator keys remain. No source text/captions/credentials retained.
- Live Chrome verification remains pending: signed-in X/LinkedIn and the existing unpacked
  extension were located, but concurrent window/tab changes interrupt native automation. Requested
  a brief idle personal Chrome window. Version 0.0.2 has not yet been reloaded into Chrome, no live
  draft attachments or corrected feedback events have been verified, and no replies were published.
  Production QA aggregates contain no version-2 events yet. Fixture success does not establish
  compatibility with today's platform DOM. Next action: reload the existing extension from its
  production `dist`, reload both social tabs, verify visible captions/native draft attachment,
  discard drafts, and inspect only safe feedback aggregates.
- Cleanup: release-only PostgreSQL/Redis containers were removed; unrelated services remain.
  Production backup is encrypted, temporary API keys are revoked, and `moyez-dev` remains active.

## Suggestion deadline, measurements, and feedback — 2026-10-21

- Requested outcome: implement the assessment's deadline and measurement fixes, correct feedback
  semantics, and verify the suggestion flow. Baseline `149d4b7`; preserve the existing progress
  edits and untracked October 19 assessment. Parallel agents own server budgets, feedback
  contract/persistence, and browser rendering/attachment behavior; integration and docs stay here.
- Bounded scope: one total server suggestion budget with fallback reserve and client transport
  margin; timings from explicit request to visible captioned preview and confirmed insertion;
  visible-impression, confirmed-insertion, clipboard, explicit-negative, and neutral-abandonment
  events with safe metadata and retry deduplication. No prompt/model, catalog, platform expansion,
  production deployment, or new analytics service.
- Acceptance: slow optional enrichment/provider cannot outlast the client before fallback;
  stale responses/media never update the active request; displayed timing waits for actual render;
  insertion requires native attachment confirmation; copying/closing are not positive/negative
  training signals; retried events count once. Verify focused and full repository gates plus a
  real Chromium suggestion/attachment fixture flow and PostgreSQL persistence integration.
- Implemented: five-second service budget/250ms fallback reserve; remaining model allowance capped
  at 4.5s; optional trend/feedback capped at 1.25s/1s; 6.5s client deadline including body reads.
  Provider timeout still opens cooldown; caller cancellation preserves shared inference. Browser
  diagnostics separate bytes from foreground-visible decoded caption previews and confirmed native
  attachments, with empty/failure/cancellation outcomes and no fabricated cache status.
- Feedback version 2 emits visible `shown`, selection `clicked`, confirmed `inserted`, `copied`,
  explicit `rejected`, neutral `abandoned`, `attachment_failed`, and `saved`. Copy/ordinary close
  do not imply insertion/rejection. PostgreSQL primary-key conflict handling deduplicates random
  tenant-scoped event identities before library increments; legacy records remain exportable but
  no longer train corrected ranking/reports. Only six reviewed context categories persist, plus
  random impression identity, bounded position, and version. No source/caption text is retained.
- Migration `20261021_0011` widens the historical event-action constraint, with a matching ORM
  check. It does not rewrite rows. Apply it before the API and then extension rollout. Verified
  on a second disposable database: fresh upgrade, downgrade refusal preserving a corrected event,
  and successful downgrade/re-upgrade after removing only that synthetic fixture. The first
  manual fixture lacked the required install email; corrected the fixture and reran successfully.
- Verification: original API suggestion/config baseline 68 passed, extension baseline 61 passed.
  Full `quality:deployment-readiness` passed: 499 API tests plus 28 real PostgreSQL/Redis
  integration tests, all workspace typechecks/tests/lint/builds, FastAPI process and Docker image
  smoke, deterministic tuning/dataset/render gates, and clean npm/Python security audits. The first
  concurrent run exceeded the unchanged scale latency ceiling; isolated rerun passed at 16.013ms,
  and the complete sequential rerun passed at 15.500ms (50ms ceiling), with no ranking changes.
- Final `quality:static` passed after the last cache-diagnostic/privacy changes; extension now
  69 tests, all passing. Store-readiness disclosure validation passed after naming the corrected
  outcomes and legacy compatibility; existing disclosure gates remain and now require new outcomes.
  Privacy sources, architecture, contracts, D011, and launch task are aligned. Final diff/link/
  anchor checks passed; AGENTS.md remains 73 lines. Pre-existing edits are preserved; no commits.
- `quality:suggestion-browser` / final packaged Chromium smoke passed nine scenarios through real
  loopback FastAPI with a stubbed provider: X/LinkedIn render+confirmed insert, unconfirmed upload
  copied only, neutral close, hanging trend/provider fallback, native Reply without inference,
  catalog failure, broken media without false impressions, and ignored late navigation results.
  Synthetic fixture screenshots were visually inspected. CI now runs this provider-free flow.
  Local run used an existing full Chromium executable via `MEMEDROP_CHROMIUM_EXECUTABLE`;
  normal/CI setup installs Playwright Chromium. No remote platform traffic or live model calls.
- Status: requested local implementation/verification complete. No hosted deployment, production
  data, credentials, model/prompt, or catalog changes. Diagnostics remain local; no new analytics
  service. Test containers/processes started here were removed; unrelated services stayed intact.
  Next action: review/commit the coherent change, then controlled migration/API/extension and privacy
  page rollout with real X/LinkedIn DOM QA. Local fixtures do not establish hosted compatibility.

## Product and evaluation assessment — 2026-10-19

- Requested outcome: assess overall product improvements, suggestion latency/quality, X/Reddit
  browsing experience, and evaluation sufficiency. Scope: code/corpus review, current local
  baseline checks, and an evidence-backed proposal; no runtime or production changes.
  Acceptance: distinguish measured findings from hypotheses, identify evaluation blind spots,
  and give a bounded implementation sequence with observable success criteria.
- Completed [assessment](docs/product-assessment-2026-10-19.md) at `149d4b7`, preserving all
  pre-existing progress edits. Identified the five-second client deadline versus serial trend
  lookup plus 4.5-second inference budgets, browser milestone/event semantics, and Reddit's
  missing adapter/capability handling. Prioritize deadline/measurement correctness, human taste
  evaluation and reply controls, then a narrow Reddit pilot. These are proposals, not deployments
  or accepted replacements for D003/D004/D010 or the launch-plan backlog.
- Fresh deterministic evaluation passed: 104 cases, top-1/3/5/12 acceptable family rates
  74.0%/90.4%/99.0%/99.0%, with rejected-family intrusion on 10 top-five and 23 shortlist cases;
  case-level baseline unchanged; local ranking p95 0.414ms, synthetic 5000-template p95 15.841ms.
  Corpus review found exactly three expected families per case, no no-fit cases, source lengths
  66–166 characters, 104 singleton categories, and no explicit platform/provenance/holdout fields.
  Existing live comparison has twelve distinct posts and unfilled human humor scores.
- Verification: API evaluation tests 16 passed; selected extension tests 22 passed with the
  repository's tsx loader; benchmark audit passed without findings. Initial evaluation output
  directory and Node loader invocation errors were corrected and the checks rerun successfully.
  No live model calls, customer-data inspection, browser QA, deployment, or catalog changes.
  Documentation links/anchors, AGENTS.md length, and diff/whitespace checks passed.
- Next action: implement the bounded deadline/browser-observability task, then collect a genuine
  human taste baseline and reviewed development/holdout cases before tuning quality. Adopted work
  should be tracked in the existing launch plan. The assessment does not establish hosted readiness.

## Luna production migration — 2026-10-19

- Requested outcome: switch the purpose-specific chat/vision model settings to
  `openai/gpt-6-luna` and deploy the API to production. The operator explicitly chose Luna's
  cost tradeoff after the comparative live samples and authorized production deployment.
- Scope: runtime and offline-tool defaults/examples, explicit local and production operator
  overrides, deployed model settings, and the saved-image tagging output schema needed for a
  working Luna path. Preserve embeddings, cadence, budgets, strict validation, and fallback.
- Acceptance: focused/live changed-path checks, full repository readiness and release dry-run,
  a fresh verified/encrypted production backup, a committed clean release, production environment
  model readback, healthy deployment, and a bounded hosted user-flow smoke. Inspect deployed
  embedding configuration before syncing any operator-file drift. Existing progress edits and
  evaluation reports remain intact.
- Implementation: four runtime defaults and all offline template defaults/examples now select
  Luna; matching ignored local/operator overrides are updated. Deployed readback confirmed Gemini
  Embedding 2, and the stale operator-file value was reconciled to it without changing hosted
  embeddings. Saved-image tagging now sends its existing strict JSON schema; two live fixture
  calls returned non-fallback, valid seven-field tags. No catalog data or prompt taste changes.
- Verification: focused baseline 67 passed; updated focused suite 68 passed and template pipeline
  nine passed. Full `quality:deployment-readiness` passed: 479 API tests, 26 integration tests,
  static analysis/builds, process smoke, deterministic tuning, backend image smoke, and clean npm/
  Python audits. The first integration setup lacked schema privileges because the cached local
  pgvector-tagged image uses Supabase roles; corrected only the disposable test container role and
  database ownership, then reran the complete gate successfully. `release:dry-run` passed.
- Production environment preflight passed with zero warnings. Backup `20261019T064705Z` contains
  98 objects and 18 tables, schema `20260902_0010`; restored/verified on isolated port 55433,
  archived with the existing AES-256/Keychain workflow, and removed the verified plaintext copy.
  No backup or schema migration was used to change production data.
- Release `149d4b7` is committed and pushed to `main`; the pre-existing October 13 progress
  section was deliberately excluded from the commit and remains intact in the working tree.
  Updated exactly the four production runtime model variables to Luna, then read back all four;
  every other non-system Vercel variable compared unchanged, including Gemini Embedding 2 and
  the 172800-second freshness limit. Offline template selectors are updated in source/local env.
- Git-triggered API deployment `dpl_4dmQ9LNDKYok8xVPgumr4pXsx47T` is READY, URL
  `meme-drop-jybxwpsjo-moyezrabbaniworkgmailcoms-projects.vercel.app`; canonical
  `api.memedrop.moyezrabbani.dev` resolves to that deployment. `/live` and `/health` return 200;
  snapshot 156 is fresh with four cards. QStash readback remains daily `0 0 * * *`, three retries.
- Hosted black-box smoke: default synthetic scenario returned valid `no_fit`, matching replay,
  and zero charge. A known fixed benchmark fixture then generated one authenticated WebP
  (57,120 bytes), replayed identically, and settled exactly one credit. Initial generation 3.73s,
  replay 0.19s; operator test balance moved from one to zero. Both temporary API keys were revoked;
  no active operator keys remain. Inputs, captions, and credentials are absent from retained logs.
- Local readiness and release dry-run are complete; documentation/diff checks passed. No prompt,
  caption-validation, fallback, template-eligibility, cadence, or embedding migration was performed
  beyond supplying the unchanged tagging output schema. Temporary test services, archive checkout,
  operator scripts, and pulled env files were removed. Next action: inspect the next scheduled Luna trend refresh and actual
  production cost/quality before considering further cadence or routing changes.

## Three-model evaluation rerun — 2026-10-19

- Outcome: compare DeepSeek V4.1 Flash 1017, GPT-6 Luna, and Claude Haiku 5.5 now that DeepSeek
  has eligible endpoints. Scope: development-key live fixture evaluations only; no production
  configuration, data, catalog, privacy, or scheduler changes.
- Acceptance: identical fixed cases and current production budgets, balanced model ordering,
  repeated measurements of successful usable output, strict caption validity, family relevance,
  latency and provider-reported charges; equal secondary-path checks and a qualified recommendation.
  Human humor judgment remains separate from mechanical scores. Baseline `05a4abe`; preserve the
  existing PROGRESS.md edits and October 17 evaluation report.
- Completed [three-model rerun](docs/model-evaluation-2026-10-19.md): 36 primary interactive calls
  per model with balanced ordering, identical per-case payloads apart from model, and unchanged
  production budgets. DeepSeek/Luna each returned usable captions on 35/36 calls; Haiku 33/36.
  DeepSeek led strict validity (82.3% versus 76.2%/76.9%), valid-caption yield (144 versus 93/120),
  and acceptable-family coverage (34/36 versus 31/36 and 30/36). Median latency 1.76s versus
  3.23s/3.19s. Reported primary charges: $0.02354/$0.00773/$0.02246, excluding unreturned timeout
  charges. Prefer DeepSeek for interactive quality/speed; Luna remains the minimum-cost choice.
- Equal exploratory price-routing pass, twelve calls each: DeepSeek fell to 8/12 usable versus
  Luna 12/12 and Haiku 9/12. Keep latency-first routing for the DeepSeek interactive candidate.
  Three trend fixtures passed for all models; DeepSeek/Luna trend charges were effectively tied.
  Explicit caption cases: DeepSeek/Luna 2/2, Haiku 1/2; Luna cheaper. One-image pipeline checks
  passed for all; image tagging still falls back for all and needs a schema/prompt repair.
- 171 measured calls report $0.07504 in usage; eight cancelled calls have unknown returned cost.
  All used the development key. Fixed-fixture raw results and an anonymous review sheet remain
  ignored in `.memedrop/model-eval-20261019/`. Human humor scores remain blank; no model judge or
  fabricated human review. No production, privacy, storage, or catalog changes were made.
- Fresh baseline: 31 focused tests passed; deterministic 104-case benchmark and case-level
  baseline passed, 5000-template warm p95 14.97ms. Documentation links, credential-pattern and
  whitespace checks, anonymous-sheet identity/resource checks, the 73-line AGENTS.md limit, and
  `git diff --check` passed. Development-key usage increased $0.07805 during the run. Next action:
  human taste review and a purpose-specific migration with applicable tuning/release gates.

## Model cost evaluation — 2026-10-17

- October 19 follow-up: DeepSeek is now accessible with the existing development key. A minimal
  probe and a JSON/reasoning/routing-compatible probe returned HTTP 200; the latter used Together.
  Public metadata now lists fifteen endpoints versus the one observed October 17. No privacy or
  application setting was changed. Earlier blocking is historical; DeepSeek task quality remains
  unmeasured, and the model comparison should be completed before treating Luna as the final choice.
- Outcome: verify current trend refresh cadence and compare the three requested OpenRouter
  candidates against Gemini 3.7 Flash for quality, latency, compatibility, and cost.
- Scope: read-only hosted inspection and bounded live evaluations using repository fixtures;
  no production model, scheduler, storage, or catalog changes. Acceptance: live scheduler readback,
  current provider pricing, comparable case-level results under existing timeouts, and a documented
  recommendation with unverified paths and human-review requirements explicit.
- Baseline: `05a4abe`; the pre-existing uncommitted October 13 PROGRESS.md section is preserved.
  Focused caption evaluation, trend enrichment, and trend runtime tests: 31 passed.
- Completed [comparison and recommendation](docs/model-evaluation-2026-10-17.md): live QStash
  confirms daily 00:00 UTC / 05:30 IST; health is fresh, snapshot 154, five cards, 48-hour limit.
  Production key spending before probes: $1.06505 this month, $0.029883 today. Read-only production
  aggregates show no customer generations in 30 days; scheduled maintenance remains the leading
  attribution. About 321 search/enrichment opportunities per 30 days at the current cadence.
- Prefer Luna for a text-model migration: 24/24 joint cases completed versus Haiku 20/24;
  measured p95 3.53s versus 4.51s. Luna's strictly valid-caption rate was lower (74.2% versus
  81.4%), so this is a candidate recommendation pending human taste review, not rollout approval.
  Both passed three trend fixtures, two explicit-caption cases, and a one-image offline pipeline
  smoke. DeepSeek is blocked by existing account training/privacy policy, preserved unchanged;
  Gemini joint requests reject reasoning disabled. Auto-tagging falls back for all tested models;
  accessible finalists' diagnostics confirm response/schema mismatch requiring a prompt repair.
- Live metadata shows Luna/Haiku $0.10/$0.50 per million uncached input/output tokens, versus
  Gemini $0.75/$3.75. DeepSeek $0.15/$0.60 off-peak is not cheapest for uncached requests.
  Total development-key usage today at final inspection: $0.04334; one production-key connectivity
  probe added $0.0000072. No production settings, scheduler, privacy policy, catalogs, or storage
  were changed. Latest published vectors use Gemini Embedding 2, while the ignored operator file
  names OpenAI embeddings; reconcile that drift before any future deployment.
- Deterministic fallback benchmark: all gates passed on 104 cases, no baseline regressions;
  5000-template warm p95 14.79ms. Reports and fixture-only review artifacts remain ignored under
  `.memedrop/model-eval-20261017/`; sanitized results and remaining rollout requirements are in
  the linked report. Documentation local-link checks, credential-pattern inspection, the 73-line
  AGENTS.md limit, and final diff/whitespace review passed. Next action: human taste review and
  a purpose-specific Luna migration, beginning with trends; resolve tagging/schema and embedding
  configuration findings before any production rollout.

## CPU usage follow-up — 2026-10-13

- Outcome: explain idle production usage; the operator clarified the metric is Fluid Active CPU.
  Scope is read-only diagnosis, with no runtime or scheduler changes. Acceptance: distinguish CPU
  from transfer, check recent request paths, and separate measured evidence from attribution estimates.
- Baseline: clean `main` at `05a4abe`. Reviewed the existing maintenance evidence and current
  API health, startup, and workflow code. `vercel logs` for production API over the last hour
  returned six retained records, all `/health`, matching the ten-minute monitor cadence.
- `vercel usage --group-by project --json --cwd apps/api` still returns `Costs not found (404)`;
  the October 7 dashboard measurements below remain historical, not current-cycle measurements.
  Vercel's current function pricing docs confirm Active CPU measures execution, excludes external
  I/O wait, and includes four monthly hours on Hobby.
- Background scheduling remains the leading explanation: 4,320 health calls per 30 days plus
  approximately 750–900 daily-workflow calls and weekly cleanup. Startup imports, catalog loading,
  client construction, and workflow processing are CPU attribution candidates, not measured shares.
  A rolling 30-day chart still includes the heavier cadence before October 7.
- Next action: obtain current dashboard CPU by day and compare before/after October 7; profile
  startup and maintenance execution before choosing a reduction. Runtime tests were unnecessary
  for this diagnosis. Documentation diff checks passed; no settings or credentials were changed.

## Current maintenance change — 2026-10-07

- Baseline: `b19fd28` on `main`; the working tree was clean at startup.
- Requested outcome: reduce production trend refresh to daily and both cleanup jobs to weekly.
- Scope: QStash daily at 00:00 UTC, Vercel/backup cleanup Sundays at 03:30/03:40 UTC,
  a 48-hour freshness bound, matching configuration, maintenance/privacy documentation, and tests.
- Acceptance: live scheduler readbacks show the requested cadence; deployed `/health` uses the
  new freshness bound; applicable local gates pass; expired media still becomes inaccessible at
  30 days; the published privacy disclosure reflects weekly physical cleanup.
- Status: completed; API/web deployments, all three scheduler cadences, health freshness,
  and the published privacy disclosure verified. Focused baseline: 44 passed;
  updated focused boundary suite: 49 passed.
  Fresh production backup completed with 98 objects. Local readiness gate initially failed on a
  privacy contract assertion that still required daily cleanup; that assertion now matches weekly
  cleanup. Default local service ports belong to another project, so tests use isolated ports.
  Runtime, tuning, 26 database/Redis integration tests, and backend image smoke subsequently passed.
  The security gate then reported pre-existing locked npm vulnerabilities in Next.js, sharp,
  fast-uri, source-map-js, and undici, followed by PyJWT and urllib3; compatible dependency updates
  are included to unblock deployment, with no audit exceptions. Both npm and Python audits now pass.
  Fresh extension tests also exposed two stale tests assuming the live privacy document contained
  launch placeholders. Those cases now use an explicit draft-policy fixture via a validator input;
  all original placeholder/screenshot assertions remain intact and default policy validation is
  unchanged. Extension tests: 61 passed; root launch-status tests: eight passed.

## Production evidence

Checked on 2026-10-07 against the configured production services:

- PostgreSQL queries ran in an explicitly read-only transaction with a 12-second statement timeout;
  only aggregates, categorical values, and timestamps were returned. No customer free text or
  credentials were captured.
- Customer `users`: one account, with `auth_provider=operator`; zero customer OAuth accounts and
  zero new accounts in the last 30 days. Anonymous extension `install_users`: zero; usage events: zero.
- API keys: six historical keys, all revoked; zero owners active in the last 7 or 30 days.
- Generations: four lifetime attempts (two succeeded, two `no_fit`), all from the operator account;
  zero attempts in the last 30 days. Latest successful generation: 2026-09-06 08:55 UTC.
- Production `/health`: HTTP 200, database available, fresh trend snapshot, version 146, 15 cards.
- Tavily usage API: 172 of 1,000 account plan credits used; production key search usage also 172.
  Application ledger agrees for October; September reserved 707 credits. Ledger entries are
  reservations, not an independent measurement of provider charges.
- OpenRouter production key: $3.83744487 lifetime usage, $0.63647103 this month, $0.22363404 this
  week, $0.05617451 today. Account-wide purchased credits: $10; usage: $9.785148967; remaining:
  $0.214851033. Account spending outside this key is not attributed to production.
- Vercel dashboards inspected in Chrome profile `Moyez (Moyez Personal)`:
  - Landing analytics, last 7 days: two visitors, four page views, zero currently online.
    Analytics was added on October 5; visitors are not authenticated customer counts.
  - API usage, last 30 days (September 7–October 7): approximately 9,500 function invocations,
    5h 9m Fluid Active CPU, 19.5 GB-hours Fluid Provisioned Memory, eight build CPU minutes.
    Active CPU exceeds the documented four-hour Hobby monthly allowance; this rolling window
    does not establish the exact current billing-cycle percentage.
  - Landing usage, same rolling window: ten function invocations and memory rounded to zero GB-hours.
  - API observability, last 12 hours: approximately 165 invocations and 17s CPU; 46.9% cold starts.
    The function table groups the backend under `/fastapi`. Exact request-path breakdown requires
    Pro and displayed demo data, which was excluded from findings.
- Before this change, runtime code/runbooks showed a four-hour QStash trend refresh, a ten-minute health monitor, and
  daily primary/backup asset cleanup. Trend workflows run each of 21 curated queries as a separate
  step, including queries whose daily/weekly scan bucket has already completed. Background work is
  the leading explanation for spend with no recent customer generation; historical CPU attribution
  between workflow, health checks, cold starts, and other requests remains unverified.

## Limitations and next action

- Vercel CLI authentication worked, but current-period and October custom-range usage commands
  returned `Costs not found (404)`; the browser dashboard supplied usage evidence.
- Follow-up attribution: the configured regional QStash host returned HTTP 200 and confirmed the
  trend schedule is active, `0 */4 * * *`, with three retries. The default host used earlier was
  incorrect for this account. Live cron-job.org details confirmed the health monitor is enabled
  every ten minutes and backup cleanup is enabled daily at 03:40 UTC, both without response capture.
- Expected background volume per 30 days: health checks 4,320; trend workflow steps approximately
  4,500–5,400 (180 refreshes, roughly 25–30 HTTP invocations each); cleanup approximately 60.
  This is a schedule/code estimate, not exact historical route attribution. The workflow includes
  21 query steps and four fixed coordination steps, plus initial/final requests and embedding batches;
  daily/weekly collection skips still execute a workflow HTTP step.
- Recent Vercel request logs exposed eight retained requests: seven successful `/health` requests
  and one `/` request returning 404. No customer generation was present in that sample. This limited
  sample cannot rule out older unsolicited traffic. QStash delivered-log filtering for the public
  workflow URL returned no records; it did not provide a historical invocation count.
- Cadence changes are now applied to the live schedulers. The ten-minute health monitor remains
  enabled and accounts for an expected 4,320 monthly invocations. Future cost work can measure
  health-check/cold-start CPU and avoid unnecessary workflow steps. Trend freshness is now 48 hours.
- Hosted analytics ingestion is now observed; this does not establish broader release readiness.
- The initial investigation was read-only; the subsequent maintenance rollout is verified by
  the local and hosted evidence below.

## Maintenance release verification

- Full `quality:deployment-readiness`: passed against isolated PostgreSQL/pgvector at port 55433
  and Redis at port 56380. Includes typecheck, tests (478 API tests plus 26 integration tests), lint,
  all builds, API process smoke, deterministic tuning, backend image smoke, and clean npm/Python
  security audits. New freshness tests preserve missing/empty/stale failures and check the 48-hour
  boundary, including an overdue daily refresh. Existing expiry/media and cleanup safeguards pass.
- `release:dry-run`: passed, including release metadata and extension package validation.
- Production configuration preflight with the proposed 172800-second freshness setting: no errors
  or warnings. Documentation links, the 73-line AGENTS.md, and `git diff --check`: passed.
- Production backup 20261007T111609Z: 18 tables, schema 20260902_0010, 98 objects; hashes and
  restore verified in the isolated local database. Archived with the existing AES-256/Keychain
  workflow and removed the verified plaintext copy. The restore helper was temporarily adapted
  only to the isolated local port because another project owns port 5432.

## Hosted maintenance rollout

- Committed implementation: `af3cfb7`; deployments use a clean Git archive of that commit, excluding
  ignored operator credentials and local artifacts. Updated the ignored production operator file
  and Vercel production setting one-way to `MEMEDROP_TREND_SNAPSHOT_MAX_AGE_SECONDS=172800`.
- API deployment `dpl_8oKuEWY4hb9DcbpLoLyXB864PRMr`: READY. Live project cron definitions show
  `/internal/cron/assets/cleanup` with `30 3 * * 0` (Sundays at 03:30 UTC). Production `/health`
  returns HTTP 200 with a fresh snapshot and the 172800-second freshness limit.
- Existing QStash schedule `scd_65aL78hRe3wTQPur3VQFoEJVmfVY`: updated in place to `0 0 * * *`
  and read back active with three retries. Destination, method, headers, body, and retry count
  match the previous configuration. No duplicate schedule was created.
- cron-job.org cleanup job `8393375`: updated in place to Sunday at 03:40 UTC and read back
  enabled with response capture disabled. Other request, notification, and credential settings
  were compared in memory and preserved. No cleanup or paid trend refresh was manually triggered.

- Web deployment `dpl_HawmFz4L1FNG5az6GwPmEoAHa6Xj`: READY. Production landing, docs,
  privacy policy, and sign-in routes return HTTP 200. Published privacy HTML contains weekly cleanup,
  the preserved 30-day access expiry, and effective date October 7, 2026. API `/live` and `/health`
  both return HTTP 200. Read back the unchanged, enabled ten-minute health monitor.
- Next scheduled executions remain future events; no paid refresh or destructive cleanup was
  forced for verification. Expected background invocations fall to roughly 5,100–5,200 per 30 days;
  the unchanged health monitor still contributes 4,320. Trend refresh frequency falls by 83%.
- Isolated test containers were stopped and removed; other projects' running services were left
  intact. Temporary deployment archives and diagnostic files were removed after recording evidence.
- Implementation and rollout handoff were pushed to GitHub `main` after the direct production
  deployment was verified, preserving the new configuration for future Git-based deployments.
