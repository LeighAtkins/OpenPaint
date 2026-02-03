/**
 * FabricControls.js
 * Custom Fabric.js controls for line and curve manipulation
 */

import { PathUtils } from './PathUtils.js';

// Debug function for curve/line operations
const CURVE_DEBUG_ENABLED = false;
const curveDebug = (...args) => {
  if (CURVE_DEBUG_ENABLED) {
    console.log(...args);
  }
};

export class FabricControls {
  /**
   * Helper function to find snap point when Ctrl is held during editing
   * @param {fabric.Canvas} canvas - The canvas
   * @param {Object} pointer - Current mouse position {x, y}
   * @param {fabric.Object} excludeObject - The object being edited (to exclude from snap)
   * @param {Number} threshold - Snap threshold in pixels
   * @returns {Object} - Snapped point {x, y} or original pointer
   */
  static getSnapPoint(canvas, pointer, excludeObject, threshold = 10) {
    // Find closest point on all lines within threshold
    let closestPoint = null;
    let minDistance = threshold;

    const objects = canvas.getObjects();
    curveDebug(`[FabricControls] getSnapPoint checking ${objects.length} objects`);

    for (const obj of objects) {
      // Skip the object being edited
      if (obj === excludeObject) continue;

      // Skip non-stroke objects
      if (obj.isTag || obj.isConnectorLine || !obj.evented) continue;

      // Skip if object doesn't have proper type
      if (!obj.type || (obj.type !== 'line' && obj.type !== 'group' && obj.type !== 'path'))
        continue;

      try {
        const point = PathUtils.getClosestStrokeEndpoint(obj, pointer);
        const distance = PathUtils.calculateDistance(point, pointer);

        if (distance < minDistance) {
          minDistance = distance;
          closestPoint = point;
        }
      } catch (e) {
        curveWarn('[FabricControls] Error finding closest point:', e);
      }
    }

    // Show/hide snap indicator
    if (closestPoint) {
      curveDebug('[FabricControls] Found snap point:', closestPoint);
      FabricControls.showSnapIndicator(canvas, closestPoint);
      return closestPoint;
    } else {
      FabricControls.hideSnapIndicator(canvas);
      return pointer;
    }
  }

