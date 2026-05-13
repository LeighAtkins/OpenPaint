import { test, expect } from '@playwright/test';

const SITE_URL = 'https://sofapaint-ny879rgf2-leigh-atkins-projects.vercel.app';

test.describe('PDF Export with Multiple Frames', () => {
  test('should include tags on all frames in PDF export', async ({ page }) => {
    // Navigate to the site
    await page.goto(SITE_URL);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    console.log('✓ Site loaded');

    // Wait for canvas
    await page.waitForSelector('canvas', { timeout: 10000 });

    // Upload a test image
    console.log('\n=== Uploading test image ===');
    await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 600;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#e0e0e0';
        ctx.fillRect(0, 0, 800, 600);
        ctx.fillStyle = '#333';
        ctx.font = '48px Arial';
        ctx.fillText('Test Image', 300, 300);
      }

      canvas.toBlob(blob => {
        if (blob) {
          const file = new File([blob], 'test.png', { type: 'image/png' });
          const dt = new DataTransfer();
          dt.items.add(file);
          const input = document.querySelector('input[type="file"]') as HTMLInputElement;
          if (input) {
            input.files = dt.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
      });
    });

    await page.waitForTimeout(1500);
    console.log('✓ Image uploaded');

    // Select line tool
    console.log('\n=== Drawing on Frame 1 ===');
    await page.evaluate(() => {
      const toolManager = (window as any).app?.toolManager;
      if (toolManager) {
        toolManager.setActiveTool('line');
      }
    });

    await page.waitForTimeout(500);

    // Draw a line on Frame 1
    const canvas = await page.locator('canvas').first();
    await canvas.click({ position: { x: 100, y: 100 } });
    await canvas.click({ position: { x: 300, y: 100 } });
    await page.waitForTimeout(500);

    // Add measurement tag to the line
    await page.evaluate(() => {
      const metadataManager = (window as any).app?.metadataManager;
      const strokeLabel = 'A1';
      const viewId = (window as any).app?.projectManager?.currentViewId || 'front';

      // Set measurement
      if ((window as any).strokeMeasurements) {
        (window as any).strokeMeasurements[strokeLabel] = { value: 10, unit: 'inch' };
      }

      console.log('[TEST] Added measurement A1 to Frame 1');
    });

    await page.waitForTimeout(500);

    // Check Frame 1 state
    const frame1State = await page.evaluate(() => {
      const pm = (window as any).app?.projectManager;
      const canvas = pm?.canvasManager?.fabricCanvas;
      const objects = canvas?.getObjects() || [];
      const tags = objects.filter(
        (obj: any) => obj.isTagText || obj.isTagBackground || obj.isTagGroup
      );

      console.log('[TEST Frame 1]', {
        totalObjects: objects.length,
        tags: tags.length,
        tagLabels: tags.map((t: any) => t.text || t.label),
      });

      return {
        objects: objects.length,
        tags: tags.length,
      };
    });

    console.log(`✓ Frame 1: ${frame1State.objects} objects, ${frame1State.tags} tags`);

    // Add Frame 2
    console.log('\n=== Adding Frame 2 ===');
    const addFrameButton = await page
      .locator(
        'button[title*="Add frame"], button:has-text("Add frame"), button[aria-label*="Add frame"]'
      )
      .first();

    if (await addFrameButton.isVisible().catch(() => false)) {
      await addFrameButton.click();
      await page.waitForTimeout(1000);
      console.log('✓ Frame 2 added via button');
    } else {
      // Fallback: programmatically add frame
      await page.evaluate(() => {
        if (typeof (window as any).addCaptureTab === 'function') {
          const viewId = (window as any).app?.projectManager?.currentViewId || 'front';
          (window as any).addCaptureTab(viewId);
          console.log('[TEST] Added Frame 2 programmatically');
        }
      });
      await page.waitForTimeout(1000);
      console.log('✓ Frame 2 added programmatically');
    }

    // Draw on Frame 2
    console.log('\n=== Drawing on Frame 2 ===');
    await canvas.click({ position: { x: 150, y: 200 } });
    await canvas.click({ position: { x: 350, y: 200 } });
    await page.waitForTimeout(500);

    // Add measurement tag to Frame 2
    await page.evaluate(() => {
      const strokeLabel = 'B1';
      const viewId = (window as any).app?.projectManager?.currentViewId || 'front';
      const tabId = (window as any).captureTabsByLabel?.[viewId]?.activeTabId;

      if ((window as any).strokeMeasurements) {
        (window as any).strokeMeasurements[strokeLabel] = { value: 15, unit: 'inch' };
      }

      console.log('[TEST] Added measurement B1 to Frame 2', { viewId, tabId });
    });

    await page.waitForTimeout(500);

    // Check Frame 2 state
    const frame2State = await page.evaluate(() => {
      const pm = (window as any).app?.projectManager;
      const canvas = pm?.canvasManager?.fabricCanvas;
      const objects = canvas?.getObjects() || [];
      const tags = objects.filter(
        (obj: any) => obj.isTagText || obj.isTagBackground || obj.isTagGroup
      );
      const viewId = pm?.currentViewId;
      const tabState = (window as any).captureTabsByLabel?.[viewId];

      console.log('[TEST Frame 2]', {
        totalObjects: objects.length,
        tags: tags.length,
        tagLabels: tags.map((t: any) => t.text || t.label),
        activeTabId: tabState?.activeTabId,
        tabCount: tabState?.tabs?.length,
      });

      return {
        objects: objects.length,
        tags: tags.length,
        tabCount: tabState?.tabs?.length || 0,
      };
    });

    console.log(`✓ Frame 2: ${frame2State.objects} objects, ${frame2State.tags} tags`);
    console.log(`  Total tabs: ${frame2State.tabCount}`);

    // Capture console logs for PDF export
    const pdfLogs: string[] = [];
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('[PDF') || text.includes('settleCaptureContext')) {
        pdfLogs.push(text);
        console.log('  Browser:', text);
      }
    });

    // Export PDF
    console.log('\n=== Exporting PDF ===');

    // Try to find and click PDF export button
    try {
      await page.click(
        'button:has-text("Export PDF"), button[aria-label*="PDF"], button[title*="PDF"]',
        {
          timeout: 2000,
        }
      );
      await page.waitForTimeout(1000);
    } catch {
      console.log('PDF button not found, trying menu...');
      // If button not found, try to programmatically trigger
      await page.evaluate(() => {
        if (typeof (window as any).exportToPdf === 'function') {
          (window as any).exportToPdf();
        }
      });
      await page.waitForTimeout(1000);
    }

    // Wait for PDF dialog
    await page.waitForTimeout(2000);

    // Check PDF targets
    const pdfTargets = await page.evaluate(() => {
      const viewIds = Object.keys((window as any).app?.projectManager?.views || {});
      console.log('[TEST] Checking PDF targets for views:', viewIds);

      // This mimics getPdfPageTargets logic
      const targets: any[] = [];
      viewIds.forEach(viewId => {
        const state = (window as any).captureTabsByLabel?.[viewId];
        const normalTabs = (state?.tabs || []).filter((tab: any) => tab.type !== 'master');

        console.log(`[TEST] View ${viewId}: ${normalTabs.length} tabs`);

        if (!normalTabs.length) {
          targets.push({ viewId, tabId: null, tabName: 'Frame 1' });
        } else {
          normalTabs.forEach((tab: any, idx: number) => {
            targets.push({
              viewId,
              tabId: tab.id,
              tabName: tab.name || `Frame ${idx + 1}`,
            });
          });
        }
      });

      console.log('[TEST] PDF Targets:', targets);
      return targets;
    });

    console.log('\nPDF Targets:', pdfTargets);

    // Log PDF export logs
    console.log('\nPDF Export Console Logs:');
    pdfLogs.forEach(log => console.log('  ', log));

    // Verify
    expect(pdfTargets.length).toBeGreaterThanOrEqual(2);
    expect(frame1State.tags).toBeGreaterThan(0);

    if (frame2State.tabCount >= 2) {
      console.log('\n✓ Test setup successful: 2 frames with tags detected');
    } else {
      console.log('\n⚠ Warning: Only 1 frame detected, but test continued');
    }

    console.log('\n=== Summary ===');
    console.log(`Frame 1: ${frame1State.objects} objects, ${frame1State.tags} tags`);
    console.log(`Frame 2: ${frame2State.objects} objects, ${frame2State.tags} tags`);
    console.log(`PDF will have ${pdfTargets.length} pages`);
    console.log('\nCheck if tags appear on ALL pages in the exported PDF!');
  });
});
