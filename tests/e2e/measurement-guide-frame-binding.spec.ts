import { test, expect, waitForApp, waitForCanvasLayoutSettle } from './fixtures';
import type { Page } from '@playwright/test';

type ProjectImageSeed = {
  label: string;
  color: string;
};

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => {
    errors.push(error.message);
  });
  page.on('console', message => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  return errors;
}

async function seedProjectImages(page: Page, images: ProjectImageSeed[]): Promise<void> {
  await page.evaluate(async seeds => {
    const projectManager = window.app?.projectManager;
    if (!projectManager?.addImage) {
      throw new Error('projectManager.addImage is unavailable');
    }

    const makeDataUrl = ({ label, color }: ProjectImageSeed) =>
      new Promise<string>(resolve => {
        const canvas = document.createElement('canvas');
        canvas.width = 960;
        canvas.height = 720;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Failed to get 2d context');
        }

        ctx.fillStyle = color;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 48px sans-serif';
        ctx.fillText(label, 48, 84);
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 2;
        ctx.strokeRect(120, 140, 720, 420);
        resolve(canvas.toDataURL('image/png'));
      });

    for (const seed of seeds) {
      const imageUrl = await makeDataUrl(seed);
      await projectManager.addImage(seed.label, imageUrl, { refreshBackground: true });
    }
  }, images);
}

async function switchToView(page: Page, viewId: string): Promise<void> {
  await page.evaluate(async nextViewId => {
    await window.app?.projectManager?.switchView?.(nextViewId, true);
  }, viewId);
  await page.waitForTimeout(250);
  await waitForCanvasLayoutSettle(page);
}

async function createFrameTabs(page: Page, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await page.locator('#captureTabAdd').click();
    await page.waitForTimeout(150);
  }
}

async function getNormalFrameTabs(
  page: Page,
  viewId: string
): Promise<Array<{ id: string; name: string }>> {
  return page.evaluate(currentViewId => {
    const state = window.captureTabsByLabel?.[currentViewId];
    const tabs = Array.isArray(state?.tabs) ? state.tabs : [];
    return tabs
      .filter(tab => tab && tab.type !== 'master')
      .map(tab => ({
        id: String(tab.id || ''),
        name: String(tab.name || 'Frame'),
      }));
  }, viewId);
}

async function activateFrameTab(page: Page, tabId: string): Promise<void> {
  await page.locator(`.capture-tab[data-tab-id="${tabId}"]`).click();
  await page.waitForTimeout(200);
  await waitForCanvasLayoutSettle(page);
}

async function openBindGallery(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.openMeasurementGuideGallery?.({ mode: 'bind' });
  });
  await expect(page.locator('.guide-gallery-overlay.visible')).toBeVisible();
  await expect(page.locator('[data-gallery-mode="bind"].active')).toBeVisible();
}

