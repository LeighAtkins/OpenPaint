/**
 * PathUtils.js
 * Utilities for generating SVG paths and geometric calculations
 */

export class PathUtils {
  /**
   * Creates a smooth SVG path string from an array of points using Catmull-Rom splines
   * @param {Array<{x: number, y: number}>} points - Array of point objects
   * @param {number} tension - Curve tension (0 = sharp corners, 1 = smooth). Default 0.5
   * @returns {string} SVG path string
   */
  static createSmoothPath(points, tension = 0.5) {
    if (!points || points.length < 2) return '';

    // Start path
    let path = `M ${points[0].x} ${points[0].y}`;

    if (points.length === 2) {
      // Simple line for 2 points
      path += ` L ${points[1].x} ${points[1].y}`;
    } else {
      // Use Catmull-Rom to Bezier conversion for smooth curves through all points
      // This creates curves that pass exactly through each anchor point
      for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i === 0 ? 0 : i - 1];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[i + 2 >= points.length ? points.length - 1 : i + 2];

        // Calculate control points using Catmull-Rom to Bezier formula
        // The tension parameter controls how "tight" the curve is
        const cp1x = p1.x + ((p2.x - p0.x) * tension) / 3;
        const cp1y = p1.y + ((p2.y - p0.y) * tension) / 3;
        const cp2x = p2.x - ((p3.x - p1.x) * tension) / 3;
        const cp2y = p2.y - ((p3.y - p1.y) * tension) / 3;

        path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
      }
    }

    return path;
  }

  /**
   * Calculate distance between two points
   * @param {Object} p1 - First point {x, y}
   * @param {Object} p2 - Second point {x, y}
   * @returns {number} Distance in pixels
   */
  static calculateDistance(p1, p2) {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Gets the closest point on a stroke object to a target point
   * @param {fabric.Object} strokeObj - The stroke object
   * @param {Object} targetPoint - Target point {x, y}
   * @returns {Object} Closest point {x, y}
   */
  static getClosestStrokeEndpoint(strokeObj, targetPoint) {
    if (strokeObj.type === 'line') {
      return PathUtils.getClosestPointOnLine(strokeObj, targetPoint);
    } else if (strokeObj.type === 'group') {
      const objects = strokeObj.getObjects();
      const lineObj = objects.find(obj => obj.type === 'line');
      if (lineObj) {
        return PathUtils.getClosestPointOnGroupLine(strokeObj, lineObj, targetPoint);
      }
    } else if (strokeObj.type === 'path') {
      return PathUtils.getClosestPointOnPath(strokeObj, targetPoint);
    }

    // Fallback to bounding box
    const bounds = strokeObj.getBoundingRect();
    return {
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
    };
  }

  /**
   * Find closest point on a line to target point
   * @param {fabric.Line} lineObj - Line object
   * @param {Object} targetPoint - Target point {x, y}
   * @returns {Object} Closest point {x, y}
   */
  static getClosestPointOnLine(lineObj, targetPoint) {
    const points = lineObj.calcLinePoints();

    // Calculate absolute center of the line
    let center = lineObj.getCenterPoint();
    if (lineObj.group) {
      const groupMatrix = lineObj.group.calcTransformMatrix();
      center = fabric.util.transformPoint(center, groupMatrix);
    }

    // Get the total transform matrix
    let matrix = lineObj.calcTransformMatrix();
    if (lineObj.group) {
      const groupMatrix = lineObj.group.calcTransformMatrix();
      matrix = fabric.util.multiplyTransformMatrices(groupMatrix, matrix);
    }

    // Calculate vectors
    const origin = fabric.util.transformPoint({ x: 0, y: 0 }, matrix);
    const p1_transformed = fabric.util.transformPoint({ x: points.x1, y: points.y1 }, matrix);
    const p2_transformed = fabric.util.transformPoint({ x: points.x2, y: points.y2 }, matrix);

    const vec1 = { x: p1_transformed.x - origin.x, y: p1_transformed.y - origin.y };
    const vec2 = { x: p2_transformed.x - origin.x, y: p2_transformed.y - origin.y };

    // Apply vectors to the correct absolute center
    const point1 = { x: center.x + vec1.x, y: center.y + vec1.y };
    const point2 = { x: center.x + vec2.x, y: center.y + vec2.y };

    // Project targetPoint onto line segment
    const A = targetPoint.x - point1.x;
    const B = targetPoint.y - point1.y;
    const C = point2.x - point1.x;
    const D = point2.y - point1.y;

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;

    let param = -1;
    if (lenSq !== 0) {
      param = dot / lenSq;
    }

    let closestX, closestY;

    if (param < 0) {
      closestX = point1.x;
      closestY = point1.y;
    } else if (param > 1) {
      closestX = point2.x;
      closestY = point2.y;
    } else {
      closestX = point1.x + param * C;
      closestY = point1.y + param * D;
    }

    return { x: closestX, y: closestY };
  }

  /**
   * Find closest point on a line within a group (for arrows)
   * @param {fabric.Group} groupObj - Group object
   * @param {fabric.Line} lineObj - Line object inside the group
   * @param {Object} targetPoint - Target point {x, y}
   * @returns {Object} Closest point {x, y}
   */
  static getClosestPointOnGroupLine(groupObj, lineObj, targetPoint) {
    const points = lineObj.calcLinePoints();

    // Transform from Line Local to Group Local
    const lineMatrix = lineObj.calcTransformMatrix();
    let point1 = fabric.util.transformPoint({ x: points.x1, y: points.y1 }, lineMatrix);
    let point2 = fabric.util.transformPoint({ x: points.x2, y: points.y2 }, lineMatrix);

    // Transform from Group Local to Parent Space
    const groupMatrix = groupObj.calcTransformMatrix();
    point1 = fabric.util.transformPoint(point1, groupMatrix);
    point2 = fabric.util.transformPoint(point2, groupMatrix);

    // If group is in another group (activeSelection), transform to Canvas Space
    if (groupObj.group) {
      const parentMatrix = groupObj.group.calcTransformMatrix();
      point1 = fabric.util.transformPoint(point1, parentMatrix);
      point2 = fabric.util.transformPoint(point2, parentMatrix);
    }

    // Find closest point on line segment
    const A = targetPoint.x - point1.x;
    const B = targetPoint.y - point1.y;
    const C = point2.x - point1.x;
    const D = point2.y - point1.y;

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;

    let param = -1;
    if (lenSq !== 0) {
      param = dot / lenSq;
    }

    let closestX, closestY;

    if (param < 0) {
      closestX = point1.x;
      closestY = point1.y;
    } else if (param > 1) {
      closestX = point2.x;
      closestY = point2.y;
    } else {
      closestX = point1.x + param * C;
      closestY = point1.y + param * D;
    }

    return { x: closestX, y: closestY };
  }

  /**
   * Find closest point on a path (curves, freehand drawings)
   * @param {fabric.Path} pathObj - Path object
   * @param {Object} targetPoint - Target point {x, y}
   * @returns {Object} Closest point {x, y}
   */
  static getClosestPointOnPath(pathObj, targetPoint) {
    if (pathObj.path && pathObj.path.length > 0) {
      const sampledPoints = PathUtils.samplePathPoints(pathObj, 30);
      if (sampledPoints.length > 0) {
        return PathUtils.getClosestPointFromArray(sampledPoints, targetPoint);
      }
    }

    return PathUtils.getClosestPointOnBoundingBox(pathObj, targetPoint);
  }

  /**
   * Find closest point from an array of points
   * @param {Array<Object>} points - Array of points {x, y}
   * @param {Object} targetPoint - Target point {x, y}
   * @returns {Object} Closest point {x, y}
   */
  static getClosestPointFromArray(points, targetPoint) {
    if (points.length === 0) return targetPoint;

    let closestPoint = points[0];
    let minDistance = PathUtils.calculateDistance(points[0], targetPoint);

    for (let i = 1; i < points.length; i++) {
      const distance = PathUtils.calculateDistance(points[i], targetPoint);
      if (distance < minDistance) {
        minDistance = distance;
        closestPoint = points[i];
      }
    }

    return {
      x: closestPoint.x || closestPoint.x === 0 ? closestPoint.x : 0,
      y: closestPoint.y || closestPoint.y === 0 ? closestPoint.y : 0,
    };
  }

  /**
   * Sample points along an SVG path
   * @param {fabric.Path} pathObj - Path object
   * @param {number} numSamples - Number of samples
   * @returns {Array<Object>} Array of sampled points {x, y}
   */
  static samplePathPoints(pathObj, numSamples = 30) {
    const points = [];
    const pathData = pathObj.path;

    let centerAbs = pathObj.getCenterPoint();
    if (pathObj.group) {
      const groupMatrix = pathObj.group.calcTransformMatrix();
      centerAbs = fabric.util.transformPoint(centerAbs, groupMatrix);
    }

    const pathCenterLocal = { x: pathObj.pathOffset.x, y: pathObj.pathOffset.y };

    let matrix = pathObj.calcTransformMatrix();
    if (pathObj.group) {
      const groupMatrix = pathObj.group.calcTransformMatrix();
      matrix = fabric.util.multiplyTransformMatrices(groupMatrix, matrix);
    }

    const centerBuggy = fabric.util.transformPoint(pathCenterLocal, matrix);

    const transformToAbsolute = p => {
      const pBuggy = fabric.util.transformPoint(p, matrix);
      const vec = {
        x: pBuggy.x - centerBuggy.x,
        y: pBuggy.y - centerBuggy.y,
      };
      return {
        x: centerAbs.x + vec.x,
        y: centerAbs.y + vec.y,
      };
    };

    let currentPoint = { x: 0, y: 0 };

    for (const segment of pathData) {
      const command = segment[0];

      if (command === 'M') {
        currentPoint = { x: segment[1], y: segment[2] };
        points.push(transformToAbsolute(currentPoint));
      } else if (command === 'L') {
        const endPoint = { x: segment[1], y: segment[2] };
        const samples = PathUtils.sampleLine(currentPoint, endPoint, 5);
        samples.forEach(p => points.push(transformToAbsolute(p)));
        currentPoint = endPoint;
      } else if (command === 'C') {
        const cp1 = { x: segment[1], y: segment[2] };
        const cp2 = { x: segment[3], y: segment[4] };
        const endPoint = { x: segment[5], y: segment[6] };
        const samples = PathUtils.sampleCubicBezier(currentPoint, cp1, cp2, endPoint, 10);
        samples.forEach(p => points.push(transformToAbsolute(p)));
        currentPoint = endPoint;
      } else if (command === 'Q') {
        const cp = { x: segment[1], y: segment[2] };
        const endPoint = { x: segment[3], y: segment[4] };
        const samples = PathUtils.sampleQuadraticBezier(currentPoint, cp, endPoint, 10);
        samples.forEach(p => points.push(fabric.util.transformPoint(p, matrix)));
        currentPoint = endPoint;
      }
    }

    return points;
  }

  /**
   * Sample points along a line segment
   */
  static sampleLine(p0, p1, numSamples = 5) {
    const points = [];
    for (let i = 0; i <= numSamples; i++) {
      const t = i / numSamples;
      points.push({
        x: p0.x + t * (p1.x - p0.x),
        y: p0.y + t * (p1.y - p0.y),
      });
    }
    return points;
  }

  /**
   * Sample points along a cubic Bezier curve
   */
  static sampleCubicBezier(p0, cp1, cp2, p1, numSamples = 10) {
    const points = [];
    for (let i = 0; i <= numSamples; i++) {
      const t = i / numSamples;
      points.push(PathUtils.cubicBezierPoint(p0, cp1, cp2, p1, t));
    }
    return points;
  }

  /**
   * Calculate point on cubic Bezier curve at parameter t (0 to 1)
   */
  static cubicBezierPoint(p0, cp1, cp2, p1, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    const mt = 1 - t;
    const mt2 = mt * mt;
    const mt3 = mt2 * mt;

    return {
      x: mt3 * p0.x + 3 * mt2 * t * cp1.x + 3 * mt * t2 * cp2.x + t3 * p1.x,
      y: mt3 * p0.y + 3 * mt2 * t * cp1.y + 3 * mt * t2 * cp2.y + t3 * p1.y,
    };
  }

  /**
   * Sample points along a quadratic Bezier curve
   */
  static sampleQuadraticBezier(p0, cp, p1, numSamples = 10) {
    const points = [];
    for (let i = 0; i <= numSamples; i++) {
      const t = i / numSamples;
      points.push(PathUtils.quadraticBezierPoint(p0, cp, p1, t));
    }
    return points;
  }

  /**
   * Calculate point on quadratic Bezier curve at parameter t (0 to 1)
   */
  static quadraticBezierPoint(p0, cp, p1, t) {
    const mt = 1 - t;
    const mt2 = mt * mt;
    const t2 = t * t;

    return {
      x: mt2 * p0.x + 2 * mt * t * cp.x + t2 * p1.x,
      y: mt2 * p0.y + 2 * mt * t * cp.y + t2 * p1.y,
    };
  }

  /**
   * Get closest point on bounding box (fallback)
   */
  static getClosestPointOnBoundingBox(pathObj, targetPoint) {
    const bounds = pathObj.getBoundingRect();
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;

    const edgePoints = [
      { x: bounds.left, y: centerY },
      { x: bounds.left + bounds.width, y: centerY },
      { x: centerX, y: bounds.top },
      { x: centerX, y: bounds.top + bounds.height },
    ];

    let closestPoint = edgePoints[0];
    let minDistance = PathUtils.calculateDistance(edgePoints[0], targetPoint);

    for (let i = 1; i < edgePoints.length; i++) {
      const distance = PathUtils.calculateDistance(edgePoints[i], targetPoint);
      if (distance < minDistance) {
        minDistance = distance;
        closestPoint = edgePoints[i];
      }
    }

    return closestPoint;
  }
}
