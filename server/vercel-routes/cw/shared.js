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

function extractCsrfFromHtml(html) {
  const source = String(html || '');
  if (!source) return '';

  const inputMatch = source.match(/name=["']csrfmiddlewaretoken["'][^>]*value=["']([^"']+)["']/i);
  if (inputMatch?.[1]) return String(inputMatch[1]).trim();

  const reverseInputMatch = source.match(
    /value=["']([^"']+)["'][^>]*name=["']csrfmiddlewaretoken["']/i
  );
  if (reverseInputMatch?.[1]) return String(reverseInputMatch[1]).trim();

  return '';
}

function isRedirectStatus(status) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function resolveUrl(base, location) {
  try {
    return new URL(String(location || ''), String(base || '')).toString();
  } catch {
    return '';
  }
}

const DEFAULT_FETCH_TIMEOUT_MS =
  Number.parseInt(process.env.CW_FETCH_TIMEOUT_MS || '', 10) || 12000;

function createFetchTimeoutError(url, timeoutMs, label = '') {
  const err = new Error(`Upstream request timed out after ${timeoutMs}ms`);
  err.code = 'CW_UPSTREAM_TIMEOUT';
  err.details = {
    url,
    timeoutMs,
    label: String(label || ''),
  };
  return err;
}

async function fetchWithTimeout(url, options = {}, config = {}) {
  const timeoutMs = Number.isFinite(Number(config.timeoutMs))
    ? Math.max(1000, Number(config.timeoutMs))
    : DEFAULT_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...(options || {}),
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw createFetchTimeoutError(url, timeoutMs, config.label);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
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

const DEFAULT_CW_BASE_URL = 'https://cw40.comfort-works.com';
const DEFAULT_CW_PID_BASE_URL = 'https://cw-pid-qylyewlgca-uc.a.run.app';

function toOrigin(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : '';
  } catch {
    return '';
  }
}

// Client-supplied base URLs may only point at the configured CW hosts. Without this,
// a caller could redirect the server's CW login (and env credentials) to any host.
function resolveAllowedOrigin(candidate, configured, fallback, code) {
  const defaultOrigin = toOrigin(configured) || fallback;
  const raw = String(candidate || '').trim();
  if (!raw) return defaultOrigin;
  const origin = toOrigin(raw);
  if (origin && (origin === defaultOrigin || origin === fallback)) return origin;
  const err = new Error('Base URL is not an allowed CW host');
  err.code = code;
  err.status = 400;
  throw err;
}

export function resolveCwBaseUrl(candidate) {
  return resolveAllowedOrigin(
    candidate,
    process.env.CW_BASE_URL,
    DEFAULT_CW_BASE_URL,
    'CW_BASE_URL_NOT_ALLOWED'
  );
}

export function resolveCwPidBaseUrl(candidate) {
  return resolveAllowedOrigin(
    candidate,
    process.env.CW_PID_BASE_URL,
    DEFAULT_CW_PID_BASE_URL,
    'CW_PID_BASE_URL_NOT_ALLOWED'
  );
}

export function isCwSessionUrl(session, url) {
  return Boolean(session?.baseUrl) && toOrigin(url) === toOrigin(session.baseUrl);
}

export function getCwCredentials(override = {}) {
  const baseUrl = resolveCwBaseUrl(override.baseUrl);
  const username = (override.username || process.env.CW_USERNAME || '').trim();
  const password = (override.password || process.env.CW_PASSWORD || '').trim();
  return { baseUrl, username, password };
}

export function escapeGraphqlString(value) {
  return JSON.stringify(String(value || ''));
}

function getTranslateableValue(source, preferredLangs = ['en', 'UN']) {
  if (!source) return '';
  if (typeof source === 'string') return String(source).trim();
  const translateable = source?._translateable;
  if (translateable && typeof translateable === 'object') {
    for (const lang of preferredLangs) {
      const value = String(translateable?.[lang] || '').trim();
      if (value) return value;
    }
    for (const value of Object.values(translateable)) {
      const next = String(value || '').trim();
      if (next) return next;
    }
  }
  return '';
}

function looksLikePlaceholderOption(label, code) {
  const labelNorm = String(label || '')
    .trim()
    .toLowerCase();
  const codeNorm = String(code || '')
    .trim()
    .toUpperCase();
  if (!labelNorm && !codeNorm) return true;
  return (
    labelNorm === 'please select one' ||
    labelNorm === 'please select' ||
    labelNorm === 'select an option'
  );
}

function looksLikeVersionCode(code) {
  const normalized = String(code || '')
    .trim()
    .toUpperCase();
  if (!normalized) return false;
  if (/^(?:DF|STD|EXD|SV|LV|PB|MG|PTD|L|R)$/.test(normalized)) return true;
  if (/^[A-Z0-9]{1,6}(?:-[A-Z0-9]{1,6})+$/.test(normalized)) return true;
  return false;
}

function classifyConfigurationGroup(group = {}) {
  const labelPool = [
    getTranslateableValue(group?.name),
    getTranslateableValue(group?.popupTitle),
    getTranslateableValue(group?.popupContent),
    String(group?.printing?.field || '').trim(),
    String(group?.group_name || '').trim(),
  ]
    .join(' ')
    .toLowerCase();

  const options = Array.isArray(group?.content) ? group.content : [];
  const optionLabels = options
    .map(option => getTranslateableValue(option?.name))
    .join(' ')
    .toLowerCase();
  const optionCodes = options
    .map(option =>
      String(option?.pg_code || option?.code || '')
        .trim()
        .toUpperCase()
    )
    .filter(Boolean)
    .join(' ');
  const hasStyleCode = /\b(?:CNRP|SHRT|LSKT|MLTP|VELC|BKPT|SDPT|ELAS|SP|SI|PC|PM|WR)\b/.test(
    optionCodes
  );
  const hasVersionCode = options.some(option =>
    looksLikeVersionCode(option?.pg_code || option?.code || '')
  );

  if (
    /style/.test(labelPool) ||
    (hasVersionCode ? /signature/.test(optionLabels) : /signature|original/.test(optionLabels)) ||
    hasStyleCode
  ) {
    return 'style';
  }

  if (
    /version|sofa type|sofa version|my sofa is/.test(labelPool) ||
    /leather version|standard version/.test(optionLabels) ||
    hasVersionCode
  ) {
    return 'version';
  }

  if (/fabric/.test(labelPool)) return 'fabric';
  return 'other';
}

export function parseProductConfiguration({
  productConfiguration,
  productReference = '',
  productName = '',
} = {}) {
  let parsed = null;
  if (productConfiguration && typeof productConfiguration === 'object') {
    parsed = productConfiguration;
  } else if (typeof productConfiguration === 'string') {
    try {
      parsed = JSON.parse(productConfiguration);
    } catch {
      parsed = null;
    }
  }

  const normalizedReference = String(productReference || parsed?.reference || '').trim();
  const normalizedName = String(productName || '').trim();
  if (!parsed || typeof parsed !== 'object') {
    return {
      productReference: normalizedReference,
      productName: normalizedName,
      raw: productConfiguration || null,
      parsed: false,
      versionOptions: [],
      styleOptions: [],
      derivedScopedReferences: [],
    };
  }

  const versionDimensions = [];
  const styleOptionMap = new Map();
  const groups = Array.isArray(parsed?.groups) ? parsed.groups : [];

  groups.forEach(group => {
    const groupKind = classifyConfigurationGroup(group);
    const content = Array.isArray(group?.content) ? group.content : [];

    if (groupKind === 'version') {
      const defaultVersionCode = String(
        group?.default_value?.code ||
          group?.default_value?.pg_code ||
          group?.default_value_on?.code ||
          group?.default_value_on?.pg_code ||
          ''
      )
        .trim()
        .toUpperCase();
      const dimensionOptions = [];
      const dimensionSeen = new Set();
      content.forEach(option => {
        const label = getTranslateableValue(option?.name);
        const code = String(option?.code || option?.pg_code || '')
          .trim()
          .toUpperCase();
        if (looksLikePlaceholderOption(label, code)) return;
        const key = `${code}|${String(label || code || '')
          .trim()
          .toLowerCase()}`;
        if (dimensionSeen.has(key)) return;
        dimensionSeen.add(key);
        dimensionOptions.push({
          code,
          label: label || code || 'Default',
          isDefault: Boolean(defaultVersionCode && code === defaultVersionCode),
          source: 'cw40-product-configuration',
        });
      });
      if (dimensionOptions.length) {
        versionDimensions.push(dimensionOptions);
      }
    }

    if (groupKind === 'style') {
      content.forEach(option => {
        const style = getTranslateableValue(option?.name);
        const styleCode = String(option?.pg_code || option?.code || '')
          .trim()
          .toUpperCase();
        if (looksLikePlaceholderOption(style, styleCode)) return;
        const key = `${style.toLowerCase()}|${styleCode.toLowerCase()}`;
        if (styleOptionMap.has(key)) return;
        styleOptionMap.set(key, {
          productReference: normalizedReference,
          style: style || styleCode || 'Style',
          styleCode,
          label: `${normalizedReference || 'Reference'} - ${style || styleCode || 'Style'}${styleCode ? ` (${styleCode})` : ''}`,
          source: 'cw40-product-configuration',
        });
      });
    }
  });

  const versionOptionMap = new Map();
  if (versionDimensions.length > 0) {
    let combinations = [{ codes: [], labels: [], isDefault: true }];
    versionDimensions.forEach(dimension => {
      const next = [];
      combinations.forEach(combo => {
        dimension.forEach(option => {
          next.push({
            codes: [...combo.codes, option.code],
            labels: [...combo.labels, option.label],
            isDefault: combo.isDefault && option.isDefault === true,
          });
        });
      });
      combinations = next;
    });

    combinations.forEach(combo => {
      const code = combo.codes.filter(Boolean).join('__');
      if (!code) return;
      const scopedReference =
        normalizedReference && code ? `${normalizedReference}__${code}` : normalizedReference;
      const key = `${code}|${scopedReference}`;
      if (versionOptionMap.has(key)) return;
      versionOptionMap.set(key, {
        code,
        label: combo.labels.filter(Boolean).join(' / ') || code || 'Default',
        scopedReference,
        isDefault: combo.isDefault === true,
        source: 'cw40-product-configuration',
      });
    });
  }

  return {
    productReference: normalizedReference,
    productName: normalizedName,
    raw: parsed,
    parsed: true,
    versionOptions: Array.from(versionOptionMap.values()),
    styleOptions: Array.from(styleOptionMap.values()),
    derivedScopedReferences: Array.from(
      new Set(
        Array.from(versionOptionMap.values())
          .map(option => String(option?.scopedReference || '').trim())
          .filter(Boolean)
      )
    ),
  };
}

export async function cwPublicGraphqlRequest({
  baseUrl,
  operationName = 'null',
  query,
  variables = null,
}) {
  const targetBase = resolveCwBaseUrl(baseUrl);
  const params = new URLSearchParams();
  params.set('operationName', String(operationName || 'null'));
  params.set('query', String(query || '').trim());
  if (variables && typeof variables === 'object' && Object.keys(variables).length > 0) {
    params.set('variables', JSON.stringify(variables));
  }
  const targetUrl = `${targetBase}/api/?${params.toString()}`;
  const response = await fetchWithTimeout(
    targetUrl,
    {
      method: 'GET',
      headers: {
        accept: 'application/json, text/plain, */*',
        'user-agent': 'OpenPaint-CW-Vercel/1.0',
      },
    },
    { label: 'cwPublicGraphqlRequest' }
  );

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
  };
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
  const redirectChain = [];

  const baseGetHeaders = {
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'user-agent': 'OpenPaint-CW-Vercel/1.0',
  };

  let loginPageUrl = loginUrl;
  let loginPage = await fetchWithTimeout(
    loginPageUrl,
    {
      method: 'GET',
      redirect: 'manual',
      headers: baseGetHeaders,
    },
    { label: 'createCwSession.loginPage' }
  );

  mergeCookieJar(cookieJar, parseSetCookie(getSetCookieArray(loginPage.headers)));
  let loginPageHtml = await loginPage.text().catch(() => '');

  for (let hop = 0; hop < 5 && isRedirectStatus(loginPage.status); hop += 1) {
    const location = String(loginPage.headers.get('location') || '').trim();
    if (!location) break;

    const nextUrl = resolveUrl(loginPageUrl, location);
    // Credentials are posted to the final login URL, so never follow off-host redirects.
    if (!nextUrl || toOrigin(nextUrl) !== toOrigin(creds.baseUrl)) break;

    redirectChain.push({ from: loginPageUrl, status: loginPage.status, to: nextUrl });
    loginPageUrl = nextUrl;

    loginPage = await fetchWithTimeout(
      loginPageUrl,
      {
        method: 'GET',
        redirect: 'manual',
        headers: {
          ...baseGetHeaders,
          cookie: buildCookieHeader(cookieJar),
          referer: redirectChain[redirectChain.length - 1].from,
        },
      },
      { label: 'createCwSession.loginRedirect' }
    );

    mergeCookieJar(cookieJar, parseSetCookie(getSetCookieArray(loginPage.headers)));
    loginPageHtml = await loginPage.text().catch(() => '');
  }

  const csrfToken = cookieJar.csrftoken || extractCsrfFromHtml(loginPageHtml);
  if (!cookieJar.csrftoken && csrfToken) {
    cookieJar.csrftoken = csrfToken;
  }
  if (!csrfToken) {
    const err = new Error('Failed to fetch CSRF token from CW login page');
    err.code = 'CW_CSRF_MISSING';
    err.details = {
      loginUrl,
      finalLoginUrl: loginPageUrl,
      status: loginPage.status,
      location: loginPage.headers.get('location') || '',
      redirectChain,
      hasCookieCsrfToken: Boolean(cookieJar.csrftoken),
      bodySnippet: loginPageHtml.slice(0, 500),
    };
    throw err;
  }

  const form = new URLSearchParams();
  form.set('csrfmiddlewaretoken', csrfToken);
  form.set('username', creds.username);
  form.set('password', creds.password);
  form.set('next', '');

  const nextPath = new URL(loginPageUrl).searchParams.get('nextPath');
  if (nextPath) {
    form.set('nextPath', nextPath);
  }

  const loginRes = await fetchWithTimeout(
    loginPageUrl,
    {
      method: 'POST',
      redirect: 'manual',
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'content-type': 'application/x-www-form-urlencoded',
        cookie: buildCookieHeader(cookieJar),
        origin: creds.baseUrl,
        referer: loginPageUrl,
        'user-agent': 'OpenPaint-CW-Vercel/1.0',
      },
      body: form.toString(),
    },
    { label: 'createCwSession.loginSubmit' }
  );

  mergeCookieJar(cookieJar, parseSetCookie(getSetCookieArray(loginRes.headers)));
  const isRedirect = isRedirectStatus(loginRes.status);
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
  const response = await fetchWithTimeout(
    targetUrl,
    {
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
    },
    { label: 'cwGraphqlRequest' }
  );

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

export async function fetchCwMeasurementsTable({ formId, lang = 'en', override = {} }) {
  const session = await createCwSession(override);
  const targetUrl = `${session.baseUrl.replace(/\/+$/, '')}/order-management/measure-tool/form/${encodeURIComponent(formId)}/${encodeURIComponent(lang)}/get`;

  const res = await fetchWithTimeout(
    targetUrl,
    {
      method: 'GET',
      headers: {
        accept: 'application/json, text/plain, */*',
        cookie: buildCookieHeader(session.cookieJar),
        origin: session.baseUrl,
        referer: `${session.baseUrl.replace(/\/+$/, '')}/dashboard/`,
        'x-requested-with': 'XMLHttpRequest',
        'user-agent': 'OpenPaint-CW-Vercel/1.0',
      },
    },
    { label: 'fetchCwMeasurementsTable' }
  );

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
