# Vercel AI Integration Deployment Guide

## Overview

This guide walks through deploying the AI Worker integration to Vercel, including routing configuration, environment variables, and testing.

## Prerequisites

- ✅ Cloudflare Worker deployed and functional
- ✅ AI relay endpoints implemented in `app.js`
- ✅ Frontend integration complete
- ✅ `vercel.json` configuration file created

## Step 1: Deploy Configuration Files

### 1.1 Commit Changes

```bash
# Add the new files
git add vercel.json
git add app.js

# Commit with descriptive message
git commit -m "Add Vercel routing for AI endpoints

- Add vercel.json to route /ai/* to Express app
- Add module.exports to app.js for Vercel compatibility
- Configure AI Worker relay endpoints"
```

### 1.2 Deploy to Vercel

```bash
# Deploy to production
vercel --prod
```

**Expected Output:**
```
✅ Production: https://sofapaint-jmula3ux9-leigh-atkins-projects.vercel.app
```

## Step 2: Configure Environment Variables

### 2.1 Set Environment Variables in Vercel Dashboard

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Navigate to your project: `sofapaint`
3. Go to **Settings** → **Environment Variables**
4. Add the following variables for **Production**:

| Variable | Value |
|----------|-------|
| `AI_WORKER_URL` | `https://openpaint-ai-worker.sofapaint-api.workers.dev` |
| `AI_WORKER_KEY` | `your-secret-key-here` (same as Worker secret) |

### 2.2 Redeploy After Setting Environment Variables

```bash
# Redeploy to apply environment variables
vercel redeploy https://sofapaint-jmula3ux9-leigh-atkins-projects.vercel.app --prod
```

## Step 3: Test Deployment

### 3.1 Test Health Endpoint

```bash
curl https://sofapaint-jmula3ux9-leigh-atkins-projects.vercel.app/health
```

**Expected Response:**
```json
{"ok": true}
```

### 3.2 Test AI Generate SVG Endpoint

```bash
node -e "
fetch('https://sofapaint-jmula3ux9-leigh-atkins-projects.vercel.app/ai/generate-svg', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    image: {width: 800, height: 600},
    strokes: [{
      id: 't1',
      type: 'straight',
      points: [{x: 0, y: 0}, {x: 120, y: 0}],
      color: '#000',
      width: 2
    }]
  })
})
.then(r => r.text())
.then(console.log)
.catch(console.error)
"
```

**Expected Response:**
```json
{
  "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 800 600\">...</svg>",
  "vectors": [...],
  "summary": {...}
}
```

### 3.3 Run Comprehensive Test Suite

```bash
node test-vercel-deployment.js https://sofapaint-jmula3ux9-leigh-atkins-projects.vercel.app
```

**Expected Output:**
```
🧪 Testing Vercel AI Integration: https://sofapaint-jmula3ux9-leigh-atkins-projects.vercel.app
==================================================

1️⃣ Testing Health Endpoint...
✅ Health Response: { ok: true }

2️⃣ Testing Generate SVG Endpoint...
✅ Generate SVG Success: { svgLength: 1234, vectorCount: 2, hasSummary: true }

3️⃣ Testing Assist Measurement Endpoint...
✅ Assist Measurement Success: { value: 3.17, formatted: "3.17 cm", ... }

4️⃣ Testing Enhance Placement Endpoint...
✅ Enhance Placement Success: { vectorsUpdated: [...] }

📊 Test Results Summary
==============================
✅ health: PASS
✅ generateSvg: PASS
✅ assistMeasurement: PASS
✅ enhancePlacement: PASS

🎯 Overall Result: ALL TESTS PASSED
```

## Step 4: Test Frontend Integration

### 4.1 Open Application

1. Navigate to: https://sofapaint-jmula3ux9-leigh-atkins-projects.vercel.app
2. Upload an image
3. Draw at least one stroke

### 4.2 Test AI Export

