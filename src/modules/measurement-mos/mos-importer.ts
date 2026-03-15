// @ts-nocheck
/**
 * MOS SVG Importer — parses sanitised MOS SVG and creates Fabric.js objects.
 *
 * Reads SVG elements (line, polyline, polygon, path, text, rect, circle)
 * and maps them to Fabric primitives positioned in canvas space via
 * the MOS → Canvas coordinate transform.
 */

import type {
  MeasurementOverlay,
  MeasurementOverlayElement,
  MosEndpoint,
  MosLabelData,
  MosElementKind,
  MosFabricCustomData,
  ImageRect,
} from './types';
import { mosToCanvas, mosScaleFactor } from './mos-transform';
import { FabricControls } from '../utils/FabricControls.js';

declare const fabric: any;

// Default MOS SVG viewBox range
const MOS_RANGE = 1000;

// Default stroke style matching svgMerge coral palette
const DEFAULT_STROKE_COLOR = '#DF6868';
const CURVE_CONTROL_POINTS_MAX = 8;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a sanitised + prefixed MOS SVG string, create Fabric objects,
 * and return a MeasurementOverlay model.
 */
export function importMosSvg(
  svgText: string,
  overlayIndex: number,
  viewId: string,
  imageRect: ImageRect,
  canvas: any,
  options?: { sourceR2Key?: string; supabaseId?: string }
): MeasurementOverlay {
  const overlayId = `mos_overlay_${overlayIndex}`;
  const prefix = `mos${overlayIndex}_`;

  // Parse SVG DOM
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  const svgRoot = doc.querySelector('svg');
  if (!svgRoot) {
    throw new Error('[MOS Importer] No <svg> root in sanitised text');
  }

  // Determine source viewBox for coordinate mapping
  const vb = parseViewBox(svgRoot);
  const srcMinX = vb?.x ?? 0;
  const srcMinY = vb?.y ?? 0;
  const srcWidth = vb?.width ?? MOS_RANGE;
  const srcHeight = vb?.height ?? MOS_RANGE;

  const elements = new Map<string, MeasurementOverlayElement>();
  const scale = mosScaleFactor(imageRect);

  // Walk all direct children (groups and primitives)
  const topLevelChildren = Array.from(svgRoot.children);
  for (const child of topLevelChildren) {
    processElement(
      child,
      overlayId,
      prefix,
      srcMinX,
      srcMinY,
      srcWidth,
      srcHeight,
      imageRect,
      scale,
      canvas,
      elements
    );
  }

  const overlay: MeasurementOverlay = {
    id: overlayId,
    viewId,
    overlayIndex,
    svgText,
    elements,
    sourceR2Key: options?.sourceR2Key,
    supabaseId: options?.supabaseId,
    dirty: false,
  };

  return overlay;
}

/**
 * Re-mount Fabric objects for an existing overlay (e.g. after view switch).
 */
export function remountOverlayObjects(
  overlay: MeasurementOverlay,
  imageRect: ImageRect,
  canvas: any
): void {
  const scale = mosScaleFactor(imageRect);

  for (const element of overlay.elements.values()) {
    // Re-create Fabric objects from stored MOS coordinates
    const fabricIds = createFabricObjectsForElement(element, overlay.id, imageRect, scale, canvas);
    element.fabricObjectIds = fabricIds;
  }
}

// ---------------------------------------------------------------------------
// Element processing
// ---------------------------------------------------------------------------

