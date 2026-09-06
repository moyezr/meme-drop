# Private-beta operations

This runbook covers the production API and web private beta. Chrome Web Store submission and paid
self-service remain separate release tracks.

## Current production controls

- QStash schedule `scd_65aL78hRe3wTQPur3VQFoEJVmfVY` starts the signed trend workflow every four
  hours. The workflow retries each bounded step three times and publishes only a complete snapshot.
- cron-job.org job `8391201` calls `GET /health` every ten minutes. It alerts after two consecutive
  failures, on recovery, on automatic disablement, and seven days before TLS certificate expiry.
- Vercel calls the idempotent generated-asset cleanup at 03:30 UTC. cron-job.org job `8393375`
  repeats the protected cleanup at 03:40 UTC and alerts on the first non-successful response. The
  second delivery is safe because the worker uses a Redis lease and durable PostgreSQL claims.
- `/health` returns HTTP 503 for database, Redis rate-limiter, empty-trend, or stale-trend failures.
  A trend snapshot older than eight hours is stale.

Keep response capture disabled on both cron-job.org jobs. The cleanup job contains the production
cron bearer token, so access to the cron-job.org account and API key is production access.

## Backup and recovery

Supabase Free does not provide downloadable managed daily backups. Before every deployment and at
least daily while beta users are active, create an operator backup:

```sh
npm run ops:backup:production
```

The command reads the ignored `.env.prod`, refuses any bucket other than `meme-drop-prod`, and writes
a mode-700 timestamped snapshot under `~/.memedrop/backups`. Each snapshot contains a custom-format
dump of the application-owned `public` tables, every production S3 object, and a SHA-256 manifest.
Copy completed snapshots to an encrypted device or account that is separate from Supabase and keep
at least the newest seven daily snapshots. Never put a snapshot in the repository or a shared log.

Verify a snapshot against the disposable local pgvector database:

```sh
npm run db:up
npm run ops:verify-backup -- "$HOME/.memedrop/backups/<timestamp>"
```

The verifier checks every file hash, restores the database into the fixed
`memedrop_restore_test` database, checks the Alembic version and table inventory, and removes the
test database. On this macOS operator machine, move a verified snapshot into an AES-256-encrypted
iCloud Drive archive and remove its plaintext copy with:

```sh
npm run ops:archive-backup:macos -- "$HOME/.memedrop/backups/<timestamp>"
```

The command requires the verifier's `VERIFIED` marker, stores or reuses the archive password in the
login Keychain under `MemeDrop production backup encryption`, decrypts and inventories the finished
archive as a check, and only then removes the plaintext snapshot. Keep at least the newest seven
encrypted daily archives. To recover one, retrieve the password with macOS Keychain, decrypt the
archive with the same AES-256-CBC, PBKDF2, and 600,000-iteration settings, extract it under
`~/.memedrop/backups`, and run `ops:verify-backup` again before any production restore.

A production restore is a maintenance operation: stop writes, take one final backup,
restore into a new Supabase project first, run the same smoke checks, then change deployment secrets
and DNS. Do not overwrite the only production database while investigating an incident. Database
backups do not replace object backups; restore the matching `storage/` tree to `meme-drop-prod`
before reopening media traffic.

## Release and rollback

Deploy only a committed release for which the repository gates pass. Record the commit, API and web
deployment IDs, QStash schedule ID, monitor job IDs, schema version, storage check, and black-box
smoke result in the release notes.

For an application regression:

1. Pause new beta access and inspect `/live`, `/health`, Vercel errors, QStash runs, and both
   cron-job.org histories. Do not copy request bodies or credentials into the incident record.
2. Roll the affected Vercel project back to the last verified deployment. Do not roll back the
   database automatically; migrations are forward-only unless a reviewed migration-specific
   recovery plan says otherwise.
3. Re-run `/live`, `/health`, storage checks, and the black-box agent smoke against the rollback.
4. If the incident involves trends, keep the last published snapshot and pause the QStash schedule
   until the workflow is fixed. If it involves storage cleanup, disable both cleanup schedules until
   exact object-key behavior is understood.
5. Correct the defect on a new commit and repeat the full release gate before promotion.

## Credential rotation

Customer API keys use the operator commands documented in `apps/api/README.md`. Issue the
replacement, deliver it once, confirm the new key works, then revoke the old key. For an exposed key,
revoke first and issue the replacement second.

For infrastructure credentials, create the replacement at the provider, update `.env.prod`, push
the new value one-way into the appropriate Vercel project, deploy, and verify `/health` plus the
smallest provider-specific operation before revoking the previous credential. Rotate the shared
dashboard bridge secret in the API and web projects in the same maintenance window. QStash signing
key rotation must preserve the provider's current and next keys together so in-flight workflow
requests continue to verify.

Never pull Vercel Sensitive values into `.env.prod`; pulled values are opaque references and would
overwrite the operator source file.

## Provider and dependency incidents

- **OpenRouter:** allow the bounded deterministic fallback to serve reviewed templates. If error
  volume or cost is abnormal, disable beta access or reduce the per-user limit; do not relax caption,
  safety, region, or length gates.
- **Tavily or QStash:** the last good trend snapshot remains active. Investigate before manually
  refreshing, and do not publish a partial snapshot. The health monitor alerts once the snapshot is
  older than eight hours.
- **PostgreSQL:** stop mutations, preserve the current database, take a logical backup if it is
  reachable, and recover into a separate project from the last verified snapshot.
- **Redis:** authenticated generation and other protected routes fail closed when the production
  limiter is unavailable. Restore Redis connectivity before reopening access.
- **S3:** stop generation and cleanup if exact-key reads or writes fail. Do not point production at
  `meme-drop-dev` and do not bulk-delete or auto-create a replacement bucket.

## Credit correction

Every correction needs a user ID, categorical reason, amount, operator, and incident reference.
For an incorrect generation charge, grant the exact number of credits with a unique incident-based
idempotency key and verify the resulting balance with `agent:admin status`. Reuse the same key and
amount on retries. Do not edit balances or ledger rows directly. An accidental over-grant requires
a reviewed compensating-ledger operation; until that exists, suspend further grants for the account
and record the amount rather than deleting history.

## Daily beta review

Check the health monitor and cleanup history, QStash workflow status, Vercel error logs, OpenRouter
usage, Tavily credits, database/storage utilization, generation success versus `no_fit`, and credit
balances. Production logs and operator reports may contain request IDs and categorical outcomes
only. They must not contain source posts, captions, API credentials, signed URLs, request bodies, or
plaintext cache keys.
