import fs from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { test, expect, uploadTestImage, waitForApp } from './fixtures';
import { addText } from './helpers/stability-workflow';

test('keeps editable floor endpoints and a boxed note through an archive round trip and PDF export', async ({
  appPage: page,
}, info) => {
  test.setTimeout(150_000);
  await uploadTestImage(page);
  await page.evaluate(async () => {
    const { projectManager: pm, canvasManager: cm } = window.app!;
    const image = pm.views.front.image;
    for (const view of ['side', 'back', 'arm', 'deck', 'corner']) {
      await pm.addImage(view, image, { refreshBackground: false });
    }
    await pm.switchView('front', true);
    const canvas = cm.fabricCanvas;
    const point = canvas.getVpCenter();
    const widthLine = new window.fabric.Line(
      [point.x - 150, point.y + 40, point.x - 15, point.y + 40],
      { stroke: '#176a60', strokeWidth: 2 }
    );
    canvas.add(widthLine);
    window.app!.metadataManager.attachMetadata(widthLine, 'front', 'C1');
  });
  await expect(page.locator('#elementsMeasurementCount')).toHaveText('1');
  const note = 'A3 end / J1 start';
  await addText(page, [0.5, 0.4], [note], {
    fontFamily: 'Nunito',
    fontSize: 24,
    color: '#000000',
    background: true,
  });
  const hasBoxedNote = () =>
    page.evaluate(
      expected =>
        window
          .app!.canvasManager.fabricCanvas.getObjects()
          .some(
            (obj: any) =>
              obj.text === expected &&
              obj.customData?.boxedNote &&
              obj.backgroundColor === '#ffffff'
          ),
      note
    );
  await expect.poll(hasBoxedNote).toBe(true);
  await page.evaluate(() => window.showPDFExportDialog?.('Floor checks'));
  await page.getByLabel('Add long-skirt floor checks').check();
  const handle = page.locator('[data-endpoint="C1"]');
  const line = page.locator('g[data-code="C1"] > line');
  const floorY = await line.getAttribute('y2');
  // Move away from the crown, then drag back onto it.
  await handle.focus();
  await handle.press('ArrowDown');
  await handle.press('ArrowDown');
  const bounds = await handle.boundingBox();
  expect(bounds).toBeTruthy();
  const x = bounds!.x + bounds!.width / 2;
  const y = bounds!.y + bounds!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - (2 * bounds!.height) / 22, { steps: 3 });
  await page.mouse.up();
  const edited = Number(await line.getAttribute('y1'));
  expect(edited).toBeCloseTo(108.6, 0);
  await page.locator('#cancelPdfBtn').click();

  const downloaded = page.waitForEvent('download');
  await page.evaluate(async () => {
    const pm = window.app!.projectManager;
    await pm.downloadProjectArchive(await pm.getProjectData(), 'Floor checks');
  });
  const archive = await (await downloaded).path();
  const bytes = await fs.readFile(archive!);
  await fs.writeFile(info.outputPath('floor-checks.opaint'), bytes);
  await page.reload();
  await waitForApp(page);
  await page.evaluate(async base64 => {
    const file = new File(
      [Uint8Array.from(atob(base64), c => c.charCodeAt(0))],
      'Floor checks.opaint'
    );
    await window.app!.projectManager.loadProject(file);
    await window.app!.projectManager.switchView('front', true);
  }, bytes.toString('base64'));
  await expect.poll(hasBoxedNote).toBe(true);
  await page.evaluate(() => window.showPDFExportDialog?.('Floor checks'));
  await expect(page.getByLabel('Add long-skirt floor checks')).toBeChecked();
  expect(Number(await line.getAttribute('y1'))).toBe(edited);
  await expect(line).toHaveAttribute('y2', floorY!);
  const chooseLocation = page.getByLabel('Choose the folder and name when saving');
  if (await chooseLocation.isVisible()) await chooseLocation.uncheck();
  const result = page.waitForEvent('download', { timeout: 60_000 });
  await page.locator('#generatePdfBtn').click();
  const path = info.outputPath('floor-checks.pdf');
  await (await result).saveAs(path);
  const pdf = await PDFDocument.load(await fs.readFile(path));
  expect(pdf.getPageCount()).toBe(7);
  expect(pdf.getForm().getTextField('m_front_C1')).toBeTruthy();
  for (const code of ['J1', 'J2', 'H1', 'H2', 'C1']) {
    expect(
      pdf
        .getForm()
        .getTextField('m_' + code + '_floor')
        .getText() || ''
    ).toBe('');
  }
});
