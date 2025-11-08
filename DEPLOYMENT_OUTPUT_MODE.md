# Vercel Output Directory Deployment Mode

This project now uses Vercel's **Output Directory mode** for reliable, reproducible deployments with explicit control over the serverless function runtime.

## Architecture

### Build Process
1. `build.sh` script generates `.vercel/output/` directory structure
2. Static assets copied to `.vercel/output/static/`
3. API serverless function created at `.vercel/output/functions/api__app.func/`
4. Routes manifest maps `/api/*` requests to the serverless function

### Runtime
- **Node.js 20.x** (explicitly specified in function config.json)
- **Express.js** app exported from `api/app.js`
- **Built-in fetch** for HTTP requests (no dependencies)

## Vercel Dashboard Configuration

### Required Settings

Go to **Project → Settings → Build & Development Settings**:

| Setting | Value |
|---------|-------|
| Framework Preset | `Other` |
| Node.js Version | `20.x` |
| Install Command | `npm install` |
| Build Command | `bash build.sh` |
| Output Directory | _(leave blank)_ |
| **Ignored Build Step** | _(must be empty or safe)_ |

### Critical: Remove Preview Blocker

If your Ignored Build Step contains:
```bash
if [ "$VERCEL_ENV" == "preview" ]; then exit 1; fi
```

**You must delete it!** This causes legacy runtime errors.

Safe alternative (skip builds when only docs change):
```bash
git diff HEAD^ HEAD --quiet . ':(exclude)*.md' ':(exclude)docs/'
```

## Environment Variables

Set these in **Project → Settings → Environment Variables** for all environments (Production, Preview, Development):

| Variable | Value | Purpose |
|----------|-------|---------|
| `REMBG_ORIGIN` | `https://sofapaint-api.sofapaint-api.workers.dev` | Cloudflare Worker endpoint |
| `CF_API_KEY` | `dev-secret` (or your key) | Worker authentication |

## Local Development

### Test the Build Script
```bash
# Simulate Vercel's build process locally
bash build.sh

# Verify output structure
tree .vercel/output -L 3

# Check runtime is correctly set
grep -r "nodejs20.x" .vercel/output/functions
```

Expected output structure:
```
.vercel/output/
├── config.json
├── functions/
│   └── api__app.func/
│       ├── index.js
│       └── config.json (contains "runtime": "nodejs20.x")
├── routes-manifest.json
└── static/
    ├── index.html
    ├── css/
    ├── js/
    └── public/
```

### Run Local Dev Server
```bash
# For local development (uses full app.js with app.listen())
npm start
```

The root `app.js` includes all features for local development, while `api/app.js` is the minimal isolated entry for Vercel serverless.

## Deployment

### Deploy to Production
```bash
git add -A
git commit -m "your commit message"
git push

# Automatic deployment via GitHub integration
# OR manual deployment:
vercel deploy --prod
```

### Deploy Preview
```bash
git push origin your-branch
# Preview deployment happens automatically
```

## Verification

After deployment, test the endpoints:

### 1. Health Check
```bash
curl https://your-domain.vercel.app/api/healthz
```

Expected response:
```json
{
  "ok": true,
  "node": "v20.x.x",
  "REMBG_ORIGIN": true,
  "CF_API_KEY": true,
  "timestamp": 1234567890
}
```

### 2. Direct Upload Proxy
```bash
curl -X POST https://your-domain.vercel.app/api/images/direct-upload
```

Expected response:
```json
{
  "success": true,
  "result": {
    "uploadURL": "https://upload.imagedelivery.net/..."
  }
}
```

## Troubleshooting

### Build Fails with "Function Runtimes must have a valid version"

**Cause**: Legacy configuration or preview blocker still active

**Fix**:
1. Remove `"functions"` key from `vercel.json` if present
2. Delete preview blocker from Ignored Build Step in dashboard
3. Ensure `build.sh` creates `config.json` with `"runtime": "nodejs20.x"`
4. Redeploy

### FUNCTION_INVOCATION_FAILED at Runtime

**Cause**: Server code importing client-side modules or missing env vars

**Fix**:
1. Check Vercel → Deployment → Functions → `api__app.func` logs for stack trace
2. Verify `api/app.js` has no React/TypeScript/Tailwind imports
3. Confirm `REMBG_ORIGIN` exists in Environment Variables
4. Check function config: `cat .vercel/output/functions/api__app.func/config.json`

### Static Assets Not Loading

**Cause**: Assets not copied to `.vercel/output/static/`

**Fix**:
1. Verify `build.sh` copies your asset directories
2. Check output: `ls -la .vercel/output/static/`
3. Update `build.sh` to include missing directories

### Routes Not Working

**Cause**: Routes manifest not matching your URL patterns

**Fix**:
1. Edit `.vercel/output/routes-manifest.json` in `build.sh`
2. Add route patterns as needed
3. Rebuild and redeploy

## File Structure

```
OpenPaint/
├── api/
│   └── app.js              # Minimal serverless Express app (no app.listen)
├── app.js                  # Full server for local dev (with app.listen)
├── build.sh                # Generates .vercel/output structure
├── vercel.json             # Minimal config (just version + cleanUrls)
├── package.json            # Node 20.x, vercel-build: bash build.sh
└── .vercel/
    └── output/             # Generated by build.sh, gitignored
        ├── config.json
        ├── functions/
        │   └── api__app.func/
        ├── routes-manifest.json
        └── static/
```

## Benefits of Output Directory Mode

✅ **Explicit control** over runtime version (nodejs20.x)
✅ **Reproducible builds** - same output locally and in Vercel
✅ **No legacy runtime errors** - modern build system only
✅ **Clear separation** - static assets vs serverless functions
✅ **Easy debugging** - inspect `.vercel/output/` locally
✅ **No magic** - complete visibility into deployment structure

## Migration Notes

This replaces the previous `vercel.json` configurations that used:
- ❌ Legacy `"builds"` array (caused runtime warnings)
- ❌ `"functions"` with runtime config (conflicted with output mode)
- ❌ Complex `"routes"` arrays (simplified to rewrites in manifest)

Now using:
- ✅ Output Directory generation via `build.sh`
- ✅ Explicit function configs with Node 20.x runtime
- ✅ Simple routes manifest for clean URL routing
- ✅ Minimal `vercel.json` (no build config)
