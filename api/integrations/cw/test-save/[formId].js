import {
  analyzeMeasureFormPayload,
  buildFormSavePayloadFromFetched,
  fetchCwMeasurementsTable,
  readJsonBody,
  submitCwMeasureForm,
} from '../_shared.js';

function extractMeasurementState(upstreamBody) {
  const formConfirmed =
    upstreamBody?.content?.form?.fields?.confirmed ??
    upstreamBody?.content?.confirmed ??
    upstreamBody?.content?.form_data?.confirmed ??
    null;

  const orderLines = Array.isArray(upstreamBody?.data?.orderUpdate?.order?.lines)
    ? upstreamBody.data.orderUpdate.order.lines
    : [];
  const hasOrderLines = orderLines.length > 0;
  const anyLineMeasurementSubmitted = hasOrderLines
    ? orderLines.some(line => Boolean(line?.measurementSubmitted))
    : null;
  const allLineMeasurementSubmitted = hasOrderLines
    ? orderLines.every(line => Boolean(line?.measurementSubmitted))
    : null;

  return {
    formConfirmed,
    anyLineMeasurementSubmitted,
    allLineMeasurementSubmitted,
  };
}

export default async function handler(req, res) {
  const startedAt = Date.now();

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const formId = String(req.query?.formId || '').trim();
  if (!formId) {
    return res.status(400).json({
      success: false,
      code: 'CW_FORM_ID_REQUIRED',
      message: 'formId is required',
    });
  }

  try {
    const body = await readJsonBody(req);
    const autoConfirm = body?.autoConfirm !== false;
    const lang = String(body?.lang || 'en').trim() || 'en';
    const override = {
      baseUrl: body?.baseUrl,
      username: body?.username,
      password: body?.password,
    };

    const payload = body?.payload || body || {};

    const result = await submitCwMeasureForm({
      formId,
      payload,
      override,
    });

    let validation = null;
    let confirmSync = null;
    if (result.ok && result.requestType === 'measure-form') {
      validation = analyzeMeasureFormPayload(payload);
      if (autoConfirm) {
        const desiredConfirmed = Boolean(validation.canConfirm);
        try {
          const fetched = await fetchCwMeasurementsTable({ formId, lang, override });
          if (!fetched.ok) {
            confirmSync = {
              attempted: true,
              ok: false,
              desiredConfirmed,
              reason: 'FETCH_FAILED',
              fetchStatus: fetched.status,
            };
          } else {
            const formSavePayload = buildFormSavePayloadFromFetched({
              formId,
              fetchedContent: fetched.content,
              confirmed: desiredConfirmed,
              employeeName: payload?.employeeName,
              user: payload?.user,
              lang,
            });

            const confirmResult = await submitCwMeasureForm({
              formId,
              payload: formSavePayload,
              override,
            });

            confirmSync = {
              attempted: true,
              ok: Boolean(confirmResult.ok),
              desiredConfirmed,
              requestType: confirmResult.requestType,
              upstreamStatus: confirmResult.status,
              upstreamBusinessStatus: confirmResult.businessStatus,
            };
          }
        } catch (confirmError) {
          confirmSync = {
            attempted: true,
            ok: false,
            desiredConfirmed,
            reason: 'CONFIRM_SYNC_ERROR',
            error: confirmError?.message || 'Unknown confirm sync error',
          };
        }
      }
    }

    const isBusinessError = !result.ok && result.status >= 200 && result.status < 300;

    return res.status(result.ok ? 200 : isBusinessError ? 422 : 502).json({
      success: result.ok,
      code: result.ok
        ? 'CW_SUBMIT_OK'
        : isBusinessError
          ? 'CW_SUBMIT_REJECTED'
          : 'CW_SUBMIT_FAILED',
      formId,
      durationMs: Date.now() - startedAt,
      requestType: result.requestType,
      targetUrl: result.targetUrl,
      upstreamStatus: result.status,
      upstreamBusinessStatus: result.businessStatus,
      measurementState: extractMeasurementState(result.body),
      validation,
      confirmSync,
      session: result.session,
      upstreamBody: result.body,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      code: error?.code || 'CW_INTEGRATION_ERROR',
      message: error?.message || 'CW integration failed',
      details: error?.details || null,
      formId,
      durationMs: Date.now() - startedAt,
    });
  }
}
