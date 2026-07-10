import { describe, expect, test } from 'vitest';
import {
  ensurePdfCaptureBackground,
  getPdfQuantityOptions,
  switchPdfCaptureView,
  waitForPdfProjectIdle,
} from '../../src/modules/ui/pdf-export-inline';

class QueuedProjectManager {
  constructor() {
    this.currentViewId = 'front';
    this.isSwitchingView = true;
    this.pendingSwitchViewId = null;
    this.views = { front: {}, cushion: {} };
    this.switchCalls = [];
  }

  async switchView(viewId) {
    if (this.isSwitchingView) {
      this.pendingSwitchViewId = viewId;
      return;
    }
    this.isSwitchingView = true;
    this.switchCalls.push(viewId);
    await Promise.resolve();
    this.currentViewId = viewId;
    this.isSwitchingView = false;
  }

  async whenIdle({ timeoutMs = 5000 } = {}) {
    const startedAt = Date.now();
    while (this.isSwitchingView || this.pendingSwitchViewId) {
      if (Date.now() - startedAt > timeoutMs) throw new Error('idle timeout');
      await new Promise(resolve => setTimeout(resolve, 1));
    }
  }
}

describe('PDF capture switching', () => {
  test('reloads the requested view when the live background belongs to another image', async () => {
    const backgroundImage = { src: 'data:image/png;base64,SECOND' };
    const manager = {
      currentViewId: 'front',
      isSwitchingView: false,
      pendingSwitchViewId: null,
      views: { front: { image: 'data:image/png;base64,FIRST' } },
      canvasManager: {
        fabricCanvas: {
          backgroundImage,
          requestRenderAll() {},
        },
      },
      async switchView() {
        backgroundImage.src = this.views.front.image;
      },
      async whenIdle() {},
    };

    await ensurePdfCaptureBackground(manager, 'front');

    expect(backgroundImage.src).toBe(manager.views.front.image);
  });

  test('offers one simple quantity checkbox per PDF image and suggests cushion labels', () => {
    const options = getPdfQuantityOptions(
      [
        { type: 'single', target: { viewId: 'seat' } },
        { type: 'single', target: { viewId: 'frame' } },
      ],
      { seat: 'Seat cushion', frame: 'Sofa frame' }
    );

    expect(options).toEqual([
      { key: 'seat', label: 'Seat cushion', checked: true },
      { key: 'frame', label: 'Sofa frame', checked: false },
    ]);
  });

  test('uses generic image names when no image part labels were entered', () => {
    const options = getPdfQuantityOptions(
      [
        { type: 'single', target: { viewId: 'front', viewIndex: 0 } },
        { type: 'single', target: { viewId: 'side', viewIndex: 1 } },
        { type: 'single', target: { viewId: 'back', viewIndex: 2 } },
      ],
      {}
    );

    expect(options.map(option => option.label)).toEqual(['Image 1', 'Image 2', 'Image 3']);
    expect(options.map(option => option.key)).toEqual(['front', 'side', 'back']);
  });

  test('waits for an existing switch before starting the requested capture switch', async () => {
    const manager = new QueuedProjectManager();
    setTimeout(() => {
      manager.isSwitchingView = false;
    }, 2);

    await switchPdfCaptureView(manager, 'cushion');

    expect(manager.currentViewId).toBe('cushion');
    expect(manager.switchCalls).toEqual(['cushion']);
    expect(manager.pendingSwitchViewId).toBeNull();
  });

  test('does not mutate switching flags while waiting for the manager to settle', async () => {
    const manager = new QueuedProjectManager();
    const waiting = waitForPdfProjectIdle(manager, 100);

    expect(manager.isSwitchingView).toBe(true);
    manager.isSwitchingView = false;
    await waiting;

    expect(manager.isSwitchingView).toBe(false);
  });

  test('fails clearly instead of capturing the wrong active view', async () => {
    const manager = new QueuedProjectManager();
    manager.isSwitchingView = false;
    manager.switchView = async () => {};

    await expect(switchPdfCaptureView(manager, 'cushion')).rejects.toThrow(
      'PDF export could not activate cushion'
    );
  });
});
