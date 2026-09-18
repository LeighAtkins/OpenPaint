import {
  openMeasurementSplitWorkspace,
  shouldAllowMeasurementSplitEdit,
} from './measurement-split-workspace';
import { imageRegistry } from '../ImageRegistry.js';
import { getNextTagValue, setNextTagValue } from './next-tag-control.js';
import {
  applySharedComparisonFabric,
  parseCatalogueComparisonInput,
  type CatalogueComparisonRequestItem,
} from './cw-catalogue-comparison';
import {
  buildReplayPlan,
  hasRecipeForImageUrl,
  initCwLineLibrary,
  installCwLineLibraryBridge,
  isReplayInProgress,
  scheduleCaptureForView,
  setReplayInProgress,
} from './cw-line-library';
import { FabricControls } from '../utils/FabricControls.js';

interface ImportedRow {
  id: string;
  sourceLabel: string;
  value: string;
  sectionName?: string;
  pieces?: string;
  skirtLength?: string;
}

interface VariantOption {
  productReference: string;
  style: string;
  styleCode: string;
  label: string;
  source?: string;
}

interface VersionOption {
  code: string;
  label: string;
  scopedReference?: string;
  isDefault?: boolean;
  confirmed?: boolean | null;
  source?: string;
}

interface SearchResultItem {
  id: string | null;
  productReference: string;
  productName: string;
  status: string | null;
  translations: Array<{ name?: string; slug?: string; lang?: string }>;
  configParsed: boolean;
  versionOptions: VersionOption[];
  styleOptions: VariantOption[];
  derivedScopedReferences: string[];
  selected: boolean;
  selectedVersionCode: string;
  selectedStyleKey: string;
}

export function isCwConfigurationSelectionReady(item: {
  versionOptions?: unknown[];
  styleOptions?: unknown[];
  selectedVersionCode?: string;
  selectedStyleKey?: string;
}): boolean {
  const versionOptions = Array.isArray(item.versionOptions) ? item.versionOptions : [];
  const styleOptions = Array.isArray(item.styleOptions) ? item.styleOptions : [];
  return (
    (versionOptions.length === 0 || Boolean(item.selectedVersionCode?.trim())) &&
    (styleOptions.length === 0 || Boolean(item.selectedStyleKey?.trim()))
  );
}

interface BasketItem {
  productId: string;
  selectionKey: string;
  search: string;
  productReference: string;
  productName: string;
  versionCode: string;
  versionLabel: string;
  scopedReference: string;
  style: string;
  styleCode: string;
  styleOptions: VariantOption[];
  versionOptions: VersionOption[];
  derivedScopedReferences: string[];
  label: string;
}

interface LoadedMeasurementItem {
  selectionKey: string;
  basketItem: BasketItem;
  productReference: string;
  productName: string;
  rows: ImportedRow[];
  imageUrls: string[];
  imageCandidateGroups: string[][];
  sectionImageGroups: Record<string, string[][]>;
  rawData: any;
  loadMessage: string;
  success: boolean;
}

interface StorefrontProduct {
  title: string;
  url: string;
  imageUrl: string;
  imageUrls?: string[];
  dimensions?: {
    width?: unknown;
    depth?: unknown;
    height?: unknown;
  } | null;
  measurementReference?: string;
  measurementStyle?: string;
  measurementStyleCode?: string;
}

interface CatalogueComparisonItem extends CatalogueComparisonRequestItem {
  imageUrl: string;
  productUrl: string;
  requestedSku: string;
  matchedSku: string;
  imageMatch: 'exact' | 'configuration-fallback' | 'product-fallback' | 'unavailable';
  note: string;
  dimensions?: StorefrontProduct['dimensions'];
  measurementReference?: string;
  measurementStyle?: string;
  measurementStyleCode?: string;
  configurationGroups?: Array<{
    key: string;
    label: string;
    codeIndex: number;
    options: Array<{ code: string; label: string }>;
  }>;
}

type VisibleImportedRow = ImportedRow & {
  rowKey: string;
  itemKey: string;
  itemLabel: string;
  productReference: string;
};

interface VisibleImageEntry {
  itemKey: string;
  itemLabel: string;
  productReference: string;
  section: string;
  key: string;
  selectionImageKey: string;
  candidates: string[];
}

interface SearchState {
  searchResults: SearchResultItem[];
  basket: BasketItem[];
  loadedItems: LoadedMeasurementItem[];
  activeItemKey: string;
  activeSection: string;
  armedRowKey: string;
  armedRowKeyByScope: Record<string, string>;
  readyRowKeyByScope: Record<string, string>;
  readyLabelByScope: Record<string, string>;
  // The Library row the user deliberately chose to draw. This is kept as one
  // atomic record because view/tab aliases can otherwise mix a row from one
  // alias with a label from another during Fabric's mouse-up lifecycle.
  activeDrawIntentByScope: Record<
    string,
    {
      rowKey: string;
      label: string;
    }
  >;
  completedLabelsByScope: Record<string, string[]>;
  completedRowKeysByScope: Record<string, string[]>;
  selectedImageKeys: string[];
  rowTargetLabels: Record<string, string>;
  rowOriginalValues: Record<string, string>;
  rowValueOverrides: Record<string, string>;
  rowValueInvalid: Record<string, boolean>;
  discoveryImageUrls: string[];
  storefrontProduct: StorefrontProduct | null;
  comparisonItems: CatalogueComparisonItem[];
  importedViewMetaByScope: Record<
    string,
    {
      itemKey: string;
      sectionName: string;
    }
  >;
}

function makeStyleKey(productReference: string, style: string, styleCode: string): string {
  return `${(productReference || '').trim()}||${(style || '').trim()}||${(styleCode || '').trim()}`;
}

function parseStyleKey(styleKey: string): {
  productReference: string;
  style: string;
  styleCode: string;
} {
  const [productReference = '', style = '', styleCode = ''] = (styleKey || '').split('||');
  return {
    productReference: (productReference || '').trim(),
    style: (style || '').trim(),
    styleCode: (styleCode || '').trim(),
  };
}

function makeSelectionKey(
  productReference: string,
  versionCode: string,
  style: string,
  styleCode: string
): string {
  return [
    (productReference || '').trim(),
    (versionCode || '').trim(),
    (style || '').trim(),
    (styleCode || '').trim(),
  ].join('|');
}

function getScopedReference(productReference: string, versionCode: string): string {
  const base = (productReference || '').trim();
  const code = (versionCode || '').trim().toUpperCase();
  if (!base) return '';
  if (!code || code === 'DF') return base;
  return `${base}__${code}`;
}

function buildBasketLabel(item: {
  productReference: string;
  productName?: string;
  versionLabel?: string;
  style?: string;
  styleCode?: string;
}): string {
  const segments = [
    (item?.productReference || '').trim(),
    (item?.productName || '').trim(),
    (item?.versionLabel || '').trim(),
    (item?.style || '').trim(),
  ].filter(Boolean);
  const styleCode = (item?.styleCode || '').trim();
  return `${segments.join(' / ')}${styleCode ? ` (${styleCode})` : ''}` || 'CW Item';
}

function makeRowStorageKey(itemKey: string, rowId: string): string {
  return `${(itemKey || '').trim()}::${(rowId || '').trim()}`;
}

const MODAL_ID = 'cwImportModalOverlay';
const STYLE_ID = 'cwImportStyles';
const CW_UI_STATE_KEY = 'openpaint:cw-import-ui:v1';
const CW_SESSION_PASSWORD_KEY = 'openpaint:cw-import-password:session';
// Bump when a cached API payload gains fields that change the available UI.
// v4 adds exact per-product configuration option labels to comparison responses.
const CW_REQUEST_CACHE_PREFIX = 'openpaint:cw-import-cache:v5:';
const CW_REQUEST_CACHE_TTL_MS = 10 * 60 * 1000;
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

interface CwUiPersistedState {
  baseUrl?: string;
  formId?: string;
  username?: string;
  searchTerm?: string;
  probeTerms?: string;
  probeTermsPath?: string;
  probeEnabled?: boolean;
  lastProbeReport?: Record<string, unknown> | null;
}

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

function readSessionCwPassword(): string {
  try {
    return window.sessionStorage.getItem(CW_SESSION_PASSWORD_KEY) || '';
  } catch {
    return '';
  }
}

function writeSessionCwPassword(password: string): void {
  try {
    if (password) window.sessionStorage.setItem(CW_SESSION_PASSWORD_KEY, password);
    else window.sessionStorage.removeItem(CW_SESSION_PASSWORD_KEY);
  } catch {
    // Session persistence is optional when storage is unavailable.
  }
}

function isCwProbePreviewEnabled(): boolean {
  // Probe diagnostics are kept in the codebase for internal debugging,
  // but the panel should not be exposed in the app UI.
  return false;
}

