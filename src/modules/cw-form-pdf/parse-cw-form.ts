/**
 * Reads Comfort Works "Custom Sofa Measuring Diagram" PDFs.
 *
 * The CW form is a fillable PDF: measurement values live in AcroForm text
 * fields beside a label column (A1, B2, F* ...), and the diagram above draws
 * each measurement as a coloured line with a circled label. Some circles sit
 * on their line; others reach it through a short stem. This module recovers
 * label -> value -> line geometry so SofaPaint can rebuild real measurements.
 *
 * All geometry is returned in top-left page points (PDF user space flipped).
 */

export interface CwPoint {
  x: number;
  y: number;
}

export interface CwRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface CwStroke {
  points: CwPoint[];
  color: string;
  closed: boolean;
  curved: boolean;
  bbox: CwRect;
}

export interface CwTextItem {
  str: string;
  rect: CwRect;
}

export interface CwField {
  name: string;
  value: string;
  rect: CwRect;
}

export interface CwPageData {
  pageNumber: number;
  width: number;
  height: number;
  fields: CwField[];
  texts: CwTextItem[];
  strokes: CwStroke[];
}

/** A field's number; `range` holds both numbers when the customer wrote two (value is the default pick). */
export interface CwFieldValue {
  value: number;
  range?: number[];
  /** What the customer typed, tidied. */
  text?: string;
}

export interface CwMeasurement extends CwFieldValue {
  label: string;
  /** Line geometry in page points; 2 points for straight lines, more for curves. */
  points: CwPoint[];
  color: string;
}

export interface CwCircle {
  label: string;
  center: CwPoint;
  radius: number;
  color: string;
}

export interface CwFormView {
  pageNumber: number;
  title: string;
  unit: 'cm' | 'inch';
  unitAssumed: boolean;
  measurements: CwMeasurement[];
  /** Diagram area to render, in page points. */
  crop: CwRect;
  /** Original circled labels and stems to paint out before SofaPaint adds its tags. */
  maskCircles: CwCircle[];
  maskStems: CwPoint[][];
  /** Labels whose value was found but whose diagram line could not be resolved. */
  unplaced: Array<CwFieldValue & { label: string }>;
}

import { parseCustomerValue, rangeValue } from '../utils/customer-value';

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const LABEL_PATTERN = /^[A-Z]\d{0,2}\*?$/;

function multiply(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function apply(m: Matrix, x: number, y: number): CwPoint {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

function bboxOf(points: CwPoint[]): CwRect {
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

function sampleCubic(p0: CwPoint, p1: CwPoint, p2: CwPoint, p3: CwPoint, steps = 8): CwPoint[] {
  const out: CwPoint[] = [];
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    });
  }
  return out;
}

function normalizeHex(color: unknown): string {
  const raw = typeof color === 'string' ? color.trim() : '';
  return /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : '#000000';
}

/** Measurement lines and circles are saturated (red/teal); outlines and tables are grey. */
export function isSaturated(hex: string): boolean {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return false;
  const channels = match.slice(1).map(part => parseInt(part, 16));
  return Math.max(...channels) - Math.min(...channels) > 60;
}

function rectFromPdf(rect: number[], pageHeight: number): CwRect {
  const [x0, y0, x1, y1] = rect;
  return {
    x0: Math.min(x0, x1),
    y0: pageHeight - Math.max(y0, y1),
    x1: Math.max(x0, x1),
    y1: pageHeight - Math.min(y0, y1),
  };
}

/** Minimal pdf.js surface used here, so the parser runs in the browser and in Node tests. */
export interface PdfPageLike {
  pageNumber: number;
  view: number[];
  getAnnotations(): Promise<any[]>;
  getTextContent(): Promise<{ items: any[] }>;
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: any[] }>;
}

