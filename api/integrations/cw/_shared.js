function parseSetCookie(setCookieHeaders = []) {
  const jar = {};
  setCookieHeaders.forEach(value => {
    if (!value || typeof value !== 'string') return;
    const first = value.split(';')[0] || '';
    const eq = first.indexOf('=');
    if (eq <= 0) return;
    const name = first.slice(0, eq).trim();
    const cookieValue = first.slice(eq + 1).trim();
    if (!name) return;
    jar[name] = cookieValue;
  });
  return jar;
}

function mergeCookieJar(target, incoming) {
  Object.entries(incoming || {}).forEach(([key, value]) => {
    target[key] = value;
  });
  return target;
}

function buildCookieHeader(jar) {
  return Object.entries(jar || {})
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

function getSetCookieArray(headers) {
  if (!headers) return [];
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const single = headers.get?.('set-cookie');
  return single ? [single] : [];
}

export async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  await new Promise((resolve, reject) => {
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', resolve);
    req.on('error', reject);
  });
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function getCwCredentials(override = {}) {
  const baseUrl = (
    override.baseUrl ||
    process.env.CW_BASE_URL ||
    'https://cw40.comfort-works.com'
  ).trim();
  const username = (override.username || process.env.CW_USERNAME || '').trim();
  const password = (override.password || process.env.CW_PASSWORD || '').trim();
  return { baseUrl, username, password };
}

export async function createCwSession(override = {}) {
  const creds = getCwCredentials(override);
  if (!creds.username || !creds.password) {
    const err = new Error('Missing CW credentials (username/password)');
    err.code = 'CW_MISSING_CREDENTIALS';
    throw err;
  }

  const loginUrl = `${creds.baseUrl.replace(/\/+$/, '')}/dashboard/login/`;
  const cookieJar = {};

  const loginPage = await fetch(loginUrl, {
    method: 'GET',
    redirect: 'manual',
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'user-agent': 'OpenPaint-CW-Vercel/1.0',
    },
  });

  mergeCookieJar(cookieJar, parseSetCookie(getSetCookieArray(loginPage.headers)));
  const csrfToken = cookieJar.csrftoken;
  if (!csrfToken) {
    const err = new Error('Failed to fetch CSRF token from CW login page');
    err.code = 'CW_CSRF_MISSING';
    throw err;
  }

  const form = new URLSearchParams();
  form.set('csrfmiddlewaretoken', csrfToken);
  form.set('username', creds.username);
  form.set('password', creds.password);
  form.set('next', '');

  const loginRes = await fetch(loginUrl, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'content-type': 'application/x-www-form-urlencoded',
      cookie: buildCookieHeader(cookieJar),
      origin: creds.baseUrl,
      referer: loginUrl,
      'user-agent': 'OpenPaint-CW-Vercel/1.0',
    },
    body: form.toString(),
  });

  mergeCookieJar(cookieJar, parseSetCookie(getSetCookieArray(loginRes.headers)));
  const isRedirect = loginRes.status === 301 || loginRes.status === 302;
  const hasSessionId = Boolean(cookieJar.sessionid);

  if (!isRedirect || !hasSessionId) {
    const bodySnippet = (await loginRes.text().catch(() => '')).slice(0, 500);
    const err = new Error('CW login failed');
    err.code = 'CW_LOGIN_FAILED';
    err.details = {
      status: loginRes.status,
      location: loginRes.headers.get('location') || '',
      hasSessionId,
      bodySnippet,
    };
    throw err;
  }

  return {
    baseUrl: creds.baseUrl,
    csrfToken: cookieJar.csrftoken || csrfToken,
    cookieJar,
    loginStatus: loginRes.status,
    loginLocation: loginRes.headers.get('location') || '',
  };
}

function toOrderGlobalId(formId) {
  return Buffer.from(`Order:${String(formId)}`).toString('base64');
}

