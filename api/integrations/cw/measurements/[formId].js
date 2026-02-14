import {
  analyzeMeasureFormPayload,
  buildMeasureSavePayloadFromTable,
  fetchCwMeasurementsTable,
  readJsonBody,
} from '../_shared.js';

export default async function handler(req, res) {
  const startedAt = Date.now();
  const formId = String(req.query?.formId || '').trim();

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  if (!formId) {
    return res.status(400).json({
      success: false,
      code: 'CW_FORM_ID_REQUIRED',
      message: 'formId is required',
    });
  }

  try {
    const body = req.method === 'POST' ? await readJsonBody(req) : {};
    const lang = String(req.query?.lang || body?.lang || 'en').trim() || 'en';
    const override = {
      baseUrl: req.query?.baseUrl || body?.baseUrl,
      username: req.query?.username || body?.username,
      password: req.query?.password || body?.password,
    };

    const result = await fetchCwMeasurementsTable({ formId, lang, override });
    const payloadTemplate = buildMeasureSavePayloadFromTable(result.content, formId, {
      employeeName: body?.employeeName,
      user: body?.user,
      unit: body?.unit,
    });
    const validation = analyzeMeasureFormPayload(payloadTemplate);

    return res.status(result.ok ? 200 : 502).json({
      success: result.ok,
      code: result.ok ? 'CW_MEASUREMENTS_FETCH_OK' : 'CW_MEASUREMENTS_FETCH_FAILED',
      formId,
      lang,
      durationMs: Date.now() - startedAt,
      targetUrl: result.targetUrl,
      upstreamStatus: result.status,
      session: result.session,
      summary: {
        unit: result.content?.unit || null,
        confirmed: result.content?.confirmed ?? null,
        productsCount: Array.isArray(result.content?.products_list)
          ? result.content.products_list.length
          : Array.isArray(result.content?.products)
            ? result.content.products.length
            : 0,
      },
      payloadTemplate,
      validation,
      upstreamBody: result.body,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      code: error?.code || 'CW_MEASUREMENTS_FETCH_ERROR',
      message: error?.message || 'Failed to fetch CW measurements',
      details: error?.details || null,
      formId,
      durationMs: Date.now() - startedAt,
    });
  }
}
