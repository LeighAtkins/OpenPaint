/**
 * The customer's own measuring PDF, converted to centimetres for the SZ
 * production email.
 *
 * Every form field that carried a value in inches gets the cm value (one
 * decimal) written into the same field, and the unit radio or checkbox is set
 * to CM where the template has one. When the values were typed over the form
 * as page text (a printed or flattened form), the cm value is drawn in a small
 * box beside the original text instead. A footer line on every page says what
 * was done; nothing else on the page changes. A PDF already in cm passes
 * through with the footer only.
 *
 * pdf-lib does the writing. Reading page text (for typed-over values and for
 * which radio button is CM) needs pdf.js; `scanPdfText` takes the pdf.js module
 * so the browser and the tests can each pass their own build.
 */
import {
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFRadioGroup,
  PDFRef,
  PDFTextField,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib';
import { parseCustomerValue } from '../utils/customer-value';

export type PdfUnit = 'cm' | 'inch';

const REVIEW_PREFIX = 'SOFAPAINT_REVIEW_V1:';
const LABEL_PATTERN = /^[A-Z]\d{0,2}\*?$/;
const LEADING =
  /^((?:approx(?:imately)?\.?|appr\.?|about|roughly|around|circa|ca\.?|est\.?|~|≈)\s*)+/i;

/** A rectangle in PDF user space (origin bottom left). */
export interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A value drawn as page text inside an empty form field. */
export interface PrintedValue {
  pageIndex: number;
  fieldName: string;
  field: PdfRect;
  /** The printed text's own extent. */
  text: PdfRect;
  value: string;
  label?: string;
}

export interface PdfTextScan {
  printed: PrintedValue[];
  /** Text fields with a measurement letter printed to their left (A1, F*, ...). */
  labelled: Record<string, string>;
  /** Printed "CM" / "INCH" words, to tell which radio button is which. */
  unitWords: Array<{ pageIndex: number; rect: PdfRect; unit: PdfUnit }>;
  /** A printed X or tick, as customers mark the unit on a flattened form. */
  marks: Array<{ pageIndex: number; rect: PdfRect }>;
}

export interface CmConversion {
  where: 'field' | 'printed';
  pageIndex: number;
  name: string;
  label?: string;
  from: string;
  to: string;
}

export interface CmConvertResult {
  bytes: Uint8Array;
  kind: 'sofapaint-review' | 'cw-form';
  converted: CmConversion[];
  /** True when nothing was in inches: the PDF passed through with the footer only. */
  alreadyCm: boolean;
  /** Unit radios or checkboxes set to CM. */
  unitControls: number;
}

export interface CmConvertOptions {
  orderNumber: string;
  date?: Date;
  /** The unit the reader settled on, used when neither the value nor the page says. */
  unit?: PdfUnit;
  scan?: PdfTextScan | null;
}

// ---------------------------------------------------------------- numbers
/** One decimal, half up, without float drift (2.5 in is 6.35 cm, shown 6.4). */
export function cmText(inches: number): string {
  const cm = inches * 2.54;
  return (Math.round(cm * 10 + 1e-7) / 10).toFixed(1);
}

/**
 * The customer's text with every number in cm: "approx 24.5 - 25"" becomes
 * "approx 62.2 - 63.5", "7" see photos" becomes "17.8 see photos". Null when
 * the text holds no number.
 */
export function convertValueText(raw: string): string | null {
  const parsed = parseCustomerValue(raw);
  if (parsed.kind === 'none') return null;
  const lead = LEADING.exec(parsed.text)?.[0] || '';
  const numbers = parsed.values.map(cmText).join(' - ');
  return `${lead}${numbers}${parsed.note ? ` ${parsed.note}` : ''}`;
}

const unitOfText = (raw: string): PdfUnit | null => {
  const unit = parseCustomerValue(raw).unit;
  return unit === 'in' ? 'inch' : unit === 'cm' ? 'cm' : null;
};

// ---------------------------------------------------------------- pdf.js scan
const contains = (r: PdfRect, x: number, y: number, pad = 0): boolean =>
  x >= r.x - pad && x <= r.x + r.width + pad && y >= r.y - pad && y <= r.y + r.height + pad;
const fromPdfRect = (rect: number[]): PdfRect => {
  const [x0, y0, x1, y1] = rect;
  return {
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    width: Math.abs(x1 - x0),
    height: Math.abs(y1 - y0),
  };
};

/** Read printed values, row letters and unit words with pdf.js (`pdfjs` is the loaded module). */
export async function scanPdfText(bytes: Uint8Array, pdfjs: any): Promise<PdfTextScan> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  const scan: PdfTextScan = { printed: [], labelled: {}, unitWords: [], marks: [] };
  try {
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const pageIndex = n - 1;
      const annotations = await page.getAnnotations();
      const content = await page.getTextContent();
      const texts = (content.items as any[])
        .filter(item => typeof item?.str === 'string' && item.str.trim())
        .map(item => {
          const [, , , d, e, f] = item.transform;
          const h = Math.abs(item.height || d || 0);
          return {
            str: String(item.str).replace(/\s+/g, ' ').trim(),
            rect: { x: e, y: f - h * 0.2, width: item.width || 0, height: h } as PdfRect,
          };
        });
      for (const t of texts) {
        if (/(?:^|[\s:])cm$/i.test(t.str)) {
          // "Please select unit : CM": the word is at the end of the run.
          const share = Math.min(1, 2.6 / Math.max(2, t.str.length));
          const width = t.rect.width * share;
          scan.unitWords.push({
            pageIndex,
            unit: 'cm',
            rect: { ...t.rect, x: t.rect.x + t.rect.width - width, width },
          });
        } else if (/^inch(?:es)?$/i.test(t.str))
          scan.unitWords.push({ pageIndex, unit: 'inch', rect: t.rect });
        else if (/^[xX✓✔×]$/.test(t.str)) scan.marks.push({ pageIndex, rect: t.rect });
      }
      const labelFor = (field: PdfRect): string | undefined => {
        const mid = field.y + field.height / 2;
        let best: { label: string; gap: number } | undefined;
        for (const t of texts) {
          if (!LABEL_PATTERN.test(t.str)) continue;
          const tm = t.rect.y + t.rect.height / 2;
          if (Math.abs(tm - mid) > field.height / 2 + 2) continue;
          const gap = field.x - (t.rect.x + t.rect.width);
          if (gap < -2 || gap > 140) continue;
          if (!best || gap < best.gap) best = { label: t.str, gap };
        }
        return best?.label;
      };
      for (const a of annotations as any[]) {
        if (a?.fieldType !== 'Tx' || !Array.isArray(a.rect)) continue;
        const name = String(a.fieldName || '');
        const field = fromPdfRect(a.rect);
        const label = labelFor(field);
        if (label) scan.labelled[name] = label;
        if (String(a.fieldValue ?? '').trim()) continue;
        const inside = texts.filter(t =>
          contains(field, t.rect.x + t.rect.width / 2, t.rect.y + t.rect.height / 2, 2)
        );
        const value = inside
          .map(t => t.str)
          .join(' ')
          .trim();
        if (!value || parseCustomerValue(value).kind === 'none') continue;
        const x0 = Math.min(...inside.map(t => t.rect.x));
        const x1 = Math.max(...inside.map(t => t.rect.x + t.rect.width));
        const y0 = Math.min(...inside.map(t => t.rect.y));
        const y1 = Math.max(...inside.map(t => t.rect.y + t.rect.height));
        scan.printed.push({
          pageIndex,
          fieldName: name,
          field,
          text: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
          value,
          label,
        });
      }
    }
  } finally {
    await doc.destroy?.();
  }
  return scan;
}

