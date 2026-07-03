import { expect, test, waitForApp, waitForCanvasLayoutSettle } from './fixtures';
import type { Page } from '@playwright/test';

type WorkflowSnapshot = {
  viewId: string;
  rotation: number;
  backgroundAngle: number;
  frameWidth: number;
  frameHeight: number;
  frameAspect: number;
  zoom: number;
  measurement: number;
  normalizedEndpoints: Array<{ x: number; y: number }>;
  normalizedLength: number;
  thumbnailRotation: number;
};

async function seedWorkflowView(
  page: Page,
  viewId: string,
  width: number,
  height: number,
  rotation: number,
  measurement: number
) {
  await page.evaluate(
    async ({ id, imageWidth, imageHeight, rotateBy, value }) => {
      const manager = window.app!.projectManager;
      const source = document.createElement('canvas');
      source.width = imageWidth;
      source.height = imageHeight;
      const context = source.getContext('2d')!;
      context.fillStyle = '#315b96';
      context.fillRect(0, 0, imageWidth, imageHeight);
      context.fillStyle = '#f97316';
      context.fillRect(imageWidth * 0.12, imageHeight * 0.16, imageWidth * 0.3, imageHeight * 0.24);
      context.strokeStyle = '#ffffff';
      context.lineWidth = 12;
      context.strokeRect(20, 20, imageWidth - 40, imageHeight - 40);
      const url = source.toDataURL('image/png');
      await manager.addImage(id, url, { refreshBackground: false });
      window.addImageToSidebar?.(url, id, `${id}.png`);
      await manager.whenIdle?.();
      await manager.switchView(id, true);
      await manager.whenIdle?.();
    },
    { id: viewId, imageWidth: width, imageHeight: height, rotateBy: rotation, value: measurement }
  );
  await waitForCanvasLayoutSettle(page);
  await page.evaluate(
    async ({ id, rotateBy, value }) => {
      const manager = window.app!.projectManager;
      const canvas = window.app!.canvasManager.fabricCanvas;
      if (!canvas.backgroundImage) {
        await manager.setBackgroundImage(
          manager.views[id].image,
          manager.views[id]?.fitMode || 'scale-page-size'
        );
      }
      const background = canvas.backgroundImage;
      if (!background) throw new Error(`Background did not load for ${id}`);
      const bounds = background.getBoundingRect(true, true);
      const scope = window.getCaptureTabScopedLabel?.(id) || id;
      const line = new (window as any).fabric.Line(
        [
          bounds.left + bounds.width * 0.2,
          bounds.top + bounds.height * 0.28,
          bounds.left + bounds.width * 0.78,
          bounds.top + bounds.height * 0.72,
        ],
        { stroke: '#22c55e', strokeWidth: 4, objectCaching: false }
      );
      line.strokeMetadata = { strokeLabel: 'A1', imageLabel: scope, type: 'line' };
      line.imageLabel = scope;
      canvas.add(line);
      window.app!.metadataManager.rebuildMetadataFromCanvas(id, canvas);
      window.app!.metadataManager.strokeMeasurements[scope] = {
        ...(window.app!.metadataManager.strokeMeasurements[scope] || {}),
        A1: { inch: value, cm: value * 2.54, inputUnit: 'inches' },
      };
      manager.rotateCurrentView(rotateBy);
      manager.saveCurrentViewState();
      canvas.requestRenderAll();
    },
    { id: viewId, rotateBy: rotation, value: measurement }
  );
  await waitForCanvasLayoutSettle(page);
}

