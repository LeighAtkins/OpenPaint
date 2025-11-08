# Background Removal Implementation Guide

**Status**: Ready for deployment
**Branch**: `claude/fix-rembg-cloudflare-api-011CUtHqiM1ZFqdtukrjYfoJ`
**Priority**: Critical fixes to restore working state from commit 772b8f1

---

## ✅ What's Already Fixed

1. **Missing Helper Function** - Added `rembg_blobToDataURL()` to paint.js:797-808
2. **Tailwind Colors** - Custom color tokens defined and safelist configured
3. **Visibility Guard** - Runtime check for Copy button in place

---

## 🔴 Critical: Actions Required by You

These require your Cloudflare and Vercel credentials and cannot be automated.

### 1. Set IMAGES_API_TOKEN on Cloudflare Worker (CRITICAL)

**Why**: Worker needs this to authenticate with Cloudflare Images API
**Status**: ⏸️ Unknown - needs verification
**Priority**: P0 - Will cause 500 errors without this

#### Steps:

1. **Get or create Cloudflare Images API Token**:
   ```bash
   # Go to: https://dash.cloudflare.com/profile/api-tokens
   # Click "Create Token"
   # Use template: "Edit Cloudflare Images" OR create custom:
   #   Permission: Cloudflare Images:Edit
   #   Account Resources: Include > Your Account
   # Copy the token immediately (you won't see it again!)
   ```

2. **Set the secret on your Worker**:
   ```bash
   cd /home/user/OpenPaint/sofapaint-api

   # Install wrangler if needed
   npm install

   # Login to Cloudflare
   npx wrangler login

   # Set the secret
   npx wrangler secret put IMAGES_API_TOKEN
   # Paste your API token when prompted

   # Redeploy (may happen automatically, but run to be sure)
   npx wrangler deploy
   ```

3. **Verify it worked**:
   ```bash
   # Test the direct-upload endpoint
   curl -s -X POST \
     -H "x-api-key: dev-secret" \
     https://sofapaint-api.sofapaint-api.workers.dev/images/direct-upload | jq .

   # Expected: JSON with "uploadURL" and "id" fields
   # Error: "IMAGES_API_TOKEN is not configured" means step 2 failed
   ```

---

### 2. Set REMBG_ORIGIN in Vercel Environment (HIGH)

**Why**: Vercel proxy needs to know where to forward requests
**Status**: ⏸️ Set locally (.env) but not in Vercel dashboard
**Priority**: P0 - Production deployments will fail without this

#### Option A: Via Vercel Dashboard (Recommended)

1. Go to: https://vercel.com/dashboard
2. Select your OpenPaint project
3. Click **Settings** → **Environment Variables**
4. Click **Add New**:
   - **Name**: `REMBG_ORIGIN`
   - **Value**: `https://sofapaint-api.sofapaint-api.workers.dev`
   - **Environments**: ✅ Production, ✅ Preview, ✅ Development
5. Click **Save**
6. **Redeploy** your project to apply the change

#### Option B: Via Vercel CLI

```bash
# Install Vercel CLI if needed
npm install -g vercel

# Login
vercel login

# Set environment variables
vercel env add REMBG_ORIGIN production
# When prompted, enter: https://sofapaint-api.sofapaint-api.workers.dev

vercel env add REMBG_ORIGIN preview
# Enter same value

vercel env add REMBG_ORIGIN development
# Enter same value

# Trigger new deployment
vercel --prod
```

#### Verify it worked:

```bash
# Check the _env debug endpoint (if you have it)
curl https://your-app.vercel.app/api/_env

# Expected: {"REMBG_ORIGIN":"configured",...}
```

---

## 🧪 Testing Checklist

Run these tests after completing the critical actions above:

### Test 1: Worker Health Check
```bash
curl -s https://sofapaint-api.sofapaint-api.workers.dev/health \
  -H "x-api-key: dev-secret" | jq .

# Expected: {"ok":true,"service":"sofapaint-api","time":"..."}
# Status: ✅ PASSING (already verified)
```

### Test 2: Direct Upload Endpoint
```bash
curl -s -X POST \
  -H "x-api-key: dev-secret" \
  https://sofapaint-api.sofapaint-api.workers.dev/images/direct-upload | jq .

# Expected: {"success":true,"result":{"uploadURL":"...","id":"..."}}
# Failure: {"error":"configuration_error","message":"IMAGES_API_TOKEN is not configured"}
```

