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

declare const fabric: any;

// Default MOS SVG viewBox range
const MOS_RANGE = 1000;

// Default stroke style matching svgMerge coral palette
const DEFAULT_STROKE_COLOR = '#DF6868';
const DEFAULT_STROKE_WIDTH = 1.5;
const DEFAULT_FONT_SIZE = 14;
const DEFAULT_FONT_FAMILY = 'Arial, sans-serif';

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
  srcWidth: number,
  srcHeight: number,
  imageRect: ImageRect,
  scale: number,
  canvas: any,
  elements: Map<string, MeasurementOverlayElement>
): void {
  const tag = el.tagName.toLowerCase();

  // Recurse into groups
  if (tag === 'g') {
    for (const child of Array.from(el.children)) {
      processElement(
        child,
        overlayId,
        prefix,
        srcWidth,
        srcHeight,
        imageRect,
        scale,
        canvas,
        elements
      );
    }
    return;
  }

  // Skip non-graphic elements
  if (tag === 'defs' || tag === 'style' || tag === 'clippath' || tag === 'marker') return;

  const elId = el.getAttribute('id') || `${prefix}auto_${elements.size}`;
  const kind = classifyElement(el, elId);

  // Convert element geometry to MOS coordinates
  const mosElement = extractElementGeometry(el, tag, elId, kind, srcWidth, srcHeight);
  if (!mosElement) return;

  // Create Fabric objects
  const fabricIds = createFabricObjectsForElement(mosElement, overlayId, imageRect, scale, canvas);
  mosElement.fabricObjectIds = fabricIds;

  elements.set(mosElement.id, mosElement);
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
  srcWidth: number,
  srcHeight: number
): MeasurementOverlayElement | null {
  const toMosX = (v: number) => (v / srcWidth) * MOS_RANGE;
  const toMosY = (v: number) => (v / srcHeight) * MOS_RANGE;

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
      if (pts.length >= 2) {
        // Use centroid as single reference point
        const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
        const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
        endpoints.push({ point: { x: toMosX(cx), y: toMosY(cy) } });
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
      // For paths, extract first move-to and approximate endpoint
      const d = el.getAttribute('d') || '';
      const firstPoint = extractPathStartPoint(d);
      if (firstPoint) {
        endpoints.push({ point: { x: toMosX(firstPoint.x), y: toMosY(firstPoint.y) } });
      }
      break;
    }

    default:
      return null;
  }

  if (endpoints.length === 0 && !label) return null;

  // Read inline style for stroke info
  const style = extractStyle(el);

  return {
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
  const strokeWidth = (element.style?.strokeWidth || DEFAULT_STROKE_WIDTH) * scale;

  if (element.kind === 'measureLine' && element.endpoints.length === 2) {
    const p1 = mosToCanvas(element.endpoints[0].point, imageRect);
    const p2 = mosToCanvas(element.endpoints[1].point, imageRect);

    const line = new fabric.Line([p1.x, p1.y, p2.x, p2.y], {
      stroke: strokeColor,
      strokeWidth: strokeWidth,
      selectable: true,
      evented: true,
      hasControls: true,
      hasBorders: false,
      originX: 'center',
      originY: 'center',
      customData: { ...customData, endpointIndex: undefined },
    });

    const lineId = `${element.id}_line`;
    line.__mosId = lineId;
    element.endpoints[0].fabricObjectId = lineId;
    element.endpoints[1].fabricObjectId = lineId;
    fabricIds.push(lineId);

    // Apply endpoint controls (reuse existing FabricControls pattern)
    applyMosLineControls(line);

    canvas.add(line);
  }

  if (element.label) {
    const lp = mosToCanvas({ x: element.label.cx, y: element.label.cy }, imageRect);

    const text = new fabric.Text(element.label.text, {
      left: lp.x,
      top: lp.y,
      fontSize: DEFAULT_FONT_SIZE * scale,
      fontFamily: DEFAULT_FONT_FAMILY,
      fill: strokeColor,
      originX: 'center',
      originY: 'center',
      selectable: true,
      evented: true,
      hasControls: false,
      hasBorders: true,
      angle: element.label.rotation,
      customData: { ...customData, kind: 'label' },
    });

    const textId = `${element.id}_label`;
    text.__mosId = textId;
    fabricIds.push(textId);

    canvas.add(text);
  }

  // For shape hints (polygons), create as non-editable visual
  if (element.kind === 'shapeHint' && element.endpoints.length >= 1) {
    const cp = mosToCanvas(element.endpoints[0].point, imageRect);

    const marker = new fabric.Circle({
      left: cp.x,
      top: cp.y,
      radius: 4 * scale,
      fill: strokeColor,
      opacity: 0.5,
      originX: 'center',
      originY: 'center',
      selectable: false,
      evented: false,
      customData: { ...customData },
    });

    const markerId = `${element.id}_marker`;
    marker.__mosId = markerId;
    fabricIds.push(markerId);

    canvas.add(marker);
  }

  // For leaders/paths, create as Fabric path
  if (element.kind === 'leader' && element.endpoints.length >= 1) {
    const cp = mosToCanvas(element.endpoints[0].point, imageRect);

    const dot = new fabric.Circle({
      left: cp.x,
      top: cp.y,
      radius: 3 * scale,
      fill: strokeColor,
      originX: 'center',
      originY: 'center',
      selectable: true,
      evented: true,
      hasControls: false,
      customData: { ...customData },
    });

    const dotId = `${element.id}_leader`;
    dot.__mosId = dotId;
    fabricIds.push(dotId);

    canvas.add(dot);
  }

  return fabricIds;
}

