// Fabric.js integration service that bridges with TypeScript canvas state
import { canvasStateService } from './canvas/canvasManager';
import { Result } from '@/utils/result';
import { AppError, ErrorCode } from '@/types/app.types';
import type { FabricCanvasJSON, ToolType, BrushSettings, Position } from '@/types/app.types';
import type { FabricObjectData } from '@/types/supabase.types';

// Fabric.js canvas wrapper interface (for the global fabric object)
declare global {
  interface Window {
    fabric: {
      Canvas: any;
      Object: any;
      Path: any;
      Rect: any;
      Circle: any;
      Line: any;
      Text: any;
      Group: any;
      Image: any;
      PencilBrush: any;
      PatternBrush: any;
      Point: any;
      util: any;
    };
  }
}

// Canvas instance management
export interface CanvasInstance {
  id: string;
  projectId: string;
  imageLabel: string;
  fabricCanvas: any; // fabric.Canvas instance
  containerElement: HTMLElement;
  isInitialized: boolean;
  lastSaved: number;
}

// Drawing tool configuration
export interface DrawingToolConfig {
  type: ToolType;
  cursor: string;
  brush?: {
    type: 'pencil' | 'pattern' | 'circle';
    width: number;
    color: string;
    opacity: number;
  };
  selection: boolean;
}

// Object creation options
export interface ObjectCreationOptions {
  stroke?: string;
  strokeWidth?: number;
  fill?: string;
  opacity?: number;
  selectable?: boolean;
  evented?: boolean;
}

// Canvas interaction callbacks
export interface CanvasInteractionCallbacks {
  onObjectAdded?: (obj: any) => void;
  onObjectModified?: (obj: any) => void;
  onObjectRemoved?: (obj: any) => void;
  onSelectionCreated?: (selection: any) => void;
  onSelectionUpdated?: (selection: any) => void;
  onSelectionCleared?: () => void;
  onPathCreated?: (path: any) => void;
  onMouseDown?: (event: any) => void;
  onMouseMove?: (event: any) => void;
  onMouseUp?: (event: any) => void;
}

/**
 * Fabric.js integration service that provides a TypeScript interface to canvas operations
 */
export class FabricIntegrationService {
  private canvasInstances = new Map<string, CanvasInstance>();
  private drawingToolConfigs = new Map<ToolType, DrawingToolConfig>();
  private autoSaveIntervals = new Map<string, number>();

  constructor() {
    this.initializeDrawingTools();
  }

