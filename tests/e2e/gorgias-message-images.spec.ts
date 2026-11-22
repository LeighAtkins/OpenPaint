import { expect, test, waitForApp } from './fixtures';

test('keeps every message image as a separate view beyond the Helper progress cap', async ({
  page,
}) => {
  await page.goto('/');
  await waitForApp(page);
  await page.evaluate(() => {
    const batchId = 'message-images-over-forty';
    const send = (detail: Record<string, unknown>) =>
      window.postMessage(
        {
          source: 'sofapaint-gorgias-extension',
          batchId,
          ...detail,
        },
        location.origin
      );
    send({
      type: 'IMPORT_BEGIN',
      total: 40,
      ticketContext: {
        ticketId: 'message-images-test',
        ticketUrl: 'https://comfort-works.gorgias.com/app/ticket/message-images-test',
        customerName: 'Message Images Test',
      },
    });
    for (let index = 0; index < 45; index++) {
      const canvas = document.createElement('canvas');
      canvas.width = 24;
      canvas.height = 24;
      const context = canvas.getContext('2d')!;
      context.fillStyle = `rgb(${index * 5}, 80, 140)`;
      context.fillRect(0, 0, 24, 24);
      send({
        type: 'IMPORT_IMAGE',
        index,
        name: 'message-photo.png',
        mime: 'image/png',
        hash: `message-image-${index}`,
        dataUrl: canvas.toDataURL('image/png'),
      });
    }
    send({ type: 'IMPORT_COMPLETE', importedCount: 45, duplicateCount: 0, errorCount: 0 });
  });
  await expect(page.locator('#imageList .image-container')).toHaveCount(45, { timeout: 20000 });
  const result = await page.evaluate(() => {
    const manager = window.app!.projectManager!;
    return {
      viewIds: Object.entries(manager.views || {})
        .filter(([, view]: [string, any]) =>
          Boolean(view.image || view.imageUrl || view.imageDataURL)
        )
        .map(([viewId]) => viewId),
      hashes:
        manager.getProjectMetadata().externalSources.gorgiasTickets['message-images-test']
          .importedImageHashes,
    };
  });
  expect(result.viewIds).toHaveLength(45);
  expect(new Set(result.viewIds).size).toBe(45);
  expect(result.hashes).toHaveLength(45);
  await expect(page.locator('#gorgiasTicketSourceLink')).toHaveText('Gorgias #message-images-test');
});
