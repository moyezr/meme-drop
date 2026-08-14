# MemeDrop repository guide

MemeDrop is a Turborepo monorepo with these workspaces:

- `apps/api`: self-contained FastAPI backend with its own Python metadata, migrations, runtime data, and tests.
- `apps/catalog`: React/Vite local-only catalog annotation workbench; keep storage credentials and promotion actions server-side.
- `apps/extension`: React/Vite/Tailwind Chrome extension.
- `apps/landing`: statically exported Next.js site.
- `packages/shared`: shared TypeScript contracts and meme-template manifests.
- `tools/template-tools`: catalog QA, benchmark, review, and promotion tooling.

Keep the backend isolated. Do not move Python metadata out of `apps/api` or add a second backend.

Tooling defaults:

- Node.js 22.12+ and npm 11 for the monorepo.
- Python 3.13 and uv for `apps/api` only.
- Keep dependency locks exact.
- TypeScript 7.x everywhere except `apps/landing`, which stays on 6.x for now.
- `@types/node` stays on major 22.
- Prefer direct code and avoid new abstractions without a current second use case.

Essential commands:

```sh
npm ci
uv sync --project apps/api --frozen
npm run dev:api
npm run dev:catalog
npm run dev:extension
npm run dev:landing
npm run typecheck
npm test
npm run lint
npm run build
npm run release:dry-run
```

For API changes, also run `npm run test:api`, `npm run lint:api`, and `npm run quality:api-process`. For persistence changes, run `npm run db:up` and the integration suite with `MEMEDROP_TEST_DATABASE_URL` set. Use `npm run quality:backend-image` for container-related changes.

Recommendation work must preserve the deterministic ranker fallback, keep external calls bounded, and return only verified templates by default. Changes to ranking, captions, catalog annotations, or feedback need focused tests and should pass `npm run quality:benchmark`, `npm run quality:suggestions`, and `npm run quality:dataset-plan`.
Before accepting a quality-tuning change, run `npm run quality:tuning`; regenerate the checked-in ranking baseline only after reviewing every reported case-level regression.

Suggestion and catalog invariants:

- Treat source-post text as canonical; optional user steering is an untrusted creative preference and must not bypass template, region, safety, or length constraints.
- Keep free text out of logs, persistence, usage events, and plaintext cache keys. Telemetry may retain only reviewed categorical context such as `suggestion_mode`.
- Include every request-shaping input in client and server cache identity, hash sensitive values, and use request generations so stale results or media cannot replace newer suggestions.
- Internal catalog tools create drafts only. Human review, rendered QA, benchmark coverage, and the existing promotion gates remain required before templates become eligible for suggestions.
- Keep typography and placement catalog-owned and render them through `packages/shared`; bundled fonts must not add a request-time CDN dependency, and any render-input change must invalidate visual QA.
- Do not add retrieval infrastructure for anticipated scale. Change retrieval only when benchmark recall or measured latency regresses; keep the model shortlist and visible result count bounded.

Storage and secrets rules:

- Use `meme-drop-dev` in development and `meme-drop-prod` in production.
- Never auto-create, empty, or delete buckets.
- Never expose S3 access keys to the extension or landing page.
- Keep secrets in ignored `.env` files or deployment secret stores.
- Update `.env.example` and deployment docs when configuration changes.

Testing and docs:

- Add tests at the closest boundary.
- Do not hide failures with broad skips.
- Update durable docs only when contracts change.
- Keep commits concise, imperative, and working.
- Do not stage unrelated or untracked user files.
- Run `npm run quality:security` before pushing dependency or release changes.