function processElement(
  el: Element,
  overlayId: string,
  prefix: string,
  srcMinX: number,
  srcMinY: number,
  srcWidth: number,
  srcHeight: number,
  imageRect: ImageRect,
  scale: number,
  canvas: any,
  elements: Map<string, MeasurementOverlayElement>,
  inheritedMeasureRoleToken?: string,
  inheritedLabelRoleToken?: string
): void {
  const tag = el.tagName.toLowerCase();

  // Recurse into groups
  if (tag === 'g') {
    const groupId = el.getAttribute('id') || '';
    const groupRoleToken = extractRoleTokenFromId(groupId);
    const isMeasurementGroup = isMeasurementGroupId(groupId);
    const nextInheritedMeasureRoleToken = isMeasurementGroup
      ? groupRoleToken || inheritedMeasureRoleToken
      : inheritedMeasureRoleToken;
    const isLabelGroup = isLabelGroupId(groupId);
    const nextInheritedLabelRoleToken = isLabelGroup
      ? groupRoleToken || inheritedLabelRoleToken
      : inheritedLabelRoleToken;

    for (const child of Array.from(el.children)) {
      processElement(
        child,
        overlayId,
        prefix,
        srcMinX,
        srcMinY,
        srcWidth,
        srcHeight,
        imageRect,
        scale,
        canvas,
        elements,
        nextInheritedMeasureRoleToken,
        nextInheritedLabelRoleToken
      );
    }
    return;
  }

  // Skip non-graphic elements
  if (tag === 'defs' || tag === 'style' || tag === 'clippath' || tag === 'marker') return;

  const elId = el.getAttribute('id') || `${prefix}auto_${elements.size}`;
  let kind = classifyElement(el, elId);
  if (tag === 'path' && inheritedMeasureRoleToken) {
    kind = 'measureLine';
  }

  // Convert element geometry to MOS coordinates
  const mosElement = extractElementGeometry(
    el,
    tag,
    elId,
    kind,
    srcMinX,
    srcMinY,
    srcWidth,
    srcHeight
  );
  if (!mosElement) return;

  const roleToken = extractRoleTokenFromId(elId);
  if (roleToken) {
    mosElement.roleToken = roleToken;
  } else if (inheritedMeasureRoleToken && elementHasLineGeometry(mosElement)) {
    mosElement.roleToken = inheritedMeasureRoleToken;
  } else if (inheritedLabelRoleToken && mosElement.kind === 'label') {
    mosElement.roleToken = inheritedLabelRoleToken;
  }

  // Only keep vectorized line geometry when it maps to a semantic measurement role.
  // This avoids importing furniture outline strokes and auxiliary non-role lines as vectors.
  if (mosElement.kind === 'measureLine' && !mosElement.roleToken) {
    return;
  }

  // Arrowhead polygons from source SVG are replaced by generated line-end arrowheads.
  if (mosElement.kind === 'shapeHint') {
    return;
  }

  // Create Fabric objects
  const fabricIds = createFabricObjectsForElement(mosElement, overlayId, imageRect, scale, canvas);
  mosElement.fabricObjectIds = fabricIds;

  elements.set(mosElement.id, mosElement);
}

function elementHasLineGeometry(element: MeasurementOverlayElement): boolean {
  return element.kind === 'measureLine' && element.endpoints.length === 2;
}

// ---------------------------------------------------------------------------
// Element classification (svgMerge ID convention)
// ---------------------------------------------------------------------------

function classifyElement(el: Element, id: string): MosElementKind {
  const tag = el.tagName.toLowerCase();

  // svgMerge ID patterns: mL1cm, bL1cm, cL1cm
  if (/^mos\d+_[mbc]/.test(id)) {
    if (id.includes('_c')) return 'label';
    if (id.includes('_b')) return 'label';
    return 'measureLine';
  }

  // Fallback classification by element type
  if (tag === 'text' || tag === 'tspan') return 'label';
  if (tag === 'rect' || tag === 'circle' || tag === 'ellipse') return 'label';
  if (tag === 'line' || tag === 'polyline') return 'measureLine';
  if (tag === 'polygon') return 'shapeHint';
  if (tag === 'path') return 'leader';

  return 'measureLine';
}

// ---------------------------------------------------------------------------
// Geometry extraction → MOS coords
// ---------------------------------------------------------------------------

