// Frame capture placeholder toggle
(function () {
  'use strict';

  const frameCapture = document.getElementById('frame-capture');
  if (!frameCapture) return;

  function toggleFramePlaceholder() {
    const hasImages = window.originalImages && Object.keys(window.originalImages).length > 0;
    frameCapture.classList.toggle('hidden', !!hasImages);
  }

  // Expose globally
  window.__hideFrameCapture = toggleFramePlaceholder;
  window.toggleFramePlaceholder = toggleFramePlaceholder;

  // Initialize on load
  if (document.readyState === 'complete') {
    toggleFramePlaceholder();
  } else {
    window.addEventListener('load', toggleFramePlaceholder, { once: true });
  }
})();
