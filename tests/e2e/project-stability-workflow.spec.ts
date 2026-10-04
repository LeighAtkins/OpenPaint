/**
 * Long-form project stability workflow.
 *
 * Builds a 12-image project with the real tools (lines, arrows, curves,
 * freehand, shapes, text in several fonts and sizes, frames of different sizes
 * and aspect ratios, rotation, a second frame tab), then checks that nothing a
 * customer would notice changes when they:
 *   1. switch between images repeatedly,
 *   2. save to the cloud and load the project back in a fresh session,
 *   3. keep switching images in the loaded project,
 *   4. save and load a second time,
 *   5. open the project on a different window size.
 *
 * Set STABILITY_BASE_URL to run the same workflow against a deployed build.
 */
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, waitForApp } from './fixtures';
import type { Page } from '@playwright/test';
import {
  VIEW_SPECS,
  addText,
  captureAllViews,
  cloudLoadPayload,
  cloudSavePayload,
  compareAll,
  dragFrameHandle,
  drawCurve,
  drawStroke,
  formatDifferences,
  openView,
  pressFrameSizeKey,
  seedView,
  setMeasurement,
  waitForIdle,
  type Difference,
  type ViewSnapshot,
} from './helpers/stability-workflow';

const BASE_URL = process.env['STABILITY_BASE_URL'] || '/';
const REPORT_DIR = path.resolve(process.cwd(), 'test-results', 'project-stability');
const VIEW_IDS = VIEW_SPECS.map(spec => spec.id);

const FONTS = ['Nunito', 'Caveat', 'Space Mono', 'Georgia'];
const COLORS = ['#ef4444', '#22c55e', '#3b82f6', '#f59e0b', '#111827', '#a855f7'];

async function openApp(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  await waitForApp(page, 45_000);
  await page.evaluate(() => document.fonts.ready);
}

async function buildProject(page: Page): Promise<void> {
  for (const spec of VIEW_SPECS) await seedView(page, spec);

  for (let index = 0; index < VIEW_SPECS.length; index += 1) {
    const viewId = VIEW_IDS[index];
    await openView(page, viewId);

    // Frame adjustments first, so drawing happens in the final frame.
    if (viewId === 'v02-portrait') await dragFrameHandle(page, 'e', -0.12, 0);
    if (viewId === 'v04-wide') await dragFrameHandle(page, 's', 0, -0.15);
    if (viewId === 'v05-tall') await dragFrameHandle(page, 'se', -0.1, 0.02);
    if (viewId === 'v09-pano') await dragFrameHandle(page, 'n', 0, 0.18);
    if (viewId === 'v03-square') await pressFrameSizeKey(page, '-', 3);
    if (viewId === 'v06-small') await pressFrameSizeKey(page, '+', 1);
    if (viewId === 'v08-phone') {
      await dragFrameHandle(page, 'w', 0.1, 0);
      await pressFrameSizeKey(page, '-', 1);
    }
    if (viewId === 'v10-rotated-wide') {
      await page.locator('#rotateRightCtrl').click();
      await waitForIdle(page);
    }
    if (viewId === 'v11-rotated-tall') {
      await page.locator('#rotateLeftCtrl').click();
      await waitForIdle(page);
    }
    if (viewId === 'v07-large') {
      const frame = await page.locator('#captureFrame').boundingBox();
      await page.mouse.move(frame!.x + frame!.width * 0.4, frame!.y + frame!.height * 0.45);
      await page.mouse.wheel(0, -240);
      await page.waitForTimeout(400);
    }

    await drawStroke(page, 'line', [0.12, 0.3], [0.62, 0.36], {
      color: COLORS[index % COLORS.length],
      width: 2 + (index % 4),
    });
    await drawStroke(page, 'line', [0.2, 0.78], [0.8, 0.7], {
      color: COLORS[(index + 2) % COLORS.length],
      width: 3,
      dash: ['solid', 'dotted', 'medium', 'dot-dash'][index % 4],
    });
    if (index % 3 === 0) {
      await drawStroke(page, 'arrow', [0.7, 0.2], [0.88, 0.42], { color: '#f59e0b', width: 4 });
    }
    if (index % 4 === 1) {
      await drawCurve(page, [
        [0.15, 0.55],
        [0.4, 0.62],
        [0.66, 0.52],
      ]);
    }
    if (index % 5 === 2) {
      await drawStroke(page, 'pencil', [0.3, 0.44], [0.52, 0.47], { color: '#111827', width: 3 }, [
        [0.36, 0.4],
        [0.44, 0.5],
      ]);
    }
    if (index % 6 === 3) {
      await drawStroke(page, 'shape', [0.58, 0.48], [0.76, 0.62], { color: '#a855f7', width: 3 });
    }

    await addText(page, [0.14, 0.12], [`Note ${index + 1} ${viewId.slice(4)}`], {
      fontFamily: FONTS[index % FONTS.length],
      fontSize: [14, 20, 28, 40, 56][index % 5],
      color: COLORS[(index + 1) % COLORS.length],
      background: index % 2 === 0,
    });
    if (index % 2 === 1) {
      await addText(page, [0.5, 0.88], [`Two line ${index + 1}`, 'second row'], {
        fontFamily: FONTS[(index + 2) % FONTS.length],
        fontSize: [18, 32, 24][index % 3],
        color: '#111827',
        background: true,
      });
    }

    await setMeasurement(page, viewId, 'A1', 20 + index * 1.25);
    await setMeasurement(page, viewId, 'A2', 9.5 + index);
  }

  // A second frame tab with its own crop and annotation.
  await openView(page, 'v12-two-frames');
  await page.evaluate(() => (window as any).createCaptureTabForLabel('v12-two-frames'));
  await waitForIdle(page);
  await dragFrameHandle(page, 'e', -0.15, 0);
  await drawStroke(page, 'line', [0.2, 0.5], [0.8, 0.5], { color: '#ef4444', width: 4 });
  await addText(page, [0.2, 0.2], ['Detail frame'], {
    fontFamily: 'Caveat',
    fontSize: 36,
    color: '#ef4444',
    background: false,
  });

  // Finish on a middle image, as a user would, then let everything settle.
  await openView(page, 'v06-small');
}