function parseProbeTermsFromExportHtml(html: string): {
  terms: string[];
  totalRows: number;
  referenceColumnIndex: number;
} {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html || '', 'text/html');
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
      (cell.textContent || '').replace(/\s+/g, ' ').trim()
    )
  );

  const header = rowCells[1] || [];
  const referenceColumnIndex = header.findIndex(col => col.toUpperCase() === 'REFERENCE');
  const dataRows = rowCells.slice(2);
  const terms: string[] = [];
  const seen = new Set<string>();

  dataRows.forEach(row => {
    if (referenceColumnIndex < 0) return;
    const value = (row[referenceColumnIndex] || '').trim();
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
    .cw-import-card { box-sizing: border-box; width: min(1040px, calc(100vw - 32px)); max-width: 100%; height: min(860px, calc(100dvh - 32px)); max-height: calc(100dvh - 32px); min-width: 0; overflow: hidden; background: #fff; border: 1px solid rgba(203,213,225,.9); border-radius: 8px; box-shadow: 0 28px 50px rgba(15, 23, 42, 0.28); display: flex; flex-direction: column; }
    .cw-import-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid #e2e8f0; }
    .cw-import-head h3 { margin: 0; font-size: 15px; color: #0f172a; }
    .cw-import-close { border: 1px solid #cbd5e1; background: #fff; color: #334155; border-radius: 8px; padding: 4px 8px; cursor: pointer; }
    .cw-import-body { min-width: 0; min-height: 0; padding: 12px 14px; overflow: auto; overscroll-behavior: contain; }
    .cw-grid { display: grid; gap: 10px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .cw-grid-full { grid-column: 1 / -1; }
    .cw-import-body label { display: block; margin: 0 0 4px; font-size: 12px; color: #334155; }
    .cw-import-body input { width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px 10px; font-size: 13px; }
    .cw-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 10px; }
    .cw-btn { border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; color: #334155; padding: 7px 10px; font-size: 12px; cursor: pointer; }
    .cw-btn-primary { border-color: #0f172a; background: #0f172a; color: #fff; }
    .cw-note { margin-top: 8px; font-size: 12px; color: #64748b; display: none; }
    .cw-flow-steps { margin-top: 8px; display: flex; gap: 4px; align-items: center; font-size: 12px; color: #94a3b8; }
    .cw-flow-step { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border-radius: 999px; background: #f1f5f9; font-weight: 600; transition: all 150ms ease; }
    .cw-flow-step.is-active { background: #0f172a; color: #fff; }
    .cw-flow-step.is-done { background: #dcfce7; color: #166534; }
    .cw-flow-arrow { font-size: 10px; color: #cbd5e1; }
    .cw-section-collapsible { display: none; }
    .cw-section-collapsible.has-content { display: block; }
    .cw-discovery-preview { margin-top: 8px; display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; }
    .cw-discovery-thumb { width: 56px; height: 42px; object-fit: cover; border-radius: 6px; border: 1px solid #e2e8f0; background: #f0f0f0; flex-shrink: 0; }
    .cw-result-meta { margin-top: 12px; font-size: 12px; color: #334155; }
    .cw-load-progress { display: none; margin-top: 10px; }
    .cw-load-progress.visible { display: block; }
    .cw-load-progress-copy { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 6px; color: #475569; font-size: 11px; }
    .cw-load-progress-copy strong { color: #0f172a; font-weight: 700; }
    .cw-load-progress-track { height: 5px; overflow: hidden; border-radius: 999px; background: #e2e8f0; }
    .cw-load-progress-bar { width: 0; height: 100%; border-radius: inherit; background: #2563eb; transition: width 220ms ease; }
    .cw-load-progress.complete .cw-load-progress-bar { background: #16a34a; }
    .cw-discovery-grid { margin-top: 8px; display: grid; gap: 6px; }
    .cw-result-card, .cw-basket-card { position: relative; border: 1px solid #d7dee8; border-radius: 8px; padding: 11px 12px; background: #fff; }
    .cw-result-card:hover { background: #f8fafc; }
    .cw-result-card.is-selected { border-color: #2563eb; background: #eff6ff; box-shadow: inset 3px 0 0 #2563eb; }
    .cw-result-top { display: flex; gap: 10px; align-items: flex-start; justify-content: space-between; }
    .cw-result-check { margin-top: 2px; width: 16px !important; height: 16px; accent-color: #0f172a; }
    .cw-result-title { margin: 0; font-size: 13px; font-weight: 700; color: #0f172a; }
    .cw-result-subtitle { margin: 4px 0 0; font-size: 11px; color: #64748b; }
    .cw-result-pill { display: inline-flex; align-items: center; gap: 4px; border-radius: 999px; padding: 3px 8px; font-size: 10px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; background: #e2e8f0; color: #334155; }
    .cw-result-pill.is-ok { background: #dcfce7; color: #166534; }
    .cw-result-controls { margin-top: 10px; display: grid; gap: 8px; grid-template-columns: repeat(2, minmax(0, 1fr)) auto; align-items: end; }
    .cw-result-field { display: grid !important; gap: 4px; min-width: 0; margin: 0 !important; color: #64748b !important; font-size: 10px !important; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
    .cw-result-controls .cw-btn { min-height: 34px; white-space: nowrap; }
    .cw-result-action { display: grid; gap: 4px; }
    .cw-result-action small { color: #64748b; font-size: 10px; white-space: nowrap; }
    .cw-result-controls .cw-btn:disabled { cursor: not-allowed; opacity: 0.45; }
    .cw-select { width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; padding: 7px 9px; font-size: 12px; background: #fff; }
    .cw-section-label { margin-top: 14px; display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 11px; font-weight: 700; color: #334155; letter-spacing: 0.05em; text-transform: uppercase; }
    .cw-basket-wrap { margin-top: 10px; display: grid; gap: 8px; }
    .cw-basket-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .cw-basket-copy { min-width: 0; }
    .cw-basket-title { margin: 0; font-size: 12px; font-weight: 700; color: #0f172a; }
    .cw-basket-meta { margin: 3px 0 0; font-size: 11px; color: #64748b; }
    .cw-loaded-summary { margin-top: 10px; display: grid; gap: 8px; }
    .cw-loaded-item { border: 1px solid #dbe4ee; border-radius: 12px; padding: 10px 12px; background: linear-gradient(180deg, rgba(248, 250, 252, 0.92), rgba(255, 255, 255, 0.98)); transition: border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease, opacity 120ms ease; }
    .cw-loaded-item.is-clickable { cursor: pointer; }
    .cw-loaded-item.is-clickable:hover { transform: translateY(-1px); border-color: #94a3b8; box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08); }
    .cw-loaded-item.is-active { border-color: #0f172a; box-shadow: 0 0 0 2px rgba(15, 23, 42, 0.08), 0 12px 24px rgba(15, 23, 42, 0.1); }
    .cw-loaded-item.is-disabled { opacity: 0.6; }
    .cw-loaded-item.is-all-items { background: linear-gradient(180deg, rgba(241, 245, 249, 0.96), rgba(255, 255, 255, 0.98)); }
    .cw-loaded-item strong { color: #0f172a; }
    .cw-loaded-item small { color: #64748b; }
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
    .cw-image-item { font-size: 10px; color: #475569; font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase; }
    .cw-image-toggle { position: absolute; top: 8px; right: 8px; display: inline-flex; align-items: center; gap: 6px; padding: 4px 7px; border-radius: 999px; background: rgba(255, 255, 255, 0.94); color: #0f172a; font-size: 11px; font-weight: 700; box-shadow: 0 6px 16px rgba(15, 23, 42, 0.16); pointer-events: auto; }
    .cw-image-toggle.is-selected { background: rgba(15, 23, 42, 0.94); color: #fff; }
    .cw-image-toggle.is-skipped { background: rgba(148, 163, 184, 0.92); color: #fff; }
    .cw-image-toggle-input { width: 14px !important; height: 14px; margin: 0; accent-color: #0f172a; cursor: pointer; }
    .cw-image-toggle-text { line-height: 1; }
    .cw-image-actions { display: inline-flex; gap: 6px; align-items: center; }
    .cw-measure-wrap { margin-top: 12px; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; }
    .cw-measure-head { display: grid; grid-template-columns: 160px 120px 1fr 180px 180px; gap: 8px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; padding: 8px; font-size: 11px; font-weight: 600; color: #475569; }
    .cw-measure-row { display: grid; grid-template-columns: 160px 120px 1fr 180px 180px; gap: 8px; align-items: center; padding: 8px; border-bottom: 1px solid #f1f5f9; font-size: 12px; }
    .cw-measure-row:last-child { border-bottom: none; }
    .cw-measure-row.armed { background: #dbeafe; box-shadow: inset 3px 0 0 #2563eb; }
    .cw-measure-row.armed.label-required { background: #fff1f2; box-shadow: inset 3px 0 0 #ef4444; }
    .cw-measure-row.armed.label-required .cw-measure-input { border-color: #f87171; background: #fffafa; box-shadow: 0 0 0 2px rgba(239,68,68,.08); }
    .cw-measure-row.ready { background: #f8fafc; box-shadow: inset 3px 0 0 #94a3b8; }
    .cw-measure-row.suggested { background: #f8fafc; }
    .cw-measure-value-field { position: relative; min-width: 0; }
    .cw-measure-value-input { width: 100%; min-width: 62px; height: 32px; padding: 5px 42px 5px 7px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; color: #0f172a; font: inherit; font-weight: 700; }
    .cw-measure-value-input:focus { border-color: #2563eb; outline: 2px solid rgba(37,99,235,.14); outline-offset: 0; }
    .cw-measure-value-input[aria-invalid="true"] { border-color: #dc2626; background: #fef2f2; }
    .cw-measure-reset { position: absolute; top: 7px; right: 5px; z-index: 1; padding: 2px 3px; border: 0; background: #fff; color: #2563eb; font-size: 9px; font-weight: 700; line-height: 1.2; cursor: pointer; }
    .cw-split-measure-wrap { margin-top: 0; width: 100%; height: 100%; min-width: 0; min-height: 0; flex: 1 1 auto; display: flex; flex-direction: column; border-radius: 18px; border: 1px solid rgba(203, 213, 225, 0.85); background: rgba(255,255,255,0.98); box-shadow: 0 16px 36px rgba(15, 23, 42, 0.08); overflow: hidden; }
    .cw-split-measure-wrap .cw-measure-head { position: sticky; top: 0; z-index: 2; padding: 12px 14px; background: linear-gradient(180deg, #f8fafc 0%, #eef4ff 100%); border-bottom-color: rgba(203, 213, 225, 0.9); }
    .cw-split-rows { width: 100%; flex: 1 1 auto; min-width: 0; min-height: 0; overflow: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; padding-bottom: 18px; }
    .cw-split-measure-wrap .cw-measure-group { padding: 10px 14px 4px; }
    .cw-split-measure-wrap .cw-measure-row { padding: 12px 14px; font-size: 13px; }
    .cw-split-measure-wrap .cw-measure-input { min-height: 40px; font-size: 13px; }
    .cw-measure-group { padding: 10px 8px; background: linear-gradient(180deg, #ffffff, #f8fafc); border-bottom: 1px solid #e2e8f0; font-size: 11px; font-weight: 700; color: #0f172a; letter-spacing: 0.03em; text-transform: uppercase; }
    .cw-measure-val { color: #0f172a; font-weight: 600; }
    .cw-measure-input { width: 100%; border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 8px; font-size: 12px; }
    .cw-workspace-next { display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: center; gap: 12px; margin: 10px 12px; padding: 12px; border: 1px solid #bfdbfe; border-radius: 8px; background: #eff6ff; }
    .cw-workspace-next-copy { min-width: 0; }
    .cw-workspace-next-kicker { color: #1d4ed8; font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
    .cw-workspace-next-main { display: flex; align-items: baseline; gap: 8px; margin-top: 3px; }
    .cw-workspace-next-label { color: #0f172a; font-size: 22px; font-weight: 750; }
    .cw-workspace-next-value { color: #0f172a; font-size: 18px; font-weight: 650; }
    .cw-workspace-next-source { overflow: hidden; margin-top: 2px; color: #64748b; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
    .cw-split-measure-wrap.compact .cw-measure-head,
    .cw-split-measure-wrap.compact .cw-measure-row { grid-template-columns: minmax(150px,1.5fr) 78px 92px 82px; gap: 8px; }
    .cw-split-measure-wrap.compact .cw-measure-head { padding: 8px 12px; }
    .cw-split-measure-wrap.compact .cw-measure-row { min-height: 54px; padding: 8px 12px; cursor: pointer; }
    .cw-split-measure-wrap.compact .cw-measure-input { min-height: 32px; padding: 4px 7px; font-size: 13px; font-weight: 700; text-align: center; }
    .cw-split-measure-wrap.compact .cw-btn { min-height: 32px; width: 100%; padding: 5px 8px; }
    .cw-queue-dock { position: fixed; right: 318px; bottom: 72px; z-index: 4800; display: none; width: min(390px, calc(100vw - 32px)); border: 1px solid #cbd5e1; border-radius: 8px; background: rgba(255,255,255,.98); box-shadow: 0 10px 28px rgba(15,23,42,.16); backdrop-filter: blur(10px); overflow: hidden; }
    .cw-queue-dock.visible { display: block; }
    .cw-queue-dock-bar { display: flex; align-items: center; gap: 10px; min-height: 48px; padding: 8px 10px; cursor: pointer; }
    .cw-queue-dock-copy { min-width: 0; flex: 1; }
    .cw-queue-dock-kicker { color: #64748b; font-size: 9px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
    .cw-queue-dock-main { overflow: hidden; color: #0f172a; font-size: 14px; font-weight: 750; text-overflow: ellipsis; white-space: nowrap; }
    .cw-queue-dock-source { overflow: hidden; color: #64748b; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
    .cw-queue-dock-actions { display: flex; gap: 5px; }
    .cw-queue-dock .cw-btn { min-height: 30px; padding: 5px 9px; }
    .cw-queue-progress { flex: 0 0 auto; min-width: 40px; color: #475569; font-size: 10px; font-weight: 700; text-align: right; }
    .cw-queue-chevron { width: 28px; min-width: 28px !important; padding: 0 !important; font-size: 14px; }
    .cw-queue-panel { display: none; border-top: 1px solid #e2e8f0; background: #fff; }
    .cw-queue-dock.expanded .cw-queue-panel { display: block; }
    .cw-queue-tools { display: flex; gap: 6px; padding: 8px; border-bottom: 1px solid #eef2f7; }
    .cw-queue-search { min-width: 0; flex: 1; height: 32px; border: 1px solid #cbd5e1; border-radius: 6px; padding: 0 10px; color: #0f172a; font-size: 12px; outline: none; }
    .cw-queue-search:focus { border-color: #2563eb; box-shadow: 0 0 0 2px rgba(37,99,235,.12); }
    .cw-queue-list { max-height: min(330px, 42vh); overflow-y: auto; overscroll-behavior: contain; }
    .cw-queue-item { display: grid; grid-template-columns: 62px minmax(0,1fr) auto 54px; align-items: center; gap: 8px; width: 100%; min-height: 44px; border: 0; border-bottom: 1px solid #f1f5f9; padding: 6px 10px; background: #fff; color: #0f172a; text-align: left; }
    .cw-queue-item:hover { background: #f8fafc; }
    .cw-queue-item.active { background: #eff6ff; box-shadow: inset 3px 0 0 #2563eb; }
    .cw-queue-item.done { opacity: .55; }
    .cw-queue-label { width: 100%; min-width: 0; height: 30px; border: 1px solid #cbd5e1; border-radius: 6px; padding: 0 6px; color: #0f172a; background: #fff; font-size: 13px; font-weight: 800; text-transform: uppercase; }
    .cw-queue-label:focus { border-color: #2563eb; outline: 0; box-shadow: 0 0 0 2px rgba(37,99,235,.12); }
    .cw-queue-name { min-width: 0; overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
    .cw-queue-value { font-size: 12px; font-weight: 700; white-space: nowrap; }
    .cw-queue-empty { padding: 18px 12px; color: #64748b; font-size: 12px; text-align: center; }
    .cw-queue-footer { display: flex; justify-content: space-between; gap: 6px; padding: 7px 8px; border-top: 1px solid #eef2f7; background: #f8fafc; }
    @media (max-width: 900px) { .cw-queue-dock { right: 12px; bottom: 70px; } }
    .cw-section-select { width: 220px; border: 1px solid #cbd5e1; border-radius: 8px; padding: 6px 8px; font-size: 12px; }
    .cw-rendered-html { width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px 10px; min-height: 92px; resize: vertical; font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    .cw-product-search-shell { position: sticky; top: -12px; z-index: 8; margin: -4px -2px 0; padding: 8px 2px 12px; background: rgba(255,255,255,.97); backdrop-filter: blur(10px); }
    .cw-product-search-label { display: flex !important; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 7px !important; color: #0f172a !important; font-size: 13px !important; font-weight: 700; }
    .cw-product-search-label span { color: #64748b; font-size: 11px; font-weight: 500; }
    .cw-product-search-row { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 8px; }
    .cw-product-search-row input { min-height: 42px; border-color: #94a3b8; font-size: 15px; }
    .cw-product-search-row .cw-btn { min-width: 92px; min-height: 42px; font-size: 13px; font-weight: 700; }
    .cw-comparison-builder { margin-top: 9px; border: 1px solid #dbe4ee; border-radius: 8px; background: #f8fafc; }
    .cw-comparison-builder > summary { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 36px; padding: 7px 10px; color: #334155; cursor: pointer; font-size: 12px; font-weight: 700; list-style: none; }
    .cw-comparison-builder > summary::-webkit-details-marker { display: none; }
    .cw-comparison-builder > summary::after { content: '+'; color: #64748b; font-size: 16px; font-weight: 500; }
    .cw-comparison-builder[open] > summary::after { content: '−'; }
    .cw-comparison-body { padding: 0 10px 10px; }
    .cw-comparison-copy { margin: 0 0 7px; color: #64748b; font-size: 11px; line-height: 1.4; }
    .cw-comparison-input { display: block; width: 100%; min-height: 88px; resize: vertical; border: 1px solid #cbd5e1; border-radius: 7px; padding: 8px 10px; background: #fff; color: #0f172a; font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; outline: none; }
    .cw-comparison-input:focus { border-color: #2563eb; box-shadow: 0 0 0 2px rgba(37,99,235,.12); }
    .cw-comparison-toolbar { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
    .cw-comparison-fabric { width: 132px; height: 32px; flex: 0 0 132px; border: 1px solid #cbd5e1; border-radius: 7px; padding: 0 9px; background: #fff; color: #0f172a; font-size: 11px; font-weight: 650; outline: none; }
    .cw-comparison-fabric:focus { border-color: #2563eb; box-shadow: 0 0 0 2px rgba(37,99,235,.12); }
    .cw-comparison-status { min-width: 0; flex: 1; color: #64748b; font-size: 11px; }
    .cw-comparison-items { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 7px; margin-top: 9px; }
    .cw-comparison-item { min-width: 0; overflow: hidden; border: 1px solid #dbe4ee; border-radius: 7px; background: #fff; }
    .cw-comparison-item-image { display: flex; align-items: center; justify-content: center; height: 108px; padding: 5px; background: #f1f5f9; }
    .cw-comparison-item-image img { display: block; width: 100%; height: 100%; object-fit: contain; }
    .cw-comparison-item-copy { padding: 7px; }
    .cw-comparison-item-title { overflow: hidden; color: #0f172a; font-size: 11px; font-weight: 750; text-overflow: ellipsis; white-space: nowrap; }
    .cw-comparison-item-config { margin-top: 2px; overflow: hidden; color: #475569; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
    .cw-comparison-item-note { margin-top: 5px; color: #64748b; font-size: 9px; line-height: 1.25; }
    .cw-comparison-item-note.exact { color: #166534; }
    .cw-comparison-item-note.fallback { color: #9a3412; }
    .cw-comparison-item-options { display: grid; gap: 5px; margin-top: 7px; padding-top: 7px; border-top: 1px solid #eef2f7; }
    .cw-comparison-item-option { display: grid; grid-template-columns: 48px minmax(0,1fr); align-items: center; gap: 5px; color: #64748b; font-size: 9px; font-weight: 700; }
    .cw-comparison-item-option select { width: 100%; min-width: 0; height: 27px; border: 1px solid #cbd5e1; border-radius: 6px; padding: 0 22px 0 6px; background: #fff; color: #0f172a; font-size: 10px; font-weight: 650; outline: none; }
    .cw-comparison-item-option select:focus { border-color: #2563eb; box-shadow: 0 0 0 2px rgba(37,99,235,.1); }
    .cw-comparison-item.is-refreshing { opacity: .65; }
    .cw-comparison-item-action { width: 100%; min-height: 28px; margin-top: 7px; }
    .cw-product-results-shell { margin-top: 4px; }
    .cw-product-results-shell.is-empty .cw-section-label { display: none; }
    .cw-product-workspace { display: none; margin-top: 14px; border-top: 1px solid #e2e8f0; }
    .cw-product-workspace.has-product { display: block; }
    .cw-product-toolbar { position: sticky; top: 58px; z-index: 7; display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 0 -2px; padding: 10px 2px; background: rgba(255,255,255,.97); backdrop-filter: blur(10px); }
    .cw-product-toolbar-copy { min-width: 0; }
    .cw-product-toolbar-title { overflow: hidden; color: #0f172a; font-size: 14px; font-weight: 750; text-overflow: ellipsis; white-space: nowrap; }
    .cw-product-toolbar-meta { margin-top: 2px; color: #64748b; font-size: 11px; }
    .cw-product-actions { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; justify-content: flex-end; }
    .cw-product-actions .cw-btn { min-height: 34px; }
    .cw-internal-control { display: none !important; }
    .cw-product-content { display: grid; gap: 12px; }
    .cw-product-pane { min-width: 0; }
    .cw-product-pane .cw-section-label { margin-top: 4px; }
    .cw-product-pane .cw-images { grid-template-columns: repeat(2,minmax(0,1fr)); }
    .cw-product-pane .cw-measure-wrap { max-height: 52vh; overflow: auto; }
    .cw-product-pane .cw-measure-head { position: sticky; top: 0; z-index: 2; }
    .cw-product-pane .cw-measure-head,
    .cw-product-pane .cw-measure-row { grid-template-columns: minmax(130px,1.5fr) minmax(86px,.8fr) 64px 96px minmax(92px,1fr); gap: 6px; }
    .cw-product-pane .cw-measure-row { min-height: 48px; padding: 7px 8px; }
    .cw-product-pane .cw-measure-input { min-width: 0; }
    .cw-product-pane .cw-measure-row .cw-btn { padding: 5px 7px; }
    .cw-storefront-product { display: none; grid-template-columns: minmax(220px, 38%) minmax(0, 1fr); gap: 20px; margin: 4px 0 16px; padding: 14px; border: 1px solid #dbe4ee; border-radius: 8px; background: #fff; }
    .cw-storefront-product.visible { display: grid; }
    .cw-storefront-image-link { display: flex; align-items: center; justify-content: center; min-height: 220px; overflow: hidden; border-radius: 6px; background: #f7f8fa; }
    .cw-storefront-image-link img { display: block; width: 100%; height: 100%; max-height: 310px; object-fit: contain; }
    .cw-storefront-copy { min-width: 0; display: flex; flex-direction: column; justify-content: center; }
    .cw-storefront-eyebrow { color: #64748b; font-size: 10px; font-weight: 750; letter-spacing: .06em; text-transform: uppercase; }
    .cw-storefront-copy h4 { margin: 7px 0 5px; color: #0f172a; font-size: clamp(20px, 2.2vw, 30px); line-height: 1.12; }
    .cw-storefront-copy > a { width: fit-content; color: #2563eb; font-size: 12px; font-weight: 650; text-decoration: none; }
    .cw-storefront-copy > a:hover { text-decoration: underline; }
    .cw-storefront-links { display: flex; align-items: center; gap: 8px; }
    .cw-storefront-links > a { color: #2563eb; font-size: 12px; font-weight: 650; text-decoration: none; }
    .cw-storefront-links > a:hover { text-decoration: underline; }
    .cw-storefront-links .cw-btn { min-height: 32px; }
    .cw-overall-dimensions { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 22px; }
    .cw-dimension { width: 100%; min-width: 0; padding: 11px 12px; border: 1px solid #dbe4ee; border-radius: 6px; background: #f8fafc; text-align: left; }
    .cw-dimension-label { display: block; color: #64748b; font-size: 10px; font-weight: 750; letter-spacing: .05em; text-transform: uppercase; }
    .cw-dimension-value { display: block; margin-top: 3px; overflow: hidden; color: #0f172a; font-size: 20px; font-weight: 750; text-overflow: ellipsis; white-space: nowrap; }
    .cw-dimension.missing .cw-dimension-value { color: #94a3b8; font-weight: 550; }
    .cw-dimension.is-armed { border-color: #2563eb; background: #dbeafe; box-shadow: inset 3px 0 0 #2563eb; }
    .cw-dimension-action { display: block; margin-top: 5px; color: #2563eb; font-size: 10px; font-weight: 700; }
    .cw-product-photos { border: 1px solid #dbe4ee; border-radius: 8px; background: #fff; }
    .cw-product-photos > summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 12px; color: #334155; font-size: 12px; font-weight: 700; cursor: pointer; list-style: none; }
    .cw-product-photos > summary::-webkit-details-marker { display: none; }
    .cw-product-photos > summary::after { content: '+'; color: #64748b; font-size: 17px; font-weight: 500; }
    .cw-product-photos[open] > summary::after { content: '−'; }
    .cw-product-photos > summary span:last-child { margin-left: auto; color: #64748b; font-size: 11px; font-weight: 550; }
    .cw-photo-actions { display: flex; gap: 7px; padding: 0 12px 10px; }
    .cw-product-photos .cw-images { grid-template-columns: repeat(4, minmax(0, 1fr)); padding: 0 12px 12px; }
    .cw-product-advanced { margin-top: 12px; border-top: 1px solid #e2e8f0; padding-top: 8px; }
    .cw-product-advanced > summary { cursor: pointer; color: #64748b; font-size: 12px; font-weight: 650; user-select: none; }
    .cw-product-advanced-body { padding-top: 8px; }
    .cw-result-card { cursor: pointer; }
    .cw-result-card:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
    .cw-result-card.is-ready::after { content: 'Ready'; position: absolute; top: 9px; right: 9px; border-radius: 999px; padding: 3px 7px; background: #166534; color: #fff; font-size: 9px; font-weight: 750; letter-spacing: .04em; text-transform: uppercase; }
    .cw-result-card.is-ready .cw-result-top { padding-right: 48px; }
    .cw-result-check { display: none; }
    .cw-loaded-summary { display: none; }
    .cw-flow-steps, .cw-note, #cwBasketSection { display: none !important; }
    @media (max-width: 900px) {
      .cw-grid { grid-template-columns: 1fr; }
      .cw-discovery-grid { grid-template-columns: 1fr; }
      .cw-result-controls { grid-template-columns: repeat(2, minmax(0,1fr)); }
      .cw-result-action { grid-column: 1 / -1; }
      .cw-result-action .cw-btn { width: 100%; }
      .cw-product-pane .cw-measure-wrap { overflow: auto; }
      .cw-product-pane .cw-measure-head, .cw-product-pane .cw-measure-row { min-width: 700px; }
      .cw-images { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .cw-product-content { grid-template-columns: 1fr; }
      .cw-product-toolbar { align-items: flex-start; flex-direction: column; }
      .cw-product-actions { justify-content: flex-start; }
      .cw-storefront-product { grid-template-columns: 1fr; }
      .cw-storefront-image-link { min-height: 180px; }
      .cw-product-photos .cw-images { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .cw-comparison-items { grid-template-columns: repeat(2,minmax(0,1fr)); }
    }
    @media (max-width: 620px) {
      .cw-import-card { width: calc(100vw - 12px); height: calc(100dvh - 12px); max-height: calc(100dvh - 12px); }
      .cw-import-head { padding: 10px; }
      .cw-import-body { padding: 10px; }
      .cw-product-search-shell { top: -10px; margin-top: -2px; padding-top: 6px; }
      .cw-product-search-row { grid-template-columns: 1fr; }
      .cw-product-search-row .cw-btn { width: 100%; }
      .cw-result-controls { grid-template-columns: 1fr; }
      .cw-result-action { grid-column: auto; }
      .cw-storefront-product { padding: 10px; }
      .cw-overall-dimensions { grid-template-columns: 1fr; }
      .cw-comparison-toolbar { align-items: stretch; flex-direction: column; }
      .cw-comparison-toolbar .cw-btn { width: 100%; }
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
  const raw = (url || '').split('?')[0].split('#')[0].split('/').filter(Boolean).pop();
  return (raw || 'photo').trim() || 'photo';
}

function setMeasurementLock(scopeLabel: string, strokeLabel: string, locked: boolean): void {
  const w = window as any;
  if (!w.cwMeasurementLocksByImage) w.cwMeasurementLocksByImage = {};
  if (!w.cwMeasurementLocksByImage[scopeLabel]) w.cwMeasurementLocksByImage[scopeLabel] = {};
  w.cwMeasurementLocksByImage[scopeLabel][strokeLabel] = locked;
}

function normalizeGuideLabel(value: string): string {
  return (value || '').trim().toUpperCase().replace(/\s+/g, '');
}

export function resolveCwWorkspaceNextTag(options: {
  scopeKeys: string[];
  manualTags?: Record<string, string>;
  guideTags?: Record<string, string>;
  labelTags?: Record<string, string>;
  displayTag?: string;
  calculatedTag?: string;
}): string {
  const { scopeKeys, manualTags = {}, guideTags = {}, labelTags = {} } = options;
  for (const key of scopeKeys) {
    const authoritative =
      normalizeGuideLabel(manualTags[key] || '') ||
      normalizeGuideLabel(guideTags[key] || '') ||
      normalizeGuideLabel(labelTags[key] || '');
    if (authoritative) return authoritative;
  }
  return (
    normalizeGuideLabel(options.displayTag || '') ||
    normalizeGuideLabel(options.calculatedTag || '')
  );
}

export function resolveNextAvailableCwLabel(baseLabel: string, usedLabels: Set<string>): string {
  const normalized = normalizeGuideLabel(baseLabel);
  if (!normalized || !usedLabels.has(normalized)) return normalized;
  const root = normalized.replace(/\(\d+\)$/, '');
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${root}(${index})`;
    if (!usedLabels.has(candidate)) return candidate;
  }
  return normalized;
}

export function seedCwMeasurementEntry(
  store: Record<string, any>,
  targetLabel: string,
  payload: Record<string, any>
): boolean {
  const normalizedLabel = normalizeGuideLabel(targetLabel);
  if (!normalizedLabel || store[normalizedLabel]) return false;
  store[normalizedLabel] = payload;
  return true;
}

export function hasCwWorkspaceSeedChanged(options: {
  scopeKeys: string[];
  targetLabel: string;
  rowKey?: string;
  displayTag?: string;
  guideTags?: Record<string, string>;
  labelTags?: Record<string, string>;
  readyRows?: Record<string, string>;
}): boolean {
  const target = normalizeGuideLabel(options.targetLabel);
  if (!target) return false;
  if (normalizeGuideLabel(options.displayTag || '') !== target) return true;
  return options.scopeKeys.some(
    key =>
      normalizeGuideLabel(options.guideTags?.[key] || '') !== target ||
      normalizeGuideLabel(options.labelTags?.[key] || '') !== target ||
      Boolean(options.rowKey && options.readyRows?.[key] !== options.rowKey)
  );
}

function getCanonicalCwScopeKey(scopeLabel: string): string {
  const metadata = (window as any).app?.metadataManager;
  return typeof metadata?.normalizeImageLabel === 'function'
    ? String(metadata.normalizeImageLabel(scopeLabel) || scopeLabel).trim()
    : (scopeLabel || '').trim();
}

function buildLegacyCwScopeCandidates(scopeLabel: string): string[] {
  const canonical = getCanonicalCwScopeKey(scopeLabel);
  const base = canonical.split('::tab:')[0] || canonical;
  return Array.from(new Set([(scopeLabel || '').trim(), canonical, base].filter(Boolean)));
}

function getCwImportedMeasurementEntry(scopeLabel: string, strokeLabel: string): any {
  const w = window as any;
  const store =
    w.cwImportedMeasurementsByImage && typeof w.cwImportedMeasurementsByImage === 'object'
      ? w.cwImportedMeasurementsByImage
      : {};
  const normalizedLabel = normalizeGuideLabel(strokeLabel);
  if (!normalizedLabel) return null;
  const canonicalKey = getCanonicalCwScopeKey(scopeLabel);
  const exactStore = store[canonicalKey];
  if (exactStore && typeof exactStore === 'object') {
    const direct = exactStore[normalizedLabel];
    if (direct && typeof direct === 'object') {
      return {
        ...direct,
        bindingScopeKey: String(direct.bindingScopeKey || canonicalKey).trim() || canonicalKey,
      };
    }
  }
  for (const candidate of buildLegacyCwScopeCandidates(scopeLabel)) {
    const scopedStore = store[candidate];
    if (!scopedStore || typeof scopedStore !== 'object') continue;
    const direct = scopedStore[normalizedLabel];
    if (direct && typeof direct === 'object') {
      return {
        ...direct,
        bindingScopeKey: String(direct.bindingScopeKey || candidate).trim() || candidate,
      };
    }
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
  const canonicalKey = getCanonicalCwScopeKey(scopeLabel);
  const bindingScopeKey = String(payload?.bindingScopeKey || canonicalKey).trim() || canonicalKey;
  const nextPayload = {
    ...(payload && typeof payload === 'object' ? payload : {}),
    bindingScopeKey,
    pending: false,
    autoApplyOnDraw: false,
    updatedAt: new Date().toISOString(),
  };
  if (!w.cwImportedMeasurementsByImage[bindingScopeKey]) {
    w.cwImportedMeasurementsByImage[bindingScopeKey] = {};
  }
  w.cwImportedMeasurementsByImage[bindingScopeKey][normalizedLabel] = nextPayload;
}

function normalizeValueText(value: unknown): string {
  const str =
    typeof value === 'string'
      ? value
      : value === null || value === undefined
        ? ''
        : typeof value === 'number' || typeof value === 'boolean'
          ? String(value)
          : '';
  return str.replace(/\s+/g, ' ').trim();
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

export function filterCwWorkspaceRows<T extends { itemKey: string; sectionName?: string }>(
  rows: T[],
  scopeMeta?: { itemKey?: string; sectionName?: string } | null
): T[] {
  if (!scopeMeta) return rows;
  const itemKey = (scopeMeta.itemKey || '').trim();
  const sectionName = normalizeSectionName(scopeMeta.sectionName || '');
  const exact = rows.filter(row => {
    if (itemKey && row.itemKey !== itemKey) return false;
    if (sectionName && normalizeSectionName(row.sectionName || '') !== sectionName) return false;
    return true;
  });
  return exact.length ? exact : rows;
}

export function isCwOverallDimensionRow(
  row:
    | {
        sourceLabel?: string;
        sectionName?: string;
      }
    | null
    | undefined
): boolean {
  if (!row) return false;
  const section = normalizeSectionName(row.sectionName || '');
  if (section && section !== 'Frame Cover') return false;
  const label = normalizeValueText(row.sourceLabel || '')
    .toLowerCase()
    .replace(/^overall\s+/, '');
  return label === 'width' || label === 'length' || label === 'depth' || label === 'height';
}

export function resolveCwWorkspaceDrawRow<
  T extends { rowKey: string; targetLabel: string },
>(options: {
  rows: T[];
  armedRowKey?: string;
  readyRowKey?: string;
  strokeLabel: string;
}): T | null {
  const strokeLabel = normalizeGuideLabel(options.strokeLabel);
  const exactKey = options.armedRowKey || options.readyRowKey || '';
  if (exactKey) {
    const exact = options.rows.find(row => row.rowKey === exactKey) || null;
    return exact && normalizeGuideLabel(exact.targetLabel) === strokeLabel ? exact : null;
  }
  const matches = options.rows.filter(row => normalizeGuideLabel(row.targetLabel) === strokeLabel);
  return matches.length === 1 ? matches[0] : null;
}

export function findNextCwWorkspaceRow<T extends { rowKey: string; targetLabel: string }>(
  rows: T[],
  usedLabels: Set<string>,
  afterRowKey = ''
): T | null {
  const startIndex = afterRowKey ? rows.findIndex(row => row.rowKey === afterRowKey) + 1 : 0;
  const start = Math.max(0, startIndex);
  for (const row of rows.slice(start)) {
    const targetLabel = normalizeGuideLabel(row.targetLabel);
    if (!targetLabel || usedLabels.has(targetLabel)) continue;
    return row;
  }
  return null;
}

export function resolveCwWorkspaceQueueRow<T extends { rowKey: string; targetLabel: string }>(
  rows: T[],
  usedLabels: Set<string>,
  armedRowKey = ''
): { row: T; armed: boolean } | null {
  if (armedRowKey) {
    const armedRow = rows.find(row => row.rowKey === armedRowKey);
    if (armedRow) return { row: armedRow, armed: true };
  }
  const next = findNextCwWorkspaceRow(rows, usedLabels);
  return next ? { row: next, armed: false } : null;
}

export function resolveCwScopedArmedRowKey(
  armedRowsByScope: Record<string, string>,
  scopeKeys: string[]
): string {
  for (const key of scopeKeys) {
    const rowKey = armedRowsByScope[key];
    if (rowKey) return rowKey;
  }
  return '';
}

function classifyMeasurementSection(sourceLabel: string, sectionName: string): string {
  const normalizedSource = normalizeValueText(sourceLabel);
  const _sourceToken = normalizedSource.toLowerCase();
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
  if (normalizedSource === 'front arm width') return 'C1';
  if (normalizedSource === 'side width') return 'H1';
  if (normalizedSource === 'side height') return 'G1';
  if (normalizedSource === 'back width') return 'L1';

  if (normalizedSection === 'Seat Cushion Cover' || normalizedSection === 'Back Cushion Cover') {
    if (normalizedSource === 'width') return 'A';
    if (normalizedSource === 'width (top)') return 'A';
    if (normalizedSource === 'width (bottom)') return 'B';
    if (normalizedSource === 'height') return 'B';
    if (normalizedSource === 'height (middle)') return 'C';
    if (normalizedSource === 'height (right)') return 'D';
    if (normalizedSource === 'thickness') return 'D';
  }

  return '';
}

function decodeHtmlEntitiesLite(value: string): string {
  return (value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function extractAbsoluteImageUrlsFromString(value: string): string[] {
  const source = decodeHtmlEntitiesLite(value || '')
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
  const source = (nameOrPath || '').toLowerCase();
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
  return (value || '')
    .replace(/\b(?:undefined|null)\b/gi, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(?:^|-)undefined(?:-|$)/g, '-')
    .replace(/(?:^|-)null(?:-|$)/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test((value || '').trim());
}

function isSignedImageUrl(url: string): boolean {
  const v = url || '';
  return (
    /[?&]Signature=/i.test(v) &&
    (/[?&]GoogleAccessId=/i.test(v) || /[?&]X-Goog-Algorithm=/i.test(v))
  );
}

function shouldUseDirectImageUrl(url: string): boolean {
  const value = (url || '').trim();
  if (!value) return false;
  if (/^(?:data|blob):/i.test(value)) return true;
  if (isSignedImageUrl(value)) return true;
  return false;
}

function isKnownBadImageCandidate(url: string): boolean {
  const value = url || '';
  if (/storage\.cloud\.google\.com/i.test(value)) return true;
  if (/cw-pid-qylyewlgca-uc\.a\.run\.app\/slipcover_details_images/i.test(value)) return true;
  if (/cw-pid-qylyewlgca-uc\.a\.run\.app\/media\/slipcover_details_images/i.test(value))
    return true;
  if (/cw-pid-qylyewlgca-uc\.a\.run\.app\/uploads\/slipcover_details_images/i.test(value))
    return true;
  if (/comfort-works\.com\/media\/slipcover_details_images/i.test(value)) return true;
  if (/comfort-works\.com\/uploads\/slipcover_details_images/i.test(value)) return true;
  if (/cw40\.comfort-works\.com\/slipcover_details_images/i.test(value)) return true;
  return false;
}

function filterPreferredImageCandidates(urls: string[]): string[] {
  const unique = Array.from(new Set((urls || []).filter(Boolean)));
  const signed = unique.filter(isSignedImageUrl);
  if (signed.length) {
    return signed;
  }
  const storage = unique.filter(url => /https?:\/\/storage\.googleapis\.com\//i.test(url || ''));
  if (storage.length) {
    const rest = unique.filter(
      url =>
        !/https?:\/\/storage\.googleapis\.com\//i.test(url || '') && !isKnownBadImageCandidate(url)
    );
    return [...storage, ...rest];
  }
  const preferred = unique.filter(url => !isKnownBadImageCandidate(url));
  if (preferred.length) return preferred;
  // Keep known-bad candidates as last-resort fallbacks so image-proxy can still try.
  return unique;
}

function isLikelyImagePath(value: string): boolean {
  const v = (value || '').trim();
  if (!v) return false;
  if (/^https?:\/\//i.test(v)) {
    return /\.(?:png|jpe?g|webp|gif|bmp|svg)(?:\?|$)/i.test(v);
  }
  return /[/][^\s]+\.(?:png|jpe?g|webp|gif|bmp|svg)$/i.test(v);
}

function makeAbsoluteCandidates(pathOrUrl: string, baseUrl: string): string[] {
  const value = (pathOrUrl || '').trim();
  if (!value) return [];
  if (/^https?:\/\//i.test(value)) return [value];

  const normalizedPath = value.replace(/^\/+/, '');
  const bases = [
    (baseUrl || '').trim().replace(/\/+$/, ''),
    'https://cw-pid-qylyewlgca-uc.a.run.app',
  ].filter(Boolean);

  const urls = new Set<string>();
  if (/^slipcover_details_images\//i.test(normalizedPath)) {
    urls.add(`https://storage.googleapis.com/pid-storage/${normalizedPath}`);
  }
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
    const path = (rawPath || '').trim();
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
    const toStr = (v: unknown): string => {
      if (typeof v === 'string') return v;
      if (typeof v === 'number' || typeof v === 'boolean') return String(v);
      return '';
    };
    const derivedSection =
      normalizeSectionName(String(obj?.translations && (obj.translations as any)?.en)) ||
      normalizeSectionName(toStr(obj?.component_name) || toStr(obj?.name) || sectionHint);

    const sectionFromPath = sectionFromImageName(
      toStr(obj?.file_path) || toStr(obj?.name) || toStr(obj?.url)
    );
    const sectionName = normalizeSectionName(
      sectionFromPath || derivedSection || sectionHint || 'General'
    );

    const filePath = toStr(obj?.file_path).trim();
    const url = toStr(obj?.url).trim();
    const name = toStr(obj?.name).trim();
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
  const clean = (url || '').split('?')[0].split('#')[0];
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
  if (Array.isArray(measurements)) {
    measurements.forEach((measurement, index) => {
      if (!measurement || typeof measurement !== 'object') return;
      const sourceLabel = normalizeValueText(
        measurement?.translations?.en ||
          measurement?.label ||
          measurement?.name ||
          measurement?.code
      );
      const normalizedValue = toPrimitiveMeasurementValue(
        measurement?.value ?? measurement?.measurement ?? measurement?.actual ?? measurement?.result
      );
      if (!isLikelyMeasurementLabel(sourceLabel) || !normalizedValue) return;
      out.push({
        id: `qc-component-${out.length + 1}-${index}`,
        sourceLabel,
        value: normalizedValue,
        sectionName: sectionFromNode || 'Frame Cover',
      });
    });
  } else if (measurements && typeof measurements === 'object') {
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
  const raw = (url || '').split('?')[0].split('#')[0].split('/').pop();
  const stem = (raw || fallbackPrefix)
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/\b(?:undefined|null)\b/gi, ' ');
  const slug = slugify(stem);
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

export function extractRows(payload: any): ImportedRow[] {
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

function createModal(): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'cw-import-overlay';
  overlay.id = MODAL_ID;

  const card = document.createElement('div');
  card.className = 'cw-import-card';

  const head = document.createElement('div');
  head.className = 'cw-import-head';
  head.innerHTML = '<h3>Comfort Works Product</h3>';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'cw-import-close';
  closeBtn.textContent = 'Close';

  const body = document.createElement('div');
  body.className = 'cw-import-body';
  body.innerHTML = `
    <form class="cw-import-form" novalidate>
    <div class="cw-product-search-shell">
      <label class="cw-product-search-label" for="cwSearchTerm">Find a sofa <span>Name, product code, or PID</span></label>
      <div class="cw-product-search-row">
        <input id="cwSearchTerm" type="search" placeholder="e.g. IK-KL-3, Harmony chaise, PID 12345" autocomplete="off" />
        <button type="button" class="cw-btn cw-btn-primary" id="cwSearchBtn">Find product</button>
      </div>
      <div class="cw-load-progress" id="cwLoadProgress" role="status" aria-live="polite">
        <div class="cw-load-progress-copy"><strong id="cwLoadProgressLabel">Finding product</strong><span id="cwLoadProgressDetail">Starting...</span></div>
        <div class="cw-load-progress-track"><div class="cw-load-progress-bar" id="cwLoadProgressBar"></div></div>
      </div>
      <div class="cw-result-meta" id="cwResultMeta">Search for the exact product. Its photos and complete measurements will load here.</div>
      <details class="cw-comparison-builder" id="cwComparisonBuilder">
        <summary>Compare catalogue products</summary>
        <div class="cw-comparison-body">
          <p class="cw-comparison-copy">Paste up to eight product codes, product links, order lines, or fabric samples. Each item keeps its own side, model, style, and fabric options.</p>
          <textarea id="cwComparisonInput" class="cw-comparison-input" placeholder="IK-KS-0&#10;Code: LV, SHRT_SP, COS-105&#10;IK-KS-2M Kramfors 2 Seater 1 Armrest Sofa Cover&#10;Code: R, LV, LSKT_PM, COS-105"></textarea>
          <div class="cw-comparison-toolbar">
            <input id="cwComparisonFabric" class="cw-comparison-fabric" type="text" autocomplete="off" spellcheck="false" placeholder="Shared fabric name or code" aria-label="Shared fabric name or code" />
            <span class="cw-comparison-status" id="cwComparisonStatus">Nothing loaded yet.</span>
            <button type="button" class="cw-btn" id="cwBuildComparisonBtn">Load comparison</button>
            <button type="button" class="cw-btn cw-btn-primary" id="cwImportComparisonBtn" hidden>Add to SofaPaint</button>
          </div>
          <div class="cw-comparison-items" id="cwComparisonItems"></div>
        </div>
      </details>
    </div>
    <div class="cw-product-results-shell is-empty" id="cwProductResultsShell">
      <div class="cw-section-label"><span>Choose product</span><span id="cwResultsMeta"></span></div>
      <div class="cw-discovery-grid" id="cwSearchResults"></div>
    </div>
    <div class="cw-section-collapsible" id="cwBasketSection" style="display:none">
      <div class="cw-basket-wrap" id="cwBasket"></div>
    </div>
    <div class="cw-product-workspace" id="cwProductWorkspace">
      <div class="cw-product-toolbar">
        <div class="cw-product-toolbar-copy">
          <div class="cw-product-toolbar-title" id="cwSelectedProductTitle">Selected product</div>
          <div class="cw-product-toolbar-meta" id="cwLoadedMeta"></div>
        </div>
        <div class="cw-product-actions">
          <select id="cwItemFilter" class="cw-section-select cw-internal-control" aria-label="Loaded product"><option value="">All Items</option></select>
          <select id="cwSectionFilter" class="cw-section-select cw-internal-control" aria-label="Product section"><option value="">All Sections</option></select>
          <button type="button" class="cw-btn cw-btn-primary" id="cwUseMeasurementsBtn">Use measurements</button>
          <button type="button" class="cw-btn cw-icon-action" id="cwClearBasketBtn" title="Choose another product" aria-label="Choose another product">Change</button>
        </div>
      </div>
      <div class="cw-section-collapsible" id="cwLoadedSection"><div class="cw-loaded-summary" id="cwLoadedItems"></div></div>
      <section class="cw-storefront-product" id="cwStorefrontProduct" aria-label="Comfort Works product">
        <a id="cwStorefrontProductLink" target="_blank" rel="noopener noreferrer" class="cw-storefront-image-link">
          <img id="cwStorefrontProductImage" alt="" />
        </a>
        <div class="cw-storefront-copy">
          <div class="cw-storefront-eyebrow">Comfort Works product</div>
          <h4 id="cwStorefrontProductName"></h4>
          <div class="cw-storefront-links">
            <a id="cwStorefrontProductTextLink" target="_blank" rel="noopener noreferrer">View product</a>
            <button type="button" class="cw-btn" id="cwOpen3dBtn">Model in 3D</button><button type="button" class="cw-btn cw-btn-primary" id="cwImportStorefrontImageBtn">Add image + draw dimensions</button>
          </div>
          <div class="cw-overall-dimensions" id="cwOverallDimensions" aria-label="Overall dimensions"></div>
        </div>
      </section>
      <div class="cw-product-content">
        <section class="cw-product-pane" aria-label="Product measurements">
          <div class="cw-section-label"><span>Measurements</span><span>Click one to draw</span></div>
          <div class="cw-measure-wrap">
            <div class="cw-measure-head"><div>Measurement</div><div>Section</div><div>Value</div><div>Label</div><div>Action</div></div>
            <div id="cwRows"></div>
          </div>
        </section>
        <details class="cw-product-photos" id="cwProductPhotos">
          <summary><span>Photos</span><span id="cwPhotoCount">0 available</span></summary>
          <div class="cw-photo-actions">
            <button type="button" class="cw-btn" id="cwSelectVisibleImagesBtn">Select all</button>
            <button type="button" class="cw-btn" id="cwClearVisibleImagesBtn">Clear</button>
            <button type="button" class="cw-btn cw-btn-primary" id="cwImportPhotosBtn">Add selected photos</button>
          </div>
          <div class="cw-images" id="cwResultImages"></div>
        </details>
      </div>
    </div>
    <details id="cwLoginDetails" class="cw-product-advanced">
      <summary>Advanced connection and diagnostics</summary>
      <div class="cw-product-advanced-body">
      <div class="cw-grid">
        <div><label for="cwBaseUrl">CW Base URL</label><input id="cwBaseUrl" value="https://cw40.comfort-works.com" /></div>
        <div><label for="cwFormId">Form ID (optional)</label><input id="cwFormId" /></div>
        <div><label for="cwUsername">CW Username</label><input id="cwUsername" autocomplete="off" /></div>
        <div><label for="cwPassword">CW Password</label><input id="cwPassword" type="password" autocomplete="current-password" /></div>
        <div class="cw-grid-full" id="cwRenderedHtmlWrap" style="display:none;"><label for="cwRenderedHtml">Rendered PID HTML</label><textarea id="cwRenderedHtml" class="cw-rendered-html"></textarea></div>
      </div>
      <div class="cw-row">
        <button type="button" class="cw-btn" id="cwLoadSelectedBtn">Reload selected product</button>
        <button type="button" class="cw-btn" id="cwImportExactBtn">Apply to matching labels</button>
        <label><input type="checkbox" id="cwImportLocked" /> Lock imported values</label>
      </div>
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
      </div>
    </details>
    <div class="cw-flow-steps" id="cwFlowSteps"><span class="cw-flow-step" id="cwStep1"></span><span class="cw-flow-step" id="cwStep2"></span><span class="cw-flow-step" id="cwStep3"></span></div>
    </form>
  `;

  const searchBtn = body.querySelector<HTMLButtonElement>('#cwSearchBtn')!;
  const importForm = body.querySelector('.cw-import-form') as HTMLFormElement | null;
  const addSelectedBtn = body.querySelector<HTMLButtonElement>('#cwAddSelectedBtn');
  const loadSelectedBtn = body.querySelector<HTMLButtonElement>('#cwLoadSelectedBtn')!;
  const baseUrlEl = body.querySelector<HTMLInputElement>('#cwBaseUrl')!;
  const formIdEl = body.querySelector<HTMLInputElement>('#cwFormId')!;
  const usernameEl = body.querySelector<HTMLInputElement>('#cwUsername')!;
  const passwordEl = body.querySelector<HTMLInputElement>('#cwPassword')!;
  const searchTermEl = body.querySelector<HTMLInputElement>('#cwSearchTerm')!;
  const comparisonInput = body.querySelector<HTMLTextAreaElement>('#cwComparisonInput')!;
  const comparisonFabric = body.querySelector<HTMLInputElement>('#cwComparisonFabric')!;
  const buildComparisonBtn = body.querySelector<HTMLButtonElement>('#cwBuildComparisonBtn')!;
  const importComparisonBtn = body.querySelector<HTMLButtonElement>('#cwImportComparisonBtn')!;
  const comparisonStatus = body.querySelector<HTMLElement>('#cwComparisonStatus')!;
  const comparisonItems = body.querySelector<HTMLDivElement>('#cwComparisonItems')!;
  const renderedHtmlEl = body.querySelector<HTMLTextAreaElement>('#cwRenderedHtml')!;
  const importExactBtn = body.querySelector<HTMLButtonElement>('#cwImportExactBtn')!;
  const importPhotosBtn = body.querySelector<HTMLButtonElement>('#cwImportPhotosBtn')!;
  const itemFilterEl = body.querySelector<HTMLSelectElement>('#cwItemFilter')!;
  const sectionFilterEl = body.querySelector<HTMLSelectElement>('#cwSectionFilter')!;
  const selectVisibleImagesBtn = body.querySelector<HTMLButtonElement>(
    '#cwSelectVisibleImagesBtn'
  )!;
  const clearVisibleImagesBtn = body.querySelector<HTMLButtonElement>('#cwClearVisibleImagesBtn')!;
  const useMeasurementsBtn = body.querySelector<HTMLButtonElement>('#cwUseMeasurementsBtn')!;
  const productResultsShell = body.querySelector<HTMLDivElement>('#cwProductResultsShell')!;
  const productWorkspace = body.querySelector<HTMLDivElement>('#cwProductWorkspace')!;
  const selectedProductTitle = body.querySelector<HTMLDivElement>('#cwSelectedProductTitle')!;
  const storefrontProduct = body.querySelector<HTMLElement>('#cwStorefrontProduct')!;
  const storefrontProductImage = body.querySelector<HTMLImageElement>('#cwStorefrontProductImage')!;
  const storefrontProductLink = body.querySelector<HTMLAnchorElement>('#cwStorefrontProductLink')!;
  const storefrontProductTextLink = body.querySelector<HTMLAnchorElement>(
    '#cwStorefrontProductTextLink'
  )!;
  const storefrontProductName = body.querySelector<HTMLElement>('#cwStorefrontProductName')!;
  const importStorefrontImageBtn = body.querySelector<HTMLButtonElement>(
    '#cwImportStorefrontImageBtn'
  )!;
  const overallDimensions = body.querySelector<HTMLDivElement>('#cwOverallDimensions')!;
  const photoCount = body.querySelector<HTMLSpanElement>('#cwPhotoCount')!;
  const productPhotos = body.querySelector<HTMLDetailsElement>('#cwProductPhotos')!;
  const searchResultsWrap = body.querySelector<HTMLDivElement>('#cwSearchResults')!;
  const basketWrap = body.querySelector<HTMLDivElement>('#cwBasket')!;
  const loadedItemsWrap = body.querySelector<HTMLDivElement>('#cwLoadedItems')!;
  const resultsMeta = body.querySelector<HTMLSpanElement>('#cwResultsMeta')!;
  const basketMeta = body.querySelector<HTMLSpanElement>('#cwBasketMeta');
  const loadedMeta = body.querySelector<HTMLSpanElement>('#cwLoadedMeta')!;
  const _basketSection = body.querySelector<HTMLDivElement>('#cwBasketSection')!;
  const loadedSection = body.querySelector<HTMLDivElement>('#cwLoadedSection')!;
  const flowSteps = [
    body.querySelector<HTMLSpanElement>('#cwStep1')!,
    body.querySelector<HTMLSpanElement>('#cwStep2')!,
    body.querySelector<HTMLSpanElement>('#cwStep3')!,
  ].filter(Boolean);
  const rowsContainer = body.querySelector<HTMLDivElement>('#cwRows')!;
  const resultMeta = body.querySelector<HTMLDivElement>('#cwResultMeta')!;
  const loadProgress = body.querySelector<HTMLDivElement>('#cwLoadProgress')!;
  const loadProgressLabel = body.querySelector<HTMLElement>('#cwLoadProgressLabel')!;
  const loadProgressDetail = body.querySelector<HTMLElement>('#cwLoadProgressDetail')!;
  const loadProgressBar = body.querySelector<HTMLDivElement>('#cwLoadProgressBar')!;
  const imagesWrap = body.querySelector<HTMLDivElement>('#cwResultImages')!;
  const lockedEl = body.querySelector<HTMLInputElement>('#cwImportLocked')!;
  const probePanel = body.querySelector<HTMLDivElement>('#cwProbePanel')!;
  const probeEnabledEl = body.querySelector<HTMLInputElement>('#cwProbeEnabled')!;
  const runProbeBtn = body.querySelector<HTMLButtonElement>('#cwRunProbeBtn')!;
  const runBulkProbeBtn = body.querySelector<HTMLButtonElement>('#cwRunBulkProbeBtn')!;
  const runStagedProbeBtn = body.querySelector<HTMLButtonElement>('#cwRunStagedProbeBtn')!;
  const runTurboStagedProbeBtn = body.querySelector<HTMLButtonElement>(
    '#cwRunTurboStagedProbeBtn'
  )!;
  const copyProbeBtn = body.querySelector<HTMLButtonElement>('#cwCopyProbeBtn')!;
  const loadProbeTermsBtn = body.querySelector<HTMLButtonElement>('#cwLoadProbeTermsBtn')!;
  const probeTermsFileEl = body.querySelector<HTMLInputElement>('#cwProbeTermsFile')!;
  const probeTermsPathEl = body.querySelector<HTMLInputElement>('#cwProbeTermsPath')!;
  const probeTermsEl = body.querySelector<HTMLTextAreaElement>('#cwProbeTerms')!;
  const probeSummary = body.querySelector<HTMLDivElement>('#cwProbeSummary')!;
  const probeOutput = body.querySelector<HTMLPreElement>('#cwProbeOutput')!;
  const probeModeAvailable = isCwProbePreviewEnabled();
  let lastProbeReport: Record<string, unknown> | null = null;
  const requestPayloadCache = new Map<
    string,
    { at: number; status: number; contentType: string; rawText: string; data: any }
  >();

  const setLoadProgress = (
    percent: number,
    label: string,
    detail = '',
    options: { complete?: boolean; hidden?: boolean } = {}
  ) => {
    loadProgress.classList.toggle('visible', !options.hidden);
    loadProgress.classList.toggle('complete', options.complete === true);
    loadProgressLabel.textContent = label;
    loadProgressDetail.textContent = detail;
    loadProgressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  };

  const makeRequestCacheKey = (payload: Record<string, unknown>): string => {
    const cachePayload = { ...payload, password: '', renderedHtml: '' };
    let hash = 2166136261;
    const source = JSON.stringify(cachePayload);
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `${CW_REQUEST_CACHE_PREFIX}${(hash >>> 0).toString(36)}`;
  };

  const readCachedRequest = (key: string) => {
    const memoryValue = requestPayloadCache.get(key);
    if (memoryValue && Date.now() - memoryValue.at < CW_REQUEST_CACHE_TTL_MS) {
      return memoryValue;
    }
    try {
      const raw = window.sessionStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.at || Date.now() - Number(parsed.at) >= CW_REQUEST_CACHE_TTL_MS) {
        window.sessionStorage.removeItem(key);
        return null;
      }
      requestPayloadCache.set(key, parsed);
      return parsed;
    } catch {
      return null;
    }
  };

  const writeCachedRequest = (
    key: string,
    value: { at: number; status: number; contentType: string; rawText: string; data: any }
  ) => {
    requestPayloadCache.set(key, value);
    if (value.rawText.length > 1_500_000) return;
    try {
      window.sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // The in-memory cache remains available when session storage is full.
    }
  };

  importForm?.addEventListener('submit', event => {
    event.preventDefault();
  });

  const persistUiState = () => {
    writePersistedCwUiState({
      baseUrl: (baseUrlEl?.value || '').trim(),
      formId: (formIdEl?.value || '').trim(),
      username: (usernameEl?.value || '').trim(),
      searchTerm: (searchTermEl?.value || '').trim(),
      probeTerms: probeTermsEl?.value || '',
      probeTermsPath: (probeTermsPathEl?.value || '').trim(),
      probeEnabled: probeEnabledEl?.checked ?? false,
      lastProbeReport,
    });
  };

  const persisted = readPersistedCwUiState();
  if (persisted.baseUrl && baseUrlEl) baseUrlEl.value = persisted.baseUrl;
  if (persisted.formId && formIdEl) formIdEl.value = persisted.formId;
  if (persisted.username && usernameEl) usernameEl.value = persisted.username;
  if (passwordEl) passwordEl.value = readSessionCwPassword();
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
  // Auto-collapse login settings when username is already saved
  const loginDetails = body.querySelector<HTMLDetailsElement>('#cwLoginDetails');
  if (loginDetails && persisted.username) {
    loginDetails.open = false;
  }

  [baseUrlEl, formIdEl, usernameEl, passwordEl, searchTermEl, probeTermsPathEl].forEach(el => {
    el?.addEventListener('input', persistUiState);
    el?.addEventListener('change', persistUiState);
  });
  passwordEl?.addEventListener('input', () => writeSessionCwPassword(passwordEl.value));
  passwordEl?.addEventListener('change', () => writeSessionCwPassword(passwordEl.value));
  probeTermsEl?.addEventListener('input', persistUiState);
  probeTermsEl?.addEventListener('change', persistUiState);

  if (probePanel) {
    probePanel.style.display = probeModeAvailable ? 'block' : 'none';
  }

  let state: SearchState = {
    searchResults: [],
    basket: [],
    loadedItems: [],
    activeItemKey: '',
    activeSection: '',
    armedRowKey: '',
    armedRowKeyByScope: {},
    readyRowKeyByScope: {},
    readyLabelByScope: {},
    activeDrawIntentByScope: {},
    completedLabelsByScope: {},
    completedRowKeysByScope: {},
    selectedImageKeys: [],
    rowTargetLabels: {},
    rowOriginalValues: {},
    rowValueOverrides: {},
    rowValueInvalid: {},
    discoveryImageUrls: [],
    storefrontProduct: null,
    comparisonItems: [],
    importedViewMetaByScope: {},
  };

  const getOriginalRowValue = (row: VisibleImportedRow | ImportedRow): string => {
    const rowKey = 'rowKey' in row ? row.rowKey : '';
    if (!rowKey) return String(row.value || '').trim();
    if (!(rowKey in state.rowOriginalValues)) {
      state.rowOriginalValues[rowKey] = String(row.value || '').trim();
    }
    return state.rowOriginalValues[rowKey];
  };

  const getEffectiveRowValue = (row: VisibleImportedRow | ImportedRow): string => {
    const rowKey = 'rowKey' in row ? row.rowKey : '';
    return (rowKey && state.rowValueOverrides[rowKey]) || getOriginalRowValue(row);
  };

  const updateFlowSteps = () => {
    const hasResults = state.searchResults.length > 0;
    const hasLoaded = state.loadedItems.length > 0;
    const hasImages = allImageEntries().length > 0;

    flowSteps.forEach(el => {
      el.className = 'cw-flow-step';
    });

    if (hasImages || hasLoaded) {
      flowSteps[0]?.classList.add('is-done');
      flowSteps[1]?.classList.add('is-done');
      flowSteps[2]?.classList.add('is-active');
    } else if (hasResults) {
      flowSteps[0]?.classList.add('is-done');
      flowSteps[1]?.classList.add('is-active');
    } else {
      flowSteps[0]?.classList.add('is-active');
    }

    // Toggle collapsible sections
    loadedSection.classList.toggle('has-content', hasLoaded || hasImages);
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
    options: {
      probeMode?: 'turbo' | 'default';
      phase?:
        | 'discover'
        | 'load-selected'
        | 'load-selected-details'
        | 'public-measurements'
        | 'storefront-product'
        | 'storefront-comparison';
      selectedItems?: BasketItem[];
      productReference?: string;
      comparisonItems?: CatalogueComparisonRequestItem[];
    } = {}
  ): Promise<{
    response: Response;
    data: any;
    rawText: string;
    contentType: string;
    jsonParseError: string | null;
    cached: boolean;
  }> => {
    const baseUrl = (baseUrlEl?.value || '').trim();
    const formId = (formIdEl?.value || '').trim();
    const username = (usernameEl?.value || '').trim();
    const password = passwordEl?.value || '';
    const renderedHtml = renderedHtmlEl?.value || '';
    const activeStyleKey = (activeStyleKeyOverride || '').trim();
    const activeStyle = parseStyleKey(activeStyleKey);

    const requestPayload = {
      baseUrl,
      formId,
      username,
      password,
      search: searchTerm,
      renderedHtml,
      productReference: options.productReference || activeStyle.productReference,
      style: activeStyle.style,
      styleCode: activeStyle.styleCode,
      phase: options.phase || undefined,
      selectedItems: Array.isArray(options.selectedItems)
        ? options.selectedItems.map(item => ({
            selectionKey: item.selectionKey,
            productId: item.productId,
            search: item.search,
            productReference: item.productReference,
            productName: item.productName,
            scopedReference: item.scopedReference,
            versionCode: item.versionCode,
            versionLabel: item.versionLabel,
            style: item.style,
            styleCode: item.styleCode,
            styleOptions: item.styleOptions,
            versionOptions: item.versionOptions,
            derivedScopedReferences: item.derivedScopedReferences,
          }))
        : undefined,
      comparisonItems: Array.isArray(options.comparisonItems)
        ? options.comparisonItems.map(item => ({
            kind: item.kind || 'product',
            productReference: item.productReference,
            title: item.title,
            url: item.url,
            handle: item.handle,
            codes: item.codes,
            fabricCode: item.fabricCode,
            styleName: item.styleName,
            fabricName: item.fabricName,
          }))
        : undefined,
      probeMode: options.probeMode === 'turbo' ? 'turbo' : 'default',
    };
    const canCache = Boolean(options.phase) && !renderedHtml.trim();
    const cacheKey = canCache ? makeRequestCacheKey(requestPayload) : '';
    const cachedValue = cacheKey ? readCachedRequest(cacheKey) : null;
    if (cachedValue) {
      return {
        response: new Response(cachedValue.rawText, {
          status: cachedValue.status,
          headers: { 'Content-Type': cachedValue.contentType },
        }),
        data: cachedValue.data,
        rawText: cachedValue.rawText,
        contentType: cachedValue.contentType,
        jsonParseError: null,
        cached: true,
      };
    }

    const transientStatuses = new Set([429, 502, 503, 504]);
    let response: Response | null = null;
    let requestError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        response = await fetch('/api/integrations/cw/measurements/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestPayload),
        });
        if (!transientStatuses.has(response.status) || attempt === 1) break;
      } catch (error) {
        requestError = error;
        if (attempt === 1) throw error;
      }
      await new Promise(resolve => window.setTimeout(resolve, 450));
    }
    if (!response) {
      throw requestError instanceof Error
        ? requestError
        : new Error('Comfort Works product request failed');
    }
    const rawText = await response.text().catch(() => '');
    const contentType = response.headers.get('content-type') || '';
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
    const applicationSucceeded =
      data?.success !== false &&
      !(Array.isArray(data?.items) && data.items.some((item: any) => item?.success === false));
    if (cacheKey && response.ok && !jsonParseError && applicationSucceeded) {
      writeCachedRequest(cacheKey, {
        at: Date.now(),
        status: response.status,
        contentType,
        rawText,
        data,
      });
    }
    return { response, data, rawText, contentType, jsonParseError, cached: false };
  };

  const loadStorefrontProduct = async (search: string, productReference = '') => {
    try {
      const storefrontSearch = /^[A-Z0-9][A-Z0-9._-]*(?:__[A-Z0-9._-]+)+$/i.test(search)
        ? search.replace(/__[^_]+(?:__.*)?$/i, '')
        : search;
      const { response, data } = await requestSearchPayload(storefrontSearch, '', {
        phase: 'storefront-product',
        productReference: productReference || search,
      });
      if (!response.ok || !data?.product) return;
      const existingProduct = state.storefrontProduct;
      state.storefrontProduct = {
        title: String(data.product.title || '').trim(),
        url: String(data.product.url || '').trim(),
        imageUrl: String(data.product.imageUrl || '').trim(),
        imageUrls: Array.from(
          new Set(
            [
              data.product.imageUrl,
              ...(Array.isArray(data.product.imageUrls) ? data.product.imageUrls : []),
            ]
              .map(value => String(value || '').trim())
              .filter(Boolean)
          )
        ),
        // The independent public-dimensions request is usually faster. A later
        // photo response must enrich that result, not erase it.
        dimensions: data.product.dimensions || existingProduct?.dimensions || null,
        measurementReference:
          String(data.product.measurementReference || '').trim() ||
          existingProduct?.measurementReference ||
          '',
        measurementStyle:
          String(data.product.measurementStyle || '').trim() ||
          existingProduct?.measurementStyle ||
          '',
        measurementStyleCode:
          String(data.product.measurementStyleCode || '').trim() ||
          existingProduct?.measurementStyleCode ||
          '',
      };
      const storefrontOwnerKey =
        activeLoadedItems()[0]?.selectionKey ||
        `storefront:${state.storefrontProduct.measurementReference || slugify(state.storefrontProduct.title)}`;
      const selectedKeys = new Set(state.selectedImageKeys);
      (state.storefrontProduct.imageUrls || []).forEach(url => {
        const key = imageKeyFromUrl(url);
        if (key) selectedKeys.add(`${storefrontOwnerKey}::${key}`);
      });
      state.selectedImageKeys = Array.from(selectedKeys);
      renderProductOverview();
      renderSectionFilter();
      renderImages();
    } catch (error) {
      console.warn('[CW Import] Storefront product preview unavailable', error);
    }
  };

  const normalizeComparisonResponseItem = (item: any): CatalogueComparisonItem => ({
    kind: item.kind === 'fabric-sample' ? 'fabric-sample' : 'product',
    productReference: String(item.productReference || '').trim(),
    title: String(item.title || '').trim(),
    url: String(item.url || '').trim(),
    handle: String(item.handle || '').trim(),
    codes: Array.isArray(item.codes) ? item.codes.map(String) : [],
    fabricCode: String(item.fabricCode || '').trim(),
    styleName: String(item.styleName || '').trim(),
    fabricName: String(item.fabricName || '').trim(),
    imageUrl: String(item.imageUrl || '').trim(),
    productUrl: String(item.productUrl || '').trim(),
    requestedSku: String(item.requestedSku || '').trim(),
    matchedSku: String(item.matchedSku || '').trim(),
    imageMatch: item.imageMatch || 'unavailable',
    note: String(item.note || '').trim(),
    dimensions: item.dimensions || null,
    measurementReference: String(item.measurementReference || '').trim(),
    measurementStyle: String(item.measurementStyle || '').trim(),
    measurementStyleCode: String(item.measurementStyleCode || '').trim(),
    configurationGroups: Array.isArray(item.configurationGroups)
      ? item.configurationGroups
          .map((group: any) => ({
            key: String(group?.key || '').trim(),
            label: String(group?.label || 'Option').trim(),
            codeIndex: Number(group?.codeIndex),
            options: Array.isArray(group?.options)
              ? group.options
                  .map((option: any) => ({
                    code: String(option?.code || '').trim(),
                    label: String(option?.label || option?.code || '').trim(),
                  }))
                  .filter((option: { code: string }) => option.code)
              : [],
          }))
          .filter(
            (group: { codeIndex: number; options: unknown[] }) =>
              Number.isInteger(group.codeIndex) && group.codeIndex >= 0 && group.options.length > 1
          )
      : [],
  });

  const renderComparisonItems = () => {
    const comparisonCodeLabels: Record<string, string> = {
      L: 'Left Arm',
      R: 'Right Arm',
      L1: 'Left Inward Chaise',
      L2: 'Left Outward Chaise',
      R1: 'Right Inward Chaise',
      R2: 'Right Outward Chaise',
      LV: 'The leather version',
      SV: 'The standard version',
      LSKT_PM: 'Signature',
      LSKT_SI: 'Signature',
      SHRT_SP: 'Original',
      VELC_SP: 'Original',
    };
    comparisonItems.innerHTML = '';
    state.comparisonItems.forEach((item, itemIndex) => {
      const card = document.createElement('article');
      card.className = 'cw-comparison-item';
      const imageWrap = document.createElement('a');
      imageWrap.className = 'cw-comparison-item-image';
      imageWrap.href = item.productUrl || item.url || '#';
      imageWrap.target = '_blank';
      imageWrap.rel = 'noopener noreferrer';
      if (item.imageUrl) {
        const image = document.createElement('img');
        image.src = item.imageUrl;
        image.alt = `${item.title || item.productReference} catalogue photo`;
        imageWrap.appendChild(image);
      } else {
        imageWrap.textContent = 'No photo';
      }
      const copy = document.createElement('div');
      copy.className = 'cw-comparison-item-copy';
      const title = document.createElement('div');
      title.className = 'cw-comparison-item-title';
      title.textContent =
        item.kind === 'fabric-sample'
          ? item.title || item.fabricName || item.fabricCode || 'Fabric Sample'
          : `${item.productReference}${item.title ? ` · ${item.title}` : ''}`;
      title.title = title.textContent;
      const config = document.createElement('div');
      config.className = 'cw-comparison-item-config';
      const structuralCodes = item.fabricCode
        ? item.codes.filter(code => code.toUpperCase() !== item.fabricCode.toUpperCase())
        : item.codes;
      const readableConfiguration = [
        item.styleName,
        ...structuralCodes.map(code => comparisonCodeLabels[code.toUpperCase()] || code),
        item.fabricName || item.fabricCode,
      ].filter(
        (value, index, values): value is string =>
          Boolean(value) &&
          values.findIndex(candidate => candidate?.toLowerCase() === value?.toLowerCase()) === index
      );
      config.textContent = readableConfiguration.join(' · ') || 'Default configuration';
      config.title = item.requestedSku || config.textContent;
      const note = document.createElement('div');
      note.className = `cw-comparison-item-note ${item.imageMatch === 'exact' ? 'exact' : 'fallback'}`;
      note.textContent = item.note;
      const optionGroups = document.createElement('div');
      optionGroups.className = 'cw-comparison-item-options';
      (item.configurationGroups || []).forEach(group => {
        const field = document.createElement('label');
        field.className = 'cw-comparison-item-option';
        const label = document.createElement('span');
        label.textContent = group.label;
        const select = document.createElement('select');
        select.dataset.cwComparisonOption = String(itemIndex);
        select.dataset.cwComparisonCodeIndex = String(group.codeIndex);
        select.setAttribute('aria-label', `${group.label} for ${item.productReference}`);
        group.options.forEach(option => {
          const optionEl = document.createElement('option');
          optionEl.value = option.code;
          optionEl.textContent = option.label;
          optionEl.selected =
            option.code.toUpperCase() === String(item.codes[group.codeIndex] || '').toUpperCase();
          select.appendChild(optionEl);
        });
        field.append(label, select);
        optionGroups.appendChild(field);
      });
      const drawButton = document.createElement('button');
      drawButton.type = 'button';
      drawButton.className = 'cw-btn cw-comparison-item-action';
      drawButton.dataset.cwComparisonDraw = String(itemIndex);
      const dimensionCount = ['width', 'depth', 'height'].filter(key =>
        toPrimitiveMeasurementValue(
          item.dimensions?.[key as keyof NonNullable<CatalogueComparisonItem['dimensions']>]
        )
      ).length;
      drawButton.textContent =
        item.kind === 'fabric-sample'
          ? 'Add sample'
          : dimensionCount
            ? `Add + draw ${dimensionCount} dimensions`
            : 'Add image';
      drawButton.disabled = !item.imageUrl;
      copy.append(title, config, note);
      if (optionGroups.childElementCount) copy.appendChild(optionGroups);
      copy.appendChild(drawButton);
      card.append(imageWrap, copy);
      comparisonItems.appendChild(card);
    });
    const available = state.comparisonItems.filter(item => item.imageUrl).length;
    importComparisonBtn.hidden = available < 1;
    comparisonStatus.textContent = state.comparisonItems.length
      ? `${available} of ${state.comparisonItems.length} catalogue photos ready.`
      : 'Nothing loaded yet.';
  };

  buildComparisonBtn.addEventListener('click', () => {
    void (async () => {
      const parsed = parseCatalogueComparisonInput(comparisonInput.value, 8);
      const onlyFabricSamples =
        parsed.length > 0 && parsed.every(item => item.kind === 'fabric-sample');
      comparisonFabric.hidden = onlyFabricSamples;
      comparisonFabric.disabled = onlyFabricSamples;
      comparisonFabric.placeholder = 'Shared fabric name or code';
      if (onlyFabricSamples) comparisonFabric.value = '';
      const detectedFabrics = Array.from(
        new Set(parsed.map(item => item.fabricName || item.fabricCode).filter(Boolean))
      );
      if (!onlyFabricSamples && !comparisonFabric.value.trim() && detectedFabrics.length === 1) {
        comparisonFabric.value = detectedFabrics[0];
      }
      const requested = applySharedComparisonFabric(parsed, comparisonFabric.value);
      if (requested.length < 1) {
        comparisonStatus.textContent =
          'Add a product code, product link, order line, or fabric sample.';
        comparisonInput.focus();
        return;
      }
      buildComparisonBtn.disabled = true;
      buildComparisonBtn.textContent = 'Loading...';
      comparisonStatus.textContent = `Matching ${requested.length} configurations and photos...`;
      try {
        const { response, data } = await requestSearchPayload('', '', {
          phase: 'storefront-comparison',
          comparisonItems: requested,
        });
        if (!response.ok || !Array.isArray(data?.items)) {
          throw new Error(data?.message || `Catalogue request failed (${response.status})`);
        }
        state.comparisonItems = data.items.map(normalizeComparisonResponseItem);
        renderComparisonItems();
      } catch (error) {
        state.comparisonItems = [];
        renderComparisonItems();
        comparisonStatus.textContent = `Could not load comparison: ${error instanceof Error ? error.message : 'Unknown error'}`;
      } finally {
        buildComparisonBtn.disabled = false;
        buildComparisonBtn.textContent = 'Load comparison';
      }
    })();
  });

  const loadPublicOverallDimensions = async (productReference: string) => {
    const reference = String(productReference || '').trim();
    if (!reference || !/^[A-Z0-9][A-Z0-9._-]*(?:__[A-Z0-9._-]+)*$/i.test(reference)) return;
    try {
      const { response, data } = await requestSearchPayload(reference, '', {
        phase: 'public-measurements',
        productReference: reference,
      });
      if (!response.ok || !data?.measurements) return;
      state.storefrontProduct = {
        title: state.storefrontProduct?.title || reference,
        url: state.storefrontProduct?.url || '',
        imageUrl: state.storefrontProduct?.imageUrl || '',
        imageUrls: state.storefrontProduct?.imageUrls || [],
        dimensions: data.measurements,
        measurementReference: String(data.productReference || reference).trim(),
        measurementStyle: String(data.style || '').trim(),
        measurementStyleCode: String(data.styleCode || '').trim(),
      };
      renderProductOverview();
      setLoadProgress(30, 'Overall dimensions ready', 'Loading product photos and CW40 details...');
    } catch (error) {
      console.info('[CW Import] Fast public dimensions unavailable', error);
    }
  };

  const getSearchResultStyleOption = (item: SearchResultItem): VariantOption | null => {
    if (!Array.isArray(item.styleOptions) || item.styleOptions.length === 0) {
      return {
        productReference: item.productReference,
        style: '',
        styleCode: '',
        label: 'Standard',
      };
    }
    return (
      item.styleOptions.find(
        option =>
          makeStyleKey(option.productReference, option.style, option.styleCode) ===
          item.selectedStyleKey
      ) || null
    );
  };

  const buildBasketItemFromResult = (item: SearchResultItem): BasketItem | null => {
    const styleOption = getSearchResultStyleOption(item);
    if (!item.productReference || !styleOption) return null;
    const versionOption =
      item.versionOptions.find(option => option.code === item.selectedVersionCode) || null;
    const versionCode = (versionOption?.code || item.selectedVersionCode || '').trim();
    const versionLabel = (versionOption?.label || '').trim();
    const scopedReference =
      (versionOption?.scopedReference || '').trim() ||
      getScopedReference(item.productReference, versionCode);
    return {
      productId: item.id || '',
      selectionKey: makeSelectionKey(
        item.productReference,
        versionCode,
        styleOption.style,
        styleOption.styleCode
      ),
      search: (searchTermEl?.value || '').trim(),
      productReference: item.productReference,
      productName: item.productName,
      versionCode,
      versionLabel,
      scopedReference,
      style: styleOption.style,
      styleCode: styleOption.styleCode,
      styleOptions: item.styleOptions,
      versionOptions: item.versionOptions,
      derivedScopedReferences: item.derivedScopedReferences,
      label: buildBasketLabel({
        productReference: item.productReference,
        productName: item.productName,
        versionLabel,
        style: styleOption.style,
        styleCode: styleOption.styleCode,
      }),
    };
  };

  const activeLoadedItems = (): LoadedMeasurementItem[] => {
    if (!state.activeItemKey) return state.loadedItems.filter(item => item.success);
    return state.loadedItems.filter(
      item => item.success && item.selectionKey === state.activeItemKey
    );
  };

  const visibleRows = (): VisibleImportedRow[] => {
    const rows: VisibleImportedRow[] = [];
    const loaded = activeLoadedItems();
    loaded.forEach(item => {
      item.rows.forEach(row => {
        const sectionName = normalizeSectionName(normalizeValueText(row.sectionName));
        if (state.activeSection && sectionName !== state.activeSection) return;
        rows.push({
          ...row,
          rowKey: makeRowStorageKey(item.selectionKey, row.id),
          itemKey: item.selectionKey,
          itemLabel: item.basketItem.label,
          productReference: item.productReference,
        });
      });
    });
    return rows;
  };

  const allLoadedRows = (): VisibleImportedRow[] => {
    const rows: VisibleImportedRow[] = [];
    state.loadedItems
      .filter(item => item.success)
      .forEach(item => {
        item.rows.forEach(row => {
          rows.push({
            ...row,
            rowKey: makeRowStorageKey(item.selectionKey, row.id),
            itemKey: item.selectionKey,
            itemLabel: item.basketItem.label,
            productReference: item.productReference,
          });
        });
      });
    return rows;
  };

  const setActiveLoadedItem = (selectionKey: string, options: { resetSection?: boolean } = {}) => {
    state.activeItemKey = (selectionKey || '').trim();
    if (options.resetSection !== false) {
      state.activeSection = '';
    }
    renderLoadedItems();
    renderItemFilter();
    renderSectionFilter();
    renderImages();
    renderRows();
  };

  const renderItemFilter = () => {
    itemFilterEl.innerHTML = '<option value="">All Items</option>';
    state.loadedItems
      .filter(item => item.success)
      .forEach(item => {
        const option = document.createElement('option');
        option.value = item.selectionKey;
        option.textContent = item.basketItem.label;
        if (option.value === state.activeItemKey) option.selected = true;
        itemFilterEl.appendChild(option);
      });
  };

  const renderSectionFilter = () => {
    const rowSections = visibleRows().map(row =>
      normalizeSectionName(normalizeValueText(row.sectionName))
    );
    const imageSections = allImageEntries().map(entry => normalizeSectionName(entry.section));
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

  const allImageEntries = (): VisibleImageEntry[] => {
    const entries: VisibleImageEntry[] = [];
    const seenSelectionImageKeys = new Set<string>();
    activeLoadedItems().forEach(item => {
      const addEntry = (section: string, candidates: string[]) => {
        if (!Array.isArray(candidates) || !candidates.length) return;
        const key = imageKeyFromUrl(candidates[0] || '');
        if (!key) return;
        const selectionImageKey = `${item.selectionKey}::${key}`;
        if (seenSelectionImageKeys.has(selectionImageKey)) return;
        seenSelectionImageKeys.add(selectionImageKey);
        entries.push({
          itemKey: item.selectionKey,
          itemLabel: item.basketItem.label,
          productReference: item.productReference,
          section,
          key,
          selectionImageKey,
          candidates,
        });
      };

      Object.entries(item.sectionImageGroups || {}).forEach(([section, groups]) => {
        (groups || []).forEach(group => addEntry(section, group));
      });

      if (!Object.keys(item.sectionImageGroups || {}).length) {
        (item.imageCandidateGroups || []).forEach(group => {
          addEntry(normalizeSectionName(sectionFromImageName(group[0] || '')) || 'General', group);
        });
      }
    });
    const storefrontUrls = Array.from(
      new Set(
        [state.storefrontProduct?.imageUrl, ...(state.storefrontProduct?.imageUrls || [])]
          .map(value => String(value || '').trim())
          .filter(Boolean)
      )
    );
    const storefrontOwner = activeLoadedItems()[0];
    const storefrontOwnerKey =
      storefrontOwner?.selectionKey ||
      `storefront:${state.storefrontProduct?.measurementReference || slugify(state.storefrontProduct?.title || 'product')}`;
    storefrontUrls.forEach(url => {
      const key = imageKeyFromUrl(url);
      if (!key) return;
      const selectionImageKey = `${storefrontOwnerKey}::${key}`;
      if (seenSelectionImageKeys.has(selectionImageKey)) return;
      seenSelectionImageKeys.add(selectionImageKey);
      entries.push({
        itemKey: storefrontOwnerKey,
        itemLabel: storefrontOwner?.basketItem.label || state.storefrontProduct?.title || 'Product',
        productReference:
          storefrontOwner?.productReference || state.storefrontProduct?.measurementReference || '',
        section: 'Product Photos',
        key,
        selectionImageKey,
        candidates: [url],
      });
    });
    return state.activeSection
      ? entries.filter(entry => entry.section === state.activeSection)
      : entries;
  };

  const selectedImageEntries = (): VisibleImageEntry[] =>
    allImageEntries().filter(entry => state.selectedImageKeys.includes(entry.selectionImageKey));

  /** Re-fetch data for a single search result item after version/style change. */
  const privateDetailsInFlight = new Set<string>();
  const loadPrivateProductDetails = async (basketItem: BasketItem): Promise<void> => {
    if (!basketItem.selectionKey || privateDetailsInFlight.has(basketItem.selectionKey)) return;
    privateDetailsInFlight.add(basketItem.selectionKey);
    try {
      setLoadProgress(92, 'Measurements ready', 'Loading full CW40 measurements...');
      const velcroVariant = /__(?:VH|VS)$/i.test(basketItem.scopedReference || '');
      const detailBasketItem: BasketItem = {
        ...basketItem,
        style:
          basketItem.style ||
          state.storefrontProduct?.measurementStyle ||
          (velcroVariant ? 'Urban' : ''),
        styleCode:
          basketItem.styleCode ||
          state.storefrontProduct?.measurementStyleCode ||
          (velcroVariant ? 'VELC_SP' : ''),
      };
      const { response, data } = await requestSearchPayload(
        (searchTermEl?.value || '').trim(),
        '',
        { phase: 'load-selected-details', selectedItems: [detailBasketItem] }
      );
      const successfulItems = (Array.isArray(data?.items) ? data.items : []).filter(
        (item: any) => item?.success !== false
      );
      if (!response.ok || !successfulItems.length) {
        const failure = (Array.isArray(data?.items) ? data.items : []).find(
          (item: any) => item?.success === false
        );
        const message = String(failure?.message || data?.message || '').trim();
        const needsLogin = /missing cw credentials|username\/password/i.test(message);
        setLoadProgress(
          100,
          'Overall dimensions ready',
          needsLogin ? 'Sign in to load full CW40 measurements' : 'CW40 details unavailable',
          { complete: true }
        );
        setStatus(
          needsLogin
            ? 'Width, Depth and Height are ready. Enter your CW login under Advanced connection to load the full CW40 measurements.'
            : `Overall dimensions are ready. CW40 details could not load${message ? `: ${message}` : '.'}`,
          needsLogin ? 'info' : 'bad'
        );
        const loginDetails = body.querySelector<HTMLDetailsElement>('#cwLoginDetails');
        if (needsLogin && loginDetails) loginDetails.open = true;
        return;
      }
      integrateLoadedItems(successfulItems);
      if (basketItem.selectionKey) state.activeItemKey = basketItem.selectionKey;
      syncUi();
      const loaded = state.loadedItems.find(item => item.selectionKey === basketItem.selectionKey);
      const photoCount = allImageEntries().length;
      const detailedRows = (loaded?.rows || []).filter(
        row => !/^(?:width|depth|height)$/i.test(String(row.sourceLabel || '').trim())
      );
      if (!detailedRows.length) {
        setStatus(
          'Overall dimensions are ready. CW40 returned no component measurements for this selection.',
          'info'
        );
        setLoadProgress(
          100,
          'Overall dimensions ready',
          `${loaded?.rows.length || 0} overall measurements, ${photoCount} photos`,
          { complete: true }
        );
        return;
      }
      setStatus(`Ready: ${loaded?.rows.length || 0} measurements and ${photoCount} photos.`, 'ok');
      setLoadProgress(
        100,
        'CW40 measurements ready',
        `${loaded?.rows.length || 0} measurements, ${photoCount} photos`,
        { complete: true }
      );
    } catch (error) {
      console.info(
        '[CW Import] Detailed product photos unavailable; keeping public product data',
        error
      );
    } finally {
      privateDetailsInFlight.delete(basketItem.selectionKey);
    }
  };

  const retryPrivateDetailsForActiveProduct = () => {
    const activeBasketItem =
      state.basket.find(item => item.selectionKey === state.activeItemKey) || state.basket[0];
    if (activeBasketItem && usernameEl.value.trim() && passwordEl.value) {
      void loadPrivateProductDetails(activeBasketItem);
    }
  };
  usernameEl.addEventListener('change', retryPrivateDetailsForActiveProduct);
  passwordEl.addEventListener('change', retryPrivateDetailsForActiveProduct);

  const reloadSearchResultItem = async (item: SearchResultItem) => {
    const basketItem = buildBasketItemFromResult(item);
    if (!basketItem) return;
    // A product lookup has one authoritative selection. Changing a version or
    // style replaces that selection instead of quietly growing a basket.
    state.searchResults.forEach(candidate => {
      candidate.selected = candidate === item;
    });
    state.basket = [basketItem];
    state.loadedItems = state.loadedItems.filter(
      loaded => loaded.selectionKey === basketItem.selectionKey
    );
    state.activeItemKey = state.loadedItems[0]?.selectionKey || '';
    state.activeSection = '';
    state.selectedImageKeys = [];
    renderBasket();
    setStatus(`Loading ${basketItem.scopedReference || basketItem.productReference}...`);
    setLoadProgress(
      48,
      'Loading measurements',
      basketItem.scopedReference || basketItem.productReference
    );
    try {
      const { response, data, cached } = await requestSearchPayload(
        (searchTermEl?.value || '').trim(),
        '',
        { phase: 'load-selected', selectedItems: [basketItem] }
      );
      setLoadProgress(
        84,
        'Preparing photos',
        cached ? 'Using recent result' : 'Measurements ready'
      );
      const items = Array.isArray(data?.items) ? data.items : [];
      integrateLoadedItems(items);
      // Set the active item to the newly loaded one
      if (basketItem.selectionKey) {
        state.activeItemKey = basketItem.selectionKey;
      }
      syncUi();
      if (response.ok) {
        const imageCount = allImageEntries().length;
        const rowCount =
          state.loadedItems.find(li => li.selectionKey === basketItem.selectionKey)?.rows?.length ||
          0;
        setStatus(
          `Loaded ${basketItem.scopedReference || basketItem.productReference} — ${rowCount} measurement${rowCount === 1 ? '' : 's'} and ${imageCount} photo${imageCount === 1 ? '' : 's'}.`,
          'ok'
        );
        setLoadProgress(100, 'Ready', `${rowCount} measurements, ${imageCount} photos`, {
          complete: true,
        });
        if (imagesWrap.children.length > 0) {
          requestAnimationFrame(() =>
            imagesWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
          );
        }
        void loadPrivateProductDetails(basketItem);
      } else {
        setLoadProgress(100, 'Could not load product', 'Check the connection details');
        setStatus(
          `Load failed for ${basketItem.scopedReference || basketItem.productReference}: ${String(data?.message || data?.code || response.status)}`,
          'bad'
        );
      }
    } catch (error) {
      setLoadProgress(100, 'Could not load product', 'Please try again');
      setStatus(`Load failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'bad');
    }
  };

  const renderSearchResults = () => {
    searchResultsWrap.innerHTML = '';
    if (!state.searchResults.length) {
      productResultsShell.classList.add('is-empty');
      resultsMeta.textContent = '';
      return;
    }

    productResultsShell.classList.remove('is-empty');
    resultsMeta.textContent = `${state.searchResults.length} product${state.searchResults.length === 1 ? '' : 's'}`;

    state.searchResults.forEach(item => {
      const card = document.createElement('div');
      const selectionReady = isCwConfigurationSelectionReady(item);
      card.className = `cw-result-card${item.selected ? ' is-selected' : ''}${selectionReady ? ' is-ready' : ''}`;
      card.tabIndex = 0;
      card.setAttribute('role', 'radio');
      card.setAttribute('aria-checked', item.selected ? 'true' : 'false');

      const top = document.createElement('div');
      top.className = 'cw-result-top';
      const copy = document.createElement('div');
      copy.style.minWidth = '0';
      const title = document.createElement('p');
      title.className = 'cw-result-title';
      title.textContent = `${item.productReference}${item.productName ? ` - ${item.productName}` : ''}`;
      copy.appendChild(title);

      const meta = document.createElement('div');
      meta.style.display = 'flex';
      const checkbox = document.createElement('input');
      checkbox.type = 'radio';
      checkbox.name = 'cw-product-result';
      checkbox.className = 'cw-result-check';
      checkbox.checked = item.selected;
      meta.appendChild(checkbox);

      top.appendChild(copy);
      top.appendChild(meta);
      card.appendChild(top);

      const selectProduct = () => {
        state.searchResults.forEach(candidate => {
          candidate.selected = candidate === item;
        });
        renderSearchResults();
      };

      const controls = document.createElement('div');
      controls.className = 'cw-result-controls';

      const versionSelect = document.createElement('select');
      versionSelect.className = 'cw-select';
      versionSelect.setAttribute('aria-label', `Configuration for ${item.productReference}`);
      if (item.versionOptions.length) {
        versionSelect.appendChild(new Option('Choose configuration', '', true, false));
        item.versionOptions.forEach(option => {
          const code = String(option.code || (option as any).value || '').trim();
          const label = String(option.label || code).trim();
          const suffix = option.confirmed === true ? ' · measurements available' : '';
          versionSelect.appendChild(new Option(`${label}${suffix}`, code));
        });
        versionSelect.value = item.selectedVersionCode;
      } else {
        versionSelect.appendChild(new Option('Base product', ''));
        versionSelect.disabled = true;
      }

      const styleSelect = document.createElement('select');
      styleSelect.className = 'cw-select';
      styleSelect.setAttribute('aria-label', `Style for ${item.productReference}`);
      if (item.styleOptions.length) {
        styleSelect.appendChild(new Option('Choose style', '', true, false));
        item.styleOptions.forEach(option => {
          const key = makeStyleKey(option.productReference, option.style, option.styleCode);
          styleSelect.appendChild(
            new Option(option.label || option.style || option.styleCode, key)
          );
        });
        styleSelect.value = item.selectedStyleKey;
      } else {
        styleSelect.appendChild(new Option('Standard', ''));
        styleSelect.disabled = true;
      }

      const loadButton = document.createElement('button');
      loadButton.type = 'button';
      loadButton.className = 'cw-btn cw-btn-primary';
      loadButton.textContent = 'Load configuration';
      loadButton.disabled = !isCwConfigurationSelectionReady(item);

      const versionField = document.createElement('label');
      versionField.className = 'cw-result-field';
      const versionLabel = document.createElement('span');
      versionLabel.textContent = 'Configuration';
      versionField.append(versionLabel, versionSelect);

      const styleField = document.createElement('label');
      styleField.className = 'cw-result-field';
      const styleLabel = document.createElement('span');
      styleLabel.textContent = 'Style';
      styleField.append(styleLabel, styleSelect);

      const loadAction = document.createElement('div');
      loadAction.className = 'cw-result-action';
      const loadHint = document.createElement('small');
      loadHint.textContent = 'Choose both options';
      loadAction.append(loadHint, loadButton);

      const syncSelection = () => {
        state.searchResults.forEach(candidate => {
          candidate.selected = candidate === item;
        });
        item.selectedVersionCode = versionSelect.value;
        item.selectedStyleKey = styleSelect.value;
        loadButton.disabled = !isCwConfigurationSelectionReady(item);
        card.classList.toggle('is-ready', !loadButton.disabled);
        loadHint.textContent = loadButton.disabled
          ? 'Choose both options'
          : 'Measurements available';
        card.classList.add('is-selected');
        card.setAttribute('aria-checked', 'true');
        checkbox.checked = true;
      };
      versionSelect.addEventListener('change', syncSelection);
      styleSelect.addEventListener('change', syncSelection);
      loadButton.addEventListener('click', () => {
        syncSelection();
        if (!isCwConfigurationSelectionReady(item)) return;
        const candidate = buildBasketItemFromResult(item);
        const existing = candidate
          ? state.loadedItems.find(loaded => loaded.selectionKey === candidate.selectionKey)
          : null;
        if (existing) {
          setActiveLoadedItem(existing.selectionKey);
          return;
        }
        void reloadSearchResultItem(item);
      });
      controls.append(versionField, styleField, loadAction);
      card.appendChild(controls);

      card.addEventListener('click', event => {
        if ((event.target as HTMLElement | null)?.closest('input, button, label, select')) return;
        selectProduct();
      });
      card.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        selectProduct();
      });
      checkbox.addEventListener('change', selectProduct);
      searchResultsWrap.appendChild(card);
    });
  };

  const renderBasket = () => {
    basketWrap.innerHTML = '';
    if (!state.basket.length) {
      if (basketMeta) basketMeta.textContent = '';
      return;
    }

    if (basketMeta)
      basketMeta.textContent = `${state.basket.length} item${state.basket.length === 1 ? '' : 's'} queued — click Load Selected.`;
    state.basket.forEach(item => {
      const card = document.createElement('div');
      card.className = 'cw-basket-card';
      const row = document.createElement('div');
      row.className = 'cw-basket-row';
      const copy = document.createElement('div');
      copy.className = 'cw-basket-copy';
      const title = document.createElement('p');
      title.className = 'cw-basket-title';
      title.textContent = item.label;
      const meta = document.createElement('p');
      meta.className = 'cw-basket-meta';
      meta.textContent = item.scopedReference || item.productReference;
      copy.appendChild(title);
      copy.appendChild(meta);
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'cw-btn';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => {
        state.basket = state.basket.filter(entry => entry.selectionKey !== item.selectionKey);
        renderBasket();
      });
      row.appendChild(copy);
      row.appendChild(removeBtn);
      card.appendChild(row);
      basketWrap.appendChild(card);
    });
  };

  const setVisibleImageSelection = (selected: boolean) => {
    const visibleKeys = allImageEntries()
      .map(entry => entry.selectionImageKey)
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
      const key = card.dataset.selectionImageKey || '';
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

  const buildMeasureHeadMarkup = (compact = false): string =>
    compact
      ? '<div class="cw-measure-head"><div>Measurement</div><div>Value</div><div>Label</div><div></div></div>'
      : '<div class="cw-measure-head"><div>Item / Source Label</div><div>Section</div><div>Value</div><div>Map to Stroke Label</div><div>Actions</div></div>';

  let measurementWorkspacePaneSyncRaf: number | null = null;
  let measurementWorkspacePaneRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let measurementWorkspaceScrollTop = 0;
  let measurementWorkspaceScrollLeft = 0;
  const elementsLibraryScrollTopByScope: Record<string, number> = {};
  const elementsLibraryRowOffsetByScope: Record<string, number> = {};
  let elementsLibraryRenderedScope = '';
  let elementsLibraryRenderedHost: HTMLDivElement | null = null;
  let elementsLibraryPositionRaf: number | null = null;
  let elementsLibraryPositionRequest = 0;

  const getWorkspaceTagScopeKeys = (scopeLabel: string): string[] => {
    const canonical = getCanonicalCwScopeKey(scopeLabel);
    const base = canonical.split('::tab:')[0] || canonical;
    const currentScope = String((window as any).currentImageLabel || '').trim();
    const currentBase = currentScope.split('::tab:')[0] || currentScope;
    const activeScope =
      currentScope && currentBase === base
        ? currentScope
        : String(
            (window as any).app?.metadataManager?.resolveActiveImageLabel?.(base) || ''
          ).trim();
    return Array.from(
      new Set([(scopeLabel || '').trim(), canonical, base, activeScope].filter(Boolean))
    );
  };

  const getWorkspaceScopeBase = (scopeLabel: string): string => {
    const canonical = getCanonicalCwScopeKey(scopeLabel);
    return canonical.split('::tab:')[0] || canonical;
  };

  const getActiveDrawIntent = (
    scopeLabel: string
  ): SearchState['activeDrawIntentByScope'][string] | null => {
    return state.activeDrawIntentByScope[getWorkspaceScopeBase(scopeLabel)] || null;
  };

  const getScopedArmedRowKey = (scopeLabel: string): string => {
    const intent = getActiveDrawIntent(scopeLabel);
    if (intent?.rowKey) return intent.rowKey;
    return resolveCwScopedArmedRowKey(
      state.armedRowKeyByScope,
      getWorkspaceTagScopeKeys(scopeLabel)
    );
  };

  const setScopedArmedRowKey = (scopeLabel: string, rowKey: string): void => {
    getWorkspaceTagScopeKeys(scopeLabel).forEach(key => {
      if (rowKey) {
        state.armedRowKeyByScope[key] = rowKey;
      } else {
        delete state.armedRowKeyByScope[key];
      }
    });
    state.armedRowKey = rowKey;
    const existingIntent = getActiveDrawIntent(scopeLabel);
    const scopeBase = getWorkspaceScopeBase(scopeLabel);
    if (!rowKey) {
      delete state.activeDrawIntentByScope[scopeBase];
      return;
    }
    state.activeDrawIntentByScope[scopeBase] = {
      rowKey,
      label: existingIntent?.rowKey === rowKey ? existingIntent.label : '',
    };
  };

  const getWorkspaceSiblingScopeKeys = (scopeLabel: string): string[] => {
    const canonicalScope = getCanonicalCwScopeKey(scopeLabel);
    const scopeMeta = state.importedViewMetaByScope[canonicalScope];
    if (!scopeMeta) {
      return [canonicalScope].filter(Boolean);
    }

    return Array.from(
      new Set(
        Object.entries(state.importedViewMetaByScope)
          .filter(
            ([, meta]) =>
              meta.itemKey === scopeMeta.itemKey && meta.sectionName === scopeMeta.sectionName
          )
          .map(([candidateScope]) => candidateScope)
          .concat(canonicalScope)
          .filter(Boolean)
      )
    );
  };

  const inferWorkspaceTagMode = (label: string): 'letters' | 'letters+numbers' | '' => {
    const normalized = normalizeGuideLabel(label);
    if (!normalized) return '';
    if (/^[A-Z]$/.test(normalized)) return 'letters';
    if (/^[A-Z]\d+$/.test(normalized)) return 'letters+numbers';
    return '';
  };

  const syncWorkspaceTagMode = (targetLabel: string): void => {
    const nextMode = inferWorkspaceTagMode(targetLabel);
    if (!nextMode) return;

    const w = window as any;
    if (typeof w.setTagMode === 'function') {
      w.setTagMode(nextMode, { updateDisplay: false });
      return;
    }

    w.tagMode = nextMode;
    if (w.app?.tagManager) {
      w.app.tagManager.tagMode = nextMode;
    }
    const tagModeToggle = document.getElementById('tagModeToggle');
    if (tagModeToggle) {
      tagModeToggle.textContent = nextMode === 'letters' ? 'Letters Only' : 'Letters + Numbers';
    }
  };

  const readWorkspaceNextTag = (scopeLabel: string): string => {
    const w = window as any;
    return resolveCwWorkspaceNextTag({
      scopeKeys: getWorkspaceTagScopeKeys(scopeLabel),
      manualTags: w.manualTagByImage,
      guideTags: w.guideOneTimeTagByImage,
      labelTags: w.labelsByImage,
      displayTag: getNextTagValue(),
      calculatedTag: typeof w.calculateNextTag === 'function' ? w.calculateNextTag() : '',
    });
  };

  const seedWorkspaceNextDrawLabel = (
    scopeLabel: string,
    targetLabel: string,
    rowKey: string
  ): void => {
    const normalizedTargetLabel = normalizeGuideLabel(targetLabel);
    if (!normalizedTargetLabel) return;

    const w = window as any;
    syncWorkspaceTagMode(normalizedTargetLabel);
    w.guideOneTimeTagByImage = w.guideOneTimeTagByImage || {};
    w.labelsByImage = w.labelsByImage || {};
    w.manualTagByImage = w.manualTagByImage || {};

    const keys = getWorkspaceTagScopeKeys(scopeLabel);
    const seedChanged = hasCwWorkspaceSeedChanged({
      scopeKeys: keys,
      targetLabel: normalizedTargetLabel,
      rowKey,
      displayTag: getNextTagValue(),
      guideTags: w.guideOneTimeTagByImage,
      labelTags: w.labelsByImage,
      readyRows: state.readyRowKeyByScope,
    });
    keys.forEach(key => {
      w.guideOneTimeTagByImage[key] = normalizedTargetLabel;
      w.labelsByImage[key] = normalizedTargetLabel;
      // Keep the visible Next Tag pinned to the armed Library row as well.
      // Guide refreshes can run between the click and mouse-up; without this
      // priority seed they repaint the field with the guide's generic next
      // role (for example W) even though the user explicitly chose A.
      w.manualTagByImage[key] = normalizedTargetLabel;
      if (rowKey) state.readyRowKeyByScope[key] = rowKey;
      if (rowKey) state.readyLabelByScope[key] = normalizedTargetLabel;
    });
    if (rowKey) {
      state.activeDrawIntentByScope[getWorkspaceScopeBase(scopeLabel)] = {
        rowKey,
        label: normalizedTargetLabel,
      };
    }
    w.currentImageLabel = getCanonicalCwScopeKey(scopeLabel);
    // The bound CW row is authoritative while the split workspace is active.
    // Write it directly so a stale display/calculated tag cannot win this frame.
    setNextTagValue(normalizedTargetLabel);
    if (seedChanged) {
      window.dispatchEvent(
        new CustomEvent('openpaint:guide-next-tag-changed', {
          detail: {
            viewId: String(scopeLabel || '').split('::')[0] || 'front',
            tag: normalizedTargetLabel,
            imageLabel: w.currentImageLabel,
            nextTag: normalizedTargetLabel,
            source: 'cw-import',
          },
        })
      );
    }
  };

  const clearWorkspaceNextDrawLabel = (scopeLabel: string): void => {
    const w = window as any;
    const keys = getWorkspaceTagScopeKeys(scopeLabel);
    keys.forEach(key => {
      if (w.guideOneTimeTagByImage) delete w.guideOneTimeTagByImage[key];
      if (w.labelsByImage) delete w.labelsByImage[key];
      if (w.manualTagByImage) delete w.manualTagByImage[key];
      delete state.readyRowKeyByScope[key];
      delete state.readyLabelByScope[key];
    });
    delete state.activeDrawIntentByScope[getWorkspaceScopeBase(scopeLabel)];
    w.updateNextTagDisplay?.();
  };

  const getScopedReadyDrawLabel = (scopeLabel: string, rowKey = ''): string => {
    const intent = getActiveDrawIntent(scopeLabel);
    if (intent?.label && (!rowKey || intent.rowKey === rowKey)) {
      return normalizeGuideLabel(intent.label);
    }
    for (const key of getWorkspaceTagScopeKeys(scopeLabel)) {
      // The row and its seeded label are one draw intent. Never combine a
      // label from an older alias with the currently armed row from another
      // alias: that is how a deliberate H1 could become an unrelated C5.
      if (rowKey && state.readyRowKeyByScope[key] !== rowKey) continue;
      const label = normalizeGuideLabel(state.readyLabelByScope[key] || '');
      if (label) return label;
    }
    return '';
  };

  const positionLibraryRow = (
    rowKey: string,
    options: { focusLabel?: boolean; useSavedSlot?: boolean } = {}
  ): void => {
    if (!rowKey) return;
    const scroller = document.getElementById('strokeVisibilityControls');
    const row = document.querySelector<HTMLElement>(
      `#elementsMeasurementLibrary .cw-measure-row[data-cw-row-key="${CSS.escape(rowKey)}"]`
    );
    if (!scroller || !row) return;

    const scrollerRect = scroller.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const inset = 8;
    const scopeBase = getWorkspaceScopeBase(getCurrentScopeLabel());
    const savedSlot = elementsLibraryRowOffsetByScope[scopeBase];
    const visibleSavedSlot = Number.isFinite(savedSlot)
      ? Math.max(inset, Math.min(savedSlot, scroller.clientHeight - rowRect.height - inset))
      : Number.NaN;
    // Only scroll when the row is actually outside the visible viewport.
    // Scrolling on every render (even when the row is already visible) causes
    // the erratic, jumpy behavior the user sees. When we do scroll, bring the
    // row to the top of the viewport with a small inset.
    const isAbove = rowRect.top < scrollerRect.top + inset;
    const isBelow = rowRect.bottom > scrollerRect.bottom - inset;
    // Keeping a row in the same visual slot is useful only when it has left the
    // viewport. Re-applying the slot while it is already visible makes the
    // library bounce after every DOM rebuild.
    if (options.useSavedSlot && Number.isFinite(visibleSavedSlot) && (isAbove || isBelow)) {
      scroller.scrollTop += rowRect.top - scrollerRect.top - visibleSavedSlot;
    } else if (isAbove || isBelow) {
      const delta = isAbove
        ? rowRect.top - scrollerRect.top - inset
        : rowRect.bottom - scrollerRect.bottom + inset;
      scroller.scrollTop += delta;
    }
    if (scroller.dataset.cwLibraryRebuilding !== 'true') {
      elementsLibraryScrollTopByScope[scopeBase] = scroller.scrollTop;
    }

    if (options.focusLabel) {
      const input = row.querySelector<HTMLInputElement>('.cw-measure-input');
      const active = document.activeElement as HTMLElement | null;
      const userMovedToAnotherControl =
        active &&
        active !== document.body &&
        active !== input &&
        active.isConnected &&
        !active.closest('.stroke-visibility-item') &&
        (active.matches('input, textarea, button, select') || active.isContentEditable);
      if (!userMovedToAnotherControl) input?.focus({ preventScroll: true });
    }
  };

  const keepLibraryRowVisible = (
    rowKey: string,
    options: { focusLabel?: boolean; useSavedSlot?: boolean } = {}
  ): void => {
    if (!rowKey) return;
    const request = ++elementsLibraryPositionRequest;
    if (elementsLibraryPositionRaf !== null) {
      window.cancelAnimationFrame(elementsLibraryPositionRaf);
    }
    elementsLibraryPositionRaf = window.requestAnimationFrame(() => {
      elementsLibraryPositionRaf = null;
      if (request !== elementsLibraryPositionRequest) return;
      positionLibraryRow(rowKey, options);
    });
  };

  const captureLibraryRowSlot = (rowKey: string, scopeLabel: string): void => {
    const scroller = document.getElementById('strokeVisibilityControls');
    const row = document.querySelector<HTMLElement>(
      `#elementsMeasurementLibrary .cw-measure-row[data-cw-row-key="${CSS.escape(rowKey)}"]`
    );
    if (!scroller || !row) return;
    const scrollerRect = scroller.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    elementsLibraryRowOffsetByScope[getWorkspaceScopeBase(scopeLabel)] = Math.max(
      8,
      Math.min(rowRect.top - scrollerRect.top, scroller.clientHeight - rowRect.height - 8)
    );
  };

  const cancelArmedMeasurementRow = (scopeLabel = getCurrentScopeLabel()): void => {
    setScopedArmedRowKey(scopeLabel, '');
    clearWorkspaceNextDrawLabel(scopeLabel);
    renderRows();
  };

  const toggleArmedMeasurementRow = (
    row: VisibleImportedRow,
    configuredLabel: string,
    options: { allowToggleOff?: boolean; preserveSavedSlot?: boolean } = {}
  ): { armed: boolean; targetLabel: string } => {
    const scopeLabel = getCurrentScopeLabel();
    if (!options.preserveSavedSlot) {
      captureLibraryRowSlot(row.rowKey, scopeLabel);
    }
    const explicitTargetLabel = normalizeGuideLabel(configuredLabel);
    const suggestedTargetLabel = normalizeGuideLabel(
      guessMosLabel(row.sourceLabel, row.sectionName || '')
    );
    if (!explicitTargetLabel && !suggestedTargetLabel) {
      state.rowTargetLabels[row.rowKey] = '';
      setScopedArmedRowKey(scopeLabel, row.rowKey);
      clearWorkspaceNextDrawLabel(scopeLabel);
      renderRows();
      keepLibraryRowVisible(row.rowKey, { focusLabel: true, useSavedSlot: true });
      setStatus(`Add a label for ${row.sourceLabel} before drawing.`, 'info');
      return { armed: true, targetLabel: '' };
    }
    const baseTargetLabel = resolveRowTargetLabel(
      row,
      configuredLabel,
      readWorkspaceNextTag(scopeLabel) || getNextTagValue()
    );
    if (!baseTargetLabel) {
      return { armed: false, targetLabel: '' };
    }

    // Unlabelled CW rows stay first-class choices. Claim the current Next Tag
    // only when the user chooses the row, rather than consuming tags while the
    // library is merely rendered.
    if (!normalizeGuideLabel(configuredLabel)) {
      state.rowTargetLabels[row.rowKey] = baseTargetLabel;
    }

    const allowToggleOff = options.allowToggleOff !== false;
    if (allowToggleOff && getScopedArmedRowKey(scopeLabel) === row.rowKey) {
      setScopedArmedRowKey(scopeLabel, '');
      clearWorkspaceNextDrawLabel(scopeLabel);
      renderRows();
      return { armed: false, targetLabel: baseTargetLabel };
    }

    const targetLabel = resolveNextAvailableCwLabel(
      baseTargetLabel,
      getWorkspaceUsedLabels(scopeLabel)
    );
    setScopedArmedRowKey(scopeLabel, row.rowKey);
    seedWorkspaceNextDrawLabel(scopeLabel, targetLabel, row.rowKey);
    renderRows();
    keepLibraryRowVisible(row.rowKey, { useSavedSlot: true });
    return { armed: true, targetLabel };
  };

  const armNextMeasurementRow = (afterRowKey: string): { armed: boolean; rowKey: string } => {
    const scopeLabel = getCurrentScopeLabel();
    const completedOverallRow = allLoadedRows().find(row => row.rowKey === afterRowKey);
    const completedOverallLabel =
      completedOverallRow && isCwOverallDimensionRow(completedOverallRow)
        ? overallDimensionDisplayLabel(completedOverallRow.sourceLabel)
        : '';
    if (completedOverallRow && completedOverallLabel) {
      const dimensionOrder = ['Width', 'Depth', 'Height'];
      const completedIndex = dimensionOrder.indexOf(completedOverallLabel);
      const itemRows = allLoadedRows().filter(row => row.itemKey === completedOverallRow.itemKey);
      const usedLabels = getWorkspaceUsedLabels(scopeLabel);

      for (let index = completedIndex + 1; index < dimensionOrder.length; index += 1) {
        const displayLabel = dimensionOrder[index];
        const nextRow = itemRows.find(
          row =>
            isCwOverallDimensionRow(row) &&
            overallDimensionDisplayLabel(row.sourceLabel) === displayLabel
        );
        if (!nextRow) continue;
        const targetLabel = overallDimensionTag(displayLabel);
        if (!targetLabel || usedLabels.has(targetLabel)) continue;
        state.rowTargetLabels[nextRow.rowKey] = targetLabel;
        const result = toggleArmedMeasurementRow(nextRow, targetLabel, {
          allowToggleOff: false,
          preserveSavedSlot: true,
        });
        if (result.armed) return { armed: true, rowKey: nextRow.rowKey };
      }

      // This product may have detail measurements after its available overall
      // dimensions. Fall through to the normal row-order progression instead
      // of treating a missing Depth/Height row as the end of the library.
    }

    const rows = getRowsForWorkspaceScope(scopeLabel);
    const currentIndex = rows.findIndex(row => row.rowKey === afterRowKey);
    if (currentIndex < 0 || currentIndex >= rows.length - 1) {
      setScopedArmedRowKey(scopeLabel, '');
      clearWorkspaceNextDrawLabel(scopeLabel);
      renderRows();
      return { armed: false, rowKey: '' };
    }

    const usedLabels = getWorkspaceUsedLabels(scopeLabel);
    const mappedRows = rows.map(row => ({
      row,
      rowKey: row.rowKey,
      targetLabel: resolveRowTargetLabel(row, state.rowTargetLabels[row.rowKey] || ''),
    }));
    const remainingRows = mappedRows.slice(currentIndex + 1);
    for (const next of remainingRows) {
      const normalizedTarget = normalizeGuideLabel(next.targetLabel);
      // If the label is a duplicate, don't skip — arm the row with an
      // auto-deduplicated label (e.g. "G2" → "G2(1)") so every measurement
      // gets drawn.
      let effectiveLabel = state.rowTargetLabels[next.row.rowKey] || '';
      if (normalizedTarget && usedLabels.has(normalizedTarget)) {
        effectiveLabel = resolveNextAvailableCwLabel(normalizedTarget, usedLabels);
        state.rowTargetLabels[next.row.rowKey] = effectiveLabel;
      }
      const result = toggleArmedMeasurementRow(next.row, effectiveLabel, {
        allowToggleOff: false,
        preserveSavedSlot: true,
      });
      if (result.armed) {
        return { armed: true, rowKey: next.row.rowKey };
      }
    }

    setScopedArmedRowKey(scopeLabel, '');
    clearWorkspaceNextDrawLabel(scopeLabel);
    renderRows();
    return { armed: false, rowKey: '' };
  };

  const hasWorkspaceManualTagOverride = (scopeLabel: string): boolean => {
    const manualTags = ((window as any).manualTagByImage || {}) as Record<string, string>;
    return getWorkspaceTagScopeKeys(scopeLabel).some(key =>
      normalizeGuideLabel(manualTags[key] || '')
    );
  };

  const getWorkspaceUsedLabels = (scopeLabel: string): Set<string> => {
    const metadata = (window as any).app?.metadataManager;
    const used = new Set<string>();

    getWorkspaceSiblingScopeKeys(scopeLabel).forEach(siblingScope => {
      const canonicalScope =
        typeof metadata?.normalizeImageLabel === 'function'
          ? String(metadata.normalizeImageLabel(siblingScope) || siblingScope).trim()
          : (siblingScope || '').trim();

      Object.keys(metadata?.vectorStrokesByImage?.[canonicalScope] || {}).forEach(label => {
        const normalized = normalizeGuideLabel(label);
        if (normalized) used.add(normalized);
      });

      getWorkspaceTagScopeKeys(siblingScope).forEach(key => {
        (state.completedLabelsByScope[key] || []).forEach(label => {
          const normalized = normalizeGuideLabel(label);
          if (normalized) used.add(normalized);
        });
        const lineStrokes = Array.isArray((window as any).lineStrokesByImage?.[key])
          ? (window as any).lineStrokesByImage[key]
          : [];
        lineStrokes.forEach((label: string) => {
          const normalized = normalizeGuideLabel(label);
          if (normalized) used.add(normalized);
        });
      });
    });

    return used;
  };

  const markWorkspaceLabelCompleted = (scopeLabel: string, targetLabel: string): void => {
    const normalized = normalizeGuideLabel(targetLabel);
    if (!normalized) return;
    getWorkspaceTagScopeKeys(scopeLabel).forEach(key => {
      const labels = new Set(state.completedLabelsByScope[key] || []);
      labels.add(normalized);
      state.completedLabelsByScope[key] = [...labels];
    });
  };

  const markWorkspaceRowCompleted = (scopeLabel: string, rowKey: string): void => {
    if (!rowKey) return;
    getWorkspaceTagScopeKeys(scopeLabel).forEach(key => {
      const rowKeys = new Set(state.completedRowKeysByScope[key] || []);
      rowKeys.add(rowKey);
      state.completedRowKeysByScope[key] = [...rowKeys];
    });
  };

  const getCompletedWorkspaceRowKeys = (scopeLabel: string): Set<string> => {
    const completed = new Set<string>();
    getWorkspaceTagScopeKeys(scopeLabel).forEach(key => {
      (state.completedRowKeysByScope[key] || []).forEach(rowKey => completed.add(rowKey));
    });
    return completed;
  };

  const getRowsForWorkspaceScope = (scopeLabel: string): VisibleImportedRow[] => {
    const activeRows = visibleRows();
    const scopeMeta = state.importedViewMetaByScope[getCanonicalCwScopeKey(scopeLabel)];
    if (scopeMeta) {
      // Imported comparison images can belong to a product other than the
      // globally active search result. Resolve from the complete library so a
      // view always receives its own dimensions when products are switched.
      return filterCwWorkspaceRows(allLoadedRows(), scopeMeta);
    }
    const sectionName = normalizeSectionName(sectionFromImageName(scopeLabel));
    if (!sectionName) {
      return activeRows;
    }

    const sectionRows = activeRows.filter(
      row => normalizeSectionName(normalizeValueText(row.sectionName)) === sectionName
    );
    return sectionRows.length ? sectionRows : activeRows;
  };

  const findNextWorkspaceGuideRow = (
    scopeLabel: string
  ): { row: VisibleImportedRow; targetLabel: string } | null => {
    const usedLabels = getWorkspaceUsedLabels(scopeLabel);
    const candidateRows = getRowsForWorkspaceScope(scopeLabel);

    const mappedRows = candidateRows.map(row => ({
      row,
      rowKey: row.rowKey,
      targetLabel: resolveRowTargetLabel(row, (state.rowTargetLabels[row.rowKey] || '').trim()),
    }));
    const next = findNextCwWorkspaceRow(mappedRows, usedLabels);
    return next ? { row: next.row, targetLabel: next.targetLabel } : null;
  };

  const syncWorkspaceGuideSeed = (
    scopeLabel: string,
    options: { render?: boolean; arm?: boolean } = {}
  ): { rowKey: string; targetLabel: string; armed: boolean } | null => {
    const activeIntent = getActiveDrawIntent(scopeLabel);
    if (!scopeLabel || (hasWorkspaceManualTagOverride(scopeLabel) && !activeIntent)) {
      if (options.render) {
        renderRows();
      }
      return null;
    }

    const mappedRows = getRowsForWorkspaceScope(scopeLabel).map(row => ({
      row,
      rowKey: row.rowKey,
      targetLabel: resolveRowTargetLabel(row, (state.rowTargetLabels[row.rowKey] || '').trim()),
    }));
    const scopedArmedRowKey = getScopedArmedRowKey(scopeLabel);
    const selection = resolveCwWorkspaceQueueRow(
      mappedRows,
      getWorkspaceUsedLabels(scopeLabel),
      scopedArmedRowKey
    );
    if (!selection) {
      setScopedArmedRowKey(scopeLabel, '');
      clearWorkspaceNextDrawLabel(scopeLabel);
      if (options.render) {
        renderRows();
      }
      return null;
    }

    if (scopedArmedRowKey && !selection.armed) {
      setScopedArmedRowKey(scopeLabel, '');
    }
    const nextRow = {
      row: selection.row.row,
      // Keep a manually selected duplicate exact. Queue reconciliation may
      // otherwise re-resolve it from generic row data and turn H1(1) into a
      // stale H1 or a completely different automatic label.
      targetLabel:
        activeIntent?.rowKey === selection.row.row.rowKey && activeIntent.label
          ? activeIntent.label
          : selection.row.targetLabel,
    };

    if (options.arm) {
      setScopedArmedRowKey(scopeLabel, nextRow.row.rowKey);
    }

    const shouldSeed = options.arm === true || selection.armed;
    if (shouldSeed) {
      seedWorkspaceNextDrawLabel(scopeLabel, nextRow.targetLabel, nextRow.row.rowKey);
    } else {
      clearWorkspaceNextDrawLabel(scopeLabel);
    }
    if (options.render) {
      renderRows();
    }

    return {
      rowKey: nextRow.row.rowKey,
      targetLabel: nextRow.targetLabel,
      armed: shouldSeed,
    };
  };

  const syncCompactCwQueueDock = (): void => {
    document.getElementById('cwMeasurementQueueDock')?.remove();
    const scopeLabel = getCurrentScopeLabel();
    const rows = getRowsForWorkspaceScope(scopeLabel);
    const armedRowKey = getScopedArmedRowKey(scopeLabel);
    const armedRow = rows.find(row => row.rowKey === armedRowKey) || null;
    window.dispatchEvent(
      new CustomEvent('openpaint:cw-queue-state', {
        detail: armedRow
          ? {
              active: true,
              rowKey: armedRow.rowKey,
              label: Object.prototype.hasOwnProperty.call(state.rowTargetLabels, armedRow.rowKey)
                ? state.rowTargetLabels[armedRow.rowKey]
                : readWorkspaceNextTag(scopeLabel),
              value: getEffectiveRowValue(armedRow),
              sourceLabel: armedRow.sourceLabel,
            }
          : { active: false },
      })
    );
  };

  window.addEventListener('openpaint:cw-queue-label-change', event => {
    const detail = (event as CustomEvent<{ rowKey?: string; label?: string }>).detail || {};
    const rowKey = String(detail.rowKey || '');
    const row = allLoadedRows().find(item => item.rowKey === rowKey);
    if (!row) return;
    const configuredLabel = normalizeGuideLabel(detail.label || '');
    state.rowTargetLabels[rowKey] = configuredLabel;
    const scopeLabel = getCurrentScopeLabel();
    if (getScopedArmedRowKey(scopeLabel) !== rowKey) return;
    if (!configuredLabel) {
      clearWorkspaceNextDrawLabel(scopeLabel);
      setStatus(`Add a label for ${row.sourceLabel} before drawing.`, 'info');
    } else {
      const targetLabel = resolveNextAvailableCwLabel(
        configuredLabel,
        getWorkspaceUsedLabels(scopeLabel)
      );
      seedWorkspaceNextDrawLabel(scopeLabel, targetLabel, rowKey);
    }
    syncCompactCwQueueDock();
  });

  (window as any).canStartCwQueuedDrawing = (): boolean => {
    const scopeLabel = getCurrentScopeLabel();
    const rowKey = getScopedArmedRowKey(scopeLabel);
    if (!rowKey) return true;
    const row = allLoadedRows().find(item => item.rowKey === rowKey);
    if (!row) return true;
    const configuredLabel = normalizeGuideLabel(state.rowTargetLabels[rowKey] || '');
    const suggestedLabel = normalizeGuideLabel(
      isCwOverallDimensionRow(row)
        ? overallDimensionTag(overallDimensionDisplayLabel(row.sourceLabel))
        : guessMosLabel(row.sourceLabel, row.sectionName || '')
    );
    if (configuredLabel || suggestedLabel) return true;

    renderRows();
    keepLibraryRowVisible(rowKey, { focusLabel: true });
    setStatus(`Name ${row.sourceLabel} before drawing, or cancel it to draw freely.`, 'bad');
    return false;
  };
  // The drawing tools read this synchronously while committing a stroke. It is
  // deliberately independent of the Next Tag display, which can update during
  // Fabric's mouse-up lifecycle before the CW assignment listener runs.
  (window as any).getCwQueuedDrawLabel = (scopeLabel = getCurrentScopeLabel()): string => {
    const rowKey = getScopedArmedRowKey(scopeLabel);
    if (!rowKey) return '';
    return getScopedReadyDrawLabel(scopeLabel, rowKey);
  };
  (window as any).cancelCwQueuedDrawing = () => cancelArmedMeasurementRow();

  window.addEventListener('openpaint:cw-queue-value-change', event => {
    const detail = (event as CustomEvent<{ rowKey?: string; value?: string }>).detail || {};
    const rowKey = String(detail.rowKey || '');
    const row = allLoadedRows().find(item => item.rowKey === rowKey);
    if (!row) return;
    const value = String(detail.value || '').trim();
    if (parseImportedCentimeterValue(value) === null) {
      setStatus(`Enter a valid value for ${row.sourceLabel}.`, 'bad');
      return;
    }
    if (value === getOriginalRowValue(row)) delete state.rowValueOverrides[rowKey];
    else state.rowValueOverrides[rowKey] = value;
    syncCompactCwQueueDock();
  });

  const renderRowsInto = (
    targetRowsContainer: HTMLDivElement,
    options: {
      preserveScroll?: boolean;
      scrollTop?: number;
      scrollLeft?: number;
      compact?: boolean;
      library?: boolean;
      scopeLabel?: string;
    } = {}
  ) => {
    const preserveScroll = options.preserveScroll === true;
    const previousScrollTop = preserveScroll
      ? (options.scrollTop ?? targetRowsContainer.scrollTop)
      : 0;
    const previousScrollLeft = preserveScroll
      ? (options.scrollLeft ?? targetRowsContainer.scrollLeft)
      : 0;
    targetRowsContainer.innerHTML = '';
    const compact = options.compact === true;
    const library = options.library === true;
    const currentScopeLabel = options.scopeLabel || getCurrentScopeLabel();
    const filteredRows = library
      ? allLoadedRows()
      : compact
        ? getRowsForWorkspaceScope(currentScopeLabel)
        : visibleRows();

    if (!filteredRows.length) {
      const empty = document.createElement('div');
      empty.className = 'cw-measure-row';
      empty.textContent = state.loadedItems.length
        ? 'No measurements in this item/section filter.'
        : 'No measurement rows available yet.';
      targetRowsContainer.appendChild(empty);
      if (preserveScroll) {
        targetRowsContainer.scrollTop = previousScrollTop;
        targetRowsContainer.scrollLeft = previousScrollLeft;
      }
      return;
    }

    let lastItemKey = '';
    const scopedArmedRowKey = getScopedArmedRowKey(currentScopeLabel);
    const readyTag = readWorkspaceNextTag(currentScopeLabel);
    const nextReadyRow = !scopedArmedRowKey ? findNextWorkspaceGuideRow(currentScopeLabel) : null;
    const readyRowKey = nextReadyRow?.row.rowKey || '';
    filteredRows.forEach(row => {
      if (!state.activeItemKey && row.itemKey !== lastItemKey) {
        lastItemKey = row.itemKey;
        const groupEl = document.createElement('div');
        groupEl.className = 'cw-measure-group';
        groupEl.textContent = row.itemLabel;
        targetRowsContainer.appendChild(groupEl);
      }

      const rowEl = document.createElement('div');
      rowEl.className = 'cw-measure-row';
      rowEl.dataset.cwRowKey = row.rowKey;
      rowEl.dataset.cwSourceLabel = row.sourceLabel;
      const guessedLabel = isCwOverallDimensionRow(row)
        ? overallDimensionTag(overallDimensionDisplayLabel(row.sourceLabel))
        : guessMosLabel(row.sourceLabel, row.sectionName || '');
      const configuredTargetLabel = state.rowTargetLabels[row.rowKey] || guessedLabel;
      const resolvedTargetLabel = resolveRowTargetLabel(row, configuredTargetLabel);
      const isReadyRow =
        !scopedArmedRowKey &&
        row.rowKey === readyRowKey &&
        Boolean(resolvedTargetLabel) &&
        resolvedTargetLabel === readyTag;
      if (scopedArmedRowKey === row.rowKey) {
        rowEl.classList.add('armed');
        if (!normalizeGuideLabel(configuredTargetLabel) && !guessedLabel) {
          rowEl.classList.add('label-required');
        }
      } else if (isReadyRow) {
        rowEl.classList.add('suggested');
      }

      const sourceEl = document.createElement('div');
      if (library) sourceEl.className = 'cw-library-source';
      if (state.activeItemKey) {
        sourceEl.textContent = row.sourceLabel;
      } else {
        sourceEl.innerHTML = `<strong>${row.sourceLabel}</strong><div style="font-size:11px;color:#64748b;margin-top:2px;">${row.itemLabel}</div>`;
      }

      const sectionEl = document.createElement('div');
      sectionEl.textContent = row.sectionName || '-';

      const valueEl = document.createElement('div');
      valueEl.className = 'cw-measure-val cw-measure-value-field';
      const originalValue = getOriginalRowValue(row);
      const valueInput = document.createElement('input');
      valueInput.type = 'text';
      valueInput.inputMode = 'decimal';
      valueInput.className = 'cw-measure-value-input';
      valueInput.dataset.cwValueInput = row.rowKey;
      valueInput.setAttribute('aria-label', `Value for ${row.sourceLabel} in centimetres`);
      valueInput.value = getEffectiveRowValue(row);
      const resetValue = document.createElement('button');
      resetValue.type = 'button';
      resetValue.className = 'cw-measure-reset';
      resetValue.dataset.cwValueReset = row.rowKey;
      resetValue.textContent = 'Reset';
      resetValue.title = `Restore the original CW value (${originalValue} cm)`;
      resetValue.hidden = !(row.rowKey in state.rowValueOverrides);
      const commitValue = () => {
        const nextValue = valueInput.value.trim();
        if (parseImportedCentimeterValue(nextValue) === null) {
          state.rowValueInvalid[row.rowKey] = true;
          valueInput.setAttribute('aria-invalid', 'true');
          return false;
        }
        delete state.rowValueInvalid[row.rowKey];
        valueInput.removeAttribute('aria-invalid');
        if (nextValue === originalValue) delete state.rowValueOverrides[row.rowKey];
        else state.rowValueOverrides[row.rowKey] = nextValue;
        resetValue.hidden = !(row.rowKey in state.rowValueOverrides);
        return true;
      };
      valueInput.addEventListener('input', () => {
        const nextValue = valueInput.value.trim();
        if (parseImportedCentimeterValue(nextValue) === null) {
          state.rowValueInvalid[row.rowKey] = true;
          valueInput.setAttribute('aria-invalid', 'true');
          return;
        }
        delete state.rowValueInvalid[row.rowKey];
        valueInput.removeAttribute('aria-invalid');
        if (nextValue === originalValue) delete state.rowValueOverrides[row.rowKey];
        else state.rowValueOverrides[row.rowKey] = nextValue;
        resetValue.hidden = !(row.rowKey in state.rowValueOverrides);
      });
      valueInput.addEventListener('blur', commitValue);
      valueInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          if (commitValue()) valueInput.blur();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          valueInput.value = getEffectiveRowValue(row);
          delete state.rowValueInvalid[row.rowKey];
          valueInput.removeAttribute('aria-invalid');
          valueInput.blur();
        }
      });
      resetValue.addEventListener('click', event => {
        event.preventDefault();
        delete state.rowValueOverrides[row.rowKey];
        delete state.rowValueInvalid[row.rowKey];
        valueInput.value = originalValue;
        valueInput.removeAttribute('aria-invalid');
        resetValue.hidden = true;
        renderProductOverview();
      });
      valueEl.append(valueInput, resetValue);

      const selectWrap = document.createElement('div');
      if (library) selectWrap.className = 'cw-library-label';
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'cw-measure-input';
      input.placeholder = guessedLabel ? `Suggested: ${guessedLabel}` : 'MOS label (A1, A2, A3...)';
      input.value = configuredTargetLabel;
      input.addEventListener('input', () => {
        state.rowTargetLabels[row.rowKey] = (input.value || '').trim();
        const isEmpty = !normalizeGuideLabel(input.value || '') && !guessedLabel;
        rowEl.classList.toggle(
          'label-required',
          getScopedArmedRowKey(currentScopeLabel) === row.rowKey && isEmpty
        );
        // Highlight the input red when the typed label is already used by
        // another measurement — the user should rename it or it will be
        // auto-deduplicated (e.g. "G2" → "G2(1)") when drawn.
        const normalized = normalizeGuideLabel(input.value || '');
        const isDuplicate = normalized && getWorkspaceUsedLabels(currentScopeLabel).has(normalized);
        input.classList.toggle('label-duplicate', Boolean(isDuplicate));
        input.style.borderColor = isDuplicate ? '#ef4444' : '';
        input.title = isDuplicate
          ? `"${normalized}" is already used — it will be auto-renamed to ${resolveNextAvailableCwLabel(normalized, getWorkspaceUsedLabels(currentScopeLabel))} when drawn`
          : '';

        // Only seed the workspace draw label when the input looks complete
        // (letter+number like "A1", "G2") — not on every keystroke. Otherwise
        // typing "G" immediately accepts it before the user can type "G2".
        const looksComplete = /^[A-Za-z]\d+$/.test((input.value || '').trim());
        if (getScopedArmedRowKey(currentScopeLabel) === row.rowKey && looksComplete) {
          window.dispatchEvent(
            new CustomEvent('openpaint:cw-queue-label-change', {
              detail: { rowKey: row.rowKey, label: input.value },
            })
          );
        }
      });
      // Also commit on blur so the label is seeded when the user finishes typing
      // and clicks away, even if the value is just a single letter.
      input.addEventListener('blur', () => {
        if (getScopedArmedRowKey(currentScopeLabel) === row.rowKey && input.value.trim()) {
          window.dispatchEvent(
            new CustomEvent('openpaint:cw-queue-label-change', {
              detail: { rowKey: row.rowKey, label: input.value },
            })
          );
        }
      });
      input.addEventListener('keydown', event => {
        if (event.key === 'Escape' && getScopedArmedRowKey(currentScopeLabel) === row.rowKey) {
          event.preventDefault();
          cancelArmedMeasurementRow(currentScopeLabel);
          setStatus('Measurement selection cancelled. Draw freely.', 'info');
        }
      });

      const actionWrap = document.createElement('div');
      if (library) actionWrap.className = 'cw-library-action';
      actionWrap.style.display = 'flex';
      actionWrap.style.gap = '6px';
      actionWrap.style.flexWrap = 'wrap';

      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.className = 'cw-btn';
      applyBtn.textContent = 'Assign Now';
      applyBtn.addEventListener('click', () => {
        if (!commitValue()) {
          valueInput.focus();
          setStatus(`Enter a valid value for ${row.sourceLabel}.`, 'bad');
          return;
        }
        const targetLabel = resolveRowTargetLabel(row, (input.value || '').trim());
        if (!targetLabel) return;
        const applied = applyMeasurement(
          getCurrentScopeLabel(),
          targetLabel,
          getEffectiveRowValue(row),
          row.sourceLabel,
          lockedEl.checked
        );
        if (applied) {
          // Seed the next tag to the assigned label so the guide/next-tag stay in sync
          seedNextTagAfterAssign(getCurrentScopeLabel(), targetLabel);
        }
      });

      const drawBtn = document.createElement('button');
      drawBtn.type = 'button';
      drawBtn.className = `cw-btn${scopedArmedRowKey === row.rowKey ? ' cw-btn-primary' : ''}`;
      const rowNeedsLabel =
        scopedArmedRowKey === row.rowKey &&
        !normalizeGuideLabel(configuredTargetLabel) &&
        !guessedLabel;
      drawBtn.textContent = rowNeedsLabel
        ? 'Cancel'
        : scopedArmedRowKey === row.rowKey
          ? 'Armed'
          : 'Draw Next';
      drawBtn.addEventListener('click', () => {
        if (rowNeedsLabel) {
          cancelArmedMeasurementRow(currentScopeLabel);
          setStatus('Measurement selection cancelled. Draw freely.', 'info');
          return;
        }
        if (!commitValue()) {
          valueInput.focus();
          setStatus(`Enter a valid value for ${row.sourceLabel}.`, 'bad');
          return;
        }
        const result = toggleArmedMeasurementRow(row, input.value || '', { allowToggleOff: true });
        if (result.armed) {
          setStatus(
            `Armed ${row.itemLabel} / ${row.sourceLabel} as ${result.targetLabel}. Draw the next measurement in ${getCurrentScopeLabel()}; value ${getEffectiveRowValue(row)} will apply automatically.`,
            'info'
          );
        }
      });

      rowEl.addEventListener('click', event => {
        const target = event.target as HTMLElement | null;
        if (target?.closest('button, input, textarea, select, label')) return;
        if (!commitValue()) {
          valueInput.focus();
          setStatus(`Enter a valid value for ${row.sourceLabel}.`, 'bad');
          return;
        }
        const result = toggleArmedMeasurementRow(row, input.value || '', { allowToggleOff: false });
        if (result.armed) {
          setStatus(
            `Armed ${row.itemLabel} / ${row.sourceLabel} as ${result.targetLabel}. Draw the next measurement in ${getCurrentScopeLabel()}; value ${getEffectiveRowValue(row)} will apply automatically.`,
            'info'
          );
        }
      });

      selectWrap.appendChild(input);
      actionWrap.appendChild(applyBtn);
      actionWrap.appendChild(drawBtn);
      if (compact || library) {
        sourceEl.innerHTML = library
          ? `<strong>${row.sourceLabel}</strong><small>${row.sectionName || row.itemLabel}</small>`
          : `<strong>${row.sourceLabel}</strong><div style="font-size:11px;color:#64748b;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${row.sectionName || row.itemLabel}</div>`;
        drawBtn.textContent = rowNeedsLabel
          ? 'Cancel'
          : scopedArmedRowKey === row.rowKey
            ? 'Drawing'
            : 'Draw';
        actionWrap.innerHTML = '';
        actionWrap.appendChild(drawBtn);
        rowEl.appendChild(sourceEl);
        rowEl.appendChild(valueEl);
        rowEl.appendChild(selectWrap);
        rowEl.appendChild(actionWrap);
      } else {
        rowEl.appendChild(sourceEl);
        rowEl.appendChild(sectionEl);
        rowEl.appendChild(valueEl);
        rowEl.appendChild(selectWrap);
        rowEl.appendChild(actionWrap);
      }
      targetRowsContainer.appendChild(rowEl);
    });

    if (compact && !library) {
      const next = scopedArmedRowKey
        ? filteredRows.find(row => row.rowKey === scopedArmedRowKey)
        : nextReadyRow?.row;
      const nextCard =
        targetRowsContainer.parentElement?.querySelector<HTMLElement>('.cw-workspace-next');
      if (nextCard) {
        const targetLabel = next
          ? resolveRowTargetLabel(next, state.rowTargetLabels[next.rowKey] || '')
          : '';
        nextCard.querySelector<HTMLElement>('.cw-workspace-next-label')!.textContent =
          targetLabel || 'Done';
        nextCard.querySelector<HTMLElement>('.cw-workspace-next-value')!.textContent = next?.value
          ? `${getEffectiveRowValue(next)} cm`
          : '';
        nextCard.querySelector<HTMLElement>('.cw-workspace-next-source')!.textContent = next
          ? `${next.sourceLabel} · ${next.sectionName || next.itemLabel}`
          : 'All mapped measurements have been drawn.';
      }
    }

    if (preserveScroll) {
      targetRowsContainer.scrollTop = previousScrollTop;
      targetRowsContainer.scrollLeft = previousScrollLeft;
    }
  };

  const ensureMeasurementWorkspacePaneShell = (host: HTMLDivElement): HTMLDivElement | null => {
    let splitRows = host.querySelector<HTMLDivElement>('#cwSplitRows');
    if (splitRows) {
      if (splitRows.dataset.scrollSyncBound !== 'true') {
        splitRows.addEventListener(
          'scroll',
          () => {
            measurementWorkspaceScrollTop = splitRows?.scrollTop || 0;
            measurementWorkspaceScrollLeft = splitRows?.scrollLeft || 0;
          },
          { passive: true }
        );
        splitRows.dataset.scrollSyncBound = 'true';
      }
      return splitRows;
    }

    host.innerHTML = `
      <div class="cw-measure-wrap cw-split-measure-wrap compact">
        <div class="cw-workspace-next">
          <div class="cw-workspace-next-copy">
            <div class="cw-workspace-next-kicker">Next measurement</div>
            <div class="cw-workspace-next-main"><span class="cw-workspace-next-label">—</span><span class="cw-workspace-next-value"></span></div>
            <div class="cw-workspace-next-source"></div>
          </div>
        </div>
        ${buildMeasureHeadMarkup(true)}
        <div id="cwSplitRows" class="cw-split-rows"></div>
      </div>
    `;

    splitRows = host.querySelector<HTMLDivElement>('#cwSplitRows');
    if (splitRows) {
      splitRows.addEventListener(
        'scroll',
        () => {
          measurementWorkspaceScrollTop = splitRows?.scrollTop || 0;
          measurementWorkspaceScrollLeft = splitRows?.scrollLeft || 0;
        },
        { passive: true }
      );
      splitRows.dataset.scrollSyncBound = 'true';
      splitRows.scrollTop = measurementWorkspaceScrollTop;
      splitRows.scrollLeft = measurementWorkspaceScrollLeft;
    }
    return splitRows;
  };

  const syncMeasurementWorkspacePane = () => {
    const host = document.getElementById(
      'guideSplitMeasurementEditorHost'
    ) as HTMLDivElement | null;
    const workspaceActive = (window as any).isMeasurementSplitWorkspaceActive?.() === true;
    if (!host || !workspaceActive) return;

    const workspaceState = (window as any).getMeasurementSplitWorkspaceState?.() || null;
    const workspaceScope =
      String(workspaceState?.activeImportedViewId || '').trim() || getCurrentScopeLabel();
    syncWorkspaceGuideSeed(workspaceScope);

    const splitRows = ensureMeasurementWorkspacePaneShell(host);
    if (splitRows) {
      renderRowsInto(splitRows, {
        preserveScroll: true,
        scrollTop: measurementWorkspaceScrollTop,
        scrollLeft: measurementWorkspaceScrollLeft,
        compact: true,
        scopeLabel: workspaceScope,
      });
      splitRows.scrollTop = measurementWorkspaceScrollTop;
      splitRows.scrollLeft = measurementWorkspaceScrollLeft;
    }
  };

  (window as any).renderCwMeasurementWorkspacePane = syncMeasurementWorkspacePane;

  const renderElementsMeasurementLibrary = () => {
    const host = document.getElementById('elementsMeasurementLibrary') as HTMLDivElement | null;
    const count = allLoadedRows().length;
    const countElement = document.getElementById('elementsLibraryCount');
    if (countElement) countElement.textContent = String(count);
    if (!host) return;
    const scrollContainer = document.getElementById('strokeVisibilityControls');
    const scopeBase = getWorkspaceScopeBase(getCurrentScopeLabel());
    host.style.overflowAnchor = 'none';
    if (scrollContainer) scrollContainer.style.overflowAnchor = 'none';
    if (scrollContainer && scrollContainer.dataset.cwLibraryScrollBound !== 'true') {
      scrollContainer.dataset.cwLibraryScrollBound = 'true';
      scrollContainer.addEventListener('scroll', () => {
        if (scrollContainer.dataset.cwLibraryRebuilding === 'true') return;
        const renderedScope =
          scrollContainer.dataset.cwLibraryScope || elementsLibraryRenderedScope;
        if (renderedScope) {
          elementsLibraryScrollTopByScope[renderedScope] = scrollContainer.scrollTop;
        }
      });
    }

    // Capture the exact position before rebuilding this image's rows. When the
    // active image changed, use that image's own saved position instead.
    if (
      scrollContainer &&
      elementsLibraryRenderedScope === scopeBase &&
      elementsLibraryRenderedHost === host
    ) {
      elementsLibraryScrollTopByScope[scopeBase] = scrollContainer.scrollTop;
    }
    const previousScrollTop = elementsLibraryScrollTopByScope[scopeBase] || 0;
    elementsLibraryRenderedScope = scopeBase;
    elementsLibraryRenderedHost = host;
    if (scrollContainer) scrollContainer.dataset.cwLibraryScope = scopeBase;
    renderRowsInto(host, { compact: true, library: true, preserveScroll: true });
    if (count > 0) {
      const intro = document.createElement('div');
      intro.className = 'cw-library-intro';
      intro.textContent = 'Edit any value or label, then draw it on the current image.';
      host.prepend(intro);
    }
    const restoreScroll = () => {
      if (!scrollContainer) return;
      const maxScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
      scrollContainer.scrollTop = Math.min(previousScrollTop, maxScrollTop);
      // StrokeMetadataManager temporarily rebuilds the whole Elements list.
      // During that gap the browser can report a much smaller maxScrollTop.
      // Never replace the durable per-image position with that transient clamp.
      if (scrollContainer.dataset.cwLibraryRebuilding !== 'true') {
        elementsLibraryScrollTopByScope[scopeBase] = scrollContainer.scrollTop;
      }
    };
    restoreScroll();
    window.requestAnimationFrame(() => {
      restoreScroll();
      const armedRowKey = getScopedArmedRowKey(getCurrentScopeLabel());
      if (armedRowKey) {
        keepLibraryRowVisible(armedRowKey);
      }
    });
  };
  (window as any).renderCwElementsMeasurementLibrary = renderElementsMeasurementLibrary;
  (window as any).captureCwElementsLibraryScroll = (
    scrollTop: number,
    scopeLabel = getCurrentScopeLabel()
  ) => {
    const scopeBase = getWorkspaceScopeBase(scopeLabel);
    if (!scopeBase || !Number.isFinite(scrollTop)) return;
    elementsLibraryScrollTopByScope[scopeBase] = Math.max(0, scrollTop);
  };
  (window as any).getCwMeasurementLibraryCount = () => allLoadedRows().length;

  const scheduleMeasurementWorkspacePaneSync = (attempt = 0) => {
    if (measurementWorkspacePaneSyncRaf !== null) {
      window.cancelAnimationFrame(measurementWorkspacePaneSyncRaf);
      measurementWorkspacePaneSyncRaf = null;
    }
    if (measurementWorkspacePaneRetryTimer) {
      clearTimeout(measurementWorkspacePaneRetryTimer);
      measurementWorkspacePaneRetryTimer = null;
    }

    measurementWorkspacePaneSyncRaf = window.requestAnimationFrame(() => {
      measurementWorkspacePaneSyncRaf = null;
      syncMeasurementWorkspacePane();
      const shouldRetry =
        (window as any).isMeasurementSplitWorkspaceActive?.() === true &&
        !document.getElementById('guideSplitMeasurementEditorHost') &&
        attempt < 6;
      if (shouldRetry) {
        measurementWorkspacePaneRetryTimer = setTimeout(
          () => {
            measurementWorkspacePaneRetryTimer = null;
            scheduleMeasurementWorkspacePaneSync(attempt + 1);
          },
          120 + attempt * 80
        );
      }
    });
  };

  const renderRows = () => {
    renderRowsInto(rowsContainer);
    // The Elements Library owns its own scroll snapshot and restoration. Doing
    // another restore here made a selected row move twice for one render,
    // producing the small upward jump while arming or completing a draw.
    renderElementsMeasurementLibrary();
    syncMeasurementWorkspacePane();
    syncCompactCwQueueDock();
  };

  const seedImportedGuideForView = (
    scopeLabel: string,
    sectionName: string,
    rows: VisibleImportedRow[],
    lockByDefault: boolean
  ): number => {
    const w = window as any;
    if (!w.cwImportedMeasurementsByImage) w.cwImportedMeasurementsByImage = {};
    if (!w.cwGuideRolesByImage) w.cwGuideRolesByImage = {};

    const scopeKey = getCanonicalCwScopeKey(scopeLabel);
    const roles: string[] = [];
    const seenRoles = new Set<string>();
    const now = new Date().toISOString();
    const labelCounts = new Map<string, number>();
    rows.forEach(row => {
      const guessed = guessMosLabel(row.sourceLabel, row.sectionName || sectionName || '');
      const configured = (state.rowTargetLabels[row.rowKey] || '').trim();
      const targetLabel = normalizeGuideLabel(configured || guessed || row.sourceLabel);
      if (targetLabel) labelCounts.set(targetLabel, (labelCounts.get(targetLabel) || 0) + 1);
    });

    rows.forEach(row => {
      const guessed = guessMosLabel(row.sourceLabel, row.sectionName || sectionName || '');
      const configured = (state.rowTargetLabels[row.rowKey] || '').trim();
      const targetLabel = normalizeGuideLabel(configured || guessed || row.sourceLabel);
      const value = getEffectiveRowValue(row);
      if (!targetLabel || !/^[A-Z](?:\d+)?$/.test(targetLabel) || !value) return;

      if (!seenRoles.has(targetLabel)) {
        seenRoles.add(targetLabel);
        roles.push(targetLabel);
      }

      if (!w.cwImportedMeasurementsByImage[scopeKey]) {
        w.cwImportedMeasurementsByImage[scopeKey] = {};
      }
      // Multiple CW components can legitimately reuse labels such as A4. The
      // first row is the default for this imported image; explicit Draw Next
      // selections still use their exact row/value transaction below.
      seedCwMeasurementEntry(w.cwImportedMeasurementsByImage[scopeKey], targetLabel, {
        source: 'cw',
        sourceLabel: row.sourceLabel,
        value,
        locked: lockByDefault,
        pending: true,
        autoApplyOnDraw: false,
        sectionName: normalizeSectionName(row.sectionName || sectionName || ''),
        bindingScopeKey: scopeKey,
        rowKey: row.rowKey,
        uniqueLabel: labelCounts.get(targetLabel) === 1,
        updatedAt: now,
      });
    });

    w.cwGuideRolesByImage[scopeKey] = [...roles];

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

  const waitForImportedViewReady = async (viewId: string, timeoutMs = 7000): Promise<void> => {
    const projectManager = (window as any).app?.projectManager;
    if (!projectManager) throw new Error('Project manager not available');

    const startedAt = Date.now();
    let stableSamples = 0;
    let lastSignature = '';

    while (Date.now() - startedAt < timeoutMs) {
      if (typeof projectManager.whenIdle === 'function') {
        try {
          await projectManager.whenIdle({ timeoutMs: 700 });
        } catch {
          // A compatibility refresh may still be finishing. Keep sampling.
        }
      }

      const canvas = projectManager.canvasManager?.fabricCanvas;
      const background = canvas?.backgroundImage;
      const element = background?._element;
      const source = String(
        background?.getSrc?.() || element?.currentSrc || element?.src || background?.src || ''
      );
      const imageLoaded = Boolean(
        background &&
          source &&
          (!element || element.complete !== false) &&
          Number(background.width || element?.naturalWidth || 0) > 0 &&
          Number(background.height || element?.naturalHeight || 0) > 0
      );
      const idle = !projectManager.isSwitchingView && !projectManager.pendingSwitchViewId;
      const correctView = projectManager.currentViewId === viewId;
      const viewport = Array.isArray(canvas?.viewportTransform)
        ? canvas.viewportTransform.map((value: number) => Number(value || 0).toFixed(3)).join(',')
        : '';
      const signature = `${projectManager.currentViewId}|${source.slice(-160)}|${canvas?.width || 0}x${canvas?.height || 0}|${viewport}`;

      if (idle && correctView && imageLoaded && signature === lastSignature) {
        stableSamples += 1;
      } else {
        stableSamples = 0;
        lastSignature = signature;
      }

      // Several quiet samples cover the delayed sidebar/compatibility refresh
      // that follows the first registered image in Safari and Chrome.
      if (stableSamples >= 5) {
        await new Promise<void>(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        );
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 120));
    }

    throw new Error('The image was added, but the canvas did not become ready in time');
  };

  const renderImages = () => {
    imagesWrap.innerHTML = '';
    const baseUrl = (baseUrlEl?.value || '').trim();
    const username = (usernameEl?.value || '').trim();
    const password = passwordEl?.value || '';
    const entries = allImageEntries().slice(0, 24);

    entries.forEach(entry => {
      const group = entry.candidates;
      const loadedItem = state.loadedItems.find(item => item.selectionKey === entry.itemKey);
      const storefrontImageUrls = new Set([
        state.storefrontProduct?.imageUrl,
        ...(state.storefrontProduct?.imageUrls || []),
      ]);
      const direct =
        group.find(
          url =>
            storefrontImageUrls.has(url) ||
            (loadedItem?.imageUrls.includes(url) && shouldUseDirectImageUrl(url))
        ) || '';
      const isSelected = state.selectedImageKeys.includes(entry.selectionImageKey);
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
      card.dataset.selectionImageKey = entry.selectionImageKey;

      const setSelectedState = (nextSelected: boolean) => {
        const selectedKeys = new Set(state.selectedImageKeys);
        if (!nextSelected) {
          selectedKeys.delete(entry.selectionImageKey);
        } else {
          selectedKeys.add(entry.selectionImageKey);
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
      const itemEl = document.createElement('div');
      itemEl.className = 'cw-image-item';
      itemEl.textContent = entry.itemLabel;
      const sectionEl = document.createElement('div');
      sectionEl.className = 'cw-image-section';
      sectionEl.textContent = entry.section || 'General';
      const nameEl = document.createElement('div');
      nameEl.className = 'cw-image-name';
      nameEl.textContent = fileStemFromUrl(group[0] || '');
      meta.appendChild(itemEl);
      meta.appendChild(sectionEl);
      meta.appendChild(nameEl);

      if (!direct) {
        const img = document.createElement('img');
        img.alt = 'cw-product';
        img.style.minHeight = '60px';
        img.style.background = '#f0f0f0';
        card.appendChild(img);
        card.appendChild(toggle);
        card.appendChild(meta);
        imagesWrap.appendChild(card);
        void (async () => {
          const dataUrl = await fetchProxyImageDataUrl(group, baseUrl, username, password);
          if (dataUrl) {
            img.src = dataUrl;
          } else {
            img.style.opacity = '0.4';
            img.alt = 'Image unavailable';
          }
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

  const renderLoadedItems = () => {
    loadedItemsWrap.innerHTML = '';
    if (!state.loadedItems.length) {
      loadedMeta.textContent = '';
      selectedProductTitle.textContent = 'Selected product';
      productWorkspace.classList.remove('has-product');
      return;
    }

    const successfulItems = state.loadedItems.filter(item => item.success);
    const activeItem =
      successfulItems.find(item => item.selectionKey === state.activeItemKey) ||
      successfulItems[0] ||
      null;
    productPhotos.open = Boolean(activeItem);
    productWorkspace.classList.toggle('has-product', Boolean(activeItem));
    selectedProductTitle.textContent = activeItem
      ? `${activeItem.productName || activeItem.productReference}${activeItem.productReference ? ` · ${activeItem.productReference}` : ''}`
      : 'Selected product';
    const loadedCount = successfulItems.length;
    loadedMeta.textContent = activeItem
      ? `${activeItem.rows.length} measurements · ${Math.max(Object.keys(activeItem.sectionImageGroups || {}).length, activeItem.imageCandidateGroups.length)} photo groups`
      : `${loadedCount}/${state.loadedItems.length} loaded`;
    const appendLoadedCard = (
      label: string,
      meta: string,
      options: {
        selectionKey?: string;
        active?: boolean;
        clickable?: boolean;
        disabled?: boolean;
        allItems?: boolean;
      } = {}
    ) => {
      const card = document.createElement('div');
      card.className = 'cw-loaded-item';
      if (options.clickable) card.classList.add('is-clickable');
      if (options.active) card.classList.add('is-active');
      if (options.disabled) card.classList.add('is-disabled');
      if (options.allItems) card.classList.add('is-all-items');
      card.innerHTML = `<strong>${label}</strong><br /><small>${meta}</small>`;
      if (options.clickable) {
        card.tabIndex = 0;
        card.setAttribute('role', 'button');
        card.setAttribute('aria-pressed', options.active ? 'true' : 'false');
        const activate = () => {
          setActiveLoadedItem(options.selectionKey || '');
        };
        card.addEventListener('click', activate);
        card.addEventListener('keydown', event => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          activate();
        });
      }
      loadedItemsWrap.appendChild(card);
    };

    if (successfulItems.length > 1) {
      const totalRows = successfulItems.reduce((sum, item) => sum + item.rows.length, 0);
      const totalPhotoGroups = successfulItems.reduce(
        (sum, item) =>
          sum +
          Math.max(
            Object.keys(item.sectionImageGroups || {}).length,
            item.imageCandidateGroups.length
          ),
        0
      );
      appendLoadedCard(
        'All loaded items',
        `${totalRows} rows, ${totalPhotoGroups} photo groups. Preview everything together.`,
        {
          active: !state.activeItemKey,
          clickable: true,
          allItems: true,
        }
      );
    }

    state.loadedItems.forEach(item => {
      appendLoadedCard(
        item.basketItem.label,
        `${item.rows.length} rows, ${Math.max(Object.keys(item.sectionImageGroups || {}).length, item.imageCandidateGroups.length)} photo groups. ${item.loadMessage}`,
        {
          selectionKey: item.selectionKey,
          active: item.success && item.selectionKey === state.activeItemKey,
          clickable: item.success,
          disabled: !item.success,
        }
      );
    });
  };

  const findOverallDimension = (rows: ImportedRow[], aliases: string[]): ImportedRow | null => {
    const normalizedAliases = aliases.map(alias => alias.toLowerCase());
    const overallRows = rows.filter(row => isCwOverallDimensionRow(row));
    return (
      overallRows.find(row => normalizedAliases.includes(row.sourceLabel.trim().toLowerCase())) ||
      overallRows.find(row => {
        const label = row.sourceLabel.trim().toLowerCase();
        return normalizedAliases.some(alias => label === `overall ${alias}`);
      }) ||
      null
    );
  };

  const overallDimensionTag = (label: string): string => {
    if (label === 'Width') return 'W';
    if (label === 'Depth') return 'D';
    if (label === 'Height') return 'H';
    return '';
  };

  const overallDimensionDisplayLabel = (sourceLabel: string): string => {
    const label = sourceLabel
      .trim()
      .toLowerCase()
      .replace(/^overall\s+/, '');
    if (label === 'width' || label === 'length') return 'Width';
    if (label === 'depth') return 'Depth';
    if (label === 'height') return 'Height';
    return '';
  };

  const getOverallDimensionSequence = (
    item: LoadedMeasurementItem | null
  ): VisibleImportedRow[] => {
    if (!item) return [];
    const itemRows = item.rows.map(row => ({
      ...row,
      rowKey: makeRowStorageKey(item.selectionKey, row.id),
      itemKey: item.selectionKey,
      itemLabel: item.basketItem.label,
      productReference: item.productReference,
    }));
    return ['Width', 'Depth', 'Height']
      .map(displayLabel =>
        itemRows.find(
          row =>
            isCwOverallDimensionRow(row) &&
            overallDimensionDisplayLabel(row.sourceLabel) === displayLabel
        )
      )
      .filter((row): row is VisibleImportedRow => Boolean(row && getEffectiveRowValue(row)));
  };

  const prepareOverallDimensionChoices = (
    item: LoadedMeasurementItem | null
  ): { armed: boolean; count: number; targetLabel: string } => {
    const rows = getOverallDimensionSequence(item);
    rows.forEach(row => {
      const displayLabel = isCwOverallDimensionRow(row)
        ? overallDimensionDisplayLabel(row.sourceLabel)
        : '';
      if (!state.rowTargetLabels[row.rowKey]) {
        state.rowTargetLabels[row.rowKey] = overallDimensionTag(displayLabel);
      }
    });
    return { armed: false, count: rows.length, targetLabel: '' };
  };

  const createComparisonMeasurementItem = (
    item: CatalogueComparisonItem
  ): LoadedMeasurementItem | null => {
    const dimensionRows = [
      ['Width', item.dimensions?.width],
      ['Depth', item.dimensions?.depth],
      ['Height', item.dimensions?.height],
    ]
      .map(([sourceLabel, rawValue], index) => ({
        id: `catalogue-overall-${String(sourceLabel).toLowerCase()}-${index + 1}`,
        sourceLabel: String(sourceLabel),
        value: toPrimitiveMeasurementValue(rawValue),
        sectionName: 'Frame Cover',
      }))
      .filter(row => Boolean(row.value));
    if (!dimensionRows.length) return null;

    const selectionKey = `catalogue:${item.requestedSku || item.productReference}`;
    const productName = item.title || item.productReference;
    const style = item.measurementStyle || item.styleName || '';
    const styleCode = item.measurementStyleCode || '';
    const basketItem: BasketItem = {
      productId: '',
      selectionKey,
      search: item.productReference,
      productReference: item.productReference,
      productName,
      versionCode: '',
      versionLabel: '',
      scopedReference: item.measurementReference || item.productReference,
      style,
      styleCode,
      styleOptions: [],
      versionOptions: [],
      derivedScopedReferences: [],
      label: [item.productReference, productName, style].filter(Boolean).join(' · '),
    };
    return {
      selectionKey,
      basketItem,
      productReference: item.productReference,
      productName,
      rows: dimensionRows,
      imageUrls: item.imageUrl ? [item.imageUrl] : [],
      imageCandidateGroups: item.imageUrl ? [[item.imageUrl]] : [],
      sectionImageGroups: item.imageUrl ? { 'Frame Cover': [[item.imageUrl]] } : {},
      rawData: { source: 'cw-catalogue-comparison', item },
      loadMessage: 'Catalogue dimensions',
      success: true,
    };
  };

  const upsertComparisonMeasurementItem = (
    item: CatalogueComparisonItem
  ): LoadedMeasurementItem | null => {
    const loadedItem = createComparisonMeasurementItem(item);
    if (!loadedItem) return null;
    const existingIndex = state.loadedItems.findIndex(
      candidate => candidate.selectionKey === loadedItem.selectionKey
    );
    if (existingIndex >= 0) state.loadedItems[existingIndex] = loadedItem;
    else state.loadedItems.push(loadedItem);
    prepareOverallDimensionChoices(loadedItem);
    return loadedItem;
  };

  const renderProductOverview = () => {
    const activeItem =
      state.loadedItems.find(item => item.success && item.selectionKey === state.activeItemKey) ||
      state.loadedItems.find(item => item.success) ||
      null;
    const studioButton = document.getElementById('cwOpen3dBtn') as HTMLButtonElement | null;
    if (studioButton) {
      studioButton.disabled = !activeItem;
      studioButton.onclick = () => {
        if (!activeItem) return;
        window.dispatchEvent(
          new CustomEvent('openpaint:sofa3d-open', {
            detail: {
              cw: {
                name: activeItem.productName,
                reference: activeItem.productReference,
                data: activeItem.rawData,
              },
            },
          })
        );
      };
    }
    const publicProduct = state.storefrontProduct;
    const fallbackImage = state.discoveryImageUrls[0] || '';
    const imageUrl = publicProduct?.imageUrl || fallbackImage;
    const productName = publicProduct?.title || activeItem?.productName || '';
    const productUrl = publicProduct?.url || '';
    const shouldShow = Boolean(activeItem || publicProduct || imageUrl);

    productWorkspace.classList.toggle('has-product', shouldShow);
    storefrontProduct.classList.toggle('visible', shouldShow);
    if (!activeItem && productName) selectedProductTitle.textContent = productName;
    storefrontProductName.textContent = productName;
    storefrontProductImage.src = imageUrl;
    storefrontProductImage.alt = productName ? `${productName} product photo` : 'Product photo';
    storefrontProductImage.style.display = imageUrl ? 'block' : 'none';
    storefrontProductLink.href = productUrl || '#';
    storefrontProductTextLink.href = productUrl || '#';
    storefrontProductLink.style.pointerEvents = productUrl ? 'auto' : 'none';
    storefrontProductTextLink.style.display = productUrl ? 'inline-flex' : 'none';

    const rows = activeItem?.rows || [];
    const dimensions = [
      {
        label: 'Width',
        row: findOverallDimension(rows, ['width', 'length']),
        publicValue: toPrimitiveMeasurementValue(publicProduct?.dimensions?.width),
      },
      {
        label: 'Depth',
        row: findOverallDimension(rows, ['depth']),
        publicValue: toPrimitiveMeasurementValue(publicProduct?.dimensions?.depth),
      },
      {
        label: 'Height',
        row: findOverallDimension(rows, ['height']),
        publicValue: toPrimitiveMeasurementValue(publicProduct?.dimensions?.height),
      },
    ];
    overallDimensions.innerHTML = '';
    const armedRowKey = getScopedArmedRowKey(getCurrentScopeLabel());
    dimensions.forEach(({ label, row, publicValue }) => {
      const rowKey = row && activeItem ? makeRowStorageKey(activeItem.selectionKey, row.id) : '';
      const dimension = document.createElement('div');
      dimension.dataset.dimension = label.toLowerCase();
      const effectiveValue = row
        ? getEffectiveRowValue({
            ...row,
            rowKey,
            itemKey: activeItem?.selectionKey || '',
            itemLabel: activeItem?.basketItem.label || '',
            productReference: activeItem?.productReference || '',
          })
        : publicValue;
      dimension.className = `cw-dimension${effectiveValue ? '' : ' missing'}${rowKey && rowKey === armedRowKey ? ' is-armed' : ''}`;
      const dimensionLabel = document.createElement('span');
      dimensionLabel.className = 'cw-dimension-label';
      dimensionLabel.textContent = label;
      const dimensionValue = document.createElement('span');
      dimensionValue.className = 'cw-dimension-value';
      dimensionValue.textContent = effectiveValue || 'Not listed';
      const action = document.createElement('span');
      action.className = 'cw-dimension-action';
      action.textContent = effectiveValue ? `${overallDimensionTag(label)} tag` : '';
      dimension.append(dimensionLabel, dimensionValue, action);
      overallDimensions.appendChild(dimension);
    });

    photoCount.textContent = `${allImageEntries().length} available`;
  };

  let statusTimerId: ReturnType<typeof setInterval> | null = null;
  const setStatus = (message: string, kind: 'info' | 'ok' | 'bad' = 'info') => {
    if (statusTimerId) {
      clearInterval(statusTimerId);
      statusTimerId = null;
    }
    resultMeta.textContent = message;
    resultMeta.style.color = kind === 'ok' ? '#166534' : kind === 'bad' ? '#b91c1c' : '#334155';
    if (kind === 'info') {
      const start = Date.now();
      statusTimerId = setInterval(() => {
        const elapsed = Math.round((Date.now() - start) / 1000);
        resultMeta.textContent = `${message} (${elapsed}s)`;
      }, 1000);
    }
  };

  const setProbeButtonsDisabled = (disabled: boolean) => {
    searchBtn.disabled = disabled;
    if (runProbeBtn) runProbeBtn.disabled = disabled;
    if (runBulkProbeBtn) runBulkProbeBtn.disabled = disabled;
    if (runStagedProbeBtn) runStagedProbeBtn.disabled = disabled;
    if (runTurboStagedProbeBtn) runTurboStagedProbeBtn.disabled = disabled;
  };

  const getProbeTerms = (): string[] => {
    const seeded = (probeTermsEl?.value || '')
      .split(/\r?\n|,|;/)
      .map(item => item.trim())
      .filter(Boolean);
    const fallbackSearch = (searchTermEl?.value || '').trim();
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
    const minConcurrency = Math.max(1, options.minConcurrency || PROBE_MIN_CONCURRENCY);
    const maxConcurrency = Math.max(
      minConcurrency,
      options.maxConcurrency || PROBE_MAX_CONCURRENCY
    );
    let concurrency = Math.min(
      maxConcurrency,
      Math.max(minConcurrency, options.initialConcurrency || PROBE_DEFAULT_CONCURRENCY)
    );
    const adaptiveConcurrency = options.adaptiveConcurrency !== false;

    const reportEntries = new Array<Record<string, unknown>>(terms.length);
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

  const integrateLoadedItems = (items: any[]) => {
    const nextLoaded = new Map(state.loadedItems.map(item => [item.selectionKey, item]));
    const nextSelectedImageKeys = new Set(state.selectedImageKeys);

    let newestSelectionKey = '';
    items.forEach(item => {
      const payload = item?.data || {};
      const serverBasketItem = item?.basketItem as BasketItem;
      // Merge with client-side basket item to preserve label and other client-only fields
      const clientBasketItem = state.basket.find(
        b => b.selectionKey === (serverBasketItem?.selectionKey || item?.selectionKey)
      );
      const basketItem: BasketItem = {
        ...(clientBasketItem || ({} as BasketItem)),
        ...serverBasketItem,
      };
      if (!basketItem.label) {
        basketItem.label = buildBasketLabel({
          productReference: basketItem.productReference || '',
          productName: basketItem.productName || '',
          versionLabel: basketItem.versionLabel || '',
          style: basketItem.style || '',
          styleCode: basketItem.styleCode || '',
        });
      }
      const rows = extractRows(payload).map(row => ({
        ...row,
        sectionName: classifyMeasurementSection(
          row.sourceLabel,
          row.sectionName || row.sourceLabel
        ),
      }));
      const imageCandidates = extractImageUrls(payload, (baseUrlEl?.value || '').trim());
      const imageCandidateGroups = groupImageCandidates(imageCandidates);
      const sectionImageGroups = mergeSectionImageGroups(
        collectSectionImageGroups(payload, (baseUrlEl?.value || '').trim()),
        imageCandidateGroups
      );
      const imageUrls = Array.isArray(imageCandidates) ? imageCandidates : [];
      const loadedItem: LoadedMeasurementItem = {
        selectionKey: String(item?.selectionKey || basketItem?.selectionKey || '').trim(),
        basketItem,
        productReference: String(
          basketItem?.productReference || payload?.product?.reference || ''
        ).trim(),
        productName: String(
          basketItem?.productName ||
            payload?.product?.translations?.[0]?.name ||
            payload?.product?.translations?.[0]?.slug ||
            ''
        ).trim(),
        rows,
        imageUrls,
        imageCandidateGroups,
        sectionImageGroups,
        rawData: payload,
        loadMessage: String(item?.message || payload?.message || payload?.code || 'Loaded').trim(),
        success: item?.success !== false,
      };
      const previous = nextLoaded.get(loadedItem.selectionKey);
      if (previous?.success) {
        loadedItem.rows = loadedItem.rows.length ? loadedItem.rows : previous.rows;
        loadedItem.imageUrls = Array.from(
          new Set([...(previous.imageUrls || []), ...(loadedItem.imageUrls || [])])
        );
        loadedItem.imageCandidateGroups = groupImageCandidates(loadedItem.imageUrls);
        const combinedSectionGroups: Record<string, string[][]> = {
          ...(previous.sectionImageGroups || {}),
        };
        Object.entries(loadedItem.sectionImageGroups || {}).forEach(([section, groups]) => {
          const existing = combinedSectionGroups[section] || [];
          const seen = new Set(existing.map(group => imageKeyFromUrl(group[0] || '')));
          combinedSectionGroups[section] = [...existing];
          (groups || []).forEach(group => {
            const key = imageKeyFromUrl(group[0] || '');
            if (!key || seen.has(key)) return;
            seen.add(key);
            combinedSectionGroups[section].push(group);
          });
        });
        loadedItem.sectionImageGroups = mergeSectionImageGroups(
          combinedSectionGroups,
          loadedItem.imageCandidateGroups
        );
      }
      nextLoaded.set(loadedItem.selectionKey, loadedItem);
      if (loadedItem.success && loadedItem.selectionKey) {
        newestSelectionKey = loadedItem.selectionKey;
      }
      const allGroups = Object.values(loadedItem.sectionImageGroups).flat().length
        ? Object.values(loadedItem.sectionImageGroups).flat()
        : loadedItem.imageCandidateGroups;
      allGroups.forEach(group => {
        const imageKey = imageKeyFromUrl(group[0] || '');
        if (imageKey) nextSelectedImageKeys.add(`${loadedItem.selectionKey}::${imageKey}`);
      });
      const storefrontUrls = [
        state.storefrontProduct?.imageUrl,
        ...(state.storefrontProduct?.imageUrls || []),
      ];
      storefrontUrls.forEach(url => {
        const imageKey = imageKeyFromUrl(String(url || '').trim());
        if (imageKey) nextSelectedImageKeys.add(`${loadedItem.selectionKey}::${imageKey}`);
      });
    });

    state.loadedItems = Array.from(nextLoaded.values());
    state.selectedImageKeys = Array.from(nextSelectedImageKeys);
    // Auto-select the most recently loaded item so it's visible immediately
    if (newestSelectionKey) {
      state.activeItemKey = newestSelectionKey;
    } else if (!state.activeItemKey && state.loadedItems[0]?.selectionKey) {
      state.activeItemKey = state.loadedItems[0].selectionKey;
    }
  };

  const syncUi = () => {
    renderSearchResults();
    renderBasket();
    renderLoadedItems();
    renderItemFilter();
    renderSectionFilter();
    renderImages();
    renderRows();
    renderProductOverview();
    updateFlowSteps();
  };

  window.addEventListener('openpaint:measurement-split-workspace-change', () => {
    scheduleMeasurementWorkspacePaneSync();
  });
  window.addEventListener('openpaint:guide-split-changed', () => {
    scheduleMeasurementWorkspacePaneSync();
  });
  window.addEventListener('openpaint:guide-split-pane-rendered', () => {
    scheduleMeasurementWorkspacePaneSync();
  });
  window.addEventListener('openpaint:guide-next-tag-changed', event => {
    // CW arming always calls renderRows itself. Rebuilding here as well made a
    // visible Library row move twice for one click, which produced the small
    // upward scroll hop while selecting Draw.
    if ((event as CustomEvent<{ source?: string }>).detail?.source !== 'cw-import') {
      renderRows();
    }
    scheduleMeasurementWorkspacePaneSync();
  });
  window.addEventListener('openpaint:view-switched', () => {
    syncWorkspaceGuideSeed(getCurrentScopeLabel(), { render: true });
    scheduleMeasurementWorkspacePaneSync();
  });
  window.addEventListener('openpaint:frame-tab-changed', () => {
    syncWorkspaceGuideSeed(getCurrentScopeLabel(), { render: true });
    scheduleMeasurementWorkspacePaneSync();
  });
  window.addEventListener('openpaint:elements-list-rebuilt', () => {
    const armedRowKey = getScopedArmedRowKey(getCurrentScopeLabel());
    if (armedRowKey) {
      keepLibraryRowVisible(armedRowKey, { useSavedSlot: true });
    }
  });

  const runSearch = async () => {
    const search = (searchTermEl?.value || '').trim();

    if (!search) {
      setStatus('Enter a product search term.', 'bad');
      return;
    }

    state.searchResults = [];
    state.basket = [];
    state.loadedItems = [];
    state.activeItemKey = '';
    state.activeSection = '';
    state.armedRowKey = '';
    state.armedRowKeyByScope = {};
    state.readyRowKeyByScope = {};
    state.readyLabelByScope = {};
    state.activeDrawIntentByScope = {};
    state.completedLabelsByScope = {};
    state.completedRowKeysByScope = {};
    state.selectedImageKeys = [];
    state.rowTargetLabels = {};
    state.rowOriginalValues = {};
    state.rowValueOverrides = {};
    state.rowValueInvalid = {};
    state.storefrontProduct = null;
    syncUi();

    // Show the suffix hint without blocking the public dimensions request.
    if (/__[A-Z]{1,4}$/i.test(search)) {
      const base = search.replace(/__[A-Za-z0-9._-]+$/, '');
      if (base) {
        setStatus(
          `Tip: just type the base reference (e.g. ${base}) — variants are auto-detected`,
          'info'
        );
      }
    }

    setProbeButtonsDisabled(true);
    setStatus('Searching CW products and configuration options...');
    setLoadProgress(8, 'Finding product', 'Searching Comfort Works');
    resultMeta.classList.add('searching-pulse');
    void loadPublicOverallDimensions(search);
    void loadStorefrontProduct(search);

    try {
      const { response, data, rawText, contentType, jsonParseError, cached } =
        await requestSearchPayload(search, '', { phase: 'discover', probeMode: 'turbo' });
      setLoadProgress(
        34,
        'Product found',
        cached ? 'Using recent result' : 'Checking available versions'
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
        product: null,
        summary: data?.summary || null,
        results: data?.results || [],
      } as Record<string, unknown>;
      if (probeModeAvailable && probeEnabledEl?.checked) {
        lastProbeReport = probeReport;
        persistUiState();
        renderProbeReport();
      }
      const results = Array.isArray(data?.results) ? data.results : [];
      state.searchResults = results.map((item: any) => {
        const styleOptions = Array.isArray(item?.styleOptions) ? item.styleOptions : [];
        const versionOptions: VersionOption[] = Array.isArray(item?.versionOptions)
          ? item.versionOptions
          : [];
        return {
          id: item?.id || null,
          productReference: String(item?.productReference || item?.product?.reference || '').trim(),
          productName: String(
            item?.productName || item?.product?.translations?.[0]?.name || ''
          ).trim(),
          status: item?.status || item?.product?.status || null,
          translations: Array.isArray(item?.translations) ? item.translations : [],
          configParsed: item?.configParsed === true,
          versionOptions,
          styleOptions,
          derivedScopedReferences: Array.isArray(item?.derivedScopedReferences)
            ? item.derivedScopedReferences
            : [],
          selected: false,
          selectedVersionCode: '',
          selectedStyleKey: '',
        } as SearchResultItem;
      });
      const normalizedSearch = search.toUpperCase().replace(/\s+/g, '');
      const preferredResult =
        state.searchResults.find(
          item => item.productReference.toUpperCase().replace(/\s+/g, '') === normalizedSearch
        ) ||
        state.searchResults[0] ||
        null;
      if (preferredResult) {
        state.searchResults.forEach(item => {
          item.selected = item === preferredResult;
        });
        void loadStorefrontProduct(
          preferredResult.productName || search,
          preferredResult.productReference
        );
      }
      // Annotate version options with confirmed status from QC measurement attempts
      const qcAttempts: Array<{ productReference?: string; ok?: boolean }> = Array.isArray(
        data?.qcMeasurementAttempts
      )
        ? data.qcMeasurementAttempts
        : [];
      if (qcAttempts.length > 0) {
        const attemptByRef = new Map(
          qcAttempts.map(a => [(a.productReference || '').trim(), Boolean(a.ok)])
        );
        state.searchResults.forEach(item => {
          item.versionOptions.forEach(opt => {
            const scopedRef = opt.scopedReference || `${item.productReference}__${opt.code}`;
            if (attemptByRef.has(scopedRef)) {
              opt.confirmed = attemptByRef.get(scopedRef) ?? null;
            }
          });
        });
      }

      state.armedRowKey = '';
      state.armedRowKeyByScope = {};
      state.activeSection = '';
      // Extract discovery image URLs for preview thumbnails
      const baseUrl = (baseUrlEl?.value || '').trim();
      state.discoveryImageUrls = extractImageUrls(data, baseUrl)
        .filter(url => /storage\.googleapis\.com/i.test(url) && /Signature=/i.test(url))
        .slice(0, 8);

      syncUi();
      if (response.ok && preferredResult) {
        setStatus(
          `Found ${preferredResult.productReference}. Choose its configuration and style to load photos and CW40 measurements.`,
          'info'
        );
        setLoadProgress(100, 'Choose configuration', 'Nothing has been selected automatically', {
          complete: true,
        });
      } else {
        setLoadProgress(
          100,
          response.ok ? 'Choose a product' : 'Search failed',
          response.ok
            ? `${state.searchResults.length} possible matches`
            : 'Check the connection details',
          { complete: response.ok }
        );
        setStatus(
          response.ok
            ? `Found ${state.searchResults.length} possible products. Choose the exact sofa to load its photos and measurements.`
            : `Search failed: ${String(data?.message || data?.code || response.status)}`,
          response.ok ? 'ok' : 'bad'
        );
      }
      if (response.ok) {
        const loginDetails = body.querySelector<HTMLDetailsElement>('#cwLoginDetails');
        if (loginDetails) loginDetails.open = false;
      }
    } catch (error) {
      if (probeModeAvailable && probeEnabledEl?.checked) {
        lastProbeReport = {
          at: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error),
        };
        persistUiState();
        renderProbeReport();
      }
      setLoadProgress(100, 'Search failed', 'Please try again');
      setStatus(
        `Search request failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'bad'
      );
    } finally {
      resultMeta.classList.remove('searching-pulse');
      setProbeButtonsDisabled(false);
    }
  };

  const addSelectedToBasket = () => {
    const selectedResults = state.searchResults.filter(item => item.selected);
    if (!selectedResults.length) {
      setStatus('Select at least one search result before adding to the basket.', 'bad');
      return;
    }

    const basketByKey = new Map(state.basket.map(item => [item.selectionKey, item]));
    selectedResults.forEach(item => {
      const basketItem = buildBasketItemFromResult(item);
      if (basketItem) basketByKey.set(basketItem.selectionKey, basketItem);
    });
    state.basket = Array.from(basketByKey.values());
    renderBasket();
    setStatus(
      `Added ${selectedResults.length} item selection${selectedResults.length === 1 ? '' : 's'} to the basket.`,
      'ok'
    );
  };

  const loadSelectedBasketItems = async () => {
    const selectedResults = state.searchResults.filter(item => item.selected);
    const basketByKey = new Map(state.basket.map(item => [item.selectionKey, item]));
    selectedResults.forEach(item => {
      const basketItem = buildBasketItemFromResult(item);
      if (basketItem) {
        basketByKey.set(basketItem.selectionKey, basketItem);
      }
    });
    const nextBasket = Array.from(basketByKey.values());

    if (!nextBasket.length) {
      setStatus('Select at least one item or add something to the basket before loading.', 'bad');
      return;
    }

    state.basket = nextBasket;
    renderBasket();

    searchBtn.disabled = true;
    if (addSelectedBtn) addSelectedBtn.disabled = true;
    loadSelectedBtn.disabled = true;
    setStatus(`Loading ${nextBasket.length} basket item${nextBasket.length === 1 ? '' : 's'}...`);
    try {
      const { response, data } = await requestSearchPayload(
        (searchTermEl?.value || '').trim(),
        '',
        { phase: 'load-selected', selectedItems: nextBasket }
      );
      const items = Array.isArray(data?.items) ? data.items : [];
      integrateLoadedItems(items);
      syncUi();
      setStatus(
        response.ok
          ? `Loaded ${Number(data?.summary?.loadedCount || items.length)} item${Number(data?.summary?.loadedCount || items.length) === 1 ? '' : 's'} with photos. Select images below and click Import Photos.`
          : `Load failed: ${String(data?.message || data?.code || response.status)}`,
        response.ok ? 'ok' : 'bad'
      );
      // Auto-scroll to images if any were loaded
      if (response.ok && imagesWrap.children.length > 0) {
        requestAnimationFrame(() =>
          imagesWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        );
      }
    } catch (error) {
      setStatus(
        `Load selected failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'bad'
      );
    } finally {
      searchBtn.disabled = false;
      if (addSelectedBtn) addSelectedBtn.disabled = false;
      loadSelectedBtn.disabled = false;
    }
  };

  searchBtn.addEventListener('click', () => {
    void runSearch();
  });
  searchTermEl.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
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
    runBulkProbeBtn.addEventListener('click', () => {
      void (async () => {
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
      })();
    });
  }

  if (runStagedProbeBtn) {
    runStagedProbeBtn.addEventListener('click', () => {
      void (async () => {
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
            const stage = await runProbeTerms(
              stageTerms,
              `Stage ${stageIndex + 1} (${stageName})`,
              {
                initialConcurrency: PROBE_DEFAULT_CONCURRENCY,
                adaptiveConcurrency: true,
                minConcurrency: PROBE_MIN_CONCURRENCY,
                maxConcurrency: PROBE_MAX_CONCURRENCY,
                probeMode: 'default',
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
      })();
    });
  }

  if (runTurboStagedProbeBtn) {
    runTurboStagedProbeBtn.addEventListener('click', () => {
      void (async () => {
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
      })();
    });
  }

  if (copyProbeBtn) {
    copyProbeBtn.addEventListener('click', () => {
      void (async () => {
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
      })();
    });
  }

  if (loadProbeTermsBtn) {
    loadProbeTermsBtn.addEventListener('click', () => {
      void (async () => {
        const selectedFile = probeTermsFileEl?.files?.[0] || null;
        const filePath = (probeTermsPathEl?.value || '').trim();
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
            if (!(searchTermEl?.value || '').trim() && parsed.terms[0]) {
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
            ? (data.terms as unknown[])
                .map(item => (typeof item === 'string' ? item.trim() : ''))
                .filter(Boolean)
            : [];
          probeTermsEl.value = terms.join('\n');
          if (!(searchTermEl?.value || '').trim() && terms[0]) {
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
      })();
    });
  }

  if (addSelectedBtn) addSelectedBtn.addEventListener('click', addSelectedToBasket);
  loadSelectedBtn.addEventListener('click', () => {
    void loadSelectedBasketItems();
  });

  itemFilterEl.addEventListener('change', () => {
    setActiveLoadedItem((itemFilterEl.value || '').trim());
  });

  const clearBasketBtn = body.querySelector<HTMLButtonElement>('#cwClearBasketBtn');
  clearBasketBtn?.addEventListener('click', () => {
    state.basket = [];
    state.loadedItems = [];
    state.activeItemKey = '';
    state.activeSection = '';
    state.selectedImageKeys = [];
    state.importedViewMetaByScope = {};
    state.searchResults.forEach(item => {
      item.selected = false;
    });
    syncUi();
    setStatus('Cleared basket and loaded items.', 'info');
  });

  sectionFilterEl.addEventListener('change', () => {
    state.activeSection = normalizeSectionName((sectionFilterEl.value || '').trim());
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

  useMeasurementsBtn.addEventListener('click', () => {
    const scopeLabel = getCurrentScopeLabel();
    const availableRows = visibleRows();
    if (!availableRows.length) {
      setStatus('This product has no loaded measurements to use.', 'bad');
      return;
    }

    const inferredSection =
      state.activeSection ||
      normalizeSectionName(sectionFromImageName(scopeLabel)) ||
      normalizeSectionName(availableRows[0]?.sectionName || '');
    const sectionRows = inferredSection
      ? availableRows.filter(row => normalizeSectionName(row.sectionName || '') === inferredSection)
      : availableRows;
    const rowsForImage = sectionRows.length ? sectionRows : availableRows;
    const activeItem =
      state.loadedItems.find(item => item.selectionKey === state.activeItemKey) ||
      state.loadedItems.find(item => item.success);

    getWorkspaceTagScopeKeys(scopeLabel).forEach(key => {
      delete state.completedLabelsByScope[key];
      delete state.completedRowKeysByScope[key];
    });
    seedImportedGuideForView(scopeLabel, inferredSection, rowsForImage, lockedEl.checked);
    state.importedViewMetaByScope[getCanonicalCwScopeKey(scopeLabel)] = {
      itemKey: activeItem?.selectionKey || rowsForImage[0]?.itemKey || '',
      sectionName: inferredSection,
    };
    if (typeof (window as any).setMeasurementGuideIndicatorVisible === 'function') {
      (window as any).setMeasurementGuideIndicatorVisible(true);
    }
    // Loading a library makes its rows available; it does not force the user
    // into a sequence. They choose the exact measurement they want to draw.
    syncWorkspaceGuideSeed(scopeLabel, { render: true, arm: false });
    overlay.style.display = 'none';
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
        getEffectiveRowValue(row),
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

  const fetchStorefrontImageDataUrl = async (url: string): Promise<string> => {
    const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!response.ok) throw new Error(`Image download failed (${response.status})`);
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('Image conversion failed'));
      reader.readAsDataURL(blob);
    });
  };

  const importCatalogueComparisonItem = async (
    item: CatalogueComparisonItem,
    index: number
  ): Promise<{ viewId: string; loadedItem: LoadedMeasurementItem | null }> => {
    const projectManager = (window as any).app?.projectManager;
    if (!projectManager) throw new Error('Project manager not available');

    const resolvedUrl = await fetchStorefrontImageDataUrl(item.imageUrl);
    const sideCode = item.codes.find(code => /^(?:L|R|LA|RA)$/i.test(code)) || '';
    const seed = slugify(`${item.productReference}${sideCode ? `-${sideCode}` : ''}`);
    const viewId = nextUniqueViewId(seed || `catalogue-${index + 1}`);
    const sideLabel = /^(?:L|LA)$/i.test(sideCode)
      ? 'Left arm'
      : /^(?:R|RA)$/i.test(sideCode)
        ? 'Right arm'
        : '';
    const displayName = [item.productReference, sideLabel, item.title]
      .map(value => String(value || '').trim())
      .filter(Boolean)
      .join(' · ');
    const fileName = `${displayName || item.productReference || `Catalogue ${index + 1}`}.jpg`;
    const addImageToSidebarFn = (window as any).addImageToSidebar;
    const addImageToGalleryCompatFn = (window as any).addImageToGalleryCompat;
    if (imageRegistry.isEnabled() && imageRegistry?.registerImage) {
      await imageRegistry.registerImage(viewId, resolvedUrl, fileName, {
        source: 'cw-catalogue-comparison',
        productReference: item.productReference,
        requestedSku: item.requestedSku,
        matchedSku: item.matchedSku,
        imageMatch: item.imageMatch,
      });
    } else {
      await projectManager.addImage(viewId, resolvedUrl, { refreshBackground: false });
      if (typeof addImageToSidebarFn === 'function') {
        addImageToSidebarFn(resolvedUrl, viewId, fileName);
      } else if (typeof addImageToGalleryCompatFn === 'function') {
        addImageToGalleryCompatFn({
          src: resolvedUrl,
          url: resolvedUrl,
          name: fileName,
          label: viewId,
          filename: fileName,
        });
      }
    }

    const loadedItem = upsertComparisonMeasurementItem(item);
    if (loadedItem) {
      const rows = getOverallDimensionSequence(loadedItem);
      seedImportedGuideForView(viewId, 'Frame Cover', rows, lockedEl.checked);
      state.importedViewMetaByScope[getCanonicalCwScopeKey(viewId)] = {
        itemKey: loadedItem.selectionKey,
        sectionName: 'Frame Cover',
      };
    }
    return { viewId, loadedItem };
  };

  comparisonItems.addEventListener('change', event => {
    const select = (event.target as HTMLElement | null)?.closest<HTMLSelectElement>(
      '[data-cw-comparison-option]'
    );
    if (!select) return;
    const itemIndex = Number(select.dataset.cwComparisonOption);
    const codeIndex = Number(select.dataset.cwComparisonCodeIndex);
    const currentItem = state.comparisonItems[itemIndex];
    if (!currentItem || !Number.isInteger(codeIndex) || codeIndex < 0) return;

    const nextCodes = [...currentItem.codes];
    nextCodes[codeIndex] = select.value;
    const nextRequest: CatalogueComparisonRequestItem = {
      kind: currentItem.kind,
      productReference: currentItem.productReference,
      title: currentItem.title,
      url: currentItem.url,
      handle: currentItem.handle,
      codes: nextCodes,
      fabricCode: currentItem.fabricCode,
      styleName: currentItem.styleName,
      fabricName: currentItem.fabricName,
    };
    const changedGroup = currentItem.configurationGroups?.find(
      group => group.codeIndex === codeIndex
    );
    const selectedOption = changedGroup?.options.find(option => option.code === select.value);
    if (changedGroup?.label === 'Fabric') {
      nextRequest.fabricCode = select.value;
      nextRequest.fabricName = selectedOption?.label || currentItem.fabricName;
      if (nextRequest.kind === 'fabric-sample') nextRequest.title = nextRequest.fabricName;
    } else if (changedGroup?.label === 'Style') {
      nextRequest.styleName = selectedOption?.label || currentItem.styleName;
    }
    const card = select.closest<HTMLElement>('.cw-comparison-item');
    card?.classList.add('is-refreshing');
    Array.from(card?.querySelectorAll('select, button') || []).forEach(control => {
      (control as HTMLInputElement | HTMLButtonElement).disabled = true;
    });
    comparisonStatus.textContent = `Updating ${currentItem.productReference}...`;

    void (async () => {
      try {
        const { response, data } = await requestSearchPayload('', '', {
          phase: 'storefront-comparison',
          comparisonItems: [nextRequest],
        });
        const resolvedItem = Array.isArray(data?.items) ? data.items[0] : null;
        if (!response.ok || !resolvedItem) {
          throw new Error(data?.message || `Catalogue request failed (${response.status})`);
        }
        state.comparisonItems[itemIndex] = normalizeComparisonResponseItem(resolvedItem);
        renderComparisonItems();
        comparisonStatus.textContent = `${currentItem.productReference} updated. Other products were left unchanged.`;
      } catch (error) {
        renderComparisonItems();
        comparisonStatus.textContent = `Could not update ${currentItem.productReference}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`;
      }
    })();
  });

  comparisonItems.addEventListener('click', event => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>(
      '[data-cw-comparison-draw]'
    );
    if (!button) return;
    const itemIndex = Number(button.dataset.cwComparisonDraw);
    const item = state.comparisonItems[itemIndex];
    if (!item?.imageUrl) return;

    void (async () => {
      button.disabled = true;
      const originalLabel = button.textContent || 'Add + draw dimensions';
      button.textContent = 'Adding...';
      comparisonStatus.textContent = `Preparing ${item.productReference} for drawing...`;
      try {
        const { viewId, loadedItem } = await importCatalogueComparisonItem(item, itemIndex);
        if (!loadedItem) {
          overlay.style.display = 'none';
          await waitForImportedViewReady(viewId);
          comparisonStatus.textContent = `${item.title || item.productReference} added to SofaPaint.`;
          setStatus(comparisonStatus.textContent, 'ok');
          return;
        }
        state.activeItemKey = loadedItem.selectionKey;
        state.activeSection = '';
        await enableGuideWorkflowDefaults(viewId);
        await waitForImportedViewReady(viewId);
        syncWorkspaceGuideSeed(viewId, { render: true, arm: true });
        overlay.style.display = 'none';
        openMeasurementSplitWorkspace(viewId);
        setStatus(
          `Added ${item.productReference}. Width, Depth, and Height are ready in split view.`,
          'ok'
        );
      } catch (error) {
        comparisonStatus.textContent = `Could not prepare ${item.productReference}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`;
        setStatus(comparisonStatus.textContent, 'bad');
      } finally {
        button.disabled = false;
        button.textContent = originalLabel;
      }
    })();
  });

  importComparisonBtn.addEventListener('click', () => {
    void (async () => {
      const readyItems = state.comparisonItems.filter(item => item.imageUrl).slice(0, 8);
      const projectManager = (window as any).app?.projectManager;
      if (readyItems.length < 1 || !projectManager) {
        comparisonStatus.textContent = 'At least one catalogue photo is needed.';
        return;
      }
      importComparisonBtn.disabled = true;
      const originalLabel = importComparisonBtn.textContent || 'Add to SofaPaint';
      const importedLabels: string[] = [];
      try {
        for (let index = 0; index < readyItems.length; index += 1) {
          const item = readyItems[index];
          importComparisonBtn.textContent = `Adding ${index + 1}/${readyItems.length}...`;
          comparisonStatus.textContent = `Downloading ${item.productReference}...`;
          const { viewId } = await importCatalogueComparisonItem(item, index);
          importedLabels.push(viewId);
        }
        overlay.style.display = 'none';
        comparisonStatus.textContent =
          importedLabels.length === 1
            ? 'Catalogue image added to SofaPaint.'
            : `${importedLabels.length} products added to comparison.`;
        if (importedLabels.length > 1) {
          window.setTimeout(() => {
            window.dispatchEvent(
              new CustomEvent('openpaint:compare-images', {
                detail: { labels: importedLabels, replace: true },
              })
            );
          }, 120);
        }
        setStatus(
          importedLabels.length === 1
            ? 'Added catalogue image to SofaPaint.'
            : `Added ${importedLabels.length} catalogue products to comparison.`,
          'ok'
        );
      } catch (error) {
        comparisonStatus.textContent = `Import stopped: ${error instanceof Error ? error.message : 'Unknown error'}`;
        setStatus(comparisonStatus.textContent, 'bad');
      } finally {
        importComparisonBtn.disabled = false;
        importComparisonBtn.textContent = originalLabel;
      }
    })();
  });

  importStorefrontImageBtn.addEventListener('click', () => {
    void (async () => {
      const imageUrl = state.storefrontProduct?.imageUrl || '';
      if (!imageUrl) {
        setStatus('No storefront product image is available.', 'bad');
        return;
      }
      const projectManager = (window as any).app?.projectManager;
      if (!projectManager) {
        setStatus('Project manager not available.', 'bad');
        return;
      }

      importStorefrontImageBtn.disabled = true;
      const idleButtonLabel = importStorefrontImageBtn.textContent || 'Add image + draw dimensions';
      importStorefrontImageBtn.textContent = 'Downloading image...';
      setLoadProgress(12, 'Downloading image', 'Using the full product photo');
      try {
        const activeItem =
          state.loadedItems.find(
            item => item.success && item.selectionKey === state.activeItemKey
          ) ||
          state.loadedItems.find(item => item.success) ||
          null;
        const resolvedUrl = await fetchStorefrontImageDataUrl(imageUrl);
        const seed = slugify(state.storefrontProduct?.title || 'cw-product') || 'cw-product';
        const viewId = nextUniqueViewId(seed);
        const fileName = `${viewId}.jpg`;
        const addImageToSidebarFn = (window as any).addImageToSidebar;
        const addImageToGalleryCompatFn = (window as any).addImageToGalleryCompat;

        if (imageRegistry.isEnabled() && imageRegistry?.registerImage) {
          await imageRegistry.registerImage(viewId, resolvedUrl, fileName, {
            source: 'cw-storefront',
          });
        } else {
          await projectManager.addImage(viewId, resolvedUrl, { refreshBackground: false });
          if (typeof addImageToSidebarFn === 'function') {
            addImageToSidebarFn(resolvedUrl, viewId, fileName);
          } else if (typeof addImageToGalleryCompatFn === 'function') {
            addImageToGalleryCompatFn({
              src: resolvedUrl,
              url: resolvedUrl,
              name: fileName,
              label: viewId,
              filename: fileName,
            });
          }
        }

        importStorefrontImageBtn.textContent = 'Preparing canvas...';
        setLoadProgress(58, 'Preparing canvas', 'Centering the image and drawing area');
        await enableGuideWorkflowDefaults(viewId);
        await waitForImportedViewReady(viewId);
        setLoadProgress(88, 'Preparing dimensions', 'Width, Depth, Height');
        const dimensionQueue = prepareOverallDimensionChoices(activeItem);
        const dimensionRows = getOverallDimensionSequence(activeItem);
        if (dimensionRows.length) {
          seedImportedGuideForView(viewId, 'Frame Cover', dimensionRows, lockedEl.checked);
          state.importedViewMetaByScope[getCanonicalCwScopeKey(viewId)] = {
            itemKey: activeItem?.selectionKey || dimensionRows[0].itemKey,
            sectionName: 'Frame Cover',
          };
          syncWorkspaceGuideSeed(viewId, { render: true, arm: true });
        }
        overlay.style.display = 'none';
        setLoadProgress(100, 'Ready to draw', dimensionQueue.count ? 'Draw Width' : 'Image added', {
          complete: true,
        });
        setStatus(
          dimensionQueue.count
            ? `Added ${state.storefrontProduct?.title || 'product image'}. Draw Width, then continue through Depth and Height.`
            : `Added ${state.storefrontProduct?.title || 'product image'} to the project.`,
          'ok'
        );
      } catch (error) {
        setStatus(
          `Could not add the product image: ${error instanceof Error ? error.message : 'Unknown error'}`,
          'bad'
        );
      } finally {
        importStorefrontImageBtn.disabled = false;
        importStorefrontImageBtn.textContent = idleButtonLabel;
      }
    })();
  });

  /** First direct catalogue URL from an import candidate group. */
  const firstCatalogueImageUrl = (group: string[]): string =>
    group.find(url => /^https?:\/\//i.test(url || '')) || '';

  const resolveCatalogueImageUrlForScope = (scopeLabel: string): string => {
    const canonical = getCanonicalCwScopeKey(scopeLabel);
    const meta = state.importedViewMetaByScope[canonical];
    const itemKey = meta?.itemKey || '';
    const loadedItem = itemKey
      ? state.loadedItems.find(item => item.selectionKey === itemKey)
      : null;
    return firstCatalogueImageUrl(loadedItem?.imageUrls || []);
  };

  const isCwImportedScope = (scopeLabel: string): boolean => {
    const canonical = getCanonicalCwScopeKey(scopeLabel);
    if (state.importedViewMetaByScope[canonical]) return true;
    const store = (window as any).cwImportedMeasurementsByImage?.[canonical];
    return Boolean(store && typeof store === 'object' && Object.keys(store).length > 0);
  };

  /**
   * Draw a stored line-library recipe onto the active view: create the line,
   * attach metadata, apply the saved measurement, and mark matching CW rows
   * completed so the queue advances exactly like a manual draw.
   */
  const replayCwLibraryLinesForView = (
    viewId: string,
    imageUrl: string,
    sectionRows: VisibleImportedRow[]
  ): { drawn: number; labels: string[] } | null => {
    const w = window as any;
    const fabric = w.fabric;
    const metadata = w.app?.metadataManager;
    const canvas = w.app?.canvasManager?.fabricCanvas;
    if (!fabric || !metadata || !canvas) return null;

    const usedLabels = getStrokeLabels(viewId);
    const usedLabelSet = new Set<string>(usedLabels);
    const plans = buildReplayPlan(imageUrl, usedLabelSet);
    if (!plans) return null;

    const drawnLabels: string[] = [];
    plans.forEach(plan => {
      const label = resolveNextAvailableCwLabel(plan.label, usedLabelSet);
      const line = new fabric.Line([plan.start.x, plan.start.y, plan.end.x, plan.end.y], {
        strokeWidth: 2,
        stroke: '#3b82f6',
        originX: 'center',
        originY: 'center',
        lineStyle: 'solid',
        selectable: true,
        evented: true,
        perPixelTargetFind: true,
        padding: 8,
        objectCaching: false,
      });
      if (w.app?.arrowManager?.applyArrows) {
        w.app.arrowManager.applyArrows(line);
      }
      canvas.add(line);
      FabricControls.createLineControls(line);
      line.setCoords?.();
      metadata.attachMetadata(line, viewId, label);
      const applied = applyMeasurement(
        viewId,
        label,
        plan.value,
        plan.sourceLabel,
        lockedEl.checked
      );
      if (applied) {
        const seeded = getCwImportedMeasurementEntry(viewId, label);
        if (seeded) {
          markCwImportedMeasurementApplied(viewId, label, seeded);
        }
        markWorkspaceLabelCompleted(viewId, label);
      }
      drawnLabels.push(label);
      usedLabelSet.add(label);

      // Mark any CW row this line satisfies so the queue skips it.
      sectionRows.forEach(row => {
        const rowKey = row.rowKey || '';
        if (!rowKey || state.completedRowKeysByScope?.[getCanonicalCwScopeKey(viewId)]?.[rowKey]) {
          return;
        }
        const rowTarget = resolveRowTargetLabel(row, state.rowTargetLabels[rowKey] || '');
        const sourceMatch =
          normalizeGuideLabel(row.sourceLabel) === normalizeGuideLabel(plan.sourceLabel);
        if (rowTarget === label || (sourceMatch && rowTarget === plan.label)) {
          markWorkspaceRowCompleted(viewId, rowKey);
        }
      });

      const createdLine = line;
      setTimeout(() => {
        w.app?.tagManager?.createTagForStroke?.(label, viewId, createdLine);
      }, 50);
    });

    canvas.requestRenderAll?.();
    w.app?.historyManager?.saveState?.({ force: true, reason: 'cw-line-library:replay' });
    return { drawn: drawnLabels.length, labels: drawnLabels };
  };

  importPhotosBtn.addEventListener('click', () => {
    void (async () => {
      const selectedEntries = selectedImageEntries();
      if (!selectedEntries.length) {
        setStatus('Select at least one photo to import.', 'bad');
        return;
      }

      const projectManager = (window as any).app?.projectManager;
      if (!projectManager) {
        setStatus('Project manager not available.', 'bad');
        return;
      }

      importPhotosBtn.disabled = true;
      let imported = 0;
      let seededViews = 0;
      let firstImportedViewId = '';
      const autoDrawTargets: Array<{
        viewId: string;
        imageUrl: string;
        sectionRows: VisibleImportedRow[];
      }> = [];
      try {
        const baseUrl = (baseUrlEl?.value || '').trim();
        const username = (usernameEl?.value || '').trim();
        const password = passwordEl?.value || '';

        for (const entry of selectedEntries) {
          const section = entry.section;
          const group = entry.candidates;
          const loadedItem = state.loadedItems.find(item => item.selectionKey === entry.itemKey);

          // Always prefer proxied data URL for canvas import to avoid cross-origin
          // Fabric.js loading failures on remote hosts without CORS headers.
          // eslint-disable-next-line no-await-in-loop
          let resolvedUrl = await fetchProxyImageDataUrl(group, baseUrl, username, password);
          if (!resolvedUrl) {
            const fallbackDirect =
              group.find(
                url => loadedItem?.imageUrls.includes(url) && shouldUseDirectImageUrl(url)
              ) || '';
            if (!isHttpUrl(fallbackDirect)) {
              resolvedUrl = fallbackDirect;
            }
          }
          if (!resolvedUrl) continue;

          const sectionSlug = slugify(section) || 'section';
          const imageSlug = slugify(makeViewIdFromUrl(group[0] || '')) || 'photo';
          const seed = `${slugify(entry.itemKey) || 'cw'}-${sectionSlug}-${imageSlug}`;
          const viewId = nextUniqueViewId(seed);
          const fileName = `${viewId}.jpg`;
          const addImageToSidebarFn = (window as any).addImageToSidebar;
          const addImageToGalleryCompatFn = (window as any).addImageToGalleryCompat;
          const registryEnabled = imageRegistry.isEnabled();

          if (registryEnabled && imageRegistry?.registerImage) {
            console.log('[CW Import] register via imageRegistry', { viewId, fileName });
            await imageRegistry.registerImage(viewId, resolvedUrl, fileName, {
              source: 'cw-import',
            });
          } else if (typeof addImageToSidebarFn === 'function') {
            // addImageToSidebar (both __galleryHooked and __isCompat) handles
            // gallery AND #imageList sidebar, so prefer it over addImageToGalleryCompat
            // which only populates the gallery.
            console.log('[CW Import] register via addImageToSidebar', {
              viewId,
              fileName,
              hooked: Boolean(addImageToSidebarFn.__galleryHooked),
              compat: Boolean(addImageToSidebarFn.__isCompat),
            });
            await projectManager.addImage(viewId, resolvedUrl, { refreshBackground: false });
            addImageToSidebarFn(resolvedUrl, viewId, fileName);
          } else {
            console.log('[CW Import] register via projectManager fallback', {
              viewId,
              fileName,
            });
            await projectManager.addImage(viewId, resolvedUrl, { refreshBackground: false });
            if (typeof addImageToGalleryCompatFn === 'function') {
              addImageToGalleryCompatFn({
                src: resolvedUrl,
                url: resolvedUrl,
                name: fileName,
                label: viewId,
                filename: fileName,
              });
            }
          }
          if (!firstImportedViewId) {
            firstImportedViewId = viewId;
          }
          const sectionRows = (loadedItem?.rows || [])
            .filter(
              row =>
                normalizeSectionName((row.sectionName || '').trim()) ===
                normalizeSectionName(section)
            )
            .map(row => ({
              ...row,
              rowKey: makeRowStorageKey(entry.itemKey, row.id),
              itemKey: entry.itemKey,
              itemLabel: entry.itemLabel,
              productReference: entry.productReference,
            }));
          getWorkspaceTagScopeKeys(viewId).forEach(key => {
            delete state.completedLabelsByScope[key];
            delete state.completedRowKeysByScope[key];
          });
          const seededCount = seedImportedGuideForView(
            viewId,
            section,
            sectionRows,
            lockedEl.checked
          );
          state.importedViewMetaByScope[getCanonicalCwScopeKey(viewId)] = {
            itemKey: entry.itemKey,
            sectionName: normalizeSectionName(section),
          };
          if (seededCount > 0) {
            seededViews += 1;
          }
          const catalogueImageUrl = firstCatalogueImageUrl(group);
          if (catalogueImageUrl && hasRecipeForImageUrl(catalogueImageUrl)) {
            autoDrawTargets.push({ viewId, imageUrl: catalogueImageUrl, sectionRows });
          }
          imported += 1;
        }

        if (imported === 0) {
          setStatus('Could not resolve any importable photos for the selected images.', 'bad');
          return;
        }

        if (typeof (window as any).ensureImageListObserver === 'function') {
          (window as any).ensureImageListObserver();
        } else {
          (window as any).__pendingImageListObserverInit = true;
        }
        if (typeof (window as any).updatePills === 'function') {
          (window as any).updatePills();
        }
        if (typeof (window as any).updateActivePill === 'function') {
          (window as any).updateActivePill();
        }

        // Auto-draw saved line-library recipes. Each target view is activated
        // briefly so the strokes land on the right background, then the
        // existing guide workflow below restores the first imported view.
        let autoDrawnLines = 0;
        let autoDrawnViews = 0;
        if (autoDrawTargets.length) {
          for (const target of autoDrawTargets) {
            try {
              await projectManager.switchView(target.viewId, true);
              await waitForImportedViewReady(target.viewId, 6000);
              setReplayInProgress(true);
              const result = replayCwLibraryLinesForView(
                target.viewId,
                target.imageUrl,
                target.sectionRows
              );
              setReplayInProgress(false);
              if (result && result.drawn > 0) {
                autoDrawnLines += result.drawn;
                autoDrawnViews += 1;
                syncWorkspaceGuideSeed(target.viewId);
              }
            } catch (error) {
              setReplayInProgress(false);
              console.warn('[CW Import] Line-library auto-draw failed', target.viewId, error);
            }
          }
          syncCompactCwQueueDock();
          renderRows();
        }

        await enableGuideWorkflowDefaults(firstImportedViewId);
        if (firstImportedViewId) {
          syncWorkspaceGuideSeed(firstImportedViewId);
        }
        overlay.style.display = 'none';
        renderRows();
        setStatus(
          `Imported ${imported} selected photo${imported === 1 ? '' : 's'} into project views, seeded ${seededViews} guide${seededViews === 1 ? '' : 's'}, and switched units to cm.` +
            (autoDrawnViews
              ? ` Auto-drew ${autoDrawnLines} saved line${autoDrawnLines === 1 ? '' : 's'} across ${autoDrawnViews} photo${autoDrawnViews === 1 ? '' : 's'} from your line library.`
              : ''),
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
    })();
  });

  window.addEventListener('openpaint:stroke-created', event => {
    const detail = (event as CustomEvent)?.detail || {};
    const strokeLabel = String(detail?.strokeLabel || '').trim();
    const imageLabel = String(detail?.imageLabel || '').trim();
    if (!strokeLabel || !imageLabel) return;

    // Any stroke committed on a CW-imported photo updates that photo's saved
    // line recipe (debounced), so manual drawing keeps the library current.
    if (!isReplayInProgress() && isCwImportedScope(imageLabel)) {
      scheduleCaptureForView(imageLabel, () => resolveCatalogueImageUrlForScope(imageLabel));
    }

    const scopedArmedRowKey = getScopedArmedRowKey(imageLabel);
    if (scopedArmedRowKey) {
      const armedRowKey = scopedArmedRowKey;
      // Read the immutable draw intent captured when this row was armed.
      // The global Next Tag field may already have advanced by the time
      // metadata dispatches this event.
      const armedTargetLabel = getScopedReadyDrawLabel(imageLabel, armedRowKey);
      // Consume the intent before doing any work. Metadata/tag refreshes can be
      // re-entrant and must never advance a second CW row with the same stroke.
      setScopedArmedRowKey(imageLabel, '');
      const row = allLoadedRows().find(item => item.rowKey === armedRowKey);
      if (!row) {
        renderRows();
        return;
      }

      const metadata = (window as any).app?.metadataManager;
      let targetLabel = strokeLabel;
      const configuredLabel = (state.rowTargetLabels[row.rowKey] || '').trim();
      const desiredLabel =
        normalizeGuideLabel(armedTargetLabel) ||
        resolveRowTargetLabel(row, configuredLabel, strokeLabel);
      if (metadata?.renameStrokeLabel && desiredLabel && desiredLabel !== strokeLabel) {
        const rename = metadata.renameStrokeLabel(imageLabel, strokeLabel, desiredLabel);
        if (rename?.ok && rename?.label) {
          targetLabel = rename.label;
        } else {
          renderRows();
          setStatus(`Failed to rename ${strokeLabel} to ${desiredLabel}.`, 'bad');
          return;
        }
      }

      const semanticDisplayLabel = isCwOverallDimensionRow(row)
        ? overallDimensionDisplayLabel(row.sourceLabel)
        : '';
      if (semanticDisplayLabel) {
        const scopedImageLabel = metadata?.normalizeImageLabel?.(imageLabel) || imageLabel;
        const strokeObject = metadata?.vectorStrokesByImage?.[scopedImageLabel]?.[targetLabel];
        if (strokeObject) {
          strokeObject.strokeMetadata = strokeObject.strokeMetadata || {};
          strokeObject.strokeMetadata.displayLabel = semanticDisplayLabel;
        }
      }

      const ok = applyMeasurement(
        imageLabel,
        targetLabel,
        getEffectiveRowValue(row),
        row.sourceLabel,
        lockedEl.checked
      );
      if (ok) {
        markWorkspaceLabelCompleted(imageLabel, targetLabel);
        markWorkspaceRowCompleted(imageLabel, armedRowKey);
        const seeded = getCwImportedMeasurementEntry(imageLabel, targetLabel);
        if (seeded) {
          markCwImportedMeasurementApplied(imageLabel, targetLabel, seeded);
        }
      }
      if (!ok) {
        renderRows();
        setStatus(`Failed to apply ${row.sourceLabel} to ${targetLabel}.`, 'bad');
        return;
      }

      // Let Fabric finish its mouse-up/commit stack, then continue through the
      // library without requiring another Draw click.
      window.setTimeout(() => {
        const metadata = (window as any).app?.metadataManager;
        if (metadata) {
          // CW Library owns the next focus target. The normal new-stroke
          // autofocus would otherwise switch back to Measure and pull the
          // Elements scroller away from the next Library row.
          metadata._shouldAutoFocus = false;
        }
        // A user may choose another Library row immediately after releasing
        // the line. Do not let this stroke's deferred auto-advance overwrite
        // that newer choice with the next row in sequence.
        if (getScopedArmedRowKey(imageLabel)) {
          renderRows();
          return;
        }
        const next = armNextMeasurementRow(armedRowKey);
        const nextRow = next.armed
          ? allLoadedRows().find(item => item.rowKey === next.rowKey)
          : null;
        if (nextRow) {
          setStatus(`Applied ${row.sourceLabel}. Draw ${nextRow.sourceLabel} next.`, 'ok');
        } else {
          setStatus(`Applied ${row.sourceLabel}. Measurement list complete.`, 'ok');
        }
      }, 0);
      return;
    }

    // No image-scoped Draw intent means this is an ordinary OpenPaint stroke.
    // Suggestions and legacy imported seeds must never assign measurements.
  });

  const close = () => {
    overlay.style.display = 'none';
  };

  renderProbeReport();
  syncUi();

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
    exactCmValue !== null ? `${exactCmValue} cm` : `${(value || '').trim()} cm`;

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
          inchValue: measurement.totalInches,
          inputUnit: 'cm',
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
      `Could not parse measurement value "${value}" for ${strokeLabel}`,
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
  const existingSource = w.cwImportedMeasurementsByImage[normalizedScope][strokeLabel] || {};
  w.cwImportedMeasurementsByImage[normalizedScope][strokeLabel] = {
    ...existingSource,
    source: 'cw',
    sourceLabel,
    value,
    originalValue: existingSource.originalValue || existingSource.value || value,
    locked: lockByDefault,
    updatedAt: new Date().toISOString(),
  };

  metadata.updateStrokeVisibilityControls?.();
  return true;
}

/** After "Assign Now", mark the label as used so the guide advances past it. */
function seedNextTagAfterAssign(scopeLabel: string, assignedLabel: string): void {
  const w = window as any;
  const metadata = w.app?.metadataManager;
  if (!metadata) return;
  const normalized = metadata.normalizeImageLabel
    ? metadata.normalizeImageLabel(scopeLabel)
    : scopeLabel;

  // Clear any manual override so the guide takes back control
  if (w.manualTagByImage) delete w.manualTagByImage[normalized];
  if (w.labelsByImage) delete w.labelsByImage[normalized];

  // Record as used — guide will auto-advance to the next unused role
  metadata.updateTagPredictionAfterUse?.(normalized, assignedLabel);
}

function openModal(): void {
  const modal = document.getElementById(MODAL_ID);
  if (!modal) return;
  modal.style.display = 'flex';
}

function parseImportedCentimeterValue(value: string): number | null {
  const normalized = (value || '').trim().replace(/,/g, '');
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

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tbtn';
  btn.id = 'cwImportBtn';
  btn.title = 'Search products & import measurements';
  btn.innerHTML = '<span class="label-long">CW Import</span><span class="label-short">CW</span>';
  btn.addEventListener('click', openModal);

  // Insert at the start of #tbRight so it's visible before auth/cloud buttons
  const tbRight = document.getElementById('tbRight');
  if (tbRight && tbRight.firstChild) {
    tbRight.insertBefore(btn, tbRight.firstChild);
    return;
  }
  // Fallback: append to whatever target exists
  const target = tbRight || document.getElementById('canvasControlsContent');
  if (target) target.appendChild(btn);
}

export function initCwImportUI(): void {
  ensureStyles();
  void initCwLineLibrary();
  installCwLineLibraryBridge();
  (window as any).isCwMeasurementLocked = (scopeLabel: string, strokeLabel: string) => {
    const locked = Boolean((window as any).cwMeasurementLocksByImage?.[scopeLabel]?.[strokeLabel]);
    if (!locked) return false;
    return !shouldAllowMeasurementSplitEdit(scopeLabel, strokeLabel);
  };
  if (!(window as any).setCwMeasurementLock) {
    (window as any).setCwMeasurementLock = setMeasurementLock;
  }

  const modal = createModal();
  document.body.appendChild(modal);
  attachToolbarButton();
}
