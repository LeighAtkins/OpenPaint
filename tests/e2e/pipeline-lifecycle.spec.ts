import { expect, test } from './fixtures';

async function makeImage(page, label: string, color: string) {
  await page.evaluate(
    async ({ viewId, fill }) => {
      const source = document.createElement('canvas');
      source.width = 320;
      source.height = 240;
      const context = source.getContext('2d')!;
      context.fillStyle = fill;
      context.fillRect(0, 0, source.width, source.height);
      const url = source.toDataURL('image/png');
      await window.app!.projectManager.addImage(viewId, url, { refreshBackground: false });
      if (typeof (window as any).addImageToSidebar === 'function') {
        (window as any).addImageToSidebar(url, viewId, `${viewId}.png`);
      } else {
        (window as any).addImageToGalleryCompat?.({
          src: url,
          url,
          name: `${viewId}.png`,
          label: viewId,
          original: { label: viewId, filename: `${viewId}.png` },
        });
      }
    },
    { viewId: label, fill: color }
  );
}

test.describe('Image and save lifecycle', () => {
  test('deleting an image removes every base and frame-scoped record atomically', async ({
    appPage: page,
  }) => {
    await makeImage(page, 'delete-me', '#ef4444');
    await makeImage(page, 'keep-me', '#22c55e');

    await page.evaluate(async () => {
      const manager = window.app!.projectManager as any;
      await manager.switchView('delete-me');
      const scope = 'delete-me::tab:test-frame';
      const metadata = window.app!.metadataManager as any;
      metadata.vectorStrokesByImage[scope] = { A1: { placeholder: true } };
      metadata.strokeVisibilityByImage[scope] = { A1: false };
      metadata.strokeLabelVisibility[scope] = { A1: false };
      (window as any).textElementsByImage = { [scope]: { T1: {} } };
      (window as any).shapeElementsByImage = { [scope]: { S1: {} } };
      manager.setProjectMetadata({
        imagePartLabels: { 'delete-me': 'old', 'keep-me': 'kept' },
        tagSizeByView: { [scope]: 31, 'keep-me': 18 },
        tagStyleByScope: { [scope]: { tagShape: 'circle' }, 'keep-me': {} },
        measurementGuideBindingsByScope: { [scope]: { code: 'OLD' }, 'keep-me': {} },
        measurementGuideModelLinksByImage: { 'delete-me': ['OLD'], 'keep-me': ['KEEP'] },
      });
      await manager.deleteImage('delete-me');
      await manager.whenIdle();
    });

    const state = await page.evaluate(() => {
      const manager = window.app!.projectManager as any;
      const metadata = window.app!.metadataManager as any;
      const projectMetadata = manager.getProjectMetadata();
      const galleryLabels = ((window as any).imageGallery?.getData?.() || []).map(
        (item: any) => item?.original?.label || item?.label || item?.name
      );
      const scopedKeys = (store: Record<string, unknown> | undefined) =>
        Object.keys(store || {}).filter(
          key => key === 'delete-me' || key.startsWith('delete-me::tab:')
        );
      return {
        hasView: Boolean(manager.views['delete-me']),
        currentViewId: manager.currentViewId,
        ordered: (window as any).orderedImageLabels || [],
        galleryLabels,
        vectorKeys: scopedKeys(metadata.vectorStrokesByImage),
        visibilityKeys: scopedKeys(metadata.strokeVisibilityByImage),
        labelVisibilityKeys: scopedKeys(metadata.strokeLabelVisibility),
        textKeys: scopedKeys((window as any).textElementsByImage),
        shapeKeys: scopedKeys((window as any).shapeElementsByImage),
        tagSizeKeys: scopedKeys(projectMetadata.tagSizeByView),
        tagStyleKeys: scopedKeys(projectMetadata.tagStyleByScope),
        bindingKeys: scopedKeys(projectMetadata.measurementGuideBindingsByScope),
        imageLink: projectMetadata.measurementGuideModelLinksByImage?.['delete-me'],
        imagePartLabel: projectMetadata.imagePartLabels?.['delete-me'],
      };
    });

    expect(state.hasView).toBe(false);
    expect(state.currentViewId).not.toBe('delete-me');
    expect(state.ordered).not.toContain('delete-me');
    expect(state.galleryLabels).not.toContain('delete-me');
    expect(state.vectorKeys).toEqual([]);
    expect(state.visibilityKeys).toEqual([]);
    expect(state.labelVisibilityKeys).toEqual([]);
    expect(state.textKeys).toEqual([]);
    expect(state.shapeKeys).toEqual([]);
    expect(state.tagSizeKeys).toEqual([]);
    expect(state.tagStyleKeys).toEqual([]);
    expect(state.bindingKeys).toEqual([]);
    expect(state.imageLink).toBeUndefined();
    expect(state.imagePartLabel).toBeUndefined();
  });

  test('save idle boundary waits for resize and view-transition work', async ({
    appPage: page,
  }) => {
    const elapsed = await page.evaluate(async () => {
      const manager = window.app!.projectManager as any;
      (window as any).__openpaintCaptureResizeInProgress = true;
      manager.isSwitchingView = true;
      const startedAt = performance.now();
      setTimeout(() => {
        (window as any).__openpaintCaptureResizeInProgress = false;
        manager.isSwitchingView = false;
      }, 140);
      await manager.whenIdle({ timeoutMs: 1500 });
      return performance.now() - startedAt;
    });

    expect(elapsed).toBeGreaterThanOrEqual(120);
  });

  test('a line drawn in multiview commits only to the focused image scope', async ({
    appPage: page,
  }) => {
    await makeImage(page, 'compare-left', '#dbeafe');
    await makeImage(page, 'compare-right', '#fee2e2');
    await page.evaluate(() => window.app!.projectManager.switchView('compare-left'));
    await page.waitForTimeout(500);

    for (const label of ['compare-left', 'compare-right']) {
      await page.evaluate(currentLabel => {
        const toggle = document.querySelector(
          `.image-container[data-label="${currentLabel}"] .thumbnail-compare-toggle`
        );
        if (!toggle) throw new Error(`Missing compare toggle for ${currentLabel}`);
        toggle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      }, label);
    }
    await expect(page.locator('body')).toHaveClass(/multiview-active/);
    await expect(page.locator('.multiview-pane')).toHaveCount(2);

    const targetPane = page.locator('.multiview-pane[data-compare-label="compare-right"]');
    const canvas = targetPane.locator('.upper-canvas');
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Comparison canvas is not measurable');
    await targetPane.click({ position: { x: box.width / 2, y: box.height / 2 } });
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.35);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.65, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(350);

    await page.locator('.mv-close').click();
    await expect(page.locator('body')).not.toHaveClass(/multiview-active/);
    await page.evaluate(() => window.app!.projectManager.switchView('compare-right'));
    await page.waitForTimeout(600);

    const scopes = await page.evaluate(() => {
      const manager = window.app!.projectManager as any;
      const rightObjects = manager.views['compare-right']?.canvasData?.objects || [];
      const leftObjects = manager.views['compare-left']?.canvasData?.objects || [];
      const lineScopes = (objects: any[]) =>
        objects
          .filter(object => object?.type === 'line' && !object?.isConnectorLine)
          .map(object => object?.strokeMetadata?.imageLabel || object?.imageLabel || '');
      return { left: lineScopes(leftObjects), right: lineScopes(rightObjects) };
    });

    expect(scopes.right.length).toBeGreaterThan(0);
    expect(
      scopes.right.every(
        scope => scope === 'compare-right' || scope.startsWith('compare-right::tab:')
      )
    ).toBe(true);
    expect(scopes.left).toEqual([]);
  });
});
