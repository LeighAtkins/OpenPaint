# Capture Frame Resize & Management System

## Overview

The capture frame is the visible dashed-border rectangle on the canvas that defines the viewport area. This document describes the full system that manages frame sizing, viewport tracking, tab state persistence, and the gallery/binding pipeline — ensuring frames shrink and grow proportionally on window resize, persist across tab switches, and follow the correct zoom for all image orientations.

## Core Principles

1. **Two stored facts per frame tab**: the authored size (`baseWidth x baseHeight` at `baseWindowWidth x baseWindowHeight`) and the crop (`worldRect`). Zoom, pan and on-screen position are derived from them. The helpers in `src/modules/utils/captureFrameModel.ts` are the only place that decides which numbers are trusted.
2. **Idempotent sizing**: the frame scales uniformly with the window, measured in window units on both sides. At the window size it was authored for, the result is exactly the authored frame, so revisiting an image can never shrink it.
3. **One placement rule**: every layout pass (view restore, recentre, window resize) sizes the frame with `calculateTargetFrameSize` and places it with `buildCenteredRectFromSize`. Passes that used different rules took turns moving the frame.
4. **What you see is what is stored**: `saveActiveTabState` records the crop the frame is showing. Navigation saves keep the stored crop only when it matches the live one within a rounding error, which prevents drift without hiding a real change.
5. **Passive layout keeps the base; deliberate edits rebase**: window resizes and view switches preserve the authored base so a shrunken frame grows back. The +/- keys and the frame handles make the new size the base.
6. **Five critical data structures** must be preserved during image operations (replacement, background removal, etc): `vectorStrokesByImage`, `lineStrokesByImage`, `strokeVisibilityByImage`, `strokeLabelVisibility`, `strokeMeasurements`.
7. **Tab-based state**: Each view/label stores per-tab `captureFrame` (including `worldRect`) and `viewport` (zoom/pan/rotation) in `window.captureTabsByLabel`.

## Key Data Structures

### `captureTabsByLabel` (toolbar-controller.ts ~line 1724)

```typescript
window.captureTabsByLabel = {
  "front": {
    tabs: [
      {
        id: "tab-xxx",
        name: "Frame 1",
        type: "normal" | "master" | "linked",
        color: "#hex",
        captureFrame: {
          left, top, width, height,          // CSS pixel rect
          windowWidth, windowHeight,          // window size at save time
          relativeLeft, relativeTop,
          relativeWidth, relativeHeight,
          baseWidth, baseHeight,               // STABLE — set on create/manual, preserved on resize
          baseWindowWidth, baseWindowHeight,   // STABLE — preserves baseWidth/baseWindowWidth ratio
          worldRect: { left, top, width, height }, // world-space crop
          frameVersion: 2                      // written by the consistent model
        },
        viewport: {
          zoom, panX, panY, rotation,
          savedCanvasWidth?, savedCanvasHeight?
        },
        viewportTransform: number[] | null  // exact Fabric matrix (optional)
      }
    ],
    activeTabId: string,
    masterTabId: string,
    lastNonMasterId: string
  }
}
```

### `captureFrame` object in tab state

| Property | Type | Purpose | Set when |
|----------|------|---------|----------|
| `width`, `height` | number | Current frame size at save time | Every save |
| `baseWidth`, `baseHeight` | number | Stable reference size for proportional resizing | Frame creation, +/- keys |
| `baseWindowWidth`, `baseWindowHeight` | number | Window size when baseWidth/Height were set | Frame creation, +/- keys |
| `windowWidth`, `windowHeight` | number | Window size at last save | Every save |
| `relativeWidth`, `relativeHeight` | number | Fraction of window (legacy) | Every save |
| `worldRect` | rect | Crop shown by the frame, in world-space pixels | Every save (kept when unchanged) |
| `frameVersion` | number | `2` once written by `captureFrameModel`; absent on older saves | Every save |
| `left`, `top` | number | CSS pixel position relative to viewport | Every save |

## Frame Size Computation

### `calculateTargetFrameSize(canvasWidth, canvasHeight, imageLabel?)` — CanvasManager.ts

The canonical function for computing proportional frame size. Used by:
- `replayCaptureFrameForCurrentResize` during window resizes
- `applyCaptureFrameForLabel` during view and tab switching
- `__recenterCaptureFrame` after a view switch settles

```
reference = resolveCaptureFrameSizeReference(activeTab.captureFrame)
  // base size when it has the same shape as the frame, otherwise the frame
  // as it was last laid out (width/height at windowWidth/windowHeight)

scale = min(window.innerWidth / reference.windowWidth,
            window.innerHeight / reference.windowHeight)

frameWidth  = reference.width  * scale
frameHeight = reference.height * scale
```

