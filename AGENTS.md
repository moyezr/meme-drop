# Repository Guidelines

## Project Structure & Module Organization

This is an npm workspace TypeScript project with three packages:

- `backend/`: Fastify API, Drizzle database setup, service logic, routes, and scripts. Key paths include `backend/src/routes`, `backend/src/services`, `backend/src/db`, and `backend/scripts`.
- `extension/`: Chrome extension built with React, Vite, Tailwind, and CRXJS. Popup code lives in `extension/src/popup`, content scripts in `extension/src/content`, and background logic in `extension/src/background`.
- `shared/`: Shared types, API contracts, template manifest data, and lookup helpers used by both backend and extension.

Root files include `docker-compose.yml` for local infrastructure, `tsconfig.base.json` for shared TypeScript settings, and `.env.example` for configuration reference.

## Build, Test, and Development Commands

- `npm run dev:backend`: run the backend with `tsx watch` on port `3001` by default.
- `npm run dev:extension`: build the extension continuously with Vite watch mode.
- `npm run build:extension`: typecheck and build the extension.
- `npm run db:up` / `npm run db:down`: start or stop local Docker services.
- `npm run db:init`: initialize backend database setup, push Drizzle schema, and seed data.
- `npm run db:studio`: open Drizzle Studio.
- `npm run typecheck --workspace=backend|extension|shared`: run package TypeScript checks.

## Coding Style & Naming Conventions

Use strict TypeScript and ES modules. Keep imports explicit, including `.js` extensions for local TypeScript imports that compile to ESM. Follow existing two-space indentation, double quotes, and semicolon style. Use `camelCase` for variables/functions, `PascalCase` for React components and exported types, and kebab-case for route-like filenames such as `meme-text.ts`.

## Testing Guidelines

No formal unit test framework is currently configured. Before submitting changes, run relevant typechecks and builds. For backend API work, run the backend locally and verify affected endpoints manually. Add future tests near the code they cover using `*.test.ts` or `*.spec.ts`, and document any new test command in the relevant `package.json`.

## Commit & Pull Request Guidelines

Recent commits use short, informal summaries such as `working: text overlay` and `improved meme templates`. Prefer concise, imperative messages that state the change, for example `add meme usage endpoint`. Pull requests should include a short description, validation steps, linked issue if applicable, and screenshots or extension recordings for UI changes.

## Security & Configuration Tips

Keep secrets in `.env` files and never hard-code API keys in scripts or source. Treat `backend/.env`, root `.env`, generated meme assets, and local database state as environment-specific. Update `.env.example` when adding required configuration.
