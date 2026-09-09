import { describe, expect, it, vi } from 'vitest';
import {
  separateTag,
  readTagOffsets,
  type TagBox,
} from '../../src/modules/measurement-mos/mos-tag-layout';
import { MeasurementOverlayManager } from '../../src/modules/measurement-mos/MeasurementOverlayManager';
vi.mock('../../src/modules/measurement-mos/mos-exporter', () => ({
  exportMosSvg: () => '<svg />',
}));

describe('Imported measurement tags', () => {
  it('separates crowded labels without moving an already clear source anchor', () => {
    const boxes: TagBox[] = [];
    for (let i = 0; i < 12; i++) {
      const placed = separateTag({ x: 400, y: 300, width: 52, height: 48 }, boxes);
      for (const other of boxes)
        expect(
          Math.abs(placed.x - other.x) >= 52 + 8 || Math.abs(placed.y - other.y) >= 48 + 8
        ).toBe(true);
      boxes.push(placed);
    }
    const clear = { x: 20, y: 20, width: 52, height: 48 };
    expect(separateTag(clear, boxes)).toEqual(clear);
  });
  it('captures dragged offsets before unmount and includes them in project data', () => {
    const overlay = { id: 'one', viewId: 'front', elements: new Map(), tagOffsets: {} };
    const stroke = { customData: { layerType: 'mos-overlay', overlayId: 'one' } };
    const tag = { isTag: true, strokeLabel: 'A1', left: 450, top: 120, connectedStroke: stroke };
    const canvas = {
      width: 1000,
      height: 500,
      getObjects: () => [tag, stroke],
      remove: vi.fn(),
      requestRenderAll: vi.fn(),
    };
    const manager = Object.create(MeasurementOverlayManager.prototype) as any;
    manager.canvasManager = { fabricCanvas: canvas };
    manager.store = { byId: new Map([['one', overlay]]), order: ['one'], nextOverlayIndex: 1 };
    manager._clearOverlayTags = vi.fn();
    (window as any).app = { tagManager: { getCanvasObjectCenter: () => ({ x: 400, y: 250 }) } };
    manager.unmountView('front');
    expect(overlay.tagOffsets).toEqual({ A1: { x: 0.05, y: -0.26 } });
    expect(manager.toJSON().overlays[0].tagOffsets).toEqual(overlay.tagOffsets);
    // Different image scale preserves the same normalised offset.
    canvas.width = 2000;
    canvas.height = 1000;
    tag.left = 500;
    tag.top = -10;
    manager.unmountView('front');
    expect(overlay.tagOffsets).toEqual({ A1: { x: 0.05, y: -0.26 } });
  });
  it('restores saved offsets after the SVG import and before tag remount', async () => {
    const manager = Object.create(MeasurementOverlayManager.prototype) as any;
    const restored = { tagOffsets: { A1: { x: 0, y: 0 } } };
    manager.store = { byId: new Map([['restored', restored]]) };
    manager._resetOverlaysForLoad = vi.fn();
    manager.importSvg = vi.fn().mockResolvedValue('restored');
    manager._clearOverlayTags = vi.fn();
    manager._syncOverlayTags = vi.fn(() =>
      expect(restored.tagOffsets).toEqual({ A1: { x: 0.12, y: -0.25 } })
    );
    (window as any).app = { projectManager: { currentViewId: 'front' } };
    await manager.fromJSON({
      overlays: [{ viewId: 'front', svgText: '<svg/>', tagOffsets: { A1: { x: 0.12, y: -0.25 } } }],
    });
    expect(manager._syncOverlayTags).toHaveBeenCalledWith('restored');
    expect(readTagOffsets({ A1: { x: NaN, y: 0 }, A2: { x: 1, y: 2 } })).toEqual({
      A2: { x: 1, y: 2 },
    });
  });
});

it('does not reset the saved label size when guide tags are synchronized', () => {
  const persist = vi.fn();
  const canvas = { getObjects: () => [], remove: vi.fn() };
  const manager = Object.create(MeasurementOverlayManager.prototype) as any;
  manager.canvasManager = { fabricCanvas: canvas };
  manager.store = { byId: new Map([['one', { id: 'one', viewId: 'front', elements: new Map() }]]) };
  manager._overlayTagKeys = new Map();
  for (const method of [
    '_captureTagOffsets',
    '_clearOverlayTags',
    '_pruneDuplicateMosObjectsById',
    '_pruneLegacyCurveArrowArtifacts',
    '_pushDebug',
  ])
    manager[method] = vi.fn();
  const previousApp = (window as any).app;
  (window as any).app = { tagManager: { tagSize: 22, persistTagSizeToMetadata: persist } };
  try {
    manager._syncOverlayTags('one');
    expect(persist).not.toHaveBeenCalled();
    expect((window as any).app.tagManager.tagSize).toBe(22);
  } finally {
    (window as any).app = previousApp;
  }
});

it('uses the circular guide label instead of the numeric input box as its anchor', () => {
  const manager = Object.create(MeasurementOverlayManager.prototype) as any;
  const overlay = {
    elements: new Map([
      [
        'value',
        {
          kind: 'label',
          roleToken: 'E1',
          label: { text: '0000.00', cx: 800, cy: 100 },
          endpoints: [],
        },
      ],
      ['circle', { kind: 'label', roleToken: 'E1', endpoints: [{ point: { x: 760, y: 200 } }] }],
      [
        'text',
        { kind: 'label', roleToken: 'E1', label: { text: 'E1', cx: 748, cy: 210 }, endpoints: [] },
      ],
    ]),
  };
  expect(manager._collectRoleAnchors(overlay).get('E1')).toEqual({ x: 760, y: 200 });
});