1. Click the purple **"AI SVG Export"** button
2. Wait for preview modal to appear
3. Verify SVG displays correctly
4. Test download buttons (SVG and PNG)
5. Test "Save to Project" button

### 4.3 Verify Browser Console

Open DevTools → Console and look for:

**Successful Flow:**
```
[AI Export] Starting export for image: front
[AI Export] Payload created: {strokes: 2, dimensions: "800x600", units: "cm"}
[AI Export] Calling production worker
[AI Export] Success: {svgLength: 1234, vectorCount: 2, measurements: 1}
```

**Error Flow:**
```
[AI Export] Failed: Error: No strokes to export
```

## Troubleshooting

### Issue: 405 Method Not Allowed

**Cause:** `/ai/*` routes not reaching Express app

**Solution:**
1. Verify `vercel.json` is in repository root
2. Check that `vercel.json` contains correct routing rules
3. Redeploy: `vercel --prod`

### Issue: Unauthorized Error

**Cause:** API key mismatch between Vercel and Worker

**Solution:**
1. Verify `AI_WORKER_KEY` in Vercel matches Worker secret
2. Check `AI_WORKER_URL` is correct
3. Redeploy after fixing environment variables

### Issue: Worker Timeout

**Cause:** Worker taking too long to respond

**Solution:**
1. Check Worker logs: `wrangler tail --name openpaint-ai-worker`
2. Verify Worker is processing requests
3. Consider increasing timeout in `app.js` (currently 2 seconds)

### Issue: CORS Error

**Cause:** Worker CORS configuration

**Solution:**
1. Verify Worker CORS headers in `worker/src/index.js`
2. Check that `Access-Control-Allow-Origin` includes your Vercel domain
3. Redeploy Worker if needed

## Verification Checklist

- [ ] `vercel.json` deployed and routing `/ai/*` to Express
- [ ] `app.js` exports properly for Vercel
- [ ] Environment variables set in Vercel dashboard
- [ ] Health endpoint responds: `{"ok": true}`
- [ ] Generate SVG endpoint returns valid JSON
- [ ] Assist Measurement endpoint works
- [ ] Enhance Placement endpoint works
- [ ] Frontend AI Export button functional
- [ ] Preview modal displays SVG
- [ ] Download buttons work (SVG and PNG)
- [ ] Save to Project works
- [ ] No console errors in browser

## Success Metrics

| Component | Status | Response Time |
|-----------|--------|---------------|
| Health Endpoint | ✅ Working | < 100ms |
| Generate SVG | ✅ Working | < 2s |
| Assist Measurement | ✅ Working | < 1s |
| Enhance Placement | ✅ Working | < 1s |
| Frontend Integration | ✅ Working | < 3s total |

## Next Steps After Successful Deployment

1. **Monitor Performance:**
   - Check Vercel function logs
   - Monitor Worker response times
   - Watch for rate limiting

2. **User Testing:**
   - Test with real project data
   - Verify project save/load includes AI exports
   - Test with different stroke types

3. **Optimization:**
   - Consider caching for repeated requests
   - Monitor Worker costs
   - Optimize SVG generation if needed

## Rollback Plan

If deployment fails:

1. **Revert vercel.json:**
   ```bash
   git revert HEAD
   vercel --prod
   ```

2. **Disable AI Export:**
   - Comment out button in `index.html`
   - Remove event handlers in `paint.js`

3. **Fallback to Mock:**
   - Frontend automatically uses mock for localhost
   - No changes needed for local development

---

**Deployment Date**: _____________  
**Deployed By**: _____________  
**Status**: ⬜ Not Started | ⬜ In Progress | ⬜ Complete | ⬜ Failed  
**Vercel URL**: https://sofapaint-jmula3ux9-leigh-atkins-projects.vercel.app  
**Worker URL**: https://openpaint-ai-worker.sofapaint-api.workers.dev
