/**
 * Test guide split mode crash using the live site's public APIs
 * and real guide codes from the production server.
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
  await page.waitForTimeout(300);
}

const pageErrors = [];
const consoleErrors = [];

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
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
      console.log(`  [CONSOLE ERROR] ${msg.text().slice(0, 200)}`);
    }
  });

  try {
    // -----------------------------------------------------------------------
    // Step 1: Load app and add images
    // -----------------------------------------------------------------------
    console.log('\n=== Step 1: Load app ===');
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: TIMEOUT });
    await waitForApp(page);

    console.log('\n=== Step 2: Add test images ===');
    const labels = ['img-alpha', 'img-beta', 'img-gamma'];
    for (let i = 0; i < labels.length; i++) {
      console.log(`  Adding ${labels[i]}...`);
      await addTestImage(page, labels[i], ['#dde0ff', '#ffdde0', '#ddffd0'][i]);
    }
    await switchView(page, labels[0]);

    // -----------------------------------------------------------------------
    // Step 2: Bind a real guide code via openGuideBindingPanel
    // -----------------------------------------------------------------------
    console.log('\n=== Step 3: Bind guides using resolveActiveGuideForView ===');

    // Use the project metadata approach to bind guides
    const bindResult = await page.evaluate(async ({ labels }) => {
      const results = [];

      // Get guide codes from the API
      const resp = await fetch('/api/measurement-guides/codes');
      const data = await resp.json();
      const testCode = data.codes?.[0] || 'CS1B-RA-HB';
      results.push(`Using guide code: ${testCode}`);

      // Access project metadata to store bindings
      const pm = window.app?.projectManager;
      if (!pm) return ['No projectManager'];

      // Store a guide selection in project metadata
      const meta = typeof pm.getProjectMetadata === 'function' ? pm.getProjectMetadata() : {};
      const guideState = meta.guideModelLinkState || { selections: [], linksByScope: {}, linksByImage: {} };

      const selId = `test-sel-${testCode}`;
      if (!guideState.selections.find((s) => s.id === selId)) {
        guideState.selections.push({ id: selId, code: testCode, variant: 'front' });
      }

      // Bind to all views
      for (const label of labels) {
        guideState.linksByScope[label] = selId;
        guideState.linksByImage[label] = selId;
      }

      meta.guideModelLinkState = guideState;
      if (typeof pm.setProjectMetadata === 'function') {
        pm.setProjectMetadata(meta);
        results.push('Set metadata with guide bindings');
      } else if (typeof pm.updateProjectMetadata === 'function') {
        pm.updateProjectMetadata({ guideModelLinkState: guideState });
        results.push('Updated metadata with guide bindings');
      } else {
        results.push('No metadata setter found');
        results.push('PM methods: ' + Object.getOwnPropertyNames(Object.getPrototypeOf(pm)).join(', '));
      }

      // Dispatch binding changed event
      window.dispatchEvent(new Event('openpaint:guide-binding-changed'));
      results.push('Dispatched guide-binding-changed');

      // Check if binding resolved
      if (typeof window.resolveGuideModelBindingForView === 'function') {
        const binding = window.resolveGuideModelBindingForView(labels[0]);
        results.push(`Binding for ${labels[0]}: ${JSON.stringify(binding)}`);
      }

      return results;
    }, { labels });
    console.log('  Bind results:', bindResult);

    // -----------------------------------------------------------------------
    // Step 4: Enable split mode
    // -----------------------------------------------------------------------
    console.log('\n=== Step 4: Enable split mode ===');
    await page.evaluate(() => window.setGuideSplitEnabled(true));
    await page.waitForTimeout(2000);

    const splitState = await page.evaluate(() => {
      const wrapper = document.getElementById('main-canvas-wrapper');
      return {
        splitActive: wrapper?.classList.contains('guide-split-active') || false,
        hasGuidePane: !!document.getElementById('guideSplitGuidePane'),
        hasCompareCanvas: !!document.getElementById('guideSplitCompareCanvasHost'),
        wsState: typeof window.getGuideCompareWorkspaceState === 'function'
          ? window.getGuideCompareWorkspaceState()
          : null,
      };
    });
    console.log('  Split state:', JSON.stringify(splitState, null, 2));

    await page.screenshot({ path: '/home/leigh/projects/OpenPaint/output/guide-split-active.png' });
    console.log('  Screenshot saved: guide-split-active.png');

    // -----------------------------------------------------------------------
    // Step 5: Rapid view switching in split mode
    // -----------------------------------------------------------------------
    console.log('\n=== Step 5: Rapid view switching (stress test) ===');
    const errCountBefore = pageErrors.length;

    // Phase A: Normal speed (300ms between switches)
    console.log('  Phase A: Normal speed...');
    for (const label of labels) {
      await switchView(page, label);
      await page.waitForTimeout(300);
    }
    await page.waitForTimeout(1000);

    // Phase B: Fast (100ms between switches)
    console.log('  Phase B: Fast speed...');
    for (let round = 0; round < 3; round++) {
      for (const label of labels) {
        await switchView(page, label);
        await page.waitForTimeout(100);
      }
    }
    await page.waitForTimeout(1500);

    // Phase C: Very fast (50ms, no settle between rounds)
    console.log('  Phase C: Very fast...');
    for (let round = 0; round < 5; round++) {
      for (const label of labels) {
        await page.evaluate((lbl) => window.app.projectManager.switchView(lbl), label);
        await page.waitForTimeout(50);
      }
    }
    await page.waitForTimeout(3000);

    // Phase D: Fire-and-forget (no await on switchView)
    console.log('  Phase D: Fire-and-forget switching...');
    await page.evaluate(({ labels }) => {
      // Switch views as fast as possible without waiting
      for (let i = 0; i < 20; i++) {
        const label = labels[i % labels.length];
        window.app.projectManager.switchView(label);
      }
    }, { labels });
    await page.waitForTimeout(5000);

    const errCountAfter = pageErrors.length;
    console.log(`  Errors during stress test: ${errCountAfter - errCountBefore}`);

    // -----------------------------------------------------------------------
    // Step 6: Check for stale state / tag leak
    // -----------------------------------------------------------------------
    console.log('\n=== Step 6: Check for state consistency ===');

    // Switch to each view and check the compare state
    for (const label of labels) {
      await switchView(page, label);
      await page.waitForTimeout(1500);

      const viewState = await page.evaluate((lbl) => {
        const currentView = window.app?.projectManager?.currentViewId || '';
        const wsState = typeof window.getGuideCompareWorkspaceState === 'function'
          ? window.getGuideCompareWorkspaceState()
          : {};
        const binding = typeof window.resolveGuideModelBindingForView === 'function'
          ? window.resolveGuideModelBindingForView(lbl)
          : null;
        const splitState = typeof window.getGuideSplitStateForView === 'function'
          ? window.getGuideSplitStateForView(lbl)
          : null;

        return {
          currentView,
          wsLeftView: wsState?.leftViewId || '',
          wsRightView: wsState?.rightViewId || '',
          wsRightKind: wsState?.rightSourceKind || '',
          bindingCode: binding?.selection?.code || 'none',
          bindingScopeType: binding?.scopeType || 'none',
          splitState,
        };
      }, label);

      console.log(`  View ${label}: left=${viewState.wsLeftView} right=${viewState.wsRightView} binding=${viewState.bindingCode}`);

      // Check consistency: left view should match current view
      if (viewState.wsLeftView && viewState.wsLeftView !== label) {
        console.log(`    ⚠️ LEFT VIEW MISMATCH: expected ${label}, got ${viewState.wsLeftView}`);
      }
    }

    // -----------------------------------------------------------------------
    // Step 7: Test toggle split off/on during view switch
    // -----------------------------------------------------------------------
    console.log('\n=== Step 7: Toggle split during view switch ===');
    const errCountBefore2 = pageErrors.length;

    await page.evaluate(({ labels }) => {
      // Toggle split off, switch view, toggle back on — rapidly
      window.setGuideSplitEnabled(false);
      window.app.projectManager.switchView(labels[1]);
      window.setGuideSplitEnabled(true);
      window.app.projectManager.switchView(labels[2]);
      window.setGuideSplitEnabled(false);
      window.setGuideSplitEnabled(true);
      window.app.projectManager.switchView(labels[0]);
    }, { labels });
    await page.waitForTimeout(3000);

    console.log(`  Errors during toggle test: ${pageErrors.length - errCountBefore2}`);

    // -----------------------------------------------------------------------
    // Step 8: Test opening guide binding panel mid-switch
    // -----------------------------------------------------------------------
    console.log('\n=== Step 8: Open guide binding panel during switches ===');
    const errCountBefore3 = pageErrors.length;

    await page.evaluate(({ labels }) => {
      if (typeof window.openGuideBindingPanel === 'function') {
        window.app.projectManager.switchView(labels[0]);
        window.openGuideBindingPanel({ viewId: labels[0], source: 'test' });
        window.app.projectManager.switchView(labels[1]);
        window.openGuideBindingPanel({ viewId: labels[1], source: 'test' });
      }
    }, { labels });
    await page.waitForTimeout(2000);

    console.log(`  Errors during binding panel test: ${pageErrors.length - errCountBefore3}`);

    await page.screenshot({ path: '/home/leigh/projects/OpenPaint/output/guide-crash-final.png' });
    console.log('  Final screenshot saved');

    // -----------------------------------------------------------------------
    // Summary
    // -----------------------------------------------------------------------
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total page errors: ${pageErrors.length}`);
    console.log(`Total console errors: ${consoleErrors.length}`);

    if (pageErrors.length > 0) {
      console.log('\n--- Page Errors ---');
      pageErrors.forEach((e, i) => {
        console.log(`\n  Error ${i + 1}: ${e.message}`);
        if (e.stack) {
          const frames = e.stack.split('\n').slice(0, 5);
          frames.forEach((f) => console.log(`    ${f}`));
        }
      });
    }

    if (consoleErrors.length > 0) {
      console.log('\n--- Console Errors (first 20) ---');
      consoleErrors.slice(0, 20).forEach((e, i) => {
        console.log(`  ${i + 1}. ${e.slice(0, 300)}`);
      });
    }

    if (pageErrors.length === 0 && consoleErrors.length === 0) {
      console.log('\n✅ No crashes detected during guide split stress testing.');
    }
  } catch (error) {
    console.error('\n!!! SCRIPT ERROR:', error.message);
    console.error(error.stack);
    await page.screenshot({ path: '/home/leigh/projects/OpenPaint/output/guide-crash-script-error.png' }).catch(() => {});
  } finally {
    await browser.close();
    console.log('\nBrowser closed.');
  }
})();
