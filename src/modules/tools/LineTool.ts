// Line Tool
/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-misused-promises, @typescript-eslint/prefer-regexp-exec, @typescript-eslint/unbound-method, prefer-rest-params */
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { BaseTool } from './BaseTool.js';
import { FabricControls } from '../utils/FabricControls.js';
import { PathUtils } from '../utils/PathUtils.js';

export class LineTool extends BaseTool {
  constructor(canvasManager) {
    super(canvasManager);
    this.line = null;
    this.isDrawing = false;
    this.startX = 0;
    this.startY = 0;
    this.strokeColor = '#3b82f6'; // Default to bright blue
    this.strokeWidth = 2;
    this.dashPattern = []; // Empty = solid line

    // Snap-to-line properties
    this.snapPoint = null; // {x, y} or null
    this.snapIndicator = null; // fabric.Circle or null
    this.snapThreshold = 10; // pixels

    // Bind event handlers
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
  }

  activate() {
    super.activate();
    if (!this.canvas) {
      console.error('LineTool: Canvas not available');
      return;
    }

    // Disable group selection while drawing
    this.canvas.selection = false;

    // Enable objects for dragging (hybrid mode: drag objects, draw on empty space)
    this.canvas.forEachObject(obj => {
      obj.set('selectable', true);
      obj.set('evented', true);
    });

    this.canvas.on('mouse:down', this.onMouseDown);
    this.canvas.on('mouse:move', this.onMouseMove);
    this.canvas.on('mouse:up', this.onMouseUp);
    this.canvas.defaultCursor = 'crosshair';
    this.canvas.renderAll();
  }

  deactivate() {
    super.deactivate();

    // Remove snap indicator
    if (this.snapIndicator) {
      this.canvas.remove(this.snapIndicator);
      this.snapIndicator = null;
    }
    this.snapPoint = null;

    // Cleanup events - don't restore object states
    // (next tool will set what it needs)
    this.canvas.off('mouse:down', this.onMouseDown);
    this.canvas.off('mouse:move', this.onMouseMove);
    this.canvas.off('mouse:up', this.onMouseUp);
    this.canvas.defaultCursor = 'default';
    this.canvas.renderAll();
  }

  onMouseDown(o) {
    if (!this.isActive) return;

    const evt = o.e;

    // If clicking on existing object AND Ctrl is NOT held, let Fabric handle dragging
    // If Ctrl IS held, ignore the object and proceed to draw (with snap)
    if (o.target && !evt.ctrlKey) {
      console.log('[LineTool] Clicked on object without Ctrl - allowing selection');
      return;
    }

    if (o.target && evt.ctrlKey) {
      console.log('[LineTool] Clicked on object WITH Ctrl - ignoring selection, will draw');
    }

    // Don't start drawing if this is a pan gesture (Alt, Shift, or touch gesture)
    if (evt.altKey || evt.shiftKey || this.canvas.isGestureActive) {
      console.log('[LineTool] Ignoring mousedown - modifier key or gesture detected');
      return;
    }

    this.canvas.selection = false;
    this.isDrawing = true;

    if (window.app?.historyManager) {
      window.app.historyManager.saveState({ force: true, reason: 'line:start' });
    }

    // Use snap point if available, otherwise use mouse position
    if (this.snapPoint) {
      this.startX = this.snapPoint.x;
      this.startY = this.snapPoint.y;
      console.log(
        `[LineTool] Starting line from snap point: (${this.startX.toFixed(1)}, ${this.startY.toFixed(1)})`
      );
    } else {
      const pointer = this.canvas.getPointer(o.e);
      this.startX = pointer.x;
      this.startY = pointer.y;
    }

    // Hide snap indicator when starting to draw
    if (this.snapIndicator) {
      this.canvas.remove(this.snapIndicator);
      this.snapIndicator = null;
    }

    const points = [this.startX, this.startY, this.startX, this.startY];
    this.line = new fabric.Line(points, {
      strokeWidth: this.strokeWidth,
      stroke: this.strokeColor,
      originX: 'center',
      originY: 'center',
      strokeDashArray: this.dashPattern.length > 0 ? this.dashPattern : null,
      selectable: false,
      evented: false,
    });

    // Apply arrow settings if available
    if (window.app && window.app.arrowManager) {
      window.app.arrowManager.applyArrows(this.line);
    }

    this.canvas.add(this.line);
  }

