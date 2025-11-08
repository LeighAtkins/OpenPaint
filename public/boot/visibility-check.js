/**
 * Runtime visibility guard for critical UI elements
 * Logs warnings if Copy button is missing or hidden in production
 */
(function() {
  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  ready(function() {
    try {
      const el = document.getElementById('copyCanvasBtn');

      if (!el) {
        console.warn('[visibility-guard] copyCanvasBtn element missing from DOM');
        return;
      }

      // Check if element is hidden by CSS
      const isHidden = (
        el.offsetParent === null ||
        getComputedStyle(el).visibility === 'hidden' ||
        getComputedStyle(el).display === 'none'
      );

      if (isHidden) {
        console.warn('[visibility-guard] copyCanvasBtn is hidden by CSS', {
          display: getComputedStyle(el).display,
          visibility: getComputedStyle(el).visibility,
          offsetParent: el.offsetParent
        });
      } else {
        console.log('[visibility-guard] copyCanvasBtn is visible ✓');
      }
    } catch (err) {
      console.error('[visibility-guard] Error checking button visibility:', err);
    }
  });
})();
