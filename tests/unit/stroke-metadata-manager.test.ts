import { describe, expect, test, beforeEach, vi } from 'vitest';
import { StrokeMetadataManager } from '../../src/modules/StrokeMetadataManager';
import { TagManager } from '../../src/modules/TagManager';

function makeCanvas(objects: Array<Record<string, unknown>>) {
  return {
    getObjects: () => objects,
  };
}

describe('StrokeMetadataManager vector metadata', () => {
  beforeEach(() => {
    (window as any).lineStrokesByImage = {};
    (window as any).guideOneTimeTagByImage = {};
    (window as any).labelsByImage = {};
    (window as any).manualTagByImage = {};
    (window as any).currentImageLabel = 'front';
    (window as any).app = {
      projectManager: {
        currentViewId: 'front',
      },
    };
  });

  test('attachMetadata marks imported strokes as vector line metadata', () => {
    const manager = new StrokeMetadataManager();
    const stroke: any = {
      type: 'group',
      visible: true,
    };

    manager.attachMetadata(stroke, 'cs5b-ra-sb-back', 'L1');

    expect(stroke.strokeMetadata).toMatchObject({
      imageLabel: 'cs5b-ra-sb-back',
      strokeLabel: 'L1',
      type: 'line',
      isVector: true,
    });
    expect(manager.vectorStrokesByImage['cs5b-ra-sb-back'].L1).toBe(stroke);
  });

  test('reattaching the same stroke emits the creation event only once', () => {
    const manager = new StrokeMetadataManager();
    const stroke: any = { type: 'line', visible: true };
    let creationEvents = 0;
    const listener = () => {
      creationEvents += 1;
    };
    window.addEventListener('openpaint:stroke-created', listener);

    manager.attachMetadata(stroke, 'front', 'A4');
    manager.attachMetadata(stroke, 'front', 'A4');

    window.removeEventListener('openpaint:stroke-created', listener);
    expect(creationEvents).toBe(1);
  });

  test('rebuildMetadataFromCanvas recovers legacy guide objects with labels but no type', () => {
    const manager = new StrokeMetadataManager();
    const legacyGuideObject: any = {
      type: 'group',
      visible: true,
      strokeMetadata: {
        imageLabel: 'cs5b-ra-sb-back',
        strokeLabel: 'J1',
        visible: true,
        labelVisible: true,
      },
    };

    manager.rebuildMetadataFromCanvas('cs5b-ra-sb-back', makeCanvas([legacyGuideObject]) as any);

    expect(legacyGuideObject.strokeMetadata).toMatchObject({
      imageLabel: 'cs5b-ra-sb-back',
      strokeLabel: 'J1',
      type: 'line',
      isVector: true,
    });
    expect(manager.vectorStrokesByImage['cs5b-ra-sb-back'].J1).toBe(legacyGuideObject);
  });

  test('a manual next tag wins over a pending mini-guide seed', () => {
    const manager = new StrokeMetadataManager();
    const scope = 'front::tab:frame-1';
    (window as any).currentImageLabel = scope;
    (window as any).guideOneTimeTagByImage[scope] = 'A1';
    (window as any).labelsByImage[scope] = 'Z9';
    (window as any).manualTagByImage[scope] = 'Z9';

    expect(manager.getNextLabel(scope, 'letters+numbers')).toBe('Z9');
    expect((window as any).guideOneTimeTagByImage[scope]).toBe('A1');
    // The override survives and advances the sequence (Z9 wraps to A1) —
    // it must not be cleared back to the calculator's default.
    expect((window as any).manualTagByImage[scope]).toBe('A1');
    expect((window as any).labelsByImage[scope]).toBe('A1');
  });

  test('a typed next tag advances instead of reverting to A1', () => {
    const manager = new StrokeMetadataManager();
    const scope = 'front::tab:frame-1';
    (window as any).currentImageLabel = scope;
    // The Next-tag blur handler stores the typed value under both stores.
    (window as any).labelsByImage[scope] = 'C7';
    (window as any).manualTagByImage[scope] = 'C7';

    expect(manager.getNextLabel(scope, 'letters+numbers')).toBe('C7');
    expect((window as any).manualTagByImage[scope]).toBe('C8');
    expect((window as any).labelsByImage[scope]).toBe('C8');
  });

  test('a typed next tag stored under the base view still advances when drawing in a tab scope', () => {
    const manager = new StrokeMetadataManager();
    const scope = 'front::tab:frame-1';
    (window as any).currentImageLabel = scope;
    // The tag was committed before a capture-tab scope became active.
    (window as any).labelsByImage.front = 'B2';
    (window as any).manualTagByImage.front = 'B2';

    expect(manager.getNextLabel(scope, 'letters+numbers')).toBe('B2');
    expect((window as any).manualTagByImage.front).toBe('B3');
  });

  test('a manually reset label advances instead of creating an overlapping duplicate', () => {
    const manager = new StrokeMetadataManager();
    const scope = 'front::tab:frame-1';
    manager.vectorStrokesByImage[scope] = {
      A: { type: 'line' },
      B: { type: 'line' },
      C: { type: 'line' },
    };
    (window as any).currentImageLabel = scope;
    (window as any).manualTagByImage[scope] = 'A';

    expect(manager.getNextLabel(scope, 'letters')).toBe('D');
    expect(Object.keys(manager.vectorStrokesByImage[scope])).toContain('D');
  });

  test('consuming a guide-seeded letter does not manufacture another manual label', () => {
    const manager = new StrokeMetadataManager();
    const scope = 'front::tab:frame-1';
    (window as any).currentImageLabel = scope;
    (window as any).guideOneTimeTagByImage[scope] = 'D';

    expect(manager.getNextLabel(scope, 'letters+numbers')).toBe('D');
    expect((window as any).manualTagByImage[scope]).toBeUndefined();
    expect((window as any).labelsByImage[scope]).toBeUndefined();
  });

  test('previewing a single-letter guide label never consumes a new label', () => {
    const metadataManager = new StrokeMetadataManager();
    const getNextLabel = vi.spyOn(metadataManager, 'getNextLabel');
    const scope = 'front::tab:frame-1';
    (window as any).currentImageLabel = scope;
    (window as any).calculateNextTag = () => 'E';

    const tagManager = new TagManager({ fabricCanvas: null } as any, metadataManager);

    expect(tagManager.getNextTag(scope)).toBe('E');
    expect(getNextLabel).not.toHaveBeenCalled();
  });
});
