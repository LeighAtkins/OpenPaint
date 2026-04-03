import { test, expect } from '@playwright/test';

test.describe('Split Mode Vector Preservation', () => {
  test('vectors should persist when toggling split mode', async ({ page }) => {
    // Start the app
    await page.goto('http://localhost:5173');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Wait for canvas to be ready
    await page.waitForSelector('canvas', { timeout: 10000 });

    console.log('✓ Canvas loaded');

    // Get initial state
    const initialObjects = await page.evaluate(() => {
      const pm = (window as any).app?.projectManager || (window as any).projectManager;
      return pm?.canvasManager?.fabricCanvas?.getObjects()?.length || 0;
    });
    console.log(`Initial objects on canvas: ${initialObjects}`);

    // Draw some test vectors
    console.log('\n=== Drawing test vectors ===');
    await page.evaluate(() => {
      const pm = (window as any).app?.projectManager || (window as any).projectManager;
      const canvas = pm?.canvasManager?.fabricCanvas;
      if (!canvas) throw new Error('Canvas not found');

      // Add some test strokes
      const fabric = (window as any).fabric;
      for (let i = 0; i < 3; i++) {
        const line = new fabric.Line([50 + i * 100, 50, 150 + i * 100, 150], {
          stroke: '#ff0000',
          strokeWidth: 3,
          strokeType: 'line',
        });
        canvas.add(line);
      }
      canvas.renderAll();

      console.log('[TEST] Drew 3 test lines');
    });

    await page.waitForTimeout(500);

    // Check objects were added
    const beforeSplit = await page.evaluate(() => {
      const pm = (window as any).app?.projectManager || (window as any).projectManager;
      const count = pm?.canvasManager?.fabricCanvas?.getObjects()?.length || 0;
      const viewId = pm?.currentViewId;
      const hasCanvasData = !!pm?.views?.[viewId]?.canvasData;
      console.log(
        `[BEFORE SPLIT] Objects: ${count}, ViewId: ${viewId}, HasCanvasData: ${hasCanvasData}`
      );
      return { count, viewId, hasCanvasData };
    });

    console.log(`\n✓ Before split: ${beforeSplit.count} objects`);
    expect(beforeSplit.count).toBeGreaterThan(0);

    // Enable console logging
    page.on('console', msg => {
      if (
        msg.text().includes('[saveCurrentViewState]') ||
        msg.text().includes('[switchView]') ||
        msg.text().includes('[TEST]')
      ) {
        console.log('  Browser:', msg.text());
      }
    });

    // Enter split mode by pressing backslash
    console.log('\n=== Entering split mode (pressing \\) ===');
    await page.keyboard.press('Backslash');
    await page.waitForTimeout(1000);

    const inSplit = await page.evaluate(() => {
      const pm = (window as any).app?.projectManager || (window as any).projectManager;
      const count = pm?.canvasManager?.fabricCanvas?.getObjects()?.length || 0;
      const splitActive = document
        .getElementById('main-canvas-wrapper')
        ?.classList.contains('guide-split-active');
      const viewId = pm?.currentViewId;
      const hasCanvasData = !!pm?.views?.[viewId]?.canvasData;
      const canvasDataLength = pm?.views?.[viewId]?.canvasData?.objects?.length || 0;
      console.log(
        `[IN SPLIT] Objects: ${count}, Split Active: ${splitActive}, ViewId: ${viewId}, HasCanvasData: ${hasCanvasData}, CanvasData Objects: ${canvasDataLength}`
      );
      return { count, splitActive, viewId, hasCanvasData, canvasDataLength };
    });

    console.log(`✓ In split mode: ${inSplit.count} objects visible, split=${inSplit.splitActive}`);
    console.log(`  Saved canvas data has ${inSplit.canvasDataLength} objects`);

    // Exit split mode by pressing backslash again
    console.log('\n=== Exiting split mode (pressing \\ again) ===');
    await page.keyboard.press('Backslash');
    await page.waitForTimeout(1500); // Give time for switchView to complete

    const afterExit = await page.evaluate(() => {
      const pm = (window as any).app?.projectManager || (window as any).projectManager;
      const count = pm?.canvasManager?.fabricCanvas?.getObjects()?.length || 0;
      const splitActive = document
        .getElementById('main-canvas-wrapper')
        ?.classList.contains('guide-split-active');
      const viewId = pm?.currentViewId;
      const hasCanvasData = !!pm?.views?.[viewId]?.canvasData;
      const canvasDataLength = pm?.views?.[viewId]?.canvasData?.objects?.length || 0;
      console.log(
        `[AFTER EXIT] Objects: ${count}, Split Active: ${splitActive}, ViewId: ${viewId}, HasCanvasData: ${hasCanvasData}, CanvasData Objects: ${canvasDataLength}`
      );
      return { count, splitActive, viewId, hasCanvasData, canvasDataLength };
    });

    console.log(
      `\n${afterExit.count > 0 ? '✓' : '✗'} After exit: ${afterExit.count} objects on canvas`
    );
    console.log(`  Saved canvas data has ${afterExit.canvasDataLength} objects`);
    console.log(`  Split active: ${afterExit.splitActive}`);

    // The bug: objects disappear even though canvasData exists
    if (afterExit.count === 0 && afterExit.canvasDataLength > 0) {
      console.log('\n❌ BUG CONFIRMED: Canvas is empty but saved data exists!');
    }

    // This should pass after the fix
    expect(afterExit.count).toBe(beforeSplit.count);
    console.log('\n✓ Test passed: Vectors persisted through split mode toggle');
  });
});
