import { expect, test } from './fixtures';

type FrameSample = {
  targetView: string;
  activeView: string;
  hasBackground: boolean;
  hasTransitionSnapshot: boolean;
  rgba: [number, number, number, number];
  timestamp: number;
};

test.describe('Image switching visual continuity', () => {
  test('never renders a blank frame while switching between loaded images', async ({
    appPage: page,
  }) => {
    const result = await page.evaluate(async () => {
      const projectManager = window.app!.projectManager;
      const canvasManager = window.app!.canvasManager;

      const makeImage = (color: string, label: string) => {
        const source = document.createElement('canvas');
        source.width = 900;
        source.height = 600;
        const context = source.getContext('2d')!;
        context.fillStyle = color;
        context.fillRect(0, 0, source.width, source.height);
        context.fillStyle = 'rgba(255, 255, 255, 0.75)';
        context.font = 'bold 72px sans-serif';
        context.fillText(label, 48, 100);
        return source.toDataURL('image/png');
      };

      const frontImage = makeImage('#d62828', 'FRONT');
      const sideImage = makeImage('#2457d6', 'SIDE');

      await projectManager.addImage('front', frontImage, { refreshBackground: true });
      await projectManager.addImage('side', sideImage, { refreshBackground: false });

      // Warm both views first. The continuity contract begins only after both
      // images have loaded and each view has a serialized canvas state.
      await projectManager.switchView('side', true);
      await projectManager.switchView('front', true);
      await new Promise<void>(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );

      const samples: FrameSample[] = [];
      let sampling = true;
      let targetView = 'front';

      const sampleFrame = () => {
        const canvas = canvasManager.fabricCanvas;
        const lowerCanvas = canvas?.lowerCanvasEl;
        const transitionCanvas = canvasManager.resizeOverlayCanvas;
        const visualCanvas = transitionCanvas?.isConnected ? transitionCanvas : lowerCanvas;
        const context = visualCanvas?.getContext('2d', { willReadFrequently: true });
        let rgba: [number, number, number, number] = [0, 0, 0, 0];

        if (visualCanvas && context && visualCanvas.width > 0 && visualCanvas.height > 0) {
          const background = canvas?.backgroundImage;
          const backgroundCenter = background?.getCenterPoint?.() || {
            x: Number(background?.left) || Number(canvas?.width) / 2 || 0,
            y: Number(background?.top) || Number(canvas?.height) / 2 || 0,
          };
          const renderedCenter = (window as any).fabric?.util?.transformPoint
            ? (window as any).fabric.util.transformPoint(
                new (window as any).fabric.Point(backgroundCenter.x, backgroundCenter.y),
                canvas?.viewportTransform || [1, 0, 0, 1, 0, 0]
              )
            : backgroundCenter;
          const showingTransitionSnapshot = visualCanvas === transitionCanvas;
          const backingScaleX = visualCanvas.width / Math.max(Number(canvas?.width) || 1, 1);
          const backingScaleY = visualCanvas.height / Math.max(Number(canvas?.height) || 1, 1);
          const sampleX = showingTransitionSnapshot
            ? visualCanvas.width / 2
            : renderedCenter.x * backingScaleX;
          const sampleY = showingTransitionSnapshot
            ? visualCanvas.height / 2
            : renderedCenter.y * backingScaleY;
          const x = Math.max(0, Math.min(visualCanvas.width - 1, Math.floor(sampleX)));
          const y = Math.max(0, Math.min(visualCanvas.height - 1, Math.floor(sampleY)));
          const pixel = context.getImageData(x, y, 1, 1).data;
          rgba = [pixel[0]!, pixel[1]!, pixel[2]!, pixel[3]!];
        }

        samples.push({
          targetView,
          activeView: projectManager.currentViewId,
          hasBackground: Boolean(canvas?.backgroundImage),
          hasTransitionSnapshot: Boolean(transitionCanvas?.isConnected),
          rgba,
          timestamp: performance.now(),
        });

        if (sampling) requestAnimationFrame(sampleFrame);
      };

      requestAnimationFrame(sampleFrame);

      for (let index = 0; index < 8; index += 1) {
        targetView = index % 2 === 0 ? 'side' : 'front';
        await projectManager.switchView(targetView, true);
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      }

      sampling = false;
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

      const isBlankPixel = (sample: FrameSample) => {
        const [red, green, blue, alpha] = sample.rgba;
        const transparent = alpha < 240;
        const white = red > 245 && green > 245 && blue > 245;
        return transparent || white;
      };
      const missingBackgroundFrames = samples.filter(
        sample => !sample.hasBackground && !sample.hasTransitionSnapshot
      );
      const blankPixelFrames = samples.filter(isBlankPixel);

      return {
        sampleCount: samples.length,
        missingBackgroundFrameCount: missingBackgroundFrames.length,
        blankPixelFrameCount: blankPixelFrames.length,
        firstMissingBackgroundFrame: missingBackgroundFrames[0] || null,
        firstBlankPixelFrame: blankPixelFrames[0] || null,
      };
    });

    expect(result.sampleCount).toBeGreaterThan(8);
    expect
      .soft(
        result.missingBackgroundFrameCount,
        `Fabric removed the outgoing background before the incoming image was ready. First frame: ${JSON.stringify(result.firstMissingBackgroundFrame)}`
      )
      .toBe(0);
    expect
      .soft(
        result.blankPixelFrameCount,
        `The canvas displayed an empty white or transparent frame during image switching. First frame: ${JSON.stringify(result.firstBlankPixelFrame)}`
      )
      .toBe(0);
  });
});
