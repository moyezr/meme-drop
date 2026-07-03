# MemeDrop

MemeDrop is a local-first Chrome extension for replying on X/Twitter with meme suggestions. The repo includes:

- a Fastify API that serves suggestions, meme images, library routes, and usage feedback
- a Chrome extension built with React, Vite, Tailwind, and CRXJS
- shared TypeScript types and meme template data
- a small Next.js landing page that can be hosted separately on Vercel

This project is intended to be easy to run locally. The landing page can be hosted publicly, but the app itself is designed to work from your machine.

## Requirements

- Node.js 22 or newer
- npm
- Docker Desktop or another Docker Compose runtime
- Chrome or a Chromium-based browser
- Optional: an OpenRouter API key for model-backed template selection and captions

MemeDrop still works without an OpenRouter key, but suggestions and captions will use local fallbacks.

## Project Layout

```text
backend/    Fastify API, Drizzle schema, database scripts, services, tests
extension/  Chrome extension source, popup, content scripts, background worker
shared/     Shared types, API contracts, template manifest, lookup helpers
landing/    Next.js landing page
scripts/    Root release, launch, and smoke-check scripts
```

## Local Setup

Install dependencies:

```sh
npm install
```

Create the backend env file:

```sh
cp .env.example backend/.env
```

For a no-cost local setup, set `OPENROUTER_API_KEY=` or leave it unset. If you want model-backed captions, set:

```sh
OPENROUTER_API_KEY=sk-or-your-key
```

Start Postgres with pgvector:

```sh
npm run db:up
```

Initialize the database:

```sh
npm run db:init
```

Seed the meme catalog and local meme image files:

```sh
npm run db:seed-memes --workspace=backend
```

This downloads seed meme images into `backend/data/memes/` and inserts catalog rows into the local database. The generated image files are intentionally ignored by git.

## Run The App Locally

Start the backend API:

```sh
npm run dev:backend
```

The API runs at:

```text
http://localhost:3001
```

In another terminal, build the extension in watch mode:

```sh
npm run dev:extension
```

Load the extension in Chrome:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click "Load unpacked".
4. Select `extension/dist`.
5. Open `https://x.com` or `https://twitter.com`.

The extension defaults to `http://localhost:3001` for API calls. If you need a different API origin, run the extension build with `VITE_API_BASE_URL` set.

For example, create `extension/.env.local`:

```sh
VITE_API_BASE_URL=http://localhost:3001
```

## Landing Page

The landing page is separate from the local extension/backend workflow.

Run it locally:

```sh
npm run dev:landing
```

Build it:

```sh
npm run build:landing
```

For Vercel, deploy the `landing` workspace as the app. The extension and backend do not need to be hosted for the open-source local workflow.

## Useful Commands

```sh
npm run typecheck
npm test
npm run build:backend
npm run build:extension
npm run db:studio
npm run db:down
```

Backend-only:

```sh
npm run typecheck --workspace=backend
npm run test --workspace=backend
npm run manifest:audit --workspace=backend
npm run eval:quality --workspace=backend
```

Extension-only:

```sh
npm run typecheck --workspace=extension
npm run test --workspace=extension
npm run build --workspace=extension
```

## Environment Notes

Important backend env vars live in `backend/.env`:

```text
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/memedrop
MEME_STORAGE_PATH=./data/memes
MEMEDROP_REQUIRE_INSTALL_ID=false
MEMEDROP_RATE_LIMIT_STORE=memory
```

Extension env vars live in `extension/.env.local` if you need to override defaults:

```text
VITE_API_BASE_URL=http://localhost:3001
```

Use `MEMEDROP_RATE_LIMIT_STORE=memory` for local development. Database-backed rate limiting is mainly for hosted production-style deployments.

## Troubleshooting

If the backend cannot connect to the database:

```sh
npm run db:up
npm run db:init
```

If suggestions return no memes, seed the catalog:

```sh
npm run db:seed-memes --workspace=backend
```

If Chrome does not show extension changes, rebuild or keep watch mode running, then click reload on the extension card in `chrome://extensions`.

If meme images are broken, check that `backend/data/memes/` contains seeded files and that the backend is running on `http://localhost:3001`.

## Notes For Contributors

- Keep local generated files out of git: `.memedrop/`, `dist/`, `backend/data/memes/*`, `.env`, and `*.tsbuildinfo` are ignored.
- Use strict TypeScript and ES modules.
- Keep local imports explicit with `.js` extensions where TypeScript emits ESM.
- Prefer simple, readable code over broad abstractions.
- Run typechecks and relevant tests before opening a PR.

## License

No license has been added yet. Add one before treating this as a reusable open-source package.
