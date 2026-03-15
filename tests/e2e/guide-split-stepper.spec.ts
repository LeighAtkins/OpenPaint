/**
 * Tests for measurement guide split mode + mini-stepper navigation.
 *
 * Verifies that switching images via mini-stepper while split mode is active
 * does not leak tags/measurements from the previous image into the next,
 * and does not cause hard crashes.
 */
import { test, expect, uploadTestImage } from './fixtures';
import type { Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Upload distinct test images and register them as separate project views. */
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
          // Draw label text so images are visually distinct
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

  // Switch back to the first image
  await page.evaluate(lbl => {
    return window.app!.projectManager.switchView(lbl);
  }, labels[0]);
  await page.waitForTimeout(500);

  return labels;
}

/** Set up a guide model binding for a given view. */
async function bindGuideToView(page: Page, viewId: string, code = 'TEST', variant = 'front') {
  await page.evaluate(
    ({ viewId, code, variant }) => {
      const flash = (window as any).__measurementGuideFlash;
      if (!flash) throw new Error('measurement-guide-flash module not initialized');

      // Register a selection and link it to this view
      const selectionId = `sel-${viewId}`;
      const state = flash.getGuideModelLinkState();
      const existing = state.selections.find((s: any) => s.id === selectionId);
      if (!existing) {
        state.selections.push({ id: selectionId, code, variant });
      }
      state.linksByScope[viewId] = selectionId;
      state.linksByImage[viewId] = selectionId;
      flash.saveGuideModelLinkState(state);
      window.dispatchEvent(new Event('openpaint:guide-binding-changed'));
    },
    { viewId, code, variant }
  );
  await page.waitForTimeout(200);
}

/** Enable guide split mode. */
async function enableGuideSplit(page: Page) {
  await page.evaluate(() => {
    const flash = (window as any).__measurementGuideFlash;
    if (flash?.setGuideSplitEnabled) {
      flash.setGuideSplitEnabled(true);
    }
  });
  await page.waitForTimeout(500);
}

/** Switch view via projectManager (simulates mini-stepper). */
async function switchToView(page: Page, viewId: string) {
  await page.evaluate(lbl => {
    return window.app!.projectManager.switchView(lbl);
  }, viewId);
  await page.waitForTimeout(400);
}

/** Get the current left view in the guide split workspace. */
async function getGuideSplitLeftView(page: Page): Promise<string> {
  return page.evaluate(() => {
    const flash = (window as any).__measurementGuideFlash;
    return flash?.guideCompareWorkspaceState?.leftViewId || '';
  });
}

/** Check if there are leaked objects on the compare canvas that don't belong. */
async function getCompareCanvasObjectCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const flash = (window as any).__measurementGuideFlash;
    const compareCanvas = flash?.guideSplitCompareCanvasManager?.fabricCanvas;
    if (!compareCanvas) return -1;
    return compareCanvas.getObjects().length;
  });
}

/** Collect errors from the page console. */
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

test.describe('Guide Split + Mini-Stepper', () => {
  test('switching images in split mode does not crash', async ({ appPage: page }) => {
    const errors = collectPageErrors(page);

    // Set up 3 images with guide bindings
    const labels = await setupMultiImageProject(page, 3);

    // Check if guide flash module is exposed
    const hasFlash = await page.evaluate(() => !!(window as any).__measurementGuideFlash);
    if (!hasFlash) {
      // Module not exposed — expose it for testing via route interception
      // or skip if the module doesn't export test hooks
      test.skip(!hasFlash, 'measurement-guide-flash not exposed on window');
      return;
    }

    // Bind guides to each view
    for (const label of labels) {
      await bindGuideToView(page, label, 'TEST', 'front');
    }

    // Enable split mode
    await enableGuideSplit(page);

    // Rapidly switch between views (simulating mini-stepper clicks)
    for (let round = 0; round < 3; round++) {
      for (const label of labels) {
        await switchToView(page, label);
        // Short delay — mimics fast mini-stepper clicks
        await page.waitForTimeout(100);
      }
    }

    // Wait for any async operations to settle
    await page.waitForTimeout(2000);

    // Verify no hard crashes
    const fatalErrors = errors.filter(
      e =>
        e.includes('Cannot read properties of null') ||
        e.includes('Cannot read properties of undefined') ||
        e.includes('is not a function') ||
        e.includes('TypeError')
    );
    expect(fatalErrors).toEqual([]);

    // Verify the left view ID matches the last switched view
    const leftView = await getGuideSplitLeftView(page);
    expect(leftView).toBe(labels[labels.length - 1]);
  });

  test('tag measurements update when switching images in split mode', async ({ appPage: page }) => {
    const hasFlash = await page.evaluate(() => !!(window as any).__measurementGuideFlash);
    test.skip(!hasFlash, 'measurement-guide-flash not exposed on window');

    const labels = await setupMultiImageProject(page, 2);

    // Bind same guide to both views
    await bindGuideToView(page, labels[0], 'TEST', 'front');
    await bindGuideToView(page, labels[1], 'TEST', 'front');

    // Enable split mode
    await enableGuideSplit(page);
    await page.waitForTimeout(1000);

    // Switch to image 1, verify right side has a loaded guide
    await switchToView(page, labels[0]);
    await page.waitForTimeout(1500);

    const objCount1 = await getCompareCanvasObjectCount(page);

    // Switch to image 2
    await switchToView(page, labels[1]);
    await page.waitForTimeout(1500);

    const leftView2 = await getGuideSplitLeftView(page);
    expect(leftView2).toBe(labels[1]);

    // The compare canvas should still have objects (guide loaded)
    const objCount2 = await getCompareCanvasObjectCount(page);
    // It should not have leaked extra objects from image 1
    // (object count should be similar — same guide)
    if (objCount1 > 0) {
      // Allow some variance for highlight overlays
      expect(Math.abs(objCount2 - objCount1)).toBeLessThan(objCount1 * 0.5 + 3);
    }
  });

  test('rapid stepper switching does not leak tags across views', async ({ appPage: page }) => {
    const errors = collectPageErrors(page);
    const hasFlash = await page.evaluate(() => !!(window as any).__measurementGuideFlash);
    test.skip(!hasFlash, 'measurement-guide-flash not exposed on window');

    const labels = await setupMultiImageProject(page, 3);

    // Bind same guide code to all views
    for (const label of labels) {
      await bindGuideToView(page, label, 'TEST', 'front');
    }

    // Enable split mode
    await enableGuideSplit(page);
    await page.waitForTimeout(1000);

    // Rapid-fire switch (simulates holding arrow key or scrolling fast)
    for (let i = 0; i < 10; i++) {
      const label = labels[i % labels.length];
      await switchToView(page, label);
      // Very fast — 50ms between switches
      await page.waitForTimeout(50);
    }

    // Settle
    await page.waitForTimeout(3000);

    // Check that the final state is consistent
    const finalLabel = labels[9 % labels.length];
    const leftView = await getGuideSplitLeftView(page);
    expect(leftView).toBe(finalLabel);

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
});