function extractElementGeometry(
  el: Element,
  tag: string,
  elId: string,
  kind: MosElementKind,
  srcMinX: number,
  srcMinY: number,
  srcWidth: number,
  srcHeight: number
): MeasurementOverlayElement | null {
  const safeWidth = srcWidth || MOS_RANGE;
  const safeHeight = srcHeight || MOS_RANGE;
  const toMosX = (v: number) => ((v - srcMinX) / safeWidth) * MOS_RANGE;
  const toMosY = (v: number) => ((v - srcMinY) / safeHeight) * MOS_RANGE;

  const endpoints: MosEndpoint[] = [];
  let label: MosLabelData | undefined;

  switch (tag) {
    case 'line': {
      const x1 = parseFloat(el.getAttribute('x1') || '0');
      const y1 = parseFloat(el.getAttribute('y1') || '0');
      const x2 = parseFloat(el.getAttribute('x2') || '0');
      const y2 = parseFloat(el.getAttribute('y2') || '0');
      endpoints.push(
        { point: { x: toMosX(x1), y: toMosY(y1) } },
        { point: { x: toMosX(x2), y: toMosY(y2) } }
      );
      break;
    }

    case 'polyline': {
      const pts = parsePoints(el.getAttribute('points') || '');
      if (pts.length >= 2) {
        endpoints.push(
          { point: { x: toMosX(pts[0].x), y: toMosY(pts[0].y) } },
          { point: { x: toMosX(pts[pts.length - 1].x), y: toMosY(pts[pts.length - 1].y) } }
        );
      }
      break;
    }

    case 'polygon': {
      const pts = parsePoints(el.getAttribute('points') || '');
      if (pts.length >= 3) {
        for (const pt of pts) {
          endpoints.push({ point: { x: toMosX(pt.x), y: toMosY(pt.y) } });
        }
      }
      break;
    }

    case 'text': {
      const x = parseFloat(el.getAttribute('x') || '0');
      const y = parseFloat(el.getAttribute('y') || '0');
      const text = el.textContent?.trim() || '';
      label = {
        text,
        cx: toMosX(x),
        cy: toMosY(y),
        rotation: 0,
      };
      endpoints.push({ point: { x: toMosX(x), y: toMosY(y) } });
      break;
    }

    case 'rect': {
      const x = parseFloat(el.getAttribute('x') || '0');
      const y = parseFloat(el.getAttribute('y') || '0');
      const w = parseFloat(el.getAttribute('width') || '0');
      const h = parseFloat(el.getAttribute('height') || '0');
      endpoints.push(
        { point: { x: toMosX(x), y: toMosY(y) } },
        { point: { x: toMosX(x + w), y: toMosY(y + h) } }
      );
      break;
    }

    case 'circle':
    case 'ellipse': {
      const cx = parseFloat(el.getAttribute('cx') || '0');
      const cy = parseFloat(el.getAttribute('cy') || '0');
      endpoints.push({ point: { x: toMosX(cx), y: toMosY(cy) } });
      break;
    }

    case 'path': {
      const d = el.getAttribute('d') || '';
      const points = extractPathPoints(d);
      if (points.length >= 2) {
        endpoints.push(
          { point: { x: toMosX(points[0].x), y: toMosY(points[0].y) } },
          {
            point: {
              x: toMosX(points[points.length - 1].x),
              y: toMosY(points[points.length - 1].y),
            },
          }
        );
      } else {
        const firstPoint = extractPathStartPoint(d);
        if (firstPoint) {
          endpoints.push({ point: { x: toMosX(firstPoint.x), y: toMosY(firstPoint.y) } });
        }
      }
      break;
    }

    default:
      return null;
  }

  if (endpoints.length === 0 && !label) return null;

  // Read inline style for stroke info
  const style = extractStyle(el);

  const baseElement = {
    id: elId,
    opId: elId,
    kind,
    editMode: kind === 'label' ? 'label-drag' : 'endpoint',
    endpoints,
    label,
    style,
    fabricObjectIds: [],
    dirty: false,
  };

  if (tag === 'path' && kind === 'measureLine') {
    const d = el.getAttribute('d') || '';
    const points = extractPathPoints(d);
    if (points.length >= 2) {
      baseElement.curvePoints = points.map(point => ({ x: toMosX(point.x), y: toMosY(point.y) }));
    }
  }

  return baseElement;
}

// ---------------------------------------------------------------------------
// Fabric object creation
// ---------------------------------------------------------------------------

