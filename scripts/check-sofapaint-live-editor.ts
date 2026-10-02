import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { buildPlacementOverlayElements } from '../src/modules/measurement-assistant/overlay-elements';

const [statePath, output, testOrigin] = process.argv.slice(2);
if (!statePath || !output)
  throw new Error('Supply private-state.json and a new private output folder.');
const state = JSON.parse(await readFile(statePath, 'utf8'));
if (!Array.isArray(state.images) || state.images.length < 2)
  throw new Error('View-switch QA requires at least two photos.');
const url = new URL(state.editorUrl);
if (url.origin !== 'https://sofapaint.vercel.app') throw new Error('Unexpected editor origin.');
if (testOrigin && testOrigin !== 'http://127.0.0.1:5173')
  throw new Error('Only the configured local editor may override the origin.');
const editorUrl = testOrigin ? `${testOrigin}/${url.hash}` : state.editorUrl;
const parameters = new URLSearchParams(url.hash.slice(1));
const draftUrl = parameters.get('measurementDraft');
const token = parameters.get('key');
if (!draftUrl || !token) throw new Error('Missing draft capability.');
const draftOrigin = new URL(draftUrl).origin;
if (draftOrigin !== 'https://sofapaint-mcp.sofapaint-api.workers.dev')
  throw new Error('Unexpected draft service.');