/** Pull fields, text and stroked paths out of one pdf.js page. */
export async function extractCwPageData(
  page: PdfPageLike,
  OPS: Record<string, number>
): Promise<CwPageData> {
  const [vx0, vy0, vx1, vy1] = page.view;
  const width = vx1 - vx0;
  const height = vy1 - vy0;
  const flip = (p: CwPoint): CwPoint => ({ x: p.x - vx0, y: height - (p.y - vy0) });

  const annotations = await page.getAnnotations();
  const textFields = annotations
    .filter(a => a?.fieldType === 'Tx')
    .map(a => ({
      name: String(a.fieldName || ''),
      value: String(a.fieldValue ?? '').trim(),
      rect: rectFromPdf(
        [a.rect[0] - vx0, a.rect[1] - vy0, a.rect[2] - vx0, a.rect[3] - vy0],
        height
      ),
    }));

  const textContent = await page.getTextContent();
  const allTexts: CwTextItem[] = textContent.items
    .filter(item => typeof item?.str === 'string' && item.str.trim())
    .map(item => {
      const [, , , d, e, f] = item.transform;
      const h = Math.abs(item.height || d || 0);
      const x = e - vx0;
      const baseline = height - (f - vy0);
      return {
        str: cleanText(item.str),
        rect: { x0: x, y0: baseline - h, x1: x + (item.width || 0), y1: baseline },
      };
    });
  // A form that was printed or flattened keeps its (now empty) fields, with the
  // typed values drawn as page text inside them. Read those back as values.
  const absorbed = new Set<CwTextItem>();
  const fields: CwField[] = textFields
    .map(field => {
      if (field.value) return field;
      const inside = allTexts.filter(t => contains(field.rect, center(t.rect), 2));
      const value = inside
        .map(t => t.str)
        .join(' ')
        .trim();
      if (!value || parseFieldValue(value) === null) return field;
      inside.forEach(t => absorbed.add(t));
      return { ...field, value };
    })
    .filter(field => field.value !== '');
  const texts = allTexts.filter(t => !absorbed.has(t));

  const strokes: CwStroke[] = [];
  const { fnArray, argsArray } = await page.getOperatorList();
  let ctm: Matrix = IDENTITY;
  let strokeColor = '#000000';
  const stack: Array<{ ctm: Matrix; strokeColor: string }> = [];
  const strokePaints = new Set(
    ['stroke', 'closeStroke', 'fillStroke', 'eoFillStroke', 'closeFillStroke', 'closeEOFillStroke']
      .map(name => OPS[name])
      .filter(value => value !== undefined)
  );

  for (let i = 0; i < fnArray.length; i += 1) {
    const fn = fnArray[i];
    const args = argsArray[i];
    if (fn === OPS.save) {
      stack.push({ ctm, strokeColor });
    } else if (fn === OPS.restore) {
      const state = stack.pop();
      if (state) ({ ctm, strokeColor } = state);
    } else if (fn === OPS.transform) {
      ctm = multiply(ctm, args as Matrix);
    } else if (fn === OPS.paintFormXObjectBegin) {
      stack.push({ ctm, strokeColor });
      if (Array.isArray(args?.[0]) && args[0].length === 6) ctm = multiply(ctm, args[0] as Matrix);
    } else if (fn === OPS.paintFormXObjectEnd) {
      const state = stack.pop();
      if (state) ({ ctm, strokeColor } = state);
    } else if (fn === OPS.setStrokeRGBColor) {
      strokeColor = normalizeHex(args?.[0]);
    } else if (fn === OPS.constructPath) {
      if (!strokePaints.has(args?.[0])) continue;
      const data: ArrayLike<number> = args?.[1]?.[0] || [];
      let current: CwPoint[] = [];
      let start: CwPoint | null = null;
      let curved = false;
      const flush = (closed: boolean) => {
        if (current.length >= 2) {
          const points = current.map(flip);
          strokes.push({ points, color: strokeColor, closed, curved, bbox: bboxOf(points) });
        }
        current = [];
        curved = false;
      };
      // pdf.js DrawOPS: 0 moveTo, 1 lineTo, 2 curveTo, 3 quadraticCurveTo, 4 closePath.
      for (let k = 0; k < data.length; ) {
        const op = data[k];
        if (op === 0) {
          flush(false);
          start = apply(ctm, data[k + 1], data[k + 2]);
          current = [start];
          k += 3;
        } else if (op === 1) {
          current.push(apply(ctm, data[k + 1], data[k + 2]));
          k += 3;
        } else if (op === 2) {
          const p0 = current[current.length - 1] || apply(ctm, data[k + 5], data[k + 6]);
          const p1 = apply(ctm, data[k + 1], data[k + 2]);
          const p2 = apply(ctm, data[k + 3], data[k + 4]);
          const p3 = apply(ctm, data[k + 5], data[k + 6]);
          current.push(...sampleCubic(p0, p1, p2, p3));
          curved = true;
          k += 7;
        } else if (op === 3) {
          const p0 = current[current.length - 1] || apply(ctm, data[k + 3], data[k + 4]);
          const q = apply(ctm, data[k + 1], data[k + 2]);
          const p3 = apply(ctm, data[k + 3], data[k + 4]);
          const c1 = { x: p0.x + (2 / 3) * (q.x - p0.x), y: p0.y + (2 / 3) * (q.y - p0.y) };
          const c2 = { x: p3.x + (2 / 3) * (q.x - p3.x), y: p3.y + (2 / 3) * (q.y - p3.y) };
          current.push(...sampleCubic(p0, c1, c2, p3));
          curved = true;
          k += 5;
        } else if (op === 4) {
          if (start) current.push(start);
          flush(true);
          k += 1;
        } else {
          break;
        }
      }
      flush(false);
    }
  }

  return { pageNumber: page.pageNumber, width, height, fields, texts, strokes };
}

