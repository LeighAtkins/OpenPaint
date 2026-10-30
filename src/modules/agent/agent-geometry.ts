/**
 * Read a saved SofaPaint project (getProjectData / .opaint project.json) as
 * plain measurement lines that an agent can reason about.
 *
 * Every point is normalised to the view's photo: { x: 0..1, y: 0..1 } from the
 * photo's top-left corner. Freehand/vector strokes are converted from canvas
 * coordinates through the view's background image; MOS overlay lines are stored
 * in a 0..1000 box over the photo already.
 */

export interface NormPoint {
  x: number;
  y: number;
}

export interface AgentLine {
  viewId: string;
  label: string;
  source: 'stroke' | 'overlay';
  /** Endpoints, normalised to the photo. Curves keep every point in `points`. */
  from: NormPoint;
  to: NormPoint;
  points: NormPoint[];
  inch: number | null;
  cm: number | null;
  visible: boolean;
}

export interface AgentView {
  viewId: string;
  title: string;
  imageWidth: number | null;
  imageHeight: number | null;
  lines: AgentLine[];
}

type AnyObj = Record<string, any>;

const MOS_RANGE = 1000;

function rotate(x: number, y: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
}

/** Map a point in an object's local space into its parent space. */
function toParent(px: number, py: number, o: AnyObj): [number, number] {
  const [rx, ry] = rotate(px * (o.scaleX ?? 1), py * (o.scaleY ?? 1), o.angle || 0);
  return [(o.left ?? 0) + rx, (o.top ?? 0) + ry];
}

/** Canvas-space points of a stroke's main line or path. */
export function strokeCanvasPoints(o: AnyObj | null | undefined): Array<[number, number]> {
  if (!o || typeof o !== 'object') return [];
  switch (o.type) {
    case 'group': {
      const child = (o.objects || []).find((c: AnyObj) =>
        ['line', 'path', 'polyline'].includes(c?.type)
      );
      return child ? strokeCanvasPoints(child).map(([x, y]) => toParent(x, y, o)) : [];
    }
    case 'line': {
      const cx = ((o.x1 ?? 0) + (o.x2 ?? 0)) / 2;
      const cy = ((o.y1 ?? 0) + (o.y2 ?? 0)) / 2;
      return [
        toParent((o.x1 ?? 0) - cx, (o.y1 ?? 0) - cy, o),
        toParent((o.x2 ?? 0) - cx, (o.y2 ?? 0) - cy, o),
      ];
    }
    case 'path': {
      const off = o.pathOffset || { x: 0, y: 0 };
      const pts: Array<[number, number]> = [];
      for (const seg of o.path || []) {
        const vals = Array.isArray(seg) ? seg.slice(1) : [];
        for (let i = 0; i + 1 < vals.length; i += 2) {
          pts.push(toParent(Number(vals[i]) - off.x, Number(vals[i + 1]) - off.y, o));
        }
      }
      return pts;
    }
    case 'polyline': {
      const off = o.pathOffset || { x: 0, y: 0 };
      return (o.points || []).map((p: AnyObj) => toParent(p.x - off.x, p.y - off.y, o));
    }
    default:
      return [];
  }
}

/** Canvas point to a point normalised over the view's background photo. */
export function canvasToPhoto(bg: AnyObj, x: number, y: number): NormPoint | null {
  const w = Number(bg?.width);
  const h = Number(bg?.height);
  if (!w || !h) return null;
  const sx = bg.scaleX ?? 1;
  const sy = bg.scaleY ?? sx;
  const centred = bg.originX === 'center';
  const cx = centred ? bg.left : bg.left + (w * sx) / 2;
  const cy = bg.originY === 'center' ? bg.top : bg.top + (h * sy) / 2;
  const [rx, ry] = rotate(x - cx, y - cy, -(bg.angle || 0));
  return { x: (rx / sx + w / 2) / w, y: (ry / sy + h / 2) / h };
}

const OVERLAY_SHAPE = /<(line|polyline)\b[^>]*\bid="(?:mos\d+_)?m([A-Za-z0-9]+?)cm"[^>]*?\/?>/g;

/** Labelled lines in a MOS overlay SVG (ids like mos12_mA1cm), normalised. */
export function overlayLines(svgText: string): Array<{ label: string; points: NormPoint[] }> {
  const out: Array<{ label: string; points: NormPoint[] }> = [];
  for (const m of (svgText || '').matchAll(OVERLAY_SHAPE)) {
    const tag = m[0];
    const attr = (name: string) => {
      const hit = new RegExp(`\\b${name}="([-\\d.]+)"`).exec(tag);
      return hit ? Number(hit[1]) : NaN;
    };
    let pts: NormPoint[] = [];
    if (m[1] === 'line') {
      pts = [
        { x: attr('x1'), y: attr('y1') },
        { x: attr('x2'), y: attr('y2') },
      ];
    } else {
      const raw = /\bpoints="([^"]*)"/.exec(tag)?.[1] || '';
      pts = raw
        .trim()
        .split(/\s+/)
        .map(pair => pair.split(',').map(Number))
        .filter(p => p.length === 2)
        .map(([x, y]) => ({ x, y }));
    }
    pts = pts
      .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
      .map(p => ({ x: p.x / MOS_RANGE, y: p.y / MOS_RANGE }));
    if (pts.length >= 2) out.push({ label: m[2], points: pts });
  }
  return out;
}

