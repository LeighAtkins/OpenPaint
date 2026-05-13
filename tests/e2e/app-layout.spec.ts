import { test, expect, resizeViewport } from './fixtures';

type UiLayoutSnapshot = {
  viewport: { width: number; height: number };
  toolbarReady: boolean;
  wrapper: { width: number; height: number } | null;
  captureFrame: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  } | null;
  captureOverlay: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  } | null;
  imagePanel: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  } | null;
  strokePanel: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  } | null;
};

async function captureUiLayout(page: import('@playwright/test').Page): Promise<UiLayoutSnapshot> {
  return page.evaluate(() => {
    const toRect = (id: string) => {
      const el = document.getElementById(id);
      if (!(el instanceof HTMLElement)) return null;
      const rect = el.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    };

    const wrapper = document.getElementById('main-canvas-wrapper');
    const wrapperRect = wrapper?.getBoundingClientRect?.() || null;
    return {
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      toolbarReady:
        document.getElementById('topToolbar')?.classList.contains('toolbar-ready') === true,
      wrapper: wrapperRect
        ? {
            width: wrapperRect.width,
            height: wrapperRect.height,
          }
        : null,
      captureFrame: toRect('captureFrame'),
      captureOverlay: toRect('captureOverlay'),
      imagePanel: toRect('imagePanel'),
      strokePanel: toRect('strokePanel'),
    };
  });
}

function expectRectWithinViewport(
  rect: UiLayoutSnapshot['captureFrame'],
  viewport: UiLayoutSnapshot['viewport'],
  label: string
): void {
  expect(rect, `${label} should exist`).not.toBeNull();
  if (!rect) return;
  expect(rect.width, `${label} width`).toBeGreaterThan(0);
  expect(rect.height, `${label} height`).toBeGreaterThan(0);
  expect(rect.left, `${label} left`).toBeGreaterThanOrEqual(-1);
  expect(rect.top, `${label} top`).toBeGreaterThanOrEqual(-1);
  expect(rect.right, `${label} right`).toBeLessThanOrEqual(viewport.width + 1);
  expect(rect.bottom, `${label} bottom`).toBeLessThanOrEqual(viewport.height + 1);
}

test.describe('Initial UI Layout', () => {
  test('should render toolbar, canvas, panels, and capture frame in-bounds on first load', async ({
    appPage: page,
  }) => {
    const layout = await captureUiLayout(page);

    expect(layout.toolbarReady).toBe(true);
    expect(layout.wrapper?.width || 0).toBeGreaterThan(600);
    expect(layout.wrapper?.height || 0).toBeGreaterThan(400);
    expectRectWithinViewport(layout.captureOverlay, layout.viewport, 'capture overlay');
    expectRectWithinViewport(layout.captureFrame, layout.viewport, 'capture frame');
    expectRectWithinViewport(layout.imagePanel, layout.viewport, 'image panel');
    expectRectWithinViewport(layout.strokePanel, layout.viewport, 'stroke panel');
  });

  test('should keep startup UI in-bounds across the first viewport jump', async ({
    appPage: page,
  }) => {
    for (const [width, height] of [
      [900, 700],
      [1360, 900],
    ]) {
      await resizeViewport(page, width, height);
      const layout = await captureUiLayout(page);
      expect(layout.toolbarReady).toBe(true);
      expectRectWithinViewport(
        layout.captureOverlay,
        layout.viewport,
        `capture overlay ${width}x${height}`
      );
      expectRectWithinViewport(
        layout.captureFrame,
        layout.viewport,
        `capture frame ${width}x${height}`
      );
      expectRectWithinViewport(
        layout.imagePanel,
        layout.viewport,
        `image panel ${width}x${height}`
      );
      expectRectWithinViewport(
        layout.strokePanel,
        layout.viewport,
        `stroke panel ${width}x${height}`
      );
    }
  });
});
