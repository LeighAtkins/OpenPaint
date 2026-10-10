import { requireStaffOrRespond } from '../../supabase-auth.js';
import { getCwCredentials } from './shared.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }
  if (!(await requireStaffOrRespond(req, res))) return;

  const creds = getCwCredentials();
  return res.status(200).json({
    ok: true,
    baseUrl: creds.baseUrl,
    hasEnvUsername: Boolean(creds.username),
    hasEnvPassword: Boolean(creds.password),
  });
}
