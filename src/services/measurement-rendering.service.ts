// Measurement rendering service for canvas visualization
import { fabricIntegrationService } from './fabric-integration.service';
import { measurementsService, type CreateMeasurementData } from './measurements.service';
import { Result } from '@/utils/result';
import { AppError, ErrorCode } from '@/types/app.types';
import type { MeasurementData } from '@/types/supabase.types';
import type { Position } from '@/types/app.types';

// Measurement visual style
export interface MeasurementStyle {
  line: {
    stroke: string;
    strokeWidth: number;
    strokeDashArray?: number[];
    opacity: number;
  };
  label: {
    fontSize: number;
    fontFamily: string;
    fill: string;
    backgroundColor?: string;
    padding: number;
    borderRadius: number;
  };
  handles: {
    radius: number;
    fill: string;
    stroke: string;
    strokeWidth: number;
    opacity: number;
  };
  highlight: {
    stroke: string;
    strokeWidth: number;
    opacity: number;
  };
}

// Measurement interaction state
export interface MeasurementInteraction {
  isCreating: boolean;
  isEditing: boolean;
  activeHandle?: 'start' | 'end' | 'control';
  dragState?: {
    startPoint: Position;
    originalCoordinates: MeasurementData['coordinates'];
  };
}

// Measurement rendering options
export interface MeasurementRenderOptions {
  showHandles: boolean;
  showLabels: boolean;
  showValues: boolean;
  highlightSelected: boolean;
  enableInteraction: boolean;
  style?: Partial<MeasurementStyle>;
}

// Measurement canvas object group
export interface MeasurementCanvasObject {
  id: string;
  measurementId: string;
  group: any; // Fabric.js Group
  line: any; // Fabric.js Line
  label: any; // Fabric.js Text
  handles: any[]; // Fabric.js Circle objects
  isVisible: boolean;
  isSelected: boolean;
}

/**
 * Service for rendering and interacting with measurements on the canvas
 */
export class MeasurementRenderingService {
  private measurementObjects = new Map<string, Map<string, MeasurementCanvasObject>>();
  private interactionStates = new Map<string, MeasurementInteraction>();
  private renderOptions = new Map<string, MeasurementRenderOptions>();

  // Default styles
  private readonly DEFAULT_STYLE: MeasurementStyle = {
    line: {
      stroke: '#ff0000',
      strokeWidth: 2,
      opacity: 1,
    },
    label: {
      fontSize: 14,
      fontFamily: 'Arial',
      fill: '#000000',
      backgroundColor: '#ffffff',
      padding: 4,
      borderRadius: 2,
    },
    handles: {
      radius: 4,
      fill: '#ffffff',
      stroke: '#ff0000',
      strokeWidth: 2,
      opacity: 1,
    },
    highlight: {
      stroke: '#ffff00',
      strokeWidth: 3,
      opacity: 0.8,
    },
  };

  private readonly DEFAULT_RENDER_OPTIONS: MeasurementRenderOptions = {
    showHandles: true,
    showLabels: true,
    showValues: true,
    highlightSelected: true,
    enableInteraction: true,
  };