function createFabricObjectsForElement(
  element: MeasurementOverlayElement,
  overlayId: string,
  imageRect: ImageRect,
  scale: number,
  canvas: any
): string[] {
  const fabricIds: string[] = [];
  const customData: MosFabricCustomData = {
    layerType: 'mos-overlay',
    overlayId,
    elementId: element.id,
    kind: element.kind,
  };

  const strokeColor = element.style?.strokeColor || DEFAULT_STROKE_COLOR;
  const measurementStrokeWidth = 4;

  if (element.kind === 'measureLine' && element.endpoints.length === 2) {
    if (Array.isArray(element.curvePoints) && element.curvePoints.length >= 2) {
      const curveWorldPoints = element.curvePoints.map(point => mosToCanvas(point, imageRect));
      const pathData = buildSmoothPathFromPoints(curveWorldPoints);
      const pathObj = new fabric.Path(pathData, {
        fill: '',
        stroke: strokeColor,
        strokeWidth: measurementStrokeWidth,
        selectable: true,
        evented: true,
        hasControls: true,
        hasBorders: false,
        objectCaching: false,
        customData: { ...customData, endpointIndex: undefined },
      });

      pathObj.customPoints = curveWorldPoints.map(point => ({ x: point.x, y: point.y }));
      FabricControls.createCurveControls(pathObj);

      const lineId = `${element.id}_line`;
      const startArrowId = `${element.id}_curve_start_arrow`;
      const endArrowId = `${element.id}_curve_end_arrow`;

      const arrowSize = 12;
      const startArrow = new fabric.Triangle({
        width: arrowSize,
        height: arrowSize,
        fill: strokeColor,
        stroke: strokeColor,
        strokeWidth: Math.max(1, measurementStrokeWidth * 0.4),
        originX: 'center',
        originY: 'center',
        selectable: false,
        evented: false,
        objectCaching: false,
        customData: { ...customData },
      });
      const endArrow = new fabric.Triangle({
        width: arrowSize,
        height: arrowSize,
        fill: strokeColor,
        stroke: strokeColor,
        strokeWidth: Math.max(1, measurementStrokeWidth * 0.4),
        originX: 'center',
        originY: 'center',
        selectable: false,
        evented: false,
        objectCaching: false,
        customData: { ...customData },
      });

      startArrow.__mosId = startArrowId;
      endArrow.__mosId = endArrowId;

      pathObj.__mosId = lineId;
      pathObj.strokeMetadata = {
        ...(pathObj.strokeMetadata || {}),
        strokeLabel: element.roleToken || '',
      };

      const updateCurveArrows = () => {
        updateCurveArrowheadsFromCustomPoints(pathObj, startArrow, endArrow);
      };
      pathObj.__mosUpdateCurveDecorators = updateCurveArrows;

      element.endpoints[0].fabricObjectId = lineId;
      element.endpoints[1].fabricObjectId = lineId;
      fabricIds.push(lineId, startArrowId, endArrowId);

      canvas.add(pathObj);
      canvas.add(startArrow);
      canvas.add(endArrow);
      updateCurveArrows();

      pathObj.on('moving', updateCurveArrows);
      pathObj.on('modified', updateCurveArrows);
      pathObj.on('scaling', updateCurveArrows);
      pathObj.on('rotating', updateCurveArrows);
      pathObj.on('changed', updateCurveArrows);
      return fabricIds;
    }

    const p1 = mosToCanvas(element.endpoints[0].point, imageRect);
    const p2 = mosToCanvas(element.endpoints[1].point, imageRect);
    const selectable = true;

    const line = new fabric.Line([p1.x, p1.y, p2.x, p2.y], {
      stroke: strokeColor,
      strokeWidth: measurementStrokeWidth,
      selectable: false,
      evented: false,
      hasControls: false,
      hasBorders: false,
      originX: 'center',
      originY: 'center',
      opacity: 1,
      customData: { ...customData, endpointIndex: undefined },
    });

    const lineId = `${element.id}_line`;
    const arrowSize = 12;
    const head = new fabric.Triangle({
      width: arrowSize,
      height: arrowSize,
      fill: strokeColor,
      stroke: strokeColor,
      strokeWidth: Math.max(1, measurementStrokeWidth * 0.4),
      originX: 'center',
      originY: 'center',
      selectable: false,
      evented: false,
      objectCaching: false,
      customData: { ...customData },
    });
    const angle = (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI + 90;
    head.set({ left: p2.x, top: p2.y, angle });

    const tailHead = new fabric.Triangle({
      width: arrowSize,
      height: arrowSize,
      fill: strokeColor,
      stroke: strokeColor,
      strokeWidth: Math.max(1, measurementStrokeWidth * 0.4),
      originX: 'center',
      originY: 'center',
      selectable: false,
      evented: false,
      objectCaching: false,
      customData: { ...customData },
    });
    tailHead.set({ left: p1.x, top: p1.y, angle: angle - 180 });

    const group = new fabric.Group([line, head, tailHead], {
      originX: 'center',
      originY: 'center',
      selectable,
      evented: selectable,
      hasControls: selectable,
      hasBorders: false,
      lockRotation: false,
      customData: { ...customData, endpointIndex: undefined },
    });

    if (selectable) {
      FabricControls.createArrowControls(group);
    }

    group.isArrow = true;
    group.__mosId = lineId;
    element.endpoints[0].fabricObjectId = lineId;
    element.endpoints[1].fabricObjectId = lineId;
    fabricIds.push(lineId);

    // Apply endpoint controls for primary measurement lines only.
    canvas.add(group);
  }

  if (element.label) {
    // MOS labels are rendered as TagManager tags, not imported SVG text.
  }

  // shapeHint polygons are intentionally skipped (arrowheads come from arrow groups).

  // Skip leader/path placeholders; they appear as unrelated dots in overlay imports.

  return fabricIds;
}

// Arrowhead positioning handled by grouped arrow geometry + FabricControls.

// ---------------------------------------------------------------------------
// Line controls (mirrors FabricControls.createLineControls pattern)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseViewBox(
  svg: Element
): { x: number; y: number; width: number; height: number } | null {
  const vb = svg.getAttribute('viewBox');
  if (!vb) return null;

  const parts = vb
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) return null;

  return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
}

