/**
 * Reproduce the tag leak: stale measurement seeds when switching views
 * with the same guide bound.
 *
 * The bug: ensureGuideSplitDefaultRightView short-circuits when the same
 * guide is already loaded, skipping seedGuideSplitMeasurementsFromLeft.
 * Tags on the right pane show measurement values from the PREVIOUS left view.
 */
import { chromium } from 'playwright';

const BASE_URL = 'https://sofapaint.vercel.app';
const TIMEOUT = 60_000;

async function waitForApp(page) {
  await page.waitForFunction(
    () => !!(window.app?.canvasManager?.fabricCanvas && window.app?.toolManager?.activeTool && window.app?.projectManager),
    { timeout: TIMEOUT },
  );
  await page.waitForTimeout(1000);
}

async function addTestImage(page, label, color) {
  await page.evaluate(({ lbl, color }) => {
    return new Promise((resolve, reject) => {
      const c = document.createElement('canvas');
      c.width = 800; c.height = 600;
      const ctx = c.getContext('2d');
      ctx.fillStyle = color; ctx.fillRect(0, 0, 800, 600);
      ctx.fillStyle = '#333'; ctx.font = '48px sans-serif';
      ctx.fillText(lbl, 50, 80);
      window.app.projectManager.addImage(lbl, c.toDataURL('image/png'), { refreshBackground: true }).then(resolve).catch(reject);
    });
  }, { lbl: label, color });
  await page.waitForTimeout(500);
}

const pageErrors = [];

