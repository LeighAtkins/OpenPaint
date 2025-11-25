import { z } from 'zod';

const EnvSchema = z.object({
  VITE_SUPABASE_URL: z.string().url(),
  VITE_SUPABASE_ANON_KEY: z.string().min(1),
});

interface ParsedEnv {
  supabase: {
    url: string;
    anonKey: string;
  };
  isDevelopment: boolean;
  isProduction: boolean;
  isTest: boolean;
}

function parseEnv(): ParsedEnv {
  const rawEnv = {
    VITE_SUPABASE_URL: import.meta.env['VITE_SUPABASE_URL'] as string | undefined,
    VITE_SUPABASE_ANON_KEY: import.meta.env['VITE_SUPABASE_ANON_KEY'] as string | undefined,
  };

  // In development, warn but don't crash if env vars are missing
  const result = EnvSchema.safeParse(rawEnv);
  
  if (!result.success) {
    console.warn('[ENV] Missing environment variables:', result.error.flatten());
    return {
      supabase: {
        url: '',
        anonKey: '',
      },
      isDevelopment: import.meta.env['DEV'] as boolean,
      isProduction: import.meta.env['PROD'] as boolean,
      isTest: import.meta.env['MODE'] === 'test',
    };
  }

  return {
    supabase: {
      url: result.data.VITE_SUPABASE_URL,
      anonKey: result.data.VITE_SUPABASE_ANON_KEY,
    },
    isDevelopment: import.meta.env['DEV'] as boolean,
    isProduction: import.meta.env['PROD'] as boolean,
    isTest: import.meta.env['MODE'] === 'test',
  };
}

export const env = parseEnv();

export function isSupabaseConfigured(): boolean {
  return Boolean(env.supabase.url && env.supabase.anonKey);
}