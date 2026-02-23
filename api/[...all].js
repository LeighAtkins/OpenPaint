import app from '../server/app.js';

export default function handler(req, res) {
  console.log('[...all] received:', req.method, req.url);
  // Vercel calls this at /api/*; Express should see the path WITHOUT /api
  // Also handle non-/api routes (like /wallet)
  if (req.url.startsWith('/api')) {
    req.url = req.url.slice(4) || '/';
  }
  console.log('[...all] forwarding to Express:', req.method, req.url);
  return app(req, res);
}
