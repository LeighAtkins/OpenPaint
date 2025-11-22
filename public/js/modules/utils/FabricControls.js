/**
 * FabricControls.js
 * Custom Fabric.js controls for line and curve manipulation
 */

import { PathUtils } from './PathUtils.js';

export class FabricControls {
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
            lockRotation: true
        });

        // Define the position handler for the starting point (x1, y1)
        const positionHandlerStart = (dim, finalMatrix, fabricObject) => {
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
            
            // Convert mouse coordinate to local coordinate system
            const localPoint = lineObj.toLocalPoint(new fabric.Point(x, y), 'center', 'center');
            
            // Update x1, y1 based on mouse position relative to object center
            // Note: fabric.Line coordinates are relative to its center when origin is center
            // But x1/y1/x2/y2 are absolute coordinates in the line's internal logic
            // However, when dragging, we need to update the actual property values
            
            // Simpler approach: Calculate new absolute coordinates
            const pointer = canvas.getPointer(eventData.e);
            lineObj.set({ x1: pointer.x, y1: pointer.y });
            
            // Recalculate dimensions and position
            // This is tricky with Fabric lines as changing x1/y1 shifts the center
            // We might need a more robust way if this jumps around
            
            // Fire moving event to trigger updates (like tag connectors)
            lineObj.fire('moving');
            
            return true;
        };

        // Define the position handler for the ending point (x2, y2)
        const positionHandlerEnd = (dim, finalMatrix, fabricObject) => {
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
            const pointer = canvas.getPointer(eventData.e);
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
                render: renderCircleControl
            }),
            p2: new fabric.Control({
                positionHandler: positionHandlerEnd,
                actionHandler: actionHandlerEnd,
                cursorStyle: 'pointer',
                actionName: 'modifyLine',
                render: renderCircleControl
            })
        };
    }

    /**
     * Adds custom controls to a fabric.Path object (curve) for point manipulation
     * @param {fabric.Path} path - The path object
     */
    static createCurveControls(path) {
        if (!path || !path.customPoints) return;

        // Hide standard controls
        path.set({
            hasBorders: false,
            hasControls: false,
            cornerSize: 8,
            transparentCorners: false,
            cornerColor: '#ffffff',
            cornerStrokeColor: '#3b82f6',
            lockScalingX: true,
            lockScalingY: true,
            lockRotation: true
        });

        path.controls = {};

        // Create a control for each point
        path.customPoints.forEach((point, index) => {
            const positionHandler = (dim, finalMatrix, fabricObject) => {
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
                const pointer = canvas.getPointer(eventData.e);
                
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
                    pathOffset: { x: dims.left + dims.width / 2, y: dims.top + dims.height / 2 }
                });
                
                // And we need to ensure the object position remains correct relative to the points
                // This is the hard part. When path changes, center changes.
                // We might need to adjust top/left to match the new bounding box.
                pathObj.setPositionByOrigin(
                    new fabric.Point(dims.left + dims.width / 2, dims.top + dims.height / 2), 
                    'center', 
                    'center'
                );
                
                pathObj.fire('moving');
                pathObj.fire('moving');
                return true;
            };

            path.controls[`p${index}`] = new fabric.Control({
                positionHandler: positionHandler,
                actionHandler: actionHandler,
                cursorStyle: 'pointer',
                actionName: 'modifyCurve',
                render: renderCircleControl
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
            lockRotation: true
        });

        // We assume the group has 2 objects: line (index 0) and head (index 1)
        // And that they were created in ArrowTool

        // Position handler for Start (Tail)
        const positionHandlerStart = (dim, finalMatrix, fabricObject) => {
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
            const pointer = canvas.getPointer(eventData.e);

            // We need to update the line's coordinates.
            // But we are inside a group.
            // The easiest way is to update the objects and then update the group.
            // However, updating objects inside a group is tricky because group matrix applies.

            // Strategy:
            // 1. Get current absolute coordinates of start and end.
            // 2. Update start to new pointer.
            // 3. Re-create the arrow geometry (line + head).
            // 4. Update group.

            // Actually, simpler:
            // Convert pointer to group local coordinates?
            // No, if we change the shape, the group center changes.

            // Robust strategy for modifying groups:
            // 1. Destroy group (ungroup).
            // 2. Update objects.
            // 3. Re-group.
            // This breaks selection and might be jarring.

            // Alternative:
            // Use the fact that we know it's an arrow.
            // We can implement a custom 'drag' that just redraws the arrow.

            // Let's try to update the internal objects relative to the group?
            // If we move the tail, the group's bounding box changes.
            // Fabric's `group.addWithUpdate()` handles this but it's heavy.

            // Let's try this:
            // Calculate new absolute start and end points.
            // Start = pointer.
            // End = current absolute end.

            // Get absolute end point
            const matrix = group.calcTransformMatrix();
            const lineCenter = line.getCenterPoint();
            const points = line.calcLinePoints();
            const endLocal = { x: points.x2 + lineCenter.x, y: points.y2 + lineCenter.y };
            const endAbs = fabric.util.transformPoint(endLocal, matrix);

            const startAbs = pointer;

            // Now we have new Start and End absolute coordinates.
            // We can update the group position and the internal objects.
            // But updating internal objects is hard.

            // HACK:
            // Remove the group, create a new group with updated arrow, add to canvas, select it.
            // This ensures everything is correct.
            // But we need to preserve properties (id, metadata, etc).

            // Let's try to modify in place if possible.
            // If we only modify the line and head, we can call `group.dirty = true`.
            // But the group's center will be wrong if we don't update it.

            // Let's assume for now we just want to move the point.
            // If we use `group.toLocalPoint(pointer)`, we get the new local start.
            // We update line.x1/y1.
            // Then we call `group.addWithUpdate()`.

            const localPoint = group.toLocalPoint(new fabric.Point(pointer.x, pointer.y), 'center', 'center');

            // Update line
            // Line x1/y1 are relative to line center? No, we need to set them relative to group center?
            // Fabric group objects are stored relative to group center (originX/Y center).

            // If we update line.x1, we change the line's shape.
            // We need to set line coords.

            // Actually, `line.set({ x1: ... })` works if we are careful.
            // But `line` inside group has coordinates relative to group center.

            // Let's try:
            // 1. Calculate new line coordinates relative to group center.
            // The line object itself has a position (left, top) relative to group center.
            // And it has x1, y1, x2, y2.

            // This is getting too complex for a quick fix.
            // Maybe we can just use the "Ungroup -> Update -> Regroup" strategy?
            // It's robust.

            // But wait, `ArrowTool` creates a group.
            // If I ungroup, it becomes 2 objects.
            // I need to regroup them.

            // Let's try to just update the group's objects and call `group.setObjectsCoords()`?
            // And `group.addWithUpdate()`?

            // Let's try:
            // 1. Get local start/end points relative to group.
            // 2. Update line and head.
            // 3. Trigger update.

            // Current End Point (Local to Group)
            const endLocal2 = { x: points.x2 + lineCenter.x, y: points.y2 + lineCenter.y };

            // New Start Point (Local to Group)
            // localPoint is relative to group center.

            // We need to update the line to go from localPoint to endLocal2.
            // But `fabric.Line` inside group is just an object.
            // We can remove the old line and add a new one?
            // Or update the existing one.

            // Updating `fabric.Line` is tricky because of the center shift.
            // Let's try to just set `x1, y1, x2, y2` to the new local coords?
            // `fabric.Line` doesn't support setting x1/y1/x2/y2 easily after creation if inside a group?

            // Let's try a simpler approach for Arrow:
            // Just support moving the whole arrow for now?
            // No, user wants to manipulate "lines".

            // OK, I will implement the "Re-create" strategy.
            // It's safe.

            // 1. Calculate new absolute coordinates.
            // 2. Remove old group.
            // 3. Create new arrow (Line + Head).
            // 4. Group them.
            // 5. Add to canvas.
            // 6. Copy metadata.
            // 7. Select new group.

            // This might flicker, but it works.

            // Wait, `actionHandler` must return true/false. It runs on drag.
            // Re-creating on every drag frame is expensive and might lose capture.

            // Better:
            // Just update the objects and use `group.addWithUpdate(null)`.
            // This recalculates the group's bounding box and center.

            // Update Line:
            // We need to set the line's `x1, y1, x2, y2`.
            // But `fabric.Line` inside group...
            // Let's just set the line's `set({ x1: ..., y1: ..., x2: ..., y2: ... })`.
            // The coordinates must be relative to the group center?
            // No, `addWithUpdate` expects objects to be in *group* coordinates?
            // Actually `addWithUpdate` re-groups objects. It expects objects to have coordinates relative to *canvas*?
            // No, relative to group?

            // Let's look at `group.addWithUpdate()`.
            // It removes objects, calculates new group props, adds objects back.
            // It expects objects to be in *absolute* coordinates (canvas space) if passed?
            // No, it uses the objects' current state.

            // Let's try this:
            // 1. Convert everything to absolute.
            // 2. Update line and head in absolute coords.
            // 3. Call `group.addWithUpdate()`.

            // Get absolute end point
            const endAbs2 = fabric.util.transformPoint(endLocal, matrix);

            // New absolute start is `pointer`.

            // Update Line (Absolute)
            line.set({
                x1: pointer.x,
                y1: pointer.y,
                x2: endAbs2.x,
                y2: endAbs2.y,
                // We need to reset left/top/width/height for the line to be correct
                // fabric.Line does this on set?
            });
            // Force line recalc
            line._setWidthHeight();

            // Update Head (Absolute)
            // Head is at endAbs2.
            // Angle needs update.
            const dx = endAbs2.x - pointer.x;
            const dy = endAbs2.y - pointer.y;
            const angle = Math.atan2(dy, dx) * 180 / Math.PI + 90;

            head.set({
                left: endAbs2.x,
                top: endAbs2.y,
                angle: angle
            });

            // Now objects are in absolute space (conceptually).
            // But they are children of the group.
            // We need to tell the group to re-ingest them.

            // `group.removeWithUpdate(line)`?
            // `group.remove(line)`?

            // Actually, `group.addWithUpdate()` is for adding *new* objects.
            // To update existing:
            // `group._restoreObjectsState()` -> converts children to absolute.
            // Update children.
            // `group._calcBounds()` -> recalculates group.
            // `group._updateObjectsCoords()` -> converts children back to relative.
            // `group.setCoords()`.

            // This is the way.

            group._restoreObjectsState();

            // Now line and head are absolute.
            line.set({ x1: pointer.x, y1: pointer.y, x2: endAbs2.x, y2: endAbs2.y });
            line._setWidthHeight();

            const dx2 = endAbs2.x - pointer.x;
            const dy2 = endAbs2.y - pointer.y;
            const angle2 = Math.atan2(dy2, dx2) * 180 / Math.PI + 90;

            head.set({ left: endAbs2.x, top: endAbs2.y, angle: angle2 });

            group._calcBounds();
            group._updateObjectsCoords();
            group.setCoords();

            return true;
        };

        // Position handler for End (Head)
        const positionHandlerEnd = (dim, finalMatrix, fabricObject) => {
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
            const pointer = canvas.getPointer(eventData.e);

            group._restoreObjectsState();

            // Get current absolute start
            // We can use line.x1/y1 since we restored state
            const startAbs = { x: line.x1, y: line.y1 };

            // Update Line
            line.set({ x2: pointer.x, y2: pointer.y });
            line._setWidthHeight();

            // Update Head
            const dx = pointer.x - startAbs.x;
            const dy = pointer.y - startAbs.y;
            const angle = Math.atan2(dy, dx) * 180 / Math.PI + 90;

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
                render: renderCircleControl
            }),
            p2: new fabric.Control({
                positionHandler: positionHandlerEnd,
                actionHandler: actionHandlerEnd,
                cursorStyle: 'pointer',
                actionName: 'modifyArrow',
                render: renderCircleControl
            })
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
    const stroke = !transparentCorners && (styleOverride.cornerStrokeColor || fabricObject.cornerStrokeColor);
    
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