async function bindTestGuideToFrame(page: Page, imageId: string, frameId: string): Promise<void> {
  await openBindGallery(page);
  await expect(page.locator('[data-code="TEST"]')).toBeVisible();

  const modelCheckbox = page.locator('[data-select-code="TEST"]').first();
  if (!(await modelCheckbox.isChecked())) {
    await page.evaluate(() => {
      const input = document.querySelector('[data-select-code="TEST"]');
      if (!(input instanceof HTMLInputElement)) {
        throw new Error('TEST guide checkbox not found');
      }
      input.checked = true;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  await page.locator(`[data-bind-preview-image="${imageId}"]`).click();
  await page.locator('#guideGalleryBindFrameTarget').selectOption(frameId);
  await page.locator('[data-link-action="bind-preview"]').click();

  await expect
    .poll(async () =>
      page.evaluate(
        ({ currentImageId, currentFrameId }) => {
          const scopeId = `${currentImageId}::tab:${currentFrameId}`;
          const metadata = window.app?.projectManager?.getProjectMetadata?.() || {};
          const linksByScope =
            metadata?.measurementGuideModelLinksByScope &&
            typeof metadata.measurementGuideModelLinksByScope === 'object'
              ? metadata.measurementGuideModelLinksByScope
              : {};
          const selections = Array.isArray(metadata?.measurementGuideModelSelections)
            ? metadata.measurementGuideModelSelections
            : [];
          const selectionId = String(linksByScope[scopeId] || '').trim();
          const selection =
            selections.find(item => String(item?.id || '').trim() === selectionId) || null;
          return {
            scopeId,
            selectionId,
            selection,
          };
        },
        { currentImageId: imageId, currentFrameId: frameId }
      )
    )
    .toMatchObject({
      scopeId: `${imageId}::tab:${frameId}`,
      selectionId: 'TEST::front',
      selection: {
        code: 'TEST',
        variant: 'front',
      },
    });

  await page.locator('.guide-gallery-close').click();
  await expect(page.locator('.guide-gallery-overlay.visible')).toHaveCount(0);
}

async function bindGuideViaGallery(
  page: Page,
  options: {
    imageId: string;
    frameId: string;
    code: string;
    variant: 'front' | 'back' | 'side';
  }
): Promise<void> {
  await openBindGallery(page);
  await expect(page.locator(`[data-select-code="${options.code}"]`).first()).toBeVisible();

  await page.evaluate(({ imageId, frameId, code, variant }) => {
    const checkbox = document.querySelector(`[data-select-code="${code}"]`);
    if (!(checkbox instanceof HTMLInputElement)) {
      throw new Error(`Guide checkbox not found for ${code}`);
    }
    if (!checkbox.checked) {
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const imageButton = document.querySelector(`[data-bind-preview-image="${imageId}"]`);
    if (!(imageButton instanceof HTMLElement)) {
      throw new Error(`Bind preview image button not found for ${imageId}`);
    }
    imageButton.click();

    const frameSelect = document.querySelector('#guideGalleryBindFrameTarget');
    if (!(frameSelect instanceof HTMLSelectElement)) {
      throw new Error('Frame target select not found');
    }
    frameSelect.value = frameId;
    frameSelect.dispatchEvent(new Event('change', { bubbles: true }));

    const modelViewSelect = document.querySelector('#guideGalleryBindModelView');
    if (modelViewSelect instanceof HTMLSelectElement) {
      modelViewSelect.value = variant;
      modelViewSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const bindButton = document.querySelector('[data-link-action="bind-preview"]');
    if (!(bindButton instanceof HTMLElement)) {
      throw new Error('Bind preview button not found');
    }
    bindButton.click();
  }, options);

  await page.waitForTimeout(400);
  await page.locator('.guide-gallery-close').click();
  await expect(page.locator('.guide-gallery-overlay.visible')).toHaveCount(0);
}

async function enableGuideSplit(
  page: Page,
  expectedGuide: { code: string; variant: 'front' | 'back' | 'side' } = {
    code: 'TEST',
    variant: 'front',
  }
): Promise<void> {
  await page.evaluate(() => {
    window.setGuideSplitEnabled?.(true);
  });

  await expect(page.locator('#guideSplitRoot')).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(currentExpectedGuide => {
        const compareCanvas = window.app?.compareCanvasManager?.fabricCanvas;
        const background = compareCanvas?.backgroundImage;
        const currentViewId = window.app?.projectManager?.currentViewId || '';
        const activeGuide = window.resolveActiveGuideForView?.(currentViewId) || null;
        const scopeId = `__guide__:${currentExpectedGuide.code}:${currentExpectedGuide.variant}`;
        const scopedVectors = window.app?.metadataManager?.vectorStrokesByImage?.[scopeId] || {};
        return {
          hasBackground: Boolean(background),
          currentViewId,
          activeGuide,
          scopedStrokeCount: Object.keys(scopedVectors).length,
        };
      }, expectedGuide)
    )
    .toMatchObject({
      hasBackground: true,
      activeGuide: {
        code: expectedGuide.code,
        variant: expectedGuide.variant,
        bound: true,
      },
    });
}

async function setFrameBindings(
  page: Page,
  imageId: string,
  bindings: Array<{ frameId: string; code: string; variant: 'front' | 'back' | 'side' }>
): Promise<void> {
  await page.evaluate(
    ({ currentImageId, currentBindings }) => {
      const projectManager = window.app?.projectManager;
      const metadata = projectManager?.getProjectMetadata?.() || {};
      const existingSelections = Array.isArray(metadata?.measurementGuideModelSelections)
        ? metadata.measurementGuideModelSelections
        : [];
      const existingLinksByScope =
        metadata?.measurementGuideModelLinksByScope &&
        typeof metadata.measurementGuideModelLinksByScope === 'object'
          ? { ...metadata.measurementGuideModelLinksByScope }
          : {};

      const selectionsById = new Map<string, { id: string; code: string; variant: string }>();
      existingSelections.forEach(item => {
        const id = String(item?.id || '').trim();
        const code = String(item?.code || '')
          .trim()
          .toUpperCase();
        const variant = String(item?.variant || 'front')
          .trim()
          .toLowerCase();
        if (!id || !code) return;
        selectionsById.set(id, { id, code, variant });
      });

      currentBindings.forEach(binding => {
        const code = String(binding.code || '')
          .trim()
          .toUpperCase();
        const variant = String(binding.variant || 'front')
          .trim()
          .toLowerCase();
        const frameId = String(binding.frameId || '').trim();
        if (!code || !frameId) return;
        const selectionId = `${code}::${variant}`;
        selectionsById.set(selectionId, { id: selectionId, code, variant });
        existingLinksByScope[`${currentImageId}::tab:${frameId}`] = selectionId;
      });

      projectManager?.setProjectMetadata?.({
        measurementGuideModelSelections: Array.from(selectionsById.values()),
        measurementGuideModelLinksByScope: existingLinksByScope,
        measurementGuideModelLinksByImage: Object.fromEntries(
          Object.entries(existingLinksByScope).filter(([scopeId]) => !scopeId.includes('::tab:'))
        ),
      });
      window.dispatchEvent(new Event('openpaint:guide-binding-changed'));
    },
    { currentImageId: imageId, currentBindings: bindings }
  );
}

async function rapidSwitchFrames(page: Page, tabIds: string[], rounds = 3): Promise<void> {
  await page.evaluate(
    async ({ currentTabIds, currentRounds }) => {
      const clickTab = (tabId: string) => {
        const button = document.querySelector(`.capture-tab[data-tab-id="${tabId}"]`);
        if (!(button instanceof HTMLElement)) {
          throw new Error(`Frame tab ${tabId} not found`);
        }
        button.click();
      };

      for (let round = 0; round < currentRounds; round += 1) {
        for (const tabId of currentTabIds) {
          clickTab(tabId);
          await new Promise(resolve => window.setTimeout(resolve, 35));
        }
      }
    },
    { currentTabIds: tabIds, currentRounds: rounds }
  );
}

test.describe('Measurement Guide Frame Binding', () => {
  test('binding a guide to a specific frame does not crash and loads the bound guide', async ({
    page,
  }) => {
    const svgRequests: string[] = [];
    const pageErrors = collectPageErrors(page);

    await page.route('**/api/measurement-guides/svg**', async route => {
      const url = new URL(route.request().url());
      svgRequests.push(url.search);
      const code = (url.searchParams.get('code') || 'TEST').toUpperCase();
      const view = (url.searchParams.get('view') || 'front').toLowerCase();

      const lineYByView: Record<string, number> = {
        front: 180,
        back: 320,
        side: 500,
      };
      const lineY = lineYByView[view] || 180;
      const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 720" width="960" height="720">
          <rect x="0" y="0" width="960" height="720" fill="#f8fafc" />
          <text x="80" y="96" font-size="52" fill="#0f172a">${code}-${view}</text>
          <g id="${view.toUpperCase()}-MEASURE">
            <line x1="160" y1="${lineY}" x2="800" y2="${lineY}" stroke="#dc2626" stroke-width="10" />
          </g>
          <g id="${view.toUpperCase()}-TAG">
            <rect x="420" y="${lineY - 54}" width="140" height="48" fill="#ffffff" stroke="#0f172a" />
            <text x="454" y="${lineY - 22}" font-size="24" fill="#0f172a">${view === 'front' ? 'A1' : view === 'back' ? 'B1' : 'C1'}</text>
          </g>
        </svg>
      `.trim();

      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml; charset=utf-8',
        body: svg,
      });
    });

    await page.goto('/');
    await waitForApp(page);

    await seedProjectImages(page, [
      { label: 'frame-binding-a', color: '#dbeafe' },
      { label: 'frame-binding-b', color: '#fee2e2' },
    ]);

    await switchToView(page, 'frame-binding-a');
    await createFrameTabs(page, 2);

    const tabs = await getNormalFrameTabs(page, 'frame-binding-a');
    expect(tabs.length).toBeGreaterThanOrEqual(3);

    const baseFrame = tabs[0];
    const boundFrame = tabs[1];
    expect(baseFrame?.id).toBeTruthy();
    expect(boundFrame?.id).toBeTruthy();

    await activateFrameTab(page, baseFrame.id);
    await bindTestGuideToFrame(page, 'frame-binding-a', boundFrame.id);

    const unboundState = await page.evaluate(currentViewId => {
      return window.resolveGuideModelBindingForView?.(currentViewId) || null;
    }, `frame-binding-a::tab:${baseFrame.id}`);
    expect(unboundState?.selection).toBeNull();

    const explicitBoundState = await page.evaluate(currentViewId => {
      return window.resolveGuideModelBindingForView?.(currentViewId) || null;
    }, `frame-binding-a::tab:${boundFrame.id}`);
    expect(explicitBoundState).toMatchObject({
      scopeType: 'frame',
      scopeId: `frame-binding-a::tab:${boundFrame.id}`,
      selection: {
        code: 'TEST',
        variant: 'front',
      },
    });

    await activateFrameTab(page, boundFrame.id);
    const activeBoundState = await page.evaluate(viewId => {
      return window.resolveGuideModelBindingForView?.(viewId) || null;
    }, 'frame-binding-a');
    expect(activeBoundState).toMatchObject({
      scopeType: 'frame',
      scopeId: `frame-binding-a::tab:${boundFrame.id}`,
      selection: {
        code: 'TEST',
        variant: 'front',
      },
    });
    await enableGuideSplit(page);

    const fatalErrors = pageErrors.filter(error =>
      /TypeError|Cannot read properties|is not a function|undefined|null/.test(error)
    );
    expect(fatalErrors).toEqual([]);
    expect(
      svgRequests.some(search => search.includes('code=TEST') && search.includes('view=front'))
    ).toBe(true);
  });

  test('multiple frame bindings on one image stay stable under rapid switching and rebinding', async ({
    page,
  }) => {
    const svgRequests: Array<{ code: string; view: string }> = [];
    const pageErrors = collectPageErrors(page);

    await page.route('**/api/measurement-guides/codes', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          count: 4,
          codes: ['TEST-A', 'TEST-B', 'TEST-C', 'TEST-D'],
          viewsByCode: {
            'TEST-A': ['front', 'back', 'side'],
            'TEST-B': ['front', 'back', 'side'],
            'TEST-C': ['front', 'back', 'side'],
            'TEST-D': ['front', 'back', 'side'],
          },
        }),
      });
    });

    await page.route('**/api/measurement-guides/svg**', async route => {
      const url = new URL(route.request().url());
      const code = (url.searchParams.get('code') || 'TEST-A').toUpperCase();
      const view = (url.searchParams.get('view') || 'front').toLowerCase();
      svgRequests.push({ code, view });

      const delayByKey: Record<string, number> = {
        'TEST-A::front': 320,
        'TEST-B::back': 140,
        'TEST-C::side': 260,
        'TEST-D::front': 90,
      };
      const strokeByCode: Record<string, string> = {
        'TEST-A': '#dc2626',
        'TEST-B': '#2563eb',
        'TEST-C': '#059669',
        'TEST-D': '#d97706',
      };
      const lineYByView: Record<string, number> = {
        front: 180,
        back: 360,
        side: 540,
      };

      await new Promise(resolve => setTimeout(resolve, delayByKey[`${code}::${view}`] ?? 180));

      const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 720" width="960" height="720">
          <rect x="0" y="0" width="960" height="720" fill="#f8fafc" />
          <text x="72" y="90" font-size="44" fill="#0f172a">${code}-${view}</text>
          <g id="m${code.toLowerCase().replace(/[^a-z0-9]+/g, '')}${view}">
            <line x1="140" y1="${lineYByView[view] || 180}" x2="820" y2="${lineYByView[view] || 180}" stroke="${strokeByCode[code] || '#111827'}" stroke-width="10" />
          </g>
          <g id="c${code.toLowerCase().replace(/[^a-z0-9]+/g, '')}${view}">
            <rect x="410" y="${(lineYByView[view] || 180) - 60}" width="150" height="52" fill="#ffffff" stroke="#0f172a" />
            <text x="440" y="${(lineYByView[view] || 180) - 26}" font-size="26" fill="#0f172a">${code.slice(-1)}-${view[0].toUpperCase()}</text>
          </g>
        </svg>
      `.trim();

      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml; charset=utf-8',
        body: svg,
      });
    });

    await page.goto('/');
    await waitForApp(page);

    await seedProjectImages(page, [{ label: 'multi-binding-image', color: '#e0f2fe' }]);
    await switchToView(page, 'multi-binding-image');
    await createFrameTabs(page, 3);

    const tabs = await getNormalFrameTabs(page, 'multi-binding-image');
    expect(tabs.length).toBeGreaterThanOrEqual(4);

    const frameA = tabs[0];
    const frameB = tabs[1];
    const frameC = tabs[2];
    const frameD = tabs[3];

    await setFrameBindings(page, 'multi-binding-image', [
      { frameId: frameA.id, code: 'TEST-A', variant: 'front' },
      { frameId: frameB.id, code: 'TEST-B', variant: 'back' },
      { frameId: frameC.id, code: 'TEST-C', variant: 'side' },
    ]);

    await activateFrameTab(page, frameA.id);
    await enableGuideSplit(page, { code: 'TEST-A', variant: 'front' });
    await rapidSwitchFrames(page, [frameA.id, frameB.id, frameC.id], 4);

    await setFrameBindings(page, 'multi-binding-image', [
      { frameId: frameB.id, code: 'TEST-D', variant: 'front' },
      { frameId: frameD.id, code: 'TEST-B', variant: 'back' },
    ]);

    await rapidSwitchFrames(page, [frameD.id, frameB.id, frameC.id, frameA.id, frameB.id], 3);
    await activateFrameTab(page, frameB.id);

    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const activeGuide = window.resolveActiveGuideForView?.('multi-binding-image') || null;
            const compareCanvas = window.app?.compareCanvasManager?.fabricCanvas || null;
            const objectGuideCodes = (compareCanvas?.getObjects?.() || [])
              .map(object => String(object?.customData?.guideCode || '').trim())
              .filter(Boolean);
            const objectGuideViews = (compareCanvas?.getObjects?.() || [])
              .map(object => String(object?.customData?.guideView || '').trim())
              .filter(Boolean);
            const visibleGuideObjectCount = (compareCanvas?.getObjects?.() || []).filter(
              object => object?.customData?.guideCode && object?.visible !== false
            ).length;
            const tempScopes = Object.keys(window.app?.metadataManager?.vectorStrokesByImage || {})
              .filter(key => key.startsWith('__guide__:'))
              .sort();
            return (
              activeGuide?.code === 'TEST-D' &&
              activeGuide?.variant === 'front' &&
              activeGuide?.bound === true &&
              Array.isArray(objectGuideCodes) &&
              objectGuideCodes.length > 0 &&
              objectGuideCodes.every(code => code === 'TEST-D') &&
              Array.isArray(objectGuideViews) &&
              objectGuideViews.every(view => view === 'front') &&
              visibleGuideObjectCount === 0 &&
              Array.isArray(tempScopes) &&
              tempScopes.length > 0 &&
              tempScopes.every(scope => scope.startsWith('__guide__:TEST-D:front'))
            );
          }),
        { timeout: 15_000 }
      )
      .toBe(true);

    const fatalErrors = pageErrors.filter(error =>
      /TypeError|Cannot read properties|is not a function|undefined|null/.test(error)
    );
    expect(fatalErrors).toEqual([]);

    expect(svgRequests.some(request => request.code === 'TEST-A' && request.view === 'front')).toBe(
      true
    );
    expect(svgRequests.some(request => request.code === 'TEST-B' && request.view === 'back')).toBe(
      true
    );
    expect(svgRequests.some(request => request.code === 'TEST-C' && request.view === 'side')).toBe(
      true
    );
    expect(svgRequests.some(request => request.code === 'TEST-D' && request.view === 'front')).toBe(
      true
    );
  });

  test('bind mode uses the newly selected model when binding different frames', async ({
    page,
  }) => {
    await page.route('**/api/measurement-guides/codes', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          count: 3,
          codes: ['TEST-A', 'TEST-B', 'TEST-C'],
          viewsByCode: {
            'TEST-A': ['front', 'back', 'side'],
            'TEST-B': ['front', 'back', 'side'],
            'TEST-C': ['front', 'back', 'side'],
          },
        }),
      });
    });

    await page.route('**/api/measurement-guides/svg**', async route => {
      const url = new URL(route.request().url());
      const code = (url.searchParams.get('code') || 'TEST-A').toUpperCase();
      const view = (url.searchParams.get('view') || 'front').toLowerCase();
      const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600">
          <rect x="0" y="0" width="800" height="600" fill="#f8fafc" />
          <text x="64" y="96" font-size="42" fill="#0f172a">${code}-${view}</text>
        </svg>
      `.trim();
      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml; charset=utf-8',
        body: svg,
      });
    });

    await page.goto('/');
    await waitForApp(page);

    await seedProjectImages(page, [{ label: 'bind-mode-ui-image', color: '#fef3c7' }]);
    await switchToView(page, 'bind-mode-ui-image');
    await createFrameTabs(page, 2);

    const tabs = await getNormalFrameTabs(page, 'bind-mode-ui-image');
    expect(tabs.length).toBeGreaterThanOrEqual(3);

    await bindGuideViaGallery(page, {
      imageId: 'bind-mode-ui-image',
      frameId: tabs[0].id,
      code: 'TEST-A',
      variant: 'front',
    });
    await bindGuideViaGallery(page, {
      imageId: 'bind-mode-ui-image',
      frameId: tabs[1].id,
      code: 'TEST-B',
      variant: 'back',
    });
    await bindGuideViaGallery(page, {
      imageId: 'bind-mode-ui-image',
      frameId: tabs[2].id,
      code: 'TEST-C',
      variant: 'side',
    });

    const bindings = await page.evaluate(currentTabs => {
      return currentTabs.map(
        tab => window.resolveGuideModelBindingForView?.(`bind-mode-ui-image::tab:${tab.id}`) || null
      );
    }, tabs);

    expect(bindings[0]).toMatchObject({
      scopeType: 'frame',
      selection: {
        code: 'TEST-A',
        variant: 'front',
      },
    });
    expect(bindings[1]).toMatchObject({
      scopeType: 'frame',
      selection: {
        code: 'TEST-B',
        variant: 'back',
      },
    });
    expect(bindings[2]).toMatchObject({
      scopeType: 'frame',
      selection: {
        code: 'TEST-C',
        variant: 'side',
      },
    });
  });

  test('duplicate next-tag refreshes do not emit an event storm', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    await seedProjectImages(page, [{ label: 'next-tag-image', color: '#e2e8f0' }]);
    await switchToView(page, 'next-tag-image');

    const result = await page.evaluate(() => {
      const events: Array<{ viewId: string; tag: string }> = [];
      window.__openpaintGuideNextTagByView = {};
      const handler = event => {
        events.push({
          viewId: String(event?.detail?.viewId || ''),
          tag: String(event?.detail?.tag || ''),
        });
      };
      window.addEventListener('openpaint:guide-next-tag-changed', handler);
      try {
        for (let index = 0; index < 40; index += 1) {
          window.updateNextTagDisplay?.();
        }
      } finally {
        window.removeEventListener('openpaint:guide-next-tag-changed', handler);
      }
      return {
        eventCount: events.length,
        events,
      };
    });

    expect(result.eventCount).toBe(1);
    expect(result.events[0]?.viewId).toContain('next-tag-image');
    expect(result.events[0]?.tag).toBeTruthy();
  });
});
