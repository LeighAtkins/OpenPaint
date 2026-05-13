/**
 * Tests for:
 * 1. Sequential scroll-to-switch consistency (every image activates, no skips)
 * 2. Split mode stability (no jittering on unbound views)
 * 3. Tag isolation (guide tags never leak onto the primary/left canvas)
 * 4. Lines drawn on images persist correctly through view switches
 */
import { test, expect, waitForApp, selectTool, drawLine } from './fixtures';
import type { Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Load 4 images into the project and add lines to each. */
async function setupMultiImageProjectWithLines(page: Page): Promise<string[]> {
  const labels = await page.evaluate(() => {
    const pm = window.app!.projectManager;
    const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12'];
    const viewIds = Object.keys(pm.views);

    for (let i = 0; i < viewIds.length; i++) {
      const viewId = viewIds[i];
      const c = document.createElement('canvas');
      c.width = 400;
      c.height = 300;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(0, 0, 400, 300);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 48px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(viewId, 200, 160);
      pm.views[viewId].image = c.toDataURL('image/png');

      (window as any).originalImages = (window as any).originalImages || {};
      (window as any).originalImages[viewId] = pm.views[viewId].image;
    }

    return viewIds;
  });

  // Build sidebar thumbnails and pills
  await page.evaluate(() => {
    const pm = window.app!.projectManager;
    const viewIds = Object.keys(pm.views);
    for (const viewId of viewIds) {
      const imageUrl = pm.views[viewId]?.image;
      if (imageUrl && typeof (window as any).addImageToSidebar === 'function') {
        (window as any).addImageToSidebar(imageUrl, viewId);
      }
    }
  });

  // Switch to first view
  await page.evaluate(() => {
    const pm = window.app!.projectManager;
    return pm.switchView(Object.keys(pm.views)[0]);
  });
  await page.waitForTimeout(500);

  // Rebuild pills
  await page.evaluate(() => {
    if (typeof (window as any).updatePills === 'function') {
      (window as any).updatePills();
    }
    if (typeof (window as any).updateActivePill === 'function') {
      (window as any).updateActivePill({ animate: false, forceCenter: true });
    }
  });
  await page.waitForTimeout(300);

  // Draw a line on each image so we can verify they persist
  for (let i = 0; i < labels.length; i++) {
    await page.evaluate(viewId => {
      return window.app!.projectManager.switchView(viewId, true);
    }, labels[i]);
    await page.waitForTimeout(300);

    await selectTool(page, 'line');
    // Draw a unique line per image at different positions
    const yOffset = 50 + i * 30;
    await drawLine(page, 100, yOffset, 300, yOffset);
    await page.waitForTimeout(200);
  }

  // Return to first view
  await page.evaluate(() => {
    const pm = window.app!.projectManager;
    return pm.switchView(Object.keys(pm.views)[0], true);
  });
  await page.waitForTimeout(400);

  return labels;
}

/** Get the current view ID and object count on canvas. */
async function getViewState(page: Page) {
  return page.evaluate(() => {
    const pm = window.app?.projectManager;
    const cm = window.app?.canvasManager;
    const canvas = cm?.fabricCanvas;
    const objects = canvas?.getObjects() || [];

    // Count line objects and check for guide-scoped objects
    let lineCount = 0;
    let guideObjectCount = 0;
    for (const obj of objects) {
      if ((obj as any).type === 'line' && (obj as any).strokeMetadata) {
        lineCount++;
      }
      const imageLabel = (obj as any).customData?.imageLabel || (obj as any).imageLabel || '';
      if (typeof imageLabel === 'string' && imageLabel.startsWith('__guide__:')) {
        guideObjectCount++;
      }
      if ((obj as any).customData?.guideReferenceOnly === true) {
        guideObjectCount++;
      }
    }

    return {
      currentViewId: pm?.currentViewId || null,
      totalObjects: objects.length,
      lineCount,
      guideObjectCount,
    };
  });
}

/** Get mini-stepper state. */
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
    };
  });
}

