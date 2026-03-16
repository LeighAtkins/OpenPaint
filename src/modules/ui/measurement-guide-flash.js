import { parseSvgMeasurements, createCoordinateTransformer } from './svg-measurement-parser.js';
import { CanvasManager } from '../CanvasManager';
import { TagManager } from '../TagManager';
import { PathUtils } from '../utils/PathUtils.js';
import { IMAGE_PANEL_STATES, setImagePanelState } from './panel-state.js';
import { resolveScopedImageLabel } from './scoped-image-label.js';

const HOTKEY = 'Backslash';
const VIEWS = ['front', 'back', 'side'];
const FLASH_DURATION_MS = 1200;
const GUIDE_HINT_KEY = 'openpaint:guideFlashHintSeen:v1';
const GUIDE_CACHE_KEY = '2026-02-11-1';
const GUIDE_WINDOW_PREFS_KEY = 'openpaint:guideWindowPrefs:v1';
const GUIDE_GALLERY_SEARCH_PREF_KEY = 'gallerySearchVisible';
const GUIDE_GALLERY_PANEL_HIDDEN_PREF_KEY = 'galleryPanelHidden';
const FLASH_SIZE_ORDER = ['S', 'M', 'L', 'XL', 'XXL'];

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
let flashSourceViewId = '';
let flashSlides = [];
let flashComparisonImageId = '';
const guideRoleTokenCache = new Map();
const guideRasterCache = new Map();
const guideSvgCache = new Map();
let guideCodeListCache = null;
let guideViewsByCodeCache = null;
let guideCodeListPromise = null;
const GUIDE_RASTER_CACHE_VERSION = 'v4';
const GUIDE_RASTER_MIN_EDGE = 2200;
const GUIDE_RASTER_MAX_EDGE = 4096;
const GUIDE_SPLIT_ENABLED_PREF_KEY = 'guideSplitEnabled';
const GUIDE_SPLIT_TEMP_PREFIX = '__guide__:';

let guideSplitEnabled = getWindowPrefs()?.[GUIDE_SPLIT_ENABLED_PREF_KEY] === true;
let guideSplitLastSyncKey = '';
let guideSplitOriginalParent = null;
let guideSplitOriginalNextSibling = null;
let guideSplitCaptureOverlayOriginalParent = null;
let guideSplitCaptureOverlayOriginalNextSibling = null;
let guideSplitCompareCanvasManager = null;
let guideSplitCompareTagManager = null;
let guideSplitActiveTempScopeId = '';
let guideSplitHighlightOverlayObject = null;
let guideSplitHighlightOverlayKey = '';
let guideSplitCompareBackgroundVisualKey = '';
let guideSplitActiveHighlightRoleCanonical = '';
let guideSplitSyncingWorkspace = false;
let guideSplitSuppressViewSwitchSync = 0;
let guideSplitRestoreSnapshot = null;
let guideSplitPanelSnapshot = null;
let guideSplitLayoutSyncRaf = null;
let guideSplitLayoutSyncTimeout = null;
let guideSplitFrameSyncRaf = null;
let guideSplitFrameSyncToken = 0;
let guideSplitFrameGhost = null;
let guideSplitTransitionPending = false;
let guideSplitCompareLoadPromise = null;
let guideSplitCompareLoadKey = '';
let guideSplitCompareLoadToken = 0;
let _ensureRightViewInFlight = false;
let _bindingChangedTimeout = null;
let _lastProcessedGuideNextTagEventKey = '';
const guideSplitPendingGuideViews = new Map();
const guideCompareWorkspaceState = {
  open: guideSplitEnabled,
  leftViewId: '',
  rightViewId: '',
  activePane: 'left',
  rightSourceKind: 'bound-guide',
};

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

function cloneGuideSplitValue(value) {
  if (value === null || value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    console.warn('[GuideSplit] Failed to clone split restore state', error);
    return null;
  }
}

function captureGuideSplitPanelSnapshot() {
  const strokePanel = document.getElementById('strokePanel');
  const imagePanel = document.getElementById('imagePanel');
  const elementsBody = document.getElementById('elementsBody');
  const imagePanelContent = document.getElementById('imagePanelContent');

  guideSplitPanelSnapshot = {
    strokeCollapsed:
      strokePanel?.classList.contains('collapsed') ||
      strokePanel?.getAttribute('aria-expanded') === 'false',
    imageCollapsed:
      imagePanel?.classList.contains('collapsed') ||
      imagePanel?.getAttribute('aria-expanded') === 'false',
    elementsBodyDisplay: elementsBody?.style.display || '',
    imagePanelContentDisplay: imagePanelContent?.style.display || '',
  };
}

function applyGuideSplitCollapsedPanels() {
  const strokePanel = document.getElementById('strokePanel');
  const imagePanel = document.getElementById('imagePanel');
  const elementsBody = document.getElementById('elementsBody');
  const imagePanelContent = document.getElementById('imagePanelContent');
  const strokeToggleIcon = document.querySelector('#toggleStrokePanel svg');
  const imageToggleIcon = document.querySelector('#toggleImagePanel svg');

  if (!guideSplitPanelSnapshot) {
    captureGuideSplitPanelSnapshot();
  }

  if (strokePanel) {
    strokePanel.classList.add('collapsed');
    strokePanel.setAttribute('aria-expanded', 'false');
    strokePanel.style.setProperty('display', 'flex', 'important');
    strokePanel.style.setProperty('visibility', 'visible', 'important');
    strokePanel.style.setProperty('opacity', '1', 'important');
    strokePanel.style.removeProperty('pointer-events');
  }
  if (imagePanel) {
    imagePanel.classList.add('collapsed');
    imagePanel.setAttribute('aria-expanded', 'false');
    imagePanel.style.setProperty('display', 'flex', 'important');
    imagePanel.style.setProperty('visibility', 'visible', 'important');
    imagePanel.style.setProperty('opacity', '1', 'important');
    imagePanel.style.removeProperty('pointer-events');
    setImagePanelState(IMAGE_PANEL_STATES.collapsed);
  }
  if (elementsBody) {
    elementsBody.classList.add('hidden');
    elementsBody.style.setProperty('display', 'none', 'important');
  }
  if (imagePanelContent) {
    imagePanelContent.classList.add('hidden');
    imagePanelContent.style.setProperty('display', 'none', 'important');
  }
  if (strokeToggleIcon instanceof HTMLElement) {
    strokeToggleIcon.style.transform = 'rotate(180deg)';
  }
  if (imageToggleIcon instanceof HTMLElement) {
    imageToggleIcon.style.transform = 'rotate(180deg)';
  }
}

function restoreGuideSplitPanelSnapshot() {
  const snapshot = guideSplitPanelSnapshot;
  const strokePanel = document.getElementById('strokePanel');
  const imagePanel = document.getElementById('imagePanel');
  const elementsBody = document.getElementById('elementsBody');
  const imagePanelContent = document.getElementById('imagePanelContent');
  const strokeToggleIcon = document.querySelector('#toggleStrokePanel svg');
  const imageToggleIcon = document.querySelector('#toggleImagePanel svg');

  if (strokePanel) {
    strokePanel.classList.toggle('collapsed', snapshot?.strokeCollapsed === true);
    strokePanel.setAttribute(
      'aria-expanded',
      snapshot?.strokeCollapsed === true ? 'false' : 'true'
    );
  }
  if (imagePanel) {
    imagePanel.classList.toggle('collapsed', snapshot?.imageCollapsed === true);
    imagePanel.setAttribute('aria-expanded', snapshot?.imageCollapsed === true ? 'false' : 'true');
    setImagePanelState(
      snapshot?.imageCollapsed === true ? IMAGE_PANEL_STATES.collapsed : IMAGE_PANEL_STATES.expanded
    );
  }
  if (elementsBody) {
    if (snapshot?.strokeCollapsed === true) {
      elementsBody.classList.add('hidden');
      elementsBody.style.setProperty('display', 'none', 'important');
    } else {
      elementsBody.classList.remove('hidden');
      elementsBody.style.removeProperty('display');
    }
  }
  if (imagePanelContent) {
    if (snapshot?.imageCollapsed === true) {
      imagePanelContent.classList.add('hidden');
      imagePanelContent.style.setProperty('display', 'none', 'important');
    } else {
      imagePanelContent.classList.remove('hidden');
      imagePanelContent.style.removeProperty('display');
    }
  }
  if (strokeToggleIcon instanceof HTMLElement) {
    strokeToggleIcon.style.transform = snapshot?.strokeCollapsed === true ? 'rotate(180deg)' : '';
  }
  if (imageToggleIcon instanceof HTMLElement) {
    imageToggleIcon.style.transform = snapshot?.imageCollapsed === true ? 'rotate(180deg)' : '';
  }

  guideSplitPanelSnapshot = null;
}

function runGuideSplitLayoutSync() {
  if (!guideSplitEnabled) return;
  const primaryCanvasManager = getPrimaryCanvasManager();
  const frameEl = document.getElementById('captureFrame');
  const syncToken = guideSplitFrameSyncToken + 1;
  guideSplitFrameSyncToken = syncToken;
  if (frameEl) {
    frameEl.style.visibility = 'hidden';
  }
  syncGuideSplitPrimaryCaptureFrame(getCurrentViewId());
  resizeGuideSplitCanvasManagerNow(primaryCanvasManager);
  resizeGuideSplitCanvasManagerNow(guideSplitCompareCanvasManager);
  // Fit primary background immediately (not just in double-RAF) so vectors render
  // at the correct viewport right away.  The double-RAF will refine after DOM settles.
  fitGuideSplitPrimaryBackgroundToFrame();
  fitGuideSplitCompareBackgroundToFrame();
  // Sync capture frame immediately after the viewport fit so it uses the correct
  // zoom/pan.  Without this, the capture frame stays at the position computed by
  // applyCaptureFrameForLabel (which ran before canvas resize) until the double-RAF
  // corrects it 2 frames later — visible as a shifted capture window on images with
  // stored tab state (second+ visits).
  if (typeof window.syncCaptureFrameToActiveTabWorldRect === 'function') {
    window.syncCaptureFrameToActiveTabWorldRect(getCurrentViewId());
  }
  syncGuideSplitHighlightOverlayToBackground();
  syncGuideSplitFrameGhost();
  if (guideSplitFrameSyncRaf !== null) {
    cancelAnimationFrame(guideSplitFrameSyncRaf);
    guideSplitFrameSyncRaf = null;
  }
  guideSplitFrameSyncRaf = requestAnimationFrame(() => {
    guideSplitFrameSyncRaf = requestAnimationFrame(() => {
      guideSplitFrameSyncRaf = null;
      if (!guideSplitEnabled || syncToken !== guideSplitFrameSyncToken) {
        return;
      }
      fitGuideSplitPrimaryBackgroundToFrame();
      fitGuideSplitCompareBackgroundToFrame();
      // Sync capture frame AFTER viewport fit so it uses the correct zoom/pan.
      // Previously this ran before fitGuideSplitPrimaryBackgroundToFrame, causing
      // the capture frame (and ghost) to be positioned at the stale viewport.
      if (typeof window.syncCaptureFrameToActiveTabWorldRect === 'function') {
        window.syncCaptureFrameToActiveTabWorldRect(getCurrentViewId());
      }
      syncGuideSplitHighlightOverlayToBackground();
      syncGuideSplitFrameGhost();
      // (Opacity mask removed — viewport changes are now prevented at source)
      if (guideSplitLayoutSyncRaf === null && guideSplitLayoutSyncTimeout === null) {
        requestAnimationFrame(() => {
          if (
            guideSplitEnabled &&
            guideSplitLayoutSyncRaf === null &&
            guideSplitLayoutSyncTimeout === null
          ) {
            setGuideSplitTransitionPending(false);
          }
        });
      }
      if (frameEl) {
        frameEl.style.visibility = 'hidden';
      }
    });
  });
}

function scheduleGuideSplitFrameSync() {
  if (guideSplitFrameSyncRaf !== null) {
    cancelAnimationFrame(guideSplitFrameSyncRaf);
    guideSplitFrameSyncRaf = null;
  }
  guideSplitFrameSyncRaf = requestAnimationFrame(() => {
    guideSplitFrameSyncRaf = requestAnimationFrame(() => {
      guideSplitFrameSyncRaf = null;
      if (!guideSplitEnabled) return;
      if (typeof window.syncCaptureFrameToActiveTabWorldRect === 'function') {
        window.syncCaptureFrameToActiveTabWorldRect(getCurrentViewId());
      }
      syncGuideSplitHighlightOverlayToBackground();
      syncGuideSplitFrameGhost();
      const frameEl = document.getElementById('captureFrame');
      if (frameEl) {
        frameEl.style.visibility = 'hidden';
      }
    });
  });
}

function scheduleGuideSplitLayoutSync({ settle = false } = {}) {
  if (guideSplitLayoutSyncRaf !== null) {
    cancelAnimationFrame(guideSplitLayoutSyncRaf);
    guideSplitLayoutSyncRaf = null;
  }
  if (guideSplitLayoutSyncTimeout !== null) {
    clearTimeout(guideSplitLayoutSyncTimeout);
    guideSplitLayoutSyncTimeout = null;
  }

  window.__guideSplitLayoutSettling = true;
  guideSplitLayoutSyncRaf = requestAnimationFrame(() => {
    guideSplitLayoutSyncRaf = null;
    runGuideSplitLayoutSync();

    if (!settle) {
      window.__guideSplitLayoutSettling = false;
      return;
    }

    guideSplitLayoutSyncTimeout = window.setTimeout(() => {
      guideSplitLayoutSyncTimeout = null;
      requestAnimationFrame(() => {
        runGuideSplitLayoutSync();
        window.__guideSplitLayoutSettling = false;
      });
    }, 50);
  });
}

function invalidateGuideSplitCompareLoad() {
  guideSplitCompareLoadToken += 1;
  guideSplitCompareLoadKey = '';
  guideSplitCompareLoadPromise = null;
  resetGuideSplitCompareBackgroundVisualKey();
}