### Test 3: Upload a Test Image
```bash
# Save test image as test.png
curl -s -X POST \
  -H "x-api-key: dev-secret" \
  https://sofapaint-api.sofapaint-api.workers.dev/images/direct-upload | \
  jq -r '.result.uploadURL' > upload_url.txt

# Upload to that URL
curl -X POST -F "file=@test.png" $(cat upload_url.txt)

# Expected: HTTP 200 with image ID
```

### Test 4: Background Removal
```bash
# Get image ID from test 3, then:
curl -s -X POST \
  -H "x-api-key: dev-secret" \
  -H "Content-Type: application/json" \
  -d '{"imageId":"YOUR-IMAGE-ID","return":"url"}' \
  https://sofapaint-api.sofapaint-api.workers.dev/remove-background | jq .

# Expected: {"success":true,"id":"...","cutoutUrl":"...","processed":true}
```

### Test 5: End-to-End in Browser
1. Deploy your changes: `git push origin claude/fix-rembg-cloudflare-api-011CUtHqiM1ZFqdtukrjYfoJ`
2. Wait for Vercel deployment to complete
3. Open your app in browser
4. Open DevTools (F12) → Console tab
5. Upload an image
6. Click "Remove BG" button
7. Watch console for errors

**Expected**:
- ✅ No `rembg_blobToDataURL is not defined` error
- ✅ No `REMBG_ORIGIN is not configured` error
- ✅ Image background is removed and applied to canvas
- ✅ Console shows: `[BG-REMOVE] Successfully fetched processed image blob: XXXXX bytes`

**Common Errors**:
- ❌ `500 IMAGES_API_TOKEN is not configured` → Complete step 1 above
- ❌ `500 REMBG_ORIGIN is not configured` → Complete step 2 above
- ❌ `401 unauthorized` → Check x-api-key header (should be "dev-secret")
- ❌ `502 fetch_source_failed` → Wrong ACCOUNT_HASH in wrangler.toml
- ❌ `ReferenceError: rembg_blobToDataURL is not defined` → Function added, but code not deployed

---

## 📦 What's Been Committed

**Commit 1**: Tailwind v4 custom colors
**Commit 2**: Copy button visibility safeguards
**Commit 3**: Documentation (this file + XML reports)
**Commit 4**: Added `rembg_blobToDataURL` function

```bash
# View commits on this branch
git log --oneline origin/main..HEAD

# Files modified:
# - public/js/paint.js (added rembg_blobToDataURL function)
# - css/tailwind.src.css (custom color tokens)
# - tailwind.config.js (safelist)
# - public/boot/visibility-check.js (runtime guard)
# - index.html (load visibility guard)
# - CLAUDE.md (CSS documentation)
# - docs/*.xml (analysis reports)
```

---

## 🚀 Deployment Workflow

Once you've completed steps 1 and 2 above:

```bash
# 1. Commit any local changes (if needed)
git add .
git commit -m "chore: update local configuration"

# 2. Push to trigger Vercel deployment
git push origin claude/fix-rembg-cloudflare-api-011CUtHqiM1ZFqdtukrjYfoJ

# 3. Create pull request to merge to main
# (or use Vercel's preview deployment for testing first)

# 4. Monitor deployment logs
# - Vercel: https://vercel.com/dashboard (check deployment logs)
# - Cloudflare: https://dash.cloudflare.com (Workers & Pages → Logs)
```

---

## 🐛 Debugging Common Issues

### Issue: "Worker returns 401 Unauthorized"
**Cause**: Missing or incorrect `x-api-key` header
**Fix**: Ensure client sends `x-api-key: dev-secret` in all requests

### Issue: "Worker returns 500 configuration_error"
**Cause**: `IMAGES_API_TOKEN` secret not set
**Fix**: Complete step 1 above

### Issue: "Vercel proxy returns 500 REMBG_ORIGIN not configured"
**Cause**: Environment variable not set in Vercel dashboard
**Fix**: Complete step 2 above

### Issue: "Background removal works locally but not in production"
**Causes**:
1. Environment variables not set for Production environment
2. CORS issues (check ALLOWED_ORIGINS in wrangler.toml)
3. Different API keys between environments

