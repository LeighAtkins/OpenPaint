// Canvas Manager
// Handles Fabric.js canvas initialization, resizing, zoom/pan

import { FabricControls } from './utils/FabricControls.js';
import { PathUtils } from './utils/PathUtils.js';

export class CanvasManager {
  constructor(canvasId) {
    this.canvasId = canvasId;
    this.fabricCanvas = null;

    // Resize state
    this.pendingResizeFrame = null;
    this.pendingResizeWidth = null;
    this.pendingResizeHeight = null;
    this.lastCanvasSize = { width: 0, height: 0 };

    // Resize overlay for smooth transitions
    this.resizeOverlayCanvas = null;
    this.resizeOverlayCleanupId = null;

    // Store capture frame in image-relative coordinates to prevent drift
    // These are ratios (0-1) of the background image dimensions
    this.captureFrameImageRatios = null;

    // Debounce stroke scaling to prevent glitches from rapid resizes
    this.strokeScalingTimeout = null;
    this.pendingStrokeScale = null;
    this.lastResizeTime = null;
    this.consecutiveResizeCount = 0;
    this.isResizing = false;
    this.originalCanvasSize = { width: 0, height: 0 };
    this.originalObjectStates = new Map();
    this.resizeTimeout = null;

    // Viewport transform state
    this.rotationDegrees = 0;
    this.zoomLevel = 1;
    this.panX = 0;
    this.panY = 0;
    this.rotateViewport = false;
    this.__activeCurveTransformTarget = null;

    this.clipboard = null;
    this.clipboardPasteCount = 0;
  }

