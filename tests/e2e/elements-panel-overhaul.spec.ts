import { test, expect, uploadTestImage, selectTool, drawLine } from './fixtures';

async function openElementsPanel(page) {
  const search = page.locator('#elementsSearchInput');
  if (!(await search.isVisible())) {
    await page.locator('#toggleStrokePanel').click();
    await expect(search).toBeVisible();
  }
}

test.describe('Elements panel inspector', () => {
  test('keeps measurements primary and exposes secondary tools contextually', async ({
    appPage: page,
  }) => {
    await uploadTestImage(page);
    await selectTool(page, 'line');
    await drawLine(page, 120, 140, 420, 140);
    await drawLine(page, 120, 240, 420, 240);
    await drawLine(page, 120, 340, 420, 340);
    await openElementsPanel(page);

    await expect(page.locator('#elementsMeasurementCount')).toHaveText('3');
    await expect(page.locator('#elementsVisibleSummary')).toHaveText('3');
    await expect(page.locator('#strokesList [data-element-kind="measurements"]')).toHaveCount(3);
    await expect(page.locator('#viewMeasurementsToggle')).toHaveCount(0);
    await expect(page.locator('#toggleReviewOnly')).toHaveCount(0);

    const search = page.locator('#elementsSearchInput');
    await search.fill('A2');
    await expect(
      page.locator(
        '#strokesList [data-element-kind="measurements"]:not([data-search-hidden="true"])'
      )
    ).toHaveCount(1);
    await expect(page.locator('[data-stroke="A2"]')).toBeVisible();
    await search.fill('');

    await page.locator('[data-elements-view="text"][role="tab"]').click();
    await expect(page.locator('.elements-empty-state[data-element-kind="text"]')).toBeVisible();
    await expect(page.locator('[data-stroke="A1"]')).toBeHidden();
    await page.locator('[data-elements-view="measurements"][role="tab"]').click();
    await expect(page.locator('[data-stroke="A1"]')).toBeVisible();

    await page.locator('[data-stroke="A1"]').evaluate(element => {
      (element as HTMLElement).click();
    });
    await expect(page.locator('#elementsAppearanceScope')).toHaveText('1 selected');
    await page.locator('#elementsAppearance summary').click();
    await expect(page.locator('#tagColorEditorBtn')).toBeVisible();
    await expect(page.locator('#connectorToneBtn')).toBeVisible();
  });

  test('keeps row controls aligned and bulk visibility reversible', async ({ appPage: page }) => {
    await uploadTestImage(page);
    await selectTool(page, 'line');
    await drawLine(page, 140, 160, 520, 160);
    await drawLine(page, 140, 290, 520, 290);
    await openElementsPanel(page);

    const geometry = await page.locator('[data-stroke="A1"]').evaluate(row => {
      const label = row.querySelector('.stroke-name')?.getBoundingClientRect();
      const value = row.querySelector('.stroke-measurement')?.getBoundingClientRect();
      const visibility = row.querySelector('input[type="checkbox"]')?.getBoundingClientRect();
      const remove = row.querySelector('.delete-image-btn')?.getBoundingClientRect();
      return {
        row: row.getBoundingClientRect().toJSON(),
        label: label?.toJSON(),
        value: value?.toJSON(),
        visibility: visibility?.toJSON(),
        remove: remove?.toJSON(),
        valueWhiteSpace: value
          ? getComputedStyle(row.querySelector('.stroke-measurement') as Element).whiteSpace
          : '',
      };
    });
    expect(geometry.valueWhiteSpace).toBe('nowrap');
    expect(Math.abs(geometry.label.y - geometry.value.y)).toBeLessThan(3);
    expect(geometry.value.right).toBeLessThanOrEqual(geometry.remove.left + 1);
    expect(geometry.visibility.left).toBeGreaterThanOrEqual(geometry.row.left);

    await page.locator('#selectAllStrokesBtn').click();
    await expect(page.locator('#strokesList input[type="checkbox"]:checked')).toHaveCount(0);
    await expect(page.locator('#elementsVisibleSummary')).toHaveText('0/2');
    await page.locator('#selectAllStrokesBtn').click();
    await expect(page.locator('#strokesList input[type="checkbox"]:checked')).toHaveCount(2);
    await expect(page.locator('#elementsVisibleSummary')).toHaveText('2');
  });
});
