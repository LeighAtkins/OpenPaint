/**
 * E2E tests for window-resize centering behavior.
 *
 * Requirements:
 * - After any window resize, the background image MUST remain centered in the
 *   capture frame (bg center ≈ frame center).
 * - The capture frame MUST be centered in the available viewport area.
 * - Stroke-to-image alignment MUST be preserved (lines stay at the same
 *   normalized position relative to the background).
 * - This MUST work for EVERY image, not just the active one — switching to
 *   another image after resize should also show correct centering.
 * - This MUST work after loading a saved/cloud project.
 *
 * These tests are expected to FAIL until the resize pipeline is fixed to
 * re-center using proportional scaling (same as +/- keys) instead of the
 * current anchor-based correction that drifts.
 */
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type CenteringSnapshot = {
  viewId: string;
  bgCenterX: number;
  bgCenterY: number;
  frameCenterX: number;
  frameCenterY: number;
  bgFrameDx: number;
  bgFrameDy: number;
  bgWidth: number;
  bgHeight: number;
  zoom: number;
  viewportWidth: number;
  frameLeft: number;
  frameTop: number;
  frameWidth: number;
  frameHeight: number;
  lines: Array<{ normX: number; normY: number }>;
};

async function captureCentering(page: Page): Promise<CenteringSnapshot> {
  return page.evaluate(() => {
    const cm = window.app!.canvasManager;
    const canvas = cm.fabricCanvas;
    const bg = canvas?.backgroundImage;
    const fabricApi = (window as any).fabric;
    const captureFrame = document.getElementById('captureFrame');

    if (!canvas || !bg || !fabricApi || !captureFrame) {
      throw new Error('Missing canvas, background, or capture frame');
    }

    const vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
    const halfW = ((bg.width || 0) * (bg.scaleX || 1)) / 2;
    const halfH = ((bg.height || 0) * (bg.scaleY || 1)) / 2;
    const tl = fabricApi.util.transformPoint(
      new fabricApi.Point(bg.left - halfW, bg.top - halfH),
      vpt
    );
    const br = fabricApi.util.transformPoint(
      new fabricApi.Point(bg.left + halfW, bg.top + halfH),
      vpt
    );
    const bgRect = { left: tl.x, top: tl.y, width: br.x - tl.x, height: br.y - tl.y };

    const canvasRect = canvas.getElement().getBoundingClientRect();
    const frameRect = captureFrame.getBoundingClientRect();
    const frameCenterX = frameRect.left - canvasRect.left + frameRect.width / 2;
    const frameCenterY = frameRect.top - canvasRect.top + frameRect.height / 2;
    const bgCenterX = bgRect.left + bgRect.width / 2;
    const bgCenterY = bgRect.top + bgRect.height / 2;

    const lines = canvas
      .getObjects()
      .filter((o: any) => o?.type === 'line' && !o?.isConnectorLine)
      .map((line: any) => {
        const c = fabricApi.util.transformPoint(line.getCenterPoint(), vpt);
        return {
          normX: (c.x - bgRect.left) / Math.max(bgRect.width, 1),
          normY: (c.y - bgRect.top) / Math.max(bgRect.height, 1),
        };
      })
      .sort((a: { normX: number }, b: { normX: number }) => a.normX - b.normX);

    return {
      viewId: window.app!.projectManager.currentViewId,
      bgCenterX,
      bgCenterY,
      frameCenterX,
      frameCenterY,
      bgFrameDx: bgCenterX - frameCenterX,
      bgFrameDy: bgCenterY - frameCenterY,
      bgWidth: bgRect.width,
      bgHeight: bgRect.height,
      zoom: cm.zoomLevel,
      viewportWidth: window.innerWidth,
      frameLeft: frameRect.left - canvasRect.left,
      frameTop: frameRect.top - canvasRect.top,
      frameWidth: frameRect.width,
      frameHeight: frameRect.height,
      lines,
    };
  });
}

async function switchView(page: Page, viewId: string): Promise<void> {
  await page.evaluate(id => {
    return window.app!.projectManager.switchView(id);
  }, viewId);
  await page.waitForTimeout(400);
}

