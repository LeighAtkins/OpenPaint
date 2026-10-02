import { createClient } from '@supabase/supabase-js';

type User = { email?: string; email_confirmed_at?: string | null };
type AccessResult =
  | { allowed: true }
  | { allowed: false; status: number; code: string; message: string };

export function isVerifiedComfortWorksUser(user: User | null | undefined): boolean {
  return Boolean(
    user?.email_confirmed_at && /^[^@\s]+@comfort-works\.com$/i.test(user.email || '')
  );
}

export async function checkCwMeasurementAccess(
  authorization: unknown,
  validateToken?: (token: string) => Promise<User | null>
): Promise<AccessResult> {
  const match = typeof authorization === 'string' ? authorization.match(/^Bearer\s+(\S+)$/i) : null;
  if (!match)
    return {
      allowed: false,
      status: 401,
      code: 'CW_SIGN_IN_REQUIRED',
      message: 'Sign in to Sofapaint with your Comfort Works account to access measurements.',
    };
  if (!validateToken) {
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key =
      process.env.SUPABASE_ANON_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key)
      return {
        allowed: false,
        status: 503,
        code: 'CW_AUTH_UNAVAILABLE',
        message: 'Measurement access is unavailable until Sofapaint authentication is configured.',
      };
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    validateToken = async token => {
      const { data, error } = await client.auth.getUser(token);
      return error ? null : data.user;
    };
  }
  try {
    const user = await validateToken(match[1]);
    if (!user)
      return {
        allowed: false,
        status: 401,
        code: 'CW_SESSION_INVALID',
        message: 'Your Sofapaint session has expired. Sign in again.',
      };
    if (!isVerifiedComfortWorksUser(user))
      return {
        allowed: false,
        status: 403,
        code: 'CW_STAFF_ONLY',
        message: 'Measurements require a verified @comfort-works.com email address.',
      };
    return { allowed: true };
  } catch {
    return {
      allowed: false,
      status: 503,
      code: 'CW_AUTH_UNAVAILABLE',
      message: 'Unable to verify measurement access. Please try again.',
    };
  }
}

export async function requireCwMeasurementAccess(req: any, res: any): Promise<boolean> {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Authorization');
  const result = await checkCwMeasurementAccess(req.headers?.authorization);
  if (result.allowed === true) return true;
  res.status(result.status).json({ success: false, code: result.code, message: result.message });
  return false;
}
