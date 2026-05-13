# Bug: Save PDF — Multi-Frame Images Missing Tags

**Date:** 2026-03-27
**Severity:** Medium
**Status:** Open
**Reporter:** Tarkovsky 🦞

## Description

When exporting a PDF for a project with multiple frames per view, the resulting images show only the strokes/lines without any tag labels. Tags render correctly on single-frame views but disappear on multi-frame views.

## Steps to Reproduce

1. Create a project with a multi-frame view (multiple tabs under one image)
2. Draw strokes and add tags/labels to each frame
3. Export as PDF
4. Open the PDF — lines are visible but tag labels are missing

## Root Cause

`captureViewImage` (line ~1373) captures the canvas by reading from `canvas.lowerCanvasEl`:

```ts
ctx.drawImage(canvasEl, left, top, width, height, 0, 0, width, height);
```

The `withTemporaryCaptureTarget` function (line ~892) waits 250ms after switching views, but this may not be enough for tag visibility to be restored after tab switches. Tags toggle on/off per tab via the TagManager — if the export captures before the visibility system settles, tags are invisible.

## Key Files

| File | Lines | Role |
|---|---|---|
| `src/modules/ui/pdf-export-inline.ts` | ~1373 | `captureViewImage` — captures canvas |
| `src/modules/ui/pdf-export-inline.ts` | ~892 | `withTemporaryCaptureTarget` — switches views, waits 250ms |

## Suggested Fix

Use Fabric.js `canvas.toCanvasElement()` instead of `lowerCanvasEl` — it renders all objects including tags onto a single canvas snapshot using Fabric's own rendering pipeline.
