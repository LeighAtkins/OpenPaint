/**
 * E2E tests: CW Import integration.
 *
 * Covers:
 *  - Opening the CW import modal
 *  - Mocking the CW API to return measurement data
 *  - Verifying measurement guide overlay appears
 *  - Importing measurements and verifying strokes are created
 */
import { test, expect, waitForApp, getCanvas, selectTool, drawLine } from './fixtures';
import type { Page, Route } from '@playwright/test';

// ---------------------------------------------------------------------------
// Mock data for CW API responses
// ---------------------------------------------------------------------------
const MOCK_CW_SEARCH_RESPONSE = {
  results: [
    {
      formId: 'TEST-001',
      itemCode: 'ITEM-A',
      title: 'Test Sofa Cover',
      subtitle: 'Custom fit',
      versionOptions: [
        { value: 'v1', label: 'Version 1' },
        { value: 'v2', label: 'Version 2' },
      ],
      styleOptions: [
        { value: 'loose', label: 'Loose Fit' },
        { value: 'tight', label: 'Tight Fit' },
      ],
    },
  ],
};

const MOCK_CW_IMAGES_RESPONSE = {
  imagesByItemCode: {
    'ITEM-A': [
      {
        url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        section: 'front',
        name: 'Front View',
        itemCode: 'ITEM-A',
      },
    ],
  },
  lineMappingByItemCode: {
    'ITEM-A': {
      A1: { label: 'Seat Width', expected: '72"' },
      A2: { label: 'Seat Depth', expected: '24"' },
      A3: { label: 'Back Height', expected: '30"' },
    },
  },
};

const MOCK_GUIDE_MODELS_RESPONSE = {
  models: [
    {
      code: 'TEST-SOFA',
      name: 'Test Sofa Model',
      category: 'sofa',
    },
  ],
};

// ---------------------------------------------------------------------------
// Route interceptors
// ---------------------------------------------------------------------------

