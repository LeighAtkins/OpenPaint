/**
 * Standalone Playwright script to test the measurement guide split mode
 * on the live site (sofapaint.vercel.app) for crashes.
 *
 * Usage: npx playwright test scripts/test-guide-crash.mjs
 * Or:    node scripts/test-guide-crash.mjs
 */
import { chromium } from 'playwright';

const BASE_URL = 'https://sofapaint.vercel.app';
const TIMEOUT = 60_000;

async function waitForApp(page) {
  console.log('  Waiting for app to initialize...');
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
  console.log('  App initialized.');
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
        const pm = window.app.projectManager;
        pm.addImage(lbl, dataURL, { refreshBackground: true })
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

// Collect page errors
const pageErrors = [];
const consoleErrors = [];

(async () => {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();

  page.on('pageerror', (error) => {
    pageErrors.push({ message: error.message, stack: error.stack });
    console.log(`  [PAGE ERROR] ${error.message}`);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  try {
    // -----------------------------------------------------------------------
    // Step 1: Load the app
    // -----------------------------------------------------------------------
    console.log('\n=== Step 1: Navigate to app ===');
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: TIMEOUT });
    await waitForApp(page);

    // -----------------------------------------------------------------------
    // Step 2: Add multiple test images
    // -----------------------------------------------------------------------
    console.log('\n=== Step 2: Add test images ===');
    const labels = ['image-a', 'image-b', 'image-c'];
    const colors = ['#e0e0ff', '#ffe0e0', '#e0ffe0'];
    for (let i = 0; i < labels.length; i++) {
      console.log(`  Adding ${labels[i]}...`);
      await addTestImage(page, labels[i], colors[i]);
    }
    await switchView(page, labels[0]);

    // -----------------------------------------------------------------------
    // Step 3: Check if guide flash module is available
    // -----------------------------------------------------------------------
    console.log('\n=== Step 3: Check guide flash module ===');
    const hasGuideModule = await page.evaluate(() => {
      // Check common exposed paths
      return !!(
        (window.__measurementGuideFlash) ||
        (window.initMeasurementGuideFlash) ||
        (window.app?.measurementGuideFlash)
      );
    });
    console.log(`  Guide module available: ${hasGuideModule}`);

    // Check what's on the window for guide-related stuff
    const guideInfo = await page.evaluate(() => {
      const keys = Object.keys(window).filter(
        (k) =>
          k.toLowerCase().includes('guide') ||
          k.toLowerCase().includes('measurement') ||
          k.toLowerCase().includes('split'),
      );
      return {
        windowKeys: keys,
        hasOpenGuideBindingPanel: typeof window.openGuideBindingPanel === 'function',
        hasGuideFlash: typeof window.showGuideFlash === 'function',
        hasGuideSplit: typeof window.setGuideSplitEnabled === 'function',
        hasMeasurementGuideFlash: typeof window.__measurementGuideFlash === 'object',
        projectManagerMethods: window.app?.projectManager
          ? Object.getOwnPropertyNames(Object.getPrototypeOf(window.app.projectManager)).filter(
              (m) => m.includes('view') || m.includes('View') || m.includes('switch'),
            )
          : [],
        views: window.app?.projectManager?.views
          ? Object.keys(window.app.projectManager.views)
          : [],
      };
    });
    console.log('  Guide-related window keys:', guideInfo.windowKeys.slice(0, 20));
    console.log('  openGuideBindingPanel:', guideInfo.hasOpenGuideBindingPanel);
    console.log('  showGuideFlash:', guideInfo.hasGuideFlash);
    console.log('  setGuideSplitEnabled:', guideInfo.hasGuideSplit);
    console.log('  __measurementGuideFlash:', guideInfo.hasMeasurementGuideFlash);
    console.log('  ProjectManager view methods:', guideInfo.projectManagerMethods);
    console.log('  Current views:', guideInfo.views);

    // -----------------------------------------------------------------------
    // Step 4: Try to enable guide split mode
    // -----------------------------------------------------------------------
    console.log('\n=== Step 4: Enable guide split mode ===');

    // Try finding the guide split toggle in the UI
    const splitToggleInfo = await page.evaluate(() => {
      // Look for guide split button/toggle
      const candidates = [
        document.querySelector('[data-action="toggle-guide-split"]'),
        document.querySelector('#guideSplitToggle'),
        document.querySelector('.guide-split-toggle'),
        document.getElementById('guideSplitBtn'),
      ];
      const found = candidates.find(Boolean);
      if (found) return { found: true, id: found.id, tag: found.tagName, text: found.textContent?.trim() };

      // Look for keyboard shortcut
      const allButtons = Array.from(document.querySelectorAll('button'));
      const guideButtons = allButtons.filter(
        (b) =>
          (b.textContent || '').toLowerCase().includes('guide') ||
          (b.textContent || '').toLowerCase().includes('split') ||
          (b.title || '').toLowerCase().includes('guide'),
      );
      return {
        found: false,
        guideButtons: guideButtons.map((b) => ({
          id: b.id,
          text: b.textContent?.trim()?.slice(0, 50),
          title: b.title,
          classes: b.className,
        })),
      };
    });
    console.log('  Split toggle:', JSON.stringify(splitToggleInfo, null, 2));

    // Try to enable via JS API
    const splitEnabled = await page.evaluate(() => {
      if (typeof window.setGuideSplitEnabled === 'function') {
        window.setGuideSplitEnabled(true);
        return 'enabled via window.setGuideSplitEnabled';
      }
      if (window.__measurementGuideFlash?.setGuideSplitEnabled) {
        window.__measurementGuideFlash.setGuideSplitEnabled(true);
        return 'enabled via __measurementGuideFlash';
      }
      // Try dispatching the keyboard shortcut (commonly Shift+G or similar)
      return 'no API found';
    });
    console.log(`  Split mode: ${splitEnabled}`);

    await page.waitForTimeout(1000);

    // Check if split mode is actually active
    const splitActive = await page.evaluate(() => {
      const wrapper = document.getElementById('main-canvas-wrapper');
      return {
        hasSplitClass: wrapper?.classList.contains('guide-split-active') || false,
        hasGuidePane: !!document.getElementById('guideSplitGuidePane'),
        wrapperClasses: wrapper?.className || '',
      };
    });
    console.log('  Split active:', JSON.stringify(splitActive));

    // -----------------------------------------------------------------------
    // Step 5: Bind guides to views
    // -----------------------------------------------------------------------
    console.log('\n=== Step 5: Bind guides ===');
    const bindResult = await page.evaluate(({ labels }) => {
      const results = [];

      // Try to find guide binding functions
      if (typeof window.openGuideBindingPanel === 'function') {
        results.push('openGuideBindingPanel available');
      }

      // Check if guide model link state is accessible
      const flash = window.__measurementGuideFlash;
      if (flash?.getGuideModelLinkState) {
        const state = flash.getGuideModelLinkState();
        results.push(`linkState: ${JSON.stringify({
          selections: state.selections?.length || 0,
          scopes: Object.keys(state.linksByScope || {}).length,
        })}`);

        // Add a test selection
        const testSel = { id: 'test-sel-1', code: 'TEST', variant: 'front' };
        if (!state.selections.find((s) => s.id === testSel.id)) {
          state.selections.push(testSel);
        }
        // Bind to each view
        labels.forEach((label) => {
          state.linksByScope[label] = testSel.id;
          state.linksByImage[label] = testSel.id;
        });
        flash.saveGuideModelLinkState(state);
        window.dispatchEvent(new Event('openpaint:guide-binding-changed'));
        results.push('Bound TEST guide to all views');
      } else {
        results.push('No guide binding API found');
      }

      return results;
    }, { labels });
    console.log('  Bind results:', bindResult);

    await page.waitForTimeout(1000);

    // -----------------------------------------------------------------------
    // Step 6: Rapid view switching (simulate mini-stepper)
    // -----------------------------------------------------------------------
    console.log('\n=== Step 6: Rapid view switching ===');
    const errorsBefore = pageErrors.length;

    for (let round = 0; round < 5; round++) {
      for (const label of labels) {
        try {
          await switchView(page, label);
          await page.waitForTimeout(50); // Very fast switching
        } catch (e) {
          console.log(`  ERROR switching to ${label}: ${e.message}`);
        }
      }
      console.log(`  Round ${round + 1} complete`);
    }

    // Let async ops settle
    await page.waitForTimeout(3000);

    const errorsAfter = pageErrors.length;
    console.log(`  Errors during switching: ${errorsAfter - errorsBefore}`);
    if (errorsAfter > errorsBefore) {
      for (let i = errorsBefore; i < errorsAfter; i++) {
        console.log(`    Error ${i + 1}: ${pageErrors[i].message}`);
        if (pageErrors[i].stack) {
          console.log(`      Stack: ${pageErrors[i].stack.split('\n').slice(0, 3).join('\n      ')}`);
        }
      }
    }

    // -----------------------------------------------------------------------
    // Step 7: Check final state
    // -----------------------------------------------------------------------
    console.log('\n=== Step 7: Final state ===');
    const finalState = await page.evaluate(() => {
      const flash = window.__measurementGuideFlash;
      return {
        currentView: window.app?.projectManager?.currentViewId || '',
        leftView: flash?.guideCompareWorkspaceState?.leftViewId || 'N/A',
        rightView: flash?.guideCompareWorkspaceState?.rightViewId || 'N/A',
        rightSourceKind: flash?.guideCompareWorkspaceState?.rightSourceKind || 'N/A',
        splitActive:
          document.getElementById('main-canvas-wrapper')?.classList.contains('guide-split-active') ||
          false,
        compareCanvasObjects: flash?.guideSplitCompareCanvasManager?.fabricCanvas?.getObjects?.()?.length ?? -1,
      };
    });
    console.log('  Final state:', JSON.stringify(finalState, null, 2));

    // Take screenshot
    await page.screenshot({ path: '/home/leigh/projects/OpenPaint/output/guide-crash-test.png', fullPage: false });
    console.log('  Screenshot saved to output/guide-crash-test.png');

    // -----------------------------------------------------------------------
    // Step 8: Test the guide overlay flow directly
    // -----------------------------------------------------------------------
    console.log('\n=== Step 8: Test guide overlay rendering ===');
    const overlayTest = await page.evaluate(async () => {
      const results = [];
      try {
        // Check if showGuideFlash works
        if (typeof window.showGuideFlash === 'function') {
          window.showGuideFlash({ holdMode: true });
          results.push('showGuideFlash called');
          await new Promise((r) => setTimeout(r, 500));
          const overlay = document.getElementById('measurementGuideFlashOverlay');
          results.push(`overlay exists: ${!!overlay}, visible: ${overlay?.classList?.contains('visible')}`);
        }

        // Check for the guide SVG fetch endpoint
        try {
          const resp = await fetch('/api/measurement-guides/codes');
          const data = await resp.json();
          results.push(`guides API: ${JSON.stringify(data)}`);
        } catch (e) {
          results.push(`guides API error: ${e.message}`);
        }
      } catch (e) {
        results.push(`Error: ${e.message}`);
      }
      return results;
    });
    console.log('  Overlay test:', overlayTest);

    // -----------------------------------------------------------------------
    // Summary
    // -----------------------------------------------------------------------
    console.log('\n=== SUMMARY ===');
    console.log(`Total page errors: ${pageErrors.length}`);
    console.log(`Total console errors: ${consoleErrors.length}`);
    if (pageErrors.length > 0) {
      console.log('\nPage errors:');
      pageErrors.forEach((e, i) => {
        console.log(`  ${i + 1}. ${e.message}`);
      });
    }
    if (consoleErrors.length > 0) {
      console.log('\nConsole errors (first 10):');
      consoleErrors.slice(0, 10).forEach((e, i) => {
        console.log(`  ${i + 1}. ${e.slice(0, 200)}`);
      });
    }
  } catch (error) {
    console.error('\n!!! TEST SCRIPT ERROR:', error.message);
    console.error(error.stack);
    await page.screenshot({ path: '/home/leigh/projects/OpenPaint/output/guide-crash-error.png' }).catch(() => {});
  } finally {
    await browser.close();
    console.log('\nBrowser closed.');
  }
})();
