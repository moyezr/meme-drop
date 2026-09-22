# MemeDrop progress

This is the current session handoff. Keep it short and replace stale state; git retains history.
After substantive work, record the goal, completed work, checks with revision/scope, blockers, and
the next action. Use `not_started`, `in_progress`, `blocked`, or `verified` for work items; `verified`
requires acceptance evidence. An unrun or unavailable check stays explicitly unverified.

The [launch plan](docs/production-launch-plan.md) owns the product backlog and its acceptance
criteria. [DECISIONS.md](DECISIONS.md) owns durable choices. Link those records instead of duplicating
their task lists or storing conversation transcripts here.

## Current checkout — 2026-09-09

- Baseline commit: `3819bf6` — `Align private beta release boundary`.
- Current task: reorganize repository guidance using the harness engineering course.
- Status: `verified` — documentation reorganization complete; evidence below.
- Runtime test/build status: not run in this documentation-only session. Historical checks below
  do not certify the present checkout.
- Startup: [README setup](README.md#setup); verification selection: [development guide](docs/development.md).
- Pre-existing work is outside this task: edits to `apps/web/src/app/privacy-policy/page.tsx`,
  `apps/web/src/app/terms/page.tsx`, and `apps/web/tests/landing.test.ts`; untracked `INTERVIEW_PREP.md`
  and `apps/web/public/memedrop_og_image.png`. Preserve these and recheck git status next session.

## Acceptance and completed work

- [x] Keep AGENTS.md below 100 lines with bootstrap, routing, hard constraints, and completion rules.
- [x] Preserve the former guide's safeguards in linked development, suggestion, and storage topics.
- [x] Separate session state, decision rationale, and product backlog; seed records from repository
  evidence and identify historical verification explicitly.
- [x] Verify links, anchors, documented commands, rule coverage, and the final documentation diff.

## Verification evidence

Checked on 2026-09-09 against the documentation changes over `3819bf6`:

- One-off `node --input-type=module` documentation audit: passed for all eight changed Markdown
  files; local file/heading links resolve, referenced root npm scripts exist, fences are balanced,
  and no trailing whitespace was found. AGENTS.md is 73 lines (limit: fewer than 100).
- `git diff --check`: passed. Reviewed the tracked diff and all five newly added Markdown files.
- Compared every rule in the former AGENTS.md with its new owning document: toolchain and test
  requirements, recommendation/catalog gates, input/cache/privacy rules, storage and smoke-agent
  credential boundaries, production secret synchronization, and worktree hygiene remain covered.
- Repository-only handoff review: purpose/layout, startup, verification, current state, and decision
  rationale are reachable from AGENTS.md. This was a document review, not a fresh-agent runtime test.

No application suites or deployment checks were run because this task changes documentation only.
No commit was created, and pre-existing user work was left untouched.

## Recorded product state and unresolved work

The [release record](docs/private-beta-release-2026-09-06.md) reports a verified API/web private-beta
release on 2026-09-06 and follow-up verification on 2026-09-07. The follow-up records 499 API tests,
26 PostgreSQL/Redis integration tests, lint, type checking, API process smoke, and live dashboard/key
lifecycle verification. These are historical results, not checks rerun on 2026-09-09.

At the latest recorded launch checkpoint, tester invitations remained an operator step; paid
checkout, public self-service, and Chrome Web Store submission remained separate release tracks.
Production Dodo configuration was disabled. Further metrics, billing/policy work, and catalog review
remain in the [launch plan](docs/production-launch-plan.md). Their live status was not rechecked here.

## Blockers and next action

- No remaining work or blocker for this documentation task.
- For subsequent product work, select the requested task from the launch plan, confirm its actual
  checkout state, and record a bounded acceptance check before implementing it. Do not infer a new
  deployment or tester-invitation task from this handoff.

## Handoff maintenance

Keep only the latest useful checkpoint here. Retain exact failing commands, missing prerequisites,
and the smallest next action when work is interrupted. Use sanitized summaries and tracked evidence
links; keep secrets, raw user input, and generated captions out. Move a long execution plan beside
the relevant code or into `docs/` and link it here rather than expanding AGENTS.md.
