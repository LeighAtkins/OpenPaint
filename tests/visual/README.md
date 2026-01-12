# Visual Tests

This folder contains Vitest visual regression tests powered by Playwright.

## How it works

- Tests open the running app in a headless browser.
- The first run creates a baseline image in `tests/visual/__snapshots__/`.
- Subsequent runs compare pixels and write diffs to `tests/visual/__diff__/`.
- A negative test intentionally injects a mismatch to confirm diff detection is working.

## Prerequisites

- Start the app locally before running visual tests.
- Default URL is `http://localhost:3000` (override with `VISUAL_BASE_URL`).

## Commands

```bash
# Start the app (choose one)
npm start
# or
bun run dev

# Run visual tests
bun run test:visual
```

If you want to regenerate the baseline, delete:

- `tests/visual/__snapshots__/app-baseline.png`
