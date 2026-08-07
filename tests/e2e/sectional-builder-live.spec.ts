import { expect, test, waitForApp } from './fixtures';

test.describe('Live sectional builder', () => {
  test('product views render from both 45-degree angles and follow model controls', async ({
    page,
  }) => {
    await page.goto('/');
    await waitForApp(page);

    await page.locator('#projectMenuToggle').click();
    await page.locator('#sectionalBuilderBtn').click();
    await expect(page.locator('#sectionalBuilderDialog')).toBeVisible();

    const preview = page.locator('#sbProductPreview');
    // Each module renders as many small surface groups; the meaningful count
    // is the number of distinct pieces carrying each layer.
    const distinctPieces = (selector: string) =>
      preview
        .locator(selector)
        .evaluateAll(
          groups => new Set(groups.map(group => (group as HTMLElement).dataset.pieceId)).size
        );
    await page.getByRole('tab', { name: 'Left 45°' }).click();
    await expect(preview).toBeVisible();
    expect(await distinctPieces('.sb-product-layer-body')).toBe(4);
    expect(await distinctPieces('.sb-product-layer-arm')).toBe(2);
    expect(await distinctPieces('.sb-product-layer-rear')).toBe(4);
    await expect(page.locator('#sectionalBuilderDialog [data-sb-use-product]')).toHaveText(
      'Add left 45° view'
    );

    await page.locator('#sbArmStyle').selectOption('round');
    await page.locator('#sbBackStyle').selectOption('curved');
    await page.locator('#sbCushionStyle').selectOption('rounded');
    await page.locator('#sbBaseStyle').selectOption('long-skirt');
    expect(await distinctPieces('.sb-product-layer-body[data-arm="round"]')).toBe(4);
    expect(await distinctPieces('.sb-product-layer-body[data-back="curved"]')).toBe(4);
    expect(await distinctPieces('.sb-product-layer-body[data-cushion="rounded"]')).toBe(4);
    expect(await distinctPieces('.sb-product-layer-body[data-base="long-skirt"]')).toBe(4);

    const leftMarkup = await preview.innerHTML();
    await page.getByRole('tab', { name: 'Right 45°' }).click();
    await expect(preview).toBeVisible();
    expect(await distinctPieces('.sb-product-layer-body')).toBe(4);
    expect(await distinctPieces('.sb-product-layer-arm')).toBe(2);
    expect(await distinctPieces('.sb-product-layer-rear')).toBe(4);
    await expect(page.locator('#sectionalBuilderDialog [data-sb-use-product]')).toHaveText(
      'Add right 45° view'
    );
    expect(await preview.innerHTML()).not.toBe(leftMarkup);

    await page.getByRole('tab', { name: 'Plan' }).click();
    await expect(preview).toBeHidden();
    await expect(page.locator('#sbPlanView')).toBeVisible();

    await page.getByRole('tab', { name: 'Left 45°' }).click();
    await page.locator('#sectionalBuilderDialog [data-sb-use-product]').click();
    await expect(page.locator('#sectionalBuilderDialog')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Go to image 1' })).toBeVisible();
  });

  test('piece transforms update linked measurements and survive a project reload', async ({
    page,
  }) => {
    await page.goto('/');
    await waitForApp(page);

    await page.locator('#projectMenuToggle').click();
    await page.locator('#sectionalBuilderBtn').click();
    await expect(page.locator('#sectionalBuilderDialog')).toBeVisible();
    await page.locator('#sectionalBuilderDialog [data-sb-use]').click();

    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.app?.canvasManager?.fabricCanvas
              ?.getObjects()
              .filter(object => object?.customData?.sectionalPiece === true).length || 0
        )
      )
      .toBe(4);

    const transformed = await page.evaluate(() => {
      const app = window.app;
      const canvas = app?.canvasManager?.fabricCanvas;
      if (!app || !canvas) throw new Error('Canvas unavailable');
      const group = canvas.getObjects().find(object => object?.customData?.sectionalPiece === true);
      if (!group) throw new Error('Sectional piece unavailable');
      const pieceId = String(group.customData.pieceId);
      const assemblyId = String(
        group.customData.sectionalAssemblyId || group.customData.assemblyId
      );
      group.set({
        left: Number(group.left) + 62,
        top: Number(group.top) + 36,
        angle: 27,
        scaleX: Number(group.scaleX) * 1.12,
        scaleY: Number(group.scaleY) * 0.86,
      });
      group.setCoords();
      canvas.fire('object:moving', { target: group });
      canvas.fire('object:modified', { target: group });

      const linked = canvas
        .getObjects()
        .filter(
          object =>
            object?.customData?.sectionalSeed === true &&
            object?.customData?.sectionalPieceId === pieceId
        )
        .map(line => ({
          dimension: line.customData.measuredDimension,
          start: { x: Number(line.x1), y: Number(line.y1) },
          end: { x: Number(line.x2), y: Number(line.y2) },
          label: String(line.strokeMetadata?.strokeLabel || ''),
        }));
      const overall = canvas
        .getObjects()
        .filter(
          object =>
            object?.customData?.sectionalSeed === true &&
            object?.customData?.sectionalOverall === true
        )
        .map(line => ({
          dimension: String(line.customData.measuredDimension || ''),
          length: Math.hypot(Number(line.x2) - Number(line.x1), Number(line.y2) - Number(line.y1)),
        }));
      const metadata = app.projectManager.getProjectMetadata?.();
      const json = app.canvasManager.toJSON();
      const serializedPiece = json.objects?.find(
        (object: any) => object?.customData?.sectionalPiece === true
      );
      return {
        pieceId,
        assemblyId,
        linked,
        overall,
        transform: metadata?.sectionalAssemblies?.[assemblyId]?.liveTransforms?.[pieceId] || null,
        serializedCustomData: serializedPiece?.customData || null,
      };
    });

    expect(transformed.linked.length).toBeGreaterThanOrEqual(1);
    expect(transformed.linked.every(line => line.label)).toBe(true);
    expect(
      transformed.linked.every(
        line => Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y) > 20
      )
    ).toBe(true);
    expect(transformed.linked.every(line => line.start.x !== line.end.x)).toBe(true);
    expect(transformed.overall.map(line => line.dimension).sort()).toEqual([
      'overall-depth',
      'overall-width',
    ]);
    expect(transformed.overall.every(line => line.length > 20)).toBe(true);
    expect(transformed.transform).toMatchObject({
      angle: 27,
    });
    expect(transformed.serializedCustomData).toMatchObject({
      sectionalPiece: true,
      sectionalAssemblyId: transformed.assemblyId,
      pieceId: transformed.pieceId,
    });

    const saved = await page.evaluate(() =>
      window.app!.projectManager.getProjectData({ embedImages: true })
    );
    await page.evaluate(project => window.app!.projectManager.loadProjectFromData(project), saved);

    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.app?.canvasManager?.fabricCanvas
              ?.getObjects()
              .filter(object => object?.customData?.sectionalPiece === true).length || 0
        )
      )
      .toBe(4);

    const restored = await page.evaluate(({ pieceId, assemblyId }) => {
      const app = window.app;
      const canvas = app?.canvasManager?.fabricCanvas;
      if (!app || !canvas) throw new Error('Restored canvas unavailable');
      const group = canvas
        .getObjects()
        .find(
          object =>
            object?.customData?.sectionalPiece === true && object?.customData?.pieceId === pieceId
        );
      if (!group) throw new Error('Restored sectional piece unavailable');
      const beforeLeft = Number(group.left);
      group.set({ left: beforeLeft + 25 });
      group.setCoords();
      canvas.fire('object:modified', { target: group });
      const metadata = app.projectManager.getProjectMetadata?.();
      return {
        customData: group.customData,
        persisted: metadata?.sectionalAssemblies?.[assemblyId]?.liveTransforms?.[pieceId] || null,
      };
    }, transformed);

    expect(restored.customData).toMatchObject({
      sectionalPiece: true,
      sectionalAssemblyId: transformed.assemblyId,
      pieceId: transformed.pieceId,
    });
    expect(restored.persisted).not.toBeNull();
    expect(restored.persisted.x).not.toBe(transformed.transform.x);
  });
});
