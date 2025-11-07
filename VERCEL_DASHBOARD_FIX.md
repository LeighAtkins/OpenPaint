# ⚠️ CRITICAL: Vercel Dashboard Manual Fixes Required

## Error: "Function Runtimes must have a valid version"

This error indicates **legacy builder configuration is still active in Vercel's dashboard**, even though the code is now clean.

---

## 🔧 Required Manual Actions in Vercel Dashboard

### 1. Remove Preview Build Blocker ⚠️ **HIGHEST PRIORITY**

**Location:** Project Settings → Git → Ignored Build Step

**Current (problematic) command:**
```bash
if [ "$VERCEL_ENV" == "preview" ]; then exit 1; fi
```

**Action:**
- **DELETE** this command entirely
- Leave the field **empty** to allow all builds
- OR use: `exit 0` to allow all builds
- Click **Save**

**Why this matters:**
- This command forces preview builds to fail immediately
- It prevents proper testing of changes before production
- It hides real build errors

---

### 2. Clear Custom Build Commands ⚠️ **HIGH PRIORITY**

**Location:** Project Settings → General → Build & Development Settings

**Check these fields and set to defaults:**

| Field | Current (check) | Should Be |
|-------|----------------|-----------|
| **Framework Preset** | Check current value | `Other` |
| **Build Command** | Check for exit statements | `npm run vercel-build` |
| **Output Directory** | Check current value | _(leave empty)_ |
| **Install Command** | Check for exit statements | `npm install` |
| **Development Command** | Check current value | `npm run dev` |

**⚠️ Remove ANY commands containing:**
- `exit 1`
- `exit` with conditions
- Preview environment checks
- Build skipping logic

---

### 3. Set Environment Variables ⚠️ **REQUIRED**

**Location:** Project Settings → Environment Variables

| Variable | Value | Environments |
|----------|-------|--------------|
| `REMBG_ORIGIN` | `https://sofapaint-api.sofapaint-api.workers.dev` | ✅ Production ✅ Preview |

**How to add:**
1. Click "Add New"
2. Name: `REMBG_ORIGIN`
3. Value: `https://sofapaint-api.sofapaint-api.workers.dev`
4. Select: ✅ Production ✅ Preview ✅ Development
5. Click **Save**

---

### 4. Trigger Clean Redeploy

After making the above changes:

**Option A: Via Dashboard**
1. Go to **Deployments** tab
2. Find the latest deployment
3. Click **"..."** → **Redeploy**
4. Monitor build logs

**Option B: Via Git**
```bash
# Make a trivial change to trigger rebuild
git commit --allow-empty -m "trigger: force Vercel redeploy with clean config"
git push
```

---

## 🔍 Verify Dashboard Settings

### Before Redeploying - Checklist

- [ ] Ignored Build Step is **empty** or returns `exit 0`
- [ ] Build Command is `npm run vercel-build` with **no exit statements**
- [ ] Install Command is `npm install` with **no exit statements**
- [ ] Framework Preset is `Other`
- [ ] `REMBG_ORIGIN` environment variable is set for **all environments**
- [ ] No legacy "Now" or old builder settings visible

### During Build - Watch For

**Good signs in build logs:**
```
Installing dependencies...
npm install
Running "npm run vercel-build"...
≈ tailwindcss v4.1.17
Done in 166ms
Build Completed
```

**Bad signs (indicates issue still present):**
```
Error: Function Runtimes must have a valid version
preview build skipped via Ignored Build Step
exit code 1
```

---

## 🧪 Post-Deployment Validation

After successful deployment, test these endpoints:

### Test 1: Root page loads
```bash
curl -I https://your-domain.vercel.app/
```
**Expected:** `HTTP/2 200` with `content-type: text/html`

### Test 2: Static CSS serves
```bash
curl -I https://your-domain.vercel.app/css/tailwind.build.css
```
**Expected:** `HTTP/2 200` with `content-type: text/css`

### Test 3: Favicon (previously 500)
```bash
curl -I https://your-domain.vercel.app/favicon.ico
```
**Expected:** `HTTP/2 200` with `content-type: image/x-icon`

### Test 4: API endpoint
```bash
curl https://your-domain.vercel.app/api/images/direct-upload \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{}'
```
**Expected:** JSON response (not 404 or 500)

---

## 🚨 If Build Still Fails

### Check Build Logs For:

1. **"builds" array warning:**
   ```
   Warning: Project Settings do not apply due to "builds" in vercel.json
   ```
   **Solution:** Verify vercel.json has NO "builds" key (already fixed in code)

2. **"now-" or "@now/" references:**
   ```
   Error: Unknown builder @now/node
   ```
   **Solution:** These should not appear - if they do, contact Vercel support

3. **Permission errors:**
   ```
   EACCES: permission denied
   ```
   **Solution:** Check that Output Directory is empty (for root serving)

4. **Module not found:**
   ```
   Cannot find module 'xyz'
   ```
   **Solution:** Run `npm install` locally to verify package.json

---

## 🎯 Root Cause Summary

**The problem:**
- Vercel caches project configuration beyond just the code
- Even with clean vercel.json, dashboard settings can override or conflict
- Preview build blockers hide real errors
- Legacy builder references persist in Vercel's internal config

**The solution:**
- Clean dashboard settings manually
- Remove all preview build guards
- Force a fresh deployment after cleanup
- Verify environment variables are set

---

## 📞 Escalation Path

If after all above steps the build still fails:

1. **Vercel Support:**
   - Contact via dashboard: Help → Contact Support
   - Mention: "Legacy builder error despite clean vercel.json"
   - Reference this deployment: `[your deployment URL]`

2. **Nuclear Option - Project Reset:**
   ```bash
   # WARNING: This removes all Vercel project config
   # Create new Vercel project from scratch
   vercel link --yes
   # Re-set all environment variables
   # Deploy
   vercel --prod
   ```

---

## ✅ Success Indicators

You'll know it's fixed when:
- ✅ Build logs show no warnings about legacy builders
- ✅ Build completes in < 2 minutes
- ✅ Deployment shows "Ready" status
- ✅ All 4 smoke tests pass
- ✅ Browser console shows no 500 errors
- ✅ REMBG background removal feature works end-to-end

---

**Current Code Status:** ✅ **CLEAN** - All legacy config removed from repository
**Dashboard Status:** ⚠️ **NEEDS MANUAL FIX** - Follow steps above
**Next Action:** Go to Vercel Dashboard and apply sections 1-3 above
