/**
 * Test tag leak and mini-guide timing on the live site - v2.
 * Focuses on understanding binding resolution and guide update timing.
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
const guideLogs = [];

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
    if (text.includes('[GuideSplit]') || text.includes('[Guide]') || text.includes('guide-split') || text.includes('binding')) {
      guideLogs.push(text.slice(0, 300));
    }
  });

  try {
    console.log('\n=== Setup ===');
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: TIMEOUT });
    await waitForApp(page);

    const labels = ['view-a', 'view-b', 'view-c'];
    for (let i = 0; i < labels.length; i++) {
      await addTestImage(page, labels[i], ['#dde0ff', '#ffdde0', '#ddffd0'][i]);
    }

    // Switch to view-a
    await page.evaluate((lbl) => window.app.projectManager.switchView(lbl), labels[0]);
    await page.waitForTimeout(500);

    // -----------------------------------------------------------------------
    // Understand binding scope resolution
    // -----------------------------------------------------------------------
    console.log('\n=== Step 1: Understand binding scope resolution ===');

    const scopeInfo = await page.evaluate(({ labels }) => {
      const results = {};

      // Check what scope IDs are being used
      for (const label of labels) {
        const binding = window.resolveGuideModelBindingForView?.(label);
        results[label] = {
          imageScopeId: binding?.imageScopeId || 'N/A',
          frameScopeId: binding?.frameScopeId || 'N/A',
          scopeType: binding?.scopeType || 'none',
          selectionId: binding?.selectionId || '',
        };
      }

      // Check what tabs exist per view
      const captureTabsByLabel = window.captureTabsByLabel || {};
      results._captureTabsByLabel = {};
      for (const label of labels) {
        const tabState = captureTabsByLabel[label];
        if (tabState && typeof tabState === 'object') {
          results._captureTabsByLabel[label] = {
            activeTabId: tabState.activeTabId || tabState.active || '',
            tabs: Array.isArray(tabState.tabs)
              ? tabState.tabs.map(t => typeof t === 'object' ? (t.id || t.tabId || '') : t)
              : [],
          };
        }
      }

      // Check current guide model link state
      const pm = window.app?.projectManager;
      const meta = pm?.getProjectMetadata?.() || {};
      const guideState = meta.guideModelLinkState || {};
      results._linkState = {
        selections: (guideState.selections || []).map(s => ({ id: s.id, code: s.code, variant: s.variant })),
        linksByScope: guideState.linksByScope || {},
        linksByImage: guideState.linksByImage || {},
      };

      return results;
    }, { labels });

    console.log('  Scope info per view:');
    for (const label of labels) {
      const info = scopeInfo[label];
      console.log(`    ${label}: image=${info.imageScopeId} frame=${info.frameScopeId} scope=${info.scopeType}`);
    }
    console.log('  Capture tabs:', JSON.stringify(scopeInfo._captureTabsByLabel, null, 2));
    console.log('  Link state:', JSON.stringify(scopeInfo._linkState, null, 2));

    // -----------------------------------------------------------------------
    // Step 2: Fix bindings using the correct scope IDs
    // -----------------------------------------------------------------------
    console.log('\n=== Step 2: Bind guide using correct scope IDs ===');

    const guideCode = 'CS1-CNR';
    const bindResult = await page.evaluate(({ labels, guideCode }) => {
      const pm = window.app?.projectManager;
      const meta = pm?.getProjectMetadata?.() || {};
      const guideState = meta.guideModelLinkState || { selections: [], linksByScope: {}, linksByImage: {} };

      const selId = `sel-${guideCode}-front`;
      if (!guideState.selections.find(s => s.id === selId)) {
        guideState.selections.push({ id: selId, code: guideCode, variant: 'front' });
      }

      // Bind using BOTH image-scope and frame-scope for each view
      for (const label of labels) {
        guideState.linksByImage[label] = selId;
        guideState.linksByScope[label] = selId;

        // Also bind any frame-scoped IDs
        const binding = window.resolveGuideModelBindingForView?.(label);
        if (binding?.frameScopeId) {
          guideState.linksByScope[binding.frameScopeId] = selId;
        }
      }

      meta.guideModelLinkState = guideState;
      pm.setProjectMetadata(meta);
      window.dispatchEvent(new Event('openpaint:guide-binding-changed'));

      // Verify
      const verifications = {};
      for (const label of labels) {
        const b = window.resolveGuideModelBindingForView?.(label);
        verifications[label] = {
          scopeType: b?.scopeType,
          code: b?.selection?.code,
        };
      }
      return verifications;
    }, { labels, guideCode });

    console.log('  Binding verification:');
    for (const [label, info] of Object.entries(bindResult)) {
      console.log(`    ${label}: scope=${info.scopeType} code=${info.code || 'none'}`);
    }

    // -----------------------------------------------------------------------
    // Step 3: Enable split mode and wait for guide to load
    // -----------------------------------------------------------------------
    console.log('\n=== Step 3: Enable split mode ===');
    await page.evaluate(() => window.setGuideSplitEnabled(true));
    await page.waitForTimeout(4000); // Give generous time for guide to load

    const splitState = await page.evaluate(() => {
      const ws = window.getGuideCompareWorkspaceState?.() || {};
      return {
        left: ws.leftViewId,
        right: ws.rightViewId,
        rightKind: ws.rightSourceKind,
        active: document.getElementById('main-canvas-wrapper')?.classList.contains('guide-split-active'),
      };
    });
    console.log(`  Split: left=${splitState.left} right=${splitState.right} kind=${splitState.rightKind}`);

    await page.screenshot({ path: '/home/leigh/projects/OpenPaint/output/tag-leak-v2-01-split.png' });

    // -----------------------------------------------------------------------
    // Step 4: Test tag leak — switch views and monitor compare canvas
    // -----------------------------------------------------------------------
    console.log('\n=== Step 4: View switching + compare canvas monitoring ===');

    for (let round = 0; round < 2; round++) {
      for (const label of labels) {
        await page.evaluate((lbl) => window.app.projectManager.switchView(lbl), label);
        await page.waitForTimeout(1500);

        const state = await page.evaluate((lbl) => {
          const ws = window.getGuideCompareWorkspaceState?.() || {};
          const mainCanvas = window.app?.canvasManager?.fabricCanvas;
          const compareManager = window.app?.compareCanvasManager;

          // Count objects on main canvas
          const mainObjects = mainCanvas?.getObjects?.()?.length || 0;

          // Count objects on compare canvas
          const compareObjects = compareManager?.fabricCanvas?.getObjects?.()?.length ?? -1;

          // Get the compare canvas's active temp scope
          const splitState = window.getGuideSplitStateForView?.(lbl);

          return {
            currentView: window.app?.projectManager?.currentViewId,
            wsLeft: ws.leftViewId,
            wsRight: ws.rightViewId,
            mainObjects,
            compareObjects,
            splitReady: splitState?.rightReady ?? 'unknown',
          };
        }, label);

        console.log(`  ${label}: left=${state.wsLeft} right=${state.wsRight} main=${state.mainObjects} compare=${state.compareObjects} ready=${state.splitReady}`);

        // Check for stale left view
        if (state.wsLeft !== label) {
          console.log(`    ⚠️ LEFT VIEW MISMATCH: expected ${label}, got ${state.wsLeft}`);
        }
      }
      if (round === 0) {
        console.log('  --- Round 2 ---');
      }
    }

    // -----------------------------------------------------------------------
    // Step 5: Fast switching timing test
    // -----------------------------------------------------------------------
    console.log('\n=== Step 5: Fast switching timing ===');

    // Switch rapidly and check timing
    for (const label of labels) {
      const t0 = Date.now();
      await page.evaluate((lbl) => window.app.projectManager.switchView(lbl), label);

      // Poll for workspace state update
      let wsSettled = false;
      let wsTime = 0;
      for (let i = 0; i < 30; i++) {
        await page.waitForTimeout(100);
        const ws = await page.evaluate(() => window.getGuideCompareWorkspaceState?.()?.leftViewId);
        if (ws === label) {
          wsSettled = true;
          wsTime = Date.now() - t0;
          break;
        }
      }

      // Poll for right view to load/update
      let rightSettled = false;
      let rightTime = 0;
      const rightTarget = await page.evaluate(() => window.getGuideCompareWorkspaceState?.()?.rightViewId);
      if (rightTarget) {
        rightSettled = true;
        rightTime = Date.now() - t0;
      } else {
        for (let i = 0; i < 30; i++) {
          await page.waitForTimeout(100);
          const rv = await page.evaluate(() => window.getGuideCompareWorkspaceState?.()?.rightViewId);
          if (rv) {
            rightSettled = true;
            rightTime = Date.now() - t0;
            break;
          }
        }
      }

      console.log(`  ${label}: ws.left settled in ${wsSettled ? wsTime + 'ms' : 'TIMEOUT'}, right loaded in ${rightSettled ? rightTime + 'ms' : 'TIMEOUT'}`);
    }

    // -----------------------------------------------------------------------
    // Step 6: Capture tab interaction (frame binding)
    // -----------------------------------------------------------------------
    console.log('\n=== Step 6: Tab switching behavior ===');

    // Find capture tab buttons
    const tabButtons = await page.evaluate(() => {
      const buttons = document.querySelectorAll('.capture-tab-btn, [data-tab-id], .tab-btn');
      return Array.from(buttons).map(b => ({
        id: b.id || b.getAttribute('data-tab-id') || '',
        text: b.textContent?.trim()?.slice(0, 20),
        tag: b.tagName,
      }));
    });
    console.log(`  Tab buttons: ${JSON.stringify(tabButtons.slice(0, 5))}`);

    // -----------------------------------------------------------------------
    // Step 7: Check for tag objects on compare canvas that shouldn't be there
    // -----------------------------------------------------------------------
    console.log('\n=== Step 7: Compare canvas object audit ===');

    // Switch to view-a and check compare canvas
    await page.evaluate((lbl) => window.app.projectManager.switchView(lbl), labels[0]);
    await page.waitForTimeout(2000);

    const compareAudit = await page.evaluate(() => {
      const compareManager = window.app?.compareCanvasManager;
      if (!compareManager?.fabricCanvas) return { available: false };

      const objects = compareManager.fabricCanvas.getObjects();
      const summary = {
        available: true,
        total: objects.length,
        tags: 0,
        lines: 0,
        images: 0,
        other: 0,
        tagLabels: [],
        objectImageLabels: [],
      };

      objects.forEach(obj => {
        if (obj.isTag) {
          summary.tags++;
          summary.tagLabels.push(obj.strokeLabel || obj.text || 'unknown');
        } else if (obj.type === 'line') {
          summary.lines++;
        } else if (obj.type === 'image') {
          summary.images++;
        } else {
          summary.other++;
        }
        if (obj.imageLabel) {
          if (!summary.objectImageLabels.includes(obj.imageLabel)) {
            summary.objectImageLabels.push(obj.imageLabel);
          }
        }
      });

      return summary;
    });
    console.log(`  Compare canvas audit: ${JSON.stringify(compareAudit, null, 2)}`);

    await page.screenshot({ path: '/home/leigh/projects/OpenPaint/output/tag-leak-v2-final.png' });

    // -----------------------------------------------------------------------
    // Summary
    // -----------------------------------------------------------------------
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log(`Page errors: ${pageErrors.length}`);
    pageErrors.forEach((e, i) => console.log(`  ${i + 1}. ${e.message}`));
    console.log(`Guide-related logs: ${guideLogs.length}`);
    guideLogs.slice(0, 10).forEach((l, i) => console.log(`  ${i + 1}. ${l}`));

  } catch (error) {
    console.error('\n!!! SCRIPT ERROR:', error.message);
    await page.screenshot({ path: '/home/leigh/projects/OpenPaint/output/tag-leak-v2-error.png' }).catch(() => {});
  } finally {
    await browser.close();
    console.log('\nBrowser closed.');
  }
})();
