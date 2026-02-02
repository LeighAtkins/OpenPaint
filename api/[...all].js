import app from '../server/app.js';

export default function handler(req, res) {
  // Vercel calls this at /api/*; Express should see the path WITHOUT /api
  if (req.url.startsWith('/api')) {
    req.url = req.url.slice(4) || '/';
  }
  return app(req, res);
}