// ---------------------------------------------------------------- pdf-lib helpers
interface Widget {
  pageIndex: number;
  rect: PdfRect;
  onValue: string;
}

function widgetPages(pdf: PDFDocument): Map<PDFDict, number> {
  const out = new Map<PDFDict, number>();
  pdf.getPages().forEach((page, index) => {
    const annots = page.node.Annots();
    if (!annots) return;
    for (let i = 0; i < annots.size(); i += 1) {
      const raw = annots.get(i);
      const dict = raw instanceof PDFRef ? pdf.context.lookup(raw) : raw;
      if (dict instanceof PDFDict) out.set(dict, index);
    }
  });
  return out;
}

function widgetsOf(
  field: PDFRadioGroup | PDFTextField | PDFCheckBox,
  pages: Map<PDFDict, number>
): Widget[] {
  // A radio's options are listed per widget (its /Opt export values, else the on states).
  let options: string[] = [];
  if (field instanceof PDFRadioGroup) {
    try {
      options = field.getOptions();
    } catch {
      options = [];
    }
  }
  return field.acroField.getWidgets().map((widget, index) => {
    const r = widget.getRectangle();
    let onValue = options[index] || '';
    if (!onValue) {
      try {
        onValue = widget.getOnValue()?.decodeText?.() || '';
      } catch {
        onValue = '';
      }
    }
    return {
      pageIndex: pages.get(widget.dict) ?? 0,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      onValue,
    };
  });
}

