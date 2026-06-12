# MemeDrop — Requirements (Local Testing)

This is a simplified requirements doc scoped to local development and testing. Production concerns (billing, managed hosting, CDN storage, job queues, auth) are deferred.

## What This Is

MemeDrop is a Chrome extension that helps X (Twitter) users reply to posts with memes. It solves these problems:

- You *know* a perfect meme exists for this reply, but you can't find it fast enough
- You want to be funny but don't have any ideas for a meme reply
- You see good memes while scrolling but have no way to save and reuse them later

The extension does two things:
1. **Suggests the right meme** when you open a reply composer on X
2. **Lets you save memes** you see while scrolling, building a personal library for browsing and a future saved-memes suggestion tab

---

## Tech Stack

### Use Now
| Layer | Technology |
|---|---|
| Extension framework | Manifest V3 (service worker, not background page) |
| Language | TypeScript throughout |
| Extension UI | React 19, TailwindCSS, Zustand |
| Extension build | Vite + CRXJS (MV3 HMR, content script bundling, manifest injection) |
| Extension storage | `chrome.storage` for persistence |
| Backend | Node.js + Fastify (TypeScript) |
| Database | PostgreSQL with pgvector (local Docker container) |
| AI — tweet analysis | Qwen through OpenRouter |
| AI — meme tagging | Qwen Vision through OpenRouter |
| AI — embeddings | openai/text-embedding-3-small through OpenRouter (1536-dim) |

### Local Replacements
| Production | Local Equivalent |
|---|---|
| Cloudflare R2 | Local filesystem (`./data/memes/`) served by Fastify static |
| BullMQ + Redis | Inline async calls (no queue) |
| Supabase Auth | No auth — all endpoints open |
| Supabase managed Postgres | Docker `pgvector/pgvector:pg16` |

### Deferred Entirely
Stripe, Redis caching, rate limiting, Railway deployment, Supabase Auth/RLS, Google OAuth.

---

## X.com DOM Reference

These observations are from manual inspection of X's React-rendered DOM. All selectors should live in a `selectors.ts` config file, decoupled from business logic.

### Key Elements

| Element | Selector Strategy | Notes |
|---|---|---|
| Tweet text | `div[data-testid="tweetText"]` | Contains nested spans/links with actual text content |
| Poster info | `div[data-testid="User-Name"]` | Contains nested spans with display name and @handle |
| Tweet photos | `div[data-testid="tweetPhoto"]` | Contains nested `img` elements |
| Reply composer (modal) | URL match: `x.com/compose/post` | Modal overlay that appears when replying from the feed |
| Reply composer (inline) | `div[data-testid="inline_reply_offscreen"]` | Appears when scrolling down on a tweet detail page (`x.com/[user]/status/[id]`) |

### Implementation Notes
- X's DOM is React-rendered and updates dynamically — never depend on static class names
- Content script must detect reply composer via **both** URL change (modal) and DOM mutation (inline)
- Use `MutationObserver` with debounce on `document.body` to handle React re-renders
- `data-testid` attributes are the most reliable selectors; fall back to aria attributes if needed
- When extracting tweet text for reply context, walk up from the composer to find the parent tweet's `tweetText` div
- These selectors contain nested child elements — you'll need to traverse into them to extract the actual text/image content

---

## Extension Architecture

Four components, all TypeScript.

### 1. Content Script (`content.ts`)
Injected into every `x.com` page.

**Responsibilities:**
- Monitor the DOM for reply composer activation using `MutationObserver` (see DOM Reference above)
- Extract tweet text (and thread context if available) when a reply is opened
- Inject the **suggestion panel** as a Shadow DOM element adjacent to the compose box
- Inject the **save button** overlay on image hover anywhere in the feed
- Communicate with the background service worker via `chrome.runtime.sendMessage`
- Insert selected meme images into the X compose box (clipboard API or drag-drop simulation)

### 2. Background Service Worker (`background.ts`)
Handles all API communication.

**Responsibilities:**
- Make all API calls to the MemeDrop backend (suggestions, save, usage events)
- Cache recent suggestion results in `chrome.storage.session` to avoid redundant API calls

### 3. Extension Popup (`popup/`)
React SPA rendered when the user clicks the extension icon.

