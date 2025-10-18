# AI Worker Testing Guide

Quick reference for testing the Cloudflare AI Worker integration.

## Quick Test Commands

### 1. Test Worker Health (No Auth Required)
```bash
curl https://openpaint-ai-worker.sofapaint-api.workers.dev/health
```
✅ **Expected:** `{"status":"ok","version":"1.0.0","timestamp":"..."}`

### 2. Test Worker Auth Rejection
```bash
curl -X POST https://openpaint-ai-worker.sofapaint-api.workers.dev/generate-svg \
  -H "Content-Type: application/json" \
  -d '{"image":{"width":800,"height":600},"strokes":[]}'
```
✅ **Expected:** `{"error":"Unauthorized"}` (401)

### 3. Test Worker Direct (With Auth)
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
✅ **Expected:** Valid SVG with vectors and summary

### 4. Test Express Relay
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
✅ **Expected:** Same SVG response (relay adds auth automatically)

### 5. Test Assist Measurement
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
✅ **Expected:** `{"value":10,"formatted":"10.00 cm","labelPos":{...},...}`

## Frontend Testing

### Local Development (Mock Mode)

1. **Start server:**
   ```bash
   npm start
   ```

2. **Open:** http://localhost:3000

3. **Test:**
   - Upload an image
   - Draw a stroke
   - Click "AI SVG Export"
   - Should see: `[AI Export] Using mock worker`
   - Preview modal should appear with SVG

### Production (Worker Mode)

1. **Open:** https://sofapaint-owk3k678t-leigh-atkins-projects.vercel.app

2. **Test:**
   - Upload an image
   - Draw a stroke
   - Click "AI SVG Export"
   - Should see: `[AI Export] Calling production worker`
   - Preview modal should appear with SVG

### Browser Console Checks

Open DevTools → Console and look for:

**Successful Flow:**
```
[AI Export] Starting export for image: front
[AI Export] Payload created: {strokes: 3, dimensions: "800x600", units: "cm"}
[AI Export] Calling production worker
[AI Export] Success: {svgLength: 1234, vectorCount: 3, measurements: 2}
```

**Error Flow:**
```
[AI Export] Starting export for image: front
[AI Export] Failed: Error: No strokes to export
```

## Unit Tests

Run Jest tests:
```bash
npm test
```

**Expected output:**
```
PASS  tests/unit/coordinate-validation.test.js
PASS  tests/unit/ai-svg-generation.test.js

Test Suites: 2 passed, 2 total
Tests:       12 passed, 12 total
```

## Integration Testing Scenarios

### Scenario 1: Simple Straight Line
1. Draw a straight line
2. Click "AI SVG Export"
3. Verify SVG contains `<line>` element
4. Verify measurement label appears
5. Download SVG and open in browser
6. Verify line renders correctly

### Scenario 2: Multiple Strokes
1. Draw 3 different strokes (straight, freehand, arrow)
2. Click "AI SVG Export"
3. Verify SVG contains all 3 strokes
4. Verify arrow has marker
5. Verify measurements for straight line
6. Download PNG and verify composite

### Scenario 3: Complex Freehand
1. Draw a long freehand path (100+ points)
2. Click "AI SVG Export"
3. Verify path is simplified (fewer points)
4. Verify path still looks correct
5. Check processing time < 2 seconds

### Scenario 4: Save and Load
1. Draw strokes
2. Generate AI SVG
3. Click "Save to Project"
4. Save project as ZIP
5. Load project
6. Verify AI export is restored
7. Re-open preview modal
8. Verify SVG is still there

### Scenario 5: Error Handling
1. Don't draw any strokes
2. Click "AI SVG Export"
3. Should see error: "No strokes to export"
4. Draw a stroke
5. Disconnect network (DevTools → Network → Offline)
6. Click "AI SVG Export"
7. Should see timeout error
8. Should suggest manual export

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

### Watch Browser Network
1. Open DevTools → Network
2. Filter: `ai`
3. Click "AI SVG Export"
4. Look for:
   - POST to `/ai/generate-svg`
   - Status: 200
   - Response time < 3 seconds
   - Response body contains SVG

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
**Debug:**
```javascript
// In browser console
console.log('Current image:', window.currentImageLabel);
console.log('Strokes:', window.vectorStrokesByImage[window.currentImageLabel]);
```
**Fix:** Draw at least one stroke before exporting

### Issue: "Unauthorized"
**Debug:**
```bash
# Check Worker secret
cd worker
wrangler secret list

# Check backend env
vercel env ls
```
**Fix:** Ensure API keys match

### Issue: Timeout
**Debug:**
```bash
# Check Worker logs
wrangler tail --name openpaint-ai-worker
```
**Fix:** 
- Increase timeout in app.js
- Simplify stroke data
- Check Worker performance

### Issue: CORS Error
**Debug:** Check browser console for CORS error
**Fix:** Verify Worker CORS headers in src/index.js

### Issue: Mock Mode in Production
**Debug:**
```javascript
// In browser console
console.log('Hostname:', window.location.hostname);
console.log('USE_MOCK:', !window.location.hostname.includes('vercel.app'));
```
**Fix:** Check hostname detection logic in ai-export.js

## Test Data

### Minimal Test Stroke
```json
{
  "id": "A1",
  "type": "straight",
  "points": [{"x": 0, "y": 0}, {"x": 100, "y": 0}],
  "color": "#000000",
  "width": 2
}
```

### Complex Test Stroke
```json
{
  "id": "B1",
  "type": "curved-arrow",
  "points": [
    {"x": 0, "y": 0},
    {"x": 50, "y": 50},
    {"x": 100, "y": 25},
    {"x": 150, "y": 75}
  ],
  "color": "#3b82f6",
  "width": 3,
  "arrowSettings": {
    "startArrow": false,
    "endArrow": true,
    "arrowSize": 15
  }
}
```

### Full Test Payload
```json
{
  "image": {
    "width": 800,
    "height": 600,
    "rotation": 0
  },
  "units": {
    "name": "cm",
    "pxPerUnit": 37.8
  },
  "strokes": [
    {
      "id": "A1",
      "type": "straight",
      "points": [{"x": 100, "y": 100}, {"x": 300, "y": 100}],
      "color": "#000000",
      "width": 2
    },
    {
      "id": "A2",
      "type": "arrow",
      "points": [{"x": 100, "y": 200}, {"x": 300, "y": 200}],
      "color": "#0B84F3",
      "width": 3,
      "arrowSettings": {"endArrow": true}
    },
    {
      "id": "A3",
      "type": "freehand",
      "points": [
        {"x": 100, "y": 300},
        {"x": 150, "y": 320},
        {"x": 200, "y": 310},
        {"x": 250, "y": 330},
        {"x": 300, "y": 300}
      ],
      "color": "#F39C12",
      "width": 2
    }
  ]
}
```

## Success Indicators

✅ **Worker deployed and accessible**
✅ **Health endpoint responds**
✅ **Auth works correctly**
✅ **Express relay forwards requests**
✅ **Frontend calls relay (not Worker directly)**
✅ **Mock mode works locally**
✅ **Production mode works on Vercel**
✅ **SVG generation succeeds**
✅ **Preview modal displays**
✅ **Downloads work (SVG and PNG)**
✅ **Project save/load works**
✅ **No console errors**
✅ **Performance within targets**

---

**Last Updated**: October 18, 2025
**Version**: 1.0.0

