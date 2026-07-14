import { test, expect, selectTool, uploadTestImage, drawLine } from './fixtures';
import type { Page } from '@playwright/test';

async function framePoints(page: Page) {
  return page.evaluate(() => {
    const frame = document.getElementById('captureFrame')!.getBoundingClientRect();
    return {
      outside: { x: frame.left - 12, y: frame.top + frame.height / 2 },
      a: { x: frame.left + frame.width * 0.25, y: frame.top + frame.height * 0.35 },
      b: { x: frame.left + frame.width * 0.5, y: frame.top + frame.height * 0.62 },
      c: { x: frame.left + frame.width * 0.75, y: frame.top + frame.height * 0.35 },
    };
  });
}

async function drawCurve(page: Page) {
  const points = await framePoints(page);
  await page.mouse.click(points.a.x, points.a.y);
  await page.mouse.click(points.b.x, points.b.y);
  await page.mouse.dblclick(points.c.x, points.c.y, { delay: 35 });
}

test.describe('curved-line interactions', () => {
  test('Tab cycles through drawing tools, including away from idle Text', async ({
    appPage: page,
  }) => {
    await selectTool(page, 'line');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());

    for (const expectedTool of ['curve', 'privacy', 'select', 'line']) {
      await page.keyboard.press('Tab');
      await expect
        .poll(() => page.evaluate(() => window.app!.toolManager.activeToolName))
        .toBe(expectedTool);
    }

    await selectTool(page, 'text');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await page.keyboard.press('Tab');
    await expect
      .poll(() => page.evaluate(() => window.app!.toolManager.activeToolName))
      .toBe('line');
  });

  test('Tab still cycles after the line-width number control was focused', async ({
    appPage: page,
  }) => {
    await selectTool(page, 'line');
    const widthInput = page.locator('#brushSize:visible').first();
    await widthInput.focus();
    await page.keyboard.press('Tab');
    await expect
      .poll(() => page.evaluate(() => window.app!.toolManager.activeToolName))
      .toBe('curve');
  });

  test('does not begin a curve outside the capture frame', async ({ appPage: page }) => {
    await uploadTestImage(page);
    await selectTool(page, 'curve');
    await page.evaluate(async () => {
      const curve = await window.app!.toolManager.ensureTool('curve');
      curve.setRepeatMode(false);
    });

    const { outside } = await framePoints(page);
    await page.mouse.click(outside.x, outside.y);

    const state = await page.evaluate(() => {
      const curve = window.app!.toolManager.tools.curve;
      return {
        points: curve.points.length,
        markers: window
          .app!.canvasManager.fabricCanvas.getObjects()
          .filter((object: any) => object.isCurveDrawingMarker).length,
      };
    });
    expect(state).toEqual({ points: 0, markers: 0 });
  });

  test('returns to straight line after one completed curve', async ({ appPage: page }) => {
    await uploadTestImage(page);
    await selectTool(page, 'curve');
    await page.evaluate(async () => {
      const curve = await window.app!.toolManager.ensureTool('curve');
      curve.setRepeatMode(false);
    });

    await drawCurve(page);
    await expect
      .poll(() => page.evaluate(() => window.app!.toolManager.activeToolName))
      .toBe('line');
    await expect
      .poll(() =>
        page.evaluate(() => ({
          lineActive: Array.from(
            document.querySelectorAll<HTMLElement>('[data-drawing-mode="line"]')
          ).every(option => option.classList.contains('active')),
          curveActive: Array.from(
            document.querySelectorAll<HTMLElement>('[data-drawing-mode="curve"]')
          ).some(option => option.classList.contains('active')),
        }))
      )
      .toEqual({ lineActive: true, curveActive: false });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window
              .app!.canvasManager.fabricCanvas.getObjects()
              .filter((object: any) => object.type === 'path' && object.strokeMetadata).length
        )
      )
      .toBe(1);
  });

  test('double-clicking Curved Line latches repeat mode', async ({ appPage: page }) => {
    await uploadTestImage(page);
    await page.locator('#topToolbar #drawingModeToggle:visible').first().click();
    await page.locator('#topToolbar [data-drawing-mode="curve"]:visible').first().dblclick();
    await expect
      .poll(() =>
        page.evaluate(() => ({
          active: window.app!.toolManager.activeToolName,
          repeat: window.app!.toolManager.tools.curve?.repeatMode,
        }))
      )
      .toEqual({ active: 'curve', repeat: true });

    await drawCurve(page);
    await expect
      .poll(() => page.evaluate(() => window.app!.toolManager.activeToolName))
      .toBe('curve');
  });

  test('Option-drag bends a straight line without losing its measurement identity', async ({
    appPage: page,
  }) => {
    await uploadTestImage(page);
    await selectTool(page, 'line');
    await page.evaluate(() => window.app!.toolManager.tools.line.setWidth(10));
    await drawLine(page, 120, 220, 520, 220);
    await expect
      .poll(() => page.evaluate(() => window.app!.tagManager.tagObjects.size))
      .toBeGreaterThan(0);

    const before = await page.evaluate(() => {
      const manager = window.app!.metadataManager;
      const scope = Object.keys(manager.vectorStrokesByImage).find(key =>
        Object.prototype.hasOwnProperty.call(manager.vectorStrokesByImage[key] || {}, 'A1')
      )!;
      manager.parseAndSaveMeasurement(scope, 'A1', '24 cm');
      const line = manager.vectorStrokesByImage[scope].A1;
      line.arrowSettings = {
        ...(line.arrowSettings || {}),
        startArrow: true,
        endArrow: true,
        arrowStyle: 'triangle',
      };
      window.app!.arrowManager.attachArrowRendering(line);
      const tag = window.app!.tagManager.getTagObject('A1', scope)?.tagObj;
      const endpoints = window.app!.arrowManager.getLineWorldEndpoints(line);
      const canvas = window.app!.canvasManager.fabricCanvas;
      const rect = canvas.upperCanvasEl.getBoundingClientRect();
      const vpt = canvas.viewportTransform;
      const start = fabric.util.transformPoint(new fabric.Point(endpoints.x1, endpoints.y1), vpt);
      const end = fabric.util.transformPoint(new fabric.Point(endpoints.x2, endpoints.y2), vpt);
      return {
        scope,
        tagPosition: { left: tag?.left, top: tag?.top },
        midpoint: {
          x: rect.left + (start.x + end.x) / 2,
          y: rect.top + (start.y + end.y) / 2,
        },
      };
    });

    await page.keyboard.down('Alt');
    await page.mouse.move(before.midpoint.x, before.midpoint.y);
    await page.mouse.down();
    await page.mouse.move(before.midpoint.x, before.midpoint.y + 90, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up('Alt');

    const result = await page.evaluate(scope => {
      const manager = window.app!.metadataManager;
      const stroke = manager.vectorStrokesByImage[scope]?.A1;
      const tag = window.app!.tagManager.getTagObject('A1', scope)?.tagObj;
      return {
        type: stroke?.type,
        points: stroke?.customPoints?.length,
        measurement: manager.strokeMeasurements[scope]?.A1,
        tagConnected: tag?.connectedStroke === stroke,
        tagPosition: { left: tag?.left, top: tag?.top },
        arrows: {
          start: stroke?.arrowSettings?.startArrow,
          end: stroke?.arrowSettings?.endArrow,
          curve: stroke?.arrowSettings?.curveArrows,
        },
        lineCount: window
          .app!.canvasManager.fabricCanvas.getObjects()
          .filter(
            (object: any) => object.type === 'line' && object.strokeMetadata?.strokeLabel === 'A1'
          ).length,
      };
    }, before.scope);

    expect(result.type).toBe('path');
    expect(result.points).toBe(3);
    expect(JSON.stringify(result.measurement)).toContain('24');
    expect(result.tagConnected).toBe(true);
    expect(result.tagPosition.left).toBeCloseTo(before.tagPosition.left, 4);
    expect(result.tagPosition.top).toBeCloseTo(before.tagPosition.top, 4);
    expect(result.arrows).toEqual({ start: true, end: true, curve: true });
    expect(result.lineCount).toBe(0);
  });
});
