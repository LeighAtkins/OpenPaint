import { BaseTool } from './BaseTool.js';

export class PrivacyEraserTool extends BaseTool {
  constructor(canvasManager) {
    super(canvasManager);
    this.brushWidth = 28;
    this.isDrawing = false;
    this.onMouseWheelDom = this.onMouseWheelDom.bind(this);
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
    this.updateCursorPreview();

    this.onPathCreated = this.onPathCreated.bind(this);
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);

    this.canvas.on('path:created', this.onPathCreated);
    this.canvas.on('mouse:down', this.onMouseDown);
    this.canvas.on('mouse:up', this.onMouseUp);

    const upperCanvasEl = this.canvas.upperCanvasEl;
    if (upperCanvasEl) {
      upperCanvasEl.addEventListener('wheel', this.onMouseWheelDom, { passive: false });
    }
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

    const upperCanvasEl = this.canvas.upperCanvasEl;
    if (upperCanvasEl) {
      upperCanvasEl.removeEventListener('wheel', this.onMouseWheelDom);
    }
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
      this.updateCursorPreview();
    }
  }

  onMouseWheelDom(event) {
    if (!this.isActive || window.app?.toolManager?.activeToolName !== 'privacy') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    // Only Ctrl + wheel adjusts privacy brush size.
    if (!event.ctrlKey) {
      return;
    }

    event.__privacyBrushHandled = true;

    const brushInput = document.getElementById('brushSize');
    const min = Math.max(1, parseInt(brushInput?.min || '1', 10) || 1);
    const max = Math.max(min, parseInt(brushInput?.max || '300', 10) || 300);
    const step = Math.max(1, parseInt(brushInput?.step || '1', 10) || 1);
    const direction = event.deltaY < 0 ? 1 : -1;
    const nextSize = Math.max(min, Math.min(max, this.brushWidth + direction * step));

    if (nextSize === this.brushWidth) {
      return;
    }

    this.setWidth(nextSize);

    if (brushInput) {
      brushInput.value = String(nextSize);
      brushInput.dispatchEvent(new Event('input', { bubbles: true }));
      brushInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  updateCursorPreview() {
    if (!this.canvas) return;
    const diameter = Math.max(6, Math.min(220, Math.round(this.brushWidth)));
    const radius = Math.round(diameter / 2);
    const arm = Math.max(4, Math.floor(radius * 0.2));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${diameter}" height="${diameter}"><circle cx="${radius}" cy="${radius}" r="${Math.max(1, radius - 1)}" fill="none" stroke="rgba(255,255,255,0.95)" stroke-width="2"/><line x1="${radius - arm}" y1="${radius}" x2="${radius + arm}" y2="${radius}" stroke="rgba(255,255,255,0.9)" stroke-width="1.5"/><line x1="${radius}" y1="${radius - arm}" x2="${radius}" y2="${radius + arm}" stroke="rgba(255,255,255,0.9)" stroke-width="1.5"/></svg>`;
    const encoded = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    this.canvas.freeDrawingCursor = `url("${encoded}") ${radius} ${radius}, crosshair`;
  }

  setColor() {
    // Privacy eraser ignores color by design.
  }
}
