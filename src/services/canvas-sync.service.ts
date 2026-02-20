// Canvas synchronization service that bridges canvas state with project data
import { canvasStateService } from './canvas/canvasManager';
import { fabricIntegrationService } from './fabric-integration.service';
import { projectService } from './supabase/project.service';
import { measurementsService } from './measurements.service';
import { authService } from './auth/authService';
import { Result } from '@/utils/result';
import { AppError, ErrorCode } from '@/types/app.types';
import type {
  ProjectRow,
  ImageData,
  MeasurementData,
  FabricObjectData,
} from '@/types/supabase.types';
import type { FabricCanvasJSON } from '@/types/app.types';

// Synchronization conflict types
export interface SyncConflict {
  type: 'measurement' | 'object' | 'image';
  id: string;
  localValue: any;
  remoteValue: any;
  timestamp: number;
}

// Synchronization result
export interface SyncResult {
  success: boolean;
  conflicts: SyncConflict[];
  applied: {
    measurements: number;
    objects: number;
    images: number;
  };
  errors: string[];
}

// Synchronization options
export interface SyncOptions {
  resolveConflicts: 'local' | 'remote' | 'manual';
  includeImages: boolean;
  includeMeasurements: boolean;
  includeObjects: boolean;
  createBackup: boolean;
}

// Delta tracking for efficient sync
export interface CanvasDelta {
  projectId: string;
  imageLabel: string;
  timestamp: number;
  changes: {
    objectsAdded: FabricObjectData[];
    objectsModified: Array<{ id: string; changes: Partial<FabricObjectData> }>;
    objectsRemoved: string[];
    measurementsAdded: MeasurementData[];
    measurementsModified: Array<{ id: string; changes: Partial<MeasurementData> }>;
    measurementsRemoved: string[];
  };
}

/**
 * Canvas synchronization service for real-time collaboration and data consistency
 */
export class CanvasSyncService {
  private syncQueues = new Map<string, CanvasDelta[]>();
  private lastSyncTimestamps = new Map<string, number>();
  private syncInProgress = new Map<string, boolean>();
  private conflictResolvers = new Map<
    string,
    (conflicts: SyncConflict[]) => Promise<SyncConflict[]>
  >();

