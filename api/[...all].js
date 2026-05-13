import app from '../app.js';

export default function handler(req, res) {
  console.log('[...all] received:', req.method, req.url);
  // Keep /api-prefixed URLs for the main app server.
  // Wallet/pets vanity paths are rewritten here, so normalize them to /api/*.
  if (req.url.startsWith('/wallet') || req.url.startsWith('/pets')) {
    req.url = `/api${req.url}`;
  }
  console.log('[...all] forwarding to Express:', req.method, req.url);
  return app(req, res);
}
