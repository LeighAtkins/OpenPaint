# AI Worker Testing Guide

Quick reference for testing the Cloudflare AI Worker integration and the Vitest suite.

## Quick Test Commands

### 1) Test Worker Health (No Auth Required)
```bash
curl https://openpaint-ai-worker.sofapaint-api.workers.dev/health
```
Expected: `{"status":"ok","version":"1.0.0","timestamp":"..."}`

### 2) Test Worker Auth Rejection
```bash
curl -X POST https://openpaint-ai-worker.sofapaint-api.workers.dev/generate-svg \
  -H "Content-Type: application/json" \
  -d '{"image":{"width":800,"height":600},"strokes":[]}'
```
Expected: `{"error":"Unauthorized"}` (401)

### 3) Test Worker Direct (With Auth)
```bash
curl -X POST https://openpaint-ai-worker.sofapaint-api.workers.dev/generate-svg \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_SECRET_KEY" \
  -d '{
    "image": {"width": 800, "height": 600},
    "units": {"name": "cm", "pxPerUnit": 37.8},
    "strokes": [{
      "id": "A1",
      "type": "straight",
      "points": [{"x": 0, "y": 0}, {"x": 100, "y": 0}],
      "color": "#000000",
      "width": 2
    }]
  }'
```
Expected: Valid SVG with vectors and summary

### 4) Test Express Relay
```bash
curl -X POST https://sofapaint-owk3k678t-leigh-atkins-projects.vercel.app/ai/generate-svg \
  -H "Content-Type: application/json" \
  -d '{
    "image": {"width": 800, "height": 600},
    "units": {"name": "cm", "pxPerUnit": 37.8},
    "strokes": [{
      "id": "A1",
      "type": "straight",
      "points": [{"x": 0, "y": 0}, {"x": 100, "y": 0}],
      "color": "#000000",
      "width": 2
    }]
  }'
```
Expected: Same SVG response (relay adds auth automatically)

### 5) Test Assist Measurement
```bash
curl -X POST https://sofapaint-owk3k678t-leigh-atkins-projects.vercel.app/ai/assist-measurement \
  -H "Content-Type: application/json" \
  -d '{
    "units": {"name": "cm", "pxPerUnit": 37.8},
    "stroke": {
      "id": "A1",
      "type": "straight",
      "points": [{"x": 0, "y": 0}, {"x": 378, "y": 0}],
      "color": "#000",
      "width": 2
    }
  }'
```
Expected: `{"value":10,"formatted":"10.00 cm","labelPos":{...}}`

## Frontend Testing

### Local Development (Mock Mode)
1) Start server: `npm start`
2) Open: http://localhost:3000
3) Upload an image, draw a stroke, click "AI SVG Export"
4) Expect console log: `[AI Export] Using mock worker`

### Production (Worker Mode)
1) Open: https://sofapaint-owk3k678t-leigh-atkins-projects.vercel.app
2) Draw and export; expect `[AI Export] Calling production worker`

## Unit/Integration Tests (Vitest)

```bash
# Run all tests
bun test

# Watch mode
bun run test:watch

# Coverage report
bun run test:coverage
```

Tests live in `src/__tests__/` and `tests/`.

## Monitoring Commands

### Watch Worker Logs
```bash
cd worker
wrangler tail --name openpaint-ai-worker
```

### Watch Vercel Logs
```bash
vercel logs --follow
```

## Performance Benchmarks

| Metric | Target | Acceptable | Poor |
|--------|--------|------------|------|
| Worker Response | < 1s | < 2s | > 2s |
| Express Relay | < 100ms | < 200ms | > 200ms |
| Frontend Processing | < 500ms | < 1s | > 1s |
| Total User Wait | < 2s | < 3s | > 3s |
| SVG File Size | < 50KB | < 100KB | > 100KB |

## Common Issues and Fixes

### Issue: "No strokes to export"
Draw at least one stroke before exporting.

### Issue: "Unauthorized"
Verify Worker secret and Vercel environment variables match.

### Issue: Timeout
Check worker logs and simplify stroke data.

### Issue: Mock Mode in Production
Verify hostname detection logic in the frontend.

---
**Last Updated**: October 18, 2025
