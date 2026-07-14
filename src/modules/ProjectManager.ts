// Project Manager
/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-misused-promises, @typescript-eslint/prefer-regexp-exec, @typescript-eslint/return-await, prefer-rest-params, no-inner-declarations */
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
// Handles views (images) and their associated canvas states

import { imageRegistry } from './ImageRegistry.js';
import {
  createDefaultSofaMetadata,
  mergeSofaMetadata,
  normalizeSofaMetadata,
} from './sofa-metadata.js';
import { FabricControls } from './utils/FabricControls.js';
import { sanitizeFilenamePart } from './utils/naming-utils.js';
import { normalizeCloudError } from './cloud/error-normalizer.js';
import { CLOUD_COPY } from './cloud/messages.js';
import { decideFinalSaveMessageKey, formatSaveOutcomeLines } from './cloud/result-factory.js';
import { fitViewportToWorldRect, getCenteredBoxWorldRect } from './utils/viewportRestore.ts';
import JSZip from 'jszip';

export class ProjectManager {
  constructor(canvasManager, historyManager) {
    this.canvasManager = canvasManager;
    this.historyManager = historyManager;
    this.isLoadingProject = false;
    this.suspendSave = false;
    this.isSwitchingView = false;
    this.isHydratingDeferredViews = false;
    this.hydrationPinnedViewId = null;
    this.pendingSwitchViewId = null;
    this.loadedProjectObjectUrls = [];
    this.remoteImageObjectUrlCache = new Map();
    this.remoteImageObjectKeyByUrl = new Map();
    this.backgroundLoadGenerationByCanvas = new WeakMap();
    // Original upload files are the most reliable cloud-save source. Blob URLs
    // are document-scoped and Safari can no longer fetch them after a gallery
    // or image element has released the underlying resource.
    this.viewImageFiles = new Map();
    this.projectLoadOverlayEl = null;
    this.activeArchiveZip = null;
    this.projectMetadata = createDefaultSofaMetadata();
    window.projectMetadata = this.getProjectMetadata();

    // Project Data
    this.currentViewId = 'front';
    this.views = {
      front: {
        id: 'front',
        image: null,
        imageAssetHash: null,
        imageContentType: null,
        imageSourceFingerprint: null,
        canvasData: null,
        metadata: null,
        rotation: 0,
        backgroundRotation: 0,
        tabs: null,
        viewport: null,
      },
      side: {
        id: 'side',
        image: null,
        imageAssetHash: null,
        imageContentType: null,
        imageSourceFingerprint: null,
        canvasData: null,
        metadata: null,
        rotation: 0,
        backgroundRotation: 0,
        tabs: null,
        viewport: null,
      },
      back: {
        id: 'back',
        image: null,
        imageAssetHash: null,
        imageContentType: null,
        imageSourceFingerprint: null,
        canvasData: null,
        metadata: null,
        rotation: 0,
        backgroundRotation: 0,
        tabs: null,
        viewport: null,
      },
      cushion: {
        id: 'cushion',
        image: null,
        imageAssetHash: null,
        imageContentType: null,
        imageSourceFingerprint: null,
        canvasData: null,
        metadata: null,
        rotation: 0,
        backgroundRotation: 0,
        tabs: null,
        viewport: null,
      },
    };
  }

  getR2ObjectKeyForViewData(viewData) {
    if (!viewData || typeof viewData !== 'object') return null;
    const candidates = [
      viewData.imageUrl,
      viewData.imageAssetPath,
      viewData.canvasJSON?.backgroundImage?.src,
    ];
    for (const candidate of candidates) {
      const key = this.extractR2ObjectKeyFromUrl(candidate);
      if (key) return key;
    }
    return null;
  }

  init() {
    console.log('ProjectManager initialized');
    // Load the initial view
    this.switchView('front');
  }

  getProjectMetadata() {
    return normalizeSofaMetadata(this.projectMetadata);
  }

  setProjectMetadata(patch = {}) {
    this.projectMetadata = mergeSofaMetadata(this.projectMetadata, patch);
    window.projectMetadata = this.getProjectMetadata();
    return this.getProjectMetadata();
  }

  setSofaType(sofaType, customSofaType = '') {
    return this.setProjectMetadata({ sofaType, customSofaType });
  }

  setCanvasManager(canvasManager, historyManager = null) {
    if (canvasManager) {
      this.canvasManager = canvasManager;
    }
    if (historyManager) {
      this.historyManager = historyManager;
    }
  }

  syncUiForView(viewId) {
    window.currentImageLabel =
      (typeof window.getCaptureTabScopedLabel === 'function' &&
        window.getCaptureTabScopedLabel(viewId)) ||
      viewId;

    if (window.updateNextTagDisplay) {
      window.updateNextTagDisplay();
    }
    if (window.ensureCaptureTabsForLabel) {
      window.ensureCaptureTabsForLabel(viewId);
    }
    if (window.renderCaptureTabUI) {
      window.renderCaptureTabUI(viewId);
    }
    if (window.applyCaptureFrameForLabel) {
      window.applyCaptureFrameForLabel(viewId);
    }
    this.syncLegacyImageListSelection(viewId);
  }

  async setBackgroundImageOnCanvasManager(
    url,
    canvasManager,
    fitMode = 'fit-canvas',
    viewId = this.currentViewId
  ) {
    if (!canvasManager) return;
    const previousCanvasManager = this.canvasManager;
    const previousViewId = this.currentViewId;
    this.canvasManager = canvasManager;
    this.currentViewId = viewId;
    try {
      await this.setBackgroundImage(url, fitMode);
    } finally {
      this.canvasManager = previousCanvasManager;
      this.currentViewId = previousViewId;
    }
  }

  restoreViewportForViewOnCanvasManager(viewId, canvasManager) {
    if (!viewId || !canvasManager) return;
    const previousCanvasManager = this.canvasManager;
    this.canvasManager = canvasManager;
    try {
      // Comparison and guide canvases have their own dimensions. Their view is
      // intentionally fitted to the pane instead of replaying the main canvas's
      // pixel-exact viewport transform.
      this.restoreViewportForView(viewId, { useExactTransform: false });
    } finally {
      this.canvasManager = previousCanvasManager;
    }
  }

  async loadViewIntoCanvasManager(viewId, canvasManager, options = {}) {
    if (!viewId || !canvasManager?.fabricCanvas || !this.views?.[viewId]) {
      return;
    }

    const interactive = options?.interactive === true;
    const previousViewId = this.currentViewId;
    const view = this.views[viewId];

    canvasManager.fabricCanvas.discardActiveObject?.();
    canvasManager.clear();

    if (typeof view.rotation === 'number') {
      if (canvasManager.isGuideSplitActive()) {
        canvasManager.rotationDegrees = ((view.rotation % 360) + 360) % 360;
      } else {
        canvasManager.setRotationDegrees(view.rotation);
      }
      this.updateThumbnailRotation(viewId, view.rotation);
    }

    if (view.image) {
      await this.setBackgroundImageOnCanvasManager(
        view.image,
        canvasManager,
        view.fitMode || 'fit-canvas',
        viewId
      );
    }

    if (view.canvasData) {
      let sanitizedData = this.sanitizeCanvasJSON(view.canvasData);
      if (sanitizedData?.backgroundImage && view.image) {
        sanitizedData = { ...sanitizedData };
        delete sanitizedData.backgroundImage;
      }

      await new Promise(resolve => {
        canvasManager.loadFromJSON(sanitizedData, () => resolve());
      });
    }

    if (view.image) {
      const currentBgSrc = canvasManager?.fabricCanvas?.backgroundImage?.src;
      if (!currentBgSrc || currentBgSrc !== view.image) {
        await this.setBackgroundImageOnCanvasManager(
          view.image,
          canvasManager,
          view.fitMode || 'fit-canvas',
          viewId
        );
      }
    }

    this.restoreViewportForViewOnCanvasManager(viewId, canvasManager);

    if (!interactive) {
      canvasManager.fabricCanvas?.requestRenderAll?.();
      return;
    }

    if (window.app?.measurementOverlayManager?.unmountView && previousViewId) {
      window.app.measurementOverlayManager.unmountView(previousViewId);
    }

    this.currentViewId = viewId;
    this.syncUiForView(viewId);

    if (view.metadata && window.app?.metadataManager) {
      const scopedVectors = view.metadata.vectorStrokesByImage || {};
      const scopedVisibility = view.metadata.strokeVisibilityByImage || {};
      const scopedLabelVisibility = view.metadata.strokeLabelVisibility || {};

      Object.entries(scopedVectors).forEach(([key, value]) => {
        window.app.metadataManager.vectorStrokesByImage[key] = value || {};
      });
      Object.entries(scopedVisibility).forEach(([key, value]) => {
        window.app.metadataManager.strokeVisibilityByImage[key] = value || {};
      });
      Object.entries(scopedLabelVisibility).forEach(([key, value]) => {
        window.app.metadataManager.strokeLabelVisibility[key] = value || {};
      });
      this.deserializeMeasurements(viewId, view.metadata.strokeMeasurements || {});
    } else if (window.app?.metadataManager) {
      window.app.metadataManager.clearImageMetadata(viewId);
    }

    if (window.app?.metadataManager) {
      window.app.metadataManager.rebuildMetadataFromCanvas(viewId, canvasManager.fabricCanvas);
    }

    if (window.app?.tagManager && window.app?.metadataManager) {
      window.app.tagManager.clearAllTags?.();
      const activeScope =
        window.getCaptureTabScopedLabel?.(viewId) ||
        window.app.metadataManager.resolveActiveImageLabel?.(viewId) ||
        viewId;
      const strokes = window.app.metadataManager.vectorStrokesByImage[activeScope] || {};
      const labelVisibility = window.app.metadataManager.strokeLabelVisibility[activeScope] || {};
      Object.entries(strokes).forEach(([strokeLabel, strokeObj]) => {
        if (labelVisibility[strokeLabel] !== false) {
          window.app.tagManager.createTag(strokeLabel, activeScope, strokeObj);
        }
      });
      if (typeof window.syncCaptureTabCanvasVisibility === 'function') {
        window.syncCaptureTabCanvasVisibility(viewId);
      }
    }

    this.historyManager?.clear?.();
    this.historyManager?.saveState?.();

    if (window.app?.measurementOverlayManager?.mountView) {
      window.app.measurementOverlayManager.mountView(viewId);
    }

    const liveRotation = canvasManager?.getRotationDegrees?.();
    if (typeof liveRotation === 'number' && this.views[viewId]) {
      this.views[viewId].rotation = liveRotation;
      this.updateThumbnailRotation(viewId, liveRotation);
    }

    window.dispatchEvent(
      new CustomEvent('openpaint:view-switched', {
        detail: { viewId, previousViewId, source: 'load-view-into-canvas' },
      })
    );
  }

