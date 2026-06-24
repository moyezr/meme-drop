# MemeDrop Launch Handoff

This file tracks the external work needed after the code release gates pass. It is intentionally separate from `RELEASE.md`: release gates prove the repo can build and package safely, while this checklist captures values and assets that only exist at launch time.

## Current Status

Run:

```bash
npm run release:dry-run
npm run launch:status
```

`release:dry-run` should pass in CI and locally. `launch:status` is expected to fail until the real production API origin, final Chrome Web Store extension ID, privacy policy, and store listing are available.

## Required External Inputs

1. Product landing page

Build the landing page from the static workspace:

```bash
npm run build:landing
```

Deploy `landing/dist` to the static host for:

```text
https://memedrop.moyezrabani.dev
```

Use the same host for public pages such as `/privacy` if your platform supports static routes. Keep this separate from the API origin so the Chrome extension can point directly at the backend.

2. Production API origin

Set the final HTTPS backend origin:

```bash
VITE_API_BASE_URL=https://api.moyezrabani.dev
```

Do not use localhost, an IP-only origin, a staging origin, or a placeholder domain for the Web Store package.

3. Chrome Web Store extension ID

Create the Web Store item first, then set backend CORS to the assigned extension origin:

```bash
MEMEDROP_CORS_ORIGINS=chrome-extension://<32-character-web-store-extension-id>
```

The ID is not known before the store item exists, so the first backend production deploy may need to be updated after creating the draft listing.

4. Hosted privacy policy

Replace placeholders in `PRIVACY.md`, host the policy on an HTTPS URL, and use that URL in the store listing. The policy must match actual behavior: tweet text goes to the backend for suggestions, an anonymous install ID isolates library/usage data, and users can delete their install data from the extension.

5. Store listing metadata

Create the real listing file:

```bash
npm run store-listing:init -- \
  --privacy-policy-url https://memedrop.moyezrabani.dev/privacy \
  --support-email support@moyezrabani.dev
```

Then edit `extension/store-listing.json` with final copy and screenshot paths.

6. Store screenshots

Save real screenshots under `extension/store-assets/`. The validator requires PNG/JPEG screenshots, at least two images, and at least one `1280x800` image.

7. Production secrets and storage

Populate the production environment from `.env.production.example`. Use persistent storage for `MEME_STORAGE_PATH`, not an ephemeral container path, and keep `MEMEDROP_REQUIRE_INSTALL_ID=true`.

## Final Validation

With production values loaded:

```bash
npm run quality:production-env
node extension/scripts/validate-store-readiness.mjs --strict --file extension/store-listing.json
VITE_API_BASE_URL=https://api.your-domain.example npm run package:extension:release
MEMEDROP_CORS_ORIGINS=chrome-extension://<32-character-web-store-extension-id> \
  VITE_API_BASE_URL=https://api.your-domain.example \
  npm run launch:status
VITE_API_BASE_URL=https://api.your-domain.example npm run release:candidate
```

Upload `.memedrop/memedrop-extension-v<version>.zip` only after those commands pass.

## Recommended Rollout

1. Deploy backend behind HTTPS with production database and persistent meme storage.
2. Create a Chrome Web Store draft item to obtain the extension ID.
3. Update backend CORS with the final `chrome-extension://` origin.
4. Package the extension against the real API origin.
5. Upload as private or unlisted first.
6. Test suggestion, caption, insert, save, library, delete-data, and usage-feedback flows on `https://x.com`.
7. Keep public launch gated until account/session identity and stronger abuse controls replace anonymous install IDs for broad distribution.
