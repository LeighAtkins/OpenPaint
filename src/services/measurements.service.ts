// Measurement persistence and management service
import { SupabaseService } from './supabase/client';
import { authService } from './auth/authService';
import { projectService } from './supabase/project.service';
import { DATABASE_TABLES } from '@/config/supabase.config';
import { Result } from '@/utils/result';
import { AppError, ErrorCode } from '@/types/app.types';
import type { MeasurementData, ProjectData, ProjectRow } from '@/types/supabase.types';

// Measurement creation data
export interface CreateMeasurementData {
  imageLabel: string;
  type: 'line' | 'area' | 'angle';
  label: string;
  value: number;
  unit: string;
  coordinates: {
    start: { x: number; y: number };
    end: { x: number; y: number };
    control?: { x: number; y: number };
  };
  style?: {
    color?: string;
    strokeWidth?: number;
    fontSize?: number;
    labelPosition?: 'above' | 'below' | 'inline';
  };
}

// Measurement update data
export interface UpdateMeasurementData {
  label?: string;
  value?: number;
  unit?: string;
  coordinates?: {
    start: { x: number; y: number };
    end: { x: number; y: number };
    control?: { x: number; y: number };
  };
  style?: {
    color?: string;
    strokeWidth?: number;
    fontSize?: number;
    labelPosition?: 'above' | 'below' | 'inline';
  };
}

// Measurement query options
export interface MeasurementQueryOptions {
  imageLabel?: string;
  type?: 'line' | 'area' | 'angle';
  includeDeleted?: boolean;
}

// Bulk measurement operations
export interface BulkMeasurementUpdate {
  measurementId: string;
  data: UpdateMeasurementData;
}

// Measurement export formats
export interface MeasurementExportData {
  projectId: string;
  projectName: string;
  imageLabel: string;
  measurements: Array<
    MeasurementData & {
      pixelLength?: number;
      realWorldValue: number;
      accuracy?: number;
    }
  >;
  exportedAt: string;
  exportedBy: string;
  scaleFactor?: number;
  units: string;
}

/**
 * Service for managing measurements with comprehensive CRUD operations
 */