  onMouseMove(o) {
    const evt = o.e;
    const pointer = this.canvas.getPointer(evt);

    if (!this.isDrawing) {
      // Not drawing - check for snap on hover
      if (evt.ctrlKey) {
        this.updateSnapPoint(pointer);
        // Disable object selection while Ctrl is held (including tags)
        this.canvas.forEachObject(obj => {
          if (!obj.isConnectorLine) {
            obj.set({
              selectable: false,
              hoverCursor: 'crosshair', // Keep crosshair cursor
            });
          }
        });
      } else {
        // Ctrl not held - clear snap and re-enable selection
        this.clearSnap();
        this.canvas.forEachObject(obj => {
          if (!obj.isConnectorLine) {
            obj.set({
              selectable: true,
              hoverCursor: obj.isTag ? 'move' : 'move', // Restore move cursor
            });
          }
        });
      }
      this.canvas.requestRenderAll();
      return;
    }

    // Drawing - update line endpoint with optional snap
    if (evt.ctrlKey) {
      // Snap the endpoint while drawing
      const snapPoint = this.findSnapPointForDrawing(pointer);
      if (snapPoint) {
        this.line.set({ x2: snapPoint.x, y2: snapPoint.y });
        this.showSnapIndicator(snapPoint);
      } else {
        this.line.set({ x2: pointer.x, y2: pointer.y });
        this.clearSnap();
      }
    } else {
      this.line.set({ x2: pointer.x, y2: pointer.y });
      this.clearSnap();
    }
    this.canvas.requestRenderAll();
  }

  findSnapPointForDrawing(mousePos) {
    // Find closest point on all lines within threshold (excluding the line being drawn)
    let closestPoint = null;
    let minDistance = this.snapThreshold;

    const objects = this.canvas.getObjects();
    for (const obj of objects) {
      // Skip the line being drawn
      if (obj === this.line) continue;

      // Skip non-stroke objects (tags, connector lines)
      if (obj.isTag || obj.isConnectorLine || !obj.evented) continue;

      // Skip if object doesn't have proper type
      if (!obj.type || (obj.type !== 'line' && obj.type !== 'group' && obj.type !== 'path'))
        continue;

      try {
        const point = PathUtils.getClosestStrokeEndpoint(obj, mousePos);
        const distance = PathUtils.calculateDistance(point, mousePos);

        if (distance < minDistance) {
          minDistance = distance;
          closestPoint = point;
        }
      } catch (e) {
        console.warn('[LineTool] Error finding closest point:', e);
      }
    }

    return closestPoint;
  }

  updateSnapPoint(mousePos) {
    // Find closest point on all lines within threshold
    let closestPoint = null;
    let minDistance = this.snapThreshold;

    const objects = this.canvas.getObjects();
    for (const obj of objects) {
      // Skip non-stroke objects (tags, etc.)
      if (obj.isTag || obj.isConnectorLine || !obj.evented) continue;

      // Skip if object doesn't have proper type
      if (!obj.type || (obj.type !== 'line' && obj.type !== 'group' && obj.type !== 'path'))
        continue;

      try {
        const point = PathUtils.getClosestStrokeEndpoint(obj, mousePos);
        const distance = PathUtils.calculateDistance(point, mousePos);

        if (distance < minDistance) {
          minDistance = distance;
          closestPoint = point;
        }
      } catch (e) {
        console.warn('[LineTool] Error finding closest point:', e);
      }
    }

    if (closestPoint) {
      this.snapPoint = closestPoint;
      this.showSnapIndicator(closestPoint);
    } else {
      this.clearSnap();
    }
  }

  showSnapIndicator(point) {
    if (this.snapIndicator) {
      // Update existing indicator
      this.snapIndicator.set({
        left: point.x,
        top: point.y,
      });
    } else {
      // Create new indicator with inverted colors
      this.snapIndicator = new fabric.Circle({
        left: point.x,
        top: point.y,
        radius: 5,
        fill: 'rgba(255, 255, 255, 0.8)', // White for inversion
        stroke: '#ffffff', // White stroke
        strokeWidth: 2,
        originX: 'center',
        originY: 'center',
        selectable: false,
        evented: false,
        hasControls: false,
        hasBorders: false,
        globalCompositeOperation: 'difference', // Invert colors
      });
      this.canvas.add(this.snapIndicator);
    }
    this.canvas.requestRenderAll();
  }

  clearSnap() {
    if (this.snapIndicator) {
      this.canvas.remove(this.snapIndicator);
      this.snapIndicator = null;
      this.canvas.requestRenderAll();
    }
    this.snapPoint = null;
  }

