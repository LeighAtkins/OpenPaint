export type MeasurementSplitWorkspaceMode = 'guide-compare' | 'measurement-edit';

export interface MeasurementSplitPanelMountSnapshot {
  parentElement: HTMLElement | null;
  nextSibling: ChildNode | null;
  panelClassName: string;
  panelStyleText: string | null;
  panelAriaExpanded: string | null;
  elementsBodyClassName: string | null;
  elementsBodyStyleText: string | null;
}

export interface MeasurementSplitWorkspaceState {
  activeMode: MeasurementSplitWorkspaceMode;
  activeImportedViewId: string;
  savedPanelMount: MeasurementSplitPanelMountSnapshot | null;
  lockOverrideActive: boolean;
}

declare global {
  interface Window {
    getGuideSplitStateForView?: (viewId?: string) => { enabled?: boolean } | null;
    setGuideSplitEnabled?: (enabled: boolean) => boolean;
    getMeasurementSplitWorkspaceState?: () => MeasurementSplitWorkspaceState;
    openMeasurementSplitWorkspace?: (viewId: string) => boolean;
    closeMeasurementSplitWorkspace?: () => boolean;
    resetMeasurementSplitWorkspace?: () => void;
    mountMeasurementSplitStrokePanel?: () => boolean;
    restoreMeasurementSplitStrokePanel?: () => boolean;
    isMeasurementSplitWorkspaceActive?: () => boolean;
    shouldAllowMeasurementSplitEdit?: (scopeLabel: string, strokeLabel?: string) => boolean;
  }
}

const workspaceState: MeasurementSplitWorkspaceState = {
  activeMode: 'guide-compare',
  activeImportedViewId: '',
  savedPanelMount: null,
  lockOverrideActive: false,
};

let initialized = false;
let mountSyncObserver: MutationObserver | null = null;
let pendingMountSyncRaf = 0;
const pendingMountSyncTimers = new Set<number>();
const VALID_TEXT_BASELINES = new Set([
  'top',
  'hanging',
  'middle',
  'alphabetic',
  'ideographic',
  'bottom',
]);

function getGuideSplitEnabled(viewId = ''): boolean {
  try {
    const fromApi = window.getGuideSplitStateForView?.(viewId || undefined)?.enabled;
    if (typeof fromApi === 'boolean') return fromApi;
  } catch {
    // Ignore legacy bridge failures and fall back to DOM state.
  }
  return (
    document.getElementById('main-canvas-wrapper')?.classList.contains('guide-split-active') ===
    true
  );
}

function getCanonicalScopeLabel(scopeLabel: string): string {
  const raw = String(scopeLabel || '').trim();
  if (!raw) return '';
  const normalized = (window as any).app?.metadataManager?.normalizeImageLabel?.(raw);
  return String(normalized || raw).trim();
}

function scopeMatchesActiveWorkspace(scopeLabel: string): boolean {
  const activeScope = getCanonicalScopeLabel(workspaceState.activeImportedViewId);
  const candidateScope = getCanonicalScopeLabel(scopeLabel);
  if (!activeScope || !candidateScope) return false;
  return (
    candidateScope === activeScope ||
    candidateScope.startsWith(`${activeScope}::tab:`) ||
    activeScope.startsWith(`${candidateScope}::tab:`)
  );
}

function syncWorkspaceBodyClass(): void {
  const isActive = workspaceState.activeMode === 'measurement-edit' && getGuideSplitEnabled();
  document.body.classList.toggle('measurement-split-workspace-active', isActive);
}

function refreshStrokeControls(): void {
  (window as any).app?.metadataManager?.updateStrokeVisibilityControls?.();
}

function clearPendingMountSync(): void {
  if (pendingMountSyncRaf) {
    window.cancelAnimationFrame(pendingMountSyncRaf);
    pendingMountSyncRaf = 0;
  }
  pendingMountSyncTimers.forEach(timerId => window.clearTimeout(timerId));
  pendingMountSyncTimers.clear();
}

function sanitizeTextBaselineObject(target: any): void {
  if (!target || typeof target !== 'object') return;

  if (typeof target.textBaseline === 'string' && !VALID_TEXT_BASELINES.has(target.textBaseline)) {
    target.textBaseline = 'middle';
    if (typeof target.set === 'function') {
      target.set('textBaseline', 'middle');
    }
    target.dirty = true;
    target.setCoords?.();
  }

  if (Array.isArray(target._objects)) {
    target._objects.forEach((child: any) => sanitizeTextBaselineObject(child));
  }
}

