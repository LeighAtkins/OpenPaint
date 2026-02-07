// Frame capture placeholder toggle

export function initFrameCaptureToggle() {
  (function () {
    const frameCapture = document.getElementById('frame-capture');
    if (!frameCapture) return;

    function toggleFramePlaceholder() {
      const hasImages = window.originalImages && Object.keys(window.originalImages).length > 0;
      frameCapture.classList.toggle('hidden', !!hasImages);
    }

    window.__hideFrameCapture = toggleFramePlaceholder;

    if (document.readyState === 'complete') {
      toggleFramePlaceholder();
    } else {
      window.addEventListener('load', toggleFramePlaceholder, { once: true });
    }
  })();
}
