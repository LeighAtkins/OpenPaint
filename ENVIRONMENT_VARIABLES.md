# Environment Variables Configuration

## Vercel Environment Variables

Set these in: **Vercel Dashboard → Your Project → Settings → Environment Variables**

### Required for All Features

| Variable | Value | Description |
|----------|-------|-------------|
| `CF_WORKER_URL` | `https://sofapaint-api.xxx.workers.dev` | Cloudflare worker base URL (for REMBG) |
| `CF_API_KEY` | `dev-secret` | API key for sofapaint-api worker |
| `AI_WORKER_URL` | `https://openpaint-ai-worker.xxx.workers.dev` | AI worker base URL |
| `AI_WORKER_KEY` | `(secure random key)` | API key for AI worker |
| `CF_ACCOUNT_ID` | `665aca072a7cddbc216be6b25a6fd951` | Cloudflare account ID |
| `CF_ACCOUNT_HASH` | `tJVRdWyUXVZJRoGHy-ATBQ` | Cloudflare Images delivery hash |
| `CF_IMAGES_API_TOKEN` | `(your CF Images token)` | Cloudflare Images API token |

### Quick Copy-Paste

After deploying workers, use these (replace `xxx` with your actual subdomain):

```
CF_WORKER_URL=https://sofapaint-api.xxx.workers.dev
CF_API_KEY=dev-secret
AI_WORKER_URL=https://openpaint-ai-worker.xxx.workers.dev
AI_WORKER_KEY=your-ai-worker-key-here
CF_ACCOUNT_ID=665aca072a7cddbc216be6b25a6fd951
CF_ACCOUNT_HASH=tJVRdWyUXVZJRoGHy-ATBQ
CF_IMAGES_API_TOKEN=your-cloudflare-images-token
```

## Cloudflare Worker Secrets

Set these using `wrangler secret put`:

### sofapaint-api (REMBG)

```bash
cd sofapaint-api
wrangler secret put IMAGES_API_TOKEN
# Paste your Cloudflare Images API token
```

### openpaint-ai-worker (AI SVG)

```bash
cd worker
wrangler secret put AI_WORKER_KEY
# Generate with: openssl rand -hex 32
# Save this key! You'll need it for Vercel's AI_WORKER_KEY
```

## Environment Variable Mapping

### Edge Function (api/rembg.ts)
- `CF_WORKER_URL` → sofapaint-api worker URL
- `CF_API_KEY` → 'dev-secret' (matches worker auth)

### Express App (app.js)
- `AI_WORKER_URL` → openpaint-ai-worker URL
- `AI_WORKER_KEY` → Secret key for AI worker
- `CF_ACCOUNT_ID` → For Cloudflare Images operations
- `CF_ACCOUNT_HASH` → For image delivery URLs
- `CF_IMAGES_API_TOKEN` → For image upload operations

## How to Get These Values

### CF_WORKER_URL
After deploying sofapaint-api:
```bash
cd sofapaint-api
wrangler deploy
# Output: ✅ https://sofapaint-api.xxx.workers.dev
```

### AI_WORKER_URL
After deploying openpaint-ai-worker:
```bash
cd worker
wrangler deploy
# Output: ✅ https://openpaint-ai-worker.xxx.workers.dev
```

### CF_API_KEY
This is set in the sofapaint-api worker (`src/index.ts` line 43):
```typescript
if (req.headers.get("x-api-key") !== "dev-secret") {
  return json(env, origin, { error: "unauthorized" }, 401);
}
```
**Value:** `dev-secret`

### AI_WORKER_KEY
Generate a secure random key:
```bash
openssl rand -hex 32
```
**Important:** Use the SAME key when:
1. Setting the worker secret: `wrangler secret put AI_WORKER_KEY`
2. Setting Vercel env var: `AI_WORKER_KEY=...`

### CF_ACCOUNT_ID & CF_ACCOUNT_HASH
These are in `sofapaint-api/wrangler.toml`:
- Account ID: `665aca072a7cddbc216be6b25a6fd951`
- Account Hash: `tJVRdWyUXVZJRoGHy-ATBQ`

### CF_IMAGES_API_TOKEN
1. Go to Cloudflare Dashboard
2. Navigate to: My Profile → API Tokens
3. Create Token with permissions:
   - Account → Cloudflare Images → Edit
4. Copy the generated token

## Verification

After setting all environment variables, verify:

### Check Vercel Environment Variables
```bash
vercel env ls
```

You should see all 7 variables listed.

### Check Worker Secrets
```bash
cd sofapaint-api && wrangler secret list
# Should show: IMAGES_API_TOKEN

cd ../worker && wrangler secret list
# Should show: AI_WORKER_KEY
```

### Test Configuration
```bash
# Test REMBG worker
curl https://sofapaint-api.xxx.workers.dev/health

# Test AI worker
curl https://openpaint-ai-worker.xxx.workers.dev/health
```

## Troubleshooting

### "CF_WORKER_URL not set"
- Check Vercel environment variables
- Ensure the variable name is exactly `CF_WORKER_URL` (not `REMBG_URL`)
- Redeploy Vercel after adding the variable

### "unauthorized" from worker
- Check that `CF_API_KEY=dev-secret` in Vercel
- Verify worker is checking for this exact value

### "Missing IMAGES_API_TOKEN"
- Set the secret in the worker: `cd sofapaint-api && wrangler secret put IMAGES_API_TOKEN`
- Redeploy the worker: `wrangler deploy`

### "AI worker key mismatch"
- Ensure the same key is used in both places:
  - Worker secret: `wrangler secret put AI_WORKER_KEY`
  - Vercel env var: `AI_WORKER_KEY=...`
