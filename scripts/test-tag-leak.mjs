/**
 * Test tag leak and mini-guide timing issues on the live site.
 * Focus: switching between images in split mode and checking if
 * tags/measurements from one view leak into another.
 */
import { chromium } from 'playwright';

const BASE_URL = 'https://sofapaint.vercel.app';
const TIMEOUT = 60_000;

async function waitForApp(page) {
  await page.waitForFunction(
    () =>
      !!(
        window.app?.canvasManager?.fabricCanvas &&
        window.app?.toolManager?.activeTool &&
        window.app?.projectManager
      ),
    { timeout: TIMEOUT },
  );
  await page.waitForTimeout(1000);
}

async function addTestImage(page, label, color) {
  await page.evaluate(
    ({ lbl, color }) => {
      return new Promise((resolve, reject) => {
        const offscreen = document.createElement('canvas');
        offscreen.width = 800;
        offscreen.height = 600;
        const ctx = offscreen.getContext('2d');
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 800, 600);
        ctx.fillStyle = '#333';
        ctx.font = '48px sans-serif';
        ctx.fillText(lbl, 50, 80);
        const dataURL = offscreen.toDataURL('image/png');
        window.app.projectManager
          .addImage(lbl, dataURL, { refreshBackground: true })
          .then(resolve)
          .catch(reject);
      });
    },
    { lbl: label, color },
  );
  await page.waitForTimeout(500);
}

async function switchView(page, label) {
  await page.evaluate((lbl) => window.app.projectManager.switchView(lbl), label);
}

const pageErrors = [];
const consoleWarnings = [];

