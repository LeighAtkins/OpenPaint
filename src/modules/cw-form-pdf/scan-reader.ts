/**
 * Reads a scanned (image-only) page of a CW form:
 *
 *   1. OCR the whole page at low resolution for the printed words,
 *   2. find the template whose printed words line up best (scale and offset),
 *   3. OCR each value box of that template on the aligned page, digits only,
 *   4. read the CM / INCH tick by ink inside the two circles.
 *
 * The boxes then go through the same pairing as flattened text
 * (pairLettersAndValues), so both paths read letters the same way.
 */
import {
  alignToTemplate,
  pairLettersAndValues,
  templateRect,
  wordOverlap,
  type Alignment,
  type NormRect,
  type PairedValue,
  type TextLine,
} from './pair-letters';
import { hasInk, readUnitTick, type GrayImage } from './scan-image';
import type { TemplateGeometry, TemplateGeometryIndex } from './template-geometry';

export interface CellRead {
  text: string;
  /** 0..1 */
  confidence: number;
  /** Small picture of the box, for the review strip. */
  thumb?: string;
}

/** OCR backend: Tesseract in a Web Worker in the browser, Tesseract in Node for tests. */
export interface OcrEngine {
  /** Printed words of the whole page, normalised to the page. */
  readWords(image: GrayImage): Promise<TextLine[]>;
  /** Each box read with the digit whitelist; empty boxes come back as ''. */
  readCells(image: GrayImage, rects: NormRect[]): Promise<CellRead[]>;
}

export interface ScanCandidate {
  key: string;
  alignment: Alignment;
}

export interface ScannedPage {
  words: TextLine[];
  /** Layouts that line up, best first. */
  candidates: ScanCandidate[];
  values: PairedValue[];
  unit: 'cm' | 'inch' | null;
}

/** Below this share of printed words in place, the page is not that template. */
export const MIN_ALIGNMENT = 0.25;

/** Layouts whose printed words line up with the page, best first. */
export function identifyScannedPage(
  words: TextLine[],
  index: TemplateGeometryIndex,
  shortlist = 150
): ScanCandidate[] {
  const quick = Object.entries(index.shapes)
    .map(([key, geo]) => ({ key, geo, overlap: wordOverlap(words, geo) }))
    .filter(e => e.overlap > 0.15)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, shortlist);
  return quick
    .map(e => ({ key: e.key, alignment: alignToTemplate(words, e.geo) }))
    .filter((e): e is ScanCandidate => Boolean(e.alignment && e.alignment.score >= MIN_ALIGNMENT))
    .sort(
      (a, b) => b.alignment.score - a.alignment.score || b.alignment.inliers - a.alignment.inliers
    );
}

/** OCR every value box of the template on the aligned page, then pair. */
export async function readScannedValues(
  image: GrayImage,
  engine: OcrEngine,
  geo: TemplateGeometry,
  alignment: Alignment,
  words: TextLine[] = []
): Promise<{ values: PairedValue[]; unit: 'cm' | 'inch' | null }> {
  const rects = geo.cells.map(cell => templateRect(cell.rect, geo, alignment));
  // Bottom boxes of each table also get the strip under them: customers who cross a
  // value out write the new one below the box.
  const bottom = rects
    .map((r, i) => ({ r, i }))
    .filter(
      ({ r, i }) =>
        !rects.some(
          (o, j) =>
            j !== i &&
            Math.abs(o.x - r.x) < r.w * 0.3 &&
            o.y > r.y + r.h * 0.5 &&
            o.y < r.y + r.h * 1.8
        )
    )
    .filter(({ r }) => hasInk(image, { ...r, y: r.y + r.h }));
  const below = bottom.map(({ r }) => ({ ...r, y: r.y + r.h * 0.95 }));
  const reads = await engine.readCells(image, [...rects, ...below]);
  const lines: TextLine[] = [];
  [...rects, ...below].forEach((rect, i) => {
    const read = reads[i];
    if (!read?.text.trim()) return;
    lines.push({
      x: rect.x + rect.w * 0.1,
      y: rect.y + rect.h * 0.1,
      w: rect.w * 0.8,
      h: rect.h * 0.8,
      text: read.text,
      confidence: read.confidence,
      ...(read.thumb ? { thumb: read.thumb } : {}),
    });
  });
  const values = pairLettersAndValues(lines, { geometry: geo, transform: alignment });
  let circles = geo.units.map(u => ({ unit: u.unit, rect: templateRect(u.rect, geo, alignment) }));
  if (circles.length < 2) {
    // No radio widgets on the template: the circle sits just right of its caption.
    circles = (['cm', 'inch'] as const).flatMap(unit => {
      const word = geo.anchors.find(a => a.text === (unit === 'cm' ? 'CM' : 'INCH'));
      if (!word) return [];
      const h = word.rect[3] * 1.3;
      const rect: [number, number, number, number] = [
        word.rect[0] + word.rect[2] + 2,
        word.rect[1] - h * 0.1,
        h,
        h,
      ];
      return [{ unit, rect: templateRect(rect, geo, alignment) }];
    });
  }
  // The circles are small: line them up again on the CM / INCH captions read nearby.
  const shift = localShift(words, geo, alignment, ['CM', 'INCH']);
  circles = circles.map(c => ({
    ...c,
    rect: { ...c.rect, x: c.rect.x + shift.dx, y: c.rect.y + shift.dy },
  }));
  return { values, unit: readUnitTick(image, circles) };
}

/** Mean offset between where the template puts some printed words and where they were read. */
export function localShift(
  words: TextLine[],
  geo: TemplateGeometry,
  alignment: Alignment,
  keys: string[]
): { dx: number; dy: number } {
  const offsets: Array<{ dx: number; dy: number }> = [];
  for (const anchor of geo.anchors.filter(a => keys.includes(a.text))) {
    const at = templateRect(anchor.rect, geo, alignment);
    const cx = at.x + at.w / 2;
    const cy = at.y + at.h / 2;
    const hit = words
      .filter(w => w.text.toUpperCase().replace(/[^A-Z]/g, '') === anchor.text)
      .map(w => ({ dx: w.x + w.w / 2 - cx, dy: w.y + w.h / 2 - cy }))
      .filter(o => Math.abs(o.dx) < 0.03 && Math.abs(o.dy) < 0.02)
      .sort((a, b) => Math.hypot(a.dx, a.dy) - Math.hypot(b.dx, b.dy))[0];
    if (hit) offsets.push(hit);
  }
  if (!offsets.length) return { dx: 0, dy: 0 };
  return {
    dx: offsets.reduce((t, o) => t + o.dx, 0) / offsets.length,
    dy: offsets.reduce((t, o) => t + o.dy, 0) / offsets.length,
  };
}

/** Whole pipeline for one page image. */
export async function readScannedPage(
  image: GrayImage,
  engine: OcrEngine,
  index: TemplateGeometryIndex
): Promise<ScannedPage> {
  const words = await engine.readWords(image);
  const candidates = identifyScannedPage(words, index);
  const best = candidates[0];
  if (!best) {
    return { words, candidates, values: pairLettersAndValues(words), unit: null };
  }
  const { values, unit } = await readScannedValues(
    image,
    engine,
    index.shapes[best.key],
    best.alignment,
    words
  );
  return { words, candidates, values, unit };
}