Both sides of the ratio are window sizes. An earlier version multiplied a window-based ratio by the canvas size (which is shorter than the window by the toolbar height), so every frame lost about 6% the first time its image was revisited.

### `mergeCaptureFrameRecord(existing, measured, { rebase })` — captureFrameModel.ts

Every site that writes a measured frame back to a tab goes through this helper. It keeps the stored base unless `rebase` is set or the frame changed shape, in which case the measured frame becomes the base. Do not assign `buildCaptureFrameRecord(...)` to a tab directly; that would overwrite the base with whatever the layout currently allows.

### Older saves

`normalizeCaptureFrameBase` runs when tab state is normalised. Saves from before this model can carry a base that no longer has the frame's shape (frame handles did not update it; the intended size only lived in the session-only `window.manualFrameRatios`, which no longer exists). Such a base is rebuilt from the frame as it was last laid out. Records without `frameVersion` also keep the legacy repair that replaces a crop larger than the image with the image bounds.

### `buildCenteredRectFromSize(width, height)` — toolbar-controller.ts ~line 3273

Wraps a given size into a rect centered within the preferred capture area (the space between left/right panels). Contains a `Math.min(1, preferredArea.width / sourceWidth, ...)` fitScale that ensures the frame doesn't exceed the usable area. When panels narrow the usable area the frame is scaled down uniformly here; the stored base is unaffected, so it grows back when the space returns.

## Resize Pipeline

### Window Resize Flow

```
window.resize
  → ResizeObserver on canvas wrapper (CanvasManager.ts ~line 1608)
    → requestPrimaryLayoutResize('wrapper-observer')
      → __openpaintRequestPrimaryResize
        → requestPrimaryResize() (toolbar-controller.ts ~line 4148)
          → setTimeout(180ms)
            → requestAnimationFrame
              → resizePrimaryCanvasForCurrentLayout() (line 4170)
                → For scale-page-size mode:
                  → canvasManager.applyResize(width, height)
                    → syncCanvasElementDimensions()
                    → updateCaptureFrameOnResize() [early-returns for floating layout]
                    → fitViewportToBackgroundPlacementFrame() or refitBackgroundImageToPlacementFrame()
                    → Zoom preservation / center point adjustment
                → For non-scale-page-size mode:
                  → canvasManager.resizeCanvasDimensionsPreservingViewport(width, height)
                  → canvasManager.updateCaptureFrameOnResize() [early-returns for floating layout]
              → replayCaptureFrameForCurrentResize() (line 4174)
                → canvasManager.calculateTargetFrameSize(canvasWidth, canvasHeight)
                  → Uses stable baseWidth/baseWindowWidth ratio
                → buildCenteredRectFromSize() to center within preferred area
                → frameScale = targetRect.width / anchorFrameWidth (zoom adjustment)
                → Compute nextViewport with adjusted zoom and centered pan
                → applyViewportRecord(nextViewport)
                → writeCaptureFrameFromViewportRect(targetRect)
                → Save captureFrame with base dimension preservation
```

### View Switch Flow

```
click thumbnail
  → projectManager.switchView(viewId)
    → captureTabsSyncActive() — save current tab state
    → setCurrentViewId(viewId)
    → ensureCaptureTabsForLabel(viewId) — create/normalize tab state
    → applyCaptureFrameForLabel(viewId) — restore frame + viewport
      → applyCenteredFrameAndViewport(stored, borderColor)
        → canvasManager.calculateTargetFrameSize(canvasWidth, canvasHeight)
        → buildCenteredRectFromSize()
        → fitViewportToWorldRect() or use saved viewport
        → writeCaptureFrameFromViewportRect()
        → applyViewportRecord()
    → setBackgroundImage()
    → loadFromJSON() — restore canvas objects
```

### Tab Switch Flow

```
click tab button
  → setActiveTab(label, tabId)
    → saveActiveTabState() — save current tab worldRect + viewport
    → set activeTabId = tabId
    → applyCaptureFrameForLabel(label) — restore new tab's frame + viewport
    → syncCanvasVisibilityForActiveTab() — filter strokes by scoped label
    → renderTabBar()
```

## Frame Size Triggers

