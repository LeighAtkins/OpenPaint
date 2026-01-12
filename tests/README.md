# OpenPaint Test Suite

Vitest-based tests for the OpenPaint drawing and measurement workflows.

## Test Structure
```
tests/
├── unit/                 # Unit tests for core functions
├── integration/          # Integration tests for workflows
├── helpers/              # Test utilities and setup
└── fixtures/             # Test data and sample files
```

## Running Tests (Vitest)

```bash
# Run all tests
bun test

# Watch mode
bun run test:watch

# UI runner
bun run test:ui

# Coverage report
bun run test:coverage
```

## Notes
- Vitest uses `jsdom` for DOM APIs and loads `tests/helpers/setup.js` for mocks.
- TypeScript tests live under `src/__tests__/`.
- If a test needs browser-only APIs, add explicit mocks in `tests/helpers/setup.js`.