const distance = (a: PdfRect, b: PdfRect): number => {
  const dx = Math.max(a.x - (b.x + b.width), 0, b.x - (a.x + a.width));
  const dy = Math.max(a.y - (b.y + b.height), 0, b.y - (a.y + a.height));
  return Math.hypot(dx, dy);
};

/** Which unit a radio button stands for: its own name, else the nearest CM/INCH word. */
function widgetUnit(widget: Widget, scan: PdfTextScan | null | undefined): PdfUnit | null {
  if (/^cm$/i.test(widget.onValue)) return 'cm';
  if (/^in(?:ch(?:es)?)?$/i.test(widget.onValue)) return 'inch';
  let best: { unit: PdfUnit; d: number } | null = null;
  for (const word of scan?.unitWords || []) {
    if (word.pageIndex !== widget.pageIndex) continue;
    // Centre to centre: a word can sit as close to the next button as to its own.
    if (distance(word.rect, widget.rect) > 30) continue;
    const d = Math.hypot(
      word.rect.x + word.rect.width / 2 - (widget.rect.x + widget.rect.width / 2),
      word.rect.y + word.rect.height / 2 - (widget.rect.y + widget.rect.height / 2)
    );
    if (!best || d < best.d) best = { unit: word.unit, d };
  }
  return best?.unit || null;
}

function drawFooter(page: PDFPage, font: PDFFont, text: string): void {
  const size = 7;
  const { width } = page.getSize();
  const textWidth = font.widthOfTextAtSize(text, size);
  const x = Math.max(12, Math.min(24, width - textWidth - 12));
  page.drawText(text, { x, y: 8, size, font, color: rgb(0.35, 0.35, 0.4) });
}

function drawBeside(page: PDFPage, font: PDFFont, value: PrintedValue, text: string): void {
  // Fit between the end of the customer's text and just past the field, so the
  // box does not run into the next column's letters; above the field if too tight.
  const left = value.text.x + value.text.width + 1.5;
  const room = value.field.x + value.field.width + 8 - left;
  const natural = Math.max(5, Math.min(7, value.field.height * 0.5));
  const fit = (room - 3) / Math.max(1, font.widthOfTextAtSize(text, 1));
  const inline = fit >= 4.8;
  const size = inline ? Math.min(natural, fit) : natural;
  const w = font.widthOfTextAtSize(text, size) + 3;
  const h = size + 2.5;
  const x = inline
    ? left
    : Math.min(value.field.x + value.field.width - w, page.getSize().width - w - 2);
  const y = inline
    ? value.field.y + (value.field.height - h) / 2
    : value.field.y + value.field.height - h * 0.35;
  page.drawRectangle({
    x,
    y,
    width: w,
    height: h,
    color: rgb(1, 1, 1),
    borderColor: rgb(0.96, 0.46, 0.21),
    borderWidth: 0.6,
  });
  page.drawText(text, {
    x: x + 1.5,
    y: y + 1.6,
    size,
    font,
    color: rgb(0.1, 0.1, 0.15),
  });
}

