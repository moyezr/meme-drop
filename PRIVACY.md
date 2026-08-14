# MemeDrop privacy policy draft

Last updated: 2026-08-15

This document describes the current MemeDrop implementation. It is not ready to publish until the
contact placeholder is replaced and the final infrastructure retention settings are verified.

## Purpose

MemeDrop is a Chrome extension that helps users create and insert meme replies on X and LinkedIn. It
reads source-post or compose context only after the user explicitly invokes MemeDrop for that post.
It is not designed to collect unrelated browsing activity.

## Data processed

MemeDrop processes:

- source-post or compose text used to request a suggestion or caption;
- optional guidance the user enters about a preferred joke direction, tone, or meme format;
- a random anonymous install ID stored by the extension;
- suggested meme IDs, captions, scores, and structured context such as intent, topic, or tone;
- outcome events such as shown, clicked, inserted/used, saved, and dismissed;
- images and tags the user chooses to save to a personal library;
- limited security, error, latency, and request-ID logs needed to operate the service.

The install ID separates one browser installation's library and feedback from another. It is not a
name, email address, or durable account, and reinstalling the extension may create a new ID.

## Use of data

The data is used to:

- generate, rank, and caption meme suggestions;
- render, store, and retrieve memes selected by the user;
- personalize and evaluate recommendation quality from aggregate outcomes;
- diagnose failures, measure latency, rate-limit requests, and prevent abuse.

MemeDrop does not sell personal data or use it for unrelated advertising.

## Processing and storage

Source-post text and optional user guidance are processed by the extension and FastAPI service and
may be sent to OpenRouter's model APIs for template selection and caption generation. Source text can remain
in bounded in-memory suggestion caches for up to five minutes. Optional guidance remains in memory
for the active composer and request; cache identity contains only a one-way hash. The application
does not write raw source-post text or user guidance to its database, usage events, or production logs.

PostgreSQL stores the anonymous install ID, saved-library records, and usage events with structured
post context. The input schema rejects raw post-text fields inside usage context. Saved image files
are stored in Supabase Storage through its S3-compatible service. The landing page and API are hosted
as separate Vercel projects.

Current application retention is deletion-based:

- in-memory suggestion caches expire after five minutes or process termination;
- optional guidance is cleared when the active composer closes or changes;
- saved images and library records remain until the user deletes the item or installation data;
- structured usage events remain until the user deletes installation data;
- the anonymous install ID remains in Chrome storage until extension data is cleared;
- infrastructure logs follow the retention configured in the final Vercel, Supabase, and model
  provider accounts and must be verified before publication.

Service providers process data only as needed to operate MemeDrop. The final published policy should
link the applicable Vercel, Supabase, and OpenRouter privacy terms and reflect the exact production
account settings.

## Sharing

Data is shared only with service providers needed to operate MemeDrop, when required by law, or when
needed to protect users and the service from abuse. MemeDrop does not sell user data.

## User controls

Users can remove individual saved memes and can export or delete all data associated with the current
browser install from the extension. The backend exposes install-scoped export and deletion endpoints.
Because the current identity is installation-based, data from an old or removed installation cannot
automatically be linked to a new installation.

For privacy questions or deletion help, contact: `<privacy-contact@example.com>`

## Chrome Web Store limited use

MemeDrop's use of Chrome extension user data is limited to its single purpose: generating, saving,
and inserting meme replies chosen by the user, and improving that user-facing functionality. The
published policy and Chrome Web Store disclosures must be reviewed against the policies in effect at
submission time.