function sanitizeActiveCanvasTextBaselines(): void {
  const fabricCanvas = (window as any).app?.canvasManager?.fabricCanvas || null;
  const objects = fabricCanvas?.getObjects?.() || [];
  let changed = false;

  objects.forEach((object: any) => {
    const before = object?.textBaseline;
    sanitizeTextBaselineObject(object);
    if (object?.textBaseline !== before) {
      changed = true;
    }
  });

  if (changed) {
    fabricCanvas?.requestRenderAll?.();
  }
}

function getStrokePanelElements(): {
  strokePanel: HTMLElement | null;
  elementsBody: HTMLElement | null;
} {
  return {
    strokePanel: document.getElementById('strokePanel'),
    elementsBody: document.getElementById('elementsBody'),
  };
}

function createPanelMountSnapshot(): MeasurementSplitPanelMountSnapshot | null {
  const { strokePanel, elementsBody } = getStrokePanelElements();
  if (!strokePanel) return null;
  return {
    parentElement: strokePanel.parentElement,
    nextSibling: strokePanel.nextSibling,
    panelClassName: strokePanel.className,
    panelStyleText: strokePanel.getAttribute('style'),
    panelAriaExpanded: strokePanel.getAttribute('aria-expanded'),
    elementsBodyClassName: elementsBody?.className || null,
    elementsBodyStyleText: elementsBody?.getAttribute('style') || null,
  };
}

function restoreAttributeValue(
  element: HTMLElement,
  attributeName: string,
  value: string | null
): void {
  if (value === null) {
    element.removeAttribute(attributeName);
    return;
  }
  element.setAttribute(attributeName, value);
}

function expandStrokePanelForWorkspace(
  strokePanel: HTMLElement,
  elementsBody: HTMLElement | null
): void {
  strokePanel.classList.add('measurement-split-mounted');
  strokePanel.classList.remove('collapsed', 'minimized');
  strokePanel.setAttribute('aria-expanded', 'true');
  strokePanel.setAttribute('style', '');
  strokePanel.style.display = 'flex';
  strokePanel.style.flexDirection = 'column';
  strokePanel.style.position = 'relative';
  strokePanel.style.left = 'auto';
  strokePanel.style.right = 'auto';
  strokePanel.style.top = 'auto';
  strokePanel.style.bottom = 'auto';
  strokePanel.style.width = '100%';
  strokePanel.style.height = '100%';
  strokePanel.style.maxHeight = 'none';
  strokePanel.style.opacity = '1';
  strokePanel.style.visibility = 'visible';
  strokePanel.style.pointerEvents = 'auto';
  strokePanel.style.zIndex = '1';

  if (elementsBody) {
    elementsBody.classList.remove('hidden');
    elementsBody.setAttribute('style', '');
    elementsBody.style.display = 'flex';
    elementsBody.style.flexDirection = 'column';
    elementsBody.style.maxHeight = 'none';
    elementsBody.style.opacity = '1';
    elementsBody.style.visibility = 'visible';
  }

  const toggleIcon = document.querySelector('#toggleStrokePanel svg') as HTMLElement | null;
  if (toggleIcon) {
    toggleIcon.style.transform = '';
  }
}

function dispatchWorkspaceChange(): void {
  syncWorkspaceBodyClass();
  window.dispatchEvent(new Event('openpaint:measurement-split-workspace-change'));
}

function ensureMountSyncObserver(): void {
  if (mountSyncObserver || typeof MutationObserver === 'undefined') return;

  mountSyncObserver = new MutationObserver(() => {
    if (!isMeasurementSplitWorkspaceActive()) return;
    scheduleMeasurementSplitMountSync();
  });

  mountSyncObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'aria-expanded'],
  });
}

function teardownMountSyncObserver(): void {
  mountSyncObserver?.disconnect();
  mountSyncObserver = null;
  clearPendingMountSync();
}

function scheduleMeasurementSplitMountSync(): void {
  if (!isMeasurementSplitWorkspaceActive()) return;
  clearPendingMountSync();

  const runSync = () => {
    if (!isMeasurementSplitWorkspaceActive()) return;
    sanitizeActiveCanvasTextBaselines();
  };

  pendingMountSyncRaf = window.requestAnimationFrame(() => {
    pendingMountSyncRaf = 0;
    runSync();
  });

  [40, 140, 320].forEach(delayMs => {
    const timerId = window.setTimeout(() => {
      pendingMountSyncTimers.delete(timerId);
      runSync();
    }, delayMs);
    pendingMountSyncTimers.add(timerId);
  });
}

export function getMeasurementSplitWorkspaceState(): MeasurementSplitWorkspaceState {
  return {
    ...workspaceState,
    savedPanelMount: workspaceState.savedPanelMount,
  };
}

export function isMeasurementSplitWorkspaceActive(): boolean {
  return workspaceState.activeMode === 'measurement-edit' && workspaceState.lockOverrideActive;
}