// ---------------------------------------------------------------------------
// Line controls (mirrors FabricControls.createLineControls pattern)
// ---------------------------------------------------------------------------

function applyMosLineControls(line: any): void {
  if (!fabric?.Control) return;

  line.set({
    hasBorders: false,
    hasControls: true,
    cornerSize: 10,
    transparentCorners: false,
    cornerColor: '#ffffff',
    cornerStrokeColor: '#DF6868',
    lockScalingX: true,
    lockScalingY: true,
    lockRotation: true,
  });

  const positionHandler = (index: 0 | 1) => {
    return (dim: any, finalMatrix: any, fabricObject: any) => {
      if (!fabricObject.canvas) return { x: 0, y: 0 };
      const points = fabricObject.calcLinePoints();
      const x = index === 0 ? points.x1 : points.x2;
      const y = index === 0 ? points.y1 : points.y2;
      return fabric.util.transformPoint(
        { x, y },
        fabric.util.multiplyTransformMatrices(
          fabricObject.canvas.viewportTransform,
          fabricObject.calcTransformMatrix()
        )
      );
    };
  };

  const actionHandler = (index: 0 | 1) => {
    return (eventData: any, transform: any) => {
      const lineObj = transform.target;
      const canvasEl = lineObj.canvas;
      const event = eventData.e || eventData;
      const pointer = canvasEl.getPointer(event);

      const points = lineObj.calcLinePoints();
      const matrix = lineObj.calcTransformMatrix();
      const p1World = fabric.util.transformPoint({ x: points.x1, y: points.y1 }, matrix);
      const p2World = fabric.util.transformPoint({ x: points.x2, y: points.y2 }, matrix);

      const otherWorld = index === 0 ? p2World : p1World;
      const center = {
        x: (pointer.x + otherWorld.x) / 2,
        y: (pointer.y + otherWorld.y) / 2,
      };

      const angle = (lineObj.angle || 0) * (Math.PI / 180);
      const localNew = fabric.util.rotatePoint(pointer, center, -angle);
      const localOther = fabric.util.rotatePoint(otherWorld, center, -angle);

      if (index === 0) {
        lineObj.set({
          x1: localNew.x - center.x,
          y1: localNew.y - center.y,
          x2: localOther.x - center.x,
          y2: localOther.y - center.y,
          left: center.x,
          top: center.y,
        });
      } else {
        lineObj.set({
          x1: localOther.x - center.x,
          y1: localOther.y - center.y,
          x2: localNew.x - center.x,
          y2: localNew.y - center.y,
          left: center.x,
          top: center.y,
        });
      }

      lineObj.setCoords();
      lineObj.fire('moving');
      return true;
    };
  };

  const renderCircle = (
    ctx: CanvasRenderingContext2D,
    left: number,
    top: number,
    _styleOverride: any,
    fabricObject: any
  ) => {
    const size = fabricObject.cornerSize || 10;
    ctx.save();
    ctx.fillStyle = fabricObject.cornerColor || '#ffffff';
    ctx.strokeStyle = fabricObject.cornerStrokeColor || '#DF6868';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(left, top, size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  };

  line.controls = {
    p1: new fabric.Control({
      positionHandler: positionHandler(0),
      actionHandler: actionHandler(0),
      cursorStyle: 'pointer',
      actionName: 'modifyLine',
      render: renderCircle,
    }),
    p2: new fabric.Control({
      positionHandler: positionHandler(1),
      actionHandler: actionHandler(1),
      cursorStyle: 'pointer',
      actionName: 'modifyLine',
      render: renderCircle,
    }),
  };
}

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
