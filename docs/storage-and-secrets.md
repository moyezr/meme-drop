# Storage and secrets

Read this before changing storage, credentials, env loading, deployment, or smoke-agent transport.
These rules carry forward AGENTS.md at `3819bf6`; the linked runbooks own operational procedures.

## Environment boundaries

- Use `meme-drop-dev` in development and `meme-drop-prod` in production. Never automatically
  create, empty, or delete buckets.
- Keep S3 access keys server-side. Never expose them to the extension, web app, or catalog browser;
  catalog storage and promotion actions belong on the server or in controlled release tooling.
- Store secrets only in ignored `.env` files or deployment secret stores. Update the appropriate
  `.env.example` and deployment docs when configuration changes.
- Keep Python runtime data, migrations, and configuration ownership inside `apps/api`.
  Migrations and catalog seeding are controlled release steps, never startup or build side effects.

## Production secret synchronization

Synchronization is one-way from the ignored operator file to the deployment store. Never run
`vercel env pull` into `.env.prod` or any other operator-owned source file: Vercel Sensitive values
are write-only and pulls replace plaintext with opaque references. When inspection requires a pull,
use a fresh disposable path; do not copy its opaque values back over the source of truth.

Use [private-beta deployment](private-beta-deployment.md) for configuration, and
[private-beta operations](private-beta-operations.md) for rotation, recovery, and rollback.

## Public API smoke boundary

- `apps/smoke-agent` may use only documented HTTPS routes. It must never import backend internals,
  read persistence directly, or access object storage.
- Read `MEMEDROP_API_KEY` only from the environment. Never accept it as a CLI argument, print it,
  persist it, or forward it to an origin other than `MEMEDROP_API_BASE_URL`.
- Preserve the client's media-origin and path validation and explicit generation confirmation.
  Follow the [smoke-agent README](../apps/smoke-agent/README.md) for the bounded generation/replay check.

These boundaries apply to diagnostics and handoff files too. Change them only with a recorded
security/architecture decision and tests at the affected credential, storage, or transport boundary.
