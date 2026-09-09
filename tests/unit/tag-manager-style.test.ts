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

describe('TagManager cross-frame tag sweep', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    (window as any).currentImageLabel = 'front';
    (window as any).projectMetadata = {};
    (window as any).app = {
      projectManager: {
        currentViewId: 'front',
        getProjectMetadata: () => (window as any).projectMetadata,
        setProjectMetadata: vi.fn(),
      },
    };
  });

  function makeMockCanvas(objects: any[]) {
    const removed: any[] = [];
    return {
      removed,
      getObjects: () => objects,
      remove: (obj: any) => removed.push(obj),
      requestRenderAll: () => {},
    };
  }

  test('switching capture frames keeps same-image tags and sweeps only other images', () => {
    const metadataManager = {
      normalizeImageLabel: (label: string) => label,
      updateStrokeVisibilityControls: vi.fn(),
    };
    const sameImageTabA = { isTag: true, imageLabel: 'front::tab:frame-1', strokeLabel: 'A' };
    const sameImageTabB = { isTag: true, scopedLabel: 'front::tab:frame-2', strokeLabel: 'B' };
    const otherImage = { isTag: true, imageLabel: 'side::tab:frame-1', strokeLabel: 'Z' };
    const canvas = makeMockCanvas([sameImageTabA, sameImageTabB, otherImage]);
    const manager = new TagManager({ fabricCanvas: canvas } as any, metadataManager as any);

    // Switching frames within "front": the sweep runs under the bare view id.
    manager.removeStaleTagsForScope('front');

    expect(canvas.removed).toEqual([otherImage]);
  });
});

describe('TagManager scope-aware tag lookup', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    (window as any).currentImageLabel = 'front';
    (window as any).projectMetadata = {};
    (window as any).app = {
      projectManager: {
        currentViewId: 'front',
        getProjectMetadata: () => (window as any).projectMetadata,
        setProjectMetadata: vi.fn(),
      },
    };
  });

  function makeManager(canvasObjects: any[]) {
    const metadataManager = {
      normalizeImageLabel: (label: string) => label,
      updateStrokeVisibilityControls: vi.fn(),
    };
    const canvas = {
      getObjects: () => canvasObjects,
      remove: () => {},
      requestRenderAll: () => {},
    };
    const manager = new TagManager({ fabricCanvas: canvas } as any, metadataManager as any);
    return manager;
  }

  test('another capture frame\u2019s tag never satisfies a tab-scoped lookup', () => {
    const frame1Tag = { strokeLabel: 'A', imageLabel: 'img-1', scopedLabel: 'img-1::tab:t1' };
    const manager = makeManager([frame1Tag]);
    manager.tagObjects.set('img-1::tab:t1::A', frame1Tag);

    // Frame 2 asks whether tag A already exists — it must not see frame 1's.
    expect(manager.getTagObject('A', 'img-1::tab:t2')).toBeNull();
  });

  test('a tag from a different image never satisfies the lookup', () => {
    const otherImageTag = { strokeLabel: 'A', imageLabel: 'side', scopedLabel: 'side::tab:t9' };
    const manager = makeManager([otherImageTag]);
    manager.tagObjects.set('side::tab:t9::A', otherImageTag);

    expect(manager.getTagObject('A', 'img-1::tab:t1')).toBeNull();
  });

  test('a base-scoped guide tag still resolves for a scoped query', () => {
    const baseTag = { strokeLabel: 'B', imageLabel: 'img-1' };
    const manager = makeManager([baseTag]);
    manager.tagObjects.set('img-1::B', baseTag);

    expect(manager.getTagObject('B', 'img-1::tab:t1')?.tagObj).toBe(baseTag);
  });
});