export function shouldAllowMeasurementSplitEdit(scopeLabel: string, _strokeLabel = ''): boolean {
  if (!isMeasurementSplitWorkspaceActive()) return false;
  return scopeMatchesActiveWorkspace(scopeLabel);
}

export function mountMeasurementSplitStrokePanel(): boolean {
  if (!isMeasurementSplitWorkspaceActive()) return false;

  const host = document.getElementById('guideSplitMeasurementEditorHost');
  const { strokePanel, elementsBody } = getStrokePanelElements();
  if (!host || !strokePanel) return false;

  sanitizeActiveCanvasTextBaselines();

  if (
    !workspaceState.savedPanelMount ||
    workspaceState.savedPanelMount.parentElement === host ||
    !workspaceState.savedPanelMount.parentElement?.isConnected
  ) {
    workspaceState.savedPanelMount = createPanelMountSnapshot();
  }

  if (strokePanel.parentElement !== host) {
    host.appendChild(strokePanel);
  }

  expandStrokePanelForWorkspace(strokePanel, elementsBody);
  syncWorkspaceBodyClass();
  refreshStrokeControls();
  return true;
}

export function restoreMeasurementSplitStrokePanel(): boolean {
  const snapshot = workspaceState.savedPanelMount;
  const { strokePanel, elementsBody } = getStrokePanelElements();

  if (!snapshot || !strokePanel) {
    syncWorkspaceBodyClass();
    return false;
  }

  strokePanel.classList.remove('measurement-split-mounted');
  strokePanel.className = snapshot.panelClassName;
  restoreAttributeValue(strokePanel, 'style', snapshot.panelStyleText);
  restoreAttributeValue(strokePanel, 'aria-expanded', snapshot.panelAriaExpanded);

  if (snapshot.parentElement?.isConnected) {
    if (snapshot.nextSibling?.parentNode === snapshot.parentElement) {
      snapshot.parentElement.insertBefore(strokePanel, snapshot.nextSibling);
    } else {
      snapshot.parentElement.appendChild(strokePanel);
    }
  }

  if (elementsBody) {
    if (snapshot.elementsBodyClassName !== null) {
      elementsBody.className = snapshot.elementsBodyClassName;
    }
    restoreAttributeValue(elementsBody, 'style', snapshot.elementsBodyStyleText);
  }

  workspaceState.savedPanelMount = null;
  syncWorkspaceBodyClass();
  refreshStrokeControls();
  return true;
}

export function resetMeasurementSplitWorkspace(): void {
  workspaceState.activeMode = 'guide-compare';
  workspaceState.activeImportedViewId = '';
  workspaceState.lockOverrideActive = false;
  teardownMountSyncObserver();
  restoreMeasurementSplitStrokePanel();
  dispatchWorkspaceChange();
}

export function openMeasurementSplitWorkspace(viewId: string): boolean {
  const nextViewId =
    getCanonicalScopeLabel(viewId) ||
    getCanonicalScopeLabel((window as any).app?.projectManager?.currentViewId || '') ||
    String(viewId || '').trim();

  workspaceState.activeMode = 'measurement-edit';
  workspaceState.activeImportedViewId = nextViewId;
  workspaceState.lockOverrideActive = true;
  dispatchWorkspaceChange();
  sanitizeActiveCanvasTextBaselines();

  if (!getGuideSplitEnabled(nextViewId)) {
    window.setGuideSplitEnabled?.(true);
  }

  return true;
}

export function closeMeasurementSplitWorkspace(): boolean {
  const splitWasEnabled = getGuideSplitEnabled(workspaceState.activeImportedViewId);
  if (splitWasEnabled) {
    window.setGuideSplitEnabled?.(false);
    return true;
  }
  resetMeasurementSplitWorkspace();
  return true;
}

export function initMeasurementSplitWorkspace(): void {
  if (initialized) return;
  initialized = true;

  window.getMeasurementSplitWorkspaceState = getMeasurementSplitWorkspaceState;
  window.openMeasurementSplitWorkspace = openMeasurementSplitWorkspace;
  window.closeMeasurementSplitWorkspace = closeMeasurementSplitWorkspace;
  window.resetMeasurementSplitWorkspace = resetMeasurementSplitWorkspace;
  window.mountMeasurementSplitStrokePanel = mountMeasurementSplitStrokePanel;
  window.restoreMeasurementSplitStrokePanel = restoreMeasurementSplitStrokePanel;
  window.isMeasurementSplitWorkspaceActive = isMeasurementSplitWorkspaceActive;
  window.shouldAllowMeasurementSplitEdit = shouldAllowMeasurementSplitEdit;
}
