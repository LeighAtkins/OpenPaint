import { expect, test, waitForApp } from './fixtures';
import type { Page } from '@playwright/test';

// Mac Retina/Safari/Chrome use a 2x backing store. Frame and viewport math must
// remain in CSS coordinates even though the Fabric canvas bitmap is doubled.
test.use({ deviceScaleFactor: 2 });

async function addGeneratedImage(
  page: Page,
  viewId: string,
  width: number,
  height: number
): Promise<void> {
  await page.evaluate(
    async ({ id, imageWidth, imageHeight }) => {
      const source = document.createElement('canvas');
      source.width = imageWidth;
      source.height = imageHeight;
      const context = source.getContext('2d');
      if (!context) throw new Error('Could not create test image');
      context.fillStyle = '#dbeafe';
      context.fillRect(0, 0, imageWidth, imageHeight);
      context.fillStyle = '#2563eb';
      context.fillRect(imageWidth * 0.15, imageHeight * 0.1, imageWidth * 0.7, imageHeight * 0.8);
      await window.app?.projectManager?.addImage(id, source.toDataURL('image/png'), {
        refreshBackground: true,
      });
    },
    { id: viewId, imageWidth: width, imageHeight: height }
  );
  await page.waitForTimeout(500);
}

async function uploadGeneratedImage(
  page: Page,
  filename: string,
  width: number,
  height: number
): Promise<void> {
  await page.evaluate(
    async ({ name, imageWidth, imageHeight }) => {
      const source = document.createElement('canvas');
      source.width = imageWidth;
      source.height = imageHeight;
      const context = source.getContext('2d');
      if (!context) throw new Error('Could not create upload test image');
      context.fillStyle = '#dbeafe';
      context.fillRect(0, 0, imageWidth, imageHeight);
      context.fillStyle = '#2563eb';
      context.fillRect(0, 0, imageWidth, 12);
      context.fillRect(0, imageHeight - 12, imageWidth, 12);
      context.fillRect(0, 0, 12, imageHeight);
      context.fillRect(imageWidth - 12, 0, 12, imageHeight);

      const blob = await new Promise<Blob>((resolve, reject) => {
        source.toBlob(value => (value ? resolve(value) : reject(new Error('PNG encode failed'))));
      });
      const file = new File([blob], name, { type: 'image/png' });
      const uploadManager = (window.app as any)?.uploadManager;
      if (!uploadManager?.handleFiles) throw new Error('Upload manager unavailable');
      await uploadManager.handleFiles([file]);
    },
    { name: filename, imageWidth: width, imageHeight: height }
  );
  await page.waitForTimeout(500);
}

test.describe('Portrait import and trackpad zoom', () => {
  test('a fresh portrait image initializes a centered portrait capture frame', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');
    await waitForApp(page);
    await uploadGeneratedImage(page, 'portrait-photo.png', 600, 1200);
    // Wait past delayed panel centering and resize-settle callbacks. The first
    // image must remain pinned after the UI has fully stabilized, not only on
    // its initial render.
    await page.waitForTimeout(1400);

    const geometry = await page.evaluate(() => {
      const frame = document.getElementById('captureFrame')?.getBoundingClientRect();
      const canvas = window.app?.canvasManager?.fabricCanvas;
      const background = canvas?.backgroundImage;
      if (!frame || !canvas || !background) throw new Error('Portrait import did not render');
      const canvasRect = canvas.lowerCanvasEl.getBoundingClientRect();
      const center = background.getCenterPoint();
      const vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
      const imageWidth = background.getScaledWidth() * Math.hypot(vpt[0], vpt[1]);
      const imageHeight = background.getScaledHeight() * Math.hypot(vpt[2], vpt[3]);
      const imageCenter = {
        x: canvasRect.left + center.x * vpt[0] + center.y * vpt[2] + vpt[4],
        y: canvasRect.top + center.x * vpt[1] + center.y * vpt[3] + vpt[5],
      };
      return {
        frameRatio: frame.width / frame.height,
        frameCenter: { x: frame.left + frame.width / 2, y: frame.top + frame.height / 2 },
        imageCenter,
        edgeDelta: {
          left: imageCenter.x - imageWidth / 2 - frame.left,
          top: imageCenter.y - imageHeight / 2 - frame.top,
          right: imageCenter.x + imageWidth / 2 - frame.right,
          bottom: imageCenter.y + imageHeight / 2 - frame.bottom,
        },
      };
    });

    expect(geometry.frameRatio).toBeCloseTo(0.5, 1);
    expect(Math.abs(geometry.frameCenter.x - geometry.imageCenter.x)).toBeLessThan(3);
    expect(Math.abs(geometry.frameCenter.y - geometry.imageCenter.y)).toBeLessThan(3);
    expect(Math.abs(geometry.edgeDelta.left)).toBeLessThan(3);
    expect(Math.abs(geometry.edgeDelta.top)).toBeLessThan(3);
    expect(Math.abs(geometry.edgeDelta.right)).toBeLessThan(3);
    expect(Math.abs(geometry.edgeDelta.bottom)).toBeLessThan(3);
  });

  test('a portrait image does not replace an existing saved frame layout', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    const beforeRatio = await page.evaluate(() => {
      const manager = window.app?.projectManager;
      const frame = document.getElementById('captureFrame')?.getBoundingClientRect();
      if (!manager || !frame) throw new Error('Initial frame missing');
      manager.views.front.tabs = structuredClone(window.captureTabsByLabel?.front || {});
      return frame.width / frame.height;
    });

    await addGeneratedImage(page, 'front', 600, 1200);
    const afterRatio = await page.evaluate(() => {
      const frame = document.getElementById('captureFrame')?.getBoundingClientRect();
      if (!frame) throw new Error('Frame missing after import');
      return frame.width / frame.height;
    });

    expect(afterRatio).toBeCloseTo(beforeRatio, 2);
    expect(afterRatio).toBeGreaterThan(1);
  });

  test('Ctrl-wheel trackpad pinch zooms the canvas without changing line width', async ({
    page,
  }) => {
    await page.goto('/');
    await waitForApp(page);
    await addGeneratedImage(page, 'front', 960, 720);

    const frame = await page.locator('#captureFrame').boundingBox();
    if (!frame) throw new Error('Capture frame missing');
    const before = await page.evaluate(() => ({
      zoom: window.app?.canvasManager?.fabricCanvas?.getZoom(),
      width: (document.getElementById('brushSize') as HTMLInputElement | null)?.value,
    }));

    await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -360);
    await page.keyboard.up('Control');
    await page.waitForTimeout(250);

    const after = await page.evaluate(() => ({
      zoom: window.app?.canvasManager?.fabricCanvas?.getZoom(),
      width: (document.getElementById('brushSize') as HTMLInputElement | null)?.value,
    }));
    expect(after.zoom).toBeGreaterThan(before.zoom || 0);
    expect(after.width).toBe(before.width);
  });
});
