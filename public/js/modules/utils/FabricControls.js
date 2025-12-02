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
    /**
     * Adds custom controls to a fabric.Line object for endpoint manipulation
     * @param {fabric.Line} line - The line object
     */
  static createLineControls(line) {
    if (!line) return;

    console.log('[FabricControls] Creating custom controls for line', line);

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

      // Get pointer and check for Ctrl key
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

      // Update x1, y1 based on snapped or raw position
      lineObj.set({ x1: pointer.x, y1: pointer.y });

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

      // Get pointer and check for Ctrl key
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

      lineObj.set({ x2: pointer.x, y2: pointer.y });
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

    // Create a control for each point
    path.customPoints.forEach((point, index) => {
      const positionHandler = (dim, finalMatrix, fabricObject) => {
        if (!fabricObject.canvas) return { x: 0, y: 0 };
        // The point coordinates are absolute canvas coordinates
        // We need to transform them to screen coordinates for the control

        // However, if the object has moved, the points are relative to the object's new position?
        // No, customPoints are stored as absolute coordinates from creation time.
        // If the object moves, we need to account for that.
        // BUT, for simplicity, let's assume we are editing the path in place.
        // If the user moves the whole path, the customPoints need to be updated or offset.

        // Better approach:
        // When the path is moved (modified), we should update customPoints?
        // Or, we treat customPoints as relative to the object center?

        // Let's try keeping customPoints as absolute and updating them when the control is dragged.
        // If the object itself is moved, we might have a disconnect.
        // For now, let's assume the object stays in place or we update points on move.

        // Actually, to make controls follow the object if it moves:
        // We should probably map the point to the object's coordinate space.
        // But path points are complex.

        // Let's stick to the "absolute points" model for now, as that's how the curve tool works.
        // If the user moves the curve group, we might need to re-calculate points.
        // For this task, let's assume we are just manipulating the points.

        return fabric.util.transformPoint(
          { x: point.x, y: point.y },
          fabricObject.canvas.viewportTransform
        );
      };

      const actionHandler = (eventData, transform, x, y) => {
        const pathObj = transform.target;
        const canvas = pathObj.canvas;

        // Resolve event object
        const event = eventData.e || eventData;

        // Get pointer and check for Ctrl key
        const rawPointer = canvas.getPointer(event);
        const isCtrlHeld = event.ctrlKey;

        const pointer = isCtrlHeld
          ? FabricControls.getSnapPoint(canvas, rawPointer, pathObj)
          : rawPointer;

        // Set flag to suppress moving event listener
        pathObj.isEditingControlPoint = true;

        // Update the point
        point.x = pointer.x;
        point.y = pointer.y;

        // Regenerate the path string
        const newPathString = PathUtils.createSmoothPath(pathObj.customPoints);

        // Update the path object
        // Note: setting 'path' directly might not work as expected in Fabric v4/v5
        // We might need to create a new path or use set({ path: ... }) if supported
        // Or use internal methods.

        // Fabric.js doesn't easily support changing the path data of an existing Path object dynamically
        // without some internal hacking or replacing the object.
        // However, we can try updating the path array if it exists, or recreating the object.

        // A common trick is to update the 'path' property and call _setPath?
        // Or just replace the object? Replacing breaks the selection.

        // Let's try to update the path data.
        // In Fabric.js, path is stored in .path array.
        // We can parse the new string and update .path

        // Actually, for smooth interaction, replacing the path string and letting Fabric re-parse is best if possible.
        // But Fabric doesn't expose a public API for this easily.

        // Workaround:
        // 1. Generate new path data
        // 2. Update the object's path data
        // 3. Update dimensions (width/height/top/left) because changing path changes bounding box

        // Let's try a safer approach:
        // We can't easily mutate a fabric.Path in place.
        // But we can try to use a Polyline/Polygon if we didn't need curves.
        // Since we need curves, we might have to deal with the complexity.

        // Alternative:
        // Instead of a real fabric.Path, use a custom subclass or just accept that we might need to
        // re-initialize the path data.

        // Let's try this:
        // fabric.Path.prototype.initialize(pathData) might work to reset it?

        // Let's try to just update the path array manually if we can parse it.
        // Or use fabric.util.parsePath(newPathString)

        const pathData = fabric.util.parsePath(newPathString);
        pathObj.set({ path: pathData });

        // We also need to update dimensions because the bounding box changes
        const dims = pathObj._calcDimensions();
        pathObj.set({
          width: dims.width,
          height: dims.height,
          pathOffset: { x: dims.left + dims.width / 2, y: dims.top + dims.height / 2 },
        });

        // And we need to ensure the object position remains correct relative to the points
        // This is the hard part. When path changes, center changes.
        // We might need to adjust top/left to match the new bounding box.
        pathObj.setPositionByOrigin(
          new fabric.Point(dims.left + dims.width / 2, dims.top + dims.height / 2),
          'center',
          'center'
        );

        // Mark object as dirty and request canvas redraw to prevent artifacts
        pathObj.dirty = true;
        pathObj.setCoords();
        canvas.requestRenderAll();

        // Clear the flag after a brief moment
        setTimeout(() => {
          pathObj.isEditingControlPoint = false;
        }, 0);

        // These moving events were causing the whole curve to move - removed
        // pathObj.fire('moving');
        // pathObj.fire('moving');
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
