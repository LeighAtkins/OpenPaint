# OpenPaint HEIC Converter - Setup Guide

## Quick Setup Steps

### 1. Set Up Cloudinary (Free Account)

1. Go to https://cloudinary.com/users/register/free
2. Sign up for a free account
3. After login, you'll see your **Cloud Name** in the dashboard (e.g., `dxyz123abc`)
4. Go to **Settings** → **Upload** → **Upload presets**
5. Click **Add upload preset**
6. Name it (e.g., `openpaint-heic-converter`)
7. Set **Signing mode** to **Unsigned** (important!)
8. Under **Upload manipulations**, set:
   - **Format**: `jpg` (or leave blank for auto)
   - **Quality**: `auto:good`
9. Click **Save**

### 2. Configure Worker Secrets

Run these commands in the `openpaint-heic-converter` directory:

```bash
# Set your Cloudinary Cloud Name
wrangler secret put CLOUDINARY_CLOUD_NAME
# When prompted, paste your Cloud Name (e.g., dxyz123abc)

# Set your Upload Preset name
wrangler secret put CLOUDINARY_UPLOAD_PRESET
# When prompted, paste your preset name (e.g., openpaint-heic-converter)
```

### 3. Test Locally (Optional)

```bash
npm run dev
```

This starts a local development server. You can test it with:

```bash
curl -X POST http://localhost:8787 \
  -F "file=@test-image.heic" \
  -o converted.jpg
```

### 4. Deploy to Cloudflare

```bash
npm run deploy
```

After deployment, you'll see a URL like:
```
https://openpaint-heic-converter.YOUR_SUBDOMAIN.workers.dev
```

### 5. Configure OpenPaint

Add the Worker URL to your OpenPaint `index.html`:

**Option 1: HTML attribute (Recommended)**
```html
<body data-heic-worker-url="https://openpaint-heic-converter.YOUR_SUBDOMAIN.workers.dev">
```

**Option 2: JavaScript variable**
Add this before your app initialization:
```javascript
window.HEIC_WORKER_URL = 'https://openpaint-heic-converter.YOUR_SUBDOMAIN.workers.dev';
```

## Testing

1. Upload a HEIC file through OpenPaint
2. Check the browser console for any errors
3. The image should convert and appear on the canvas

## Troubleshooting

### "HEIC conversion not configured"
- Make sure you've set both secrets: `CLOUDINARY_CLOUD_NAME` and `CLOUDINARY_UPLOAD_PRESET`
- Verify secrets: `wrangler secret list`

### CORS Errors
- The Worker already includes CORS headers, but if you see errors, check the browser console
- Make sure the Worker URL is correct

### Cloudinary Errors
- Verify your Cloud Name is correct
- Make sure your Upload Preset is set to **Unsigned**
- Check Cloudinary dashboard for upload limits (free tier: 25GB storage, 25GB bandwidth/month)

### Worker Not Found
- Make sure you deployed: `npm run deploy`
- Check the URL matches what's in your OpenPaint config

## Cloudinary Free Tier Limits

- **Storage**: 25GB
- **Bandwidth**: 25GB/month
- **Transformations**: Unlimited
- **Uploads**: Unlimited

For most users, this is plenty! If you exceed limits, consider upgrading or implementing caching.

