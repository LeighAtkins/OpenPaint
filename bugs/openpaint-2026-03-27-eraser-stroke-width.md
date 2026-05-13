# Bug: Eraser Tool Width Leaks to Other Tools

**Date:** 2026-03-27
**Severity:** Low-Medium
**Status:** Open
**Reporter:** Tarkovsky 🦞

## Description

When drawing with a thin stroke width (e.g., 4px) and then switching to eraser mode and back, the stroke width changes to the eraser's brush width (28px) instead of preserving the original thin width.

## Steps to Reproduce

1. Select a drawing tool (e.g., line, curve, pencil)
2. Set stroke width to a small value (e.g., 4px)
3. Draw a line — confirms it's 4px
4. Switch to eraser tool (Tab key cycle or toolbar)
5. Switch back to the drawing tool
6. Draw a line — it's now 28px (eraser width) instead of 4px

## Root Cause

In `ToolManager.ts`, `selectTool()` calls `updateSettings(this.currentSettings)` after activating the new tool. `currentSettings` is a shared object across all tools. `PrivacyEraserTool.activate()` sets `brushWidth = 28` on the canvas brush, which can leak back into `currentSettings.width` through UI synchronization. There's no per-tool width memory.

## Key Files

| File | Lines | Role |
|---|---|---|
| `src/modules/tools/ToolManager.ts` | 134-190 | `selectTool()` — activates tool, applies shared settings |
| `src/modules/tools/ToolManager.ts` | 170-190 | `updateSettings()` — applies width/color to active tool |
| `src/modules/tools/PrivacyEraserTool.js` | 20 | `activate()` — sets `brushWidth = 28` |
| `src/modules/tools/LineTool.ts` | 17, 444 | `strokeWidth` default = 2, `setWidth()` |

## Suggested Fix

Store width settings per tool and restore them on switch. When deactivating the eraser, restore the previous drawing tool's width. The eraser manages its own `brushWidth` independently and shouldn't pollute `currentSettings.width`.
