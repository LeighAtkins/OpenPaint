# Background Removal Diagnostic Testing Guide

## Quick Verification Checklist

After deployment, verify each step of the background removal workflow:

### ✅ Step 1: Signed Upload URL Request

**Test Vercel Proxy Endpoint:**
```bash
curl -i -X POST \
  https://your-deployment.vercel.app/api/images/direct-upload \
  -H "x-api-key: dev-secret"
```

**Expected Response:**
- **Status:** `200 OK`
- **Body:**
```json
{
  "success": true,
  "result": {
    "uploadURL": "https://upload.imagedelivery.net/...",
    "id": "abc123..."
  }
}
```

**Vercel Function Logs (Expected):**
```
[Proxy] Requesting signed upload URL from: https://sofapaint-api.leigh-atkins.workers.dev/images/direct-upload
[Proxy] Request headers: { 'x-api-key': 'present' }
[Proxy] Worker response status: 200
[Proxy] Worker response: success has result
```

---

**Test Cloudflare Worker Directly (Bypass Proxy):**
```bash
curl -i -X POST \
  https://sofapaint-api.leigh-atkins.workers.dev/images/direct-upload \
  -H "x-api-key: dev-secret"
```

**Expected Response:** Same as above

**Purpose:** If proxy fails but direct worker works, issue is in Vercel proxy logic.

---

### ✅ Step 2: Upload Image to Cloudflare

**Test Image Upload:**
```bash
# First get the uploadURL from Step 1, then:
curl -i -X POST \
  "<uploadURL-from-step-1>" \
  -F "file=@test-image.png"
```

**Expected Response:**
- **Status:** `200 OK`
- **Body:**
```json
{
  "success": true,
  "result": {
    "id": "xyz789...",
    "filename": "test-image.png",
    "uploaded": "2025-11-09T...",
    "requireSignedURLs": false,
    "variants": ["https://imagedelivery.net/..."]
  }
}
```

**Common Failures:**
- **400 Bad Request:** Missing `file` field or incorrect FormData format
- **413 Payload Too Large:** Image exceeds size limit (10MB default)
- **415 Unsupported Media Type:** Invalid image format

---

### ✅ Step 3: Remove Background

**Test Background Removal:**
```bash
# Use imageId from Step 2
curl -i -X POST \
  https://your-deployment.vercel.app/api/remove-background \
  -H "Content-Type: application/json" \
  -H "x-api-key: dev-secret" \
  -d '{"imageId":"xyz789...","return":"url"}'
```

**Expected Response:**
- **Status:** `200 OK`
- **Body (JSON mode):**
```json
{
  "success": true,
  "id": "processed-id...",
  "cutoutUrl": "https://imagedelivery.net/.../processed-id.../public",
  "processed": true
}
```

**OR Binary Image Response:**
- **Status:** `200 OK`
- **Content-Type:** `image/png`
- **Body:** Raw PNG bytes (transparent background)

---

## Failure Diagnosis

### 500 FUNCTION_INVOCATION_FAILED

**Vercel Function Logs to Check:**
```bash
vercel logs https://your-deployment.vercel.app
```

**Look for:**
1. **Proxy error with stack trace:**
   ```
   [Proxy] /images/direct-upload error: {
     name: 'TypeError',
     message: '...',
     stack: '...'
   }
   ```

2. **Upstream worker failure:**
   ```
   [Proxy] Signed URL request failed: {
     status: 401,
     statusText: 'Unauthorized',
     body: '{"error":"unauthorized"}'
   }
   ```

3. **Missing environment variables:**
   ```
   [Proxy] Worker error: { error: 'missing env vars' }
   ```

**Common Root Causes:**
- **Missing `CF_WORKER_URL` env var** → Proxy can't find worker URL
- **Missing `x-api-key` header** → Worker returns 401
- **Worker env vars not set** → Worker fails (CF_ACCOUNT_ID, IMAGES_API_TOKEN, ACCOUNT_HASH)
- **Network timeout** → Worker takes too long to respond

---

### 502 Bad Gateway (Upstream Failure)

**Meaning:** Vercel proxy successfully connected to worker, but worker returned non-2xx response.

**Check Vercel Logs For:**
```
[Proxy] Signed URL request failed: {
  status: 500,
  statusText: 'Internal Server Error',
  body: '{"error":"exception","message":"..."}'
}
```

**Common Worker Errors:**
- **401 Unauthorized:** Invalid or missing `x-api-key`
- **500 Worker Error:** Cloudflare API credentials invalid (IMAGES_API_TOKEN)
- **503 Service Unavailable:** Cloudflare Images API down

**Fix:** Check Cloudflare Worker logs and environment variables.

---

### Client-Side Console Errors

**Browser Console Expected Flow:**
```
[BG-REMOVE] Starting background removal workflow
[BG-REMOVE] Image blob ready: { size: 45678, type: "image/png", sizeKB: "44.61 KB" }
[BG-REMOVE] Step 1: Requesting signed upload URL from /api/images/direct-upload
[BG-REMOVE] Step 1 response: 200 { success: true, result: { uploadURL: "...", id: "..." } }
[BG-REMOVE] Step 2: Uploading image to Cloudflare: https://upload.imagedelivery.net/...
[BG-REMOVE] Step 2 response: 200 { success: true, result: { id: "..." } }
[BG-REMOVE] Step 3: Requesting background removal for imageId: xyz789...
```

