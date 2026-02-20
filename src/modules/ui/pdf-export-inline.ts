// PDF export utilities (inline version)
/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-misused-promises, @typescript-eslint/prefer-regexp-exec, @typescript-eslint/unbound-method, prefer-rest-params */
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
// Extracted from index.html inline scripts
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { buildImageExportFilename, sanitizeFilenamePart } from '../utils/naming-utils.js';

function toBaseViewId(scopeOrViewId) {
  const raw = String(scopeOrViewId || '');
  return raw.split('::tab:')[0] || raw;
}

function getTabIdFromScopedLabel(scopeOrViewId) {
  const raw = String(scopeOrViewId || '');
  const marker = '::tab:';
  const idx = raw.indexOf(marker);
  if (idx < 0) return null;
  const tabId = raw.slice(idx + marker.length).trim();
  return tabId || null;
}

function enforceScopedTabContext(viewId, scopedLabel) {
  const scopedTabId = getTabIdFromScopedLabel(scopedLabel || '');
  if (!viewId || !scopedTabId) {
    return { enforced: false, reason: 'missing-view-or-tab' };
  }

  if (typeof window.setActiveCaptureTab === 'function') {
    try {
      window.setActiveCaptureTab(viewId, scopedTabId, { skipSave: true });
    } catch (error) {
      return {
        enforced: false,
        reason: 'set-active-tab-failed',
        error: String(error?.message || error),
      };
    }
  }

  if (typeof window.syncCaptureTabCanvasVisibility === 'function') {
    try {
      window.syncCaptureTabCanvasVisibility(viewId);
    } catch (error) {
      return {
        enforced: false,
        reason: 'sync-visibility-failed',
        error: String(error?.message || error),
      };
    }
  }

  window.currentImageLabel = scopedLabel;
  window.app?.metadataManager?.updateStrokeVisibilityControls?.();
  window.app?.canvasManager?.fabricCanvas?.requestRenderAll?.();

  return { enforced: true, scopedTabId };
}

function getScopedMeasurements(scopeKey, options = {}) {
  const includeBase = options.includeBase === true;
  const allMeasurements = window.app?.metadataManager?.strokeMeasurements || {};
  const merged = {};
  const baseViewId = toBaseViewId(scopeKey);
  Object.entries(allMeasurements).forEach(([entryKey, bucket]) => {
    const inScope = entryKey === scopeKey;
    const isBase = includeBase && entryKey === baseViewId;
    if (!inScope && !isBase) {
      return;
    }
    Object.entries(bucket || {}).forEach(([strokeLabel, measurement]) => {
      if (!measurement || typeof measurement !== 'object') return;
      merged[strokeLabel] = measurement;
    });
  });
  return merged;
}

function getScopedStrokeLabels(scopeKey, options = {}) {
  const includeBase = options.includeBase === true;
  const strokeMap = window.app?.metadataManager?.vectorStrokesByImage || {};
  const baseViewId = toBaseViewId(scopeKey);
  const labels = new Set();
  Object.entries(strokeMap).forEach(([entryKey, bucket]) => {
    const inScope = entryKey === scopeKey;
    const isBase = includeBase && entryKey === baseViewId;
    if (!inScope && !isBase) {
      return;
    }
    Object.keys(bucket || {}).forEach(strokeLabel => labels.add(strokeLabel));
  });
  return Array.from(labels).sort((a, b) => a.localeCompare(b));
}

function getPdfNamingValues() {
  const metadata =
    window.app?.projectManager?.getProjectMetadata?.() || window.projectMetadata || {};
  const naming = metadata.naming || {};
  const readValue = selectors => {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (!el) continue;
      const value = typeof el.value === 'string' ? el.value.trim() : '';
      if (value) return value;
    }
    return '';
  };

  const customerName =
    readValue([
      '#projectNamingCustomer',
      '#customerName',
      '#pdfCustomerName',
      '[name="customerName"]',
    ]) || String(naming.customerName || '').trim();
  const sofaTypeLabel =
    readValue([
      '#projectNamingSofaType',
      '#sofaType',
      '#sofaTypeLabel',
      '#pdfSofaType',
      '[name="sofaTypeLabel"]',
    ]) || String(naming.sofaTypeLabel || '').trim();
  const jobDate =
    readValue(['#projectNamingDate', '#jobDate', '#pdfJobDate', '[name="jobDate"]']) ||
    String(naming.jobDate || '').trim();

  return { customerName, sofaTypeLabel, jobDate };
}

function buildPdfNamingLine() {
  const { customerName, sofaTypeLabel, jobDate } = getPdfNamingValues();
  return [customerName, sofaTypeLabel, jobDate].filter(Boolean).join('  |  ');
}

function getPdfPageTargets(viewIds) {
  const ensureTabs =
    typeof window.ensureCaptureTabsForLabel === 'function'
      ? window.ensureCaptureTabsForLabel
      : null;
  const states = window.captureTabsByLabel || {};
  const targets = [];

  viewIds.forEach((viewId, viewIndex) => {
    const state = ensureTabs ? ensureTabs(viewId) : states[viewId];
    const normalTabs = (state?.tabs || []).filter(tab => tab.type !== 'master');

    if (!normalTabs.length) {
      targets.push({
        viewId,
        viewIndex,
        tabId: null,
        tabName: 'Frame 1',
        scopeKey: viewId,
        includeBase: true,
      });
      return;
    }

    const primaryTabId = normalTabs[0].id;
    normalTabs.forEach((tab, tabIndex) => {
      const scopeKey =
        typeof window.getCaptureTabScopeForTab === 'function'
          ? window.getCaptureTabScopeForTab(viewId, tab.id)
          : `${viewId}::tab:${tab.id}`;
      targets.push({
        viewId,
        viewIndex,
        tabId: tab.id,
        tabName: tab.name || `Frame ${tabIndex + 1}`,
        scopeKey,
        includeBase: tab.id === primaryTabId,
      });
    });
  });

  return targets;
}

function getGroupedPdfPageTargets(pageTargets, pieceGroups, partLabels) {
  // Build a map: viewId -> array of targets for that view
  const targetsByView = {};
  pageTargets.forEach(target => {
    if (!targetsByView[target.viewId]) targetsByView[target.viewId] = [];
    targetsByView[target.viewId].push(target);
  });

  const consumed = new Set(); // viewId values consumed into grouped entries
  const grouped = [];

  // For each piece group, render one grouped page with:
  // - main view hero frame (first tab)
  // - all frames from each related view
  (pieceGroups || []).forEach(group => {
    const mainId = group.mainViewId;
    const relatedIds = Array.isArray(group.relatedViewIds) ? group.relatedViewIds : [];
    if (!mainId || consumed.has(mainId)) return;

    const mainTargets = targetsByView[mainId];
    if (!mainTargets?.length) return;

    const validRelatedIds = relatedIds.filter(
      id => id && id !== mainId && !consumed.has(id) && targetsByView[id]?.length
    );
    if (!validRelatedIds.length) {
      return;
    }

    const mainTarget = mainTargets[0];
    const relatedTargets = validRelatedIds.flatMap(id => targetsByView[id] || []);

    consumed.add(mainId);
    validRelatedIds.forEach(id => consumed.add(id));

    grouped.push({
      type: 'grouped',
      mainTarget,
      relatedTargets,
      note: group.label || '',
      partLabels: [
        partLabels[mainId] || `view-${String((mainTarget?.viewIndex || 0) + 1).padStart(2, '0')}`,
        ...validRelatedIds.map(id => {
          const firstTarget = (targetsByView[id] || [])[0];
          return (
            partLabels[id] || `view-${String((firstTarget?.viewIndex || 0) + 1).padStart(2, '0')}`
          );
        }),
      ],
    });
  });

  // Remaining unconsumed views become singles
  pageTargets.forEach(target => {
    if (!consumed.has(target.viewId)) {
      grouped.push({ type: 'single', target });
    }
  });

  return grouped;
}

