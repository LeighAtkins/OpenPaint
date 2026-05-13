/**
 * Shared Playwright fixtures and helpers for OpenPaint e2e tests.
 */
import { test as base, expect, type Page, type Locator } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/** Wait for the OpenPaint app to fully initialize. */
async function waitForApp(page: Page, timeout = 15_000): Promise<void> {
  await page.waitForFunction(
    () =>
      !!(
        window.app?.canvasManager?.fabricCanvas &&
        window.app?.toolManager?.activeTool &&
        window.app?.projectManager &&
        document.getElementById('topToolbar')?.classList.contains('toolbar-ready') &&
        (() => {
          const captureFrame = document.getElementById('captureFrame');
          const captureOverlay = document.getElementById('captureOverlay');
          if (!(captureFrame instanceof HTMLElement) || !(captureOverlay instanceof HTMLElement)) {
            return false;
          }
          const frameRect = captureFrame.getBoundingClientRect();
          const overlayRect = captureOverlay.getBoundingClientRect();
          return (
            frameRect.width > 0 &&
            frameRect.height > 0 &&
            overlayRect.width > 0 &&
            overlayRect.height > 0
          );
        })()
      ),
    { timeout }
  );
  // Give the layout and first canvas render a moment to settle.
  await page.waitForTimeout(500);
  await waitForCanvasLayoutSettle(page);
}

async function waitForCanvasLayoutSettle(page: Page, timeout = 1_500): Promise<void> {
  try {
    await page.waitForFunction(
      () => {
        const canvasManager = window.app?.canvasManager;
        const canvas = canvasManager?.fabricCanvas;
        const captureFrame = document.getElementById('captureFrame');
        const wrapper = document.getElementById('main-canvas-wrapper');
        if (
          !canvas ||
          !(captureFrame instanceof HTMLElement) ||
          !(wrapper instanceof HTMLElement)
        ) {
          return false;
        }

        const canvasRect = canvas.getElement?.()?.getBoundingClientRect?.();
        const frameRect = captureFrame.getBoundingClientRect();
        if (!canvasRect?.width || !canvasRect?.height || !frameRect.width || !frameRect.height) {
          return false;
        }

        const splitActive = wrapper.classList.contains('guide-split-active');
        if (!splitActive || !canvas.backgroundImage || !(window as any).fabric) {
          return true;
        }

        const fabricApi = (window as any).fabric;
        const bg = canvas.backgroundImage;
        const vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
        const halfWidth = ((bg.width || 0) * (bg.scaleX || 1)) / 2;
        const halfHeight = ((bg.height || 0) * (bg.scaleY || 1)) / 2;
        const topLeft = fabricApi.util.transformPoint(
          new fabricApi.Point(bg.left - halfWidth, bg.top - halfHeight),
          vpt
        );
        const bottomRight = fabricApi.util.transformPoint(
          new fabricApi.Point(bg.left + halfWidth, bg.top + halfHeight),
          vpt
        );
        const bgCenterX = topLeft.x + (bottomRight.x - topLeft.x) / 2;
        const bgCenterY = topLeft.y + (bottomRight.y - topLeft.y) / 2;
        const frameCenterX = frameRect.left - canvasRect.left + frameRect.width / 2;
        const frameCenterY = frameRect.top - canvasRect.top + frameRect.height / 2;

        return Math.abs(bgCenterX - frameCenterX) < 2 && Math.abs(bgCenterY - frameCenterY) < 2;
      },
      { timeout }
    );
  } catch {
    // Let the test assertions report any persistent alignment failure.
  }
}

/** Get the Fabric.js upper-canvas that receives mouse events. */
function getCanvas(page: Page): Locator {
  return page.locator('.upper-canvas');
}

/** Select a tool by name (e.g. 'line', 'pencil', 'select'). */
async function selectTool(page: Page, toolName: string): Promise<void> {
  await page.evaluate(name => {
    return window.app!.toolManager.selectTool(name);
  }, toolName);
  await page.waitForTimeout(100);
}

