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
  });
}
