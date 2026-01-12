import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { chromium } from 'playwright';

type SnapshotResult = {
  baselinePath: string;
  diffPath: string;
  wroteBaseline: boolean;
  mismatchPixels: number;
};

const SNAPSHOT_DIR = path.join(__dirname, '__snapshots__');
const DIFF_DIR = path.join(__dirname, '__diff__');
const BASELINE_NAME = 'app-baseline.png';
const SHELL_BASELINE_NAME = 'app-shell.png';
const IMAGE_BASELINE_NAME = 'app-with-image.png';
const DEFAULT_URL = 'http://localhost:3000';

function writePng(filepath: string, buffer: Buffer): void {
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  fs.writeFileSync(filepath, buffer);
}

function compareSnapshot(buffer: Buffer, name: string = BASELINE_NAME): SnapshotResult {
  const baselinePath = path.join(SNAPSHOT_DIR, name);
  const diffPath = path.join(DIFF_DIR, name.replace('.png', '.diff.png'));

  if (!fs.existsSync(baselinePath)) {
    writePng(baselinePath, buffer);
    return {
      baselinePath,
      diffPath,
      wroteBaseline: true,
      mismatchPixels: 0,
    };
  }

  const baseline = PNG.sync.read(fs.readFileSync(baselinePath));
  const current = PNG.sync.read(buffer);

  if (baseline.width !== current.width || baseline.height !== current.height) {
    throw new Error('Baseline dimensions do not match current render.');
  }

  const diff = new PNG({ width: baseline.width, height: baseline.height });
  const mismatchPixels = pixelmatch(
    baseline.data,
    current.data,
    diff.data,
    baseline.width,
    baseline.height,
    { threshold: 0.1 }
  );

  if (mismatchPixels > 0) {
    writePng(diffPath, PNG.sync.write(diff));
  }

  return {
    baselinePath,
    diffPath,
    wroteBaseline: false,
    mismatchPixels,
  };
}