  /**
   * Initialize a Fabric.js canvas for a project image
   */
  async initializeCanvas(
    projectId: string,
    imageLabel: string,
    containerElement: HTMLElement,
    options?: {
      width?: number;
      height?: number;
      backgroundColor?: string;
      callbacks?: CanvasInteractionCallbacks;
    }
  ): Promise<Result<CanvasInstance, AppError>> {
    try {
      if (!window.fabric) {
        return Result.err(
          new AppError(
            ErrorCode.CANVAS_INVALID_STATE,
            'Fabric.js is not loaded. Make sure to include Fabric.js before initializing canvas.'
          )
        );
      }

      const canvasId = this.getCanvasId(projectId, imageLabel);

      // Check if canvas already exists
      if (this.canvasInstances.has(canvasId)) {
        const existing = this.canvasInstances.get(canvasId)!;
        return Result.ok(existing);
      }

      // Initialize canvas state in our service
      const canvasConfig: Partial<{ width: number; height: number; backgroundColor: string }> = {};
      if (options?.width !== undefined) {
        canvasConfig.width = options.width;
      }
      if (options?.height !== undefined) {
        canvasConfig.height = options.height;
      }
      if (options?.backgroundColor !== undefined) {
        canvasConfig.backgroundColor = options.backgroundColor;
      }

      const stateResult = await canvasStateService.initializeCanvasState(
        projectId,
        imageLabel,
        canvasConfig
      );

      if (!stateResult.success) {
        return Result.err(stateResult.error);
      }

      // Create canvas element
      const canvasElement = document.createElement('canvas');
      canvasElement.id = `canvas_${canvasId}`;
      containerElement.appendChild(canvasElement);

      // Initialize Fabric.js canvas
      const fabricCanvas = new window.fabric.Canvas(canvasElement, {
        width: options?.width || 800,
        height: options?.height || 600,
        backgroundColor: options?.backgroundColor || '#ffffff',
        preserveObjectStacking: true,
        selection: true,
        enableRetinaScaling: true,
        allowTouchScrolling: false,
      });

      // Create canvas instance
      const canvasInstance: CanvasInstance = {
        id: canvasId,
        projectId,
        imageLabel,
        fabricCanvas,
        containerElement,
        isInitialized: false,
        lastSaved: Date.now(),
      };

      // Setup event handlers
      this.setupCanvasEventHandlers(canvasInstance, options?.callbacks);

      // Load existing canvas data
      const loadResult = await canvasStateService.loadCanvasState(projectId, imageLabel);
      if (loadResult.success) {
        await this.loadCanvasFromJSON(canvasInstance, loadResult.data);
      }

      // Set initial tool
      await this.setCanvasTool(canvasInstance, 'select');

      // Setup auto-save
      this.setupAutoSave(canvasInstance);

      canvasInstance.isInitialized = true;
      this.canvasInstances.set(canvasId, canvasInstance);

      return Result.ok(canvasInstance);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.CANVAS_INVALID_STATE,
          `Failed to initialize canvas: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { projectId, imageLabel }
        )
      );
    }
  }

  /**
   * Get canvas instance
   */
  getCanvasInstance(projectId: string, imageLabel: string): Result<CanvasInstance, AppError> {
    const canvasId = this.getCanvasId(projectId, imageLabel);
    const instance = this.canvasInstances.get(canvasId);

    if (!instance) {
      return Result.err(
        new AppError(
          ErrorCode.CANVAS_NOT_FOUND,
          'Canvas instance not found. Initialize canvas first.'
        )
      );
    }

    return Result.ok(instance);
  }

  /**
   * Set canvas tool
   */
  async setCanvasTool(
    canvasInstance: CanvasInstance,
    tool: ToolType
  ): Promise<Result<boolean, AppError>> {
    try {
      const toolConfig = this.drawingToolConfigs.get(tool);
      if (!toolConfig) {
        return Result.err(new AppError(ErrorCode.VALIDATION_ERROR, `Unknown tool type: ${tool}`));
      }

      const { fabricCanvas } = canvasInstance;

      // Update canvas state
      await canvasStateService.setCurrentTool(
        canvasInstance.projectId,
        canvasInstance.imageLabel,
        tool
      );

      // Configure canvas based on tool
      switch (tool) {
        case 'select':
          fabricCanvas.isDrawingMode = false;
          fabricCanvas.selection = true;
          fabricCanvas.defaultCursor = 'default';
          fabricCanvas.hoverCursor = 'move';
          break;

        case 'pencil':
          fabricCanvas.isDrawingMode = true;
          fabricCanvas.selection = false;
          fabricCanvas.freeDrawingBrush = new window.fabric.PencilBrush(fabricCanvas);
          this.updateBrushSettings(canvasInstance);
          break;

        case 'brush':
          fabricCanvas.isDrawingMode = true;
          fabricCanvas.selection = false;
          fabricCanvas.freeDrawingBrush = new window.fabric.PencilBrush(fabricCanvas);
          this.updateBrushSettings(canvasInstance);
          break;

        case 'eraser':
          fabricCanvas.isDrawingMode = true;
          fabricCanvas.selection = false;
          // TODO: Implement eraser tool
          break;

        case 'line':
        case 'rectangle':
        case 'circle':
          fabricCanvas.isDrawingMode = false;
          fabricCanvas.selection = false;
          fabricCanvas.defaultCursor = 'crosshair';
          this.setupShapeDrawing(canvasInstance, tool);
          break;

        case 'text':
          fabricCanvas.isDrawingMode = false;
          fabricCanvas.selection = false;
          fabricCanvas.defaultCursor = 'text';
          this.setupTextTool(canvasInstance);
          break;

        case 'pan':
          fabricCanvas.isDrawingMode = false;
          fabricCanvas.selection = false;
          fabricCanvas.defaultCursor = 'grab';
          this.setupPanTool(canvasInstance);
          break;

        case 'zoom':
          fabricCanvas.isDrawingMode = false;
          fabricCanvas.selection = false;
          fabricCanvas.defaultCursor = 'zoom-in';
          this.setupZoomTool(canvasInstance);
          break;

        default:
          return Result.err(
            new AppError(ErrorCode.VALIDATION_ERROR, `Tool "${tool}" is not implemented yet`)
          );
      }

      fabricCanvas.renderAll();
      return Result.ok(true);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.CANVAS_INVALID_STATE,
          `Failed to set canvas tool: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { tool, canvasId: canvasInstance.id }
        )
      );
    }
  }

  /**
   * Update brush settings
   */
  async updateCanvasBrushSettings(
    canvasInstance: CanvasInstance,
    settings: Partial<BrushSettings>
  ): Promise<Result<boolean, AppError>> {
    try {
      // Update canvas state
      await canvasStateService.updateBrushSettings(
        canvasInstance.projectId,
        canvasInstance.imageLabel,
        settings
      );

      // Apply to Fabric.js canvas
      this.updateBrushSettings(canvasInstance);

      return Result.ok(true);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.CANVAS_INVALID_STATE,
          `Failed to update brush settings: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      );
    }
  }

  /**
   * Add object to canvas
   */
  async addObjectToCanvas(
    canvasInstance: CanvasInstance,
    objectType: string,
    options: ObjectCreationOptions & Record<string, any>
  ): Promise<Result<any, AppError>> {
    try {
      const { fabricCanvas } = canvasInstance;
      let fabricObject: any;

      // Create object based on type
      switch (objectType) {
        case 'rect':
          fabricObject = new window.fabric.Rect({
            left: options['left'] || 100,
            top: options['top'] || 100,
            width: options['width'] || 100,
            height: options['height'] || 100,
            fill: options['fill'] || 'transparent',
            stroke: options['stroke'] || '#000000',
            strokeWidth: options['strokeWidth'] || 2,
            ...options,
          });
          break;

        case 'circle':
          fabricObject = new window.fabric.Circle({
            left: options['left'] || 100,
            top: options['top'] || 100,
            radius: options['radius'] || 50,
            fill: options['fill'] || 'transparent',
            stroke: options['stroke'] || '#000000',
            strokeWidth: options['strokeWidth'] || 2,
            ...options,
          });
          break;

        case 'line':
          fabricObject = new window.fabric.Line(
            [options['x1'] || 50, options['y1'] || 50, options['x2'] || 150, options['y2'] || 150],
            {
              stroke: options['stroke'] || '#000000',
              strokeWidth: options['strokeWidth'] || 2,
              ...options,
            }
          );
          break;

        case 'text':
          fabricObject = new window.fabric.Text(options['text'] || 'Sample Text', {
            left: options['left'] || 100,
            top: options['top'] || 100,
            fontSize: options['fontSize'] || 20,
            fontFamily: options['fontFamily'] || 'Arial',
            fill: options['fill'] || '#000000',
            ...options,
          });
          break;

        default:
          return Result.err(
            new AppError(ErrorCode.VALIDATION_ERROR, `Unsupported object type: ${objectType}`)
          );
      }

      // Add unique ID
      fabricObject.set('id', `obj_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`);

      // Add to canvas
      fabricCanvas.add(fabricObject);
      fabricCanvas.renderAll();

      return Result.ok(fabricObject);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.CANVAS_INVALID_STATE,
          `Failed to add object: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { objectType, options }
        )
      );
    }
  }

  /**
   * Remove object from canvas
   */
  async removeObjectFromCanvas(
    canvasInstance: CanvasInstance,
    objectId: string
  ): Promise<Result<boolean, AppError>> {
    try {
      const { fabricCanvas } = canvasInstance;
      const objects = fabricCanvas.getObjects();
      const objectToRemove = objects.find((obj: any) => obj.id === objectId);

      if (!objectToRemove) {
        return Result.err(
          new AppError(ErrorCode.VALIDATION_ERROR, `Object with ID ${objectId} not found`)
        );
      }

      fabricCanvas.remove(objectToRemove);
      fabricCanvas.renderAll();

      return Result.ok(true);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.CANVAS_INVALID_STATE,
          `Failed to remove object: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { objectId }
        )
      );
    }
  }

  /**
   * Load canvas from JSON data
   */
  async loadCanvasFromJSON(
    canvasInstance: CanvasInstance,
    jsonData: FabricCanvasJSON
  ): Promise<Result<boolean, AppError>> {
    return new Promise(resolve => {
      try {
        const { fabricCanvas } = canvasInstance;

        fabricCanvas.loadFromJSON(
          jsonData,
          () => {
            fabricCanvas.renderAll();
            resolve(Result.ok(true));
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (o: any, object: any) => {
            // Reviver: restore custom properties from serialized JSON to fabric object
            if (o && o['strokeMetadata']) {
              object['strokeMetadata'] = o['strokeMetadata'];
            }
            if (o && o['isArrow']) {
              object['isArrow'] = o['isArrow'];
            }
            if (o && o['customPoints']) {
              object['customPoints'] = o['customPoints'];
            }
          }
        );
      } catch (error) {
        resolve(
          Result.err(
            new AppError(
              ErrorCode.CANVAS_LOAD_FAILED,
              `Failed to load canvas from JSON: ${error instanceof Error ? error.message : 'Unknown error'}`
            )
          )
        );
      }
    });
  }

  /**
   * Save canvas to JSON
   */
  async saveCanvasToJSON(
    canvasInstance: CanvasInstance
  ): Promise<Result<FabricCanvasJSON, AppError>> {
    try {
      const { fabricCanvas } = canvasInstance;
      // Include strokeMetadata, isArrow, and customPoints to preserve stroke labels, visibility state, arrow markers, and curve control points
      const jsonData = fabricCanvas.toJSON(['strokeMetadata', 'isArrow', 'customPoints']);

      // Save to canvas state service
      await canvasStateService.saveCanvasState(
        canvasInstance.projectId,
        canvasInstance.imageLabel,
        jsonData
      );

      canvasInstance.lastSaved = Date.now();

      return Result.ok(jsonData);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.CANVAS_SAVE_FAILED,
          `Failed to save canvas to JSON: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      );
    }
  }

  /**
   * Undo last operation
   */
  async undoCanvasOperation(canvasInstance: CanvasInstance): Promise<Result<boolean, AppError>> {
    try {
      const undoResult = await canvasStateService.undo(
        canvasInstance.projectId,
        canvasInstance.imageLabel
      );

      if (!undoResult.success) {
        return Result.err(undoResult.error);
      }

      if (undoResult.data) {
        await this.loadCanvasFromJSON(canvasInstance, undoResult.data);
        return Result.ok(true);
      }

      return Result.ok(false); // Nothing to undo
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.CANVAS_INVALID_STATE,
          `Undo operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      );
    }
  }

  /**
   * Redo last undone operation
   */
  async redoCanvasOperation(canvasInstance: CanvasInstance): Promise<Result<boolean, AppError>> {
    try {
      const redoResult = await canvasStateService.redo(
        canvasInstance.projectId,
        canvasInstance.imageLabel
      );

      if (!redoResult.success) {
        return Result.err(redoResult.error);
      }

      if (redoResult.data) {
        await this.loadCanvasFromJSON(canvasInstance, redoResult.data);
        return Result.ok(true);
      }

      return Result.ok(false); // Nothing to redo
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.CANVAS_INVALID_STATE,
          `Redo operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      );
    }
  }

  /**
   * Set canvas zoom
   */
  async setCanvasZoom(
    canvasInstance: CanvasInstance,
    zoom: number,
    center?: Position
  ): Promise<Result<boolean, AppError>> {
    try {
      const { fabricCanvas } = canvasInstance;

      if (center) {
        fabricCanvas.zoomToPoint(new window.fabric.Point(center.x, center.y), zoom);
      } else {
        fabricCanvas.setZoom(zoom);
      }

      // Update canvas state
      await canvasStateService.updateViewport(canvasInstance.projectId, canvasInstance.imageLabel, {
        zoom,
      });

      fabricCanvas.renderAll();
      return Result.ok(true);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.CANVAS_INVALID_STATE,
          `Failed to set canvas zoom: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      );
    }
  }

  /**
   * Pan canvas
   */
  async panCanvas(
    canvasInstance: CanvasInstance,
    deltaX: number,
    deltaY: number
  ): Promise<Result<boolean, AppError>> {
    try {
      const { fabricCanvas } = canvasInstance;
      const vpt = fabricCanvas.viewportTransform;

      vpt[4] += deltaX;
      vpt[5] += deltaY;

      fabricCanvas.setViewportTransform(vpt);

      // Update canvas state
      await canvasStateService.updateViewport(canvasInstance.projectId, canvasInstance.imageLabel, {
        panOffset: {
          x: vpt[4],
          y: vpt[5],
        },
      });

      fabricCanvas.renderAll();
      return Result.ok(true);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.CANVAS_INVALID_STATE,
          `Failed to pan canvas: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      );
    }
  }

  /**
   * Get selected objects
   */
  getSelectedObjects(canvasInstance: CanvasInstance): any[] {
    const { fabricCanvas } = canvasInstance;
    const activeSelection = fabricCanvas.getActiveSelection();

    if (activeSelection && activeSelection.type === 'activeSelection') {
      return activeSelection.getObjects();
    }

    const activeObject = fabricCanvas.getActiveObject();
    return activeObject ? [activeObject] : [];
  }

  /**
   * Clear canvas selection
   */
  clearCanvasSelection(canvasInstance: CanvasInstance): void {
    const { fabricCanvas } = canvasInstance;
    fabricCanvas.discardActiveObject();
    fabricCanvas.renderAll();
  }

  /**
   * Cleanup canvas instance
   */
  disposeCanvas(projectId: string, imageLabel: string): void {
    const canvasId = this.getCanvasId(projectId, imageLabel);
    const instance = this.canvasInstances.get(canvasId);

    if (instance) {
      // Clear auto-save interval
      const intervalId = this.autoSaveIntervals.get(canvasId);
      if (intervalId) {
        clearInterval(intervalId);
        this.autoSaveIntervals.delete(canvasId);
      }

      // Dispose Fabric.js canvas
      if (instance.fabricCanvas) {
        instance.fabricCanvas.dispose();
      }

      // Remove from DOM
      const canvasElement = instance.containerElement.querySelector(`#canvas_${canvasId}`);
      if (canvasElement) {
        canvasElement.remove();
      }

      // Cleanup state
      this.canvasInstances.delete(canvasId);
      canvasStateService.cleanup(projectId, imageLabel);
    }
  }

  /**
   * Initialize drawing tool configurations
   */
  private initializeDrawingTools(): void {
    const tools: Array<[ToolType, DrawingToolConfig]> = [
      ['select', { type: 'select', cursor: 'default', selection: true }],
      [
        'pencil',
        {
          type: 'pencil',
          cursor: 'crosshair',
          selection: false,
          brush: { type: 'pencil', width: 2, color: '#000000', opacity: 1 },
        },
      ],
      [
        'brush',
        {
          type: 'brush',
          cursor: 'crosshair',
          selection: false,
          brush: { type: 'pencil', width: 10, color: '#000000', opacity: 1 },
        },
      ],
      ['eraser', { type: 'eraser', cursor: 'crosshair', selection: false }],
      ['rectangle', { type: 'rectangle', cursor: 'crosshair', selection: false }],
      ['circle', { type: 'circle', cursor: 'crosshair', selection: false }],
      ['line', { type: 'line', cursor: 'crosshair', selection: false }],
      ['text', { type: 'text', cursor: 'text', selection: false }],
      ['pan', { type: 'pan', cursor: 'grab', selection: false }],
      ['zoom', { type: 'zoom', cursor: 'zoom-in', selection: false }],
    ];

    tools.forEach(([toolType, config]) => {
      this.drawingToolConfigs.set(toolType, config);
    });
  }

  /**
   * Setup canvas event handlers
   */
  private setupCanvasEventHandlers(
    canvasInstance: CanvasInstance,
    callbacks?: CanvasInteractionCallbacks
  ): void {
    const { fabricCanvas } = canvasInstance;

    // Object events
    fabricCanvas.on('object:added', (e: any) => {
      if (e.target && !e.target._isFromJSON) {
        canvasStateService.endDrawing(
          canvasInstance.projectId,
          canvasInstance.imageLabel,
          this.fabricObjectToData(e.target)
        );
        callbacks?.onObjectAdded?.(e.target);
      }
    });

    fabricCanvas.on('object:modified', (e: any) => {
      if (e.target) {
        callbacks?.onObjectModified?.(e.target);
      }
    });

    fabricCanvas.on('object:removed', (e: any) => {
      if (e.target) {
        callbacks?.onObjectRemoved?.(e.target);
      }
    });

    // Selection events
    fabricCanvas.on('selection:created', (e: any) => {
      const selectedIds = this.getObjectIds(e.selected || [e.target]);
      canvasStateService.setSelectedObjects(
        canvasInstance.projectId,
        canvasInstance.imageLabel,
        selectedIds
      );
      callbacks?.onSelectionCreated?.(e);
    });

    fabricCanvas.on('selection:updated', (e: any) => {
      const selectedIds = this.getObjectIds(e.selected || [e.target]);
      canvasStateService.setSelectedObjects(
        canvasInstance.projectId,
        canvasInstance.imageLabel,
        selectedIds
      );
      callbacks?.onSelectionUpdated?.(e);
    });

    fabricCanvas.on('selection:cleared', () => {
      canvasStateService.setSelectedObjects(
        canvasInstance.projectId,
        canvasInstance.imageLabel,
        []
      );
      callbacks?.onSelectionCleared?.();
    });

    // Drawing events
    fabricCanvas.on('path:created', (e: any) => {
      if (e.path) {
        canvasStateService.endDrawing(
          canvasInstance.projectId,
          canvasInstance.imageLabel,
          this.fabricObjectToData(e.path)
        );
        callbacks?.onPathCreated?.(e.path);
      }
    });

    // Mouse events
    fabricCanvas.on('mouse:down', (e: any) => {
      const stateResult = canvasStateService.getCanvasState(
        canvasInstance.projectId,
        canvasInstance.imageLabel
      );

      if (stateResult.success && stateResult.data.currentTool !== 'select') {
        canvasStateService.startDrawing(canvasInstance.projectId, canvasInstance.imageLabel);
      }

      callbacks?.onMouseDown?.(e);
    });

    fabricCanvas.on('mouse:move', callbacks?.onMouseMove);
    fabricCanvas.on('mouse:up', callbacks?.onMouseUp);
  }

  /**
   * Update brush settings on Fabric.js canvas
   */
  private updateBrushSettings(canvasInstance: CanvasInstance): void {
    const stateResult = canvasStateService.getCanvasState(
      canvasInstance.projectId,
      canvasInstance.imageLabel
    );

    if (!stateResult.success) return;

    const { brushSettings } = stateResult.data;
    const { fabricCanvas } = canvasInstance;

    if (fabricCanvas.freeDrawingBrush) {
      fabricCanvas.freeDrawingBrush.color = brushSettings.color;
      fabricCanvas.freeDrawingBrush.width = brushSettings.width;

      // Set opacity if supported
      if (fabricCanvas.freeDrawingBrush.globalCompositeOperation !== undefined) {
        fabricCanvas.freeDrawingBrush.globalCompositeOperation =
          brushSettings.opacity < 1 ? 'source-over' : 'source-over';
      }
    }
  }

  /**
   * Setup shape drawing tool
   */
  private setupShapeDrawing(_canvasInstance: CanvasInstance, _shape: ToolType): void {
    // This would setup mouse event handlers for drawing shapes
    // Implementation depends on the specific shape drawing requirements
  }

  /**
   * Setup text tool
   */
  private setupTextTool(_canvasInstance: CanvasInstance): void {
    // This would setup text input functionality
    // Implementation depends on text editing requirements
  }

  /**
   * Setup pan tool
   */
  private setupPanTool(_canvasInstance: CanvasInstance): void {
    // This would setup panning functionality
    // Implementation depends on pan interaction requirements
  }

  /**
   * Setup zoom tool
   */
  private setupZoomTool(_canvasInstance: CanvasInstance): void {
    // This would setup zoom functionality
    // Implementation depends on zoom interaction requirements
  }

  /**
   * Setup auto-save functionality
   */
  private setupAutoSave(canvasInstance: CanvasInstance): void {
    const canvasId = canvasInstance.id;
    const intervalId = window.setInterval(() => {
      const stateResult = canvasStateService.getCanvasState(
        canvasInstance.projectId,
        canvasInstance.imageLabel
      );

      if (stateResult.success && stateResult.data.isDirty) {
        void this.saveCanvasToJSON(canvasInstance);
      }
    }, 30000); // Auto-save every 30 seconds

    this.autoSaveIntervals.set(canvasId, intervalId);
  }

  /**
   * Convert Fabric.js object to our data format
   */
  private fabricObjectToData(fabricObject: any): FabricObjectData {
    return {
      type: fabricObject.type,
      id: fabricObject.id || `obj_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      left: fabricObject.left,
      top: fabricObject.top,
      width: fabricObject.width,
      height: fabricObject.height,
      scaleX: fabricObject.scaleX,
      scaleY: fabricObject.scaleY,
      angle: fabricObject.angle,
      visible: fabricObject.visible,
      selectable: fabricObject.selectable,
      fill: fabricObject.fill,
      stroke: fabricObject.stroke,
      strokeWidth: fabricObject.strokeWidth,
      isDrawnObject: true,
      metadata: {
        createdAt: new Date().toISOString(),
        version: '2.0.0',
      },
    };
  }

  /**
   * Get object IDs from Fabric.js objects
   */
  private getObjectIds(objects: any[]): string[] {
    return objects.map(obj => obj.id || '').filter(id => id);
  }

  /**
   * Generate canvas ID
   */
  private getCanvasId(projectId: string, imageLabel: string): string {
    return `${projectId}:${imageLabel}`;
  }
}

// Export service instance
export const fabricIntegrationService = new FabricIntegrationService();
