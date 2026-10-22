/**
 * Reads a PDF a customer sent back: which CW template it is, and every value
 * they wrote, per page. Pure apart from pdf.js (and the OCR engine passed in
 * for scans), so it runs in Node tests.
 *
 * Three kinds of page:
 *   - fillable form: values from the form fields, labelled by their row;
 *   - flattened (text but no fields): the page text is lined up with the
 *     template and each box beside a printed letter is read;
 *   - scanned (no text): OCR, then the same box reading as flattened pages.
 * Words without a number ("n/a", "see photo", "same as A1") are kept with
 * `value: null` so they can be shown, not lost.
 */
import { parseCustomerValue, type CustomerValue } from '../utils/customer-value';
import {
  analyzeCwFormPage,
  detectDocumentUnit,
  detectUnit,
  detectWidgetUnit,
  extractCwPageData,
  findRowLabel,
  type CwPageData,
  type PdfPageLike,
} from './parse-cw-form';
import { fingerprintPage, type PdfTemplateKind } from './pdf-fingerprint';
import {
  attachCushionPages,
  matchPdfDocument,
  type PdfTemplate,
  type PdfTemplateMatch,
} from './pdf-template-match';
import {
  alignToTemplate,
  IDENTITY_TRANSFORM,
  linesFromTexts,
  pairLettersAndValues,
  type PairedValue,
} from './pair-letters';
import type { GrayImage } from './scan-image';
import { readScannedPage, type OcrEngine, type ScannedPage } from './scan-reader';
import { loadTemplateGeometries, type TemplateGeometryIndex } from './template-geometry';

/** Flag on every value read by OCR. */
export const OCR_REVIEW = 'Read by OCR, check it';
/** OCR values read at least this surely are not flagged for checking. */
export const OCR_CONFIDENT = 0.8;

export const SOFAPAINT_REVIEW_PREFIX = 'SOFAPAINT_REVIEW_V1:';

export interface CustomerPdfValue {
  label: string;
  /** Parsed number(s) (single or range), or null when the customer wrote only words. */
  value: CustomerValue | null;
  text: string;
  field?: string;
  /**
   * 'row': form field read beside its printed letter; 'template': letter from the
   * matched template; 'text': flattened page text in the template's box; 'ocr': a scan.
   */
  from: 'row' | 'template' | 'text' | 'ocr';
  /** Cushion tables: "Box seat cushions, type 1". */
  section?: string;
  /** Reasons a person should check this value (OCR below OCR_CONFIDENT included). */
  review?: string[];
  /** Picture of the box the value was read from (scans), for the review strip. */
  thumb?: string;
  /** 0..1, OCR only. */
  confidence?: number;
}

export interface CustomerPdfPage {
  pageNumber: number;
  template: PdfTemplate | null;
  confidence: number;
  values: CustomerPdfValue[];
  unit: 'cm' | 'inch';
  unitAssumed: boolean;
  /**
   * Where the unit came from: 'ticked' a ticked box (form field, or the dot drawn
   * in a flattened copy), 'printed' printed words, 'typed' unit marks on the values
   * ("x" over a box, 71"), 'ocr' the tick read on a scan, 'assumed' nothing found.
   */
  unitSource: 'ticked' | 'printed' | 'typed' | 'ocr' | 'assumed';
  /** How the values were read. */
  read: 'fields' | 'text' | 'ocr' | 'no-ocr';
  /** Marks that are not values (a sketch across an empty table), for a note. */
  notes?: string[];
}

export interface CustomerPdfResult {
  kind: PdfTemplateKind | 'sofapaint-review';
  fileName: string;
  /** Library file the PDF was printed from, and the CW model codes it covers. */
  source: string | null;
  modelCodes: string[];
  confidence: number;
  pages: CustomerPdfPage[];
}

export interface PdfDocumentLike {
  numPages: number;
  getPage(n: number): Promise<PdfPageLike>;
  getMetadata?(): Promise<any>;
}