async function captureWorkflowView(page: Page, viewId: string): Promise<WorkflowSnapshot> {
  await page.evaluate(id => window.app!.projectManager.switchView(id, true), viewId);
  await waitForCanvasLayoutSettle(page);
  return page.evaluate(id => {
    const manager = window.app!.projectManager;
    const canvas = window.app!.canvasManager.fabricCanvas;
    const fabricApi = (window as any).fabric;
    const background = canvas.backgroundImage;
    const line = canvas
      .getObjects()
      .find(
        (object: any) =>
          object?.type === 'line' &&
          !object?.isConnectorLine &&
          object?.strokeMetadata?.strokeLabel === 'A1'
      );
    if (!background || !line) throw new Error(`Missing rotated workflow geometry for ${id}`);

    const viewport = canvas.viewportTransform;
    const backgroundTransform = fabricApi.util.multiplyTransformMatrices(
      viewport,
      background.calcTransformMatrix()
    );
    const halfWidth = Number(background.width) / 2;
    const halfHeight = Number(background.height) / 2;
    const backgroundCorners = [
      new fabricApi.Point(-halfWidth, -halfHeight),
      new fabricApi.Point(halfWidth, -halfHeight),
      new fabricApi.Point(halfWidth, halfHeight),
      new fabricApi.Point(-halfWidth, halfHeight),
    ].map((point: any) => fabricApi.util.transformPoint(point, backgroundTransform));
    const minX = Math.min(...backgroundCorners.map((point: any) => point.x));
    const maxX = Math.max(...backgroundCorners.map((point: any) => point.x));
    const minY = Math.min(...backgroundCorners.map((point: any) => point.y));
    const maxY = Math.max(...backgroundCorners.map((point: any) => point.y));

    const linePoints = line.calcLinePoints();
    const lineTransform = fabricApi.util.multiplyTransformMatrices(
      viewport,
      line.calcTransformMatrix()
    );
    const endpoints = [
      fabricApi.util.transformPoint(
        new fabricApi.Point(linePoints.x1, linePoints.y1),
        lineTransform
      ),
      fabricApi.util.transformPoint(
        new fabricApi.Point(linePoints.x2, linePoints.y2),
        lineTransform
      ),
    ];
    const normalizedEndpoints = endpoints.map((point: any) => ({
      x: (point.x - minX) / Math.max(maxX - minX, 1),
      y: (point.y - minY) / Math.max(maxY - minY, 1),
    }));
    const normalizedLength =
      Math.hypot(endpoints[1].x - endpoints[0].x, endpoints[1].y - endpoints[0].y) /
      Math.hypot(maxX - minX, maxY - minY);
    const scope = line.strokeMetadata.imageLabel;
    const measurement = Number(window.app!.metadataManager.strokeMeasurements?.[scope]?.A1?.inch);
    const frame = document.getElementById('captureFrame')!.getBoundingClientRect();
    const thumbnail = document.querySelector<HTMLElement>(
      `.image-container[data-label="${id}"] img, .image-thumbnail[data-label="${id}"]`
    );
    return {
      viewId: id,
      rotation: Number(manager.views[id]?.rotation) || 0,
      backgroundAngle: Number(background.angle) || 0,
      frameWidth: frame.width,
      frameHeight: frame.height,
      frameAspect: frame.width / frame.height,
      zoom: Number(window.app!.canvasManager.zoomLevel) || 0,
      measurement,
      normalizedEndpoints,
      normalizedLength,
      thumbnailRotation: Number(thumbnail?.dataset?.rotation) || 0,
    };
  }, viewId);
}