/** Get tag objects from a TagManager instance (primary or compare). */
async function getTagState(page: Page) {
  return page.evaluate(() => {
    const tagManager = window.app?.tagManager;
    if (!tagManager) return { tagCount: 0, tagLabels: [] as string[] };

    const tagLabels: string[] = [];
    if (tagManager.tagObjects instanceof Map) {
      for (const [key] of tagManager.tagObjects) {
        tagLabels.push(key);
      }
    }

    return {
      tagCount: tagLabels.length,
      tagLabels,
    };
  });
}

/** Check whether split mode is currently active. */
async function isSplitModeActive(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const wrapper = document.getElementById('main-canvas-wrapper');
    return wrapper?.classList.contains('guide-split-active') === true;
  });
}

/** Count guide-scoped entries in the shared metadataManager. */
async function countGuideMetadata(page: Page): Promise<number> {
  return page.evaluate(() => {
    const mm = window.app?.metadataManager;
    if (!mm?.vectorStrokesByImage) return 0;
    return Object.keys(mm.vectorStrokesByImage).filter(k => k.startsWith('__guide__:')).length;
  });
}

// ---------------------------------------------------------------------------
// Test suite 1: Sequential scroll switching (no skipped images)
// ---------------------------------------------------------------------------

test.describe('Sequential scroll-to-switch consistency', () => {
  test('every image activates when switching sequentially via pill clicks', async ({
    appPage: page,
  }) => {
    const labels = await setupMultiImageProjectWithLines(page);
    expect(labels.length).toBeGreaterThanOrEqual(3);

    // Click through each pill in order — none should be skipped
    const switchLog: string[] = [];

    for (const label of labels) {
      const pill = page.locator(`#mini-stepper button[data-target="${label}"]`);
      await pill.scrollIntoViewIfNeeded();
      await pill.click();
      // Wait for switch to complete — should be fast
      await page.waitForTimeout(300);

      const state = await getStepperState(page);
      switchLog.push(`${label}→${state.currentViewId}`);
      expect(state.currentViewId).toBe(label);
      expect(state.activePillLabel).toBe(label);
    }

    // Verify all images were visited
    expect(switchLog.length).toBe(labels.length);
  });

  test('rapid sequential pill clicks activate every image', async ({ appPage: page }) => {
    const labels = await setupMultiImageProjectWithLines(page);

    // Click all pills rapidly with minimal delay
    for (const label of labels) {
      const pill = page.locator(`#mini-stepper button[data-target="${label}"]`);
      await pill.scrollIntoViewIfNeeded();
      await pill.click();
      await page.waitForTimeout(100); // Minimal delay
    }

    // Wait for final switch to settle
    await page.waitForTimeout(500);

    // The final view should be the last label
    const finalState = await getStepperState(page);
    expect(finalState.currentViewId).toBe(labels[labels.length - 1]);
    expect(finalState.activePillLabel).toBe(labels[labels.length - 1]);
  });

  test('programmatic switchView through all views completes without skips', async ({
    appPage: page,
  }) => {
    const labels = await setupMultiImageProjectWithLines(page);
    const visited: string[] = [];

    for (const label of labels) {
      await page.evaluate(viewId => {
        return window.app!.projectManager.switchView(viewId, true);
      }, label);
      await page.waitForTimeout(200);

      const state = await getStepperState(page);
      visited.push(state.currentViewId!);
      expect(state.currentViewId).toBe(label);
    }

    // Every label was visited in order
    expect(visited).toEqual(labels);
  });

  test('reverse sequential switching works without skips', async ({ appPage: page }) => {
    const labels = await setupMultiImageProjectWithLines(page);

    // Go forward to last
    await page.evaluate(
      viewId => {
        return window.app!.projectManager.switchView(viewId, true);
      },
      labels[labels.length - 1]
    );
    await page.waitForTimeout(300);

    // Now switch backwards through all views
    const reversed = [...labels].reverse();
    for (const label of reversed) {
      const pill = page.locator(`#mini-stepper button[data-target="${label}"]`);
      await pill.scrollIntoViewIfNeeded();
      await pill.click();
      await page.waitForTimeout(300);

      const state = await getStepperState(page);
      expect(state.currentViewId).toBe(label);
    }
  });
});