(async () => {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
    console.log(`  [PAGE ERROR] ${error.message}`);
  });

  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: TIMEOUT });
    await waitForApp(page);

    // Create 3 images
    const labels = ['view-alpha', 'view-beta', 'view-gamma'];
    for (let i = 0; i < 3; i++) {
      await addTestImage(page, labels[i], ['#dde0ff', '#ffdde0', '#ddffd0'][i]);
    }

    // Bind the SAME guide to all three views
    const guideCode = 'CS1B-RA-HB';
    console.log(`\n=== Bind same guide (${guideCode}) to all views ===`);

    await page.evaluate(({ labels, guideCode }) => {
      const pm = window.app.projectManager;
      const selId = `${guideCode}::front`;
      const selections = [{ id: selId, code: guideCode, variant: 'front' }];
      const linksByScope = {};
      const linksByImage = {};
      for (const label of labels) {
        linksByImage[label] = selId;
        linksByScope[label] = selId;
        const b = window.resolveGuideModelBindingForView?.(label);
        if (b?.frameScopeId) linksByScope[b.frameScopeId] = selId;
      }
      pm.setProjectMetadata({
        measurementGuideModelSelections: selections,
        measurementGuideModelLinksByImage: linksByImage,
        measurementGuideModelLinksByScope: linksByScope,
      });
      window.dispatchEvent(new Event('openpaint:guide-binding-changed'));
    }, { labels, guideCode });

    // Switch to view-alpha and enable split
    await page.evaluate(l => window.app.projectManager.switchView(l), labels[0]);
    await page.waitForTimeout(500);
    await page.evaluate(() => window.setGuideSplitEnabled(true));
    await page.waitForTimeout(5000);

    console.log(`\n=== Guide loaded, now add measurements to views ===`);

    // Set distinct measurement values on each view via metadataManager
    await page.evaluate(({ labels }) => {
      const mm = window.app.metadataManager;
      // Get the guide's stroke labels from the compare canvas
      const cm = window.app.compareCanvasManager;
      const guideObjects = cm?.fabricCanvas?.getObjects?.() || [];
      const tagLabels = guideObjects.filter(o => o.isTag).map(o => o.strokeLabel).filter(Boolean);

      console.log('[Test] Tag labels on guide:', tagLabels);

      // Set different measurement values per view
      labels.forEach((label, viewIdx) => {
        mm.strokeMeasurements[label] = mm.strokeMeasurements[label] || {};
        tagLabels.forEach((tag, tagIdx) => {
          // Each view gets unique values: view-alpha gets 100+, view-beta gets 200+, view-gamma gets 300+
          mm.strokeMeasurements[label][tag] = `${(viewIdx + 1) * 100 + tagIdx}`;
        });
      });
    }, { labels });

    console.log(`\n=== Test: Switch views and check seeded measurements on right pane ===`);

    // Get the temp scope ID used by the compare canvas
    const tempScopeId = await page.evaluate(() => {
      const ws = window.getGuideCompareWorkspaceState?.() || {};
      return ws.rightViewId || '';
    });
    console.log(`  Temp scope ID for right pane: ${tempScopeId}`);

    // For each view: switch to it, wait, then check what measurements are seeded on the right
    for (let round = 0; round < 2; round++) {
      console.log(`\n--- Round ${round + 1} ---`);
      for (let i = 0; i < labels.length; i++) {
        const label = labels[i];
        await page.evaluate(l => window.app.projectManager.switchView(l), label);
        await page.waitForTimeout(2500); // Generous wait

        const result = await page.evaluate(({ label, tempScopeId, viewIdx }) => {
          const mm = window.app.metadataManager;
          const ws = window.getGuideCompareWorkspaceState?.() || {};

          // What measurements does the LEFT view have?
          const leftMeasurements = mm.strokeMeasurements?.[label] || {};

          // What measurements are seeded on the RIGHT (temp scope)?
          // Try both the base temp scope and any tab-scoped variant
          const rightScopes = Object.keys(mm.strokeMeasurements || {}).filter(k => k.startsWith('__guide__'));
          const rightMeasurements = {};
          rightScopes.forEach(scope => {
            Object.assign(rightMeasurements, mm.strokeMeasurements[scope] || {});
          });

          // Get tag objects from compare canvas and their displayed values
          const cm = window.app.compareCanvasManager;
          const tagObjects = (cm?.fabricCanvas?.getObjects?.() || []).filter(o => o.isTag);
          const tagDisplayValues = {};
          tagObjects.forEach(t => {
            if (t.strokeLabel) {
              tagDisplayValues[t.strokeLabel] = t.text || t._text?.join?.('') || '';
            }
          });

          const leftKeys = Object.keys(leftMeasurements).sort().slice(0, 4);
          const rightKeys = Object.keys(rightMeasurements).sort().slice(0, 4);

          // Check: do the right measurements match the LEFT view's values?
          let matchesLeft = true;
          let staleFrom = '';
          leftKeys.forEach(key => {
            if (rightMeasurements[key] !== undefined && rightMeasurements[key] !== leftMeasurements[key]) {
              matchesLeft = false;
              // Figure out which view the stale value came from
              const staleVal = parseInt(rightMeasurements[key]);
              const staleViewIdx = Math.floor(staleVal / 100) - 1;
              if (staleViewIdx >= 0 && staleViewIdx < 3) {
                staleFrom = `view-${['alpha', 'beta', 'gamma'][staleViewIdx]}`;
              }
            }
          });

          return {
            currentView: ws.leftViewId,
            rightViewId: ws.rightViewId,
            leftSample: leftKeys.map(k => `${k}=${leftMeasurements[k]}`).join(', '),
            rightSample: rightKeys.map(k => `${k}=${rightMeasurements[k]}`).join(', '),
            rightScopes,
            matchesLeft,
            staleFrom: staleFrom || null,
            tagCount: tagObjects.length,
            tagDisplaySample: Object.entries(tagDisplayValues).slice(0, 3).map(([k, v]) => `${k}="${v}"`).join(', '),
          };
        }, { label, tempScopeId, viewIdx: i });

        console.log(`  ${label}:`);
        console.log(`    left measurements:  ${result.leftSample}`);
        console.log(`    right measurements: ${result.rightSample}`);
        console.log(`    right scopes: [${result.rightScopes.join(', ')}]`);
        console.log(`    tag display sample: ${result.tagDisplaySample}`);
        if (!result.matchesLeft) {
          console.log(`    ⚠️ STALE SEED: right has values from ${result.staleFrom}, not from ${label}`);
        } else if (result.rightSample) {
          console.log(`    ✓ measurements match left view`);
        } else {
          console.log(`    ⓘ no measurements seeded on right`);
        }
      }
    }

    // -----------------------------------------------------------------------
    // Now test rapid switching — this is where stale seeds are most likely
    // -----------------------------------------------------------------------
    console.log(`\n=== Rapid switching test ===`);

    // Switch rapidly: alpha → beta → gamma → alpha
    for (const label of [...labels, labels[0]]) {
      await page.evaluate(l => window.app.projectManager.switchView(l), label);
      await page.waitForTimeout(300); // Fast but not instant
    }

    // Wait for everything to settle
    await page.waitForTimeout(4000);

    // Check final state
    const finalLabel = labels[0];
    const finalResult = await page.evaluate(({ label }) => {
      const mm = window.app.metadataManager;
      const ws = window.getGuideCompareWorkspaceState?.() || {};

      const leftMeasurements = mm.strokeMeasurements?.[label] || {};
      const rightScopes = Object.keys(mm.strokeMeasurements || {}).filter(k => k.startsWith('__guide__'));
      const rightMeasurements = {};
      rightScopes.forEach(scope => {
        Object.assign(rightMeasurements, mm.strokeMeasurements[scope] || {});
      });

      const leftKeys = Object.keys(leftMeasurements).sort().slice(0, 4);
      let staleCount = 0;
      let matchCount = 0;
      leftKeys.forEach(key => {
        if (rightMeasurements[key] !== undefined) {
          if (rightMeasurements[key] === leftMeasurements[key]) matchCount++;
          else staleCount++;
        }
      });

      return {
        currentView: ws.leftViewId,
        leftSample: leftKeys.map(k => `${k}=${leftMeasurements[k]}`).join(', '),
        rightSample: leftKeys.map(k => `${k}=${rightMeasurements[k] ?? 'MISSING'}`).join(', '),
        staleCount,
        matchCount,
        totalChecked: leftKeys.length,
      };
    }, { label: finalLabel });

    console.log(`  After rapid switch, settled on ${finalLabel}:`);
    console.log(`    left:  ${finalResult.leftSample}`);
    console.log(`    right: ${finalResult.rightSample}`);
    console.log(`    ${finalResult.matchCount}/${finalResult.totalChecked} match, ${finalResult.staleCount} stale`);
    if (finalResult.staleCount > 0) {
      console.log(`    ⚠️ STALE SEED CONFIRMED after rapid switching`);
    }

    // -----------------------------------------------------------------------
    // Test the _ensureRightViewInFlight race
    // -----------------------------------------------------------------------
    console.log(`\n=== _ensureRightViewInFlight race test ===`);

    // Switch view while ensureRightViewInFlight might be true
    // Force a slow guide load by switching to a different guide, then back
    await page.evaluate(({ labels }) => {
      // Fire two switches in quick succession
      window.app.projectManager.switchView(labels[1]); // beta (200-series)
      // The first switch fires ensureGuideSplitDefaultRightView
      // Before it finishes, switch again
      setTimeout(() => {
        window.app.projectManager.switchView(labels[2]); // gamma (300-series)
      }, 50);
    }, { labels });

    await page.waitForTimeout(5000);

    const raceResult = await page.evaluate(({ labels }) => {
      const mm = window.app.metadataManager;
      const ws = window.getGuideCompareWorkspaceState?.() || {};
      const currentView = ws.leftViewId || '';

      // What's the expected measurement prefix for the current view?
      const viewIdx = labels.indexOf(currentView);
      const expectedPrefix = viewIdx >= 0 ? `${(viewIdx + 1) * 100}` : '???';

      const leftMeasurements = mm.strokeMeasurements?.[currentView] || {};
      const rightScopes = Object.keys(mm.strokeMeasurements || {}).filter(k => k.startsWith('__guide__'));
      const rightMeasurements = {};
      rightScopes.forEach(scope => {
        Object.assign(rightMeasurements, mm.strokeMeasurements[scope] || {});
      });

      const leftKeys = Object.keys(leftMeasurements).sort().slice(0, 3);
      return {
        currentView,
        expectedPrefix,
        leftSample: leftKeys.map(k => `${k}=${leftMeasurements[k]}`).join(', '),
        rightSample: leftKeys.map(k => `${k}=${rightMeasurements[k] ?? 'MISSING'}`).join(', '),
      };
    }, { labels });

    console.log(`  Settled on: ${raceResult.currentView} (expected prefix: ${raceResult.expectedPrefix}xx)`);
    console.log(`  left:  ${raceResult.leftSample}`);
    console.log(`  right: ${raceResult.rightSample}`);

    // Check if right values have the wrong prefix
    const rightVals = raceResult.rightSample.match(/=(\d+)/g)?.map(m => m.slice(1)) || [];
    const wrongPrefix = rightVals.filter(v => !v.startsWith(raceResult.expectedPrefix));
    if (wrongPrefix.length > 0) {
      console.log(`  ⚠️ RACE CONDITION: right has values ${wrongPrefix.join(', ')} but expected ${raceResult.expectedPrefix}xx`);
    } else if (rightVals.length > 0) {
      console.log(`  ✓ right values match current view`);
    } else {
      console.log(`  ⓘ no values seeded`);
    }

    // -----------------------------------------------------------------------
    // Summary
    // -----------------------------------------------------------------------
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log(`Page errors: ${pageErrors.length}`);
    pageErrors.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
    if (!pageErrors.length) console.log('  No crashes.');

  } catch (error) {
    console.error('\n!!! SCRIPT ERROR:', error.message);
    console.error(error.stack?.split('\n').slice(0, 3).join('\n'));
    await page.screenshot({ path: '/home/leigh/projects/OpenPaint/output/stale-seed-error.png' }).catch(() => {});
  } finally {
    await browser.close();
    console.log('\nDone.');
  }
})();