function getGuideSplitImageWorldRect() {
  const canvasManager = getPrimaryCanvasManager();
  const bgImage = canvasManager?.fabricCanvas?.backgroundImage;
  if (!bgImage || typeof bgImage.getCenterPoint !== 'function') {
    return null;
  }

  const center = bgImage.getCenterPoint();
  const width =
    typeof bgImage.getScaledWidth === 'function'
      ? bgImage.getScaledWidth()
      : Number(bgImage.width || 0) * Number(bgImage.scaleX || 1);
  const height =
    typeof bgImage.getScaledHeight === 'function'
      ? bgImage.getScaledHeight()
      : Number(bgImage.height || 0) * Number(bgImage.scaleY || 1);

  if (
    !Number.isFinite(center?.x) ||
    !Number.isFinite(center?.y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }

  return {
    left: center.x - width / 2,
    top: center.y - height / 2,
    width,
    height,
  };
}

function captureGuideSplitRestoreSnapshot(viewId) {
  const normalizedViewId = toBaseViewId(viewId || getCurrentViewId());
  if (!normalizedViewId) {
    guideSplitRestoreSnapshot = null;
    window.__guideSplitRestoreSnapshot = null;
    return;
  }

  const manager = window.app?.projectManager || window.projectManager;
  const liveViewport = getPrimaryCanvasManager()?.getViewportState?.() || null;
  guideSplitRestoreSnapshot = {
    viewId: normalizedViewId,
    tabs: cloneGuideSplitValue(window.captureTabsByLabel?.[normalizedViewId] || null),
    viewport:
      cloneGuideSplitValue(manager?.views?.[normalizedViewId]?.viewport) ||
      cloneGuideSplitValue(liveViewport),
    imageWorldRect: cloneGuideSplitValue(getGuideSplitImageWorldRect()),
  };
  window.__guideSplitRestoreSnapshot = cloneGuideSplitValue(guideSplitRestoreSnapshot);
}

function restoreGuideSplitSnapshot(viewId) {
  const normalizedViewId = toBaseViewId(viewId || getCurrentViewId());
  if (!normalizedViewId || guideSplitRestoreSnapshot?.viewId !== normalizedViewId) {
    guideSplitRestoreSnapshot = null;
    window.__guideSplitRestoreSnapshot = null;
    return null;
  }

  const snapshot = cloneGuideSplitValue(guideSplitRestoreSnapshot);

  if (guideSplitRestoreSnapshot.tabs && typeof window.setCaptureTabsForLabel === 'function') {
    window.setCaptureTabsForLabel(normalizedViewId, guideSplitRestoreSnapshot.tabs);
  }

  const primaryCanvasManager = getPrimaryCanvasManager();
  if (guideSplitRestoreSnapshot.viewport && primaryCanvasManager?.setViewportState) {
    primaryCanvasManager.setViewportState(guideSplitRestoreSnapshot.viewport);
  }

  guideSplitRestoreSnapshot = null;
  window.__guideSplitRestoreSnapshot = null;
  return snapshot;
}

function syncGuideSplitPrimaryCaptureFrame(viewId, { exact = false } = {}) {
  const normalizedViewId = toBaseViewId(viewId || getCurrentViewId());
  if (!normalizedViewId) {
    return false;
  }

  if (typeof window.getCaptureTabScopedLabel === 'function') {
    window.currentImageLabel =
      window.getCaptureTabScopedLabel(normalizedViewId) || normalizedViewId;
  } else {
    window.currentImageLabel = normalizedViewId;
  }

  if (exact && typeof window.restoreCaptureFrameForLabelExact === 'function') {
    return window.restoreCaptureFrameForLabelExact(normalizedViewId) === true;
  }

  if (typeof window.applyCaptureFrameForLabel === 'function') {
    window.applyCaptureFrameForLabel(normalizedViewId);
    return true;
  }

  return false;
}

function fitGuideSplitPrimaryBackgroundToFrame() {
  const primaryCanvasManager = getPrimaryCanvasManager();
  const backgroundWorldRect = primaryCanvasManager?.getBackgroundWorldRect?.();
  if (
    !backgroundWorldRect ||
    !primaryCanvasManager?.fitViewportToBackgroundPlacementFrame ||
    !primaryCanvasManager?.fabricCanvas
  ) {
    return false;
  }

  // Use the canvas dimensions directly as the target frame — NOT
  // getBackgroundPlacementFrame() which reads captureFrame.getBoundingClientRect().
  // In split mode, syncCaptureFrameToActiveTabWorldRect repositions the capture frame
  // based on the current viewport before this function runs, creating a feedback loop
  // where each fit shrinks the target, compounding the zoom down to near-zero.
  const canvasWidth = Number(primaryCanvasManager.fabricCanvas.width) || 0;
  const canvasHeight = Number(primaryCanvasManager.fabricCanvas.height) || 0;
  if (!canvasWidth || !canvasHeight) {
    return false;
  }
  const targetFrame = { left: 0, top: 0, width: canvasWidth, height: canvasHeight };

  const didFit = primaryCanvasManager.fitViewportToBackgroundPlacementFrame(
    backgroundWorldRect,
    targetFrame,
    {
      // Seed zoom must be 1 — fitViewportToWorldRect multiplies the seed by fitScale,
      // so passing the current zoomLevel causes compounding shrink on repeated calls.
      zoom: 1,
      panX: 0,
      panY: 0,
      rotation: primaryCanvasManager.rotateViewport ? primaryCanvasManager.rotationDegrees : 0,
    }
  );
  if (didFit && typeof primaryCanvasManager.applyViewportTransform === 'function') {
    primaryCanvasManager.applyViewportTransform();
  }
  return didFit;
}

function fitGuideSplitCompareBackgroundToFrame() {
  if (!guideSplitCompareCanvasManager?.refitBackgroundImageToPlacementFrame) {
    return false;
  }
  const didFit = guideSplitCompareCanvasManager.refitBackgroundImageToPlacementFrame();
  if (didFit) {
    guideSplitCompareCanvasManager.applyViewportTransform?.();
  }
  return didFit;
}

function resizeGuideSplitCanvasManagerNow(canvasManager) {
  if (!canvasManager) {
    return false;
  }

  if (
    typeof canvasManager.getAvailableCanvasSize === 'function' &&
    typeof canvasManager.applyResize === 'function'
  ) {
    const { width, height } = canvasManager.getAvailableCanvasSize();
    canvasManager.applyResize(width, height);
    return true;
  }

  if (typeof canvasManager.resize === 'function') {
    canvasManager.resize();
    return true;
  }

  return false;
}

function teardownGuideSplitCompareCanvasManager() {
  if (guideSplitCompareCanvasManager?.resizeObserver?.disconnect) {
    guideSplitCompareCanvasManager.resizeObserver.disconnect();
  }
  try {
    guideSplitCompareCanvasManager?.fabricCanvas?.dispose?.();
  } catch (error) {
    console.warn('[GuideSplit] Failed to dispose compare canvas cleanly', error);
  }
  guideSplitCompareCanvasManager = null;
  guideSplitCompareTagManager = null;
  window.app?.registerCompareCanvasManager?.(null);
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
  const widthBySize = { S: 860, M: 1080, L: 1320, XL: 1520, XXL: 1760 };
  const width = Math.min(widthBySize[size] || 1320, window.innerWidth - 16);
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

  const projectImageEl = root.querySelector('#guideFlashProjectImage');
  if (projectImageEl) {
    const sourceViewId = String(projectImageEl.dataset.previewViewId || '').trim();
    requestAnimationFrame(() => {
      applyImagePreviewViewport(projectImageEl, sourceViewId || getCurrentViewId());
    });
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

function getExplicitTabId(viewId) {
  const raw = String(viewId || '').trim();
  const marker = '::tab:';
  const index = raw.indexOf(marker);
  if (index < 0) return '';
  return raw.slice(index + marker.length).trim();
}

function getActiveTabIdForView(viewId) {
  const explicitTabId = getExplicitTabId(viewId);
  if (explicitTabId && explicitTabId !== 'master') {
    return explicitTabId;
  }
  const baseViewId = toBaseViewId(viewId);
  const state =
    window.captureTabsByLabel && typeof window.captureTabsByLabel === 'object'
      ? window.captureTabsByLabel[baseViewId]
      : null;
  if (!state || typeof state !== 'object') return '';
  const activeTabId = String(state.activeTabId || '').trim();
  if (activeTabId && activeTabId !== 'master' && activeTabId !== String(state.masterTabId || '')) {
    return activeTabId;
  }
  const fallback = String(
    window.captureMasterDrawTargetByLabel?.[baseViewId] || state.lastNonMasterId || ''
  ).trim();
  return fallback;
}

function getFrameScopeIdForView(viewId) {
  const baseViewId = toBaseViewId(viewId);
  const tabId = getActiveTabIdForView(viewId);
  if (!tabId) return '';
  return `${baseViewId}::tab:${tabId}`;
}

function resolveModelBindingForView(viewId = getCurrentViewId()) {
  const state = getGuideModelLinkState();
  const byId = new Map(state.selections.map(item => [item.id, item]));
  const imageScopeId = toBaseViewId(viewId);
  const frameScopeId = getFrameScopeIdForView(viewId);
  const frameSelectionId = frameScopeId ? state.linksByScope[frameScopeId] || '' : '';
  const imageSelectionId =
    state.linksByScope[imageScopeId] || state.linksByImage[imageScopeId] || '';
  const frameSelection = frameSelectionId ? byId.get(frameSelectionId) : null;
  const imageSelection = imageSelectionId ? byId.get(imageSelectionId) : null;
  if (frameSelection) {
    return {
      scopeId: frameScopeId,
      scopeType: 'frame',
      selectionId: frameSelectionId,
      selection: frameSelection,
      imageScopeId,
      frameScopeId,
    };
  }
  if (imageSelection) {
    return {
      scopeId: imageScopeId,
      scopeType: 'image',
      selectionId: imageSelectionId,
      selection: imageSelection,
      imageScopeId,
      frameScopeId,
    };
  }
  return {
    scopeId: '',
    scopeType: 'none',
    selectionId: '',
    selection: null,
    imageScopeId,
    frameScopeId,
  };
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
      return {
        codes,
        activeCode,
        activeVariant: entry.activeVariant || 'front',
        locked,
        scopeType,
        scopeId: candidate,
      };
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
        activeVariant: projectBinding.activeVariant || 'front',
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
      activeVariant: defaults.activeVariant || 'front',
      locked: false,
      scopeType: 'default',
      scopeId: '__default__',
    };
  }
  return {
    codes: [],
    activeCode: '',
    activeVariant: 'front',
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
    .guide-flash-compare {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      padding: 10px;
    }
    .guide-flash-pane {
      background: rgba(248, 250, 252, 0.12);
      border: 1px solid rgba(148, 163, 184, 0.3);
      border-radius: 10px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      min-height: min(58vh, 760px);
    }
    .guide-flash-pane-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .06em;
      padding: 7px 9px;
      border-bottom: 1px solid rgba(148, 163, 184, 0.3);
      color: #e2e8f0;
    }
    .guide-flash-pane-body {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 8px;
      background: rgba(255, 255, 255, 0.08);
      position: relative;
      min-height: 220px;
      overflow: hidden;
    }
    .guide-flash-pane-body img {
      width: 100%;
      height: 100%;
      max-height: min(70vh, 980px);
      object-fit: contain;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.5);
    }
    .guide-flash-strip-wrap {
      padding: 0 10px 10px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .guide-flash-strip-card {
      border: 1px solid rgba(148, 163, 184, 0.35);
      border-radius: 10px;
      background: rgba(15, 23, 42, 0.32);
      padding: 8px;
    }
    .guide-flash-strip-title {
      font-size: 10px;
      letter-spacing: .06em;
      text-transform: uppercase;
      color: #cbd5e1;
      margin-bottom: 6px;
      font-weight: 700;
    }
    .guide-flash-strip {
      display: grid;
      gap: 6px;
      max-height: 140px;
      overflow: auto;
    }
    .guide-flash-strip-item {
      border: 1px solid rgba(148, 163, 184, 0.35);
      background: rgba(15, 23, 42, 0.42);
      color: #e2e8f0;
      border-radius: 8px;
      padding: 5px 7px;
      font-size: 11px;
      display: grid;
      grid-template-columns: 42px 1fr;
      gap: 8px;
      align-items: center;
      cursor: pointer;
      text-align: left;
    }
    .guide-flash-strip-item.active {
      border-color: rgba(125, 211, 252, 0.85);
      background: rgba(14, 116, 144, 0.45);
      color: #f0f9ff;
    }
    .guide-flash-strip-item img {
      width: 42px;
      height: 30px;
      object-fit: contain;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.65);
    }
    .guide-flash-nav {
      width: 26px;
      height: 26px;
      border-radius: 999px;
      border: 1px solid rgba(226, 232, 240, 0.55);
      background: rgba(15, 23, 42, 0.7);
      color: #f8fafc;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      line-height: 1;
      font-weight: 700;
      cursor: pointer;
      user-select: none;
    }
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
    @media (max-width: 1100px) {
      .guide-flash-compare,
      .guide-flash-strip-wrap {
        grid-template-columns: 1fr;
      }
      .guide-flash-pane {
        min-height: 180px;
      }
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
      margin: 20px auto 40px;
      padding: 0 20px 40px;
    }
    .guide-gallery-chrome {
      position: sticky;
      top: 0;
      z-index: 13560;
      padding-top: 12px;
      backdrop-filter: blur(8px);
    }
    .guide-gallery-content {
      margin-top: 14px;
    }
    .guide-gallery-layout {
      display: grid;
      grid-template-columns: minmax(360px, 1fr) minmax(420px, 560px);
      gap: 16px;
      align-items: start;
    }
    .guide-gallery-main {
      min-width: 0;
    }
    .guide-gallery-preview {
      position: sticky;
      top: 24px;
      background: rgba(255, 255, 255, 0.98);
      border: 1px solid rgba(203, 213, 225, 0.8);
      border-radius: 12px;
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.15);
      padding: 12px;
    }
    .guide-gallery-preview-title {
      font-size: 13px;
      font-weight: 700;
      color: #0f172a;
      margin: 0 0 10px;
    }
    .guide-gallery-preview-empty {
      margin: 0;
      font-size: 12px;
      color: #64748b;
    }
    .guide-gallery-preview-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 10px;
    }
    .guide-gallery-preview-card {
      border: 1px solid rgba(203, 213, 225, 0.8);
      border-radius: 10px;
      overflow: hidden;
      background: #fff;
    }
    .guide-gallery-preview-card-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 10px;
      border-bottom: 1px solid rgba(203, 213, 225, 0.7);
      font-size: 11px;
      font-weight: 700;
      color: #1e293b;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .guide-gallery-preview-apply {
      border: 1px solid #cbd5e1;
      background: #f8fafc;
      color: #1e293b;
      border-radius: 7px;
      padding: 3px 7px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
    }
    .guide-gallery-preview-apply:hover {
      background: #eef2ff;
      border-color: #a5b4fc;
      color: #312e81;
    }
    .guide-gallery-preview-body {
      display: grid;
      grid-template-columns: 170px 1fr;
      gap: 8px;
      padding: 8px;
    }
    .guide-gallery-preview-image {
      background: #f8fafc;
      border: 1px solid rgba(226, 232, 240, 0.9);
      border-radius: 8px;
      min-height: 140px;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .guide-gallery-preview-image img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      max-height: 180px;
    }
    .guide-gallery-token-list {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-content: flex-start;
    }
    .guide-gallery-token-pill {
      display: inline-flex;
      align-items: center;
      padding: 2px 7px;
      border-radius: 999px;
      border: 1px solid #dbeafe;
      background: #eff6ff;
      color: #1e3a8a;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.02em;
    }
    .guide-gallery-token-loading,
    .guide-gallery-token-empty,
    .guide-gallery-token-error {
      font-size: 11px;
      color: #64748b;
    }
    .guide-gallery-token-error {
      color: #b91c1c;
    }
    .guide-gallery-header {
      background: rgba(255, 255, 255, 0.98);
      border-radius: 14px;
      padding: 20px 148px 20px 24px;
      margin-bottom: 0;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
      position: relative;
    }
    .guide-gallery-header.compact {
      padding-bottom: 10px;
    }
    .guide-gallery-header.compact .guide-gallery-link-grid {
      display: none;
    }
    .guide-gallery-header.compact:hover .guide-gallery-link-grid {
      display: grid;
    }
    .guide-gallery-toolbar {
      margin-top: 12px;
      display: grid;
      grid-template-columns: 1fr auto auto auto auto;
      gap: 8px;
      align-items: center;
    }
    .guide-gallery-search-wrap {
      margin-top: 10px;
    }
    .guide-gallery-search-wrap.hidden {
      display: none;
    }
    .guide-gallery-toggle-search {
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 8px 10px;
      font-size: 12px;
      color: #0f172a;
      background: #fff;
      cursor: pointer;
      font-weight: 700;
    }
    .guide-gallery-toggle-search:hover {
      background: #eef2ff;
      border-color: #a5b4fc;
      color: #312e81;
    }
    .guide-gallery-toolbar select,
    .guide-gallery-toolbar button {
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 8px 10px;
      font-size: 12px;
      color: #0f172a;
      background: #fff;
    }
    .guide-gallery-toolbar button {
      cursor: pointer;
      font-weight: 700;
    }
    .guide-gallery-toolbar button:hover {
      background: #eef2ff;
      border-color: #a5b4fc;
      color: #312e81;
    }
    .guide-gallery-toolbar button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .guide-gallery-mode.active {
      background: #dbeafe;
      border-color: #3b82f6;
      color: #1e3a8a;
    }
    .guide-gallery-status {
      grid-column: 1 / -1;
      font-size: 11px;
      color: #475569;
    }
    .guide-gallery-status.empty {
      color: #7c3aed;
      font-weight: 700;
    }
    .guide-gallery-link-grid {
      margin-top: 12px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .guide-gallery-link-grid.bind-mode {
      grid-template-columns: 1fr;
    }
    .guide-gallery-bind-preview {
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      background: #fff;
      padding: 10px;
      display: grid;
      gap: 10px;
    }
    .guide-gallery-bind-preview-main {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      gap: 10px;
      align-items: center;
    }
    .guide-gallery-bind-preview-pane {
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      min-height: 260px;
      background: #f8fafc;
      display: grid;
      place-items: center;
      padding: 10px;
      overflow: hidden;
    }
    .guide-gallery-bind-preview-pane img {
      width: 100%;
      height: 240px;
      object-fit: contain;
      border-radius: 8px;
      background: #fff;
      border: 1px solid #dbeafe;
    }
    .guide-gallery-bind-preview-meta {
      margin-top: 6px;
      font-size: 11px;
      color: #334155;
      text-align: center;
      font-weight: 700;
    }
    .guide-gallery-bind-preview-actions {
      display: grid;
      gap: 8px;
      justify-items: center;
    }
    .guide-gallery-bind-preview-strip {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .guide-gallery-bind-strip {
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 8px;
      max-height: 160px;
      overflow: auto;
      background: #fff;
      display: grid;
      gap: 6px;
    }
    .guide-gallery-bind-strip-item {
      display: grid;
      grid-template-columns: 40px 1fr;
      gap: 8px;
      align-items: center;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 5px;
      background: #fff;
      cursor: pointer;
      font-size: 11px;
      color: #334155;
    }
    .guide-gallery-bind-strip-item.active {
      border-color: #3b82f6;
      background: #eff6ff;
      color: #1e3a8a;
      font-weight: 700;
    }
    .guide-gallery-bind-strip-item img {
      width: 40px;
      height: 30px;
      object-fit: contain;
      border-radius: 5px;
      background: #f8fafc;
      border: 1px solid #dbeafe;
    }
    .guide-gallery-link-card {
      border: 1px solid rgba(203, 213, 225, 0.9);
      border-radius: 10px;
      padding: 10px;
      background: #fff;
      min-height: 120px;
    }
    .guide-gallery-link-title {
      margin: 0 0 8px;
      font-size: 12px;
      font-weight: 700;
      color: #0f172a;
    }
    .guide-gallery-link-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
    }
    .guide-gallery-link-table th,
    .guide-gallery-link-table td {
      border-bottom: 1px solid #e2e8f0;
      padding: 7px 6px;
      text-align: left;
      vertical-align: middle;
      color: #334155;
    }
    .guide-gallery-link-table th {
      color: #0f172a;
      font-size: 10px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .guide-gallery-link-table td strong {
      color: #0f172a;
    }
    .guide-gallery-link-actions {
      display: inline-flex;
      gap: 6px;
      margin-left: 8px;
    }
    .guide-gallery-link-btn {
      border: 1px solid #cbd5e1;
      border-radius: 7px;
      background: #fff;
      color: #334155;
      font-size: 10px;
      font-weight: 700;
      padding: 2px 7px;
      cursor: pointer;
      white-space: nowrap;
    }
    .guide-gallery-link-btn:hover {
      background: #eff6ff;
      border-color: #93c5fd;
      color: #1d4ed8;
    }
    .guide-gallery-link-btn.unlink {
      border-color: #fecaca;
      color: #b91c1c;
      background: #fff5f5;
    }
    .guide-gallery-link-btn.unlink:hover {
      background: #fee2e2;
      border-color: #f87171;
      color: #991b1b;
    }
    .guide-gallery-bind-board {
      display: grid;
      gap: 8px;
    }
    .guide-gallery-bind-row {
      display: grid;
      grid-template-columns: minmax(170px, 220px) minmax(170px, 220px) auto;
      gap: 10px;
      align-items: center;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      background: #f8fafc;
      padding: 8px;
    }
    .guide-gallery-bind-thumb {
      display: flex;
      gap: 8px;
      align-items: center;
      min-width: 0;
    }
    .guide-gallery-bind-thumb img {
      width: 60px;
      height: 44px;
      object-fit: contain;
      border: 1px solid #dbeafe;
      border-radius: 8px;
      background: #fff;
      flex: 0 0 auto;
    }
    .guide-gallery-bind-thumb span {
      font-size: 11px;
      color: #334155;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .guide-gallery-bind-model-list {
      display: grid;
      gap: 6px;
    }
    .guide-gallery-bind-model-item {
      display: grid;
      grid-template-columns: 16px 44px 1fr;
      gap: 8px;
      align-items: center;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 6px;
      background: #fff;
      cursor: pointer;
    }
    .guide-gallery-bind-model-item.active {
      border-color: #3b82f6;
      background: #eff6ff;
    }
    .guide-gallery-bind-model-item img {
      width: 44px;
      height: 34px;
      object-fit: contain;
      border: 1px solid #dbeafe;
      border-radius: 6px;
      background: #fff;
    }
    .guide-gallery-link-list {
      margin: 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: 6px;
    }
    .guide-gallery-link-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 11px;
      color: #334155;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 6px 8px;
      background: #f8fafc;
    }
    .guide-gallery-link-row strong {
      color: #0f172a;
    }
    .guide-gallery-link-pill {
      border-radius: 999px;
      padding: 2px 7px;
      font-size: 10px;
      font-weight: 700;
      border: 1px solid #bfdbfe;
      background: #eff6ff;
      color: #1e3a8a;
      white-space: nowrap;
    }

    #main-canvas-wrapper.guide-split-active {
      display: block !important;
      padding: 0;
      background: #fff;
    }
    .guide-split-root {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr);
      width: 100%;
      height: 100%;
      min-height: 0;
    }
    .guide-split-pane {
      position: relative;
      min-width: 0;
      min-height: 0;
      height: 100%;
      overflow: hidden;
      background: #ffffff;
    }
    .guide-split-live-pane {
      border: 0;
    }
    .guide-split-live-pane.is-transitioning {
      pointer-events: none;
    }
    .guide-split-live-pane #captureOverlay {
      position: absolute !important;
      inset: 0 !important;
      width: 100% !important;
      height: 100% !important;
      z-index: 35 !important;
    }
    .guide-split-frame-ghost {
      position: absolute;
      display: none;
      pointer-events: none;
      border: 2px solid #22c55e;
      background: transparent;
      box-shadow: 0 0 0 2000px rgba(255, 255, 255, 1);
      z-index: 36;
    }
    .guide-split-guide-pane {
      border-left: 1px solid #cbd5e1;
      display: grid;
      grid-template-rows: auto 1fr;
      min-height: 0;
      overflow: hidden;
      background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
    }
    .guide-split-pane.is-active {
      box-shadow: inset 0 0 0 2px rgba(37, 99, 235, 0.18);
    }
    .guide-split-pane-meta {
      position: absolute;
      left: 10px;
      top: 12px;
      z-index: 25;
      pointer-events: none;
    }
    .guide-split-pane-chip {
      display: inline-grid;
      gap: 2px;
      padding: 8px 10px;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.94);
      border: 1px solid rgba(148, 163, 184, 0.38);
      box-shadow: 0 8px 20px rgba(15, 23, 42, 0.1);
      color: #0f172a;
      font-size: 11px;
      line-height: 1.2;
      max-width: min(280px, calc(100% - 24px));
    }
    .guide-split-pane-chip strong {
      font-size: 12px;
      font-weight: 800;
    }
    .guide-split-pane-chip span {
      color: #475569;
      font-weight: 600;
    }
    .guide-split-pane-chip.active {
      border-color: rgba(37, 99, 235, 0.5);
      box-shadow: 0 10px 24px rgba(37, 99, 235, 0.16);
    }
    .guide-split-guide-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 9px 12px;
      border-bottom: 1px solid #e2e8f0;
      background: rgba(248, 250, 252, 0.96);
      font-size: 11px;
      font-weight: 800;
      color: #0f172a;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .guide-split-guide-sub {
      font-size: 10px;
      font-weight: 600;
      color: #475569;
      text-transform: none;
      letter-spacing: normal;
    }
    .guide-split-guide-actions {
      display: inline-flex;
      align-items: center;
      justify-content: flex-end;
      flex-wrap: wrap;
      gap: 6px;
      max-width: 100%;
    }
    .guide-split-guide-actions button {
      border: 1px solid #cbd5e1;
      border-radius: 7px;
      background: #fff;
      color: #334155;
      font-size: 11px;
      font-weight: 700;
      padding: 4px 8px;
      cursor: pointer;
      text-transform: none;
      letter-spacing: normal;
    }
    .guide-split-guide-actions button:hover {
      border-color: #94a3b8;
      background: #f8fafc;
    }
    .guide-split-picker-label {
      display: grid;
      gap: 3px;
      min-width: 132px;
      color: #475569;
      font-size: 10px;
      font-weight: 700;
      text-transform: none;
      letter-spacing: normal;
    }
    .guide-split-picker-label select {
      min-width: 132px;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      background: #fff;
      color: #0f172a;
      font-size: 12px;
      font-weight: 600;
      padding: 6px 8px;
    }
    .guide-split-guide-body {
      position: relative;
      min-height: 0;
      padding: 8px;
      overflow: hidden;
      display: grid;
      grid-template-rows: auto 1fr;
      align-content: stretch;
      justify-items: center;
      gap: 8px;
    }
    .guide-split-guide-body.is-empty {
      display: grid;
      place-items: center;
    }
    .guide-split-pane-canvas-host {
      position: relative;
      min-width: 0;
      min-height: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #fff;
    }
    .guide-split-compare-host {
      border-radius: 8px;
      border: 1px solid #dbeafe;
      justify-self: center;
      align-self: center;
      max-width: 100%;
      max-height: 100%;
    }
    body.guide-split-workspace-active #strokePanelIcon,
    body.guide-split-workspace-active #imagePanelIcon {
      display: none !important;
      visibility: hidden !important;
      pointer-events: none !important;
    }
    .guide-split-guide-empty {
      text-align: center;
      display: grid;
      gap: 8px;
      color: #64748b;
      font-size: 12px;
      align-items: center;
      justify-items: center;
      max-width: 320px;
      margin: auto;
    }
    .guide-split-guide-empty button {
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      background: #fff;
      color: #334155;
      font-size: 12px;
      font-weight: 700;
      padding: 6px 10px;
      cursor: pointer;
    }
    .guide-split-guide-empty button:hover {
      background: #eef2ff;
      border-color: #a5b4fc;
      color: #312e81;
    }

    .capture-tab-guide-status {
      padding: 4px 10px;
      border-radius: 999px;
      border: 1px solid rgba(15, 23, 42, 0.18);
      background: rgba(255, 255, 255, 0.94);
      font-size: 12px;
      font-weight: 700;
      color: #0f172a;
      cursor: pointer;
      white-space: nowrap;
    }
    .capture-tab-guide-status.unbound {
      border-color: #fca5a5;
      color: #b91c1c;
      background: #fff5f5;
    }
    .capture-tab-guide-status.bound {
      border-color: #93c5fd;
      color: #1e3a8a;
      background: #eff6ff;
    }
    .capture-tab-guide-status.active {
      border-color: #1d4ed8;
      color: #ffffff;
      background: #1d4ed8;
    }
    .guide-gallery-link-pill.model-only {
      border-color: #fcd34d;
      background: #fffbeb;
      color: #92400e;
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
    .guide-gallery-item.selected {
      border-color: #1d4ed8;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.3);
      background: #f8fbff;
    }
    .guide-gallery-item-label {
      font-size: 13px;
      font-weight: 700;
      color: #0f172a;
      padding: 10px 12px;
      border-bottom: 1px solid rgba(203, 213, 225, 0.6);
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 8px;
    }
    .guide-gallery-item-select {
      margin-right: 6px;
      width: 16px;
      height: 16px;
      cursor: pointer;
      vertical-align: middle;
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
      position: absolute;
      top: 12px;
      right: 12px;
      background: rgba(255, 255, 255, 0.98);
      border: 1px solid rgba(203, 213, 225, 0.8);
      border-radius: 8px;
      padding: 8px 16px;
      font-size: 13px;
      font-weight: 600;
      color: #0f172a;
      cursor: pointer;
      z-index: 13570;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }
    .guide-gallery-close:hover {
      background: #f1f5f9;
    }
    @media (max-width: 1180px) {
      .guide-gallery-layout {
        grid-template-columns: 1fr;
      }
      .guide-gallery-preview {
        position: static;
      }
      .guide-gallery-preview-body {
        grid-template-columns: 1fr;
      }
      .guide-gallery-toolbar {
        grid-template-columns: 1fr;
      }
      .guide-gallery-link-grid {
        grid-template-columns: 1fr;
      }
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

function buildGuidePreviewUrl(code, view) {
  return `${buildGuideUrl(code, view)}&hideBoxes=1`;
}

async function fetchAvailableGuideCodes(fallbackCodes = []) {
  if (Array.isArray(guideCodeListCache) && guideCodeListCache.length) {
    return {
      codes: guideCodeListCache,
      viewsByCode: guideViewsByCodeCache || {},
    };
  }

  if (!guideCodeListPromise) {
    guideCodeListPromise = fetch('/api/measurement-guides/codes', { method: 'GET' })
      .then(async response => {
        if (!response.ok) {
          throw new Error(`Guide code list fetch failed (${response.status})`);
        }
        const payload = await response.json().catch(() => ({}));
        const codes = Array.isArray(payload?.codes)
          ? payload.codes.map(code => normalizeCode(code)).filter(Boolean)
          : [];
        const rawViewsByCode =
          payload?.viewsByCode && typeof payload.viewsByCode === 'object'
            ? payload.viewsByCode
            : {};

        const merged = Array.from(
          new Set([
            ...(fallbackCodes || []).map(code => normalizeCode(code)).filter(Boolean),
            ...codes,
          ])
        ).sort((a, b) => a.localeCompare(b));

        const normalizedViewsByCode = {};
        merged.forEach(code => {
          const rawViews = Array.isArray(rawViewsByCode[code]) ? rawViewsByCode[code] : ['front'];
          const views = Array.from(
            new Set(
              rawViews
                .map(view =>
                  String(view || '')
                    .trim()
                    .toLowerCase()
                )
                .filter(view => view === 'front' || view === 'back' || view === 'side')
            )
          ).sort(
            (a, b) => ['front', 'back', 'side'].indexOf(a) - ['front', 'back', 'side'].indexOf(b)
          );
          normalizedViewsByCode[code] = views.length ? views : ['front'];
        });

        guideCodeListCache = merged;
        guideViewsByCodeCache = normalizedViewsByCode;
        return {
          codes: merged,
          viewsByCode: normalizedViewsByCode,
        };
      })
      .catch(() => {
        const fallback = Array.from(
          new Set((fallbackCodes || []).map(code => normalizeCode(code)).filter(Boolean))
        ).sort((a, b) => a.localeCompare(b));
        const fallbackViewsByCode = {};
        fallback.forEach(code => {
          fallbackViewsByCode[code] = ['front', 'back', 'side'];
        });
        guideCodeListCache = fallback;
        guideViewsByCodeCache = fallbackViewsByCode;
        return {
          codes: fallback,
          viewsByCode: fallbackViewsByCode,
        };
      })
      .finally(() => {
        guideCodeListPromise = null;
      });
  }

  return guideCodeListPromise;
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
      img.src = `${buildGuidePreviewUrl(code, view)}&cb=${Date.now()}`;
    });
  });
}

function normalizeRoleToken(value) {
  const token = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '');
  if (!token) return '';
  if (token.length > 20) return '';
  if (/^\d+$/.test(token)) return '';
  return token;
}

function canonicalRoleToken(value) {
  const token = normalizeRoleToken(value);
  if (!token) return '';
  const strippedUnits = token.replace(/(?:CM|MM|IN)\d*$/i, '');
  return strippedUnits || token;
}

function roleTokenFromElementId(id) {
  const normalized = String(id || '')
    .replace(/^mos\d+_/, '')
    .trim();
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

function extractRoleTokensFromSvg(svgText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  const byCanonical = new Map();

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
    const token = roleTokenFromElementId(node.getAttribute('id') || '');
    if (!token) return;
    const canonical = canonicalRoleToken(token);
    if (!canonical) return;
    if (!byCanonical.has(canonical) || token.length < (byCanonical.get(canonical) || '').length) {
      byCanonical.set(canonical, token);
    }
  });

  return Array.from(byCanonical.values()).sort((a, b) => a.localeCompare(b));
}

async function fetchGuideRoleTokens(code, view) {
  const key = `${code}::${view}`;
  if (guideRoleTokenCache.has(key)) {
    return guideRoleTokenCache.get(key) || [];
  }

  const response = await fetch(buildGuideUrl(code, view), { method: 'GET' });
  if (!response.ok) {
    throw new Error(`Failed to fetch role tokens (${response.status})`);
  }

  const svgText = await response.text();
  const tokens = extractRoleTokensFromSvg(svgText);
  guideRoleTokenCache.set(key, tokens);
  return tokens;
}

async function fetchGuideSvgText(code, view) {
  const key = `${code}::${view}`;
  if (guideSvgCache.has(key)) {
    return guideSvgCache.get(key);
  }

  const response = await fetch(buildGuideUrl(code, view), { method: 'GET' });
  if (!response.ok) {
    throw new Error(`Failed to fetch guide SVG (${response.status})`);
  }

  const svgText = await response.text();
  guideSvgCache.set(key, svgText);
  return svgText;
}

