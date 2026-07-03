/**
 * Adversarial coverage for real window-edge dragging.
 *
 * Unlike resize-centering.spec.ts, these tests do not manually invoke resize()
 * or wait for every intermediate viewport. They deliberately overlap native
 * resize events, matching a person dragging the browser edge back and forth.
 */
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

type Point = { x: number; y: number };
type ResizeSnapshot = {
  frame: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };
  canvas: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };
  framePreferredCenterError: Point;
  backgroundFrameEdges: { left: number; top: number; right: number; bottom: number };
  strokeEndpoints: Point[][];
  frameCenterWorld: Point;
  zoom: number;
  fitMode: string;
};

const CENTER_TOLERANCE_PX = 3;
const EDGE_RATIO_TOLERANCE = 0.015;
const STROKE_POINT_TOLERANCE = 0.012;

async function addImage(
  page: Page,
  viewId: string,
  color: string,
  width = 960,
  height = 720
): Promise<void> {
  await page.evaluate(
    async ({ id, fill, imageWidth, imageHeight }) => {
      const source = document.createElement('canvas');
      source.width = imageWidth;
      source.height = imageHeight;
      const ctx = source.getContext('2d')!;
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, source.width, source.height);
      ctx.strokeStyle = '#1f2937';
      ctx.lineWidth = 4;
      ctx.strokeRect(24, 24, source.width - 48, source.height - 48);
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(imageWidth * 0.12, imageHeight * 0.18, imageWidth * 0.32, imageHeight * 0.25);
      await window.app!.projectManager.addImage(id, source.toDataURL('image/png'), {
        refreshBackground: true,
      });
    },
    { id: viewId, fill: color, imageWidth: width, imageHeight: height }
  );
  await page.waitForTimeout(450);
}

async function addReferenceStrokes(page: Page): Promise<void> {
  await page.evaluate(() => {
    const canvas = window.app!.canvasManager.fabricCanvas;
    const fabricApi = (window as any).fabric;
    canvas.add(
      new fabricApi.Line([130, 120, 780, 560], { stroke: '#ef4444', strokeWidth: 4 }),
      new fabricApi.Line([180, 610, 820, 170], { stroke: '#2563eb', strokeWidth: 3 })
    );
    canvas.requestRenderAll();
  });
  await page.waitForTimeout(200);
}

async function pinCurrentViewBeforeStress(page: Page): Promise<void> {
  await page.evaluate(() => {
    const viewId = window.app!.projectManager.currentViewId;
    (window as any).__recenterCaptureFrame?.(viewId);
  });
  await page.waitForTimeout(800);
}

async function switchView(page: Page, viewId: string): Promise<void> {
  await page.evaluate(id => window.app!.projectManager.switchView(id), viewId);
  await page.waitForTimeout(500);
}

async function settleResize(page: Page): Promise<void> {
  await page.waitForTimeout(850);
  await page.waitForFunction(
    () => {
      const manager = window.app?.canvasManager as any;
      return !manager?.resizeTimeout && manager?.pendingResizeFrame == null;
    },
    { timeout: 5_000 }
  );
  await page.waitForTimeout(100);
}

async function dragBurst(
  page: Page,
  sizes: Array<{ width: number; height: number }>,
  delayMs = 28
): Promise<void> {
  for (const size of sizes) {
    await page.setViewportSize(size);
    await page.waitForTimeout(delayMs);
  }
  await settleResize(page);
}

