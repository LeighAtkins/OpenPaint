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
  test('save hover menu escapes the compact dock and remains clickable', async ({
    appPage: page,
  }) => {
    const saveRoot = page.locator('#quickSave');
    const menu = page.locator('#quickSaveMenu');
    await saveRoot.hover();
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-action="pdf"]')).toBeVisible();
    expect(await menu.evaluate(element => element.parentElement === document.body)).toBe(true);
    const menuRect = await rect(page, '#quickSaveMenu');
    const buttonRect = await rect(page, '#quickSaveBtn');
    expect(menuRect.bottom).toBeLessThanOrEqual(buttonRect.top - 4);
  });

  test('cloud project hover menu escapes the compact dock', async ({ appPage: page }) => {
    const cloudRoot = page.locator('#canvasCloudMenu');
    const panel = page.locator('.cloud-save-menu-panel');
    await cloudRoot.evaluate(element => {
      element.style.display = 'block';
    });
    await expect(cloudRoot).toBeVisible();
    await cloudRoot.hover();
    await expect(panel).toBeVisible();
    await expect(panel.locator('#canvasMyProjectsBtn')).toBeVisible();
    expect(await panel.evaluate(element => element.parentElement === document.body)).toBe(true);
    const panelRect = await rect(page, '.cloud-save-menu-panel');
    const buttonRect = await rect(page, '#canvasCloudSaveBtn');
    expect(panelRect.bottom).toBeLessThanOrEqual(buttonRect.top - 4);
  });

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
    await resizeViewport(page, 836, 763);
    if (!(await page.locator('#elementsBody').isVisible())) {
      await page.locator('#toggleStrokePanel').click();
      await expect(page.locator('#elementsBody')).toBeVisible();
    }
    await uploadTestImage(page, 900, 600, '#dbeafe');
    await page.locator('#toggleStrokePanel').click();
    await expect(page.locator('#elementsBody')).toBeHidden();

    await selectTool(page, 'line');
    await drawLine(page, 150, 210, 470, 210);

    const quickEntry = page.locator('#quickMeasurementEntry');
    const quickInput = page.locator('#quickMeasurementValue');
    await expect(quickEntry).toBeVisible();
    const quickLabel = page.locator('#quickMeasurementLabel');
    await expect(quickLabel).toHaveValue('A1');
    await expect(quickInput).toBeFocused();

    const compactEntry = await quickEntry.evaluate(element => {
      const input = element.querySelector<HTMLInputElement>('#quickMeasurementValue')!;
      return {
        fontSize: Number.parseFloat(getComputedStyle(input).fontSize),
        fractionControls: element.querySelectorAll('[data-inch-display]').length,
      };
    });
    expect(compactEntry.fontSize).toBeGreaterThanOrEqual(16);
    expect(compactEntry.fractionControls).toBe(0);

    const quickCm = quickEntry.locator('[data-quick-unit="cm"]');
    const quickIn = quickEntry.locator('[data-quick-unit="inch"]');
    await expect(quickIn).toHaveAttribute('aria-pressed', 'true');
    await quickCm.click();
    await expect(quickCm).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => window.app?.currentUnit)).toBe('cm');

    await quickLabel.click();
    await quickLabel.fill('B2');
    await quickLabel.press('Enter');
    await expect(quickLabel).toHaveValue('B2');
    await expect(quickInput).toHaveAttribute('aria-label', 'Measurement for B2');

    await quickInput.click();
    await quickInput.fill('42');
    await quickInput.press('Enter');
    await expect(quickInput).not.toBeFocused();

    await page.locator('#toggleStrokePanel').click();
    await expect(page.locator('#elementsBody')).toBeVisible();
    await expect(
      page.locator('.stroke-visibility-item[data-stroke="B2"] .stroke-measurement')
    ).toContainText('42');
  });

  test('backslash exits a focused quick measurement field and toggles guide split', async ({
    appPage: page,
  }) => {
    await resizeViewport(page, 836, 763);
    await uploadTestImage(page, 900, 600, '#dbeafe');
    if (await page.locator('#elementsBody').isVisible()) {
      await page.locator('#toggleStrokePanel').click();
    }
    await selectTool(page, 'line');
    await drawLine(page, 150, 210, 470, 210);

    const quickInput = page.locator('#quickMeasurementValue');
    await expect(quickInput).toBeFocused();
    await quickInput.press('Backslash');

    await expect(quickInput).not.toBeFocused();
    await expect(page.locator('#main-canvas-wrapper')).toHaveClass(/guide-split-active/);
  });

  test('compact drawing submenus open beside the parent and tolerate diagonal travel', async ({
    appPage: page,
  }) => {
    await resizeViewport(page, 836, 763);

    const caret = page.locator('#topToolbar #drawingModeToggle:visible .shape-icon');
    await expect(caret).toHaveCount(1);
    await caret.click();

    const textTrigger = page.locator('#topToolbar #textModeWrapper:visible > #textModeToggle');
    await expect(textTrigger).toHaveCount(1);
    const textFlyout = page.locator('#topToolbar #textModeWrapper:visible');
    await textFlyout.dispatchEvent('mouseenter');

    const textMenu = page.locator('#topToolbar #textModeWrapper:visible > #textModeMenu');
    await expect(textMenu).toBeVisible();
    const triggerRect = await textTrigger.boundingBox();
    const menuRect = await textMenu.boundingBox();
    expect(triggerRect).not.toBeNull();
    expect(menuRect).not.toBeNull();
    expect(menuRect!.x).toBeGreaterThanOrEqual(triggerRect!.x + triggerRect!.width + 4);

    await page.mouse.move(
      triggerRect!.x + triggerRect!.width - 4,
      triggerRect!.y + triggerRect!.height / 2
    );
    await page.mouse.move(menuRect!.x + 12, menuRect!.y + 18, { steps: 8 });
    await expect(textMenu).toBeVisible();
  });

  test('Images remains a clear, openable rail after resizing up from mobile', async ({
    appPage: page,
  }) => {
    await resizeViewport(page, 700, 760);
    await resizeViewport(page, 1065, 645);

    const panel = page.locator('#imagePanel');
    const toggle = page.locator('#toggleImagePanel');
    const label = page.locator('#imagePanel > .image-name-container');
    await expect(panel).toHaveAttribute('aria-expanded', 'false');
    await expect(label).toBeHidden();
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-label', 'Open Images panel');

    const collapsed = await rect(page, '#imagePanel');
    expect(collapsed.width).toBeLessThanOrEqual(50);
    await toggle.click();

    await expect(panel).toHaveAttribute('aria-expanded', 'true');
    await expect(label).toBeVisible();
    await expect(page.locator('#imagePanelContent')).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-label', 'Close Images panel');
    expect((await rect(page, '#imagePanel')).width).toBeGreaterThan(240);
  });

  test('collapsed inspector resize centers the portrait frame and rendered image together', async ({
    appPage: page,
  }) => {
    await resizeViewport(page, 1111, 752);
    await expandInspectors(page);
    await uploadTestImage(page, 720, 1280, '#d8cab8');

    await page.locator('#toggleStrokePanel').click();
    await expect(page.locator('#elementsBody')).toBeHidden();
    await page.waitForTimeout(800);

    const alignment = await page.evaluate(() => {
      const frame = document.getElementById('captureFrame')!.getBoundingClientRect();
      const leftPanel = document.getElementById('strokePanel')!.getBoundingClientRect();
      const rightPanel = document.getElementById('imagePanel')!.getBoundingClientRect();
      const canvas = window.app!.canvasManager.fabricCanvas;
      const background = canvas.backgroundImage;
      const canvasRect = canvas.lowerCanvasEl.getBoundingClientRect();
      const mappedCenter = window.fabric.util.transformPoint(
        background.getCenterPoint(),
        canvas.viewportTransform
      );
      const preferredCenterX = (leftPanel.right + 16 + rightPanel.left - 16) / 2;
      const frameCenterX = frame.left + frame.width / 2;
      const frameCenterY = frame.top + frame.height / 2;
      return {
        frameCenterDelta: Math.abs(frameCenterX - preferredCenterX),
        imageCenterDeltaX: Math.abs(canvasRect.left + mappedCenter.x - frameCenterX),
        imageCenterDeltaY: Math.abs(canvasRect.top + mappedCenter.y - frameCenterY),
      };
    });

    expect(alignment.frameCenterDelta).toBeLessThanOrEqual(3);
    expect(alignment.imageCenterDeltaX).toBeLessThanOrEqual(3);
    expect(alignment.imageCenterDeltaY).toBeLessThanOrEqual(3);
  });

  test('Style and tag Appearance share one docked or floating control surface', async ({
    appPage: page,
  }) => {
    await resizeViewport(page, 1111, 752);
    if (!(await page.locator('#elementsBody').isVisible())) {
      await page.locator('#toggleStrokePanel').click();
      await expect(page.locator('#elementsBody')).toBeVisible();
    }

    await page.locator('#lineStylePopoverBtn').click();
    await expect(page.locator('#elementsAppearance')).toHaveAttribute('open', '');
    await expect(
      page.locator('#elementsStrokeAppearanceMount .line-style-panel-grid')
    ).toBeVisible();
    await expect(page.locator('#elementsAppearance #currentTagSize')).toBeVisible();

    await page.locator('#toggleStrokePanel').click();
    await expect(page.locator('#elementsBody')).toBeHidden();
    await page.locator('#lineStylePopoverBtn').click();

    const floating = page.locator('#lineStylePopoverPanel');
    await expect(floating).toHaveClass(/open/);
    await expect(floating.locator('#brushSize')).toBeVisible();
    await expect(floating.locator('#currentTagSize')).toBeVisible();
  });

  test('Elements controls scroll independently when Appearance exceeds a short viewport', async ({
    appPage: page,
  }) => {
    await resizeViewport(page, 1453, 634);
    if (!(await page.locator('#elementsBody').isVisible())) {
      await page.locator('#toggleStrokePanel').click();
    }

    await page.locator('#lineStylePopoverBtn').click();
    await expect(page.locator('#elementsAppearance')).toHaveAttribute('open', '');

    const controls = page.locator('#elementsControls');
    const metrics = await controls.evaluate(element => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      overflowY: getComputedStyle(element).overflowY,
    }));
    expect(metrics.overflowY).toBe('auto');
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);

    await controls.evaluate(element => {
      element.scrollTop = element.scrollHeight;
    });
    await expect.poll(() => controls.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await expect(page.locator('#labelBackgroundToggleBtn')).toBeVisible();
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
