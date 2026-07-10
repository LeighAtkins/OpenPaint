import { describe, expect, test, beforeEach } from 'vitest';
import { StrokeMetadataManager } from '../../src/modules/StrokeMetadataManager';

function makeCanvas(objects: Array<Record<string, unknown>>) {
  return {
    getObjects: () => objects,
  };
}

describe('StrokeMetadataManager vector metadata', () => {
  beforeEach(() => {
    (window as any).lineStrokesByImage = {};
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
});
