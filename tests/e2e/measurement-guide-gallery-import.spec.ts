import { test, expect, waitForApp } from './fixtures';

const GUIDE_SVG = (code: string, view: string) =>
  `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 720" width="960" height="720">
    <rect x="0" y="0" width="960" height="720" fill="#f8fafc" />
    <text x="64" y="86" font-size="40" fill="#0f172a">${code}-${view}</text>
    <g id="m${code.toLowerCase().replace(/[^a-z0-9]+/g, '')}${view}">
      <line x1="140" y1="260" x2="820" y2="260" stroke="#2563eb" stroke-width="8" />
    </g>
    <g id="c${code.toLowerCase().replace(/[^a-z0-9]+/g, '')}${view}">
      <rect x="410" y="196" width="140" height="48" fill="#fff" stroke="#0f172a" />
      <text x="454" y="230" font-size="24" fill="#0f172a">A1</text>
    </g>
  </svg>
`.trim();

test.describe('Measurement Guide Gallery import attachment', () => {
  test('Gallery add keeps each guide image, binding, thumbnail, and saved identity together', async ({
    page,
  }) => {
    await page.route('**/api/measurement-guides/codes', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          count: 2,
          codes: ['PIPE-A', 'PIPE-B'],
          viewsByCode: {
            'PIPE-A': ['front'],
            'PIPE-B': ['back'],
          },
        }),
      });
    });

    await page.route('**/api/measurement-guides/svg**', async route => {
      const url = new URL(route.request().url());
      const code = String(url.searchParams.get('code') || 'PIPE-A').toUpperCase();
      const view = String(url.searchParams.get('view') || 'front').toLowerCase();
      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml; charset=utf-8',
        body: GUIDE_SVG(code, view),
      });
    });

    await page.goto('/');
    await waitForApp(page);
    await page.evaluate(() => window.openMeasurementGuideGallery?.({ mode: 'select' }));
    await expect(page.locator('.guide-gallery-overlay.visible')).toBeVisible();

    for (const item of [
      { code: 'PIPE-A', view: 'front', imageId: 'pipe-a-front' },
      { code: 'PIPE-B', view: 'back', imageId: 'pipe-b-back' },
    ]) {
      await page
        .locator(`[data-guide-quick-add="${item.code}"][data-guide-quick-view="${item.view}"]`)
        .click();
      await expect
        .poll(() =>
          page.evaluate(id => Boolean(window.app?.projectManager?.views?.[id]?.image), item.imageId)
        )
        .toBe(true);
    }

    const inspect = () =>
      page.evaluate(() => {
        const manager = window.app?.projectManager;
        const metadata = manager?.getProjectMetadata?.() || {};
        const galleryData = window.imageGallery?.getData?.() || window.imageGalleryData || [];
        const labels = galleryData.map(
          item => item?.original?.label || item?.label || item?.name || ''
        );
        const sidebarLabels = Array.from(document.querySelectorAll('#imageList [data-label]')).map(
          element => element.getAttribute('data-label') || ''
        );
        return {
          views: Object.keys(manager?.views || {})
            .filter(id => id.startsWith('pipe-'))
            .sort(),
          galleryCounts: {
            'pipe-a-front': labels.filter(label => label === 'pipe-a-front').length,
            'pipe-b-back': labels.filter(label => label === 'pipe-b-back').length,
          },
          sidebarCounts: {
            'pipe-a-front': sidebarLabels.filter(label => label === 'pipe-a-front').length,
            'pipe-b-back': sidebarLabels.filter(label => label === 'pipe-b-back').length,
          },
          labels: metadata.measurementGuideLabelsByImage || {},
          links: metadata.measurementGuideModelLinksByImage || {},
          selections: metadata.measurementGuideModelSelections || [],
          bindings: {
            'pipe-a-front': window.resolveGuideModelBindingForView?.('pipe-a-front') || null,
            'pipe-b-back': window.resolveGuideModelBindingForView?.('pipe-b-back') || null,
          },
        };
      });

    expect(await inspect()).toMatchObject({
      views: ['pipe-a-front', 'pipe-b-back'],
      galleryCounts: { 'pipe-a-front': 1, 'pipe-b-back': 1 },
      sidebarCounts: { 'pipe-a-front': 1, 'pipe-b-back': 1 },
      labels: {
        'pipe-a-front': 'PIPE-A FRONT',
        'pipe-b-back': 'PIPE-B BACK',
      },
      links: {
        'pipe-a-front': 'PIPE-A::front',
        'pipe-b-back': 'PIPE-B::back',
      },
      bindings: {
        'pipe-a-front': { selection: { code: 'PIPE-A', variant: 'front' } },
        'pipe-b-back': { selection: { code: 'PIPE-B', variant: 'back' } },
      },
    });

    const saved = await page.evaluate(() =>
      window.app?.projectManager?.getProjectData?.({ embedImages: true })
    );
    await page.evaluate(data => window.app?.projectManager?.loadProjectFromData?.(data), saved);
    await page.waitForFunction(() => !(window as any).__isLoadingProject, { timeout: 15_000 });
    await page.waitForTimeout(700);

    expect(await inspect()).toMatchObject({
      views: ['pipe-a-front', 'pipe-b-back'],
      galleryCounts: { 'pipe-a-front': 1, 'pipe-b-back': 1 },
      sidebarCounts: { 'pipe-a-front': 1, 'pipe-b-back': 1 },
      links: {
        'pipe-a-front': 'PIPE-A::front',
        'pipe-b-back': 'PIPE-B::back',
      },
      bindings: {
        'pipe-a-front': { selection: { code: 'PIPE-A', variant: 'front' } },
        'pipe-b-back': { selection: { code: 'PIPE-B', variant: 'back' } },
      },
    });
  });
});