export async function cwGraphqlRequest({ override = {}, operationName, query, variables = {} }) {
  const session = await createCwSession(override);
  const targetUrl = `${session.baseUrl.replace(/\/+$/, '')}/api/`;
  const payload = { operationName, query, variables };
  const response = await fetch(targetUrl, {
    method: 'POST',
    headers: {
      accept: '*/*',
      'content-type': 'application/json',
      cookie: buildCookieHeader(session.cookieJar),
      origin: session.baseUrl,
      referer: `${session.baseUrl.replace(/\/+$/, '')}/dashboard/`,
      'x-csrftoken': session.csrfToken,
      'x-requested-with': 'XMLHttpRequest',
      'user-agent': 'OpenPaint-CW-Vercel/1.0',
    },
    body: JSON.stringify(payload),
  });

  const rawText = await response.text().catch(() => '');
  let body = null;
  try {
    body = rawText ? JSON.parse(rawText) : null;
  } catch {
    body = rawText;
  }

  const gqlErrors = Array.isArray(body?.errors) ? body.errors : [];
  return {
    ok: response.ok && gqlErrors.length === 0,
    status: response.status,
    targetUrl,
    body,
    session: {
      loginStatus: session.loginStatus,
      loginLocation: session.loginLocation,
      hasSessionId: Boolean(session.cookieJar.sessionid),
    },
  };
}

export async function fetchOrderImagesByFormId({ formId, override = {} }) {
  const operationName = 'orderWithImages';
  const query = `query orderWithImages($id: ID!) {
  order(id: $id) {
    id
    reference
    lines {
      id
      productName
      translatedProductName
      images {
        edges {
          node {
            imagePath
            index
            __typename
          }
          __typename
        }
        __typename
      }
      __typename
    }
    __typename
  }
}`;
  const variables = { id: toOrderGlobalId(formId) };
  const gql = await cwGraphqlRequest({ override, operationName, query, variables });
  const order = gql.body?.data?.order || null;
  const lines = Array.isArray(order?.lines) ? order.lines : [];

  const normalizedLines = lines.map(line => ({
    lineId: line.id,
    productName: line.productName || line.translatedProductName || '',
    images: Array.isArray(line?.images?.edges)
      ? line.images.edges
          .map(edge => edge?.node)
          .filter(Boolean)
          .map(node => ({
            imagePath: node.imagePath,
            index: node.index,
          }))
      : [],
  }));

  return {
    ...gql,
    order: order
      ? {
          id: order.id,
          reference: order.reference,
        }
      : null,
    lines: normalizedLines,
  };
}

