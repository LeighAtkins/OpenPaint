/**
 * Debug tag overlap — instrument the actual clearAllTags and createTag flow
 * to see what happens during view switches in split mode.
 */
import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:5173';
const TIMEOUT = 30_000;

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

(async () => {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  page.on('pageerror', err => console.log(`  [PAGE ERROR] ${err.message}`));
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[TAG-DEBUG]')) {
      console.log(`  ${text}`);
    }
  });

  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: TIMEOUT });
    await waitForApp(page);
    console.log('App loaded.');

    const views = ['front', 'side', 'back'];
    for (let i = 0; i < 3; i++) {
      await addTestImage(page, views[i], ['#dde0ff', '#ffdde0', '#ddffd0'][i]);
    }

    // Add strokes
    for (let i = 0; i < views.length; i++) {
      await page.evaluate(v => window.app.projectManager.switchView(v), views[i]);
      await page.waitForTimeout(600);
      for (let j = 0; j < 2; j++) {
        await page.evaluate(({ viewId, idx }) => {
          const canvas = window.app.canvasManager.fabricCanvas;
          const scope = window.app.metadataManager?.normalizeImageLabel?.(viewId) || viewId;
          const label = String.fromCharCode(65 + idx) + '1';
          const y = 120 + idx * 100;
          const line = new fabric.Line([100, y, 500, y], {
            stroke: '#ff0000', strokeWidth: 3, strokeLabel: label,
            strokeMetadata: { type: 'line', imageLabel: scope, strokeLabel: label },
          });
          canvas.add(line);
          window.app.metadataManager.vectorStrokesByImage[scope] = window.app.metadataManager.vectorStrokesByImage[scope] || {};
          window.app.metadataManager.vectorStrokesByImage[scope][label] = { type: 'line', x1: 100, y1: y, x2: 500, y2: y };
          window.app.metadataManager.strokeLabelVisibility[scope] = window.app.metadataManager.strokeLabelVisibility[scope] || {};
          window.app.metadataManager.strokeLabelVisibility[scope][label] = true;
          window.app.tagManager?.createTag(label, scope, { type: 'line', x1: 100, y1: y, x2: 500, y2: y });
          canvas.requestRenderAll();
        }, { viewId: views[i], idx: j });
        await page.waitForTimeout(100);
      }
      await page.evaluate(() => window.app.projectManager.saveCurrentViewState());
      await page.waitForTimeout(200);
    }
    console.log('Views created with strokes.\n');

    // Instrument tagManager to log all createTag/clearAllTags/removeTag calls
    await page.evaluate(() => {
      const tm = window.app.tagManager;
      const origClear = tm.clearAllTags.bind(tm);
      tm.clearAllTags = () => {
        const canvas = tm.canvas;
        const canvasTagCount = canvas ? canvas.getObjects().filter(o => o.isTag).length : -1;
        const canvasConnCount = canvas ? canvas.getObjects().filter(o => o.isConnectorLine).length : -1;
        console.log(`[TAG-DEBUG] clearAllTags() mapSize=${tm.tagObjects.size} canvasTags=${canvasTagCount} canvasConns=${canvasConnCount}`);
        const result = origClear();
        const afterTagCount = canvas ? canvas.getObjects().filter(o => o.isTag).length : -1;
        const afterConnCount = canvas ? canvas.getObjects().filter(o => o.isConnectorLine).length : -1;
        console.log(`[TAG-DEBUG]   after clear: canvasTags=${afterTagCount} canvasConns=${afterConnCount}`);
        return result;
      };

      const origCreate = tm.createTag.bind(tm);
      tm.createTag = (strokeLabel, imageLabel, strokeObj) => {
        const currentView = window.app.projectManager.currentViewId;
        console.log(`[TAG-DEBUG] createTag(${strokeLabel}, ${imageLabel}) currentView=${currentView}`);
        return origCreate(strokeLabel, imageLabel, strokeObj);
      };

      const origRecreate = tm.recreateTagsForImage.bind(tm);
      tm.recreateTagsForImage = (imageLabel) => {
        const currentView = window.app.projectManager.currentViewId;
        console.log(`[TAG-DEBUG] recreateTagsForImage(${imageLabel}) currentView=${currentView}`);
        return origRecreate(imageLabel);
      };

      // Also instrument syncCaptureTabCanvasVisibility
      const origSync = window.syncCaptureTabCanvasVisibility;
      if (origSync) {
        window.syncCaptureTabCanvasVisibility = (label) => {
          const canvas = tm.canvas;
          const beforeTags = canvas ? canvas.getObjects().filter(o => o.isTag).length : -1;
          console.log(`[TAG-DEBUG] syncCaptureTabCanvasVisibility(${label}) beforeTags=${beforeTags}`);
          const result = origSync(label);
          const afterTags = canvas ? canvas.getObjects().filter(o => o.isTag).length : -1;
          if (afterTags !== beforeTags) {
            console.log(`[TAG-DEBUG]   ⚠️ tag count changed: ${beforeTags} → ${afterTags}`);
          }
          return result;
        };
      }
    });

    // Enable split mode
    console.log('=== Enabling split mode ===');
    const guideCode = 'CS1B-RA-HB';
    await page.evaluate(({ views, guideCode }) => {
      const pm = window.app.projectManager;
      const selId = `${guideCode}::front`;
      pm.setProjectMetadata({
        measurementGuideModelSelections: [{ id: selId, code: guideCode, variant: 'front' }],
        measurementGuideModelLinksByImage: Object.fromEntries(views.map(v => [v, selId])),
        measurementGuideModelLinksByScope: Object.fromEntries(views.map(v => [v, selId])),
      });
      window.dispatchEvent(new Event('openpaint:guide-binding-changed'));
    }, { views, guideCode });
    await page.evaluate(() => window.setGuideSplitEnabled?.(true));
    await page.waitForTimeout(3000);

    // Switch views with instrumentation
    console.log('\n=== SWITCHING with instrumented tag tracking ===');
    for (let round = 0; round < 3; round++) {
      console.log(`\n--- Round ${round + 1} ---`);
      for (const view of views) {
        console.log(`\n  >>> switchView(${view})`);
        await page.evaluate(v => window.app.projectManager.switchView(v), view);
        await page.waitForTimeout(1200);

        const state = await page.evaluate(() => {
          const canvas = window.app.canvasManager.fabricCanvas;
          const view = window.app.projectManager.currentViewId;
          const objects = canvas.getObjects();
          const tags = objects.filter(o => o.isTag);
          const conns = objects.filter(o => o.isConnectorLine);
          const tracked = [...(window.app.tagManager?.tagObjects?.values() || [])];
          const orphanTags = tags.filter(t => !tracked.includes(t));
          const orphanConns = conns.filter(c => !tracked.some(t => t?.connectorLine === c));
          return {
            view,
            tags: tags.length,
            conns: conns.length,
            tracked: tracked.length,
            orphanTags: orphanTags.length,
            orphanConns: orphanConns.length,
            tagLabels: tags.map(t => `${t.strokeLabel}@${t.imageLabel}`),
            orphanTagLabels: orphanTags.map(t => `${t.strokeLabel}@${t.imageLabel}`),
            orphanConnLabels: orphanConns.map(c => `${c.strokeLabel}@${c.imageLabel}`),
          };
        });

        console.log(`  Result: ${state.tags}t/${state.conns}c tracked=${state.tracked} orphanT=${state.orphanTags} orphanC=${state.orphanConns}`);
        if (state.orphanTags > 0 || state.orphanConns > 0) {
          console.log(`  ⚠️ ORPHANS: tags=[${state.orphanTagLabels.join(',')}] conns=[${state.orphanConnLabels.join(',')}]`);
        }
      }
    }

    // Rapid switching
    console.log('\n=== RAPID SWITCHING ===');
    for (let i = 0; i < 9; i++) {
      const v = views[i % 3];
      await page.evaluate(v => window.app.projectManager.switchView(v), v);
      await page.waitForTimeout(100);
    }
    await page.waitForTimeout(2000);

    const finalState = await page.evaluate(() => {
      const canvas = window.app.canvasManager.fabricCanvas;
      const objects = canvas.getObjects();
      const tags = objects.filter(o => o.isTag);
      const conns = objects.filter(o => o.isConnectorLine);
      const tracked = [...(window.app.tagManager?.tagObjects?.values() || [])];
      return {
        view: window.app.projectManager.currentViewId,
        tags: tags.length,
        conns: conns.length,
        tracked: tracked.length,
        orphanTags: tags.filter(t => !tracked.includes(t)).length,
        orphanConns: conns.filter(c => !tracked.some(t => t?.connectorLine === c)).length,
        allTagLabels: tags.map(t => `${t.strokeLabel}@${t.imageLabel}`),
      };
    });
    console.log(`\nFinal (${finalState.view}): ${finalState.tags}t/${finalState.conns}c tracked=${finalState.tracked} orphanT=${finalState.orphanTags} orphanC=${finalState.orphanConns}`);
    console.log(`  Tags: ${finalState.allTagLabels.join(', ')}`);

    await page.screenshot({ path: '/home/leigh/projects/OpenPaint/output/tag-debug-instrumented.png' });
    console.log('\nDone.');
  } catch (error) {
    console.error('\n!!! ERROR:', error.message);
    console.error(error.stack?.split('\n').slice(0, 3).join('\n'));
  } finally {
    await browser.close();
  }
})();
