// Line Tool
/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-misused-promises, @typescript-eslint/prefer-regexp-exec, @typescript-eslint/unbound-method, prefer-rest-params */
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { BaseTool } from './BaseTool.js';
import { FabricControls } from '../utils/FabricControls.js';
import { PathUtils } from '../utils/PathUtils.js';
import { addAutoMeasurementConnections } from '../utils/measurement-connections.js';
import { resolveDrawingImageLabel } from '../ui/scoped-image-label.js';

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
    this.lineStyle = 'solid';
    this.tapeTickSpacing = 1;

    // Snap-to-line properties
    this.snapPoint = null; // {x, y} or null
    this.snapTarget = null; // { imageLabel, strokeLabel } or null
    this.snapIndicator = null; // fabric.Circle or null
    this.snapThreshold = 10; // pixels
    this.startSnapTarget = null;
    this.endSnapTarget = null;
    this.bendState = null;

    // Bind event handlers
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
  }

  isSnapModifier(evt) {
    return Boolean(evt?.ctrlKey || evt?.metaKey);
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

    this.cancelLineBend();

    // Remove snap indicator
    if (this.snapIndicator) {
      this.canvas.remove(this.snapIndicator);
      this.snapIndicator = null;
    }
    this.snapPoint = null;
    this.snapTarget = null;
    this.startSnapTarget = null;
    this.endSnapTarget = null;

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
    if ((window as any).canStartCwQueuedDrawing?.() === false) {
      evt.preventDefault?.();
      evt.stopPropagation?.();
      return;
    }

    const isSnapHeld = this.isSnapModifier(evt);
    const bendTarget = o.target?.isTag ? o.target.connectedStroke : o.target;

    // Option on macOS / Alt elsewhere turns an existing straight measurement
    // into an editable three-anchor curve. This takes precedence over canvas
    // panning only when the pointer is directly over a real measurement line.
    if (
      evt.altKey &&
      bendTarget?.type === 'line' &&
      bendTarget?.strokeMetadata?.strokeLabel &&
      !bendTarget.isConnectorLine
    ) {
      evt.preventDefault?.();
      evt.stopPropagation?.();
      this.startLineBend(bendTarget, this.canvas.getPointer(evt), o.target);
      return;
    }

    // If clicking on existing object AND snap modifier is NOT held, let Fabric handle dragging.
    // If snap modifier IS held, ignore the object and proceed to draw with snap.
    if (o.target && !isSnapHeld) {
      console.log('[LineTool] Clicked on object without snap modifier - allowing selection');
      return;
    }

    if (o.target && isSnapHeld) {
      evt.preventDefault?.();
      console.log(
        '[LineTool] Clicked on object WITH snap modifier - ignoring selection, will draw'
      );
    }

    // Don't start drawing if this is a pan gesture (Alt, Shift, or touch gesture)
    if (evt.altKey || evt.shiftKey || this.canvas.isGestureActive) {
      console.log('[LineTool] Ignoring mousedown - modifier key or gesture detected');
      return;
    }

    this.canvas.selection = false;
    this.isDrawing = true;
    this.startSnapTarget = null;
    this.endSnapTarget = null;

    if (window.app?.historyManager) {
      window.app.historyManager.saveState({ force: true, reason: 'line:start' });
    }

    // Use snap point if available, otherwise use mouse position
    if (this.snapPoint) {
      this.startX = this.snapPoint.x;
      this.startY = this.snapPoint.y;
      this.startSnapTarget = this.snapTarget;
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

    const isZipper = this.lineStyle === 'zipper';
    const imageLabel = isZipper
      ? resolveDrawingImageLabel(
          this.canvasManager,
          window.app?.projectManager?.currentViewId || 'front'
        )
      : undefined;
    const points = [this.startX, this.startY, this.startX, this.startY];
    this.line = new fabric.Line(points, {
      strokeWidth: this.strokeWidth,
      stroke: this.strokeColor,
      originX: 'center',
      originY: 'center',
      strokeDashArray:
        this.lineStyle === 'tape' || this.lineStyle === 'stretchy' || this.lineStyle === 'zipper'
          ? null
          : this.dashPattern.length > 0
            ? this.dashPattern
            : null,
      lineStyle: this.lineStyle,
      selectable: false,
      evented: false,
      isZipper,
      customType: isZipper ? 'zipper' : undefined,
      imageLabel,
    });

    // Apply arrow settings if available
    if (window.app && window.app.arrowManager) {
      window.app.arrowManager.applyArrows(this.line);
      if (this.line.arrowSettings) {
        this.line.arrowSettings.lineStyle = this.lineStyle;
        this.line.arrowSettings.tapeTickSpacing = this.tapeTickSpacing;
      }
    }

    this.canvas.add(this.line);
  }

  onMouseMove(o) {
    const evt = o.e;
    const pointer = this.canvas.getPointer(evt);
    const isSnapHeld = this.isSnapModifier(evt);

    if (this.bendState) {
      evt.preventDefault?.();
      this.updateLineBend(pointer);
      return;
    }

    if (!this.isDrawing) {
      // Not drawing - check for snap on hover
      if (isSnapHeld) {
        evt.preventDefault?.();
        this.updateSnapPoint(pointer);
        // Disable object selection while snap modifier is held (including tags)
        this.canvas.forEachObject(obj => {
          if (!obj.isConnectorLine) {
            obj.set({
              selectable: false,
              hoverCursor: 'crosshair', // Keep crosshair cursor
            });
          }
        });
      } else {
        // Snap modifier not held - clear snap and re-enable selection
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
    if (isSnapHeld) {
      evt.preventDefault?.();
      // Snap the endpoint while drawing
      const snapResult = this.findSnapPointForDrawing(pointer);
      if (snapResult) {
        this.line.set({ x2: snapResult.point.x, y2: snapResult.point.y });
        this.endSnapTarget = snapResult.target;
        this.showSnapIndicator(snapResult.point);
      } else {
        this.line.set({ x2: pointer.x, y2: pointer.y });
        this.endSnapTarget = null;
        this.clearSnap();
      }
    } else {
      this.line.set({ x2: pointer.x, y2: pointer.y });
      this.endSnapTarget = null;
      this.clearSnap();
    }
    this.canvas.requestRenderAll();
  }

  findSnapPointForDrawing(mousePos) {
    // Find closest point on all lines within threshold (excluding the line being drawn)
    let closestPoint = null;
    let closestTarget = null;
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
          const snapMeta = obj.strokeMetadata;
          if (snapMeta?.strokeLabel) {
            closestTarget = {
              imageLabel: snapMeta.imageLabel,
              strokeLabel: snapMeta.strokeLabel,
            };
          } else {
            closestTarget = null;
          }
        }
      } catch (e) {
        console.warn('[LineTool] Error finding closest point:', e);
      }
    }

    if (!closestPoint) return null;
    return { point: closestPoint, target: closestTarget };
  }

  updateSnapPoint(mousePos) {
    // Find closest point on all lines within threshold
    let closestPoint = null;
    let closestTarget = null;
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
          const snapMeta = obj.strokeMetadata;
          if (snapMeta?.strokeLabel) {
            closestTarget = {
              imageLabel: snapMeta.imageLabel,
              strokeLabel: snapMeta.strokeLabel,
            };
          } else {
            closestTarget = null;
          }
        }
      } catch (e) {
        console.warn('[LineTool] Error finding closest point:', e);
      }
    }

    if (closestPoint) {
      this.snapPoint = closestPoint;
      this.snapTarget = closestTarget;
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
    this.snapTarget = null;
  }

  onMouseUp(o) {
    if (this.bendState) {
      this.finishLineBend(this.canvas.getPointer(o.e));
      return;
    }

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
      perPixelTargetFind: true,
      padding: this.lineStyle === 'zipper' ? 18 : 8,
      objectCaching: false,
    });

    // Add custom controls
    FabricControls.createLineControls(this.line);

    this.line.setCoords();

    this.canvas.selection = true;

    this.canvas.requestRenderAll();

    // Zippers are visual annotations. They use the line geometry and history
    // pipeline, but intentionally do not consume a measurement label or tag.
    if (this.lineStyle === 'zipper') {
      this.line.set({
        isZipper: true,
        customType: 'zipper',
        imageLabel:
          this.line.imageLabel ||
          resolveDrawingImageLabel(
            this.canvasManager,
            window.app?.projectManager?.currentViewId || 'front'
          ),
      });
      window.app?.historyManager?.saveState?.({ force: true, reason: 'zipper:end' });
    } else if (window.app && window.app.metadataManager && window.app.projectManager) {
      const imageLabel = resolveDrawingImageLabel(
        this.canvasManager,
        window.app.projectManager.currentViewId || 'front'
      );
      window.currentImageLabel = imageLabel;

      const strokeLabel = window.app.metadataManager.getNextLabel(imageLabel);
      window.app.metadataManager.attachMetadata(this.line, imageLabel, strokeLabel);
      console.log(`Line created with label: ${strokeLabel}`);

      addAutoMeasurementConnections(
        { imageLabel, strokeLabel },
        [this.startSnapTarget, this.endSnapTarget].filter(Boolean)
      );

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

  getLineWorldEndpoints(line) {
    const managed = window.app?.arrowManager?.getLineWorldEndpoints?.(line);
    if (managed) {
      return {
        start: { x: managed.x1, y: managed.y1 },
        end: { x: managed.x2, y: managed.y2 },
      };
    }
    if (!line?.calcLinePoints || !fabric?.util?.transformPoint) return null;
    const points = line.calcLinePoints();
    const matrix = line.calcTransformMatrix();
    const start = fabric.util.transformPoint(new fabric.Point(points.x1, points.y1), matrix);
    const end = fabric.util.transformPoint(new fabric.Point(points.x2, points.y2), matrix);
    return { start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y } };
  }

  cloneSerializable(value) {
    if (!value) return value;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_error) {
      return { ...value };
    }
  }

  createBentPath(line, points) {
    const curve = new fabric.Path(PathUtils.createSmoothPath(points), {
      stroke: line.stroke,
      strokeWidth: line.strokeWidth,
      strokeUniform: line.strokeUniform,
      fill: 'transparent',
      opacity: line.opacity,
      strokeDashArray: Array.isArray(line.strokeDashArray) ? [...line.strokeDashArray] : null,
      strokeDashOffset: line.strokeDashOffset,
      strokeLineCap: line.strokeLineCap,
      strokeLineJoin: line.strokeLineJoin,
      lineStyle: line.lineStyle,
      selectable: false,
      evented: false,
      perPixelTargetFind: true,
      padding: 8,
      objectCaching: false,
      excludeFromExport: true,
    });
    curve.customPoints = points.map(point => ({ x: point.x, y: point.y }));
    curve.dashSettings = this.cloneSerializable(line.dashSettings);
    curve.arrowSettings = this.cloneSerializable(line.arrowSettings);
    FabricControls.canonicalizeCurveFromWorldPoints(curve);

    const arrowManager = window.app?.arrowManager;
    if (arrowManager) {
      if (!curve.arrowSettings) arrowManager.applyArrows?.(curve);
      if (line.arrowSettings) {
        curve.arrowSettings = this.cloneSerializable(line.arrowSettings);
        curve.arrowSettings.curveArrows = true;
        delete curve.arrowSettings.baseLine;
        delete curve.arrowSettings.basePath;
        delete curve.arrowSettings.basePathOffset;
        curve.arrowSettings.baselineCaptured = false;
      }
      arrowManager.attachArrowRendering?.(curve);
      arrowManager.captureBaselineGeometry?.(curve);
      arrowManager.syncArrowMetadata?.(curve);
    }
    return curve;
  }

  startLineBend(line, pointer, gestureTarget = line) {
    if (this.bendState || !line?.canvas) return;
    const endpoints = this.getLineWorldEndpoints(line);
    if (!endpoints) return;

    window.app?.historyManager?.saveState?.({ force: true, reason: 'line:bend-start' });
    // Fabric resolves and starts its normal object transform before emitting
    // mouse:down. Cancel it so dragging from a tag or the line cannot also move
    // that object while the bend gesture is active.
    this.canvas._currentTransform = null;
    this.canvas.discardActiveObject();
    const originalState = {
      visible: line.visible !== false,
      selectable: line.selectable !== false,
      evented: line.evented !== false,
    };
    const gestureTargetState =
      gestureTarget && gestureTarget !== line
        ? {
            selectable: gestureTarget.selectable !== false,
            evented: gestureTarget.evented !== false,
          }
        : null;
    if (gestureTargetState) {
      gestureTarget.set({ selectable: false, evented: false });
    }
    line.set({ visible: false, selectable: false, evented: false });

    const points = [endpoints.start, { x: pointer.x, y: pointer.y }, endpoints.end];
    const curve = this.createBentPath(line, points);
    this.canvas.add(curve);
    this.bendState = {
      line,
      curve,
      endpoints,
      originalState,
      gestureTarget,
      gestureTargetState,
    };
    this.canvas.selection = false;
    this.canvas.defaultCursor = 'crosshair';
    this.canvas.requestRenderAll();
  }

  updateLineBend(pointer) {
    const state = this.bendState;
    if (!state) return;
    state.curve.customPoints = [
      { ...state.endpoints.start },
      { x: pointer.x, y: pointer.y },
      { ...state.endpoints.end },
    ];
    FabricControls.canonicalizeCurveFromWorldPoints(state.curve);
    state.curve.dirty = true;
    this.canvas.requestRenderAll();
  }

  finishLineBend(pointer) {
    const state = this.bendState;
    if (!state) return;
    this.updateLineBend(pointer);

    const { line, curve, endpoints, originalState, gestureTarget, gestureTargetState } = state;
    const midpoint = {
      x: (endpoints.start.x + endpoints.end.x) / 2,
      y: (endpoints.start.y + endpoints.end.y) / 2,
    };
    const bendDistance = PathUtils.calculateDistance(curve.customPoints[1], midpoint);
    this.bendState = null;
    this.canvas.selection = true;
    if (gestureTargetState && gestureTarget) gestureTarget.set(gestureTargetState);

    if (bendDistance < 3) {
      this.canvas.remove(curve);
      line.set(originalState);
      this.canvas.requestRenderAll();
      return;
    }

    const metadata = { ...(line.strokeMetadata || {}) };
    const imageLabel = metadata.imageLabel;
    const strokeLabel = metadata.strokeLabel;
    curve.strokeMetadata = metadata;
    curve.set({
      visible: originalState.visible,
      selectable: originalState.selectable,
      evented: originalState.evented,
      excludeFromExport: false,
      hasControls: false,
      hasBorders: false,
    });
    curve.__lastCenter = curve.getCenterPoint();
    FabricControls.createCurveControls(curve);

    const metadataManager = window.app?.metadataManager;
    if (imageLabel && strokeLabel && metadataManager) {
      metadataManager.vectorStrokesByImage[imageLabel] ||= {};
      metadataManager.vectorStrokesByImage[imageLabel][strokeLabel] = curve;
    }

    const tagManager = window.app?.tagManager;
    if (imageLabel && strokeLabel && tagManager) {
      const foundTag = tagManager.getTagObject?.(strokeLabel, imageLabel);
      if (foundTag?.tagObj) {
        foundTag.tagObj.connectedStroke = curve;
        tagManager.updateConnector?.(strokeLabel, imageLabel);
      } else {
        tagManager.createTag(strokeLabel, imageLabel, curve);
      }
    }

    // The global object:removed handler normally treats removal as deletion and
    // removes the matching tag. This is a geometry replacement, not deletion,
    // so detach the old object's metadata before removing it. The canonical
    // metadata and tag now point at the curve above.
    line.strokeMetadata = null;
    this.canvas.remove(line);
    this.canvas.discardActiveObject();
    curve.setCoords();
    metadataManager?.updateStrokeVisibilityControls?.();
    this.canvas.requestRenderAll();
    window.app?.historyManager?.saveState?.({ force: true, reason: 'line:bend-end' });
  }

  cancelLineBend() {
    const state = this.bendState;
    if (!state) return;
    this.canvas?.remove?.(state.curve);
    state.line?.set?.(state.originalState);
    if (state.gestureTargetState && state.gestureTarget) {
      state.gestureTarget.set(state.gestureTargetState);
    }
    this.bendState = null;
    if (this.canvas) {
      this.canvas.selection = true;
      this.canvas.requestRenderAll();
    }
  }

  setWidth(width) {
    this.strokeWidth = parseInt(width, 10);
  }

  setDashPattern(pattern) {
    this.dashPattern = pattern || [];
    // Update existing line if drawing
    if (this.line && this.isDrawing) {
      this.line.set(
        'strokeDashArray',
        this.lineStyle === 'tape' || this.lineStyle === 'stretchy' || this.lineStyle === 'zipper'
          ? null
          : this.dashPattern.length > 0
            ? this.dashPattern
            : null
      );
      this.canvas.requestRenderAll();
    }
  }

  setLineStyle(style) {
    this.lineStyle =
      style === 'tape' || style === 'stretchy' || style === 'zipper' ? style : 'solid';
    if (this.line && this.isDrawing) {
      this.line.lineStyle = this.lineStyle;
      this.line.dashSettings = {
        ...(this.line.dashSettings || {}),
        style,
      };
      this.line.arrowSettings = this.line.arrowSettings || {};
      this.line.arrowSettings.lineStyle = this.lineStyle;
      this.line.arrowSettings.tapeTickSpacing = this.tapeTickSpacing;
      this.line.set(
        'strokeDashArray',
        this.lineStyle === 'tape' || this.lineStyle === 'stretchy' || this.lineStyle === 'zipper'
          ? null
          : this.dashPattern.length > 0
            ? this.dashPattern
            : null
      );
      this.line.dirty = true;
      this.canvas.requestRenderAll();
    }
  }

  setTapeTickSpacing(spacing) {
    const numeric = Number(spacing);
    this.tapeTickSpacing = Number.isFinite(numeric) ? Math.max(0.55, Math.min(2.25, numeric)) : 1;
    if (this.line && this.isDrawing) {
      this.line.arrowSettings = this.line.arrowSettings || {};
      this.line.arrowSettings.tapeTickSpacing = this.tapeTickSpacing;
      this.line.dirty = true;
      this.canvas.requestRenderAll();
    }
  }
}
