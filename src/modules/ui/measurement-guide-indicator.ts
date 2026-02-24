const DRAW_MEASUREMENT_TOOLS = new Set(['line', 'curve']);
const INDICATOR_ID = 'measurementGuideIndicator';
const STYLE_ID = 'measurementGuideIndicatorStyles';
const GUIDE_CACHE_BUSTER = '2026-02-11-1';
const MAX_CHIPS = 7;
const GUIDE_TOGGLE_KEY = 'openpaint:measurementGuideIndicator:visible';

interface RoleCacheEntry {
  roles: string[];
  fetchedAt: number;
  ok: boolean;
}

const guideRoleCache = new Map<string, Promise<RoleCacheEntry>>();
let refreshTimer: number | null = null;
let lastRenderKey = '';

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
    const activeViewId = (input.dataset.activeViewId || '').trim().toLowerCase();
    if (activeViewId) return activeViewId;
  }
  const currentView = String((window as any).app?.projectManager?.currentViewId || 'front');
  return toBaseViewId(currentView);
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

function ensureHeaderToggle(): void {
  const header = document.getElementById('imagePanelHeader');
  if (!header) return;
  const controls = header.querySelector('.flex.items-center.gap-2');
  if (!controls) return;
  if (document.getElementById('measurementGuideToggle')) return;

  const button = document.createElement('button');
  button.id = 'measurementGuideToggle';
  button.type = 'button';
  button.className = 'text-slate-500 hover:text-slate-700 rounded-lg p-1 transition-colors';
  const enabled = isIndicatorEnabled();
  button.title = enabled ? 'Hide measurement guide' : 'Show measurement guide';
  button.setAttribute('aria-label', button.title);
  button.textContent = enabled ? 'Guide On' : 'Guide Off';

  button.addEventListener('click', () => {
    const next = !isIndicatorEnabled();
    setIndicatorEnabled(next);
    button.textContent = next ? 'Guide On' : 'Guide Off';
    button.title = next ? 'Hide measurement guide' : 'Show measurement guide';
    button.setAttribute('aria-label', button.title);
    scheduleRender();
  });

  controls.prepend(button);
}

