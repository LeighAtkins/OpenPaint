// Helpers for the PDF export: which unit to print, what to call the file, where
// to save it, and the page order. Kept free of the capture engine so they stay
// unit-testable; pdf-export-inline.ts wires them to the dialog.

import { formatHalfUp } from '../utils/rounding';
import { sanitizeFilenamePart } from '../utils/naming-utils.js';

export { roundHalfUp, formatHalfUp } from '../utils/rounding';

export type ExportUnit = 'cm' | 'inch';

export const LAST_EXPORT_UNIT_KEY = 'sofapaint:pdf-export-unit';

/** cm with one decimal, rounded half up on the exact value: 6.35 prints "6.4 cm". */
export function formatCmForExport(cm: number, decimals = 1): string {
  const value = Number(cm);
  if (!Number.isFinite(value) || value <= 0) return '';
  return `${formatHalfUp(value, decimals, true)} cm`;
}

// ── Unit ────────────────────────────────────────────────────────────

export function normalizeExportUnit(value: unknown): ExportUnit | null {
  const text = String(value || '')
    .trim()
    .toLowerCase();
  if (text === 'cm') return 'cm';
  if (text === 'inch' || text === 'inches' || text === 'in') return 'inch';
  return null;
}

export function nomsOrderNumbers(metadata: any): string[] {
  const orders = metadata?.externalSources?.nomsOrders;
  if (!orders || typeof orders !== 'object') return [];
  return Object.keys(orders)
    .map(key => String(orders[key]?.orderNumber || key).trim())
    .filter(Boolean);
}

/**
 * Production (NOMS) projects default to cm, as does a project whose last
 * export was in cm; otherwise the project's own display unit.
 */
export function defaultExportUnit({
  metadata,
  lastUnit,
  projectUnit,
}: {
  metadata?: any;
  lastUnit?: unknown;
  projectUnit?: unknown;
}): ExportUnit {
  if (nomsOrderNumbers(metadata).length) return 'cm';
  if (normalizeExportUnit(lastUnit) === 'cm') return 'cm';
  return normalizeExportUnit(projectUnit) || 'inch';
}

export function readLastExportUnit(): ExportUnit | null {
  try {
    return normalizeExportUnit(window.localStorage?.getItem(LAST_EXPORT_UNIT_KEY));
  } catch {
    return null;
  }
}

export function rememberExportUnit(unit: ExportUnit): void {
  try {
    window.localStorage?.setItem(LAST_EXPORT_UNIT_KEY, unit);
  } catch {
    // Private mode: the default simply falls back to the project unit.
  }
}

/**
 * Show the project in `unit` while exporting, so canvas labels, the table and
 * the manifest all agree, and return a function that puts the project's own
 * display unit back.
 */
export function applyTemporaryDisplayUnit(unit: ExportUnit): () => void {
  const selector = document.getElementById('unitSelector') as HTMLSelectElement | null;
  if (!selector) return () => {};
  const previous: ExportUnit = selector.value === 'cm' ? 'cm' : 'inch';
  if (previous === unit) return () => {};
  const apply = (next: ExportUnit) => {
    selector.value = next;
    selector.dispatchEvent(new Event('change', { bubbles: true }));
  };
  apply(unit);
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    apply(previous);
  };
}

// ── File name and saving ────────────────────────────────────────────

export function unitFileLabel(unit: ExportUnit): string {
  return unit === 'cm' ? 'cm' : 'inches';
}

/**
 * `<NOMS order> - <customer> - <project name> - <unit>.pdf` for a linked
 * project, else `<project name> - <unit>.pdf`. The customer is left out when
 * the project name already carries it.
 */
export function buildPdfExportFilename({
  projectName,
  unit,
  metadata,
}: {
  projectName: string;
  unit: ExportUnit;
  metadata?: any;
}): string {
  const project = sanitizeFilenamePart(projectName, 'SofaPaint Project');
  const orders = nomsOrderNumbers(metadata);
  const parts: string[] = [];
  if (orders.length) {
    parts.push(sanitizeFilenamePart(orders.join(' + '), 'NOMS'));
    const orderMap = metadata?.externalSources?.nomsOrders || {};
    const first = orderMap[Object.keys(orderMap)[0]];
    const customer = sanitizeFilenamePart(
      first?.customerName || metadata?.naming?.customerName || '',
      ''
    );
    if (customer && !project.toLowerCase().includes(customer.toLowerCase())) parts.push(customer);
  }
  parts.push(project, unitFileLabel(unit));
  return `${parts.join(' - ')}.pdf`;
}

export function canChooseSaveLocation(): boolean {
  return typeof (window as any).showSaveFilePicker === 'function';
}

/**
 * Ask where to save before the export starts (the picker needs the click's
 * user activation, which a long export would outlive). Resolves to a file
 * handle, `null` when the picker is unavailable or fails (download instead),
 * or `'cancelled'` when Leigh closes the picker.
 */
export async function pickPdfSaveTarget(filename: string): Promise<any | null | 'cancelled'> {
  const picker = (window as any).showSaveFilePicker;
  if (typeof picker !== 'function') return null;
  try {
    return await picker.call(window, {
      suggestedName: filename,
      id: 'sofapaint-pdf-export',
      types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }],
    });
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') return 'cancelled';
    console.warn('[PDF] Save picker unavailable, downloading instead:', error);
    return null;
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.position = 'fixed';
  a.style.left = '-9999px';
  a.style.top = '0';
  document.body.appendChild(a);
  a.click();
  window.setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 30000);
}

/** Write to the picked file, or download when there is no handle (or it fails). */
export async function writePdfToTarget(blob: Blob, filename: string, handle?: any): Promise<void> {
  if (handle && typeof handle.createWritable === 'function') {
    try {
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (error) {
      console.warn('[PDF] Could not write the chosen file, downloading instead:', error);
    }
  }
  downloadBlob(blob, filename);
}

// ── Page order ──────────────────────────────────────────────────────

/** The project's view order as the image list shows it. */
export function getProjectViewOrder(): string[] {
  const listed = (window as any).orderedImageLabels;
  if (Array.isArray(listed) && listed.length) return listed.map(String);
  const views = (window as any).app?.projectManager?.views || {};
  return Object.keys(views);
}

/**
 * Sort items into the project's view order. Views missing from the order go
 * last in their original order, and items on the same view keep their
 * original order (stable).
 */
export function orderByViewOrder<T>(
  items: T[],
  getViewId: (item: T) => string,
  viewOrder: string[]
): T[] {
  const rank = new Map<string, number>();
  (viewOrder || []).forEach((viewId, index) => {
    if (!rank.has(viewId)) rank.set(viewId, index);
  });
  const fallback = rank.size;
  return (items || [])
    .map((item, index) => ({ item, index, rank: rank.get(getViewId(item)) ?? fallback }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(entry => entry.item);
}

export function orderViewIdsForExport(viewIds: string[], viewOrder: string[]): string[] {
  return orderByViewOrder(viewIds, id => id, viewOrder);
}
