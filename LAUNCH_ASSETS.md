# MemeDrop Launch Assets Checklist

Use this file to track the external inputs needed for the landing page, Chrome Web Store listing, and production release.

## Domains

- [ ] Point `memedrop.moyezrabani.dev` to the landing page host.
- [ ] Point `api.moyezrabani.dev` to the production backend host.
- [ ] Confirm HTTPS works for both domains.

## Landing Page Assets

- [ ] Hero demo video, `20-45s`, web-optimized MP4, ideally under `10-20 MB`.
- [ ] Poster image for the hero video, preferably `1600x1000` or larger.
- [ ] 1-2 clean screenshots of MemeDrop working inside X.
- [ ] Optional improved product logo or wordmark.
- [ ] Optional Open Graph image, recommended `1200x630`.

Demo video should show:

- [ ] Opening a reply on X.
- [ ] MemeDrop suggestions appearing.
- [ ] Clicking or dragging a meme into the reply box.
- [ ] Captioned meme getting inserted.

## Chrome Web Store Assets

- [ ] At least 2 Chrome Web Store screenshots.
- [ ] At least one screenshot at `1280x800`.
- [ ] Screenshot: suggestion panel open on X reply composer.
- [ ] Screenshot: meme inserted into X composer.
- [ ] Screenshot: extension popup or library page.
- [ ] PNG or JPEG format.
- [ ] Optional refreshed extension icons if you want better branding.

## Chrome Web Store Copy

- [ ] Short description, one sentence.
- [ ] Detailed description, `2-4` short paragraphs.
- [ ] Category.
- [ ] Support email.
- [ ] Privacy policy URL.
- [ ] Final Chrome Web Store draft extension ID.

## Privacy Policy Inputs

- [ ] Support/contact email.
- [ ] Exact retention period for logs and usage data.
- [ ] Whether users can request deletion by email.
- [ ] Confirm that tweet text is sent to the backend for suggestions and captions.
- [ ] Confirm that anonymous install IDs are used until real accounts are added.

## Production Secrets

- [ ] OpenRouter API key.
- [ ] Production database URL.
- [ ] Production meme storage location.
- [ ] Backend environment values for `api.moyezrabani.dev`.
- [ ] Chrome extension CORS origin: `chrome-extension://<web-store-extension-id>`.

## Final Manual QA

- [ ] Install packaged extension.
- [ ] Open X reply composer.
- [ ] Verify suggestions appear quickly.
- [ ] Verify caption loading state.
- [ ] Verify click insert.
- [ ] Verify drag/drop insert.
- [ ] Verify save meme.
- [ ] Verify library page.
- [ ] Verify delete account/data flow.
