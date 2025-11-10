// Minimal test to see if basic exports work
module.exports = (req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ok: true,
    message: 'Minimal handler works',
    CF_WORKER_URL: process.env.CF_WORKER_URL || 'not-set',
    method: req.method,
    url: req.url
  }));
};
