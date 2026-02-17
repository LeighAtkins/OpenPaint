// Cloud Save Service - Thin Supabase wrapper for projects table
import { getSupabaseClient, DATABASE_TABLES } from '@/config/supabase.config';
import { Result } from '@/utils/result';
import { AppError, ErrorCode } from '@/types/app.types';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase.types';

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

  async saveProject(options: SaveProjectOptions): Promise<Result<CloudProject, AppError>> {
    const clientResult = getSupabaseClient();
    if (!clientResult.success) {
      return Result.err(clientResult.error);
    }

    const client = clientResult.data as unknown as SupabaseClient<any>;
    const { name, projectData, currentProjectId } = options;

    try {
      const user = client.auth.getUser();
      const userId = (await user).data.user?.id;

      if (!userId) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'You must be signed in to save to the cloud')
        );
      }

      const now = new Date().toISOString();
      const projectId = currentProjectId || this.currentCloudProjectId;

      if (projectId) {
        const { data, error } = await client
          .from(DATABASE_TABLES.PROJECTS)
          .update({
            name,
            data: projectData,
            updated_at: now,
          } as any)
          .eq('id', projectId)
          .eq('user_id', userId)
          .select()
          .single();

        if (error) {
          return Result.err(
            new AppError(
              ErrorCode.SUPABASE_QUERY_ERROR,
              `Failed to update project: ${error.message}`
            )
          );
        }

        return Result.ok(data as CloudProject);
      } else {
        const { data, error } = await client
          .from(DATABASE_TABLES.PROJECTS)
          .insert({
            name,
            user_id: userId,
            data: projectData,
            is_public: false,
            tags: [],
          } as any)
          .select()
          .single();

        if (error) {
          return Result.err(
            new AppError(ErrorCode.SUPABASE_QUERY_ERROR, `Failed to save project: ${error.message}`)
          );
        }

        if (data && data.id) {
          this.currentCloudProjectId = data.id;
        }
        return Result.ok(data as CloudProject);
      }
    } catch (error) {
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
      const user = client.auth.getUser();
      const userId = (await user).data.user?.id;

      if (!userId) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'You must be signed in to list projects')
        );
      }

      let query = client
        .from(DATABASE_TABLES.PROJECTS)
        .select('id, name, user_id, created_at, updated_at')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false });

      if (search && search.trim()) {
        const searchTerm = search.trim().toLowerCase();
        query = query.ilike('name', `%${searchTerm}%`);
      }

      const { data, error } = await query;

      if (error) {
        return Result.err(
          new AppError(ErrorCode.SUPABASE_QUERY_ERROR, `Failed to list projects: ${error.message}`)
        );
      }

      return Result.ok((data || []) as CloudProjectSummary[]);
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
      const user = client.auth.getUser();
      const userId = (await user).data.user?.id;

      if (!userId) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'You must be signed in to load projects')
        );
      }

      const { data: project, error: fetchError } = await client
        .from(DATABASE_TABLES.PROJECTS)
        .select('*')
        .eq('id', projectId)
        .eq('user_id', userId)
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
      return Result.ok(project as unknown as CloudProject);
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
      const user = client.auth.getUser();
      const userId = (await user).data.user?.id;

      if (!userId) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'You must be signed in to delete projects')
        );
      }

      const { error } = await client
        .from(DATABASE_TABLES.PROJECTS)
        .delete()
        .eq('id', projectId)
        .eq('user_id', userId);

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