function parsePoints(pointsStr: string): { x: number; y: number }[] {
  if (!pointsStr) return [];
  const nums = pointsStr
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    if (!isNaN(nums[i]) && !isNaN(nums[i + 1])) {
      points.push({ x: nums[i], y: nums[i + 1] });
    }
  }
  return points;
}

function extractPathStartPoint(d: string): { x: number; y: number } | null {
  const match = /[Mm]\s*([-\d.]+)[\s,]+([-\d.]+)/.exec(d);
  if (!match) return null;
  return { x: parseFloat(match[1]), y: parseFloat(match[2]) };
}

function extractPathPoints(d: string): { x: number; y: number }[] {
  if (!d || typeof document === 'undefined') return [];
  try {
    const svgNs = 'http://www.w3.org/2000/svg';
    const path = document.createElementNS(svgNs, 'path');
    path.setAttribute('d', d);
    const total = path.getTotalLength?.();
    if (!Number.isFinite(total) || total <= 0) {
      const start = extractPathStartPoint(d);
      return start ? [start] : [];
    }
    const sampleCount = Math.max(10, Math.min(36, Math.ceil(total / 24)));
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i <= sampleCount; i++) {
      const len = (total * i) / sampleCount;
      const pt = path.getPointAtLength(len);
      points.push({ x: pt.x, y: pt.y });
    }
    return downsamplePointsForCurveControls(points, CURVE_CONTROL_POINTS_MAX);
  } catch {
    const start = extractPathStartPoint(d);
    return start ? [start] : [];
  }
}

function downsamplePointsForCurveControls(
  points: Array<{ x: number; y: number }>,
  maxPoints: number
): Array<{ x: number; y: number }> {
  if (!Array.isArray(points) || points.length <= maxPoints) return points;
  if (maxPoints < 2) return points.slice(0, 2);

  // Use RDP simplification so anchor placement follows curve shape,
  // then fit to the requested maximum point budget.
  const epsilonBase = estimateCurveEpsilon(points);
  let simplified = points.slice();
  let epsilon = epsilonBase;

  for (let i = 0; i < 10; i++) {
    const candidate = simplifyRdp(points, epsilon);
    if (candidate.length <= maxPoints) {
      simplified = candidate;
      break;
    }
    epsilon *= 1.6;
    simplified = candidate;
  }

  if (simplified.length > maxPoints) {
    const result: Array<{ x: number; y: number }> = [];
    const lastIndex = simplified.length - 1;
    for (let i = 0; i < maxPoints; i++) {
      const idx = Math.round((i * lastIndex) / (maxPoints - 1));
      result.push(simplified[idx]);
    }
    return result;
  }

  return simplified;
}

function estimateCurveEpsilon(points: Array<{ x: number; y: number }>): number {
  if (!Array.isArray(points) || points.length < 2) return 2;
  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const diag = Math.hypot(maxX - minX, maxY - minY);
  return Math.max(2, diag * 0.01);
}

function simplifyRdp(
  points: Array<{ x: number; y: number }>,
  epsilon: number
): Array<{ x: number; y: number }> {
  if (points.length < 3) return points.slice();

  const first = points[0];
  const last = points[points.length - 1];
  let index = -1;
  let dmax = -1;

  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], first, last);
    if (d > dmax) {
      index = i;
      dmax = d;
    }
  }

  if (dmax > epsilon && index > 0) {
    const left = simplifyRdp(points.slice(0, index + 1), epsilon);
    const right = simplifyRdp(points.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
  }

  return [first, last];
}

