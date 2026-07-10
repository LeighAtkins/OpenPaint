import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { test, expect, type Page } from './fixtures';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=',
  'base64'
);

const VIEW_IDS = ['front', 'side', 'back', 'cushion', 'detail-a', 'detail-b'];
const ACTIVE_VIEW_ID = 'detail-b';

function makeLine(scopeId: string, label: string) {
  return {
    type: 'line',
    version: '5.5.2',
    originX: 'center',
    originY: 'center',
    left: 400,
    top: 300,
    width: 200,
    height: 0,
    fill: 'rgb(0,0,0)',
    stroke: '#2563eb',
    strokeWidth: 2,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    visible: true,
    x1: -100,
    y1: 0,
    x2: 100,
    y2: 0,
    strokeMetadata: {
      imageLabel: scopeId,
      strokeLabel: label,
      visible: true,
      labelVisible: true,
    },
  };
}

function makeView(viewId: string, index: number) {
  const tabId = `frame-${index + 1}`;
  const scopeId = `${viewId}::tab:${tabId}`;
  const line = makeLine(scopeId, `A${index + 1}`);
  const isActiveFixture = viewId === ACTIVE_VIEW_ID;
  const savedViewport = isActiveFixture
    ? { zoom: 1.254351183271422, panX: 344.1922242163696, panY: 60.49465753996418 }
    : { zoom: 1, panX: 0, panY: 0 };
  const savedFrameWorldRect = isActiveFixture
    ? {
        left: 594.5853658536583,
        top: 51.09349593495936,
        width: 706.8617886178862,
        height: 584.3658536585366,
      }
    : { left: 456, top: 106, width: 977, height: 733 };
  return {
    imageUrl: `images/${viewId}.png`,
    imageAssetPath: `images/${viewId}.png`,
    fitMode: 'keep-size',
    rotation: 0,
    backgroundRotation: 0,
    viewport: {
      ...savedViewport,
      savedCanvasWidth: 1920,
      savedCanvasHeight: 912,
    },
    backgroundWorldRect: { left: 456, top: 106, width: 977, height: 733 },
    tabs: {
      tabs: [
        {
          id: tabId,
          name: 'Frame 1',
          type: 'normal',
          color: '#22c55e',
          viewport: { ...savedViewport, rotation: 0 },
          captureFrame: {
            left: 456,
            top: 106,
            width: 977,
            height: 733,
            windowWidth: 1920,
            windowHeight: 960,
            relativeLeft: 456 / 1920,
            relativeTop: 106 / 960,
            relativeWidth: 977 / 1920,
            relativeHeight: 733 / 960,
            worldRect: savedFrameWorldRect,
          },
        },
        {
          id: 'master',
          name: 'Master',
          type: 'master',
          color: null,
          viewport: { zoom: 1, panX: 0, panY: 0, rotation: 0 },
          captureFrame: null,
        },
      ],
      activeTabId: tabId,
      masterTabId: 'master',
      lastNonMasterId: tabId,
    },
    canvasJSON: {
      version: '5.5.2',
      objects: [line],
      background: '#ffffff',
      backgroundImage: null,
    },
    metadata: {
      vectorStrokesByImage: { [scopeId]: { [`A${index + 1}`]: line } },
      strokeMeasurements: {},
      strokeVisibilityByImage: { [scopeId]: { [`A${index + 1}`]: true } },
      strokeLabelVisibility: { [scopeId]: { [`A${index + 1}`]: true } },
    },
  };
}

