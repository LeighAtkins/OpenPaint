import {
  fetchCwMeasurementsTable,
  fetchOrderImagesByFormId,
  mapOrderImagesToMeasurementItems,
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

    const [measurements, orderImages] = await Promise.all([
      fetchCwMeasurementsTable({ formId, lang, override }),
      fetchOrderImagesByFormId({ formId, override }),
    ]);

    const mapped = mapOrderImagesToMeasurementItems(measurements.content, orderImages.lines);

    const perItemCounts = Object.fromEntries(
      Object.entries(mapped.byItemCode || {}).map(([code, images]) => [
        code,
        Array.isArray(images) ? images.length : 0,
      ])
    );

    const maxedItemCodes = Object.entries(perItemCounts)
      .filter(([, count]) => count >= 6)
      .map(([code]) => code);

    return res.status(measurements.ok && orderImages.ok ? 200 : 502).json({
      success: measurements.ok && orderImages.ok,
      code: measurements.ok && orderImages.ok ? 'CW_IMAGES_FETCH_OK' : 'CW_IMAGES_FETCH_FAILED',
      formId,
      lang,
      durationMs: Date.now() - startedAt,
      sources: {
        measurementsUrl: measurements.targetUrl,
        orderApiUrl: orderImages.targetUrl,
      },
      upstreamStatus: {
        measurements: measurements.status,
        orderApi: orderImages.status,
      },
      session: measurements.session || orderImages.session,
      summary: {
        itemCodes: Object.keys(mapped.byItemCode || {}).length,
        totalImages: Object.values(perItemCounts).reduce((a, b) => a + b, 0),
        perItemCounts,
        maxedItemCodes,
        unmatchedOrderLines: mapped.unmatchedLines.length,
      },
      imagesByItemCode: mapped.byItemCode,
      lineMappingByItemCode: mapped.lineMappingByItemCode,
      unmatchedOrderLines: mapped.unmatchedLines,
      order: orderImages.order,
      note: 'Upload endpoint available at /api/integrations/cw/images/:formId/upload (max 6 images per item code).',
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      code: error?.code || 'CW_IMAGES_FETCH_ERROR',
      message: error?.message || 'Failed to fetch CW images',
      details: error?.details || null,
      formId,
      durationMs: Date.now() - startedAt,
    });
  }
}
