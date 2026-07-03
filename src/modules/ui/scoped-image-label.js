export function resolveScopedImageLabel(viewId) {
  const fallback = String(viewId ?? '').trim();
  const metadataManager = window.app?.metadataManager;

  if (typeof metadataManager?.resolveActiveImageLabel === 'function') {
    const active = String(metadataManager.resolveActiveImageLabel(fallback) ?? fallback).trim();
    if (active) return active;
  }

  if (typeof window.getCaptureTabScopedLabel === 'function') {
    const scoped = String(window.getCaptureTabScopedLabel(fallback) ?? fallback).trim();
    if (scoped) return scoped;
  }

  if (typeof metadataManager?.normalizeImageLabel === 'function') {
    const normalized = String(metadataManager.normalizeImageLabel(fallback) ?? fallback).trim();
    if (normalized) return normalized;
  }

  return fallback;
}

// A multiview pane has its own Fabric canvas but deliberately does not change
// ProjectManager.currentViewId. Drawing tools must therefore use this canvas-
// bound context before falling back to the primary canvas view.
export function resolveDrawingImageLabel(canvasManager, fallbackViewId) {
  const context = window.multiviewEditContext;
  const contextCanvas = context?.canvasManager;
  const scopedLabel = String(context?.scopedImageLabel ?? '').trim();

  if (contextCanvas === canvasManager && scopedLabel) {
    return scopedLabel;
  }

  return resolveScopedImageLabel(fallbackViewId);
}
