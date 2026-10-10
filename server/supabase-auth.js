import { createClient } from '@supabase/supabase-js';

export class AuthError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || (status === 401 ? 'AUTH_REQUIRED' : 'AUTH_UNAVAILABLE');
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

// Comfort Works staff only: a confirmed email on the staff domain. The confirmation check
// matters because unconfirmed sign-ups could otherwise claim any address on the domain.
export async function requireStaffUser(req) {
  const user = await requireRequestUser(req);
  const domain = (process.env.STAFF_EMAIL_DOMAIN || 'comfort-works.com').trim().toLowerCase();
  const email = String(user.email || '').toLowerCase();
  if (!email.endsWith(`@${domain}`) || !user.email_confirmed_at) {
    throw new AuthError(403, `A confirmed @${domain} account is required`, 'STAFF_ONLY');
  }
  return user;
}

async function respondOnAuthError(res, check) {
  try {
    return await check();
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

// Sends the auth error response and returns null, or returns the user.
export function requireUserOrRespond(req, res) {
  return respondOnAuthError(res, () => requireRequestUser(req));
}

export function requireStaffOrRespond(req, res) {
  return respondOnAuthError(res, () => requireStaffUser(req));
}
