/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-misused-promises, @typescript-eslint/prefer-regexp-exec, @typescript-eslint/unbound-method, prefer-rest-params */
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { BaseTool } from './BaseTool.js';

const MIN_SHAPE_SIZE = 10;
const STAR_BASE_SIZE = 100;

export class ShapeTool extends BaseTool {
  constructor(canvasManager) {
    super(canvasManager);
    this.shapeType = 'square';
    this.shape = null;
    this.isDrawing = false;
    this.hasMoved = false;
    this.startX = 0;
    this.startY = 0;
    this.strokeColor = '#3b82f6';
    this.strokeWidth = 2;
    this.dashPattern = [];
    this.fillStyle = 'no-fill';

    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
  }

  activate() {
    super.activate();
    if (!this.canvas) {
      console.error('ShapeTool: Canvas not available');
      return;
    }

    this.canvas.selection = false;
    this.canvas.on('mouse:down', this.onMouseDown);
    this.canvas.on('mouse:move', this.onMouseMove);
    this.canvas.on('mouse:up', this.onMouseUp);
    this.canvas.defaultCursor = 'crosshair';
    this.canvas.renderAll();
  }

  deactivate() {
    super.deactivate();
    if (!this.canvas) return;

    this.canvas.off('mouse:down', this.onMouseDown);
    this.canvas.off('mouse:move', this.onMouseMove);
    this.canvas.off('mouse:up', this.onMouseUp);
    this.canvas.defaultCursor = 'default';
    this.canvas.renderAll();
  }

  setShapeType(shapeType) {
    this.shapeType = shapeType;
  }

  setColor(color) {
    this.strokeColor = color;
    this.fillStyle = 'no-fill';
  }

  setWidth(width) {
    this.strokeWidth = parseInt(width, 10);
  }

  setDashPattern(pattern) {
    this.dashPattern = pattern || [];
    if (this.shape && this.isDrawing) {
      this.shape.set('strokeDashArray', this.dashPattern.length > 0 ? this.dashPattern : null);
      this.canvas.requestRenderAll();
    }
  }

  setFillStyle(style) {
    this.fillStyle = style || 'no-fill';
  }

  getFillStyle() {
    return this.fillStyle || 'solid';
  }

  onMouseDown(o) {
    if (!this.isActive) return;

    const evt = o.e;
    if (o.target) return;

    if (evt.altKey || evt.shiftKey || this.canvas.isGestureActive) {
      return;
    }

    const pointer = this.canvas.getPointer(evt);
    this.startX = pointer.x;
    this.startY = pointer.y;
    this.isDrawing = true;
    this.hasMoved = false;

    if (window.app?.historyManager) {
      window.app.historyManager.saveState({ force: true, reason: 'shape:start' });
    }
  }

  onMouseMove(o) {
    if (!this.isActive || !this.isDrawing) return;

    const pointer = this.canvas.getPointer(o.e);

    if (!this.shape) {
      const dx = pointer.x - this.startX;
      const dy = pointer.y - this.startY;
      if (Math.hypot(dx, dy) < 2) {
        return;
      }

      const styles = this.getShapeStyles();
      this.shape = this.createShape(styles);
      if (!this.shape) return;

      this.shape.set({
        selectable: false,
        evented: false,
        strokeDashArray: this.dashPattern.length > 0 ? this.dashPattern : null,
      });

      this.canvas.add(this.shape);
    }

    this.hasMoved = true;
    this.updateShape(pointer.x, pointer.y);
    this.canvas.requestRenderAll();
  }

  onMouseUp(o) {
    if (!this.isActive || !this.isDrawing) return;

    const pointer = this.canvas.getPointer(o.e);

    this.isDrawing = false;

    if (!this.shape || !this.hasMoved) {
      this.shape = null;
      return;
    }

    const { width, height } = this.getShapeSize(pointer.x, pointer.y);
    const size = Math.min(width, height);
    const isRectangle = this.shapeType === 'square';
    const tooSmall = isRectangle ? Math.max(width, height) < MIN_SHAPE_SIZE : size < MIN_SHAPE_SIZE;

    if (tooSmall) {
      this.canvas.remove(this.shape);
      this.shape = null;
      return;
    }

    this.shape.set({
      selectable: true,
      evented: true,
      perPixelTargetFind: true,
    });

    this.shape.setCoords();
    this.canvas.selection = false;
    this.canvas.requestRenderAll();

    this.attachMetadata(this.shape);

    if (window.app?.historyManager) {
      window.app.historyManager.saveState({ force: true, reason: 'shape:end' });
    }

    this.shape = null;

    // Return to previous tool after drawing one shape
    this.returnToPreviousTool();
  }