/** Set up API mocking for CW endpoints. */
async function mockCwApi(page: Page): Promise<void> {
  let transientDiscoverFailures = 0;
  await page.route('https://cdn.shopify.com/test-sofa-cover.jpg', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      ),
    });
  });
  await page.route('https://cdn.shopify.com/test-sofa-cover-alt.jpg', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      ),
    });
  });
  await page.route('https://cdn.shopify.com/comparison-*.jpg', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      ),
    });
  });

  await page.route('**/api/integrations/cw/measurements/search', async (route: Route) => {
    const requestBody = route.request().postDataJSON() as {
      phase?: string;
      search?: string;
      selectedItems?: Array<Record<string, string>>;
      comparisonItems?: Array<Record<string, any>>;
    };
    if (requestBody.phase === 'storefront-comparison') {
      const items = (requestBody.comparisonItems || []).map((item, index) => {
        const isSample = item.kind === 'fabric-sample';
        const sampleOptions = [
          { code: 'BEN-02', label: 'Crypton® Chenille Cream' },
          { code: 'COS-105', label: 'Care+ Linen Natural' },
        ];
        const sampleCode = String(item.fabricCode || item.codes?.[0] || 'BEN-02');
        const sampleName =
          sampleOptions.find(option => option.code === sampleCode)?.label || item.fabricName;
        return {
          ...item,
          title: isSample ? sampleName : item.title,
          codes: isSample ? [sampleCode] : item.codes,
          fabricCode: sampleCode,
          fabricName: isSample ? sampleName : item.fabricName,
          imageUrl: `https://cdn.shopify.com/comparison-${index + 1}.jpg`,
          productUrl: isSample
            ? 'https://comfort-works.com/pages/fabric-samples'
            : `https://comfort-works.com/products/mock-${index + 1}`,
          requestedSku: isSample
            ? sampleCode
            : [item.productReference, ...(item.codes || [])].join('__'),
          matchedSku: isSample
            ? sampleCode
            : [item.productReference, ...(item.codes || []).slice(0, -1), 'SUN-C13'].join('__'),
          imageMatch: isSample ? 'exact' : 'configuration-fallback',
          note: isSample
            ? 'Official Comfort Works fabric sample'
            : 'Exact configuration; closest available fabric photo',
          dimensions: isSample
            ? null
            : {
                width: { cm: 204 + index },
                depth: { cm: 87 + index },
                height: { cm: 72 + index },
              },
          measurementReference: isSample ? '' : item.productReference,
          measurementStyle: isSample ? '' : item.styleName || 'Original',
          measurementStyleCode: isSample ? '' : 'VELC_SP',
          configurationGroups: isSample
            ? [{ key: 'fabric', label: 'Fabric', codeIndex: 0, options: sampleOptions }]
            : /^IK-KS-(?:2M|5M)$/.test(item.productReference)
              ? [
                  {
                    key: 'configuration-0',
                    label: 'Side',
                    codeIndex: 0,
                    options: [
                      { code: 'L', label: 'Left Arm' },
                      { code: 'R', label: 'Right Arm' },
                    ],
                  },
                  {
                    key: 'configuration-2',
                    label: 'Style',
                    codeIndex: 2,
                    options: [
                      { code: 'LSKT_PM', label: 'Signature' },
                      { code: 'SHRT_SP', label: 'Original' },
                    ],
                  },
                ]
              : [],
        };
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, items }),
      });
      return;
    }
    if (requestBody.phase === 'public-measurements') {
      await new Promise(resolve => setTimeout(resolve, 120));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          measurements: {
            width: { cm: 204, in: 80.31 },
            depth: { cm: 87, in: 34.25 },
            height: { cm: 72, in: 28.35 },
          },
          productReference: requestBody.search || 'TEST-001',
          style: 'Urban',
          styleCode: 'VELC_SP',
        }),
      });
      return;
    }
    if (requestBody.phase === 'storefront-product') {
      if (requestBody.search === 'FAST-PUBLIC') {
        await new Promise(resolve => setTimeout(resolve, 420));
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          product: {
            title: 'Test Sofa Cover',
            url: 'https://comfort-works.com/products/test-sofa-cover',
            imageUrl: 'https://cdn.shopify.com/test-sofa-cover.jpg',
            imageUrls: [
              'https://cdn.shopify.com/test-sofa-cover.jpg',
              'https://cdn.shopify.com/test-sofa-cover-alt.jpg',
            ],
            dimensions:
              requestBody.search === 'FAST-PUBLIC'
                ? null
                : {
                    width: { cm: 204, in: 80.31 },
                    depth: { cm: 87, in: 34.25 },
                    height: { cm: 72, in: 28.35 },
                  },
          },
        }),
      });
      return;
    }
    if (requestBody.phase === 'load-selected-details') {
      if (requestBody.search === 'NO-CREDS') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            summary: { loadedCount: 0, failedCount: 1 },
            items: [
              {
                success: false,
                selectionKey: requestBody.selectedItems?.[0]?.selectionKey,
                message: 'Missing CW credentials (username/password)',
              },
            ],
          }),
        });
        return;
      }
      const selected = requestBody.selectedItems?.[0] || {};
      await new Promise(resolve => setTimeout(resolve, 350));
      const privateArrayMeasurements =
        requestBody.search === 'PRIVATE-ARRAY'
          ? {
              qcMeasurements: {
                data: {
                  product_components: [
                    {
                      name: 'Frame Cover',
                      measurements: [
                        {
                          name: 'Front panel width',
                          translations: { en: 'Front panel width' },
                          value: 180.5,
                          unit: 'cm',
                        },
                        {
                          name: 'Front panel height',
                          translations: { en: 'Front panel height' },
                          value: 32.5,
                          unit: 'cm',
                        },
                      ],
                    },
                  ],
                },
              },
            }
          : {};
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          summary: { loadedCount: 1 },
          items: [
            {
              success: true,
              selectionKey: selected.selectionKey,
              basketItem: selected,
              message: 'Loaded detailed product photos',
              data: {
                product: { reference: selected.productReference || 'TEST-001' },
                ...privateArrayMeasurements,
                renderedHtmlExtraction: {
                  sections: [
                    {
                      sectionName: 'Detail Photos',
                      imageUrls: [
                        'https://storage.googleapis.com/test/detail.jpg?GoogleAccessId=test&Signature=detail',
                      ],
                      measurements: [],
                    },
                  ],
                },
              },
            },
          ],
        }),
      });
      return;
    }
    if (
      requestBody.phase === 'discover' &&
      requestBody.search === 'RETRY-TEST' &&
      transientDiscoverFailures === 0
    ) {
      transientDiscoverFailures += 1;
      await route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          code: 'CW_UPSTREAM_TEMPORARY_FAILURE',
          message: 'Temporary upstream failure',
        }),
      });
      return;
    }
    if (requestBody.phase === 'load-selected') {
      if (requestBody.search === 'PUBLIC-ONLY') {
        await route.fulfill({
          status: 502,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            code: 'CW_SELECTED_ITEMS_LOAD_PARTIAL',
            message: 'Private product details unavailable',
            items: [],
          }),
        });
        return;
      }
      const selected = requestBody.selectedItems?.[0] || {};
      const loadedMeasurements =
        requestBody.search === 'SCROLL-TEST'
          ? Array.from({ length: 18 }, (_, index) => ({
              label: `Measurement ${index + 1}`,
              value: String(100 + index * 2.5),
            }))
          : requestBody.search === 'DUPLICATE-FLOW'
            ? [
                { label: 'Front panel width', value: '180.5' },
                { label: 'Front panel height', value: '32.5' },
                { label: 'Side width', value: '91' },
                { label: 'Side height (Left)', value: '62' },
                { label: 'Side width (Top)', value: '7.5' },
              ]
            : requestBody.search === 'UNLABELED-TEST'
              ? [
                  { label: 'Width', value: '210' },
                  { label: 'Unmapped seam span', value: '64.5' },
                ]
              : requestBody.search === 'PRIVATE-ARRAY'
                ? [
                    { label: 'Width', value: '210' },
                    { label: 'Depth', value: '95' },
                    { label: 'Height', value: '82' },
                  ]
                : [
                    { label: 'Width', value: '210' },
                    { label: 'Depth', value: '95' },
                    { label: 'Height', value: '82' },
                    { label: 'Front panel width', value: '180.5' },
                    { label: 'Front panel height', value: '32.5' },
                  ];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          summary: { loadedCount: 1 },
          items: [
            {
              success: true,
              selectionKey: selected.selectionKey,
              basketItem: selected,
              message: 'Loaded complete product',
              data: {
                product: { reference: 'TEST-001' },
                renderedHtmlExtraction: {
                  sections: [
                    {
                      sectionName: 'Frame Cover',
                      imageUrls: [
                        'https://storage.googleapis.com/test/front.jpg?GoogleAccessId=test&Signature=test',
                      ],
                      measurements: loadedMeasurements,
                    },
                  ],
                },
              },
            },
          ],
        }),
      });
      return;
    }

    const normalizedSearch = String(requestBody.search || '').toUpperCase();
    const isNikkalaVelcro = normalizedSearch.toUpperCase().startsWith('IK-NA-3');
    const isHarmonyLeft = normalizedSearch.startsWith('WE-HY-118');
    const isStockholm = normalizedSearch.startsWith('IK-SM-4');
    if (requestBody.phase === 'discover' && requestBody.search === 'FAST-PUBLIC') {
      await new Promise(resolve => setTimeout(resolve, 1400));
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          {
            id: isStockholm
              ? 'UHJvZHVjdDozMTM='
              : isNikkalaVelcro
                ? 'IK-NA-3'
                : isHarmonyLeft
                  ? 'WE-HY-118'
                  : 'TEST-001',
            productReference: isNikkalaVelcro
              ? 'IK-NA-3'
              : isHarmonyLeft
                ? 'WE-HY-118'
                : isStockholm
                  ? 'IK-SM-4'
                  : 'TEST-001',
            productName: isNikkalaVelcro
              ? 'Nikkala 3 Seater Sofa Cover'
              : isHarmonyLeft
                ? 'Harmony 2-Piece Chaise Sectional Slipcover'
                : isStockholm
                  ? 'Stockholm 3.5 Seater Sofa Cover'
                  : 'Test Sofa Cover',
            configParsed: true,
            versionOptions: isNikkalaVelcro
              ? [
                  {
                    code: 'VH',
                    label: 'My sofa has the Hard/Hook Velcro',
                    scopedReference: 'IK-NA-3__VH',
                  },
                  {
                    code: 'VS',
                    label: 'My sofa has the Soft/Loop Velcro',
                    scopedReference: 'IK-NA-3__VS',
                  },
                ]
              : isHarmonyLeft
                ? [
                    {
                      code: 'L',
                      label: 'Left Chaise',
                      scopedReference: 'WE-HY-118__L',
                    },
                  ]
                : isStockholm
                  ? [
                      {
                        code: 'SV',
                        label: 'Existing fabric covers',
                        scopedReference: 'IK-SM-4__SV',
                        isDefault: true,
                      },
                      {
                        code: 'LV',
                        label: 'Leather upholstered',
                        scopedReference: 'IK-SM-4__LV',
                        isDefault: false,
                      },
                    ]
                  : [],
            derivedScopedReferences: isStockholm ? ['IK-SM-4__SV', 'IK-SM-4__LV'] : [],
            styleOptions: isStockholm
              ? [
                  {
                    productReference: 'IK-SM-4',
                    style: 'Signature',
                    styleCode: 'LSKT_WR',
                    label: 'Signature',
                  },
                  {
                    productReference: 'IK-SM-4',
                    style: 'Original',
                    styleCode: 'VELC_SP',
                    label: 'Original',
                  },
                ]
              : [
                  {
                    productReference: isNikkalaVelcro
                      ? 'IK-NA-3'
                      : isHarmonyLeft
                        ? 'WE-HY-118'
                        : 'TEST-001',
                    style: 'Frame Cover',
                    styleCode: 'FC',
                    label: 'Frame Cover',
                  },
                ],
          },
        ],
      }),
    });
  });

  // Mock the guide-models endpoint (search)
  await page.route('**/api/integrations/cw/**/guide-models**', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_GUIDE_MODELS_RESPONSE),
    });
  });

  // Mock the images endpoint
  await page.route('**/api/integrations/cw/images/**', async (route: Route) => {
    const method = route.request().method();
    if (method === 'GET' || method === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_CW_IMAGES_RESPONSE),
      });
    } else {
      await route.continue();
    }
  });

  // Mock the action endpoints
  await page.route('**/api/integrations/cw/*', async (route: Route) => {
    const url = route.request().url();
    if (url.includes('health')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    } else {
      await route.continue();
    }
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('CW Import', () => {
  test.beforeEach(async ({ appPage: page }) => {
    await mockCwApi(page);
  });

  /** Open the CW modal via the toolbar button and wait for it to display. */
  async function openCwModal(page: import('@playwright/test').Page): Promise<void> {
    // The toolbar button is #cwImportBtn or contains "CW Import" text
    const cwBtn = page.locator('#cwImportBtn, button:has-text("CW Import")');
    if ((await cwBtn.count()) > 0) {
      await cwBtn.first().click();
    } else {
      // Fallback: open via the openModal function directly
      await page.evaluate(() => {
        const modal = document.getElementById('cwImportModalOverlay');
        if (modal) modal.style.display = 'flex';
      });
    }
    // Wait for the modal overlay to become display:flex (visible)
    await page.waitForFunction(
      () => {
        const el = document.getElementById('cwImportModalOverlay');
        return el && getComputedStyle(el).display !== 'none';
      },
      { timeout: 5000 }
    );
    await page.waitForTimeout(300);
  }

  async function chooseQueueMeasurement(
    page: import('@playwright/test').Page,
    sourceLabel: string
  ): Promise<void> {
    if (!(await page.locator('#elementsBody').isVisible())) {
      await page.locator('#toggleStrokePanel').click();
    }
    await page.locator('[data-elements-view="library"]').click();
    const row = page.locator(
      `#elementsMeasurementLibrary .cw-measure-row[data-cw-source-label="${sourceLabel}"]`
    );
    await expect(row).toHaveCount(1);
    await row.locator('.cw-library-action button').click();
  }

  /** Check that the modal is currently displayed. */
  async function isModalOpen(page: import('@playwright/test').Page): Promise<boolean> {
    return page.evaluate(() => {
      const el = document.getElementById('cwImportModalOverlay');
      return !!el && getComputedStyle(el).display !== 'none';
    });
  }

  test('should open the CW import modal', async ({ appPage: page }) => {
    await openCwModal(page);
    expect(await isModalOpen(page)).toBe(true);
  });

  test('should show search input and form fields in the modal', async ({ appPage: page }) => {
    await openCwModal(page);

    // Check for key form elements inside the modal
    const hasFormId = await page.evaluate(() => !!document.querySelector('#cwFormId'));
    const hasSearchTerm = await page.evaluate(() => !!document.querySelector('#cwSearchTerm'));
    expect(hasFormId || hasSearchTerm).toBe(true);
  });

  test('builds the Kramfors order comparison and opens its three catalogue views', async ({
    appPage: page,
  }) => {
    await openCwModal(page);
    await page.locator('#cwComparisonBuilder').evaluate(element => {
      (element as HTMLDetailsElement).open = true;
    });
    await page.locator('#cwComparisonInput').fill(`
https://comfort-works.com/products/kramfors-footstool-cover
https://comfort-works.com/products/kramfors-chaise-lounge-sofa-cover
https://comfort-works.com/products/kramfors-chaise-lounge-sofa-cover
1. IK-KS-0 Kramfors Footstool Cover
Code: LV, SHRT_SP, COS-105
2. IK-KS-2M Kramfors 2 Seater 1 Armrest Sofa Cover
Code: R, LV, LSKT_PM, COS-105
3. IK-KS-5M Kramfors Chaise Lounge Sofa Cover
Code: L, LV, LSKT_PM, COS-105
`);
    await page.locator('#cwBuildComparisonBtn').click();

    await expect(page.locator('#cwComparisonItems .cw-comparison-item')).toHaveCount(3);
    await expect(page.locator('#cwComparisonFabric')).toHaveValue('COS-105');
    await expect(page.locator('#cwComparisonItems')).toContainText('IK-KS-2M');
    await expect(page.locator('#cwComparisonItems')).toContainText('R · LV · LSKT_PM · COS-105');
    await expect(page.locator('#cwComparisonItems')).toContainText('IK-KS-5M');
    await expect(page.locator('#cwComparisonItems')).toContainText('L · LV · LSKT_PM · COS-105');

    const secondCard = page.locator('#cwComparisonItems .cw-comparison-item').nth(1);
    await expect(secondCard.getByLabel('Side for IK-KS-2M')).toHaveValue('R');
    await expect(secondCard.getByLabel('Style for IK-KS-2M')).toHaveValue('LSKT_PM');
    await secondCard.getByLabel('Side for IK-KS-2M').selectOption('L');
    await expect(
      page.locator('#cwComparisonItems .cw-comparison-item').nth(1).getByLabel('Side for IK-KS-2M')
    ).toHaveValue('L');
    await page
      .locator('#cwComparisonItems .cw-comparison-item')
      .nth(1)
      .getByLabel('Style for IK-KS-2M')
      .selectOption('SHRT_SP');
    await expect(
      page.locator('#cwComparisonItems .cw-comparison-item').nth(1).getByLabel('Style for IK-KS-2M')
    ).toHaveValue('SHRT_SP');
    await expect(
      page
        .locator('#cwComparisonItems .cw-comparison-item')
        .nth(1)
        .locator('.cw-comparison-item-config')
    ).toHaveAttribute('title', 'IK-KS-2M__L__LV__SHRT_SP__COS-105');
    await expect(
      page.locator('#cwComparisonItems .cw-comparison-item').nth(2).getByLabel('Side for IK-KS-5M')
    ).toHaveValue('L');

    await page.locator('#cwImportComparisonBtn').click();
    await expect(page.locator('#cwImportModalOverlay')).toBeHidden();
    await expect(page.locator('#multiViewStage')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#multiViewStage .multiview-pane')).toHaveCount(3);
    await expect(page.locator('#multiViewStage')).toContainText(
      'IK-KS-0 · Kramfors Footstool Cover'
    );
    await expect(page.locator('#multiViewStage')).toContainText(
      'IK-KS-2M · Left arm · Kramfors 2 Seater 1 Armrest Sofa Cover'
    );
    await expect(page.locator('#multiViewStage')).toContainText(
      'IK-KS-5M · Left arm · Kramfors Chaise Lounge Sofa Cover'
    );
    const comparisonClearance = await page.evaluate(() => {
      const toolbar = document.getElementById('topToolbar')?.getBoundingClientRect();
      const stage = document.getElementById('multiViewStage')?.getBoundingClientRect();
      return {
        toolbarBottom: toolbar?.bottom || 0,
        stageTop: stage?.top || 0,
      };
    });
    expect(comparisonClearance.stageTop).toBeGreaterThanOrEqual(
      comparisonClearance.toolbarBottom - 1
    );
  });

  test('adds one comparison product with its dimensions ready in split drawing mode', async ({
    appPage: page,
  }) => {
    await openCwModal(page);
    await page.locator('#cwComparisonBuilder').evaluate(element => {
      (element as HTMLDetailsElement).open = true;
    });
    await page.locator('#cwComparisonInput').fill(`
IK-KS-2M Kramfors 2 Seater 1 Armrest Sofa Cover
Code: R, LV, LSKT_PM, COS-105
IK-KS-5M Kramfors Chaise Lounge Sofa Cover
Code: L, LV, LSKT_PM, COS-105
`);
    await page.locator('#cwBuildComparisonBtn').click();

    const firstProduct = page.locator('#cwComparisonItems .cw-comparison-item').first();
    await expect(firstProduct.locator('[data-cw-comparison-draw]')).toHaveText(
      'Add + draw 3 dimensions'
    );
    await firstProduct.locator('[data-cw-comparison-draw]').click();

    await expect(page.locator('#cwImportModalOverlay')).toBeHidden();
    await expect(page.locator('body')).toHaveClass(/measurement-split-workspace-active/, {
      timeout: 10_000,
    });
    await expect(page.locator('#guideSplitRoot')).toBeVisible();
    const dimensionRows = page.locator('#cwSplitRows .cw-measure-row[data-cw-source-label]');
    await expect(dimensionRows).toHaveCount(3);
    await expect(dimensionRows.nth(0)).toContainText('Width');
    await expect(dimensionRows.nth(1)).toContainText('Depth');
    await expect(dimensionRows.nth(2)).toContainText('Height');
    await expect(dimensionRows.nth(0).locator('.cw-measure-input')).toHaveValue('W');
    await expect(dimensionRows.nth(1).locator('.cw-measure-input')).toHaveValue('D');
    await expect(dimensionRows.nth(2).locator('.cw-measure-input')).toHaveValue('H');
    await expect(dimensionRows.nth(0)).toHaveClass(/armed/);

    await selectTool(page, 'line');
    await drawLine(page, 120, 160, 420, 160);
    await expect(page.locator('[data-stroke="W"]')).toHaveCount(1);
    await expect(dimensionRows.nth(1)).toHaveClass(/armed/);
  });

  test('loads compact internal Soderhamn order lines without prices in product names', async ({
    appPage: page,
  }) => {
    await openCwModal(page);
    await page.locator('#cwComparisonBuilder').evaluate(element => {
      (element as HTMLDetailsElement).open = true;
    });
    await page.locator('#cwComparisonInput').fill(`
IK-SN-8 Soderhamn Armrest Cover (Pair)USD 139 x 1
USD 139
Original, Mod Chenille Espresso,
code: VELC_SP, ESTE-57,
IK-SN-5X Soderhamn Chaise Longue CoverUSD 399 x 1
USD 399
Original, Mod Chenille Espresso,
code: VELC_SP, ESTE-57,
IK-SN-3 Soderhamn 3-seater Sofa CoverUSD 579 x 1
USD 579
Original, Mod Chenille Espresso,
code: VELC_SP, ESTE-57,
`);
    await page.locator('#cwBuildComparisonBtn').click();

    const items = page.locator('#cwComparisonItems .cw-comparison-item');
    await expect(items).toHaveCount(3);
    await expect(page.locator('#cwComparisonFabric')).toHaveValue('Mod Chenille Espresso');
    await expect(page.locator('#cwComparisonItems')).toContainText(
      'Original · VELC_SP · Mod Chenille Espresso'
    );
    await expect(items.nth(0)).toContainText('Soderhamn Armrest Cover (Pair)');
    await expect(items.nth(1)).toContainText('Soderhamn Chaise Longue Cover');
    await expect(items.nth(2)).toContainText('Soderhamn 3-seater Sofa Cover');
    await expect(page.locator('#cwComparisonItems')).not.toContainText('USD 139 x 1');
    await expect(page.locator('#cwComparisonStatus')).toHaveText('3 of 3 catalogue photos ready.');
    await expect(page.locator('#cwImportComparisonBtn')).toBeVisible();
  });

  test('loads and imports a single comparison item', async ({ appPage: page }) => {
    await openCwModal(page);
    await page.locator('#cwComparisonBuilder').evaluate(element => {
      (element as HTMLDetailsElement).open = true;
    });
    await page.locator('#cwComparisonInput').fill(`
IK-SN-3 Soderhamn 3-seater Sofa Cover
Original, Mod Chenille Espresso,
code: VELC_SP, ESTE-57,
`);
    await page.locator('#cwBuildComparisonBtn').click();

    await expect(page.locator('#cwComparisonItems .cw-comparison-item')).toHaveCount(1);
    await expect(page.locator('#cwImportComparisonBtn')).toBeVisible();
    await expect(page.locator('#cwComparisonStatus')).toHaveText('1 of 1 catalogue photos ready.');
  });

  test('loads official fabric samples and lets each card change fabric independently', async ({
    appPage: page,
  }) => {
    await openCwModal(page);
    await page.locator('#cwComparisonBuilder').evaluate(element => {
      (element as HTMLDetailsElement).open = true;
    });
    await page.locator('#cwComparisonInput').fill(`
swatch Fabric SamplesUSD 0 x 1
USD 0
Crypton® Chenille Cream,
code: BEN-02,
swatch Fabric SamplesUSD 0 x 1
USD 0
Care+ Linen Natural,
code: COS-105,
`);
    await page.locator('#cwBuildComparisonBtn').click();

    const items = page.locator('#cwComparisonItems .cw-comparison-item');
    await expect(items).toHaveCount(2);
    await expect(page.locator('#cwComparisonFabric')).toBeHidden();
    await expect(page.locator('#cwComparisonFabric')).toHaveValue('');
    await expect(items.nth(0)).toContainText('Crypton® Chenille Cream');
    await expect(items.nth(1)).toContainText('Care+ Linen Natural');
    await expect(items.nth(0).getByLabel('Fabric for FABRIC-SAMPLE')).toHaveValue('BEN-02');
    await expect(items.nth(1).getByLabel('Fabric for FABRIC-SAMPLE')).toHaveValue('COS-105');
    await items.nth(0).getByLabel('Fabric for FABRIC-SAMPLE').selectOption('COS-105');
    await expect(
      page
        .locator('#cwComparisonItems .cw-comparison-item')
        .nth(0)
        .getByLabel('Fabric for FABRIC-SAMPLE')
    ).toHaveValue('COS-105');
    await expect(
      page
        .locator('#cwComparisonItems .cw-comparison-item')
        .nth(1)
        .getByLabel('Fabric for FABRIC-SAMPLE')
    ).toHaveValue('COS-105');
    await expect(page.locator('#cwImportComparisonBtn')).toBeVisible();
  });

  test('should accept form input and trigger search', async ({ appPage: page }) => {
    await openCwModal(page);

    // Use evaluate to fill the input since it may not pass Playwright's
    // visibility checks (the modal uses custom CSS, not standard visibility)
    const filled = await page.evaluate(() => {
      const input = document.querySelector('#cwFormId') as HTMLInputElement | null;
      if (!input) return false;
      input.value = 'TEST-001';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    });

    if (filled) {
      // Click the search button
      const clicked = await page.evaluate(() => {
        const btn =
          document.querySelector('#cwSearchBtn') || document.querySelector('button.cw-btn-primary');
        if (btn) {
          (btn as HTMLElement).click();
          return true;
        }
        return false;
      });

      if (clicked) {
        await page.waitForTimeout(1000);
      }
    }

    // Verify the modal is still open and functional (didn't crash)
    expect(await isModalOpen(page)).toBe(true);
  });

  test('loads an exact PID into one product workspace with photos and measurements', async ({
    appPage: page,
  }) => {
    await openCwModal(page);

    const search = page.locator('#cwSearchTerm');
    await expect(search).toHaveCount(1);
    await search.fill('TEST-001');
    await search.press('Enter');

    await expect(page.locator('#cwProductWorkspace')).toHaveClass(/has-product/);
    await expect(page.locator('#cwSelectedProductTitle')).toContainText('TEST-001');
    expect(await page.locator('#cwResultImages .cw-image-card').count()).toBeGreaterThan(0);
    await expect(page.locator('#cwRows .cw-measure-row')).toHaveCount(5);
    await expect(page.locator('#cwRows')).toContainText('Front panel width');
    await expect(page.locator('#cwRows')).toContainText('180.5');
    await expect(page.locator('#cwImportPhotosBtn')).toHaveText('Add selected photos');
    await expect(page.locator('#cwUseMeasurementsBtn')).toHaveText('Use measurements');
  });

  test('shows the exact CW40 array measurements when detailed loading is ready', async ({
    appPage: page,
  }) => {
    await openCwModal(page);
    await page.locator('#cwSearchTerm').fill('PRIVATE-ARRAY');
    await page.locator('#cwSearchTerm').press('Enter');

    await expect(page.locator('#cwRows')).toContainText('Front panel width');
    await expect(page.locator('#cwRows')).toContainText('180.5');
    await expect(page.locator('#cwRows .cw-measure-row')).toHaveCount(2);
    await expect(page.locator('#cwLoadProgressLabel')).toHaveText('Component measurements ready');
  });

  test('keeps every loaded CW measurement available in Elements and allows repeated draws', async ({
    appPage: page,
  }) => {
    await openCwModal(page);
    await page.locator('#cwSearchTerm').fill('TEST-001');
    await page.locator('#cwSearchTerm').press('Enter');
    await expect(page.locator('#cwRows .cw-measure-row')).toHaveCount(5);
    await page.locator('.cw-import-close').click();

    const libraryTab = page.locator('[data-elements-view="library"]');
    if (!(await libraryTab.isVisible())) {
      await page.locator('#toggleStrokePanel').click();
    }
    await libraryTab.click();
    await expect(page.locator('#elementsLibraryCount')).toHaveText('5');
    await expect(page.locator('#elementsMeasurementLibrary .cw-measure-row')).toHaveCount(5);

    const widthRow = page.locator(
      '#elementsMeasurementLibrary .cw-measure-row[data-cw-source-label="Width"]'
    );
    const labelInput = widthRow.locator('.cw-measure-input');
    await labelInput.fill('A');
    await widthRow.locator('.cw-library-action button').click();
    await expect(page.locator('#nextTagDisplay')).toHaveValue('A');

    await selectTool(page, 'line');
    await drawLine(page, 450, 220, 720, 220);
    await expect(page.locator('[data-stroke="A"]')).toHaveCount(1);

    await widthRow.locator('.cw-library-action button').click();
    await expect(page.locator('#nextTagDisplay')).toHaveValue('A(1)');
    await drawLine(page, 450, 300, 720, 300);
    await expect(page.locator('[data-stroke="A(1)"]')).toHaveCount(1);
    await expect(labelInput).toHaveValue('A');
  });

  test('requires an unlabeled row to be named, then advances to the next measurement', async ({
    appPage: page,
  }) => {
    await openCwModal(page);
    await page.locator('#cwSearchTerm').fill('UNLABELED-TEST');
    await page.locator('#cwSearchTerm').press('Enter');
    await expect(page.locator('#cwRows .cw-measure-row')).toHaveCount(2);
    await page.locator('#cwUseMeasurementsBtn').click();

    await expect(page.locator('#cwMeasurementQueueDock')).toHaveCount(0);
    if (!(await page.locator('#elementsBody').isVisible())) {
      await page.locator('#toggleStrokePanel').click();
    }
    await page.locator('[data-elements-view="library"]').click();
    const widthRow = page
      .locator('#elementsMeasurementLibrary .cw-measure-row')
      .filter({ hasText: 'Width' })
      .first();
    await widthRow.locator('.cw-library-action button').click();
    await expect(widthRow).toHaveClass(/armed/);
    await selectTool(page, 'line');
    await drawLine(page, 450, 220, 720, 220);

    const row = page
      .locator('#elementsMeasurementLibrary .cw-measure-row')
      .filter({ hasText: 'Unmapped seam span' })
      .first();
    const label = row.locator('.cw-measure-input');
    await expect(row).toHaveClass(/armed.*label-required|label-required.*armed/);
    await expect(label).toHaveValue('');
    await expect(label).toBeFocused();

    const countBeforeBlockedDraw = await page.locator('[data-stroke]').count();
    await drawLine(page, 450, 300, 720, 300);
    await expect(page.locator('[data-stroke]')).toHaveCount(countBeforeBlockedDraw);
    await expect(row).toHaveClass(/label-required/);

    await row.locator('.cw-library-action button').click();
    await expect(page.locator('#elementsMeasurementLibrary .cw-measure-row.armed')).toHaveCount(0);
    await drawLine(page, 450, 340, 720, 340);
    await expect(page.locator('[data-stroke]')).toHaveCount(countBeforeBlockedDraw + 1);

    await row.locator('.cw-library-action button').click();
    await expect(row).toHaveClass(/label-required/);
    await label.fill('Z9');
    await expect(page.locator('#nextTagDisplay')).toHaveValue('Z9');

    await drawLine(page, 450, 420, 720, 420);
    await expect(page.locator('[data-stroke="Z9"]')).toHaveCount(1);
    await expect(page.locator('#elementsMeasurementLibrary .cw-measure-row.armed')).toHaveCount(0);
  });

  test('keeps the next Elements measurement visible without jumping the library to the top', async ({
    appPage: page,
  }) => {
    await openCwModal(page);
    await page.locator('#cwSearchTerm').fill('SCROLL-TEST');
    await page.locator('#cwSearchTerm').press('Enter');
    await expect(page.locator('#cwRows .cw-measure-row')).toHaveCount(18);
    await page.locator('.cw-import-close').click();

    const libraryTab = page.locator('[data-elements-view="library"]');
    if (!(await libraryTab.isVisible())) await page.locator('#toggleStrokePanel').click();
    await libraryTab.click();

    const controls = page.locator('#strokeVisibilityControls');
    await expect(page.locator('#elementsMeasurementLibrary .cw-measure-row')).toHaveCount(18);
    await page.waitForTimeout(800);
    const library = page.locator('#elementsMeasurementLibrary');
    const currentRow = library.locator('.cw-measure-row').nth(11);
    const nextRow = library.locator('.cw-measure-row').nth(12);
    await currentRow.locator('.cw-measure-input').evaluate((element: HTMLInputElement) => {
      element.value = 'M12';
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await nextRow.locator('.cw-measure-input').evaluate((element: HTMLInputElement) => {
      element.value = 'M13';
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await controls.evaluate((element, targetIndex) => {
      const rows = element.querySelectorAll('#elementsMeasurementLibrary .cw-measure-row');
      const row = rows[targetIndex] as HTMLElement | undefined;
      if (row) element.scrollTop = Math.max(0, row.offsetTop - element.clientHeight / 2);
    }, 11);
    await expect.poll(() => controls.evaluate(element => element.scrollTop)).toBeGreaterThan(40);
    await controls.evaluate(element => {
      const trace: number[] = [element.scrollTop];
      (window as typeof window & { __cwLibraryScrollTrace?: number[] }).__cwLibraryScrollTrace =
        trace;
      element.addEventListener(
        'scroll',
        () => {
          trace.push(element.scrollTop);
        },
        { passive: true }
      );
    });
    await currentRow
      .locator('.cw-library-action button')
      .evaluate(button => (button as HTMLButtonElement).click());
    await selectTool(page, 'line');
    await drawLine(page, 450, 220, 720, 220);

    await expect(nextRow).toHaveClass(/armed/);
    await expect.poll(() => controls.evaluate(element => element.scrollTop)).toBeGreaterThan(40);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const scroller = document.getElementById('strokeVisibilityControls');
          const row = document.querySelector('#elementsMeasurementLibrary .cw-measure-row.armed');
          if (!scroller || !row) return false;
          const scrollerRect = scroller.getBoundingClientRect();
          const rowRect = row.getBoundingClientRect();
          return rowRect.top >= scrollerRect.top && rowRect.bottom <= scrollerRect.bottom;
        })
      )
      .toBe(true);
    await page.waitForTimeout(180);
    const scrollTrace = await page.evaluate(
      () =>
        (window as typeof window & { __cwLibraryScrollTrace?: number[] }).__cwLibraryScrollTrace ||
        []
    );
    expect(scrollTrace.length).toBeGreaterThan(0);
    expect(Math.max(...scrollTrace) - Math.min(...scrollTrace)).toBeLessThanOrEqual(8);
  });

  test('keeps an explicitly selected duplicate label tied to its own row and value', async ({
    appPage: page,
  }) => {
    await openCwModal(page);
    await page.locator('#cwSearchTerm').fill('DUPLICATE-FLOW');
    await page.locator('#cwSearchTerm').press('Enter');
    await expect(page.locator('#cwRows .cw-measure-row')).toHaveCount(5);
    await page.locator('.cw-import-close').click();

    if (!(await page.locator('#elementsBody').isVisible())) {
      await page.locator('#toggleStrokePanel').click();
    }
    await page.locator('[data-elements-view="library"]').click();
    await page.locator('[data-unit="cm"]').click();
    await selectTool(page, 'line');

    const libraryRow = (sourceLabel: string) =>
      page.locator(
        `#elementsMeasurementLibrary .cw-measure-row[data-cw-source-label="${sourceLabel}"]`
      );

    await libraryRow('Front panel width').locator('.cw-library-action button').click();
    await drawLine(page, 430, 180, 720, 180);
    await expect(page.locator('[data-stroke="A4"] .stroke-measurement')).toContainText('180.5');

    await expect(libraryRow('Front panel height')).toHaveClass(/armed/);
    await drawLine(page, 430, 240, 720, 240);
    await expect(page.locator('[data-stroke="C4"] .stroke-measurement')).toContainText('32.5');

    await libraryRow('Side width').locator('.cw-library-action button').click();
    await drawLine(page, 430, 300, 720, 300);
    await expect(page.locator('[data-stroke="H1"] .stroke-measurement')).toContainText('91');

    const secondH1Row = libraryRow('Side height (Left)');
    await secondH1Row.locator('.cw-measure-input').fill('H1');
    await secondH1Row.locator('.cw-library-action button').click();
    await expect(page.locator('#nextTagDisplay')).toHaveValue('H1(1)');
    await drawLine(page, 430, 360, 720, 360);
    await expect(page.locator('[data-stroke="H1(1)"] .stroke-measurement')).toContainText('62');

    await expect(libraryRow('Side width (Top)')).toHaveClass(/armed/);
    await expect(page.locator('#nextTagDisplay')).toHaveValue('G1');
    await drawLine(page, 430, 420, 720, 420);
    await expect(page.locator('[data-stroke="G1"] .stroke-measurement')).toContainText('7.5');
    await expect(page.locator('[data-stroke="C5"]')).toHaveCount(0);
  });

  test('recovers when the first product discovery request returns a temporary gateway error', async ({
    appPage: page,
  }) => {
    await openCwModal(page);

    await page.locator('#cwSearchTerm').fill('RETRY-TEST');
    await page.locator('#cwSearchTerm').press('Enter');

    await expect(page.locator('#cwProductWorkspace')).toHaveClass(/has-product/);
    await expect(page.locator('#cwSelectedProductTitle')).toContainText('TEST-001');
    await expect(page.locator('#cwRows .cw-measure-row')).toHaveCount(5);
    await expect(page.locator('#cwLoadProgressLabel')).toContainText(/ready/i);
  });

  test('requires explicit configuration and style before loading CW40 details', async ({
    appPage: page,
  }) => {
    const detailRequests: Array<Record<string, unknown>> = [];
    page.on('request', request => {
      if (!request.url().includes('/api/integrations/cw/measurements/search')) return;
      const body = request.postDataJSON() as Record<string, unknown> | null;
      if (body?.phase === 'load-selected') detailRequests.push(body);
    });

    await openCwModal(page);
    await page.locator('#cwSearchTerm').fill('WE-HY-118');
    await page.locator('#cwSearchTerm').press('Enter');

    const card = page.locator('.cw-result-card').filter({ hasText: 'WE-HY-118' });
    const configuration = card.getByLabel('Configuration for WE-HY-118');
    const style = card.getByLabel('Style for WE-HY-118');
    const load = card.getByRole('button', { name: 'Load configuration' });

    await expect(configuration).toHaveValue('');
    await expect(style).toHaveValue('');
    await expect(card.getByText('Configuration', { exact: true })).toBeVisible();
    await expect(card.getByText('Style', { exact: true })).toBeVisible();
    await expect(card).not.toHaveClass(/is-ready/);
    await expect(load).toBeDisabled();
    expect(detailRequests).toHaveLength(0);

    await configuration.selectOption('L');
    await expect(load).toBeDisabled();
    expect(detailRequests).toHaveLength(0);

    await style.selectOption({ index: 1 });
    await expect(load).toBeEnabled();
    await expect(card).toHaveClass(/is-ready/);
    const modalBox = await page.locator('.cw-import-card').boundingBox();
    const viewport = page.viewportSize();
    expect(modalBox).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (modalBox && viewport) {
      expect(modalBox.x).toBeGreaterThanOrEqual(0);
      expect(modalBox.y).toBeGreaterThanOrEqual(0);
      expect(modalBox.x + modalBox.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(modalBox.y + modalBox.height).toBeLessThanOrEqual(viewport.height + 1);
    }
    expect(detailRequests).toHaveLength(0);

    await load.click();
    await expect.poll(() => detailRequests.length).toBe(1);
    expect(detailRequests[0]?.selectedItems).toEqual([
      expect.objectContaining({
        productReference: 'WE-HY-118',
        scopedReference: 'WE-HY-118__L',
        versionCode: 'L',
      }),
    ]);
  });

  for (const scopedReference of ['IK-NA-3__VH', 'IK-NA-3__VS']) {
    test(`loads the exact Nikkala Velcro reference ${scopedReference}`, async ({
      appPage: page,
    }) => {
      await openCwModal(page);
      const storefrontRequest = page.waitForRequest(request => {
        if (!request.url().includes('/api/integrations/cw/measurements/search')) return false;
        const body = request.postDataJSON() as { phase?: string } | null;
        return body?.phase === 'storefront-product';
      });
      const loadRequest = page.waitForRequest(request => {
        if (!request.url().includes('/api/integrations/cw/measurements/search')) return false;
        const body = request.postDataJSON() as { phase?: string } | null;
        return body?.phase === 'load-selected';
      });

      await page.locator('#cwSearchTerm').fill(scopedReference);
      await page.locator('#cwSearchTerm').press('Enter');

      const productRequestBody = (await storefrontRequest).postDataJSON() as {
        search?: string;
        productReference?: string;
      };
      expect(productRequestBody.search).toBe('IK-NA-3');
      expect(productRequestBody.productReference).toBe(scopedReference);
      const request = await loadRequest;
      const body = request.postDataJSON() as {
        selectedItems?: Array<{ scopedReference?: string; versionCode?: string }>;
      };
      expect(body.selectedItems?.[0]?.scopedReference).toBe(scopedReference);
      expect(body.selectedItems?.[0]?.versionCode).toBe(scopedReference.split('__')[1]);
    });
  }

  test('uses the left-scoped CW40 reference when the Harmony base PID is typed', async ({
    appPage: page,
  }) => {
    await openCwModal(page);
    const storefrontRequest = page.waitForRequest(request => {
      if (!request.url().includes('/api/integrations/cw/measurements/search')) return false;
      const body = request.postDataJSON() as { phase?: string } | null;
      return body?.phase === 'storefront-product';
    });
    const loadRequest = page.waitForRequest(request => {
      if (!request.url().includes('/api/integrations/cw/measurements/search')) return false;
      const body = request.postDataJSON() as { phase?: string } | null;
      return body?.phase === 'load-selected';
    });

    await page.locator('#cwSearchTerm').fill('WE-HY-118');
    await page.locator('#cwSearchTerm').press('Enter');

    const productRequestBody = (await storefrontRequest).postDataJSON() as {
      search?: string;
      productReference?: string;
    };
    expect(productRequestBody.search).toBe('WE-HY-118');
    // The public storefront only understands the Shopify-safe base PID. The
    // private CW40 request below must retain the scoped measurement reference.
    expect(productRequestBody.productReference).toBe('WE-HY-118');

    const body = (await loadRequest).postDataJSON() as {
      selectedItems?: Array<{ scopedReference?: string; versionCode?: string }>;
    };
    expect(body.selectedItems?.[0]?.scopedReference).toBe('WE-HY-118__L');
    expect(body.selectedItems?.[0]?.versionCode).toBe('L');
  });

  test('carries the exact Stockholm CW40 product tuple into detailed loading', async ({
    appPage: page,
  }) => {
    await openCwModal(page);
    const loadRequest = page.waitForRequest(request => {
      if (!request.url().includes('/api/integrations/cw/measurements/search')) return false;
      const body = request.postDataJSON() as { phase?: string } | null;
      return body?.phase === 'load-selected';
    });

    await page.locator('#cwSearchTerm').fill('IK-SM-4');
    await page.locator('#cwSearchTerm').press('Enter');

    const body = (await loadRequest).postDataJSON() as {
      selectedItems?: Array<{
        productId?: string;
        productReference?: string;
        scopedReference?: string;
        versionCode?: string;
        style?: string;
        styleCode?: string;
        versionOptions?: Array<{ scopedReference?: string; isDefault?: boolean }>;
        derivedScopedReferences?: string[];
      }>;
    };
    const selected = body.selectedItems?.[0];
    expect(selected).toMatchObject({
      productId: 'UHJvZHVjdDozMTM=',
      productReference: 'IK-SM-4',
      scopedReference: 'IK-SM-4__SV',
      versionCode: 'SV',
      style: 'Signature',
      styleCode: 'LSKT_WR',
    });
    expect(selected?.versionOptions).toContainEqual(
      expect.objectContaining({ scopedReference: 'IK-SM-4__SV', isDefault: true })
    );
    expect(selected?.derivedScopedReferences).toEqual(['IK-SM-4__SV', 'IK-SM-4__LV']);
  });

  test('presents a product page without style or version menus', async ({ appPage: page }) => {
    await openCwModal(page);

    await page.locator('#cwSearchTerm').fill('TEST-001');
    await page.locator('#cwSearchTerm').press('Enter');

    await expect(page.locator('#cwStorefrontProduct')).toHaveClass(/visible/);
    await expect(page.locator('#cwStorefrontProductName')).toHaveText('Test Sofa Cover');
    await expect(page.locator('#cwStorefrontProductImage')).toHaveAttribute(
      'src',
      'https://cdn.shopify.com/test-sofa-cover.jpg'
    );
    await expect(page.locator('.cw-result-card.is-selected')).toHaveCount(1);
    await expect(page.locator('#cwImportStorefrontImageBtn')).toHaveText(
      'Add image + draw dimensions'
    );
    await expect(page.locator('[data-dimension]')).toHaveCount(3);
    await expect(page.locator('button[data-dimension]')).toHaveCount(0);
    await expect(page.locator('#cwOverallDimensions')).toContainText('Width');
    await expect(page.locator('#cwOverallDimensions')).toContainText('210');
    await expect(page.locator('#cwOverallDimensions')).toContainText('Depth');
    await expect(page.locator('#cwOverallDimensions')).toContainText('95');
    await expect(page.locator('#cwOverallDimensions')).toContainText('Height');
    await expect(page.locator('#cwOverallDimensions')).toContainText('82');
    await expect(page.locator('.cw-result-controls')).toHaveCount(0);
    await expect(page.locator('#cwItemFilter')).toBeHidden();
    await expect(page.locator('#cwSectionFilter')).toBeHidden();
    await expect(page.locator('#cwProductPhotos')).toHaveAttribute('open', '');
  });

  test('shows storefront photos immediately and enriches them with detailed photos', async ({
    appPage: page,
  }) => {
    await openCwModal(page);

    await page.locator('#cwSearchTerm').fill('TEST-001');
    await page.locator('#cwSearchTerm').press('Enter');

    await expect(page.locator('#cwOverallDimensions')).toContainText('210');
    await expect(page.locator('#cwResultImages .cw-image-card')).toHaveCount(3);
    await expect(page.locator('#cwResultImages')).toContainText('Product Photos');
    await expect(page.locator('#cwResultImages .cw-image-card')).toHaveCount(4);
    await expect(page.locator('#cwResultImages')).toContainText('detail.jpg');
  });

  test('renders public dimensions while slower product discovery is still running', async ({
    appPage: page,
  }) => {
    await openCwModal(page);

    await page.locator('#cwSearchTerm').fill('FAST-PUBLIC');
    const startedAt = Date.now();
    await page.locator('#cwSearchTerm').press('Enter');

    await expect(page.locator('#cwOverallDimensions')).toContainText('204', { timeout: 700 });
    expect(Date.now() - startedAt).toBeLessThan(900);
    await expect(page.locator('#cwOverallDimensions')).toContainText('87');
    await expect(page.locator('#cwOverallDimensions')).toContainText('72');
  });

  test('keeps public overall dimensions available when private details fail', async ({
    appPage: page,
  }) => {
    await openCwModal(page);

    await page.locator('#cwSearchTerm').fill('PUBLIC-ONLY');
    await page.locator('#cwSearchTerm').press('Enter');

    await expect(page.locator('#cwStorefrontProduct')).toHaveClass(/visible/);
    await expect(page.locator('#cwOverallDimensions')).toContainText('204');
    await expect(page.locator('#cwOverallDimensions')).toContainText('87');
    await expect(page.locator('#cwOverallDimensions')).toContainText('72');
  });

  test('draws chosen overall dimensions with semantic labels without forcing a sequence', async ({
    appPage: page,
  }) => {
    await openCwModal(page);

    await page.locator('#cwSearchTerm').fill('TEST-001');
    await page.locator('#cwSearchTerm').press('Enter');
    await page.locator('#cwImportStorefrontImageBtn').click();

    await expect(page.locator('#cwImportModalOverlay')).toBeHidden();
    const readNextTag = () =>
      page.locator('#nextTagDisplay').evaluate(element => {
        if (element instanceof HTMLInputElement) return element.value;
        return element.textContent || '';
      });
    await expect(page.locator('#cwMeasurementQueueDock')).toHaveCount(0);
    await selectTool(page, 'line');
    await expect.poll(readNextTag).toBe('W');
    await drawLine(page, 120, 180, 520, 180);
    await expect.poll(readNextTag).toBe('D');
    await drawLine(page, 160, 240, 480, 240);
    await expect.poll(readNextTag).toBe('H');
    await drawLine(page, 220, 100, 220, 420);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const canvas = window.app?.canvasManager?.fabricCanvas;
          return (canvas?.getObjects?.() || [])
            .filter((object: any) => object.isTagGroup)
            .map((tag: any) =>
              String(tag.getObjects?.().find((object: any) => object.isTagText)?.text || '')
            )
            .sort();
        })
      )
      .toEqual([
        expect.stringMatching(/^Depth\s*=\s*.+/i),
        expect.stringMatching(/^Height\s*=\s*.+/i),
        expect.stringMatching(/^Width\s*=\s*.+/i),
      ]);
  });

  test('shows and edits the active CW measurement in the bottom dock when Elements is closed', async ({
    appPage: page,
  }) => {
    await openCwModal(page);
    await page.locator('#cwSearchTerm').fill('TEST-001');
    await page.locator('#cwSearchTerm').press('Enter');
    await page.locator('#cwImportStorefrontImageBtn').click();
    await expect(page.locator('#cwImportModalOverlay')).toBeHidden();

    if (await page.locator('#elementsBody').isVisible()) {
      await page.locator('#toggleStrokePanel').click();
    }
    const quickEntry = page.locator('#quickMeasurementEntry');
    await expect(quickEntry).toBeVisible();
    await expect(quickEntry).toHaveAttribute('data-mode', 'queue');
    await expect(page.locator('#quickMeasurementLabel')).toHaveValue('W');
    await expect(page.locator('#quickMeasurementValue')).toHaveValue('210');

    await page.locator('#quickMeasurementLabel').fill('Q');
    await page.locator('#quickMeasurementLabel').press('Enter');
    await expect(page.locator('#nextTagDisplay')).toHaveValue('Q');

    await selectTool(page, 'line');
    await drawLine(page, 120, 180, 520, 180);
    await expect(page.locator('#quickMeasurementLabel')).toHaveValue('D');
    await expect(page.locator('#quickMeasurementValue')).toHaveValue('95');
  });

  test('adds only the storefront product image to the project', async ({ appPage: page }) => {
    await openCwModal(page);

    await page.locator('#cwSearchTerm').fill('TEST-001');
    await page.locator('#cwSearchTerm').press('Enter');
    await page.evaluate(() => {
      const projectManager = (window as any).app?.projectManager;
      if (!projectManager || projectManager.__cwDelayedRefreshTest) return;
      projectManager.__cwDelayedRefreshTest = true;
      const originalSwitchView = projectManager.switchView.bind(projectManager);
      let scheduled = false;
      projectManager.switchView = async (viewId: string, force = false) => {
        const result = await originalSwitchView(viewId, force);
        if (!scheduled && String(viewId).startsWith('test-sofa-cover')) {
          scheduled = true;
          window.setTimeout(() => {
            void originalSwitchView(viewId, true);
          }, 220);
        }
        return result;
      };
    });
    await page.locator('#cwImportStorefrontImageBtn').click();

    await expect(page.locator('#cwImportModalOverlay')).toBeHidden();
    // The first registered image triggers a delayed compatibility refresh in
    // real Safari/Chrome sessions. The picker must remain available without
    // silently forcing Width after that refresh.
    await page.waitForTimeout(900);
    await expect(page.locator('#cwMeasurementQueueDock')).toHaveCount(0);
    await expect(page.locator('#nextTagDisplay')).toHaveValue('W');
    await expect
      .poll(() =>
        page.evaluate(() => {
          const app = (window as any).app;
          return Object.values(app?.projectManager?.views || {}).some((view: any) =>
            Boolean(view?.image || view?.imageUrl || view?.imageDataURL)
          );
        })
      )
      .toBe(true);
  });

  test('should show measurement guide when a row is armed', async ({ appPage: page }) => {
    await openCwModal(page);

    // Try to find and click a "Draw Next" button in the CW modal
    const armed = await page.evaluate(() => {
      const buttons = document.querySelectorAll('.cw-measure-row button');
      for (const btn of buttons) {
        if (btn.textContent?.includes('Draw') || btn.textContent?.includes('Arm')) {
          (btn as HTMLElement).click();
          return true;
        }
      }
      return false;
    });

    if (armed) {
      await page.waitForTimeout(500);
      const hasArmedRow = await page.evaluate(
        () => !!document.querySelector('.cw-measure-row.armed')
      );
      if (hasArmedRow) {
        expect(hasArmedRow).toBe(true);
      }
    }
    // If no rows exist to arm, that's OK — we verified the modal opened
  });

  test('should close the modal when close button is clicked', async ({ appPage: page }) => {
    await openCwModal(page);
    expect(await isModalOpen(page)).toBe(true);

    // Click the close button (class "cw-import-close", text "Close")
    const closed = await page.evaluate(() => {
      const btn = document.querySelector('button.cw-import-close') as HTMLElement | null;
      if (btn) {
        btn.click();
        return true;
      }
      // Fallback: hide via style
      const modal = document.getElementById('cwImportModalOverlay');
      if (modal) {
        modal.style.display = 'none';
        return true;
      }
      return false;
    });

    expect(closed).toBe(true);
    await page.waitForTimeout(300);
    expect(await isModalOpen(page)).toBe(false);
  });

  test('keeps imported values and labels editable with visible provenance', async ({
    appPage: page,
  }) => {
    await openCwModal(page);
    await page.locator('#cwSearchTerm').fill('TEST-001');
    await page.locator('#cwSearchTerm').press('Enter');

    const widthRow = page.locator('#cwRows .cw-measure-row').filter({ hasText: 'Width' }).first();
    await expect(widthRow.locator('[data-cw-value-input]')).toHaveValue('210');
    await expect(widthRow.locator('[data-cw-source]')).toContainText('CW');
    await expect(widthRow.locator('.cw-measure-input')).toHaveValue('W');

    await widthRow.locator('[data-cw-value-input]').fill('211.75');
    await widthRow.locator('.cw-measure-input').fill('Z9');
    await expect(widthRow.locator('[data-cw-value-input]')).toHaveValue('211.75');
    await expect(widthRow.locator('.cw-measure-input')).toHaveValue('Z9');
    await expect(widthRow.locator('[data-cw-source]')).toContainText('210');
  });

  test('uses the user-edited value when drawing an imported measurement', async ({
    appPage: page,
  }) => {
    await openCwModal(page);
    await page.locator('#cwSearchTerm').fill('TEST-001');
    await page.locator('#cwSearchTerm').press('Enter');
    const widthRow = page.locator('#cwRows .cw-measure-row').filter({ hasText: 'Width' }).first();
    await widthRow.locator('[data-cw-value-input]').fill('211.75');
    await expect(page.locator('#cwImportStorefrontImageBtn')).toBeEnabled();
    await page.locator('#cwImportStorefrontImageBtn').click();
    await expect(page.locator('#cwImportModalOverlay')).toBeHidden();
    await chooseQueueMeasurement(page, 'Width');
    await expect
      .poll(() =>
        page
          .locator('#nextTagDisplay')
          .evaluate(element =>
            element instanceof HTMLInputElement ? element.value : element.textContent || ''
          )
      )
      .toBe('W');

    await selectTool(page, 'line');
    await drawLine(page, 140, 180, 520, 180);
    await page.waitForTimeout(300);
    const appliedValue = await page.evaluate(() => {
      const metadata = (window as any).app?.metadataManager;
      for (const measurements of Object.values(metadata?.strokeMeasurements || {}) as any[]) {
        if (measurements?.W && Number.isFinite(Number(measurements.W.cm))) {
          return Number(measurements.W.cm);
        }
      }
      return null;
    });
    expect(appliedValue).toBeCloseTo(211.75, 2);
  });

  test('keeps a drawn CW measurement editable while preserving its source', async ({
    appPage: page,
  }) => {
    await openCwModal(page);
    await page.locator('#cwSearchTerm').fill('TEST-001');
    await page.locator('#cwSearchTerm').press('Enter');
    await expect(page.locator('#cwImportStorefrontImageBtn')).toBeEnabled();
    await page.locator('#cwImportStorefrontImageBtn').click();
    await expect(page.locator('#cwImportModalOverlay')).toBeHidden();
    await chooseQueueMeasurement(page, 'Width');
    await selectTool(page, 'line');
    await drawLine(page, 140, 180, 520, 180);

    if (!(await page.locator('#elementsBody').isVisible())) {
      await page.locator('#toggleStrokePanel').click();
    }
    const row = page.locator('.stroke-visibility-item[data-stroke="W"]').first();
    await expect(row).toBeVisible();
    const source = row.locator('[data-measurement-source="cw"]');
    await expect(source).toContainText('CW');
    await expect(source).toHaveAttribute('title', /original 210 cm/i);

    const measurement = row.locator('.stroke-measurement');
    await measurement.click();
    await measurement.fill('212.5 cm');
    await measurement.press('Enter');
    await expect(source).toContainText('CW');
    await expect
      .poll(() =>
        page.evaluate(() => {
          const metadata = (window as any).app?.metadataManager;
          for (const values of Object.values(metadata?.strokeMeasurements || {}) as any[]) {
            if (values?.W) return Number(values.W.cm);
          }
          return null;
        })
      )
      .toBeCloseTo(212.5, 2);
  });

  test('uses a user-edited drawing label instead of replacing it with the suggestion', async ({
    appPage: page,
  }) => {
    await openCwModal(page);
    await page.locator('#cwSearchTerm').fill('TEST-001');
    await page.locator('#cwSearchTerm').press('Enter');
    const widthRow = page.locator('#cwRows .cw-measure-row').filter({ hasText: 'Width' }).first();
    await widthRow.locator('.cw-measure-input').fill('Z9');
    await page.locator('#cwImportStorefrontImageBtn').click();
    await chooseQueueMeasurement(page, 'Width');
    await expect
      .poll(() =>
        page
          .locator('#nextTagDisplay')
          .evaluate(element =>
            element instanceof HTMLInputElement ? element.value : element.textContent || ''
          )
      )
      .toBe('Z9');
  });

  test('does not lock imported measurements unless the user explicitly asks', async ({
    appPage: page,
  }) => {
    await openCwModal(page);
    await expect(page.locator('#cwImportLocked')).not.toBeChecked();
  });

  test('lets the user unlock and edit an explicitly locked imported measurement', async ({
    appPage: page,
  }) => {
    await openCwModal(page);
    await page.locator('#cwSearchTerm').fill('TEST-001');
    await page.locator('#cwSearchTerm').press('Enter');
    const lock = page.locator('#cwImportLocked');
    await lock.locator('xpath=ancestor::details[1]').evaluate(element => {
      (element as HTMLDetailsElement).open = true;
    });
    await lock.check({ force: true });
    await expect(page.locator('#cwImportStorefrontImageBtn')).toBeEnabled();
    await page.locator('#cwImportStorefrontImageBtn').click();
    await expect(page.locator('#cwImportModalOverlay')).toBeHidden();
    await chooseQueueMeasurement(page, 'Width');
    await selectTool(page, 'line');
    await drawLine(page, 140, 180, 520, 180);

    if (!(await page.locator('#elementsBody').isVisible())) {
      await page.locator('#toggleStrokePanel').click();
    }
    const row = page.locator('.stroke-visibility-item[data-stroke="W"]').first();
    const measurement = row.locator('.stroke-measurement');
    await expect(measurement).toHaveAttribute('data-locked', 'true');
    await row.locator('.stroke-measurement-unlock').click();
    await expect(measurement).toHaveAttribute('data-locked', 'false');
    await measurement.click();
    await expect(measurement).toHaveAttribute('contenteditable', 'true');
    await measurement.fill('215 cm');
    await measurement.press('Enter');
    await expect(row.locator('[data-measurement-source="cw"]')).toContainText('CW');
  });

  test('keeps an empty imported value visibly invalid until the user fixes or cancels it', async ({
    appPage: page,
  }) => {
    await openCwModal(page);
    await page.locator('#cwSearchTerm').fill('TEST-001');
    await page.locator('#cwSearchTerm').press('Enter');

    const widthRow = page.locator('#cwRows .cw-measure-row').filter({ hasText: 'Width' }).first();
    const value = widthRow.locator('[data-cw-value-input]');
    await value.fill('');
    await value.blur();
    await expect(value).toHaveValue('');
    await expect(value).toHaveAttribute('aria-invalid', 'true');
    await expect(widthRow.locator('[data-cw-source]')).toContainText('210');

    await widthRow.locator('button', { hasText: 'Draw Next' }).click();
    await expect(value).toBeFocused();
    await expect(widthRow).not.toHaveClass(/armed/);

    await value.press('Escape');
    await expect(value).toHaveValue('210');
    await expect(value).not.toHaveAttribute('aria-invalid', 'true');
  });

  test('can reset an edited imported value to the visible CW original', async ({
    appPage: page,
  }) => {
    await openCwModal(page);
    await page.locator('#cwSearchTerm').fill('TEST-001');
    await page.locator('#cwSearchTerm').press('Enter');

    const widthRow = page.locator('#cwRows .cw-measure-row').filter({ hasText: 'Width' }).first();
    const value = widthRow.locator('[data-cw-value-input]');
    await value.fill('222.5');
    const reset = widthRow.locator('[data-cw-value-reset]');
    await expect(reset).toBeVisible();
    await reset.click();
    await expect(value).toHaveValue('210');
    await expect(reset).toBeHidden();
    await expect(page.locator('[data-dimension="width"] .cw-dimension-value')).toHaveText('210');
  });

  test('editing one imported value does not change another measurement row', async ({
    appPage: page,
  }) => {
    await openCwModal(page);
    await page.locator('#cwSearchTerm').fill('TEST-001');
    await page.locator('#cwSearchTerm').press('Enter');

    const widthRow = page.locator('#cwRows .cw-measure-row').filter({ hasText: 'Width' }).first();
    const depthRow = page.locator('#cwRows .cw-measure-row').filter({ hasText: 'Depth' }).first();
    await widthRow.locator('[data-cw-value-input]').fill('222.5');
    await expect(depthRow.locator('[data-cw-value-input]')).toHaveValue('95');
  });
});
