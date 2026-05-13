export function resolveScopedImageLabel(viewId) {
  const fallback = String(viewId ?? '').trim();
  const metadataManager = window.app?.metadataManager;

  if (typeof metadataManager?.normalizeImageLabel === 'function') {
    const normalized = String(metadataManager.normalizeImageLabel(fallback) ?? fallback).trim();
    if (normalized) return normalized;
  }

  if (typeof window.getCaptureTabScopedLabel === 'function') {
    const scoped = String(window.getCaptureTabScopedLabel(fallback) ?? fallback).trim();
    if (scoped) return scoped;
  }

  return fallback;
}