  /**
   * Initialize measurement rendering for a canvas
   */
  async initializeMeasurementRendering(
    projectId: string,
    imageLabel: string,
    options?: Partial<MeasurementRenderOptions>
  ): Promise<Result<boolean, AppError>> {
    try {
      const canvasKey = this.getCanvasKey(projectId, imageLabel);

      // Initialize maps for this canvas
      this.measurementObjects.set(canvasKey, new Map());
      this.interactionStates.set(canvasKey, {
        isCreating: false,
        isEditing: false,
      });
      this.renderOptions.set(canvasKey, {
        ...this.DEFAULT_RENDER_OPTIONS,
        ...options,
      });

      // Load and render existing measurements
      const loadResult = await this.loadAndRenderMeasurements(projectId, imageLabel);
      if (!loadResult.success) {
        return Result.err(loadResult.error);
      }

      return Result.ok(true);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.CANVAS_INVALID_STATE,
          `Failed to initialize measurement rendering: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { projectId, imageLabel }
        )
      );
    }
  }

  /**
   * Render all measurements for a canvas
   */
  async loadAndRenderMeasurements(
    projectId: string,
    imageLabel: string
  ): Promise<Result<number, AppError>> {
    try {
      // Get measurements from service
      const measurementsResult = await measurementsService.getMeasurements(projectId, {
        imageLabel,
      });

      if (!measurementsResult.success) {
        return Result.err(measurementsResult.error);
      }

      const measurements = measurementsResult.data;
      let renderedCount = 0;

      // Render each measurement
      for (const measurement of measurements) {
        const renderResult = await this.renderMeasurement(projectId, imageLabel, measurement);
        if (renderResult.success) {
          renderedCount++;
        }
      }

      return Result.ok(renderedCount);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.CANVAS_INVALID_STATE,
          `Failed to load and render measurements: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      );
    }
  }

  /**
   * Render a single measurement on the canvas
   */
  async renderMeasurement(
    projectId: string,
    imageLabel: string,
    measurement: MeasurementData
  ): Promise<Result<MeasurementCanvasObject, AppError>> {
    try {
      // Get canvas instance
      const canvasResult = fabricIntegrationService.getCanvasInstance(projectId, imageLabel);
      if (!canvasResult.success) {
        return Result.err(canvasResult.error);
      }

      const canvasInstance = canvasResult.data;
      const fabricCanvas = canvasInstance.fabricCanvas;
      const canvasKey = this.getCanvasKey(projectId, imageLabel);
      const options = this.renderOptions.get(canvasKey) || this.DEFAULT_RENDER_OPTIONS;
      const style = { ...this.DEFAULT_STYLE, ...options.style };

      // Create measurement objects based on type
      let measurementObject: MeasurementCanvasObject;

      switch (measurement.type) {
        case 'line':
          measurementObject = await this.renderLineMeasurement(
            fabricCanvas,
            measurement,
            style,
            options
          );
          break;

        case 'area':
          measurementObject = await this.renderAreaMeasurement(
            fabricCanvas,
            measurement,
            style,
            options
          );
          break;

        case 'angle':
          measurementObject = await this.renderAngleMeasurement(
            fabricCanvas,
            measurement,
            style,
            options
          );
          break;

        default:
          return Result.err(
            new AppError(
              ErrorCode.VALIDATION_ERROR,
              `Unsupported measurement type: ${measurement.type}`
            )
          );
      }

      // Store measurement object
      const measurementMap = this.measurementObjects.get(canvasKey)!;
      measurementMap.set(measurement.id, measurementObject);

      // Setup interaction handlers
      if (options.enableInteraction) {
        this.setupMeasurementInteraction(projectId, imageLabel, measurementObject);
      }

      fabricCanvas.renderAll();
      return Result.ok(measurementObject);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.CANVAS_INVALID_STATE,
          `Failed to render measurement: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { measurementId: measurement.id }
        )
      );
    }
  }

  /**
   * Start creating a new measurement
   */
  async startMeasurementCreation(
    projectId: string,
    imageLabel: string,
    type: 'line' | 'area' | 'angle',
    startPoint: Position
  ): Promise<Result<string, AppError>> {
    try {
      const canvasKey = this.getCanvasKey(projectId, imageLabel);
      const interactionState = this.interactionStates.get(canvasKey);

      if (!interactionState) {
        return Result.err(
          new AppError(ErrorCode.CANVAS_INVALID_STATE, 'Measurement rendering not initialized')
        );
      }

      // Set creation state
      interactionState.isCreating = true;
      interactionState.activeHandle = 'start';

      // Create temporary measurement object for preview
      const tempMeasurement: MeasurementData = {
        id: `temp_${Date.now()}`,
        imageLabel,
        type,
        label: `${type} measurement`,
        value: 0,
        unit: 'px',
        coordinates: {
          start: startPoint,
          end: startPoint, // Will be updated as user drags
        },
        style: {
          color: this.DEFAULT_STYLE.line.stroke,
          strokeWidth: this.DEFAULT_STYLE.line.strokeWidth,
          fontSize: this.DEFAULT_STYLE.label.fontSize,
          labelPosition: 'above' as const,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Render preview
      const renderResult = await this.renderMeasurement(projectId, imageLabel, tempMeasurement);
      if (!renderResult.success) {
        return Result.err(renderResult.error);
      }

      return Result.ok(tempMeasurement.id);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.CANVAS_INVALID_STATE,
          `Failed to start measurement creation: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      );
    }
  }

  /**
   * Update measurement during creation
   */
  async updateMeasurementCreation(
    projectId: string,
    imageLabel: string,
    tempId: string,
    currentPoint: Position
  ): Promise<Result<boolean, AppError>> {
    try {
      const canvasKey = this.getCanvasKey(projectId, imageLabel);
      const measurementMap = this.measurementObjects.get(canvasKey);
      const measurementObj = measurementMap?.get(tempId);

      if (!measurementObj) {
        return Result.err(
          new AppError(ErrorCode.VALIDATION_ERROR, 'Temporary measurement not found')
        );
      }

      // Update line endpoint
      if (measurementObj.line) {
        measurementObj.line.set('x2', currentPoint.x);
        measurementObj.line.set('y2', currentPoint.y);
      }

      // Update handles if visible
      if (measurementObj.handles && measurementObj.handles.length > 1) {
        measurementObj.handles[1].set('left', currentPoint.x);
        measurementObj.handles[1].set('top', currentPoint.y);
      }

      // Update label position and value
      if (measurementObj.label) {
        const midPoint = this.calculateMidpoint(
          { x: measurementObj.line.x1, y: measurementObj.line.y1 },
          currentPoint
        );

        measurementObj.label.set('left', midPoint.x);
        measurementObj.label.set('top', midPoint.y - 10);

        // Calculate and update distance
        const distance = this.calculateDistance(
          { x: measurementObj.line.x1, y: measurementObj.line.y1 },
          currentPoint
        );

        measurementObj.label.set('text', `${distance.toFixed(1)}px`);
      }

      // Get canvas and render
      const canvasResult = fabricIntegrationService.getCanvasInstance(projectId, imageLabel);
      if (canvasResult.success) {
        canvasResult.data.fabricCanvas.renderAll();
      }

      return Result.ok(true);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.CANVAS_INVALID_STATE,
          `Failed to update measurement creation: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      );
    }
  }

  /**
   * Complete measurement creation
   */
  async completeMeasurementCreation(
    projectId: string,
    imageLabel: string,
    tempId: string,
    endPoint: Position,
    measurementData: Omit<CreateMeasurementData, 'coordinates' | 'imageLabel' | 'type'>
  ): Promise<Result<MeasurementData, AppError>> {
    try {
      const canvasKey = this.getCanvasKey(projectId, imageLabel);
      const measurementMap = this.measurementObjects.get(canvasKey);
      const tempMeasurementObj = measurementMap?.get(tempId);

      if (!tempMeasurementObj) {
        return Result.err(
          new AppError(ErrorCode.VALIDATION_ERROR, 'Temporary measurement not found')
        );
      }

      // Get start point from temporary object
      const startPoint = {
        x: tempMeasurementObj.line.x1,
        y: tempMeasurementObj.line.y1,
      };

      // Calculate measurement value
      const value = this.calculateMeasurementValue(
        tempMeasurementObj.measurementId.includes('line') ? 'line' : 'area',
        { start: startPoint, end: endPoint }
      );

      // Create actual measurement
      const createMeasurementData: CreateMeasurementData = {
        ...measurementData,
        imageLabel,
        type: tempMeasurementObj.measurementId.includes('line') ? 'line' : 'area',
        value,
        coordinates: {
          start: startPoint,
          end: endPoint,
        },
      };

      const createResult = await measurementsService.createMeasurement(
        projectId,
        createMeasurementData
      );

      if (!createResult.success) {
        return Result.err(createResult.error);
      }

      // Remove temporary measurement
      await this.removeMeasurementFromCanvas(projectId, imageLabel, tempId);

      // Render final measurement
      await this.renderMeasurement(projectId, imageLabel, createResult.data);

      // Reset interaction state
      const interactionState = this.interactionStates.get(canvasKey);
      if (interactionState) {
        interactionState.isCreating = false;
        delete interactionState.activeHandle;
      }

      return Result.ok(createResult.data);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.CANVAS_INVALID_STATE,
          `Failed to complete measurement creation: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      );
    }
  }

  /**
   * Cancel measurement creation
   */
  async cancelMeasurementCreation(
    projectId: string,
    imageLabel: string,
    tempId: string
  ): Promise<Result<boolean, AppError>> {
    try {
      // Remove temporary measurement
      await this.removeMeasurementFromCanvas(projectId, imageLabel, tempId);

      // Reset interaction state
      const canvasKey = this.getCanvasKey(projectId, imageLabel);
      const interactionState = this.interactionStates.get(canvasKey);
      if (interactionState) {
        interactionState.isCreating = false;
        delete interactionState.activeHandle;
      }

      return Result.ok(true);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.CANVAS_INVALID_STATE,
          `Failed to cancel measurement creation: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      );
    }
  }

  /**
   * Remove measurement from canvas
   */
  async removeMeasurementFromCanvas(
    projectId: string,
    imageLabel: string,
    measurementId: string
  ): Promise<Result<boolean, AppError>> {
    try {
      const canvasKey = this.getCanvasKey(projectId, imageLabel);
      const measurementMap = this.measurementObjects.get(canvasKey);
      const measurementObj = measurementMap?.get(measurementId);

      if (!measurementObj) {
        return Result.ok(false); // Already removed
      }

      // Get canvas instance
      const canvasResult = fabricIntegrationService.getCanvasInstance(projectId, imageLabel);
      if (!canvasResult.success) {
        return Result.err(canvasResult.error);
      }

      const fabricCanvas = canvasResult.data.fabricCanvas;

      // Remove all objects from canvas
      if (measurementObj.group) {
        fabricCanvas.remove(measurementObj.group);
      } else {
        // Remove individual objects if not grouped
        if (measurementObj.line) fabricCanvas.remove(measurementObj.line);
        if (measurementObj.label) fabricCanvas.remove(measurementObj.label);
        measurementObj.handles?.forEach(handle => fabricCanvas.remove(handle));
      }

      // Remove from our tracking
      if (measurementMap) {
        measurementMap.delete(measurementId);
      }

      fabricCanvas.renderAll();
      return Result.ok(true);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.CANVAS_INVALID_STATE,
          `Failed to remove measurement from canvas: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      );
    }
  }

  /**
   * Update measurement rendering options
   */
  updateRenderOptions(
    projectId: string,
    imageLabel: string,
    options: Partial<MeasurementRenderOptions>
  ): Result<boolean, AppError> {
    try {
      const canvasKey = this.getCanvasKey(projectId, imageLabel);
      const currentOptions = this.renderOptions.get(canvasKey);

      if (!currentOptions) {
        return Result.err(
          new AppError(ErrorCode.CANVAS_INVALID_STATE, 'Measurement rendering not initialized')
        );
      }

      // Update options
      const newOptions = { ...currentOptions, ...options };
      this.renderOptions.set(canvasKey, newOptions);

      // Refresh all measurements with new options
      this.refreshMeasurementRendering(projectId, imageLabel);

      return Result.ok(true);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.CANVAS_INVALID_STATE,
          `Failed to update render options: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      );
    }
  }

  /**
   * Render line measurement
   */
  private async renderLineMeasurement(
    fabricCanvas: any,
    measurement: MeasurementData,
    style: MeasurementStyle,
    options: MeasurementRenderOptions
  ): Promise<MeasurementCanvasObject> {
    const { start, end } = measurement.coordinates;

    // Create line
    const line = new window.fabric.Line([start.x, start.y, end.x, end.y], {
      stroke: measurement.style.color || style.line.stroke,
      strokeWidth: measurement.style.strokeWidth || style.line.strokeWidth,
      strokeDashArray: style.line.strokeDashArray,
      opacity: style.line.opacity,
      selectable: false,
      evented: false,
    });

    // Create label
    const midPoint = this.calculateMidpoint(start, end);
    const distance = this.calculateDistance(start, end);
    const label = new window.fabric.Text(
      options.showValues
        ? `${measurement.label}: ${distance.toFixed(1)}${measurement.unit}`
        : measurement.label,
      {
        left: midPoint.x,
        top: midPoint.y - 15,
        fontSize: measurement.style.fontSize || style.label.fontSize,
        fontFamily: style.label.fontFamily,
        fill: style.label.fill,
        backgroundColor: style.label.backgroundColor,
        selectable: false,
        evented: false,
        originX: 'center',
        originY: 'center',
      }
    );

    // Create handles
    const handles = [];
    if (options.showHandles) {
      const startHandle = new window.fabric.Circle({
        left: start.x,
        top: start.y,
        radius: style.handles.radius,
        fill: style.handles.fill,
        stroke: style.handles.stroke,
        strokeWidth: style.handles.strokeWidth,
        opacity: style.handles.opacity,
        selectable: false,
        evented: options.enableInteraction,
        originX: 'center',
        originY: 'center',
      });

      const endHandle = new window.fabric.Circle({
        left: end.x,
        top: end.y,
        radius: style.handles.radius,
        fill: style.handles.fill,
        stroke: style.handles.stroke,
        strokeWidth: style.handles.strokeWidth,
        opacity: style.handles.opacity,
        selectable: false,
        evented: options.enableInteraction,
        originX: 'center',
        originY: 'center',
      });

      handles.push(startHandle, endHandle);
    }

    // Add objects to canvas
    fabricCanvas.add(line);
    if (options.showLabels) {
      fabricCanvas.add(label);
    }
    handles.forEach(handle => fabricCanvas.add(handle));

    return {
      id: `measurement_${measurement.id}`,
      measurementId: measurement.id,
      group: null,
      line,
      label: options.showLabels ? label : null,
      handles,
      isVisible: true,
      isSelected: false,
    };
  }

  /**
   * Render area measurement (placeholder)
   */
  private async renderAreaMeasurement(
    fabricCanvas: any,
    measurement: MeasurementData,
    style: MeasurementStyle,
    options: MeasurementRenderOptions
  ): Promise<MeasurementCanvasObject> {
    // For now, render as a line measurement
    // TODO: Implement proper area measurement rendering
    return this.renderLineMeasurement(fabricCanvas, measurement, style, options);
  }

  /**
   * Render angle measurement (placeholder)
   */
  private async renderAngleMeasurement(
    fabricCanvas: any,
    measurement: MeasurementData,
    style: MeasurementStyle,
    options: MeasurementRenderOptions
  ): Promise<MeasurementCanvasObject> {
    // For now, render as a line measurement
    // TODO: Implement proper angle measurement rendering
    return this.renderLineMeasurement(fabricCanvas, measurement, style, options);
  }

  /**
   * Setup measurement interaction handlers
   */
  private setupMeasurementInteraction(
    projectId: string,
    imageLabel: string,
    measurementObj: MeasurementCanvasObject
  ): void {
    // Setup drag handlers for handles
    measurementObj.handles.forEach((handle, index) => {
      handle.on('mousedown', () => {
        const canvasKey = this.getCanvasKey(projectId, imageLabel);
        const interactionState = this.interactionStates.get(canvasKey);
        if (interactionState) {
          interactionState.isEditing = true;
          interactionState.activeHandle = index === 0 ? 'start' : 'end';
        }
      });
    });

    // Setup label interaction
    if (measurementObj.label) {
      measurementObj.label.on('dblclick', () => {
        // TODO: Implement label editing
      });
    }
  }

  /**
   * Refresh all measurement rendering
   */
  private async refreshMeasurementRendering(projectId: string, imageLabel: string): Promise<void> {
    // Clear existing measurements
    const canvasKey = this.getCanvasKey(projectId, imageLabel);
    const measurementMap = this.measurementObjects.get(canvasKey);

    if (measurementMap) {
      for (const [id] of measurementMap) {
        await this.removeMeasurementFromCanvas(projectId, imageLabel, id);
      }
    }

    // Re-render all measurements
    await this.loadAndRenderMeasurements(projectId, imageLabel);
  }

  /**
   * Calculate measurement value based on type
   */
  private calculateMeasurementValue(
    type: 'line' | 'area' | 'angle',
    coordinates: MeasurementData['coordinates']
  ): number {
    switch (type) {
      case 'line':
        return this.calculateDistance(coordinates.start, coordinates.end);
      case 'area':
        // TODO: Implement area calculation
        return 0;
      case 'angle':
        // TODO: Implement angle calculation
        return 0;
      default:
        return 0;
    }
  }

  /**
   * Calculate distance between two points
   */
  private calculateDistance(point1: Position, point2: Position): number {
    const dx = point2.x - point1.x;
    const dy = point2.y - point1.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Calculate midpoint between two points
   */
  private calculateMidpoint(point1: Position, point2: Position): Position {
    return {
      x: (point1.x + point2.x) / 2,
      y: (point1.y + point2.y) / 2,
    };
  }

  /**
   * Get canvas key for internal tracking
   */
  private getCanvasKey(projectId: string, imageLabel: string): string {
    return `${projectId}:${imageLabel}`;
  }

  /**
   * Cleanup measurement rendering for a canvas
   */
  cleanup(projectId: string, imageLabel: string): void {
    const canvasKey = this.getCanvasKey(projectId, imageLabel);
    this.measurementObjects.delete(canvasKey);
    this.interactionStates.delete(canvasKey);
    this.renderOptions.delete(canvasKey);
  }

  /**
   * Get measurement statistics for a canvas
   */
  getMeasurementStats(
    projectId: string,
    imageLabel: string
  ): Result<
    {
      totalMeasurements: number;
      visibleMeasurements: number;
      selectedMeasurements: number;
      measurementTypes: Record<string, number>;
    },
    AppError
  > {
    try {
      const canvasKey = this.getCanvasKey(projectId, imageLabel);
      const measurementMap = this.measurementObjects.get(canvasKey);

      if (!measurementMap) {
        return Result.err(
          new AppError(ErrorCode.CANVAS_NOT_FOUND, 'Measurement rendering not initialized')
        );
      }

      const measurements = Array.from(measurementMap.values());
      const stats = {
        totalMeasurements: measurements.length,
        visibleMeasurements: measurements.filter(m => m.isVisible).length,
        selectedMeasurements: measurements.filter(m => m.isSelected).length,
        measurementTypes: {} as Record<string, number>,
      };

      // Count by type (would need measurement type from stored data)
      // For now, assume all are line measurements
      stats.measurementTypes['line'] = measurements.length;

      return Result.ok(stats);
    } catch (error) {
      return Result.err(
        new AppError(
          ErrorCode.CANVAS_INVALID_STATE,
          `Failed to get measurement stats: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      );
    }
  }
}

// Export service instance
export const measurementRenderingService = new MeasurementRenderingService();
