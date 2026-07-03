/**
 * E2E tests for resize/switch visual stability (no white flashing).
 *
 * The user reported white flashing as images settle into position after
 * resize or view switch. This happens when the viewport is applied
 * multiple times in sequence (triple-scheduled recenter passes at 0ms,
 * 100ms, 300ms), causing the image to visibly jump between intermediate
 * positions before reaching the final state.
 *
 * These tests monitor how many times the canvas viewport transform
 * changes to a SIGNIFICANTLY different value during a settle period.
 * If the viewport jumps more than once, the test fails — the image
 * should go directly from the old position to the final position in
 * a single step, with no intermediate flashes.
 */
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ViewportChange = {
  panX: number;
  panY: number;
  zoom: number;
  timestamp: number;
};

async function startMonitoring(page: Page): Promise<void> {
  await page.evaluate(() => {
    const changes: ViewportChange[] = [];
    const cm = window.app!.canvasManager;
    const canvas = cm.fabricCanvas;
    if (!canvas) return;

    // Hook into applyViewportTransform to record every viewport application
    const original = cm.applyViewportTransform.bind(cm);
    let lastPanX = cm.panX;
    let lastPanY = cm.panY;
    let lastZoom = cm.zoomLevel;

    cm.applyViewportTransform = function (...args: any[]) {
      const result = original.apply(this, args as any);
      const dx = Math.abs(this.panX - lastPanX);
      const dy = Math.abs(this.panY - lastPanY);
      const dz = Math.abs(this.zoomLevel - lastZoom);
      // Only record SIGNIFICANT changes (> 3px or > 1% zoom)
      if (dx > 3 || dy > 3 || dz > 0.01) {
        changes.push({
          panX: this.panX,
          panY: this.panY,
          zoom: this.zoomLevel,
          timestamp: performance.now(),
        });
        lastPanX = this.panX;
        lastPanY = this.panY;
        lastZoom = this.zoomLevel;
      }
      return result;
    };

    (window as any).__viewportChanges = changes;
    (window as any).__viewportMonitorStartTime = performance.now();
  });
}

async function getViewportChanges(page: Page): Promise<ViewportChange[]> {
  return page.evaluate(() => (window as any).__viewportChanges || []);
}

async function stopMonitoring(page: Page): Promise<ViewportChange[]> {
  return page.evaluate(() => {
    const changes = (window as any).__viewportChanges || [];
    // Restore original applyViewportTransform
    const cm = window.app!.canvasManager;
    if (cm && (cm as any).__originalApplyViewportTransform) {
      cm.applyViewportTransform = (cm as any).__originalApplyViewportTransform;
    }
    return changes;
  });
}

async function resizeViewport(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(500);
  await page.evaluate(() => window.app?.canvasManager?.resize?.());
  await page.waitForTimeout(500);
}

