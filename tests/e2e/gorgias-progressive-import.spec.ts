import { expect, test, waitForApp } from './fixtures';

test.describe('Gorgias progressive photo import', () => {
  test('shows each ordered photo before the extension batch completes', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    await page.evaluate(() => {
      const makeImage = (color: string) => {
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 240;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas unavailable');
        context.fillStyle = color;
        context.fillRect(0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/png');
      };
      const send = (detail: Record<string, unknown>) =>
        window.postMessage(
          { source: 'sofapaint-gorgias-extension', batchId: 'e2e-progressive', ...detail },
          window.location.origin
        );

      (window as any).__sendGorgiasTestImage = send;
      (window as any).__gorgiasTestImages = {
        front: makeImage('#dbeafe'),
        back: makeImage('#fee2e2'),
      };
      send({
        type: 'IMPORT_BEGIN',
        total: 2,
        ticketContext: {
          ticketId: '221130761',
          ticketUrl: 'https://comfort-works.gorgias.com/app/ticket/221130761',
          customerName: 'Jamie Customer',
          productName: 'Boxed Seat Snug Fit Armless Chair Slipcover',
          productSku: 'CS1B-NA-SNUG__PO__VELC__SP__BEN-04',
          guideCode: 'CS1B-NA-SNUG',
        },
      });
      send({
        type: 'IMPORT_IMAGE',
        index: 0,
        total: 2,
        name: 'IMG_5392.png',
        mime: 'image/png',
        hash: 'e2e-front-hash',
        partLabel: 'front',
        dataUrl: (window as any).__gorgiasTestImages.front,
      });
    });

    await expect(page.locator('#imageList .image-container[data-label="front"]')).toBeAttached();
    await expect(page.locator('#imageList .image-container')).toHaveCount(1);
    await expect(page.locator('#currentImageNameBox')).toHaveValue('front');

    await page.evaluate(() => {
      (window as any).__sendGorgiasTestImage({
        type: 'IMPORT_IMAGE',
        index: 1,
        total: 2,
        name: 'IMG_5394.png',
        mime: 'image/png',
        hash: 'e2e-back-hash',
        partLabel: 'back',
        dataUrl: (window as any).__gorgiasTestImages.back,
      });
    });

    await expect(page.locator('#imageList .image-container[data-label="back"]')).toBeAttached();
    await expect(page.locator('#imageList .image-container')).toHaveCount(2);
    await expect(page.locator('.openpaint-toast.loading')).toBeVisible();

    await page.evaluate(() => {
      (window as any).__sendGorgiasTestImage({
        type: 'IMPORT_COMPLETE',
        importedCount: 2,
        duplicateCount: 0,
        errorCount: 0,
        total: 2,
      });
    });

    await expect(page.locator('.openpaint-toast.success')).toContainText('2 photos added');
    await expect(page.locator('#gorgiasTicketSourceLink')).toHaveText('Gorgias #221130761');
    await expect(page.locator('#projectName')).toHaveValue(
      'Jamie Customer - Boxed Seat Snug Fit Armless Chair Slipcover'
    );
    await expect
      .poll(() =>
        page.evaluate(() => {
          const metadata = window.app?.projectManager?.getProjectMetadata?.();
          return {
            imageCount:
              metadata?.externalSources?.gorgiasTickets?.['221130761']?.importedImageHashes?.length,
            guideCode: metadata?.measurementGuideCode,
            libraryCodes: metadata?.measurementGuideLibraryCodes,
            partLabels: metadata?.imagePartLabels,
          };
        })
      )
      .toEqual({
        imageCount: 2,
        guideCode: 'CS1B-NA-SNUG',
        libraryCodes: ['CS1B-NA-SNUG'],
        partLabels: { front: 'front', back: 'back' },
      });
    await expect(page.locator('#gorgiasCloudSaveStatus')).toBeAttached();
    await expect
      .poll(() => page.locator('#canvasCloudSaveBtn').getAttribute('data-cloud-state'))
      .not.toBeNull();
    await expect
      .poll(() => page.evaluate(() => window.app?.projectManager?.currentViewId))
      .toBe('front');

    await page.evaluate(async () => {
      await window.app?.projectManager?.switchView?.('back');
    });
    await expect
      .poll(() => page.evaluate(() => window.app?.projectManager?.currentViewId))
      .toBe('back');
    await expect(page.locator('#currentImageNameBox')).toHaveValue('back');
  });

  test('rejects an undecodable photo without creating a blank front view', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    await page.evaluate(() => {
      const send = (detail: Record<string, unknown>) =>
        window.postMessage(
          { source: 'sofapaint-gorgias-extension', batchId: 'e2e-broken-photo', ...detail },
          window.location.origin
        );
      send({
        type: 'IMPORT_BEGIN',
        total: 1,
        ticketContext: {
          ticketId: 'broken-photo-ticket',
          customerName: 'Broken Photo Test',
        },
      });
      send({
        type: 'IMPORT_IMAGE',
        index: 0,
        total: 1,
        name: 'front.png',
        mime: 'image/png',
        hash: 'e2e-broken-front-hash',
        partLabel: 'front',
        dataUrl: 'data:image/png;base64,bm90LWFuLWltYWdl',
      });
      send({
        type: 'IMPORT_COMPLETE',
        importedCount: 1,
        duplicateCount: 0,
        errorCount: 0,
        total: 1,
      });
    });

    await expect(page.locator('.openpaint-toast.warning')).toContainText('1 failed');
    await expect(page.locator('#imageList .image-container')).toHaveCount(0);
    await expect(page.locator('#imageList .image-container[data-label="front"]')).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const view = window.app?.projectManager?.views?.front;
          return Boolean(view?.image || view?.imageUrl || view?.imageDataURL);
        })
      )
      .toBe(false);
  });
});