function normalizeName(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenize(input) {
  return normalizeName(input)
    .split(' ')
    .map(part => part.trim())
    .filter(part => part.length >= 2);
}

function scoreNameMatch(product, line) {
  const candidates = [product?.name, product?.label, product?.reference]
    .flat()
    .filter(Boolean)
    .map(value => String(value));
  const lineName = String(line?.productName || '');
  const lineNorm = normalizeName(lineName);

  let score = 0;
  candidates.forEach(candidate => {
    const candNorm = normalizeName(candidate);
    if (!candNorm) return;
    if (candNorm === lineNorm) score += 100;
    if (lineNorm.includes(candNorm)) score += 30;
    if (candNorm.includes(lineNorm)) score += 10;

    const candTokens = tokenize(candNorm);
    const lineTokens = new Set(tokenize(lineNorm));
    let overlap = 0;
    candTokens.forEach(token => {
      if (lineTokens.has(token)) overlap += 1;
    });
    score += overlap * 8;
  });
  return score;
}

export function mapOrderImagesToMeasurementItems(measurementsContent, orderLines) {
  const products = Array.isArray(measurementsContent?.products)
    ? measurementsContent.products
    : Array.isArray(measurementsContent?.products_list)
      ? measurementsContent.products_list
      : [];
  const lines = Array.isArray(orderLines) ? orderLines : [];

  const byItemCode = {};
  const lineMappingByItemCode = {};
  const matchedLineIds = new Set();

  products.forEach(product => {
    const code = product.reference || product.name || product.label;
    const productIndex = products.indexOf(product);
    let bestLine = null;
    let bestScore = -1;

    lines.forEach(line => {
      if (matchedLineIds.has(line.lineId)) return;
      const score = scoreNameMatch(product, line);
      if (score > bestScore) {
        bestScore = score;
        bestLine = line;
      }
    });

    let line = bestScore >= 8 ? bestLine : null;

    // Fallback mapping: one line/one product or index-based mapping when counts align.
    if (!line) {
      if (lines.length === 1 && !matchedLineIds.has(lines[0].lineId)) {
        line = lines[0];
      } else if (lines.length === products.length) {
        const byIndex = lines[productIndex];
        if (byIndex && !matchedLineIds.has(byIndex.lineId)) {
          line = byIndex;
        }
      }
    }

    if (line?.lineId) matchedLineIds.add(line.lineId);
    const images = line?.images || [];
    byItemCode[code] = images.slice(0, 6);
    lineMappingByItemCode[code] = line
      ? {
          lineId: line.lineId,
          productName: line.productName,
        }
      : null;
  });

  const unmatched = lines.filter(line => !matchedLineIds.has(line.lineId));

  return { byItemCode, lineMappingByItemCode, unmatchedLines: unmatched };
}

function normalizeBase64(input) {
  const text = String(input || '').trim();
  if (!text) return '';
  const marker = 'base64,';
  const idx = text.indexOf(marker);
  if (idx >= 0) return text.slice(idx + marker.length).trim();
  return text;
}

export async function uploadOrderImage({
  formId,
  override = {},
  orderReference,
  orderlineId,
  fileIndex,
  fileName,
  mimeType,
  fileBase64,
  photoType = 'sofa_photos',
  accountType = 'customer',
  lang = 'en',
}) {
  const session = await createCwSession(override);
  const targetUrl = `${session.baseUrl.replace(/\/+$/, '')}/${encodeURIComponent(lang)}/my-account/uploadphotos`;

  const cleanBase64 = normalizeBase64(fileBase64);
  if (!cleanBase64) {
    const err = new Error('fileBase64 is required');
    err.code = 'CW_IMAGE_MISSING_FILE';
    throw err;
  }

  const bytes = Buffer.from(cleanBase64, 'base64');
  const blob = new Blob([bytes], { type: mimeType || 'application/octet-stream' });
  const form = new FormData();
  form.append('product_photo', blob, fileName || 'upload.jpg');
  form.append('order_reference', String(orderReference || `CW-${formId}`));
  form.append('orderline_id', String(orderlineId || ''));
  form.append('file_index', String(fileIndex || 1));
  form.append('photo_type', String(photoType || 'sofa_photos'));
  form.append('account_type', String(accountType || 'customer'));

  const response = await fetch(targetUrl, {
    method: 'POST',
    headers: {
      accept: '*/*',
      cookie: buildCookieHeader(session.cookieJar),
      origin: session.baseUrl,
      referer: `${session.baseUrl.replace(/\/+$/, '')}/dashboard/`,
      'x-csrftoken': session.csrfToken,
      'x-requested-with': 'XMLHttpRequest',
      'user-agent': 'OpenPaint-CW-Vercel/1.0',
    },
    body: form,
  });

  const rawText = await response.text().catch(() => '');
  let body = null;
  try {
    body = rawText ? JSON.parse(rawText) : null;
  } catch {
    body = rawText;
  }

  const businessOk = Boolean(body?.is_valid);
  return {
    ok: response.ok && businessOk,
    status: response.status,
    targetUrl,
    body,
    session: {
      loginStatus: session.loginStatus,
      loginLocation: session.loginLocation,
      hasSessionId: Boolean(session.cookieJar.sessionid),
    },
  };
}

export async function deleteOrderImage({
  formId,
  override = {},
  orderReference,
  orderlineId,
  fileIndex,
  photoType = 'sofa_photos',
  accountType = 'customer',
  lang = 'en',
}) {
  const session = await createCwSession(override);
  const base = `${session.baseUrl.replace(/\/+$/, '')}`;
  const candidateUrls = [
    // Verified by user capture
    `${base}/dashboard/order/photo-delete`,
    // Legacy fallbacks
    `${base}/${encodeURIComponent(lang)}/my-account/deletephoto`,
    `${base}/${encodeURIComponent(lang)}/my-account/deletephotos`,
    `${base}/${encodeURIComponent(lang)}/my-account/removephoto`,
    `${base}/${encodeURIComponent(lang)}/my-account/removephotos`,
  ];

  const buildForm = () => {
    const form = new FormData();
    form.append('order_reference', String(orderReference || `CW-${formId}`));
    form.append('orderline_id', String(orderlineId || ''));
    form.append('file_index', String(fileIndex || 1));
    form.append('photo_type', String(photoType || 'sofa_photos'));
    form.append('account_type', String(accountType || 'customer'));
    return form;
  };

  const attempts = [];
  for (const targetUrl of candidateUrls) {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        accept: '*/*',
        cookie: buildCookieHeader(session.cookieJar),
        origin: session.baseUrl,
        referer: `${session.baseUrl.replace(/\/+$/, '')}/dashboard/`,
        'x-csrftoken': session.csrfToken,
        'x-requested-with': 'XMLHttpRequest',
        'user-agent': 'OpenPaint-CW-Vercel/1.0',
      },
      body: buildForm(),
    });

    const rawText = await response.text().catch(() => '');
    let body = null;
    try {
      body = rawText ? JSON.parse(rawText) : null;
    } catch {
      body = rawText;
    }

    attempts.push({
      targetUrl,
      status: response.status,
      body,
    });

    if (
      response.ok &&
      (body?.is_valid === true || body?.status === 'success' || body?.status === 'ok')
    ) {
      return {
        ok: true,
        status: response.status,
        targetUrl,
        body,
        attempts,
        session: {
          loginStatus: session.loginStatus,
          loginLocation: session.loginLocation,
          hasSessionId: Boolean(session.cookieJar.sessionid),
        },
      };
    }
  }

  return {
    ok: false,
    status: attempts[attempts.length - 1]?.status || 500,
    targetUrl: attempts[attempts.length - 1]?.targetUrl || `${base}/deletephoto`,
    body: attempts[attempts.length - 1]?.body || null,
    attempts,
    session: {
      loginStatus: session.loginStatus,
      loginLocation: session.loginLocation,
      hasSessionId: Boolean(session.cookieJar.sessionid),
    },
  };
}

