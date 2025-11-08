/**
 * Isolated Vercel Serverless API Entry
 * Minimal Express app for API endpoints only - no client imports
 */

const express = require('express');
const app = express();

// Middleware
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ extended: true, limit: '200mb' }));

/**
 * Health check endpoint with environment configuration status
 */
app.get('/api/healthz', (req, res) => {
  res.json({
    ok: true,
    node: process.version,
    REMBG_ORIGIN: !!process.env.REMBG_ORIGIN,
    CF_API_KEY: !!process.env.CF_API_KEY,
    timestamp: Date.now()
  });
});

/**
 * RemoveBG Direct Upload Proxy Endpoint
 * Forwards requests to Cloudflare Worker for direct upload URL generation
 */
app.post('/api/images/direct-upload', async (req, res) => {
  try {
    const origin = process.env.REMBG_ORIGIN;
    if (!origin) {
      console.error('[RemoveBG] REMBG_ORIGIN not set');
      return res.status(500).json({ error: 'REMBG_ORIGIN not configured' });
    }

    console.log('[RemoveBG] Forwarding direct-upload request to Worker:', origin);

    const workerUrl = `${origin}/images/direct-upload`;

    // Use built-in fetch (Node.js 18+)
    const r = await fetch(workerUrl, {
      method: 'POST',
      headers: {
        'x-api-key': process.env.CF_API_KEY || 'dev-secret',
        'Content-Type': 'application/json'
      }
    });

    const text = await r.text();

    // Always try to return JSON; if not JSON, wrap as error
    try {
      const json = JSON.parse(text);
      console.log('[RemoveBG] Worker response status:', r.status, 'success:', json.success);
      return res.status(r.status).json(json);
    } catch (parseError) {
      console.error('[RemoveBG] Worker returned non-JSON:', text.slice(0, 200));
      return res.status(r.status).json({
        error: 'upstream_non_json',
        status: r.status,
        body: text.slice(0, 200)
      });
    }
  } catch (e) {
    console.error('[RemoveBG] Proxy error:', e);
    return res.status(500).json({
      error: 'vercel_proxy_error',
      message: String(e)
    });
  }
});

/**
 * Basic health check
 */
app.get('/health', (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

/**
 * Version endpoint
 */
app.get('/version', (req, res) => {
  res.json({
    commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
    ts: Date.now()
  });
});

// Export for Vercel serverless
module.exports = app;
