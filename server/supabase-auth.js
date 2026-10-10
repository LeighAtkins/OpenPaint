import { createClient } from '@supabase/supabase-js';

export class AuthError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.code = status === 401 ? 'AUTH_REQUIRED' : 'AUTH_UNAVAILABLE';
  }
}

let authClient = null;
function getAuthClient() {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  // Verifying a user's JWT works with the public key, so the service role key is optional.
  const key = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    ''
  ).trim();
  if (!url || !key) return null;
  if (!authClient) {
    authClient = createClient(url, key, { auth: { persistSession: false } });
  }
  return authClient;
}

// Resolves the signed-in Supabase user from `Authorization: Bearer <token>`, or throws.
export async function requireRequestUser(req) {
  const header = String(req.headers?.authorization || '');
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new AuthError(401, 'Sign in required');

  const supabase = getAuthClient();
  if (!supabase) throw new AuthError(503, 'Authentication is not configured');
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) throw new AuthError(401, 'Sign in required');
  return data.user;
}

// Sends the auth error response and returns null, or returns the user.
export async function requireUserOrRespond(req, res) {
  try {
    return await requireRequestUser(req);
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 401;
    res.status(status).json({
      success: false,
      code: error?.code || 'AUTH_REQUIRED',
      message: error?.message || 'Sign in required',
    });
    return null;
  }
}
