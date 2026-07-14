import { test, expect, uploadTestImage, selectTool, drawLine } from './fixtures';
import type { Page } from '@playwright/test';

type TagState = {
  mode: string;
  text: string;
  backgroundStyle: string;
  frosted: boolean;
  fill: string;
};

async function readTagState(page: Page): Promise<TagState> {
  return page.evaluate(() => {
    const manager = window.app?.tagManager;
    const canvas = window.app?.canvasManager?.fabricCanvas;
    const tag =
      (canvas
        ?.getObjects?.()
        .find((object: any) => object.isTagGroup && object.strokeLabel === 'A1') as any) ||
      (manager?.getTagObject?.('A1', window.currentImageLabel)?.tagObj as any);
    const objects = tag?.getObjects?.() || [];
    const text = objects.find((object: any) => object.isTagText);
    const background = objects.find((object: any) => object.isTagBackground);
    return {
      mode: manager?.tagDisplayMode || '',
      text: text?.text || '',
      backgroundStyle: tag?.resolvedTagStyle?.backgroundStyle || '',
      frosted: background?.isFrostedTagBackground === true,
      fill: String(background?.fill || ''),
    };
  });
}

async function expandElements(page: Page): Promise<void> {
  if (!(await page.locator('#elementsBody').isVisible())) {
    await page.locator('#toggleStrokePanel').click();
    await expect(page.locator('#elementsBody')).toBeVisible();
  }
}

test.describe('Three-state tag display', () => {
  test('cycles contextual, labels-only and frosted measurements-only text', async ({
    appPage: page,
  }) => {
    await uploadTestImage(page, 900, 600, '#dbeafe');
    await expandElements(page);
    await page.locator('[data-unit="cm"]').click();
    await selectTool(page, 'line');
    await drawLine(page, 150, 220, 520, 220);
    await page.waitForFunction(() => Boolean(window.app?.tagManager));
    await page.evaluate(() => {
      const manager = window.app!.metadataManager;
      const scope = manager.resolveActiveImageLabel(window.app!.projectManager.currentViewId);
      manager.parseAndSaveMeasurement(scope, 'A1', '24.5 cm');
    });

    await expect
      .poll(() => readTagState(page))
      .toMatchObject({
        mode: 'contextual',
        text: 'A1 = 24.5 cm',
        backgroundStyle: 'solid',
        frosted: false,
      });

    const toggle = page.locator('#toggleShowMeasurements');
    await toggle.click();
    await expect(toggle).toHaveAttribute('data-tag-mode', 'labels-only');
    await expect
      .poll(() => readTagState(page))
      .toMatchObject({
        mode: 'labels-only',
        text: 'A1',
        backgroundStyle: 'solid',
        frosted: false,
      });

    await toggle.click();
    await expect(toggle).toHaveAttribute('data-tag-mode', 'measurements-only');
    await expect
      .poll(() => readTagState(page))
      .toMatchObject({
        mode: 'measurements-only',
        text: '24.5 cm',
        backgroundStyle: 'frosted',
        frosted: true,
        fill: 'rgba(255,255,255,0.55)',
      });

    await page.evaluate(async () => {
      const source = document.createElement('canvas');
      source.width = 640;
      source.height = 480;
      const context = source.getContext('2d');
      if (!context) throw new Error('Could not create side-image fixture');
      context.fillStyle = '#fef3c7';
      context.fillRect(0, 0, source.width, source.height);
      await window.app!.projectManager.addImage('side', source.toDataURL('image/png'), {
        refreshBackground: false,
      });
      await window.app!.projectManager.switchView('side', true);
    });
    await expect(toggle).toHaveAttribute('data-tag-mode', 'measurements-only');
    await page.evaluate(() => window.app!.projectManager.switchView('front', true));
    await expect
      .poll(() => readTagState(page))
      .toMatchObject({
        mode: 'measurements-only',
        text: '24.5 cm',
        backgroundStyle: 'frosted',
        frosted: true,
      });

    await toggle.click();
    await expect(toggle).toHaveAttribute('data-tag-mode', 'contextual');
    await expect
      .poll(() => readTagState(page))
      .toMatchObject({
        mode: 'contextual',
        text: 'A1 = 24.5 cm',
        backgroundStyle: 'solid',
        frosted: false,
      });
  });

  test('manual background cycle includes Frosted exactly once', async ({ appPage: page }) => {
    await uploadTestImage(page, 900, 600, '#dbeafe');
    await expandElements(page);
    await selectTool(page, 'line');
    await drawLine(page, 150, 220, 520, 220);
    await page.waitForFunction(() => Boolean(window.app?.tagManager));

    await page.locator('#elementsAppearance > summary').click();
    const backgroundButton = page.locator('#labelBackgroundToggleBtn');
    for (let index = 0; index < 5; index += 1) {
      await backgroundButton.click();
    }

    await expect(backgroundButton).toHaveText('Frosted');
    await expect
      .poll(() => readTagState(page))
      .toMatchObject({
        mode: 'contextual',
        backgroundStyle: 'frosted',
        frosted: true,
      });
  });

  test('tag-driven measurement focus clears the Add value placeholder while editing', async ({
    appPage: page,
  }) => {
    await uploadTestImage(page, 900, 600, '#dbeafe');
    await expandElements(page);
    await selectTool(page, 'line');
    await drawLine(page, 150, 220, 520, 220);

    const measurement = page.locator(
      '.stroke-visibility-item[data-stroke="A1"] .stroke-measurement'
    );
    await expect(measurement).toHaveClass(/empty-measurement/);
    await page.evaluate(() => window.app?.metadataManager?.focusMeasurementInput?.('A1'));
    await expect(measurement).toBeFocused();
    await expect(measurement).not.toHaveClass(/empty-measurement/);
    await expect(measurement).toHaveAttribute('contenteditable', 'true');
  });
});
