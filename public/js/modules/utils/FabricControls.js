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
    console.log(`[FabricControls] getSnapPoint checking ${objects.length} objects`);

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
        console.warn('[FabricControls] Error finding closest point:', e);
      }
    }

    // Show/hide snap indicator
    if (closestPoint) {
      console.log('[FabricControls] Found snap point:', closestPoint);
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
   * Adds custom controls to a fabric.Line object for endpoint manipulation
   * @param {fabric.Line} line - The line object
   */
  static createLineControls(line) {
    if (!line) return;

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
        console.log('[FabricControls] Line start - Ctrl held, checking for snap');
      }

      const pointer = isCtrlHeld
        ? FabricControls.getSnapPoint(canvas, rawPointer, lineObj)
        : rawPointer;

      if (isCtrlHeld && pointer !== rawPointer) {
        console.log('[FabricControls] Line start snapped to:', pointer);
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

      // Resolve event object (eventData might be the event itself or a wrapper)
      const event = eventData.e || eventData;

      // Get pointer and check for Ctrl key (screen space)
      const rawPointer = canvas.getPointer(event);
      const isCtrlHeld = event.ctrlKey;

      if (isCtrlHeld) {
        console.log('[FabricControls] Line end - Ctrl held, checking for snap');
      }

      const pointer = isCtrlHeld
        ? FabricControls.getSnapPoint(canvas, rawPointer, lineObj)
        : rawPointer;

      if (isCtrlHeld && pointer !== rawPointer) {
        console.log('[FabricControls] Line end snapped to:', pointer);
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
    if (!path || !path.customPoints) return;

    // Keep points in ABSOLUTE canvas coordinates - simpler and more reliable
    // No conversion needed, points are already where they should be

    // Clear existing controls to prevent duplicates and stale closures
    path.controls = {};

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
      lockRotation: false, // Allow rotation
    });

    path.controls = {};

    // Create a control for each point
    path.customPoints.forEach((point, index) => {
      const positionHandler = (dim, finalMatrix, fabricObject) => {
        if (!fabricObject.canvas) return { x: 0, y: 0 };

        // Points are stored in ABSOLUTE canvas coordinates
        // Just apply viewport transform for rendering
        return fabric.util.transformPoint(
          { x: point.x, y: point.y },
          fabricObject.canvas.viewportTransform
        );
      };

      const actionHandler = (eventData, transform, x, y) => {
        const pathObj = transform.target;
        const canvas = pathObj.canvas;

        // Resolve event object (eventData might be the event itself or a wrapper)
        const event = eventData.e || eventData;

        // Use x, y from Fabric (already in canvas coordinates)
        let pointer = { x, y };
        const isCtrlHeld = event.ctrlKey;

        // Apply snap if Ctrl is held
        if (isCtrlHeld) {
          pointer = FabricControls.getSnapPoint(canvas, pointer, pathObj);
        }

        // Set flag to suppress moving event listener
        pathObj.isEditingControlPoint = true;

        // Update the point in ABSOLUTE canvas coordinates
        point.x = pointer.x;
        point.y = pointer.y;

        // Regenerate the path string from ABSOLUTE points
        const newPathString = PathUtils.createSmoothPath(pathObj.customPoints);
        const pathData = fabric.util.parsePath(newPathString);

        // Store current center before path change
        const prevCenter = pathObj.getCenterPoint();

        // Update the path
        pathObj.set({ path: pathData });

        // Recalculate dimensions and keep centered at same position
        const dims = pathObj._calcDimensions();
        pathObj.set({
          width: dims.width,
          height: dims.height,
          pathOffset: { x: dims.left + dims.width / 2, y: dims.top + dims.height / 2 },
        });

        // Keep the object at the same center position
        pathObj.setPositionByOrigin(prevCenter, 'center', 'center');

        pathObj.dirty = true;
        pathObj.setCoords();
        canvas.requestRenderAll();

        // Clear the flag after a brief moment
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
   * Convert absolute canvas coordinates to relative (object-local) coordinates
   * @param {fabric.Path} pathObj - The path object with customPoints
   */
  static _convertPointsToRelative(pathObj) {
    if (!pathObj.customPoints || pathObj.customPoints.length === 0) return;

    // Get the object's current transform matrix
    const objectMatrix = pathObj.calcTransformMatrix();
    const invertedMatrix = fabric.util.invertTransform(objectMatrix);

    // Convert each point to relative coordinates
    pathObj.customPoints = pathObj.customPoints.map(point => {
      const relativePoint = fabric.util.transformPoint({ x: point.x, y: point.y }, invertedMatrix);
      return relativePoint;
    });

    console.log(
      '[FabricControls] Converted',
      pathObj.customPoints.length,
      'points to relative coordinates'
    );
  }

  /**
   * Convert relative (object-local) coordinates to absolute canvas coordinates
   * @param {fabric.Path} pathObj - The path object with relative customPoints
   * @returns {Array<{x: number, y: number}>} - Absolute canvas coordinates
   */
  static _convertPointsToAbsolute(pathObj) {
    if (!pathObj.customPoints || pathObj.customPoints.length === 0) return [];

    // Get the object's current transform matrix
    const objectMatrix = pathObj.calcTransformMatrix();

    // Convert each relative point to absolute coordinates
    return pathObj.customPoints.map(point => {
      return fabric.util.transformPoint({ x: point.x, y: point.y }, objectMatrix);
    });
  }

  /**
   * Convert relative points to path-local coordinates (without rotation)
   * Used for regenerating the path shape without baking in rotation
   * @param {fabric.Path} pathObj - The path object with relative customPoints
   * @returns {Array<{x: number, y: number}>} - Path-local coordinates
   */
  static _convertPointsToPathLocal(pathObj) {
    if (!pathObj.customPoints || pathObj.customPoints.length === 0) return [];

    // Create transform matrix without rotation
    const scaleX = pathObj.scaleX || 1;
    const scaleY = pathObj.scaleY || 1;
    const left = pathObj.left || 0;
    const top = pathObj.top || 0;

    // Transform points by scale and position only (no rotation)
    return pathObj.customPoints.map(point => {
      return {
        x: point.x * scaleX + left,
        y: point.y * scaleY + top,
      };
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
      const isCtrlHeld = event.ctrlKey;

      // x, y are already in canvas coordinates (provided by Fabric.js)
      let pointer = { x, y };
      if (isCtrlHeld) {
        pointer = FabricControls.getSnapPoint(canvas, pointer, group);
      }

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
      const isCtrlHeld = event.ctrlKey;

      // x, y are already in canvas coordinates (provided by Fabric.js)
      let pointer = { x, y };
      if (isCtrlHeld) {
        pointer = FabricControls.getSnapPoint(canvas, pointer, group);
      }

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
