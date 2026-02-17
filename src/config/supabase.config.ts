// Supabase configuration and client setup
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase.types';
import { Result } from '@/utils/result';
import { AppError, ErrorCode } from '@/types/app.types';

// Environment configuration
interface SupabaseConfig {
  url: string;
  anonKey: string;
  serviceKey?: string;
}

// Configuration constants
export const SUPABASE_CONFIG: SupabaseConfig = {
  url: import.meta.env.VITE_SUPABASE_URL || '',
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
  serviceKey: import.meta.env['VITE_SUPABASE_SERVICE_KEY'] || '',
};

// Storage bucket names
export const STORAGE_BUCKETS = {
  PROJECT_IMAGES: 'project-images',
  PROJECT_THUMBNAILS: 'project-thumbnails',
  USER_AVATARS: 'user-avatars',
} as const;

// Database table names - ensures type safety
export const DATABASE_TABLES = {
  PROJECTS: 'projects',
  PROJECT_IMAGES: 'project_images',
  USER_PROFILES: 'user_profiles',
} as const;

// RLS (Row Level Security) policies
export const RLS_POLICIES = {
  PROJECTS: {
    SELECT: 'projects_select_policy',
    INSERT: 'projects_insert_policy',
    UPDATE: 'projects_update_policy',
    DELETE: 'projects_delete_policy',
  },
  PROJECT_IMAGES: {
    SELECT: 'project_images_select_policy',
    INSERT: 'project_images_insert_policy',
    UPDATE: 'project_images_update_policy',
    DELETE: 'project_images_delete_policy',
  },
} as const;

// Supabase client instance
let supabaseClient: SupabaseClient<Database> | null = null;

/**
 * Initialize Supabase client with configuration validation
 */
export function initializeSupabase(): Result<SupabaseClient<Database>, AppError> {
  try {
    // Validate required configuration
    if (!SUPABASE_CONFIG.url) {
      return Result.err(
        new AppError(
          ErrorCode.SUPABASE_NOT_CONFIGURED,
          'VITE_SUPABASE_URL environment variable is required'
        )
      );
    }

    if (!SUPABASE_CONFIG.anonKey) {
      return Result.err(
        new AppError(
          ErrorCode.SUPABASE_NOT_CONFIGURED,
          'VITE_SUPABASE_ANON_KEY environment variable is required'
        )
      );
    }

    // URL validation
    try {
      new URL(SUPABASE_CONFIG.url);
    } catch {
      return Result.err(
        new AppError(ErrorCode.SUPABASE_NOT_CONFIGURED, 'Invalid Supabase URL format')
      );
    }

    // Create client with enhanced configuration
    // NOTE: Bypass navigator.locks due intermittent AbortError issues.
    // Keep this lock shim non-blocking to avoid potential nested deadlocks
    // during auth callback hydration.
    const lockShim = async (
      _name: string,
      _acquireTimeout: number,
      fn: () => Promise<unknown>
    ): Promise<unknown> => fn();

    supabaseClient = createClient<Database>(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        ...(typeof window !== 'undefined' && { storage: window.localStorage }),
        // We handle OAuth code callbacks explicitly in authService.initialize().
        // Disabling automatic URL detection prevents duplicate callback processing.
        detectSessionInUrl: false,
        flowType: 'pkce',
        lock: lockShim as any,
      },
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
      global: {
        headers: {
          'X-Client-Info': 'openpaint-typescript@2.0.0',
        },
      },
      db: {
        schema: 'public',
      },
    });

    return Result.ok(supabaseClient);
  } catch (error) {
    return Result.err(
      new AppError(
        ErrorCode.SUPABASE_NOT_CONFIGURED,
        `Failed to initialize Supabase: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    );
  }
}

/**
 * Get the current Supabase client instance
 */
export function getSupabaseClient(): Result<SupabaseClient<Database>, AppError> {
  if (!supabaseClient) {
    const initResult = initializeSupabase();
    if (!initResult.success) {
      return initResult;
    }
    supabaseClient = initResult.data;
  }

  return Result.ok(supabaseClient);
}

/**
 * Health check for Supabase connection
 */
export async function checkSupabaseHealth(): Promise<Result<boolean, AppError>> {
  try {
    const clientResult = getSupabaseClient();
    if (!clientResult.success) {
      return Result.err(clientResult.error);
    }

    const client = clientResult.data;

    // Simple health check - try to fetch from a system table
    const { error } = await client.from('user_profiles').select('id').limit(1);

    if (error) {
      return Result.err(
        new AppError(
          ErrorCode.SUPABASE_CONNECTION_FAILED,
          `Supabase health check failed: ${error.message}`
        )
      );
    }

    return Result.ok(true);
  } catch (error) {
    return Result.err(
      new AppError(
        ErrorCode.SUPABASE_CONNECTION_FAILED,
        `Supabase health check error: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    );
  }
}

/**
 * Get storage URL for a file in a bucket
 */
export function getStorageUrl(bucket: string, path: string): Result<string, AppError> {
  const clientResult = getSupabaseClient();
  if (!clientResult.success) {
    return Result.err(clientResult.error);
  }

  try {
    const { data } = clientResult.data.storage.from(bucket).getPublicUrl(path);

    if (!data?.publicUrl) {
      return Result.err(new AppError(ErrorCode.STORAGE_ERROR, 'Failed to generate storage URL'));
    }

    return Result.ok(data.publicUrl);
  } catch (error) {
    return Result.err(
      new AppError(
        ErrorCode.STORAGE_ERROR,
        `Failed to get storage URL: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    );
  }
}

/**
 * Generate a signed URL for private storage access
 */
export async function getSignedStorageUrl(
  bucket: string,
  path: string,
  expiresIn: number = 3600
): Promise<Result<string, AppError>> {
  const clientResult = getSupabaseClient();
  if (!clientResult.success) {
    return Result.err(clientResult.error);
  }

  try {
    const { data, error } = await clientResult.data.storage
      .from(bucket)
      .createSignedUrl(path, expiresIn);

    if (error) {
      return Result.err(
        new AppError(ErrorCode.STORAGE_ERROR, `Failed to create signed URL: ${error.message}`)
      );
    }

    if (!data?.signedUrl) {
      return Result.err(
        new AppError(ErrorCode.STORAGE_ERROR, 'No signed URL returned from Supabase')
      );
    }

    return Result.ok(data.signedUrl);
  } catch (error) {
    return Result.err(
      new AppError(
        ErrorCode.STORAGE_ERROR,
        `Failed to generate signed URL: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    );
  }
}

/**
 * Configuration validation for deployment
 */
export function validateSupabaseConfig(): Result<true, AppError> {
  const issues: string[] = [];

  if (!SUPABASE_CONFIG.url) {
    issues.push('Missing VITE_SUPABASE_URL');
  }

  if (!SUPABASE_CONFIG.anonKey) {
    issues.push('Missing VITE_SUPABASE_ANON_KEY');
  }

  if (SUPABASE_CONFIG.url && !SUPABASE_CONFIG.url.includes('supabase.co')) {
    issues.push('Invalid Supabase URL format');
  }

  if (issues.length > 0) {
    return Result.err(
      new AppError(
        ErrorCode.SUPABASE_NOT_CONFIGURED,
        `Supabase configuration issues: ${issues.join(', ')}`
      )
    );
  }

  return Result.ok(true);
}

// Export commonly used types
export type { Database, SupabaseClient };
