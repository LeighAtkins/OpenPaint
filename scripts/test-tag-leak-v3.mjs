/**
 * Test tag leak and mini-guide timing on the live site - v3.
 * Uses correct metadata keys for guide bindings.
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

const pageErrors = [];

(async () => {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  page.on('pageerror', (error) => {
    pageErrors.push({ message: error.message, stack: error.stack });
    console.log(`  [PAGE ERROR] ${error.message}`);
  });

  try {
    console.log('\n=== Setup ===');
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: TIMEOUT });
    await waitForApp(page);

    const labels = ['view-a', 'view-b', 'view-c'];
    for (let i = 0; i < labels.length; i++) {
      await addTestImage(page, labels[i], ['#dde0ff', '#ffdde0', '#ddffd0'][i]);
    }
    await page.evaluate((lbl) => window.app.projectManager.switchView(lbl), labels[0]);
    await page.waitForTimeout(500);

    // -----------------------------------------------------------------------
    // Bind guide using correct flat metadata keys
    // -----------------------------------------------------------------------
    console.log('\n=== Step 1: Bind guide with correct metadata keys ===');
    const guideCode = 'CS1B-RA-HB'; // Has front/back/side views

    const bindResult = await page.evaluate(({ labels, guideCode }) => {
      const pm = window.app?.projectManager;
      const selId = `${guideCode}::front`;

      const selections = [{ id: selId, code: guideCode, variant: 'front' }];
      const linksByScope = {};
      const linksByImage = {};

      for (const label of labels) {
        linksByImage[label] = selId;
        linksByScope[label] = selId;

        // Also bind frame-scoped IDs
        const binding = window.resolveGuideModelBindingForView?.(label);
        if (binding?.frameScopeId) {
          linksByScope[binding.frameScopeId] = selId;
        }
      }

      // Use correct flat metadata keys
      pm.setProjectMetadata({
        measurementGuideModelSelections: selections,
        measurementGuideModelLinksByImage: linksByImage,
        measurementGuideModelLinksByScope: linksByScope,
      });

      window.dispatchEvent(new Event('openpaint:guide-binding-changed'));

      // Verify
      const verifications = {};
      for (const label of labels) {
        const b = window.resolveGuideModelBindingForView?.(label);
        verifications[label] = {
          scopeType: b?.scopeType,
          code: b?.selection?.code,
          variant: b?.selection?.variant,
        };
      }
      return verifications;
    }, { labels, guideCode });

    console.log('  Binding verification:');
    for (const [label, info] of Object.entries(bindResult)) {
      console.log(`    ${label}: scope=${info.scopeType} code=${info.code} variant=${info.variant}`);
    }

    // -----------------------------------------------------------------------
    // Enable split mode and wait for guide to load
    // -----------------------------------------------------------------------
    console.log('\n=== Step 2: Enable split mode ===');
    await page.evaluate(() => window.setGuideSplitEnabled(true));
    await page.waitForTimeout(5000); // Wait for SVG fetch + rasterize + import

    const splitState = await page.evaluate(() => {
      const ws = window.getGuideCompareWorkspaceState?.() || {};
      const compareManager = window.app?.compareCanvasManager;
      return {
        left: ws.leftViewId,
        right: ws.rightViewId,
        rightKind: ws.rightSourceKind,
        compareObjects: compareManager?.fabricCanvas?.getObjects?.()?.length ?? -1,
        hasBgImage: !!compareManager?.fabricCanvas?.backgroundImage,
      };
    });
    console.log(`  Split: left=${splitState.left} right=${splitState.right} kind=${splitState.rightKind}`);
    console.log(`  Compare: objects=${splitState.compareObjects} bgImage=${splitState.hasBgImage}`);

    await page.screenshot({ path: '/home/leigh/projects/OpenPaint/output/tag-leak-v3-01-split.png' });

    // -----------------------------------------------------------------------
    // Step 3: View switching — monitor tag state on compare canvas
    // -----------------------------------------------------------------------
    console.log('\n=== Step 3: View switching — tag state monitoring ===');

    for (const label of labels) {
      await page.evaluate((lbl) => window.app.projectManager.switchView(lbl), label);
      await page.waitForTimeout(2500); // Generous wait

      const state = await page.evaluate((lbl) => {
        const ws = window.getGuideCompareWorkspaceState?.() || {};
        const compareManager = window.app?.compareCanvasManager;
        const compareObjects = compareManager?.fabricCanvas?.getObjects?.() || [];

        // Audit compare canvas objects
        const tagObjects = compareObjects.filter(o => o.isTag);
        const lineObjects = compareObjects.filter(o => o.type === 'line' || o.__guideSplitReferenceOnly);
        const imageLabelsOnCompare = [...new Set(compareObjects.map(o => o.imageLabel).filter(Boolean))];

        return {
          currentView: window.app?.projectManager?.currentViewId,
          wsLeft: ws.leftViewId,
          wsRight: ws.rightViewId,
          totalCompareObjects: compareObjects.length,
          tags: tagObjects.length,
          lines: lineObjects.length,
          imageLabels: imageLabelsOnCompare,
          hasBgImage: !!compareManager?.fabricCanvas?.backgroundImage,
        };
      }, label);

      console.log(`  ${label}:`);
      console.log(`    ws: left=${state.wsLeft} right=${state.wsRight}`);
      console.log(`    compare: total=${state.totalCompareObjects} tags=${state.tags} lines=${state.lines}`);
      console.log(`    imageLabels on compare: [${state.imageLabels.join(', ')}]`);

      // Check for tag leak: imageLabels should only contain the current temp scope
      if (state.imageLabels.length > 1) {
        console.log(`    ⚠️ POTENTIAL TAG LEAK: multiple imageLabels on compare canvas`);
      }
    }

    // -----------------------------------------------------------------------
    // Step 4: Rapid switching — timing and state consistency
    // -----------------------------------------------------------------------
    console.log('\n=== Step 4: Rapid switching ===');

    // Switch rapidly
    for (let i = 0; i < 9; i++) {
      const label = labels[i % 3];
      await page.evaluate((lbl) => window.app.projectManager.switchView(lbl), label);
      await page.waitForTimeout(200);
    }

    // Final view is labels[0]
    await page.waitForTimeout(3000);

    const finalState = await page.evaluate(() => {
      const ws = window.getGuideCompareWorkspaceState?.() || {};
      const compareManager = window.app?.compareCanvasManager;
      const compareObjects = compareManager?.fabricCanvas?.getObjects?.() || [];
      const imageLabelsOnCompare = [...new Set(compareObjects.map(o => o.imageLabel).filter(Boolean))];

      return {
        currentView: window.app?.projectManager?.currentViewId,
        wsLeft: ws.leftViewId,
        wsRight: ws.rightViewId,
        totalCompareObjects: compareObjects.length,
        imageLabels: imageLabelsOnCompare,
      };
    });
    console.log(`  Final: view=${finalState.currentView} left=${finalState.wsLeft} right=${finalState.wsRight}`);
    console.log(`  Compare objects: ${finalState.totalCompareObjects}, imageLabels: [${finalState.imageLabels.join(', ')}]`);

    // Check: left should match current view
    if (finalState.wsLeft !== finalState.currentView) {
      console.log(`  ⚠️ LEFT VIEW STALE: view=${finalState.currentView} but ws.left=${finalState.wsLeft}`);
    }

    await page.screenshot({ path: '/home/leigh/projects/OpenPaint/output/tag-leak-v3-02-rapid.png' });

    // -----------------------------------------------------------------------
    // Step 5: Check seedGuideSplitMeasurementsFromLeft behavior
    // -----------------------------------------------------------------------
    console.log('\n=== Step 5: Measurement seed check ===');

    // On view-a, set a measurement value manually, then switch views and see if it persists on compare
    await page.evaluate((lbl) => window.app.projectManager.switchView(lbl), labels[0]);
    await page.waitForTimeout(2000);

    const seedCheck = await page.evaluate(() => {
      const ws = window.getGuideCompareWorkspaceState?.() || {};
      const mm = window.app?.metadataManager;
      if (!mm) return { error: 'no metadataManager' };

      // Check what measurement data exists for the current view and the compare temp scope
      const leftScope = ws.leftViewId || '';
      const rightScope = ws.rightViewId || '';

      const leftMeasurements = mm.strokeMeasurements?.[leftScope] || {};
      const rightMeasurements = mm.strokeMeasurements?.[rightScope] || {};

      return {
        leftScope,
        rightScope,
        leftMeasurementKeys: Object.keys(leftMeasurements).slice(0, 5),
        rightMeasurementKeys: Object.keys(rightMeasurements).slice(0, 5),
        leftMeasurementCount: Object.keys(leftMeasurements).length,
        rightMeasurementCount: Object.keys(rightMeasurements).length,
      };
    });
    console.log(`  Seed check: ${JSON.stringify(seedCheck, null, 2)}`);

    // -----------------------------------------------------------------------
    // Step 6: _ensureRightViewInFlight race condition check
    // -----------------------------------------------------------------------
    console.log('\n=== Step 6: Race condition check ===');

    // Fire two view switches in quick succession and check if the second one gets dropped
    await page.evaluate(({ labels }) => {
      // Switch to view-b then immediately to view-c
      window.app.projectManager.switchView(labels[1]);
      // Micro-delay then switch again
      setTimeout(() => {
        window.app.projectManager.switchView(labels[2]);
      }, 50);
    }, { labels });

    await page.waitForTimeout(5000);

    const raceResult = await page.evaluate(() => {
      const ws = window.getGuideCompareWorkspaceState?.() || {};
      return {
        currentView: window.app?.projectManager?.currentViewId,
        wsLeft: ws.leftViewId,
        wsRight: ws.rightViewId,
      };
    });
    console.log(`  Race result: view=${raceResult.currentView} left=${raceResult.wsLeft} right=${raceResult.wsRight}`);
    if (raceResult.wsLeft !== raceResult.currentView) {
      console.log(`  ⚠️ RACE CONDITION: left view (${raceResult.wsLeft}) doesn't match current view (${raceResult.currentView})`);
    }

    // -----------------------------------------------------------------------
    // Summary
    // -----------------------------------------------------------------------
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log(`Page errors: ${pageErrors.length}`);
    pageErrors.forEach((e, i) => {
      console.log(`  ${i + 1}. ${e.message}`);
      if (e.stack) console.log(`     ${e.stack.split('\n').slice(1, 3).join('\n     ')}`);
    });

  } catch (error) {
    console.error('\n!!! SCRIPT ERROR:', error.message);
    await page.screenshot({ path: '/home/leigh/projects/OpenPaint/output/tag-leak-v3-error.png' }).catch(() => {});
  } finally {
    await browser.close();
    console.log('\nBrowser closed.');
  }
})();
