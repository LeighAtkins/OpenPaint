# CRITICAL: Remove Preview Build Blocker from Vercel Dashboard

## The Problem

Your build logs show this line is still executing:
```
Running "if [ "$VERCEL_ENV" == "preview" ]; then exit 1; else exit 0; fi"
```

This preview blocker is **configured in Vercel's Dashboard**, not in your code. It's causing builds to use legacy runtime resolution, which triggers the error:
```
Error: Function Runtimes must have a valid version, for example `now-php@1.0.0`
```

## The Solution

You **must** remove this command from your Vercel Dashboard settings:

### Step 1: Go to Vercel Dashboard
1. Open https://vercel.com
2. Navigate to your OpenPaint project
3. Click **Settings** (in the top navigation)

### Step 2: Navigate to Build & Development Settings
1. In the left sidebar, click **General**
2. Scroll down to **Build & Development Settings**

### Step 3: Remove the Preview Blocker
Look for these fields and clear any commands that contain `exit 1`:

**Ignored Build Step**
- Current value likely: `if [ "$VERCEL_ENV" == "preview" ]; then exit 1; else exit 0; fi`
- **Action**: Delete this entire command
- **New value**: Leave it empty OR set to `git diff HEAD^ HEAD --quiet .`

**Install Command**
- **Action**: Ensure it's empty or just `npm install`

**Build Command**
- **Action**: Ensure it's empty or just `npm run build` (if you have a build script)

### Step 4: Save and Redeploy
1. Click **Save** at the bottom of the settings page
2. Go to **Deployments** tab
3. Click the **⋯** (three dots) on the latest deployment
4. Select **Redeploy**
5. Check **Use existing Build Cache**
6. Click **Redeploy**

## What This Command Does (Why It's Breaking)

The command `if [ "$VERCEL_ENV" == "preview" ]; then exit 1; fi` tells Vercel:
- "If this is a preview deployment, exit with error code 1"
- This stops the build process early
- The early exit confuses Vercel's runtime detection
- Result: Legacy runtime resolver activates → error

## After Fixing

Once removed, your builds should:
1. ✅ Complete without legacy runtime errors
2. ✅ Auto-detect Node.js 22.x runtime
3. ✅ Deploy `/api/app.js` as a serverless function
4. ✅ Return proper responses from `/api/healthz`

## Verification

After redeploying, check:

```bash
# Should return 200 with JSON
curl https://your-domain.vercel.app/api/healthz
```

Expected response:
```json
{
  "ok": true,
  "node": "v22.x.x",
  "REMBG_ORIGIN": true,
  "CF_API_KEY": true,
  "timestamp": 1234567890
}
```

## If Still Failing

If you still see the error after removing the preview blocker:

1. Double-check the Ignored Build Step field is completely empty
2. Try setting it to: `git diff HEAD^ HEAD --quiet .` (this is a safe alternative)
3. Clear build cache and redeploy with fresh build
4. Check for any custom GitHub Actions or build scripts that might be setting `VERCEL_ENV`

## Need Help?

If issues persist, share:
1. Screenshot of your Build & Development Settings page
2. Full build logs from the failing deployment
3. Output of: `curl -si https://your-domain.vercel.app/api/healthz`
