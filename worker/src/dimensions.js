/**
 * Dimensions Module
 * Generates furniture dimensions from anchor points
 */

import { formatDimension } from './calibration.js';

/**
 * Generate basic dimensions for furniture
 * @param {Object} anchors - Anchor points from silhouette
 * @param {number} pxPerUnit - Pixels per unit ratio
 * @param {string} unit - Unit (cm, mm, in)
 * @param {string} view - View type (front, top, 3q)
 * @returns {Array} Array of dimension objects
 */
export function generateBasicDimensions(anchors, pxPerUnit, unit, view) {
  const dimensions = [];
  
  // Overall width (always available)
  const overallWidth = generateOverallWidth(anchors, pxPerUnit, unit);
  if (overallWidth) {
    dimensions.push(overallWidth);
  }
  
  // View-specific dimensions
  switch (view) {
    case 'front':
      const seatWidth = generateSeatWidth(anchors, pxPerUnit, unit);
      const backHeight = generateBackHeight(anchors, pxPerUnit, unit);
      
      if (seatWidth) dimensions.push(seatWidth);
      if (backHeight) dimensions.push(backHeight);
      break;
      
    case 'top':
      const depth = generateDepth(anchors, pxPerUnit, unit);
      if (depth) dimensions.push(depth);
      break;
      
    case '3q':
      // 3/4 view with depth foreshortening
      const depth3q = generateDepth3Q(anchors, pxPerUnit, unit);
      if (depth3q) dimensions.push(depth3q);
      break;
  }
  
  return dimensions;
}

/**
 * Generate overall width dimension
 * @param {Object} anchors - Anchor points
 * @param {number} pxPerUnit - Pixels per unit
 * @param {string} unit - Unit
 * @returns {Object|null} Dimension object
 */
function generateOverallWidth(anchors, pxPerUnit, unit) {
  if (!anchors.leftExtreme || !anchors.rightExtreme) {
    return null;
  }
  
  const pixelDistance = Math.abs(anchors.rightExtreme.x - anchors.leftExtreme.x);
  const realDistance = pixelDistance / pxPerUnit;
  
  return {
    id: 'overall_width',
    type: 'measure',
    value: realDistance,
    unit: unit,
    label: 'Width',
    points: [anchors.leftExtreme, anchors.rightExtreme],
    formatted: formatDimension(realDistance, unit)
  };
}

/**
 * Generate seat width dimension (front view)
 * @param {Object} anchors - Anchor points
 * @param {number} pxPerUnit - Pixels per unit
 * @param {string} unit - Unit
 * @returns {Object|null} Dimension object
 */
function generateSeatWidth(anchors, pxPerUnit, unit) {
  if (!anchors.leftExtreme || !anchors.rightExtreme) {
    return null;
  }
  
  // For front view, estimate seat width as 70% of overall width
  const overallPixelDistance = Math.abs(anchors.rightExtreme.x - anchors.leftExtreme.x);
  const seatPixelDistance = overallPixelDistance * 0.7;
  const realDistance = seatPixelDistance / pxPerUnit;
  
  // Calculate seat width points (centered)
  const centerX = (anchors.leftExtreme.x + anchors.rightExtreme.x) / 2;
  const seatY = anchors.seatFront ? anchors.seatFront.y : anchors.center.y;
  const halfWidth = seatPixelDistance / 2;
  
  const startPoint = { x: centerX - halfWidth, y: seatY };
  const endPoint = { x: centerX + halfWidth, y: seatY };
  
  return {
    id: 'seat_width',
    type: 'measure',
    value: realDistance,
    unit: unit,
    label: 'Seat Width',
    points: [startPoint, endPoint],
    formatted: formatDimension(realDistance, unit)
  };
}

/**
 * Generate back height dimension (front view)
 * @param {Object} anchors - Anchor points
 * @param {number} pxPerUnit - Pixels per unit
 * @param {string} unit - Unit
 * @returns {Object|null} Dimension object
 */
function generateBackHeight(anchors, pxPerUnit, unit) {
  if (!anchors.backTop || !anchors.seatFront) {
    return null;
  }
  
  const pixelDistance = Math.abs(anchors.seatFront.y - anchors.backTop.y);
  const realDistance = pixelDistance / pxPerUnit;
  
  const centerX = anchors.center ? anchors.center.x : (anchors.leftExtreme.x + anchors.rightExtreme.x) / 2;
  
  return {
    id: 'back_height',
    type: 'measure',
    value: realDistance,
    unit: unit,
    label: 'Back Height',
    points: [
      { x: centerX, y: anchors.backTop.y },
      { x: centerX, y: anchors.seatFront.y }
    ],
    formatted: formatDimension(realDistance, unit)
  };
}

/**
 * Generate depth dimension (top view)
 * @param {Object} anchors - Anchor points
 * @param {number} pxPerUnit - Pixels per unit
 * @param {string} unit - Unit
 * @returns {Object|null} Dimension object
 */
function generateDepth(anchors, pxPerUnit, unit) {
  if (!anchors.bbox) {
    return null;
  }
  
  const { minY, maxY } = anchors.bbox;
  const pixelDistance = maxY - minY;
  const realDistance = pixelDistance / pxPerUnit;
  
  const centerX = anchors.center ? anchors.center.x : (anchors.leftExtreme.x + anchors.rightExtreme.x) / 2;
  
  return {
    id: 'depth',
    type: 'measure',
    value: realDistance,
    unit: unit,
    label: 'Depth',
    points: [
      { x: centerX, y: minY },
      { x: centerX, y: maxY }
    ],
    formatted: formatDimension(realDistance, unit)
  };
}

/**
 * Generate depth dimension for 3/4 view with foreshortening
 * @param {Object} anchors - Anchor points
 * @param {number} pxPerUnit - Pixels per unit
 * @param {string} unit - Unit
 * @returns {Object|null} Dimension object
 */
function generateDepth3Q(anchors, pxPerUnit, unit) {
  if (!anchors.bbox) {
    return null;
  }
  
  const { minY, maxY } = anchors.bbox;
  const pixelDistance = maxY - minY;
  
  // Apply foreshortening factor (default 0.7 for 3/4 view)
  const kDepth = 0.7;
  const adjustedPixelDistance = pixelDistance / kDepth;
  const realDistance = adjustedPixelDistance / pxPerUnit;
  
  const centerX = anchors.center ? anchors.center.x : (anchors.leftExtreme.x + anchors.rightExtreme.x) / 2;
  
  return {
    id: 'depth',
    type: 'measure',
    value: realDistance,
    unit: unit,
    label: 'Depth',
    points: [
      { x: centerX, y: minY },
      { x: centerX, y: maxY }
    ],
    formatted: formatDimension(realDistance, unit),
    kDepthUsed: kDepth
  };
}