  init() {
    // fabric is loaded globally via CDN in index.html
    if (typeof fabric === 'undefined') {
      console.error('Fabric.js library not found!');
      return;
    }

    // Ensure canvas element exists
    const canvasEl = document.getElementById(this.canvasId);
    if (!canvasEl) {
      console.error(`Canvas element with id "${this.canvasId}" not found!`);
      return;
    }

    // Calculate initial dimensions (same logic as resize to prevent warping)
    const availableSize = this.calculateAvailableSize();
    const width = availableSize.width;
    const height = availableSize.height;

    console.log(`[CanvasManager] Initializing with size: ${width}x${height}`);

    this.fabricCanvas = new fabric.Canvas(this.canvasId, {
      width: width,
      height: height,
      isDrawingMode: false, // Managed by ToolManager
      selection: true,
      preserveObjectStacking: true,
      backgroundColor: '#ffffff', // Default white background
    });

    // Store initial size
    this.lastCanvasSize = { width, height };

    // Initialize viewport state
    this.rotationDegrees = 0;
    this.zoomLevel = 1;
    this.panX = 0;
    this.panY = 0;

    // Selection state is managed by tools (SelectTool enables, drawing tools disable as needed)
    // Don't set a default here - let tools control it

    this.fabricCanvas.on('mouse:down', opt => {
      const evt = opt.e;
      // Check if Ctrl key is pressed (or Meta key for Mac)
      if (evt.ctrlKey || evt.metaKey) {
        this.fabricCanvas.selection = true;
        // If we are in drawing mode, we might need to temporarily disable it?
        // Fabric handles this: if isDrawingMode is true, selection is disabled.
        // So we need to temporarily disable drawing mode if it's on.
        if (this.fabricCanvas.isDrawingMode) {
          this.fabricCanvas.isDrawingMode = false;
          this.fabricCanvas._tempDrawingMode = true; // Flag to restore later
        }
      } else {
        // If not Ctrl, ensure selection is false unless we are in Select tool
        // We need to check the active tool.
        // Accessing ToolManager from here is tricky.
        // Better: ToolManager sets selection=true/false.
        // But for the shortcut, we override.
        // If we are NOT in select tool (which sets selection=true), disable selection
        // We can check isDrawingMode.
        // If isDrawingMode is false, we might be in Select tool OR just idle.
        // Let's assume ToolManager manages the default state.
        // We only want to ENABLE it if Ctrl is pressed.
        // Actually, the requirement is "Add a shortcut to 'select' by ctrl + click dragging".
        // This implies that normally (without Ctrl), we are drawing.
        // So we just need to enable selection when Ctrl is down.
      }
    });

    this.fabricCanvas.on('mouse:up', opt => {
      // Restore state if we changed it
      if (this.fabricCanvas._tempDrawingMode) {
        this.fabricCanvas.isDrawingMode = true;
        this.fabricCanvas.selection = false;
        delete this.fabricCanvas._tempDrawingMode;
      } else if (!this.fabricCanvas.isDrawingMode) {
        // If we were not in drawing mode, check if we should disable selection
        // If the active tool is NOT select, we should probably disable selection?
        // But we don't know the active tool here easily.
        // Let's just rely on the key up event?
        // Mouse up is safer for the drag operation end.
        // If we enabled selection just for this drag, disable it now?
        // But standard behavior is: hold Ctrl to select.
        // If I release mouse but keep Ctrl, I should still be able to select?
        // Fabric updates selection property dynamically? No.
      }
    });

    console.log(`Fabric Canvas initialized: ${width}x${height}`);

    // Set original canvas size after initialization
    this.originalCanvasSize = { width: width, height: height };

    // Initialize zoom/pan events
    this.initZoomPan();

    // Enforce floating layout for full-screen canvas
    this.enforceFloatingLayout();

    // Initialize keyboard shortcuts
    this.initKeyboardShortcuts();

    // Listen for path creation (freehand drawing) to attach metadata and save history
    this.fabricCanvas.on('path:created', e => {
      const path = e.path;
      if (path) {
        // Make path selectable for moving/deleting
        path.set({
          selectable: true,
          evented: true,
        });

        if (window.app && window.app.metadataManager && window.app.projectManager) {
          // Attach metadata (label) to the path
          const imageLabel = window.app.projectManager.currentViewId || 'front';

          // Set currentImageLabel for tag prediction system
          window.currentImageLabel =
            (typeof window.getCaptureTabScopedLabel === 'function' &&
              window.getCaptureTabScopedLabel(imageLabel)) ||
            imageLabel;

          const strokeLabel = window.app.metadataManager.getNextLabel(imageLabel);
          window.app.metadataManager.attachMetadata(path, imageLabel, strokeLabel);
          console.log(`Freehand path created with label: ${strokeLabel}`);

          // Create tag for the stroke
          if (window.app.tagManager) {
            setTimeout(() => {
              window.app.tagManager.createTagForStroke(strokeLabel, imageLabel, path);
            }, 100);
          }

          // Small delay to ensure path is fully created before saving history
          setTimeout(() => {
            if (window.app && window.app.historyManager) {
              window.app.historyManager.saveState();
            }
          }, 50);
        }
      }
    });

    // Listen for object removal to update stroke list
    this.fabricCanvas.on('object:removed', e => {
      const obj = e.target;
      if (obj && window.app && window.app.metadataManager) {
        // We need to check if this object has metadata and remove it
        // Or simply refresh the list.
        // Since metadata is attached to the object, if the object is gone,
        // we should probably remove it from our tracking or at least update the UI.

        // However, StrokeMetadataManager tracks strokes by image label.
        // If we delete an object, we should probably remove it from the manager too.
        // But the manager usually iterates over canvas objects to build the list.
        // So calling updateStrokeVisibilityControls() should be enough if it re-scans.

        // Let's check updateStrokeVisibilityControls implementation.
        // It iterates over canvas objects. So refreshing is correct.

        // Debounce the update to avoid multiple refreshes when deleting multiple objects
        if (this._updateTimeout) clearTimeout(this._updateTimeout);
        this._updateTimeout = setTimeout(() => {
          window.app.metadataManager.updateStrokeVisibilityControls();
        }, 50);
      }
    });

    const captureCurveTransformStart = opt => {
      const action = opt?.transform?.action;
      const isScaleAction = action === 'scale' || action === 'scaleX' || action === 'scaleY';
      const logScale = (...args) => {
        if (isScaleAction) {
          console.log('[CURVE SCALE]', ...args);
        }
      };

      if (action === 'drag') {
        return;
      }

      // Try multiple ways to get the target object
      let obj = opt?.transform?.target || opt?.target;

      // If no direct target, try to get active object from canvas
      if (!obj) {
        obj = this.fabricCanvas.getActiveObject();
        console.log('[CURVE DEBUG] captureCurveTransformStart - using getActiveObject() fallback');
      }

      if (!obj) {
        return;
      }

      const initCurveTransformState = curveObj => {
        if (!curveObj) return;
        if (curveObj.__curveTransformActive) return;

        // Use Fabric's world-space matrix as-is to avoid double-counting group transforms.
        const fullMatrix = curveObj.calcTransformMatrix();

        curveObj.__curveTransformActive = true;
        curveObj.__curveTransformAction = action;
        curveObj.__curveTransformCorner = opt?.transform?.corner || null;
        curveObj.__curveBakedThisGesture = false;
        curveObj.__curveOrigMatrix = fullMatrix;
        curveObj.__curveOrigAngle = curveObj.angle || 0;
        curveObj.__curveOrigPoints = curveObj.customPoints.map(point => ({
          x: point.x,
          y: point.y,
        }));

        const originX = opt?.transform?.originX || 'center';
        const originY = opt?.transform?.originY || 'center';
        const pivotTarget = opt?.transform?.target || curveObj;
        if (typeof pivotTarget?.getPointByOrigin === 'function') {
          const pivot = pivotTarget.getPointByOrigin(originX, originY);
          curveObj.__curveTransformPivotWorld = { x: pivot.x, y: pivot.y };
        } else if (typeof pivotTarget?.getCenterPoint === 'function') {
          const pivot = pivotTarget.getCenterPoint();
          curveObj.__curveTransformPivotWorld = { x: pivot.x, y: pivot.y };
        }
        if (!curveObj.__curveTransformPivotWorld) {
          const minX = Math.min(...curveObj.customPoints.map(p => p.x));
          const maxX = Math.max(...curveObj.customPoints.map(p => p.x));
          const minY = Math.min(...curveObj.customPoints.map(p => p.y));
          const maxY = Math.max(...curveObj.customPoints.map(p => p.y));
          curveObj.__curveTransformPivotWorld = {
            x: (minX + maxX) / 2,
            y: (minY + maxY) / 2,
          };
        }

        if (action === 'rotate') {
          console.log('[CURVE ROTATE] capture start', {
            action,
            pivotWorld: curveObj.__curveTransformPivotWorld,
            angle: curveObj.angle,
            points: curveObj.__curveOrigPoints.length,
          });
        }

        logScale('corner', curveObj.__curveTransformCorner);
        logScale('pivotWorld', curveObj.__curveTransformPivotWorld);

        const activeObj = this.fabricCanvas.getActiveObject();
        if (activeObj && activeObj.type === 'activeSelection') {
          curveObj.__curveOrigActiveSelection = activeObj;
          curveObj.__curveOrigActiveSelectionCenter = activeObj.getCenterPoint();
          logScale('activeSelection center', curveObj.__curveOrigActiveSelectionCenter);
        }

        let origCenterWorld = curveObj.getCenterPoint();
        if (curveObj.group) {
          const groupMatrix = curveObj.group.calcTransformMatrix();
          origCenterWorld = fabric.util.transformPoint(origCenterWorld, groupMatrix);
        }
        curveObj.__curveOrigCenterWorld = origCenterWorld;
      };

      // Handle activeSelection - initialize transform state for all curves in the selection
      if (obj.type === 'activeSelection') {
        const objects = obj.getObjects();
        logScale('activeSelection objects:', objects.length);
        const curves = objects.filter(o => o.type === 'path' && Array.isArray(o.customPoints));
        if (!curves.length) return;
        curves.forEach(curve => initCurveTransformState(curve));
        this.__activeCurveTransformTarget = curves[0];
        return;
      }

      if (obj.type !== 'path' || !Array.isArray(obj.customPoints)) {
        return;
      }
      if (obj.isEditingControlPoint) {
        return;
      }
      if (obj.__curveTransformActive) {
        return;
      }

      logScale('capture start', { action });
      logScale(
        'customPoints',
        JSON.stringify(obj.customPoints.map(p => ({ x: p.x.toFixed(1), y: p.y.toFixed(1) })))
      );

      initCurveTransformState(obj);
      this.__activeCurveTransformTarget = obj;
    };

    const scheduleBakeAfterFinalize = curveObj => {
      const canvas = curveObj?.canvas;
      if (!canvas) return;
      if (curveObj.__curveBakeScheduled) return;
      curveObj.__curveBakeScheduled = true;

      const tick = () => {
        const stillGrouping = curveObj.group && curveObj.group.type === 'activeSelection';
        const stillTransforming = !!canvas._currentTransform;

        if (stillGrouping || stillTransforming) {
          requestAnimationFrame(tick);
          return;
        }

        curveObj.__curveBakeScheduled = false;
        bakeCurveTransform({ target: curveObj });
        canvas.requestRenderAll();
      };

      requestAnimationFrame(tick);
    };

    const finalizeCurveVisualState = (canvas, obj) => {
      if (!obj) {
        return;
      }
      obj.dirty = true;
      obj._cacheCanvas = null;
      obj._cacheContext = null;
      obj.setCoords();
      canvas?.requestRenderAll?.() ?? canvas?.renderAll?.();
    };

    const refreshTagForStroke = obj => {
      const tagManager = window.app?.tagManager;
      if (!tagManager || !obj) {
        return;
      }
      for (const [strokeLabel, tagObj] of tagManager.tagObjects.entries()) {
        if (tagObj.connectedStroke !== obj) continue;

        let strokeCenter;
        if (obj.group) {
          const centerRelative = obj.getCenterPoint();
          const groupMatrix = obj.group.calcTransformMatrix();
          strokeCenter = fabric.util.transformPoint(centerRelative, groupMatrix);
        } else {
          strokeCenter = obj.getCenterPoint();
        }

        let tagCenter;
        if (tagObj.group) {
          const centerRelative = tagObj.getCenterPoint();
          const groupMatrix = tagObj.group.calcTransformMatrix();
          tagCenter = fabric.util.transformPoint(centerRelative, groupMatrix);
        } else {
          tagCenter = tagObj.getCenterPoint();
        }

        if (strokeCenter && tagCenter) {
          tagObj.tagOffset = {
            x: tagCenter.x - strokeCenter.x,
            y: tagCenter.y - strokeCenter.y,
          };
          obj.tagOffset = {
            x: tagObj.tagOffset.x,
            y: tagObj.tagOffset.y,
          };
        }

        tagManager.updateConnector(tagObj.strokeLabel || strokeLabel, tagObj.imageLabel);
        break;
      }
    };

    const bakeCurveTransform = opt => {
      let obj = opt?.target;
      const isScaleAction =
        obj?.__curveTransformAction === 'scale' ||
        obj?.__curveTransformAction === 'scaleX' ||
        obj?.__curveTransformAction === 'scaleY';
      const logScale = (...args) => {
        if (isScaleAction) {
          console.log('[CURVE SCALE]', ...args);
        }
      };

      // Try to get active object from canvas if no direct target
      if (!obj) {
        obj = this.fabricCanvas.getActiveObject();
      }

      // Also check if we have a tracked active curve transform target
      if (!obj && this.__activeCurveTransformTarget) {
        obj = this.__activeCurveTransformTarget;
      }

      if (!obj) {
        return;
      }

      // Handle activeSelection - delay bake until Fabric finalizes and ungroups objects
      if (obj.type === 'activeSelection') {
        const objects = obj.getObjects();
        objects.forEach(o => {
          if (o?.type === 'path' && Array.isArray(o.customPoints) && o.__curveTransformActive) {
            scheduleBakeAfterFinalize(o);
          }
        });
        return;
      }
      if (obj.type !== 'path' || !Array.isArray(obj.customPoints)) {
        delete obj.__curveTransformActive;
        delete obj.__curveTransformAction;
        delete obj.__curveTransformCorner;
        delete obj.__curveTransformPivotWorld;
        delete obj.__curveOrigAngle;
        delete obj.__curveOrigMatrix;
        delete obj.__curveOrigPoints;
        delete obj.__curveBakedThisGesture;
        return;
      }
      const activeSelection = obj.group && obj.group.type === 'activeSelection' ? obj.group : null;
      let restoreObjects = null;
      if (activeSelection && opt?.forceUngroup) {
        restoreObjects = activeSelection.getObjects?.().slice() ?? null;
        obj.canvas?.discardActiveObject?.();
      } else if (activeSelection) {
        scheduleBakeAfterFinalize(obj);
        return;
      }
      // CRITICAL: Skip if we're editing a control point - the control point handler manages customPoints directly
      if (obj.isEditingControlPoint || obj.__curveEditBaseCenterWorld) {
        // Clean up transform state since we're not using it
        delete obj.__curveTransformActive;
        delete obj.__curveTransformAction;
        delete obj.__curveTransformCorner;
        delete obj.__curveTransformPivotWorld;
        delete obj.__curveOrigAngle;
        delete obj.__curveOrigMatrix;
        delete obj.__curveOrigPoints;
        delete obj.__curveBakedThisGesture;
        return;
      }
      if (obj.__curveBakedThisGesture) {
        return;
      }
      if (!obj.__curveTransformActive || !obj.__curveOrigMatrix || !obj.__curveOrigPoints) {
        if (obj.__curveTransformAction === 'rotate') {
          console.warn('[CURVE ROTATE] bake skipped: missing transform state', {
            hasActive: !!obj.__curveTransformActive,
            hasMatrix: !!obj.__curveOrigMatrix,
            hasPoints: !!obj.__curveOrigPoints,
          });
        }
        return;
      }
      obj.__curveBakedThisGesture = true;
      logScale('bake start');

      if (globalThis.app?.debugCurveScaleNoCache) {
        obj.objectCaching = false;
        logScale('objectCaching', 'disabled');
      }

      const before = obj.__curveOrigMatrix;

      // Use Fabric's world-space matrix as-is to avoid double-counting group transforms.
      const after = obj.calcTransformMatrix();

      const inverseBefore = fabric.util.invertTransform(before);
      const delta = fabric.util.multiplyTransformMatrices(after, inverseBefore);
      const rotationRad = Math.atan2(delta[1], delta[0]);
      const hasRotation = Math.abs(rotationRad) > 0.0001;

      logScale('delta', delta.map(v => v.toFixed(4)).join(', '));

      const corner = obj.__curveTransformCorner;
      const isCornerScale = corner && ['tl', 'tr', 'bl', 'br'].includes(corner);
      const useUniformScale = isScaleAction && isCornerScale;
      const count = Math.min(obj.__curveOrigPoints.length, obj.customPoints.length);

      if (hasRotation && !isScaleAction) {
        for (let i = 0; i < count; i += 1) {
          const original = obj.__curveOrigPoints[i];
          const transformed = fabric.util.transformPoint(
            new fabric.Point(original.x, original.y),
            delta
          );
          obj.customPoints[i].x = transformed.x;
          obj.customPoints[i].y = transformed.y;
        }
        console.log('[CURVE ROTATE] baked points', {
          rotationRad: rotationRad.toFixed(4),
          delta,
        });

        // For rotate, keep Fabric's angle/position and just sync customPoints.
        obj.__lastCenter = obj.getCenterPoint();
        obj.dirty = true;
        obj.setCoords();
        if (Array.isArray(obj.customPoints)) {
          FabricControls.createCurveControls(obj);
        }
        delete obj.__curveTransformActive;
        delete obj.__curveTransformAction;
        delete obj.__curveTransformCorner;
        delete obj.__curveTransformPivotWorld;
        delete obj.__curveOrigAngle;
        delete obj.__curveOrigMatrix;
        delete obj.__curveOrigPoints;
        delete obj.__curveBakedThisGesture;
        delete obj.__curveBakeScheduled;
        delete obj.__curveOrigActiveSelection;
        delete obj.__curveOrigActiveSelectionCenter;
        delete obj.__curveOrigCenterWorld;
        console.log('[CURVE ROTATE] bake done', { left: obj.left, top: obj.top });
        return;
      } else if (useUniformScale) {
        const sx = Math.hypot(delta[0], delta[1]);
        const sy = Math.hypot(delta[2], delta[3]);
        let uniformScale = Math.min(sx, sy);
        if (!Number.isFinite(uniformScale) || uniformScale === 0) {
          uniformScale = 1;
        }
        logScale('uniformScale', uniformScale.toFixed(4));

        const pivot = obj.__curveTransformPivotWorld || obj.getCenterPoint();
        logScale('pivotWorld', pivot);
        for (let i = 0; i < count; i += 1) {
          const original = obj.__curveOrigPoints[i];
          const dx = original.x - pivot.x;
          const dy = original.y - pivot.y;
          obj.customPoints[i].x = pivot.x + dx * uniformScale;
          obj.customPoints[i].y = pivot.y + dy * uniformScale;
        }
      } else {
        for (let i = 0; i < count; i += 1) {
          const original = obj.__curveOrigPoints[i];
          const transformed = fabric.util.transformPoint(
            new fabric.Point(original.x, original.y),
            delta
          );
          obj.customPoints[i].x = transformed.x;
          obj.customPoints[i].y = transformed.y;
        }
      }

      // Calculate the center from the transformed customPoints (not from getCenterPoint which can drift)
      const minX = Math.min(...obj.customPoints.map(p => p.x));
      const maxX = Math.max(...obj.customPoints.map(p => p.x));
      const minY = Math.min(...obj.customPoints.map(p => p.y));
      const maxY = Math.max(...obj.customPoints.map(p => p.y));
      let currentCenterWorld = obj.__curveOrigCenterWorld || obj.getCenterPoint();
      if (!obj.__curveOrigCenterWorld && obj.group) {
        const groupMatrix = obj.group.calcTransformMatrix();
        currentCenterWorld = fabric.util.transformPoint(currentCenterWorld, groupMatrix);
      }
      const baseCenterWorld = hasRotation
        ? currentCenterWorld
        : {
            x: (minX + maxX) / 2,
            y: (minY + maxY) / 2,
          };
      logScale('baseCenterWorld', baseCenterWorld);

      const preserveAngle = useUniformScale && !hasRotation;
      const angle = preserveAngle ? obj.__curveOrigAngle || 0 : 0;
      const angleRad = angle ? fabric.util.degreesToRadians(angle) : 0;

      // Convert world points to local points around the calculated center
      const localPoints = obj.customPoints.map(p => {
        const local = new fabric.Point(p.x - baseCenterWorld.x, p.y - baseCenterWorld.y);
        if (!preserveAngle || !angleRad) {
          return { x: local.x, y: local.y };
        }
        const rotated = fabric.util.rotatePoint(local, new fabric.Point(0, 0), -angleRad);
        return { x: rotated.x, y: rotated.y };
      });

      const newPathString = PathUtils.createSmoothPath(localPoints);
      const pathData = fabric.util.parsePath(newPathString);
      obj.set({ path: pathData, angle });

      // If the curve is inside a group/activeSelection, we need to compensate for the parent's scale
      // Otherwise the parent's scale will be applied on top of our already-baked coordinates
      let compensateScaleX = 1;
      let compensateScaleY = 1;
      if (isScaleAction && obj.group) {
        const parentScaleX = obj.group.scaleX || 1;
        const parentScaleY = obj.group.scaleY || 1;
        if (parentScaleX !== 1 || parentScaleY !== 1) {
          compensateScaleX = 1 / parentScaleX;
          compensateScaleY = 1 / parentScaleY;
          logScale('parentScale', { parentScaleX, parentScaleY });
        }
      }

      obj.set({
        scaleX: compensateScaleX,
        scaleY: compensateScaleY,
        skewX: 0,
        skewY: 0,
        flipX: false,
        flipY: false,
      });

      // Reset pathOffset so _calcDimensions uses the new path bounds.
      obj.set({ pathOffset: new fabric.Point(0, 0) });

      const dims = obj._calcDimensions();
      const centerLocal = new fabric.Point(dims.left + dims.width / 2, dims.top + dims.height / 2);
      logScale('centerLocal', { x: centerLocal.x, y: centerLocal.y });

      obj.set({
        width: dims.width,
        height: dims.height,
        pathOffset: centerLocal,
      });

      // Compensate world position: baseCenterWorld + centerLocal
      const centerLocalWorld =
        preserveAngle && angleRad
          ? fabric.util.rotatePoint(centerLocal, new fabric.Point(0, 0), angleRad)
          : centerLocal;
      const compensatedWorldCenter =
        hasRotation && obj.__curveOrigCenterWorld
          ? new fabric.Point(obj.__curveOrigCenterWorld.x, obj.__curveOrigCenterWorld.y)
          : hasRotation
            ? new fabric.Point(currentCenterWorld.x, currentCenterWorld.y)
            : new fabric.Point(
                baseCenterWorld.x + centerLocalWorld.x,
                baseCenterWorld.y + centerLocalWorld.y
              );
      logScale('compensatedWorldCenter', compensatedWorldCenter);

      obj.setPositionByOrigin(compensatedWorldCenter, 'center', 'center');
      logScale('leftTop', { left: obj.left, top: obj.top });

      // Update lastLeft/lastTop to prevent stale delta calculations in moving handlers
      obj.lastLeft = obj.left;
      obj.lastTop = obj.top;
      const updatedCenter = obj.getCenterPoint();
      obj.__lastCenter = { x: updatedCenter.x, y: updatedCenter.y };

      obj.dirty = true;
      obj.setCoords();

      if (Array.isArray(obj.customPoints)) {
        FabricControls.createCurveControls(obj);
      }

      const canvas = obj.canvas;
      const sel = obj.__curveOrigActiveSelection || canvas?.getActiveObject?.();
      const shouldIsolateSelection =
        sel && sel.type === 'activeSelection' && obj.__curveTransformAction === 'scale';

      if (shouldIsolateSelection && !restoreObjects) {
        restoreObjects = sel.getObjects?.().slice() ?? null;
        canvas?.discardActiveObject();
        canvas?.requestRenderAll?.();
      }

      finalizeCurveVisualState(obj.canvas, obj);

      // P2: If the curve was scaled as part of an activeSelection, force that selection to recompute bounds/coords.
      // Otherwise the selection box can lag behind and the curve appears to "jump" outside it.
      if (sel && sel.type === 'activeSelection' && !shouldIsolateSelection) {
        try {
          // Recompute selection bounds based on updated object coords.
          // These are internal but effective across Fabric 4/5-ish builds.
          sel._calcBounds();
          sel._updateObjectsCoords();
          sel.setCoords();

          // Some Fabric builds need a render tick to fully settle.
          obj.canvas?.requestRenderAll();
        } catch (e) {
          console.warn('[CURVE DEBUG] activeSelection recalc failed:', e);
        }

        if (obj.__curveTransformAction === 'scale') {
          const objects = sel.getObjects();
          const curveCount = objects.filter(
            o => o?.type === 'path' && Array.isArray(o.customPoints)
          ).length;
          const hasNonTagNonCurve = objects.some(
            o => !(o?.type === 'path' && Array.isArray(o.customPoints)) && !o?.isTag
          );

          if (curveCount === 1 && !hasNonTagNonCurve) {
            sel._restoreObjectsState?.();
            obj.canvas?.discardActiveObject();
            obj.canvas?.setActiveObject(obj);
            obj.setCoords();
            obj.canvas?.requestRenderAll();
          }
        }
      }

      if (restoreObjects?.length) {
        const restoredSelection = new fabric.ActiveSelection(restoreObjects, { canvas });
        canvas?.setActiveObject(restoredSelection);
        restoredSelection.setCoords();
        canvas?.requestRenderAll?.();
      }

      if (isScaleAction) {
        refreshTagForStroke(obj);
      }

      // P3: Mark as just baked so getCurveAnchorWorldPoint knows not to apply additional scaling.
      // Use requestAnimationFrame to wait until activeSelection scale settles back to 1.
      obj.__curveJustBaked = true;

      const clearCanvas = obj.canvas;
      const clearWhenSafe = () => {
        const active = clearCanvas?.getActiveObject?.();
        const stillScaledSelection =
          active &&
          active.type === 'activeSelection' &&
          ((active.scaleX || 1) !== 1 || (active.scaleY || 1) !== 1);

        if (stillScaledSelection) {
          requestAnimationFrame(clearWhenSafe);
          return;
        }

        delete obj.__curveJustBaked;
      };

      requestAnimationFrame(clearWhenSafe);

      if (obj.__curveTransformAction === 'rotate') {
        console.log('[CURVE ROTATE] bake done', { left: obj.left, top: obj.top });
      }

      delete obj.__curveTransformActive;
      delete obj.__curveTransformAction;
      delete obj.__curveTransformCorner;
      delete obj.__curveTransformPivotWorld;
      delete obj.__curveOrigAngle;
      delete obj.__curveOrigMatrix;
      delete obj.__curveOrigPoints;
      delete obj.__curveBakedThisGesture;
      delete obj.__curveBakeScheduled;
      delete obj.__curveOrigActiveSelection;
      delete obj.__curveOrigActiveSelectionCenter;

      logScale('bake done');
      if (obj.__curveTransformAction === 'rotate') {
        console.log('[CURVE ROTATE] bake done', { left: obj.left, top: obj.top });
      }
    };

    // ========== LINE BAKING LOGIC ==========
    // Similar to curve baking, but for fabric.Line objects
    // When a line is scaled, we need to bake the transform into the actual coordinates

    const scheduleLineBakeAfterFinalize = lineObj => {
      const canvas = lineObj?.canvas;
      if (!canvas) return;
      if (lineObj.__lineBakeScheduled) return;
      lineObj.__lineBakeScheduled = true;

      const tick = () => {
        if (!lineObj.__lineTransformActive || !lineObj.__lineOrigMatrix) {
          lineObj.__lineBakeScheduled = false;
          return;
        }
        const stillGrouping = lineObj.group && lineObj.group.type === 'activeSelection';
        const stillTransforming = !!canvas._currentTransform;

        if (stillGrouping || stillTransforming) {
          requestAnimationFrame(tick);
          return;
        }

        lineObj.__lineBakeScheduled = false;
        this.bakeLineSingleObject(lineObj);
        canvas.requestRenderAll();
      };

      requestAnimationFrame(tick);
    };

    const captureLineTransformStart = opt => {
      const action = opt?.transform?.action;
      const isScaleAction = action === 'scale' || action === 'scaleX' || action === 'scaleY';

      // Skip for drag and control point editing (modifyLine is the action for endpoint controls)
      if (action === 'drag' || action === 'modifyLine') {
        return;
      }

      // Only capture for actual scaling/rotating/skewing transforms
      if (
        !action ||
        (action !== 'scale' &&
          action !== 'scaleX' &&
          action !== 'scaleY' &&
          action !== 'rotate' &&
          action !== 'skewX' &&
          action !== 'skewY')
      ) {
        return;
      }

      let obj = opt?.transform?.target || opt?.target;

      if (!obj) {
        obj = this.fabricCanvas.getActiveObject();
      }

      if (!obj) {
        return;
      }

      // Handle activeSelection - check if it contains lines
      if (obj.type === 'activeSelection') {
        const objects = obj.getObjects();
        // Capture transform start for each line in the selection
        for (const o of objects) {
          if (o.type === 'line' && !o.__lineTransformActive) {
            this.captureLineState(o, opt);
          }
        }
        return;
      }

      if (obj.type !== 'line') {
        return;
      }
      // Skip lines that are inside a permanent group (like arrows)
      // Only process lines in activeSelection or standalone lines
      if (obj.group && obj.group.type !== 'activeSelection') {
        return;
      }
      if (obj.__lineTransformActive) {
        return;
      }

      this.captureLineState(obj, opt);
    };

    // Helper to capture line state
    this.captureLineState = (obj, opt) => {
      const fullMatrix = obj.calcTransformMatrix();
      const points = obj.calcLinePoints();

      // Transform the local points to world coordinates
      const p1World = fabric.util.transformPoint({ x: points.x1, y: points.y1 }, fullMatrix);
      const p2World = fabric.util.transformPoint({ x: points.x2, y: points.y2 }, fullMatrix);

      obj.__lineTransformActive = true;
      obj.__lineTransformAction = opt?.transform?.action || 'scale';
      obj.__lineBakedThisGesture = false;
      obj.__lineOrigMatrix = fullMatrix;
      obj.__lineOrigP1World = { x: p1World.x, y: p1World.y };
      obj.__lineOrigP2World = { x: p2World.x, y: p2World.y };

      console.log('[LINE SCALE] capture start', {
        p1: obj.__lineOrigP1World,
        p2: obj.__lineOrigP2World,
      });
    };

    const bakeLineTransform = opt => {
      let obj = opt?.target;

      if (!obj) {
        obj = this.fabricCanvas.getActiveObject();
      }

      if (!obj) {
        return;
      }

      // Handle activeSelection - schedule bake for each line after selection is finalized
      if (obj.type === 'activeSelection') {
        const objects = obj.getObjects();
        for (const o of objects) {
          if (o.type === 'line' && o.__lineTransformActive && !o.__lineBakedThisGesture) {
            // Schedule bake to happen after the selection is ungrouped
            scheduleLineBakeAfterFinalize(o);
          }
        }
        return;
      }

      if (obj.type !== 'line') {
        return;
      }
      if (!obj.__lineTransformActive) {
        return;
      }
      if (obj.__lineBakedThisGesture) {
        return;
      }

      // If line is inside activeSelection, schedule bake for later
      if (obj.group && obj.group.type === 'activeSelection') {
        scheduleLineBakeAfterFinalize(obj);
        return;
      }

      this.bakeLineSingleObject(obj);
    };

    // Helper to bake a single line object
    this.bakeLineSingleObject = obj => {
      if (!obj.__lineOrigMatrix || !obj.__lineOrigP1World || !obj.__lineOrigP2World) {
        delete obj.__lineTransformActive;
        delete obj.__lineTransformAction;
        delete obj.__lineBakedThisGesture;
        delete obj.__lineOrigMatrix;
        delete obj.__lineOrigP1World;
        delete obj.__lineOrigP2World;
        delete obj.__lineBakeScheduled;
        return;
      }
      obj.__lineBakedThisGesture = true;

      const before = obj.__lineOrigMatrix;
      const after = obj.calcTransformMatrix();

      // Calculate the delta transform
      const inverseBefore = fabric.util.invertTransform(before);
      const delta = fabric.util.multiplyTransformMatrices(after, inverseBefore);

      // Transform the original world points by delta
      const p1Transformed = fabric.util.transformPoint(
        new fabric.Point(obj.__lineOrigP1World.x, obj.__lineOrigP1World.y),
        delta
      );
      const p2Transformed = fabric.util.transformPoint(
        new fabric.Point(obj.__lineOrigP2World.x, obj.__lineOrigP2World.y),
        delta
      );

      console.log('[LINE SCALE] baking', {
        p1Before: obj.__lineOrigP1World,
        p2Before: obj.__lineOrigP2World,
        p1After: { x: p1Transformed.x, y: p1Transformed.y },
        p2After: { x: p2Transformed.x, y: p2Transformed.y },
      });

      // Calculate the new center (midpoint of the line)
      const center = {
        x: (p1Transformed.x + p2Transformed.x) / 2,
        y: (p1Transformed.y + p2Transformed.y) / 2,
      };

      // Line coordinates are relative to center, so calculate local offsets
      // Note: we reset angle to 0 so no rotation compensation needed
      const localP1 = {
        x: p1Transformed.x - center.x,
        y: p1Transformed.y - center.y,
      };
      const localP2 = {
        x: p2Transformed.x - center.x,
        y: p2Transformed.y - center.y,
      };

      // Reset transforms and set coordinates relative to center
      obj.set({
        x1: localP1.x,
        y1: localP1.y,
        x2: localP2.x,
        y2: localP2.y,
        left: center.x,
        top: center.y,
        angle: 0,
        scaleX: 1,
        scaleY: 1,
        skewX: 0,
        skewY: 0,
        flipX: false,
        flipY: false,
      });

      obj.setCoords();

      // Update lastLeft/lastTop for consistent move tracking
      obj.lastLeft = obj.left;
      obj.lastTop = obj.top;

      obj.dirty = true;

      // Refresh controls
      FabricControls.createLineControls(obj);

      // Fire moving event to update tag connectors
      obj.fire('moving');

      // Refresh tag connector if one is attached
      refreshTagForStroke(obj);

      // Request render
      obj.canvas?.requestRenderAll();

      // Clean up state
      delete obj.__lineTransformActive;
      delete obj.__lineTransformAction;
      delete obj.__lineBakedThisGesture;
      delete obj.__lineOrigMatrix;
      delete obj.__lineOrigP1World;
      delete obj.__lineOrigP2World;
      delete obj.__lineBakeScheduled;

      console.log('[LINE SCALE] bake done', { left: obj.left, top: obj.top });
    };

    // Register line transform handlers
    this.fabricCanvas.on('object:scaling', captureLineTransformStart);
    this.fabricCanvas.on('object:rotating', captureLineTransformStart);
    this.fabricCanvas.on('object:skewing', captureLineTransformStart);
    this.fabricCanvas.on('before:transform', captureLineTransformStart);
    this.fabricCanvas.on('object:modified', bakeLineTransform);

    // Also handle mouse:up for lines to ensure baking happens
    this.fabricCanvas.on('mouse:up', opt => {
      const obj = opt?.target;
      if (obj?.type === 'line' && obj.__lineTransformActive && !obj.__lineBakedThisGesture) {
        // If line is inside activeSelection, schedule bake for later
        if (obj.group && obj.group.type === 'activeSelection') {
          const action = obj.__lineTransformAction;
          const isRotateOrSkew =
            action === 'rotate' || action === 'skew' || action === 'skewX' || action === 'skewY';
          if (isRotateOrSkew) {
            const selection = obj.group;
            const restoreObjects = selection.getObjects?.().slice() ?? null;
            obj.canvas?.discardActiveObject?.();
            this.bakeLineSingleObject(obj);
            if (restoreObjects?.length) {
              const restoredSelection = new fabric.ActiveSelection(restoreObjects, {
                canvas: obj.canvas,
              });
              obj.canvas?.setActiveObject(restoredSelection);
              restoredSelection.setCoords();
              obj.canvas?.requestRenderAll?.();
            }
          } else {
            console.log(
              '[LINE SCALE] mouse:up - scheduling bake after finalize (still in activeSelection)'
            );
            scheduleLineBakeAfterFinalize(obj);
          }
        } else {
          this.bakeLineSingleObject(obj);
        }
      }
      // Handle activeSelection containing lines
      if (obj?.type === 'activeSelection') {
        const objects = obj.getObjects();
        const rotateOrSkewLines = [];
        for (const o of objects) {
          if (o.type === 'line' && o.__lineTransformActive && !o.__lineBakedThisGesture) {
            const action = o.__lineTransformAction;
            const isRotateOrSkew =
              action === 'rotate' || action === 'skew' || action === 'skewX' || action === 'skewY';
            if (isRotateOrSkew) {
              rotateOrSkewLines.push(o);
            } else {
              // Schedule bake to happen after the selection is ungrouped
              console.log(
                '[LINE SCALE] mouse:up - scheduling bake after finalize (in activeSelection)'
              );
              scheduleLineBakeAfterFinalize(o);
            }
          }
        }

        if (rotateOrSkewLines.length) {
          const restoreObjects = objects.slice();
          obj.canvas?.discardActiveObject?.();
          rotateOrSkewLines.forEach(line => this.bakeLineSingleObject(line));
          const restoredSelection = new fabric.ActiveSelection(restoreObjects, {
            canvas: obj.canvas,
          });
          obj.canvas?.setActiveObject(restoredSelection);
          restoredSelection.setCoords();
          obj.canvas?.requestRenderAll?.();
        }
      }
    });

    // ========== END LINE BAKING LOGIC ==========

    this.fabricCanvas.on('object:scaling', captureCurveTransformStart);
    this.fabricCanvas.on('object:rotating', captureCurveTransformStart);
    this.fabricCanvas.on('object:skewing', captureCurveTransformStart);
    this.fabricCanvas.on('before:transform', captureCurveTransformStart);
    this.fabricCanvas.on('object:modified', bakeCurveTransform);
    this.fabricCanvas.on('mouse:up', opt => {
      const activeTarget = opt?.target;
      if (activeTarget?.type === 'activeSelection') {
        const objects = activeTarget.getObjects();
        objects.forEach(o => {
          if (o?.type === 'path' && Array.isArray(o.customPoints)) {
            if (!o.__curveTransformActive || o.__curveBakedThisGesture) return;
            const action = o.__curveTransformAction;
            const isRotateOrSkew =
              action === 'rotate' || action === 'skew' || action === 'skewX' || action === 'skewY';
            if (o.group && o.group.type === 'activeSelection') {
              if (isRotateOrSkew) {
                bakeCurveTransform({ target: o, forceUngroup: true });
              } else {
                console.log(
                  '[CURVE SCALE] mouse:up - scheduling bake after finalize (still in activeSelection)'
                );
                scheduleBakeAfterFinalize(o);
              }
            } else {
              bakeCurveTransform({ target: o });
            }
          }
        });
        this.__activeCurveTransformTarget = null;
        return;
      }

      const obj = this.__activeCurveTransformTarget || activeTarget;
      if (obj?.__curveTransformActive && !obj.__curveBakedThisGesture) {
        // CRITICAL: If curve is inside activeSelection, use scheduleBakeAfterFinalize
        // to wait until the curve is ungrouped. Otherwise canonicalize runs with
        // the curve still in selection context, causing position mismatch.
        if (obj.group && obj.group.type === 'activeSelection') {
          const action = obj.__curveTransformAction;
          const isRotateOrSkew =
            action === 'rotate' || action === 'skew' || action === 'skewX' || action === 'skewY';
          if (isRotateOrSkew) {
            bakeCurveTransform({ target: obj, forceUngroup: true });
          } else {
            console.log(
              '[CURVE SCALE] mouse:up - scheduling bake after finalize (still in activeSelection)'
            );
            scheduleBakeAfterFinalize(obj);
          }
        } else {
          bakeCurveTransform({ target: obj });
        }
      }
      this.__activeCurveTransformTarget = null;
    });

    // Ensure canvas is visible
    canvasEl.style.display = 'block';

    // Setup ResizeObserver to handle flex layout changes
    this.setupResizeObserver();
  }

