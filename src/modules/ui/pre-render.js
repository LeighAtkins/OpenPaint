// Pre-render CSS configuration
// Must run ASAP to prevent FOUC

export function initPreRender() {
  // Toolbar initialization - MUST run first to set data-toolbar-mode before CSS renders
  (function () {
    document.documentElement.classList.add('app-loading');
    const windowWidth = window.innerWidth || 1920;
    const isMobile = windowWidth <= 768;
    const toolbarMode = isMobile ? 'compact' : 'full';
    document.documentElement.setAttribute('data-toolbar-mode', toolbarMode);
    document.documentElement.setAttribute('data-toolbar-initial', toolbarMode);
  })();
}
