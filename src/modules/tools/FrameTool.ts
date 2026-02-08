/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-misused-promises, @typescript-eslint/prefer-regexp-exec, @typescript-eslint/unbound-method, prefer-rest-params */
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { BaseTool } from './BaseTool.js';

// Frame Tool for drawing PDF export frames (marquee rectangles)
// Each frame defines a zoomed-in portion of the image that becomes a separate PDF page

export class FrameTool extends BaseTool {
  constructor(canvasManager) {
    super(canvasManager);
    this.isDrawing = false;
    this.startX = 0;
    this.startY = 0;
    this.currentRect = null;
    this.frameColor = '#2196F3'; // Blue color for frames
    this.frameStrokeWidth = 2;
    this.frameDashPattern = [8, 4];

    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
  }

  activate() {
    super.activate();
    if (!this.canvas) {
      console.error('FrameTool: Canvas not available');
      return;
    }

    // Initialize global frame storage if needed
    if (!window.pdfFramesByImage) {
      window.pdfFramesByImage = {};
    }

    this.canvas.selection = false;
    this.canvas.on('mouse:down', this.onMouseDown);
    this.canvas.on('mouse:move', this.onMouseMove);
    this.canvas.on('mouse:up', this.onMouseUp);
    this.canvas.defaultCursor = 'crosshair';
    this.canvas.renderAll();

    // Render existing frames for current image
    this.renderFrames();
  }

  deactivate() {
    super.deactivate();
    if (!this.canvas) return;

    this.canvas.off('mouse:down', this.onMouseDown);
    this.canvas.off('mouse:move', this.onMouseMove);
    this.canvas.off('mouse:up', this.onMouseUp);
    this.canvas.defaultCursor = 'default';

    // Remove frame preview objects but keep the frame data
    this.removeFrameObjects();
    this.canvas.renderAll();
  }

  onMouseDown(o) {
    if (!this.isActive) return;

    const evt = o.e;

    // Don't start drawing if clicking on an existing object
    if (o.target && o.target.isFrameObject) {
      return;
    }

    // Skip if modifier keys are held (for panning)
    if (evt.altKey || evt.shiftKey || this.canvas.isGestureActive) {
      return;
    }

    const pointer = this.canvas.getPointer(evt);
    this.startX = pointer.x;
    this.startY = pointer.y;
    this.isDrawing = true;

    // Create the rectangle preview
    this.currentRect = new fabric.Rect({
      left: this.startX,
      top: this.startY,
      width: 0,
      height: 0,
      fill: 'rgba(33, 150, 243, 0.1)',
      stroke: this.frameColor,
      strokeWidth: this.frameStrokeWidth,
      strokeDashArray: this.frameDashPattern,
      selectable: false,
      evented: false,
      isFramePreview: true,
    });

    this.canvas.add(this.currentRect);
  }

  onMouseMove(o) {
    if (!this.isActive || !this.isDrawing || !this.currentRect) return;

    const pointer = this.canvas.getPointer(o.e);

    const left = Math.min(this.startX, pointer.x);
    const top = Math.min(this.startY, pointer.y);
    const width = Math.abs(pointer.x - this.startX);
    const height = Math.abs(pointer.y - this.startY);

    this.currentRect.set({
      left: left,
      top: top,
      width: width,
      height: height,
    });

    this.canvas.requestRenderAll();
  }

  onMouseUp(o) {
    if (!this.isActive || !this.isDrawing) return;

    this.isDrawing = false;

    if (!this.currentRect) return;

    const width = this.currentRect.width;
    const height = this.currentRect.height;

    // Minimum size check (at least 50x50 pixels)
    if (width < 50 || height < 50) {
      this.canvas.remove(this.currentRect);
      this.currentRect = null;
      return;
    }

    // Get current image label
    const imageLabel =
      window.app?.projectManager?.currentViewId || window.currentImageLabel || 'front';

    // Initialize frames array for this image if needed
    if (!window.pdfFramesByImage[imageLabel]) {
      window.pdfFramesByImage[imageLabel] = [];
    }

    const frames = window.pdfFramesByImage[imageLabel];

    // Create frame data
    const frame = {
      id: `frame-${Date.now()}`,
      bounds: {
        x: this.currentRect.left,
        y: this.currentRect.top,
        width: width,
        height: height,
      },
      order: frames.length,
      name: `Frame ${frames.length + 1}`,
    };

    // Add to frames array
    frames.push(frame);

    // Remove preview rect and render all frames
    this.canvas.remove(this.currentRect);
    this.currentRect = null;

    // Re-render all frames to include the new one
    this.renderFrames();

    console.log(`[FrameTool] Created frame: ${frame.name} for ${imageLabel}`, frame.bounds);

    // Dispatch event for UI updates
    window.dispatchEvent(
      new CustomEvent('frameCreated', {
        detail: { frame, imageLabel },
      })
    );
  }