export async function submitCwMeasureForm({ formId, payload = {}, override = {} }) {
  const session = await createCwSession(override);
  const isFormSavePayload =
    Boolean(payload && typeof payload === 'object') &&
    (Boolean(payload.form_data && typeof payload.form_data === 'object') ||
      typeof payload.postdata === 'string');
  const isGraphqlPayload =
    !isFormSavePayload &&
    Boolean(payload && typeof payload === 'object') &&
    (typeof payload.query === 'string' || typeof payload.operationName === 'string');

  const targetUrl = isGraphqlPayload
    ? `${session.baseUrl.replace(/\/+$/, '')}/api/`
    : isFormSavePayload
      ? `${session.baseUrl.replace(/\/+$/, '')}/order-management/measure-tool/form/save/`
      : `${session.baseUrl.replace(/\/+$/, '')}/order-management/measure-tool/measure-form/save-measure-form/${encodeURIComponent(formId)}/`;

  let requestBody;
  let contentType;
  if (isGraphqlPayload) {
    requestBody = JSON.stringify(payload);
    contentType = 'application/json';
  } else if (isFormSavePayload) {
    const form = new FormData();
    const postdata =
      typeof payload.postdata === 'string'
        ? payload.postdata
        : JSON.stringify({ form_data: payload.form_data || {} });
    form.append('postdata', postdata);
    requestBody = form;
    contentType = null;
  } else {
    const legacyBody = {
      ...(payload && typeof payload === 'object' ? payload : {}),
      form_ID: String(payload?.form_ID || formId),
    };
    requestBody = JSON.stringify(legacyBody);
    contentType = 'text/plain;charset=UTF-8';
  }

  const headers = {
    accept: '*/*',
    cookie: buildCookieHeader(session.cookieJar),
    origin: session.baseUrl,
    referer: `${session.baseUrl.replace(/\/+$/, '')}/dashboard/`,
    'x-csrftoken': session.csrfToken,
    'x-requested-with': 'XMLHttpRequest',
    'user-agent': 'OpenPaint-CW-Vercel/1.0',
  };
  if (contentType) headers['content-type'] = contentType;

  const upstreamRes = await fetch(targetUrl, {
    method: 'POST',
    headers,
    body: requestBody,
  });

  const rawText = await upstreamRes.text().catch(() => '');
  let parsedBody = null;
  try {
    parsedBody = rawText ? JSON.parse(rawText) : null;
  } catch {
    parsedBody = null;
  }

  const bodyValue = parsedBody || rawText;
  let businessStatus = '';
  let businessOk = true;

  if (isGraphqlPayload) {
    const gqlErrors = Array.isArray(bodyValue?.errors) ? bodyValue.errors : [];
    const orderUpdateErrors = Array.isArray(bodyValue?.data?.orderUpdate?.errors)
      ? bodyValue.data.orderUpdate.errors
      : [];
    businessOk = gqlErrors.length === 0 && orderUpdateErrors.length === 0;
    businessStatus = businessOk ? 'success' : 'error';
  } else {
    businessStatus =
      bodyValue && typeof bodyValue === 'object'
        ? String(
            bodyValue?.status ||
              bodyValue?.content?.status ||
              bodyValue?.content?.content?.status ||
              ''
          ).toLowerCase()
        : '';
    businessOk = businessStatus ? businessStatus === 'success' || businessStatus === 'ok' : true;
  }

  return {
    ok: upstreamRes.ok && businessOk,
    status: upstreamRes.status,
    requestType: isGraphqlPayload ? 'graphql' : isFormSavePayload ? 'form-save' : 'measure-form',
    targetUrl,
    businessStatus: businessStatus || null,
    body: bodyValue,
    session: {
      loginStatus: session.loginStatus,
      loginLocation: session.loginLocation,
      hasSessionId: Boolean(session.cookieJar.sessionid),
    },
  };
}

