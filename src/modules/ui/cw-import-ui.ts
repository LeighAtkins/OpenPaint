type ImportedRow = {
  id: string;
  sourceLabel: string;
  value: string;
  sectionName?: string;
  pieces?: string;
  skirtLength?: string;
};

type SearchState = {
  rows: ImportedRow[];
  imageUrls: string[];
  imageCandidateGroups: string[][];
  sectionImageGroups: Record<string, string[][]>;
  variantOptions: Array<{
    productReference: string;
    style: string;
    styleCode: string;
    label: string;
  }>;
  activeVariantUrl: string;
  productReference: string;
  productName: string;
  activeSection: string;
  armedRowId: string;
  selectedImageKeys: string[];
  rowTargetLabels: Record<string, string>;
};

function makeStyleKey(productReference: string, style: string, styleCode: string): string {
  return `${String(productReference || '').trim()}||${String(style || '').trim()}||${String(styleCode || '').trim()}`;
}

function parseStyleKey(styleKey: string): {
  productReference: string;
  style: string;
  styleCode: string;
} {
  const [productReference = '', style = '', styleCode = ''] = String(styleKey || '').split('||');
  return {
    productReference: String(productReference || '').trim(),
    style: String(style || '').trim(),
    styleCode: String(styleCode || '').trim(),
  };
}

const MODAL_ID = 'cwImportModalOverlay';
const STYLE_ID = 'cwImportStyles';
const CW_UI_STATE_KEY = 'openpaint:cw-import-ui:v1';
const STAGED_PROBE_BATCH_SIZES = [50, 250] as const;
const STAGED_PROBE_NON_JSON_STOP_COUNT = 10;
const STAGED_PROBE_FAILURE_RATE_STOP = 0.8;
const PROBE_REQUEST_DELAY_MS = 120;
const PROBE_DEFAULT_CONCURRENCY = 6;
const PROBE_MIN_CONCURRENCY = 2;
const PROBE_MAX_CONCURRENCY = 8;
const PROBE_TURBO_DEFAULT_CONCURRENCY = 10;
const PROBE_TURBO_MIN_CONCURRENCY = 4;
const PROBE_TURBO_MAX_CONCURRENCY = 12;

type CwUiPersistedState = {
  baseUrl?: string;
  formId?: string;
  username?: string;
  password?: string;
  searchTerm?: string;
  probeTerms?: string;
  probeTermsPath?: string;
  probeEnabled?: boolean;
  lastProbeReport?: Record<string, unknown> | null;
};

