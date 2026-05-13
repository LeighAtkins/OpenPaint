import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { resolveScopedImageLabel } from '../../src/modules/ui/scoped-image-label.js';

describe('resolveScopedImageLabel', () => {
  const originalWindow = global.window;

  beforeEach(() => {
    global.window = {
      app: {},
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.window = originalWindow;
  });

  test('prefers metadataManager.normalizeImageLabel when available', () => {
    global.window.app.metadataManager = {
      normalizeImageLabel: vi.fn().mockReturnValue('front::tab:A'),
    };
    global.window.getCaptureTabScopedLabel = vi.fn().mockReturnValue('front::tab:B');

    expect(resolveScopedImageLabel('front')).toBe('front::tab:A');
    expect(global.window.app.metadataManager.normalizeImageLabel).toHaveBeenCalledWith('front');
    expect(global.window.getCaptureTabScopedLabel).not.toHaveBeenCalled();
  });

  test('falls back to getCaptureTabScopedLabel when metadataManager is unavailable', () => {
    global.window.getCaptureTabScopedLabel = vi.fn().mockReturnValue('front::tab:B');

    expect(resolveScopedImageLabel('front')).toBe('front::tab:B');
    expect(global.window.getCaptureTabScopedLabel).toHaveBeenCalledWith('front');
  });

  test('falls back to the raw view id when no scoped resolvers exist', () => {
    expect(resolveScopedImageLabel(' front ')).toBe('front');
  });

  test('returns an empty string safely for falsy input', () => {
    expect(resolveScopedImageLabel('')).toBe('');
    expect(resolveScopedImageLabel(null)).toBe('');
    expect(resolveScopedImageLabel(undefined)).toBe('');
  });
});
