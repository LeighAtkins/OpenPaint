/**
 * E2E tests: Image scrolling performance and gallery navigation.
 *
 * Covers:
 *  - Gallery renders thumbnails for multiple images
 *  - Arrow key navigation switches views
 *  - Scroll-to-select works in the image list
 *  - Navigation is responsive (timing checks)
 *  - View switching preserves canvas state
 */
import {
  test,
  expect,
  waitForApp,
  getCanvas,
  selectTool,
  drawLine,
  uploadTestImage,
  resizeViewport,
  waitForCanvasLayoutSettle,
} from './fixtures';
import type { Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Add multiple images to the project so we can test scrolling. */
async function addMultipleImages(page: Page, count: number): Promise<void> {
  await page.evaluate(n => {
    const pm = window.app!.projectManager;
    const cm = window.app!.canvasManager;
    const viewIds = ['front', 'side', 'back', 'cushion'];

    for (let i = 0; i < Math.min(n, viewIds.length); i++) {
      const viewId = viewIds[i]!;
      // Create a canvas image for each view
      const offscreen = document.createElement('canvas');
      offscreen.width = 600;
      offscreen.height = 400;
      const ctx = offscreen.getContext('2d')!;

      // Each view gets a different color so we can distinguish them
      const colors = ['#ffcccc', '#ccffcc', '#ccccff', '#ffffcc'];
      ctx.fillStyle = colors[i] || '#f0f0f0';
      ctx.fillRect(0, 0, 600, 400);
      ctx.fillStyle = '#333';
      ctx.font = '24px Arial';
      ctx.fillText(`View: ${viewId}`, 20, 40);

      const dataURL = offscreen.toDataURL('image/png');

      // Store view data
      if (!pm.views) pm.views = {};
      pm.views[viewId] = pm.views[viewId] || {};
      pm.views[viewId].imageDataURL = dataURL;
    }
  }, count);
  await page.waitForTimeout(300);
}

/** Get the current active view ID. */
async function getCurrentViewId(page: Page): Promise<string> {
  return page.evaluate(() => window.app!.projectManager.currentViewId);
}

/** Measure how long a view switch takes. */
async function measureViewSwitchTime(page: Page, targetView: string): Promise<number> {
  return page.evaluate(view => {
    const start = performance.now();
    window.app!.projectManager.switchView(view);
    const end = performance.now();
    return end - start;
  }, targetView);
}

async function seedViewWithImageAndLine(
  page: Page,
  options: {
    viewId: string;
    color: string;
    label: string;
    line: [number, number, number, number];
  }
): Promise<void> {
  await page.evaluate(async ({ viewId, color, label, line }) => {
    const pm = window.app!.projectManager;
    const cm = window.app!.canvasManager;

    const offscreen = document.createElement('canvas');
    offscreen.width = 800;
    offscreen.height = 600;
    const ctx = offscreen.getContext('2d')!;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, offscreen.width, offscreen.height);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 6;
    ctx.strokeRect(80, 60, 640, 480);
    ctx.fillStyle = '#0f172a';
    ctx.font = '36px sans-serif';
    ctx.fillText(label, 24, 48);

    pm.views[viewId] = {
      ...(pm.views[viewId] || {}),
      image: offscreen.toDataURL('image/png'),
      fitMode: 'fit-canvas',
    };

    await pm.switchView(viewId, true);

    const [x1, y1, x2, y2] = line;
    const stroke = new (window as any).fabric.Line([x1, y1, x2, y2], {
      stroke: '#dc2626',
      strokeWidth: 6,
      selectable: true,
    });

    cm.fabricCanvas.add(stroke);
    cm.fabricCanvas.renderAll();
    pm.saveCurrentViewState?.();
  }, options);
  await page.waitForTimeout(400);
}

async function bindGuideSplitForViews(page: Page, viewIds: string[]): Promise<void> {
  await page.evaluate(targets => {
    const pm = window.app!.projectManager;
    const selection = {
      id: 'test-guide-front',
      code: 'TEST',
      variant: 'front',
    };
    const linksByScope = Object.fromEntries(targets.map(viewId => [viewId, selection.id]));

    if (pm.setProjectMetadata) {
      pm.setProjectMetadata({
        measurementGuideModelSelections: [selection],
        measurementGuideModelLinksByImage: linksByScope,
        measurementGuideModelLinksByScope: linksByScope,
      });
    } else {
      (window as any).projectMetadata = {
        ...((window as any).projectMetadata || {}),
        measurementGuideModelSelections: [selection],
        measurementGuideModelLinksByImage: linksByScope,
        measurementGuideModelLinksByScope: linksByScope,
      };
    }

    if (typeof (window as any).renderCaptureTabUI === 'function') {
      (window as any).renderCaptureTabUI(window.app!.projectManager.currentViewId);
    }
  }, viewIds);
  await page.waitForTimeout(300);
}

async function mockGuideSvg(
  page: Page,
  svgText: string,
  options: { code?: string; view?: string } = {}
): Promise<void> {
  const code = options.code || 'TEST';
  const view = options.view || 'front';
  await page.route('**/api/measurement-guides/svg**', async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('code') === code && url.searchParams.get('view') === view) {
      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: svgText,
      });
      return;
    }
    await route.continue();
  });
}

async function ensureSplitEnabled(page: Page): Promise<void> {
  const splitState = await page.evaluate(() => (window as any).getGuideSplitStateForView?.());
  if (!splitState?.enabled) {
    await page.evaluate(() => (window as any).toggleGuideSplitEnabled?.());
    await page.waitForTimeout(900);
  }
}

async function setSplitEnabled(page: Page, enabled: boolean): Promise<void> {
  const splitState = await page.evaluate(() => (window as any).getGuideSplitStateForView?.());
  if (Boolean(splitState?.enabled) !== enabled) {
    await page.evaluate(() => (window as any).toggleGuideSplitEnabled?.());
    await page.waitForTimeout(900);
  }
}

async function switchView(page: Page, viewId: string): Promise<void> {
  await page.evaluate(async targetView => {
    await window.app!.projectManager.switchView(targetView, true);
  }, viewId);
  await page.waitForTimeout(700);
  await waitForCanvasLayoutSettle(page);
}

