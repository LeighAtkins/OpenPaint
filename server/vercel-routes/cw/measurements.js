import fs from 'fs/promises';
import {
  analyzeMeasureFormPayload,
  buildMeasureSavePayloadFromTable,
  createCwSession,
  cwGraphqlRequest,
  cwPublicGraphqlRequest,
  escapeGraphqlString,
  fetchOrderImagesByFormId,
  fetchCwMeasurementsTable,
  mapOrderImagesToMeasurementItems,
  parseProductConfiguration,
  readJsonBody,
} from './shared.js';

const mtTokenCache = new Map();
const FALLBACK_STYLE_CODES = [
  'BKPT_SP',
  'CNRP_PC',
  'CNRP_PM',
  'CNRP_SP',
  'ELAS_SP',
  'LSKT_PC',
  'LSKT_PM',
  'LSKT_SI',
  'LSKT_SP',
  'LSKT_WR',
  'MLTP_PC',
  'MLTP_PM',
  'MLTP_SP',
  'PC',
  'PM',
  'SDPT_SP',
  'SHRT_PC',
  'SHRT_PM',
  'SHRT_SP',
  'SHRT_WR',
  'SI',
  'SP',
  'VELC_PC',
  'VELC_PM',
  'VELC_SI',
  'VELC_SP',
  'VELC_WR',
  'VELC_WR_NARM',
  'VELC_WR_YARM',
  'WR',
];
const MAX_QC_ATTEMPTS = 80;
const MAX_PROBE_TERMS_FILE_BYTES = 25 * 1024 * 1024;
const SEARCH_TURBO_PROFILE = 'compact-v1';
const SEARCH_DEFAULT_PROFILE = 'full-v1';
const SEARCH_TURBO_LIMITS = {
  candidates: 8,
  referenceCandidates: 20,
  referenceCandidateOrigins: 20,
  qcMeasurementAttempts: 12,
  selectedTuples: 12,
  styleOptions: 16,
  images: 12,
  qcMeasurementsByStyle: 4,
  graphqlDiscoveryAttempts: 6,
};
const DISCOVERY_REFERENCE_PAGE_SIZE = 12;
const DISCOVERY_NAME_PAGE_SIZE = 24;
const DISCOVERY_MAX_RESULTS = 36;
const DISCOVERY_MAX_PAGES_PER_VARIANT = 4;
const TURBO_MAX_ATTEMPTS_PER_REFERENCE = 2;
const TURBO_MAX_ATTEMPTS_PER_SCOPED_REFERENCE = 1;
const TURBO_MAX_QC_ATTEMPTS = 12;
const TURBO_QC_SUCCESS_TARGET = 1;
const TURBO_FASTPATH_STYLE_PAIRS = [
  { style: 'Original', styleCode: 'SHRT_SP' },
  { style: 'Signature', styleCode: 'CNRP_SP' },
  { style: 'Classic', styleCode: 'CNRP_PM' },
  { style: 'Minimalist', styleCode: 'LSKT_SP' },
  { style: 'Urban', styleCode: 'VELC_SP' },
  { style: 'Original', styleCode: 'SP' },
  { style: 'Signature', styleCode: 'SP' },
];
const SHOULD_LOG_PROBE_MODE = String(process.env.CW_PROBE_MODE_DEBUG || '').trim() === '1';
const DEFAULT_FETCH_TIMEOUT_MS =
  Number.parseInt(process.env.CW_FETCH_TIMEOUT_MS || '', 10) || 12000;
const MANUAL_REFERENCE_HINT_NONE_TERMS = new Set(['IK-MD-3']);
const MANUAL_REFERENCE_HINTS = new Map([
  ['BA-AE-122', ['BA-AE-122__L__2S-3B']],
  ['MD2', ['MD2__L', 'MD2__R']],
  ['MD1', ['MD1__L', 'MD1__R']],
  ['HY2', ['HY2__34cm', 'HY2__43cm']],
  ['HY3', ['HY3__34cm', 'HY3__43cm']],
  ['PG2', ['PG2']],
  ['CS1', ['CS1']],
  ['IK-KA-1', ['IK-KA-1']],
  ['IK-KA-2', ['IK-KA-2']],
  ['IK-KA-3', ['IK-KA-3']],
  ['IK-KN-4', ['IK-KN-4__SV', 'IK-KN-4__LV']],
  ['IK-SM-3', ['IK-SM-3']],
  ['IK-ME-2', ['IK-ME-2']],
  ['IK-ME-5M', ['IK-ME-5M__L', 'IK-ME-5M__R']],
  ['IK-ME-6', ['IK-ME-6']],
  ['IK-MA-25B', ['IK-MA-25B__L', 'IK-MA-25B__R']],
  ['MJ-SLM-1', ['MJ-SLM-1__MJ-CC', 'MJ-SLM-1__CW-CC']],
  ['MJ-SLM-3P', ['MJ-SLM-3P__MJ-CC', 'MJ-SLM-3P__CW-CC']],
  ['MJ-OWA-2-2007', ['MJ-OWA-2-2007__DF', 'MJ-OWA-2-2007__MJ-CC', 'MJ-OWA-2-2007__CW-CC']],
  ['WE-VBK-1', ['WE-VBK-1__STD', 'WE-VBK-1__EXD', 'WE-VBK-1__SV', 'WE-VBK-1__LV']],
  ['WE-VBK-2', ['WE-VBK-2__STD', 'WE-VBK-2__EXD', 'WE-VBK-2__SV', 'WE-VBK-2__LV']],
  ['WE-KSK-1', ['WE-KSK-1__STD', 'WE-KSK-1__EXD', 'WE-KSK-1__SV', 'WE-KSK-1__LV']],
  ['WE-KSK-2', ['WE-KSK-2__STD', 'WE-KSK-2__EXD', 'WE-KSK-2__SV', 'WE-KSK-2__LV']],
  ['WE-VBA-1', ['WE-VBA-1__STD', 'WE-VBA-1__EXD', 'WE-VBA-1__SV', 'WE-VBA-1__LV']],
  ['IK-KD-3', ['IK-KD-3']],
  ['IK-KD-3B', ['IK-KD-3B']],
  ['IK-KD-362', ['IK-KD-362']],
  ['IK-KD-35', ['IK-KD-35']],
  ['PB-CRA-69M__L', ['PB-CRA-69M__L__BE', 'PB-CRA-69M__L__KE']],
  ['PB-PRA-73M__L', ['PB-PRA-73M__L__BE', 'PB-PRA-73M__L__KE']],
  ['PB-BSC-69M__L', ['PB-BSC-69M__L__PB', 'PB-BSC-69M__L__MG']],
]);

function normalizeManualReferenceHintKey(value) {
  return String(value || '')
    .trim()
    .toUpperCase();
}

function stripScopedReferenceSuffix(value) {
  return String(value || '')
    .trim()
    .replace(/__[A-Za-z0-9._-]+$/i, '');
}

function stripAllScopedReferenceSuffixes(value) {
  return String(value || '')
    .trim()
    .replace(/(?:__[A-Za-z0-9._-]+)+$/i, '');
}

function parseSearchReferenceTuple(searchTerm) {
  const raw = String(searchTerm || '').trim();
  if (!raw || !raw.includes(',')) {
    return {
      productReference: '',
      style: '',
      styleCode: '',
    };
  }
  const [productReference = '', style = '', styleCode = ''] = raw
    .split(',')
    .map(part => String(part || '').trim());
  return {
    productReference,
    style,
    styleCode,
  };
}

function isPbReferenceFamily(reference) {
  const base = stripScopedReferenceSuffix(reference);
  return /^PB/i.test(String(base || '').trim());
}

function buildPbReferenceFamily(reference) {
  const base = stripScopedReferenceSuffix(reference);
  if (!isPbReferenceFamily(base)) return [];
  return Array.from(
    new Set([`${base}__PB`, `${base}__MG`].map(value => String(value || '').trim()).filter(Boolean))
  );
}

function isWeReferenceFamily(reference) {
  const base = stripScopedReferenceSuffix(reference);
  return /^WE/i.test(String(base || '').trim());
}

function buildWeReferenceFamily(reference) {
  const base = stripScopedReferenceSuffix(reference);
  if (!isWeReferenceFamily(base)) return [];
  return Array.from(
    new Set(
      [
        `${base}__STD`,
        `${base}__EXD`,
        `${base}__SV`,
        `${base}__LV`,
        `${base}__L`,
        `${base}__R`,
        `${base}__PTD`,
      ]
        .map(value => String(value || '').trim())
        .filter(Boolean)
    )
  );
}

export function getManualReferenceHints(searchTerm) {
  const key = normalizeManualReferenceHintKey(searchTerm);
  const raw = MANUAL_REFERENCE_HINTS.get(key);
  if (!Array.isArray(raw) || !raw.length) return [];
  return Array.from(new Set(raw.map(item => String(item || '').trim()).filter(Boolean)));
}

function isManualReferenceHintNoneTerm(searchTerm) {
  const key = normalizeManualReferenceHintKey(searchTerm);
  if (!key) return false;
  return MANUAL_REFERENCE_HINT_NONE_TERMS.has(key);
}

function normalizeProbeMode(body = {}, query = {}) {
  const requestedProbeMode = String(body?.probeMode || body?.mode || query?.probeMode || '')
    .trim()
    .toLowerCase();
  const fastFlag = body?.fast === true || String(query?.fast || '').trim() === '1';
  const isTurboProbe = requestedProbeMode === 'turbo' || fastFlag;
  return {
    requestedProbeMode,
    isTurboProbe,
  };
}

