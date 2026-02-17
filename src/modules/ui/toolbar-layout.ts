// Toolbar layout calculation - determines compact vs full mode

export function initToolbarLayout(): void {
  'use strict';

  const key = '__openpaintToolbarModeInitDone';
  if ((window as any)[key]) {
    return;
  }
  (window as any)[key] = true;

  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  let isCalculating = false;

  const calculateToolbarMode = (): void => {
    // Prevent concurrent calculations
    if (isCalculating) return;
    isCalculating = true;

    const toolbarWrap =
      document.getElementById('toolbarWrap') || document.querySelector('.toolbar-wrap');
    if (!toolbarWrap) {
      isCalculating = false;
      return;
    }

    const windowWidth = window.innerWidth;
    const isMobile = windowWidth <= 768;

    // Desktop: always use full mode
    if (!isMobile) {
      document.documentElement.setAttribute('data-toolbar-mode', 'full');
      isCalculating = false;
      return;
    }

    // Mobile: Measure if compact is needed
    // Temporarily set to full mode for measurement
    document.documentElement.setAttribute('data-toolbar-mode', 'full');

    // Force layout calculation
    void toolbarWrap.offsetWidth;

    // Measure if content overflows
    const toolbarWidth = toolbarWrap.clientWidth;
    const toolbarScrollWidth = toolbarWrap.scrollWidth;
    const needsCompact = toolbarScrollWidth > toolbarWidth;

    // Set the correct mode based on measurement
    document.documentElement.setAttribute('data-toolbar-mode', needsCompact ? 'compact' : 'full');

    isCalculating = false;
  };

  // Calculate immediately when toolbar exists
  const initCalculation = (): void => {
    const toolbarWrap =
      document.getElementById('toolbarWrap') || document.querySelector('.toolbar-wrap');
    if (toolbarWrap) {
      calculateToolbarMode();
    } else if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initCalculation);
    } else {
      setTimeout(initCalculation, 0);
    }
  };

  // Start calculation
  initCalculation();

  // Recalculate after fonts load (for accurate text measurement)
  if (document.fonts) {
    void document.fonts.ready.then(() => {
      setTimeout(calculateToolbarMode, 50);
    });
  }

  // Recalculate on window resize (throttled)
  window.addEventListener('resize', () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(calculateToolbarMode, 150);
  });

  // Expose function globally if needed
  (window as Window & { calculateToolbarMode?: () => void }).calculateToolbarMode =
    calculateToolbarMode;
}