function expectWorkflowStable(
  before: WorkflowSnapshot,
  after: WorkflowSnapshot,
  options: { legacyMigration?: boolean } = {}
) {
  const label = before.viewId;
  expect(after.rotation, `${label}: rotation changed`).toBeCloseTo(before.rotation, 5);
  expect(after.backgroundAngle, `${label}: background angle changed`).toBeCloseTo(
    before.backgroundAngle,
    5
  );
  expect(after.frameAspect, `${label}: frame aspect changed`).toBeCloseTo(before.frameAspect, 2);
  expect(after.measurement, `${label}: measurement changed`).toBeCloseTo(before.measurement, 6);
  expect(after.thumbnailRotation, `${label}: thumbnail rotation changed`).toBeCloseTo(
    before.thumbnailRotation,
    5
  );
  expect(after.normalizedLength, `${label}: normalized line length changed`).toBeCloseTo(
    before.normalizedLength,
    options.legacyMigration ? 2 : 4
  );
  after.normalizedEndpoints.forEach((point, index) => {
    const precision = options.legacyMigration ? 2 : 3;
    expect(point.x).toBeCloseTo(before.normalizedEndpoints[index].x, precision);
    expect(point.y).toBeCloseTo(before.normalizedEndpoints[index].y, precision);
  });
  const frameScale = Math.min(
    after.frameWidth / Math.max(before.frameWidth, 1),
    after.frameHeight / Math.max(before.frameHeight, 1)
  );
  const zoomScale = after.zoom / Math.max(before.zoom, 0.0001);
  expect(zoomScale, `${label}: zoom did not track frame scaling`).toBeCloseTo(frameScale, 2);
}

test.describe('Rotated project real workflow', () => {
  test('rotation, vectors, measurements, and scale survive switching, reorder, save, and load', async ({
    page,
  }) => {
    await page.goto('/');
    await waitForApp(page);
    await seedWorkflowView(page, 'workflow-wide', 960, 540, 90, 41.25);
    await seedWorkflowView(page, 'workflow-tall', 540, 960, 270, 23.75);
    await seedWorkflowView(page, 'workflow-control', 800, 600, 0, 18.5);

    const labels = ['workflow-wide', 'workflow-tall', 'workflow-control'];
    const baseline = new Map<string, WorkflowSnapshot>();
    for (const label of labels) baseline.set(label, await captureWorkflowView(page, label));

    for (let cycle = 0; cycle < 5; cycle += 1) {
      for (const label of [...labels].reverse()) {
        expectWorkflowStable(baseline.get(label)!, await captureWorkflowView(page, label));
      }
    }

    await page.evaluate(() => {
      const source = document.querySelector<HTMLElement>(
        '#imageList .image-container[data-label="workflow-wide"]'
      )!;
      const target = document.querySelector<HTMLElement>(
        '#imageList .image-container[data-label="workflow-control"]'
      )!;
      const transfer = new DataTransfer();
      source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
      target.dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })
      );
      source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }));
    });

    const saved = await page.evaluate(() =>
      window.app!.projectManager.getProjectData({ embedImages: true })
    );
    await page.evaluate(data => window.app!.projectManager.loadProjectFromData(data), saved);
    await page.waitForFunction(() => !(window as any).__isLoadingProject, { timeout: 30_000 });
    await page.waitForTimeout(900);

    for (let cycle = 0; cycle < 4; cycle += 1) {
      for (const label of labels) {
        expectWorkflowStable(baseline.get(label)!, await captureWorkflowView(page, label));
      }
    }
  });

  test('repairs legacy rotated saves whose background rectangle kept the unrotated aspect', async ({
    page,
  }) => {
    await page.goto('/');
    await waitForApp(page);
    await seedWorkflowView(page, 'legacy-rotation-workflow', 960, 540, 90, 37.5);
    const baseline = await captureWorkflowView(page, 'legacy-rotation-workflow');

    const saved = await page.evaluate(async () => {
      const data = await window.app!.projectManager.getProjectData({ embedImages: true });
      const view = data.views['legacy-rotation-workflow'];
      const rect = view.backgroundWorldRect;
      if (!rect) throw new Error('Missing background rectangle in legacy fixture');
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      view.backgroundWorldRect = {
        left: centerX - rect.height / 2,
        top: centerY - rect.width / 2,
        width: rect.height,
        height: rect.width,
      };
      return data;
    });

    await page.evaluate(data => window.app!.projectManager.loadProjectFromData(data), saved);
    await page.waitForFunction(() => !(window as any).__isLoadingProject, { timeout: 30_000 });
    await page.waitForTimeout(700);
    expectWorkflowStable(baseline, await captureWorkflowView(page, 'legacy-rotation-workflow'), {
      legacyMigration: true,
    });
  });
});
