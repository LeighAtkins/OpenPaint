import { beforeEach, describe, expect, test, vi } from 'vitest';

import { ProjectManager } from '../../src/modules/ProjectManager.ts';

function makePngBlob(type = 'text/plain') {
  const pngHeader = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  ]);
  return new Blob([pngHeader], { type });
}

function makeManager() {
  const canvasManager = {
    fabricCanvas: null,
    getViewportState: vi.fn(() => ({ zoom: 1, panX: 0, panY: 0 })),
  };
  return new ProjectManager(canvasManager, null);
}

describe('ProjectManager cloud image persistence', () => {
  beforeEach(() => {
    document.body.innerHTML = '<input id="projectName" value="Cloud image test">';
    window.app = {};
  });

  test('loads R2 image bytes even when proxy metadata says text/plain', async () => {
    const manager = makeManager();
    const objectUrl = 'blob:http://localhost/r2-image';
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue(objectUrl);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        headers: new Headers({ 'content-type': 'text/plain' }),
        blob: async () => makePngBlob(),
      }))
    );

    await expect(manager.resolveR2ImageUrl('r2://projects/views/front/image')).resolves.toBe(
      objectUrl
    );

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(createObjectURL.mock.calls[0][0].type).toBe('image/png');
  });

  test('aborts cloud project data generation when an image upload fails', async () => {
    const manager = makeManager();
    manager.views = {
      front: {
        id: 'front',
        image: 'data:image/png;base64,abc',
        fitMode: 'fit-canvas',
        metadata: {},
      },
    };
    manager.currentViewId = 'front';
    manager.saveCurrentViewState = vi.fn();
    manager.buildLegacyRuntimeSnapshot = vi.fn(() => ({}));
    manager.getLegacyViewIdsFromFlatShape = vi.fn(() => []);
    manager.getProjectMetadata = vi.fn(() => ({}));
    manager.getCanvasCustomProps = vi.fn(() => []);
    manager.buildLegacyViewEntry = vi.fn(() => ({
      canvasJSON: null,
      imageUrl: null,
      metadata: {},
      tabs: null,
    }));
    manager.stripMosOverlayObjects = vi.fn();
    manager.collectScopedMetadataBuckets = vi.fn(() => ({}));
    manager.inferBackgroundWorldRectFromSerializedBackground = vi.fn(() => null);
    manager.uploadViewImageToR2 = vi.fn(async () => {
      throw new Error('upload broke');
    });

    await expect(manager.getProjectData({ uploadImagesToR2: true })).rejects.toThrow(
      'Project was not saved to avoid losing images'
    );
  });

  test('retries local R2 uploads through the API proxy when direct PUT fails', async () => {
    const manager = makeManager();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        blob: async () => makePngBlob('image/png'),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          uploadUrl: 'https://r2.example/upload',
          key: 'projects/views/front/generated.png',
        }),
      })
      .mockRejectedValueOnce(new TypeError('Load failed'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          key: 'projects/views/front/generated.png',
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    await expect(manager.uploadViewImageToR2('front', 'blob:http://localhost/image')).resolves.toBe(
      'projects/views/front/generated.png'
    );

    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining('/api/storage/r2/upload?key='),
      expect.objectContaining({ method: 'PUT' })
    );
  });

  test('resolves restore rect from the target view, not the stale live background', () => {
    const manager = makeManager();
    manager.currentViewId = 'front';
    manager.canvasManager.fabricCanvas = {
      backgroundImage: {
        getSrc: () => 'front-image',
      },
    };
    manager.canvasManager.getBackgroundWorldRect = vi.fn(() => ({
      left: 10,
      top: 10,
      width: 100,
      height: 100,
    }));
    manager.views = {
      front: {
        id: 'front',
        image: 'front-image',
        backgroundWorldRect: { left: 10, top: 10, width: 100, height: 100 },
      },
      side: {
        id: 'side',
        image: 'side-image',
        backgroundWorldRect: { left: 200, top: 220, width: 300, height: 180 },
      },
    };

    expect(manager.resolveRestoreWorldRectForView('side')).toEqual({
      left: 200,
      top: 220,
      width: 300,
      height: 180,
    });
    expect(manager.canvasManager.getBackgroundWorldRect).not.toHaveBeenCalled();
  });

  test('does not use a stale live background for a view without saved placement', () => {
    const manager = makeManager();
    manager.currentViewId = 'side';
    manager.canvasManager.fabricCanvas = {
      backgroundImage: {
        getSrc: () => 'front-image',
      },
    };
    manager.canvasManager.getBackgroundWorldRect = vi.fn(() => ({
      left: 10,
      top: 10,
      width: 100,
      height: 100,
    }));
    manager.views = {
      side: {
        id: 'side',
        image: 'side-image',
      },
    };

    expect(manager.resolveRestoreWorldRectForView('side')).toBeNull();
    expect(manager.canvasManager.getBackgroundWorldRect).not.toHaveBeenCalled();
  });

  test('does not overwrite capture-tab viewport after frame restore', () => {
    const manager = makeManager();
    const setViewportState = vi.fn();
    manager.canvasManager = {
      ...manager.canvasManager,
      setViewportState,
      fabricCanvas: {
        width: 1000,
        height: 700,
      },
    };
    window.captureTabsByLabel = {
      front: {
        activeTabId: 'tab-a',
        tabs: [
          {
            id: 'tab-a',
            type: 'normal',
            viewport: { zoom: 1, panX: 100, panY: 0 },
            captureFrame: {
              left: 100,
              top: 100,
              width: 400,
              height: 300,
              worldRect: { left: 10, top: 20, width: 400, height: 300 },
            },
          },
        ],
      },
    };
    window.applyCaptureFrameForLabel = vi.fn(label => {
      const activeTab = window.captureTabsByLabel[label].tabs[0];
      activeTab.viewport = { zoom: 1, panX: 25, panY: 0 };
    });

    manager.restoreViewportForView('front');

    expect(window.applyCaptureFrameForLabel).toHaveBeenCalledWith('front');
    expect(window.captureTabsByLabel.front.tabs[0].viewport).toEqual({
      zoom: 1,
      panX: 25,
      panY: 0,
    });
    expect(setViewportState).not.toHaveBeenCalledWith({ zoom: 1, panX: 100, panY: 0 });
  });
});
