/**
 * Tests for mini-stepper / image selection synchronization.
 *
 * Verifies that:
 * 1. The mini-stepper active pill always matches projectManager.currentViewId
 * 2. Clicking a pill switches the image and updates the stepper
 * 3. Switching via projectManager keeps the stepper in sync
 * 4. Visibility changes (alt-tab) don't cause stepper drift
 */
import { test, expect, waitForApp } from './fixtures';
import type { Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a colored test image as a data URL. */
function makeTestImageScript(color: string, w = 400, h = 300): string {
  return `(() => {
    const c = document.createElement('canvas');
    c.width = ${w}; c.height = ${h};
    const ctx = c.getContext('2d');
    ctx.fillStyle = '${color}';
    ctx.fillRect(0, 0, ${w}, ${h});
    return c.toDataURL('image/png');
  })()`;
}

/**
 * Load multiple test images into the project so the mini-stepper has pills.
 * Returns the labels of the views that were populated.
 */
async function loadMultiImageProject(page: Page): Promise<string[]> {
  const labels = await page.evaluate(() => {
    const pm = window.app!.projectManager;
    const cm = window.app!.canvasManager;

    const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12'];
    const viewIds = Object.keys(pm.views); // front, side, back, cushion

    const promises = viewIds.map((viewId, i) => {
      return new Promise<string>(resolve => {
        const c = document.createElement('canvas');
        c.width = 400;
        c.height = 300;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = colors[i % colors.length];
        ctx.fillRect(0, 0, 400, 300);
        // Draw label text
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 48px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(viewId, 200, 160);
        const dataURL = c.toDataURL('image/png');

        pm.views[viewId].image = dataURL;

        // Also set in originalImages so sidebar thumbnails are created
        (window as any).originalImages = (window as any).originalImages || {};
        (window as any).originalImages[viewId] = dataURL;

        resolve(viewId);
      });
    });

    return Promise.all(promises);
  });

  // Trigger sidebar rebuild so thumbnails and pills appear
  await page.evaluate(() => {
    const pm = window.app!.projectManager;
    // Use addImageToSidebar if available to create DOM thumbnails
    const viewIds = Object.keys(pm.views);
    for (const viewId of viewIds) {
      const imageUrl = pm.views[viewId]?.image;
      if (imageUrl && typeof (window as any).addImageToSidebar === 'function') {
        (window as any).addImageToSidebar(imageUrl, viewId);
      }
    }
  });

  // Switch to first view (await the async operation)
  await page.evaluate(() => {
    const pm = window.app!.projectManager;
    const viewIds = Object.keys(pm.views);
    return pm.switchView(viewIds[0]);
  });
  await page.waitForTimeout(500);

  // Rebuild pills and update active state
  await page.evaluate(() => {
    if (typeof (window as any).updatePills === 'function') {
      (window as any).updatePills();
    }
    if (typeof (window as any).updateActivePill === 'function') {
      (window as any).updateActivePill({ animate: false, forceCenter: true });
    }
    if (typeof (window as any).ensureImageListObserver === 'function') {
      (window as any).ensureImageListObserver();
    }
  });

  await page.waitForTimeout(500);

  return labels;
}

/** Get the current state of the mini-stepper and project manager. */
async function getStepperState(page: Page) {
  return page.evaluate(() => {
    const pm = window.app?.projectManager;
    const stepper = document.getElementById('mini-stepper');
    const buttons = stepper ? Array.from(stepper.querySelectorAll('button[data-target]')) : [];

    const activePill = buttons.find(btn => btn.getAttribute('aria-current') === 'true');

    return {
      currentViewId: pm?.currentViewId || null,
      pillCount: buttons.length,
      pillLabels: buttons.map(btn => btn.getAttribute('data-target')),
      activePillLabel: activePill?.getAttribute('data-target') || null,
      activePillClasses: activePill?.className || null,
    };
  });
}

/** Get the label of the sidebar image that has the .active class. */
async function getActiveSidebarLabel(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const imageList = document.getElementById('imageList');
    if (!imageList) return null;
    const active = imageList.querySelector('.image-container.active');
    return active?.getAttribute('data-label') || null;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Mini-stepper image selection sync', () => {
  test('pills are created for all project images', async ({ appPage: page }) => {
    const labels = await loadMultiImageProject(page);

    const state = await getStepperState(page);
    expect(state.pillCount).toBeGreaterThanOrEqual(3);
    // All populated views should have a pill
    for (const label of labels) {
      expect(state.pillLabels).toContain(label);
    }
  });

  test('active pill matches currentViewId after setup', async ({ appPage: page }) => {
    await loadMultiImageProject(page);

    const state = await getStepperState(page);
    expect(state.currentViewId).toBeTruthy();
    expect(state.activePillLabel).toBe(state.currentViewId);
  });

  test('clicking a pill switches the image and updates active pill', async ({ appPage: page }) => {
    const labels = await loadMultiImageProject(page);

    // Click the 2nd pill (should be "side")
    const targetLabel = labels[1];
    const pillButton = page.locator(`#mini-stepper button[data-target="${targetLabel}"]`);
    await expect(pillButton).toBeVisible();
    await pillButton.click();
    await page.waitForTimeout(400);

    const state = await getStepperState(page);
    expect(state.currentViewId).toBe(targetLabel);
    expect(state.activePillLabel).toBe(targetLabel);
  });

  test('clicking different pills in sequence keeps sync', async ({ appPage: page }) => {
    const labels = await loadMultiImageProject(page);

    for (const targetLabel of [labels[2], labels[0], labels[3], labels[1]]) {
      const pillButton = page.locator(`#mini-stepper button[data-target="${targetLabel}"]`);

      // Pill might need scrolling into view first
      await pillButton.scrollIntoViewIfNeeded();
      await pillButton.click();
      await page.waitForTimeout(400);

      const state = await getStepperState(page);
      expect(state.currentViewId, `currentViewId after clicking ${targetLabel}`).toBe(targetLabel);
      expect(state.activePillLabel, `activePillLabel after clicking ${targetLabel}`).toBe(
        targetLabel
      );
    }
  });

  test('programmatic switchView updates the active pill', async ({ appPage: page }) => {
    const labels = await loadMultiImageProject(page);

    // Switch to each view programmatically and verify the pill updates
    for (const targetLabel of [labels[2], labels[1], labels[3], labels[0]]) {
      await page.evaluate(label => {
        return window.app!.projectManager.switchView(label);
      }, targetLabel);
      await page.waitForTimeout(500);

      // Force pill update (simulating what the app does after switchView)
      await page.evaluate(() => {
        if (typeof (window as any).updateActivePill === 'function') {
          (window as any).updateActivePill({ forceCenter: true });
        }
      });
      await page.waitForTimeout(200);

      const state = await getStepperState(page);
      expect(state.currentViewId, `currentViewId after switchView(${targetLabel})`).toBe(
        targetLabel
      );
      expect(state.activePillLabel, `activePillLabel after switchView(${targetLabel})`).toBe(
        targetLabel
      );
    }
  });

  test('sidebar active state stays in sync with mini-stepper', async ({ appPage: page }) => {
    const labels = await loadMultiImageProject(page);

    // Click a pill and verify sidebar matches
    const targetLabel = labels[2];
    const pillButton = page.locator(`#mini-stepper button[data-target="${targetLabel}"]`);
    await pillButton.scrollIntoViewIfNeeded();
    await pillButton.click();
    await page.waitForTimeout(500);

    const stepperState = await getStepperState(page);
    const sidebarActive = await getActiveSidebarLabel(page);

    expect(stepperState.currentViewId).toBe(targetLabel);
    expect(stepperState.activePillLabel).toBe(targetLabel);
    // Sidebar should also show this as active
    expect(sidebarActive).toBe(targetLabel);
  });
});

