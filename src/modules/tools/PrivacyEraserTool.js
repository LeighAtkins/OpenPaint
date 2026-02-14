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
    this.canvas.freeDrawingBrush.color = 'rgba(255,255,255,0.95)';
    this.updateCursorPreview(false);

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
    if (this.canvas?.freeDrawingBrush) {
      this.canvas.freeDrawingBrush.color = 'rgba(255,255,255,0.25)';
    }
    this.updateCursorPreview(true);
    if (window.app?.historyManager) {
      window.app.historyManager.saveState({ force: true, reason: 'privacy-erase:start' });
    }
  }

  onMouseUp() {
    if (!this.canvas.isDrawingMode && this.isActive) {
      this.canvas.isDrawingMode = true;
    }
    this.isDrawing = false;
    if (this.canvas?.freeDrawingBrush) {
      this.canvas.freeDrawingBrush.color = 'rgba(255,255,255,0.95)';
    }
    this.updateCursorPreview(false);
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
      lockMovementX: true,
      lockMovementY: true,
      isPrivacyErase: true,
      customData: {
        ...(path.customData || {}),
        isPrivacyErase: true,
      },
    });

    // Keep privacy erase strokes behind vector strokes so only background is erased.
    this.canvas.sendToBack(path);

    if (window.app?.historyManager) {
      window.app.historyManager.saveState({ force: true, reason: 'privacy-erase:end' });
    }
  }

  setWidth(width) {
    this.brushWidth = parseInt(width, 10);
    if (this.isActive && this.canvas?.freeDrawingBrush) {
      this.canvas.freeDrawingBrush.width = this.brushWidth;
      this.updateCursorPreview(this.isDrawing);
    }
  }

  updateCursorPreview(isActiveDraw = false) {
    if (!this.canvas) return;
    const diameter = Math.max(6, Math.min(220, Math.round(this.brushWidth)));
    const radius = Math.round(diameter / 2);
    const arm = Math.max(4, Math.floor(radius * 0.2));
    const fill = isActiveDraw ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.82)';
    const stroke = isActiveDraw ? 'rgba(255,255,255,0.68)' : 'rgba(255,255,255,0.96)';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${diameter}" height="${diameter}"><circle cx="${radius}" cy="${radius}" r="${Math.max(1, radius - 1)}" fill="${fill}" stroke="${stroke}" stroke-width="2"/><line x1="${radius - arm}" y1="${radius}" x2="${radius + arm}" y2="${radius}" stroke="${stroke}" stroke-width="1.5"/><line x1="${radius}" y1="${radius - arm}" x2="${radius}" y2="${radius + arm}" stroke="${stroke}" stroke-width="1.5"/></svg>`;
    const encoded = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    this.canvas.freeDrawingCursor = `url("${encoded}") ${radius} ${radius}, crosshair`;
  }

  setColor() {
    // Privacy eraser ignores color by design.
  }
}
