/**
 * Real Cloud Save round trip against a signed-in deployment.
 *
 * Unlike project-stability-workflow.spec.ts (which round-trips the payload in
 * the browser), this clicks the real Cloud Save button, opens My Projects in a
 * fresh session, loads the project back from Supabase and compares what the
 * user sees. It writes one clearly named test project to the signed-in account
 * and deletes it again at the end.
 *
 * It only runs when both are set:
 *   STABILITY_BASE_URL   deployment to test, e.g. a Vercel preview URL
 *   STABILITY_AUTH_FILE  JSON file holding the signed-in Supabase session,
 *                        as { "sb-<project>-auth-token": "<stored value>" }
 *
 * The session file is a credential. Keep it outside the repository.
 */
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, waitForApp } from './fixtures';
import type { BrowserContext, Page } from '@playwright/test';
import {
  VIEW_SPECS,
  addText,
  captureAllViews,
  compareAll,
  dragFrameHandle,
  drawStroke,
  formatDifferences,
  openView,
  pressFrameSizeKey,
  seedView,
  setMeasurement,
  waitForIdle,
  type ViewSnapshot,
} from './helpers/stability-workflow';

const BASE_URL = process.env['STABILITY_BASE_URL'] || '';
const AUTH_FILE = process.env['STABILITY_AUTH_FILE'] || '';
const REPORT_DIR = path.resolve(process.cwd(), 'test-results', 'cloud-save-live');

// Embedded photos make DOM snapshots for tracing very slow.
test.use({ trace: 'off' });

function readSession(): Record<string, string> {
  const parsed = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')) as Record<string, unknown>;
  const entries = Object.entries(parsed).filter(
    ([key, value]) => /^sb-.*-auth-token$/.test(key) && typeof value === 'string'
  ) as Array<[string, string]>;
  if (!entries.length) {
    throw new Error(`${AUTH_FILE} holds no "sb-…-auth-token" entry`);
  }
  return Object.fromEntries(entries);
}

async function signedInContext(
  browser: NonNullable<ReturnType<BrowserContext['browser']>>,
  session: Record<string, string>,
  viewport = { width: 1280, height: 800 }
): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(entries => {
    for (const [key, value] of Object.entries(entries)) {
      window.localStorage.setItem(key, value);
    }
  }, session);
  // Using the refresh token here would rotate it and sign the owner out of
  // their own browser. The access token alone is enough for a short run.
  await context.route(/\/auth\/v1\/(token|logout)/, route => route.abort());
  // A test save must not earn rewards on the account.
  await context.route(/\/api\/wallet\//, route => route.abort());
  return context;
}

async function openSignedInApp(page: Page): Promise<void> {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await waitForApp(page, 60_000);
  await page.evaluate(() => document.fonts.ready);
  const cloudMenu = page.locator('#canvasCloudMenu');
  await expect(
    cloudMenu,
    'The cloud menu did not appear: the saved session is missing, expired, or belongs to a different Supabase project than this deployment.'
  ).toBeVisible({ timeout: 20_000 });
}

async function waitForCloudState(page: Page, state: 'saved' | 'error'): Promise<string> {
  const handle = await page.waitForFunction(
    () => {
      const button = document.querySelector<HTMLElement>('[data-cloud-save-trigger]');
      const current = button?.dataset['cloudState'] || '';
      return current === 'saved' || current === 'error' ? current : false;
    },
    undefined,
    { timeout: 120_000 }
  );
  const reached = String(await handle.jsonValue());
  expect(reached, 'Cloud save reported an error').toBe(state);
  return reached;
}

async function clickCloudSave(page: Page): Promise<void> {
  // With images in the project the single save trigger is "Cloud Save".
  const trigger = page.locator('[data-cloud-save-trigger]').first();
  await expect(trigger).toContainText('Cloud Save', { timeout: 10_000 });
  await trigger.click();
  await waitForCloudState(page, 'saved');
}

async function openMyProjects(page: Page): Promise<void> {
  // In an empty project the primary button is "My Projects"; otherwise it is
  // the secondary entry of the same menu.
  const primary = page.locator('#canvasCloudSaveBtn');
  const primaryText = (await primary.textContent()) || '';
  if (primaryText.includes('My Projects')) {
    await primary.click();
  } else {
    await page.locator('#canvasCloudMenu').hover();
    await page.locator('#canvasMyProjectsBtn').click();
  }
  await expect(page.locator('.cloud-modal-overlay.visible')).toBeVisible({ timeout: 10_000 });
}

async function loadProjectByName(page: Page, token: string, viewId: string): Promise<void> {
  await openMyProjects(page);
  const card = page.locator('.cloud-project-card').filter({ hasText: token }).first();
  await expect(card, `Project "${token}" is not listed in My Projects`).toBeVisible({
    timeout: 30_000,
  });
  await card.locator('.cloud-load-btn').click();
  await page.waitForFunction(
    id =>
      !(window as any).__isLoadingProject &&
      Boolean(window.app?.projectManager?.views?.[id]?.image),
    viewId,
    { timeout: 120_000 }
  );
  await page.waitForTimeout(900);
  await waitForIdle(page);
}

async function deleteProjectsByName(page: Page, token: string): Promise<number> {
  await openMyProjects(page);
  await page.waitForTimeout(1_500);
  page.on('dialog', dialog => void dialog.accept());
  let removed = 0;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const card = page.locator('.cloud-project-card').filter({ hasText: token }).first();
    if (!(await card.isVisible().catch(() => false))) break;
    const deleted = page.waitForResponse(
      response =>
        response.request().method() === 'DELETE' && /\/rest\/v1\/projects/.test(response.url()),
      { timeout: 30_000 }
    );
    await card.locator('.cloud-delete-btn').click();
    await deleted;
    removed += 1;
    await page.waitForTimeout(500);
  }
  return removed;
}

