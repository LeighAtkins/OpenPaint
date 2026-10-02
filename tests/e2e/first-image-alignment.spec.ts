import { test, expect, waitForApp } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * Regression test: the first image uploaded to a fresh project must be centered
 * in the capture frame. A previous bug left landscape/square images offset by
 * ~50px because the capture-frame replay overwrote the centered viewport with a
 * stale-anchor pan. Checks landscape, portrait, tall-portrait, and square
 * aspect ratios. Waits past the 220ms re-align pass and the resize coordinator.
 */

interface Alignment {
  bgCx: number;
  bgCy: number;
  frameCx: number;
  frameCy: number;
  dx: number;
  dy: number;
  fitMode: string;
  zoom: number;
  imgW: number;
  imgH: number;
  edgeError: number;
}

async function measure(page: Page): Promise<Alignment | null> {
  return page.evaluate(() => {
    const cm = window.app?.canvasManager;
    const canvas = cm?.fabricCanvas;
    const captureFrame = document.getElementById('captureFrame');
    if (!canvas || !captureFrame) return null;
    const bg = canvas.backgroundImage;
    if (!bg) return null;
    const fabricApi = (window as any).fabric;

    // Background center in SCREEN/canvas-element space (apply viewport).
    const vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
    const center = bg.getCenterPoint?.() ?? { x: bg.left, y: bg.top };
    const mapped = fabricApi.util.transformPoint(new fabricApi.Point(center.x, center.y), vpt);

    const canvasRect = canvas.getElement?.()?.getBoundingClientRect?.();
    const frameRect = captureFrame.getBoundingClientRect();
    if (!canvasRect || !frameRect) return null;

    // mapped is relative to the canvas element's top-left (origin), same as
    // frameRect.left - canvasRect.left.
    const frameCx = frameRect.left - canvasRect.left + frameRect.width / 2;
    const frameCy = frameRect.top - canvasRect.top + frameRect.height / 2;

    const viewId = window.app?.projectManager?.currentViewId;
    const fitMode = window.app?.projectManager?.views?.[viewId || '']?.fitMode;

    return {
      bgCx: +mapped.x.toFixed(2),
      bgCy: +mapped.y.toFixed(2),
      frameCx: +frameCx.toFixed(2),
      frameCy: +frameCy.toFixed(2),
      dx: +(mapped.x - frameCx).toFixed(2),
      dy: +(mapped.y - frameCy).toFixed(2),
      fitMode: String(fitMode || ''),
      zoom: +(cm?.zoomLevel || 0).toFixed(4),
      imgW: bg.width || 0,
      imgH: bg.height || 0,
      edgeError: Math.max(
        Math.abs((bg.width || 0) * (bg.scaleX || 1) * (cm?.zoomLevel || 1) - frameRect.width),
        Math.abs((bg.height || 0) * (bg.scaleY || 1) * (cm?.zoomLevel || 1) - frameRect.height)
      ),
    };
  });
}

async function uploadImage(page: Page, w: number, h: number) {
  await page.evaluate(
    ({ w, h }) => {
      return new Promise<void>(resolve => {
        const off = document.createElement('canvas');
        off.width = w;
        off.height = h;
        const ctx = off.getContext('2d')!;
        ctx.fillStyle = '#cfe8ff';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#9333ea';
        ctx.lineWidth = 8;
        // Asymmetric markings so we can tell orientation visually
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(w, h);
        ctx.stroke();
        const dataURL = off.toDataURL('image/png');
        const pm = window.app!.projectManager;
        Promise.resolve(
          pm.addImage(pm.currentViewId || 'front', dataURL, {
            refreshBackground: true,
          })
        ).then(() => resolve());
      });
    },
    { w, h }
  );
}

async function uploadImageThroughUiPipeline(page: Page, w: number, h: number) {
  await page.evaluate(
    async ({ w, h }) => {
      const off = document.createElement('canvas');
      off.width = w;
      off.height = h;
      const ctx = off.getContext('2d')!;
      ctx.fillStyle = '#d9e4ef';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#315b7d';
      ctx.fillRect(0, 0, Math.max(12, w / 8), h);
      const blob = await new Promise<Blob>(resolve =>
        off.toBlob(value => resolve(value!), 'image/png')
      );
      const file = new File([blob], 'compact-panel-upload.png', { type: 'image/png' });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      await window.app!.uploadManager.handleFiles(transfer.files);
    },
    { w, h }
  );
}

