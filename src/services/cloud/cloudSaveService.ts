// Cloud Save Service - Direct PostgREST wrapper for projects table
//
// Bypasses the Supabase JS client for data operations because
// client.auth.getSession() deadlocks intermittently, which also
// prevents the client from attaching auth headers to requests.
// Auth tokens are read directly from localStorage instead.
//
// Actual DB schema (projects table):
//   id            uuid PK (auto-generated)
//   project_name  text
//   customer_name text
//   sofa_model    text
//   created_by    text   -- stores the auth user ID
//   tags          text[]
//   data          jsonb
//   created_at    timestamptz
//   updated_at    timestamptz
import { SUPABASE_CONFIG } from '@/config/supabase.config';
import { Result } from '@/utils/result';
import { AppError, ErrorCode } from '@/types/app.types';

export interface CloudProjectSummary {
  id: string;
  name: string;
  user_id: string;
  created_at: string;
  updated_at: string;
}

export interface CloudProject {
  id: string;
  name: string;
  user_id: string;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SaveProjectOptions {
  name: string;
  projectData: Record<string, unknown>;
  currentProjectId?: string | null;
}

/** Map a DB row (project_name, created_by) to our app shape (name, user_id) */
function mapRow(row: any): any {
  if (!row || typeof row !== 'object') {
    return null;
  }

  return {
    id: row.id,
    name: row.project_name,
    user_id: row.created_by,
    data: row.data,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function createCloudSaveProof(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  const random = Math.random().toString(36).slice(2);
  return `${Date.now().toString(36)}-${random}`;
}

function withCloudSaveProof(
  projectData: Record<string, unknown>,
  proof: string,
  savedAt: string
): Record<string, unknown> {
  const meta =
    projectData._meta && typeof projectData._meta === 'object'
      ? (projectData._meta as Record<string, unknown>)
      : {};
  return {
    ...projectData,
    updatedAt: savedAt,
    _meta: {
      ...meta,
      cloudSaveProof: proof,
      cloudSavedAt: savedAt,
    },
  };
}

function getCloudSaveProof(row: any): string {
  return String(row?.data?._meta?.cloudSaveProof || '');
}

class CloudSaveService {
  private currentCloudProjectId: string | null = null;

  setCurrentProjectId(projectId: string | null): void {
    this.currentCloudProjectId = projectId;
  }

  getCurrentProjectId(): string | null {
    return this.currentCloudProjectId;
  }

  clearCurrentProject(): void {
    this.currentCloudProjectId = null;
  }

  /**
   * Read the stored auth session from localStorage.
   */
  private getStoredAuth(): { accessToken: string; userId: string } | null {
    try {
      const storageKey = Object.keys(localStorage).find(
        k => k.startsWith('sb-') && k.endsWith('-auth-token')
      );
      if (!storageKey) return null;
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const accessToken = parsed?.access_token;
      const userId = parsed?.user?.id;
      if (accessToken && userId) {
        return { accessToken, userId };
      }
    } catch {
      // ignore
    }
    return null;
  }

  /**
   * Make a direct PostgREST request, bypassing the Supabase JS client.
   */
  private async postgrest(
    path: string,
    options: {
      method: string;
      body?: unknown;
      headers?: Record<string, string>;
      signal?: AbortSignal;
    }
  ): Promise<{ data: any; error: string | null; status: number }> {
    const url = `${SUPABASE_CONFIG.url}/rest/v1${path}`;
    const auth = this.getStoredAuth();
    if (!auth) {
      return { data: null, error: 'Not authenticated', status: 401 };
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      apikey: SUPABASE_CONFIG.anonKey,
      Authorization: `Bearer ${auth.accessToken}`,
      Prefer: 'return=representation',
      ...options.headers,
    };

    const response = await fetch(url, {
      method: options.method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });

    const text = await response.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    if (!response.ok) {
      const msg = typeof data === 'object' ? data?.message || data?.error || text : text;
      return { data: null, error: `${response.status}: ${msg}`, status: response.status };
    }

    return { data, error: null, status: response.status };
  }

  async saveProject(options: SaveProjectOptions): Promise<Result<CloudProject, AppError>> {
    const { name, projectData, currentProjectId } = options;

    try {
      const savedAt = new Date().toISOString();
      const saveProof = createCloudSaveProof();
      const stampedProjectData = withCloudSaveProof(projectData, saveProof, savedAt);
      const payloadSize = JSON.stringify(stampedProjectData).length;
      const payloadMB = (payloadSize / (1024 * 1024)).toFixed(1);
      console.warn(`[CloudSave] Payload size: ${payloadMB} MB`);
      if (payloadSize > 50 * 1024 * 1024) {
        return Result.err(
          new AppError(
            ErrorCode.VALIDATION_ERROR,
            `Project is too large to save to cloud (${payloadMB} MB). Try reducing image count or size.`
          )
        );
      }

      const auth = this.getStoredAuth();
      if (!auth) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'You must be signed in to save to the cloud')
        );
      }
      const { userId } = auth;

      const projectId = currentProjectId || this.currentCloudProjectId;
      console.warn(
        `[CloudSave] Saving project "${name}" (${projectId ? 'update ' + projectId : 'new'}) userId=${userId}...`
      );

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);

      try {
        const verifyWrite = async (
          savedProjectId: string
        ): Promise<Result<CloudProject, AppError>> => {
          const { data: verifyData, error: verifyError } = await this.postgrest(
            `/projects?id=eq.${savedProjectId}&created_by=eq.${userId}&select=id,project_name,created_by,created_at,updated_at,data&limit=1`,
            { method: 'GET', signal: controller.signal }
          );

          if (verifyError) {
            return Result.err(
              new AppError(
                ErrorCode.SUPABASE_QUERY_ERROR,
                `Save verification failed: ${verifyError}`
              )
            );
          }

          const verifyRow = Array.isArray(verifyData) ? verifyData[0] : verifyData;
          const verifiedProof = getCloudSaveProof(verifyRow);
          if (!verifyRow?.id || verifiedProof !== saveProof) {
            return Result.err(
              new AppError(
                ErrorCode.SUPABASE_QUERY_ERROR,
                'Cloud save did not verify. The database did not return the just-saved project data.'
              )
            );
          }

          const mapped = mapRow(verifyRow);
          if (!mapped?.id) {
            return Result.err(
              new AppError(ErrorCode.SUPABASE_QUERY_ERROR, 'Verified save row was malformed')
            );
          }

          this.currentCloudProjectId = mapped.id;
          return Result.ok(mapped as CloudProject);
        };

        if (projectId) {
          console.warn('[CloudSave] Sending UPDATE...');
          const { data, error } = await this.postgrest(
            `/projects?id=eq.${projectId}&created_by=eq.${userId}&select=id,project_name,created_by,created_at,updated_at`,
            {
              method: 'PATCH',
              body: {
                project_name: name,
                data: stampedProjectData,
                updated_at: savedAt,
              },
              signal: controller.signal,
            }
          );

          if (error) {
            console.error('[CloudSave] Update error:', error);
            return Result.err(
              new AppError(ErrorCode.SUPABASE_QUERY_ERROR, `Failed to update project: ${error}`)
            );
          }

          const row = Array.isArray(data) ? data[0] : data;
          if (!row) {
            const { data: fallbackData, error: fallbackError } = await this.postgrest(
              `/projects?id=eq.${projectId}&created_by=eq.${userId}&select=id,project_name,created_by,created_at,updated_at&limit=1`,
              { method: 'GET', signal: controller.signal }
            );

            if (fallbackError) {
              return Result.err(
                new AppError(
                  ErrorCode.SUPABASE_QUERY_ERROR,
                  `Update returned no row and fallback fetch failed: ${fallbackError}`
                )
              );
            }

            const fallbackRow = Array.isArray(fallbackData) ? fallbackData[0] : fallbackData;
            const mappedFallback = mapRow(fallbackRow);
            if (!mappedFallback?.id) {
              return Result.err(
                new AppError(
                  ErrorCode.SUPABASE_QUERY_ERROR,
                  'Update succeeded but no project row was returned'
                )
              );
            }

            console.warn('[CloudSave] Update succeeded (fallback row fetch)');
            return await verifyWrite(mappedFallback.id);
          }

          console.warn('[CloudSave] Update succeeded');
          const mapped = mapRow(row);
          if (!mapped?.id) {
            return Result.err(
              new AppError(ErrorCode.SUPABASE_QUERY_ERROR, 'Update returned malformed project row')
            );
          }
          return await verifyWrite(mapped.id);
        } else {
          console.warn('[CloudSave] Sending INSERT...');
          const { data, error } = await this.postgrest(
            '/projects?select=id,project_name,created_by,created_at,updated_at',
            {
              method: 'POST',
              body: {
                project_name: name,
                created_by: userId,
                data: stampedProjectData,
              },
              signal: controller.signal,
            }
          );

          if (error) {
            console.error('[CloudSave] Insert error:', error);
            return Result.err(
              new AppError(ErrorCode.SUPABASE_QUERY_ERROR, `Failed to save project: ${error}`)
            );
          }

          const row = Array.isArray(data) ? data[0] : data;
          let finalRow = row;

          if (!finalRow) {
            const safeName = encodeURIComponent(name);
            const { data: fallbackData, error: fallbackError } = await this.postgrest(
              `/projects?created_by=eq.${userId}&project_name=eq.${safeName}&select=id,project_name,created_by,created_at,updated_at&order=created_at.desc&limit=1`,
              { method: 'GET', signal: controller.signal }
            );

            if (!fallbackError) {
              finalRow = Array.isArray(fallbackData) ? fallbackData[0] : fallbackData;
            }
          }

          const mapped = mapRow(finalRow);
          if (!mapped?.id) {
            return Result.err(
              new AppError(
                ErrorCode.SUPABASE_QUERY_ERROR,
                'Insert succeeded but no project row was returned'
              )
            );
          }

          this.currentCloudProjectId = mapped.id;
          console.warn('[CloudSave] Insert succeeded, id:', mapped.id);
          return await verifyWrite(mapped.id);
        }
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      if (msg.includes('aborted')) {
        console.error('[CloudSave] Request timed out after 30s');
        return Result.err(
          new AppError(
            ErrorCode.UNKNOWN_ERROR,
            'Cloud save timed out. Try again or reduce project size.'
          )
        );
      }
      console.error('[CloudSave] Exception:', error);
      return Result.err(new AppError(ErrorCode.UNKNOWN_ERROR, `Failed to save project: ${msg}`));
    }
  }