  enforceFloatingLayout() {
    const applyStyles = () => {
      const strokePanel = document.getElementById('strokePanel');
      const imagePanel = document.getElementById('imagePanel');
      const mainLayout = document.getElementById('main-layout');
      const canvasWrapper = document.getElementById('main-canvas-wrapper');

      if (strokePanel && imagePanel && mainLayout && canvasWrapper) {
        console.log('[CanvasManager] Enforcing Floating Layout (Full Screen Canvas)');

        // 1. Main Layout: Relative container, block display (not flex)
        mainLayout.style.setProperty('position', 'relative', 'important');
        mainLayout.style.setProperty('display', 'block', 'important');
        mainLayout.style.setProperty('z-index', '10', 'important');

        // 2. Canvas Wrapper: Absolute, Full Screen, Bottom Layer
        canvasWrapper.style.setProperty('position', 'absolute', 'important');
        canvasWrapper.style.setProperty('left', '0', 'important');
        canvasWrapper.style.setProperty('top', '0', 'important');
        canvasWrapper.style.setProperty('width', '100%', 'important');
        canvasWrapper.style.setProperty('height', '100%', 'important');
        canvasWrapper.style.setProperty('z-index', '0', 'important');

        // Move panels to body to ensure they can float above everything (escape main-layout stacking context)
        if (strokePanel.parentNode !== document.body) {
          document.body.appendChild(strokePanel);
        }
        if (imagePanel.parentNode !== document.body) {
          document.body.appendChild(imagePanel);
        }

        // 3. Panels: Absolute, Floating, Top Layer
        // Stroke Panel (Left)
        strokePanel.style.setProperty('position', 'fixed', 'important'); // Use fixed to stay on screen
        strokePanel.style.setProperty('left', '0', 'important');
        strokePanel.style.setProperty('top', '48px', 'important'); // Account for toolbar
        strokePanel.style.setProperty('height', 'calc(100% - 128px)', 'important'); // Full height minus toolbar and stepper
        strokePanel.style.setProperty('z-index', '2000', 'important');
        strokePanel.style.setProperty('opacity', '1', 'important');
        strokePanel.style.setProperty('visibility', 'visible', 'important');
        strokePanel.style.setProperty('display', 'flex', 'important');
        strokePanel.style.setProperty('flex-direction', 'column', 'important');

        // Image Panel (Right)
        imagePanel.style.setProperty('position', 'fixed', 'important'); // Use fixed to stay on screen
        imagePanel.style.setProperty('right', '0', 'important');
        imagePanel.style.setProperty('top', '48px', 'important'); // Account for toolbar
        imagePanel.style.setProperty('height', 'calc(100% - 128px)', 'important'); // Full height minus toolbar and stepper
        imagePanel.style.setProperty('z-index', '2000', 'important');
        imagePanel.style.setProperty('opacity', '1', 'important');
        imagePanel.style.setProperty('visibility', 'visible', 'important');
        imagePanel.style.setProperty('display', 'flex', 'important');
        imagePanel.style.setProperty('flex-direction', 'column', 'important');

        // Force resize to update canvas dimensions
        setTimeout(() => {
          this.resize();
        }, 0);

        console.log('[CanvasManager] Panels moved to body and forced to top layer');
      }
    };

    // Apply immediately
    applyStyles();

    // Re-apply after a delay to override any conflicting scripts (like relocatePanels)
    setTimeout(applyStyles, 100);
    setTimeout(applyStyles, 500);
    setTimeout(applyStyles, 1000);
  }

