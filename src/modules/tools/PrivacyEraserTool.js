import { BaseTool } from './BaseTool.js';

export class PrivacyEraserTool extends BaseTool {
  constructor(canvasManager) {
    super(canvasManager);
    this.brushWidth = 28;
    this.isDrawing = false;
    this.wheelSizes = [2, 4, 6, 8, 10, 15, 20, 28, 36, 44, 52];
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

    event.__privacyBrushHandled = true;
    event.preventDefault();
    event.stopPropagation();

    const brushSelect = document.getElementById('brushSize');
    const optionValues = Array.from(brushSelect?.options || [])
      .map(option => parseInt(option.value, 10))
      .filter(value => Number.isFinite(value));
    const sizes = optionValues.length > 0 ? optionValues : this.wheelSizes;
    const current = this.brushWidth;
    const direction = event.deltaY > 0 ? -1 : 1;

    let index = sizes.findIndex(size => size >= current);
    if (index < 0) index = sizes.length - 1;
    if (direction > 0) {
      index = Math.min(sizes.length - 1, index + 1);
    } else {
      index = Math.max(0, index - 1);
    }

    const nextSize = sizes[index];
    this.setWidth(nextSize);

    if (brushSelect) {
      brushSelect.value = String(nextSize);
      brushSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  updateCursorPreview() {
    if (!this.canvas) return;
    const diameter = Math.max(6, Math.min(80, Math.round(this.brushWidth)));
    const radius = Math.round(diameter / 2);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${diameter}" height="${diameter}"><circle cx="${radius}" cy="${radius}" r="${Math.max(1, radius - 1)}" fill="rgba(239,68,68,0.12)" stroke="rgba(239,68,68,0.95)" stroke-width="2"/></svg>`;
    const encoded = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    this.canvas.freeDrawingCursor = `url("${encoded}") ${radius} ${radius}, crosshair`;
  }

  setColor() {
    // Privacy eraser ignores color by design.
  }
}