/** OCR for scanned pages: how to draw a page as a grey image, and the engine. */
export interface ScanOcrOptions {
  render(page: PdfPageLike): Promise<GrayImage>;
  engine: OcrEngine;
  /** Progress for the panel ("Reading page 2 of 7"). */
  onPage?(pageNumber: number, total: number): void;
}

export interface ReadCustomerPdfOptions {
  /** Without it, scanned pages come back empty with read: 'no-ocr'. */
  ocr?: ScanOcrOptions | null;
  geometry?: TemplateGeometryIndex;
}

/** A page with no text of its own is a scan (or a photo). */
export function isScannedPage(data: CwPageData): boolean {
  const texts = (data.allTexts || data.texts).filter(t => t.str.trim());
  return !(data.widgets || []).length && texts.length < 3;
}

/** Flattened copy of a form: printed text, no fields. */
export function isFlattenedPage(data: CwPageData): boolean {
  return !(data.widgets || []).length && !isScannedPage(data);
}

/**
 * The CM / INCH choice on a flattened copy: the radio dot is drawn as a small
 * dark shape (or an "x" / tick typed) just right of its caption.
 */
export function detectFlattenedUnit(data: CwPageData): 'cm' | 'inch' | null {
  const texts = data.allTexts || data.texts;
  const captions = texts.flatMap(t => {
    const m = /(?:^|[\s:])(cm|inch|inches)\s*$/i.exec(t.str.trim());
    if (!m) return [];
    const width = t.rect.x1 - t.rect.x0;
    const share = m[1].length / Math.max(1, t.str.trim().length);
    return [
      {
        unit: /^c/i.test(m[1]) ? ('cm' as const) : ('inch' as const),
        x0: t.rect.x1 - width * share,
        x1: t.rect.x1,
        cy: (t.rect.y0 + t.rect.y1) / 2,
      },
    ];
  });
  if (!captions.length) return null;
  const dark = (hex: string) => {
    const m = /^#(..)(..)(..)$/.exec(hex);
    return Boolean(m) && [1, 2, 3].every(i => parseInt(m![i], 16) < 90);
  };
  const marks = [
    ...(data.fills || [])
      .filter(f => dark(f.color))
      .filter(f => {
        const w = f.bbox.x1 - f.bbox.x0;
        const h = f.bbox.y1 - f.bbox.y0;
        return w >= 2 && w <= 14 && h >= 2 && h <= 14;
      })
      .map(f => f.bbox),
    ...texts
      .filter(t => /^[xX\u2713\u2714\u221A\u25CF\u2715\u2716]$/.test(t.str.trim()))
      .map(t => t.rect),
  ];
  const units = new Set<'cm' | 'inch'>();
  for (const mark of marks) {
    const cx = (mark.x0 + mark.x1) / 2;
    const cy = (mark.y0 + mark.y1) / 2;
    const caption = captions
      .filter(c => Math.abs(c.cy - cy) < 9 && cx > c.x1 - 1 && cx - c.x1 < 26)
      .sort((a, b) => cx - a.x1 - (cx - b.x1))[0];
    if (caption) units.add(caption.unit);
  }
  return units.size === 1 ? [...units][0] : null;
}

function toCustomerValues(
  paired: PairedValue[],
  from: 'text' | 'ocr'
): {
  values: CustomerPdfValue[];
  notes: string[];
} {
  const values: CustomerPdfValue[] = [];
  const notes: string[] = [];
  for (const v of paired) {
    const where = v.section ? `${v.section}, ${v.label}` : v.label;
    if (v.stray) {
      notes.push(`${where}: "${v.text}" (${v.review[v.review.length - 1]})`);
      continue;
    }
    const unsure = from === 'ocr' && !(v.confidence >= OCR_CONFIDENT);
    const review = unsure ? [OCR_REVIEW, ...v.review] : v.review;
    values.push({
      label: v.label,
      value: v.value,
      text: v.text,
      from,
      ...(v.section ? { section: v.section } : {}),
      ...(review.length ? { review } : {}),
      ...(v.thumb ? { thumb: v.thumb } : {}),
      ...(from === 'ocr' ? { confidence: v.confidence } : {}),
    });
  }
  return { values, notes };
}