function looksLikePlaceholderChoice(label, code = '') {
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

function buildSearchResponse(payload, options = {}) {
  const isTurboProbe = Boolean(options?.isTurboProbe);
  const requestedProbeMode = String(options?.requestedProbeMode || '')
    .trim()
    .toLowerCase();
  const response = payload && typeof payload === 'object' ? { ...payload } : {};

  if (!isTurboProbe) {
    return {
      ...response,
      probeMode: 'default',
      probeModeRequested: requestedProbeMode || 'default',
      probeModeApplied: 'default',
      responseProfile: SEARCH_DEFAULT_PROFILE,
      responseCompactDiagnostics: {
        compact: false,
      },
    };
  }

  const trimmedFields = [];
  const trimArrayField = (fieldName, limit) => {
    if (!Array.isArray(response[fieldName])) return;
    if (response[fieldName].length <= limit) return;
    response[fieldName] = response[fieldName].slice(0, limit);
    trimmedFields.push(fieldName);
  };

  trimArrayField('candidates', SEARCH_TURBO_LIMITS.candidates);
  trimArrayField('referenceCandidates', SEARCH_TURBO_LIMITS.referenceCandidates);
  trimArrayField('referenceCandidateOrigins', SEARCH_TURBO_LIMITS.referenceCandidateOrigins);
  trimArrayField('qcMeasurementAttempts', SEARCH_TURBO_LIMITS.qcMeasurementAttempts);
  trimArrayField('selectedTuples', SEARCH_TURBO_LIMITS.selectedTuples);
  trimArrayField('styleOptions', SEARCH_TURBO_LIMITS.styleOptions);
  trimArrayField('images', SEARCH_TURBO_LIMITS.images);
  trimArrayField('qcMeasurementsByStyle', SEARCH_TURBO_LIMITS.qcMeasurementsByStyle);

  if (response.discovery && typeof response.discovery === 'object') {
    const attempts = response.discovery.graphqlDiscoveryAttempts;
    if (Array.isArray(attempts) && attempts.length > SEARCH_TURBO_LIMITS.graphqlDiscoveryAttempts) {
      response.discovery = {
        ...response.discovery,
        graphqlDiscoveryAttempts: attempts.slice(0, SEARCH_TURBO_LIMITS.graphqlDiscoveryAttempts),
      };
      trimmedFields.push('discovery.graphqlDiscoveryAttempts');
    }
  }

  if (response.upstream && typeof response.upstream === 'object') {
    const attempts = response.upstream.graphqlDiscoveryAttempts;
    if (Array.isArray(attempts) && attempts.length > SEARCH_TURBO_LIMITS.graphqlDiscoveryAttempts) {
      response.upstream = {
        ...response.upstream,
        graphqlDiscoveryAttempts: attempts.slice(0, SEARCH_TURBO_LIMITS.graphqlDiscoveryAttempts),
      };
      trimmedFields.push('upstream.graphqlDiscoveryAttempts');
    }
  }

  if (response.urls && typeof response.urls === 'object') {
    const measurementUrls = response.urls.measurementUrls;
    if (Array.isArray(measurementUrls) && measurementUrls.length > 1) {
      response.urls = {
        ...response.urls,
        measurementUrls: measurementUrls.slice(0, 1),
      };
      trimmedFields.push('urls.measurementUrls');
    }
  }

  if (response.mtAuth && typeof response.mtAuth === 'object') {
    response.mtAuth = {
      ...response.mtAuth,
      tokenFetchBody: null,
      tokenFetchAttempts: null,
    };
    trimmedFields.push('mtAuth.tokenFetchBody');
    trimmedFields.push('mtAuth.tokenFetchAttempts');
  }

  if (Array.isArray(response.measurementDetails) && response.measurementDetails.length > 0) {
    trimmedFields.push('measurementDetails');
  }
  if (response.upstreamBody) {
    trimmedFields.push('upstreamBody');
  }
  if (response.upstreamSnippet) {
    trimmedFields.push('upstreamSnippet');
  }
  if (response.formMeasurements) {
    trimmedFields.push('formMeasurements');
  }
  if (response.renderedHtmlExtraction) {
    trimmedFields.push('renderedHtmlExtraction');
  }

  response.measurementDetails = [];
  response.upstreamBody = null;
  response.upstreamSnippet = null;
  response.formMeasurements = null;
  response.renderedHtmlExtraction = null;

  return {
    ...response,
    probeMode: 'turbo',
    probeModeRequested: requestedProbeMode || 'turbo',
    probeModeApplied: 'turbo',
    responseProfile: SEARCH_TURBO_PROFILE,
    responseCompactDiagnostics: {
      compact: true,
      trimmedFields,
      limits: SEARCH_TURBO_LIMITS,
    },
  };
}

function isDefinitiveMtMissingProduct(attempt) {
  const bodyStatus = Number(attempt?.body?.status);
  if (bodyStatus !== 400) return false;
  const content = String(attempt?.body?.content || '').toLowerCase();
  const message = String(attempt?.body?.message || attempt?.body?.error || '').toLowerCase();
  return (
    content.includes('product does not exist in mt database') ||
    message.includes('product does not exist in mt database')
  );
}

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

function decodeJwtExp(token) {
  try {
    const payload = String(token || '').split('.')[1];
    if (!payload) return null;
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number.isFinite(Number(json?.exp)) ? Number(json.exp) : null;
  } catch {
    return null;
  }
}

function getCachedMtToken(cacheKey) {
  const cached = mtTokenCache.get(cacheKey);
  if (!cached) return null;
  if (Date.now() >= cached.expiresAtMs) {
    mtTokenCache.delete(cacheKey);
    return null;
  }
  return cached;
}

function setCachedMtToken(cacheKey, token, refreshToken = null) {
  const exp = decodeJwtExp(token);
  const safetyMs = 60 * 1000;
  const expiresAtMs = exp ? exp * 1000 - safetyMs : Date.now() + 10 * 60 * 1000;
  mtTokenCache.set(cacheKey, {
    token,
    refreshToken,
    expiresAtMs,
  });
}

function buildCookieHeader(jar) {
  return Object.entries(jar || {})
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

function toAbsoluteUrl(baseUrl, maybeRelative) {
  try {
    return new URL(String(maybeRelative || ''), String(baseUrl || '')).toString();
  } catch {
    return '';
  }
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenize(value) {
  return normalizeText(value)
    .split(' ')
    .map(token => token.trim())
    .filter(token => token.length >= 2);
}

function normalizeSearchText(source) {
  let text = String(source || '');
  if (!text) return '';
  text = text
    .replace(/\\\//g, '/')
    .replace(/\u002F/gi, '/')
    .replace(/\u003A/gi, ':')
    .replace(/\u0026/gi, '&')
    .replace(/\u002C/gi, ',')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  try {
    text = decodeURIComponent(text);
  } catch {
    // Keep original text when mixed encodings are present.
  }
  return text;
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function stripHtml(value) {
  return decodeHtmlEntities(String(value || '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function parseProbeTermsFromExportHtml(html) {
  const rowMatches = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  const rows = rowMatches.map(rowHtml => {
    const cellMatches = rowHtml.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || [];
    return cellMatches.map(cellHtml => {
      const inner = cellHtml.replace(/^<t[dh][^>]*>/i, '').replace(/<\/t[dh]>$/i, '');
      return stripHtml(inner);
    });
  });

  if (rows.length < 2) {
    return {
      terms: [],
      totalRows: 0,
      referenceColumnIndex: -1,
    };
  }

  const header = rows[1] || [];
  const referenceColumnIndex = header.findIndex(
    col =>
      String(col || '')
        .trim()
        .toUpperCase() === 'REFERENCE'
  );
  const dataRows = rows.slice(2);
  const terms = [];
  const seen = new Set();

  dataRows.forEach(row => {
    const value = referenceColumnIndex >= 0 ? String(row[referenceColumnIndex] || '').trim() : '';
    if (!value || seen.has(value)) return;
    seen.add(value);
    terms.push(value);
  });

  return {
    terms,
    totalRows: dataRows.length,
    referenceColumnIndex,
  };
}

function extractProductMeasurementLinks(sourceText, baseUrl) {
  const text = String(sourceText || '');
  if (!text) return [];
  const links = new Set();
  const re =
    /(?:https?:\/\/[^"'\s<]+)?\/product-measurements\/[A-Za-z0-9+/=_-]+\/[A-Za-z0-9,_.\-]+/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const value = String(match[0] || '').trim();
    if (!value) continue;
    const absolute = value.startsWith('http') ? value : toAbsoluteUrl(baseUrl, value);
    if (absolute) links.add(absolute);
  }
  return Array.from(links);
}

function scoreCandidate(url, searchTerm) {
  const path = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return String(url || '');
    }
  })();
  const haystack = normalizeText(path);
  const tokens = tokenize(searchTerm);
  const termNorm = normalizeText(searchTerm);

  let score = 0;
  if (termNorm && haystack.includes(termNorm)) score += 80;
  tokens.forEach(token => {
    if (haystack.includes(token)) score += 12;
  });

  const lastSegment = path.split('/').pop() || '';
  const slugPart = normalizeText(lastSegment.replace(/,/g, ' '));
  if (termNorm && slugPart.includes(termNorm)) score += 40;
  tokens.forEach(token => {
    if (slugPart.includes(token)) score += 10;
  });

  return score;
}

function collectSearchUrls(baseUrl, searchTerm) {
  const q = encodeURIComponent(String(searchTerm || '').trim());
  const base = String(baseUrl || '').replace(/\/+$/, '');
  return [
    `${base}/dashboard/#/products?search=${q}`,
    `${base}/dashboard/#/products?q=${q}`,
    `${base}/dashboard/products/?q=${q}`,
    `${base}/dashboard/products/?search=${q}`,
    `${base}/dashboard/products/?keyword=${q}`,
    `${base}/dashboard/products/list/?q=${q}`,
    `${base}/dashboard/products/list/?search=${q}`,
    `${base}/dashboard/products/search/?q=${q}`,
    `${base}/dashboard/products/search/?search=${q}`,
    `${base}/dashboard/products/`,
    `${base}/dashboard/#/products`,
    `${base}/dashboard/`,
  ];
}

function decodeCwRelayProductId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d+$/.test(raw)) return raw;
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    const match = decoded.match(/^Product:(\d+)$/i);
    if (match?.[1]) return match[1];
  } catch {
    // Keep fallback when id is not relay-encoded.
  }
  return raw;
}

function buildSearchTermVariants(searchTerm) {
  const raw = String(searchTerm || '').trim();
  if (!raw) return [];
  const tuple = parseSearchReferenceTuple(raw);
  const variants = new Set();
  variants.add(raw);
  variants.add(raw.toUpperCase());
  variants.add(raw.toLowerCase());

  const tupleReference = String(tuple.productReference || '').trim();
  if (tupleReference) {
    variants.add(tupleReference);
    variants.add(tupleReference.toUpperCase());
    variants.add(tupleReference.toLowerCase());
    const tupleReferenceBase = stripScopedReferenceSuffix(tupleReference);
    if (tupleReferenceBase) variants.add(tupleReferenceBase);
    buildPbReferenceFamily(tupleReference).forEach(ref => {
      variants.add(ref);
      variants.add(ref.toUpperCase());
      variants.add(ref.toLowerCase());
    });
    buildWeReferenceFamily(tupleReference).forEach(ref => {
      variants.add(ref);
      variants.add(ref.toUpperCase());
      variants.add(ref.toLowerCase());
    });
  }

  const noScope = raw.replace(/__[A-Za-z0-9_-]+$/, '');
  if (noScope) variants.add(noScope);

  const noTupleScope = tupleReference ? stripScopedReferenceSuffix(tupleReference) : '';
  if (noTupleScope) variants.add(noTupleScope);

  const lastDashTrimmed = raw.includes('-') ? raw.replace(/-[^-]+$/, '') : '';
  if (lastDashTrimmed) variants.add(lastDashTrimmed);

  const tupleLastDashTrimmed =
    tupleReference && tupleReference.includes('-') ? tupleReference.replace(/-[^-]+$/, '') : '';
  if (tupleLastDashTrimmed) variants.add(tupleLastDashTrimmed);

  const normalizedWordy = raw.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (normalizedWordy) variants.add(normalizedWordy);

  const tupleWordy = tupleReference
    ? tupleReference.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
    : '';
  if (tupleWordy) variants.add(tupleWordy);

  return Array.from(variants).filter(Boolean);
}

function extractImageUrls(node, out = new Set()) {
  if (!node) return out;
  if (typeof node === 'string') {
    const value = node.trim();
    if (/^https?:\/\//i.test(value) && /\.(?:png|jpe?g|webp|gif|bmp|svg)(?:\?|$)/i.test(value)) {
      out.add(value);
    }
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach(item => extractImageUrls(item, out));
    return out;
  }
  if (typeof node === 'object') {
    Object.entries(node).forEach(([key, value]) => {
      const k = key.toLowerCase();
      if (typeof value === 'string' && (k.includes('image') || k.endsWith('url'))) {
        const maybeUrl = value.trim();
        if (/^https?:\/\//i.test(maybeUrl)) {
          out.add(maybeUrl);
        }
      }
      extractImageUrls(value, out);
    });
  }
  return out;
}

function extractMeasurementCandidates(node, path = '', out = []) {
  if (!node) return out;
  if (Array.isArray(node)) {
    node.forEach((item, idx) => extractMeasurementCandidates(item, `${path}[${idx}]`, out));
    return out;
  }
  if (typeof node !== 'object') return out;

  Object.entries(node).forEach(([key, value]) => {
    const currentPath = path ? `${path}.${key}` : key;
    const lower = key.toLowerCase();
    if (
      lower.includes('measurement') ||
      lower.includes('field_data') ||
      lower.includes('dimensions') ||
      lower === 'size'
    ) {
      out.push({ key: currentPath, value });
    }
    extractMeasurementCandidates(value, currentPath, out);
  });
  return out;
}

function scoreFromHaystack(haystackText, termNorm, termTokens) {
  const haystack = normalizeText(haystackText);
  if (!haystack) return 0;
  let score = 0;
  if (termNorm && haystack.includes(termNorm)) score += 100;
  termTokens.forEach(token => {
    if (haystack.includes(token)) score += 15;
  });
  return score;
}

async function cwGetWithSession(session, url, referer) {
  const response = await fetchWithTimeout(
    url,
    {
      method: 'GET',
      headers: {
        accept: 'application/json, text/plain, text/html, */*',
        cookie: buildCookieHeader(session.cookieJar),
        origin: session.baseUrl,
        referer: referer || `${session.baseUrl.replace(/\/+$/, '')}/dashboard/`,
        'x-requested-with': 'XMLHttpRequest',
        'user-agent': 'OpenPaint-CW-Vercel/1.0',
      },
    },
    { label: 'cwGetWithSession' }
  );

  const rawText = await response.text().catch(() => '');
  let body = null;
  try {
    body = rawText ? JSON.parse(rawText) : null;
  } catch {
    body = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    url,
    contentType: response.headers.get('content-type') || '',
    rawText,
    body,
  };
}

async function cwGetImageWithSession(session, url, referer) {
  const response = await fetchWithTimeout(
    url,
    {
      method: 'GET',
      headers: {
        accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        cookie: buildCookieHeader(session.cookieJar),
        origin: session.baseUrl,
        referer: referer || `${session.baseUrl.replace(/\/+$/, '')}/dashboard/`,
        'x-requested-with': 'XMLHttpRequest',
        'user-agent': 'OpenPaint-CW-Vercel/1.0',
      },
    },
    { label: 'cwGetImageWithSession' }
  );

  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const okContentType = contentType.startsWith('image/');
  const bytes = await response.arrayBuffer().catch(() => new ArrayBuffer(0));
  const byteLength = bytes.byteLength || 0;

  return {
    ok: response.ok && okContentType && byteLength > 0,
    status: response.status,
    url,
    contentType,
    bytes,
    byteLength,
  };
}

function decodeHtmlEntitiesForUrl(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function encodePathSegments(pathname) {
  return String(pathname || '')
    .split('/')
    .map(part => encodeURIComponent(part))
    .join('/');
}

function expandImageCandidateVariants(candidates = []) {
  const out = new Set();
  candidates.forEach(raw => {
    const clean = decodeHtmlEntitiesForUrl(raw);
    if (!clean) return;
    out.add(clean);

    let parsed;
    try {
      parsed = new URL(clean);
    } catch {
      return;
    }

    const pathname = String(parsed.pathname || '');
    if (!pathname) return;
    const normalizedPath = pathname.replace(/\)\)_/g, ')_');
    const encodedPath = encodePathSegments(normalizedPath);
    const pathVariants = new Set([pathname, normalizedPath, encodedPath]);

    pathVariants.forEach(pathVariant => {
      const clone = new URL(parsed.toString());
      clone.pathname = pathVariant;
      out.add(clone.toString());
    });
  });
  return Array.from(out);
}

async function fetchMtProductQcMeasurements({
  session,
  mtApiBaseUrl,
  productReference,
  style,
  styleCode,
  bucketName,
  mtAccessToken,
}) {
  const baseUrl = String(mtApiBaseUrl || session.baseUrl || '').replace(/\/+$/, '');
  const targetUrl = `${baseUrl}/mtApi/product-qc-measurements/`;
  const params = new URLSearchParams();
  params.set('product_reference', String(productReference || ''));
  if (style) params.set('style', String(style));
  if (styleCode) params.set('style_code', String(styleCode));
  if (bucketName) params.set('bucket_name', String(bucketName));

  const headers = {
    accept: 'application/json, text/plain, */*',
    cookie: buildCookieHeader(session.cookieJar),
    origin: baseUrl,
    referer: `${baseUrl}/dashboard/`,
    'x-csrftoken': session.csrfToken,
    'x-requested-with': 'XMLHttpRequest',
    'user-agent': 'OpenPaint-CW-Vercel/1.0',
  };
  if (mtAccessToken) {
    headers.Authorization = `Bearer ${mtAccessToken}`;
  }

  const response = await fetchWithTimeout(
    `${targetUrl}?${params.toString()}`,
    {
      method: 'GET',
      headers,
    },
    { label: 'fetchMtProductQcMeasurements' }
  );

  const rawText = await response.text().catch(() => '');
  let body = null;
  try {
    body = rawText ? JSON.parse(rawText) : null;
  } catch {
    body = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    targetUrl,
    params: Object.fromEntries(params.entries()),
    body,
    rawText,
  };
}

async function fetchJsonOrText(url, options = {}) {
  const extraHeaders = options && typeof options === 'object' ? options.headers || {} : {};
  const timeoutMs =
    options && typeof options === 'object' && Number.isFinite(Number(options.timeoutMs))
      ? Number(options.timeoutMs)
      : undefined;
  const response = await fetchWithTimeout(
    url,
    {
      method: 'GET',
      headers: {
        accept: 'application/json, text/plain, text/html, */*',
        'user-agent': 'OpenPaint-CW-Vercel/1.0',
        ...extraHeaders,
      },
    },
    { timeoutMs, label: 'fetchJsonOrText' }
  );

  const rawText = await response.text().catch(() => '');
  let body = null;
  try {
    body = rawText ? JSON.parse(rawText) : null;
  } catch {
    body = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    contentType: response.headers.get('content-type') || '',
    body,
    rawText,
  };
}

function candidateScoreForImageUrl(url) {
  const value = String(url || '');
  if (!value) return -1000;
  let score = 0;
  if (/storage\.googleapis\.com\/pid-storage/i.test(value)) score += 40;
  if (/\bSignature=/i.test(value) && /\bGoogleAccessId=/i.test(value)) score += 200;
  if (/\bExpires=/i.test(value)) score += 40;
  if (/storage\.cloud\.google\.com/i.test(value)) score -= 100;
  if (/cw-pid-qylyewlgca-uc\.a\.run\.app\/slipcover_details_images/i.test(value)) score -= 30;
  if (/cw40\.comfort-works\.com\/(media|uploads)\//i.test(value)) score -= 20;
  if (/\.(png|jpe?g|webp)(\?|$)/i.test(value)) score += 10;
  return score;
}

function rankImageCandidates(candidates = []) {
  return Array.from(new Set(candidates))
    .map(url => ({ url, score: candidateScoreForImageUrl(url) }))
    .sort((a, b) => b.score - a.score)
    .map(item => item.url);
}

async function postCwGraphqlWithSession(session, payload, authorization = '') {
  const baseUrl = String(session.baseUrl || '').replace(/\/+$/, '');
  const headers = {
    accept: '*/*',
    'content-type': 'application/json',
    cookie: buildCookieHeader(session.cookieJar),
    origin: baseUrl,
    referer: `${baseUrl}/dashboard/`,
    'x-csrftoken': session.csrfToken,
    'x-requested-with': 'XMLHttpRequest',
    'user-agent': 'OpenPaint-CW-Vercel/1.0',
  };
  if (authorization) {
    headers.authorization = authorization;
  }

  const response = await fetchWithTimeout(
    `${baseUrl}/api/`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    },
    { label: 'postCwGraphqlWithSession' }
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
    body,
  };
}

async function fetchMtAccessTokenViaCwGraphql({
  override,
  username,
  password,
  forceRefresh = false,
}) {
  const identity = String(username || override?.username || process.env.CW_USERNAME || '').trim();
  const secret = String(password || override?.password || process.env.CW_PASSWORD || '').trim();
  if (!identity || !secret) return null;

  const session = await createCwSession({
    baseUrl: override?.baseUrl,
    username: identity,
    password: secret,
  });
  const cacheKey = `${String(session.baseUrl || '').replace(/\/+$/, '')}|${identity.toLowerCase()}`;
  const cached = forceRefresh ? null : getCachedMtToken(cacheKey);
  if (cached?.token) {
    return {
      ok: true,
      status: 200,
      accessToken: cached.token,
      refreshToken: cached.refreshToken || null,
      source: 'cache',
      attempts: [{ source: 'cache', ok: true }],
      body: null,
    };
  }

  const emailCandidates = [];
  if (identity.includes('@')) {
    emailCandidates.push(identity);
  }
  if (override?.email && String(override.email).includes('@')) {
    emailCandidates.push(String(override.email).trim());
  }
  if (!emailCandidates.length) {
    emailCandidates.push(identity);
  }

  const attempts = [];
  const tokenAuthMutation = `mutation getToken($email: String!, $password: String!) {
  tokenAuth(input: { email: $email, password: $password }) {
    token
  }
}`;
  const staffMtTokenQuery = `query staffMtToken {
  staffMtToken {
    accessToken
    refreshToken
  }
}`;

  for (const email of emailCandidates) {
    const tokenAuth = await postCwGraphqlWithSession(session, {
      operationName: 'getToken',
      query: tokenAuthMutation,
      variables: { email, password: secret },
    });

    const cwJwt = String(tokenAuth?.body?.data?.tokenAuth?.token || '').trim();
    attempts.push({
      step: 'tokenAuth',
      email,
      ok: tokenAuth.ok,
      status: tokenAuth.status,
      hasToken: Boolean(cwJwt),
    });
    if (!cwJwt) continue;

    const mtTokenResult = await postCwGraphqlWithSession(
      session,
      {
        operationName: 'staffMtToken',
        query: staffMtTokenQuery,
        variables: {},
      },
      `JWT ${cwJwt}`
    );

    const accessToken = String(mtTokenResult?.body?.data?.staffMtToken?.accessToken || '').trim();
    const refreshToken = String(mtTokenResult?.body?.data?.staffMtToken?.refreshToken || '').trim();
    attempts.push({
      step: 'staffMtToken',
      email,
      ok: mtTokenResult.ok,
      status: mtTokenResult.status,
      hasAccessToken: Boolean(accessToken),
      hasRefreshToken: Boolean(refreshToken),
    });

    if (accessToken) {
      setCachedMtToken(cacheKey, accessToken, refreshToken || null);
      return {
        ok: true,
        status: 200,
        accessToken,
        refreshToken: refreshToken || null,
        source: 'cw-graphql',
        attempts,
        body: mtTokenResult.body,
      };
    }
  }

  return {
    ok: false,
    status: 401,
    accessToken: null,
    refreshToken: null,
    source: 'cw-graphql',
    attempts,
    body: null,
  };
}

async function fetchMtAccessToken({ mtApiBaseUrl, username, password }) {
  const baseUrl = String(mtApiBaseUrl || '').replace(/\/+$/, '');
  const identity = String(username || process.env.CW_USERNAME || '').trim();
  const secret = String(password || process.env.CW_PASSWORD || '').trim();
  if (!baseUrl || !identity || !secret) return null;

  const payloads = [
    { username: identity, password: secret },
    { username: identity, email: identity, password: secret },
    { username: identity, username_or_email: identity, password: secret },
    { email: identity, password: secret },
    { username_or_email: identity, password: secret },
  ];

  if (identity.includes('@')) {
    const localPart = identity.split('@')[0].trim();
    if (localPart) {
      payloads.unshift({ username: localPart, password: secret });
      payloads.push({ username: localPart, username_or_email: identity, password: secret });
    }
  }

  let lastAttempt = null;
  const attempts = [];
  for (const payload of payloads) {
    const response = await fetchWithTimeout(
      `${baseUrl}/mtApi/token/`,
      {
        method: 'POST',
        headers: {
          accept: 'application/json, text/plain, */*',
          'content-type': 'application/json',
          'user-agent': 'OpenPaint-CW-Vercel/1.0',
        },
        body: JSON.stringify(payload),
      },
      { label: 'fetchMtAccessToken' }
    );

    const rawText = await response.text().catch(() => '');
    let body = null;
    try {
      body = rawText ? JSON.parse(rawText) : null;
    } catch {
      body = null;
    }

    const accessToken =
      body && typeof body === 'object'
        ? String(body.access || body.token || body.mtAccessToken || body.access_token || '').trim()
        : '';

    lastAttempt = {
      ok: response.ok && Boolean(accessToken),
      status: response.status,
      accessToken: accessToken || null,
      body,
      payloadKeys: Object.keys(payload),
    };
    attempts.push({
      status: lastAttempt.status,
      ok: lastAttempt.ok,
      payloadKeys: lastAttempt.payloadKeys,
      body: lastAttempt.body,
    });

    if (lastAttempt.ok) {
      lastAttempt.attempts = attempts;
      return lastAttempt;
    }
  }

  if (lastAttempt) {
    lastAttempt.attempts = attempts;
  }
  return lastAttempt;
}

function collectStrings(node, out = []) {
  if (node === null || node === undefined) return out;
  if (typeof node === 'string') {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach(item => collectStrings(item, out));
    return out;
  }
  if (typeof node === 'object') {
    Object.values(node).forEach(value => collectStrings(value, out));
  }
  return out;
}

function extractMeasurementPathSuffixes(source, productId) {
  const allText = normalizeSearchText(Array.isArray(source) ? source.join('\n') : source);
  const escapedId = String(productId || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const suffixes = new Set();
  const re = new RegExp(`/product-measurements/${escapedId}/([^"'\\s<]+)`, 'g');
  let match;
  while ((match = re.exec(allText)) !== null) {
    const suffix = String(match[1] || '').trim();
    if (suffix) suffixes.add(suffix);
  }
  return Array.from(suffixes);
}

function extractSuffixesByReference(source, reference) {
  const allText = normalizeSearchText(Array.isArray(source) ? source.join('\n') : source);
  const ref = String(reference || '').trim();
  if (!ref) return [];
  const escapedRef = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const suffixes = new Set();

  const tripleRe = new RegExp(`${escapedRef},[A-Za-z0-9_\-]+,[A-Za-z0-9_\-]+`, 'g');
  let triple;
  while ((triple = tripleRe.exec(allText)) !== null) {
    const suffix = String(triple[0] || '').trim();
    if (suffix) suffixes.add(suffix);
  }

  const pairRe = new RegExp(`${escapedRef},[A-Za-z0-9_\-]+`, 'g');
  let pair;
  while ((pair = pairRe.exec(allText)) !== null) {
    const suffix = String(pair[0] || '').trim();
    if (suffix) suffixes.add(suffix);
  }

  return Array.from(suffixes);
}

function extractSuffixesByReferencePrefix(source, reference) {
  const allText = normalizeSearchText(Array.isArray(source) ? source.join('\n') : source);
  const ref = String(reference || '').trim();
  if (!ref) return [];
  const escapedRef = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const suffixes = new Set();
  const re = new RegExp(
    `${escapedRef}(?:__[A-Za-z0-9_-]+)?,[A-Za-z0-9_-]+(?:,[A-Za-z0-9_-]+)?`,
    'g'
  );
  let match;
  while ((match = re.exec(allText)) !== null) {
    const suffix = String(match[0] || '').trim();
    if (suffix) suffixes.add(suffix);
  }
  return Array.from(suffixes);
}

function extractReferenceVariants(source, baseReference) {
  const allText = normalizeSearchText(Array.isArray(source) ? source.join('\n') : source);
  const base = String(baseReference || '').trim();
  const variants = new Set();
  if (base) variants.add(base);
  if (!base) return Array.from(variants);
  const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${escapedBase}__[A-Za-z0-9_-]+`, 'g');
  let match;
  while ((match = re.exec(allText)) !== null) {
    const ref = String(match[0] || '').trim();
    if (ref) variants.add(ref);
  }
  return Array.from(variants);
}

function extractTupleSuffixesFromPayload(payload, baseReference) {
  const text = normalizeSearchText(
    [
      ...collectStrings(payload, []),
      (() => {
        try {
          return JSON.stringify(payload || {});
        } catch {
          return '';
        }
      })(),
    ].join('\n')
  );
  if (!text) return [];

  const ref = String(baseReference || '').trim();
  if (!ref) return [];
  const escapedRef = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tuples = new Set();

  const tupleRe = new RegExp(
    `${escapedRef}(?:__[A-Za-z0-9_-]+)?,[A-Za-z0-9_-]+,[A-Za-z0-9_-]+`,
    'g'
  );
  let match;
  while ((match = tupleRe.exec(text)) !== null) {
    const suffix = String(match[0] || '').trim();
    if (suffix) tuples.add(suffix);
  }

  return Array.from(tuples);
}

function stripHtmlTags(value) {
  return decodeHtmlEntities(String(value || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTupleRowsFromHtml(rawHtml, baseReference = '') {
  const html = String(rawHtml || '');
  if (!html) return [];
  const rows = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(html)) !== null) {
    const rowHtml = String(rowMatch[1] || '');
    const cells = [];
    const tdRe = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
    let tdMatch;
    while ((tdMatch = tdRe.exec(rowHtml)) !== null) {
      cells.push(stripHtmlTags(tdMatch[1]));
    }
    if (cells.length < 5) continue;
    const productReference = String(cells[2] || '').trim();
    const style = String(cells[3] || '').trim();
    const styleCode = String(cells[4] || '').trim();
    if (!productReference || !style || !styleCode) continue;
    if (baseReference && !productReference.startsWith(baseReference)) continue;
    rows.push({
      productReference,
      style,
      styleCode,
      label: String(cells[1] || '').trim(),
    });
  }
  const dedup = new Map();
  rows.forEach(row => {
    const key = `${String(row.productReference || '').toLowerCase()}|${String(row.style || '').toLowerCase()}|${String(row.styleCode || '').toLowerCase()}`;
    if (!dedup.has(key)) dedup.set(key, row);
  });
  return Array.from(dedup.values());
}

function extractImageUrlsFromText(rawText, out = new Set()) {
  const source = String(rawText || '');
  const normalized = decodeHtmlEntities(source)
    .replace(/\\\//g, '/')
    .replace(/\u002F/gi, '/')
    .replace(/\u003A/gi, ':')
    .replace(/\u0026/gi, '&');

  const directMatches =
    normalized.match(/https?:\/\/[^"'\s>]+\.(?:png|jpe?g|webp|gif|bmp|svg)(?:\?[^"'\s>]*)?/gi) ||
    [];
  directMatches.forEach(url => out.add(sanitizeExtractedUrl(url)));

  const encodedMatches =
    normalized.match(/https%3A%2F%2F[^"'\s>]+(?:png|jpe?g|webp|gif|bmp|svg)(?:%3F[^"'\s>]*)?/gi) ||
    [];
  encodedMatches.forEach(value => {
    try {
      out.add(sanitizeExtractedUrl(decodeURIComponent(value)));
    } catch {
      // ignore malformed encoded URL
    }
  });

  // Some payloads place url(...) wrappers with signed query params.
  const cssUrlMatches =
    normalized.match(/url\(([^)]+\.(?:png|jpe?g|webp|gif|bmp|svg)(?:\?[^)]*)?)\)/gi) || [];
  cssUrlMatches.forEach(chunk => {
    const raw = String(chunk)
      .replace(/^url\(/i, '')
      .replace(/\)$/i, '');
    out.add(sanitizeExtractedUrl(raw));
  });

  return out;
}

function sanitizeExtractedUrl(value) {
  if (!value) return '';
  let url = decodeHtmlEntities(value);
  url = url.replace(/["')\];]+$/g, '');
  return url;
}

function parseRenderedMeasurementsHtml(htmlText) {
  const html = String(htmlText || '');
  if (!html) return null;

  const sections = [];
  const panelStartRegex =
    /<div\s+aria-expanded="(?:true|false)"\s+class="v-expansion-panel[^>]*">/gi;
  const panelStarts = [];
  let panelStartMatch;
  while ((panelStartMatch = panelStartRegex.exec(html)) !== null) {
    panelStarts.push(panelStartMatch.index);
  }

  if (!panelStarts.length) {
    return null;
  }

  for (let idx = 0; idx < panelStarts.length; idx += 1) {
    const start = panelStarts[idx];
    const end = idx + 1 < panelStarts.length ? panelStarts[idx + 1] : html.length;
    const block = html.slice(start, end);

    const nameMatch = block.match(/<span[^>]*class="[^"]*text-4[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    const sectionName = decodeHtmlEntities(nameMatch?.[1] || '');
    if (!sectionName) continue;

    const pieceMatch = block.match(/type="number"\s+value="([^"]+)"/i);
    const skirtMatch = block.match(/Skirt Length:[\s\S]*?type="text"\s+value="([^"]+)"/i);

    const imageUrls = [];
    const imgRegex =
      /https?:\/\/storage\.googleapis\.com\/[^\s"')]+\.(?:png|jpe?g|webp)(?:\?[^\s"')]+)?/gi;
    let imgMatch;
    while ((imgMatch = imgRegex.exec(block)) !== null) {
      const cleaned = sanitizeExtractedUrl(imgMatch[0]);
      if (cleaned) imageUrls.push(cleaned);
    }

    const measurements = [];
    const rowRegex =
      /<tr[^>]*>[\s\S]*?<td[^>]*class="text-left"[^>]*>([\s\S]*?)<\/td>[\s\S]*?<td[^>]*class="text-center"[^>]*>([\s\S]*?)<\/td>[\s\S]*?<td[^>]*class="text-center"[^>]*>([\s\S]*?)<\/td>[\s\S]*?<td[^>]*class="text-center"[^>]*>([\s\S]*?)<\/td>/gi;
    let row;
    while ((row = rowRegex.exec(block)) !== null) {
      const label = decodeHtmlEntities(row[1]);
      const value = decodeHtmlEntities(row[2]);
      const toleranceMin = decodeHtmlEntities(row[3]);
      const toleranceMax = decodeHtmlEntities(row[4]);
      if (!label) continue;
      measurements.push({ label, value, toleranceMin, toleranceMax });
    }

    if (!imageUrls.length && !measurements.length) continue;
    sections.push({
      sectionName,
      pieces: decodeHtmlEntities(pieceMatch?.[1] || ''),
      skirtLength: decodeHtmlEntities(skirtMatch?.[1] || ''),
      imageUrls: Array.from(new Set(imageUrls)),
      measurements,
    });
  }

  if (!sections.length) return null;
  return {
    sectionCount: sections.length,
    totalImageCount: sections.reduce((acc, section) => acc + section.imageUrls.length, 0),
    totalMeasurementCount: sections.reduce((acc, section) => acc + section.measurements.length, 0),
    flatMeasurements: sections.flatMap(section =>
      section.measurements.map(row => ({
        sectionName: section.sectionName,
        pieces: section.pieces,
        skirtLength: section.skirtLength,
        ...row,
      }))
    ),
    sections,
  };
}

export function scoreProductNode(node, searchTerm, options = {}) {
  const termNorm = normalizeText(searchTerm);
  const termTokens = tokenize(searchTerm);
  const translationNames = (node?.translations?.edges || [])
    .map(edge => String(edge?.node?.name || '').trim())
    .filter(Boolean)
    .join(' ');
  const haystack = `${String(node?.reference || '')} ${translationNames}`;
  let score = scoreFromHaystack(haystack, termNorm, termTokens);

  const requestedReferenceRaw = String(
    options?.productReference || options?.product_reference || ''
  ).trim();
  if (!requestedReferenceRaw) {
    return score;
  }

  const requestedReference = requestedReferenceRaw.toLowerCase();
  const requestedReferenceBase = stripScopedReferenceSuffix(requestedReferenceRaw).toLowerCase();
  const requestedReferenceRoot =
    stripAllScopedReferenceSuffixes(requestedReferenceRaw).toLowerCase();
  const nodeReferenceRaw = String(node?.reference || '').trim();
  const nodeReference = nodeReferenceRaw.toLowerCase();
  const nodeReferenceBase = stripScopedReferenceSuffix(nodeReferenceRaw).toLowerCase();
  const nodeReferenceRoot = stripAllScopedReferenceSuffixes(nodeReferenceRaw).toLowerCase();

  if (requestedReference && nodeReference === requestedReference) {
    score += 1000;
  } else if (requestedReference && nodeReference.startsWith(`${requestedReference}__`)) {
    score += 850;
  } else if (requestedReferenceBase && nodeReferenceBase === requestedReferenceBase) {
    score += 700;
  } else if (requestedReferenceBase && nodeReference === requestedReferenceBase) {
    score += 600;
  } else if (requestedReferenceRoot && nodeReferenceRoot === requestedReferenceRoot) {
    score += 500;
  }

  return score;
}

export function looksLikeReferenceSearchTerm(value) {
  const raw = String(value || '').trim();
  if (!/^[A-Z0-9][A-Z0-9-_]{2,}$/i.test(raw)) return false;
  if (/^[A-Za-z]+$/.test(raw)) return false;
  return /[\d_-]/.test(raw);
}

export function getDiscoveryQueryMode(value) {
  return looksLikeReferenceSearchTerm(value) ? 'reference' : 'name';
}

function normalizeProductTranslations(node) {
  const raw = Array.isArray(node?.translations?.edges) ? node.translations.edges : [];
  return raw.map(edge => edge?.node).filter(Boolean);
}

function getProductDisplayName(node) {
  const translations = normalizeProductTranslations(node);
  return String(
    translations[0]?.name || translations[0]?.slug || node?.productName || node?.name || ''
  ).trim();
}

function buildFallbackDiscoveryStyleOptions(productReference) {
  const seen = new Set();
  return TURBO_FASTPATH_STYLE_PAIRS.map(pair => {
    const style = String(pair?.style || '').trim();
    const styleCode = String(pair?.styleCode || '').trim();
    const key = `${style.toLowerCase()}|${styleCode.toLowerCase()}`;
    if (!style && !styleCode) return null;
    if (seen.has(key)) return null;
    seen.add(key);
    return {
      productReference: String(productReference || '').trim(),
      style,
      styleCode,
      label: `${productReference || 'Reference'} - ${style || 'Style'}${styleCode ? ` (${styleCode})` : ''}`,
    };
  }).filter(Boolean);
}

function getDiscoveryTermVariants(searchTerm, queryMode) {
  const raw = String(searchTerm || '').trim();
  if (!raw) return [];
  if (queryMode === 'reference') {
    return Array.from(new Set(buildSearchTermVariants(raw))).slice(0, 6);
  }
  const wordy = raw.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(new Set([raw, wordy].filter(Boolean))).slice(0, 3);
}

function buildPublicDiscoveryQuery({ first, after = '', reference = '', translationsName = '' }) {
  return `{
  products(first: ${Math.max(1, Math.min(first, DISCOVERY_MAX_RESULTS))}, after: ${escapeGraphqlString(
    after
  )}, reference_Icontains: ${escapeGraphqlString(
    reference
  )}, translations_Name_Icontains: ${escapeGraphqlString(
    translationsName
  )}, translations_Lang: "en", sort: ["id"]) {
    edges {
      cursor
      node {
        id
        reference
        status
        translations {
          edges {
            node {
              name
              slug
              lang
            }
          }
        }
      }
    }
    totalCount
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}`;
}

function buildAuthenticatedDiscoveryQuery() {
  return `query ProductList($first: Int, $after: String = "", $before: String = "", $last: Int, $reference: String, $translations__name: String, $lang: String = "en", $sortBy: [String] = ["id"]) {
  products(first: $first, after: $after, before: $before, last: $last, reference_Icontains: $reference, translations_Name_Icontains: $translations__name, translations_Lang: $lang, sort: $sortBy) {
    edges {
      cursor
      node {
        id
        reference
        status
        translations {
          edges {
            node {
              name
              slug
              lang
            }
          }
        }
      }
    }
    totalCount
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}`;
}

export function buildPublicNameFastPathQuery(searchTerm) {
  return `{
  products(first: 1, translations_Name_Icontains: ${escapeGraphqlString(
    searchTerm
  )}, translations_Lang: "en") {
    edges {
      node {
        id
        reference
        status
        translations(lang: "en") {
          edges {
            node {
              name
              slug
              lang
            }
          }
        }
        productConfiguration(manualOrder: true)
      }
    }
  }
}`;
}

function collectDiscoveryNodes(productNodesByKey, nodes = []) {
  nodes.forEach(node => {
    const key = String(node?.id || node?.reference || '').trim();
    if (key && !productNodesByKey.has(key)) {
      productNodesByKey.set(key, node);
    }
  });
}

async function fetchPublicProductDetailsByReference(baseUrl, reference) {
  const normalizedReference = String(reference || '').trim();
  if (!normalizedReference) return null;
  const query = `{
  products(first: 1, reference: ${escapeGraphqlString(normalizedReference)}) {
    edges {
      node {
        id
        reference
        status
        translations(lang: "en") {
          edges {
            node {
              name
              slug
              lang
            }
          }
        }
        productConfiguration(manualOrder: true)
      }
    }
  }
}`;
  const result = await cwPublicGraphqlRequest({
    baseUrl,
    operationName: 'null',
    query,
  });
  const node = result?.body?.data?.products?.edges?.[0]?.node || null;
  return {
    ok: Boolean(result?.ok && node),
    status: result?.status || null,
    node,
    result,
  };
}

async function fetchPublicTopProductByName(baseUrl, searchTerm) {
  const normalizedSearch = String(searchTerm || '').trim();
  if (!normalizedSearch) return null;
  const result = await cwPublicGraphqlRequest({
    baseUrl,
    operationName: 'null',
    query: buildPublicNameFastPathQuery(normalizedSearch),
  });
  const node = result?.body?.data?.products?.edges?.[0]?.node || null;
  return {
    ok: Boolean(result?.ok && node),
    status: result?.status || null,
    node,
    result,
  };
}

async function discoverPublicProducts({
  baseUrl,
  searchTerm,
  limit = DISCOVERY_REFERENCE_PAGE_SIZE,
  seedReferences = [],
}) {
  const search = String(searchTerm || '').trim();
  if (!search) return { attempts: [], nodes: [], queryMode: 'name', totalMatchesSeen: 0 };

  const attempts = [];
  const productNodesByKey = new Map();
  const queryMode = getDiscoveryQueryMode(search);
  const exactVariants =
    queryMode === 'reference'
      ? Array.from(
          new Set(
            [
              search,
              search.toUpperCase(),
              search.toLowerCase(),
              ...seedReferences.map(value => String(value || '').trim()),
            ].filter(Boolean)
          )
        )
      : [];
  let totalMatchesSeen = 0;

  // Run exact reference lookups in parallel (individual timeouts are non-fatal)
  const exactResults =
    exactVariants.length > 0
      ? await Promise.all(
          exactVariants.map(async reference => {
            try {
              const detail = await fetchPublicProductDetailsByReference(baseUrl, reference);
              return { reference, detail };
            } catch {
              return { reference, detail: { ok: false, status: null, node: null, timedOut: true } };
            }
          })
        )
      : [];
  for (const { reference, detail } of exactResults) {
    attempts.push({
      strategy: 'public-reference-exact',
      termVariant: reference,
      status: detail?.status || null,
      ok: Boolean(detail?.ok),
      nodeCount: detail?.node ? 1 : 0,
    });
    if (detail?.node) {
      const key = String(detail.node?.id || detail.node?.reference || '').trim();
      if (key) productNodesByKey.set(key, detail.node);
    }
  }

  // For exact reference matches with results, run one fast contains search
  // in parallel instead of iterating all term variants sequentially
  const termVariants = getDiscoveryTermVariants(search, queryMode);
  const hasExactMatch = productNodesByKey.size > 0 && queryMode === 'reference';
  const containsVariants = hasExactMatch
    ? termVariants.slice(0, 2) // Limit to 2 variants for exact matches (fast path)
    : termVariants;

  // Run the first page of each contains variant in parallel (individual timeouts are non-fatal)
  const firstPageResults = await Promise.all(
    containsVariants.map(async termVariant => {
      const first =
        queryMode === 'name'
          ? Math.max(limit, DISCOVERY_NAME_PAGE_SIZE)
          : Math.min(limit, DISCOVERY_REFERENCE_PAGE_SIZE);
      try {
        const result = await cwPublicGraphqlRequest({
          baseUrl,
          operationName: 'null',
          query: buildPublicDiscoveryQuery({
            first,
            after: '',
            reference: queryMode === 'reference' ? termVariant : '',
            translationsName: queryMode === 'name' ? termVariant : '',
          }),
        });
        return { termVariant, result };
      } catch {
        return { termVariant, result: { ok: false, status: null, body: null } };
      }
    })
  );

  for (const { termVariant, result } of firstPageResults) {
    const productData = result?.body?.data?.products;
    const edges = Array.isArray(productData?.edges) ? productData.edges : [];
    const nodes = edges.map(edge => edge?.node).filter(Boolean);
    const totalCount = Number(productData?.totalCount || 0);
    const hasNextPage = productData?.pageInfo?.hasNextPage === true;
    const after = String(productData?.pageInfo?.endCursor || '').trim();
    totalMatchesSeen = Math.max(
      totalMatchesSeen,
      totalCount,
      productNodesByKey.size + nodes.length
    );
    attempts.push({
      strategy: queryMode === 'name' ? 'public-name' : 'public-reference-contains',
      termVariant,
      page: 1,
      status: result?.status || null,
      ok: Boolean(result?.ok),
      nodeCount: nodes.length,
      totalCount,
    });
    collectDiscoveryNodes(productNodesByKey, nodes);

    // Only fetch additional pages if not an exact match fast-path and there are more results
    if (!hasExactMatch && hasNextPage && after && nodes.length) {
      let pageCursor = after;
      for (
        let page = 1;
        page < DISCOVERY_MAX_PAGES_PER_VARIANT && productNodesByKey.size < DISCOVERY_MAX_RESULTS;
        page += 1
      ) {
        const first =
          queryMode === 'name'
            ? Math.max(limit, DISCOVERY_NAME_PAGE_SIZE)
            : Math.min(limit, DISCOVERY_REFERENCE_PAGE_SIZE);
        let pageResult;
        try {
          pageResult = await cwPublicGraphqlRequest({
            baseUrl,
            operationName: 'null',
            query: buildPublicDiscoveryQuery({
              first,
              after: pageCursor,
              reference: queryMode === 'reference' ? termVariant : '',
              translationsName: queryMode === 'name' ? termVariant : '',
            }),
          });
        } catch {
          break; // Stop pagination on timeout
        }
        const pageProductData = pageResult?.body?.data?.products;
        const pageEdges = Array.isArray(pageProductData?.edges) ? pageProductData.edges : [];
        const pageNodes = pageEdges.map(edge => edge?.node).filter(Boolean);
        const pageTotalCount = Number(pageProductData?.totalCount || 0);
        const pageHasNext = pageProductData?.pageInfo?.hasNextPage === true;
        pageCursor = String(pageProductData?.pageInfo?.endCursor || '').trim();
        totalMatchesSeen = Math.max(
          totalMatchesSeen,
          pageTotalCount,
          productNodesByKey.size + pageNodes.length
        );
        attempts.push({
          strategy: queryMode === 'name' ? 'public-name' : 'public-reference-contains',
          termVariant,
          page: page + 1,
          status: pageResult?.status || null,
          ok: Boolean(pageResult?.ok),
          nodeCount: pageNodes.length,
          totalCount: pageTotalCount,
        });
        collectDiscoveryNodes(productNodesByKey, pageNodes);
        if (!pageHasNext || !pageCursor || !pageNodes.length) break;
      }
    }
  }

  return {
    attempts,
    nodes: Array.from(productNodesByKey.values()),
    queryMode,
    totalMatchesSeen: Math.max(totalMatchesSeen, productNodesByKey.size),
  };
}

async function discoverAuthenticatedProducts({
  baseUrl,
  username,
  password,
  searchTerm,
  queryMode,
  seedReferences = [],
}) {
  const search = String(searchTerm || '').trim();
  if (!search || !username || !password) {
    return { attempts: [], nodes: [], totalMatchesSeen: 0 };
  }

  const attempts = [];
  const productNodesByKey = new Map();
  const query = buildAuthenticatedDiscoveryQuery();
  const termVariants = Array.from(
    new Set([
      ...getDiscoveryTermVariants(search, queryMode),
      ...(queryMode === 'reference'
        ? seedReferences.map(value => String(value || '').trim()).filter(Boolean)
        : []),
    ])
  );
  let totalMatchesSeen = 0;

  for (const termVariant of termVariants) {
    let after = '';
    for (
      let page = 0;
      page < DISCOVERY_MAX_PAGES_PER_VARIANT && productNodesByKey.size < DISCOVERY_MAX_RESULTS;
      page += 1
    ) {
      const first = queryMode === 'name' ? DISCOVERY_NAME_PAGE_SIZE : DISCOVERY_REFERENCE_PAGE_SIZE;
      const result = await cwGraphqlRequest({
        override: {
          baseUrl,
          username,
          password,
        },
        operationName: 'ProductList',
        query,
        variables: {
          after,
          before: '',
          lang: 'en',
          sortBy: ['id'],
          first,
          reference: queryMode === 'reference' ? termVariant : '',
          translations__name: queryMode === 'name' ? termVariant : '',
        },
      });
      const productData = result?.body?.data?.products;
      const edges = Array.isArray(productData?.edges) ? productData.edges : [];
      const nodes = edges.map(edge => edge?.node).filter(Boolean);
      const totalCount = Number(productData?.totalCount || 0);
      const hasNextPage = productData?.pageInfo?.hasNextPage === true;
      after = String(productData?.pageInfo?.endCursor || '').trim();
      totalMatchesSeen = Math.max(
        totalMatchesSeen,
        totalCount,
        productNodesByKey.size + nodes.length
      );
      attempts.push({
        strategy:
          queryMode === 'name' ? 'authenticated-name-fallback' : 'authenticated-reference-fallback',
        termVariant,
        page: page + 1,
        status: result?.status || null,
        ok: Boolean(result?.ok),
        nodeCount: nodes.length,
        totalCount,
      });
      collectDiscoveryNodes(productNodesByKey, nodes);
      if (!hasNextPage || !after || !nodes.length) break;
    }
  }

  return {
    attempts,
    nodes: Array.from(productNodesByKey.values()),
    totalMatchesSeen: Math.max(totalMatchesSeen, productNodesByKey.size),
  };
}

export function buildDiscoveredProductResult({ node, fallbackNode = null, score = 0 }) {
  const primaryNode = node || fallbackNode;
  const reference = String(primaryNode?.reference || fallbackNode?.reference || '').trim();
  if (!primaryNode || !reference) return null;

  const parsedConfig = parseProductConfiguration({
    productConfiguration: primaryNode?.productConfiguration || null,
    productReference: reference,
    productName: getProductDisplayName(primaryNode),
  });
  const styleOptions = parsedConfig.styleOptions.length
    ? parsedConfig.styleOptions
    : buildFallbackDiscoveryStyleOptions(reference);

  return {
    id: String(primaryNode?.id || fallbackNode?.id || '').trim() || null,
    productReference: reference,
    productName: getProductDisplayName(primaryNode),
    status: primaryNode?.status || fallbackNode?.status || null,
    translations: normalizeProductTranslations(primaryNode),
    configParsed: Boolean(parsedConfig.parsed),
    versionOptions: parsedConfig.versionOptions,
    styleOptions,
    derivedScopedReferences: parsedConfig.derivedScopedReferences,
    product: {
      id: String(primaryNode?.id || fallbackNode?.id || '').trim() || null,
      reference,
      status: primaryNode?.status || fallbackNode?.status || null,
      translations: normalizeProductTranslations(primaryNode),
    },
    score: Number(score || 0),
  };
}

async function enrichDiscoveredProductsWithConfig({ baseUrl, rankedNodes = [] }) {
  // Fetch product details in parallel instead of sequentially
  const tasks = rankedNodes.map(async rankedNode => {
    const node = rankedNode?.node || rankedNode;
    const reference = String(node?.reference || '').trim();
    if (!reference) return null;
    try {
      const detail = await fetchPublicProductDetailsByReference(baseUrl, reference);
      return buildDiscoveredProductResult({
        node: detail?.node || null,
        fallbackNode: node,
        score: Number(rankedNode?.score || 0),
      });
    } catch {
      return buildDiscoveredProductResult({
        node: null,
        fallbackNode: node,
        score: Number(rankedNode?.score || 0),
      });
    }
  });
  const results = await Promise.all(tasks);
  return results.filter(Boolean);
}

function addDefaultStyleKey(item) {
  return {
    ...item,
    defaultStyleKey:
      item.styleOptions[0]?.style || item.styleOptions[0]?.styleCode
        ? makeSelectionKey({
            productReference: item.productReference,
            versionCode: '',
            style: item.styleOptions[0]?.style || '',
            styleCode: item.styleOptions[0]?.styleCode || '',
          })
        : '',
  };
}

function buildProductSearchDiscoverResponse({
  searchTerm,
  queryMode,
  rankedNodes = [],
  results = [],
  attempts = [],
  totalMatchesSeen = 0,
  searchStrategy = 'legacy-discovery',
  startedAt,
}) {
  return {
    success: results.length > 0,
    code: results.length ? 'CW_PRODUCT_DISCOVERY_OK' : 'CW_PRODUCT_DISCOVERY_NOT_FOUND',
    phase: 'discover',
    search: searchTerm,
    results: results.map(addDefaultStyleKey),
    summary: {
      candidateCount: rankedNodes.length,
      resultCount: results.length,
      exactReferenceSearch: queryMode === 'reference',
      queryMode,
      searchStrategy,
      totalMatchesSeen: Math.max(totalMatchesSeen, rankedNodes.length),
      returnedMatches: results.length,
      configurationParsedCount: results.filter(item => item.configParsed).length,
    },
    discovery: {
      searchStrategy,
      graphqlDiscoveryAttempts: attempts,
    },
    durationMs: Date.now() - startedAt,
  };
}

function makeSelectionKey({ productReference, versionCode = '', style = '', styleCode = '' } = {}) {
  return [
    String(productReference || '').trim(),
    String(versionCode || '').trim(),
    String(style || '').trim(),
    String(styleCode || '').trim(),
  ].join('|');
}

function normalizeSelectedItemSelection(item = {}) {
  const productReference = String(item?.productReference || '').trim();
  const versionCode = String(item?.versionCode || '')
    .trim()
    .toUpperCase();
  const style = String(item?.style || '').trim();
  const styleCode = String(item?.styleCode || item?.style_code || '')
    .trim()
    .toUpperCase();
  const scopedReference =
    String(item?.scopedReference || '').trim() ||
    (productReference && versionCode ? `${productReference}__${versionCode}` : productReference);
  return {
    selectionKey:
      String(item?.selectionKey || '').trim() ||
      makeSelectionKey({ productReference, versionCode, style, styleCode }),
    search: String(item?.search || productReference || scopedReference || '').trim(),
    productReference,
    scopedReference,
    productName: String(item?.productName || '').trim(),
    versionCode,
    versionLabel: String(item?.versionLabel || '').trim(),
    style,
    styleCode,
  };
}

export function buildLoadSelectedSearchBody(body = {}, selection = {}) {
  const selectedReference =
    String(selection?.scopedReference || selection?.productReference || '').trim() || '';
  const fallbackSearch = String(selection?.search || '').trim();
  const resolvedSearch = selectedReference || fallbackSearch;
  const { phase: _phase, selectedItems: _si, ...rest } = body;
  return {
    ...rest,
    search: resolvedSearch,
    query: resolvedSearch,
    productReference: selectedReference || String(body?.productReference || '').trim(),
    style: String(selection?.style || body?.style || '').trim(),
    styleCode: String(
      selection?.styleCode || selection?.style_code || body?.styleCode || body?.style_code || ''
    )
      .trim()
      .toUpperCase(),
  };
}

async function runLegacySearchPayload({ req, body, startedAt }) {
  let statusCode = 200;
  let payload = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(nextPayload) {
      payload = nextPayload;
      return nextPayload;
    },
  };
  await handleProductSearch({ req, res, body, startedAt });
  return {
    statusCode,
    payload,
  };
}

async function handleProductSearchDiscover({ req, res, body, startedAt }) {
  const searchTerm = String(body?.search || body?.query || '').trim();
  const manualHintReferences = getManualReferenceHints(searchTerm);
  const manualHintNoneTerm = isManualReferenceHintNoneTerm(searchTerm);
  const queryMode = getDiscoveryQueryMode(searchTerm);
  if (!searchTerm) {
    return res.status(400).json({
      success: false,
      code: 'CW_SEARCH_REQUIRED',
      phase: 'discover',
      message: 'search is required',
    });
  }
  if (manualHintNoneTerm) {
    return res.status(404).json({
      success: false,
      code: 'CW_PRODUCT_DISCOVERY_NOT_FOUND',
      phase: 'discover',
      message: 'No valid product measurement reference is known for this term',
      search: searchTerm,
      results: [],
    });
  }

  const baseUrl = String(req.query?.baseUrl || body?.baseUrl || 'https://cw40.comfort-works.com')
    .trim()
    .replace(/\/+$/, '');
  const fastPathAttempts = [];
  const publicDiscoveryPromise = discoverPublicProducts({
    baseUrl,
    searchTerm,
    limit: queryMode === 'name' ? DISCOVERY_NAME_PAGE_SIZE : DISCOVERY_REFERENCE_PAGE_SIZE,
    seedReferences: manualHintReferences,
  });

  let fastPath = null;
  let fastPathNode = null;
  let fastPathResult = null;
  if (queryMode === 'name') {
    try {
      fastPath = await fetchPublicTopProductByName(baseUrl, searchTerm);
    } catch {
      fastPath = { ok: false, status: null, node: null };
    }
    fastPathNode = fastPath?.node || null;
    fastPathResult = fastPathNode
      ? buildDiscoveredProductResult({
          node: fastPathNode,
          score: scoreProductNode(fastPathNode, searchTerm),
        })
      : null;

    fastPathAttempts.push({
      strategy: 'public-name-fast-path',
      termVariant: searchTerm,
      status: fastPath?.status || null,
      ok: Boolean(fastPath?.ok),
      nodeCount: fastPathNode ? 1 : 0,
      configParsed: Boolean(fastPathResult?.configParsed),
    });
  }

  const publicDiscovery = await publicDiscoveryPromise;

  let productNodes = publicDiscovery.nodes;
  if (fastPathNode) {
    const nodesByKey = new Map();
    collectDiscoveryNodes(nodesByKey, productNodes);
    collectDiscoveryNodes(nodesByKey, [fastPathNode]);
    productNodes = Array.from(nodesByKey.values());
  }
  let attempts = [...fastPathAttempts, ...publicDiscovery.attempts];
  let totalMatchesSeen = Number(publicDiscovery.totalMatchesSeen || productNodes.length || 0);

  const fallbackUsername = String(
    req.query?.username || body?.username || body?.email || ''
  ).trim();
  const fallbackPassword = String(req.query?.password || body?.password || '').trim();

  if (!productNodes.length && fallbackUsername && fallbackPassword) {
    const fallback = await discoverAuthenticatedProducts({
      baseUrl,
      username: fallbackUsername,
      password: fallbackPassword,
      searchTerm,
      queryMode,
      seedReferences: manualHintReferences,
    });
    productNodes = fallback.nodes;
    attempts = [...attempts, ...fallback.attempts];
    totalMatchesSeen = Math.max(totalMatchesSeen, Number(fallback.totalMatchesSeen || 0));
  }

  const rankedNodes = productNodes
    .map(node => ({ node, score: scoreProductNode(node, searchTerm) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, queryMode === 'name' ? DISCOVERY_MAX_RESULTS : 8);

  // Separate nodes that already have productConfiguration (from exact lookups)
  // from those that need enrichment (from contains/name searches)
  const preEnrichedResults = [];
  const needsEnrichmentNodes = [];
  for (const ranked of rankedNodes) {
    const node = ranked.node;
    if (node?.productConfiguration) {
      const result = buildDiscoveredProductResult({
        node,
        fallbackNode: node,
        score: ranked.score,
      });
      if (result) preEnrichedResults.push(result);
    } else {
      needsEnrichmentNodes.push(ranked);
    }
  }

  const enrichedResults =
    needsEnrichmentNodes.length > 0
      ? await enrichDiscoveredProductsWithConfig({ baseUrl, rankedNodes: needsEnrichmentNodes })
      : [];

  let results = [...preEnrichedResults, ...enrichedResults].sort(
    (a, b) => (b.score || 0) - (a.score || 0)
  );
  let searchStrategy = fastPathNode ? 'name-fast-path+legacy-discovery' : 'legacy-discovery';

  if (!results.length && fastPathResult?.configParsed) {
    results = [fastPathResult];
    searchStrategy = 'name-fast-path-fallback';
  }

  return res.status(results.length ? 200 : 404).json(
    buildProductSearchDiscoverResponse({
      searchTerm,
      queryMode,
      rankedNodes,
      results,
      attempts,
      totalMatchesSeen,
      searchStrategy,
      startedAt,
    })
  );
}

async function handleProductSearchLoadSelected({ req, res, body, startedAt }) {
  const selectedItems = Array.isArray(body?.selectedItems) ? body.selectedItems : [];
  if (!selectedItems.length) {
    return res.status(400).json({
      success: false,
      code: 'CW_SELECTED_ITEMS_REQUIRED',
      phase: 'load-selected',
      message: 'selectedItems are required',
      items: [],
    });
  }

  const results = [];
  for (const rawItem of selectedItems) {
    const selection = normalizeSelectedItemSelection(rawItem);
    const legacy = await runLegacySearchPayload({
      req,
      startedAt,
      body: buildLoadSelectedSearchBody(body, selection),
    });
    const payload = legacy.payload || {};
    results.push({
      selectionKey: selection.selectionKey,
      basketItem: selection,
      success: legacy.statusCode >= 200 && legacy.statusCode < 300 && payload?.success !== false,
      statusCode: legacy.statusCode,
      code: payload?.code || null,
      message: payload?.message || null,
      product: payload?.product || null,
      data: payload,
    });
  }

  const loadedCount = results.filter(item => item.success).length;
  return res.status(loadedCount > 0 ? 200 : 502).json({
    success: loadedCount > 0,
    code:
      loadedCount === results.length
        ? 'CW_SELECTED_ITEMS_LOAD_OK'
        : 'CW_SELECTED_ITEMS_LOAD_PARTIAL',
    phase: 'load-selected',
    items: results,
    summary: {
      selectedCount: selectedItems.length,
      loadedCount,
      failedCount: results.length - loadedCount,
    },
    durationMs: Date.now() - startedAt,
  });
}

async function handleLoadSelected({ res, body, startedAt }) {
  const selectedItems = Array.isArray(body?.selectedItems) ? body.selectedItems : [];
  if (!selectedItems.length) {
    return res.status(400).json({
      success: false,
      code: 'CW_NO_ITEMS_SELECTED',
      message: 'No items to load',
    });
  }

  const override = {
    baseUrl: body?.baseUrl,
    username: body?.username,
    password: body?.password,
  };
  const pidBaseUrl = String(
    body?.pidBaseUrl || process.env.CW_PID_BASE_URL || 'https://cw-pid-qylyewlgca-uc.a.run.app'
  )
    .trim()
    .replace(/\/+$/, '');

  // Get auth
  const session = await createCwSession(override);
  const tokenResult = await fetchMtAccessTokenViaCwGraphql({ override });
  const mtAccessToken = tokenResult?.accessToken || '';

  const results = [];
  for (const item of selectedItems) {
    const productRef = String(item?.productReference || '').trim();
    const scopedRef = String(item?.scopedReference || '').trim();
    const style = String(item?.style || '').trim();
    const styleCode = String(item?.styleCode || '').trim();
    // Use scopedReference for the QC lookup (includes version suffix like IK-KD-2__STD)
    const lookupRef = scopedRef || productRef;

    if (!lookupRef) {
      results.push({
        selectionKey: item?.selectionKey || '',
        basketItem: item,
        data: null,
        success: false,
        message: 'Missing product reference',
      });
      continue;
    }

    try {
      const qcResult = await fetchMtProductQcMeasurements({
        session,
        mtApiBaseUrl: pidBaseUrl,
        productReference: lookupRef,
        style,
        styleCode,
        mtAccessToken,
      });

      const qcData = qcResult.body?.content || qcResult.body || null;
      const ok = qcResult.ok && qcData && typeof qcData === 'object' && !qcData.detail;

      results.push({
        selectionKey: item?.selectionKey || '',
        basketItem: item,
        data: ok
          ? {
              product: {
                reference: lookupRef,
                name: item?.productName || productRef,
              },
              qcMeasurements: { data: qcData },
              measurements: qcData?.product_components || [],
              images: extractQcImages(qcData, pidBaseUrl),
            }
          : null,
        success: Boolean(ok),
        message: ok
          ? 'Loaded'
          : String(
              qcData?.detail || qcData?.content || qcResult.rawText || 'QC lookup failed'
            ).slice(0, 200),
      });
    } catch (error) {
      results.push({
        selectionKey: item?.selectionKey || '',
        basketItem: item,
        data: null,
        success: false,
        message: String(error?.message || error).slice(0, 200),
      });
    }
  }

  const loadedCount = results.filter(r => r.success).length;
  return res.status(200).json({
    success: true,
    code: 'CW_LOAD_SELECTED_OK',
    items: results,
    summary: {
      requestedCount: selectedItems.length,
      loadedCount,
      failedCount: selectedItems.length - loadedCount,
    },
    durationMs: Date.now() - startedAt,
  });
}

/** Extract image URLs from QC measurement data. */
function extractQcImages(qcData, pidBaseUrl) {
  if (!qcData || typeof qcData !== 'object') return [];
  const images = [];
  const baseUrl = String(pidBaseUrl || '').replace(/\/+$/, '');
  const components = Array.isArray(qcData.product_components) ? qcData.product_components : [];
  components.forEach(comp => {
    const detailImages = Array.isArray(comp?.slipcover_details_images)
      ? comp.slipcover_details_images
      : [];
    detailImages.forEach(img => {
      // Prefer signed GCS URL when available (these actually work)
      const signedUrl = String(img?.url || '').trim();
      if (signedUrl && /^https?:\/\/storage\.googleapis\.com\//i.test(signedUrl)) {
        images.push(signedUrl);
        return;
      }
      const filePath = String(img?.file_path || '').trim();
      if (filePath) {
        images.push(`${baseUrl}/media/${filePath}`);
      }
    });
  });
  return images;
}

async function handleProductSearch({ req, res, body, startedAt }) {
  // Handle load-selected phase: fetch QC measurements for each basket item
  const phase = String(body?.phase || '').trim();
  if (phase === 'load-selected') {
    return handleLoadSelected({ res, body, startedAt });
  }

  const searchTerm = String(body?.search || body?.query || '').trim();
  const inferredSearchTuple = parseSearchReferenceTuple(searchTerm);
  const manualHintReferences = getManualReferenceHints(searchTerm);
  const manualHintReferenceBases = Array.from(
    new Set(manualHintReferences.map(stripScopedReferenceSuffix).filter(Boolean))
  );
  const manualHintNoneTerm = isManualReferenceHintNoneTerm(searchTerm);
  const manualHintDiagnostics = {
    term: searchTerm || null,
    termKey: normalizeManualReferenceHintKey(searchTerm) || null,
    noneTerm: manualHintNoneTerm,
    references: manualHintReferences,
    referenceBases: manualHintReferenceBases,
    applied: manualHintNoneTerm || manualHintReferences.length > 0,
  };
  const probeModeState = normalizeProbeMode(body, req.query || {});
  const isTurboProbe = probeModeState.isTurboProbe;
  const providedFormId = String(body?.formId || req.query?.formId || '').trim();
  const stageTimings = {
    tokenMs: null,
    graphqlMs: null,
    sessionMs: null,
    pidInfoMs: null,
    qcMs: null,
    turboFastPathMs: null,
  };
  const buildTimings = () => ({
    ...stageTimings,
    totalMs: Date.now() - startedAt,
  });

  if (SHOULD_LOG_PROBE_MODE) {
    console.log('[CW Search] probe mode', {
      requested: probeModeState.requestedProbeMode || null,
      applied: isTurboProbe ? 'turbo' : 'default',
      bodyProbeMode: body?.probeMode || body?.mode || null,
      queryProbeMode: req.query?.probeMode || null,
      queryFast: req.query?.fast || null,
      bodyFast: body?.fast === true,
      formId: providedFormId || null,
      search: searchTerm,
    });
  }

  if (!searchTerm) {
    return res.status(400).json({
      success: false,
      code: 'CW_SEARCH_REQUIRED',
      message: 'search is required',
    });
  }

  if (manualHintNoneTerm) {
    const payload = {
      success: false,
      code: 'CW_PRODUCT_MEASUREMENT_NOT_FOUND',
      message: 'No valid product measurement reference is known for this term',
      search: searchTerm,
      formId: providedFormId || null,
      summary: {
        manualHintApplied: true,
        manualHintNoneTerm: true,
        manualHintReferenceCount: manualHintReferences.length,
      },
      manualReferenceHints: manualHintDiagnostics,
      timings: buildTimings(),
      durationMs: Date.now() - startedAt,
    };
    return res.status(404).json(
      buildSearchResponse(payload, {
        isTurboProbe,
        requestedProbeMode: probeModeState.requestedProbeMode,
      })
    );
  }

  const renderedHtmlExtraction = parseRenderedMeasurementsHtml(body?.renderedHtml || '');

  const override = {
    baseUrl: req.query?.baseUrl || body?.baseUrl,
    username: req.query?.username || body?.username || body?.email,
    password: req.query?.password || body?.password,
  };
  const mtUsername = String(
    body?.mtUsername || body?.mtUser || body?.mtEmail || override.username || ''
  ).trim();
  const mtPassword = String(body?.mtPassword || override.password || '').trim();

  const pidBaseUrl = String(
    body?.pidBaseUrl || process.env.CW_PID_BASE_URL || 'https://cw-pid-qylyewlgca-uc.a.run.app'
  )
    .trim()
    .replace(/\/+$/, '');

  const providedStyle = String(body?.style || inferredSearchTuple.style || '').trim();
  const providedStyleCode = String(
    body?.styleCode || body?.style_code || inferredSearchTuple.styleCode || ''
  ).trim();
  const providedProductReference = String(
    body?.productReference || body?.product_reference || inferredSearchTuple.productReference || ''
  ).trim();
  const providedMtAccessToken = String(body?.mtAccessToken || '').trim();
  let autoTokenResult = null;
  if (!providedMtAccessToken) {
    const tokenStartedAt = Date.now();
    autoTokenResult = await fetchMtAccessTokenViaCwGraphql({
      override,
      username: mtUsername,
      password: mtPassword,
    });
    if (!autoTokenResult?.ok) {
      const legacyToken = await fetchMtAccessToken({
        mtApiBaseUrl: pidBaseUrl,
        username: mtUsername,
        password: mtPassword,
      });
      autoTokenResult = {
        ok: Boolean(legacyToken?.ok),
        status: legacyToken?.status || autoTokenResult?.status || 401,
        accessToken: legacyToken?.accessToken || null,
        body: legacyToken?.body || autoTokenResult?.body || null,
        source: legacyToken?.ok ? 'mt-token-endpoint' : 'cw-graphql+mt-token-endpoint',
        attempts: [
          ...(autoTokenResult?.attempts || []),
          ...(legacyToken?.attempts || []).map(item => ({
            ...item,
            step: item.step || 'mtApiToken',
          })),
        ],
      };
    }
    stageTimings.tokenMs = Date.now() - tokenStartedAt;
  }
  const mtAccessToken = providedMtAccessToken || autoTokenResult?.accessToken || '';
  const providedBucketName = String(
    body?.bucketName ||
      process.env.CW_PID_STORAGE_BUCKET ||
      process.env.PID_STORAGE ||
      'pid-storage'
  ).trim();
  const gqlProductListQuery = `query ProductList($first: Int, $after: String = "", $before: String = "", $last: Int, $reference: String, $id: ID, $translations__name: String, $lang: String = "en", $sortBy: [String] = ["id"]) {
  products(first: $first, after: $after, before: $before, last: $last, reference_Icontains: $reference, id: $id, translations_Name_Icontains: $translations__name, translations_Lang: $lang, sort: $sortBy) {
    edges {
      node {
        id
        reference
        status
        translations {
          edges {
            node {
              name
              slug
              lang
            }
          }
        }
      }
    }
    totalCount
  }
}`;

  // CW protocol queries for style/measurement discovery.
  // Step 1: fetch all MT model names, filter locally by reference.
  const gqlMtModelNamesQuery = `query { mtModelNamesList { id modelName label modelData } }`;
  // Step 2: fetch measurements for a specific reference + model name.
  const gqlMtMeasurementsQuery = `query mtProductInitializedMeasurements($reference: String!, $name: String!) {
  mtProductInitializedMeasurements(reference: $reference, name: $name) {
    reference
    name
    measurementId
    measurementData
    enabled
  }
}`;
  // Step 3: fetch product detail with combinationTemplate optionGroups
  // (styles, fabrics, accessories). Each optionGroup has a JSON `data` field
  // whose parsed `content[]` array contains `{ code, name: { _translateable: { UN } } }`.
  const gqlProductDetailQuery = `query ProductDetail($id: ID!) {
  product(id: $id) {
    id
    reference
    combinationTemplate {
      id
      name
      optionGroups { id name data }
    }
  }
}`;

  const graphqlDiscoveryAttempts = [];
  const graphqlStartedAt = Date.now();
  const fullTermVariants = Array.from(
    new Set([
      ...buildSearchTermVariants(searchTerm),
      ...manualHintReferences,
      ...manualHintReferenceBases,
      ...manualHintReferenceBases.map(value => value.toUpperCase()),
      ...manualHintReferenceBases.map(value => value.toLowerCase()),
    ])
  );
  const termVariants = isTurboProbe
    ? Array.from(
        new Set(
          [
            searchTerm,
            searchTerm.toUpperCase(),
            searchTerm.toLowerCase(),
            ...manualHintReferences,
            ...manualHintReferenceBases,
          ].filter(Boolean)
        )
      )
    : fullTermVariants;
  const productNodesByKey = new Map();
  let productListPrimary = null;

  for (const termVariant of termVariants) {
    const variantLooksLikeReference = /^[A-Z0-9][A-Z0-9-_]{3,}$/i.test(termVariant);
    const queryPlans = isTurboProbe
      ? [
          {
            strategy: 'graphql-reference-only',
            reference: variantLooksLikeReference ? termVariant : '',
            translations__name: '',
            first: 20,
          },
          {
            strategy: 'graphql-name-only',
            reference: '',
            translations__name: termVariant,
            first: 20,
          },
        ]
      : [
          {
            strategy: 'graphql-reference+name',
            reference: variantLooksLikeReference ? termVariant : '',
            translations__name: termVariant,
            first: 30,
          },
          {
            strategy: 'graphql-name-only',
            reference: '',
            translations__name: termVariant,
            first: 40,
          },
          {
            strategy: 'graphql-reference-only',
            reference: variantLooksLikeReference ? termVariant : '',
            translations__name: '',
            first: 40,
          },
        ];

    for (const plan of queryPlans) {
      if (!plan.reference && !plan.translations__name) continue;
      const result = await cwGraphqlRequest({
        override,
        operationName: 'ProductList',
        query: gqlProductListQuery,
        variables: {
          after: '',
          before: '',
          lang: 'en',
          sortBy: ['id'],
          minimal: true,
          first: plan.first,
          reference: plan.reference,
          translations__name: plan.translations__name,
        },
      });
      if (!productListPrimary) productListPrimary = result;
      const edges = Array.isArray(result?.body?.data?.products?.edges)
        ? result.body.data.products.edges
        : [];
      const nodes = edges.map(edge => edge?.node).filter(Boolean);

      graphqlDiscoveryAttempts.push({
        strategy: plan.strategy,
        termVariant,
        reference: plan.reference,
        translations__name: plan.translations__name,
        first: plan.first,
        status: result?.status || null,
        ok: Boolean(result?.ok),
        nodeCount: nodes.length,
        totalCount: Number(result?.body?.data?.products?.totalCount || 0),
      });

      nodes.forEach(node => {
        const key = String(node?.id || node?.reference || '').trim();
        if (!key) return;
        if (!productNodesByKey.has(key)) {
          productNodesByKey.set(key, node);
        }
      });

      if (isTurboProbe && nodes.length > 0 && plan.strategy === 'graphql-reference-only') {
        break;
      }
    }

    if (isTurboProbe && productNodesByKey.size > 0) {
      break;
    }
  }

  const productNodes = Array.from(productNodesByKey.values());
  stageTimings.graphqlMs = Date.now() - graphqlStartedAt;
  const rankedProducts = productNodes
    .map(node => ({
      node,
      score: scoreProductNode(node, searchTerm, {
        productReference: providedProductReference,
      }),
    }))
    .sort((a, b) => b.score - a.score);

  // Build a results array for the client UI (each item = one discovered product).
  // styleOptions are only populated for the top-ranked product after QC lookup.
  // Only include EN products, deduplicated by reference (keeps highest-scored).
  const buildResultsFromRanked = (ranked, topStyleOptions = [], topVersionOptions = []) => {
    const seenReferences = new Set();
    return ranked
      .map((item, index) => {
        const node = item.node || {};
        const allTranslations = Array.isArray(node.translations?.edges)
          ? node.translations.edges.map(edge => edge?.node).filter(Boolean)
          : [];
        const enTranslations = allTranslations.filter(
          t => String(t.lang || '').toLowerCase() === 'en'
        );
        return { node, enTranslations, allTranslations, index };
      })
      .filter(entry => {
        // Skip products with translations but none in EN (DE-only entries)
        if (entry.allTranslations.length > 0 && entry.enTranslations.length === 0) return false;
        // Deduplicate by reference (ranked is already sorted by score,
        // so the first occurrence of a reference is the best match)
        const ref = String(entry.node.reference || '')
          .trim()
          .toLowerCase();
        if (ref && seenReferences.has(ref)) return false;
        if (ref) seenReferences.add(ref);
        return true;
      })
      .map(entry => {
        const translations =
          entry.enTranslations.length > 0 ? entry.enTranslations : entry.allTranslations;
        const ref = String(entry.node.reference || '').trim();
        // Attach styleOptions to every result — rebind productReference per result
        const resultStyleOptions = topStyleOptions.map(opt => ({
          ...opt,
          productReference: ref || opt.productReference,
        }));
        // Attach versionOptions — rebind scopedReference per result
        const resultVersionOptions = topVersionOptions.map(opt => ({
          ...opt,
          scopedReference: `${ref}__${opt.code}`,
        }));
        // Derive all scoped references (ref__version for each version option)
        const derivedScoped =
          resultVersionOptions.length > 0
            ? resultVersionOptions.map(v => v.scopedReference)
            : [ref];
        return {
          id: entry.node.id || null,
          productReference: ref,
          productName: String(translations[0]?.name || ref || '').trim(),
          status: entry.node.status || null,
          translations,
          styleOptions: resultStyleOptions,
          versionOptions: resultVersionOptions,
          derivedScopedReferences: derivedScoped,
          configParsed: true,
        };
      });
  };

  if (rankedProducts.length > 0) {
    const sessionStartedAt = Date.now();
    const session = await createCwSession(override);
    stageTimings.sessionMs = Date.now() - sessionStartedAt;
    const selectedNode = rankedProducts[0].node;
    const productId = String(selectedNode?.id || '').trim();
    const measurementProductId = decodeCwRelayProductId(productId);
    const productReference = String(selectedNode?.reference || '').trim();
    const dashboardEditUrl = `${String(override.baseUrl || 'https://cw40.comfort-works.com').replace(/\/+$/, '')}/dashboard/#/products/edit/${encodeURIComponent(productId)}`;
    const productMeasurementsInfoUrl = `${pidBaseUrl}/product-measurements/${encodeURIComponent(measurementProductId)}`;

    // ── CW Protocol: discover styles + versions via product groups + MT models ──
    let gqlVariantStyleOptions = [];
    let gqlVersionOptions = [];
    let gqlProductGroups = null;
    let gqlMtModels = null;
    try {
      // Step 1: Fetch MT model names and filter locally by reference
      const modelNamesResult = await cwGraphqlRequest({
        override,
        operationName: null,
        query: gqlMtModelNamesQuery,
        variables: {},
      });
      const allModels = Array.isArray(modelNamesResult?.body?.data?.mtModelNamesList)
        ? modelNamesResult.body.data.mtModelNamesList
        : [];
      const refLower = productReference.toLowerCase();
      gqlMtModels = allModels.filter(m => {
        const name = String(m?.modelName || '').toLowerCase();
        const label = String(m?.label || '').toLowerCase();
        const data = String(m?.modelData || '').toLowerCase();
        return name.includes(refLower) || label.includes(refLower) || data.includes(refLower);
      });

      // Step 3: Fetch product detail with combinationTemplate optionGroups
      const detailResult = await cwGraphqlRequest({
        override,
        operationName: 'ProductDetail',
        query: gqlProductDetailQuery,
        variables: { id: productId },
      });
      const productData = detailResult?.body?.data?.product || null;
      const optionGroups = productData?.combinationTemplate?.optionGroups || [];
      // Parse each optionGroup's JSON `data` field into a usable object
      const parsedGroups = optionGroups.map(g => {
        let parsed = {};
        try {
          parsed = JSON.parse(g.data);
        } catch {
          /* ignore */
        }
        return { id: g.id, rawName: g.name, ...parsed };
      });
      gqlProductGroups = parsedGroups;

      // Find the style group (name contains "style")
      const styleGroup = parsedGroups.find(g => {
        const rawName = String(g.rawName || '').toLowerCase();
        const displayName = String(
          g.name?._translateable?.UN || g.name?._translateable?.en || ''
        ).toLowerCase();
        return rawName.includes('style') || displayName.includes('style');
      });
      if (styleGroup && Array.isArray(styleGroup.content)) {
        const seenCodes = new Set();
        styleGroup.content.forEach(item => {
          const code = String(item?.code || '').trim();
          const translatable = item?.name?._translateable || {};
          const name = String(translatable.UN || translatable.en || '').trim();
          if (!code || seenCodes.has(code.toLowerCase())) return;
          seenCodes.add(code.toLowerCase());
          gqlVariantStyleOptions.push({
            productReference,
            style: name || code,
            styleCode: code,
            label: `${productReference} - ${name || code} (${code})`,
          });
        });
      }

      // Extract version options from ALL non-style, non-fabric, non-accessory groups.
      // These are groups like "Sofa Version" (STD/PTD), "Orientation" (L/R), "Manufacturer" (PB/MG).
      // Multiple version dimensions are cross-multiplied: ref__dim1__dim2 for measurement lookup.
      const skipPatterns = [
        'style',
        'fabric',
        'smart',
        'accessori',
        'usb',
        'add-on',
        'add on',
        'upgrade',
      ];
      const versionGroups = parsedGroups.filter(g => {
        const rawName = String(g.rawName || '').toLowerCase();
        const displayName = String(
          g.name?._translateable?.UN || g.name?._translateable?.en || ''
        ).toLowerCase();
        const combined = rawName + ' ' + displayName;
        return (
          !skipPatterns.some(p => combined.includes(p)) &&
          Array.isArray(g.content) &&
          g.content.length > 0
        );
      });

      // Parse each version group's content into { code, label } arrays (skip DF placeholders)
      const versionDimensions = versionGroups
        .map(g => {
          const groupName = String(
            g.name?._translateable?.UN || g.name?._translateable?.en || g.rawName || ''
          ).trim();
          return {
            groupName,
            options: (g.content || [])
              .map(item => {
                const code = String(item?.code || '').trim();
                const translatable = item?.name?._translateable || {};
                const label = String(translatable.UN || translatable.en || '').trim();
                if (!code || looksLikePlaceholderChoice(label, code)) return null;
                return { code, label: label || code };
              })
              .filter(Boolean),
          };
        })
        .filter(d => d.options.length > 0);

      // Cross-multiply all dimensions into flat version options
      if (versionDimensions.length > 0) {
        // Start with a single empty combo, then multiply by each dimension
        let combos = [{ codes: [], labels: [] }];
        for (const dim of versionDimensions) {
          const next = [];
          for (const combo of combos) {
            for (const opt of dim.options) {
              next.push({
                codes: [...combo.codes, opt.code],
                labels: [...combo.labels, opt.label],
              });
            }
          }
          combos = next;
        }
        combos.forEach(combo => {
          const code = combo.codes.join('__');
          const label = combo.labels.join(' / ');
          const scopedRef = `${productReference}__${combo.codes.join('__')}`;
          gqlVersionOptions.push({ code, label, scopedReference: scopedRef });
        });
      }
    } catch {
      // Non-critical — style/version discovery is best-effort
    }

    if (isTurboProbe && productReference) {
      const turboFastPathStartedAt = Date.now();
      // Prioritize scoped references (with __) before base references so the
      // fast path finds versioned products quickly instead of exhausting style
      // pairs against the base reference first.
      const fastReferenceCandidatesUnsorted = Array.from(
        new Set(
          [
            providedProductReference,
            ...manualHintReferences,
            ...manualHintReferenceBases,
            productReference,
            // Include scoped references discovered from product version options (e.g. WE-HY-82__STD)
            ...gqlVersionOptions.map(v => v.scopedReference),
          ]
            .map(value => String(value || '').trim())
            .filter(Boolean)
        )
      );
      const fastReferenceCandidates = [
        ...fastReferenceCandidatesUnsorted.filter(ref => ref.includes('__')),
        ...fastReferenceCandidatesUnsorted.filter(ref => !ref.includes('__')),
      ];

      const fastStylePairs = [];
      const fastPairSeen = new Set();
      const pushFastPair = (styleRaw, styleCodeRaw) => {
        const style = String(styleRaw || '').trim();
        const styleCode = String(styleCodeRaw || '').trim();
        if (!style && !styleCode) return;
        const key = `${style.toLowerCase()}|${styleCode.toLowerCase()}`;
        if (fastPairSeen.has(key)) return;
        fastPairSeen.add(key);
        fastStylePairs.push({ style, styleCode });
      };

      if (providedStyle || providedStyleCode) {
        pushFastPair(providedStyle, providedStyleCode);
      }
      // Include styles discovered from product option groups (e.g. Urban/VELC_SP)
      gqlVariantStyleOptions.forEach(opt => pushFastPair(opt.style, opt.styleCode));
      TURBO_FASTPATH_STYLE_PAIRS.forEach(pair => pushFastPair(pair.style, pair.styleCode));

      const fastAttempts = [];
      const fastMeasurements = [];
      const fastDeadReferences = new Set();
      let activeMtToken = mtAccessToken;
      const fastQcStartedAt = Date.now();

      outerFastPath: for (const referenceCandidate of fastReferenceCandidates) {
        if (fastDeadReferences.has(referenceCandidate)) continue;
        for (const pair of fastStylePairs) {
          let attempt = await fetchMtProductQcMeasurements({
            session,
            mtApiBaseUrl: pidBaseUrl,
            productReference: referenceCandidate,
            style: pair.style,
            styleCode: pair.styleCode,
            bucketName: providedBucketName,
            mtAccessToken: activeMtToken,
          });

          if (attempt.status === 401 && !providedMtAccessToken) {
            const refreshedToken = await fetchMtAccessTokenViaCwGraphql({
              override,
              username: mtUsername,
              password: mtPassword,
              forceRefresh: true,
            });
            if (refreshedToken?.ok && refreshedToken?.accessToken) {
              activeMtToken = refreshedToken.accessToken;
              attempt = await fetchMtProductQcMeasurements({
                session,
                mtApiBaseUrl: pidBaseUrl,
                productReference: referenceCandidate,
                style: pair.style,
                styleCode: pair.styleCode,
                bucketName: providedBucketName,
                mtAccessToken: activeMtToken,
              });
            }
          }

          const bodyStatus = Number(attempt?.body?.status);
          const looksOk =
            attempt.ok &&
            (Number.isFinite(bodyStatus) ? bodyStatus >= 200 && bodyStatus < 300 : true);

          fastAttempts.push({
            productReference: referenceCandidate,
            style: pair.style,
            styleCode: pair.styleCode || null,
            status: attempt.status,
            ok: attempt.ok,
            bodyStatus: Number.isFinite(bodyStatus) ? bodyStatus : null,
            targetUrl: attempt.targetUrl,
            params: attempt.params,
            hasContent: Boolean(attempt?.body?.content),
            contentKeys:
              attempt?.body?.content && typeof attempt.body.content === 'object'
                ? Object.keys(attempt.body.content)
                : [],
            message:
              typeof attempt?.body?.message === 'string'
                ? attempt.body.message.slice(0, 240)
                : typeof attempt?.body?.error === 'string'
                  ? attempt.body.error.slice(0, 240)
                  : null,
          });

          if (isDefinitiveMtMissingProduct(attempt)) {
            fastDeadReferences.add(referenceCandidate);
            break;
          }

          if (looksOk && attempt?.body?.content) {
            const actualStyle = String(
              attempt?.body?.content?.style_name || pair.style || ''
            ).trim();
            const actualStyleCode = String(
              attempt?.body?.content?.style_code || pair.styleCode || ''
            ).trim();
            fastMeasurements.push({
              productReference: referenceCandidate,
              style: actualStyle,
              styleCode: actualStyleCode || null,
              data: attempt?.body?.content || {
                product_reference: attempt?.body?.content?.product_reference || referenceCandidate,
                style_name: actualStyle,
                style_code: actualStyleCode || null,
              },
              raw: null,
            });
            break outerFastPath;
          }
        }
      }
      stageTimings.qcMs = Date.now() - fastQcStartedAt;
      stageTimings.turboFastPathMs = Date.now() - turboFastPathStartedAt;

      if (fastMeasurements.length > 0) {
        // Extract images from QC content for turbo fast path
        const turboImages = [];
        fastMeasurements.forEach(item => {
          if (item.data) {
            extractQcImages(item.data, pidBaseUrl).forEach(url => {
              if (!turboImages.includes(url)) turboImages.push(url);
            });
          }
        });
        const fastStyleOptions = fastMeasurements.map(item => ({
          productReference: item.productReference,
          style: item.style,
          styleCode: item.styleCode || '',
          label: `${item.productReference || productReference} - ${item.style || 'Style'}${item.styleCode ? ` (${item.styleCode})` : ''}`,
        }));
        const payload = {
          success: true,
          code: 'CW_PRODUCT_MEASUREMENTS_LOOKUP_OK',
          mode: 'graphql-product-list',
          search: searchTerm,
          discovery: {
            graphqlDiscoveryAttempts: graphqlDiscoveryAttempts.slice(0, 6),
          },
          product: {
            id: productId,
            measurementId: measurementProductId,
            reference: productReference,
            status: selectedNode?.status || null,
            translations: [],
          },
          urls: {
            dashboardEditUrl,
            productMeasurementsInfoUrl,
            measurementUrls: [
              `${pidBaseUrl}/product-measurements/${encodeURIComponent(measurementProductId)}/${productReference}`,
            ],
          },
          summary: {
            productMatchCount: rankedProducts.length,
            measurementUrlCount: 1,
            discoveredSuffixCount: 0,
            discoveredTupleCount: 0,
            tupleSource: 'none',
            attemptPlanMode: 'turbo-fast-path',
            fetchedMeasurementDetailCount: 0,
            imageCount: turboImages.length,
            referenceCandidateCount: fastReferenceCandidates.length,
            scopedReferenceCount: fastReferenceCandidates.filter(ref => String(ref).includes('__'))
              .length,
            qcAttemptedCount: fastAttempts.length,
            qcDeadReferenceCount: fastDeadReferences.size,
            qcSkippedAttemptCount: 0,
            qcSkippedAttemptsByReason: {
              deadReference: 0,
              turboRefLimit: 0,
              turboScopedRefLimit: 0,
              syntheticScopedAfterBase: 0,
              turboSyntheticScopedWithoutTuple: 0,
            },
            qcMeasurementsFound: true,
            formMeasurementsFound: false,
            renderedHtmlParsed: Boolean(renderedHtmlExtraction),
            manualHintApplied: manualHintDiagnostics.applied,
            manualHintNoneTerm: manualHintDiagnostics.noneTerm,
            manualHintReferenceCount: manualHintReferences.length,
          },
          manualReferenceHints: manualHintDiagnostics,
          timings: buildTimings(),
          images: turboImages,
          qcMeasurements: fastMeasurements[0],
          qcMeasurementsByStyle: fastMeasurements,
          styleOptions: fastStyleOptions,
          referenceCandidates: fastReferenceCandidates,
          referenceCandidateOrigins: fastReferenceCandidates.map(ref => ({
            reference: ref,
            origins: [
              manualHintReferences.includes(ref)
                ? 'manualReferenceHint'
                : manualHintReferenceBases.includes(ref)
                  ? 'manualReferenceHintBase'
                  : ref === providedProductReference
                    ? 'providedProductReference'
                    : 'graphql-product-reference',
            ],
          })),
          tupleSource: 'none',
          attemptPlanMode: 'turbo-fast-path',
          selectedTuples: [],
          formMeasurements: null,
          renderedHtmlExtraction,
          mtAuth: {
            usedProvidedToken: Boolean(providedMtAccessToken),
            tokenFetchOk: Boolean(autoTokenResult?.ok),
            tokenFetchStatus: autoTokenResult?.status || null,
            tokenFetchSource: autoTokenResult?.source || null,
            tokenFetchPayloadKeys: autoTokenResult?.payloadKeys || null,
            tokenFetchBody: autoTokenResult?.body || null,
            tokenFetchAttempts: autoTokenResult?.attempts || null,
            mtUsernameUsed: mtUsername || null,
          },
          cwProtocol: {
            mtModelsFound: Array.isArray(gqlMtModels) ? gqlMtModels.length : 0,
            mtModels: (gqlMtModels || []).slice(0, 5).map(m => ({
              id: m.id,
              modelName: m.modelName,
              label: m.label,
            })),
            optionGroupsFound: Array.isArray(gqlProductGroups) ? gqlProductGroups.length : 0,
            productGroups: (gqlProductGroups || []).map(g => ({
              name: g.name,
              contentCount: Array.isArray(g.content) ? g.content.length : 0,
              subgroupCount: Array.isArray(g.subgroup) ? g.subgroup.length : 0,
            })),
            gqlStyleOptionsCount: gqlVariantStyleOptions.length,
            gqlVersionOptionsCount: gqlVersionOptions.length,
            gqlVersionOptions: gqlVersionOptions,
          },
          qcMeasurementAttempts: fastAttempts,
          measurementDetails: [],
          candidates: rankedProducts.slice(0, 8).map(item => ({
            id: item.node?.id || null,
            reference: item.node?.reference || null,
            score: item.score,
          })),
          upstream: {
            graphqlStatus: productListPrimary?.status || null,
            graphqlOk: Boolean(productListPrimary?.ok),
            graphqlDiscoveryAttempts: graphqlDiscoveryAttempts.slice(0, 6),
            pidInfoStatus: null,
            pidInfoOk: null,
          },
          upstreamBody: null,
          upstreamSnippet: null,
          results: buildResultsFromRanked(
            rankedProducts.slice(0, 8),
            fastStyleOptions,
            gqlVersionOptions
          ),
          durationMs: Date.now() - startedAt,
        };

        return res.status(200).json(
          buildSearchResponse(payload, {
            isTurboProbe,
            requestedProbeMode: probeModeState.requestedProbeMode,
          })
        );
      }
    }

    const authHeaders = mtAccessToken ? { authorization: `Bearer ${mtAccessToken}` } : {};
    const pidInfoStartedAt = Date.now();
    let infoResult = await fetchJsonOrText(productMeasurementsInfoUrl, { headers: authHeaders });
    const sessionInfo = await cwGetWithSession(
      session,
      productMeasurementsInfoUrl,
      `${String(session.baseUrl || '').replace(/\/+$/, '')}/dashboard/`
    );
    if ((sessionInfo?.rawText || '').length > (infoResult?.rawText || '').length) {
      infoResult = {
        ok: sessionInfo.ok,
        status: sessionInfo.status,
        contentType: sessionInfo.contentType,
        body: sessionInfo.body,
        rawText: sessionInfo.rawText,
      };
    }
    stageTimings.pidInfoMs = Date.now() - pidInfoStartedAt;

    const textPool = collectStrings(infoResult.body, []);
    textPool.push(infoResult.rawText || '');
    const tupleRowsFromInfo = extractTupleRowsFromHtml(infoResult.rawText, productReference);
    const pathSuffixes = new Set([
      ...extractMeasurementPathSuffixes(textPool, measurementProductId),
      ...extractMeasurementPathSuffixes(textPool, productId),
      ...extractSuffixesByReference(textPool, productReference),
      ...extractSuffixesByReferencePrefix(textPool, productReference),
    ]);
    tupleRowsFromInfo.forEach(row => {
      pathSuffixes.add(`${row.productReference},${row.style},${row.styleCode}`);
    });

    const referenceCandidates = new Set();
    const referenceCandidateOrigins = new Map();
    const addReferenceCandidate = (value, origin) => {
      const ref = String(value || '').trim();
      if (!ref) return;
      referenceCandidates.add(ref);
      if (!origin) return;
      if (!referenceCandidateOrigins.has(ref)) {
        referenceCandidateOrigins.set(ref, new Set());
      }
      referenceCandidateOrigins.get(ref).add(origin);
    };

    manualHintReferences.forEach(ref => {
      addReferenceCandidate(ref, 'manualReferenceHint');
    });
    manualHintReferenceBases.forEach(ref => {
      addReferenceCandidate(ref, 'manualReferenceHintBase');
    });

    extractReferenceVariants(textPool, providedProductReference || productReference).forEach(
      ref => {
        addReferenceCandidate(ref, 'extractReferenceVariants');
      }
    );
    if (providedProductReference) {
      addReferenceCandidate(providedProductReference, 'providedProductReference');
    }
    buildPbReferenceFamily(providedProductReference || productReference).forEach(ref => {
      addReferenceCandidate(ref, 'syntheticPbScopedFallback');
    });
    buildWeReferenceFamily(providedProductReference || productReference).forEach(ref => {
      addReferenceCandidate(ref, 'syntheticWeScopedFallback');
    });
    tupleRowsFromInfo.forEach(row => {
      addReferenceCandidate(row.productReference, 'tupleRowsFromInfo');
    });

    // Query sibling references (e.g. IK-KN-4__DF / IK-KN-4__SV / IK-KN-4__LV)
    // so QC lookup can try the correct scoped product_reference.
    const siblingSearchTerms = isTurboProbe
      ? []
      : Array.from(
          new Set(
            [
              productReference,
              `${productReference}__`,
              String(productReference || '').replace(/-[^-]+$/, ''),
              ...manualHintReferences,
              ...manualHintReferenceBases,
              ...((Array.isArray(selectedNode?.translations?.edges)
                ? selectedNode.translations.edges
                    .map(edge => String(edge?.node?.name || '').trim())
                    .filter(Boolean)
                : []) || []),
            ]
              .map(value => String(value || '').trim())
              .filter(Boolean)
          )
        );
    const siblingEdges = [];
    for (const refTerm of siblingSearchTerms) {
      const siblingRefs = await cwGraphqlRequest({
        override,
        operationName: 'ProductList',
        query: gqlProductListQuery,
        variables: {
          after: '',
          before: '',
          lang: 'en',
          sortBy: ['id'],
          minimal: true,
          first: 300,
          reference: refTerm,
          translations__name: refTerm.includes(' ') ? refTerm : '',
        },
      });
      const edges = Array.isArray(siblingRefs?.body?.data?.products?.edges)
        ? siblingRefs.body.data.products.edges
        : [];
      edges.forEach(edge => siblingEdges.push(edge));
    }
    siblingEdges.forEach(edge => {
      const ref = String(edge?.node?.reference || '').trim();
      if (!ref) return;
      if (ref === productReference || ref.startsWith(`${productReference}__`)) {
        addReferenceCandidate(ref, 'siblingGraphql');
      }
    });

    Array.from(pathSuffixes).forEach(suffix => {
      const first = String(suffix || '')
        .split(',')
        .map(part => part.trim())
        .filter(Boolean)[0];
      if (first) addReferenceCandidate(first, 'pathSuffixes');
    });

    const tupleSuffixes = Array.from(pathSuffixes).filter(suffix => {
      const parts = String(suffix || '')
        .split(',')
        .map(part => part.trim())
        .filter(Boolean);
      return parts.length >= 3;
    });
    const tupleSource = tupleRowsFromInfo.length
      ? 'pid-table-html'
      : tupleSuffixes.length
        ? 'suffix-scan'
        : 'none';

    const fullMeasurementUrls = Array.from(pathSuffixes).map(
      suffix =>
        `${pidBaseUrl}/product-measurements/${encodeURIComponent(measurementProductId)}/${suffix}`
    );

    if (fullMeasurementUrls.length === 0 && productReference) {
      fullMeasurementUrls.push(
        `${pidBaseUrl}/product-measurements/${encodeURIComponent(measurementProductId)}/${productReference}`
      );
    }

    const detailResults = [];
    const detailAuthHeaders = mtAccessToken ? { authorization: `Bearer ${mtAccessToken}` } : {};
    const detailFetchLimit = isTurboProbe ? 0 : 8;
    for (const url of fullMeasurementUrls.slice(0, detailFetchLimit)) {
      let detail = await fetchJsonOrText(url, { headers: detailAuthHeaders });
      if (!detail.body) {
        const sessionDetail = await cwGetWithSession(
          session,
          url,
          `${String(session.baseUrl || '').replace(/\/+$/, '')}/dashboard/`
        );
        if ((sessionDetail?.rawText || '').length > (detail?.rawText || '').length) {
          detail = {
            ok: sessionDetail.ok,
            status: sessionDetail.status,
            contentType: sessionDetail.contentType,
            body: sessionDetail.body,
            rawText: sessionDetail.rawText,
          };
        }
      }
      const detailImages = new Set();
      if (detail.body && typeof detail.body === 'object') {
        extractImageUrls(detail.body, detailImages);
      }
      extractImageUrlsFromText(detail.rawText, detailImages);
      const detailMeasurementCandidates = detail.body
        ? extractMeasurementCandidates(detail.body, '', [])
        : [];

      detailResults.push({
        url,
        ok: detail.ok,
        status: detail.status,
        contentType: detail.contentType,
        imageCount: detailImages.size,
        measurementCandidateCount: detailMeasurementCandidates.length,
        images: Array.from(detailImages),
        measurementCandidates: detailMeasurementCandidates.slice(0, 40),
        upstreamBody: detail.body,
        upstreamSnippet: detail.body ? null : detail.rawText.slice(0, 5000),
      });
    }

    const aggregateImages = new Set();
    detailResults.forEach(item => {
      (item.images || []).forEach(url => aggregateImages.add(url));
    });

    const styleCandidates = new Set();
    const styleCodeCandidates = new Set();
    const discoveredStylePairs = new Set();
    tupleRowsFromInfo.forEach(row => {
      discoveredStylePairs.add(
        `${String(row.style || '')
          .trim()
          .toLowerCase()}|${String(row.styleCode || '')
          .trim()
          .toLowerCase()}`
      );
    });
    if (providedStyle) styleCandidates.add(providedStyle);
    if (providedStyleCode) styleCodeCandidates.add(providedStyleCode);
    Array.from(pathSuffixes).forEach(suffix => {
      const parts = String(suffix || '')
        .split(',')
        .map(part => part.trim())
        .filter(Boolean);
      const style = parts.length >= 2 ? parts[1] : '';
      const styleCode = parts.length >= 3 ? parts[2] : '';
      if (style) styleCandidates.add(style);
      if (styleCode) styleCodeCandidates.add(styleCode);
      if (style || styleCode) {
        discoveredStylePairs.add(
          `${String(style || '')
            .trim()
            .toLowerCase()}|${String(styleCode || '')
            .trim()
            .toLowerCase()}`
        );
      }
    });
    if (!styleCandidates.size) {
      styleCandidates.add('Original');
      styleCandidates.add('Signature');
    }
    if (!styleCodeCandidates.size) {
      styleCodeCandidates.add('');
      styleCodeCandidates.add('SHRT_SP');
      styleCodeCandidates.add('CNRP_SP');
      styleCodeCandidates.add('SDPT_SP');
      styleCodeCandidates.add('VELC_SP');
      styleCodeCandidates.add('SP');
    }

    const pairCandidates = [];
    const seenPairs = new Set();
    const pushPair = (styleRaw, styleCodeRaw) => {
      const style = String(styleRaw || '').trim();
      const styleCode = String(styleCodeRaw || '').trim();
      const key = `${style.toLowerCase()}|${styleCode.toLowerCase()}`;
      if (seenPairs.has(key)) return;
      seenPairs.add(key);
      pairCandidates.push({ style, styleCode });
    };

    if (providedStyle || providedStyleCode) {
      pushPair(providedStyle, providedStyleCode);
    }
    discoveredStylePairs.forEach(pair => {
      const [style = '', styleCode = ''] = String(pair || '').split('|');
      pushPair(style, styleCode);
    });
    if (isPbReferenceFamily(providedProductReference || productReference)) {
      pushPair('Classic', 'CNRP_PM');
      pushPair('Minimalist', 'LSKT_SP');
    }
    if (isWeReferenceFamily(providedProductReference || productReference)) {
      pushPair('Original', 'VELC_SP');
    }

    const hasScopedReferences = Array.from(referenceCandidates).some(ref =>
      String(ref).includes('__')
    );

    // If product pages do not expose scoped references clearly, synthesize the
    // common variant refs used in CW product matrices so tuple attempts can
    // still target valid MT records (e.g. IK-KN-4__DF/__SV/__LV).
    if (!hasScopedReferences && productReference && !isTurboProbe) {
      ['DF', 'SV', 'LV'].forEach(code => {
        addReferenceCandidate(`${productReference}__${code}`, 'syntheticScopedFallback');
      });
    }
    if (!pairCandidates.length) {
      if (isTurboProbe) {
        pushPair('Original', 'SHRT_SP');
        pushPair('Signature', 'CNRP_SP');
        pushPair('Original', 'SP');
        pushPair('Signature', 'SP');
      } else {
        // Default matrix prioritizes common base-reference styles first.
        // Scoped references are still attempted later when needed.
        pushPair('Signature', 'CNRP_SP');
        pushPair('Original', 'SHRT_SP');
        pushPair('Signature', 'SDPT_SP');
        pushPair('Original', 'VELC_SP');
        pushPair('Original', 'MLTP_PM');
        pushPair('Minimalist', 'LSKT_SI');
        pushPair('Urban', '');
        pushPair('Urban', 'SP');
        pushPair('Original', 'SP');
        pushPair('Signature', 'SP');
        pushPair('Original', '');
        pushPair('Signature', '');
      }
    }

    const qcMeasurementAttempts = [];
    const qcMeasurementsByStyle = [];
    let activeMtToken = mtAccessToken;
    let attemptCount = 0;
    const deadReferences = new Set();
    const referenceAttemptCounts = new Map();
    const qcSkipDiagnostics = {
      deadReference: 0,
      turboRefLimit: 0,
      turboScopedRefLimit: 0,
      syntheticScopedAfterBase: 0,
      turboSyntheticScopedWithoutTuple: 0,
    };

    const syntheticOnlyScopedRefs = new Set(
      Array.from(referenceCandidates).filter(ref => {
        const value = String(ref || '').trim();
        if (!value.includes('__')) return false;
        const origins = Array.from(referenceCandidateOrigins.get(value) || []);
        if (!origins.length) return false;
        return origins.every(origin => origin === 'syntheticScopedFallback');
      })
    );

    const orderedReferenceCandidates = Array.from(referenceCandidates);
    orderedReferenceCandidates.sort((a, b) => {
      const rankRef = ref => {
        const value = String(ref || '').trim();
        const scoped = value.includes('__');
        if (productReference && value.toLowerCase() === productReference.toLowerCase()) return 0;
        if (!scoped) return 1;
        if (syntheticOnlyScopedRefs.has(value)) return 3;
        return 2;
      };
      const aRank = rankRef(a);
      const bRank = rankRef(b);
      if (aRank !== bRank) return aRank - bRank;
      return String(a).localeCompare(String(b));
    });
    if (!orderedReferenceCandidates.length && productReference) {
      orderedReferenceCandidates.push(productReference);
    }
    if (providedProductReference && orderedReferenceCandidates.includes(providedProductReference)) {
      orderedReferenceCandidates.splice(
        orderedReferenceCandidates.indexOf(providedProductReference),
        1
      );
      orderedReferenceCandidates.unshift(providedProductReference);
    }

    const explicitTuplePlan = [];
    const explicitTupleSeen = new Set();
    const pushTuplePlan = (productReferenceCandidate, styleCandidate, styleCodeCandidate) => {
      const ref = String(productReferenceCandidate || '').trim();
      const style = String(styleCandidate || '').trim();
      const styleCode = String(styleCodeCandidate || '').trim();
      if (!ref || !style || !styleCode) return;
      const key = `${ref.toLowerCase()}|${style.toLowerCase()}|${styleCode.toLowerCase()}`;
      if (explicitTupleSeen.has(key)) return;
      explicitTupleSeen.add(key);
      explicitTuplePlan.push({ productReference: ref, style, styleCode });
    };

    tupleSuffixes.forEach(suffix => {
      const parts = String(suffix || '')
        .split(',')
        .map(part => part.trim())
        .filter(Boolean);
      if (parts.length < 3) return;
      pushTuplePlan(parts[0], parts[1], parts[2]);
    });

    // Build a broad fallback matrix as a second stage so base references are still
    // tested even when tuple-derived (or synthetic scoped) references exist.
    const fallbackPlan = orderedReferenceCandidates.flatMap(productReferenceCandidate =>
      pairCandidates.map(pair => ({
        productReference: productReferenceCandidate,
        style: pair.style,
        styleCode: pair.styleCode,
      }))
    );

    let attemptPlan = [...explicitTuplePlan, ...fallbackPlan];
    const attemptPlanMode = explicitTuplePlan.length ? 'tuple-plus-fallback' : 'fallback';

    const attemptPlanSeen = new Set(
      attemptPlan.map(
        item =>
          `${String(item.productReference || '').toLowerCase()}|${String(item.style || '').toLowerCase()}|${String(item.styleCode || '').toLowerCase()}`
      )
    );
    const enqueueTupleSuffix = suffix => {
      const parts = String(suffix || '')
        .split(',')
        .map(part => part.trim())
        .filter(Boolean);
      if (parts.length < 3) return;
      const candidate = {
        productReference: parts[0],
        style: parts[1],
        styleCode: parts[2],
      };
      const key = `${String(candidate.productReference || '').toLowerCase()}|${String(candidate.style || '').toLowerCase()}|${String(candidate.styleCode || '').toLowerCase()}`;
      if (attemptPlanSeen.has(key)) return;
      attemptPlanSeen.add(key);
      attemptPlan.push(candidate);
    };

    const explicitTupleRefs = new Set(
      explicitTuplePlan.map(item =>
        String(item?.productReference || '')
          .trim()
          .toLowerCase()
      )
    );
    let successfulBaseReference = false;
    let successfulQcCount = 0;

    const maxQcAttempts = isTurboProbe ? TURBO_MAX_QC_ATTEMPTS : MAX_QC_ATTEMPTS;
    const qcStartedAt = Date.now();
    for (let planIndex = 0; planIndex < attemptPlan.length; planIndex += 1) {
      const entry = attemptPlan[planIndex];
      const productReferenceCandidate = String(entry.productReference || '').trim();
      const styleCandidate = String(entry.style || '').trim();
      const styleCodeCandidate = String(entry.styleCode || '').trim();

      const isScopedRef = productReferenceCandidate.includes('__');
      const isSyntheticScoped = syntheticOnlyScopedRefs.has(productReferenceCandidate);
      const hasExplicitTuple = explicitTupleRefs.has(productReferenceCandidate.toLowerCase());

      if (deadReferences.has(productReferenceCandidate)) {
        qcSkipDiagnostics.deadReference += 1;
        continue;
      }

      if (isTurboProbe) {
        const refAttempts = Number(referenceAttemptCounts.get(productReferenceCandidate) || 0);
        const scopedLimit =
          isScopedRef && !hasExplicitTuple
            ? TURBO_MAX_ATTEMPTS_PER_SCOPED_REFERENCE
            : TURBO_MAX_ATTEMPTS_PER_REFERENCE;
        if (isScopedRef && !hasExplicitTuple && refAttempts >= scopedLimit) {
          qcSkipDiagnostics.turboScopedRefLimit += 1;
          continue;
        }
        if (refAttempts >= TURBO_MAX_ATTEMPTS_PER_REFERENCE) {
          qcSkipDiagnostics.turboRefLimit += 1;
          continue;
        }
      }

      if (isTurboProbe && isScopedRef && isSyntheticScoped && !hasExplicitTuple) {
        qcSkipDiagnostics.turboSyntheticScopedWithoutTuple += 1;
        continue;
      }

      if (successfulBaseReference && isScopedRef && isSyntheticScoped && !hasExplicitTuple) {
        qcSkipDiagnostics.syntheticScopedAfterBase += 1;
        continue;
      }

      if (attemptCount >= maxQcAttempts) break;
      attemptCount += 1;
      referenceAttemptCounts.set(
        productReferenceCandidate,
        Number(referenceAttemptCounts.get(productReferenceCandidate) || 0) + 1
      );

      let attempt = await fetchMtProductQcMeasurements({
        session,
        mtApiBaseUrl: pidBaseUrl,
        productReference: productReferenceCandidate,
        style: styleCandidate,
        styleCode: styleCodeCandidate,
        bucketName: providedBucketName,
        mtAccessToken: activeMtToken,
      });

      if (attempt.status === 401 && !providedMtAccessToken) {
        const refreshedToken = await fetchMtAccessTokenViaCwGraphql({
          override,
          username: mtUsername,
          password: mtPassword,
          forceRefresh: true,
        });
        if (refreshedToken?.ok && refreshedToken?.accessToken) {
          activeMtToken = refreshedToken.accessToken;
          attempt = await fetchMtProductQcMeasurements({
            session,
            mtApiBaseUrl: pidBaseUrl,
            productReference: productReferenceCandidate,
            style: styleCandidate,
            styleCode: styleCodeCandidate,
            bucketName: providedBucketName,
            mtAccessToken: activeMtToken,
          });
        }
      }
      const bodyStatus = Number(attempt?.body?.status);
      const looksOk =
        attempt.ok && (Number.isFinite(bodyStatus) ? bodyStatus >= 200 && bodyStatus < 300 : true);

      qcMeasurementAttempts.push({
        productReference: productReferenceCandidate,
        style: styleCandidate,
        styleCode: styleCodeCandidate || null,
        status: attempt.status,
        ok: attempt.ok,
        bodyStatus: Number.isFinite(bodyStatus) ? bodyStatus : null,
        targetUrl: attempt.targetUrl,
        params: attempt.params,
        hasContent: Boolean(attempt?.body?.content),
        contentKeys:
          attempt?.body?.content && typeof attempt.body.content === 'object'
            ? Object.keys(attempt.body.content)
            : [],
        message:
          typeof attempt?.body?.message === 'string'
            ? attempt.body.message.slice(0, 240)
            : typeof attempt?.body?.error === 'string'
              ? attempt.body.error.slice(0, 240)
              : null,
        bodyPreview: (() => {
          try {
            return JSON.stringify(attempt?.body || {}).slice(0, 240);
          } catch {
            return null;
          }
        })(),
      });

      if (!looksOk && Number(bodyStatus) === 400) {
        const discoveredTuples = extractTupleSuffixesFromPayload(attempt?.body, productReference);
        discoveredTuples.forEach(enqueueTupleSuffix);
      }

      if (isDefinitiveMtMissingProduct(attempt)) {
        deadReferences.add(productReferenceCandidate);
      }

      if (looksOk && attempt?.body?.content) {
        if (!isScopedRef) {
          successfulBaseReference = true;
        }
        const actualStyle = String(
          attempt?.body?.content?.style_name || styleCandidate || ''
        ).trim();
        const actualStyleCode = String(
          attempt?.body?.content?.style_code || styleCodeCandidate || ''
        ).trim();
        const entry = {
          productReference: productReferenceCandidate,
          style: actualStyle,
          styleCode: actualStyleCode || null,
          data: isTurboProbe
            ? {
                product_reference:
                  attempt?.body?.content?.product_reference || productReferenceCandidate,
                style_name: actualStyle,
                style_code: actualStyleCode || null,
              }
            : attempt.body.content,
          raw: isTurboProbe ? null : attempt.body,
        };
        const key = `${String(entry.productReference || '').toLowerCase()}|${String(entry.style || '').toLowerCase()}|${String(entry.styleCode || '').toLowerCase()}`;
        if (
          !qcMeasurementsByStyle.some(
            item =>
              `${String(item.productReference || '').toLowerCase()}|${String(item.style || '').toLowerCase()}|${String(item.styleCode || '').toLowerCase()}` ===
              key
          )
        ) {
          qcMeasurementsByStyle.push(entry);
          successfulQcCount += 1;
          if (isTurboProbe && successfulQcCount >= TURBO_QC_SUCCESS_TARGET) {
            break;
          }
        }
      }
    }
    stageTimings.qcMs = Date.now() - qcStartedAt;

    let qcMeasurement = null;
    if (providedStyle || providedStyleCode) {
      qcMeasurement =
        qcMeasurementsByStyle.find(item => {
          const referenceOk = providedProductReference
            ? String(item.productReference || '').toLowerCase() ===
              providedProductReference.toLowerCase()
            : true;
          const styleOk = providedStyle
            ? String(item.style || '').toLowerCase() === providedStyle.toLowerCase()
            : true;
          const codeOk = providedStyleCode
            ? String(item.styleCode || '').toLowerCase() === providedStyleCode.toLowerCase()
            : true;
          return referenceOk && styleOk && codeOk;
        }) || null;
    }
    if (!qcMeasurement) {
      qcMeasurement =
        qcMeasurementsByStyle.find(
          item => String(item.styleCode || '').toUpperCase() === 'CNRP_SP'
        ) ||
        qcMeasurementsByStyle[0] ||
        null;
    }
    const styleOptionMap = new Map();
    qcMeasurementsByStyle.forEach(item => {
      const optionReference = String(item.productReference || '').trim();
      const style = String(item.style || '').trim();
      const styleCode = String(item.styleCode || '').trim();
      const key = `${optionReference.toLowerCase()}|${style.toLowerCase()}|${styleCode.toLowerCase()}`;
      styleOptionMap.set(key, {
        productReference: optionReference,
        style,
        styleCode,
        label: `${optionReference || productReference} - ${style || 'Style'}${styleCode ? ` (${styleCode})` : ''}`,
      });
    });
    discoveredStylePairs.forEach(key => {
      const [style = '', styleCode = ''] = String(key).split('|');
      orderedReferenceCandidates.forEach(reference => {
        const mapKey = `${String(reference || '').toLowerCase()}|${String(style || '').toLowerCase()}|${String(styleCode || '').toLowerCase()}`;
        if (styleOptionMap.has(mapKey)) return;
        styleOptionMap.set(mapKey, {
          productReference: reference,
          style,
          styleCode,
          label: `${reference || 'Reference'} - ${style || 'Style'}${styleCode ? ` (${styleCode})` : ''}`,
        });
      });
    });
    let styleOptions = Array.from(styleOptionMap.values());

    // When no styles were discovered from QC or product pages, use styles
    // from the GraphQL product detail query (variant attributes). Fall back
    // to common defaults only as a last resort.
    if (styleOptions.length === 0 && gqlVariantStyleOptions.length > 0) {
      styleOptions = gqlVariantStyleOptions;
    }

    const existingDetailUrls = new Set(detailResults.map(item => String(item.url || '').trim()));
    const extraDetailUrls = new Set();
    styleOptions.forEach(option => {
      const reference = String(option?.productReference || '').trim() || productReference;
      const style = String(option?.style || '').trim();
      const styleCode = String(option?.styleCode || '').trim();
      if (!style && !styleCode) return;
      const suffixParts = [reference];
      if (style) suffixParts.push(style);
      if (styleCode) suffixParts.push(styleCode);
      const suffix = suffixParts.join(',');
      if (!suffix) return;
      extraDetailUrls.add(
        `${pidBaseUrl}/product-measurements/${encodeURIComponent(measurementProductId)}/${suffix}`
      );
    });

    for (const url of isTurboProbe ? [] : Array.from(extraDetailUrls)) {
      if (existingDetailUrls.has(url)) continue;

      const detailAuthHeaders = activeMtToken ? { authorization: `Bearer ${activeMtToken}` } : {};
      let detail = await fetchJsonOrText(url, { headers: detailAuthHeaders });
      let detailImages = new Set();
      if (detail.body && typeof detail.body === 'object') {
        extractImageUrls(detail.body, detailImages);
      }
      extractImageUrlsFromText(detail.rawText, detailImages);

      // Try CW-session fetch if plain fetch produced no image URLs.
      if (!detailImages.size) {
        const sessionDetail = await cwGetWithSession(
          session,
          url,
          `${String(session.baseUrl || '').replace(/\/+$/, '')}/dashboard/`
        );
        if (sessionDetail?.body && typeof sessionDetail.body === 'object') {
          extractImageUrls(sessionDetail.body, detailImages);
        }
        extractImageUrlsFromText(sessionDetail?.rawText || '', detailImages);

        // Keep the richer content for diagnostics when available.
        if ((sessionDetail?.rawText || '').length > (detail?.rawText || '').length) {
          detail = {
            ok: sessionDetail.ok,
            status: sessionDetail.status,
            contentType: sessionDetail.contentType,
            body: sessionDetail.body,
            rawText: sessionDetail.rawText,
          };
        }
      }

      const detailMeasurementCandidates = detail.body
        ? extractMeasurementCandidates(detail.body, '', [])
        : [];

      const detailEntry = {
        url,
        ok: detail.ok,
        status: detail.status,
        contentType: detail.contentType,
        imageCount: detailImages.size,
        measurementCandidateCount: detailMeasurementCandidates.length,
        images: Array.from(detailImages),
        measurementCandidates: detailMeasurementCandidates.slice(0, 40),
        upstreamBody: detail.body,
        upstreamSnippet: detail.body ? null : detail.rawText.slice(0, 5000),
      };
      detailResults.push(detailEntry);
      detailEntry.images.forEach(imgUrl => aggregateImages.add(imgUrl));
    }

    let formMeasurements = null;
    if (providedFormId && !isTurboProbe) {
      try {
        const measurements = await fetchCwMeasurementsTable({
          formId: providedFormId,
          override,
          lang: String(body?.lang || req.query?.lang || 'en').trim() || 'en',
        });
        const sourceProducts = Array.isArray(measurements.content?.products_list)
          ? measurements.content.products_list
          : Array.isArray(measurements.content?.products)
            ? measurements.content.products
            : [];

        const termNorm = normalizeText(searchTerm);
        const termTokens = tokenize(searchTerm);
        const rankedFormProducts = sourceProducts
          .map(product => {
            const reference = String(product?.reference || '').trim();
            const label = String(product?.label || product?.name || '').trim();
            if (productReference) {
              const exactRef = reference.toLowerCase() === productReference.toLowerCase();
              const scopedRef = reference
                .toLowerCase()
                .startsWith(`${productReference.toLowerCase()}__`);
              if (!exactRef && !scopedRef) {
                return null;
              }
            }
            const payloadText = JSON.stringify(product || {});
            let score = scoreFromHaystack(
              `${reference} ${label} ${payloadText}`,
              termNorm,
              termTokens
            );
            if (reference && reference === productReference) score += 200;
            if (!score) return null;
            return {
              score,
              reference,
              label,
              measurementData: product?.measurement_data || null,
              product,
            };
          })
          .filter(Boolean)
          .sort((a, b) => b.score - a.score);

        if (rankedFormProducts.length > 0) {
          formMeasurements = {
            formId: providedFormId,
            matchedProduct: rankedFormProducts[0],
            alternatives: rankedFormProducts.slice(1, 5),
          };
        }
      } catch (error) {
        formMeasurements = {
          formId: providedFormId,
          error: String(error?.message || error),
        };
      }
    }

    const payload = {
      success: true,
      code: 'CW_PRODUCT_MEASUREMENTS_LOOKUP_OK',
      mode: 'graphql-product-list',
      search: searchTerm,
      discovery: {
        graphqlDiscoveryAttempts: isTurboProbe
          ? graphqlDiscoveryAttempts.slice(0, 6)
          : graphqlDiscoveryAttempts,
      },
      product: {
        id: productId,
        measurementId: measurementProductId,
        reference: productReference,
        status: selectedNode?.status || null,
        translations: isTurboProbe
          ? []
          : (selectedNode?.translations?.edges || []).map(edge => edge?.node).filter(Boolean),
      },
      urls: {
        dashboardEditUrl,
        productMeasurementsInfoUrl,
        measurementUrls: isTurboProbe ? fullMeasurementUrls.slice(0, 1) : fullMeasurementUrls,
      },
      summary: {
        productMatchCount: rankedProducts.length,
        measurementUrlCount: fullMeasurementUrls.length,
        discoveredSuffixCount: pathSuffixes.size,
        discoveredTupleCount: tupleSuffixes.length,
        tupleSource,
        attemptPlanMode,
        fetchedMeasurementDetailCount: detailResults.length,
        imageCount: aggregateImages.size,
        referenceCandidateCount: orderedReferenceCandidates.length,
        scopedReferenceCount: orderedReferenceCandidates.filter(ref => String(ref).includes('__'))
          .length,
        qcAttemptedCount: qcMeasurementAttempts.length,
        qcDeadReferenceCount: deadReferences.size,
        qcSkippedAttemptCount: Object.values(qcSkipDiagnostics).reduce(
          (acc, value) => acc + value,
          0
        ),
        qcSkippedAttemptsByReason: qcSkipDiagnostics,
        qcMeasurementsFound: Boolean(qcMeasurement),
        formMeasurementsFound: Boolean(formMeasurements?.matchedProduct),
        renderedHtmlParsed: Boolean(renderedHtmlExtraction),
        manualHintApplied: manualHintDiagnostics.applied,
        manualHintNoneTerm: manualHintDiagnostics.noneTerm,
        manualHintReferenceCount: manualHintReferences.length,
      },
      manualReferenceHints: manualHintDiagnostics,
      timings: buildTimings(),
      images: Array.from(aggregateImages),
      qcMeasurements: qcMeasurement,
      qcMeasurementsByStyle,
      styleOptions,
      referenceCandidates: orderedReferenceCandidates,
      referenceCandidateOrigins: orderedReferenceCandidates.map(ref => ({
        reference: ref,
        origins: Array.from(referenceCandidateOrigins.get(ref) || []),
      })),
      tupleSource,
      attemptPlanMode,
      selectedTuples: explicitTuplePlan,
      formMeasurements,
      renderedHtmlExtraction,
      mtAuth: {
        usedProvidedToken: Boolean(providedMtAccessToken),
        tokenFetchOk: Boolean(autoTokenResult?.ok),
        tokenFetchStatus: autoTokenResult?.status || null,
        tokenFetchSource: autoTokenResult?.source || null,
        tokenFetchPayloadKeys: autoTokenResult?.payloadKeys || null,
        tokenFetchBody: autoTokenResult?.body || null,
        tokenFetchAttempts: autoTokenResult?.attempts || null,
        mtUsernameUsed: mtUsername || null,
      },
      cwProtocol: {
        mtModelsFound: Array.isArray(gqlMtModels) ? gqlMtModels.length : 0,
        mtModels: (gqlMtModels || []).slice(0, 5).map(m => ({
          id: m.id,
          modelName: m.modelName,
          label: m.label,
        })),
        optionGroupsFound: Array.isArray(gqlProductGroups) ? gqlProductGroups.length : 0,
        optionGroups: (gqlProductGroups || []).map(g => ({
          name: g.rawName || g.name,
          displayName: g.name?._translateable?.UN || null,
          contentCount: Array.isArray(g.content) ? g.content.length : 0,
        })),
        gqlStyleOptionsCount: gqlVariantStyleOptions.length,
        gqlVersionOptionsCount: gqlVersionOptions.length,
        gqlVersionOptions: gqlVersionOptions,
      },
      qcMeasurementAttempts,
      measurementDetails: isTurboProbe ? [] : detailResults,
      candidates: rankedProducts.slice(0, isTurboProbe ? 8 : rankedProducts.length).map(item => ({
        id: item.node?.id || null,
        reference: item.node?.reference || null,
        score: item.score,
      })),
      upstream: {
        graphqlStatus: productListPrimary?.status || null,
        graphqlOk: Boolean(productListPrimary?.ok),
        graphqlDiscoveryAttempts: isTurboProbe
          ? graphqlDiscoveryAttempts.slice(0, 6)
          : graphqlDiscoveryAttempts,
        pidInfoStatus: infoResult.status,
        pidInfoOk: infoResult.ok,
      },
      upstreamBody: isTurboProbe
        ? null
        : {
            graphql: productListPrimary?.body || null,
            pidInfo: infoResult.body,
          },
      upstreamSnippet: isTurboProbe
        ? null
        : infoResult.body
          ? null
          : infoResult.rawText.slice(0, 5000),
      results: buildResultsFromRanked(
        rankedProducts.slice(0, isTurboProbe ? 8 : rankedProducts.length),
        styleOptions,
        gqlVersionOptions
      ),
      durationMs: Date.now() - startedAt,
    };

    return res.status(200).json(
      buildSearchResponse(payload, {
        isTurboProbe,
        requestedProbeMode: probeModeState.requestedProbeMode,
      })
    );
  }

  if (isTurboProbe) {
    const payload = {
      success: false,
      code: 'CW_PRODUCT_MEASUREMENT_NOT_FOUND',
      message: 'No product measurement URL matched the provided search term',
      search: searchTerm,
      formId: providedFormId || null,
      discovery: {
        graphqlDiscoveryAttempts: graphqlDiscoveryAttempts.slice(0, 6),
        dashboardCrawlAttempts: 0,
      },
      turboOptimization: {
        skippedDashboardCrawl: true,
      },
      manualReferenceHints: manualHintDiagnostics,
      timings: buildTimings(),
      crawl: [],
      candidates: [],
      durationMs: Date.now() - startedAt,
    };
    return res.status(404).json(
      buildSearchResponse(payload, {
        isTurboProbe,
        requestedProbeMode: probeModeState.requestedProbeMode,
      })
    );
  }

  const session = await createCwSession(override);
  const baseUrl = String(session.baseUrl || '').replace(/\/+$/, '');

  const directMeasurementUrl =
    searchTerm.includes('/product-measurements/') || searchTerm.startsWith('http')
      ? toAbsoluteUrl(baseUrl, searchTerm)
      : '';

  let selectedUrl = directMeasurementUrl;
  const candidates = [];
  const crawl = [];

  if (!selectedUrl) {
    const searchUrls = collectSearchUrls(baseUrl, searchTerm);
    for (const url of searchUrls) {
      const page = await cwGetWithSession(session, url);
      crawl.push({
        strategy: 'dashboard-crawl',
        url,
        status: page.status,
        ok: page.ok,
        contentType: page.contentType || '',
      });
      if (!page.rawText) continue;

      const links = extractProductMeasurementLinks(page.rawText, baseUrl);
      links.forEach(link => {
        const score = scoreCandidate(link, searchTerm);
        candidates.push({ url: link, score, sourceUrl: url });
      });
    }

    const unique = new Map();
    candidates.forEach(item => {
      const prev = unique.get(item.url);
      if (!prev || item.score > prev.score) {
        unique.set(item.url, item);
      }
    });

    const ranked = Array.from(unique.values()).sort((a, b) => b.score - a.score);
    if (ranked.length > 0) {
      selectedUrl = ranked[0].url;
    }

    candidates.length = 0;
    ranked.forEach(item => candidates.push(item));
  }

  if (!selectedUrl && providedFormId) {
    const measurements = await fetchCwMeasurementsTable({ formId: providedFormId, override });
    const orderImages = await fetchOrderImagesByFormId({ formId: providedFormId, override });
    const mapped = mapOrderImagesToMeasurementItems(measurements.content, orderImages.lines);

    const sourceProducts = Array.isArray(measurements.content?.products_list)
      ? measurements.content.products_list
      : Array.isArray(measurements.content?.products)
        ? measurements.content.products
        : [];

    const termNorm = normalizeText(searchTerm);
    const termTokens = tokenize(searchTerm);
    const lineById = new Map(
      (Array.isArray(orderImages.lines) ? orderImages.lines : []).map(line => [
        String(line.lineId),
        line,
      ])
    );
    const lineIdToReference = new Map(
      Object.entries(mapped.lineMappingByItemCode || {})
        .filter(([, value]) => value && value.lineId)
        .map(([reference, value]) => [String(value.lineId), reference])
    );

    const productMatches = sourceProducts
      .map(product => {
        const reference = String(product?.reference || '').trim();
        const label = String(product?.label || product?.name || '').trim();
        const payloadText = JSON.stringify(product || {});
        const score = scoreFromHaystack(
          `${reference} ${label} ${payloadText}`,
          termNorm,
          termTokens
        );
        if (!score) return null;
        const mappedLine = mapped.lineMappingByItemCode?.[reference] || null;
        const line = mappedLine?.lineId ? lineById.get(String(mappedLine.lineId)) : null;
        return {
          source: 'product',
          score,
          reference,
          label,
          measurementData: product?.measurement_data || null,
          images: mapped.byItemCode?.[reference] || [],
          lineMapping: mappedLine,
          lineProductName: line?.productName || null,
        };
      })
      .filter(Boolean);

    const lineMatches = (Array.isArray(orderImages.lines) ? orderImages.lines : [])
      .map(line => {
        const lineId = String(line?.lineId || '').trim();
        const lineName = String(line?.productName || '').trim();
        const score = scoreFromHaystack(`${lineName} ${lineId}`, termNorm, termTokens);
        if (!score) return null;
        const reference = lineIdToReference.get(lineId) || '';
        const fallbackProduct =
          !reference && sourceProducts.length === 1
            ? sourceProducts[0]
            : sourceProducts.find(product => String(product?.reference || '').trim() === reference);
        return {
          source: 'order-line',
          score,
          reference: reference || String(fallbackProduct?.reference || '').trim(),
          label: String(fallbackProduct?.label || fallbackProduct?.name || lineName || '').trim(),
          measurementData: fallbackProduct?.measurement_data || null,
          images: reference ? mapped.byItemCode?.[reference] || [] : line?.images || [],
          lineMapping: { lineId, productName: lineName },
          lineProductName: lineName || null,
        };
      })
      .filter(Boolean);

    const uniqueByKey = new Map();
    [...productMatches, ...lineMatches].forEach(item => {
      const key = `${item.reference || ''}|${item.lineMapping?.lineId || ''}|${item.source}`;
      const previous = uniqueByKey.get(key);
      if (!previous || item.score > previous.score) {
        uniqueByKey.set(key, item);
      }
    });

    const matches = Array.from(uniqueByKey.values()).sort((a, b) => b.score - a.score);

    if (matches.length > 0) {
      const payload = {
        success: true,
        code: 'CW_PRODUCT_MEASUREMENTS_LOOKUP_OK',
        mode: 'form-measurements-fallback',
        search: searchTerm,
        formId: providedFormId,
        summary: {
          matchCount: matches.length,
          topReference: matches[0]?.reference || null,
          topLabel: matches[0]?.label || null,
          topSource: matches[0]?.source || null,
          manualHintApplied: manualHintDiagnostics.applied,
          manualHintNoneTerm: manualHintDiagnostics.noneTerm,
          manualHintReferenceCount: manualHintReferences.length,
        },
        manualReferenceHints: manualHintDiagnostics,
        timings: buildTimings(),
        matches,
        candidates,
        crawl,
        results: matches.map(match => ({
          id: null,
          productReference: String(match.reference || '').trim(),
          productName: String(match.label || match.lineProductName || match.reference || '').trim(),
          status: null,
          translations: [],
          styleOptions: [],
          versionOptions: [],
          derivedScopedReferences: [],
          configParsed: false,
        })),
        durationMs: Date.now() - startedAt,
      };
      return res.status(200).json(
        buildSearchResponse(payload, {
          isTurboProbe,
          requestedProbeMode: probeModeState.requestedProbeMode,
        })
      );
    }

    const payload = {
      success: false,
      code: 'CW_PRODUCT_MEASUREMENT_NOT_FOUND',
      message: 'No product measurement URL matched the provided search term',
      search: searchTerm,
      formId: providedFormId || null,
      discovery: {
        graphqlDiscoveryAttempts,
        dashboardCrawlAttempts: crawl.length,
      },
      crawl,
      candidates,
      fallbackSummary: {
        productsCount: sourceProducts.length,
        orderLinesCount: Array.isArray(orderImages.lines) ? orderImages.lines.length : 0,
        productReferences: sourceProducts
          .map(product => String(product?.reference || '').trim())
          .filter(Boolean),
        productLabels: sourceProducts
          .map(product => String(product?.label || product?.name || '').trim())
          .filter(Boolean),
        orderLineNames: (Array.isArray(orderImages.lines) ? orderImages.lines : [])
          .map(line => String(line?.productName || '').trim())
          .filter(Boolean),
      },
      manualReferenceHints: manualHintDiagnostics,
      timings: buildTimings(),
      durationMs: Date.now() - startedAt,
    };
    return res.status(404).json(
      buildSearchResponse(payload, {
        isTurboProbe,
        requestedProbeMode: probeModeState.requestedProbeMode,
      })
    );
  }

  if (!selectedUrl) {
    const payload = {
      success: false,
      code: 'CW_PRODUCT_MEASUREMENT_NOT_FOUND',
      message: 'No product measurement URL matched the provided search term',
      search: searchTerm,
      formId: providedFormId || null,
      discovery: {
        graphqlDiscoveryAttempts,
        dashboardCrawlAttempts: crawl.length,
      },
      manualReferenceHints: manualHintDiagnostics,
      timings: buildTimings(),
      crawl,
      candidates,
      durationMs: Date.now() - startedAt,
    };
    return res.status(404).json(
      buildSearchResponse(payload, {
        isTurboProbe,
        requestedProbeMode: probeModeState.requestedProbeMode,
      })
    );
  }

  const detail = await cwGetWithSession(session, selectedUrl, `${baseUrl}/dashboard/products/`);
  const imageUrls = new Set();
  const htmlImageMatches =
    detail.rawText.match(
      /https?:\/\/[^"'\s>]+\.(?:png|jpe?g|webp|gif|bmp|svg)(?:\?[^"'\s>]*)?/gi
    ) || [];
  htmlImageMatches.forEach(url => imageUrls.add(url));
  if (detail.body && typeof detail.body === 'object') {
    extractImageUrls(detail.body, imageUrls);
  }

  const measurementCandidates = detail.body
    ? extractMeasurementCandidates(detail.body, '', [])
    : [];

  const payload = {
    success: detail.ok,
    code: detail.ok ? 'CW_PRODUCT_MEASUREMENTS_LOOKUP_OK' : 'CW_PRODUCT_MEASUREMENTS_LOOKUP_FAILED',
    search: searchTerm,
    selectedUrl,
    discovery: {
      graphqlDiscoveryAttempts,
      dashboardCrawlAttempts: crawl.length,
    },
    candidates,
    crawl,
    upstreamStatus: detail.status,
    contentType: detail.contentType,
    session: {
      loginStatus: session.loginStatus,
      loginLocation: session.loginLocation,
      hasSessionId: Boolean(session.cookieJar?.sessionid),
    },
    summary: {
      imageCount: imageUrls.size,
      measurementCandidateCount: measurementCandidates.length,
      manualHintApplied: manualHintDiagnostics.applied,
      manualHintNoneTerm: manualHintDiagnostics.noneTerm,
      manualHintReferenceCount: manualHintReferences.length,
    },
    manualReferenceHints: manualHintDiagnostics,
    timings: buildTimings(),
    images: Array.from(imageUrls),
    measurementCandidates: measurementCandidates.slice(0, 60),
    upstreamBody: detail.body,
    upstreamSnippet: detail.body ? null : detail.rawText.slice(0, 5000),
    results:
      candidates.length > 0
        ? candidates
            .map(c => ({
              id: null,
              productReference: String(searchTerm || '').trim(),
              productName: String(searchTerm || '').trim(),
              status: null,
              translations: [],
              styleOptions: [],
              versionOptions: [],
              derivedScopedReferences: [],
              configParsed: false,
            }))
            .slice(0, 1)
        : [
            {
              id: null,
              productReference: String(searchTerm || '').trim(),
              productName: String(searchTerm || '').trim(),
              status: null,
              translations: [],
              styleOptions: [],
              versionOptions: [],
              derivedScopedReferences: [],
              configParsed: false,
            },
          ],
    durationMs: Date.now() - startedAt,
  };
  return res.status(detail.ok ? 200 : 502).json(
    buildSearchResponse(payload, {
      isTurboProbe,
      requestedProbeMode: probeModeState.requestedProbeMode,
    })
  );
}

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

    if (formId === 'probe-terms') {
      if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
      }
      const filePath = String(body?.filePath || '').trim();
      if (!filePath) {
        return res.status(400).json({ success: false, message: 'filePath is required' });
      }
      if (filePath.includes('\u0000')) {
        return res.status(400).json({ success: false, message: 'Invalid filePath' });
      }
      if (!/\.html?$/i.test(filePath)) {
        return res.status(400).json({ success: false, message: 'Expected an .html export file' });
      }

      const stat = await fs.stat(filePath);
      if (!stat.isFile()) {
        return res.status(400).json({ success: false, message: 'Path is not a file' });
      }
      if (stat.size > MAX_PROBE_TERMS_FILE_BYTES) {
        return res.status(400).json({ success: false, message: 'File is too large' });
      }

      const html = await fs.readFile(filePath, 'utf8');
      const parsed = parseProbeTermsFromExportHtml(html);
      return res.status(200).json({
        success: true,
        filePath,
        count: parsed.terms.length,
        totalRows: parsed.totalRows,
        referenceColumnIndex: parsed.referenceColumnIndex,
        terms: parsed.terms,
      });
    }

    if (formId === 'image-proxy') {
      if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
      }

      const candidates = Array.isArray(body?.candidates)
        ? body.candidates.map(value => String(value || '').trim()).filter(Boolean)
        : [];
      if (!candidates.length) {
        return res.status(400).json({ success: false, message: 'candidates are required' });
      }

      const override = {
        baseUrl: req.query?.baseUrl || body?.baseUrl,
        username: req.query?.username || body?.username || body?.email,
        password: req.query?.password || body?.password,
      };

      const session = await createCwSession(override);
      const attempts = [];
      const uniqueCandidates = rankImageCandidates(expandImageCandidateVariants(candidates)).slice(
        0,
        60
      );
      for (const candidate of uniqueCandidates) {
        const attempt = await cwGetImageWithSession(
          session,
          candidate,
          `${String(session.baseUrl || '').replace(/\/+$/, '')}/dashboard/`
        );
        attempts.push({
          url: candidate,
          status: attempt.status,
          ok: attempt.ok,
          contentType: attempt.contentType,
          byteLength: attempt.byteLength,
        });

        if (attempt.ok) {
          const buffer = Buffer.from(attempt.bytes);
          const mime = attempt.contentType || 'image/png';
          const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
          return res.status(200).json({
            success: true,
            url: dataUrl,
            sourceUrl: candidate,
            contentType: mime,
            byteLength: buffer.byteLength,
            attempts,
          });
        }
      }

      return res.status(404).json({
        success: false,
        code: 'CW_IMAGE_PROXY_NOT_FOUND',
        message: 'No candidate image URL could be fetched',
        attempts,
      });
    }

    if (formId === 'search') {
      const phase = String(body?.phase || '')
        .trim()
        .toLowerCase();
      if (phase === 'discover') {
        return await handleProductSearchDiscover({ req, res, body, startedAt });
      }
      if (phase === 'load-selected') {
        return await handleProductSearchLoadSelected({ req, res, body, startedAt });
      }
      return await handleProductSearch({ req, res, body, startedAt });
    }

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
    const isProductSearch = formId === 'search';
    return res.status(500).json({
      success: false,
      code:
        error?.code ||
        (isProductSearch ? 'CW_PRODUCT_SEARCH_ERROR' : 'CW_MEASUREMENTS_FETCH_ERROR'),
      message:
        error?.message ||
        (isProductSearch
          ? 'Failed to search CW product measurements'
          : 'Failed to fetch CW measurements'),
      details: error?.details || null,
      formId,
      durationMs: Date.now() - startedAt,
    });
  }
}