  /**
   * Show snap indicator on canvas
   */
  static showSnapIndicator(canvas, point) {
    if (canvas._editSnapIndicator) {
      canvas._editSnapIndicator.set({
        left: point.x,
        top: point.y,
      });
    } else {
      canvas._editSnapIndicator = new fabric.Circle({
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
      canvas.add(canvas._editSnapIndicator);

      // Add one-time mouse up listener to clean up
      const cleanup = () => {
        FabricControls.hideSnapIndicator(canvas);
        canvas.off('mouse:up', cleanup);
      };
      canvas.on('mouse:up', cleanup);
    }
    canvas.requestRenderAll();
  }

  /**
   * Hide snap indicator
   */
  static hideSnapIndicator(canvas) {
    if (canvas._editSnapIndicator) {
      canvas.remove(canvas._editSnapIndicator);
      canvas._editSnapIndicator = null;
      canvas.requestRenderAll();
    }
  }

  /**
   * Canonicalizes a curve path from its world-space customPoints.
   * This rebuilds the path geometry, sets proper pathOffset, and positions the object correctly.
   * Call this after modifying customPoints to ensure path rendering matches anchor positions.
   * @param {fabric.Path} pathObj - The path object with customPoints array
   * @param {Object} baseCenterWorld - Optional center point {x, y}. If not provided, computed from customPoints.
   */
  static canonicalizeCurveFromWorldPoints(pathObj, baseCenterWorld = null) {
    if (!pathObj || !Array.isArray(pathObj.customPoints) || pathObj.customPoints.length < 2) {
      console.warn(
        '[FabricControls] canonicalizeCurveFromWorldPoints: invalid pathObj or customPoints'
      );
      return;
    }

    // Calculate baseCenterWorld from customPoints if not provided
    if (!baseCenterWorld) {
      const minX = Math.min(...pathObj.customPoints.map(p => p.x));
      const maxX = Math.max(...pathObj.customPoints.map(p => p.x));
      const minY = Math.min(...pathObj.customPoints.map(p => p.y));
      const maxY = Math.max(...pathObj.customPoints.map(p => p.y));
      baseCenterWorld = {
        x: (minX + maxX) / 2,
        y: (minY + maxY) / 2,
      };
    }

    console.log(
      '[CURVE CANONICALIZE] baseCenterWorld:',
      baseCenterWorld.x.toFixed(1),
      baseCenterWorld.y.toFixed(1)
    );

    // Convert world points to local points around baseCenterWorld
    const localPoints = pathObj.customPoints.map(p => ({
      x: p.x - baseCenterWorld.x,
      y: p.y - baseCenterWorld.y,
    }));

    // Create smooth path from local points
    const newPathString = PathUtils.createSmoothPath(localPoints);
    const pathData = fabric.util.parsePath(newPathString);

    // Set path and reset transforms
    pathObj.set({ path: pathData, angle: 0 });
    pathObj.set({
      scaleX: 1,
      scaleY: 1,
      skewX: 0,
      skewY: 0,
      flipX: false,
      flipY: false,
    });

    // Compute Fabric local bbox center (Bezier-extrema aware)
    const dims = pathObj._calcDimensions();
    const centerLocal = new fabric.Point(dims.left + dims.width / 2, dims.top + dims.height / 2);

    console.log('[CURVE CANONICALIZE] dims:', JSON.stringify(dims));
    console.log(
      '[CURVE CANONICALIZE] centerLocal:',
      centerLocal.x.toFixed(1),
      centerLocal.y.toFixed(1)
    );

    // Set pathOffset to centerLocal
    pathObj.set({
      width: dims.width,
      height: dims.height,
      pathOffset: centerLocal,
    });

    // Compensate world position: baseCenterWorld + centerLocal
    const compensatedWorldCenter = new fabric.Point(
      baseCenterWorld.x + centerLocal.x,
      baseCenterWorld.y + centerLocal.y
    );

    console.log(
      '[CURVE CANONICALIZE] compensatedWorldCenter:',
      compensatedWorldCenter.x.toFixed(1),
      compensatedWorldCenter.y.toFixed(1)
    );

    pathObj.setPositionByOrigin(compensatedWorldCenter, 'center', 'center');

    // CRITICAL: Rebuild customPoints in world coordinates based on the new canonicalized path
    // The path uses local coordinates relative to centerLocal, so world coordinates are:
    // compensatedWorldCenter + (localPoint - centerLocal) = baseCenterWorld + localPoint
    pathObj.customPoints = localPoints.map(p => ({
      x: baseCenterWorld.x + p.x,
      y: baseCenterWorld.y + p.y,
    }));

    // Update tracking for move handlers
    pathObj.lastLeft = pathObj.left;
    pathObj.lastTop = pathObj.top;
    const updatedCenter = pathObj.getCenterPoint();
    pathObj.__lastCenter = { x: updatedCenter.x, y: updatedCenter.y };

    // Force cache invalidation and render
    pathObj.objectCaching = false;
    pathObj.dirty = true;
    pathObj.setCoords();

    console.log(
      '[CURVE CANONICALIZE] final left/top:',
      pathObj.left?.toFixed(1),
      pathObj.top?.toFixed(1)
    );
    console.log(
      '[CURVE CANONICALIZE] customPoints rebuilt (world coords):',
      pathObj.customPoints.length,
      'points'
    );
  }

  /**
    /**
     * Adds custom controls to a fabric.Line object for endpoint manipulation
     * @param {fabric.Line} line - The line object
     */
  static createLineControls(line) {
    if (!line) return;

    curveDebug('[FabricControls] Creating custom controls for line', line);

    // Hide standard controls
    line.set({
      hasBorders: false,
      hasControls: true,
      cornerSize: 10,
      transparentCorners: false,
      cornerColor: '#ffffff',
      cornerStrokeColor: '#3b82f6',
      lockScalingX: true,
      lockScalingY: true,
      lockRotation: true,
    });

    // Define the position handler for the starting point (x1, y1)
    const positionHandlerStart = (dim, finalMatrix, fabricObject) => {
      if (!fabricObject.canvas) return { x: 0, y: 0 };
      const points = fabricObject.calcLinePoints();
      const x = points.x1;
      const y = points.y1;
      return fabric.util.transformPoint(
        { x: x, y: y },
        fabric.util.multiplyTransformMatrices(
          fabricObject.canvas.viewportTransform,
          fabricObject.calcTransformMatrix()
        )
      );
    };

    // Define the action handler for the starting point
    const actionHandlerStart = (eventData, transform, x, y) => {
      const lineObj = transform.target;
      const canvas = lineObj.canvas;

      // Resolve event object (eventData might be the event itself or a wrapper)
      const event = eventData.e || eventData;

      // Get pointer and check for Ctrl key (screen space)
      const rawPointer = canvas.getPointer(event);
      const isCtrlHeld = event.ctrlKey;

      if (isCtrlHeld) {
        curveDebug('[FabricControls] Line start - Ctrl held, checking for snap');
      }

      const pointer = isCtrlHeld
        ? FabricControls.getSnapPoint(canvas, rawPointer, lineObj)
        : rawPointer;

      if (isCtrlHeld && pointer !== rawPointer) {
        curveDebug('[FabricControls] Line start snapped to:', pointer);
      }

      const points = lineObj.calcLinePoints();
      const matrix = lineObj.calcTransformMatrix();
      const p1World = fabric.util.transformPoint({ x: points.x1, y: points.y1 }, matrix);
      const p2World = fabric.util.transformPoint({ x: points.x2, y: points.y2 }, matrix);
      const center = {
        x: (pointer.x + p2World.x) / 2,
        y: (pointer.y + p2World.y) / 2,
      };
      const angle = (lineObj.angle || 0) * (Math.PI / 180);
      const localP1 = fabric.util.rotatePoint(pointer, center, -angle);
      const localP2 = fabric.util.rotatePoint(p2World, center, -angle);

      lineObj.set({
        x1: localP1.x - center.x,
        y1: localP1.y - center.y,
        x2: localP2.x - center.x,
        y2: localP2.y - center.y,
        left: center.x,
        top: center.y,
      });
      lineObj.setCoords();

      // Fire moving event to trigger updates (like tag connectors)
      lineObj.fire('moving');

      return true;
    };

    // Define the position handler for the ending point (x2, y2)
    const positionHandlerEnd = (dim, finalMatrix, fabricObject) => {
      if (!fabricObject.canvas) return { x: 0, y: 0 };
      const points = fabricObject.calcLinePoints();
      const x = points.x2;
      const y = points.y2;
      return fabric.util.transformPoint(
        { x: x, y: y },
        fabric.util.multiplyTransformMatrices(
          fabricObject.canvas.viewportTransform,
          fabricObject.calcTransformMatrix()
        )
      );
    };

    // Define the action handler for the ending point
    const actionHandlerEnd = (eventData, transform, x, y) => {
      const lineObj = transform.target;
      const canvas = lineObj.canvas;

      // Resolve event object
      const event = eventData.e || eventData;

      // Get pointer and check for Ctrl key (screen space)
      const rawPointer = canvas.getPointer(event);
      const isCtrlHeld = event.ctrlKey;

      if (isCtrlHeld) {
        curveDebug('[FabricControls] Line end - Ctrl held, checking for snap');
      }

      const pointer = isCtrlHeld
        ? FabricControls.getSnapPoint(canvas, rawPointer, lineObj)
        : rawPointer;

      if (isCtrlHeld && pointer !== rawPointer) {
        curveDebug('[FabricControls] Line end snapped to:', pointer);
      }

      const points = lineObj.calcLinePoints();
      const matrix = lineObj.calcTransformMatrix();
      const p1World = fabric.util.transformPoint({ x: points.x1, y: points.y1 }, matrix);
      const p2World = fabric.util.transformPoint({ x: points.x2, y: points.y2 }, matrix);
      const center = {
        x: (p1World.x + pointer.x) / 2,
        y: (p1World.y + pointer.y) / 2,
      };
      const angle = (lineObj.angle || 0) * (Math.PI / 180);
      const localP1 = fabric.util.rotatePoint(p1World, center, -angle);
      const localP2 = fabric.util.rotatePoint(pointer, center, -angle);

      lineObj.set({
        x1: localP1.x - center.x,
        y1: localP1.y - center.y,
        x2: localP2.x - center.x,
        y2: localP2.y - center.y,
        left: center.x,
        top: center.y,
      });
      lineObj.setCoords();
      lineObj.fire('moving');
      return true;
    };

    // Custom control definition
    // We need to override the default controls
    line.controls = {
      p1: new fabric.Control({
        positionHandler: positionHandlerStart,
        actionHandler: actionHandlerStart,
        cursorStyle: 'pointer',
        actionName: 'modifyLine',
        render: renderCircleControl,
      }),
      p2: new fabric.Control({
        positionHandler: positionHandlerEnd,
        actionHandler: actionHandlerEnd,
        cursorStyle: 'pointer',
        actionName: 'modifyLine',
        render: renderCircleControl,
      }),
    };
  }

  /**
   * Adds custom controls to a fabric.Path object (curve) for point manipulation
   * @param {fabric.Path} path - The path object
   */
  static createCurveControls(path) {
    const curveDebug = (...args) => {
      if (globalThis?.app?.debugCurve === true) {
        console.log(...args);
      }
    };

    const curveWarn = (...args) => {
      if (globalThis?.app?.debugCurve === true) {
        console.warn(...args);
      }
    };

    if (!path || !path.customPoints) return;

    curveDebug('[CURVE DEBUG] ========== createCurveControls called ==========');
    curveDebug('[CURVE DEBUG] Initial customPoints:', JSON.stringify(path.customPoints));
    curveDebug('[CURVE DEBUG] Initial path center:', path.getCenterPoint());
    curveDebug('[CURVE DEBUG] Initial left/top:', path.left, path.top);
    curveDebug('[CURVE DEBUG] Initial pathOffset:', path.pathOffset);
    const initialCenter = path.getCenterPoint();
    path.__lastCenter = { x: initialCenter.x, y: initialCenter.y };

    // Hide standard controls but enable custom ones
    path.set({
      hasBorders: false,
      hasControls: true,
      cornerSize: 12, // Increased from 8 to make controls easier to grab
      transparentCorners: false,
      cornerColor: '#ffffff',
      cornerStrokeColor: '#3b82f6',
      lockScalingX: true,
      lockScalingY: true,
      lockRotation: true,
    });

    path.controls = {};

    const getCurveAnchorWorldPoint = (fabricObject, pointIndex) => {
      const currentPoint = fabricObject.customPoints?.[pointIndex];
      if (!currentPoint) {
        curveDebug(`[CURVE DEBUG] getCurveAnchorWorldPoint(${pointIndex}): NO POINT FOUND`);
        return new fabric.Point(0, 0);
      }

      // If the curve was just baked, return the customPoint directly unless an activeSelection is still scaled.
      // In that case, align anchor positions to the still-scaled selection so the line and anchors match.
      if (fabricObject.__curveJustBaked) {
        const activeObj = fabricObject.canvas?.getActiveObject();
        if (activeObj && activeObj.type === 'activeSelection') {
          const scaleX = activeObj.scaleX || 1;
          const scaleY = activeObj.scaleY || 1;
          if (scaleX !== 1 || scaleY !== 1) {
            const center = activeObj.getCenterPoint();
            const scaledX = center.x + (currentPoint.x - center.x) * scaleX;
            const scaledY = center.y + (currentPoint.y - center.y) * scaleY;
            curveDebug(
              `[CURVE DEBUG] getCurveAnchorWorldPoint(${pointIndex}): JUST BAKED + SELECTION SCALE (${scaleX.toFixed(2)}, ${scaleY.toFixed(2)})`
            );
            return new fabric.Point(scaledX, scaledY);
          }
        }

        curveDebug(
          `[CURVE DEBUG] getCurveAnchorWorldPoint(${pointIndex}): JUST BAKED, returning customPoint directly (${currentPoint.x.toFixed(1)}, ${currentPoint.y.toFixed(1)})`
        );
        return new fabric.Point(currentPoint.x, currentPoint.y);
      }

      // Calculate the full transform matrix including any parent group/activeSelection
      const getFullTransformMatrix = obj => obj.calcTransformMatrix();

      if (
        fabricObject.__curveTransformActive &&
        fabricObject.__curveOrigMatrix &&
        fabricObject.__curveOrigPoints?.[pointIndex]
      ) {
        const before = fabricObject.__curveOrigMatrix;
        const after = getFullTransformMatrix(fabricObject);
        const delta = fabric.util.multiplyTransformMatrices(
          after,
          fabric.util.invertTransform(before)
        );
        const originPoint = fabricObject.__curveOrigPoints[pointIndex];
        const result = fabric.util.transformPoint(
          new fabric.Point(originPoint.x, originPoint.y),
          delta
        );
        curveDebug(
          `[CURVE DEBUG] getCurveAnchorWorldPoint(${pointIndex}): TRANSFORM ACTIVE, origin=(${originPoint.x.toFixed(1)}, ${originPoint.y.toFixed(1)}) -> result=(${result.x.toFixed(1)}, ${result.y.toFixed(1)})`
        );
        return result;
      }

      // P4: Only apply scaling transforms when gesture is actively in progress (pre-bake).
      // customPoints are WORLD coordinates, so after baking they already include the final transform.
      // Applying scaling again after bake would double-scale and cause bounding box mismatch.
      const isGestureScaling =
        fabricObject.__curveTransformActive &&
        fabricObject.__curveOrigMatrix &&
        fabricObject.__curveOrigPoints;

      // Check for activeSelection scaling - only during active gesture
      const activeObj = fabricObject.canvas?.getActiveObject();
      if (isGestureScaling && activeObj && activeObj.type === 'activeSelection') {
        const scaleX = activeObj.scaleX || 1;
        const scaleY = activeObj.scaleY || 1;
        // Only apply scaling if there's actual scaling happening
        if (scaleX !== 1 || scaleY !== 1) {
          const center = activeObj.getCenterPoint();
          const scaledX = center.x + (currentPoint.x - center.x) * scaleX;
          const scaledY = center.y + (currentPoint.y - center.y) * scaleY;
          curveDebug(
            `[CURVE DEBUG] getCurveAnchorWorldPoint(${pointIndex}): ACTIVE SELECTION SCALING (gesture active), scale=(${scaleX.toFixed(2)}, ${scaleY.toFixed(2)}), original=(${currentPoint.x.toFixed(1)}, ${currentPoint.y.toFixed(1)}) -> scaled=(${scaledX.toFixed(1)}, ${scaledY.toFixed(1)})`
          );
          return new fabric.Point(scaledX, scaledY);
        }
      }

      // Check if the curve itself has scaling applied - only during active gesture
      const curveScaleX = fabricObject.scaleX || 1;
      const curveScaleY = fabricObject.scaleY || 1;
      if (isGestureScaling && (curveScaleX !== 1 || curveScaleY !== 1)) {
        const center = fabricObject.getCenterPoint();
        const scaledX = center.x + (currentPoint.x - center.x) * curveScaleX;
        const scaledY = center.y + (currentPoint.y - center.y) * curveScaleY;
        curveDebug(
          `[CURVE DEBUG] getCurveAnchorWorldPoint(${pointIndex}): CURVE DIRECT SCALING (gesture active), scale=(${curveScaleX.toFixed(2)}, ${curveScaleY.toFixed(2)}), original=(${currentPoint.x.toFixed(1)}, ${currentPoint.y.toFixed(1)}) -> scaled=(${scaledX.toFixed(1)}, ${scaledY.toFixed(1)})`
        );
        return new fabric.Point(scaledX, scaledY);
      }

      curveDebug(
        `[CURVE DEBUG] getCurveAnchorWorldPoint(${pointIndex}): returning customPoint (${currentPoint.x.toFixed(1)}, ${currentPoint.y.toFixed(1)})`
      );
      return new fabric.Point(currentPoint.x, currentPoint.y);
    };

    const resolvePointerWorldForCurve = (pathObj, pointerWorld) => {
      if (pathObj.__curveTransformActive && pathObj.__curveOrigMatrix) {
        const before = pathObj.__curveOrigMatrix;
        const after = pathObj.calcTransformMatrix();
        const delta = fabric.util.multiplyTransformMatrices(
          after,
          fabric.util.invertTransform(before)
        );
        const inverseDelta = fabric.util.invertTransform(delta);
        const canonical = fabric.util.transformPoint(
          new fabric.Point(pointerWorld.x, pointerWorld.y),
          inverseDelta
        );
        curveDebug(
          `[CURVE DEBUG] resolvePointerWorldForCurve: TRANSFORM ACTIVE, pointer=(${pointerWorld.x.toFixed(1)}, ${pointerWorld.y.toFixed(1)}) -> canonical=(${canonical.x.toFixed(1)}, ${canonical.y.toFixed(1)})`
        );
        return { x: canonical.x, y: canonical.y };
      }

      curveDebug(
        `[CURVE DEBUG] resolvePointerWorldForCurve: NO TRANSFORM, pointer=(${pointerWorld.x.toFixed(1)}, ${pointerWorld.y.toFixed(1)})`
      );
      return pointerWorld;
    };

    const toLocalPoints = (pointsWorld, centerWorld) => {
      const result = pointsWorld.map((p, i) => {
        const local = {
          x: p.x - centerWorld.x,
          y: p.y - centerWorld.y,
        };
        curveDebug(
          `[CURVE DEBUG] toLocalPoints[${i}]: world=(${p.x.toFixed(1)}, ${p.y.toFixed(1)}) - center=(${centerWorld.x.toFixed(1)}, ${centerWorld.y.toFixed(1)}) = local=(${local.x.toFixed(1)}, ${local.y.toFixed(1)})`
        );
        return local;
      });
      return result;
    };

    const canonicalizeCurveFromWorldPoints = (pathObj, baseCenterWorld) => {
      curveDebug('[CURVE DEBUG] ---- canonicalizeCurveFromWorldPoints START ----');
      curveDebug(
        '[CURVE DEBUG] baseCenterWorld:',
        baseCenterWorld.x.toFixed(1),
        baseCenterWorld.y.toFixed(1)
      );
      curveDebug(
        '[CURVE DEBUG] customPoints BEFORE:',
        JSON.stringify(pathObj.customPoints.map(p => ({ x: p.x.toFixed(1), y: p.y.toFixed(1) })))
      );
      curveDebug(
        '[CURVE DEBUG] pathObj.left/top BEFORE:',
        pathObj.left?.toFixed(1),
        pathObj.top?.toFixed(1)
      );
      curveDebug('[CURVE DEBUG] pathObj.getCenterPoint() BEFORE:', pathObj.getCenterPoint());
      curveDebug('[CURVE DEBUG] pathObj.pathOffset BEFORE:', pathObj.pathOffset);

      // S3: Convert WORLD points to LOCAL points around stable base center
      const localPoints = toLocalPoints(pathObj.customPoints, baseCenterWorld);
      const newPathString = PathUtils.createSmoothPath(localPoints);
      const pathData = fabric.util.parsePath(newPathString);
      curveDebug('[CURVE DEBUG] newPathString:', newPathString);

      // S4: Set path + reset transforms for deterministic bounds math
      pathObj.set({ path: pathData, angle: 0 });
      pathObj.set({
        scaleX: 1,
        scaleY: 1,
        skewX: 0,
        skewY: 0,
        flipX: false,
        flipY: false,
      });

      // S5: Compute Fabric LOCAL bbox center (Bezier-extrema aware)
      const dims = pathObj._calcDimensions();
      curveDebug('[CURVE DEBUG] _calcDimensions:', JSON.stringify(dims));
      const centerLocal = new fabric.Point(dims.left + dims.width / 2, dims.top + dims.height / 2);
      curveDebug(
        '[CURVE DEBUG] centerLocal (Fabric bbox center):',
        centerLocal.x.toFixed(1),
        centerLocal.y.toFixed(1)
      );

      // Calculate what the anchor-only bbox center would be (for comparison)
      const anchorOnlyBbox = {
        minX: Math.min(...localPoints.map(p => p.x)),
        maxX: Math.max(...localPoints.map(p => p.x)),
        minY: Math.min(...localPoints.map(p => p.y)),
        maxY: Math.max(...localPoints.map(p => p.y)),
      };
      const anchorOnlyCenter = {
        x: (anchorOnlyBbox.minX + anchorOnlyBbox.maxX) / 2,
        y: (anchorOnlyBbox.minY + anchorOnlyBbox.maxY) / 2,
      };
      curveDebug(
        '[CURVE DEBUG] anchorOnlyCenter (for comparison):',
        anchorOnlyCenter.x.toFixed(1),
        anchorOnlyCenter.y.toFixed(1)
      );
      curveDebug(
        '[CURVE DEBUG] centerLocal vs anchorOnlyCenter DIFF:',
        (centerLocal.x - anchorOnlyCenter.x).toFixed(1),
        (centerLocal.y - anchorOnlyCenter.y).toFixed(1)
      );

      // S6: Set pathOffset to centerLocal and compensate WORLD placement
      // This cancels the visual translation that happens when pathOffset is updated.
      // Fabric renders the path around pathOffset in local space.
      // If pathOffset changes, the stroke "moves" unless we offset the object's world center accordingly.
      pathObj.set({
        width: dims.width,
        height: dims.height,
        pathOffset: centerLocal,
      });
      curveDebug(
        '[CURVE DEBUG] Set pathOffset to centerLocal:',
        centerLocal.x.toFixed(1),
        centerLocal.y.toFixed(1)
      );

      // Compensation: object WORLD center must shift by centerLocal
      const compensatedWorldCenter = new fabric.Point(
        baseCenterWorld.x + centerLocal.x,
        baseCenterWorld.y + centerLocal.y
      );
      curveDebug(
        '[CURVE DEBUG] compensatedWorldCenter = baseCenterWorld + centerLocal:',
        compensatedWorldCenter.x.toFixed(1),
        compensatedWorldCenter.y.toFixed(1)
      );

      pathObj.setPositionByOrigin(compensatedWorldCenter, 'center', 'center');
      curveDebug('[CURVE DEBUG] After setPositionByOrigin:');
      curveDebug('[CURVE DEBUG]   left/top:', pathObj.left?.toFixed(1), pathObj.top?.toFixed(1));
      curveDebug('[CURVE DEBUG]   getCenterPoint():', pathObj.getCenterPoint());

      // CRITICAL: Update lastLeft/lastTop to prevent stale delta calculations in moving handlers
      pathObj.lastLeft = pathObj.left;
      pathObj.lastTop = pathObj.top;
      const updatedCenter = pathObj.getCenterPoint();
      pathObj.__lastCenter = { x: updatedCenter.x, y: updatedCenter.y };
      curveDebug(
        '[CURVE DEBUG]   Updated lastLeft/lastTop:',
        pathObj.lastLeft?.toFixed(1),
        pathObj.lastTop?.toFixed(1)
      );

      pathObj.dirty = true;
      pathObj.setCoords();

      // Verify: where do the anchors end up in WORLD space now?
      curveDebug('[CURVE DEBUG] VERIFICATION - Anchor world positions after canonicalization:');
      pathObj.customPoints.forEach((p, i) => {
        curveDebug(`[CURVE DEBUG]   anchor[${i}]: (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`);
      });

      // Check transform matrix
      const matrix = pathObj.calcTransformMatrix();
      curveDebug('[CURVE DEBUG] Final transform matrix:', matrix.map(v => v.toFixed(2)).join(', '));

      curveDebug('[CURVE DEBUG] ---- canonicalizeCurveFromWorldPoints END ----');
    };

    // Create a control for each point
    path.customPoints.forEach((point, index) => {
      const positionHandler = (dim, finalMatrix, fabricObject) => {
        if (!fabricObject.canvas) return { x: 0, y: 0 };

        const worldPoint = getCurveAnchorWorldPoint(fabricObject, index);
        const screenPoint = fabric.util.transformPoint(
          { x: worldPoint.x, y: worldPoint.y },
          fabricObject.canvas.viewportTransform
        );

        // Only log occasionally to avoid spam (every 60 frames roughly)
        if (!fabricObject.__posLogCounter) fabricObject.__posLogCounter = 0;
        fabricObject.__posLogCounter++;
        if (fabricObject.__posLogCounter % 60 === 1) {
          curveDebug(
            `[CURVE DEBUG] positionHandler[${index}]: worldPoint=(${worldPoint.x.toFixed(1)}, ${worldPoint.y.toFixed(1)}) -> screenPoint=(${screenPoint.x.toFixed(1)}, ${screenPoint.y.toFixed(1)})`
          );
        }

        return screenPoint;
      };

      // Track drag frame count for logging
      let dragFrameCount = 0;

      const actionHandler = (eventData, transform, x, y) => {
        const pathObj = transform.target;
        const canvas = pathObj.canvas;
        dragFrameCount++;

        // Log every frame for the first 5 frames, then every 10th frame
        const shouldLog = dragFrameCount <= 5 || dragFrameCount % 10 === 0;

        if (shouldLog) {
          curveDebug(`[CURVE DEBUG] ====== actionHandler[${index}] FRAME ${dragFrameCount} ======`);
        }

        // Resolve event object
        const event = eventData.e || eventData;

        // Get pointer and check for Ctrl key
        const rawPointer = canvas.getPointer(event);
        const isCtrlHeld = event.ctrlKey;

        if (shouldLog) {
          curveDebug(
            `[CURVE DEBUG] rawPointer: (${rawPointer.x.toFixed(1)}, ${rawPointer.y.toFixed(1)}), ctrlHeld: ${isCtrlHeld}`
          );
        }

        const snappedPointer = isCtrlHeld
          ? FabricControls.getSnapPoint(canvas, rawPointer, pathObj)
          : rawPointer;

        const pointer = resolvePointerWorldForCurve(pathObj, snappedPointer);

        if (shouldLog) {
          curveDebug(
            `[CURVE DEBUG] Final pointer for point update: (${pointer.x.toFixed(1)}, ${pointer.y.toFixed(1)})`
          );
          curveDebug(
            `[CURVE DEBUG] BEFORE update - point[${index}]: (${point.x.toFixed(1)}, ${point.y.toFixed(1)})`
          );
          curveDebug(
            `[CURVE DEBUG] All customPoints BEFORE:`,
            JSON.stringify(
              pathObj.customPoints.map(p => ({ x: p.x.toFixed(1), y: p.y.toFixed(1) }))
            )
          );
        }

        // Set flag to suppress moving event listener
        pathObj.isEditingControlPoint = true;

        // Capture stable base center at drag start
        const isFirstFrame = !pathObj.__curveEditBaseCenterWorld;
        if (isFirstFrame) {
          // IMPORTANT: Calculate center from customPoints directly, not from getCenterPoint()
          // The visual center can drift from the actual anchor positions after transforms
          const minX = Math.min(...pathObj.customPoints.map(p => p.x));
          const maxX = Math.max(...pathObj.customPoints.map(p => p.x));
          const minY = Math.min(...pathObj.customPoints.map(p => p.y));
          const maxY = Math.max(...pathObj.customPoints.map(p => p.y));
          pathObj.__curveEditBaseCenterWorld = {
            x: (minX + maxX) / 2,
            y: (minY + maxY) / 2,
          };
          curveDebug(
            `[CURVE DEBUG] FIRST FRAME - Calculated __curveEditBaseCenterWorld from customPoints: (${pathObj.__curveEditBaseCenterWorld.x.toFixed(1)}, ${pathObj.__curveEditBaseCenterWorld.y.toFixed(1)})`
          );

          // CRITICAL: Clear the transform state that may have been captured by before:transform
          // This prevents bakeCurveTransform from reverting our edits on mouse:up
          if (pathObj.__curveTransformActive) {
            curveDebug(
              '[CURVE DEBUG] FIRST FRAME - Clearing __curveTransformActive state (was set by before:transform)'
            );
            delete pathObj.__curveTransformActive;
            delete pathObj.__curveOrigMatrix;
            delete pathObj.__curveOrigPoints;
            delete pathObj.__curveBakedThisGesture;
          }

          if (!pathObj.__curveEditCleanup) {
            pathObj.__curveEditCleanup = () => {
              curveDebug('[CURVE DEBUG] mouse:up cleanup - clearing __curveEditBaseCenterWorld');
              const cleanup = pathObj.__curveEditCleanup;
              canvas.off('mouse:up', cleanup);
              delete pathObj.__curveEditBaseCenterWorld;
              delete pathObj.__curveEditCleanup;
              dragFrameCount = 0; // Reset for next drag
            };
            canvas.on('mouse:up', pathObj.__curveEditCleanup);
          }
        }

        // Update the point
        const oldX = point.x;
        const oldY = point.y;
        // Update customPoints by index to handle array replacement by canonicalizeCurveFromWorldPoints
        if (pathObj.customPoints[index]) {
          pathObj.customPoints[index].x = pointer.x;
          pathObj.customPoints[index].y = pointer.y;
        }

        const baseCenterWorld = pathObj.__curveEditBaseCenterWorld || pathObj.getCenterPoint();

        if (shouldLog) {
          curveDebug(
            `[CURVE DEBUG] Using baseCenterWorld: (${baseCenterWorld.x.toFixed(1)}, ${baseCenterWorld.y.toFixed(1)})`
          );
        }

        canonicalizeCurveFromWorldPoints(pathObj, baseCenterWorld);
        canvas.requestRenderAll();

        if (!pathObj.__curveTransformActive) {
          delete pathObj.__curveOrigMatrix;
          delete pathObj.__curveOrigPoints;
          delete pathObj.__curveBakedThisGesture;
        }

        // Clear the flag after a brief moment
        setTimeout(() => {
          pathObj.isEditingControlPoint = false;
        }, 0);

        if (shouldLog) {
          curveDebug(
            `[CURVE DEBUG] ====== actionHandler[${index}] FRAME ${dragFrameCount} END ======`
          );
        }

        return true;
      };

      path.controls[`p${index}`] = new fabric.Control({
        positionHandler: positionHandler,
        actionHandler: actionHandler,
        cursorStyle: 'pointer',
        actionName: 'modifyCurve',
        render: renderCircleControl,
      });
    });
  }

  /**
   * Adds custom controls to a fabric.Group representing an arrow
   * @param {fabric.Group} group - The arrow group (containing line and head)
   */
  static createArrowControls(group) {
    if (!group || group.type !== 'group') return;

    // Hide standard controls
    group.set({
      hasBorders: false,
      hasControls: true,
      cornerSize: 10,
      transparentCorners: false,
      cornerColor: '#ffffff',
      cornerStrokeColor: '#3b82f6',
      lockScalingX: true,
      lockScalingY: true,
      lockRotation: true,
    });

    // We assume the group has 2 objects: line (index 0) and head (index 1)
    // And that they were created in ArrowTool

    // Position handler for Start (Tail)
    const positionHandlerStart = (dim, finalMatrix, fabricObject) => {
      if (!fabricObject.canvas) return { x: 0, y: 0 };
      // We need the coordinates of the line's start point relative to the group
      // The line is centered in the group usually?
      // Actually, in ArrowTool, we group them. The group's center is the center of the bounding box.
      // The line's x1/y1 are relative to the group center if we use group.toLocalPoint?

      // Let's use the line object inside the group
      const line = fabricObject.getObjects()[0];
      if (!line || line.type !== 'line') return { x: 0, y: 0 };

      const points = line.calcLinePoints();
      // points are relative to line center.
      // line center is relative to group center.

      // Transform point from line local to group local
      const lineCenter = line.getCenterPoint();
      const x = points.x1 + lineCenter.x;
      const y = points.y1 + lineCenter.y;

      return fabric.util.transformPoint(
        { x: x, y: y },
        fabric.util.multiplyTransformMatrices(
          fabricObject.canvas.viewportTransform,
          fabricObject.calcTransformMatrix()
        )
      );
    };

    // Action handler for Start (Tail)
    const actionHandlerStart = (eventData, transform, x, y) => {
      const group = transform.target;
      const line = group.getObjects()[0];
      const head = group.getObjects()[1];
      const canvas = group.canvas;

      // Resolve event object
      const event = eventData.e || eventData;

      // Get raw pointer and apply snap if Ctrl is held
      const rawPointer = canvas.getPointer(event);
      const isCtrlHeld = event.ctrlKey;
      const pointer = isCtrlHeld
        ? FabricControls.getSnapPoint(canvas, rawPointer, group)
        : rawPointer;

      // Get absolute end point
      const matrix = group.calcTransformMatrix();
      const lineCenter = line.getCenterPoint();
      const points = line.calcLinePoints();
      const endLocal = { x: points.x2 + lineCenter.x, y: points.y2 + lineCenter.y };
      const endAbs = fabric.util.transformPoint(endLocal, matrix);

      group._restoreObjectsState();

      // Now line and head are absolute.
      line.set({ x1: pointer.x, y1: pointer.y, x2: endAbs.x, y2: endAbs.y });
      line._setWidthHeight();

      const dx2 = endAbs.x - pointer.x;
      const dy2 = endAbs.y - pointer.y;
      const angle2 = (Math.atan2(dy2, dx2) * 180) / Math.PI + 90;

      head.set({ left: endAbs.x, top: endAbs.y, angle: angle2 });

      group._calcBounds();
      group._updateObjectsCoords();
      group.setCoords();

      return true;
    };

    // Position handler for End (Head)
    const positionHandlerEnd = (dim, finalMatrix, fabricObject) => {
      if (!fabricObject.canvas) return { x: 0, y: 0 };
      const line = fabricObject.getObjects()[0];
      if (!line) return { x: 0, y: 0 };

      const points = line.calcLinePoints();
      const lineCenter = line.getCenterPoint();
      const x = points.x2 + lineCenter.x;
      const y = points.y2 + lineCenter.y;

      return fabric.util.transformPoint(
        { x: x, y: y },
        fabric.util.multiplyTransformMatrices(
          fabricObject.canvas.viewportTransform,
          fabricObject.calcTransformMatrix()
        )
      );
    };

    // Action handler for End (Head)
    const actionHandlerEnd = (eventData, transform, x, y) => {
      const group = transform.target;
      const line = group.getObjects()[0];
      const head = group.getObjects()[1];
      const canvas = group.canvas;

      // Resolve event object
      const event = eventData.e || eventData;

      // Get raw pointer and apply snap if Ctrl is held
      const rawPointer = canvas.getPointer(event);
      const isCtrlHeld = event.ctrlKey;
      const pointer = isCtrlHeld
        ? FabricControls.getSnapPoint(canvas, rawPointer, group)
        : rawPointer;

      group._restoreObjectsState();

      // Get current absolute start
      const startAbs = { x: line.x1, y: line.y1 };

      // Update Line
      line.set({ x2: pointer.x, y2: pointer.y });
      line._setWidthHeight();

      // Update Head
      const dx = pointer.x - startAbs.x;
      const dy = pointer.y - startAbs.y;
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;

      head.set({ left: pointer.x, top: pointer.y, angle: angle });

      group._calcBounds();
      group._updateObjectsCoords();
      group.setCoords();

      return true;
    };

    group.controls = {
      p1: new fabric.Control({
        positionHandler: positionHandlerStart,
        actionHandler: actionHandlerStart,
        cursorStyle: 'pointer',
        actionName: 'modifyArrow',
        render: renderCircleControl,
      }),
      p2: new fabric.Control({
        positionHandler: positionHandlerEnd,
        actionHandler: actionHandlerEnd,
        cursorStyle: 'pointer',
        actionName: 'modifyArrow',
        render: renderCircleControl,
      }),
    };
  }
}

/**
 * Helper to render a circle control
 */
function renderCircleControl(ctx, left, top, styleOverride, fabricObject) {
  styleOverride = styleOverride || {};
  const size = styleOverride.cornerSize || fabricObject.cornerSize;
  const transparentCorners = styleOverride.transparentCorners || fabricObject.transparentCorners;
  const methodName = transparentCorners ? 'stroke' : 'fill';
  const stroke =
    !transparentCorners && (styleOverride.cornerStrokeColor || fabricObject.cornerStrokeColor);

  ctx.save();
  ctx.fillStyle = styleOverride.cornerColor || fabricObject.cornerColor;
  ctx.strokeStyle = styleOverride.cornerStrokeColor || fabricObject.cornerStrokeColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(left, top, size / 2, 0, 2 * Math.PI, false);
  ctx[methodName]();
  if (stroke) {
    ctx.stroke();
  }
  ctx.restore();
}
