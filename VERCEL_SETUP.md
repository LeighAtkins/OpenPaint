# Vercel Deployment Setup

This document provides instructions for configuring environment variables required for deploying OpenPaint on Vercel.

## Required Environment Variables

### Background Removal Service

For the background removal feature to work, you must configure the following environment variables in your Vercel project:

#### REMBG_ORIGIN (Required)
- **Value**: `https://sofapaint-api.sofapaint-api.workers.dev`
- **Description**: URL of the Cloudflare Worker that handles background removal
- **Environments**: Production, Preview, Development

#### CF_API_KEY (Optional)
- **Value**: Your Cloudflare Worker API key (default: `dev-secret`)
- **Description**: API key for authenticating requests to the Cloudflare Worker
- **Environments**: Production, Preview, Development

## Setting Environment Variables via Vercel Dashboard

1. Go to your Vercel project dashboard
2. Navigate to **Settings** → **Environment Variables**
3. Add each variable:
   - **Name**: `REMBG_ORIGIN`
   - **Value**: `https://sofapaint-api.sofapaint-api.workers.dev`
   - **Environments**: Check all three (Production, Preview, Development)
4. Click **Save**
5. Redeploy your application for changes to take effect

## Setting Environment Variables via Vercel CLI

```bash
# From your project root
vercel env add REMBG_ORIGIN production
# When prompted, paste: https://sofapaint-api.sofapaint-api.workers.dev

vercel env add REMBG_ORIGIN preview
# When prompted, paste: https://sofapaint-api.sofapaint-api.workers.dev

vercel env add REMBG_ORIGIN development
# When prompted, paste: https://sofapaint-api.sofapaint-api.workers.dev

# Deploy with new environment variables
vercel deploy --prod
```

## Verification

After setting up the environment variables and redeploying:

### 1. Check Health Endpoint
```bash
curl -s https://<your-vercel-domain>/api/healthz
```

Expected response:
```json
{
  "ok": true,
  "REMBG_ORIGIN": true,
  "CF_API_KEY": true,
  "timestamp": 1234567890
}
```

### 2. Test Direct Upload Endpoint
```bash
curl -si -X POST https://<your-vercel-domain>/api/images/direct-upload | head -n 20
```

Expected response:
- HTTP status: `200 OK`
- Content-Type: `application/json`
- Body should contain `result.uploadURL`

## Common Issues

### 500 Error: "REMBG_ORIGIN not configured"
- **Cause**: Environment variable not set or not applied to the correct environment
- **Solution**:
  1. Verify variable is set for all three environments (Production, Preview, Development)
  2. Redeploy your application
  3. Check deployment logs for confirmation

### SyntaxError: Unexpected token in JSON
- **Cause**: Vercel proxy returned HTML/text instead of JSON (usually due to missing env var)
- **Solution**:
  1. Set REMBG_ORIGIN environment variable
  2. Check `/api/healthz` to confirm configuration
  3. Review Vercel function logs for detailed error messages

### Variable Set at Wrong Level
- **Mistake**: Setting variable at team level instead of project level
- **Solution**: Ensure variable is set in **Project Settings**, not team settings

## Monitoring

To view logs and debug issues:

1. Go to Vercel Dashboard → Deployments
2. Select your deployment
3. Click on **Functions** tab
4. Select the API function
5. View real-time logs showing upstream status and errors

## Additional Resources

- [Vercel Environment Variables Documentation](https://vercel.com/docs/concepts/projects/environment-variables)
- [OpenPaint Documentation](./README.md)
