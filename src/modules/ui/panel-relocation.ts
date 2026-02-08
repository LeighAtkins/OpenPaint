// Panel relocation into flex layout

export function initPanelRelocation(): void {
  // Relocate panels into the flex layout on page load
  'use strict';

  const relocatePanels = (): void => {
    console.log('[Layout] Relocation script starting...');
    // document.body.style.border = '5px solid green'; // Removed sanity check

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
      'display: flex !important; flex-direction: row !important; width: 100% !important; height: calc(100vh - 48px) !important; overflow: hidden !important; border: 1px solid red !important; box-sizing: border-box !important;';

    // 1. strokePanel (Left)
    mainLayout.insertBefore(strokePanel, mainLayout.firstChild);
    strokePanel.style.cssText +=
      'order: 1 !important; position: fixed !important; left: 0 !important; top: 48px !important; height: calc(100% - 128px) !important; flex: none !important; display: flex !important; flex-direction: column !important; width: 256px !important; min-width: 256px !important; max-width: 256px !important;';

    // 2. canvasContainer (Center)
    mainLayout.appendChild(canvasContainer);
    canvasContainer.style.cssText +=
      'order: 2 !important; flex: 1 !important; min-width: 0 !important; position: relative !important; display: block !important; border: 1px solid blue !important; box-sizing: border-box !important;';

    // 3. imagePanel (Right)
    mainLayout.appendChild(imagePanel);
    imagePanel.style.cssText +=
      'order: 3 !important; position: fixed !important; right: 0 !important; left: auto !important; top: 48px !important; height: calc(100% - 128px) !important; flex: none !important; display: flex !important; flex-direction: column !important; border-left-width: 1px !important; border-right-width: 0 !important; width: 288px !important; min-width: 288px !important; max-width: 288px !important;';

    // Debug: Log the final order and computed styles
    const children = Array.from(mainLayout.children);
    console.log('[Layout] Panels relocated into flex layout');
    console.log(
      '[Layout] Final order:',
      children.map(el => el.id || el.tagName)
    );

    // Log computed styles to debug "on the left" issue
    setTimeout(() => {
      const containerStyle = window.getComputedStyle(mainLayout);
      console.log(
        '[Layout] Container display:',
        containerStyle.display,
        'direction:',
        containerStyle.flexDirection
      );
      console.log('[Layout] ImagePanel order:', window.getComputedStyle(imagePanel).order);
      console.log('[Layout] CanvasContainer width:', canvasContainer.getBoundingClientRect().width);
    }, 100);

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
