const express = require('express');
const path = require('path');
const app = express();

// AI Worker configuration with startup logging
const AI_WORKER_URL = (process.env.AI_WORKER_URL || 'http://localhost:8787')
  .replace(/^\s*-\s*/, '') // strip accidental "- "
  .trim();
const AI_WORKER_KEY = (process.env.AI_WORKER_KEY || '').trim();

console.log('[AI Relay] Using AI_WORKER_URL:', JSON.stringify(AI_WORKER_URL));
console.log('[AI Relay] Has KEY:', AI_WORKER_KEY ? 'yes' : 'no');

function joinUrl(base, path) {
  return `${base.replace(/\/+$/, '')}/${String(path).replace(/^\/+/, '')}`;
}

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Route handlers
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../index.html'));
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/env-check', (req, res) => {
  res.json({
    AI_WORKER_URL: (process.env.AI_WORKER_URL || '').trim(),
    HAS_AI_WORKER_KEY: Boolean((process.env.AI_WORKER_KEY || '').trim()),
    ROUTES_MOUNTED: true
  });
});

// Minimal test endpoint
app.get('/test', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// AI relay endpoints with hardened error handling
app.post('/ai/generate-svg', async (req, res) => {
  try {
    if (!req.body || !req.body.image || !Array.isArray(req.body.strokes)) {
      return res.status(400).json({ error: 'Invalid input: image and strokes required' });
    }

    const target = joinUrl(AI_WORKER_URL, '/generate-svg');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);

    let r, text;
    try {
      r = await fetch(target, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': AI_WORKER_KEY,
          'X-Request-ID': crypto.randomUUID(),
        },
        body: JSON.stringify(req.body),
        signal: controller.signal,
      });
      text = await r.text();
    } catch (e) {
      clearTimeout(timer);
      console.error('[AI Relay] Fetch failed:', e);
      return res.status(502).json({ error: 'Relay fetch failed', detail: String(e) });
    }
    clearTimeout(timer);

    if (!r.ok) {
      console.error('[AI Relay] Worker error:', r.status, text);
      return res.status(r.status).type('application/json').send(text);
    }

    return res.type('application/json').send(text);
  } catch (e) {
    console.error('[AI Relay] Route crash:', e);
    return res.status(500).json({ error: 'Relay crashed', detail: String(e) });
  }
});

// Export for Vercel
module.exports = app;