// ── Analysis ──────────────────────────────────────────────────────────────

function pathLength(points: CwPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

function distanceToSegment(p: CwPoint, a: CwPoint, b: CwPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq
    ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq))
    : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function distanceToPath(p: CwPoint, points: CwPoint[]): number {
  let best = Infinity;
  for (let i = 1; i < points.length; i += 1) {
    best = Math.min(best, distanceToSegment(p, points[i - 1], points[i]));
  }
  return best;
}

function center(rect: CwRect): CwPoint {
  return { x: (rect.x0 + rect.x1) / 2, y: (rect.y0 + rect.y1) / 2 };
}

function contains(rect: CwRect, p: CwPoint, pad = 0): boolean {
  return (
    p.x >= rect.x0 - pad && p.x <= rect.x1 + pad && p.y >= rect.y0 - pad && p.y <= rect.y1 + pad
  );
}

function intersects(a: CwRect, b: CwRect): boolean {
  return a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
}

function union(rects: CwRect[]): CwRect {
  return {
    x0: Math.min(...rects.map(r => r.x0)),
    y0: Math.min(...rects.map(r => r.y0)),
    x1: Math.max(...rects.map(r => r.x1)),
    y1: Math.max(...rects.map(r => r.y1)),
  };
}

function normalizeLabel(raw: string): string {
  return cleanText(raw).replace(/\*$/, '').trim();
}

