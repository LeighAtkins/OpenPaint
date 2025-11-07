# Worker Reactivation Summary

## What Was Done

I've prepared everything you need to reactivate the Cloudflare workers for REMBG and AI SVG functionality.

### Files Created

1. **WORKER_DEPLOYMENT_GUIDE.md** - Comprehensive deployment guide with troubleshooting
2. **QUICK_START_WORKERS.md** - Quick reference for fast deployment
3. **deploy-workers.sh** - Automated deployment script

### Files Modified

1. **vercel.json** - Added REMBG edge function configuration
   - Added build for `api/rembg.ts` edge function
   - Added route for `/api/rembg` → edge function

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        User's Browser                        │
└────────────┬────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────┐
│                    Vercel Application                        │
│  ┌──────────────────┐  ┌─────────────────────────────────┐ │
│  │   app.js         │  │   api/rembg.ts (Edge Function)  │ │
│  │   (Node.js)      │  │   - Receives image uploads      │ │
│  │   - API routes   │  │   - Forwards to REMBG worker    │ │
│  │   - AI relay     │  └─────────────────────────────────┘ │
│  └──────────────────┘                                       │
└────────────┬────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────┐
│                   Cloudflare Workers                         │
│  ┌────────────────────────┐  ┌──────────────────────────┐  │
│  │  sofapaint-api         │  │  openpaint-ai-worker     │  │
│  │  - Background removal  │  │  - AI SVG generation     │  │
│  │  - Image storage       │  │  - Measurement assist    │  │
│  │  - Cloudflare Images   │  │  - Label placement       │  │
│  └────────────────────────┘  └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Worker Details

### Worker 1: sofapaint-api (REMBG)

**Location:** `sofapaint-api/`

**Purpose:** Background removal and image storage

**Endpoints:**
- `POST /images/direct-upload` - Get presigned URL for image upload
- `POST /remove-background` - Remove background from image
- `GET /health` - Health check

**Secrets Required:**
- `IMAGES_API_TOKEN` - Cloudflare Images API token

**Will be deployed to:** `https://sofapaint-api.<subdomain>.workers.dev`

### Worker 2: openpaint-ai-worker (AI SVG)

**Location:** `worker/`

**Purpose:** AI-powered SVG generation and measurement assistance

**Endpoints:**
- `POST /generate-svg` - Convert strokes to production SVG
- `POST /assist-measurement` - Get measurement suggestions
- `POST /enhance-placement` - Optimize label positions
- `POST /analyze-and-dimension` - Full analysis pipeline
- `GET /health` - Health check

**Secrets Required:**
- `AI_WORKER_KEY` - API key for authentication (generate with `openssl rand -hex 32`)

**Will be deployed to:** `https://openpaint-ai-worker.<subdomain>.workers.dev`

## Deployment Steps

### Quick Method (Recommended)

```bash
# 1. Run automated deployment script
./deploy-workers.sh

# 2. Follow prompts to set secrets
# 3. Copy the worker URLs shown at the end
# 4. Add them to Vercel environment variables (see below)
# 5. Push changes to trigger Vercel redeploy
```

### Manual Method

See `WORKER_DEPLOYMENT_GUIDE.md` for detailed manual deployment steps.

## Vercel Configuration Required

After deploying workers, add these environment variables to Vercel:

### Go to: Vercel Dashboard → Your Project → Settings → Environment Variables

| Variable | Value | Where to Get It |
|----------|-------|-----------------|
| `AI_WORKER_URL` | `https://openpaint-ai-worker.xxx.workers.dev` | From worker deployment output |
| `AI_WORKER_KEY` | `(secret you set)` | The secret you entered during deployment |
| `REMBG_URL` | `https://sofapaint-api.xxx.workers.dev/remove-background` | From worker deployment output + `/remove-background` |
| `CF_ACCOUNT_ID` | `665aca072a7cddbc216be6b25a6fd951` | Already in wrangler.toml |
| `CF_ACCOUNT_HASH` | `tJVRdWyUXVZJRoGHy-ATBQ` | Already in wrangler.toml |
| `CF_IMAGES_API_TOKEN` | `(your CF Images token)` | From Cloudflare dashboard |

