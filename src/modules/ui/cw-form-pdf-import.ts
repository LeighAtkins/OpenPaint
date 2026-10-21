/**
 * Import a filled Comfort Works measuring-diagram PDF as SofaPaint measurements.
 *
 * Each filled diagram becomes a project image. Its labelled lines are mounted
 * through the MOS overlay (the same path guide imports use) and the form values
 * are saved against those labels, so the unit toggle shows cm or inches.
 */
import { imageRegistry } from '../ImageRegistry.js';
import {
  analyzeCwFormPage,
  detectDocumentUnit,
  extractCwPageData,
  type CwFieldValue,
  type CwFormView,
  type CwPageData,
  type CwPoint,
} from '../cw-form-pdf/parse-cw-form';
import { formatCustomerNumber } from '../utils/customer-value';
import { readCustomerPdfDocument, type CustomerPdfResult } from '../cw-form-pdf/read-customer-pdf';

export type {
  CustomerPdfPage,
  CustomerPdfResult,
  CustomerPdfValue,
} from '../cw-form-pdf/read-customer-pdf';

export interface CwFormImportResult {
  views: Array<{ viewId: string; title: string; measurements: number }>;
  warnings: string[];
  /** Ranges the customer wrote and the number each line took. */
  ranges: Array<{ pageNumber: number; label: string; text: string; used: number }>;
}

export interface CwFormImportOptions {
  /** Number to use for a range, keyed `${pageNumber}:${label}`; otherwise the parser's default pick. */
  chosen?: Record<string, number>;
}

/** Key for a value's range choice: page and letter. */
export const rangeKey = (pageNumber: number, label: string): string => `${pageNumber}:${label}`;

/**
 * Keep a customer's words beside a measurement (project metadata
 * measurementNotes, keyed scope|label), the same place the check-request
 * dialog stores them. An empty note removes the entry.
 */
export function rememberMeasurementNote(scope: string, label: string, note: string): void {
  const manager = window.app?.projectManager;
  if (!manager?.setProjectMetadata) return;
  try {
    const current = manager.getProjectMetadata?.()?.measurementNotes || {};
    const next = { ...current };
    const key = `${scope}|${label}`;
    if (note) next[key] = note;
    else delete next[key];
    manager.setProjectMetadata({ measurementNotes: next });
  } catch (error) {
    console.warn('[CW form] Could not store the measurement note:', error);
  }
}

const TARGET_CROP_WIDTH_PX = 1800;

export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
}

export async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  }
  return pdfjs;
}

function createViewId(baseId: string): string {
  const views = window.app?.projectManager?.views || {};
  const normalized =
    baseId
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'cw-form';
  if (!views[normalized]) return normalized;
  let index = 2;
  while (views[`${normalized}-${index}`]) index += 1;
  return `${normalized}-${index}`;
}

async function registerImage(viewId: string, imageUrl: string, filename: string): Promise<void> {
  const manager = window.app?.projectManager;
  if (!manager?.addImage) throw new Error('Project manager not ready to add images');
  const registryEnabled =
    typeof imageRegistry?.registerImage === 'function' &&
    (typeof imageRegistry?.isEnabled !== 'function' || imageRegistry.isEnabled());
  if (registryEnabled) {
    await imageRegistry.registerImage(viewId, imageUrl, filename, {
      source: 'cw-form-pdf',
      refreshBackground: false,
    });
  } else {
    await manager.addImage(viewId, imageUrl, { refreshBackground: false });
    (window as any).addImageToSidebar?.(imageUrl, viewId, filename);
  }
  if (!manager.views?.[viewId]) throw new Error(`Image registration did not create ${viewId}`);
}

async function waitForBackground(viewId: string, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const manager = window.app?.projectManager;
    const bg = window.app?.canvasManager?.fabricCanvas?.backgroundImage;
    const element = bg?._element;
    if (manager?.currentViewId === viewId && bg && (!element || element.complete !== false)) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  return false;
}

