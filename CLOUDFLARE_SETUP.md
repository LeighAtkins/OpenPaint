# Cloudflare Worker Setup for HEIC Conversion

This guide walks you through setting up a Cloudflare Worker to convert HEIC/HEIF images to JPEG/PNG for OpenPaint.

## Prerequisites

- A Cloudflare account (free tier works)
- Node.js and npm installed locally
- Wrangler CLI installed (`npm install -g wrangler`)

## Step 1: Create a New Worker Project

```bash
# Create a new directory for your worker
mkdir openpaint-heic-converter
cd openpaint-heic-converter

# Initialize a new Worker project
wrangler init
```

When prompted:
- **Name**: `openpaint-heic-converter` (or your preferred name)
- **Type**: Choose "Hello World" template (we'll replace it)

## Step 2: Install Required Dependencies

The Worker needs a library to convert HEIC files. We'll use `heic2any` via a WebAssembly build:

```bash
npm install heic2any
```

**Note**: `heic2any` uses WebAssembly, which works in Cloudflare Workers. However, you may need to use a compatible build or bundle it properly.

Alternatively, you can use `heic-convert` or another HEIC conversion library that works in the Workers runtime.

## Step 3: Create the Worker Code

Replace the contents of `src/index.ts` (or `src/index.js` if using JavaScript) with:

```typescript
// src/index.ts
export default {
  async fetch(request: Request): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // Only accept POST requests
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    try {
      // Get the uploaded file from FormData
      const formData = await request.formData();
      const file = formData.get('file') as File;

      if (!file) {
        return new Response(
          JSON.stringify({ error: 'No file provided' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Check if it's a HEIC/HEIF file
      const isHeic = file.type === 'image/heic' || 
                     file.type === 'image/heif' ||
                     file.name.toLowerCase().endsWith('.heic') ||
                     file.name.toLowerCase().endsWith('.heif');

      if (!isHeic) {
        return new Response(
          JSON.stringify({ error: 'File is not a HEIC/HEIF image' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Convert HEIC to JPEG
      // Note: You'll need to import heic2any or use a compatible library
      const arrayBuffer = await file.arrayBuffer();
      
      // For this example, we'll use a simple approach with heic2any
      // You may need to adjust based on the library you choose
      const convertedBlob = await convertHeicToJpeg(arrayBuffer);

      // Return the converted image
      return new Response(convertedBlob, {
        headers: {
          'Content-Type': 'image/jpeg',
          'Access-Control-Allow-Origin': '*',
          'Content-Disposition': `inline; filename="${file.name.replace(/\.heic?$/i, '.jpg')}"`,
        },
      });
    } catch (error) {
      console.error('Conversion error:', error);
      return new Response(
        JSON.stringify({ 
          error: 'Conversion failed', 
          message: error instanceof Error ? error.message : 'Unknown error' 
        }),
        { 
          status: 500, 
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          } 
        }
      );
    }
  },
};

// Helper function to convert HEIC to JPEG
// This is a placeholder - you'll need to implement based on your chosen library
async function convertHeicToJpeg(arrayBuffer: ArrayBuffer): Promise<Blob> {
  // Option 1: Use heic2any (requires bundling for Workers)
  // const heic2any = require('heic2any');
  // const result = await heic2any({ blob: new Blob([arrayBuffer]), toType: 'image/jpeg' });
  // return result[0] as Blob;

  // Option 2: Use a WASM-based converter
  // Import and use your chosen WASM module here

  // For now, throw an error to indicate this needs implementation
  throw new Error('HEIC conversion not yet implemented. Please configure a conversion library.');
}
```

## Step 4: Alternative Implementation Using Cloudflare's Image Resizing API

If you want a simpler approach, you can use Cloudflare's built-in image resizing capabilities, but note that **Cloudflare Images API doesn't directly support HEIC conversion**. 

Instead, consider using a service like:

1. **Cloudflare Workers + Sharp** (if Sharp works in Workers - it may not due to native dependencies)
2. **A third-party API** (like Cloudinary, Imgix, etc.)
3. **A WASM-based converter** that works in Workers

## Step 5: Recommended Approach - Using a WASM Converter

The most reliable approach for Cloudflare Workers is to use a WebAssembly-based HEIC converter:

### Option A: Use `heic2any` with proper bundling

```bash
npm install heic2any
```

Then in your Worker code, you'll need to ensure it's bundled correctly. You may need to use `esbuild` or `webpack` to bundle the library.

### Option B: Use a simpler service (Recommended for MVP)

For a quick MVP, you can proxy to a free HEIC conversion API or use a service like:

- **Cloudinary** (has a free tier)
- **Imgix** (paid)
- **ImageKit** (has a free tier)

Example using Cloudinary (requires Cloudinary account):

```typescript
// src/index.ts
export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    try {
      const formData = await request.formData();
      const file = formData.get('file') as File;

      if (!file) {
        return new Response(
          JSON.stringify({ error: 'No file provided' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Upload to Cloudinary and convert
      const cloudinaryUrl = `https://api.cloudinary.com/v1_1/YOUR_CLOUD_NAME/image/upload`;
      const cloudinaryFormData = new FormData();
      cloudinaryFormData.append('file', file);
      cloudinaryFormData.append('upload_preset', 'YOUR_UPLOAD_PRESET');
      cloudinaryFormData.append('format', 'jpg'); // Convert to JPEG

      const cloudinaryResponse = await fetch(cloudinaryUrl, {
        method: 'POST',
        body: cloudinaryFormData,
      });

      if (!cloudinaryResponse.ok) {
        throw new Error('Cloudinary conversion failed');
      }

      const cloudinaryData = await cloudinaryResponse.json();
      const convertedImageUrl = cloudinaryData.secure_url;

      // Fetch the converted image
      const imageResponse = await fetch(convertedImageUrl);
      const imageBlob = await imageResponse.blob();

      return new Response(imageBlob, {
        headers: {
          'Content-Type': 'image/jpeg',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (error) {
      return new Response(
        JSON.stringify({ 
          error: 'Conversion failed', 
          message: error instanceof Error ? error.message : 'Unknown error' 
        }),
        { 
          status: 500, 
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          } 
        }
      );
    }
  },
};
```

## Step 6: Deploy the Worker

```bash
# Login to Cloudflare (if not already logged in)
wrangler login

# Deploy the worker
wrangler deploy
```

After deployment, you'll get a URL like:
```
https://openpaint-heic-converter.YOUR_SUBDOMAIN.workers.dev
```

## Step 7: Configure OpenPaint

Add the Worker URL to your OpenPaint application. You can do this in one of two ways:

### Option 1: Set in HTML (Recommended)

Add this to your `index.html` `<body>` tag:

```html
<body data-heic-worker-url="https://openpaint-heic-converter.YOUR_SUBDOMAIN.workers.dev/convert">
```

### Option 2: Set in JavaScript

Add this before your main app initialization:

```javascript
window.HEIC_WORKER_URL = 'https://openpaint-heic-converter.YOUR_SUBDOMAIN.workers.dev/convert';
```

## Step 8: Test the Setup

1. Upload a HEIC file through OpenPaint
2. Check the browser console for any errors
3. Verify the image appears on the canvas

## Troubleshooting

### CORS Issues
If you see CORS errors, ensure your Worker returns the proper CORS headers (as shown in the examples above).

### Conversion Fails
- Check the Worker logs: `wrangler tail`
- Verify the file is actually a HEIC file
- Ensure your conversion library is properly bundled for Workers

### Worker Timeout
Cloudflare Workers have execution time limits. For large files, you may need to:
- Use a different conversion approach
- Implement chunked processing
- Use a different service

## Alternative: Use a Pre-built Service

If setting up your own Worker is too complex, consider using:
- **Cloudinary** (free tier: 25GB storage, 25GB bandwidth/month)
- **ImageKit** (free tier available)
- **ImgBB API** (free, but may have limitations)

These services can handle HEIC conversion without you needing to manage the conversion logic.

## Next Steps

Once your Worker is deployed and configured:
1. Test with various HEIC file sizes
2. Monitor Worker usage in Cloudflare dashboard
3. Set up error alerts if needed
4. Consider caching converted images if you expect repeat uploads

