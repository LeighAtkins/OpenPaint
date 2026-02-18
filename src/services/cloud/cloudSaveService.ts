// Cloud Save Service - Thin Supabase wrapper for projects table
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
import { getSupabaseClient, DATABASE_TABLES } from '@/config/supabase.config';
import { Result } from '@/utils/result';
import { AppError, ErrorCode } from '@/types/app.types';
import type { SupabaseClient } from '@supabase/supabase-js';

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
  return {
    id: row.id,
    name: row.project_name,
    user_id: row.created_by,
    data: row.data,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
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
   * Get the current user ID from the cached session (no network call).
   */
  private async getUserId(client: SupabaseClient<any>): Promise<string | null> {
    const {
      data: { session },
    } = await client.auth.getSession();
    return session?.user?.id ?? null;
  }

  async saveProject(options: SaveProjectOptions): Promise<Result<CloudProject, AppError>> {
    const clientResult = getSupabaseClient();
    if (!clientResult.success) {
      return Result.err(clientResult.error);
    }

    const client = clientResult.data as unknown as SupabaseClient<any>;
    const { name, projectData, currentProjectId } = options;

    try {
      const payloadSize = JSON.stringify(projectData).length;
      const payloadMB = (payloadSize / (1024 * 1024)).toFixed(1);
      console.log(`[CloudSave] Payload size: ${payloadMB} MB`);
      if (payloadSize > 50 * 1024 * 1024) {
        return Result.err(
          new AppError(
            ErrorCode.VALIDATION_ERROR,
            `Project is too large to save to cloud (${payloadMB} MB). Try reducing image count or size.`
          )
        );
      }

      const userId = await this.getUserId(client);
      if (!userId) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'You must be signed in to save to the cloud')
        );
      }

      const now = new Date().toISOString();
      const projectId = currentProjectId || this.currentCloudProjectId;

      console.log(
        `[CloudSave] Saving project "${name}" (${projectId ? 'update ' + projectId : 'new'})...`
      );

      if (projectId) {
        const { data, error } = await client
          .from(DATABASE_TABLES.PROJECTS)
          .update({
            project_name: name,
            data: projectData,
            updated_at: now,
          } as any)
          .eq('id', projectId)
          .eq('created_by', userId)
          .select('id, project_name, created_by, created_at, updated_at')
          .single();

        if (error) {
          console.error('[CloudSave] Update error:', error.code, error.message, error.details);
          return Result.err(
            new AppError(
              ErrorCode.SUPABASE_QUERY_ERROR,
              `Failed to update project: ${error.message}`
            )
          );
        }

        console.log('[CloudSave] Update succeeded');
        return Result.ok({ ...mapRow(data), data: {} } as CloudProject);
      } else {
        const { data, error } = await client
          .from(DATABASE_TABLES.PROJECTS)
          .insert({
            project_name: name,
            created_by: userId,
            data: projectData,
          } as any)
          .select('id, project_name, created_by, created_at, updated_at')
          .single();

        if (error) {
          console.error('[CloudSave] Insert error:', error.code, error.message, error.details);
          return Result.err(
            new AppError(ErrorCode.SUPABASE_QUERY_ERROR, `Failed to save project: ${error.message}`)
          );
        }

        if (data?.id) {
          this.currentCloudProjectId = data.id;
        }
        console.log('[CloudSave] Insert succeeded, id:', data?.id);
        return Result.ok({ ...mapRow(data), data: {} } as CloudProject);
      }
    } catch (error) {
      console.error('[CloudSave] Exception:', error);
      return Result.err(
        new AppError(
          ErrorCode.UNKNOWN_ERROR,
          `Failed to save project: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      );
    }
  }

  async listProjects(search?: string): Promise<Result<CloudProjectSummary[], AppError>> {
    const clientResult = getSupabaseClient();
    if (!clientResult.success) {
      return Result.err(clientResult.error);
    }

    const client = clientResult.data as unknown as SupabaseClient<any>;

    try {
      const userId = await this.getUserId(client);
      if (!userId) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'You must be signed in to list projects')
        );
      }

      let query = client
        .from(DATABASE_TABLES.PROJECTS)
        .select('id, project_name, created_by, created_at, updated_at')
        .eq('created_by', userId)
        .order('updated_at', { ascending: false });

      if (search && search.trim()) {
        const searchTerm = search.trim().toLowerCase();
        query = query.ilike('project_name', `%${searchTerm}%`);
      }

      const { data, error } = await query;

      if (error) {
        return Result.err(
          new AppError(ErrorCode.SUPABASE_QUERY_ERROR, `Failed to list projects: ${error.message}`)
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
    const clientResult = getSupabaseClient();
    if (!clientResult.success) {
      return Result.err(clientResult.error);
    }

    const client = clientResult.data as unknown as SupabaseClient<any>;

    try {
      const userId = await this.getUserId(client);
      if (!userId) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'You must be signed in to load projects')
        );
      }

      const { data: project, error: fetchError } = await client
        .from(DATABASE_TABLES.PROJECTS)
        .select('*')
        .eq('id', projectId)
        .eq('created_by', userId)
        .single();

      if (fetchError) {
        return Result.err(
          new AppError(
            ErrorCode.SUPABASE_QUERY_ERROR,
            `Failed to load project: ${fetchError.message}`
          )
        );
      }

      if (!project) {
        return Result.err(new AppError(ErrorCode.VALIDATION_ERROR, 'Project not found'));
      }

      this.currentCloudProjectId = projectId;
      return Result.ok(mapRow(project) as CloudProject);
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
    const clientResult = getSupabaseClient();
    if (!clientResult.success) {
      return Result.err(clientResult.error);
    }

    const client = clientResult.data as unknown as SupabaseClient<any>;

    try {
      const userId = await this.getUserId(client);
      if (!userId) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'You must be signed in to delete projects')
        );
      }

      const { error } = await client
        .from(DATABASE_TABLES.PROJECTS)
        .delete()
        .eq('id', projectId)
        .eq('created_by', userId);

      if (error) {
        return Result.err(
          new AppError(ErrorCode.SUPABASE_QUERY_ERROR, `Failed to delete project: ${error.message}`)
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