/** Render the diagram crop with the form's own circled labels painted out. */
async function renderView(page: any, view: CwFormView): Promise<string> {
  const cropWidth = view.crop.x1 - view.crop.x0;
  const cropHeight = view.crop.y1 - view.crop.y0;
  const scale = Math.min(4, Math.max(2, TARGET_CROP_WIDTH_PX / Math.max(1, cropWidth)));
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const pdfjs = await loadPdfjs();
  // Form field appearances (the original cm table values) stay out of the image.
  await page.render({
    canvas,
    canvasContext: ctx,
    viewport,
    annotationMode: pdfjs.AnnotationMode.DISABLE,
  }).promise;

  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ffffff';
  for (const circle of view.maskCircles) {
    ctx.beginPath();
    ctx.arc(
      circle.center.x * scale,
      circle.center.y * scale,
      (circle.radius + 1.5) * scale,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }
  ctx.lineWidth = 3.5 * scale;
  ctx.lineCap = 'round';
  for (const stem of view.maskStems) {
    ctx.beginPath();
    stem.forEach((p, i) =>
      i ? ctx.lineTo(p.x * scale, p.y * scale) : ctx.moveTo(p.x * scale, p.y * scale)
    );
    ctx.stroke();
  }

  const out = document.createElement('canvas');
  out.width = Math.round(cropWidth * scale);
  out.height = Math.round(cropHeight * scale);
  out
    .getContext('2d')
    ?.drawImage(
      canvas,
      view.crop.x0 * scale,
      view.crop.y0 * scale,
      out.width,
      out.height,
      0,
      0,
      out.width,
      out.height
    );
  return out.toDataURL('image/png');
}

/** Guide-format SVG (svgMerge ids: mA1cm) in crop-local page points. */
export function buildMeasurementSvg(view: CwFormView): string {
  const w = view.crop.x1 - view.crop.x0;
  const h = view.crop.y1 - view.crop.y0;
  const local = (p: CwPoint) =>
    `${(p.x - view.crop.x0).toFixed(2)},${(p.y - view.crop.y0).toFixed(2)}`;
  const shapes = view.measurements.map(m => {
    const id = `m${m.label}cm`;
    if (m.points.length > 2) {
      return `<polyline id="${id}" points="${m.points.map(local).join(' ')}" fill="none" stroke="${m.color}" stroke-width="2"/>`;
    }
    const [a, b] = m.points.map(local).map(pair => pair.split(','));
    return `<line id="${id}" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${m.color}" stroke-width="2"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.toFixed(2)} ${h.toFixed(2)}">${shapes.join('')}</svg>`;
}

/**
 * Value string for parseAndSaveMeasurement. CW forms are often inch figures
 * converted to cm and rounded (41.25" -> 104.78 cm); store those as the clean
 * inch value so labels read 41 1/4" rather than 41.252". Two-decimal cm
 * rounding moves a value by at most ~0.002", so genuine metric figures stay cm.
 */
export function measurementInput(value: number, unit: 'cm' | 'inch'): string {
  if (unit === 'inch') return `${value} in`;
  const inches = value / 2.54;
  const eighths = Math.round(inches * 8) / 8;
  return Math.abs(inches - eighths) < 0.003 ? `${eighths} in` : `${value}cm`;
}

async function mountMeasurements(
  viewId: string,
  view: CwFormView,
  options: CwFormImportOptions,
  result: CwFormImportResult
): Promise<number> {
  let overlayManager = window.app?.measurementOverlayManager;
  if (!overlayManager?.importSvg && window.app?.initDeferredManagers) {
    await window.app.initDeferredManagers();
    overlayManager = window.app?.measurementOverlayManager;
  }
  if (!overlayManager?.importSvg) throw new Error('Measurement overlay is not available');
  await overlayManager.importSvg(buildMeasurementSvg(view), viewId);

  const metadata = window.app?.metadataManager;
  let saved = 0;
  for (const m of view.measurements) {
    const picked = options.chosen?.[rangeKey(view.pageNumber, m.label)];
    const value = m.range && typeof picked === 'number' ? picked : m.value;
    if (metadata?.parseAndSaveMeasurement?.(viewId, m.label, measurementInput(value, view.unit))) {
      saved += 1;
      if (m.range) {
        // The line carries one number; the customer's two stay in the note.
        rememberMeasurementNote(viewId, m.label, `customer wrote ${m.text || m.range.join(' - ')}`);
        result.ranges.push({
          pageNumber: view.pageNumber,
          label: m.label,
          text: m.text || m.range.join(' - '),
          used: value,
        });
      }
    }
    window.app?.tagManager?.updateTagText?.(m.label, viewId);
  }
  window.app?.canvasManager?.fabricCanvas?.requestRenderAll?.();
  return saved;
}

/** One diagram's values from a filled form, without adding anything to the project. */
export interface CwFormValueGroup {
  file: string;
  pageNumber: number;
  title: string;
  unit: 'cm' | 'inch';
  unitAssumed: boolean;
  /** `range` holds both numbers when the customer wrote two; `value` is the default pick. */
  values: Array<CwFieldValue & { label: string }>;
  /** Letters answered with words only ("n/a", "see photo"). */
  notes?: Array<{ label: string; text: string }>;
  /** Template model codes and view, when the page matched the library (readCustomerPdf). */
  modelCodes?: string[];
  view?: string | null;
}

/** Read the label/value pairs of every diagram in a filled CW measuring PDF. */
export async function readCwFormPdfValues(file: File): Promise<CwFormValueGroup[]> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: CwPageData[] = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    pages.push(await extractCwPageData(await doc.getPage(n), pdfjs.OPS));
  }
  const documentUnit = detectDocumentUnit(pages);
  const groups: CwFormValueGroup[] = [];
  for (const data of pages) {
    for (const view of analyzeCwFormPage(data, documentUnit)) {
      const values = [...view.measurements, ...view.unplaced].map(m => ({
        label: m.label,
        value: m.value,
        range: m.range,
        text: m.text,
      }));
      if (!values.length) continue;
      groups.push({
        file: file.name,
        pageNumber: view.pageNumber,
        title: view.title,
        unit: view.unit,
        unitAssumed: view.unitAssumed,
        values,
      });
    }
  }
  return groups;
}

/**
 * Identify a PDF a customer sent back and read every value on it.
 * `kind: 'sofapaint-review'` means a SofaPaint check-request sheet (pages empty;
 * the check-request reader handles those). Each page names the library
 * template it matched, with a confidence, its unit, and the values (a range
 * keeps both numbers; words alone come back with `value: null`).
 */
export async function readCustomerPdf(file: File): Promise<CustomerPdfResult> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    return await readCustomerPdfDocument(doc as any, pdfjs.OPS, file.name);
  } finally {
    await doc.cleanup?.();
  }
}

