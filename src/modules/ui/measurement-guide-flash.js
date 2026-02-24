const HOTKEY = 'Backslash';
const VIEWS = ['front', 'back', 'side'];
const FLASH_DURATION_MS = 1200;
const GUIDE_HINT_KEY = 'openpaint:guideFlashHintSeen:v1';
const GUIDE_CACHE_KEY = '2026-02-11-1';
const GUIDE_WINDOW_PREFS_KEY = 'openpaint:guideWindowPrefs:v1';
const FLASH_SIZE_ORDER = ['S', 'M', 'L', 'XL'];

let flashOverlay = null;
let galleryOverlay = null;
let hideTimer = null;
let activeIndex = 0;
let hintToastTimer = null;
let isGuidePinnedVisible = false;
let pinnedSourceViewId = null;
let pinnedLockToImage = false;
let lastRenderedViewId = null;
let gallerySelectHandler = null;

function getWindowPrefs() {
  try {
    const raw = localStorage.getItem(GUIDE_WINDOW_PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function setWindowPrefs(patch) {
  const next = { ...getWindowPrefs(), ...patch };
  try {
    localStorage.setItem(GUIDE_WINDOW_PREFS_KEY, JSON.stringify(next));
  } catch {
    // no-op
  }
}

function normalizeFlashSize(value) {
  const raw = String(value || '').toUpperCase();
  return FLASH_SIZE_ORDER.includes(raw) ? raw : 'L';
}

function getFlashSize() {
  return normalizeFlashSize(getWindowPrefs().flashSize);
}

function setFlashSize(size, manual = true) {
  setWindowPrefs({ flashSize: normalizeFlashSize(size), flashManualSize: manual === true });
}

function cycleFlashSize(delta) {
  const current = getFlashSize();
  const index = FLASH_SIZE_ORDER.indexOf(current);
  const nextIndex = Math.max(0, Math.min(FLASH_SIZE_ORDER.length - 1, index + delta));
  return FLASH_SIZE_ORDER[nextIndex];
}

function getFlashRect() {
  const rect = getWindowPrefs().flashRect;
  if (!rect || typeof rect !== 'object') return null;
  const x = Number(rect.x);
  const y = Number(rect.y);
  const width = Number(rect.width);
  const height = Number(rect.height);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  return { x, y, width, height };
}

function setFlashRect(rect) {
  if (!rect) {
    const prefs = getWindowPrefs();
    delete prefs.flashRect;
    try {
      localStorage.setItem(GUIDE_WINDOW_PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // no-op
    }
    return;
  }
  setWindowPrefs({ flashRect: rect });
}

function clampFlashRect(rect) {
  const minWidth = 360;
  const minHeight = 260;
  const maxWidth = Math.max(minWidth, window.innerWidth - 16);
  const maxHeight = Math.max(minHeight, window.innerHeight - 16);
  const width = Math.max(minWidth, Math.min(maxWidth, rect.width));
  const height = Math.max(minHeight, Math.min(maxHeight, rect.height));
  const x = Math.max(8, Math.min(window.innerWidth - width - 8, rect.x));
  const y = Math.max(8, Math.min(window.innerHeight - height - 8, rect.y));
  return { x, y, width, height };
}

function applyFlashWindowLayout(root) {
  if (!root) return;
  const size = getFlashSize();
  const widthBySize = { S: 520, M: 760, L: 1020, XL: 1320 };
  const width = Math.min(widthBySize[size] || 1020, window.innerWidth - 16);
  root.dataset.size = size;
  root.style.left = '50%';
  root.style.top = '12px';
  root.style.right = 'auto';
  root.style.transform = 'translateX(-50%)';
  root.style.width = `${width}px`;
  root.style.height = '';

  const stored = getFlashRect();
  if (stored) {
    const clamped = clampFlashRect(stored);
    root.style.transform = 'none';
    root.style.left = `${clamped.x}px`;
    root.style.top = `${clamped.y}px`;
    root.style.width = `${clamped.width}px`;
    root.style.height = `${clamped.height}px`;
  }
}

function getMetadata() {
  return window.app?.projectManager?.getProjectMetadata?.() || window.projectMetadata || {};
}

function getCurrentViewId() {
  const input = document.getElementById('currentImageNameBox');
  if (input instanceof HTMLInputElement) {
    const typed = String(input.value || '')
      .trim()
      .toLowerCase();
    if (typed === 'front' || typed === 'back' || typed === 'side') {
      return typed;
    }

    const activeViewId = String(input.dataset.activeViewId || '').trim();
    if (activeViewId) return activeViewId;
  }

  return String(window.app?.projectManager?.currentViewId || '').trim() || 'front';
}

function normalizeCode(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '-')
    .toUpperCase();
}

function parseCodes(value) {
  return Array.from(
    new Set(
      String(value || '')
        .split(',')
        .map(item => normalizeCode(item))
        .filter(Boolean)
    )
  );
}

function toBaseViewId(viewId) {
  const raw = String(viewId || '').trim();
  if (!raw) return 'front';
  if (raw.includes('::')) return raw.split('::')[0] || raw;
  return raw;
}

function getViewCandidates(viewId) {
  const base = toBaseViewId(viewId);
  return Array.from(new Set([String(viewId || '').trim(), base].filter(Boolean)));
}

function getGuideBinding(viewId) {
  const metadata = getMetadata();
  const bindings =
    metadata?.measurementGuideBindingsByScope &&
    typeof metadata.measurementGuideBindingsByScope === 'object'
      ? metadata.measurementGuideBindingsByScope
      : {};
  const candidates = getViewCandidates(viewId);
  for (const candidate of candidates) {
    const entry = bindings[candidate];
    if (!entry || typeof entry !== 'object') continue;
    const codes = Array.isArray(entry.codes)
      ? entry.codes.map(code => normalizeCode(code)).filter(Boolean)
      : [];
    const activeCode = normalizeCode(entry.activeCode || codes[0] || '');
    const locked = entry.locked === true;
    if (codes.length || activeCode || locked) {
      const scopeType = candidate === String(viewId || '').trim() ? 'frame' : 'view';
      return { codes, activeCode, locked, scopeType, scopeId: candidate };
    }
  }

  const projectBinding = bindings.__project__;
  if (projectBinding && typeof projectBinding === 'object') {
    const codes = Array.isArray(projectBinding.codes)
      ? projectBinding.codes.map(code => normalizeCode(code)).filter(Boolean)
      : [];
    const activeCode = normalizeCode(projectBinding.activeCode || codes[0] || '');
    const locked = projectBinding.locked === true;
    if (codes.length || activeCode || locked) {
      return {
        codes,
        activeCode,
        locked,
        scopeType: 'project',
        scopeId: '__project__',
      };
    }
  }

  const defaults =
    metadata?.measurementGuideProjectDefaults &&
    typeof metadata.measurementGuideProjectDefaults === 'object'
      ? metadata.measurementGuideProjectDefaults
      : {};
  const fallbackCodes = Array.isArray(defaults.codes)
    ? defaults.codes.map(code => normalizeCode(code)).filter(Boolean)
    : [];
  const fallbackActive = normalizeCode(defaults.activeCode || fallbackCodes[0] || '');
  if (fallbackCodes.length || fallbackActive) {
    return {
      codes: fallbackCodes,
      activeCode: fallbackActive,
      locked: false,
      scopeType: 'default',
      scopeId: '__default__',
    };
  }
  return {
    codes: [],
    activeCode: '',
    locked: false,
    scopeType: 'default',
    scopeId: '__default__',
  };
}

function getBindingBreadcrumb(viewId = getCurrentViewId()) {
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

function resolveGuideCodes() {
  const metadata = getMetadata();
  const fromArray = Array.isArray(metadata.measurementGuideCodes)
    ? metadata.measurementGuideCodes.map(code => normalizeCode(code)).filter(Boolean)
    : [];
  if (fromArray.length) {
    return fromArray;
  }
  const fallback = metadata.measurementGuideCode || '';
  return parseCodes(fallback);
}

function resolveGuideCodesByView(viewId) {
  const binding = getGuideBinding(viewId);
  if (binding.activeCode)
    return [binding.activeCode, ...binding.codes.filter(c => c !== binding.activeCode)];
  if (binding.codes.length) return binding.codes;

  const metadata = getMetadata();
  const byView =
    metadata?.measurementGuideCodesByView &&
    typeof metadata.measurementGuideCodesByView === 'object'
      ? metadata.measurementGuideCodesByView
      : {};
  const candidates = getViewCandidates(viewId);
  const fromView = candidates
    .flatMap(candidate =>
      Array.isArray(byView[candidate]) ? byView[candidate].map(code => normalizeCode(code)) : []
    )
    .filter(Boolean);
  return fromView;
}

function isGuideLockedToView(viewId) {
  const binding = getGuideBinding(viewId);
  if (binding.locked) return true;
  const metadata = getMetadata();
  const lockByView =
    metadata?.measurementGuideLockByView && typeof metadata.measurementGuideLockByView === 'object'
      ? metadata.measurementGuideLockByView
      : {};
  return getViewCandidates(viewId).some(candidate => lockByView[candidate] === true);
}

function resolveGuideContext(viewId = getCurrentViewId()) {
  const scopedCodes = resolveGuideCodesByView(viewId);
  if (scopedCodes.length) {
    return {
      viewId,
      codes: scopedCodes,
      lockToImage: isGuideLockedToView(viewId),
      scoped: true,
    };
  }

  return {
    viewId,
    codes: resolveGuideCodes(),
    lockToImage: isGuideLockedToView(viewId),
    scoped: false,
  };
}

function isTypingContext(target) {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    target.isContentEditable ||
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.closest('[contenteditable="true"]') !== null
  );
}

function ensureStyles() {
  if (document.getElementById('measurementGuideFlashStyles')) return;
  const style = document.createElement('style');
  style.id = 'measurementGuideFlashStyles';
  style.textContent = `
    .guide-flash-overlay {
      position: fixed;
      left: 50%;
      top: 10px;
      width: min(1020px, calc(100vw - 24px));
      z-index: 13300;
      background: rgba(15, 23, 42, 0.28);
      border: 1px solid rgba(148, 163, 184, 0.4);
      border-radius: 14px;
      box-shadow: 0 22px 55px rgba(15, 23, 42, 0.28);
      backdrop-filter: blur(6px);
      color: #f8fafc;
      transform: translate(-50%, -6px) scale(0.98);
      opacity: 0;
      transition: opacity 120ms ease, transform 120ms ease, left 140ms ease, top 140ms ease, width 160ms ease, height 160ms ease;
      pointer-events: none;
      overflow: hidden;
    }
    .guide-flash-overlay.visible {
      opacity: 1;
      transform: translate(-50%, 0) scale(1);
      pointer-events: all;
    }
    .guide-flash-head {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 10px;
      padding: 10px 12px 8px;
      border-bottom: 1px solid rgba(148, 163, 184, 0.3);
      cursor: move;
    }
    .guide-flash-title { font-size: 13px; font-weight: 700; letter-spacing: .02em; color: #f8fafc; }
    .guide-flash-sub { font-size: 11px; color: #cbd5e1; }
    .guide-flash-close {
      width: 26px;
      height: 26px;
      border-radius: 999px;
      border: 1px solid rgba(226, 232, 240, 0.5);
      background: rgba(15, 23, 42, 0.72);
      color: #f8fafc;
      font-size: 16px;
      line-height: 1;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-left: 6px;
    }
    .guide-flash-close:hover {
      background: rgba(15, 23, 42, 0.92);
      border-color: rgba(248, 250, 252, 0.9);
    }
    .guide-flash-controls {
      margin-left: auto;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .guide-flash-ctl {
      border: 1px solid rgba(226, 232, 240, 0.5);
      background: rgba(15, 23, 42, 0.72);
      color: #f8fafc;
      font-size: 10px;
      border-radius: 6px;
      min-width: 20px;
      height: 20px;
      line-height: 1;
      font-weight: 700;
      cursor: pointer;
      padding: 0 5px;
    }
    .guide-flash-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      padding: 10px;
    }
    .guide-flash-card {
      background: rgba(248, 250, 252, 0.12);
      border: 1px solid rgba(148, 163, 184, 0.3);
      border-radius: 10px;
      overflow: hidden;
      min-height: 220px;
      display: flex;
      flex-direction: column;
      min-height: min(62vh, 760px);
    }
    .guide-flash-label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .06em;
      padding: 7px 9px;
      border-bottom: 1px solid rgba(148, 163, 184, 0.3);
      color: #e2e8f0;
    }
    .guide-flash-body {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 8px;
      background: rgba(255, 255, 255, 0.08);
      position: relative;
      min-height: 220px;
    }
    .guide-flash-body img { width: 100%; height: 100%; max-height: min(78vh, 980px); object-fit: contain; }
    .guide-flash-nav {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      width: 34px;
      height: 34px;
      border-radius: 999px;
      border: 1px solid rgba(226, 232, 240, 0.55);
      background: rgba(15, 23, 42, 0.7);
      color: #f8fafc;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      line-height: 1;
      font-weight: 700;
      cursor: pointer;
      user-select: none;
      transition: background 120ms ease, border-color 120ms ease;
    }
    .guide-flash-nav:hover {
      background: rgba(15, 23, 42, 0.9);
      border-color: rgba(248, 250, 252, 0.8);
    }
    .guide-flash-nav.prev { left: 10px; }
    .guide-flash-nav.next { right: 10px; }
    .guide-flash-lock {
      margin-left: auto;
      font-size: 11px;
      color: #e2e8f0;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      user-select: none;
    }
    .guide-flash-lock input { cursor: pointer; }
    .guide-flash-empty { font-size: 11px; color: #94a3b8; text-align: center; }
    .guide-flash-resize {
      position: absolute;
      right: 0;
      bottom: 0;
      width: 18px;
      height: 18px;
      cursor: nwse-resize;
    }
    .guide-flash-resize::before {
      content: '';
      position: absolute;
      right: 4px;
      bottom: 4px;
      width: 8px;
      height: 8px;
      border-right: 2px solid rgba(186, 230, 253, 0.85);
      border-bottom: 2px solid rgba(186, 230, 253, 0.85);
    }
    @media (max-width: 900px) {
      .guide-flash-grid { grid-template-columns: 1fr; }
      .guide-flash-card { min-height: 140px; }
    }

    .guide-flash-toast {
      position: fixed;
      right: 14px;
      bottom: 14px;
      z-index: 13320;
      max-width: min(460px, calc(100vw - 24px));
      background: rgba(15, 23, 42, 0.92);
      color: #f8fafc;
      border: 1px solid rgba(148, 163, 184, 0.35);
      border-radius: 10px;
      box-shadow: 0 14px 28px rgba(2, 6, 23, 0.45);
      padding: 10px 12px;
      font-size: 12px;
      line-height: 1.35;
      opacity: 0;
      transform: translateY(8px);
      transition: opacity 140ms ease, transform 140ms ease;
      pointer-events: none;
    }
    .guide-flash-toast.visible {
      opacity: 1;
      transform: translateY(0);
    }

    .guide-gallery-overlay {
      position: fixed;
      inset: 0;
      z-index: 13400;
      background: rgba(15, 23, 42, 0.85);
      backdrop-filter: blur(8px);
      opacity: 0;
      transition: opacity 150ms ease;
      pointer-events: none;
      overflow-y: auto;
    }
    .guide-gallery-overlay.visible {
      opacity: 1;
      pointer-events: all;
    }
    .guide-gallery-container {
      max-width: 1400px;
      margin: 40px auto;
      padding: 0 20px 40px;
    }
    .guide-gallery-header {
      background: rgba(255, 255, 255, 0.98);
      border-radius: 14px;
      padding: 20px 24px;
      margin-bottom: 20px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
    }
    .guide-gallery-title {
      font-size: 20px;
      font-weight: 700;
      color: #0f172a;
      margin: 0 0 12px;
    }
    .guide-gallery-search {
      width: 100%;
      padding: 10px 14px;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      font-size: 14px;
      outline: none;
    }
    .guide-gallery-search:focus {
      border-color: #3b82f6;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
    }
    .guide-gallery-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 16px;
    }
    .guide-gallery-item {
      background: rgba(255, 255, 255, 0.98);
      border: 1px solid rgba(203, 213, 225, 0.8);
      border-radius: 12px;
      overflow: hidden;
      cursor: pointer;
      transition: transform 120ms ease, box-shadow 120ms ease;
    }
    .guide-gallery-item:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.2);
    }
    .guide-gallery-item-label {
      font-size: 13px;
      font-weight: 700;
      color: #0f172a;
      padding: 10px 12px;
      border-bottom: 1px solid rgba(203, 213, 225, 0.6);
    }
    .guide-gallery-item-body {
      padding: 12px;
      background: #ffffff;
      min-height: 240px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .guide-gallery-item-body img {
      width: 100%;
      height: auto;
      max-height: 280px;
      object-fit: contain;
    }
    .guide-gallery-close {
      position: fixed;
      top: 20px;
      right: 20px;
      background: rgba(255, 255, 255, 0.98);
      border: 1px solid rgba(203, 213, 225, 0.8);
      border-radius: 8px;
      padding: 8px 16px;
      font-size: 13px;
      font-weight: 600;
      color: #0f172a;
      cursor: pointer;
      z-index: 13401;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }
    .guide-gallery-close:hover {
      background: #f1f5f9;
    }
  `;
  document.head.appendChild(style);
}

function shouldShowHintToast() {
  try {
    return localStorage.getItem(GUIDE_HINT_KEY) !== '1';
  } catch {
    return true;
  }
}

function markHintToastShown() {
  try {
    localStorage.setItem(GUIDE_HINT_KEY, '1');
  } catch {
    // no-op
  }
}

function showShortcutToast() {
  if (!shouldShowHintToast()) return;
  ensureStyles();

  let toast = document.getElementById('guideFlashShortcutToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'guideFlashShortcutToast';
    toast.className = 'guide-flash-toast';
    document.body.appendChild(toast);
  }

  toast.textContent =
    'Hint: \\ shows guides/gallery. Alt+\\ gallery. Ctrl+\\ add codes. Shift+\\ next.';
  requestAnimationFrame(() => toast.classList.add('visible'));

  if (hintToastTimer) {
    clearTimeout(hintToastTimer);
  }
  hintToastTimer = setTimeout(() => {
    toast?.classList.remove('visible');
  }, 2800);

  markHintToastShown();
}

function buildGuideUrl(code, view) {
  const normalizedView = String(view || 'front').toLowerCase();
  return `/api/measurement-guides/svg?code=${encodeURIComponent(code)}&view=${encodeURIComponent(normalizedView)}&v=${encodeURIComponent(GUIDE_CACHE_KEY)}`;
}

function attachGuideImageRecovery(root) {
  if (!root) return;
  root.querySelectorAll('img[data-guide-code][data-guide-view]').forEach(img => {
    if (img.dataset.retryBound === '1') return;
    img.dataset.retryBound = '1';
    img.addEventListener('error', () => {
      if (img.dataset.retried === '1') return;
      img.dataset.retried = '1';
      const code = img.dataset.guideCode;
      const view = img.dataset.guideView || 'front';
      if (!code) return;
      img.src = `${buildGuideUrl(code, view)}&cb=${Date.now()}`;
    });
  });
}

function resolveScopeId(viewId, bindingTarget = 'frame') {
  if (bindingTarget === 'project') return '__project__';
  if (bindingTarget === 'view') return toBaseViewId(viewId);
  return String(viewId || '').trim() || 'front';
}

function saveGuideSettings({ viewId, codes, lockToImage, bindingTarget = 'frame' }) {
  const manager = window.app?.projectManager;
  const metadata = getMetadata();
  const normalizedCodes = Array.from(
    new Set((codes || []).map(code => normalizeCode(code)).filter(Boolean))
  );
  const scopeId = resolveScopeId(viewId, bindingTarget);
  const fallbackView = String(viewId || '').trim() || 'front';
  const fallbackBaseView = toBaseViewId(fallbackView);
  const nextCodesByView = {
    ...(metadata.measurementGuideCodesByView &&
    typeof metadata.measurementGuideCodesByView === 'object'
      ? metadata.measurementGuideCodesByView
      : {}),
  };
  const nextLockByView = {
    ...(metadata.measurementGuideLockByView &&
    typeof metadata.measurementGuideLockByView === 'object'
      ? metadata.measurementGuideLockByView
      : {}),
  };
  if (bindingTarget === 'view') {
    nextCodesByView[fallbackBaseView] = [...normalizedCodes];
    nextLockByView[fallbackBaseView] = lockToImage === true;
  } else if (bindingTarget === 'frame') {
    nextCodesByView[fallbackView] = [...normalizedCodes];
    nextLockByView[fallbackView] = lockToImage === true;
  }

  const nextLibraryCodes = Array.from(
    new Set([
      ...(Array.isArray(metadata.measurementGuideLibraryCodes)
        ? metadata.measurementGuideLibraryCodes.map(code => normalizeCode(code)).filter(Boolean)
        : []),
      ...normalizedCodes,
    ])
  );

  const nextBindingsByScope = {
    ...(metadata.measurementGuideBindingsByScope &&
    typeof metadata.measurementGuideBindingsByScope === 'object'
      ? metadata.measurementGuideBindingsByScope
      : {}),
  };
  if (scopeId) {
    nextBindingsByScope[scopeId] = {
      codes: [...normalizedCodes],
      activeCode: normalizedCodes[0] || '',
      locked: lockToImage === true,
      tagModeHint: 'auto',
    };
  }

  const existingDefaults =
    metadata.measurementGuideProjectDefaults &&
    typeof metadata.measurementGuideProjectDefaults === 'object'
      ? metadata.measurementGuideProjectDefaults
      : {};
  const defaultCodes = normalizedCodes.length
    ? [...normalizedCodes]
    : Array.isArray(existingDefaults.codes)
      ? existingDefaults.codes.map(code => normalizeCode(code)).filter(Boolean)
      : [];

  const payload = {
    measurementGuideCodes: normalizedCodes,
    measurementGuideCode: normalizedCodes[0] || '',
    measurementGuideCodesByView: nextCodesByView,
    measurementGuideLockByView: nextLockByView,
    measurementGuideLibraryCodes: nextLibraryCodes,
    measurementGuideBindingsByScope: nextBindingsByScope,
    measurementGuideProjectDefaults: {
      codes: defaultCodes,
      activeCode: defaultCodes[0] || '',
    },
  };
  if (manager?.setProjectMetadata) {
    manager.setProjectMetadata(payload);
    return;
  }
  window.projectMetadata = {
    ...(window.projectMetadata || {}),
    ...payload,
  };
}

function saveGuideCodes(codes, viewId = getCurrentViewId()) {
  saveGuideSettings({ viewId, codes, lockToImage: isGuideLockedToView(viewId) });
}

function setGuideLockForView(viewId, lockToImage) {
  const context = resolveGuideContext(viewId);
  const codes = context.codes || [];
  if (!codes.length) return;
  saveGuideSettings({ viewId, codes, lockToImage });
}

function resolveSlides(codes, lockedView = null) {
  const slides = [];
  const normalizedLocked = toBaseViewId(String(lockedView || '')).toLowerCase();
  const scopedLockedView = ['front', 'back', 'side'].includes(normalizedLocked)
    ? normalizedLocked
    : null;
  codes.forEach(code => {
    if (scopedLockedView) {
      slides.push({ code, view: scopedLockedView });
      return;
    }
    VIEWS.forEach(view => {
      slides.push({ code, view });
    });
  });
  return slides;
}

function ensureOverlay(slide, slideCount) {
  ensureStyles();
  if (!flashOverlay) {
    flashOverlay = document.createElement('section');
    flashOverlay.className = 'guide-flash-overlay';
    document.body.appendChild(flashOverlay);
  }
  const sourceViewId = pinnedSourceViewId || getCurrentViewId();
  const isLocked = pinnedLockToImage === true;
  const title = `${slide.code} · ${String(slide.view).toUpperCase()}`;
  const hint = `${activeIndex + 1}/${slideCount} · \\ toggle · Alt+\\ gallery · Shift+\\ next`;
  const bindingText = getBindingBreadcrumb(sourceViewId);
  const url = buildGuideUrl(slide.code, slide.view);
  flashOverlay.innerHTML = `
    <div class="guide-flash-head">
      <div class="guide-flash-title">Measurement Guide Flash</div>
      <label class="guide-flash-lock" title="Lock this guide selection to image ${sourceViewId}">
        <input id="guideFlashLockToggle" type="checkbox" ${isLocked ? 'checked' : ''} />
        Lock to image (${sourceViewId})
      </label>
      <div class="guide-flash-sub">${bindingText} · ${hint}</div>
      <div class="guide-flash-controls">
        <button type="button" class="guide-flash-ctl" data-flash-size-dec aria-label="Smaller guide">-</button>
        <button type="button" class="guide-flash-ctl" data-flash-size-med aria-label="Medium guide">M</button>
        <button type="button" class="guide-flash-ctl" data-flash-size-inc aria-label="Larger guide">+</button>
        <button type="button" class="guide-flash-ctl" data-flash-size-fit aria-label="Fit guide">Fit</button>
        <button type="button" class="guide-flash-ctl" data-flash-bind aria-label="Guide binding">Bind</button>
      </div>
      <button type="button" class="guide-flash-close" aria-label="Close guide flash">×</button>
    </div>
    <div class="guide-flash-grid" style="grid-template-columns: 1fr;">
      <article class="guide-flash-card">
        <div class="guide-flash-label">${title}</div>
        <div class="guide-flash-body">
          <button type="button" class="guide-flash-nav prev" aria-label="Previous guide">&#8249;</button>
          <img src="${url}" alt="${slide.view} model for ${slide.code}" />
          <button type="button" class="guide-flash-nav next" aria-label="Next guide">&#8250;</button>
        </div>
      </article>
    </div>
    <div class="guide-flash-resize" aria-hidden="true"></div>
  `;
  const img = flashOverlay.querySelector('img');
  if (img) {
    img.dataset.guideCode = slide.code;
    img.dataset.guideView = slide.view;
  }

  const lockToggle = flashOverlay.querySelector('#guideFlashLockToggle');
  lockToggle?.addEventListener('change', e => {
    const checked = e.target?.checked === true;
    pinnedLockToImage = checked;
    if (sourceViewId) {
      setGuideLockForView(sourceViewId, checked);
    }
  });

  const prevBtn = flashOverlay.querySelector('.guide-flash-nav.prev');
  prevBtn?.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    showGuideFlash({ cycleDelta: -1, holdMode: isGuidePinnedVisible, preservePinnedContext: true });
  });

  const nextBtn = flashOverlay.querySelector('.guide-flash-nav.next');
  nextBtn?.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    showGuideFlash({ cycleDelta: 1, holdMode: isGuidePinnedVisible, preservePinnedContext: true });
  });

  const closeBtn = flashOverlay.querySelector('.guide-flash-close');
  closeBtn?.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    isGuidePinnedVisible = false;
    hideGuideFlash();
  });

  attachGuideImageRecovery(flashOverlay);
  bindFlashWindowControls(flashOverlay);
  applyFlashWindowLayout(flashOverlay);
}

