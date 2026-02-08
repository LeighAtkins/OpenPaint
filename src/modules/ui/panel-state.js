export const IMAGE_PANEL_STATE_ATTR = 'data-image-panel-state';

export const IMAGE_PANEL_STATES = {
  expanded: 'expanded',
  collapsed: 'collapsed',
};

export function setImagePanelState(state) {
  if (!document?.body) return;
  const normalizedState =
    state === IMAGE_PANEL_STATES.collapsed
      ? IMAGE_PANEL_STATES.collapsed
      : IMAGE_PANEL_STATES.expanded;
  document.body.setAttribute(IMAGE_PANEL_STATE_ATTR, normalizedState);
}

export function getImagePanelState() {
  return document?.body?.getAttribute(IMAGE_PANEL_STATE_ATTR) || null;
}

export function isImagePanelCollapsed() {
  if (getImagePanelState() === IMAGE_PANEL_STATES.collapsed) {
    return true;
  }

  const imagePanel = document.getElementById('imagePanel');
  const imagePanelContent = document.getElementById('imagePanelContent');
  return !!(
    (imagePanel &&
      (imagePanel.classList.contains('collapsed') ||
        imagePanel.classList.contains('minimized') ||
        imagePanel.style.display === 'none')) ||
    (imagePanelContent &&
      (imagePanelContent.classList.contains('hidden') ||
        imagePanelContent.style.display === 'none'))
  );
}
