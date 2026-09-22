# MemeDrop progress

This is the current session handoff. Keep it short and replace stale state; git retains history.
After substantive work, record the goal, completed work, checks with revision/scope, blockers, and
the next action. Use `not_started`, `in_progress`, `blocked`, or `verified` for work items; `verified`
requires acceptance evidence. An unrun or unavailable check stays explicitly unverified.

The [launch plan](docs/production-launch-plan.md) owns the product backlog and its acceptance
criteria. [DECISIONS.md](DECISIONS.md) owns durable choices. Link those records instead of duplicating
their task lists or storing conversation transcripts here.

## Current checkout — 2026-09-22

- Branch: `codex/evaluate-jev`, based on current `main` (`c6fb35c`).
- Current task: evaluate and integrate TypeSafe Jev as an optional verified-shortlist reranker.
- Status: `verified` — evaluator and disabled-by-default runtime trial are implemented; evidence is
  recorded below. This status verifies the implementation, not production rollout readiness.
- Startup: [README setup](README.md#setup); verification selection:
  [development guide](docs/development.md).

## Acceptance and completed work

- [x] Evaluate pinned `jev-1.13.0` on the fixed 104-case suggestion benchmark and record quality,
  latency, stability, caption-contract, and estimated-cost evidence.
- [x] Add a server-side Jev client that only receives the bounded verified shortlist and transient
  request context, validates typed responses strictly, and applies a process-local cooldown.
- [x] Gate runtime use behind `MEMEDROP_JEV_RERANKER_ENABLED=false` with a 1.25-second Jev sub-budget
  inside the existing 4.5-second inference budget.
- [x] Use Jev only to reorder templates; keep caption writing in the existing caption model.
- [x] On Jev rejection, timeout, malformed output, or caption failure, return to the original local
  order and reviewed fallback without another provider attempt.
- [x] Preserve cache/singleflight behavior, verified-template eligibility, bounded steering, secret
  handling, non-sensitive logs, app-owned client cleanup, and production environment validation.
- [x] Document configuration, architecture, quality gates, evaluation results, and rollout limits.

## Verification evidence

Checked on 2026-09-22 against the Jev integration before merging current `main`:

- `npm run lint --workspace=@memedrop/api`: passed.
- `npm run typecheck --workspace=@memedrop/api`: passed, 128 source files.
- `npm test --workspace=@memedrop/api`: passed, 491 tests; 26 integration tests skipped.
- Focused Jev and affected-path suite: passed, 129 tests.
- `npm run quality:tuning`: passed after building `@memedrop/shared`; benchmark audit reported 104
  cases with no errors or warnings, deterministic suggestion gates passed, 16 renderer/shared tests
  passed, the verified manifest stayed within its existing 25-warning ceiling, and the promotion
  plan had no blocked approved templates.
- Live runtime-shaped smoke using the configured TypeSafe and OpenRouter credentials: two of three
  fixed cases completed Jev plus captioning in 3.51–3.63 seconds; one reached the shared deadline at
  4.53 seconds and safely returned local fallback. No source text or generated caption was logged.
- `git diff --check`: passed before the implementation commit.

The full evaluation and its limitations are in
[docs/jev-evaluation-2026-09-22.md](docs/jev-evaluation-2026-09-22.md). Jev improved top-1 selection
from 74.0% to 92.3%, but the tested sequential path did not clear all caption-contract and latency
gates. The runtime feature therefore remains disabled by default.

## Blockers and next action

- No implementation blocker remains.
- Do not enable Jev in production from this work alone. The next action is a controlled comparison
  against a repaired joint-model baseline, including human caption-taste review and end-to-end p95.

## Handoff maintenance

Keep only the latest useful checkpoint here. Retain exact failing commands, missing prerequisites,
and the smallest next action when work is interrupted. Use sanitized summaries and tracked evidence
links; keep secrets, raw user input, and generated captions out. Move a long execution plan beside
the relevant code or into `docs/` and link it here rather than expanding AGENTS.md.
