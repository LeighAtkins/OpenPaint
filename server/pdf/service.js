import { renderReportTemplate } from './templates/report-template.js';
import { renderPdfWithPuppeteer } from './render-puppeteer.js';
import { mapProjectToReportModel } from './map-project-to-report.js';
import { injectPdfFormFields } from './inject-form-fields.js';

const SUPPORTED_RENDERERS = new Set(['pdf-lib', 'puppeteer', 'hybrid']);

export function resolvePdfRendererMode(explicitMode) {
  const raw = String(explicitMode || process.env.PDF_RENDERER || 'hybrid').toLowerCase();
  return SUPPORTED_RENDERERS.has(raw) ? raw : 'hybrid';
}

export async function renderPdfFromRequest(payload, rendererMode) {
  const mode = resolvePdfRendererMode(rendererMode);
  const options = payload.options || {};
  const reportModel =
    payload.source === 'project'
      ? mapProjectToReportModel(payload.project)
      : payload.source === 'report'
        ? payload.report
        : null;
  const html =
    payload.source === 'html' ? payload.html : renderReportTemplate(reportModel, options);

  if (mode === 'pdf-lib') {
    const error = new Error('PDF_RENDERER_UNSUPPORTED');
    error.code = 'PDF_RENDERER_UNSUPPORTED';
    error.details = 'pdf-lib server renderer is not implemented yet';
    throw error;
  }

  if (mode === 'puppeteer' || mode === 'hybrid') {
    const rendered = await renderPdfWithPuppeteer({ html, options });
    const shouldInjectFormFields = options.injectFormFields !== false;
    if (mode === 'hybrid' && shouldInjectFormFields) {
      return injectPdfFormFields(rendered.pdfBuffer, rendered.anchors || []);
    }
    return rendered.pdfBuffer;
  }

  const error = new Error('PDF_RENDERER_INVALID_MODE');
  error.code = 'PDF_RENDERER_INVALID_MODE';
  throw error;
}
