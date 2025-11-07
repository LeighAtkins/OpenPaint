# SofaPaint API - Cloudflare Worker

This Cloudflare Worker provides backend services for OpenPaint's background removal feature using Cloudflare Images API.

## Features

- **Direct Upload**: Generates signed upload URLs for Cloudflare Images
- **Background Removal**: Uses Cloudflare Images transform to remove backgrounds from images

## Deployment

### Prerequisites

1. Cloudflare account with Images enabled
2. Node.js 18+ installed
3. Wrangler CLI installed (`npm install -g wrangler`)

### Required Secrets

The worker requires one secret to be configured:

```bash
# Set the Cloudflare Images API token
wrangler secret put IMAGES_API_TOKEN
```

**To create the API token:**

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/) > My Profile > API Tokens
2. Click "Create Token"
3. Use the "Edit Cloudflare Images" template or create a custom token with:
   - **Permissions**: `Cloudflare Images:Edit`
   - **Account Resources**: `Include > Your Account`
4. Copy the generated token and paste it when running `wrangler secret put IMAGES_API_TOKEN`

### Environment Variables

The following variables are configured in `wrangler.toml`:

- `CF_ACCOUNT_ID`: Your Cloudflare account ID (found in dashboard)
- `ALLOWED_ORIGINS`: Comma-separated list of allowed CORS origins
- `ACCOUNT_HASH`: Your Cloudflare Images account hash (from imagedelivery.net URLs)

### Deploy

```bash
cd sofapaint-api
npm install
wrangler deploy
```

## API Endpoints

### POST /images/direct-upload

Returns a direct upload URL for uploading images to Cloudflare Images.

**Request:**
```bash
curl -X POST https://your-worker.workers.dev/images/direct-upload \
  -H "x-api-key: dev-secret"
```

**Response:**
```json
{
  "success": true,
  "result": {
    "uploadURL": "https://upload.imagedelivery.net/...",
    "id": "..."
  }
}
```

### POST /remove-background

Removes the background from an image using Cloudflare Images transform.

**Request:**
```bash
curl -X POST https://your-worker.workers.dev/remove-background \
  -H "Content-Type: application/json" \
  -H "x-api-key: dev-secret" \
  -d '{"imageId": "abc123", "return": "url"}'
```

**Parameters:**
- `imageId` (required): The Cloudflare Images ID
- `return` (optional): Either "url" (default) or "bytes"
  - "url": Returns a new Cloudflare Images URL with background removed
  - "bytes": Returns the PNG bytes directly

**Response (return: "url"):**
```json
{
  "success": true,
  "id": "new-image-id",
  "cutoutUrl": "https://imagedelivery.net/.../public",
  "processed": true
}
```

## Local Development

```bash
npm run dev
```

This starts a local development server at `http://localhost:8787`

## Testing

```bash
npm test
```

## Troubleshooting

### "unauthorized" error
- Check that the `x-api-key: dev-secret` header is included in requests
- For production, replace with proper JWT/HMAC authentication

### "missing_imageId" error
- Ensure the `imageId` parameter is included in the `/remove-background` request

### "fetch_source_failed" error
- Verify the `ACCOUNT_HASH` in `wrangler.toml` is correct
- Check that the image ID exists in Cloudflare Images

### "reupload_failed" error
- Verify `IMAGES_API_TOKEN` secret is set correctly
- Check that the token has `Cloudflare Images:Edit` permissions
- Ensure the `CF_ACCOUNT_ID` in `wrangler.toml` is correct
