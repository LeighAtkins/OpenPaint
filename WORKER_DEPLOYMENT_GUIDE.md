# Cloudflare Workers Deployment Guide

## Overview

OpenPaint uses **two Cloudflare Workers** for AI and image processing:

1. **sofapaint-api** - Image upload and background removal (REMBG)
2. **openpaint-ai-worker** - AI SVG generation and measurement assistance

## Prerequisites

- Cloudflare account with Workers enabled
- `wrangler` CLI installed: `npm install -g wrangler`
- Cloudflare API token with Workers and Images permissions

## Worker 1: sofapaint-api (REMBG & Image Storage)

### Configuration

Location: `sofapaint-api/wrangler.toml`

```toml
name = "sofapaint-api"
main = "src/index.ts"
compatibility_date = "2025-09-06"

[vars]
CF_ACCOUNT_ID = "665aca072a7cddbc216be6b25a6fd951"
ALLOWED_ORIGINS = "https://sofapaint.vercel.app,https://leighatkins.github.io"
ACCOUNT_HASH = "tJVRdWyUXVZJRoGHy-ATBQ"

[images]
binding = "IMAGES"
```

### Features

- **Direct Upload** - `POST /images/direct-upload` - Get presigned URL for image upload
- **Background Removal** - `POST /remove-background` - Remove background using Cloudflare Images
- **Health Check** - `GET /health` - Worker status

### Deployment Steps

```bash
# Navigate to worker directory
cd sofapaint-api

# Login to Cloudflare (if not already)
wrangler login

# Set secret API token
wrangler secret put IMAGES_API_TOKEN
# Paste your Cloudflare Images API token when prompted

# Deploy worker
wrangler deploy

# Test deployment
curl https://sofapaint-api.sofapaint-api.workers.dev/health
```

### Expected Output

```
✅ Worker deployed to: https://sofapaint-api.<your-subdomain>.workers.dev
```

## Worker 2: openpaint-ai-worker (AI SVG Generation)

### Configuration

Location: `worker/wrangler.toml`

```toml
name = "openpaint-ai-worker"
main = "src/index.js"
compatibility_date = "2024-01-01"

[vars]
ENVIRONMENT = "production"
```

### Features

- **Generate SVG** - `POST /generate-svg` - Convert strokes to production SVG
- **Assist Measurement** - `POST /assist-measurement` - Get measurement suggestions
- **Enhance Placement** - `POST /enhance-placement` - Optimize label positions
- **Analyze & Dimension** - `POST /analyze-and-dimension` - Full analysis pipeline

### Deployment Steps

```bash
# Navigate to worker directory
cd worker

# Set worker API key secret
wrangler secret put AI_WORKER_KEY
# Enter a secure random key (e.g., output of: openssl rand -hex 32)

# Deploy worker
wrangler deploy

# Test deployment
curl https://openpaint-ai-worker.<your-subdomain>.workers.dev/health
```

### Expected Output

```
✅ Worker deployed to: https://openpaint-ai-worker.<your-subdomain>.workers.dev
```

## Vercel Configuration

After deploying both workers, configure Vercel environment variables:

### Required Environment Variables

Go to Vercel Dashboard → Your Project → Settings → Environment Variables

| Variable | Value | Description |
|----------|-------|-------------|
| `AI_WORKER_URL` | `https://openpaint-ai-worker.<subdomain>.workers.dev` | AI worker endpoint |
| `AI_WORKER_KEY` | (same secret you set with `wrangler secret put`) | API key for AI worker |
| `REMBG_URL` | `https://sofapaint-api.<subdomain>.workers.dev/remove-background` | Background removal endpoint |
| `CF_ACCOUNT_ID` | `665aca072a7cddbc216be6b25a6fd951` | Cloudflare account ID |
| `CF_ACCOUNT_HASH` | `tJVRdWyUXVZJRoGHy-ATBQ` | Cloudflare Images delivery hash |
| `CF_IMAGES_API_TOKEN` | (your Cloudflare Images API token) | For image operations |

