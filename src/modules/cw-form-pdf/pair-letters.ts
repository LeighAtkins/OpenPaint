/**
 * One path for every page without form fields: text positioned on the page
 * (pdf.js text of a flattened PDF, or OCR of a scan) is lined up with the
 * template it was printed from, and each value is read from the box beside
 * its printed letter.
 *
 * Coordinates here are normalised to the page (0..1, origin top-left), the
 * same form Apple Vision and the OCR worker report.
 */
import { parseCustomerValue, type CustomerValue } from '../utils/customer-value';
import { isLabelText } from './parse-cw-form';
import { anchorKey, type GeoRect, type TemplateGeometry } from './template-geometry';

export interface TextLine {
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  /** 0..1 */
  confidence: number;
  /** Small picture of an OCR'd box (data URL), for the review strip. */
  thumb?: string;
}

export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Template (normalised) -> page (normalised), per axis. */
export interface PageTransform {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
}

export const IDENTITY_TRANSFORM: PageTransform = { sx: 1, sy: 1, tx: 0, ty: 0 };

export interface Alignment extends PageTransform {
  /** Printed words found where the template has them. */
  inliers: number;
  /** inliers / printed words the template has (capped by what was read), 0..1. */
  score: number;
}

export interface PageGeometry {
  geometry?: TemplateGeometry | null;
  transform?: PageTransform | null;
}

export interface PairedValue {
  /** True for a lone mark in an otherwise empty cushion table (part of a sketch): not a value. */
  stray?: boolean;
  label: string;
  section?: string;
  text: string;
  value: CustomerValue | null;
  confidence: number;
  /** Reasons a person should look at this value. */
  review: string[];
  /** The value box on the page (normalised). */
  rect: NormRect;
  thumb?: string;
}

export function templateRect(rect: GeoRect, geo: TemplateGeometry, t: PageTransform): NormRect {
  return {
    x: (rect[0] / geo.width) * t.sx + t.tx,
    y: (rect[1] / geo.height) * t.sy + t.ty,
    w: (rect[2] / geo.width) * t.sx,
    h: (rect[3] / geo.height) * t.sy,
  };
}

interface Word {
  key: string;
  cx: number;
  cy: number;
}

/** Words of a line with boxes estimated from their share of the characters. */
function lineWords(line: TextLine): Word[] {
  const out: Word[] = [];
  const total = line.text.length || 1;
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line.text))) {
    const key = anchorKey(m[0]);
    if (!key || (key.length < 2 && !isLabelText(m[0]))) continue;
    const x0 = line.x + (line.w * m.index) / total;
    const x1 = line.x + (line.w * (m.index + m[0].length)) / total;
    out.push({ key, cx: (x0 + x1) / 2, cy: line.y + line.h / 2 });
  }
  return out;
}

function templateWords(geo: TemplateGeometry): Word[] {
  return geo.anchors.map(a => ({
    key: a.text,
    cx: (a.rect[0] + a.rect[2] / 2) / geo.width,
    cy: (a.rect[1] + a.rect[3] / 2) / geo.height,
  }));
}

/** Share of the template's printed words also read on the page (no positions). */
export function wordOverlap(lines: TextLine[], geo: TemplateGeometry): number {
  const page = new Set(lines.flatMap(lineWords).map(w => w.key));
  const keys = new Set(geo.anchors.map(a => a.text));
  if (!keys.size) return 0;
  let hit = 0;
  for (const k of keys) if (page.has(k)) hit += 1;
  return hit / keys.size;
}

/**
 * Fit scale and offset (per axis) that carries the template's printed words
 * onto the words read from the page. Pairs of words printed once on the
 * template propose a fit; the fit that lands most words wins, then is refined
 * by least squares on those words.
 */