// ---------------------------------------------------------------------------
// Test suite 2: Lines persist through view switches
// ---------------------------------------------------------------------------

test.describe('Line persistence through view switches', () => {
  test('lines drawn on each image survive round-trip switching', async ({ appPage: page }) => {
    const labels = await setupMultiImageProjectWithLines(page);

    // Record initial line count per view
    const lineCounts: Record<string, number> = {};
    for (const label of labels) {
      await page.evaluate(viewId => {
        return window.app!.projectManager.switchView(viewId, true);
      }, label);
      await page.waitForTimeout(300);

      const state = await getViewState(page);
      lineCounts[label] = state.lineCount;
      expect(state.lineCount).toBeGreaterThanOrEqual(1);
    }

    // Switch through all views again and verify counts are preserved
    for (const label of labels) {
      await page.evaluate(viewId => {
        return window.app!.projectManager.switchView(viewId, true);
      }, label);
      await page.waitForTimeout(300);

      const state = await getViewState(page);
      expect(state.lineCount).toBe(lineCounts[label]);
    }
  });

  test('no guide objects leak onto primary canvas during switching', async ({ appPage: page }) => {
    const labels = await setupMultiImageProjectWithLines(page);

    // Switch through all views and verify no guide objects appear
    for (const label of labels) {
      await page.evaluate(viewId => {
        return window.app!.projectManager.switchView(viewId, true);
      }, label);
      await page.waitForTimeout(300);

      const state = await getViewState(page);
      expect(state.guideObjectCount).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Test suite 3: Split mode stability
// ---------------------------------------------------------------------------

test.describe('Split mode view switching', () => {
  test('switching views in split mode does not create guide objects on left canvas', async ({
    appPage: page,
  }) => {
    const labels = await setupMultiImageProjectWithLines(page);

    // Enable split mode if the function is available
    const hasSplitMode = await page.evaluate(() => {
      return typeof (window as any).setGuideSplitEnabled === 'function';
    });

    if (!hasSplitMode) {
      test.skip();
      return;
    }

    await page.evaluate(() => {
      (window as any).setGuideSplitEnabled(true);
    });
    await page.waitForTimeout(500);

    expect(await isSplitModeActive(page)).toBe(true);

    // Switch through all views while in split mode
    for (const label of labels) {
      await page.evaluate(viewId => {
        return window.app!.projectManager.switchView(viewId, true);
      }, label);
      await page.waitForTimeout(500);

      // Primary canvas should never have guide objects
      const viewState = await getViewState(page);
      expect(viewState.guideObjectCount).toBe(0);
    }

    // Switch back to first image — the critical case for tag leaking
    await page.evaluate(viewId => {
      return window.app!.projectManager.switchView(viewId, true);
    }, labels[0]);
    await page.waitForTimeout(500);

    const finalState = await getViewState(page);
    expect(finalState.guideObjectCount).toBe(0);
    // Lines should still be present
    expect(finalState.lineCount).toBeGreaterThanOrEqual(1);
  });

  test('unbound view in split mode shows empty right pane without gallery auto-open', async ({
    appPage: page,
  }) => {
    const labels = await setupMultiImageProjectWithLines(page);

    const hasSplitMode = await page.evaluate(() => {
      return typeof (window as any).setGuideSplitEnabled === 'function';
    });

    if (!hasSplitMode) {
      test.skip();
      return;
    }

    await page.evaluate(() => {
      (window as any).setGuideSplitEnabled(true);
    });
    await page.waitForTimeout(500);

    // None of the test views have guide bindings, so the right pane should
    // show the "No bound guide" message
    const guidePane = page.locator('#guideSplitGuidePane');
    if (await guidePane.isVisible()) {
      // The pane should show empty state, not auto-open a gallery overlay
      const galleryOverlay = page.locator('.guide-gallery-overlay');
      const isGalleryVisible = await galleryOverlay.isVisible().catch(() => false);

      // Gallery should NOT auto-open (user's feedback: "just have it blank")
      // Give a moment for any async gallery open to fire
      await page.waitForTimeout(300);
      const isGalleryVisibleAfterDelay = await galleryOverlay.isVisible().catch(() => false);

      // Either the gallery doesn't exist or it's not visible
      expect(isGalleryVisible || isGalleryVisibleAfterDelay).toBe(false);
    }
  });

  test('split mode left pane does not flash (no opacity:0 during transition)', async ({
    appPage: page,
  }) => {
    const labels = await setupMultiImageProjectWithLines(page);

    const hasSplitMode = await page.evaluate(() => {
      return typeof (window as any).setGuideSplitEnabled === 'function';
    });

    if (!hasSplitMode) {
      test.skip();
      return;
    }

    await page.evaluate(() => {
      (window as any).setGuideSplitEnabled(true);
    });
    await page.waitForTimeout(500);

    // Switch views and check that the live pane never gets opacity: 0
    for (let i = 1; i < Math.min(labels.length, 3); i++) {
      await page.evaluate(viewId => {
        return window.app!.projectManager.switchView(viewId, true);
      }, labels[i]);

      // Check immediately during the transition
      const livePane = page.locator('#guideSplitLivePane');
      if (await livePane.isVisible()) {
        const opacity = await livePane.evaluate(el => {
          return window.getComputedStyle(el).opacity;
        });
        // Opacity should never be 0 (that causes the flash)
        expect(opacity).not.toBe('0');
      }

      await page.waitForTimeout(300);
    }
  });

  test('rapid view switches in split mode do not accumulate guide metadata', async ({
    appPage: page,
  }) => {
    const labels = await setupMultiImageProjectWithLines(page);

    const hasSplitMode = await page.evaluate(() => {
      return typeof (window as any).setGuideSplitEnabled === 'function';
    });

    if (!hasSplitMode) {
      test.skip();
      return;
    }

    await page.evaluate(() => {
      (window as any).setGuideSplitEnabled(true);
    });
    await page.waitForTimeout(500);

    // Rapidly switch through all views multiple times
    for (let round = 0; round < 3; round++) {
      for (const label of labels) {
        await page.evaluate(viewId => {
          return window.app!.projectManager.switchView(viewId, true);
        }, label);
        await page.waitForTimeout(100); // Rapid switching
      }
    }

    await page.waitForTimeout(500);

    // Check that guide metadata hasn't accumulated
    const guideMetadataCount = await countGuideMetadata(page);
    // Without any actual guide bindings, there should be zero guide metadata
    expect(guideMetadataCount).toBe(0);

    // Primary canvas should be clean
    const viewState = await getViewState(page);
    expect(viewState.guideObjectCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Test suite 4: Tag isolation
// ---------------------------------------------------------------------------

test.describe('Tag isolation between views', () => {
  test('tags on one view do not appear on another view', async ({ appPage: page }) => {
    const labels = await setupMultiImageProjectWithLines(page);

    // Get tag state for first view
    const firstViewTags = await getTagState(page);

    // Switch to second view
    await page.evaluate(viewId => {
      return window.app!.projectManager.switchView(viewId, true);
    }, labels[1]);
    await page.waitForTimeout(400);

    const secondViewTags = await getTagState(page);

    // Tags should be different between views (different tag keys)
    // because tag keys include the image label
    if (firstViewTags.tagCount > 0 && secondViewTags.tagCount > 0) {
      const firstKeys = new Set(firstViewTags.tagLabels);
      const secondKeys = new Set(secondViewTags.tagLabels);
      // No overlap between tag keys from different views
      for (const key of secondKeys) {
        // Tag keys include the view ID, so they shouldn't match
        if (key.includes(labels[0]) && !key.includes(labels[1])) {
          // A tag from view 0 leaked to view 1
          expect(key).not.toContain(labels[0]);
        }
      }
    }
  });

  test('switching back to first view preserves original tag count', async ({ appPage: page }) => {
    const labels = await setupMultiImageProjectWithLines(page);

    // Record tag count on first view
    const initialTags = await getTagState(page);

    // Visit all other views
    for (let i = 1; i < labels.length; i++) {
      await page.evaluate(viewId => {
        return window.app!.projectManager.switchView(viewId, true);
      }, labels[i]);
      await page.waitForTimeout(200);
    }

    // Switch back to first view
    await page.evaluate(viewId => {
      return window.app!.projectManager.switchView(viewId, true);
    }, labels[0]);
    await page.waitForTimeout(400);

    const finalTags = await getTagState(page);
    // Tag count should be the same as initial (no tags gained or lost)
    expect(finalTags.tagCount).toBe(initialTags.tagCount);
  });

  test('no guide-scoped tag keys appear in primary TagManager', async ({ appPage: page }) => {
    const labels = await setupMultiImageProjectWithLines(page);

    // Switch through all views
    for (const label of labels) {
      await page.evaluate(viewId => {
        return window.app!.projectManager.switchView(viewId, true);
      }, label);
      await page.waitForTimeout(300);

      // Check that no tag keys contain __guide__
      const tags = await getTagState(page);
      for (const key of tags.tagLabels) {
        expect(key).not.toContain('__guide__');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Test suite 5: Suppression window timing
// ---------------------------------------------------------------------------

test.describe('Scroll suppression windows', () => {
  test('scroll-driven mini-stepper suppression clears quickly', async ({ appPage: page }) => {
    const labels = await setupMultiImageProjectWithLines(page);

    // Wait for all deferred sidebar callbacks to complete
    await page.waitForTimeout(2000);

    // Clear any residual suppression
    await page.evaluate(() => {
      (window as any).__miniStepperProgrammaticScrollUntil = 0;
      (window as any).__imageListProgrammaticScrollUntil = 0;
      (window as any).__suppressScrollSelectUntil = 0;
    });

    // Now simulate a scroll-driven switch — this is the path that matters for UX
    await page.evaluate(viewId => {
      (window as any).__scrollSelectDrivenSwitch = true;
      return window.app!.projectManager.switchView(viewId, true);
    }, labels[1]);
    await page.waitForTimeout(50);

    await page.evaluate(() => {
      (window as any).__scrollSelectDrivenSwitch = false;
      if (typeof (window as any).updateActivePill === 'function') {
        (window as any).updateActivePill({ animate: false, forceCenter: true });
      }
    });

    // After 100ms, mini-stepper suppression (30ms for instant) should be cleared
    await page.waitForTimeout(100);

    const miniStepperSuppressed = await page.evaluate(() => {
      return (window as any).__miniStepperProgrammaticScrollUntil > Date.now();
    });

    expect(miniStepperSuppressed).toBe(false);
  });

  test('scroll-driven switch uses short suppression windows', async ({ appPage: page }) => {
    const labels = await setupMultiImageProjectWithLines(page);

    // Simulate a scroll-driven switch
    await page.evaluate(viewId => {
      (window as any).__scrollSelectDrivenSwitch = true;
      return window.app!.projectManager.switchView(viewId, true);
    }, labels[2]);
    await page.waitForTimeout(50);

    // Update pill without animation (like scroll-driven code does)
    await page.evaluate(() => {
      (window as any).__scrollSelectDrivenSwitch = false;
      if (typeof (window as any).updateActivePill === 'function') {
        (window as any).updateActivePill({ animate: false, forceCenter: true });
      }
    });

    // After 50ms, suppression should be cleared
    await page.waitForTimeout(50);

    const stillSuppressed = await page.evaluate(() => {
      const now = Date.now();
      return (window as any).__miniStepperProgrammaticScrollUntil > now;
    });

    expect(stillSuppressed).toBe(false);
  });
});
