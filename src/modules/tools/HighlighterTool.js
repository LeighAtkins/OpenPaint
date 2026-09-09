import { BaseTool } from './BaseTool.js';
import { resolveDrawingImageLabel } from '../ui/scoped-image-label.js';

const HIGHLIGHTER_ALPHA = 0.32;
const HIGHLIGHTER_STYLES = new Set(['marker', 'zipper']);

export function normalizeHighlighterStyle(style) {
  const normalized = String(style || 'marker')
    .trim()
    .toLowerCase();
  return HIGHLIGHTER_STYLES.has(normalized) ? normalized : 'marker';
}

export function resolveHighlighterWidth(width) {
  const sourceWidth = Number(width);
  return Math.max(10, Math.min(120, (Number.isFinite(sourceWidth) ? sourceWidth : 2) * 6));
}

export function toHighlighterColor(color, alpha = HIGHLIGHTER_ALPHA) {
  const value = String(color || '#facc15').trim();
  const shortHex = value.match(/^#([\da-f])([\da-f])([\da-f])$/i);
  const fullHex = value.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  const rgb = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  let channels;
  if (shortHex) {
    channels = shortHex.slice(1).map(channel => Number.parseInt(`${channel}${channel}`, 16));
  } else if (fullHex) {
    channels = fullHex.slice(1).map(channel => Number.parseInt(channel, 16));
  } else if (rgb) {
    channels = rgb.slice(1).map(channel => Number.parseInt(channel, 10));
  }
  if (!channels) return value;
  return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${alpha})`;
}

export function createHighlighterCursor(color = '#facc15', style = 'marker') {
  const markerColor = String(color || '#facc15').trim();
  if (normalizeHighlighterStyle(style) === 'zipper') {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><path d="M8 4v25M22 4v25" stroke="#0f172a" stroke-width="3" stroke-linecap="round"/><path d="M8 4v25M22 4v25" stroke="${markerColor}" stroke-width="1.5" stroke-linecap="round"/><path d="M9 7l12 4M21 14L9 18M9 21l12 4" stroke="#f8fafc" stroke-width="3" stroke-linecap="round"/><path d="M9 7l12 4M21 14L9 18M9 21l12 4" stroke="#334155" stroke-width="1.4" stroke-linecap="round"/><path d="M11.5 30h7M15 26.5v7" stroke="#fff" stroke-width="3" stroke-linecap="round"/><path d="M11.5 30h7M15 26.5v7" stroke="#0f172a" stroke-width="1" stroke-linecap="round"/><circle cx="15" cy="30" r="1.5" fill="${markerColor}" stroke="#0f172a" stroke-width="0.75"/></svg>`;
    return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") 15 30, crosshair`;
  }
  // The small target is centred on the CSS cursor hotspot. Keeping the marker
  // body away from that target makes the exact start/end point visible.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><path d="M28 2l6 6-20 20-6-6z" fill="${markerColor}" stroke="#0f172a" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 22l6 6-4 4-6-6z" fill="#f8fafc" stroke="#0f172a" stroke-width="1.5" stroke-linejoin="round"/><path d="M4.5 30h7M8 26.5v7" stroke="#fff" stroke-width="3" stroke-linecap="round"/><path d="M4.5 30h7M8 26.5v7" stroke="#0f172a" stroke-width="1" stroke-linecap="round"/><circle cx="8" cy="30" r="1.5" fill="${markerColor}" stroke="#0f172a" stroke-width="0.75"/></svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") 8 30, crosshair`;
}