export async function importCwFormPdf(
  file: File,
  options: CwFormImportOptions = {}
): Promise<CwFormImportResult> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const warnings: string[] = [];
  const pages: Array<{ page: any; data: CwPageData }> = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    pages.push({ page, data: await extractCwPageData(page, pdfjs.OPS) });
  }
  const documentUnit = detectDocumentUnit(pages.map(p => p.data));

  const manager = window.app?.projectManager;
  const result: CwFormImportResult = { views: [], warnings, ranges: [] };
  const baseName = file.name.replace(/\.pdf$/i, '');

  for (const { page, data } of pages) {
    for (const view of analyzeCwFormPage(data, documentUnit)) {
      if (view.unplaced.length) {
        warnings.push(
          `Page ${view.pageNumber}: no diagram line for ${view.unplaced
            .map(u => `${u.label} (${u.value})`)
            .join(', ')}`
        );
      }
      if (!view.measurements.length) continue;
      if (view.unitAssumed) warnings.push(`Page ${view.pageNumber}: unit not stated, assumed cm`);

      const viewId = createViewId(`cw-p${view.pageNumber}-${view.title}`);
      const imageUrl = await renderView(page, view);
      await registerImage(viewId, imageUrl, `${baseName} p${view.pageNumber}.png`);
      await manager.switchView(viewId, true);
      if (!(await waitForBackground(viewId))) {
        warnings.push(`${view.title}: image did not finish loading`);
        continue;
      }
      const saved = await mountMeasurements(viewId, view, options, result);
      result.views.push({ viewId, title: view.title, measurements: saved });
    }
  }

  if (result.views.length && manager?.switchView) {
    await manager.switchView(result.views[0].viewId, true);
  }
  return result;
}

/** Upload entry point: import, then report the outcome in the status bar. */
export async function handleCwFormPdfFile(file: File): Promise<boolean> {
  const status = (message: string, kind = 'info') =>
    typeof window.showStatusMessage === 'function'
      ? window.showStatusMessage(message, kind)
      : console.log(`[CW form] ${message}`);
  try {
    status(`Reading ${file.name}...`);
    const { views, warnings, ranges } = await importCwFormPdf(file);
    for (const range of ranges) {
      warnings.push(
        `${range.label}: customer wrote ${range.text}, used ${formatCustomerNumber(range.used)}`
      );
    }
    if (!views.length) {
      status(
        `${file.name}: no filled Comfort Works measuring diagram found${
          warnings.length ? ` (${warnings.join('; ')})` : ''
        }`,
        'warning'
      );
      return false;
    }
    const count = views.reduce((total, v) => total + v.measurements, 0);
    status(
      `Imported ${count} measurements on ${views.length} diagram${views.length > 1 ? 's' : ''}${
        warnings.length ? `. Check: ${warnings.join('; ')}` : ''
      }`,
      warnings.length ? 'warning' : 'success'
    );
    return true;
  } catch (error) {
    console.error('[CW form] Import failed:', error);
    status(`Could not import ${file.name}: ${(error as Error).message}`, 'error');
    return false;
  }
}
