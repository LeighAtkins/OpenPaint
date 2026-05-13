import { resolveScopedImageLabel } from './scoped-image-label.js';
import { fetchGuideRasterUrl, resolveGuideActiveRole } from './measurement-guide-flash.js';
import { showRewardAchievement } from './reward-achievement';

const DRAW_MEASUREMENT_TOOLS = new Set(['line', 'curve']);
const INDICATOR_ID = 'measurementGuideIndicator';
const STYLE_ID = 'measurementGuideIndicatorStyles';
const GUIDE_CACHE_BUSTER = '2026-02-11-1';
const MAX_CHIPS = 7;
const GUIDE_TOGGLE_KEY = 'openpaint:measurementGuideIndicator:visible';
const GUIDE_WINDOW_PREFS_KEY = 'openpaint:guideWindowPrefs:v1';
const INDICATOR_SIZE_ORDER = ['S', 'M', 'L', 'XL'] as const;

type IndicatorSize = (typeof INDICATOR_SIZE_ORDER)[number];

interface RoleCacheEntry {
  roles: string[];
  fetchedAt: number;
  ok: boolean;
}

const guideRoleCache = new Map<string, Promise<RoleCacheEntry>>();
let refreshTimer: number | null = null;
let lastRenderKey = '';
let manualChipOverride = false;
let renderPending = false;
let lastRenderTime = 0;
const MIN_RENDER_INTERVAL = 100; // ms
let lastStrokeCreatedTime = 0;
const STROKE_ADVANCE_WINDOW = 500; // Only auto-advance within 500ms of stroke creation
let allDoneAchievementFiredForView = '';

function dispatchGuideNextTagChanged(viewId: string, tag: string): boolean {
  const normalizedViewId = (viewId || '').trim();
  const normalizedTag = normalizeLabel(tag);
  if (!normalizedViewId || !normalizedTag) return false;

  const cacheKey = '__openpaintGuideNextTagByView';
  const cache =
    (window as any)[cacheKey] && typeof (window as any)[cacheKey] === 'object'
      ? (window as any)[cacheKey]
      : {};
  if (cache[normalizedViewId] === normalizedTag) {
    return false;
  }
  cache[normalizedViewId] = normalizedTag;
  (window as any)[cacheKey] = cache;

  window.dispatchEvent(
    new CustomEvent('openpaint:guide-next-tag-changed', {
      detail: {
        viewId: normalizedViewId,
        tag: normalizedTag,
      },
    })
  );
  return true;
}

function isMeasurementSplitWorkspaceActive(): boolean {
  if ((window as any).isMeasurementSplitWorkspaceActive?.() === true) {
    return true;
  }
  return document.body.classList.contains('measurement-split-workspace-active');
}

