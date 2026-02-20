// Project export and import service with comprehensive format support
import { SupabaseService } from './supabase/client';
import { authService } from './auth/authService';
import { projectService } from './supabase/project.service';
import { projectImagesService } from './project-images.service';
import { measurementsService } from './measurements.service';
import { Result } from '@/utils/result';
import { AppError, ErrorCode } from '@/types/app.types';
import type {
  ProjectRow,
  ProjectData,
  ExportRecord,
  ProjectImageRow,
  MeasurementData,
} from '@/types/supabase.types';

// Export format options
export type ExportFormat = 'json' | 'zip' | 'pdf' | 'csv';

// Export configuration
export interface ExportOptions {
  includeImages: boolean;
  includeMeasurements: boolean;
  includeMetadata: boolean;
  imageFormat?: 'original' | 'jpeg' | 'png';
  imageQuality?: number;
  resolution?: 'original' | 'high' | 'medium' | 'low';
  measurementFormat?: 'embedded' | 'separate';
}

// Import configuration
export interface ImportOptions {
  overwriteExisting: boolean;
  preserveIds: boolean;
  skipInvalid: boolean;
  createBackup: boolean;
}

// Export result
export interface ExportResult {
  format: ExportFormat;
  filename: string;
  size: number;
  downloadUrl?: string;
  localBlob?: Blob;
  metadata: {
    projectId: string;
    projectName: string;
    exportedAt: string;
    exportedBy: string;
    options: ExportOptions;
    itemCounts: {
      images: number;
      measurements: number;
      totalSize: number;
    };
  };
}

// Import result
export interface ImportResult {
  success: boolean;
  projectId: string;
  itemCounts: {
    imagesImported: number;
    measurementsImported: number;
    imagesSkipped: number;
    measurementsSkipped: number;
  };
  errors: string[];
  warnings: string[];
}

/**
 * Service for exporting and importing projects in various formats
 */