  onMouseUp(o) {
    if (!this.isDrawing) return;

    // Don't complete drawing if this is the end of a touch gesture
    if (this.canvas.isGestureActive) {
      console.log('[LineTool] Ignoring mouseup - touch gesture ending');
      this.isDrawing = false;

      // Clean up the line that was created during the gesture
      if (this.line) {
        this.canvas.remove(this.line);
        this.line = null;
      }

      this.canvas.selection = true;
      this.canvas.requestRenderAll();
      return;
    }

    this.isDrawing = false;

    // Calculate stroke length to prevent tiny accidental strokes
    const endPointer = this.canvas.getPointer(o.e);
    const deltaX = endPointer.x - this.startX;
    const deltaY = endPointer.y - this.startY;
    const strokeLength = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    const minStrokeLength = 5; // pixels

    if (strokeLength < minStrokeLength) {
      console.log(
        `[LineTool] Stroke too short (${strokeLength.toFixed(1)}px < ${minStrokeLength}px) - removing`
      );
      // Remove the line if it's too short
      this.canvas.remove(this.line);
      this.line = null;

      this.canvas.selection = true;
      this.canvas.requestRenderAll();
      return;
    }

    console.log(`[LineTool] Valid stroke created (${strokeLength.toFixed(1)}px)`);

    if (window.app && !window.app.hasDrawnFirstStroke) {
      window.app.hasDrawnFirstStroke = true;
      if (typeof performance !== 'undefined' && performance.mark) {
        performance.mark('app-first-stroke');
        if (performance.measure) {
          try {
            performance.measure('first-paint->first-stroke', 'app-first-paint', 'app-first-stroke');
            window.app?.logPerfMeasure?.('first-paint->first-stroke');
          } catch (error) {
            console.warn('[Perf] Measure first stroke failed', error);
          }
        }
      }
      window.dispatchEvent(new CustomEvent('firststroke'));
    }

    if (
      window.app &&
      !window.app.firstStrokeCommitMarked &&
      !window.app.firstStrokeCommitInProgress
    ) {
      window.app.firstStrokeCommitInProgress = true;
      if (typeof performance !== 'undefined' && performance.mark) {
        performance.mark('app-first-stroke-commit-start');
      }
    }

    // Make line selectable and interactive now that drawing is complete
    this.line.set({
      selectable: true,
      evented: true,
      perPixelTargetFind: false,
    });

    // Add custom controls
    FabricControls.createLineControls(this.line);

    this.line.setCoords();

    this.canvas.selection = true;

    this.canvas.requestRenderAll();

    // Attach metadata (label) to the line
    if (window.app && window.app.metadataManager && window.app.projectManager) {
      const imageLabel = window.app.projectManager.currentViewId || 'front';

      // Set currentImageLabel for tag prediction system
      window.currentImageLabel =
        (typeof window.getCaptureTabScopedLabel === 'function' &&
          window.getCaptureTabScopedLabel(imageLabel)) ||
        imageLabel;

      const strokeLabel = window.app.metadataManager.getNextLabel(imageLabel);
      window.app.metadataManager.attachMetadata(this.line, imageLabel, strokeLabel);
      console.log(`Line created with label: ${strokeLabel}`);

      const createdLine = this.line;
      const commitHistory = () => {
        if (window.app?.historyManager) {
          window.app.historyManager.saveState({ force: true, reason: 'line:end' });
        }
      };

      // Create tag for the stroke
      if (window.app.tagManager) {
        setTimeout(() => {
          if (createdLine) {
            window.app.tagManager.createTagForStroke(strokeLabel, imageLabel, createdLine);
          }
          commitHistory();
        }, 50);
      } else {
        commitHistory();
      }
    } else if (window.app?.historyManager) {
      window.app.historyManager.saveState({ force: true, reason: 'line:end' });
    }

    if (window.app && window.app.firstStrokeCommitInProgress) {
      if (typeof performance !== 'undefined' && performance.mark) {
        performance.mark('app-first-stroke-commit-end');
        if (performance.measure) {
          try {
            performance.measure(
              'first-stroke-commit',
              'app-first-stroke-commit-start',
              'app-first-stroke-commit-end'
            );
            window.app?.logPerfMeasure?.('first-stroke-commit');
          } catch (error) {
            console.warn('[Perf] Measure first stroke commit failed', error);
          }
        }
      }
      window.app.firstStrokeCommitMarked = true;
      window.app.firstStrokeCommitInProgress = false;
    }
  }

  setColor(color) {
    this.strokeColor = color;
  }

  setWidth(width) {
    this.strokeWidth = parseInt(width, 10);
  }

  setDashPattern(pattern) {
    this.dashPattern = pattern || [];
    // Update existing line if drawing
    if (this.line && this.isDrawing) {
      this.line.set('strokeDashArray', this.dashPattern.length > 0 ? this.dashPattern : null);
      this.canvas.requestRenderAll();
    }
  }
}
