# Cloudflare Direct Upload Fix - Deployment Guide

## Problem Summary

The `/api/images/direct-upload` endpoint was returning 404 errors with HTML pages, which the frontend tried to parse as JSON, causing:
```
SyntaxError: Unexpected token 'T', "The page c"... is not valid JSON
```

## What Was Fixed

### 1. Frontend Defensive JSON Parsing

Updated both `public/js/paint.js` and `js/paint.js` to add defensive error handling:

**Before:**
```javascript
const uploadResp = await fetch('/api/images/direct-upload', {
  method: 'POST',
  headers: { 'x-api-key': 'dev-secret' }
});
const uploadData = await uploadResp.json();  // ❌ Crashes on 404 HTML
```

**After:**
```javascript
const uploadResp = await fetch('/api/images/direct-upload', {
  method: 'POST',
  headers: { 'x-api-key': 'dev-secret' }
});

// Defensive parsing: get text first to show proper error messages
const uploadText = await uploadResp.text();
if (!uploadResp.ok) {
  throw new Error(`Direct upload failed (${uploadResp.status} ${uploadResp.statusText}): ${uploadText.slice(0, 200)}`);
}

let uploadData;
try {
  uploadData = JSON.parse(uploadText);
} catch (parseErr) {
  throw new Error(`Expected JSON from /api/images/direct-upload but got: ${uploadText.slice(0, 200)}`);
}
```

This pattern was applied to:
- `/api/images/direct-upload` endpoint calls
- Cloudflare Images direct upload URL responses

### 2. Architecture Overview

The request flow is:

```
Frontend (public/js/paint.js)
  ↓
  POST /api/images/direct-upload
  ↓
Vercel API Route (api/images/direct-upload.js)
  ↓
  Proxies to Express server (server/app.js)
  ↓
  Proxies to Cloudflare Worker
  ↓
Cloudflare Worker (sofapaint-api/src/index.ts)
  ↓
  Calls Cloudflare Images API
```

## Cloudflare Worker Deployment Requirements

### Required Environment Variables

The Cloudflare Worker (`sofapaint-api/`) requires these variables:

#### Public Variables (in `wrangler.toml`):
```toml
[vars]
CF_ACCOUNT_ID = "665aca072a7cddbc216be6b25a6fd951"
ALLOWED_ORIGINS = "https://sofapaint.vercel.app,https://leighatkins.github.io"
ACCOUNT_HASH = "tJVRdWyUXVZJRoGHy-ATBQ"
```

#### Secret Variables (set via CLI):
```bash
cd sofapaint-api
wrangler secret put IMAGES_API_TOKEN
# When prompted, enter your Cloudflare Images API token
```

### How to Deploy the Cloudflare Worker

1. **Install dependencies:**
   ```bash
   cd /home/user/OpenPaint/sofapaint-api
   npm install
   ```

2. **Set the secret:**
   ```bash
   wrangler secret put IMAGES_API_TOKEN
   ```
   You'll need a Cloudflare API token with `Images:Edit` permission at the Account scope.

3. **Deploy:**
   ```bash
   wrangler deploy
   ```

4. **Verify deployment:**
   ```bash
   curl -X POST https://sofapaint-api.leigh-atkins.workers.dev/images/direct-upload \
     -H "x-api-key: dev-secret"
   ```

   Expected response:
   ```json
   {
     "success": true,
     "result": {
       "id": "...",
       "uploadURL": "https://upload.imagedelivery.net/..."
     }
   }
   ```

### Vercel Environment Variable

The Express server needs to know where the Cloudflare Worker is deployed:

```bash
# In Vercel dashboard or via CLI:
vercel env add REMBG_ORIGIN
# Value: https://sofapaint-api.leigh-atkins.workers.dev
```

Or in `.env.local` for local development:
```
REMBG_ORIGIN=https://sofapaint-api.leigh-atkins.workers.dev
```

## Testing the Fix

### 1. Local Test (if running locally)

```bash
# Start the server
npm start

# In another terminal, test the endpoint:
curl -X POST http://localhost:3000/api/images/direct-upload \
  -H "x-api-key: dev-secret" \
  -v
```

### 2. Production Test

Open browser DevTools Console and run:
```javascript
const resp = await fetch('/api/images/direct-upload', {
  method: 'POST',
  headers: { 'x-api-key': 'dev-secret' }
});
const text = await resp.text();
console.log('Status:', resp.status);
console.log('Response:', text);
```

### Expected Success Response
```json
{
  "success": true,
  "result": {
    "id": "2cYHfWXaFnAaFnAa...",
    "uploadURL": "https://upload.imagedelivery.net/..."
  }
}
```

### Expected Error (if worker not deployed)
With the new defensive parsing, you'll see a clear error message:
```
Direct upload failed (404 Not Found): The page could not be found...
```
Instead of:
```
SyntaxError: Unexpected token 'T'
```

## Troubleshooting

### Issue: "unauthorized" error
**Cause:** The `x-api-key` header is missing or incorrect.
**Fix:** Ensure requests include `'x-api-key': 'dev-secret'`

### Issue: "REMBG_ORIGIN is not configured"
**Cause:** The Express server doesn't know where the Cloudflare Worker is.
**Fix:** Set `REMBG_ORIGIN` environment variable in Vercel.

### Issue: Still getting 404 from Cloudflare Worker
**Cause:** Worker not deployed or route doesn't match.
**Fix:**
1. Deploy worker: `cd sofapaint-api && wrangler deploy`
2. Verify worker URL matches `REMBG_ORIGIN`
3. Check worker logs: `wrangler tail`

### Issue: "missing_imageId" or other worker errors
**Cause:** Worker is deployed but API call failed.
**Fix:** Check that `IMAGES_API_TOKEN` secret is set and valid.

## Files Changed

- ✅ `public/js/paint.js` - Added defensive JSON parsing
- ✅ `js/paint.js` - Added defensive JSON parsing
- ✅ `server/app.js` - Already has proper proxy setup
- ✅ `sofapaint-api/src/index.ts` - Worker already implements endpoint
- ✅ `sofapaint-api/wrangler.toml` - Configuration already correct

## Next Steps

1. **Deploy the Cloudflare Worker** (if not already deployed)
2. **Set the IMAGES_API_TOKEN secret**
3. **Verify the REMBG_ORIGIN environment variable in Vercel**
4. **Test the endpoint** using the methods above
5. **Monitor for errors** with clear, descriptive messages

## Notes

- The defensive JSON parsing will now show you the **actual error** from the server instead of a cryptic JSON parse error
- This makes debugging much easier
- The worker code is already correct; the main issue was likely deployment or missing secrets
