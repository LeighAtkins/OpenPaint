// Frame capture placeholder toggle

export type FrameCaptureVisibilityWindow = Window & {
  originalImages?: Record<string, unknown>;
  __hideFrameCapture?: () => void;
  toggleFramePlaceholder?: () => void;
};

export function initFrameCaptureVisibility(): void {
  'use strict';

  const frameCapture = document.getElementById('frame-capture');
  if (!frameCapture) return;

  const toggleFramePlaceholder = (): void => {
    const win = window as FrameCaptureVisibilityWindow;
    const hasImages = win.originalImages && Object.keys(win.originalImages).length > 0;
    frameCapture.classList.toggle('hidden', !!hasImages);
  };

  // Expose globally
  const win = window as FrameCaptureVisibilityWindow;
  win.__hideFrameCapture = toggleFramePlaceholder;
  win.toggleFramePlaceholder = toggleFramePlaceholder;

  // Initialize on load
  if (document.readyState === 'complete') {
    toggleFramePlaceholder();
  } else {
    window.addEventListener('load', toggleFramePlaceholder, { once: true });
  }
}