/** Forms mix ASCII and typographic asterisks ("F*" vs "F∗") for optional measurements. */
function cleanText(raw: string): string {
  return raw
    .replace(/[\u2217\uFF0A\u2731\u204E]/g, '*')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A filled field as a number. Customers write "104.78", "48,9", "22-1/4"",
 * "36 3/4"", "8¼", "71"", "33,5 cm". Text ("n/a", "see photos"), lone
 * fractions ("1/2") and ranges ("24.5 - 25") give null here; use
 * parseFieldValue to keep a range.
 */
export function parseNumericValue(raw: string): number | null {
  const parsed = parseCustomerValue(raw);
  return parsed.kind === 'single' ? parsed.values[0] : null;
}

/** A filled field with both numbers of a range kept, or null when it holds no number. */
export function parseFieldValue(raw: string): CwFieldValue | null {
  const parsed = parseCustomerValue(raw);
  if (parsed.kind === 'none') return null;
  return {
    value: parsed.kind === 'range' ? rangeValue(parsed) : parsed.values[0],
    range: parsed.kind === 'range' ? parsed.values : undefined,
    text: parsed.text,
  };
}

/** Find the label printed immediately left of a field in the same table row. */
function findRowLabel(field: CwField, texts: CwTextItem[]): string | null {
  const midY = (field.rect.y0 + field.rect.y1) / 2;
  let best: { label: string; gap: number } | null = null;
  for (const text of texts) {
    if (!LABEL_PATTERN.test(cleanText(text.str))) continue;
    const textMid = (text.rect.y0 + text.rect.y1) / 2;
    if (Math.abs(textMid - midY) > (field.rect.y1 - field.rect.y0) / 2 + 2) continue;
    const gap = field.rect.x0 - text.rect.x1;
    // TYPE 2 values sit a full column (~75pt) from the row label.
    if (gap < -2 || gap > 140) continue;
    if (!best || gap < best.gap) best = { label: normalizeLabel(text.str), gap };
  }
  return best?.label ?? null;
}

/** Circled diagram labels: a saturated closed curve with a label text inside. */
function findCircles(data: CwPageData): CwCircle[] {
  const circles: CwCircle[] = [];
  for (const stroke of data.strokes) {
    if (!stroke.curved || !isSaturated(stroke.color)) continue;
    const w = stroke.bbox.x1 - stroke.bbox.x0;
    const h = stroke.bbox.y1 - stroke.bbox.y0;
    if (w < 8 || w > 40 || Math.abs(w - h) > 3) continue;
    const c = center(stroke.bbox);
    const text = data.texts.find(
      t => LABEL_PATTERN.test(cleanText(t.str)) && contains(stroke.bbox, center(t.rect), 1)
    );
    // Some forms outline the glyphs (e.g. "F∗"), leaving a circle with no text.
    circles.push({
      label: text ? normalizeLabel(text.str) : '',
      center: c,
      radius: w / 2,
      color: stroke.color,
    });
  }
  return circles;
}

function measurementStrokes(data: CwPageData, circles: CwCircle[]): CwStroke[] {
  return data.strokes.filter(stroke => {
    if (!isSaturated(stroke.color)) return false;
    if (pathLength(stroke.points) < 4) return false;
    // Skip the circles themselves.
    return !circles.some(
      circle =>
        stroke.curved &&
        Math.abs(stroke.bbox.x1 - stroke.bbox.x0 - circle.radius * 2) < 3 &&
        contains(stroke.bbox, circle.center)
    );
  });
}

function sameColor(a: string, b: string): boolean {
  const pa = /^#(..)(..)(..)$/.exec(a);
  const pb = /^#(..)(..)(..)$/.exec(b);
  if (!pa || !pb) return a === b;
  return [1, 2, 3].every(i => Math.abs(parseInt(pa[i], 16) - parseInt(pb[i], 16)) <= 24);
}

/** Resolve the measurement line a circled label refers to. */
export function resolveCircleLine(
  circle: CwCircle,
  strokes: CwStroke[]
): { line: CwStroke; stems: CwStroke[] } | null {
  const candidates = strokes.filter(stroke => sameColor(stroke.color, circle.color));
  const reach = circle.radius + 1.5;

  // 1. The label sits on its own line.
  const through = candidates
    .filter(
      s =>
        distanceToPath(circle.center, s.points) <= reach &&
        pathLength(s.points) > circle.radius * 2 + 6
    )
    .sort((a, b) => pathLength(b.points) - pathLength(a.points))[0];
  if (through) return { line: through, stems: [] };

  // 2. A stem leaves the circle and touches the line.
  const stems = candidates.filter(s => {
    const ends = [s.points[0], s.points[s.points.length - 1]];
    return ends.some(
      p => Math.hypot(p.x - circle.center.x, p.y - circle.center.y) <= circle.radius + 3
    );
  });
  for (const stem of stems.sort((a, b) => pathLength(a.points) - pathLength(b.points))) {
    const ends = [stem.points[0], stem.points[stem.points.length - 1]];
    const far = ends.reduce((a, b) =>
      Math.hypot(a.x - circle.center.x, a.y - circle.center.y) >
      Math.hypot(b.x - circle.center.x, b.y - circle.center.y)
        ? a
        : b
    );
    const target = candidates
      .filter(s => s !== stem && !stems.includes(s) && distanceToPath(far, s.points) <= 3)
      .sort((a, b) => pathLength(b.points) - pathLength(a.points))[0];
    if (target) return { line: target, stems: [stem] };
  }

  // 3. Short dimension arrows (e.g. 3" offsets) sit just beside their label;
  //    otherwise take the nearest same-colour line long enough to be a measurement.
  const nearby = candidates
    .filter(s => !stems.includes(s))
    .map(s => ({ s, d: distanceToPath(circle.center, s.points), len: pathLength(s.points) }));
  const nearest =
    nearby.filter(e => e.d <= circle.radius + 15).sort((a, b) => a.d - b.d)[0] ||
    nearby.filter(e => e.len >= 20 && e.d <= 40).sort((a, b) => a.d - b.d)[0];
  return nearest ? { line: nearest.s, stems } : null;
}

export function detectUnit(texts: CwTextItem[]): { unit: 'cm' | 'inch'; assumed: boolean } {
  const joined = texts.map(t => t.str).join(' ');
  const match =
    /\b(?:measurements|dimensions)\s+(?:are\s+)?in\s+(cm|centimet\w*|inch\w*|in)\b/i.exec(joined);
  if (match) return { unit: /^c/i.test(match[1]) ? 'cm' : 'inch', assumed: false };
  if (/centimet(re|er)s/i.test(joined)) return { unit: 'cm', assumed: false };
  return { unit: 'cm', assumed: true };
}

/** Group the grey furniture outline into separate drawings (one per diagram). */
function outlineComponents(data: CwPageData): CwRect[] {
  const fieldRects = data.fields.map(f => f.rect);
  const boxes = data.strokes
    .filter(s => !isSaturated(s.color) && pathLength(s.points) >= 10)
    .filter(s => !fieldRects.some(r => intersects(s.bbox, r)))
    .map(s => s.bbox)
    // Page rules and table frames span most of the page width; furniture does not.
    .filter(b => b.x1 - b.x0 < data.width * 0.6);
  const parent = boxes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const grow = (r: CwRect): CwRect => ({ x0: r.x0 - 2, y0: r.y0 - 2, x1: r.x1 + 2, y1: r.y1 + 2 });
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      if (intersects(grow(boxes[i]), boxes[j])) parent[find(i)] = find(j);
    }
  }
  const byRoot = new Map<number, CwRect[]>();
  boxes.forEach((box, i) => byRoot.set(find(i), [...(byRoot.get(find(i)) || []), box]));
  return [...byRoot.values()].map(union).filter(r => r.x1 - r.x0 > 30 && r.y1 - r.y0 > 30);
}

