/**
 * Geometry functions for coordinate space conversions
 * Handles conversions between imageSpace, canvasSpace, and normalized offsets
 */

export interface Point {
  x: number;
  y: number;
}

export interface Transform {
  scale: number;
  panX: number;
  panY: number;
  dpr: number;
}

export interface NormalizationReference {
  w: number;
  h: number;
}

export interface NormalizedOffset {
  dx_norm: number;
  dy_norm: number;
}

export interface PixelOffset {
  dx: number;
  dy: number;
}

interface AnchorCacheEntry extends Point {
  version: number;
}

const anchorCenterCache: Record<string, Record<string, AnchorCacheEntry>> = {};
const anchorCenterVersion: Record<string, number> = {};

/**
 * Convert image space point to canvas device pixels
 * @param P_img - Point in image space {x, y}
 * @param T - Transform object {scale, panX, panY, dpr}
 * @returns Point in canvas space {x, y}
 */
export function toCanvas(P_img: Point, T: Transform): Point {
  if (!P_img || typeof P_img.x !== 'number' || typeof P_img.y !== 'number') {
    console.warn('[GEOMETRY] Invalid image point:', P_img);
    return { x: 0, y: 0 };
  }

  const sx = T.scale * T.dpr;
  const tx = Math.round(T.panX * T.dpr); // Snap to device pixel
  const ty = Math.round(T.panY * T.dpr);

  // Convert to device pixels
  const Xd = Math.round(P_img.x * sx + tx);
  const Yd = Math.round(P_img.y * sx + ty);

  return { x: Xd, y: Yd };
}

/**
 * Convert canvas space point to image space
 * @param P_canvas - Point in canvas space {x, y}
 * @param T - Transform object {scale, panX, panY, dpr}
 * @returns Point in image space {x, y}
 */
export function toImage(P_canvas: Point, T: Transform): Point {
  if (!P_canvas || typeof P_canvas.x !== 'number' || typeof P_canvas.y !== 'number') {
    console.warn('[GEOMETRY] Invalid canvas point:', P_canvas);
    return { x: 0, y: 0 };
  }

  const sx = T.scale * T.dpr;
  const tx = Math.round(T.panX * T.dpr);
  const ty = Math.round(T.panY * T.dpr);

  const xi = (P_canvas.x - tx) / sx;
  const yi = (P_canvas.y - ty) / sx;

  return { x: xi, y: yi };
}

/**
 * Convert pixel offset to normalized offset
 * @param dx_px - X offset in pixels
 * @param dy_px - Y offset in pixels
 * @param normRef - Normalization reference {w, h}
 * @returns Normalized offset {dx_norm, dy_norm}
 */
export function pixelOffsetToNorm(
  dx_px: number,
  dy_px: number,
  normRef: NormalizationReference
): NormalizedOffset {
  if (!normRef || !normRef.w || !normRef.h) {
    console.warn('[GEOMETRY] Invalid normRef:', normRef);
    return { dx_norm: 0, dy_norm: 0 };
  }

  return {
    dx_norm: dx_px / normRef.w,
    dy_norm: dy_px / normRef.h,
  };
}

/**
 * Convert normalized offset to pixel offset
 * @param dx_norm - Normalized X offset
 * @param dy_norm - Normalized Y offset
 * @param normRef - Normalization reference {w, h}
 * @returns Pixel offset {dx, dy}
 */
export function normToPixelOffset(
  dx_norm: number,
  dy_norm: number,
  normRef: NormalizationReference
): PixelOffset {
  if (!normRef || !normRef.w || !normRef.h) {
    console.warn('[GEOMETRY] Invalid normRef:', normRef);
    return { dx: 0, dy: 0 };
  }

  return {
    dx: dx_norm * normRef.w,
    dy: dy_norm * normRef.h,
  };
}

/**
 * Compute anchor center in image space from stroke points
 * @param stroke - Stroke object with points array
 * @returns Anchor center {x, y} in image space
 */
