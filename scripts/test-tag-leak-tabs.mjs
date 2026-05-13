/**
 * Test tag leak specifically with frame tab switching + different guide codes.
 * The user reported: tags leak, go away after moving between tabs again.
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

    // Create images
    const labels = ['img-1', 'img-2', 'img-3'];
    for (let i = 0; i < labels.length; i++) {
      await addTestImage(page, labels[i], ['#dde0ff', '#ffdde0', '#ddffd0'][i]);
    }
    await page.evaluate((lbl) => window.app.projectManager.switchView(lbl), labels[0]);
    await page.waitForTimeout(500);

    // -----------------------------------------------------------------------
    // Bind DIFFERENT guides to different views
    // -----------------------------------------------------------------------
    console.log('\n=== Step 1: Bind different guides to different views ===');

    const codes = ['CS1B-RA-HB', 'CS1B-SA-HB', 'CS3B-RA-HB'];

    const bindResult = await page.evaluate(({ labels, codes }) => {
      const pm = window.app?.projectManager;
      const selections = codes.map((code, i) => ({
        id: `${code}::front`,
        code,
        variant: 'front',
      }));

      const linksByScope = {};
      const linksByImage = {};

      labels.forEach((label, i) => {
        const selId = selections[i].id;
        linksByImage[label] = selId;
        linksByScope[label] = selId;

        const binding = window.resolveGuideModelBindingForView?.(label);
        if (binding?.frameScopeId) {
          linksByScope[binding.frameScopeId] = selId;
        }
      });

      pm.setProjectMetadata({
        measurementGuideModelSelections: selections,
        measurementGuideModelLinksByImage: linksByImage,
        measurementGuideModelLinksByScope: linksByScope,
      });

      window.dispatchEvent(new Event('openpaint:guide-binding-changed'));

      const results = {};
      labels.forEach((label, i) => {
        const b = window.resolveGuideModelBindingForView?.(label);
        results[label] = { code: b?.selection?.code, expected: codes[i] };
      });
      return results;
    }, { labels, codes });

    for (const [label, info] of Object.entries(bindResult)) {
      console.log(`  ${label}: code=${info.code} (expected ${info.expected}) ${info.code === info.expected ? '✓' : '✗'}`);
    }

    // -----------------------------------------------------------------------
    // Enable split and verify initial load
    // -----------------------------------------------------------------------
    console.log('\n=== Step 2: Enable split mode ===');
    await page.evaluate(() => window.setGuideSplitEnabled(true));
    await page.waitForTimeout(5000);

    const splitState = await page.evaluate(() => {
      const ws = window.getGuideCompareWorkspaceState?.() || {};
      const cm = window.app?.compareCanvasManager;
      return {
        left: ws.leftViewId,
        right: ws.rightViewId,
        compareObjects: cm?.fabricCanvas?.getObjects?.()?.length ?? -1,
        hasBg: !!cm?.fabricCanvas?.backgroundImage,
      };
    });
    console.log(`  Split: left=${splitState.left} right=${splitState.right} objects=${splitState.compareObjects} bg=${splitState.hasBg}`);

    await page.screenshot({ path: '/home/leigh/projects/OpenPaint/output/tag-leak-tabs-01.png' });

    // -----------------------------------------------------------------------
    // Step 3: Switch between views with DIFFERENT guides — this is the leak scenario
    // -----------------------------------------------------------------------
    console.log('\n=== Step 3: Switch between views with different guides ===');

    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < labels.length; i++) {
        const label = labels[i];
        await page.evaluate((lbl) => window.app.projectManager.switchView(lbl), label);
        await page.waitForTimeout(3000); // Longer wait for new guide to load

        const state = await page.evaluate((lbl) => {
          const ws = window.getGuideCompareWorkspaceState?.() || {};
          const cm = window.app?.compareCanvasManager;
          const objects = cm?.fabricCanvas?.getObjects?.() || [];
          const imageLabelsOnCompare = [...new Set(objects.map(o => o.imageLabel).filter(Boolean))];
          const tagLabels = objects.filter(o => o.isTag).map(o => o.strokeLabel || '').slice(0, 5);

          const binding = window.resolveGuideModelBindingForView?.(lbl);

          return {
            currentView: window.app?.projectManager?.currentViewId,
            wsLeft: ws.leftViewId,
            wsRight: ws.rightViewId,
            boundCode: binding?.selection?.code || 'none',
            totalObjects: objects.length,
            tags: objects.filter(o => o.isTag).length,
            imageLabels: imageLabelsOnCompare,
            sampleTagLabels: tagLabels,
          };
        }, label);

        const rightCodeMatch = state.wsRight?.includes(codes[i]) ? '✓' : '✗';
        console.log(`  ${label} [round ${round + 1}]:`);
        console.log(`    bound=${state.boundCode} right=${state.wsRight} ${rightCodeMatch}`);
        console.log(`    objects=${state.totalObjects} tags=${state.tags} imageLabels=[${state.imageLabels.join(', ')}]`);

        // TAG LEAK CHECK: if imageLabels contains scopes from previous views
        if (state.imageLabels.length > 1) {
          console.log(`    ⚠️ TAG LEAK: multiple image labels on compare canvas!`);
        }

        // RIGHT VIEW STALE CHECK: right should contain the current view's guide code
        if (state.boundCode !== 'none' && !state.wsRight?.includes(state.boundCode)) {
          console.log(`    ⚠️ STALE RIGHT VIEW: bound to ${state.boundCode} but right shows ${state.wsRight}`);
        }
      }
      if (round === 0) console.log('  --- Round 2 ---');
    }

    // -----------------------------------------------------------------------
    // Step 4: Frame tab switching within a single view
    // -----------------------------------------------------------------------
    console.log('\n=== Step 4: Frame tab switching ===');

    // Switch to view that has frame tabs
    await page.evaluate((lbl) => window.app.projectManager.switchView(lbl), labels[0]);
    await page.waitForTimeout(2000);

    const tabInfo = await page.evaluate(() => {
      const captureTabState = window.captureTabsByLabel?.[window.app?.projectManager?.currentViewId];
      const tabButtons = document.querySelectorAll('.capture-tab-btn, [data-tab-id]');
      return {
        currentView: window.app?.projectManager?.currentViewId,
        tabState: captureTabState ? {
          activeTabId: captureTabState.activeTabId || captureTabState.active || '',
          tabCount: Array.isArray(captureTabState.tabs) ? captureTabState.tabs.length : 0,
        } : null,
        tabButtons: Array.from(tabButtons).map(b => ({
          id: b.getAttribute('data-tab-id') || b.id,
          text: b.textContent?.trim()?.slice(0, 15),
          active: b.classList.contains('active'),
        })),
      };
    });
    console.log(`  Current view: ${tabInfo.currentView}`);
    console.log(`  Tab state: ${JSON.stringify(tabInfo.tabState)}`);
    console.log(`  Tab buttons: ${JSON.stringify(tabInfo.tabButtons)}`);

    // Click each tab and check guide state
    for (const tab of tabInfo.tabButtons) {
      if (!tab.id) continue;
      try {
        await page.click(`[data-tab-id="${tab.id}"]`);
      } catch {
        try {
          await page.click(`#${tab.id}`);
        } catch {
          console.log(`    Could not click tab ${tab.id}`);
          continue;
        }
      }
      await page.waitForTimeout(2000);

      const afterTab = await page.evaluate((tabId) => {
        const ws = window.getGuideCompareWorkspaceState?.() || {};
        const cm = window.app?.compareCanvasManager;
        const objects = cm?.fabricCanvas?.getObjects?.() || [];
        const binding = window.resolveGuideModelBindingForView?.();
        return {
          wsLeft: ws.leftViewId,
          wsRight: ws.rightViewId,
          boundCode: binding?.selection?.code || 'none',
          boundScopeType: binding?.scopeType,
          frameScopeId: binding?.frameScopeId,
          totalObjects: objects.length,
          imageLabels: [...new Set(objects.map(o => o.imageLabel).filter(Boolean))],
        };
      }, tab.id);

      console.log(`  After tab ${tab.id} (${tab.text}):`);
      console.log(`    bound=${afterTab.boundCode} scope=${afterTab.boundScopeType} frame=${afterTab.frameScopeId}`);
      console.log(`    right=${afterTab.wsRight} objects=${afterTab.totalObjects}`);
      console.log(`    imageLabels=[${afterTab.imageLabels.join(', ')}]`);
    }

    // -----------------------------------------------------------------------
    // Step 5: The "mini-guide doesn't update in time" check
    // -----------------------------------------------------------------------
    console.log('\n=== Step 5: Mini-guide timing check ===');

    // Measure: after switchView, how long until right pane updates
    for (let i = 0; i < labels.length; i++) {
      const label = labels[i];
      const expectedCode = codes[i];
      const t0 = Date.now();

      await page.evaluate((lbl) => window.app.projectManager.switchView(lbl), label);

      // Poll until right view contains the expected code
      let rightUpdated = false;
      let rightTime = 0;
      for (let tick = 0; tick < 60; tick++) {
        await page.waitForTimeout(100);
        const wsRight = await page.evaluate(() =>
          window.getGuideCompareWorkspaceState?.()?.rightViewId || ''
        );
        if (wsRight.includes(expectedCode)) {
          rightUpdated = true;
          rightTime = Date.now() - t0;
          break;
        }
      }

      console.log(`  ${label} → ${expectedCode}: right updated in ${rightUpdated ? rightTime + 'ms' : 'TIMEOUT (6s+)'}`);
    }

    await page.screenshot({ path: '/home/leigh/projects/OpenPaint/output/tag-leak-tabs-final.png' });

    // -----------------------------------------------------------------------
    // Summary
    // -----------------------------------------------------------------------
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log(`Page errors: ${pageErrors.length}`);
    pageErrors.forEach((e, i) => {
      console.log(`  ${i + 1}. ${e.message}`);
    });
    if (pageErrors.length === 0) {
      console.log('  No crashes detected.');
    }

  } catch (error) {
    console.error('\n!!! SCRIPT ERROR:', error.message);
    await page.screenshot({ path: '/home/leigh/projects/OpenPaint/output/tag-leak-tabs-error.png' }).catch(() => {});
  } finally {
    await browser.close();
    console.log('\nBrowser closed.');
  }
})();