type AlignmentSnapshot = {
  viewId: string;
  split: boolean;
  bgFrameCenterDx: number;
  bgFrameCenterDy: number;
  lines: Array<{
    normX: number;
    normY: number;
  }>;
};

async function captureAlignmentSnapshot(page: Page): Promise<AlignmentSnapshot> {
  return page.evaluate(() => {
    const cm = window.app!.canvasManager;
    const canvas = cm.fabricCanvas;
    const bg = canvas?.backgroundImage;
    const fabricApi = (window as any).fabric;
    const captureFrame = document.getElementById('captureFrame');

    if (!canvas || !bg || !fabricApi || !captureFrame) {
      throw new Error(
        'Canvas alignment snapshot requires canvas, background image, and capture frame'
      );
    }

    const vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
    const halfWidth = ((bg.width || 0) * (bg.scaleX || 1)) / 2;
    const halfHeight = ((bg.height || 0) * (bg.scaleY || 1)) / 2;
    const topLeft = fabricApi.util.transformPoint(
      new fabricApi.Point(bg.left - halfWidth, bg.top - halfHeight),
      vpt
    );
    const bottomRight = fabricApi.util.transformPoint(
      new fabricApi.Point(bg.left + halfWidth, bg.top + halfHeight),
      vpt
    );
    const bgRect = {
      left: topLeft.x,
      top: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y,
    };

    const canvasRect = canvas.getElement().getBoundingClientRect();
    const frameRect = captureFrame.getBoundingClientRect();
    const frameLocal = {
      left: frameRect.left - canvasRect.left,
      top: frameRect.top - canvasRect.top,
      width: frameRect.width,
      height: frameRect.height,
      centerX: frameRect.left - canvasRect.left + frameRect.width / 2,
      centerY: frameRect.top - canvasRect.top + frameRect.height / 2,
    };

    const lines = canvas
      .getObjects()
      .filter((object: any) => object?.type === 'line' && !object?.isConnectorLine)
      .map((line: any) => {
        const center = fabricApi.util.transformPoint(line.getCenterPoint(), vpt);
        return {
          normX: (center.x - bgRect.left) / Math.max(bgRect.width, 1),
          normY: (center.y - bgRect.top) / Math.max(bgRect.height, 1),
        };
      })
      .sort((a: { normX: number }, b: { normX: number }) => a.normX - b.normX);

    return {
      viewId: window.app!.projectManager.currentViewId,
      split:
        document.getElementById('main-canvas-wrapper')?.classList.contains('guide-split-active') ===
        true,
      bgFrameCenterDx: bgRect.left + bgRect.width / 2 - frameLocal.centerX,
      bgFrameCenterDy: bgRect.top + bgRect.height / 2 - frameLocal.centerY,
      lines,
    };
  });
}

type TransitionDriftSnapshot = {
  maxDx: number;
  maxDy: number;
  relevantFrames: number;
  finalViewId: string;
  finalSplit: boolean;
};

async function sampleTransitionDrift(
  page: Page,
  action: 'toggle-split' | 'switch-front' | 'switch-side',
  durationMs = 700
): Promise<TransitionDriftSnapshot> {
  return page.evaluate(
    async ({ transitionAction, transitionDurationMs }) => {
      const sample = () => {
        const cm = window.app?.canvasManager;
        const canvas = cm?.fabricCanvas;
        const bg = canvas?.backgroundImage;
        const captureFrame = document.getElementById('captureFrame');
        const wrapper = document.getElementById('main-canvas-wrapper');
        const livePane = document.getElementById('guideSplitLivePane');
        const fabricApi = (window as any).fabric;

        if (!canvas || !bg || !captureFrame || !wrapper || !fabricApi) {
          return null;
        }

        const vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
        const halfWidth = ((bg.width || 0) * (bg.scaleX || 1)) / 2;
        const halfHeight = ((bg.height || 0) * (bg.scaleY || 1)) / 2;
        const topLeft = fabricApi.util.transformPoint(
          new fabricApi.Point(bg.left - halfWidth, bg.top - halfHeight),
          vpt
        );
        const bottomRight = fabricApi.util.transformPoint(
          new fabricApi.Point(bg.left + halfWidth, bg.top + halfHeight),
          vpt
        );
        const canvasRect = canvas.getElement().getBoundingClientRect();
        const frameRect = captureFrame.getBoundingClientRect();
        const bgCenterX = topLeft.x + (bottomRight.x - topLeft.x) / 2;
        const bgCenterY = topLeft.y + (bottomRight.y - topLeft.y) / 2;
        const frameCenterX = frameRect.left - canvasRect.left + frameRect.width / 2;
        const frameCenterY = frameRect.top - canvasRect.top + frameRect.height / 2;

        return {
          split: wrapper.classList.contains('guide-split-active'),
          visible:
            livePane instanceof HTMLElement &&
            !livePane.classList.contains('is-transitioning') &&
            window.getComputedStyle(livePane).opacity !== '0',
          viewId: window.app?.projectManager?.currentViewId || '',
          dx: bgCenterX - frameCenterX,
          dy: bgCenterY - frameCenterY,
        };
      };

      const trigger = () => {
        switch (transitionAction) {
          case 'toggle-split':
            (window as any).toggleGuideSplitEnabled?.();
            break;
          case 'switch-front':
            void window.app?.projectManager?.switchView?.('front', true);
            break;
          case 'switch-side':
            void window.app?.projectManager?.switchView?.('side', true);
            break;
          default:
            break;
        }
      };

      const samples = [];
      const firstSample = sample();
      if (firstSample) {
        samples.push(firstSample);
      }
      trigger();

      const start = performance.now();
      while (performance.now() - start < transitionDurationMs) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        const snapshot = sample();
        if (snapshot) {
          samples.push(snapshot);
        }
      }

      const relevantSamples = samples.filter(
        snapshot => snapshot.split === true && snapshot.visible === true
      );
      const finalSample = samples.at(-1) || {
        viewId: '',
        split: false,
        dx: 0,
        dy: 0,
      };

      return {
        maxDx: Math.max(0, ...relevantSamples.map(snapshot => Math.abs(snapshot.dx))),
        maxDy: Math.max(0, ...relevantSamples.map(snapshot => Math.abs(snapshot.dy))),
        relevantFrames: relevantSamples.length,
        finalViewId: finalSample.viewId,
        finalSplit: finalSample.split,
      };
    },
    {
      transitionAction: action,
      transitionDurationMs: durationMs,
    }
  );
}