  setupResizeObserver() {
    const wrapper = document.getElementById('main-canvas-wrapper');
    if (!wrapper) return;

    this.resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        if (entry.target === wrapper) {
          // Debounce the resize call
          if (this.resizeTimeout) clearTimeout(this.resizeTimeout);
          this.resizeTimeout = setTimeout(() => {
            this.resize();
          }, 100); // Standard debounce for stability
        }
      }
    });

    this.resizeObserver.observe(wrapper);
  }

  initKeyboardShortcuts() {
    // Delete key handler
    document.addEventListener('keydown', e => {
      // Don't delete if typing in an input
      // Don't delete if typing in an input
      const isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
      const isContentEditable = e.target.isContentEditable;
      const isTextEditing =
        window.app?.toolManager?.tools?.text?.activeTextObject?.isEditing === true;

      if (isInput || isContentEditable || isTextEditing) {
        return;
      }

      const key = String(e.key || '').toLowerCase();
      const isCopy = (e.ctrlKey || e.metaKey) && key === 'c';
      const isPaste = (e.ctrlKey || e.metaKey) && key === 'v';

      if (isCopy) {
        e.preventDefault();
        this.copySelectedObjects();
        return;
      }

      if (isPaste) {
        if (this.clipboard?.objects?.length) {
          e.preventDefault();
          this.pasteClipboardObjects();
        }
        return;
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && this.fabricCanvas) {
        const activeObjects = this.fabricCanvas.getActiveObjects();
        console.log(`[Delete] Key pressed, found ${activeObjects.length} active objects`);
        console.log(`[Delete] canvas.selection = ${this.fabricCanvas.selection}`);

        if (activeObjects.length > 0) {
          e.preventDefault();
          activeObjects.forEach(obj => {
            // Clean up stroke metadata before removing from canvas
            if (obj.strokeMetadata) {
              const strokeLabel = obj.strokeMetadata.strokeLabel;
              const imageLabel = obj.strokeMetadata.imageLabel;

              if (window.app?.metadataManager) {
                const metadata = window.app.metadataManager;

                if (obj.strokeMetadata.type === 'shape') {
                  metadata.removeShapeMetadata(obj);
                } else if (obj.strokeMetadata.type === 'text') {
                  const textElements = metadata.textElementsByImage[imageLabel] || [];
                  const index = textElements.indexOf(obj);
                  if (index > -1) {
                    textElements.splice(index, 1);
                  }
                } else if (strokeLabel) {
                  if (metadata.vectorStrokesByImage[imageLabel]) {
                    delete metadata.vectorStrokesByImage[imageLabel][strokeLabel];
                  }
                  if (metadata.strokeVisibilityByImage[imageLabel]) {
                    delete metadata.strokeVisibilityByImage[imageLabel][strokeLabel];
                  }
                  if (metadata.strokeLabelVisibility[imageLabel]) {
                    delete metadata.strokeLabelVisibility[imageLabel][strokeLabel];
                  }
                  if (metadata.strokeMeasurements[imageLabel]) {
                    delete metadata.strokeMeasurements[imageLabel][strokeLabel];
                  }
                }
              }

              // Remove tag
              if (window.app?.tagManager && strokeLabel) {
                window.app.tagManager.removeTag(
                  strokeLabel,
                  imageLabel || window.currentImageLabel
                );
              }
            }

            this.fabricCanvas.remove(obj);
          });
          this.fabricCanvas.discardActiveObject();
          this.fabricCanvas.requestRenderAll();

          // Update visibility panel after metadata cleanup
          if (window.app?.metadataManager) {
            window.app.metadataManager.updateStrokeVisibilityControls();
          }

          // Update next tag display to fill gaps (after metadata cleanup)
          setTimeout(() => {
            if (window.updateNextTagDisplay) {
              window.updateNextTagDisplay();
            }
          }, 10);

          // Trigger history save
          if (window.app && window.app.historyManager) {
            window.app.historyManager.saveState();
          }
        }
      }
    });
  }

  copySelectedObjects() {
    if (!this.fabricCanvas) return;
    const activeObjects = this.fabricCanvas.getActiveObjects();
    if (!activeObjects || activeObjects.length === 0) return;

    const exportable = activeObjects.filter(
      obj => !obj?.excludeFromExport && !obj?.isTag && !obj?.isConnectorLine
    );
    if (exportable.length === 0) return;

    const customProps = ['strokeMetadata', 'isArrow', 'customPoints', 'tagOffset', 'arrowSettings'];
    const serialized = exportable.map(obj => obj.toObject(customProps));

    this.clipboard = {
      objects: serialized,
      timestamp: Date.now(),
    };
    this.clipboardPasteCount = 0;
    console.log(`[Copy] Stored ${serialized.length} objects in clipboard`);
  }

  pasteClipboardObjects() {
    if (!this.fabricCanvas || !this.clipboard?.objects?.length) return;

    const imageLabel = window.app?.projectManager?.currentViewId || window.currentImageLabel;
    const offset = 12 * (this.clipboardPasteCount + 1);
    this.clipboardPasteCount += 1;
    const payload = JSON.parse(JSON.stringify(this.clipboard.objects));

    fabric.util.enlivenObjects(payload, objects => {
      const pastedObjects = [];
      objects.forEach(obj => {
        if (!obj) return;
        obj.set({
          left: (obj.left || 0) + offset,
          top: (obj.top || 0) + offset,
        });
        if (typeof obj.setCoords === 'function') {
          obj.setCoords();
        }
        this.fabricCanvas.add(obj);
        this.attachMetadataForPaste(obj, imageLabel);
        pastedObjects.push(obj);
      });

      if (pastedObjects.length === 1) {
        this.fabricCanvas.setActiveObject(pastedObjects[0]);
      } else if (pastedObjects.length > 1) {
        const selection = new fabric.ActiveSelection(pastedObjects, {
          canvas: this.fabricCanvas,
        });
        this.fabricCanvas.setActiveObject(selection);
      }

      this.fabricCanvas.requestRenderAll();
      if (window.app?.metadataManager?.updateStrokeVisibilityControls) {
        window.app.metadataManager.updateStrokeVisibilityControls();
      }
      if (window.app?.historyManager) {
        window.app.historyManager.saveState();
      }
    });
  }

  attachMetadataForPaste(obj, imageLabel) {
    const metadataManager = window.app?.metadataManager;
    if (!metadataManager || !obj) return;

    const meta = obj.strokeMetadata || {};

    if (meta.type === 'text' || obj.type === 'i-text' || obj.type === 'text') {
      metadataManager.attachTextMetadata(obj, imageLabel);
      obj.on('editing:exited', () => {
        if (window.app?.historyManager) {
          window.app.historyManager.saveState();
        }
      });
      return;
    }

    if (meta.type === 'shape') {
      metadataManager.attachShapeMetadata(obj, imageLabel, meta.shapeType || 'shape');
      return;
    }

    const strokeLabel = metadataManager.getNextLabel(imageLabel);
    metadataManager.attachMetadata(obj, imageLabel, strokeLabel);
    if (window.app?.tagManager) {
      window.app.tagManager.createTagForStroke(strokeLabel, imageLabel, obj);
    }

    if (obj.type === 'line') {
      FabricControls.createLineControls(obj);
    } else if (obj.type === 'path' && meta.type !== 'shape') {
      FabricControls.createCurveControls(obj);
    } else if (obj.type === 'group' && (obj.isArrow || meta.isArrow)) {
      FabricControls.createArrowControls(obj);
    }

    if (obj.arrowSettings && window.app?.arrowManager) {
      window.app.arrowManager.attachArrowRendering(obj);
      obj.dirty = true;
    }
  }

  /**
   * Calculate available canvas size (works before fabricCanvas is initialized)
   * Now simplified to use the flex layout container dimensions directly
   */
  calculateAvailableSize() {
    // With the new flex layout, canvas is inside #main-canvas-wrapper
    // Just measure that container's dimensions
    const canvasContainer = document.getElementById('main-canvas-wrapper');

    if (canvasContainer) {
      // Use clientWidth/clientHeight to get the inner dimension (excluding borders)
      // This prevents the canvas from growing slightly larger than the container due to border inclusion
      let width = canvasContainer.clientWidth;
      const height = canvasContainer.clientHeight;

      // Standard behavior: Canvas fills the container exactly.
      // No experimental offsets.

      // console.log(`[CanvasManager] calculateAvailableSize: Container found. Size: ${width}x${height}`);
      return {
        width: Math.max(300, width),
        height: Math.max(200, height),
      };
    }

    // Fallback to old logic if container doesn't exist yet
    const margin = 16;
    const width = window.innerWidth - margin * 2;
    const height = window.innerHeight - 100; // Toolbar + margin

    return {
      width: Math.max(300, width),
      height: Math.max(200, height),
    };
  }

  /**
   * Show resize overlay to maintain visual continuity during canvas resize
   */
  showResizeOverlay(targetWidth, targetHeight) {
    const canvasEl = this.fabricCanvas?.lowerCanvasEl;
    if (!canvasEl || !canvasEl.parentElement) return;

    const canvasRect = canvasEl.getBoundingClientRect();

    if (!this.resizeOverlayCanvas) {
      this.resizeOverlayCanvas = document.createElement('canvas');
      this.resizeOverlayCanvas.style.pointerEvents = 'none';
      this.resizeOverlayCanvas.style.position = 'absolute';
      const zIndex = parseInt(window.getComputedStyle(canvasEl).zIndex || '0', 10) || 0;
      this.resizeOverlayCanvas.style.zIndex = String(zIndex + 1);
      canvasEl.parentElement.appendChild(this.resizeOverlayCanvas);
    }

    const parentRect = canvasEl.parentElement.getBoundingClientRect();
    this.resizeOverlayCanvas.style.left = `${canvasRect.left - parentRect.left}px`;
    this.resizeOverlayCanvas.style.top = `${canvasRect.top - parentRect.top}px`;

    this.resizeOverlayCanvas.width = Math.max(1, Math.floor(canvasRect.width));
    this.resizeOverlayCanvas.height = Math.max(1, Math.floor(canvasRect.height));

    const overlayCtx = this.resizeOverlayCanvas.getContext('2d');
    overlayCtx.clearRect(0, 0, this.resizeOverlayCanvas.width, this.resizeOverlayCanvas.height);
    try {
      overlayCtx.drawImage(
        canvasEl,
        0,
        0,
        this.resizeOverlayCanvas.width,
        this.resizeOverlayCanvas.height
      );
    } catch (_) {
      // Ignore drawImage failures (e.g., tainted canvas)
    }

    this.resizeOverlayCanvas.style.width = `${targetWidth}px`;
    this.resizeOverlayCanvas.style.height = `${targetHeight}px`;
  }

  /**
   * Hide resize overlay after redraw completes
   */
  hideResizeOverlay() {
    if (this.resizeOverlayCleanupId) {
      cancelAnimationFrame(this.resizeOverlayCleanupId);
    }

    this.resizeOverlayCleanupId = requestAnimationFrame(() => {
      this.resizeOverlayCleanupId = null;
      if (this.resizeOverlayCanvas && this.resizeOverlayCanvas.parentElement) {
        this.resizeOverlayCanvas.parentElement.removeChild(this.resizeOverlayCanvas);
      }
      this.resizeOverlayCanvas = null;
    });
  }

  /**
   * Calculate available canvas size considering sidebars and panels
   * (Wrapper for calculateAvailableSize for consistency)
   */
  getAvailableCanvasSize() {
    return this.calculateAvailableSize();
  }

  /**
   * Calculate target frame size based on canvas dimensions
   * Centralized logic to ensure consistency between image scaling and frame resizing
   */
  calculateTargetFrameSize(canvasWidth, canvasHeight) {
    const currentImageLabel = window.app?.projectManager?.currentViewId || 'default';
    const savedRatios = window.manualFrameRatios && window.manualFrameRatios[currentImageLabel];

    if (savedRatios) {
      // Frame was manually resized - apply saved ratios
      const frameWidth = canvasWidth * savedRatios.widthRatio;
      const frameHeight = canvasHeight * savedRatios.heightRatio;
      const frameLeft = canvasWidth * savedRatios.leftRatio;
      const frameTop = canvasHeight * savedRatios.topRatio;

      // Ensure frame stays within canvas bounds
      const maxLeft = Math.max(0, canvasWidth - frameWidth);
      const maxTop = Math.max(0, canvasHeight - frameHeight);
      const boundedLeft = Math.max(0, Math.min(maxLeft, frameLeft));
      const boundedTop = Math.max(0, Math.min(maxTop, frameTop));

      return {
        width: frameWidth,
        height: frameHeight,
        left: boundedLeft,
        top: boundedTop,
      };
    } else {
      // Default: Frame is 85% of canvas size, capped at 800x600, with a minimum of 400x300
      let frameWidth = Math.max(400, Math.min(800, Math.floor(canvasWidth * 0.85)));
      let frameHeight = Math.max(300, Math.min(600, Math.floor(canvasHeight * 0.85)));

      // Maintain 4:3 aspect ratio
      const aspectRatio = 4 / 3;
      if (frameWidth / frameHeight > aspectRatio) {
        frameWidth = Math.floor(frameHeight * aspectRatio);
      } else {
        frameHeight = Math.floor(frameWidth / aspectRatio);
      }

      // Center the frame on the canvas
      let frameLeft = (canvasWidth - frameWidth) / 2;
      let frameTop = (canvasHeight - frameHeight) / 2;

      // Clamp frame to stay fully inside canvas bounds
      frameWidth = Math.min(frameWidth, canvasWidth);
      frameHeight = Math.min(frameHeight, canvasHeight);
      frameLeft = Math.max(0, Math.min(frameLeft, canvasWidth - frameWidth));
      frameTop = Math.max(0, Math.min(frameTop, canvasHeight - frameHeight));

      return {
        width: frameWidth,
        height: frameHeight,
        left: frameLeft,
        top: frameTop,
      };
    }
  }

  /**
   * Update capture frame position and size during resize
   */
  updateCaptureFrameOnResize(targetWidth, targetHeight) {
    const captureFrame = document.getElementById('captureFrame');
    if (!captureFrame) {
      console.log('[Frame Debug] No capture frame element found');
      return;
    }

    const currentImageLabel = window.app?.projectManager?.currentViewId || 'default';

    // If no image label OR no background image, we're dealing with stroke-only canvas
    // We must check backgroundImage because sometimes we have a viewId but no image (e.g. cleared or template)
    const isStrokeOnlyCanvas =
      !window.app?.projectManager?.currentViewId ||
      (this.fabricCanvas && !this.fabricCanvas.backgroundImage);

    // IMPORTANT: In stroke-only mode, we use zoom-based resizing
    // The capture frame should NOT be resized manually - it will scale with the zoom
    // Skip manual resizing to prevent double-scaling effect
    if (isStrokeOnlyCanvas) {
      console.log(
        '[CanvasManager] Skipping frame resize in zoom mode - frame will scale with canvas zoom'
      );
      return;
    }

    // Check if manual ratios are saved for this image
    const targetFrame = this.calculateTargetFrameSize(targetWidth, targetHeight);

    captureFrame.style.width = `${targetFrame.width}px`;
    captureFrame.style.height = `${targetFrame.height}px`;
    captureFrame.style.left = `${targetFrame.left}px`;
    captureFrame.style.top = `${targetFrame.top}px`;
  }

  /**
   * Public resize method called by main app
   */
  resize() {
    console.log('[CanvasManager] resize() called');
    const { width, height } = this.calculateAvailableSize();
    console.log(`[CanvasManager] Calculated available size: ${width}x${height}`);
    this.applyResize(width, height);
  }

  /**
   * Apply resize with debouncing and smooth transitions
   */
  applyResize(width, height) {
    if (!this.fabricCanvas) {
      return;
    }

    // Use provided dimensions or fall back to pending (legacy support)
    const targetWidth = width !== undefined ? width : this.pendingResizeWidth;
    const targetHeight = height !== undefined ? height : this.pendingResizeHeight;

    if (targetWidth === null || targetHeight === null) {
      return;
    }

    this.isResizing = true;

    // CAPTURE OLD ZOOM AND VIEWPORT TRANSFORM BEFORE RESIZE
    // setWidth/setHeight might reset the viewport transform/zoom in some Fabric versions/configs
    // We need the accurate old zoom to calculate the virtual frame size later
    const oldZoom = this.fabricCanvas ? this.fabricCanvas.getZoom() || 1 : 1;
    const oldVpt = this.fabricCanvas
      ? [...(this.fabricCanvas.viewportTransform || [1, 0, 0, 1, 0, 0])]
      : [1, 0, 0, 1, 0, 0];
    // console.log(`[CanvasManager] applyResize started. Old Zoom: ${oldZoom}, Old Pan: [${oldVpt[4]}, ${oldVpt[5]}]`);

    const sizeChanged =
      this.lastCanvasSize.width !== targetWidth || this.lastCanvasSize.height !== targetHeight;

    // CRITICAL FIX: If originalCanvasSize looks suspicious (e.g. full screen width when panels should exist),
    // or if this is the first real resize after layout settlement, update it.
    // This ensures centering logic uses the correct "base" size.
    if (this.originalCanvasSize) {
      const isStrokeOnly = !this.fabricCanvas.backgroundImage;
      const currentWindowWidth = window.innerWidth;
      const windowWidthDiff = Math.abs(
        currentWindowWidth - (this.lastWindowWidth || currentWindowWidth)
      );

      // If we are in stroke-only mode and the width changed significantly (e.g. > 50px),
      // AND the window width is relatively stable (meaning it's a layout shift, not a window resize),
      // We should treat this new size as the "original" size for centering purposes IF zoom is 1.
      // REMOVED REDUNDANT LAYOUT SHIFT LOGIC
      // The responsive sizing logic below (zoom >= 1) now handles this correctly for both
      // window resizing and layout shifts, without causing jitter during shrinking.

      this.lastWindowWidth = currentWindowWidth;
    }

    // Get background image info if available
    const bgImage = this.fabricCanvas.backgroundImage;

    // Show overlay before resize for smooth transition
    if (sizeChanged) {
      this.showResizeOverlay(targetWidth, targetHeight);
    }

    // Update Fabric.js canvas dimensions
    this.fabricCanvas.setWidth(targetWidth);
    this.fabricCanvas.setHeight(targetHeight);

    // CRITICAL FIX: Remove all CSS constraints that cause canvas stretching/shrinking issues
    // These style overrides ensure the canvas displays at its actual size, not hardcoded sizes
    const canvasEl = this.fabricCanvas.lowerCanvasEl;
    if (canvasEl) {
      canvasEl.style.minWidth = 'unset';
      canvasEl.style.minHeight = 'unset';
      canvasEl.style.maxWidth = 'unset';
      canvasEl.style.maxHeight = 'unset';
      // Clear any hardcoded width/height from HTML that prevents dynamic sizing
      canvasEl.style.width = `${targetWidth}px`;
      canvasEl.style.height = `${targetHeight}px`;
    }
    const upperCanvasEl = this.fabricCanvas.upperCanvasEl;
    if (upperCanvasEl) {
      upperCanvasEl.style.minWidth = 'unset';
      upperCanvasEl.style.minHeight = 'unset';
      upperCanvasEl.style.maxWidth = 'unset';
      upperCanvasEl.style.maxHeight = 'unset';
      // Clear any hardcoded width/height from HTML that prevents dynamic sizing
      upperCanvasEl.style.width = `${targetWidth}px`;
      upperCanvasEl.style.height = `${targetHeight}px`;
    }

    // Also clear styles on the original canvas element to remove hardcoded dimensions from HTML
    const originalCanvasEl = document.getElementById(this.canvasId);
    if (originalCanvasEl) {
      originalCanvasEl.style.width = `${targetWidth}px`;
      originalCanvasEl.style.height = `${targetHeight}px`;
    }

    // Store old size for stroke scaling calculations BEFORE updating
    const oldCanvasWidth = this.lastCanvasSize.width;
    const oldCanvasHeight = this.lastCanvasSize.height;

    // Update last known size
    this.lastCanvasSize = { width: targetWidth, height: targetHeight };

    // UNIFIED RESIZING LOGIC:
    // We now use the zoom-based resizing (floating layout) for BOTH empty canvas and images.
    // This ensures consistent behavior where the content (image or strokes) stays centered
    // and scales to fit the window, preserving the "floating paper" effect.

    if (sizeChanged) {
      // Apply simple proportional scaling / zoom logic
      console.log(
        `[CanvasManager] Canvas resize: ${oldCanvasWidth}x${oldCanvasHeight} -> ${targetWidth}x${targetHeight}`
      );

      // Scale from original positions to prevent accumulation
      if (oldCanvasWidth > 0 && oldCanvasHeight > 0) {
        // Initialize original canvas size and object states if not set
        if (this.originalCanvasSize.width === 0) {
          this.originalCanvasSize = { width: oldCanvasWidth, height: oldCanvasHeight };

          this.fabricCanvas.getObjects().forEach(obj => {
            if (!this.originalObjectStates.has(obj)) {
              this.originalObjectStates.set(obj, {
                left: obj.left,
                top: obj.top,
                scaleX: obj.scaleX || 1,
                scaleY: obj.scaleY || 1,
                strokeWidth: obj.strokeWidth || 1,
              });
            }
          });
        }

        // Calculate scale factors from ORIGINAL canvas size
        const scaleX = targetWidth / this.originalCanvasSize.width;
        const scaleY = targetHeight / this.originalCanvasSize.height;

        // Guard against NaN values from invalid dimensions during window drag
        if (
          Number.isNaN(scaleX) ||
          Number.isNaN(scaleY) ||
          !isFinite(scaleX) ||
          !isFinite(scaleY)
        ) {
          console.warn(
            `[CanvasManager] Invalid scale factors: ${scaleX}, ${scaleY} - aborting resize`
          );
          this.updateCaptureFrameOnResize(targetWidth, targetHeight);
          this.isResizing = false;
          return;
        }

        // ZOOM-BASED RESIZING: Use Fabric's zoom instead of scaling objects
        // Calculate zoom to fit the original canvas size into the new window size
        let zoom = Math.min(scaleX, scaleY);

        // RESPONSIVE FIX: If we have enough space to show the original canvas at 100% (zoom >= 1),
        // we should EXPAND the "original" canvas size to fill the new space.
        // This prevents "grey bars" when the window grows larger than the initial load size.
        // We only shrink (zoom < 1) if the window is smaller than the content.
        if (zoom >= 1) {
          console.log(
            `[CanvasManager] Expanding originalCanvasSize to fill available space (Zoom >= 1)`
          );
          this.originalCanvasSize = { width: targetWidth, height: targetHeight };
          zoom = 1;

          // RECENTERING FIX: When expanding, we want the frame to stay centered in the new larger space.
          // We update the base state's position mathematically (smoothly) to match the new center.
          if (this.baseFrameState) {
            this.baseFrameState.left = (targetWidth - this.baseFrameState.width) / 2;
            this.baseFrameState.top = (targetHeight - this.baseFrameState.height) / 2;
          }
          // this.baseFrameState = null;
        }

        console.log(
          `[CanvasManager] Applying zoom-based resize: zoom=${zoom.toFixed(3)} (canvas: ${targetWidth}x${targetHeight})`
        );

        // ITERATIVE FRAME SCALING:
        // Calculate virtual frame size based on OLD zoom, then apply NEW zoom
        // This preserves manual frame resizing while keeping it in sync with zoom
        const captureFrame = document.getElementById('captureFrame');
        if (captureFrame) {
          // Use the oldZoom captured at the start of the function

          // Use getComputedStyle to handle 'calc' values in initial HTML
          const computedStyle = window.getComputedStyle(captureFrame);
          const currentFrameWidth =
            parseFloat(captureFrame.style.width) || parseFloat(computedStyle.width) || 800;
          const currentFrameHeight =
            parseFloat(captureFrame.style.height) || parseFloat(computedStyle.height) || 600;
          const currentFrameLeft =
            parseFloat(captureFrame.style.left) || parseFloat(computedStyle.left) || 0;
          const currentFrameTop =
            parseFloat(captureFrame.style.top) || parseFloat(computedStyle.top) || 0;

          // Use the oldVpt captured at the start of the function
          const oldPanX = oldVpt[4];
          const oldPanY = oldVpt[5];

          // Initialize base state if missing (first run or after reload)
          let shouldUpdateBaseState = !this.baseFrameState;

          let virtualWidth, virtualHeight, virtualLeft, virtualTop;

          if (shouldUpdateBaseState) {
            // Calculate from DOM only on first run
            virtualWidth = currentFrameWidth / oldZoom;
            virtualHeight = currentFrameHeight / oldZoom;
            virtualLeft = (currentFrameLeft - oldPanX) / oldZoom;
            virtualTop = (currentFrameTop - oldPanY) / oldZoom;

            // CRITICAL FIX: In stroke-only mode, ignore the current DOM position (which might be off-center due to layout shifts)
            // and FORCE the base state to be centered in the original canvas.
            const isStrokeOnly = !this.fabricCanvas.backgroundImage;

            if (isStrokeOnly && this.originalCanvasSize && this.originalCanvasSize.width > 0) {
              console.log('[CanvasManager] Enforcing centered baseFrameState for stroke-only mode');
              // Use standard 800x600 if DOM values seem weird (e.g. too small)
              if (virtualWidth < 100) virtualWidth = 800;
              if (virtualHeight < 100) virtualHeight = 600;

              virtualLeft = (this.originalCanvasSize.width - virtualWidth) / 2;
              virtualTop = (this.originalCanvasSize.height - virtualHeight) / 2;
            }

            this.baseFrameState = {
              width: virtualWidth,
              height: virtualHeight,
              left: virtualLeft,
              top: virtualTop,
            };
            console.log('[CanvasManager] Initialized baseFrameState:', this.baseFrameState);
          } else {
            // Use stored base state to prevent drift - Single Source of Truth
            // We ignore the current DOM state because it might be polluted by layout shifts or transitions
            virtualWidth = this.baseFrameState.width;
            virtualHeight = this.baseFrameState.height;
            virtualLeft = this.baseFrameState.left;
            virtualTop = this.baseFrameState.top;
          }

          // Calculate new centering offsets (will be applied to viewport)
          const scaledOriginalWidth = this.originalCanvasSize.width * zoom;
          const scaledOriginalHeight = this.originalCanvasSize.height * zoom;

          // Standard centering relative to the container
          const centerOffsetX = (targetWidth - scaledOriginalWidth) / 2;
          const centerOffsetY = (targetHeight - scaledOriginalHeight) / 2;

          // Apply new zoom and offset to frame
          const newFrameWidth = virtualWidth * zoom;
          const newFrameHeight = virtualHeight * zoom;
          const newFrameLeft = virtualLeft * zoom + centerOffsetX;
          const newFrameTop = virtualTop * zoom + centerOffsetY;

          captureFrame.style.width = `${newFrameWidth}px`;
          captureFrame.style.height = `${newFrameHeight}px`;
          captureFrame.style.left = `${newFrameLeft}px`;
          captureFrame.style.top = `${newFrameTop}px`;

          console.log(
            `[CanvasManager] Scaled frame: ${currentFrameWidth.toFixed(0)}->${newFrameWidth.toFixed(0)} (zoom: ${oldZoom.toFixed(2)}->${zoom.toFixed(2)})`
          );
        }

        // Calculate centering offsets to keep content centered
        const scaledOriginalWidth = this.originalCanvasSize.width * zoom;
        const scaledOriginalHeight = this.originalCanvasSize.height * zoom;

        // Standard centering relative to the container
        const centerOffsetX = (targetWidth - scaledOriginalWidth) / 2;
        const centerOffsetY = (targetHeight - scaledOriginalHeight) / 2;

        console.log(
          `[CanvasManager] Centering: Target=${targetWidth}x${targetHeight}, Scaled=${scaledOriginalWidth.toFixed(1)}x${scaledOriginalHeight.toFixed(1)}, Offset=${centerOffsetX.toFixed(1)},${centerOffsetY.toFixed(1)}, Zoom=${zoom.toFixed(3)}`
        );

        // Apply zoom and centering while preserving rotation
        this.zoomLevel = zoom;
        this.panX = centerOffsetX;
        this.panY = centerOffsetY;
        this.applyViewportTransform();
      }

      // We do NOT call updateCaptureFrameOnResize here because the zoom logic above
      // already updated the frame style to match the zoom.
      // Calling it would overwrite the correct frame with the default "85% of window" frame.
    }

    // Redraw canvas
    this.fabricCanvas.renderAll();

    // Hide overlay after redraw
    if (sizeChanged) {
      this.hideResizeOverlay();
    }

    // Clear pending resize
    this.pendingResizeWidth = null;
    this.pendingResizeHeight = null;
    this.isResizing = false;
  }

  /**
   * Set a manual zoom level (e.g. 1.0 for 100%, 2.0 for 200%)
   * Pass 'fit' or null to return to auto-fit mode.
   */
  setManualZoom(zoomLevel) {
    if (zoomLevel === 'fit' || zoomLevel === null) {
      this.manualZoomLevel = null;
    } else {
      this.manualZoomLevel = parseFloat(zoomLevel);
    }
    console.log(`[CanvasManager] Manual zoom set to: ${this.manualZoomLevel}`);
    this.resize();
  }

  /**
   * Debounced resize method - queues resize with setTimeout
   */
  resize() {
    if (!this.fabricCanvas) {
      return;
    }

    const { width, height } = this.getAvailableCanvasSize();

    // REMOVED THRESHOLD: We want smooth resizing, so we process even small changes.
    // REMOVED DEBOUNCE: ResizeObserver already debounces calls to this method (50ms).
    // Adding another debounce here (150ms) caused the "last moment" update behavior
    // because the timer kept getting reset during continuous drags.

    // Use requestAnimationFrame to ensure we don't thrash the layout loop
    requestAnimationFrame(() => {
      this.applyResize(width, height);
    });
  }

  initZoomPan() {
    if (!this.fabricCanvas) return;

    this.fabricCanvas.on('mouse:wheel', opt => {
      const delta = opt.e.deltaY;
      let zoom = this.zoomLevel || this.fabricCanvas.getZoom();
      zoom *= 0.999 ** delta;
      if (zoom > 20) zoom = 20;
      if (zoom < 0.01) zoom = 0.01;

      this.fabricCanvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
      this.zoomLevel = zoom;
      // Compute panX/panY so that applyViewportTransform would reproduce this same transform
      // applyViewportTransform adds centerX*(1-zoom) to panX, so we subtract it here
      if (this.fabricCanvas.viewportTransform) {
        const vpt = this.fabricCanvas.viewportTransform;
        let centerX = this.fabricCanvas.width / 2;
        let centerY = this.fabricCanvas.height / 2;
        const bgImage = this.fabricCanvas.backgroundImage;
        if (bgImage && typeof bgImage.getCenterPoint === 'function') {
          const bgCenter = bgImage.getCenterPoint();
          if (typeof bgCenter?.x === 'number' && typeof bgCenter?.y === 'number') {
            centerX = bgCenter.x;
            centerY = bgCenter.y;
          }
        }
        this.panX = vpt[4] - centerX * (1 - zoom);
        this.panY = vpt[5] - centerY * (1 - zoom);
      }
      opt.e.preventDefault();
      opt.e.stopPropagation();
    });

    // Panning logic: Alt+Drag, Shift+Drag, or two-finger touch
    let isDragging = false;
    let lastPosX;
    let lastPosY;

    // Touch gesture state
    let touchGestureState = {
      isTwoFingerPan: false,
      isPinchZoom: false,
      lastTwoFingerCenter: null,
      lastTwoFingerDistance: null,
      activeTouches: new Map(),
    };

    this.fabricCanvas.on('mouse:down', opt => {
      const evt = opt.e;
      if (evt.altKey === true || evt.shiftKey === true) {
        console.log('[PAN] Starting pan gesture with', evt.altKey ? 'Alt' : 'Shift');
        this.fabricCanvas.isDrawingMode = false; // Temporarily disable drawing
        isDragging = true;
        this.fabricCanvas.selection = false;
        lastPosX = evt.clientX;
        lastPosY = evt.clientY;

        // Set grabbing cursor
        this.fabricCanvas.upperCanvasEl.style.cursor = 'grabbing';
      }
    });

    this.fabricCanvas.on('mouse:move', opt => {
      if (isDragging) {
        const e = opt.e;
        this.panX += e.clientX - lastPosX;
        this.panY += e.clientY - lastPosY;
        this.applyViewportTransform();
        lastPosX = e.clientX;
        lastPosY = e.clientY;
      }
    });

    this.fabricCanvas.on('mouse:up', opt => {
      if (isDragging) {
        console.log('[PAN] Ending pan gesture');
        this.applyViewportTransform();
        isDragging = false;
        this.fabricCanvas.selection = true;

        // Restore cursor based on current shift state
        const evt = opt.e;
        if (evt.shiftKey) {
          this.fabricCanvas.upperCanvasEl.style.cursor = 'grab';
        } else {
          this.fabricCanvas.upperCanvasEl.style.cursor = 'default';
        }

        // Restore drawing mode state if needed (ToolManager should handle this ideally)
      }
    });

    // Update tag connectors when strokes are moved (including multi-select)
    // Note: Tags are non-selectable, so only strokes trigger this handler
    this.fabricCanvas.on('object:moving', e => {
      const movingObj = e.target;

      const getWorldCenter = obj => {
        const center = obj.getCenterPoint();
        return { x: center.x, y: center.y };
      };

      const applyCurveTranslation = (obj, dx, dy) => {
        if (!obj || obj.type !== 'path' || !Array.isArray(obj.customPoints)) return;

        // IMPORTANT: Skip if we're editing a control point - the control point handler updates customPoints directly
        if (obj.isEditingControlPoint) {
          return;
        }

        const transform = obj.canvas?._currentTransform;
        const isNonDragTransform = transform && transform.action && transform.action !== 'drag';
        if (obj.__curveTransformActive || obj.__curveJustBaked || isNonDragTransform) {
          return;
        }

        if (dx === 0 && dy === 0) {
          return;
        }

        obj.customPoints.forEach(point => {
          point.x += dx;
          point.y += dy;
        });
        obj.__lastCenter = obj.__lastCenter
          ? { x: obj.__lastCenter.x + dx, y: obj.__lastCenter.y + dy }
          : getWorldCenter(obj);
      };

      const updateCurveTranslationFromSelf = obj => {
        // IMPORTANT: Skip if we're editing a control point
        if (obj.isEditingControlPoint) {
          return;
        }

        const transform = obj.canvas?._currentTransform;
        const isNonDragTransform = transform && transform.action && transform.action !== 'drag';
        if (obj.__curveTransformActive || obj.__curveJustBaked || isNonDragTransform) {
          return;
        }
        if (obj.group && obj.group.type === 'activeSelection') {
          return;
        }

        const currentCenter = getWorldCenter(obj);
        const lastCenter = obj.__lastCenter || currentCenter;
        const dx = currentCenter.x - lastCenter.x;
        const dy = currentCenter.y - lastCenter.y;

        applyCurveTranslation(obj, dx, dy);
        obj.__lastCenter = currentCenter;
      };

      if (!window.app?.tagManager) return;

      // Handle both single objects and multi-selections (activeSelection)
      if (movingObj.type === 'activeSelection') {
        // Multiple strokes are selected and being moved
        const objects = movingObj.getObjects();
        const tagManager = window.app.tagManager;

        const currentCenter = getWorldCenter(movingObj);
        const lastCenter = movingObj.__lastCenter || currentCenter;
        const dx = currentCenter.x - lastCenter.x;
        const dy = currentCenter.y - lastCenter.y;
        movingObj.__lastCenter = currentCenter;

        // Update connectors for all strokes in the selection
        objects.forEach(obj => {
          applyCurveTranslation(obj, dx, dy);
          // Handle lines, paths (curves), and groups (arrows), but skip tags
          if ((obj.type === 'line' || obj.type === 'path' || obj.type === 'group') && !obj.isTag) {
            // Find the tag associated with this stroke
            for (const [strokeLabel, tagObj] of tagManager.tagObjects.entries()) {
              if (tagObj.connectedStroke === obj) {
                tagManager.updateConnector(tagObj.strokeLabel || strokeLabel, tagObj.imageLabel);
                break;
              }
            }
          }
        });
      } else if (
        (movingObj.type === 'line' || movingObj.type === 'path' || movingObj.type === 'group') &&
        !movingObj.isTag
      ) {
        if (movingObj.type === 'path') {
          updateCurveTranslationFromSelf(movingObj);
        }
        // Single stroke being moved - find and update its tag's connector
        const tagManager = window.app.tagManager;
        for (const [strokeLabel, tagObj] of tagManager.tagObjects.entries()) {
          if (tagObj.connectedStroke === movingObj) {
            tagManager.updateConnector(tagObj.strokeLabel || strokeLabel, tagObj.imageLabel);
            break;
          }
        }
      }

      // Request render to ensure connectors and tags display correctly
      this.fabricCanvas.requestRenderAll();
    });

    const updateTagConnectorsForScaling = scalingObj => {
      if (!window.app?.tagManager || !scalingObj) return;
      const tagManager = window.app.tagManager;

      const updateForStroke = obj => {
        if ((obj.type === 'line' || obj.type === 'path' || obj.type === 'group') && !obj.isTag) {
          for (const [strokeLabel, tagObj] of tagManager.tagObjects.entries()) {
            if (tagObj.connectedStroke === obj) {
              tagManager.updateConnector(tagObj.strokeLabel || strokeLabel, tagObj.imageLabel);
              break;
            }
          }
        }
      };

      if (scalingObj.type === 'activeSelection') {
        scalingObj.getObjects().forEach(updateForStroke);
      } else {
        updateForStroke(scalingObj);
      }
    };

    // Update tag connectors while scaling for smoother feedback.
    this.fabricCanvas.on('object:scaling', e => {
      const scalingObj = e.target;
      if (!scalingObj) return;
      this.__tagScaleActive = true;
      this.__tagScaleTarget = scalingObj;
      updateTagConnectorsForScaling(scalingObj);
    });

    // Keep connectors in sync on each render tick while scaling.
    this.fabricCanvas.on('after:render', () => {
      if (!this.__tagScaleActive || !this.__tagScaleTarget) return;
      updateTagConnectorsForScaling(this.__tagScaleTarget);
    });

    const clearScaleTracking = () => {
      this.__tagScaleActive = false;
      this.__tagScaleTarget = null;
    };

    this.fabricCanvas.on('object:scaled', clearScaleTracking);
    this.fabricCanvas.on('mouse:up', clearScaleTracking);

    // Touch gesture helpers
    const getTwoFingerCenter = touches => {
      if (touches.length < 2) return null;
      const touch1 = touches[0];
      const touch2 = touches[1];
      return {
        x: (touch1.clientX + touch2.clientX) / 2,
        y: (touch1.clientY + touch2.clientY) / 2,
      };
    };

    const getTwoFingerDistance = touches => {
      if (touches.length < 2) return null;
      const touch1 = touches[0];
      const touch2 = touches[1];
      const dx = touch1.clientX - touch2.clientX;
      const dy = touch1.clientY - touch2.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    // Touch event handlers for two-finger pan
    const canvasElement = this.fabricCanvas.upperCanvasEl;

    canvasElement.addEventListener(
      'touchstart',
      e => {
        // Update active touches
        for (let i = 0; i < e.touches.length; i++) {
          const touch = e.touches[i];
          touchGestureState.activeTouches.set(touch.identifier, {
            x: touch.clientX,
            y: touch.clientY,
          });
        }

        if (e.touches.length === 2) {
          console.log('[GESTURE] Starting two-finger gesture (pan/zoom)');
          // Two finger gesture detected - start both pan and pinch tracking
          touchGestureState.isTwoFingerPan = true;
          touchGestureState.isPinchZoom = true;
          touchGestureState.lastTwoFingerCenter = getTwoFingerCenter(e.touches);
          touchGestureState.lastTwoFingerDistance = getTwoFingerDistance(e.touches);

          // Disable Fabric.js drawing and selection during gesture
          this.fabricCanvas.isDrawingMode = false;
          this.fabricCanvas.selection = false;

          // Set a global flag that tools can check
          this.fabricCanvas.isGestureActive = true;

          e.preventDefault(); // Prevent default two-finger behaviors
        }
      },
      { passive: false }
    );

    canvasElement.addEventListener(
      'touchmove',
      e => {
        if (
          (touchGestureState.isTwoFingerPan || touchGestureState.isPinchZoom) &&
          e.touches.length === 2
        ) {
          const currentCenter = getTwoFingerCenter(e.touches);
          const currentDistance = getTwoFingerDistance(e.touches);

          // Handle pinch-to-zoom
          if (
            touchGestureState.isPinchZoom &&
            touchGestureState.lastTwoFingerDistance &&
            currentDistance
          ) {
            const zoomRatio = currentDistance / touchGestureState.lastTwoFingerDistance;
            let currentZoom = this.zoomLevel || this.fabricCanvas.getZoom();
            let newZoom = currentZoom * zoomRatio;

            // Clamp zoom levels
            if (newZoom > 20) newZoom = 20;
            if (newZoom < 0.01) newZoom = 0.01;

            if (Math.abs(zoomRatio - 1) > 0.01) {
              // Only zoom if significant change
              console.log(
                '[ZOOM] Pinch zoom:',
                zoomRatio - 1 > 0 ? 'in' : 'out',
                'ratio:',
                zoomRatio.toFixed(3)
              );

              // Get canvas-relative coordinates for zoom center
              const canvasEl = this.fabricCanvas.upperCanvasEl;
              const rect = canvasEl.getBoundingClientRect();
              const zoomPoint = {
                x: currentCenter.x - rect.left,
                y: currentCenter.y - rect.top,
              };

              this.fabricCanvas.zoomToPoint(zoomPoint, newZoom);
              this.zoomLevel = newZoom;
              // Compute panX/panY so that applyViewportTransform would reproduce this same transform
              if (this.fabricCanvas.viewportTransform) {
                const vpt = this.fabricCanvas.viewportTransform;
                let centerX = this.fabricCanvas.width / 2;
                let centerY = this.fabricCanvas.height / 2;
                const bgImage = this.fabricCanvas.backgroundImage;
                if (bgImage && typeof bgImage.getCenterPoint === 'function') {
                  const bgCenter = bgImage.getCenterPoint();
                  if (typeof bgCenter?.x === 'number' && typeof bgCenter?.y === 'number') {
                    centerX = bgCenter.x;
                    centerY = bgCenter.y;
                  }
                }
                this.panX = vpt[4] - centerX * (1 - newZoom);
                this.panY = vpt[5] - centerY * (1 - newZoom);
              }
              touchGestureState.lastTwoFingerDistance = currentDistance;
            }
          }

          // Handle two-finger pan (only if not zooming significantly)
          if (
            touchGestureState.isTwoFingerPan &&
            touchGestureState.lastTwoFingerCenter &&
            currentCenter
          ) {
            const deltaX = currentCenter.x - touchGestureState.lastTwoFingerCenter.x;
            const deltaY = currentCenter.y - touchGestureState.lastTwoFingerCenter.y;

            // Only pan if movement is significant and not primarily a zoom gesture
            if (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1) {
              console.log('[PAN] Two-finger pan delta:', deltaX.toFixed(1), deltaY.toFixed(1));

              // Update viewport transform
              this.panX += deltaX;
              this.panY += deltaY;
              this.applyViewportTransform();

              touchGestureState.lastTwoFingerCenter = currentCenter;
            }
          }

          e.preventDefault();
        }
      },
      { passive: false }
    );

    canvasElement.addEventListener(
      'touchend',
      e => {
        // Remove ended touches from active touches
        for (let i = 0; i < e.changedTouches.length; i++) {
          const touch = e.changedTouches[i];
          touchGestureState.activeTouches.delete(touch.identifier);
        }

        // If we were in two-finger mode and now have less than 2 touches, exit gesture mode
        if (
          (touchGestureState.isTwoFingerPan || touchGestureState.isPinchZoom) &&
          e.touches.length < 2
        ) {
          console.log('[GESTURE] Ending two-finger gesture (pan/zoom)');
          touchGestureState.isTwoFingerPan = false;
          touchGestureState.isPinchZoom = false;
          touchGestureState.lastTwoFingerCenter = null;
          touchGestureState.lastTwoFingerDistance = null;

          // Restore Fabric.js state
          this.applyViewportTransform();
          this.fabricCanvas.selection = true;

          // Delay clearing gesture flag to prevent residual drawing events
          setTimeout(() => {
            this.fabricCanvas.isGestureActive = false;
          }, 100);

          // Drawing mode will be restored by ToolManager if needed
        }
      },
      { passive: false }
    );

    canvasElement.addEventListener(
      'touchcancel',
      e => {
        // Reset touch state on cancel
        touchGestureState.activeTouches.clear();
        touchGestureState.isTwoFingerPan = false;
        touchGestureState.isPinchZoom = false;
        touchGestureState.lastTwoFingerCenter = null;
        touchGestureState.lastTwoFingerDistance = null;

        // Restore Fabric.js state
        this.fabricCanvas.selection = true;

        // Delay clearing gesture flag to prevent residual drawing events
        setTimeout(() => {
          this.fabricCanvas.isGestureActive = false;
        }, 100);
      },
      { passive: false }
    );

    // Keyboard event listeners for cursor feedback on shift key
    document.addEventListener('keydown', e => {
      if (e.key === 'Shift' && !isDragging) {
        console.log('[PAN] Shift key pressed - showing grab cursor');
        this.fabricCanvas.upperCanvasEl.style.cursor = 'grab';
      }
    });

    document.addEventListener('keyup', e => {
      if (e.key === 'Shift' && !isDragging) {
        console.log('[PAN] Shift key released - restoring default cursor');
        this.fabricCanvas.upperCanvasEl.style.cursor = 'default';
      }
    });
  }

  clear() {
    this.fabricCanvas.clear();
    this.fabricCanvas.setBackgroundColor(
      '#ffffff',
      this.fabricCanvas.renderAll.bind(this.fabricCanvas)
    );
    this.applyViewportTransform();
  }

  setRotationDegrees(degrees) {
    if (!this.fabricCanvas) return;
    const normalized = ((degrees % 360) + 360) % 360;
    this.rotationDegrees = normalized;
    this.applyViewportTransform();
  }

  rotateBy(deltaDegrees) {
    this.setRotationDegrees(this.rotationDegrees + deltaDegrees);
  }

  getRotationDegrees() {
    return this.rotationDegrees;
  }

  setViewportState({ zoom, panX, panY } = {}) {
    if (typeof zoom === 'number' && !Number.isNaN(zoom)) {
      this.zoomLevel = zoom;
    }
    if (typeof panX === 'number' && !Number.isNaN(panX)) {
      this.panX = panX;
    }
    if (typeof panY === 'number' && !Number.isNaN(panY)) {
      this.panY = panY;
    }
    this.applyViewportTransform();
  }

  getViewportState() {
    return {
      zoom: this.zoomLevel,
      panX: this.panX,
      panY: this.panY,
    };
  }

  applyViewportTransform() {
    if (!this.fabricCanvas) return;

    const zoom = this.zoomLevel || this.fabricCanvas.getZoom() || 1;
    const angleRadians = this.rotateViewport ? (this.rotationDegrees * Math.PI) / 180 : 0;
    const cos = Math.cos(angleRadians);
    const sin = Math.sin(angleRadians);
    let centerX = this.fabricCanvas.width / 2;
    let centerY = this.fabricCanvas.height / 2;
    const backgroundImage = this.fabricCanvas.backgroundImage;
    if (backgroundImage && typeof backgroundImage.getCenterPoint === 'function') {
      const bgCenter = backgroundImage.getCenterPoint();
      if (typeof bgCenter?.x === 'number' && typeof bgCenter?.y === 'number') {
        centerX = bgCenter.x;
        centerY = bgCenter.y;
      }
    } else {
      const center = this.fabricCanvas.getCenter();
      centerX =
        typeof center.left === 'number'
          ? center.left
          : typeof center.x === 'number'
            ? center.x
            : centerX;
      centerY =
        typeof center.top === 'number'
          ? center.top
          : typeof center.y === 'number'
            ? center.y
            : centerY;
    }

    const base = [zoom * cos, zoom * sin, -zoom * sin, zoom * cos, 0, 0];
    const translateToOrigin = [1, 0, 0, 1, -centerX, -centerY];
    const translateBack = [1, 0, 0, 1, centerX, centerY];

    let transform = fabric.util.multiplyTransformMatrices(base, translateToOrigin);
    transform = fabric.util.multiplyTransformMatrices(translateBack, transform);
    transform[4] += this.panX;
    transform[5] += this.panY;

    this.fabricCanvas.setViewportTransform(transform);
    this.fabricCanvas.calcOffset();
    this.fabricCanvas.requestRenderAll();
  }

  getRotationCenter() {
    if (!this.fabricCanvas) {
      return { x: 0, y: 0 };
    }
    let centerX = this.fabricCanvas.width / 2;
    let centerY = this.fabricCanvas.height / 2;
    const backgroundImage = this.fabricCanvas.backgroundImage;
    if (backgroundImage && typeof backgroundImage.getCenterPoint === 'function') {
      const bgCenter = backgroundImage.getCenterPoint();
      if (typeof bgCenter?.x === 'number' && typeof bgCenter?.y === 'number') {
        centerX = bgCenter.x;
        centerY = bgCenter.y;
      }
    }
    return { x: centerX, y: centerY };
  }

  rotateCanvasObjects(deltaDegrees) {
    if (!this.fabricCanvas) return this.rotationDegrees;
    const center = this.getRotationCenter();
    const radians = (deltaDegrees * Math.PI) / 180;
    const tags = [];

    this.fabricCanvas.getObjects().forEach(obj => {
      if (!obj || obj.type === 'activeSelection') return;
      if (obj.isConnectorLine) return;
      if (obj.isTag) {
        tags.push(obj);
        return;
      }
      const objCenter = obj.getCenterPoint();
      const rotatedCenter = fabric.util.rotatePoint(objCenter, center, radians);

      let didResyncPath = false;

      if (obj.type === 'path' && Array.isArray(obj.customPoints)) {
        obj.customPoints.forEach(point => {
          const rotatedPoint = fabric.util.rotatePoint(point, center, radians);
          point.x = rotatedPoint.x;
          point.y = rotatedPoint.y;
        });
        const newPathString = PathUtils.createSmoothPath(obj.customPoints);
        const pathData = fabric.util.parsePath(newPathString);
        obj.set({ path: pathData, angle: 0 });

        const dims = obj._calcDimensions();
        obj.set({
          width: dims.width,
          height: dims.height,
          pathOffset: new fabric.Point(dims.left + dims.width / 2, dims.top + dims.height / 2),
        });
        obj.setPositionByOrigin(rotatedCenter, 'center', 'center');
        obj.dirty = true;
        obj.setCoords();
        didResyncPath = true;
      } else {
        obj.rotate((obj.angle || 0) + deltaDegrees);
      }

      if (!didResyncPath) {
        obj.setPositionByOrigin(rotatedCenter, 'center', 'center');
        obj.setCoords();
      }

      if (obj.type === 'path') {
        obj.lastLeft = obj.left;
        obj.lastTop = obj.top;
        const newCenter = obj.getCenterPoint();
        obj.__lastCenter = { x: newCenter.x, y: newCenter.y };
      }
    });

    tags.forEach(tagObj => {
      const tagCenter = tagObj.getCenterPoint();
      const rotatedCenter = fabric.util.rotatePoint(tagCenter, center, radians);

      // Reset angle first, then position — avoids Fabric.js group transform quirk
      tagObj.set({ angle: 0 });
      tagObj.setPositionByOrigin(
        new fabric.Point(rotatedCenter.x, rotatedCenter.y),
        'center',
        'center'
      );
      tagObj.dirty = true; // Invalidate group cache so the upright bitmap is re-rendered
      tagObj.setCoords();

      // Update tagOffset to track the stroke's new position
      const strokeObj = tagObj.connectedStroke;
      if (strokeObj) {
        let strokeCenter;
        if (strokeObj.group) {
          const centerRelative = strokeObj.getCenterPoint();
          const groupMatrix = strokeObj.group.calcTransformMatrix();
          strokeCenter = fabric.util.transformPoint(centerRelative, groupMatrix);
        } else {
          strokeCenter = strokeObj.getCenterPoint();
        }
        if (strokeCenter) {
          const newCenter = tagObj.getCenterPoint();
          tagObj.tagOffset = {
            x: newCenter.x - strokeCenter.x,
            y: newCenter.y - strokeCenter.y,
          };
          strokeObj.tagOffset = {
            x: tagObj.tagOffset.x,
            y: tagObj.tagOffset.y,
          };
        }
      }
    });

    const backgroundImage = this.fabricCanvas.backgroundImage;
    if (backgroundImage) {
      const bgCenter = backgroundImage.getCenterPoint();
      const rotatedBgCenter = fabric.util.rotatePoint(bgCenter, center, radians);
      backgroundImage.rotate((backgroundImage.angle || 0) + deltaDegrees);
      backgroundImage.setPositionByOrigin(rotatedBgCenter, 'center', 'center');
      if (typeof backgroundImage.setCoords === 'function') {
        backgroundImage.setCoords();
      }
    }

    this.rotationDegrees = (((this.rotationDegrees + deltaDegrees) % 360) + 360) % 360;
    if (window.app?.tagManager) {
      tags.forEach(tagObj => {
        if (tagObj?.strokeLabel) {
          window.app.tagManager.updateConnector(tagObj.strokeLabel, tagObj.imageLabel);
        }
      });
    }
    this.fabricCanvas.requestRenderAll();
    return this.rotationDegrees;
  }

  // Helper to get JSON export
  // Include strokeMetadata, isArrow, and customPoints to preserve stroke labels, visibility state, arrow markers, and curve control points
  toJSON() {
    const json = this.fabricCanvas.toJSON([
      'strokeMetadata',
      'isArrow',
      'customPoints',
      'tagOffset',
      'arrowSettings',
    ]);
    const exportableObjects = this.fabricCanvas.getObjects().filter(obj => !obj?.excludeFromExport);
    if (json?.objects && exportableObjects.length === json.objects.length) {
      json.objects.forEach((entry, index) => {
        const obj = exportableObjects[index];
        if (obj?.arrowSettings) {
          entry.arrowSettings = obj.arrowSettings;
        }
      });
    }
    return json;
  }

  // Helper to load from JSON
  // Use reviver to restore strokeMetadata custom property on each object
  // Also restores custom controls for lines, curves, and arrows
  loadFromJSON(json, callback) {
    this.fabricCanvas.loadFromJSON(
      json,
      () => {
        // After all objects are loaded, restore custom controls
        this.fabricCanvas.getObjects().forEach(object => {
          if (object?._arrowRenderingAttached) {
            delete object._arrowRenderingAttached;
          }
          if (object.strokeMetadata) {
            const metaType = object.strokeMetadata.type;
            const objType = object.type;

            // Restore controls based on object type
            if (objType === 'line') {
              FabricControls.createLineControls(object);
            } else if (objType === 'path' && metaType !== 'shape') {
              // Curves are paths but not shapes
              console.log(
                '[CanvasManager] Restoring curve controls, customPoints:',
                object.customPoints?.length || 'none'
              );
              FabricControls.createCurveControls(object);
            } else if (objType === 'group' && (object.isArrow || object.strokeMetadata.isArrow)) {
              FabricControls.createArrowControls(object);
            }
          }

          if (object.arrowSettings && window.app?.arrowManager) {
            window.app.arrowManager.attachArrowRendering(object);
            object.dirty = true;
          }
        });

        this.fabricCanvas.renderAll();
        if (callback) callback();
      },
      (o, object) => {
        if (object?._arrowRenderingAttached) {
          delete object._arrowRenderingAttached;
        }
        if (o.arrowSettings) {
          object.arrowSettings = o.arrowSettings;
        }

        // Reviver: restore custom properties from serialized JSON to fabric object
        if (o.strokeMetadata) {
          object.strokeMetadata = o.strokeMetadata;
          // DEBUG: Log text objects being restored
          if (o.strokeMetadata.type === 'text') {
            console.log(
              '[CanvasManager] Reviver: Restoring text object:',
              o.text?.substring(0, 30) || 'empty',
              'with metadata:',
              o.strokeMetadata
            );
          }
        }
        if (o.isArrow) {
          object.isArrow = o.isArrow;
        }
        if (o.customPoints) {
          object.customPoints = o.customPoints;
        }
        if (o.tagOffset) {
          object.tagOffset = o.tagOffset;
        }
        if (!object.arrowSettings && o.strokeMetadata?.arrowSettings) {
          object.arrowSettings = o.strokeMetadata.arrowSettings;
        }
      }
    );
  }
}
