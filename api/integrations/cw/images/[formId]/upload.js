import {
  fetchCwMeasurementsTable,
  fetchOrderImagesByFormId,
  mapOrderImagesToMeasurementItems,
  readJsonBody,
  uploadOrderImage,
} from '../../_shared.js';

function nextAvailableIndex(images = []) {
  const used = new Set(
    images
      .map(img => Number.parseInt(img?.index, 10))
      .filter(value => Number.isFinite(value) && value >= 1 && value <= 6)
  );
  for (let i = 1; i <= 6; i += 1) {
    if (!used.has(i)) return i;
  }
  return null;
}

function usedIndexes(images = []) {
  return new Set(
    images
      .map(img => Number.parseInt(img?.index, 10))
      .filter(value => Number.isFinite(value) && value >= 1 && value <= 6)
  );
}

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
    const fileBase64 = String(body?.fileBase64 || '').trim();
    const fileName = String(body?.fileName || 'upload.jpg').trim();
    const mimeType = String(body?.mimeType || 'image/jpeg').trim();
    const lang = String(body?.lang || 'en').trim() || 'en';

    if (!itemCode) {
      return res.status(400).json({
        success: false,
        code: 'CW_ITEM_CODE_REQUIRED',
        message: 'itemCode is required',
      });
    }

    if (!fileBase64) {
      return res.status(400).json({
        success: false,
        code: 'CW_IMAGE_DATA_REQUIRED',
        message: 'fileBase64 is required',
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
    const mappedImages = Array.isArray(mapped.byItemCode?.[itemCode])
      ? mapped.byItemCode[itemCode]
      : [];
    let mapping = mapped.lineMappingByItemCode?.[itemCode] || null;

    if (!mapping?.lineId && explicitOrderlineId) {
      const explicitLine =
        (orderImages.lines || []).find(line => line.lineId === explicitOrderlineId) || null;
      if (explicitLine) {
        mapping = {
          lineId: explicitLine.lineId,
          productName: explicitLine.productName,
        };
      }
    }

    if (!mapping?.lineId) {
      const singleLine =
        Array.isArray(orderImages.lines) && orderImages.lines.length === 1
          ? orderImages.lines[0]
          : null;
      if (singleLine?.lineId) {
        mapping = {
          lineId: singleLine.lineId,
          productName: singleLine.productName,
        };
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

    const desiredIndexRaw = Number.parseInt(body?.fileIndex, 10);
    const desiredIndex =
      Number.isFinite(desiredIndexRaw) && desiredIndexRaw >= 1 && desiredIndexRaw <= 6
        ? desiredIndexRaw
        : null;
    const used = usedIndexes(mappedImages);
    const isReplacement = desiredIndex !== null && used.has(desiredIndex);

    if (mappedImages.length >= 6 && !isReplacement) {
      return res.status(409).json({
        success: false,
        code: 'CW_IMAGE_LIMIT_REACHED',
        message: `Item code '${itemCode}' already has 6 images. Choose an existing slot index (1-6) to replace.`,
        itemCode,
        imageCount: mappedImages.length,
      });
    }

    const uploadIndex = desiredIndex !== null ? desiredIndex : nextAvailableIndex(mappedImages);

    if (!uploadIndex) {
      return res.status(409).json({
        success: false,
        code: 'CW_IMAGE_SLOT_UNAVAILABLE',
        message: `No available upload index found for item code '${itemCode}'.`,
        itemCode,
      });
    }

    const uploadResult = await uploadOrderImage({
      formId,
      override,
      orderReference: body?.orderReference || `CW-${formId}`,
      orderlineId: mapping.lineId,
      fileIndex: uploadIndex,
      fileName,
      mimeType,
      fileBase64,
      photoType: body?.photoType || 'sofa_photos',
      accountType: body?.accountType || 'customer',
      lang,
    });

    return res.status(uploadResult.ok ? 200 : 502).json({
      success: uploadResult.ok,
      code: uploadResult.ok ? 'CW_IMAGE_UPLOAD_OK' : 'CW_IMAGE_UPLOAD_FAILED',
      formId,
      itemCode,
      durationMs: Date.now() - startedAt,
      upload: {
        targetUrl: uploadResult.targetUrl,
        upstreamStatus: uploadResult.status,
        fileIndex: uploadIndex,
        orderlineId: mapping.lineId,
        productName: mapping.productName,
      },
      session: uploadResult.session,
      upstreamBody: uploadResult.body,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      code: error?.code || 'CW_IMAGE_UPLOAD_ERROR',
      message: error?.message || 'Failed to upload image to CW',
      details: error?.details || null,
      formId,
      durationMs: Date.now() - startedAt,
    });
  }
}