  returnToPreviousTool() {
    if (!window.app || !window.app.toolManager) return;

    const toolManager = window.app.toolManager;
    const previousTool = toolManager.previousToolName || 'line';

    // Map tool names to toggle labels
    const toolLabels = {
      line: 'Straight Line',
      curve: 'Curved Line',
      select: 'Select',
    };

    // Switch to previous tool
    toolManager.selectTool(previousTool);

    // Update toggle label
    const drawingModeToggle = document.getElementById('drawingModeToggle');
    if (drawingModeToggle && window.app.updateToggleLabel) {
      const label = toolLabels[previousTool] || 'Straight Line';
      window.app.updateToggleLabel(drawingModeToggle, label);
    }

    // Clear previous tool reference
    toolManager.previousToolName = null;
  }

  getShapeStyles() {
    return this.getStyleForFillStyle(this.getFillStyle(), this.strokeColor);
  }

  getStyleForFillStyle(fillStyle, baseColor = this.strokeColor) {
    if (fillStyle === 'no-fill') {
      return { fill: 'rgba(0,0,0,0.01)', stroke: baseColor };
    }

    if (fillStyle === 'clear-black') {
      return { fill: 'rgba(0,0,0,0)', stroke: '#111827' };
    }

    if (fillStyle === 'clear-white') {
      return { fill: 'rgba(0,0,0,0)', stroke: '#ffffff' };
    }

    if (fillStyle === 'clear-color') {
      return { fill: 'rgba(0,0,0,0)', stroke: baseColor };
    }

    return { fill: baseColor, stroke: baseColor };
  }

  createShape(styles) {
    const options = {
      left: this.startX,
      top: this.startY,
      fill: styles.fill,
      stroke: styles.stroke,
      strokeWidth: this.strokeWidth,
      originX: 'left',
      originY: 'top',
    };

    switch (this.shapeType) {
      case 'triangle':
        return new fabric.Triangle({ ...options, width: 1, height: 1 });
      case 'circle':
        return new fabric.Circle({
          ...options,
          radius: 1,
        });
      case 'star': {
        const star = new fabric.Polygon(this.buildStarPoints(), {
          ...options,
          originX: 'center',
          originY: 'center',
        });
        star.left = this.startX;
        star.top = this.startY;
        return star;
      }
      case 'square':
      default:
        return new fabric.Rect({ ...options, width: 1, height: 1 });
    }
  }

  updateShape(currentX, currentY) {
    const { left, top, size, centerX, centerY, rectLeft, rectTop, rectWidth, rectHeight } =
      this.getShapeSize(currentX, currentY);

    if (this.shapeType === 'circle') {
      this.shape.set({
        left,
        top,
        radius: size / 2,
      });
      return;
    }

    if (this.shapeType === 'triangle') {
      this.shape.set({
        left,
        top,
        width: size,
        height: size,
      });
      return;
    }

    if (this.shapeType === 'star') {
      const scale = size / STAR_BASE_SIZE;
      this.shape.set({
        left: centerX,
        top: centerY,
        scaleX: scale || 0.01,
        scaleY: scale || 0.01,
      });
      return;
    }

    this.shape.set({
      left: rectLeft,
      top: rectTop,
      width: rectWidth,
      height: rectHeight,
    });
  }

  getShapeSize(currentX, currentY) {
    const dx = currentX - this.startX;
    const dy = currentY - this.startY;
    const width = Math.abs(dx);
    const height = Math.abs(dy);
    const rectWidth = Math.max(1, width);
    const rectHeight = Math.max(1, height);
    const rectLeft = dx < 0 ? this.startX - rectWidth : this.startX;
    const rectTop = dy < 0 ? this.startY - rectHeight : this.startY;
    const size = Math.max(MIN_SHAPE_SIZE, Math.min(width, height));

    const left = dx < 0 ? this.startX - size : this.startX;
    const top = dy < 0 ? this.startY - size : this.startY;
    const centerX = this.startX + dx / 2;
    const centerY = this.startY + dy / 2;

    return {
      width,
      height,
      size,
      left,
      top,
      centerX,
      centerY,
      rectWidth,
      rectHeight,
      rectLeft,
      rectTop,
    };
  }

  buildStarPoints() {
    const outerRadius = STAR_BASE_SIZE / 2;
    const innerRadius = outerRadius * 0.5;
    const points = [];

    for (let i = 0; i < 10; i += 1) {
      const angle = (Math.PI / 5) * i - Math.PI / 2;
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      points.push({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      });
    }

    return points;
  }

  attachMetadata(shape) {
    if (window.app && window.app.metadataManager && window.app.projectManager) {
      const imageLabel = window.app.projectManager.currentViewId || 'front';
      window.currentImageLabel =
        (typeof window.getCaptureTabScopedLabel === 'function' &&
          window.getCaptureTabScopedLabel(imageLabel)) ||
        imageLabel;

      window.app.metadataManager.attachShapeMetadata(shape, imageLabel, this.shapeType);
    }
  }
}
