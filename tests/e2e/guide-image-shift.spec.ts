import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

test.describe('Guide Image Position Shift', () => {
  async function measure(page: Page) {
    return page.evaluate(() => {
      const captureFrame = document.getElementById('captureFrame');
      const canvas = document.getElementById('canvas');
      const cm = window.app?.canvasManager;
      const fabric = cm?.fabricCanvas;
      const bg = fabric?.backgroundImage;

      const r: Record<string, any> = {};

      if (captureFrame && canvas) {
        const fr = captureFrame.getBoundingClientRect();
        const cr = canvas.getBoundingClientRect();
        r.frameRelLeft = fr.left - cr.left;
        r.frameRelTop = fr.top - cr.top;
        r.frameRelCx = fr.left - cr.left + fr.width / 2;
        r.frameRelCy = fr.top - cr.top + fr.height / 2;
        r.frameStyleTop = captureFrame.style.top;
        r.frameStyleLeft = captureFrame.style.left;
      }

      if (bg) {
        r.bgLeft = bg.left;
        r.bgTop = bg.top;
        r.bgScaleX = bg.scaleX;
        r.bgScaleY = bg.scaleY;
      }

      r.zoom = cm?.zoomLevel;
      r.panX = cm?.panX;
      r.panY = cm?.panY;
      r.canvasWidth = fabric?.width;
      r.canvasHeight = fabric?.height;

      // Capture overlay position
      const overlay = document.getElementById('captureOverlay');
      if (overlay) r.overlayRect = overlay.getBoundingClientRect();

      // Toolbar visibility
      const tt = document.getElementById('topToolbar');
      if (tt) r.toolbarReady = tt.classList.contains('toolbar-ready');

      return r;
    });
  }

  test('measure position shift when adding a guide', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => {
        return (
          window.app?.canvasManager?.fabricCanvas &&
          document.getElementById('topToolbar')?.classList.contains('toolbar-ready') &&
          document.getElementById('captureFrame')?.getBoundingClientRect()?.width > 0
        );
      },
      { timeout: 15000 }
    );
    await page.waitForTimeout(500);

    const baseline = await measure(page);
    console.log('BASELINE:', JSON.stringify(baseline, null, 2));

    // Record timeline of measurements
    const timeline: Array<{ label: string; ms: number; data: any }> = [];
    timeline.push({ label: 'baseline', ms: 0, data: baseline });

    // Instrument switchView to trace calls
    await page.evaluate(() => {
      const pm = window.projectManager || window.app?.projectManager;
      if (!pm || !pm._originalSwitchView) {
        const orig = pm.switchView.bind(pm);
        pm._originalSwitchView = orig;
        pm._callCount = 0;
        pm.switchView = async function (viewId: string, force?: boolean) {
          pm._callCount = (pm._callCount || 0) + 1;
          const callNum = pm._callCount;
          const t0 = performance.now();
          console.log(
            `[TRACE] switchView #${callNum} START: viewId=${viewId} force=${force} currentViewId=${pm.currentViewId}`
          );
          const result = await orig(viewId, force);
          console.log(
            `[TRACE] switchView #${callNum} END: duration=${(performance.now() - t0).toFixed(1)}ms`
          );
          return result;
        };
      }
    });

    // Also instrument setBackgroundImage to trace
    await page.evaluate(() => {
      const pm = window.projectManager || window.app?.projectManager;
      if (pm && !pm._originalSetBg) {
        const orig = pm.setBackgroundImage.bind(pm);
        pm._originalSetBg = orig;
        pm.setBackgroundImage = async function (url: string, fitMode?: string, options?: any) {
          console.log(`[TRACE] setBackgroundImage START: fitMode=${fitMode}`);
          const result = await orig(url, fitMode, options);
          console.log(`[TRACE] setBackgroundImage END`);
          return result;
        };
      }
    });

    // Instrument applyCaptureFrameForLabel
    await page.evaluate(() => {
      const orig = (window as any).applyCaptureFrameForLabel;
      if (orig && !(window as any)._originalApplyCaptureFrame) {
        (window as any)._originalApplyCaptureFrame = orig;
        (window as any).applyCaptureFrameForLabel = function (label: string) {
          console.log(
            `[TRACE] applyCaptureFrameForLabel: label=${label} activeTabViewport=${(window as any).getActiveTab?.(label)?.viewport?.zoom}`
          );
          return orig(label);
        };
      }
    });

    // Instrument restoreViewportForView
    await page.evaluate(() => {
      const pm = window.projectManager || window.app?.projectManager;
      if (pm && !pm._originalRestoreViewport) {
        const orig = pm.restoreViewportForView.bind(pm);
        pm._originalRestoreViewport = orig;
        pm.restoreViewportForView = function (viewId: string) {
          console.log(`[TRACE] restoreViewportForView: viewId=${viewId}`);
          return orig(viewId);
        };
      }
    });

    // Now, open the measurement guide gallery
    // Look for the library/guide trigger
    const guideBtn = page.locator(
      '#getStartedBtn, #guideToggle, #measurementGuideToggle, [data-action="measurement-guide"], .guide-toggle-btn'
    );
    let clicked = false;
    const count = await guideBtn.count();
    if (count > 0) {
      await guideBtn.first().click();
      clicked = true;
    }

    if (!clicked) {
      // Try toolbar buttons that say "Library"
      const buttons = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('button')).map(b => ({
          id: b.id,
          text: b.textContent?.trim().slice(0, 30),
          title: b.title,
          cls: b.className.slice(0, 60),
          visible: b.offsetParent !== null,
        }));
      });
      console.log('Buttons:', JSON.stringify(buttons, null, 2));

      // Try finding one with "Library" or "Measure" in text
      for (const btn of buttons) {
        if (
          btn.visible &&
          (btn.text?.toLowerCase().includes('library') ||
            btn.title?.toLowerCase().includes('library'))
        ) {
          await page.click(`#${btn.id}`);
          clicked = true;
          break;
        }
      }
    }

    // Also try pressing the hotkey
    if (!clicked) {
      console.log('Trying hotkey...');
      await page.keyboard.press('\\');
      await page.waitForTimeout(500);
    }

    await page.waitForTimeout(1500);

    const afterGallery = await measure(page);
    timeline.push({ label: 'after-gallery', ms: 1500, data: afterGallery });
    console.log('AFTER GALLERY:', JSON.stringify(afterGallery, null, 2));

    // Look for "Add Front" buttons
    const addFrontBtns = page.locator(
      'button:has-text("Add Front"), button:has-text("FRONT"), .guide-gallery-item-action'
    );
    const addCount = await addFrontBtns.count();
    console.log(`Add Front buttons found: ${addCount}`);

    if (addCount > 0) {
      // Get the code of the first item
      const firstCode = (await addFrontBtns.first().getAttribute('data-guide-code')) || 'unknown';

      // Measure before click
      const beforeAdd = await measure(page);
      timeline.push({ label: 'before-add', ms: 0, data: beforeAdd });
      console.log('BEFORE ADD:', JSON.stringify(beforeAdd, null, 2));

      // Click "Add Front" on the first visible guide item
      await addFrontBtns.first().click();

      // Capture measurements at intervals after click
      for (const delay of [200, 400, 600, 800, 1000, 1500, 2000, 3000]) {
        await page.waitForTimeout(200);
        const m = await measure(page);
        timeline.push({ label: `t+${delay}ms`, ms: delay, data: m });
      }
    }

    // Print timeline
    console.log('\n=== TIMELINE ===');
    for (const t of timeline) {
      console.log(
        `${t.label}: frameRelCx=${t.data.frameRelCx?.toFixed(1)} frameRelCy=${t.data.frameRelCy?.toFixed(1)} zoom=${t.data.zoom} panX=${t.data.panX?.toFixed(1)} panY=${t.data.panY?.toFixed(1)} frameStyleTop=${t.data.frameStyleTop} bgTop=${t.data.bgTop}`
      );
    }

    // Compare last two measurements for shift
    if (timeline.length >= 2) {
      const last = timeline[timeline.length - 1].data;
      const prev = timeline[timeline.length - 2].data;
      console.log(`\n=== SHIFT DETECTION ===`);
      console.log(
        `frameRelCy delta: ${((last.frameRelCy ?? 0) - (prev.frameRelCy ?? 0)).toFixed(1)}`
      );
      console.log(`bgTop delta: ${((last.bgTop ?? 0) - (prev.bgTop ?? 0)).toFixed(1)}`);
    }
  });
});