  // Switch to a different view (image)
  async switchView(viewId, force = false) {
    if (
      this.isHydratingDeferredViews &&
      this.hydrationPinnedViewId &&
      viewId !== this.hydrationPinnedViewId
    ) {
      console.log(`[Load] Delaying switch to ${viewId} until deferred image hydration finishes`);
      this.pendingSwitchViewId = viewId;
      return;
    }

    if (this.isSwitchingView) {
      this.pendingSwitchViewId = viewId;
      return;
    }
    this.isSwitchingView = true;
    try {
      if (!this.views[viewId]) {
        console.warn(`View ${viewId} does not exist.`);
        return;
      }

      // During archive/cloud hydration the canvas still holds whichever view was
      // visible before the project was opened. `loadFromJSON()` replaces it with
      // already scope-filtered saved data, so removing "out-of-scope" live
      // objects here can delete transitional objects and flood the console.
      const shouldCleanLiveScope =
        !this.isLoadingProject &&
        !window.__isLoadingProject &&
        !this.isHydratingDeferredViews &&
        !window.__deferredImageHydrationInProgress;

      // During project hydration the archive data is authoritative. Avoid pulling stale sidebar
      // DOM state back into the freshly restored view map before the load completes.
      if (
        !this.isLoadingProject &&
        !window.__isLoadingProject &&
        !this.isHydratingDeferredViews &&
        !window.__deferredImageHydrationInProgress
      ) {
        this.syncViewImageFromDom(viewId);
      }

      // If already on this view, don't clear everything (unless forced)
      if (this.currentViewId === viewId && !force) {
        console.log(`Already on view: ${viewId}, refreshing image only`);
        const view = this.views[viewId];
        const backgroundImage = this.canvasManager?.fabricCanvas?.backgroundImage;
        const currentImageSource = String(
          backgroundImage?.getSrc?.() ||
            backgroundImage?._element?.currentSrc ||
            backgroundImage?._element?.src ||
            backgroundImage?.src ||
            ''
        ).trim();
        // Gallery/scroll synchronisation can ask for the current view again.
        // Recreating the background here resets a correctly restored zoom.
        if (view.image && (!backgroundImage || currentImageSource !== view.image)) {
          await this.setBackgroundImage(view.image);
        }
        if (typeof view.rotation === 'number') {
          if (this.canvasManager.isGuideSplitActive()) {
            this.canvasManager.rotationDegrees = ((view.rotation % 360) + 360) % 360;
          } else {
            this.canvasManager.setRotationDegrees(view.rotation);
          }
          this.updateThumbnailRotation(viewId, view.rotation);
        }

        // Update global currentImageLabel and next tag display
        window.currentImageLabel =
          (typeof window.getCaptureTabScopedLabel === 'function' &&
            window.getCaptureTabScopedLabel(viewId)) ||
          viewId;
        if (window.updateNextTagDisplay) {
          window.updateNextTagDisplay();
        }

        if (window.ensureCaptureTabsForLabel) {
          window.ensureCaptureTabsForLabel(viewId);
        }
        if (window.applyCaptureFrameForLabel) {
          window.applyCaptureFrameForLabel(viewId);
        }
        this.restoreViewportForView(viewId);
        if (window.renderCaptureTabUI) {
          window.renderCaptureTabUI(viewId);
        }
        this.syncLegacyImageListSelection(viewId);
        if (window.imageGallery?.syncToLabel) {
          window.imageGallery.syncToLabel(viewId, { scroll: true, smooth: false });
        }

        const liveRotation = this.canvasManager?.getRotationDegrees?.();
        if (typeof liveRotation === 'number') {
          view.rotation = liveRotation;
          this.updateThumbnailRotation(viewId, liveRotation);
        }

        window.dispatchEvent(
          new CustomEvent('openpaint:view-switched', {
            detail: { viewId, previousViewId: viewId, source: 'switch-view-refresh' },
          })
        );

        return;
      }

      console.log(`Switching to view: ${viewId}`);

      // Fabric's loadFromJSON clears the lower canvas before the target image
      // and objects are ready. Keep the last fully rendered frame above it so
      // users never see that destructive intermediate paint.
      const liveCanvas = this.canvasManager?.fabricCanvas;
      const liveCanvasWidth = Number(liveCanvas?.width) || 0;
      const liveCanvasHeight = Number(liveCanvas?.height) || 0;
      if (liveCanvasWidth > 0 && liveCanvasHeight > 0) {
        this.canvasManager.showResizeOverlay?.(liveCanvasWidth, liveCanvasHeight);
      }

      if (
        document.getElementById('main-canvas-wrapper')?.classList.contains('guide-split-active') ===
        true
      ) {
        window.dispatchEvent(
          new CustomEvent('openpaint:guide-split-transition-start', {
            detail: { viewId, previousViewId: this.currentViewId, source: 'switch-view' },
          })
        );
      }

      // Save target view's initial state BEFORE saveCurrentViewState might pollute it.
      // This happens when switching to the same view (force=true) — saveCurrentViewState
      // saves canvasData/viewport for currentViewId which IS the target.
      const targetViewInitState = {
        hadCanvasData: !!this.views[viewId]?.canvasData,
        hadViewport: !!this.views[viewId]?.viewport,
      };

      // 1. Save current state (skip during project load to avoid clobbering loaded data)
      if (
        !this.isLoadingProject &&
        !this.suspendSave &&
        !window.__isLoadingProject &&
        !window.__suspendSaveCurrentView
      ) {
        if (window.captureTabsSyncActive) {
          window.captureTabsSyncActive(this.currentViewId, { preserveWorldRect: true });
        }
        this.saveCurrentViewState();
      } else {
        console.log('[Load] Skipping saveCurrentViewState during project load');
      }

      // 2. Clear history for the new view (or we could maintain separate history stacks per view)
      this.historyManager.clear();

      // 3. Switch context
      const previousViewId = this.currentViewId;
      this.currentViewId = viewId;
      const view = this.views[viewId];

      // Update global currentImageLabel for tag prediction system
      window.currentImageLabel =
        (typeof window.getCaptureTabScopedLabel === 'function' &&
          window.getCaptureTabScopedLabel(viewId)) ||
        viewId;

      // Update next tag display to start from A1 (or A) for the new image
      if (window.updateNextTagDisplay) {
        window.updateNextTagDisplay();
      }

      if (window.app?.tagManager?.syncTagSizeFromMetadata) {
        window.app.tagManager.syncTagSizeFromMetadata(viewId);
      }

      // Apply rotation for the new view
      // During split mode, only store the rotation value without triggering
      // applyViewportTransform — the split layout sync handles viewport.
      if (typeof view.rotation === 'number') {
        if (this.canvasManager.isGuideSplitActive()) {
          this.canvasManager.rotationDegrees = ((view.rotation % 360) + 360) % 360;
        } else {
          this.canvasManager.setRotationDegrees(view.rotation);
        }
        this.updateThumbnailRotation(viewId, view.rotation);
      }

      // 3b. Unmount MOS overlays for the old view
      if (window.app?.measurementOverlayManager) {
        window.app.measurementOverlayManager.unmountView(previousViewId);
      }

      // 4. Discard selection so control anchors don't persist across views
      this.canvasManager.fabricCanvas?.discardActiveObject();
      // Only clear canvas eagerly when there's no canvasData to load (loadFromJSON clears internally).
      // Skipping the early clear prevents a visible white flash in split mode.
      if (!view.canvasData) {
        this.canvasManager.clear();
      }
      if (shouldCleanLiveScope && !view.canvasData) {
        this.removeCanvasObjectsOutsideViewScope(viewId);
      }

      // Check BEFORE applyCaptureFrameForLabel runs — that call creates stored state
      // on capture tabs. For new views without saved viewport state, the fit pipeline
      // in setBackgroundImage is the authoritative positioner.
      const hasNoStoredViewportState =
        !targetViewInitState.hadCanvasData &&
        !targetViewInitState.hadViewport &&
        !window.captureTabsByLabel?.[viewId]?.tabs?.some(tab => tab?.captureFrame?.worldRect);

      if (window.ensureCaptureTabsForLabel) {
        window.ensureCaptureTabsForLabel(viewId);
      }
      if (window.renderCaptureTabUI) {
        window.renderCaptureTabUI(viewId);
      }
      if (window.applyCaptureFrameForLabel) {
        window.applyCaptureFrameForLabel(viewId);
      }

      // 5. Load background image if exists
      let skipViewportRestore = false;
      if (view.image) {
        const fitMode = view.fitMode || 'fit-canvas';
        await this.setBackgroundImage(view.image, fitMode);
        skipViewportRestore =
          (fitMode === 'scale-page-size' || fitMode === 'fill-frame') && hasNoStoredViewportState;

        // Auto-fit the capture frame to the image bounds if no frame exists yet.
        // We set the tab's captureFrame.worldRect so applyCaptureFrameForLabel
        // uses it instead of falling back to the default 4:3 rect.
        const tabsState = window.captureTabsByLabel?.[viewId];
        const activeTab = tabsState?.tabs?.find((t: any) => t.id === tabsState?.activeTabId);
        const hasFrame = activeTab?.captureFrame?.worldRect || view.backgroundWorldRect;
        if (!hasFrame) {
          const bg = this.canvasManager?.fabricCanvas?.backgroundImage;
          if (bg) {
            const bw =
              (typeof bg.getScaledWidth === 'function'
                ? bg.getScaledWidth()
                : bg.width * bg.scaleX) || 0;
            const bh =
              (typeof bg.getScaledHeight === 'function'
                ? bg.getScaledHeight()
                : bg.height * bg.scaleY) || 0;
            if (bw > 0 && bh > 0) {
              const center =
                typeof bg.getCenterPoint === 'function'
                  ? bg.getCenterPoint()
                  : { x: bg.left, y: bg.top };
              const worldRect = {
                left: center.x - bw / 2,
                top: center.y - bh / 2,
                width: bw,
                height: bh,
              };
              // Seed the world rect on the active tab so applyCaptureFrameForLabel picks it up
              if (activeTab) {
                activeTab.captureFrame = activeTab.captureFrame || {};
                activeTab.captureFrame.worldRect = worldRect;
              }
            }
          }
        }
      }

      // 6. Restore canvas objects (strokes/text)
      if (view.canvasData) {
        console.log(`[switchView] Restoring canvas objects for ${viewId}:`, {
          hasCanvasData: true,
          objectCount: view.canvasData?.objects?.length || 0,
          force,
          suspendSave: window.__suspendSaveCurrentView,
        });
        // Sanitize canvas data and fix image URLs before loading
        let sanitizedData = this.sanitizeCanvasJSON(view.canvasData);
        sanitizedData = this.filterCanvasJsonObjectsForView(sanitizedData, viewId);

        // Background images are restored separately via setBackgroundImage().
        // Keeping Fabric's serialized background image here causes duplicate async loads
        // and can race with the manual restore path during cloud project hydration.
        if (sanitizedData.backgroundImage && view.image) {
          delete sanitizedData.backgroundImage;
          console.log(`[Load] Removed serialized background image for ${viewId}`);
        }

        // Strip viewportTransform from canvas JSON when guide-split is active.
        // The saved viewport was captured at full canvas width; restoring it into a
        // half-width split canvas produces a wrong zoom (e.g. 2× too high). The split
        // layout sync pipeline will set the correct viewport after load.
        const isGuideSplitActiveNow =
          document
            .getElementById('main-canvas-wrapper')
            ?.classList.contains('guide-split-active') === true;
        if (isGuideSplitActiveNow) {
          delete sanitizedData.viewportTransform;
          // Also strip canvas dimensions — the saved JSON has full-width values (e.g. 1920)
          // which Fabric.js restores, causing a brief render at the wrong size before the
          // split layout sync resizes to the split half-width (e.g. 960).
          delete sanitizedData.width;
          delete sanitizedData.height;
        }

        console.log(
          `[switchView] Calling loadFromJSON with ${sanitizedData?.objects?.length || 0} objects`
        );
        await new Promise(resolve => {
          this.canvasManager.loadFromJSON(sanitizedData, async () => {
            console.log(
              `[switchView] loadFromJSON callback - objects on canvas:`,
              this.canvasManager.fabricCanvas?.getObjects()?.length
            );
            // Restore metadata for this view
            if (view.metadata && window.app?.metadataManager) {
              const scopedVectors = view.metadata.vectorStrokesByImage || {};
              const scopedVisibility = view.metadata.strokeVisibilityByImage || {};
              const scopedLabelVisibility = view.metadata.strokeLabelVisibility || {};

              Object.entries(scopedVectors).forEach(([key, value]) => {
                window.app.metadataManager.vectorStrokesByImage[key] = value || {};
              });
              Object.entries(scopedVisibility).forEach(([key, value]) => {
                window.app.metadataManager.strokeVisibilityByImage[key] = value || {};
              });
              Object.entries(scopedLabelVisibility).forEach(([key, value]) => {
                window.app.metadataManager.strokeLabelVisibility[key] = value || {};
              });

              // Deserialize measurements with validation
              this.deserializeMeasurements(viewId, view.metadata.strokeMeasurements || {});
            }

            // After loading, update history initial state
            this.historyManager.saveState();

            // Rebuild metadata from canvas objects to ensure live references
            if (window.app?.metadataManager) {
              window.app.metadataManager.rebuildMetadataFromCanvas(
                viewId,
                this.canvasManager.fabricCanvas
              );
            }

            // Recreate custom controls for lines and curves
            const ControlsApi = window.FabricControls || FabricControls;

            const objects = this.canvasManager.fabricCanvas.getObjects();
            objects.forEach(obj => {
              if (obj.type === 'line' && obj.strokeMetadata) {
                ControlsApi.createLineControls(obj);
              } else if (obj.type === 'path' && obj.customPoints) {
                ControlsApi.createCurveControls(obj);
              } else if (
                (obj.type === 'i-text' || obj.type === 'text') &&
                obj.strokeMetadata?.type === 'text'
              ) {
                // Reattach event handlers for text elements loaded from JSON
                obj.on('editing:exited', () => {
                  if (window.app?.historyManager) {
                    window.app.historyManager.saveState();
                  }
                });
              }
            });

            // Recreate tags for all strokes with visible labels
            if (window.app?.tagManager && window.app?.metadataManager) {
              // Clear all tags to avoid collisions between views (e.g., multiple A1 labels)
              if (typeof window.app.tagManager.clearAllTags === 'function') {
                window.app.tagManager.clearAllTags();
              }

              // If the active frame is empty but restored strokes belong to another
              // frame scope, the frame visibility gate hides all vectors. This can
              // happen after CW import image switching creates/normalizes frame tabs
              // in a different order than the drawn stroke scopes.
              this.repairActiveCaptureTabForLoadedObjects(viewId);

              const scopedKeys = Object.keys(
                window.app.metadataManager.vectorStrokesByImage || {}
              ).filter(scopeKey => this.isScopeLabelForView(scopeKey, viewId));
              const activeScope =
                (typeof window.getCaptureTabScopedLabel === 'function' &&
                  window.getCaptureTabScopedLabel(viewId)) ||
                window.app.metadataManager.resolveActiveImageLabel?.(viewId) ||
                viewId;

              const activeStrokes =
                window.app.metadataManager.vectorStrokesByImage[activeScope] || {};
              const activeLabelVisibility =
                window.app.metadataManager.strokeLabelVisibility[activeScope] || {};

              console.log(
                `[Load] Recreating tags for ${Object.keys(activeStrokes).length} active strokes`,
                { viewId, activeScope, scopedKeys }
              );

              Object.entries(activeStrokes).forEach(([strokeLabel, strokeObj]) => {
                // Skip guide-scoped strokes that shouldn't appear on the primary canvas
                if (typeof strokeLabel === 'string' && strokeLabel.startsWith('__guide__:')) return;
                const isLabelVisible = activeLabelVisibility[strokeLabel] !== false;
                if (isLabelVisible) {
                  window.app.tagManager.createTag(strokeLabel, activeScope, strokeObj);
                }
              });

              // Ensure tab-scoped visibility is applied immediately after load.
              if (typeof window.syncCaptureTabCanvasVisibility === 'function') {
                window.syncCaptureTabCanvasVisibility(viewId);
              }
            }

            // Ensure background image is re-applied after JSON load (JSON can clear it)
            if (view.image) {
              const canvas = this.canvasManager?.fabricCanvas;
              const currentBgSrc = canvas?.backgroundImage?.src;
              if (!currentBgSrc || currentBgSrc !== view.image) {
                console.log('[Load] Reapplying background image after JSON load:', viewId);
                await this.setBackgroundImage(view.image, view.fitMode || 'fit-canvas');
              }
            }

            resolve();
          });
        });
      } else {
        // Clear stale tags from previous view when switching to a view with no saved data
        if (window.app?.tagManager?.clearAllTags) {
          window.app.tagManager.clearAllTags();
        }
        // Clear metadata for this view if no saved data
        if (window.app?.metadataManager) {
          if (typeof window.app.metadataManager.clearScopedBucketsForView === 'function') {
            window.app.metadataManager.clearScopedBucketsForView(viewId);
          }
          window.app.metadataManager.clearImageMetadata(viewId);
        }

        this.historyManager.saveState();
      }

      if (shouldCleanLiveScope) {
        this.removeCanvasObjectsOutsideViewScope(viewId);
      }

      if (!skipViewportRestore) {
        this.restoreViewportForView(viewId);
      }

      // If the saved viewport was from a different window/canvas size, the pan
      // values are stale and the image will be off-center. Schedule a SINGLE
      // re-centering pass after geometry settles. Multiple passes cause visible
      // flashing as the image jumps between intermediate positions.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (
            this.currentViewId === viewId &&
            typeof window.__recenterCaptureFrame === 'function'
          ) {
            window.__recenterCaptureFrame(viewId);
          }
        });
      });

      // Mount MOS overlays for the new view
      if (window.app?.measurementOverlayManager) {
        window.app.measurementOverlayManager.mountView(viewId);
      }

      this.syncLegacyImageListSelection(viewId);
      if (window.imageGallery?.syncToLabel) {
        const skipGalleryScroll = !!window.__scrollSelectDrivenSwitch;
        window.imageGallery.syncToLabel(viewId, { scroll: !skipGalleryScroll, smooth: false });
      }

      const liveRotation = this.canvasManager?.getRotationDegrees?.();
      if (typeof liveRotation === 'number' && this.views[viewId]) {
        this.views[viewId].rotation = liveRotation;
        this.updateThumbnailRotation(viewId, liveRotation);
      }

      window.dispatchEvent(
        new CustomEvent('openpaint:view-switched', {
          detail: { viewId, previousViewId, source: 'switch-view' },
        })
      );

      // Gallery and guide listeners can run after the first restore. Reapply only
      // the exact saved matrix once their layout work has settled; unlike the
      // compatibility restore this does not fit, recenter, or mutate the frame.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (this.currentViewId === viewId) {
            this.restoreExactViewportForView(viewId);
          }
        });
      });
      setTimeout(() => {
        if (this.currentViewId === viewId) {
          this.restoreExactViewportForView(viewId);
        }
      }, 260);

      // After all event handlers have fired, sweep for stale tags from other views
      // that may have been created by async listeners during the switch.
      if (window.app?.tagManager?.removeStaleTagsForScope) {
        const sweepScope = window.app.metadataManager?.normalizeImageLabel?.(viewId) || viewId;
        // Sweep synchronously to avoid 1-frame tag crossover flicker
        window.app.tagManager.removeStaleTagsForScope(sweepScope);
        // Sweep after RAF in case async handlers recreated stale tags
        requestAnimationFrame(() => {
          if (this.currentViewId === viewId) {
            window.app.tagManager.removeStaleTagsForScope(sweepScope);
          }
        });
        // Sweep again after double-RAF + delay to catch tags created by
        // guide split layout sync (which uses a double-RAF chain internally)
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (this.currentViewId === viewId) {
              window.app.tagManager.removeStaleTagsForScope(sweepScope);
            }
          });
        });
        // Final safety sweep after all async layout has settled
        setTimeout(() => {
          if (this.currentViewId === viewId && window.app?.tagManager?.removeStaleTagsForScope) {
            window.app.tagManager.removeStaleTagsForScope(sweepScope);
          }
        }, 200);
      }
    } catch (err) {
      console.error('[ProjectManager] switchView error:', err);
    } finally {
      this.isSwitchingView = false;
      this.canvasManager?.hideResizeOverlay?.();
      if (this.pendingSwitchViewId) {
        const nextView = this.pendingSwitchViewId;
        this.pendingSwitchViewId = null;
        this.switchView(nextView, true);
      }
    }
  }

  async whenIdle({ timeoutMs = 5000 } = {}) {
    const startedAt = Date.now();
    while (
      this.isSwitchingView ||
      this.pendingSwitchViewId ||
      this.isLoadingProject ||
      this.isHydratingDeferredViews ||
      window.__deferredImageHydrationInProgress ||
      window.__openpaintCaptureResizeInProgress
    ) {
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error('OpenPaint did not become idle before saving');
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }

  syncViewImageFromDom(viewId) {
    try {
      const escape =
        typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
          ? CSS.escape
          : value => String(value).replace(/"/g, '\\"');
      const container = document.querySelector(`.image-container[data-label="${escape(viewId)}"]`);
      if (!container) return;
      const img = container.querySelector('img');
      const domSrc = img?.getAttribute('src') || container.dataset?.originalImageUrl;
      if (domSrc && this.views?.[viewId] && this.views[viewId].image !== domSrc) {
        this.views[viewId].imageAssetHash = null;
        this.views[viewId].imageContentType = null;
        this.views[viewId].imageSourceFingerprint = null;
        this.views[viewId].image = domSrc;
      }

      const knownRotation = Number(this.views?.[viewId]?.rotation);
      this.updateThumbnailRotation(viewId, Number.isFinite(knownRotation) ? knownRotation : 0);
    } catch (err) {
      console.warn('[ProjectManager] Failed to sync view image from DOM:', err);
    }
  }

  restoreViewportForView(viewId, options = {}) {
    if (!viewId) return;

    // When guide-split is active, skip direct viewport restore — the split layout
    // sync pipeline (runGuideSplitLayoutSync → fitGuideSplitPrimaryBackgroundToFrame)
    // will set the correct viewport after resizing the canvas to split half-width.
    // Calling applyCaptureFrameForLabel here would compute a wrong zoom because the
    // capture overlay is still at full width before the split resize happens.
    const isGuideSplitActive =
      document.getElementById('main-canvas-wrapper')?.classList.contains('guide-split-active') ===
      true;
    if (isGuideSplitActive) {
      return;
    }

    const cloneViewportRecord = viewport => {
      if (!viewport || typeof viewport !== 'object') return null;
      const zoom = Number(viewport.zoom);
      if (!Number.isFinite(zoom) || zoom <= 0) return null;
      return {
        ...JSON.parse(JSON.stringify(viewport)),
        zoom,
        panX: Number.isFinite(Number(viewport.panX)) ? Number(viewport.panX) : 0,
        panY: Number.isFinite(Number(viewport.panY)) ? Number(viewport.panY) : 0,
      };
    };
    // Capture-tab path — handles cross-resolution correctly via geometry-aware
    // fitViewportToWorldRect (which uses current canvas center/dimensions).
    if (
      window.captureTabsByLabel?.[viewId] &&
      typeof window.applyCaptureFrameForLabel === 'function'
    ) {
      const tabs = window.captureTabsByLabel[viewId]?.tabs || [];
      const activeTabId = window.captureTabsByLabel[viewId]?.activeTabId;
      const activeTab =
        tabs.find((tab: any) => tab?.id === activeTabId) ||
        tabs.find((tab: any) => tab?.type !== 'master') ||
        tabs[0] ||
        null;
      const view = this.views?.[viewId];

      // The capture-frame routine restores the frame DOM and compatibility
      // zoom/pan values. The exact Fabric matrix then restores pointer-centred
      // zoom without reconstructing it from the lossy compatibility record.
      // Exact transforms are only valid at their saved canvas/window size;
      // restoreExactViewportForView performs that guard in one place.
      if (options?.useExactTransform !== false) {
        window.applyCaptureFrameForLabel(viewId);
        if (this.restoreExactViewportForView(viewId)) {
          return;
        }
      }

      // Seed the active tab's viewport with saved data so the user's original
      // zoom/pan is used as the seed for fitViewportToWorldRect, rather than
      // the fit pipeline's default "fit to frame" values.
      if (view?.viewport && typeof view.viewport === 'object' && view.viewport.zoom) {
        if (activeTab) {
          activeTab.viewport = cloneViewportRecord(view.viewport);
        }
      }
      window.applyCaptureFrameForLabel(viewId);
      return;
    }

    // No-capture-tab fallback: check for resolution mismatch
    const view = this.views?.[viewId];
    if (view?.viewport) {
      const restoreWorldRect =
        this.resolveRestoreWorldRectForView(viewId) ||
        view.restoreWorldRect ||
        view.backgroundWorldRect;
      const placementFrame = this.canvasManager.getBackgroundPlacementFrame?.();
      if (restoreWorldRect && placementFrame) {
        const canvasEl = this.canvasManager.fabricCanvas?.lowerCanvasEl;
        const canvasRect = canvasEl?.getBoundingClientRect?.() || { left: 0, top: 0 };
        const targetFrame = {
          ...placementFrame,
          left: (Number(canvasRect.left) || 0) + (Number(placementFrame.left) || 0),
          top: (Number(canvasRect.top) || 0) + (Number(placementFrame.top) || 0),
        };
        const center = this.canvasManager.getRotationCenter?.() || {
          x: (Number(this.canvasManager.fabricCanvas?.width) || 0) / 2,
          y: (Number(this.canvasManager.fabricCanvas?.height) || 0) / 2,
        };
        const restoredViewport = fitViewportToWorldRect(
          restoreWorldRect,
          view.viewport,
          targetFrame,
          { canvasRect, center }
        );
        if (restoredViewport) {
          this.canvasManager.setViewportState(restoredViewport);
          return;
        }
      }

      const savedW = Number(view.viewport.savedCanvasWidth) || 0;
      const savedH = Number(view.viewport.savedCanvasHeight) || 0;
      const currentW = Number(this.canvasManager.fabricCanvas?.width) || 0;
      const currentH = Number(this.canvasManager.fabricCanvas?.height) || 0;
      const dimensionsDiffer =
        savedW > 0 &&
        savedH > 0 &&
        (Math.abs(savedW - currentW) > 2 || Math.abs(savedH - currentH) > 2);

      if (dimensionsDiffer) {
        const bgRect = this.canvasManager.getBackgroundWorldRect?.();
        const placementFrame = this.canvasManager.getBackgroundPlacementFrame?.();
        if (bgRect && placementFrame) {
          this.canvasManager.fitViewportToBackgroundPlacementFrame(
            bgRect,
            placementFrame,
            view.viewport
          );
          this.canvasManager.applyViewportTransform();
          return;
        }
      }

      this.canvasManager.setViewportState(view.viewport);
    }
  }

  restoreExactViewportForView(viewId) {
    const savedViewport = this.views?.[viewId]?.viewport;
    const savedTabsState = this.views?.[viewId]?.tabs;
    const savedTabs = Array.isArray(savedTabsState?.tabs) ? savedTabsState.tabs : [];
    const savedActiveTab =
      savedTabs.find(tab => tab?.id === savedTabsState?.activeTabId) ||
      savedTabs.find(tab => tab?.type !== 'master') ||
      savedTabs[0] ||
      null;
    const exactSource = this.views?.[viewId]?.exactViewportSourceDimensions || null;
    const savedCanvasWidth =
      Number(exactSource?.canvasWidth) || Number(savedViewport?.savedCanvasWidth) || 0;
    const savedCanvasHeight =
      Number(exactSource?.canvasHeight) || Number(savedViewport?.savedCanvasHeight) || 0;
    const currentCanvasWidth = Number(this.canvasManager?.fabricCanvas?.width) || 0;
    const currentCanvasHeight = Number(this.canvasManager?.fabricCanvas?.height) || 0;
    if (
      savedCanvasWidth > 0 &&
      savedCanvasHeight > 0 &&
      currentCanvasWidth > 0 &&
      currentCanvasHeight > 0 &&
      (Math.abs(savedCanvasWidth - currentCanvasWidth) > 2 ||
        Math.abs(savedCanvasHeight - currentCanvasHeight) > 2)
    ) {
      return false;
    }
    const savedWindowWidth =
      Number(exactSource?.windowWidth) || Number(savedActiveTab?.captureFrame?.windowWidth) || 0;
    const savedWindowHeight =
      Number(exactSource?.windowHeight) || Number(savedActiveTab?.captureFrame?.windowHeight) || 0;
    if (
      savedWindowWidth > 0 &&
      savedWindowHeight > 0 &&
      (Math.abs(savedWindowWidth - window.innerWidth) > 2 ||
        Math.abs(savedWindowHeight - window.innerHeight) > 2)
    ) {
      return false;
    }

    const transform = this.views?.[viewId]?.viewportTransform;
    const exactTransform = Array.isArray(transform) ? transform.slice(0, 6).map(Number) : null;
    if (
      exactTransform?.length !== 6 ||
      !exactTransform.every(Number.isFinite) ||
      typeof this.canvasManager?.setViewportTransformExact !== 'function'
    ) {
      return false;
    }
    return this.canvasManager.setViewportTransformExact(exactTransform);
  }

  async reconcileBackgroundPlacementForView(viewId, options = {}) {
    if (!viewId || this.currentViewId !== viewId) return false;

    const view = this.views?.[viewId];
    if (!view?.image) return false;

    const isGuideSplitActive =
      document.getElementById('main-canvas-wrapper')?.classList.contains('guide-split-active') ===
      true;
    if (isGuideSplitActive) {
      return false;
    }

    const liveTabState = window.captureTabsByLabel?.[viewId];
    const savedTabState = view?.tabs;
    const tabState =
      liveTabState && Array.isArray(liveTabState.tabs)
        ? liveTabState
        : savedTabState && Array.isArray(savedTabState.tabs)
          ? savedTabState
          : null;
    const activeTabId = tabState?.activeTabId || null;
    const activeTab = tabState?.tabs?.find?.(tab => tab.id === activeTabId) || null;
    const hasAuthoritativeActiveTabState =
      activeTab?.type !== 'master' &&
      (Boolean(activeTab?.viewport) || Boolean(activeTab?.captureFrame?.worldRect));
    if (hasAuthoritativeActiveTabState) {
      return false;
    }

    if (options?.waitForLayout !== false) {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (this.currentViewId !== viewId) return false;
    }

    if (window.applyCaptureFrameForLabel) {
      window.applyCaptureFrameForLabel(viewId);
    }

    await new Promise(resolve => setTimeout(resolve, Number(options?.settleMs) || 0));
    if (this.currentViewId !== viewId) return false;

    await this.setBackgroundImage(view.image, view.fitMode || 'fit-canvas');
    this.canvasManager?.fabricCanvas?.requestRenderAll?.();
    return true;
  }

  syncLegacyImageListSelection(viewId, options = {}) {
    const imageList = document.getElementById('imageList');
    if (!imageList || !viewId) return;

    const containers = Array.from(imageList.querySelectorAll('.image-container'));
    let activeContainer = null;

    containers.forEach(container => {
      const isActive = container.dataset?.label === viewId;
      container.classList.toggle('active', isActive);
      container.classList.toggle('bg-slate-50', isActive);
      container.classList.toggle('ring-1', isActive);
      container.classList.toggle('ring-slate-200', isActive);
      container.setAttribute('aria-selected', isActive ? 'true' : 'false');
      if (isActive) {
        activeContainer = container;
      }
    });

    if (activeContainer && options.scroll !== false && !window.__scrollSelectDrivenSwitch) {
      // Use short suppression for instant scrolls to allow rapid sequential switching
      const suppressMs = options.smooth === true ? 400 : 80;
      window.__imageListProgrammaticScrollUntil = Date.now() + suppressMs;
      activeContainer.scrollIntoView({
        behavior: options.smooth === true ? 'smooth' : 'auto',
        block: 'center',
        inline: 'nearest',
      });
    }
  }

  inferBackgroundWorldRectFromSerializedBackground(backgroundImageData) {
    if (!backgroundImageData || typeof backgroundImageData !== 'object') {
      return null;
    }

    const left = Number(backgroundImageData.left);
    const top = Number(backgroundImageData.top);
    const unrotatedWidth =
      (Number(backgroundImageData.width) || Number(backgroundImageData.naturalWidth) || 0) *
      (Number(backgroundImageData.scaleX) || 1);
    const unrotatedHeight =
      (Number(backgroundImageData.height) || Number(backgroundImageData.naturalHeight) || 0) *
      (Number(backgroundImageData.scaleY) || 1);
    const radians = ((Number(backgroundImageData.angle) || 0) * Math.PI) / 180;
    const cos = Math.abs(Math.cos(radians));
    const sin = Math.abs(Math.sin(radians));
    const width = unrotatedWidth * cos + unrotatedHeight * sin;
    const height = unrotatedWidth * sin + unrotatedHeight * cos;

    if (
      !Number.isFinite(left) ||
      !Number.isFinite(top) ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    ) {
      return null;
    }

    return {
      left: left - width / 2,
      top: top - height / 2,
      width,
      height,
    };
  }

  extractBackgroundPlacementFromCanvasData(canvasData) {
    const backgroundImage = canvasData?.backgroundImage;
    if (!backgroundImage || typeof backgroundImage !== 'object') return null;
    const placement = {
      left: Number(backgroundImage.left),
      top: Number(backgroundImage.top),
      scaleX: Number(backgroundImage.scaleX),
      scaleY: Number(backgroundImage.scaleY),
      angle: Number(backgroundImage.angle) || 0,
      originX: backgroundImage.originX || 'center',
      originY: backgroundImage.originY || 'center',
    };
    if (
      !Number.isFinite(placement.left) ||
      !Number.isFinite(placement.top) ||
      !Number.isFinite(placement.scaleX) ||
      !Number.isFinite(placement.scaleY)
    ) {
      return null;
    }
    return placement;
  }

  getBackgroundRestoreOptionsForView(viewId) {
    const view = this.views?.[viewId];
    if (!view) return null;
    return {
      fitMode: view.fitMode || 'fit-canvas',
      savedPlacement: this.extractBackgroundPlacementFromCanvasData(view.canvasData),
    };
  }

  resolveRestoreWorldRectForView(viewId) {
    const baseViewId = String(viewId || '')
      .split('::tab:')[0]
      .trim();
    if (!baseViewId) return null;

    const normalizeRect = rectLike => {
      const left = Number(rectLike?.left);
      const top = Number(rectLike?.top);
      const width = Number(rectLike?.width);
      const height = Number(rectLike?.height);
      if (
        !Number.isFinite(left) ||
        !Number.isFinite(top) ||
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width <= 0 ||
        height <= 0
      ) {
        return null;
      }
      return { left, top, width, height };
    };

    const view = this.views?.[baseViewId] || null;
    const savedRect =
      normalizeRect(view?.backgroundWorldRect) ||
      normalizeRect(view?.restoreWorldRect) ||
      normalizeRect(
        this.inferBackgroundWorldRectFromSerializedBackground(view?.canvasData?.backgroundImage)
      );
    if (savedRect) {
      return savedRect;
    }

    if (baseViewId !== this.currentViewId) {
      return null;
    }

    const backgroundImage = this.canvasManager?.fabricCanvas?.backgroundImage || null;
    const backgroundSrc = String(
      backgroundImage?.getSrc?.() ||
        backgroundImage?.src ||
        backgroundImage?._element?.currentSrc ||
        backgroundImage?._element?.src ||
        ''
    ).trim();
    const viewImage = String(view?.image || '').trim();
    if (viewImage && backgroundSrc && backgroundSrc !== viewImage) {
      return null;
    }

    return normalizeRect(this.canvasManager?.getBackgroundWorldRect?.());
  }

  saveCurrentViewState(options?: { skipViewport?: boolean; viewId?: string; canvasManager?: any }) {
    const targetViewId = options?.viewId || this.currentViewId;
    const targetCanvasManager = options?.canvasManager || this.canvasManager;
    const json = targetCanvasManager.toJSON();
    console.log(
      `[saveCurrentViewState] Saving ${targetViewId} with ${json?.objects?.length || 0} objects`
    );
    this.stripMosOverlayObjects(json);
    if (this.views[targetViewId]) {
      this.filterCanvasJsonObjectsForView(json, targetViewId);
      const skipViewport = options?.skipViewport === true;
      const isGuideSplitActive =
        skipViewport ||
        document.getElementById('main-canvas-wrapper')?.classList.contains('guide-split-active') ===
          true;
      const isMultiViewActive = document.body.classList.contains('multiview-active');
      const isTransientCanvasLayout = isGuideSplitActive || isMultiViewActive;
      const previousCanvasData = this.views[targetViewId].canvasData;
      if (isTransientCanvasLayout) {
        // Split and comparison panes use transient canvas/viewports. Preserve
        // object data, but never persist their geometry as the main view state.
        delete json.viewportTransform;
        delete json.width;
        delete json.height;
        if (previousCanvasData?.backgroundImage) {
          json.backgroundImage = JSON.parse(JSON.stringify(previousCanvasData.backgroundImage));
        }
      }
      this.views[targetViewId].canvasData = json;
      this.views[targetViewId].rotation = targetCanvasManager.getRotationDegrees();
      this.views[targetViewId].backgroundRotation =
        Number(this.views[targetViewId].backgroundRotation) || 0;
      if (!isTransientCanvasLayout) {
        // Save backgroundWorldRect so setBackgroundImage can restore the exact
        // position on the next visit. Split mode preserves the previous rect
        // because the live canvas is temporarily fitted to a half-width pane.
        const activeTabState = window.captureTabsByLabel?.[targetViewId];
        const activeTab = activeTabState?.tabs?.find?.(
          tab => tab?.id === activeTabState?.activeTabId
        );
        const tabWorldRect = activeTab?.captureFrame?.worldRect || null;
        const liveBackgroundWorldRect = targetCanvasManager.getBackgroundWorldRect?.() || null;
        const backgroundImage = targetCanvasManager.fabricCanvas?.backgroundImage || null;
        const inferredBackgroundWorldRect = backgroundImage
          ? getCenteredBoxWorldRect({
              center:
                typeof backgroundImage.getCenterPoint === 'function'
                  ? backgroundImage.getCenterPoint()
                  : { x: backgroundImage.left, y: backgroundImage.top },
              width:
                typeof backgroundImage.getScaledWidth === 'function'
                  ? backgroundImage.getScaledWidth()
                  : Number(backgroundImage.width) * (Number(backgroundImage.scaleX) || 1),
              height:
                typeof backgroundImage.getScaledHeight === 'function'
                  ? backgroundImage.getScaledHeight()
                  : Number(backgroundImage.height) * (Number(backgroundImage.scaleY) || 1),
              angle: Number(backgroundImage.angle) || 0,
            })
          : null;
        // A capture frame describes the viewport window, not the image itself.
        // Persisting it as the background rectangle makes a returning image adopt
        // the frame's size before its saved viewport is restored, which silently
        // turns a manual zoom back into a fit-to-frame view.
        const backgroundWorldRect =
          liveBackgroundWorldRect || inferredBackgroundWorldRect || tabWorldRect || null;
        if (backgroundWorldRect) {
          this.views[targetViewId].backgroundWorldRect = JSON.parse(
            JSON.stringify(backgroundWorldRect)
          );
          this.views[targetViewId].restoreWorldRect = JSON.parse(
            JSON.stringify(backgroundWorldRect)
          );
        } else {
          delete this.views[targetViewId].backgroundWorldRect;
          delete this.views[targetViewId].restoreWorldRect;
        }
      }
      if (!isTransientCanvasLayout) {
        this.views[targetViewId].viewport = targetCanvasManager.getViewportState();
        const viewportTransform = targetCanvasManager.fabricCanvas?.viewportTransform;
        if (Array.isArray(viewportTransform) && viewportTransform.length >= 6) {
          const exactTransform = viewportTransform.slice(0, 6).map(Number);
          if (exactTransform.every(Number.isFinite)) {
            this.views[targetViewId].viewportTransform = exactTransform;
          }
        }
      }
      if (!isTransientCanvasLayout && window.captureTabsByLabel?.[targetViewId]) {
        try {
          this.views[targetViewId].tabs = JSON.parse(
            JSON.stringify(window.captureTabsByLabel[targetViewId])
          );
        } catch (err) {
          console.warn('[Save] Failed to clone capture tabs for view:', err);
        }
      }

      // Also save metadata for this view
      if (window.app?.metadataManager) {
        this.views[targetViewId].metadata = {
          vectorStrokesByImage: this.collectScopedMetadataBuckets(
            window.app.metadataManager.vectorStrokesByImage,
            targetViewId
          ),
          strokeVisibilityByImage: this.collectScopedMetadataBuckets(
            window.app.metadataManager.strokeVisibilityByImage,
            targetViewId
          ),
          strokeLabelVisibility: this.collectScopedMetadataBuckets(
            window.app.metadataManager.strokeLabelVisibility,
            targetViewId
          ),
          strokeMeasurements: this.serializeMeasurements(targetViewId),
        };
      }
    }
  }

  collectScopedMetadataBuckets(sourceMap, viewId) {
    const scoped = {};
    Object.entries(sourceMap || {}).forEach(([key, value]) => {
      if (key === viewId || key.startsWith(`${viewId}::tab:`)) {
        scoped[key] = JSON.parse(JSON.stringify(value || {}));
      }
    });
    return scoped;
  }

  getCanvasObjectScopeLabel(obj) {
    const candidates = [
      obj?.strokeMetadata?.imageLabel,
      obj?.customData?.imageLabel,
      obj?.imageLabel,
      obj?.scopedLabel,
      obj?.tagImageLabel,
      obj?.connectedStroke?.strokeMetadata?.imageLabel,
      obj?.connectedStroke?.imageLabel,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }
    return '';
  }

  isScopeLabelForView(scopeLabel, viewId) {
    if (!scopeLabel || !viewId) return false;
    if (typeof scopeLabel === 'string' && scopeLabel.startsWith('__guide__:')) return false;
    return scopeLabel === viewId || scopeLabel.startsWith(`${viewId}::tab:`);
  }

  filterCanvasJsonObjectsForView(canvasJson, viewId) {
    if (!canvasJson?.objects || !Array.isArray(canvasJson.objects) || !viewId) return canvasJson;

    const beforeCount = canvasJson.objects.length;
    canvasJson.objects = canvasJson.objects
      .map(obj => {
        if (!obj || typeof obj !== 'object') return obj;
        if (obj.customData?.layerType === 'mos-overlay') return null;
        if (obj.customData?.guideReferenceOnly === true) return null;

        const scopeLabel = this.getCanvasObjectScopeLabel(obj);
        if (scopeLabel) {
          if (scopeLabel.startsWith('__guide__:')) return null;
          if (!this.isScopeLabelForView(scopeLabel, viewId)) return null;
        }

        if (obj.strokeMetadata && !obj.strokeMetadata.imageLabel) {
          obj.strokeMetadata.imageLabel = viewId;
        }

        return obj;
      })
      .filter(Boolean);

    const removedCount = beforeCount - canvasJson.objects.length;
    if (removedCount > 0) {
      console.warn(`[ProjectManager] Removed ${removedCount} out-of-scope canvas object(s)`, {
        viewId,
      });
    }

    return canvasJson;
  }

  removeCanvasObjectsOutsideViewScope(viewId) {
    const canvas = this.canvasManager?.fabricCanvas;
    if (!canvas || !viewId || typeof canvas.getObjects !== 'function') return 0;

    const toRemove = canvas.getObjects().filter(obj => {
      const scopeLabel = this.getCanvasObjectScopeLabel(obj);
      return Boolean(scopeLabel) && !this.isScopeLabelForView(scopeLabel, viewId);
    });

    toRemove.forEach(obj => canvas.remove(obj));
    if (toRemove.length > 0) {
      console.warn(`[ProjectManager] Removed ${toRemove.length} live out-of-scope object(s)`, {
        viewId,
      });
      canvas.requestRenderAll?.();
    }
    return toRemove.length;
  }

  repairActiveCaptureTabForLoadedObjects(viewId) {
    if (!viewId || typeof window.setActiveCaptureTab !== 'function') return;

    const canvas = this.canvasManager?.fabricCanvas;
    const state = window.captureTabsByLabel?.[viewId];
    if (!canvas || !state || !Array.isArray(state.tabs)) return;

    const getTabIdFromScope = scopeLabel => {
      const raw = typeof scopeLabel === 'string' ? scopeLabel.trim() : '';
      const marker = `${viewId}::tab:`;
      return raw.startsWith(marker) ? raw.slice(marker.length) : '';
    };
    const isDrawableStrokeObject = obj =>
      Boolean(obj?.strokeMetadata?.strokeLabel) &&
      obj?.isTag !== true &&
      obj?.isTagGroup !== true &&
      obj?.isConnectorLine !== true &&
      obj?.excludeFromExport !== true;

    const tabCounts = {};
    canvas.getObjects().forEach(obj => {
      if (!isDrawableStrokeObject(obj)) return;
      const scopeLabel = this.getCanvasObjectScopeLabel(obj);
      const tabId = getTabIdFromScope(scopeLabel);
      if (tabId) {
        tabCounts[tabId] = (tabCounts[tabId] || 0) + 1;
      }
    });

    const dominantEntry = Object.entries(tabCounts).sort((a, b) => b[1] - a[1])[0];
    if (!dominantEntry) return;

    const dominantTabId = dominantEntry[0];
    const activeTabId = String(state.activeTabId || '').trim();
    const activeTab = state.tabs.find(tab => tab.id === activeTabId) || null;
    const activeTabStrokeCount = tabCounts[activeTabId] || 0;
    const hasDominantTab = state.tabs.some(tab => tab.id === dominantTabId);
    const shouldRepairActiveTab =
      hasDominantTab &&
      activeTabId !== dominantTabId &&
      (!activeTab || activeTab.type === 'master' || activeTabStrokeCount === 0);

    if (shouldRepairActiveTab) {
      console.warn('[ProjectManager] Repaired active frame tab to restored stroke scope', {
        viewId,
        previousTabId: activeTabId,
        nextTabId: dominantTabId,
        tabCounts,
      });
      window.setActiveCaptureTab(viewId, dominantTabId, { skipSave: true });
    }
  }

  stripMosOverlayObjects(canvasJson) {
    if (!canvasJson?.objects || !Array.isArray(canvasJson.objects)) return;
    canvasJson.objects = canvasJson.objects.filter(obj => {
      // Strip MOS overlay objects
      if (obj?.customData?.layerType === 'mos-overlay') return false;
      // Strip guide-scoped objects that may have leaked onto the primary canvas
      const imageLabel = obj?.customData?.imageLabel || obj?.imageLabel || '';
      if (typeof imageLabel === 'string' && imageLabel.startsWith('__guide__:')) return false;
      const metaLabel = obj?.strokeMetadata?.imageLabel || '';
      if (typeof metaLabel === 'string' && metaLabel.startsWith('__guide__:')) return false;
      if (obj?.customData?.guideReferenceOnly === true) return false;
      return true;
    });
  }

  // Serialize measurements for a view (deep copy)
  serializeMeasurements(viewId) {
    if (!window.app?.metadataManager?.strokeMeasurements) {
      return {};
    }

    return this.collectScopedMetadataBuckets(window.app.metadataManager.strokeMeasurements, viewId);
  }

  // Deserialize measurements for a view
  deserializeMeasurements(viewId, measurements) {
    if (!window.app?.metadataManager) {
      return;
    }

    if (!measurements || typeof measurements !== 'object') {
      return;
    }

    const normalizeBucket = bucket => {
      const output = {};
      Object.entries(bucket || {}).forEach(([strokeLabel, measurement]) => {
        if (measurement && typeof measurement === 'object') {
          output[strokeLabel] = {
            inchWhole: typeof measurement.inchWhole === 'number' ? measurement.inchWhole : 0,
            inchFraction:
              typeof measurement.inchFraction === 'number' ? measurement.inchFraction : 0,
            cm: typeof measurement.cm === 'number' ? measurement.cm : 0,
            inch:
              typeof measurement.inch === 'number'
                ? measurement.inch
                : typeof measurement.cm === 'number'
                  ? measurement.cm / 2.54
                  : (typeof measurement.inchWhole === 'number' ? measurement.inchWhole : 0) +
                    (typeof measurement.inchFraction === 'number' ? measurement.inchFraction : 0),
            inputUnit:
              measurement.inputUnit === 'cm'
                ? 'cm'
                : measurement.inputUnit === 'inches'
                  ? 'inches'
                  : undefined,
          };
        }
      });
      return output;
    };

    const isLegacyFlatShape = Object.values(measurements).some(
      value =>
        value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'cm')
    );

    if (isLegacyFlatShape) {
      window.app.metadataManager.strokeMeasurements[viewId] = normalizeBucket(measurements);
      return;
    }

    Object.entries(measurements).forEach(([scopeKey, bucket]) => {
      if (scopeKey !== viewId && !scopeKey.startsWith(`${viewId}::tab:`)) return;
      window.app.metadataManager.strokeMeasurements[scopeKey] = normalizeBucket(bucket);
    });
  }

  getLegacyViewIdsFromFlatShape(flatProjectData = {}): string[] {
    const candidateIds = new Set();
    const addId = value => {
      const trimmed = String(value || '').trim();
      if (!trimmed) return;
      candidateIds.add(trimmed.split('::tab:')[0]);
    };

    const addKeys = map => {
      Object.keys(map || {}).forEach(addId);
    };

    (flatProjectData.imageLabels || []).forEach(addId);
    addId(flatProjectData.currentImageLabel);
    addKeys(flatProjectData.originalImages);
    addKeys(flatProjectData.strokes);
    addKeys(flatProjectData.strokeVisibility);
    addKeys(flatProjectData.strokeSequence);
    addKeys(flatProjectData.strokeMeasurements);
    addKeys(flatProjectData.strokeLabelVisibility);
    addKeys(flatProjectData.customImageNames);

    return Array.from(candidateIds);
  }

  collectScopedBucketsFromFlatShape(sourceMap, viewId): Record<string, any> {
    const scoped = {};
    Object.entries(sourceMap || {}).forEach(([key, value]) => {
      if (key === viewId || key.startsWith(`${viewId}::tab:`)) {
        scoped[key] = JSON.parse(JSON.stringify(value || {}));
      }
    });
    return scoped;
  }

  buildCanvasJSONFromLegacyStrokes(flatProjectData, viewId): any {
    const scopedStrokeBuckets = this.collectScopedBucketsFromFlatShape(
      flatProjectData?.strokes,
      viewId
    );
    const scopedSequences = this.collectScopedBucketsFromFlatShape(
      flatProjectData?.strokeSequence,
      viewId
    );
    const objects = [];
    const customProps = this.getCanvasCustomProps();
    const cloneStroke = strokeObj => {
      if (!strokeObj || typeof strokeObj !== 'object') return null;
      if (typeof strokeObj.toObject === 'function') {
        try {
          return strokeObj.toObject(customProps);
        } catch (error) {
          console.warn('[Save] Failed to serialize legacy runtime stroke via toObject', error);
        }
      }
      try {
        return JSON.parse(JSON.stringify(strokeObj));
      } catch (error) {
        console.warn('[Save] Failed to clone legacy stroke object', error);
        return null;
      }
    };

    Object.entries(scopedStrokeBuckets).forEach(([scopeKey, strokeMap]) => {
      const orderedLabels = Array.isArray(scopedSequences?.[scopeKey])
        ? scopedSequences[scopeKey]
        : [];
      const appended = new Set();

      orderedLabels.forEach(strokeLabel => {
        const strokeObj = strokeMap?.[strokeLabel];
        if (!strokeObj || typeof strokeObj !== 'object') return;
        const clone = cloneStroke(strokeObj);
        if (!clone) return;
        clone.strokeMetadata = clone.strokeMetadata || {};
        clone.strokeMetadata.strokeLabel = clone.strokeMetadata.strokeLabel || strokeLabel.trim();
        clone.strokeMetadata.imageLabel = clone.strokeMetadata.imageLabel || scopeKey;
        clone.strokeMetadata.type = clone.strokeMetadata.type || 'line';
        clone.strokeMetadata.isVector = true;
        if (!clone.imageLabel) {
          clone.imageLabel = scopeKey;
        }
        objects.push(clone);
        appended.add(strokeLabel);
      });

      Object.entries(strokeMap || {}).forEach(([strokeLabel, strokeObj]) => {
        if (appended.has(strokeLabel)) return;
        if (!strokeObj || typeof strokeObj !== 'object') return;
        if (strokeObj._placeholder) return;
        const clone = cloneStroke(strokeObj);
        if (!clone) return;
        clone.strokeMetadata = clone.strokeMetadata || {};
        clone.strokeMetadata.strokeLabel = clone.strokeMetadata.strokeLabel || strokeLabel.trim();
        clone.strokeMetadata.imageLabel = clone.strokeMetadata.imageLabel || scopeKey;
        clone.strokeMetadata.type = clone.strokeMetadata.type || 'line';
        clone.strokeMetadata.isVector = true;
        if (!clone.imageLabel) {
          clone.imageLabel = scopeKey;
        }
        objects.push(clone);
      });
    });

    if (!objects.length) return null;

    return {
      version: '5.3.0',
      objects,
      background: '',
      backgroundImage: null,
    };
  }

  buildLegacyViewEntry(flatProjectData, viewId): any {
    const rawImageUrl = flatProjectData?.originalImages?.[viewId] || null;
    return {
      canvasJSON: this.buildCanvasJSONFromLegacyStrokes(flatProjectData, viewId),
      imageDataURL:
        typeof rawImageUrl === 'string' && rawImageUrl.startsWith('data:') ? rawImageUrl : null,
      imageUrl: rawImageUrl,
      imageAssetPath: null,
      imageAssetHash: null,
      imageContentType: null,
      imageSourceFingerprint: null,
      rotation: 0,
      backgroundRotation: 0,
      fitMode: 'fit-canvas',
      metadata: {
        vectorStrokesByImage: this.collectScopedBucketsFromFlatShape(
          flatProjectData?.strokes,
          viewId
        ),
        strokeVisibilityByImage: this.collectScopedBucketsFromFlatShape(
          flatProjectData?.strokeVisibility,
          viewId
        ),
        strokeLabelVisibility: this.collectScopedBucketsFromFlatShape(
          flatProjectData?.strokeLabelVisibility,
          viewId
        ),
        strokeMeasurements: this.collectScopedBucketsFromFlatShape(
          flatProjectData?.strokeMeasurements,
          viewId
        ),
      },
      tabs: null,
      viewport: null,
    };
  }

  isLegacyFlatProjectData(projectData = {}): boolean {
    if (!projectData || typeof projectData !== 'object') return false;
    if (projectData.views && Object.keys(projectData.views).length) return false;
    return Boolean(
      Array.isArray(projectData.imageLabels) ||
        projectData.currentImageLabel ||
        Object.keys(projectData.originalImages || {}).length ||
        Object.keys(projectData.strokes || {}).length ||
        Object.keys(projectData.strokeMeasurements || {}).length
    );
  }

  upgradeLegacyProjectData(projectData = {}): any {
    const projectName = projectData.projectName || projectData.name || 'OpenPaint Project';
    const viewIds = this.getLegacyViewIdsFromFlatShape(projectData);
    const viewOrder = Array.isArray(projectData.imageLabels)
      ? projectData.imageLabels.filter(id => viewIds.includes(id))
      : [];
    const remaining = viewIds.filter(id => !viewOrder.includes(id));
    const ordered = viewOrder.concat(remaining);
    const currentViewId =
      (projectData.currentImageLabel && ordered.includes(projectData.currentImageLabel)
        ? projectData.currentImageLabel
        : null) ||
      ordered[0] ||
      'front';

    const upgraded = {
      version: '2.0-fabric',
      projectName,
      name: projectName,
      createdAt: projectData.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      currentViewId,
      metadata: normalizeSofaMetadata(projectData.metadata),
      viewOrder: ordered,
      views: {},
    };

    ordered.forEach(viewId => {
      upgraded.views[viewId] = this.buildLegacyViewEntry(projectData, viewId);
    });

    if (projectData.mosOverlays) {
      upgraded.mosOverlays = JSON.parse(JSON.stringify(projectData.mosOverlays));
    }

    return upgraded;
  }

  buildLegacyRuntimeSnapshot(): any {
    return {
      currentImageLabel: this.currentViewId || window.paintApp?.state?.currentImageLabel || null,
      imageLabels:
        (Array.isArray(window.orderedImageLabels) && window.orderedImageLabels.length
          ? window.orderedImageLabels.slice()
          : window.paintApp?.state?.imageLabels || []) || [],
      originalImages: window.originalImages || {},
      strokes: window.vectorStrokesByImage || {},
      strokeVisibility: window.strokeVisibilityByImage || {},
      strokeSequence: window.lineStrokesByImage || {},
      strokeMeasurements: window.strokeMeasurements || {},
      strokeLabelVisibility: window.strokeLabelVisibility || {},
      customImageNames: window.customImageNames || {},
      metadata: this.getProjectMetadata(),
    };
  }

  mergeScopedBuckets(...sources): Record<string, any> {
    const merged = {};
    sources.forEach(source => {
      Object.entries(source || {}).forEach(([key, value]) => {
        merged[key] = JSON.parse(JSON.stringify(value || {}));
      });
    });
    return merged;
  }

  // Add or update an image for a view
  async addImage(viewId, imageUrl, options = {}) {
    const { refreshBackground = true } = options;

    if (!this.views[viewId]) {
      // Create new view if it doesn't exist
      this.views[viewId] = {
        id: viewId,
        image: null,
        imageAssetHash: null,
        imageContentType: null,
        imageSourceFingerprint: null,
        canvasData: null,
        metadata: null,
        rotation: 0,
        backgroundRotation: 0,
        fitMode: 'scale-page-size',
        tabs: null,
        viewport: null,
      };
    }

    const previousImage = this.views[viewId].image;
    if (previousImage !== imageUrl) {
      this.views[viewId].imageAssetHash = null;
      this.views[viewId].imageContentType = null;
      this.views[viewId].imageSourceFingerprint = null;
    }
    this.views[viewId].image = imageUrl;

    // Only refresh background if explicitly requested and this is the current view
    // This prevents flicker during batch uploads
    if (refreshBackground && this.currentViewId === viewId) {
      await this.setBackgroundImage(imageUrl, this.views[viewId].fitMode || 'fit-canvas', {
        restoreSavedPlacement: previousImage === imageUrl,
      });
      const liveRotation = this.canvasManager?.getRotationDegrees?.();
      if (typeof liveRotation === 'number') {
        this.views[viewId].rotation = liveRotation;
        this.updateThumbnailRotation(viewId, liveRotation);
      }
    } else if (typeof this.views[viewId]?.rotation === 'number') {
      this.updateThumbnailRotation(viewId, this.views[viewId].rotation);
    }
    window.dispatchEvent(
      new CustomEvent('openpaint:image-collection-change', { detail: { viewId } })
    );
  }

  async setBackgroundImage(url, fitMode, options = {}) {
    if (fitMode === undefined) {
      fitMode = this.views?.[this.currentViewId]?.fitMode || 'fit-canvas';
    }
    const requestedCanvas = this.canvasManager?.fabricCanvas;
    const requestedViewId = this.currentViewId;
    if (!requestedCanvas) return;
    const loadGeneration = (this.backgroundLoadGenerationByCanvas.get(requestedCanvas) || 0) + 1;
    this.backgroundLoadGenerationByCanvas.set(requestedCanvas, loadGeneration);
    const isCurrentLoad = () =>
      this.backgroundLoadGenerationByCanvas.get(requestedCanvas) === loadGeneration &&
      this.currentViewId === requestedViewId &&
      this.canvasManager?.fabricCanvas === requestedCanvas;
    console.log(`\n[Image Debug] ===== SET BACKGROUND IMAGE =====`);
    console.log(`[Image Debug] URL: ${url?.substring?.(0, 50)}...`);
    console.log(`[Image Debug] Fit mode: ${fitMode}`);

    return new Promise(resolve => {
      const timeout = setTimeout(() => {
        console.error('[Image Debug] setBackgroundImage timed out for:', url?.substring?.(0, 80));
        if (this.backgroundLoadGenerationByCanvas.get(requestedCanvas) === loadGeneration) {
          this.backgroundLoadGenerationByCanvas.set(requestedCanvas, loadGeneration + 1);
        }
        resolve();
      }, 10000);

      const imgOptions = url.startsWith('blob:') ? {} : { crossOrigin: 'anonymous' };
      fabric.Image.fromURL(
        url,
        (img, isError) => {
          clearTimeout(timeout);
          if (!isCurrentLoad()) {
            console.log('[Image Debug] Ignoring stale background image load', {
              viewId: requestedViewId,
              url: url?.substring?.(0, 80),
            });
            return resolve();
          }
          if (isError || !img) {
            console.error('[Image Debug] Failed to load image:', url?.substring?.(0, 80));
            return resolve();
          }
          const canvas = this.canvasManager.fabricCanvas;
          if (!canvas) {
            console.log('[Image Debug] ❌ No canvas available');
            return resolve();
          }

          const imgWidth = img.width;
          const imgHeight = img.height;

          if (!imgWidth || !imgHeight) {
            console.warn(
              '[Image Debug] Failed to load image dimensions; skipping background update',
              { url }
            );
            return resolve();
          }

          const viewState = this.views?.[this.currentViewId] || null;
          const hasPersistedLayout = Boolean(
            viewState?.canvasData ||
              viewState?.viewport ||
              viewState?.tabs ||
              viewState?.backgroundWorldRect
          );
          // Size the capture frame to the uploaded image's aspect ratio on the
          // FIRST upload (no persisted layout). Previously this only ran for
          // portrait images; landscape/square images kept the default 4:3 frame
          // and the image was fit inside it, leaving empty gaps on the shorter
          // dimension — the "image smaller than frame" symptom.
          const shouldInitializeFrameForImage = Boolean(
            !hasPersistedLayout && viewState?.initialImageFrameApplied !== true
          );
          let initialFrameApplied = false;
          if (shouldInitializeFrameForImage) {
            initialFrameApplied = Boolean(
              window.initializeCaptureFrameForImageAspect?.(this.currentViewId, imgWidth, imgHeight)
            );
            if (initialFrameApplied && viewState) {
              viewState.initialImageFrameApplied = true;
            }
          }

          if (initialFrameApplied) {
            // An empty canvas can inherit a proportional zoom from a browser
            // resize before the first upload. Image fitting below works in
            // world units, so carrying that transient zoom into placement
            // multiplies the fitted image a second time (for example 1.19x on
            // a wide screen). A new image/frame pair starts from a neutral
            // viewport; subsequent user zooms and saved layouts remain intact.
            this.canvasManager.setViewportState?.({ zoom: 1, panX: 0, panY: 0 });
            this.canvasManager.applyViewportTransform?.();
            const tabState = window.captureTabsByLabel?.[this.currentViewId];
            const activeFrame = tabState?.tabs?.find(
              tab => tab.id === tabState.activeTabId && tab.type !== 'master'
            );
            if (activeFrame) {
              activeFrame.viewport = {
                ...activeFrame.viewport,
                zoom: 1,
                panX: 0,
                panY: 0,
                rotation: this.canvasManager.getRotationDegrees?.() || 0,
              };
              activeFrame.viewportTransform = [1, 0, 0, 1, 0, 0];
            }
            window.__openpaintResetCaptureResizeAnchor?.();
          }

          // Frame initialization updates the live capture frame, so read
          // placement afterwards. Reading it earlier fits the first render to
          // the stale default frame.
          const placementFrame = this.canvasManager.getBackgroundPlacementFrame?.() || {
            width: canvas.width,
            height: canvas.height,
            left: 0,
            top: 0,
          };
          let frameWidth = placementFrame.width;
          let frameHeight = placementFrame.height;
          let frameLeft = placementFrame.left;
          let frameTop = placementFrame.top;

          if (!frameWidth || !frameHeight) {
            console.warn('[Image Debug] Capture frame size invalid, using canvas size');
            frameWidth = canvas.width;
            frameHeight = canvas.height;
            frameLeft = 0;
            frameTop = 0;
          }

          console.log(
            `[Image Debug] Frame: ${frameWidth}x${frameHeight} at (${frameLeft},${frameTop})\n` +
              `[Image Debug] Image: ${imgWidth}x${imgHeight}`
          );

          let scale = 1;
          const normalizeWorldRect = rectLike => {
            const left = Number(rectLike?.left);
            const top = Number(rectLike?.top);
            const width = Number(rectLike?.width);
            const height = Number(rectLike?.height);
            if (
              !Number.isFinite(left) ||
              !Number.isFinite(top) ||
              !Number.isFinite(width) ||
              !Number.isFinite(height) ||
              width <= 0 ||
              height <= 0
            ) {
              return null;
            }
            return { left, top, width, height };
          };
          const rectsDifferMaterially = (a, b) => {
            if (!a || !b) return false;
            const epsilon = 1;
            return (
              Math.abs(a.left - b.left) > epsilon ||
              Math.abs(a.top - b.top) > epsilon ||
              Math.abs(a.width - b.width) > epsilon ||
              Math.abs(a.height - b.height) > epsilon
            );
          };
          const restoreSavedPlacement = options?.restoreSavedPlacement !== false;
          const viewRotation = Number(viewState?.rotation) || 0;
          const backgroundRotation = Number(viewState?.backgroundRotation) || 0;
          const visualBackgroundRotation = viewRotation + backgroundRotation;
          const normalizedBackgroundRotation = ((visualBackgroundRotation % 360) + 360) % 360;
          const rotationRadians = (normalizedBackgroundRotation * Math.PI) / 180;
          const rotationCos = Math.abs(Math.cos(rotationRadians));
          const rotationSin = Math.abs(Math.sin(rotationRadians));
          const rotatedWidthBasis = imgWidth * rotationCos + imgHeight * rotationSin;
          const rotatedHeightBasis = imgWidth * rotationSin + imgHeight * rotationCos;
          const savedBackgroundWorldRect = normalizeWorldRect(viewState?.backgroundWorldRect);
          // Older saves could contain a capture-frame rectangle here. A frame is
          // commonly 4:3 while the source image is not, so do not use a rectangle
          // that cannot possibly describe the full, un-cropped image.
          const isCompatibleImageWorldRect = rect => {
            if (!rect || !rotatedWidthBasis || !rotatedHeightBasis) return false;
            const expectedAspect = rotatedWidthBasis / rotatedHeightBasis;
            const actualAspect = rect.width / rect.height;
            return (
              Number.isFinite(expectedAspect) &&
              Number.isFinite(actualAspect) &&
              expectedAspect > 0 &&
              actualAspect > 0 &&
              Math.abs(actualAspect - expectedAspect) / expectedAspect < 0.015
            );
          };
          const preferredRestoreWorldRect = isCompatibleImageWorldRect(savedBackgroundWorldRect)
            ? savedBackgroundWorldRect
            : null;
          const liveTabState = window.captureTabsByLabel?.[this.currentViewId] || null;
          const savedTabState = viewState?.tabs || null;
          const tabState =
            liveTabState && Array.isArray(liveTabState.tabs)
              ? liveTabState
              : savedTabState && Array.isArray(savedTabState.tabs)
                ? savedTabState
                : null;
          const activeTabId = tabState?.activeTabId || null;
          const activeTab = tabState?.tabs?.find?.(tab => tab.id === activeTabId) || null;
          const hasAuthoritativeActiveTabState =
            activeTab?.type !== 'master' &&
            (Boolean(activeTab?.viewport) || Boolean(activeTab?.captureFrame?.worldRect));
          const viewHasSavedDrawingState = Boolean(
            viewState?.canvasData ||
              viewState?.viewport ||
              viewState?.tabs ||
              liveTabState?.tabs?.length ||
              viewState?.metadata ||
              viewState?.backgroundWorldRect
          );
          const hasSavedBackgroundWorldRect =
            restoreSavedPlacement && Boolean(preferredRestoreWorldRect) && viewHasSavedDrawingState;

          // Center based on frame center
          let left = frameLeft + frameWidth / 2;
          let top = frameTop + frameHeight / 2;

          // In split mode, the canvas is half-width so the frame center is wrong
          // for vectors drawn at the original full-width position.  Use the
          // pre-split canvas dimensions (originalCanvasSize) to place the
          // background CENTER where it would have been in full-width mode.
          // The scale stays frame-based (it matches the original since the capture
          // frame preserves the same aspect-ratio fitting).  The split viewport
          // transform (fitGuideSplitPrimaryBackgroundToFrame) then pan/zooms to
          // show it correctly in the half-width pane.
          const isGuideSplitActiveForPlacement =
            document
              .getElementById('main-canvas-wrapper')
              ?.classList.contains('guide-split-active') === true;
          const shouldUseSavedBackgroundWorldRect =
            hasSavedBackgroundWorldRect &&
            (fitMode === 'actual-size' ||
              isGuideSplitActiveForPlacement ||
              hasAuthoritativeActiveTabState ||
              viewHasSavedDrawingState);
          if (isGuideSplitActiveForPlacement && !hasSavedBackgroundWorldRect) {
            const origSize = this.canvasManager?.originalCanvasSize;
            if (origSize && origSize.width > 0 && origSize.height > 0) {
              left = origSize.width / 2;
              top = origSize.height / 2;
              console.log(
                `[Image Debug] Split mode: using originalCanvasSize center (${left}, ${top}) instead of frame center`
              );
            }
          }

          if (hasSavedBackgroundWorldRect && shouldUseSavedBackgroundWorldRect) {
            left = preferredRestoreWorldRect.left + preferredRestoreWorldRect.width / 2;
            top = preferredRestoreWorldRect.top + preferredRestoreWorldRect.height / 2;
            const scaleFromWidth = preferredRestoreWorldRect.width / rotatedWidthBasis;
            const scaleFromHeight = preferredRestoreWorldRect.height / rotatedHeightBasis;
            scale =
              Number.isFinite(scaleFromWidth) &&
              Number.isFinite(scaleFromHeight) &&
              scaleFromWidth > 0 &&
              scaleFromHeight > 0
                ? (scaleFromWidth + scaleFromHeight) / 2
                : preferredRestoreWorldRect.width / imgWidth;
            console.log(
              `[Image Restore World Rect] Scale: ${scale.toFixed(3)} at (${left}, ${top})`,
              {
                source: 'view-background-world-rect',
                savedBackgroundWorldRect,
                normalizedBackgroundRotation,
                rotatedWidthBasis,
                rotatedHeightBasis,
                scaleFromWidth,
                scaleFromHeight,
              }
            );
          } else {
            switch (fitMode) {
              case 'fit-width':
                scale = frameWidth / rotatedWidthBasis;
                console.log(`[Image Fit Width] Scale: ${scale.toFixed(3)}`);
                break;

              case 'fit-height':
                scale = frameHeight / rotatedHeightBasis;
                console.log(`[Image Fit Height] Scale: ${scale.toFixed(3)}`);
                break;

              case 'fit-canvas':
              case 'scale-page-size':
                scale = Math.min(frameWidth / rotatedWidthBasis, frameHeight / rotatedHeightBasis);
                console.log(`[Image Fit Canvas] Scale: ${scale.toFixed(3)}`);
                break;

              case 'fill-frame':
                scale = Math.max(frameWidth / rotatedWidthBasis, frameHeight / rotatedHeightBasis);
                console.log(`[Image Fill Frame] Scale: ${scale.toFixed(3)}`);
                break;

              case 'actual-size':
                scale = 1;
                console.log(`[Image Actual Size] Scale: 1.000`);
                break;

              default:
                // Default to fit canvas (frame)
                scale = Math.min(frameWidth / rotatedWidthBasis, frameHeight / rotatedHeightBasis);
                console.log(`[Image Default] Scale: ${scale.toFixed(3)}`);
                break;
            }
          }

          img.set({
            originX: 'center',
            originY: 'center',
            left: left,
            top: top,
            scaleX: scale,
            scaleY: scale,
            angle: normalizedBackgroundRotation,
            selectable: false,
            evented: false,
          });
          img.openpaintFitMode = fitMode;

          console.log(
            `[Image Debug] Applied settings:\n` +
              `  Position: (${left}, ${top})\n` +
              `  Scale: ${scale.toFixed(3)}x${scale.toFixed(3)}\n` +
              `  Scaled size: ${(imgWidth * scale).toFixed(1)}x${(imgHeight * scale).toFixed(1)}`
          );

          canvas.setBackgroundImage(img, () => {
            if (!isCurrentLoad()) return;
            canvas.requestRenderAll();
            const restoredFromSaved =
              shouldUseSavedBackgroundWorldRect && hasSavedBackgroundWorldRect;
            if ((fitMode === 'scale-page-size' || fitMode === 'fill-frame') && !restoredFromSaved) {
              this.canvasManager.suppressResizeRefitUntil = Date.now() + 500;
              this.canvasManager.refitBackgroundImageToPlacementFrame?.();
              const backgroundWorldRect = this.canvasManager.getBackgroundWorldRect?.();
              const placementFrame = this.canvasManager.getBackgroundPlacementFrame?.();
              if (
                backgroundWorldRect &&
                placementFrame &&
                this.canvasManager.fitViewportToBackgroundPlacementFrame?.(
                  backgroundWorldRect,
                  placementFrame,
                  this.canvasManager.getViewportState?.()
                )
              ) {
                this.canvasManager.applyViewportTransform?.();
              }
              canvas.requestRenderAll();
            } else if (
              !restoredFromSaved &&
              (fitMode === 'fit-canvas' || fitMode === 'fit-width' || fitMode === 'fit-height') &&
              !(viewState?.viewport && viewState.viewport.zoom)
            ) {
              // No-op placeholder: the unified first-upload re-fit below handles
              // these modes (and portrait, where portraitFrameApplied is set).
            }
            if (
              initialFrameApplied ||
              ((fitMode === 'fit-canvas' || fitMode === 'fit-width' || fitMode === 'fit-height') &&
                !restoredFromSaved &&
                !(viewState?.viewport && viewState.viewport.zoom))
            ) {
              // FIRST UPLOAD re-fit (any aspect ratio / orientation).
              //
              // The background is placed at the frame center in world coords, but
              // two downstream passes overwrite that centered viewport:
              //   1. The CanvasManager resize coordinator (~immediate).
              //   2. The capture-frame replay (replayCaptureFrameForCurrentResize,
              //      ~100ms later) which reads the active tab's viewport, not the
              //      just-fit canvasManager pan, and recomputes panY from a stale
              //      anchor — leaving the image offset by tens of px.
              // Layout settling is timing-dependent and varies by machine. A single
              // fixed timeout races the settle. Poll the re-fit across a wider
              // window, persisting the corrected viewport onto the active capture
              // tab each pass so subsequent replays stay centered, and stopping
              // early once a pass makes no further change (converged). The
              // background itself is NOT re-scaled here — fit-canvas already
              // scaled it correctly during placement.
              this.canvasManager.suppressResizeRefitUntil = Date.now() + 500;
              const performFirstUploadFit = () => {
                if (!isCurrentLoad()) return false;
                const liveBg = canvas.backgroundImage;
                if (!liveBg) return false;

                // Align the background center onto the frame center via the
                // viewport. The frame itself is positioned by the capture-frame
                // system (getPreferredCaptureArea / buildCenteredRectFromSize);
                // this corrects any viewport drift after layout settles.
                const placement = this.canvasManager.getBackgroundPlacementFrame?.();
                const liveTransform = canvas.viewportTransform;
                const backgroundCenter = liveBg.getCenterPoint?.();
                if (!placement || !backgroundCenter || !Array.isArray(liveTransform)) {
                  return false;
                }

                const mappedCenter = fabric.util.transformPoint(
                  new fabric.Point(backgroundCenter.x, backgroundCenter.y),
                  liveTransform
                );
                const targetCenter = {
                  x: placement.left + placement.width / 2,
                  y: placement.top + placement.height / 2,
                };
                const dx = targetCenter.x - mappedCenter.x;
                const dy = targetCenter.y - mappedCenter.y;
                if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return false;

                // Apply the correction via setViewportState with the EXACT
                // numeric pan (liveTransform[4]/[5] + delta), not via
                // setViewportTransformExact's matrix decomposition. The
                // decomposition recomputes pan from getRotationCenter and can
                // land on a different value than intended, so the capture-frame
                // replay (which reads the numeric viewport) re-diverges on the
                // next tick — the source of the first-upload four-corners
                // flakiness.
                const currentViewport = this.canvasManager.getViewportState?.() || {};
                const correctedPanX = (Number(currentViewport.panX) || 0) + dx;
                const correctedPanY = (Number(currentViewport.panY) || 0) + dy;
                this.canvasManager.setViewportState?.({
                  zoom: Number(currentViewport.zoom) || this.canvasManager.zoomLevel,
                  panX: correctedPanX,
                  panY: correctedPanY,
                });

                const tabState = window.captureTabsByLabel?.[requestedViewId];
                const activeFrame = tabState?.tabs?.find(
                  tab => tab.id === tabState.activeTabId && tab.type !== 'master'
                );
                if (activeFrame) {
                  activeFrame.viewport = {
                    ...activeFrame.viewport,
                    zoom: Number(currentViewport.zoom) || this.canvasManager.zoomLevel,
                    panX: correctedPanX,
                    panY: correctedPanY,
                    rotation: this.canvasManager.getRotationDegrees?.() || 0,
                  };
                  const newTransform = canvas.viewportTransform;
                  if (Array.isArray(newTransform)) {
                    activeFrame.viewportTransform = [...newTransform];
                  }
                }
                return true;
              };
              let remainingPasses = 10;
              const pollFit = () => {
                if (!isCurrentLoad() || remainingPasses <= 0) return;
                remainingPasses -= 1;
                // Always run the fit — don't stop early when one pass happens to
                // be aligned. The capture-frame replay (replayCaptureFrameForCurrentResize)
                // shifts the frame AFTER layout settles, and a single aligned pass
                // doesn't guarantee the frame won't move again on the next tick.
                // Running all passes (covering ~1.2s) outlasts the replay.
                performFirstUploadFit();
                if (remainingPasses > 0) {
                  window.setTimeout(pollFit, 120);
                } else {
                  // Final pass: one last correction after the replay has fully
                  // settled, so the converged state is the displayed state.
                  performFirstUploadFit();
                }
              };
              window.setTimeout(pollFit, 100);
            }
            // Sync the active tab's worldRect so applyCaptureFrameForLabel has a
            // valid geometry to work with. Only sync the viewport for views with
            // no saved viewport state — views with saved data should restore their
            // original zoom/pan from view.viewport via restoreViewportForView.
            const bgWorldRect = this.canvasManager.getBackgroundWorldRect?.();
            const tabs = (window as any).captureTabsByLabel?.[this.currentViewId]?.tabs;
            const viewForSync = this.views?.[this.currentViewId];
            const hasSavedViewport = !!(
              viewForSync?.viewport &&
              typeof viewForSync.viewport === 'object' &&
              viewForSync.viewport.zoom
            );
            if (tabs && bgWorldRect) {
              const activeTab = tabs.find((t: any) => t.type !== 'master') || tabs[0];
              if (activeTab) {
                if (!hasSavedViewport) {
                  activeTab.viewport = {
                    zoom: this.canvasManager.zoomLevel,
                    panX: this.canvasManager.panX,
                    panY: this.canvasManager.panY,
                    rotation: this.canvasManager.rotationDegrees || 0,
                  };
                }
                // The tab frame and background placement are independent pieces
                // of state. Seed a missing frame once, but never replace a user's
                // saved frame whenever this view's image is reloaded.
                if (!activeTab.captureFrame) activeTab.captureFrame = {};
                if (!activeTab.captureFrame.worldRect) {
                  activeTab.captureFrame = {
                    ...activeTab.captureFrame,
                    worldRect: bgWorldRect,
                  };
                }
              }
            }
          });

          // Save fit mode for this view so resize can use it
          if (this.currentViewId && this.views[this.currentViewId]) {
            this.views[this.currentViewId].fitMode = fitMode;
            console.log(
              `[Image Debug] Saved fit mode '${fitMode}' for view: ${this.currentViewId}`
            );
          }

          console.log('[Image Debug] ✓ Background image set and rendered');
          console.log('[Image Debug] ===== BACKGROUND IMAGE SET COMPLETE =====\n');

          // Notify MOS overlay system that image rect has changed
          canvas.fire('mos:imageRect:changed');

          resolve();
        },
        imgOptions
      );
    });
  }

  getViewList() {
    return Object.keys(this.views);
  }

  rotateCurrentView(deltaDegrees) {
    const view = this.views[this.currentViewId];
    if (!view) return;
    const isMasterUnlocked =
      document.body.classList.contains('master-view-active') &&
      document.body.classList.contains('capture-unlocked');
    if (isMasterUnlocked) {
      const nextBackgroundRotation = this.canvasManager.rotateBackgroundImageBy(deltaDegrees);
      view.backgroundRotation = nextBackgroundRotation;
      this.updateThumbnailRotation(
        this.currentViewId,
        Number.isFinite(view.rotation) ? view.rotation : this.canvasManager.getRotationDegrees()
      );
      if (typeof window.captureTabsSyncActive === 'function') {
        window.captureTabsSyncActive(this.currentViewId, { syncRotation: false });
      }
      return;
    }
    const nextRotation = this.canvasManager.rotateCanvasObjects(deltaDegrees);
    view.rotation = nextRotation;
    this.updateThumbnailRotation(this.currentViewId, nextRotation);
    if (typeof window.captureTabsSyncActive === 'function') {
      window.__captureTabsAllowRotationWrite = true;
      window.captureTabsSyncActive(this.currentViewId, { syncRotation: true });
    }
  }

  updateThumbnailRotation(viewId, rotationDegrees) {
    const baseRotation = Number.isFinite(Number(rotationDegrees))
      ? Number(rotationDegrees)
      : Number(this.views?.[viewId]?.rotation) || 0;
    const backgroundRotation = Number(this.views?.[viewId]?.backgroundRotation) || 0;
    const normalized = (((baseRotation + backgroundRotation) % 360) + 360) % 360;
    const needsScale = normalized === 90 || normalized === 270;
    const scale = needsScale ? 0.9 : 1;
    const targets = document.querySelectorAll('.image-thumbnail, .image-container');
    targets.forEach(container => {
      const label =
        container.dataset?.label ||
        container.getAttribute('title') ||
        container.dataset?.imageIndex ||
        container.id;
      if (label !== viewId) return;

      let preview = container;
      if (container.classList.contains('image-container')) {
        preview =
          container.querySelector('.image-thumbnail') ||
          container.querySelector('.image-thumb') ||
          container.querySelector('img') ||
          container.querySelector('canvas');
        if (!preview) return;
      }

      preview.style.transform = `rotate(${normalized}deg) scale(${scale})`;
      preview.style.transformOrigin = '50% 50%';
      preview.dataset.rotation = String(normalized);
      if (preview.classList && preview.classList.contains('image-thumbnail')) {
        preview.style.overflow = 'hidden';
      }
    });
  }

  async deleteImage(viewId) {
    if (!this.views[viewId]) {
      console.warn(`View ${viewId} does not exist.`);
      return;
    }

    const tabPrefix = `${viewId}::tab:`;
    const orderedBeforeDelete = Array.isArray(window.orderedImageLabels)
      ? [...window.orderedImageLabels]
      : Object.keys(this.views);
    const deletedIndex = orderedBeforeDelete.indexOf(viewId);
    const remainingOrder = orderedBeforeDelete.filter(id => id !== viewId && this.views[id]);
    const nextViewId =
      remainingOrder[Math.min(Math.max(deletedIndex, 0), remainingOrder.length - 1)] ||
      remainingOrder[0] ||
      Object.keys(this.views).find(id => id !== viewId) ||
      null;

    const deleteScopedEntries = store => {
      if (!store || typeof store !== 'object') return;
      Object.keys(store).forEach(key => {
        if (key === viewId || key.startsWith(tabPrefix)) delete store[key];
      });
    };
    [
      window.vectorStrokesByImage,
      window.lineStrokesByImage,
      window.strokeVisibilityByImage,
      window.strokeLabelVisibility,
      window.strokeMeasurements,
      window.customLabelPositions,
      window.calculatedLabelOffsets,
      window.customLabelRotationStamps,
      window.textElementsByImage,
      window.shapeElementsByImage,
      window.customLabelOffsetsRotationByImageAndStroke,
    ].forEach(deleteScopedEntries);

    const metadataManager = window.app?.metadataManager;
    metadataManager?.clearScopedBucketsForView?.(viewId);
    metadataManager?.clearImageMetadata?.(viewId);

    [
      window.captureTabsByLabel,
      window.customImageNames,
      window.originalImages,
      window.originalImageDimensions,
      window.imageRotationByLabel,
    ].forEach(store => {
      if (store) delete store[viewId];
    });

    const metadata = this.projectMetadata || window.projectMetadata || {};
    [
      'measurementGuideModelLinksByImage',
      'measurementGuideLabelsByImage',
      'measurementGuideCodesByView',
      'measurementGuideLockByView',
      'imagePartLabels',
      'tagSizeByView',
    ].forEach(name => {
      if (metadata[name]) delete metadata[name][viewId];
    });
    [
      'measurementGuideModelLinksByScope',
      'measurementGuideBindingsByScope',
      'tagStyleByScope',
      'tagSizeByView',
    ].forEach(name => deleteScopedEntries(metadata[name]));

    delete this.views[viewId];
    this.viewImageFiles?.delete?.(viewId);
    imageRegistry.unregisterImage?.(viewId);
    window.orderedImageLabels = remainingOrder;
    window.imageGallery?.removeByLabel?.(viewId);

    // If we deleted the current view, switch to another one
    if (this.currentViewId === viewId) {
      if (nextViewId) {
        await this.switchView(nextViewId);
      } else {
        // No views left, clear canvas
        this.currentViewId = null;
        this.canvasManager.clear();
        if (this.canvasManager.fabricCanvas) {
          this.canvasManager.fabricCanvas.setBackgroundImage(
            null,
            this.canvasManager.fabricCanvas.requestRenderAll.bind(this.canvasManager.fabricCanvas)
          );
        }
      }
    }

    console.log(`Deleted view: ${viewId}`);
  }

  async shareProject() {
    let originalText = '';
    try {
      // Show loading state
      const shareBtn = document.getElementById('shareProjectBtn');
      if (shareBtn) originalText = shareBtn.textContent;
      if (shareBtn) {
        shareBtn.textContent = 'Creating share link';
        shareBtn.disabled = true;
      }

      // Prepare images as data URLs for portability across tabs

      // Prepare images as data URLs for portability across tabs

      // Strategy 1: Sync from window.imageGalleryData
      let galleryData = window.imageGalleryData;

      // Strategy 2: Try getter if direct access fails
      if (
        (!galleryData || galleryData.length === 0) &&
        window.imageGallery &&
        typeof window.imageGallery.getData === 'function'
      ) {
        galleryData = window.imageGallery.getData();
      }

      // Strategy 3: Scrape DOM if data is still missing
      if (!galleryData || galleryData.length === 0) {
        const thumbnails = document.querySelectorAll('.image-thumbnail');
        if (thumbnails.length > 0) {
          galleryData = [];
          thumbnails.forEach((thumb, index) => {
            const style = thumb.style.backgroundImage; // url("...")
            const title = thumb.title || thumb.getAttribute('title');
            let src = '';
            if (style && style.includes('url')) {
              src = style.slice(style.indexOf('url(') + 4, style.lastIndexOf(')'));
              if (src.startsWith('"') || src.startsWith("'")) {
                src = src.slice(1, -1);
              }
            }
            if (src) {
              galleryData.push({
                src: src,
                name: title || `image_${index}`,
                original: { label: title || `image_${index}` },
              });
            }
          });
        }
      }

      // Apply found data
      if (galleryData && galleryData.length > 0) {
        window.originalImages = window.originalImages || {};
        galleryData.forEach(item => {
          const label =
            item.original?.label || item.name || 'image_' + Math.random().toString(36).substr(2, 9);
          // Always update if we have a source
          if (item.src) {
            if (!window.originalImages[label]) {
              window.originalImages[label] = item.src;
            }
          }
        });
      }

      async function toDataUrl(src) {
        try {
          const resp = await fetch(src);
          const blob = await resp.blob();
          return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        } catch (e) {
          console.error('Failed to convert to Data URL:', src);
          return null;
        }
      }
      async function convertOriginalImages(images) {
        const result = {};
        const labels = Object.keys(images || {});
        for (const label of labels) {
          const src = images[label];
          if (!src) continue;
          if (typeof src === 'string' && src.startsWith('data:')) {
            result[label] = src;
          } else {
            const dataUrl = await toDataUrl(src);
            if (dataUrl) {
              result[label] = dataUrl;
            }
          }
        }
        return result;
      }

      const originalImagesForShare = await convertOriginalImages(window.originalImages || {});

      // Determine robust image label list
      let labelsFromOrder =
        Array.isArray(window.orderedImageLabels) && window.orderedImageLabels.length
          ? window.orderedImageLabels.slice()
          : [];
      const labelsFromTags = Object.keys(window.imageTags || {});
      const labelsFromImages = Object.keys(window.originalImages || {});
      const labelsFromState =
        window.paintApp && window.paintApp.state && Array.isArray(window.paintApp.state.imageLabels)
          ? window.paintApp.state.imageLabels
          : [];

      // Fallback to ProjectManager views if globals are empty
      if (
        labelsFromOrder.length === 0 &&
        labelsFromTags.length === 0 &&
        labelsFromImages.length === 0 &&
        labelsFromState.length === 0
      ) {
        if (this.views) {
          labelsFromOrder = Object.keys(this.views);
        }
      }

      const imageLabels = labelsFromOrder.length
        ? labelsFromOrder
        : labelsFromTags.length
          ? labelsFromTags
          : labelsFromImages.length
            ? labelsFromImages
            : labelsFromState;

      let currentImageLabel =
        (window.paintApp && window.paintApp.state && window.paintApp.state.currentImageLabel) ||
        imageLabels[0] ||
        null;

      // Fallback to ProjectManager current view
      if (!currentImageLabel && this.currentViewId) {
        currentImageLabel = this.currentViewId;
      }

      // Collect project data for sharing
      const sourceCanvas = (() => {
        const fabricCanvas = window.app?.canvasManager?.fabricCanvas;
        if (!fabricCanvas) {
          return null;
        }
        const width = Number(fabricCanvas.width);
        const height = Number(fabricCanvas.height);
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
          return null;
        }
        return { width, height };
      })();

      const projectData = {
        currentImageLabel,
        imageLabels,
        metadata: this.getProjectMetadata(),
        originalImages: originalImagesForShare,
        originalImageDimensions: window.originalImageDimensions || {},
        strokes: window.vectorStrokesByImage || {},
        strokeVisibility: window.strokeVisibilityByImage || {},
        strokeSequence: window.lineStrokesByImage || {},
        strokeMeasurements: window.strokeMeasurements || {},
        strokeLabelVisibility: window.strokeLabelVisibility || {},
        imageScales: window.paintApp?.state?.imageScaleByLabel || {},
        imagePositions: window.paintApp?.state?.imagePositionByLabel || {},
        sourceCanvas,
        customImageNames: window.customImageNames || {},
      };

      // Include custom label positions and rotation stamps for accurate label placement
      try {
        projectData.customLabelPositions = {};
        imageLabels.forEach(label => {
          projectData.customLabelPositions[label] =
            window.customLabelPositions && window.customLabelPositions[label]
              ? JSON.parse(JSON.stringify(window.customLabelPositions[label]))
              : {};
        });
        if (window.customLabelOffsetsRotationByImageAndStroke) {
          projectData.customLabelRotationStamps = {};
          imageLabels.forEach(label => {
            projectData.customLabelRotationStamps[label] = window
              .customLabelOffsetsRotationByImageAndStroke[label]
              ? JSON.parse(JSON.stringify(window.customLabelOffsetsRotationByImageAndStroke[label]))
              : {};
          });
        }
      } catch (e) {
        // best-effort; ignore if deep copy fails
      }

      // Share options
      const shareOptions = {
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
        isPublic: true,
        allowEditing: false,
        measurements: {},
      };

      // Convert Blob URLs to Data URLs for sharing
      const processedProjectData = await this.convertBlobsToDataUrls(projectData);

      // Send to backend
      const response = await fetch('/api/share-project', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: document.getElementById('projectName')?.value || 'OpenPaint Project',
          projectData: processedProjectData,
          shareOptions: shareOptions,
        }),
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.message || 'Failed to create share link');
      }

      // Show share dialog
      this.showShareDialog(result.shareUrl, result.expiresAt);

      // Show success message
      this.showStatusMessage('Share link created successfully!', 'success');

      // Persist share info for future updates
      try {
        window.lastShareId = result.shareId;
        window.lastEditToken = result.editToken;
        if (window.localStorage) {
          localStorage.setItem('openpaint:lastShareId', result.shareId);
          localStorage.setItem('openpaint:lastEditToken', result.editToken);
        }
      } catch (e) {
        // ignore storage errors
      }
    } catch (error) {
      console.error('Error creating share link:', error);

      this.showStatusMessage('Failed to create share link: ' + error.message, 'error');
    } finally {
      // Restore button state
      const shareBtn = document.getElementById('shareProjectBtn');
      if (shareBtn) {
        shareBtn.textContent = originalText || 'Share';
        shareBtn.disabled = false;
      }
    }
  }

  async updateSharedProject() {
    try {
      const shareId =
        window.lastShareId ||
        (window.localStorage && localStorage.getItem('openpaint:lastShareId'));
      const editToken =
        window.lastEditToken ||
        (window.localStorage && localStorage.getItem('openpaint:lastEditToken'));
      if (!shareId || !editToken) {
        const msg = 'No existing share info found. Create a share link first.';
        this.showStatusMessage(msg, 'error');
        return;
      }

      const btn = document.getElementById('updateShareBtn');
      if (btn) {
        btn.textContent = 'Updating share link';
        btn.disabled = true;
      }

      // Strategy 1: Sync from window.imageGalleryData
      let galleryData = window.imageGalleryData;

      // Strategy 2: Try getter if direct access fails
      if (
        (!galleryData || galleryData.length === 0) &&
        window.imageGallery &&
        typeof window.imageGallery.getData === 'function'
      ) {
        galleryData = window.imageGallery.getData();
      }

      // Strategy 3: Scrape DOM if data is still missing
      if (!galleryData || galleryData.length === 0) {
        const thumbnails = document.querySelectorAll('.image-thumbnail');
        if (thumbnails.length > 0) {
          galleryData = [];
          thumbnails.forEach((thumb, index) => {
            const style = thumb.style.backgroundImage;
            const title = thumb.title || thumb.getAttribute('title');
            let src = '';
            if (style && style.includes('url')) {
              src = style.slice(style.indexOf('url(') + 4, style.lastIndexOf(')'));
              if (src.startsWith('"') || src.startsWith("'")) {
                src = src.slice(1, -1);
              }
            }
            if (src) {
              galleryData.push({
                src: src,
                name: title || `image_${index}`,
                original: { label: title || `image_${index}` },
              });
            }
          });
        }
      }

      // Apply found data
      if (galleryData && galleryData.length > 0) {
        window.originalImages = window.originalImages || {};
        galleryData.forEach(item => {
          const label =
            item.original?.label || item.name || 'image_' + Math.random().toString(36).substr(2, 9);
          if (item.src && !window.originalImages[label]) {
            window.originalImages[label] = item.src;
          }
        });
      }

      const sourceCanvas = (() => {
        const fabricCanvas = window.app?.canvasManager?.fabricCanvas;
        if (!fabricCanvas) {
          return null;
        }
        const width = Number(fabricCanvas.width);
        const height = Number(fabricCanvas.height);
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
          return null;
        }
        return { width, height };
      })();

      const projectData = {
        currentImageLabel: window.paintApp?.state?.currentImageLabel,
        imageLabels: window.paintApp?.state?.imageLabels || [],
        metadata: this.getProjectMetadata(),
        originalImages: window.originalImages || {},
        originalImageDimensions: window.originalImageDimensions || {},
        strokes: window.vectorStrokesByImage || {},
        strokeVisibility: window.strokeVisibilityByImage || {},
        strokeSequence: window.lineStrokesByImage || {},
        strokeMeasurements: window.strokeMeasurements || {},
        strokeLabelVisibility: window.strokeLabelVisibility || {},
        imageScales: window.paintApp?.state?.imageScaleByLabel || {},
        imagePositions: window.paintApp?.state?.imagePositionByLabel || {},
        sourceCanvas,
        customImageNames: window.customImageNames || {},
      };

      const response = await fetch(`/api/shared/${shareId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          editToken,
          title: document.getElementById('projectName')?.value || null,
          projectData,
          shareOptions: {},
        }),
      });
      const result = await response.json();
      if (!result.success) {
        throw new Error(result.message || 'Failed to update shared project');
      }

      this.showStatusMessage('Shared project updated.', 'success');
    } catch (error) {
      console.error('Error updating shared project:', error);
      this.showStatusMessage('Failed to update share: ' + error.message, 'error');
    } finally {
      const btn = document.getElementById('updateShareBtn');
      if (btn) {
        btn.textContent = 'Update Share';
        btn.disabled = false;
      }
    }
  }

  showShareDialog(shareUrl, expiresAt) {
    // Create modal dialog
    const modal = document.createElement('div');
    modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            font-family: Arial, sans-serif;
        `;

    const dialog = document.createElement('div');
    dialog.style.cssText = `
            background: white;
            border-radius: 15px;
            padding: 30px;
            max-width: 600px;
            width: 90%;
            box-shadow: 0 20px 40px rgba(0,0,0,0.2);
            max-height: 90vh;
            overflow-y: auto;
        `;

    const expiryDate = new Date(expiresAt).toLocaleDateString();
    const editToken =
      window.lastEditToken ||
      (window.localStorage && localStorage.getItem('openpaint:lastEditToken'));
    // Construct production URL
    const productionUrl =
      shareUrl.replace('/shared/', '/production/') + (editToken ? `?editToken=${editToken}` : '');

    dialog.innerHTML = `
            <h2 style="color: #2c3e50; margin: 0 0 20px 0; font-size: 1.5em;">🔗 Project Shared Successfully</h2>
            
            <div style="margin-bottom: 25px;">
                <h3 style="font-size: 1.1em; color: #007bff; margin-bottom: 10px;">👤 Customer Link</h3>
                <p style="color: #666; font-size: 0.9em; margin-bottom: 10px;">
                    Share this link with your customer to collect measurements:
                </p>
                <div style="background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 10px; display: flex; gap: 10px;">
                    <input type="text" value="${shareUrl}" readonly style="flex: 1; border: none; background: transparent; font-family: monospace; font-size: 13px; outline: none;">
                    <button class="copy-btn" data-target="${shareUrl}" style="background: #e9ecef; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; font-size: 12px;">Copy</button>
                </div>
            </div>

            <div style="margin-bottom: 25px; padding-top: 20px; border-top: 1px solid #eee;">
                <h3 style="font-size: 1.1em; color: #dc3545; margin-bottom: 10px;">🏭 Production Team Link</h3>
                <p style="color: #666; font-size: 0.9em; margin-bottom: 10px;">
                    Use this <strong>internal</strong> link to view the project and submitted measurements. <br>
                    <span style="color: #dc3545; font-size: 0.85em;">⚠️ Do not share this with customers.</span>
                </p>
                <div style="background: #fff5f5; border: 1px solid #ffeeba; border-radius: 8px; padding: 10px; display: flex; gap: 10px;">
                    <input type="text" value="${productionUrl}" readonly style="flex: 1; border: none; background: transparent; font-family: monospace; font-size: 13px; outline: none; color: #dc3545;">
                    <button class="copy-btn" data-target="${productionUrl}" style="background: #ffeeba; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; font-size: 12px; color: #856404;">Copy</button>
                </div>
            </div>
            
            <div style="display: flex; gap: 10px; margin-bottom: 20px;">
                <button id="openCustomerBtn" style="flex: 1; background: #007bff; color: white; border: none; padding: 12px; border-radius: 8px; cursor: pointer; font-weight: 600;">
                    Open Customer View
                </button>
                <button id="openProductionBtn" style="flex: 1; background: #6c757d; color: white; border: none; padding: 12px; border-radius: 8px; cursor: pointer; font-weight: 600;">
                    Open Production View
                </button>
            </div>
            
            <p style="color: #666; font-size: 12px; margin-bottom: 20px; text-align: center;">
                ⏰ Link expires: ${expiryDate}
            </p>
            
            <div style="text-align: center;">
                <button id="closeModalBtn" style="background: transparent; color: #666; border: 1px solid #ccc; padding: 8px 20px; border-radius: 8px; cursor: pointer;">
                    Close
                </button>
            </div>
        `;

    modal.appendChild(dialog);
    document.body.appendChild(modal);

    // Event listeners
    modal.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const text = btn.dataset.target;
        try {
          await navigator.clipboard.writeText(text);
          const originalText = btn.textContent;
          btn.textContent = 'Copied!';
          setTimeout(() => (btn.textContent = originalText), 2000);
        } catch (err) {
          console.error('Failed to copy:', err);
        }
      });
    });

    document
      .getElementById('openCustomerBtn')
      .addEventListener('click', () => window.open(shareUrl, '_blank'));
    document
      .getElementById('openProductionBtn')
      .addEventListener('click', () => window.open(productionUrl, '_blank'));

    document.getElementById('closeModalBtn').addEventListener('click', () => {
      document.body.removeChild(modal);
    });

    modal.addEventListener('click', e => {
      if (e.target === modal) document.body.removeChild(modal);
    });
  }

  showStatusMessage(message, type = 'info') {
    const notify = (window as any)?.notifyOpenPaint;
    const showStatus = (window as any)?.showStatusMessage;
    if (typeof notify === 'function') {
      notify({ message, kind: type });
      return;
    }
    if (typeof showStatus === 'function') {
      showStatus(message, type);
      return;
    }
    console[type === 'error' ? 'error' : 'log']('[Status]', message);
  }

  ensureProjectLoadOverlay() {
    if (this.projectLoadOverlayEl && document.body.contains(this.projectLoadOverlayEl)) {
      return this.projectLoadOverlayEl;
    }
    let overlay = document.getElementById('projectLoadOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'projectLoadOverlay';
      overlay.style.cssText =
        'position: fixed; inset: 0; z-index: 11999; background: rgba(15, 23, 42, 0.4); display: none; align-items: center; justify-content: center;';
      overlay.innerHTML =
        '<div style="background:#fff; border-radius:12px; padding:16px 18px; min-width:280px; box-shadow:0 12px 30px rgba(0,0,0,0.22); font-family: system-ui, -apple-system, sans-serif;"><div id="projectLoadOverlayTitle" style="font-weight:700; color:#0f172a; font-size:14px; margin-bottom:8px;">Loading Project</div><div id="projectLoadOverlayPhase" style="font-size:13px; color:#334155;">Preparing...</div></div>';
      document.body.appendChild(overlay);
    }
    this.projectLoadOverlayEl = overlay;
    return overlay;
  }

  showProjectLoadOverlay(phase = 'Preparing...') {
    const overlay = this.ensureProjectLoadOverlay();
    const phaseEl = overlay.querySelector('#projectLoadOverlayPhase');
    if (phaseEl) phaseEl.textContent = phase;
    overlay.style.display = 'flex';
  }

  updateProjectLoadOverlay(phase = 'Preparing...') {
    const overlay = this.ensureProjectLoadOverlay();
    const phaseEl = overlay.querySelector('#projectLoadOverlayPhase');
    if (phaseEl) phaseEl.textContent = phase;
  }

  hideProjectLoadOverlay() {
    if (!this.projectLoadOverlayEl) return;
    this.projectLoadOverlayEl.style.display = 'none';
  }

  renderSaveOutcome(outcome) {
    const message = formatSaveOutcomeLines(outcome);
    const type =
      outcome.local.status !== 'success'
        ? 'error'
        : outcome.cloud.attempted && outcome.cloud.status === 'failed'
          ? 'info'
          : 'success';
    this.showStatusMessage(message, type);
  }

  toNormalizedCloudError(cloudResult) {
    if (cloudResult?.error?.userMessage) {
      return cloudResult.error;
    }

    return normalizeCloudError({
      statusCode: cloudResult?.statusCode,
      code: cloudResult?.error?.code || cloudResult?.code,
      message: cloudResult?.error?.message || cloudResult?.message || 'Cloud save failed',
      name: cloudResult?.error?.name,
      details: cloudResult,
    });
  }

  async convertBlobsToDataUrls(data) {
    if (!data) return data;

    // Helper to convert a single blob URL
    const blobUrlToDataUrl = async blobUrl => {
      try {
        const response = await fetch(blobUrl);
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } catch (e) {
        console.warn('Failed to convert blob URL:', blobUrl, e);
        return blobUrl; // Return original if conversion fails
      }
    };

    // Deep clone to avoid mutating original
    const clone = JSON.parse(JSON.stringify(data));

    // Recursive traversal
    const traverse = async obj => {
      if (!obj || typeof obj !== 'object') return;

      for (const key in obj) {
        const value = obj[key];
        if (typeof value === 'string' && value.startsWith('blob:')) {
          obj[key] = await blobUrlToDataUrl(value);
        } else if (typeof value === 'object') {
          await traverse(value);
        }
      }
    };

    await traverse(clone);
    return clone;
  }

  getCanvasCustomProps() {
    return [
      'strokeMetadata',
      'arrowSettings',
      'customPoints',
      'isArrow',
      'tagOffset',
      'isTag',
      'isTagText',
      'labelVisible',
      'visible',
      'connectedTo',
      'tagLabel',
      'isConnectorLine',
      'perPixelTargetFind',
      '_pointsVersion',
      '_customPointsConverted',
      'dashSettings',
      'lineStyle',
    ];
  }

  sanitizeCanvasJSON(canvasData) {
    if (!canvasData || typeof canvasData !== 'object') {
      return canvasData;
    }

    const validTextBaselines = ['top', 'hanging', 'middle', 'alphabetic', 'ideographic', 'bottom'];
    let sanitizedCount = 0;

    const sanitizeObject = obj => {
      if (!obj || typeof obj !== 'object') return obj;

      if (Array.isArray(obj)) {
        return obj.map(item => sanitizeObject(item));
      }

      const sanitized = { ...obj };

      // Fix invalid textBaseline values (common in old saved data)
      if (sanitized.textBaseline && !validTextBaselines.includes(sanitized.textBaseline)) {
        console.warn(
          `[Sanitize] Invalid textBaseline "${sanitized.textBaseline}", replacing with "middle"`
        );
        sanitized.textBaseline = 'middle';
        sanitizedCount++;
      }

      // Recursively sanitize nested objects
      for (const key in sanitized) {
        if (typeof sanitized[key] === 'string' && sanitized[key].startsWith('blob:')) {
          // Blob URLs are session-local and cannot be reliably restored across project loads.
          // Clear them to avoid "Not allowed to load local resource" errors.
          sanitized[key] = '';
          sanitizedCount++;
        } else if (typeof sanitized[key] === 'object') {
          sanitized[key] = sanitizeObject(sanitized[key]);
        }
      }

      return sanitized;
    };

    const result = sanitizeObject(canvasData);

    if (sanitizedCount > 0) {
      console.log(`[Sanitize] Fixed ${sanitizedCount} invalid textBaseline values`);
    }

    return result;
  }

  async getProjectData(options = {}) {
    const { embedImages = true, uploadImagesToR2 = false } = options;
    const isGuideSplitActive =
      document.getElementById('main-canvas-wrapper')?.classList.contains('guide-split-active') ===
      true;
    if (window.captureTabsSyncActive) {
      window.captureTabsSyncActive(this.currentViewId, {
        preserveWorldRect: true,
        syncRotation: true,
      });
    }
    this.saveCurrentViewState();

    const projectNameInput = document.getElementById('projectName');
    const projectName = projectNameInput?.value?.trim() || 'OpenPaint Project';
    const fabricCanvas = this.canvasManager?.fabricCanvas;
    const metadataManager = window.app?.metadataManager;
    const customProps = this.getCanvasCustomProps();

    console.log('[Save] Gathering project data');

    const deepClone = obj => {
      if (!obj) return {};
      try {
        return JSON.parse(JSON.stringify(obj));
      } catch (e) {
        console.warn('[Save] Failed to clone object', e);
        return {};
      }
    };

    const projectData = {
      version: '2.0-fabric',
      projectName,
      name: projectName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      currentViewId: this.currentViewId,
      metadata: this.getProjectMetadata(),
      viewOrder: [],
      views: {},
    };

    const legacyRuntimeData = this.buildLegacyRuntimeSnapshot();
    const legacyRuntimeViewIds = this.getLegacyViewIdsFromFlatShape(legacyRuntimeData);
    const viewIds = Array.from(
      new Set([...Object.keys(this.views || {}), ...legacyRuntimeViewIds])
    );
    console.log('[Save] Views to persist:', viewIds);

    // Capture view order to preserve gallery order on load
    try {
      const orderFromGlobals =
        Array.isArray(window.orderedImageLabels) && window.orderedImageLabels.length
          ? window.orderedImageLabels.slice()
          : [];
      const orderFromGallery = window.imageGallery?.getData
        ? window.imageGallery
            .getData()
            .map(item => item?.original?.label || item?.label || item?.name || '')
            .filter(Boolean)
        : [];
      const rawOrder = orderFromGlobals.length ? orderFromGlobals : orderFromGallery;
      const filtered = rawOrder.filter(id => viewIds.includes(id));
      const remaining = viewIds.filter(id => !filtered.includes(id));
      projectData.viewOrder = filtered.concat(remaining);
    } catch (e) {
      projectData.viewOrder = viewIds.slice();
    }

    const isBlobUrl = url => typeof url === 'string' && url.startsWith('blob:');
    const firstNonEmptyString = (...values) =>
      values.find(value => typeof value === 'string' && value.trim()) || '';
    const getCanvasBackgroundImageSource = canvas => {
      const backgroundImage = canvas?.backgroundImage;
      if (!backgroundImage) return '';
      return firstNonEmptyString(
        backgroundImage.getSrc?.(),
        backgroundImage.src,
        backgroundImage._element?.currentSrc,
        backgroundImage._element?.src,
        backgroundImage._originalElement?.currentSrc,
        backgroundImage._originalElement?.src
      );
    };
    const getRuntimeImageSourceForView = viewId => {
      const galleryItem = window.imageGallery?.getData?.()?.find?.(item => {
        const label = item?.original?.label || item?.label || item?.name || '';
        return label === viewId;
      });
      const escapedViewId =
        typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
          ? CSS.escape(viewId)
          : String(viewId).replace(/"/g, '\\"');
      return firstNonEmptyString(
        window.originalImages?.[viewId],
        galleryItem?.original?.src,
        galleryItem?.original?.url,
        galleryItem?.src,
        galleryItem?.url,
        document.querySelector(`.image-container[data-label="${escapedViewId}"] img`)?.src,
        document.querySelector(`img[data-label="${escapedViewId}"]`)?.src
      );
    };
    const runWithConcurrency = async (items, limit, worker) => {
      const queue = Array.isArray(items) ? items.slice() : [];
      if (!queue.length) return;
      const concurrency = Math.max(1, Number(limit) || 1);
      const workers = new Array(Math.min(concurrency, queue.length)).fill(null).map(async () => {
        while (queue.length > 0) {
          const next = queue.shift();
          await worker(next);
        }
      });
      await Promise.all(workers);
    };

    const viewEntries = {};
    const imageUploadFailures = [];
    const persistConcurrency = uploadImagesToR2 ? 3 : 1;

    await runWithConcurrency(viewIds, persistConcurrency, async viewId => {
      const view = this.views[viewId] || {};
      const legacyEntry = this.buildLegacyViewEntry(legacyRuntimeData, viewId);
      const entry = {
        canvasJSON: null,
        imageDataURL: null,
        imageUrl: view.image || legacyEntry.imageUrl || null,
        imageAssetPath: null,
        imageAssetHash: view.imageAssetHash || null,
        imageContentType: view.imageContentType || null,
        imageSourceFingerprint: view.imageSourceFingerprint || null,
        rotation: 0,
        backgroundRotation: 0,
        fitMode: typeof view.fitMode === 'string' ? view.fitMode : 'fit-canvas',
        metadata: {},
        tabs: null,
        viewportTransform: null,
        backgroundWorldRect: null,
      };

      const stableCanvasJSON = view.canvasData || legacyEntry.canvasJSON || null;
      if (viewId === this.currentViewId && fabricCanvas) {
        entry.canvasJSON = fabricCanvas.toJSON(customProps);
        if (isGuideSplitActive) {
          delete entry.canvasJSON.viewportTransform;
          delete entry.canvasJSON.width;
          delete entry.canvasJSON.height;
          if (stableCanvasJSON?.backgroundImage) {
            entry.canvasJSON.backgroundImage = deepClone(stableCanvasJSON.backgroundImage);
          }
        }
      } else {
        entry.canvasJSON = stableCanvasJSON;
      }
      this.stripMosOverlayObjects(entry.canvasJSON);

      const backgroundImageSrc =
        typeof entry.canvasJSON?.backgroundImage?.src === 'string'
          ? entry.canvasJSON.backgroundImage.src
          : '';
      const liveCanvasBackgroundSource =
        viewId === this.currentViewId && fabricCanvas
          ? getCanvasBackgroundImageSource(fabricCanvas)
          : '';
      const cachedR2Key =
        this.remoteImageObjectKeyByUrl.get(view.image) ||
        this.remoteImageObjectKeyByUrl.get(legacyEntry.imageUrl) ||
        this.remoteImageObjectKeyByUrl.get(liveCanvasBackgroundSource) ||
        null;
      const imagePersistenceSource = firstNonEmptyString(
        view.imageR2Key ? `r2://${view.imageR2Key}` : '',
        cachedR2Key ? `r2://${cachedR2Key}` : '',
        view.image,
        legacyEntry.imageUrl,
        liveCanvasBackgroundSource,
        getRuntimeImageSourceForView(viewId),
        backgroundImageSrc
      );
      const originalUploadFile = this.viewImageFiles.get(viewId) || null;

      if (uploadImagesToR2 && (originalUploadFile || imagePersistenceSource)) {
        try {
          const r2Key = await this.uploadViewImageToR2(
            viewId,
            originalUploadFile || imagePersistenceSource
          );
          if (r2Key) {
            entry.imageDataURL = null;
            entry.imageUrl =
              typeof r2Key === 'string' &&
              (r2Key.startsWith('http://') || r2Key.startsWith('https://'))
                ? r2Key
                : `r2://${r2Key}`;
            entry.imageAssetHash = null;
            entry.imageContentType = null;
            entry.imageSourceFingerprint = null;
            if (this.views[viewId]) {
              this.views[viewId].imageR2Key =
                typeof r2Key === 'string' &&
                !r2Key.startsWith('http://') &&
                !r2Key.startsWith('https://')
                  ? r2Key
                  : this.views[viewId].imageR2Key || null;
            }

            if (entry.canvasJSON?.backgroundImage) {
              entry.canvasJSON.backgroundImage.src = '';
            }
          }
        } catch (err) {
          imageUploadFailures.push({
            viewId,
            message: err instanceof Error ? err.message : String(err),
          });
          console.warn(`[Save] Could not upload image to R2 for ${viewId}:`, err);
        }
      } else if (embedImages && imagePersistenceSource) {
        try {
          entry.imageDataURL = await this.fetchImageAsDataURL(imagePersistenceSource);
        } catch (err) {
          console.warn(`[Save] Could not capture image for ${viewId}:`, err);
        }
      }

      // Prefer stable data URLs over blob URLs in saved JSON
      if (entry.imageDataURL) {
        entry.imageUrl = entry.imageDataURL;
      } else if (isBlobUrl(entry.imageUrl)) {
        entry.imageUrl = null;
      }

      if (entry.canvasJSON?.backgroundImage && isBlobUrl(entry.canvasJSON.backgroundImage.src)) {
        entry.canvasJSON.backgroundImage.src = '';
      }

      // Ensure backgroundImage src isn't blank when canvasJSON exists
      if (entry.canvasJSON?.backgroundImage && !entry.canvasJSON.backgroundImage.src) {
        const source = entry.imageDataURL || entry.imageUrl || '';
        entry.canvasJSON.backgroundImage.src =
          typeof source === 'string' && source.startsWith('r2://') ? '' : source;
      }

      const liveMetadata = metadataManager
        ? {
            vectorStrokesByImage: this.collectScopedMetadataBuckets(
              metadataManager.vectorStrokesByImage,
              viewId
            ),
            strokeVisibilityByImage: this.collectScopedMetadataBuckets(
              metadataManager.strokeVisibilityByImage,
              viewId
            ),
            strokeLabelVisibility: this.collectScopedMetadataBuckets(
              metadataManager.strokeLabelVisibility,
              viewId
            ),
            strokeMeasurements: this.collectScopedMetadataBuckets(
              metadataManager.strokeMeasurements,
              viewId
            ),
          }
        : null;
      entry.metadata = {
        vectorStrokesByImage: this.mergeScopedBuckets(
          legacyEntry.metadata?.vectorStrokesByImage,
          view.metadata?.vectorStrokesByImage,
          liveMetadata?.vectorStrokesByImage
        ),
        strokeVisibilityByImage: this.mergeScopedBuckets(
          legacyEntry.metadata?.strokeVisibilityByImage,
          view.metadata?.strokeVisibilityByImage,
          liveMetadata?.strokeVisibilityByImage
        ),
        strokeLabelVisibility: this.mergeScopedBuckets(
          legacyEntry.metadata?.strokeLabelVisibility,
          view.metadata?.strokeLabelVisibility,
          liveMetadata?.strokeLabelVisibility
        ),
        strokeMeasurements: this.mergeScopedBuckets(
          legacyEntry.metadata?.strokeMeasurements,
          view.metadata?.strokeMeasurements,
          liveMetadata?.strokeMeasurements
        ),
      };

      const shouldUseLiveCurrentViewState = viewId === this.currentViewId && !isGuideSplitActive;
      entry.tabs = deepClone(
        shouldUseLiveCurrentViewState
          ? window.captureTabsByLabel?.[viewId] || view.tabs || legacyEntry.tabs
          : view.tabs || legacyEntry.tabs || window.captureTabsByLabel?.[viewId]
      );
      const serializedBackgroundWorldRect = this.inferBackgroundWorldRectFromSerializedBackground(
        entry.canvasJSON?.backgroundImage
      );
      if (viewId === this.currentViewId) {
        entry.backgroundWorldRect = deepClone(
          isGuideSplitActive
            ? view.backgroundWorldRect || serializedBackgroundWorldRect || null
            : this.canvasManager?.getBackgroundWorldRect?.() ||
                view.backgroundWorldRect ||
                serializedBackgroundWorldRect ||
                null
        );
      } else {
        entry.backgroundWorldRect = deepClone(
          view.backgroundWorldRect || serializedBackgroundWorldRect || null
        );
      }

      if (viewId === this.currentViewId) {
        const liveRotation = this.canvasManager?.getRotationDegrees?.();
        entry.rotation = Number.isFinite(liveRotation) ? liveRotation : Number(view.rotation) || 0;
        entry.backgroundRotation = Number(view.backgroundRotation) || 0;
      } else {
        entry.rotation = Number(view.rotation) || 0;
        entry.backgroundRotation = Number(view.backgroundRotation) || 0;
      }

      // Persist per-image viewport (zoom/pan) so framing is restored on load
      if (viewId === this.currentViewId) {
        entry.viewport = isGuideSplitActive
          ? view.viewport
            ? deepClone(view.viewport)
            : null
          : {
              ...this.canvasManager.getViewportState(),
              savedCanvasWidth: this.canvasManager.fabricCanvas?.width || 0,
              savedCanvasHeight: this.canvasManager.fabricCanvas?.height || 0,
            };
      } else if (view.viewport) {
        entry.viewport = deepClone(view.viewport);
      }

      const liveViewportTransform =
        viewId === this.currentViewId && !isGuideSplitActive
          ? this.canvasManager?.fabricCanvas?.viewportTransform
          : view.viewportTransform;
      if (
        Array.isArray(liveViewportTransform) &&
        liveViewportTransform.length >= 6 &&
        liveViewportTransform.slice(0, 6).every(value => Number.isFinite(Number(value)))
      ) {
        entry.viewportTransform = liveViewportTransform.slice(0, 6).map(Number);
      }

      // Persist backgroundWorldRect so the background image is placed at the
      // exact same world-space position on reload (even if window size changed)
      if (viewId === this.currentViewId && !isGuideSplitActive) {
        const liveWorldRect = this.canvasManager.getBackgroundWorldRect?.();
        if (liveWorldRect) {
          entry.backgroundWorldRect = JSON.parse(JSON.stringify(liveWorldRect));
        }
      } else if (view.backgroundWorldRect) {
        entry.backgroundWorldRect = deepClone(view.backgroundWorldRect);
      }

      viewEntries[viewId] = entry;
    });

    if (uploadImagesToR2 && imageUploadFailures.length > 0) {
      const failedViews = imageUploadFailures.map(failure => failure.viewId).join(', ');
      const error = new Error(
        `Cloud image upload failed for ${failedViews}. Project was not saved to avoid losing images.`
      );
      error.imageUploadFailures = imageUploadFailures;
      throw error;
    }

    for (const viewId of viewIds) {
      projectData.views[viewId] = viewEntries[viewId] || {};
    }

    // Serialize MOS overlays if manager exists
    if (window.app?.measurementOverlayManager) {
      projectData.mosOverlays = window.app.measurementOverlayManager.toJSON();
    }

    return projectData;
  }

  async saveProject() {
    const projectNameInput = document.getElementById('projectName');
    const projectName = projectNameInput?.value?.trim() || 'OpenPaint Project';
    const safeProjectName = sanitizeFilenamePart(projectName, 'OpenPaint Project');

    const outcome = {
      local: { status: 'not_attempted' },
      cloud: { attempted: false, status: 'not_attempted' },
      finalMessageKey: 'save.combined.fail',
      timestamp: new Date().toISOString(),
    };

    const startedAt = Date.now();
    let cloudPromise: Promise<any> | null = null;

    try {
      console.log('[Save] Starting saveProject');
      if (!this.canvasManager?.fabricCanvas) {
        outcome.local = { status: 'failed', error: 'Canvas not ready; cannot save.' };
        console.error('[Save] fabricCanvas missing');
        return;
      }

      const projectData = await this.getProjectData({ embedImages: false });

      const authManager = window.app?.authManager;
      const cloudManager = window.app?.cloudProjectManager;
      const user = authManager?.getUser ? authManager.getUser() : null;
      const localStart = Date.now();
      let cloudStart = 0;

      if (user && cloudManager?.saveProject) {
        outcome.cloud.attempted = true;
        cloudStart = Date.now();
        cloudPromise = cloudManager.saveProject(projectData);
      }

      await this.downloadProjectArchive(projectData, safeProjectName);
      outcome.local = {
        status: 'success',
        fileName: `${safeProjectName}.opaint`,
        durationMs: Date.now() - localStart,
      };

      if (cloudPromise) {
        const result = await cloudPromise;

        if (result?.status === 'ok') {
          outcome.cloud = {
            attempted: true,
            status: 'success',
            projectId: result?.data?.projectId,
            manifestVersion: result?.data?.manifestVersion,
            syncedViewIds: result?.data?.syncedViewIds,
            skippedViewIds: result?.data?.skippedViewIds,
            uploadedAssetHashes: result?.data?.uploadedAssetHashes,
            durationMs: Date.now() - cloudStart,
          };
        } else {
          const normalizedError = this.toNormalizedCloudError(result);
          outcome.cloud = {
            attempted: true,
            status: 'failed',
            durationMs: Date.now() - cloudStart,
            error: normalizedError,
          };
          console.error('[Save] Cloud save failed:', normalizedError);
          if (normalizedError?.requiresRelogin && authManager?.setSessionExpiredState) {
            authManager.setSessionExpiredState(normalizedError.userMessage);
          }
        }
      } else {
        outcome.cloud = {
          attempted: false,
          status: 'not_attempted',
          error: user
            ? undefined
            : {
                category: 'auth_invalid',
                message: 'User not logged in',
                userMessage: CLOUD_COPY.save.cloudSkippedLoggedOut,
                retryable: false,
                requiresRelogin: true,
              },
        };
      }
    } catch (error) {
      console.error('[Save] Failed to save project:', error);
      outcome.local = {
        status: 'failed',
        error: error?.message || 'Failed to save project',
        durationMs: Date.now() - startedAt,
      };
      if (cloudPromise) {
        try {
          const cloudResult = await cloudPromise;
          if (cloudResult?.status === 'ok') {
            outcome.cloud = {
              attempted: true,
              status: 'success',
              projectId: cloudResult?.data?.projectId,
              manifestVersion: cloudResult?.data?.manifestVersion,
              syncedViewIds: cloudResult?.data?.syncedViewIds,
              skippedViewIds: cloudResult?.data?.skippedViewIds,
              uploadedAssetHashes: cloudResult?.data?.uploadedAssetHashes,
              durationMs: Date.now() - startedAt,
            };
          } else {
            outcome.cloud = {
              attempted: true,
              status: 'failed',
              durationMs: Date.now() - startedAt,
              error: this.toNormalizedCloudError(cloudResult),
            };
          }
        } catch {
          outcome.cloud = {
            attempted: true,
            status: 'failed',
            durationMs: Date.now() - startedAt,
          };
        }
      } else {
        outcome.cloud = {
          attempted: false,
          status: 'not_attempted',
        };
      }
    } finally {
      outcome.finalMessageKey = decideFinalSaveMessageKey(outcome);
      this.renderSaveOutcome(outcome);
      console.log('[SaveOutcome]', {
        localSaved: outcome.local.status === 'success',
        cloudAttempted: outcome.cloud.attempted,
        cloudSaved: outcome.cloud.status === 'success',
        cloudErrorCategory: outcome.cloud.error?.category,
        cloudStatusCode: outcome.cloud.error?.statusCode,
        finalMessageKey: outcome.finalMessageKey,
        durationMs: Date.now() - startedAt,
      });
    }
  }

  async fetchImageAsDataURL(url) {
    const TIMEOUT_MS = 10000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      const blob = await response.blob();
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async uploadViewImageToR2(viewId, source) {
    if (!source) return null;

    let blob;
    if (typeof source === 'string') {
      if (source.startsWith('r2://')) return source.slice(5);
      if (source.startsWith('http://') || source.startsWith('https://')) return source;

      try {
        const fetchResponse = await fetch(source);
        if (!fetchResponse.ok) {
          throw new Error(`Image fetch failed for ${viewId}: ${fetchResponse.status}`);
        }
        blob = await fetchResponse.blob();
      } catch (error) {
        // Safari can retain a decoded image after its blob URL has stopped
        // being fetchable. Re-encode that live image so the current session
        // remains cloud-saveable rather than silently losing every photo.
        blob = await this.recoverRenderedImageBlob(viewId);
        if (!blob) {
          const reason = error instanceof Error ? error.message : String(error);
          throw new Error(`Image source is no longer available for ${viewId}: ${reason}`);
        }
        console.warn('[Save] Recovered image bytes from rendered image after source fetch failed', {
          viewId,
        });
      }
    } else if (typeof Blob !== 'undefined' && source instanceof Blob) {
      blob = source;
    } else {
      throw new Error(`No uploadable image source available for ${viewId}`);
    }

    // Detect actual image type from magic bytes if blob.type is missing/wrong
    const contentType = await this.detectImageMimeType(blob);
    if (contentType && contentType !== blob.type) {
      blob = new Blob([blob], { type: contentType });
    }

    const ext = this.inferImageExtension(blob, viewId);
    const safeViewId = sanitizeFilenamePart(viewId, 'view');
    const objectKey = `projects/views/${safeViewId}/${Date.now()}.${ext}`;

    const contentTypeHeader = blob.type || 'image/png';
    const cacheControl = 'public, max-age=31536000, immutable';
    const uploadViaLocalProxy = async () => {
      const proxyResponse = await fetch(
        `/api/storage/r2/upload?key=${encodeURIComponent(objectKey)}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': contentTypeHeader,
            'Cache-Control': cacheControl,
          },
          body: blob,
        }
      );
      const proxyBody = await proxyResponse.json().catch(() => ({}));
      if (!proxyResponse.ok || !proxyBody?.success) {
        throw new Error(
          proxyBody?.message || `R2 local upload failed (${proxyResponse.status}) for ${viewId}`
        );
      }
      return proxyBody.key || objectKey;
    };
    const isLocalDevHost =
      typeof window !== 'undefined' &&
      ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
    const presignResponse = await fetch('/api/storage/r2/presign-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: objectKey,
        contentType: contentTypeHeader,
        cacheControl,
        expiresIn: 600,
      }),
    });

    const presignBody = await presignResponse.json().catch(() => ({}));
    if (!presignResponse.ok || !presignBody?.success || !presignBody?.uploadUrl) {
      throw new Error(
        presignBody?.message || `R2 presign failed (${presignResponse.status}) for ${viewId}`
      );
    }

    try {
      const uploadResponse = await fetch(presignBody.uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': contentTypeHeader,
          'Cache-Control': cacheControl,
        },
        body: blob,
      });

      if (!uploadResponse.ok) {
        const uploadText = await uploadResponse.text().catch(() => '');
        if (isLocalDevHost) {
          console.warn('[Save] Direct R2 upload failed locally; retrying through API proxy', {
            viewId,
            status: uploadResponse.status,
          });
          return await uploadViaLocalProxy();
        }
        throw new Error(uploadText || `R2 upload failed (${uploadResponse.status})`);
      }
    } catch (error) {
      if (isLocalDevHost) {
        console.warn('[Save] Direct R2 upload errored locally; retrying through API proxy', {
          viewId,
          error: error instanceof Error ? error.message : String(error),
        });
        return await uploadViaLocalProxy();
      }
      throw error;
    }

    return presignBody.key || objectKey;
  }

  async recoverRenderedImageBlob(viewId) {
    if (typeof document === 'undefined') return null;

    const escapeViewId =
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(viewId)
        : String(viewId).replace(/"/g, '\\"');
    const liveBackground =
      viewId === this.currentViewId
        ? this.canvasManager?.fabricCanvas?.backgroundImage?._element || null
        : null;
    const thumbnailImage = document.querySelector(
      `.image-container[data-label="${escapeViewId}"] img`
    );
    const candidates = [liveBackground, thumbnailImage].filter(Boolean);

    for (const image of candidates) {
      const width = Number(image.naturalWidth || image.videoWidth || image.width);
      const height = Number(image.naturalHeight || image.videoHeight || image.height);
      if (!(width > 0 && height > 0)) continue;

      try {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) continue;
        context.drawImage(image, 0, 0, width, height);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (blob) return blob;
      } catch (error) {
        // Cross-origin images can be intentionally unreadable. Try the next
        // rendered candidate before reporting that the source has expired.
        console.warn('[Save] Could not recover image bytes from rendered candidate', {
          viewId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return null;
  }

  registerViewImageFile(viewId, file) {
    if (!viewId || typeof Blob === 'undefined' || !(file instanceof Blob)) return;
    this.viewImageFiles.set(viewId, file);
  }

  extractR2ObjectKeyFromUrl(sourceUrl) {
    const raw = String(sourceUrl || '').trim();
    if (!raw) return null;
    if (raw.startsWith('r2://')) {
      return raw.slice(5) || null;
    }

    try {
      const parsed = new URL(
        raw,
        typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
      );
      const pathname = parsed.pathname || '';
      if (!pathname.includes('/api/storage/r2/object')) {
        return null;
      }
      const key = parsed.searchParams.get('key');
      return key ? key.trim() : null;
    } catch {
      return null;
    }
  }

  async resolveR2ImageUrl(r2Path) {
    const objectKey = this.extractR2ObjectKeyFromUrl(r2Path);
    if (!objectKey) return null;

    if (this.remoteImageObjectUrlCache.has(objectKey)) {
      return this.remoteImageObjectUrlCache.get(objectKey);
    }

    const proxyUrl = `/api/storage/r2/object?key=${encodeURIComponent(objectKey)}`;
    try {
      const response = await fetch(proxyUrl, { cache: 'no-store' });
      if (!response.ok) {
        console.warn('[Load] Failed to fetch R2 image proxy', {
          objectKey,
          status: response.status,
        });
        return null;
      }
      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      const blob = await response.blob();
      if (blob.size === 0) {
        console.warn('[Load] R2 image blob is empty!', { objectKey });
        return null;
      }
      const headerImageType =
        contentType.startsWith('image/') || contentType.includes('svg')
          ? contentType.split(';')[0]
          : '';
      const detectedImageType = await this.detectImageMimeType(blob, { allowDefault: false });
      const imageContentType = headerImageType || detectedImageType;
      if (!imageContentType) {
        console.warn('[Load] R2 proxy returned non-image content', {
          objectKey,
          contentType: contentType || 'unknown',
        });
        return null;
      }
      const imageBlob =
        blob.type === imageContentType ? blob : new Blob([blob], { type: imageContentType });
      const objectUrl = URL.createObjectURL(imageBlob);
      this.remoteImageObjectUrlCache.set(objectKey, objectUrl);
      this.remoteImageObjectKeyByUrl.set(objectUrl, objectKey);
      this.loadedProjectObjectUrls.push(objectUrl);
      return objectUrl;
    } catch (error) {
      console.warn('[Load] Failed to blob-cache R2 image URL', error);
      return null;
    }
  }

  async detectImageMimeType(
    blob: Blob,
    options: { allowDefault?: boolean } = {}
  ): Promise<string | null> {
    try {
      const header = new Uint8Array(await blob.slice(0, 512).arrayBuffer());
      // PNG: 89 50 4E 47
      if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47) {
        return 'image/png';
      }
      // JPEG: FF D8 FF
      if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
        return 'image/jpeg';
      }
      // WebP: RIFF....WEBP
      if (
        header[0] === 0x52 &&
        header[1] === 0x49 &&
        header[2] === 0x46 &&
        header[3] === 0x46 &&
        header[8] === 0x57 &&
        header[9] === 0x45 &&
        header[10] === 0x42 &&
        header[11] === 0x50
      ) {
        return 'image/webp';
      }
      // GIF: GIF87a or GIF89a
      if (header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46) {
        return 'image/gif';
      }
      // BMP: BM
      if (header[0] === 0x42 && header[1] === 0x4d) {
        return 'image/bmp';
      }
      const textHeader = new TextDecoder().decode(header).trimStart().toLowerCase();
      if (textHeader.startsWith('<svg') || textHeader.includes('<svg')) {
        return 'image/svg+xml';
      }
    } catch {
      // ignore
    }
    // If blob.type is already an image type, trust it
    if (blob.type && blob.type.startsWith('image/')) {
      return blob.type;
    }
    return options.allowDefault === false ? null : 'image/png';
  }

  revokeLoadedProjectObjectUrls(): void {
    (this.loadedProjectObjectUrls || []).forEach(url => {
      try {
        URL.revokeObjectURL(url);
      } catch (error) {
        console.warn('[Load] Failed to revoke object URL', error);
      }
    });
    this.loadedProjectObjectUrls = [];
    this.remoteImageObjectUrlCache.clear();
    this.remoteImageObjectKeyByUrl.clear();
    this.activeArchiveZip = null;
  }

  inferImageExtension(blob, fallbackName = 'png') {
    const mime = blob?.type || '';
    if (mime.includes('png')) return 'png';
    if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
    if (mime.includes('webp')) return 'webp';
    if (mime.includes('gif')) return 'gif';
    if (mime.includes('bmp')) return 'bmp';
    if (mime.includes('svg')) return 'svg';

    const lower = (fallbackName || '').toLowerCase();
    const dotIndex = lower.lastIndexOf('.');
    if (dotIndex > -1 && dotIndex < lower.length - 1) {
      return lower.slice(dotIndex + 1);
    }
    return 'png';
  }

  async downloadProjectArchive(projectData, fileNameBase) {
    const zip = new JSZip();
    const manifest = JSON.parse(JSON.stringify(projectData || {}));
    manifest.archiveFormat = 'openpaint-zip-v1';

    const viewIds = Object.keys(manifest.views || {});
    for (const viewId of viewIds) {
      const viewEntry = manifest.views[viewId] || {};
      const liveView = this.views?.[viewId] || {};
      const sourceUrl = liveView.image || viewEntry.imageDataURL || viewEntry.imageUrl;
      if (!sourceUrl) continue;

      try {
        const response = await fetch(sourceUrl);
        const blob = await response.blob();
        const extension = this.inferImageExtension(blob, sourceUrl);
        const safeViewId = sanitizeFilenamePart(viewId, 'view');
        const imagePath = `images/${safeViewId}.${extension}`;
        zip.file(imagePath, blob);

        viewEntry.imageAssetPath = imagePath;
        viewEntry.imageDataURL = null;
        viewEntry.imageUrl = imagePath;
      } catch (error) {
        console.warn(`[Save] Failed to bundle image for ${viewId}:`, error);
      }
    }

    zip.file('project.json', JSON.stringify(manifest, null, 2));

    const blob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    const fileName = `${fileNameBase || 'OpenPaint Project'}.opaint`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    console.log('[Save] Downloaded project archive as:', fileName);
  }

  isArchiveProjectFile(file) {
    const name = String(file?.name || '').toLowerCase();
    return name.endsWith('.opaint') || name.endsWith('.zip');
  }

  async parseProjectArchive(file) {
    const zip = await JSZip.loadAsync(file);
    const manifestFile = zip.file('project.json') || zip.file('manifest.json');
    if (!manifestFile) {
      throw new Error('Archive is missing project.json');
    }

    const manifestText = await manifestFile.async('string');
    const parsed = JSON.parse(manifestText);
    const projectData = this.isLegacyFlatProjectData(parsed)
      ? this.upgradeLegacyProjectData(parsed)
      : parsed;
    this.activeArchiveZip = zip;

    return projectData;
  }

  async resolveArchiveImageUrl(imagePath) {
    if (!imagePath || typeof imagePath !== 'string') return null;
    if (!imagePath.startsWith('images/')) return imagePath;
    if (!this.activeArchiveZip) return null;

    const imageFile = this.activeArchiveZip.file(imagePath);
    if (!imageFile) return null;

    const blob = await imageFile.async('blob');
    const objectUrl = URL.createObjectURL(blob);
    this.loadedProjectObjectUrls.push(objectUrl);
    return objectUrl;
  }

  async resolveViewImageUrl(viewData) {
    if (!viewData) return null;
    if (viewData.imageDataURL) return viewData.imageDataURL;

    const cloudManager = window.app?.cloudProjectManager;
    const cloudProjectId =
      typeof cloudManager?.getActiveProjectId === 'function'
        ? cloudManager.getActiveProjectId()
        : undefined;

    const legacyBackgroundSrc =
      viewData?.canvasJSON?.backgroundImage &&
      typeof viewData.canvasJSON.backgroundImage.src === 'string'
        ? viewData.canvasJSON.backgroundImage.src
        : '';
    const legacyR2Key = this.extractR2ObjectKeyFromUrl(legacyBackgroundSrc);
    if (legacyR2Key) {
      return await this.resolveR2ImageUrl(`r2://${legacyR2Key}`);
    }
    if (legacyBackgroundSrc && !legacyBackgroundSrc.startsWith('blob:')) {
      return legacyBackgroundSrc;
    }

    if (typeof viewData.imageUrl === 'string' && viewData.imageUrl.startsWith('blob:')) {
      if (
        viewData.imageAssetHash &&
        typeof cloudManager?.resolveCloudAssetToObjectUrl === 'function'
      ) {
        const objectUrl = await cloudManager.resolveCloudAssetToObjectUrl(
          viewData.imageAssetHash,
          cloudProjectId
        );
        if (objectUrl && !this.loadedProjectObjectUrls.includes(objectUrl)) {
          this.loadedProjectObjectUrls.push(objectUrl);
        }
        return objectUrl || viewData.imageUrl;
      }
      return viewData.imageUrl;
    }

    const imageUrlR2Key = this.extractR2ObjectKeyFromUrl(viewData.imageUrl);
    if (imageUrlR2Key) {
      return await this.resolveR2ImageUrl(`r2://${imageUrlR2Key}`);
    }

    if (typeof viewData.imageUrl === 'string' && viewData.imageUrl.startsWith('cloud-asset://')) {
      const hash = String(viewData.imageUrl).replace('cloud-asset://', '').trim();
      if (hash && typeof cloudManager?.resolveCloudAssetToObjectUrl === 'function') {
        const objectUrl = await cloudManager.resolveCloudAssetToObjectUrl(hash, cloudProjectId);
        if (objectUrl && !this.loadedProjectObjectUrls.includes(objectUrl)) {
          this.loadedProjectObjectUrls.push(objectUrl);
        }
        return objectUrl || null;
      }
      return null;
    }

    if (
      viewData.imageAssetHash &&
      typeof cloudManager?.resolveCloudAssetToObjectUrl === 'function'
    ) {
      const objectUrl = await cloudManager.resolveCloudAssetToObjectUrl(
        viewData.imageAssetHash,
        cloudProjectId
      );
      if (objectUrl && !this.loadedProjectObjectUrls.includes(objectUrl)) {
        this.loadedProjectObjectUrls.push(objectUrl);
      }
      if (objectUrl) return objectUrl;
    }

    const archivePath = viewData.imageAssetPath || viewData.imageUrl;
    if (archivePath && typeof archivePath === 'string' && archivePath.startsWith('images/')) {
      return await this.resolveArchiveImageUrl(archivePath);
    }

    return viewData.imageUrl || null;
  }

  async downloadProjectData(projectData, fileName) {
    const jsonStr = JSON.stringify(projectData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName || 'project_fabric.json';
    a.click();
    URL.revokeObjectURL(url);
    console.log('[Save] Downloaded project as:', fileName);
  }

  async loadProjectFromData(projectData) {
    try {
      const normalizedProjectData = this.isLegacyFlatProjectData(projectData)
        ? this.upgradeLegacyProjectData(projectData)
        : projectData;
      console.log(
        '[Load] Loading project from data:',
        normalizedProjectData.projectName || normalizedProjectData.name
      );

      this.showStatusMessage('Loading cloud project...', 'info');
      this.showProjectLoadOverlay('Loading cloud project...');
      this.revokeLoadedProjectObjectUrls();

      await this._restoreFromProjectData(normalizedProjectData);
    } catch (error) {
      console.error('[Load] Failed to load project from data:', error);
      this.showStatusMessage('Failed to load project: ' + error.message, 'error');
      window.__isLoadingProject = false;
      window.__suspendSaveCurrentView = false;
      this.isLoadingProject = false;
      this.suspendSave = false;
      this.hideProjectLoadOverlay();
    }
  }

  async loadProject(file) {
    try {
      console.log('[Load] Loading project file:', file.name);

      this.showStatusMessage('Reading project file', 'info');
      this.showProjectLoadOverlay('Reading project file...');
      this.revokeLoadedProjectObjectUrls();

      if (!this.isArchiveProjectFile(file)) {
        throw new Error('Unsupported project format. Please load a .opaint project archive.');
      }
      const projectData = await this.parseProjectArchive(file);

      console.log('[Load] Parsed project data:', projectData.projectName || projectData.name);

      await this._restoreFromProjectData(projectData);
    } catch (error) {
      console.error('[Load] Failed to load project:', error);
      this.showStatusMessage('Failed to load project: ' + error.message, 'error');
      window.__isLoadingProject = false;
      window.__suspendSaveCurrentView = false;
      this.isLoadingProject = false;
      this.suspendSave = false;
      this.hideProjectLoadOverlay();
    }
  }

  async _restoreFromProjectData(projectData) {
    try {
      // Mark project load in progress to prevent auto-switches and saves
      window.__isLoadingProject = true;
      window.__suspendSaveCurrentView = true;
      this.isLoadingProject = true;
      this.suspendSave = true;
      this.pendingSwitchViewId = null;

      // Prevent scroll-select auto-switching during load without toggling UI state
      window.__suppressScrollSelectUntil = Date.now() + 300000;

      if (!projectData.version || !projectData.version.startsWith('2.0')) {
        this.showStatusMessage(
          'Unsupported archive version. Please load a project saved by this app (.opaint).',
          'error'
        );
        console.error('[Load] Unsupported project version:', projectData.version);
        return;
      }

      if (!projectData.views) {
        this.showStatusMessage('Invalid .opaint file: missing views', 'error');
        return;
      }

      // Update project name
      const projectNameInput = document.getElementById('projectName');
      if (projectNameInput && projectData.projectName) {
        projectNameInput.value = projectData.projectName;
      }

      this.projectMetadata = normalizeSofaMetadata(projectData.metadata);
      window.projectMetadata = this.getProjectMetadata();
      window.app?.tagManager?.syncTagStyleConfigFromMetadata?.();
      window.app?.tagManager?.syncTagSizeFromMetadata?.();

      // Clear existing views and recreate from saved data
      this.views = {};
      this.viewImageFiles.clear();

      // Clear image gallery to prevent duplicate detection issues
      if (window.imageGallery?.clearGallery) {
        window.imageGallery.clearGallery();
        console.log('[Load] Cleared image gallery');
      }

      const legacyImageList = document.getElementById('imageList');
      if (legacyImageList) {
        legacyImageList.innerHTML = '';
        console.log('[Load] Cleared legacy image list');
      }
      window.orderedImageLabels = [];
      window.__initialGallerySyncDone = false;

      const useRegistry =
        typeof imageRegistry?.isEnabled === 'function' && imageRegistry.isEnabled();
      if (useRegistry) {
        await imageRegistry.whenReady();
        imageRegistry.reset();
      }

      // Load each view
      const viewIds = Object.keys(projectData.views);
      const preferredOrder = ['front', 'side', 'back', 'cushion', 'left', 'right'];
      const orderFromProject = Array.isArray(projectData.viewOrder)
        ? projectData.viewOrder
        : Array.isArray(projectData.imageLabels)
          ? projectData.imageLabels
          : [];
      let orderedViewIds = [];
      if (orderFromProject.length) {
        const filtered = orderFromProject.filter(id => viewIds.includes(id));
        const remaining = viewIds.filter(id => !filtered.includes(id));
        orderedViewIds = filtered.concat(remaining);
      } else {
        orderedViewIds = [...viewIds].sort((a, b) => {
          const aIndex = preferredOrder.indexOf(a);
          const bIndex = preferredOrder.indexOf(b);
          const aScore = aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex;
          const bScore = bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex;
          if (aScore !== bScore) return aScore - bScore;
          return a.localeCompare(b);
        });
      }

      console.log('[Load] Loading views:', orderedViewIds);
      const targetView = projectData.currentViewId || orderedViewIds[0] || null;
      const debugFirstViewState = stage => {
        if (!targetView || this.currentViewId !== targetView) return;
        const tabs = window.captureTabsByLabel?.[targetView] || null;
        const activeTab = tabs?.tabs?.find?.(tab => tab.id === tabs.activeTabId) || null;
        const viewport = this.canvasManager?.getViewportState?.() || null;
        const frame = activeTab?.captureFrame || null;
        const worldRect = frame?.worldRect || null;
        const bg = this.canvasManager?.fabricCanvas?.backgroundImage;
        console.log('[Load][FirstView]', {
          stage,
          targetView,
          activeTabId: tabs?.activeTabId || null,
          zoom: viewport?.zoom,
          panX: viewport?.panX,
          panY: viewport?.panY,
          frameLeft: frame?.left,
          frameTop: frame?.top,
          frameWidth: frame?.width,
          frameHeight: frame?.height,
          worldLeft: worldRect?.left,
          worldTop: worldRect?.top,
          worldWidth: worldRect?.width,
          worldHeight: worldRect?.height,
          hasBackgroundImage: Boolean(bg),
        });
      };
      const deferredImageRegistrations = [];
      this.isHydratingDeferredViews = true;
      this.hydrationPinnedViewId = targetView;
      window.__deferredImageHydrationInProgress = true;

      const registerImageForView = async (viewId, imageUrl) => {
        if (!imageUrl) return;
        const filename = `${projectData.projectName || 'Project'} - ${viewId}`;
        if (useRegistry) {
          await imageRegistry.registerImage(viewId, imageUrl, filename, {
            source: this.activeArchiveZip ? 'archive' : 'json',
            refreshBackground: false,
          });
        } else if (window.addImageToSidebar) {
          console.log(`[Load] Registering view ${viewId} with legacy system`);
          window.addImageToSidebar(imageUrl, viewId, filename);
        }
      };

      for (const viewId of orderedViewIds) {
        this.updateProjectLoadOverlay(`Restoring view ${viewId}...`);
        const viewData = projectData.views[viewId];
        const savedTabs = Array.isArray(viewData?.tabs?.tabs) ? viewData.tabs.tabs : [];
        const savedActiveTab =
          savedTabs.find(tab => tab?.id === viewData?.tabs?.activeTabId) ||
          savedTabs.find(tab => tab?.type !== 'master') ||
          savedTabs[0] ||
          null;
        const inferredBackgroundWorldRect = this.inferBackgroundWorldRectFromSerializedBackground(
          viewData?.canvasJSON?.backgroundImage
        );
        const savedBackgroundWorldRect = viewData.backgroundWorldRect || null;
        const savedAspect =
          Number(savedBackgroundWorldRect?.width) > 0 &&
          Number(savedBackgroundWorldRect?.height) > 0
            ? Number(savedBackgroundWorldRect.width) / Number(savedBackgroundWorldRect.height)
            : 0;
        const inferredAspect =
          Number(inferredBackgroundWorldRect?.width) > 0 &&
          Number(inferredBackgroundWorldRect?.height) > 0
            ? inferredBackgroundWorldRect.width / inferredBackgroundWorldRect.height
            : 0;
        const savedRectHasImpossibleRotationAspect =
          savedAspect > 0 &&
          inferredAspect > 0 &&
          Math.abs(savedAspect - inferredAspect) / inferredAspect > 0.015;
        const restoredBackgroundWorldRect = savedRectHasImpossibleRotationAspect
          ? inferredBackgroundWorldRect
          : savedBackgroundWorldRect || inferredBackgroundWorldRect;
        if (savedRectHasImpossibleRotationAspect) {
          console.warn('[Load] Repaired rotated background geometry', {
            viewId,
            savedBackgroundWorldRect,
            inferredBackgroundWorldRect,
          });
        }

        this.views[viewId] = {
          id: viewId,
          image: null,
          imageR2Key: this.getR2ObjectKeyForViewData(viewData),
          imageAssetHash: viewData.imageAssetHash || null,
          imageContentType: viewData.imageContentType || null,
          imageSourceFingerprint: viewData.imageSourceFingerprint || null,
          rotation: Number(viewData.rotation) || 0,
          backgroundRotation: Number(viewData.backgroundRotation) || 0,
          fitMode: typeof viewData.fitMode === 'string' ? viewData.fitMode : 'scale-page-size',
          canvasData: viewData.canvasJSON,
          metadata: viewData.metadata || {},
          tabs: viewData.tabs || null,
          viewport: viewData.viewport || null,
          viewportTransform:
            (Array.isArray(viewData.viewportTransform) && viewData.viewportTransform) ||
            (Array.isArray(viewData.canvasJSON?.viewportTransform) &&
              viewData.canvasJSON.viewportTransform) ||
            null,
          // Keep the source geometry attached to the exact Fabric matrix.
          // Live tab and viewport records are intentionally rewritten during
          // cross-monitor restoration; using those mutable values later can
          // make an old matrix appear compatible and reintroduce stale pan.
          exactViewportSourceDimensions: {
            canvasWidth: Number(viewData.viewport?.savedCanvasWidth) || 0,
            canvasHeight: Number(viewData.viewport?.savedCanvasHeight) || 0,
            windowWidth: Number(savedActiveTab?.captureFrame?.windowWidth) || 0,
            windowHeight: Number(savedActiveTab?.captureFrame?.windowHeight) || 0,
          },
          backgroundWorldRect: restoredBackgroundWorldRect || null,
        };

        const hasImageReference = Boolean(
          viewData.imageDataURL || viewData.imageAssetPath || viewData.imageUrl
        );
        if (hasImageReference) {
          deferredImageRegistrations.push({ viewId, viewData });
        }
      }

      if (window.setCaptureTabsForLabel) {
        orderedViewIds.forEach(viewId => {
          window.setCaptureTabsForLabel(viewId, projectData.views?.[viewId]?.tabs || null);
        });
      }

      // Keep the saved target pinned while images are registered in their
      // authored order. Image priority and gallery order are separate concerns.
      for (const item of deferredImageRegistrations) {
        const imageUrl = await this.resolveViewImageUrl(item.viewData);
        this.views[item.viewId].image = imageUrl;
        this.views[item.viewId].imageR2Key = this.getR2ObjectKeyForViewData(item.viewData);
        if (imageUrl) {
          console.log(`[Load] Restored image for view ${item.viewId}`);
        }
        await registerImageForView(item.viewId, imageUrl);
      }

      deferredImageRegistrations.length = 0;

      // Switch to the saved current view or first view
      if (targetView && this.views[targetView]) {
        console.log(`[Load] Switching to view: ${targetView}`);
        await this.switchView(targetView, true);
        debugFirstViewState('after-switchView');
        if (window.renderCaptureTabUI) {
          window.renderCaptureTabUI(targetView);
        }
        if (window.syncCaptureTabCanvasVisibility) {
          window.syncCaptureTabCanvasVisibility(targetView);
        }

        requestAnimationFrame(() => {
          requestAnimationFrame(async () => {
            if (this.canvasManager?.resize) {
              this.canvasManager.resize();
            }
            const current = this.views[targetView];

            if (window.applyCaptureFrameForLabel) {
              window.applyCaptureFrameForLabel(targetView);
            }

            // Re-apply the first view background after resize/frame restoration.
            // On initial project load the first background can be placed using
            // stale pre-layout frame geometry, which leaves the image offset
            // even though the correct frame is applied a moment later.
            if (current?.image && this.currentViewId === targetView) {
              await this.reconcileBackgroundPlacementForView(targetView, {
                waitForLayout: false,
              });
            }

            this.canvasManager?.fabricCanvas?.requestRenderAll?.();
            debugFirstViewState('after-stabilize-pass');
          });
        });

        const lateRefresh = () => {
          const current = this.views[targetView];
          if (!current?.image || this.currentViewId !== targetView) return;
          this.reconcileBackgroundPlacementForView(targetView, {
            waitForLayout: false,
          }).then(() => {
            if (window.applyCaptureFrameForLabel) {
              window.applyCaptureFrameForLabel(targetView);
            }
            debugFirstViewState('late-refresh');
          });
        };
        setTimeout(lateRefresh, 450);

        // Align gallery selection/scroll to the current view without switching views
        const syncGalleryToView = attempt => {
          if (!window.imageGallery?.syncToLabel) return;
          const ok = window.imageGallery.syncToLabel(targetView, { scroll: true, smooth: false });
          if (!ok && attempt < 5) {
            setTimeout(() => syncGalleryToView(attempt + 1), 150);
          }
        };
        setTimeout(() => syncGalleryToView(0), 100);
        setTimeout(() => this.syncLegacyImageListSelection(targetView, { scroll: true }), 120);
      }

      const reconcileInitialTargetViewLayout = async stage => {
        if (!targetView || this.currentViewId !== targetView) return;
        const current = this.views[targetView];
        if (!current?.image) return;

        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

        if (window.applyCaptureFrameForLabel) {
          window.applyCaptureFrameForLabel(targetView);
        }

        await new Promise(resolve => setTimeout(resolve, 0));
        await this.reconcileBackgroundPlacementForView(targetView, {
          waitForLayout: false,
        });
        debugFirstViewState(stage);
      };

      await reconcileInitialTargetViewLayout('before-complete-reconcile');

      // Restore MOS overlays if present
      if (projectData.mosOverlays && window.app?.measurementOverlayManager) {
        try {
          await window.app.measurementOverlayManager.fromJSON(projectData.mosOverlays);
          console.log('[Load] MOS overlays restored');
        } catch (mosErr) {
          console.warn('[Load] Failed to restore MOS overlays:', mosErr);
        }
      }

      this.showStatusMessage('Project loaded successfully', 'success');
      console.log('[Load] Project load complete');
      window.dispatchEvent(new Event('openpaint:project-loaded'));

      // Re-enable interactions once deferred hydration is complete.
      window.__isLoadingProject = false;
      window.__suspendSaveCurrentView = false;
      this.isLoadingProject = false;
      this.suspendSave = false;
      this.isHydratingDeferredViews = false;
      this.hydrationPinnedViewId = null;
      this.hideProjectLoadOverlay();

      window.__deferredImageHydrationInProgress = false;
      const postLoadSuppressUntil = Date.now() + 1200;
      // Replace the long hydration sentinel. Keeping the maximum here leaves
      // scroll-select disabled for five minutes after a successful load.
      window.__suppressScrollSelectUntil = postLoadSuppressUntil;
      window.__imageListProgrammaticScrollUntil = Math.max(
        Number(window.__imageListProgrammaticScrollUntil) || 0,
        postLoadSuppressUntil
      );

      if (this.pendingSwitchViewId && this.pendingSwitchViewId !== this.currentViewId) {
        if (!window.__deferredImageHydrationInProgress) {
          const nextView = this.pendingSwitchViewId;
          this.pendingSwitchViewId = null;
          await this.switchView(nextView, true);
        }
      }
    } catch (error) {
      console.error('[Load] Failed to load project:', error);
      this.showStatusMessage('Failed to load project: ' + error.message, 'error');
      window.__isLoadingProject = false;
      window.__suspendSaveCurrentView = false;
      this.isLoadingProject = false;
      this.suspendSave = false;
      this.isHydratingDeferredViews = false;
      this.hydrationPinnedViewId = null;
      window.__deferredImageHydrationInProgress = false;
      window.__suppressScrollSelectUntil = 0;
      this.hideProjectLoadOverlay();
    }
  }

  promptLoadProject() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.opaint,.zip';
    input.onchange = async e => {
      const file = e.target.files[0];
      if (file) {
        await this.loadProject(file);
      }
    };
    input.click();
  }
}
