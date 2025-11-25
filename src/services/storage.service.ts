// Cloud storage service for project images and files
import { SupabaseClient } from '@supabase/supabase-js';
import {
  getSupabaseClient,
  STORAGE_BUCKETS,
  getStorageUrl,
  getSignedStorageUrl,
  type Database,
} from '@/config/supabase.config';
import { Result } from '@/utils/result';
import { AppError, ErrorCode } from '@/types/app.types';
import type { StorageObject, ProjectImageInsert } from '@/types/supabase.types';

// File upload configuration
export interface UploadConfig {
  maxFileSizeMB: number;
  allowedMimeTypes: string[];
  generateThumbnail: boolean;
  compressionQuality: number;
}

// Default configurations for different file types
export const UPLOAD_CONFIGS = {
  PROJECT_IMAGES: {
    maxFileSizeMB: 50,
    allowedMimeTypes: [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'image/tiff',
      'image/bmp',
      'image/heic',
      'image/heif',
    ],
    generateThumbnail: true,
    compressionQuality: 0.85,
  },
  PROJECT_THUMBNAILS: {
    maxFileSizeMB: 5,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    generateThumbnail: false,
    compressionQuality: 0.75,
  },
  USER_AVATARS: {
    maxFileSizeMB: 10,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    generateThumbnail: true,
    compressionQuality: 0.8,
  },
} as const;

// Storage paths and naming conventions
export class StoragePathBuilder {
  static projectImage(userId: string, projectId: string, filename: string): string {
    const timestamp = Date.now();
    const extension = filename.split('.').pop();
    const cleanName = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    return `${userId}/${projectId}/images/${timestamp}_${cleanName}`;
  }

  static projectThumbnail(userId: string, projectId: string, filename: string): string {
    const timestamp = Date.now();
    const extension = filename.split('.').pop();
    const baseName = filename.replace(/\.[^/.]+$/, '');
    return `${userId}/${projectId}/thumbnails/${timestamp}_${baseName}_thumb.${extension}`;
  }

  static userAvatar(userId: string, filename: string): string {
    const timestamp = Date.now();
    const extension = filename.split('.').pop();
    return `${userId}/avatar_${timestamp}.${extension}`;
  }

  static tempUpload(userId: string, filename: string): string {
    const timestamp = Date.now();
    const cleanName = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    return `temp/${userId}/${timestamp}_${cleanName}`;
  }
}

/**
 * Cloud storage service for handling file uploads, downloads, and management
 */
export class StorageService {
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
   * Validate file before upload
   */
  private validateFile(file: File, config: UploadConfig): Result<true, AppError> {
    // Check file size
    const fileSizeMB = file.size / (1024 * 1024);
    if (fileSizeMB > config.maxFileSizeMB) {
      return Result.err(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          `File size ${fileSizeMB.toFixed(2)}MB exceeds maximum of ${config.maxFileSizeMB}MB`,
          { fileSize: fileSizeMB, maxSize: config.maxFileSizeMB }
        )
      );
    }