function parseSvgNumericAttr(raw) {
  const source = String(raw || '').trim();
  if (!source) return 0;
  if (source.includes('%')) return 0;
  const value = source.match(/-?\d+(?:\.\d+)?/)?.[0];
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalizeGuideRasterMode(options = {}) {
  const explicitMode = String(options.mode || '')
    .trim()
    .toLowerCase();
  if (explicitMode === 'base' || explicitMode === 'preview' || explicitMode === 'highlight-only') {
    return explicitMode;
  }
  if (options.hideGuideMeasurements !== false) return 'base';
  if (options.hideGuideMeasurementValues === true) return 'preview';
  return 'preview';
}

function isZeroPlaceholderText(value) {
  const normalized = String(value || '')
    .replace(/\s+/g, '')
    .replace(/,/g, '');
  if (!normalized) return false;
  return /^0+(?:\.\d+)?$/.test(normalized);
}

function containsPlaceholderValue(group) {
  if (!group?.querySelectorAll) return false;
  return Array.from(group.querySelectorAll('text, tspan')).some(node =>
    isZeroPlaceholderText(node.textContent || '')
  );
}

function getGroupRoleInfo(group) {
  const rawId = String(group?.getAttribute?.('id') || '').trim();
  if (!rawId) return null;
  const normalizedId = rawId.replace(/^mos\d+_/, '').trim();
  const prefix = normalizedId[0]?.toLowerCase() || '';
  const token = roleTokenFromElementId(normalizedId);
  const canonicalToken = canonicalRoleToken(token);
  return {
    rawId,
    normalizedId,
    prefix,
    token,
    canonicalToken,
  };
}

function styleGuideGroupForHighlight(group, prefix) {
  if (!group?.querySelectorAll) return;
  if (prefix === 'm') {
    group.querySelectorAll('line, path, polyline').forEach(node => {
      node.setAttribute('stroke', '#ef4444');
      node.setAttribute('fill', 'none');
    });
    return;
  }

  if (prefix === 'c') {
    group.querySelectorAll('rect').forEach(node => {
      node.setAttribute('fill', '#fff7ed');
      node.setAttribute('stroke', '#ef4444');
    });
    group.querySelectorAll('text, tspan').forEach(node => {
      node.setAttribute('fill', '#9a3412');
    });
  }
}

function prepareSvgForRaster(svgText, options = {}) {
  const mode = normalizeGuideRasterMode(options);
  const activeRole = normalizeRoleToken(options.activeRole || '');
  const activeCanonicalRole = canonicalRoleToken(activeRole);
  const dimInactive = options.dimInactive !== false;
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  const root = doc.querySelector('svg');
  if (!root) {
    return {
      svgText,
      width: 1600,
      height: 900,
    };
  }

  const viewBoxRaw = root.getAttribute('viewBox') || '';
  const vbParts = viewBoxRaw.trim().split(/\s+/).map(Number).filter(Number.isFinite);

  const vbWidth = vbParts.length === 4 ? vbParts[2] : 0;
  const vbHeight = vbParts.length === 4 ? vbParts[3] : 0;

  let width = parseSvgNumericAttr(root.getAttribute('width'));
  let height = parseSvgNumericAttr(root.getAttribute('height'));

  // Prefer viewBox dimensions when present so rasterized guide geometry matches
  // MOS vector import coordinates (which are normalized from viewBox space).
  if (vbWidth) width = vbWidth;
  if (vbHeight) height = vbHeight;

  if (!width) width = 1600;
  if (!height) height = 900;

  if (!vbWidth || !vbHeight) {
    root.setAttribute('viewBox', `0 0 ${width} ${height}`);
  }

  const allGroups = Array.from(root.querySelectorAll('g'));
  allGroups.forEach(group => {
    const info = getGroupRoleInfo(group);
    const isMeasurementGroup =
      info && (info.prefix === 'm' || info.prefix === 'b' || info.prefix === 'c');
    if (!isMeasurementGroup) return;

    const matchesActiveRole =
      info?.canonicalToken && activeCanonicalRole
        ? info.canonicalToken === activeCanonicalRole
        : false;
    const isPlaceholderGroup = info?.prefix === 'b' || containsPlaceholderValue(group);

    if (mode === 'base') {
      group.setAttribute('display', 'none');
      return;
    }

    if (isPlaceholderGroup) {
      group.setAttribute('display', 'none');
      return;
    }

    if (mode === 'highlight-only') {
      if (!matchesActiveRole || (info?.prefix !== 'm' && info?.prefix !== 'c')) {
        group.setAttribute('display', 'none');
        return;
      }
      group.setAttribute('opacity', '1');
      styleGuideGroupForHighlight(group, info.prefix);
      return;
    }

    if (matchesActiveRole) {
      group.setAttribute('opacity', '1');
      styleGuideGroupForHighlight(group, info.prefix);
      return;
    }

    if (dimInactive && (info?.prefix === 'm' || info?.prefix === 'c')) {
      group.setAttribute('opacity', '0.22');
    }
  });

  root.setAttribute('width', String(width));
  root.setAttribute('height', String(height));
  root.setAttribute(
    'preserveAspectRatio',
    root.getAttribute('preserveAspectRatio') || 'xMidYMid meet'
  );

  const serializer = new XMLSerializer();
  return {
    svgText: serializer.serializeToString(doc),
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image source'));
    img.src = src;
  });
}

function computeRasterSize(width, height) {
  const safeWidth = Math.max(1, Math.round(width || 1));
  const safeHeight = Math.max(1, Math.round(height || 1));
  const maxEdge = Math.max(safeWidth, safeHeight);
  const minEdge = Math.min(safeWidth, safeHeight);
  const dprBoost = Math.min(2, Math.max(1, window.devicePixelRatio || 1));

  // Upscale small SVGs so they stay crisp when fitted onto canvas.
  const upscaleToMin = minEdge > 0 ? GUIDE_RASTER_MIN_EDGE / minEdge : 1;
  let scale = Math.max(1, upscaleToMin, dprBoost);

  const scaledMaxEdge = maxEdge * scale;
  if (scaledMaxEdge > GUIDE_RASTER_MAX_EDGE) {
    scale = GUIDE_RASTER_MAX_EDGE / maxEdge;
  }

  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  };
}

export function resolveGuideActiveRole(viewId, roles = []) {
  const normalizedRoles = Array.from(
    new Set(
      (Array.isArray(roles) ? roles : []).map(role => normalizeRoleToken(role)).filter(Boolean)
    )
  );
  const roleMap = new Map(
    normalizedRoles.map(role => [canonicalRoleToken(role), role]).filter(([key]) => !!key)
  );
  const normalizeCandidate = value => {
    const token = normalizeRoleToken(value);
    if (!token) return '';
    const canonical = canonicalRoleToken(token);
    if (roleMap.size) {
      return roleMap.get(canonical) || '';
    }
    return token;
  };

  const baseViewId = toBaseViewId(String(viewId || '').trim() || getCurrentViewId());
  const scopedViewId = resolveScopedImageLabel(baseViewId) || baseViewId;
  const currentViewId = toBaseViewId(getCurrentViewId());
  const currentScopedViewId = resolveScopedImageLabel(currentViewId) || currentViewId;
  const seeds = window.guideOneTimeTagByImage || {};
  const seedCandidates = [
    seeds[scopedViewId],
    seeds[baseViewId],
    seeds[currentScopedViewId],
    seeds[currentViewId],
  ];

  for (const candidate of seedCandidates) {
    const matched = normalizeCandidate(candidate);
    if (matched) return matched;
  }

  const nextTag =
    typeof window.app?.tagManager?.getNextTag === 'function'
      ? window.app.tagManager.getNextTag(baseViewId)
      : '';
  const matchedNextTag = normalizeCandidate(nextTag);
  if (matchedNextTag) return matchedNextTag;

  const nextTagDisplay = document.getElementById('nextTagDisplay');
  if (nextTagDisplay) {
    const matchedDisplay = normalizeCandidate(nextTagDisplay.textContent || '');
    if (matchedDisplay) return matchedDisplay;
  }

  return '';
}

