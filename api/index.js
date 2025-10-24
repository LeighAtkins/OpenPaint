const express = require('express');
const path = require('path');
const app = express();

// Basic middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files with caching headers
app.use('/js', express.static(path.join(__dirname, '..', 'js'), {
  setHeaders: (res) => res.set('Cache-Control', 'public, max-age=604800, immutable')
}));
app.use('/css', express.static(path.join(__dirname, '..', 'css'), {
  setHeaders: (res) => res.set('Cache-Control', 'public, max-age=604800, immutable')
}));
app.use('/src', express.static(path.join(__dirname, '..', 'src')));
app.use(express.static(path.join(__dirname, '..')));

// Simple test endpoint
app.get("/test", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Health check
app.get("/health", (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// Prevent SPA fallback for missing static assets
app.get(/\.(js|mjs|css|map|json|png|jpg|jpeg|gif|svg|ico)$/i, (_req, res) => {
  res.status(404).end();
});

// Serve the main HTML file for all other routes
app.get('*', (req, res) => {
  try {
    res.sendFile(path.join(__dirname, '..', 'index.html'));
  } catch (error) {
    console.error('Error serving index.html:', error);
    res.status(500).send('Error loading application');
  }
});

// Export for Vercel
module.exports = app;
