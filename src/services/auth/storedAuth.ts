import { SUPABASE_CONFIG } from '@/config/supabase.config';

export interface StoredAuthSession {
  accessToken: string;
  userId: string;
}

function getConfiguredStorageKey(): string | null {
  try {
    const host = new URL(SUPABASE_CONFIG.url).hostname;
    const projectRef = host.split('.')[0];
    return projectRef ? `sb-${projectRef}-auth-token` : null;
  } catch {
    return null;
  }
}

function parseStoredAuth(raw: string | null): StoredAuthSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const accessToken = parsed?.access_token;
    const userId = parsed?.user?.id;
    if (typeof accessToken === 'string' && typeof userId === 'string') {
      return { accessToken, userId };
    }
  } catch {
    // ignore malformed localStorage entries
  }
  return null;
}

export function getStoredSupabaseAuth(): StoredAuthSession | null {
  if (typeof localStorage === 'undefined') return null;

  const configuredKey = getConfiguredStorageKey();
  const supabaseKeys = Object.keys(localStorage).filter(
    key => key.startsWith('sb-') && key.endsWith('-auth-token')
  );
  const candidateKeys = [
    ...(configuredKey ? [configuredKey] : []),
    ...supabaseKeys.filter(key => key !== configuredKey),
  ];

  for (const key of candidateKeys) {
    const auth = parseStoredAuth(localStorage.getItem(key));
    if (auth) return auth;
  }

  return null;
}