**Contains:**
- **Library tab** — meme grid with search, tag filter, and sort (recency / usage frequency)
- **Placeholder auth screen** — stub for future auth integration

### 4. Suggestion Panel (injected into X page)
React component rendered inside a **Shadow DOM** container to prevent style collisions with X's CSS.

**Behavior:**
- Appears when reply composer opens
- Shows 5 meme thumbnails in a horizontal strip
- Each thumbnail shows: the meme image and a use-case label (e.g., "counter-argument", "reaction", "agreement")
- Clicking a meme inserts it directly into the X compose box as an image attachment
- User can scroll/paginate for more suggestions (backend returns 10, panel shows 5 at a time)
- Panel is draggable so it doesn't block the composer
- Panel closes on dismiss (X button), on clicking outside, or after posting the reply
- Lazy-loaded after reply event detection to keep initial page load fast

**Manifest permissions:**
- `activeTab` — access current tab content
- `storage` — local preferences and cached data
- `host_permissions: ["https://x.com/*"]` — content script injection

---

## Feature 1: AI Meme Reply Suggestions

### What It Does
When a user clicks "Reply" on any X post, a floating panel appears showing 5 contextually relevant memes they can click to attach to their reply.

### End-to-End Flow

1. User clicks Reply on a tweet
2. Content script detects reply composer opening via `MutationObserver`
3. Content script extracts the tweet text (and parent tweet if it's a thread)
4. Content script sends tweet text to background service worker
5. Service worker calls `POST /api/v1/suggest` with `{ tweet_text }`
6. Backend runs tweet context analysis through OpenRouter:
   - Classifies: sentiment (positive/negative/neutral), tone (sarcastic/earnest/rant/celebratory/hot-take/question), topic (tech/finance/politics/sports/entertainment/personal/culture), intent (counter-argument/agreement/sharing-opinion/venting/asking), intensity (0-1 float)
   - Returns structured JSON
7. Backend generates embedding from context JSON using `openai/text-embedding-3-small` through OpenRouter
8. Backend queries pgvector for nearest-neighbor meme matches against the meme embedding table
9. Backend applies scoring formula (see below) to rank candidates
10. Backend returns top 10 meme results with metadata (image URL, use-case label, match explanation)
11. Service worker passes results to content script
12. Content script renders suggestion panel showing top 5
13. User clicks a meme → image is inserted into X compose box
14. Usage event logged: `POST /api/v1/usage` with `{ meme_id, action: 'used', tweet_context }`
15. If user dismisses without using: log `action: 'dismissed'`

### Scoring Formula

| Component | Weight | Description |
|---|---|---|
| Context match score | 80% | Cosine similarity between tweet context embedding and meme use-case embedding |
| Recency penalty | -20% | Penalizes memes this user has used in the last 48 hours |

- Main suggestions use curated seed memes only.
- User-saved memes stay out of the main recommendation feed for now; they will be handled by a separate saved-memes tab later.
- Images only (no GIFs)
- Images only (no GIFs)

---

## Feature 2: One-Click Meme Save

### What It Does
A save icon appears when a user hovers over any image in the X feed. One click saves it to their personal library with AI-generated tags.

### End-to-End Flow

1. User hovers over an image in the X feed — a MemeDrop save icon appears in the top-right corner
2. User clicks the save icon
3. Instant visual confirmation: icon fills in, brief pulse animation
4. Content script sends image URL to background service worker
5. Service worker calls `POST /api/v1/library/save` with `{ image_url, source_tweet_id? }`
6. Backend downloads the image and saves to `./data/memes/{uuid}.{ext}` (local filesystem)
7. Backend calls OpenRouter vision **inline** with structured prompt requesting: `{ name, emotion, format_type, use_cases[], example_tweet_contexts[], is_evergreen }`
8. Backend stores the generated tags in Postgres
9. Response includes generated tags
10. Toast notification appears on the X page showing tags (e.g., "3 tags added: reaction, sarcastic, counter-argument")
11. Tapping the toast opens a quick-edit inline panel where the user can rename the meme and add custom tags
12. Meme is now in the personal library. It does not enter the main suggestion feed yet.

### Save Button UX
- Save icon follows the same visual language as X's bookmark icon
- Icon appears on hover over ANY image in the feed
- If a meme is already saved, icon appears filled with a subtle checkmark
- Images only (no GIFs)

### Quick-Edit Panel (on toast tap)
- Inline panel near the toast notification
- Fields: meme name (pre-filled from AI), custom tags (free-text, comma-separated)
- "Done" button or click-outside to dismiss
- Optional — meme is saved with AI tags even if the user ignores the toast

---

## Feature 3: Personal Meme Library

### What It Does
A library view inside the extension popup where users can browse, search, filter, and manage saved memes.

### Library Grid View
- Opens when user clicks the extension icon in Chrome toolbar
- Responsive grid of thumbnails
- Each thumbnail shows: meme image, meme name (truncated), tag chips (2-3 visible), usage count badge
- Default sort: most recently saved
- Alternative sort: most used, alphabetical

### Search
- Full-text search across meme names and all tags (system + user-defined)
- Fuzzy matching — "sarcasm" should match "sarcastic"

### Filter Panel
- Filter by emotion: sarcastic, absurdist, wholesome, savage, confused, celebratory
- Filter by format: reaction_image, text_overlay
- Filter by use case: counter_argument, agreement, self_deprecation, dunking, relatability, confusion
- Multiple filters at once (AND logic)

### Meme Detail View
- Click any meme to open detail view
- Shows: full-size image, meme name (editable), all tags (editable), usage count, last used date, date saved
- Actions: rename, add/remove tags, delete from library, copy image to clipboard
- "Use Now" button — active if a reply composer is currently open on the X tab

---

## Tag System

### Two Layers

**System tags (auto-generated through OpenRouter vision on save):**
- Emotion: sarcastic, absurdist, wholesome, savage, confused, celebratory
- Format: reaction_image, text_overlay
- Use case: counter_argument, agreement, self_deprecation, dunking, relatability, confusion
- Evergreen flag: boolean

**User-defined tags:**
- Free-text labels ("my go-to reply", "for tech twitter", "absolute banger")
- Optional at save time, always editable later

Usage events (suggested, used, dismissed) are logged for future personalization but not acted on yet.

---

## Database Schema

PostgreSQL with pgvector extension, running locally via Docker (`pgvector/pgvector:pg16`).

### `users`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | gen_random_uuid() |
| email | text UNIQUE | Identifier (placeholder, no auth enforced) |
| created_at | timestamptz | |

### `memes` (Global Seed Database)
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text | e.g., "Drake Pointing", "This Is Fine" |
| file_path | text | Local filesystem path |
| format_type | text | reaction_image / text_overlay |
| is_evergreen | boolean | |
| system_tags | jsonb | { emotion, use_cases[], example_contexts[] } |
| embedding | vector(1536) | pgvector column |
| source_url | text | |
| created_at | timestamptz | |

### `user_memes` (Personal Library)
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK | → users.id |
| global_meme_id | uuid FK | → memes.id (nullable for custom saves) |
| file_path | text | Local filesystem path |
| user_name | text | User-defined name; falls back to global meme name |
| user_tags | text[] | Free-text tags |
| system_tags | jsonb | Auto-generated through OpenRouter vision |
| embedding | vector(1536) | |
| use_count | integer | Default 0 |
| last_used_at | timestamptz | Nullable |
| created_at | timestamptz | |

### `usage_events`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK | → users.id |
| user_meme_id | uuid FK | → user_memes.id (nullable) |
| global_meme_id | uuid FK | → memes.id |
| action | text | 'suggested' / 'used' / 'dismissed' |
| tweet_context | jsonb | { sentiment, tone, topic, intent, intensity } |
| created_at | timestamptz | |

---

## API Endpoints

Base URL: `http://localhost:3001/api/v1`

No authentication required for local testing.

### Suggestions
| Method | Endpoint | Description |
|---|---|---|
| POST | /suggest | Returns top 10 meme suggestions. Body: `{ tweet_text }` |
| POST | /usage | Log usage event. Body: `{ meme_id, action, tweet_context }` |

### Library
| Method | Endpoint | Description |
|---|---|---|
| POST | /library/save | Save meme. Body: `{ image_url, source_tweet_id? }` |
| GET | /library | List user library. Params: search, tag, format, sort, page |
| PUT | /library/:id | Update name/tags. Body: `{ user_name?, user_tags? }` |
| DELETE | /library/:id | Delete meme from library |

### Global Memes
| Method | Endpoint | Description |
|---|---|---|
| GET | /memes/browse | Browse seed catalogue. Params: format, emotion, search |

---

## Project Structure

```
memedrop/
├── extension/                 # Chrome extension (Vite + CRXJS)
│   ├── src/
│   │   ├── content/
│   │   │   ├── content.ts     # Main content script
│   │   │   ├── selectors.ts   # X.com DOM selector config
│   │   │   ├── suggestion-panel/
│   │   │   └── save-button/
│   │   ├── background/
│   │   │   └── background.ts  # Service worker
│   │   ├── popup/
│   │   │   ├── App.tsx
│   │   │   ├── pages/
│   │   │   │   └── Library.tsx
│   │   │   └── components/
│   │   ├── shared/            # Types, utils, API client
│   │   └── styles/
│   ├── manifest.json
│   ├── vite.config.ts
│   └── package.json
├── backend/
│   ├── src/
│   │   ├── server.ts
│   │   ├── routes/
│   │   │   ├── suggest.ts
│   │   │   └── library.ts
│   │   ├── services/
│   │   │   ├── suggestion-engine.ts
│   │   │   ├── auto-tagger.ts
│   │   │   └── embedding.ts
│   │   └── db/
│   │       └── schema.sql
│   ├── scripts/
│   │   └── seed-memes.ts
│   ├── seed-data/
│   │   └── memes.json
│   ├── data/
│   │   └── memes/             # Local image storage
│   └── package.json
├── shared/
│   └── types/
│       ├── meme.ts
│       ├── user.ts
│       ├── suggestion.ts
│       └── api.ts
├── docker-compose.yml         # Postgres + pgvector
└── REQUIREMENTS.md
```

---

## Environment Variables

### Extension
- `VITE_API_BASE_URL=http://localhost:3001`

### Backend
- `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/memedrop`
- `OPENROUTER_API_KEY` — for analysis, tagging, captions, and embeddings
- `OPENROUTER_SITE_URL` — optional OpenRouter attribution URL
- `OPENROUTER_APP_NAME` — optional OpenRouter attribution name
- `MEME_STORAGE_PATH=./data/memes`

---

## Build Order

1. **Local infrastructure** — `docker-compose.yml` with `pgvector/pgvector:pg16`, apply `schema.sql`
2. **Backend skeleton** — Fastify server, health check, CORS config, static file serving for memes
3. **Extension scaffold** — Vite + CRXJS setup, manifest.json, content script that logs to console on x.com
4. **Content script DOM detection** — implement `selectors.ts`, detect reply composer opening, extract parent tweet text
5. **Suggestion engine** — OpenRouter analysis → embedding → pgvector nearest-neighbor → scoring → return results
6. **Suggestion panel** — Shadow DOM injection on reply open, show results, click-to-insert into X compose box
7. **Seed data** — curate 50 memes, write seed script (download images, generate embeddings, insert into DB)
8. **Save flow** — hover save button on images, API call, download to local storage, inline OpenRouter vision tagging, toast notification
9. **Library popup** — grid view, search, filter, detail view with edit
10. **End-to-end test** — reply to a tweet, get suggestions, insert meme, save from feed, see it in library

---

## What Is Deferred

These are explicitly out of scope for local testing:

- Authentication (Supabase Auth, Google OAuth, JWT)
- Billing (Stripe, free/pro tier limits, checkout flow)
- Cloud storage (Cloudflare R2, signed URLs)
- Job queue (BullMQ + Redis)
- Caching (Redis/Upstash)
- Rate limiting
- Deployment (Railway)
- Onboarding (install flow, meme taste quiz, starter pack)
- Trend score system (Reddit/KYM polling, cron refresh, decay formula)
- Preference learning (user preference vectors, personalization)
- Non-functional requirements (P95 latency, bundle size, uptime targets)
- GIF/video support
- Settings page
- Extension version checking
