/** Qwen places geometry only. Numeric dimensions always come from the selected catalogue. */
export const dimensionKeys = ['width', 'depth', 'height'] as const;
export type DimensionKey = (typeof dimensionKeys)[number];
export type Unit = 'cm' | 'in';
export type Dimensions = Partial<Record<DimensionKey, unknown>>;
export interface Point {
  x: number;
  y: number;
}
export interface DimensionSpan {
  key: DimensionKey;
  start: Point;
  end: Point;
  offset: Point;
  evidence: string;
}
export interface OverallPlacement {
  spans: DimensionSpan[];
  omissions: Array<{ key: DimensionKey; reason: string }>;
}
export const overallModel = '@cf/qwen/qwen3.8-27b';
export const overallProtocol = 'catalogue-overall-v7';
export function dimensionValue(
  dimensions: Dimensions,
  key: DimensionKey,
  unit: Unit
): number | null {
  const raw = dimensions?.[key];
  if (!raw || typeof raw !== 'object') return null;
  const values = raw as Record<string, unknown>;
  const number = (v: unknown) =>
    (typeof v === 'number' || typeof v === 'string') && String(v).trim() ? Number(v) : NaN;
  const direct = number(values[unit]);
  const other = number(values[unit === 'cm' ? 'in' : 'cm']);
  const value =
    Number.isFinite(direct) && direct > 0
      ? direct
      : Number.isFinite(other) && other > 0
        ? other * (unit === 'cm' ? 2.54 : 1 / 2.54)
        : NaN;
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}
export const dimensionTitle = (key: DimensionKey) => key[0].toUpperCase() + key.slice(1);
export function dimensionLabel(dimensions: Dimensions, key: DimensionKey, unit: Unit): string {
  const value = dimensionValue(dimensions, key, unit);
  return `${dimensionTitle(key)} · ${value === null ? 'Not available' : `${value} ${unit}`}`;
}
export function parseOverallPlacement(value: unknown): OverallPlacement {
  if (!value || typeof value !== 'object') throw Error('Qwen returned no dimension geometry.');
  const raw = value as OverallPlacement;
  if (
    !Array.isArray(raw.spans) ||
    !Array.isArray(raw.omissions) ||
    raw.spans.length + raw.omissions.length !== 3
  )
    throw Error('Qwen must account for exactly Width, Depth and Height.');
  const seen = new Set<string>();
  const point = (p: Point, min = 0, max = 1) =>
    p &&
    Number.isFinite(p.x) &&
    Number.isFinite(p.y) &&
    p.x >= min &&
    p.x <= max &&
    p.y >= min &&
    p.y <= max;
  for (const item of [...raw.spans, ...raw.omissions]) {
    if (!dimensionKeys.includes(item.key) || seen.has(item.key))
      throw Error('Unexpected or duplicate dimension.');
    seen.add(item.key);
    if ('start' in item) {
      if (
        !point(item.start) ||
        !point(item.end) ||
        !point(item.offset, -0.18, 0.18) ||
        Math.hypot(item.start.x - item.end.x, item.start.y - item.end.y) < 0.03 ||
        typeof item.evidence !== 'string' ||
        !item.evidence.trim()
      )
        throw Error(`Invalid ${item.key} span.`);
    } else if (typeof item.reason !== 'string' || !item.reason.trim())
      throw Error('An omitted dimension needs an explanation.');
  }
  // Return only declared fields; model-supplied values, HTML and styling never enter the renderer.
  return {
    spans: raw.spans.map(s => ({
      key: s.key,
      start: { x: s.start.x, y: s.start.y },
      end: { x: s.end.x, y: s.end.y },
      offset: { x: s.offset.x, y: s.offset.y },
      evidence: s.evidence.slice(0, 600),
    })),
    omissions: raw.omissions.map(o => ({ key: o.key, reason: o.reason.slice(0, 600) })),
  };
}
export function overallPrompt(): string {
  return `Locate the three overall dimensions in this furniture photo. Return JSON only: {"spans":[{"key":"width|depth|height","start":{"x":0,"y":0},"end":{"x":0,"y":0},"offset":{"x":0,"y":0},"evidence":"brief physical endpoints"}],"omissions":[{"key":"width|depth|height","reason":"why not visible or inferable"}]}. Account for each key exactly once. All coordinates are fractions 0..1 of the original photo. Set all offsets to zero; the renderer adds external lines and guides. Output geometry only: no numeric measurements, labels, SVG or styling.
WIDTH: first identify the FRONT END/FACE of EACH arm (the arm cap beside the front of its seat). Connect the OUTSIDE edge of the LEFT ARM FRONT FACE to the OUTSIDE edge of the RIGHT ARM FRONT FACE. On a visible side panel, the front outside seam/corner may be further INWARD in the image than the rear silhouette: use that FRONT outside edge, NOT the leftmost/rearmost silhouette of the whole side panel. For square/box arms use the OUTSIDE FRONT TOP CORNER where the horizontal arm top, outer side panel and narrow front cap meet. A side panel has both a back vertical edge and a front vertical edge: the front edge is the one beside the seat FRONT, closer to the camera. On the foreground left arm it is often the RIGHT edge of the visible side panel, not its left silhouette. For rolled arms use the widest bulge of the FRONT arm cap. Keep each endpoint's actual y, at comparable heights on the two front arm faces; never force horizontal. On a chaise the projecting seat/front panel is NOT the arm front: find the actual arm cap further back. Exclude inner edges, seats, rear corners and narrower skirt corners.
DEPTH: first check for a chaise. If present, START on the bottom-front corner of the LONG projecting chaise itself. Do NOT measure the shallow sofa section or the opposite short arm side. END at the furthest rear of the furniture on the SAME chaise depth axis and physical height. Rear base projection may be inferred from the back/arm and visible receding base edges. For a regular sofa use furthest front (including projecting panel) to furthest rear. Follow the front-to-back perspective; use base/floor plane for BOTH endpoints, never connect front cushion to rear arm top. The renderer places this line bottom left and adds guides back to these physical points. Omit depth if the full extent cannot be supported.
HEIGHT: highest back cushion or frame to floor/bottom of feet, aligned vertically at the same x.
Use straight spans across the overall extents. Evidence must be brief and identify the actual endpoints. Hidden extrema may only be inferred when the photo supports them.`;
}
/** Shared presentation geometry: retain the located physical anchors and move only dimension lines. */
export function layoutOverallPlacement(raw: OverallPlacement): OverallPlacement {
  const p = parseOverallPlacement(raw);
  const width = p.spans.find(s => s.key === 'width');
  const depth = p.spans.find(s => s.key === 'depth');
  const height = p.spans.find(s => s.key === 'height');
  const left = width
    ? Math.min(width.start.x, width.end.x)
    : Math.min(...p.spans.flatMap(s => [s.start.x, s.end.x]));
  const bottom = Math.max(0, ...p.spans.flatMap(s => [s.start.y, s.end.y]));
  if (width) width.offset = { x: 0, y: 0 };
  if (depth) {
    const front = depth.start.y >= depth.end.y ? depth.start : depth.end;
    // Translate both ends equally: depth stays parallel to the chaise/base,
    // while witnesses extend from the actual front and rear to the bottom-left lane.
    depth.offset = { x: left + 0.12 - front.x, y: bottom + 0.13 - front.y };
  }
  if (height) {
    const depthLeft = depth ? Math.min(depth.start.x, depth.end.x) + depth.offset.x : left;
    height.offset = { x: Math.min(left, depthLeft) - 0.18 - height.start.x, y: 0 };
  }
  return p;
}
/** Make room for external lines and native labels without changing photograph coordinates. */
export function overallPhotoPadding(raw: OverallPlacement): number {
  const p = layoutOverallPlacement(raw);
  const points = p.spans.flatMap(s =>
    [s.start, s.end].map(p => ({ x: p.x + s.offset.x, y: p.y + s.offset.y }))
  );
  return Math.max(
    0.18,
    ...points.flatMap(p => [-p.x + 0.16, p.x - 1 + 0.16, -p.y + 0.08, p.y - 1 + 0.08])
  );
}
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!
  );
