import { test, expect, resizeViewport, uploadTestImage, selectTool, drawLine } from './fixtures';
import type { Page } from '@playwright/test';

type Rect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

async function rect(page: Page, selector: string): Promise<Rect> {
  return page.locator(selector).evaluate(element => {
    const value = element.getBoundingClientRect();
    return {
      left: value.left,
      top: value.top,
      right: value.right,
      bottom: value.bottom,
      width: value.width,
      height: value.height,
    };
  });
}

function expectSameRect(before: Rect, after: Rect): void {
  for (const key of ['left', 'top', 'width', 'height'] as const) {
    expect(Math.abs(before[key] - after[key]), `${key} should remain stable`).toBeLessThan(1);
  }
}

async function expandInspectors(page: Page): Promise<void> {
  if (!(await page.locator('#elementsBody').isVisible())) {
    await page.locator('#toggleStrokePanel').click();
    await expect(page.locator('#elementsBody')).toBeVisible();
  }
  if (!(await page.locator('#imagePanelContent').isVisible())) {
    await page.locator('#toggleImagePanel').click();
    await expect(page.locator('#imagePanelContent')).toBeVisible();
  }
  await page.waitForTimeout(350);
}

test.describe('Unified workstation controls', () => {
  test('unit and format segments keep their geometry and restore the inch preference', async ({
    appPage: page,
  }) => {
    await expandInspectors(page);
    const unitBefore = await rect(page, '#unitToggleBtnSecondary');
    const formatBefore = await rect(page, '#inchDisplayToggleBtnSecondary');
    const framesBefore = await rect(page, '#elementsFrameToggleBtn');

    await page.locator('[data-unit="cm"]').click();
    await expect(page.locator('[data-unit="cm"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-inch-display="decimal"]')).toBeDisabled();
    await expect(page.locator('[data-inch-display="fraction"]')).toBeDisabled();

    const unitAfterCm = await rect(page, '#unitToggleBtnSecondary');
    const formatAfterCm = await rect(page, '#inchDisplayToggleBtnSecondary');
    expectSameRect(unitBefore, unitAfterCm);
    expectSameRect(formatBefore, formatAfterCm);
    expectSameRect(framesBefore, await rect(page, '#elementsFrameToggleBtn'));

    await page.locator('[data-unit="inch"]').click();
    await page.locator('[data-inch-display="fraction"]').click();
    await expect(page.locator('[data-inch-display="fraction"]')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await page.locator('[data-unit="cm"]').click();
    await page.locator('[data-unit="inch"]').click();
    await expect(page.locator('[data-inch-display="fraction"]')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  test('the full Next Tag surface focuses, commits, restores, and rejects invalid input', async ({
    appPage: page,
  }) => {
    await expandInspectors(page);
    const surface = page.locator('.elements-field-copy');
    const input = page.locator('#nextTagDisplay');

    await surface.click({ position: { x: 18, y: 10 } });
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('nextTagDisplay');

    await input.fill('B7');
    await input.press('Enter');
    await expect(input).toHaveValue('B7');

    await input.click();
    await input.fill('C3');
    await input.press('Escape');
    await expect(input).toHaveValue('B7');

    await input.click();
    await input.fill('not-a-tag');
    await input.press('Enter');
    await expect(input).toHaveValue('Invalid');
    await expect(input).toHaveValue('B7', { timeout: 2_000 });
  });

  test('collapsed Elements keeps a compact measurement entry available', async ({
    appPage: page,
  }) => {
    await resizeViewport(page, 1024, 768);
    await expandInspectors(page);
    await uploadTestImage(page, 900, 600, '#dbeafe');
    await page.locator('#toggleStrokePanel').click();
    await expect(page.locator('#elementsBody')).toBeHidden();

    await selectTool(page, 'line');
    await drawLine(page, 150, 210, 470, 210);

    const quickEntry = page.locator('#quickMeasurementEntry');
    const quickInput = page.locator('#quickMeasurementValue');
    await expect(quickEntry).toBeVisible();
    await expect(page.locator('#quickMeasurementLabel')).toHaveText('A1');
    await expect(quickInput).toBeFocused();
    await quickInput.fill('42');
    await quickInput.press('Enter');

    await page.locator('#toggleStrokePanel').click();
    await expect(page.locator('#elementsBody')).toBeVisible();
    await expect(
      page.locator('.stroke-visibility-item[data-stroke="A1"] .stroke-measurement')
    ).toContainText('42');
  });

  test('palette and account controls stay above and clear of canvas content', async ({
    appPage: page,
  }) => {
    await resizeViewport(page, 1280, 800);
    const toggle = page.locator('.color-palette-toggle');
    await expect(toggle).toBeVisible();
    const paletteLayout = await page.evaluate(() => {
      const toggleElement = document.querySelector<HTMLElement>('.color-palette-toggle')!;
      const toggleRect = toggleElement.getBoundingClientRect();
      const swatches = Array.from(
        document.querySelectorAll<HTMLElement>('.color-swatches button:not(.color-palette-toggle)')
      ).filter(element => getComputedStyle(element).display !== 'none');
      return {
        toggle: { left: toggleRect.left, right: toggleRect.right, width: toggleRect.width },
        swatchRight: Math.max(...swatches.map(element => element.getBoundingClientRect().right)),
      };
    });
    expect(paletteLayout.toggle.width).toBeGreaterThanOrEqual(50);
    expect(paletteLayout.toggle.left).toBeGreaterThanOrEqual(paletteLayout.swatchRight + 2);

    await page.evaluate(() => {
      const userArea = document.getElementById('authUserArea');
      if (userArea) userArea.style.display = 'flex';
    });
    await page.locator('#authUserArea').click();
    const authMenu = page.locator('body > .auth-menu-panel');
    await expect(authMenu).toBeVisible();
    const menuLayer = await authMenu.evaluate(element => ({
      zIndex: Number(getComputedStyle(element).zIndex),
      parent: element.parentElement?.tagName,
      top: element.getBoundingClientRect().top,
    }));
    expect(menuLayer.parent).toBe('BODY');
    expect(menuLayer.zIndex).toBeGreaterThan(10_000);
    expect(menuLayer.top).toBeGreaterThanOrEqual(48);
  });

  for (const [width, height] of [
    [1440, 900],
    [1280, 800],
    [1024, 768],
  ] as const) {
    test(`keeps toolbar, inspectors, and dock coherent at ${width}x${height}`, async ({
      appPage: page,
    }) => {
      await resizeViewport(page, width, height);
      await expandInspectors(page);
      const layout = await page.evaluate(() => {
        const read = (selector: string) => {
          const element = document.querySelector(selector);
          if (!(element instanceof HTMLElement)) return null;
          const r = element.getBoundingClientRect();
          return {
            left: r.left,
            top: r.top,
            right: r.right,
            bottom: r.bottom,
            width: r.width,
            height: r.height,
          };
        };
        const dockChildren = Array.from(
          document.querySelectorAll<HTMLElement>(
            '#canvasControlsContent > button, #canvasControlsContent > div:not([hidden])'
          )
        )
          .filter(element => getComputedStyle(element).display !== 'none')
          .map(element => element.getBoundingClientRect().height)
          .filter(value => value > 0);
        return {
          viewport: { width: innerWidth, height: innerHeight },
          toolbar: read('#topToolbar'),
          toolbarWrap: read('#toolbarWrap'),
          leftCommands: read('#tbLeft'),
          rightCommands: read('#tbRight'),
          elements: read('#strokePanel'),
          images: read('#imagePanel'),
          dock: read('#canvasControls'),
          dockChildren,
          toolbarWraps: getComputedStyle(document.getElementById('toolbarWrap')!).flexWrap,
        };
      });

      expect(layout.toolbar?.height).toBeLessThanOrEqual(49);
      expect(layout.toolbarWrap?.height).toBeLessThanOrEqual(49);
      expect(layout.toolbarWraps).toBe('nowrap');
      expect(layout.leftCommands?.bottom).toBeLessThanOrEqual((layout.toolbar?.bottom || 48) + 1);
      expect(layout.rightCommands?.bottom).toBeLessThanOrEqual((layout.toolbar?.bottom || 48) + 1);
      expect(layout.rightCommands?.left).toBeGreaterThanOrEqual(
        (layout.leftCommands?.right || 0) - 1
      );

      expect(layout.elements?.left).toBeGreaterThanOrEqual(-1);
      expect(layout.images?.right).toBeLessThanOrEqual(width + 1);
      expect(layout.dock?.left).toBeGreaterThanOrEqual(0);
      expect(layout.dock?.right).toBeLessThanOrEqual(width);
      expect(layout.dock?.bottom).toBeLessThanOrEqual(height);
      expect(layout.dock?.height).toBeLessThanOrEqual(43);
      expect(layout.dockChildren.every(value => value >= 30 && value <= 34)).toBe(true);

      await expect(page).toHaveScreenshot(`workstation-empty-${width}x${height}.png`, {
        animations: 'disabled',
      });
    });
  }

  test('keeps the populated workstation visually coherent', async ({ appPage: page }) => {
    await resizeViewport(page, 1280, 800);
    await expandInspectors(page);
    await uploadTestImage(page, 900, 600, '#dbeafe');
    await selectTool(page, 'line');
    await drawLine(page, 120, 180, 520, 180);
    await expect(page.locator('#elementsMeasurementCount')).toHaveText('1');
    await expect(page.locator('#imagesVisibleSummary')).toHaveText('1');
    await expect(page).toHaveScreenshot('workstation-populated-1280x800.png', {
      animations: 'disabled',
    });
  });
});
