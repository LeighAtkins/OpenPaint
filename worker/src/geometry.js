/**
 * Geometry utilities for stroke processing
 */

/**
 * Douglas-Peucker path simplification algorithm
 * @param {Array<{x:number,y:number}>} points - Original points
 * @param {number} tolerance - Simplification tolerance
 * @returns {Array<{x:number,y:number}>} Simplified points
 */
export function simplifyPath(points, tolerance = 1.0) {
    if (points.length <= 2) return points;
    
    // Find the point with the maximum distance from line segment
    let maxDistance = 0;
    let maxIndex = 0;
    const end = points.length - 1;
    
    for (let i = 1; i < end; i++) {
        const distance = perpendicularDistance(points[i], points[0], points[end]);
        if (distance > maxDistance) {
            maxDistance = distance;
            maxIndex = i;
        }
    }
    
    // If max distance is greater than tolerance, recursively simplify
    if (maxDistance > tolerance) {
        const left = simplifyPath(points.slice(0, maxIndex + 1), tolerance);
        const right = simplifyPath(points.slice(maxIndex), tolerance);
        
        // Concatenate results, removing duplicate point at junction
        return left.slice(0, -1).concat(right);
    } else {
        // Return just the endpoints
        return [points[0], points[end]];
    }
}

/**
 * Calculate perpendicular distance from point to line segment
 * @param {{x:number,y:number}} point - Point to measure
 * @param {{x:number,y:number}} lineStart - Line start point
 * @param {{x:number,y:number}} lineEnd - Line end point
 * @returns {number} Perpendicular distance
 */
function perpendicularDistance(point, lineStart, lineEnd) {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;
    
    // Handle degenerate case where line is a point
    if (dx === 0 && dy === 0) {
        return Math.hypot(point.x - lineStart.x, point.y - lineStart.y);
    }
    
    // Calculate perpendicular distance using cross product
    const numerator = Math.abs(
        dy * point.x - dx * point.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x
    );
    const denominator = Math.hypot(dx, dy);
    
    return numerator / denominator;
}

/**
 * Compute total length of a path
 * @param {Array<{x:number,y:number}>} points - Path points
 * @returns {number} Total length in pixels
 */
export function computeLength(points) {
    if (points.length < 2) return 0;
    
    let total = 0;
    for (let i = 1; i < points.length; i++) {
        total += Math.hypot(
            points[i].x - points[i-1].x,
            points[i].y - points[i-1].y
        );
    }
    return total;
}

/**
 * Find midpoint of a path
 * @param {Array<{x:number,y:number}>} points - Path points
 * @returns {{x:number,y:number}} Midpoint
 */
export function getMidpoint(points) {
    if (points.length === 0) return { x: 0, y: 0 };
    if (points.length === 1) return { ...points[0] };
    
    // For straight lines, return geometric midpoint
    if (points.length === 2) {
        return {
            x: (points[0].x + points[1].x) / 2,
            y: (points[0].y + points[1].y) / 2
        };
    }
    
    // For paths, find point at half the total length
    const totalLength = computeLength(points);
    const targetLength = totalLength / 2;
    
    let accumulatedLength = 0;
    for (let i = 1; i < points.length; i++) {
        const segmentLength = Math.hypot(
            points[i].x - points[i-1].x,
            points[i].y - points[i-1].y
        );
        
        if (accumulatedLength + segmentLength >= targetLength) {
            // Interpolate along this segment
            const ratio = (targetLength - accumulatedLength) / segmentLength;
            return {
                x: points[i-1].x + ratio * (points[i].x - points[i-1].x),
                y: points[i-1].y + ratio * (points[i].y - points[i-1].y)
            };
        }
        
        accumulatedLength += segmentLength;
    }
    
    // Fallback to last point
    return { ...points[points.length - 1] };
}

/**
 * Create smooth curve path data from points
 * @param {Array<{x:number,y:number}>} points - Path points
 * @returns {string} SVG path data
 */
export function createSmoothPath(points) {
    if (points.length < 2) return '';
    if (points.length === 2) {
        return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
    }
    
    // Create smooth curve using quadratic bezier
    let path = `M ${points[0].x} ${points[0].y}`;
    
    for (let i = 1; i < points.length - 1; i++) {
        const xc = (points[i].x + points[i + 1].x) / 2;
        const yc = (points[i].y + points[i + 1].y) / 2;
        path += ` Q ${points[i].x} ${points[i].y}, ${xc} ${yc}`;
    }
    
    // Line to final point
    path += ` L ${points[points.length - 1].x} ${points[points.length - 1].y}`;
    
    return path;
}

/**
 * Calculate angle between two points
 * @param {{x:number,y:number}} start - Start point
 * @param {{x:number,y:number}} end - End point
 * @returns {number} Angle in radians
 */
export function calculateAngle(start, end) {
    return Math.atan2(end.y - start.y, end.x - start.x);
}

