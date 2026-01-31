/**
 * FabricControls.js
 * Custom Fabric.js controls for line and curve manipulation
 */

import { PathUtils } from './PathUtils.js';

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

    pathObj.setPositionByOrigin(compensatedWorldCenter, 'center', 'center');

    // Update tracking for move handlers
    pathObj.lastLeft = pathObj.left;
    pathObj.lastTop = pathObj.top;
    const updatedCenter = pathObj.getCenterPoint();
    pathObj.__lastCenter = { x: updatedCenter.x, y: updatedCenter.y };

    // Force cache invalidation and render
    pathObj.objectCaching = false;
    pathObj.dirty = true;
    pathObj.setCoords();
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
    const initialCenter = path.getCenterPoint();
    path.__lastCenter = { x: initialCenter.x, y: initialCenter.y };

    // Hide standard controls but enable custom ones
    path.set({
      hasBorders: false,
      hasControls: true,
      cornerSize: 12,
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
        if (scaleX !== 1 || scaleY !== 1) {
          const center = activeObj.getCenterPoint();
          const scaledX = center.x + (currentPoint.x - center.x) * scaleX;
          const scaledY = center.y + (currentPoint.y - center.y) * scaleY;
          curveDebug(
            `[CURVE DEBUG] getCurveAnchorWorldPoint(${pointIndex}): ACTIVE SELECTION SCALING (gesture active), scale=(${scaleX.toFixed(2)}, ${scaleY.toFixed(2)})`
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
          `[CURVE DEBUG] getCurveAnchorWorldPoint(${pointIndex}): CURVE DIRECT SCALING (gesture active)`
        );
        return new fabric.Point(scaledX, scaledY);
      }

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
        return { x: canonical.x, y: canonical.y };
      }

      return pointerWorld;
    };

    const toLocalPoints = (pointsWorld, centerWorld) =>
      pointsWorld.map(p => ({
        x: p.x - centerWorld.x,
        y: p.y - centerWorld.y,
      }));

    const canonicalizeCurveFromWorldPoints = (pathObj, baseCenterWorld) => {
      const localPoints = toLocalPoints(pathObj.customPoints, baseCenterWorld);
      const newPathString = PathUtils.createSmoothPath(localPoints);
      const pathData = fabric.util.parsePath(newPathString);

      pathObj.set({ path: pathData, angle: 0 });
      pathObj.set({
        scaleX: 1,
        scaleY: 1,
        skewX: 0,
        skewY: 0,
        flipX: false,
        flipY: false,
      });

      const dims = pathObj._calcDimensions();
      const centerLocal = new fabric.Point(dims.left + dims.width / 2, dims.top + dims.height / 2);

      pathObj.set({
        width: dims.width,
        height: dims.height,
        pathOffset: centerLocal,
      });

      const compensatedWorldCenter = new fabric.Point(
        baseCenterWorld.x + centerLocal.x,
        baseCenterWorld.y + centerLocal.y
      );

      pathObj.setPositionByOrigin(compensatedWorldCenter, 'center', 'center');
      pathObj.lastLeft = pathObj.left;
      pathObj.lastTop = pathObj.top;
      const updatedCenter = pathObj.getCenterPoint();
      pathObj.__lastCenter = { x: updatedCenter.x, y: updatedCenter.y };
      pathObj.dirty = true;
      pathObj.setCoords();
    };

    // Create a control for each point
    path.customPoints.forEach((point, index) => {
      const positionHandler = (dim, finalMatrix, fabricObject) => {
        if (!fabricObject.canvas) return { x: 0, y: 0 };

        const worldPoint = getCurveAnchorWorldPoint(fabricObject, index);
        return fabric.util.transformPoint(
          { x: worldPoint.x, y: worldPoint.y },
          fabricObject.canvas.viewportTransform
        );
      };

      const actionHandler = (eventData, transform, x, y) => {
        const pathObj = transform.target;
        const canvas = pathObj.canvas;
        const event = eventData.e || eventData;
        const rawPointer = canvas.getPointer(event);
        const isCtrlHeld = event.ctrlKey;

        const snappedPointer = isCtrlHeld
          ? FabricControls.getSnapPoint(canvas, rawPointer, pathObj)
          : rawPointer;

        const pointer = resolvePointerWorldForCurve(pathObj, snappedPointer);

        pathObj.isEditingControlPoint = true;

        if (!pathObj.__curveEditBaseCenterWorld) {
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

          if (pathObj.__curveTransformActive) {
            delete pathObj.__curveTransformActive;
            delete pathObj.__curveOrigMatrix;
            delete pathObj.__curveOrigPoints;
            delete pathObj.__curveBakedThisGesture;
          }

          if (!pathObj.__curveEditCleanup) {
            pathObj.__curveEditCleanup = () => {
              const cleanup = pathObj.__curveEditCleanup;
              canvas.off('mouse:up', cleanup);
              delete pathObj.__curveEditBaseCenterWorld;
              delete pathObj.__curveEditCleanup;
            };
            canvas.on('mouse:up', pathObj.__curveEditCleanup);
          }
        }

        point.x = pointer.x;
        point.y = pointer.y;

        const baseCenterWorld = pathObj.__curveEditBaseCenterWorld || pathObj.getCenterPoint();
        canonicalizeCurveFromWorldPoints(pathObj, baseCenterWorld);
        canvas.requestRenderAll();

        if (!pathObj.__curveTransformActive) {
          delete pathObj.__curveOrigMatrix;
          delete pathObj.__curveOrigPoints;
          delete pathObj.__curveBakedThisGesture;
        }

        setTimeout(() => {
          pathObj.isEditingControlPoint = false;
        }, 0);

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

    // Position handler for Start (Tail)
    const positionHandlerStart = (dim, finalMatrix, fabricObject) => {
      if (!fabricObject.canvas) return { x: 0, y: 0 };
      const line = fabricObject.getObjects()[0];
      if (!line || line.type !== 'line') return { x: 0, y: 0 };

      const points = line.calcLinePoints();
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

      const event = eventData.e || eventData;
      const rawPointer = canvas.getPointer(event);
      const isCtrlHeld = event.ctrlKey;
      const pointer = isCtrlHeld
        ? FabricControls.getSnapPoint(canvas, rawPointer, group)
        : rawPointer;

      const matrix = group.calcTransformMatrix();
      const lineCenter = line.getCenterPoint();
      const points = line.calcLinePoints();
      const endLocal = { x: points.x2 + lineCenter.x, y: points.y2 + lineCenter.y };
      const endAbs = fabric.util.transformPoint(endLocal, matrix);

      group._restoreObjectsState();

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

      const event = eventData.e || eventData;
      const rawPointer = canvas.getPointer(event);
      const isCtrlHeld = event.ctrlKey;
      const pointer = isCtrlHeld
        ? FabricControls.getSnapPoint(canvas, rawPointer, group)
        : rawPointer;

      group._restoreObjectsState();

      const startAbs = { x: line.x1, y: line.y1 };

      line.set({ x2: pointer.x, y2: pointer.y });
      line._setWidthHeight();

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
