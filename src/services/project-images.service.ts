// Project image management service
import { SupabaseService } from './supabase/client';
import { storageService } from './supabase/storage.service';
import { authService } from './auth/authService';
import { projectService } from './supabase/project.service';
import { DATABASE_TABLES } from '@/config/supabase.config';
import { Result } from '@/utils/result';
import { AppError, ErrorCode } from '@/types/app.types';
import type {
  ProjectImageRow,
  ProjectImageUpdate,
  ImageData,
  ImageMetadata,
  ProjectData,
} from '@/types/supabase.types';

// Image upload options
export interface ImageUploadOptions {
  generateThumbnail?: boolean;
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  preserveExif?: boolean;
}

// Image processing result
export interface ImageProcessingResult {
  width: number;
  height: number;
  size: number;
  format: string;
  hasAlpha: boolean;
  exifData?: Record<string, unknown>;
}

// Bulk upload progress callback
export type UploadProgressCallback = (
  completed: number,
  total: number,
  currentFile: string
) => void;

/**
 * Service for managing project images with advanced processing capabilities
 */
export class ProjectImagesService extends SupabaseService {
  /**
   * Upload a single image to a project
   */
  async uploadImage(
    projectId: string,
    label: string,
    file: File,
    options: ImageUploadOptions = {}
  ): Promise<Result<ProjectImageRow, AppError>> {
    try {
      const currentUser = authService.getCurrentUser();
      if (!currentUser) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'Must be authenticated to upload images')
        );
      }

      // Validate project access
      const projectResult = await projectService.getProject(projectId);
      if (!projectResult.success) {
        return Result.err(projectResult.error);
      }

      const project = projectResult.data;
      if (project.created_by !== currentUser.id) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'Not authorized to upload images to this project')
        );
      }

      // Check if label already exists in project
      const labelExistsResult = await this.checkLabelExists(projectId, label);
      if (!labelExistsResult.success) {
        return Result.err(labelExistsResult.error);
      }

      if (labelExistsResult.data) {
        return Result.err(
          new AppError(
            ErrorCode.VALIDATION_ERROR,
            `An image with label "${label}" already exists in this project`
          )
        );
      }

      // Process image if needed
      const processedFile = await this.processImageFile(file, options);
      if (!processedFile.success) {
        return Result.err(processedFile.error);
      }

      // Upload to storage
      const uploadResult = await storageService.uploadProjectImage(
        currentUser.id,
        projectId,
        processedFile.data.file,
        label
      );

      if (!uploadResult.success) {
        return Result.err(uploadResult.error);
      }

      // Insert image record
      const insertResult = await this.insert<ProjectImageRow>(
        DATABASE_TABLES.PROJECT_IMAGES,
        uploadResult.data as any
      );

      if (!insertResult.success) {
        // Clean up uploaded file on database failure
        await storageService.deleteFile('PROJECT_IMAGES', uploadResult.data.storage_path);
        return Result.err(insertResult.error);
      }

      // Update project metadata
      await this.updateProjectImageCount(projectId, 1);

      // Update project data structure
      await this.addImageToProjectData(projectId, label, insertResult.data);

      return Result.ok(insertResult.data);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.STORAGE_ERROR,
          `Failed to upload image: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { projectId, label, fileName: file.name }
        )
      );
    }
  }

  /**
   * Upload multiple images to a project with progress tracking
   */
  async uploadMultipleImages(
    projectId: string,
    files: Array<{ label: string; file: File }>,
    options: ImageUploadOptions = {},
    onProgress?: UploadProgressCallback
  ): Promise<
    Result<
      {
        successful: ProjectImageRow[];
        failed: Array<{ label: string; error: string }>;
      },
      AppError
    >
  > {
    try {
      const currentUser = authService.getCurrentUser();
      if (!currentUser) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'Must be authenticated to upload images')
        );
      }

      // Validate project access
      const projectResult = await projectService.getProject(projectId);
      if (!projectResult.success) {
        return Result.err(projectResult.error);
      }

      const project = projectResult.data;
      if (project.created_by !== currentUser.id) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'Not authorized to upload images to this project')
        );
      }

      const results = {
        successful: [] as ProjectImageRow[],
        failed: [] as Array<{ label: string; error: string }>,
      };

      // Upload files sequentially to avoid overwhelming the system
      for (let i = 0; i < files.length; i++) {
        const fileEntry = files[i];
        if (!fileEntry) continue;

        const { label, file } = fileEntry;

        try {
          onProgress?.(i, files.length, file.name);

          const uploadResult = await this.uploadImage(projectId, label, file, options);

          if (uploadResult.success) {
            results.successful.push(uploadResult.data);
          } else {
            results.failed.push({
              label,
              error: uploadResult.error.message,
            });
          }
        } catch (error) {
          results.failed.push({
            label,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      onProgress?.(files.length, files.length, 'Complete');

      return Result.ok(results);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.STORAGE_ERROR,
          `Failed to upload multiple images: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { projectId, fileCount: files.length }
        )
      );
    }
  }

  /**
   * Replace an existing image in a project
   */
  async replaceImage(
    projectId: string,
    imageId: string,
    newFile: File,
    options: ImageUploadOptions = {}
  ): Promise<Result<ProjectImageRow, AppError>> {
    try {
      const currentUser = authService.getCurrentUser();
      if (!currentUser) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'Must be authenticated to replace images')
        );
      }

      // Get current image
      const currentImageResult = await this.getById<ProjectImageRow>(
        DATABASE_TABLES.PROJECT_IMAGES,
        imageId
      );

      if (!currentImageResult.success || !currentImageResult.data) {
        return Result.err(new AppError(ErrorCode.VALIDATION_ERROR, 'Image not found'));
      }

      const currentImage = currentImageResult.data;

      // Validate project access
      const projectResult = await projectService.getProject(currentImage.project_id);
      if (!projectResult.success) {
        return Result.err(projectResult.error);
      }

      const project = projectResult.data;
      if (project.created_by !== currentUser.id) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'Not authorized to modify images in this project')
        );
      }

      // Process new file
      const processedFile = await this.processImageFile(newFile, options);
      if (!processedFile.success) {
        return Result.err(processedFile.error);
      }

      // Upload new image
      const uploadResult = await storageService.uploadProjectImage(
        currentUser.id,
        projectId,
        processedFile.data.file,
        currentImage.label
      );

      if (!uploadResult.success) {
        return Result.err(uploadResult.error);
      }

      // Delete old image from storage
      await storageService.deleteFile('PROJECT_IMAGES', currentImage.storage_path);

      // Update image record
      const updateData: ProjectImageUpdate = {
        filename: newFile.name,
        storage_path: uploadResult.data.storage_path,
        mime_type: newFile.type,
        size_bytes: processedFile.data.file.size,
        width: processedFile.data.processing.width,
        height: processedFile.data.processing.height,
        uploaded_at: new Date().toISOString(),
        metadata: {
          ...uploadResult.data.metadata,
          replacedAt: new Date().toISOString(),
          originalFilename: currentImage.filename,
          processing: processedFile.data.processing,
        },
      };

      const updateResult = await this.update<ProjectImageRow>(
        DATABASE_TABLES.PROJECT_IMAGES,
        imageId,
        updateData
      );

      if (!updateResult.success) {
        // Clean up new file if update fails
        await storageService.deleteFile('PROJECT_IMAGES', uploadResult.data.storage_path);
        return Result.err(updateResult.error);
      }

      return Result.ok(updateResult.data);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.STORAGE_ERROR,
          `Failed to replace image: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { projectId, imageId, fileName: newFile.name }
        )
      );
    }
  }

  /**
   * Delete an image from a project
   */
  async deleteImage(imageId: string): Promise<Result<boolean, AppError>> {
    try {
      const currentUser = authService.getCurrentUser();
      if (!currentUser) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'Must be authenticated to delete images')
        );
      }

      // Get image
      const imageResult = await this.getById<ProjectImageRow>(
        DATABASE_TABLES.PROJECT_IMAGES,
        imageId
      );

      if (!imageResult.success || !imageResult.data) {
        return Result.err(new AppError(ErrorCode.VALIDATION_ERROR, 'Image not found'));
      }

      const image = imageResult.data;

      // Validate project access
      const projectResult = await projectService.getProject(image.project_id);
      if (!projectResult.success) {
        return Result.err(projectResult.error);
      }

      const project = projectResult.data;
      if (project.created_by !== currentUser.id) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'Not authorized to delete images from this project')
        );
      }

      // Delete from storage
      await storageService.deleteFile('PROJECT_IMAGES', image.storage_path);

      // Delete thumbnail if exists
      if (image.metadata?.['thumbnailPath']) {
        await storageService.deleteFile(
          'PROJECT_THUMBNAILS',
          image.metadata['thumbnailPath'] as string
        );
      }

      // Delete from database
      const deleteResult = await this.delete(DATABASE_TABLES.PROJECT_IMAGES, imageId);
      if (!deleteResult.success) {
        return Result.err(deleteResult.error);
      }

      // Update project metadata
      await this.updateProjectImageCount(image.project_id, -1);

      // Remove from project data structure
      await this.removeImageFromProjectData(image.project_id, image.label);

      return Result.ok(true);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.STORAGE_ERROR,
          `Failed to delete image: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { imageId }
        )
      );
    }
  }

  /**
   * Get all images for a project
   */
  async getProjectImages(projectId: string): Promise<Result<ProjectImageRow[], AppError>> {
    try {
      const currentUser = authService.getCurrentUser();
      if (!currentUser) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'Must be authenticated to view images')
        );
      }

      // Validate project access
      const projectResult = await projectService.getProject(projectId);
      if (!projectResult.success) {
        return Result.err(projectResult.error);
      }

      // Get images
      const imagesResult = await this.select<ProjectImageRow>(
        DATABASE_TABLES.PROJECT_IMAGES,
        { project_id: projectId },
        { orderBy: 'uploaded_at', ascending: true }
      );

      return imagesResult;
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.DATABASE_ERROR,
          `Failed to get project images: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { projectId }
        )
      );
    }
  }

  /**
   * Update image metadata (tags, description, etc.)
   */
  async updateImageMetadata(
    imageId: string,
    metadata: Partial<ImageMetadata>
  ): Promise<Result<ProjectImageRow, AppError>> {
    try {
      const currentUser = authService.getCurrentUser();
      if (!currentUser) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'Must be authenticated to update image metadata')
        );
      }

      // Get image and validate access
      const imageResult = await this.getById<ProjectImageRow>(
        DATABASE_TABLES.PROJECT_IMAGES,
        imageId
      );

      if (!imageResult.success || !imageResult.data) {
        return Result.err(new AppError(ErrorCode.VALIDATION_ERROR, 'Image not found'));
      }

      const image = imageResult.data;

      // Validate project access
      const projectResult = await projectService.getProject(image.project_id);
      if (!projectResult.success) {
        return Result.err(projectResult.error);
      }

      const project = projectResult.data;
      if (project.created_by !== currentUser.id) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'Not authorized to modify images in this project')
        );
      }

      // Update metadata
      const updatedMetadata = {
        ...image.metadata,
        ...metadata,
        updatedAt: new Date().toISOString(),
      };

      const updateResult = await this.update<ProjectImageRow>(
        DATABASE_TABLES.PROJECT_IMAGES,
        imageId,
        { metadata: updatedMetadata }
      );

      return updateResult;
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.DATABASE_ERROR,
          `Failed to update image metadata: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { imageId }
        )
      );
    }
  }

  /**
   * Get image processing information
   */
  async getImageInfo(imageId: string): Promise<
    Result<
      {
        image: ProjectImageRow;
        signedUrl: string;
        thumbnailUrl?: string;
      },
      AppError
    >
  > {
    try {
      const currentUser = authService.getCurrentUser();
      if (!currentUser) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'Must be authenticated to view image info')
        );
      }

      // Get image
      const imageResult = await this.getById<ProjectImageRow>(
        DATABASE_TABLES.PROJECT_IMAGES,
        imageId
      );

      if (!imageResult.success || !imageResult.data) {
        return Result.err(new AppError(ErrorCode.VALIDATION_ERROR, 'Image not found'));
      }

      const image = imageResult.data;

      // Validate project access
      const projectResult = await projectService.getProject(image.project_id);
      if (!projectResult.success) {
        return Result.err(projectResult.error);
      }

      // Get signed URL for image
      const signedUrlResult = await storageService.getSignedUrl(
        'PROJECT_IMAGES',
        image.storage_path,
        3600 // 1 hour
      );

      if (!signedUrlResult.success) {
        return Result.err(signedUrlResult.error);
      }

      // Get thumbnail URL if available
      const resultData: { image: ProjectImageRow; signedUrl: string; thumbnailUrl?: string } = {
        image,
        signedUrl: signedUrlResult.data,
      };

      if (image.metadata?.['thumbnailPath']) {
        const thumbnailResult = await storageService.getSignedUrl(
          'PROJECT_THUMBNAILS',
          image.metadata['thumbnailPath'] as string,
          3600
        );
        if (thumbnailResult.success) {
          resultData.thumbnailUrl = thumbnailResult.data;
        }
      }

      return Result.ok(resultData);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.DATABASE_ERROR,
          `Failed to get image info: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { imageId }
        )
      );
    }
  }

  /**
   * Process image file with optional transformations
   */
  private async processImageFile(
    file: File,
    options: ImageUploadOptions
  ): Promise<
    Result<
      {
        file: File;
        processing: ImageProcessingResult;
      },
      AppError
    >
  > {
    try {
      // Basic processing - get image dimensions
      const dimensions = await this.getImageDimensions(file);
      if (!dimensions.success) {
        return Result.err(dimensions.error);
      }

      const processing: ImageProcessingResult = {
        width: dimensions.data.width,
        height: dimensions.data.height,
        size: file.size,
        format: file.type,
        hasAlpha: file.type === 'image/png' || file.type === 'image/webp',
      };

      // For now, return the original file
      // In a production environment, you might want to:
      // - Resize images that exceed maxWidth/maxHeight
      // - Compress images based on quality setting
      // - Strip EXIF data if preserveExif is false
      // - Convert formats for optimization

      return Result.ok({
        file,
        processing,
      });
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.STORAGE_ERROR,
          `Failed to process image: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { fileName: file.name, options }
        )
      );
    }
  }

  /**
   * Get image dimensions from file
   */
  private async getImageDimensions(
    file: File
  ): Promise<Result<{ width: number; height: number }, AppError>> {
    return new Promise(resolve => {
      const img = new Image();
      const url = URL.createObjectURL(file);

      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(Result.ok({ width: img.naturalWidth, height: img.naturalHeight }));
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(
          Result.err(
            new AppError(ErrorCode.STORAGE_ERROR, 'Failed to load image to get dimensions', {
              fileName: file.name,
            })
          )
        );
      };

      img.src = url;

      // Timeout after 10 seconds
      setTimeout(() => {
        URL.revokeObjectURL(url);
        resolve(
          Result.err(
            new AppError(ErrorCode.STORAGE_ERROR, 'Image dimension detection timed out', {
              fileName: file.name,
            })
          )
        );
      }, 10000);
    });
  }

  /**
   * Check if a label already exists in a project
   */
  private async checkLabelExists(
    projectId: string,
    label: string
  ): Promise<Result<boolean, AppError>> {
    try {
      const result = await this.select<ProjectImageRow>(
        DATABASE_TABLES.PROJECT_IMAGES,
        { project_id: projectId, label },
        { limit: 1 }
      );

      if (!result.success) {
        return Result.err(result.error);
      }

      return Result.ok(result.data.length > 0);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.DATABASE_ERROR,
          `Failed to check label existence: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { projectId, label }
        )
      );
    }
  }

  /**
   * Update project image count
   */
  private async updateProjectImageCount(projectId: string, delta: number): Promise<void> {
    try {
      const projectResult = await projectService.getProject(projectId);
      if (projectResult.success) {
        const project = projectResult.data;
        const updatedData = {
          ...project.data,
          metadata: {
            ...project.data.metadata,
            totalImages: Math.max(0, project.data.metadata.totalImages + delta),
            lastModifiedAt: new Date().toISOString(),
          },
        };

        await this.update(DATABASE_TABLES.PROJECTS, projectId, {
          data: updatedData,
          updated_at: new Date().toISOString(),
        });
      }
    } catch (error) {
      // Log error but don't fail the main operation
      console.error('Failed to update project image count:', error);
    }
  }

  /**
   * Add image to project data structure
   */
  private async addImageToProjectData(
    projectId: string,
    label: string,
    imageRecord: ProjectImageRow
  ): Promise<void> {
    try {
      const projectResult = await projectService.getProject(projectId);
      if (projectResult.success) {
        const project = projectResult.data;

        const imageData: ImageData = {
          label,
          filename: imageRecord.filename,
          width: imageRecord.width,
          height: imageRecord.height,
          objects: [],
          measurements: [],
          tags: [],
          metadata: {
            uploadedAt: imageRecord.uploaded_at,
            originalSize: imageRecord.size_bytes,
            processedSize: imageRecord.size_bytes,
            thumbnailGenerated: !!imageRecord.metadata?.['thumbnailUrl'],
          },
        };

        if (imageRecord.metadata?.['publicUrl']) {
          imageData.storageUrl = imageRecord.metadata['publicUrl'] as string;
        }

        const updatedData: ProjectData = {
          ...project.data,
          images: {
            ...project.data.images,
            [label]: imageData,
          },
        };

        await this.update(DATABASE_TABLES.PROJECTS, projectId, {
          data: updatedData,
          updated_at: new Date().toISOString(),
        });
      }
    } catch (error) {
      // Log error but don't fail the main operation
      console.error('Failed to add image to project data:', error);
    }
  }

  /**
   * Remove image from project data structure
   */
  private async removeImageFromProjectData(projectId: string, label: string): Promise<void> {
    try {
      const projectResult = await projectService.getProject(projectId);
      if (projectResult.success) {
        const project = projectResult.data;

        const updatedImages = { ...project.data.images };
        delete updatedImages[label];

        // Also remove associated measurements
        const updatedMeasurements = { ...project.data.measurements };
        Object.keys(updatedMeasurements).forEach(measurementId => {
          const measurement = updatedMeasurements[measurementId];
          if (measurement && measurement.imageLabel === label) {
            delete updatedMeasurements[measurementId];
          }
        });

        const updatedData: ProjectData = {
          ...project.data,
          images: updatedImages,
          measurements: updatedMeasurements,
          metadata: {
            ...project.data.metadata,
            totalMeasurements: Object.keys(updatedMeasurements).length,
          },
        };

        await this.update(DATABASE_TABLES.PROJECTS, projectId, {
          data: updatedData,
          updated_at: new Date().toISOString(),
        });
      }
    } catch (error) {
      // Log error but don't fail the main operation
      console.error('Failed to remove image from project data:', error);
    }
  }
}

// Export service instance
export const projectImagesService = new ProjectImagesService();
