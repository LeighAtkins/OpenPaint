import { test, expect } from './fixtures';

test('highlighter creates visual markup without a measurement tag', async ({ appPage: page }) => {
  await page.getByRole('button', { name: 'Drawing Mode' }).click();
  await page.getByRole('button', { name: 'Highlight', exact: true }).click();

  const canvas = page.locator('canvas.upper-canvas');
  await expect
    .poll(() => canvas.evaluate(element => window.getComputedStyle(element).cursor))
    .toContain('data:image/svg+xml');

  await expect(page.locator('#lineStyleQuickArrowButtons')).toBeHidden();
  await page.locator('#lineStylePopoverBtn').click();
  await expect(page.locator('#lineStyleArrowStyleRow')).toBeHidden();
  await expect(page.locator('#lineStyleStrokeLabel')).toHaveText('Brush width');
  await page.keyboard.press('Escape');
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) return;

  await page.mouse.move(bounds.x + bounds.width * 0.3, bounds.y + bounds.height * 0.42);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.65, bounds.y + bounds.height * 0.52, {
    steps: 8,
  });
  await page.mouse.up();

  const highlighterState = await page.evaluate(() => {
    const objects = window.app?.canvasManager?.fabricCanvas?.getObjects?.() || [];
    const highlight = objects.find(
      (object: any) => object?.isHighlighter === true || object?.customType === 'highlighter'
    );
    return highlight
      ? {
          found: true,
          arrowSettings: highlight.arrowSettings ?? null,
          dashSettings: highlight.dashSettings ?? null,
        }
      : { found: false, arrowSettings: null, dashSettings: null };
  });
  expect(highlighterState).toEqual({
    found: true,
    arrowSettings: null,
    dashSettings: null,
  });

  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
  await expect(page.locator('#quickMeasurementEntry')).toBeHidden();
  await expect(page.locator('#elementsMeasurementCount')).toHaveText('0');
});