**Failure Examples:**
```
[BG-REMOVE] Step 1 failed: {
  status: 500,
  statusText: 'Internal Server Error',
  body: '{"success":false,"message":"Proxy error","error":"..."}'
}
```

---

## Environment Variables Checklist

### Vercel Environment Variables

Required for proxy to work:
- `CF_WORKER_URL` → `https://sofapaint-api.leigh-atkins.workers.dev`
- `NODE_ENV` → `production` (optional, for logging)

**Verify in Vercel Dashboard:**
1. Project Settings → Environment Variables
2. Ensure `CF_WORKER_URL` is set for **Production** environment
3. Redeploy if variables were just added

---

### Cloudflare Worker Environment Variables

Required for worker to function:
- `CF_ACCOUNT_ID` → Cloudflare account ID
- `IMAGES_API_TOKEN` → API token with "Cloudflare Images:Edit" permission
- `ACCOUNT_HASH` → Image delivery hash (from imagedelivery.net URL)
- `ALLOWED_ORIGINS` → Comma-separated allowed origins (optional for CORS)

**Verify in Cloudflare Dashboard:**
1. Workers & Pages → sofapaint-api → Settings → Variables
2. Ensure all variables are set
3. Redeploy worker if variables were updated

---

## Quick Debug Script

Save as `test-bg-removal.sh`:

```bash
#!/bin/bash

DEPLOYMENT_URL="https://your-deployment.vercel.app"
WORKER_URL="https://sofapaint-api.leigh-atkins.workers.dev"
API_KEY="dev-secret"

echo "=== Testing Step 1: Get Signed Upload URL (via Proxy) ==="
STEP1_RESPONSE=$(curl -s -X POST "$DEPLOYMENT_URL/api/images/direct-upload" \
  -H "x-api-key: $API_KEY")
echo "$STEP1_RESPONSE" | jq .

UPLOAD_URL=$(echo "$STEP1_RESPONSE" | jq -r '.result.uploadURL')
IMAGE_ID=$(echo "$STEP1_RESPONSE" | jq -r '.result.id')

if [ "$UPLOAD_URL" == "null" ]; then
  echo "❌ FAILED: No uploadURL returned"
  exit 1
fi

echo "✅ SUCCESS: Got uploadURL and ID: $IMAGE_ID"
echo ""

echo "=== Testing Step 1: Direct Worker (Bypass Proxy) ==="
curl -s -X POST "$WORKER_URL/images/direct-upload" \
  -H "x-api-key: $API_KEY" | jq .
echo ""

echo "=== Testing Step 2: Upload Test Image ==="
# Create a tiny test image
convert -size 100x100 xc:red test-image.png 2>/dev/null || echo "Note: Install ImageMagick to auto-create test image"

if [ -f test-image.png ]; then
  STEP2_RESPONSE=$(curl -s -X POST "$UPLOAD_URL" -F "file=@test-image.png")
  echo "$STEP2_RESPONSE" | jq .

  UPLOADED_ID=$(echo "$STEP2_RESPONSE" | jq -r '.result.id')

  if [ "$UPLOADED_ID" == "null" ]; then
    echo "❌ FAILED: No image ID returned"
    exit 1
  fi

  echo "✅ SUCCESS: Uploaded image ID: $UPLOADED_ID"
  echo ""

  echo "=== Testing Step 3: Remove Background ==="
  curl -s -X POST "$DEPLOYMENT_URL/api/remove-background" \
    -H "Content-Type: application/json" \
    -H "x-api-key: $API_KEY" \
    -d "{\"imageId\":\"$UPLOADED_ID\",\"return\":\"url\"}" | jq .
else
  echo "⚠️  SKIPPED: No test-image.png found. Create one manually and re-run."
fi

echo ""
echo "=== Test Complete ==="
```

**Run:**
```bash
chmod +x test-bg-removal.sh
./test-bg-removal.sh
```

---

## Acceptance Criteria

- ✅ No TypeScript React namespace errors in build logs
- ✅ `POST /api/images/direct-upload` returns 200 with `uploadURL` and `id`
- ✅ No `FUNCTION_INVOCATION_FAILED` during signed URL request
- ✅ Image upload to Cloudflare succeeds with valid `id`
- ✅ Background removal returns `cutoutUrl` or binary PNG
- ✅ User sees processed image with transparent background in UI
- ✅ All [BG-REMOVE] console logs appear in browser DevTools
- ✅ All [Proxy] logs appear in Vercel function logs

---

## Further Help

If errors persist after following this guide:

1. **Capture Vercel logs:** `vercel logs [deployment-url] > vercel-logs.txt`
2. **Capture browser console:** DevTools → Console → Save as log
3. **Capture curl outputs:** Save all curl responses to files
4. **Check Cloudflare Worker logs:** Dashboard → Workers & Pages → sofapaint-api → Logs
5. **Verify environment variables:** Both Vercel and Cloudflare dashboards

Provide all captured logs for detailed diagnosis.