export class ProjectExportService extends SupabaseService {
  /**
   * Export a project in the specified format
   */
  async exportProject(
    projectId: string,
    format: ExportFormat,
    options: ExportOptions
  ): Promise<Result<ExportResult, AppError>> {
    try {
      const currentUser = authService.getCurrentUser();
      if (!currentUser) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'Must be authenticated to export projects')
        );
      }

      // Get project with all data
      const projectResult = await projectService.getProject(projectId, {
        includeImages: options.includeImages,
        includeMeasurements: options.includeMeasurements,
      });

      if (!projectResult.success) {
        return Result.err(projectResult.error);
      }

      const project = projectResult.data;

      // Check access permissions
      if (project.created_by !== currentUser.id) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'Not authorized to export this project')
        );
      }

      // Get additional data based on options
      let projectImages: ProjectImageRow[] = [];
      let measurements: MeasurementData[] = [];

      if (options.includeImages && project.images) {
        projectImages = project.images;
      }

      if (options.includeMeasurements) {
        const measurementsResult = await measurementsService.getMeasurements(projectId);
        if (measurementsResult.success) {
          measurements = measurementsResult.data;
        }
      }

      // Export based on format
      switch (format) {
        case 'json':
          return await this.exportAsJSON(project, projectImages, measurements, options);
        case 'zip':
          return await this.exportAsZIP(project, projectImages, measurements, options);
        case 'csv':
          return await this.exportAsCSV(project, measurements, options);
        case 'pdf':
          return await this.exportAsPDF(project, projectImages, measurements, options);
        default:
          return Result.err(
            new AppError(ErrorCode.VALIDATION_ERROR, `Unsupported export format: ${format}`)
          );
      }
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.DATABASE_ERROR,
          `Failed to export project: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { projectId, format, options }
        )
      );
    }
  }

  /**
   * Import a project from exported data
   */
  async importProject(file: File, options: ImportOptions): Promise<Result<ImportResult, AppError>> {
    try {
      const currentUser = authService.getCurrentUser();
      if (!currentUser) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'Must be authenticated to import projects')
        );
      }

      // Determine import format from file extension
      const format = this.detectFileFormat(file);
      if (!format) {
        return Result.err(
          new AppError(ErrorCode.VALIDATION_ERROR, 'Unsupported file format for import')
        );
      }

      // Process import based on format
      switch (format) {
        case 'json':
          return await this.importFromJSON(file, options);
        case 'zip':
          return await this.importFromZIP(file, options);
        default:
          return Result.err(
            new AppError(ErrorCode.VALIDATION_ERROR, `Import not supported for format: ${format}`)
          );
      }
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.DATABASE_ERROR,
          `Failed to import project: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { fileName: file.name, options }
        )
      );
    }
  }

  /**
   * Get export history for a project
   */
  async getExportHistory(projectId: string): Promise<Result<ExportRecord[], AppError>> {
    try {
      const currentUser = authService.getCurrentUser();
      if (!currentUser) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'Must be authenticated to view export history')
        );
      }

      const projectResult = await projectService.getProject(projectId);
      if (!projectResult.success) {
        return Result.err(projectResult.error);
      }

      const project = projectResult.data;

      // Check access permissions
      if (project.created_by !== currentUser.id) {
        return Result.err(
          new AppError(
            ErrorCode.AUTH_ERROR,
            'Not authorized to view export history for this project'
          )
        );
      }

      return Result.ok(project.data.metadata.exportHistory);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.DATABASE_ERROR,
          `Failed to get export history: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { projectId }
        )
      );
    }
  }

  /**
   * Export project as JSON
   */
  private async exportAsJSON(
    project: ProjectRow,
    images: ProjectImageRow[],
    measurements: MeasurementData[],
    options: ExportOptions
  ): Promise<Result<ExportResult, AppError>> {
    try {
      const currentUser = authService.getCurrentUser()!;

      // Build export data structure
      const exportData: any = {
        version: '2.0.0',
        exportedAt: new Date().toISOString(),
        exportedBy: currentUser.email,
        project: {
          id: project.id,
          name: project.project_name,
          data: project.data,
        },
      };

      // Add images if requested
      if (options.includeImages && images.length > 0) {
        exportData.images = [];

        for (const image of images) {
          const imageInfo = await projectImagesService.getImageInfo(image.id);
          if (imageInfo.success) {
            exportData.images.push({
              ...image,
              dataUrl: imageInfo.data.signedUrl, // Temporary URL for download
            });
          }
        }
      }

      // Add measurements if requested
      if (options.includeMeasurements) {
        exportData.measurements = measurements;
      }

      // Add metadata if requested
      if (options.includeMetadata) {
        exportData.metadata = {
          exportOptions: options,
          projectStats: {
            imageCount: images.length,
            measurementCount: measurements.length,
            lastModified: project.updated_at,
          },
        };
      }

      // Convert to JSON blob
      const jsonString = JSON.stringify(exportData, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });

      // Record export
      await this.recordExport(project.id, 'json', options, blob.size);

      return Result.ok({
        format: 'json',
        filename: `${project.project_name}_${Date.now()}.json`,
        size: blob.size,
        localBlob: blob,
        metadata: {
          projectId: project.id,
          projectName: project.project_name,
          exportedAt: new Date().toISOString(),
          exportedBy: currentUser.email,
          options,
          itemCounts: {
            images: images.length,
            measurements: measurements.length,
            totalSize: blob.size,
          },
        },
      });
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.STORAGE_ERROR,
          `Failed to export as JSON: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      );
    }
  }

  /**
   * Export project as ZIP archive
   */
  private async exportAsZIP(
    project: ProjectRow,
    images: ProjectImageRow[],
    measurements: MeasurementData[],
    options: ExportOptions
  ): Promise<Result<ExportResult, AppError>> {
    try {
      const currentUser = authService.getCurrentUser()!;

      // This is a placeholder for ZIP export functionality
      // In a real implementation, you would:
      // 1. Create a ZIP archive using a library like JSZip
      // 2. Add project data as JSON
      // 3. Download and add image files
      // 4. Add measurements as separate files if needed
      // 5. Include metadata and manifest files

      const exportData = {
        manifest: {
          version: '2.0.0',
          exportedAt: new Date().toISOString(),
          exportedBy: currentUser.email,
          contents: {
            projectData: 'project.json',
            images: images.map(img => img.filename),
            measurements: 'measurements.json',
          },
        },
        project: {
          id: project.id,
          name: project.project_name,
          data: project.data,
        },
        measurements: options.includeMeasurements ? measurements : [],
      };

      // For now, return a JSON representation
      // TODO: Implement actual ZIP creation
      const jsonString = JSON.stringify(exportData, null, 2);
      const blob = new Blob([jsonString], { type: 'application/zip' });

      await this.recordExport(project.id, 'zip', options, blob.size);

      return Result.ok({
        format: 'zip',
        filename: `${project.project_name}_${Date.now()}.zip`,
        size: blob.size,
        localBlob: blob,
        metadata: {
          projectId: project.id,
          projectName: project.project_name,
          exportedAt: new Date().toISOString(),
          exportedBy: currentUser.email,
          options,
          itemCounts: {
            images: images.length,
            measurements: measurements.length,
            totalSize: blob.size,
          },
        },
      });
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.STORAGE_ERROR,
          `Failed to export as ZIP: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      );
    }
  }

  /**
   * Export project as CSV (measurements only)
   */
  private async exportAsCSV(
    project: ProjectRow,
    measurements: MeasurementData[],
    options: ExportOptions
  ): Promise<Result<ExportResult, AppError>> {
    try {
      const currentUser = authService.getCurrentUser()!;

      if (!options.includeMeasurements) {
        return Result.err(
          new AppError(
            ErrorCode.VALIDATION_ERROR,
            'CSV export requires measurements to be included'
          )
        );
      }

      // Use the measurements service to export as CSV
      const exportResult = await measurementsService.exportMeasurements(project.id, 'csv');

      if (!exportResult.success) {
        return Result.err(exportResult.error);
      }

      const csvData = exportResult.data.data as string;
      const blob = new Blob([csvData], { type: 'text/csv' });

      await this.recordExport(project.id, 'csv', options, blob.size);

      return Result.ok({
        format: 'csv',
        filename: exportResult.data.filename,
        size: blob.size,
        localBlob: blob,
        metadata: {
          projectId: project.id,
          projectName: project.project_name,
          exportedAt: new Date().toISOString(),
          exportedBy: currentUser.email,
          options,
          itemCounts: {
            images: 0,
            measurements: measurements.length,
            totalSize: blob.size,
          },
        },
      });
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.STORAGE_ERROR,
          `Failed to export as CSV: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      );
    }
  }

  /**
   * Export project as PDF (placeholder)
   */
  private async exportAsPDF(
    project: ProjectRow,
    images: ProjectImageRow[],
    measurements: MeasurementData[],
    options: ExportOptions
  ): Promise<Result<ExportResult, AppError>> {
    try {
      const currentUser = authService.getCurrentUser()!;

      // This is a placeholder for PDF export functionality
      // In a real implementation, you would:
      // 1. Use a PDF library like jsPDF or PDFKit
      // 2. Create a formatted report with project information
      // 3. Include images and measurements in a structured layout
      // 4. Add charts and statistics
      // 5. Include metadata and export information

      const pdfContent = `
        PROJECT REPORT

        Project: ${project.project_name}
        Exported: ${new Date().toISOString()}
        Exported by: ${currentUser.email}

        Images: ${images.length}
        Measurements: ${measurements.length}

        TODO: Implement PDF generation
      `;

      const blob = new Blob([pdfContent], { type: 'application/pdf' });

      await this.recordExport(project.id, 'pdf', options, blob.size);

      return Result.ok({
        format: 'pdf',
        filename: `${project.project_name}_report_${Date.now()}.pdf`,
        size: blob.size,
        localBlob: blob,
        metadata: {
          projectId: project.id,
          projectName: project.project_name,
          exportedAt: new Date().toISOString(),
          exportedBy: currentUser.email,
          options,
          itemCounts: {
            images: images.length,
            measurements: measurements.length,
            totalSize: blob.size,
          },
        },
      });
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.STORAGE_ERROR,
          `Failed to export as PDF: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      );
    }
  }

  /**
   * Import project from JSON file
   */
  private async importFromJSON(
    file: File,
    options: ImportOptions
  ): Promise<Result<ImportResult, AppError>> {
    try {
      // Read file content
      const content = await this.readFileAsText(file);
      if (!content.success) {
        return Result.err(content.error);
      }

      // Parse JSON
      let importData: any;
      try {
        importData = JSON.parse(content.data);
      } catch {
        return Result.err(
          new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid JSON format in import file')
        );
      }

      // Validate import data structure
      const validationResult = this.validateImportData(importData);
      if (!validationResult.success) {
        return Result.err(validationResult.error);
      }

      // Create backup if requested
      if (options.createBackup && importData.project?.id) {
        // TODO: Implement backup creation
      }

      // Create new project
      const createProjectResult = await projectService.createProject({
        name: `${importData.project.name} (Imported)`,
        settings: importData.project.data?.settings,
        tags: [],
      });

      if (!createProjectResult.success) {
        return Result.err(createProjectResult.error);
      }

      const newProject = createProjectResult.data;
      const results: ImportResult = {
        success: true,
        projectId: newProject.id,
        itemCounts: {
          imagesImported: 0,
          measurementsImported: 0,
          imagesSkipped: 0,
          measurementsSkipped: 0,
        },
        errors: [],
        warnings: [],
      };

      // Import images if present
      if (importData.images) {
        // TODO: Implement image import from data URLs
        results.warnings.push('Image import from JSON not yet implemented');
      }

      // Import measurements if present
      if (importData.measurements) {
        for (const measurement of importData.measurements) {
          try {
            const createResult = await measurementsService.createMeasurement(newProject.id, {
              imageLabel: measurement.imageLabel,
              type: measurement.type,
              label: measurement.label,
              value: measurement.value,
              unit: measurement.unit,
              coordinates: measurement.coordinates,
              style: measurement.style,
            });

            if (createResult.success) {
              results.itemCounts.measurementsImported++;
            } else {
              results.itemCounts.measurementsSkipped++;
              if (!options.skipInvalid) {
                results.errors.push(
                  `Failed to import measurement "${measurement.label}": ${createResult.error.message}`
                );
              }
            }
          } catch (error) {
            results.itemCounts.measurementsSkipped++;
            results.errors.push(
              `Error importing measurement: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
          }
        }
      }

      return Result.ok(results);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.DATABASE_ERROR,
          `Failed to import from JSON: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      );
    }
  }

  /**
   * Import project from ZIP file
   */
  private async importFromZIP(
    _file: File,
    _options: ImportOptions
  ): Promise<Result<ImportResult, AppError>> {
    try {
      // TODO: Implement ZIP import functionality
      // This would require:
      // 1. Extract ZIP file using JSZip or similar
      // 2. Read manifest file
      // 3. Import project data
      // 4. Import images from archive
      // 5. Import measurements
      // 6. Handle errors and validation

      return Result.err(new AppError(ErrorCode.VALIDATION_ERROR, 'ZIP import not yet implemented'));
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.DATABASE_ERROR,
          `Failed to import from ZIP: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      );
    }
  }

  /**
   * Detect file format from extension and MIME type
   */
  private detectFileFormat(file: File): ExportFormat | null {
    const extension = file.name.split('.').pop()?.toLowerCase();

    switch (extension) {
      case 'json':
        return 'json';
      case 'zip':
        return 'zip';
      case 'csv':
        return 'csv';
      case 'pdf':
        return 'pdf';
      default:
        return null;
    }
  }

  /**
   * Read file as text
   */
  private async readFileAsText(file: File): Promise<Result<string, AppError>> {
    return new Promise(resolve => {
      const reader = new FileReader();

      reader.onload = () => {
        resolve(Result.ok(reader.result as string));
      };

      reader.onerror = () => {
        resolve(Result.err(new AppError(ErrorCode.STORAGE_ERROR, 'Failed to read file content')));
      };

      reader.readAsText(file);
    });
  }

  /**
   * Validate import data structure
   */
  private validateImportData(data: any): Result<true, AppError> {
    if (!data || typeof data !== 'object') {
      return Result.err(
        new AppError(ErrorCode.VALIDATION_ERROR, 'Import data must be a valid object')
      );
    }

    if (!data.project) {
      return Result.err(
        new AppError(ErrorCode.VALIDATION_ERROR, 'Import data must contain project information')
      );
    }

    if (!data.project.name) {
      return Result.err(new AppError(ErrorCode.VALIDATION_ERROR, 'Project must have a name'));
    }

    // Additional validation can be added here

    return Result.ok(true);
  }

  /**
   * Record export in project metadata
   */
  private async recordExport(
    projectId: string,
    format: string,
    options: ExportOptions,
    _size: number
  ): Promise<void> {
    try {
      const exportRecord: ExportRecord = {
        timestamp: new Date().toISOString(),
        format,
        includeImages: options.includeImages,
        includeMeasurements: options.includeMeasurements,
        filename: `${format}_export_${Date.now()}`,
      };

      // Get current project
      const projectResult = await projectService.getProject(projectId);
      if (projectResult.success) {
        const project = projectResult.data;

        const updatedData: ProjectData = {
          ...project.data,
          metadata: {
            ...project.data.metadata,
            exportHistory: [
              exportRecord,
              ...project.data.metadata.exportHistory.slice(0, 9), // Keep last 10
            ],
            lastModifiedAt: new Date().toISOString(),
          },
        };

        await this.update('projects', projectId, {
          data: updatedData,
          updated_at: new Date().toISOString(),
        });
      }
    } catch (error) {
      // Log error but don't fail export
      console.error('Failed to record export:', error);
    }
  }
}

// Export service instance
export const projectExportService = new ProjectExportService();