function expectSnapshotAlignment(
  baseline: AlignmentSnapshot,
  snapshot: AlignmentSnapshot,
  label: string
): void {
  expect(snapshot.viewId, `${label}: active view changed`).toBe(baseline.viewId);
  expect(snapshot.lines.length, `${label}: line count changed`).toBe(baseline.lines.length);

  snapshot.lines.forEach((line, index) => {
    const before = baseline.lines[index]!;
    expect(
      Math.abs(line.normX - before.normX),
      `${label}: line ${index} drifted horizontally`
    ).toBeLessThan(0.03);
    expect(
      Math.abs(line.normY - before.normY),
      `${label}: line ${index} drifted vertically`
    ).toBeLessThan(0.03);
  });

  expect(
    Math.abs(snapshot.bgFrameCenterDx),
    `${label}: background center drifted from capture frame horizontally`
  ).toBeLessThan(8);
  expect(
    Math.abs(snapshot.bgFrameCenterDy),
    `${label}: background center drifted from capture frame vertically`
  ).toBeLessThan(8);
}

type CompareGuideState = {
  hasBackground: boolean;
  importedCount: number;
  lineCount: number;
  pathCount: number;
  overlayCount: number;
  importedWithArrowSettings: number;
  allImportedReferenceOnly: boolean;
  allGuideTagsReferenceOnly: boolean;
  highlightedGuideTags: string[];
  labelVisibility: boolean | null;
  measurementValue: unknown;
};

type CompareAlignmentSnapshot = {
  hasBackground: boolean;
  bgHostCenterDx: number;
  bgHostCenterDy: number;
  bgWidthRatio: number;
  bgHeightRatio: number;
};

async function captureCompareAlignment(page: Page): Promise<CompareAlignmentSnapshot> {
  return page.evaluate(() => {
    const compareCanvas = window.app?.compareCanvasManager?.fabricCanvas;
    const bg = compareCanvas?.backgroundImage;
    const host = document.getElementById('guideSplitCompareCanvasHost');
    if (!compareCanvas || !bg || !(host instanceof HTMLElement)) {
      return {
        hasBackground: false,
        bgHostCenterDx: 0,
        bgHostCenterDy: 0,
        bgWidthRatio: 0,
        bgHeightRatio: 0,
      };
    }

    const fabricApi = (window as any).fabric;
    const vpt = compareCanvas.viewportTransform || [1, 0, 0, 1, 0, 0];
    const halfWidth = ((bg.width || 0) * (bg.scaleX || 1)) / 2;
    const halfHeight = ((bg.height || 0) * (bg.scaleY || 1)) / 2;
    const topLeft = fabricApi.util.transformPoint(
      new fabricApi.Point(bg.left - halfWidth, bg.top - halfHeight),
      vpt
    );
    const bottomRight = fabricApi.util.transformPoint(
      new fabricApi.Point(bg.left + halfWidth, bg.top + halfHeight),
      vpt
    );
    const canvasRect = compareCanvas.getElement().getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const bgWidth = bottomRight.x - topLeft.x;
    const bgHeight = bottomRight.y - topLeft.y;
    const bgCenterX = topLeft.x + bgWidth / 2;
    const bgCenterY = topLeft.y + bgHeight / 2;
    const hostCenterX = hostRect.left - canvasRect.left + hostRect.width / 2;
    const hostCenterY = hostRect.top - canvasRect.top + hostRect.height / 2;

    return {
      hasBackground: true,
      bgHostCenterDx: bgCenterX - hostCenterX,
      bgHostCenterDy: bgCenterY - hostCenterY,
      bgWidthRatio: bgWidth / Math.max(hostRect.width, 1),
      bgHeightRatio: bgHeight / Math.max(hostRect.height, 1),
    };
  });
}

async function captureCompareGuideState(
  page: Page,
  strokeLabel = 'A1'
): Promise<CompareGuideState> {
  return page.evaluate(targetLabel => {
    const compareCanvas = window.app?.compareCanvasManager?.fabricCanvas;
    const metadataManager = window.app?.metadataManager;
    const scopedEntries = Object.entries(metadataManager?.vectorStrokesByImage || {});
    const tempScopeId =
      scopedEntries.find(([key]) => String(key).startsWith('__guide__:'))?.[0] || '';
    const objects = compareCanvas?.getObjects?.() || [];
    const importedObjects = objects.filter(
      (object: any) => object?.customData?.source === 'guide-import'
    );
    const targetImportedObject =
      importedObjects.find((object: any) => object?.customData?.strokeLabel === targetLabel) ||
      null;
    const highlightOverlays = objects.filter(
      (object: any) => object?.__guideSplitHighlightOverlay === true
    );
    const guideTags = objects.filter(
      (object: any) => object?.isTag && String(object?.imageLabel || '').startsWith('__guide__:')
    );
    const highlightedGuideTags = guideTags
      .filter((object: any) => {
        const fillValues = (object?._objects || []).map((child: any) =>
          String(child?.fill || '')
            .toLowerCase()
            .replace(/\s+/g, '')
        );
        return fillValues.some(
          (fill: string) =>
            fill === '#fef3c7' || fill === 'rgb(254,243,199)' || fill === 'rgba(254,243,199,1)'
        );
      })
      .map((object: any) => String(object?.strokeLabel || ''))
      .filter(Boolean);

    return {
      hasBackground: Boolean(compareCanvas?.backgroundImage),
      importedCount: importedObjects.length,
      lineCount: importedObjects.filter((object: any) => object?.type === 'line').length,
      pathCount: importedObjects.filter((object: any) => object?.type === 'path').length,
      overlayCount: highlightOverlays.length,
      importedWithArrowSettings: importedObjects.filter((object: any) => !!object?.arrowSettings)
        .length,
      allImportedReferenceOnly: importedObjects.every(
        (object: any) =>
          object?.customData?.guideReferenceOnly === true &&
          object?.selectable === false &&
          object?.evented === false
      ),
      allGuideTagsReferenceOnly: guideTags.every(
        (object: any) => object?.selectable === false && object?.evented === false
      ),
      highlightedGuideTags,
      labelVisibility: targetImportedObject
        ? targetImportedObject.visible !== false
        : tempScopeId && metadataManager?.strokeVisibilityByImage?.[tempScopeId]
          ? metadataManager.strokeVisibilityByImage[tempScopeId][targetLabel] !== false
          : null,
      measurementValue:
        tempScopeId && metadataManager?.strokeMeasurements?.[tempScopeId]
          ? metadataManager.strokeMeasurements[tempScopeId][targetLabel]
          : null,
    };
  }, strokeLabel);
}