function shots(name: string): string {
  const dir = path.join(REPORT_DIR, 'screenshots', name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function report(name: string, differences: Difference[], snapshots?: Map<string, ViewSnapshot>) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(REPORT_DIR, `${name}.json`),
    JSON.stringify(
      { differences, snapshots: snapshots ? Object.fromEntries(snapshots) : undefined },
      null,
      2
    )
  );
  console.log(`[stability] ${name}: ${formatDifferences(differences)}`);
}

// Twelve embedded photos make DOM snapshots for tracing very slow.
test.use({ trace: 'off' });

test.describe('Project stability workflow', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(20 * 60_000);

  test('12-image project survives switching, cloud save/load, and a different window size', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('pageerror', error => consoleErrors.push(`pageerror: ${error.message}`));
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 300));
    });

    await openApp(page);
    await buildProject(page);

    const baseline = await captureAllViews(page, VIEW_IDS, shots('00-baseline'));
    report('00-baseline', [], baseline);
    for (const snapshot of baseline.values()) {
      expect(snapshot.objects.length, `${snapshot.viewId}: objects drawn`).toBeGreaterThanOrEqual(
        3
      );
      expect(
        snapshot.objects.some(object => object.text),
        `${snapshot.viewId}: text drawn`
      ).toBe(true);
    }

    const failures: string[] = [];
    const check = (
      name: string,
      differences: Difference[],
      snapshots: Map<string, ViewSnapshot>
    ) => {
      report(name, differences, snapshots);
      if (differences.length) failures.push(`${name}: ${formatDifferences(differences, 25)}`);
    };

    // 1. Switching between images must not change anything.
    let switched = baseline;
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const order = cycle % 2 === 0 ? [...VIEW_IDS].reverse() : VIEW_IDS;
      switched = await captureAllViews(page, order);
    }
    check('01-switching-before-save', compareAll(baseline, switched), switched);

    // 2. Cloud save, then load into a brand new session.
    await openView(page, 'v06-small');
    const firstSave = await cloudSavePayload(page);
    fs.writeFileSync(path.join(REPORT_DIR, 'first-save.json'), JSON.stringify(firstSave));
    await openApp(page);
    await cloudLoadPayload(page, firstSave);
    const loaded = await captureAllViews(page, VIEW_IDS, shots('02-after-cloud-load'));
    check('02-after-cloud-load', compareAll(baseline, loaded), loaded);

    // 3. Keep switching in the loaded project.
    let loadedSwitched = loaded;
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const order = cycle % 2 === 0 ? [...VIEW_IDS].reverse() : VIEW_IDS;
      loadedSwitched = await captureAllViews(page, order);
    }
    check('03-switching-after-cloud-load', compareAll(baseline, loadedSwitched), loadedSwitched);

    // 4. Second generation: save the loaded project and load it again.
    const secondSave = await cloudSavePayload(page);
    await openApp(page);
    await cloudLoadPayload(page, secondSave);
    const reloaded = await captureAllViews(page, VIEW_IDS);
    check('04-after-second-cloud-load', compareAll(baseline, reloaded), reloaded);

    // 5. Loading over an already open project (no page refresh in between).
    await cloudLoadPayload(page, firstSave);
    const overloaded = await captureAllViews(page, VIEW_IDS);
    check('05-load-over-open-project', compareAll(baseline, overloaded), overloaded);

    // 6. A different window size: pixel sizes change, but aspect, crop and
    //    image-relative geometry must not.
    await page.setViewportSize({ width: 1024, height: 700 });
    await openApp(page);
    await cloudLoadPayload(page, firstSave);
    const smaller = await captureAllViews(page, VIEW_IDS, shots('06-smaller-window'));
    check(
      '06-smaller-window',
      compareAll(baseline, smaller, {
        framePixels: false,
        cropTolerance: 0.02,
        boxTolerance: 0.012,
      }),
      smaller
    );
    let smallerSwitched = smaller;
    for (let cycle = 0; cycle < 2; cycle += 1) {
      smallerSwitched = await captureAllViews(page, [...VIEW_IDS].reverse());
    }
    check('07-smaller-window-switching', compareAll(smaller, smallerSwitched), smallerSwitched);

    // 7. Back on the original window size the project must look as authored.
    await page.setViewportSize({ width: 1280, height: 800 });
    const thirdSave = await cloudSavePayload(page);
    await openApp(page);
    await cloudLoadPayload(page, thirdSave);
    const restored = await captureAllViews(page, VIEW_IDS, shots('08-back-to-original-window'));
    check('08-back-to-original-window', compareAll(baseline, restored), restored);

    const fatalErrors = consoleErrors.filter(
      text => !/favicon|net::ERR|Failed to load resource|\[ENV\]|Supabase/i.test(text)
    );
    fs.writeFileSync(
      path.join(REPORT_DIR, 'console-errors.json'),
      JSON.stringify(fatalErrors, null, 2)
    );

    expect(failures, failures.join('\n\n')).toEqual([]);
  });

  test('notes keep their font and size when a project loads before the web fonts arrive', async ({
    page,
  }) => {
    const fontViews = VIEW_SPECS.slice(0, 3);
    const fontViewIds = fontViews.map(spec => spec.id);
    const noteFonts = ['Caveat', 'Space Mono', 'Nunito'];

    await openApp(page);
    for (const spec of fontViews) await seedView(page, spec);
    for (let index = 0; index < fontViewIds.length; index += 1) {
      await openView(page, fontViewIds[index]);
      await addText(page, [0.15, 0.2], [`Slow font note ${index + 1}`], {
        fontFamily: noteFonts[index],
        fontSize: 36,
        color: '#111827',
        background: true,
      });
      await addText(page, [0.2, 0.6], ['Second note', 'on two rows'], {
        fontFamily: noteFonts[(index + 1) % noteFonts.length],
        fontSize: 22,
        color: '#ef4444',
        background: false,
      });
    }
    const baseline = await captureAllViews(page, fontViewIds);
    // Open on the handwritten-font image so its text is revived immediately.
    await openView(page, fontViewIds[0]);
    const saved = await cloudSavePayload(page);
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(path.join(REPORT_DIR, 'slow-font-save.json'), JSON.stringify(saved));

    // A brand new session whose font files take a while to download, as on a
    // cold cache or a slow connection.
    const context = await page
      .context()
      .browser()!
      .newContext({
        viewport: { width: 1280, height: 800 },
      });
    const freshPage = await context.newPage();
    await freshPage.route(/fonts\.gstatic\.com/, async route => {
      await new Promise(resolve => setTimeout(resolve, 1_500));
      await route.continue().catch(() => undefined);
    });
    await freshPage.goto(BASE_URL === '/' ? new URL('/', page.url()).toString() : BASE_URL);
    await waitForApp(freshPage, 45_000);
    await cloudLoadPayload(freshPage, saved);
    // Visit every image once so each font starts loading, then give the slow
    // downloads time to finish. The notes must correct themselves by then.
    for (const viewId of fontViewIds) await openView(freshPage, viewId);
    await freshPage.waitForTimeout(3_000);

    const loaded = await captureAllViews(freshPage, fontViewIds);
    const differences = compareAll(baseline, loaded);
    report('09-slow-fonts', differences, loaded);
    const cached = await freshPage.evaluate(() =>
      window
        .app!.canvasManager.fabricCanvas.getObjects()
        .filter((object: any) => object.type === 'i-text')
        .map((object: any) => ({ caching: object.objectCaching, padding: object.padding }))
    );
    await context.close();

    expect(cached.length).toBeGreaterThan(0);
    for (const entry of cached) expect(entry).toEqual({ caching: false, padding: 5 });
    expect(differences, formatDifferences(differences)).toEqual([]);
  });

  test('projects saved by earlier builds reopen with a stable frame', async ({ page }) => {
    const legacyViews = [VIEW_SPECS[0], VIEW_SPECS[3], VIEW_SPECS[7], VIEW_SPECS[2]];
    const legacyViewIds = legacyViews.map(spec => spec.id);
    // Frames reshaped with the handles: earlier builds kept the old base size.
    const reshaped = new Set(['v04-wide', 'v08-phone']);

    await openApp(page);
    for (const spec of legacyViews) await seedView(page, spec);
    for (let index = 0; index < legacyViewIds.length; index += 1) {
      const viewId = legacyViewIds[index];
      await openView(page, viewId);
      if (viewId === 'v04-wide') await dragFrameHandle(page, 's', 0, -0.15);
      if (viewId === 'v08-phone') await dragFrameHandle(page, 'w', 0.1, 0);
      await drawStroke(page, 'line', [0.15, 0.3], [0.7, 0.4], { color: '#ef4444', width: 3 });
      await addText(page, [0.2, 0.15], [`Legacy note ${index + 1}`], {
        fontFamily: 'Georgia',
        fontSize: 28,
        color: '#111827',
        background: true,
      });
      await setMeasurement(page, viewId, 'A1', 12 + index);
    }
    const baseline = await captureAllViews(page, legacyViewIds);
    await openView(page, legacyViewIds[0]);
    const saved = await cloudSavePayload(page);

    // Rewrite the frame records into the shape earlier builds stored: no
    // version marker, and a base size that is larger than the visible frame
    // (the canvas/window unit mix-up) or still has the pre-reshape aspect.
    for (const viewId of legacyViewIds) {
      for (const tab of saved.views[viewId].tabs.tabs) {
        const frame = tab.captureFrame;
        if (!frame) continue;
        delete frame.frameVersion;
        frame.baseWidth = Math.round(frame.width * 1.064);
        frame.baseHeight = Math.round(frame.height * (reshaped.has(viewId) ? 1.52 : 1.064));
      }
    }
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(path.join(REPORT_DIR, 'legacy-save.json'), JSON.stringify(saved));

    await openApp(page);
    await cloudLoadPayload(page, saved);
    const loaded = await captureAllViews(page, legacyViewIds, shots('10-legacy-load'));

    // Content never moves on the image; only the frame may recover the size it
    // had before the old shrink, and never changes shape.
    const contentDifferences = compareAll(baseline, loaded, {
      framePixels: false,
      cropTolerance: 0.075,
    });
    report('10-legacy-load', contentDifferences, loaded);
    expect(contentDifferences, formatDifferences(contentDifferences)).toEqual([]);
    for (const viewId of legacyViewIds) {
      const before = baseline.get(viewId)!.frame;
      const after = loaded.get(viewId)!.frame;
      const growth = after.width / before.width;
      if (reshaped.has(viewId)) {
        expect(growth, `${viewId}: reshaped frame keeps its saved size`).toBeCloseTo(1, 2);
      } else {
        expect(growth, `${viewId}: frame must not shrink`).toBeGreaterThanOrEqual(0.995);
        expect(growth, `${viewId}: frame recovers at most the old shrink`).toBeLessThanOrEqual(
          1.07
        );
      }
    }

    // Once opened, the project must stay put: switching and a save/load round
    // trip in the current format change nothing further.
    let switched = loaded;
    for (let cycle = 0; cycle < 3; cycle += 1) {
      switched = await captureAllViews(page, [...legacyViewIds].reverse());
    }
    const switchDifferences = compareAll(loaded, switched);
    report('11-legacy-switching', switchDifferences, switched);
    expect(switchDifferences, formatDifferences(switchDifferences)).toEqual([]);

    const resaved = await cloudSavePayload(page);
    await openApp(page);
    await cloudLoadPayload(page, resaved);
    const reloaded = await captureAllViews(page, legacyViewIds);
    const reloadDifferences = compareAll(loaded, reloaded);
    report('12-legacy-resave', reloadDifferences, reloaded);
    expect(reloadDifferences, formatDifferences(reloadDifferences)).toEqual([]);
  });
});
