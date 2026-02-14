import {
  deleteOrderImage,
  fetchCwMeasurementsTable,
  fetchOrderImagesByFormId,
  mapOrderImagesToMeasurementItems,
  readJsonBody,
} from '../../_shared.js';

export default async function handler(req, res) {
  const startedAt = Date.now();
  const formId = String(req.query?.formId || '').trim();

  if (req.method !== 'POST') {
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
    const body = await readJsonBody(req);
    const itemCode = String(body?.itemCode || '').trim();
    const explicitOrderlineId = String(body?.orderlineId || '').trim();
    const fileIndexRaw = Number.parseInt(body?.fileIndex, 10);
    const fileIndex =
      Number.isFinite(fileIndexRaw) && fileIndexRaw >= 1 && fileIndexRaw <= 6 ? fileIndexRaw : null;
    const lang = String(body?.lang || 'en').trim() || 'en';

    if (!itemCode) {
      return res.status(400).json({
        success: false,
        code: 'CW_ITEM_CODE_REQUIRED',
        message: 'itemCode is required',
      });
    }
    if (!fileIndex) {
      return res.status(400).json({
        success: false,
        code: 'CW_FILE_INDEX_REQUIRED',
        message: 'fileIndex (1-6) is required',
      });
    }

    const override = {
      baseUrl: body?.baseUrl,
      username: body?.username,
      password: body?.password,
    };

    const [measurements, orderImages] = await Promise.all([
      fetchCwMeasurementsTable({ formId, lang, override }),
      fetchOrderImagesByFormId({ formId, override }),
    ]);

    const mapped = mapOrderImagesToMeasurementItems(measurements.content, orderImages.lines);
    let mapping = mapped.lineMappingByItemCode?.[itemCode] || null;

    if (!mapping?.lineId && explicitOrderlineId) {
      const explicitLine =
        (orderImages.lines || []).find(line => line.lineId === explicitOrderlineId) || null;
      if (explicitLine) {
        mapping = { lineId: explicitLine.lineId, productName: explicitLine.productName };
      }
    }

    if (!mapping?.lineId) {
      const singleLine =
        Array.isArray(orderImages.lines) && orderImages.lines.length === 1
          ? orderImages.lines[0]
          : null;
      if (singleLine?.lineId) {
        mapping = { lineId: singleLine.lineId, productName: singleLine.productName };
      }
    }

    if (!mapping?.lineId) {
      return res.status(404).json({
        success: false,
        code: 'CW_ITEM_CODE_NOT_MAPPED',
        message: `No order line mapping found for itemCode '${itemCode}'`,
        itemCode,
        availableOrderLines: (orderImages.lines || []).map(line => ({
          lineId: line.lineId,
          productName: line.productName,
        })),
        mappingByItemCode: mapped.lineMappingByItemCode || {},
      });
    }

    const result = await deleteOrderImage({
      formId,
      override,
      orderReference: body?.orderReference || `CW-${formId}`,
      orderlineId: mapping.lineId,
      fileIndex,
      photoType: body?.photoType || 'sofa_photos',
      accountType: body?.accountType || 'customer',
      lang,
    });

    return res.status(result.ok ? 200 : 502).json({
      success: result.ok,
      code: result.ok ? 'CW_IMAGE_DELETE_OK' : 'CW_IMAGE_DELETE_FAILED',
      formId,
      itemCode,
      fileIndex,
      durationMs: Date.now() - startedAt,
      delete: {
        targetUrl: result.targetUrl,
        upstreamStatus: result.status,
        orderlineId: mapping.lineId,
      },
      attempts: result.attempts,
      session: result.session,
      upstreamBody: result.body,
      note: result.ok
        ? 'Delete succeeded.'
        : 'Delete endpoint may differ in your CW environment; share successful network request if this fails.',
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      code: error?.code || 'CW_IMAGE_DELETE_ERROR',
      message: error?.message || 'Failed to delete image from CW',
      details: error?.details || null,
      formId,
      durationMs: Date.now() - startedAt,
    });
  }
}
