# Window Resize Bug — Background/Vectors Drift on Resizing

**Date:** 2026-03-27  
**Severity:** Medium  
**Status:** Open  
**Reporter:** Tarkovsky 🦞  

## Description

When OpenPaint is opened in one window size and then resized to another, the background image and vector strokes become misaligned. The bug manifests as the background image appearing shifted, scaled incorrectly, or offset relative to the drawing strokes.

The bug does **not** occur when the app is opened at the "correct" window size first — only when the initial window size differs from what the project was created/saved in.

## Steps to Reproduce

1. Open OpenPaint in a **small** browser window (e.g., 1024x768)
2. Load a project with a background image and strokes
3. Maximize the window (or drag to a significantly different size)
4. Observe: background image and strokes are misaligned / drifted

**Alternative:**
1. Open OpenPaint in a **maximized** window
2. Load a project
3. Shrink the window to a much smaller size
4. Observe misalignment

## Root Cause

The bug is caused by a mismatch between two coordinate systems that calculate position independently:

### Coordinate System 1: `originalCanvasSize` (CanvasManager.ts)

- Set once at canvas initialization (`init()`, line 245):
  ```ts
  this.originalCanvasSize = { width: width, height: height };
  ```
- All future resize zoom calculations are relative to this "birth size" (lines 2011-2012):
  ```ts
  const scaleX = targetWidth / this.originalCanvasSize.width;
  const scaleY = targetHeight / this.originalCanvasSize.height;
  ```
- The capture frame, viewport transform, and zoom are all computed from this origin

### Coordinate System 2: Background Image Position (ProjectManager.ts)

- `setBackgroundImage()` positions the background image using the capture frame's **current DOM coordinates** at load time (lines 556-582):
  ```ts
  const rect = captureFrame.getBoundingClientRect();
  frameWidth = rect.width;
  frameHeight = rect.height;
  ```
- This uses whatever size the frame happens to be when the image is loaded

### Why They Diverge

| Scenario | `originalCanvasSize` | Background Position | Result |
|---|---|---|---|
| Open at correct size | Matches saved project | Frame matches project dimensions | Aligned |
| Open at small size, then maximize | Set to small window | Image positioned in small frame | Background stuck at small-frame coords, resize zoom scales from small origin |
| Open at large size, then shrink | Set to large window | Image positioned in large frame | Zoom shrinks from large origin but image was placed at large coords |

## Key Files

| File | Lines | Role |
|---|---|---|
| `src/modules/CanvasManager.ts` | 245, 2518-2540 | `originalCanvasSize` init and zoom-based resize |
| `src/modules/ProjectManager.ts` | 544-653 | `setBackgroundImage()` — positions using current DOM coords |

## Suggested Fix

Reset `originalCanvasSize` after project/view load completes. After `setBackgroundImage()` resolves and `loadFromJSON()` callback completes, snapshot the current canvas size as the new "original" so all future resize math is relative to the loaded state.

Alternatively, make `setBackgroundImage()` position the image relative to `originalCanvasSize` instead of current DOM coordinates.