const readDraftHash = async () => {
  const response = await fetch(draftUrl, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`Draft read failed: ${response.status}`);
  return createHash('sha256')
    .update(await response.text())
    .digest('hex');
};
await mkdir(output, { recursive: false });
const beforeHash = await readDraftHash();
const errors: string[] = [];
const results: unknown[] = [];
const redact = (value: string) => value.replace(/https?:\/\/[^\s"')]+/g, '[private URL]');
const browser = await chromium.launch({ headless: true });
try {
  for (const [name, width, height] of [
    ['desktop', 1440, 920],
    ['mobile', 390, 844],
  ] as const) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.route(`${draftOrigin}/projects/**`, async route => {
      if (!['GET', 'OPTIONS'].includes(route.request().method())) {
        errors.push('Attempted hosted draft mutation blocked.');
        await route.abort();
      } else await route.continue();
    });
    page.on('pageerror', error => errors.push(redact(error.message)));
    await page.goto(editorUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.waitForFunction(
      (count: number) => {
        const app = (window as any).app;
        return app?.measurementOverlayManager?.getStore().order.length === count;
      },
      state.images.length,
      { timeout: 90_000 }
    );
    const welcome = page.locator('#welcomeDismiss');
    if (await welcome.isVisible()) await welcome.click();
    for (const image of state.images) {
      const expected = buildPlacementOverlayElements(state.placement, image.id).map(element => ({
        label: element.displayLabel,
        endpoints: element.endpoints.map(endpoint => endpoint.point),
        curvePoints: element.curvePoints || [],
      }));
      await page.evaluate(async (viewId: string) => {
        const app = (window as any).app;
        await app.projectManager.switchView(viewId);
        await app.measurementOverlayManager.mountView(viewId);
      }, `mcp_${image.id}`);
      await page.waitForFunction(
        ({ viewId, labels }) => {
          const app = (window as any).app;
          const rows = document.querySelectorAll(
            '#strokeVisibilityControls [data-element-kind="measurements"].stroke-visibility-item'
          );
          return (
            Object.keys(app.metadataManager.vectorStrokesByImage[viewId] || {}).length === labels &&
            rows.length === labels
          );
        },
        { viewId: `mcp_${image.id}`, labels: expected.length }
      );
      const actual = await page.evaluate((viewId: string) => {
        const app = (window as any).app;
        const manager = app.measurementOverlayManager;
        const overlay = [...manager.getStore().byId.values()].find(
          (item: any) => item.viewId === viewId
        ) as any;
        const canvas = app.canvasManager.fabricCanvas;
        canvas.renderAll();
        return {
          geometry: [...overlay.elements.values()].map((element: any) => ({
            label: element.displayLabel,
            endpoints: element.endpoints.map((endpoint: any) => endpoint.point),
            curvePoints: element.curvePoints || [],
          })),
          tagTexts: canvas
            .getObjects()
            .filter((object: any) => object.isTag)
            .flatMap((object: any) =>
              object
                .getObjects()
                .filter((child: any) => ['text', 'i-text'].includes(child.type))
                .map((child: any) => child.text)
            ),
          imageWidth: canvas.backgroundImage?.width,
          imageHeight: canvas.backgroundImage?.height,
          hashCleared: !location.hash,
          overflow: document.documentElement.scrollWidth > innerWidth,
          currentViewId: app.projectManager.currentViewId,
          metadataLabels: Object.keys(app.metadataManager.vectorStrokesByImage[viewId] || {}),
          sidebarText: document.getElementById('strokeVisibilityControls')?.innerText,
        };
      }, `mcp_${image.id}`);
      await page.screenshot({ path: join(output, `${name}-${image.view}.png`) });
      if (JSON.stringify(actual.geometry) !== JSON.stringify(expected))
        throw new Error(`${name}/${image.view}: changed geometry`);
      if (
        JSON.stringify(actual.tagTexts.slice().sort()) !==
        JSON.stringify(expected.map(e => e.label).sort())
      )
        throw new Error(`${name}/${image.view}: missing or duplicate canvas labels`);
      if (
        !actual.hashCleared ||
        actual.imageWidth !== image.width ||
        actual.imageHeight !== image.height
      )
        throw new Error(`${name}/${image.view}: incorrect photo frame or capability not cleared`);
      if (actual.overflow) throw new Error(`${name}/${image.view}: horizontal overflow`);
      results.push({ viewport: name, view: image.view, ...actual });
    }
    // Edits are confined to this fresh browser context; do not save the hosted draft.
    const drag = await page.evaluate(() => {
      const app = (window as any).app;
      const canvas = app.canvasManager.fabricCanvas;
      const tag = canvas.getObjects().find((object: any) => object.isTag);
      const center = tag.getCenterPoint();
      const point = (window as any).fabric.util.transformPoint(center, canvas.viewportTransform);
      const rect = canvas.upperCanvasEl.getBoundingClientRect();
      return {
        x: rect.left + point.x,
        y: rect.top + point.y,
        key: tag.strokeLabel,
        viewId: app.projectManager.currentViewId,
        before: { left: tag.left, top: tag.top },
      };
    });
    await page.mouse.move(drag.x, drag.y);
    await page.mouse.down();
    await page.mouse.move(drag.x - 18, drag.y - 16, { steps: 8 });
    await page.mouse.up();
    const edit = await page.evaluate(async ({ key, viewId, before }) => {
      const app = (window as any).app;
      const manager = app.measurementOverlayManager;
      const canvas = app.canvasManager.fabricCanvas;
      const find = () =>
        canvas.getObjects().find((object: any) => object.isTag && object.strokeLabel === key);
      const moved = find();
      const after = { left: moved.left, top: moved.top };
      const other = [...manager.getStore().byId.values()].find(
        (item: any) => item.viewId !== viewId
      ) as any;
      await app.projectManager.switchView(other.viewId);
      await manager.mountView(other.viewId);
      await app.projectManager.switchView(viewId);
      await manager.mountView(viewId);
      const remounted = find();
      const viewSwitch = Math.hypot(remounted.left - after.left, remounted.top - after.top) < 0.1;
      const saved = manager.toJSON();
      await manager.fromJSON(saved);
      await manager.mountView(viewId);
      const restored = find();
      return {
        key,
        before,
        after,
        viewSwitch,
        restored: { left: restored.left, top: restored.top },
        moved: Math.hypot(after.left - before.left, after.top - before.top) > 5,
        roundTrip: Math.hypot(restored.left - after.left, restored.top - after.top) < 0.1,
      };
    }, drag);
    if (!edit.moved || !edit.viewSwitch || !edit.roundTrip)
      throw new Error(`${name}: actual label drag or restoration failed`);
    results.push({ viewport: name, browserLocalLabelEdit: edit });
    await page.close();
  }
  if (errors.length) throw new Error('Live editor raised JavaScript errors. See private report.');
  const afterHash = await readDraftHash();
  if (afterHash !== beforeHash) throw new Error('Hosted draft changed during browser-local QA.');
  await writeFile(
    join(output, 'results.json'),
    JSON.stringify(
      {
        status: 'passed',
        results,
        errors,
        hostedDraftUnchanged: true,
        beforeHash,
        afterHash,
        scope:
          'Actual hosted import, exact geometry, settled rows, view switching and browser-local label drag/restore. Hosted draft unchanged; no accuracy claim.',
      },
      null,
      2
    ),
    { flag: 'wx' }
  );
  console.log(
    JSON.stringify({
      status: 'passed',
      viewsChecked: state.images.length * 2,
      editChecks: 2,
      output,
    })
  );
} catch (error) {
  const message = redact(error instanceof Error ? error.message : String(error));
  await writeFile(
    join(output, 'results.json'),
    JSON.stringify({ status: 'failed', message, results, errors }, null, 2),
    { flag: 'wx' }
  );
  console.error(message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
