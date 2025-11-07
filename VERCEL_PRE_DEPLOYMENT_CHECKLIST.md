# Vercel Pre-Deployment Checklist

## Critical Vercel Dashboard Checks

Before deploying, ensure these settings are correct in your Vercel project dashboard:

### 1. Environment Variables ⚠️ **REQUIRED**

Go to: **Project Settings → Environment Variables**

Add the following variable for **both Production and Preview**:

| Variable | Value | Environments |
|----------|-------|--------------|
| `REMBG_ORIGIN` | `https://sofapaint-api.sofapaint-api.workers.dev` | Production, Preview |

**How to add:**
1. Click "Add New"
2. Enter variable name: `REMBG_ORIGIN`
3. Enter value: `https://sofapaint-api.sofapaint-api.workers.dev`
4. Select environments: ✅ Production ✅ Preview
5. Click "Save"

### 2. Build & Development Settings

Go to: **Project Settings → General → Build & Development Settings**

**Verify these settings:**

| Setting | Value |
|---------|-------|
| Framework Preset | Other |
| Build Command | `npm run vercel-build` (builds Tailwind CSS) |
| Output Directory | _(leave empty for static root serving)_ |
| Install Command | `npm install` |

**⚠️ Remove any preview build blockers:**
- Ensure "Ignored Build Step" does NOT contain: `if [ "$VERCEL_ENV" == "preview" ]; then exit 1; fi`
- If present, remove it to allow preview deployments

### 3. Functions Configuration

The new `vercel.json` uses the modern functions configuration:
- ✅ No legacy "builds" array (disables project settings)
- ✅ Uses "functions" with nodejs20.x runtime
- ✅ Simple `/api/*` rewrite to serverless function

### 4. Deployment Readiness

**Files modified in this deployment:**
- ✅ `vercel.json` - Modernized configuration
- ✅ `api/app.js` - Serverless-safe Express app
- ✅ `CLOUDFLARE_SETUP.md` - Updated with actual worker URL

**What will be served:**
- Static files from project root: `/index.html`, `/css/*`, `/js/*`, `/public/*`
- API routes via serverless function: `/api/*`
- CSS built during deployment: `css/tailwind.build.css` (via vercel-build script)

## Post-Deployment Validation

After deploying, run these smoke tests:

### Test 1: Root Page
```bash
curl -I https://your-domain.vercel.app/
```
**Expected:** HTTP 200, content-type: text/html

### Test 2: CSS File
```bash
curl -I https://your-domain.vercel.app/css/tailwind.build.css
```
**Expected:** HTTP 200, content-type: text/css

### Test 3: API Health (if endpoint exists)
```bash
curl https://your-domain.vercel.app/api/healthz
```
**Expected:** `{"ok": true}` or similar success response

### Test 4: REMBG Background Removal (End-to-End)
1. Open the deployed app in browser
2. Upload an image
3. Use the background removal feature
4. Check browser console for success/errors

**Expected console log:**
```
[REMBG] Calling direct-upload endpoint
[REMBG] Upload URL received
[REMBG] Image uploaded successfully
[REMBG] Background removed
```

## Troubleshooting

### Issue: Build succeeds but site doesn't load (blank page)

**Possible causes:**
1. Missing `REMBG_ORIGIN` environment variable
2. Preview build blocker still active
3. Static files not being served

**Solution:**
1. Check Vercel function logs in dashboard
2. Verify environment variables are set for correct environment
3. Check that no routes in `vercel.json` are intercepting static files

### Issue: CSS not loading (unstyled page)

**Possible causes:**
1. `vercel-build` script didn't run
2. CSS file not included in deployment

**Solution:**
1. Check build logs for "tailwindcss v4" output
2. Verify `css/tailwind.build.css` exists after build
3. Ensure no `.vercelignore` is blocking `css/` directory

### Issue: API routes return 404

**Possible causes:**
1. Function not deployed
2. Rewrite rule incorrect

**Solution:**
1. Check `vercel.json` has rewrite: `/api/*` → `/api/app.js`
2. Verify `api/app.js` exports the Express app
3. Check function logs for errors

## Rollback Plan

If deployment fails:

1. **Via Vercel Dashboard:**
   - Go to Deployments
   - Find last working deployment
   - Click "..." → "Promote to Production"

2. **Via Git:**
   ```bash
   git revert HEAD
   git push
   ```

3. **Restore old vercel.json:**
   ```bash
   git checkout HEAD~1 -- vercel.json
   git commit -m "Rollback vercel.json to previous version"
   git push
   ```

## Ready to Deploy?

✅ All checklist items verified
✅ Environment variables set
✅ Preview build blocker removed
✅ Smoke tests ready

**Deploy command:**
```bash
git push origin claude/fix-rembg-cloudflare-api-011CUtHqiM1ZFqdtukrjYfoJ
```

Vercel will automatically deploy on push. Monitor the deployment in the Vercel dashboard.
