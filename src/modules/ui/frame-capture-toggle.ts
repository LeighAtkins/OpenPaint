// Frame capture placeholder toggle

type FrameCaptureWindow = Window & {
  originalImages?: Record<string, unknown>;
  __hideFrameCapture?: () => void;
};

export function initFrameCaptureToggle(): void {
  const frameCapture = document.getElementById('frame-capture');
  if (!frameCapture) return;

  const toggleFramePlaceholder = (): void => {
    const win = window as FrameCaptureWindow;
    const hasImages = win.originalImages && Object.keys(win.originalImages).length > 0;
    frameCapture.classList.toggle('hidden', !!hasImages);
  };

  (window as FrameCaptureWindow).__hideFrameCapture = toggleFramePlaceholder;

  if (document.readyState === 'complete') {
    toggleFramePlaceholder();
  } else {
    window.addEventListener('load', toggleFramePlaceholder, { once: true });
  }
}