function drawMark(page: PDFPage, font: PDFFont, rect: PdfRect): void {
  const size = Math.min(rect.height, 11);
  const w = font.widthOfTextAtSize('X', size);
  page.drawText('X', {
    x: rect.x + (rect.width - w) / 2,
    y: rect.y + (rect.height - size * 0.7) / 2,
    size,
    font,
    color: rgb(0.1, 0.1, 0.15),
  });
}

const dateText = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;

// ---------------------------------------------------------------- convert
export async function convertPdfToCm(
  bytes: Uint8Array | ArrayBuffer,
  options: CmConvertOptions
): Promise<CmConvertResult> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const subject = pdf.getSubject() || '';
  const kind: CmConvertResult['kind'] = subject.startsWith(REVIEW_PREFIX)
    ? 'sofapaint-review'
    : 'cw-form';
  const scan = options.scan || null;
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pages = pdf.getPages();
  const pageOf = widgetPages(pdf);
  let form: ReturnType<PDFDocument['getForm']> | null = null;
  try {
    form = pdf.getForm();
  } catch {
    form = null;
  }
  const fields = form?.getFields() || [];

  // The unit each page states: a selected radio, or a printed X on one.
  const pageUnit = new Map<number, PdfUnit>();
  const radios: Array<{ group: PDFRadioGroup; widgets: Array<Widget & { unit: PdfUnit | null }> }> =
    [];
  for (const field of fields) {
    if (!(field instanceof PDFRadioGroup)) continue;
    const widgets = widgetsOf(field, pageOf).map(w => ({ ...w, unit: widgetUnit(w, scan) }));
    if (!widgets.some(w => w.unit === 'cm') || !widgets.some(w => w.unit === 'inch')) continue;
    radios.push({ group: field, widgets });
    const selected = field.getSelected();
    for (const w of widgets) {
      const marked =
        (selected && w.onValue === selected) ||
        (scan?.marks || []).some(
          m =>
            m.pageIndex === w.pageIndex &&
            contains(w.rect, m.rect.x + m.rect.width / 2, m.rect.y + m.rect.height / 2, 3)
        );
      if (marked && w.unit) pageUnit.set(w.pageIndex, w.unit);
    }
  }
  const stated = new Set(pageUnit.values());
  const docUnit: PdfUnit | null = stated.size === 1 ? [...stated][0] : null;
  const unitFor = (text: string, pageIndex: number): PdfUnit =>
    unitOfText(text) || pageUnit.get(pageIndex) || docUnit || options.unit || 'cm';

  const converted: CmConversion[] = [];
  const convertedPages = new Set<number>();

  // Values held in form fields.
  for (const field of fields) {
    if (!(field instanceof PDFTextField)) continue;
    const name = field.getName();
    if (kind === 'sofapaint-review' ? !name.startsWith('m_') : scan && !scan.labelled[name])
      continue;
    const text = (field.getText() || '').trim();
    if (!text) continue;
    const widgets = widgetsOf(field, pageOf);
    const pageIndex = widgets[0]?.pageIndex ?? 0;
    if (unitFor(text, pageIndex) !== 'inch') continue;
    const next = convertValueText(text);
    if (next === null) continue;
    field.setText(next);
    converted.push({
      where: 'field',
      pageIndex,
      name,
      label: scan?.labelled[name],
      from: text,
      to: next,
    });
    widgets.forEach(w => convertedPages.add(w.pageIndex));
  }

  // Values typed over the form as page text.
  for (const value of scan?.printed || []) {
    if (kind === 'sofapaint-review' && !value.fieldName.startsWith('m_')) continue;
    if (kind === 'cw-form' && !value.label) continue;
    if (unitFor(value.value, value.pageIndex) !== 'inch') continue;
    const next = convertValueText(value.value);
    const page = pages[value.pageIndex];
    if (next === null || !page) continue;
    drawBeside(page, fontBold, value, next);
    converted.push({
      where: 'printed',
      pageIndex: value.pageIndex,
      name: value.fieldName,
      label: value.label,
      from: value.value,
      to: next,
    });
    convertedPages.add(value.pageIndex);
  }

  // Unit controls: CM on every page that now holds cm values.
  let unitControls = 0;
  if (converted.length) {
    for (const { group, widgets } of radios) {
      const cmWidgets = widgets.filter(w => w.unit === 'cm' && convertedPages.has(w.pageIndex));
      if (!cmWidgets.length) continue;
      const chosen = cmWidgets[0];
      try {
        if (chosen.onValue) {
          group.select(chosen.onValue);
          unitControls += 1;
        }
      } catch (error) {
        console.warn('[cm PDF] Could not set the unit radio:', error);
      }
      // One radio group can span pages; it holds one choice, so mark the rest by hand.
      for (const w of cmWidgets.slice(1)) {
        if (w.onValue === chosen.onValue) continue;
        const page = pages[w.pageIndex];
        if (page) {
          drawMark(page, fontBold, w.rect);
          unitControls += 1;
        }
      }
    }
    for (const field of fields) {
      if (!(field instanceof PDFCheckBox)) continue;
      const name = field.getName();
      if (/(?:^|[^a-z])cm(?:$|[^a-z])/i.test(name)) {
        field.check();
        unitControls += 1;
      } else if (/inch/i.test(name)) field.uncheck();
    }
  }

  if (kind === 'sofapaint-review' && converted.length) {
    try {
      const manifest = JSON.parse(subject.slice(REVIEW_PREFIX.length));
      manifest.unit = 'cm';
      pdf.setSubject(`${REVIEW_PREFIX}${JSON.stringify(manifest)}`);
    } catch {
      // A broken manifest stays as it was; the unit radios still say cm.
    }
  }

  const when = dateText(options.date || new Date());
  const footer = converted.length
    ? `Converted to cm by SofaPaint for NOMS #${options.orderNumber}, ${when}; original values in inches`
    : `Checked by SofaPaint for NOMS #${options.orderNumber}, ${when}; values already in cm`;
  for (const page of pages) drawFooter(page, font, footer);

  if (form && converted.some(c => c.where === 'field')) {
    try {
      form.updateFieldAppearances(font);
    } catch (error) {
      console.warn('[cm PDF] Field appearances not refreshed:', error);
    }
  }
  const out = await pdf.save({ updateFieldAppearances: false });
  return { bytes: out, kind, converted, alreadyCm: !converted.length, unitControls };
}