test('first image frame is vertically centered in the usable wide-screen workspace', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await waitForApp(page);

  await uploadImage(page, 1600, 900);
  await page.waitForTimeout(1500);

  const geometry = await page.evaluate(() => {
    const frame = document.getElementById('captureFrame')?.getBoundingClientRect();
    const toolbar = document.getElementById('toolbarWrap')?.getBoundingClientRect();
    const controlsEl = document.getElementById('canvasControls');
    const controls = controlsEl?.getBoundingClientRect();
    if (!frame || !toolbar || !controls) return null;

    const gap = 12;
    const usableTop = toolbar.bottom + gap;
    // canvasControls follows the frame, so reserve its stable height from the
    // viewport rather than feeding its current position back into frame layout.
    const usableBottom = window.innerHeight - Math.max(gap, controls.height + gap * 2);
    const usableCenterY = usableTop + (usableBottom - usableTop) / 2;
    const frameCenterY = frame.top + frame.height / 2;

    return {
      frameTop: frame.top,
      frameBottom: frame.bottom,
      frameCenterY,
      usableTop,
      usableBottom,
      usableCenterY,
      centerDelta: frameCenterY - usableCenterY,
      controlsHeight: controls.height,
    };
  });

  expect(geometry, 'wide-screen frame geometry').not.toBeNull();
  if (!geometry) return;
  // eslint-disable-next-line no-console
  console.log('[ALIGN wide-screen workspace]', JSON.stringify(geometry));
  expect(Math.abs(geometry.centerDelta)).toBeLessThan(3);
});

for (const [name, w, h] of [
  ['landscape 800x600', 800, 600],
  ['portrait 600x900', 600, 900],
  ['portrait tall 600x1400', 600, 1400],
  ['square 900x900', 900, 900],
] as const) {
  test(`first image alignment — ${name}`, async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    await uploadImage(page, w, h);
    // Wait past portrait re-align (220ms) + resize coordinator (~140ms) + slack
    await page.waitForTimeout(1500);

    const m = await measure(page);
    expect(m, 'measurement produced a value').not.toBeNull();
    if (!m) return;
    // eslint-disable-next-line no-console
    console.log(`[ALIGN ${name}]`, JSON.stringify(m));

    // Background center must align with capture-frame center within a few px.
    expect(Math.abs(m.dx), `${name} dx`).toBeLessThan(4);
    expect(Math.abs(m.dy), `${name} dy`).toBeLessThan(4);
    expect(m.edgeError, `${name} image fills its initial frame`).toBeLessThan(4);
  });
}

test('first UI upload centers immediately after opening Images at compact width', async ({
  page,
}) => {
  await page.setViewportSize({ width: 840, height: 752 });
  await page.goto('/');
  await waitForApp(page);

  const imagePanel = page.locator('#imagePanel');
  if (await page.locator('#imagePanelContent').isVisible()) {
    await page.locator('#toggleImagePanel').click();
    await expect(imagePanel).toHaveAttribute('aria-expanded', 'false');
  }
  await page.locator('#toggleImagePanel').click();
  await expect(imagePanel).toHaveAttribute('aria-expanded', 'true');

  // Intentionally upload before the panel-triggered canvas transaction has
  // settled. This mirrors opening the sidebar and immediately choosing a file.
  await uploadImageThroughUiPipeline(page, 1200, 800);
  await page.waitForTimeout(250);

  const geometry = await page.evaluate(() => {
    const frame = document.getElementById('captureFrame')?.getBoundingClientRect();
    const leftPanel = document.getElementById('strokePanel')?.getBoundingClientRect();
    const rightPanel = document.getElementById('imagePanel')?.getBoundingClientRect();
    const canvas = window.app?.canvasManager?.fabricCanvas;
    const canvasRect = canvas?.lowerCanvasEl?.getBoundingClientRect();
    const background = canvas?.backgroundImage;
    if (!frame || !leftPanel || !rightPanel || !canvas || !canvasRect || !background) return null;

    const center = fabric.util.transformPoint(
      background.getCenterPoint(),
      canvas.viewportTransform
    );
    const availableCenterX = (leftPanel.right + rightPanel.left) / 2;
    const frameCenterX = frame.left + frame.width / 2;
    const frameCenterY = frame.top + frame.height / 2;
    return {
      frameCenterDelta: frameCenterX - availableCenterX,
      imageCenterDeltaX: canvasRect.left + center.x - frameCenterX,
      imageCenterDeltaY: canvasRect.top + center.y - frameCenterY,
    };
  });

  expect(geometry).not.toBeNull();
  expect(Math.abs(geometry!.frameCenterDelta)).toBeLessThanOrEqual(3);
  expect(Math.abs(geometry!.imageCenterDeltaX)).toBeLessThanOrEqual(3);
  expect(Math.abs(geometry!.imageCenterDeltaY)).toBeLessThanOrEqual(3);
});

for (const pipeline of ['project', 'ui'] as const) {
  test(`first ${pipeline} upload fits after an empty workspace viewport has been saved`, async ({
    page,
  }) => {
    await page.goto('/');
    await waitForApp(page);
    await page.evaluate(() => {
      const pm = window.app!.projectManager;
      window.app!.canvasManager.setViewportState({ zoom: 1.2, panX: 0, panY: -25 });
      pm.saveCurrentViewState();
    });
    await (pipeline === 'ui' ? uploadImageThroughUiPipeline : uploadImage)(page, 1200, 800);
    await page.waitForTimeout(1500);
    const alignment = await measure(page);
    expect(alignment).not.toBeNull();
    expect(Math.abs(alignment!.dx)).toBeLessThan(4);
    expect(Math.abs(alignment!.dy)).toBeLessThan(4);
    expect(alignment!.edgeError).toBeLessThan(4);
  });
}
