# OpenPaint Deployment Guide

## 1. Vercel Deployment

### Prerequisites

- Node.js 20.x
- Vercel CLI: `npm i -g vercel`
- Git repository connected to Vercel

### Build Configuration

**`vercel.json`** handles routing:

- `/ai/*` and `/api/*` routes are forwarded to `app.js` (Express serverless function)
- `/js/*`, `/css/*`, and static assets are served from the CDN
- All other routes fall through to `index.html` (SPA)

**Build commands** (defined in `package.json`):

| Script | Purpose |
|---|---|
| `npm run build` | Full build: TypeScript compile + Vite build |
| `npm run vercel-build` | Vercel-specific: builds Tailwind CSS only |
| `npm run build:css` | Tailwind CSS compilation |

### Deploy

```bash
# Login (first time)
vercel login

# Production deploy
npm run deploy        # or: vercel --prod

# Preview deploy
npm run deploy:preview  # or: vercel
```

### Key Differences from Local

| Concern | Local | Vercel |
|---|---|---|
| Runtime | Continuous Express server on port 3000 | Serverless functions per route |
| Static files | `express.static()` | Vercel CDN |
| File uploads | `./uploads/` (persistent) | `/tmp/uploads/` (ephemeral, cleared between invocations) |
| Python features | Available via `pip install` | Not available; background removal requires an external service |
| Environment vars | `.env` file or shell | Vercel Dashboard > Settings > Environment Variables |
| Long-running processes | Supported | Not supported (serverless timeout limits) |

### Security Headers

Configured in `vercel.json`:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- CORS headers on API endpoints

---

## 2. Local Development

```bash
# Install dependencies
npm install

# Start the Express server (port 3000)
npm start

# Start Vite dev server (with HMR)
npm run dev

# Simulate Vercel locally
vercel dev
```

The frontend uses mock mode for AI features when running locally (detected by hostname). No API keys are needed for local development.

### Useful Commands

```bash
npm run lint          # Check code style
npm run lint:fix      # Auto-fix lint issues
npm test              # Run tests (vitest)
npm run type-check    # TypeScript type checking
npm run validate      # type-check + lint + test
```

---

## 3. Environment Variables

### Core (Vercel)

| Variable | Required | Description |
|---|---|---|
| `AI_WORKER_URL` | If using AI features | URL of the deployed Cloudflare AI Worker |
| `AI_WORKER_KEY` | If using AI features | Shared secret for authenticating with the AI Worker |

### Cloudflare Images (optional)

| Variable | Required | Description |
|---|---|---|
| `CF_ACCOUNT_ID` | No | Cloudflare account ID |
| `CF_IMAGES_API_TOKEN` | No | Cloudflare Images API token |
| `CF_ACCOUNT_HASH` | No | Cloudflare account hash |

### Cloudflare Worker

| Variable | Required | Description |
|---|---|---|
| `AI_WORKER_KEY` | Yes | Must match the `AI_WORKER_KEY` set on the Vercel side |
| `ENVIRONMENT` | No | Set to `production` in `wrangler.toml` `[vars]` |

Set Vercel environment variables via CLI or dashboard:

```bash
vercel env add AI_WORKER_URL production
vercel env add AI_WORKER_KEY production
```

Set the Worker secret via Wrangler:

```bash
cd worker
wrangler secret put AI_WORKER_KEY
```

---

## 4. AI Worker Integration

### Architecture

```
Browser (frontend)
  |
  |  POST /ai/generate-svg  (no API key)
  v
Vercel (Express relay in app.js)
  |
  |  POST /generate-svg  +  X-API-Key header
  v
Cloudflare Worker (openpaint-ai-worker)
  |
  v
Returns SVG, vectors, measurements
```

The Express relay in `app.js` adds the `X-API-Key` header server-side so the secret is never exposed to the browser. On localhost the frontend uses a built-in mock worker and skips the network entirely.

### Endpoints

| Express Route | Worker Route | Purpose |
|---|---|---|
| `POST /ai/generate-svg` | `/generate-svg` | Generate SVG from canvas strokes |
| `POST /ai/assist-measurement` | `/assist-measurement` | Calculate measurements for a stroke |
| `POST /ai/enhance-placement` | `/enhance-placement` | Optimize label/annotation placement |

The Worker also exposes `GET /health` (no auth required).

### Auth Flow

1. Frontend calls Express relay (e.g. `POST /ai/generate-svg`) -- no API key attached.
2. Express reads `AI_WORKER_KEY` from env and adds it as `X-API-Key` header.
3. Worker checks `X-API-Key` against its own `AI_WORKER_KEY` secret. Returns `401` if missing or wrong.
4. Worker validates input, generates result, sanitizes SVG, and responds.

### Security Measures

- **Rate limiting**: 10 requests/minute per IP on the Express relay.
- **Timeout**: 2-second abort on relay-to-Worker requests.
- **Input validation**: Worker rejects malformed payloads with `400`.
- **SVG sanitization**: Strips `<script>` tags, `on*` event handlers, `javascript:` URLs, and unsafe `data:` URIs.
- **CORS**: Worker returns origin-aware CORS headers. Can be locked to a specific Vercel domain by editing `corsHeaders()` in `worker/src/index.js`.

