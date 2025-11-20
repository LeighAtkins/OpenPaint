# Quick Start - HEIC Converter Setup

## ✅ Code is Ready!

The Worker code has been set up. Now follow these steps:

## Step 1: Set Up Cloudinary (5 minutes)

1. **Sign up**: https://cloudinary.com/users/register/free
2. **Get Cloud Name**: After login, copy your Cloud Name from the dashboard (e.g., `dxyz123abc`)
3. **Create Upload Preset**:
   - Go to **Settings** → **Upload** → **Upload presets**
   - Click **Add upload preset**
   - Name: `openpaint-heic-converter`
   - **Signing mode**: **Unsigned** ⚠️ (important!)
   - **Format**: `jpg`
   - **Quality**: `auto:good`
   - Click **Save**

## Step 2: Configure Secrets

In the `openpaint-heic-converter` directory, run:

```bash
# Set Cloud Name
wrangler secret put CLOUDINARY_CLOUD_NAME
# Paste your Cloud Name when prompted

# Set Upload Preset
wrangler secret put CLOUDINARY_UPLOAD_PRESET
# Paste: openpaint-heic-converter (or your preset name)
```

## Step 3: Deploy

```bash
npm run deploy
```

Copy the URL it gives you (e.g., `https://openpaint-heic-converter.YOUR_SUBDOMAIN.workers.dev`)

## Step 4: Add to OpenPaint

In your OpenPaint `index.html`, add the Worker URL to the `<body>` tag:

```html
<body data-heic-worker-url="https://openpaint-heic-converter.YOUR_SUBDOMAIN.workers.dev">
```

## Done! 🎉

Now upload a HEIC file through OpenPaint and it should convert automatically.

---

**Need help?** See `SETUP.md` for detailed instructions and troubleshooting.