/** SofaPaint check-request sheets carry their payload in the PDF subject. */
export function isSofaPaintReview(subject: unknown, pages: CwPageData[] = []): boolean {
  if (typeof subject === 'string' && subject.startsWith(SOFAPAINT_REVIEW_PREFIX)) return true;
  return pages.some(
    p =>
      (p.allTexts || p.texts).some(t => /generated by (openpaint|sofapaint)/i.test(t.str)) &&
      (p.widgets || []).some(w => /^m_[^_]+_[A-Z]\d{0,2}$/.test(w.name))
  );
}

function pageValues(
  data: CwPageData,
  template: PdfTemplate | null,
  documentUnit: ReturnType<typeof detectDocumentUnit>
) {
  const values: CustomerPdfValue[] = [];
  const used = new Set<string>();
  const views = analyzeCwFormPage(data, documentUnit);
  for (const view of views) {
    for (const m of [...view.measurements, ...view.unplaced]) {
      const parsed = parseCustomerValue(m.text ?? String(m.value));
      values.push({
        label: m.label,
        value: parsed,
        text: parsed.text,
        field: m.field,
        from: 'row',
      });
      if (m.field) used.add(m.field);
    }
  }
  for (const field of data.fields) {
    if (used.has(field.name)) continue;
    const parsed = parseCustomerValue(field.value);
    const row = findRowLabel(field, data.texts);
    const fromTemplate = template?.fieldMap[field.name];
    const label = row || fromTemplate;
    if (!label || !parsed.text) continue;
    values.push({
      label,
      value: parsed.kind === 'none' ? null : parsed,
      text: parsed.text,
      field: field.name,
      from: row ? 'row' : 'template',
    });
  }
  return { values, views };
}