function distanceToRect(p: CwPoint, r: CwRect): number {
  const dx = Math.max(r.x0 - p.x, 0, p.x - r.x1);
  const dy = Math.max(r.y0 - p.y, 0, p.y - r.y1);
  return Math.hypot(dx, dy);
}

/**
 * Several diagrams on a page can reuse the same letters (T, L, box, wedge
 * cushions). Assign each circle to its nearest furniture drawing, then for a
 * repeated label prefer the drawing level with the table (CW forms lay each
 * diagram beside its table row), then the one carrying more of its labels.
 */
function pickDiagramCircles(
  labels: string[],
  circles: CwCircle[],
  tableMid: CwPoint,
  components: CwRect[]
): Map<string, CwCircle> {
  const componentOf = (c: CwCircle): number => {
    let best = -1;
    let bestDistance = 60;
    components.forEach((rect, index) => {
      const d = distanceToRect(c.center, rect);
      if (d < bestDistance) {
        bestDistance = d;
        best = index;
      }
    });
    return best;
  };
  const owned = circles.map(c => ({ c, component: componentOf(c) }));
  const coverage = new Map<number, Set<string>>();
  owned.forEach(({ c, component }) => {
    if (!labels.includes(c.label)) return;
    coverage.set(component, (coverage.get(component) || new Set()).add(c.label));
  });
  const rank = (component: number): number => {
    const rect = components[component];
    const level = rect ? Math.abs((rect.y0 + rect.y1) / 2 - tableMid.y) : 1000;
    // Row alignment decides; coverage only separates drawings at a similar level.
    return level - (coverage.get(component)?.size || 0) * 20;
  };

  const picks = new Map<string, CwCircle>();
  for (const label of labels) {
    const choice = owned
      .filter(entry => entry.c.label === label)
      .sort((a, b) => rank(a.component) - rank(b.component))[0];
    if (choice) picks.set(label, choice.c);
  }

  // A label missing from the main drawing (or borrowed from a neighbouring one)
  // pairs with the main drawing's single unlabelled circle, e.g. an outlined "F∗".
  const componentCounts = new Map<number, number>();
  owned
    .filter(e => [...picks.values()].includes(e.c) && e.component >= 0)
    .forEach(e => componentCounts.set(e.component, (componentCounts.get(e.component) || 0) + 1));
  const main = [...componentCounts.entries()].sort(
    (a, b) => b[1] - a[1] || rank(a[0]) - rank(b[0])
  )[0];
  if (main && main[1] * 2 >= labels.length) {
    const componentOfPick = (circle: CwCircle) => owned.find(e => e.c === circle)?.component;
    const outliers = labels.filter(label => {
      const pick = picks.get(label);
      return !pick || componentOfPick(pick) !== main[0];
    });
    const unlabelled = owned.filter(e => !e.c.label && e.component === main[0]);
    if (outliers.length === 1 && unlabelled.length === 1) {
      picks.set(outliers[0], { ...unlabelled[0].c, label: outliers[0] });
    }
  }
  return picks;
}