function getWindowPrefs(): any {
  try {
    const raw = localStorage.getItem(GUIDE_WINDOW_PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function setWindowPrefs(patch: Record<string, unknown>): void {
  const current = getWindowPrefs();
  const next = { ...current, ...patch };
  try {
    localStorage.setItem(GUIDE_WINDOW_PREFS_KEY, JSON.stringify(next));
  } catch {
    // no-op
  }
}

function normalizeSize(value: unknown): IndicatorSize {
  const raw = typeof value === 'string' ? value.toUpperCase() : '';
  if (raw === 'S' || raw === 'M' || raw === 'L' || raw === 'XL') return raw;
  return 'M';
}

function getStoredIndicatorSize(): IndicatorSize {
  const prefs = getWindowPrefs();
  return normalizeSize(prefs.indicatorSize);
}

function getIndicatorLayoutUnlocked(): boolean {
  const prefs = getWindowPrefs();
  return prefs.indicatorLayoutUnlocked === true;
}

function setIndicatorLayoutUnlocked(unlocked: boolean): void {
  setWindowPrefs({ indicatorLayoutUnlocked: unlocked });
}

function setIndicatorSize(size: IndicatorSize, manual = true): void {
  setWindowPrefs({ indicatorSize: size, indicatorManualSize: manual });
}

function resolveIndicatorSize(activeTool: string): IndicatorSize {
  const prefs = getWindowPrefs();
  if (prefs.indicatorManualSize === true) {
    return normalizeSize(prefs.indicatorSize);
  }
  if (DRAW_MEASUREMENT_TOOLS.has(activeTool)) return 'M';
  return 'S';
}

function cycleIndicatorSize(delta: number): IndicatorSize {
  const current = getStoredIndicatorSize();
  const index = INDICATOR_SIZE_ORDER.indexOf(current);
  const nextIndex = Math.max(0, Math.min(INDICATOR_SIZE_ORDER.length - 1, index + delta));
  return INDICATOR_SIZE_ORDER[nextIndex];
}

function getIndicatorRect(): { x: number; y: number; width: number; height: number } | null {
  const prefs = getWindowPrefs();
  const rect = prefs.indicatorRect;
  if (!rect || typeof rect !== 'object') return null;
  const x = Number((rect as any).x);
  const y = Number((rect as any).y);
  const width = Number((rect as any).width);
  const height = Number((rect as any).height);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  return { x, y, width, height };
}

function setIndicatorRect(
  rect: { x: number; y: number; width: number; height: number } | null
): void {
  if (!rect) {
    const prefs = getWindowPrefs();
    delete prefs.indicatorRect;
    try {
      localStorage.setItem(GUIDE_WINDOW_PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // no-op
    }
    return;
  }
  setWindowPrefs({ indicatorRect: rect });
}

function toText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function normalizeCode(value: unknown): string {
  return toText(value).trim().replace(/\s+/g, '-').toUpperCase();
}

function normalizeLabel(value: unknown): string {
  return toText(value)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '');
}

function normalizeView(viewId: string): 'front' | 'back' | 'side' {
  const raw = viewId.toLowerCase();
  if (raw.includes('back')) return 'back';
  if (raw.includes('side')) return 'side';
  return 'front';
}

function toBaseViewId(viewId: string): string {
  const raw = viewId.trim();
  if (!raw) return 'front';
  if (raw.includes('::')) return raw.split('::')[0] || raw;
  return raw;
}

function getCurrentViewId(): string {
  const input = document.getElementById('currentImageNameBox');
  if (input instanceof HTMLInputElement) {
    const typed = input.value.trim().toLowerCase();
    if (typed === 'front' || typed === 'back' || typed === 'side') {
      return typed;
    }
    const activeViewId = (input.dataset.activeViewId || '').trim();
    if (activeViewId) return activeViewId;
  }
  const currentView = String((window as any).app?.projectManager?.currentViewId || '').trim();
  return currentView || 'front';
}

function isGuideOverlayVisible(): boolean {
  const flash = document.querySelector('.guide-flash-overlay.visible');
  const gallery = document.querySelector('.guide-gallery-overlay.visible');
  return !!flash || !!gallery;
}

function isIndicatorEnabled(): boolean {
  try {
    const stored = localStorage.getItem(GUIDE_TOGGLE_KEY);
    return stored !== '0';
  } catch {
    return true;
  }
}

function setIndicatorEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(GUIDE_TOGGLE_KEY, enabled ? '1' : '0');
  } catch {
    // no-op
  }
}

function syncHeaderToggleUi(enabled: boolean): void {
  const button = document.getElementById('measurementGuideToggle') as HTMLButtonElement | null;
  if (!button) return;
  button.title = enabled ? 'Hide measurement guide' : 'Show measurement guide';
  button.setAttribute('aria-label', button.title);
  button.dataset.state = enabled ? 'on' : 'off';
  button.innerHTML = `
    <span class="measurement-guide-toggle-glow" aria-hidden="true"></span>
    <span class="measurement-guide-toggle-core" aria-hidden="true">
      <svg viewBox="0 0 16 16" aria-hidden="true" class="measurement-guide-toggle-icon">
        <path d="M2.5 3.5h11v9h-11z" fill="none" stroke="currentColor" stroke-width="1.25" rx="1" />
        <path d="M5 3.5v3M7 3.5v2M9 3.5v3M11 3.5v2" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" />
        <path d="M4 10.5h6.5" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" />
      </svg>
    </span>
  `;
}

function ensureHeaderToggle(): void {
  const header = document.getElementById('imagePanelHeader');
  if (!header) return;
  const controls = header.querySelector('.flex.items-center.gap-2');
  if (!controls) return;
  const collapseButton = document.getElementById('toggleImagePanel') as HTMLButtonElement | null;
  let button = document.getElementById('measurementGuideToggle') as HTMLButtonElement | null;

  if (!button) {
    button = document.createElement('button');
    button.id = 'measurementGuideToggle';
    button.type = 'button';
    button.className = 'measurement-guide-toggle-btn';
    button.addEventListener('click', () => {
      const next = !isIndicatorEnabled();
      setIndicatorEnabled(next);
      syncHeaderToggleUi(next);
      scheduleRender();
    });
  }

  if (collapseButton) {
    let stack = document.getElementById('measurementGuideToggleStack') as HTMLDivElement | null;
    if (!stack) {
      stack = document.createElement('div');
      stack.id = 'measurementGuideToggleStack';
      stack.className = 'measurement-guide-toggle-stack';
    }

    if (stack.parentElement !== controls) {
      controls.insertBefore(stack, collapseButton);
    }
    if (collapseButton.parentElement !== stack) {
      stack.appendChild(collapseButton);
    }
    if (button.parentElement !== stack) {
      stack.appendChild(button);
    }
  } else if (button.parentElement !== controls) {
    controls.appendChild(button);
  }

  const enabled = isIndicatorEnabled();
  button.title = enabled ? 'Hide measurement guide' : 'Show measurement guide';
  button.setAttribute('aria-label', button.title);
  syncHeaderToggleUi(enabled);
}

function getCwScopedViewKey(viewId: string): string {
  return (resolveScopedImageLabel(viewId) || viewId).trim();
}

function getLegacyCwScopeCandidates(viewId: string): string[] {
  const scoped = getCwScopedViewKey(viewId);
  const base = toBaseViewId(viewId);
  return Array.from(new Set([(viewId || '').trim(), scoped, base].filter(Boolean)));
}

function getMetadata(): any {
  return (
    (window as any).app?.projectManager?.getProjectMetadata?.() ||
    (window as any).projectMetadata ||
    {}
  );
}

function getViewCandidates(viewId: string): string[] {
  const base = toBaseViewId(viewId);
  return Array.from(new Set([viewId.trim(), base].filter(Boolean)));
}

function getGuideBinding(viewId: string): {
  codes: string[];
  activeCode: string;
  locked: boolean;
  scopeId: string;
  scopeType: 'frame' | 'view' | 'project' | 'default';
} {
  const metadata = getMetadata();
  const scopeBindings =
    metadata?.measurementGuideBindingsByScope &&
    typeof metadata.measurementGuideBindingsByScope === 'object'
      ? metadata.measurementGuideBindingsByScope
      : {};
  const candidates = getViewCandidates(viewId);

  for (const candidate of candidates) {
    const binding = scopeBindings[candidate];
    if (!binding || typeof binding !== 'object') continue;
    const codes = Array.isArray(binding.codes)
      ? binding.codes.map((c: unknown) => normalizeCode(c)).filter(Boolean)
      : [];
    const activeCode = normalizeCode((binding as any).activeCode || codes[0] || '');
    const locked = (binding as any).locked === true;
    if (codes.length || activeCode || locked) {
      const base = toBaseViewId(viewId);
      const scopeType = candidate === viewId ? 'frame' : candidate === base ? 'view' : 'frame';
      return { codes, activeCode, locked, scopeId: candidate, scopeType };
    }
  }

  const projectBinding = scopeBindings.__project__;
  if (projectBinding && typeof projectBinding === 'object') {
    const codes = Array.isArray(projectBinding.codes)
      ? projectBinding.codes.map((c: unknown) => normalizeCode(c)).filter(Boolean)
      : [];
    const activeCode = normalizeCode((projectBinding as any).activeCode || codes[0] || '');
    const locked = (projectBinding as any).locked === true;
    if (codes.length || activeCode || locked) {
      return {
        codes,
        activeCode,
        locked,
        scopeId: '__project__',
        scopeType: 'project',
      };
    }
  }

  const defaults =
    metadata?.measurementGuideProjectDefaults &&
    typeof metadata.measurementGuideProjectDefaults === 'object'
      ? metadata.measurementGuideProjectDefaults
      : {};
  const defaultCodes = Array.isArray(defaults.codes)
    ? defaults.codes.map((c: unknown) => normalizeCode(c)).filter(Boolean)
    : [];
  const defaultActive = normalizeCode(defaults.activeCode || defaultCodes[0] || '');
  if (defaultCodes.length || defaultActive) {
    return {
      codes: defaultCodes,
      activeCode: defaultActive,
      locked: false,
      scopeId: '__default__',
      scopeType: 'default',
    };
  }

  return { codes: [], activeCode: '', locked: false, scopeId: '__default__', scopeType: 'default' };
}

function getBindingBreadcrumb(viewId: string): string {
  const binding = getGuideBinding(viewId);
  if (binding.scopeType === 'project') return `Bound: Project${binding.locked ? ' (Locked)' : ''}`;
  if (binding.scopeType === 'view') {
    return `Bound: View ${toBaseViewId(viewId)}${binding.locked ? ' (Locked)' : ''}`;
  }
  if (binding.scopeType === 'frame') {
    return `Bound: Frame ${binding.scopeId}${binding.locked ? ' (Locked)' : ''}`;
  }
  return 'Bound: Default';
}

function isGuideLockedToView(viewId: string): boolean {
  const binding = getGuideBinding(viewId);
  if (binding.locked) return true;
  const metadata = getMetadata();
  const lockByView =
    metadata?.measurementGuideLockByView && typeof metadata.measurementGuideLockByView === 'object'
      ? metadata.measurementGuideLockByView
      : {};
  const candidates = getViewCandidates(viewId);
  return candidates.some(key => lockByView[key] === true);
}

function resolveGuideCode(viewId: string): string {
  const binding = getGuideBinding(viewId);
  if (binding.activeCode) return binding.activeCode;
  if (binding.codes.length) return binding.codes[0];

  const metadata = getMetadata();
  const byView =
    metadata?.measurementGuideCodesByView &&
    typeof metadata.measurementGuideCodesByView === 'object'
      ? metadata.measurementGuideCodesByView
      : {};
  const candidates = getViewCandidates(viewId);

  for (const candidate of candidates) {
    if (!isGuideLockedToView(candidate)) continue;
    const scoped = Array.isArray(byView[candidate]) ? byView[candidate] : [];
    const scopedCode = scoped.map((c: unknown) => normalizeCode(c)).find(Boolean);
    if (scopedCode) return scopedCode;
  }

  return '';
}

function buildGuideUrl(code: string, viewId: string): string {
  const view = normalizeView(viewId);
  return `/api/measurement-guides/svg?code=${encodeURIComponent(code)}&view=${encodeURIComponent(view)}&v=${encodeURIComponent(GUIDE_CACHE_BUSTER)}`;
}

function resolveActiveGuideSelection(viewId: string): {
  code: string;
  variant: 'front' | 'back' | 'side';
  bound: boolean;
} {
  const externalResolver = (window as any).resolveActiveGuideForView;
  if (typeof externalResolver === 'function') {
    const resolved = externalResolver(viewId) || {};
    const code = normalizeCode((resolved as any).code || '');
    if (code) {
      const variant = normalizeView(String((resolved as any).variant || 'front'));
      return {
        code,
        variant,
        bound: (resolved as any).bound === true,
      };
    }
  }

  const code = resolveGuideCode(viewId);
  return {
    code,
    variant: normalizeView(viewId),
    bound: false,
  };
}

function incrementLabel(label: string): string {
  const match = /^([A-Z])(\d+)$/.exec(normalizeLabel(label));
  if (!match) return 'A1';
  const letter = match[1];
  const number = Number(match[2]);
  if (!Number.isFinite(number) || number < 1) return `${letter}1`;
  if (number < 9) return `${letter}${number + 1}`;
  const nextLetter = letter === 'Z' ? 'A' : String.fromCharCode(letter.charCodeAt(0) + 1);
  return `${nextLetter}1`;
}

function getFallbackNextLabel(viewId: string): string {
  const metadata = (window as any).app?.metadataManager;
  const next = metadata?.getNextLabel?.(viewId);
  const normalized = normalizeLabel(next);
  return normalized || 'A1';
}

function getUsedStrokeLabels(viewId: string): Set<string> {
  const used = new Set<string>();
  const metadata = (window as any).app?.metadataManager;
  const vectorMap = metadata?.vectorStrokesByImage || {};
  const lineMap = (window as any).lineStrokesByImage || {};

  const base = toBaseViewId(viewId);
  const scoped = resolveScopedImageLabel(viewId);
  const dynamicKeys = new Set<string>([
    ...Object.keys(vectorMap || {}),
    ...Object.keys(lineMap || {}),
  ]);
  const scopeKeys = Array.from(
    new Set(
      [
        ...getViewCandidates(viewId),
        scoped,
        ...Array.from(dynamicKeys).filter(
          key => key === base || key.startsWith(`${base}::tab:`) || key === scoped
        ),
      ].filter(Boolean)
    )
  );

  for (const key of scopeKeys) {
    const vectors = vectorMap?.[key] || {};
    Object.keys(vectors).forEach((label: string) => {
      const normalized = normalizeLabel(label);
      if (normalized) used.add(normalized);
    });

    const lines = Array.isArray(lineMap?.[key]) ? lineMap[key] : [];
    lines.forEach((label: unknown) => {
      const normalized = normalizeLabel(label);
      if (normalized) used.add(normalized);
    });
  }

  return used;
}

function getCwGuideScopeInfo(viewId: string): {
  roles: string[];
  strictScope: boolean;
  scopeKey: string;
} {
  const w = window as any;
  const roleMap =
    w.cwGuideRolesByImage && typeof w.cwGuideRolesByImage === 'object' ? w.cwGuideRolesByImage : {};
  const measurementMap =
    w.cwImportedMeasurementsByImage && typeof w.cwImportedMeasurementsByImage === 'object'
      ? w.cwImportedMeasurementsByImage
      : {};
  const scoped = getCwScopedViewKey(viewId);
  const exactRoles = Array.isArray(roleMap[scoped]) ? roleMap[scoped] : [];
  const normalizedExactRoles = exactRoles.map(label => normalizeLabel(label)).filter(Boolean);
  if (normalizedExactRoles.length) {
    return {
      roles: Array.from(new Set(normalizedExactRoles)),
      strictScope: true,
      scopeKey: scoped,
    };
  }

  const exactMeasurements =
    measurementMap[scoped] && typeof measurementMap[scoped] === 'object'
      ? measurementMap[scoped]
      : null;
  if (exactMeasurements) {
    const exactCollected = new Set<string>();
    Object.keys(exactMeasurements).forEach(label => {
      const normalized = normalizeLabel(label);
      if (/^[A-Z](?:\d+)?$/.test(normalized)) {
        exactCollected.add(normalized);
      }
    });
    return {
      roles: Array.from(exactCollected).sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
      ),
      strictScope: true,
      scopeKey: scoped,
    };
  }

  const candidates = getLegacyCwScopeCandidates(viewId);

  for (const candidate of candidates) {
    const direct = Array.isArray(roleMap[candidate]) ? roleMap[candidate] : [];
    const normalizedDirect = direct.map(label => normalizeLabel(label)).filter(Boolean);
    if (normalizedDirect.length) {
      return {
        roles: Array.from(new Set(normalizedDirect)),
        strictScope: false,
        scopeKey: candidate,
      };
    }
  }

  const collected = new Set<string>();
  candidates.forEach(candidate => {
    const entries =
      measurementMap[candidate] && typeof measurementMap[candidate] === 'object'
        ? measurementMap[candidate]
        : {};
    Object.keys(entries).forEach(label => {
      const normalized = normalizeLabel(label);
      if (/^[A-Z](?:\d+)?$/.test(normalized)) {
        collected.add(normalized);
      }
    });
  });

  return {
    roles: Array.from(collected).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    ),
    strictScope: false,
    scopeKey: scoped,
  };
}

