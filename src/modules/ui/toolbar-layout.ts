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

  const measureFullToolbarScrollWidth = (toolbarWrap: HTMLElement, width: number): number => {
    const clone = toolbarWrap.cloneNode(true) as HTMLElement;
    clone.removeAttribute('id');
    clone.querySelectorAll<HTMLElement>('[id]').forEach(el => el.removeAttribute('id'));
    clone.querySelectorAll<HTMLElement>('.label-long').forEach(el => {
      el.style.setProperty('display', 'inline-block', 'important');
      el.style.whiteSpace = 'nowrap';
    });
    clone.querySelectorAll<HTMLElement>('.label-short').forEach(el => {
      el.style.setProperty('display', 'none', 'important');
    });
    clone.style.position = 'absolute';
    clone.style.left = '-10000px';
    clone.style.top = '0';
    clone.style.width = `${Math.max(1, Math.round(width))}px`;
    clone.style.height = 'auto';
    clone.style.visibility = 'hidden';
    clone.style.pointerEvents = 'none';
    clone.style.contain = 'layout style';
    document.body.appendChild(clone);
    const scrollWidth = clone.scrollWidth;
    clone.remove();
    return scrollWidth;
  };

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

    const toolbarWidth = toolbarWrap.clientWidth;
    const currentMode = document.documentElement.getAttribute('data-toolbar-mode') || 'full';
    const overflowBuffer = 4;
    const expandBuffer = 24;

    let nextMode = currentMode;
    if (currentMode === 'compact') {
      const fullScrollWidth = measureFullToolbarScrollWidth(toolbarWrap, toolbarWidth);
      nextMode = fullScrollWidth > toolbarWidth - expandBuffer ? 'compact' : 'full';
    } else {
      nextMode = toolbarWrap.scrollWidth > toolbarWidth + overflowBuffer ? 'compact' : 'full';
    }

    if (nextMode !== currentMode) {
      document.documentElement.setAttribute('data-toolbar-mode', nextMode);
    }

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