function perpendicularDistance(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number }
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(point.x - start.x, point.y - start.y);

  const t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / len2;
  const projX = start.x + t * dx;
  const projY = start.y + t * dy;
  return Math.hypot(point.x - projX, point.y - projY);
}

function buildSmoothPathFromPoints(points: Array<{ x: number; y: number }>): string {
  if (!Array.isArray(points) || points.length < 2) return '';
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  let path = `M ${points[0].x} ${points[0].y}`;
  const tension = 0.5;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2 >= points.length ? points.length - 1 : i + 2];

    const cp1x = p1.x + ((p2.x - p0.x) * tension) / 3;
    const cp1y = p1.y + ((p2.y - p0.y) * tension) / 3;
    const cp2x = p2.x - ((p3.x - p1.x) * tension) / 3;
    const cp2y = p2.y - ((p3.y - p1.y) * tension) / 3;

    path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }
  return path;
}

function updateCurveArrowheadsFromCustomPoints(pathObj: any, startArrow: any, endArrow: any): void {
  if (!pathObj || !startArrow || !endArrow) return;
  const points = (pathObj.customPoints || []).filter(
    (p: any) => Number.isFinite(p?.x) && Number.isFinite(p?.y)
  );
  if (points.length < 2) return;

  const pStart = points[0];
  const pStartNext = points[1];
  const pEndPrev = points[points.length - 2];
  const pEnd = points[points.length - 1];

  const startAngle = (Math.atan2(pStartNext.y - pStart.y, pStartNext.x - pStart.x) * 180) / Math.PI;
  const endAngle = (Math.atan2(pEnd.y - pEndPrev.y, pEnd.x - pEndPrev.x) * 180) / Math.PI;

  // Match straight-line arrow orientation convention.
  startArrow.set({
    left: pStart.x,
    top: pStart.y,
    angle: startAngle - 90,
  });
  endArrow.set({
    left: pEnd.x,
    top: pEnd.y,
    angle: endAngle + 90,
  });
  startArrow.setCoords?.();
  endArrow.setCoords?.();
  pathObj.canvas?.requestRenderAll?.();
}

function extractStyle(el: Element): { strokeColor?: string; strokeWidth?: number } | undefined {
  const stroke = el.getAttribute('stroke') || getStyleProp(el, 'stroke');
  const sw = el.getAttribute('stroke-width') || getStyleProp(el, 'stroke-width');

  if (!stroke && !sw) return undefined;

  return {
    strokeColor: stroke || undefined,
    strokeWidth: sw ? parseFloat(sw) : undefined,
  };
}

function getStyleProp(el: Element, prop: string): string | null {
  const style = el.getAttribute('style');
  if (!style) return null;
  const match = new RegExp(`${prop}\\s*:\\s*([^;]+)`).exec(style);
  return match ? match[1].trim() : null;
}

function extractRoleTokenFromId(id: string): string | undefined {
  const normalized = (id || '').replace(/^mos\d+_/, '').trim();
  if (!isMeasurementOpId(normalized)) return undefined;

  const token = normalized
    .slice(1)
    .replace(/_(label|text)$/i, '')
    .replace(/(?:CM|MM|IN)\d*$/i, '')
    .replace(/[^a-z0-9-]/gi, '')
    .toUpperCase();

  if (!token || /^\d+$/.test(token)) return undefined;
  return token;
}

function isMeasurementOpId(normalizedId: string): boolean {
  const value = (normalizedId || '').trim();
  if (!value) return false;
  return /^[mbc][a-z0-9-]+(?:cm|mm|in)\d*(?:_(?:label|text))?$/i.test(value);
}

function isMeasurementGroupId(id: string): boolean {
  const normalized = (id || '').replace(/^mos\d+_/, '').trim();
  if (!normalized) return false;
  return /^m[a-z0-9-]+(?:cm|mm|in)\d*(?:_(?:label|text))?$/i.test(normalized);
}

function isLabelGroupId(id: string): boolean {
  const normalized = (id || '').replace(/^mos\d+_/, '').trim();
  if (!normalized) return false;
  return /^[bc][a-z0-9-]+(?:cm|mm|in)\d*(?:_(?:label|text))?$/i.test(normalized);
}
