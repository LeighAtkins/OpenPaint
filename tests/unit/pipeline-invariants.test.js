import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { CanvasManager } from '../../src/modules/CanvasManager.ts';
import { ProjectManager } from '../../src/modules/ProjectManager.ts';
import { StrokeMetadataManager } from '../../src/modules/StrokeMetadataManager.ts';

function makeProjectCanvasManager(exactTransform) {
  const canvasJSON = {
    version: '5.5.2',
    objects: [],
    viewportTransform: exactTransform.slice(),
    width: 1000,
    height: 700,
  };
  const fabricCanvas = {
    width: 1000,
    height: 700,
    viewportTransform: exactTransform.slice(),
    backgroundImage: null,
    toJSON: vi.fn(() => structuredClone(canvasJSON)),
  };

  return {
    fabricCanvas,
    toJSON: vi.fn(() => structuredClone(canvasJSON)),
    getRotationDegrees: vi.fn(() => 0),
    getViewportState: vi.fn(() => ({
      zoom: exactTransform[0],
      panX: exactTransform[4],
      panY: exactTransform[5],
      savedCanvasWidth: 1000,
      savedCanvasHeight: 700,
    })),
    getBackgroundWorldRect: vi.fn(() => null),
  };
}

describe('cross-pipeline image and annotation invariants', () => {
  beforeEach(() => {
    document.body.innerHTML = '<input id="projectName" value="Pipeline invariant test">';
    window.app = {};
    window.captureTabsByLabel = {};
    window.orderedImageLabels = [];
    window.originalImages = {};
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test('project serialization preserves the exact Fabric viewport matrix', async () => {
    const exactTransform = [1.625, 0, 0, 1.625, -183.75, -119.5];
    const canvasManager = makeProjectCanvasManager(exactTransform);
    const manager = new ProjectManager(canvasManager, { saveState: vi.fn() });
    manager.currentViewId = 'front';
    manager.views = {
      front: {
        id: 'front',
        image: null,
        canvasData: null,
        metadata: {},
        rotation: 0,
        backgroundRotation: 0,
        fitMode: 'fit-canvas',
        viewport: null,
      },
    };
    manager.buildLegacyRuntimeSnapshot = vi.fn(() => ({}));
    manager.getLegacyViewIdsFromFlatShape = vi.fn(() => []);
    manager.buildLegacyViewEntry = vi.fn(() => ({
      canvasJSON: null,
      imageUrl: null,
      metadata: {},
      tabs: null,
    }));
    manager.getProjectMetadata = vi.fn(() => ({}));

    const projectData = await manager.getProjectData({ embedImages: false });

    // restoreViewportForView reads this top-level field. Keeping the matrix only
    // inside canvasJSON is insufficient because later compatibility restores can
    // overwrite it with rounded zoom/pan values.
    expect(projectData.views.front.viewportTransform).toEqual(exactTransform);
  });

  test('a persisted base image identifier does not change with the active frame tab', () => {
    let activeScope = 'front::tab:frame-a';
    window.getCaptureTabScopedLabel = vi.fn(() => activeScope);
    const metadataManager = new StrokeMetadataManager();

    const firstResolution = metadataManager.normalizeImageLabel('front');
    activeScope = 'front::tab:frame-b';
    const secondResolution = metadataManager.normalizeImageLabel('front');

    // Loading or rebuilding the same persisted object must not silently move it
    // into whichever frame happens to be selected at that moment.
    expect(secondResolution).toBe(firstResolution);
  });

  test('layout refitting does not move an annotated background independently of its strokes', () => {
    const manager = new CanvasManager('canvas');
    manager.enableFloatingLayoutMode = false;
    const backgroundSet = vi.fn(function setBackground(values) {
      Object.assign(this, values);
    });
    const background = {
      width: 800,
      height: 600,
      left: 400,
      top: 300,
      scaleX: 1,
      scaleY: 1,
      set: backgroundSet,
      setCoords: vi.fn(),
    };
    const stroke = {
      type: 'line',
      strokeMetadata: {
        imageLabel: 'front::tab:frame-a',
        strokeLabel: 'A1',
      },
    };
    manager.fabricCanvas = {
      width: 1000,
      height: 700,
      backgroundImage: background,
      getObjects: vi.fn(() => [stroke]),
    };
    manager.getBackgroundPlacementFrame = vi.fn(() => ({
      left: 50,
      top: 25,
      width: 500,
      height: 375,
    }));
    manager.getStoredBackgroundFitMode = vi.fn(() => 'fit-canvas');

    const changed = manager.refitBackgroundImageToPlacementFrame();

    // Once annotations exist, resize should alter the camera only. Moving the
    // Fabric background in world space while leaving the line untouched breaks
    // their alignment.
    expect(changed).toBe(false);
    expect(backgroundSet).not.toHaveBeenCalled();
  });

  test('a stale asynchronous image load cannot replace the newly active view', async () => {
    const imageCallbacks = new Map();
    vi.stubGlobal('fabric', {
      Image: {
        fromURL: vi.fn((url, callback) => imageCallbacks.set(url, callback)),
      },
    });

    const canvas = {
      width: 800,
      height: 600,
      backgroundImage: null,
      setBackgroundImage: vi.fn((image, callback) => {
        canvas.backgroundImage = image;
        callback?.();
      }),
      requestRenderAll: vi.fn(),
      fire: vi.fn(),
    };
    const canvasManager = {
      fabricCanvas: canvas,
      getBackgroundPlacementFrame: vi.fn(() => ({ left: 0, top: 0, width: 800, height: 600 })),
      getBackgroundWorldRect: vi.fn(() => null),
      getViewportState: vi.fn(() => ({ zoom: 1, panX: 0, panY: 0 })),
      refitBackgroundImageToPlacementFrame: vi.fn(() => false),
      fitViewportToBackgroundPlacementFrame: vi.fn(() => false),
    };
    const manager = new ProjectManager(canvasManager, { saveState: vi.fn() });
    manager.views = {
      front: { id: 'front', image: 'front.png', fitMode: 'fit-canvas' },
      side: { id: 'side', image: 'side.png', fitMode: 'fit-canvas' },
    };
    manager.currentViewId = 'front';

    const pendingFrontLoad = manager.setBackgroundImage('front.png', 'fit-canvas');
    manager.currentViewId = 'side';

    const staleImage = {
      width: 800,
      height: 600,
      set(values) {
        Object.assign(this, values);
      },
    };
    imageCallbacks.get('front.png')(staleImage, false);
    await pendingFrontLoad;

    expect(canvas.setBackgroundImage).not.toHaveBeenCalled();
    expect(canvas.backgroundImage).toBeNull();
  });
});
