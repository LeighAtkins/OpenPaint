/**
 * Test the live site in split mode — observe tag leaking and positioning issues
 * during view switches.
 */
import { chromium } from 'playwright';

const BASE_URL = 'https://sofapaint.vercel.app';
const TIMEOUT = 60_000;
const OUTPUT_DIR = '/home/leigh/projects/OpenPaint/output';

async function waitForApp(page) {
  await page.waitForFunction(
    () => !!(window.app?.canvasManager?.fabricCanvas && window.app?.toolManager?.activeTool && window.app?.projectManager),
    { timeout: TIMEOUT },
  );
  await page.waitForTimeout(2000);
}

(async () => {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  const errors = [];
  page.on('pageerror', err => {
    errors.push(err.message);
    console.log(`  [PAGE ERROR] ${err.message}`);
  });

  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: TIMEOUT });
    await waitForApp(page);
    console.log('App loaded.');

    // Get initial state
    const info = await page.evaluate(() => {
      const pm = window.app.projectManager;
      return {
        views: Object.keys(pm.views),
        current: pm.currentViewId,
        splitEnabled: typeof window.isGuideSplitEnabled === 'function' ? window.isGuideSplitEnabled() : false,
        hasGuideBinding: !!pm.getProjectMetadata?.()?.measurementGuideModelLinksByImage,
      };
    });
    console.log(`Views: ${info.views.join(', ')}`);
    console.log(`Current: ${info.current}, Split: ${info.splitEnabled}`);

    // Create test views with strokes if needed
    if (info.views.length < 2) {
      console.log('\nCreating test project...');
      for (let i = 0; i < 3; i++) {
        const label = ['front', 'side', 'back'][i];
        const color = ['#dde0ff', '#ffdde0', '#ddffd0'][i];
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

      // Add strokes to each view
      const views = ['front', 'side', 'back'];
      for (let i = 0; i < views.length; i++) {
        await page.evaluate(v => window.app.projectManager.switchView(v), views[i]);
        await page.waitForTimeout(600);
        for (let j = 0; j < 3; j++) {
          await page.evaluate(({ viewId, idx }) => {
            const canvas = window.app.canvasManager.fabricCanvas;
            const scope = window.app.metadataManager?.normalizeImageLabel?.(viewId) || viewId;
            const label = String.fromCharCode(65 + idx) + '1';
            const y = 120 + idx * 100;
            const line = new fabric.Line([100, y, 500, y], {
              stroke: ['#ff0000', '#0000ff', '#00aa00'][idx],
              strokeWidth: 3, strokeLabel: label,
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
      console.log('Test project created with 3 views × 3 strokes.\n');
    }

    // Get views list
    const views = await page.evaluate(() => Object.keys(window.app.projectManager.views));

    // Enable split mode
    console.log('Enabling split mode...');
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
    await page.screenshot({ path: `${OUTPUT_DIR}/split-initial.png` });

    // Switch views and capture screenshots + state after each
    console.log('\n=== VIEW SWITCHING TEST ===');
    const testViews = views.slice(0, Math.min(views.length, 4));

    for (let round = 0; round < 3; round++) {
      console.log(`\n--- Round ${round + 1} ---`);
      for (const view of testViews) {
        await page.evaluate(v => window.app.projectManager.switchView(v), view);
        await page.waitForTimeout(1500);

        // Capture canvas state
        const state = await page.evaluate(() => {
          const canvas = window.app.canvasManager.fabricCanvas;
          const pm = window.app.projectManager;
          const viewId = pm.currentViewId;
          const objects = canvas.getObjects();
          const vpt = canvas.viewportTransform;
          const bgImg = canvas.backgroundImage;

          const tags = objects.filter(o => o.isTag);
          const conns = objects.filter(o => o.isConnectorLine);
          const lines = objects.filter(o => o.type === 'line' && !o.isConnectorLine && !o.isTag);

          // Check for tags from wrong view
          const scope = window.app.metadataManager?.normalizeImageLabel?.(viewId) || viewId;
          const wrongTags = tags.filter(t => {
            const il = t.imageLabel || '';
            if (il.startsWith('__guide__')) return false;
            return il && !il.startsWith(viewId);
          });

          // Check tracked vs canvas
          const tracked = window.app.tagManager?.tagObjects ? [...window.app.tagManager.tagObjects.values()] : [];
          const orphanTags = tags.filter(t => !tracked.includes(t));
          const orphanConns = conns.filter(c => !tracked.some(t => t?.connectorLine === c));

          return {
            viewId,
            scope,
            lineCount: lines.length,
            tagCount: tags.length,
            connCount: conns.length,
            trackedCount: tracked.length,
            orphanTags: orphanTags.length,
            orphanConns: orphanConns.length,
            wrongViewTags: wrongTags.length,
            wrongTagLabels: wrongTags.map(t => `${t.strokeLabel}@${t.imageLabel}`),
            orphanTagLabels: orphanTags.map(t => `${t.strokeLabel}@${t.imageLabel}`),
            viewportTransform: vpt ? vpt.map(v => Math.round(v * 100) / 100) : null,
            bgImageSrc: bgImg?.src ? bgImg.src.substring(0, 50) + '...' : 'none',
            bgImageLeft: bgImg?.left,
            bgImageTop: bgImg?.top,
            canvasWidth: canvas.width,
            canvasHeight: canvas.height,
          };
        });

        const issues = [];
        if (state.wrongViewTags > 0) issues.push(`${state.wrongViewTags} wrong-view tags: ${state.wrongTagLabels.join(',')}`);
        if (state.orphanTags > 0) issues.push(`${state.orphanTags} orphan tags: ${state.orphanTagLabels.join(',')}`);
        if (state.orphanConns > 0) issues.push(`${state.orphanConns} orphan connectors`);

        console.log(`  ${view}: ${state.lineCount}L ${state.tagCount}T ${state.connCount}C tracked=${state.trackedCount} vpt=[${state.viewportTransform?.join(',')}]`);
        if (issues.length > 0) {
          issues.forEach(i => console.log(`    ⚠️ ${i}`));
        }

        await page.screenshot({ path: `${OUTPUT_DIR}/split-r${round+1}-${view}.png` });
      }
    }

    // Rapid switching
    console.log('\n=== RAPID SWITCHING ===');
    for (let i = 0; i < 12; i++) {
      const v = testViews[i % testViews.length];
      await page.evaluate(v => window.app.projectManager.switchView(v), v);
      await page.waitForTimeout(100 + Math.random() * 150);
    }
    await page.waitForTimeout(3000);

    const finalState = await page.evaluate(() => {
      const canvas = window.app.canvasManager.fabricCanvas;
      const objects = canvas.getObjects();
      const tags = objects.filter(o => o.isTag);
      const conns = objects.filter(o => o.isConnectorLine);
      const tracked = window.app.tagManager?.tagObjects ? [...window.app.tagManager.tagObjects.values()] : [];
      return {
        view: window.app.projectManager.currentViewId,
        tags: tags.length,
        conns: conns.length,
        tracked: tracked.length,
        orphanTags: tags.filter(t => !tracked.includes(t)).length,
        orphanConns: conns.filter(c => !tracked.some(t => t?.connectorLine === c)).length,
        tagLabels: tags.map(t => `${t.strokeLabel}@${t.imageLabel}`),
      };
    });
    console.log(`Final (${finalState.view}): ${finalState.tags}T ${finalState.conns}C tracked=${finalState.tracked} orphanT=${finalState.orphanTags} orphanC=${finalState.orphanConns}`);
    if (finalState.orphanTags > 0 || finalState.orphanConns > 0) {
      console.log(`  Tags: ${finalState.tagLabels.join(', ')}`);
    }

    await page.screenshot({ path: `${OUTPUT_DIR}/split-final.png` });

    console.log(`\nPage errors: ${errors.length}`);
    errors.slice(0, 5).forEach(e => console.log(`  ${e}`));

  } catch (error) {
    console.error('\n!!! ERROR:', error.message);
    console.error(error.stack?.split('\n').slice(0, 3).join('\n'));
    await page.screenshot({ path: `${OUTPUT_DIR}/split-error.png` }).catch(() => {});
  } finally {
    await browser.close();
    console.log('Done.');
  }
})();
