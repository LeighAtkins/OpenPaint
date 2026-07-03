# Capture Frame Resize & Management System

## Overview

The capture frame is the visible dashed-border rectangle on the canvas that defines the viewport area. This document describes the full system that manages frame sizing, viewport tracking, tab state persistence, and the gallery/binding pipeline — ensuring frames shrink and grow proportionally on window resize, persist across tab switches, and follow the correct zoom for all image orientations.

## Core Principles

1. **Stable base ratio**: The frame's proportional size uses `baseWidth / baseWindowWidth` (set on initial frame creation or manual +/- adjustments). This ratio is **never overwritten by passive window resizes**, ensuring the frame grows back when the window gets larger.
2. **Two-step resize pipeline**: The coordinator (`replayCaptureFrameForCurrentResize`) owns frame geometry and viewport correction; CanvasManager's `applyResize` handles canvas element resizing and scale-to-page fitting.
3. **Five critical data structures** must be preserved during image operations (replacement, background removal, etc): `vectorStrokesByImage`, `lineStrokesByImage`, `strokeVisibilityByImage`, `strokeLabelVisibility`, `strokeMeasurements`.
4. **Tab-based state**: Each view/label stores per-tab `captureFrame` (including `worldRect`) and `viewport` (zoom/pan/rotation) in `window.captureTabsByLabel`.

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
          worldRect: { left, top, width, height }  // world-space crop
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
| `worldRect` | rect | Background image crop in world-space pixels | Every save |
| `left`, `top` | number | CSS pixel position relative to viewport | Every save |

## Frame Size Computation

### `calculateTargetFrameSize(canvasWidth, canvasHeight)` — CanvasManager.ts ~line 2279

The canonical function for computing proportional frame size. Used by:
- `replayCaptureFrameForCurrentResize` during window resizes
- `applyCaptureFrameForLabel` during view switching (via delegation)

**Logic (Path B — has stored aspect ratio):**

```
widthRatio = baseDimensions exist
  ? baseWidth / baseWindowWidth      // STABLE — never changes
  : storedWidth / storedWindowWidth  // FALLBACK — may shrink
heightRatio = baseDimensions exist
  ? baseHeight / baseWindowHeight
  : storedHeight / storedWindowHeight

widthLimit = canvasWidth * widthRatio
heightLimit = canvasHeight * heightRatio

frameWidth = min(widthLimit, heightLimit * aspectRatio)
frameHeight = frameWidth / aspectRatio
```

**Key insight**: The `baseWidth / baseWindowWidth` ratio is set once (on frame creation or manual +/- key) and preserved across passive resizes. This means when the window shrinks then grows back, the ratio stays the same and the frame returns to its original proportional size.

### `buildCaptureFrameRecord(rect)` — toolbar-controller.ts ~line 1973

Creates a frame record from a DOM rect. **Always sets `baseWidth: width`** using the current frame size. Base dimension stability is achieved at the save site by the `existing.baseWidth || record.baseWidth` pattern:

```javascript
activeTab.captureFrame = {
  ...existing,
  ...record,
  baseWidth: existing.baseWidth || record.baseWidth,     // Keep original if exists
  baseHeight: existing.baseHeight || record.baseHeight,
  baseWindowWidth: existing.baseWindowWidth || record.baseWindowWidth,
  baseWindowHeight: existing.baseWindowHeight || record.baseWindowHeight,
};
```

**Important**: The spread order matters — `...record` sets current values, then explicit `baseWidth:` overrides with the stable value.

### `buildCenteredRectFromSize(width, height)` — toolbar-controller.ts ~line 3273

Wraps a given size into a rect centered within the preferred capture area (the space between left/right panels). Contains a `Math.min(1, preferredArea.width / sourceWidth, ...)` fitScale that ensures the frame doesn't exceed the usable area. During proportional resize, `fitScale` stays at 1 because the frame always fits within the canvas bounds.

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
| Capture frame corner drag | `capture-frame.ts` resize handlers → `saveActiveTabState()` | Live size/position, preserves existing worldRect |

## Base Dimension Lifecycle

```
Frame creation (buildCaptureFrameRecord)
  → baseWidth = current rect width
  → baseWindowWidth = window.innerWidth
  → ratio = baseWidth / baseWindowWidth  (e.g., 0.75)

+/- key press (resizeCaptureFrameProportionally)
  → baseWidth = new frame width (e.g., 800 → 880)
  → baseWindowWidth = window.innerWidth
  → ratio = 880 / currentWindowWidth  (NEW ratio)

Window shrink (passive)
  → calculateTargetFrameSize: widthLimit = canvasWidth * 0.75
  → Frame shrinks (e.g., to 700px)
  → replayCaptureFrameForCurrentResize saves:
    → existing.baseWidth = 880 || record.baseWidth = 700
    → saved baseWidth = 880 (ORIGINAL preserved!)
  → ratio stays 0.75

Window grow back (passive)
  → calculateTargetFrameSize: widthLimit = canvasWidth * 0.75
  → Frame grows to 880px (MATCHES original!)
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

1. **Forgot to update baseWidth after +/- resize**: The +/- key handler in `main.ts:resizeCaptureFrameProportionally()` MUST update `baseWidth/Height` and `baseWindowWidth/Height` before saving the tab state. Otherwise the next window resize will revert the manual adjustment.

2. **buildCaptureFrameRecord always sets baseWidth**: Every function that calls `buildCaptureFrameRecord` followed by `activeTab.captureFrame = {...record}` will OVERWRITE the stable base dimensions unless the save site explicitly preserves them (as `replayCaptureFrameForCurrentResize` does).

3. **isScalePageSizeMode() check**: When computing frame size during resize, the code previously only called `calculateTargetFrameSize` for scale-page-size mode. Now it calls it for ALL fit modes. Any new code that computes frame geometry should follow the same pattern.

4. **Floating layout early return**: `updateCaptureFrameOnResize` returns early for the floating layout primary canvas. If frame geometry needs to change during resize, rely on `replayCaptureFrameForCurrentResize` instead.

## Relevant Files

| File | Role |
|------|------|
| `src/modules/CanvasManager.ts` | `calculateTargetFrameSize`, `applyResize`, `updateCaptureFrameOnResize` |
| `src/modules/ui/toolbar-controller.ts` | `replayCaptureFrameForCurrentResize`, `buildCaptureFrameRecord`, `applyCaptureFrameForLabel`, `resolveCaptureFrameRect`, viewport tracking |
| `src/modules/ui/image-gallery.ts` | Gallery thumbnails, drag-and-drop reorder |
| `src/modules/ui/capture-frame.ts` | Capture frame DOM drag/resize handlers |
| `src/modules/main.ts` | `resizeCaptureFrameProportionally` (+/- keys), `App` class |
| `src/modules/ProjectManager.ts` | `switchView`, view lifecycle |
| `src/modules/utils/viewportRestore.ts` | Viewport math utilities (fit, compute, transform) |