function measurementFor(view: AnyObj, label: string): { inch: number | null; cm: number | null } {
  const buckets = view?.metadata?.strokeMeasurements || {};
  for (const bucket of Object.values(buckets) as AnyObj[]) {
    const m = bucket?.[label];
    if (m && typeof m === 'object') {
      const inch = Number.isFinite(Number(m.inch)) ? Number(m.inch) : null;
      const cm = Number.isFinite(Number(m.cm)) ? Number(m.cm) : inch !== null ? inch * 2.54 : null;
      return { inch: inch ?? (cm !== null ? cm / 2.54 : null), cm };
    }
  }
  return { inch: null, cm: null };
}

/** Every labelled line in a project, grouped by view. */
export function readProjectLines(project: AnyObj): AgentView[] {
  const titles: AnyObj = project?.metadata?.imagePartLabels || {};
  const order: string[] =
    Array.isArray(project?.viewOrder) && project.viewOrder.length
      ? project.viewOrder
      : Object.keys(project?.views || {});
  const overlays: AnyObj[] = project?.mosOverlays?.overlays || [];
  const views: AgentView[] = [];

  for (const viewId of order) {
    const view = project?.views?.[viewId];
    if (!view) continue;
    const bg = view.canvasJSON?.backgroundImage || null;
    const lines: AgentLine[] = [];
    const seen = new Set<string>();

    // Overlay geometry first: a mounted view also mirrors overlay lines as strokes.
    for (const overlay of overlays) {
      if (overlay?.viewId !== viewId) continue;
      for (const { label, points } of overlayLines(overlay.svgText)) {
        if (seen.has(label)) continue;
        seen.add(label);
        lines.push({
          viewId,
          label,
          source: 'overlay',
          from: points[0],
          to: points[points.length - 1],
          points,
          ...measurementFor(view, label),
          visible: !Object.values(view.metadata?.strokeVisibilityByImage || {}).some(
            (bucket: any) => bucket?.[label] === false
          ),
        });
      }
    }

    const strokes = view.metadata?.vectorStrokesByImage || {};
    const visibility = view.metadata?.strokeVisibilityByImage || {};
    for (const [scope, bucket] of Object.entries(strokes) as Array<[string, AnyObj]>) {
      for (const [label, obj] of Object.entries(bucket || {})) {
        if (!bg || seen.has(label)) continue;
        const pts = strokeCanvasPoints(obj)
          .map(([x, y]) => canvasToPhoto(bg, x, y))
          .filter(Boolean) as NormPoint[];
        if (pts.length < 2) continue;
        seen.add(label);
        lines.push({
          viewId,
          label,
          source: 'stroke',
          from: pts[0],
          to: pts[pts.length - 1],
          points: pts,
          ...measurementFor(view, label),
          visible: visibility?.[scope]?.[label] !== false,
        });
      }
    }

    lines.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
    views.push({
      viewId,
      title: String(titles[viewId] || viewId),
      imageWidth: bg?.width ?? null,
      imageHeight: bg?.height ?? null,
      lines,
    });
  }
  return views;
}

const FRACTIONS: Record<number, string> = {
  1: '⅛',
  2: '¼',
  3: '⅜',
  4: '½',
  5: '⅝',
  6: '¾',
  7: '⅞',
};

/** 40.5 -> `40½" (102.9 cm)`: inches to the nearest eighth, then cm to 0.1. */
export function formatInchCm(inch: number): string {
  const eighths = Math.round(inch * 8);
  const whole = Math.floor(eighths / 8);
  const frac = FRACTIONS[eighths % 8] || '';
  const inchText = `${whole || !frac ? whole : ''}${frac}"`;
  return `${inchText} (${(Math.round(inch * 2.54 * 10) / 10).toFixed(1)} cm)`;
}

/** Normalised box around the given points with a margin, clamped to the photo. */
export function fitBox(
  points: NormPoint[],
  margin = 0.12,
  minSize = 0.35
): { x0: number; y0: number; x1: number; y1: number } {
  if (!points.length) return { x0: 0, y0: 0, x1: 1, y1: 1 };
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const grow = (lo: number, hi: number) => {
    let a = lo - margin;
    let b = hi + margin;
    if (b - a < minSize) {
      const mid = (a + b) / 2;
      a = mid - minSize / 2;
      b = mid + minSize / 2;
    }
    if (a < 0) [a, b] = [0, Math.min(1, b - a)];
    if (b > 1) [a, b] = [Math.max(0, a - (b - 1)), 1];
    return [a, b];
  };
  const [x0, x1] = grow(Math.min(...xs), Math.max(...xs));
  const [y0, y1] = grow(Math.min(...ys), Math.max(...ys));
  return { x0, y0, x1, y1 };
}
