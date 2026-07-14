import { test, expect, waitForApp, selectTool, drawLine } from './fixtures';

const GUIDE_SVG = (code: string, view: string) =>
  `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 720" width="960" height="720">
    <rect x="0" y="0" width="960" height="720" fill="#f8fafc" />
    <rect id="sofa-shape" x="180" y="300" width="600" height="280" rx="44" fill="#f97316" stroke="#0f172a" stroke-width="8" />
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

const WORKFLOW_GUIDE_SVG = (view: string) => {
  const labels =
    view === 'front' ? ['A1', 'A2', 'A3'] : view === 'back' ? ['B1', 'B2'] : ['C1', 'C2'];
  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 720" width="960" height="720">
      <rect x="0" y="0" width="960" height="720" fill="#f8fafc" />
      <path d="M160 570 L220 300 L740 300 L800 570 Z" fill="#f97316" stroke="#0f172a" stroke-width="8" />
      ${labels
        .map((label, index) => {
          const y = 190 + index * 130;
          const token = label.toLowerCase();
          return `
            <g id="m${token}cm">
              <line x1="170" y1="${y}" x2="790" y2="${y}" stroke="#2563eb" stroke-width="7" />
            </g>
            <g id="c${token}cm">
              <rect x="430" y="${y - 56}" width="100" height="44" fill="#fff" stroke="#0f172a" />
              <text x="460" y="${y - 25}" font-size="26" fill="#0f172a">${label}</text>
            </g>
          `;
        })
        .join('')}
    </svg>
  `.trim();
};

