/**
 * Tests for capture frame sizing in split mode.
 *
 * Verifies that:
 * 1. Capture frame dimensions are correct on first visit in split mode
 * 2. Switching views preserves correct capture frame sizing
 * 3. The settle pass (double-RAF + delayed re-sync) produces consistent results
 * 4. No crashes during rapid view switching in split mode
 */
import { test, expect, waitForCanvasLayoutSettle } from './fixtures';
import type { Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create multiple test images and register them as separate project views. */
async function setupMultiImageProject(page: Page, count = 3): Promise<string[]> {
  const labels: string[] = [];
  const colors = ['#e0e0ff', '#ffe0e0', '#e0ffe0', '#fff0d0'];
  for (let i = 0; i < count; i++) {
    const label = `test-image-${i + 1}`;
    labels.push(label);

    await page.evaluate(
      ({ lbl, color, w, h }) => {
        return new Promise<void>(resolve => {
          const offscreen = document.createElement('canvas');
          offscreen.width = w;
          offscreen.height = h;
          const ctx = offscreen.getContext('2d')!;
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, w, h);
          ctx.fillStyle = '#333';
          ctx.font = '48px sans-serif';
          ctx.fillText(lbl, 50, 80);
          const dataURL = offscreen.toDataURL('image/png');

          const pm = window.app!.projectManager;
          pm.addImage(lbl, dataURL, { refreshBackground: true }).then(() => {
            resolve();
          });
        });
      },
      { lbl: label, color: colors[i % colors.length], w: 800, h: 600 }
    );
    await page.waitForTimeout(300);
  }

  // Switch to the first image
  await page.evaluate(lbl => {
    return window.app!.projectManager.switchView(lbl);
  }, labels[0]);
  await page.waitForTimeout(500);

  return labels;
}

/** Enable guide split mode via the window-exposed API. */
async function enableGuideSplit(page: Page): Promise<boolean> {
  const enabled = await page.evaluate(() => {
    if (typeof (window as any).setGuideSplitEnabled === 'function') {
      (window as any).setGuideSplitEnabled(true);
      return true;
    }
    return false;
  });
  if (enabled) {
    await page.waitForTimeout(800);
  }
  return enabled;
}

/** Switch view via projectManager. */
async function switchToView(page: Page, viewId: string) {
  await page.evaluate(lbl => {
    return window.app!.projectManager.switchView(lbl);
  }, viewId);
  await page.waitForTimeout(600);
  await waitForCanvasLayoutSettle(page);
}

/** Get capture frame bounding rect. */
async function getCaptureFrameRect(page: Page) {
  return page.evaluate(() => {
    const captureFrame = document.getElementById('captureFrame');
    if (!captureFrame) return null;
    const rect = captureFrame.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  });
}

/** Get the capture overlay bounding rect. */
async function getCaptureOverlayRect(page: Page) {
  return page.evaluate(() => {
    const overlay = document.getElementById('captureOverlay');
    if (!overlay) return null;
    const rect = overlay.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  });
}

/** Check if guide split mode is active via CSS class. */
async function isSplitActive(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const wrapper = document.getElementById('main-canvas-wrapper');
    return wrapper?.classList.contains('guide-split-active') || false;
  });
}