export async function readCustomerPdfDocument(
  doc: PdfDocumentLike,
  OPS: Record<string, number>,
  fileName = 'customer.pdf',
  templates?: readonly PdfTemplate[],
  options: ReadCustomerPdfOptions = {}
): Promise<CustomerPdfResult> {
  const meta = await doc.getMetadata?.().catch(() => null);
  const pages: CwPageData[] = [];
  const pdfPages: PdfPageLike[] = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    pdfPages.push(page);
    pages.push(await extractCwPageData(page, OPS));
  }

  if (isSofaPaintReview(meta?.info?.Subject, pages)) {
    return {
      kind: 'sofapaint-review',
      fileName,
      source: null,
      modelCodes: [],
      confidence: 1,
      pages: [],
    };
  }
  const library = templates || (await import('../ui/pdf-template-registry')).PDF_TEMPLATES;
  const scanned = pages.map(isScannedPage);
  // Pages with print are identified by their fingerprint; scans by OCR further down.
  const printedIndexes = pages.map((_, i) => i).filter(i => !scanned[i]);
  const fingerprints = printedIndexes.map(i => fingerprintPage(pages[i], { fileName }));
  const match = matchPdfDocument(fingerprints, library);
  const pageMatches: Array<PdfTemplateMatch | null> = pages.map(() => null);
  printedIndexes.forEach((pageIndex, k) => (pageMatches[pageIndex] = match.pages[k]));
  const documentUnit = detectDocumentUnit(pages);
  const needsGeometry = pages.some((data, i) => scanned[i] || isFlattenedPage(data));
  const geometry = options.geometry || (needsGeometry ? await loadTemplateGeometries() : undefined);

  // Flattened pages: read the boxes from the page text.
  const flattened = new Map<number, { values: CustomerPdfValue[]; notes: string[] }>();
  pages.forEach((data, i) => {
    if (scanned[i] || !isFlattenedPage(data)) return;
    const template = pageMatches[i]?.template;
    const geo = template && geometry ? geometry.shapes[geometry.byTemplate[template.id]] : null;
    const lines = linesFromTexts(data.allTexts || data.texts, data.width, data.height);
    const alignment = geo ? alignToTemplate(lines, geo) : null;
    const transform = alignment && alignment.score > 0.5 ? alignment : IDENTITY_TRANSFORM;
    flattened.set(
      i,
      toCustomerValues(pairLettersAndValues(lines, { geometry: geo, transform }), 'text')
    );
  });

  // Scanned pages: OCR.
  const scans = new Map<number, ScannedPage>();
  let ocrError = '';
  if (options.ocr && geometry) {
    const total = scanned.filter(Boolean).length;
    for (let i = 0; i < pages.length && !ocrError; i += 1) {
      if (!scanned[i]) continue;
      options.ocr.onPage?.(pages[i].pageNumber, total);
      try {
        const image = await options.ocr.render(pdfPages[i]);
        scans.set(i, await readScannedPage(image, options.ocr.engine, geometry));
      } catch (error) {
        // Stop at the first failure (OCR files missing, worker blocked): later pages would fail too.
        ocrError = String((error as Error)?.message || error);
      }
    }
  }
  const scanTemplates = pickScanTemplates(scans, library, geometry, match.source);

  const ticked = pages.map((data, i) =>
    scans.has(i)
      ? null
      : detectWidgetUnit(data) || (isFlattenedPage(data) ? detectFlattenedUnit(data) : null)
  );
  const anyTicked = ticked.find(Boolean) || null;
  const anyOcrUnit = [...scans.values()].map(s => s.unit).find(Boolean) || null;

  const readPages: CustomerPdfPage[] = pages.map((data, i) => {
    const scan = scans.get(i);
    const scanPick = scanTemplates.get(i);
    const pageMatch = pageMatches[i];
    const template = scan ? scanPick?.template || null : pageMatch?.template || null;
    let values: CustomerPdfValue[];
    let notes: string[] = [];
    let read: CustomerPdfPage['read'];
    if (scanned[i]) {
      read = scan ? 'ocr' : 'no-ocr';
      ({ values, notes } = scan ? toCustomerValues(scan.values, 'ocr') : { values: [], notes: [] });
      if (!scan && ocrError) notes = [`OCR failed: ${ocrError}`];
    } else if (flattened.has(i)) {
      read = 'text';
      ({ values, notes } = flattened.get(i)!);
    } else {
      read = 'fields';
      values = pageValues(data, template, documentUnit).values;
    }
    // Ticked box on this page, then on any page, then printed words, then typed marks.
    const printed = detectUnit(data.texts);
    const printedAnywhere = pages.some(p => !detectUnit(p.texts).assumed);
    let unit: 'cm' | 'inch';
    let unitSource: CustomerPdfPage['unitSource'];
    if (scan?.unit) [unit, unitSource] = [scan.unit, 'ocr'];
    else if (ticked[i]) [unit, unitSource] = [ticked[i]!, 'ticked'];
    else if (scan && anyOcrUnit && !anyTicked) [unit, unitSource] = [anyOcrUnit, 'ocr'];
    else if (anyTicked) [unit, unitSource] = [anyTicked, 'ticked'];
    else if (anyOcrUnit) [unit, unitSource] = [anyOcrUnit, 'ocr'];
    else if (!printed.assumed) [unit, unitSource] = [printed.unit, 'printed'];
    else if (!documentUnit.assumed)
      [unit, unitSource] = [documentUnit.unit, printedAnywhere ? 'printed' : 'typed'];
    else [unit, unitSource] = ['cm', 'assumed'];
    const unitAssumed = unitSource === 'assumed';
    return {
      pageNumber: data.pageNumber,
      template,
      confidence: scan ? scanPick?.confidence || 0 : pageMatch?.confidence || 0,
      values,
      unit,
      unitAssumed,
      unitSource,
      read,
      ...(notes.length ? { notes } : {}),
    };
  });

  // A shared cushion page takes the form of the frame page before it.
  const out = attachCushionPages(readPages, library);

  const usedTemplates = out.map(p => p.template).filter(Boolean) as PdfTemplate[];
  const first = usedTemplates[0];
  const scanOnly = !printedIndexes.length;
  const scanCodes = [...scanTemplates.keys()]
    .map(i => out[i].template)
    .filter((t): t is PdfTemplate => Boolean(t))
    .sort((a, b) => Number(b.view !== 'cushion') - Number(a.view !== 'cushion'))
    .flatMap(t => t.modelCodes);
  const scanConfidences = [...scanTemplates.values()].map(p => p.confidence);
  return {
    kind: first?.kind || 'other',
    fileName,
    source: scanOnly ? [...scanTemplates.values()][0]?.template.source || null : match.source,
    modelCodes: scanOnly ? [...new Set(scanCodes)] : match.modelCodes,
    confidence: scanOnly
      ? scanConfidences.length
        ? Math.min(...scanConfidences)
        : 0
      : match.confidence,
    pages: out,
  };
}

