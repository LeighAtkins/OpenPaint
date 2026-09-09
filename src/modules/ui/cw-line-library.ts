/**
 * CW Line Library
 *
 * Reusable measurement-line recipes for Comfort Works catalogue photos.
 *
 * The first time measurement lines are drawn on an imported CW photo, the
 * strokes are captured as a "recipe" keyed by the catalogue image geometry
 * (product reference + component + sequence, with fabric/colour and style
 * variants normalized). The next time a photo with the same geometry is
 * imported, the stored lines replay automatically: same labels, same values,
 * same positions relative to the photo.
 *
 * Storage: localStorage always; mirrored through /api/cw-line-library
 * (local JSON file in dev, R2 object in production) so recipes survive
 * across browsers and devices.
 */

const STORAGE_KEY = 'cwLineLibrary:v1';
const API_ENDPOINT = '/api/cw-line-library';
const R2_LIBRARY_KEY = 'cw-line-library/v1.json';
const SAVE_DEBOUNCE_MS = 800;
const CAPTURE_DEBOUNCE_MS = 1200;

export interface CwLineRecipeLine {
  label: string;
  value: string;
  sourceLabel: string;
  /** Endpoints normalized to the background photo box (0..1). */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface CwGeometryKey {
  exactKey: string;
  looseKey: string;
  reference: string;
  styleCode: string;
  component: string;
  sequence: string;
  stem: string;
}

export interface CwLineRecipe {
  key: string;
  looseKey: string;
  reference: string;
  styleCode: string;
  component: string;
  sequence: string;
  imageUrl: string;
  lines: CwLineRecipeLine[];
  updatedAt: string;
}

interface CwLineLibraryState {
  recipes: Record<string, CwLineRecipe>;
  loaded: boolean;
  saveTimer: ReturnType<typeof setTimeout> | null;
  captureTimer: ReturnType<typeof setTimeout> | null;
  replayInProgress: boolean;
}

const state: CwLineLibraryState = {
  recipes: {},
  loaded: false,
  saveTimer: null,
  captureTimer: null,
  replayInProgress: false,
};

// ---------------------------------------------------------------------------
// Affine matrix helpers (avoid a hard runtime dependency on fabric.util)
// ---------------------------------------------------------------------------

type Matrix = [number, number, number, number, number, number];

function applyMatrix(matrix: Matrix, x: number, y: number): { x: number; y: number } {
  return {
    x: matrix[0] * x + matrix[2] * y + matrix[4],
    y: matrix[1] * x + matrix[3] * y + matrix[5],
  };
}

function invertMatrix(matrix: Matrix): Matrix {
  const [a, b, c, d, e, f] = matrix;
  const det = a * d - b * c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) {
    return [1, 0, 0, 1, 0, 0];
  }
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

// ---------------------------------------------------------------------------
// Geometry keys
// ---------------------------------------------------------------------------

const STYLE_PREFIXES = new Set(['VELC', 'SHRT', 'CNRP', 'LSKT', 'MLTP', 'BKPT', 'SDPT', 'ELAS']);
const STYLE_SUFFIXES = new Set(['SP', 'SI', 'PM', 'PC', 'WR']);
const VERSION_CODES = new Set([
  'L',
  'R',
  'STD',
  'EXD',
  'SV',
  'LV',
  'PB',
  'MG',
  'PTD',
  'DF',
  'VH',
  'VS',
]);

export function decodeCwImageUrl(url: string): string {
  const raw = (url || '').split('?')[0].split('#')[0];
  const file = raw.split('/').filter(Boolean).pop() || '';
  const stem = file.replace(/\.[a-z0-9]+$/i, '');
  try {
    return decodeURIComponent(stem);
  } catch {
    return stem;
  }
}

/**
 * Build a geometry key from a catalogue image URL.
 *
 * `IK-TD-2M__L(VELC_SP)_STCC_01` → exact `IK-TD-2M|VELC_SP|STCC|01`,
 * loose `IK-TD-2M|STCC|01`. The loose key lets one drawing serve every
 * style/fabric variant of the same cover component.
 */
export function buildCwGeometryKey(url: string): CwGeometryKey | null {
  const stem = decodeCwImageUrl(url);
  if (!stem) return null;

  const referenceMatch = /^([A-Z]{1,4}(?:-[A-Z0-9]+)+|[A-Z]{2,6}\d[A-Z0-9]*)(?![a-z])/.exec(stem);
  if (!referenceMatch) {
    return {
      exactKey: `stem:${stem}`,
      looseKey: `stem:${stem}`,
      reference: '',
      styleCode: '',
      component: '',
      sequence: '',
      stem,
    };
  }
  const reference = referenceMatch[1];
  let remainder = stem.slice(reference.length).replace(/^[_\-\s]+/, '');

  // Pull style code out of parenthesized groups first: __L(VELC_SP)_STCC_01
  let styleCode = '';
  const parenStyles: string[] = [];
  remainder = remainder.replace(/\(([^)]*)\)/g, (_all, inner: string) => {
    const innerUpper = (inner || '').toUpperCase();
    const styleMatch = /(?:VELC|SHRT|CNRP|LSKT|MLTP|BKPT|SDPT|ELAS)_[A-Z0-9]{1,6}/.exec(innerUpper);
    if (styleMatch) parenStyles.push(styleMatch[0]);
    return '';
  });
  if (parenStyles.length) {
    styleCode = parenStyles[0];
  }