function toNumber(value) {
  if (value === null || value === undefined) return NaN;
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  const normalized = String(value).trim();
  if (!normalized || normalized === '-') return NaN;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function buildRuleContext(model) {
  const ctx = {
    abs: Math.abs,
    min: Math.min,
    max: Math.max,
    pow: Math.pow,
    round: Math.round,
  };
  const files = Array.isArray(model?.files) ? model.files : [];
  files.forEach(file => {
    Object.entries(file?.field_data || {}).forEach(([key, raw]) => {
      ctx[key] = toNumber(raw);
    });
  });
  return ctx;
}

function evaluateRuleExpression(expression, context) {
  if (!expression || typeof expression !== 'string') return false;
  try {
    const keys = Object.keys(context);
    const values = keys.map(key => context[key]);
    const fn = new Function(...keys, `return Boolean(${expression});`);
    return Boolean(fn(...values));
  } catch {
    return false;
  }
}

export function analyzeMeasureFormPayload(payload) {
  const products = Array.isArray(payload?.products) ? payload.products : [];
  const issues = [];
  const missingFields = [];

  products.forEach(product => {
    const modelList = Array.isArray(product?.model_list) ? product.model_list : [];
    modelList.forEach(model => {
      const files = Array.isArray(model?.files) ? model.files : [];
      const rulesByField = model?.rules && typeof model.rules === 'object' ? model.rules : {};
      const context = buildRuleContext(model);

      files.forEach(file => {
        Object.entries(file?.field_data || {}).forEach(([fieldKey, fieldValue]) => {
          const raw =
            fieldValue === null || fieldValue === undefined ? '' : String(fieldValue).trim();
          if (raw === '') {
            missingFields.push({
              reference: product?.reference || null,
              model: model?.name || null,
              file: file?.name || null,
              field: fieldKey,
            });
          }
        });
      });

      Object.entries(rulesByField).forEach(([fieldKey, ruleList]) => {
        if (!Array.isArray(ruleList)) return;
        ruleList.forEach(rule => {
          const expression = rule?.eval;
          const triggered = evaluateRuleExpression(expression, context);
          if (!triggered) return;
          issues.push({
            reference: product?.reference || null,
            model: model?.name || null,
            field: fieldKey,
            behaviour: String(rule?.behaviour || 'error').toLowerCase(),
            message: String(rule?.message || ''),
            eval: expression,
          });
        });
      });
    });
  });

  const errorCount = issues.filter(item => item.behaviour === 'error').length;
  const warningCount = issues.filter(item => item.behaviour === 'warning').length;
  const noticeCount = issues.filter(item => item.behaviour === 'notice').length;
  const blockingCount = errorCount + warningCount + missingFields.length;

  return {
    totals: {
      products: products.length,
      issues: issues.length,
      errorCount,
      warningCount,
      noticeCount,
      missingFieldCount: missingFields.length,
      blockingCount,
    },
    issues,
    missingFields,
    canConfirm: blockingCount === 0,
  };
}

export function buildFormSavePayloadFromFetched({
  formId,
  fetchedContent,
  confirmed,
  employeeName,
  user,
  lang = 'en',
}) {
  const products = Array.isArray(fetchedContent?.products)
    ? fetchedContent.products.map(product => ({
        reference: product.reference,
        name: product.name || product.label || '',
        enabled: product.enabled !== false,
        measurement_id: product.measurement_id || product.measurements_id,
        measurement_data: {
          model_list: Array.isArray(product?.measurement_data?.model_list)
            ? product.measurement_data.model_list
            : Array.isArray(product?.model_list)
              ? product.model_list
              : [],
        },
      }))
    : [];

  return {
    form_data: {
      id: Number(formId),
      products,
      confirmed: Boolean(confirmed),
      link: fetchedContent?.link || '',
      raw_link: fetchedContent?.raw_link || '',
      lang: fetchedContent?.lang || lang,
      user: user || 'Admin',
      employeeName: employeeName || 'OpenPaint Relay',
    },
  };
}

export function buildMeasureSavePayloadFromTable(tableContent, formId, defaults = {}) {
  const sourceProducts = Array.isArray(tableContent?.products_list)
    ? tableContent.products_list
    : Array.isArray(tableContent?.products)
      ? tableContent.products
      : [];

  const products = sourceProducts.map(product => {
    const sourceModelList = Array.isArray(product.model_list)
      ? product.model_list
      : Array.isArray(product.measurement_data?.model_list)
        ? product.measurement_data.model_list
        : [];

    return {
      form_product_ID: product.measurements_id || product.measurement_id,
      reference: product.reference,
      label: product.label || product.name,
      enabled: product.enabled !== false,
      model_list: sourceModelList.map(model => ({
        set_model_ID: model.set_model_ID,
        name: model.name,
        label: model.label,
        files: Array.isArray(model.files)
          ? model.files.map(file => ({
              name: file.name,
              label: file.label,
              field_data: file.field_data || {},
              quantity: file.quantity || 1,
            }))
          : [],
      })),
    };
  });

  return {
    form_ID: String(formId),
    employeeName: defaults.employeeName || 'OpenPaint Relay',
    user: defaults.user || 'Admin',
    unit: tableContent?.unit || defaults.unit || 'cm',
    products,
  };
}

export async function fetchCwMeasurementsTable({ formId, lang = 'en', override = {} }) {
  const session = await createCwSession(override);
  const targetUrl = `${session.baseUrl.replace(/\/+$/, '')}/order-management/measure-tool/form/${encodeURIComponent(formId)}/${encodeURIComponent(lang)}/get`;

  const res = await fetch(targetUrl, {
    method: 'GET',
    headers: {
      accept: 'application/json, text/plain, */*',
      cookie: buildCookieHeader(session.cookieJar),
      origin: session.baseUrl,
      referer: `${session.baseUrl.replace(/\/+$/, '')}/dashboard/`,
      'x-requested-with': 'XMLHttpRequest',
      'user-agent': 'OpenPaint-CW-Vercel/1.0',
    },
  });

  const rawText = await res.text().catch(() => '');
  let body = null;
  try {
    body = rawText ? JSON.parse(rawText) : null;
  } catch {
    body = rawText;
  }

  const apiStatus = Number(body?.status);
  const apiOk = Number.isFinite(apiStatus) ? apiStatus >= 200 && apiStatus < 300 : true;

  return {
    ok: res.ok && apiOk,
    status: res.status,
    targetUrl,
    body,
    content: body?.content || null,
    session: {
      loginStatus: session.loginStatus,
      loginLocation: session.loginLocation,
      hasSessionId: Boolean(session.cookieJar.sessionid),
    },
  };
}
