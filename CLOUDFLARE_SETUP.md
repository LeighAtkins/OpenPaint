# Cloudflare Background Removal Setup Guide

This guide walks you through setting up Cloudflare Images API for the background removal feature in OpenPaint.

## Prerequisites

- A Cloudflare account (free tier is sufficient)
- Node.js 18+ and npm installed
- Wrangler CLI installed (`npm install -g wrangler`)

## Step 1: Enable Cloudflare Images

1. Log in to your [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Navigate to **Images** in the left sidebar
3. Click **Enable Images** if not already enabled
4. Note your **Account Hash** - you'll find it in URLs like:
   ```
   https://imagedelivery.net/<YOUR_ACCOUNT_HASH>/...
   ```

## Step 2: Get Your Account ID

1. In the Cloudflare Dashboard, click on any domain (or go to Account Home)
2. Scroll down the right sidebar to find **Account ID**
3. Copy the Account ID (e.g., `665aca072a7cddbc216be6b25a6fd951`)

## Step 3: Create an API Token

1. Go to **My Profile** > **API Tokens** in the Cloudflare Dashboard
2. Click **Create Token**
3. Choose **Edit Cloudflare Images** template (or create custom token)
4. If creating custom:
   - **Permissions**: `Cloudflare Images:Edit`
   - **Account Resources**: Include your specific account
5. Click **Continue to summary** and then **Create Token**
6. **IMPORTANT**: Copy the token immediately - you won't be able to see it again!

## Step 4: Configure the Worker

### 4.1 Update wrangler.toml

Edit `sofapaint-api/wrangler.toml` and verify/update these values:

```toml
[vars]
CF_ACCOUNT_ID = "your-account-id-here"
ALLOWED_ORIGINS = "https://yourdomain.com,http://localhost:3000"
ACCOUNT_HASH = "your-account-hash-here"
```

### 4.2 Set the API Token Secret

In the `sofapaint-api` directory, run:

```bash
cd sofapaint-api
wrangler secret put IMAGES_API_TOKEN
```

When prompted, paste your Cloudflare Images API token.

## Step 5: Deploy the Worker

```bash
cd sofapaint-api
npm install
wrangler deploy
```

After deployment, you'll see an output like:

```
Published sofapaint-api (0.01 sec)
  https://sofapaint-api.your-subdomain.workers.dev
```

## Step 6: Configure the Server

Update your server's environment variables. If deploying to Vercel:

1. Go to your Vercel project settings
2. Navigate to **Environment Variables**
3. Add:
   ```
   REMBG_ORIGIN=https://sofapaint-api.your-subdomain.workers.dev
   ```

For local development, create a `.env` file in the project root:

```bash
REMBG_ORIGIN=https://sofapaint-api.your-subdomain.workers.dev
```

## Step 7: Test the Setup

1. Start your OpenPaint application
2. Load an image
3. Click the **Remove BG** button
4. If successful, you'll see the background removed from your image

## Troubleshooting

### Error: "IMAGES_API_TOKEN is not configured"

**Solution**: Run `wrangler secret put IMAGES_API_TOKEN` in the `sofapaint-api` directory

### Error: "unauthorized"

**Cause**: The API key is incorrect or missing

**Solution**: Verify the worker is using `x-api-key: dev-secret` header

### Error: "Failed to get upload URL" or "cloudflare_api_error"

**Causes**:
- Invalid or expired API token
- Token doesn't have `Cloudflare Images:Edit` permission
- Incorrect Account ID

**Solution**:
1. Verify your Account ID in `wrangler.toml`
2. Recreate the API token with correct permissions
3. Run `wrangler secret put IMAGES_API_TOKEN` again

### Error: "fetch_source_failed"

**Cause**: Incorrect Account Hash or image ID doesn't exist

**Solution**: Verify `ACCOUNT_HASH` in `wrangler.toml` matches your Cloudflare Images account

### The Remove BG button doesn't do anything

**Check**:
1. Open browser console (F12) and look for errors
2. Verify `REMBG_ORIGIN` environment variable is set correctly
3. Test the worker directly:
   ```bash
   curl -X POST https://your-worker.workers.dev/health
   ```

## Cost Considerations

- **Cloudflare Images Pricing**:
  - Free tier: Up to 100,000 images
  - Images stored: $5/month per 100,000 images
  - Images delivered: $1 per 100,000 images

- **Cloudflare Workers Pricing**:
  - Free tier: 100,000 requests per day
  - Paid tier: $5/month for 10 million requests

Most personal/development use cases will stay within the free tier.

## Security Notes

1. **API Key**: The default `dev-secret` key should be replaced with proper authentication (JWT/HMAC) in production
2. **CORS**: Update `ALLOWED_ORIGINS` in `wrangler.toml` to include only your production domains
3. **Secrets**: Never commit the `IMAGES_API_TOKEN` to git - it's stored securely in Cloudflare

## Additional Resources

- [Cloudflare Images Documentation](https://developers.cloudflare.com/images/)
- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Wrangler CLI Reference](https://developers.cloudflare.com/workers/wrangler/)