export function alignToTemplate(
  lines: TextLine[],
  geo: TemplateGeometry,
  tolerance = 0.012
): Alignment | null {
  const page = lines.flatMap(lineWords);
  const tpl = templateWords(geo);
  if (!page.length || !tpl.length) return null;
  const byKey = new Map<string, Word[]>();
  for (const w of tpl) byKey.set(w.key, [...(byKey.get(w.key) || []), w]);
  const pageCount = new Map<string, number>();
  for (const w of page) pageCount.set(w.key, (pageCount.get(w.key) || 0) + 1);

  const pairs: Array<{ p: Word; t: Word; strong: boolean }> = [];
  for (const p of page) {
    const options = byKey.get(p.key) || [];
    for (const t of options)
      pairs.push({ p, t, strong: options.length === 1 && pageCount.get(p.key) === 1 });
  }
  if (pairs.length < 2) return null;
  let seeds = pairs.filter(e => e.strong);
  if (seeds.length < 4) seeds = pairs.slice(0, 120);

  const fitFrom = (inliers: typeof pairs) => {
    const axis = (get: (w: Word) => number) => {
      const n = inliers.length;
      const xs = inliers.map(e => get(e.t));
      const ys = inliers.map(e => get(e.p));
      const mx = xs.reduce((a, b) => a + b, 0) / n;
      const my = ys.reduce((a, b) => a + b, 0) / n;
      let num = 0;
      let den = 0;
      for (let i = 0; i < n; i += 1) {
        num += (xs[i] - mx) * (ys[i] - my);
        den += (xs[i] - mx) ** 2;
      }
      const s = den > 1e-6 ? num / den : 1;
      return { s, t: my - s * mx };
    };
    const x = axis(w => w.cx);
    const y = axis(w => w.cy);
    return { sx: x.s, tx: x.t, sy: y.s, ty: y.t };
  };
  const inliersOf = (f: PageTransform) => {
    const used = new Set<Word>();
    const out: typeof pairs = [];
    for (const e of pairs) {
      if (used.has(e.p)) continue;
      const dx = e.t.cx * f.sx + f.tx - e.p.cx;
      const dy = e.t.cy * f.sy + f.ty - e.p.cy;
      if (Math.abs(dx) <= tolerance && Math.abs(dy) <= tolerance) {
        used.add(e.p);
        out.push(e);
      }
    }
    return out;
  };
  const plausible = (f: PageTransform) =>
    f.sx > 0.6 && f.sx < 1.6 && f.sy > 0.6 && f.sy < 1.6 && Math.abs(f.sx / f.sy - 1) < 0.25;

  let best: { f: PageTransform; inliers: typeof pairs } | null = null;
  const consider = (f: PageTransform) => {
    if (!plausible(f)) return;
    const inliers = inliersOf(f);
    if (!best || inliers.length > best.inliers.length) best = { f, inliers };
  };
  consider(IDENTITY_TRANSFORM);
  for (let i = 0; i < seeds.length; i += 1) {
    for (let j = i + 1; j < seeds.length; j += 1) {
      const a = seeds[i];
      const b = seeds[j];
      const dtx = b.t.cx - a.t.cx;
      const dty = b.t.cy - a.t.cy;
      if (Math.abs(dtx) < 0.08 || Math.abs(dty) < 0.08) continue;
      const sx = (b.p.cx - a.p.cx) / dtx;
      const sy = (b.p.cy - a.p.cy) / dty;
      consider({ sx, sy, tx: a.p.cx - sx * a.t.cx, ty: a.p.cy - sy * a.t.cy });
    }
  }
  const found = best as { f: PageTransform; inliers: typeof pairs } | null;
  if (!found || found.inliers.length < 3) return null;
  let f = found.inliers.length >= 4 ? fitFrom(found.inliers) : found.f;
  if (!plausible(f)) f = found.f;
  const inliers = inliersOf(f).length;
  // Balance both ways: the template's words found (a form with extra print is not this
  // page) and the page's words explained (handwriting is not, but counts equally for all).
  const recall = inliers / tpl.length;
  const precision = inliers / page.length;
  return {
    ...f,
    inliers,
    score: recall + precision > 0 ? (2 * recall * precision) / (recall + precision) : 0,
  };
}

const hasDigit = (s: string) => /\d/.test(s);
/** A complete measurement with a decimal part, as written below a crossed-out box. */
const WRITTEN_VALUE = /^\d{1,3}[.,]\d{1,2}$/;

/** Parse a box's text; "0.00" is a real zero. */
function parseBox(text: string): CustomerValue {
  if (/^0+(?:[.,]0+)?$/.test(text.replace(/\s+/g, '')))
    return { kind: 'single', values: [0], unit: null, note: '', text };
  return parseCustomerValue(text);
}