(async () => {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  page.on('pageerror', (error) => {
    pageErrors.push({ message: error.message, stack: error.stack });
    console.log(`  [PAGE ERROR] ${error.message}`);
  });
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error') {
      consoleWarnings.push(`[ERROR] ${text}`);
    }
    // Capture guide-related warnings
    if (msg.type() === 'warning' && text.includes('Guide')) {
      consoleWarnings.push(`[WARN] ${text}`);
    }
    // Capture guide split logs
    if (text.includes('[GuideSplit]') || text.includes('[SVG Import]')) {
      consoleWarnings.push(`[LOG] ${text.slice(0, 300)}`);
    }
  });

  try {
    // -----------------------------------------------------------------------
    // Setup
    // -----------------------------------------------------------------------
    console.log('\n=== Setup: Load app and create images ===');
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: TIMEOUT });
    await waitForApp(page);

    const labels = ['view-a', 'view-b', 'view-c'];
    for (let i = 0; i < labels.length; i++) {
      await addTestImage(page, labels[i], ['#dde0ff', '#ffdde0', '#ddffd0'][i]);
    }
    await switchView(page, labels[0]);
    await page.waitForTimeout(500);

    // -----------------------------------------------------------------------
    // Bind a real guide via the binding panel flow
    // -----------------------------------------------------------------------
    console.log('\n=== Step 1: Bind guide via project metadata ===');

    // First, let's understand how bindings work on the live site
    const apiInfo = await page.evaluate(async () => {
      const resp = await fetch('/api/measurement-guides/codes');
      const data = await resp.json();
      // Pick a guide that has multiple views
      const multiViewCodes = Object.entries(data.viewsByCode || {})
        .filter(([, views]) => views.length >= 2)
        .slice(0, 3);
      return {
        totalCodes: data.codes?.length || 0,
        multiViewExamples: multiViewCodes.map(([code, views]) => ({ code, views })),
      };
    });
    console.log(`  Total guide codes: ${apiInfo.totalCodes}`);
    console.log(`  Multi-view examples: ${JSON.stringify(apiInfo.multiViewExamples.slice(0, 2))}`);

    const guideCode = apiInfo.multiViewExamples[0]?.code || 'CS1B-RA-HB';
    console.log(`  Using guide: ${guideCode}`);

    // Bind using project metadata
    const bindResult = await page.evaluate(({ labels, guideCode }) => {
      const pm = window.app?.projectManager;
      if (!pm) return 'no PM';

      const meta = typeof pm.getProjectMetadata === 'function' ? pm.getProjectMetadata() : {};
      const guideState = meta.guideModelLinkState || { selections: [], linksByScope: {}, linksByImage: {} };

      // Add selection
      const selId = `sel-${guideCode}-front`;
      if (!guideState.selections.find(s => s.id === selId)) {
        guideState.selections.push({ id: selId, code: guideCode, variant: 'front' });
      }

      // Bind to each image (not frame-scoped, just image-scoped)
      for (const label of labels) {
        guideState.linksByImage[label] = selId;
        guideState.linksByScope[label] = selId;
      }

      meta.guideModelLinkState = guideState;
      pm.setProjectMetadata(meta);

      // Verify binding resolves
      const binding = typeof window.resolveGuideModelBindingForView === 'function'
        ? window.resolveGuideModelBindingForView(labels[0])
        : null;

      window.dispatchEvent(new Event('openpaint:guide-binding-changed'));

      return {
        metaSet: true,
        binding: binding ? {
          scopeType: binding.scopeType,
          code: binding.selection?.code,
          variant: binding.selection?.variant,
        } : null,
      };
    }, { labels, guideCode });
    console.log(`  Binding result: ${JSON.stringify(bindResult)}`);

    // -----------------------------------------------------------------------
    // Enable split mode and wait for guide to load
    // -----------------------------------------------------------------------
    console.log('\n=== Step 2: Enable split mode ===');
    await page.evaluate(() => window.setGuideSplitEnabled(true));
    await page.waitForTimeout(3000);

    const splitState1 = await page.evaluate(() => {
      const ws = typeof window.getGuideCompareWorkspaceState === 'function'
        ? window.getGuideCompareWorkspaceState()
        : {};
      const wrapper = document.getElementById('main-canvas-wrapper');
      const compareHost = document.getElementById('guideSplitCompareCanvasHost');
      const compareCanvas = compareHost?.querySelector('canvas');
      return {
        splitActive: wrapper?.classList.contains('guide-split-active') || false,
        leftView: ws.leftViewId || '',
        rightView: ws.rightViewId || '',
        rightKind: ws.rightSourceKind || '',
        compareCanvasExists: !!compareCanvas,
        compareHostWidth: compareHost?.offsetWidth || 0,
        compareHostHeight: compareHost?.offsetHeight || 0,
      };
    });
    console.log(`  Split state: ${JSON.stringify(splitState1)}`);

    await page.screenshot({ path: '/home/leigh/projects/OpenPaint/output/tag-leak-01-split-active.png' });

    // -----------------------------------------------------------------------
    // Step 3: Tag leak test — switch views and check right pane state
    // -----------------------------------------------------------------------
    console.log('\n=== Step 3: Tag leak test ===');

    // Draw a line on view-a to create a tag/measurement
    await page.evaluate(async (label) => {
      await window.app.projectManager.switchView(label);
    }, labels[0]);
    await page.waitForTimeout(1000);

    // Draw a measurement line on the canvas
    await page.evaluate(() => {
      const cm = window.app.canvasManager;
      const tm = window.app.toolManager;
      tm.selectTool('line');
    });
    await page.waitForTimeout(200);

    // Get canvas position and draw a line
    const canvasBox = await page.locator('.upper-canvas').boundingBox();
    if (canvasBox) {
      const cx = canvasBox.x + canvasBox.width / 2;
      const cy = canvasBox.y + canvasBox.height / 2;
      await page.mouse.move(cx - 100, cy);
      await page.mouse.down();
      await page.mouse.move(cx + 100, cy, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(500);
    }

    // Record object count on view-a
    const objCountA = await page.evaluate(() => {
      return window.app.canvasManager.fabricCanvas.getObjects().length;
    });
    console.log(`  Objects on view-a after drawing: ${objCountA}`);

    // Switch to view-b (no drawings)
    console.log('  Switching to view-b...');
    await switchView(page, labels[1]);
    await page.waitForTimeout(1500);

    const stateAfterSwitchB = await page.evaluate(() => {
      const ws = window.getGuideCompareWorkspaceState?.() || {};
      const currentView = window.app?.projectManager?.currentViewId || '';
      const mainObjects = window.app.canvasManager.fabricCanvas.getObjects().length;

      // Check compare canvas
      const compareHost = document.getElementById('guideSplitCompareCanvasHost');
      const compareCanvasEl = compareHost?.querySelector('.upper-canvas');
      // Try to get compare canvas objects via app registry
      const compareManager = window.app?.compareCanvasManager;
      const compareObjects = compareManager?.fabricCanvas?.getObjects?.()?.length ?? -1;

      return {
        currentView,
        leftView: ws.leftViewId,
        rightView: ws.rightViewId,
        mainObjects,
        compareObjects,
      };
    });
    console.log(`  After switch to view-b: ${JSON.stringify(stateAfterSwitchB)}`);
    if (stateAfterSwitchB.mainObjects > 0) {
      console.log(`  ⚠️ POTENTIAL TAG LEAK: view-b has ${stateAfterSwitchB.mainObjects} objects (expected 0 if clean)`);
    }

    await page.screenshot({ path: '/home/leigh/projects/OpenPaint/output/tag-leak-02-after-switch-b.png' });

    // Switch to view-c
    console.log('  Switching to view-c...');
    await switchView(page, labels[2]);
    await page.waitForTimeout(1500);

    const stateAfterSwitchC = await page.evaluate(() => {
      const ws = window.getGuideCompareWorkspaceState?.() || {};
      const mainObjects = window.app.canvasManager.fabricCanvas.getObjects().length;
      return {
        currentView: window.app?.projectManager?.currentViewId,
        leftView: ws.leftViewId,
        mainObjects,
      };
    });
    console.log(`  After switch to view-c: ${JSON.stringify(stateAfterSwitchC)}`);

    // Switch back to view-a — should have the line we drew
    console.log('  Switching back to view-a...');
    await switchView(page, labels[0]);
    await page.waitForTimeout(1500);

    const stateBackOnA = await page.evaluate(() => {
      return {
        currentView: window.app?.projectManager?.currentViewId,
        mainObjects: window.app.canvasManager.fabricCanvas.getObjects().length,
      };
    });
    console.log(`  Back on view-a: ${JSON.stringify(stateBackOnA)}`);
    if (stateBackOnA.mainObjects !== objCountA) {
      console.log(`  ⚠️ OBJECT COUNT CHANGED: was ${objCountA}, now ${stateBackOnA.mainObjects}`);
    }

    await page.screenshot({ path: '/home/leigh/projects/OpenPaint/output/tag-leak-03-back-on-a.png' });

    // -----------------------------------------------------------------------
    // Step 4: Check mini-guide update timing
    // -----------------------------------------------------------------------
    console.log('\n=== Step 4: Mini-guide update timing ===');

    // Switch views and measure how long until the guide state updates
    const timingResults = [];
    for (let i = 0; i < labels.length; i++) {
      const label = labels[i];
      const startTime = Date.now();

      await switchView(page, label);

      // Poll until the workspace state reflects the new view
      let settled = false;
      let settleTime = 0;
      for (let tick = 0; tick < 50; tick++) {
        await page.waitForTimeout(100);
        const wsLeft = await page.evaluate(() => {
          const ws = window.getGuideCompareWorkspaceState?.() || {};
          return ws.leftViewId || '';
        });
        if (wsLeft === label) {
          settled = true;
          settleTime = Date.now() - startTime;
          break;
        }
      }

      timingResults.push({
        view: label,
        settled,
        settleTimeMs: settled ? settleTime : 'timeout (5s+)',
      });
    }
    console.log('  Guide state update timing:');
    timingResults.forEach(r => {
      console.log(`    ${r.view}: ${r.settled ? `${r.settleTimeMs}ms` : 'TIMEOUT'}`);
    });

    // -----------------------------------------------------------------------
    // Step 5: Check guide right pane updates when switching
    // -----------------------------------------------------------------------
    console.log('\n=== Step 5: Right pane guide update check ===');

    for (const label of labels) {
      await switchView(page, label);
      await page.waitForTimeout(2000); // Give it generous time

      const rightPaneState = await page.evaluate((lbl) => {
        const ws = window.getGuideCompareWorkspaceState?.() || {};
        const binding = window.resolveGuideModelBindingForView?.(lbl);
        const splitState = window.getGuideSplitStateForView?.(lbl);
        return {
          view: lbl,
          wsLeft: ws.leftViewId,
          wsRight: ws.rightViewId,
          wsRightKind: ws.rightSourceKind,
          bindingCode: binding?.selection?.code || 'none',
          bindingScope: binding?.scopeType || 'none',
          splitState: splitState ? {
            rightViewId: splitState.rightViewId,
            rightReady: splitState.rightReady,
          } : null,
        };
      }, label);
      console.log(`  ${label}: right=${rightPaneState.wsRight || 'empty'} binding=${rightPaneState.bindingCode} scope=${rightPaneState.bindingScope}`);
    }

    // -----------------------------------------------------------------------
    // Step 6: Check the 900ms sync interval behavior
    // -----------------------------------------------------------------------
    console.log('\n=== Step 6: Sync interval behavior ===');

    // Switch view and see if the 900ms sync catches up
    await switchView(page, labels[0]);
    const syncCheckStart = Date.now();

    // Record state immediately
    const stateImmediate = await page.evaluate(() => {
      const ws = window.getGuideCompareWorkspaceState?.() || {};
      return { left: ws.leftViewId, right: ws.rightViewId };
    });

    // Wait for sync intervals to run (900ms * 2)
    await page.waitForTimeout(2000);

    const stateAfterSync = await page.evaluate(() => {
      const ws = window.getGuideCompareWorkspaceState?.() || {};
      return { left: ws.leftViewId, right: ws.rightViewId };
    });

    console.log(`  Immediate after switch: left=${stateImmediate.left} right=${stateImmediate.right}`);
    console.log(`  After 2s sync:          left=${stateAfterSync.left} right=${stateAfterSync.right}`);

    if (stateImmediate.right !== stateAfterSync.right) {
      console.log(`  ⚠️ RIGHT VIEW CHANGED during sync: ${stateImmediate.right} → ${stateAfterSync.right}`);
      console.log(`     This confirms the guide update is delayed by the sync interval.`);
    }

    // -----------------------------------------------------------------------
    // Step 7: Frame tab switching test
    // -----------------------------------------------------------------------
    console.log('\n=== Step 7: Frame tab interaction ===');

    // Check what tabs exist
    const tabInfo = await page.evaluate(() => {
      const tabs = document.querySelectorAll('[data-tab-id]');
      return Array.from(tabs).map(t => ({
        id: t.getAttribute('data-tab-id'),
        text: t.textContent?.trim()?.slice(0, 30),
        active: t.classList.contains('active'),
      }));
    });
    console.log(`  Tabs found: ${JSON.stringify(tabInfo)}`);

    // Click between tabs if they exist
    if (tabInfo.length > 1) {
      for (const tab of tabInfo) {
        await page.click(`[data-tab-id="${tab.id}"]`);
        await page.waitForTimeout(1000);
        const wsAfterTab = await page.evaluate(() => {
          const ws = window.getGuideCompareWorkspaceState?.() || {};
          return { left: ws.leftViewId, right: ws.rightViewId };
        });
        console.log(`  After tab ${tab.id}: left=${wsAfterTab.left} right=${wsAfterTab.right}`);
      }
    }

    // Take final screenshot
    await page.screenshot({ path: '/home/leigh/projects/OpenPaint/output/tag-leak-final.png' });

    // -----------------------------------------------------------------------
    // Summary
    // -----------------------------------------------------------------------
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log(`Page errors: ${pageErrors.length}`);
    if (pageErrors.length > 0) {
      pageErrors.forEach((e, i) => console.log(`  ${i + 1}. ${e.message}`));
    }
    console.log(`Console warnings/errors: ${consoleWarnings.length}`);
    if (consoleWarnings.length > 0) {
      consoleWarnings.slice(0, 15).forEach((w, i) => console.log(`  ${i + 1}. ${w.slice(0, 200)}`));
    }

  } catch (error) {
    console.error('\n!!! SCRIPT ERROR:', error.message);
    console.error(error.stack);
    await page.screenshot({ path: '/home/leigh/projects/OpenPaint/output/tag-leak-error.png' }).catch(() => {});
  } finally {
    await browser.close();
    console.log('\nBrowser closed.');
  }
})();