export async function fetchGuideRasterUrl(code, view, options = {}) {
  const mode = normalizeGuideRasterMode(options);
  const activeRole = normalizeRoleToken(options.activeRole || '');
  const dimInactive = options.dimInactive !== false;
  const key = `${GUIDE_RASTER_CACHE_VERSION}::${code}::${view}::mode:${mode}::role:${activeRole || 'none'}::dim:${dimInactive ? 'yes' : 'no'}`;
  if (guideRasterCache.has(key)) {
    return guideRasterCache.get(key);
  }

  const rawSvg = await fetchGuideSvgText(code, view);
  const prepared = prepareSvgForRaster(rawSvg, { ...options, mode, activeRole, dimInactive });
  const svgBlob = new Blob([prepared.svgText], {
    type: 'image/svg+xml;charset=utf-8',
  });
  const blobUrl = URL.createObjectURL(svgBlob);

  try {
    const img = await loadImage(blobUrl);
    const width = prepared.width || img.naturalWidth || 1600;
    const height = prepared.height || img.naturalHeight || 900;
    const raster = computeRasterSize(width, height);
    const canvas = document.createElement('canvas');
    canvas.width = raster.width;
    canvas.height = raster.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas context unavailable');
    }
    ctx.clearRect(0, 0, raster.width, raster.height);
    ctx.drawImage(img, 0, 0, raster.width, raster.height);
    const pngDataUrl = canvas.toDataURL('image/png');
    guideRasterCache.set(key, pngDataUrl);
    return pngDataUrl;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

function createGuideViewId(baseId) {
  const manager = window.app?.projectManager || window.projectManager;
  const views = manager?.views || {};
  const normalized =
    String(baseId || 'guide-view')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'guide-view';
  if (!views[normalized]) return normalized;
  let index = 2;
  while (views[`${normalized}-${index}`]) {
    index += 1;
  }
  return `${normalized}-${index}`;
}

function setStatusMessage(message, kind = 'info') {
  if (typeof window.showStatusMessage === 'function') {
    window.showStatusMessage(message, kind);
  } else {
    console.log(`[Guide] ${message}`);
  }
}

async function waitForGuideImportReady(viewId, timeoutMs = 2200) {
  const manager = window.app?.projectManager || window.projectManager;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const currentViewId = String(manager?.currentViewId || '').trim();
    const canvas = window.app?.canvasManager?.fabricCanvas;
    const bgImage = canvas?.backgroundImage || null;
    if (currentViewId === viewId && canvas && bgImage) {
      return true;
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  return false;
}

function tagGuideOnView(viewId, code, view) {
  const manager = window.app?.projectManager || window.projectManager;
  if (!manager || typeof manager.getProjectMetadata !== 'function') return;
  const currentMeta = manager.getProjectMetadata() || {};
  const currentLabels =
    currentMeta.measurementGuideLabelsByImage &&
    typeof currentMeta.measurementGuideLabelsByImage === 'object'
      ? currentMeta.measurementGuideLabelsByImage
      : {};
  const nextLabels = {
    ...currentLabels,
    [viewId]: `${code} ${String(view).toUpperCase()}`,
  };
  if (typeof manager.setProjectMetadata === 'function') {
    manager.setProjectMetadata({ measurementGuideLabelsByImage: nextLabels });
  } else {
    window.projectMetadata = {
      ...(window.projectMetadata || {}),
      measurementGuideLabelsByImage: nextLabels,
    };
  }
}

function buildModelSelectionId(code, variant) {
  return `${normalizeCode(code)}::${String(variant || 'front').toLowerCase()}`;
}

function getGuideModelLinkState() {
  const metadata = getMetadata();
  const selectionsRaw = Array.isArray(metadata?.measurementGuideModelSelections)
    ? metadata.measurementGuideModelSelections
    : [];
  const linksByImageRaw =
    metadata?.measurementGuideModelLinksByImage &&
    typeof metadata.measurementGuideModelLinksByImage === 'object'
      ? metadata.measurementGuideModelLinksByImage
      : {};
  const linksByScopeRaw =
    metadata?.measurementGuideModelLinksByScope &&
    typeof metadata.measurementGuideModelLinksByScope === 'object'
      ? metadata.measurementGuideModelLinksByScope
      : {};

  const selections = selectionsRaw
    .map(item => {
      const code = normalizeCode(item?.code || '');
      const variant = String(item?.variant || 'front')
        .trim()
        .toLowerCase();
      if (!code) return null;
      if (!['front', 'back', 'side'].includes(variant)) return null;
      return {
        id: String(item?.id || buildModelSelectionId(code, variant)),
        code,
        variant,
      };
    })
    .filter(Boolean);

  const linksByImage = {};
  Object.entries(linksByImageRaw).forEach(([imageId, selectionId]) => {
    const key = String(imageId || '').trim();
    const value = String(selectionId || '').trim();
    if (!key || !value) return;
    linksByImage[key] = value;
  });

  const linksByScope = {};
  Object.entries(linksByScopeRaw).forEach(([scopeId, selectionId]) => {
    const key = String(scopeId || '').trim();
    const value = String(selectionId || '').trim();
    if (!key || !value) return;
    linksByScope[key] = value;
  });

  Object.entries(linksByImage).forEach(([imageId, selectionId]) => {
    if (!linksByScope[imageId]) {
      linksByScope[imageId] = selectionId;
    }
  });

  Object.entries(linksByScope).forEach(([scopeId, selectionId]) => {
    if (!scopeId.includes('::tab:') && !linksByImage[scopeId]) {
      linksByImage[scopeId] = selectionId;
    }
  });

  return { selections, linksByImage, linksByScope };
}

function saveGuideModelLinkState(state) {
  const manager = window.app?.projectManager || window.projectManager;
  const linksByScope =
    state?.linksByScope && typeof state.linksByScope === 'object' ? state.linksByScope : {};
  const linksByImage = Object.fromEntries(
    Object.entries(linksByScope).filter(([scopeId]) => !String(scopeId).includes('::tab:'))
  );
  const payload = {
    measurementGuideModelSelections: state.selections,
    measurementGuideModelLinksByImage: linksByImage,
    measurementGuideModelLinksByScope: linksByScope,
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

function upsertModelSelection(code, variant) {
  const normalizedCode = normalizeCode(code);
  const normalizedVariant = String(variant || 'front')
    .trim()
    .toLowerCase();
  if (!normalizedCode || !['front', 'back', 'side'].includes(normalizedVariant)) return null;

  const state = getGuideModelLinkState();
  const existing = state.selections.find(
    item => item.code === normalizedCode && item.variant === normalizedVariant
  );
  if (existing) {
    return existing;
  }

  const next = {
    id: buildModelSelectionId(normalizedCode, normalizedVariant),
    code: normalizedCode,
    variant: normalizedVariant,
  };
  state.selections = [...state.selections, next];
  saveGuideModelLinkState(state);
  return next;
}

function linkSelectionToImage(selectionId, imageId) {
  linkSelectionToScope(selectionId, imageId);
}

function linkSelectionToScope(selectionId, scopeId) {
  const state = getGuideModelLinkState();
  const normalizedSelectionId = String(selectionId || '').trim();
  const normalizedScopeId = String(scopeId || '').trim();
  if (!normalizedSelectionId || !normalizedScopeId) return;

  const linksByScope = { ...state.linksByScope };
  linksByScope[normalizedScopeId] = normalizedSelectionId;
  state.linksByScope = linksByScope;
  state.linksByImage = Object.fromEntries(
    Object.entries(linksByScope).filter(([scopeKey]) => !String(scopeKey).includes('::tab:'))
  );
  saveGuideModelLinkState(state);
}

function removeModelSelection(selectionId) {
  const normalizedSelectionId = String(selectionId || '').trim();
  if (!normalizedSelectionId) return;
  const state = getGuideModelLinkState();
  state.selections = state.selections.filter(item => item.id !== normalizedSelectionId);
  const linksByScope = { ...state.linksByScope };
  Object.keys(linksByScope).forEach(scopeId => {
    if (linksByScope[scopeId] === normalizedSelectionId) {
      delete linksByScope[scopeId];
    }
  });
  state.linksByScope = linksByScope;
  state.linksByImage = Object.fromEntries(
    Object.entries(linksByScope).filter(([scopeId]) => !String(scopeId).includes('::tab:'))
  );
  saveGuideModelLinkState(state);
}

function unlinkImageModel(imageId) {
  unlinkScopeModel(imageId);
}

function unlinkScopeModel(scopeId) {
  const normalizedScopeId = String(scopeId || '').trim();
  if (!normalizedScopeId) return;
  const state = getGuideModelLinkState();
  if (!state.linksByScope[normalizedScopeId]) return;
  const linksByScope = { ...state.linksByScope };
  delete linksByScope[normalizedScopeId];
  state.linksByScope = linksByScope;
  state.linksByImage = Object.fromEntries(
    Object.entries(linksByScope).filter(([scopeId]) => !String(scopeId).includes('::tab:'))
  );
  saveGuideModelLinkState(state);
}

async function applyGuideAsBackground(code, view) {
  const manager = window.app?.projectManager || window.projectManager;
  if (!manager || typeof manager.setBackgroundImage !== 'function') {
    setStatusMessage('Project manager not ready to set background image.', 'warning');
    return;
  }

  const url = await fetchGuideRasterUrl(code, view);
  await manager.setBackgroundImage(url, 'fit-canvas');
  const currentViewId = getCurrentViewId();
  saveGuideCodes([code], currentViewId);
  tagGuideOnView(currentViewId, code, view);
  const selection = upsertModelSelection(code, view);
  if (selection) {
    linkSelectionToImage(selection.id, currentViewId);
  }
  setStatusMessage(`Loaded ${code} ${String(view).toUpperCase()} as background.`, 'success');
}

/**
 * Import measurement lines from SVG guide and convert to OpenPaint vectors
 * @param {string} code - Guide code
 * @param {string} view - View (front/back/side)
 * @param {string} imageLabel - Target image label
 * @returns {Promise<Object>} Import result
 */
async function importSvgMeasurements(code, view, imageLabel, options = {}) {
  try {
    console.log(`[SVG Import] Starting import for ${code}-${view} to image ${imageLabel}`);

    // Check if we're currently viewing the target image
    const currentView = window.app?.projectManager?.currentViewId;
    console.log(`[SVG Import] Current view: ${currentView}, target: ${imageLabel}`);
    // TEMPORARILY DISABLED: View check to test import
    // if (currentView !== imageLabel) {
    //   console.log(`[SVG Import] Skipping - not viewing target image`);
    //   return { success: true, imported: 0, skipped: true };
    // }

    // Fetch raw SVG
    console.log(`[SVG Import] Fetching SVG from ${buildGuideUrl(code, view)}`);
    const svgText =
      typeof options.svgText === 'string' && options.svgText.trim()
        ? options.svgText
        : await (async () => {
            const response = await fetch(buildGuideUrl(code, view), { method: 'GET' });
            if (!response.ok) {
              console.warn(`[SVG Import] Failed to fetch SVG: ${response.status}`);
              return '';
            }
            return response.text();
          })();
    if (!svgText) {
      return { success: false, imported: 0 };
    }
    console.log(`[SVG Import] Fetched SVG, length: ${svgText.length}`);

    const parsed = parseSvgMeasurements(svgText);
    console.log(
      `[SVG Import] Parsed ${parsed.totalMeasurements} measurements:`,
      parsed.measurements.map(m => m.label)
    );

    if (!parsed || !parsed.measurements || parsed.measurements.length === 0) {
      console.log('No measurements found in SVG');
      return { success: true, imported: 0 };
    }

    // Get canvas and image dimensions for coordinate transformation
    const canvas = options.canvasManager?.fabricCanvas || window.app?.canvasManager?.fabricCanvas;
    console.log(`[SVG Import] Canvas available:`, !!canvas);
    if (!canvas) {
      console.warn('[SVG Import] Canvas not available for measurement import');
      return { success: false, imported: 0 };
    }

    const bgImage = canvas.backgroundImage;
    console.log(
      `[SVG Import] Background image:`,
      bgImage ? `${bgImage.width}x${bgImage.height}` : 'null'
    );
    if (!bgImage) {
      console.warn('[SVG Import] Background image not loaded yet for measurement import');
      return { success: false, imported: 0 };
    }

    const canvasSize = {
      width: bgImage.width || canvas.width,
      height: bgImage.height || canvas.height,
    };

    // Create coordinate transformer (pass bgImage for precise alignment)
    const transform = createCoordinateTransformer(parsed.dimensions, canvasSize, bgImage);

    // Import each measurement as a line stroke
    const imported = [];
    const metadataManager = options.metadataManager || window.app?.metadataManager;
    const tagManager = options.tagManager || window.app?.tagManager || null;
    const curveMode = String(options.curveMode || 'straight')
      .trim()
      .toLowerCase();
    const referenceOnly = curveMode === 'reference-path';

    const applyReferenceGuideObjectState = object => {
      if (!object) return;
      object.__guideSplitReferenceOnly = referenceOnly;
      if (!referenceOnly) return;
      object.set?.({
        visible: false,
        selectable: false,
        evented: false,
        hasControls: false,
        hasBorders: false,
        lockMovementX: true,
        lockMovementY: true,
        lockRotation: true,
        hoverCursor: 'default',
        moveCursor: 'default',
      });
    };

    for (const measurement of parsed.measurements) {
      for (const line of measurement.lines) {
        const segmentPoints = Array.isArray(line?.points)
          ? line.points
              .map(point => ({
                x: Number(point?.x),
                y: Number(point?.y),
              }))
              .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))
          : [];
        const shouldImportAsPath =
          curveMode === 'reference-path' && line?.kind === 'curve' && segmentPoints.length >= 2;

        let fabricLine = null;
        if (shouldImportAsPath) {
          const transformedPoints = segmentPoints.map(point => transform(point.x, point.y));
          const pathString = PathUtils.createSmoothPath(transformedPoints);
          if (!pathString) {
            continue;
          }
          fabricLine = new fabric.Path(pathString, {
            stroke: '#ef4444',
            strokeWidth: 2,
            fill: '',
            strokeDashArray: null,
            selectable: !referenceOnly,
            evented: !referenceOnly,
            objectCaching: false,
            hasControls: !referenceOnly,
            hasBorders: false,
            perPixelTargetFind: !referenceOnly,
            padding: referenceOnly ? 0 : 8,
          });
          fabricLine.customPoints = transformedPoints.map(point => ({ x: point.x, y: point.y }));
        } else {
          // Transform coordinates from SVG space to canvas space
          const start = transform(line.x1, line.y1);
          const end = transform(line.x2, line.y2);

          // Create Fabric.js line object
          fabricLine = new fabric.Line([start.x, start.y, end.x, end.y], {
            stroke: '#ef4444', // Red color for guide measurements
            strokeWidth: 2,
            strokeDashArray: null,
            selectable: !referenceOnly,
            evented: !referenceOnly,
            originX: 'center',
            originY: 'center',
          });
        }

        applyReferenceGuideObjectState(fabricLine);

        if (!referenceOnly) {
          fabricLine.arrowSettings = {
            startArrow: true,
            endArrow: true,
            arrowSize: 15,
            arrowStyle: 'triangular',
            arrowSpread: 1,
            ghostBaseline: true,
          };
        }

        // Disable object caching for proper arrow rendering
        fabricLine.objectCaching = false;

        // Apply arrow rendering for editable imports only. Split compare keeps
        // the SVG overlay as the visual source of truth for arrow direction.
        if (!referenceOnly && window.app?.arrowManager) {
          window.app.arrowManager.attachArrowRendering(fabricLine);
          window.app.arrowManager.syncArrowMetadata(fabricLine);
        }

        // Add custom metadata
        fabricLine.customData = {
          type: fabricLine.type === 'path' ? 'curve' : 'line',
          imageLabel,
          strokeLabel: measurement.label,
          source: 'guide-import',
          guideCode: code,
          guideView: view,
          guideReferenceOnly: referenceOnly,
        };

        // Add to canvas
        canvas.add(fabricLine);

        // Register in metadata manager (handles all metadata setup internally)
        if (metadataManager) {
          metadataManager.attachMetadata(fabricLine, imageLabel, measurement.label);
        }

        // Create tag using TagManager with connector color matching the line
        if (tagManager) {
          setTimeout(() => {
            // Set connector to match the line color and use square tags
            tagManager.connectorColor = fabricLine.stroke || '#ef4444';
            tagManager.connectorMatchesLine = true;
            tagManager.tagShape = 'square';

            // Also update paintApp state so button syncs correctly
            if (options.syncUi !== false && window.paintApp?.state) {
              window.paintApp.state.labelShape = 'square';
            }

            // Create the tag with these settings
            tagManager.createTagForStroke(measurement.label, imageLabel, fabricLine);
          }, 50);
        }

        imported.push({
          label: measurement.label,
          line: fabricLine,
        });

        console.log(`Imported measurement ${measurement.label} from guide ${code}`);
      }
    }

    // Render canvas
    canvas.renderAll();

    // Update UI buttons to reflect import settings
    if (options.syncUi !== false) {
      setTimeout(() => {
        // Sync connector tone button
        const connectorToneBtn = document.getElementById('connectorToneBtn');
        if (connectorToneBtn) {
          connectorToneBtn.textContent = 'Connector: Same as Line';
        }

        // Sync label shape button
        const labelShapeBtn = document.getElementById('labelShapeToggleBtn');
        if (labelShapeBtn) {
          labelShapeBtn.textContent = '■';
          labelShapeBtn.setAttribute('aria-pressed', 'true');
        }
      }, 300);
    }

    // Trigger any necessary updates
    if (options.syncUi !== false && typeof window.updateUI === 'function') {
      window.updateUI();
    }

    return {
      success: true,
      imported: imported.length,
      measurements: imported,
    };
  } catch (error) {
    console.error('Failed to import SVG measurements:', error);
    return {
      success: false,
      imported: 0,
      error: error.message,
    };
  }
}

async function addGuideAsNewImage(code, view, options = {}) {
  const manager = window.app?.projectManager || window.projectManager;
  if (!manager || typeof manager.addImage !== 'function') {
    throw new Error('Project manager not ready to add images');
  }

  const shouldImportGuideSvg = options.includeGuideSvgOverlay !== false;
  const imageUrl = await fetchGuideRasterUrl(code, view);
  const label = createGuideViewId(`${code}-${view}`);

  let guideSvgText = '';
  if (shouldImportGuideSvg) {
    try {
      guideSvgText = await fetchGuideSvgText(code, view);
    } catch (error) {
      console.warn('[Guide] Failed to fetch source SVG for overlay import:', error);
    }
  }

  // Always ensure ProjectManager has a concrete view/image first.
  await manager.addImage(label, imageUrl, { refreshBackground: false });

  if (typeof window.addImageToSidebar === 'function') {
    window.addImageToSidebar(imageUrl, label, `${label}.png`);
  }

  if (options.switchToNew === true && typeof manager.switchView === 'function') {
    await manager.switchView(label, true);
  }

  let measurementOverlayManager = window.app?.measurementOverlayManager || null;
  if (!measurementOverlayManager?.importSvg && window.app?.initDeferredManagers) {
    try {
      await window.app.initDeferredManagers();
      measurementOverlayManager = window.app?.measurementOverlayManager || null;
    } catch (error) {
      console.warn('[Guide] Deferred manager init failed before SVG overlay import:', error);
    }
  }

  if (guideSvgText && measurementOverlayManager?.importSvg) {
    const activeBeforeImport = String(manager.currentViewId || getCurrentViewId() || '').trim();
    const shouldReturnToPrevious = options.switchToNew !== true;
    try {
      if (typeof manager.switchView === 'function' && activeBeforeImport !== label) {
        await manager.switchView(label, true);
      }
      await measurementOverlayManager.importSvg(guideSvgText, label);
    } catch (error) {
      console.warn('[Guide] Failed to import guide SVG overlay:', error);
    } finally {
      if (
        shouldReturnToPrevious &&
        typeof manager.switchView === 'function' &&
        activeBeforeImport &&
        activeBeforeImport !== label
      ) {
        try {
          await manager.switchView(activeBeforeImport, true);
        } catch {
          // no-op
        }
      }
    }
  }
  saveGuideCodes([code], label);
  tagGuideOnView(label, code, view);
  const selection = upsertModelSelection(code, view);
  if (selection) {
    linkSelectionToImage(selection.id, label);
  }

  // Switch view if requested
  if (options.switchToNew === true && typeof manager.switchView === 'function') {
    await manager.switchView(label, true);
  }

  if (options.importMeasurements !== false) {
    const activeBeforeImport = String(manager.currentViewId || getCurrentViewId() || '').trim();
    const shouldReturnToPrevious = options.switchToNew !== true;
    try {
      if (typeof manager.switchView === 'function' && activeBeforeImport !== label) {
        await manager.switchView(label, true);
      }
      await waitForGuideImportReady(label);
      const importResult = await importSvgMeasurements(code, view, label);
      console.log(`[addGuideAsNewImage] Import result:`, importResult);
      if (options.skipStatusMessage !== true && importResult.success && importResult.imported > 0) {
        setStatusMessage(`Added guide with ${importResult.imported} measurements`, 'success');
      } else if (options.skipStatusMessage !== true && !importResult.success) {
        console.warn(`[addGuideAsNewImage] Import failed:`, importResult.error);
      }
    } catch (error) {
      console.error('[addGuideAsNewImage] Exception during import:', error);
    } finally {
      if (
        shouldReturnToPrevious &&
        typeof manager.switchView === 'function' &&
        activeBeforeImport &&
        activeBeforeImport !== label
      ) {
        try {
          await manager.switchView(activeBeforeImport, true);
        } catch {
          // no-op
        }
      }
    }
  } else {
    console.log(`[addGuideAsNewImage] Measurement import disabled by options`);
  }

  return label;
}

function resolveScopeId(viewId, bindingTarget = 'frame') {
  if (bindingTarget === 'project') return '__project__';
  if (bindingTarget === 'view') return toBaseViewId(viewId);
  // frame scope — use explicit tab id
  const frameScopeId = getFrameScopeIdForView(viewId);
  return frameScopeId || String(viewId || '').trim() || 'front';
}

function saveGuideSettings({
  viewId,
  codes,
  lockToImage,
  bindingTarget = 'frame',
  variant = 'front',
}) {
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
    const frameKey = getFrameScopeIdForView(viewId) || fallbackView;
    nextCodesByView[frameKey] = [...normalizedCodes];
    nextLockByView[frameKey] = lockToImage === true;
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
      activeVariant: String(variant || 'front').toLowerCase(),
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

function saveGuideCodes(codes, viewId = getCurrentViewId(), variant = 'front') {
  saveGuideSettings({ viewId, codes, lockToImage: isGuideLockedToView(viewId), variant });
}

function setGuideLockForView(viewId, lockToImage) {
  const context = resolveGuideContext(viewId);
  const codes = context.codes || [];
  if (!codes.length) return;
  saveGuideSettings({ viewId, codes, lockToImage });
}

function resolveSlides(codes) {
  const slides = [];
  codes.forEach(code => {
    VIEWS.forEach(view => {
      slides.push({ code, view });
    });
  });
  return slides;
}

function normalizeGuideVariant(value, fallback = 'front') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return VIEWS.includes(normalized) ? normalized : fallback;
}

function resolveActiveGuideForView(viewId = getCurrentViewId()) {
  const modelBinding = resolveModelBindingForView(viewId);
  const boundCode = normalizeCode(modelBinding?.selection?.code || '');
  const boundVariant = normalizeGuideVariant(modelBinding?.selection?.variant, 'front');
  if (boundCode) {
    return {
      code: boundCode,
      variant: boundVariant,
      bound: true,
      selectionId: modelBinding.selectionId || '',
      scopeType: modelBinding.scopeType || 'none',
      scopeId: modelBinding.scopeId || '',
    };
  }

  const guideBinding = getGuideBinding(viewId);
  const fallbackCode = normalizeCode(guideBinding.activeCode || guideBinding.codes[0] || '');
  const fallbackVariant = normalizeGuideVariant(guideBinding.activeVariant, 'front');
  return {
    code: fallbackCode,
    variant: fallbackVariant,
    bound: false,
    selectionId: '',
    scopeType: guideBinding.scopeType || 'default',
    scopeId: guideBinding.scopeId || '',
  };
}

function resolveFlashSlidesForImage(viewId = getCurrentViewId()) {
  const activeGuide = resolveActiveGuideForView(viewId);
  if (!activeGuide.code) {
    const context = resolveGuideContext(viewId);
    const fallbackCode = normalizeCode(context.codes[0] || '');
    if (!fallbackCode) {
      return {
        slides: [],
        preferredIndex: 0,
        activeGuide,
      };
    }
    activeGuide.code = fallbackCode;
  }

  const slides = VIEWS.map(view => ({ code: activeGuide.code, view }));
  const preferredIndex = Math.max(
    0,
    slides.findIndex(item => item.view === normalizeGuideVariant(activeGuide.variant, 'front'))
  );
  return {
    slides,
    preferredIndex,
    activeGuide,
  };
}

function ensureOverlay(slide, slideCount) {
  ensureStyles();
  if (!flashOverlay) {
    flashOverlay = document.createElement('section');
    flashOverlay.className = 'guide-flash-overlay';
    document.body.appendChild(flashOverlay);
    flashOverlay.innerHTML = `
      <div class="guide-flash-head">
        <div class="guide-flash-title">Guide Compare</div>
        <label class="guide-flash-lock" id="guideFlashLockWrap">
          <input id="guideFlashLockToggle" type="checkbox" />
          <span id="guideFlashLockText">Lock to image</span>
        </label>
        <div class="guide-flash-sub" id="guideFlashSub"></div>
        <div class="guide-flash-controls">
          <button type="button" class="guide-flash-ctl" data-flash-size-dec aria-label="Smaller guide">-</button>
          <button type="button" class="guide-flash-ctl" data-flash-size-med aria-label="Medium guide">M</button>
          <button type="button" class="guide-flash-ctl" data-flash-size-inc aria-label="Larger guide">+</button>
          <button type="button" class="guide-flash-ctl" data-flash-size-fit aria-label="Fit guide">Fit</button>
          <button type="button" class="guide-flash-ctl" data-flash-edit aria-label="Open split guide editor">Edit</button>
          <button type="button" class="guide-flash-ctl" data-flash-bind aria-label="Guide binding">Bind</button>
        </div>
        <button type="button" class="guide-flash-close" aria-label="Close guide flash">×</button>
      </div>
      <div class="guide-flash-compare">
        <article class="guide-flash-pane">
          <div class="guide-flash-pane-head">
            <span>Project Image</span>
            <span id="guideFlashProjectLabel">-</span>
          </div>
          <div class="guide-flash-pane-body">
            <img id="guideFlashProjectImage" alt="Project image preview" />
          </div>
        </article>
        <article class="guide-flash-pane">
          <div class="guide-flash-pane-head">
            <span>Guide Model</span>
            <div style="display:inline-flex;align-items:center;gap:6px;">
              <button type="button" class="guide-flash-nav prev" aria-label="Previous guide">&#8249;</button>
              <span id="guideFlashGuideLabel">-</span>
              <button type="button" class="guide-flash-nav next" aria-label="Next guide">&#8250;</button>
            </div>
          </div>
          <div class="guide-flash-pane-body">
            <img id="guideFlashGuideImage" alt="Guide model preview" />
          </div>
        </article>
      </div>
      <div class="guide-flash-strip-wrap">
        <section class="guide-flash-strip-card">
          <div class="guide-flash-strip-title">Project Images</div>
          <div class="guide-flash-strip" id="guideFlashImageStrip"></div>
        </section>
        <section class="guide-flash-strip-card">
          <div class="guide-flash-strip-title">Guide Variants</div>
          <div class="guide-flash-strip" id="guideFlashModelStrip"></div>
        </section>
      </div>
      <div class="guide-flash-resize" aria-hidden="true"></div>
    `;
    bindFlashWindowControls(flashOverlay);
  }

  const sourceViewId = pinnedSourceViewId || getCurrentViewId();
  const isLocked = pinnedLockToImage === true;
  const hint = `${activeIndex + 1}/${slideCount} · \\ split · Alt+\\ gallery · Shift+\\ next guide`;
  const bindingTargetViewId = flashComparisonImageId || sourceViewId;
  const bindingText = getBindingBreadcrumb(bindingTargetViewId);

  const lockText = flashOverlay.querySelector('#guideFlashLockText');
  if (lockText) {
    lockText.textContent = `Lock to image (${sourceViewId})`;
    lockText.parentElement?.setAttribute(
      'title',
      `Lock this guide selection to image ${sourceViewId}`
    );
  }
  const lockToggle = flashOverlay.querySelector('#guideFlashLockToggle');
  if (lockToggle) {
    lockToggle.checked = isLocked;
  }

  const subEl = flashOverlay.querySelector('#guideFlashSub');
  if (subEl) {
    subEl.textContent = `${bindingText} · ${hint}`;
  }

  const guideLabelEl = flashOverlay.querySelector('#guideFlashGuideLabel');
  if (guideLabelEl) {
    guideLabelEl.textContent = `${slide.code} · ${String(slide.view).toUpperCase()}`;
  }

  const guideImageEl = flashOverlay.querySelector('#guideFlashGuideImage');
  if (guideImageEl) {
    const url = buildGuidePreviewUrl(slide.code, slide.view);
    guideImageEl.src = url;
    guideImageEl.dataset.guideCode = slide.code;
    guideImageEl.dataset.guideView = slide.view;
  }

  const projectImages = getProjectImageRows();
  if (!projectImages.some(image => image.id === flashComparisonImageId)) {
    flashComparisonImageId =
      projectImages.find(image => image.id === sourceViewId)?.id || projectImages[0]?.id || '';
  }
  const activeImage = projectImages.find(image => image.id === flashComparisonImageId) || null;
  const projectLabelEl = flashOverlay.querySelector('#guideFlashProjectLabel');
  if (projectLabelEl) {
    projectLabelEl.textContent = activeImage?.displayName || 'No image selected';
  }
  const projectImageEl = flashOverlay.querySelector('#guideFlashProjectImage');
  if (projectImageEl) {
    projectImageEl.src = activeImage?.imageUrl || '';
    const previewViewId = activeImage?.id || sourceViewId;
    projectImageEl.dataset.previewViewId = previewViewId;
    requestAnimationFrame(() => {
      applyImagePreviewViewport(projectImageEl, previewViewId);
    });
  }

  const imageStrip = flashOverlay.querySelector('#guideFlashImageStrip');
  if (imageStrip) {
    imageStrip.innerHTML = projectImages.length
      ? projectImages
          .map(
            image =>
              `<button type="button" class="guide-flash-strip-item ${image.id === flashComparisonImageId ? 'active' : ''}" data-flash-image-id="${image.id}">${image.imageUrl ? `<img src="${image.imageUrl}" alt="${image.displayName}" />` : '<span></span>'}<span>${image.displayName}</span></button>`
          )
          .join('')
      : '<div class="guide-flash-empty">No project images available.</div>';
  }

  const modelStrip = flashOverlay.querySelector('#guideFlashModelStrip');
  if (modelStrip) {
    modelStrip.innerHTML = flashSlides
      .map((item, index) => {
        const label = `${item.code} · ${String(item.view).toUpperCase()}`;
        return `<button type="button" class="guide-flash-strip-item ${index === activeIndex ? 'active' : ''}" data-flash-slide-index="${index}"><img src="${buildGuidePreviewUrl(item.code, item.view)}" alt="${label}" /><span>${label}</span></button>`;
      })
      .join('');
  }

  attachGuideImageRecovery(flashOverlay);
  applyFlashWindowLayout(flashOverlay);
}

function bindFlashWindowControls(root) {
  if (!root) return;

  const dec = root.querySelector('[data-flash-size-dec]');
  const med = root.querySelector('[data-flash-size-med]');
  const inc = root.querySelector('[data-flash-size-inc]');
  const fit = root.querySelector('[data-flash-size-fit]');
  const edit = root.querySelector('[data-flash-edit]');
  const bind = root.querySelector('[data-flash-bind]');
  const close = root.querySelector('.guide-flash-close');
  const lockToggle = root.querySelector('#guideFlashLockToggle');
  const prev = root.querySelector('.guide-flash-nav.prev');
  const next = root.querySelector('.guide-flash-nav.next');
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
  edit?.addEventListener('click', e => {
    e.preventDefault();
    setGuideSplitEnabled(true);
    syncGuideSplitToActiveView();
    hideGuideFlash();
    isGuidePinnedVisible = false;
  });
  bind?.addEventListener('click', e => {
    e.preventDefault();
    openGuideBindingPanel({
      viewId: flashComparisonImageId || pinnedSourceViewId || getCurrentViewId(),
      source: 'flash',
    });
  });
  close?.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    isGuidePinnedVisible = false;
    hideGuideFlash();
  });
  lockToggle?.addEventListener('change', e => {
    const checked = e.target?.checked === true;
    pinnedLockToImage = checked;
    const targetViewId = flashComparisonImageId || flashSourceViewId;
    if (targetViewId) {
      setGuideLockForView(targetViewId, checked);
    }
  });
  prev?.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    showGuideFlash({ cycleDelta: -1, holdMode: isGuidePinnedVisible, preservePinnedContext: true });
  });
  next?.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    showGuideFlash({ cycleDelta: 1, holdMode: isGuidePinnedVisible, preservePinnedContext: true });
  });

  root.onclick = event => {
    const imageBtn = event.target?.closest?.('[data-flash-image-id]');
    if (imageBtn) {
      const strip = imageBtn.closest('.guide-flash-strip');
      const scrollTop = strip?.scrollTop || 0;
      const scrollLeft = strip?.scrollLeft || 0;
      const imageId = String(imageBtn.getAttribute('data-flash-image-id') || '').trim();
      if (imageId) {
        flashComparisonImageId = imageId;
        const next = resolveFlashSlidesForImage(imageId);
        if (next.slides.length) {
          flashSlides = next.slides;
          activeIndex = next.preferredIndex;
        }
        ensureOverlay(flashSlides[activeIndex], flashSlides.length || 1);
        requestAnimationFrame(() => {
          if (strip) {
            strip.scrollTop = scrollTop;
            strip.scrollLeft = scrollLeft;
          }
        });
      }
      return;
    }

    const slideBtn = event.target?.closest?.('[data-flash-slide-index]');
    if (slideBtn) {
      const strip = slideBtn.closest('.guide-flash-strip');
      const scrollTop = strip?.scrollTop || 0;
      const scrollLeft = strip?.scrollLeft || 0;
      const index = Number(slideBtn.getAttribute('data-flash-slide-index'));
      if (Number.isFinite(index) && index >= 0 && index < flashSlides.length) {
        activeIndex = index;
        ensureOverlay(flashSlides[activeIndex], flashSlides.length || 1);
        requestAnimationFrame(() => {
          if (strip) {
            strip.scrollTop = scrollTop;
            strip.scrollLeft = scrollLeft;
          }
        });
      }
    }
  };

  root.onmousedown = event => {
    const stripButton = event.target?.closest?.('[data-flash-image-id], [data-flash-slide-index]');
    if (stripButton) {
      event.preventDefault();
    }
  };

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
  const bindingViewId =
    preservePinnedContext && pinnedSourceViewId ? pinnedSourceViewId : currentViewId;

  if (!preservePinnedContext) {
    pinnedSourceViewId = currentViewId;
    pinnedLockToImage = isGuideLockedToView(currentViewId);
  }

  if (!pinnedSourceViewId) {
    pinnedSourceViewId = currentViewId;
  }

  if (pinnedLockToImage && currentViewId !== pinnedSourceViewId) {
    hideGuideFlash();
    isGuidePinnedVisible = false;
    return;
  }

  if (!preservePinnedContext) {
    flashComparisonImageId = currentViewId;
  }

  const targetImageId = flashComparisonImageId || bindingViewId;
  const resolved = resolveFlashSlidesForImage(targetImageId);
  let slides = resolved.slides;

  if (!slides.length) {
    const codes = resolveGuideContext(currentViewId).codes;
    if (!codes.length) {
      const promptedCodes = promptForCodes();
      if (!promptedCodes.length) return;
      slides = resolveSlides([promptedCodes[0]]);
    } else {
      slides = resolveSlides([codes[0]]);
    }
  }

  if (!slides.length) return;
  flashSlides = slides;
  flashSourceViewId = pinnedSourceViewId || currentViewId;

  const delta = cycleDelta || (cycleNext ? 1 : 0);
  if (delta !== 0) {
    activeIndex = (activeIndex + delta + slides.length) % slides.length;
  } else if (activeIndex >= slides.length) {
    activeIndex = 0;
  }

  if (delta === 0) {
    const preferredView = normalizeGuideVariant(resolved.activeGuide?.variant, 'front');
    const preferredIndex = slides.findIndex(item => item.view === preferredView);
    if (preferredIndex >= 0) {
      activeIndex = preferredIndex;
    }
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

function getProjectImageRows() {
  const manager = window.app?.projectManager || window.projectManager;
  const views = manager?.views && typeof manager.views === 'object' ? manager.views : {};
  const metadata = getMetadata();
  const labelMap =
    metadata?.imagePartLabels && typeof metadata.imagePartLabels === 'object'
      ? metadata.imagePartLabels
      : {};
  return Object.entries(views)
    .filter(([, entry]) => Boolean(entry?.image))
    .map(([id, entry], index) => {
      const customLabel = String(labelMap[id] || '').trim();
      const displayName = customLabel || `Image ${index + 1}`;
      return {
        id,
        displayName,
        imageUrl: entry?.image || '',
      };
    });
}

function getViewportForImagePreview(viewId) {
  const baseViewId = toBaseViewId(viewId);
  if (!baseViewId) return null;

  const tabsState =
    window.captureTabsByLabel && typeof window.captureTabsByLabel === 'object'
      ? window.captureTabsByLabel[baseViewId]
      : null;
  if (tabsState && typeof tabsState === 'object') {
    const activeTabId = getActiveTabIdForView(baseViewId);
    if (activeTabId && Array.isArray(tabsState.tabs)) {
      const activeTab = tabsState.tabs.find(tab => String(tab?.id || '').trim() === activeTabId);
      if (activeTab?.viewport && typeof activeTab.viewport === 'object') {
        return activeTab.viewport;
      }
    }
  }

  const manager = window.app?.projectManager || window.projectManager;
  const viewEntry =
    manager?.views && typeof manager.views === 'object' ? manager.views[baseViewId] : null;
  if (viewEntry?.viewport && typeof viewEntry.viewport === 'object') {
    return viewEntry.viewport;
  }

  if ((manager?.currentViewId || '') === baseViewId) {
    const canvasViewport = window.app?.canvasManager?.getViewportState?.();
    if (canvasViewport && typeof canvasViewport === 'object') {
      return canvasViewport;
    }
  }

  return null;
}

function applyImagePreviewViewport(imgEl, viewId) {
  if (!imgEl) return;
  const viewport = getViewportForImagePreview(viewId);
  const zoom = Number(viewport?.zoom);
  const panX = Number(viewport?.panX);
  const panY = Number(viewport?.panY);
  const rotation = Number(viewport?.rotation);
  const hasViewport = Number.isFinite(zoom) && zoom > 0;

  if (!hasViewport) {
    imgEl.style.transformOrigin = '';
    imgEl.style.transform = '';
    return;
  }

  const canvas = window.app?.canvasManager?.fabricCanvas;
  const canvasWidth = Number(canvas?.width) || 0;
  const canvasHeight = Number(canvas?.height) || 0;
  const paneRect = imgEl.parentElement?.getBoundingClientRect?.();
  const paneWidth = Number(paneRect?.width) || 0;
  const paneHeight = Number(paneRect?.height) || 0;

  const scaleX = canvasWidth > 0 && paneWidth > 0 ? paneWidth / canvasWidth : 1;
  const scaleY = canvasHeight > 0 && paneHeight > 0 ? paneHeight / canvasHeight : 1;
  const mappedPanX = Number.isFinite(panX) ? panX * scaleX : 0;
  const mappedPanY = Number.isFinite(panY) ? panY * scaleY : 0;
  const mappedRotation = Number.isFinite(rotation) ? rotation : 0;

  imgEl.style.transformOrigin = 'center center';
  imgEl.style.transform = `translate(${mappedPanX}px, ${mappedPanY}px) scale(${zoom}) rotate(${mappedRotation}deg)`;
}

function getGuideSplitStateForView(viewId = getCurrentViewId()) {
  const binding = resolveModelBindingForView(viewId);
  return {
    enabled: guideSplitEnabled,
    viewId: toBaseViewId(viewId),
    leftViewId: toBaseViewId(guideCompareWorkspaceState.leftViewId || getCurrentViewId()),
    rightViewId: toBaseViewId(guideCompareWorkspaceState.rightViewId || ''),
    activePane: guideCompareWorkspaceState.activePane,
    rightSourceKind: guideCompareWorkspaceState.rightSourceKind,
    frameScopeId: binding.frameScopeId,
    imageScopeId: binding.imageScopeId,
    scopeType: binding.scopeType,
    scopeId: binding.scopeId,
    selectionId: binding.selectionId,
    selection: binding.selection,
    bound: Boolean(binding.selection),
  };
}

function ensureGuideSplitShell() {
  const wrapper = document.getElementById('main-canvas-wrapper');
  if (!wrapper) return null;
  let root = wrapper.querySelector('#guideSplitRoot');
  if (!root) {
    root = document.createElement('div');
    root.id = 'guideSplitRoot';
    root.className = 'guide-split-root';
    const live = document.createElement('section');
    live.id = 'guideSplitLivePane';
    live.className = 'guide-split-live-pane guide-split-pane';
    live.setAttribute('data-pane', 'left');
    live.tabIndex = 0;
    live.innerHTML = `
      <div id="guideSplitLiveCanvasHost" class="guide-split-pane-canvas-host"></div>
    `;
    const guide = document.createElement('section');
    guide.id = 'guideSplitGuidePane';
    guide.className = 'guide-split-guide-pane guide-split-pane';
    guide.setAttribute('data-pane', 'right');
    guide.tabIndex = 0;
    root.appendChild(live);
    root.appendChild(guide);
    wrapper.appendChild(root);
  }
  const livePane = root.querySelector('#guideSplitLivePane');
  if (livePane) {
    livePane.classList.toggle('is-transitioning', guideSplitTransitionPending === true);
  }
  return root;
}

function getPrimaryCanvasManager() {
  return window.app?.primaryCanvasManager || window.app?.canvasManager || null;
}

function getCanvasWrapperElement(canvasManager = getPrimaryCanvasManager()) {
  return canvasManager?.fabricCanvas?.wrapperEl || null;
}

function setGuideSplitTransitionPending(pending) {
  guideSplitTransitionPending = pending === true;
  const livePane = document.getElementById('guideSplitLivePane');
  if (livePane) {
    livePane.classList.toggle('is-transitioning', guideSplitTransitionPending);
  }
}

function relocateCaptureOverlayIntoSplitPane() {
  const overlay = document.getElementById('captureOverlay');
  const livePane = document.getElementById('guideSplitLivePane');
  if (!overlay || !livePane) return;

  if (!guideSplitCaptureOverlayOriginalParent) {
    guideSplitCaptureOverlayOriginalParent = overlay.parentElement;
    guideSplitCaptureOverlayOriginalNextSibling = overlay.nextSibling;
  }

  if (overlay.parentElement !== livePane) {
    livePane.appendChild(overlay);
  }
  overlay.style.position = 'absolute';
  overlay.style.inset = '0';
  overlay.style.width = '100%';
  overlay.style.height = '100%';
}

function restoreCaptureOverlayFromSplitPane() {
  const overlay = document.getElementById('captureOverlay');
  if (!overlay || !guideSplitCaptureOverlayOriginalParent) return;

  if (guideSplitCaptureOverlayOriginalNextSibling) {
    guideSplitCaptureOverlayOriginalParent.insertBefore(
      overlay,
      guideSplitCaptureOverlayOriginalNextSibling
    );
  } else {
    guideSplitCaptureOverlayOriginalParent.appendChild(overlay);
  }

  overlay.style.position = '';
  overlay.style.inset = '';
  overlay.style.width = '';
  overlay.style.height = '';
}

function ensureGuideSplitFrameGhost() {
  const overlay = document.getElementById('captureOverlay');
  if (!overlay) return null;
  if (guideSplitFrameGhost && guideSplitFrameGhost.isConnected) {
    return guideSplitFrameGhost;
  }
  let ghost = overlay.querySelector('#guideSplitFrameGhost');
  if (!ghost) {
    ghost = document.createElement('div');
    ghost.id = 'guideSplitFrameGhost';
    ghost.className = 'guide-split-frame-ghost';
    overlay.appendChild(ghost);
  }
  guideSplitFrameGhost = ghost;
  return guideSplitFrameGhost;
}

function syncGuideSplitFrameGhost() {
  const ghost = ensureGuideSplitFrameGhost();
  const frame = document.getElementById('captureFrame');
  const overlay = document.getElementById('captureOverlay');
  if (!ghost || !frame || !overlay) return;
  const frameRect = frame.getBoundingClientRect();
  const overlayRect = overlay.getBoundingClientRect();
  ghost.style.left = `${Math.round(frameRect.left - overlayRect.left)}px`;
  ghost.style.top = `${Math.round(frameRect.top - overlayRect.top)}px`;
  ghost.style.width = `${Math.round(frameRect.width)}px`;
  ghost.style.height = `${Math.round(frameRect.height)}px`;
  ghost.style.borderColor = frame.style.borderColor || '#22c55e';
  ghost.style.display = 'block';
}

function removeGuideSplitFrameGhost() {
  if (guideSplitFrameGhost?.parentElement) {
    guideSplitFrameGhost.parentElement.removeChild(guideSplitFrameGhost);
  }
  guideSplitFrameGhost = null;
}

function refreshGuideSplitInteractionGuards() {
  const primaryCanvasManager = getPrimaryCanvasManager();
  primaryCanvasManager?.setInteractionGuard?.(() => true);
  guideSplitCompareCanvasManager?.setInteractionGuard?.(() => true);
}

function findExistingGuideImageViewId(code, variant) {
  const manager = window.app?.projectManager || window.projectManager;
  const meta = manager?.getProjectMetadata?.() || {};
  const labels =
    meta?.measurementGuideLabelsByImage && typeof meta.measurementGuideLabelsByImage === 'object'
      ? meta.measurementGuideLabelsByImage
      : {};
  const target = `${normalizeCode(code)} ${String(variant || 'front').toUpperCase()}`;
  return (
    Object.entries(labels).find(([viewId, label]) => {
      if (!manager?.views?.[viewId]?.image) return false;
      return (
        String(label || '')
          .trim()
          .toUpperCase() === target.toUpperCase()
      );
    })?.[0] || ''
  );
}

async function ensureGuideImageViewForSelection(selection) {
  if (!selection?.code) return '';
  const normalizedCode = normalizeCode(selection.code);
  const normalizedVariant = String(selection.variant || 'front').toLowerCase();
  const cacheKey = `${normalizedCode}::${normalizedVariant}`;
  const existingViewId = findExistingGuideImageViewId(normalizedCode, normalizedVariant);
  if (existingViewId) return existingViewId;

  const pending = guideSplitPendingGuideViews.get(cacheKey);
  if (pending) {
    return pending;
  }

  const createPromise = (async () => {
    guideSplitSuppressViewSwitchSync += 1;
    try {
      const viewId = await addGuideAsNewImage(normalizedCode, normalizedVariant, {
        switchToNew: false,
        includeGuideSvgOverlay: false,
        importMeasurements: false,
      });
      return viewId || findExistingGuideImageViewId(normalizedCode, normalizedVariant) || '';
    } finally {
      guideSplitSuppressViewSwitchSync = Math.max(0, guideSplitSuppressViewSwitchSync - 1);
      guideSplitPendingGuideViews.delete(cacheKey);
    }
  })();

  guideSplitPendingGuideViews.set(cacheKey, createPromise);
  return createPromise;
}

function getGuideSplitImageOptions() {
  const leftViewId = toBaseViewId(guideCompareWorkspaceState.leftViewId || getCurrentViewId());
  const rows = getProjectImageRows();
  return rows
    .filter(row => row.id !== leftViewId)
    .map(row => ({
      id: row.id,
      displayName: row.displayName,
    }));
}

function getGuideSplitActiveViewIdForPane(pane) {
  if (pane === 'right') {
    return toBaseViewId(guideCompareWorkspaceState.rightViewId || '');
  }
  return toBaseViewId(guideCompareWorkspaceState.leftViewId || getCurrentViewId());
}

function buildGuideSplitTempViewId(selection) {
  const code = normalizeCode(selection?.code || '');
  const variant = String(selection?.variant || 'front')
    .trim()
    .toLowerCase();
  if (!code) return '';
  return `${GUIDE_SPLIT_TEMP_PREFIX}${code}:${variant}`;
}

function isGuideSplitTempViewId(viewId) {
  return String(viewId || '').startsWith(GUIDE_SPLIT_TEMP_PREFIX);
}

function parseGuideSplitTempViewId(viewId) {
  const raw = String(viewId || '').trim();
  if (!raw.startsWith(GUIDE_SPLIT_TEMP_PREFIX)) return null;
  const payload = raw.slice(GUIDE_SPLIT_TEMP_PREFIX.length);
  const [code = '', variant = 'front'] = payload.split(':');
  const normalizedCode = normalizeCode(code);
  if (!normalizedCode) return null;
  return {
    code: normalizedCode,
    variant:
      String(variant || 'front')
        .trim()
        .toLowerCase() || 'front',
  };
}

function setGuideSplitReferenceObjectState(object, visible = true) {
  if (!object) return;
  object.__guideSplitReferenceOnly = true;
  object.set?.({
    visible,
    evented: false,
    selectable: false,
    hasControls: false,
    hasBorders: false,
    lockMovementX: true,
    lockMovementY: true,
    lockRotation: true,
    hoverCursor: 'default',
    moveCursor: 'default',
  });
  object.setCoords?.();
}

function setGuideSplitReferenceTagState(tagManager, strokeLabel, imageLabel, visible = true) {
  if (!tagManager?.getTagObject) return;
  const found = tagManager.getTagObject(strokeLabel, imageLabel);
  if (!found?.tagObj) return;

  const tagObj = found.tagObj;
  tagObj.__guideSplitReferenceOnly = true;
  tagObj.set({
    visible,
    evented: false,
    selectable: false,
    hasControls: false,
    hasBorders: false,
    lockMovementX: true,
    lockMovementY: true,
    lockRotation: true,
    hoverCursor: 'default',
    moveCursor: 'default',
  });
  tagObj._objects?.forEach(child => {
    child.set?.({
      evented: false,
      selectable: false,
    });
  });

  if (tagObj.connectorLine) {
    setGuideSplitReferenceObjectState(tagObj.connectorLine, visible);
  }

  tagObj.setCoords?.();
}

function applyGuideSplitTagHighlightVisual(tagObj, highlighted = false) {
  if (!tagObj) return;
  const tagManager = guideSplitCompareTagManager || window.app?.tagManager || null;
  const highlightTheme = tagManager?.getDefaultHighlightTheme?.() || {
    background: '#fef3c7',
    border: '#f59e0b',
    text: '#92400e',
  };
  const defaultTheme = tagManager?.getDefaultTagTheme?.() || {
    background: '#ffffff',
    border: '#000000',
    text: '#000000',
  };
  const theme = highlighted ? highlightTheme : defaultTheme;
  const children = Array.isArray(tagObj._objects) ? tagObj._objects : [];
  const background =
    children.find(child => String(child?.type || '').toLowerCase() === 'rect') || children[0];
  const text = children.find(child => /text/i.test(String(child?.type || ''))) || children[1];

  background?.set?.({
    fill: theme.background,
    stroke: theme.border,
  });
  text?.set?.({
    fill: theme.text,
  });
  tagObj.__guideSplitHighlighted = highlighted === true;
  tagObj.dirty = true;
  tagObj.setCoords?.();
}

function resolveGuideSplitScopeIds(scopeId) {
  const normalizedScopeId = String(scopeId || '').trim();
  if (!normalizedScopeId) return [];
  const metadataManager = window.app?.metadataManager || null;
  const vectorMap = metadataManager?.vectorStrokesByImage || {};
  const scopedMatches = Object.keys(vectorMap).filter(
    key => key === normalizedScopeId || key.startsWith(`${normalizedScopeId}::tab:`)
  );
  return scopedMatches.length ? scopedMatches : [normalizedScopeId];
}

function hasGuideSplitTempScopeData(scopeId) {
  const scopeIds = resolveGuideSplitScopeIds(scopeId);
  const metadataManager = window.app?.metadataManager || null;
  return scopeIds.some(candidateScopeId => {
    const scopedVectors = metadataManager?.vectorStrokesByImage?.[candidateScopeId];
    return Boolean(
      scopedVectors && typeof scopedVectors === 'object' && Object.keys(scopedVectors).length > 0
    );
  });
}

function isGuideSplitCompareCanvasReadyForTempView(viewId) {
  const parsedGuide = parseGuideSplitTempViewId(viewId);
  if (!parsedGuide) return false;
  const tempScopeId = buildGuideSplitTempViewId(parsedGuide);
  const compareCanvas = guideSplitCompareCanvasManager?.fabricCanvas || null;
  return Boolean(
    compareCanvas?.backgroundImage &&
    guideSplitActiveTempScopeId === tempScopeId &&
    hasGuideSplitTempScopeData(tempScopeId)
  );
}

function loadFabricImage(url) {
  return new Promise((resolve, reject) => {
    fabric.Image.fromURL(
      url,
      image => {
        if (image) {
          resolve(image);
        } else {
          reject(new Error('Failed to create Fabric image'));
        }
      },
      {
        crossOrigin: 'anonymous',
      }
    );
  });
}

function removeGuideSplitHighlightOverlay(
  compareCanvas = guideSplitCompareCanvasManager?.fabricCanvas,
  options = {}
) {
  if (compareCanvas && guideSplitHighlightOverlayObject) {
    compareCanvas.remove(guideSplitHighlightOverlayObject);
  }
  guideSplitHighlightOverlayObject = null;
  guideSplitHighlightOverlayKey = '';
  if (options.resetRole !== false) {
    guideSplitActiveHighlightRoleCanonical = '';
  }
}

function resetGuideSplitCompareBackgroundVisualKey() {
  guideSplitCompareBackgroundVisualKey = '';
}

async function replaceGuideSplitCompareBackgroundImage(imageUrl, compareCanvas) {
  if (!imageUrl || !compareCanvas) return false;
  const currentBackground = compareCanvas.backgroundImage || null;
  const nextBackground = await loadFabricImage(imageUrl);

  nextBackground.set({
    originX: currentBackground?.originX || 'center',
    originY: currentBackground?.originY || 'center',
    left: currentBackground?.left ?? nextBackground.left,
    top: currentBackground?.top ?? nextBackground.top,
    angle: currentBackground?.angle || 0,
    scaleX: currentBackground?.scaleX || 1,
    scaleY: currentBackground?.scaleY || 1,
    selectable: false,
    evented: false,
    excludeFromExport: true,
  });
  nextBackground.openpaintFitMode = currentBackground?.openpaintFitMode || 'fit-canvas';
  nextBackground.setCoords?.();

  await new Promise(resolve => {
    compareCanvas.setBackgroundImage(nextBackground, () => {
      compareCanvas.requestRenderAll?.();
      resolve();
    });
  });
  return true;
}

function syncGuideSplitHighlightOverlayToBackground(
  compareCanvas = guideSplitCompareCanvasManager?.fabricCanvas
) {
  const overlay = guideSplitHighlightOverlayObject;
  const background = compareCanvas?.backgroundImage;
  if (!overlay || !background) return;
  overlay.set({
    originX: background.originX || 'center',
    originY: background.originY || 'center',
    left: background.left,
    top: background.top,
    angle: background.angle || 0,
    scaleX: background.scaleX || 1,
    scaleY: background.scaleY || 1,
    opacity: 1,
    selectable: false,
    evented: false,
    excludeFromExport: true,
  });
  overlay.setCoords?.();
  if (typeof compareCanvas.moveTo === 'function') {
    compareCanvas.moveTo(overlay, 0);
  } else if (typeof overlay.sendToBack === 'function') {
    overlay.sendToBack();
  }
}

function syncGuideSplitReferenceTagHighlights(tempScopeId, activeRole) {
  const compareTagManager = guideSplitCompareTagManager;
  const normalizedScopeId = String(tempScopeId || '').trim();
  const compareCanvas = guideSplitCompareCanvasManager?.fabricCanvas || null;
  if (!normalizedScopeId) return;
  const normalizedActiveRole = normalizeRoleToken(activeRole);
  const activeCanonicalRole = canonicalRoleToken(normalizedActiveRole);
  guideSplitActiveHighlightRoleCanonical = activeCanonicalRole || '';
  const scopedVectors =
    window.app?.metadataManager?.vectorStrokesByImage?.[normalizedScopeId] || {};
  const tagObjects = (compareCanvas?.getObjects?.() || []).filter(
    object =>
      object?.isTag &&
      (() => {
        const tagImageLabel = String(object?.imageLabel || '');
        return (
          tagImageLabel === normalizedScopeId ||
          tagImageLabel.startsWith(`${normalizedScopeId}::tab:`)
        );
      })()
  );
  Object.keys(scopedVectors).forEach(strokeLabel => {
    const highlighted =
      !!activeCanonicalRole && canonicalRoleToken(strokeLabel) === activeCanonicalRole;
    const tagObj =
      tagObjects.find(object => String(object?.strokeLabel || '') === strokeLabel) || null;
    const tagImageLabel = String(tagObj?.imageLabel || normalizedScopeId);
    compareTagManager?.setTagHighlighted?.(strokeLabel, tagImageLabel, highlighted);
    applyGuideSplitTagHighlightVisual(tagObj, highlighted);
  });
  compareCanvas?.requestRenderAll?.();
}

function refreshGuideSplitTagHighlightsFromUi(tempScopeId = guideSplitActiveTempScopeId) {
  const normalizedScopeId = String(tempScopeId || '').trim();
  const compareCanvas = guideSplitCompareCanvasManager?.fabricCanvas || null;
  if (!normalizedScopeId || !compareCanvas) return;
  const activeRole = resolveGuideActiveRole(guideCompareWorkspaceState.leftViewId, []);
  const activeCanonicalRole = canonicalRoleToken(activeRole);
  const tagObjects = (compareCanvas.getObjects?.() || []).filter(object => {
    if (!object?.isTag) return false;
    const tagImageLabel = String(object?.imageLabel || '');
    return (
      tagImageLabel === normalizedScopeId || tagImageLabel.startsWith(`${normalizedScopeId}::tab:`)
    );
  });
  tagObjects.forEach(tagObj => {
    const highlighted =
      !!activeCanonicalRole &&
      canonicalRoleToken(String(tagObj?.strokeLabel || '')) === activeCanonicalRole;
    applyGuideSplitTagHighlightVisual(tagObj, highlighted);
  });
  compareCanvas.requestRenderAll?.();
}

async function updateGuideSplitHighlightOverlay(
  selection,
  compareCanvasManager = guideSplitCompareCanvasManager,
  tempScopeId = guideSplitActiveTempScopeId
) {
  const normalizedCode = normalizeCode(selection?.code || '');
  const normalizedVariant =
    String(selection?.variant || 'front')
      .trim()
      .toLowerCase() || 'front';
  const compareCanvas = compareCanvasManager?.fabricCanvas || null;
  if (!normalizedCode || !compareCanvas?.backgroundImage) {
    removeGuideSplitHighlightOverlay(compareCanvas);
    return '';
  }

  const roles = await fetchGuideRoleTokens(normalizedCode, normalizedVariant).catch(() => []);
  const activeRole = resolveGuideActiveRole(guideCompareWorkspaceState.leftViewId, roles);
  const visualKey = `${normalizedCode}::${normalizedVariant}::${activeRole || 'none'}`;

  syncGuideSplitReferenceTagHighlights(tempScopeId, activeRole);
  [120, 350, 700].forEach(delayMs => {
    window.setTimeout(() => {
      syncGuideSplitReferenceTagHighlights(tempScopeId, activeRole);
    }, delayMs);
  });

  if (!activeRole) {
    removeGuideSplitHighlightOverlay(compareCanvas);
    if (guideSplitCompareBackgroundVisualKey === visualKey) {
      compareCanvas.requestRenderAll?.();
      return '';
    }
    const backgroundUrl = await fetchGuideRasterUrl(normalizedCode, normalizedVariant, {
      mode: 'preview',
      dimInactive: false,
    });
    await replaceGuideSplitCompareBackgroundImage(backgroundUrl, compareCanvas);
    guideSplitCompareBackgroundVisualKey = visualKey;
    compareCanvas.requestRenderAll?.();
    return '';
  }

  removeGuideSplitHighlightOverlay(compareCanvas, { resetRole: false });
  if (guideSplitCompareBackgroundVisualKey === visualKey) {
    compareCanvas.requestRenderAll?.();
    return activeRole;
  }

  const backgroundUrl = await fetchGuideRasterUrl(normalizedCode, normalizedVariant, {
    mode: 'preview',
    activeRole,
    dimInactive: true,
  });
  await replaceGuideSplitCompareBackgroundImage(backgroundUrl, compareCanvas);
  guideSplitCompareBackgroundVisualKey = visualKey;
  compareCanvas.requestRenderAll?.();
  return activeRole;
}

function createGuideSplitCompareTagManager(compareCanvasManager) {
  const metadataManager = window.app?.metadataManager || null;
  if (!compareCanvasManager || !metadataManager) return null;
  const tagManager = new TagManager(compareCanvasManager, metadataManager);
  const primaryTagManager = window.app?.tagManager || null;
  if (primaryTagManager) {
    tagManager.showMeasurements = primaryTagManager.showMeasurements !== false;
    tagManager.tagSize = primaryTagManager.tagSize || tagManager.tagSize;
    tagManager.tagShape = primaryTagManager.tagShape || tagManager.tagShape;
    tagManager.tagBackgroundStyle =
      primaryTagManager.tagBackgroundStyle || tagManager.tagBackgroundStyle;
    tagManager.connectorColor = primaryTagManager.connectorColor || tagManager.connectorColor;
    tagManager.connectorMatchesLine = primaryTagManager.connectorMatchesLine !== false;
    tagManager.strokeColor = primaryTagManager.strokeColor || tagManager.strokeColor;
  }
  const originalCreateTag = tagManager.createTag.bind(tagManager);
  tagManager.createTag = (...args) => {
    const created = originalCreateTag(...args);
    setGuideSplitReferenceTagState(tagManager, args[0], args[1], false);
    const activeRoleFromUi = resolveGuideActiveRole(guideCompareWorkspaceState.leftViewId, []);
    const activeCanonicalRole = canonicalRoleToken(activeRoleFromUi);
    applyGuideSplitTagHighlightVisual(
      created,
      !!activeCanonicalRole && canonicalRoleToken(args[0]) === activeCanonicalRole
    );
    return created;
  };
  const originalUpdateTagVisibility = tagManager.updateTagVisibility.bind(tagManager);
  tagManager.updateTagVisibility = (strokeLabel, imageLabel, _visible) => {
    originalUpdateTagVisibility(strokeLabel, imageLabel, false);
    setGuideSplitReferenceTagState(tagManager, strokeLabel, imageLabel, false);
  };
  return tagManager;
}

function clearGuideSplitTempScope(scopeId) {
  const targetScopeId = String(scopeId || '').trim();
  if (!targetScopeId) return;
  const scopeIds = resolveGuideSplitScopeIds(targetScopeId);
  const compareCanvas = guideSplitCompareCanvasManager?.fabricCanvas || null;

  removeGuideSplitHighlightOverlay();
  resetGuideSplitCompareBackgroundVisualKey();

  if (guideSplitCompareTagManager?.clearTagsForImage) {
    scopeIds.forEach(candidateScopeId => {
      try {
        guideSplitCompareTagManager.clearTagsForImage(candidateScopeId);
      } catch (error) {
        console.warn('[GuideSplit] Failed to clear compare tags', error);
      }
    });
  }

  if (compareCanvas?.getObjects) {
    compareCanvas
      .getObjects()
      .filter(object => {
        const objectImageLabel = String(object?.imageLabel || '');
        return scopeIds.some(
          candidateScopeId =>
            objectImageLabel === candidateScopeId ||
            objectImageLabel.startsWith(`${candidateScopeId}::tab:`)
        );
      })
      .forEach(object => {
        compareCanvas.remove(object);
      });
    compareCanvas.requestRenderAll?.();
  }

  const metadataManager = window.app?.metadataManager || null;
  const maps = [
    metadataManager?.vectorStrokesByImage,
    metadataManager?.strokeVisibilityByImage,
    metadataManager?.strokeLabelVisibility,
    metadataManager?.strokeMeasurements,
    window.lineStrokesByImage,
    window.customLabelPositions,
    window.calculatedLabelOffsets,
    window.customLabelRotationStamps,
    window.textElementsByImage,
  ];
  maps.forEach(map => {
    if (map && typeof map === 'object') {
      scopeIds.forEach(candidateScopeId => {
        delete map[candidateScopeId];
      });
    }
  });

  if (
    scopeIds.includes(guideSplitActiveTempScopeId) ||
    guideSplitActiveTempScopeId === targetScopeId
  ) {
    guideSplitActiveTempScopeId = '';
  }
}

function seedGuideSplitMeasurementsFromLeft(tempScopeId) {
  const targetScopeId = String(tempScopeId || '').trim();
  const metadataManager = window.app?.metadataManager || null;
  if (!targetScopeId || !metadataManager) return;
  const resolvedTargetScopeId = resolveGuideSplitScopeIds(targetScopeId)[0] || targetScopeId;

  const leftBaseScopeId = String(
    guideCompareWorkspaceState.leftViewId || getCurrentViewId() || ''
  ).trim();
  const leftScopedScopeId = resolveScopedImageLabel(leftBaseScopeId) || leftBaseScopeId;
  const leftMeasurements = {
    ...(metadataManager.strokeMeasurements?.[leftBaseScopeId] || {}),
    ...(metadataManager.strokeMeasurements?.[leftScopedScopeId] || {}),
  };
  const leftStrokeVisibility = {
    ...(metadataManager.strokeVisibilityByImage?.[leftBaseScopeId] || {}),
    ...(metadataManager.strokeVisibilityByImage?.[leftScopedScopeId] || {}),
  };
  const leftLabelVisibility = {
    ...(metadataManager.strokeLabelVisibility?.[leftBaseScopeId] || {}),
    ...(metadataManager.strokeLabelVisibility?.[leftScopedScopeId] || {}),
  };
  const rightVectors = metadataManager.vectorStrokesByImage?.[resolvedTargetScopeId] || {};

  metadataManager.strokeMeasurements[resolvedTargetScopeId] =
    metadataManager.strokeMeasurements[resolvedTargetScopeId] || {};
  metadataManager.strokeVisibilityByImage[resolvedTargetScopeId] =
    metadataManager.strokeVisibilityByImage[resolvedTargetScopeId] || {};
  metadataManager.strokeLabelVisibility[resolvedTargetScopeId] =
    metadataManager.strokeLabelVisibility[resolvedTargetScopeId] || {};

  const pendingLabels = [];
  Object.entries(rightVectors).forEach(([strokeLabel, strokeObj]) => {
    if (leftMeasurements[strokeLabel] !== undefined) {
      metadataManager.strokeMeasurements[resolvedTargetScopeId][strokeLabel] = cloneGuideSplitValue(
        leftMeasurements[strokeLabel]
      );
    }

    if (Object.prototype.hasOwnProperty.call(leftStrokeVisibility, strokeLabel)) {
      metadataManager.strokeVisibilityByImage[resolvedTargetScopeId][strokeLabel] =
        leftStrokeVisibility[strokeLabel] !== false;
    }
    if (Object.prototype.hasOwnProperty.call(leftLabelVisibility, strokeLabel)) {
      metadataManager.strokeLabelVisibility[resolvedTargetScopeId][strokeLabel] =
        leftLabelVisibility[strokeLabel] !== false;
    }

    const strokeVisible =
      metadataManager.strokeVisibilityByImage[resolvedTargetScopeId][strokeLabel] !== false;
    const labelVisible =
      metadataManager.strokeLabelVisibility[resolvedTargetScopeId][strokeLabel] !== false;
    const effectiveVisible =
      strokeObj?.__guideSplitReferenceOnly === true ? false : strokeVisible && labelVisible;

    if (strokeObj?.__guideSplitReferenceOnly) {
      setGuideSplitReferenceObjectState(strokeObj, false);
    } else {
      strokeObj?.set?.({
        visible: strokeVisible,
        evented: strokeVisible,
        selectable: strokeVisible,
      });
      strokeObj?.setCoords?.();
    }
    pendingLabels.push({ strokeLabel, effectiveVisible });
  });

  window.setTimeout(() => {
    pendingLabels.forEach(({ strokeLabel, effectiveVisible }) => {
      if (guideSplitCompareTagManager?.updateTagText) {
        guideSplitCompareTagManager.updateTagText(strokeLabel, resolvedTargetScopeId);
      }
      if (guideSplitCompareTagManager?.updateTagVisibility) {
        guideSplitCompareTagManager.updateTagVisibility(
          strokeLabel,
          resolvedTargetScopeId,
          effectiveVisible
        );
      }
    });
    guideSplitCompareCanvasManager?.fabricCanvas?.requestRenderAll?.();
  }, 90);
}

async function loadGuideIntoCompareCanvas(selection, compareCanvasManager) {
  if (!selection?.code || !compareCanvasManager) return false;

  const normalizedCode = normalizeCode(selection.code);
  const normalizedVariant =
    String(selection.variant || 'front')
      .trim()
      .toLowerCase() || 'front';
  const tempScopeId = buildGuideSplitTempViewId({
    code: normalizedCode,
    variant: normalizedVariant,
  });
  const loadKey = `${tempScopeId}::${compareCanvasManager?.paneId || 'compare'}`;
  if (guideSplitCompareLoadPromise && guideSplitCompareLoadKey === loadKey) {
    return guideSplitCompareLoadPromise;
  }

  const loadToken = guideSplitCompareLoadToken + 1;
  guideSplitCompareLoadToken = loadToken;
  guideSplitCompareLoadKey = loadKey;

  const manager = window.app?.projectManager || window.projectManager;
  if (!manager?.setBackgroundImageOnCanvasManager) {
    if (guideSplitCompareLoadKey === loadKey) {
      guideSplitCompareLoadKey = '';
    }
    return false;
  }

  const loadPromise = (async () => {
    // Clear old guide content immediately so stale tags/SVG don't linger
    // while the new guide loads over the network.
    compareCanvasManager.fabricCanvas?.discardActiveObject?.();
    clearGuideSplitTempScope(guideSplitActiveTempScopeId);
    // Only clear canvas objects; skip resetViewport to avoid triggering a
    // layout reflow that can mis-position the main canvas while the new
    // guide fetches over the network.
    compareCanvasManager.fabricCanvas?.clear?.();

    const [imageUrl, guideSvgText] = await Promise.all([
      fetchGuideRasterUrl(normalizedCode, normalizedVariant, {
        mode: 'preview',
        dimInactive: false,
      }),
      fetchGuideSvgText(normalizedCode, normalizedVariant),
    ]);

    if (guideSplitCompareLoadToken !== loadToken || !guideSplitEnabled) {
      return false;
    }

    if (guideSplitCompareLoadToken !== loadToken || !guideSplitEnabled) {
      return false;
    }

    await manager.setBackgroundImageOnCanvasManager(
      imageUrl,
      compareCanvasManager,
      'fit-canvas',
      tempScopeId || '__guide__'
    );

    if (guideSplitCompareLoadToken !== loadToken || !guideSplitEnabled) {
      clearGuideSplitTempScope(tempScopeId);
      compareCanvasManager.clear();
      return false;
    }

    guideSplitCompareTagManager = createGuideSplitCompareTagManager(compareCanvasManager);
    await importSvgMeasurements(normalizedCode, normalizedVariant, tempScopeId, {
      canvasManager: compareCanvasManager,
      metadataManager: window.app?.metadataManager || null,
      tagManager: guideSplitCompareTagManager,
      svgText: guideSvgText,
      curveMode: 'reference-path',
      skipStatusMessage: true,
      syncUi: false,
    });

    if (guideSplitCompareLoadToken !== loadToken || !guideSplitEnabled) {
      clearGuideSplitTempScope(tempScopeId);
      compareCanvasManager.clear();
      return false;
    }

    seedGuideSplitMeasurementsFromLeft(tempScopeId);
    await updateGuideSplitHighlightOverlay(
      {
        code: normalizedCode,
        variant: normalizedVariant,
      },
      compareCanvasManager,
      tempScopeId
    );

    if (guideSplitCompareLoadToken !== loadToken || !guideSplitEnabled) {
      clearGuideSplitTempScope(tempScopeId);
      compareCanvasManager.clear();
      return false;
    }

    window.setTimeout(() => {
      if (guideSplitCompareLoadToken !== loadToken || guideSplitActiveTempScopeId !== tempScopeId) {
        return;
      }
      refreshGuideSplitTagHighlightsFromUi(tempScopeId);
    }, 120);
    if (!compareCanvasManager.fabricCanvas?.lowerCanvasEl) {
      return false;
    }
    compareCanvasManager.fabricCanvas.selection = true;
    compareCanvasManager.fabricCanvas.skipTargetFind = false;
    if (compareCanvasManager.fabricCanvas.upperCanvasEl) {
      compareCanvasManager.fabricCanvas.upperCanvasEl.style.cursor = '';
      compareCanvasManager.fabricCanvas.upperCanvasEl.style.pointerEvents = '';
    }
    compareCanvasManager.fabricCanvas.defaultCursor = 'default';
    compareCanvasManager.fabricCanvas.hoverCursor = 'move';
    fitGuideSplitCompareBackgroundToFrame();
    compareCanvasManager.fabricCanvas.requestRenderAll?.();
    guideSplitActiveTempScopeId = tempScopeId;
    scheduleGuideSplitLayoutSync({ settle: true });
    return true;
  })();

  guideSplitCompareLoadPromise = loadPromise;
  return loadPromise.finally(() => {
    if (guideSplitCompareLoadPromise === loadPromise) {
      guideSplitCompareLoadPromise = null;
    }
    if (guideSplitCompareLoadKey === loadKey) {
      guideSplitCompareLoadKey = '';
    }
  });
}

function ensureGuideSplitCompareCanvasManager() {
  const host = document.getElementById('guideSplitCompareCanvasHost');
  if (!host) return null;

  if (guideSplitCompareCanvasManager?.fabricCanvas?.wrapperEl) {
    if (guideSplitCompareCanvasManager.fabricCanvas.wrapperEl.parentElement !== host) {
      host.innerHTML = '';
      host.appendChild(guideSplitCompareCanvasManager.fabricCanvas.wrapperEl);
      guideSplitCompareCanvasManager.resizeObserver?.disconnect?.();
      guideSplitCompareCanvasManager.setupResizeObserver?.();
    }
    guideSplitCompareCanvasManager.resize?.();
    window.app?.registerCompareCanvasManager?.(guideSplitCompareCanvasManager);
    return guideSplitCompareCanvasManager;
  }

  if (!host.querySelector('#guideSplitCompareCanvas')) {
    host.innerHTML = '<canvas id="guideSplitCompareCanvas"></canvas>';
  }

  guideSplitCompareCanvasManager = new CanvasManager('guideSplitCompareCanvas', {
    containerId: 'guideSplitCompareCanvasHost',
    enableFloatingLayout: false,
    paneId: 'guide-split-right',
    interactionGuard: () => true,
  });
  guideSplitCompareCanvasManager.init();
  if (guideSplitCompareCanvasManager.fabricCanvas) {
    guideSplitCompareCanvasManager.fabricCanvas.selection = true;
    guideSplitCompareCanvasManager.fabricCanvas.skipTargetFind = false;
    guideSplitCompareCanvasManager.fabricCanvas.defaultCursor = 'default';
    guideSplitCompareCanvasManager.fabricCanvas.hoverCursor = 'move';
    if (guideSplitCompareCanvasManager.fabricCanvas.upperCanvasEl) {
      guideSplitCompareCanvasManager.fabricCanvas.upperCanvasEl.style.cursor = '';
      guideSplitCompareCanvasManager.fabricCanvas.upperCanvasEl.style.pointerEvents = '';
    }
  }
  guideSplitCompareCanvasManager.resize?.();
  window.app?.registerCompareCanvasManager?.(guideSplitCompareCanvasManager);
  return guideSplitCompareCanvasManager;
}

async function setGuideSplitRightView(viewId, sourceKind = 'project-image') {
  if (sourceKind !== 'bound-guide') {
    invalidateGuideSplitCompareLoad();
    clearGuideSplitTempScope(guideSplitActiveTempScopeId);
    guideSplitCompareCanvasManager?.clear?.();
    guideCompareWorkspaceState.rightViewId = '';
    guideCompareWorkspaceState.rightSourceKind = 'bound-guide';
    renderGuideSplitPane();
    return;
  }

  guideCompareWorkspaceState.rightViewId = toBaseViewId(viewId || '');
  guideCompareWorkspaceState.rightSourceKind = sourceKind;
  renderGuideSplitPane();

  if (!guideCompareWorkspaceState.rightViewId) {
    invalidateGuideSplitCompareLoad();
    clearGuideSplitTempScope(guideSplitActiveTempScopeId);
    guideSplitCompareCanvasManager?.clear?.();
    return;
  }

  const manager = window.app?.projectManager || window.projectManager;
  const compareCanvasManager = ensureGuideSplitCompareCanvasManager();
  if (!manager || !compareCanvasManager) return;

  if (
    sourceKind === 'bound-guide' &&
    isGuideSplitTempViewId(guideCompareWorkspaceState.rightViewId)
  ) {
    const parsedGuide = parseGuideSplitTempViewId(guideCompareWorkspaceState.rightViewId);
    if (parsedGuide) {
      await loadGuideIntoCompareCanvas(parsedGuide, compareCanvasManager);
    }
  } else {
    await manager.loadViewIntoCanvasManager(
      guideCompareWorkspaceState.rightViewId,
      compareCanvasManager,
      {
        interactive: false,
      }
    );
  }
  compareCanvasManager.fabricCanvas?.discardActiveObject?.();
  compareCanvasManager.fabricCanvas?.requestRenderAll?.();

  renderGuideSplitPane();
}

async function ensureGuideSplitDefaultRightView() {
  if (_ensureRightViewInFlight) return '';
  _ensureRightViewInFlight = true;
  try {
    const leftViewId = toBaseViewId(guideCompareWorkspaceState.leftViewId || getCurrentViewId());
    const currentRightViewId = toBaseViewId(guideCompareWorkspaceState.rightViewId || '');
    const currentRightSourceKind = guideCompareWorkspaceState.rightSourceKind;
    if (!leftViewId) {
      guideCompareWorkspaceState.rightViewId = '';
      renderGuideSplitPane();
      return '';
    }

    const binding = resolveModelBindingForView(leftViewId);
    if (binding?.selection?.code) {
      const guideViewId = buildGuideSplitTempViewId(binding.selection);
      if (guideViewId) {
        if (
          currentRightSourceKind === 'bound-guide' &&
          currentRightViewId === guideViewId &&
          isGuideSplitCompareCanvasReadyForTempView(guideViewId)
        ) {
          // Re-seed measurements from the (possibly changed) left view
          seedGuideSplitMeasurementsFromLeft(guideViewId);
          void updateGuideSplitHighlightOverlay(parseGuideSplitTempViewId(guideViewId));
          renderGuideSplitPane();
          return guideViewId;
        }
        await setGuideSplitRightView(guideViewId, 'bound-guide');
        return guideViewId;
      }
    }

    invalidateGuideSplitCompareLoad();
    guideCompareWorkspaceState.rightViewId = '';
    guideCompareWorkspaceState.rightSourceKind = 'bound-guide';
    renderGuideSplitPane();
    return '';
  } finally {
    _ensureRightViewInFlight = false;
  }
}

function setGuideSplitEnabled(enabled) {
  const next = enabled === true;
  guideSplitEnabled = next;
  guideCompareWorkspaceState.open = next;
  if (!next) {
    invalidateGuideSplitCompareLoad();
  }
  if (next && !guideCompareWorkspaceState.leftViewId) {
    guideCompareWorkspaceState.leftViewId = toBaseViewId(getCurrentViewId());
  }
  if (next) {
    if (typeof window.saveCurrentCaptureFrameForLabel === 'function') {
      window.saveCurrentCaptureFrameForLabel(
        guideCompareWorkspaceState.leftViewId || getCurrentViewId()
      );
    }
    captureGuideSplitRestoreSnapshot(guideCompareWorkspaceState.leftViewId || getCurrentViewId());
  }
  guideCompareWorkspaceState.activePane = 'left';
  setWindowPrefs({ [GUIDE_SPLIT_ENABLED_PREF_KEY]: guideSplitEnabled });
  guideSplitLastSyncKey = ''; // force re-render
  void applyGuideSplitLayout();
  window.dispatchEvent(new Event('openpaint:guide-split-changed'));
}

async function applyGuideSplitLayout() {
  const wrapper = document.getElementById('main-canvas-wrapper');
  const primaryCanvasManager = getPrimaryCanvasManager();
  const canvasWrapper = getCanvasWrapperElement(primaryCanvasManager);
  if (!wrapper || !canvasWrapper) {
    if (guideSplitEnabled) {
      guideSplitEnabled = false;
      guideCompareWorkspaceState.open = false;
      setWindowPrefs({ [GUIDE_SPLIT_ENABLED_PREF_KEY]: false });
      window.dispatchEvent(new Event('openpaint:guide-split-changed'));
    }
    return;
  }

  if (!guideSplitOriginalParent) {
    guideSplitOriginalParent = wrapper;
    guideSplitOriginalNextSibling = null;
  }

  if (guideSplitEnabled) {
    captureGuideSplitPanelSnapshot();
    setGuideSplitTransitionPending(true);
    const splitRoot = ensureGuideSplitShell();
    if (!splitRoot) return;
    const frameEl = document.getElementById('captureFrame');
    const leftViewId = toBaseViewId(guideCompareWorkspaceState.leftViewId || getCurrentViewId());
    const liveCanvasHost = splitRoot.querySelector('#guideSplitLiveCanvasHost');
    if (liveCanvasHost) {
      Array.from(wrapper.childNodes)
        .filter(node => node !== splitRoot)
        .forEach(node => {
          liveCanvasHost.appendChild(node);
        });
    }
    wrapper.classList.add('guide-split-active');
    document.body.classList.add('guide-split-workspace-active');
    applyGuideSplitCollapsedPanels();
    relocateCaptureOverlayIntoSplitPane();
    ensureGuideSplitFrameGhost();
    if (guideSplitFrameGhost) {
      guideSplitFrameGhost.style.display = 'none';
    }
    if (frameEl) {
      frameEl.style.visibility = 'hidden';
    }
    refreshGuideSplitInteractionGuards();
    if (primaryCanvasManager?.enforceFloatingLayout) {
      primaryCanvasManager.enforceFloatingLayout();
    }
    resizeGuideSplitCanvasManagerNow(primaryCanvasManager);
    syncGuideSplitPrimaryCaptureFrame(leftViewId);
    await ensureGuideSplitDefaultRightView();
    renderGuideSplitPane();
    resizeGuideSplitCanvasManagerNow(guideSplitCompareCanvasManager);
    scheduleGuideSplitLayoutSync({ settle: true });
  } else {
    const splitRoot = wrapper.querySelector('#guideSplitRoot');
    const liveCanvasHost = splitRoot?.querySelector('#guideSplitLiveCanvasHost');
    const _exitManager = window.app?.projectManager || window.projectManager;
    const stayViewId = toBaseViewId(_exitManager?.currentViewId || getCurrentViewId());
    setGuideSplitTransitionPending(false);
    invalidateGuideSplitCompareLoad();
    clearGuideSplitTempScope(guideSplitActiveTempScopeId);
    guideSplitCompareCanvasManager?.clear?.();
    guideSplitCompareCanvasManager?.resetViewport?.();
    teardownGuideSplitCompareCanvasManager();
    guideCompareWorkspaceState.leftViewId = stayViewId || guideCompareWorkspaceState.leftViewId;
    guideSplitSyncingWorkspace = true;
    if (liveCanvasHost) {
      Array.from(liveCanvasHost.childNodes).forEach(node => {
        wrapper.insertBefore(node, splitRoot);
      });
    }
    restoreCaptureOverlayFromSplitPane();
    removeGuideSplitFrameGhost();
    if (splitRoot) splitRoot.remove();
    wrapper.classList.remove('guide-split-active');
    document.body.classList.remove('guide-split-workspace-active');
    restoreGuideSplitPanelSnapshot();
    guideSplitLastSyncKey = '';
    refreshGuideSplitInteractionGuards();
    requestAnimationFrame(() => {
      const restoreViewId = stayViewId || getCurrentViewId();
      restoreGuideSplitSnapshot(restoreViewId);
      syncGuideSplitPrimaryCaptureFrame(restoreViewId, { exact: true });
      resizeGuideSplitCanvasManagerNow(primaryCanvasManager);

      // Force a full view reload from saved view data to restore canvas objects.
      // Do NOT save current view state first — the split mode canvas is in a
      // modified/corrupted state and saving it would clobber the good data.
      const manager = window.app?.projectManager || window.projectManager;
      if (manager?.switchView) {
        window.__suspendSaveCurrentView = true;
        manager.switchView(restoreViewId, true).then(() => {
          window.__suspendSaveCurrentView = false;
          requestAnimationFrame(() => {
            syncGuideSplitPrimaryCaptureFrame(restoreViewId, { exact: true });
            if (typeof window.syncCaptureTabCanvasVisibility === 'function') {
              window.syncCaptureTabCanvasVisibility(restoreViewId);
            }
            const frameEl = document.getElementById('captureFrame');
            if (frameEl) {
              frameEl.style.visibility = '';
            }
            guideSplitSyncingWorkspace = false;
          });
        });
      } else {
        // Fallback: no project manager available
        requestAnimationFrame(() => {
          syncGuideSplitPrimaryCaptureFrame(restoreViewId, { exact: true });
          if (typeof window.syncCaptureTabCanvasVisibility === 'function') {
            window.syncCaptureTabCanvasVisibility(restoreViewId);
          }
          const frameEl = document.getElementById('captureFrame');
          if (frameEl) {
            frameEl.style.visibility = '';
          }
          guideSplitSyncingWorkspace = false;
        });
      }
    });
  }
}

function renderGuideSplitPane() {
  if (!guideSplitEnabled) return;
  const wrapper = document.getElementById('main-canvas-wrapper');
  const pane = wrapper?.querySelector('#guideSplitGuidePane');
  const livePane = wrapper?.querySelector('#guideSplitLivePane');
  if (!pane) return;

  const leftViewId = toBaseViewId(guideCompareWorkspaceState.leftViewId || getCurrentViewId());
  const rightViewId = toBaseViewId(guideCompareWorkspaceState.rightViewId || '');
  const binding = resolveModelBindingForView(leftViewId);
  const stateKey = `${leftViewId}::${rightViewId || '-'}::${guideCompareWorkspaceState.activePane}::${guideCompareWorkspaceState.rightSourceKind}`;
  if (stateKey === guideSplitLastSyncKey) return;
  guideSplitLastSyncKey = stateKey;

  const imageRows = getProjectImageRows();
  const rightLabel =
    guideCompareWorkspaceState.rightSourceKind === 'bound-guide' && binding?.selection?.code
      ? `${binding.selection.code} ${String(binding.selection.variant || 'front').toUpperCase()}`
      : 'Bound Guide';

  if (!rightViewId) {
    pane.innerHTML = `
      <header class="guide-split-guide-head">
        <span>Compare Pane</span>
        <span class="guide-split-guide-actions">
          <button type="button" data-guide-split-action="bound-guide">Bound Guide</button>
          <button type="button" data-guide-split-action="gallery">Gallery</button>
          <button type="button" data-guide-split-action="close">Close</button>
        </span>
      </header>
      <div class="guide-split-guide-body is-empty">
        <div class="guide-split-guide-empty">
          <strong>No bound guide is loaded.</strong>
          <button type="button" data-guide-split-action="bound-guide">
            Load Bound Guide
          </button>
        </div>
      </div>
    `;
  } else {
    const rightSourceLabel =
      guideCompareWorkspaceState.rightSourceKind === 'bound-guide'
        ? binding?.selection?.code
          ? `Bound guide · ${binding.selection.code} ${String(binding.selection.variant || 'front').toUpperCase()}`
          : 'Bound guide'
        : 'Project image';
    pane.innerHTML = `
      <header class="guide-split-guide-head">
        <span>${rightLabel}</span>
        <span class="guide-split-guide-actions">
          <span class="guide-split-picker-label">
            <span>${rightSourceLabel}</span>
          </span>
          <button type="button" data-guide-split-action="bound-guide">Bound Guide</button>
          <button type="button" data-guide-split-action="gallery">Gallery</button>
          <button type="button" data-guide-split-action="close">Close</button>
        </span>
      </header>
      <div class="guide-split-guide-body">
        <div class="guide-split-pane-chip">
          <strong>${rightLabel}</strong>
          <span>Reference / compare pane</span>
        </div>
        <div id="guideSplitCompareCanvasHost" class="guide-split-pane-canvas-host guide-split-compare-host"></div>
      </div>
    `;
    ensureGuideSplitCompareCanvasManager();
  }

  livePane?.classList.toggle('is-active', guideCompareWorkspaceState.activePane !== 'right');
  pane.classList.toggle('is-active', guideCompareWorkspaceState.activePane === 'right');

  if (livePane) {
    livePane.onpointerdown = () => {
      guideCompareWorkspaceState.activePane = 'left';
      livePane.classList.add('is-active');
      pane.classList.remove('is-active');
    };
  }
  pane.onpointerdown = () => {
    guideCompareWorkspaceState.activePane = 'right';
    pane.classList.add('is-active');
    livePane?.classList.remove('is-active');
  };

  pane.querySelector('[data-guide-split-action="close"]')?.addEventListener('click', () => {
    setGuideSplitEnabled(false);
  });
  pane.querySelector('[data-guide-split-action="gallery"]')?.addEventListener('click', () => {
    showGuideGallery({ source: 'split-pane', mode: 'select' });
  });
  pane.querySelectorAll('[data-guide-split-action="bound-guide"]').forEach(button => {
    button.addEventListener('click', () => {
      void ensureGuideSplitDefaultRightView();
    });
  });
}

async function syncGuideSplitToActiveView() {
  if (!guideSplitEnabled || guideSplitSyncingWorkspace || guideSplitSuppressViewSwitchSync > 0) {
    return;
  }
  if (window.__guideSplitLayoutSettling) return;
  if (_ensureRightViewInFlight) return;
  const wrapper = document.getElementById('main-canvas-wrapper');
  if (wrapper && !wrapper.classList.contains('guide-split-active')) {
    guideSplitLastSyncKey = '';
    await applyGuideSplitLayout();
    return;
  }
  if (wrapper && !wrapper.querySelector('#guideSplitGuidePane')) {
    guideSplitLastSyncKey = '';
    await applyGuideSplitLayout();
    return;
  }

  let needsLayoutSync = false;
  let shouldRefreshBoundGuide = false;

  if (guideCompareWorkspaceState.activePane === 'left') {
    const nextLeftViewId = toBaseViewId(getCurrentViewId());
    const leftChanged = guideCompareWorkspaceState.leftViewId !== nextLeftViewId;
    guideCompareWorkspaceState.leftViewId = nextLeftViewId;
    if (leftChanged) {
      needsLayoutSync = true;
      setGuideSplitTransitionPending(true);
      captureGuideSplitRestoreSnapshot(nextLeftViewId);
    }
    if (guideCompareWorkspaceState.rightSourceKind === 'bound-guide') {
      const binding = resolveModelBindingForView(nextLeftViewId);
      const expectedRightViewId = binding?.selection
        ? buildGuideSplitTempViewId(binding.selection)
        : '';
      const currentRightViewId = String(guideCompareWorkspaceState.rightViewId || '').trim();
      const compareReady = currentRightViewId
        ? isGuideSplitCompareCanvasReadyForTempView(currentRightViewId)
        : false;
      shouldRefreshBoundGuide =
        leftChanged ||
        !currentRightViewId ||
        currentRightViewId === guideCompareWorkspaceState.leftViewId ||
        currentRightViewId !== expectedRightViewId ||
        !compareReady;
    } else if (
      guideCompareWorkspaceState.rightViewId === guideCompareWorkspaceState.leftViewId ||
      !guideCompareWorkspaceState.rightViewId
    ) {
      await ensureGuideSplitDefaultRightView();
      needsLayoutSync = true;
    }
  }

  if (guideCompareWorkspaceState.rightSourceKind === 'bound-guide' && shouldRefreshBoundGuide) {
    await ensureGuideSplitDefaultRightView();
    needsLayoutSync = true;
  }

  if (guideCompareWorkspaceState.rightSourceKind === 'bound-guide') {
    const parsedGuide = parseGuideSplitTempViewId(guideCompareWorkspaceState.rightViewId);
    if (
      parsedGuide &&
      isGuideSplitCompareCanvasReadyForTempView(guideCompareWorkspaceState.rightViewId)
    ) {
      void updateGuideSplitHighlightOverlay(parsedGuide);
    }
  }

  renderGuideSplitPane();
  if (needsLayoutSync) {
    scheduleGuideSplitLayoutSync({ settle: false });
  }
}

function availableViewsForCode(code, viewsByCode) {
  const fallback = ['front', 'back', 'side'];
  const candidate = Array.isArray(viewsByCode?.[code]) ? viewsByCode[code] : [];
  const normalized = Array.from(
    new Set(
      candidate
        .map(view =>
          String(view || '')
            .trim()
            .toLowerCase()
        )
        .filter(view => view === 'front' || view === 'back' || view === 'side')
    )
  );
  return normalized.length ? normalized : fallback;
}

function showGuideGallery(options = {}) {
  ensureStyles();

  if (!galleryOverlay) {
    galleryOverlay = document.createElement('div');
    galleryOverlay.className = 'guide-gallery-overlay';
    document.body.appendChild(galleryOverlay);
  }

  // All uploaded guide codes (Worker handles both Front_CODE.svg and CODE.svg)
  const fallbackCodes = [
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
  let allCodes = [...fallbackCodes];
  let viewsByCode = {};
  allCodes.forEach(code => {
    viewsByCode[code] = ['front', 'back', 'side'];
  });
  let query = '';
  const currentViewId = getCurrentViewId();
  const currentCodes = resolveGuideContext(currentViewId).codes;
  let selectedCode = currentCodes[0] || '';
  let selectedView = 'front';
  let bindTargetViewId = '';
  let searchVisible = getWindowPrefs()?.[GUIDE_GALLERY_SEARCH_PREF_KEY] === true;
  let panelHidden = getWindowPrefs()?.[GUIDE_GALLERY_PANEL_HIDDEN_PREF_KEY] === true;
  let autoCompactHeader = false;
  let galleryMode = options?.mode === 'bind' ? 'bind' : 'select';
  let selectedModelIds = new Set();
  let bindPreviewImageId = '';
  let bindPreviewModelCode = '';
  let bindScopeMode = 'frame';
  let bindPreviewFrameTarget = 'active';
  const bindVariantByCode = {};

  const getBindTargetOptions = () => {
    const manager = window.app?.projectManager || window.projectManager;
    const views = manager?.views && typeof manager.views === 'object' ? manager.views : {};
    const ids = Object.keys(views);
    const imageBacked = ids.filter(viewId => Boolean(views?.[viewId]?.image));
    return imageBacked;
  };

  const getFrameTargetsForImage = imageId => {
    const baseViewId = toBaseViewId(imageId);
    const tabState =
      window.captureTabsByLabel && typeof window.captureTabsByLabel === 'object'
        ? window.captureTabsByLabel[baseViewId]
        : null;
    const tabRows = Array.isArray(tabState?.tabs)
      ? tabState.tabs.filter(tab => tab && tab.type !== 'master')
      : [];
    return tabRows.map(tab => ({
      id: String(tab.id || '').trim(),
      name: String(tab.name || '').trim() || 'Frame',
    }));
  };

  const getDefaultVariantForCode = code => {
    const views = availableViewsForCode(code, viewsByCode);
    if (views.includes('front')) return 'front';
    return views[0] || 'front';
  };

  const resolveScopeIdForImage = imageId => {
    const baseViewId = toBaseViewId(imageId);
    if (!baseViewId) return '';
    if (bindScopeMode === 'image' || bindPreviewFrameTarget === 'all') {
      return baseViewId;
    }
    const targetTabId =
      bindPreviewFrameTarget === 'active'
        ? getActiveTabIdForView(baseViewId)
        : String(bindPreviewFrameTarget || '').trim();
    return targetTabId ? `${baseViewId}::tab:${targetTabId}` : baseViewId;
  };

  const bindCodeToTarget = (
    code,
    targetViewId,
    variant = selectedView,
    existingSelectionId = '',
    scopeMode = 'image'
  ) => {
    if (!code || !targetViewId) return;
    const selection = existingSelectionId
      ? {
          id: existingSelectionId,
          code: normalizeCode(code),
          variant: String(variant || 'front').toLowerCase(),
        }
      : upsertModelSelection(code, variant);
    if (!selection?.id) return;
    const normalizedTarget = toBaseViewId(targetViewId);
    const targetScopeId =
      scopeMode === 'frame'
        ? resolveScopeIdForImage(normalizedTarget) || normalizedTarget
        : normalizedTarget;
    linkSelectionToScope(selection.id, targetScopeId);
    saveGuideCodes([code], targetViewId, variant);
    tagGuideOnView(targetViewId, code, variant);
    setStatusMessage(
      `Bound ${code} to ${scopeMode === 'frame' ? `frame ${targetScopeId}` : `image ${normalizedTarget}`}.`,
      'success'
    );
    if (guideSplitEnabled) {
      renderGuideSplitPane();
    }
    window.dispatchEvent(new Event('openpaint:guide-binding-changed'));
  };

  const renderGallery = () => {
    const runtimeCurrentViewId = getCurrentViewId();
    const bindTargets = getBindTargetOptions();
    const modelState = getGuideModelLinkState();
    const projectImages = getProjectImageRows();
    const imageDisplayById = Object.fromEntries(
      projectImages.map(image => [image.id, image.displayName])
    );
    const selectionById = new Map(modelState.selections.map(item => [item.id, item]));
    selectedModelIds = new Set(
      Array.from(selectedModelIds).filter(selectionId => selectionById.has(selectionId))
    );
    const showBindTargetSelect = bindTargets.length > 1;
    if (!bindTargets.includes(bindTargetViewId)) {
      bindTargetViewId = bindTargets[0] || '';
    }
    if (!bindPreviewImageId || !projectImages.some(image => image.id === bindPreviewImageId)) {
      bindPreviewImageId = projectImages.some(image => image.id === runtimeCurrentViewId)
        ? runtimeCurrentViewId
        : projectImages[0]?.id || '';
    }
    const linkedSelectionForPreviewImage =
      modelState.linksByScope[resolveScopeIdForImage(bindPreviewImageId)] ||
      modelState.linksByScope[bindPreviewImageId] ||
      modelState.linksByImage[bindPreviewImageId] ||
      '';
    const linkedSelectionModel = linkedSelectionForPreviewImage
      ? selectionById.get(linkedSelectionForPreviewImage)
      : null;
    // Only auto-select if user hasn't explicitly chosen
    if (!bindPreviewModelCode) {
      bindPreviewModelCode =
        linkedSelectionModel?.code || selectedCode || modelState.selections[0]?.code || '';
    }
    if (bindPreviewModelCode && !bindVariantByCode[bindPreviewModelCode]) {
      bindVariantByCode[bindPreviewModelCode] = getDefaultVariantForCode(bindPreviewModelCode);
    }
    const bindPreviewSelection = bindPreviewModelCode
      ? {
          code: bindPreviewModelCode,
          variant: bindVariantByCode[bindPreviewModelCode] || 'front',
        }
      : null;
    const bindPreviewImage = projectImages.find(image => image.id === bindPreviewImageId) || null;

    const filteredCodes = allCodes.filter(code => code.includes(query.toUpperCase()));
    if (selectedCode && !filteredCodes.includes(selectedCode)) {
      selectedCode = filteredCodes[0] || '';
    }

    const items = filteredCodes
      .map(code => {
        const selectedClass = code === selectedCode ? ' selected' : '';
        const views = availableViewsForCode(code, viewsByCode);
        const activeView =
          bindVariantByCode[code] && views.includes(bindVariantByCode[code])
            ? bindVariantByCode[code]
            : views[0];
        const isCodeQueued = modelState.selections.some(item => item.code === code);
        return `
          <div class="guide-gallery-item${selectedClass}" data-code="${code}">
            <div class="guide-gallery-item-label">
              <span>
                <input type="checkbox" class="guide-gallery-item-select" data-select-code="${code}" ${isCodeQueued ? 'checked' : ''} />
                ${code}
              </span>
            </div>
            <div class="guide-gallery-item-body">
              <img src="${buildGuidePreviewUrl(code, activeView)}" alt="${code} ${activeView} view" loading="lazy" data-guide-code="${code}" data-guide-view="${activeView}" />
            </div>
          </div>
        `;
      })
      .join('');

    const selectedModelCodes = Array.from(new Set(modelState.selections.map(item => item.code)));
    selectedModelCodes.forEach(code => {
      if (bindVariantByCode[code]) return;
      bindVariantByCode[code] = getDefaultVariantForCode(code);
    });
    const selectedModelRows = selectedModelCodes
      .map(code => {
        const availableViews = availableViewsForCode(code, viewsByCode);
        const activeVariant = availableViews.includes(bindVariantByCode[code])
          ? bindVariantByCode[code]
          : getDefaultVariantForCode(code);
        bindVariantByCode[code] = activeVariant;
        return `
          <li class="guide-gallery-link-row" style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;">
            <label style="display:flex;align-items:center;gap:6px;min-width:0;">
              <input type="radio" name="guideBindModelCode" data-bind-preview-selection="${code}" ${code === bindPreviewModelCode ? 'checked' : ''} />
              <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"><strong>${code}</strong></span>
            </label>
            <select data-bind-model-view="${code}" style="font-size:12px;padding:4px 6px;border:1px solid #cbd5e1;border-radius:6px;">
              ${availableViews
                .map(
                  view =>
                    `<option value="${view}" ${view === activeVariant ? 'selected' : ''}>${view.toUpperCase()}</option>`
                )
                .join('')}
            </select>
          </li>
        `;
      })
      .join('');

    const imageRows = projectImages
      .map(image => {
        const linkedSelectionId =
          modelState.linksByScope[getFrameScopeIdForView(image.id)] ||
          modelState.linksByScope[image.id] ||
          modelState.linksByImage[image.id] ||
          '';
        const linkedSelection = linkedSelectionId ? selectionById.get(linkedSelectionId) : null;
        return `<tr><td><strong>${image.displayName}</strong></td><td><span class="guide-gallery-link-pill ${linkedSelection ? '' : 'model-only'}">${linkedSelection ? `${linkedSelection.code} · ${linkedSelection.variant.toUpperCase()}` : 'Unlinked image'}</span><span class="guide-gallery-link-actions"><button type="button" class="guide-gallery-link-btn" data-link-action="bind" data-image-id="${image.id}">Bind Selected</button><button type="button" class="guide-gallery-link-btn unlink" data-link-action="unlink" data-image-id="${image.id}">Unlink</button></span></td></tr>`;
      })
      .join('');

    const bindPreviewPanelHtml = `
      <section class="guide-gallery-bind-preview">
        <div class="guide-gallery-bind-preview-main">
          <div>
            <div class="guide-gallery-bind-preview-pane">${bindPreviewImage ? `<img id="guideGalleryBindPreviewImageEl" src="${bindPreviewImage.imageUrl}" alt="${bindPreviewImage.displayName}" />` : '<span id="guideGalleryBindPreviewImageEmpty" style="font-size:12px;color:#64748b;">Select an image</span>'}</div>
            <div id="guideGalleryBindPreviewImageMeta" class="guide-gallery-bind-preview-meta">${bindPreviewImage ? bindPreviewImage.displayName : 'No image selected'}</div>
            <div style="margin-top:6px;display:flex;align-items:center;gap:6px;">
              <label style="font-size:11px;font-weight:700;color:#334155;">Frame</label>
              <select id="guideGalleryBindFrameTarget" style="flex:1;font-size:12px;padding:4px 6px;border:1px solid #cbd5e1;border-radius:6px;">
                <option value="active" ${bindPreviewFrameTarget === 'active' ? 'selected' : ''}>Active frame</option>
                ${
                  bindPreviewImage
                    ? getFrameTargetsForImage(bindPreviewImage.id)
                        .map(
                          frame =>
                            `<option value="${frame.id}" ${frame.id === bindPreviewFrameTarget ? 'selected' : ''}>${frame.name}</option>`
                        )
                        .join('')
                    : ''
                }
                <option value="all" ${bindPreviewFrameTarget === 'all' ? 'selected' : ''}>All frames</option>
              </select>
            </div>
          </div>
          <div class="guide-gallery-bind-preview-actions">
            <button type="button" class="guide-gallery-link-btn" data-link-action="bind-preview" ${bindPreviewImage ? '' : 'disabled'}>Bind Now</button>
            <button type="button" class="guide-gallery-link-btn unlink" data-link-action="unlink-preview" ${bindPreviewImage ? '' : 'disabled'}>Unlink</button>
          </div>
          <div>
            <div class="guide-gallery-bind-preview-pane">${bindPreviewSelection ? `<img id="guideGalleryBindPreviewModelEl" src="${buildGuidePreviewUrl(bindPreviewSelection.code, bindPreviewSelection.variant)}" alt="${bindPreviewSelection.code} ${bindPreviewSelection.variant}" />` : '<span id="guideGalleryBindPreviewModelEmpty" style="font-size:12px;color:#64748b;">Select one model</span>'}</div>
            <div id="guideGalleryBindPreviewModelMeta" class="guide-gallery-bind-preview-meta">${bindPreviewSelection ? `${bindPreviewSelection.code} · ${bindPreviewSelection.variant.toUpperCase()}` : 'No model selected'}</div>
            <div style="margin-top:6px;display:flex;align-items:center;gap:6px;">
              <label style="font-size:11px;font-weight:700;color:#334155;">View</label>
              <select id="guideGalleryBindModelView" style="flex:1;font-size:12px;padding:4px 6px;border:1px solid #cbd5e1;border-radius:6px;" ${bindPreviewModelCode ? '' : 'disabled'}>
                ${
                  bindPreviewModelCode
                    ? availableViewsForCode(bindPreviewModelCode, viewsByCode)
                        .map(view => {
                          const isSelected =
                            view ===
                            (bindVariantByCode[bindPreviewModelCode] ||
                              getDefaultVariantForCode(bindPreviewModelCode));
                          return `<option value="${view}" ${isSelected ? 'selected' : ''}>${view.toUpperCase()}</option>`;
                        })
                        .join('')
                    : '<option value="front">FRONT</option>'
                }
              </select>
            </div>
          </div>
        </div>
        <div class="guide-gallery-bind-preview-strip">
          <div>
            <div style="font-size:11px;font-weight:700;color:#0f172a;margin-bottom:6px;">Project Images</div>
            <div class="guide-gallery-bind-strip">${
              projectImages
                .map(
                  image =>
                    `<button type="button" class="guide-gallery-bind-strip-item ${image.id === bindPreviewImageId ? 'active' : ''}" data-bind-preview-image="${image.id}">${image.imageUrl ? `<img src="${image.imageUrl}" alt="${image.displayName}" />` : '<div style="width:40px;height:30px;border-radius:5px;background:#f1f5f9;"></div>'}<span>${image.displayName}</span></button>`
                )
                .join('') || '<div style="font-size:11px;color:#64748b;">No images yet.</div>'
            }</div>
          </div>
          <div>
            <div style="font-size:11px;font-weight:700;color:#0f172a;margin-bottom:6px;">Selected Models</div>
            <div class="guide-gallery-bind-strip">${
              selectedModelCodes
                .map(
                  code =>
                    `<button type="button" class="guide-gallery-bind-strip-item ${code === bindPreviewModelCode ? 'active' : ''}" data-bind-preview-selection="${code}"><img src="${buildGuidePreviewUrl(code, bindVariantByCode[code] || 'front')}" alt="${code} ${bindVariantByCode[code] || 'front'}" /><span>${code} · ${(bindVariantByCode[code] || 'front').toUpperCase()}</span></button>`
                )
                .join('') ||
              '<div style="font-size:11px;color:#64748b;">No model selected yet.</div>'
            }</div>
          </div>
        </div>
      </section>
    `;

    galleryOverlay.innerHTML = `
      <div class="guide-gallery-container">
        <div class="guide-gallery-chrome">
          <div class="guide-gallery-header">
            <button class="guide-gallery-close">Close (Esc)</button>
            <h2 class="guide-gallery-title">Measurement Guide Gallery</h2>
            <div class="guide-gallery-search-wrap ${searchVisible ? '' : 'hidden'}">
              <input type="text" class="guide-gallery-search" placeholder="Search..." value="${query}" />
            </div>
            <div class="guide-gallery-toolbar">
              <button type="button" class="guide-gallery-mode ${galleryMode === 'select' ? 'active' : ''}" data-gallery-mode="select">Select Mode</button>
              <button type="button" class="guide-gallery-mode ${galleryMode === 'bind' ? 'active' : ''}" data-gallery-mode="bind">Bind Mode</button>
              <button type="button" class="guide-gallery-toggle-search">${searchVisible ? 'Hide Search' : 'Show Search'}</button>
              <button type="button" class="guide-gallery-toggle-panel">${panelHidden ? 'Show Panel' : 'Hide Panel'}</button>
              ${
                showBindTargetSelect
                  ? `<select class="guide-gallery-bind-target">${bindTargets
                      .map(viewId => {
                        const selected = viewId === bindTargetViewId ? 'selected' : '';
                        const displayName = imageDisplayById[viewId] || viewId;
                        return `<option value="${viewId}" ${selected}>Bind target: ${displayName}</option>`;
                      })
                      .join('')}</select>`
                  : `<div style="font-size:12px;color:#334155;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;">Bind target: ${bindTargetViewId ? imageDisplayById[bindTargetViewId] || bindTargetViewId : 'none'}</div>`
              }
              <button type="button" class="guide-gallery-load-current">Load Current</button>
              <button type="button" class="guide-gallery-add-image">Add Image</button>
              <button type="button" class="guide-gallery-add-all">Add Front/Back/Side</button>
              <button type="button" class="guide-gallery-add-selected">Add Selected Models</button>
              <button type="button" class="guide-gallery-bind">Bind</button>
              <div id="guideGalleryStatus" class="guide-gallery-status ${selectedCode ? '' : 'empty'}">${selectedCode ? `Selected: ${selectedCode} · Variant: ${selectedView.toUpperCase()} · Queue: ${modelState.selections.length}` : `Select a model card and variant. Queue: ${modelState.selections.length}`}</div>
            </div>
            ${
              galleryMode === 'bind'
                ? `<div class="guide-gallery-link-grid bind-mode" style="display:${panelHidden ? 'none' : 'grid'};">
                     ${bindPreviewPanelHtml}
                     <section class="guide-gallery-link-card">
                       <h3 class="guide-gallery-link-title">Image to Model Links</h3>
                       <table class="guide-gallery-link-table"><thead><tr><th>Project Image</th><th>Linked Model</th></tr></thead><tbody id="guideGalleryLinksTableBody">${imageRows || '<tr><td><strong>No project images yet.</strong></td><td><span class="guide-gallery-link-pill model-only">Empty</span></td></tr>'}</tbody></table>
                     </section>
                   </div>`
                : ''
            }
          </div>
        </div>
        <div class="guide-gallery-content">
          <div class="guide-gallery-grid">${items || '<p class="guide-gallery-preview-empty">No model codes found.</p>'}</div>
        </div>
      </div>
    `;

    const searchInput = galleryOverlay.querySelector('.guide-gallery-search');
    const closeBtn = galleryOverlay.querySelector('.guide-gallery-close');
    const bindTargetSelect = galleryOverlay.querySelector('.guide-gallery-bind-target');
    const bindFrameTargetSelect = galleryOverlay.querySelector('#guideGalleryBindFrameTarget');
    const bindModelViewSelect = galleryOverlay.querySelector('#guideGalleryBindModelView');
    const modeButtons = galleryOverlay.querySelectorAll('[data-gallery-mode]');
    const toggleSearchBtn = galleryOverlay.querySelector('.guide-gallery-toggle-search');
    const togglePanelBtn = galleryOverlay.querySelector('.guide-gallery-toggle-panel');
    const loadCurrentBtn = galleryOverlay.querySelector('.guide-gallery-load-current');
    const addImageBtn = galleryOverlay.querySelector('.guide-gallery-add-image');
    const addAllBtn = galleryOverlay.querySelector('.guide-gallery-add-all');
    const addSelectedBtn = galleryOverlay.querySelector('.guide-gallery-add-selected');
    const bindBtn = galleryOverlay.querySelector('.guide-gallery-bind');
    const headerEl = galleryOverlay.querySelector('.guide-gallery-header');
    const linksTableBodyEl = galleryOverlay.querySelector('#guideGalleryLinksTableBody');
    const selectedModelsListEl = galleryOverlay.querySelector('#guideGallerySelectedModelsList');
    const statusEl = galleryOverlay.querySelector('#guideGalleryStatus');

    const syncHeaderCompactMode = () => {
      if (!headerEl) return;
      const compact = panelHidden || autoCompactHeader;
      headerEl.classList.toggle('compact', compact);
      if (togglePanelBtn) {
        togglePanelBtn.textContent = compact ? 'Show Panel' : 'Hide Panel';
      }
    };

    const renderSelectionLists = () => {
      const state = getGuideModelLinkState();
      const images = getProjectImageRows();
      const displayById = Object.fromEntries(images.map(image => [image.id, image.displayName]));
      const byId = new Map(state.selections.map(item => [item.id, item]));
      selectedModelIds = new Set(
        Array.from(selectedModelIds).filter(selectionId => byId.has(selectionId))
      );

      const selectedCodes = Array.from(new Set(state.selections.map(item => item.code)));
      selectedCodes.forEach(code => {
        if (bindVariantByCode[code]) return;
        bindVariantByCode[code] = getDefaultVariantForCode(code);
      });
      const selectedRows = selectedCodes
        .map(code => {
          const views = availableViewsForCode(code, viewsByCode);
          if (!views.includes(bindVariantByCode[code])) {
            bindVariantByCode[code] = getDefaultVariantForCode(code);
          }
          const isActive = bindPreviewModelCode === code ? 'checked' : '';
          return `<li class="guide-gallery-link-row" style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;"><label style="display:flex;align-items:center;gap:6px;min-width:0;"><input type="radio" name="guideBindModelCode" data-bind-preview-selection="${code}" ${isActive} /><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"><strong>${code}</strong></span></label><select data-bind-model-view="${code}" style="font-size:12px;padding:4px 6px;border:1px solid #cbd5e1;border-radius:6px;">${views.map(view => `<option value="${view}" ${view === bindVariantByCode[code] ? 'selected' : ''}>${view.toUpperCase()}</option>`).join('')}</select></li>`;
        })
        .join('');

      if (selectedModelsListEl) {
        selectedModelsListEl.innerHTML =
          selectedRows ||
          '<li class="guide-gallery-link-row"><span>No models selected yet.</span><span class="guide-gallery-link-pill model-only">Model only</span></li>';
      }

      if (galleryMode === 'bind' && selectedModelIds.size > 1) {
        // Binding mode expects one active model candidate.
        const firstOnly = Array.from(selectedModelIds).slice(0, 1);
        selectedModelIds = new Set(firstOnly);
      }

      const tableRows = images
        .map(image => {
          const linkedSelectionId =
            state.linksByScope[getFrameScopeIdForView(image.id)] ||
            state.linksByScope[image.id] ||
            state.linksByImage[image.id] ||
            '';
          const linkedSelection = linkedSelectionId ? byId.get(linkedSelectionId) : null;
          return `<tr><td><strong>${image.displayName}</strong></td><td><span class="guide-gallery-link-pill ${linkedSelection ? '' : 'model-only'}">${linkedSelection ? `${linkedSelection.code} · ${linkedSelection.variant.toUpperCase()}` : 'Unlinked image'}</span><span class="guide-gallery-link-actions"><button type="button" class="guide-gallery-link-btn" data-link-action="bind" data-image-id="${image.id}">Bind Selected</button><button type="button" class="guide-gallery-link-btn unlink" data-link-action="unlink" data-image-id="${image.id}">Unlink</button></span></td></tr>`;
        })
        .join('');

      if (linksTableBodyEl) {
        linksTableBodyEl.innerHTML =
          tableRows ||
          '<tr><td><strong>No project images yet.</strong></td><td><span class="guide-gallery-link-pill model-only">Empty</span></td></tr>';
      }

      if (addSelectedBtn) {
        addSelectedBtn.disabled = selectedModelIds.size === 0;
        addSelectedBtn.textContent =
          selectedModelIds.size > 0
            ? `Add Selected Models (${selectedModelIds.size})`
            : 'Add Selected Models';
      }

      if (statusEl) {
        statusEl.classList.toggle('empty', !selectedCode);
        statusEl.textContent = selectedCode
          ? `Selected: ${selectedCode} · Variant: ${selectedView.toUpperCase()} · Queue: ${state.selections.length}`
          : `Select a model card and variant. Queue: ${state.selections.length}`;
      }

      galleryOverlay.querySelectorAll('[data-bind-model-view]').forEach(select => {
        select.onchange = event => {
          const code = String(select.getAttribute('data-bind-model-view') || '').trim();
          const value = String(event.target?.value || '')
            .trim()
            .toLowerCase();
          if (!code || !value) return;
          bindVariantByCode[code] = value;
          if (code === bindPreviewModelCode) {
            refreshBindPreviewDom();
            syncBindActionState();
          }
        };
      });

      if (galleryMode === 'bind') {
        refreshBindPreviewDom();
      }
    };

    const refreshBindPreviewDom = () => {
      if (galleryMode !== 'bind') return;

      const state = getGuideModelLinkState();
      const byId = new Map(state.selections.map(item => [item.id, item]));
      const images = getProjectImageRows();

      if (!bindPreviewImageId || !images.some(image => image.id === bindPreviewImageId)) {
        bindPreviewImageId = images[0]?.id || '';
      }

      const linkedSelectionId = bindPreviewImageId
        ? state.linksByScope[resolveScopeIdForImage(bindPreviewImageId)] ||
          state.linksByScope[bindPreviewImageId] ||
          state.linksByImage[bindPreviewImageId] ||
          ''
        : '';
      const linkedSelection = linkedSelectionId ? byId.get(linkedSelectionId) : null;
      // Only auto-select if user hasn't explicitly chosen
      if (!bindPreviewModelCode) {
        bindPreviewModelCode = linkedSelection?.code || state.selections[0]?.code || '';
      }
      if (bindPreviewModelCode && !bindVariantByCode[bindPreviewModelCode]) {
        bindVariantByCode[bindPreviewModelCode] = getDefaultVariantForCode(bindPreviewModelCode);
      }

      const image = images.find(item => item.id === bindPreviewImageId) || null;
      const selection = bindPreviewModelCode
        ? {
            code: bindPreviewModelCode,
            variant: bindVariantByCode[bindPreviewModelCode] || 'front',
          }
        : null;

      const imagePane = galleryOverlay.querySelector(
        '.guide-gallery-bind-preview-main > div:first-child .guide-gallery-bind-preview-pane'
      );
      const modelPane = galleryOverlay.querySelector(
        '.guide-gallery-bind-preview-main > div:last-child .guide-gallery-bind-preview-pane'
      );
      const imageMeta = galleryOverlay.querySelector('#guideGalleryBindPreviewImageMeta');
      const modelMeta = galleryOverlay.querySelector('#guideGalleryBindPreviewModelMeta');
      const modelViewSelect = galleryOverlay.querySelector('#guideGalleryBindModelView');

      if (imagePane) {
        imagePane.innerHTML = image
          ? `<img id="guideGalleryBindPreviewImageEl" src="${image.imageUrl}" alt="${image.displayName}" />`
          : '<span id="guideGalleryBindPreviewImageEmpty" style="font-size:12px;color:#64748b;">Select an image</span>';
        if (image) {
          const previewEl = imagePane.querySelector('#guideGalleryBindPreviewImageEl');
          requestAnimationFrame(() => {
            applyImagePreviewViewport(previewEl, image.id);
          });
        }
      }
      if (imageMeta) {
        imageMeta.textContent = image ? image.displayName : 'No image selected';
      }

      if (modelPane) {
        modelPane.innerHTML = selection
          ? `<img id="guideGalleryBindPreviewModelEl" src="${buildGuidePreviewUrl(selection.code, selection.variant)}" alt="${selection.code} ${selection.variant}" />`
          : '<span id="guideGalleryBindPreviewModelEmpty" style="font-size:12px;color:#64748b;">Select one model</span>';
      }
      if (modelMeta) {
        modelMeta.textContent = selection
          ? `${selection.code} · ${selection.variant.toUpperCase()}`
          : 'No model selected';
      }

      if (modelViewSelect) {
        if (!bindPreviewModelCode) {
          modelViewSelect.innerHTML = '<option value="front">FRONT</option>';
          modelViewSelect.disabled = true;
        } else {
          const views = availableViewsForCode(bindPreviewModelCode, viewsByCode);
          const activeView =
            bindVariantByCode[bindPreviewModelCode] ||
            getDefaultVariantForCode(bindPreviewModelCode);
          modelViewSelect.innerHTML = views
            .map(
              view =>
                `<option value="${view}" ${view === activeView ? 'selected' : ''}>${view.toUpperCase()}</option>`
            )
            .join('');
          modelViewSelect.disabled = false;
          modelViewSelect.value = activeView;
        }
      }

      galleryOverlay.querySelectorAll('[data-bind-preview-image]').forEach(button => {
        const imageId = String(button.getAttribute('data-bind-preview-image') || '').trim();
        button.classList.toggle('active', imageId === bindPreviewImageId);
      });

      galleryOverlay.querySelectorAll('[data-bind-preview-selection]').forEach(button => {
        const modelCode = String(button.getAttribute('data-bind-preview-selection') || '').trim();
        button.classList.toggle('active', modelCode === bindPreviewModelCode);
      });

      const frameTarget = galleryOverlay.querySelector('#guideGalleryBindFrameTarget');
      if (frameTarget) {
        const currentValue = String(frameTarget.value || bindPreviewFrameTarget || 'active');
        const frames = bindPreviewImageId ? getFrameTargetsForImage(bindPreviewImageId) : [];
        frameTarget.innerHTML = `
          <option value="active">Active frame</option>
          ${frames.map(frame => `<option value="${frame.id}">${frame.name}</option>`).join('')}
          <option value="all">All frames</option>
        `;
        const nextValue =
          currentValue === 'all' ||
          currentValue === 'active' ||
          frames.some(frame => frame.id === currentValue)
            ? currentValue
            : 'active';
        bindPreviewFrameTarget = nextValue;
        bindScopeMode = nextValue === 'all' ? 'image' : 'frame';
        frameTarget.value = nextValue;
      }

      const bindBtnPreview = galleryOverlay.querySelector('[data-link-action="bind-preview"]');
      const unlinkBtnPreview = galleryOverlay.querySelector('[data-link-action="unlink-preview"]');
      if (bindBtnPreview) bindBtnPreview.disabled = !image || !resolveBindingCandidate();
      if (unlinkBtnPreview) unlinkBtnPreview.disabled = !image;
    };

    const hasSelection = Boolean(selectedCode);
    [loadCurrentBtn, addImageBtn, addAllBtn].forEach(btn => {
      if (!btn) return;
      btn.disabled = !hasSelection;
    });
    const initialCandidate = resolveBindingCandidate();
    if (bindBtn) {
      bindBtn.disabled = !(bindTargetViewId && initialCandidate);
    }
    if (addSelectedBtn) {
      addSelectedBtn.disabled = selectedModelIds.size === 0;
      addSelectedBtn.textContent =
        selectedModelIds.size > 0
          ? `Add Selected Models (${selectedModelIds.size})`
          : 'Add Selected Models';
    }
    if (bindBtn && !bindTargetViewId) {
      bindBtn.disabled = true;
    }
    if (bindBtn) {
      bindBtn.textContent = bindTargetViewId
        ? showBindTargetSelect
          ? 'Bind'
          : 'Bind Current'
        : 'Bind Disabled';
    }

    function resolveBindingCandidate() {
      const state = getGuideModelLinkState();
      const byId = new Map(state.selections.map(item => [item.id, item]));
      if (galleryMode === 'bind' && bindPreviewModelCode) {
        return {
          selectionId: '',
          code: bindPreviewModelCode,
          variant: bindVariantByCode[bindPreviewModelCode] || 'front',
        };
      }
      if (selectedModelIds.size === 1) {
        const selectionId = Array.from(selectedModelIds)[0];
        const selectedModel = byId.get(selectionId);
        if (!selectedModel) {
          return null;
        }
        return {
          selectionId: selectedModel.id,
          code: selectedModel.code,
          variant: selectedModel.variant,
        };
      }
      if (selectedCode) {
        return {
          selectionId: '',
          code: selectedCode,
          variant: selectedView,
        };
      }
      return null;
    }

    const syncBindActionState = () => {
      const candidate = resolveBindingCandidate();
      if (bindBtn) {
        bindBtn.disabled = !(bindTargetViewId && candidate);
      }
      const bindBtnPreview = galleryOverlay.querySelector('[data-link-action="bind-preview"]');
      if (bindBtnPreview) {
        bindBtnPreview.disabled = !(bindPreviewImageId && candidate);
      }
    };

    searchInput?.addEventListener('input', e => {
      query = String(e.target?.value || '');
      renderGallery();
    });

    toggleSearchBtn?.addEventListener('click', () => {
      searchVisible = !searchVisible;
      setWindowPrefs({ [GUIDE_GALLERY_SEARCH_PREF_KEY]: searchVisible });
      renderGallery();
    });

    modeButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = String(btn.getAttribute('data-gallery-mode') || '').trim();
        if (mode !== 'select' && mode !== 'bind') return;
        galleryMode = mode;
        if (galleryMode === 'bind' && selectedModelIds.size > 1) {
          selectedModelIds = new Set(Array.from(selectedModelIds).slice(0, 1));
        }
        renderGallery();
      });
    });

    togglePanelBtn?.addEventListener('click', () => {
      panelHidden = !panelHidden;
      if (panelHidden) {
        autoCompactHeader = false;
      }
      setWindowPrefs({ [GUIDE_GALLERY_PANEL_HIDDEN_PREF_KEY]: panelHidden });
      syncHeaderCompactMode();
    });

    closeBtn?.addEventListener('click', hideGuideGallery);

    bindTargetSelect?.addEventListener('change', e => {
      bindTargetViewId = String(e.target?.value || '').trim();
      syncBindActionState();
    });

    bindFrameTargetSelect?.addEventListener('change', e => {
      bindPreviewFrameTarget = String(e.target?.value || 'active').trim() || 'active';
      bindScopeMode = bindPreviewFrameTarget === 'all' ? 'image' : 'frame';
      refreshBindPreviewDom();
      syncBindActionState();
    });

    bindModelViewSelect?.addEventListener('change', e => {
      const nextView = String(e.target?.value || '')
        .trim()
        .toLowerCase();
      if (!bindPreviewModelCode || !nextView) return;
      bindVariantByCode[bindPreviewModelCode] = nextView;
      refreshBindPreviewDom();
      syncBindActionState();
    });

    loadCurrentBtn?.addEventListener('click', async event => {
      event.preventDefault();
      if (!selectedCode) return;
      loadCurrentBtn.disabled = true;
      const originalText = loadCurrentBtn.textContent;
      loadCurrentBtn.textContent = 'Loading...';
      try {
        await applyGuideAsBackground(selectedCode, selectedView);
      } catch (error) {
        setStatusMessage(
          `Failed to load ${selectedCode} ${selectedView.toUpperCase()} into current image.`,
          'error'
        );
        console.error('[Guide] Load current failed:', error);
      } finally {
        loadCurrentBtn.disabled = false;
        loadCurrentBtn.textContent = originalText || 'Load Current';
      }
    });

    addImageBtn?.addEventListener('click', async event => {
      event.preventDefault();
      if (!selectedCode) return;
      addImageBtn.disabled = true;
      const originalText = addImageBtn.textContent;
      addImageBtn.textContent = 'Adding...';
      try {
        const label = await addGuideAsNewImage(selectedCode, selectedView, { switchToNew: true });
        setStatusMessage(`Added ${label} image from ${selectedCode} ${selectedView}.`, 'success');
      } catch (error) {
        setStatusMessage(`Failed to add ${selectedCode} ${selectedView} as image.`, 'error');
        console.error('[Guide] Add image failed:', error);
      } finally {
        addImageBtn.disabled = false;
        addImageBtn.textContent = originalText || 'Add Image';
      }
    });

    addAllBtn?.addEventListener('click', async event => {
      event.preventDefault();
      if (!selectedCode) return;
      addAllBtn.disabled = true;
      const originalText = addAllBtn.textContent;
      addAllBtn.textContent = 'Adding...';
      const added = [];
      const failed = [];
      for (const view of availableViewsForCode(selectedCode, viewsByCode)) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const label = await addGuideAsNewImage(selectedCode, view, { switchToNew: false });
          added.push(label);
        } catch {
          failed.push(view);
        }
      }
      if (added.length && window.app?.projectManager?.switchView) {
        try {
          await window.app.projectManager.switchView(added[0], true);
        } catch {
          // no-op
        }
      }
      if (added.length) {
        setStatusMessage(`Added ${added.length} image(s): ${added.join(', ')}`, 'success');
      }
      if (failed.length) {
        setStatusMessage(
          `Failed to add ${failed.join(', ').toUpperCase()} for ${selectedCode}.`,
          'warning'
        );
      }
      addAllBtn.disabled = false;
      addAllBtn.textContent = originalText || 'Add Front/Back/Side';
    });

    addSelectedBtn?.addEventListener('click', async event => {
      event.preventDefault();
      if (selectedModelIds.size === 0) return;
      addSelectedBtn.disabled = true;
      const originalText = addSelectedBtn.textContent;
      addSelectedBtn.textContent = 'Adding selected...';
      const state = getGuideModelLinkState();
      const byId = new Map(state.selections.map(item => [item.id, item]));
      const added = [];
      const failed = [];
      for (const selectionId of selectedModelIds) {
        const model = byId.get(selectionId);
        if (!model) continue;
        try {
          // eslint-disable-next-line no-await-in-loop
          const imageId = await addGuideAsNewImage(model.code, model.variant, {
            switchToNew: false,
          });
          added.push(imageId);
        } catch {
          failed.push(`${model.code} ${model.variant.toUpperCase()}`);
        }
      }
      if (added.length && window.app?.projectManager?.switchView) {
        try {
          await window.app.projectManager.switchView(added[0], true);
        } catch {
          // no-op
        }
      }
      if (added.length) {
        setStatusMessage(`Added ${added.length} selected model image(s).`, 'success');
      }
      if (failed.length) {
        setStatusMessage(`Failed: ${failed.join(', ')}`, 'warning');
      }
      addSelectedBtn.disabled = false;
      addSelectedBtn.textContent = originalText || 'Add Selected Models';
      renderGallery();
    });

    bindBtn?.addEventListener('click', event => {
      event.preventDefault();
      if (!bindTargetViewId) {
        setStatusMessage('Add an image first, then bind to that image.', 'warning');
        return;
      }

      const candidate = resolveBindingCandidate();
      if (!candidate) {
        setStatusMessage('Select a model card or exactly one queued model to bind.', 'warning');
        return;
      }

      bindCodeToTarget(
        candidate.code,
        bindTargetViewId,
        candidate.variant,
        candidate.selectionId,
        bindScopeMode
      );
      renderSelectionLists();
      syncBindActionState();
    });

    galleryOverlay.onclick = async event => {
      const actionBtn = event.target?.closest?.('[data-link-action]');
      if (actionBtn) {
        const action = String(actionBtn.getAttribute('data-link-action') || '').trim();
        const imageId = String(actionBtn.getAttribute('data-image-id') || '').trim();

        if (action === 'unlink') {
          if (!imageId) return;
          const scopeId =
            bindScopeMode === 'frame' ? getFrameScopeIdForView(imageId) || imageId : imageId;
          unlinkScopeModel(scopeId);
          setStatusMessage(`Unlinked model from ${imageId}.`, 'success');
          renderSelectionLists();
          syncBindActionState();
          return;
        }

        if (action === 'bind') {
          if (!imageId) return;
          const candidate = resolveBindingCandidate();
          if (!candidate) {
            setStatusMessage('Select a model card or exactly one queued model to bind.', 'warning');
            return;
          }
          bindCodeToTarget(
            candidate.code,
            imageId,
            candidate.variant,
            candidate.selectionId,
            bindScopeMode
          );
          renderSelectionLists();
          syncBindActionState();
          return;
        }

        if (action === 'bind-preview') {
          const candidate = resolveBindingCandidate();
          if (!candidate || !bindPreviewImageId) {
            setStatusMessage('Select one model and one image in Bind Mode first.', 'warning');
            return;
          }
          bindCodeToTarget(
            candidate.code,
            bindPreviewImageId,
            candidate.variant,
            candidate.selectionId,
            bindScopeMode
          );
          renderSelectionLists();
          refreshBindPreviewDom();
          syncBindActionState();
          return;
        }

        if (action === 'unlink-preview') {
          if (!bindPreviewImageId) return;
          const scopeId =
            bindScopeMode === 'frame'
              ? getFrameScopeIdForView(bindPreviewImageId) || bindPreviewImageId
              : bindPreviewImageId;
          unlinkScopeModel(scopeId);
          setStatusMessage(`Unlinked model from ${bindPreviewImageId}.`, 'success');
          renderSelectionLists();
          refreshBindPreviewDom();
          syncBindActionState();
          return;
        }
      }

      const previewImageBtn = event.target?.closest?.('[data-bind-preview-image]');
      if (previewImageBtn) {
        const imageStrip = previewImageBtn.closest('.guide-gallery-bind-strip');
        const imageStripScrollTop = imageStrip?.scrollTop || 0;
        const imageStripScrollLeft = imageStrip?.scrollLeft || 0;
        const imageId = String(
          previewImageBtn.getAttribute('data-bind-preview-image') || ''
        ).trim();
        if (!imageId) return;
        bindPreviewImageId = imageId;
        if (window.app?.projectManager?.switchView) {
          window.app.projectManager.switchView(imageId, true).catch(() => {});
        }
        const state = getGuideModelLinkState();
        const byId = new Map(state.selections.map(item => [item.id, item]));
        const linkedSelectionId =
          state.linksByScope[resolveScopeIdForImage(imageId)] ||
          state.linksByScope[imageId] ||
          state.linksByImage[imageId] ||
          '';
        const linkedSelection = linkedSelectionId ? byId.get(linkedSelectionId) : null;
        if (linkedSelection?.code) {
          bindPreviewModelCode = linkedSelection.code;
          bindVariantByCode[linkedSelection.code] = linkedSelection.variant;
        }
        refreshBindPreviewDom();
        syncBindActionState();
        requestAnimationFrame(() => {
          if (imageStrip) {
            imageStrip.scrollTop = imageStripScrollTop;
            imageStrip.scrollLeft = imageStripScrollLeft;
          }
        });
        return;
      }

      const previewSelectionBtn = event.target?.closest?.('[data-bind-preview-selection]');
      if (previewSelectionBtn) {
        const selectionStrip = previewSelectionBtn.closest('.guide-gallery-bind-strip');
        const selectionStripScrollTop = selectionStrip?.scrollTop || 0;
        const selectionStripScrollLeft = selectionStrip?.scrollLeft || 0;
        const modelCode = String(
          previewSelectionBtn.getAttribute('data-bind-preview-selection') || ''
        ).trim();
        if (!modelCode) return;
        bindPreviewModelCode = modelCode;
        refreshBindPreviewDom();
        syncBindActionState();
        requestAnimationFrame(() => {
          if (selectionStrip) {
            selectionStrip.scrollTop = selectionStripScrollTop;
            selectionStrip.scrollLeft = selectionStripScrollLeft;
          }
        });
      }
    };

    galleryOverlay.onmousedown = event => {
      const stripButton = event.target?.closest?.(
        '[data-bind-preview-image], [data-bind-preview-selection]'
      );
      if (!stripButton) return;
      event.preventDefault();
    };

    galleryOverlay.querySelectorAll('.guide-gallery-item').forEach(item => {
      item.addEventListener('click', event => {
        if (event.target?.closest('[data-select-code]')) return;
        if (event.target?.closest('.guide-gallery-item-label')) return;
        const code = item.getAttribute('data-code');
        if (!code) return;
        selectedCode = code;
        const views = availableViewsForCode(code, viewsByCode);
        if (!views.includes(selectedView)) {
          selectedView = views[0] || 'front';
        }
        renderGallery();
      });
    });

    galleryOverlay.querySelectorAll('[data-select-code]').forEach(input => {
      input.addEventListener('click', event => {
        event.stopPropagation();
      });
      input.addEventListener('change', () => {
        const code = input.getAttribute('data-select-code') || '';
        if (!code) return;
        const availableViews = availableViewsForCode(code, viewsByCode);
        const variant = availableViews.includes(bindVariantByCode[code])
          ? bindVariantByCode[code]
          : availableViews[0] || 'front';
        bindVariantByCode[code] = variant;
        if (input.checked === true) {
          const selection = upsertModelSelection(code, variant);
          if (!selection) return;
          selectedModelIds.add(selection.id);
          // In bind mode, newly queued models should become the active bind candidate.
          // Otherwise subsequent frame bindings can silently reuse the previous code
          // while only changing the variant.
          if (galleryMode === 'bind' || !bindPreviewModelCode) {
            bindPreviewModelCode = code;
          }
        } else {
          const state = getGuideModelLinkState();
          const matches = state.selections.filter(item => item.code === normalizeCode(code));
          matches.forEach(item => {
            selectedModelIds.delete(item.id);
            removeModelSelection(item.id);
          });
          if (bindPreviewModelCode === normalizeCode(code)) {
            bindPreviewModelCode = '';
          }
        }
        renderSelectionLists();
      });
    });

    attachGuideImageRecovery(galleryOverlay);
    renderSelectionLists();
    syncBindActionState();
    syncHeaderCompactMode();
    const chromeEl = galleryOverlay.querySelector('.guide-gallery-chrome');
    chromeEl?.addEventListener('mouseenter', () => {
      if (panelHidden) return;
      autoCompactHeader = false;
      syncHeaderCompactMode();
    });
    chromeEl?.addEventListener('mouseleave', () => {
      if (panelHidden) return;
      autoCompactHeader = galleryOverlay.scrollTop > 72;
      syncHeaderCompactMode();
    });
    galleryOverlay.onscroll = () => {
      if (panelHidden) return;
      autoCompactHeader = galleryOverlay.scrollTop > 72;
      syncHeaderCompactMode();
    };
  };

  renderGallery();
  fetchAvailableGuideCodes(fallbackCodes)
    .then(result => {
      const codes = Array.isArray(result?.codes) ? result.codes : [];
      if (!codes.length) return;
      allCodes = codes;
      viewsByCode =
        result?.viewsByCode && typeof result.viewsByCode === 'object' ? result.viewsByCode : {};
      if (galleryOverlay) {
        const selectedViews = availableViewsForCode(selectedCode, viewsByCode);
        if (!selectedViews.includes(selectedView)) {
          selectedView = selectedViews[0] || 'front';
        }
        renderGallery();
      }
    })
    .catch(() => {
      // fallback list already rendered
    });
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

  // Shift+\ = Cycle bound guide in the right pane when split is open
  if (event.shiftKey && !event.repeat) {
    if (!guideSplitEnabled) {
      setGuideSplitEnabled(true);
      return;
    }
    const currentViewId = toBaseViewId(guideCompareWorkspaceState.leftViewId || getCurrentViewId());
    const slides = resolveFlashSlidesForImage(currentViewId);
    if (!slides.length) {
      void ensureGuideSplitDefaultRightView();
      return;
    }
    activeIndex = (activeIndex + 1) % slides.length;
    const nextSlide = slides[activeIndex];
    const tempViewId = buildGuideSplitTempViewId({
      code: nextSlide.code,
      variant: nextSlide.view,
    });
    if (!tempViewId) return;
    void setGuideSplitRightView(tempViewId, 'bound-guide');
    return;
  }

  // \ (no modifiers) = Toggle split workspace
  if (!event.repeat) {
    setGuideSplitEnabled(!guideSplitEnabled);
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

  showGuideFlash({ holdMode: true, preservePinnedContext: false });
}

