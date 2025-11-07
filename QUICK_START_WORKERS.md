# Quick Start: Reactivate Workers

## 1-Minute Setup

### Step 1: Deploy Workers

```bash
# Make script executable (if needed)
chmod +x deploy-workers.sh

# Run deployment script
./deploy-workers.sh
```

The script will:
- ✅ Check if `wrangler` is installed
- ✅ Verify you're logged in to Cloudflare
- ✅ Check/set required secrets
- ✅ Deploy both workers
- ✅ Test health endpoints
- ✅ Show you the URLs to add to Vercel

### Step 2: Update Vercel Environment Variables

Go to: [Vercel Dashboard](https://vercel.com/dashboard) → Your Project → Settings → Environment Variables

Add these variables (URLs provided by the deployment script):

```
AI_WORKER_URL=https://openpaint-ai-worker.your-subdomain.workers.dev
AI_WORKER_KEY=<secret-from-deployment>
REMBG_URL=https://sofapaint-api.your-subdomain.workers.dev/remove-background
CF_ACCOUNT_ID=665aca072a7cddbc216be6b25a6fd951
CF_ACCOUNT_HASH=tJVRdWyUXVZJRoGHy-ATBQ
CF_IMAGES_API_TOKEN=<your-cloudflare-images-token>
```

### Step 3: Redeploy Vercel

```bash
# Trigger redeploy
git push origin claude/add-rotate-button-hover-011CUsxvpyJsxuEHNfgygopZ
```

Or use Vercel dashboard: Deployments → Redeploy

### Step 4: Test

1. Open your app: `https://your-app.vercel.app`
2. Upload an image
3. Draw measurement strokes
4. Click "AI SVG Export"
5. Verify SVG preview appears

## What Each Worker Does

### sofapaint-api (REMBG)
- **Background Removal** - Removes image backgrounds using Cloudflare Images
- **Image Upload** - Handles image storage in Cloudflare Images
- **Endpoint**: `/remove-background`

### openpaint-ai-worker (AI SVG)
- **SVG Generation** - Converts strokes to production-ready SVG
- **Measurement Assist** - Suggests measurement points
- **Label Placement** - Optimizes label positions
- **Endpoints**: `/generate-svg`, `/assist-measurement`, `/enhance-placement`

## Troubleshooting

### Workers not deploying?

```bash
# Install wrangler globally
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Try manual deployment
cd sofapaint-api && wrangler deploy && cd ..
cd worker && wrangler deploy && cd ..
```

### Missing secrets?

```bash
# Set sofapaint-api secret
cd sofapaint-api
wrangler secret put IMAGES_API_TOKEN
# Paste your Cloudflare Images API token

# Set AI worker secret
cd worker
wrangler secret put AI_WORKER_KEY
# Generate with: openssl rand -hex 32
```

### Still not working?

Check logs:
```bash
# Worker logs
wrangler tail --name sofapaint-api
wrangler tail --name openpaint-ai-worker

# Vercel logs
vercel logs https://your-app.vercel.app --follow
```

## Manual Deployment (if script fails)

### Deploy sofapaint-api

```bash
cd sofapaint-api
wrangler login
wrangler secret put IMAGES_API_TOKEN
wrangler deploy
cd ..
```

### Deploy openpaint-ai-worker

```bash
cd worker
wrangler login
wrangler secret put AI_WORKER_KEY
wrangler deploy
cd ..
```

## Testing

Test workers directly:

```bash
# Test REMBG
curl https://sofapaint-api.your-subdomain.workers.dev/health

# Test AI worker
curl https://openpaint-ai-worker.your-subdomain.workers.dev/health
```

## Need More Help?

See detailed guide: `WORKER_DEPLOYMENT_GUIDE.md`
