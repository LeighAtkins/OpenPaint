// Panel relocation into flex layout

export function initPanelRelocation(): void {
  // Relocate panels into the flex layout on page load
  'use strict';

  const relocatePanels = (): void => {
    const mainLayout = document.getElementById('main-layout');
    const canvasContainer = document.getElementById('main-canvas-wrapper');
    const strokePanel = document.getElementById('strokePanel');
    const imagePanel = document.getElementById('imagePanel');

    if (!mainLayout || !canvasContainer || !strokePanel || !imagePanel) {
      console.error('[Layout] MISSING ELEMENTS:', {
        mainLayout,
        canvasContainer,
        strokePanel,
        imagePanel,
      });
      return;
    }

    // Enforce strict order: strokePanel -> canvasContainer -> imagePanel

    // Ensure main layout is flex row with !important
    mainLayout.style.cssText =
      'display: flex !important; flex-direction: row !important; width: 100% !important; height: calc(100vh - 48px) !important; overflow: hidden !important; box-sizing: border-box !important;';

    // 1. strokePanel (Left)
    mainLayout.insertBefore(strokePanel, mainLayout.firstChild);
    strokePanel.style.cssText +=
      'order: 1 !important; position: fixed !important; left: 0 !important; top: 48px !important; height: calc(100% - 128px) !important; flex: none !important; display: flex !important; flex-direction: column !important;';

    // 2. canvasContainer (Center)
    mainLayout.appendChild(canvasContainer);
    canvasContainer.style.cssText +=
      'order: 2 !important; flex: 1 !important; min-width: 0 !important; position: relative !important; display: block !important; box-sizing: border-box !important;';

    // 3. imagePanel (Right)
    mainLayout.appendChild(imagePanel);
    imagePanel.style.cssText +=
      'order: 3 !important; position: fixed !important; right: 0 !important; left: auto !important; top: 48px !important; height: calc(100% - 128px) !important; flex: none !important; display: flex !important; flex-direction: column !important; border-left-width: 1px !important; border-right-width: 0 !important;';

    // Trigger resize to ensure CanvasManager updates its size
    window.dispatchEvent(new Event('resize'));
  };

  // Run immediately if DOM is ready, otherwise wait
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', relocatePanels);
  } else {
    relocatePanels();
  }
}
