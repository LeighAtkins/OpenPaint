// Toolbar ready marker

export function initToolbarReady() {
  // Mark toolbar as ready - size should already be calculated by previous script
  (function () {
    const markToolbarReady = () => {
      try {
        const topToolbar = document.getElementById('topToolbar');
        const toolbarWrap =
          document.getElementById('toolbarWrap') || document.querySelector('.toolbar-wrap');

        if (topToolbar && toolbarWrap) {
          // Toolbar size should already be set by the calculation script
          // Just mark it as ready to make it visible
          topToolbar.classList.add('toolbar-ready');
          toolbarWrap.classList.add('toolbar-ready');
          // Toolbar is now ready - CSS will make it visible
          window.__toolbarReady = true;
        }
      } catch (e) {
        console.error('[TOOLBAR-INIT] Error marking toolbar ready:', e);
      }
    };

    // Try immediately
    markToolbarReady();

    // Also try on DOMContentLoaded
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', markToolbarReady);
    } else {
      setTimeout(markToolbarReady, 0);
    }
  })();
}
