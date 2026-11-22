import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { test, expect, drawLine, selectTool } from './fixtures';

const photoPath = 'public/plugin/demo/sofa.png';

async function writePhotoToClipboard(page: Page): Promise<void> {
  const bytes = Array.from(await readFile(photoPath));
  await page.evaluate(async imageBytes => {
    const image = new Blob([new Uint8Array(imageBytes)], { type: 'image/png' });
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': image })]);
  }, bytes);
}

test('copies editable lines over a previous image and still pastes external photos', async ({
  appPage: page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('#paste').click();
  await (await chooserPromise).setFiles(photoPath);
  const views = page.locator('#imageList .image-container');
  await expect(views).toHaveCount(1);
  await selectTool(page, 'line');
  await drawLine(page, 200, 200, 500, 200);
  await drawLine(page, 200, 300, 500, 300);
  const lineCount = () =>
    page.evaluate(
      () =>
        window
          .app!.canvasManager.fabricCanvas.getObjects()
          .filter(
            (object: { type: string; isConnectorLine?: boolean }) =>
              object.type === 'line' && !object.isConnectorLine
          ).length
    );
  await expect.poll(lineCount).toBe(2);

  const clipboardTypes = () =>
    page.evaluate(async () => (await navigator.clipboard.read()).flatMap(item => item.types));
  await page.locator('#copyCanvasBtn').click();
  await expect.poll(clipboardTypes).toContain('image/png');

  await selectTool(page, 'select');
  await page.evaluate(() => {
    const canvas = window.app!.canvasManager.fabricCanvas;
    const lines = canvas
      .getObjects()
      .filter(
        (object: { type: string; isConnectorLine?: boolean }) =>
          object.type === 'line' && !object.isConnectorLine
      );
    canvas.setActiveObject(new (window as any).fabric.ActiveSelection(lines, { canvas }));
    (document.activeElement as HTMLElement | null)?.blur();
  });
  await page.keyboard.press('ControlOrMeta+c');
  await expect.poll(clipboardTypes).not.toContain('image/png');
  await page.keyboard.press('ControlOrMeta+v');
  await expect.poll(lineCount).toBe(4);
  await expect(views).toHaveCount(1);
  expect(
    await page.evaluate(
      () =>
        window
          .app!.canvasManager.fabricCanvas.getActiveObjects()
          .filter((object: { type: string }) => object.type === 'line').length
    )
  ).toBe(2);

  await writePhotoToClipboard(page);
  await page.keyboard.press('ControlOrMeta+v');
  await expect(views).toHaveCount(2);
});

test('empty image stepper offers Add photo and switches to image navigation after upload', async ({
  appPage: page,
}) => {
  const stepper = page.locator('#mini-stepper');
  const empty = stepper.locator('.mini-stepper-empty');
  await expect(page.getByRole('button', { name: 'Add photo', exact: true })).toHaveCount(1);
  await expect(empty).toContainText('Or drop or paste an image');
  const chooserPromise = page.waitForEvent('filechooser');
  await empty.getByRole('button', { name: 'Add photo', exact: true }).click();
  await (await chooserPromise).setFiles(photoPath);
  await expect(page.locator('#imageList .image-container')).toHaveCount(1);
  await expect(empty).toHaveCount(0);
  await expect(stepper.locator('[data-step-kind="image"]')).toHaveCount(1);
});

test('empty canvas accepts a dropped photo', async ({ appPage: page }) => {
  const bytes = Array.from(await readFile(photoPath));
  const dataTransfer = await page.evaluateHandle(imageBytes => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(imageBytes)], 'sofa.png', { type: 'image/png' }));
    return transfer;
  }, bytes);
  await page.locator('.upper-canvas').dispatchEvent('drop', { dataTransfer });
  await expect(page.locator('#imageList .image-container')).toHaveCount(1);
  await expect(page.locator('#mini-stepper .mini-stepper-empty')).toBeHidden();
});

test('empty canvas accepts a pasted photo', async ({ appPage: page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await expect(page.locator('#mini-stepper .mini-stepper-empty')).toBeVisible();
  await writePhotoToClipboard(page);
  await page.keyboard.press('ControlOrMeta+v');
  await expect(page.locator('#imageList .image-container')).toHaveCount(1);
  await expect(page.locator('#mini-stepper .mini-stepper-empty')).toBeHidden();
});