test.describe('Mini-stepper visibility change resilience', () => {
  test('simulated visibility change does not drift the active pill', async ({ appPage: page }) => {
    const labels = await loadMultiImageProject(page);

    // Switch to the 3rd image
    const targetLabel = labels[2];
    await page.evaluate(label => {
      return window.app!.projectManager.switchView(label);
    }, targetLabel);
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      if (typeof (window as any).updateActivePill === 'function') {
        (window as any).updateActivePill({ forceCenter: true });
      }
    });
    await page.waitForTimeout(500);

    // Verify we're on the right image before the visibility change
    let state = await getStepperState(page);
    expect(state.currentViewId).toBe(targetLabel);
    expect(state.activePillLabel).toBe(targetLabel);

    // Simulate visibility change (alt-tab away and back)
    // This fires the visibilitychange event which is what causes drift
    await page.evaluate(() => {
      // Simulate going hidden
      Object.defineProperty(document, 'hidden', {
        value: true,
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(200);

    await page.evaluate(() => {
      // Simulate coming back
      Object.defineProperty(document, 'hidden', {
        value: false,
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Wait for the suppression window and any observer callbacks to settle
    await page.waitForTimeout(1500);

    // The active pill and currentViewId should STILL match
    state = await getStepperState(page);
    expect(state.currentViewId, 'currentViewId should not change after visibility toggle').toBe(
      targetLabel
    );
    expect(state.activePillLabel, 'activePillLabel should not drift after visibility toggle').toBe(
      targetLabel
    );
  });

  test('multiple rapid visibility toggles do not cause drift', async ({ appPage: page }) => {
    const labels = await loadMultiImageProject(page);

    // Switch to 2nd image
    const targetLabel = labels[1];
    await page.evaluate(label => {
      return window.app!.projectManager.switchView(label);
    }, targetLabel);
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      (window as any).updateActivePill?.({ forceCenter: true });
    });
    await page.waitForTimeout(500);

    // Rapid visibility toggles (simulate quick alt-tab back and forth)
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', {
          value: true,
          writable: true,
          configurable: true,
        });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.waitForTimeout(50);

      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', {
          value: false,
          writable: true,
          configurable: true,
        });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.waitForTimeout(100);
    }

    // Wait for everything to settle
    await page.waitForTimeout(2000);

    const state = await getStepperState(page);
    expect(state.currentViewId, 'currentViewId should survive rapid visibility toggles').toBe(
      targetLabel
    );
    expect(state.activePillLabel, 'activePillLabel should survive rapid visibility toggles').toBe(
      targetLabel
    );
  });

  test('visibility change while on 3rd image does not jump stepper to 2nd', async ({
    appPage: page,
  }) => {
    const labels = await loadMultiImageProject(page);
    // This is the specific reported bug: "3rd image in list but 2nd in ministepper"

    // Ensure we have at least 3 images
    expect(labels.length).toBeGreaterThanOrEqual(3);

    // Switch to the 3rd image
    const thirdLabel = labels[2];
    await page.evaluate(label => {
      return window.app!.projectManager.switchView(label);
    }, thirdLabel);
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      (window as any).updateActivePill?.({ forceCenter: true });
    });
    await page.waitForTimeout(500);

    // Confirm we're on the 3rd image
    let state = await getStepperState(page);
    expect(state.currentViewId).toBe(thirdLabel);
    expect(state.activePillLabel).toBe(thirdLabel);

    // Simulate alt-tab away and back
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', {
        value: true,
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(500);

    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', {
        value: false,
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Wait longer than the suppression window (1200ms)
    await page.waitForTimeout(2000);

    state = await getStepperState(page);

    // The SPECIFIC bug: stepper shows 2nd but should show 3rd
    const secondLabel = labels[1];
    expect(
      state.activePillLabel,
      `Active pill should be ${thirdLabel} (3rd), not ${secondLabel} (2nd)`
    ).not.toBe(secondLabel);
    expect(state.activePillLabel).toBe(thirdLabel);
    expect(state.currentViewId).toBe(thirdLabel);
  });
});