| Trigger | Function | Calculus |
|---------|----------|----------|
| Window resize (all fit modes) | `replayCaptureFrameForCurrentResize` → `calculateTargetFrameSize` | Proportional via base ratio |
| View switch (thumbnail click) | `applyCaptureFrameForLabel` → `calculateTargetFrameSize` | Proportional via base ratio |
| Tab switch | `applyCaptureFrameForLabel` → `calculateTargetFrameSize` | Proportional via base ratio |
| +/- keys (manual resize) | `resizeCaptureFrameProportionally()` | ±10% of current size, UPDATES base dimensions |
| Capture frame drag | `capture-frame.ts` drag handlers → `saveActiveTabState()` | Live position, preserves existing worldRect |
| Capture frame handle drag | `stopResize` in toolbar-controller.ts → `saveActiveTabState({ rebase: true })` | Live size becomes the new base; crop taken from the live frame |

## Base Dimension Lifecycle

```
Frame creation (initializeCaptureFrameForImageAspect / createDefaultTabState)
  → base = frame size at the current window

+/- keys (resizeCaptureFrameProportionally) and frame handles (stopResize)
  → base = new frame size at the current window (rebase)

Window shrink, view switch, recentre (passive)
  → frame = base * min(window / baseWindow), clamped to the usable area
  → stored width/height change, base is kept

Window grow back (passive)
  → frame returns to the base size
```

## Early Returns and Guards

### `updateCaptureFrameOnResize` early return (CanvasManager.ts ~line 2395)

```javascript
if (this.enableFloatingLayoutMode && this.containerId === 'main-canvas-wrapper' 
    && this.hasAuthoritativeCaptureTabState()) {
  return;
}
```

This early return means `updateCaptureFrameOnResize` is a no-op for the primary canvas with capture tab state. Frame resizing is delegated entirely to `replayCaptureFrameForCurrentResize` (which calls `calculateTargetFrameSize`).

### `preserveAuthoritativeFrameDuringSuppressedRefit` (CanvasManager.ts ~line 2869)

During project restore, the frame refit is suppressed to keep annotations centered. `applyResize` skips `updateCaptureFrameOnResize` for this period.

### Guide split mode guards

- `resizePrimaryCanvasForCurrentLayout` → returns early if `isGuideSplitWorkspaceActive()`
- `replayCaptureFrameForCurrentResize` → returns early if `isGuideSplitWorkspaceActive()`
- Guide split has its own layout sync pipeline (`fitGuideSplitPrimaryBackgroundToFrame`)

## Drag-and-Drop Reorder

The gallery thumbnail drag-and-drop system does NOT directly interact with `captureTabsByLabel`. It only reorders `imageGalleryData` and `window.orderedImageLabels`, which determine gallery display order and scroll-select navigation. Tab state is keyed by label (view ID) and is order-independent.

## Common Pitfalls

1. **Writing a frame record without `mergeCaptureFrameRecord`**: `buildCaptureFrameRecord` always reports the measured size as the base. Assigning it directly promotes a temporarily constrained frame to the authored size and ratchets the frame smaller.

2. **A second size authority**: keep frame size on the tab record. Session-only state (the removed `manualFrameRatios`) is lost on project save/load and makes a loaded project lay out differently from the one that was saved.

3. **Mixing window and canvas units**: the base is stored against the window size. Scale it by the window size, not by the canvas size.

4. **Placing the frame with a different rule**: use `buildCenteredRectFromSize` in every pass. A pass that centres on the raw canvas box, or skips the usable-area clamp, will be undone by the next pass and the frame visibly jumps.

5. **Preserving a stale crop**: `preserveWorldRect` only keeps the stored crop when it matches what the frame shows. Code that changes the visible crop (rotation, zoom, handles) does not need to clear it first.

6. **Floating layout early return**: `updateCaptureFrameOnResize` returns early for the floating layout primary canvas. If frame geometry needs to change during resize, rely on `replayCaptureFrameForCurrentResize` instead.

## Relevant Files

| File | Role |
|------|------|
| `src/modules/utils/captureFrameModel.ts` | Size reference, base merge/normalisation, crop comparison (unit tested) |
| `src/modules/CanvasManager.ts` | `calculateTargetFrameSize`, `applyResize`, `updateCaptureFrameOnResize` |
| `src/modules/ui/toolbar-controller.ts` | `replayCaptureFrameForCurrentResize`, `buildCaptureFrameRecord`, `applyCaptureFrameForLabel`, `resolveCaptureFrameRect`, viewport tracking |
| `src/modules/ui/image-gallery.ts` | Gallery thumbnails, drag-and-drop reorder |
| `src/modules/ui/capture-frame.ts` | Capture frame DOM drag/resize handlers |
| `src/modules/main.ts` | `resizeCaptureFrameProportionally` (+/- keys), `App` class |
| `src/modules/ProjectManager.ts` | `switchView`, view lifecycle |
| `src/modules/utils/viewportRestore.ts` | Viewport math utilities (fit, compute, transform) |