function sanitizePdfFieldPart(value, fallback) {
  const cleaned = String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

function createUniquePdfFieldName(baseName, usedNames) {
  let candidate = baseName;
  let suffix = 1;
  while (usedNames.has(candidate)) {
    suffix += 1;
    candidate = `${baseName}_${suffix}`;
  }
  usedNames.add(candidate);
  return candidate;
}

function safePdfText(value) {
  return String(value || '').replace(/[^\x20-\x7E]/g, ' ');
}

function ensurePdfDebugSurface() {
  if (!Array.isArray(window.__pdfVectorDebugLog)) {
    window.__pdfVectorDebugLog = [];
  }
  window.__pdfVectorDebugReady = true;
  if (typeof window.dumpPdfVectorDebug !== 'function') {
    window.dumpPdfVectorDebug = function (count = 12) {
      const size = Number.isFinite(count) ? Math.max(1, count) : 12;
      return (window.__pdfVectorDebugLog || []).slice(-size);
    };
  }
}

ensurePdfDebugSurface();

function cloneSerializable(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function safelyDiscardActiveObject(canvas) {
  if (!canvas?.getActiveObject || !canvas?.discardActiveObject) {
    return;
  }
  try {
    if (canvas.getActiveObject()) {
      canvas.discardActiveObject();
    }
  } catch (error) {
    console.warn('[PDF] Failed to discard active object safely:', error);
  }
}

function buildVectorDebugSnapshot(label, extra = {}) {
  const canvas = window.app?.canvasManager?.fabricCanvas;
  const objects = canvas?.getObjects?.() || [];
  const vectorObjects = objects.filter(obj => {
    const type = String(obj?.type || '');
    return (
      type === 'line' ||
      type === 'path' ||
      type === 'polyline' ||
      type === 'polygon' ||
      obj?.strokeMetadata?.isVector === true ||
      obj?.customData?.isVectorStroke === true ||
      obj?.customData?.type === 'vector-stroke'
    );
  });

  const summarizeObj = obj => {
    const bbox =
      typeof obj?.getBoundingRect === 'function' ? obj.getBoundingRect(true, true) : null;
    return {
      id: obj?.id || obj?.strokeMetadata?.id || obj?.customData?.id || null,
      type: obj?.type || null,
      label: obj?.strokeMetadata?.label || obj?.customData?.label || null,
      imageLabel: obj?.strokeMetadata?.imageLabel || obj?.customData?.imageLabel || null,
      visible: obj?.visible !== false,
      opacity: typeof obj?.opacity === 'number' ? Number(obj.opacity.toFixed(3)) : null,
      left: typeof obj?.left === 'number' ? Number(obj.left.toFixed(2)) : null,
      top: typeof obj?.top === 'number' ? Number(obj.top.toFixed(2)) : null,
      angle: typeof obj?.angle === 'number' ? Number(obj.angle.toFixed(2)) : null,
      scaleX: typeof obj?.scaleX === 'number' ? Number(obj.scaleX.toFixed(4)) : null,
      scaleY: typeof obj?.scaleY === 'number' ? Number(obj.scaleY.toFixed(4)) : null,
      width: bbox?.width ? Number(bbox.width.toFixed(2)) : null,
      height: bbox?.height ? Number(bbox.height.toFixed(2)) : null,
    };
  };

  const viewport = window.app?.canvasManager?.getViewportState?.() || null;
  const rotation = window.app?.canvasManager?.getRotationDegrees?.();
  const activeObj = canvas?.getActiveObject?.() || null;

  return {
    label,
    timestamp: new Date().toISOString(),
    currentViewId: window.app?.projectManager?.currentViewId || null,
    currentImageLabel: window.currentImageLabel || null,
    objectCount: objects.length,
    vectorCount: vectorObjects.length,
    activeObjectType: activeObj?.type || null,
    viewport,
    rotation: typeof rotation === 'number' ? rotation : null,
    viewportTransform: Array.isArray(canvas?.viewportTransform)
      ? canvas.viewportTransform.map(value =>
          typeof value === 'number' ? Number(value.toFixed(5)) : value
        )
      : null,
    sampleVectors: vectorObjects.slice(0, 12).map(summarizeObj),
    extra,
  };
}

function logVectorDebugSnapshot(label, extra = {}) {
  try {
    const snapshot = buildVectorDebugSnapshot(label, extra);
    const existing = Array.isArray(window.__pdfVectorDebugLog) ? window.__pdfVectorDebugLog : [];
    existing.push(snapshot);
    if (existing.length > 240) {
      existing.shift();
    }
    window.__pdfVectorDebugLog = existing;
    window.dispatchEvent(
      new CustomEvent('openpaint:pdf-vector-debug', {
        detail: snapshot,
      })
    );
    console.groupCollapsed(
      `[PDF Vector Debug] ${label} | view=${snapshot.currentViewId || '-'} | vectors=${snapshot.vectorCount}`
    );
    console.log(snapshot);
    console.groupEnd();
  } catch (error) {
    console.warn('[PDF Vector Debug] Failed to capture snapshot:', error);
  }
}

function getObjectRestoreKey(obj, index = 0) {
  const imageLabel =
    obj?.strokeMetadata?.imageLabel || obj?.customData?.imageLabel || obj?.imageLabel || '';
  const strokeLabel = obj?.strokeMetadata?.label || obj?.customData?.label || obj?.id || '';
  const type = String(obj?.type || 'unknown');
  return `${imageLabel}|${strokeLabel}|${type}|${index}`;
}

function captureObjectDisplayState(canvas) {
  const objects = canvas?.getObjects?.() || [];
  return objects.map((obj, index) => ({
    key: getObjectRestoreKey(obj, index),
    visible: obj?.visible !== false,
    evented: obj?.evented !== false,
    selectable: obj?.selectable !== false,
    opacity: typeof obj?.opacity === 'number' ? obj.opacity : 1,
  }));
}

function restoreObjectDisplayState(canvas, snapshot) {
  const objects = canvas?.getObjects?.() || [];
  const snapshotByKey = new Map((snapshot || []).map(entry => [entry.key, entry]));
  let restored = 0;
  objects.forEach((obj, index) => {
    const key = getObjectRestoreKey(obj, index);
    const state = snapshotByKey.get(key);
    if (!state) return;
    obj.visible = state.visible;
    obj.evented = state.evented;
    obj.selectable = state.selectable;
    obj.opacity = typeof state.opacity === 'number' ? state.opacity : obj.opacity;
    restored += 1;
  });
  return { restored, total: objects.length, snapshotSize: snapshotByKey.size };
}

function beginPdfExportSession() {
  const projectManager = window.app?.projectManager;
  const canvasManager = window.app?.canvasManager;
  const captureFrame = document.getElementById('captureFrame');
  const state = {
    previousWindowSuspendSave: Boolean(window.__suspendSaveCurrentView),
    previousProjectSuspendSave: Boolean(projectManager?.suspendSave),
    previousIsPdfExporting: Boolean(window.__isPdfExporting),
    previousViewId: projectManager?.currentViewId || '',
    previousScopedLabel: window.currentImageLabel || '',
    previousCaptureTabsByLabel: cloneSerializable(window.captureTabsByLabel || {}, {}),
    previousCaptureMasterTargets: cloneSerializable(
      window.captureMasterDrawTargetByLabel || {},
      {}
    ),
    previousViewportState: cloneSerializable(canvasManager?.getViewportState?.() || null, null),
    previousViewportTransform: cloneSerializable(
      canvasManager?.fabricCanvas?.viewportTransform || null,
      null
    ),
    previousRotationDegrees:
      typeof canvasManager?.getRotationDegrees === 'function'
        ? canvasManager.getRotationDegrees()
        : null,
    previousCanvasSelection: canvasManager?.fabricCanvas?.selection,
    previousCanvasSkipTargetFind: canvasManager?.fabricCanvas?.skipTargetFind,
    previousObjectDisplayState: captureObjectDisplayState(canvasManager?.fabricCanvas),
    previousCaptureFrameStyle: captureFrame
      ? {
          left: captureFrame.style.left,
          top: captureFrame.style.top,
          width: captureFrame.style.width,
          height: captureFrame.style.height,
          borderColor: captureFrame.style.borderColor,
        }
      : null,
  };

  // Persist the currently edited frame/view once before suspending autosave.
  // Without this, switching views for export can reload stale canvasData and drop recent edits.
  if (projectManager && !window.__isLoadingProject) {
    try {
      if (typeof window.captureTabsSyncActive === 'function') {
        window.captureTabsSyncActive(projectManager.currentViewId);
      }
      if (typeof projectManager.saveCurrentViewState === 'function') {
        projectManager.saveCurrentViewState();
      }
      logVectorDebugSnapshot('beginPdfExportSession:pre-save-current-view', {
        viewId: projectManager.currentViewId || null,
      });
    } catch (saveError) {
      logVectorDebugSnapshot('beginPdfExportSession:pre-save-error', {
        error: String(saveError?.message || saveError),
      });
    }
  }

  window.__suspendSaveCurrentView = true;
  logVectorDebugSnapshot('beginPdfExportSession:before-lock');
  if (canvasManager?.fabricCanvas) {
    safelyDiscardActiveObject(canvasManager.fabricCanvas);
    canvasManager.fabricCanvas.selection = false;
    canvasManager.fabricCanvas.skipTargetFind = true;
  }
  if (projectManager) {
    projectManager.suspendSave = true;
  }
  window.__isPdfExporting = true;
  return state;
}

async function restorePdfExportSession(state) {
  const projectManager = window.app?.projectManager;
  const canvasManager = window.app?.canvasManager;
  const captureFrame = document.getElementById('captureFrame');

  try {
    logVectorDebugSnapshot('restorePdfExportSession:start');
    if (state?.previousCaptureTabsByLabel) {
      window.captureTabsByLabel = cloneSerializable(state.previousCaptureTabsByLabel, {});
    }
    if (state?.previousCaptureMasterTargets) {
      window.captureMasterDrawTargetByLabel = cloneSerializable(
        state.previousCaptureMasterTargets,
        {}
      );
    }

    const restoreViewId = state?.previousViewId || projectManager?.currentViewId || '';
    if (
      restoreViewId &&
      projectManager?.views?.[restoreViewId] &&
      projectManager?.switchView &&
      projectManager.currentViewId !== restoreViewId
    ) {
      await projectManager.switchView(restoreViewId, true);
    }

    const scopedTabId = getTabIdFromScopedLabel(state?.previousScopedLabel || '');
    const restoreTabId =
      scopedTabId || window.captureTabsByLabel?.[restoreViewId]?.activeTabId || null;
    if (restoreViewId && restoreTabId && typeof window.setActiveCaptureTab === 'function') {
      try {
        window.setActiveCaptureTab(restoreViewId, restoreTabId, { skipSave: true });
      } catch (tabError) {
        logVectorDebugSnapshot('restorePdfExportSession:set-tab-error', {
          restoreViewId,
          restoreTabId,
          error: String(tabError?.message || tabError),
        });
      }
    }

    if (state?.previousCaptureFrameStyle && captureFrame) {
      captureFrame.style.left = state.previousCaptureFrameStyle.left;
      captureFrame.style.top = state.previousCaptureFrameStyle.top;
      captureFrame.style.width = state.previousCaptureFrameStyle.width;
      captureFrame.style.height = state.previousCaptureFrameStyle.height;
      captureFrame.style.borderColor = state.previousCaptureFrameStyle.borderColor;
    }

    if (state?.previousScopedLabel) {
      window.currentImageLabel = state.previousScopedLabel;
    }

    if (typeof state?.previousRotationDegrees === 'number' && canvasManager?.setRotationDegrees) {
      canvasManager.setRotationDegrees(state.previousRotationDegrees);
    }

    if (
      Array.isArray(state?.previousViewportTransform) &&
      state.previousViewportTransform.length === 6 &&
      canvasManager?.fabricCanvas?.setViewportTransform
    ) {
      canvasManager.fabricCanvas.setViewportTransform(state.previousViewportTransform);
      canvasManager.fabricCanvas.requestRenderAll?.();
    } else if (state?.previousViewportState && canvasManager?.setViewportState) {
      canvasManager.setViewportState(state.previousViewportState);
    }
    if (canvasManager?.fabricCanvas) {
      canvasManager.fabricCanvas.selection =
        typeof state?.previousCanvasSelection === 'boolean' ? state.previousCanvasSelection : true;
      canvasManager.fabricCanvas.skipTargetFind = Boolean(state?.previousCanvasSkipTargetFind);
    }

    if (restoreViewId && typeof window.renderCaptureTabUI === 'function') {
      try {
        window.renderCaptureTabUI(restoreViewId);
      } catch (renderError) {
        logVectorDebugSnapshot('restorePdfExportSession:render-ui-error', {
          restoreViewId,
          error: String(renderError?.message || renderError),
        });
      }
    }
    if (restoreViewId && typeof window.syncCaptureTabCanvasVisibility === 'function') {
      try {
        window.syncCaptureTabCanvasVisibility(restoreViewId);
      } catch (syncError) {
        logVectorDebugSnapshot('restorePdfExportSession:sync-visibility-error', {
          restoreViewId,
          error: String(syncError?.message || syncError),
        });
      }
    }

    const enforceResult = enforceScopedTabContext(restoreViewId, state?.previousScopedLabel || '');
    logVectorDebugSnapshot('restorePdfExportSession:enforce-scoped-context', enforceResult);

    setTimeout(() => {
      const delayedResult = enforceScopedTabContext(
        restoreViewId,
        state?.previousScopedLabel || ''
      );
      logVectorDebugSnapshot(
        'restorePdfExportSession:enforce-scoped-context-delayed',
        delayedResult
      );
    }, 0);

    if (canvasManager?.fabricCanvas) {
      const restoreStats = restoreObjectDisplayState(
        canvasManager.fabricCanvas,
        state?.previousObjectDisplayState || []
      );
      logVectorDebugSnapshot('restorePdfExportSession:display-state-restored', restoreStats);
    }

    canvasManager?.fabricCanvas?.requestRenderAll?.();
    logVectorDebugSnapshot('restorePdfExportSession:after-restore', {
      restoredViewId: restoreViewId,
      restoredTabId: window.captureTabsByLabel?.[restoreViewId]?.activeTabId || null,
      scopedTabId,
    });
  } catch (restoreError) {
    console.warn('[PDF] Failed to fully restore editor state after export:', restoreError);
    logVectorDebugSnapshot('restorePdfExportSession:error', {
      error: String(restoreError?.message || restoreError),
    });
  } finally {
    window.__suspendSaveCurrentView = Boolean(state?.previousWindowSuspendSave);
    if (projectManager) {
      projectManager.suspendSave = Boolean(state?.previousProjectSuspendSave);
    }
    window.__isPdfExporting = Boolean(state?.previousIsPdfExporting);
  }
}

async function withTemporaryCaptureTarget(viewId, tabId, callback) {
  const projectManager = window.app?.projectManager;
  const canvas = window.app?.canvasManager?.fabricCanvas;
  const captureFrame = document.getElementById('captureFrame');
  const previousViewId = projectManager?.currentViewId || '';
  const previousScopedLabel = window.currentImageLabel || '';
  const previousBaseLabel = toBaseViewId(previousScopedLabel || previousViewId);
  const previousState =
    previousBaseLabel && window.captureTabsByLabel
      ? window.captureTabsByLabel[previousBaseLabel] || null
      : null;
  const previousTabId =
    getTabIdFromScopedLabel(previousScopedLabel) || previousState?.activeTabId || null;
  const frameStyle = captureFrame
    ? {
        left: captureFrame.style.left,
        top: captureFrame.style.top,
        width: captureFrame.style.width,
        height: captureFrame.style.height,
        borderColor: captureFrame.style.borderColor,
      }
    : null;

  const restoreTargetViewId = previousViewId || viewId || '';
  const restoreTabId = previousTabId;
  const previousViewportTransform = cloneSerializable(canvas?.viewportTransform || null, null);

  try {
    logVectorDebugSnapshot('withTemporaryCaptureTarget:before-switch', {
      targetViewId: viewId,
      targetTabId: tabId || null,
    });
    safelyDiscardActiveObject(canvas);
    canvas?.requestRenderAll?.();
    if (projectManager?.switchView && viewId && projectManager.currentViewId !== viewId) {
      if (!projectManager?.views?.[viewId]) {
        throw new Error(`Target view is missing: ${viewId}`);
      }
      await projectManager.switchView(viewId);
    }
    if (tabId && typeof window.setActiveCaptureTab === 'function') {
      try {
        // Export should not mutate persisted tab/frame state while switching tabs.
        window.setActiveCaptureTab(viewId, tabId, { skipSave: true });
      } catch (setTabError) {
        logVectorDebugSnapshot('withTemporaryCaptureTarget:set-tab-error', {
          targetViewId: viewId,
          targetTabId: tabId,
          error: String(setTabError?.message || setTabError),
        });
      }
    }
    window.app?.canvasManager?.fabricCanvas?.requestRenderAll?.();
    await new Promise(resolve => setTimeout(resolve, 250));
    logVectorDebugSnapshot('withTemporaryCaptureTarget:after-switch', {
      targetViewId: viewId,
      targetTabId: tabId || null,
    });
    return await callback();
  } finally {
    try {
      if (
        projectManager?.switchView &&
        restoreTargetViewId &&
        projectManager?.views?.[restoreTargetViewId] &&
        projectManager.currentViewId !== restoreTargetViewId
      ) {
        await projectManager.switchView(restoreTargetViewId);
      }
      if (
        restoreTargetViewId &&
        restoreTabId &&
        window.captureTabsByLabel?.[restoreTargetViewId] &&
        typeof window.setActiveCaptureTab === 'function'
      ) {
        try {
          window.setActiveCaptureTab(restoreTargetViewId, restoreTabId, { skipSave: true });
        } catch (restoreTabError) {
          logVectorDebugSnapshot('withTemporaryCaptureTarget:restore-tab-error', {
            restoredViewId: restoreTargetViewId,
            restoredTabId: restoreTabId,
            error: String(restoreTabError?.message || restoreTabError),
          });
        }
      }
      if (captureFrame && frameStyle) {
        captureFrame.style.left = frameStyle.left;
        captureFrame.style.top = frameStyle.top;
        captureFrame.style.width = frameStyle.width;
        captureFrame.style.height = frameStyle.height;
        captureFrame.style.borderColor = frameStyle.borderColor;
      }
      if (previousScopedLabel) {
        window.currentImageLabel = previousScopedLabel;
      }
      if (
        Array.isArray(previousViewportTransform) &&
        previousViewportTransform.length === 6 &&
        canvas?.setViewportTransform
      ) {
        canvas.setViewportTransform(previousViewportTransform);
      }
      safelyDiscardActiveObject(canvas);
      window.app?.canvasManager?.fabricCanvas?.requestRenderAll?.();
      logVectorDebugSnapshot('withTemporaryCaptureTarget:after-restore', {
        restoredViewId: restoreTargetViewId,
        restoredTabId: restoreTabId,
      });
    } catch (restoreError) {
      console.warn(
        '[PDF] Failed to fully restore capture target state after export step:',
        restoreError
      );
      logVectorDebugSnapshot('withTemporaryCaptureTarget:restore-error', {
        error: String(restoreError?.message || restoreError),
      });
    }
  }
}

async function requestServerRenderedPdf(payload) {
  const endpoints = ['/api/pdf/render', '/pdf/render'];
  let lastError = null;

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errText = await response.text();
        const looksLikeNotFound =
          response.status === 404 ||
          errText.includes('NOT_FOUND') ||
          errText.includes('The page could not be found');
        if (looksLikeNotFound) {
          lastError = new Error(`Endpoint not found at ${endpoint}`);
          continue;
        }
        throw new Error(`Server PDF render failed (${response.status}) at ${endpoint}: ${errText}`);
      }

      return response;
    } catch (error) {
      if (String(error?.message || '').includes('Server PDF render failed')) {
        throw error;
      }
      lastError = error;
    }
  }

  const unavailableError =
    lastError ||
    new Error('Server PDF render endpoint is unavailable. Check API deployment configuration.');
  unavailableError.name = 'PdfRenderEndpointUnavailableError';
  throw unavailableError;
}

