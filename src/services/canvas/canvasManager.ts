// Canvas state management service with Fabric.js integration
import { SupabaseService } from '../supabase/client';
import { authService } from '../auth/authService';
import { projectService } from '../supabase/project.service';
import { measurementsService } from '../measurements.service';
import { Result } from '@/utils/result';
import { AppError, ErrorCode } from '@/types/app.types';
import type {
  CanvasState,
  ToolType,
  BrushSettings,
  Position,
  BoundingBox,
  CanvasEvent,
  AppEventType,
  FabricObject,
  FabricCanvasJSON,
} from '@/types/app.types';
import type { MeasurementData, FabricObjectData } from '@/types/supabase.types';

// Canvas viewport state
export interface ViewportState {
  zoom: number;
  center: Position;
  bounds: BoundingBox;
  rotation: number;
}

// Canvas layer management
export interface CanvasLayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  objects: string[]; // Object IDs in this layer
}

// Canvas configuration
export interface CanvasConfig {
  width: number;
  height: number;
  backgroundColor: string;
  preserveObjectStacking: boolean;
  selection: boolean;
  enableRetinaScaling: boolean;
  allowTouchScrolling: boolean;
  defaultCursor: string;
  hoverCursor: string;
  moveCursor: string;
}

// Canvas interaction mode
export type InteractionMode = 'select' | 'draw' | 'measure' | 'text' | 'pan' | 'zoom';

// Canvas event handlers
export type CanvasEventHandler<T = any> = (event: CanvasEvent<T>) => void;

// Canvas state snapshot for undo/redo
export interface CanvasStateSnapshot {
  id: string;
  timestamp: number;
  description: string;
  canvasJSON: FabricCanvasJSON;
  viewport: ViewportState;
  measurements: Record<string, MeasurementData>;
}

/**
 * Canvas state management service that bridges Fabric.js with TypeScript services
 */
export class CanvasStateService extends SupabaseService {
  private canvasStates = new Map<string, CanvasState>();
  private eventHandlers = new Map<AppEventType, Set<CanvasEventHandler>>();
  private stateHistory = new Map<string, CanvasStateSnapshot[]>();
  private currentHistoryIndex = new Map<string, number>();

  // Default configurations
  private readonly DEFAULT_CANVAS_CONFIG: CanvasConfig = {
    width: 800,
    height: 600,
    backgroundColor: '#ffffff',
    preserveObjectStacking: true,
    selection: true,
    enableRetinaScaling: true,
    allowTouchScrolling: false,
    defaultCursor: 'default',
    hoverCursor: 'move',
    moveCursor: 'move',
  };

  private readonly DEFAULT_BRUSH_SETTINGS: BrushSettings = {
    color: '#000000',
    width: 2,
    opacity: 1.0,
  };

