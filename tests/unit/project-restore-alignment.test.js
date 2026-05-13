import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CanvasManager } from '../../src/modules/CanvasManager.ts';
import { ProjectManager } from '../../src/modules/ProjectManager.ts';
import {
  getCenteredBoxWorldRect,
  mapWorldRectToViewport,
  fitViewportToWorldRect,
} from '../../src/modules/utils/viewportRestore.ts';

function createCanvasManagerStub() {
  const canvasRect = {
    left: 10,
    top: 20,
    width: 800,
    height: 600,
    right: 810,
    bottom: 620,
  };

  return {
    toJSON: vi.fn(() => ({ objects: [] })),
    getRotationDegrees: vi.fn(() => 0),
    getBackgroundImageRotationDegrees: vi.fn(() => 0),
    getViewportState: vi.fn(() => ({ zoom: 1, panX: 5, panY: 6 })),
    setViewportState: vi.fn(),
    setRotationDegrees: vi.fn(),
    getRotationCenter: vi.fn(() => ({ x: 400, y: 300 })),
    getBackgroundPlacementFrame: vi.fn(() => ({ left: 100, top: 50, width: 400, height: 200 })),
    fabricCanvas: {
      width: 800,
      height: 600,
      lowerCanvasEl: {
        getBoundingClientRect: () => canvasRect,
      },
      backgroundImage: null,
    },
  };
}

describe('project restore alignment helpers', () => {
  beforeEach(() => {
    window.app = {};
    window.captureTabsByLabel = {};
  });

  it('fits the same world rect into different target windows consistently', () => {
    const worldRect = { left: 0, top: 0, width: 100, height: 50 };
    const targetA = { left: 0, top: 0, width: 200, height: 100 };
    const targetB = { left: 50, top: 25, width: 400, height: 200 };

    const viewportA = fitViewportToWorldRect(worldRect, { zoom: 1, panX: 0, panY: 0 }, targetA, {
      canvasRect: { left: 0, top: 0 },
      center: { x: 0, y: 0 },
    });
    const viewportB = fitViewportToWorldRect(worldRect, { zoom: 1, panX: 0, panY: 0 }, targetB, {
      canvasRect: { left: 0, top: 0 },
      center: { x: 0, y: 0 },
    });

    expect(
      mapWorldRectToViewport(worldRect, viewportA, {
        canvasRect: { left: 0, top: 0 },
        center: { x: 0, y: 0 },
      })
    ).toEqual(targetA);
    expect(
      mapWorldRectToViewport(worldRect, viewportB, {
        canvasRect: { left: 0, top: 0 },
        center: { x: 0, y: 0 },
      })
    ).toEqual(targetB);
  });

  it('extracts saved background placement from serialized canvas data', () => {
    const manager = new ProjectManager(createCanvasManagerStub(), {
      saveState: vi.fn(),
      clear: vi.fn(),
    });
    manager.views.front.fitMode = 'fit-width';
    manager.views.front.canvasData = {
      backgroundImage: {
        left: 123,
        top: 234,
        scaleX: 1.5,
        scaleY: 1.25,
        angle: 12,
        originX: 'left',
        originY: 'top',
      },
    };

    expect(
      manager.extractBackgroundPlacementFromCanvasData(manager.views.front.canvasData)
    ).toEqual({
      left: 123,
      top: 234,
      scaleX: 1.5,
      scaleY: 1.25,
      angle: 12,
      originX: 'left',
      originY: 'top',
    });
    expect(manager.getBackgroundRestoreOptionsForView('front')).toEqual({
      fitMode: 'fit-width',
      savedPlacement: {
        left: 123,
        top: 234,
        scaleX: 1.5,
        scaleY: 1.25,
        angle: 12,
        originX: 'left',
        originY: 'top',
      },
    });
  });

  it('saves restoreWorldRect from the active tab world rect when present', () => {
    const canvasManager = createCanvasManagerStub();
    const manager = new ProjectManager(canvasManager, { saveState: vi.fn(), clear: vi.fn() });
    manager.currentViewId = 'front';
    window.captureTabsByLabel.front = {
      activeTabId: 'tab-1',
      tabs: [
        {
          id: 'tab-1',
          captureFrame: {
            worldRect: { left: 25, top: 30, width: 200, height: 100 },
          },
        },
      ],
    };

    manager.saveCurrentViewState();

    expect(manager.views.front.restoreWorldRect).toEqual({
      left: 25,
      top: 30,
      width: 200,
      height: 100,
    });
  });

  it('falls back to the live background bounds when there is no tab world rect', () => {
    const canvasManager = createCanvasManagerStub();
    canvasManager.fabricCanvas.backgroundImage = {
      angle: 0,
      getCenterPoint: () => ({ x: 200, y: 100 }),
      getScaledWidth: () => 300,
      getScaledHeight: () => 150,
    };
    const manager = new ProjectManager(canvasManager, { saveState: vi.fn(), clear: vi.fn() });
    manager.currentViewId = 'front';

    manager.saveCurrentViewState();

    expect(manager.views.front.restoreWorldRect).toEqual(
      getCenteredBoxWorldRect({
        center: { x: 200, y: 100 },
        width: 300,
        height: 150,
        angle: 0,
      })
    );
  });

  it('restores framing from restoreWorldRect instead of raw viewport on a new window size', () => {
    const canvasManager = createCanvasManagerStub();
    const manager = new ProjectManager(canvasManager, { saveState: vi.fn(), clear: vi.fn() });
    manager.views.front = {
      ...manager.views.front,
      rotation: 0,
      tabs: null,
      viewport: { zoom: 1, panX: 5, panY: 6 },
      restoreWorldRect: { left: 0, top: 0, width: 100, height: 50 },
    };

    manager.restoreViewportForView('front');

    expect(canvasManager.setViewportState).toHaveBeenCalledTimes(1);
    expect(canvasManager.setViewportState).not.toHaveBeenCalledWith({ zoom: 1, panX: 5, panY: 6 });

    const [restoredViewport] = canvasManager.setViewportState.mock.calls[0];
    const mappedRect = mapWorldRectToViewport(
      manager.views.front.restoreWorldRect,
      { ...restoredViewport, rotation: 0 },
      {
        canvasRect: { left: 10, top: 20 },
        center: { x: 400, y: 300 },
      }
    );

    expect(mappedRect.left).toBeCloseTo(110, 5);
    expect(mappedRect.top).toBeCloseTo(70, 5);
    expect(mappedRect.width).toBeCloseTo(400, 5);
    expect(mappedRect.height).toBeCloseTo(200, 5);
  });
});

describe('CanvasManager saved background placement', () => {
  it('skips placement-frame refits for saved-placement backgrounds', () => {
    const manager = new CanvasManager('canvas');
    manager.fabricCanvas = {
      backgroundImage: {
        openpaintPlacementMode: 'saved-placement',
      },
    };

    expect(manager.hasSavedBackgroundPlacement()).toBe(true);
    expect(manager.refitBackgroundImageToPlacementFrame()).toBe(false);
  });
});
