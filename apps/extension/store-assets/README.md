# Store Assets

Place Chrome Web Store screenshots here before strict public submission.

Requirements enforced by `node apps/extension/scripts/validate-store-readiness.mjs --strict --file apps/extension/store-listing.json`:

- PNG or JPEG files only.
- Screenshot dimensions must be `1280x800` or `640x400`.
- At least one listed screenshot must be `1280x800`.
- Paths must match the `screenshots[].path` entries in `apps/extension/store-listing.json`.