function bindFlashWindowControls(root) {
  if (!root) return;

  const dec = root.querySelector('[data-flash-size-dec]');
  const med = root.querySelector('[data-flash-size-med]');
  const inc = root.querySelector('[data-flash-size-inc]');
  const fit = root.querySelector('[data-flash-size-fit]');
  const bind = root.querySelector('[data-flash-bind]');
  const head = root.querySelector('.guide-flash-head');
  const resize = root.querySelector('.guide-flash-resize');

  dec?.addEventListener('click', e => {
    e.preventDefault();
    setFlashSize(cycleFlashSize(-1), true);
    applyFlashWindowLayout(root);
  });
  med?.addEventListener('click', e => {
    e.preventDefault();
    setFlashSize('M', true);
    applyFlashWindowLayout(root);
  });
  inc?.addEventListener('click', e => {
    e.preventDefault();
    setFlashSize(cycleFlashSize(1), true);
    applyFlashWindowLayout(root);
  });
  fit?.addEventListener('click', e => {
    e.preventDefault();
    setFlashRect(null);
    applyFlashWindowLayout(root);
  });
  bind?.addEventListener('click', e => {
    e.preventDefault();
    openGuideBindingPanel({ viewId: pinnedSourceViewId || getCurrentViewId(), source: 'flash' });
  });

  head?.addEventListener('pointerdown', event => {
    const target = event.target;
    if (target?.closest('.guide-flash-controls')) return;
    if (target?.closest('.guide-flash-close')) return;
    if (target?.closest('.guide-flash-lock')) return;
    event.preventDefault();
    const startRect = root.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const move = moveEvent => {
      const nextRect = clampFlashRect({
        x: startRect.left + (moveEvent.clientX - startX),
        y: startRect.top + (moveEvent.clientY - startY),
        width: startRect.width,
        height: startRect.height,
      });
      setFlashRect(nextRect);
      root.style.transform = 'none';
      root.style.left = `${nextRect.x}px`;
      root.style.top = `${nextRect.y}px`;
      root.style.width = `${nextRect.width}px`;
      root.style.height = `${nextRect.height}px`;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  resize?.addEventListener('pointerdown', event => {
    event.preventDefault();
    event.stopPropagation();
    const startRect = root.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const move = moveEvent => {
      const nextRect = clampFlashRect({
        x: startRect.left,
        y: startRect.top,
        width: startRect.width + (moveEvent.clientX - startX),
        height: startRect.height + (moveEvent.clientY - startY),
      });
      setFlashRect(nextRect);
      root.style.transform = 'none';
      root.style.left = `${nextRect.x}px`;
      root.style.top = `${nextRect.y}px`;
      root.style.width = `${nextRect.width}px`;
      root.style.height = `${nextRect.height}px`;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
}

function promptForCodes() {
  const viewId = getCurrentViewId();
  const existingContext = resolveGuideContext(viewId);
  const existing = existingContext.codes;
  const input = window.prompt(
    'Enter guide code(s), separated by commas (e.g. CS3B-SSA-SB-R, CS4A-LH)',
    existing.join(', ')
  );
  if (typeof input !== 'string') {
    return existing;
  }
  const parsed = parseCodes(input);
  if (!parsed.length) return existing;
  saveGuideCodes(parsed, viewId);
  pinnedSourceViewId = viewId;
  pinnedLockToImage = isGuideLockedToView(viewId);
  return parsed;
}

function openGuideBindingPanel({ viewId = getCurrentViewId(), source = 'flash' } = {}) {
  const metadata = getMetadata();
  const binding = getGuideBinding(viewId);
  const existingCodes =
    binding.codes.length > 0
      ? binding.codes
      : Array.isArray(metadata.measurementGuideCodes)
        ? metadata.measurementGuideCodes.map(code => normalizeCode(code)).filter(Boolean)
        : [];
  const initialTarget =
    binding.scopeType === 'project' ? 'project' : binding.scopeType === 'view' ? 'view' : 'frame';

  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:fixed;inset:0;background:rgba(15,23,42,.52);z-index:13450;display:flex;align-items:center;justify-content:center;padding:20px;';
  overlay.innerHTML = `
    <section style="width:min(560px,100%);background:#fff;border-radius:12px;padding:16px;box-shadow:0 18px 44px rgba(2,6,23,.25);">
      <h3 style="margin:0;font-size:18px;color:#0f172a;">Guide Binding</h3>
      <p style="margin:4px 0 12px;font-size:12px;color:#475569;">Set where this guide mapping applies: project, view, or frame.</p>
      <label style="display:block;font-size:12px;color:#334155;font-weight:600;">Scope
        <select id="guideBindingTarget" style="margin-top:4px;width:100%;border:1px solid #cbd5e1;border-radius:8px;padding:8px;">
          <option value="project" ${initialTarget === 'project' ? 'selected' : ''}>Project (all images)</option>
          <option value="view" ${initialTarget === 'view' ? 'selected' : ''}>View (${toBaseViewId(viewId)})</option>
          <option value="frame" ${initialTarget === 'frame' ? 'selected' : ''}>Frame (${viewId})</option>
        </select>
      </label>
      <label style="display:block;margin-top:10px;font-size:12px;color:#334155;font-weight:600;">Guide code(s)
        <input id="guideBindingCodes" type="text" value="${existingCodes.join(', ')}" placeholder="e.g. CC-BK-BE, CS3B-SSA-SB-R" style="margin-top:4px;width:100%;border:1px solid #cbd5e1;border-radius:8px;padding:8px;" />
      </label>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px;">
        <label style="font-size:12px;color:#334155;display:flex;align-items:center;gap:6px;">
          <input id="guideBindingLock" type="checkbox" ${binding.locked ? 'checked' : ''} /> Locked
        </label>
        <button id="guideBindingBrowse" type="button" style="border:1px solid #cbd5e1;background:#fff;color:#334155;border-radius:8px;padding:7px 10px;font-size:12px;font-weight:600;">Browse Gallery</button>
      </div>
      <p style="margin:10px 0 0;font-size:11px;color:#64748b;">${getBindingBreadcrumb(viewId)} · Source: ${source}</p>
      <div style="margin-top:14px;display:flex;justify-content:flex-end;gap:8px;">
        <button id="guideBindingCancel" type="button" style="border:1px solid #cbd5e1;background:#fff;color:#334155;border-radius:8px;padding:8px 11px;font-size:12px;">Cancel</button>
        <button id="guideBindingSave" type="button" style="border:0;background:#1d4ed8;color:#fff;border-radius:8px;padding:8px 11px;font-size:12px;font-weight:700;">Save Binding</button>
      </div>
    </section>
  `;

  const close = () => overlay.remove();
  overlay.addEventListener('click', event => {
    if (event.target === overlay) close();
  });

  const codesInput = overlay.querySelector('#guideBindingCodes');
  const targetSelect = overlay.querySelector('#guideBindingTarget');
  const lockInput = overlay.querySelector('#guideBindingLock');

  overlay.querySelector('#guideBindingBrowse')?.addEventListener('click', () => {
    showGuideGallery();
    gallerySelectHandler = ({ code }) => {
      const nextCodes = parseCodes(`${codesInput?.value || ''}, ${code}`);
      if (codesInput) {
        codesInput.value = nextCodes.join(', ');
      }
    };
  });

  overlay.querySelector('#guideBindingCancel')?.addEventListener('click', close);
  overlay.querySelector('#guideBindingSave')?.addEventListener('click', () => {
    const target = String(targetSelect?.value || 'frame');
    const codes = parseCodes(codesInput?.value || '');
    if (!codes.length) {
      if (typeof window.showStatusMessage === 'function') {
        window.showStatusMessage('Please enter at least one guide code', 'warning');
      }
      return;
    }
    saveGuideSettings({
      viewId,
      codes,
      lockToImage: lockInput?.checked === true,
      bindingTarget: target,
    });
    close();
    if (isGuidePinnedVisible && flashOverlay?.classList.contains('visible')) {
      showGuideFlash({ holdMode: true, preservePinnedContext: false });
    }
    window.dispatchEvent(new Event('openpaint:guide-binding-changed'));
  });

  document.body.appendChild(overlay);
}

function showGuideFlash({
  cycleNext = false,
  cycleDelta = 0,
  holdMode = false,
  preservePinnedContext = false,
} = {}) {
  const currentViewId = getCurrentViewId();

  if (!preservePinnedContext) {
    pinnedSourceViewId = currentViewId;
    pinnedLockToImage = isGuideLockedToView(currentViewId);
  }

  let codes =
    preservePinnedContext && pinnedSourceViewId
      ? resolveGuideContext(pinnedSourceViewId).codes
      : resolveGuideContext(currentViewId).codes;

  if (!codes.length) {
    codes = promptForCodes();
    if (!codes.length) return;
  }

  if (!pinnedSourceViewId) {
    pinnedSourceViewId = currentViewId;
  }

  if (pinnedLockToImage && currentViewId !== pinnedSourceViewId) {
    hideGuideFlash();
    isGuidePinnedVisible = false;
    return;
  }

  const slides = resolveSlides(codes, pinnedLockToImage ? pinnedSourceViewId : null);
  if (!slides.length) return;

  const delta = cycleDelta || (cycleNext ? 1 : 0);
  if (delta !== 0) {
    activeIndex = (activeIndex + delta + slides.length) % slides.length;
  } else if (activeIndex >= slides.length) {
    activeIndex = 0;
  }

  const slide = slides[activeIndex];
  ensureOverlay(slide, slides.length);
  lastRenderedViewId = currentViewId;

  requestAnimationFrame(() => {
    flashOverlay?.classList.add('visible');
  });

  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }

  // In hold mode, don't auto-hide
  if (!holdMode) {
    hideTimer = setTimeout(() => {
      hideGuideFlash();
    }, FLASH_DURATION_MS);
  }
}

function hideGuideFlash() {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  if (!flashOverlay) return;
  flashOverlay.classList.remove('visible');
  lastRenderedViewId = null;
}

function showGuideGallery() {
  ensureStyles();

  if (!galleryOverlay) {
    galleryOverlay = document.createElement('div');
    galleryOverlay.className = 'guide-gallery-overlay';
    document.body.appendChild(galleryOverlay);
  }

  // All uploaded guide codes (Worker handles both Front_CODE.svg and CODE.svg)
  const allCodes = [
    'CC-BCH-B',
    'CC-BCH-W',
    'CC-BK-BE',
    'CC-BK-L',
    'CC-BK-T',
    'CC-BK-W',
    'CS1-CNR',
    'CS1-CNR-W',
    'CS1-SRA-HB-L',
    'CS1B-RA-HB',
    'CS1B-RA-RB',
    'CS1B-RA-SB',
    'CS1B-SA-HB',
    'CS1B-SA-HB2',
    'CS1B-SA-SB',
    'CS1B-SRA-HB-L',
    'CS1B-SRA-HB-R',
    'CS1B-SRA-SB-L',
    'CS1B-SRA-SB-R',
    'CS1B-SSA-HB-L',
    'CS1B-SSA-HB-R',
    'CS1B-SSA-SB-L',
    'CS1B-SSA-SB-R',
    'CS1B-SSA2-HB-L',
    'CS1B-SSA2-HB-R',
    'CS1B-SWA-HB-L',
    'CS1B-SWA-HB-R',
    'CS1B-SWA-SB-L',
    'CS1B-SWA-SB-R',
    'CS1B-SWA2-HB-L',
    'CS1B-SWA2-HB-R',
    'CS1B-SWA2-SB-L',
    'CS1B-SWA2-SB-R',
    'CS1B-WA-HB',
    'CS1B-WA-SB',
    'CS1B-WA-SB2',
    'CS1L-ERA-HB',
    'CS1L-RA-HB',
    'CS1L-RA-RB',
    'CS1L-RA-SB',
    'CS1L-RA-WB',
    'CS1L-SA-HB',
    'CS1L-SA-SB',
    'CS1L-WA-SB',
    'CS3B-RA-HB',
    'CS3B-RA-RB',
    'CS3B-RA-SB',
    'CS3B-SA-HB',
    'CS3B-SA-HB2',
    'CS3B-SA-SB',
    'CS3B-SLA-HB',
    'CS3B-SLA-HB2',
    'CS3B-SLA-SB',
    'CS3B-SLA-SB2',
    'CS3B-SRA-HB-L',
    'CS3B-SRA-HB-R',
    'CS3B-SRA-SB-L',
    'CS3B-SRA-SB-R',
    'CS3B-SSA-HB-L',
    'CS3B-SSA-HB-R',
    'CS3B-SSA-SB-L',
    'CS3B-SSA-SB-R',
    'CS3B-SSA2-HB-L',
    'CS3B-SSA2-HB-R',
    'CS3B-SSLA-SB-L',
    'CS3B-SSLA-SB-R',
    'CS3B-SSLA2-SB',
    'CS3B-SSLA2-SB-L',
    'CS3B-SSLA2-SB-R',
    'CS3B-SWA-HB-L',
    'CS3B-SWA-HB-R',
    'CS3B-SWA-SB-L',
    'CS3B-SWA-SB-R',
    'CS3B-SWA2-HB-L',
    'CS3B-SWA2-HB-R',
    'CS3B-SWA2-SB-L',
    'CS3B-SWA2-SB-R',
    'CS3B-WA-HB',
    'CS3B-WA-SB',
    'CS3B-WA-SB2',
    'CS3B-WA2-HB',
    'CS3L-ERA-HB',
    'CS3L-RA-HB',
    'CS3L-RA-RB',
    'CS3L-RA-SB',
    'CS3L-SA-HB',
    'CS3L-SA-SB',
    'CS3L-SSA-SB-L',
    'CS3L-SSA-SB-R',
    'CS3L-WA-SB',
    'CS4-SSA-HB-L',
    'CS4-SSA-HB-R',
    'CS4-SSA-SB-L',
    'CS4-SSA-SB-R',
    'CS5B-RA-HB-L',
    'CS5B-RA-HB-R',
    'CS5B-RA-SB',
    'CS5B-RA-SB-L',
    'CS5B-RA-SB-R',
    'CS5B-RA2-HB-L',
    'CS5B-RA2-HB-R',
    'CS5B-RA2-SB-L',
    'CS5B-RA2-SB-R',
    'CS5B-SA-HB',
    'CS5B-SA-HB-L',
    'CS5B-SA-HB-R',
    'CS5B-SA-SB',
    'CS5B-SA-SB-L',
    'CS5B-SA-SB-R',
    'CS5B-SA2-HB-L',
    'CS5B-SA2-HB-R',
    'CS5B-SA2-SB-L',
    'CS5B-SA2-SB-R',
    'CS5B-SWA2-SB-L',
    'CS5B-SWA2-SB-R',
    'CS5B-WA-HB-L',
    'CS5B-WA-HB-R',
    'CS5B-WA2-HB-L',
    'CS5B-WA2-HB-R',
    'CS5B-WA2-SB-L',
    'CS5B-WA2-SB-R',
    'CS5L-RA-HB-L',
    'CS5L-RA-HB-R',
    'CS5L-RA-SB-L',
    'CS5L-RA-SB-R',
    'CS5L-SA-HB-L',
    'CS5L-SA-HB-R',
    'CS5L-SA-SB-L',
    'CS5L-SA-SB-R',
    'CS5L-WA-HB-L',
    'CS5L-WA-HB-R',
    'CS5L-WA-SB-L',
    'CS5L-WA-SB-R',
    'CSAP-ERA',
    'CSAP-RA',
    'CSAP-SA',
    'CSAP-SSLA',
    'CSAP-WA',
    'CSAP-WA2',
    'CSDC-CNRP',
    'CSDC-MSKT',
    'CSDC-SA-SNUG',
    'CSDC-SNUG',
    'CSS-RA-HB',
  ];

  const renderGallery = filteredCodes => {
    const items = filteredCodes
      .map(code => {
        const url = buildGuideUrl(code, 'front');
        return `
        <div class="guide-gallery-item" data-code="${code}">
          <div class="guide-gallery-item-label">${code}</div>
          <div class="guide-gallery-item-body">
            <img src="${url}" alt="${code} Front view" loading="lazy" data-guide-code="${code}" data-guide-view="front" />
          </div>
        </div>
      `;
      })
      .join('');

    galleryOverlay.innerHTML = `
      <button class="guide-gallery-close">Close (Esc)</button>
      <div class="guide-gallery-container">
        <div class="guide-gallery-header">
          <h2 class="guide-gallery-title">Measurement Guide Gallery</h2>
          <input type="text" class="guide-gallery-search" placeholder="Search guide codes\u2026" />
        </div>
        <div class="guide-gallery-grid">${items}</div>
      </div>
    `;

    const searchInput = galleryOverlay.querySelector('.guide-gallery-search');
    const closeBtn = galleryOverlay.querySelector('.guide-gallery-close');

    searchInput?.addEventListener('input', e => {
      const query = e.target.value.toUpperCase();
      const filtered = allCodes.filter(code => code.includes(query));
      const grid = galleryOverlay.querySelector('.guide-gallery-grid');
      if (grid) {
        grid.innerHTML = filtered
          .map(code => {
            const url = buildGuideUrl(code, 'front');
            return `
            <div class="guide-gallery-item" data-code="${code}">
              <div class="guide-gallery-item-label">${code}</div>
              <div class="guide-gallery-item-body">
                <img src="${url}" alt="${code} Front view" loading="lazy" data-guide-code="${code}" data-guide-view="front" />
              </div>
            </div>
          `;
          })
          .join('');
        attachGuideImageRecovery(grid);
      }
    });

    closeBtn?.addEventListener('click', hideGuideGallery);

    galleryOverlay.querySelectorAll('.guide-gallery-item').forEach(item => {
      item.addEventListener('click', () => {
        const code = item.getAttribute('data-code');
        if (code) {
          saveGuideCodes([code]);
          if (typeof gallerySelectHandler === 'function') {
            gallerySelectHandler({ code, viewId: getCurrentViewId() });
          }
          hideGuideGallery();
          showGuideFlash();
        }
      });
    });
  };

  renderGallery(allCodes);
  attachGuideImageRecovery(galleryOverlay);
  requestAnimationFrame(() => galleryOverlay?.classList.add('visible'));
}

function hideGuideGallery() {
  if (!galleryOverlay) return;
  galleryOverlay.classList.remove('visible');
  gallerySelectHandler = null;
}

function onKeyDown(event) {
  if (event.code !== HOTKEY) return;
  if (isTypingContext(event.target)) return;

  event.preventDefault();
  event.stopPropagation();

  // Alt+\ = Open gallery browser (shows all SVGs)
  if (event.altKey && !event.repeat) {
    showGuideGallery();
    return;
  }

  // Ctrl+\ = Edit codes (always prompt)
  if (event.ctrlKey && !event.repeat) {
    const codes = promptForCodes();
    if (!codes.length) return;
    activeIndex = 0;
    showGuideFlash({ holdMode: isGuidePinnedVisible });
    showShortcutToast();
    return;
  }

  // Shift+\ = Cycle to next guide (timed auto-hide)
  if (event.shiftKey && !event.repeat) {
    showGuideFlash({ cycleNext: true, holdMode: isGuidePinnedVisible });
    showShortcutToast();
    return;
  }

  // \ (no modifiers) = Toggle pinned visibility (only if codes exist)
  if (!event.repeat) {
    const currentViewId = getCurrentViewId();
    const context = resolveGuideContext(currentViewId);

    if (!context.codes.length) {
      // No codes set - show gallery instead
      showGuideGallery();
      return;
    }

    if (isGuidePinnedVisible && flashOverlay?.classList.contains('visible')) {
      isGuidePinnedVisible = false;
      hideGuideFlash();
      return;
    }
    isGuidePinnedVisible = true;
    showGuideFlash({ holdMode: true });
    showShortcutToast();
  }
}

function onKeyUp(event) {
  if (event.code !== HOTKEY) return;
}

function syncGuideOverlayToActiveView() {
  if (!isGuidePinnedVisible || !flashOverlay?.classList.contains('visible')) return;

  const currentViewId = getCurrentViewId();
  if (currentViewId === lastRenderedViewId) return;

  if (pinnedLockToImage && pinnedSourceViewId && currentViewId !== pinnedSourceViewId) {
    hideGuideFlash();
    isGuidePinnedVisible = false;
    return;
  }

  showGuideFlash({ holdMode: true, preservePinnedContext: !pinnedLockToImage });
}

export function initMeasurementGuideFlash() {
  window.addEventListener('keydown', onKeyDown, { passive: false });
  window.addEventListener('keyup', onKeyUp, { passive: false });
  window.setInterval(syncGuideOverlayToActiveView, 200);

  window.addEventListener('resize', () => {
    if (flashOverlay?.classList.contains('visible')) {
      const rect = getFlashRect();
      if (rect) {
        setFlashRect(clampFlashRect(rect));
      }
      applyFlashWindowLayout(flashOverlay);
    }
  });

  window.addEventListener('keydown', event => {
    if (!flashOverlay?.classList.contains('visible')) return;
    if (isTypingContext(event.target)) return;
    if (event.key === '[') {
      event.preventDefault();
      setFlashSize(cycleFlashSize(-1), true);
      applyFlashWindowLayout(flashOverlay);
    } else if (event.key === ']') {
      event.preventDefault();
      setFlashSize(cycleFlashSize(1), true);
      applyFlashWindowLayout(flashOverlay);
    } else if (event.key === '0') {
      event.preventDefault();
      setFlashRect(null);
      applyFlashWindowLayout(flashOverlay);
    }
  });

  // Close gallery on Escape
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && galleryOverlay?.classList.contains('visible')) {
      hideGuideGallery();
      return;
    }
    if (e.key === 'Escape' && flashOverlay?.classList.contains('visible')) {
      isGuidePinnedVisible = false;
      hideGuideFlash();
    }
  });

  window.openMeasurementGuideGallery = options => {
    gallerySelectHandler = options?.onSelect || null;
    showGuideGallery();
  };
  window.openGuideBindingPanel = options => {
    openGuideBindingPanel(options || {});
  };
}

export function openMeasurementGuideGallery(options = {}) {
  gallerySelectHandler = options?.onSelect || null;
  showGuideGallery();
}
