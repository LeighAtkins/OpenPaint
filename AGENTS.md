# Repository Guidelines

## Project Structure & Module Organization
- `app.js` hosts the Express server and routes API relays for AI features.
- `index.html` is the main entry for the legacy client; static assets live in `public/` and `css/`/`js/` (legacy scripts).
- `src/` contains the newer TypeScript/Vite codebase (services, modules, types, styles).
- `tests/` holds unit, integration, e2e, performance, and visual suites; see `tests/README.md` for details.
- `worker/` contains the Cloudflare Worker for AI SVG generation; `supabase/` and `server/` hold backend-related tooling.
- Build artifacts land in `dist/`; uploads and runtime files go to `uploads/`.

## Build, Test, and Development Commands
- `npm start` runs the Express server at `http://localhost:3000`.
- `npm run dev` starts the Vite dev server (frontend hot reload).
- `npm run build` builds TypeScript + Vite output into `dist/`.
- `npm run lint` / `npm run format` run ESLint and Prettier on `src/`.
- `bun test` runs Vitest; use `bun run test:watch` for watch mode and `bun run test:coverage` for coverage.

## Coding Style & Naming Conventions
- Indentation is 2 spaces in JS/TS files (match existing formatting).
- TypeScript is preferred in `src/`; legacy JS lives in `public/js` and root `js/`.
- Lint/format tooling: ESLint (TS rules) and Prettier for `src/**/*.{ts,tsx,json}`.
- File naming: `kebab-case` for test files (e.g., `stroke-management.test.js`), `camelCase` for JS modules, and `PascalCase` for classes.

## Testing Guidelines
- All tests run under Vitest (see `src/__tests__/` and `tests/`).
- Naming: `*.test.js` or `*.test.ts` under `tests/` or `src/__tests__/`.
- Run suites with `npm run test:unit`, `npm run test:integration`, `npm run test:e2e`, or `npm run test:coverage`.

## Commit & Pull Request Guidelines
- Recent history mixes short imperative summaries and Conventional Commits (`feat:`, `fix:`, `refactor:`, `chore:`, `debug:`). Follow that pattern and keep subjects concise.
- PRs should describe the change, link related issues (if any), and include screenshots or GIFs for UI changes.
- Call out test coverage or skipped tests in the PR description.

## Security & Configuration Tips
- AI features require Cloudflare and worker secrets (see `README.md` for `CF_*` and `AI_WORKER_*` vars).
- Avoid committing real credentials; use `.env` or deployment secrets.
