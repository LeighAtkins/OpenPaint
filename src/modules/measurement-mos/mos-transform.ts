// @ts-nocheck
/**
 * MOS ↔ Canvas coordinate transforms.
 *
 * MOS coordinate space: 0–1000 on both axes, normalised to the background image.
 * Canvas space: Fabric.js canvas pixel coordinates.
 */

import type { MosPoint, CanvasPoint, ImageRect } from './types';

/** MOS coordinate range */
const MOS_RANGE = 1000;

// ---------------------------------------------------------------------------
// Image rect extraction
// ---------------------------------------------------------------------------

/**
 * Read the current background image bounds from the Fabric canvas.
 * Returns the top-left corner and displayed size in canvas-space pixels.
 *
 * The background image uses `originX/Y: 'center'` so we derive the
 * top-left from `left - width*scaleX/2`.
 */
export function getImageRect(canvas: any): ImageRect {
  const bgImg = canvas?.backgroundImage;
  if (!bgImg) {
    // Fallback: use full canvas dimensions
    return {
      left: 0,
      top: 0,
      width: canvas?.width ?? 1,
      height: canvas?.height ?? 1,
    };
  }

  const scaleX = bgImg.scaleX ?? 1;
  const scaleY = bgImg.scaleY ?? 1;
  const imgW = (bgImg.width ?? 1) * scaleX;
  const imgH = (bgImg.height ?? 1) * scaleY;

  // Determine top-left based on origin setting
  let imgLeft: number;
  let imgTop: number;

  if (bgImg.originX === 'center') {
    imgLeft = (bgImg.left ?? 0) - imgW / 2;
  } else {
    imgLeft = bgImg.left ?? 0;
  }

  if (bgImg.originY === 'center') {
    imgTop = (bgImg.top ?? 0) - imgH / 2;
  } else {
    imgTop = bgImg.top ?? 0;
  }

  return {
    left: imgLeft,
    top: imgTop,
    width: imgW,
    height: imgH,
  };
}

// ---------------------------------------------------------------------------
// Forward transform: MOS → Canvas
// ---------------------------------------------------------------------------

/**
 * Convert a point from MOS space (0–1000) to canvas space.
 */
export function mosToCanvas(mos: MosPoint, imageRect: ImageRect): CanvasPoint {
  const nx = mos.x / MOS_RANGE;
  const ny = mos.y / MOS_RANGE;

  return {
    x: imageRect.left + nx * imageRect.width,
    y: imageRect.top + ny * imageRect.height,
  };
}

// ---------------------------------------------------------------------------
// Inverse transform: Canvas → MOS
// ---------------------------------------------------------------------------

/**
 * Convert a point from canvas space back to MOS space (0–1000), clamped.
 */
export function canvasToMos(canvas: CanvasPoint, imageRect: ImageRect): MosPoint {
  const nx = (canvas.x - imageRect.left) / imageRect.width;
  const ny = (canvas.y - imageRect.top) / imageRect.height;

  return {
    x: clamp(nx * MOS_RANGE, 0, MOS_RANGE),
    y: clamp(ny * MOS_RANGE, 0, MOS_RANGE),
  };
}

// ---------------------------------------------------------------------------
// Batch transforms
// ---------------------------------------------------------------------------

/**
 * Convert an array of MOS points to canvas points.
 */
export function mosToCanvasBatch(points: MosPoint[], imageRect: ImageRect): CanvasPoint[] {
  return points.map(p => mosToCanvas(p, imageRect));
}

/**
 * Convert an array of canvas points to MOS points.
 */
export function canvasToMosBatch(points: CanvasPoint[], imageRect: ImageRect): MosPoint[] {
  return points.map(p => canvasToMos(p, imageRect));
}

// ---------------------------------------------------------------------------
// Scale factor (for stroke widths, font sizes, etc.)
// ---------------------------------------------------------------------------

/**
 * Returns the average scale factor from MOS units to canvas pixels.
 * Useful for scaling stroke widths and font sizes proportionally.
 */
export function mosScaleFactor(imageRect: ImageRect): number {
  return (imageRect.width + imageRect.height) / (2 * MOS_RANGE);
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
