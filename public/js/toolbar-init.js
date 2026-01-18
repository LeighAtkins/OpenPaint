// Toolbar initialization module
(function () {
  'use strict';

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
      setUniform(el);
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
      } catch {}
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
      } catch {}
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
      } catch {}
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
      } catch {}
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
    reparent('rotateLeftCtrl', bottom, el => {
      el.classList.add('icon-btn', 'tbtn');
      el.title = 'Rotate Left';
      el.textContent = '↶';
    });
    reparent('rotateRightCtrl', bottom, el => {
      el.classList.add('icon-btn', 'tbtn');
      el.title = 'Rotate Right';
      el.textContent = '↷';
    });
    // CLEANUP: Remove any existing menu or wrapper from previous runs
    const existingMenu = document.getElementById('zoomMenuDropdown');
    if (existingMenu) existingMenu.remove();

    const existingWrapper = document.getElementById('scaleButtonWrapper');
    if (existingWrapper) {
      // If wrapper exists, the button might be inside it.
      // We don't want to lose the button, but we want to rebuild the wrapper to be safe.
      // However, if the button is inside, we can just move it out first.
      const btn = existingWrapper.querySelector('#scaleButton');
      if (btn) {
        document.body.appendChild(btn); // Move to body temporarily
      }
      existingWrapper.remove();
    }

    // Create wrapper for scale button to handle relative positioning
    const scaleWrapper = document.createElement('div');
    scaleWrapper.id = 'scaleButtonWrapper'; // ID for future cleanup
    scaleWrapper.className = 'relative inline-block';

    // Find the scale button (it might be in bottom or center depending on layout)
    // We need to move it into our wrapper AND move the wrapper to the bottom toolbar
    const scaleBtn = document.getElementById('scaleButton');
    if (scaleBtn) {
      // Move button into wrapper
      scaleWrapper.appendChild(scaleBtn);

      // Append wrapper to the bottom toolbar (target)
      // This ensures it sits with the other controls
      bottom.appendChild(scaleWrapper);

      // Ensure uniform styling
      scaleBtn.classList.add('tbtn');

      // Create the menu immediately (no lazy loading needed for this simple structure)
      const menu = document.createElement('div');
      menu.id = 'zoomMenuDropdown';
      menu.className =
        'absolute bottom-full left-1/2 mb-2 hidden bg-white rounded-lg shadow-lg border border-gray-200 py-1';
      menu.style.transform = 'translateX(-50%)';
      menu.style.minWidth = '120px';
      menu.style.zIndex = '10001'; // Higher than toolbar (10000)

      menu.innerHTML = `
                <button class="w-full text-left px-4 py-2 hover:bg-gray-50 text-sm" data-zoom="0.5">50%</button>
                <button class="w-full text-left px-4 py-2 hover:bg-gray-50 text-sm" data-zoom="0.75">75%</button>
                <button class="w-full text-left px-4 py-2 hover:bg-gray-50 text-sm" data-zoom="1.0">100%</button>
                <button class="w-full text-left px-4 py-2 hover:bg-gray-50 text-sm" data-zoom="1.5">150%</button>
                <button class="w-full text-left px-4 py-2 hover:bg-gray-50 text-sm" data-zoom="2.0">200%</button>
                <div class="border-t border-gray-100 my-1"></div>
                <button class="w-full text-left px-4 py-2 hover:bg-gray-50 text-sm font-medium" data-zoom="fit">Fit Canvas</button>
            `;

      scaleWrapper.appendChild(menu);

      // Toggle menu on button click
      scaleBtn.addEventListener('click', e => {
        e.stopPropagation();
        menu.classList.toggle('hidden');
        console.log('[Toolbar] Toggled zoom menu');
      });

      // Handle menu options
      menu.addEventListener('click', e => {
        const btn = e.target.closest('button');
        if (!btn) return;

        const zoom = btn.dataset.zoom;
        console.log(`[Toolbar] Zoom option clicked: ${zoom}`);

        if (window.app && window.app.canvasManager) {
          window.app.canvasManager.setManualZoom(zoom);

          // Update button text
          const textNode = scaleBtn.firstChild;
          if (textNode) {
            if (zoom === 'fit') {
              textNode.textContent = 'Fit ';
            } else {
              textNode.textContent = `${parseFloat(zoom) * 100}% `;
            }
          }
        }
        menu.classList.add('hidden');
      });

      // Close on click outside
      document.addEventListener('click', e => {
        if (!scaleWrapper.contains(e.target)) {
          menu.classList.add('hidden');
        }
      });
    } else {
      console.error('[Toolbar] scaleButton not found for wrapping');
    }
    syncFromState();

    // RIGHT: project settings are now pre-populated, just need to wire up functionality
    const saveProjectTop = document.getElementById('saveProjectTop');
    const shareProjectBtn = document.getElementById('shareProjectBtn');
    const updateShareBtn = document.getElementById('updateShareBtn');

    if (saveProjectTop) {
      saveProjectTop.addEventListener('click', () => {
        if (window.projectManager?.saveProject) window.projectManager.saveProject();
      });
    }

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

    // Unit toggle button is now pre-populated, just need to wire up functionality
    const unitToggle = document.getElementById('unitToggleBtn');
    const unitSel = document.getElementById('unitSelector');
    const unitToggleSecondary = document.getElementById('unitToggleBtnSecondary');

    const getUnitLabel = () => (unitSel?.value === 'inch' ? 'inches' : 'cm');
    const toggleUnits = () => {
      if (!unitSel) return;
      unitSel.value = unitSel.value === 'inch' ? 'cm' : 'inch';
      const label = getUnitLabel();
      if (unitToggle) unitToggle.textContent = label;
      if (unitToggleSecondary) unitToggleSecondary.textContent = label;
      if (typeof updateMeasurementDisplay === 'function') {
        updateMeasurementDisplay();
      } else if (unitSel.onchange) {
        unitSel.onchange();
      }
    };

    if (unitToggle && unitSel) {
      unitToggle.textContent = getUnitLabel();
      unitToggle.addEventListener('click', toggleUnits);
      // Hide the original select (kept for compatibility)
      unitSel.style.display = 'none';
    }

    if (unitToggleSecondary && unitSel) {
      unitToggleSecondary.textContent = getUnitLabel();
      unitToggleSecondary.addEventListener('click', toggleUnits);
    }

    // Elements panel single-button shape toggle wiring
    const labelShapeToggleBtn = document.getElementById('labelShapeToggleBtn');
    const applyShape = val => {
      if (window.paintApp?.state) window.paintApp.state.labelShape = val;
      if (window.redrawCanvasWithVisibility) window.redrawCanvasWithVisibility();
    };
    if (labelShapeToggleBtn) {
      // Add transition styles for smooth morphing animation
      labelShapeToggleBtn.style.transition =
        'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.15s ease-out';

      const syncShapeBtn = () => {
        const shape = window.paintApp?.state?.labelShape || 'square';
        const isSquare = shape !== 'circle';
        labelShapeToggleBtn.textContent = isSquare ? '■' : '●';
        labelShapeToggleBtn.setAttribute('aria-pressed', String(isSquare));
      };
      labelShapeToggleBtn.addEventListener('click', () => {
        // Animate button with morphing effect: scale down (fade), swap icon, scale up (reveal)
        labelShapeToggleBtn.style.opacity = '0.3';
        labelShapeToggleBtn.style.transform = 'scale(0.7)';

        setTimeout(() => {
          // Swap icon at midpoint of animation
          const shape = window.paintApp?.state?.labelShape || 'square';
          applyShape(shape === 'circle' ? 'square' : 'circle');
          syncShapeBtn();

          // Immediately start scaling back up
          labelShapeToggleBtn.style.opacity = '1';
          labelShapeToggleBtn.style.transform = 'scale(1)';
        }, 150); // Mid-animation swap
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
          } catch {}
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

  // Setup quick save hover menu functionality
  function setupQuickSaveHover() {
    const quickSave = document.getElementById('quickSave');
    const quickSaveBtn = document.getElementById('quickSaveBtn');
    const quickSaveMenu = document.getElementById('quickSaveMenu');

    if (!quickSave || !quickSaveBtn || !quickSaveMenu) {
      console.error('Quick save elements not found:', { quickSave, quickSaveBtn, quickSaveMenu });
      return;
    }

    if (quickSave.__quickSaveBound) {
      return;
    }
    quickSave.__quickSaveBound = true;

    const triggerSaveOnce = () => {
      const saveButton = document.getElementById('save');
      if (!saveButton) {
        console.warn('[QuickSave] Save button not found');
        return;
      }
      if (saveButton.__quickSaveInFlight) {
        return;
      }
      saveButton.__quickSaveInFlight = true;
      if (typeof saveButton.click === 'function') {
        saveButton.click();
      } else {
        saveButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
      setTimeout(() => {
        saveButton.__quickSaveInFlight = false;
      }, 500);
    };

    quickSaveBtn.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      triggerSaveOnce();
    });

    let hideTimer = null;
    const showMenu = () => {
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
      quickSaveMenu.classList.remove('hidden');
    };
    const scheduleHide = () => {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        quickSaveMenu.classList.add('hidden');
        hideTimer = null;
      }, 200);
    };

    quickSave.addEventListener('mouseenter', showMenu);
    quickSave.addEventListener('mouseleave', scheduleHide);
    quickSaveMenu.addEventListener('mouseenter', showMenu);
    quickSaveMenu.addEventListener('mouseleave', scheduleHide);

    quickSaveMenu.addEventListener('click', e => {
      const item = e.target.closest('[data-action]');
      if (!item) return;
      const action = item.dataset.action;

      if (action === 'pdf') {
        const projectName = document.getElementById('projectName')?.value || 'Untitled Project';
        if (typeof window.showPDFExportDialog === 'function') {
          window.showPDFExportDialog(projectName);
        } else {
          console.error('[QuickSave] window.showPDFExportDialog is not a function');
        }
      } else if (action === 'multiple') {
        if (typeof window.saveAllImages === 'function') {
          window.saveAllImages();
        } else {
          console.error('[QuickSave] window.saveAllImages is not a function');
        }
      }
    });
  }

  // Expose functions globally
  window.initializeTopToolbar = initializeTopToolbar;
  window.setupQuickSaveHover = setupQuickSaveHover;

  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initializeTopToolbar();
      setupQuickSaveHover();
    });
  } else {
    initializeTopToolbar();
    setupQuickSaveHover();
  }
})();