test('zipper uses editable straight and curved vectors with finished ends', async ({
  appPage: page,
}) => {
  const canvas = page.locator('canvas.upper-canvas');
  await expect
    .poll(() => canvas.evaluate(element => window.getComputedStyle(element).cursor))
    .toBe('crosshair');

  await page.locator('#lineStylePopoverBtn').click();
  await page.locator('#lineStylePatternSelect').selectOption('zipper');
  await expect(page.locator('#lineStyleHighlighterRow')).toBeHidden();
  await expect(page.locator('#lineStyleArrowStyleRow')).toBeHidden();
  await expect(page.locator('#lineStyleStrokeLabel')).toHaveText('Zipper width');
  await expect(page.locator('#lineStyleColorRow')).toBeVisible();
  await expect(page.locator('#lineStyleZipperColors [data-zipper-color]')).toHaveCount(3);
  await expect(page.locator('.color-swatches').first().locator('[data-color]')).toHaveCount(3);
  await expect(
    page.locator('.color-swatches').first().locator('[data-palette-toggle]')
  ).toHaveCount(0);
  await page.locator('#lineStyleZipperColors [data-zipper-color="#6b7280"]').click();
  await page.keyboard.press('Escape');

  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) return;

  await page.mouse.move(bounds.x + bounds.width * 0.24, bounds.y + bounds.height * 0.34);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.72, bounds.y + bounds.height * 0.48, {
    steps: 8,
  });
  await page.mouse.up();

  await page.locator('#lineStylePopoverBtn').click();
  await page.locator('[data-line-geometry="curve"]').click();
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.app?.toolManager?.tools?.curve?.setRepeatMode?.(true));
  await page.mouse.click(bounds.x + bounds.width * 0.27, bounds.y + bounds.height * 0.68);
  await page.mouse.click(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.56);
  await page.mouse.dblclick(bounds.x + bounds.width * 0.73, bounds.y + bounds.height * 0.7, {
    delay: 35,
  });

  const beforeRestore = await page.evaluate(() => {
    const objects = window.app?.canvasManager?.fabricCanvas?.getObjects?.() || [];
    return objects
      .filter((object: any) => object?.isZipper === true || object?.customType === 'zipper')
      .map((zipper: any) => ({
        objectType: zipper.type,
        customType: zipper.customType,
        lineStyle: zipper.lineStyle,
        arrows: {
          start: zipper.arrowSettings?.startArrow,
          end: zipper.arrowSettings?.endArrow,
        },
        hasRenderer: zipper._arrowRenderingAttached === true,
        hasMetadata: Boolean(zipper.strokeMetadata),
        customPoints: zipper.customPoints?.length || 0,
      }));
  });
  expect(beforeRestore).toHaveLength(2);
  expect(beforeRestore).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        objectType: 'line',
        customType: 'zipper',
        lineStyle: 'zipper',
        arrows: { start: false, end: false },
        hasRenderer: true,
        hasMetadata: false,
      }),
      expect.objectContaining({
        objectType: 'path',
        customType: 'zipper',
        lineStyle: 'zipper',
        arrows: { start: false, end: false },
        hasRenderer: true,
        hasMetadata: false,
        customPoints: 3,
      }),
    ])
  );
  expect(
    await page.evaluate(() =>
      window.app?.canvasManager?.fabricCanvas
        ?.getObjects?.()
        .filter((object: any) => object?.isZipper === true)
        .every((object: any) => object.stroke === '#6b7280')
    )
  ).toBe(true);

  const renderLeak = await page.evaluate(() => {
    const canvas = window.app?.canvasManager?.fabricCanvas;
    const zippers = canvas
      ?.getObjects?.()
      .filter((object: any) => object?.isZipper === true || object?.customType === 'zipper');
    if (!canvas || !zippers?.length) return null;

    const objects = canvas.getObjects();
    const visibility = objects.map((object: any) => object.visible !== false);
    const backgroundColor = canvas.backgroundColor;
    const backgroundImage = canvas.backgroundImage;
    objects.forEach((object: any) => {
      object.visible = zippers.includes(object);
    });
    canvas.backgroundColor = '';
    canvas.backgroundImage = null;
    canvas.discardActiveObject();
    canvas.renderAll();

    const rects = zippers.map((zipper: any) => zipper.getBoundingRect());
    const context = canvas.lowerCanvasEl.getContext('2d', { willReadFrequently: true });
    const pixels = context?.getImageData(
      0,
      0,
      canvas.lowerCanvasEl.width,
      canvas.lowerCanvasEl.height
    ).data;
    let outsidePixels = 0;
    if (pixels) {
      const padding = 30;
      for (let y = 0; y < canvas.lowerCanvasEl.height; y += 1) {
        for (let x = 0; x < canvas.lowerCanvasEl.width; x += 1) {
          const insideAny = rects.some(
            (rect: any) =>
              x >= rect.left - padding &&
              x <= rect.left + rect.width + padding &&
              y >= rect.top - padding &&
              y <= rect.top + rect.height + padding
          );
          if (insideAny) continue;
          if (pixels[(y * canvas.lowerCanvasEl.width + x) * 4 + 3] > 8) outsidePixels += 1;
        }
      }
    }

    objects.forEach((object: any, index: number) => {
      object.visible = visibility[index];
    });
    canvas.backgroundColor = backgroundColor;
    canvas.backgroundImage = backgroundImage;
    canvas.renderAll();
    return { outsidePixels };
  });
  expect(renderLeak).toEqual({ outsidePixels: 0 });
  await expect(page.locator('#elementsMeasurementCount')).toHaveText('0');

  const afterRestore = await page.evaluate(async () => {
    const manager = window.app?.canvasManager;
    const json = manager?.toJSON?.();
    await new Promise<void>(resolve => manager?.loadFromJSON?.(json, resolve));
    return manager?.fabricCanvas
      ?.getObjects?.()
      .filter((object: any) => object?.isZipper === true || object?.customType === 'zipper')
      .map((zipper: any) => ({
        objectType: zipper.type,
        lineStyle: zipper.lineStyle,
        hasRenderer: zipper._arrowRenderingAttached === true,
        controlCount: Object.keys(zipper.controls || {}).length,
      }));
  });
  expect(afterRestore).toHaveLength(2);
  expect(afterRestore?.every((zipper: any) => zipper.lineStyle === 'zipper')).toBe(true);
  expect(afterRestore?.every((zipper: any) => zipper.hasRenderer)).toBe(true);
  expect(afterRestore?.every((zipper: any) => zipper.controlCount >= 2)).toBe(true);
});

test('zipper is a compact pattern and leaving it restores the normal palette', async ({
  appPage: page,
}) => {
  await page.locator('#lineStylePopoverBtn').click();
  await page.locator('#lineStylePatternSelect').selectOption('zipper');

  const compactLayout = await page.locator('#lineStylePopoverPanel').evaluate(panel => {
    const preview = panel.querySelector<HTMLElement>('#lineStylePreviewWrap');
    const rect = panel.getBoundingClientRect();
    return {
      width: rect.width,
      previewHeight: preview?.getBoundingClientRect().height || 0,
    };
  });
  expect(compactLayout.width).toBeLessThanOrEqual(412);
  expect(compactLayout.previewHeight).toBeLessThanOrEqual(30);

  await page.locator('#lineStylePatternSelect').selectOption('solid');
  await expect(page.locator('#lineStyleArrowStyleRow')).toBeVisible();
  await expect(page.locator('#lineStyleColorRow')).toBeHidden();
  await expect(page.locator('.color-swatches').first().locator('[data-color]')).toHaveCount(8);
  await expect(
    page.locator('.color-swatches').first().locator('[data-palette-toggle]')
  ).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Zipper', exact: true })).toHaveCount(0);
});