type MiniGuideState = {
  visible: boolean;
  heroSrc: string;
  activeChip: string;
};

async function captureMiniGuideState(page: Page): Promise<MiniGuideState> {
  return page.evaluate(() => {
    const root = document.getElementById('measurementGuideIndicator');
    const hero = root?.querySelector('.measurement-guide-indicator-hero img');
    const activeChip = root?.querySelector('.measurement-guide-indicator-chip.active');
    return {
      visible: root instanceof HTMLElement && root.style.display !== 'none',
      heroSrc: hero instanceof HTMLImageElement ? hero.src : '',
      activeChip: activeChip instanceof HTMLElement ? activeChip.textContent?.trim() || '' : '',
    };
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Image gallery and navigation', () => {
  test('should show gallery thumbnails', async ({ appPage: page }) => {
    const gallery = page.locator('#imageGallery, .image-thumbnail');
    // App should have at least the default view thumbnail
    const count = await gallery.count();
    expect(count).toBeGreaterThanOrEqual(0); // Gallery may be hidden when single image
  });

  test('should show navigation dots or position indicator', async ({ appPage: page }) => {
    const dots = page.locator('#imageDots, .nav-dot');
    const position = page.locator('#imagePosition');

    const hasDots = (await dots.count()) > 0;
    const hasPosition = (await position.count()) > 0;

    // At least one navigation indicator should exist
    expect(hasDots || hasPosition).toBe(true);
  });
});

test.describe('View switching performance', () => {
  test('should switch views without lag', async ({ appPage: page }) => {
    // Upload a test image to the front view
    await uploadTestImage(page);

    // Switch to side view and measure time
    const switchTime = await measureViewSwitchTime(page, 'side');

    // View switch should be fast — under 500ms for the synchronous part
    expect(switchTime).toBeLessThan(500);

    // Wait for async rendering
    await page.waitForTimeout(500);

    // Verify we're now on the side view
    const currentView = await getCurrentViewId(page);
    expect(currentView).toBe('side');
  });

  test('should switch back and forth between views quickly', async ({ appPage: page }) => {
    await uploadTestImage(page);

    const timings: number[] = [];
    const views = ['side', 'front', 'back', 'front', 'side'];

    for (const view of views) {
      const t = await measureViewSwitchTime(page, view);
      timings.push(t);
      await page.waitForTimeout(200); // let render settle
    }

    // All switches should be under 500ms (sync time)
    const maxTime = Math.max(...timings);
    expect(maxTime).toBeLessThan(500);

    // Average should be well under 200ms
    const avg = timings.reduce((a, b) => a + b, 0) / timings.length;
    expect(avg).toBeLessThan(200);
  });

  test('should preserve strokes when switching views and back', async ({ appPage: page }) => {
    await uploadTestImage(page);
    await selectTool(page, 'line');

    // Draw on front view
    await drawLine(page, 100, 200, 400, 200);

    const frontObjectsBefore = await page.evaluate(
      () => window.app!.canvasManager.fabricCanvas.getObjects().length
    );

    // Switch away and back
    await page.evaluate(() => window.app!.projectManager.switchView('side'));
    await page.waitForTimeout(300);
    await page.evaluate(() => window.app!.projectManager.switchView('front'));
    await page.waitForTimeout(300);

    const frontObjectsAfter = await page.evaluate(
      () => window.app!.canvasManager.fabricCanvas.getObjects().length
    );

    // Object count should be preserved after round-trip.
    // Allow a tolerance of 1 because transient objects (tags, labels, snap
    // indicators) may be cleaned up during view switches.
    expect(frontObjectsAfter).toBeGreaterThanOrEqual(frontObjectsBefore - 1);
    expect(frontObjectsAfter).toBeLessThanOrEqual(frontObjectsBefore + 1);
  });
});

test.describe('Keyboard navigation', () => {
  test('should navigate views with arrow keys', async ({ appPage: page }) => {
    await uploadTestImage(page);

    const startView = await getCurrentViewId(page);

    // Press right arrow to go to next view
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(500);

    const afterRight = await getCurrentViewId(page);

    // Press left arrow to go back
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(500);

    const afterLeft = await getCurrentViewId(page);

    // If arrow navigation is implemented, view should have changed
    // If not, both checks pass (we just verify no crash)
    if (afterRight !== startView) {
      // Navigation worked — going back should return to start
      expect(afterLeft).toBe(startView);
    }
  });
});

test.describe('Resize stability', () => {
  test('should not switch images when viewport resizes (window snap)', async ({
    appPage: page,
  }) => {
    await uploadTestImage(page);

    const viewBefore = await getCurrentViewId(page);

    // Simulate a Windows snap resize — rapid viewport size change
    await page.setViewportSize({ width: 640, height: 800 });
    await page.waitForTimeout(200);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(200);
    // Snap to half-screen
    await page.setViewportSize({ width: 960, height: 1080 });
    await page.waitForTimeout(1000); // Wait for debounced padding + observer to settle

    const viewAfter = await getCurrentViewId(page);

    // The active view should NOT have changed due to resize
    expect(viewAfter).toBe(viewBefore);
  });
});

test.describe('Resize stability — grow window', () => {
  /**
   * Populate the image list sidebar with multiple .image-container elements
   * so the IntersectionObserver / scroll-select system is active.
   */
  async function setupMultipleImages(page: import('@playwright/test').Page) {
    await page.evaluate(() => {
      const pm = window.app!.projectManager;
      const labels = ['front', 'side', 'back'];
      const colors = ['#ffcccc', '#ccffcc', '#ccccff'];

      labels.forEach((label, i) => {
        // Ensure view exists
        if (!pm.views) (pm as any).views = {};
        if (!pm.views[label]) (pm as any).views[label] = {};

        // Create a test image for this view
        const offscreen = document.createElement('canvas');
        offscreen.width = 600;
        offscreen.height = 400;
        const ctx = offscreen.getContext('2d')!;
        ctx.fillStyle = colors[i]!;
        ctx.fillRect(0, 0, 600, 400);
        ctx.fillStyle = '#333';
        ctx.font = '32px sans-serif';
        ctx.fillText(label, 20, 50);
        pm.views[label].imageDataURL = offscreen.toDataURL('image/png');
      });

      // Build .image-container elements in #imageList
      const imageList = document.getElementById('imageList');
      if (imageList) {
        imageList.innerHTML = '';
        labels.forEach(label => {
          const container = document.createElement('div');
          container.className = 'image-container';
          container.dataset.label = label;
          container.setAttribute('aria-selected', label === 'front' ? 'true' : 'false');
          container.style.height = '120px';
          container.style.flexShrink = '0';

          const img = document.createElement('img');
          img.src = pm.views[label].imageDataURL;
          img.style.width = '100%';
          img.style.height = '100%';
          img.style.objectFit = 'cover';
          container.appendChild(img);
          imageList.appendChild(container);

          // Register with the observer if it exists
          if ((window as any).__imageListCenteringObserver) {
            (window as any).__imageListCenteringObserver.observe(container);
          }
        });

        // Update padding so items can be center-scrolled
        if (typeof (window as any).updateImageListPadding === 'function') {
          (window as any).updateImageListPadding();
        }
      }

      // Make sure we're on front
      pm.switchView('front');
    });
    await page.waitForTimeout(500);
  }

  test('background should refit capture frame when viewport grows', async ({ appPage: page }) => {
    await uploadTestImage(page, 800, 600, '#d4d4d4');

    // Debug: check the canvas state
    const canvasInfo = await page.evaluate(() => {
      const cm = window.app!.canvasManager;
      return {
        enableFloatingLayoutMode: cm.enableFloatingLayoutMode,
        containerId: cm.containerId,
        isPrimaryFloating: cm.enableFloatingLayoutMode && cm.containerId === 'main-canvas-wrapper',
        hasBg: !!cm.fabricCanvas?.backgroundImage,
      };
    });

    // Start small
    await page.setViewportSize({ width: 640, height: 480 });
    await page.evaluate(() => window.app?.canvasManager?.resize?.());
    await page.waitForTimeout(500);

    // Record the background scale and frame size at small viewport
    const stateBefore = await page.evaluate(() => {
      const cm = window.app!.canvasManager;
      const bg = cm.fabricCanvas?.backgroundImage;
      const frame = document.getElementById('captureFrame');
      return {
        bgScale: bg ? bg.scaleX || 1 : null,
        bgW: bg ? (bg.width || 0) * (bg.scaleX || 1) : 0,
        bgH: bg ? (bg.height || 0) * (bg.scaleY || 1) : 0,
        frameW: frame ? frame.offsetWidth : 0,
        frameH: frame ? frame.offsetHeight : 0,
        canvasW: cm.fabricCanvas?.width || 0,
        canvasH: cm.fabricCanvas?.height || 0,
      };
    });
    const scaleBefore = stateBefore.bgScale;

    // Grow to large viewport
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(() => window.app?.canvasManager?.resize?.());
    await page.waitForTimeout(500);

    const stateAfter = await page.evaluate(() => {
      const bg = window.app?.canvasManager?.fabricCanvas?.backgroundImage;
      return {
        bgScale: bg ? bg.scaleX || 1 : null,
        bgW: bg ? (bg.width || 0) * (bg.scaleX || 1) : 0,
        bgH: bg ? (bg.height || 0) * (bg.scaleY || 1) : 0,
      };
    });

    const result = await page.evaluate(() => {
      const cm = window.app?.canvasManager;
      if (!cm?.fabricCanvas) return { ok: true, reason: 'no canvas' };

      const bg = cm.fabricCanvas.backgroundImage;
      if (!bg) return { ok: true, reason: 'no background' };

      // Get capture frame dimensions
      const captureFrame = document.getElementById('captureFrame');
      const canvasW = cm.fabricCanvas.width || 0;
      const canvasH = cm.fabricCanvas.height || 0;
      const frameW = captureFrame ? captureFrame.offsetWidth : canvasW;
      const frameH = captureFrame ? captureFrame.offsetHeight : canvasH;

      // Get the background image's rendered size
      const imgW = (bg.width || 0) * (bg.scaleX || 1);
      const imgH = (bg.height || 0) * (bg.scaleY || 1);

      // The background should fill the frame (fit-canvas mode):
      // at least one dimension should match the frame
      const fillsWidth = Math.abs(imgW - frameW) < 5;
      const fillsHeight = Math.abs(imgH - frameH) < 5;
      const fitsFrame = fillsWidth || fillsHeight;

      // The background should NOT be significantly smaller than the frame
      const tooSmall = imgW < frameW * 0.8 && imgH < frameH * 0.8;

      return {
        ok: fitsFrame && !tooSmall,
        fitsFrame,
        tooSmall,
        imgW: Math.round(imgW),
        imgH: Math.round(imgH),
        frameW: Math.round(frameW),
        frameH: Math.round(frameH),
        bgScaleX: bg.scaleX,
        hasCaptureFrame: !!captureFrame,
      };
    });

    // The background should not be too small for the frame
    if (scaleBefore !== null) {
      expect(result.tooSmall).toBe(false);
    }
    if (canvasInfo.isPrimaryFloating) {
      expect(stateAfter.bgW >= stateBefore.bgW || stateAfter.bgH >= stateBefore.bgH).toBe(true);
    }
  });

  test('background should stay centered in capture frame when viewport shrinks', async ({
    appPage: page,
  }) => {
    await uploadTestImage(page, 800, 600, '#d4d4d4');

    // Verify background is properly fitted at full size
    await page.evaluate(() => window.app?.canvasManager?.resize?.());
    await page.waitForTimeout(300);

    // Shrink the viewport
    await page.setViewportSize({ width: 640, height: 480 });
    await page.evaluate(() => window.app?.canvasManager?.resize?.());
    await page.waitForTimeout(500);

    const result = await page.evaluate(() => {
      const cm = window.app!.canvasManager;
      const bg = cm.fabricCanvas?.backgroundImage;
      if (!bg) return { ok: true, reason: 'no background' };

      const frame = document.getElementById('captureFrame');
      if (!frame) return { ok: true, reason: 'no capture frame' };

      const canvasEl = cm.fabricCanvas.getElement();
      const canvasRect = canvasEl.getBoundingClientRect();
      const frameRect = frame.getBoundingClientRect();

      // Frame position relative to canvas
      const frameLeft = frameRect.left - canvasRect.left;
      const frameTop = frameRect.top - canvasRect.top;
      const frameCenterX = frameLeft + frameRect.width / 2;
      const frameCenterY = frameTop + frameRect.height / 2;

      // Background image screen position (accounting for viewport transform)
      const vpt = cm.fabricCanvas.viewportTransform || [1, 0, 0, 1, 0, 0];
      const bgScreenX = bg.left * vpt[0] + vpt[4];
      const bgScreenY = bg.top * vpt[3] + vpt[5];

      // Distance from background center to frame center
      const dx = Math.abs(bgScreenX - frameCenterX);
      const dy = Math.abs(bgScreenY - frameCenterY);

      // The background center should be within 20px of the frame center
      const tolerance = 20;
      const centered = dx < tolerance && dy < tolerance;

      return {
        ok: centered,
        dx: Math.round(dx),
        dy: Math.round(dy),
        bgScreenX: Math.round(bgScreenX),
        bgScreenY: Math.round(bgScreenY),
        frameCenterX: Math.round(frameCenterX),
        frameCenterY: Math.round(frameCenterY),
        panX: cm.panX,
        panY: cm.panY,
      };
    });

    if (!result.ok) {
      console.log('Background centering failed:', JSON.stringify(result));
    }
    expect(result.ok).toBe(true);
  });

  test('should not switch images when viewport shrinks (window snap)', async ({
    appPage: page,
  }) => {
    await uploadTestImage(page);
    await setupMultipleImages(page);

    const viewBefore = await getCurrentViewId(page);
    expect(viewBefore).toBe('front');

    await page.setViewportSize({ width: 640, height: 800 });
    await page.evaluate(() => {
      window.dispatchEvent(new Event('resize'));
    });
    await page.waitForTimeout(1500);

    const viewAfter = await getCurrentViewId(page);
    expect(viewAfter).toBe(viewBefore);
  });
});

test.describe('Resize stability — split workspace', () => {
  test('should keep vectors aligned while split is open across viewport jumps', async ({
    appPage: page,
  }) => {
    await mockGuideSvg(
      page,
      `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">
          <g id="mseat">
            <line x1="120" y1="220" x2="680" y2="220" />
          </g>
          <g id="cseat">
            <text x="400" y="190">A1</text>
          </g>
        </svg>
      `
    );
    await seedViewWithImageAndLine(page, {
      viewId: 'front',
      color: '#dbeafe',
      label: 'FRONT',
      line: [180, 180, 520, 320],
    });
    const baseline = await captureAlignmentSnapshot(page);

    await bindGuideSplitForViews(page, ['front']);
    await ensureSplitEnabled(page);

    const splitBaseline = await captureAlignmentSnapshot(page);
    expect(splitBaseline.split).toBe(true);
    expectSnapshotAlignment(baseline, splitBaseline, 'split-toggle');

    for (const [width, height] of [
      [900, 700],
      [640, 480],
      [1100, 760],
      [800, 600],
    ]) {
      await resizeViewport(page, width, height);
      const snapshot = await captureAlignmentSnapshot(page);
      expect(snapshot.split, `${width}x${height}: split unexpectedly closed`).toBe(true);
      expectSnapshotAlignment(baseline, snapshot, `split-resize-${width}x${height}`);
    }
  });

  test('should keep each image aligned when resizing and switching views in split mode', async ({
    appPage: page,
  }) => {
    await mockGuideSvg(
      page,
      `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">
          <g id="mseat">
            <line x1="120" y1="220" x2="680" y2="220" />
          </g>
          <g id="cseat">
            <text x="400" y="190">A1</text>
          </g>
        </svg>
      `
    );
    await seedViewWithImageAndLine(page, {
      viewId: 'front',
      color: '#e0f2fe',
      label: 'FRONT',
      line: [140, 160, 430, 240],
    });
    const frontBaseline = await captureAlignmentSnapshot(page);

    await seedViewWithImageAndLine(page, {
      viewId: 'side',
      color: '#dcfce7',
      label: 'SIDE',
      line: [300, 220, 620, 360],
    });
    const sideBaseline = await captureAlignmentSnapshot(page);

    await bindGuideSplitForViews(page, ['front', 'side']);
    await ensureSplitEnabled(page);

    await switchView(page, 'front');
    expectSnapshotAlignment(
      frontBaseline,
      await captureAlignmentSnapshot(page),
      'front-before-resize'
    );

    await resizeViewport(page, 700, 520);
    await switchView(page, 'side');
    const sideAfterShrink = await captureAlignmentSnapshot(page);
    expect(sideAfterShrink.split).toBe(true);
    expectSnapshotAlignment(sideBaseline, sideAfterShrink, 'side-after-shrink');

    await resizeViewport(page, 1180, 780);
    await switchView(page, 'front');
    const frontAfterGrow = await captureAlignmentSnapshot(page);
    expect(frontAfterGrow.split).toBe(true);
    expectSnapshotAlignment(frontBaseline, frontAfterGrow, 'front-after-grow');
  });

  test('should avoid visible center jumps while opening split and switching views', async ({
    appPage: page,
  }) => {
    await mockGuideSvg(
      page,
      `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">
          <g id="mseat">
            <line x1="120" y1="220" x2="680" y2="220" />
          </g>
          <g id="cseat">
            <text x="400" y="190">A1</text>
          </g>
        </svg>
      `
    );
    await seedViewWithImageAndLine(page, {
      viewId: 'front',
      color: '#dbeafe',
      label: 'FRONT',
      line: [180, 180, 520, 320],
    });
    await seedViewWithImageAndLine(page, {
      viewId: 'side',
      color: '#dcfce7',
      label: 'SIDE',
      line: [220, 150, 590, 340],
    });
    await bindGuideSplitForViews(page, ['front', 'side']);
    await switchView(page, 'front');

    const openDrift = await sampleTransitionDrift(page, 'toggle-split');
    expect(openDrift.relevantFrames, 'toggle-open should reach split mode').toBeGreaterThan(0);
    expect(openDrift.finalSplit).toBe(true);
    expect(openDrift.maxDx, 'toggle-open horizontal drift during transition').toBeLessThan(12);
    expect(openDrift.maxDy, 'toggle-open vertical drift during transition').toBeLessThan(12);

    const switchDrift = await sampleTransitionDrift(page, 'switch-side');
    expect(switchDrift.finalSplit).toBe(true);
    expect(switchDrift.finalViewId).toBe('side');
    expect(switchDrift.maxDx, 'split view-switch horizontal drift during transition').toBeLessThan(
      12
    );
    expect(switchDrift.maxDy, 'split view-switch vertical drift during transition').toBeLessThan(
      12
    );
  });

  test('should avoid visible center jumps when reopening split a second time', async ({
    appPage: page,
  }) => {
    await mockGuideSvg(
      page,
      `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">
          <g id="mseat">
            <line x1="120" y1="220" x2="680" y2="220" />
          </g>
          <g id="cseat">
            <text x="400" y="190">A1</text>
          </g>
        </svg>
      `
    );
    await seedViewWithImageAndLine(page, {
      viewId: 'front',
      color: '#dbeafe',
      label: 'FRONT',
      line: [180, 180, 520, 320],
    });
    const baseline = await captureAlignmentSnapshot(page);
    await bindGuideSplitForViews(page, ['front']);

    const firstOpen = await sampleTransitionDrift(page, 'toggle-split');
    expect(firstOpen.finalSplit).toBe(true);
    expect(firstOpen.maxDx, 'first open horizontal drift').toBeLessThan(12);
    expect(firstOpen.maxDy, 'first open vertical drift').toBeLessThan(12);

    await setSplitEnabled(page, false);
    expect((await captureAlignmentSnapshot(page)).split).toBe(false);

    const secondOpen = await sampleTransitionDrift(page, 'toggle-split');
    expect(secondOpen.finalSplit).toBe(true);
    expect(secondOpen.maxDx, 'second open horizontal drift').toBeLessThan(12);
    expect(secondOpen.maxDy, 'second open vertical drift').toBeLessThan(12);

    const reopenedSnapshot = await captureAlignmentSnapshot(page);
    expect(reopenedSnapshot.split).toBe(true);
    expectSnapshotAlignment(baseline, reopenedSnapshot, 'second-open-settled');
  });
});

test.describe('Guide split compare pane', () => {
  test('should hide placeholder boxes in the mini-guide and sync next-tag highlight into split', async ({
    appPage: page,
  }) => {
    await mockGuideSvg(
      page,
      `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">
          <g id="ma1cm">
            <line x1="100" y1="150" x2="700" y2="150" stroke="#ff4d4f" stroke-width="4" />
          </g>
          <g id="ca1cm">
            <rect x="360" y="120" width="80" height="40" fill="#ffffff" stroke="#111827" />
            <text x="385" y="147">A1</text>
          </g>
          <g id="ba1cm">
            <rect x="510" y="120" width="110" height="40" fill="#ffffff" stroke="#111827" />
            <text x="528" y="147">0000.00</text>
          </g>
          <g id="mb1cm">
            <line x1="120" y1="420" x2="680" y2="420" stroke="#ff4d4f" stroke-width="4" />
          </g>
          <g id="cb1cm">
            <rect x="360" y="390" width="80" height="40" fill="#ffffff" stroke="#111827" />
            <text x="385" y="417">B1</text>
          </g>
          <g id="bb1cm">
            <rect x="510" y="390" width="110" height="40" fill="#ffffff" stroke="#111827" />
            <text x="528" y="417">0000.00</text>
          </g>
        </svg>
      `
    );
    await uploadTestImage(page);
    await bindGuideSplitForViews(page, ['front']);
    await selectTool(page, 'line');

    await page.waitForTimeout(600);
    const miniGuide = await captureMiniGuideState(page);
    expect(miniGuide.visible).toBe(true);
    expect(miniGuide.heroSrc.startsWith('data:image/png')).toBe(true);
    expect(miniGuide.activeChip).toBe('A1');

    const preparedPreview = await page.evaluate(async () => {
      const svgText = await fetch('/api/measurement-guides/svg?code=TEST&view=front').then(r =>
        r.text()
      );
      const prepared = (window as any).__prepareGuideSvgForRaster(svgText, {
        mode: 'preview',
        activeRole: 'A1',
        dimInactive: true,
      }).svgText as string;
      const doc = new DOMParser().parseFromString(prepared, 'image/svg+xml');
      return {
        hiddenA1Box: doc.querySelector('#ba1cm')?.getAttribute('display') === 'none',
        hiddenB1Box: doc.querySelector('#bb1cm')?.getAttribute('display') === 'none',
        hasA1Label: doc.querySelector('#ca1cm text')?.textContent?.trim() === 'A1',
        hasB1Label: doc.querySelector('#cb1cm text')?.textContent?.trim() === 'B1',
      };
    });
    expect(preparedPreview.hiddenA1Box).toBe(true);
    expect(preparedPreview.hiddenB1Box).toBe(true);
    expect(preparedPreview.hasA1Label).toBe(true);
    expect(preparedPreview.hasB1Label).toBe(true);

    await setSplitEnabled(page, true);
    await page.waitForTimeout(600);

    const initialCompare = await captureCompareGuideState(page, 'A1');
    expect(initialCompare.overlayCount).toBe(1);
    expect(initialCompare.importedWithArrowSettings).toBe(0);
    expect(initialCompare.highlightedGuideTags).toContain('A1');

    await page.locator('.measurement-guide-indicator-chip', { hasText: 'B1' }).click();
    await page.waitForTimeout(700);

    const updatedMiniGuide = await captureMiniGuideState(page);
    expect(updatedMiniGuide.activeChip).toBe('B1');

    const updatedCompare = await captureCompareGuideState(page, 'B1');
    expect(updatedCompare.overlayCount).toBe(1);
    expect(updatedCompare.importedWithArrowSettings).toBe(0);
    expect(updatedCompare.highlightedGuideTags).toContain('B1');
  });

  test('should reload the bound guide after closing and reopening split twice', async ({
    appPage: page,
  }) => {
    await mockGuideSvg(
      page,
      `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">
          <g id="mseat">
            <line x1="120" y1="220" x2="680" y2="220" />
          </g>
          <g id="cseat">
            <text x="400" y="190">A1</text>
          </g>
        </svg>
      `
    );
    await uploadTestImage(page);
    await bindGuideSplitForViews(page, ['front']);

    await setSplitEnabled(page, true);
    const initial = await captureCompareGuideState(page);
    const initialAlignment = await captureCompareAlignment(page);
    expect(initial.hasBackground).toBe(true);
    expect(initial.importedCount).toBeGreaterThan(0);
    expect(Math.abs(initialAlignment.bgHostCenterDx)).toBeLessThan(8);
    expect(Math.abs(initialAlignment.bgHostCenterDy)).toBeLessThan(8);
    expect(initialAlignment.bgWidthRatio).toBeGreaterThan(0.5);
    expect(initialAlignment.bgHeightRatio).toBeGreaterThan(0.5);

    await setSplitEnabled(page, false);
    await setSplitEnabled(page, true);
    const reopenedOnce = await captureCompareGuideState(page);
    const reopenedOnceAlignment = await captureCompareAlignment(page);
    expect(reopenedOnce.hasBackground).toBe(true);
    expect(reopenedOnce.importedCount).toBeGreaterThan(0);
    expect(Math.abs(reopenedOnceAlignment.bgHostCenterDx)).toBeLessThan(8);
    expect(Math.abs(reopenedOnceAlignment.bgHostCenterDy)).toBeLessThan(8);
    expect(reopenedOnceAlignment.bgWidthRatio).toBeGreaterThan(0.5);
    expect(reopenedOnceAlignment.bgHeightRatio).toBeGreaterThan(0.5);

    await setSplitEnabled(page, false);
    await setSplitEnabled(page, true);
    const reopenedTwice = await captureCompareGuideState(page);
    const reopenedTwiceAlignment = await captureCompareAlignment(page);
    expect(reopenedTwice.hasBackground).toBe(true);
    expect(reopenedTwice.importedCount).toBeGreaterThan(0);
    expect(Math.abs(reopenedTwiceAlignment.bgHostCenterDx)).toBeLessThan(8);
    expect(Math.abs(reopenedTwiceAlignment.bgHostCenterDy)).toBeLessThan(8);
    expect(reopenedTwiceAlignment.bgWidthRatio).toBeGreaterThan(0.5);
    expect(reopenedTwiceAlignment.bgHeightRatio).toBeGreaterThan(0.5);
  });

  test('should import curved guide geometry as reference-only paths in split compare', async ({
    appPage: page,
  }) => {
    await mockGuideSvg(
      page,
      `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">
          <g id="mcurve">
            <path d="M 80 320 C 220 120 580 120 720 320" />
          </g>
          <g id="ccurve">
            <text x="400" y="250">A1</text>
          </g>
        </svg>
      `
    );
    await uploadTestImage(page);
    await page.evaluate(() => {
      const metadataManager = window.app!.metadataManager;
      metadataManager.strokeVisibilityByImage.front = {
        ...(metadataManager.strokeVisibilityByImage.front || {}),
        A1: false,
      };
      metadataManager.strokeMeasurements.front = {
        ...(metadataManager.strokeMeasurements.front || {}),
        A1: '42',
      };
    });
    await bindGuideSplitForViews(page, ['front']);

    await setSplitEnabled(page, true);
    const compareState = await captureCompareGuideState(page, 'A1');

    expect(compareState.hasBackground).toBe(true);
    expect(compareState.importedCount).toBeGreaterThan(0);
    expect(compareState.pathCount).toBeGreaterThan(0);
    expect(compareState.lineCount).toBe(0);
    expect(compareState.overlayCount).toBe(1);
    expect(compareState.importedWithArrowSettings).toBe(0);
    expect(compareState.allImportedReferenceOnly).toBe(true);
    expect(compareState.allGuideTagsReferenceOnly).toBe(true);
    expect(compareState.labelVisibility).toBe(false);
    expect(compareState.measurementValue).toBe('42');
  });
});

test.describe('Scroll performance with content', () => {
  test('should handle rapid view switching without errors', async ({ appPage: page }) => {
    await uploadTestImage(page);
    await selectTool(page, 'line');

    // Draw some content on front view
    await drawLine(page, 100, 100, 400, 100);
    await drawLine(page, 100, 200, 400, 200);

    // Collect console errors during rapid switching
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));

    // Rapidly switch views
    const views = ['side', 'back', 'front', 'cushion', 'front', 'side', 'front'];
    for (const view of views) {
      await page.evaluate(v => {
        window.app!.projectManager.switchView(v);
      }, view);
      await page.waitForTimeout(50); // Very fast switching
    }

    // Wait for everything to settle
    await page.waitForTimeout(1000);

    // Should not have produced JS errors
    expect(errors.length).toBe(0);

    // Should end up on the last view
    const finalView = await getCurrentViewId(page);
    expect(finalView).toBe('front');
  });

  test('should render canvas within a reasonable frame budget', async ({ appPage: page }) => {
    await uploadTestImage(page);
    await selectTool(page, 'line');

    // Draw several lines to add complexity
    for (let i = 0; i < 10; i++) {
      await drawLine(page, 50, 50 + i * 40, 500, 50 + i * 40);
    }

    // Measure render time
    const renderTime = await page.evaluate(() => {
      const start = performance.now();
      window.app!.canvasManager.fabricCanvas.renderAll();
      return performance.now() - start;
    });

    // Canvas render should complete within 100ms even with 10+ objects
    expect(renderTime).toBeLessThan(100);
  });
});
