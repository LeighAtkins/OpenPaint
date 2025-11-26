// Curve Tool (Point-based curved line)
import { BaseTool } from './BaseTool.js';
import { PathUtils } from '../utils/PathUtils.js';
import { FabricControls } from '../utils/FabricControls.js';

export class CurveTool extends BaseTool {
  constructor(canvasManager) {
    super(canvasManager);
    this.points = [];
    this.previewPath = null;
    this.pointMarkers = []; // Visual markers for clicked points
    this.strokeColor = '#3b82f6'; // Default to bright blue
    this.strokeWidth = 2;
    this.isDrawing = false;
    this.dashPattern = []; // Dash pattern for curves

    // Bind event handlers
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onDoubleClick = this.onDoubleClick.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
  }

  activate() {
    super.activate();
    if (!this.canvas) {
      console.error('CurveTool: Canvas not available');
      return;
    }

    // Disable group selection while drawing
    this.canvas.selection = false;

    // Enable objects for dragging (hybrid mode: drag objects, draw on empty space)
    this.canvas.forEachObject(obj => {
      obj.set('selectable', true);
      obj.set('evented', true);
    });

    this.canvas.defaultCursor = 'crosshair';
    this.canvas.on('mouse:down', this.onMouseDown);
    this.canvas.on('mouse:move', this.onMouseMove);
    this.canvas.on('mouse:dblclick', this.onDoubleClick);

    // Listen for ESC key to cancel
    document.addEventListener('keydown', this.onKeyDown);

    console.log(`CurveTool activated: color=${this.strokeColor}, width=${this.strokeWidth}`);
  }

  deactivate() {
    super.deactivate();
    this.cancelDrawing();

    // Cleanup events - don't restore object states
    // (next tool will set what it needs)
    this.canvas.defaultCursor = 'default';
    this.canvas.off('mouse:down', this.onMouseDown);
    this.canvas.off('mouse:move', this.onMouseMove);
    this.canvas.off('mouse:dblclick', this.onDoubleClick);
    document.removeEventListener('keydown', this.onKeyDown);
  }

  onMouseDown(o) {
    if (!this.isActive) return;

    // If clicking on existing object, let Fabric handle dragging
    if (o.target) {
      return;
    }

    // Don't start drawing if this is a pan gesture (Alt, Shift, or touch gesture)
    const evt = o.e;
    if (evt.altKey || evt.shiftKey || this.canvas.isGestureActive) {
      console.log('[CurveTool] Ignoring mousedown - modifier key or gesture detected');
      return;
    }

    const pointer = this.canvas.getPointer(o.e);
    this.points.push({ x: pointer.x, y: pointer.y });

    // Add visual marker for the point
    const marker = new fabric.Circle({
      left: pointer.x,
      top: pointer.y,
      radius: 3,
      fill: this.strokeColor,
      originX: 'center',
      originY: 'center',
      selectable: false,
      evented: false,
      hasControls: false,
      hasBorders: false,
    });
    this.canvas.add(marker);
    this.pointMarkers.push(marker);

    this.isDrawing = true;

    // If we have at least 2 points, create/update the curve preview
    if (this.points.length >= 2) {
      this.updatePreview();
    }

    this.canvas.renderAll();
  }

  onMouseMove(o) {
    if (!this.isDrawing || this.points.length === 0) return;

    const pointer = this.canvas.getPointer(o.e);

    // Update preview with current mouse position as temporary point
    if (this.points.length >= 1) {
      this.updatePreview(pointer);
    }
  }

  onDoubleClick(o) {
    if (!this.isActive) return;
    this.completeCurve();
  }

  onKeyDown(e) {
    if (!this.isActive) return;

    // ESC cancels current drawing
    if (e.key === 'Escape') {
      this.cancelDrawing();
    }
    // Enter completes the curve
    else if (e.key === 'Enter' && this.points.length >= 2) {
      this.completeCurve();
    }
  }

  updatePreview(tempPoint = null) {
    // Remove old preview
    if (this.previewPath) {
      this.canvas.remove(this.previewPath);
      this.previewPath = null;
    }

    if (this.points.length < 1) return; // Need at least 1 point to show something (if tempPoint exists)

    let allPoints = [...this.points];

    if (tempPoint) {
      // Check distance to last point to avoid "hook" effect in preview
      const last = this.points[this.points.length - 1];
      const dist = Math.sqrt(Math.pow(tempPoint.x - last.x, 2) + Math.pow(tempPoint.y - last.y, 2));

      if (dist > 5) {
        allPoints.push(tempPoint);
      }
    }

    if (allPoints.length < 2) return;

    // Create path string for smooth curve through points
    const pathString = PathUtils.createSmoothPath(allPoints);

    // Create preview path
    this.previewPath = new fabric.Path(pathString, {
      stroke: this.strokeColor,
      strokeWidth: this.strokeWidth,
      fill: '',
      strokeDashArray: this.dashPattern.length > 0 ? this.dashPattern : null,
      selectable: false,
      evented: false,
      hasControls: false,
      hasBorders: false,
      opacity: tempPoint ? 0.6 : 1.0, // Dimmer if temporary
    });

    if (window.app && window.app.arrowManager) {
      window.app.arrowManager.applyArrows(this.previewPath);
    }

    this.canvas.add(this.previewPath);
    this.canvas.renderAll();
  }

