import { test, expect, waitForApp } from './fixtures';

test.describe('Measurement field layout', () => {
  test('value stays on one line and fills the available measurement row', async ({
    appPage: page,
  }) => {
    await waitForApp(page);

    await page.evaluate(async () => {
      const app = window.app;
      const canvas = app?.canvasManager?.fabricCanvas;
      const metadata = app?.metadataManager;
      const fabricApi = (window as any).fabric;
      if (!canvas || !metadata || !fabricApi) throw new Error('OpenPaint canvas is unavailable');

      const viewId = app.projectManager.currentViewId || 'front';
      const scope = metadata.resolveActiveImageLabel(viewId);
      const line = new fabricApi.Line([80, 120, 480, 120], {
        stroke: '#2563eb',
        strokeWidth: 2,
      });
      canvas.add(line);
      metadata.attachMetadata(line, scope, 'A1');
      metadata.setMeasurement(scope, 'A1', {
        cm: 123456.789,
        inch: 48605.035,
        inchWhole: 48605,
        inchFraction: 0.035,
        inputUnit: 'cm',
      });
      const strokePanel = document.getElementById('strokePanel');
      const elementsBody = document.getElementById('elementsBody');
      strokePanel?.classList.remove('minimized', 'collapsed');
      strokePanel?.setAttribute('aria-expanded', 'true');
      elementsBody?.classList.remove('hidden');
      if (elementsBody) elementsBody.style.display = 'flex';
      await new Promise(resolve => window.setTimeout(resolve, 180));
      metadata.updateStrokeVisibilityControls();
    });

    const field = page.locator('[data-stroke="A1"] .stroke-measurement');
    await expect(field).toBeVisible();
    await expect(field).toHaveAttribute('aria-multiline', 'false');

    const layout = await field.evaluate(element => {
      const style = getComputedStyle(element);
      const row = element.closest('.stroke-visibility-item')?.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      return {
        whiteSpace: style.whiteSpace,
        overflowX: style.overflowX,
        fontSize: Number.parseFloat(style.fontSize),
        fieldWidth: rect.width,
        rowWidth: row?.width || 0,
        height: rect.height,
      };
    });

    expect(layout.whiteSpace).toBe('nowrap');
    expect(layout.overflowX).toBe('auto');
    expect(layout.fontSize).toBeGreaterThanOrEqual(18);
    expect(layout.fieldWidth).toBeGreaterThan(layout.rowWidth * 0.4);
    expect(layout.height).toBeGreaterThanOrEqual(34);
  });
});