function report(name: string, snapshots: Map<string, ViewSnapshot>, differences: unknown[]) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(REPORT_DIR, `${name}.json`),
    JSON.stringify({ differences, snapshots: Object.fromEntries(snapshots) }, null, 2)
  );
}

test.describe('Cloud Save against a signed-in deployment', () => {
  test.skip(
    !BASE_URL || !AUTH_FILE,
    'Set STABILITY_BASE_URL and STABILITY_AUTH_FILE to run the live Cloud Save test'
  );
  test.setTimeout(15 * 60_000);

  test('a project saved with the Cloud Save button loads back unchanged from My Projects', async ({
    browser,
  }) => {
    const session = readSession();
    const token = `ZZ-STABILITY-${Date.now()}`;
    const views = [VIEW_SPECS[0], VIEW_SPECS[1], VIEW_SPECS[3], VIEW_SPECS[6]];
    const viewIds = views.map(spec => spec.id);
    const fonts = ['Nunito', 'Caveat', 'Space Mono', 'Georgia'];

    let context = await signedInContext(browser, session);
    let page = await context.newPage();
    let saved = false;

    try {
      await openSignedInApp(page);
      for (const spec of views) await seedView(page, spec);
      for (let index = 0; index < viewIds.length; index += 1) {
        const viewId = viewIds[index];
        await openView(page, viewId);
        if (viewId === 'v02-portrait') await dragFrameHandle(page, 'e', -0.12, 0);
        if (viewId === 'v04-wide') await dragFrameHandle(page, 's', 0, -0.15);
        if (viewId === 'v07-large') await pressFrameSizeKey(page, '-', 2);
        await drawStroke(page, 'line', [0.12, 0.3], [0.62, 0.36], { color: '#ef4444', width: 3 });
        await drawStroke(page, 'line', [0.2, 0.78], [0.8, 0.7], {
          color: '#3b82f6',
          width: 3,
          dash: index % 2 ? 'dotted' : 'solid',
        });
        await addText(page, [0.14, 0.12], [`Cloud note ${index + 1}`], {
          fontFamily: fonts[index % fonts.length],
          fontSize: [18, 28, 40, 24][index % 4],
          color: '#111827',
          background: index % 2 === 0,
        });
        await setMeasurement(page, viewId, 'A1', 20 + index);
      }
      await openView(page, viewIds[1]);

      // Cloud save requires customer, sofa type and a guide; fill them in as a
      // user would have through the project details dialog.
      await page.evaluate(name => {
        const manager = window.app!.projectManager;
        const metadata = manager.getProjectMetadata();
        manager.setProjectMetadata({
          naming: {
            ...(metadata.naming || {}),
            customerName: name,
            sofaTypeLabel: 'Automated test',
          },
          measurementGuideCode: metadata.measurementGuideCode || 'TEST',
        });
        const input = document.getElementById('projectName') as HTMLInputElement | null;
        if (input) input.value = name;
      }, token);

      const baseline = await captureAllViews(page, viewIds);
      report('00-baseline', baseline, []);
      await openView(page, viewIds[1]);

      await clickCloudSave(page);
      saved = true;

      // A brand new signed-in session, as when reopening the editor later.
      await context.close();
      context = await signedInContext(browser, session);
      page = await context.newPage();
      await openSignedInApp(page);
      await loadProjectByName(page, token, viewIds[1]);

      const loaded = await captureAllViews(page, viewIds);
      const loadDifferences = compareAll(baseline, loaded);
      report('01-after-cloud-load', loaded, loadDifferences);

      let switched = loaded;
      for (let cycle = 0; cycle < 2; cycle += 1) {
        switched = await captureAllViews(page, [...viewIds].reverse());
      }
      const switchDifferences = compareAll(baseline, switched);
      report('02-switching-after-cloud-load', switched, switchDifferences);

      // Save the loaded project over itself and load it once more, on a
      // smaller window: only pixel sizes may change.
      await openView(page, viewIds[1]);
      await clickCloudSave(page);
      await context.close();
      context = await signedInContext(browser, session, { width: 1024, height: 700 });
      page = await context.newPage();
      await openSignedInApp(page);
      await loadProjectByName(page, token, viewIds[1]);
      const smaller = await captureAllViews(page, viewIds);
      const smallerDifferences = compareAll(baseline, smaller, {
        framePixels: false,
        cropTolerance: 0.02,
        boxTolerance: 0.012,
      });
      report('03-resaved-smaller-window', smaller, smallerDifferences);

      expect(loadDifferences, formatDifferences(loadDifferences)).toEqual([]);
      expect(switchDifferences, formatDifferences(switchDifferences)).toEqual([]);
      expect(smallerDifferences, formatDifferences(smallerDifferences)).toEqual([]);
    } finally {
      if (saved) {
        // Always remove the test project, even after a failed assertion.
        await context.close().catch(() => undefined);
        context = await signedInContext(browser, session);
        page = await context.newPage();
        await openSignedInApp(page);
        const removed = await deleteProjectsByName(page, token);
        console.log(`[cloud-save-live] removed ${removed} test project(s) named ${token}`);
      }
      await context.close().catch(() => undefined);
    }
  });
});