export class MeasurementsService extends SupabaseService {
  /**
   * Create a new measurement in a project
   */
  async createMeasurement(
    projectId: string,
    data: CreateMeasurementData
  ): Promise<Result<MeasurementData, AppError>> {
    try {
      const currentUser = authService.getCurrentUser();
      if (!currentUser) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'Must be authenticated to create measurements')
        );
      }

      // Validate project access
      const projectResult = await projectService.getProject(projectId);
      if (!projectResult.success) {
        return Result.err(projectResult.error);
      }

      const project = projectResult.data;
      if (project.user_id !== currentUser.id) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'Not authorized to add measurements to this project')
        );
      }

      // Validate image exists in project
      if (!project.data.images[data.imageLabel]) {
        return Result.err(
          new AppError(
            ErrorCode.VALIDATION_ERROR,
            `Image "${data.imageLabel}" not found in project`
          )
        );
      }

      // Validate measurement data
      const validationResult = this.validateMeasurementData(data);
      if (!validationResult.success) {
        return Result.err(validationResult.error);
      }

      // Generate unique ID for measurement
      const measurementId = this.generateMeasurementId(projectId, data.imageLabel);

      // Create measurement data
      const now = new Date().toISOString();
      const measurement: MeasurementData = {
        id: measurementId,
        imageLabel: data.imageLabel,
        type: data.type,
        label: data.label.trim(),
        value: data.value,
        unit: data.unit,
        coordinates: data.coordinates,
        style: {
          color: data.style?.color || '#ff0000',
          strokeWidth: data.style?.strokeWidth || 2,
          fontSize: data.style?.fontSize || 12,
          labelPosition: data.style?.labelPosition || 'above',
        },
        createdAt: now,
        updatedAt: now,
      };

      // Update project data
      const updateResult = await this.addMeasurementToProject(projectId, measurement, project);
      if (!updateResult.success) {
        return Result.err(updateResult.error);
      }

      return Result.ok(measurement);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.DATABASE_ERROR,
          `Failed to create measurement: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { projectId, measurementData: data }
        )
      );
    }
  }

  /**
   * Update an existing measurement
   */
  async updateMeasurement(
    projectId: string,
    measurementId: string,
    data: UpdateMeasurementData
  ): Promise<Result<MeasurementData, AppError>> {
    try {
      const currentUser = authService.getCurrentUser();
      if (!currentUser) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'Must be authenticated to update measurements')
        );
      }

      // Get project and validate access
      const projectResult = await projectService.getProject(projectId);
      if (!projectResult.success) {
        return Result.err(projectResult.error);
      }

      const project = projectResult.data;
      if (project.user_id !== currentUser.id) {
        return Result.err(
          new AppError(
            ErrorCode.AUTH_ERROR,
            'Not authorized to update measurements in this project'
          )
        );
      }

      // Get current measurement
      const currentMeasurement = project.data.measurements[measurementId];
      if (!currentMeasurement) {
        return Result.err(new AppError(ErrorCode.VALIDATION_ERROR, 'Measurement not found'));
      }

      // Update measurement data
      const updatedMeasurement: MeasurementData = {
        ...currentMeasurement,
        ...(data.label !== undefined && { label: data.label.trim() }),
        ...(data.value !== undefined && { value: data.value }),
        ...(data.unit !== undefined && { unit: data.unit }),
        ...(data.coordinates !== undefined && { coordinates: data.coordinates }),
        ...(data.style !== undefined && {
          style: { ...currentMeasurement.style, ...data.style },
        }),
        updatedAt: new Date().toISOString(),
      };

      // Validate updated data
      const validationResult = this.validateMeasurementData({
        imageLabel: updatedMeasurement.imageLabel,
        type: updatedMeasurement.type,
        label: updatedMeasurement.label,
        value: updatedMeasurement.value,
        unit: updatedMeasurement.unit,
        coordinates: updatedMeasurement.coordinates,
        style: updatedMeasurement.style,
      });

      if (!validationResult.success) {
        return Result.err(validationResult.error);
      }

      // Update project data
      const updateResult = await this.updateMeasurementInProject(
        projectId,
        measurementId,
        updatedMeasurement,
        project
      );

      if (!updateResult.success) {
        return Result.err(updateResult.error);
      }

      return Result.ok(updatedMeasurement);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.DATABASE_ERROR,
          `Failed to update measurement: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { projectId, measurementId, updateData: data }
        )
      );
    }
  }

  /**
   * Delete a measurement
   */
  async deleteMeasurement(
    projectId: string,
    measurementId: string
  ): Promise<Result<boolean, AppError>> {
    try {
      const currentUser = authService.getCurrentUser();
      if (!currentUser) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'Must be authenticated to delete measurements')
        );
      }

      // Get project and validate access
      const projectResult = await projectService.getProject(projectId);
      if (!projectResult.success) {
        return Result.err(projectResult.error);
      }

      const project = projectResult.data;
      if (project.user_id !== currentUser.id) {
        return Result.err(
          new AppError(
            ErrorCode.AUTH_ERROR,
            'Not authorized to delete measurements in this project'
          )
        );
      }

      // Check if measurement exists
      if (!project.data.measurements[measurementId]) {
        return Result.err(new AppError(ErrorCode.VALIDATION_ERROR, 'Measurement not found'));
      }

      // Remove measurement from project
      const updateResult = await this.removeMeasurementFromProject(
        projectId,
        measurementId,
        project
      );
      return updateResult;
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.DATABASE_ERROR,
          `Failed to delete measurement: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { projectId, measurementId }
        )
      );
    }
  }

  /**
   * Get measurements for a project with optional filtering
   */
  async getMeasurements(
    projectId: string,
    options: MeasurementQueryOptions = {}
  ): Promise<Result<MeasurementData[], AppError>> {
    try {
      const currentUser = authService.getCurrentUser();
      if (!currentUser) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'Must be authenticated to view measurements')
        );
      }

      // Get project and validate access
      const projectResult = await projectService.getProject(projectId);
      if (!projectResult.success) {
        return Result.err(projectResult.error);
      }

      const project = projectResult.data;

      // Check access permissions (owner or public project)
      if (project.user_id !== currentUser.id && !project.is_public) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'Not authorized to view measurements in this project')
        );
      }

      // Get all measurements
      let measurements = Object.values(project.data.measurements);

      // Apply filters
      if (options.imageLabel) {
        measurements = measurements.filter(m => m.imageLabel === options.imageLabel);
      }

      if (options.type) {
        measurements = measurements.filter(m => m.type === options.type);
      }

      // Sort by creation date (newest first)
      measurements.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      return Result.ok(measurements);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.DATABASE_ERROR,
          `Failed to get measurements: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { projectId, options }
        )
      );
    }
  }

  /**
   * Get a specific measurement by ID
   */
  async getMeasurement(
    projectId: string,
    measurementId: string
  ): Promise<Result<MeasurementData, AppError>> {
    try {
      const currentUser = authService.getCurrentUser();
      if (!currentUser) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'Must be authenticated to view measurements')
        );
      }

      // Get project and validate access
      const projectResult = await projectService.getProject(projectId);
      if (!projectResult.success) {
        return Result.err(projectResult.error);
      }

      const project = projectResult.data;

      // Check access permissions
      if (project.user_id !== currentUser.id && !project.is_public) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'Not authorized to view measurements in this project')
        );
      }

      // Get measurement
      const measurement = project.data.measurements[measurementId];
      if (!measurement) {
        return Result.err(new AppError(ErrorCode.VALIDATION_ERROR, 'Measurement not found'));
      }

      return Result.ok(measurement);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.DATABASE_ERROR,
          `Failed to get measurement: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { projectId, measurementId }
        )
      );
    }
  }

  /**
   * Bulk update multiple measurements
   */
  async bulkUpdateMeasurements(
    projectId: string,
    updates: BulkMeasurementUpdate[]
  ): Promise<
    Result<
      {
        successful: MeasurementData[];
        failed: Array<{ measurementId: string; error: string }>;
      },
      AppError
    >
  > {
    try {
      const currentUser = authService.getCurrentUser();
      if (!currentUser) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'Must be authenticated to update measurements')
        );
      }

      // Get project and validate access
      const projectResult = await projectService.getProject(projectId);
      if (!projectResult.success) {
        return Result.err(projectResult.error);
      }

      const project = projectResult.data;
      if (project.user_id !== currentUser.id) {
        return Result.err(
          new AppError(
            ErrorCode.AUTH_ERROR,
            'Not authorized to update measurements in this project'
          )
        );
      }

      const results = {
        successful: [] as MeasurementData[],
        failed: [] as Array<{ measurementId: string; error: string }>,
      };

      // Apply updates sequentially
      for (const update of updates) {
        try {
          const updateResult = await this.updateMeasurement(
            projectId,
            update.measurementId,
            update.data
          );

          if (updateResult.success) {
            results.successful.push(updateResult.data);
          } else {
            results.failed.push({
              measurementId: update.measurementId,
              error: updateResult.error.message,
            });
          }
        } catch (error) {
          results.failed.push({
            measurementId: update.measurementId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      return Result.ok(results);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.DATABASE_ERROR,
          `Failed to bulk update measurements: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { projectId, updateCount: updates.length }
        )
      );
    }
  }

  /**
   * Export measurements in various formats
   */
  async exportMeasurements(
    projectId: string,
    format: 'json' | 'csv' | 'excel',
    options: MeasurementQueryOptions = {}
  ): Promise<
    Result<
      {
        data: MeasurementExportData | string;
        filename: string;
        mimeType: string;
      },
      AppError
    >
  > {
    try {
      const currentUser = authService.getCurrentUser();
      if (!currentUser) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'Must be authenticated to export measurements')
        );
      }

      // Get project and measurements
      const projectResult = await projectService.getProject(projectId);
      if (!projectResult.success) {
        return Result.err(projectResult.error);
      }

      const project = projectResult.data;

      // Check access permissions
      if (project.user_id !== currentUser.id && !project.is_public) {
        return Result.err(
          new AppError(
            ErrorCode.AUTH_ERROR,
            'Not authorized to export measurements from this project'
          )
        );
      }

      const measurementsResult = await this.getMeasurements(projectId, options);
      if (!measurementsResult.success) {
        return Result.err(measurementsResult.error);
      }

      const measurements = measurementsResult.data;

      // Create export data
      const exportData: MeasurementExportData = {
        projectId,
        projectName: project.name,
        imageLabel: options.imageLabel || 'all',
        measurements: measurements.map(m => ({
          ...m,
          realWorldValue: m.value,
          pixelLength: this.calculatePixelLength(m.coordinates),
        })),
        exportedAt: new Date().toISOString(),
        exportedBy: currentUser.email,
        units: project.data.settings.units,
      };

      // Format data based on requested format
      switch (format) {
        case 'json':
          return Result.ok({
            data: exportData,
            filename: `${project.name}_measurements_${Date.now()}.json`,
            mimeType: 'application/json',
          });

        case 'csv': {
          const csvData = this.convertToCSV(exportData);
          return Result.ok({
            data: csvData,
            filename: `${project.name}_measurements_${Date.now()}.csv`,
            mimeType: 'text/csv',
          });
        }

        default:
          return Result.err(
            new AppError(ErrorCode.VALIDATION_ERROR, `Unsupported export format: ${format}`)
          );
      }
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.DATABASE_ERROR,
          `Failed to export measurements: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { projectId, format, options }
        )
      );
    }
  }

  /**
   * Import measurements from exported data
   */
  async importMeasurements(
    projectId: string,
    exportData: MeasurementExportData,
    options: {
      overwriteExisting?: boolean;
      skipInvalid?: boolean;
    } = {}
  ): Promise<
    Result<
      {
        imported: number;
        skipped: number;
        errors: string[];
      },
      AppError
    >
  > {
    try {
      const currentUser = authService.getCurrentUser();
      if (!currentUser) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'Must be authenticated to import measurements')
        );
      }

      // Validate project access
      const projectResult = await projectService.getProject(projectId);
      if (!projectResult.success) {
        return Result.err(projectResult.error);
      }

      const project = projectResult.data;
      if (project.user_id !== currentUser.id) {
        return Result.err(
          new AppError(
            ErrorCode.AUTH_ERROR,
            'Not authorized to import measurements to this project'
          )
        );
      }

      const results = {
        imported: 0,
        skipped: 0,
        errors: [] as string[],
      };

      // Import each measurement
      for (const measurement of exportData.measurements) {
        try {
          // Check if measurement already exists
          if (project.data.measurements[measurement.id] && !options.overwriteExisting) {
            results.skipped++;
            continue;
          }

          // Validate measurement data
          const validationResult = this.validateMeasurementData({
            imageLabel: measurement.imageLabel,
            type: measurement.type,
            label: measurement.label,
            value: measurement.value,
            unit: measurement.unit,
            coordinates: measurement.coordinates,
            style: measurement.style,
          });

          if (!validationResult.success) {
            if (options.skipInvalid) {
              results.errors.push(
                `Invalid measurement "${measurement.label}": ${validationResult.error.message}`
              );
              results.skipped++;
              continue;
            } else {
              return Result.err(validationResult.error);
            }
          }

          // Create or update measurement
          if (options.overwriteExisting && project.data.measurements[measurement.id]) {
            const updateResult = await this.updateMeasurement(projectId, measurement.id, {
              label: measurement.label,
              value: measurement.value,
              unit: measurement.unit,
              coordinates: measurement.coordinates,
              style: measurement.style,
            });

            if (updateResult.success) {
              results.imported++;
            } else {
              results.errors.push(
                `Failed to update "${measurement.label}": ${updateResult.error.message}`
              );
              results.skipped++;
            }
          } else {
            const createResult = await this.createMeasurement(projectId, {
              imageLabel: measurement.imageLabel,
              type: measurement.type,
              label: measurement.label,
              value: measurement.value,
              unit: measurement.unit,
              coordinates: measurement.coordinates,
              style: measurement.style,
            });

            if (createResult.success) {
              results.imported++;
            } else {
              results.errors.push(
                `Failed to create "${measurement.label}": ${createResult.error.message}`
              );
              results.skipped++;
            }
          }
        } catch (error) {
          results.errors.push(
            `Error processing "${measurement.label}": ${error instanceof Error ? error.message : 'Unknown error'}`
          );
          results.skipped++;
        }
      }

      return Result.ok(results);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.DATABASE_ERROR,
          `Failed to import measurements: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { projectId }
        )
      );
    }
  }

  /**
   * Generate unique measurement ID
   */
  private generateMeasurementId(projectId: string, imageLabel: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 5);
    return `${projectId}_${imageLabel}_${timestamp}_${random}`;
  }

  /**
   * Validate measurement data
   */
  private validateMeasurementData(data: CreateMeasurementData): Result<true, AppError> {
    // Validate label
    if (!data.label || data.label.trim().length === 0) {
      return Result.err(
        new AppError(ErrorCode.VALIDATION_ERROR, 'Measurement label cannot be empty')
      );
    }

    if (data.label.trim().length > 100) {
      return Result.err(
        new AppError(ErrorCode.VALIDATION_ERROR, 'Measurement label cannot exceed 100 characters')
      );
    }

    // Validate value
    if (typeof data.value !== 'number' || !isFinite(data.value) || data.value < 0) {
      return Result.err(
        new AppError(ErrorCode.VALIDATION_ERROR, 'Measurement value must be a positive number')
      );
    }

    // Validate unit
    if (!data.unit || data.unit.trim().length === 0) {
      return Result.err(
        new AppError(ErrorCode.VALIDATION_ERROR, 'Measurement unit cannot be empty')
      );
    }

    // Validate coordinates
    if (!data.coordinates?.start || !data.coordinates?.end) {
      return Result.err(
        new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Measurement coordinates must include start and end points'
        )
      );
    }

    const { start, end } = data.coordinates;
    if (
      typeof start.x !== 'number' ||
      typeof start.y !== 'number' ||
      typeof end.x !== 'number' ||
      typeof end.y !== 'number'
    ) {
      return Result.err(
        new AppError(ErrorCode.VALIDATION_ERROR, 'Measurement coordinates must be valid numbers')
      );
    }

    return Result.ok(true);
  }

  /**
   * Add measurement to project data
   */
  private async addMeasurementToProject(
    projectId: string,
    measurement: MeasurementData,
    project: ProjectRow
  ): Promise<Result<boolean, AppError>> {
    try {
      const updatedData: ProjectData = {
        ...project.data,
        measurements: {
          ...project.data.measurements,
          [measurement.id]: measurement,
        },
        metadata: {
          ...project.data.metadata,
          totalMeasurements: Object.keys(project.data.measurements).length + 1,
          lastModifiedAt: new Date().toISOString(),
        },
      };

      // Update image's measurement list
      const imageData = updatedData.images[measurement.imageLabel];
      if (imageData) {
        updatedData.images[measurement.imageLabel] = {
          ...imageData,
          measurements: [...imageData.measurements, measurement.id],
        };
      }

      const updateResult = await this.update(
        DATABASE_TABLES.PROJECTS,
        projectId,
        {
          data: updatedData,
          updated_at: new Date().toISOString(),
          version: project.version + 1,
        },
        project.version
      );

      return updateResult.success ? Result.ok(true) : Result.err(updateResult.error);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.DATABASE_ERROR,
          `Failed to add measurement to project: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      );
    }
  }

  /**
   * Update measurement in project data
   */
  private async updateMeasurementInProject(
    projectId: string,
    measurementId: string,
    measurement: MeasurementData,
    project: ProjectRow
  ): Promise<Result<boolean, AppError>> {
    try {
      const updatedData: ProjectData = {
        ...project.data,
        measurements: {
          ...project.data.measurements,
          [measurementId]: measurement,
        },
        metadata: {
          ...project.data.metadata,
          lastModifiedAt: new Date().toISOString(),
        },
      };

      const updateResult = await this.update(
        DATABASE_TABLES.PROJECTS,
        projectId,
        {
          data: updatedData,
          updated_at: new Date().toISOString(),
          version: project.version + 1,
        },
        project.version
      );

      return updateResult.success ? Result.ok(true) : Result.err(updateResult.error);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.DATABASE_ERROR,
          `Failed to update measurement in project: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      );
    }
  }

  /**
   * Remove measurement from project data
   */
  private async removeMeasurementFromProject(
    projectId: string,
    measurementId: string,
    project: ProjectRow
  ): Promise<Result<boolean, AppError>> {
    try {
      const measurement = project.data.measurements[measurementId];
      const updatedMeasurements = { ...project.data.measurements };
      delete updatedMeasurements[measurementId];

      const updatedData: ProjectData = {
        ...project.data,
        measurements: updatedMeasurements,
        metadata: {
          ...project.data.metadata,
          totalMeasurements: Object.keys(updatedMeasurements).length,
          lastModifiedAt: new Date().toISOString(),
        },
      };

      // Remove from image's measurement list
      if (measurement) {
        const imageData = updatedData.images[measurement.imageLabel];
        if (imageData) {
          updatedData.images[measurement.imageLabel] = {
            ...imageData,
            measurements: imageData.measurements.filter(id => id !== measurementId),
          };
        }
      }

      const updateResult = await this.update(
        DATABASE_TABLES.PROJECTS,
        projectId,
        {
          data: updatedData,
          updated_at: new Date().toISOString(),
          version: project.version + 1,
        },
        project.version
      );

      return updateResult.success ? Result.ok(true) : Result.err(updateResult.error);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.DATABASE_ERROR,
          `Failed to remove measurement from project: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      );
    }
  }

  /**
   * Calculate pixel length from coordinates
   */
  private calculatePixelLength(coordinates: MeasurementData['coordinates']): number {
    const dx = coordinates.end.x - coordinates.start.x;
    const dy = coordinates.end.y - coordinates.start.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Convert measurement data to CSV format
   */
  private convertToCSV(exportData: MeasurementExportData): string {
    const headers = [
      'ID',
      'Label',
      'Type',
      'Value',
      'Unit',
      'Image',
      'Start X',
      'Start Y',
      'End X',
      'End Y',
      'Control X',
      'Control Y',
      'Color',
      'Stroke Width',
      'Font Size',
      'Label Position',
      'Created At',
      'Updated At',
    ];

    const rows = exportData.measurements.map(m => [
      m.id,
      m.label,
      m.type,
      m.value.toString(),
      m.unit,
      m.imageLabel,
      m.coordinates.start.x.toString(),
      m.coordinates.start.y.toString(),
      m.coordinates.end.x.toString(),
      m.coordinates.end.y.toString(),
      m.coordinates.control?.x?.toString() || '',
      m.coordinates.control?.y?.toString() || '',
      m.style.color,
      m.style.strokeWidth.toString(),
      m.style.fontSize.toString(),
      m.style.labelPosition,
      m.createdAt,
      m.updatedAt,
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(field => `"${field}"`).join(',')),
    ].join('\n');

    return csvContent;
  }
}

// Export service instance
export const measurementsService = new MeasurementsService();
