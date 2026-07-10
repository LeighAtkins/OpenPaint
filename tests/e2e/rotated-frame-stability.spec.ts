import { test, expect, waitForApp, waitForCanvasLayoutSettle } from './fixtures';
import type { Page } from '@playwright/test';

async function seedWideImage(page: Page, viewId: string): Promise<string> {
  await page.evaluate(async id => {
    const source = document.createElement('canvas');
    source.width = 960;
    source.height = 540;
    const context = source.getContext('2d');
    if (!context) throw new Error('2d context unavailable');
    context.fillStyle = '#315b96';
    context.fillRect(0, 0, source.width, source.height);
    context.strokeStyle = '#f97316';
    context.lineWidth = 18;
    context.strokeRect(90, 70, 780, 400);
    await window.app?.projectManager?.addImage?.(id, source.toDataURL('image/png'), {
      refreshBackground: true,
    });
  }, viewId);
  await waitForCanvasLayoutSettle(page);
  return page.evaluate(() => String(window.app?.projectManager?.currentViewId || ''));
}

async function normalTabIds(page: Page, viewId: string): Promise<string[]> {
  return page.evaluate(id => {
    const state = window.captureTabsByLabel?.[id];
    return (state?.tabs || [])
      .filter(tab => tab?.type !== 'master')
      .map(tab => String(tab.id || ''))
      .filter(Boolean);
  }, viewId);
}

async function activateTab(page: Page, viewId: string, tabId: string): Promise<void> {
  await page.evaluate(({ id, tab }) => window.setActiveCaptureTab?.(id, tab), {
    id: viewId,
    tab: tabId,
  });
  await page.waitForTimeout(120);
  await waitForCanvasLayoutSettle(page);
}

async function captureTabGeometry(page: Page, viewId: string) {
  return page.evaluate(id => {
    const frame = document.getElementById('captureFrame')?.getBoundingClientRect();
    const state = window.captureTabsByLabel?.[id];
    const tab = state?.tabs?.find(item => item.id === state.activeTabId);
    return {
      tabId: String(state?.activeTabId || ''),
      frame: {
        width: Number(frame?.width || 0),
        height: Number(frame?.height || 0),
      },
      stored: {
        width: Number(tab?.captureFrame?.width || 0),
        height: Number(tab?.captureFrame?.height || 0),
      },
      world: {
        left: Number(tab?.captureFrame?.worldRect?.left || 0),
        top: Number(tab?.captureFrame?.worldRect?.top || 0),
        width: Number(tab?.captureFrame?.worldRect?.width || 0),
        height: Number(tab?.captureFrame?.worldRect?.height || 0),
      },
      viewport: {
        zoom: Number(tab?.viewport?.zoom || 0),
        rotation: Number(tab?.viewport?.rotation || 0),
      },
      liveRotation: Number(window.app?.canvasManager?.getRotationDegrees?.() || 0),
    };
  }, viewId);
}

function expectGeometryStable(
  before: Awaited<ReturnType<typeof captureTabGeometry>>,
  after: Awaited<ReturnType<typeof captureTabGeometry>>
) {
  expect(after.frame.width).toBeCloseTo(before.frame.width, 0);
  expect(after.frame.height).toBeCloseTo(before.frame.height, 0);
  expect(after.stored.width).toBeCloseTo(before.stored.width, 0);
  expect(after.stored.height).toBeCloseTo(before.stored.height, 0);
  expect(after.world.left).toBeCloseTo(before.world.left, 3);
  expect(after.world.top).toBeCloseTo(before.world.top, 3);
  expect(after.world.width).toBeCloseTo(before.world.width, 3);
  expect(after.world.height).toBeCloseTo(before.world.height, 3);
  expect(after.viewport.zoom).toBeCloseTo(before.viewport.zoom, 5);
  expect(after.liveRotation).toBeCloseTo(90, 5);
}

test.describe('Rotated frame stability', () => {
  test('repeated tab switches do not shrink or rewrite rotated frame geometry', async ({
    page,
  }) => {
    await page.goto('/');
    await waitForApp(page);
    const viewId = await seedWideImage(page, 'rotated-tabs');

    await page.evaluate(() => window.app?.projectManager?.rotateCurrentView?.(90));
    await page.waitForTimeout(150);
    await page.evaluate(() =>
      window.createCaptureTabForLabel?.(window.app?.projectManager?.currentViewId || 'front')
    );
    await page.waitForTimeout(150);

    const tabs = await normalTabIds(page, viewId);
    expect(tabs.length).toBeGreaterThanOrEqual(2);

    const baseline = new Map<string, Awaited<ReturnType<typeof captureTabGeometry>>>();
    for (const tabId of tabs.slice(0, 2)) {
      await activateTab(page, viewId, tabId);
      const geometry = await captureTabGeometry(page, viewId);
      expect(geometry.world.width / geometry.world.height).toBeCloseTo(
        geometry.frame.width / geometry.frame.height,
        2
      );
      baseline.set(tabId, geometry);
    }

    for (let cycle = 0; cycle < 8; cycle += 1) {
      for (const tabId of tabs.slice(0, 2)) {
        await activateTab(page, viewId, tabId);
      }
    }

    for (const tabId of tabs.slice(0, 2)) {
      await activateTab(page, viewId, tabId);
      expectGeometryStable(baseline.get(tabId)!, await captureTabGeometry(page, viewId));
    }
  });

  test('legacy rotated project does not shrink while switching images', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const firstViewId = await seedWideImage(page, 'legacy-front');
    const rotatedViewId = await seedWideImage(page, 'legacy-rotated');
    const projectData = await page.evaluate(async currentViewId => {
      const data = await window.app?.projectManager?.getProjectData?.({ embedImages: true });
      const view = data?.views?.[currentViewId];
      if (!data || !view) throw new Error('Failed to build legacy rotation fixture');
      data.currentViewId = currentViewId;
      view.rotation = 90;
      view.backgroundRotation = 0;
      view.viewport = {
        ...(view.viewport || {}),
        zoom: 0.8888888888888888,
        panX: 0,
        panY: 0,
      };
      view.backgroundWorldRect = { left: 440, top: 194, width: 400, height: 300 };
      const tabs = view.tabs?.tabs || [];
      tabs.forEach(tab => {
        if (tab.type === 'master') return;
        tab.viewport = { zoom: 0.8888888888888888, panX: 0, panY: 0, rotation: 90 };
        tab.captureFrame = {
          ...(tab.captureFrame || {}),
          worldRect: { left: 660.5, top: 183, width: 600, height: 450 },
        };
      });
      return data;
    }, rotatedViewId);

    await page.evaluate(
      data => window.app?.projectManager?.loadProjectFromData?.(data),
      projectData
    );
    await page.waitForFunction(() => !(window as any).__isLoadingProject, { timeout: 30_000 });
    await page.waitForTimeout(1_500);
    const authored = await captureTabGeometry(page, rotatedViewId);

    const samples = [];
    for (let cycle = 0; cycle < 8; cycle += 1) {
      await page.evaluate(id => window.app?.projectManager?.switchView?.(id, true), firstViewId);
      await page.waitForTimeout(120);
      await page.evaluate(id => window.app?.projectManager?.switchView?.(id, true), rotatedViewId);
      await page.waitForTimeout(220);
      samples.push(await captureTabGeometry(page, rotatedViewId));
    }

    for (const sample of samples) {
      expectGeometryStable(authored, sample);
    }
  });
});