  completeCurve() {
    // Check for double-click artifact (last point very close to previous point)
    if (this.points.length >= 2) {
      const last = this.points[this.points.length - 1];
      const prev = this.points[this.points.length - 2];
      const dist = Math.sqrt(Math.pow(last.x - prev.x, 2) + Math.pow(last.y - prev.y, 2));

      // If points are very close (likely double-click), remove the last one
      if (dist < 5) {
        console.log('[CurveTool] Removed duplicate point from double-click');
        this.points.pop();

        // Remove the marker for this point
        const marker = this.pointMarkers.pop();
        if (marker) {
          this.canvas.remove(marker);
        }
      }
    }

    if (this.points.length < 2) {
      this.cancelDrawing();
      return;
    }

    // Calculate curve length to prevent tiny accidental curves
    let totalLength = 0;
    for (let i = 1; i < this.points.length; i++) {
      const dx = this.points[i].x - this.points[i - 1].x;
      const dy = this.points[i].y - this.points[i - 1].y;
      totalLength += Math.sqrt(dx * dx + dy * dy);
    }

    const minStrokeLength = 10; // pixels (larger for curves)
    if (totalLength < minStrokeLength) {
      console.log(
        `[CurveTool] Curve too short (${totalLength.toFixed(1)}px < ${minStrokeLength}px) - cancelling`
      );
      this.cancelDrawing();
      return;
    }

    console.log(`[CurveTool] Valid curve created (${totalLength.toFixed(1)}px)`);

    // Remove preview and markers
    if (this.previewPath) {
      this.canvas.remove(this.previewPath);
      this.previewPath = null;
    }
    this.pointMarkers.forEach(marker => this.canvas.remove(marker));
    this.pointMarkers = [];

    // Create final curve path
    const pathString = PathUtils.createSmoothPath(this.points);
    const curve = new fabric.Path(pathString, {
      stroke: this.strokeColor,
      strokeWidth: this.strokeWidth,
      fill: 'transparent',
      strokeDashArray: this.dashPattern.length > 0 ? this.dashPattern : null,
      selectable: true,
      evented: true,
      perPixelTargetFind: true, // Only select when clicking the actual line
    });

    // Store points on the object for editing
    curve.customPoints = this.points.map(p => ({ x: p.x, y: p.y }));

    // Initialize tracking for movement
    curve.lastLeft = curve.left;
    curve.lastTop = curve.top;

    // Add listener to update customPoints when curve is moved
    curve.on('moving', () => {
      // Skip if we're editing a control point - the control point handler updates customPoints directly
      if (curve.isEditingControlPoint) {
        console.log('[CurveMoveDebug] Skipping move update - editing control point');
        return;
      }

      const dx = curve.left - curve.lastLeft;
      const dy = curve.top - curve.lastTop;

      if (dx !== 0 || dy !== 0) {
        console.log(
          `[CurveMoveDebug] Moving whole curve by dx=${dx.toFixed(1)}, dy=${dy.toFixed(1)}`
        );

        // Update all custom points
        curve.customPoints.forEach(p => {
          p.x += dx;
          p.y += dy;
        });

        // Update tracking
        curve.lastLeft = curve.left;
        curve.lastTop = curve.top;
      }
    });

    // Add custom controls for point editing
    FabricControls.createCurveControls(curve);

    // Add to canvas
    this.canvas.add(curve);

    // Add arrowheads if enabled
    if (window.app && window.app.arrowManager) {
      window.app.arrowManager.applyArrows(curve);
    }

    // Add metadata for labeling
    if (window.app && window.app.metadataManager) {
      // Get current view ID - must match what StrokeMetadataManager uses for consistency
      const imageLabel =
        window.app.projectManager?.currentViewId || window.currentImageLabel || 'front';
      const strokeLabel = window.app.metadataManager.getNextLabel(imageLabel);

      console.log(`[CurveTool] Attaching metadata: label=${strokeLabel}, image=${imageLabel}`);
      window.app.metadataManager.attachMetadata(curve, imageLabel, strokeLabel);

      // Create tag
      if (window.app.tagManager) {
        try {
          console.log(`[CurveTool] Creating tag for ${strokeLabel}`);
          window.app.tagManager.createTag(strokeLabel, imageLabel, curve);

          // Focus measurement input after tag is created
          setTimeout(() => {
            if (window.app.metadataManager?.focusMeasurementInput) {
              window.app.metadataManager.focusMeasurementInput(strokeLabel);
            }
          }, 50);
        } catch (e) {
          console.error('[CurveTool] Error creating tag:', e);
        }
      }
    } else {
      console.warn('[CurveTool] No app or metadataManager available!');
    }

    this.canvas.renderAll();

    // Reset
    this.points = [];
    this.isDrawing = false;
    this.canvas.selection = true; // Re-enable selection

    // Fire object:added event
    console.log('[CurveTool] Firing object:added event');
    this.canvas.fire('object:added', { target: curve });
  }

  cancelDrawing() {
    // Clean up preview and markers
    if (this.previewPath) {
      this.canvas.remove(this.previewPath);
      this.previewPath = null;
    }
    this.pointMarkers.forEach(marker => this.canvas.remove(marker));
    this.pointMarkers = [];

    // Reset state
    this.points = [];
    this.isDrawing = false;
    this.canvas.selection = true;
    this.canvas.renderAll();
  }

  setColor(color) {
    this.strokeColor = color;
  }

  setWidth(width) {
    this.strokeWidth = parseInt(width, 10);
  }

  setDashPattern(pattern) {
    // Update dash pattern for curves
    // Note: Curves use Path objects, dash patterns are applied via strokeDashArray
    this.dashPattern = pattern || [];
    // Update preview if drawing
    if (this.previewPath && this.points.length >= 2) {
      this.previewPath.set(
        'strokeDashArray',
        this.dashPattern.length > 0 ? this.dashPattern : null
      );
      this.canvas.renderAll();
    }
  }
}