test.describe('Measurement Guide Gallery import attachment', () => {
  test('Add All reconciles guide controls after the image header moves them', async ({ page }) => {
    const indicatorErrors: string[] = [];
    page.on('console', message => {
      if (
        message.type() === 'error' &&
        message.text().includes('[measurement-guide-indicator] Render error')
      ) {
        indicatorErrors.push(message.text());
      }
    });
    page.on('pageerror', error => {
      if (error.name === 'NotFoundError') indicatorErrors.push(error.message);
    });

    await page.route('**/api/measurement-guides/codes', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          count: 1,
          codes: ['CS1-CNR'],
          viewsByCode: { 'CS1-CNR': ['front', 'back'] },
        }),
      });
    });
    await page.route('**/api/measurement-guides/svg**', async route => {
      const url = new URL(route.request().url());
      const view = String(url.searchParams.get('view') || 'front').toLowerCase();
      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml; charset=utf-8',
        body: GUIDE_SVG('CS1-CNR', view),
      });
    });

    await page.goto('/');
    await waitForApp(page);
    await expect(page.locator('#measurementGuideToggleStack')).toBeAttached();

    // Reproduce the connected-but-reparented state seen during the image-panel
    // header refresh: the collapse button remains inside the persistent stack,
    // while the stack itself is no longer a child of the controls container.
    await page.evaluate(() => {
      const header = document.getElementById('imagePanelHeader');
      const stack = document.getElementById('measurementGuideToggleStack');
      if (!header || !stack) throw new Error('Guide header controls unavailable');
      header.appendChild(stack);
    });

    await page.evaluate(() => window.openMeasurementGuideGallery?.({ mode: 'select' }));
    await page.locator('[data-guide-quick-add="CS1-CNR"][data-guide-quick-view="all"]').click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          ['cs1-cnr-front', 'cs1-cnr-back'].every(id =>
            Boolean(window.app?.projectManager?.views?.[id]?.image)
          )
        )
      )
      .toBe(true);

    for (const viewId of ['cs1-cnr-front', 'cs1-cnr-back', 'cs1-cnr-front']) {
      await page.evaluate(id => window.app?.projectManager?.switchView?.(id, true), viewId);
      await expect
        .poll(() => page.evaluate(() => window.app?.projectManager?.currentViewId))
        .toBe(viewId);
    }

    await page.waitForTimeout(350);
    expect(indicatorErrors).toEqual([]);
    await expect(page.locator('#measurementGuideToggleStack')).toBeAttached();
    expect(
      await page.evaluate(() => {
        const header = document.getElementById('imagePanelHeader');
        const controls = header?.querySelector('.flex.items-center.gap-2');
        const stack = document.getElementById('measurementGuideToggleStack');
        return stack?.parentElement === controls;
      })
    ).toBe(true);

    await page.locator('.guide-gallery-overlay.visible .guide-gallery-close').click();
    const backStep = page.locator(
      '#mini-stepper button[data-target="cs1-cnr-back"][data-step-kind="image"]'
    );
    await expect(backStep).toBeVisible();
    await page.evaluate(() => {
      const manager = window.app?.projectManager;
      if (!manager) throw new Error('Project manager unavailable');
      const originalSwitchView = manager.switchView.bind(manager);
      manager.switchView = async (...args) => {
        (window as any).__galleryTestSuppressedAtSwitch =
          Date.now() < Number(window.__imageListProgrammaticScrollUntil || 0);
        return originalSwitchView(...args);
      };
    });
    await backStep.click();
    expect(await page.evaluate(() => (window as any).__galleryTestSuppressedAtSwitch)).toBe(true);
    await expect
      .poll(() => page.evaluate(() => window.app?.projectManager?.currentViewId), {
        timeout: 1_500,
      })
      .toBe('cs1-cnr-back');
    await page.waitForTimeout(650);
    expect(await page.evaluate(() => window.app?.projectManager?.currentViewId)).toBe(
      'cs1-cnr-back'
    );
    expect(indicatorErrors).toEqual([]);

    await page.evaluate(() => {
      const strokePanel = document.getElementById('strokePanel');
      const elementsBody = document.getElementById('elementsBody');
      strokePanel?.classList.remove('minimized', 'collapsed');
      strokePanel?.setAttribute('aria-expanded', 'true');
      elementsBody?.classList.remove('hidden');
      if (elementsBody) elementsBody.style.display = 'flex';
      window.app?.metadataManager?.updateStrokeVisibilityControls?.();
    });

    const enterMeasurement = async (viewId: string, value: string) => {
      await page.evaluate(id => window.app?.projectManager?.switchView?.(id, true), viewId);
      await expect
        .poll(() => page.evaluate(() => window.app?.projectManager?.currentViewId))
        .toBe(viewId);
      const field = page.locator('[data-stroke="A1"] .stroke-measurement');
      await expect(field).toBeVisible();
      await field.click();
      await expect(field).toHaveAttribute('contenteditable', 'true');
      await field.fill(value);
      await field.press('Enter');
      await expect(field).toContainText(value);
    };

    await enterMeasurement('cs1-cnr-front', '24');
    await enterMeasurement('cs1-cnr-back', '31');

    for (const [viewId, value] of [
      ['cs1-cnr-front', '24'],
      ['cs1-cnr-back', '31'],
      ['cs1-cnr-front', '24'],
      ['cs1-cnr-back', '31'],
    ] as const) {
      await page.evaluate(id => window.app?.projectManager?.switchView?.(id, true), viewId);
      await expect
        .poll(() => page.evaluate(() => window.app?.projectManager?.currentViewId))
        .toBe(viewId);
      await expect(page.locator('[data-stroke="A1"] .stroke-measurement')).toContainText(value);

      const state = await page.evaluate(id => {
        const canvas = window.app?.canvasManager?.fabricCanvas;
        const list = document.getElementById('imageList');
        const active = list?.querySelector<HTMLElement>(`.image-container[data-label="${id}"]`);
        const listRect = list?.getBoundingClientRect();
        const activeRect = active?.getBoundingClientRect();
        const preview = active?.querySelector<HTMLElement>('.pasted-image');
        const cardStyle = active ? getComputedStyle(active) : null;
        const previewStyle = preview ? getComputedStyle(preview) : null;
        const objects = canvas?.getObjects?.() || [];
        return {
          visibleStrokeCount: objects.filter(
            object =>
              object?.visible !== false &&
              (object?.strokeMetadata?.strokeLabel || object?.strokeLabel) === 'A1' &&
              object?.isTag !== true
          ).length,
          visibleTagCount: objects.filter(
            object => object?.visible !== false && object?.isTag && object?.strokeLabel === 'A1'
          ).length,
          thumbnailFullyVisible: Boolean(
            listRect &&
              activeRect &&
              activeRect.left >= listRect.left - 1 &&
              activeRect.right <= listRect.right + 1 &&
              activeRect.top >= listRect.top - 1 &&
              activeRect.bottom <= listRect.bottom + 1
          ),
          cardTransform: cardStyle?.transform || '',
          cardOverflow: cardStyle?.overflow || '',
          previewBackground: previewStyle?.backgroundColor || '',
        };
      }, viewId);
      expect(state.visibleStrokeCount).toBeGreaterThan(0);
      expect(state.visibleTagCount).toBeGreaterThan(0);
      expect(state.thumbnailFullyVisible).toBe(true);
      expect(state.cardTransform).toBe('none');
      expect(state.cardOverflow).toBe('hidden');
      expect(state.previewBackground).toBe('rgb(255, 255, 255)');
    }
  });

  test('CS1L Add All preserves independent visibility while drawing and deleting measurements', async ({
    page,
  }) => {
    await page.route('**/api/measurement-guides/codes', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          count: 1,
          codes: ['CS1L-RA-HB'],
          viewsByCode: { 'CS1L-RA-HB': ['front', 'back', 'side'] },
        }),
      });
    });
    await page.route('**/api/measurement-guides/svg**', async route => {
      const url = new URL(route.request().url());
      const view = String(url.searchParams.get('view') || 'front').toLowerCase();
      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml; charset=utf-8',
        body: WORKFLOW_GUIDE_SVG(view),
      });
    });

    await page.goto('/');
    await waitForApp(page);
    await page.evaluate(() => window.openMeasurementGuideGallery?.({ mode: 'select' }));
    await page.locator('[data-guide-quick-add="CS1L-RA-HB"][data-guide-quick-view="all"]').click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          ['cs1l-ra-hb-front', 'cs1l-ra-hb-back', 'cs1l-ra-hb-side'].every(id =>
            Boolean(window.app?.projectManager?.views?.[id]?.image)
          )
        )
      )
      .toBe(true);
    await page.locator('.guide-gallery-overlay.visible .guide-gallery-close').click();

    const switchTo = async (viewId: string) => {
      await page.evaluate(id => window.app?.projectManager?.switchView?.(id, true), viewId);
      await expect
        .poll(() => page.evaluate(() => window.app?.projectManager?.currentViewId))
        .toBe(viewId);
      await page.waitForTimeout(250);
    };
    const inspect = (viewId: string) =>
      page.evaluate(id => {
        const metadata = window.app?.metadataManager;
        const canvas = window.app?.canvasManager?.fabricCanvas;
        const scoped = metadata?.resolveActiveImageLabel?.(id) || id;
        const baseStrokes = metadata?.vectorStrokesByImage?.[id] || {};
        const scopedStrokes = metadata?.vectorStrokesByImage?.[scoped] || {};
        const strokes = { ...baseStrokes, ...scopedStrokes };
        const rows = Array.from(
          document.querySelectorAll<HTMLElement>('#strokesList [data-stroke]')
        );
        return {
          scoped,
          labels: Object.keys(strokes).sort(),
          rows: rows.map(row => row.dataset.stroke || '').sort(),
          visibleLabels: Object.entries(strokes)
            .filter(([, object]) => object?.visible !== false)
            .map(([label]) => label)
            .sort(),
          canvasStrokeLabels: (canvas?.getObjects?.() || [])
            .filter(
              object =>
                object?.strokeMetadata?.imageLabel === id ||
                object?.strokeMetadata?.imageLabel === scoped
            )
            .filter(object => object?.strokeMetadata?.strokeLabel || object?.strokeMetadata?.label)
            .map(object => object.strokeMetadata.strokeLabel || object.strokeMetadata.label)
            .sort(),
          visibleTags: (canvas?.getObjects?.() || [])
            .filter(object => object?.isTag && object?.visible !== false)
            .map(object => object.strokeLabel)
            .filter(Boolean)
            .sort(),
        };
      }, viewId);

    await switchTo('cs1l-ra-hb-front');
    await expect
      .poll(() => inspect('cs1l-ra-hb-front'))
      .toMatchObject({
        labels: ['A1', 'A2', 'A3'],
        rows: ['A1', 'A2', 'A3'],
        visibleLabels: ['A1', 'A2', 'A3'],
      });

    // Hide one complete measurement and one tag only. The remaining imported
    // measurements must stay visible in this view and every other imported view.
    await page.locator('[data-stroke="A1"] input[type="checkbox"]').evaluate(element => {
      (element as HTMLInputElement).click();
    });
    await page.locator('[data-stroke="A2"] .stroke-label-toggle-btn').evaluate(element => {
      (element as HTMLButtonElement).click();
    });
    await expect
      .poll(() => inspect('cs1l-ra-hb-front'))
      .toMatchObject({
        labels: ['A1', 'A2', 'A3'],
        rows: ['A1', 'A2', 'A3'],
        visibleLabels: ['A2', 'A3'],
        visibleTags: ['A3'],
      });

    await switchTo('cs1l-ra-hb-back');
    await expect
      .poll(() => inspect('cs1l-ra-hb-back'))
      .toMatchObject({
        labels: ['B1', 'B2'],
        rows: ['B1', 'B2'],
        visibleLabels: ['B1', 'B2'],
      });

    // Draw a normal line in the imported back image. Imported rows must remain
    // alongside it rather than being replaced by the frame-scoped bucket.
    await selectTool(page, 'line');
    await drawLine(page, 220, 520, 620, 520);
    await expect
      .poll(async () => {
        const state = await inspect('cs1l-ra-hb-back');
        return {
          labels: state.labels,
          rows: state.rows,
          visibleLabels: state.visibleLabels,
          hasImportedLines: state.labels.includes('B1') && state.labels.includes('B2'),
        };
      })
      .toMatchObject({
        labels: ['A1', 'B1', 'B2'],
        rows: ['A1', 'B1', 'B2'],
        visibleLabels: ['A1', 'B1', 'B2'],
        hasImportedLines: true,
      });

    // Delete one imported measurement and prove it stays deleted after two
    // complete view switches while the new line remains attached to back.
    await page
      .locator('[data-stroke="B1"] [aria-label="Delete stroke B1"]')
      .evaluate(element => (element as HTMLButtonElement).click());
    await expect
      .poll(() => inspect('cs1l-ra-hb-back'))
      .toMatchObject({
        labels: ['A1', 'B2'],
        rows: ['A1', 'B2'],
      });
    await switchTo('cs1l-ra-hb-side');
    await expect
      .poll(() => inspect('cs1l-ra-hb-side'))
      .toMatchObject({
        labels: ['C1', 'C2'],
        rows: ['C1', 'C2'],
        visibleLabels: ['C1', 'C2'],
      });
    await switchTo('cs1l-ra-hb-front');
    await expect
      .poll(() => inspect('cs1l-ra-hb-front'))
      .toMatchObject({
        labels: ['A1', 'A2', 'A3'],
        rows: ['A1', 'A2', 'A3'],
        visibleLabels: ['A2', 'A3'],
      });
    await switchTo('cs1l-ra-hb-back');
    await expect
      .poll(() => inspect('cs1l-ra-hb-back'))
      .toMatchObject({
        labels: ['A1', 'B2'],
        rows: ['A1', 'B2'],
        visibleLabels: ['A1', 'B2'],
      });
  });

  test('codes can be copied and Add Side updates the card preview', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.route('**/api/measurement-guides/codes', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          count: 1,
          codes: ['MULTI'],
          viewsByCode: { MULTI: ['front', 'back', 'side'] },
        }),
      });
    });
    await page.route('**/api/measurement-guides/svg**', async route => {
      const url = new URL(route.request().url());
      const view = String(url.searchParams.get('view') || 'front').toLowerCase();
      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml; charset=utf-8',
        body: GUIDE_SVG('MULTI', view),
      });
    });

    await page.goto('/');
    await waitForApp(page);
    await page.evaluate(() => window.openMeasurementGuideGallery?.({ mode: 'select' }));
    const copyButton = page.locator('[data-copy-guide-code="MULTI"]');
    await expect(copyButton).toBeVisible();
    await copyButton.click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('MULTI');
    expect(
      await page
        .locator('[data-code="MULTI"] .guide-gallery-code')
        .evaluate(element => getComputedStyle(element).userSelect)
    ).toBe('text');

    await page.locator('[data-guide-quick-add="MULTI"][data-guide-quick-view="side"]').click();
    await expect
      .poll(() => page.evaluate(() => Boolean(window.app?.projectManager?.views?.['multi-side'])))
      .toBe(true);
    await expect(page.locator('[data-code="MULTI"] img[data-guide-code="MULTI"]')).toHaveAttribute(
      'data-guide-view',
      'side'
    );
  });

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
      page.evaluate(async () => {
        const manager = window.app?.projectManager;
        const metadata = manager?.getProjectMetadata?.() || {};
        const galleryData = window.imageGallery?.getData?.() || window.imageGalleryData || [];
        const labels = galleryData.map(
          item => item?.original?.label || item?.label || item?.name || ''
        );
        const sidebarLabels = Array.from(document.querySelectorAll('#imageList [data-label]')).map(
          element => element.getAttribute('data-label') || ''
        );
        const importedViewIds = Object.keys(manager?.views || {})
          .filter(id => id.startsWith('pipe-'))
          .sort();
        const integrity = {};
        for (const id of importedViewIds) {
          const imageUrl = manager?.views?.[id]?.image || '';
          const centerPixel = await new Promise(resolve => {
            const image = new Image();
            image.onload = () => {
              const canvas = document.createElement('canvas');
              canvas.width = image.naturalWidth;
              canvas.height = image.naturalHeight;
              const context = canvas.getContext('2d');
              context?.drawImage(image, 0, 0);
              resolve(
                context
                  ? Array.from(context.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data)
                  : []
              );
            };
            image.onerror = () => resolve([]);
            image.src = imageUrl;
          });
          await manager?.switchView?.(id, true);
          const objects = manager?.canvasManager?.fabricCanvas?.getObjects?.() || [];
          const guideLines = objects.filter(object => {
            const scopedLabel = String(object?.strokeMetadata?.imageLabel || '');
            return (
              object?.customData?.source === 'guide-import' ||
              (scopedLabel === id && ['line', 'path'].includes(String(object?.type || '')))
            );
          });
          integrity[id] = {
            centerPixel,
            lineCount: guideLines.length,
            minLineLength: guideLines.length
              ? Math.min(
                  ...guideLines.map(line =>
                    Math.hypot(Number(line.x2) - Number(line.x1), Number(line.y2) - Number(line.y1))
                  )
                )
              : 0,
            tagCount: objects.filter(object => object?.isTagGroup && object?.imageLabel === id)
              .length,
          };
        }
        return {
          views: importedViewIds,
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
          integrity,
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

    await page.evaluate(() => {
      document
        .querySelector<HTMLElement>('.guide-gallery-overlay.visible .guide-gallery-close')
        ?.click();
      document.getElementById('strokePanel')?.classList.remove('minimized');
      document.getElementById('tagColorEditorBtn')?.click();
    });
    await expect(page.locator('#tagColorPopover')).toHaveClass(/open/);
    await expect(page.locator('#tagLineEmpty')).toBeHidden();
    await expect(page.locator('#tagLineList [data-line-label]')).toHaveCount(1);

    const initialIntegrity = (await inspect()).integrity;
    Object.values(
      initialIntegrity as Record<
        string,
        { centerPixel: number[]; lineCount: number; minLineLength: number; tagCount: number }
      >
    ).forEach(item => {
      expect(item.centerPixel[0]).toBeGreaterThan(220);
      expect(item.centerPixel[1]).toBeGreaterThan(70);
      expect(item.centerPixel[2]).toBeLessThan(60);
      expect(item.centerPixel[3]).toBe(255);
      expect(item.lineCount).toBeGreaterThan(0);
      expect(item.minLineLength).toBeGreaterThan(200);
      expect(item.tagCount).toBeGreaterThanOrEqual(item.lineCount);
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
    const restoredIntegrity = (await inspect()).integrity;
    Object.values(
      restoredIntegrity as Record<
        string,
        { centerPixel: number[]; lineCount: number; minLineLength: number; tagCount: number }
      >
    ).forEach(item => {
      expect(item.centerPixel[0]).toBeGreaterThan(220);
      expect(item.centerPixel[3]).toBe(255);
      expect(item.lineCount).toBeGreaterThan(0);
      expect(item.minLineLength).toBeGreaterThan(200);
      expect(item.tagCount).toBeGreaterThanOrEqual(item.lineCount);
    });
  });

  test('Bind Mode can preview and bind normal project images restored with imageUrl sources', async ({
    page,
  }) => {
    await page.route('**/api/measurement-guides/codes', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          count: 1,
          codes: ['PHOTO-BIND'],
          viewsByCode: { 'PHOTO-BIND': ['front'] },
        }),
      });
    });

    await page.route('**/api/measurement-guides/svg**', async route => {
      const url = new URL(route.request().url());
      const code = String(url.searchParams.get('code') || 'PHOTO-BIND').toUpperCase();
      const view = String(url.searchParams.get('view') || 'front').toLowerCase();
      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml; charset=utf-8',
        body: GUIDE_SVG(code, view),
      });
    });

    await page.goto('/');
    await waitForApp(page);

    const photoUrl = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 220;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas context missing');
      context.fillStyle = '#bae6fd';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#0f172a';
      context.font = 'bold 32px sans-serif';
      context.fillText('CUSTOMER PHOTO', 24, 92);
      context.fillStyle = '#f97316';
      context.fillRect(54, 126, 210, 52);
      return canvas.toDataURL('image/png');
    });

    await page.evaluate(src => {
      const manager = window.app?.projectManager;
      if (!manager) throw new Error('project manager unavailable');
      manager.views = manager.views || {};
      manager.views['customer-photo'] = {
        ...(manager.views['customer-photo'] || {}),
        imageUrl: src,
        imageDataURL: null,
      };
      manager.setProjectMetadata?.({
        imagePartLabels: {
          'customer-photo': 'Customer photo',
        },
      });
      window.originalImages = {
        ...(window.originalImages || {}),
        'customer-photo': src,
      };
      window.imageGalleryData = [
        ...(Array.isArray(window.imageGalleryData) ? window.imageGalleryData : []),
        {
          src,
          name: 'Customer photo',
          label: 'customer-photo',
          original: { label: 'customer-photo' },
        },
      ];
    }, photoUrl);

    await page.evaluate(() => window.openMeasurementGuideGallery?.({ mode: 'bind' }));
    await expect(page.locator('.guide-gallery-overlay.visible')).toBeVisible();
    await expect(page.locator('[data-bind-preview-image="customer-photo"]')).toBeVisible();
    await expect(page.locator('#guideGalleryBindPreviewImageEl')).toHaveAttribute('src', photoUrl);

    const modelCheckbox = page.locator('[data-select-code="PHOTO-BIND"]').first();
    if (!(await modelCheckbox.isChecked())) {
      await modelCheckbox.check();
    }
    await page.locator('[data-bind-preview-image="customer-photo"]').click();
    await page.locator('#guideGalleryBindModelView').selectOption('front');
    await expect(page.locator('[data-link-action="bind-preview"]')).toBeEnabled();
    await page.locator('[data-link-action="bind-preview"]').click();

    await expect
      .poll(() =>
        page.evaluate(() => window.resolveGuideModelBindingForView?.('customer-photo') || null)
      )
      .toMatchObject({
        selection: {
          code: 'PHOTO-BIND',
          variant: 'front',
        },
      });
  });
});