describe('Visual Regression', () => {
  test('app shell matches baseline', async () => {
    const baseUrl = process.env.VISUAL_BASE_URL || DEFAULT_URL;

    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.waitForSelector('#canvas', { state: 'visible' });

    // Stabilize animations/transitions for deterministic captures.
    await page.addStyleTag({
      content: `* { animation: none !important; transition: none !important; }`,
    });

    const buffer = await page.screenshot({ fullPage: true });
    await browser.close();

    const result = compareSnapshot(buffer, SHELL_BASELINE_NAME);

    if (result.wroteBaseline) {
      console.info(`Baseline created: ${result.baselinePath}`);
    }

    expect(result.mismatchPixels).toBe(0);
  });

  test('app with uploaded image and drawn lines matches baseline', async () => {
    const baseUrl = process.env.VISUAL_BASE_URL || DEFAULT_URL;
    const testImagePath = path.join(process.cwd(), 'sofapaint-api/test.jpg');

    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.waitForSelector('#canvas', { state: 'visible' });
    await page.waitForFunction(() => !!(window as any).app?.canvasManager?.fabricCanvas);

    // Upload test image via file chooser
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 5000 }),
      page.click('#paste'),
    ]);
    await fileChooser.setFiles(testImagePath);

    // Wait for image to load into any view
    await page.waitForFunction(
      () => {
        const app = (window as any).app;
        const views = app?.projectManager?.views || (window as any).projectManager?.views;
        const hasImage = Object.values(views || {}).some((v: any) => v?.image);
        const hasBackground = !!app?.canvasManager?.fabricCanvas?.backgroundImage;
        return hasImage || hasBackground;
      },
      null,
      { timeout: 10000 }
    );

    // Stabilize animations/transitions for deterministic captures
    await page.addStyleTag({
      content: `* { animation: none !important; transition: none !important; }`,
    });

    // Draw strokes directly for deterministic visuals
    await page.evaluate(() => {
      const app = (window as any).app;
      const fabricCanvas = app?.canvasManager?.fabricCanvas;
      const fabricApi = (window as any).fabric;
      if (!fabricCanvas || !fabricApi) return;

      const line = new fabricApi.Line([200, 200, 400, 300], {
        stroke: '#3b82f6',
        strokeWidth: 2,
        selectable: true,
        evented: true,
      });
      fabricCanvas.add(line);

      const curve = new fabricApi.Path('M 520 220 Q 620 120 720 260', {
        stroke: '#3b82f6',
        strokeWidth: 2,
        fill: 'transparent',
        selectable: true,
        evented: true,
      });

      if (app?.arrowManager) {
        const originalSettings = { ...app.arrowManager.defaultSettings };
        app.arrowManager.defaultSettings = {
          ...originalSettings,
          endArrow: true,
        };
        app.arrowManager.applyArrows(curve);
        app.arrowManager.defaultSettings = originalSettings;
      }

      fabricCanvas.add(curve);
      fabricCanvas.requestRenderAll();
    });

    const canvasBox = await page.locator('#canvas').boundingBox();
    if (!canvasBox) {
      throw new Error('Canvas not found');
    }

    // Add text via text tool
    await page.click('#textModeToggle');
    await page.mouse.click(canvasBox.x + 260, canvasBox.y + 360);
    await page.keyboard.type('OpenPaint');
    await page.keyboard.press('Escape');

    // Wait for straight line + curve path + text
    await page.waitForFunction(
      () => {
        const fabricCanvas = (window as any).app?.canvasManager?.fabricCanvas;
        const objects = fabricCanvas?.getObjects() || [];
        const hasLine = objects.some((obj: any) => obj.type === 'line');
        const hasCurve = objects.some((obj: any) => obj.type === 'path');
        const hasText = objects.some((obj: any) => obj.type === 'i-text' || obj.type === 'text');
        return hasLine && hasCurve && hasText;
      },
      null,
      { timeout: 10000 }
    );

    // Slight delay for rendering

    await page.waitForTimeout(500);

    const buffer = await page.screenshot({ fullPage: true });
    await browser.close();

    const result = compareSnapshot(buffer, IMAGE_BASELINE_NAME);

    if (result.wroteBaseline) {
      console.info(`Baseline created: ${result.baselinePath}`);
    }

    expect(result.mismatchPixels).toBe(0);
  }, 60000);

  test('visual diff reports mismatch', async () => {
    const baseUrl = process.env.VISUAL_BASE_URL || DEFAULT_URL;
    const testImagePath = path.join(process.cwd(), 'sofapaint-api/test.jpg');
    const baselinePath = path.join(SNAPSHOT_DIR, IMAGE_BASELINE_NAME);

    if (!fs.existsSync(baselinePath)) {
      throw new Error(`Missing baseline at ${baselinePath}. Run visual tests first.`);
    }

    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.waitForSelector('#canvas', { state: 'visible' });
    await page.waitForFunction(() => !!(window as any).app?.canvasManager?.fabricCanvas);

    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 5000 }),
      page.click('#paste'),
    ]);
    await fileChooser.setFiles(testImagePath);

    await page.waitForFunction(
      () => {
        const app = (window as any).app;
        const views = app?.projectManager?.views || (window as any).projectManager?.views;
        const hasImage = Object.values(views || {}).some((v: any) => v?.image);
        const hasBackground = !!app?.canvasManager?.fabricCanvas?.backgroundImage;
        return hasImage || hasBackground;
      },
      null,
      { timeout: 10000 }
    );

    await page.addStyleTag({
      content: `* { animation: none !important; transition: none !important; }`,
    });

    await page.evaluate(() => {
      const app = (window as any).app;
      const fabricCanvas = app?.canvasManager?.fabricCanvas;
      const fabricApi = (window as any).fabric;
      if (!fabricCanvas || !fabricApi) return;

      const line = new fabricApi.Line([200, 200, 400, 300], {
        stroke: '#3b82f6',
        strokeWidth: 2,
        selectable: true,
        evented: true,
      });
      fabricCanvas.add(line);

      const curve = new fabricApi.Path('M 520 220 Q 620 120 720 260', {
        stroke: '#3b82f6',
        strokeWidth: 2,
        fill: 'transparent',
        selectable: true,
        evented: true,
      });

      if (app?.arrowManager) {
        const originalSettings = { ...app.arrowManager.defaultSettings };
        app.arrowManager.defaultSettings = {
          ...originalSettings,
          endArrow: true,
        };
        app.arrowManager.applyArrows(curve);
        app.arrowManager.defaultSettings = originalSettings;
      }

      fabricCanvas.add(curve);
      fabricCanvas.requestRenderAll();
    });

    const canvasBox = await page.locator('#canvas').boundingBox();
    if (!canvasBox) {
      throw new Error('Canvas not found');
    }

    await page.click('#textModeToggle');
    await page.mouse.click(canvasBox.x + 260, canvasBox.y + 360);
    await page.keyboard.type('OpenPaint');
    await page.keyboard.press('Escape');

    await page.evaluate(() => {
      const app = (window as any).app;
      const fabricCanvas = app?.canvasManager?.fabricCanvas;
      const fabricApi = (window as any).fabric;
      if (!fabricCanvas || !fabricApi) return;

      const mismatchBlock = new fabricApi.Rect({
        left: 180,
        top: 420,
        width: 320,
        height: 120,
        fill: 'rgba(239, 68, 68, 0.6)',
        selectable: true,
        evented: true,
      });

      const extraText = new fabricApi.Textbox('Mismatch', {
        left: 200,
        top: 440,
        fill: '#111827',
        fontSize: 36,
        fontFamily: 'Arial',
        selectable: true,
        evented: true,
      });

      fabricCanvas.add(mismatchBlock);
      fabricCanvas.add(extraText);
      fabricCanvas.requestRenderAll();
    });

    await page.waitForFunction(
      () => {
        const fabricCanvas = (window as any).app?.canvasManager?.fabricCanvas;
        const objects = fabricCanvas?.getObjects() || [];
        const textObjects = objects.filter(
          (obj: any) => obj.type === 'i-text' || obj.type === 'text' || obj.type === 'textbox'
        );
        return textObjects.length >= 2;
      },
      null,
      { timeout: 10000 }
    );

    await page.waitForTimeout(500);

    const buffer = await page.screenshot({ fullPage: true });
    await browser.close();

    const result = compareSnapshot(buffer, IMAGE_BASELINE_NAME);

    console.info(`Visual diff mismatch pixels: ${result.mismatchPixels}`);
    expect(result.wroteBaseline).toBe(false);
    expect(result.mismatchPixels).toBeGreaterThan(1000);
  }, 60000);
});