export function computeAnchorCenterImage(stroke: { points: Point[] }): Point {
  if (!stroke || !stroke.points || !Array.isArray(stroke.points) || stroke.points.length === 0) {
    console.warn('[GEOMETRY] Invalid stroke for anchor computation:', stroke);
    return { x: 0, y: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const p of stroke.points) {
    if (typeof p.x === 'number' && typeof p.y === 'number') {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }

  if (minX === Infinity || minY === Infinity) {
    console.warn('[GEOMETRY] No valid points in stroke');
    return { x: 0, y: 0 };
  }

  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
  };
}

/**
 * Place label using anchor center and normalized offset
 * @param labelId - Label identifier
 * @param anchorCenterImage - Anchor center in image space {x, y}
 * @param offsetNorm - Normalized offset {dx_norm, dy_norm}
 * @param normRef - Normalization reference {w, h}
 * @param T - Transform object
 * @returns Canvas position {x, y}
 */
export function placeLabel(
  labelId: string,
  anchorCenterImage: Point,
  offsetNorm: NormalizedOffset,
  normRef: NormalizationReference,
  T: Transform
): Point {
  if (!anchorCenterImage || !offsetNorm || !normRef || !T) {
    console.warn('[GEOMETRY] Invalid parameters for label placement:', {
      labelId,
      anchorCenterImage,
      offsetNorm,
      normRef,
      T,
    });
    return { x: 0, y: 0 };
  }

  // Convert normalized offset to pixel offset
  const pixelOffset = normToPixelOffset(offsetNorm.dx_norm, offsetNorm.dy_norm, normRef);

  // Add offset to anchor center
  const P_img = {
    x: anchorCenterImage.x + pixelOffset.dx,
    y: anchorCenterImage.y + pixelOffset.dy,
  };

  // Convert to canvas space
  return toCanvas(P_img, T);
}

/**
 * Compute deterministic scale for fit mode
 * @param imageNatural - Natural image dimensions {w, h}
 * @param viewportCss - Viewport dimensions {w, h}
 * @param mode - Fit mode: 'width', 'height', 'contain'
 * @returns Scale factor
 */
export function computeScaleForFit(
  imageNatural: NormalizationReference,
  viewportCss: NormalizationReference,
  mode: 'width' | 'height' | 'contain'
): number {
  if (!imageNatural || !viewportCss) {
    console.warn('[GEOMETRY] Invalid dimensions for fit calculation');
    return 1.0;
  }

  const { w: iw, h: ih } = imageNatural;
  const { w: vw, h: vh } = viewportCss;

  if (mode === 'width') {
    return vw / iw;
  }
  if (mode === 'height') {
    return vh / ih;
  }
  // contain (default)
  return Math.min(vw / iw, vh / ih);
}

export interface TransformSession {
  phase: 'Stable' | 'Mutating' | 'Desynced';
  T: Transform;
}

/**
 * Persistence guard - check if offsets can be safely persisted
 * @param session - Session object
 * @returns Whether persistence is safe
 */
export function canPersistOffsets(session: TransformSession): boolean {
  if (!session || session.phase !== 'Stable') {
    return false;
  }

  // Roundtrip check at center of canvas
  const T = session.T;
  const testPoint = { x: 100, y: 100 };

  try {
    const roundtrip = toImage(toCanvas(testPoint, T), T);
    const err = Math.hypot(roundtrip.x - testPoint.x, roundtrip.y - testPoint.y);
    return err <= 0.25; // CSS px tolerance
  } catch (error) {
    console.warn('[GEOMETRY] Roundtrip check failed:', error);
    return false;
  }
}

/**
 * Invalidate anchor cache for a specific image when strokes change or rotation occurs
 * @param imageLabel - The image label to invalidate cache for
 */
export function invalidateAnchorCache(imageLabel: string): void {
  if (anchorCenterCache[imageLabel]) {
    delete anchorCenterCache[imageLabel];
    anchorCenterVersion[imageLabel] = (anchorCenterVersion[imageLabel] ?? 0) + 1;
    console.log(`[GEOMETRY] Invalidated anchor cache for ${imageLabel}`);
  }
}

/**
 * Get cached anchor center or compute new one
 * @param strokeLabel - The stroke label
 * @param imageLabel - The image label
 * @param vectorData - The stroke vector data with points array
 * @returns Anchor center {x, y} in image space
 */
export function getCachedAnchorCenter(
  strokeLabel: string,
  imageLabel: string,
  vectorData: { points: Point[] }
): Point {
  const imgLabel = imageLabel;

  if (!vectorData || !vectorData.points || vectorData.points.length === 0) {
    return { x: 0, y: 0 };
  }

  // Check cache first
  const cached = anchorCenterCache[imgLabel]?.[strokeLabel];
  const currentVersion = anchorCenterVersion[imgLabel] ?? 0;

  if (cached && cached.version === currentVersion) {
    return { x: cached.x, y: cached.y };
  }

  // Compute new anchor center using geometry function
  const anchorCenter = computeAnchorCenterImage(vectorData);

  // Cache the result
  if (!anchorCenterCache[imgLabel]) {
    anchorCenterCache[imgLabel] = {};
  }
  anchorCenterCache[imgLabel][strokeLabel] = {
    x: anchorCenter.x,
    y: anchorCenter.y,
    version: currentVersion,
  };

  return anchorCenter;
}
