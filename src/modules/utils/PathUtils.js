/**
 * PathUtils.js
 * Utilities for generating SVG paths
 */

export class PathUtils {
  /**
   * Creates a smooth SVG path string from an array of points
   * @param {Array<{x: number, y: number}>} points - Array of point objects
   * @returns {string} SVG path string
   */
  static createSmoothPath(points) {
    if (!points || points.length < 2) return '';

    // Start path
    let path = `M ${points[0].x} ${points[0].y}`;

    if (points.length === 2) {
      // Simple line for 2 points
      path += ` L ${points[1].x} ${points[1].y}`;
    } else {
      // Create smooth bezier curves through points
      for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        const curr = points[i];
        const next = points[i + 1] || curr;

        // Calculate control points for smooth curve
        // Tension factor 0.3 gives a good balance between smooth and tight
        const dx1 = (curr.x - prev.x) * 0.3;
        const dy1 = (curr.y - prev.y) * 0.3;
        const dx2 = (next.x - curr.x) * 0.3;
        const dy2 = (next.y - curr.y) * 0.3;

        const cp1x = prev.x + dx1;
        const cp1y = prev.y + dy1;
        const cp2x = curr.x - dx2;
        const cp2y = curr.y - dy2;

        // Use cubic bezier curve
        path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${curr.x} ${curr.y}`;
      }
    }

    return path;
  }

  static updatePathFromAbsolutePoints(pathObj, points, centerPoint = null) {
    if (!pathObj || !points || points.length === 0) return;

    const centerAbs = centerPoint || pathObj.getCenterPoint();
    const localPoints = points.map(point => ({
      x: point.x - centerAbs.x,
      y: point.y - centerAbs.y,
    }));

    const newPathString = PathUtils.createSmoothPath(localPoints);
    const pathData = fabric.util.parsePath(newPathString);

    pathObj.set({ path: pathData });

    const dims = pathObj._calcDimensions();
    pathObj.set({
      width: dims.width,
      height: dims.height,
      pathOffset: new fabric.Point(dims.left + dims.width / 2, dims.top + dims.height / 2),
    });

    pathObj.setPositionByOrigin(centerAbs, 'center', 'center');
    pathObj.dirty = true;
    pathObj.setCoords();
  }
}