function normalizeRoleToken(value: string): string {
  const token = (value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '');
  if (!token) return '';
  if (token.length > 20) return '';
  if (/^\d+$/.test(token)) return '';
  return token;
}

function canonicalRoleToken(value: string): string {
  const token = normalizeRoleToken(value);
  if (!token) return '';
  const strippedUnits = token.replace(/(?:CM|MM|IN)\d*$/i, '');
  return strippedUnits || token;
}

function roleTokenFromElementId(id: string): string {
  const normalized = (id || '').replace(/^mos\d+_/, '').trim();
  if (!normalized || normalized.length < 2) return '';

  if (/^[mbc][a-z0-9_-]+$/i.test(normalized)) {
    let token = normalized.substring(1).toUpperCase();
    token = token.replace(/_(LABEL|TEXT)$/i, '');
    token = token.replace(/(CM|MM|IN)$/i, '');
    token = token.replace(/[^A-Z0-9-]/g, '');
    return normalizeRoleToken(token);
  }

  return '';
}

function parseGuideRoles(svgText: string): string[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  const byCanonical = new Map<string, string>();

  doc.querySelectorAll('text').forEach(node => {
    const token = normalizeRoleToken(node.textContent || '');
    if (!token) return;
    const canonical = canonicalRoleToken(token);
    if (!canonical) return;
    if (!byCanonical.has(canonical) || token.length < (byCanonical.get(canonical) || '').length) {
      byCanonical.set(canonical, token);
    }
  });

  doc.querySelectorAll('[id]').forEach(node => {
    const id = node.getAttribute('id') || '';
    const token = roleTokenFromElementId(id);
    if (!token) return;
    const canonical = canonicalRoleToken(token);
    if (!canonical) return;
    if (!byCanonical.has(canonical) || token.length < (byCanonical.get(canonical) || '').length) {
      byCanonical.set(canonical, token);
    }
  });

  const roles = Array.from(byCanonical.values());
  return roles.sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  );
}