/** Text an OCR or a customer left in a box, tidied. */
function tidy(text: string): string {
  return text
    .replace(/[|[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Checks on a value read from a box. */
export function reviewReasons(text: string, value: CustomerValue | null): string[] {
  const reasons: string[] = [];
  // "31.00025": a figure written over another; the reading is a guess.
  if (/\d[.,]\d{4,}/.test(text) || /\d{4,}[.,]\d/.test(text))
    reasons.push('Looks corrected by hand, check the number');
  if (text.includes('*')) reasons.push('Marked with *, see the customer note');
  if (value && value.kind !== 'none' && /[A-Za-z]{3,}/.test(value.note || ''))
    reasons.push(`Extra words beside the number: "${value.note}"`);
  return reasons;
}

/** Lines whose centre falls in a rect (padded by a share of its height). */
function inside(line: TextLine, r: NormRect, pad = 0.2): boolean {
  const cx = line.x + line.w / 2;
  const cy = line.y + line.h / 2;
  const py = r.h * pad;
  return cx >= r.x - py && cx <= r.x + r.w + py && cy >= r.y - py && cy <= r.y + r.h + py;
}

/**
 * Pair letters and values on a page. With a template layout every box is
 * read where the template has it; without one, a value is the nearest number
 * to the right of a printed letter on the same row.
 */
export function pairLettersAndValues(lines: TextLine[], page: PageGeometry = {}): PairedValue[] {
  const geo = page.geometry;
  if (geo && geo.cells.length)
    return pairByTemplate(lines, geo, page.transform || IDENTITY_TRANSFORM);
  return pairByRows(lines);
}

function pairByTemplate(
  lines: TextLine[],
  geo: TemplateGeometry,
  transform: PageTransform
): PairedValue[] {
  const cells = geo.cells.map(cell => ({ cell, rect: templateRect(cell.rect, geo, transform) }));
  // The form's own print (turned headings such as "SEAT CUSHIONS" report odd boxes) is not a value.
  const printed = new Set(geo.anchors.map(a => a.text));
  const isPrinted = (line: TextLine) => {
    if (hasDigit(line.text)) return false;
    const keys = line.text.split(/\s+/).map(anchorKey).filter(Boolean);
    return keys.length > 0 && keys.every(k => printed.has(k));
  };
  lines = lines.filter(line => !isPrinted(line));
  const taken = new Set<TextLine>();
  const contents = cells.map(({ rect }) => {
    const mine = lines.filter(l => !taken.has(l) && inside(l, rect));
    mine.forEach(l => taken.add(l));
    return mine;
  });

  // A number written just under a bottom box whose own text has no digits (a crossed-out value).
  const rest = lines.filter(l => !taken.has(l) && hasDigit(l.text));
  const below = new Map<number, TextLine>();
  for (const line of rest) {
    const cx = line.x + line.w / 2;
    const top = line.y;
    let bestIndex = -1;
    let bestGap = Infinity;
    cells.forEach(({ rect }, i) => {
      if (cx < rect.x || cx > rect.x + rect.w) return;
      const gap = top - (rect.y + rect.h * 0.6);
      if (gap < -rect.h * 0.1 || gap > rect.h * 1.2) return;
      const lower = cells.some(
        (o, j) =>
          j !== i &&
          Math.abs(o.rect.x - rect.x) < rect.w * 0.3 &&
          o.rect.y > rect.y + rect.h * 0.5 &&
          o.rect.y < rect.y + rect.h * 1.8
      );
      if (lower) return;
      if (gap < bestGap) {
        bestGap = gap;
        bestIndex = i;
      }
    });
    // The box's own text: none, no digits, or a scribble that is not a measurement.
    const own = tidy(bestIndex >= 0 ? contents[bestIndex].map(l => l.text).join(' ') : '');
    const ownIsValue = /^\d{1,3}[.,]\d{1,2}$/.test(own.replace(/\s+/g, ''));
    if (bestIndex >= 0 && !ownIsValue && WRITTEN_VALUE.test(tidy(line.text).replace(/\s+/g, '')))
      below.set(bestIndex, line);
  }

  const out: PairedValue[] = [];
  cells.forEach(({ cell, rect }, i) => {
    const under = below.get(i);
    const own = contents[i].slice().sort((a, b) => a.y - b.y || a.x - b.x);
    const source = under ? [under] : own;
    const text = tidy(source.map(l => l.text).join(' '));
    if (!text) return;
    const parsed = parseBox(text);
    const value = parsed.kind === 'none' ? null : parsed;
    const review = reviewReasons(text, value);
    if (under) review.unshift('Written below the box (the box was crossed out)');
    const confidence = Math.min(...source.map(l => l.confidence));
    out.push({
      label: cell.label,
      ...(cell.section ? { section: cell.section } : {}),
      text: value ? parsed.text : text,
      value,
      confidence,
      review,
      rect,
      ...(source[0]?.thumb ? { thumb: source[0].thumb } : {}),
    });
  });

  // A cushion table with no quantity and a single mark is a stray (a sketch drawn across it).
  const bySection = new Map<string, PairedValue[]>();
  for (const v of out)
    if (v.section) bySection.set(v.section, [...(bySection.get(v.section) || []), v]);
  for (const [section, values] of bySection) {
    const hasQtyCell = geo.cells.some(c => c.section === section && c.label === 'Qty');
    if (!hasQtyCell) continue;
    const qty = values.find(v => v.label === 'Qty' && v.value);
    if (!qty && values.length <= 1) {
      for (const v of values) {
        v.value = null;
        v.stray = true;
        v.review.push('Lone mark in an empty cushion table, probably part of a sketch');
      }
    }
  }
  return out;
}

const isNumberish = (s: string) => hasDigit(s) || /^n\/?a$/i.test(s.trim());

/** No template: the nearest number to the right of each printed letter on its row. */
function pairByRows(lines: TextLine[]): PairedValue[] {
  interface Token {
    text: string;
    x0: number;
    x1: number;
    cy: number;
    h: number;
    line: TextLine;
  }
  const tokens: Token[] = [];
  for (const line of lines) {
    const total = line.text.length || 1;
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line.text))) {
      tokens.push({
        text: m[0],
        x0: line.x + (line.w * m.index) / total,
        x1: line.x + (line.w * (m.index + m[0].length)) / total,
        cy: line.y + line.h / 2,
        h: line.h,
        line,
      });
    }
  }
  const letters = tokens.filter(
    t => isLabelText(anchorKey(t.text)) && anchorKey(t.text) === t.text.replace(/[^A-Za-z0-9]/g, '')
  );
  const out: PairedValue[] = [];
  const used = new Set<Token>();
  for (const letter of letters) {
    const sameRow = (t: Token) => Math.abs(t.cy - letter.cy) < Math.max(t.h, letter.h) * 0.6;
    const nextLetter = letters
      .filter(o => o !== letter && sameRow(o) && o.x0 > letter.x1)
      .sort((a, b) => a.x0 - b.x0)[0];
    const limit = Math.min(nextLetter ? nextLetter.x0 : Infinity, letter.x1 + 0.15);
    const value = tokens
      .filter(t => !used.has(t) && t !== letter && sameRow(t) && t.x0 >= letter.x1 - 0.002)
      .filter(t => t.x0 < limit && isNumberish(t.text))
      .sort((a, b) => a.x0 - b.x0)[0];
    if (!value) continue;
    used.add(value);
    const text = tidy(value.text);
    const parsed = parseBox(text);
    const v = parsed.kind === 'none' ? null : parsed;
    out.push({
      label: anchorKey(letter.text),
      text: v ? parsed.text : text,
      value: v,
      confidence: value.line.confidence,
      review: reviewReasons(text, v),
      rect: { x: value.x0, y: value.cy - value.h / 2, w: value.x1 - value.x0, h: value.h },
    });
  }
  return out;
}

/** pdf.js text items (page points, top-left) as normalised lines. */
export function linesFromTexts(
  texts: Array<{ str: string; rect: { x0: number; y0: number; x1: number; y1: number } }>,
  width: number,
  height: number
): TextLine[] {
  return texts.map(t => ({
    x: t.rect.x0 / width,
    y: t.rect.y0 / height,
    w: (t.rect.x1 - t.rect.x0) / width,
    h: (t.rect.y1 - t.rect.y0) / height,
    text: t.str,
    confidence: 1,
  }));
}

/** Apple Vision style lines: "x y w h confidence | text". */
export function parseVisionLines(raw: string): TextLine[] {
  return raw
    .split('\n')
    .map(line => /^([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) \| (.*)$/.exec(line.trim()))
    .filter((m): m is RegExpExecArray => Boolean(m))
    .map(m => ({
      x: +m[1],
      y: +m[2],
      w: +m[3],
      h: +m[4],
      confidence: +m[5],
      text: m[6],
    }));
}
