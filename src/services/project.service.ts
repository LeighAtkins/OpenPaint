// Project management service with comprehensive CRUD operations
import { SupabaseService } from './supabase.service';
import { storageService } from './storage.service';
import { authService } from './auth.service';
import { DATABASE_TABLES, STORAGE_BUCKETS } from '@/config/supabase.config';
import { Result } from '@/utils/result';
import { AppError, ErrorCode } from '@/types/app.types';
import type {
  ProjectRow,
  ProjectInsert,
  ProjectUpdate,
  ProjectImageRow,
  ProjectImageInsert,
  ProjectData,
  ProjectSettings,
  ProjectMetadata,
  ImageData,
  MeasurementData,
  PaginatedResponse,
  ProjectSummary,
  FabricObjectData,
} from '@/types/supabase.types';

// Project query options
export interface ProjectQueryOptions {
  includeImages?: boolean;
  includeMeasurements?: boolean;
  includeSharedProjects?: boolean;
  tags?: string[];
  search?: string;
  sortBy?: 'created_at' | 'updated_at' | 'name';
  sortOrder?: 'asc' | 'desc';
}

// Project creation data
export interface CreateProjectData {
  name: string;
  description?: string;
  settings?: Partial<ProjectSettings>;
  isPublic?: boolean;
  tags?: string[];
}

// Project update data
export interface UpdateProjectData {
  name?: string;
  description?: string;
  settings?: Partial<ProjectSettings>;
  isPublic?: boolean;
  tags?: string[];
  thumbnailFile?: File;
}

// Default project settings
const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  units: 'px',
  defaultStrokeWidth: 2,
  defaultColor: '#000000',
  autoSave: true,
  showGrid: false,
  snapToGrid: false,
  gridSize: 20,
};

/**
 * Project management service with full lifecycle support
 */