  const tokens = remainder
    .split(/[_\-\s]+/)
    .map(token => token.trim().toUpperCase())
    .filter(Boolean);

  const kept: string[] = [];
  if (!styleCode) {
    for (const token of tokens) {
      if (STYLE_PREFIXES.has(token)) continue;
      if (STYLE_SUFFIXES.has(token) && !/^\d+$/.test(token)) continue;
      kept.push(token);
    }
  } else {
    for (const token of tokens) {
      if (STYLE_PREFIXES.has(token)) continue;
      if (STYLE_SUFFIXES.has(token) && !/^\d+$/.test(token)) continue;
      kept.push(token);
    }
  }

  // Drop leading version codes (L, R, STD, 34CM ...) and fabric-like tokens.
  // Bare digits are kept: they are component sequence numbers (_01).
  const structural = kept.filter(token => {
    if (VERSION_CODES.has(token)) return false;
    if (/^\d{4}-\d{4}$/.test(token)) return false;
    if (/^\d+(?:CM|MM|IN)$/i.test(token)) return false;
    return true;
  });

  // The component is the last all-letter token; sequence is a trailing number.
  let component = '';
  let componentIndex = -1;
  for (let i = structural.length - 1; i >= 0; i -= 1) {
    if (/^[A-Z]{2,8}$/.test(structural[i])) {
      component = structural[i];
      componentIndex = i;
      break;
    }
  }
  let sequence = '';
  if (componentIndex >= 0 && componentIndex + 1 < structural.length) {
    const next = structural[componentIndex + 1];
    if (/^\d{1,4}$/.test(next)) sequence = next;
  }
  if (!component) {
    return {
      exactKey: `stem:${stem}`,
      looseKey: `stem:${stem}`,
      reference: '',
      styleCode: '',
      component: '',
      sequence: '',
      stem,
    };
  }

  const looseKey = `${reference}|${component}${sequence ? `|${sequence}` : ''}`;
  const exactKey = styleCode
    ? `${reference}|${styleCode}|${component}${sequence ? `|${sequence}` : ''}`
    : looseKey;
  return { exactKey, looseKey, reference, styleCode, component, sequence, stem };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

function readLocalStore(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.recipes) {
      state.recipes = { ...state.recipes, ...parsed.recipes };
    }
  } catch {
    // Corrupt local cache — start clean.
  }
}

function writeLocalStore(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, recipes: state.recipes }));
  } catch {
    // Storage full or unavailable — recipes stay in memory for this session.
  }
}

function mergeRecipes(incoming: Record<string, CwLineRecipe>): number {
  let merged = 0;
  Object.entries(incoming || {}).forEach(([key, recipe]) => {
    if (!recipe || !Array.isArray(recipe.lines) || !recipe.lines.length) return;
    const existing = state.recipes[key];
    if (!existing || (recipe.updatedAt || '') >= (existing.updatedAt || '')) {
      state.recipes[key] = recipe;
      merged += 1;
    }
  });
  return merged;
}