function resolveScopedImageLabel(viewId: string): string {
  const metadataManager = (window as any).app?.metadataManager;
  if (typeof metadataManager?.normalizeImageLabel === 'function') {
    return String(metadataManager.normalizeImageLabel(viewId) || viewId);
  }
  if (typeof (window as any).getCaptureTabScopedLabel === 'function') {
    return String((window as any).getCaptureTabScopedLabel(viewId) || viewId);
  }
  return viewId;
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

function isGuideLockedToView(viewId: string): boolean {
  const metadata = getMetadata();
  const lockByView =
    metadata?.measurementGuideLockByView && typeof metadata.measurementGuideLockByView === 'object'
      ? metadata.measurementGuideLockByView
      : {};
  const candidates = getViewCandidates(viewId);
  return candidates.some(key => lockByView[key] === true);
}

function resolveGuideCode(viewId: string): string {
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
  viewId: string
): Promise<{ roles: string[]; ok: boolean }> {
  const key = `${code}::${normalizeView(viewId)}`;
  if (!guideRoleCache.has(key)) {
    guideRoleCache.set(
      key,
      (async () => {
        const response = await fetch(buildGuideUrl(code, viewId), { method: 'GET' });
        if (!response.ok) {
          return { roles: [], fetchedAt: Date.now(), ok: false };
        }
        const svgText = await response.text();
        return { roles: parseGuideRoles(svgText), fetchedAt: Date.now(), ok: true };
      })()
    );
  }
  const cached = await guideRoleCache.get(key);
  const roles = (cached?.roles || []).filter(role => /^[A-Z]\d+$/.test(role));
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
      width: min(220px, calc(100vw - 24px));
      border-radius: 12px;
      border: 1px solid rgba(148, 163, 184, 0.5);
      background: rgba(15, 23, 42, 0.85);
      box-shadow: 0 16px 32px rgba(2, 6, 23, 0.35);
      overflow: hidden;
      backdrop-filter: blur(6px);
      pointer-events: auto;
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
    .measurement-guide-indicator-head strong {
      font-size: 12px;
      letter-spacing: 0.02em;
      color: #f8fafc;
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

function applyGuideOneTimeSeed(viewId: string, tag: string): void {
  const baseView = toBaseViewId(viewId);
  const scoped = resolveScopedImageLabel(viewId);
  const activeView = toBaseViewId(
    String((window as any).app?.projectManager?.currentViewId || '') || baseView
  );
  const activeScoped = resolveScopedImageLabel(activeView);
  const normalizedTag = normalizeLabel(tag);
  if (!normalizedTag) return;

  (window as any).guideOneTimeTagByImage = (window as any).guideOneTimeTagByImage || {};
  (window as any).guideOneTimeTagByImage[baseView] = normalizedTag;
  (window as any).guideOneTimeTagByImage[scoped] = normalizedTag;
  (window as any).guideOneTimeTagByImage[activeView] = normalizedTag;
  (window as any).guideOneTimeTagByImage[activeScoped] = normalizedTag;

  (window as any).labelsByImage = (window as any).labelsByImage || {};
  (window as any).labelsByImage[baseView] = normalizedTag;
  (window as any).labelsByImage[scoped] = normalizedTag;
  (window as any).labelsByImage[activeView] = normalizedTag;
  (window as any).labelsByImage[activeScoped] = normalizedTag;

  (window as any).manualTagByImage = (window as any).manualTagByImage || {};
  delete (window as any).manualTagByImage[baseView];
  delete (window as any).manualTagByImage[scoped];
  delete (window as any).manualTagByImage[activeView];
  delete (window as any).manualTagByImage[activeScoped];

  (window as any).currentImageLabel = scoped;

  const nextTagDisplay = document.getElementById('nextTagDisplay');
  if (nextTagDisplay && document.activeElement !== nextTagDisplay) {
    nextTagDisplay.textContent = normalizedTag;
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

async function renderIndicator(): Promise<void> {
  const root = ensureRoot();
  ensureHeaderToggle();
  const viewId = getCurrentViewId();
  const activeTool = getActiveToolName();
  const showForTool = DRAW_MEASUREMENT_TOOLS.has(activeTool);
  if (!showForTool || !isIndicatorEnabled() || isGuideOverlayVisible()) {
    hideIndicator();
    return;
  }

  if (!isGuideLockedToView(viewId)) {
    hideIndicator();
    return;
  }

  const code = resolveGuideCode(viewId);
  if (!code) {
    hideIndicator();
    return;
  }

  const { roles, ok: guideOk } = await getGuideRoles(code, viewId);
  if (!guideOk) {
    hideIndicator();
    return;
  }
  const used = getUsedStrokeLabels(viewId);

  const scoped = resolveScopedImageLabel(viewId);
  const guideSeeds = (window as any).guideOneTimeTagByImage || {};
  const seeded = normalizeLabel(guideSeeds[scoped] || guideSeeds[toBaseViewId(viewId)] || '');

  let activeRole =
    (seeded && (roles.includes(seeded) || /^[A-Z]\d+$/.test(seeded)) ? seeded : '') ||
    roles.find(role => !used.has(normalizeLabel(role))) ||
    '';
  if (!activeRole) {
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

  const renderKey = `${viewId}|${code}|${activeRole}|${chips.join(',')}`;
  if (renderKey === lastRenderKey) {
    positionIndicator(root);
    applyGuideOneTimeSeed(viewId, activeRole);
    root.style.display = 'block';
    return;
  }
  lastRenderKey = renderKey;

  root.innerHTML = `
    <div class="measurement-guide-indicator-head">
      <span>Guide</span>
      <strong>${activeRole}</strong>
    </div>
    <div class="measurement-guide-indicator-hero">
      <img src="${buildGuideUrl(code, viewId)}" alt="Measurement guide ${code}" />
    </div>
    <div class="measurement-guide-indicator-track">${chipHtml}</div>
  `;
  positionIndicator(root);
  applyGuideOneTimeSeed(viewId, activeRole);
  root.querySelectorAll('[data-guide-role]').forEach(node => {
    node.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const role = (event.currentTarget as HTMLElement | null)?.dataset.guideRole || '';
      if (!role) return;
      applyGuideOneTimeSeed(viewId, role);
      scheduleRender();
    });
  });
  root.style.display = 'block';
}

function scheduleRender(): void {
  void renderIndicator();
}

export function initMeasurementGuideIndicator(): void {
  ensureStyles();
  scheduleRender();

  window.addEventListener('toolchange', scheduleRender);
  window.addEventListener('openpaint:stroke-created', scheduleRender as EventListener);
  window.addEventListener('resize', scheduleRender);

  if (refreshTimer !== null) {
    window.clearInterval(refreshTimer);
  }
  refreshTimer = window.setInterval(() => {
    scheduleRender();
  }, 1500);
}