export class ProjectService extends SupabaseService {
  /**
   * Create a new project
   */
  async createProject(data: CreateProjectData): Promise<Result<ProjectRow, AppError>> {
    try {
      const currentUser = authService.getCurrentUser();
      if (!currentUser) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'Must be authenticated to create projects')
        );
      }

      // Validate project name
      const validationResult = this.validateProjectName(data.name);
      if (!validationResult.success) {
        return Result.err(validationResult.error);
      }

      // Create project metadata
      const now = new Date().toISOString();
      const projectMetadata: ProjectMetadata = {
        createdBy: currentUser.id,
        createdAt: now,
        lastModifiedBy: currentUser.id,
        lastModifiedAt: now,
        totalImages: 0,
        totalMeasurements: 0,
        projectSize: 0,
        exportHistory: [],
      };

      // Create project data structure
      const projectData: ProjectData = {
        version: '2.0.0',
        images: {},
        measurements: {},
        settings: { ...DEFAULT_PROJECT_SETTINGS, ...data.settings },
        metadata: projectMetadata,
      };

      // Create project record
      const projectInsert: ProjectInsert = {
        user_id: currentUser.id,
        name: data.name.trim(),
        description: data.description?.trim(),
        data: projectData,
        tags: data.tags || [],
        is_public: data.isPublic || false,
        version: 1,
      };

      const result = await this.insert<ProjectRow>(DATABASE_TABLES.PROJECTS, projectInsert);
      if (!result.success) {
        return Result.err(result.error);
      }

      return Result.ok(result.data);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.DATABASE_ERROR,
          `Failed to create project: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { projectData: data }
        )
      );
    }
  }

  /**
   * Get a project by ID with optional related data
   */
  async getProject(
    projectId: string,
    options: ProjectQueryOptions = {}
  ): Promise<Result<ProjectRow & { images?: ProjectImageRow[] }, AppError>> {
    try {
      const currentUser = authService.getCurrentUser();
      if (!currentUser) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'Must be authenticated to access projects')
        );
      }

      // Get project
      const projectResult = await this.getById<ProjectRow>(DATABASE_TABLES.PROJECTS, projectId);

      if (!projectResult.success) {
        return Result.err(projectResult.error);
      }

      if (!projectResult.data) {
        return Result.err(
          new AppError(ErrorCode.VALIDATION_ERROR, 'Project not found', { projectId })
        );
      }

      const project = projectResult.data;

      // Check access permissions
      const hasAccess = await this.checkProjectAccess(project, currentUser.id);
      if (!hasAccess.success) {
        return Result.err(hasAccess.error);
      }

      // Include images if requested
      let projectWithImages = project as ProjectRow & { images?: ProjectImageRow[] };

      if (options.includeImages) {
        const imagesResult = await this.select<ProjectImageRow>(
          DATABASE_TABLES.PROJECT_IMAGES,
          { project_id: projectId },
          { orderBy: 'uploaded_at', ascending: true }
        );

        if (imagesResult.success) {
          projectWithImages.images = imagesResult.data;
        }
      }

      return Result.ok(projectWithImages);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.DATABASE_ERROR,
          `Failed to get project: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { projectId, options }
        )
      );
    }
  }

  /**
   * Update a project with optimistic concurrency control
   */
  async updateProject(
    projectId: string,
    data: UpdateProjectData,
    currentVersion?: number
  ): Promise<Result<ProjectRow, AppError>> {
    try {
      const currentUser = authService.getCurrentUser();
      if (!currentUser) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'Must be authenticated to update projects')
        );
      }

      // Get current project
      const projectResult = await this.getProject(projectId);
      if (!projectResult.success) {
        return Result.err(projectResult.error);
      }

      const project = projectResult.data;

      // Check ownership
      if (project.user_id !== currentUser.id) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'Not authorized to update this project')
        );
      }

      // Validate project name if being updated
      if (data.name) {
        const validationResult = this.validateProjectName(data.name);
        if (!validationResult.success) {
          return Result.err(validationResult.error);
        }
      }

      // Generate thumbnail if file provided
      let thumbnailUrl: string | undefined;
      if (data.thumbnailFile) {
        const thumbnailResult = await this.generateProjectThumbnail(projectId, data.thumbnailFile);
        if (thumbnailResult.success) {
          thumbnailUrl = thumbnailResult.data;
        }
      }

      // Update project data
      const updatedProjectData: ProjectData = {
        ...project.data,
        settings: data.settings
          ? { ...project.data.settings, ...data.settings }
          : project.data.settings,
        metadata: {
          ...project.data.metadata,
          lastModifiedBy: currentUser.id,
          lastModifiedAt: new Date().toISOString(),
        },
      };

      // Prepare update
      const updateData: ProjectUpdate = {
        ...(data.name && { name: data.name.trim() }),
        ...(data.description !== undefined && { description: data.description?.trim() }),
        ...(data.isPublic !== undefined && { is_public: data.isPublic }),
        ...(data.tags && { tags: data.tags }),
        ...(thumbnailUrl && { thumbnail_url: thumbnailUrl }),
        data: updatedProjectData,
        updated_at: new Date().toISOString(),
        version: project.version + 1,
      };

      const result = await this.update<ProjectRow>(
        DATABASE_TABLES.PROJECTS,
        projectId,
        updateData,
        currentVersion || project.version
      );

      return result;
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.DATABASE_ERROR,
          `Failed to update project: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { projectId, data }
        )
      );
    }
  }

  /**
   * Delete a project and all associated data
   */
  async deleteProject(projectId: string): Promise<Result<boolean, AppError>> {
    try {
      const currentUser = authService.getCurrentUser();
      if (!currentUser) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'Must be authenticated to delete projects')
        );
      }

      // Get project to check ownership
      const projectResult = await this.getProject(projectId, { includeImages: true });
      if (!projectResult.success) {
        return Result.err(projectResult.error);
      }

      const project = projectResult.data;

      if (project.user_id !== currentUser.id) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'Not authorized to delete this project')
        );
      }

      // Delete associated images from storage
      if (project.images && project.images.length > 0) {
        const imagePaths = project.images.map(img => img.storage_path);
        await storageService.deleteFiles('PROJECT_IMAGES', imagePaths);

        // Delete image records
        for (const image of project.images) {
          await this.delete(DATABASE_TABLES.PROJECT_IMAGES, image.id);
        }
      }

      // Delete thumbnail if exists
      if (project.thumbnail_url) {
        // Extract path from URL and delete
        // This is a simplified approach - in production you'd need proper path extraction
        const thumbnailPath = project.thumbnail_url.split('/').pop();
        if (thumbnailPath) {
          await storageService.deleteFile('PROJECT_THUMBNAILS', thumbnailPath);
        }
      }

      // Delete project
      const deleteResult = await this.delete(DATABASE_TABLES.PROJECTS, projectId);
      return deleteResult;
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.DATABASE_ERROR,
          `Failed to delete project: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { projectId }
        )
      );
    }
  }

  /**
   * List projects for the current user with pagination and filtering
   */
  async listProjects(
    page: number = 1,
    pageSize: number = 20,
    options: ProjectQueryOptions = {}
  ): Promise<Result<PaginatedResponse<ProjectSummary>, AppError>> {
    try {
      const currentUser = authService.getCurrentUser();
      if (!currentUser) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'Must be authenticated to list projects')
        );
      }

      // Build filters
      const filters: Record<string, any> = {
        user_id: currentUser.id,
      };

      // Add tag filtering if specified
      if (options.tags && options.tags.length > 0) {
        // This would require a more complex query in production
        // For now, we'll filter in memory after retrieval
      }

      // Get projects with pagination
      const result = await this.paginate<ProjectRow>(
        DATABASE_TABLES.PROJECTS,
        page,
        pageSize,
        filters,
        options.sortBy || 'updated_at',
        options.sortOrder === 'asc'
      );

      if (!result.success) {
        return Result.err(result.error);
      }

      // Transform to summaries
      const summaries: ProjectSummary[] = result.data.data.map(project => ({
        id: project.id,
        name: project.name,
        description: project.description,
        thumbnail_url: project.thumbnail_url,
        tags: project.tags,
        created_at: project.created_at,
        updated_at: project.updated_at,
        image_count: project.data.metadata.totalImages,
        measurement_count: project.data.metadata.totalMeasurements,
        is_public: project.is_public,
      }));

      // Apply client-side filtering
      let filteredSummaries = summaries;

      // Filter by tags
      if (options.tags && options.tags.length > 0) {
        filteredSummaries = summaries.filter(project =>
          options.tags!.some(tag => project.tags.includes(tag))
        );
      }

      // Search filter
      if (options.search) {
        const searchLower = options.search.toLowerCase();
        filteredSummaries = filteredSummaries.filter(
          project =>
            project.name.toLowerCase().includes(searchLower) ||
            (project.description && project.description.toLowerCase().includes(searchLower)) ||
            project.tags.some(tag => tag.toLowerCase().includes(searchLower))
        );
      }

      return Result.ok({
        data: filteredSummaries,
        count: result.data.count,
        page,
        pageSize,
        hasMore: result.data.hasMore,
      });
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.DATABASE_ERROR,
          `Failed to list projects: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { page, pageSize, options }
        )
      );
    }
  }

  /**
   * Duplicate a project
   */
  async duplicateProject(
    projectId: string,
    newName: string
  ): Promise<Result<ProjectRow, AppError>> {
    try {
      const currentUser = authService.getCurrentUser();
      if (!currentUser) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'Must be authenticated to duplicate projects')
        );
      }

      // Get original project
      const originalResult = await this.getProject(projectId, { includeImages: true });
      if (!originalResult.success) {
        return Result.err(originalResult.error);
      }

      const original = originalResult.data;

      // Check access
      const hasAccess = await this.checkProjectAccess(original, currentUser.id);
      if (!hasAccess.success) {
        return Result.err(hasAccess.error);
      }

      // Create new project data
      const createData: CreateProjectData = {
        name: newName,
        description: `Copy of ${original.name}`,
        settings: original.data.settings,
        isPublic: false, // Copies are private by default
        tags: [...original.tags],
      };

      const newProjectResult = await this.createProject(createData);
      if (!newProjectResult.success) {
        return Result.err(newProjectResult.error);
      }

      const newProject = newProjectResult.data;

      // Duplicate images if any
      if (original.images && original.images.length > 0) {
        for (const image of original.images) {
          await this.duplicateProjectImage(image, newProject.id);
        }
      }

      return Result.ok(newProject);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.DATABASE_ERROR,
          `Failed to duplicate project: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { projectId, newName }
        )
      );
    }
  }

  /**
   * Get project statistics for a user
   */
  async getUserProjectStats(userId?: string): Promise<
    Result<
      {
        totalProjects: number;
        publicProjects: number;
        totalImages: number;
        totalMeasurements: number;
        storageUsed: number;
        recentActivity: ProjectSummary[];
      },
      AppError
    >
  > {
    try {
      const currentUser = authService.getCurrentUser();
      if (!currentUser) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'Must be authenticated to get project stats')
        );
      }

      const targetUserId = userId || currentUser.id;

      // Get all projects for user
      const projectsResult = await this.select<ProjectRow>(
        DATABASE_TABLES.PROJECTS,
        { user_id: targetUserId },
        { orderBy: 'updated_at', ascending: false, limit: 1000 }
      );

      if (!projectsResult.success) {
        return Result.err(projectsResult.error);
      }

      const projects = projectsResult.data;

      // Calculate statistics
      const stats = {
        totalProjects: projects.length,
        publicProjects: projects.filter(p => p.is_public).length,
        totalImages: projects.reduce((sum, p) => sum + p.data.metadata.totalImages, 0),
        totalMeasurements: projects.reduce((sum, p) => sum + p.data.metadata.totalMeasurements, 0),
        storageUsed: projects.reduce((sum, p) => sum + p.data.metadata.projectSize, 0),
        recentActivity: projects.slice(0, 5).map(project => ({
          id: project.id,
          name: project.name,
          description: project.description,
          thumbnail_url: project.thumbnail_url,
          tags: project.tags,
          created_at: project.created_at,
          updated_at: project.updated_at,
          image_count: project.data.metadata.totalImages,
          measurement_count: project.data.metadata.totalMeasurements,
          is_public: project.is_public,
        })),
      };

      return Result.ok(stats);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.DATABASE_ERROR,
          `Failed to get project stats: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { userId }
        )
      );
    }
  }

  /**
   * Update project canvas data (images, measurements, objects)
   */
  async updateProjectCanvasData(
    projectId: string,
    imageLabel: string,
    fabricObjects: FabricObjectData[],
    measurements: MeasurementData[]
  ): Promise<Result<ProjectRow, AppError>> {
    try {
      const currentUser = authService.getCurrentUser();
      if (!currentUser) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'Must be authenticated to update project data')
        );
      }

      // Get current project
      const projectResult = await this.getProject(projectId);
      if (!projectResult.success) {
        return Result.err(projectResult.error);
      }

      const project = projectResult.data;

      // Check ownership
      if (project.user_id !== currentUser.id) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'Not authorized to update this project')
        );
      }

      // Update project data
      const updatedData = { ...project.data };

      // Update image data
      if (updatedData.images[imageLabel]) {
        updatedData.images[imageLabel] = {
          ...updatedData.images[imageLabel],
          objects: fabricObjects,
          measurements: measurements.map(m => m.id),
        };
      }

      // Update measurements
      measurements.forEach(measurement => {
        updatedData.measurements[measurement.id] = measurement;
      });

      // Update metadata
      updatedData.metadata = {
        ...updatedData.metadata,
        lastModifiedBy: currentUser.id,
        lastModifiedAt: new Date().toISOString(),
        totalMeasurements: Object.keys(updatedData.measurements).length,
      };

      // Save to database
      const updateResult = await this.update<ProjectRow>(
        DATABASE_TABLES.PROJECTS,
        projectId,
        {
          data: updatedData,
          updated_at: new Date().toISOString(),
          version: project.version + 1,
        },
        project.version
      );

      return updateResult;
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.DATABASE_ERROR,
          `Failed to update canvas data: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { projectId, imageLabel }
        )
      );
    }
  }

  /**
   * Check if user has access to a project
   */
  private async checkProjectAccess(
    project: ProjectRow,
    userId: string
  ): Promise<Result<boolean, AppError>> {
    // Owner always has access
    if (project.user_id === userId) {
      return Result.ok(true);
    }

    // Public projects can be read by anyone
    if (project.is_public) {
      return Result.ok(true);
    }

    // Private project - no access
    return Result.err(new AppError(ErrorCode.AUTH_ERROR, 'Access denied to private project'));
  }

  /**
   * Validate project name
   */
  private validateProjectName(name: string): Result<true, AppError> {
    if (!name || name.trim().length === 0) {
      return Result.err(new AppError(ErrorCode.VALIDATION_ERROR, 'Project name cannot be empty'));
    }

    if (name.trim().length > 100) {
      return Result.err(
        new AppError(ErrorCode.VALIDATION_ERROR, 'Project name cannot exceed 100 characters')
      );
    }

    return Result.ok(true);
  }

  /**
   * Generate thumbnail for project
   */
  private async generateProjectThumbnail(
    projectId: string,
    thumbnailFile: File
  ): Promise<Result<string, AppError>> {
    try {
      const currentUser = authService.getCurrentUser();
      if (!currentUser) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'Must be authenticated to upload thumbnail')
        );
      }

      // Upload thumbnail
      const uploadResult = await storageService.uploadProjectThumbnail(
        currentUser.id,
        projectId,
        thumbnailFile
      );

      if (!uploadResult.success) {
        return Result.err(uploadResult.error);
      }

      // Return the public URL
      return Result.ok(uploadResult.data.metadata.publicUrl);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.STORAGE_ERROR,
          `Failed to generate thumbnail: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { projectId }
        )
      );
    }
  }

  /**
   * Duplicate project image to new project
   */
  private async duplicateProjectImage(
    originalImage: ProjectImageRow,
    newProjectId: string
  ): Promise<Result<ProjectImageRow, AppError>> {
    try {
      const currentUser = authService.getCurrentUser();
      if (!currentUser) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'Must be authenticated to duplicate images')
        );
      }

      // Copy storage file
      const newStoragePath = originalImage.storage_path.replace(
        originalImage.project_id,
        newProjectId
      );

      const copyResult = await storageService.copyFile(
        'PROJECT_IMAGES',
        originalImage.storage_path,
        'PROJECT_IMAGES',
        newStoragePath
      );

      if (!copyResult.success) {
        return Result.err(copyResult.error);
      }

      // Create new image record
      const newImageData: ProjectImageInsert = {
        project_id: newProjectId,
        label: originalImage.label,
        filename: originalImage.filename,
        storage_path: copyResult.data,
        mime_type: originalImage.mime_type,
        size_bytes: originalImage.size_bytes,
        width: originalImage.width,
        height: originalImage.height,
        metadata: originalImage.metadata,
      };

      const insertResult = await this.insert<ProjectImageRow>(
        DATABASE_TABLES.PROJECT_IMAGES,
        newImageData
      );

      return insertResult;
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.DATABASE_ERROR,
          `Failed to duplicate image: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { originalImageId: originalImage.id, newProjectId }
        )
      );
    }
  }
}

// Export service instance
export const projectService = new ProjectService();