async function createArchive(): Promise<string> {
  const zip = new JSZip();
  const views = Object.fromEntries(
    VIEW_IDS.map((viewId, index) => [viewId, makeView(viewId, index)])
  );
  const manifest = {
    archiveFormat: 'openpaint-zip-v1',
    version: '2.0-fabric',
    name: 'Archive Pipeline Fixture',
    projectName: 'Archive Pipeline Fixture',
    currentViewId: ACTIVE_VIEW_ID,
    viewOrder: VIEW_IDS,
    views,
    metadata: {
      version: 1,
      imagePartLabels: { [ACTIVE_VIEW_ID]: 'front' },
      measurementGuideModelSelections: [
        { id: 'WRONG::front', code: 'WRONG', variant: 'front' },
        { id: 'RIGHT::side', code: 'RIGHT', variant: 'side' },
      ],
      measurementGuideModelLinksByScope: {
        front: 'WRONG::front',
        [ACTIVE_VIEW_ID]: 'RIGHT::side',
      },
      measurementGuideBindingsByScope: {
        front: { codes: ['WRONG'], activeCode: 'WRONG', activeVariant: 'front' },
        [ACTIVE_VIEW_ID]: { codes: ['RIGHT'], activeCode: 'RIGHT', activeVariant: 'side' },
      },
    },
  };

  for (const viewId of VIEW_IDS) zip.file(`images/${viewId}.png`, PNG_1X1);
  zip.file('project.json', JSON.stringify(manifest));
  const output = path.join(
    await fs.mkdtemp(path.join(os.tmpdir(), 'openpaint-archive-')),
    'fixture.opaint'
  );
  await fs.writeFile(output, await zip.generateAsync({ type: 'nodebuffer' }));
  return output;
}

async function createLegacyGuideArchive(): Promise<string> {
  const zip = new JSZip();
  const viewId = 'cs5b-ra-sb-back';
  const line = makeLine(viewId, 'J1');
  delete (line.strokeMetadata as any).type;
  const manifest = {
    archiveFormat: 'openpaint-zip-v1',
    version: '2.0-fabric',
    name: 'Legacy Guide Fixture',
    projectName: 'Legacy Guide Fixture',
    currentViewId: viewId,
    viewOrder: [viewId],
    views: {
      [viewId]: {
        imageUrl: `images/${viewId}.png`,
        imageAssetPath: `images/${viewId}.png`,
        fitMode: 'keep-size',
        rotation: 0,
        backgroundRotation: 0,
        viewport: { zoom: 1, panX: 0, panY: 0, savedCanvasWidth: 960, savedCanvasHeight: 720 },
        backgroundWorldRect: { left: 120, top: 90, width: 720, height: 540 },
        canvasJSON: {
          version: '5.5.2',
          objects: [line],
          background: '#ffffff',
          backgroundImage: null,
        },
        metadata: {
          vectorStrokesByImage: { [viewId]: {} },
          strokeMeasurements: {},
          strokeVisibilityByImage: { [viewId]: {} },
          strokeLabelVisibility: { [viewId]: {} },
        },
      },
    },
    metadata: {
      version: 1,
      measurementGuideModelSelections: [
        { id: 'CS5B-RA-SB::back', code: 'CS5B-RA-SB', variant: 'back' },
      ],
      measurementGuideModelLinksByScope: {
        [viewId]: 'CS5B-RA-SB::back',
      },
    },
  };

  zip.file(`images/${viewId}.png`, PNG_1X1);
  zip.file('project.json', JSON.stringify(manifest));
  const output = path.join(
    await fs.mkdtemp(path.join(os.tmpdir(), 'openpaint-legacy-guide-')),
    'legacy-guide.opaint'
  );
  await fs.writeFile(output, await zip.generateAsync({ type: 'nodebuffer' }));
  return output;
}

async function loadArchive(
  page: Page,
  archivePath: string,
  expectedViewCount = VIEW_IDS.length
): Promise<void> {
  await page.evaluate(() => {
    (window as any).__archivePostLoadSwitches = [];
    window.addEventListener('openpaint:project-loaded', () => {
      (window as any).__archiveProjectLoadedAt = performance.now();
    });
    window.addEventListener('openpaint:view-switched', (event: Event) => {
      const loadedAt = Number((window as any).__archiveProjectLoadedAt || 0);
      if (!loadedAt) return;
      (window as any).__archivePostLoadSwitches.push({
        at: performance.now(),
        viewId: (event as CustomEvent).detail?.viewId,
      });
    });
  });

  const chooserPromise = page.waitForEvent('filechooser');
  await page.evaluate(() => window.app!.projectManager.promptLoadProject());
  const chooser = await chooserPromise;
  await chooser.setFiles(archivePath);
  await page.waitForFunction(
    expected =>
      !(window as any).__isLoadingProject &&
      Object.keys(window.app?.projectManager?.views || {}).length === expected,
    expectedViewCount,
    { timeout: 30_000 }
  );
  await page.waitForTimeout(1_500);
}

