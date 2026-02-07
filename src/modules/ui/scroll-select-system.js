/**
 * Scroll Select System Module
 * Manages scroll-based image selection with auto/manual toggle and localStorage persistence
 */
(function () {
  'use strict';

  const SCROLL_SELECT_STORAGE_KEY = 'scrollSelectEnabled';
  const SCROLL_SWITCH_DEBOUNCE_MS = 70;
  const MIN_CENTER_TOLERANCE = 8;
  const MAX_CENTER_TOLERANCE = 48;

  /**
   * Load scroll select state from localStorage
   */
  function loadScrollSelectState() {
    try {
      const stored = localStorage.getItem(SCROLL_SELECT_STORAGE_KEY);
      if (stored === null) return true;
      return stored === 'true';
    } catch (error) {
      return true;
    }
  }

  /**
   * Persist scroll select state to localStorage
   */
  function persistScrollSelectState(enabled) {
    try {
      localStorage.setItem(SCROLL_SELECT_STORAGE_KEY, String(enabled));
    } catch (error) {
      // Ignore storage errors (e.g., private mode)
    }
  }

  /**
   * Set scroll select enabled state
   */
  function setScrollSelectEnabled(enabled, source = 'auto') {
    window.scrollToSelectEnabled = enabled;
    persistScrollSelectState(enabled);
    console.debug(`[ScrollSelect] Mode set to ${enabled ? 'AUTO' : 'MANUAL'} (source: ${source})`);

    if (document?.body) {
      document.body.setAttribute('data-scroll-select', enabled ? 'auto' : 'manual');
    }

    const modeLabel = document.getElementById('scrollSelectModeLabel');
    if (modeLabel) {
      modeLabel.textContent = enabled ? 'Auto' : 'Manual';
      modeLabel.classList.toggle('text-blue-600', enabled);
      modeLabel.classList.toggle('text-slate-500', !enabled);
    }

    const toggle = document.getElementById('scrollSelectToggle');
    if (toggle) {
      toggle.checked = enabled;
    }
  }

  /**
   * Check if scroll select is enabled
   */
  function isScrollSelectEnabled() {
    return window.scrollToSelectEnabled !== false;
  }

  /**
   * Get list center metrics
   */
  function getListCenterMetrics(listRect) {
    if (!listRect) {
      return { center: 0, tolerance: MIN_CENTER_TOLERANCE };
    }
    const center = listRect.top + listRect.height / 2;
    const tolerance = Math.max(
      MIN_CENTER_TOLERANCE,
      Math.min(MAX_CENTER_TOLERANCE, listRect.height * 0.04)
    );
    return { center, tolerance };
  }

  /**
   * Get the image container aligned to center
   */
  function getAlignedImageContainer(imageList) {
    if (!imageList) return null;
    const listRect = imageList.getBoundingClientRect();
    if (!listRect || !listRect.height) return null;
    const { center, tolerance } = getListCenterMetrics(listRect);
    let closest = null;
    let closestDistance = Infinity;

    imageList.querySelectorAll('.image-container').forEach(container => {
      const rect = container.getBoundingClientRect();
      if (!rect || rect.height === 0) return;
      const containerCenter = rect.top + rect.height / 2;
      const distance = Math.abs(containerCenter - center);
      const isVisible = rect.bottom > listRect.top && rect.top < listRect.bottom;

      if (isVisible && distance < closestDistance) {
        closestDistance = distance;
        closest = container;
      }
    });

    if (closest && closestDistance <= tolerance) {
      console.debug(
        `[ScrollSelect] Candidate ${closest.dataset.label} within tolerance (${closestDistance.toFixed(1)} <= ${tolerance.toFixed(1)})`
      );
      return {
        container: closest,
        distance: closestDistance,
        tolerance,
        center,
      };
    }

    if (closest) {
      console.debug(
        `[ScrollSelect] No centered thumbnail (best ${closest.dataset.label} at ${closestDistance.toFixed(1)}px, tolerance ${tolerance.toFixed(1)}px)`
      );
    } else {
      console.debug('[ScrollSelect] No thumbnail candidates found while scanning list');
    }
    return null;
  }

  /**
   * Sync selection to centered thumbnail
   */
  function syncSelectionToCenteredThumbnail() {
    if (!isScrollSelectEnabled()) return;
    if (window.__suppressScrollSelectUntil && Date.now() < window.__suppressScrollSelectUntil) {
      return;
    }

    const imageList = document.getElementById('imageList');
    if (!imageList) return;

    const alignedInfo = getAlignedImageContainer(imageList);
    if (!alignedInfo) return;

    const { container: aligned, distance, tolerance } = alignedInfo;
    const label = aligned.dataset.label;

    console.debug(
      `[ScrollSelect] Centered thumbnail ${label} (distance ${distance.toFixed(1)}px / tolerance ${tolerance.toFixed(1)}px)`
    );

    if (
      label &&
      window.projectManager &&
      typeof window.projectManager.switchView === 'function' &&
      window.projectManager.currentViewId !== label
    ) {
      console.debug(`[ScrollSelect] syncSelectionToCenteredThumbnail switching to ${label}`);
      window.projectManager.switchView(label);
      setTimeout(() => {
        if (typeof window.updateActivePill === 'function') {
          window.updateActivePill();
        }
      }, 30);
    }
  }

  /**
   * Initialize scroll select toggle
   */
  function initScrollSelectToggle() {
    const initial = loadScrollSelectState();
    setScrollSelectEnabled(initial, 'init');

    const toggle = document.getElementById('scrollSelectToggle');
    if (toggle) {
      toggle.addEventListener('change', () => {
        setScrollSelectEnabled(toggle.checked, 'toggle');
        if (toggle.checked) {
          if (typeof window.updateImageListPadding === 'function') {
            window.updateImageListPadding();
          }
          syncSelectionToCenteredThumbnail();
        }
      });
    }
  }

  // Expose public API
  window.scrollSelectSystem = {
    loadState: loadScrollSelectState,
    persistState: persistScrollSelectState,
    setEnabled: setScrollSelectEnabled,
    isEnabled: isScrollSelectEnabled,
    getAlignedContainer: getAlignedImageContainer,
    syncSelection: syncSelectionToCenteredThumbnail,
    initialize: initScrollSelectToggle,
  };

  // Legacy compatibility
  window.syncSelectionToCenteredThumbnail = syncSelectionToCenteredThumbnail;

  // Auto-initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initScrollSelectToggle);
  } else {
    initScrollSelectToggle();
  }
})();
