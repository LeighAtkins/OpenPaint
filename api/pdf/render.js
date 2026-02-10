import crypto from 'crypto';
import { pdfRenderRequestSchema, sanitizePdfFilename } from '../../server/pdf/schema.js';
import { renderPdfFromRequest, resolvePdfRendererMode } from '../../server/pdf/service.js';

function readBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return {};
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, code: 'METHOD_NOT_ALLOWED' });
  }

  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  res.setHeader('X-Pdf-Request-Id', requestId);

  try {
    const parsed = pdfRenderRequestSchema.safeParse(readBody(req));
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        code: 'PDF_RENDER_BAD_REQUEST',
        requestId,
        errors: parsed.error.issues,
      });
    }

    const payload = parsed.data;
    const mode = resolvePdfRendererMode(payload.options?.renderer);
    const pdfBuffer = await renderPdfFromRequest(payload, mode);
    const filename = sanitizePdfFilename(
      payload.options?.filename || payload.report?.projectName || 'openpaint-report.pdf'
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('X-Pdf-Renderer', mode);
    res.setHeader('X-Pdf-Duration-Ms', String(Date.now() - startedAt));
    return res.status(200).send(pdfBuffer);
  } catch (error) {
    const code = error?.code || 'PDF_RENDER_FAILED';
    const detail = error?.details || error?.message || String(error);
    if (code === 'PDF_RENDERER_UNSUPPORTED' || code === 'PDF_RENDERER_MISSING_DEPENDENCY') {
      return res.status(501).json({ success: false, code, requestId, message: detail });
    }
    return res.status(500).json({
      success: false,
      code,
      requestId,
      message: 'Failed to render PDF',
      detail,
    });
  }
}
