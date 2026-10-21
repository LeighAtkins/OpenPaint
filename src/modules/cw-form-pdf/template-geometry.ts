/**
 * Where things sit on a CW template page: every value box (with its letter,
 * and for cushion tables the shape, seat / back and TYPE column), the printed
 * words used to line a scan or a flattened copy up with the template, and the
 * CM / INCH tick circles.
 *
 * Built from the library by scripts/build-pdf-registry.mjs into
 * src/data/pdf-template-geometry.json, which the reader loads only when a
 * page has no form fields (flattened or scanned).
 *
 * Rects are [x, y, w, h] in template points, origin top-left.
 */
import {
  findRowLabel,
  isLabelText,
  unitFromCaption,
  type CwPageData,
  type CwRect,
  type CwTextItem,
} from './parse-cw-form';

export type GeoRect = [number, number, number, number];

export interface GeoCell {
  /** Measurement letter ("A1", "D") or "Qty" for a cushion quantity box. */
  label: string;
  /** Cushion tables: "Box seat cushions, type 1". */
  section?: string;
  rect: GeoRect;
}

export interface GeoAnchor {
  text: string;
  rect: GeoRect;
}

export interface GeoUnit {
  unit: 'cm' | 'inch';
  rect: GeoRect;
}

export interface TemplateGeometry {
  width: number;
  height: number;
  cells: GeoCell[];
  anchors: GeoAnchor[];
  units: GeoUnit[];
}

const round = (n: number) => Math.round(n * 10) / 10;
const toGeo = (r: CwRect): GeoRect => [
  round(r.x0),
  round(r.y0),
  round(r.x1 - r.x0),
  round(r.y1 - r.y0),
];

/** Words of a printed line, each with a box estimated from its share of the characters. */
export function splitWords(item: CwTextItem): CwTextItem[] {
  const str = item.str;
  const total = str.length || 1;
  const width = item.rect.x1 - item.rect.x0;
  const out: CwTextItem[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(str))) {
    const x0 = item.rect.x0 + (width * m.index) / total;
    const x1 = item.rect.x0 + (width * (m.index + m[0].length)) / total;
    out.push({ str: m[0], rect: { x0, y0: item.rect.y0, x1, y1: item.rect.y1 } });
  }
  return out;
}

/** Anchor text as compared between OCR and template: upper case letters and digits only. */
export function anchorKey(raw: string): string {
  const s = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .trim();
  // OCR reads "A1" as "Al" / "AI" / "A|"; letters keep their digit.
  const label = /^([A-Z])([0-9LI|]{1,2})$/.exec(s);
  if (label) return label[1] + label[2].replace(/[LI|]/g, '1');
  return s;
}

const SHAPES: Record<string, string> = { T: 'T shaped', L: 'L-shaped', B: 'Box', W: 'Wedge' };

const mid = (r: CwRect) => ({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 });

/** Cushion table a box belongs to: shape letter and TYPE column above it, seat / back to its left. */
function cushionSection(rect: CwRect, texts: CwTextItem[]): string | undefined {
  const c = mid(rect);
  const types = texts
    .filter(t => /^TYPE\s*\d$/i.test(t.str.trim()))
    .filter(t => t.rect.y1 <= rect.y0 + 2 && t.rect.x0 <= rect.x1 && t.rect.x1 >= rect.x0)
    .sort((a, b) => b.rect.y1 - a.rect.y1);
  const type = types[0];
  if (!type) return undefined;
  const header = texts
    .filter(t => /^[TLBW]$/.test(t.str.trim()))
    .filter(t => Math.abs(mid(t.rect).y - mid(type.rect).y) < 4 && t.rect.x1 <= type.rect.x0 + 1)
    .sort((a, b) => b.rect.x1 - a.rect.x1)[0];
  const side = texts
    .filter(t => /^(SEAT|BACK)\s*CUSHIONS?$/i.test(t.str.trim()) && t.rect.x0 < rect.x0)
    .map(t => ({ t, dx: rect.x0 - t.rect.x0, dy: Math.abs(mid(t.rect).y - c.y) }))
    .filter(e => e.dx < 120)
    .sort((a, b) => a.dy - b.dy || a.dx - b.dx)[0];
  const parts: string[] = [];
  if (header) parts.push(SHAPES[header.str.trim()] || header.str.trim());
  if (side) parts.push(/^seat/i.test(side.t.str.trim()) ? 'seat cushions' : 'back cushions');
  const head = parts.join(' ');
  const typeText = type.str.trim().toLowerCase().replace(/\s+/, ' ');
  return head ? `${head[0].toUpperCase()}${head.slice(1)}, ${typeText}` : typeText;
}

/** "Qty" printed at the start of the box's row. */
function isQtyRow(rect: CwRect, texts: CwTextItem[]): boolean {
  const y = mid(rect).y;
  return texts.some(
    t =>
      /^(qty|quantity:?)$/i.test(t.str.trim()) &&
      Math.abs(mid(t.rect).y - y) <= (rect.y1 - rect.y0) / 2 + 2 &&
      t.rect.x1 <= rect.x0 + 2 &&
      rect.x0 - t.rect.x1 < 140
  );
}

export function buildTemplateGeometry(
  data: CwPageData,
  fieldMap: Record<string, string> = {}
): TemplateGeometry {
  const texts = data.allTexts || data.texts;
  const cells: GeoCell[] = [];
  const units: GeoUnit[] = [];
  for (const widget of data.widgets || []) {
    if (widget.type === 'text') {
      const label =
        findRowLabel(widget, data.texts) ||
        fieldMap[widget.name] ||
        (isQtyRow(widget.rect, texts) ? 'Qty' : null);
      if (!label) continue;
      const section = cushionSection(widget.rect, texts);
      cells.push({ label, ...(section ? { section } : {}), rect: toGeo(widget.rect) });
    } else if (widget.type === 'button') {
      const unit = unitFromCaption(widget, texts);
      if (unit) units.push({ unit, rect: toGeo(widget.rect) });
    }
  }
  const anchors: GeoAnchor[] = [];
  const seen = new Set<string>();
  for (const item of texts) {
    for (const word of splitWords(item)) {
      const key = anchorKey(word.str);
      if (key.length < 2 && !isLabelText(word.str)) continue;
      if (!key) continue;
      const rect = toGeo(word.rect);
      const id = `${key}@${Math.round(rect[0])},${Math.round(rect[1])}`;
      if (seen.has(id)) continue;
      seen.add(id);
      anchors.push({ text: key, rect });
    }
  }
  return {
    width: round(data.width),
    height: round(data.height),
    cells,
    anchors: anchors.slice(0, 220),
    units,
  };
}

export interface TemplateGeometryIndex {
  /** Distinct layouts, keyed by content hash. */
  shapes: Record<string, TemplateGeometry>;
  /** Template id -> layout key; forms published under several codes share one layout. */
  byTemplate: Record<string, string>;
}

let geometryCache: Promise<TemplateGeometryIndex> | null = null;

/** Template layouts, loaded on first use (only flattened and scanned pages need them). */
export function loadTemplateGeometries(): Promise<TemplateGeometryIndex> {
  geometryCache ||= import('../../data/pdf-template-geometry.json').then(
    mod => ((mod as any).default || mod) as TemplateGeometryIndex
  );
  return geometryCache;
}