async function getGuideRoles(
  code: string,
  guideView: 'front' | 'back' | 'side'
): Promise<{ roles: string[]; ok: boolean }> {
  const key = `${code}::${normalizeView(guideView)}`;
  if (!guideRoleCache.has(key)) {
    guideRoleCache.set(
      key,
      (async () => {
        const response = await fetch(buildGuideUrl(code, guideView), { method: 'GET' });
        if (!response.ok) {
          return { roles: [], fetchedAt: Date.now(), ok: false };
        }
        const svgText = await response.text();
        return { roles: parseGuideRoles(svgText), fetchedAt: Date.now(), ok: true };
      })()
    );
  }
  const cached = await guideRoleCache.get(key);
  const roles = (cached?.roles || []).filter(role => /^[A-Z](?:\d+)?$/.test(role));
  return { roles, ok: cached?.ok === true };
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .measurement-guide-indicator {
      position: fixed;
      top: 12px;
      right: 12px;
      z-index: 13340;
      width: min(320px, calc(100vw - 24px));
      border-radius: 12px;
      border: 1px solid rgba(148, 163, 184, 0.5);
      background: rgba(15, 23, 42, 0.85);
      box-shadow: 0 16px 32px rgba(2, 6, 23, 0.35);
      overflow: hidden;
      backdrop-filter: blur(6px);
      pointer-events: auto;
      transition: width 160ms ease, height 160ms ease, left 140ms ease, top 140ms ease;
    }
    body.measurement-split-workspace-active .measurement-guide-indicator {
      display: none !important;
    }
    .measurement-guide-indicator.is-unlocked .measurement-guide-indicator-head {
      cursor: move;
    }
    .measurement-guide-indicator-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 7px 9px;
      border-bottom: 1px solid rgba(148, 163, 184, 0.4);
      color: #e2e8f0;
      font-size: 10px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      font-weight: 700;
    }
    .measurement-guide-indicator-meta {
      margin: 0;
      padding: 0 9px 6px;
      font-size: 10px;
      color: #cbd5e1;
      letter-spacing: 0.01em;
      border-bottom: 1px solid rgba(148, 163, 184, 0.25);
    }
    .measurement-guide-indicator-head strong {
      font-size: 12px;
      letter-spacing: 0.02em;
      color: #f8fafc;
    }
    .measurement-guide-indicator-controls {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-left: auto;
    }
    .measurement-guide-indicator-ctl {
      border: 1px solid rgba(148, 163, 184, 0.55);
      background: rgba(15, 23, 42, 0.62);
      color: #cbd5e1;
      border-radius: 6px;
      min-width: 20px;
      height: 20px;
      font-size: 10px;
      line-height: 1;
      font-weight: 700;
      padding: 0 5px;
      cursor: pointer;
    }
    .measurement-guide-indicator-ctl:hover {
      color: #f8fafc;
      border-color: rgba(186, 230, 253, 0.75);
    }
    .measurement-guide-indicator-ctl[aria-pressed="true"] {
      color: #082f49;
      background: #7dd3fc;
      border-color: #bae6fd;
    }
    .measurement-guide-indicator-hero {
      position: relative;
      height: 118px;
      background: rgba(248, 250, 252, 0.08);
      border-bottom: 1px solid rgba(148, 163, 184, 0.35);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .measurement-guide-indicator-hero img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      display: block;
    }
    .measurement-guide-indicator-track {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 9px 10px;
      overflow: hidden;
    }
    .measurement-guide-indicator-chip {
      min-width: 30px;
      height: 28px;
      border-radius: 999px;
      border: 1px solid rgba(148, 163, 184, 0.45);
      color: #cbd5e1;
      background: rgba(15, 23, 42, 0.45);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.01em;
      flex: 0 0 auto;
      padding: 0 7px;
      cursor: pointer;
    }
    .measurement-guide-indicator-chip.active {
      color: #082f49;
      background: #7dd3fc;
      border-color: #bae6fd;
      box-shadow: 0 0 0 2px rgba(125, 211, 252, 0.3);
    }
    .measurement-guide-indicator-resize {
      position: absolute;
      right: 0;
      bottom: 0;
      width: 16px;
      height: 16px;
      cursor: nwse-resize;
      opacity: 0;
      pointer-events: none;
    }
    .measurement-guide-indicator-resize::before {
      content: '';
      position: absolute;
      right: 3px;
      bottom: 3px;
      width: 8px;
      height: 8px;
      border-right: 2px solid rgba(186, 230, 253, 0.8);
      border-bottom: 2px solid rgba(186, 230, 253, 0.8);
    }
    .measurement-guide-indicator.is-unlocked .measurement-guide-indicator-resize {
      opacity: 1;
      pointer-events: auto;
    }
    .measurement-guide-toggle-btn {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      padding: 0;
      border-radius: 8px;
      border: 1px solid rgba(148, 163, 184, 0.28);
      background:
        radial-gradient(circle at 30% 28%, rgba(255, 255, 255, 0.92), rgba(255, 255, 255, 0) 44%),
        linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(241, 245, 249, 0.9));
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.9),
        0 1px 2px rgba(15, 23, 42, 0.08),
        0 6px 14px rgba(148, 163, 184, 0.18);
      color: #64748b;
      transition:
        transform 160ms ease,
        color 160ms ease,
        border-color 160ms ease,
        box-shadow 160ms ease,
        background 160ms ease;
      overflow: hidden;
      flex: 0 0 auto;
    }
    .measurement-guide-toggle-stack {
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 4px;
      flex: 0 0 auto;
    }
    .measurement-guide-toggle-stack #toggleImagePanel {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      padding: 0;
      color: #64748b;
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.72);
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.82),
        0 1px 2px rgba(15, 23, 42, 0.06);
      transition:
        color 160ms ease,
        border-color 160ms ease,
        background 160ms ease,
        box-shadow 160ms ease,
        transform 160ms ease;
    }
    .measurement-guide-toggle-stack #toggleImagePanel:hover {
      transform: translateY(-1px);
      color: #0f766e;
      border-color: rgba(45, 212, 191, 0.32);
      background: rgba(255, 255, 255, 0.88);
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.92),
        0 4px 10px rgba(45, 212, 191, 0.12);
    }
    .measurement-guide-toggle-btn:hover {
      transform: translateY(-1px);
      color: #0f766e;
      border-color: rgba(45, 212, 191, 0.42);
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.96),
        0 2px 4px rgba(15, 23, 42, 0.08),
        0 8px 18px rgba(45, 212, 191, 0.18);
    }
    .measurement-guide-toggle-btn:focus-visible {
      outline: none;
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.96),
        0 0 0 2px rgba(255, 255, 255, 0.92),
        0 0 0 4px rgba(45, 212, 191, 0.32),
        0 8px 18px rgba(45, 212, 191, 0.18);
    }
    .measurement-guide-toggle-btn[data-state="on"] {
      color: #0f766e;
      border-color: rgba(45, 212, 191, 0.45);
      background:
        radial-gradient(circle at 30% 28%, rgba(255, 255, 255, 0.98), rgba(255, 255, 255, 0) 42%),
        linear-gradient(180deg, rgba(240, 253, 250, 0.98), rgba(204, 251, 241, 0.92));
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.98),
        0 1px 2px rgba(15, 23, 42, 0.06),
        0 8px 18px rgba(45, 212, 191, 0.2);
    }
    .measurement-guide-toggle-btn[data-state="on"] .measurement-guide-toggle-glow {
      opacity: 1;
      transform: scale(1);
    }
    .measurement-guide-toggle-glow {
      position: absolute;
      inset: 4px;
      border-radius: 6px;
      background: radial-gradient(circle, rgba(45, 212, 191, 0.18), rgba(45, 212, 191, 0) 70%);
      opacity: 0;
      transform: scale(0.8);
      transition: opacity 160ms ease, transform 160ms ease;
      pointer-events: none;
    }
    .measurement-guide-toggle-core {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      border-radius: 5px;
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(226, 232, 240, 0.55));
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.8),
        0 1px 2px rgba(15, 23, 42, 0.08);
    }
    .measurement-guide-toggle-btn[data-state="on"] .measurement-guide-toggle-core {
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(204, 251, 241, 0.78));
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.92),
        0 1px 2px rgba(13, 148, 136, 0.16);
    }
    .measurement-guide-toggle-icon {
      width: 12px;
      height: 12px;
      display: block;
      filter: drop-shadow(0 1px 0 rgba(255, 255, 255, 0.55));
    }
  `;
  document.head.appendChild(style);
}

function ensureRoot(): HTMLElement {
  let root = document.getElementById(INDICATOR_ID);
  if (root) return root;
  root = document.createElement('section');
  root.id = INDICATOR_ID;
  root.className = 'measurement-guide-indicator';
  root.style.display = 'none';
  document.body.appendChild(root);
  return root;
}

function getActiveToolName(): string {
  return String((window as any).app?.toolManager?.activeToolName || '').toLowerCase();
}

function positionIndicator(root: HTMLElement): void {
  if (getIndicatorLayoutUnlocked()) {
    const rect = getIndicatorRect();
    if (rect) {
      root.style.left = `${Math.round(rect.x)}px`;
      root.style.top = `${Math.round(rect.y)}px`;
      root.style.right = 'auto';
      root.style.width = `${Math.round(rect.width)}px`;
      root.style.height = `${Math.round(rect.height)}px`;
      return;
    }
  }

  root.style.left = 'auto';
  root.style.height = '';
  let right = 12;
  const imagePanel = document.getElementById('imagePanel');
  if (imagePanel) {
    const style = window.getComputedStyle(imagePanel);
    const visible =
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      imagePanel.getClientRects().length > 0;
    if (visible) {
      const rect = imagePanel.getBoundingClientRect();
      if (rect.width > 0 && rect.right >= window.innerWidth - 2) {
        right = Math.max(12, window.innerWidth - rect.left + 12);
      }
    }
  }
  root.style.right = `${Math.round(right)}px`;
  root.style.top = '12px';
}

function clampIndicatorRect(rect: { x: number; y: number; width: number; height: number }): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const minWidth = 220;
  const minHeight = 170;
  const maxWidth = Math.max(minWidth, window.innerWidth - 16);
  const maxHeight = Math.max(minHeight, window.innerHeight - 16);
  const width = Math.max(minWidth, Math.min(maxWidth, rect.width));
  const height = Math.max(minHeight, Math.min(maxHeight, rect.height));
  const x = Math.max(8, Math.min(window.innerWidth - width - 8, rect.x));
  const y = Math.max(8, Math.min(window.innerHeight - height - 8, rect.y));
  return { x, y, width, height };
}

function applyIndicatorPreset(root: HTMLElement, size: IndicatorSize): void {
  const widthBySize: Record<IndicatorSize, number> = { S: 240, M: 320, L: 420, XL: 560 };
  const heroBySize: Record<IndicatorSize, number> = { S: 92, M: 130, L: 180, XL: 240 };
  const width = widthBySize[size];
  root.dataset.size = size;
  root.style.width = `${Math.min(width, window.innerWidth - 16)}px`;
  const hero = root.querySelector('.measurement-guide-indicator-hero') as HTMLElement | null;
  if (hero) hero.style.height = `${heroBySize[size]}px`;
}

function bindIndicatorWindowControls(root: HTMLElement): void {
  const unlocked = getIndicatorLayoutUnlocked();
  root.classList.toggle('is-unlocked', unlocked);

  const header = root.querySelector('.measurement-guide-indicator-head') as HTMLElement | null;
  const resizeHandle = root.querySelector(
    '.measurement-guide-indicator-resize'
  ) as HTMLElement | null;
  const dec = root.querySelector('[data-guide-size-dec]') as HTMLButtonElement | null;
  const med = root.querySelector('[data-guide-size-med]') as HTMLButtonElement | null;
  const inc = root.querySelector('[data-guide-size-inc]') as HTMLButtonElement | null;
  const fit = root.querySelector('[data-guide-size-fit]') as HTMLButtonElement | null;
  const unlock = root.querySelector('[data-guide-layout-unlock]') as HTMLButtonElement | null;
  const bind = root.querySelector('[data-guide-bind]') as HTMLButtonElement | null;

  const updateUnlockUi = () => {
    const nextUnlocked = getIndicatorLayoutUnlocked();
    root.classList.toggle('is-unlocked', nextUnlocked);
    if (unlock) unlock.setAttribute('aria-pressed', nextUnlocked ? 'true' : 'false');
  };

  dec?.addEventListener('click', e => {
    e.preventDefault();
    const next = cycleIndicatorSize(-1);
    setIndicatorSize(next, true);
    scheduleRender();
  });
  med?.addEventListener('click', e => {
    e.preventDefault();
    setIndicatorSize('M', true);
    scheduleRender();
  });
  inc?.addEventListener('click', e => {
    e.preventDefault();
    const next = cycleIndicatorSize(1);
    setIndicatorSize(next, true);
    scheduleRender();
  });
  fit?.addEventListener('click', e => {
    e.preventDefault();
    setIndicatorRect(null);
    setIndicatorLayoutUnlocked(false);
    updateUnlockUi();
    scheduleRender();
  });
  unlock?.addEventListener('click', e => {
    e.preventDefault();
    const next = !getIndicatorLayoutUnlocked();
    setIndicatorLayoutUnlocked(next);
    if (next && !getIndicatorRect()) {
      const rect = root.getBoundingClientRect();
      setIndicatorRect(
        clampIndicatorRect({ x: rect.left, y: rect.top, width: rect.width, height: rect.height })
      );
    }
    updateUnlockUi();
    scheduleRender();
  });
  bind?.addEventListener('click', e => {
    e.preventDefault();
    const viewId = getCurrentViewId();
    if (typeof (window as any).openGuideBindingPanel === 'function') {
      (window as any).openGuideBindingPanel({ viewId, source: 'indicator' });
    }
  });

  header?.addEventListener('pointerdown', event => {
    if (!getIndicatorLayoutUnlocked()) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('.measurement-guide-indicator-controls')) return;
    event.preventDefault();
    const startRect = root.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const move = (moveEvent: PointerEvent) => {
      const nextRect = clampIndicatorRect({
        x: startRect.left + (moveEvent.clientX - startX),
        y: startRect.top + (moveEvent.clientY - startY),
        width: startRect.width,
        height: startRect.height,
      });
      setIndicatorRect(nextRect);
      root.style.left = `${nextRect.x}px`;
      root.style.top = `${nextRect.y}px`;
      root.style.width = `${nextRect.width}px`;
      root.style.height = `${nextRect.height}px`;
      root.style.right = 'auto';
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  resizeHandle?.addEventListener('pointerdown', event => {
    if (!getIndicatorLayoutUnlocked()) return;
    event.preventDefault();
    event.stopPropagation();
    const startRect = root.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const move = (moveEvent: PointerEvent) => {
      const nextRect = clampIndicatorRect({
        x: startRect.left,
        y: startRect.top,
        width: startRect.width + (moveEvent.clientX - startX),
        height: startRect.height + (moveEvent.clientY - startY),
      });
      setIndicatorRect(nextRect);
      root.style.width = `${nextRect.width}px`;
      root.style.height = `${nextRect.height}px`;
      root.style.left = `${nextRect.x}px`;
      root.style.top = `${nextRect.y}px`;
      root.style.right = 'auto';
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
}

function applyGuideOneTimeSeed(
  viewId: string,
  tag: string,
  options: { strictScope?: boolean; dispatchEvent?: boolean; isChipClick?: boolean } = {}
): void {
  const baseView = toBaseViewId(viewId);
  const scoped = getCwScopedViewKey(viewId);
  const activeView = toBaseViewId(
    String((window as any).app?.projectManager?.currentViewId || '') || baseView
  );
  const activeScoped = getCwScopedViewKey(activeView);
  const normalizedTag = normalizeLabel(tag);
  if (!normalizedTag) return;
  const keys = options.strictScope
    ? Array.from(new Set([scoped].filter(Boolean)))
    : Array.from(new Set([baseView, scoped, activeView, activeScoped].filter(Boolean)));

  (window as any).guideOneTimeTagByImage = (window as any).guideOneTimeTagByImage || {};
  (window as any).labelsByImage = (window as any).labelsByImage || {};
  (window as any).manualTagByImage = (window as any).manualTagByImage || {};

  if (options.isChipClick) {
    // Explicit chip click — override everything
    keys.forEach(key => {
      (window as any).guideOneTimeTagByImage[key] = normalizedTag;
      (window as any).labelsByImage[key] = normalizedTag;
      delete (window as any).manualTagByImage[key];
    });
  } else {
    // Passive render — don't interfere when user typed a tag or chip sequence is active
    keys.forEach(key => {
      if (!(window as any).manualTagByImage[key]) {
        (window as any).guideOneTimeTagByImage[key] = normalizedTag;
        (window as any).labelsByImage[key] = normalizedTag;
      }
    });
  }

  (window as any).currentImageLabel = scoped;

  const nextTagDisplay = document.getElementById('nextTagDisplay');
  // Don't overwrite nextTagDisplay when a manual override is active (unless this is a chip click)
  const hasManualOverride =
    !options.isChipClick &&
    keys.some(
      key =>
        (window as any).manualTagByImage?.[key] &&
        normalizeLabel((window as any).manualTagByImage[key]) !== normalizedTag
    );
  if (nextTagDisplay && document.activeElement !== nextTagDisplay && !hasManualOverride) {
    nextTagDisplay.textContent = normalizedTag;
  }

  if (options.dispatchEvent !== false) {
    dispatchGuideNextTagChanged(baseView, normalizedTag);
  }
}

function hideIndicator(): void {
  const root = ensureRoot();
  root.style.display = 'none';
  lastRenderKey = '';
}

function buildRoleChips(roles: string[], activeRole: string): string[] {
  if (!roles.length) {
    const chips = [activeRole];
    for (let i = 0; i < 4; i += 1) chips.push(incrementLabel(chips[chips.length - 1]));
    return chips;
  }

  const activeIndex = Math.max(
    0,
    roles.findIndex(role => role === activeRole)
  );
  const start = Math.max(0, activeIndex - 1);
  const sliced = roles.slice(start, start + MAX_CHIPS);
  return sliced.length ? sliced : roles.slice(0, MAX_CHIPS);
}

function findNextUnusedRole(roles: string[], used: Set<string>, startRole: string): string {
  if (!roles.length) return '';
  const startIndex = Math.max(
    0,
    roles.findIndex(role => normalizeLabel(role) === normalizeLabel(startRole))
  );

  for (let index = startIndex; index < roles.length; index += 1) {
    const candidate = normalizeLabel(roles[index]);
    if (candidate && !used.has(candidate)) {
      return candidate;
    }
  }

  for (let index = 0; index < startIndex; index += 1) {
    const candidate = normalizeLabel(roles[index]);
    if (candidate && !used.has(candidate)) {
      return candidate;
    }
  }

  return '';
}

async function renderIndicator(): Promise<void> {
  try {
    const root = ensureRoot();
    ensureHeaderToggle();
    const viewId = getCurrentViewId();
    const activeTool = getActiveToolName();
    const showForTool = DRAW_MEASUREMENT_TOOLS.has(activeTool);
    if (
      !showForTool ||
      !isIndicatorEnabled() ||
      isGuideOverlayVisible() ||
      isMeasurementSplitWorkspaceActive()
    ) {
      hideIndicator();
      return;
    }

    const activeGuide = resolveActiveGuideSelection(viewId);
    const code = activeGuide.code;
    const cwGuide = code
      ? { roles: [], strictScope: false, scopeKey: getCwScopedViewKey(viewId) }
      : getCwGuideScopeInfo(viewId);
    const usingCwGuide = !code && cwGuide.roles.length > 0;
    if (!code && !usingCwGuide) {
      hideIndicator();
      return;
    }

    const { roles, ok: guideOk } = code
      ? await getGuideRoles(code, activeGuide.variant)
      : { roles: cwGuide.roles, ok: true };
    if (!guideOk || !roles.length) {
      hideIndicator();
      return;
    }
    const used = getUsedStrokeLabels(viewId);

    const scoped = getCwScopedViewKey(viewId);
    const guideSeeds = (window as any).guideOneTimeTagByImage || {};
    const seeded = normalizeLabel(
      usingCwGuide && cwGuide.strictScope
        ? guideSeeds[cwGuide.scopeKey] || ''
        : guideSeeds[scoped] || guideSeeds[toBaseViewId(viewId)] || ''
    );

    // Check if the user has a manual tag sequence active (from chip click + draw, or typed tag)
    const manualTags = (window as any).manualTagByImage || {};
    const manualTag = normalizeLabel(manualTags[scoped] || manualTags[toBaseViewId(viewId)] || '');

    let activeRole = resolveGuideActiveRole(viewId, roles);
    // If the resolved role is already used (e.g. seed from a just-drawn stroke),
    // advance to the next unused role from that position instead of sticking on it.
    // Only auto-advance when:
    // 1. User didn't explicitly click a chip (manualChipOverride)
    // 2. A stroke was just created (within STROKE_ADVANCE_WINDOW)
    const timeSinceStroke = Date.now() - lastStrokeCreatedTime;
    const isStrokeCreatedRecently = timeSinceStroke < STROKE_ADVANCE_WINDOW;
    const skipAutoAdvance = manualChipOverride || !isStrokeCreatedRecently;
    manualChipOverride = false;
    if (activeRole && !skipAutoAdvance && used.has(normalizeLabel(activeRole))) {
      activeRole = findNextUnusedRole(roles, used, activeRole);
    }

    // If a manual tag sequence is active (e.g., G2 after drawing G1), try to show it
    // or advance from its position in the roles list
    if (!activeRole && manualTag) {
      if (roles.includes(manualTag) && !used.has(manualTag)) {
        activeRole = manualTag;
      } else {
        // Find next unused role starting from the manual tag's position
        activeRole = findNextUnusedRole(roles, used, manualTag);
      }
    }

    const seededRole =
      seeded && (roles.includes(seeded) || /^[A-Z](?:\d+)?$/.test(seeded)) ? seeded : '';
    if (!activeRole && seededRole) {
      activeRole = used.has(normalizeLabel(seededRole))
        ? findNextUnusedRole(roles, used, seededRole)
        : seededRole;
    }
    if (!activeRole) {
      activeRole = findNextUnusedRole(roles, used, roles[0] || '');
    }
    if (!activeRole) {
      const completedAllGuideRoles = roles.every(role => used.has(normalizeLabel(role)));
      if (completedAllGuideRoles) {
        if (allDoneAchievementFiredForView !== viewId) {
          allDoneAchievementFiredForView = viewId;
          showRewardAchievement('All measurements completed! 5 gems awarded.');
        }
        hideIndicator();
        return;
      }
      activeRole = getFallbackNextLabel(viewId);
    }
    if (!activeRole) {
      hideIndicator();
      return;
    }

    const chips = buildRoleChips(roles, activeRole);
    const chipHtml = chips
      .map(label => {
        const activeClass = label === activeRole ? ' active' : '';
        return `<button type="button" class="measurement-guide-indicator-chip${activeClass}" data-guide-role="${label}">${label}</button>`;
      })
      .join('');
    const heroUrl = code
      ? await fetchGuideRasterUrl(code, activeGuide.variant, {
          mode: 'preview',
          activeRole,
          dimInactive: true,
        })
      : '';

    const activeSize = resolveIndicatorSize(activeTool);
    const unlocked = getIndicatorLayoutUnlocked();
    const breadcrumb = usingCwGuide ? 'Bound: CW Import' : getBindingBreadcrumb(viewId);
    const renderKey = `${viewId}|${code || 'cw'}|${activeGuide.variant}|${activeRole}|${chips.join(',')}|${activeSize}|${unlocked ? 'u' : 'l'}|${breadcrumb}`;
    if (renderKey === lastRenderKey) {
      applyIndicatorPreset(root, activeSize);
      positionIndicator(root);
      applyGuideOneTimeSeed(viewId, activeRole, {
        strictScope: usingCwGuide && cwGuide.strictScope,
        dispatchEvent: false,
      });
      root.style.display = 'block';
      return;
    }
    lastRenderKey = renderKey;

    root.innerHTML = `
    <div class="measurement-guide-indicator-head">
      <span>Mini Guide</span>
      <strong>${activeRole}</strong>
      <div class="measurement-guide-indicator-controls">
        <button type="button" class="measurement-guide-indicator-ctl" data-guide-bind aria-label="Guide binding">Bind</button>
      </div>
    </div>
    <p class="measurement-guide-indicator-meta">${breadcrumb}</p>
    <div class="measurement-guide-indicator-hero">
      ${
        usingCwGuide
          ? `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;color:#e2e8f0;text-align:center;padding:12px;">
               <strong style="font-size:13px;letter-spacing:0.02em;">CW Import</strong>
               <span style="font-size:11px;color:#cbd5e1;">${toBaseViewId(viewId)}</span>
             </div>`
          : `<img src="${heroUrl}" alt="${code} ${activeGuide.variant.toUpperCase()}" />`
      }
    </div>
    <div class="measurement-guide-indicator-track">${chipHtml}</div>
  `;
    applyIndicatorPreset(root, activeSize);
    positionIndicator(root);
    applyGuideOneTimeSeed(viewId, activeRole, {
      strictScope: usingCwGuide && cwGuide.strictScope,
      dispatchEvent: false,
    });
    root.querySelectorAll('[data-guide-role]').forEach(node => {
      node.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const role = (event.currentTarget as HTMLElement | null)?.dataset.guideRole || '';
        if (!role) return;
        manualChipOverride = true;
        applyGuideOneTimeSeed(viewId, role, {
          strictScope: usingCwGuide && cwGuide.strictScope,
          isChipClick: true,
          dispatchEvent: false,
        });
        scheduleRender();
      });
    });
    bindIndicatorWindowControls(root);
    root.style.display = 'block';
  } catch (error) {
    console.error('[measurement-guide-indicator] Render error:', error);
    hideIndicator();
  }
}

function scheduleRender(): void {
  if (renderPending) return;

  const now = Date.now();
  const timeSinceLastRender = now - lastRenderTime;

  if (timeSinceLastRender < MIN_RENDER_INTERVAL) {
    renderPending = true;
    setTimeout(() => {
      renderPending = false;
      lastRenderTime = Date.now();
      void renderIndicator();
    }, MIN_RENDER_INTERVAL - timeSinceLastRender);
    return;
  }

  lastRenderTime = now;
  void renderIndicator();
}

export function initMeasurementGuideIndicator(): void {
  ensureStyles();
  scheduleRender();

  (window as any).setMeasurementGuideIndicatorVisible = (enabled: boolean) => {
    setIndicatorEnabled(enabled);
    syncHeaderToggleUi(enabled);
    scheduleRender();
    return enabled;
  };

  window.addEventListener('toolchange', scheduleRender);
  window.addEventListener('openpaint:stroke-created', (() => {
    lastStrokeCreatedTime = Date.now();
    scheduleRender();
  }) as EventListener);
  window.addEventListener('openpaint:guide-binding-changed', scheduleRender);
  window.addEventListener('openpaint:guide-split-changed', scheduleRender);
  window.addEventListener('openpaint:guide-next-tag-changed', scheduleRender as EventListener);
  window.addEventListener('openpaint:view-switched', scheduleRender as EventListener);
  window.addEventListener('resize', scheduleRender);
  window.addEventListener('keydown', event => {
    const root = document.getElementById(INDICATOR_ID);
    if (!(root instanceof HTMLElement) || root.style.display === 'none') return;
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable)
    ) {
      return;
    }
    if (event.key === '[') {
      event.preventDefault();
      setIndicatorSize(cycleIndicatorSize(-1), true);
      scheduleRender();
    } else if (event.key === ']') {
      event.preventDefault();
      setIndicatorSize(cycleIndicatorSize(1), true);
      scheduleRender();
    } else if (event.key === '0') {
      event.preventDefault();
      setIndicatorRect(null);
      setIndicatorLayoutUnlocked(false);
      scheduleRender();
    }
  });

  if (refreshTimer !== null) {
    window.clearInterval(refreshTimer);
  }
  refreshTimer = window.setInterval(() => {
    if (document.hidden) return;
    scheduleRender();
  }, 3000);
}