function nearestHeading(data: CwPageData, near: CwPoint): string {
  const headings = data.texts
    .filter(t => /^(perspective view .+|[A-Z][A-Z -]+ CUSHIONS?)$/i.test(t.str))
    .map(t => ({ str: t.str, d: Math.hypot(center(t.rect).x - near.x, center(t.rect).y - near.y) }))
    .sort((a, b) => a.d - b.d);
  return headings[0]?.str || `Page ${data.pageNumber}`;
}

/** Turn one page into SofaPaint views (one per non-colliding set of labels). */
export function analyzeCwFormPage(
  data: CwPageData,
  fallbackUnit?: { unit: 'cm' | 'inch'; assumed: boolean }
): CwFormView[] {
  const labelled = data.fields
    .map(field => {
      const label = findRowLabel(field, data.texts);
      const value = parseFieldValue(field.value);
      return label && value !== null ? { field, label, ...value } : null;
    })
    .filter(Boolean) as Array<CwFieldValue & { field: CwField; label: string }>;
  if (!labelled.length) return [];

  // Separate tables that reuse labels (TYPE 1 / TYPE 2, seat / back).
  const groups: Array<typeof labelled> = [];
  const ordered = labelled
    .slice()
    .sort((a, b) => a.field.rect.x0 - b.field.rect.x0 || a.field.rect.y0 - b.field.rect.y0);
  for (const entry of ordered) {
    const group = groups.find(g => !g.some(item => item.label === entry.label));
    if (group) group.push(entry);
    else groups.push([entry]);
  }

  const circles = findCircles(data);
  const strokes = measurementStrokes(data, circles);
  const components = outlineComponents(data);
  const fieldRects = data.fields.map(f => f.rect);
  const pageUnit = detectUnit(data.texts);
  const unit = pageUnit.assumed && fallbackUnit ? fallbackUnit : pageUnit;

  return groups.map(group => {
    const tableBox = union(group.map(entry => entry.field.rect));
    const tableMid = center(tableBox);
    const measurements: CwMeasurement[] = [];
    const maskCircles: CwCircle[] = [];
    const maskStems: CwPoint[][] = [];
    const unplaced: Array<CwFieldValue & { label: string }> = [];
    const used: CwRect[] = [];

    const circleFor = pickDiagramCircles(
      group.map(entry => entry.label),
      circles,
      tableMid,
      components
    );
    for (const entry of group) {
      const circle = circleFor.get(entry.label);
      const resolved = circle ? resolveCircleLine(circle, strokes) : null;
      if (!circle || !resolved) {
        unplaced.push({
          label: entry.label,
          value: entry.value,
          range: entry.range,
          text: entry.text,
        });
        continue;
      }
      const points = resolved.line.curved
        ? resolved.line.points
        : [resolved.line.points[0], resolved.line.points[resolved.line.points.length - 1]];
      measurements.push({
        label: entry.label,
        value: entry.value,
        range: entry.range,
        text: entry.text,
        points,
        color: resolved.line.color,
      });
      maskCircles.push(circle);
      resolved.stems.forEach(stem => maskStems.push(stem.points));
      used.push(resolved.line.bbox, {
        x0: circle.center.x - circle.radius,
        y0: circle.center.y - circle.radius,
        x1: circle.center.x + circle.radius,
        y1: circle.center.y + circle.radius,
      });
      resolved.stems.forEach(stem => used.push(stem.bbox));
    }

    let crop: CwRect = { x0: 0, y0: 0, x1: data.width, y1: data.height };
    if (used.length) {
      const core = union(used);
      const probe = { x0: core.x0 - 4, y0: core.y0 - 4, x1: core.x1 + 4, y1: core.y1 + 4 };
      // Pull in the furniture outline drawn around the measurements, but never table borders.
      const outline = data.strokes
        .filter(s => !isSaturated(s.color) && intersects(s.bbox, probe))
        .filter(s => !fieldRects.some(r => intersects(s.bbox, r)))
        .map(s => s.bbox);
      const area = union([core, ...outline]);
      const pad = 14;
      crop = {
        x0: Math.max(0, area.x0 - pad),
        y0: Math.max(0, area.y0 - pad),
        x1: Math.min(data.width, area.x1 + pad),
        y1: Math.min(data.height, area.y1 + pad),
      };
    }

    const shape = nearestHeading(data, center(crop));
    const tableKind = data.texts
      .filter(t => /^(SEAT|BACK) CUSHIONS$/i.test(t.str))
      .map(t => ({
        str: t.str,
        d: Math.hypot(center(t.rect).x - tableMid.x, center(t.rect).y - tableMid.y),
      }))
      .sort((a, b) => a.d - b.d)[0];
    const title =
      tableKind && tableKind.d < 120 ? `${shape}, ${tableKind.str.toLowerCase()}` : shape;
    return {
      pageNumber: data.pageNumber,
      title,
      unit: unit.unit,
      unitAssumed: unit.assumed,
      measurements,
      crop,
      maskCircles,
      maskStems,
      unplaced,
    };
  });
}

/** Document-level unit hint from any page (e.g. "Converted measurements in centimetres"). */
export function detectDocumentUnit(pages: CwPageData[]): { unit: 'cm' | 'inch'; assumed: boolean } {
  for (const page of pages) {
    const unit = detectUnit(page.texts);
    if (!unit.assumed) return unit;
  }
  // Values typed with their own unit marks (71", 22-1/4", 33 cm) settle it.
  const units = pages.flatMap(page =>
    page.fields.map(field => parseCustomerValue(field.value).unit)
  );
  const inches = units.filter(u => u === 'in').length;
  const cms = units.filter(u => u === 'cm').length;
  if (inches > cms && inches >= 2) return { unit: 'inch', assumed: false };
  if (cms > inches && cms >= 2) return { unit: 'cm', assumed: false };
  return { unit: 'cm', assumed: true };
}