### After Setting Environment Variables

```bash
# Push changes to trigger redeploy
git add vercel.json
git commit -m "feat: add REMBG edge function and worker configuration"
git push origin claude/add-rotate-button-hover-011CUsxvpyJsxuEHNfgygopZ
```

Or manually redeploy in Vercel dashboard.

## Testing

### Test Workers Directly

```bash
# Test REMBG worker
curl https://sofapaint-api.xxx.workers.dev/health

# Test AI worker
curl https://openpaint-ai-worker.xxx.workers.dev/health
```

### Test Through Vercel

```bash
# Test REMBG endpoint
curl -X POST https://your-app.vercel.app/api/rembg \
  -F "file=@test-image.jpg" \
  --output result.png

# Test AI SVG endpoint
curl -X POST https://your-app.vercel.app/ai/generate-svg \
  -H "Content-Type: application/json" \
  -d '{
    "image": {"width": 800, "height": 600},
    "strokes": [{
      "id": "t1",
      "type": "straight",
      "points": [{"x": 0, "y": 0}, {"x": 120, "y": 0}],
      "color": "#000",
      "width": 2
    }]
  }'
```

### Test in Browser

1. Go to `https://your-app.vercel.app`
2. Upload an image
3. Draw measurement strokes
4. Click "AI SVG Export" button
5. Verify SVG preview appears
6. Check browser console for any errors

## What Changed in This Session

### vercel.json
```diff
+ Added api/rembg.ts edge function build
+ Added route for /api/rembg
```

**Why:** The REMBG edge function wasn't configured in Vercel builds/routes, so background removal wasn't working.

## Next Steps for User

1. **Deploy Workers** (5 minutes)
   ```bash
   ./deploy-workers.sh
   ```

2. **Update Vercel Environment Variables** (2 minutes)
   - Go to Vercel Dashboard
   - Add the 6 environment variables listed above
   - Use URLs from deployment script output

3. **Redeploy Vercel** (1 minute)
   ```bash
   git push origin claude/add-rotate-button-hover-011CUsxvpyJsxuEHNfgygopZ
   ```

4. **Test Everything** (3 minutes)
   - Test worker health endpoints
   - Test REMBG in browser
   - Test AI SVG export in browser

**Total Time: ~11 minutes**

## Troubleshooting

### "wrangler: command not found"
```bash
npm install -g wrangler
```

### "Not logged in to Cloudflare"
```bash
wrangler login
```

### "Secret not set"
```bash
# For REMBG worker
cd sofapaint-api
wrangler secret put IMAGES_API_TOKEN

# For AI worker
cd worker
wrangler secret put AI_WORKER_KEY
```

### "Worker deployed but not working"
- Check worker logs: `wrangler tail --name <worker-name>`
- Check Vercel logs: `vercel logs <url> --follow`
- Verify environment variables in Vercel dashboard
- Ensure worker URLs in Vercel match deployed worker URLs

## Support Resources

- **Quick Start:** `QUICK_START_WORKERS.md`
- **Detailed Guide:** `WORKER_DEPLOYMENT_GUIDE.md`
- **Deployment Script:** `deploy-workers.sh`
- **Wrangler Docs:** https://developers.cloudflare.com/workers/wrangler/
- **Vercel Docs:** https://vercel.com/docs/environment-variables

## Success Checklist

- [ ] Wrangler CLI installed
- [ ] Logged in to Cloudflare
- [ ] sofapaint-api deployed
- [ ] openpaint-ai-worker deployed
- [ ] All secrets set in workers
- [ ] Environment variables added to Vercel
- [ ] Vercel redeployed
- [ ] Worker health checks pass
- [ ] REMBG works in browser
- [ ] AI SVG export works in browser
- [ ] No console errors

Once all items are checked, workers are fully reactivated! 🎉
