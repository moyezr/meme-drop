# MemeDrop Agent Notes

## Branch

Work was done on the `contextual-meme-text` branch.

## Contextual Meme Text Overlay Work

The product now supports tailoring suggested memes to the current X post by adding generated Impact-style text overlays before insertion.

### Backend Changes

- Added `backend/src/services/meme-text.ts`.
- Added `buildTailoredOverlays(tweetText, context, candidates)`.
- The overlay service creates structured text overlay instructions:
  - `enabled`
  - `style`
  - `template_id`
  - `alt_text`
  - `regions`
- Each region includes normalized placement coordinates, text, alignment, vertical alignment, line limits, character limits, and font constraints.
- The backend now uses a shared template manifest instead of hardcoded generic placement guesses.
- Runtime caption generation is batched through DeepSeek text JSON mode for up to the top known templates.
- Caption generation has a short timeout and falls back to reviewed example captions if the model is slow or unavailable.
- Unknown/unverified templates do not get automatic text overlays.
- Added verified baseline templates for common formats, including:
  - Drake Hotline Bling
  - Two Buttons
  - Distracted Boyfriend
  - Change My Mind
  - Always Has Been
  - Anakin Padme 4 Panel
  - Bernie asking
  - Trade Offer
  - Roll Safe
  - Evil Kermit
  - Panik Kalm Panik
  - Gru's Plan
  - Boardroom Meeting Suggestion
  - Mocking SpongeBob
- Updated `backend/src/services/suggestion-engine.ts` so each suggestion includes `tailored_overlay`.
- Updated `backend/src/services/retrieval.ts` so candidates include `format_type`.
- Saved user memes now inherit the original global meme `format_type` when linked to a global meme.
- Added `backend/scripts/generate-template-manifest.ts` for offline manifest generation.
- The generator now uses OpenAI Responses image input with `gpt-5.4-mini` by default.
- Added OpenAI Batch API modes for discounted async generation:
  - `manifest:batch:create`
  - `manifest:batch:status`
  - `manifest:batch:retrieve`
- Generated all current database memes into `shared/src/data/meme-template-manifest.generated.json` using OpenAI Batch API.
- Completed batch id: `batch_6a05e910bf608190b73a996818ae75bb`.
- Batch result: 63 total requests, 63 completed, 0 failed.
- Runtime lookup prefers verified hand-authored templates, then falls back to generated draft templates.
- Added backend npm scripts:
  - `manifest:generate`
  - `manifest:dry-run`

### Shared Types

- Updated `shared/src/types/suggestion.ts`.
- Added `tailored_overlay?: MemeTextOverlay | null` to `SuggestionResult`.
- Added:
  - `MemeTextOverlay`
  - `MemeTextRegion`
- Added shared manifest types in `shared/src/types/template-manifest.ts`.
- Added verified baseline manifest in `shared/src/data/meme-template-manifest.ts`.
- Added generated draft manifest in `shared/src/data/meme-template-manifest.generated.json`.
- Added template lookup helpers in `shared/src/data/template-lookup.ts`.

### Extension Changes

- Updated `extension/src/background/background.ts` types to preserve `tailored_overlay` through the suggestion flow.
- Updated `extension/src/content/suggestion-panel.ts` to render overlays client-side using a canvas.
- The renderer:
  - draws the original meme image
  - renders uppercase Impact-style text
  - uses white fill with black stroke
  - wraps text within each manifest region
  - obeys manifest min/max font sizes, max lines, max chars, and stroke ratio
  - skips drawing text that still cannot fit after shrinking
- Suggestion cards preview the tailored meme when rendering succeeds.
- Click-to-insert and drag-to-insert now use the rendered tailored PNG when available.
- If rendering fails, the extension falls back to the original image.
- Cards with generated text show a small `text` badge.

## Important Behavior

- The language/model side generates short region captions only.
- The extension performs deterministic rendering.
- This keeps insertion fast and avoids a separate image-generation round trip.
- Placement is manifest-driven and precomputed. Runtime does not ask a model where text should go.
- Unknown templates are left untouched instead of receiving generic top/bottom text.
- DeepSeek's public `/chat/completions` endpoint rejected OpenAI-style `image_url` message parts during testing.
- OpenAI `gpt-5.4-mini` image input worked for template generation and produced 63 generated draft templates for the current meme catalog.
- Treat generated manifests as `draft` and review them before promotion to `verified`.

## Verification Commands

Run from the repo root:

```bash
npm run typecheck --workspace=backend
npm run typecheck --workspace=extension
npm run typecheck --workspace=shared
npm run build --workspace=backend
npm run build --workspace=extension
npm run manifest:dry-run --workspace=backend -- --limit 3
npm run manifest:batch:create --workspace=backend
npm run manifest:batch:status --workspace=backend -- <batch_id>
npm run manifest:batch:retrieve --workspace=backend -- <batch_id>
```

All of these passed after the overlay work.

## Manual Verification

To see the change in the browser extension:

1. Make sure the repo is on `contextual-meme-text`.
2. Restart the backend on this branch.
3. Rebuild and reload the extension.
4. Open an X compose/reply flow.
5. Refresh MemeDrop suggestions.
6. Suggested meme cards should show generated Impact-style overlay text.
7. Clicking or dragging a suggestion should attach the customized PNG.

## Known Notes

- The extension build emits an existing Vite warning about `toast.ts` being both dynamically and statically imported. It does not block the build.
- If no overlay appears, first confirm the running backend is from this branch and that the loaded extension build is fresh.
