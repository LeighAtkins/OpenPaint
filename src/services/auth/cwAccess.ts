import { authService, type AuthUser } from './authService';

/** Also invalidate loaded measurements when the same account changes email. */
export function getCwMeasurementIdentity(
  user: AuthUser | null = authService.getCurrentUser()
): string {
  return user ? `${user.id}|${user.email.toLowerCase()}|${user.emailConfirmed}` : '';
}

/** Use Sofapaint's refreshed session; CW credentials do not grant archive access. */
export async function getCwRequestHeaders(): Promise<Record<string, string>> {
  const result = await authService.getCurrentSession();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (result.success && result.data?.access_token) {
    headers.Authorization = `Bearer ${result.data.access_token}`;
  }
  return headers;
}
