// Services barrel export
// Central export for all application services

// Core services
export { default as SupabaseService } from './supabase.service';
export {
  StorageService,
  storageService,
  StoragePathBuilder,
  UPLOAD_CONFIGS,
} from './storage.service';
export { AuthService, authService } from './auth.service';

// Project management services
export { ProjectService, projectService } from './project.service';
export { ProjectImagesService, projectImagesService } from './project-images.service';
export { MeasurementsService, measurementsService } from './measurements.service';
export { ProjectExportService, projectExportService } from './project-export.service';

// Re-export types for convenience
export type {
  // Auth types
  SignUpCredentials,
  SignInCredentials,
  ResetPasswordCredentials,
  UpdateProfileData,
  AuthUser,
} from './auth.service';

export type {
  // Storage types
  UploadConfig,
} from './storage.service';

export type {
  // Project types
  ProjectQueryOptions,
  CreateProjectData,
  UpdateProjectData,
} from './project.service';

export type {
  // Image types
  ImageUploadOptions,
  ImageProcessingResult,
  UploadProgressCallback,
} from './project-images.service';

export type {
  // Measurement types
  CreateMeasurementData,
  UpdateMeasurementData,
  MeasurementQueryOptions,
  BulkMeasurementUpdate,
  MeasurementExportData,
} from './measurements.service';

export type {
  // Export types
  ExportFormat,
  ExportOptions,
  ImportOptions,
  ExportResult,
  ImportResult,
} from './project-export.service';

// Re-export configuration
export {
  SUPABASE_CONFIG,
  STORAGE_BUCKETS,
  DATABASE_TABLES,
  initializeSupabase,
  getSupabaseClient,
  checkSupabaseHealth,
  validateSupabaseConfig,
} from '@/config/supabase.config';