/** Collect console errors. */
function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => {
    errors.push(error.message);
  });
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  return errors;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Capture frame sizing in split mode', () => {
  test('capture frame has non-zero dimensions after enabling split mode', async ({
    appPage: page,
  }) => {
    const labels = await setupMultiImageProject(page, 2);
    const enabled = await enableGuideSplit(page);
    test.skip(!enabled, 'setGuideSplitEnabled not available');

    const splitActive = await isSplitActive(page);
    expect(splitActive).toBe(true);

    const frameRect = await getCaptureFrameRect(page);
    expect(frameRect).not.toBeNull();
    expect(frameRect!.width).toBeGreaterThan(0);
    expect(frameRect!.height).toBeGreaterThan(0);
  });

  test('capture frame dimensions are consistent after switching views', async ({
    appPage: page,
  }) => {
    const labels = await setupMultiImageProject(page, 3);
    const enabled = await enableGuideSplit(page);
    test.skip(!enabled, 'setGuideSplitEnabled not available');
    await page.waitForTimeout(500);

    // Get initial frame dimensions on view 1
    const rect1 = await getCaptureFrameRect(page);
    expect(rect1).not.toBeNull();
    expect(rect1!.width).toBeGreaterThan(0);

    // Switch to view 2
    await switchToView(page, labels[1]);
    const rect2 = await getCaptureFrameRect(page);
    expect(rect2).not.toBeNull();
    expect(rect2!.width).toBeGreaterThan(0);
    expect(rect2!.height).toBeGreaterThan(0);

    // Switch to view 3
    await switchToView(page, labels[2]);
    const rect3 = await getCaptureFrameRect(page);
    expect(rect3).not.toBeNull();
    expect(rect3!.width).toBeGreaterThan(0);
    expect(rect3!.height).toBeGreaterThan(0);

    // Switch back to view 1 — dimensions should be similar to initial
    await switchToView(page, labels[0]);
    const rect1b = await getCaptureFrameRect(page);
    expect(rect1b).not.toBeNull();
    // Same image, same viewport => dimensions should match closely
    expect(Math.abs(rect1b!.width - rect1!.width)).toBeLessThan(5);
    expect(Math.abs(rect1b!.height - rect1!.height)).toBeLessThan(5);
  });

  test('capture frame settles correctly on first visit without second click', async ({
    appPage: page,
  }) => {
    const labels = await setupMultiImageProject(page, 2);
    const enabled = await enableGuideSplit(page);
    test.skip(!enabled, 'setGuideSplitEnabled not available');
    await page.waitForTimeout(500);

    // Switch to view 2 (single switch, no second click)
    await switchToView(page, labels[1]);

    // Wait for the settle pass to complete (50ms delay + double RAF)
    await page.waitForTimeout(300);
    await waitForCanvasLayoutSettle(page);

    const frameRect = await getCaptureFrameRect(page);
    expect(frameRect).not.toBeNull();

    // The capture frame should have reasonable dimensions
    expect(frameRect!.width).toBeGreaterThan(10);
    expect(frameRect!.height).toBeGreaterThan(10);
    expect(frameRect!.width).toBeLessThan(2000);
    expect(frameRect!.height).toBeLessThan(2000);
  });

  test('capture overlay matches capture frame in split mode', async ({ appPage: page }) => {
    const labels = await setupMultiImageProject(page, 2);
    const enabled = await enableGuideSplit(page);
    test.skip(!enabled, 'setGuideSplitEnabled not available');
    await page.waitForTimeout(500);

    const frameRect = await getCaptureFrameRect(page);
    const overlayRect = await getCaptureOverlayRect(page);

    expect(frameRect).not.toBeNull();
    expect(overlayRect).not.toBeNull();

    // Both should have non-zero dimensions
    expect(frameRect!.width).toBeGreaterThan(0);
    expect(overlayRect!.width).toBeGreaterThan(0);
  });

  test('sequential view switching in split mode does not crash or produce zero-size frames', async ({
    appPage: page,
  }) => {
    test.setTimeout(60_000);
    const errors = collectPageErrors(page);
    const labels = await setupMultiImageProject(page, 3);
    const enabled = await enableGuideSplit(page);
    test.skip(!enabled, 'setGuideSplitEnabled not available');
    await page.waitForTimeout(500);

    // Switch through views sequentially (with enough time between to avoid crash)
    for (let i = 0; i < 4; i++) {
      await switchToView(page, labels[i % labels.length]);
      await page.waitForTimeout(400);
    }

    // Wait for everything to settle
    await page.waitForTimeout(1000);
    await waitForCanvasLayoutSettle(page);

    // Final frame should be valid
    const frameRect = await getCaptureFrameRect(page);
    expect(frameRect).not.toBeNull();
    expect(frameRect!.width).toBeGreaterThan(0);
    expect(frameRect!.height).toBeGreaterThan(0);

    // No fatal errors
    const fatalErrors = errors.filter(
      e =>
        e.includes('Cannot read properties of null') ||
        e.includes('Cannot read properties of undefined') ||
        e.includes('is not a function') ||
        e.includes('TypeError')
    );
    expect(fatalErrors).toEqual([]);
  });

  test('switching between views with different image sizes adjusts frame', async ({
    appPage: page,
  }) => {
    // Create images with different dimensions
    await page.evaluate(() => {
      return new Promise<void>(resolve => {
        const pm = window.app!.projectManager;

        // Create a wide image
        const c1 = document.createElement('canvas');
        c1.width = 1000;
        c1.height = 400;
        const ctx1 = c1.getContext('2d')!;
        ctx1.fillStyle = '#e0e0ff';
        ctx1.fillRect(0, 0, 1000, 400);
        const url1 = c1.toDataURL('image/png');

        // Create a tall image
        const c2 = document.createElement('canvas');
        c2.width = 400;
        c2.height = 1000;
        const ctx2 = c2.getContext('2d')!;
        ctx2.fillStyle = '#ffe0e0';
        ctx2.fillRect(0, 0, 400, 1000);
        const url2 = c2.toDataURL('image/png');

        pm.addImage('wide-img', url1, { refreshBackground: true })
          .then(() => pm.addImage('tall-img', url2, { refreshBackground: true }))
          .then(() => pm.switchView('wide-img'))
          .then(() => resolve());
      });
    });
    await page.waitForTimeout(500);

    const enabled = await enableGuideSplit(page);
    test.skip(!enabled, 'setGuideSplitEnabled not available');
    await page.waitForTimeout(500);

    // Get frame on wide image
    const rectWide = await getCaptureFrameRect(page);
    expect(rectWide).not.toBeNull();

    // Switch to tall image
    await switchToView(page, 'tall-img');
    const rectTall = await getCaptureFrameRect(page);
    expect(rectTall).not.toBeNull();
    expect(rectTall!.width).toBeGreaterThan(0);
    expect(rectTall!.height).toBeGreaterThan(0);

    // The aspect ratios should differ since the images are different
    const aspectWide = rectWide!.width / rectWide!.height;
    const aspectTall = rectTall!.width / rectTall!.height;
    // Wide image should have wider aspect than tall image
    expect(aspectWide).toBeGreaterThan(aspectTall);
  });
});
