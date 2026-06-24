# MemeDrop Privacy Policy Draft

Last updated: 2026-06-12

This draft describes the current MemeDrop implementation. Review it before publishing and replace placeholders with the final company/contact details.

## Product Purpose

MemeDrop is a Chrome extension that helps users create meme replies on X/Twitter. The extension reads the tweet or compose context needed to generate relevant meme suggestions and captions.

## Data We Process

MemeDrop may process:

- Tweet text or compose context selected by the user for meme suggestions.
- A random anonymous install ID stored by the extension to keep library and usage data separate from other installs.
- Generated meme suggestion metadata, including meme IDs, scores, and captions.
- Usage events such as which meme suggestions were shown, clicked, inserted or used, saved, and dismissed.
- Images the user chooses to save to their meme library.
- Technical logs needed to operate and secure the service.

MemeDrop should not collect unrelated browsing activity.

## How We Use Data

We use data to:

- Generate meme suggestions and captions.
- Render and save memes selected by the user.
- Improve ranking, caption quality, and product reliability.
- Prevent abuse and operate the backend service.

## Third-Party Processing

The backend currently sends prompt content and image-tagging requests to OpenRouter-powered model APIs. This is used for tweet analysis, embeddings, caption generation, and meme tagging.

Before launch, verify the current third-party processor list and link the applicable third-party terms or privacy pages.

## Storage And Retention

Current implementation stores:

- An anonymous install ID in Chrome extension storage.
- Saved meme library records and image files.
- Usage events for quality reporting and personalization, including shown, clicked, inserted/used, saved, and dismissed meme events.
- Generated system tags for saved memes.

Before launch, define exact retention windows for tweet context, usage events, saved images, and operational logs.

## Sharing

We do not sell user data. We share data only as needed to provide the MemeDrop service, operate infrastructure, comply with law, or protect the service from abuse.

## User Controls

Users can delete saved memes and usage history for the current browser install from the extension popup. The backend also exposes install-scoped export and deletion endpoints.

If account-based identity is added later, add account-level data export and deletion controls.

Contact: <privacy-contact@example.com>

## Chrome Web Store Limited Use

MemeDrop's use of Chrome extension user data should be limited to providing and improving its single purpose: generating and inserting meme replies selected by the user.

Before publishing, verify this policy against the current Chrome Web Store User Data Policy and Limited Use requirements.