export function initMeasurementGuideFlash() {
  ensureStyles();
  guideCompareWorkspaceState.leftViewId = toBaseViewId(getCurrentViewId());
  refreshGuideSplitInteractionGuards();
  void applyGuideSplitLayout();

  window.addEventListener('keydown', onKeyDown, { passive: false });
  window.addEventListener('keyup', onKeyUp, { passive: false });
  window.setInterval(syncGuideOverlayToActiveView, 700);
  window.setInterval(() => {
    void syncGuideSplitToActiveView();
  }, 900);

  window.addEventListener('openpaint:guide-binding-changed', () => {
    if (guideSplitEnabled) {
      if (guideCompareWorkspaceState.rightSourceKind === 'bound-guide') {
        clearTimeout(_bindingChangedTimeout);
        _bindingChangedTimeout = setTimeout(() => {
          void ensureGuideSplitDefaultRightView();
        }, 100);
      } else {
        renderGuideSplitPane();
      }
    }
  });

  window.addEventListener('openpaint:guide-next-tag-changed', event => {
    if (!guideSplitEnabled || guideCompareWorkspaceState.rightSourceKind !== 'bound-guide') {
      return;
    }
    const eventViewId = toBaseViewId(event?.detail?.viewId || '');
    const eventTag = normalizeRoleToken(event?.detail?.tag || '');
    const eventKey = `${eventViewId || guideCompareWorkspaceState.leftViewId || ''}::${eventTag || 'none'}::${guideCompareWorkspaceState.rightViewId || ''}`;
    if (eventKey === _lastProcessedGuideNextTagEventKey) {
      return;
    }
    _lastProcessedGuideNextTagEventKey = eventKey;
    const parsedGuide = parseGuideSplitTempViewId(guideCompareWorkspaceState.rightViewId);
    if (!parsedGuide) return;
    void updateGuideSplitHighlightOverlay(parsedGuide);
    window.setTimeout(() => {
      refreshGuideSplitTagHighlightsFromUi();
    }, 80);
  });

  window.addEventListener('openpaint:guide-split-transition-start', () => {
    if (guideSplitEnabled) {
      setGuideSplitTransitionPending(true);
    }
  });

  window.addEventListener('openpaint:view-switched', event => {
    if (!guideSplitEnabled || guideSplitSyncingWorkspace || guideSplitSuppressViewSwitchSync > 0) {
      return;
    }
    const nextViewId = toBaseViewId(event?.detail?.viewId || '');
    if (!nextViewId) return;

    guideCompareWorkspaceState.leftViewId = nextViewId;
    captureGuideSplitRestoreSnapshot(nextViewId);
    if (guideCompareWorkspaceState.rightSourceKind === 'bound-guide') {
      void ensureGuideSplitDefaultRightView();
    } else {
      renderGuideSplitPane();
    }
    scheduleGuideSplitLayoutSync({ settle: false });
  });

  window.addEventListener('openpaint:frame-tab-changed', () => {
    if (!guideSplitEnabled || guideSplitSyncingWorkspace || guideSplitSuppressViewSwitchSync > 0) {
      return;
    }
    void syncGuideSplitToActiveView();
  });

  window.addEventListener('resize', () => {
    if (flashOverlay?.classList.contains('visible')) {
      const rect = getFlashRect();
      if (rect) {
        setFlashRect(clampFlashRect(rect));
      }
      applyFlashWindowLayout(flashOverlay);
    }
    if (guideSplitEnabled) {
      scheduleGuideSplitLayoutSync({ settle: true });
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && guideSplitEnabled) {
      scheduleGuideSplitLayoutSync({ settle: true });
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
    if (e.key === 'Escape' && guideSplitEnabled) {
      setGuideSplitEnabled(false);
      return;
    }
    if (e.key === 'Escape' && flashOverlay?.classList.contains('visible')) {
      isGuidePinnedVisible = false;
      hideGuideFlash();
    }
  });

  window.openMeasurementGuideGallery = options => {
    gallerySelectHandler = options?.onSelect || null;
    showGuideGallery(options || {});
  };
  window.openGuideBindingPanel = options => {
    openGuideBindingPanel(options || {});
  };
  window.resolveGuideModelBindingForView = viewId => resolveModelBindingForView(viewId);
  window.resolveActiveGuideForView = viewId => resolveActiveGuideForView(viewId);
  window.getGuideSplitStateForView = viewId =>
    getGuideSplitStateForView(viewId || getCurrentViewId());
  window.setGuideSplitEnabled = enabled => {
    setGuideSplitEnabled(enabled);
    return guideSplitEnabled;
  };
  window.toggleGuideSplitEnabled = () => {
    setGuideSplitEnabled(!guideSplitEnabled);
    return guideSplitEnabled;
  };
  window.getGuideCompareWorkspaceState = () => ({ ...guideCompareWorkspaceState });
  window.__prepareGuideSvgForRaster = (svgText, options = {}) =>
    prepareSvgForRaster(svgText, options);
  window.dispatchEvent(new Event('openpaint:guide-split-changed'));
}

export function openMeasurementGuideGallery(options = {}) {
  gallerySelectHandler = options?.onSelect || null;
  showGuideGallery(options || {});
}
