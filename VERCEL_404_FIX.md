# Vercel 404 Fix Guide

## Problem

Deployment completed successfully but all routes returned `404 NOT_FOUND`.

```
Build Completed in /vercel/output [31s]
Deploying outputs...
Deployment completed
```

But visiting the site shows 404 errors.

## Root Cause

The build only compiled CSS (`npm run vercel-build` → `npm run build:css`) without properly configuring how Vercel should serve files.

## Solution Applied

Simplified `vercel.json` to minimal modern configuration:

```json
{
  "buildCommand": "npm run vercel-build",
  "cleanUrls": true,
  "rewrites": [
    { "source": "/js/:path*", "destination": "/public/js/:path*" },
    { "source": "/css/:path*", "destination": "/css/:path*" },
    { "source": "/src/:path*", "destination": "/src/:path*" }
  ],
  "headers": [...]
}
```

### How This Should Work

1. **Static Files:** `index.html` at root is served by default at `/`
2. **API Routes:** `api/` directory auto-detected as serverless functions
3. **Rewrites:** Map `/js/*` → `/public/js/*`, etc.
4. **CSS Build:** `buildCommand` compiles Tailwind to `/css/tailwind.build.css`

## If Still Getting 404s

If the simplified config doesn't work, you may need to use Vercel Output v3:

### Option: Add Output Directory

If Vercel can't find your files, explicitly tell it where they are:

```json
{
  "buildCommand": "npm run vercel-build",
  "outputDirectory": ".",
  "cleanUrls": true,
  "rewrites": [...]
}
```

The `outputDirectory: "."` tells Vercel to serve files from the root directory.

### Option: Create Build Script

If that doesn't work, create a proper build script that ensures files are in place:

**package.json:**
```json
{
  "scripts": {
    "build": "npm run build:css",
    "build:css": "npx --yes @tailwindcss/cli -i ./css/tailwind.css -o ./css/tailwind.build.css --minify"
  }
}
```

**vercel.json:**
```json
{
  "cleanUrls": true,
  "rewrites": [
    { "source": "/js/:path*", "destination": "/public/js/:path*" },
    { "source": "/css/:path*", "destination": "/css/:path*" }
  ]
}
```

Remove `buildCommand` and let Vercel use the default `build` script.

## File Structure

Your project has:
```
/
├── index.html           (root entry point)
├── css/
│   └── tailwind.build.css (built by vercel-build)
├── public/
│   ├── js/
│   └── favicon.ico
├── api/
│   └── images/
│       └── direct-upload.js (serverless function)
└── server/
    └── app.js (Express app used by API routes)
```

## Testing

After deployment, test these URLs:

1. **Root:** `https://your-app.vercel.app/`
   - Should serve `index.html`

2. **CSS:** `https://your-app.vercel.app/css/tailwind.build.css`
   - Should serve compiled CSS

3. **JS:** `https://your-app.vercel.app/js/paint.js`
   - Should serve `/public/js/paint.js`

4. **API:** `https://your-app.vercel.app/api/images/direct-upload`
   - Should respond (may need proper request body)

## Debugging

### Check Vercel Build Logs

Look for:
- ✅ "Build Completed" message
- ✅ Files being deployed
- ❌ Any warnings about missing files

### Check Vercel Function Logs

If API routes 404:
- Go to Vercel Dashboard → Functions tab
- Check if `api/images/direct-upload` is listed
- View runtime logs for errors

### Check Static File Serving

If `/js/paint.js` returns 404:
- The rewrite might not be working
- Try accessing `/public/js/paint.js` directly
- If that works, the rewrite rule needs adjustment

## Emergency Fallback: Use Routes (Legacy)

If nothing works, fall back to the legacy `routes` pattern:

```json
{
  "version": 2,
  "buildCommand": "npm run vercel-build",
  "routes": [
    { "src": "/js/(.*)", "dest": "/public/js/$1" },
    { "src": "/css/(.*)", "dest": "/css/$1" },
    { "src": "/src/(.*)", "dest": "/src/$1" },
    { "handle": "filesystem" },
    { "src": "/(.*)", "dest": "/index.html" }
  ]
}
```

**Note:** Using `version: 2` with `routes` is legacy but may be more reliable.

## Summary

The fix simplifies the Vercel configuration to let Vercel's defaults handle most of the routing. If you still get 404s after the next deployment, try the options above in this order:

1. Add `outputDirectory: "."`
2. Remove `buildCommand` and use default `build` script
3. Use legacy `routes` pattern with `version: 2`

One of these should work!
