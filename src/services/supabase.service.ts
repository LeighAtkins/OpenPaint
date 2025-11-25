// Core Supabase service layer with comprehensive error handling
import { SupabaseClient } from '@supabase/supabase-js';
import {
  getSupabaseClient,
  STORAGE_BUCKETS,
  DATABASE_TABLES,
  type Database,
} from '@/config/supabase.config';
import { Result } from '@/utils/result';
import { AppError, ErrorCode } from '@/types/app.types';
import type {
  ProjectRow,
  ProjectInsert,
  ProjectUpdate,
  ProjectImageRow,
  ProjectImageInsert,
  ProjectImageUpdate,
  UserProfileRow,
  UserProfileInsert,
  UserProfileUpdate,
  ProjectSummary,
  PaginatedResponse,
} from '@/types/supabase.types';

/**
 * Base Supabase service with common database operations
 */
export class SupabaseService {
  private client: SupabaseClient<Database> | null = null;

  /**
   * Initialize the service with a Supabase client
   */
  private async getClient(): Promise<Result<SupabaseClient<Database>, AppError>> {
    if (!this.client) {
      const result = getSupabaseClient();
      if (!result.success) {
        return result;
      }
      this.client = result.data;
    }
    return Result.ok(this.client);
  }

  /**
   * Generic insert operation with comprehensive error handling
   */
  protected async insert<T extends Record<string, any>>(
    table: string,
    data: T
  ): Promise<Result<T, AppError>> {
    try {
      const clientResult = await this.getClient();
      if (!clientResult.success) {
        return Result.err(clientResult.error);
      }

      const { data: result, error } = await clientResult.data
        .from(table)
        .insert(data)
        .select()
        .single();

      if (error) {
        return Result.err(
          new AppError(ErrorCode.DATABASE_ERROR, `Insert failed in ${table}: ${error.message}`, {
            table,
            data: data,
            postgresError: error,
          })
        );
      }

      return Result.ok(result as T);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.DATABASE_ERROR,
          `Insert operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { table, data }
        )
      );
    }
  }

  /**
   * Generic update operation with optimistic concurrency
   */
  protected async update<T extends Record<string, any>>(
    table: string,
    id: string,
    data: Partial<T>,
    version?: number
  ): Promise<Result<T, AppError>> {
    try {
      const clientResult = await this.getClient();
      if (!clientResult.success) {
        return Result.err(clientResult.error);
      }

      let query = clientResult.data.from(table).update(data).eq('id', id);

      // Add version check for optimistic concurrency control
      if (version !== undefined) {
        query = query.eq('version', version);
      }

      const { data: result, error } = await query.select().single();

      if (error) {
        // Check for optimistic concurrency conflict
        if (error.code === 'PGRST116') {
          return Result.err(
            new AppError(
              ErrorCode.OPTIMISTIC_LOCK_ERROR,
              'Record was modified by another user. Please refresh and try again.',
              { table, id, expectedVersion: version }
            )
          );
        }

        return Result.err(
          new AppError(ErrorCode.DATABASE_ERROR, `Update failed in ${table}: ${error.message}`, {
            table,
            id,
            data,
            postgresError: error,
          })
        );
      }

      return Result.ok(result as T);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.DATABASE_ERROR,
          `Update operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { table, id, data }
        )
      );
    }
  }

  /**
   * Generic delete operation with cascade handling
   */
  protected async delete(
    table: string,
    id: string,
    cascadeCheck?: boolean
  ): Promise<Result<boolean, AppError>> {
    try {
      const clientResult = await this.getClient();
      if (!clientResult.success) {
        return Result.err(clientResult.error);
      }

      // Optional cascade check for related records
      if (cascadeCheck && table === DATABASE_TABLES.PROJECTS) {
        const { count } = await clientResult.data
          .from(DATABASE_TABLES.PROJECT_IMAGES)
          .select('id', { count: 'exact', head: true })
          .eq('project_id', id);

        if (count && count > 0) {
          return Result.err(
            new AppError(
              ErrorCode.VALIDATION_ERROR,
              `Cannot delete project with ${count} associated images. Delete images first.`,
              { projectId: id, imageCount: count }
            )
          );
        }
      }

      const { error } = await clientResult.data.from(table).delete().eq('id', id);

      if (error) {
        return Result.err(
          new AppError(ErrorCode.DATABASE_ERROR, `Delete failed in ${table}: ${error.message}`, {
            table,
            id,
            postgresError: error,
          })
        );
      }

      return Result.ok(true);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.DATABASE_ERROR,
          `Delete operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { table, id }
        )
      );
    }
  }

  /**
   * Generic select operation with filtering and pagination
   */
  protected async select<T>(
    table: string,
    filters?: Record<string, any>,
    options?: {
      limit?: number;
      offset?: number;
      orderBy?: string;
      ascending?: boolean;
      select?: string;
    }
  ): Promise<Result<T[], AppError>> {
    try {
      const clientResult = await this.getClient();
      if (!clientResult.success) {
        return Result.err(clientResult.error);
      }

      let query = clientResult.data.from(table).select(options?.select || '*');

      // Apply filters
      if (filters) {
        Object.entries(filters).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            query = query.eq(key, value);
          }
        });
      }

      // Apply ordering
      if (options?.orderBy) {
        query = query.order(options.orderBy, { ascending: options.ascending ?? true });
      }

      // Apply pagination
      if (options?.limit) {
        query = query.limit(options.limit);
      }
      if (options?.offset) {
        query = query.range(options.offset, options.offset + (options.limit || 10) - 1);
      }

      const { data, error } = await query;

      if (error) {
        return Result.err(
          new AppError(ErrorCode.DATABASE_ERROR, `Select failed in ${table}: ${error.message}`, {
            table,
            filters,
            options,
            postgresError: error,
          })
        );
      }

      return Result.ok(data as T[]);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.DATABASE_ERROR,
          `Select operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { table, filters, options }
        )
      );
    }
  }

  /**
   * Get a single record by ID
   */
  protected async getById<T>(
    table: string,
    id: string,
    select?: string
  ): Promise<Result<T | null, AppError>> {
    try {
      const clientResult = await this.getClient();
      if (!clientResult.success) {
        return Result.err(clientResult.error);
      }

      const { data, error } = await clientResult.data
        .from(table)
        .select(select || '*')
        .eq('id', id)
        .maybeSingle();

      if (error) {
        return Result.err(
          new AppError(ErrorCode.DATABASE_ERROR, `GetById failed in ${table}: ${error.message}`, {
            table,
            id,
            postgresError: error,
          })
        );
      }

      return Result.ok(data as T | null);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.DATABASE_ERROR,
          `GetById operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { table, id }
        )
      );
    }
  }

  /**
   * Count records with optional filtering
   */
  protected async count(
    table: string,
    filters?: Record<string, any>
  ): Promise<Result<number, AppError>> {
    try {
      const clientResult = await this.getClient();
      if (!clientResult.success) {
        return Result.err(clientResult.error);
      }

      let query = clientResult.data.from(table).select('id', { count: 'exact', head: true });

      // Apply filters
      if (filters) {
        Object.entries(filters).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            query = query.eq(key, value);
          }
        });
      }

      const { count, error } = await query;

      if (error) {
        return Result.err(
          new AppError(ErrorCode.DATABASE_ERROR, `Count failed in ${table}: ${error.message}`, {
            table,
            filters,
            postgresError: error,
          })
        );
      }

      return Result.ok(count || 0);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.DATABASE_ERROR,
          `Count operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { table, filters }
        )
      );
    }
  }

  /**
   * Paginated query with comprehensive metadata
   */
  protected async paginate<T>(
    table: string,
    page: number = 1,
    pageSize: number = 10,
    filters?: Record<string, any>,
    orderBy?: string,
    ascending: boolean = true
  ): Promise<Result<PaginatedResponse<T>, AppError>> {
    try {
      const offset = (page - 1) * pageSize;

      // Get total count
      const countResult = await this.count(table, filters);
      if (!countResult.success) {
        return Result.err(countResult.error);
      }

      // Get paginated data
      const dataResult = await this.select<T>(table, filters, {
        limit: pageSize,
        offset,
        orderBy,
        ascending,
      });

      if (!dataResult.success) {
        return Result.err(dataResult.error);
      }

      const totalCount = countResult.data;
      const totalPages = Math.ceil(totalCount / pageSize);

      return Result.ok({
        data: dataResult.data,
        count: totalCount,
        page,
        pageSize,
        hasMore: page < totalPages,
      });
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.DATABASE_ERROR,
          `Pagination failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { table, page, pageSize, filters }
        )
      );
    }
  }

  /**
   * Bulk insert operation with transaction support
   */
  protected async bulkInsert<T extends Record<string, any>>(
    table: string,
    data: T[]
  ): Promise<Result<T[], AppError>> {
    try {
      const clientResult = await this.getClient();
      if (!clientResult.success) {
        return Result.err(clientResult.error);
      }

      if (data.length === 0) {
        return Result.ok([]);
      }

      const { data: result, error } = await clientResult.data.from(table).insert(data).select();

      if (error) {
        return Result.err(
          new AppError(
            ErrorCode.DATABASE_ERROR,
            `Bulk insert failed in ${table}: ${error.message}`,
            { table, count: data.length, postgresError: error }
          )
        );
      }

      return Result.ok(result as T[]);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.DATABASE_ERROR,
          `Bulk insert operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { table, count: data.length }
        )
      );
    }
  }

  /**
   * Execute a stored procedure/function
   */
  protected async rpc<T>(
    functionName: string,
    params?: Record<string, any>
  ): Promise<Result<T, AppError>> {
    try {
      const clientResult = await this.getClient();
      if (!clientResult.success) {
        return Result.err(clientResult.error);
      }

      const { data, error } = await clientResult.data.rpc(functionName, params);

      if (error) {
        return Result.err(
          new AppError(
            ErrorCode.DATABASE_ERROR,
            `RPC call failed for ${functionName}: ${error.message}`,
            { functionName, params, postgresError: error }
          )
        );
      }

      return Result.ok(data as T);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.DATABASE_ERROR,
          `RPC operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { functionName, params }
        )
      );
    }
  }

  /**
   * Test database connectivity and permissions
   */
  async testConnection(): Promise<Result<boolean, AppError>> {
    try {
      const clientResult = await this.getClient();
      if (!clientResult.success) {
        return Result.err(clientResult.error);
      }

      // Test basic connectivity with a simple query
      const { error } = await clientResult.data
        .from(DATABASE_TABLES.USER_PROFILES)
        .select('id')
        .limit(1);

      if (error && error.code === '42P01') {
        return Result.err(
          new AppError(
            ErrorCode.DATABASE_ERROR,
            'Database tables not found. Please run migrations.',
            { postgresError: error }
          )
        );
      } else if (error) {
        return Result.err(
          new AppError(
            ErrorCode.DATABASE_ERROR,
            `Database connection test failed: ${error.message}`,
            { postgresError: error }
          )
        );
      }

      return Result.ok(true);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.DATABASE_ERROR,
          `Connection test failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      );
    }
  }
}

// Export the base service for inheritance
export default SupabaseService;