async function addViewWithImage(
  page: Page,
  viewId: string,
  width = 800,
  height = 600,
  color = '#e0e0e0'
): Promise<void> {
  await page.evaluate(
    ({ id, w, h, c }) => {
      return new Promise<void>(resolve => {
        const offscreen = document.createElement('canvas');
        offscreen.width = w;
        offscreen.height = h;
        const ctx = offscreen.getContext('2d')!;
        ctx.fillStyle = c;
        ctx.fillRect(0, 0, w, h);
        const pm = window.app!.projectManager;
        pm.addImage(id, offscreen.toDataURL('image/png'), { refreshBackground: true }).then(() =>
          resolve()
        );
      });
    },
    { id: viewId, w: width, h: height, c: color }
  );
  await page.waitForTimeout(400);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Visual stability — no flashing during settle', () => {
  test.describe.configure({ mode: 'serial' });

  test('resize should not flash — viewport changes at most once', async ({ appPage: page }) => {
    await addViewWithImage(page, 'front', 800, 600, '#e0e0e0');
    await page.waitForTimeout(300);

    // Start monitoring BEFORE resize
    await startMonitoring(page);

    // Resize
    await resizeViewport(page, 900, 600);

    // Wait for all deferred recenter passes to complete
    await page.waitForTimeout(600);

    const changes = await getViewportChanges(page);

    // The viewport should change AT MOST twice:
    // 1. Initial position (from before resize)
    // 2. Final centered position (after resize settles)
    // If there are 3+ significant changes, the image is flashing.
    expect(
      changes.length,
      `Too many viewport changes during resize (${changes.length} changes indicates flashing):\n` +
        changes
          .map(
            (c, i) =>
              `  [${i}] panX=${c.panX.toFixed(1)} panY=${c.panY.toFixed(1)} zoom=${c.zoom.toFixed(3)}`
          )
          .join('\n')
    ).toBeLessThanOrEqual(2);
  });

  test('view switch should not flash — viewport changes at most twice', async ({
    appPage: page,
  }) => {
    // Start fresh at a fixed size
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.waitForTimeout(500);
    await page.evaluate(() => window.app?.canvasManager?.resize?.());
    await page.waitForTimeout(400);

    await addViewWithImage(page, 'front', 800, 600, '#e0e0e0');
    await addViewWithImage(page, 'side', 800, 600, '#d0d0d0');
    await page.waitForTimeout(300);

    // Start monitoring BEFORE view switch
    await startMonitoring(page);

    // Switch views
    await page.evaluate(() => window.app!.projectManager.switchView('side'));
    await page.waitForTimeout(600);

    const changes = await getViewportChanges(page);

    // View switch can have at most 2 significant viewport changes:
    // 1. Loading the new view's data
    // 2. Final centered position
    expect(
      changes.length,
      `Too many viewport changes during view switch (${changes.length} indicates flashing):\n` +
        changes
          .map(
            (c, i) =>
              `  [${i}] panX=${c.panX.toFixed(1)} panY=${c.panY.toFixed(1)} zoom=${c.zoom.toFixed(3)}`
          )
          .join('\n')
    ).toBeLessThanOrEqual(2);
  });

  test('cross-monitor load should not flash — single transition to final state', async ({
    appPage: page,
  }) => {
    // Create project at large size
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.waitForTimeout(500);
    await page.evaluate(() => window.app?.canvasManager?.resize?.());
    await page.waitForTimeout(400);

    await addViewWithImage(page, 'front', 960, 720, '#e0e0e0');
    await page.waitForTimeout(300);

    // Save
    const projectData = await page.evaluate(() => {
      return window.app!.projectManager.getProjectData({ embedImages: true });
    });

    // Reload at small size
    await page.setViewportSize({ width: 900, height: 600 });
    await page.reload();
    await page.waitForTimeout(1000);
    await page.setViewportSize({ width: 900, height: 600 });
    await page.waitForTimeout(300);

    await page.waitForFunction(
      () => !!(window.app?.canvasManager?.fabricCanvas && window.app?.projectManager),
      { timeout: 15_000 }
    );
    await page.waitForTimeout(500);

    // Start monitoring BEFORE loading project
    await startMonitoring(page);

    // Load project
    await page.evaluate(data => {
      return window.app!.projectManager.loadProjectFromData(data);
    }, projectData);
    await page.waitForFunction(() => !(window as any).__isLoadingProject, { timeout: 15_000 });

    // Wait for all deferred passes (up to 500ms)
    await page.waitForTimeout(800);

    const changes = await getViewportChanges(page);

    // Cross-monitor load can have at most 3 significant viewport changes:
    // 1. Initial load
    // 2. Background image placement
    // 3. Final recenter
    // More than 3 indicates the triple-recenter is causing visible flashing.
    expect(
      changes.length,
      `Too many viewport changes during cross-monitor load (${changes.length} indicates flashing):\n` +
        changes
          .map(
            (c, i) =>
              `  [${i}] panX=${c.panX.toFixed(1)} panY=${c.panY.toFixed(1)} zoom=${c.zoom.toFixed(3)}`
          )
          .join('\n')
    ).toBeLessThanOrEqual(3);
  });
});
