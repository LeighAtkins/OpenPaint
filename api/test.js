export default function handler(req, res) {
  res.json({ ok: true, message: 'API test endpoint working', timestamp: Date.now() });
}
