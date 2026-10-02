import { test, expect, waitForApp } from './fixtures';
import { assistantPlacement } from '../helpers/assistant-placement';
import sharp from 'sharp';

test('MCP photo handoff keeps connected seam geometry and survives project restoration', async ({
  page,
}) => {
  const id = '11111111-1111-4111-8111-111111111111';
  const imageId = '22222222-2222-4222-8222-222222222222';
  const origin = 'http://127.0.0.1:8789';
  const token = '0'.repeat(64);
  const photo = await sharp({
    create: { width: 1000, height: 600, channels: 3, background: '#b4a08c' },
  })
    .png()
    .toBuffer();
  await page.route(`${origin}/projects/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    const headers = {
      'Access-Control-Allow-Origin': 'http://127.0.0.1:5173',
      'Access-Control-Allow-Headers': 'Authorization',
    };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (path.endsWith(imageId))
      return route.fulfill({ contentType: 'image/png', body: photo, headers });
    return route.fulfill({
      headers,
      json: {
        projectId: id,
        images: [
          {
            id: imageId,
            view: 'front',
            src: `${origin}/projects/${id}/images/${imageId}?key=${token}`,
            mimeType: 'image/png',
          },
        ],
        placement: assistantPlacement(imageId),
      },
    });
  });
  await page.goto(
    `/#${new URLSearchParams({ measurementDraft: `${origin}/projects/${id}`, key: token })}`
  );
  await waitForApp(page);
  await expect
    .poll(() => page.evaluate(() => window.app?.measurementOverlayManager?.getStore().order.length))
    .toBe(1);
  await expect(
    page.locator('[role="status"]').filter({ hasText: 'Measurement drawing ready' })
  ).toBeVisible();
  const state = await page.evaluate(async () => {
    const manager = window.app!.measurementOverlayManager!;
    const before = manager.getOverlay(manager.getStore().order[0])!;
    const saved = manager.toJSON();
    const geometries = Array.from(before.elements.values()).map(el => ({
      endpoints: el.endpoints.map(endpoint => endpoint.point),
      curvePoints: el.curvePoints,
    }));
    await manager.fromJSON(saved);
    const after = manager.getOverlay(manager.getStore().order[0])!;
    return {
      geometries,
      restored: Array.from(after.elements.values()).map(el => ({
        endpoints: el.endpoints.map(endpoint => endpoint.point),
        curvePoints: el.curvePoints,
      })),
      labels: after.assistantLabels,
      tagTexts: window
        .app!.canvasManager.fabricCanvas.getObjects()
        .filter((object: any) => object.isTag)
        .flatMap(
          (object: any) =>
            object
              .getObjects?.()
              .filter((child: any) => child.type === 'text' || child.type === 'i-text')
              .map((child: any) => child.text) || []
        ),
      imageWidth: window.app!.canvasManager.fabricCanvas.backgroundImage?.width,
    };
  });
  expect(state.imageWidth).toBe(1000);
  expect(state.geometries).toHaveLength(2);
  expect(state.geometries[1].curvePoints).toHaveLength(3);
  expect(state.restored).toEqual(state.geometries);
  expect(Object.values(state.labels!)).toEqual(['A', 'A']);
  expect(state.tagTexts).toEqual(['A', 'A']);
  expect(new URL(page.url()).hash).toBe('');
});
