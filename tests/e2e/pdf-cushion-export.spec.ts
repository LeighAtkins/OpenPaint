import fs from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { expect, test, uploadTestImage } from './fixtures';

test.describe('Modern PDF cushion quantity option', () => {
  test('downloads a PDF with a fillable quantity field for the checked image', async ({
    appPage: page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1000, height: 600 });
    await uploadTestImage(page, 800, 600, '#f4d7a1');
    await page.evaluate(() => {
      const projectManager = window.app!.projectManager;
      const viewId = projectManager.currentViewId;
      projectManager.setProjectMetadata({
        imagePartLabels: {
          ...projectManager.getProjectMetadata().imagePartLabels,
          [viewId]: 'Seat cushion',
        },
      });
      window.showPDFExportDialog?.('Cushion quantity export');
    });

    const quantityToggle = page.locator('[data-cushion-quantity-key]');
    await expect(quantityToggle).toHaveCount(1);
    await expect(quantityToggle).toBeChecked();
    const quantityMenu = quantityToggle.locator('xpath=ancestor::details');
    await expect(quantityMenu).not.toHaveAttribute('open', '');
    await quantityMenu.locator('summary').click();
    await expect(quantityMenu).toHaveAttribute('open', '');
    const noteMenu = page.locator('details').filter({ hasText: 'Notes (optional)' });
    await expect(noteMenu).not.toHaveAttribute('open', '');
    await noteMenu.locator('summary').click();
    await noteMenu.locator('[data-pdf-note-key]').fill('Check seam and match piping');
    const dialogScroll = await page.locator('#pdfExportDialog').evaluate(dialog => {
      return {
        overflowY: getComputedStyle(dialog).overflowY,
        scrollHeight: dialog.scrollHeight,
        clientHeight: dialog.clientHeight,
      };
    });
    expect(dialogScroll?.overflowY).toBe('auto');
    expect(dialogScroll!.scrollHeight).toBeGreaterThan(dialogScroll!.clientHeight);
    await page.locator('#generatePdfBtn').scrollIntoViewIfNeeded();

    const layerState = await page.evaluate(() => ({
      modalZ: Number(
        getComputedStyle(
          document.querySelector('[data-cushion-quantity-key]')!.closest('details')!.parentElement!
            .parentElement!
        ).zIndex
      ),
      controlsZ: Number(getComputedStyle(document.getElementById('canvasControls')!).zIndex),
    }));
    expect(layerState.modalZ).toBeGreaterThan(layerState.controlsZ);

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#generatePdfBtn').click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();

    const bytes = await fs.readFile(downloadPath!);
    const pdf = await PDFDocument.load(bytes);
    const fieldNames = pdf
      .getForm()
      .getFields()
      .map(field => field.getName());

    expect(fieldNames.some(name => name.startsWith('cushion_qty_'))).toBe(true);
    expect(fieldNames).toEqual(
      expect.arrayContaining([
        'cushion_type_1_seat',
        'cushion_type_1_back',
        'cushion_type_1_accent',
        'note_1',
      ])
    );
    const noteField = pdf.getForm().getTextField('note_1');
    expect(noteField.getText()).toBe('Check seam and match piping');
    expect(noteField.isMultiline()).toBe(false);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  test('captures each PDF page from its matching image when image 2 is active', async ({
    appPage: page,
  }) => {
    test.setTimeout(120_000);
    await page.evaluate(async () => {
      const makeImage = (color: string) => {
        const canvas = document.createElement('canvas');
        canvas.width = 800;
        canvas.height = 600;
        const context = canvas.getContext('2d')!;
        context.fillStyle = color;
        context.fillRect(0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/png');
      };
      const manager = window.app!.projectManager;
      await manager.addImage('front', makeImage('#e53935'), { refreshBackground: false });
      await manager.addImage('side', makeImage('#1e88e5'), { refreshBackground: false });
      manager.setProjectMetadata({ imagePartLabels: { front: 'Image 1', side: 'Image 2' } });
      await manager.switchView('side', true);
      window.showPDFExportDialog?.('Image identity export');
    });

    const requestPromise = page.waitForRequest(
      request => request.url().includes('/api/pdf/render') && request.method() === 'POST'
    );
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#generatePdfBtn').click();
    const request = await requestPromise;
    await downloadPromise;
    const payload = request.postDataJSON();
    const groups = payload.report.groups as Array<{
      mainImage: { title: string; src: string };
    }>;

    expect(groups.map(group => group.mainImage.title)).toEqual(['Image 1', 'Image 2']);
    const sampledColors = await page.evaluate(
      async (sources: string[]) => {
        return Promise.all(
          sources.map(
            source =>
              new Promise<number[]>((resolve, reject) => {
                const image = new Image();
                image.onload = () => {
                  const canvas = document.createElement('canvas');
                  canvas.width = image.naturalWidth;
                  canvas.height = image.naturalHeight;
                  const context = canvas.getContext('2d')!;
                  context.drawImage(image, 0, 0);
                  resolve(
                    Array.from(context.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data)
                  );
                };
                image.onerror = reject;
                image.src = source;
              })
          )
        );
      },
      groups.map(group => group.mainImage.src)
    );

    expect(sampledColors[0][0]).toBeGreaterThan(sampledColors[0][2] + 80);
    expect(sampledColors[1][2]).toBeGreaterThan(sampledColors[1][0] + 80);
  });
});