### Deploying the Worker

```bash
cd worker
npm install
wrangler secret put AI_WORKER_KEY   # enter the shared secret
npm run deploy                       # or: wrangler deploy
```

Verify:

```bash
# Health check (no auth)
curl https://<worker-url>/health

# Should return 401 without key
curl -X POST https://<worker-url>/generate-svg \
  -H "Content-Type: application/json" \
  -d '{"image":{"width":800,"height":600},"strokes":[]}'

# Should succeed with key
curl -X POST https://<worker-url>/generate-svg \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <your-key>" \
  -d '{"image":{"width":800,"height":600},"strokes":[{"id":"t1","type":"straight","points":[{"x":0,"y":0},{"x":100,"y":0}],"color":"#000","width":2}]}'
```

### Worker File Structure

```
worker/
  src/
    index.js          # Entry point, routing, auth, CORS
    svg-generator.js  # SVG generation logic
    geometry.js       # Geometry utilities
    placement.js      # Label placement
    sanitizer.js      # SVG sanitization
  wrangler.toml       # Cloudflare Worker config
  package.json
```

---

## 5. HEIC Conversion

### Current Implementation

HEIC-to-JPEG conversion is handled **client-side** using the `heic2any` library. No server or Worker is involved. This works in modern browsers but can be slow for large files.

### Cloudflare Worker Option (Incomplete)

A Cloudflare Worker for server-side HEIC conversion has been planned but **not fully implemented**. The `convertHeicToJpeg()` function in the Worker scaffold is a placeholder that throws an error.

Viable approaches if you want to implement it:

1. **WASM-based converter** bundled into a Cloudflare Worker (requires careful esbuild/webpack configuration).
2. **Third-party service** (Cloudinary, ImageKit) proxied through a Worker.
3. **Cloudflare Images** -- does not natively support HEIC input.

To integrate a HEIC Worker with OpenPaint, set the Worker URL via:

```html
<body data-heic-worker-url="https://<worker-url>/convert">
```

or:

```javascript
window.HEIC_WORKER_URL = 'https://<worker-url>/convert';
```

---

## 6. URL Sharing

### How It Works

1. Creator clicks "Share Project" and gets a shareable URL.
2. Customer opens the URL, views the project, fills out measurement forms, and submits.
3. Submitted data is stored for the creator to review.

### API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/share-project` | Create a shareable link. Body: `{ projectData, shareOptions }`. Returns `{ shareUrl, shareId, expiresAt }`. |
| `GET` | `/api/shared/:shareId` | Retrieve shared project data. Returns `{ projectData, shareInfo }`. |
| `POST` | `/api/shared/:shareId/measurements` | Submit customer measurements. Body: `{ measurements, customerInfo }`. Returns `{ submissionId, success }`. |
| `GET` | `/shared/:shareId` | HTML page for customer interaction (serves `shared.html`). |

### Current Limitations

- **In-memory storage**: Shared project data is stored in-memory on the server. Data is lost on every restart or new Vercel deployment.
- **Share links expire** after 30 days by default (configurable in `paint.js`).
- **No persistent database** is wired up for sharing. For production use, connect PostgreSQL, MongoDB, or similar.

---

## 7. Troubleshooting

### Vercel Deployment

**405 Method Not Allowed on `/ai/*` routes**
- Ensure `vercel.json` is in the repository root and contains the `/ai/*` -> `/app.js` route.
- Redeploy: `vercel --prod`.

**Environment variables not taking effect**
- Redeploy after setting variables. Vercel caches the previous build.
- Verify with `vercel env ls`.

### AI Worker

**401 Unauthorized from Worker**
- `AI_WORKER_KEY` must match between Vercel env and Worker secret.
- Verify Worker secrets: `cd worker && wrangler secret list`.
- Re-set if needed: `wrangler secret put AI_WORKER_KEY`.

**Timeout / AbortError**
- Default relay timeout is 2 seconds. Increase in `app.js` if needed.
- Check Worker logs: `wrangler tail --name openpaint-ai-worker`.
- Simplify stroke data (fewer points) for faster processing.

**CORS errors in browser console**
- Verify Worker returns `Access-Control-Allow-Origin` on all responses including errors.
- If restricting origins, make sure your Vercel domain is in the allowlist.
- The Worker must handle `OPTIONS` preflight requests without requiring auth.

**Mock mode running in production**
- Check `js/ai-export.js` -- the `USE_MOCK` flag is based on `window.location.hostname`. Ensure it includes your production domain.

### URL Sharing

**Share link not working**
- Link may have expired (30-day default).
- Server may have restarted, clearing in-memory data.
- Check browser console for JavaScript errors.

**Customer cannot submit measurements**
- Verify the shared link is still valid.
- At least one measurement field must be filled.
- JavaScript must be enabled in the customer's browser.

### General

**File uploads disappear on Vercel**
- Vercel uses ephemeral `/tmp` storage. Uploaded files do not persist across invocations. Use external storage (S3, Cloudflare R2, Vercel Blob) for production.

**Python-dependent features unavailable on Vercel**
- Background removal and other Python features require a local server or an external API. They cannot run in Vercel's serverless environment.
