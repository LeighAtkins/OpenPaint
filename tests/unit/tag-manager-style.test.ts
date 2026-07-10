import { beforeEach, describe, expect, test, vi } from 'vitest';
import { TagManager } from '../../src/modules/TagManager';

describe('TagManager style preset precedence', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    (window as any).currentImageLabel = 'front';
    (window as any).projectMetadata = {};
    (window as any).app = {
      projectManager: {
        currentViewId: 'front',
        getProjectMetadata: () => (window as any).projectMetadata,
        setProjectMetadata: vi.fn(update => {
          (window as any).projectMetadata = {
            ...(window as any).projectMetadata,
            ...update,
          };
        }),
      },
    };
  });

  test('a letters-and-numbers preset replaces imported per-tag colors for matching labels', () => {
    const metadataManager = {
      normalizeImageLabel: (label: string) => label,
      updateStrokeVisibilityControls: vi.fn(),
    };
    const manager = new TagManager({ fabricCanvas: null } as any, metadataManager as any);
    manager.refreshAllTagStyles = vi.fn();

    const importedTheme = {
      background: '#ffffff',
      border: '#21a179',
      text: '#000000',
    };
    const presetTheme = {
      background: '#fff3b0',
      border: '#ef476f',
      text: '#1f2937',
    };

    manager.setTagTheme('C1', 'front', importedTheme);
    manager.setTagTheme('C', 'front', importedTheme);
    expect(manager.getTagThemeOverride('C1', 'front')).toEqual(importedTheme);
    expect(manager.getTagThemeOverride('C', 'front')).toEqual(importedTheme);

    manager.setTagStyleTheme('lettersNumbers', presetTheme);

    expect(manager.getTagThemeOverride('C1', 'front')).toBeNull();
    expect(manager.getTagThemeOverride('C', 'front')).toEqual(importedTheme);
    expect(manager.getTagPalette('C1', 'front')).toEqual({
      bg: presetTheme.background,
      stroke: presetTheme.border,
      text: presetTheme.text,
    });
  });
});
