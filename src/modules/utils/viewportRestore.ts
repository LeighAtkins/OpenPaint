/* eslint-disable @typescript-eslint/no-explicit-any */
// @ts-nocheck

interface RectLike {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
}

interface ViewportLike {
  zoom?: number;
  panX?: number;
  panY?: number;
  rotation?: number;
}

interface PointLike {
  x?: number;
  y?: number;
  left?: number;
  top?: number;
}

interface GeometryLike {
  canvasRect?: RectLike | null;
  center?: PointLike | null;
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function getRectLeft(rect: RectLike | null | undefined): number {
  return toFiniteNumber(rect?.left, toFiniteNumber(rect?.x, 0));
}

function getRectTop(rect: RectLike | null | undefined): number {
  return toFiniteNumber(rect?.top, toFiniteNumber(rect?.y, 0));
}

function getRectWidth(rect: RectLike | null | undefined): number {
  return toFiniteNumber(rect?.width, 0);
}

function getRectHeight(rect: RectLike | null | undefined): number {
  return toFiniteNumber(rect?.height, 0);
}

function rectToCorners(rect: RectLike) {
  const left = getRectLeft(rect);
  const top = getRectTop(rect);
  const width = getRectWidth(rect);
  const height = getRectHeight(rect);
  return [
    { x: left, y: top },
    { x: left + width, y: top },
    { x: left, y: top + height },
    { x: left + width, y: top + height },
  ];
}

function boundsFromPoints(points: Array<{ x: number; y: number }>) {
  if (!Array.isArray(points) || points.length === 0) {
    return null;
  }
  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  return normalizeWorldRect({
    left,
    top,
    width: right - left,
    height: bottom - top,
  });
}

export function normalizeWorldRect(worldRect: RectLike | null | undefined) {
  if (!worldRect || typeof worldRect !== 'object') return null;
  const left = Number(worldRect.left);
  const top = Number(worldRect.top);
  const width = Number(worldRect.width);
  const height = Number(worldRect.height);
  if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return { left, top, width, height };
}

export function normalizeViewportRecord(viewport: ViewportLike | null | undefined) {
  if (!viewport || typeof viewport !== 'object') {
    return {
      zoom: 1,
      panX: 0,
      panY: 0,
      rotation: 0,
    };
  }

  const zoom = Number(viewport.zoom);
  const panX = Number(viewport.panX);
  const panY = Number(viewport.panY);
  const rotation = Number(viewport.rotation);

  return {
    zoom: Number.isFinite(zoom) && zoom > 0 ? zoom : 1,
    panX: Number.isFinite(panX) ? panX : 0,
    panY: Number.isFinite(panY) ? panY : 0,
    rotation: Number.isFinite(rotation) ? rotation : 0,
  };
}

export function buildViewportTransform(
  viewport: ViewportLike | null | undefined,
  center: PointLike | null | undefined
) {
  const normalized = normalizeViewportRecord(viewport);
  const centerX = toFiniteNumber(center?.x, toFiniteNumber(center?.left, 0));
  const centerY = toFiniteNumber(center?.y, toFiniteNumber(center?.top, 0));
  const angleRadians = (normalized.rotation * Math.PI) / 180;
  const cos = Math.cos(angleRadians);
  const sin = Math.sin(angleRadians);
  const zoom = normalized.zoom;

  const base = [zoom * cos, zoom * sin, -zoom * sin, zoom * cos, 0, 0];
  const translateToOrigin = [1, 0, 0, 1, -centerX, -centerY];
  const translateBack = [1, 0, 0, 1, centerX, centerY];

  let transform =
    typeof fabric?.util?.multiplyTransformMatrices === 'function'
      ? fabric.util.multiplyTransformMatrices(base, translateToOrigin)
      : [
          base[0],
          base[1],
          base[2],
          base[3],
          base[0] * translateToOrigin[4] + base[2] * translateToOrigin[5],
          base[1] * translateToOrigin[4] + base[3] * translateToOrigin[5],
        ];

  transform =
    typeof fabric?.util?.multiplyTransformMatrices === 'function'
      ? fabric.util.multiplyTransformMatrices(translateBack, transform)
      : [
          transform[0],
          transform[1],
          transform[2],
          transform[3],
          transform[4] + translateBack[4],
          transform[5] + translateBack[5],
        ];

  transform[4] += normalized.panX;
  transform[5] += normalized.panY;
  return transform;
}

function transformPoint(matrix: number[], point: { x: number; y: number }) {
  return {
    x: matrix[0] * point.x + matrix[2] * point.y + matrix[4],
    y: matrix[1] * point.x + matrix[3] * point.y + matrix[5],
  };
}

function invertTransform(matrix: number[]) {
  if (typeof fabric?.util?.invertTransform === 'function') {
    return fabric.util.invertTransform(matrix);
  }
  const [a, b, c, d, e, f] = matrix;
  const det = a * d - b * c;
  if (!Number.isFinite(det) || det === 0) {
    return null;
  }
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

function transformViewportPoint(matrix: number[], x: number, y: number) {
  if (typeof fabric?.util?.transformPoint === 'function' && typeof fabric?.Point === 'function') {
    const point = fabric.util.transformPoint(new fabric.Point(x, y), matrix);
    return { x: point.x, y: point.y };
  }
  return transformPoint(matrix, { x, y });
}

export function mapWorldRectToViewport(
  worldRect: RectLike | null | undefined,
  viewport: ViewportLike | null | undefined,
  geometry: GeometryLike | null | undefined
) {
  const normalizedWorldRect = normalizeWorldRect(worldRect);
  if (!normalizedWorldRect) return null;

  const matrix = buildViewportTransform(viewport, geometry?.center);
  const canvasLeft = getRectLeft(geometry?.canvasRect || null);
  const canvasTop = getRectTop(geometry?.canvasRect || null);
  const points = rectToCorners(normalizedWorldRect).map(point => {
    const mapped = transformViewportPoint(matrix, point.x, point.y);
    return {
      x: mapped.x + canvasLeft,
      y: mapped.y + canvasTop,
    };
  });

  return boundsFromPoints(points);
}

export function computeWorldRectFromViewportRect(
  rect: RectLike | null | undefined,
  viewport: ViewportLike | null | undefined,
  geometry: GeometryLike | null | undefined
) {
  const normalizedRect = normalizeWorldRect(rect);
  if (!normalizedRect) return null;

  const matrix = buildViewportTransform(viewport, geometry?.center);
  const inverse = invertTransform(matrix);
  if (!inverse) return null;

  const canvasLeft = getRectLeft(geometry?.canvasRect || null);
  const canvasTop = getRectTop(geometry?.canvasRect || null);
  const points = rectToCorners(normalizedRect).map(point =>
    transformViewportPoint(inverse, point.x - canvasLeft, point.y - canvasTop)
  );

  return boundsFromPoints(points);
}

export function fitViewportToWorldRect(
  worldRect: RectLike | null | undefined,
  viewport: ViewportLike | null | undefined,
  targetRect: RectLike | null | undefined,
  geometry: GeometryLike | null | undefined
) {
  const normalizedWorldRect = normalizeWorldRect(worldRect);
  const normalizedTargetRect = normalizeWorldRect(targetRect);
  if (!normalizedWorldRect || !viewport || !normalizedTargetRect) {
    return viewport || null;
  }
  const nextViewport = {
    ...(viewport || {}),
  };
  const mappedBefore = mapWorldRectToViewport(normalizedWorldRect, nextViewport, geometry);
  if (!mappedBefore || mappedBefore.width <= 0 || mappedBefore.height <= 0) {
    return nextViewport;
  }
  const fitScale = Math.min(
    normalizedTargetRect.width / Math.max(1, mappedBefore.width),
    normalizedTargetRect.height / Math.max(1, mappedBefore.height)
  );
  nextViewport.zoom = Math.max(0.01, (nextViewport.zoom || 1) * fitScale);
  const mappedAfter = mapWorldRectToViewport(normalizedWorldRect, nextViewport, geometry);
  if (!mappedAfter) {
    return nextViewport;
  }
  const targetCx = normalizedTargetRect.left + normalizedTargetRect.width / 2;
  const targetCy = normalizedTargetRect.top + normalizedTargetRect.height / 2;
  const mappedCx = mappedAfter.left + mappedAfter.width / 2;
  const mappedCy = mappedAfter.top + mappedAfter.height / 2;
  nextViewport.panX = (nextViewport.panX || 0) + (targetCx - mappedCx);
  nextViewport.panY = (nextViewport.panY || 0) + (targetCy - mappedCy);
  return nextViewport;
}

export function getFabricObjectWorldRect(object: any) {
  if (!object) return null;

  const cornerSource =
    (Array.isArray(object.getCoords?.()) && object.getCoords()) ||
    (object.aCoords ? Object.values(object.aCoords) : null);
  if (Array.isArray(cornerSource) && cornerSource.length > 0) {
    const points = cornerSource
      .map((point: any) => ({
        x: toFiniteNumber(point?.x, NaN),
        y: toFiniteNumber(point?.y, NaN),
      }))
      .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (points.length > 0) {
      return boundsFromPoints(points);
    }
  }

  const rect = object.getBoundingRect?.(true, true) || object.getBoundingRect?.() || null;
  return normalizeWorldRect(rect);
}
