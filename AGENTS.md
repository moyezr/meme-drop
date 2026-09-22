# MemeDrop agent entry point

MemeDrop provides meme replies through a Chrome extension and a public agent API, with a Next.js
website/dashboard. npm workspaces and Turborepo coordinate the independently deployed applications.
See [README.md](README.md) for the workspace map and [architecture.md](architecture.md) for boundaries.

## Hard constraints

- Keep FastAPI as the only application backend; Python metadata, migrations, data, and tests stay
  in `apps/api`. Catalog and template-pipeline apps remain local development tools.
- Keep secrets server-side in ignored env files or deployment stores. Never retain source text,
  steering, or captions in logs, telemetry, or plaintext cache keys.
- Use `meme-drop-dev` for development and `meme-drop-prod` for production; never automatically
  create, empty, or delete buckets. Read the storage rules before touching credentials or data.
- Preserve verified-template eligibility, human catalog review, and deterministic recommendation
  fallback. Never weaken benchmarks, promotion gates, or tests to make a change pass.
- Respect existing user changes. Do not revert, stage, or commit unrelated or untracked user files.
- Prefer direct code; introduce an abstraction only when there is a current second use case.

## Start a session

1. Read [PROGRESS.md](PROGRESS.md); inspect `git status --short` and recent `git log` entries.
   Treat recorded checks as evidence for their recorded revision, not the current checkout.
2. Read the relevant [DECISIONS.md](DECISIONS.md) entries and topic documents below before editing.
3. Define the requested outcome, a bounded next step, and observable acceptance criteria. For work
   spanning sessions, record them in PROGRESS.md or link its existing launch-plan task.
4. Run the smallest relevant baseline check. Record pre-existing failures and missing prerequisites;
   resolve blockers for the affected path without taking over unrelated work.

## Bootstrap and common checks

Run from the repository root; install only when dependencies need setup or synchronization:

```sh
npm ci
uv sync --project apps/api --frozen
npm run dev:api             # other terminals: dev:catalog, dev:extension, dev:web
npm run typecheck
npm test
npm run lint
npm run build
```

Use [README setup](README.md#setup) for local services and configuration. The commands above do not
replace the change-specific checks in the development guide.

## Read when relevant

| When changing… | Required guidance |
| --- | --- |
| Code, dependencies, tests, or build tooling | [Development and verification](docs/development.md) |
| API routes, persistence, or backend packaging | [API README](apps/api/README.md) and [architecture](architecture.md) |
| Suggestions, captions, feedback, caching, catalog data, or rendering | [Suggestion contracts](docs/suggestion-contracts.md) and [quality gates](QUALITY.md) |
| Storage, secrets, environment configuration, or deployment | [Storage and secrets](docs/storage-and-secrets.md) |
| Public API smoke tooling | [Smoke-agent usage](apps/smoke-agent/README.md) and [credential boundary](docs/storage-and-secrets.md#public-api-smoke-boundary) |
| Template discovery or machine annotation | [Template pipeline](apps/template-pipeline/README.md) |
| Releases or production operations | [Release gates](docs/release.md), [deployment](docs/private-beta-deployment.md), and [operations](docs/private-beta-operations.md) |
| Launch scope or product priorities | [Launch plan](docs/production-launch-plan.md) |

## Finish or hand off

- Verify acceptance criteria and the applicable development gates. Exercise the changed user/API
  flow when behavior changes; record failures or unavailable checks explicitly. Untested is not done.
- Review the diff and run `git diff --check`. Leave changes coherent; remove only your temporary
  artifacts and stop only processes you started. Keep any commits concise, imperative, and working.
- Update PROGRESS.md with scope, evidence, remaining issues, and the next action after substantive
  work or before interruption. Update DECISIONS.md only for durable choices; update other docs when
  their contracts change. Never put secrets or user free text in handoffs.
- Report what changed, what was actually verified, and any remaining blockers. Local verification
  does not establish hosted readiness; use the release runbooks for that evidence.

Keep this file under 100 lines. Put task state in PROGRESS.md, rationale in DECISIONS.md, and detailed
rules in the linked topic document. Replace stale guidance rather than appending incident history.
