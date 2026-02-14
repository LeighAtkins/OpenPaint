import { getCwCredentials } from './_shared.js';

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const creds = getCwCredentials();
  return res.status(200).json({
    ok: true,
    baseUrl: creds.baseUrl,
    hasEnvUsername: Boolean(creds.username),
    hasEnvPassword: Boolean(creds.password),
  });
}
