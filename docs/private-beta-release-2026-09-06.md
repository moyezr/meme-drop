# Private-beta release record — 2026-09-06

This record captures the verified production state immediately before inviting the first API/web
private-beta group. Tester invitations are intentionally outside this release.

## Release identity

- Git commit: `646ec52` (`Move trend refresh to QStash`)
- API deployment: `dpl_13eAuvuxnhPRSecSsTfaBx7TDoT3`
- Web deployment: `dpl_87BftzmV5P7FxNVGDVEkH8siCqEV`
- Database schema: `20260902_0010`
- QStash schedule: `scd_65aL78hRe3wTQPur3VQFoEJVmfVY`, every four hours
- Health monitor: cron-job.org job `8391201`, every ten minutes
- Cleanup verification: cron-job.org job `8393375`, daily at 03:40 UTC after Vercel's 03:30 run

## Verification evidence

- Production environment validation completed with zero warnings.
- Database migrations are at head and all 49 verified templates exist in PostgreSQL and
  `meme-drop-prod`, with originals and thumbnails.
- The QStash workflow completed a provider-backed refresh. Snapshot v14 is fresh and contains nine
  serving cards.
- The exact release passed Vercel's locked dependency install, production configuration validation,
  application import, and Singapore function deployment. `/live` and `/health` returned HTTP 200.
- A black-box agent request returned one WebP asset, replayed idempotently without a second charge,
  and downloaded through authenticated media. The initial generation took 2.51 seconds and the
  complete smoke took 3.46 seconds. Its ephemeral API key was revoked and its asset was expired and
  removed through the production cleanup route.
- A recent production-log scan found no source input, authorization value, API secret, signed URL,
  caption, or request body.
- API-key issue, rotation, old-key rejection, replacement-key acceptance, and revocation were
  exercised against production.
- Vercel rollback to `dpl_DDf1hNaKKetGRcvyjSogUQ5iPBz1` preserved healthy `/live` and `/health`;
  this release was then promoted again and reverified.
- Final backup `20260906T085616Z` contains the application database plus 98 production storage
  objects. Every SHA-256 matched and the database restored into a disposable PostgreSQL instance at
  schema `20260902_0010` with all 18 application tables.
- The private-beta launch check passed with zero warnings. The public Chrome extension gate remains
  separate and still requires its Web Store identity and listing.

## Operator entry point

Use [`private-beta-operations.md`](private-beta-operations.md) for daily review, backup and restore,
incident response, provider outages, credential rotation, rollback, and credit correction.