/** Draw a line from (x1,y1) to (x2,y2) on the canvas using mouse events. */
async function drawLine(page: Page, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  const canvas = getCanvas(page);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas not visible');

  const absX1 = box.x + x1;
  const absY1 = box.y + y1;
  const absX2 = box.x + x2;
  const absY2 = box.y + y2;

  await page.mouse.move(absX1, absY1);
  await page.mouse.down();
  // Move in steps to ensure Fabric registers movement
  const steps = 5;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await page.mouse.move(absX1 + (absX2 - absX1) * t, absY1 + (absY2 - absY1) * t);
  }
  await page.mouse.up();
  await page.waitForTimeout(200);
}

/**
 * Upload a test image by creating a data-URL image and loading it
 * into the project as the "front" view.
 */
async function uploadTestImage(
  page: Page,
  width = 800,
  height = 600,
  color = '#f0f0f0'
): Promise<void> {
  await page.evaluate(
    ({ w, h, c }) => {
      return new Promise<void>(resolve => {
        const offscreen = document.createElement('canvas');
        offscreen.width = w;
        offscreen.height = h;
        const ctx = offscreen.getContext('2d')!;
        ctx.fillStyle = c;
        ctx.fillRect(0, 0, w, h);
        // Draw a reference grid so we can verify alignment later
        ctx.strokeStyle = '#ccc';
        ctx.lineWidth = 1;
        for (let x = 0; x <= w; x += 100) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
        for (let y = 0; y <= h; y += 100) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
        }
        const dataURL = offscreen.toDataURL('image/png');

        const pm = window.app!.projectManager;
        const cm = window.app!.canvasManager;

        // Set the image as the background for the current view
        const img = new Image();
        img.onload = () => {
          cm.fabricCanvas.setBackgroundImage(new (window as any).fabric.Image(img), () => {
            cm.fabricCanvas.renderAll();
            resolve();
          });
        };
        img.src = dataURL;
      });
    },
    { w: width, h: height, c: color }
  );
  await page.waitForTimeout(500);
}

/** Get the number of Fabric objects on the canvas. */
async function getObjectCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    return window.app!.canvasManager.fabricCanvas.getObjects().length;
  });
}

/** Get all line objects' coordinates from the canvas. */
async function getLineCoords(
  page: Page
): Promise<Array<{ x1: number; y1: number; x2: number; y2: number }>> {
  return page.evaluate(() => {
    const objects = window.app!.canvasManager.fabricCanvas.getObjects();
    return objects
      .filter((o: any) => o.type === 'line')
      .map((o: any) => ({
        x1: o.x1 as number,
        y1: o.y1 as number,
        x2: o.x2 as number,
        y2: o.y2 as number,
      }));
  });
}

/** Get current project data (for save/load testing). */
async function getProjectData(page: Page): Promise<any> {
  return page.evaluate(() => {
    return window.app!.projectManager.getProjectData({ embedImages: true });
  });
}

/** Load project data back into the app. */
async function loadProjectData(page: Page, projectData: any): Promise<void> {
  await page.evaluate(data => {
    return window.app!.projectManager.loadProjectFromData(data);
  }, projectData);
  // Wait for the project load to complete
  await page.waitForFunction(() => !(window as any).__isLoadingProject, { timeout: 10_000 });
  await page.waitForTimeout(500);
}

/** Resize the viewport and wait for canvas to adapt. */
async function resizeViewport(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(500);
  // Trigger canvas resize
  await page.evaluate(() => {
    window.app?.canvasManager?.resize?.();
  });
  await page.waitForTimeout(300);
  await waitForCanvasLayoutSettle(page);
}

/** Get the current zoom level. */
async function getZoomLevel(page: Page): Promise<number> {
  return page.evaluate(() => window.app!.canvasManager.zoomLevel);
}

// ---------------------------------------------------------------------------
// Extended test fixture
// ---------------------------------------------------------------------------

export const test = base.extend<{
  appPage: Page;
}>({
  appPage: async ({ page }, use) => {
    await page.goto('/');
    await waitForApp(page);
    await use(page);
  },
});

export {
  expect,
  waitForApp,
  getCanvas,
  selectTool,
  drawLine,
  uploadTestImage,
  getObjectCount,
  getLineCoords,
  getProjectData,
  loadProjectData,
  resizeViewport,
  getZoomLevel,
  waitForCanvasLayoutSettle,
};
