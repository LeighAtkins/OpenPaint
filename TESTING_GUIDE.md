# Testing Guide

## Quick Commands

```bash
npm test                # Run all tests (Vitest)
npm run test:watch      # Watch mode
npm run test:coverage   # Coverage report
npm run test:visual     # Visual regression tests
npm run validate        # type-check + lint + test (full CI check)
```

## Test Structure

```
tests/
  unit/           # Pure logic tests (coordinate transforms, parsing, etc.)
  integration/    # Multi-module workflow tests
  visual/         # Screenshot-based regression tests (Playwright + pixelmatch)
  fixtures/       # Test data
  helpers/        # Test utilities and setup

src/__tests__/    # Tests co-located with TypeScript source
```

## Running Tests Locally

```bash
# All tests
npm test

# Specific test file
npx vitest run tests/unit/measurement-parsing.test.js

# Watch a specific file
npx vitest tests/unit/coordinate-transforms.test.js
```

## AI Worker Testing

### Local Development (Mock Mode)

The frontend auto-detects localhost and uses a built-in mock worker. No API keys needed.

1. Start server: `npm start`
2. Open http://localhost:3000
3. Upload an image, draw a stroke, click "AI SVG Export"
4. Console should show: `[AI Export] Using mock worker`

### Worker Health Check

```bash
curl https://<your-worker-url>/health
# Expected: {"status":"ok","version":"1.0.0","timestamp":"..."}
```

### Worker Auth Rejection (no key = 401)

```bash
curl -X POST https://<your-worker-url>/generate-svg \
  -H "Content-Type: application/json" \
  -d '{"image":{"width":800,"height":600},"strokes":[]}'
# Expected: {"error":"Unauthorized"} (401)
```

### Worker Direct Call (with key)

```bash
curl -X POST https://<your-worker-url>/generate-svg \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $AI_WORKER_KEY" \
  -d '{
    "image": {"width": 800, "height": 600},
    "units": {"name": "cm", "pxPerUnit": 37.8},
    "strokes": [{"id":"A1","type":"straight","points":[{"x":0,"y":0},{"x":100,"y":0}],"color":"#000","width":2}]
  }'
```

## Monitoring

```bash
# Worker logs (real-time)
cd worker && wrangler tail --name openpaint-ai-worker

# Vercel logs
vercel logs --follow
```

## Performance Benchmarks

| Metric | Target | Acceptable |
|---|---|---|
| Worker Response | < 1s | < 2s |
| Express Relay | < 100ms | < 200ms |
| Frontend Processing | < 500ms | < 1s |
| Total User Wait | < 2s | < 3s |
| SVG File Size | < 50KB | < 100KB |