test.describe('Complex multi-frame drift guards', () => {
  test('rapid pill clicks across all 4 images never desync stepper from view', async ({
    appPage: page,
  }) => {
    const labels = await loadMultiImageProject(page);

    // Rapidly click through all pills in random order, multiple times
    const sequence = [
      labels[3],
      labels[0],
      labels[2],
      labels[1],
      labels[0],
      labels[3],
      labels[1],
      labels[2],
      labels[2],
      labels[0],
      labels[3],
      labels[1],
    ];

    for (const targetLabel of sequence) {
      // Re-query locator each iteration since pills can be rebuilt
      const pill = page.locator(`#mini-stepper button[data-target="${targetLabel}"]`);
      // Wait for pill to be attached and visible before interacting
      await pill.waitFor({ state: 'attached', timeout: 3000 });
      await pill.click({ timeout: 3000 });
      await page.waitForTimeout(250);

      const state = await getStepperState(page);
      expect(state.currentViewId, `view after click ${targetLabel}`).toBe(targetLabel);
      expect(state.activePillLabel, `pill after click ${targetLabel}`).toBe(targetLabel);
    }
  });

  test('switching view then immediately adding new sidebar content does not drift', async ({
    appPage: page,
  }) => {
    const labels = await loadMultiImageProject(page);

    // Switch to 3rd view
    await page.evaluate(() => {
      return window.app!.projectManager.switchView('back');
    });
    await page.waitForTimeout(500);

    // Now add a new image to sidebar (simulates lazy loading / deferred hydration)
    await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 400;
      c.height = 300;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#9b59b6';
      ctx.fillRect(0, 0, 400, 300);
      const dataURL = c.toDataURL('image/png');

      // Re-add the front image to sidebar (simulate re-hydration)
      if (typeof (window as any).addImageToSidebar === 'function') {
        (window as any).addImageToSidebar(dataURL, 'front');
      }
    });
    await page.waitForTimeout(800);

    // Should still be on 'back'
    const state = await getStepperState(page);
    expect(state.currentViewId, 'view should stay on back after sidebar add').toBe('back');
  });

  test('visibility change after rapid pill switching preserves last selection', async ({
    appPage: page,
  }) => {
    const labels = await loadMultiImageProject(page);

    // Rapidly switch through pills
    for (const label of [labels[1], labels[3], labels[0], labels[2]]) {
      const pill = page.locator(`#mini-stepper button[data-target="${label}"]`);
      await pill.scrollIntoViewIfNeeded();
      await pill.click();
      await page.waitForTimeout(150);
    }

    // We should now be on the last one we clicked
    const lastClicked = labels[2];
    await page.waitForTimeout(300);

    let state = await getStepperState(page);
    expect(state.currentViewId).toBe(lastClicked);

    // Now simulate alt-tab
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', {
        value: true,
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', {
        value: false,
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(2000);

    state = await getStepperState(page);
    expect(state.currentViewId, 'view preserved after rapid switch + visibility toggle').toBe(
      lastClicked
    );
    expect(state.activePillLabel, 'pill preserved after rapid switch + visibility toggle').toBe(
      lastClicked
    );
  });

  test('programmatic switch followed by pill click on same image stays stable', async ({
    appPage: page,
  }) => {
    const labels = await loadMultiImageProject(page);

    // Programmatically switch to 'side'
    await page.evaluate(() => {
      return window.app!.projectManager.switchView('side');
    });
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      (window as any).updateActivePill?.({ forceCenter: true });
    });
    await page.waitForTimeout(300);

    // Click the same pill that should already be active
    const pill = page.locator('#mini-stepper button[data-target="side"]');
    await pill.click();
    await page.waitForTimeout(400);

    const state = await getStepperState(page);
    expect(state.currentViewId).toBe('side');
    expect(state.activePillLabel).toBe('side');
  });

  test('all 3 UI surfaces agree after each navigation', async ({ appPage: page }) => {
    const labels = await loadMultiImageProject(page);

    // Navigate to each view and verify all 3 surfaces agree
    for (const label of labels) {
      const pill = page.locator(`#mini-stepper button[data-target="${label}"]`);
      await pill.scrollIntoViewIfNeeded();
      await pill.click();
      await page.waitForTimeout(500);

      const [stepperState, sidebarActive] = await Promise.all([
        getStepperState(page),
        getActiveSidebarLabel(page),
      ]);

      // All 3 must agree: projectManager, stepper pill, sidebar highlight
      expect(stepperState.currentViewId, `PM view for ${label}`).toBe(label);
      expect(stepperState.activePillLabel, `stepper pill for ${label}`).toBe(label);
      expect(sidebarActive, `sidebar active for ${label}`).toBe(label);
    }
  });

  test('interleaved programmatic and click switches stay consistent', async ({ appPage: page }) => {
    const labels = await loadMultiImageProject(page);

    // Click to 'side'
    await page.locator('#mini-stepper button[data-target="side"]').click();
    await page.waitForTimeout(400);
    expect((await getStepperState(page)).currentViewId).toBe('side');

    // Programmatic to 'cushion'
    await page.evaluate(() => {
      return window.app!.projectManager.switchView('cushion');
    });
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      (window as any).updateActivePill?.({ forceCenter: true });
    });
    await page.waitForTimeout(300);
    let state = await getStepperState(page);
    expect(state.currentViewId).toBe('cushion');
    expect(state.activePillLabel).toBe('cushion');

    // Click to 'front'
    await page.locator('#mini-stepper button[data-target="front"]').click();
    await page.waitForTimeout(400);
    state = await getStepperState(page);
    expect(state.currentViewId).toBe('front');
    expect(state.activePillLabel).toBe('front');

    // Programmatic back to 'back'
    await page.evaluate(() => {
      return window.app!.projectManager.switchView('back');
    });
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      (window as any).updateActivePill?.({ forceCenter: true });
    });
    await page.waitForTimeout(300);
    state = await getStepperState(page);
    expect(state.currentViewId).toBe('back');
    expect(state.activePillLabel).toBe('back');
  });

  test('visibility toggle on every view does not cause any drift', async ({ appPage: page }) => {
    const labels = await loadMultiImageProject(page);

    for (const label of labels) {
      // Switch to this view
      const pill = page.locator(`#mini-stepper button[data-target="${label}"]`);
      await pill.scrollIntoViewIfNeeded();
      await pill.click();
      await page.waitForTimeout(400);

      // Verify before visibility toggle
      let state = await getStepperState(page);
      expect(state.currentViewId, `pre-toggle ${label}`).toBe(label);

      // Toggle visibility
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', {
          value: true,
          writable: true,
          configurable: true,
        });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.waitForTimeout(200);
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', {
          value: false,
          writable: true,
          configurable: true,
        });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.waitForTimeout(1500);

      // Verify after
      state = await getStepperState(page);
      expect(state.currentViewId, `post-toggle ${label}`).toBe(label);
      expect(state.activePillLabel, `post-toggle pill ${label}`).toBe(label);
    }
  });

  test('multiple images with same-length labels do not confuse pill matching', async ({
    appPage: page,
  }) => {
    const labels = await loadMultiImageProject(page);
    // front, side, back, cushion — 'side' and 'back' are both 4 chars
    // Verify switching between them works precisely

    await page.locator('#mini-stepper button[data-target="side"]').click();
    await page.waitForTimeout(400);
    expect((await getStepperState(page)).activePillLabel).toBe('side');

    await page.locator('#mini-stepper button[data-target="back"]').click();
    await page.waitForTimeout(400);
    expect((await getStepperState(page)).activePillLabel).toBe('back');

    await page.locator('#mini-stepper button[data-target="side"]').click();
    await page.waitForTimeout(400);
    expect((await getStepperState(page)).activePillLabel).toBe('side');
  });
});