async function applyOffCenterUserZoomAndPan(page: Page): Promise<void> {
  const frame = await page.locator('#captureFrame').boundingBox();
  if (!frame) throw new Error('Capture frame is not visible');

  const zoomPoint = {
    x: frame.x + frame.width * 0.76,
    y: frame.y + frame.height * 0.32,
  };
  await page.mouse.move(zoomPoint.x, zoomPoint.y);
  await page.mouse.wheel(0, -520);
  await page.waitForTimeout(350);

  const panStart = {
    x: frame.x + frame.width * 0.52,
    y: frame.y + frame.height * 0.5,
  };
  await page.keyboard.down('Shift');
  await page.mouse.move(panStart.x, panStart.y);
  await page.mouse.down();
  await page.mouse.move(panStart.x + 86, panStart.y - 54, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.waitForTimeout(500);
}

async function setPortraitCaptureFrame(page: Page, persistManualRatios = true): Promise<void> {
  await page.evaluate(shouldPersistRatios => {
    const frame = document.getElementById('captureFrame');
    const overlay = document.getElementById('captureOverlay');
    const canvas = window.app!.canvasManager.fabricCanvas.getElement();
    if (!frame || !overlay || !canvas) throw new Error('Missing portrait frame elements');

    const overlayRect = overlay.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const height = Math.min(560, window.innerHeight * 0.7);
    const width = height * (9 / 16);
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    frame.style.left = `${centerX - width / 2 - overlayRect.left}px`;
    frame.style.top = `${centerY - height / 2 - overlayRect.top}px`;
    frame.style.width = `${width}px`;
    frame.style.height = `${height}px`;

    const viewId = window.app!.projectManager.currentViewId;
    if (shouldPersistRatios) {
      window.manualFrameRatios = window.manualFrameRatios || {};
      window.manualFrameRatios[viewId] = {
        widthRatio: width / canvasRect.width,
        heightRatio: height / canvasRect.height,
        leftRatio: (centerX - width / 2 - canvasRect.left) / canvasRect.width,
        topRatio: (centerY - height / 2 - canvasRect.top) / canvasRect.height,
      };
    }
    (window as any).saveCurrentCaptureFrameForLabel?.(viewId);
  }, persistManualRatios);
  await page.waitForTimeout(500);
}

async function snapshot(page: Page): Promise<ResizeSnapshot> {
  return page.evaluate(() => {
    const manager = window.app!.canvasManager;
    const canvas = manager.fabricCanvas;
    const background = canvas.backgroundImage;
    const frameElement = document.getElementById('captureFrame');
    const fabricApi = (window as any).fabric;
    if (!background || !frameElement || !fabricApi) {
      throw new Error('Resize snapshot requires a background image and capture frame');
    }

    const canvasRect = canvas.getElement().getBoundingClientRect();
    const frameRect = frameElement.getBoundingClientRect();
    const toolbarRect = document.querySelector('.toolbar-wrap')?.getBoundingClientRect();
    const controlsRect = document.getElementById('canvasControls')?.getBoundingClientRect();
    const strokePanelRect = document.getElementById('strokePanel')?.getBoundingClientRect();
    const imagePanelRect = document.getElementById('imagePanel')?.getBoundingClientRect();
    const preferredLeft = Math.max(0, Math.round((strokePanelRect?.right ?? 0) + 16));
    const preferredRight = Math.min(
      window.innerWidth,
      Math.round((imagePanelRect?.left ?? window.innerWidth) - 16)
    );
    const preferredTop = Math.max(0, Math.round((toolbarRect?.bottom ?? 0) + 12));
    const controlsHeight = Math.max(0, controlsRect?.height || 0);
    const preferredBottom = Math.min(
      window.innerHeight,
      Math.round(window.innerHeight - Math.max(12, controlsHeight + 24))
    );
    const viewport = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
    const backgroundTransform = fabricApi.util.multiplyTransformMatrices(
      viewport,
      background.calcTransformMatrix()
    );
    const halfWidth = (Number(background.width) || 0) / 2;
    const halfHeight = (Number(background.height) || 0) / 2;
    const backgroundCorners = [
      new fabricApi.Point(-halfWidth, -halfHeight),
      new fabricApi.Point(halfWidth, -halfHeight),
      new fabricApi.Point(halfWidth, halfHeight),
      new fabricApi.Point(-halfWidth, halfHeight),
    ].map((point: any) => fabricApi.util.transformPoint(point, backgroundTransform));
    const xs = backgroundCorners.map((point: Point) => point.x);
    const ys = backgroundCorners.map((point: Point) => point.y);
    const backgroundRect = {
      left: Math.min(...xs),
      top: Math.min(...ys),
      right: Math.max(...xs),
      bottom: Math.max(...ys),
    };
    const frame = {
      left: frameRect.left - canvasRect.left,
      top: frameRect.top - canvasRect.top,
      right: frameRect.right - canvasRect.left,
      bottom: frameRect.bottom - canvasRect.top,
      width: frameRect.width,
      height: frameRect.height,
    };
    const inverseViewport = fabricApi.util.invertTransform(viewport);
    const frameCenterWorld = fabricApi.util.transformPoint(
      new fabricApi.Point(frame.left + frame.width / 2, frame.top + frame.height / 2),
      inverseViewport
    );

    const normalizePoint = (point: Point): Point => ({
      x: (point.x - backgroundRect.left) / Math.max(backgroundRect.right - backgroundRect.left, 1),
      y: (point.y - backgroundRect.top) / Math.max(backgroundRect.bottom - backgroundRect.top, 1),
    });

    const strokeEndpoints = canvas
      .getObjects()
      .filter((object: any) => object?.type === 'line' && !object?.isConnectorLine)
      .map((line: any) => {
        const local = line.calcLinePoints();
        const transform = fabricApi.util.multiplyTransformMatrices(
          viewport,
          line.calcTransformMatrix()
        );
        return [
          normalizePoint(
            fabricApi.util.transformPoint(new fabricApi.Point(local.x1, local.y1), transform)
          ),
          normalizePoint(
            fabricApi.util.transformPoint(new fabricApi.Point(local.x2, local.y2), transform)
          ),
        ];
      });

    return {
      frame,
      canvas: {
        left: 0,
        top: 0,
        right: canvasRect.width,
        bottom: canvasRect.height,
        width: canvasRect.width,
        height: canvasRect.height,
      },
      framePreferredCenterError: {
        x: frameRect.left + frameRect.width / 2 - (preferredLeft + preferredRight) / 2,
        y: frameRect.top + frameRect.height / 2 - (preferredTop + preferredBottom) / 2,
      },
      backgroundFrameEdges: {
        left: (backgroundRect.left - frame.left) / Math.max(frame.width, 1),
        top: (backgroundRect.top - frame.top) / Math.max(frame.height, 1),
        right: (frame.right - backgroundRect.right) / Math.max(frame.width, 1),
        bottom: (frame.bottom - backgroundRect.bottom) / Math.max(frame.height, 1),
      },
      strokeEndpoints,
      frameCenterWorld: { x: frameCenterWorld.x, y: frameCenterWorld.y },
      zoom: manager.zoomLevel,
      fitMode: String(
        window.app!.projectManager.views?.[window.app!.projectManager.currentViewId]?.fitMode || ''
      ),
    };
  });
}

function expectPinned(actual: ResizeSnapshot, baseline: ResizeSnapshot, label: string): void {
  expect(
    Math.abs(actual.framePreferredCenterError.x),
    `${label}: frame wandered horizontally`
  ).toBeLessThan(CENTER_TOLERANCE_PX);
  expect(
    Math.abs(actual.framePreferredCenterError.y),
    `${label}: frame wandered vertically`
  ).toBeLessThan(CENTER_TOLERANCE_PX);

  for (const edge of ['left', 'top', 'right', 'bottom'] as const) {
    expect(
      Math.abs(actual.backgroundFrameEdges[edge] - baseline.backgroundFrameEdges[edge]),
      `${label}: ${edge} image corner unpinned; baseline=${baseline.backgroundFrameEdges[edge].toFixed(4)} actual=${actual.backgroundFrameEdges[edge].toFixed(4)}`
    ).toBeLessThan(EDGE_RATIO_TOLERANCE);
  }

  expect(actual.strokeEndpoints.length, `${label}: stroke count changed`).toBe(
    baseline.strokeEndpoints.length
  );
  for (let stroke = 0; stroke < actual.strokeEndpoints.length; stroke++) {
    for (let endpoint = 0; endpoint < 2; endpoint++) {
      expect(
        Math.abs(
          actual.strokeEndpoints[stroke][endpoint].x - baseline.strokeEndpoints[stroke][endpoint].x
        ),
        `${label}: stroke ${stroke} endpoint ${endpoint} drifted horizontally`
      ).toBeLessThan(STROKE_POINT_TOLERANCE);
      expect(
        Math.abs(
          actual.strokeEndpoints[stroke][endpoint].y - baseline.strokeEndpoints[stroke][endpoint].y
        ),
        `${label}: stroke ${stroke} endpoint ${endpoint} drifted vertically`
      ).toBeLessThan(STROKE_POINT_TOLERANCE);
    }
  }
}

test.describe('Repeated window-edge drag stress', () => {
  test('alternating larger and smaller drag bursts keep every corner pinned', async ({
    appPage: page,
  }) => {
    await addImage(page, 'front', '#dbeafe');
    await addReferenceStrokes(page);
    await pinCurrentViewBeforeStress(page);
    const baseline = await snapshot(page);

    const bursts = [
      [
        { width: 1180, height: 760 },
        { width: 1030, height: 690 },
        { width: 860, height: 580 },
      ],
      [
        { width: 980, height: 640 },
        { width: 1270, height: 810 },
        { width: 1510, height: 900 },
      ],
      [
        { width: 1390, height: 840 },
        { width: 1110, height: 680 },
        { width: 790, height: 540 },
      ],
      [
        { width: 920, height: 610 },
        { width: 1240, height: 780 },
        { width: 1280, height: 800 },
      ],
    ];

    for (let index = 0; index < bursts.length; index++) {
      await dragBurst(page, bursts[index]);
      const current = await snapshot(page);
      expectPinned(current, baseline, `alternating burst ${index + 1}`);
    }
  });

  test('random resize scrub does not accumulate image or stroke drift', async ({
    appPage: page,
  }) => {
    await addImage(page, 'front', '#dcfce7');
    await addReferenceStrokes(page);
    await pinCurrentViewBeforeStress(page);
    const baseline = await snapshot(page);
    const sizes = [
      { width: 1460, height: 880 },
      { width: 810, height: 550 },
      { width: 1190, height: 730 },
      { width: 930, height: 790 },
      { width: 1540, height: 690 },
      { width: 760, height: 620 },
      { width: 1320, height: 860 },
      { width: 1040, height: 570 },
      { width: 1280, height: 800 },
    ];

    for (let round = 0; round < 3; round++) {
      await dragBurst(page, sizes, 18);
      expectPinned(await snapshot(page), baseline, `random scrub round ${round + 1}`);
    }
  });

  test('user zoom remains pinned through repeated resize reversals', async ({ appPage: page }) => {
    await addImage(page, 'front', '#fef3c7');
    await addReferenceStrokes(page);
    await page.locator('#frameScaleIncrease').click();
    await page.locator('#frameScaleIncrease').click();
    await page.locator('#frameScaleIncrease').click();
    await page.waitForTimeout(800);
    const baseline = await snapshot(page);

    for (let round = 0; round < 4; round++) {
      await dragBurst(page, [
        { width: 1500, height: 900 },
        { width: 1010, height: 650 },
        { width: 720, height: 520 },
        { width: 1280, height: 800 },
      ]);
      expectPinned(await snapshot(page), baseline, `zoomed reversal ${round + 1}`);
    }
  });

  test('inactive images retain their own pinned geometry after drag bursts', async ({
    appPage: page,
  }) => {
    await addImage(page, 'front', '#e0e7ff');
    await addReferenceStrokes(page);
    await pinCurrentViewBeforeStress(page);
    const frontBaseline = await snapshot(page);

    await addImage(page, 'side', '#fee2e2');
    await switchView(page, 'side');
    await addReferenceStrokes(page);
    await pinCurrentViewBeforeStress(page);
    const sideBaseline = await snapshot(page);
    await switchView(page, 'front');

    for (let round = 0; round < 3; round++) {
      await dragBurst(page, [
        { width: 840, height: 560 },
        { width: 1430, height: 870 },
        { width: 970, height: 630 },
        { width: 1280, height: 800 },
      ]);
      expectPinned(await snapshot(page), frontBaseline, `front round ${round + 1}`);
      await switchView(page, 'side');
      expectPinned(await snapshot(page), sideBaseline, `side round ${round + 1}`);
      await switchView(page, 'front');
    }
  });

  test('off-center wheel zoom and pan keep the same crop pinned during resize', async ({
    appPage: page,
  }) => {
    await addImage(page, 'front', '#dbeafe');
    await addReferenceStrokes(page);
    await pinCurrentViewBeforeStress(page);
    await applyOffCenterUserZoomAndPan(page);
    const baseline = await snapshot(page);

    await dragBurst(
      page,
      [
        { width: 1120, height: 720 },
        { width: 1460, height: 900 },
      ],
      210
    );
    const resized = await snapshot(page);

    expectPinned(resized, baseline, 'off-center crop');
    expect(Math.abs(resized.frameCenterWorld.x - baseline.frameCenterWorld.x)).toBeLessThan(1);
    expect(Math.abs(resized.frameCenterWorld.y - baseline.frameCenterWorld.y)).toBeLessThan(1);
  });

  test('active pointer-zoomed image scales proportionally from a small to large window', async ({
    appPage: page,
  }) => {
    await page.setViewportSize({ width: 790, height: 560 });
    await settleResize(page);
    await addImage(page, 'front', '#fef3c7');
    await addReferenceStrokes(page);
    await pinCurrentViewBeforeStress(page);
    await applyOffCenterUserZoomAndPan(page);
    const small = await snapshot(page);

    await dragBurst(
      page,
      [
        { width: 1040, height: 700 },
        { width: 1510, height: 900 },
      ],
      210
    );
    const large = await snapshot(page);
    const frameScale = large.frame.width / small.frame.width;
    const zoomScale = large.zoom / small.zoom;

    expect(large.frame.width, 'active frame should grow with the available page').toBeGreaterThan(
      small.frame.width + 100
    );
    expect(
      Math.abs(zoomScale - frameScale),
      `zoom should track frame growth: frame=${frameScale.toFixed(3)} zoom=${zoomScale.toFixed(3)}`
    ).toBeLessThan(0.03);
    expectPinned(large, small, 'small-to-large active crop');
  });

  test('zoomed crop anchor survives repeated large-small-large reversals', async ({
    appPage: page,
  }) => {
    await addImage(page, 'front', '#dcfce7');
    await addReferenceStrokes(page);
    await pinCurrentViewBeforeStress(page);
    await applyOffCenterUserZoomAndPan(page);
    const baseline = await snapshot(page);

    const sizes = [
      { width: 1510, height: 900 },
      { width: 830, height: 570 },
      { width: 1370, height: 820 },
      { width: 760, height: 540 },
      { width: 1280, height: 800 },
    ];
    for (let round = 0; round < 3; round++) {
      await dragBurst(page, sizes, 190);
      const current = await snapshot(page);
      expectPinned(current, baseline, `zoomed crop reversal ${round + 1}`);
      expect(Math.abs(current.frameCenterWorld.x - baseline.frameCenterWorld.x)).toBeLessThan(1);
      expect(Math.abs(current.frameCenterWorld.y - baseline.frameCenterWorld.y)).toBeLessThan(1);
    }
  });

  test('9:16 frame keeps its portrait aspect and zoomed crop when the window aspect changes', async ({
    appPage: page,
  }) => {
    await addImage(page, 'front', '#dbeafe', 540, 960);
    await addReferenceStrokes(page);
    await setPortraitCaptureFrame(page);
    await applyOffCenterUserZoomAndPan(page);
    const baseline = await snapshot(page);

    await dragBurst(
      page,
      [
        { width: 1510, height: 720 },
        { width: 860, height: 900 },
        { width: 1280, height: 800 },
      ],
      210
    );
    const current = await snapshot(page);

    expect(current.frame.width / current.frame.height).toBeCloseTo(9 / 16, 2);
    expectPinned(current, baseline, '9:16 aspect resize');
    expect(Math.abs(current.frameCenterWorld.x - baseline.frameCenterWorld.x)).toBeLessThan(1);
    expect(Math.abs(current.frameCenterWorld.y - baseline.frameCenterWorld.y)).toBeLessThan(1);
  });

  test('9:16 active frame and zoom grow uniformly from a small to large window', async ({
    appPage: page,
  }) => {
    await page.setViewportSize({ width: 760, height: 600 });
    await settleResize(page);
    await addImage(page, 'front', '#fef3c7', 540, 960);
    await addReferenceStrokes(page);
    await setPortraitCaptureFrame(page);
    await applyOffCenterUserZoomAndPan(page);
    const small = await snapshot(page);

    await dragBurst(page, [{ width: 1510, height: 1000 }], 210);
    const large = await snapshot(page);
    const widthScale = large.frame.width / small.frame.width;
    const heightScale = large.frame.height / small.frame.height;
    const zoomScale = large.zoom / small.zoom;

    expect(large.frame.height).toBeGreaterThan(small.frame.height + 100);
    expect(Math.abs(widthScale - heightScale)).toBeLessThan(0.015);
    expect(Math.abs(zoomScale - heightScale)).toBeLessThan(0.03);
    expect(large.frame.width / large.frame.height).toBeCloseTo(9 / 16, 2);
    expectPinned(large, small, '9:16 small-to-large');
  });

  test('saved 9:16 tab geometry controls resize even without transient manual ratios', async ({
    appPage: page,
  }) => {
    await addImage(page, 'front', '#dcfce7', 540, 960);
    await addReferenceStrokes(page);
    await setPortraitCaptureFrame(page, false);
    await applyOffCenterUserZoomAndPan(page);
    const baseline = await snapshot(page);

    await dragBurst(
      page,
      [
        { width: 900, height: 640 },
        { width: 1460, height: 920 },
      ],
      210
    );
    const current = await snapshot(page);

    expect(current.frame.width / current.frame.height).toBeCloseTo(9 / 16, 2);
    expectPinned(current, baseline, 'saved 9:16 tab geometry');
  });
});