export function initPdfExport() {
  ensurePdfDebugSurface();
  logVectorDebugSnapshot('initPdfExport:ready', {
    search: window.location?.search || '',
  });
  // Export utilities for saving multiple images and PDF generation with pdf-lib
  window.saveAllImages = async function () {
    const projectName = document.getElementById('projectName')?.value || 'OpenPaint';
    const metadata =
      window.app?.projectManager?.getProjectMetadata?.() || window.projectMetadata || {};
    const partLabels = metadata.imagePartLabels || {};
    const views = window.app?.projectManager?.views || {};
    const viewIds = Object.keys(views).filter(id => views[id].image);
    if (viewIds.length === 0) {
      alert('No images to save. Please upload images first.');
      return;
    }
    console.log(`[Export] Saving ${viewIds.length} images`);
    for (let i = 0; i < viewIds.length; i++) {
      const viewId = viewIds[i];
      await window.app.projectManager.switchView(viewId);
      await new Promise(resolve => setTimeout(resolve, 100));
      const canvas = window.app.canvasManager.fabricCanvas;
      const captureFrame = document.getElementById('captureFrame');
      if (!canvas || !captureFrame) {
        console.warn(`[Export] Skipping ${viewId}`);
        continue;
      }
      const frameRect = captureFrame.getBoundingClientRect();
      const canvasEl = canvas.lowerCanvasEl;
      const scaleX = canvasEl.width / canvasEl.offsetWidth;
      const scaleY = canvasEl.height / canvasEl.offsetHeight;
      const canvasRect = canvasEl.getBoundingClientRect();
      const left = (frameRect.left - canvasRect.left) * scaleX;
      const top = (frameRect.top - canvasRect.top) * scaleY;
      const width = frameRect.width * scaleX;
      const height = frameRect.height * scaleY;
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = width;
      tempCanvas.height = height;
      const ctx = tempCanvas.getContext('2d');
      ctx.drawImage(canvasEl, left, top, width, height, 0, 0, width, height);
      await new Promise(resolve => {
        tempCanvas.toBlob(blob => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          const imageLabel = partLabels[viewId] || '';
          a.download = `${buildImageExportFilename(projectName, imageLabel, i)}.png`;
          a.click();
          URL.revokeObjectURL(url);
          resolve();
        });
      });
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    alert(`Saved ${viewIds.length} images!`);
  };

  window.showPDFExportDialog = async function (projectName) {
    projectName = projectName || document.getElementById('projectName')?.value || 'OpenPaint';
    const views = window.app?.projectManager?.views || {};
    const viewIds = Object.keys(views).filter(id => views[id].image);
    const pageTargets = getPdfPageTargets(viewIds);
    if (viewIds.length === 0) {
      alert('No images to export. Please upload images first.');
      return;
    }
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(11,13,16,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;';
    overlay.innerHTML = `<div style="background:#fff;border-radius:16px;padding:30px;max-width:520px;width:min(100%,520px);box-shadow:0 24px 48px rgba(11,13,16,0.18),0 8px 16px rgba(11,13,16,0.08);font-family:'Instrument Sans','Inter',sans-serif;color:#0B0D10;"><h2 style="margin:0 0 8px 0;color:#151A20;font-size:24px;font-weight:700;font-family:'Instrument Sans','Inter',sans-serif;">Export PDF - ${projectName}</h2><p style="color:#3E4752;margin:0 0 20px 0;font-size:13px;">Creating PDF with ${viewIds.length} page(s) and editable form fields.</p><div style="margin-bottom:16px;"><label style="display:block;margin-bottom:6px;font-weight:600;color:#3E4752;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;">Image Quality</label><select id="pdfQuality" style="width:100%;padding:10px 14px;border:1px solid #E7EAEE;border-radius:12px;font-size:14px;background:#fff;font-family:'Instrument Sans','Inter',sans-serif;outline:none;"><option value="high">High Quality</option><option value="medium" selected>Medium Quality</option><option value="low">Low Quality</option></select></div><div style="margin-bottom:16px;"><label style="display:block;margin-bottom:6px;font-weight:600;color:#3E4752;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;">Page Size</label><select id="pdfPageSize" style="width:100%;padding:10px 14px;border:1px solid #E7EAEE;border-radius:12px;font-size:14px;background:#fff;font-family:'Instrument Sans','Inter',sans-serif;outline:none;"><option value="letter" selected>Letter (8.5" × 11")</option><option value="a4">A4</option></select></div><label style="display:flex;align-items:center;gap:10px;cursor:pointer;margin-bottom:20px;padding:12px 14px;border:1px solid #E7EAEE;border-radius:12px;background:#F6F7F9;"><input type="checkbox" id="includeMeasurements" checked style="transform:scale(1.3);accent-color:#0B0D10;"><span style="color:#0B0D10;font-size:14px;">Include editable measurement fields</span></label><div style="display:flex;gap:10px;"><button id="generatePdfBtn" style="flex:1;padding:12px;background:#0B0D10;color:#fff;border:none;border-radius:12px;font-weight:600;cursor:pointer;font-family:'Instrument Sans','Inter',sans-serif;font-size:14px;">Generate PDF</button><button id="cancelPdfBtn" style="flex:1;padding:12px;background:#F6F7F9;color:#0B0D10;border:1px solid #E7EAEE;border-radius:12px;font-weight:600;cursor:pointer;font-family:'Instrument Sans','Inter',sans-serif;font-size:14px;">Cancel</button></div><div id="pdfProgress" style="display:none;margin-top:20px;text-align:center;"><div style="width:100%;height:8px;background:#E7EAEE;border-radius:999px;overflow:hidden;margin-bottom:10px;"><div id="pdfProgressBar" style="width:0%;height:100%;background:#0B0D10;transition:width 0.3s;border-radius:999px;"></div></div><p id="pdfProgressText" style="color:#3E4752;font-size:14px;font-family:'Instrument Sans','Inter',sans-serif;">Preparing PDF...</p></div></div>`;
    document.body.appendChild(overlay);

    const pageSizeSelect = document.getElementById('pdfPageSize');
    if (pageSizeSelect) {
      pageSizeSelect.value = 'a4';
      pageSizeSelect.disabled = false;
      const pageSizeWrap = pageSizeSelect.closest('div');
      if (pageSizeWrap) {
        pageSizeWrap.style.display = 'block';
      }
    }
    const includeMeasurementsLabel = document.getElementById('includeMeasurements')?.parentElement;
    if (includeMeasurementsLabel) {
      const rendererWrap = document.createElement('div');
      rendererWrap.style.marginBottom = '16px';
      rendererWrap.innerHTML = `<label style="display:block;margin-bottom:6px;font-weight:600;color:#3E4752;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;">Renderer</label><select id="pdfRendererMode" style="width:100%;padding:10px 14px;border:1px solid #E7EAEE;border-radius:12px;font-size:14px;background:#fff;font-family:'Instrument Sans','Inter',sans-serif;outline:none;"><option value="classic" selected>Classic (Local)</option><option value="modern">Modern (Beta)</option></select>`;
      rendererWrap.style.fontFamily = "'Instrument Sans','Inter',sans-serif";
      includeMeasurementsLabel.parentElement?.insertBefore(rendererWrap, includeMeasurementsLabel);
    }
    document.getElementById('cancelPdfBtn').onclick = () => overlay.remove();
    document.getElementById('generatePdfBtn').onclick = async () => {
      const quality = document.getElementById('pdfQuality').value;
      const pageSize = document.getElementById('pdfPageSize')?.value || 'a4';
      const includeMeasurements = document.getElementById('includeMeasurements').checked;
      const rendererMode = document.getElementById('pdfRendererMode')?.value || 'classic';
      const exportSession = beginPdfExportSession();
      document.getElementById('pdfProgress').style.display = 'block';
      document.getElementById('generatePdfBtn').disabled = true;
      document.getElementById('cancelPdfBtn').disabled = true;

      try {
        if (rendererMode === 'modern') {
          await generatePDFWithServer(
            projectName,
            pageTargets,
            quality,
            pageSize,
            includeMeasurements
          );
        } else {
          await generatePDFWithPDFLib(
            projectName,
            pageTargets,
            quality,
            pageSize,
            includeMeasurements
          );
        }
      } catch (error) {
        console.error('[PDF] Export failed:', error);
        const progressTextEl = document.getElementById('pdfProgressText');
        if (progressTextEl) {
          progressTextEl.textContent =
            rendererMode === 'modern'
              ? 'Modern renderer unavailable. Falling back to classic export...'
              : 'Export failed. Retrying with classic export...';
        }
        if (rendererMode !== 'modern') {
          alert('PDF export failed. Falling back to classic renderer.');
        }
        await generatePDFWithPDFLib(
          projectName,
          pageTargets,
          quality,
          pageSize,
          includeMeasurements
        );
      } finally {
        await restorePdfExportSession(exportSession);
      }

      overlay.remove();
    };
  };

  async function generatePDFWithServer(
    projectName,
    pageTargets,
    quality,
    pageSize,
    includeMeasurements
  ) {
    const progressBar = document.getElementById('pdfProgressBar');
    const progressText = document.getElementById('pdfProgressText');
    const metadata =
      window.app?.projectManager?.getProjectMetadata?.() || window.projectMetadata || {};
    const partLabels = metadata.imagePartLabels || {};
    const metaPieceGroups = Array.isArray(metadata.pieceGroups) ? metadata.pieceGroups : [];
    const groupedTargets = getGroupedPdfPageTargets(pageTargets, metaPieceGroups, partLabels);
    const currentUnit = document.getElementById('unitSelector')?.value || 'inch';
    const frameCountByView = pageTargets.reduce((acc, target) => {
      acc[target.viewId] = (acc[target.viewId] || 0) + 1;
      return acc;
    }, {});

    const namingLine = buildPdfNamingLine();

    const formatTargetDisplayName = target => {
      const partLabel = partLabels[target.viewId] || target.viewId;
      const tabName = String(target.tabName || '').trim();
      const frameCount = frameCountByView[target.viewId] || 1;
      const isSingleFrameOne = frameCount <= 1 && /^frame\s*1$/i.test(tabName);
      if (!tabName || isSingleFrameOne) return partLabel;
      return `${partLabel} - ${tabName}`;
    };

    const getTargetMeasurementRows = target => {
      if (!includeMeasurements) return [];
      const measurements = getScopedMeasurements(target.scopeKey, {
        scopeKey: target.scopeKey,
        includeBase: target.includeBase,
      });
      const measuredStrokes = Object.keys(measurements);
      const strokes = Array.from(
        new Set([
          ...getScopedStrokeLabels(target.scopeKey, {
            scopeKey: target.scopeKey,
            includeBase: target.includeBase,
          }),
          ...measuredStrokes,
        ])
      ).sort((a, b) => a.localeCompare(b));
      return strokes.map(strokeLabel => {
        const m = measurements[strokeLabel] || {};
        let value = '';
        if (currentUnit === 'inch') {
          const whole = m.inchWhole || 0;
          const frac = m.inchFraction || 0;
          value =
            whole > 0 || frac > 0
              ? `${whole > 0 ? whole + '"' : ''}${frac > 0 ? ' ' + frac.toFixed(2) + '"' : ''}`.trim()
              : '';
        } else {
          value = m.cm ? `${m.cm.toFixed(1)} cm` : '';
        }
        return {
          label: strokeLabel,
          value,
        };
      });
    };

    const captureViewImageDataUrl = async target => {
      return withTemporaryCaptureTarget(target.viewId, target.tabId, async () => {
        const canvas = window.app.canvasManager.fabricCanvas;
        const captureFrame = document.getElementById('captureFrame');
        if (!canvas || !captureFrame) return '';
        const qualityScales = { high: 1.25, medium: 1.0, low: 0.85 };
        const scale = qualityScales[quality] || 1.0;
        const frameRect = captureFrame.getBoundingClientRect();
        const canvasEl = canvas.lowerCanvasEl;
        const scaleX = canvasEl.width / canvasEl.offsetWidth;
        const scaleY = canvasEl.height / canvasEl.offsetHeight;
        const canvasRect = canvasEl.getBoundingClientRect();
        const left = (frameRect.left - canvasRect.left) * scaleX;
        const top = (frameRect.top - canvasRect.top) * scaleY;
        const width = frameRect.width * scaleX;
        const height = frameRect.height * scaleY;
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = width * scale;
        tempCanvas.height = height * scale;
        const ctx = tempCanvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.scale(scale, scale);
        ctx.drawImage(canvasEl, left, top, width, height, 0, 0, width, height);
        return tempCanvas.toDataURL('image/jpeg', 0.78);
      });
    };

    const groups = [];
    for (let i = 0; i < groupedTargets.length; i++) {
      const entry = groupedTargets[i];
      const mainTarget = entry.type === 'grouped' ? entry.mainTarget : entry.target;
      const relatedTargets = entry.type === 'grouped' ? entry.relatedTargets || [] : [];
      if (!mainTarget) continue;

      progressText.textContent = `Preparing page data (${i + 1}/${groupedTargets.length})\u2026`;
      progressBar.style.width = `${(i / groupedTargets.length) * 100}%`;

      const mainSrc = await captureViewImageDataUrl(mainTarget);
      if (!mainSrc) continue;

      const relatedFrames = [];
      const relatedMeasurementCards = [];
      for (const target of relatedTargets) {
        const src = await captureViewImageDataUrl(target);
        if (!src) continue;
        const title = formatTargetDisplayName(target);
        relatedFrames.push({ title, src });
        relatedMeasurementCards.push({
          title,
          rows: getTargetMeasurementRows(target),
        });
      }

      groups.push({
        title: entry.note || formatTargetDisplayName(mainTarget),
        subtitle: '',
        mainImage: {
          title: formatTargetDisplayName(mainTarget),
          src: mainSrc,
        },
        mainMeasurements: getTargetMeasurementRows(mainTarget),
        relatedFrames,
        relatedMeasurementCards,
      });
    }

    if (includeMeasurements && typeof window.evaluateMeasurementRelations === 'function') {
      try {
        const relations = window.evaluateMeasurementRelations() || {};
        const relationChecks = Array.isArray(relations.checks) ? relations.checks : [];
        const relationConnections = Array.isArray(relations.connections)
          ? relations.connections
          : [];
        if (relationChecks.length || relationConnections.length) {
          const relationRows = relationChecks.map(check => {
            const status = String(check?.status || 'pending').toUpperCase();
            const formula = check?.formula || check?.id || 'Formula Check';
            const reason = check?.reason ? ` - ${check.reason}` : '';
            return {
              label: formula,
              value: `${status}${reason}`,
            };
          });
          const connectionRows = relationConnections.map(connection => {
            const from = connection?.fromDisplay || connection?.fromKey || '-';
            const to = connection?.toDisplay || connection?.toKey || '-';
            const status = String(connection?.status || 'pending').toUpperCase();
            const reason = connection?.reason ? ` - ${connection.reason}` : '';
            return {
              label: `${from} <-> ${to}`,
              value: `${status}${reason}`,
            };
          });

          groups.push({
            title: 'Measurement Validation Summary',
            subtitle: 'Formula checks and cross-image connections',
            mainImage: {
              title: 'Validation Overview',
              src:
                groups[0]?.mainImage?.src ||
                'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI5NjAiIGhlaWdodD0iNTQwIj48cmVjdCB3aWR0aD0iOTYwIiBoZWlnaHQ9IjU0MCIgZmlsbD0iI0YxRjVGOSIgcng9IjE2Ii8+PHRleHQgeD0iNDgwIiB5PSIyODAiIGZvbnQtc2l6ZT0iMzYiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9IiM0NzU1NjkiIGZvbnQtZmFtaWx5PSJBcmlhbCI+TWVhc3VyZW1lbnQgVmFsaWRhdGlvbiBTdW1tYXJ5PC90ZXh0Pjwvc3ZnPg==',
            },
            mainMeasurements: relationRows,
            relatedFrames: [],
            relatedMeasurementCards: [
              {
                title: 'Cross-image Connections',
                rows: connectionRows,
              },
            ],
          });
        }
      } catch (error) {
        console.warn('[PDF] Failed to append relation summary page in modern renderer:', error);
      }
    }

    progressText.textContent = 'Rendering modern PDF\u2026';
    progressBar.style.width = '92%';
    const response = await requestServerRenderedPdf({
      source: 'report',
      report: {
        projectName,
        namingLine,
        unit: currentUnit,
        groups,
      },
      options: {
        renderer: 'hybrid',
        pageSize,
        injectFormFields: includeMeasurements,
        filename: `${sanitizeFilenamePart(projectName, 'OpenPaint Project')}.pdf`,
      },
    });

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sanitizeFilenamePart(projectName, 'OpenPaint Project')}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
    progressBar.style.width = '100%';
    progressText.textContent = 'Done';
  }

  async function generatePDFWithPDFLib(
    projectName,
    pageTargets,
    quality,
    pageSize,
    includeMeasurements
  ) {
    // PDFDocument, StandardFonts, rgb imported from pdf-lib above
    const progressBar = document.getElementById('pdfProgressBar');
    const progressText = document.getElementById('pdfProgressText');
    const pdfDoc = await PDFDocument.create();
    const usedFieldNames = new Set();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontMono = await pdfDoc.embedFont(StandardFonts.Courier);
    const metadata =
      window.app?.projectManager?.getProjectMetadata?.() || window.projectMetadata || {};
    const partLabels = metadata.imagePartLabels || {};
    // Pre-check whether checks/connections/pieceGroups exist (for page count).
    // Full evaluation is deferred until after the image loop so all views are loaded.
    const metaChecks = Array.isArray(metadata.measurementChecks) ? metadata.measurementChecks : [];
    const metaConnections = Array.isArray(metadata.measurementConnections)
      ? metadata.measurementConnections
      : [];
    const metaPieceGroups = Array.isArray(metadata.pieceGroups) ? metadata.pieceGroups : [];
    const pageSizes = { letter: { width: 612, height: 792 }, a4: { width: 595, height: 842 } };
    const { width: pageWidth, height: pageHeight } = pageSizes[pageSize] || pageSizes.letter;
    const qualityScales = { high: 3.0, medium: 2.0, low: 1.5 };
    const scale = qualityScales[quality] || 2.0;

    // ── Design System ────────────────────────────────────────────────
    const colors = {
      pageBg: rgb(0.972, 0.976, 0.992),
      headerBg: rgb(0.07, 0.1, 0.18),
      accentStripe: rgb(0.345, 0.4, 0.95),
      accentStripeSoft: rgb(0.3, 0.45, 0.8),
      accentLight: rgb(0.93, 0.95, 0.995),
      panelBg: rgb(0.985, 0.99, 1),
      white: rgb(1, 1, 1),
      textPrimary: rgb(0.07, 0.09, 0.16),
      textSecondary: rgb(0.28, 0.34, 0.44),
      textMuted: rgb(0.45, 0.5, 0.6),
      border: rgb(0.78, 0.82, 0.9),
      borderLight: rgb(0.88, 0.91, 0.96),
      tableRowAlt: rgb(0.96, 0.97, 1),
      frameShadow: rgb(0.9, 0.93, 0.97),
      frameBorder: rgb(0.76, 0.81, 0.9),
      statusPass: rgb(0.13, 0.59, 0.33),
      statusFail: rgb(0.82, 0.18, 0.18),
      statusWarn: rgb(0.8, 0.58, 0.08),
      statusPending: rgb(0.55, 0.57, 0.62),
      badgePassBg: rgb(0.88, 0.97, 0.91),
      badgeFailBg: rgb(0.99, 0.9, 0.9),
      badgeWarnBg: rgb(1.0, 0.96, 0.88),
      badgePendBg: rgb(0.93, 0.94, 0.95),
    };
    const layout = {
      marginX: 40,
      headerH: 62,
      accentH: 4,
      footerH: 32,
      contentTop: pageHeight - 62 - 4 - 16,
      contentBottom: 32 + 12, // above footer + gap
      contentWidth: pageWidth - 80,
    };
    const typo = {
      title: 17,
      subtitle: 9,
      sectionHeader: 13,
      body: 10,
      table: 9,
      tableHeader: 9,
      small: 8,
      footer: 7,
    };

    // totalPages is computed after grouping; use a mutable variable so
    // header/footer helpers (closed over this scope) can reference it.
    let totalPages = pageTargets.length; // updated below after grouping

    // ── Helper Functions ─────────────────────────────────────────────

    function centerText(text, y, size, usedFont, color, page) {
      const w = usedFont.widthOfTextAtSize(safePdfText(text), size);
      page.drawText(safePdfText(text), {
        x: (pageWidth - w) / 2,
        y,
        size,
        font: usedFont,
        color,
      });
    }

    function rightAlignText(text, y, size, usedFont, color, page, rightMargin) {
      const w = usedFont.widthOfTextAtSize(safePdfText(text), size);
      page.drawText(safePdfText(text), {
        x: rightMargin - w,
        y,
        size,
        font: usedFont,
        color,
      });
    }

    function drawSketchFrame(page, x, y, width, height, color) {
      void page;
      void x;
      void y;
      void width;
      void height;
      void color;
    }

    function drawHeader(page, titleText, subtitleText, namingText, pageNum) {
      page.drawRectangle({
        x: 0,
        y: 0,
        width: pageWidth,
        height: pageHeight,
        color: colors.pageBg,
      });

      page.drawRectangle({
        x: 0,
        y: pageHeight - layout.headerH,
        width: pageWidth,
        height: layout.headerH,
        color: colors.headerBg,
      });

      page.drawRectangle({
        x: 0,
        y: pageHeight - layout.headerH - layout.accentH,
        width: pageWidth,
        height: layout.accentH / 2,
        color: colors.accentStripe,
      });
      page.drawRectangle({
        x: 0,
        y: pageHeight - layout.headerH - layout.accentH,
        width: pageWidth,
        height: layout.accentH / 2,
        color: colors.accentStripeSoft,
      });

      page.drawText('OPENPAINT', {
        x: layout.marginX,
        y: pageHeight - 20,
        size: 7,
        font: fontBold,
        color: rgb(0.62, 0.7, 0.88),
      });
      centerText(titleText, pageHeight - 30, typo.title, fontBold, colors.white, page);
      if (namingText) {
        centerText(namingText, pageHeight - 45, typo.small, font, rgb(0.75, 0.81, 0.93), page);
      }

      if (subtitleText) {
        page.drawText(safePdfText(subtitleText), {
          x: layout.marginX,
          y: pageHeight - 56,
          size: typo.subtitle,
          font,
          color: rgb(0.73, 0.8, 0.93),
        });
      }

      rightAlignText(
        `Page ${pageNum} of ${totalPages}`,
        pageHeight - 56,
        typo.subtitle,
        font,
        rgb(0.73, 0.8, 0.93),
        page,
        pageWidth - layout.marginX
      );
    }

    function drawFooter(page, pageNum) {
      const footerY = 20;
      page.drawRectangle({
        x: layout.marginX,
        y: footerY + 10,
        width: layout.contentWidth,
        height: 0.75,
        color: colors.borderLight,
      });
      page.drawText(safePdfText(`Generated: ${new Date().toLocaleDateString()}`), {
        x: layout.marginX,
        y: footerY,
        size: typo.footer,
        font,
        color: colors.textMuted,
      });
      // Page right
      rightAlignText(
        `Page ${pageNum} of ${totalPages}`,
        footerY,
        typo.footer,
        font,
        colors.textMuted,
        page,
        pageWidth - layout.marginX
      );
    }

    function drawImageFrame(page, image, maxWidth, maxHeight, topY, columnOpts) {
      const imgAspect = image.width / image.height;
      let imgWidth = maxWidth;
      let imgHeight = imgWidth / imgAspect;
      if (imgHeight > maxHeight) {
        imgHeight = maxHeight;
        imgWidth = imgHeight * imgAspect;
      }
      const colX = columnOpts?.columnX ?? 0;
      const colW = columnOpts?.columnWidth ?? pageWidth;
      const imgX = colX + (colW - imgWidth) / 2;
      const imgY = topY - imgHeight;

      page.drawRectangle({
        x: imgX + 3,
        y: imgY - 3,
        width: imgWidth,
        height: imgHeight,
        color: colors.frameShadow,
      });

      const pad = 4;
      page.drawRectangle({
        x: imgX - pad,
        y: imgY - pad,
        width: imgWidth + pad * 2,
        height: imgHeight + pad * 2,
        color: colors.white,
        borderColor: colors.frameBorder,
        borderWidth: 0.75,
      });
      drawSketchFrame(
        page,
        imgX - pad,
        imgY - pad,
        imgWidth + pad * 2,
        imgHeight + pad * 2,
        colors.border
      );
      page.drawImage(image, { x: imgX, y: imgY, width: imgWidth, height: imgHeight });
      return { imgX, imgY, imgWidth, imgHeight };
    }

    function drawSectionHeader(page, text, y, startX) {
      const x = startX ?? layout.marginX;
      const textW = fontBold.widthOfTextAtSize(safePdfText(text), typo.sectionHeader);
      page.drawRectangle({
        x: x - 6,
        y: y - 7,
        width: textW + 18,
        height: 18,
        color: colors.panelBg,
        borderColor: colors.borderLight,
        borderWidth: 0.75,
      });
      drawSketchFrame(page, x - 6, y - 7, textW + 18, 18, colors.border);
      page.drawText(safePdfText(text), {
        x,
        y,
        size: typo.sectionHeader,
        font: fontBold,
        color: colors.textPrimary,
      });
      page.drawRectangle({
        x,
        y: y - 6,
        width: textW + 8,
        height: 1.5,
        color: colors.accentStripe,
      });
      return y - 22;
    }

    function drawStatusBadge(page, status, x, y) {
      const s = String(status || 'pending').toLowerCase();
      const labelMap = { pass: 'PASS', fail: 'FAIL', warn: 'WARN', pending: 'PENDING' };
      const bgMap = {
        pass: colors.badgePassBg,
        fail: colors.badgeFailBg,
        warn: colors.badgeWarnBg,
        pending: colors.badgePendBg,
      };
      const fgMap = {
        pass: colors.statusPass,
        fail: colors.statusFail,
        warn: colors.statusWarn,
        pending: colors.statusPending,
      };
      const label = labelMap[s] || 'PENDING';
      const bg = bgMap[s] || colors.badgePendBg;
      const fg = fgMap[s] || colors.statusPending;
      const badgeW = fontBold.widthOfTextAtSize(label, 7) + 10;
      const badgeH = 12;
      // Badge background
      page.drawRectangle({
        x,
        y: y - 2,
        width: badgeW,
        height: badgeH,
        color: bg,
        borderColor: fg,
        borderWidth: 0.5,
      });
      // Badge text
      page.drawText(label, {
        x: x + 5,
        y: y + 1,
        size: 7,
        font: fontBold,
        color: fg,
      });
      return badgeW;
    }

    function drawMeasurementTable(
      page,
      strokes,
      measurements,
      currentUnit,
      scopeKey,
      pageIndex,
      form,
      columnOpts
    ) {
      // columnOpts: optional { tableX, tableW } for column-scoped tables
      const safeView = sanitizePdfFieldPart(scopeKey, `view_${pageIndex + 1}`);
      const tableX = columnOpts?.tableX ?? layout.marginX;
      const tableW = columnOpts?.tableW ?? layout.contentWidth;
      const rowH = 22;
      const headerH = 20;
      const labelColW = tableW * 0.45;
      const valueColW = tableW * 0.55;

      // Start Y — called after image frame, caller passes startY
      return function (startY) {
        let y = startY;

        // Section header
        y = drawSectionHeader(page, 'Measurements', y, tableX);
        y -= 2;

        // Unit checkboxes row
        const unitRowY = y;
        page.drawText('Unit:', {
          x: tableX,
          y: unitRowY,
          size: typo.small,
          font: fontBold,
          color: colors.textSecondary,
        });
        const cmName = createUniquePdfFieldName(`unit_cm_${safeView}`, usedFieldNames);
        const cmCheck = form.createCheckBox(cmName);
        cmCheck.addToPage(page, { x: tableX + 32, y: unitRowY - 2, width: 10, height: 10 });
        if (currentUnit === 'cm') cmCheck.check();
        page.drawText('cm', {
          x: tableX + 45,
          y: unitRowY,
          size: typo.small,
          font,
          color: colors.textSecondary,
        });
        const inchName = createUniquePdfFieldName(`unit_inch_${safeView}`, usedFieldNames);
        const inchCheck = form.createCheckBox(inchName);
        inchCheck.addToPage(page, { x: tableX + 68, y: unitRowY - 2, width: 10, height: 10 });
        if (currentUnit === 'inch') inchCheck.check();
        page.drawText('inch', {
          x: tableX + 81,
          y: unitRowY,
          size: typo.small,
          font,
          color: colors.textSecondary,
        });
        y -= 18;

        // Table header row
        page.drawRectangle({
          x: tableX,
          y: y - headerH + 6,
          width: tableW,
          height: headerH,
          color: colors.accentStripe,
        });
        page.drawText('Label', {
          x: tableX + 8,
          y: y - 8,
          size: typo.tableHeader,
          font: fontBold,
          color: colors.white,
        });
        page.drawText('Measurement', {
          x: tableX + labelColW + 8,
          y: y - 8,
          size: typo.tableHeader,
          font: fontBold,
          color: colors.white,
        });
        y -= headerH + 2;

        // Table rows
        strokes.forEach((strokeLabel, idx) => {
          if (y < layout.contentBottom + rowH) return; // don't overflow into footer

          const m = measurements[strokeLabel] || {};
          let measurement = '';
          if (currentUnit === 'inch') {
            const whole = m.inchWhole || 0;
            const frac = m.inchFraction || 0;
            measurement =
              whole > 0 || frac > 0
                ? `${whole > 0 ? whole + '"' : ''}${frac > 0 ? ' ' + frac.toFixed(2) + '"' : ''}`.trim()
                : '';
          } else {
            measurement = m.cm ? `${m.cm.toFixed(1)} cm` : '';
          }

          // Alternating row background
          if (idx % 2 === 0) {
            page.drawRectangle({
              x: tableX,
              y: y - rowH + 8,
              width: tableW,
              height: rowH,
              color: colors.panelBg,
            });
          }

          // Row border bottom
          page.drawRectangle({
            x: tableX,
            y: y - rowH + 8,
            width: tableW,
            height: 0.5,
            color: colors.borderLight,
          });

          // Label text
          page.drawText(safePdfText(strokeLabel), {
            x: tableX + 8,
            y: y - 6,
            size: typo.table,
            font: fontBold,
            color: colors.textPrimary,
          });

          // Editable form field for value
          const safeStroke = sanitizePdfFieldPart(strokeLabel, `stroke_${idx + 1}`);
          const fieldName = createUniquePdfFieldName(`m_${safeView}_${safeStroke}`, usedFieldNames);
          const textField = form.createTextField(fieldName);
          textField.setText(measurement);
          textField.addToPage(page, {
            x: tableX + labelColW + 6,
            y: y - rowH + 10,
            width: valueColW - 14,
            height: rowH - 4,
            borderWidth: 0.75,
            borderColor: colors.border,
            backgroundColor: colors.white,
          });
          textField.setFontSize(typo.table);

          y -= rowH;
        });

        // Table outer border
        const tableTopY = startY - 18 - 2; // after unit row
        const tableBottomY = y + 8;
        if (tableTopY > tableBottomY) {
          page.drawRectangle({
            x: tableX,
            y: tableBottomY,
            width: tableW,
            height: tableTopY - tableBottomY + headerH,
            borderColor: colors.border,
            borderWidth: 0.75,
          });
        }

        return y;
      };
    }

    // ── Canvas Capture Helper ────────────────────────────────────────
    async function captureViewImage(viewId, tabId) {
      return withTemporaryCaptureTarget(viewId, tabId, async () => {
        const canvas = window.app.canvasManager.fabricCanvas;
        const captureFrame = document.getElementById('captureFrame');
        if (!canvas || !captureFrame) return null;

        const frameRect = captureFrame.getBoundingClientRect();
        const canvasEl = canvas.lowerCanvasEl;
        const scaleX = canvasEl.width / canvasEl.offsetWidth;
        const scaleY = canvasEl.height / canvasEl.offsetHeight;
        const canvasRect = canvasEl.getBoundingClientRect();
        const left = (frameRect.left - canvasRect.left) * scaleX;
        const top = (frameRect.top - canvasRect.top) * scaleY;
        const width = frameRect.width * scaleX;
        const height = frameRect.height * scaleY;
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = width * scale;
        tempCanvas.height = height * scale;
        const ctx = tempCanvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.scale(scale, scale);
        ctx.drawImage(canvasEl, left, top, width, height, 0, 0, width, height);
        const imageData = tempCanvas.toDataURL('image/jpeg', 0.95);
        const imageBytes = Uint8Array.from(atob(imageData.split(',')[1]), c => c.charCodeAt(0));
        return pdfDoc.embedJpg(imageBytes);
      });
    }

    function getTargetStrokes(scopeKey, includeBase) {
      if (!includeMeasurements) return { strokes: [], measurements: {} };
      const measurements = getScopedMeasurements(scopeKey, { scopeKey, includeBase });
      const measuredStrokes = Object.keys(measurements);
      const strokes = Array.from(
        new Set([...getScopedStrokeLabels(scopeKey, { scopeKey, includeBase }), ...measuredStrokes])
      ).sort((a, b) => a.localeCompare(b));
      return { strokes, measurements };
    }

    // ── Build grouped targets ─────────────────────────────────────────
    const groupedTargets = getGroupedPdfPageTargets(pageTargets, metaPieceGroups, partLabels);
    const hasRelationshipPage = metaChecks.length > 0 || metaConnections.length > 0;
    totalPages = groupedTargets.length + (hasRelationshipPage ? 1 : 0);

    // ── Image Pages ──────────────────────────────────────────────────
    const namingLine = buildPdfNamingLine();
    const frameCountByView = pageTargets.reduce((acc, target) => {
      acc[target.viewId] = (acc[target.viewId] || 0) + 1;
      return acc;
    }, {});
    const formatTargetDisplayName = target => {
      const partLabel = partLabels[target.viewId] || target.viewId;
      const tabName = String(target.tabName || '').trim();
      const frameCount = frameCountByView[target.viewId] || 1;
      const isSingleFrameOne = frameCount <= 1 && /^frame\s*1$/i.test(tabName);
      if (!tabName || isSingleFrameOne) return partLabel;
      return `${partLabel} - ${tabName}`;
    };

    for (let i = 0; i < groupedTargets.length; i++) {
      const entry = groupedTargets[i];
      const pageNum = i + 1;

      if (entry.type === 'grouped') {
        progressText.textContent = `Processing grouped page (${i + 1}/${groupedTargets.length})\u2026`;
        progressBar.style.width = `${(i / groupedTargets.length) * 100}%`;

        const heroTarget = entry.mainTarget;
        const heroImage = heroTarget
          ? await captureViewImage(heroTarget.viewId, heroTarget.tabId)
          : null;
        if (!heroImage) continue;

        const relatedFrames = [];
        for (const relatedTarget of entry.relatedTargets || []) {
          const image = await captureViewImage(relatedTarget.viewId, relatedTarget.tabId);
          if (!image) continue;
          relatedFrames.push({ target: relatedTarget, image });
        }

        const page = pdfDoc.addPage([pageWidth, pageHeight]);
        const form = pdfDoc.getForm();
        const subtitle = (entry.partLabels || []).filter(Boolean).join(' + ');
        drawHeader(page, projectName, subtitle, namingLine, pageNum);

        const currentUnit = document.getElementById('unitSelector')?.value || 'inch';
        const splitGap = 14;
        const leftPaneW = layout.contentWidth * 0.56;
        const rightPaneW = layout.contentWidth - leftPaneW - splitGap;
        const leftPaneX = layout.marginX;
        const rightPaneX = leftPaneX + leftPaneW + splitGap;

        const topStartY = layout.contentTop;
        const leftStartY = drawSectionHeader(page, 'Main Piece', topStartY, leftPaneX);
        const rightStartY = drawSectionHeader(page, 'Main Measurements', topStartY, rightPaneX);

        const heroFrame = drawImageFrame(page, heroImage, leftPaneW - 10, 250, leftStartY + 2, {
          columnX: leftPaneX,
          columnWidth: leftPaneW,
        });
        page.drawText(safePdfText(`${formatTargetDisplayName(heroTarget)} (main)`).slice(0, 64), {
          x: leftPaneX + 4,
          y: heroFrame.imgY - 12,
          size: typo.small,
          font,
          color: colors.textSecondary,
        });

        const heroData = getTargetStrokes(heroTarget.scopeKey, heroTarget.includeBase);
        let rightEndY = rightStartY;
        if (heroData.strokes.length > 0) {
          const drawMainTable = drawMeasurementTable(
            page,
            heroData.strokes,
            heroData.measurements,
            currentUnit,
            heroTarget.scopeKey,
            i,
            form,
            { tableX: rightPaneX, tableW: rightPaneW }
          );
          rightEndY = drawMainTable(rightStartY);
        }

        const relatedMeasurementGroups = [];
        (entry.relatedTargets || []).forEach(target => {
          const { strokes, measurements } = getTargetStrokes(target.scopeKey, target.includeBase);
          const targetName = formatTargetDisplayName(target);
          const rows = [];
          strokes.forEach((strokeLabel, idx) => {
            const m = measurements[strokeLabel] || {};
            let measurementValue = '';
            if (currentUnit === 'inch') {
              const whole = m.inchWhole || 0;
              const frac = m.inchFraction || 0;
              measurementValue =
                whole > 0 || frac > 0
                  ? `${whole > 0 ? whole + '"' : ''}${frac > 0 ? ' ' + frac.toFixed(2) + '"' : ''}`.trim()
                  : '';
            } else {
              measurementValue = m.cm ? `${m.cm.toFixed(1)} cm` : '';
            }
            rows.push({
              strokeLabel,
              measurementValue,
              rowIndex: idx,
            });
          });

          if (rows.length > 0) {
            relatedMeasurementGroups.push({
              targetName,
              scopeKey: target.scopeKey,
              rows,
            });
          }
        });

        const maxGroupCards = 4;
        const visibleGroupCards = relatedMeasurementGroups.slice(0, maxGroupCards);
        const maxRowsPerCard = 4;
        const cardGap = 10;
        const cardCols = visibleGroupCards.length > 1 ? 2 : 1;
        const cardW =
          cardCols === 1
            ? layout.contentWidth
            : (layout.contentWidth - cardGap * (cardCols - 1)) / cardCols;
        const cardH = 28 + maxRowsPerCard * 18 + 12;
        const cardRows = visibleGroupCards.length
          ? Math.ceil(visibleGroupCards.length / cardCols)
          : 0;
        const relatedCardsH = cardRows > 0 ? cardRows * cardH + (cardRows - 1) * cardGap + 26 : 0;
        const relatedCardsY = layout.contentBottom + 6;
        const relatedGridBottom = relatedCardsY + relatedCardsH + 10;

        const relatedSectionTop = Math.min(heroFrame.imgY - 24, rightEndY - 12);
        if (relatedFrames.length > 0) {
          const sectionTop = drawSectionHeader(
            page,
            'Related Frames',
            relatedSectionTop,
            layout.marginX
          );
          const sectionBottom = Math.max(layout.contentBottom + 48, relatedGridBottom);
          const sectionHeight = Math.max(70, sectionTop - sectionBottom);

          const maxCols = 4;
          const cols = Math.min(maxCols, Math.max(1, Math.ceil(Math.sqrt(relatedFrames.length))));
          const rows = Math.max(1, Math.ceil(relatedFrames.length / cols));
          const gap = 8;
          const cellW = (layout.contentWidth - gap * (cols - 1)) / cols;
          const cellH = (sectionHeight - gap * (rows - 1)) / rows;

          relatedFrames.forEach((frameEntry, idx) => {
            const row = Math.floor(idx / cols);
            const col = idx % cols;
            const colX = layout.marginX + col * (cellW + gap);
            const rowTop = sectionTop - row * (cellH + gap);
            const frame = drawImageFrame(page, frameEntry.image, cellW - 8, cellH - 18, rowTop, {
              columnX: colX,
              columnWidth: cellW,
            });
            const caption = formatTargetDisplayName(frameEntry.target);
            page.drawText(safePdfText(caption).slice(0, 36), {
              x: colX + 2,
              y: Math.max(sectionBottom, frame.imgY - 10),
              size: typo.small,
              font,
              color: colors.textSecondary,
            });
          });
        }

        if (visibleGroupCards.length > 0) {
          const sectionTitleY = relatedCardsY + relatedCardsH - 14;
          page.drawText('Related Measurements', {
            x: layout.marginX,
            y: sectionTitleY,
            size: typo.tableHeader,
            font: fontBold,
            color: colors.textPrimary,
          });

          visibleGroupCards.forEach((group, groupIdx) => {
            const gridRow = Math.floor(groupIdx / cardCols);
            const gridCol = groupIdx % cardCols;
            const cardX = layout.marginX + gridCol * (cardW + cardGap);
            const cardTopY = sectionTitleY - 8 - gridRow * (cardH + cardGap);
            const cardY = cardTopY - cardH;
            const safeScope = sanitizePdfFieldPart(
              group.scopeKey,
              `scope_${i + 1}_${groupIdx + 1}`
            );

            page.drawRectangle({
              x: cardX,
              y: cardY,
              width: cardW,
              height: cardH,
              color: colors.panelBg,
              borderColor: colors.border,
              borderWidth: 0.75,
            });

            page.drawRectangle({
              x: cardX,
              y: cardTopY - 18,
              width: cardW,
              height: 18,
              color: colors.accentStripe,
            });
            page.drawText(safePdfText(group.targetName).slice(0, 28), {
              x: cardX + 8,
              y: cardTopY - 12,
              size: typo.small,
              font: fontBold,
              color: colors.white,
            });

            const labelColW = cardW * 0.44;
            const valueColW = cardW - labelColW - 12;
            const visibleRows = group.rows.slice(0, maxRowsPerCard);
            visibleRows.forEach((row, rowIdx) => {
              const rowY = cardTopY - 36 - rowIdx * 18;
              if (rowIdx % 2 === 0) {
                page.drawRectangle({
                  x: cardX + 1,
                  y: rowY - 2,
                  width: cardW - 2,
                  height: 18,
                  color: colors.white,
                });
              }
              page.drawText(safePdfText(row.strokeLabel).slice(0, 14), {
                x: cardX + 8,
                y: rowY + 3,
                size: typo.small,
                font: fontBold,
                color: colors.textPrimary,
              });

              const safeStroke = sanitizePdfFieldPart(row.strokeLabel, `s_${rowIdx + 1}`);
              const fieldName = createUniquePdfFieldName(
                `gm_${safeScope}_${safeStroke}_${row.rowIndex + 1}`,
                usedFieldNames
              );
              const textField = form.createTextField(fieldName);
              textField.setText(row.measurementValue || '');
              textField.addToPage(page, {
                x: cardX + labelColW,
                y: rowY + 1,
                width: valueColW,
                height: 14,
                borderWidth: 0.75,
                borderColor: colors.border,
                backgroundColor: colors.white,
              });
              textField.setFontSize(typo.small);
            });

            if (group.rows.length > maxRowsPerCard) {
              page.drawText(`+${group.rows.length - maxRowsPerCard} more`, {
                x: cardX + 8,
                y: cardY + 6,
                size: typo.small,
                font,
                color: colors.textMuted,
              });
            }
          });

          if (relatedMeasurementGroups.length > maxGroupCards) {
            page.drawText(`+${relatedMeasurementGroups.length - maxGroupCards} related pieces`, {
              x: layout.marginX,
              y: relatedCardsY + 4,
              size: typo.small,
              font,
              color: colors.textMuted,
            });
          }
        }

        drawFooter(page, pageNum);
      } else {
        // ── Single page (existing logic) ──
        const target = entry.target;
        const { viewId, tabId, tabName, scopeKey, includeBase } = target;
        progressText.textContent = `Processing ${viewId} \u2013 ${tabName} (${i + 1}/${groupedTargets.length})\u2026`;
        progressBar.style.width = `${(i / groupedTargets.length) * 100}%`;

        const image = await captureViewImage(viewId, tabId);
        if (!image) continue;

        const page = pdfDoc.addPage([pageWidth, pageHeight]);
        const form = pdfDoc.getForm();

        // Page label
        const partLabel =
          partLabels[viewId] || `view-${String(target.viewIndex + 1).padStart(2, '0')}`;
        const pageLabel = `${partLabel} - ${tabName}`;

        // Header
        drawHeader(page, projectName, pageLabel, namingLine, pageNum);

        // Image frame — allocate space based on whether we have measurements
        const { strokes, measurements } = getTargetStrokes(scopeKey, includeBase);

        const hasMeasurements = strokes.length > 0;
        // Reserve space: if measurements exist, cap image height to leave room for table
        const maxImgH = hasMeasurements
          ? Math.min(340, layout.contentTop - layout.contentBottom - strokes.length * 22 - 80)
          : layout.contentTop - layout.contentBottom - 20;
        const imgMaxH = Math.max(180, maxImgH);

        const { imgY } = drawImageFrame(
          page,
          image,
          layout.contentWidth - 20,
          imgMaxH,
          layout.contentTop
        );

        // Measurements table
        if (hasMeasurements) {
          const currentUnit = document.getElementById('unitSelector')?.value || 'inch';
          const tableStartY = imgY - 16;
          const drawTable = drawMeasurementTable(
            page,
            strokes,
            measurements,
            currentUnit,
            scopeKey,
            i,
            form
          );
          drawTable(tableStartY);
        }

        // Footer
        drawFooter(page, pageNum);
      }
    }

    // ── Evaluate relationships AFTER image loop (all views now loaded) ──
    let relations = { checks: [], connections: [], pieceGroups: [] };
    if (hasRelationshipPage && typeof window.evaluateMeasurementRelations === 'function') {
      try {
        relations = window.evaluateMeasurementRelations() || relations;
      } catch (error) {
        console.warn('[PDF] Failed to evaluate measurement relations, continuing:', error);
      }
    }

    // ── Relationship Summary Page ────────────────────────────────────
    if (hasRelationshipPage) {
      const page = pdfDoc.addPage([pageWidth, pageHeight]);
      const pageNum = groupedTargets.length + 1;

      drawHeader(page, projectName, 'Measurement Checks & Connections', namingLine, pageNum);

      let y = layout.contentTop;
      const cardPadX = 10;
      const cardW = layout.contentWidth;

      // Helper to start a new page if needed
      const checkPageBreak = neededHeight => {
        if (y - neededHeight < layout.contentBottom) {
          return false;
        }
        return true;
      };

      // ── Checks Section ──
      if (relations.checks?.length > 0) {
        y = drawSectionHeader(page, 'Checks', y);
        y -= 4;

        relations.checks.forEach(check => {
          if (!checkPageBreak(42)) return;

          const cardH = 36;
          // Card background
          page.drawRectangle({
            x: layout.marginX,
            y: y - cardH,
            width: cardW,
            height: cardH,
            color: colors.accentLight,
            borderColor: colors.borderLight,
            borderWidth: 0.5,
          });

          // Status badge
          const badgeW = drawStatusBadge(page, check.status, layout.marginX + cardPadX, y - 10);

          // Formula in monospace
          const formulaText = safePdfText(check.formula || check.id || 'Check');
          page.drawText(formulaText.slice(0, 80), {
            x: layout.marginX + cardPadX + badgeW + 8,
            y: y - 10,
            size: typo.table,
            font: fontMono,
            color: colors.textPrimary,
          });

          // Reason (if not pending)
          const isPending = String(check.status || '').toLowerCase() === 'pending';
          if (!isPending && check.reason) {
            page.drawText(safePdfText(check.reason).slice(0, 100), {
              x: layout.marginX + cardPadX,
              y: y - 26,
              size: typo.small,
              font,
              color: colors.textSecondary,
            });
          }

          y -= cardH + 6;
        });

        y -= 8;
      }

      // ── Connections Section (per-measurement links with status) ──
      if (relations.connections?.length > 0) {
        if (checkPageBreak(40)) {
          y = drawSectionHeader(page, 'Cross-image Connections', y);
          y -= 4;

          relations.connections.forEach(connection => {
            if (!checkPageBreak(42)) return;

            const cardH = 36;
            // Card background
            page.drawRectangle({
              x: layout.marginX,
              y: y - cardH,
              width: cardW,
              height: cardH,
              color: colors.accentLight,
              borderColor: colors.borderLight,
              borderWidth: 0.5,
            });

            // Status badge
            const badgeW = drawStatusBadge(
              page,
              connection.status,
              layout.marginX + cardPadX,
              y - 10
            );

            // Connection text: "FromDisplay <-> ToDisplay"
            const fromLabel = safePdfText(connection.fromDisplay || connection.fromKey || '-');
            const toLabel = safePdfText(connection.toDisplay || connection.toKey || '-');
            const connText = `${fromLabel}  <->  ${toLabel}`;
            page.drawText(connText.slice(0, 80), {
              x: layout.marginX + cardPadX + badgeW + 8,
              y: y - 10,
              size: typo.table,
              font: fontMono,
              color: colors.textPrimary,
            });

            // Reason line
            const isPending = String(connection.status || '').toLowerCase() === 'pending';
            if (!isPending && connection.reason) {
              page.drawText(safePdfText(connection.reason).slice(0, 100), {
                x: layout.marginX + cardPadX,
                y: y - 26,
                size: typo.small,
                font,
                color: colors.textSecondary,
              });
            }

            y -= cardH + 6;
          });

          y -= 8;
        }
      }

      // ── Piece Groups Section (lightweight listing) ──
      const summaryPieceGroups = relations.pieceGroups || metaPieceGroups;
      if (summaryPieceGroups.length > 0) {
        if (checkPageBreak(40)) {
          y = drawSectionHeader(page, 'Piece Groups', y);
          page.drawText('Grouped images appear side-by-side in the PDF.', {
            x: layout.marginX,
            y: y + 4,
            size: typo.small,
            font,
            color: colors.textSecondary,
          });
          y -= 14;

          summaryPieceGroups.forEach((group, gIdx) => {
            if (!checkPageBreak(22)) return;

            const rowH = 18;
            if (gIdx % 2 === 0) {
              page.drawRectangle({
                x: layout.marginX,
                y: y - rowH + 4,
                width: cardW,
                height: rowH,
                color: colors.tableRowAlt,
              });
            }

            const mainLabel = safePdfText(partLabels[group.mainViewId] || group.mainViewId || '-');
            const relatedLabels = (group.relatedViewIds || [])
              .map(id => safePdfText(partLabels[id] || id || '-'))
              .join(', ');
            const groupText = `${mainLabel}  +  ${relatedLabels || 'none'}`;
            page.drawText(groupText.slice(0, 90), {
              x: layout.marginX + cardPadX,
              y: y - 8,
              size: typo.table,
              font: fontBold,
              color: colors.textPrimary,
            });

            y -= rowH + 2;
          });
        }
      }

      drawFooter(page, pageNum);
    }

    progressBar.style.width = '100%';
    progressText.textContent = 'Saving PDF\u2026';
    const pdfBytes = await pdfDoc.save();
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sanitizeFilenamePart(projectName, 'OpenPaint Project')}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
    console.log('[PDF] Generated with editable form fields using pdf-lib');
  }
}