/**
 * Several converted PDFs as one file for the email. Form fields are flattened
 * first so every value stays visible after the pages are copied.
 */
export async function mergeCmPdfs(files: Uint8Array[]): Promise<Uint8Array> {
  if (files.length === 1) return files[0];
  const out = await PDFDocument.create();
  for (const bytes of files) {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    try {
      src.getForm().flatten();
    } catch {
      // No form, or one pdf-lib cannot flatten: copy the pages as they are.
    }
    const copied = await out.copyPages(src, src.getPageIndices());
    copied.forEach(page => out.addPage(page));
  }
  return out.save();
}

// ---------------------------------------------------------------- storage
// The cm PDF (and the originals it came from) stay in this browser, keyed by
// NOMS order: kept out of the project JSON so saves stay small.
const DB_NAME = 'sofapaint-noms-pdfs';
const STORE = 'orders';

export interface StoredOrderPdfs {
  order: string;
  originals: Array<{ name: string; bytes: Uint8Array; unit?: PdfUnit }>;
  cm?: { name: string; bytes: Uint8Array; createdAt: string };
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise(resolve => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE))
        request.result.createObjectStore(STORE, { keyPath: 'order' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

export async function loadOrderPdfs(order: string): Promise<StoredOrderPdfs | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise(resolve => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(order);
    request.onsuccess = () => resolve((request.result as StoredOrderPdfs) || null);
    request.onerror = () => resolve(null);
  });
}

export async function saveOrderPdfs(record: StoredOrderPdfs): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  return new Promise(resolve => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}