async function getFrameAndBackgroundCenters(page: Page) {
  return page.evaluate(() => {
    const canvas = window.app!.canvasManager.fabricCanvas;
    const background = canvas.backgroundImage;
    const canvasRect = canvas.lowerCanvasEl.getBoundingClientRect();
    const frameRect = document.getElementById('captureFrame')!.getBoundingClientRect();
    const backgroundCenter = background.getCenterPoint();
    const mapped = (window as any).fabric.util.transformPoint(
      backgroundCenter,
      canvas.viewportTransform
    );
    return {
      background: { x: mapped.x + canvasRect.left, y: mapped.y + canvasRect.top },
      frame: { x: frameRect.left + frameRect.width / 2, y: frameRect.top + frameRect.height / 2 },
      viewport: {
        zoom: window.app!.canvasManager.zoomLevel,
        panX: window.app!.canvasManager.panX,
        panY: window.app!.canvasManager.panY,
      },
    };
  });
}

test.describe('Project archive identity pipeline', () => {
  test('keeps the saved image, image scopes, and 4:3 frame stable after file load', async ({
    appPage: page,
  }) => {
    const archivePath = await createArchive();
    await loadArchive(page, archivePath);

    const state = await page.evaluate(() => {
      const frame = document.getElementById('captureFrame')!.getBoundingClientRect();
      const objects = window.app!.canvasManager.fabricCanvas.getObjects();
      return {
        currentViewId: window.app!.projectManager.currentViewId,
        postLoadSwitches: (window as any).__archivePostLoadSwitches,
        frameAspect: frame.width / frame.height,
        objectScopes: objects
          .map((object: any) => object.strokeMetadata?.imageLabel)
          .filter(Boolean),
        orderedImageLabels: [...((window as any).orderedImageLabels || [])],
      };
    });

    expect(state.currentViewId).toBe(ACTIVE_VIEW_ID);
    expect(state.postLoadSwitches.every((entry: any) => entry.viewId === ACTIVE_VIEW_ID)).toBe(
      true
    );
    expect(state.frameAspect).toBeCloseTo(4 / 3, 2);
    expect(state.objectScopes).toEqual([`${ACTIVE_VIEW_ID}::tab:frame-6`]);
    expect(state.orderedImageLabels).toEqual(VIEW_IDS);

    const before = await getFrameAndBackgroundCenters(page);
    await page.evaluate(viewId => (window as any).__recenterCaptureFrame(viewId), ACTIVE_VIEW_ID);
    const afterFirst = await getFrameAndBackgroundCenters(page);
    await page.evaluate(viewId => (window as any).__recenterCaptureFrame(viewId), ACTIVE_VIEW_ID);
    const afterSecond = await getFrameAndBackgroundCenters(page);

    expect(Math.abs(before.background.x - before.frame.x)).toBeLessThan(1);
    expect(Math.abs(before.background.y - before.frame.y)).toBeLessThan(1);
    for (const snapshot of [afterFirst, afterSecond]) {
      expect(snapshot.viewport.zoom).toBeCloseTo(before.viewport.zoom, 8);
      expect(snapshot.viewport.panX).toBeCloseTo(before.viewport.panX, 8);
      expect(snapshot.viewport.panY).toBeCloseTo(before.viewport.panY, 8);
    }
  });

  test('uses the immutable image id for sofa/guide binding, not its display label', async ({
    appPage: page,
  }) => {
    const archivePath = await createArchive();
    await loadArchive(page, archivePath);

    const activeGuide = await page.evaluate(() => {
      const input = document.getElementById('currentImageNameBox') as HTMLInputElement;
      input.value = 'front';
      input.dataset.activeViewId = 'detail-b';
      return (window as any).resolveActiveGuideForView();
    });

    expect(activeGuide).toMatchObject({
      code: 'RIGHT',
      variant: 'side',
      scopeId: ACTIVE_VIEW_ID,
    });
  });

  test('releases scroll-select after archive load so scrolling selects the centered image', async ({
    appPage: page,
  }) => {
    const archivePath = await createArchive();
    await loadArchive(page, archivePath);

    const suppressionRemaining = await page.evaluate(() =>
      Math.max(0, Number(window.__suppressScrollSelectUntil || 0) - Date.now())
    );
    expect(suppressionRemaining).toBeLessThan(2_000);
    await page.waitForFunction(
      () => Date.now() >= Number(window.__suppressScrollSelectUntil || 0),
      undefined,
      { timeout: 2_500 }
    );
    if (
      await page.locator('#imagePanel').evaluate(panel => panel.classList.contains('collapsed'))
    ) {
      await page.locator('#toggleImagePanel').click();
      await expect(page.locator('#imagePanel')).not.toHaveClass(/collapsed/);
    }

    await page.evaluate(() => {
      window.scrollToSelectEnabled = true;
      const toggle = document.getElementById('scrollSelectToggle') as HTMLInputElement | null;
      if (toggle && !toggle.checked) toggle.click();
      window.__imageListProgrammaticScrollUntil = 0;

      const imageList = document.getElementById('imageList');
      if (!imageList) throw new Error('Image list not found');
      const first = imageList.querySelector<HTMLElement>('.image-container[data-label="front"]');
      if (!first) throw new Error('Front thumbnail not found');
      imageList.scrollTop = first.offsetTop - imageList.clientHeight / 2 + first.offsetHeight / 2;
      imageList.dispatchEvent(new Event('scroll', { bubbles: true }));
      imageList.dispatchEvent(new Event('scrollend', { bubbles: true }));
      window.syncSelectionToCenteredThumbnail?.({ allowNearestFallback: true });
    });

    await expect
      .poll(() => page.evaluate(() => window.app?.projectManager?.currentViewId), {
        timeout: 2_500,
      })
      .toBe('front');
  });

  test('Mini Guide frame binding overrides an image-level Gallery binding on the active frame', async ({
    appPage: page,
  }) => {
    const archivePath = await createArchive();
    await loadArchive(page, archivePath);

    await page.evaluate(() => {
      window.openGuideBindingPanel?.({ viewId: 'detail-b', source: 'indicator' });
    });
    await expect(page.locator('#guideBindingTarget')).toBeVisible();
    await page.locator('#guideBindingTarget').selectOption('frame');
    await page.locator('#guideBindingCodes').fill('FRAME-ONLY');
    await page.locator('#guideBindingSave').click();

    const activeGuide = await page.evaluate(() => window.resolveActiveGuideForView?.('detail-b'));
    expect(activeGuide).toMatchObject({
      code: 'FRAME-ONLY',
      scopeType: 'frame',
      scopeId: 'detail-b::tab:frame-6',
    });
  });

  test('recovers legacy guide strokes with missing metadata type into Elements after archive load', async ({
    appPage: page,
  }) => {
    const archivePath = await createLegacyGuideArchive();
    await loadArchive(page, archivePath, 1);

    const state = await page.evaluate(() => {
      const viewId = 'cs5b-ra-sb-back';
      const vectorMap = window.app?.metadataManager?.vectorStrokesByImage?.[viewId] || {};
      const object = window.app?.canvasManager?.fabricCanvas
        ?.getObjects?.()
        ?.find((candidate: any) => candidate?.strokeMetadata?.strokeLabel === 'J1');
      return {
        currentViewId: window.app?.projectManager?.currentViewId,
        vectorLabels: Object.keys(vectorMap),
        objectMetadata: object?.strokeMetadata || null,
        elementsText: document.getElementById('strokesList')?.textContent || '',
      };
    });

    expect(state.currentViewId).toBe('cs5b-ra-sb-back');
    expect(state.vectorLabels).toContain('J1');
    expect(state.objectMetadata).toMatchObject({
      imageLabel: 'cs5b-ra-sb-back',
      strokeLabel: 'J1',
      type: 'line',
      isVector: true,
    });
    await expect
      .poll(() => page.evaluate(() => document.getElementById('strokesList')?.textContent || ''))
      .toContain('J1');
  });
});