function drawSampledPath(ctx, points, offset, stroke, width) {
  if (points.length < 2) return;
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = point.x - Math.sin(point.angle) * offset;
    const y = point.y + Math.cos(point.angle) * offset;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function drawZipper(ctx, path) {
  const info = fabric.util.getPathSegmentsInfo(path.path || []);
  const totalLength = Number(info.at(-1)?.length || 0);
  if (!Number.isFinite(totalLength) || totalLength < 2) return;

  const width = Math.max(12, Number(path.strokeWidth || 12));
  const railOffset = width * 0.31;
  const railWidth = Math.max(2.4, width * 0.2);
  const sampleStep = Math.max(2.5, Math.min(7, width * 0.28));
  const points = [];
  // Fabric reports the zero-distance point from the initial M command as
  // (0, 0), rather than the path's actual first point. Sampling a tiny distance
  // into the first drawable segment avoids a rail from the canvas origin.
  const firstDistance = Math.min(0.01, totalLength);
  for (let distance = firstDistance; distance <= totalLength; distance += sampleStep) {
    const point = fabric.util.getPointOnPath(path.path, distance, info);
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    points.push({
      x: point.x - path.pathOffset.x,
      y: point.y - path.pathOffset.y,
      angle: Number(point.angle || 0),
    });
  }
  const lastPoint = fabric.util.getPointOnPath(path.path, totalLength, info);
  if (lastPoint && Number.isFinite(lastPoint.x) && Number.isFinite(lastPoint.y)) {
    points.push({
      x: lastPoint.x - path.pathOffset.x,
      y: lastPoint.y - path.pathOffset.y,
      angle: Number(lastPoint.angle || 0),
    });
  }

  const sourceColor = path.highlighterSourceColor || '#facc15';
  drawSampledPath(ctx, points, -railOffset, 'rgba(15,23,42,0.72)', railWidth + 2);
  drawSampledPath(ctx, points, railOffset, 'rgba(15,23,42,0.72)', railWidth + 2);
  drawSampledPath(ctx, points, -railOffset, toHighlighterColor(sourceColor, 0.78), railWidth);
  drawSampledPath(ctx, points, railOffset, toHighlighterColor(sourceColor, 0.78), railWidth);

  const toothStep = Math.max(5.5, width * 0.48);
  const toothWidth = Math.max(1.5, width * 0.12);
  for (
    let distance = toothStep * 0.45, index = 0;
    distance < totalLength;
    distance += toothStep, index += 1
  ) {
    const point = fabric.util.getPointOnPath(path.path, distance, info);
    if (!point) continue;
    const angle = Number(point.angle || 0);
    const x = point.x - path.pathOffset.x;
    const y = point.y - path.pathOffset.y;
    const normalX = -Math.sin(angle);
    const normalY = Math.cos(angle);
    const from = index % 2 === 0 ? -railOffset * 0.88 : railOffset * 0.88;
    const to = index % 2 === 0 ? railOffset * 0.12 : -railOffset * 0.12;
    ctx.beginPath();
    ctx.moveTo(x + normalX * from, y + normalY * from);
    ctx.lineTo(x + normalX * to, y + normalY * to);
    ctx.strokeStyle = 'rgba(248,250,252,0.96)';
    ctx.lineWidth = toothWidth + 1.5;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.strokeStyle = 'rgba(51,65,85,0.92)';
    ctx.lineWidth = toothWidth;
    ctx.stroke();
  }

  drawSampledPath(ctx, points, 0, 'rgba(15,23,42,0.74)', Math.max(1, width * 0.07));
}

export function attachHighlighterRendering(path) {
  if (!path || path._highlighterRenderingAttached) return path;
  const originalRender = path._render;
  if (typeof originalRender !== 'function') return path;
  path._render = function (ctx) {
    if (normalizeHighlighterStyle(this.highlighterStyle) !== 'zipper') {
      originalRender.call(this, ctx);
      return;
    }
    drawZipper(ctx, this);
  };
  path._highlighterRenderingAttached = true;
  path.objectCaching = false;
  path.dirty = true;
  return path;
}

export class HighlighterTool extends BaseTool {
  constructor(canvasManager) {
    super(canvasManager);
    this.sourceColor = '#facc15';
    this.sourceWidth = 2;
    this.style = 'marker';
    this.onPathCreated = this.onPathCreated.bind(this);
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
    this.onWindowPointerUp = this.onWindowPointerUp.bind(this);
  }

  activate() {
    super.activate();
    if (!this.canvas) return;
    this.canvas.selection = false;
    this.canvas.isDrawingMode = true;
    this.canvas.freeDrawingBrush = new fabric.PencilBrush(this.canvas);
    this.applyBrushSettings();
    this.canvas.on('path:created', this.onPathCreated);
    this.canvas.on('mouse:down', this.onMouseDown);
    this.canvas.on('mouse:up', this.onMouseUp);
    // Fabric only listens for the pointerup on its own upper canvas. Release
    // the button outside the canvas — or during a shift-pan race — and the
    // brush never hears the mouseup and keeps drawing with mouse movement.
    // A window-level listener guarantees the stroke ends.
    window.addEventListener('pointerup', this.onWindowPointerUp);
  }

  onWindowPointerUp() {
    const brush = this.canvas?.freeDrawingBrush;
    if (!brush || !Array.isArray(brush._points) || brush._points.length === 0) return;
    // End the in-flight freehand stroke exactly as fabric's own mouseup would.
    this.canvas.isDrawingMode = true;
    try {
      brush.onMouseUp({});
    } catch {
      // A double finalize (canvas mouseup raced us) is harmless — the path
      // was already committed.
    }
  }

  deactivate() {
    if (this.canvas) {
      window.removeEventListener('pointerup', this.onWindowPointerUp);
      this.canvas.isDrawingMode = false;
      this.canvas.freeDrawingCursor = 'crosshair';
      this.canvas.defaultCursor = 'default';
      if (this.canvas.upperCanvasEl) this.canvas.upperCanvasEl.style.cursor = 'default';
      this.canvas.off('path:created', this.onPathCreated);
      this.canvas.off('mouse:down', this.onMouseDown);
      this.canvas.off('mouse:up', this.onMouseUp);
      this.canvas.selection = true;
    }
    super.deactivate();
  }

  applyBrushSettings() {
    if (!this.canvas?.freeDrawingBrush) return;
    this.canvas.freeDrawingBrush.color = toHighlighterColor(this.sourceColor);
    this.canvas.freeDrawingBrush.width = resolveHighlighterWidth(this.sourceWidth);
    this.canvas.freeDrawingBrush.strokeLineCap = 'round';
    this.canvas.freeDrawingBrush.strokeLineJoin = 'round';
    const cursor = createHighlighterCursor(this.sourceColor, this.style);
    this.canvas.freeDrawingCursor = cursor;
    this.canvas.defaultCursor = cursor;
    if (this.canvas.upperCanvasEl) this.canvas.upperCanvasEl.style.cursor = cursor;
  }

  onMouseDown(event) {
    const nativeEvent = event?.e || {};
    if (nativeEvent.altKey || nativeEvent.shiftKey || this.canvas.isGestureActive) {
      this.canvas.isDrawingMode = false;
      this._strokeInFlight = false;
      return;
    }
    this._strokeInFlight = true;
    window.app?.historyManager?.saveState({ force: true, reason: 'highlighter:start' });
  }

  onMouseUp() {
    this._strokeInFlight = false;
    if (this.isActive && !this.canvas.isDrawingMode) this.canvas.isDrawingMode = true;
  }

  onWindowPointerUp() {
    if (!this._strokeInFlight) return;
    // pointerup fires before fabric's mouseup — defer one tick so fabric's
    // own handler finalizes the stroke first when it received the event.
    window.setTimeout(() => {
      if (!this._strokeInFlight) return;
      this._strokeInFlight = false;
      const brush = this.canvas?.freeDrawingBrush;
      if (!brush || !Array.isArray(brush._points) || brush._points.length === 0) return;
      // End the stroke fabric never heard the mouseup for. If it was already
      // finalized meanwhile, _points is empty and this is a no-op.
      try {
        brush.onMouseUp({});
      } catch {
        // Already finalized — harmless.
      }
    }, 0);
  }

  onPathCreated(event) {
    this._strokeInFlight = false;
    const path = event?.path;
    if (!path) return;
    const bounds = path.getBoundingRect();
    if (Math.hypot(bounds.width, bounds.height) < 10) {
      this.canvas.remove(path);
      return;
    }
    const fallbackView =
      window.app?.projectManager?.currentViewId || window.currentImageLabel || 'front';
    path.set({
      stroke: toHighlighterColor(this.sourceColor),
      strokeWidth: resolveHighlighterWidth(this.sourceWidth),
      strokeLineCap: 'round',
      strokeLineJoin: 'round',
      fill: null,
      opacity: 1,
      selectable: true,
      evented: true,
      customType: 'highlighter',
      isHighlighter: true,
      highlighterStyle: this.style,
      highlighterSourceColor: this.sourceColor,
      imageLabel: resolveDrawingImageLabel(this.canvasManager, fallbackView),
      strokeDashArray: null,
    });
    // Fabric emits object:added before path:created. Older style listeners may
    // therefore have briefly treated this brush path as a measurement line.
    // Remove any inherited line/arrow state before the highlight is persisted.
    delete path.arrowSettings;
    delete path.dashSettings;
    delete path.lineStyle;
    if (path.strokeMetadata) delete path.strokeMetadata.arrowSettings;
    attachHighlighterRendering(path);
    path.setCoords();
    this.canvas.requestRenderAll();
    window.app?.historyManager?.saveState({ force: true, reason: 'highlighter:end' });
  }

  setColor(color) {
    this.sourceColor = color;
    this.applyBrushSettings();
  }

  setWidth(width) {
    this.sourceWidth = Number(width);
    this.applyBrushSettings();
  }

  setStyle(style) {
    this.style = normalizeHighlighterStyle(style);
    this.applyBrushSettings();
  }

  getStyle() {
    return this.style;
  }
}