  /**
   * Synchronize canvas with project data
   */
  async synchronizeCanvas(
    projectId: string,
    imageLabel: string,
    options: SyncOptions = {
      resolveConflicts: 'local',
      includeImages: true,
      includeMeasurements: true,
      includeObjects: true,
      createBackup: false,
    }
  ): Promise<Result<SyncResult, AppError>> {
    try {
      const currentUser = authService.getCurrentUser();
      if (!currentUser) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'Must be authenticated to synchronize canvas')
        );
      }

      const syncKey = `${projectId}:${imageLabel}`;

      // Check if sync is already in progress
      if (this.syncInProgress.get(syncKey)) {
        return Result.err(
          new AppError(
            ErrorCode.CANVAS_INVALID_STATE,
            'Synchronization already in progress for this canvas'
          )
        );
      }

      this.syncInProgress.set(syncKey, true);

      try {
        // Get current project state
        const projectResult = await projectService.getProject(projectId, { includeImages: true });
        if (!projectResult.success) {
          return Result.err(projectResult.error);
        }

        const project = projectResult.data;
        const imageData = project.data.images[imageLabel];

        if (!imageData) {
          return Result.err(
            new AppError(ErrorCode.VALIDATION_ERROR, `Image "${imageLabel}" not found in project`)
          );
        }

        // Get canvas instance
        const canvasResult = fabricIntegrationService.getCanvasInstance(projectId, imageLabel);
        if (!canvasResult.success) {
          return Result.err(canvasResult.error);
        }

        const canvasInstance = canvasResult.data;

        // Get current canvas state
        const canvasJSON = await this.getCurrentCanvasJSON(canvasInstance);
        if (!canvasJSON.success) {
          return Result.err(canvasJSON.error);
        }

        const syncResult: SyncResult = {
          success: true,
          conflicts: [],
          applied: { measurements: 0, objects: 0, images: 0 },
          errors: [],
        };

        // Create backup if requested
        if (options.createBackup) {
          await this.createSyncBackup(projectId, imageLabel, canvasJSON.data);
        }

        // Synchronize objects
        if (options.includeObjects) {
          const objectSyncResult = await this.synchronizeObjects(
            project,
            imageData,
            canvasJSON.data,
            options
          );

          if (objectSyncResult.success) {
            syncResult.conflicts.push(...objectSyncResult.data.conflicts);
            syncResult.applied.objects = objectSyncResult.data.applied;
          } else {
            syncResult.errors.push(`Object sync failed: ${objectSyncResult.error.message}`);
          }
        }

        // Synchronize measurements
        if (options.includeMeasurements) {
          const measurementSyncResult = await this.synchronizeMeasurements(
            projectId,
            imageLabel,
            options
          );

          if (measurementSyncResult.success) {
            syncResult.conflicts.push(...measurementSyncResult.data.conflicts);
            syncResult.applied.measurements = measurementSyncResult.data.applied;
          } else {
            syncResult.errors.push(
              `Measurement sync failed: ${measurementSyncResult.error.message}`
            );
          }
        }

        // Resolve conflicts if any
        if (syncResult.conflicts.length > 0) {
          const resolvedConflicts = await this.resolveConflicts(
            syncKey,
            syncResult.conflicts,
            options.resolveConflicts
          );

          if (resolvedConflicts.success) {
            await this.applyConflictResolutions(projectId, imageLabel, resolvedConflicts.data);
          }
        }

        // Update last sync timestamp
        this.lastSyncTimestamps.set(syncKey, Date.now());

        return Result.ok(syncResult);
      } finally {
        this.syncInProgress.set(syncKey, false);
      }
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.CANVAS_INVALID_STATE,
          `Canvas synchronization failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { projectId, imageLabel }
        )
      );
    }
  }

  /**
   * Push local changes to project
   */
  async pushCanvasChanges(
    projectId: string,
    imageLabel: string,
    forceSync: boolean = false
  ): Promise<Result<boolean, AppError>> {
    try {
      const currentUser = authService.getCurrentUser();
      if (!currentUser) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'Must be authenticated to push canvas changes')
        );
      }

      // Check if canvas has changes
      const stateResult = canvasStateService.getCanvasState(projectId, imageLabel);
      if (!stateResult.success) {
        return Result.err(stateResult.error);
      }

      if (!stateResult.data.isDirty && !forceSync) {
        return Result.ok(false); // No changes to push
      }

      // Get canvas instance
      const canvasResult = fabricIntegrationService.getCanvasInstance(projectId, imageLabel);
      if (!canvasResult.success) {
        return Result.err(canvasResult.error);
      }

      // Save canvas state
      const saveResult = await fabricIntegrationService.saveCanvasToJSON(canvasResult.data);
      if (!saveResult.success) {
        return Result.err(saveResult.error);
      }

      // Create delta for tracking
      const delta = await this.createCanvasDelta(projectId, imageLabel, saveResult.data);
      if (delta.success) {
        this.addDeltaToQueue(delta.data);
      }

      return Result.ok(true);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.CANVAS_SAVE_FAILED,
          `Failed to push canvas changes: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { projectId, imageLabel }
        )
      );
    }
  }

  /**
   * Pull remote changes to canvas
   */
  async pullCanvasChanges(
    projectId: string,
    imageLabel: string,
    options: { overwriteLocal?: boolean } = {}
  ): Promise<Result<boolean, AppError>> {
    try {
      // Load latest project data
      const loadResult = await canvasStateService.loadCanvasState(projectId, imageLabel);
      if (!loadResult.success) {
        return Result.err(loadResult.error);
      }

      // Get canvas instance
      const canvasResult = fabricIntegrationService.getCanvasInstance(projectId, imageLabel);
      if (!canvasResult.success) {
        return Result.err(canvasResult.error);
      }

      // Check for conflicts if not overwriting
      if (!options.overwriteLocal) {
        const stateResult = canvasStateService.getCanvasState(projectId, imageLabel);
        if (stateResult.success && stateResult.data.isDirty) {
          return Result.err(
            new AppError(
              ErrorCode.CANVAS_INVALID_STATE,
              'Canvas has unsaved changes. Use overwriteLocal option or save changes first.'
            )
          );
        }
      }

      // Load canvas data
      await fabricIntegrationService.loadCanvasFromJSON(canvasResult.data, loadResult.data);

      return Result.ok(true);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.CANVAS_LOAD_FAILED,
          `Failed to pull canvas changes: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { projectId, imageLabel }
        )
      );
    }
  }

  /**
   * Enable auto-sync for a canvas
   */
  enableAutoSync(
    projectId: string,
    imageLabel: string,
    interval: number = 30000 // 30 seconds
  ): () => void {
    const intervalId = setInterval(() => {
      void this.pushCanvasChanges(projectId, imageLabel).catch(error => {
        console.error('Auto-sync failed:', error);
      });
    }, interval);

    // Return cleanup function
    return () => clearInterval(intervalId);
  }

  /**
   * Set custom conflict resolver
   */
  setConflictResolver(
    projectId: string,
    imageLabel: string,
    resolver: (conflicts: SyncConflict[]) => Promise<SyncConflict[]>
  ): void {
    const syncKey = `${projectId}:${imageLabel}`;
    this.conflictResolvers.set(syncKey, resolver);
  }

  /**
   * Get sync status for a canvas
   */
  getSyncStatus(
    projectId: string,
    imageLabel: string
  ): Result<
    {
      lastSync: number | null;
      hasPendingChanges: boolean;
      syncInProgress: boolean;
      queuedDeltas: number;
    },
    AppError
  > {
    try {
      const syncKey = `${projectId}:${imageLabel}`;

      const stateResult = canvasStateService.getCanvasState(projectId, imageLabel);
      const hasPendingChanges = stateResult.success ? stateResult.data.isDirty : false;

      return Result.ok({
        lastSync: this.lastSyncTimestamps.get(syncKey) || null,
        hasPendingChanges,
        syncInProgress: this.syncInProgress.get(syncKey) || false,
        queuedDeltas: (this.syncQueues.get(syncKey) || []).length,
      });
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.CANVAS_INVALID_STATE,
          `Failed to get sync status: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      );
    }
  }

  /**
   * Synchronize canvas objects
   */
  private async synchronizeObjects(
    _project: ProjectRow,
    imageData: ImageData,
    canvasJSON: FabricCanvasJSON,
    _options: SyncOptions
  ): Promise<Result<{ conflicts: SyncConflict[]; applied: number }, AppError>> {
    try {
      const conflicts: SyncConflict[] = [];
      let applied = 0;

      // Compare local canvas objects with stored project objects
      const localObjects = new Map(canvasJSON.objects.map(obj => [obj.id || '', obj]));
      const remoteObjects = new Map(imageData.objects.map(obj => [obj.id, obj]));

      // Find conflicts and apply changes based on resolution strategy
      for (const [id, remoteObj] of remoteObjects) {
        const localObj = localObjects.get(id);

        if (!localObj) {
          // Object exists remotely but not locally - add it
          applied++;
        } else {
          // Object exists in both - check for conflicts
          if (this.objectsHaveConflicts(localObj, remoteObj)) {
            conflicts.push({
              type: 'object',
              id,
              localValue: localObj,
              remoteValue: remoteObj,
              timestamp: Date.now(),
            });
          }
        }
      }

      // Check for locally added objects
      for (const [id, _localObj] of localObjects) {
        if (!remoteObjects.has(id)) {
          // Object exists locally but not remotely - will be pushed
          applied++;
        }
      }

      return Result.ok({ conflicts, applied });
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.CANVAS_INVALID_STATE,
          `Object synchronization failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      );
    }
  }

  /**
   * Synchronize canvas measurements
   */
  private async synchronizeMeasurements(
    projectId: string,
    imageLabel: string,
    _options: SyncOptions
  ): Promise<Result<{ conflicts: SyncConflict[]; applied: number }, AppError>> {
    try {
      const conflicts: SyncConflict[] = [];
      let applied = 0;

      // Get remote measurements
      const remoteMeasurementsResult = await measurementsService.getMeasurements(projectId, {
        imageLabel,
      });

      if (!remoteMeasurementsResult.success) {
        return Result.err(remoteMeasurementsResult.error);
      }

      // TODO: Get local measurements from canvas state
      // This would require implementing local measurement tracking
      const localMeasurements: MeasurementData[] = [];

      const remoteMap = new Map(remoteMeasurementsResult.data.map(m => [m.id, m]));
      const localMap = new Map(localMeasurements.map(m => [m.id, m]));

      // Compare and find conflicts
      for (const [id, remote] of remoteMap) {
        const local = localMap.get(id);

        if (!local) {
          applied++;
        } else if (this.measurementsHaveConflicts(local, remote)) {
          conflicts.push({
            type: 'measurement',
            id,
            localValue: local,
            remoteValue: remote,
            timestamp: Date.now(),
          });
        }
      }

      return Result.ok({ conflicts, applied });
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.CANVAS_INVALID_STATE,
          `Measurement synchronization failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      );
    }
  }

  /**
   * Resolve synchronization conflicts
   */
  private async resolveConflicts(
    syncKey: string,
    conflicts: SyncConflict[],
    strategy: 'local' | 'remote' | 'manual'
  ): Promise<Result<SyncConflict[], AppError>> {
    try {
      if (strategy === 'manual') {
        const customResolver = this.conflictResolvers.get(syncKey);
        if (customResolver) {
          const resolved = await customResolver(conflicts);
          return Result.ok(resolved);
        }
      }

      // Auto-resolve based on strategy
      const resolved = conflicts.map(conflict => {
        if (strategy === 'local') {
          // Keep local value
          return { ...conflict, remoteValue: conflict.localValue };
        } else {
          // Use remote value
          return { ...conflict, localValue: conflict.remoteValue };
        }
      });

      return Result.ok(resolved);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.CANVAS_INVALID_STATE,
          `Conflict resolution failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      );
    }
  }

  /**
   * Apply conflict resolutions
   */
  private async applyConflictResolutions(
    projectId: string,
    _imageLabel: string,
    resolvedConflicts: SyncConflict[]
  ): Promise<void> {
    for (const conflict of resolvedConflicts) {
      try {
        switch (conflict.type) {
          case 'measurement':
            await measurementsService.updateMeasurement(
              projectId,
              conflict.id,
              conflict.localValue
            );
            break;

          case 'object':
            // Update canvas object
            // Implementation depends on canvas integration
            break;
        }
      } catch (error) {
        console.error(
          `Failed to apply conflict resolution for ${conflict.type} ${conflict.id}:`,
          error
        );
      }
    }
  }

  /**
   * Create canvas delta for change tracking
   */
  private async createCanvasDelta(
    projectId: string,
    imageLabel: string,
    _canvasJSON: FabricCanvasJSON
  ): Promise<Result<CanvasDelta, AppError>> {
    try {
      // This is a simplified implementation
      // In a real application, you would track actual changes
      const delta: CanvasDelta = {
        projectId,
        imageLabel,
        timestamp: Date.now(),
        changes: {
          objectsAdded: [],
          objectsModified: [],
          objectsRemoved: [],
          measurementsAdded: [],
          measurementsModified: [],
          measurementsRemoved: [],
        },
      };

      return Result.ok(delta);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.CANVAS_INVALID_STATE,
          `Failed to create canvas delta: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      );
    }
  }

  /**
   * Add delta to sync queue
   */
  private addDeltaToQueue(delta: CanvasDelta): void {
    const syncKey = `${delta.projectId}:${delta.imageLabel}`;
    const queue = this.syncQueues.get(syncKey) || [];

    queue.push(delta);

    // Limit queue size
    if (queue.length > 100) {
      queue.shift();
    }

    this.syncQueues.set(syncKey, queue);
  }

  /**
   * Get current canvas JSON
   */
  private async getCurrentCanvasJSON(
    canvasInstance: any
  ): Promise<Result<FabricCanvasJSON, AppError>> {
    return await fabricIntegrationService.saveCanvasToJSON(canvasInstance);
  }

  /**
   * Create sync backup
   */
  private async createSyncBackup(
    projectId: string,
    imageLabel: string,
    canvasJSON: FabricCanvasJSON
  ): Promise<void> {
    try {
      await canvasStateService.createStateSnapshot(
        `${projectId}:${imageLabel}`,
        'Pre-sync backup',
        canvasJSON
      );
    } catch (error) {
      console.error('Failed to create sync backup:', error);
    }
  }

  /**
   * Check if objects have conflicts
   */
  private objectsHaveConflicts(local: any, remote: FabricObjectData): boolean {
    // Compare key properties to detect conflicts
    const compareProps = ['left', 'top', 'width', 'height', 'angle', 'scaleX', 'scaleY'];

    return compareProps.some(prop => {
      const localVal = local[prop];
      const remoteVal = remote[prop as keyof FabricObjectData];
      return Math.abs(((localVal as number) || 0) - ((remoteVal as number) || 0)) > 0.01; // Small tolerance for floating point
    });
  }

  /**
   * Check if measurements have conflicts
   */
  private measurementsHaveConflicts(local: MeasurementData, remote: MeasurementData): boolean {
    // Compare timestamps and values
    return (
      new Date(local.updatedAt).getTime() !== new Date(remote.updatedAt).getTime() ||
      local.value !== remote.value ||
      local.label !== remote.label
    );
  }

  /**
   * Cleanup sync data for a canvas
   */
  cleanup(projectId: string, imageLabel: string): void {
    const syncKey = `${projectId}:${imageLabel}`;
    this.syncQueues.delete(syncKey);
    this.lastSyncTimestamps.delete(syncKey);
    this.syncInProgress.delete(syncKey);
    this.conflictResolvers.delete(syncKey);
  }
}

// Export service instance
export const canvasSyncService = new CanvasSyncService();