### Redeploy Vercel

```bash
# Redeploy to apply environment variables
git push origin claude/add-rotate-button-hover-011CUsxvpyJsxuEHNfgygopZ

# Or trigger manual redeploy in Vercel dashboard
```

## Testing the Integration

### Test REMBG (Background Removal)

```bash
# Upload test image
curl -X POST https://your-app.vercel.app/api/rembg \
  -F "file=@test-image.jpg" \
  --output result.png
```

### Test AI SVG Generation

```bash
# Test AI endpoint
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

### Frontend Testing

1. Open your Vercel app: `https://your-app.vercel.app`
2. Upload an image
3. Draw some measurement strokes
4. Click "AI SVG Export" button
5. Verify SVG preview appears

## Monitoring

### Worker Logs

```bash
# Tail logs for sofapaint-api
wrangler tail --name sofapaint-api

# Tail logs for openpaint-ai-worker
wrangler tail --name openpaint-ai-worker
```

### Vercel Logs

```bash
vercel logs https://your-app.vercel.app --follow
```

## Troubleshooting

### Issue: 401 Unauthorized

**Cause:** API key mismatch between worker and Vercel
**Fix:** Ensure `AI_WORKER_KEY` in Vercel matches the secret set in worker

```bash
# Reset worker secret
cd worker
wrangler secret put AI_WORKER_KEY

# Update Vercel environment variable to match
```

### Issue: REMBG not working

**Cause:** Missing Cloudflare Images configuration
**Fix:** Verify all CF environment variables are set

```bash
# Check Vercel env vars
vercel env ls

# Verify worker has Images binding
cd sofapaint-api
cat wrangler.toml | grep -A2 "\[images\]"
```

### Issue: CORS errors

**Cause:** Origin not in ALLOWED_ORIGINS
**Fix:** Update worker configuration

```toml
# In sofapaint-api/wrangler.toml
[vars]
ALLOWED_ORIGINS = "https://your-app.vercel.app,https://sofapaint.vercel.app"
```

Then redeploy:
```bash
cd sofapaint-api
wrangler deploy
```

## Quick Deployment Script

Save this as `deploy-workers.sh`:

```bash
#!/bin/bash
set -e

echo "🚀 Deploying Cloudflare Workers"
echo "================================"

# Deploy sofapaint-api
echo "📦 Deploying sofapaint-api..."
cd sofapaint-api
wrangler deploy
REMBG_URL=$(wrangler deployments list --name sofapaint-api | grep -o 'https://[^ ]*' | head -1)
cd ..

# Deploy AI worker
echo "🤖 Deploying openpaint-ai-worker..."
cd worker
wrangler deploy
AI_URL=$(wrangler deployments list --name openpaint-ai-worker | grep -o 'https://[^ ]*' | head -1)
cd ..

echo ""
echo "✅ Deployment Complete!"
echo ""
echo "📋 Update Vercel with these URLs:"
echo "AI_WORKER_URL=${AI_URL}"
echo "REMBG_URL=${REMBG_URL}/remove-background"
echo ""
echo "Don't forget to set the API keys!"
```

## Success Checklist

- [ ] Both workers deployed to Cloudflare
- [ ] Worker secrets configured (AI_WORKER_KEY, IMAGES_API_TOKEN)
- [ ] Vercel environment variables set
- [ ] Vercel app redeployed
- [ ] Health endpoints return 200 OK
- [ ] REMBG endpoint processes images
- [ ] AI SVG export works in frontend
- [ ] No CORS errors in browser console

## Support

If issues persist:
1. Check worker logs: `wrangler tail --name <worker-name>`
2. Check Vercel logs: `vercel logs <url> --follow`
3. Verify environment variables: `vercel env ls`
4. Test endpoints manually with curl