  async listProjects(search?: string): Promise<Result<CloudProjectSummary[], AppError>> {
    try {
      const auth = this.getStoredAuth();
      if (!auth) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'You must be signed in to list projects')
        );
      }

      let path = `/projects?created_by=eq.${auth.userId}&select=id,project_name,created_by,created_at,updated_at&order=updated_at.desc`;
      if (search && search.trim()) {
        path += `&project_name=ilike.*${encodeURIComponent(search.trim())}*`;
      }

      const { data, error } = await this.postgrest(path, { method: 'GET' });

      if (error) {
        return Result.err(
          new AppError(ErrorCode.SUPABASE_QUERY_ERROR, `Failed to list projects: ${error}`)
        );
      }

      return Result.ok((data || []).map(mapRow) as CloudProjectSummary[]);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.UNKNOWN_ERROR,
          `Failed to list projects: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      );
    }
  }

  async loadProject(projectId: string): Promise<Result<CloudProject, AppError>> {
    try {
      const auth = this.getStoredAuth();
      if (!auth) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'You must be signed in to load projects')
        );
      }

      const { data, error } = await this.postgrest(
        `/projects?id=eq.${projectId}&created_by=eq.${auth.userId}`,
        { method: 'GET' }
      );

      if (error) {
        return Result.err(
          new AppError(ErrorCode.SUPABASE_QUERY_ERROR, `Failed to load project: ${error}`)
        );
      }

      const row = Array.isArray(data) ? data[0] : data;
      if (!row) {
        return Result.err(new AppError(ErrorCode.VALIDATION_ERROR, 'Project not found'));
      }

      this.currentCloudProjectId = projectId;
      return Result.ok(mapRow(row) as CloudProject);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.UNKNOWN_ERROR,
          `Failed to load project: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      );
    }
  }

  async deleteProject(projectId: string): Promise<Result<boolean, AppError>> {
    try {
      const auth = this.getStoredAuth();
      if (!auth) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'You must be signed in to delete projects')
        );
      }

      const { error } = await this.postgrest(
        `/projects?id=eq.${projectId}&created_by=eq.${auth.userId}`,
        { method: 'DELETE' }
      );

      if (error) {
        return Result.err(
          new AppError(ErrorCode.SUPABASE_QUERY_ERROR, `Failed to delete project: ${error}`)
        );
      }

      if (this.currentCloudProjectId === projectId) {
        this.currentCloudProjectId = null;
      }

      return Result.ok(true);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.UNKNOWN_ERROR,
          `Failed to delete project: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      );
    }
  }
}

export const cloudSaveService = new CloudSaveService();
