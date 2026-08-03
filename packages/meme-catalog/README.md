# MemeDrop Meme Catalog

`manifest.json` is the language-neutral runtime catalog consumed by FastAPI and, after the backend
migration, the TypeScript clients. Its source data remains the curated, promoted, and generated
manifests under `packages/shared/src/data` until the final repository cleanup.

Regenerate it from the repository root:

```sh
npm run catalog:export
```

The export is deterministic except for `generated_at`. Runtime code treats verified curated and
promoted templates as production candidates and generated drafts as opt-in evaluation data.
