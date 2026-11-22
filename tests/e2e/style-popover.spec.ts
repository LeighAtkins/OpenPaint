import { test, expect, resizeViewport, uploadTestImage, selectTool, drawLine } from './fixtures';

test.describe('Style popover cleanup', () => {
  test('keeps Style open and keyboard focus on the palette switch while cycling', async ({
    appPage: page,
  }) => {
    const styleBtn = page.locator('#lineStylePopoverBtn');
    const panel = page.locator('#lineStylePopoverPanel');
    const palette = panel.locator('[data-palette-toggle]');
    await styleBtn.click();
    const appFont = await page.locator('body').evaluate(body => getComputedStyle(body).fontFamily);
    await expect(palette).toHaveCSS('font-family', appFont);
    await expect(panel.locator('#lineStylePatternSelect')).toHaveCSS('font-family', appFont);
    await expect(
      page.locator('#mini-stepper').getByRole('button', { name: 'Add photo' })
    ).toHaveCSS('font-family', appFont);

    await expect(palette).toHaveText('Classic');
    await palette.click();
    await expect(styleBtn).toHaveAttribute('aria-expanded', 'true');
    await expect(panel.getByRole('button', { name: 'Pastel Blue', exact: true })).toBeVisible();
    await expect(palette).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(panel.getByRole('button', { name: 'Fluro Blue', exact: true })).toBeVisible();
    await page.keyboard.press('Space');
    await expect(palette).toHaveText('Classic');
    await expect(palette).toBeFocused();
    await page.locator('#topToolbar').click({ position: { x: 2, y: 2 } });
    await expect(styleBtn).toHaveAttribute('aria-expanded', 'false');
  });

  test('shows adaptive high-contrast preview, truthful apply scope, progressive tag disclosure, and keeps Checks in Inspector', async ({
    appPage: page,
  }) => {
    await resizeViewport(page, 1280, 800);
    await uploadTestImage(page, 900, 600, '#e5e7eb');

    const styleBtn = page.locator('#lineStylePopoverBtn');
    const panel = page.locator('#lineStylePopoverPanel');
    const previewWrap = panel.locator('#lineStylePreviewWrap');
    const previewMeta = panel.locator('#lineStylePreviewMeta');
    const scopeNote = panel.locator('#lineStyleScopeNote');
    const tagDisclosure = panel.locator('#styleTagDisclosure');

    // Keyboard open + Escape focus restoration
    await styleBtn.focus();
    await page.keyboard.press('ArrowDown');
    await expect(panel).toHaveClass(/open/);
    await expect(styleBtn).toHaveAttribute('aria-expanded', 'true');
    expect(
      await page.evaluate(() => document.activeElement?.closest('#lineStylePopoverPanel')?.id)
    ).toBe('lineStylePopoverPanel');
    await page.keyboard.press('Escape');
    await expect(panel).not.toHaveClass(/open/);
    await expect(styleBtn).toBeFocused();

    // Open via click and inspect default state (no selection)
    await styleBtn.click();
    await expect(panel).toHaveClass(/open/);
    await expect(scopeNote).toContainText('Applies to new lines');

    for (const arrowId of ['arrowStartBtn', 'arrowEndBtn']) {
      const arrowButton = panel.locator(`#${arrowId}`);
      await expect(arrowButton).toBeVisible();
      const wasActive = await arrowButton.evaluate(button => button.classList.contains('active'));
      await arrowButton.click();
      if (wasActive) await expect(arrowButton).not.toHaveClass(/\bactive\b/);
      else await expect(arrowButton).toHaveClass(/\bactive\b/);
    }

    // Unrelated Checks & links must not live inside the visual Style popup,
    // and must remain accessible in the Inspector.
    await expect(panel.locator('#openMeasurementRelationsBtn')).toHaveCount(0);
    await expect(page.locator('#elementsControls #openMeasurementRelationsBtn')).toHaveCount(1);

    // Select White swatch -> preview mat switches to dark for high contrast
    const whiteSwatch = panel.locator('.color-swatches button[data-color="#ffffff"]');
    await whiteSwatch.click();
    await expect(previewWrap).toHaveAttribute('data-mat', 'dark');
    await expect(previewMeta).toContainText('px');

    // Select Blue swatch -> preview mat switches to light
    const blueSwatch = panel.locator('.color-swatches button[data-color="#3b82f6"]');
    await blueSwatch.click();
    await expect(previewWrap).toHaveAttribute('data-mat', 'light');

    // Update pattern & width and verify preview metadata updates
    await panel.locator('#brushSize').fill('4');
    await panel.locator('#brushSize').dispatchEvent('input');
    await panel.locator('#lineStylePatternSelect').selectOption('medium');
    await expect(previewMeta).toContainText('4 px');
    await expect(previewMeta).toContainText('Dash');

    // Scope buttons update aria-pressed and honest description
    await panel.locator('[data-scope="image"]').click();
    await expect(panel.locator('[data-scope="image"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(scopeNote).toContainText('this view');

    await panel.locator('[data-scope="project"]').click();
    await expect(panel.locator('[data-scope="project"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(scopeNote).toContainText('every view');

    await panel.locator('[data-scope="selection"]').click();
    await expect(panel.locator('[data-scope="selection"]')).toHaveAttribute('aria-pressed', 'true');

    // Progressive disclosure: Tags, labels & connectors starts collapsed, expands cleanly
    await expect(tagDisclosure).not.toHaveAttribute('open', '');
    await tagDisclosure.locator('summary').click();
    await expect(tagDisclosure).toHaveAttribute('open', '');
    await expect(panel.locator('#currentTagSize')).toBeVisible();
    await expect(panel.locator('#tagColorEditorBtn')).toBeVisible();
    await expect(panel.locator('#labelShapeToggleBtn')).toBeVisible();
    await expect(panel.locator('#labelBackgroundToggleBtn')).toBeVisible();
    await expect(panel.locator('#connectorToneBtn')).toBeVisible();

    const sizeBefore = Number(await panel.locator('#currentTagSize').textContent());
    await panel.locator('#increaseAllTagSize').click();
    await expect(panel.locator('#currentTagSize')).toHaveText(`${sizeBefore + 2}`);
    await expect(panel.locator('#styleTagDisclosureMeta')).toContainText(`${sizeBefore + 2} px`);

    // Close, draw a line, select it, and verify live selection target in Style header + note
    await panel.getByRole('button', { name: 'Close style menu', exact: true }).click();
    await expect(panel).not.toHaveClass(/open/);

    await selectTool(page, 'line');
    await drawLine(page, 220, 260, 560, 260);
    await selectTool(page, 'select');
    await page.evaluate(() => {
      const canvas = window.app?.canvasManager?.fabricCanvas;
      const line = canvas
        ?.getObjects()
        .find((obj: any) => obj.type === 'line' && !obj.isConnectorLine);
      if (canvas && line) {
        canvas.setActiveObject(line);
        canvas.requestRenderAll();
      }
    });

    await styleBtn.click();
    await expect(panel).toHaveClass(/open/);
    await expect(scopeNote).toContainText('Updating 1 selected');

    // Narrow viewport check: stays inside viewport with no horizontal overflow
    await resizeViewport(page, 390, 844);
    await page.waitForTimeout(250);
    const narrowBox = await panel.boundingBox();
    expect(narrowBox).not.toBeNull();
    expect(narrowBox!.x).toBeGreaterThanOrEqual(4);
    expect(narrowBox!.x + narrowBox!.width).toBeLessThanOrEqual(390 - 4);
    expect(narrowBox!.y + narrowBox!.height).toBeLessThanOrEqual(844);
    await expect(panel.locator('#arrowStartBtn')).toBeVisible();
    await expect(panel.locator('#arrowEndBtn')).toBeVisible();
  });
});