    // Check MIME type
    if (!config.allowedMimeTypes.includes(file.type)) {
      return Result.err(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          `File type ${file.type} is not allowed. Allowed types: ${config.allowedMimeTypes.join(', ')}`,
          { fileType: file.type, allowedTypes: config.allowedMimeTypes }
        )
      );
    }

    // Additional validation for images
    if (file.type.startsWith('image/')) {
      // Check if it's actually an image by trying to load it
      return this.validateImageFile(file);
    }

    return Result.ok(true);
  }

  /**
   * Validate that a file is actually a valid image
   */
  private validateImageFile(file: File): Result<true, AppError> {
    return new Promise(resolve => {
      const img = new Image();
      const url = URL.createObjectURL(file);

      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(Result.ok(true));
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(
          Result.err(
            new AppError(
              ErrorCode.VALIDATION_ERROR,
              'File appears to be corrupted or is not a valid image',
              { filename: file.name, fileType: file.type }
            )
          )
        );
      };

      img.src = url;

      // Timeout after 5 seconds
      setTimeout(() => {
        URL.revokeObjectURL(url);
        resolve(
          Result.err(
            new AppError(ErrorCode.VALIDATION_ERROR, 'Image validation timed out', {
              filename: file.name,
            })
          )
        );
      }, 5000);
    }) as Result<true, AppError>;
  }

  /**
   * Upload a file to a specified bucket with comprehensive error handling
   */
  async uploadFile(
    bucket: keyof typeof STORAGE_BUCKETS,
    path: string,
    file: File,
    config: UploadConfig,
    options?: {
      upsert?: boolean;
      cacheControl?: string;
      contentType?: string;
    }
  ): Promise<Result<{ path: string; url: string; metadata: any }, AppError>> {
    try {
      const clientResult = await this.getClient();
      if (!clientResult.success) {
        return Result.err(clientResult.error);
      }

      // Validate file
      const validationResult = await this.validateFile(file, config);
      if (!validationResult.success) {
        return Result.err(validationResult.error);
      }

      const bucketName = STORAGE_BUCKETS[bucket];

      // Upload file with metadata
      const { data, error } = await clientResult.data.storage.from(bucketName).upload(path, file, {
        cacheControl: options?.cacheControl || '3600',
        upsert: options?.upsert || false,
        contentType: options?.contentType || file.type,
      });

      if (error) {
        return Result.err(
          new AppError(ErrorCode.STORAGE_ERROR, `Upload failed: ${error.message}`, {
            bucket: bucketName,
            path,
            fileName: file.name,
            storageError: error,
          })
        );
      }

      if (!data?.path) {
        return Result.err(
          new AppError(ErrorCode.STORAGE_ERROR, 'Upload completed but no path returned', {
            bucket: bucketName,
            originalPath: path,
          })
        );
      }

      // Get public URL
      const urlResult = getStorageUrl(bucketName, data.path);
      if (!urlResult.success) {
        return Result.err(urlResult.error);
      }

      // Get file metadata
      const { data: fileInfo } = await clientResult.data.storage
        .from(bucketName)
        .list(path.substring(0, path.lastIndexOf('/')), {
          search: path.substring(path.lastIndexOf('/') + 1),
        });

      const metadata = fileInfo?.[0] || {
        size: file.size,
        mimeType: file.type,
        lastModified: new Date().toISOString(),
      };

      return Result.ok({
        path: data.path,
        url: urlResult.data,
        metadata: {
          ...metadata,
          originalName: file.name,
          uploadedAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.STORAGE_ERROR,
          `Upload operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { bucket, path, fileName: file.name }
        )
      );
    }
  }

  /**
   * Upload project image with automatic thumbnail generation
   */
  async uploadProjectImage(
    userId: string,
    projectId: string,
    file: File,
    label: string
  ): Promise<Result<ProjectImageInsert, AppError>> {
    try {
      // Generate storage path
      const storagePath = StoragePathBuilder.projectImage(userId, projectId, file.name);

      // Upload main image
      const uploadResult = await this.uploadFile(
        'PROJECT_IMAGES',
        storagePath,
        file,
        UPLOAD_CONFIGS.PROJECT_IMAGES
      );

      if (!uploadResult.success) {
        return Result.err(uploadResult.error);
      }

      // Get image dimensions
      const dimensions = await this.getImageDimensions(file);
      if (!dimensions.success) {
        return Result.err(dimensions.error);
      }

      // Create database record data
      const projectImageData: ProjectImageInsert = {
        project_id: projectId,
        label,
        filename: file.name,
        storage_path: uploadResult.data.path,
        mime_type: file.type,
        size_bytes: file.size,
        width: dimensions.data.width,
        height: dimensions.data.height,
        metadata: {
          ...uploadResult.data.metadata,
          storageBucket: STORAGE_BUCKETS.PROJECT_IMAGES,
          publicUrl: uploadResult.data.url,
        },
      };

      // Generate thumbnail if configured
      if (UPLOAD_CONFIGS.PROJECT_IMAGES.generateThumbnail) {
        const thumbnailResult = await this.generateThumbnail(
          userId,
          projectId,
          file,
          uploadResult.data.url
        );

        if (thumbnailResult.success) {
          projectImageData.metadata = {
            ...projectImageData.metadata,
            thumbnailUrl: thumbnailResult.data.url,
            thumbnailPath: thumbnailResult.data.path,
          };
        }
        // Continue even if thumbnail generation fails
      }

      return Result.ok(projectImageData);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.STORAGE_ERROR,
          `Project image upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { userId, projectId, fileName: file.name, label }
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
              filename: file.name,
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
              filename: file.name,
            })
          )
        );
      }, 10000);
    });
  }

  /**
   * Generate thumbnail for an image
   */
  private async generateThumbnail(
    userId: string,
    projectId: string,
    originalFile: File,
    originalUrl: string,
    maxSize: number = 300
  ): Promise<Result<{ path: string; url: string }, AppError>> {
    try {
      // Create canvas for thumbnail generation
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        return Result.err(
          new AppError(
            ErrorCode.STORAGE_ERROR,
            'Canvas context not available for thumbnail generation'
          )
        );
      }

      // Load original image
      const img = new Image();
      const imageLoadPromise = new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = originalUrl;
      });

      await imageLoadPromise;

      // Calculate thumbnail dimensions
      let { width, height } = img;
      if (width > height) {
        if (width > maxSize) {
          height = (height * maxSize) / width;
          width = maxSize;
        }
      } else {
        if (height > maxSize) {
          width = (width * maxSize) / height;
          height = maxSize;
        }
      }

      // Draw thumbnail
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);

      // Convert to blob
      const thumbnailBlob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          blob => (blob ? resolve(blob) : reject(new Error('Failed to create thumbnail blob'))),
          'image/jpeg',
          UPLOAD_CONFIGS.PROJECT_THUMBNAILS.compressionQuality
        );
      });

      // Upload thumbnail
      const thumbnailPath = StoragePathBuilder.projectThumbnail(
        userId,
        projectId,
        originalFile.name
      );
      const thumbnailFile = new File([thumbnailBlob], `thumb_${originalFile.name}`, {
        type: 'image/jpeg',
      });

      const uploadResult = await this.uploadFile(
        'PROJECT_THUMBNAILS',
        thumbnailPath,
        thumbnailFile,
        UPLOAD_CONFIGS.PROJECT_THUMBNAILS
      );

      if (!uploadResult.success) {
        return Result.err(uploadResult.error);
      }

      return Result.ok({
        path: uploadResult.data.path,
        url: uploadResult.data.url,
      });
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.STORAGE_ERROR,
          `Thumbnail generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { userId, projectId, originalFile: originalFile.name }
        )
      );
    }
  }

  /**
   * Delete a file from storage
   */
  async deleteFile(
    bucket: keyof typeof STORAGE_BUCKETS,
    path: string
  ): Promise<Result<boolean, AppError>> {
    try {
      const clientResult = await this.getClient();
      if (!clientResult.success) {
        return Result.err(clientResult.error);
      }

      const bucketName = STORAGE_BUCKETS[bucket];

      const { error } = await clientResult.data.storage.from(bucketName).remove([path]);

      if (error) {
        return Result.err(
          new AppError(ErrorCode.STORAGE_ERROR, `Delete failed: ${error.message}`, {
            bucket: bucketName,
            path,
            storageError: error,
          })
        );
      }

      return Result.ok(true);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.STORAGE_ERROR,
          `Delete operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { bucket, path }
        )
      );
    }
  }

  /**
   * Delete multiple files from storage
   */
  async deleteFiles(
    bucket: keyof typeof STORAGE_BUCKETS,
    paths: string[]
  ): Promise<Result<string[], AppError>> {
    try {
      if (paths.length === 0) {
        return Result.ok([]);
      }

      const clientResult = await this.getClient();
      if (!clientResult.success) {
        return Result.err(clientResult.error);
      }

      const bucketName = STORAGE_BUCKETS[bucket];

      const { data, error } = await clientResult.data.storage.from(bucketName).remove(paths);

      if (error) {
        return Result.err(
          new AppError(ErrorCode.STORAGE_ERROR, `Bulk delete failed: ${error.message}`, {
            bucket: bucketName,
            paths,
            storageError: error,
          })
        );
      }

      return Result.ok(data.map(item => item.name));
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.STORAGE_ERROR,
          `Bulk delete operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { bucket, pathCount: paths.length }
        )
      );
    }
  }

  /**
   * Get a signed URL for temporary access to a private file
   */
  async getSignedUrl(
    bucket: keyof typeof STORAGE_BUCKETS,
    path: string,
    expiresIn: number = 3600
  ): Promise<Result<string, AppError>> {
    const bucketName = STORAGE_BUCKETS[bucket];
    return await getSignedStorageUrl(bucketName, path, expiresIn);
  }

  /**
   * List files in a storage path with optional filtering
   */
  async listFiles(
    bucket: keyof typeof STORAGE_BUCKETS,
    path: string = '',
    options?: {
      limit?: number;
      offset?: number;
      search?: string;
    }
  ): Promise<Result<StorageObject[], AppError>> {
    try {
      const clientResult = await this.getClient();
      if (!clientResult.success) {
        return Result.err(clientResult.error);
      }

      const bucketName = STORAGE_BUCKETS[bucket];

      const { data, error } = await clientResult.data.storage.from(bucketName).list(path, {
        limit: options?.limit,
        offset: options?.offset,
        search: options?.search,
      });

      if (error) {
        return Result.err(
          new AppError(ErrorCode.STORAGE_ERROR, `List files failed: ${error.message}`, {
            bucket: bucketName,
            path,
            storageError: error,
          })
        );
      }

      return Result.ok(data as StorageObject[]);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.STORAGE_ERROR,
          `List files operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { bucket, path }
        )
      );
    }
  }

  /**
   * Copy a file within or between buckets
   */
  async copyFile(
    sourceBucket: keyof typeof STORAGE_BUCKETS,
    sourcePath: string,
    destinationBucket: keyof typeof STORAGE_BUCKETS,
    destinationPath: string
  ): Promise<Result<string, AppError>> {
    try {
      const clientResult = await this.getClient();
      if (!clientResult.success) {
        return Result.err(clientResult.error);
      }

      const sourceBucketName = STORAGE_BUCKETS[sourceBucket];
      const destBucketName = STORAGE_BUCKETS[destinationBucket];

      const { data, error } = await clientResult.data.storage
        .from(destBucketName)
        .copy(destinationPath, sourceBucketName, sourcePath);

      if (error) {
        return Result.err(
          new AppError(ErrorCode.STORAGE_ERROR, `Copy file failed: ${error.message}`, {
            sourceBucket: sourceBucketName,
            sourcePath,
            destinationBucket: destBucketName,
            destinationPath,
            storageError: error,
          })
        );
      }

      return Result.ok(data.path);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.STORAGE_ERROR,
          `Copy file operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { sourceBucket, sourcePath, destinationBucket, destinationPath }
        )
      );
    }
  }

  /**
   * Get storage usage statistics for a user
   */
  async getUserStorageUsage(userId: string): Promise<
    Result<
      {
        totalFiles: number;
        totalSizeBytes: number;
        byBucket: Record<string, { files: number; sizeBytes: number }>;
      },
      AppError
    >
  > {
    try {
      const stats = {
        totalFiles: 0,
        totalSizeBytes: 0,
        byBucket: {} as Record<string, { files: number; sizeBytes: number }>,
      };

      // Check each bucket for user files
      for (const [bucketKey, bucketName] of Object.entries(STORAGE_BUCKETS)) {
        const filesResult = await this.listFiles(bucketKey as keyof typeof STORAGE_BUCKETS, userId);

        if (filesResult.success) {
          const files = filesResult.data;
          const bucketStats = files.reduce(
            (acc, file) => ({
              files: acc.files + 1,
              sizeBytes: acc.sizeBytes + (file.metadata?.size || 0),
            }),
            { files: 0, sizeBytes: 0 }
          );

          stats.byBucket[bucketName] = bucketStats;
          stats.totalFiles += bucketStats.files;
          stats.totalSizeBytes += bucketStats.sizeBytes;
        }
      }

      return Result.ok(stats);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.STORAGE_ERROR,
          `Storage usage calculation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { userId }
        )
      );
    }
  }
}

// Export service instance
export const storageService = new StorageService();
