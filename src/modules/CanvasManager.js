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

    // Viewport transform state
    this.rotationDegrees = 0;
    this.zoomLevel = 1;
    this.panX = 0;
    this.panY = 0;
    this.rotateViewport = false;
    this.__activeCurveTransformTarget = null;
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

    // Initialize zoom/pan events
    this.initZoomPan();

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
          window.currentImageLabel = imageLabel;

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
      if (action === 'drag') return;

      let obj = opt?.transform?.target || opt?.target;
      if (!obj) {
        obj = this.fabricCanvas.getActiveObject();
      }
      if (!obj) return;

      if (obj.type === 'activeSelection') {
        const objects = obj.getObjects();
        const curve = objects.find(o => o.type === 'path' && Array.isArray(o.customPoints));
        if (!curve) return;
        obj = curve;
        logScale('activeSelection objects:', objects.length);
      }

      if (obj.type !== 'path' || !Array.isArray(obj.customPoints)) return;
      if (obj.isEditingControlPoint) return;
      if (obj.__curveTransformActive) return;

      obj.__curveTransformActive = true;
      obj.__curveTransformAction = action;
      obj.__curveTransformCorner = opt?.transform?.corner || null;
      obj.__curveBakedThisGesture = false;
      obj.__curveOrigMatrix = obj.calcTransformMatrix();
      obj.__curveOrigAngle = obj.angle || 0;
      obj.__curveOrigPoints = obj.customPoints.map(point => ({
        x: point.x,
        y: point.y,
      }));

      const originX = opt?.transform?.originX || 'center';
      const originY = opt?.transform?.originY || 'center';
      const pivotTarget = opt?.transform?.target || obj;
      if (typeof pivotTarget?.getPointByOrigin === 'function') {
        const pivot = pivotTarget.getPointByOrigin(originX, originY);
        obj.__curveTransformPivotWorld = { x: pivot.x, y: pivot.y };
      } else if (typeof pivotTarget?.getCenterPoint === 'function') {
        const pivot = pivotTarget.getCenterPoint();
        obj.__curveTransformPivotWorld = { x: pivot.x, y: pivot.y };
      }
      logScale('capture start', { action });
      logScale('corner', obj.__curveTransformCorner);
      logScale('pivotWorld', obj.__curveTransformPivotWorld);

      const activeObj = this.fabricCanvas.getActiveObject();
      if (activeObj && activeObj.type === 'activeSelection') {
        obj.__curveOrigActiveSelection = activeObj;
        obj.__curveOrigActiveSelectionCenter = activeObj.getCenterPoint();
      }

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

        tagManager.updateConnector(strokeLabel);
        break;
      }
    };

    const bakeCurveTransform = opt => {
      let obj = opt?.target;
      if (!obj) return;
      const isScaleAction =
        obj.__curveTransformAction === 'scale' ||
        obj.__curveTransformAction === 'scaleX' ||
        obj.__curveTransformAction === 'scaleY';
      const logScale = (...args) => {
        if (isScaleAction) {
          console.log('[CURVE SCALE]', ...args);
        }
      };

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
      if (obj.group && obj.group.type === 'activeSelection') {
        scheduleBakeAfterFinalize(obj);
        return;
      }
      // Skip if we're editing a control point
      if (obj.isEditingControlPoint || obj.__curveEditBaseCenterWorld) {
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
      if (obj.__curveBakedThisGesture) return;
      if (!obj.__curveTransformActive || !obj.__curveOrigMatrix || !obj.__curveOrigPoints) return;
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
      logScale('delta', delta.map(v => v.toFixed(4)).join(', '));

      const corner = obj.__curveTransformCorner;
      const isCornerScale = corner && ['tl', 'tr', 'bl', 'br'].includes(corner);
      const useUniformScale = isScaleAction && isCornerScale;
      const count = Math.min(obj.__curveOrigPoints.length, obj.customPoints.length);

      if (useUniformScale) {
        const sx = Math.hypot(delta[0], delta[1]);
        const sy = Math.hypot(delta[2], delta[3]);
        let uniformScale = Math.min(sx, sy);
        if (!Number.isFinite(uniformScale) || uniformScale === 0) {
          uniformScale = 1;
        }

        const pivot = obj.__curveTransformPivotWorld || obj.getCenterPoint();
        logScale('uniformScale', uniformScale.toFixed(4));
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
      const baseCenterWorld = {
        x: (minX + maxX) / 2,
        y: (minY + maxY) / 2,
      };
      logScale('baseCenterWorld', baseCenterWorld);

      const preserveAngle = useUniformScale;
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
      obj.set({
        scaleX: 1,
        scaleY: 1,
        skewX: 0,
        skewY: 0,
        flipX: false,
        flipY: false,
      });

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
      const compensatedWorldCenter = new fabric.Point(
        baseCenterWorld.x + centerLocalWorld.x,
        baseCenterWorld.y + centerLocalWorld.y
      );
      logScale('compensatedWorldCenter', compensatedWorldCenter);

      obj.setPositionByOrigin(compensatedWorldCenter, 'center', 'center');
      logScale('leftTop', { left: obj.left, top: obj.top });
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
      const activeSelection = obj.__curveOrigActiveSelection || canvas?.getActiveObject?.();
      const shouldIsolateSelection =
        activeSelection &&
        activeSelection.type === 'activeSelection' &&
        obj.__curveTransformAction === 'scale';
      let restoreObjects = null;

      if (shouldIsolateSelection) {
        restoreObjects = activeSelection.getObjects?.().slice() ?? null;
        canvas?.discardActiveObject();
        canvas?.requestRenderAll?.();
      }

      // CRITICAL FIX: Call canonicalizeCurveFromWorldPoints to ensure path geometry
      // matches anchor positions. This uses the same rebuild logic as anchor edits,
      // which is proven to produce correct alignment.
      FabricControls.canonicalizeCurveFromWorldPoints(obj, baseCenterWorld);

      finalizeCurveVisualState(obj.canvas, obj);

      // P2: If the curve was scaled as part of an activeSelection, force that selection to recompute bounds/coords.
      // Otherwise the selection box can lag behind and the curve appears to "jump" outside it.
      const sel = obj.__curveOrigActiveSelection || obj.canvas?.getActiveObject?.();

      if (sel && sel.type === 'activeSelection' && !shouldIsolateSelection) {
        try {
          // Recompute selection bounds based on updated object coords.
          // These are internal but effective across Fabric 4/5-ish builds.
          sel._calcBounds();
          sel._updateObjectsCoords();
          sel.setCoords();

          // Some Fabric builds need a render tick to fully settle.
          obj.canvas?.requestRenderAll();
          console.log('[CURVE DEBUG] bakeCurveTransform - recalculated activeSelection bounds');
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

      if (shouldIsolateSelection && restoreObjects?.length) {
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
        console.log('[CURVE DEBUG] bakeCurveTransform - cleared __curveJustBaked flag (safe)');
      };

      requestAnimationFrame(clearWhenSafe);

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

      console.log('[CURVE DEBUG] bakeCurveTransform - DONE');
    };

    this.fabricCanvas.on('object:scaling', captureCurveTransformStart);
    this.fabricCanvas.on('object:rotating', captureCurveTransformStart);
    this.fabricCanvas.on('object:skewing', captureCurveTransformStart);
    this.fabricCanvas.on('before:transform', captureCurveTransformStart);
    this.fabricCanvas.on('object:modified', bakeCurveTransform);
    this.fabricCanvas.on('mouse:up', opt => {
      const obj = this.__activeCurveTransformTarget || opt?.target;
      if (obj?.__curveTransformActive && !obj.__curveBakedThisGesture) {
        // CRITICAL: If curve is inside activeSelection, use scheduleBakeAfterFinalize
        // to wait until the curve is ungrouped. Otherwise canonicalize runs with
        // the curve still in selection context, causing position mismatch.
        if (obj.group && obj.group.type === 'activeSelection') {
          scheduleBakeAfterFinalize(obj);
        } else {
          bakeCurveTransform({ target: obj });
        }
      }
      this.__activeCurveTransformTarget = null;
    });

    // Ensure canvas is visible
    canvasEl.style.display = 'block';
  }

  initKeyboardShortcuts() {
    // Delete key handler
    document.addEventListener('keydown', e => {
      // Don't delete if typing in an input
      // Don't delete if typing in an input
      const isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
      const isContentEditable = e.target.isContentEditable;

      if (isInput || isContentEditable) {
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

              // Remove from metadata manager
              if (window.app?.metadataManager) {
                const metadata = window.app.metadataManager;

                if (obj.strokeMetadata.type === 'shape') {
                  metadata.removeShapeMetadata(obj);
                } else if (obj.strokeMetadata.type === 'text') {
                  const textElements = metadata.textElementsByImage?.[imageLabel] || [];
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
                window.app.tagManager.removeTag(strokeLabel);
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

          // Trigger history save
          if (window.app && window.app.historyManager) {
            window.app.historyManager.saveState();
          }
        }
      }
    });
  }

  /**
   * Calculate available canvas size (works before fabricCanvas is initialized)
   */
  calculateAvailableSize() {
    const margin = 16;
    const isVisible = el => el && el.offsetParent !== null;

    let leftReserve = 0;
    ['toolsPanel', 'strokePanel'].forEach(id => {
      const el = document.getElementById(id);
      if (isVisible(el)) {
        const elRect = el.getBoundingClientRect();
        leftReserve = Math.max(leftReserve, elRect.width + margin);
      }
    });

    let rightReserve = 0;
    ['imagePanel'].forEach(id => {
      const el = document.getElementById(id);
      if (isVisible(el)) {
        const elRect = el.getBoundingClientRect();
        rightReserve = Math.max(rightReserve, elRect.width + margin);
      }
    });

    let topReserve = 0;
    const topToolbar = document.getElementById('topToolbar');
    if (isVisible(topToolbar)) {
      topReserve = topToolbar.getBoundingClientRect().height;
    }

    const width = window.innerWidth - leftReserve - rightReserve;
    const height = window.innerHeight - topReserve;

    return {
      width: Math.max(100, width),
      height: Math.max(100, height),
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
   * Update capture frame position and size during resize
   */
  updateCaptureFrameOnResize(targetWidth, targetHeight) {
    const captureFrame = document.getElementById('captureFrame');
    if (!captureFrame) {
      console.log('[Frame Debug] No capture frame element found');
      return;
    }

    const currentImageLabel = window.app?.projectManager?.currentViewId;
    if (!currentImageLabel) {
      console.log('[Frame Debug] No current image label');
      return;
    }

    console.log(`[Frame Debug] Updating frame for image: ${currentImageLabel}`);
    console.log(`[Frame Debug] Target canvas size: ${targetWidth}x${targetHeight}`);
    console.log(
      `[Frame Debug] Current frame position: ${captureFrame.style.left}, ${captureFrame.style.top}`
    );
    console.log(
      `[Frame Debug] Current frame size: ${captureFrame.style.width}, ${captureFrame.style.height}`
    );

    // Check if manual ratios are saved for this image
    const savedRatios = window.manualFrameRatios && window.manualFrameRatios[currentImageLabel];
    console.log(`[Frame Debug] All saved ratios:`, window.manualFrameRatios);

    if (savedRatios) {
      console.log('[Frame Debug] Using saved manual ratios:', savedRatios);

      // Frame was manually resized - apply saved ratios to current canvas size
      const frameWidth = targetWidth * savedRatios.widthRatio;
      const frameHeight = targetHeight * savedRatios.heightRatio;
      const frameLeft = targetWidth * savedRatios.leftRatio;
      const frameTop = targetHeight * savedRatios.topRatio;

      console.log(
        `[Frame Debug] Calculated from ratios: ${frameWidth.toFixed(1)}x${frameHeight.toFixed(1)} at (${frameLeft.toFixed(1)}, ${frameTop.toFixed(1)})`
      );

      // Ensure frame stays within canvas bounds
      const maxLeft = Math.max(0, targetWidth - frameWidth);
      const maxTop = Math.max(0, targetHeight - frameHeight);
      const boundedLeft = Math.max(0, Math.min(maxLeft, frameLeft));
      const boundedTop = Math.max(0, Math.min(maxTop, frameTop));

      if (boundedLeft !== frameLeft || boundedTop !== frameTop) {
        console.log(
          `[Frame Debug] Bounded position: (${boundedLeft.toFixed(1)}, ${boundedTop.toFixed(1)})`
        );
      }

      captureFrame.style.width = `${frameWidth}px`;
      captureFrame.style.height = `${frameHeight}px`;
      captureFrame.style.left = `${boundedLeft}px`;
      captureFrame.style.top = `${boundedTop}px`;

      // Verify the ratios are reasonable
      const actualRatios = {
        widthRatio: frameWidth / targetWidth,
        heightRatio: frameHeight / targetHeight,
        leftRatio: boundedLeft / targetWidth,
        topRatio: boundedTop / targetHeight,
      };

      console.log(
        `[Frame Debug] ✓ Applied manual frame: ${frameWidth.toFixed(1)}x${frameHeight.toFixed(1)} at (${boundedLeft.toFixed(1)}, ${boundedTop.toFixed(1)})\n` +
          `[Frame Debug] Actual ratios after apply: w=${(actualRatios.widthRatio * 100).toFixed(1)}%, h=${(actualRatios.heightRatio * 100).toFixed(1)}%`
      );
    } else {
      console.log('[Frame Debug] No saved ratios, using default sizing');

      // No manual resize - use default 800x600 or fit to canvas
      let frameWidth = 800;
      let frameHeight = 600;

      // If canvas is smaller than 800x600, scale down to fit
      if (targetWidth < 800 || targetHeight < 600) {
        const aspectRatio = 4 / 3;
        console.log(
          `[Frame Debug] Canvas smaller than 800x600, scaling to fit (aspect: ${aspectRatio})`
        );

        if (targetWidth / targetHeight > aspectRatio) {
          frameHeight = targetHeight * 0.9;
          frameWidth = frameHeight * aspectRatio;
          console.log(`[Frame Debug] Wide canvas: using 90% height`);
        } else {
          frameWidth = targetWidth * 0.9;
          frameHeight = frameWidth / aspectRatio;
          console.log(`[Frame Debug] Tall canvas: using 90% width`);
        }
      }

      // Center the frame on the canvas
      const frameLeft = (targetWidth - frameWidth) / 2;
      const frameTop = (targetHeight - frameHeight) / 2;

      console.log(
        `[Frame Debug] Centered frame: ${frameWidth.toFixed(1)}x${frameHeight.toFixed(1)} at (${frameLeft.toFixed(1)}, ${frameTop.toFixed(1)})`
      );

      captureFrame.style.width = `${frameWidth}px`;
      captureFrame.style.height = `${frameHeight}px`;
      captureFrame.style.left = `${frameLeft}px`;
      captureFrame.style.top = `${frameTop}px`;

      console.log(
        `[Frame Debug] ✓ Applied default frame: ${frameWidth.toFixed(1)}x${frameHeight.toFixed(1)} at (${frameLeft.toFixed(1)}, ${frameTop.toFixed(1)})`
      );
    }
  }

  /**
   * Apply resize with debouncing and smooth transitions
   */
  applyResize() {
    if (!this.fabricCanvas) {
      return;
    }
    if (this.pendingResizeWidth === null || this.pendingResizeHeight === null) {
      return;
    }

    const targetWidth = this.pendingResizeWidth;
    const targetHeight = this.pendingResizeHeight;

    const sizeChanged =
      this.lastCanvasSize.width !== targetWidth || this.lastCanvasSize.height !== targetHeight;

    // Get background image info if available
    const bgImage = this.fabricCanvas.backgroundImage;

    // Show overlay before resize for smooth transition
    if (sizeChanged) {
      this.showResizeOverlay(targetWidth, targetHeight);
    }

    // Update Fabric.js canvas dimensions
    this.fabricCanvas.setWidth(targetWidth);
    this.fabricCanvas.setHeight(targetHeight);

    // CRITICAL FIX: Remove min-width/min-height constraints that cause stretching
    // These CSS constraints force the canvas to display larger than its actual size
    const canvasEl = this.fabricCanvas.lowerCanvasEl;
    if (canvasEl) {
      canvasEl.style.minWidth = 'unset';
      canvasEl.style.minHeight = 'unset';
    }
    const upperCanvasEl = this.fabricCanvas.upperCanvasEl;
    if (upperCanvasEl) {
      upperCanvasEl.style.minWidth = 'unset';
      upperCanvasEl.style.minHeight = 'unset';
    }

    // Update last known size
    this.lastCanvasSize = { width: targetWidth, height: targetHeight };

    // Recalculate background image fit if one exists
    if (bgImage && sizeChanged) {
      // Get current fit mode from project manager if available
      const currentViewId = window.app?.projectManager?.currentViewId;
      const savedFitMode =
        window.app?.projectManager?.views?.[currentViewId]?.fitMode || 'fit-canvas';

      // Recalculate scale based on new canvas size
      const imgWidth = bgImage.width;
      const imgHeight = bgImage.height;
      let scale = 1;

      switch (savedFitMode) {
        case 'fit-width':
          scale = targetWidth / imgWidth;
          break;
        case 'fit-height':
          scale = targetHeight / imgHeight;
          break;
        case 'fit-canvas':
          scale = Math.min(targetWidth / imgWidth, targetHeight / imgHeight);
          break;
        case 'actual-size':
          scale = 1;
          break;
        default:
          scale = Math.min(targetWidth / imgWidth, targetHeight / imgHeight);
      }

      const oldScale = bgImage.scaleX;
      const oldLeft = bgImage.left;
      const oldTop = bgImage.top;

      // Calculate scaled dimensions
      const scaledWidth = imgWidth * scale;
      const scaledHeight = imgHeight * scale;

      // Center the image in the canvas
      // Since originX/originY are 'center', left/top should be canvas center
      const centerX = targetWidth / 2;
      const centerY = targetHeight / 2;

      // Update scale AND position to center the image
      bgImage.set({
        scaleX: scale,
        scaleY: scale,
        left: centerX,
        top: centerY,
      });

      // CRITICAL: Transform all stroke objects to maintain position relative to background image
      // Calculate the transformation delta
      const scaleRatio = scale / oldScale;

      // Transform all objects (strokes, arrows, tags, etc.) except the background image
      const objects = this.fabricCanvas.getObjects();
      let transformedCount = 0;
      objects.forEach(obj => {
        // Skip only the background image itself
        if (obj === bgImage) return;

        // Calculate new position relative to background image center
        // 1. Get position relative to old background center
        const relX = obj.left - oldLeft;
        const relY = obj.top - oldTop;

        // 2. Scale the relative position
        const newRelX = relX * scaleRatio;
        const newRelY = relY * scaleRatio;

        // 3. Add new background center
        const newLeft = centerX + newRelX;
        const newTop = centerY + newRelY;

        // Update object position and scale
        obj.set({
          left: newLeft,
          top: newTop,
          scaleX: (obj.scaleX || 1) * scaleRatio,
          scaleY: (obj.scaleY || 1) * scaleRatio,
        });

        obj.setCoords(); // Update object coordinates for interactions
        transformedCount++;
      });

      // Transform capture frame to stick with the background image
      const captureFrame = document.getElementById('captureFrame');
      if (captureFrame) {
        const oldFrameLeft = parseFloat(captureFrame.style.left) || 0;
        const oldFrameTop = parseFloat(captureFrame.style.top) || 0;
        const oldFrameWidth = parseFloat(captureFrame.style.width) || 0;
        const oldFrameHeight = parseFloat(captureFrame.style.height) || 0;

        // Store frame ratios relative to OLD image if not already stored
        // This prevents cumulative drift by always calculating from the same reference
        if (!this.captureFrameImageRatios) {
          // Calculate frame center relative to old image center
          const frameCenterX = oldFrameLeft + oldFrameWidth / 2;
          const frameCenterY = oldFrameTop + oldFrameHeight / 2;

          // Position relative to old background center
          const relX = frameCenterX - oldLeft;
          const relY = frameCenterY - oldTop;

          // Convert to ratios of the OLD image's scaled size
          const oldScaledWidth = imgWidth * oldScale;
          const oldScaledHeight = imgHeight * oldScale;

          this.captureFrameImageRatios = {
            // Frame center position as ratio of image size (-0.5 to 0.5 for centered)
            centerXRatio: relX / oldScaledWidth,
            centerYRatio: relY / oldScaledHeight,
            // Frame size as ratio of image size
            widthRatio: oldFrameWidth / oldScaledWidth,
            heightRatio: oldFrameHeight / oldScaledHeight,
          };
        }

        // Calculate NEW frame position from stored ratios and NEW image position
        const newScaledWidth = imgWidth * scale;
        const newScaledHeight = imgHeight * scale;

        // Calculate frame size from ratios
        const newFrameWidth = newScaledWidth * this.captureFrameImageRatios.widthRatio;
        const newFrameHeight = newScaledHeight * this.captureFrameImageRatios.heightRatio;

        // Calculate frame center position
        const frameCenterX = centerX + newScaledWidth * this.captureFrameImageRatios.centerXRatio;
        const frameCenterY = centerY + newScaledHeight * this.captureFrameImageRatios.centerYRatio;

        // Calculate top-left position from center
        const newFrameLeft = frameCenterX - newFrameWidth / 2;
        const newFrameTop = frameCenterY - newFrameHeight / 2;

        // Round to whole pixels to prevent sub-pixel jitter
        const roundedLeft = Math.round(newFrameLeft);
        const roundedTop = Math.round(newFrameTop);
        const roundedWidth = Math.round(newFrameWidth);
        const roundedHeight = Math.round(newFrameHeight);

        // Update frame position and size
        captureFrame.style.left = `${roundedLeft}px`;
        captureFrame.style.top = `${roundedTop}px`;
        captureFrame.style.width = `${roundedWidth}px`;
        captureFrame.style.height = `${roundedHeight}px`;
      }
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
  }

  /**
   * Debounced resize method - queues resize with requestAnimationFrame
   */
  resize() {
    if (!this.fabricCanvas) {
      return;
    }

    const { width, height } = this.getAvailableCanvasSize();

    this.pendingResizeWidth = width;
    this.pendingResizeHeight = height;

    // Debounce resize calls to prevent multiple rapid calls
    if (!this.pendingResizeFrame) {
      this.pendingResizeFrame = requestAnimationFrame(() => {
        this.pendingResizeFrame = null;
        this.applyResize();
      });
    }
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
      if (this.fabricCanvas.viewportTransform) {
        this.zoomLevel = zoom;
        this.panX = this.fabricCanvas.viewportTransform[4];
        this.panY = this.fabricCanvas.viewportTransform[5];
        this.applyViewportTransform();
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
        const transform = obj.canvas?._currentTransform;
        const isNonDragTransform = transform && transform.action && transform.action !== 'drag';
        if (obj.__curveTransformActive || obj.__curveJustBaked || isNonDragTransform) {
          return;
        }
        if (dx === 0 && dy === 0) return;
        obj.customPoints.forEach(point => {
          point.x += dx;
          point.y += dy;
        });
        obj.__lastCenter = obj.__lastCenter
          ? { x: obj.__lastCenter.x + dx, y: obj.__lastCenter.y + dy }
          : getWorldCenter(obj);
      };

      const updateCurveTranslationFromSelf = obj => {
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
                tagManager.updateConnector(strokeLabel);
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
            tagManager.updateConnector(strokeLabel);
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
              tagManager.updateConnector(strokeLabel);
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
              if (this.fabricCanvas.viewportTransform) {
                this.zoomLevel = newZoom;
                this.panX = this.fabricCanvas.viewportTransform[4];
                this.panY = this.fabricCanvas.viewportTransform[5];
                this.applyViewportTransform();
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
      tagObj.set({
        left: rotatedCenter.x,
        top: rotatedCenter.y,
        angle: 0,
      });
      tagObj.setCoords();

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
          tagObj.tagOffset = {
            x: rotatedCenter.x - strokeCenter.x,
            y: rotatedCenter.y - strokeCenter.y,
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
          window.app.tagManager.updateConnector(tagObj.strokeLabel);
        }
      });
    }
    this.fabricCanvas.requestRenderAll();
    return this.rotationDegrees;
  }

  // Helper to get JSON export
  // Include strokeMetadata, isArrow, and customPoints to preserve stroke labels, visibility state, arrow markers, and curve control points
  toJSON() {
    return this.fabricCanvas.toJSON(['strokeMetadata', 'isArrow', 'customPoints', 'tagOffset']);
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
        });

        this.fabricCanvas.renderAll();
        if (callback) callback();
      },
      (o, object) => {
        // Reviver: restore custom properties from serialized JSON to fabric object
        if (o.strokeMetadata) {
          object.strokeMetadata = o.strokeMetadata;
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
      }
    );
  }
}
