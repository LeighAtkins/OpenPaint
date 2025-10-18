# Cloudflare AI Worker Deployment Checklist

## Pre-Deployment Setup

### 1. Environment Variables

#### Backend (.env or Vercel Environment Variables)
```env
AI_WORKER_URL=https://openpaint-ai-worker.sofapaint-api.workers.dev
AI_WORKER_KEY=your-secret-key-here
```

**Set in Vercel:**
```bash
vercel env add AI_WORKER_URL production
# Enter: https://openpaint-ai-worker.sofapaint-api.workers.dev

vercel env add AI_WORKER_KEY production
# Enter: your-secret-key-here
```

#### Worker (Cloudflare)
```bash
cd worker
wrangler secret put AI_WORKER_KEY
# Enter: your-secret-key-here (must match backend)
```

### 2. Update wrangler.toml

Edit `worker/wrangler.toml`:
```toml
name = "openpaint-ai-worker"
main = "src/index.js"
compatibility_date = "2024-01-01"

[vars]
ENVIRONMENT = "production"

# Optional: Restrict CORS to your domain
# Add this to src/index.js corsHeaders():
# 'Access-Control-Allow-Origin': 'https://sofapaint-owk3k678t-leigh-atkins-projects.vercel.app'
```

## Deployment Steps

### Step 1: Deploy Cloudflare Worker

```bash
cd worker
npm install
npm run deploy
```

**Expected output:**
```
✨ Successfully published your script to
   https://openpaint-ai-worker.sofapaint-api.workers.dev
```

**Copy the Worker URL** - you'll need it for backend environment variables.

### Step 2: Test Worker Health

```bash
curl https://openpaint-ai-worker.sofapaint-api.workers.dev/health
```

**Expected response:**
```json
{
  "status": "ok",
  "version": "1.0.0",
  "timestamp": "2025-10-18T..."
}
```

### Step 3: Test Worker Auth

```bash
# Should fail without key
curl -X POST https://openpaint-ai-worker.sofapaint-api.workers.dev/generate-svg \
  -H "Content-Type: application/json" \
  -d '{"image":{"width":800,"height":600},"strokes":[]}'
```

**Expected response:**
```json
{"error":"Unauthorized"}
```

```bash
# Should succeed with key
curl -X POST https://openpaint-ai-worker.sofapaint-api.workers.dev/generate-svg \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key-here" \
  -d '{"image":{"width":800,"height":600},"strokes":[{"id":"t1","type":"straight","points":[{"x":0,"y":0},{"x":100,"y":0}],"color":"#000","width":2}]}'
```

**Expected response:**
```json
{
  "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 800 600\"...",
  "vectors": [...],
  "summary": {...}
}
```

### Step 4: Update Backend Environment

Set environment variables in Vercel (or local .env):

```bash
# If using Vercel CLI
vercel env add AI_WORKER_URL production
vercel env add AI_WORKER_KEY production

# Or via Vercel Dashboard:
# Settings → Environment Variables → Add
```

### Step 5: Deploy Backend

```bash
# If using Vercel
vercel --prod

# Or push to main branch (if auto-deploy is enabled)
git push origin main
```

### Step 6: Test Express Relay

```bash
curl -X POST https://sofapaint-owk3k678t-leigh-atkins-projects.vercel.app/ai/generate-svg \
  -H "Content-Type: application/json" \
  -d '{"image":{"width":800,"height":600},"strokes":[{"id":"t1","type":"straight","points":[{"x":0,"y":0},{"x":100,"y":0}],"color":"#000","width":2}]}'
```

**Expected:** Same SVG response as direct Worker call (relay adds auth automatically).

### Step 7: Test Frontend

1. Open OpenPaint: https://sofapaint-owk3k678t-leigh-atkins-projects.vercel.app
2. Upload an image
3. Draw at least one stroke
4. Click "AI SVG Export" button (purple)
5. Wait for preview modal
6. Verify SVG displays correctly
7. Test download buttons

## Verification Checklist

- [ ] Worker deployed successfully
- [ ] Worker health endpoint responds
- [ ] Worker auth rejects requests without key
- [ ] Worker auth accepts requests with correct key
- [ ] Worker generates valid SVG for test input
- [ ] Backend environment variables set
- [ ] Backend deployed successfully
- [ ] Express relay forwards requests to Worker
- [ ] Express relay adds auth header automatically
- [ ] Frontend calls relay (not Worker directly)
- [ ] Frontend mock mode works locally
- [ ] Frontend production mode works on Vercel
- [ ] Preview modal displays SVG
- [ ] Download SVG button works
- [ ] Download PNG button works
- [ ] Save to Project button works
- [ ] Project save/load includes AI exports

## Monitoring

### Worker Logs
```bash
cd worker
wrangler tail --name openpaint-ai-worker
```