**Fix**:
- Verify Vercel env vars are set for **Production** (not just Development)
- Check browser console for CORS errors
- Ensure ALLOWED_ORIGINS includes your production domain

### Issue: "Image uploads but background removal fails"
**Causes**:
1. Wrong ACCOUNT_HASH in wrangler.toml
2. Image ID doesn't exist in Cloudflare Images
3. IMAGES_API_TOKEN doesn't have correct permissions

**Fix**:
- Verify ACCOUNT_HASH: Check Cloudflare Images dashboard URL
- Ensure token has `Cloudflare Images:Edit` permission
- Check Cloudflare Worker logs for specific error

---

## 📊 Monitoring

### Key Metrics to Watch

**Cloudflare Dashboard** → Workers & Pages → sofapaint-api:
- Request rate (should be low: ~2 requests per background removal)
- Error rate (should be 0% after fixes)
- CPU time (should be <50ms per request)

**Vercel Dashboard** → Project → Analytics:
- Function invocations on `/api/remove-background` and `/api/images/direct-upload`
- Function errors (should drop to 0 after fixes)
- Function duration (should be <1s)

**Browser Console** (Production):
- No warnings from visibility-check.js
- Background removal completes without errors
- Console shows `[BG-REMOVE] Successfully fetched processed image blob`

---

## 💰 Cost Expectations

**Current Usage** (estimated):
- 10 background removals/day = 20 worker requests/day
- 300 images stored/month (originals + cutouts)
- 600 image deliveries/month

**Costs**:
- Cloudflare Workers: **$0/month** (free tier: 100,000 req/day)
- Cloudflare Images: **$0/month** (free tier: 100,000 images)
- Vercel: **No change** (just proxying requests)

**Total**: $0/month for current volumes

---

## 🔒 Security Notes

### Current State
- API key is hardcoded as "dev-secret" (both client and worker)
- Anyone who discovers the worker URL can use it
- No rate limiting in place

### Recommendations for Production
1. **Replace hardcoded API key with JWT-based auth**
2. **Add rate limiting** (Cloudflare rate limiting rules)
3. **Rotate IMAGES_API_TOKEN quarterly**
4. **Update ALLOWED_ORIGINS** to only include production domains
5. **Enable Cloudflare Bot Management** to prevent automated abuse

**Priority**: Medium (acceptable for MVP, critical for scale)

---

## 📞 Support

If you encounter issues:

1. **Check the logs**:
   - Browser DevTools Console
   - Vercel Deployment Logs
   - Cloudflare Worker Logs

2. **Review the analysis**:
   - `docs/rembg-cloudflare-setup-analysis.xml` (comprehensive technical analysis)
   - `CLOUDFLARE_SETUP.md` (original setup guide)
   - `CLAUDE.md` (general development guide)

3. **Test incrementally**:
   - Run tests 1-4 in order
   - Isolate which step is failing
   - Check the debugging guide for that specific failure

---

## ✅ Success Criteria

You'll know it's working when:

- ✅ Test 2 returns upload URL (not configuration error)
- ✅ Test 4 returns cutout URL (processed image)
- ✅ Browser test shows image with background removed
- ✅ No errors in browser console
- ✅ No errors in Vercel deployment logs
- ✅ No errors in Cloudflare Worker logs

**Expected user experience**:
1. User uploads furniture image
2. User clicks "Remove BG" button
3. Button shows "Processing ⏳" for 2-5 seconds
4. Image reloads with transparent background
5. Button returns to "Remove BG"

---

## 📝 Rollback Plan

If deployment causes issues:

```bash
# Revert to previous working state
git revert HEAD~4..HEAD
git push origin claude/fix-rembg-cloudflare-api-011CUtHqiM1ZFqdtukrjYfoJ --force

# Or: Promote last healthy deployment in Vercel dashboard
# Or: Rollback Worker in Cloudflare dashboard
```

**Safe rollback**: All changes are additive (new function, new configs). Reverting won't break existing functionality.

---

**Last Updated**: 2025-11-08
**Author**: Claude Code Assistant
**Branch**: claude/fix-rembg-cloudflare-api-011CUtHqiM1ZFqdtukrjYfoJ