  /**
   * Initialize canvas state for a project image
   */
  async initializeCanvasState(
    projectId: string,
    imageLabel: string,
    config?: Partial<CanvasConfig>
  ): Promise<Result<CanvasState, AppError>> {
    try {
      const currentUser = authService.getCurrentUser();
      if (!currentUser) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'Must be authenticated to initialize canvas')
        );
      }

      // Get project data
      const projectResult = await projectService.getProject(projectId);
      if (!projectResult.success) {
        return Result.err(projectResult.error);
      }

      const project = projectResult.data;

      // Check if image exists in project
      const imageData = project.data.images[imageLabel];
      if (!imageData) {
        return Result.err(
          new AppError(ErrorCode.VALIDATION_ERROR, `Image "${imageLabel}" not found in project`)
        );
      }

      // Create canvas state
      const canvasId = this.getCanvasId(projectId, imageLabel);
      const canvasState: CanvasState = {
        currentTool: 'select',
        brushSettings: { ...this.DEFAULT_BRUSH_SETTINGS },
        zoom: 1.0,
        panOffset: { x: 0, y: 0 },
        selectedObjectIds: [],
        isDrawing: false,
        isDirty: false,
      };

      // Store state
      this.canvasStates.set(canvasId, canvasState);

      // Initialize history
      this.stateHistory.set(canvasId, []);
      this.currentHistoryIndex.set(canvasId, -1);

      // Create initial snapshot
      await this.createStateSnapshot(canvasId, 'Canvas initialized', {
        version: '2.0.0',
        objects: [],
        background: config?.backgroundColor || this.DEFAULT_CANVAS_CONFIG.backgroundColor,
      });

      return Result.ok(canvasState);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.CANVAS_INVALID_STATE,
          `Failed to initialize canvas state: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { projectId, imageLabel }
        )
      );
    }
  }

  /**
   * Get current canvas state
   */
  getCanvasState(projectId: string, imageLabel: string): Result<CanvasState, AppError> {
    const canvasId = this.getCanvasId(projectId, imageLabel);
    const state = this.canvasStates.get(canvasId);

    if (!state) {
      return Result.err(new AppError(ErrorCode.CANVAS_NOT_FOUND, 'Canvas state not initialized'));
    }

    return Result.ok({ ...state }); // Return copy to prevent mutations
  }

  /**
   * Update canvas state
   */
  async updateCanvasState(
    projectId: string,
    imageLabel: string,
    updates: Partial<CanvasState>
  ): Promise<Result<CanvasState, AppError>> {
    try {
      const canvasId = this.getCanvasId(projectId, imageLabel);
      const currentState = this.canvasStates.get(canvasId);

      if (!currentState) {
        return Result.err(new AppError(ErrorCode.CANVAS_NOT_FOUND, 'Canvas state not initialized'));
      }

      // Update state
      const newState: CanvasState = {
        ...currentState,
        ...updates,
      };

      // Mark as dirty if this is a significant change
      if (this.isSignificantChange(currentState, updates)) {
        newState.isDirty = true;
      }

      // Store updated state
      this.canvasStates.set(canvasId, newState);

      // Emit state change event
      this.emitEvent('canvas:state-changed', {
        canvasId,
        previousState: currentState,
        newState,
        updates,
      });

      return Result.ok(newState);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.CANVAS_INVALID_STATE,
          `Failed to update canvas state: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { projectId, imageLabel, updates }
        )
      );
    }
  }

  /**
   * Set current tool
   */
  async setCurrentTool(
    projectId: string,
    imageLabel: string,
    tool: ToolType
  ): Promise<Result<CanvasState, AppError>> {
    const stateUpdate: Partial<CanvasState> = { currentTool: tool };
    if (tool !== 'select') {
      stateUpdate.selectedObjectIds = []; // Clear selection when switching from select tool
    }
    const updateResult = await this.updateCanvasState(projectId, imageLabel, stateUpdate);

    if (updateResult.success) {
      this.emitEvent('canvas:tool-changed', {
        tool,
        projectId,
        imageLabel,
      });
    }

    return updateResult;
  }

  /**
   * Update brush settings
   */
  async updateBrushSettings(
    projectId: string,
    imageLabel: string,
    settings: Partial<BrushSettings>
  ): Promise<Result<CanvasState, AppError>> {
    const stateResult = this.getCanvasState(projectId, imageLabel);
    if (!stateResult.success) {
      return Result.err(stateResult.error);
    }

    const currentState = stateResult.data;
    const newBrushSettings = {
      ...currentState.brushSettings,
      ...settings,
    };

    const updateResult = await this.updateCanvasState(projectId, imageLabel, {
      brushSettings: newBrushSettings,
    });

    if (updateResult.success) {
      this.emitEvent('canvas:brush-changed', {
        settings: newBrushSettings,
        projectId,
        imageLabel,
      });
    }

    return updateResult;
  }

  /**
   * Update viewport (zoom and pan)
   */
  async updateViewport(
    projectId: string,
    imageLabel: string,
    viewport: { zoom?: number; panOffset?: Position }
  ): Promise<Result<CanvasState, AppError>> {
    const updateResult = await this.updateCanvasState(projectId, imageLabel, viewport);

    if (updateResult.success) {
      this.emitEvent('canvas:viewport-changed', {
        viewport,
        projectId,
        imageLabel,
      });
    }

    return updateResult;
  }

  /**
   * Set selected objects
   */
  async setSelectedObjects(
    projectId: string,
    imageLabel: string,
    objectIds: string[]
  ): Promise<Result<CanvasState, AppError>> {
    const updateResult = await this.updateCanvasState(projectId, imageLabel, {
      selectedObjectIds: [...objectIds], // Create copy
    });

    if (updateResult.success) {
      this.emitEvent('canvas:selection-changed', {
        selectedObjectIds: objectIds,
        projectId,
        imageLabel,
      });
    }

    return updateResult;
  }

  /**
   * Start drawing operation
   */
  async startDrawing(
    projectId: string,
    imageLabel: string
  ): Promise<Result<CanvasState, AppError>> {
    const updateResult = await this.updateCanvasState(projectId, imageLabel, {
      isDrawing: true,
    });

    if (updateResult.success) {
      this.emitEvent('canvas:drawing-started', {
        projectId,
        imageLabel,
      });
    }

    return updateResult;
  }

  /**
   * End drawing operation
   */
  async endDrawing(
    projectId: string,
    imageLabel: string,
    objectCreated?: FabricObjectData
  ): Promise<Result<CanvasState, AppError>> {
    const updateResult = await this.updateCanvasState(projectId, imageLabel, {
      isDrawing: false,
    });

    if (updateResult.success) {
      this.emitEvent('canvas:drawing-ended', {
        projectId,
        imageLabel,
        objectCreated,
      });

      // Create state snapshot for undo/redo
      if (objectCreated) {
        await this.createStateSnapshot(
          this.getCanvasId(projectId, imageLabel),
          `Created ${objectCreated.type} object`,
          await this.getCurrentCanvasJSON(projectId, imageLabel)
        );
      }
    }

    return updateResult;
  }

  /**
   * Save canvas state to project
   */
  async saveCanvasState(
    projectId: string,
    imageLabel: string,
    fabricJSON: FabricCanvasJSON
  ): Promise<Result<boolean, AppError>> {
    try {
      const currentUser = authService.getCurrentUser();
      if (!currentUser) {
        return Result.err(
          new AppError(ErrorCode.AUTH_ERROR, 'Must be authenticated to save canvas state')
        );
      }

      // Convert Fabric.js objects to our format
      const fabricObjects = this.convertFabricObjects(fabricJSON.objects);

      // Get current measurements for this image
      const measurementsResult = await measurementsService.getMeasurements(projectId, {
        imageLabel,
      });

      const measurements = measurementsResult.success ? measurementsResult.data : [];

      // Update project with canvas data
      const updateResult = await projectService.updateProjectCanvasData(
        projectId,
        imageLabel,
        fabricObjects,
        measurements
      );

      if (!updateResult.success) {
        return Result.err(updateResult.error);
      }

      // Mark canvas as clean
      await this.updateCanvasState(projectId, imageLabel, { isDirty: false });

      // Create snapshot
      await this.createStateSnapshot(
        this.getCanvasId(projectId, imageLabel),
        'Canvas saved to project',
        fabricJSON
      );

      this.emitEvent('canvas:saved', {
        projectId,
        imageLabel,
        objectCount: fabricObjects.length,
        measurementCount: measurements.length,
      });

      return Result.ok(true);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.CANVAS_SAVE_FAILED,
          `Failed to save canvas state: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { projectId, imageLabel }
        )
      );
    }
  }

  /**
   * Load canvas state from project
   */
  async loadCanvasState(
    projectId: string,
    imageLabel: string
  ): Promise<Result<FabricCanvasJSON, AppError>> {
    try {
      // Get project data
      const projectResult = await projectService.getProject(projectId);
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

      // Convert our format back to Fabric.js format
      const fabricJSON: FabricCanvasJSON = {
        version: '2.0.0',
        objects: this.convertToFabricObjects(imageData.objects),
        background: project.data.settings.backgroundColor || '#ffffff',
      };

      // Mark canvas as clean
      await this.updateCanvasState(projectId, imageLabel, { isDirty: false });

      this.emitEvent('canvas:loaded', {
        projectId,
        imageLabel,
        objectCount: fabricJSON.objects.length,
      });

      return Result.ok(fabricJSON);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.CANVAS_LOAD_FAILED,
          `Failed to load canvas state: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { projectId, imageLabel }
        )
      );
    }
  }

  /**
   * Create state snapshot for undo/redo
   */
  async createStateSnapshot(
    canvasId: string,
    description: string,
    fabricJSON: FabricCanvasJSON
  ): Promise<Result<string, AppError>> {
    try {
      const history = this.stateHistory.get(canvasId) || [];
      const currentIndex = this.currentHistoryIndex.get(canvasId) || -1;

      // Remove any history after current index (for redo functionality)
      const newHistory = history.slice(0, currentIndex + 1);

      // Create snapshot
      const snapshot: CanvasStateSnapshot = {
        id: `snapshot_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        timestamp: Date.now(),
        description,
        canvasJSON: JSON.parse(JSON.stringify(fabricJSON)), // Deep copy
        viewport: {
          zoom: 1,
          center: { x: 0, y: 0 },
          bounds: { x: 0, y: 0, width: 800, height: 600 },
          rotation: 0,
        },
        measurements: {}, // TODO: Include current measurements
      };

      // Add to history
      newHistory.push(snapshot);

      // Limit history size (keep last 50 snapshots)
      if (newHistory.length > 50) {
        newHistory.shift();
      }

      // Update indices
      this.stateHistory.set(canvasId, newHistory);
      this.currentHistoryIndex.set(canvasId, newHistory.length - 1);

      return Result.ok(snapshot.id);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.CANVAS_INVALID_STATE,
          `Failed to create state snapshot: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { canvasId, description }
        )
      );
    }
  }

  /**
   * Undo last operation
   */
  async undo(
    projectId: string,
    imageLabel: string
  ): Promise<Result<FabricCanvasJSON | null, AppError>> {
    try {
      const canvasId = this.getCanvasId(projectId, imageLabel);
      const history = this.stateHistory.get(canvasId) || [];
      const currentIndex = this.currentHistoryIndex.get(canvasId) || -1;

      if (currentIndex <= 0) {
        return Result.ok(null); // Nothing to undo
      }

      // Move to previous state
      const newIndex = currentIndex - 1;
      this.currentHistoryIndex.set(canvasId, newIndex);

      const snapshot = history[newIndex];
      if (!snapshot) {
        return Result.err(
          new AppError(ErrorCode.CANVAS_INVALID_STATE, 'Undo failed: snapshot not found')
        );
      }

      this.emitEvent('history:undo', {
        projectId,
        imageLabel,
        snapshotId: snapshot.id,
        description: snapshot.description,
      });

      return Result.ok(snapshot.canvasJSON);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.CANVAS_INVALID_STATE,
          `Undo failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { projectId, imageLabel }
        )
      );
    }
  }

  /**
   * Redo last undone operation
   */
  async redo(
    projectId: string,
    imageLabel: string
  ): Promise<Result<FabricCanvasJSON | null, AppError>> {
    try {
      const canvasId = this.getCanvasId(projectId, imageLabel);
      const history = this.stateHistory.get(canvasId) || [];
      const currentIndex = this.currentHistoryIndex.get(canvasId) || -1;

      if (currentIndex >= history.length - 1) {
        return Result.ok(null); // Nothing to redo
      }

      // Move to next state
      const newIndex = currentIndex + 1;
      this.currentHistoryIndex.set(canvasId, newIndex);

      const snapshot = history[newIndex];
      if (!snapshot) {
        return Result.err(
          new AppError(ErrorCode.CANVAS_INVALID_STATE, 'Redo failed: snapshot not found')
        );
      }

      this.emitEvent('history:redo', {
        projectId,
        imageLabel,
        snapshotId: snapshot.id,
        description: snapshot.description,
      });

      return Result.ok(snapshot.canvasJSON);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.CANVAS_INVALID_STATE,
          `Redo failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { projectId, imageLabel }
        )
      );
    }
  }

  /**
   * Get undo/redo history info
   */
  getHistoryInfo(
    projectId: string,
    imageLabel: string
  ): Result<
    {
      canUndo: boolean;
      canRedo: boolean;
      totalSnapshots: number;
      currentIndex: number;
    },
    AppError
  > {
    const canvasId = this.getCanvasId(projectId, imageLabel);
    const history = this.stateHistory.get(canvasId) || [];
    const currentIndex = this.currentHistoryIndex.get(canvasId) || -1;

    return Result.ok({
      canUndo: currentIndex > 0,
      canRedo: currentIndex < history.length - 1,
      totalSnapshots: history.length,
      currentIndex,
    });
  }

  /**
   * Subscribe to canvas events
   */
  addEventListener<T = any>(eventType: AppEventType, handler: CanvasEventHandler<T>): () => void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, new Set());
    }

    this.eventHandlers.get(eventType)!.add(handler);

    // Return unsubscribe function
    return () => {
      const handlers = this.eventHandlers.get(eventType);
      if (handlers) {
        handlers.delete(handler);
      }
    };
  }

  /**
   * Emit canvas event
   */
  private emitEvent<T = any>(eventType: AppEventType, data: T): void {
    const handlers = this.eventHandlers.get(eventType);
    if (!handlers) return;

    const event: CanvasEvent<T> = {
      type: eventType,
      timestamp: Date.now(),
      data,
    };

    handlers.forEach(handler => {
      try {
        handler(event);
      } catch (error) {
        console.error(`Canvas event handler error for ${eventType}:`, error);
      }
    });
  }

  /**
   * Generate unique canvas ID
   */
  private getCanvasId(projectId: string, imageLabel: string): string {
    return `${projectId}:${imageLabel}`;
  }

  /**
   * Check if state change is significant (requires marking as dirty)
   */
  private isSignificantChange(_current: CanvasState, updates: Partial<CanvasState>): boolean {
    // Tool and brush changes don't make canvas dirty
    if (updates.currentTool !== undefined || updates.brushSettings !== undefined) {
      return false;
    }

    // Viewport changes don't make canvas dirty
    if (updates.zoom !== undefined || updates.panOffset !== undefined) {
      return false;
    }

    // Selection changes don't make canvas dirty
    if (updates.selectedObjectIds !== undefined) {
      return false;
    }

    // Other changes are significant
    return true;
  }

  /**
   * Convert Fabric.js objects to our data format
   */
  private convertFabricObjects(fabricObjects: FabricObject[]): FabricObjectData[] {
    return fabricObjects.map(obj => ({
      type: obj.type,
      id: obj.id || `obj_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      left: obj.left,
      top: obj.top,
      width: obj.width,
      height: obj.height,
      scaleX: obj.scaleX,
      scaleY: obj.scaleY,
      angle: obj.angle,
      visible: obj.visible,
      selectable: obj.selectable !== false,
      fill: obj.fill || 'transparent',
      stroke: obj.stroke || 'transparent',
      strokeWidth: obj.strokeWidth,
      // Add type-specific properties as needed
      ...(obj.type === 'path' && { path: (obj as any).path }),
      ...(obj.type === 'text' && {
        text: (obj as any).text,
        fontSize: (obj as any).fontSize,
        fontFamily: (obj as any).fontFamily,
      }),
      // Custom properties
      isDrawnObject: true,
      metadata: {
        createdAt: new Date().toISOString(),
        version: '2.0.0',
      },
    }));
  }

  /**
   * Convert our data format back to Fabric.js objects
   */
  private convertToFabricObjects(objectData: FabricObjectData[]): FabricObject[] {
    return objectData.map(data => ({
      type: data.type,
      id: data.id,
      left: data.left,
      top: data.top,
      width: data.width,
      height: data.height,
      scaleX: data.scaleX,
      scaleY: data.scaleY,
      angle: data.angle,
      visible: data.visible,
      selectable: data.selectable,
      fill: data.fill,
      stroke: data.stroke,
      strokeWidth: data.strokeWidth,
      // Add type-specific properties
      ...(data.path && { path: data.path }),
      ...(data.text && {
        text: data.text,
        fontSize: data.fontSize,
        fontFamily: data.fontFamily,
      }),
    })) as unknown as FabricObject[];
  }

  /**
   * Get current canvas JSON (placeholder - would integrate with actual Fabric.js canvas)
   */
  private async getCurrentCanvasJSON(
    _projectId: string,
    _imageLabel: string
  ): Promise<FabricCanvasJSON> {
    // This would integrate with the actual Fabric.js canvas instance
    // For now, return a basic structure
    return {
      version: '2.0.0',
      objects: [],
      background: '#ffffff',
    };
  }

  /**
   * Cleanup canvas state when no longer needed
   */
  cleanup(projectId: string, imageLabel: string): void {
    const canvasId = this.getCanvasId(projectId, imageLabel);
    this.canvasStates.delete(canvasId);
    this.stateHistory.delete(canvasId);
    this.currentHistoryIndex.delete(canvasId);
  }

  /**
   * Get canvas statistics
   */
  getCanvasStats(
    projectId: string,
    imageLabel: string
  ): Result<
    {
      objectCount: number;
      measurementCount: number;
      historySize: number;
      isDirty: boolean;
      currentTool: ToolType;
    },
    AppError
  > {
    const stateResult = this.getCanvasState(projectId, imageLabel);
    if (!stateResult.success) {
      return Result.err(stateResult.error);
    }

    const canvasId = this.getCanvasId(projectId, imageLabel);
    const history = this.stateHistory.get(canvasId) || [];
    const state = stateResult.data;

    return Result.ok({
      objectCount: state.selectedObjectIds.length, // Placeholder
      measurementCount: 0, // Would get from measurements service
      historySize: history.length,
      isDirty: state.isDirty,
      currentTool: state.currentTool,
    });
  }
}

// Export service instance
export const canvasStateService = new CanvasStateService();