**Watch for:**
- Request counts
- Error messages
- Processing times
- Auth failures

### Vercel Logs
```bash
vercel logs sofapaint-owk3k678t-leigh-atkins-projects.vercel.app --follow
```

**Watch for:**
- `[AI Worker] Relaying generate-svg request`
- `[AI Worker] Success: X vectors generated`
- `[AI Worker] generate-svg error`

### Browser Console
Open DevTools → Console

**Watch for:**
- `[AI Export] Starting export for image:`
- `[AI Export] Payload created:`
- `[AI Export] Using mock worker` (local only)
- `[AI Export] Calling production worker` (Vercel only)
- `[AI Export] Success:`

## Troubleshooting

### "Unauthorized" Error

**Symptom:** Worker returns 401
**Causes:**
- API key mismatch between backend and Worker
- API key not set in Worker secrets
- API key not set in backend environment

**Fix:**
```bash
# Verify Worker secret
cd worker
wrangler secret list

# Re-set if needed
wrangler secret put AI_WORKER_KEY

# Verify backend env
vercel env ls
```

### "No strokes to export" Error

**Symptom:** Frontend shows error before calling API
**Causes:**
- No strokes drawn on current image
- Current image label not set
- Stroke data not in vectorStrokesByImage

**Fix:**
1. Check browser console: `window.currentImageLabel`
2. Check stroke data: `window.vectorStrokesByImage[window.currentImageLabel]`
3. Draw a stroke and try again

### Timeout Error

**Symptom:** "Worker took too long" or AbortError
**Causes:**
- Worker processing time > 2 seconds
- Network latency
- Complex stroke data

**Fix:**
1. Increase timeout in `app.js` (line ~443):
   ```javascript
   const timeout = setTimeout(() => controller.abort(), 5000); // 5 seconds
   ```
2. Simplify stroke data (fewer points)
3. Check Worker logs for slow operations

### CORS Error

**Symptom:** Browser console shows CORS error
**Causes:**
- Worker not returning CORS headers
- Origin not allowed

**Fix:**
1. Verify Worker CORS headers in `worker/src/index.js`
2. If restricting origins, update `corsHeaders()`:
   ```javascript
   function corsHeaders(origin = 'https://sofapaint-owk3k678t-leigh-atkins-projects.vercel.app') {
   ```

### Mock Mode in Production

**Symptom:** Frontend uses mock even on Vercel
**Causes:**
- Hostname check failing
- `USE_MOCK` logic incorrect

**Fix:**
Check `js/ai-export.js` line 11:
```javascript
const USE_MOCK = !window.location.hostname.includes('vercel.app') && !window.location.hostname.includes('workers.dev');
```

Add debug logging:
```javascript
console.log('[AI Export] Hostname:', window.location.hostname, 'USE_MOCK:', USE_MOCK);
```

## Rollback Plan

If deployment fails:

### Rollback Worker
```bash
cd worker
wrangler rollback
```

### Rollback Backend
```bash
# Via Vercel Dashboard:
# Deployments → Previous deployment → Promote to Production

# Or via CLI:
vercel rollback
```

### Disable AI Export
Comment out button in `index.html`:
```html
<!-- <button id="exportAISVG" ...>AI SVG Export</button> -->
```

## Performance Targets

- **Worker Response Time**: < 2 seconds for typical projects
- **Express Relay Overhead**: < 100ms
- **Frontend Processing**: < 500ms
- **Total User Wait**: < 3 seconds from click to preview

## Security Notes

- ✅ API key never exposed to frontend
- ✅ Rate limiting on Express relay (10 req/min per IP)
- ✅ Worker validates all inputs
- ✅ SVG sanitization prevents XSS
- ✅ CORS restricts origins (if configured)

## Optional: Restrict CORS

For production security, update Worker CORS:

**worker/src/index.js:**
```javascript
function corsHeaders(origin = 'https://sofapaint-owk3k678t-leigh-atkins-projects.vercel.app') {
    return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, X-Request-ID'
    };
}
```

Redeploy Worker after change.

## Success Criteria

✅ All checklist items completed
✅ Worker health check passes
✅ Worker auth works correctly
✅ Express relay forwards requests
✅ Frontend generates SVG successfully
✅ Preview modal displays correctly
✅ Downloads work (SVG and PNG)
✅ Project save/load includes AI exports
✅ No errors in Worker logs
✅ No errors in Vercel logs
✅ No errors in browser console

---

**Deployment Date**: _____________
**Deployed By**: _____________
**Worker URL**: https://openpaint-ai-worker.sofapaint-api.workers.dev
**Backend URL**: https://sofapaint-owk3k678t-leigh-atkins-projects.vercel.app
**Status**: ⬜ Not Started | ⬜ In Progress | ⬜ Complete | ⬜ Failed

