/**
 * The Comfort Works PDF template library (src/data/pdf-templates.json, built by
 * scripts/build-pdf-registry.mjs) and lookups over it.
 *
 *   identifyPdfTemplate(fingerprint)  -> which library page a PDF page was printed from
 *   identifyPdfDocument(fingerprints) -> the library file for a whole document
 *   findCwSvg(modelCode, view)        -> the SofaPaint SVG diagram for a model view
 */
import registry from '../../data/pdf-templates.json';
import type { PdfPageFingerprint, PdfView } from '../cw-form-pdf/pdf-fingerprint';
import {
  matchPdfDocument,
  matchPdfTemplate,
  type CwSvgEntry,
  type PdfDocumentMatch,
  type PdfTemplate,
  type PdfTemplateMatch,
} from '../cw-form-pdf/pdf-template-match';

export type { PdfDocumentMatch, PdfTemplate, PdfTemplateMatch, CwSvgEntry };
export { fingerprintPage, type PdfPageFingerprint } from '../cw-form-pdf/pdf-fingerprint';

export const PDF_TEMPLATES: readonly PdfTemplate[] = (registry as any).templates;
export const CW_SVGS: readonly CwSvgEntry[] = (registry as any).svgs || [];

/** Best library page for one PDF page: exact field-name set first, else nearest. */
export function identifyPdfTemplate(
  fingerprint: PdfPageFingerprint,
  templates: readonly PdfTemplate[] = PDF_TEMPLATES
): PdfTemplateMatch {
  return matchPdfTemplate(fingerprint, templates);
}

/** Library file for a whole document; pages follow it so shared pages stay consistent. */
export function identifyPdfDocument(
  fingerprints: readonly PdfPageFingerprint[],
  templates: readonly PdfTemplate[] = PDF_TEMPLATES
): PdfDocumentMatch {
  return matchPdfDocument(fingerprints, templates);
}

/**
 * SVG diagram for a CW model code and view, for when NOMS has no CW40 form.
 * Tries the exact code, then the arm/back component at the end of the code
 * (CS3B-WA-HB -> WA-HB), then the code without its L / R hand.
 */
export function findCwSvg(modelCode: string, view?: PdfView | string | null): CwSvgEntry | null {
  const code = (modelCode || '').toUpperCase().trim();
  if (!code) return null;
  const parts = code.split('-');
  const tries = [code];
  for (let i = 1; i < parts.length - 1; i += 1) tries.push(parts.slice(i).join('-'));
  if (/-(L|R)$/.test(code)) tries.push(...tries.map(c => c.replace(/-(L|R)$/, '')));
  for (const attempt of tries) {
    const hit = CW_SVGS.find(s => s.code === attempt && (!view || s.view === view));
    if (hit) return hit;
  }
  return null;
}