/**
 * The library page each scan is: among templates with the layout that lined
 * up best, the file most of the document's pages share (forms published
 * under several codes share one layout). Confidence follows how well the
 * printed words lined up and drops when a different layout did as well.
 */
function pickScanTemplates(
  scans: Map<number, ScannedPage>,
  library: readonly PdfTemplate[],
  geometry: TemplateGeometryIndex | undefined,
  printedSource: string | null
): Map<number, { template: PdfTemplate; confidence: number }> {
  const out = new Map<number, { template: PdfTemplate; confidence: number }>();
  if (!geometry || !scans.size) return out;
  const byKey = new Map<string, PdfTemplate[]>();
  for (const t of library) {
    const key = geometry.byTemplate[t.id];
    if (key) byKey.set(key, [...(byKey.get(key) || []), t]);
  }
  const options = new Map<number, PdfTemplate[]>();
  const votes = new Map<string, number>();
  for (const [i, scan] of scans) {
    const best = scan.candidates[0];
    if (!best) continue;
    const near = scan.candidates.filter(c => best.alignment.score - c.alignment.score < 0.02);
    const pool = near.flatMap(c => byKey.get(c.key) || []);
    options.set(i, pool);
    for (const source of new Set(pool.map(t => t.source)))
      votes.set(source, (votes.get(source) || 0) + 1);
  }
  if (printedSource) votes.set(printedSource, (votes.get(printedSource) || 0) + 100);
  const letters = (key: string) =>
    [...new Set(geometry.shapes[key].cells.map(c => `${c.section || ''}${c.label}`))]
      .sort()
      .join(',');
  for (const [i, pool] of options) {
    const scan = scans.get(i)!;
    const template = pool
      .slice()
      .sort(
        (a, b) =>
          (votes.get(b.source) || 0) - (votes.get(a.source) || 0) ||
          Number(/archive/i.test(a.source)) - Number(/archive/i.test(b.source)) ||
          a.source.length - b.source.length
      )[0];
    if (!template) continue;
    const best = scan.candidates[0];
    const rival = scan.candidates.find(c => letters(c.key) !== letters(best.key));
    let confidence = Math.min(0.95, 0.6 + best.alignment.score * 0.7);
    if (rival)
      confidence = Math.min(
        confidence,
        0.75 + (best.alignment.score - rival.alignment.score) * 2.5
      );
    out.set(i, { template, confidence: Math.max(0, Math.round(confidence * 1000) / 1000) });
  }
  return out;
}