export function renderOverallSvg(
  placement: OverallPlacement,
  dimensions: Dimensions,
  unit: Unit,
  imageUrl?: string,
  imageSize = { width: 1000, height: 1000 }
): string {
  const p = layoutOverallPlacement(placement);
  const h = (1000 * imageSize.height) / imageSize.width;
  const colors = { width: '#155e75', depth: '#9a3412', height: '#6b21a8' };
  const bounds: Array<{ x: number; y: number }> = [];
  const body = p.spans
    .map(span => {
      if (dimensionValue(dimensions, span.key, unit) === null) return '';
      const a = { x: span.start.x * 1000, y: span.start.y * h },
        b = { x: span.end.x * 1000, y: span.end.y * h };
      const ox = span.offset.x * 1000,
        oy = span.offset.y * h;
      const x1 = a.x + ox,
        y1 = a.y + oy,
        x2 = b.x + ox,
        y2 = b.y + oy;
      const label = dimensionLabel(dimensions, span.key, unit);
      const width = Math.max(160, label.length * 9.8 + 24);
      const mx = (x1 + x2) / 2;
      const my = Math.min(h + 90, Math.max(-90, (y1 + y2) / 2 - 15));
      bounds.push(
        { x: Math.min(a.x, b.x) - 80, y: Math.min(a.y, b.y) - 80 },
        { x: Math.max(a.x, b.x) + 80, y: Math.max(a.y, b.y) + 80 },
        { x: Math.min(x1, x2), y: Math.min(y1, y2) },
        { x: Math.max(x1, x2), y: Math.max(y1, y2) },
        { x: mx - width / 2, y: my - 17 },
        { x: mx + width / 2, y: my + 17 }
      );
      return `<g stroke="${colors[span.key]}" fill="none" stroke-width="3" stroke-linecap="round"><title>${escape(span.evidence)}</title><path d="M${a.x},${a.y}L${x1},${y1} M${b.x},${b.y}L${x2},${y2}" stroke-opacity=".55" stroke-width="1.6"/><path d="M${x1},${y1}L${x2},${y2}" marker-start="url(#overall-${span.key})" marker-end="url(#overall-${span.key})"/><rect x="${mx - width / 2}" y="${my - 17}" width="${width}" height="34" rx="8" fill="white" stroke="${colors[span.key]}" stroke-width="1"/><text x="${mx}" y="${my + 6}" fill="${colors[span.key]}" stroke="none" font-size="19" font-family="Arial,sans-serif" font-weight="600" text-anchor="middle">${escape(label)}</text></g>`;
    })
    .join('');
  const crop =
    p.spans.length === 3 &&
    dimensionKeys.every(key => dimensionValue(dimensions, key, unit) !== null);
  const left = crop && bounds.length ? Math.min(...bounds.map(p => p.x)) - 32 : -180;
  const top = crop && bounds.length ? Math.min(...bounds.map(p => p.y)) - 32 : -180;
  const right = crop && bounds.length ? Math.max(...bounds.map(p => p.x)) + 32 : 1180;
  const bottom = crop && bounds.length ? Math.max(...bounds.map(p => p.y)) + 32 : h + 180;
  // Trim surplus catalogue whitespace while retaining physical extrema, witnesses and labels.
  const viewWidth = right - left,
    viewHeight = bottom - top;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${viewWidth}" height="${viewHeight}" style="width:100%;height:auto;display:block" viewBox="${left} ${top} ${viewWidth} ${viewHeight}" role="img" aria-label="Overall catalogue dimensions in ${unit}"><defs>${dimensionKeys.map(k => `<marker id="overall-${k}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M9,1L1,5L9,9" fill="none" stroke="${colors[k]}" stroke-width="2"/></marker>`).join('')}</defs>${imageUrl ? `<image href="${escape(imageUrl)}" x="0" y="0" width="1000" height="${h}" preserveAspectRatio="none"/>` : ''}${body}</svg>`;
}
