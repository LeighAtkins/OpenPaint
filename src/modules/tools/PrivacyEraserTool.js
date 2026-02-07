import { BaseTool } from './BaseTool.js';

export class PrivacyEraserTool extends BaseTool {
  constructor(canvasManager) {
    super(canvasManager);
    this.brushWidth = 28;
    this.isDrawing = false;
  }

  activate() {
    super.activate();
    if (!this.canvas) {
      return;
    }

    this.canvas.selection = false;
    this.canvas.isDrawingMode = true;
    this.canvas.freeDrawingBrush = new fabric.PencilBrush(this.canvas);
    this.canvas.freeDrawingBrush.width = this.brushWidth;
    this.canvas.freeDrawingBrush.color = '#000000';

    this.onPathCreated = this.onPathCreated.bind(this);
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);

    this.canvas.on('path:created', this.onPathCreated);
    this.canvas.on('mouse:down', this.onMouseDown);
    this.canvas.on('mouse:up', this.onMouseUp);
  }

  deactivate() {
    super.deactivate();
    if (!this.canvas) {
      return;
    }

    this.canvas.isDrawingMode = false;
    this.canvas.selection = true;
    this.canvas.off('path:created', this.onPathCreated);
    this.canvas.off('mouse:down', this.onMouseDown);
    this.canvas.off('mouse:up', this.onMouseUp);
  }

  onMouseDown(event) {
    const evt = event.e;
    if (evt.altKey || evt.shiftKey || this.canvas.isGestureActive) {
      this.canvas.isDrawingMode = false;
      this.isDrawing = false;
      return;
    }

    this.isDrawing = true;
    if (window.app?.historyManager) {
      window.app.historyManager.saveState({ force: true, reason: 'privacy-erase:start' });
    }
  }

  onMouseUp() {
    if (!this.canvas.isDrawingMode && this.isActive) {
      this.canvas.isDrawingMode = true;
    }
    this.isDrawing = false;
  }

  onPathCreated(event) {
    const path = event.path;
    if (!path) {
      return;
    }

    path.set({
      globalCompositeOperation: 'destination-out',
      selectable: false,
      evented: false,
      hasControls: false,
      hasBorders: false,
      customData: {
        ...(path.customData || {}),
        isPrivacyErase: true,
      },
    });

    if (window.app?.historyManager) {
      window.app.historyManager.saveState({ force: true, reason: 'privacy-erase:end' });
    }
  }

  setWidth(width) {
    this.brushWidth = parseInt(width, 10);
    if (this.isActive && this.canvas?.freeDrawingBrush) {
      this.canvas.freeDrawingBrush.width = this.brushWidth;
    }
  }

  setColor() {
    // Privacy eraser ignores color by design.
  }
}