async function fetchServerLibrary(): Promise<void> {
  try {
    const response = await fetch(`${API_ENDPOINT}?key=${encodeURIComponent(R2_LIBRARY_KEY)}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return;
    const payload = await response.json();
    if (payload?.recipes && typeof payload.recipes === 'object') {
      mergeRecipes(payload.recipes);
    }
  } catch {
    // Offline or endpoint unavailable — localStorage is the fallback source.
  }
}

function scheduleServerSync(): void {
  if (state.saveTimer) clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => {
    state.saveTimer = null;
    writeLocalStore();
    fetch(API_ENDPOINT, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        key: R2_LIBRARY_KEY,
        library: { version: 1, recipes: state.recipes },
      }),
    }).catch(() => {
      // Server persistence is best-effort.
    });
  }, SAVE_DEBOUNCE_MS);
}

export async function initCwLineLibrary(): Promise<void> {
  readLocalStore();
  state.loaded = true;
  await fetchServerLibrary();
  writeLocalStore();
}

export function getCwLineLibrarySnapshot(): {
  recipeCount: number;
  lineCount: number;
  references: string[];
} {
  const recipes = Object.values(state.recipes);
  return {
    recipeCount: recipes.length,
    lineCount: recipes.reduce((total, recipe) => total + recipe.lines.length, 0),
    references: Array.from(new Set(recipes.map(recipe => recipe.reference).filter(Boolean))).sort(),
  };
}

export function findRecipeForImageUrl(url: string): CwLineRecipe | null {
  const key = buildCwGeometryKey(url);
  if (!key) return null;
  const exact = state.recipes[key.exactKey];
  if (exact) return exact;
  const loose = state.recipes[key.looseKey];
  if (loose) return loose;
  // A recipe captured for a different style still matches on the shared
  // geometry (reference + component): one drawing serves every fabric colour.
  for (const recipe of Object.values(state.recipes)) {
    if (recipe.looseKey && recipe.looseKey === key.looseKey) return recipe;
  }
  return null;
}

export function hasRecipeForImageUrl(url: string): boolean {
  return findRecipeForImageUrl(url) !== null;
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

function getBackgroundForCanvas(canvas: any): any {
  const bg = canvas?.backgroundImage;
  if (!bg) return null;
  const width = Number(bg.width) || 0;
  const height = Number(bg.height) || 0;
  if (!width || !height) return null;
  return bg;
}

function normalizePointOnBackground(
  bg: any,
  x: number,
  y: number
): { x: number; y: number } | null {
  const matrix = typeof bg.calcTransformMatrix === 'function' ? bg.calcTransformMatrix() : null;
  if (!Array.isArray(matrix) || matrix.length !== 6) return null;
  // Canvas plane → image-local space needs the inverse of the bg transform.
  const local = applyMatrix(invertMatrix(matrix as Matrix), x, y);
  const nx = local.x / Number(bg.width);
  const ny = local.y / Number(bg.height);
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return null;
  // Tolerate tiny overflow but reject strokes drawn mostly off the photo.
  if (nx < -0.08 || nx > 1.08 || ny < -0.08 || ny > 1.08) return null;
  return { x: Math.min(1.05, Math.max(-0.05, nx)), y: Math.min(1.05, Math.max(-0.05, ny)) };
}

function denormalizePointOnBackground(
  bg: any,
  nx: number,
  ny: number
): { x: number; y: number } | null {
  const matrix = typeof bg.calcTransformMatrix === 'function' ? bg.calcTransformMatrix() : null;
  if (!Array.isArray(matrix) || matrix.length !== 6) return null;
  const point = applyMatrix(matrix as Matrix, nx * Number(bg.width), ny * Number(bg.height));
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  return point;
}

function lineEndpointsOnCanvas(
  line: any
): { x1: number; y1: number; x2: number; y2: number } | null {
  try {
    const points = typeof line.calcLinePoints === 'function' ? line.calcLinePoints() : null;
    const matrix =
      typeof line.calcTransformMatrix === 'function' ? line.calcTransformMatrix() : null;
    if (points && Array.isArray(matrix) && matrix.length === 6) {
      const start = applyMatrix(matrix as Matrix, points.x1, points.y1);
      const end = applyMatrix(matrix as Matrix, points.x2, points.y2);
      return { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
    }
  } catch {
    // Fall through to raw properties.
  }
  const x1 = Number(line.x1);
  const y1 = Number(line.y1);
  const x2 = Number(line.x2);
  const y2 = Number(line.y2);
  if ([x1, y1, x2, y2].every(value => Number.isFinite(value))) {
    return { x1, y1, x2, y2 };
  }
  return null;
}

function readStrokeValue(scopeKey: string, strokeLabel: string): string {
  const w = window as any;
  const metadata = w.app?.metadataManager;
  const measurement = metadata?.getMeasurement?.(scopeKey, strokeLabel);
  if (measurement && Number.isFinite(Number(measurement.cm)) && Number(measurement.cm) > 0) {
    const cm = Number(measurement.cm);
    return String(Math.round(cm * 10) / 10);
  }
  const imported = metadata?.getImportedMeasurementSource?.(scopeKey, strokeLabel);
  return String(imported?.value || '');
}

/**
 * Snapshot every vector line stroke on a view into a recipe keyed by the
 * catalogue photo geometry. Replaces the stored recipe for that geometry —
 * the latest drawing is the source of truth.
 */
export function captureRecipeFromView(viewId: string, imageUrl: string): CwLineRecipe | null {
  const w = window as any;
  const metadata = w.app?.metadataManager;
  const canvas = w.app?.canvasManager?.fabricCanvas;
  if (!metadata || !canvas) return null;

  const key = buildCwGeometryKey(imageUrl);
  if (!key) return null;

  const bg = getBackgroundForCanvas(canvas);
  if (!bg) return null;

  const scopeKey = metadata.normalizeImageLabel ? metadata.normalizeImageLabel(viewId) : viewId;
  const strokes = metadata.vectorStrokesByImage?.[scopeKey] || {};
  const labels = Object.keys(strokes).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  );
  if (!labels.length) return null;

  const lines: CwLineRecipeLine[] = [];
  labels.forEach(strokeLabel => {
    const stroke = strokes[strokeLabel];
    if (!stroke) return;
    if (stroke.isZipper || stroke.strokeMetadata?.type === 'text') return;
    // Curves cannot replay as straight lines yet; skip them.
    if (stroke.type === 'path' || stroke.type === 'curve' || stroke.isCurve) return;
    const endpoints = lineEndpointsOnCanvas(stroke);
    if (!endpoints) return;
    const start = normalizePointOnBackground(bg, endpoints.x1, endpoints.y1);
    const end = normalizePointOnBackground(bg, endpoints.x2, endpoints.y2);
    if (!start || !end) return;
    const distance = Math.hypot(start.x - end.x, start.y - end.y);
    if (distance < 0.01) return;
    const value = readStrokeValue(scopeKey, strokeLabel);
    lines.push({
      label: strokeLabel,
      value,
      sourceLabel:
        metadata.getImportedMeasurementSource?.(scopeKey, strokeLabel)?.sourceLabel || strokeLabel,
      x1: start.x,
      y1: start.y,
      x2: end.x,
      y2: end.y,
    });
  });

  if (!lines.length) return null;

  const recipe: CwLineRecipe = {
    key: key.exactKey,
    looseKey: key.looseKey,
    reference: key.reference,
    styleCode: key.styleCode,
    component: key.component,
    sequence: key.sequence,
    imageUrl,
    lines,
    updatedAt: new Date().toISOString(),
  };
  state.recipes[recipe.key] = recipe;
  scheduleServerSync();
  return recipe;
}

export function scheduleCaptureForView(viewId: string, resolveImageUrl: () => string): void {
  if (state.captureTimer) clearTimeout(state.captureTimer);
  state.captureTimer = setTimeout(() => {
    state.captureTimer = null;
    if (state.replayInProgress) return;
    const imageUrl = resolveImageUrl();
    if (!imageUrl) return;
    try {
      const recipe = captureRecipeFromView(viewId, imageUrl);
      if (recipe) {
        console.log(`[CW Line Library] Captured ${recipe.lines.length} lines for ${recipe.key}`);
      }
    } catch (error) {
      console.warn('[CW Line Library] Capture failed', error);
    }
  }, CAPTURE_DEBOUNCE_MS);
}

export function isReplayInProgress(): boolean {
  return state.replayInProgress;
}

export function setReplayInProgress(value: boolean): void {
  state.replayInProgress = value;
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

export interface ReplayTarget {
  viewId: string;
  imageUrl: string;
}

export interface ReplayLinePlan {
  label: string;
  value: string;
  sourceLabel: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
}

/**
 * Translate a stored recipe into concrete canvas coordinates for the photo
 * currently placed on the active canvas.
 */
export function buildReplayPlan(
  imageUrl: string,
  usedLabels: Set<string>
): ReplayLinePlan[] | null {
  const recipe = findRecipeForImageUrl(imageUrl);
  if (!recipe) return null;
  const canvas = (window as any).app?.canvasManager?.fabricCanvas;
  const bg = getBackgroundForCanvas(canvas);
  if (!bg) return null;

  const plans: ReplayLinePlan[] = [];
  recipe.lines.forEach(line => {
    const label = line.label;
    if (usedLabels.has(label)) return;
    const start = denormalizePointOnBackground(bg, line.x1, line.y1);
    const end = denormalizePointOnBackground(bg, line.x2, line.y2);
    if (!start || !end) return;
    plans.push({
      label,
      value: line.value,
      sourceLabel: line.sourceLabel,
      start,
      end,
    });
  });
  return plans.length ? plans : null;
}

// Expose a small console bridge for debugging and manual capture.
export function installCwLineLibraryBridge(): void {
  (window as any).cwLineLibrary = {
    snapshot: getCwLineLibrarySnapshot,
    find: (url: string) => findRecipeForImageUrl(url),
    capture: (viewId: string, url: string) => captureRecipeFromView(viewId, url),
    reload: async () => {
      state.recipes = {};
      await initCwLineLibrary();
      return getCwLineLibrarySnapshot();
    },
  };
}
