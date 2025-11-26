// Arrow Tool
import { BaseTool } from './BaseTool.js';
import { FabricControls } from '../utils/FabricControls.js';

export class ArrowTool extends BaseTool {
  constructor(canvasManager) {
    super(canvasManager);
    this.isDrawing = false;
    this.line = null;
    this.head = null;
    this.strokeColor = '#3b82f6'; // Default to bright blue
    this.strokeWidth = 2;
    this.startX = 0;
    this.startY = 0;
    this.dashPattern = []; // Dash pattern for arrows

    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
  }

  activate() {
    super.activate();
    if (!this.canvas) {
      console.error('ArrowTool: Canvas not available');
      return;
    }
    // Keep selection enabled so objects can be dragged
    // We'll prevent drawing when clicking on objects in onMouseDown
    this.canvas.selection = true;
    this.canvas.on('mouse:down', this.onMouseDown);
    this.canvas.on('mouse:move', this.onMouseMove);
    this.canvas.on('mouse:up', this.onMouseUp);
    this.canvas.defaultCursor = 'crosshair';
  }

  deactivate() {
    super.deactivate();
    this.canvas.selection = true;
    this.canvas.off('mouse:down', this.onMouseDown);
    this.canvas.off('mouse:move', this.onMouseMove);
    this.canvas.off('mouse:up', this.onMouseUp);
    this.canvas.defaultCursor = 'default';
  }

  onMouseDown(o) {
    if (!this.isActive) return;

    // Don't start drawing if this is a pan gesture (Alt, Shift, or touch gesture)
    const evt = o.e;
    if (evt.altKey || evt.shiftKey || this.canvas.isGestureActive) {
      console.log('[ArrowTool] Ignoring mousedown - pan gesture detected');
      return;
    }

    // Don't start drawing if clicking on an existing object (allow dragging/moving)
    // Exception: label text objects (evented: false) should allow drawing through
    if (o.target && o.target.evented !== false) {
      return;
    }

    // Temporarily disable selection to prevent new arrow from being selected during drawing
    this.canvas.selection = false;

    this.isDrawing = true;
    const pointer = this.canvas.getPointer(o.e);
    this.startX = pointer.x;
    this.startY = pointer.y;

    // Create line
    this.line = new fabric.Line([this.startX, this.startY, this.startX, this.startY], {
      stroke: this.strokeColor,
      strokeWidth: this.strokeWidth,
      originX: 'center',
      originY: 'center',
      strokeDashArray: this.dashPattern.length > 0 ? this.dashPattern : null,
      hasControls: false,
      hasBorders: false,
      selectable: false, // Not selectable during drawing
      evented: false, // Not interactive during drawing
    });

    // Create arrow head
    this.head = new fabric.Triangle({
      fill: this.strokeColor,
      width: this.strokeWidth * 3,
      height: this.strokeWidth * 3,
      originX: 'center',
      originY: 'center',
      hasControls: false,
      hasBorders: false,
      selectable: false, // Not selectable during drawing
      evented: false, // Not interactive during drawing
      top: this.startY,
      left: this.startX,
    });

    this.canvas.add(this.line, this.head);
  }

  onMouseMove(o) {
    if (!this.isDrawing) return;
    const pointer = this.canvas.getPointer(o.e);

    this.line.set({ x2: pointer.x, y2: pointer.y });

    this.head.set({ top: pointer.y, left: pointer.x });

    // Calculate angle
    const dx = pointer.x - this.startX;
    const dy = pointer.y - this.startY;
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    this.head.set({ angle: angle });

    this.canvas.requestRenderAll();
  }

  onMouseUp(o) {
    if (!this.isDrawing) return;

    // Don't complete drawing if this is the end of a touch gesture
    if (this.canvas.isGestureActive) {
      console.log('[ArrowTool] Ignoring mouseup - touch gesture ending');
      this.isDrawing = false;

      // Clean up the arrow parts that were created during the gesture
      if (this.line) {
        this.canvas.remove(this.line);
        this.line = null;
      }
      if (this.head) {
        this.canvas.remove(this.head);
        this.head = null;
      }

      // Re-enable selection
      this.canvas.selection = true;
      this.canvas.requestRenderAll();
      return;
    }

    this.isDrawing = false;

    // Calculate arrow length to prevent tiny accidental arrows
    const endPointer = this.canvas.getPointer(o.e);
    const deltaX = endPointer.x - this.startX;
    const deltaY = endPointer.y - this.startY;
    const arrowLength = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    const minStrokeLength = 5; // pixels

    if (arrowLength < minStrokeLength) {
      console.log(
        `[ArrowTool] Arrow too short (${arrowLength.toFixed(1)}px < ${minStrokeLength}px) - removing`
      );
      // Remove the arrow if it's too short
      this.canvas.remove(this.line, this.head);
      this.line = null;
      this.head = null;

      // Re-enable selection for the canvas
      this.canvas.selection = true;
      this.canvas.requestRenderAll();
      return;
    }

    console.log(`[ArrowTool] Valid arrow created (${arrowLength.toFixed(1)}px)`);

    // Group them together for easier selection/moving
    const group = new fabric.Group([this.line, this.head], {
      originX: 'center',
      originY: 'center',
      selectable: true, // Make selectable for moving/deleting
      evented: true,
    });

    this.canvas.remove(this.line, this.head);
    this.canvas.add(group);

    // Add custom controls
    FabricControls.createArrowControls(group);

    group.setCoords();

    // Re-enable selection for the canvas
    this.canvas.selection = true;

    // Attach metadata (label) to the arrow
    if (window.app && window.app.metadataManager && window.app.projectManager) {
      const imageLabel = window.app.projectManager.currentViewId || 'front';

      // Set currentImageLabel for tag prediction system
      window.currentImageLabel = imageLabel;

      const strokeLabel = window.app.metadataManager.getNextLabel(imageLabel);
      window.app.metadataManager.attachMetadata(group, imageLabel, strokeLabel);
      console.log(`Arrow created with label: ${strokeLabel}`);

      // Create tag for the arrow
      if (window.app.tagManager) {
        setTimeout(() => {
          window.app.tagManager.createTagForStroke(strokeLabel, imageLabel, group);
        }, 50);
      }
    }

    this.canvas.requestRenderAll();

    // Save state after drawing completes
    if (window.app && window.app.historyManager) {
      window.app.historyManager.saveState();
    }
  }

  setColor(color) {
    this.strokeColor = color;
  }

  setWidth(width) {
    this.strokeWidth = parseInt(width, 10);
  }

  setDashPattern(pattern) {
    // Update dash pattern for arrows
    this.dashPattern = pattern || [];
    // Update line if drawing
    if (this.line && this.isDrawing) {
      this.line.set('strokeDashArray', this.dashPattern.length > 0 ? this.dashPattern : null);
      this.canvas.requestRenderAll();
    }
  }
}
