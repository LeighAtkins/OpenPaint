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

    // Snap properties
    this.snapPoint = null;
    this.snapThreshold = 10;
    this.snapIndicator = null;

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
      obj.set('hoverCursor', 'crosshair'); // Keep crosshair cursor to avoid distraction
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

    const rawPointer = this.canvas.getPointer(o.e);

    // Check for snap if Ctrl is held
    let pointer = rawPointer;
    if (evt.ctrlKey) {
      const snapPoint = this.findSnapPointForDrawing(rawPointer);
      if (snapPoint) {
        pointer = snapPoint;
        console.log('[CurveTool] Snapped point added:', pointer);
      }
    }

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
    // Allow running if not drawing (for start snap) or if drawing
    if (!this.isActive) return;

    const rawPointer = this.canvas.getPointer(o.e);
    let pointer = rawPointer;

    // Check for snap if Ctrl is held
    if (o.e.ctrlKey) {
      const snapPoint = this.findSnapPointForDrawing(rawPointer);
      if (snapPoint) {
        pointer = snapPoint;
        this.showSnapIndicator(snapPoint);
      } else {
        this.hideSnapIndicator();
      }
    } else {
      this.hideSnapIndicator();
    }

    // If not drawing yet, we're done (just showed snap indicator)
    if (!this.isDrawing || this.points.length === 0) return;

    // Update preview with current mouse position as temporary point
    if (this.points.length >= 1) {
      this.updatePreview(pointer);
    }
  }

  findSnapPointForDrawing(mousePos) {
    // Find closest point on all lines within threshold
    let closestPoint = null;
    let minDistance = this.snapThreshold;

    const objects = this.canvas.getObjects();
    for (const obj of objects) {
      // Skip non-stroke objects
      if (obj.isTag || obj.isConnectorLine || !obj.evented) continue;

      // Skip if object doesn't have proper type
      if (!obj.type || (obj.type !== 'line' && obj.type !== 'group' && obj.type !== 'path'))
        continue;

      // Skip the preview path itself
      if (obj === this.previewPath) continue;

      try {
        const point = PathUtils.getClosestStrokeEndpoint(obj, mousePos);
        const distance = PathUtils.calculateDistance(point, mousePos);

        if (distance < minDistance) {
          minDistance = distance;
          closestPoint = point;
        }
      } catch (e) {
        console.warn('[CurveTool] Error finding closest point:', e);
      }
    }

    return closestPoint;
  }

  showSnapIndicator(point) {
    if (this.snapIndicator) {
      this.snapIndicator.set({ left: point.x, top: point.y });
    } else {
      this.snapIndicator = new fabric.Circle({
        left: point.x,
        top: point.y,
        radius: 5,
        fill: 'rgba(255, 255, 255, 0.8)',
        stroke: '#ffffff',
        strokeWidth: 2,
        originX: 'center',
        originY: 'center',
        selectable: false,
        evented: false,
        hasControls: false,
        hasBorders: false,
        globalCompositeOperation: 'difference',
      });
      this.canvas.add(this.snapIndicator);
    }
    this.canvas.requestRenderAll();
  }

  hideSnapIndicator() {
    if (this.snapIndicator) {
      this.canvas.remove(this.snapIndicator);
      this.snapIndicator = null;
      this.canvas.requestRenderAll();
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
    this.hideSnapIndicator();

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

    // Create final curve path - let Fabric handle positioning
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

    // Add to canvas
    this.canvas.add(curve);
    curve.setCoords();

    // Store points on the object for editing (absolute canvas coordinates)
    curve.customPoints = this.points.map(point => ({ x: point.x, y: point.y }));
    curve.customPointsSpace = 'canvas';
    PathUtils.updatePathFromAbsolutePoints(curve, curve.customPoints);

    // Initialize tracking for movement
    curve.lastLeft = curve.left;
    curve.lastTop = curve.top;

    // Add listener to update customPoints when curve is moved
    curve.on('moving', () => {
      if (curve.isEditingControlPoint) {
        return;
      }

      const dx = curve.left - curve.lastLeft;
      const dy = curve.top - curve.lastTop;

      if (dx !== 0 || dy !== 0) {
        curve.customPoints.forEach(p => {
          p.x += dx;
          p.y += dy;
        });

        curve.lastLeft = curve.left;
        curve.lastTop = curve.top;
      }
    });

    // Add custom controls for point editing
    FabricControls.createCurveControls(curve);

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