function readPersistedCwUiState(): CwUiPersistedState {
  try {
    const raw = window.localStorage.getItem(CW_UI_STATE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
}

function writePersistedCwUiState(state: CwUiPersistedState): void {
  try {
    window.localStorage.setItem(CW_UI_STATE_KEY, JSON.stringify(state));
  } catch {
    // Ignore persistence failures (private mode/quota/storage disabled).
  }
}

function isCwProbePreviewEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  const host = String(window.location.hostname || '').toLowerCase();
  const params = new URLSearchParams(window.location.search || '');
  if (params.get('cwProbe') === '1') return true;
  if (host === 'localhost' || host === '127.0.0.1') return true;
  if (host === 'sofapaint.vercel.app') return false;
  if (host.endsWith('.vercel.app')) return true;
  return false;
}

function parseProbeTermsFromExportHtml(html: string): {
  terms: string[];
  totalRows: number;
  referenceColumnIndex: number;
} {
  const parser = new DOMParser();
  const doc = parser.parseFromString(String(html || ''), 'text/html');
  const table = doc.querySelector('table.waffle') || doc.querySelector('table');
  if (!table) {
    return { terms: [], totalRows: 0, referenceColumnIndex: -1 };
  }

  const rows = Array.from(table.querySelectorAll('tr'));
  if (rows.length < 2) {
    return { terms: [], totalRows: 0, referenceColumnIndex: -1 };
  }

  const rowCells = rows.map(row =>
    Array.from(row.querySelectorAll('th,td')).map(cell =>
      String(cell.textContent || '')
        .replace(/\s+/g, ' ')
        .trim()
    )
  );

  const header = rowCells[1] || [];
  const referenceColumnIndex = header.findIndex(col => col.toUpperCase() === 'REFERENCE');
  const dataRows = rowCells.slice(2);
  const terms: string[] = [];
  const seen = new Set<string>();

  dataRows.forEach(row => {
    if (referenceColumnIndex < 0) return;
    const value = String(row[referenceColumnIndex] || '').trim();
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

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .cw-import-overlay { position: fixed; inset: 0; z-index: 11020; display: none; align-items: center; justify-content: center; background: rgba(2, 6, 23, 0.55); }
    .cw-import-card { width: min(960px, 94vw); max-height: 88vh; overflow: hidden; background: #fff; border-radius: 12px; box-shadow: 0 28px 50px rgba(15, 23, 42, 0.28); display: flex; flex-direction: column; }
    .cw-import-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid #e2e8f0; }
    .cw-import-head h3 { margin: 0; font-size: 15px; color: #0f172a; }
    .cw-import-close { border: 1px solid #cbd5e1; background: #fff; color: #334155; border-radius: 8px; padding: 4px 8px; cursor: pointer; }
    .cw-import-body { padding: 12px 14px; overflow: auto; }
    .cw-grid { display: grid; gap: 10px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .cw-grid-full { grid-column: 1 / -1; }
    .cw-import-body label { display: block; margin: 0 0 4px; font-size: 12px; color: #334155; }
    .cw-import-body input { width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px 10px; font-size: 13px; }
    .cw-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 10px; }
    .cw-btn { border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; color: #334155; padding: 7px 10px; font-size: 12px; cursor: pointer; }
    .cw-btn-primary { border-color: #0f172a; background: #0f172a; color: #fff; }
    .cw-note { margin-top: 8px; font-size: 12px; color: #64748b; }
    .cw-result-meta { margin-top: 12px; font-size: 12px; color: #334155; }
    .cw-probe-panel { margin-top: 12px; border: 1px solid #cbd5e1; border-radius: 10px; padding: 10px; background: #f8fafc; }
    .cw-probe-summary { margin: 6px 0 0; font-size: 12px; color: #334155; }
    .cw-probe-pre { margin-top: 8px; border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px; background: #fff; max-height: 220px; overflow: auto; font-size: 11px; line-height: 1.35; white-space: pre-wrap; word-break: break-word; }
    .cw-images { margin-top: 10px; display: grid; gap: 8px; grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .cw-image-card { position: relative; border: 1px solid #cbd5e1; border-radius: 10px; overflow: hidden; background: linear-gradient(180deg, #fff, #f8fafc); box-shadow: 0 8px 18px rgba(15, 23, 42, 0.06); cursor: pointer; transition: border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease; }
    .cw-image-card:hover { transform: translateY(-1px); border-color: #94a3b8; box-shadow: 0 10px 24px rgba(15, 23, 42, 0.12); }
    .cw-image-card.is-selected { border-color: #0f172a; box-shadow: 0 0 0 2px rgba(15, 23, 42, 0.08), 0 12px 24px rgba(15, 23, 42, 0.12); }
    .cw-image-card.is-skipped { opacity: 0.72; }
    .cw-image-card img { display: block; width: 100%; height: 96px; object-fit: cover; border-bottom: 1px solid #e2e8f0; }
    .cw-image-meta { display: flex; flex-direction: column; gap: 4px; padding: 8px; }
    .cw-image-section { font-size: 11px; font-weight: 700; color: #0f172a; }
    .cw-image-name { font-size: 11px; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cw-image-toggle { position: absolute; top: 8px; right: 8px; display: inline-flex; align-items: center; gap: 6px; padding: 4px 7px; border-radius: 999px; background: rgba(255, 255, 255, 0.94); color: #0f172a; font-size: 11px; font-weight: 700; box-shadow: 0 6px 16px rgba(15, 23, 42, 0.16); pointer-events: auto; }
    .cw-image-toggle.is-selected { background: rgba(15, 23, 42, 0.94); color: #fff; }
    .cw-image-toggle.is-skipped { background: rgba(148, 163, 184, 0.92); color: #fff; }
    .cw-image-toggle-input { width: 14px !important; height: 14px; margin: 0; accent-color: #0f172a; cursor: pointer; }
    .cw-image-toggle-text { line-height: 1; }
    .cw-image-actions { display: inline-flex; gap: 6px; align-items: center; }
    .cw-measure-wrap { margin-top: 12px; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; }
    .cw-measure-head { display: grid; grid-template-columns: 120px 140px 1fr 180px 180px; gap: 8px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; padding: 8px; font-size: 11px; font-weight: 600; color: #475569; }
    .cw-measure-row { display: grid; grid-template-columns: 120px 140px 1fr 180px 180px; gap: 8px; align-items: center; padding: 8px; border-bottom: 1px solid #f1f5f9; font-size: 12px; }
    .cw-measure-row:last-child { border-bottom: none; }
    .cw-measure-row.armed { background: #eff6ff; }
    .cw-measure-val { color: #0f172a; font-weight: 600; }
    .cw-measure-input { width: 100%; border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 8px; font-size: 12px; }
    .cw-section-select { width: 220px; border: 1px solid #cbd5e1; border-radius: 8px; padding: 6px 8px; font-size: 12px; }
    .cw-rendered-html { width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px 10px; min-height: 92px; resize: vertical; font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    @media (max-width: 900px) {
      .cw-grid { grid-template-columns: 1fr; }
      .cw-measure-head, .cw-measure-row { grid-template-columns: 1fr; }
      .cw-images { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  `;
  document.head.appendChild(style);
}

function getCurrentScopeLabel(): string {
  return (
    (window as any).app?.projectManager?.currentViewId ||
    (window as any).currentImageLabel ||
    'front'
  );
}

function getStrokeLabels(scopeLabel: string): string[] {
  const metadata = (window as any).app?.metadataManager;
  const scoped = metadata?.normalizeImageLabel
    ? metadata.normalizeImageLabel(scopeLabel)
    : scopeLabel;
  const strokes = metadata?.vectorStrokesByImage?.[scoped] || {};
  return Object.keys(strokes).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function fileStemFromUrl(url: string): string {
  const raw = String(url || '')
    .split('?')[0]
    .split('#')[0]
    .split('/')
    .filter(Boolean)
    .pop();
  return String(raw || 'photo').trim() || 'photo';
}

function setMeasurementLock(scopeLabel: string, strokeLabel: string, locked: boolean): void {
  const w = window as any;
  if (!w.cwMeasurementLocksByImage) w.cwMeasurementLocksByImage = {};
  if (!w.cwMeasurementLocksByImage[scopeLabel]) w.cwMeasurementLocksByImage[scopeLabel] = {};
  w.cwMeasurementLocksByImage[scopeLabel][strokeLabel] = locked;
}

function normalizeGuideLabel(value: string): string {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

function buildCwScopeCandidates(scopeLabel: string): string[] {
  const metadata = (window as any).app?.metadataManager;
  const normalized =
    typeof metadata?.normalizeImageLabel === 'function'
      ? String(metadata.normalizeImageLabel(scopeLabel) || scopeLabel).trim()
      : String(scopeLabel || '').trim();
  const base = normalized.split('::tab:')[0] || normalized;
  return Array.from(new Set([String(scopeLabel || '').trim(), normalized, base].filter(Boolean)));
}

function getCwImportedMeasurementEntry(scopeLabel: string, strokeLabel: string): any {
  const w = window as any;
  const store =
    w.cwImportedMeasurementsByImage && typeof w.cwImportedMeasurementsByImage === 'object'
      ? w.cwImportedMeasurementsByImage
      : {};
  const normalizedLabel = normalizeGuideLabel(strokeLabel);
  if (!normalizedLabel) return null;
  for (const candidate of buildCwScopeCandidates(scopeLabel)) {
    const scopedStore = store[candidate];
    if (!scopedStore || typeof scopedStore !== 'object') continue;
    const direct = scopedStore[normalizedLabel];
    if (direct && typeof direct === 'object') return direct;
  }
  return null;
}

function markCwImportedMeasurementApplied(
  scopeLabel: string,
  strokeLabel: string,
  payload: any
): void {
  const w = window as any;
  if (!w.cwImportedMeasurementsByImage) w.cwImportedMeasurementsByImage = {};
  const normalizedLabel = normalizeGuideLabel(strokeLabel);
  if (!normalizedLabel) return;
  const nextPayload = {
    ...(payload && typeof payload === 'object' ? payload : {}),
    pending: false,
    autoApplyOnDraw: false,
    updatedAt: new Date().toISOString(),
  };
  buildCwScopeCandidates(scopeLabel).forEach(candidate => {
    if (!w.cwImportedMeasurementsByImage[candidate]) {
      w.cwImportedMeasurementsByImage[candidate] = {};
    }
    w.cwImportedMeasurementsByImage[candidate][normalizedLabel] = nextPayload;
  });
}

function normalizeValueText(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSectionName(value: string): string {
  const raw = normalizeValueText(value);
  if (!raw) return '';
  const token = raw.toLowerCase();
  if (token.includes('frame')) return 'Frame Cover';
  if (token.includes('seat') || token.includes('stcc')) return 'Seat Cushion Cover';
  if (token.includes('back') || token.includes('bkcc')) return 'Back Cushion Cover';
  return raw;
}

function classifyMeasurementSection(sourceLabel: string, sectionName: string): string {
  const normalizedSource = normalizeValueText(sourceLabel);
  const sourceToken = normalizedSource.toLowerCase();
  const normalizedSection = normalizeSectionName(sectionName);

  if (/^backrest\b/i.test(normalizedSource)) return 'Frame Cover';
  if (/^back (height|width)/i.test(normalizedSource)) return 'Frame Cover';

  return normalizedSection || normalizeSectionName(normalizedSource) || 'Frame Cover';
}

function guessMosLabel(sourceLabel: string, sectionName: string): string {
  const normalizedSource = normalizeValueText(sourceLabel).toLowerCase();
  const normalizedSection = normalizeSectionName(sectionName);

  if (normalizedSource.startsWith('backrest')) {
    if (normalizedSource.includes('(top)')) return 'A1';
    if (normalizedSource.includes('(middle)')) return 'A2';
    if (normalizedSource.includes('(bottom)')) return 'A3';
    return 'A1';
  }

  if (normalizedSource === 'front panel width') return 'A4';
  if (normalizedSource === 'front panel depth') return 'C4';
  if (normalizedSource === 'front panel height') return 'C4';
  if (normalizedSource === 'front arm height') return 'C1';
  if (normalizedSource === 'front arm width (top)') return 'C2';
  if (normalizedSource === 'front arm width (bottom)') return 'C3';
  if (normalizedSource === 'side width (top)') return 'G1';
  if (normalizedSource === 'side width (bottom)') return 'G2';
  if (normalizedSource === 'back height') return 'J1';
  if (normalizedSource === 'back width (top)') return 'L1';
  if (normalizedSource === 'back width (middle)') return 'L2';
  if (normalizedSource === 'back width (bottom)') return 'L3';

  if (normalizedSection === 'Seat Cushion Cover' || normalizedSection === 'Back Cushion Cover') {
    if (normalizedSource === 'width (top)') return 'A';
    if (normalizedSource === 'width (bottom)') return 'B';
    if (normalizedSource === 'height (middle)') return 'C';
    if (normalizedSource === 'height (right)') return 'D';
    if (normalizedSource === 'thickness') return 'E';
  }

  return '';
}

function decodeHtmlEntitiesLite(value: string): string {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function extractAbsoluteImageUrlsFromString(value: string): string[] {
  const source = decodeHtmlEntitiesLite(String(value || ''))
    .replace(/\\\//g, '/')
    .replace(/\u002F/gi, '/')
    .replace(/\u003A/gi, ':')
    .replace(/\u0026/gi, '&');
  const direct =
    source.match(/https?:\/\/[^"'\s)]+\.(?:png|jpe?g|webp|gif|bmp|svg)(?:\?[^"'\s)]*)?/gi) || [];
  const encoded =
    source.match(/https%3A%2F%2F[^"'\s)]+(?:png|jpe?g|webp|gif|bmp|svg)(?:%3F[^"'\s)]*)?/gi) || [];
  const decoded = encoded
    .map(item => {
      try {
        return decodeURIComponent(item);
      } catch {
        return '';
      }
    })
    .filter(Boolean);
  return Array.from(new Set([...direct, ...decoded].map(item => item.trim()).filter(Boolean)));
}

function sectionFromImageName(nameOrPath: string): string {
  const source = String(nameOrPath || '').toLowerCase();
  if (source.includes('_fr_') || source.includes('frame')) return 'Frame Cover';
  if (source.includes('_stcc') || source.includes('seat')) return 'Seat Cushion Cover';
  if (source.includes('_bkcc') || source.includes('back')) return 'Back Cushion Cover';
  return '';
}

function toPrimitiveMeasurementValue(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'number') return Number.isFinite(raw) ? String(raw) : '';
  if (typeof raw === 'string') return normalizeValueText(raw);
  if (typeof raw === 'boolean') return raw ? 'true' : 'false';
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const directKeys = ['value', 'actual', 'measurement', 'result', 'cm', 'inch'];
    for (const key of directKeys) {
      if (key in obj) {
        const next = toPrimitiveMeasurementValue(obj[key]);
        if (next) return next;
      }
    }
  }
  return '';
}

function isLikelyMeasurementLabel(label: string): boolean {
  if (!label) return false;
  if (/^\d+$/.test(label)) return false;
  if (label.length < 2) return false;
  return true;
}

function slugify(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function isSignedImageUrl(url: string): boolean {
  const value = String(url || '');
  return (
    /[?&]Signature=/i.test(value) &&
    (/[?&]GoogleAccessId=/i.test(value) || /[?&]X-Goog-Algorithm=/i.test(value))
  );
}

function isKnownBadImageCandidate(url: string): boolean {
  const value = String(url || '');
  if (/storage\.cloud\.google\.com/i.test(value)) return true;
  if (/cw-pid-qylyewlgca-uc\.a\.run\.app\/slipcover_details_images/i.test(value)) return true;
  if (/cw-pid-qylyewlgca-uc\.a\.run\.app\/media\/slipcover_details_images/i.test(value))
    return true;
  if (/cw40\.comfort-works\.com\/slipcover_details_images/i.test(value)) return true;
  return false;
}

function filterPreferredImageCandidates(urls: string[]): string[] {
  const unique = Array.from(new Set((urls || []).filter(Boolean)));
  const signed = unique.filter(isSignedImageUrl);
  if (signed.length) {
    return signed;
  }
  const preferred = unique.filter(url => !isKnownBadImageCandidate(url));
  if (preferred.length) return preferred;
  // Keep known-bad candidates as last-resort fallbacks so image-proxy can still try.
  return unique;
}

function isLikelyImagePath(value: string): boolean {
  const v = String(value || '').trim();
  if (!v) return false;
  if (/^https?:\/\//i.test(v)) {
    return /\.(?:png|jpe?g|webp|gif|bmp|svg)(?:\?|$)/i.test(v);
  }
  return /[\/][^\s]+\.(?:png|jpe?g|webp|gif|bmp|svg)$/i.test(v);
}

function makeAbsoluteCandidates(pathOrUrl: string, baseUrl: string): string[] {
  const value = String(pathOrUrl || '').trim();
  if (!value) return [];
  if (/^https?:\/\//i.test(value)) return [value];

  const normalizedPath = value.replace(/^\/+/, '');
  const bases = [
    String(baseUrl || '')
      .trim()
      .replace(/\/+$/, ''),
    'https://cw-pid-qylyewlgca-uc.a.run.app',
  ].filter(Boolean);

  const urls = new Set<string>();
  bases.forEach(base => {
    urls.add(`${base}/${normalizedPath}`);
    urls.add(`${base}/media/${normalizedPath}`);
    urls.add(`${base}/uploads/${normalizedPath}`);
  });
  return filterPreferredImageCandidates(Array.from(urls));
}

function collectBucketNames(node: unknown, out: Set<string>): void {
  if (!node) return;
  if (Array.isArray(node)) {
    node.forEach(item => collectBucketNames(item, out));
    return;
  }
  if (typeof node !== 'object') return;

  Object.entries(node as Record<string, unknown>).forEach(([key, value]) => {
    const keyNorm = key.toLowerCase();
    if (typeof value === 'string' && keyNorm.includes('bucket')) {
      const bucket = value.trim();
      if (bucket && !bucket.includes(' ') && !bucket.startsWith('http')) {
        out.add(bucket);
      }
    }
    collectBucketNames(value, out);
  });
}

function collectImagePaths(node: unknown, out: Set<string>): void {
  if (!node) return;
  if (typeof node === 'string') {
    const value = node.trim();
    if (isLikelyImagePath(value) && !/^https?:\/\//i.test(value)) {
      out.add(value.replace(/^\/+/, ''));
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach(item => collectImagePaths(item, out));
    return;
  }
  if (typeof node !== 'object') return;

  Object.entries(node as Record<string, unknown>).forEach(([key, value]) => {
    const keyNorm = key.toLowerCase();
    if (typeof value === 'string' && keyNorm.includes('file_path') && isLikelyImagePath(value)) {
      out.add(value.replace(/^\/+/, ''));
    }
    collectImagePaths(value, out);
  });
}

function collectImageUrlsDeep(node: unknown, out: Set<string>, baseUrl: string): void {
  if (!node) return;
  if (typeof node === 'string') {
    const value = node.trim();
    const absoluteUrls = extractAbsoluteImageUrlsFromString(value);
    absoluteUrls.forEach(url => out.add(url));
    if (isLikelyImagePath(value)) {
      makeAbsoluteCandidates(value, baseUrl).forEach(url => out.add(url));
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach(item => collectImageUrlsDeep(item, out, baseUrl));
    return;
  }
  if (typeof node === 'object') {
    Object.entries(node as Record<string, unknown>).forEach(([key, value]) => {
      const keyNorm = key.toLowerCase();
      if (
        typeof value === 'string' &&
        (keyNorm.includes('image') || keyNorm.includes('file_path'))
      ) {
        extractAbsoluteImageUrlsFromString(value).forEach(url => out.add(url));
        if (isLikelyImagePath(value)) {
          makeAbsoluteCandidates(value, baseUrl).forEach(url => out.add(url));
        }
      }
      collectImageUrlsDeep(value, out, baseUrl);
    });
  }
}

function extractImageUrls(payload: any, baseUrl: string): string[] {
  const urls = new Set<string>();

  if (Array.isArray(payload?.images)) {
    payload.images.forEach((url: unknown) => collectImageUrlsDeep(url, urls, baseUrl));
  }

  const sections = payload?.renderedHtmlExtraction?.sections;
  if (Array.isArray(sections)) {
    sections.forEach((section: any) => {
      if (Array.isArray(section?.imageUrls)) {
        section.imageUrls.forEach((url: unknown) => collectImageUrlsDeep(url, urls, baseUrl));
      }
    });
  }

  if (Array.isArray(payload?.measurementDetails)) {
    payload.measurementDetails.forEach((item: any) => {
      if (Array.isArray(item?.images)) {
        item.images.forEach((url: unknown) => collectImageUrlsDeep(url, urls, baseUrl));
      }
      collectImageUrlsDeep(item?.upstreamBody, urls, baseUrl);
    });
  }

  collectImageUrlsDeep(payload?.upstreamBody, urls, baseUrl);
  collectImageUrlsDeep(payload?.qcMeasurements?.data, urls, baseUrl);

  const bucketNames = new Set<string>();
  collectBucketNames(payload, bucketNames);
  if (!bucketNames.size) {
    bucketNames.add('pid-storage');
  }

  const imagePaths = new Set<string>();
  collectImagePaths(payload, imagePaths);

  imagePaths.forEach(path => {
    bucketNames.forEach(bucket => {
      urls.add(`https://storage.googleapis.com/${bucket}/${path}`);
      urls.add(`https://storage.cloud.google.com/${bucket}/${path}`);
    });
  });

  return Array.from(urls);
}

function collectSectionImageGroups(payload: any, baseUrl: string): Record<string, string[][]> {
  const bucketNames = new Set<string>();
  collectBucketNames(payload, bucketNames);
  const bySection = new Map<string, Map<string, string[]>>();

  const ensureSection = (sectionName: string) => {
    const normalized = normalizeSectionName(sectionName) || 'General';
    if (!bySection.has(normalized)) bySection.set(normalized, new Map());
    return bySection.get(normalized)!;
  };

  const addImageGroup = (sectionName: string, rawPath: string) => {
    const path = String(rawPath || '').trim();
    if (!path) return;
    const candidates = new Set<string>();
    makeAbsoluteCandidates(path, baseUrl).forEach(url => candidates.add(url));
    if (!/^https?:\/\//i.test(path)) {
      const cleaned = path.replace(/^\/+/, '');
      bucketNames.forEach(bucket => {
        candidates.add(`https://storage.googleapis.com/${bucket}/${cleaned}`);
        candidates.add(`https://storage.cloud.google.com/${bucket}/${cleaned}`);
      });
    }
    const arr = filterPreferredImageCandidates(Array.from(candidates));
    if (!arr.length) return;
    const key = imageKeyFromUrl(path);
    ensureSection(sectionName).set(key, arr);
  };

  const walk = (node: unknown, sectionHint = ''): void => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(item => walk(item, sectionHint));
      return;
    }
    if (typeof node !== 'object') return;

    const obj = node as Record<string, unknown>;
    const derivedSection =
      normalizeSectionName(String(obj?.translations && (obj.translations as any)?.en)) ||
      normalizeSectionName(String(obj?.component_name || obj?.name || sectionHint));

    const sectionFromPath = sectionFromImageName(
      String(obj?.file_path || obj?.name || obj?.url || '')
    );
    const sectionName = normalizeSectionName(
      sectionFromPath || derivedSection || sectionHint || 'General'
    );

    const filePath = String(obj?.file_path || '').trim();
    const url = String(obj?.url || '').trim();
    const name = String(obj?.name || '').trim();
    if (filePath && isLikelyImagePath(filePath)) addImageGroup(sectionName, filePath);
    if (url && isLikelyImagePath(url)) addImageGroup(sectionName, url);
    if (!filePath && !url && name && isLikelyImagePath(name)) addImageGroup(sectionName, name);
    extractAbsoluteImageUrlsFromString(JSON.stringify(obj)).forEach(abs => {
      const inferred = normalizeSectionName(sectionFromImageName(abs) || sectionName || 'General');
      addImageGroup(inferred, abs);
    });

    Object.values(obj).forEach(value => walk(value, sectionName));
  };

  walk(payload, '');

  const result: Record<string, string[][]> = {};
  bySection.forEach((groups, section) => {
    result[section] = Array.from(groups.values());
  });
  return result;
}

function mergeSectionImageGroups(
  base: Record<string, string[][]>,
  extraGroups: string[][]
): Record<string, string[][]> {
  const out: Record<string, string[][]> = { ...base };
  const seenBySection: Record<string, Set<string>> = {};

  Object.entries(out).forEach(([section, groups]) => {
    seenBySection[section] = new Set((groups || []).map(group => imageKeyFromUrl(group[0] || '')));
  });

  (extraGroups || []).forEach(group => {
    if (!group?.length) return;
    const sectionGuess =
      normalizeSectionName(group.map(url => sectionFromImageName(url)).find(Boolean) || '') ||
      'Frame Cover';
    if (!out[sectionGuess]) out[sectionGuess] = [];
    if (!seenBySection[sectionGuess]) seenBySection[sectionGuess] = new Set();

    const key = imageKeyFromUrl(group[0] || '');
    if (!key || seenBySection[sectionGuess].has(key)) return;
    seenBySection[sectionGuess].add(key);
    out[sectionGuess].push(group);
  });

  return out;
}

function imageKeyFromUrl(url: string): string {
  const clean = String(url || '')
    .split('?')[0]
    .split('#')[0];
  const parts = clean
    .split('/')
    .filter(Boolean)
    .map(part => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    })
    .map(part => part.replace(/\)\)_/g, ')_'));
  return (parts.slice(-2).join('/') || clean).toLowerCase();
}

function probeImage(url: string, timeoutMs = 4500): Promise<boolean> {
  return new Promise(resolve => {
    const img = new Image();
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    img.onload = () => {
      clearTimeout(timer);
      done(true);
    };
    img.onerror = () => {
      clearTimeout(timer);
      done(false);
    };
    img.referrerPolicy = 'no-referrer';
    img.src = url;
  });
}

async function resolveWorkingImageUrls(candidates: string[]): Promise<string[]> {
  const grouped = new Map<string, string[]>();
  candidates.forEach(url => {
    const key = imageKeyFromUrl(url);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(url);
  });

  const resolved: string[] = [];
  for (const urls of grouped.values()) {
    let selected = '';
    for (const url of urls) {
      // eslint-disable-next-line no-await-in-loop
      const ok = await probeImage(url);
      if (ok) {
        selected = url;
        break;
      }
    }
    if (selected) resolved.push(selected);
  }
  return resolved;
}

function groupImageCandidates(candidates: string[]): string[][] {
  const grouped = new Map<string, string[]>();
  candidates.forEach(url => {
    const key = imageKeyFromUrl(url);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(url);
  });
  return Array.from(grouped.values()).filter(group => group.length > 0);
}

async function fetchProxyImageDataUrl(
  candidates: string[],
  baseUrl: string,
  username: string,
  password: string
): Promise<string> {
  try {
    const response = await fetch('/api/integrations/cw/measurements/image-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidates, baseUrl, username, password }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.success || typeof data?.url !== 'string' || !data.url) {
      return '';
    }
    return data.url;
  } catch {
    return '';
  }
}

function extractRowsFromQcNode(node: any, contextSectionName: string, out: ImportedRow[]): void {
  if (!node) return;

  if (Array.isArray(node)) {
    node.forEach(item => extractRowsFromQcNode(item, contextSectionName, out));
    return;
  }

  if (typeof node !== 'object') return;

  const rawSectionCandidate =
    normalizeValueText(node?.translations?.en) ||
    normalizeValueText(node?.component_name) ||
    normalizeValueText(node?.name);
  const sectionFromNode = (() => {
    const normalized = normalizeSectionName(rawSectionCandidate || '');
    if (/(cover|cushion|frame|seat|back)/i.test(normalized)) {
      return normalized;
    }
    return normalizeSectionName(contextSectionName || '');
  })();

  const measurements = node?.measurements || node?.measurement_data || node?.measurementData;
  if (measurements && typeof measurements === 'object') {
    Object.entries(measurements).forEach(([key, value]) => {
      const sourceLabel = normalizeValueText(key);
      const normalizedValue = toPrimitiveMeasurementValue(value);
      if (!isLikelyMeasurementLabel(sourceLabel) || !normalizedValue) return;
      out.push({
        id: `qc-component-${out.length + 1}`,
        sourceLabel,
        value: normalizedValue,
        sectionName: sectionFromNode,
      });
    });
  }

  const dimensionFieldMap: Array<{ key: string; label: string }> = [
    { key: 'width', label: 'Width' },
    { key: 'depth', label: 'Depth' },
    { key: 'height', label: 'Height' },
    { key: 'toWidth', label: 'To Width' },
    { key: 'toDepth', label: 'To Depth' },
    { key: 'toHeight', label: 'To Height' },
  ];
  dimensionFieldMap.forEach(({ key, label }) => {
    const normalizedValue = toPrimitiveMeasurementValue(node?.[key]);
    if (!normalizedValue) return;
    out.push({
      id: `qc-dim-${key}-${out.length + 1}`,
      sourceLabel: label,
      value: normalizedValue,
      sectionName: sectionFromNode || 'Frame Cover',
    });
  });

  const sourceLabel = normalizeValueText(node?.label || node?.name || node?.code);
  const value = toPrimitiveMeasurementValue(
    node?.value || node?.measurement || node?.actual || node?.result
  );
  if (isLikelyMeasurementLabel(sourceLabel) && value) {
    out.push({
      id: `qc-${out.length + 1}`,
      sourceLabel,
      value,
      sectionName: sectionFromNode,
    });
  }

  Object.values(node).forEach(valueNode => {
    extractRowsFromQcNode(valueNode, sectionFromNode, out);
  });
}

function makeViewIdFromUrl(url: string, fallbackPrefix = 'cw-photo'): string {
  const raw = String(url || '')
    .split('?')[0]
    .split('#')[0]
    .split('/')
    .pop();
  const stem = String(raw || fallbackPrefix).replace(/\.[a-z0-9]+$/i, '');
  const slug = stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallbackPrefix;
}

function nextUniqueViewId(baseId: string): string {
  const projectManager = (window as any).app?.projectManager;
  const views = projectManager?.views || {};
  if (!views[baseId]) return baseId;
  let i = 2;
  while (views[`${baseId}-${i}`]) i += 1;
  return `${baseId}-${i}`;
}

function extractRows(payload: any): ImportedRow[] {
  const rows: ImportedRow[] = [];
  const pushMeasurementEntry = (
    sourceLabelRaw: unknown,
    valueRaw: unknown,
    sectionNameRaw: unknown,
    idPrefix: string
  ) => {
    const sourceLabel = normalizeValueText(sourceLabelRaw);
    const value = toPrimitiveMeasurementValue(valueRaw);
    const sectionName = normalizeSectionName(normalizeValueText(sectionNameRaw));
    if (!isLikelyMeasurementLabel(sourceLabel) || !value) return;
    rows.push({
      id: `${idPrefix}-${rows.length + 1}`,
      sourceLabel,
      value,
      sectionName: sectionName || 'Frame Cover',
    });
  };

  const fromHtml = payload?.renderedHtmlExtraction?.flatMeasurements;
  if (Array.isArray(fromHtml) && fromHtml.length) {
    fromHtml.forEach((row: any, idx: number) => {
      const sourceLabel = normalizeValueText(row?.label || row?.measurement || row?.name);
      const value = normalizeValueText(row?.value || row?.measurementValue || row?.actual);
      if (!sourceLabel || !value) return;
      rows.push({
        id: `html-${idx}`,
        sourceLabel,
        value,
        sectionName: normalizeValueText(row?.sectionName),
        pieces: normalizeValueText(row?.pieces),
        skirtLength: normalizeValueText(row?.skirtLength),
      });
    });
  }

  const htmlSections = payload?.renderedHtmlExtraction?.sections;
  if (Array.isArray(htmlSections) && htmlSections.length) {
    htmlSections.forEach((section: any, sectionIndex: number) => {
      const sectionName = normalizeValueText(section?.sectionName || `Section ${sectionIndex + 1}`);
      (Array.isArray(section?.measurements) ? section.measurements : []).forEach((row: any) => {
        const sourceLabel = normalizeValueText(row?.label || row?.name || row?.measurement);
        const value = normalizeValueText(row?.value || row?.actual || row?.measurementValue);
        if (!sourceLabel || !value) return;
        rows.push({
          id: `section-${sectionIndex}-${rows.length + 1}`,
          sourceLabel,
          value,
          sectionName,
          pieces: normalizeValueText(section?.pieces),
          skirtLength: normalizeValueText(section?.skirtLength),
        });
      });
    });
  }

  const measurementData = payload?.formMeasurements?.matchedProduct?.measurementData;
  if (measurementData && typeof measurementData === 'object') {
    Object.entries(measurementData).forEach(([key, val], idx) => {
      const sourceLabel = normalizeValueText(key);
      const value = toPrimitiveMeasurementValue(val);
      if (!isLikelyMeasurementLabel(sourceLabel) || !value) return;
      rows.push({ id: `form-${idx}`, sourceLabel, value, sectionName: 'Frame Cover' });
    });
  }

  const content = payload?.qcMeasurements?.data;
  if (content && typeof content === 'object') {
    extractRowsFromQcNode(content, '', rows);
  }

  const detailRows = Array.isArray(payload?.measurementDetails) ? payload.measurementDetails : [];
  detailRows.forEach((detail: any, detailIndex: number) => {
    const detailCandidates = Array.isArray(detail?.measurementCandidates)
      ? detail.measurementCandidates
      : [];
    detailCandidates.forEach((candidate: any, candidateIndex: number) => {
      const sectionName =
        normalizeSectionName(normalizeValueText(candidate?.sectionName || '')) ||
        normalizeSectionName(sectionFromImageName(String(detail?.url || ''))) ||
        'Frame Cover';
      const key = normalizeValueText(candidate?.key || candidate?.path || candidate?.label || '');
      const valueNode = candidate?.value;

      if (valueNode && typeof valueNode === 'object' && !Array.isArray(valueNode)) {
        Object.entries(valueNode as Record<string, unknown>).forEach(([subKey, subVal]) => {
          pushMeasurementEntry(
            subKey,
            subVal,
            sectionName,
            `detail-${detailIndex}-${candidateIndex}`
          );
        });
      } else {
        pushMeasurementEntry(
          key || `Detail ${candidateIndex + 1}`,
          valueNode,
          sectionName,
          `detail-${detailIndex}-${candidateIndex}`
        );
      }
    });

    if (detail?.upstreamBody && typeof detail.upstreamBody === 'object') {
      extractRowsFromQcNode(detail.upstreamBody, '', rows);
    }
  });

  const dedup = new Map<string, ImportedRow>();
  rows.forEach(row => {
    const key = `${normalizeSectionName(row.sectionName || '')}|${row.sourceLabel}|${row.value}`;
    if (!dedup.has(key)) dedup.set(key, row);
  });
  return Array.from(dedup.values());
}

function buildVariantOptions(
  data: any
): Array<{ productReference: string; style: string; styleCode: string; label: string }> {
  const fallbackReference = String(data?.product?.reference || '').trim();
  const dedupe = new Map<
    string,
    { productReference: string; style: string; styleCode: string; label: string }
  >();
  const pushOption = (
    productReferenceRaw: string,
    styleRaw: string,
    styleCodeRaw: string,
    labelRaw = ''
  ) => {
    const productReference = String(productReferenceRaw || fallbackReference || '').trim();
    const style = String(styleRaw || '').trim();
    const styleCode = String(styleCodeRaw || '').trim();
    if (!productReference && !style && !styleCode) return;
    const key = makeStyleKey(
      productReference.toLowerCase(),
      style.toLowerCase(),
      styleCode.toLowerCase()
    );
    if (dedupe.has(key)) return;
    const label =
      String(labelRaw || '').trim() ||
      `${productReference || 'Reference'} - ${style || 'Style'}${styleCode ? ` (${styleCode})` : ''}`;
    dedupe.set(key, { productReference, style, styleCode, label });
  };

  const styleOptions = Array.isArray(data?.styleOptions) ? data.styleOptions : [];
  styleOptions.forEach((item: any) => {
    pushOption(
      item?.productReference || item?.product_reference || fallbackReference,
      item?.style,
      item?.styleCode || item?.style_code,
      item?.label
    );
  });

  const fallbackQc = Array.isArray(data?.qcMeasurementsByStyle) ? data.qcMeasurementsByStyle : [];
  fallbackQc.forEach((item: any) => {
    pushOption(
      item?.productReference || fallbackReference,
      item?.style,
      item?.styleCode,
      item?.label
    );
  });

  // Common paired CW styles: keep dropdown useful even when upstream only
  // returns one side in metadata.
  const current = Array.from(dedupe.values());
  if (current.length === 1) {
    const only = current[0];
    const styleNorm = only.style.toLowerCase();
    const codeNorm = only.styleCode.toUpperCase();
    if (styleNorm === 'signature' && codeNorm === 'CNRP_SP') {
      pushOption(only.productReference || fallbackReference, 'Original', 'SHRT_SP');
    } else if (styleNorm === 'original' && codeNorm === 'SHRT_SP') {
      pushOption(only.productReference || fallbackReference, 'Signature', 'CNRP_SP');
    }
  }

  return Array.from(dedupe.values());
}

function buildPayloadForVariant(data: any, activeVariantUrl: string): any {
  if (!activeVariantUrl) return data;
  const stylePool = Array.isArray(data?.qcMeasurementsByStyle) ? data.qcMeasurementsByStyle : [];
  const { productReference, style, styleCode } = parseStyleKey(activeVariantUrl);
  const matchedQc =
    stylePool.find((item: any) => {
      const sameReference =
        !productReference ||
        String(item?.productReference || '').toLowerCase() === productReference.toLowerCase();
      const sameStyle = !style || String(item?.style || '').toLowerCase() === style.toLowerCase();
      const sameCode =
        !styleCode || String(item?.styleCode || '').toLowerCase() === styleCode.toLowerCase();
      return sameReference && sameStyle && sameCode;
    }) || null;

  const details = Array.isArray(data?.measurementDetails) ? data.measurementDetails : [];
  return {
    ...data,
    measurementDetails: details,
    qcMeasurements: matchedQc || data?.qcMeasurements || null,
  };
}

function createModal(): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'cw-import-overlay';
  overlay.id = MODAL_ID;

  const card = document.createElement('div');
  card.className = 'cw-import-card';

  const head = document.createElement('div');
  head.className = 'cw-import-head';
  head.innerHTML = '<h3>CW Product Measurements</h3>';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'cw-import-close';
  closeBtn.textContent = 'Close';

  const body = document.createElement('div');
  body.className = 'cw-import-body';
  body.innerHTML = `
    <div class="cw-grid">
      <div>
        <label for="cwBaseUrl">CW Base URL</label>
        <input id="cwBaseUrl" value="https://cw40.comfort-works.com" />
      </div>
      <div>
        <label for="cwFormId">Form ID (optional)</label>
        <input id="cwFormId" />
      </div>
      <div>
        <label for="cwUsername">CW Username</label>
        <input id="cwUsername" autocomplete="off" />
      </div>
      <div>
        <label for="cwPassword">CW Password</label>
        <input id="cwPassword" type="password" autocomplete="off" />
      </div>
      <div class="cw-grid-full">
        <label for="cwSearchTerm">Product search (name or code)</label>
        <input id="cwSearchTerm" placeholder="PB Comfort Roll Arm Sofa Slipcover" />
      </div>
      <div class="cw-grid-full">
        <label for="cwRenderedHtml">Rendered PID HTML (optional, helps include all sections like frame/seat/back cushions)</label>
        <textarea id="cwRenderedHtml" class="cw-rendered-html" placeholder="Paste expanded measurements HTML when needed"></textarea>
      </div>
    </div>
    <div class="cw-row">
      <button type="button" class="cw-btn cw-btn-primary" id="cwSearchBtn">Search</button>
      <button type="button" class="cw-btn" id="cwImportExactBtn">Import Matching Labels</button>
      <button type="button" class="cw-btn" id="cwImportPhotosBtn">Import Photos to Project</button>
      <select id="cwVariantFilter" class="cw-section-select"><option value="">Auto Style</option></select>
      <select id="cwSectionFilter" class="cw-section-select"><option value="">All Sections</option></select>
      <span class="cw-image-actions">
        <button type="button" class="cw-btn" id="cwSelectVisibleImagesBtn">Select Visible</button>
        <button type="button" class="cw-btn" id="cwClearVisibleImagesBtn">Clear Visible</button>
      </span>
      <label><input type="checkbox" id="cwImportLocked" checked /> Locked by default</label>
    </div>
      <div class="cw-note">Guide mode: click Draw Next for a measurement, then draw the next measurement stroke. OpenPaint auto-applies that value to the new stroke.</div>
    <div class="cw-result-meta" id="cwResultMeta">No search yet.</div>
    <div class="cw-probe-panel" id="cwProbePanel" style="display:none;">
      <div class="cw-row" style="margin-top:0;">
        <label style="margin:0;"><input type="checkbox" id="cwProbeEnabled" /> Enable probe diagnostics</label>
        <button type="button" class="cw-btn" id="cwRunProbeBtn">Run Probe</button>
        <button type="button" class="cw-btn" id="cwRunBulkProbeBtn">Run Bulk Probe</button>
        <button type="button" class="cw-btn" id="cwRunStagedProbeBtn">Run Staged Probe</button>
        <button type="button" class="cw-btn" id="cwRunTurboStagedProbeBtn">Run Turbo Staged Probe</button>
        <button type="button" class="cw-btn" id="cwCopyProbeBtn">Copy Probe Report</button>
      </div>
      <div class="cw-grid" style="margin-top:8px; grid-template-columns: 1fr;">
        <div>
          <label for="cwProbeTermsFile">Export HTML file (recommended)</label>
          <div class="cw-row" style="margin-top:0;">
            <input id="cwProbeTermsFile" type="file" accept=".html,.htm,text/html" />
          </div>
        </div>
        <div>
          <label for="cwProbeTermsPath">Server file path (local/dev only)</label>
          <div class="cw-row" style="margin-top:0;">
            <input id="cwProbeTermsPath" value="/mnt/c/Users/Leigh Atkins/Downloads/4.0 products export/4.0 products export.html" />
            <button type="button" class="cw-btn" id="cwLoadProbeTermsBtn">Load Terms From Export</button>
          </div>
        </div>
        <div>
          <label for="cwProbeTerms">Probe search terms (one per line)</label>
          <textarea id="cwProbeTerms" class="cw-rendered-html" placeholder="IK-KN-4&#10;IK-KN-4__SV&#10;IK-KN-4__LV&#10;PB&#10;MG"></textarea>
        </div>
      </div>
      <div class="cw-probe-summary" id="cwProbeSummary">Probe disabled.</div>
      <pre class="cw-probe-pre" id="cwProbeOutput"></pre>
    </div>
    <div class="cw-images" id="cwResultImages"></div>
    <div class="cw-measure-wrap">
      <div class="cw-measure-head"><div>Source Label</div><div>Section</div><div>Value</div><div>Map to Stroke Label</div><div>Actions</div></div>
      <div id="cwRows"></div>
    </div>
  `;

  const searchBtn = body.querySelector('#cwSearchBtn') as HTMLButtonElement;
  const baseUrlEl = body.querySelector('#cwBaseUrl') as HTMLInputElement;
  const formIdEl = body.querySelector('#cwFormId') as HTMLInputElement;
  const usernameEl = body.querySelector('#cwUsername') as HTMLInputElement;
  const passwordEl = body.querySelector('#cwPassword') as HTMLInputElement;
  const searchTermEl = body.querySelector('#cwSearchTerm') as HTMLInputElement;
  const renderedHtmlEl = body.querySelector('#cwRenderedHtml') as HTMLTextAreaElement;
  const importExactBtn = body.querySelector('#cwImportExactBtn') as HTMLButtonElement;
  const importPhotosBtn = body.querySelector('#cwImportPhotosBtn') as HTMLButtonElement;
  const variantFilterEl = body.querySelector('#cwVariantFilter') as HTMLSelectElement;
  const sectionFilterEl = body.querySelector('#cwSectionFilter') as HTMLSelectElement;
  const selectVisibleImagesBtn = body.querySelector(
    '#cwSelectVisibleImagesBtn'
  ) as HTMLButtonElement;
  const clearVisibleImagesBtn = body.querySelector('#cwClearVisibleImagesBtn') as HTMLButtonElement;
  const rowsContainer = body.querySelector('#cwRows') as HTMLDivElement;
  const resultMeta = body.querySelector('#cwResultMeta') as HTMLDivElement;
  const imagesWrap = body.querySelector('#cwResultImages') as HTMLDivElement;
  const lockedEl = body.querySelector('#cwImportLocked') as HTMLInputElement;
  const probePanel = body.querySelector('#cwProbePanel') as HTMLDivElement;
  const probeEnabledEl = body.querySelector('#cwProbeEnabled') as HTMLInputElement;
  const runProbeBtn = body.querySelector('#cwRunProbeBtn') as HTMLButtonElement;
  const runBulkProbeBtn = body.querySelector('#cwRunBulkProbeBtn') as HTMLButtonElement;
  const runStagedProbeBtn = body.querySelector('#cwRunStagedProbeBtn') as HTMLButtonElement;
  const runTurboStagedProbeBtn = body.querySelector(
    '#cwRunTurboStagedProbeBtn'
  ) as HTMLButtonElement;
  const copyProbeBtn = body.querySelector('#cwCopyProbeBtn') as HTMLButtonElement;
  const loadProbeTermsBtn = body.querySelector('#cwLoadProbeTermsBtn') as HTMLButtonElement;
  const probeTermsFileEl = body.querySelector('#cwProbeTermsFile') as HTMLInputElement;
  const probeTermsPathEl = body.querySelector('#cwProbeTermsPath') as HTMLInputElement;
  const probeTermsEl = body.querySelector('#cwProbeTerms') as HTMLTextAreaElement;
  const probeSummary = body.querySelector('#cwProbeSummary') as HTMLDivElement;
  const probeOutput = body.querySelector('#cwProbeOutput') as HTMLPreElement;
  const probeModeAvailable = isCwProbePreviewEnabled();
  let lastProbeReport: Record<string, unknown> | null = null;

  const persistUiState = () => {
    writePersistedCwUiState({
      baseUrl: String(baseUrlEl?.value || '').trim(),
      formId: String(formIdEl?.value || '').trim(),
      username: String(usernameEl?.value || '').trim(),
      password: String(passwordEl?.value || ''),
      searchTerm: String(searchTermEl?.value || '').trim(),
      probeTerms: String(probeTermsEl?.value || ''),
      probeTermsPath: String(probeTermsPathEl?.value || '').trim(),
      probeEnabled: Boolean(probeEnabledEl?.checked),
      lastProbeReport,
    });
  };

  const persisted = readPersistedCwUiState();
  if (persisted.baseUrl && baseUrlEl) baseUrlEl.value = persisted.baseUrl;
  if (persisted.formId && formIdEl) formIdEl.value = persisted.formId;
  if (persisted.username && usernameEl) usernameEl.value = persisted.username;
  if (persisted.password && passwordEl) passwordEl.value = persisted.password;
  if (persisted.searchTerm && searchTermEl) searchTermEl.value = persisted.searchTerm;
  if (persisted.probeTerms && probeTermsEl) probeTermsEl.value = persisted.probeTerms;
  if (persisted.probeTermsPath && probeTermsPathEl)
    probeTermsPathEl.value = persisted.probeTermsPath;
  if (typeof persisted.probeEnabled === 'boolean' && probeEnabledEl) {
    probeEnabledEl.checked = persisted.probeEnabled;
  }
  if (persisted.lastProbeReport && typeof persisted.lastProbeReport === 'object') {
    lastProbeReport = persisted.lastProbeReport;
  }

  [baseUrlEl, formIdEl, usernameEl, passwordEl, searchTermEl, probeTermsPathEl].forEach(el => {
    el?.addEventListener('input', persistUiState);
    el?.addEventListener('change', persistUiState);
  });
  probeTermsEl?.addEventListener('input', persistUiState);
  probeTermsEl?.addEventListener('change', persistUiState);

  if (probePanel) {
    probePanel.style.display = probeModeAvailable ? 'block' : 'none';
  }

  let state: SearchState = {
    rows: [],
    imageUrls: [],
    imageCandidateGroups: [],
    sectionImageGroups: {},
    variantOptions: [],
    activeVariantUrl: '',
    productReference: '',
    productName: '',
    activeSection: '',
    armedRowId: '',
    selectedImageKeys: [],
    rowTargetLabels: {},
  };

  const renderProbeReport = () => {
    if (!probeModeAvailable) return;
    if (!probeEnabledEl?.checked) {
      probeSummary.textContent = 'Probe disabled.';
      probeOutput.textContent = '';
      return;
    }
    if (!lastProbeReport) {
      probeSummary.textContent = 'Probe enabled. Run a search or click Run Probe.';
      probeOutput.textContent = '';
      return;
    }
    const mode = typeof lastProbeReport.mode === 'string' ? lastProbeReport.mode.trim() : '';
    const totalTerms = Number(lastProbeReport.totalTerms || 0);
    const completedTerms = Number(lastProbeReport.completedTerms || totalTerms || 0);
    const transportSuccessCount = Number(
      lastProbeReport.transportSuccessCount || lastProbeReport.successCount || 0
    );
    const measurementHitCount = Number(lastProbeReport.measurementHitCount || 0);
    const averageDurationMs = Number(lastProbeReport.averageDurationMs || 0);
    if (mode && totalTerms > 0) {
      const transportRate = completedTerms > 0 ? (transportSuccessCount / completedTerms) * 100 : 0;
      const measurementHitRate =
        completedTerms > 0 ? (measurementHitCount / completedTerms) * 100 : 0;
      probeSummary.textContent = `${mode}: ${completedTerms}/${totalTerms} terms, transport ${transportSuccessCount} (${transportRate.toFixed(1)}%), QC hits ${measurementHitCount} (${measurementHitRate.toFixed(1)}%), avg ${averageDurationMs || 0}ms.`;
    } else {
      const candidateCount = Array.isArray(lastProbeReport.referenceCandidates)
        ? lastProbeReport.referenceCandidates.length
        : 0;
      const attemptCount = Array.isArray(lastProbeReport.qcMeasurementAttempts)
        ? lastProbeReport.qcMeasurementAttempts.length
        : 0;
      probeSummary.textContent = `Probe ready: ${candidateCount} reference candidates, ${attemptCount} QC attempts.`;
    }
    probeOutput.textContent = JSON.stringify(lastProbeReport, null, 2);
  };

  const requestSearchPayload = async (
    searchTerm: string,
    activeStyleKeyOverride = '',
    options: { probeMode?: 'turbo' | 'default' } = {}
  ): Promise<{
    response: Response;
    data: any;
    rawText: string;
    contentType: string;
    jsonParseError: string | null;
  }> => {
    const baseUrl = String(baseUrlEl?.value || '').trim();
    const formId = String(formIdEl?.value || '').trim();
    const username = String(usernameEl?.value || '').trim();
    const password = String(passwordEl?.value || '');
    const renderedHtml = String(renderedHtmlEl?.value || '');
    const activeStyleKey = String(activeStyleKeyOverride || variantFilterEl.value || '').trim();
    const activeStyle = parseStyleKey(activeStyleKey);

    const response = await fetch('/api/integrations/cw/measurements/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseUrl,
        formId,
        username,
        password,
        search: searchTerm,
        renderedHtml,
        productReference: activeStyle.productReference,
        style: activeStyle.style,
        styleCode: activeStyle.styleCode,
        probeMode: options.probeMode === 'turbo' ? 'turbo' : 'default',
      }),
    });
    const rawText = await response.text().catch(() => '');
    const contentType = String(response.headers.get('content-type') || '');
    let data: any = null;
    let jsonParseError: string | null = null;
    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch (error) {
      jsonParseError = error instanceof Error ? error.message : 'Invalid JSON response';
      data = {
        success: false,
        code: 'CW_SEARCH_NON_JSON_RESPONSE',
        message: 'Search endpoint returned a non-JSON response',
        details: {
          status: response.status,
          contentType,
          bodySnippet: rawText.slice(0, 260),
        },
      };
    }
    return { response, data, rawText, contentType, jsonParseError };
  };

  const visibleRows = () => {
    if (!state.activeSection) return state.rows;
    return state.rows.filter(row => normalizeValueText(row.sectionName) === state.activeSection);
  };

  const renderSectionFilter = () => {
    const rowSections = state.rows.map(row =>
      normalizeSectionName(normalizeValueText(row.sectionName))
    );
    const imageSections = Object.keys(state.sectionImageGroups || {});
    const sections = Array.from(new Set([...rowSections, ...imageSections].filter(Boolean))).sort(
      (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })
    );

    sectionFilterEl.innerHTML = '<option value="">All Sections</option>';
    sections.forEach(section => {
      const option = document.createElement('option');
      option.value = section;
      option.textContent = section;
      if (section === state.activeSection) option.selected = true;
      sectionFilterEl.appendChild(option);
    });
  };

  const renderVariantFilter = () => {
    variantFilterEl.innerHTML = '<option value="">Auto Style</option>';
    state.variantOptions.forEach(item => {
      const option = document.createElement('option');
      option.value = makeStyleKey(item.productReference, item.style, item.styleCode);
      option.textContent = item.label;
      if (option.value === state.activeVariantUrl) option.selected = true;
      variantFilterEl.appendChild(option);
    });
  };

  const allImageEntries = (): Array<{ section: string; key: string; candidates: string[] }> => {
    const entries: Array<{ section: string; key: string; candidates: string[] }> = [];
    const addEntry = (section: string, candidates: string[]) => {
      if (!Array.isArray(candidates) || !candidates.length) return;
      entries.push({
        section,
        key: imageKeyFromUrl(candidates[0] || ''),
        candidates,
      });
    };

    Object.entries(state.sectionImageGroups || {}).forEach(([section, groups]) => {
      (groups || []).forEach(group => addEntry(section, group));
    });

    if (entries.length) return entries;

    (state.imageCandidateGroups || []).forEach(group => {
      addEntry(normalizeSectionName(sectionFromImageName(group[0] || '')) || 'General', group);
    });

    return entries;
  };

  const visibleImageEntries = (): Array<{ section: string; key: string; candidates: string[] }> => {
    const entries = allImageEntries();
    if (!state.activeSection) return entries;
    return entries.filter(entry => entry.section === state.activeSection);
  };

  const selectedImageEntries = (): Array<{ section: string; key: string; candidates: string[] }> =>
    allImageEntries().filter(entry => state.selectedImageKeys.includes(entry.key));

  const setVisibleImageSelection = (selected: boolean) => {
    const visibleKeys = visibleImageEntries()
      .map(entry => entry.key)
      .filter(Boolean);
    const selectedSet = new Set(state.selectedImageKeys);
    visibleKeys.forEach(key => {
      if (selected) {
        selectedSet.add(key);
      } else {
        selectedSet.delete(key);
      }
    });
    state.selectedImageKeys = Array.from(selectedSet);
    imagesWrap.querySelectorAll<HTMLElement>('.cw-image-card').forEach(card => {
      const key = String(card.dataset.imageKey || '');
      const toggle = card.querySelector<HTMLElement>('.cw-image-toggle');
      const toggleInput = card.querySelector<HTMLInputElement>('.cw-image-toggle-input');
      if (!key || !toggle || !visibleKeys.includes(key)) return;
      updateImageCardState(card, toggle, toggleInput, selectedSet.has(key));
    });
  };

  const updateImageCardState = (
    card: HTMLElement,
    toggle: HTMLElement,
    toggleInput: HTMLInputElement | null,
    selected: boolean
  ) => {
    card.classList.toggle('is-selected', selected);
    card.classList.toggle('is-skipped', !selected);
    toggle.classList.toggle('is-selected', selected);
    toggle.classList.toggle('is-skipped', !selected);
    if (toggleInput) {
      toggleInput.checked = selected;
      toggleInput.setAttribute('aria-checked', selected ? 'true' : 'false');
    }
  };

  const renderRows = () => {
    rowsContainer.innerHTML = '';
    const scopeLabel = getCurrentScopeLabel();
    const filteredRows = visibleRows();

    if (!filteredRows.length) {
      const empty = document.createElement('div');
      empty.className = 'cw-measure-row';
      empty.textContent = state.rows.length
        ? 'No measurements in this section filter.'
        : 'No measurement rows available yet.';
      rowsContainer.appendChild(empty);
      return;
    }

    filteredRows.forEach(row => {
      const rowEl = document.createElement('div');
      rowEl.className = 'cw-measure-row';
      if (state.armedRowId === row.id) {
        rowEl.classList.add('armed');
      }

      const sourceEl = document.createElement('div');
      sourceEl.textContent = row.sourceLabel;

      const sectionEl = document.createElement('div');
      sectionEl.textContent = row.sectionName || '-';

      const valueEl = document.createElement('div');
      valueEl.className = 'cw-measure-val';
      valueEl.textContent = row.value;

      const selectWrap = document.createElement('div');
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'cw-measure-input';
      const guessedLabel = guessMosLabel(row.sourceLabel, row.sectionName || '');
      input.placeholder = guessedLabel ? `Suggested: ${guessedLabel}` : 'MOS label (A1, A2, A3...)';
      input.value = state.rowTargetLabels[row.id] || guessedLabel;
      input.addEventListener('input', () => {
        state.rowTargetLabels[row.id] = String(input.value || '').trim();
      });

      const actionWrap = document.createElement('div');
      actionWrap.style.display = 'flex';
      actionWrap.style.gap = '6px';
      actionWrap.style.flexWrap = 'wrap';

      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.className = 'cw-btn';
      applyBtn.textContent = 'Assign Now';
      applyBtn.addEventListener('click', () => {
        const targetLabel = resolveRowTargetLabel(row, String(input.value || '').trim());
        if (!targetLabel) return;
        applyMeasurement(scopeLabel, targetLabel, row.value, row.sourceLabel, lockedEl.checked);
      });

      const drawBtn = document.createElement('button');
      drawBtn.type = 'button';
      drawBtn.className = `cw-btn${state.armedRowId === row.id ? ' cw-btn-primary' : ''}`;
      drawBtn.textContent = state.armedRowId === row.id ? 'Armed' : 'Draw Next';
      drawBtn.addEventListener('click', () => {
        state.armedRowId = state.armedRowId === row.id ? '' : row.id;
        renderRows();
        if (state.armedRowId) {
          setStatus(
            `Armed ${row.sourceLabel}. Draw the next measurement in ${scopeLabel}; value ${row.value} will apply automatically.`,
            'info'
          );
        }
      });

      selectWrap.appendChild(input);
      actionWrap.appendChild(applyBtn);
      actionWrap.appendChild(drawBtn);

      rowEl.appendChild(sourceEl);
      rowEl.appendChild(sectionEl);
      rowEl.appendChild(valueEl);
      rowEl.appendChild(selectWrap);
      rowEl.appendChild(actionWrap);
      rowsContainer.appendChild(rowEl);
    });
  };

  const seedImportedGuideForView = (
    scopeLabel: string,
    sectionName: string,
    rows: ImportedRow[],
    lockByDefault: boolean
  ): number => {
    const w = window as any;
    if (!w.cwImportedMeasurementsByImage) w.cwImportedMeasurementsByImage = {};
    if (!w.cwGuideRolesByImage) w.cwGuideRolesByImage = {};

    const scopeKeys = buildCwScopeCandidates(scopeLabel);
    const roles: string[] = [];
    const seenRoles = new Set<string>();
    const now = new Date().toISOString();

    rows.forEach(row => {
      const guessed = guessMosLabel(row.sourceLabel, row.sectionName || sectionName || '');
      const configured = String(state.rowTargetLabels[row.id] || '').trim();
      const targetLabel = normalizeGuideLabel(configured || guessed || row.sourceLabel);
      const value = String(row.value || '').trim();
      if (!targetLabel || !/^[A-Z](?:\d+)?$/.test(targetLabel) || !value) return;

      if (!seenRoles.has(targetLabel)) {
        seenRoles.add(targetLabel);
        roles.push(targetLabel);
      }

      scopeKeys.forEach(key => {
        if (!w.cwImportedMeasurementsByImage[key]) {
          w.cwImportedMeasurementsByImage[key] = {};
        }
        w.cwImportedMeasurementsByImage[key][targetLabel] = {
          source: 'cw',
          sourceLabel: row.sourceLabel,
          value,
          locked: lockByDefault,
          pending: true,
          autoApplyOnDraw: true,
          sectionName: normalizeSectionName(row.sectionName || sectionName || ''),
          updatedAt: now,
        };
      });
    });

    scopeKeys.forEach(key => {
      w.cwGuideRolesByImage[key] = [...roles];
    });

    return roles.length;
  };

  const enableGuideWorkflowDefaults = async (viewId: string): Promise<void> => {
    const unitSelector = document.getElementById('unitSelector') as HTMLSelectElement | null;
    if (unitSelector) {
      unitSelector.value = 'cm';
      unitSelector.dispatchEvent(new Event('change', { bubbles: true }));
    }

    if (typeof (window as any).setMeasurementGuideIndicatorVisible === 'function') {
      (window as any).setMeasurementGuideIndicatorVisible(true);
    } else {
      try {
        window.localStorage.setItem('openpaint:measurementGuideIndicator:visible', '1');
      } catch {
        // Ignore storage failures.
      }
    }

    const projectManager = (window as any).app?.projectManager;
    if (viewId && typeof projectManager?.switchView === 'function') {
      await projectManager.switchView(viewId, true);
    }

    window.dispatchEvent(new Event('resize'));
  };

  const renderImages = () => {
    imagesWrap.innerHTML = '';
    const baseUrl = (body.querySelector('#cwBaseUrl') as HTMLInputElement).value.trim();
    const username = (body.querySelector('#cwUsername') as HTMLInputElement).value.trim();
    const password = (body.querySelector('#cwPassword') as HTMLInputElement).value;
    const entries = visibleImageEntries().slice(0, 16);

    entries.forEach(entry => {
      const group = entry.candidates;
      const direct = group.find(url => state.imageUrls.includes(url)) || '';
      const isSelected = state.selectedImageKeys.includes(entry.key);
      const card = document.createElement('div');
      card.className = 'cw-image-card';
      card.tabIndex = 0;
      card.setAttribute('role', 'button');

      const toggle = document.createElement('label');
      toggle.className = 'cw-image-toggle';
      const toggleInput = document.createElement('input');
      toggleInput.type = 'checkbox';
      toggleInput.className = 'cw-image-toggle-input';
      toggleInput.setAttribute('aria-label', `Import ${fileStemFromUrl(group[0] || '')}`);
      const toggleText = document.createElement('span');
      toggleText.className = 'cw-image-toggle-text';
      toggleText.textContent = 'Import';
      toggle.appendChild(toggleInput);
      toggle.appendChild(toggleText);
      updateImageCardState(card, toggle, toggleInput, isSelected);
      card.dataset.imageKey = entry.key;

      const setSelectedState = (nextSelected: boolean) => {
        const selectedKeys = new Set(state.selectedImageKeys);
        if (!nextSelected) {
          selectedKeys.delete(entry.key);
        } else {
          selectedKeys.add(entry.key);
        }
        state.selectedImageKeys = Array.from(selectedKeys);
        updateImageCardState(card, toggle, toggleInput, nextSelected);
      };

      card.addEventListener('click', event => {
        const target = event.target as HTMLElement | null;
        if (target?.closest('.cw-image-toggle')) return;
        setSelectedState(!toggleInput.checked);
      });
      card.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        setSelectedState(!toggleInput.checked);
      });
      toggle.addEventListener('click', event => {
        event.stopPropagation();
      });
      toggleInput.addEventListener('change', () => {
        setSelectedState(toggleInput.checked);
      });

      const meta = document.createElement('div');
      meta.className = 'cw-image-meta';
      const sectionEl = document.createElement('div');
      sectionEl.className = 'cw-image-section';
      sectionEl.textContent = entry.section || 'General';
      const nameEl = document.createElement('div');
      nameEl.className = 'cw-image-name';
      nameEl.textContent = fileStemFromUrl(group[0] || '');
      meta.appendChild(sectionEl);
      meta.appendChild(nameEl);

      if (!direct) {
        void (async () => {
          const dataUrl = await fetchProxyImageDataUrl(group, baseUrl, username, password);
          if (!dataUrl) return;
          const img = document.createElement('img');
          img.src = dataUrl;
          img.alt = 'cw-product';
          card.appendChild(img);
          card.appendChild(toggle);
          card.appendChild(meta);
          imagesWrap.appendChild(card);
        })();
        return;
      }
      const img = document.createElement('img');
      img.src = direct;
      img.alt = 'cw-product';
      img.addEventListener('error', () => {
        void (async () => {
          const dataUrl = await fetchProxyImageDataUrl(group, baseUrl, username, password);
          if (dataUrl) {
            img.src = dataUrl;
          }
        })();
      });
      card.appendChild(img);
      card.appendChild(toggle);
      card.appendChild(meta);
      imagesWrap.appendChild(card);
    });
  };

  const setStatus = (message: string, kind: 'info' | 'ok' | 'bad' = 'info') => {
    resultMeta.textContent = message;
    resultMeta.style.color = kind === 'ok' ? '#166534' : kind === 'bad' ? '#b91c1c' : '#334155';
  };

  const setProbeButtonsDisabled = (disabled: boolean) => {
    searchBtn.disabled = disabled;
    if (runProbeBtn) runProbeBtn.disabled = disabled;
    if (runBulkProbeBtn) runBulkProbeBtn.disabled = disabled;
    if (runStagedProbeBtn) runStagedProbeBtn.disabled = disabled;
    if (runTurboStagedProbeBtn) runTurboStagedProbeBtn.disabled = disabled;
  };

  const getProbeTerms = (): string[] => {
    const seeded = String(probeTermsEl?.value || '')
      .split(/\r?\n|,|;/)
      .map(item => item.trim())
      .filter(Boolean);
    const fallbackSearch = String(searchTermEl?.value || '').trim();
    return Array.from(new Set(seeded.length ? seeded : fallbackSearch ? [fallbackSearch] : []));
  };

  const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

  const runProbeTerms = async (
    terms: string[],
    statusPrefix: string,
    options: {
      initialConcurrency?: number;
      adaptiveConcurrency?: boolean;
      minConcurrency?: number;
      maxConcurrency?: number;
      probeMode?: 'turbo' | 'default';
    } = {}
  ): Promise<{
    entries: Array<Record<string, unknown>>;
    successCount: number;
    transportSuccessCount: number;
    measurementHitCount: number;
    measurementMissCount: number;
    nonJsonCount: number;
    averageDurationMs: number;
    finalConcurrency: number;
  }> => {
    const minConcurrency = Math.max(1, Number(options.minConcurrency || PROBE_MIN_CONCURRENCY));
    const maxConcurrency = Math.max(
      minConcurrency,
      Number(options.maxConcurrency || PROBE_MAX_CONCURRENCY)
    );
    let concurrency = Math.min(
      maxConcurrency,
      Math.max(minConcurrency, Number(options.initialConcurrency || PROBE_DEFAULT_CONCURRENCY))
    );
    const adaptiveConcurrency = options.adaptiveConcurrency !== false;

    const reportEntries: Array<Record<string, unknown>> = new Array(terms.length);
    let transportSuccessCount = 0;
    let measurementHitCount = 0;
    let nonJsonCount = 0;
    let completed = 0;
    let cursor = 0;
    let durationSampleCount = 0;
    let durationMsTotal = 0;

    const runOne = async (term: string, index: number) => {
      try {
        const { response, data, rawText, contentType, jsonParseError } = await requestSearchPayload(
          term,
          '',
          { probeMode: options.probeMode || 'default' }
        );
        const origins = Array.isArray(data?.referenceCandidateOrigins)
          ? data.referenceCandidateOrigins
          : [];
        const syntheticCount = origins.filter(
          (item: any) =>
            Array.isArray(item?.origins) && item.origins.includes('syntheticScopedFallback')
        ).length;
        const durationMs = Number(data?.durationMs);
        const qcMeasurementsFound = Boolean(data?.summary?.qcMeasurementsFound);
        return {
          index,
          entry: {
            term,
            ok: response.ok,
            status: response.status,
            contentType,
            nonJsonResponse: Boolean(jsonParseError),
            rawBodySnippet: rawText.slice(0, 260),
            code: data?.code || null,
            message: data?.message || null,
            probeModeRequested: data?.probeModeRequested || options.probeMode || null,
            probeModeApplied: data?.probeModeApplied || data?.probeMode || null,
            responseProfile: data?.responseProfile || null,
            compactDiagnostics: data?.responseCompactDiagnostics || null,
            selectedProductReference: data?.product?.reference || null,
            durationMs: Number.isFinite(durationMs) ? durationMs : null,
            candidateCount: Array.isArray(data?.referenceCandidates)
              ? data.referenceCandidates.length
              : 0,
            syntheticScopedCandidateCount: syntheticCount,
            qcAttemptCount: Array.isArray(data?.qcMeasurementAttempts)
              ? data.qcMeasurementAttempts.length
              : 0,
            qcMeasurementsFound,
            qcAttemptedCount: Number(data?.summary?.qcAttemptedCount || 0),
            qcDeadReferenceCount: Number(data?.summary?.qcDeadReferenceCount || 0),
            qcSkippedAttemptCount: Number(data?.summary?.qcSkippedAttemptCount || 0),
            qcSkippedAttemptsByReason: data?.summary?.qcSkippedAttemptsByReason || null,
            referenceCandidates: data?.referenceCandidates || [],
            referenceCandidateOrigins: origins,
            selectedTuples: data?.selectedTuples || [],
            attemptPlanMode: data?.attemptPlanMode || null,
            tupleSource: data?.tupleSource || null,
          },
        };
      } catch (error) {
        return {
          index,
          entry: {
            term,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          },
        };
      }
    };

    while (cursor < terms.length) {
      const batchStart = cursor;
      const batchTerms = terms.slice(batchStart, Math.min(terms.length, batchStart + concurrency));
      cursor += batchTerms.length;

      setStatus(
        `${statusPrefix} ${completed + 1}-${completed + batchTerms.length}/${terms.length} (x${concurrency})`
      );

      const batchResults = await Promise.all(
        batchTerms.map((term, offset) => runOne(term, batchStart + offset))
      );

      let batchNonJsonCount = 0;
      let batchFailureCount = 0;
      batchResults.forEach(result => {
        reportEntries[result.index] = result.entry;
        if (result.entry?.ok) {
          transportSuccessCount += 1;
          if (result.entry?.qcMeasurementsFound) {
            measurementHitCount += 1;
          }
        } else {
          batchFailureCount += 1;
        }
        const entryDuration = Number(result.entry?.durationMs);
        if (Number.isFinite(entryDuration) && entryDuration >= 0) {
          durationSampleCount += 1;
          durationMsTotal += entryDuration;
        }
        if (result.entry?.nonJsonResponse) {
          nonJsonCount += 1;
          batchNonJsonCount += 1;
        }
      });

      completed += batchTerms.length;
      setStatus(`${statusPrefix} ${completed}/${terms.length} complete (x${concurrency})`);

      if (adaptiveConcurrency && batchTerms.length > 0) {
        const batchFailureRate = batchFailureCount / batchTerms.length;
        if (batchNonJsonCount >= 2 || batchFailureRate >= 0.75) {
          concurrency = Math.max(minConcurrency, concurrency - 1);
        } else if (batchNonJsonCount === 0 && batchFailureRate <= 0.25) {
          concurrency = Math.min(maxConcurrency, concurrency + 1);
        }
      }

      if (PROBE_REQUEST_DELAY_MS > 0 && cursor < terms.length) {
        await delay(PROBE_REQUEST_DELAY_MS);
      }
    }

    return {
      entries: reportEntries.filter(Boolean),
      successCount: transportSuccessCount,
      transportSuccessCount,
      measurementHitCount,
      measurementMissCount: transportSuccessCount - measurementHitCount,
      nonJsonCount,
      averageDurationMs:
        durationSampleCount > 0 ? Math.round(durationMsTotal / durationSampleCount) : 0,
      finalConcurrency: concurrency,
    };
  };

  const runSearch = async () => {
    const baseUrl = String(baseUrlEl?.value || '').trim();
    const search = String(searchTermEl?.value || '').trim();
    const activeStyleKey = String(variantFilterEl.value || state.activeVariantUrl || '').trim();

    if (!search) {
      setStatus('Enter a product search term.', 'bad');
      return;
    }

    setProbeButtonsDisabled(true);
    setStatus('Searching CW product measurements...');

    try {
      const { response, data, rawText, contentType, jsonParseError } = await requestSearchPayload(
        search,
        activeStyleKey
      );
      const probeReport = {
        at: new Date().toISOString(),
        search,
        ok: response.ok,
        status: response.status,
        contentType,
        nonJsonResponse: Boolean(jsonParseError),
        rawBodySnippet: rawText.slice(0, 260),
        code: data?.code || null,
        message: data?.message || null,
        probeModeRequested: data?.probeModeRequested || null,
        probeModeApplied: data?.probeModeApplied || data?.probeMode || null,
        responseProfile: data?.responseProfile || null,
        compactDiagnostics: data?.responseCompactDiagnostics || null,
        product: data?.product || null,
        summary: data?.summary || null,
        referenceCandidates: data?.referenceCandidates || [],
        referenceCandidateOrigins: data?.referenceCandidateOrigins || [],
        styleOptions: data?.styleOptions || [],
        selectedTuples: data?.selectedTuples || [],
        attemptPlanMode: data?.attemptPlanMode || null,
        tupleSource: data?.tupleSource || null,
        qcMeasurementAttempts: data?.qcMeasurementAttempts || [],
      } as Record<string, unknown>;
      if (probeModeAvailable && probeEnabledEl?.checked) {
        lastProbeReport = probeReport;
        persistUiState();
        renderProbeReport();
      }
      const variantOptions = buildVariantOptions(data);
      const preferredOption =
        variantOptions.find(item => /signature|cnrp_sp/i.test(item.label)) || variantOptions[0];
      const preferredVariantUrl =
        makeStyleKey(
          preferredOption?.productReference || data?.product?.reference || '',
          preferredOption?.style || '',
          preferredOption?.styleCode || ''
        ) || '';
      const activeVariantUrl = activeStyleKey || state.activeVariantUrl || preferredVariantUrl;
      const payloadForRows = buildPayloadForVariant(data, activeVariantUrl);

      const rows = extractRows(payloadForRows).map(row => ({
        ...row,
        sectionName: classifyMeasurementSection(
          row.sourceLabel,
          row.sectionName || row.sourceLabel
        ),
      }));
      const imageCandidates = extractImageUrls(payloadForRows, baseUrl);
      const imageCandidateGroups = groupImageCandidates(imageCandidates);
      const sectionImageGroups = mergeSectionImageGroups(
        collectSectionImageGroups(payloadForRows, baseUrl),
        imageCandidateGroups
      );
      const imageUrls = await resolveWorkingImageUrls(imageCandidates);
      const allImageKeys = (
        Object.values(sectionImageGroups).flat().length
          ? Object.values(sectionImageGroups).flat()
          : imageCandidateGroups
      )
        .map(group => imageKeyFromUrl(group[0] || ''))
        .filter(Boolean);
      state = {
        rows,
        imageUrls,
        imageCandidateGroups,
        sectionImageGroups,
        variantOptions,
        activeVariantUrl,
        productReference: String(data?.product?.reference || ''),
        productName: String(
          data?.product?.translations?.[0]?.name || data?.product?.translations?.[0]?.slug || ''
        ),
        activeSection: '',
        armedRowId: '',
        selectedImageKeys: Array.from(new Set(allImageKeys)),
        rowTargetLabels: {},
      };

      renderVariantFilter();
      renderImages();
      renderSectionFilter();
      renderRows();
      setStatus(
        response.ok
          ? `Loaded ${rows.length} measurements across ${Math.max(Object.keys(sectionImageGroups).length, 1)} sections and ${imageUrls.length}/${imageCandidates.length} reachable photos for ${state.productReference || 'product'}${state.productName ? ` (${state.productName})` : ''}. Click photos to include or skip them before importing.`
          : `Search failed: ${String(data?.message || data?.code || response.status)}`,
        response.ok ? 'ok' : 'bad'
      );
    } catch (error) {
      if (probeModeAvailable && probeEnabledEl?.checked) {
        lastProbeReport = {
          at: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error),
        };
        persistUiState();
        renderProbeReport();
      }
      setStatus(
        `Search request failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'bad'
      );
    } finally {
      setProbeButtonsDisabled(false);
    }
  };

  searchBtn.addEventListener('click', () => {
    void runSearch();
  });

  if (probeEnabledEl) {
    probeEnabledEl.addEventListener('change', () => {
      persistUiState();
      renderProbeReport();
    });
  }

  if (runProbeBtn) {
    runProbeBtn.addEventListener('click', () => {
      if (!probeModeAvailable) return;
      if (!probeEnabledEl?.checked) {
        probeEnabledEl.checked = true;
        persistUiState();
      }
      void runSearch();
    });
  }

  if (runBulkProbeBtn) {
    runBulkProbeBtn.addEventListener('click', async () => {
      if (!probeModeAvailable) return;
      if (!probeEnabledEl?.checked) {
        probeEnabledEl.checked = true;
        persistUiState();
      }

      const terms = getProbeTerms();

      if (!terms.length) {
        setStatus('Add probe terms (one per line) or set Product search first.', 'bad');
        return;
      }

      setProbeButtonsDisabled(true);
      setStatus(`Running bulk probe for ${terms.length} term(s)...`);

      try {
        const stage = await runProbeTerms(terms, 'Bulk probe', {
          initialConcurrency: PROBE_DEFAULT_CONCURRENCY,
          adaptiveConcurrency: true,
          minConcurrency: PROBE_MIN_CONCURRENCY,
          maxConcurrency: PROBE_MAX_CONCURRENCY,
          probeMode: 'default',
        });

        lastProbeReport = {
          at: new Date().toISOString(),
          mode: 'bulk-probe',
          totalTerms: terms.length,
          successCount: stage.transportSuccessCount,
          transportSuccessCount: stage.transportSuccessCount,
          measurementHitCount: stage.measurementHitCount,
          measurementMissCount: stage.measurementMissCount,
          failureCount: terms.length - stage.transportSuccessCount,
          nonJsonCount: stage.nonJsonCount,
          averageDurationMs: stage.averageDurationMs,
          finalConcurrency: stage.finalConcurrency,
          terms,
          entries: stage.entries,
        };
        persistUiState();
        renderProbeReport();
        setStatus(
          `Bulk probe complete: transport ${stage.transportSuccessCount}/${terms.length}, QC hits ${stage.measurementHitCount}/${terms.length}, avg ${stage.averageDurationMs}ms.`,
          stage.measurementHitCount > 0 ? 'ok' : stage.transportSuccessCount > 0 ? 'info' : 'bad'
        );
      } finally {
        setProbeButtonsDisabled(false);
      }
    });
  }

  if (runStagedProbeBtn) {
    runStagedProbeBtn.addEventListener('click', async () => {
      if (!probeModeAvailable) return;
      if (!probeEnabledEl?.checked) {
        probeEnabledEl.checked = true;
        persistUiState();
      }

      const terms = getProbeTerms();
      if (!terms.length) {
        setStatus('Add probe terms (one per line) or set Product search first.', 'bad');
        return;
      }

      const stagePlan = [
        { name: 'pilot', size: STAGED_PROBE_BATCH_SIZES[0] },
        { name: 'medium', size: STAGED_PROBE_BATCH_SIZES[1] },
      ];

      setProbeButtonsDisabled(true);
      setStatus(`Running staged probe for ${terms.length} term(s)...`);

      const allEntries: Array<Record<string, unknown>> = [];
      const stageReports: Array<Record<string, unknown>> = [];
      let totalTransportSuccess = 0;
      let totalMeasurementHits = 0;
      let totalNonJson = 0;
      let totalDurationMs = 0;
      let totalDurationSamples = 0;
      let cursor = 0;
      let halted = false;
      let haltReason = '';

      try {
        for (let stageIndex = 0; stageIndex < stagePlan.length + 1; stageIndex += 1) {
          const stageName = stageIndex < stagePlan.length ? stagePlan[stageIndex].name : 'full';
          const stageSize =
            stageIndex < stagePlan.length
              ? Math.min(stagePlan[stageIndex].size, Math.max(terms.length - cursor, 0))
              : Math.max(terms.length - cursor, 0);
          if (stageSize <= 0) continue;

          const stageTerms = terms.slice(cursor, cursor + stageSize);
          const stage = await runProbeTerms(stageTerms, `Stage ${stageIndex + 1} (${stageName})`, {
            initialConcurrency: PROBE_DEFAULT_CONCURRENCY,
            adaptiveConcurrency: true,
            minConcurrency: PROBE_MIN_CONCURRENCY,
            maxConcurrency: PROBE_MAX_CONCURRENCY,
            probeMode: 'default',
          });

          const failureCount = stageTerms.length - stage.transportSuccessCount;
          const failureRate = stageTerms.length ? failureCount / stageTerms.length : 0;
          const measurementHitRate = stageTerms.length
            ? stage.measurementHitCount / stageTerms.length
            : 0;
          const transportSuccessRate = stageTerms.length
            ? stage.transportSuccessCount / stageTerms.length
            : 0;

          allEntries.push(...stage.entries);
          stageReports.push({
            stageIndex: stageIndex + 1,
            stage: stageName,
            startOffset: cursor,
            termCount: stageTerms.length,
            successCount: stage.transportSuccessCount,
            transportSuccessCount: stage.transportSuccessCount,
            failureCount,
            transportSuccessRate,
            measurementHitCount: stage.measurementHitCount,
            measurementMissCount: stage.measurementMissCount,
            measurementHitRate,
            nonJsonCount: stage.nonJsonCount,
            averageDurationMs: stage.averageDurationMs,
            failureRate,
            finalConcurrency: stage.finalConcurrency,
          });
          totalTransportSuccess += stage.transportSuccessCount;
          totalMeasurementHits += stage.measurementHitCount;
          totalNonJson += stage.nonJsonCount;
          if (stage.averageDurationMs > 0) {
            totalDurationMs += stage.averageDurationMs * stageTerms.length;
            totalDurationSamples += stageTerms.length;
          }
          cursor += stageTerms.length;

          lastProbeReport = {
            at: new Date().toISOString(),
            mode: 'staged-bulk-probe',
            totalTerms: terms.length,
            completedTerms: cursor,
            successCount: totalTransportSuccess,
            transportSuccessCount: totalTransportSuccess,
            measurementHitCount: totalMeasurementHits,
            measurementMissCount: totalTransportSuccess - totalMeasurementHits,
            failureCount: cursor - totalTransportSuccess,
            nonJsonCount: totalNonJson,
            averageDurationMs:
              totalDurationSamples > 0 ? Math.round(totalDurationMs / totalDurationSamples) : 0,
            halted,
            haltReason: haltReason || null,
            stages: stageReports,
            entries: allEntries,
          };
          persistUiState();
          renderProbeReport();

          if (stage.nonJsonCount >= STAGED_PROBE_NON_JSON_STOP_COUNT) {
            halted = true;
            haltReason = `Stopped after stage ${stageIndex + 1}: ${stage.nonJsonCount} non-JSON responses.`;
            break;
          }
          if (failureRate > STAGED_PROBE_FAILURE_RATE_STOP) {
            halted = true;
            haltReason = `Stopped after stage ${stageIndex + 1}: failure rate ${(failureRate * 100).toFixed(1)}%.`;
            break;
          }
          if (cursor < terms.length) {
            await delay(350);
          }
        }

        lastProbeReport = {
          at: new Date().toISOString(),
          mode: 'staged-bulk-probe',
          totalTerms: terms.length,
          completedTerms: cursor,
          successCount: totalTransportSuccess,
          transportSuccessCount: totalTransportSuccess,
          measurementHitCount: totalMeasurementHits,
          measurementMissCount: totalTransportSuccess - totalMeasurementHits,
          failureCount: cursor - totalTransportSuccess,
          nonJsonCount: totalNonJson,
          averageDurationMs:
            totalDurationSamples > 0 ? Math.round(totalDurationMs / totalDurationSamples) : 0,
          halted,
          haltReason: haltReason || null,
          stages: stageReports,
          entries: allEntries,
        };
        persistUiState();
        renderProbeReport();

        if (halted) {
          setStatus(
            `Staged probe halted at ${cursor}/${terms.length}. ${haltReason}`,
            cursor > 0 ? 'info' : 'bad'
          );
        } else {
          const averageDurationMs =
            totalDurationSamples > 0 ? Math.round(totalDurationMs / totalDurationSamples) : 0;
          setStatus(
            `Staged probe complete: transport ${totalTransportSuccess}/${terms.length}, QC hits ${totalMeasurementHits}/${terms.length}, avg ${averageDurationMs}ms.`,
            totalMeasurementHits > 0 ? 'ok' : totalTransportSuccess > 0 ? 'info' : 'bad'
          );
        }
      } finally {
        setProbeButtonsDisabled(false);
      }
    });
  }

  if (runTurboStagedProbeBtn) {
    runTurboStagedProbeBtn.addEventListener('click', async () => {
      if (!probeModeAvailable) return;
      if (!probeEnabledEl?.checked) {
        probeEnabledEl.checked = true;
        persistUiState();
      }

      const terms = getProbeTerms();
      if (!terms.length) {
        setStatus('Add probe terms (one per line) or set Product search first.', 'bad');
        return;
      }

      const stagePlan = [
        { name: 'pilot', size: STAGED_PROBE_BATCH_SIZES[0] },
        { name: 'medium', size: STAGED_PROBE_BATCH_SIZES[1] },
      ];

      setProbeButtonsDisabled(true);
      setStatus(`Running turbo staged probe for ${terms.length} term(s)...`);

      const allEntries: Array<Record<string, unknown>> = [];
      const stageReports: Array<Record<string, unknown>> = [];
      let totalTransportSuccess = 0;
      let totalMeasurementHits = 0;
      let totalNonJson = 0;
      let totalDurationMs = 0;
      let totalDurationSamples = 0;
      let cursor = 0;
      let halted = false;
      let haltReason = '';

      try {
        for (let stageIndex = 0; stageIndex < stagePlan.length + 1; stageIndex += 1) {
          const stageName = stageIndex < stagePlan.length ? stagePlan[stageIndex].name : 'full';
          const stageSize =
            stageIndex < stagePlan.length
              ? Math.min(stagePlan[stageIndex].size, Math.max(terms.length - cursor, 0))
              : Math.max(terms.length - cursor, 0);
          if (stageSize <= 0) continue;

          const stageTerms = terms.slice(cursor, cursor + stageSize);
          const stage = await runProbeTerms(
            stageTerms,
            `Turbo Stage ${stageIndex + 1} (${stageName})`,
            {
              initialConcurrency: PROBE_TURBO_DEFAULT_CONCURRENCY,
              adaptiveConcurrency: true,
              minConcurrency: PROBE_TURBO_MIN_CONCURRENCY,
              maxConcurrency: PROBE_TURBO_MAX_CONCURRENCY,
              probeMode: 'turbo',
            }
          );

          const failureCount = stageTerms.length - stage.transportSuccessCount;
          const failureRate = stageTerms.length ? failureCount / stageTerms.length : 0;
          const measurementHitRate = stageTerms.length
            ? stage.measurementHitCount / stageTerms.length
            : 0;
          const transportSuccessRate = stageTerms.length
            ? stage.transportSuccessCount / stageTerms.length
            : 0;

          allEntries.push(...stage.entries);
          stageReports.push({
            stageIndex: stageIndex + 1,
            stage: stageName,
            startOffset: cursor,
            termCount: stageTerms.length,
            successCount: stage.transportSuccessCount,
            transportSuccessCount: stage.transportSuccessCount,
            failureCount,
            transportSuccessRate,
            measurementHitCount: stage.measurementHitCount,
            measurementMissCount: stage.measurementMissCount,
            measurementHitRate,
            nonJsonCount: stage.nonJsonCount,
            averageDurationMs: stage.averageDurationMs,
            failureRate,
            finalConcurrency: stage.finalConcurrency,
          });
          totalTransportSuccess += stage.transportSuccessCount;
          totalMeasurementHits += stage.measurementHitCount;
          totalNonJson += stage.nonJsonCount;
          if (stage.averageDurationMs > 0) {
            totalDurationMs += stage.averageDurationMs * stageTerms.length;
            totalDurationSamples += stageTerms.length;
          }
          cursor += stageTerms.length;

          lastProbeReport = {
            at: new Date().toISOString(),
            mode: 'turbo-staged-bulk-probe',
            totalTerms: terms.length,
            completedTerms: cursor,
            successCount: totalTransportSuccess,
            transportSuccessCount: totalTransportSuccess,
            measurementHitCount: totalMeasurementHits,
            measurementMissCount: totalTransportSuccess - totalMeasurementHits,
            failureCount: cursor - totalTransportSuccess,
            nonJsonCount: totalNonJson,
            averageDurationMs:
              totalDurationSamples > 0 ? Math.round(totalDurationMs / totalDurationSamples) : 0,
            halted,
            haltReason: haltReason || null,
            stages: stageReports,
            entries: allEntries,
          };
          persistUiState();
          renderProbeReport();

          if (stage.nonJsonCount >= STAGED_PROBE_NON_JSON_STOP_COUNT) {
            halted = true;
            haltReason = `Stopped after turbo stage ${stageIndex + 1}: ${stage.nonJsonCount} non-JSON responses.`;
            break;
          }
          if (failureRate > STAGED_PROBE_FAILURE_RATE_STOP) {
            halted = true;
            haltReason = `Stopped after turbo stage ${stageIndex + 1}: failure rate ${(failureRate * 100).toFixed(1)}%.`;
            break;
          }
          if (cursor < terms.length) {
            await delay(180);
          }
        }

        lastProbeReport = {
          at: new Date().toISOString(),
          mode: 'turbo-staged-bulk-probe',
          totalTerms: terms.length,
          completedTerms: cursor,
          successCount: totalTransportSuccess,
          transportSuccessCount: totalTransportSuccess,
          measurementHitCount: totalMeasurementHits,
          measurementMissCount: totalTransportSuccess - totalMeasurementHits,
          failureCount: cursor - totalTransportSuccess,
          nonJsonCount: totalNonJson,
          averageDurationMs:
            totalDurationSamples > 0 ? Math.round(totalDurationMs / totalDurationSamples) : 0,
          halted,
          haltReason: haltReason || null,
          stages: stageReports,
          entries: allEntries,
        };
        persistUiState();
        renderProbeReport();

        if (halted) {
          setStatus(
            `Turbo staged probe halted at ${cursor}/${terms.length}. ${haltReason}`,
            cursor > 0 ? 'info' : 'bad'
          );
        } else {
          const averageDurationMs =
            totalDurationSamples > 0 ? Math.round(totalDurationMs / totalDurationSamples) : 0;
          setStatus(
            `Turbo staged probe complete: transport ${totalTransportSuccess}/${terms.length}, QC hits ${totalMeasurementHits}/${terms.length}, avg ${averageDurationMs}ms.`,
            totalMeasurementHits > 0 ? 'ok' : totalTransportSuccess > 0 ? 'info' : 'bad'
          );
        }
      } finally {
        setProbeButtonsDisabled(false);
      }
    });
  }

  if (copyProbeBtn) {
    copyProbeBtn.addEventListener('click', async () => {
      if (!lastProbeReport) {
        setStatus('No probe report to copy yet.', 'bad');
        return;
      }
      const text = JSON.stringify(lastProbeReport, null, 2);
      try {
        await navigator.clipboard.writeText(text);
        setStatus('Probe report copied to clipboard.', 'ok');
      } catch {
        probeOutput.textContent = text;
        setStatus('Clipboard write failed; probe report is shown in panel.', 'bad');
      }
    });
  }

  if (loadProbeTermsBtn) {
    loadProbeTermsBtn.addEventListener('click', async () => {
      const selectedFile = probeTermsFileEl?.files?.[0] || null;
      const filePath = String(probeTermsPathEl?.value || '').trim();
      if (!selectedFile && !filePath) {
        setStatus('Choose an export HTML file or provide a server file path.', 'bad');
        return;
      }
      loadProbeTermsBtn.disabled = true;
      setStatus('Loading probe terms from export file...');
      try {
        if (selectedFile) {
          const html = await selectedFile.text();
          const parsed = parseProbeTermsFromExportHtml(html);
          probeTermsEl.value = parsed.terms.join('\n');
          if (!String(searchTermEl?.value || '').trim() && parsed.terms[0]) {
            searchTermEl.value = parsed.terms[0];
          }
          persistUiState();
          setStatus(
            `Loaded ${parsed.terms.length} terms from ${selectedFile.name} (${parsed.totalRows} rows scanned).`,
            'ok'
          );
          return;
        }

        const response = await fetch('/api/integrations/cw/measurements/probe-terms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath }),
        });
        const text = await response.text();
        let data: any = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          setStatus(
            'Failed to load terms from server path. Use file upload above on hosted environments.',
            'bad'
          );
          return;
        }
        if (!response.ok || !data?.success) {
          setStatus(
            `Failed to load terms: ${String(data?.message || data?.code || response.status)}`,
            'bad'
          );
          return;
        }
        const terms = Array.isArray(data?.terms)
          ? data.terms.map((item: unknown) => String(item || '').trim()).filter(Boolean)
          : [];
        probeTermsEl.value = terms.join('\n');
        if (!String(searchTermEl?.value || '').trim() && terms[0]) {
          searchTermEl.value = terms[0];
        }
        persistUiState();
        setStatus(`Loaded ${terms.length} terms from server file path.`, 'ok');
      } catch (error) {
        setStatus(
          `Failed to load terms: ${error instanceof Error ? error.message : 'Unknown error'}`,
          'bad'
        );
      } finally {
        loadProbeTermsBtn.disabled = false;
      }
    });
  }

  variantFilterEl.addEventListener('change', () => {
    state.activeVariantUrl = String(variantFilterEl.value || '').trim();
    void runSearch();
  });

  sectionFilterEl.addEventListener('change', () => {
    state.activeSection = normalizeSectionName(String(sectionFilterEl.value || '').trim());
    renderImages();
    renderRows();
  });

  selectVisibleImagesBtn?.addEventListener('click', () => {
    setVisibleImageSelection(true);
    setStatus('Selected all visible photos for import.', 'info');
  });

  clearVisibleImagesBtn?.addEventListener('click', () => {
    setVisibleImageSelection(false);
    setStatus('Cleared visible photo selections.', 'info');
  });

  importExactBtn.addEventListener('click', () => {
    const scopeLabel = getCurrentScopeLabel();
    const strokeSet = new Set(getStrokeLabels(scopeLabel));
    let applied = 0;

    visibleRows().forEach(row => {
      if (!strokeSet.has(row.sourceLabel)) return;
      const ok = applyMeasurement(
        scopeLabel,
        row.sourceLabel,
        row.value,
        row.sourceLabel,
        lockedEl.checked
      );
      if (ok) applied += 1;
    });

    renderRows();
    setStatus(
      applied > 0
        ? `Imported ${applied} measurements to matching labels in ${scopeLabel}.`
        : `No matching stroke labels found in ${scopeLabel}.`,
      applied > 0 ? 'ok' : 'bad'
    );
  });

  importPhotosBtn.addEventListener('click', async () => {
    const selectedEntries = selectedImageEntries();
    if (!selectedEntries.length) {
      setStatus('Select at least one photo to import.', 'bad');
      return;
    }

    const imageRegistry = (window as any).imageRegistry;
    const projectManager = (window as any).app?.projectManager;
    if (!projectManager) {
      setStatus('Project manager not available.', 'bad');
      return;
    }

    importPhotosBtn.disabled = true;
    let imported = 0;
    let seededViews = 0;
    let firstImportedViewId = '';
    try {
      const baseUrl = String(baseUrlEl?.value || '').trim();
      const username = String(usernameEl?.value || '').trim();
      const password = String(passwordEl?.value || '');

      for (const entry of selectedEntries) {
        const section = entry.section;
        const group = entry.candidates;

        // Always prefer proxied data URL for canvas import to avoid cross-origin
        // Fabric.js loading failures on remote hosts without CORS headers.
        // eslint-disable-next-line no-await-in-loop
        let resolvedUrl = await fetchProxyImageDataUrl(group, baseUrl, username, password);
        if (!resolvedUrl) {
          const fallbackDirect = group.find(url => state.imageUrls.includes(url)) || '';
          if (!isHttpUrl(fallbackDirect)) {
            resolvedUrl = fallbackDirect;
          }
        }
        if (!resolvedUrl) continue;

        const sectionSlug = slugify(section) || 'section';
        const imageSlug = slugify(makeViewIdFromUrl(group[0] || '')) || 'photo';
        const seed = `${state.productReference || 'cw'}-${sectionSlug}-${imageSlug}`;
        const viewId = nextUniqueViewId(seed);
        const fileName = `${viewId}.jpg`;

        if (imageRegistry?.registerImage) {
          await imageRegistry.registerImage(viewId, resolvedUrl, fileName, { source: 'cw-import' });
        } else {
          await projectManager.addImage(viewId, resolvedUrl, { refreshBackground: false });
          if (typeof (window as any).addImageToSidebar === 'function') {
            (window as any).addImageToSidebar(resolvedUrl, viewId, fileName);
          }
        }
        if (!firstImportedViewId) {
          firstImportedViewId = viewId;
        }
        const sectionRows = state.rows.filter(
          row =>
            normalizeSectionName(String(row.sectionName || '').trim()) ===
            normalizeSectionName(section)
        );
        const seededCount = seedImportedGuideForView(
          viewId,
          section,
          sectionRows,
          lockedEl.checked
        );
        if (seededCount > 0) {
          seededViews += 1;
        }
        imported += 1;
      }

      if (imported === 0) {
        setStatus('Could not resolve any importable photos for the selected images.', 'bad');
        return;
      }

      await enableGuideWorkflowDefaults(firstImportedViewId);
      setStatus(
        `Imported ${imported} selected photo${imported === 1 ? '' : 's'} into project views, seeded ${seededViews} guide${seededViews === 1 ? '' : 's'}, and switched units to cm.`,
        'ok'
      );
    } catch (error) {
      setStatus(
        `Photo import partially completed (${imported}): ${error instanceof Error ? error.message : 'Unknown error'}`,
        'bad'
      );
    } finally {
      importPhotosBtn.disabled = false;
    }
  });

  window.addEventListener('openpaint:stroke-created', event => {
    const detail = (event as CustomEvent)?.detail || {};
    const strokeLabel = String(detail?.strokeLabel || '').trim();
    const imageLabel = String(detail?.imageLabel || '').trim();
    if (!strokeLabel || !imageLabel) return;

    if (state.armedRowId) {
      const row = state.rows.find(item => item.id === state.armedRowId);
      if (!row) {
        state.armedRowId = '';
        renderRows();
        return;
      }

      const metadata = (window as any).app?.metadataManager;
      let targetLabel = strokeLabel;
      const configuredLabel = String(state.rowTargetLabels[row.id] || '').trim();
      const desiredLabel = resolveRowTargetLabel(row, configuredLabel, strokeLabel);
      if (metadata?.renameStrokeLabel && desiredLabel && desiredLabel !== strokeLabel) {
        const rename = metadata.renameStrokeLabel(imageLabel, strokeLabel, desiredLabel);
        if (rename?.ok && rename?.label) {
          targetLabel = rename.label;
        }
      }

      const ok = applyMeasurement(
        imageLabel,
        targetLabel,
        row.value,
        row.sourceLabel,
        lockedEl.checked
      );
      state.armedRowId = '';
      renderRows();
      setStatus(
        ok
          ? `Applied ${row.sourceLabel} (${row.value}) to ${targetLabel}.`
          : `Failed to apply ${row.sourceLabel} to ${targetLabel}.`,
        ok ? 'ok' : 'bad'
      );
      return;
    }

    const seeded = getCwImportedMeasurementEntry(imageLabel, strokeLabel);
    if (!seeded || seeded.autoApplyOnDraw !== true || seeded.pending === false) {
      return;
    }

    const ok = applyMeasurement(
      imageLabel,
      strokeLabel,
      String(seeded.value || ''),
      String(seeded.sourceLabel || strokeLabel),
      seeded.locked === true
    );
    if (ok) {
      markCwImportedMeasurementApplied(imageLabel, strokeLabel, seeded);
      setStatus(
        `Applied CW guide value ${seeded.value} to ${normalizeGuideLabel(strokeLabel)}.`,
        'ok'
      );
    } else {
      setStatus(
        `Failed to auto-apply CW guide value for ${normalizeGuideLabel(strokeLabel)}.`,
        'bad'
      );
    }
  });

  const close = () => {
    overlay.style.display = 'none';
  };

  renderProbeReport();

  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', event => {
    if (event.target === overlay) close();
  });

  head.appendChild(closeBtn);
  card.appendChild(head);
  card.appendChild(body);
  overlay.appendChild(card);
  return overlay;
}

function applyMeasurement(
  scopeLabel: string,
  strokeLabel: string,
  value: string,
  sourceLabel: string,
  lockByDefault: boolean
): boolean {
  const metadata = (window as any).app?.metadataManager;
  if (!metadata) return false;
  const normalizedScope = metadata.normalizeImageLabel
    ? metadata.normalizeImageLabel(scopeLabel)
    : scopeLabel;

  const measurementSystem = (window as any).app?.measurementSystem;
  const exactCmValue = parseImportedCentimeterValue(value);
  const explicitCmInput =
    exactCmValue !== null ? `${exactCmValue} cm` : `${String(value || '').trim()} cm`;

  let parsed = false;
  if (measurementSystem?.parseMeasurementInput && measurementSystem?.setMeasurement) {
    const measurement = measurementSystem.parseMeasurementInput(explicitCmInput, 'cm');
    if (measurement) {
      measurementSystem.setMeasurement(
        normalizedScope,
        strokeLabel,
        measurement.inchWhole,
        measurement.inchFraction,
        {
          cmValue: exactCmValue ?? measurement.cm,
        }
      );
      parsed = true;
    }
  }

  if (!parsed) {
    parsed = Boolean(
      metadata.parseAndSaveMeasurement?.(normalizedScope, strokeLabel, explicitCmInput)
    );
  }

  if (!parsed) {
    (window as any).app?.projectManager?.showStatusMessage?.(
      `Could not parse measurement value \"${value}\" for ${strokeLabel}`,
      'error'
    );
    return false;
  }

  if (lockByDefault) {
    setMeasurementLock(normalizedScope, strokeLabel, true);
  }

  const w = window as any;
  if (!w.cwImportedMeasurementsByImage) w.cwImportedMeasurementsByImage = {};
  if (!w.cwImportedMeasurementsByImage[normalizedScope])
    w.cwImportedMeasurementsByImage[normalizedScope] = {};
  w.cwImportedMeasurementsByImage[normalizedScope][strokeLabel] = {
    source: 'cw',
    sourceLabel,
    value,
    locked: lockByDefault,
    updatedAt: new Date().toISOString(),
  };

  metadata.updateStrokeVisibilityControls?.();
  return true;
}

function openModal(): void {
  const modal = document.getElementById(MODAL_ID);
  if (!modal) return;
  modal.style.display = 'flex';
}

function parseImportedCentimeterValue(value: string): number | null {
  const normalized = String(value || '')
    .trim()
    .replace(/,/g, '');
  if (!normalized) return null;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function resolveRowTargetLabel(
  row: ImportedRow | undefined,
  configuredLabel: string,
  fallbackLabel = ''
): string {
  const explicit = normalizeGuideLabel(configuredLabel);
  if (explicit) return explicit;
  if (row) {
    const guessed = normalizeGuideLabel(guessMosLabel(row.sourceLabel, row.sectionName || ''));
    if (guessed) return guessed;
  }
  return normalizeGuideLabel(fallbackLabel);
}

function attachToolbarButton(): void {
  if (document.getElementById('cwImportBtn')) return;
  const target =
    document.getElementById('tbRight') || document.getElementById('canvasControlsContent');
  if (!target) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tbtn';
  btn.id = 'cwImportBtn';
  btn.title = 'Import CW/PID measurements';
  btn.textContent = 'CW Import';
  btn.addEventListener('click', openModal);
  target.appendChild(btn);
}

export function initCwImportUI(): void {
  ensureStyles();
  if (!(window as any).isCwMeasurementLocked) {
    (window as any).isCwMeasurementLocked = (scopeLabel: string, strokeLabel: string) => {
      return Boolean((window as any).cwMeasurementLocksByImage?.[scopeLabel]?.[strokeLabel]);
    };
  }
  if (!(window as any).setCwMeasurementLock) {
    (window as any).setCwMeasurementLock = setMeasurementLock;
  }

  const modal = createModal();
  document.body.appendChild(modal);
  attachToolbarButton();
}
