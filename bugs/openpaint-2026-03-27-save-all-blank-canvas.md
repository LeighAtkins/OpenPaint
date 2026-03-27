# Bug: Save All Images — Blank Canvas on Export

**Date:** 2026-03-27
**Severity:** Medium
**Status:** Open
**Reporter:** Tarkovsky 🦞

## Description

When using "Save All Images," some or all exported images come out as blank (white) canvases instead of showing the background image + strokes.

## Steps to Reproduce

1. Load a project with multiple views, each having background images and strokes
2. Click "Save All Images"
3. Open the downloaded PNGs — some are blank

## Root Cause

In `src/modules/ui/pdf-export-inline.ts`, line 1058+, the `saveAllImages` function iterates through views with only a **100ms delay** between switches:

```ts
await window.app.projectManager.switchView(viewId);
await new Promise(resolve => setTimeout(resolve, 100));
```

100ms is not enough for the view to fully render. `switchView()` is async and involves saving state, clearing canvas, loading background image (async `fabric.Image.fromURL`), loading canvas JSON, and rendering. The `switchView` promise resolves before rendering completes.

## Key File

`src/modules/ui/pdf-export-inline.ts` — `window.saveAllImages` function (line 1058)

## Suggested Fix

Wait for render completion instead of fixed delay — poll for `canvas.backgroundImage` or use `requestAnimationFrame` to confirm the canvas has rendered content before capturing.
