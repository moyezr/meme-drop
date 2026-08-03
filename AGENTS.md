# Repository Guidelines

## Project Structure & Module Organization

This is a Python and npm monorepo:

- `apps/api/`: FastAPI runtime, SQLAlchemy persistence, Alembic migrations, services, and pytest suite.
- `apps/extension/`: Chrome extension built with React, Vite, Tailwind, and CRXJS. Popup code lives in `apps/extension/src/popup`, content scripts in `apps/extension/src/content`, and background logic in `apps/extension/src/background`.
- `packages/shared/`: Shared types, API contracts, source template data, and lookup helpers.
- `tools/template-tools/`: Offline TypeScript catalog QA, benchmark, and promotion tooling.
- `apps/api/src/memedrop_api/data/`: Generated language-neutral catalog consumed by FastAPI.

Root files include `docker-compose.yml` for local infrastructure, `tsconfig.base.json` for shared TypeScript settings, and `.env.example` for configuration reference.

## Build, Test, and Development Commands

- `npm run dev:backend`: run FastAPI with Uvicorn on port `3001` by default.
- `npm run dev:extension`: build the extension continuously with Vite watch mode.
- `npm run build:extension`: typecheck and build the extension.
- `npm run db:up` / `npm run db:down`: start or stop local Docker services.
- `npm run db:init`: apply Alembic migrations and seed the development identity.
- `npm run db:seed-memes`: download and insert missing verified catalog memes.
- `npm run typecheck`: run Turbo-orchestrated Python and TypeScript checks.

## Coding Style & Naming Conventions

Use typed Python with Ruff and mypy in `apps/api`. Use strict TypeScript and ES modules elsewhere. Follow existing two-space TypeScript indentation, double quotes, and semicolon style.

## Testing Guidelines

FastAPI uses pytest with unit, HTTP, benchmark, and PostgreSQL integration coverage. Run `npm run test:api`, mypy, and Ruff for API changes; use `MEMEDROP_TEST_DATABASE_URL` for the integration suite. TypeScript tools and clients retain Node test suites.

## Commit & Pull Request Guidelines

Recent commits use short, informal summaries such as `working: text overlay` and `improved meme templates`. Prefer concise, imperative messages that state the change, for example `add meme usage endpoint`. Pull requests should include a short description, validation steps, linked issue if applicable, and screenshots or extension recordings for UI changes.

## Security & Configuration Tips

Keep secrets in `.env` files and never hard-code API keys. Treat root/app `.env` files, `apps/api/data/memes`, generated assets, and local database state as environment-specific. Update `.env.example` when adding required configuration.