  // Render all frames for the current image
  renderFrames() {
    // First remove existing frame objects
    this.removeFrameObjects();

    const imageLabel =
      window.app?.projectManager?.currentViewId || window.currentImageLabel || 'front';
    const frames = window.pdfFramesByImage?.[imageLabel] || [];

    frames.forEach((frame, index) => {
      this.renderFrame(frame, index);
    });

    this.canvas.requestRenderAll();
  }

  // Render a single frame on the canvas
  renderFrame(frame, index) {
    const group = new fabric.Group([], {
      left: frame.bounds.x,
      top: frame.bounds.y,
      selectable: true,
      evented: true,
      isFrameObject: true,
      frameId: frame.id,
      hasControls: true,
      hasBorders: true,
      lockRotation: true,
      cornerColor: this.frameColor,
      cornerStyle: 'circle',
      transparentCorners: false,
    });

    // Frame rectangle
    const rect = new fabric.Rect({
      left: 0,
      top: 0,
      width: frame.bounds.width,
      height: frame.bounds.height,
      fill: 'rgba(33, 150, 243, 0.08)',
      stroke: this.frameColor,
      strokeWidth: this.frameStrokeWidth,
      strokeDashArray: this.frameDashPattern,
    });

    // Frame number badge
    const badgeSize = 24;
    const badge = new fabric.Circle({
      left: frame.bounds.width - badgeSize - 4,
      top: 4,
      radius: badgeSize / 2,
      fill: this.frameColor,
      stroke: '#ffffff',
      strokeWidth: 2,
    });

    // Frame number text
    const numberText = new fabric.Text(String(index + 1), {
      left: frame.bounds.width - badgeSize / 2 - 4,
      top: 4 + badgeSize / 2,
      fontSize: 14,
      fontWeight: 'bold',
      fill: '#ffffff',
      originX: 'center',
      originY: 'center',
    });

    // Frame name label
    const nameLabel = new fabric.Text(frame.name || `Frame ${index + 1}`, {
      left: 8,
      top: 8,
      fontSize: 12,
      fontWeight: 'bold',
      fill: this.frameColor,
      backgroundColor: 'rgba(255, 255, 255, 0.85)',
      padding: 4,
    });

    group.addWithUpdate(rect);
    group.addWithUpdate(badge);
    group.addWithUpdate(numberText);
    group.addWithUpdate(nameLabel);

    // Handle frame updates when moved/resized
    group.on('modified', () => {
      this.updateFrameBounds(frame.id, group);
    });

    this.canvas.add(group);
  }

  // Update frame bounds after moving/resizing
  updateFrameBounds(frameId, group) {
    const imageLabel =
      window.app?.projectManager?.currentViewId || window.currentImageLabel || 'front';
    const frames = window.pdfFramesByImage?.[imageLabel] || [];

    const frame = frames.find(f => f.id === frameId);
    if (frame) {
      frame.bounds = {
        x: group.left,
        y: group.top,
        width: group.width * group.scaleX,
        height: group.height * group.scaleY,
      };
      console.log(`[FrameTool] Updated frame bounds: ${frame.name}`, frame.bounds);

      // Dispatch event for UI updates
      window.dispatchEvent(
        new CustomEvent('frameUpdated', {
          detail: { frame, imageLabel },
        })
      );
    }
  }

  // Remove all frame objects from canvas
  removeFrameObjects() {
    if (!this.canvas) return;

    const objectsToRemove = this.canvas
      .getObjects()
      .filter(obj => obj.isFrameObject || obj.isFramePreview);

    objectsToRemove.forEach(obj => {
      this.canvas.remove(obj);
    });
  }

  // Delete a specific frame by ID
  deleteFrame(frameId) {
    const imageLabel =
      window.app?.projectManager?.currentViewId || window.currentImageLabel || 'front';
    const frames = window.pdfFramesByImage?.[imageLabel];

    if (!frames) return;

    const index = frames.findIndex(f => f.id === frameId);
    if (index !== -1) {
      frames.splice(index, 1);

      // Re-order remaining frames
      frames.forEach((f, i) => {
        f.order = i;
        if (!f.name || f.name.startsWith('Frame ')) {
          f.name = `Frame ${i + 1}`;
        }
      });

      // Re-render
      this.renderFrames();

      console.log(`[FrameTool] Deleted frame: ${frameId}`);

      // Dispatch event for UI updates
      window.dispatchEvent(
        new CustomEvent('frameDeleted', {
          detail: { frameId, imageLabel },
        })
      );
    }
  }

  // Get all frames for an image
  static getFramesForImage(imageLabel) {
    return window.pdfFramesByImage?.[imageLabel] || [];
  }

  // Clear all frames for an image
  static clearFramesForImage(imageLabel) {
    if (window.pdfFramesByImage) {
      window.pdfFramesByImage[imageLabel] = [];
    }
  }

  // Get all frames across all images
  static getAllFrames() {
    return window.pdfFramesByImage || {};
  }
}
