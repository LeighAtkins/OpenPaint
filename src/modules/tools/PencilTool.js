// Pencil Tool (Freehand)
import { BaseTool } from './BaseTool.js';

export class PencilTool extends BaseTool {
  constructor(canvasManager) {
    super(canvasManager);
    this.brushColor = '#3b82f6'; // Default to bright blue
    this.brushWidth = 2;
  }

  activate() {
    super.activate();
    if (!this.canvas) {
      console.error('PencilTool: Canvas not available');
      return;
    }
    // Disable selection when drawing
    this.canvas.selection = false;
    this.canvas.isDrawingMode = true;
    this.canvas.freeDrawingBrush = new fabric.PencilBrush(this.canvas);
    this.canvas.freeDrawingBrush.color = this.brushColor;
    this.canvas.freeDrawingBrush.width = this.brushWidth;

    // Add path creation handler to filter out tiny strokes and pan gestures
    this.onPathCreated = this.onPathCreated.bind(this);
    this.canvas.on('path:created', this.onPathCreated);

    // Add mouse event handlers to detect pan gestures
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
    this.canvas.on('mouse:down', this.onMouseDown);
    this.canvas.on('mouse:up', this.onMouseUp);

    console.log(`PencilTool activated: color=${this.brushColor}, width=${this.brushWidth}`);
  }

  deactivate() {
    super.deactivate();
    if (this.canvas) {
      this.canvas.isDrawingMode = false;
      // Remove event handlers
      this.canvas.off('path:created', this.onPathCreated);
      this.canvas.off('mouse:down', this.onMouseDown);
      this.canvas.off('mouse:up', this.onMouseUp);
      // Re-enable selection when leaving drawing mode
      this.canvas.selection = true;
    }
  }

  onPathCreated(e) {
    const path = e.path;
    if (!path) return;

    // Calculate path length to determine if it should be kept
    const pathLength = this.calculatePathLength(path);
    const minStrokeLength = 10; // pixels (slightly larger for freehand)

    if (pathLength < minStrokeLength) {
      console.log(
        `[PencilTool] Stroke too short (${pathLength.toFixed(1)}px < ${minStrokeLength}px) - removing`
      );
      this.canvas.remove(path);
      return;
    }

    console.log(`[PencilTool] Valid freehand stroke created (${pathLength.toFixed(1)}px)`);
  }

  onMouseDown(o) {
    // Check for pan gestures and temporarily disable drawing mode
    const evt = o.e;
    if (evt.altKey || evt.shiftKey || this.canvas.isGestureActive) {
      console.log('[PencilTool] Pan gesture detected - temporarily disabling drawing mode');
      this.canvas.isDrawingMode = false;
    }
  }

  onMouseUp(o) {
    // Re-enable drawing mode after potential pan gesture
    const evt = o.e;
    if (!this.canvas.isDrawingMode && this.isActive) {
      console.log('[PencilTool] Re-enabling drawing mode');
      this.canvas.isDrawingMode = true;
    }
  }

  calculatePathLength(path) {
    // Approximate path length using bounding box diagonal
    // This is a simple approximation - for more accuracy, we'd need to sum all path segments
    const boundingRect = path.getBoundingRect();
    const diagonal = Math.sqrt(
      boundingRect.width * boundingRect.width + boundingRect.height * boundingRect.height
    );
    return diagonal;
  }

  setColor(color) {
    this.brushColor = color;
    if (this.isActive && this.canvas.freeDrawingBrush) {
      this.canvas.freeDrawingBrush.color = color;
    }
  }

  setWidth(width) {
    this.brushWidth = parseInt(width, 10);
    if (this.isActive && this.canvas.freeDrawingBrush) {
      this.canvas.freeDrawingBrush.width = this.brushWidth;
    }
  }
}