async function addViewWithImage(
  page: Page,
  viewId: string,
  width = 800,
  height = 600,
  color = '#e0e0e0'
): Promise<void> {
  await page.evaluate(
    ({ id, w, h, c }) => {
      return new Promise<void>(resolve => {
        const offscreen = document.createElement('canvas');
        offscreen.width = w;
        offscreen.height = h;
        const ctx = offscreen.getContext('2d')!;
        ctx.fillStyle = c;
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#999';
        ctx.lineWidth = 2;
        for (let x = 0; x <= w; x += 100) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
        for (let y = 0; y <= h; y += 100) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
        }
        const dataURL = offscreen.toDataURL('image/png');
        const pm = window.app!.projectManager;
        pm.addImage(id, dataURL, { refreshBackground: true }).then(() => resolve());
      });
    },
    { id: viewId, w: width, h: height, c: color }
  );
  await page.waitForTimeout(400);
}

// Tolerance for centering: background center should be within this many pixels
// of the frame center after a resize.
const CENTER_TOLERANCE_PX = 8;

// Tolerance for stroke normalized position drift: lines should stay within
// this fraction of the background dimensions.
const STROKE_DRIFT_TOLERANCE = 0.02;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Window resize centering', () => {
  test.describe.configure({ mode: 'serial' });

  test('active image stays centered after window resize', async ({ appPage: page }) => {
    await addViewWithImage(page, 'front', 800, 600, '#e0e0e0');

    // Draw a line
    await page.evaluate(() => {
      const canvas = window.app!.canvasManager.fabricCanvas;
      const fabricApi = (window as any).fabric;
      const line = new fabricApi.Line([200, 150, 600, 450], {
        stroke: '#ef4444',
        strokeWidth: 3,
      });
      canvas.add(line);
      canvas.requestRenderAll();
    });
    await page.waitForTimeout(200);

    const before = await captureCentering(page);

    // Resize to a smaller window
    await page.setViewportSize({ width: 900, height: 600 });
    await page.waitForTimeout(600);
    await page.evaluate(() => window.app?.canvasManager?.resize?.());
    await page.waitForTimeout(400);

    const after = await captureCentering(page);

    // Background should be centered in the frame
    expect(Math.abs(after.bgFrameDx)).toBeLessThan(CENTER_TOLERANCE_PX);
    expect(Math.abs(after.bgFrameDy)).toBeLessThan(CENTER_TOLERANCE_PX);

    // Stroke normalized positions should be preserved
    expect(after.lines.length).toBe(before.lines.length);
    for (let i = 0; i < after.lines.length; i++) {
      expect(Math.abs(after.lines[i].normX - before.lines[i].normX)).toBeLessThan(
        STROKE_DRIFT_TOLERANCE
      );
      expect(Math.abs(after.lines[i].normY - before.lines[i].normY)).toBeLessThan(
        STROKE_DRIFT_TOLERANCE
      );
    }
  });

  test('inactive images stay centered after resize when switched to', async ({ appPage: page }) => {
    // Add multiple images
    await addViewWithImage(page, 'front', 800, 600, '#e0e0e0');
    await addViewWithImage(page, 'side', 800, 600, '#d0d0d0');
    await addViewWithImage(page, 'back', 800, 600, '#c0c0c0');

    // Draw a line on "side" while it's active
    await switchView(page, 'side');
    await page.evaluate(() => {
      const canvas = window.app!.canvasManager.fabricCanvas;
      const fabricApi = (window as any).fabric;
      const line = new fabricApi.Line([150, 200, 650, 400], {
        stroke: '#ef4444',
        strokeWidth: 3,
      });
      canvas.add(line);
      canvas.requestRenderAll();
    });
    await page.waitForTimeout(200);

    // Switch back to front, then resize
    await switchView(page, 'front');

    // Capture baseline for side (before resize, from side's stored state)
    await switchView(page, 'side');
    const sideBefore = await captureCentering(page);
    await switchView(page, 'front');

    // Resize
    await page.setViewportSize({ width: 900, height: 600 });
    await page.waitForTimeout(600);
    await page.evaluate(() => window.app?.canvasManager?.resize?.());
    await page.waitForTimeout(400);

    // Now switch to side and check centering
    await switchView(page, 'side');
    await page.waitForTimeout(300);
    const sideAfter = await captureCentering(page);

    expect(Math.abs(sideAfter.bgFrameDx)).toBeLessThan(CENTER_TOLERANCE_PX);
    expect(Math.abs(sideAfter.bgFrameDy)).toBeLessThan(CENTER_TOLERANCE_PX);

    // Lines should maintain normalized positions
    if (sideBefore.lines.length > 0 && sideAfter.lines.length > 0) {
      for (let i = 0; i < sideAfter.lines.length; i++) {
        expect(Math.abs(sideAfter.lines[i].normX - sideBefore.lines[i].normX)).toBeLessThan(
          STROKE_DRIFT_TOLERANCE
        );
      }
    }
  });

  test('frame is centered in viewport after resize', async ({ appPage: page }) => {
    await addViewWithImage(page, 'front', 800, 600, '#e0e0e0');
    await page.waitForTimeout(300);

    // Resize to a wider window
    await page.setViewportSize({ width: 1400, height: 800 });
    await page.waitForTimeout(600);
    await page.evaluate(() => window.app?.canvasManager?.resize?.());
    await page.waitForTimeout(400);

    const snap = await captureCentering(page);

    // Frame should be roughly centered horizontally in the viewport.
    // The frame left + half width should be near viewport center.
    const canvasRect = await page.evaluate(() => {
      const el = window.app!.canvasManager.fabricCanvas.getElement();
      return el.getBoundingClientRect();
    });

    // The frame center should be within 15% of the canvas center
    const canvasCenterX = canvasRect.width / 2;
    const frameCenterInCanvas = snap.frameLeft + snap.frameWidth / 2;
    const offsetRatio = Math.abs(frameCenterInCanvas - canvasCenterX) / canvasRect.width;
    expect(offsetRatio).toBeLessThan(0.15);
  });

  test('multiple resizes do not accumulate drift', async ({ appPage: page }) => {
    await addViewWithImage(page, 'front', 800, 600, '#e0e0e0');

    // Draw a reference line
    await page.evaluate(() => {
      const canvas = window.app!.canvasManager.fabricCanvas;
      const fabricApi = (window as any).fabric;
      canvas.add(new fabricApi.Line([200, 150, 600, 450], { stroke: '#ef4444', strokeWidth: 3 }));
      canvas.requestRenderAll();
    });
    await page.waitForTimeout(200);

    const initial = await captureCentering(page);

    // Series of resizes
    const sizes = [
      { w: 900, h: 600 },
      { w: 1200, h: 700 },
      { w: 800, h: 500 },
      { w: 1100, h: 650 },
    ];

    for (const size of sizes) {
      await page.setViewportSize({ width: size.w, height: size.h });
      await page.waitForTimeout(500);
      await page.evaluate(() => window.app?.canvasManager?.resize?.());
      await page.waitForTimeout(300);
    }

    const final = await captureCentering(page);

    // After multiple resizes, should still be centered
    expect(Math.abs(final.bgFrameDx)).toBeLessThan(CENTER_TOLERANCE_PX);
    expect(Math.abs(final.bgFrameDy)).toBeLessThan(CENTER_TOLERANCE_PX);

    // Lines should still be at same normalized positions
    expect(final.lines.length).toBe(initial.lines.length);
    if (final.lines.length > 0 && initial.lines.length > 0) {
      expect(Math.abs(final.lines[0].normX - initial.lines[0].normX)).toBeLessThan(
        STROKE_DRIFT_TOLERANCE
      );
    }
  });

  test('centering preserved after loading a saved project', async ({ appPage: page }) => {
    // Setup: add images and draw lines
    await addViewWithImage(page, 'front', 800, 600, '#e0e0e0');
    await addViewWithImage(page, 'side', 800, 600, '#d0d0d0');

    await page.evaluate(() => {
      const canvas = window.app!.canvasManager.fabricCanvas;
      const fabricApi = (window as any).fabric;
      canvas.add(new fabricApi.Line([200, 150, 600, 450], { stroke: '#ef4444', strokeWidth: 3 }));
      canvas.requestRenderAll();
    });
    await page.waitForTimeout(200);

    // Save project data
    const projectData = await page.evaluate(() => {
      return window.app!.projectManager.getProjectData({ embedImages: true });
    });

    // Reload the project
    await page.evaluate(data => {
      return window.app!.projectManager.loadProjectFromData(data);
    }, projectData);
    await page.waitForFunction(() => !(window as any).__isLoadingProject, { timeout: 10_000 });
    await page.waitForTimeout(800);

    // Resize after load
    await page.setViewportSize({ width: 900, height: 600 });
    await page.waitForTimeout(600);
    await page.evaluate(() => window.app?.canvasManager?.resize?.());
    await page.waitForTimeout(400);

    // Check front
    const frontSnap = await captureCentering(page);
    expect(Math.abs(frontSnap.bgFrameDx)).toBeLessThan(CENTER_TOLERANCE_PX);
    expect(Math.abs(frontSnap.bgFrameDy)).toBeLessThan(CENTER_TOLERANCE_PX);

    // Check side after switching
    await switchView(page, 'side');
    await page.waitForTimeout(300);
    const sideSnap = await captureCentering(page);
    expect(Math.abs(sideSnap.bgFrameDx)).toBeLessThan(CENTER_TOLERANCE_PX);
    expect(Math.abs(sideSnap.bgFrameDy)).toBeLessThan(CENTER_TOLERANCE_PX);
  });

  test('enlarging window keeps image centered and visible', async ({ appPage: page }) => {
    // Start with a small window
    await page.setViewportSize({ width: 800, height: 500 });
    await page.waitForTimeout(500);
    await page.evaluate(() => window.app?.canvasManager?.resize?.());
    await page.waitForTimeout(300);

    await addViewWithImage(page, 'front', 800, 600, '#e0e0e0');
    await page.waitForTimeout(300);

    const before = await captureCentering(page);

    // Enlarge significantly
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.waitForTimeout(600);
    await page.evaluate(() => window.app?.canvasManager?.resize?.());
    await page.waitForTimeout(400);

    const after = await captureCentering(page);

    // Should be centered
    expect(Math.abs(after.bgFrameDx)).toBeLessThan(CENTER_TOLERANCE_PX);
    expect(Math.abs(after.bgFrameDy)).toBeLessThan(CENTER_TOLERANCE_PX);

    // Frame should be visible (not off-screen)
    expect(after.frameLeft).toBeGreaterThan(-after.frameWidth);
    expect(after.frameLeft + after.frameWidth).toBeLessThan(after.viewportWidth + after.frameWidth);
  });

  test('cross-monitor load: project saved on large monitor stays centered on smaller monitor', async ({
    appPage: page,
  }) => {
    // Simulate the user's real scenario: a project with 6 views saved on a
    // 1920×960 second monitor, then loaded on a smaller main monitor.
    //
    // The saved geometry mirrors a real .opaint file:
    //   - savedCanvasWidth: 1920, savedCanvasHeight: 912
    //   - windowWidth: 1920, windowHeight: 960
    //   - Multiple views with background images + strokes
    //
    // BUG: when loaded on a smaller monitor, images are shifted LEFT because
    // the stale panX values (calibrated for 1920px) are applied to a narrower
    // canvas without re-centering.

    // Step 1: Work on the "large monitor" (1920×960)
    await page.setViewportSize({ width: 1920, height: 960 });
    await page.waitForTimeout(500);
    await page.evaluate(() => window.app?.canvasManager?.resize?.());
    await page.waitForTimeout(400);

    // Add multiple views (mirrors the real project: front, side, back, cushion, image, image-1)
    const views = [
      { id: 'front', color: '#e0e0e0' },
      { id: 'side', color: '#d0d0d0' },
      { id: 'back', color: '#c0c0c0' },
    ];
    for (const v of views) {
      await addViewWithImage(page, v.id, 960, 720, v.color);
    }

    // Draw a reference line on each view
    for (const v of views) {
      await switchView(page, v.id);
      await page.evaluate(() => {
        const canvas = window.app!.canvasManager.fabricCanvas;
        const fabricApi = (window as any).fabric;
        canvas.add(
          new fabricApi.Line([200, 150, 700, 550], {
            stroke: '#ef4444',
            strokeWidth: 3,
          })
        );
        canvas.requestRenderAll();
      });
      await page.waitForTimeout(150);
    }

    // Save the project
    const projectData = await page.evaluate(() => {
      return window.app!.projectManager.getProjectData({ embedImages: true });
    });

    // Verify the saved geometry looks like the real file
    const savedViews = Object.keys(projectData.views || {});
    expect(savedViews.length).toBeGreaterThanOrEqual(3);

    // Step 2: Reload the page at the "small monitor" size (e.g., 1440×900)
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(500);

    // Reload to simulate fresh open on a different monitor
    await page.reload();
    await page.waitForTimeout(1000);

    // Set the small viewport BEFORE loading the project
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(300);

    // Wait for app to be ready
    await page.waitForFunction(
      () => !!(window.app?.canvasManager?.fabricCanvas && window.app?.projectManager),
      { timeout: 15_000 }
    );
    await page.waitForTimeout(500);

    // Load the project saved on the large monitor
    await page.evaluate(data => {
      return window.app!.projectManager.loadProjectFromData(data);
    }, projectData);
    await page.waitForFunction(() => !(window as any).__isLoadingProject, { timeout: 15_000 });
    await page.waitForTimeout(1000);

    // Step 3: Verify EVERY view is centered (not shifted left)
    for (const v of views) {
      await switchView(page, v.id);
      const snap = await captureCentering(page);

      // The key assertion: background should be centered in the frame.
      // On the bug, bgFrameDx is large and negative (image shifted left).
      expect(
        Math.abs(snap.bgFrameDx),
        `View "${v.id}" background-to-frame X offset too large (shifted ${snap.bgFrameDx > 0 ? 'right' : 'left'} by ${Math.abs(snap.bgFrameDx).toFixed(1)}px)`
      ).toBeLessThan(CENTER_TOLERANCE_PX);

      expect(
        Math.abs(snap.bgFrameDy),
        `View "${v.id}" background-to-frame Y offset too large`
      ).toBeLessThan(CENTER_TOLERANCE_PX);
    }
  });

  test('cross-monitor load: stroke-to-image alignment preserved', async ({ appPage: page }) => {
    // Same setup as above but focused on stroke alignment after cross-monitor load
    await page.setViewportSize({ width: 1920, height: 960 });
    await page.waitForTimeout(500);
    await page.evaluate(() => window.app?.canvasManager?.resize?.());
    await page.waitForTimeout(400);

    await addViewWithImage(page, 'front', 960, 720, '#e0e0e0');

    // Draw a line at a known position
    await page.evaluate(() => {
      const canvas = window.app!.canvasManager.fabricCanvas;
      const fabricApi = (window as any).fabric;
      canvas.add(
        new fabricApi.Line([200, 150, 700, 550], {
          stroke: '#ef4444',
          strokeWidth: 3,
        })
      );
      canvas.requestRenderAll();
    });
    await page.waitForTimeout(200);

    // Capture normalized line positions on the large monitor
    const largeSnap = await captureCentering(page);

    // Save
    const projectData = await page.evaluate(() => {
      return window.app!.projectManager.getProjectData({ embedImages: true });
    });

    // Reload on smaller monitor
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.reload();
    await page.waitForTimeout(1000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(300);

    await page.waitForFunction(
      () => !!(window.app?.canvasManager?.fabricCanvas && window.app?.projectManager),
      { timeout: 15_000 }
    );
    await page.waitForTimeout(500);
    await page.evaluate(data => {
      return window.app!.projectManager.loadProjectFromData(data);
    }, projectData);
    await page.waitForFunction(() => !(window as any).__isLoadingProject, { timeout: 15_000 });
    await page.waitForTimeout(1000);

    const smallSnap = await captureCentering(page);
    // Background centered
    expect(Math.abs(smallSnap.bgFrameDx)).toBeLessThan(CENTER_TOLERANCE_PX);
    expect(Math.abs(smallSnap.bgFrameDy)).toBeLessThan(CENTER_TOLERANCE_PX);

    // Line normalized positions should match what was saved on the large monitor
    expect(smallSnap.lines.length).toBe(largeSnap.lines.length);
    for (let i = 0; i < smallSnap.lines.length; i++) {
      expect(
        Math.abs(smallSnap.lines[i].normX - largeSnap.lines[i].normX),
        `Line ${i} normalized X drifted`
      ).toBeLessThan(STROKE_DRIFT_TOLERANCE);
      expect(
        Math.abs(smallSnap.lines[i].normY - largeSnap.lines[i].normY),
        `Line ${i} normalized Y drifted`
      ).toBeLessThan(STROKE_DRIFT_TOLERANCE);
    }
  });

  test('image stays pinned to frame corners across sequential resizes', async ({
    appPage: page,
  }) => {
    // The "pinned corners" invariant: after any resize, the background image
    // should fill the frame the same way it did before. Concretely:
    //   1. Background center ≈ frame center (centering)
    //   2. backgroundWidth / frameWidth ≈ constant (zoom preserved)
    //   3. Stroke normalized positions ≈ constant (content doesn't drift)
    //
    // BUG: the second resize breaks this because the first resize updates the
    // tab's worldRect/viewport, and the second resize uses those updated values
    // incorrectly, causing the image to shift or zoom to change.

    await addViewWithImage(page, 'front', 800, 600, '#e0e0e0');

    // Draw a line at a known position
    await page.evaluate(() => {
      const canvas = window.app!.canvasManager.fabricCanvas;
      const fabricApi = (window as any).fabric;
      canvas.add(new fabricApi.Line([200, 150, 600, 450], { stroke: '#ef4444', strokeWidth: 3 }));
      canvas.requestRenderAll();
    });
    await page.waitForTimeout(200);

    // Capture the baseline state
    const baseline = await captureCentering(page);

    // The fill ratio: how much of the frame the background fills.
    // This should stay constant across resizes ("pinned corners").
    const FILL_TOLERANCE = 0.08; // 8% allowance for rounding/layout differences

    // Series of resizes — each one should preserve the pinning
    const resizeSequence = [
      { w: 1000, h: 650, label: 'shrink-slightly' },
      { w: 800, h: 500, label: 'shrink-more' },
      { w: 1200, h: 750, label: 'enlarge' },
      { w: 900, h: 600, label: 'shrink-again' },
    ];

    for (const step of resizeSequence) {
      await page.setViewportSize({ width: step.w, height: step.h });
      await page.waitForTimeout(500);
      await page.evaluate(() => window.app?.canvasManager?.resize?.());
      await page.waitForTimeout(400);

      const snap = await captureCentering(page);

      // 1. Background must be centered in the frame
      expect(
        Math.abs(snap.bgFrameDx),
        `[${step.label}] background not centered horizontally`
      ).toBeLessThan(CENTER_TOLERANCE_PX);
      expect(
        Math.abs(snap.bgFrameDy),
        `[${step.label}] background not centered vertically`
      ).toBeLessThan(CENTER_TOLERANCE_PX);

      // 2. Fill ratio must be preserved — the image should fill the frame
      // the same amount as it did before any resize ("pinned corners").
      // If the frame changed size, the background should have scaled to match.
      const baselineFillW = baseline.bgWidth / Math.max(baseline.frameWidth, 1);
      const snapFillW = snap.bgWidth / Math.max(snap.frameWidth, 1);
      expect(
        Math.abs(snapFillW - baselineFillW),
        `[${step.label}] fill ratio changed: was ${baselineFillW.toFixed(3)}, now ${snapFillW.toFixed(3)}`
      ).toBeLessThan(FILL_TOLERANCE);

      // 3. Stroke normalized positions must be preserved (content doesn't drift)
      expect(snap.lines.length, `[${step.label}] line count changed`).toBe(baseline.lines.length);
      for (let i = 0; i < snap.lines.length; i++) {
        expect(
          Math.abs(snap.lines[i].normX - baseline.lines[i].normX),
          `[${step.label}] line ${i} normalized X drifted`
        ).toBeLessThan(STROKE_DRIFT_TOLERANCE);
        expect(
          Math.abs(snap.lines[i].normY - baseline.lines[i].normY),
          `[${step.label}] line ${i} normalized Y drifted`
        ).toBeLessThan(STROKE_DRIFT_TOLERANCE);
      }
    }
  });

  test('cross-monitor: image fills frame proportionally after loading on different screen size', async ({
    appPage: page,
  }) => {
    // The "pinned corners" invariant for cross-monitor loads:
    // When a project saved on a large screen is loaded on a smaller screen
    // (or vice versa), the background image should FILL the frame the same
    // way — no white space should appear inside the frame.
    //
    // BUG: the frame is resized via relative ratios for the new screen size,
    // but the zoom is not adjusted to compensate. The background stays at
    // its original scale while the frame grows/shrinks, creating gaps.

    // Step 1: Work on a "large monitor"
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.waitForTimeout(500);
    await page.evaluate(() => window.app?.canvasManager?.resize?.());
    await page.waitForTimeout(400);

    await addViewWithImage(page, 'front', 960, 720, '#e0e0e0');
    await page.waitForTimeout(300);

    // Capture how the image fills the frame on the large screen
    const largeSnap = await captureCentering(page);

    const largeFillW = largeSnap.bgWidth / Math.max(largeSnap.frameWidth, 1);
    const largeFillH = largeSnap.bgHeight / Math.max(largeSnap.frameHeight, 1);

    // The image should fill most of the frame (fit-canvas mode)
    expect(largeFillW).toBeGreaterThan(0.5);
    expect(largeFillH).toBeGreaterThan(0.5);

    // Step 2: Save the project
    const projectData = await page.evaluate(() => {
      return window.app!.projectManager.getProjectData({ embedImages: true });
    });

    // Step 3: Reload on a "small monitor"
    await page.setViewportSize({ width: 900, height: 600 });
    await page.reload();
    await page.waitForTimeout(1000);
    await page.setViewportSize({ width: 900, height: 600 });
    await page.waitForTimeout(300);

    await page.waitForFunction(
      () => !!(window.app?.canvasManager?.fabricCanvas && window.app?.projectManager),
      { timeout: 15_000 }
    );
    await page.waitForTimeout(500);
    await page.evaluate(data => {
      return window.app!.projectManager.loadProjectFromData(data);
    }, projectData);
    await page.waitForFunction(() => !(window as any).__isLoadingProject, { timeout: 15_000 });
    await page.waitForTimeout(1000);

    const smallSnap = await captureCentering(page);
    const smallFillW = smallSnap.bgWidth / Math.max(smallSnap.frameWidth, 1);

    // FILL RATIO: the image should fill the frame the same fraction as before.
    // If there's white space, smallFillW will be much smaller than largeFillW.
    const FILL_DRIFT = 0.12; // 12% allowance
    expect(
      Math.abs(smallFillW - largeFillW),
      `Fill ratio changed: was ${largeFillW.toFixed(3)} on large screen, now ${smallFillW.toFixed(3)} on small screen`
    ).toBeLessThan(FILL_DRIFT);

    // Also verify centering
    expect(Math.abs(smallSnap.bgFrameDx)).toBeLessThan(CENTER_TOLERANCE_PX);
    expect(Math.abs(smallSnap.bgFrameDy)).toBeLessThan(CENTER_TOLERANCE_PX);
  });

  test('cross-monitor: zoom adjusts when frame size changes between screens', async ({
    appPage: page,
  }) => {
    // When the frame is significantly larger or smaller on a different monitor,
    // the zoom must adjust so the same world-space area fills the frame.
    // This test verifies that the zoom is NOT just preserved — it scales
    // proportionally with the frame size.

    // Start small
    await page.setViewportSize({ width: 900, height: 600 });
    await page.waitForTimeout(500);
    await page.evaluate(() => window.app?.canvasManager?.resize?.());
    await page.waitForTimeout(400);

    await addViewWithImage(page, 'front', 960, 720, '#e0e0e0');
    await page.waitForTimeout(300);

    const smallSnap = await captureCentering(page);

    // Save
    const projectData = await page.evaluate(() => {
      return window.app!.projectManager.getProjectData({ embedImages: true });
    });

    // Reload on a large monitor
    await page.setViewportSize({ width: 1800, height: 1100 });
    await page.reload();
    await page.waitForTimeout(1000);
    await page.setViewportSize({ width: 1800, height: 1100 });
    await page.waitForTimeout(300);

    await page.waitForFunction(
      () => !!(window.app?.canvasManager?.fabricCanvas && window.app?.projectManager),
      { timeout: 15_000 }
    );
    await page.waitForTimeout(500);

    await page.evaluate(data => {
      return window.app!.projectManager.loadProjectFromData(data);
    }, projectData);
    await page.waitForFunction(() => !(window as any).__isLoadingProject, { timeout: 15_000 });
    await page.waitForTimeout(1000);

    const largeSnap = await captureCentering(page);

    // The frame should be larger on the large screen
    expect(largeSnap.frameWidth).toBeGreaterThan(smallSnap.frameWidth + 50);

    // The fill ratio should be preserved — the image scales WITH the frame
    const smallFill = smallSnap.bgWidth / Math.max(smallSnap.frameWidth, 1);
    const largeFill = largeSnap.bgWidth / Math.max(largeSnap.frameWidth, 1);
    expect(
      Math.abs(largeFill - smallFill),
      `Fill ratio not preserved: small=${smallFill.toFixed(3)}, large=${largeFill.toFixed(3)}`
    ).toBeLessThan(0.12);

    // Background must be centered
    expect(Math.abs(largeSnap.bgFrameDx)).toBeLessThan(CENTER_TOLERANCE_PX);
    expect(Math.abs(largeSnap.bgFrameDy)).toBeLessThan(CENTER_TOLERANCE_PX);
  });
});
