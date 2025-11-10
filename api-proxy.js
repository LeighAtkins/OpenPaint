// Pure Node.js API proxy handler (no Express dependency)
// Proxies requests to Cloudflare Worker for background removal

module.exports = async (req, res) => {
  // Handle /api/_env endpoint
  if (req.url === '/api/_env') {
    try {
      const val = process.env.CF_WORKER_URL || '';
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({
        CF_WORKER_URL: val ? 'configured' : 'missing',
        CF_WORKER_URL_value_preview: val || '<empty>',
        NODE_ENV: process.env.NODE_ENV || 'production'
      }));
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({
        ok: false,
        error: 'env-handler-exception',
        message: String(err)
      }));
    }
    return;
  }

  // Handle /api/images/direct-upload endpoint
  if (req.url === '/api/images/direct-upload' && req.method === 'POST') {
    try {
      const base = process.env.CF_WORKER_URL || '';
      if (!base) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({
          ok: false,
          error: 'missing-CF_WORKER_URL',
          message: 'Set CF_WORKER_URL to your Worker base URL'
        }));
        return;
      }

      const url = `${base.replace(/\/$/, '')}/images/direct-upload`;
      const headers = {};
      if (req.headers['x-api-key']) {
        headers['x-api-key'] = String(req.headers['x-api-key']);
      }

      let upstream;
      try {
        upstream = await fetch(url, { method: 'POST', headers });
      } catch (e) {
        res.statusCode = 502;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({
          ok: false,
          error: 'fetch-exception',
          message: e.message
        }));
        return;
      }

      const text = await upstream.text().catch(() => '<no body>');
      if (!upstream.ok) {
        res.statusCode = 502;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({
          ok: false,
          error: 'upstream-failed',
          status: upstream.status,
          body: text.slice(0, 500)
        }));
        return;
      }

      try {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(JSON.parse(text)));
      } catch {
        res.statusCode = 200;
        res.setHeader('content-type', upstream.headers.get('content-type') || 'application/json');
        res.end(text);
      }
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({
        ok: false,
        error: 'proxy-exception',
        message: String(err)
      }));
    }
    return;
  }

  // Handle /api/remove-background endpoint
  if (req.url === '/api/remove-background' && req.method === 'POST') {
    try {
      const base = process.env.CF_WORKER_URL || '';
      if (!base) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({
          ok: false,
          error: 'missing-CF_WORKER_URL',
          message: 'Set CF_WORKER_URL to your Worker base URL'
        }));
        return;
      }

      const url = `${base.replace(/\/$/, '')}/remove-background`;
      const headers = { 'content-type': 'application/json' };
      if (req.headers['x-api-key']) {
        headers['x-api-key'] = String(req.headers['x-api-key']);
      }

      // Read request body
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const bodyText = Buffer.concat(chunks).toString();

      let upstream;
      try {
        upstream = await fetch(url, {
          method: 'POST',
          headers,
          body: bodyText
        });
      } catch (e) {
        res.statusCode = 502;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({
          ok: false,
          error: 'fetch-exception',
          message: e.message
        }));
        return;
      }

      const ct = upstream.headers.get('content-type') || 'application/octet-stream';
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.statusCode = upstream.status;
      res.setHeader('content-type', ct);
      res.end(buf);
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({
        ok: false,
        error: 'proxy-exception',
        message: String(err)
      }));
    }
    return;
  }

  // 404 for unmatched routes
  res.statusCode = 404;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ok: false,
    error: 'not-found',
    path: req.url
  }));
};
