# Quick Deployment Guide

## Prerequisites

1. **Cloudflare Account**: Sign up at https://dash.cloudflare.com
2. **Wrangler CLI**: Install globally
   ```bash
   npm install -g wrangler
   ```
3. **Login to Cloudflare**:
   ```bash
   wrangler login
   ```

## Deployment Steps

### 1. Set API Key Secret

```bash
cd worker
wrangler secret put AI_WORKER_KEY
```

When prompted, enter your secret key (e.g., `your-secret-key-here`).

**Important:** This key must match the `AI_WORKER_KEY` in your backend environment variables.

### 2. Deploy Worker

```bash
npx wrangler deploy
```

**Expected output:**
```
✨ Successfully published your script to
   https://openpaint-ai-worker.sofapaint-api.workers.dev
```

### 3. Test Health Endpoint (No Auth Required)

```bash
curl https://openpaint-ai-worker.sofapaint-api.workers.dev/health
```

**Expected response:**
```json
{"status":"ok","version":"1.0.0"}
```

### 4. Test Auth Rejection

```bash
curl -X POST https://openpaint-ai-worker.sofapaint-api.workers.dev/generate-svg \
  -H "Content-Type: application/json" \
  -d '{"image":{"width":800,"height":600},"strokes":[]}'
```

**Expected response:**
```json
{"error":"Unauthorized"}
```

### 5. Test With Correct API Key

```bash
curl -X POST https://openpaint-ai-worker.sofapaint-api.workers.dev/generate-svg \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key-here" \
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

**Expected:** Valid SVG response with vectors and summary.

### 6. Update Backend Environment

Set these in your Vercel project:

```bash
vercel env add AI_WORKER_URL production
# Enter: https://openpaint-ai-worker.sofapaint-api.workers.dev

vercel env add AI_WORKER_KEY production
# Enter: your-secret-key-here (same as Worker secret)
```

Or via Vercel Dashboard:
- Go to your project settings
- Navigate to Environment Variables
- Add `AI_WORKER_URL` and `AI_WORKER_KEY`

### 7. Deploy Backend

```bash
vercel --prod
```

Or push to main branch if auto-deploy is enabled.

## Monitoring

### View Worker Logs

```bash
wrangler tail --name openpaint-ai-worker
```

### View Recent Deployments

```bash
wrangler deployments list
```

### Rollback if Needed

```bash
wrangler rollback
```

## Configuration Options

### Restrict CORS to Your Domain

Edit `src/index.js` line 14:

```javascript
function cors(origin = 'https://sofapaint-owk3k678t-leigh-atkins-projects.vercel.app') {
```

Then redeploy:
```bash
npx wrangler deploy
```

### Update Worker Name

Edit `wrangler.toml`:
```toml
name = "your-custom-name"
```

## Troubleshooting

### "Unauthorized" Error
- Check Worker secret: `wrangler secret list`
- Verify backend env matches Worker secret
- Re-set secret: `wrangler secret put AI_WORKER_KEY`

### "Not Found" Error
- Verify Worker URL is correct
- Check deployment status: `wrangler deployments list`
- Ensure Worker is published (not just in draft)

### CORS Error
- Check browser console for specific error
- Verify `cors()` function in `src/index.js`
- Test with curl to isolate frontend vs backend issue

### Timeout Error
- Check Worker logs: `wrangler tail`
- Verify Worker is processing requests
- Check for errors in Worker code

## Success Checklist

- [x] Worker deployed successfully
- [x] Health endpoint responds without auth
- [x] Auth rejects requests without key
- [x] Auth accepts requests with correct key
- [x] Backend environment variables set
- [x] Backend deployed
- [x] Frontend can call relay
- [x] Preview modal displays SVG

## Next Steps

After successful deployment:

1. Test full flow in production
2. Monitor Worker logs for errors
3. Check Vercel logs for relay errors
4. Test with real project data
5. Verify project save/load includes AI exports

---

**Worker URL**: https://openpaint-ai-worker.sofapaint-api.workers.dev
**Backend URL**: https://sofapaint-owk3k678t-leigh-atkins-projects.vercel.app
**Deployment Date**: _____________

