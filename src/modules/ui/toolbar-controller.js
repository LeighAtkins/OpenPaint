// Toolbar controller and UI initialization
// Extracted from index.html inline scripts

export function initToolbarController() {
  const runWhenDomReady = callback => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', callback, { once: true });
      return;
    }
    callback();
  };

  // Initialize top toolbar - now works with pre-populated content
  function initializeTopToolbar() {
    const left = document.getElementById('tbLeft');
    const center = document.getElementById('tbCenter');
    const right = document.getElementById('tbRight');
    const bottom = document.getElementById('canvasControlsContent') || center;

    // Helper functions
    const setUniform = el => {
      if (!el) return;
      // Do not apply text-input styling to range sliders; it breaks their visuals
      if (el.tagName === 'INPUT' && el.type === 'range') return;
      el.classList.add(
        el.tagName === 'SELECT' ? 'tselect' : el.tagName === 'INPUT' ? 'tinput' : 'tbtn'
      );
    };

    const reparent = (id, target, beforeSetup) => {
      const el = document.getElementById(id);
      if (!el) return null;
      beforeSetup?.(el);
      target.appendChild(el);
      if (!el.dataset?.skipUniform) {
        setUniform(el);
      }
      return el;
    };

    // Since toolbar is now pre-populated, we just need to ensure proper styling
    // and wire up any missing functionality
    const ensureUniformStyling = () => {
      const buttons = left.querySelectorAll('button, input, select');
      buttons.forEach(setUniform);
    };

    ensureUniformStyling();

    // Color swatches are now pre-populated, just need to wire up functionality
    const colorButtons = left.querySelectorAll('[data-color]');
    colorButtons.forEach(button => {
      if (!button.__boundColor) {
        button.__boundColor = true;
        button.addEventListener('click', () => {
          document
            .querySelectorAll('[data-color].active')
            .forEach(b => b.classList.remove('active'));
          button.classList.add('active');
          const hex = button.getAttribute('data-color');
          const cp = document.getElementById('colorPicker');
          if (cp && hex) {
            cp.value = hex;
            cp.dispatchEvent(new Event('change'));
          }
          const bs = document.getElementById('brushSize');
          if (bs && hex) bs.style.setProperty('--accent', hex);
        });
      }
    });

    // Hide the color picker since we're using swatches
    const colorInput = document.getElementById('colorPicker');
    if (colorInput) colorInput.classList.add('hidden');

    // Arrow and line style controls are now pre-populated, just need to wire up functionality
    const arrowStartBtn = document.getElementById('arrowStartBtn');
    const arrowEndBtn = document.getElementById('arrowEndBtn');
    const dottedBtn = document.getElementById('dottedBtn');

    const setLineStyleIcon = style => {
      if (!dottedBtn) return;
      const svgSolid =
        '<svg width="34" height="12" viewBox="0 0 34 12" aria-hidden="true"><line x1="2" y1="6" x2="32" y2="6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
      const svgSmall =
        '<svg width="34" height="12" viewBox="0 0 34 12" aria-hidden="true"><line x1="2" y1="6" x2="32" y2="6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="4 4"/></svg>';
      const svgMedium =
        '<svg width="34" height="12" viewBox="0 0 34 12" aria-hidden="true"><line x1="2" y1="6" x2="32" y2="6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="7 5"/></svg>';
      const svgLarge =
        '<svg width="34" height="12" viewBox="0 0 34 12" aria-hidden="true"><line x1="2" y1="6" x2="32" y2="6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="11 7"/></svg>';
      dottedBtn.innerHTML =
        style === 'small'
          ? svgSmall
          : style === 'medium'
            ? svgMedium
            : style === 'large'
              ? svgLarge
              : svgSolid;
    };
    setLineStyleIcon('solid');

    // Wire controls to UI state in paint.js
    const setActive = (el, on) => el.classList.toggle('active', !!on);
    const syncFromState = () => {
      try {
        const as = window.paintApp?.uiState?.arrowSettings;
        const ds = window.paintApp?.uiState?.dashSettings;
        setActive(arrowStartBtn, as?.startArrow);
        setActive(arrowEndBtn, as?.endArrow);
        setLineStyleIcon(ds?.style || 'solid');
        // Sync label shape toggle visual state
        const state = window.paintApp?.state || {};
        const shape = state.labelShape || 'square';
        // Note: shapeSquareBtn and shapeCircleBtn were removed, using single toggle button instead
      } catch {
        /* optional UI sync */
      }
    };
    syncFromState();

    arrowStartBtn.addEventListener('click', () => {
      try {
        const as = window.paintApp.uiState.arrowSettings;
        as.startArrow = !as.startArrow;
        // Apply to stroke in edit mode if any
        const edited = window.selectedStrokeInEditMode;
        const img = window.currentImageLabel;
        if (edited && img && window.vectorStrokesByImage?.[img]?.[edited]) {
          const v = window.vectorStrokesByImage[img][edited];
          v.arrowSettings = v.arrowSettings || {
            arrowSize: as.arrowSize,
            arrowStyle: as.arrowStyle,
            startArrow: false,
            endArrow: false,
          };
          v.arrowSettings.startArrow = as.startArrow;
          // Ensure curved lines switch type appropriately
          if (typeof window.updateStrokeTypeBasedOnArrows === 'function') {
            window.updateStrokeTypeBasedOnArrows(v);
          } else {
            const hasArrows = !!(v.arrowSettings.startArrow || v.arrowSettings.endArrow);
            if (v.type === 'curved' && hasArrows) v.type = 'curved-arrow';
            if (v.type === 'curved-arrow' && !hasArrows) v.type = 'curved';
          }
          window.saveState?.(true, false, false);
          window.redrawCanvasWithVisibility?.();
        }
        syncFromState();
      } catch {
        /* optional UI sync */
      }
    });
    arrowEndBtn.addEventListener('click', () => {
      try {
        const as = window.paintApp.uiState.arrowSettings;
        as.endArrow = !as.endArrow;
        // Apply to stroke in edit mode if any
        const edited = window.selectedStrokeInEditMode;
        const img = window.currentImageLabel;
        if (edited && img && window.vectorStrokesByImage?.[img]?.[edited]) {
          const v = window.vectorStrokesByImage[img][edited];
          v.arrowSettings = v.arrowSettings || {
            arrowSize: as.arrowSize,
            arrowStyle: as.arrowStyle,
            startArrow: false,
            endArrow: false,
          };
          v.arrowSettings.endArrow = as.endArrow;
          // Ensure curved lines switch type appropriately
          if (typeof window.updateStrokeTypeBasedOnArrows === 'function') {
            window.updateStrokeTypeBasedOnArrows(v);
          } else {
            const hasArrows = !!(v.arrowSettings.startArrow || v.arrowSettings.endArrow);
            if (v.type === 'curved' && hasArrows) v.type = 'curved-arrow';
            if (v.type === 'curved-arrow' && !hasArrows) v.type = 'curved';
          }
          window.saveState?.(true, false, false);
          window.redrawCanvasWithVisibility?.();
        }
        syncFromState();
      } catch {
        /* optional UI sync */
      }
    });
    dottedBtn.addEventListener('click', () => {
      try {
        const ds = window.paintApp.uiState.dashSettings;
        // Cycle: solid -> small -> medium -> large -> solid
        const next = { solid: 'small', small: 'medium', medium: 'large', large: 'solid' };
        ds.style = next[ds.style] || 'small';
        ds.enabled = ds.style !== 'solid';
        // Compute dash pattern immediately (mirror paint.js getDashPattern)
        const computePattern = (style, dashLen, gapLen, lineWidth = 1) => {
          const baseScale = Math.max(2, lineWidth * 0.8);
          switch (style) {
            case 'small':
              return [6 * baseScale, 4 * baseScale];
            case 'medium':
              return [12 * baseScale, 8 * baseScale];
            case 'large':
              return [20 * baseScale, 12 * baseScale];
            case 'dot-dash':
              return [4 * baseScale, 6 * baseScale, 12 * baseScale, 6 * baseScale];
            case 'custom':
              return [dashLen * baseScale, gapLen * baseScale];
            default:
              return [];
          }
        };
        const brush = document.getElementById('brushSize');
        const size = parseInt(brush?.value || '5') || 5;
        ds.pattern = computePattern(ds.style, ds.dashLength, ds.gapLength, size);
        // If editing a stroke, also update it live
        const edited = window.selectedStrokeInEditMode;
        const img = window.currentImageLabel;
        if (edited && img && window.vectorStrokesByImage?.[img]?.[edited]) {
          const v = window.vectorStrokesByImage[img][edited];
          const lw = parseInt(v.width || size) || size;
          v.dashSettings = {
            ...ds,
            pattern: computePattern(ds.style, ds.dashLength, ds.gapLength, lw),
          };
          window.saveState?.(true, false, false);
          window.redrawCanvasWithVisibility?.();
        }
        setLineStyleIcon(ds.style);
        syncFromState();
      } catch {
        /* optional UI sync */
      }
    });

    // Undo / Redo buttons
    // Undo/Redo buttons are now pre-populated, just need to wire up functionality
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');

    if (undoBtn) {
      undoBtn.addEventListener('click', () => {
        if (typeof window.undo === 'function') window.undo();
      });
    }

    if (redoBtn) {
      redoBtn.addEventListener('click', () => {
        if (typeof window.redo === 'function') window.redo();
      });
    }

    // CENTER/BOTTOM: canvas view controls moved to bottom
    reparent('fitModeSelect', bottom);
    reparent('rotateFineWrap', bottom);
    reparent('scaleButton', bottom);
    syncFromState();

    // RIGHT: project settings are now pre-populated, just need to wire up functionality
    const saveProjectTop = document.getElementById('saveProjectTop');
    const shareProjectBtn = document.getElementById('shareProjectBtn');
    const updateShareBtn = document.getElementById('updateShareBtn');

    // Save button is now handled by toolbar-init.js to avoid double save
    // if (saveProjectTop) {
    //   saveProjectTop.addEventListener('click', () => {
    //     if (window.projectManager?.saveProject) window.projectManager.saveProject();
    //   });
    // }

    if (shareProjectBtn) {
      shareProjectBtn.addEventListener('click', () => {
        if (window.shareProject) window.shareProject();
      });
    }

    if (updateShareBtn) {
      updateShareBtn.addEventListener('click', () => {
        if (window.updateSharedProject) window.updateSharedProject();
      });
    }

    // Unit toggle is handled by main.ts setupUnitToggle() — just hide the raw selector
    const unitSel = document.getElementById('unitSelector');
    if (unitSel) unitSel.style.display = 'none';

    // Elements panel single-button shape toggle wiring
    const labelShapeToggleBtn = document.getElementById('labelShapeToggleBtn');
    const applyShape = val => {
      if (window.paintApp?.state) window.paintApp.state.labelShape = val;
      if (window.redrawCanvasWithVisibility) window.redrawCanvasWithVisibility();
    };
    if (labelShapeToggleBtn) {
      const syncShapeBtn = () => {
        const shape = window.paintApp?.state?.labelShape || 'square';
        const isSquare = shape !== 'circle';
        labelShapeToggleBtn.textContent = isSquare ? '■' : '●';
        labelShapeToggleBtn.setAttribute('aria-pressed', String(isSquare));
      };
      labelShapeToggleBtn.addEventListener('click', () => {
        const shape = window.paintApp?.state?.labelShape || 'square';
        applyShape(shape === 'circle' ? 'square' : 'circle');
        syncShapeBtn();
      });
      syncShapeBtn();
    }

    // Label background style toggle button
    const labelBackgroundToggleBtn = document.getElementById('labelBackgroundToggleBtn');
    const backgroundStyles = ['solid', 'no-fill', 'clear-black', 'clear-color', 'clear-white'];
    const backgroundLabels = {
      solid: 'Solid',
      'no-fill': 'No Fill',
      'clear-black': 'Clear Black',
      'clear-color': 'Clear Color',
      'clear-white': 'Clear White',
    };

    if (labelBackgroundToggleBtn) {
      labelBackgroundToggleBtn.addEventListener('click', () => {
        console.log(
          '[TagBackground] Button clicked, app.tagManager available:',
          !!window.app?.tagManager
        );
        if (window.app?.tagManager) {
          const currentStyle = window.app.tagManager.tagBackgroundStyle || 'solid';
          console.log('[TagBackground] Current style:', currentStyle);
          const currentIndex = backgroundStyles.indexOf(currentStyle);
          const nextIndex = (currentIndex + 1) % backgroundStyles.length;
          const nextStyle = backgroundStyles[nextIndex];
          console.log('[TagBackground] Next style:', nextStyle);

          window.app.tagManager.setBackgroundStyle(nextStyle);
          labelBackgroundToggleBtn.textContent = backgroundLabels[nextStyle];
          labelBackgroundToggleBtn.setAttribute('aria-pressed', String(nextStyle !== 'solid'));
          console.log('[TagBackground] Updated to:', nextStyle);
        } else {
          console.warn('[TagBackground] Button clicked but tagManager not available');
        }
      });
    } else {
      console.warn('[TagBackground] Button element not found');
    }

    // Auto-update shared project when state saves (debounced)
    if (window.updateSharedProject && window.saveState && !window.__autoUpdateSharePatched) {
      window.__autoUpdateSharePatched = true;
      const originalSaveState = window.saveState;
      let updateTimer = null;
      window.saveState = function () {
        const result = originalSaveState.apply(this, arguments);
        clearTimeout(updateTimer);
        updateTimer = setTimeout(() => {
          try {
            window.updateSharedProject();
          } catch {
            /* optional UI sync */
          }
        }, 600);
        return result;
      };
    }

    // Hide legacy panels after moving controls (keep in DOM to preserve any lookups)
    document.getElementById('toolsPanel')?.classList.add('hidden');
    document.getElementById('projectPanel')?.classList.add('hidden');
    const cc = document.getElementById('canvasControls');
    if (cc) {
      cc.classList.remove('hidden');
      cc.style.display = 'block';
    }

    // Add body padding to prevent toolbar overlap
    document.body.style.paddingTop = '48px';
  }

  // Extracted helper function to check if container needs compact mode
  // NOTE: Toolbar containers are now handled by data-toolbar-mode attribute
  // This function only applies to non-toolbar smart-label-scope containers
  const compactStateCache = new Map(); // Track previous state to prevent thrashing

  function applyCompactLabels(container) {
    if (!container) return;

    // Skip toolbar containers - they're handled by data-toolbar-mode
    if (container.closest('#topToolbar')) {
      return;
    }

    // Check if we're on desktop - never add compact class on desktop
    const isMobile = window.innerWidth <= 768;

    // Skip smart labels on desktop - always show full labels
    if (!isMobile) {
      container.classList.remove('compact');
      return;
    }

    // Simpler, more reliable overflow detection with hysteresis
    const containerWidth = container.clientWidth;
    const containerScrollWidth = container.scrollWidth;

    // Add 2px threshold to prevent rapid toggling near the boundary
    const threshold = 2;
    const needsCompact = containerScrollWidth > containerWidth + threshold;
    const wasCompact = container.classList.contains('compact');
    const cachedState = compactStateCache.get(container);

    // Only toggle if state actually changed and difference is significant
    if (needsCompact !== wasCompact) {
      // Check if we're near the boundary - if so, keep current state to prevent thrashing
      const nearBoundary = Math.abs(containerScrollWidth - containerWidth) < threshold * 2;
      if (nearBoundary && cachedState === wasCompact) {
        // Near boundary and state hasn't changed - keep current state
        return;
      }

      // Update state
      if (needsCompact) {
        container.classList.add('compact');
      } else {
        container.classList.remove('compact');
      }
      compactStateCache.set(container, needsCompact);
    }
  }

  // Pre-calculate toolbar layout before making it visible
  // NOTE: Toolbar label sizing is now handled by data-toolbar-mode attribute
  // This function now only handles final layout stabilization
  function calculateInitialToolbarLayout() {
    const toolbarWrap = document.querySelector('.toolbar-wrap');
    if (!toolbarWrap) {
      return;
    }

    // Toolbar mode should already be set by the earlier script
    // Just ensure layout is stable

    // Force initial layout calculation to ensure all styles are applied
    void toolbarWrap.offsetWidth;

    // Final layout stabilization - force calculation on all toolbar elements
    const allButtons = toolbarWrap.querySelectorAll('button, input, select');
    allButtons.forEach(el => {
      void el.offsetWidth; // Force layout calculation
    });

    // One final layout calculation to ensure everything is stable
    void toolbarWrap.offsetWidth;

    // Toolbar-ready class should already be added (done earlier to prevent opacity transitions)
    // But ensure it's set here as well for consistency
    const topToolbar = document.getElementById('topToolbar');
    if (topToolbar && !topToolbar.classList.contains('toolbar-ready')) {
      topToolbar.classList.add('toolbar-ready');
    }
    if (!toolbarWrap.classList.contains('toolbar-ready')) {
      toolbarWrap.classList.add('toolbar-ready');
    }

    // After layout is stable, enable smooth transitions
    setTimeout(() => {
      if (topToolbar) {
        topToolbar.classList.add('toolbar-stable');
      }
      if (toolbarWrap) {
        toolbarWrap.classList.add('toolbar-stable');
      }
    }, 100);
  }

  // Smart label system for responsive button text
  function initSmartLabels(skipInitialCheck = false) {
    // Helper to wrap button with smart label spans
    function wrapSmartLabel(buttonEl, longText, shortText) {
      if (!buttonEl || buttonEl.querySelector('.label-long')) return; // Already wrapped

      buttonEl.innerHTML = `<span class="label-long">${longText}</span><span class="label-short">${shortText}</span>`;
      buttonEl.setAttribute('title', longText);
      buttonEl.setAttribute('aria-label', longText);
    }

    // Setup ResizeObserver for each smart-label-scope container
    const containers = document.querySelectorAll('.smart-label-scope');
    const observers = new Map();

    // Flag to prevent ResizeObserver from firing during initial setup
    let isInitializing = !skipInitialCheck;
    const initStartTime = Date.now();

    containers.forEach(container => {
      let debounceTimer = null;
      let lastWidth = 0;
      let lastHeight = 0;
      let isProcessing = false; // Prevent concurrent processing

      const debouncedApply = entries => {
        // Skip if we're still initializing or already processing
        if (isInitializing || isProcessing) return;

        // Check if enough time has passed since initialization started
        const timeSinceInit = Date.now() - initStartTime;
        if (timeSinceInit < 800) return; // Wait 800ms before allowing ResizeObserver to fire

        // Check if size actually changed significantly (prevent micro-adjustments)
        const entry = entries && entries[0];
        if (entry) {
          const { width, height } = entry.contentRect;
          const widthDiff = Math.abs(width - lastWidth);
          const heightDiff = Math.abs(height - lastHeight);

          // Only process if change is significant (more than 2px to prevent micro-adjustments)
          if (widthDiff < 2 && heightDiff < 2) {
            return;
          }

          lastWidth = width;
          lastHeight = height;
        }

        if (debounceTimer) clearTimeout(debounceTimer);
        isProcessing = true;
        debounceTimer = setTimeout(() => {
          applyCompactLabels(container);
          // Also check parent containers
          const parent = container.closest('.smart-label-scope');
          if (parent && parent !== container) {
            applyCompactLabels(parent);
          }
          isProcessing = false;
        }, 200); // Increased debounce time to prevent rapid toggling
      };

      // STEP 4: Performance guardrails - Don't observe toolbar containers
      // Toolbar sizing is handled by data-toolbar-mode attribute, not ResizeObserver
      // This prevents flicker loops and performance issues
      const isToolbarContainer = container.closest('#topToolbar') !== null;

      if (isToolbarContainer) {
        // Skip ResizeObserver for toolbar - data-toolbar-mode handles sizing
        return; // Don't observe toolbar containers at all
      }

      // For non-toolbar containers, set up ResizeObserver normally
      const observer = new ResizeObserver(debouncedApply);
      observer.observe(container);
      observers.set(container, observer);

      // Store initial dimensions
      const rect = container.getBoundingClientRect();
      lastWidth = rect.width;
      lastHeight = rect.height;

      // Initial check with immediate execution (skip if already calculated)
      if (!skipInitialCheck) {
        applyCompactLabels(container);
      }
    });

    // Clear initialization flag after a longer delay to ensure everything is stable
    if (isInitializing) {
      setTimeout(() => {
        isInitializing = false;
      }, 1000); // Increased to 1 second
    }

    // Setup buttons that get created dynamically by toolbar initialization
    setTimeout(() => {
      // Load Project button (created by reparent)
      const loadBtn = document.getElementById('loadProject');
      if (loadBtn) {
        wrapSmartLabel(loadBtn, 'Load Project', 'Load');
      }

      // Save Project button (created dynamically)
      const saveBtn = document.getElementById('saveProjectTop');
      if (saveBtn) {
        wrapSmartLabel(saveBtn, 'Save Project', 'Save');
        // Make it visually distinct from bottom save button
        saveBtn.style.background = '#3b82f6'; // Blue instead of green
        saveBtn.style.borderColor = '#2563eb';
        saveBtn.style.fontWeight = '700';
        saveBtn.style.fontSize = '14px';
        saveBtn.style.padding = '8px 16px';
      }

      // Immediate check for all containers (skip if already calculated)
      if (!skipInitialCheck) {
        containers.forEach(container => {
          applyCompactLabels(container);
        });

        // Additional check after a short delay to ensure everything is rendered
        setTimeout(() => {
          containers.forEach(container => {
            applyCompactLabels(container);
          });
        }, 100);
      }
    }, 150);

    // Global function to update drawing mode toggle labels
    // Note: Freehand mode has been removed - cycle is now: Straight Line -> Curved Line -> Select
    window.updateDrawingModeLabels = function (mode) {
      const toggle = document.getElementById('drawingModeToggle');
      if (!toggle) return;

      const longSpan = toggle.querySelector('.label-long');
      const shortSpan = toggle.querySelector('.label-short');

      let longText, shortText;
      if (mode === 'curved') {
        longText = 'Curved Line';
        shortText = 'Curved';
      } else if (mode === 'select') {
        longText = 'Select';
        shortText = 'Select';
      } else {
        // Default: Straight mode (false, 'straight', true, 'freehand' all map to Straight Line)
        longText = 'Straight Line';
        shortText = 'Straight';
      }

      if (longSpan) longSpan.textContent = longText;
      if (shortSpan) shortSpan.textContent = shortText;
      toggle.setAttribute('title', longText);
      toggle.setAttribute('aria-label', longText);

      // Re-check container after label change
      const container = toggle.closest('.smart-label-scope');
      if (container) applyCompactLabels(container);
    };

    // Store observers for cleanup if needed
    window.smartLabelObservers = observers;
  }

  // New UI functionality for modular panels and capture frame
  runWhenDomReady(() => {
    // 1. Initialize top toolbar structure first (so elements are in place)
    initializeTopToolbar();

    // 2. Toolbar-ready should already be added (done in inline script before DOMContentLoaded)
    // Just ensure it's set and mark as stable after initialization
    const topToolbar = document.getElementById('topToolbar');
    const toolbarWrap = document.querySelector('.toolbar-wrap');
    if (topToolbar && toolbarWrap) {
      // Ensure toolbar-ready is set
      topToolbar.classList.add('toolbar-ready');
      toolbarWrap.classList.add('toolbar-ready');
    }

    // 3. Calculate layout AFTER toolbar initialization completes (use RAF to ensure DOM is ready)
    requestAnimationFrame(() => {
      const doLayoutCalculation = () => {
        // Force a layout calculation to ensure all styles are applied
        const toolbarWrap = document.querySelector('.toolbar-wrap');
        if (toolbarWrap) {
          void toolbarWrap.offsetWidth; // Force layout
        }

        // Now calculate layout (toolbar is already visible, but we need to stabilize it)
        calculateInitialToolbarLayout();

        // 4. Setup smart labels (skip initial check since we already calculated)
        initSmartLabels(true); // Pass true to skip initial check
      };

      // Wait for fonts to load to ensure accurate text measurements
      if (document.fonts && document.fonts.ready) {
        // Check if fonts are already loaded
        if (document.fonts.status === 'loaded') {
          doLayoutCalculation();
        } else {
          document.fonts.ready.then(doLayoutCalculation);
        }
      } else {
        // Fallback if fonts API not available - use small delay
        setTimeout(doLayoutCalculation, 50);
      }
    });

    // (Sketchbook toggle removed per request)
    // Panel visibility toggles
    const strokePanel = document.getElementById('strokePanel');
    const imagePanel = document.getElementById('imagePanel');
    const captureOverlay = document.getElementById('captureOverlay');
    const captureFrame = document.getElementById('captureFrame');
    const tabBar = document.getElementById('captureTabBar');
    const tabList = document.getElementById('captureTabList');
    const tabAddButton = document.getElementById('captureTabAdd');
    const masterOverlay = document.getElementById('captureTabMasterOverlay');
    const masterTargetBadge = document.getElementById('captureMasterTargetBadge');

    // Capture frame tabs storage and helpers
    window.captureTabsByLabel = window.captureTabsByLabel || {};
    window.captureMasterDrawTargetByLabel = window.captureMasterDrawTargetByLabel || {};
    let captureTabIdCounter = 1;
    const captureTabPalette = ['#22c55e', '#06b6d4', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444'];

    function toBaseLabel(label) {
      if (!label || typeof label !== 'string') return label;
      return label.split('::tab:')[0];
    }
    const getActiveLabel = () =>
      toBaseLabel(window.app?.projectManager?.currentViewId || window.currentImageLabel || 'front');
    function pickNextTabColor(state) {
      const normalTabs = (state?.tabs || []).filter(tab => tab.type !== 'master');
      return captureTabPalette[normalTabs.length % captureTabPalette.length];
    }
    function buildScopedLabel(label, tabId) {
      if (!label) return label;
      const baseLabel = toBaseLabel(label);
      if (!tabId || tabId === 'master') return baseLabel;
      return `${baseLabel}::tab:${tabId}`;
    }
    function getActiveScopedLabel(label) {
      const resolved = label || getActiveLabel();
      const state = ensureCaptureTabsForLabel(resolved);
      let tabId = state?.activeTabId;
      if (tabId === state?.masterTabId || tabId === 'master') {
        const fromMasterSelection = window.captureMasterDrawTargetByLabel?.[resolved];
        tabId =
          fromMasterSelection ||
          state?.lastNonMasterId ||
          state?.tabs?.find(tab => tab.type !== 'master')?.id;
      }
      return buildScopedLabel(resolved, tabId);
    }
    function isLabelInViewScope(objectLabel, viewLabel) {
      if (!objectLabel || !viewLabel) return false;
      return objectLabel === viewLabel || objectLabel.startsWith(`${viewLabel}::tab:`);
    }
    function getMasterDrawTargetTabId(label, state) {
      const resolvedState = state || ensureCaptureTabsForLabel(label);
      return (
        window.captureMasterDrawTargetByLabel?.[label] ||
        resolvedState?.lastNonMasterId ||
        resolvedState?.tabs?.find(tab => tab.type !== 'master')?.id ||
        null
      );
    }
    function syncCanvasVisibilityForActiveTab(label) {
      const resolved = label || getActiveLabel();
      const state = ensureCaptureTabsForLabel(resolved);
      const activeTab = getActiveTab(resolved);
      const canvas = window.app?.canvasManager?.fabricCanvas;
      if (!canvas || !state || !activeTab) return;

      const tagManager = window.app?.tagManager;
      const metadataManager = window.app?.metadataManager;
      if (tagManager && metadataManager) {
        Object.entries(metadataManager.vectorStrokesByImage || {}).forEach(
          ([scopeKey, strokes]) => {
            if (!isLabelInViewScope(scopeKey, resolved)) return;
            const labelVisibility = metadataManager.strokeLabelVisibility?.[scopeKey] || {};
            Object.entries(strokes || {}).forEach(([strokeLabel, strokeObj]) => {
              if (!strokeObj) return;
              const labelVisible = labelVisibility[strokeLabel] !== false;
              if (!labelVisible) return;
              const existing =
                typeof tagManager.getTagObject === 'function'
                  ? tagManager.getTagObject(strokeLabel, scopeKey)
                  : null;
              if (!existing && typeof tagManager.createTag === 'function') {
                tagManager.createTag(strokeLabel, scopeKey, strokeObj);
              }
            });
          }
        );
      }

      const primaryTab = state.tabs.find(tab => tab.type !== 'master');
      const activeScope = buildScopedLabel(resolved, activeTab.id);
      const showLegacyBase =
        activeTab.type !== 'master' && primaryTab && activeTab.id === primaryTab.id;
      const masterDrawTargetId = getMasterDrawTargetTabId(resolved, state);
      const masterTargetScope = buildScopedLabel(resolved, masterDrawTargetId);
      const masterAllowsLegacy = primaryTab && masterDrawTargetId === primaryTab.id;

      canvas.getObjects().forEach(obj => {
        const objectLabel = obj?.strokeMetadata?.imageLabel || obj?.imageLabel;
        if (!objectLabel || !isLabelInViewScope(objectLabel, resolved)) return;
        if (activeTab.type === 'master') {
          obj.visible = true;
          const inTargetScope = objectLabel.includes('::tab:')
            ? objectLabel === masterTargetScope
            : masterAllowsLegacy;
          obj.evented = inTargetScope;
          obj.selectable = inTargetScope;
          return;
        }
        if (objectLabel.includes('::tab:')) {
          obj.visible = objectLabel === activeScope;
          obj.evented = obj.visible;
          obj.selectable = obj.visible;
          return;
        }
        obj.visible = showLegacyBase;
        obj.evented = obj.visible;
        obj.selectable = obj.visible;
      });
      canvas.requestRenderAll();
    }

    function buildCaptureFrameRecord(rect) {
      const winW = Math.max(window.innerWidth, 1);
      const winH = Math.max(window.innerHeight, 1);
      return {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        windowWidth: winW,
        windowHeight: winH,
        relativeLeft: rect.left / winW,
        relativeTop: rect.top / winH,
        relativeWidth: rect.width / winW,
        relativeHeight: rect.height / winH,
      };
    }
    function getCaptureFrameRectPixels() {
      const rect = captureFrame.getBoundingClientRect();
      return buildCaptureFrameRecord(rect);
    }
    function buildViewportRecord() {
      const canvasManager = window.app?.canvasManager;
      const viewport = canvasManager?.getViewportState
        ? canvasManager.getViewportState()
        : { zoom: 1, panX: 0, panY: 0 };
      const rotation = canvasManager?.getRotationDegrees ? canvasManager.getRotationDegrees() : 0;
      return {
        zoom: typeof viewport.zoom === 'number' ? viewport.zoom : 1,
        panX: typeof viewport.panX === 'number' ? viewport.panX : 0,
        panY: typeof viewport.panY === 'number' ? viewport.panY : 0,
        rotation: typeof rotation === 'number' ? rotation : 0,
      };
    }
    function applyViewportRecord(record) {
      if (!record) return;
      const canvasManager = window.app?.canvasManager;
      if (canvasManager?.setRotationDegrees && typeof record.rotation === 'number') {
        canvasManager.setRotationDegrees(record.rotation);
      }
      if (canvasManager?.setViewportState) {
        canvasManager.setViewportState({
          zoom: record.zoom,
          panX: record.panX,
          panY: record.panY,
        });
      }
    }
    function createTabId() {
      captureTabIdCounter += 1;
      return `tab-${Date.now()}-${captureTabIdCounter}`;
    }
    function createDefaultTabState(label) {
      const frameRect = getCaptureFrameRectPixels();
      const viewport = buildViewportRecord();
      const defaultTabId = createTabId();
      const masterTabId = 'master';
      return {
        tabs: [
          {
            id: defaultTabId,
            name: 'Frame 1',
            type: 'normal',
            color: captureTabPalette[0],
            captureFrame: frameRect,
            viewport,
          },
          {
            id: masterTabId,
            name: 'Master',
            type: 'master',
            viewport,
          },
        ],
        activeTabId: defaultTabId,
        masterTabId,
        lastNonMasterId: defaultTabId,
      };
    }
    function normalizeTabState(label, state) {
      if (!state || !Array.isArray(state.tabs)) {
        return createDefaultTabState(label);
      }
      const normalized = {
        tabs: [],
        activeTabId: state.activeTabId,
        masterTabId: state.masterTabId || 'master',
        lastNonMasterId: state.lastNonMasterId,
      };
      let normalIndex = 0;
      state.tabs.forEach(tab => {
        if (!tab || typeof tab !== 'object') return;
        const id = typeof tab.id === 'string' ? tab.id : createTabId();
        const type = tab.type === 'master' || tab.type === 'linked' ? tab.type : 'normal';
        const color =
          type === 'master'
            ? null
            : typeof tab.color === 'string' && tab.color
              ? tab.color
              : captureTabPalette[normalIndex % captureTabPalette.length];
        if (type !== 'master') {
          normalIndex += 1;
        }
        normalized.tabs.push({
          id,
          name: typeof tab.name === 'string' ? tab.name : 'Frame',
          type,
          color,
          captureFrame: tab.captureFrame || null,
          viewport: tab.viewport || null,
          linkedTarget: tab.linkedTarget || null,
        });
      });
      if (!normalized.tabs.length) {
        return createDefaultTabState(label);
      }
      let hasMaster = normalized.tabs.some(tab => tab.type === 'master');
      if (!hasMaster) {
        normalized.tabs.push({
          id: normalized.masterTabId,
          name: 'Master',
          type: 'master',
          viewport: buildViewportRecord(),
        });
        hasMaster = true;
      }
      if (!normalized.masterTabId) {
        const master = normalized.tabs.find(tab => tab.type === 'master');
        normalized.masterTabId = master ? master.id : 'master';
      }
      if (
        !normalized.activeTabId ||
        !normalized.tabs.some(tab => tab.id === normalized.activeTabId)
      ) {
        const firstNormal = normalized.tabs.find(tab => tab.type !== 'master');
        normalized.activeTabId = firstNormal ? firstNormal.id : normalized.masterTabId;
      }
      if (!normalized.lastNonMasterId) {
        const firstNormal = normalized.tabs.find(tab => tab.type !== 'master');
        normalized.lastNonMasterId = firstNormal ? firstNormal.id : normalized.activeTabId;
      }
      return normalized;
    }
    function ensureCaptureTabsForLabel(label) {
      const baseLabel = toBaseLabel(label) || 'front';
      const existing = window.captureTabsByLabel[baseLabel];
      if (!existing) {
        window.captureTabsByLabel[baseLabel] = createDefaultTabState(baseLabel);
      } else {
        window.captureTabsByLabel[baseLabel] = normalizeTabState(baseLabel, existing);
      }
      return window.captureTabsByLabel[baseLabel];
    }
    function getActiveTab(label) {
      const state = ensureCaptureTabsForLabel(label);
      return state.tabs.find(tab => tab.id === state.activeTabId) || null;
    }
    function getHighlightedFrameTab(state, label) {
      if (!state) return null;
      const selectedInMaster = window.captureMasterDrawTargetByLabel?.[label || getActiveLabel()];
      const highlightedId =
        state.activeTabId === state.masterTabId || state.activeTabId === 'master'
          ? selectedInMaster || state.lastNonMasterId
          : state.activeTabId;
      return state.tabs.find(tab => tab.id === highlightedId && tab.type !== 'master') || null;
    }
    function renderMasterTargetBadge(label) {
      if (!masterTargetBadge) return;
      const state = ensureCaptureTabsForLabel(label);
      const tab = getHighlightedFrameTab(state);
      if (!tab) {
        masterTargetBadge.textContent = 'Drawing target: none';
        masterTargetBadge.style.borderColor = 'rgba(15, 23, 42, 0.2)';
        masterTargetBadge.style.background = 'rgba(255, 255, 255, 0.94)';
        masterTargetBadge.style.color = '#0f172a';
        return;
      }
      const accent = tab.color || '#22c55e';
      masterTargetBadge.textContent = `Drawing into: ${tab.name || 'Frame'}`;
      masterTargetBadge.style.borderColor = `${accent}99`;
      masterTargetBadge.style.background = `${accent}22`;
      masterTargetBadge.style.color = '#0f172a';
    }
    function setMasterViewActive(isActive) {
      if (isActive) {
        document.body.classList.add('master-view-active');
      } else {
        document.body.classList.remove('master-view-active');
      }
    }
    function saveActiveTabState(label) {
      if (!label) return;
      const state = ensureCaptureTabsForLabel(label);
      const activeTab = state.tabs.find(tab => tab.id === state.activeTabId);
      if (!activeTab || activeTab.type === 'master') return;
      activeTab.captureFrame = getCaptureFrameRectPixels();
      activeTab.viewport = buildViewportRecord();
      state.lastNonMasterId = activeTab.id;
    }
    function saveCurrentCaptureFrameForLabel(label) {
      const resolved = label || getActiveLabel();
      if (!resolved) return;
      saveActiveTabState(resolved);
    }
    function resolveCaptureFrameRect(stored) {
      const winW = Math.max(window.innerWidth, 1);
      const winH = Math.max(window.innerHeight, 1);
      const targetAspect = 4 / 3;

      let fallbackWidth = Math.min(800, winW);
      let fallbackHeight = Math.round(fallbackWidth / targetAspect);
      if (fallbackHeight > winH) {
        fallbackHeight = Math.min(600, winH);
        fallbackWidth = Math.round(fallbackHeight * targetAspect);
      }

      const fallback = {
        left: Math.max(0, Math.round((winW - fallbackWidth) / 2)),
        top: Math.max(0, Math.round((winH - fallbackHeight) / 2)),
        width: fallbackWidth,
        height: fallbackHeight,
      };
      if (!stored) return fallback;

      const baseW = stored.windowWidth || winW;
      const baseH = stored.windowHeight || winH;
      let width = Math.max(
        1,
        Math.round(
          typeof stored.relativeWidth === 'number'
            ? stored.relativeWidth * winW
            : (stored.width ?? fallback.width)
        )
      );
      let height = Math.max(
        1,
        Math.round(
          typeof stored.relativeHeight === 'number'
            ? stored.relativeHeight * winH
            : (stored.height ?? fallback.height)
        )
      );

      if (width / height > targetAspect) {
        width = Math.round(height * targetAspect);
      } else {
        height = Math.round(width / targetAspect);
      }

      if (width < 200 || height < 150) {
        return fallback;
      }

      const leftRatio =
        typeof stored.relativeLeft === 'number'
          ? stored.relativeLeft
          : (stored.left ?? fallback.left) / baseW;
      const topRatio =
        typeof stored.relativeTop === 'number'
          ? stored.relativeTop
          : (stored.top ?? fallback.top) / baseH;

      const maxLeft = Math.max(0, winW - width);
      const maxTop = Math.max(0, winH - height);

      return {
        left: Math.min(maxLeft, Math.max(0, Math.round(leftRatio * winW))),
        top: Math.min(maxTop, Math.max(0, Math.round(topRatio * winH))),
        width: Math.min(width, winW),
        height: Math.min(height, winH),
      };
    }
    function applyCaptureFrameForLabel(label) {
      const resolved = label || getActiveLabel();
      const state = ensureCaptureTabsForLabel(resolved);
      const activeTab = getActiveTab(resolved);
      if (!activeTab) return;
      if (activeTab.type === 'master') {
        setMasterViewActive(true);
        captureFrame.style.borderColor = '#22c55e';
        renderMasterOverlay(resolved);
        return;
      }
      setMasterViewActive(false);
      const stored = activeTab.captureFrame;
      const rect = resolveCaptureFrameRect(stored);
      captureFrame.style.left = `${rect.left}px`;
      captureFrame.style.top = `${rect.top}px`;
      captureFrame.style.width = `${rect.width}px`;
      captureFrame.style.height = `${rect.height}px`;
      activeTab.captureFrame = {
        ...(stored || {}),
        ...rect,
        windowWidth: Math.max(window.innerWidth, 1),
        windowHeight: Math.max(window.innerHeight, 1),
        relativeLeft: rect.left / Math.max(window.innerWidth, 1),
        relativeTop: rect.top / Math.max(window.innerHeight, 1),
        relativeWidth: rect.width / Math.max(window.innerWidth, 1),
        relativeHeight: rect.height / Math.max(window.innerHeight, 1),
      };
      captureFrame.style.borderColor = activeTab.color || '#22c55e';
      if (!activeTab.viewport) {
        activeTab.viewport = buildViewportRecord();
      }
      if (activeTab.viewport) {
        applyViewportRecord(activeTab.viewport);
      }
    }
    function getCanvasClientRect() {
      const canvasEl =
        window.app?.canvasManager?.fabricCanvas?.upperCanvasEl ||
        window.app?.canvasManager?.fabricCanvas?.lowerCanvasEl ||
        null;
      return canvasEl?.getBoundingClientRect?.() || { left: 0, top: 0 };
    }
    function buildViewportTransform(viewport) {
      const canvasManager = window.app?.canvasManager;
      const zoom = typeof viewport?.zoom === 'number' && viewport.zoom > 0 ? viewport.zoom : 1;
      const panX = typeof viewport?.panX === 'number' ? viewport.panX : 0;
      const panY = typeof viewport?.panY === 'number' ? viewport.panY : 0;
      const rotation = typeof viewport?.rotation === 'number' ? viewport.rotation : 0;
      const angleRadians = (rotation * Math.PI) / 180;
      const cos = Math.cos(angleRadians);
      const sin = Math.sin(angleRadians);
      const center = canvasManager?.getRotationCenter?.() || {
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      };
      const base = [zoom * cos, zoom * sin, -zoom * sin, zoom * cos, 0, 0];
      const translateToOrigin = [1, 0, 0, 1, -center.x, -center.y];
      const translateBack = [1, 0, 0, 1, center.x, center.y];
      let transform = fabric.util.multiplyTransformMatrices(base, translateToOrigin);
      transform = fabric.util.multiplyTransformMatrices(translateBack, transform);
      transform[4] += panX;
      transform[5] += panY;
      return transform;
    }
    function computeWorldRectForTab(tab) {
      if (!tab?.captureFrame || !tab?.viewport) return null;
      const rect = resolveCaptureFrameRect(tab.captureFrame);
      const canvasRect = getCanvasClientRect();
      const matrix = buildViewportTransform(tab.viewport);
      const inverse = fabric.util.invertTransform(matrix);
      const corners = [
        new fabric.Point(rect.left - canvasRect.left, rect.top - canvasRect.top),
        new fabric.Point(rect.left + rect.width - canvasRect.left, rect.top - canvasRect.top),
        new fabric.Point(rect.left - canvasRect.left, rect.top + rect.height - canvasRect.top),
        new fabric.Point(
          rect.left + rect.width - canvasRect.left,
          rect.top + rect.height - canvasRect.top
        ),
      ].map(point => fabric.util.transformPoint(point, inverse));
      const xs = corners.map(point => point.x);
      const ys = corners.map(point => point.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs);
      const maxY = Math.max(...ys);
      return {
        left: minX,
        top: minY,
        width: maxX - minX,
        height: maxY - minY,
      };
    }
    function mapWorldRectToViewport(worldRect, viewport) {
      if (!worldRect || !viewport) return null;
      const canvasRect = getCanvasClientRect();
      const matrix = buildViewportTransform(viewport);
      const corners = [
        new fabric.Point(worldRect.left, worldRect.top),
        new fabric.Point(worldRect.left + worldRect.width, worldRect.top),
        new fabric.Point(worldRect.left, worldRect.top + worldRect.height),
        new fabric.Point(worldRect.left + worldRect.width, worldRect.top + worldRect.height),
      ].map(point => fabric.util.transformPoint(point, matrix));
      const xs = corners.map(point => point.x + canvasRect.left);
      const ys = corners.map(point => point.y + canvasRect.top);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs);
      const maxY = Math.max(...ys);
      return {
        left: minX,
        top: minY,
        width: maxX - minX,
        height: maxY - minY,
      };
    }
    function computeWorldRectFromViewportRect(rect, viewport) {
      if (!rect || !viewport) return null;
      const canvasRect = getCanvasClientRect();
      const matrix = buildViewportTransform(viewport);
      const inverse = fabric.util.invertTransform(matrix);
      const corners = [
        new fabric.Point(rect.left - canvasRect.left, rect.top - canvasRect.top),
        new fabric.Point(rect.left + rect.width - canvasRect.left, rect.top - canvasRect.top),
        new fabric.Point(rect.left - canvasRect.left, rect.top + rect.height - canvasRect.top),
        new fabric.Point(
          rect.left + rect.width - canvasRect.left,
          rect.top + rect.height - canvasRect.top
        ),
      ].map(point => fabric.util.transformPoint(point, inverse));
      const xs = corners.map(point => point.x);
      const ys = corners.map(point => point.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs);
      const maxY = Math.max(...ys);
      return {
        left: minX,
        top: minY,
        width: maxX - minX,
        height: maxY - minY,
      };
    }
    function isCaptureFrameUnlocked() {
      return document.body.classList.contains('capture-unlocked');
    }
    function buildCenteredRectFromSize(width, height) {
      const nextWidth = Math.max(100, Math.min(width || 800, window.innerWidth));
      const nextHeight = Math.max(80, Math.min(height || 600, window.innerHeight));
      return {
        left: Math.max(0, Math.round((window.innerWidth - nextWidth) / 2)),
        top: Math.max(0, Math.round((window.innerHeight - nextHeight) / 2)),
        width: Math.round(nextWidth),
        height: Math.round(nextHeight),
      };
    }
    function updateTabFromMasterOverlayRect(label, tabId, masterRect) {
      const state = ensureCaptureTabsForLabel(label);
      const tab = state.tabs.find(item => item.id === tabId);
      const master = state.tabs.find(item => item.type === 'master');
      if (!tab || !master || tab.type === 'master') return;
      const worldRect = computeWorldRectFromViewportRect(
        masterRect,
        master.viewport || buildViewportRecord()
      );
      if (!worldRect) return;
      const existingRect = resolveCaptureFrameRect(tab.captureFrame);
      const centeredRect = buildCenteredRectFromSize(existingRect.width, existingRect.height);
      let nextViewport = {
        ...(tab.viewport || buildViewportRecord()),
      };
      const mappedBefore = mapWorldRectToViewport(worldRect, nextViewport);
      if (!mappedBefore || mappedBefore.width <= 0 || mappedBefore.height <= 0) return;
      const fitScale = Math.min(
        centeredRect.width / Math.max(1, mappedBefore.width),
        centeredRect.height / Math.max(1, mappedBefore.height)
      );
      nextViewport.zoom = Math.max(0.01, (nextViewport.zoom || 1) * fitScale);
      const mappedAfter = mapWorldRectToViewport(worldRect, nextViewport);
      if (!mappedAfter) return;
      const targetCx = centeredRect.left + centeredRect.width / 2;
      const targetCy = centeredRect.top + centeredRect.height / 2;
      const mappedCx = mappedAfter.left + mappedAfter.width / 2;
      const mappedCy = mappedAfter.top + mappedAfter.height / 2;
      nextViewport.panX = (nextViewport.panX || 0) + (targetCx - mappedCx);
      nextViewport.panY = (nextViewport.panY || 0) + (targetCy - mappedCy);
      tab.viewport = nextViewport;
      tab.captureFrame = buildCaptureFrameRecord(centeredRect);
      if (state.activeTabId === tab.id) {
        applyCaptureFrameForLabel(label);
      } else {
        renderMasterOverlay(label);
      }
    }
    function renderTabBar(label) {
      if (!tabList) return;
      const state = ensureCaptureTabsForLabel(label);
      tabList.innerHTML = '';
      state.tabs.forEach(tab => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `capture-tab${
          tab.id === state.activeTabId ? ' active' : ''
        }${tab.type === 'master' ? ' master' : ''}`;
        button.dataset.tabId = tab.id;
        const labelSpan = document.createElement('span');
        labelSpan.textContent = tab.name || 'Frame';
        button.appendChild(labelSpan);
        const accent = tab.color || captureTabPalette[0];
        if (tab.type !== 'master') {
          button.style.borderColor = `${accent}66`;
          button.style.background = tab.id === state.activeTabId ? accent : `${accent}22`;
          button.style.color = tab.id === state.activeTabId ? '#ffffff' : '#0f172a';
        }
        if (tab.type !== 'master') {
          const close = document.createElement('span');
          close.className = 'capture-tab-close';
          close.textContent = 'x';
          close.dataset.action = 'close';
          button.appendChild(close);
        }
        button.addEventListener('pointerdown', e => {
          e.stopPropagation();
        });
        button.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          const target = e.target;
          const resolvedLabel = resolveLabelForTabId(tab.id, label);
          if (target?.dataset?.action === 'close') {
            deleteTab(resolvedLabel, tab.id);
            return;
          }
          setActiveTab(resolvedLabel, tab.id);
        });
        tabList.appendChild(button);
      });
    }
    function renderMasterOverlay(label) {
      if (!masterOverlay) return;
      const state = ensureCaptureTabsForLabel(label);
      const master = state.tabs.find(item => item.type === 'master');
      const highlightedTab = getHighlightedFrameTab(state, label);
      masterOverlay.innerHTML = '';
      state.tabs
        .filter(tab => tab.type !== 'master')
        .forEach(tab => {
          const worldRect = computeWorldRectForTab(tab);
          const rect = mapWorldRectToViewport(worldRect, master?.viewport || buildViewportRecord());
          if (!rect) return;
          const frame = document.createElement('button');
          frame.type = 'button';
          frame.className = 'capture-tab-frame';
          const isMasterActive =
            state.activeTabId === state.masterTabId || state.activeTabId === 'master';
          const isDrawTarget = isMasterActive && tab.id === highlightedTab?.id;
          const isLockedMaster = isMasterActive && !isCaptureFrameUnlocked();
          if (tab.id === highlightedTab?.id) {
            frame.classList.add('active');
          }
          if (isDrawTarget) {
            frame.classList.add('draw-target');
          }
          const accent = tab.color || '#22c55e';
          frame.dataset.tabId = tab.id;
          frame.style.left = `${rect.left}px`;
          frame.style.top = `${rect.top}px`;
          frame.style.width = `${rect.width}px`;
          frame.style.height = `${rect.height}px`;
          frame.style.borderColor = `${accent}f2`;
          frame.style.background = tab.id === highlightedTab?.id ? `${accent}12` : `${accent}08`;
          if (isLockedMaster) {
            frame.style.pointerEvents = 'none';
          }
          const directions = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
          directions.forEach(direction => {
            const handle = document.createElement('span');
            handle.className = 'master-resize-handle';
            handle.dataset.direction = direction;
            frame.appendChild(handle);
          });

          frame.addEventListener('mousedown', e => {
            if (!isCaptureFrameUnlocked()) return;
            if (e.button !== 0) return;
            const handle = e.target.closest('.master-resize-handle');
            const startRect = frame.getBoundingClientRect();
            const startPos = { x: e.clientX, y: e.clientY };
            let moved = false;
            const mode = handle ? 'resize' : 'drag';
            const direction = handle?.dataset?.direction || null;

            const onMove = moveEvent => {
              const deltaX = moveEvent.clientX - startPos.x;
              const deltaY = moveEvent.clientY - startPos.y;
              let nextRect = {
                left: startRect.left,
                top: startRect.top,
                width: startRect.width,
                height: startRect.height,
              };
              if (mode === 'drag') {
                nextRect.left = startRect.left + deltaX;
                nextRect.top = startRect.top + deltaY;
              } else {
                const centerX = startRect.left + startRect.width / 2;
                const centerY = startRect.top + startRect.height / 2;
                if (direction.includes('e')) nextRect.width = startRect.width + deltaX * 2;
                if (direction.includes('w')) nextRect.width = startRect.width - deltaX * 2;
                if (direction.includes('s')) nextRect.height = startRect.height + deltaY * 2;
                if (direction.includes('n')) nextRect.height = startRect.height - deltaY * 2;
                nextRect.width = Math.max(90, nextRect.width);
                nextRect.height = Math.max(70, nextRect.height);
                nextRect.left = centerX - nextRect.width / 2;
                nextRect.top = centerY - nextRect.height / 2;
              }

              const maxLeft = Math.max(0, window.innerWidth - nextRect.width);
              const maxTop = Math.max(0, window.innerHeight - nextRect.height);
              nextRect.left = Math.min(maxLeft, Math.max(0, nextRect.left));
              nextRect.top = Math.min(maxTop, Math.max(0, nextRect.top));

              frame.style.left = `${nextRect.left}px`;
              frame.style.top = `${nextRect.top}px`;
              frame.style.width = `${nextRect.width}px`;
              frame.style.height = `${nextRect.height}px`;
              moved = true;
            };

            const onUp = () => {
              document.removeEventListener('mousemove', onMove);
              document.removeEventListener('mouseup', onUp);
              if (moved) {
                frame.dataset.moved = '1';
                setTimeout(() => {
                  delete frame.dataset.moved;
                }, 0);
                const finalRect = frame.getBoundingClientRect();
                updateTabFromMasterOverlayRect(label, tab.id, finalRect);
              }
            };

            e.preventDefault();
            e.stopPropagation();
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
          });
          frame.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            if (frame.dataset.moved === '1') return;
            const state = ensureCaptureTabsForLabel(label);
            const active = state.tabs.find(item => item.id === state.activeTabId);
            if (active?.type === 'master') {
              state.lastNonMasterId = tab.id;
              window.captureMasterDrawTargetByLabel[label] = tab.id;
              window.currentImageLabel = buildScopedLabel(label, tab.id);
              syncCanvasVisibilityForActiveTab(label);
              window.app?.metadataManager?.updateStrokeVisibilityControls?.();
              renderMasterOverlay(label);
              return;
            }
            setActiveTab(label, tab.id);
          });
          masterOverlay.appendChild(frame);
          const selector = document.createElement('button');
          selector.type = 'button';
          selector.className = 'capture-tab-frame-label selectable';
          selector.textContent = tab.name || 'Frame';
          selector.style.position = 'absolute';
          selector.style.left = `${rect.left + 8}px`;
          selector.style.top = `${rect.top + 8}px`;
          selector.style.zIndex = '4';
          selector.addEventListener('click', clickEvent => {
            clickEvent.preventDefault();
            clickEvent.stopPropagation();
            state.lastNonMasterId = tab.id;
            window.captureMasterDrawTargetByLabel[label] = tab.id;
            window.currentImageLabel = buildScopedLabel(label, tab.id);
            syncCanvasVisibilityForActiveTab(label);
            window.app?.metadataManager?.updateStrokeVisibilityControls?.();
            renderMasterOverlay(label);
          });
          masterOverlay.appendChild(selector);
        });
      renderMasterTargetBadge(label);
    }
    function setActiveTab(label, tabId, options = {}) {
      const baseLabel = toBaseLabel(label) || 'front';
      const state = ensureCaptureTabsForLabel(baseLabel);
      const targetTab = state.tabs.find(tab => tab.id === tabId);
      if (!targetTab) return;
      if (!options.skipSave) {
        saveActiveTabState(baseLabel);
      }
      const nextState = {
        ...state,
        tabs: [...state.tabs],
        activeTabId: targetTab.id,
      };
      if (targetTab.type !== 'master') {
        nextState.lastNonMasterId = targetTab.id;
        window.captureMasterDrawTargetByLabel[baseLabel] = targetTab.id;
      }
      window.captureTabsByLabel[baseLabel] = nextState;
      if (targetTab.viewport) {
        applyViewportRecord(targetTab.viewport);
      }
      window.currentImageLabel = getActiveScopedLabel(baseLabel);
      applyCaptureFrameForLabel(baseLabel);
      syncCanvasVisibilityForActiveTab(baseLabel);
      window.app?.metadataManager?.updateStrokeVisibilityControls?.();
      renderTabBar(baseLabel);
      renderMasterOverlay(baseLabel);
    }
    function createNewTab(label) {
      const baseLabel = toBaseLabel(label) || 'front';
      const state = ensureCaptureTabsForLabel(baseLabel);
      const workingState = normalizeTabState(baseLabel, state);
      const activeTab =
        workingState.tabs.find(tab => tab.id === workingState.activeTabId) ||
        workingState.tabs.find(tab => tab.type !== 'master') ||
        null;
      const baseName = 'Frame';
      const nextIndex = workingState.tabs.filter(tab => tab.type !== 'master').length + 1;
      const name = `${baseName} ${nextIndex}`;
      const newTab = {
        id: createTabId(),
        name,
        type: 'normal',
        color: pickNextTabColor(workingState),
        captureFrame: activeTab?.captureFrame
          ? JSON.parse(JSON.stringify(activeTab.captureFrame))
          : getCaptureFrameRectPixels(),
        viewport: activeTab?.viewport
          ? JSON.parse(JSON.stringify(activeTab.viewport))
          : buildViewportRecord(),
      };
      const nextTabs = [...workingState.tabs];
      const masterIndex = nextTabs.findIndex(tab => tab.type === 'master');
      if (masterIndex === -1) {
        nextTabs.push(newTab);
      } else {
        nextTabs.splice(masterIndex, 0, newTab);
      }
      window.captureTabsByLabel[baseLabel] = {
        ...workingState,
        tabs: nextTabs,
        activeTabId: newTab.id,
        lastNonMasterId: newTab.id,
      };
      window.captureMasterDrawTargetByLabel[baseLabel] = newTab.id;
      window.currentImageLabel = buildScopedLabel(baseLabel, newTab.id);
      applyCaptureFrameForLabel(baseLabel);
      syncCanvasVisibilityForActiveTab(baseLabel);
      window.app?.metadataManager?.updateStrokeVisibilityControls?.();
      renderTabBar(baseLabel);
      renderMasterOverlay(baseLabel);
    }
    function deleteTab(label, tabId) {
      const state = ensureCaptureTabsForLabel(label);
      const tab = state.tabs.find(item => item.id === tabId);
      if (!tab || tab.type === 'master') return;
      const remaining = state.tabs.filter(item => item.type !== 'master' && item.id !== tabId);
      if (remaining.length === 0) return;
      state.tabs = state.tabs.filter(item => item.id !== tabId);
      const nextId =
        state.activeTabId === tabId
          ? state.lastNonMasterId && state.lastNonMasterId !== tabId
            ? state.lastNonMasterId
            : remaining[0].id
          : state.activeTabId;
      setActiveTab(label, nextId, { skipSave: true });
    }
    function resolveLabelForTabId(tabId, preferredLabel) {
      if (!tabId) return preferredLabel || getActiveLabel();
      const preferred = toBaseLabel(preferredLabel || getActiveLabel());
      if (preferred) {
        const preferredState = ensureCaptureTabsForLabel(preferred);
        if (preferredState.tabs.some(tab => tab.id === tabId)) {
          return preferred;
        }
      }
      const labels = Object.keys(window.captureTabsByLabel || {});
      for (const label of labels) {
        const state = ensureCaptureTabsForLabel(toBaseLabel(label));
        if (state.tabs.some(tab => tab.id === tabId)) {
          return toBaseLabel(label);
        }
      }
      return preferred;
    }

    if (tabAddButton) {
      tabAddButton.addEventListener('click', () => {
        const label = getActiveLabel();
        createNewTab(label);
      });
    }
    if (tabList) {
      tabList.addEventListener('dblclick', e => {
        const button = e.target.closest('button');
        if (!button || !button.dataset.tabId) return;
        const label = resolveLabelForTabId(button.dataset.tabId);
        const state = ensureCaptureTabsForLabel(label);
        const tab = state.tabs.find(item => item.id === button.dataset.tabId);
        if (!tab || tab.type === 'master') return;
        const nextName = window.prompt('Rename tab', tab.name || 'Frame');
        if (typeof nextName === 'string' && nextName.trim()) {
          tab.name = nextName.trim();
          renderTabBar(label);
          renderMasterOverlay(label);
        }
      });
    }
    function installTabViewportTracking() {
      const canvas = window.app?.canvasManager?.fabricCanvas;
      if (!canvas || canvas.__captureTabViewportTracking) return false;
      canvas.__captureTabViewportTracking = true;
      let raf = null;
      const sync = () => {
        const label = getActiveLabel();
        const state = ensureCaptureTabsForLabel(label);
        const activeTab = getActiveTab(label);
        if (!activeTab || activeTab.type === 'master') return;
        const viewport = buildViewportRecord();
        const previous = activeTab.viewport || {};
        if (
          previous.zoom === viewport.zoom &&
          previous.panX === viewport.panX &&
          previous.panY === viewport.panY &&
          previous.rotation === viewport.rotation
        ) {
          return;
        }
        activeTab.viewport = viewport;
        state.lastNonMasterId = activeTab.id;
        renderMasterOverlay(label);
      };
      const scheduleSync = () => {
        if (raf !== null) return;
        raf = requestAnimationFrame(() => {
          raf = null;
          sync();
        });
      };
      canvas.on('mouse:wheel', scheduleSync);
      canvas.on('mouse:move', scheduleSync);
      canvas.on('mouse:up', scheduleSync);
      return true;
    }
    const viewportTrackingTimer = setInterval(() => {
      if (installTabViewportTracking()) {
        clearInterval(viewportTrackingTimer);
      }
    }, 250);

    window.saveCurrentCaptureFrameForLabel = saveCurrentCaptureFrameForLabel;
    window.applyCaptureFrameForLabel = applyCaptureFrameForLabel;
    window.ensureCaptureTabsForLabel = ensureCaptureTabsForLabel;
    window.setActiveCaptureTab = setActiveTab;
    window.renderCaptureTabUI = label => {
      const resolved = toBaseLabel(label || getActiveLabel());
      renderTabBar(resolved);
      renderMasterOverlay(resolved);
    };
    window.captureTabsSyncActive = label => {
      const resolved = toBaseLabel(label || getActiveLabel());
      saveActiveTabState(resolved);
    };
    window.setCaptureTabsForLabel = (label, data) => {
      const resolved = toBaseLabel(label);
      if (!resolved) return;
      window.captureTabsByLabel[resolved] = normalizeTabState(resolved, data);
    };
    window.getCaptureTabScopedLabel = label => getActiveScopedLabel(label || getActiveLabel());
    window.getCaptureTabScopeForTab = (label, tabId) => buildScopedLabel(label, tabId);
    window.syncCaptureTabCanvasVisibility = label => syncCanvasVisibilityForActiveTab(label);

    const initialLabel = getActiveLabel();
    ensureCaptureTabsForLabel(initialLabel);
    renderTabBar(initialLabel);
    renderMasterOverlay(initialLabel);
    window.currentImageLabel = getActiveScopedLabel(initialLabel);
    applyCaptureFrameForLabel(initialLabel);
    syncCanvasVisibilityForActiveTab(initialLabel);

    let captureFrameResizeRaf = null;
    window.addEventListener('resize', () => {
      if (captureFrameResizeRaf !== null) return;
      captureFrameResizeRaf = requestAnimationFrame(() => {
        captureFrameResizeRaf = null;
        const activeLabel = getActiveLabel();
        if (typeof window.applyCaptureFrameForLabel === 'function') {
          window.applyCaptureFrameForLabel(activeLabel);
        }
      });
    });

    // Mobile toolbar expand/collapse functionality
    (function initToolbarToggle() {
      const toolbarWrap = document.querySelector('.toolbar-wrap');
      if (!toolbarWrap) return;

      function isMobileDevice() {
        return window.innerWidth <= 768;
      }

      // Track if we've shown the initial glow (only once per page load)
      let hasShownInitialGlow = false;
      let wasScrollable = false;
      let wasExpanded = false;

      // Check if toolbar is scrollable (can be expanded)
      function checkIfExpandable() {
        const isMobile = isMobileDevice();
        const isExpanded = toolbarWrap.classList.contains('expanded');

        if (!isMobile || isExpanded) {
          toolbarWrap.removeAttribute('data-scrollable');
          toolbarWrap.classList.remove('expandable');
          // Don't reset flags when expanded - preserve state for when collapsed
          if (!isMobile) {
            hasShownInitialGlow = false;
            wasScrollable = false;
          }
          wasExpanded = isExpanded;
          return;
        }

        // Check if content overflows
        const isScrollable = toolbarWrap.scrollWidth > toolbarWrap.clientWidth;
        const hadScrollable = toolbarWrap.hasAttribute('data-scrollable');

        // Set data attribute for CSS hover detection
        if (isScrollable) {
          toolbarWrap.setAttribute('data-scrollable', 'true');

          // Show glow once when transitioning from non-scrollable to scrollable
          // BUT only if we haven't shown it before AND we're not coming from expanded state
          const shouldShowGlow = !wasScrollable && !hasShownInitialGlow && !wasExpanded;

          if (shouldShowGlow) {
            // Remove inline style to allow animation
            toolbarWrap.style.removeProperty('box-shadow');
            toolbarWrap.classList.add('expandable');
            hasShownInitialGlow = true;

            // Remove the class after animation completes and clear inline style
            setTimeout(() => {
              toolbarWrap.classList.remove('expandable');
              // Clear inline style so hover can work
              toolbarWrap.style.removeProperty('box-shadow');
            }, 500);
          } else {
            // Only clear inline style if not hovering and not animating
            if (
              !toolbarWrap.matches(':hover') &&
              !toolbarWrap.classList.contains('expanded') &&
              !toolbarWrap.classList.contains('expandable') &&
              !toolbarWrap.classList.contains('tapped')
            ) {
              toolbarWrap.style.removeProperty('box-shadow');
            }
          }
        } else {
          toolbarWrap.removeAttribute('data-scrollable');
          toolbarWrap.classList.remove('expandable');
          // Reset glow flag when not scrollable (but preserve if we were expanded)
          if (!wasExpanded) {
            hasShownInitialGlow = false;
          }
        }

        // Update previous state
        wasScrollable = isScrollable;
        wasExpanded = isExpanded;
      }

      // Initial check and periodic checks
      setTimeout(() => {
        checkIfExpandable();
      }, 500);

      // Only run periodic checks on mobile (where expand/collapse matters)
      const checkInterval = isMobileDevice()
        ? setInterval(() => {
            checkIfExpandable();
          }, 2000)
        : null;

      // Clean up interval if not needed
      if (!checkInterval && !isMobileDevice()) {
        // On desktop, only check once after initial setup
        setTimeout(() => {
          checkIfExpandable();
        }, 1000);
      }

      // Also check on scroll
      toolbarWrap.addEventListener('scroll', () => {
        clearTimeout(checkIfExpandable.timeout);
        checkIfExpandable.timeout = setTimeout(() => {
          checkIfExpandable();
        }, 300);
      });

      function handleToolbarTap(e) {
        if (!isMobileDevice()) {
          return;
        }

        // Only process if the event target is the toolbar or a child of the toolbar
        const target = e.target;
        if (!toolbarWrap.contains(target) && target !== toolbarWrap) {
          return; // Not a toolbar event, let it pass through
        }

        const rect = toolbarWrap.getBoundingClientRect();
        const tapY = e.clientY || (e.changedTouches && e.changedTouches[0]?.clientY) || 0;
        const tapX = e.clientX || (e.changedTouches && e.changedTouches[0]?.clientX) || 0;

        // Check if tap is in the bottom 12px of the toolbar
        const bottomThreshold = 12;
        const isBottomTap = tapY >= rect.bottom - bottomThreshold && tapY <= rect.bottom;

        // Also check if tap is on the toolbar itself (not on a button)
        const isToolbarArea =
          tapY >= rect.top && tapY <= rect.bottom && tapX >= rect.left && tapX <= rect.right;

        // Don't toggle if clicking on a button or input
        const isInteractiveElement =
          target.tagName === 'BUTTON' ||
          target.tagName === 'INPUT' ||
          target.closest('button') ||
          target.closest('input') ||
          target.closest('.color-swatches');

        if (isBottomTap && isToolbarArea && !isInteractiveElement) {
          e.preventDefault();
          e.stopPropagation();

          const wasExpanded = toolbarWrap.classList.contains('expanded');

          // Add glow animation on tap
          toolbarWrap.classList.remove('tapped');
          // Remove inline style to allow animation
          toolbarWrap.style.removeProperty('box-shadow');
          void toolbarWrap.offsetWidth; // Force reflow
          toolbarWrap.classList.add('tapped');

          // Remove tapped class after animation and clear inline style
          setTimeout(() => {
            toolbarWrap.classList.remove('tapped');
            // Clear inline style so hover can work
            toolbarWrap.style.removeProperty('box-shadow');
          }, 1000);

          toolbarWrap.classList.toggle('expanded');

          // Update topToolbar height
          const topToolbar = document.getElementById('topToolbar');
          if (topToolbar) {
            if (toolbarWrap.classList.contains('expanded')) {
              topToolbar.style.height = 'auto';
              topToolbar.style.maxHeight = 'calc(5 * (32px + 6px) + 16px)'; // 5 rows + padding
            } else {
              topToolbar.style.height = '48px';
              topToolbar.style.maxHeight = 'none';
              // Remove animation classes and clear inline style
              toolbarWrap.classList.remove('expandable', 'tapped');
              // Add no-glow class to prevent hover glow from persisting
              toolbarWrap.classList.add('no-glow');
              // Temporarily remove data-scrollable to clear any hover glow
              toolbarWrap.removeAttribute('data-scrollable');
              toolbarWrap.style.removeProperty('box-shadow');
              // Force clear any glow immediately
              toolbarWrap.style.boxShadow = 'none';

              // Check if mouse is already outside the toolbar (not hovering)
              const isCurrentlyHovered = toolbarWrap.matches(':hover');

              // If mouse is already outside, remove no-glow immediately
              if (!isCurrentlyHovered) {
                setTimeout(() => {
                  toolbarWrap.classList.remove('no-glow');
                }, 100); // Small delay to ensure collapse animation completes
              } else {
                // Remove no-glow class when mouse leaves (to allow hover glow again)
                const removeNoGlowOnLeave = () => {
                  if (toolbarWrap.classList.contains('no-glow')) {
                    toolbarWrap.classList.remove('no-glow');
                  }
                };
                toolbarWrap.addEventListener('mouseleave', removeNoGlowOnLeave, { once: true });

                // Also remove after a delay as fallback (for touch devices or if mouseleave doesn't fire)
                setTimeout(() => {
                  if (toolbarWrap.classList.contains('no-glow')) {
                    toolbarWrap.classList.remove('no-glow');
                    toolbarWrap.removeEventListener('mouseleave', removeNoGlowOnLeave);
                  }
                }, 1000);
              }
            }
          }

          // Recheck expandability after toggle
          setTimeout(() => {
            // Double-check glow is cleared after collapse
            if (!toolbarWrap.classList.contains('expanded')) {
              toolbarWrap.style.boxShadow = 'none';
              toolbarWrap.style.removeProperty('box-shadow');
              // Don't remove data-scrollable if no-glow is active (it will prevent glow anyway)
              if (!toolbarWrap.classList.contains('no-glow')) {
                toolbarWrap.removeAttribute('data-scrollable');
              }
              // Force reflow to ensure CSS applies
              void toolbarWrap.offsetWidth;
            }
            checkIfExpandable();
          }, 150);
        }
      }

      // Add event listeners for both click and touch
      toolbarWrap.addEventListener('click', handleToolbarTap);
      toolbarWrap.addEventListener('touchend', handleToolbarTap);

      // Handle window resize
      let resizeTimeout;
      window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
          if (!isMobileDevice() && toolbarWrap.classList.contains('expanded')) {
            toolbarWrap.classList.remove('expanded');
            const topToolbar = document.getElementById('topToolbar');
            if (topToolbar) {
              topToolbar.style.height = '48px';
              topToolbar.style.maxHeight = 'none';
            }
          }
          checkIfExpandable();
        }, 150);
      });

      // Cleanup interval on page unload
      window.addEventListener('beforeunload', () => {
        clearInterval(checkInterval);
      });
    })();

    // Panel management is now handled by external panel-management.js file

    // removed elements resize handle wiring

    // Set up Vectors and tags panel button functionality
    const selectAllStrokesBtn = document.getElementById('selectAllStrokesBtn');
    const showAllMeasurementsBtn = document.getElementById('showAllMeasurementsBtn');

    // Select/Deselect All Strokes functionality
    if (selectAllStrokesBtn) {
      let allSelected = false; // Start with deselect all (false)
      selectAllStrokesBtn.addEventListener('click', () => {
        const checkboxes = document.querySelectorAll(
          '#strokeVisibilityControls input[type="checkbox"]'
        );
        allSelected = !allSelected;

        checkboxes.forEach(checkbox => {
          if (checkbox.checked !== allSelected) {
            checkbox.click(); // Use click to trigger the existing event handlers
          }
        });

        // Update button text
        selectAllStrokesBtn.textContent = allSelected ? 'Deselect All' : 'Select All';
        selectAllStrokesBtn.title = allSelected ? 'Deselect all elements' : 'Select all elements';
      });
    }

    // Show All Measurements functionality
    if (showAllMeasurementsBtn) {
      showAllMeasurementsBtn.addEventListener('click', () => {
        if (typeof window.generateMeasurementsList === 'function') {
          window.generateMeasurementsList();
        }
      });
    }

    // View Submitted Measurements functionality
    const viewSubmittedMeasurementsBtn = document.getElementById('viewSubmittedMeasurementsBtn');
    if (viewSubmittedMeasurementsBtn) {
      viewSubmittedMeasurementsBtn.addEventListener('click', () => {
        if (typeof window.viewSubmittedMeasurements === 'function') {
          window.viewSubmittedMeasurements();
        } else {
          console.error('viewSubmittedMeasurements function not found');
        }
      });
    }

    // Simplified Tag System
    let tagMode = 'letters+numbers'; // 'letters' or 'letters+numbers'
    const resolveTagScopeLabel = () => {
      const fallback =
        window.currentImageLabel || window.app?.projectManager?.currentViewId || 'default';
      if (typeof fallback === 'string' && fallback.includes('::tab:')) {
        return fallback;
      }
      if (typeof window.getCaptureTabScopedLabel === 'function') {
        return window.getCaptureTabScopedLabel(fallback) || fallback;
      }
      return fallback;
    };

    // Helper function to find next available letter (A, B, C...)
    function findNextAvailableLetter() {
      const currentImageLabel = resolveTagScopeLabel();
      const lineStrokes = window.lineStrokesByImage?.[currentImageLabel] || [];
      const existingTags = lineStrokes.filter(Boolean);

      // Extract all letters that have been used (from both A and A1 patterns)
      const usedLetters = new Set();
      for (const tag of existingTags) {
        if (/^[A-Z]/.test(tag)) {
          usedLetters.add(tag[0]); // Get the first letter
        }
      }

      // Find the first unused letter
      for (let i = 0; i < 26; i++) {
        const letter = String.fromCharCode(65 + i); // A=65, B=66, etc.
        if (!usedLetters.has(letter)) {
          return letter;
        }
      }

      // If all letters A-Z are used, start over at A
      return 'A';
    }

    // Helper function to find next available letter+number (A1, A2, A3...)
    function findNextAvailableLetterNumber() {
      const currentImageLabel = resolveTagScopeLabel();
      const lineStrokes = window.lineStrokesByImage?.[currentImageLabel] || [];
      const existingTags = lineStrokes.filter(Boolean);

      // Extract all base tags (A1, A2, etc.) and track the highest per letter
      const letterCounts = new Map();

      for (const tag of existingTags) {
        // Handle both A1 and A1(1) patterns
        const match = tag.match(/^([A-Z])(\d+)(?:\((\d+)\))?$/);
        if (match) {
          const letter = match[1];
          const number = parseInt(match[2]);
          const currentMax = letterCounts.get(letter) || 0;
          letterCounts.set(letter, Math.max(currentMax, number));
        }
      }

      // Find the next available tag
      for (
        let letter = 'A';
        letter <= 'Z';
        letter = String.fromCharCode(letter.charCodeAt(0) + 1)
      ) {
        const maxNumber = letterCounts.get(letter) || 0;
        const nextNumber = maxNumber + 1;

        if (nextNumber <= 9) {
          return letter + nextNumber;
        }
      }

      // If we've exhausted all possibilities up to Z9, start over at A1
      return 'A1';
    }

    // Tag Mode Toggle functionality
    const tagModeToggle = document.getElementById('tagModeToggle');
    if (tagModeToggle) {
      tagModeToggle.addEventListener('click', () => {
        const oldMode = tagMode;
        tagMode = tagMode === 'letters' ? 'letters+numbers' : 'letters';
        tagModeToggle.textContent = tagMode === 'letters' ? 'Letters Only' : 'Letters + Numbers';

        // Automatically set the next appropriate tag when switching modes
        const currentImageLabel = resolveTagScopeLabel();
        window.labelsByImage = window.labelsByImage || {};

        if (tagMode === 'letters') {
          // Switching to letters only - find next available letter
          const nextLetter = findNextAvailableLetter();
          window.labelsByImage[currentImageLabel] = nextLetter;
          console.log(`[tagModeToggle] Switched to letters mode, next tag: ${nextLetter}`);
        } else {
          // Switching to letters+numbers - find next available letter+number
          const nextLetterNumber = findNextAvailableLetterNumber();
          window.labelsByImage[currentImageLabel] = nextLetterNumber;
          console.log(
            `[tagModeToggle] Switched to letters+numbers mode, next tag: ${nextLetterNumber}`
          );
        }

        updateNextTagDisplay();
      });
    }

    // Calculate next tag based on current mode and existing tags
    function calculateNextTag() {
      console.log('[calculateNextTag] Called with tagMode:', tagMode);
      const currentImageLabel = resolveTagScopeLabel();

      // First, check if there are any existing tags
      const strokesObj =
        window.app?.metadataManager?.vectorStrokesByImage?.[currentImageLabel] || {};
      const existingTags = Object.keys(strokesObj);

      console.log(
        '[calculateNextTag] Current image:',
        currentImageLabel,
        'existing tags:',
        existingTags
      );

      // If no tags exist, reset to the beginning and clear any manual overrides
      if (existingTags.length === 0) {
        // Clear any manual tag overrides since we're starting fresh
        if (window.labelsByImage && window.labelsByImage[currentImageLabel]) {
          delete window.labelsByImage[currentImageLabel];
        }
        if (window.manualTagByImage && window.manualTagByImage[currentImageLabel]) {
          delete window.manualTagByImage[currentImageLabel];
        }

        const result = tagMode === 'letters' ? 'A' : 'A1';
        console.log('[calculateNextTag] No existing tags, returning:', result);
        return result;
      }

      // Priority 1: Check if user manually set the next tag via labelsByImage
      if (window.labelsByImage && window.labelsByImage[currentImageLabel]) {
        const manualTag = window.labelsByImage[currentImageLabel];
        console.log('[calculateNextTag] Using labelsByImage (manual override):', manualTag);
        return manualTag;
      }

      // Priority 2: Check if we're in a manual tag sequence (manualTagByImage)
      if (window.manualTagByImage && window.manualTagByImage[currentImageLabel]) {
        const manualTag = window.manualTagByImage[currentImageLabel];
        console.log('[calculateNextTag] Using manualTagByImage (manual sequence):', manualTag);
        return manualTag;
      }

      // Priority 3: Calculate next tag with gap-filling

      // Extract all base tags (without suffixes)
      const baseTags = new Set();

      for (const tag of existingTags) {
        if (tagMode === 'letters') {
          if (/^[A-Z]$/.test(tag)) {
            baseTags.add(tag);
          }
        } else {
          // Handle both A1 and A1(1), A1(2) patterns
          const match = tag.match(/^([A-Z]\d+)(?:\((\d+)\))?$/);
          if (match) {
            const baseTag = match[1];
            baseTags.add(baseTag);
          }
        }
      }

      if (baseTags.size === 0) {
        // No valid tags found, start fresh
        const result = tagMode === 'letters' ? 'A' : 'A1';
        console.log('[calculateNextTag] No valid tags found, returning:', result);
        return result;
      }

      // Sort tags properly for alphanumeric comparison
      const sortedBaseTags = Array.from(baseTags).sort((a, b) => {
        if (tagMode === 'letters') {
          // Simple alphabetic sort for letter-only mode
          return a.localeCompare(b);
        } else {
          // Alphanumeric sort: compare letter first, then number
          const matchA = a.match(/^([A-Z])(\d+)$/);
          const matchB = b.match(/^([A-Z])(\d+)$/);

          if (!matchA || !matchB) return a.localeCompare(b);

          const [, letterA, numA] = matchA;
          const [, letterB, numB] = matchB;

          // Compare letters first
          if (letterA !== letterB) {
            return letterA.localeCompare(letterB);
          }

          // If same letter, compare numbers numerically
          return parseInt(numA) - parseInt(numB);
        }
      });

      console.log('[calculateNextTag] Sorted tags:', sortedBaseTags);

      if (tagMode === 'letters') {
        // Letters only mode: Check for gaps first

        // Check if 'A' is missing (gap at the beginning)
        if (sortedBaseTags[0] !== 'A') {
          console.log('[calculateNextTag] Letters mode, missing A at start');
          return 'A';
        }

        // Check for gaps in the middle
        for (let i = 0; i < sortedBaseTags.length - 1; i++) {
          const currentLetter = sortedBaseTags[i][0];
          const nextLetter = sortedBaseTags[i + 1][0];
          const expectedNext = String.fromCharCode(currentLetter.charCodeAt(0) + 1);

          if (expectedNext !== nextLetter && expectedNext <= 'Z') {
            console.log('[calculateNextTag] Letters mode, found gap:', expectedNext);
            return expectedNext;
          }
        }

        // No gaps, increment from last
        const lastLetter = sortedBaseTags[sortedBaseTags.length - 1][0];
        const nextLetter = String.fromCharCode(lastLetter.charCodeAt(0) + 1);

        if (nextLetter > 'Z') {
          console.log('[calculateNextTag] Letters mode, wrapped to A');
          return 'A';
        }

        console.log('[calculateNextTag] Letters mode, next:', nextLetter);
        return nextLetter;
      } else {
        // Letters + numbers mode: Check for gaps first

        // Check if A1 is missing (gap at the beginning)
        const firstTag = sortedBaseTags[0];
        if (firstTag !== 'A1') {
          console.log('[calculateNextTag] Numbers mode, missing A1 at start');
          return 'A1';
        }

        // Check for gaps in the sequence
        for (let i = 0; i < sortedBaseTags.length; i++) {
          const match = sortedBaseTags[i].match(/^([A-Z])(\d+)$/);
          if (!match) continue;

          const [, letter, number] = match;
          const num = parseInt(number);

          // Check for gaps within the same letter
          if (i < sortedBaseTags.length - 1) {
            const nextMatch = sortedBaseTags[i + 1].match(/^([A-Z])(\d+)$/);
            if (nextMatch) {
              const [, nextLetter, nextNumber] = nextMatch;
              const nextNum = parseInt(nextNumber);

              // If same letter, check for gap
              if (letter === nextLetter && nextNum > num + 1) {
                const result = letter + (num + 1);
                console.log('[calculateNextTag] Numbers mode, found gap:', result);
                return result;
              }
            }
          }
        }

        // No gaps, increment from last
        const lastBaseTag = sortedBaseTags[sortedBaseTags.length - 1];
        const match = lastBaseTag.match(/^([A-Z])(\d+)$/);
        if (match) {
          const [, letter, number] = match;
          const nextNumber = parseInt(number) + 1;

          // Check if we need to move to the next letter
          if (nextNumber > 9) {
            const nextLetter = String.fromCharCode(letter.charCodeAt(0) + 1);
            if (nextLetter > 'Z') {
              console.log('[calculateNextTag] Numbers mode, wrapped to A1');
              return 'A1';
            }
            const result = nextLetter + '1';
            console.log('[calculateNextTag] Numbers mode, exceeded 9, next:', result);
            return result;
          }

          const result = letter + nextNumber;
          console.log('[calculateNextTag] Numbers mode, next:', result);
          return result;
        } else {
          console.log('[calculateNextTag] Unexpected tag format, returning A1');
          return 'A1';
        }
      }
    }

    // Calculate the next tag after a specific tag (for manual tag setting)
    // This increments without gap-filling to preserve user intent
    function calculateNextTagFrom(tag) {
      const mode = typeof tagMode === 'string' ? tagMode : 'letters+numbers';

      if (mode === 'letters') {
        // Just increment the letter
        const nextLetter = String.fromCharCode(tag.charCodeAt(0) + 1);
        return nextLetter > 'Z' ? 'A' : nextLetter;
      } else {
        // Letters + numbers mode
        const match = tag.match(/^([A-Z])(\d+)$/);
        if (!match) return 'A1';

        const [, letter, number] = match;
        const nextNumber = parseInt(number) + 1;

        if (nextNumber > 9) {
          // Wrap to next letter
          const nextLetter = String.fromCharCode(letter.charCodeAt(0) + 1);
          if (nextLetter > 'Z') {
            return 'A1'; // Wrap around
          }
          return nextLetter + '1';
        }

        return letter + nextNumber;
      }
    }

    // Update the next tag display
    function updateNextTagDisplay() {
      const nextTagDisplay = document.getElementById('nextTagDisplay');
      if (nextTagDisplay) {
        const currentImageLabel = resolveTagScopeLabel();

        // Priority: 1) labelsByImage (immediate next), 2) manualTagByImage (manual sequence), 3) calculateNextTag (gap-filling)
        let nextTag;
        if (window.labelsByImage && window.labelsByImage[currentImageLabel]) {
          nextTag = window.labelsByImage[currentImageLabel];
          console.log('[updateNextTagDisplay] Using labelsByImage:', nextTag);
        } else if (window.manualTagByImage && window.manualTagByImage[currentImageLabel]) {
          // We're in a manual sequence - use the manual flag value
          nextTag = window.manualTagByImage[currentImageLabel];
          console.log('[updateNextTagDisplay] Using manualTagByImage:', nextTag);
        } else {
          // Normal gap-filling mode
          nextTag = calculateNextTag();
          console.log('[updateNextTagDisplay] Using calculateNextTag (gap-filling):', nextTag);
        }

        nextTagDisplay.textContent = nextTag;
      }
    }

    // Initialize next tag display
    updateNextTagDisplay();

    // Make functions available globally for paint.js to call
    window.updateNextTagDisplay = updateNextTagDisplay;
    window.calculateNextTag = calculateNextTag;
    window.calculateNextTagFrom = calculateNextTagFrom;
    console.log(
      '[index.html] Made calculateNextTag available globally:',
      typeof window.calculateNextTag
    );

    // Allow user to set the next tag directly by typing in the display
    const nextTagEl = document.getElementById('nextTagDisplay');

    // Store original value when user starts editing
    let originalTagValue = '';

    nextTagEl?.addEventListener('focus', e => {
      originalTagValue = e.target.textContent.trim();
      // Select all text for easy replacement
      const range = document.createRange();
      range.selectNodeContents(e.target);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });

    // Handle Enter key to commit changes
    nextTagEl?.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.target.blur(); // Trigger validation via blur
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.target.textContent = originalTagValue;
        e.target.blur();
      }
    });

    // Validate and save on blur
    nextTagEl?.addEventListener('blur', e => {
      const mode = typeof tagMode === 'string' ? tagMode : 'letters+numbers';
      const currentImageLabel = resolveTagScopeLabel();
      const input = e.target.textContent.trim().toUpperCase();

      // If empty or unchanged, restore original
      if (!input || input === originalTagValue) {
        e.target.textContent = originalTagValue;
        return;
      }

      const valid = mode === 'letters' ? /^[A-Z]$/.test(input) : /^[A-Z]\d+$/.test(input);

      if (!valid) {
        // Show error briefly and restore original
        e.target.textContent = '❌ Invalid';
        e.target.classList.add('text-red-600');
        setTimeout(() => {
          e.target.textContent = originalTagValue;
          e.target.classList.remove('text-red-600');
        }, 1000);
        return;
      }

      // Ensure labelsByImage exists, then set the next tag seed
      window.labelsByImage = window.labelsByImage || {};
      window.labelsByImage[currentImageLabel] = input;

      // Set flag to indicate this was a manual tag (not auto-calculated)
      // This tells the system to increment from this tag, not use gap-filling
      window.manualTagByImage = window.manualTagByImage || {};
      window.manualTagByImage[currentImageLabel] = input;

      e.target.textContent = input;
      console.log('[nextTagDisplay] Updated next tag to:', input, '(manual override)');
    });

    // Capture frame lock functionality
    let isCaptureLocked = true; // Start locked for minimal appearance

    // Initialize capture frame on load
    updateCaptureFrameLockState();

    // Lock/unlock button functionality
    const lockButton = document.getElementById('captureLockButton');
    lockButton?.addEventListener('click', e => {
      e.stopPropagation();
      toggleCaptureLock();
    });

    // Keyboard shortcut for lock/unlock (L key) - ignore when typing in inputs/textareas/selects or contenteditable
    document.addEventListener('keydown', e => {
      const target = e.target;
      const isTyping =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (isTyping) return;
      if (e.key && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        toggleCaptureLock();
      }
    });

    function toggleCaptureLock() {
      isCaptureLocked = !isCaptureLocked;
      updateCaptureFrameLockState();
      showLockPopup();
    }

    function showLockPopup() {
      const popup = document.getElementById('lockPopup');
      const icon = document.getElementById('lockPopupIcon');
      const text = document.getElementById('lockPopupText');

      if (isCaptureLocked) {
        text.textContent = 'Locked';
        icon.innerHTML =
          '<path d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"></path>';
      } else {
        text.textContent = 'Unlocked';
        icon.innerHTML =
          '<path d="M10 2a5 5 0 00-5 5v2a2 2 0 00-2 2v5a2 2 0 002 2h10a2 2 0 002-2v-5a2 2 0 00-2-2H7V7a3 3 0 015.905-.75 1 1 0 001.937-.5A5.002 5.002 0 0010 2z"></path>';
      }

      popup.classList.add('show');
      setTimeout(() => {
        popup.classList.remove('show');
      }, 1500);
    }

    function updateCaptureFrameLockState() {
      const lockButton = document.getElementById('captureLockButton');
      const instructions = document.getElementById('unlockInstructions');
      const applyAllButton = document.getElementById('applyFitAll');
      const isMasterView = document.body.classList.contains('master-view-active');

      if (isCaptureLocked) {
        captureFrame.classList.add('locked');
        captureFrame.classList.remove('unlocked');
        document.body.classList.remove('capture-unlocked');
        lockButton.classList.add('locked');
        lockButton.title = 'Unlock frame (L)';
        instructions.classList.add('hidden');

        // Hide Apply All button for safety
        if (applyAllButton) {
          applyAllButton.style.display = 'none';
        }

        // Use white overlay outside the frame for clarity
        captureFrame.style.boxShadow = '0 0 0 2000px rgba(255,255,255,1)';

        // Enable pointer events for lock button only
        captureFrame.style.pointerEvents = 'none';
        lockButton.style.pointerEvents = 'auto';
      } else {
        captureFrame.classList.remove('locked');
        captureFrame.classList.add('unlocked');
        document.body.classList.add('capture-unlocked');
        lockButton.classList.remove('locked');
        lockButton.title = 'Lock frame (L)';
        instructions.classList.remove('hidden');

        // Show Apply All button when unlocked
        if (applyAllButton) {
          applyAllButton.style.display = 'inline-block';
        }

        // Remove overlay when unlocked for transparent background while adjusting
        captureFrame.style.boxShadow = 'none';

        // Enable pointer events for dragging and resizing
        captureFrame.style.pointerEvents = isMasterView ? 'none' : 'auto';
        lockButton.style.pointerEvents = 'auto';
      }

      if (isMasterView) {
        const label = getActiveLabel();
        renderMasterOverlay(label);
        syncCanvasVisibilityForActiveTab(label);
      }
    }

    // Color picker functionality
    const colorButtons = document.querySelectorAll('[data-color]');
    colorButtons.forEach(button => {
      button.addEventListener('click', () => {
        // Remove active class from all buttons
        colorButtons.forEach(btn => btn.classList.remove('active'));
        // Add active class to clicked button
        button.classList.add('active');
        // Update color picker value
        const colorPicker = document.getElementById('colorPicker');
        if (colorPicker) {
          colorPicker.value = button.getAttribute('data-color');
          // Trigger change event for existing functionality
          colorPicker.dispatchEvent(new Event('change'));
        }
      });
    });

    // Update active color button styling
    const style = document.createElement('style');
    style.textContent = `
                  [data-color].active {
                      border-color: #374151 !important;
                      box-shadow: 0 0 0 2px white, 0 0 0 4px #374151 !important;
                      transform: scale(1.1);
                  }
              `;
    document.head.appendChild(style);

    // Capture frame resize functionality
    let isResizing = false;
    let currentHandle = null;
    let startPos = { x: 0, y: 0 };
    let startRect = { x: 0, y: 0, width: 0, height: 0 };

    const resizeHandles = document.querySelectorAll('.resize-handle');
    resizeHandles.forEach(handle => {
      handle.addEventListener('mousedown', e => {
        // Don't allow resizing when locked
        if (isCaptureLocked || document.body.classList.contains('master-view-active')) return;

        e.preventDefault();
        isResizing = true;
        currentHandle = handle.getAttribute('data-direction');
        startPos = { x: e.clientX, y: e.clientY };

        const rect = captureFrame.getBoundingClientRect();
        startRect = {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        };

        document.addEventListener('mousemove', handleResize);
        document.addEventListener('mouseup', stopResize);
      });
    });

    function handleResize(e) {
      if (!isResizing || !currentHandle) return;

      const deltaX = e.clientX - startPos.x;
      const deltaY = e.clientY - startPos.y;

      let newX = startRect.x;
      let newY = startRect.y;
      let newWidth = startRect.width;
      let newHeight = startRect.height;

      // Handle different resize directions (mirrored resize from center)
      const centerX = startRect.x + startRect.width / 2;
      const centerY = startRect.y + startRect.height / 2;
      if (currentHandle.includes('e')) {
        newWidth = startRect.width + deltaX * 2;
      }
      if (currentHandle.includes('w')) {
        newWidth = startRect.width - deltaX * 2;
      }
      if (currentHandle.includes('s')) {
        newHeight = startRect.height + deltaY * 2;
      }
      if (currentHandle.includes('n')) {
        newHeight = startRect.height - deltaY * 2;
      }

      // Apply minimum size constraints
      const minSize = 100;
      newWidth = Math.max(minSize, newWidth);
      newHeight = Math.max(minSize, newHeight);

      // Apply maximum size constraints (viewport bounds) with symmetric resizing
      const maxWidth = 2 * Math.min(centerX, window.innerWidth - centerX);
      const maxHeight = 2 * Math.min(centerY, window.innerHeight - centerY);
      if (Number.isFinite(maxWidth)) {
        newWidth = Math.min(newWidth, maxWidth);
      }
      if (Number.isFinite(maxHeight)) {
        newHeight = Math.min(newHeight, maxHeight);
      }

      newX = centerX - newWidth / 2;
      newY = centerY - newHeight / 2;

      // Apply maximum size constraints (viewport bounds)
      const maxX = window.innerWidth - newWidth;
      const maxY = window.innerHeight - newHeight;
      newX = Math.max(0, Math.min(maxX, newX));
      newY = Math.max(0, Math.min(maxY, newY));

      // Update capture frame position and size
      captureFrame.style.left = newX + 'px';
      captureFrame.style.top = newY + 'px';
      captureFrame.style.width = newWidth + 'px';
      captureFrame.style.height = newHeight + 'px';
    }

    function stopResize() {
      isResizing = false;
      currentHandle = null;
      document.removeEventListener('mousemove', handleResize);
      document.removeEventListener('mouseup', stopResize);
      // Save per-image frame when resizing ends
      if (typeof window.currentImageLabel !== 'undefined') {
        const activeLabel = getActiveLabel();
        saveCurrentCaptureFrameForLabel(activeLabel);

        // Store the frame dimensions as a ratio of canvas size
        const canvas = document.getElementById('canvas');
        const frameRect = captureFrame.getBoundingClientRect();

        if (!window.manualFrameRatios) {
          window.manualFrameRatios = {};
        }

        window.manualFrameRatios[activeLabel] = {
          widthRatio: frameRect.width / canvas.clientWidth,
          heightRatio: frameRect.height / canvas.clientHeight,
          leftRatio: frameRect.left / canvas.clientWidth,
          topRatio: frameRect.top / canvas.clientHeight,
        };

        console.log(
          `[FRAME] Saved ${activeLabel} frame ratios: ${(window.manualFrameRatios[activeLabel].widthRatio * 100).toFixed(1)}% width, ${(window.manualFrameRatios[activeLabel].heightRatio * 100).toFixed(1)}% height`
        );
      }
    }

    // Optimized capture frame dragging - 1:1 movement with no lag
    let isCaptureDragging = false;
    let captureDragOffset = { x: 0, y: 0 };
    let lastCaptureMousePos = { x: 0, y: 0 };
    let captureRafId = null;
    function isPointerNearCaptureBorder(event, rect) {
      const borderGrab = 14;
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      return (
        x <= borderGrab ||
        y <= borderGrab ||
        x >= rect.width - borderGrab ||
        y >= rect.height - borderGrab
      );
    }

    captureFrame.addEventListener('mousedown', e => {
      // Don't drag if locked, clicking on handles, or buttons
      if (
        isCaptureLocked ||
        document.body.classList.contains('master-view-active') ||
        e.target.classList.contains('resize-handle') ||
        e.target.closest('button')
      ) {
        return;
      }

      // Allow Shift+click to pass through for canvas dragging
      if (e.shiftKey) {
        return;
      }

      const rect = captureFrame.getBoundingClientRect();
      if (e.target === captureFrame && !isPointerNearCaptureBorder(e, rect)) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      isCaptureDragging = true;

      captureDragOffset.x = e.clientX - rect.left;
      captureDragOffset.y = e.clientY - rect.top;

      // Add dragging class for no transitions
      captureFrame.classList.add('dragging');

      document.addEventListener('mousemove', handleCaptureDrag, { passive: true });
      document.addEventListener('mouseup', stopCaptureDrag);
    });

    function handleCaptureDrag(e) {
      if (!isCaptureDragging || isCaptureLocked) return;

      // Store mouse position for RAF
      lastCaptureMousePos.x = e.clientX;
      lastCaptureMousePos.y = e.clientY;

      // Cancel previous RAF if still pending
      if (captureRafId) {
        cancelAnimationFrame(captureRafId);
      }

      // Schedule position update for next frame
      captureRafId = requestAnimationFrame(updateCapturePosition);
    }

    function updateCapturePosition() {
      if (!isCaptureDragging) return;

      const newX = Math.max(
        0,
        Math.min(
          window.innerWidth - captureFrame.offsetWidth,
          lastCaptureMousePos.x - captureDragOffset.x
        )
      );
      const newY = Math.max(
        0,
        Math.min(
          window.innerHeight - captureFrame.offsetHeight,
          lastCaptureMousePos.y - captureDragOffset.y
        )
      );

      // Apply position immediately
      captureFrame.style.left = newX + 'px';
      captureFrame.style.top = newY + 'px';

      captureRafId = null;
    }

    function stopCaptureDrag() {
      if (!isCaptureDragging) return;

      isCaptureDragging = false;

      // Cancel any pending RAF
      if (captureRafId) {
        cancelAnimationFrame(captureRafId);
        captureRafId = null;
      }

      // Remove dragging class
      captureFrame.classList.remove('dragging');

      document.removeEventListener('mousemove', handleCaptureDrag);
      document.removeEventListener('mouseup', stopCaptureDrag);
      // Save per-image frame when dragging ends
      if (typeof window.currentImageLabel !== 'undefined') {
        saveCurrentCaptureFrameForLabel(getActiveLabel());
      }
    }

    // Optimized draggable functionality - 1:1 mouse movement with requestAnimationFrame
    function makeDraggable(element, handle) {
      let isDragging = false;
      let dragOffset = { x: 0, y: 0 };
      let lastMousePos = { x: 0, y: 0 };
      let rafId = null;
      let elementWidth, elementHeight; // Cache dimensions

      handle.addEventListener('mousedown', e => {
        // Don't start drag if clicking on buttons or inputs
        if (
          e.target.tagName === 'BUTTON' ||
          e.target.tagName === 'INPUT' ||
          e.target.tagName === 'SELECT' ||
          e.target.closest('button')
        ) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();

        isDragging = true;

        // Simplified position setup - get current position directly
        const rect = element.getBoundingClientRect();

        // Calculate offset from mouse to element's current position
        dragOffset.x = e.clientX - rect.left;
        dragOffset.y = e.clientY - rect.top;

        // Cache element dimensions to avoid repeated DOM queries
        elementWidth = element.offsetWidth;
        elementHeight = element.offsetHeight;

        // Set initial position and prepare for dragging
        element.style.position = 'fixed';
        element.style.left = rect.left + 'px';
        element.style.top = rect.top + 'px';
        element.style.transform = 'none';

        // Clear conflicting positioning styles when dragging starts
        element.style.bottom = 'auto';
        element.style.right = 'auto';

        // Add visual feedback immediately
        element.classList.add('dragging');
        document.body.style.userSelect = 'none';

        document.addEventListener('mousemove', onMouseMove, { passive: true });
        document.addEventListener('mouseup', stopDrag);
      });

      function onMouseMove(e) {
        if (!isDragging) return;

        // Store mouse position for RAF
        lastMousePos.x = e.clientX;
        lastMousePos.y = e.clientY;

        // Cancel previous RAF if still pending
        if (rafId) {
          cancelAnimationFrame(rafId);
        }

        // Schedule position update for next frame
        rafId = requestAnimationFrame(updatePosition);
      }

      function updatePosition() {
        if (!isDragging) return;

        // Calculate new position from mouse minus offset
        const newX = Math.max(
          0,
          Math.min(window.innerWidth - elementWidth, lastMousePos.x - dragOffset.x)
        );
        const newY = Math.max(
          0,
          Math.min(window.innerHeight - elementHeight, lastMousePos.y - dragOffset.y)
        );

        // Apply position immediately using left/top for immediate visual feedback
        element.style.left = newX + 'px';
        element.style.top = newY + 'px';

        rafId = null;
      }

      function stopDrag(e) {
        if (!isDragging) return;

        isDragging = false;

        // Cancel any pending RAF
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }

        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', stopDrag);

        // Reset visual feedback
        element.classList.remove('dragging');
        document.body.style.userSelect = '';
      }
    }

    // Make all floating panels draggable by their headers
    const floatingPanels = document.querySelectorAll('.floating-panel');
    floatingPanels.forEach(panel => {
      const header = panel.querySelector('.cursor-move');
      if (header) {
        header.style.cursor = 'move';
        makeDraggable(panel, header);
      }
    });

    // Custom dash controls functionality
    const dashStyleSelect = document.getElementById('dashStyleSelect');
    const customDashControls = document.getElementById('customDashControls');

    if (dashStyleSelect && customDashControls) {
      dashStyleSelect.addEventListener('change', () => {
        if (dashStyleSelect.value === 'custom') {
          customDashControls.classList.remove('hidden');
          customDashControls.classList.add('flex');
        } else {
          customDashControls.classList.add('hidden');
          customDashControls.classList.remove('flex');
        }
      });
    }

    // Enhanced Image Gallery with Horizontal Scroll Navigation
    let currentImageIndex = 0;
    let imageGalleryData = [];
    let intersectionObserver = null;

    // Initialize image gallery functionality
    function initializeImageGallery() {
      const imageGallery = document.getElementById('imageGallery');
      const imageDots = document.getElementById('imageDots');
      const prevButton = document.getElementById('prevImage');
      const nextButton = document.getElementById('nextImage');
      const imagePosition = document.getElementById('imagePosition');
      const imageCounter = document.getElementById('imageCounter');

      if (!imageGallery) return;

      // Navigation button functionality
      prevButton?.addEventListener('click', () => navigateToImage(currentImageIndex - 1));
      nextButton?.addEventListener('click', () => navigateToImage(currentImageIndex + 1));

      // Intersection Observer for active image detection
      intersectionObserver = new IntersectionObserver(
        entries => {
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              const imageIndex = parseInt(entry.target.dataset.imageIndex);
              if (!isNaN(imageIndex)) {
                updateActiveImage(imageIndex);
              }
            }
          });
        },
        {
          root: imageGallery,
          threshold: 0.6,
          rootMargin: '0px',
        }
      );

      // Keyboard navigation
      document.addEventListener('keydown', e => {
        // Don't process arrow keys if user is typing in an input field
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
          return;
        }

        // Don't process if user is editing a contentEditable element
        if (
          e.target.isContentEditable ||
          e.target.classList.contains('stroke-name') ||
          e.target.classList.contains('stroke-measurement')
        ) {
          return;
        }

        // Only handle keyboard navigation if image panel is visible
        if (!document.getElementById('imagePanel').classList.contains('hidden')) {
          if (e.key === 'ArrowLeft') {
            e.preventDefault();
            navigateToImage(currentImageIndex - 1);
          } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            navigateToImage(currentImageIndex + 1);
          }
        }
      });

      // Canvas Controls: wire rotate/flip buttons to current image
      // MIGRATED TO TYPESCRIPT - Rotation controls now handled by @/features/transform/controls.ts
      // and initialized in src/main.ts via initializeRotationControls()
      /*
            const rotateLeftCtrl = document.getElementById('rotateLeftCtrl');
            const rotateRightCtrl = document.getElementById('rotateRightCtrl');
            function getCurrentImageIndex() {
              const label = window.paintApp?.state?.currentImageLabel;
              if (!label) return currentImageIndex || 0;
              const idx = imageGalleryData.findIndex(i => (i.label || i.original?.label) === label);
              return idx >= 0 ? idx : currentImageIndex || 0;
            }
            function rotateFallback(deg) {
              const label = window.paintApp?.state?.currentImageLabel || 'blank_canvas';
              const c = document.getElementById('canvas');
              const w = c?.width || 800;
              const h = c?.height || 600;
              if (typeof window.transformImageData === 'function') {
                window.transformImageData(label, 'rotate', deg, w, h);
                if (window.redrawCanvasWithVisibility) window.redrawCanvasWithVisibility();
              }
            }
            rotateLeftCtrl?.addEventListener('click', () => {
              const idx = getCurrentImageIndex();
              if (imageGalleryData[idx]) {
                window.rotateImage?.(idx, -90);
              } else {
                rotateFallback(-90);
              }
            });
            rotateRightCtrl?.addEventListener('click', () => {
              const idx = getCurrentImageIndex();
              if (imageGalleryData[idx]) {
                window.rotateImage?.(idx, 90);
              } else {
                rotateFallback(90);
              }
            });
            */

      // Name/type inputs wiring
      const nameInput = document.getElementById('imageNameInput');
      const typeSelect = document.getElementById('imageTypeSelect');
      nameInput?.addEventListener('change', e => {
        const val = e.target.value || '';
        const idx = currentImageIndex;
        if (imageGalleryData[idx]) {
          imageGalleryData[idx].name = val;
          // Update caption under the thumbnail (if present)
          const gallery = document.getElementById('imageGallery');
          const card = gallery?.children[idx];
          const caption = card?.querySelector('.thumb-caption');
          if (caption) caption.textContent = val;
        }
      });
      typeSelect?.addEventListener('change', e => {
        const val = e.target.value || '';
        const idx = currentImageIndex;
        if (imageGalleryData[idx]) {
          imageGalleryData[idx].original = imageGalleryData[idx].original || {};
          imageGalleryData[idx].original.type = val;
        }
      });
    }

    // Add image to gallery
    function addImageToGallery(imageData, index) {
      console.log(`[Gallery] Adding image to gallery at index ${index}:`, imageData);

      const imageGallery = document.getElementById('imageGallery');
      const imageDots = document.getElementById('imageDots');

      if (!imageGallery || !imageDots) {
        console.error('[Gallery] imageGallery or imageDots element not found');
        return;
      }

      // Handle different image data formats from external scripts
      let imageSrc, imageName;
      if (typeof imageData === 'string') {
        // Simple string URL
        imageSrc = imageData;
        imageName = `Image ${index + 1}`;
      } else if (imageData && typeof imageData === 'object') {
        // Object with src/url and name properties
        imageSrc = imageData.src || imageData.url || imageData.dataUrl || imageData.blob;
        imageName = imageData.name || imageData.filename || imageData.title || `Image ${index + 1}`;
      } else {
        console.warn('[Gallery] Invalid image data format:', imageData);
        return;
      }
      if (!imageSrc) {
        console.warn('[Gallery] Missing image src, skipping:', imageData);
        return;
      }

      // Handle cases where imageData already has an 'original' property to avoid nesting
      let originalData = imageData;
      if (imageData && imageData.original && typeof imageData.original === 'object') {
        // If imageData already has an original property, use that instead
        originalData = imageData.original;
        console.log('[Gallery] Using nested original data to avoid double nesting');
      }

      // Compute caption; hide for blank canvas
      let displayName = '';
      try {
        if (!(originalData && originalData.isBlankCanvas)) {
          const lbl = originalData?.label;
          if (lbl && typeof window.getTagBasedFilename === 'function') {
            const base = lbl.split('_')[0];
            displayName = window.getTagBasedFilename(lbl, base) || imageName || '';
          } else {
            displayName = imageName || '';
          }
        }
      } catch (e) {
        displayName = imageName || '';
      }

      const existingThumb = imageGallery.querySelector(
        `.image-thumbnail[data-image-index="${index}"]`
      );
      if (existingThumb) {
        existingThumb.dataset.imageSrc = imageSrc;
        existingThumb.dataset.label =
          originalData?.label || imageData?.label || imageData?.name || imageName || '';
        existingThumb.style.backgroundImage = `url(${imageSrc})`;
        if (displayName) existingThumb.title = displayName;
        else existingThumb.removeAttribute('title');

        const existingCard = existingThumb.parentElement;
        let caption = existingCard?.querySelector('.thumb-caption');
        if (!caption && existingCard) {
          caption = document.createElement('div');
          caption.className =
            'thumb-caption text-[11px] text-slate-500 font-medium truncate max-w-[120px]';
          existingCard.appendChild(caption);
        }
        if (caption) caption.textContent = displayName || '';

        let dot = imageDots.querySelector(`.nav-dot[data-image-index="${index}"]`);
        if (!dot) {
          dot = document.createElement('div');
          dot.className = 'nav-dot';
          dot.dataset.imageIndex = index;
          dot.addEventListener('click', () => navigateToImage(index));
          imageDots.appendChild(dot);
        }
        console.log('[Gallery] Updated existing thumbnail at index:', index);
      }

      // Create image thumbnail
      let thumbnail = existingThumb;
      let card = existingThumb ? existingThumb.parentElement : null;
      if (!thumbnail) {
        thumbnail = document.createElement('div');
        thumbnail.className = 'image-thumbnail';
        thumbnail.dataset.imageIndex = index;
        thumbnail.dataset.imageSrc = imageSrc;
        thumbnail.dataset.label =
          originalData?.label || imageData?.label || imageData?.name || imageName || '';
        thumbnail.style.backgroundImage = `url(${imageSrc})`;
        thumbnail.title = imageName;
        thumbnail.draggable = true;
      }

      // Remove overlay label; use minimal caption below instead

      // Add hover controls (delete only)
      if (!existingThumb) {
        const controls = createThumbnailControls(index);
        // Strip rotate/flip from controls
        controls.querySelectorAll('.rotate-btn, .flip-btn').forEach(el => el.remove());
        thumbnail.appendChild(controls);
      }

      // Add all event listeners using helper function
      if (!existingThumb) addThumbnailEventListeners(thumbnail, index);

      // Wrap thumbnail in a small card with optional caption
      if (!card) {
        card = document.createElement('div');
        card.className = 'flex flex-col items-center gap-1';
        card.dataset.imageIndex = index;
        card.appendChild(thumbnail);
        const caption = document.createElement('div');
        caption.className =
          'thumb-caption text-[11px] text-slate-500 font-medium truncate max-w-[120px]';
        caption.textContent = displayName || '';
        card.appendChild(caption);
        if (displayName) thumbnail.title = displayName;
        else thumbnail.removeAttribute('title');
        imageGallery.appendChild(card);
        console.log(`[Gallery] Created thumbnail element:`, thumbnail);
        console.log(`[Gallery] Gallery element children count:`, imageGallery.children.length);
      }

      // Create navigation dot
      if (!existingThumb) {
        const dot = document.createElement('div');
        dot.className = 'nav-dot';
        dot.dataset.imageIndex = index;
        dot.addEventListener('click', () => navigateToImage(index));
        imageDots.appendChild(dot);
      }

      // Observe thumbnail for intersection
      if (intersectionObserver && !existingThumb) {
        intersectionObserver.observe(thumbnail);
      }

      const normalizedData = {
        src: imageSrc,
        name: imageName,
        original: originalData,
      };

      // Update gallery data
      imageGalleryData[index] = normalizedData;
      updateGalleryControls();
      if (!window.__initialGallerySyncDone && imageGalleryData.length === 1) {
        window.__initialGallerySyncDone = true;
        navigateToImage(0);
        console.log('[Gallery] Auto-selected first image');
      }

      // Trigger mini-stepper update if function exists
      // This ensures the bottom navigation shows all images
      if (typeof updatePills === 'function') {
        setTimeout(() => {
          try {
            updatePills();
            console.log('[Gallery] Updated mini-stepper pills');
          } catch (e) {
            console.warn('[Gallery] Error updating pills:', e);
          }
        }, 100);
      }
      if (typeof updateActivePill === 'function') {
        setTimeout(() => {
          try {
            updateActivePill();
            console.log('[Gallery] Updated active pill');
          } catch (e) {
            console.warn('[Gallery] Error updating active pill:', e);
          }
        }, 150);
      }

      console.log('[Gallery] Added image:', normalizedData);

      // Ensure the image panel is visible when adding any image
      const imagePanel = document.getElementById('imagePanel');
      const imagePanelContent = document.getElementById('imagePanelContent');
      if (imagePanel) {
        // Remove any hidden classes
        imagePanel.classList.remove('hidden');

        // Ensure the content is also visible (not collapsed)
        if (imagePanelContent) {
          imagePanelContent.classList.remove('hidden');

          // Ensure content has proper max-height for expansion
          if (
            imagePanelContent.style.maxHeight === '0px' ||
            imagePanelContent.style.maxHeight === '0'
          ) {
            imagePanelContent.style.maxHeight = 'none';
          }
        }

        // Don't set display:block as it can interfere with drag positioning
        // The panel is visible by default; just ensure no hidden class
        // On mobile, respect the user's toggle state - don't force the panel open
        if (imagePanel.style.display === 'none' && !isMobileDevice()) {
          imagePanel.style.display = '';
        }

        // Ensure the panel is positioned within the visible viewport
        // This fixes the issue where the panel might be off-screen after drag operations
        const rect = imagePanel.getBoundingClientRect();
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;

        // Check if panel is completely off-screen or has invalid dimensions
        const isOffScreen =
          rect.right < 0 || rect.left > windowWidth || rect.bottom < 0 || rect.top > windowHeight;
        const hasInvalidSize = rect.width === 0 || rect.height === 0;

        // Also check if panel is mostly off-screen (more than 80% hidden)
        const visibleWidth = Math.max(
          0,
          Math.min(rect.right, windowWidth) - Math.max(rect.left, 0)
        );
        const visibleHeight = Math.max(
          0,
          Math.min(rect.bottom, windowHeight) - Math.max(rect.top, 0)
        );
        const visibleArea = visibleWidth * visibleHeight;
        const totalArea = rect.width * rect.height;
        const isMostlyHidden = totalArea > 0 && visibleArea / totalArea < 0.2;

        if (isOffScreen || hasInvalidSize || isMostlyHidden) {
          console.log('[Gallery] Panel is off-screen or invalid, resetting position');

          // Reset to default position (right side, vertically centered)
          imagePanel.style.position = 'fixed';
          imagePanel.style.right = '1rem';
          imagePanel.style.left = 'auto';
          imagePanel.style.top = 'clamp(1rem, 50vh - 20rem, calc(100vh - 40rem - 1rem))';
          imagePanel.style.bottom = 'auto';
          imagePanel.style.transform = '';
        }
      }
    }

    // Expose a lightweight compat hook for module-based uploads
    window.addImageToGalleryCompat = function addImageToGalleryCompat(imageData) {
      const index = imageGalleryData.length;
      addImageToGallery(imageData, index);
    };

    // Navigate to specific image
    function navigateToImage(index) {
      const imageGallery = document.getElementById('imageGallery');
      if (!imageGallery || index < 0 || index >= imageGalleryData.length) return;

      const targetThumbnail = imageGallery.querySelector(`[data-image-index="${index}"]`);
      if (targetThumbnail) {
        targetThumbnail.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'center',
        });
      }

      // Get the image data and find corresponding legacy image
      const imageData = imageGalleryData[index];
      if (
        !window.__isLoadingProject &&
        imageData &&
        imageData.original &&
        imageData.original.label
      ) {
        const label = imageData.original.label;
        console.log(`[Gallery] Switching to image with label: ${label}`);

        // Try to switch using new ProjectManager system first
        if (window.projectManager && typeof window.projectManager.switchView === 'function') {
          window.projectManager.switchView(label);
          console.log(`[Gallery] Called projectManager.switchView(${label})`);
        } else if (window.switchToImage && typeof window.switchToImage === 'function') {
          // Fallback to legacy system
          window.switchToImage(label);
          console.log(`[Gallery] Called switchToImage(${label})`);
        } else {
          console.warn('[Gallery] No image switching function available');
        }
      }

      updateActiveImage(index);

      // Update image name/type inputs to match current image
      const nameInput = document.getElementById('imageNameInput');
      const typeSelect = document.getElementById('imageTypeSelect');
      const data = imageGalleryData[index];
      if (nameInput && data) nameInput.value = data.name || '';
      if (typeSelect && data && data.original && data.original.type)
        typeSelect.value = data.original.type;
      else if (typeSelect) typeSelect.value = '';
    }

    // Reorder images in the gallery
    function reorderImages(fromIndex, toIndex) {
      console.log(`[Gallery] Reordering image from ${fromIndex} to ${toIndex}`);

      // Reorder the data array
      const movedImage = imageGalleryData.splice(fromIndex, 1)[0];
      imageGalleryData.splice(toIndex, 0, movedImage);

      // Rebuild the gallery UI
      rebuildGalleryUI();

      // Update active image index if needed
      if (currentImageIndex === fromIndex) {
        currentImageIndex = toIndex;
      } else if (currentImageIndex > fromIndex && currentImageIndex <= toIndex) {
        currentImageIndex--;
      } else if (currentImageIndex < fromIndex && currentImageIndex >= toIndex) {
        currentImageIndex++;
      }

      updateActiveImage(currentImageIndex);
    }

    // Rebuild the entire gallery UI after reordering
    function rebuildGalleryUI() {
      const imageGallery = document.getElementById('imageGallery');
      const imageDots = document.getElementById('imageDots');

      if (!imageGallery || !imageDots) return;

      // Clear existing thumbnails and dots
      imageGallery.innerHTML = '';
      imageDots.innerHTML = '';

      // Rebuild with new order
      imageGalleryData.forEach((imageData, index) => {
        // Create thumbnail
        const thumbnail = document.createElement('div');
        thumbnail.className = 'image-thumbnail';
        thumbnail.dataset.imageIndex = index;
        thumbnail.style.backgroundImage = `url(${imageData.src})`;
        thumbnail.title = imageData.name;
        thumbnail.draggable = true;

        // Add hover controls (delete only)
        const controls = createThumbnailControls(index);
        // Strip rotate/flip from controls
        controls.querySelectorAll('.rotate-btn, .flip-btn').forEach(el => el.remove());
        thumbnail.appendChild(controls);

        // Add all event listeners (click, drag, etc.)
        addThumbnailEventListeners(thumbnail, index);

        imageGallery.appendChild(thumbnail);

        // Create dot
        const dot = document.createElement('div');
        dot.className = 'nav-dot';
        dot.dataset.imageIndex = index;
        dot.addEventListener('click', () => navigateToImage(index));
        imageDots.appendChild(dot);

        // Observe for intersection
        if (intersectionObserver) {
          intersectionObserver.observe(thumbnail);
        }
      });

      updateGalleryControls();
    }

    // Create thumbnail control buttons (delete only)
    function createThumbnailControls(index) {
      const controlsContainer = document.createElement('div');

      // Delete control (separate, top-left)
      const deleteControl = document.createElement('div');
      deleteControl.className = 'delete-control';

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'control-btn delete-btn';
      deleteBtn.innerHTML = '&times;';
      deleteBtn.title = 'Delete image';
      deleteBtn.addEventListener('click', e => {
        e.stopPropagation();
        deleteImage(index);
      });

      deleteControl.appendChild(deleteBtn);
      controlsContainer.appendChild(deleteControl);

      return controlsContainer;
    }

    // Helper function to add all event listeners to a thumbnail
    function addThumbnailEventListeners(thumbnail, index) {
      // Click handler - switch to the image using ProjectManager
      thumbnail.addEventListener('click', () => {
        const imageData = imageGalleryData[index];
        if (imageData && imageData.original && imageData.original.label) {
          const label = imageData.original.label;
          console.log(`[Gallery] Thumbnail clicked, switching to label: ${label}`);

          // Use ProjectManager to switch views
          if (window.projectManager && typeof window.projectManager.switchView === 'function') {
            window.projectManager.switchView(label);
          } else {
            // Fallback to gallery navigation
            navigateToImage(index);
          }
        } else {
          // Fallback to gallery navigation if no label
          navigateToImage(index);
        }
      });

      // Drag and drop handlers
      thumbnail.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/plain', index);
        thumbnail.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });

      thumbnail.addEventListener('dragend', () => {
        thumbnail.classList.remove('dragging');
        // Clear scroll interval when drag ends
        if (window.dragScrollInterval) {
          clearInterval(window.dragScrollInterval);
          window.dragScrollInterval = null;
        }
      });

      thumbnail.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        thumbnail.classList.add('drag-over');
      });

      thumbnail.addEventListener('dragleave', () => {
        thumbnail.classList.remove('drag-over');
      });

      thumbnail.addEventListener('drop', e => {
        e.preventDefault();
        thumbnail.classList.remove('drag-over');

        // Clear scroll interval when drop happens
        if (window.dragScrollInterval) {
          clearInterval(window.dragScrollInterval);
          window.dragScrollInterval = null;
        }

        const draggedIndex = parseInt(e.dataTransfer.getData('text/plain'));
        const targetIndex = index;

        if (draggedIndex !== targetIndex) {
          reorderImages(draggedIndex, targetIndex);
        }
      });
    }

    // Delete image function
    function deleteImage(index) {
      if (confirm(`Delete "${imageGalleryData[index]?.name}"?`)) {
        console.log(`[Gallery] Deleting image at index ${index}`);

        // Remove from data array
        imageGalleryData.splice(index, 1);

        // Rebuild UI
        rebuildGalleryUI();

        // Adjust current index if needed
        if (currentImageIndex >= index) {
          currentImageIndex = Math.max(0, currentImageIndex - 1);
        }

        // Update active image
        if (imageGalleryData.length > 0) {
          updateActiveImage(Math.min(currentImageIndex, imageGalleryData.length - 1));
        }
      }
    }

    // Rotate image function
    // MIGRATED TO TYPESCRIPT - Rotation now handled by src/features/transform/controls.ts
    /*
          window.rotateImage = function rotateImage(index, degrees) {
            console.log(`[Gallery] Rotating image ${index} by ${degrees}°`);

            const imageData = imageGalleryData[index];
            if (!imageData) return;

            // Apply rotation using Canvas
            const img = new Image();
            img.onload = function () {
              const canvas = document.createElement('canvas');
              const ctx = canvas.getContext('2d');

              // Set canvas dimensions based on rotation
              if (Math.abs(degrees) === 90 || Math.abs(degrees) === 270) {
                canvas.width = img.height;
                canvas.height = img.width;
              } else {
                canvas.width = img.width;
                canvas.height = img.height;
              }

              // Rotate and draw
              ctx.translate(canvas.width / 2, canvas.height / 2);
              ctx.rotate((degrees * Math.PI) / 180);
              ctx.drawImage(img, -img.width / 2, -img.height / 2);

              // Update image data
              const newSrc = canvas.toDataURL();
              imageData.src = newSrc;

              // Update thumbnail background
              const thumbnail = document.querySelector(`[data-image-index="${index}"]`);
              if (thumbnail) {
                thumbnail.style.backgroundImage = `url(${newSrc})`;
              }

              // Update actual canvas image if this is the current image
              if (imageData.original && imageData.original.label) {
                const label = imageData.original.label;

                // Get canvas dimensions instead of raw image dimensions
                // This is critical - paint.js coordinates are relative to canvas, not original image!
                const canvas = document.getElementById('canvas');
                if (!canvas) {
                  console.error('[Transform] Canvas element not found!');
                  return;
                }

                // Use actual canvas coordinate space dimensions
                let canvasWidth = canvas.width;
                let canvasHeight = canvas.height;

                console.log(
                  `[Transform] Using canvas dimensions: ${canvasWidth}x${canvasHeight} instead of image: ${img.naturalWidth}x${img.naturalHeight}`
                );

                // Clear stored centroid if canvas dimensions changed (for screen size changes)
                if (window.originalDrawingCentroids && window.originalDrawingCentroids[label]) {
                  if (!window.lastCanvasDimensions) window.lastCanvasDimensions = {};
                  const lastDims = window.lastCanvasDimensions[label];
                  if (
                    lastDims &&
                    (lastDims.width !== canvasWidth || lastDims.height !== canvasHeight)
                  ) {
                    delete window.originalDrawingCentroids[label];
                    console.log(
                      `[Transform] Cleared stored centroid for ${label} - canvas size changed from ${lastDims.width}x${lastDims.height} to ${canvasWidth}x${canvasHeight}`
                    );
                  }
                  window.lastCanvasDimensions[label] = { width: canvasWidth, height: canvasHeight };
                }

                // For rotations, we might need to swap canvas dimensions too
                let transformWidth = canvasWidth;
                let transformHeight = canvasHeight;

                if (Math.abs(degrees) === 90 || Math.abs(degrees) === 270) {
                  // For blank canvas, keep original dimensions to rotate "in place"
                  // For real images, swap dimensions to match rotated coordinate space
                  if (imageData.original && imageData.original.isBlankCanvas) {
                    console.log(
                      `[Transform] Keeping canvas dimensions for blank canvas rotation: ${transformWidth}x${transformHeight}`
                    );
                  } else {
                    // After rotation, canvas coordinate space also changes
                    transformWidth = canvasHeight; // Width becomes height
                    transformHeight = canvasWidth; // Height becomes width
                    console.log(
                      `[Transform] Swapped canvas dimensions for rotation: ${transformWidth}x${transformHeight}`
                    );
                  }
                }

                // Transform all coordinate-based data using IMAGE dimensions (not canvas)
                // Paint.js stores coordinates in image-relative space, not canvas space
                // For blank canvas, use canvas dimensions since there's no actual image
                let rotateWidth = transformWidth;
                let rotateHeight = transformHeight;
                if (imageData.original && imageData.original.isBlankCanvas) {
                  const canvas = document.getElementById('canvas');
                  rotateWidth = canvas ? canvas.width : 800;
                  rotateHeight = canvas ? canvas.height : 800;
                  console.log(
                    `[Transform] Using canvas dimensions for blank canvas rotation: ${rotateWidth}x${rotateHeight}`
                  );
                } else {
                  rotateWidth = img.naturalWidth;
                  rotateHeight = img.naturalHeight;
                }
                transformImageData(label, 'rotate', degrees, rotateWidth, rotateHeight);
                // Update paint.js image data (skip for blank canvas as there's no actual image)
                if (!imageData.original?.isBlankCanvas) {
                  if (window.originalImages && window.originalImages[label]) {
                    window.originalImages[label] = newSrc;
                  }

                  // Update canvas if this is the currently displayed image
                  if (window.paintApp && window.paintApp.state.currentImageLabel === label) {
                    console.log(`[Gallery] Updating canvas with rotated image for ${label}`);
                    updateCanvasWithNewImage(newSrc);
                  }
                } else {
                  console.log(
                    '[Transform] Skipping image update for blank canvas - only transforming drawing data'
                  );

                  // For blank canvas, just redraw existing strokes with transformed coordinates
                  if (window.redrawCanvasWithVisibility) {
                    window.redrawCanvasWithVisibility();
                  } else if (window.drawAllStrokes) {
                    window.drawAllStrokes();
                  }
                }
              }
            }
            img.crossOrigin = 'anonymous';
            img.src = imageData.src;
          };
          */

    // Flip image function
    function flipImage(index, direction) {
      console.log(`[Gallery] Flipping image ${index} ${direction}`);

      const imageData = imageGalleryData[index];
      if (!imageData) return;

      // Apply flip using Canvas
      const img = new Image();
      img.onload = function () {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        canvas.width = img.width;
        canvas.height = img.height;

        // Apply flip transformation
        if (direction === 'horizontal') {
          ctx.scale(-1, 1);
          ctx.drawImage(img, -canvas.width, 0);
        } else if (direction === 'vertical') {
          ctx.scale(1, -1);
          ctx.drawImage(img, 0, -canvas.height);
        }

        // Update image data
        const newSrc = canvas.toDataURL();
        imageData.src = newSrc;

        // Update thumbnail background
        const thumbnail = document.querySelector(`[data-image-index="${index}"]`);
        if (thumbnail) {
          thumbnail.style.backgroundImage = `url(${newSrc})`;
        }

        // Update the actual canvas image if this is the current image
        if (imageData.original && imageData.original.label) {
          const label = imageData.original.label;

          // Get canvas dimensions for coordinate transformation
          // Paint.js coordinates are relative to canvas, not original image!
          const canvas = document.getElementById('canvas');
          if (!canvas) {
            console.error('[Transform] Canvas element not found!');
            return;
          }

          // Use actual canvas coordinate space dimensions
          const canvasWidth = canvas.width;
          const canvasHeight = canvas.height;

          console.log(
            `[Transform] Using canvas dimensions for flip: ${canvasWidth}x${canvasHeight}`
          );

          // Transform all coordinate-based data using IMAGE dimensions (not canvas)
          // Paint.js stores coordinates in image-relative space, not canvas space
          // For blank canvas, use canvas dimensions since there's no actual image
          let flipWidth, flipHeight;
          if (imageData.original && imageData.original.isBlankCanvas) {
            flipWidth = canvasWidth;
            flipHeight = canvasHeight;
            console.log(
              `[Transform] Using canvas dimensions for blank canvas flip: ${flipWidth}x${flipHeight}`
            );
          } else {
            flipWidth = img.naturalWidth;
            flipHeight = img.naturalHeight;
          }
          transformImageData(label, 'flip', direction, flipWidth, flipHeight);
          // Update the paint.js image data (skip for blank canvas as there's no actual image)
          if (!imageData.original?.isBlankCanvas) {
            if (window.originalImages && window.originalImages[label]) {
              window.originalImages[label] = newSrc;
            }

            // Update the canvas if this is the currently displayed image
            if (window.paintApp && window.paintApp.state.currentImageLabel === label) {
              console.log(`[Gallery] Updating canvas with flipped image for ${label}`);
              updateCanvasWithNewImage(newSrc);
            }
          } else {
            console.log(
              '[Transform] Skipping image update for blank canvas flip - only transforming drawing data'
            );

            // For blank canvas, just redraw the existing strokes with transformed coordinates
            if (window.redrawCanvasWithVisibility) {
              window.redrawCanvasWithVisibility();
            } else if (window.drawAllStrokes) {
              window.drawAllStrokes();
            }
          }
        }

        console.log(`[Gallery] Image ${index} flipped ${direction}`);
      };
      img.crossOrigin = 'anonymous';
      img.src = imageData.src;
    }

    // Test function to validate coordinate transformations
    function testCoordinateTransformations() {
      console.log('=== Testing Coordinate Transformations ===');

      // Get actual canvas dimensions dynamically
      const canvas = document.getElementById('canvas');
      const canvasWidth = canvas ? canvas.width : 1920;
      const canvasHeight = canvas ? canvas.height : 945;

      console.log(`[Test] Using actual canvas dimensions: ${canvasWidth}x${canvasHeight}`);

      // Test corner points that were previously going out of bounds
      const testPoints = [
        { x: 100, y: 100, label: 'top-left area' },
        { x: 1800, y: 100, label: 'top-right area' },
        { x: 100, y: 800, label: 'bottom-left area' },
        { x: 1800, y: 800, label: 'bottom-right area' },
        { x: 960, y: 472.5, label: 'center' },
      ];

      let allTestsPassed = true;

      testPoints.forEach(point => {
        console.log(`\nTesting ${point.label} at (${point.x}, ${point.y}):`);

        // Test 90° rotation
        const rotated90 = rotateCoordinates(point.x, point.y, 90, canvasWidth, canvasHeight);
        console.log(`  90° rotation: (${rotated90.x.toFixed(1)}, ${rotated90.y.toFixed(1)})`);

        // Test 180° rotation
        const rotated180 = rotateCoordinates(point.x, point.y, 180, canvasWidth, canvasHeight);
        console.log(`  180° rotation: (${rotated180.x.toFixed(1)}, ${rotated180.y.toFixed(1)})`);

        // Test horizontal flip
        const flippedH = flipCoordinates(point.x, point.y, 'horizontal', canvasWidth, canvasHeight);
        console.log(`  Horizontal flip: (${flippedH.x.toFixed(1)}, ${flippedH.y.toFixed(1)})`);

        // Test vertical flip
        const flippedV = flipCoordinates(point.x, point.y, 'vertical', canvasWidth, canvasHeight);
        console.log(`  Vertical flip: (${flippedV.x.toFixed(1)}, ${flippedV.y.toFixed(1)})`);

        // Verify all results are within bounds (for 90°: width becomes height)
        const bounds90 =
          rotated90.x >= 0 &&
          rotated90.x <= canvasHeight &&
          rotated90.y >= 0 &&
          rotated90.y <= canvasWidth;
        const bounds180 =
          rotated180.x >= 0 &&
          rotated180.x <= canvasWidth &&
          rotated180.y >= 0 &&
          rotated180.y <= canvasHeight;
        const boundsFlipH =
          flippedH.x >= 0 &&
          flippedH.x <= canvasWidth &&
          flippedH.y >= 0 &&
          flippedH.y <= canvasHeight;
        const boundsFlipV =
          flippedV.x >= 0 &&
          flippedV.x <= canvasWidth &&
          flippedV.y >= 0 &&
          flippedV.y <= canvasHeight;

        console.log(
          `  Within bounds: 90°=${bounds90}, 180°=${bounds180}, H-flip=${boundsFlipH}, V-flip=${boundsFlipV}`
        );

        if (!bounds90 || !bounds180 || !boundsFlipH || !boundsFlipV) {
          allTestsPassed = false;
          console.error(`  ❌ BOUNDARY TEST FAILED for ${point.label}`);
        }
      });

      if (allTestsPassed) {
        console.log(
          '\n✅ All coordinate transformation tests PASSED - boundary constraints working correctly'
        );
      } else {
        console.error(
          '\n❌ Some coordinate transformation tests FAILED - boundary constraints need adjustment'
        );
      }

      console.log('=== Transformation Test Complete ===');
      return allTestsPassed;
    }

    // Transform offset vectors (relative to anchor points) for rotation/flip
    // Offsets are ALWAYS rotated as pure vectors around origin (0,0) - no center logic
    function rotateOffsetVector(x, y, degrees) {
      // Pure vector rotation: O' = R(degrees) * O
      // For -90°: (x,y) → (y,-x), e.g., (-710,-427.5) → (-427.5,710)
      const radians = (degrees * Math.PI) / 180;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);

      const rotatedX = x * cos - y * sin;
      const rotatedY = x * sin + y * cos;

      console.log(
        `[Transform] Vector rotation: (${x.toFixed(1)}, ${y.toFixed(1)}) → (${rotatedX.toFixed(1)}, ${rotatedY.toFixed(1)}) by ${degrees}°`
      );

      return {
        x: rotatedX,
        y: rotatedY,
      };
    }

    function flipOffsetVector(x, y, direction) {
      if (direction === 'horizontal') {
        return { x: -x, y: y }; // Flip X offset
      } else if (direction === 'vertical') {
        return { x: x, y: -y }; // Flip Y offset
      }
      return { x, y };
    }

    // Get stroke midpoint from vector data in image space
    function getStrokeMidpointImageSpace(vectorStrokesSource, imageLabel, strokeLabel) {
      const vectorData = vectorStrokesSource[imageLabel][strokeLabel];
      if (!vectorData || !vectorData.points || vectorData.points.length === 0) {
        console.warn(`[Transform] No vector data found for stroke ${strokeLabel}`);
        return { x: 0, y: 0 };
      }

      const midpointIndex = Math.floor(vectorData.points.length / 2);
      const midpoint = vectorData.points[midpointIndex];
      return { x: midpoint.x, y: midpoint.y };
    }

    // Rotate a point around a center point
    function rotatePoint(point, center, degrees) {
      const radians = (degrees * Math.PI) / 180;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);

      const dx = point.x - center.x;
      const dy = point.y - center.y;

      return {
        x: center.x + (dx * cos - dy * sin),
        y: center.y + (dx * sin + dy * cos),
      };
    }

    // Coordinate transformation functions for image rotate/flip
    function rotateCoordinates(
      x,
      y,
      degrees,
      imageWidth,
      imageHeight,
      customCenter = null,
      keepDimensions = false
    ) {
      let centerX, centerY;

      if (customCenter) {
        centerX = customCenter.x;
        centerY = customCenter.y;
        console.log(
          `[Transform] Using drawing centroid (${centerX.toFixed(1)}, ${centerY.toFixed(1)}) for blank canvas`
        );
      } else {
        centerX = imageWidth / 2;
        centerY = imageHeight / 2;
        console.log(`[Transform] Using canvas center (${centerX}, ${centerY})`);
      }

      console.log(
        `[Transform] Rotating point (${x}, ${y}) around center (${centerX.toFixed(1)}, ${centerY.toFixed(1)}) by ${degrees}°`
      );

      // Translate to origin (relative to center)
      const translatedX = x - centerX;
      const translatedY = y - centerY;

      // Convert degrees to radians
      const radians = (degrees * Math.PI) / 180;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);

      // Apply rotation matrix
      const rotatedX = translatedX * cos - translatedY * sin;
      const rotatedY = translatedX * sin + translatedY * cos;

      // For 90° and 270° rotations, dimensions swap
      let newCenterX, newCenterY;
      if (Math.abs(degrees) === 90 || Math.abs(degrees) === 270) {
        // For blank canvas, keep the same rotation center to avoid orbital motion
        if (customCenter) {
          // Keep the drawing centroid as rotation center
          newCenterX = centerX;
          newCenterY = centerY;
          console.log(
            `[Transform] Keeping rotation center (${newCenterX.toFixed(1)}, ${newCenterY.toFixed(1)}) for blank canvas 90°/270° rotation`
          );
        } else {
          // For regular images, swap center with dimensions
          newCenterX = imageHeight / 2; // New width is old height
          newCenterY = imageWidth / 2; // New height is old width
        }
      } else {
        newCenterX = centerX;
        newCenterY = centerY;
      }

      // Translate back from new center
      let finalX = rotatedX + newCenterX;
      let finalY = rotatedY + newCenterY;

      // Get the final canvas dimensions (after potential rotation)
      let finalWidth, finalHeight;
      if (keepDimensions || !(Math.abs(degrees) === 90 || Math.abs(degrees) === 270)) {
        // Keep original dimensions for blank canvas or non-90/270 rotations
        finalWidth = imageWidth;
        finalHeight = imageHeight;
      } else {
        // Swap dimensions for regular image 90/270 rotations
        finalWidth = imageHeight;
        finalHeight = imageWidth;
      }

      // For blank canvas, skip bounds clamping to prevent shape distortion during rotation
      if (!keepDimensions) {
        // Constrain coordinates to stay within canvas bounds (0 to width-1, 0 to height-1)
        finalX = Math.max(0, Math.min(finalWidth - 1, finalX));
        finalY = Math.max(0, Math.min(finalHeight - 1, finalY));
      }

      console.log(
        `[Transform] Final coordinates: (${finalX}, ${finalY}) [bounds: ${finalWidth}x${finalHeight}]`
      );

      return {
        x: finalX,
        y: finalY,
      };
    }

    function flipCoordinates(x, y, direction, imageWidth, imageHeight) {
      let finalX = x,
        finalY = y;

      if (direction === 'horizontal') {
        finalX = imageWidth - x;
      } else if (direction === 'vertical') {
        finalY = imageHeight - y;
      }

      // Apply boundary constraints (0 to width-1, 0 to height-1)
      finalX = Math.max(0, Math.min(imageWidth - 1, finalX));
      finalY = Math.max(0, Math.min(imageHeight - 1, finalY));

      return {
        x: finalX,
        y: finalY,
      };
    }

    // Calculate the centroid (center of mass) of all drawn strokes
    function calculateDrawingCentroid(vectorStrokesByImage, imageLabel) {
      const vectorStrokes = vectorStrokesByImage[imageLabel];
      if (!vectorStrokes || Object.keys(vectorStrokes).length === 0) {
        return null;
      }

      let totalX = 0,
        totalY = 0,
        totalPoints = 0;

      Object.values(vectorStrokes).forEach(stroke => {
        if (stroke.points && stroke.points.length > 0) {
          stroke.points.forEach(point => {
            totalX += point.x;
            totalY += point.y;
            totalPoints++;
          });
        }
      });

      if (totalPoints === 0) return null;

      const centroid = {
        x: totalX / totalPoints,
        y: totalY / totalPoints,
      };

      console.log(
        `[Transform] Drawing centroid: (${centroid.x.toFixed(1)}, ${centroid.y.toFixed(1)}) from ${totalPoints} points`
      );
      return centroid;
    }

    // Transform all stroke and label data for an image
    window.transformImageData = function transformImageData(
      imageLabel,
      transformType,
      transformValue,
      imageWidth,
      imageHeight
    ) {
      console.log(`[Transform] ===== TRANSFORMING DATA =====`);
      console.log(`[Transform] Image: ${imageLabel}, Type: ${transformType} ${transformValue}`);
      console.log(`[Transform] Using IMAGE dimensions: ${imageWidth} x ${imageHeight}`);

      // Debug: Check both global state and paintApp state
      if (window.paintApp && window.paintApp.state) {
        console.log(
          `[Transform] Paint.js current image label: ${window.paintApp.state.currentImageLabel}`
        );
        console.log(
          `[Transform] Paint.js vectorStrokesByImage keys:`,
          Object.keys(window.paintApp.state.vectorStrokesByImage || {})
        );
      }

      // Debug: Check what data exists for this image label
      if (window.vectorStrokesByImage) {
        console.log(
          `[Transform] Available vectorStrokesByImage labels:`,
          Object.keys(window.vectorStrokesByImage)
        );
        if (window.vectorStrokesByImage[imageLabel]) {
          console.log(
            `[Transform] Found ${Object.keys(window.vectorStrokesByImage[imageLabel]).length} strokes for label ${imageLabel}`
          );
        } else {
          console.log(`[Transform] No strokes found for label ${imageLabel}`);
        }
      } else {
        console.log(`[Transform] Global vectorStrokesByImage is undefined!`);
      }

      // Try paint.js state if global variables are empty
      let vectorStrokesSource = window.vectorStrokesByImage;
      let labelPositionsSource = window.customLabelPositions;
      let labelOffsetsSource = window.calculatedLabelOffsets;

      console.log(
        `[DEBUG] Initial sources - vectorStrokesSource:`,
        !!vectorStrokesSource,
        'labelPositionsSource:',
        !!labelPositionsSource,
        'labelOffsetsSource:',
        !!labelOffsetsSource
      );

      if (window.paintApp && window.paintApp.state) {
        if (!vectorStrokesSource || !vectorStrokesSource[imageLabel]) {
          vectorStrokesSource = window.paintApp.state.vectorStrokesByImage;
          console.log(`[Transform] Using paint.js state vectorStrokesByImage instead`);
        }
        if (!labelPositionsSource || !labelPositionsSource[imageLabel]) {
          labelPositionsSource = window.paintApp.state.customLabelPositions;
          console.log(`[Transform] Using paint.js state customLabelPositions instead`);
        }
        if (!labelOffsetsSource || !labelOffsetsSource[imageLabel]) {
          labelOffsetsSource = window.paintApp.state.calculatedLabelOffsets;
          console.log(`[Transform] Using paint.js state calculatedLabelOffsets instead`);
        }
      }

      // Calculate the rotation center
      let rotationCenter = null;
      // Treat as blank-like when no bitmap exists for this label or label is explicitly 'blank_canvas'
      const isBlankCanvas =
        imageLabel === 'blank_canvas' ||
        !(window.originalImages && window.originalImages[imageLabel]);
      if (transformType === 'rotate' && vectorStrokesSource) {
        // For blank canvas, rotate around the actual drawing center (fallback to canvas center if no strokes)
        if (isBlankCanvas) {
          // Initialize original centroid storage if it doesn't exist
          if (!window.originalDrawingCentroids) {
            window.originalDrawingCentroids = {};
          }

          // Store the original centroid on first rotation, then reuse it
          if (!window.originalDrawingCentroids[imageLabel]) {
            window.originalDrawingCentroids[imageLabel] = calculateDrawingCentroid(
              vectorStrokesSource,
              imageLabel
            );
            console.log(
              `[Transform] Storing original drawing centroid for ${imageLabel}:`,
              window.originalDrawingCentroids[imageLabel]
            );

            // Also store the canvas dimensions when we store the centroid
            const canvas = document.getElementById('canvas');
            if (canvas) {
              if (!window.lastCanvasDimensions) window.lastCanvasDimensions = {};
              window.lastCanvasDimensions[imageLabel] = {
                width: canvas.width,
                height: canvas.height,
              };
              console.log(
                `[Transform] Stored canvas dimensions for ${imageLabel}: ${canvas.width}x${canvas.height}`
              );
            }
          }

          rotationCenter = window.originalDrawingCentroids[imageLabel] || {
            x: imageWidth / 2,
            y: imageHeight / 2,
          };
          console.log(
            `[Transform] Using stored centroid or canvas center for ${imageLabel}:`,
            rotationCenter
          );
        } else {
          // For regular images, rotate strokes around the image center to match bitmap rotation
          rotationCenter = null;
          console.log(`[Transform] Using image center for rotation of ${imageLabel}`);
        }
      }

      // Record rotation metadata for testing harness
      if (transformType === 'rotate') {
        // Determine real image label used by state (avoid 'blank_canvas' leaks)
        const realImageLabel = window.currentImageLabel || imageLabel;

        // Store rotation metadata with normalized delta and canvas coordinates
        if (!window.lastRotationMeta) window.lastRotationMeta = {};

        // For regular images (rotationCenter = null), use image center
        const centerToRecord = rotationCenter || { x: imageWidth / 2, y: imageHeight / 2 };

        window.lastRotationMeta[realImageLabel] = {
          centerCanvas: { x: centerToRecord.x, y: centerToRecord.y },
          delta: window.normalizeDelta
            ? window.normalizeDelta((transformValue * Math.PI) / 180)
            : (transformValue * Math.PI) / 180,
        };
        console.log(
          `[Transform] Recorded rotation meta for ${realImageLabel}: center=(${centerToRecord.x.toFixed(1)}, ${centerToRecord.y.toFixed(1)}), delta=${transformValue}°`
        );
      }

      // Transform vector strokes
      if (vectorStrokesSource && vectorStrokesSource[imageLabel]) {
        const vectorStrokes = vectorStrokesSource[imageLabel];
        console.log(
          `[Transform] Processing ${Object.keys(vectorStrokes).length} vector strokes:`,
          Object.keys(vectorStrokes)
        );

        Object.keys(vectorStrokes).forEach(strokeLabel => {
          const strokeData = vectorStrokes[strokeLabel];
          if (strokeData && strokeData.points) {
            console.log(`[Transform] Stroke ${strokeLabel}: ${strokeData.points.length} points`);
            console.log(`[Transform] Before:`, strokeData.points.slice(0, 2)); // Show first 2 points

            strokeData.points = strokeData.points.map(point => {
              if (transformType === 'rotate') {
                return rotateCoordinates(
                  point.x,
                  point.y,
                  transformValue,
                  imageWidth,
                  imageHeight,
                  rotationCenter,
                  isBlankCanvas
                );
              } else if (transformType === 'flip') {
                return flipCoordinates(point.x, point.y, transformValue, imageWidth, imageHeight);
              }
              return point;
            });

            console.log(`[Transform] After:`, strokeData.points.slice(0, 2)); // Show first 2 transformed points
          }
        });
        console.log(`[Transform] Updated ${Object.keys(vectorStrokes).length} vector strokes`);
      }

      // Transform custom label positions for rotations - maintain exact positioning
      // User-positioned labels should stay at the same relative position after rotation
      if (transformType === 'rotate') {
        const allCustomTransformSources = [
          window.customLabelPositions,
          window.paintApp?.state?.customLabelPositions,
        ].filter(Boolean);

        allCustomTransformSources.forEach(source => {
          if (source && source[imageLabel]) {
            console.log(`[Transform] Rotating custom label positions for ${imageLabel}`);
            Object.keys(source[imageLabel]).forEach(strokeLabel => {
              const offset = source[imageLabel][strokeLabel];
              if (offset && typeof offset.x === 'number' && typeof offset.y === 'number') {
                console.log(
                  `[Transform] Before rotation - ${strokeLabel}: (${offset.x.toFixed(1)}, ${offset.y.toFixed(1)})`
                );
                const rotated = rotateCoordinates(
                  offset.x,
                  offset.y,
                  transformValue,
                  imageWidth,
                  imageHeight,
                  rotationCenter,
                  isBlankCanvas
                );
                offset.x = rotated.x;
                offset.y = rotated.y;
                console.log(
                  `[Transform] After rotation - ${strokeLabel}: (${offset.x.toFixed(1)}, ${offset.y.toFixed(1)})`
                );
              }
            });
          }
        });
      }

      // Transform absolute tag positions for rotations - maintain exact positioning
      if (transformType === 'rotate') {
        const allAbsoluteTransformSources = [
          window.customLabelAbsolutePositions,
          window.paintApp?.state?.customLabelAbsolutePositions,
        ].filter(Boolean);

        allAbsoluteTransformSources.forEach(source => {
          if (source && source[imageLabel]) {
            console.log(`[Transform] Rotating absolute tag positions for ${imageLabel}`);
            Object.keys(source[imageLabel]).forEach(strokeLabel => {
              const absPos = source[imageLabel][strokeLabel];
              if (absPos && typeof absPos.x === 'number' && typeof absPos.y === 'number') {
                console.log(
                  `[Transform] Before rotation - ${strokeLabel} absolute: (${absPos.x.toFixed(1)}, ${absPos.y.toFixed(1)})`
                );
                const rotated = rotateCoordinates(
                  absPos.x,
                  absPos.y,
                  transformValue,
                  imageWidth,
                  imageHeight,
                  rotationCenter,
                  isBlankCanvas
                );
                absPos.x = rotated.x;
                absPos.y = rotated.y;
                console.log(
                  `[Transform] After rotation - ${strokeLabel} absolute: (${absPos.x.toFixed(1)}, ${absPos.y.toFixed(1)})`
                );
              }
            });
          }
        });
      }

      // Transform calculated label offsets using simple vector rotation
      // This maintains proper positioning during rotations without accumulating errors
      if (labelOffsetsSource && labelOffsetsSource[imageLabel] && transformType === 'rotate') {
        const labelOffsets = labelOffsetsSource[imageLabel];
        console.log(
          `[Transform] Transforming ${Object.keys(labelOffsets).length} calculated label offsets for rotation`
        );

        // Transform each label offset as a vector relative to the stroke's anchor point
        Object.keys(labelOffsets).forEach(labelKey => {
          const offset = labelOffsets[labelKey];
          if (offset && typeof offset.x === 'number' && typeof offset.y === 'number') {
            // Transform the offset vector using pure rotation (no translation)
            // Offsets are relative vectors that should rotate around origin (0,0)
            const rotatedOffset = rotateOffsetVector(offset.x, offset.y, transformValue);
            labelOffsets[labelKey] = rotatedOffset;
            console.log(
              `[Transform] Transformed label offset ${labelKey}: (${offset.x.toFixed(1)}, ${offset.y.toFixed(1)}) → (${rotatedOffset.x.toFixed(1)}, ${rotatedOffset.y.toFixed(1)})`
            );
          }
        });
        console.log(
          `[Transform] Transformed ${Object.keys(labelOffsets).length} calculated label offsets`
        );
      }

      // NEW RELATIVE POSITIONING SYSTEM: Use relative positions to recalculate absolute positions after rotation
      console.log(
        `[REL-TRANSFORM] Using relative positioning system for rotation-resistant custom labels`
      );

      if (
        transformType === 'rotate' &&
        window.customLabelRelativePositions &&
        window.customLabelRelativePositions[imageLabel]
      ) {
        const relativePositions = window.customLabelRelativePositions[imageLabel];
        const strokeLabels = Object.keys(relativePositions);
        console.log(
          `[REL-TRANSFORM] Found ${strokeLabels.length} relative positions to recalculate:`,
          strokeLabels
        );

        // Initialize absolute position storage if needed
        if (!window.customLabelPositions[imageLabel]) {
          window.customLabelPositions[imageLabel] = {};
        }

        let updatedPositions = 0;
        strokeLabels.forEach(strokeLabel => {
          const relativePos = relativePositions[strokeLabel];
          if (
            relativePos &&
            typeof relativePos.percentageAlongLine === 'number' &&
            typeof relativePos.perpendicularDistance === 'number'
          ) {
            // Recalculate absolute position from relative position after stroke rotation
            const newAbsoluteOffset = window.convertRelativeToAbsolutePosition(
              strokeLabel,
              relativePos,
              imageLabel
            );
            if (newAbsoluteOffset) {
              window.customLabelPositions[imageLabel][strokeLabel] = newAbsoluteOffset;
              updatedPositions++;
              console.log(
                `[REL-TRANSFORM] Recalculated ${strokeLabel}: ${(relativePos.percentageAlongLine * 100).toFixed(1)}% + ${relativePos.perpendicularDistance.toFixed(1)}px → (${newAbsoluteOffset.x.toFixed(1)}, ${newAbsoluteOffset.y.toFixed(1)})`
              );
            } else {
              console.warn(`[REL-TRANSFORM] Failed to recalculate position for ${strokeLabel}`);
            }
          }
        });

        console.log(
          `[REL-TRANSFORM] Successfully recalculated ${updatedPositions}/${strokeLabels.length} custom positions using relative positioning`
        );
      } else {
        console.log(
          `[REL-TRANSFORM] No relative positions found for ${imageLabel} or not a rotation transform`
        );

        // Fallback: Clear absolute positions for non-rotation transforms to force recalculation
        if (
          transformType !== 'rotate' &&
          window.customLabelPositions &&
          window.customLabelPositions[imageLabel]
        ) {
          const customPositions = window.customLabelPositions[imageLabel];
          const strokeLabels = Object.keys(customPositions);
          console.log(
            `[REL-TRANSFORM] Clearing ${strokeLabels.length} absolute custom positions for ${transformType} - will be recalculated`
          );

          strokeLabels.forEach(strokeLabel => {
            delete customPositions[strokeLabel];
          });
        }
      }

      if (transformType !== 'rotate' && labelOffsetsSource && labelOffsetsSource[imageLabel]) {
        // For non-rotation transforms (flip), clear offsets to force recalculation
        const labelOffsets = labelOffsetsSource[imageLabel];
        console.log(
          `[Transform] Clearing ${Object.keys(labelOffsets).length} calculated label offsets for ${transformType}`
        );

        Object.keys(labelOffsets).forEach(labelKey => {
          delete labelOffsets[labelKey];
        });
        console.log(
          `[Transform] Cleared calculated label offsets - will be recalculated on next draw`
        );
      }

      // Update image dimensions if rotating by 90/270 degrees
      // Skip dimension swapping for blank-like images (no real bitmap to swap)
      if (
        transformType === 'rotate' &&
        (Math.abs(transformValue) === 90 || Math.abs(transformValue) === 270)
      ) {
        // Treat as blank-like when no bitmap exists for this label or label is explicitly 'blank_canvas'
        const isBlankCanvas =
          imageLabel === 'blank_canvas' ||
          !(window.originalImages && window.originalImages[imageLabel]);

        if (
          !isBlankCanvas &&
          window.originalImageDimensions &&
          window.originalImageDimensions[imageLabel]
        ) {
          const dims = window.originalImageDimensions[imageLabel];
          window.originalImageDimensions[imageLabel] = {
            width: dims.height,
            height: dims.width,
          };
          console.log(
            `[Transform] Swapped image dimensions: ${dims.width}x${dims.height} → ${dims.height}x${dims.width}`
          );
        } else if (isBlankCanvas) {
          console.log(`[Transform] Skipping dimension swap for blank-like canvas (${imageLabel})`);
        }
      }

      // Update rotation stamps and cumulative rotation for custom labels persistence
      if (transformType === 'rotate') {
        // 1) Determine real image label used by state (avoid 'blank_canvas' leaks)
        const img = window.currentImageLabel || imageLabel;

        // 2) Rotation delta already known (transformValue in degrees); normalize it in radians
        const deltaRadians = (transformValue * Math.PI) / 180;
        const normalizedDelta = window.normalizeDelta
          ? window.normalizeDelta(deltaRadians)
          : deltaRadians;

        // 3) Update per-stroke rotation stamps for custom offsets
        if (!window.customLabelOffsetsRotationByImageAndStroke) {
          window.customLabelOffsetsRotationByImageAndStroke = {};
        }
        if (!window.customLabelOffsetsRotationByImageAndStroke[img]) {
          window.customLabelOffsetsRotationByImageAndStroke[img] = {};
        }

        // Update stamps for all strokes that have custom offsets
        if (window.customLabelPositions && window.customLabelPositions[img]) {
          Object.keys(window.customLabelPositions[img]).forEach(stroke => {
            const lastStamp = window.customLabelOffsetsRotationByImageAndStroke[img][stroke] || 0;
            const newStamp = window.normalizeDelta
              ? window.normalizeDelta(lastStamp + normalizedDelta)
              : lastStamp + normalizedDelta;
            window.customLabelOffsetsRotationByImageAndStroke[img][stroke] = newStamp;
          });
        }

        // 4) Advance image cumulative rotation so future sync math remains aligned
        if (!window.imageRotationByLabel) {
          window.imageRotationByLabel = {};
        }
        const currentRotation = window.imageRotationByLabel[img] || 0;
        window.imageRotationByLabel[img] = window.normalizeDelta
          ? window.normalizeDelta(currentRotation + normalizedDelta)
          : currentRotation + normalizedDelta;

        console.log(
          `[Transform] Updated rotation state for ${img}: delta=${transformValue}°, cumulative=${((window.imageRotationByLabel[img] * 180) / Math.PI).toFixed(1)}°`
        );
      }
    };

    // Helper function to update canvas with new image data
    function updateCanvasWithNewImage(newImageSrc) {
      try {
        const img = new Image();
        img.onload = function () {
          const canvas = document.getElementById('canvas');
          if (canvas) {
            const ctx = canvas.getContext('2d');

            console.log(
              `[Canvas] Updating canvas (${canvas.width}x${canvas.height}) with new image (${img.width}x${img.height})`
            );

            // Clear canvas
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Get current scale and position from paint.js
            const currentLabel =
              window.paintApp?.state?.currentImageLabel || window.currentImageLabel;
            const scale = window.imageScaleByLabel?.[currentLabel] || 1.0;
            const position = window.imagePositionByLabel?.[currentLabel] || { x: 0, y: 0 };

            console.log(`[Canvas] Using scale: ${scale}, position: (${position.x}, ${position.y})`);

            // Calculate scaled dimensions and positioning
            const scaledWidth = img.width * scale;
            const scaledHeight = img.height * scale;
            const x = (canvas.width - scaledWidth) / 2 + position.x;
            const y = (canvas.height - scaledHeight) / 2 + position.y;

            // Draw image with proper scaling and positioning
            ctx.drawImage(img, x, y, scaledWidth, scaledHeight);

            // Trigger paint.js to redraw strokes if available
            if (window.redrawCanvasWithVisibility) {
              window.redrawCanvasWithVisibility();
            } else if (window.drawAllStrokes) {
              window.drawAllStrokes();
            }

            console.log('[Gallery] Canvas updated with new image using paint.js scale/position');
          }
        };
        img.crossOrigin = 'anonymous';
        img.src = newImageSrc;
      } catch (error) {
        console.error('[Gallery] Error updating canvas:', error);
      }
    }

    // Update active image highlighting
    function updateActiveImage(index) {
      currentImageIndex = index;

      // Update thumbnail highlighting
      document.querySelectorAll('.image-thumbnail').forEach((thumb, idx) => {
        thumb.classList.toggle('active', idx === index);
      });

      // Update navigation dots
      document.querySelectorAll('.nav-dot').forEach((dot, idx) => {
        dot.classList.toggle('active', idx === index);
      });

      // Sync inputs to current image
      const data = imageGalleryData[index];
      const nameEl = document.getElementById('imageNameInput');
      const typeEl = document.getElementById('imageTypeSelect');
      if (nameEl && data) nameEl.value = data.name || '';
      if (typeEl && data && data.original) typeEl.value = data.original.type || '';

      updateGalleryControls();
    }

    // Update gallery controls and counters
    function updateGalleryControls() {
      const prevButton = document.getElementById('prevImage');
      const nextButton = document.getElementById('nextImage');
      const imagePosition = document.getElementById('imagePosition');
      const imageCounter = document.getElementById('imageCounter');

      const totalImages = imageGalleryData.length;

      if (prevButton && nextButton) {
        prevButton.disabled = currentImageIndex <= 0;
        nextButton.disabled = currentImageIndex >= totalImages - 1;
      }

      if (imagePosition) {
        imagePosition.textContent = `${currentImageIndex + 1} / ${totalImages}`;
      }

      if (imageCounter) {
        imageCounter.textContent = totalImages > 0 ? `${totalImages} images` : '';
      }
    }

    // Clear image gallery
    function clearImageGallery() {
      const imageGallery = document.getElementById('imageGallery');
      const imageDots = document.getElementById('imageDots');

      if (imageGallery) imageGallery.innerHTML = '';
      if (imageDots) imageDots.innerHTML = '';

      imageGalleryData = [];
      currentImageIndex = 0;
      updateGalleryControls();
    }

    // Initialize gallery on page load
    initializeImageGallery();

    // Reveal UI once initialization is complete
    document.documentElement.classList.remove('app-loading');

    // Toolbar visibility is handled by CSS via toolbar-ready class
    // No need to set inline styles here

    // Store reference to original addImageToSidebar if it exists
    const originalAddImageToSidebar = window.addImageToSidebar;

    function ensureLegacyImageContainer(imageUrl, label) {
      const imageList = document.getElementById('imageList');
      if (!imageList) {
        console.error('[COMPAT] imageList element not found!');
        return false;
      }
      if (!imageUrl || !label) {
        console.warn('[COMPAT] Missing imageUrl or label for legacy container');
        return false;
      }

      const existing = imageList.querySelector(`[data-label="${label}"]`);
      if (existing) return true;

      const container = document.createElement('button');
      container.type = 'button';
      container.draggable = true;
      container.className =
        'image-container group w-full text-left relative flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 transition-colors snap-center';
      container.dataset.label = label;
      container.dataset.originalImageUrl = imageUrl;

      const img = document.createElement('img');
      img.src = imageUrl;
      img.className = 'pasted-image w-full h-40 rounded-lg object-contain bg-slate-100 shadow-sm';
      img.alt = `${label} view`;

      container.appendChild(img);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'delete-image-btn opacity-0 group-hover:opacity-100 transition-opacity';
      deleteBtn.title = 'Delete image';
      deleteBtn.textContent = '×';
      deleteBtn.style.cssText =
        'position: absolute; top: 6px; right: 6px; cursor: pointer; background: rgba(255, 255, 255, 0.9); border: 1px solid rgb(204, 204, 204); border-radius: 50%; width: 20px; height: 20px; font-size: 12px; font-weight: bold; font-family: Arial, sans-serif; display: flex; align-items: center; justify-content: center; z-index: 10; color: rgb(102, 102, 102); line-height: 1; padding: 0px; margin: 0px; text-align: center;';

      deleteBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (confirm('Delete this image?')) {
          container.remove();
          if (window.projectManager && typeof window.projectManager.deleteImage === 'function') {
            window.projectManager.deleteImage(label);
          }
          if (typeof updatePills === 'function') updatePills();
          if (typeof updateActivePill === 'function') updateActivePill();
          if (typeof updateImageListPadding === 'function') updateImageListPadding();
        }
      });

      container.appendChild(deleteBtn);

      container.onclick = () => {
        if (window.projectManager && typeof window.projectManager.switchView === 'function') {
          window.projectManager.switchView(label);
        }
        container.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
          inline: 'center',
        });
        window.__imageListProgrammaticScrollUntil = Date.now() + 500;
      };

      imageList.appendChild(container);
      console.log(`[COMPAT] Manually added legacy container for "${label}"`);

      if (typeof window.ensureImageListObserver === 'function') {
        window.ensureImageListObserver();
      } else {
        window.__pendingImageListObserverInit = true;
      }
      if (typeof updateImageListPadding === 'function') updateImageListPadding();
      if (typeof initImageListCenteringObserver === 'function') {
        if (!window.__imageListCenteringObserver) initImageListCenteringObserver();
        if (window.__imageListCenteringObserver) {
          window.__imageListCenteringObserver.observe(container);
        }
      }

      setTimeout(() => {
        const allContainers = Array.from(imageList.querySelectorAll('.image-container'));
        const isFirst = allContainers.length === 1 && allContainers[0] === container;
        if (isFirst) {
          console.log(`[COMPAT] First image "${label}" added, centering and switching to it`);
          window.__suppressScrollSelectUntil = Date.now() + 1200;
          window.__imageListProgrammaticScrollUntil = Date.now() + 1000;
          container.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
          if (window.projectManager && typeof window.projectManager.switchView === 'function') {
            window.projectManager.switchView(label);
          }
        }
        if (typeof updatePills === 'function') updatePills();
        if (typeof updateActivePill === 'function') updateActivePill();
      }, 100);

      return true;
    }

    // Enhanced compatibility function that works with both new and old formats
    // NOTE: This is replaced by the [HOOK] wrapper when paint.js loads
    window.addImageToSidebar = function (imageUrl, label, filename) {
      console.log('[COMPAT] addImageToSidebar called with:', {
        imageUrl: imageUrl?.substring?.(0, 50) || imageUrl,
        label,
        filename,
      });

      // Call original function first if it exists (for backwards compatibility)
      let didCallOriginal = false;
      if (originalAddImageToSidebar && typeof originalAddImageToSidebar === 'function') {
        try {
          originalAddImageToSidebar.apply(this, arguments);
          didCallOriginal = true;

          // Verify imageList was updated
          const imageList = document.getElementById('imageList');
          if (imageList) {
            const containers = imageList.querySelectorAll('.image-container');
            console.log(
              `[COMPAT] imageList has ${containers.length} containers after original function`
            );
          }
        } catch (error) {
          console.warn('[COMPAT] Original addImageToSidebar failed:', error);
        }
      } else {
        console.warn('[COMPAT] No original addImageToSidebar function available');
      }

      if (!didCallOriginal) {
        ensureLegacyImageContainer(imageUrl, label);
      }

      // Ensure legacy originalImages mapping stays in sync
      if (label && imageUrl) {
        window.originalImages = window.originalImages || {};
        window.originalImages[label] = imageUrl;

        if (!window.originalImageDimensions) {
          window.originalImageDimensions = {};
        }
        if (!window.originalImageDimensions[label]) {
          const dimImg = new Image();
          dimImg.onload = () => {
            window.originalImageDimensions[label] = {
              width: dimImg.width,
              height: dimImg.height,
            };
          };
          dimImg.onerror = () => {
            window.originalImageDimensions[label] = { width: 0, height: 0 };
          };
          dimImg.src = imageUrl;
        }

        if (
          window.projectManager &&
          window.projectManager.views &&
          window.projectManager.views[label]
        ) {
          window.projectManager.views[label].image = imageUrl;
        }
      }

      // Add to new gallery (avoid duplicates if UploadManager already did)
      if (imageUrl) {
        const alreadyExists = imageGalleryData.some(
          img =>
            img &&
            img.src === imageUrl &&
            (img.original?.label === label ||
              img.name === filename ||
              img.name === label ||
              img.original?.filename === filename)
        );

        if (!alreadyExists) {
          const index = imageGalleryData.length;
          const imageData = {
            src: imageUrl,
            url: imageUrl,
            name: filename || label || `Image ${index + 1}`,
            label: label,
            filename: filename,
          };

          addImageToGallery(imageData, index);
          console.log(
            '[COMPAT] Added to new gallery at index',
            index,
            'Total images now:',
            imageGalleryData.length
          );
          if (
            label &&
            window.projectManager &&
            window.projectManager.currentViewId === label &&
            typeof window.projectManager.setBackgroundImage === 'function'
          ) {
            requestAnimationFrame(() => {
              window.projectManager.setBackgroundImage(imageUrl);
              console.log('[COMPAT] Refreshed background for active view:', label);
            });
          }
          if (
            imageGalleryData.length === 1 &&
            label &&
            window.projectManager &&
            typeof window.projectManager.switchView === 'function' &&
            !window.__isLoadingProject
          ) {
            setTimeout(() => {
              window.__suppressScrollSelectUntil = Date.now() + 1200;
              window.projectManager.switchView(label, true);
              console.log('[COMPAT] Forced switch to first image:', label);
            }, 0);
          }
          return index;
        }
        console.log('[COMPAT] Gallery already has image for label:', label);
        return -1;
      } else {
        console.warn('[COMPAT] No valid imageUrl provided');
        return -1;
      }
    };
    window.addImageToSidebar.__isCompat = true;

    window.switchToImage = function (imageIndexOrLabel) {
      // If it's a number, treat as gallery index
      if (typeof imageIndexOrLabel === 'number') {
        navigateToImage(imageIndexOrLabel);
        console.log('[COMPAT] Switched to image index:', imageIndexOrLabel);
        return;
      }

      if (typeof imageIndexOrLabel === 'string') {
        const trimmed = imageIndexOrLabel.trim();
        const asNumber = Number(trimmed);
        if (trimmed !== '' && Number.isFinite(asNumber)) {
          const index = Math.trunc(asNumber);
          navigateToImage(index);
          console.log('[COMPAT] Switched to image index (string):', index);
          return;
        }

        const label = trimmed;
        console.log('[COMPAT] Switched to image label:', label);

        // Try ProjectManager first
        if (window.projectManager && typeof window.projectManager.switchView === 'function') {
          window.projectManager.switchView(label);
        }
        // Fallback to legacy system
        else if (window.switchToImageLegacy && typeof window.switchToImageLegacy === 'function') {
          window.switchToImageLegacy(label);
        } else {
          console.warn('[COMPAT] No switchToImage implementation available');
        }
      }
    };

    // Legacy image list compatibility
    window.updateImageList = function () {
      // This function exists for compatibility but the new gallery handles updates automatically
      console.log('[COMPAT] updateImageList called - handled by new gallery system');
    };

    // Clear images function
    window.clearImageSidebar = function () {
      clearImageGallery();
      console.log('[COMPAT] Cleared image sidebar');
    };

    console.log('[INIT] Image gallery and compatibility functions initialized');

    // Setup container-level drag auto-scroll
    const imageListContainer = document.getElementById('imageList');
    if (imageListContainer) {
      imageListContainer.addEventListener('dragover', e => {
        const rect = imageListContainer.getBoundingClientRect();
        const scrollThreshold = 80; // Distance from edge to trigger scroll
        const scrollSpeed = 10; // Pixels per scroll
        const mouseY = e.clientY;

        // Clear any existing scroll interval
        if (window.dragScrollInterval) {
          clearInterval(window.dragScrollInterval);
          window.dragScrollInterval = null;
        }

        // Check if near top edge
        if (mouseY - rect.top < scrollThreshold && mouseY > rect.top) {
          let scrolling = true;
          const scroll = () => {
            if (!scrolling) return;
            imageListContainer.scrollBy(0, -scrollSpeed);
            window.dragScrollFrame = requestAnimationFrame(scroll);
          };
          scrolling = true;
          window.dragScrollFrame = requestAnimationFrame(scroll);
        }
        // Check if near bottom edge
        else if (rect.bottom - mouseY < scrollThreshold && mouseY < rect.bottom) {
          let scrolling = true;
          const scroll = () => {
            if (!scrolling) return;
            imageListContainer.scrollBy(0, scrollSpeed);
            window.dragScrollFrame = requestAnimationFrame(scroll);
          };
          scrolling = true;
          window.dragScrollFrame = requestAnimationFrame(scroll);
        }
      });

      // Clear scroll animation when drag ends anywhere
      const stopScrolling = () => {
        if (window.dragScrollInterval) {
          clearInterval(window.dragScrollInterval);
          window.dragScrollInterval = null;
        }
        if (window.dragScrollFrame) {
          cancelAnimationFrame(window.dragScrollFrame);
          window.dragScrollFrame = null;
        }
      };

      imageListContainer.addEventListener('drop', stopScrolling);

      imageListContainer.addEventListener('dragleave', e => {
        // Only clear if leaving the container entirely
        if (e.target === imageListContainer) {
          stopScrolling();
        }
      });
    }

    // Debug function to inspect paint.js state
    window.debugPaintState = function () {
      console.log('=== PAINT.JS STATE DEBUG ===');

      if (window.paintApp && window.paintApp.state) {
        console.log('Current image label:', window.paintApp.state.currentImageLabel);
        console.log('Paint app state keys:', Object.keys(window.paintApp.state));
      }

      if (window.vectorStrokesByImage) {
        const labels = Object.keys(window.vectorStrokesByImage);
        console.log('vectorStrokesByImage labels:', labels);
        labels.forEach(label => {
          const strokes = window.vectorStrokesByImage[label];
          console.log(`  ${label}: ${Object.keys(strokes || {}).length} strokes`);
        });
      } else {
        console.log('vectorStrokesByImage not found');
      }

      if (window.customLabelPositions) {
        const labels = Object.keys(window.customLabelPositions);
        console.log('customLabelPositions labels:', labels);
      } else {
        console.log('customLabelPositions not found');
      }

      console.log('imageGalleryData length:', imageGalleryData.length);
      console.log('currentImageIndex:', currentImageIndex);
      if (imageGalleryData[currentImageIndex]) {
        console.log(
          'Current image:',
          imageGalleryData[currentImageIndex].name,
          imageGalleryData[currentImageIndex].original?.label
        );
        console.log(
          'Full current image data:',
          JSON.stringify(imageGalleryData[currentImageIndex], null, 2)
        );
      }

      // Also debug all gallery images
      console.log('All gallery images:');
      imageGalleryData.forEach((img, index) => {
        console.log(
          `  [${index}] ${img.name}: label=${img.original?.label}, isBlankCanvas=${img.original?.isBlankCanvas}`
        );
      });
    };

    // Test function to add mock drawing data for blank canvas
    window.addTestTriangle = function () {
      // Try to get the actual current image label from gallery
      let targetLabel = 'blank_canvas'; // fallback
      if (imageGalleryData[currentImageIndex]?.original?.label) {
        targetLabel = imageGalleryData[currentImageIndex].original.label;
      }
      const paintLabel = window.paintApp?.state?.currentImageLabel;

      console.log(`[Test] Gallery current index: ${currentImageIndex}`);
      console.log(`[Test] Gallery target label: ${targetLabel}`);
      console.log(`[Test] Paint.js current label: ${paintLabel}`);
      console.log(`[Test] Adding test triangle to label: ${targetLabel}`);

      // Mock stroke data for a simple triangle
      const mockStroke = {
        points: [
          { x: 300, y: 200 }, // Top point
          { x: 200, y: 400 }, // Bottom left
          { x: 400, y: 400 }, // Bottom right
          { x: 300, y: 200 }, // Back to top
        ],
        color: '#ff0000',
        thickness: 3,
        type: 'freehand',
      };

      // Add to both global and paint.js state
      if (window.vectorStrokesByImage) {
        if (!window.vectorStrokesByImage[targetLabel]) {
          window.vectorStrokesByImage[targetLabel] = {};
        }
        window.vectorStrokesByImage[targetLabel]['test_triangle'] = mockStroke;
      }

      if (window.paintApp?.state?.vectorStrokesByImage) {
        if (!window.paintApp.state.vectorStrokesByImage[targetLabel]) {
          window.paintApp.state.vectorStrokesByImage[targetLabel] = {};
        }
        window.paintApp.state.vectorStrokesByImage[targetLabel]['test_triangle'] = mockStroke;
      }

      // Also switch paint.js to the correct label if it's not already there
      if (paintLabel !== targetLabel && window.switchToImage) {
        console.log(`[Test] Switching paint.js from '${paintLabel}' to '${targetLabel}'`);
        window.switchToImage(targetLabel);
      }

      console.log(`[Test] Added test triangle. Use debugPaintState() to verify.`);

      // Redraw if function exists
      if (window.redrawCanvasWithVisibility) {
        window.redrawCanvasWithVisibility();
      }
    };

    // Note: Stored centroid system removed - blank canvas now uses fixed canvas center

    // Test function to try rotating current image
    // MIGRATED TO TYPESCRIPT - Rotation now handled by src/features/transform/controls.ts
    /*
          window.testRotate = function () {
            console.log(`[Test] Testing rotation on current image (index ${currentImageIndex})`);
            if (currentImageIndex >= 0 && currentImageIndex < imageGalleryData.length) {
              const imageData = imageGalleryData[currentImageIndex];
              console.log(`[Test] Rotating image: ${imageData.name}`);
              rotateImage(currentImageIndex, 90);
            } else {
              console.log(`[Test] Invalid image index: ${currentImageIndex}`);
            }
          };
          */

    // Hook into addImageToSidebar after external scripts load
    let hookAttempts = 0;
    const maxHookAttempts = 200;

    function attemptHook() {
      hookAttempts++;

      // Check if paint.js has loaded and defined its own addImageToSidebar
      if (window.addImageToSidebar && typeof window.addImageToSidebar === 'function') {
        if (window.addImageToSidebar.__isCompat) {
          if (window.__DEBUG__)
            console.log('[HOOK] Compat addImageToSidebar detected, waiting for paint.js...');
          setTimeout(attemptHook, 100);
          return false;
        }
        if (window.addImageToSidebar.__galleryHooked) {
          return true;
        }

        console.log('[HOOK] Found original addImageToSidebar from paint.js, hooking into it...');
        console.log(
          '[HOOK] Function source preview:',
          window.addImageToSidebar.toString().substring(0, 200)
        );

        // Store the original function
        const paintJsAddImageToSidebar = window.addImageToSidebar;

        // Create our intercepting function
        window.addImageToSidebar = function (imageUrl, label, filename) {
          console.log('[HOOK] Intercepted addImageToSidebar call:', {
            imageUrl: imageUrl?.substring?.(0, 50) || imageUrl,
            label,
            filename,
          });

          // Ensure imageList exists before calling original function
          const imageList = document.getElementById('imageList');
          if (!imageList) {
            console.error('[HOOK] imageList element not found!');
          }

          // Call the original paint.js function
          let result;
          try {
            result = paintJsAddImageToSidebar.apply(this, arguments);

            // Verify the container was added for this specific label
            const imageListAfter = document.getElementById('imageList');
            if (imageListAfter) {
              const containers = imageListAfter.querySelectorAll('.image-container');
              const containerForLabel = imageListAfter.querySelector(`[data-label="${label}"]`);
              console.log(
                `[HOOK] imageList now has ${containers.length} containers after addImageToSidebar`
              );

              // If no container exists for this label, create one manually
              if (!containerForLabel && imageUrl && label) {
                console.warn(
                  `[HOOK] No container found for label "${label}", creating one manually`
                );
                const container = document.createElement('button');
                container.type = 'button';
                container.draggable = true;
                container.className =
                  'image-container group w-full text-left relative flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 transition-colors snap-center';
                container.dataset.label = label;
                container.dataset.originalImageUrl = imageUrl;

                const img = document.createElement('img');
                img.src = imageUrl;
                img.className =
                  'pasted-image w-full h-40 rounded-lg object-contain bg-slate-100 shadow-sm';
                img.alt = `${label} view`;

                container.appendChild(img);

                // Add delete button
                const deleteBtn = document.createElement('button');
                deleteBtn.className =
                  'delete-image-btn opacity-0 group-hover:opacity-100 transition-opacity';
                deleteBtn.title = 'Delete image';
                deleteBtn.textContent = '×';
                // Inline styles to match reference
                deleteBtn.style.cssText =
                  'position: absolute; top: 6px; right: 6px; cursor: pointer; background: rgba(255, 255, 255, 0.9); border: 1px solid rgb(204, 204, 204); border-radius: 50%; width: 20px; height: 20px; font-size: 12px; font-weight: bold; font-family: Arial, sans-serif; display: flex; align-items: center; justify-content: center; z-index: 10; color: rgb(102, 102, 102); line-height: 1; padding: 0px; margin: 0px; text-align: center;';

                deleteBtn.addEventListener('click', e => {
                  e.stopPropagation();
                  if (confirm('Delete this image?')) {
                    container.remove();
                    if (
                      window.projectManager &&
                      typeof window.projectManager.deleteImage === 'function'
                    ) {
                      window.projectManager.deleteImage(label);
                    }

                    // Update pills
                    if (typeof updatePills === 'function') updatePills();
                    if (typeof updateActivePill === 'function') updateActivePill();
                    if (typeof updateImageListPadding === 'function') updateImageListPadding();
                  }
                });

                container.appendChild(deleteBtn);

                container.onclick = () => {
                  if (
                    window.projectManager &&
                    typeof window.projectManager.switchView === 'function'
                  ) {
                    window.projectManager.switchView(label);
                  }
                  // Scroll this container to center
                  container.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center',
                    inline: 'center',
                  });

                  // Temporarily disable scroll-driven switching to prevent fighting
                  window.__imageListProgrammaticScrollUntil = Date.now() + 500;
                };

                imageListAfter.appendChild(container);
                console.log(`[HOOK] Manually added container to imageList for label "${label}"`);

                if (typeof window.ensureImageListObserver === 'function') {
                  window.ensureImageListObserver();
                } else {
                  window.__pendingImageListObserverInit = true;
                }

                if (typeof updateImageListPadding === 'function') {
                  updateImageListPadding();
                }

                // Initialize observer if not already done, or observe this new container
                if (typeof initImageListCenteringObserver === 'function') {
                  // Initialize observer if it doesn't exist yet
                  if (!window.__imageListCenteringObserver) {
                    initImageListCenteringObserver();
                  }
                  // Observer will automatically pick up new containers via MutationObserver
                  // But we can also explicitly observe this one immediately
                  if (window.__imageListCenteringObserver) {
                    window.__imageListCenteringObserver.observe(container);
                  }
                }

                // Center the newly added image and switch to it if it's the first image
                setTimeout(() => {
                  const allContainers = Array.from(
                    imageListAfter.querySelectorAll('.image-container')
                  );
                  const isFirst = allContainers.length === 1 && allContainers[0] === container;

                  if (isFirst) {
                    console.log(
                      `[HOOK] First image "${label}" added, centering and switching to it`
                    );

                    // Center the container
                    window.__imageListProgrammaticScrollUntil = Date.now() + 1000;
                    container.scrollIntoView({
                      behavior: 'smooth',
                      block: 'center',
                      inline: 'center',
                    });

                    // Switch to this view
                    if (
                      window.projectManager &&
                      typeof window.projectManager.switchView === 'function'
                    ) {
                      window.projectManager.switchView(label);
                    }
                  }

                  // Trigger mini-stepper update after adding to sidebar
                  if (typeof updatePills === 'function') {
                    updatePills();
                  }
                  if (typeof updateActivePill === 'function') {
                    updateActivePill();
                  }
                }, 100);
              } else if (containerForLabel) {
                console.log(`[HOOK] Container for label "${label}" already exists in imageList`);

                // Update pills only, don't switch views for existing containers
                setTimeout(() => {
                  if (typeof updatePills === 'function') {
                    updatePills();
                  }
                  if (typeof updateActivePill === 'function') {
                    updateActivePill();
                  }
                }, 100);

                if (typeof updateImageListPadding === 'function') {
                  updateImageListPadding();
                }
              }
            } else if (!imageListAfter) {
              console.error('[HOOK] imageList element not found after addImageToSidebar call!');
            }
          } catch (error) {
            console.error('[HOOK] Error calling original addImageToSidebar:', error);
            // Don't throw - try to continue with gallery addition
          }

          // Add to our new gallery
          if (imageUrl) {
            const index = imageGalleryData.length;
            const imageData = {
              src: imageUrl,
              url: imageUrl,
              name: filename || label || `Image ${index + 1}`,
              label: label,
              filename: filename,
            };

            addImageToGallery(imageData, index);
            console.log('[HOOK] Added to new gallery at index', index);

            // Register with Fabric.js ProjectManager to set background image
            if (window.app && window.app.projectManager) {
              const pm = window.app.projectManager;
              // Use full label (e.g., 'front_1') as the view ID to support multiple images
              const viewId = label;
              console.log(
                '[HOOK] Registering image with ProjectManager:',
                viewId,
                imageUrl.substring(0, 50)
              );
              pm.addImage(viewId, imageUrl, { refreshBackground: false }); // Don't auto-refresh, let switchView handle it
            }
          }

          return result;
        };

        window.addImageToSidebar.__galleryHooked = true;
        console.log('[HOOK] Successfully hooked addImageToSidebar');
        return true;
      } else if (hookAttempts < maxHookAttempts) {
        if (window.__DEBUG__)
          console.log(
            '[HOOK] Attempt',
            hookAttempts,
            '- addImageToSidebar not ready yet:',
            typeof window.addImageToSidebar
          );
        setTimeout(attemptHook, 100);
      } else {
        if (window.__DEBUG__)
          console.warn('[HOOK] Max attempts reached, could not hook addImageToSidebar');
        console.warn(
          '[HOOK] Final state - addImageToSidebar:',
          typeof window.addImageToSidebar,
          window.addImageToSidebar ? 'exists' : 'undefined'
        );
      }
    }

    // Start attempting to hook after a short delay
    setTimeout(attemptHook, 500);

    // Function to sync existing legacy images to new gallery
    function syncLegacyImagesToGallery() {
      const imageList = document.getElementById('imageList');
      if (!imageList) {
        console.log('[SYNC] ERROR: No imageList element found');
        return;
      }

      const imageContainers = imageList.querySelectorAll('.image-container');
      console.log(`[SYNC] Processing ${imageContainers.length} legacy images`);

      let newImagesAdded = 0;

      imageContainers.forEach((container, index) => {
        const img = container.querySelector('img');
        const labelDiv = container.querySelector('.image-label');
        const label = container.dataset.label;

        if (img && img.src) {
          const imageData = {
            src: img.src,
            url: img.src,
            name: labelDiv ? labelDiv.textContent : label || `Image ${index + 1}`,
            label: label,
            filename: labelDiv ? labelDiv.textContent : undefined,
          };

          // Check if this image is already in the gallery
          const existingIndex = imageGalleryData.findIndex(item => item.src === img.src);

          if (existingIndex === -1) {
            addImageToGallery(imageData, imageGalleryData.length);
            console.log(`[SYNC] ✓ Added: ${imageData.name}`);
            newImagesAdded++;
          }
        }
      });

      if (newImagesAdded > 0) {
        console.log(`[SYNC] Added ${newImagesAdded} new images. Total: ${imageGalleryData.length}`);
      }

      if (typeof updateImageListPadding === 'function') {
        updateImageListPadding();
      }
    }

    // Function to clear demo images
    function clearDemoImages() {
      console.log('[DEMO] Clearing demo images...');
      imageGalleryData = imageGalleryData.filter(
        item => !item.name?.includes('Demo Image') && !item.name?.includes('Blank Canvas')
      );

      // Manually update the gallery UI instead of calling undefined function
      const gallery = document.getElementById('imageGallery');
      const dots = document.getElementById('imageDots');

      if (gallery) {
        // Remove demo image thumbnails
        const demoThumbnails = gallery.querySelectorAll('.image-thumbnail');
        demoThumbnails.forEach(thumb => {
          const overlay = thumb.querySelector('.image-overlay');
          if (
            overlay &&
            (overlay.textContent.includes('Demo Image') ||
              overlay.textContent.includes('Blank Canvas'))
          ) {
            thumb.remove();
          }
        });
      }

      if (dots) {
        // Clear demo dots
        const demoDots = dots.querySelectorAll('.nav-dot');
        demoDots.forEach(dot => dot.remove());
      }

      // Update counter if function exists
      if (typeof updateImageCounter === 'function') {
        updateImageCounter();
      } else {
        // Update counter manually
        const counter = document.getElementById('imageCounter');
        if (counter) {
          counter.textContent =
            imageGalleryData.length > 0 ? `${imageGalleryData.length} images` : '';
        }
      }
      console.log('[DEMO] Demo images cleared, remaining images:', imageGalleryData.length);
    }

    // Removed manual sync button - syncing is now automatic

    // Test the gallery with some demo images after everything loads
    setTimeout(() => {
      console.log('[INIT] ===== Initial gallery setup =====');
      console.log('[INIT] imageGalleryData before sync:', imageGalleryData.length);

      // First, sync any existing legacy images
      console.log('[INIT] Step 1: Syncing existing legacy images...');
      syncLegacyImagesToGallery();

      console.log('[INIT] imageGalleryData after sync:', imageGalleryData.length);

      // Check if we have any real images (non-demo)
      const realImagesCount = imageGalleryData.filter(
        item => !item.name?.includes('Demo Image') && !item.name?.includes('Blank Canvas')
      ).length;
      console.log('[INIT] Real images found:', realImagesCount);

      // Do not add demo/blank images; keep gallery empty until user adds/loads
      console.log(`[INIT] Skipping demo images. Real count: ${realImagesCount}`);

      // Test the addImageToSidebar function to see if hooking works
      if (window.addImageToSidebar) {
        console.log('[TEST] addImageToSidebar function is available');
      } else {
        console.log('[TEST] addImageToSidebar not available yet');
      }

      console.log('[INIT] ===== Initial setup complete =====');

      // Initialize image list centering observer (if function exists and imageList has containers)
      const imageList = document.getElementById('imageList');
      if (imageList && imageList.querySelectorAll('.image-container').length > 0) {
        if (typeof initImageListCenteringObserver === 'function') {
          initImageListCenteringObserver();
        } else {
          console.warn(
            '[INIT] initImageListCenteringObserver not available yet, will initialize when images are added'
          );
        }
      } else {
        console.log('[INIT] No images yet, observer will initialize when first image is added');
      }

      // Ensure we always start with the first image
      if (imageList) {
        const firstContainer = imageList.querySelector('.image-container');
        if (firstContainer) {
          const firstLabel = firstContainer.dataset.label;
          if (firstLabel) {
            console.log('[INIT] Centering and selecting first image:', firstLabel);

            // Center the first container
            window.__imageListProgrammaticScrollUntil = Date.now() + 1000;
            firstContainer.scrollIntoView({
              behavior: 'smooth',
              block: 'center',
              inline: 'center',
            });

            // Switch to the first image view
            setTimeout(() => {
              if (window.projectManager && typeof window.projectManager.switchView === 'function') {
                window.projectManager.switchView(firstLabel);
              }

              // Update pills
              if (typeof updatePills === 'function') {
                updatePills();
              }
              if (typeof updateActivePill === 'function') {
                updateActivePill();
              }
            }, 300);
          }
        }

        if (typeof updateImageListPadding === 'function') {
          updateImageListPadding();
        }
      }
    }, 2000);

    // Track last known legacy count to avoid unnecessary syncs
    let lastLegacyCount = 0;

    // Also set up a periodic sync to catch any images that get added later (less frequent)
    // Only run when tab is visible to reduce performance impact
    let syncInterval;
    const startSyncInterval = () => {
      syncInterval = setInterval(() => {
        // Skip if tab is not visible
        if (document.hidden) return;

        const currentLegacyCount =
          document.getElementById('imageList')?.querySelectorAll('.image-container').length || 0;
        const currentRealImagesCount = imageGalleryData.filter(
          item => !item.name?.includes('Demo Image') && !item.name?.includes('Blank Canvas')
        ).length;

        // Only sync if there's actually a change in legacy count
        if (currentLegacyCount > lastLegacyCount) {
          console.log('[PERIODIC] New legacy images detected, syncing...');
          console.log(
            `[PERIODIC] Legacy: ${currentLegacyCount} (was ${lastLegacyCount}), Gallery real: ${currentRealImagesCount}`
          );

          // No demo images are used anymore; skip clearing

          syncLegacyImagesToGallery();

          // Don't automatically switch views during periodic sync
          // Let ProjectManager handle view switching based on user interaction
          // Only update pills to reflect new images
          if (typeof updatePills === 'function') {
            setTimeout(() => {
              updatePills();
              if (typeof updateActivePill === 'function') {
                updateActivePill();
              }
            }, 100);

            if (typeof window.ensureImageListObserver === 'function') {
              window.ensureImageListObserver();
            } else {
              window.__pendingImageListObserverInit = true;
            }
          }

          lastLegacyCount = currentLegacyCount;
        }
      }, 3000); // Check every 3 seconds instead of 2
    };

    // Start interval and handle visibility changes
    startSyncInterval();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        clearInterval(syncInterval);
      } else {
        startSyncInterval();
      }
    });

    // Force Show Panels (Fix for stuck hidden state)
    const mainPanels = ['strokePanel', 'imagePanel', 'canvasControls', 'topToolbar'];
    mainPanels.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.classList.remove('hidden');
        el.style.display = 'flex';
        el.setAttribute('data-loaded', 'true');
      }
    });
  });

  // View Measurements toggle functionality
  runWhenDomReady(() => {
    // View Measurements toggle functionality
    const viewMeasurementsToggle = document.getElementById('viewMeasurementsToggle');
    if (viewMeasurementsToggle) {
      let measurementsVisible = true; // Default state

      const updateToggleAppearance = () => {
        if (measurementsVisible) {
          viewMeasurementsToggle.classList.remove('bg-gray-500', 'text-white');
          viewMeasurementsToggle.classList.add('bg-blue-500', 'text-white');
          viewMeasurementsToggle.textContent = 'Show Labels';
          viewMeasurementsToggle.title = 'Hide measurement labels';
        } else {
          viewMeasurementsToggle.classList.remove('bg-blue-500', 'text-white');
          viewMeasurementsToggle.classList.add('bg-gray-500', 'text-white');
          viewMeasurementsToggle.textContent = 'Hide Labels';
          viewMeasurementsToggle.title = 'Show measurement labels';
        }
      };

      viewMeasurementsToggle.addEventListener('click', e => {
        e.stopPropagation(); // Prevent panel dragging
        measurementsVisible = !measurementsVisible;
        updateToggleAppearance();

        // Toggle all measurement labels visibility
        if (window.strokeLabelVisibility && window.currentImageLabel) {
          const imageLabels = window.strokeLabelVisibility[window.currentImageLabel];
          if (imageLabels) {
            for (const strokeLabel in imageLabels) {
              window.strokeLabelVisibility[window.currentImageLabel][strokeLabel] =
                measurementsVisible;
            }
          }
        }

        // Update all label toggle buttons in the stroke list
        const labelToggleBtns = document.querySelectorAll('.stroke-label-toggle');
        labelToggleBtns.forEach(btn => {
          btn.innerHTML = measurementsVisible ? '🏷️' : ' 🏷️ ';
          btn.title = measurementsVisible ? 'Hide Label' : 'Show Label';
        });

        // Redraw canvas to apply changes
        if (typeof window.redrawCanvasWithVisibility === 'function') {
          window.redrawCanvasWithVisibility();
        }
      });

      // Set initial appearance
      updateToggleAppearance();
    }
  });
}
