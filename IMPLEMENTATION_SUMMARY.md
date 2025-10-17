# Text Alignment Fix - Implementation Summary

## Problem
Text was rendering outside (to the left) of its blue border box, even though the DOM preview showed perfect alignment.

## Root Causes Identified

### H1: Context State Leakage
Previous drawing operations (labels/strokes) were setting `ctx.textAlign = 'center'` and custom transforms. Without explicit resets, text rendering inherited these settings, causing the text to be drawn relative to a center point instead of left-aligned.

### H2: Font/Metrics Mismatch
Canvas was using simplified font strings (e.g., `"16px Arial"`) while the DOM preview used full computed styles including `font-weight`, `letter-spacing`, `line-height`. This caused different text rendering widths and positions.

### H3: Save/Render Parity Drift
Hardcoded values for `borderWidth` (2px) and `padding` (8px) in rendering code, but these could vary from actual CSS computed values. Any mismatch caused coordinate drift.

## Fixes Applied

### 1. Lock Canvas Text State (H1)
**Location**: `js/paint.js` lines ~6574-6578 and ~6396-6399

Added explicit state locking after `ctxText.save()`:
```javascript
ctxText.setTransform(1, 0, 0, 1, 0, 0); // Reset any transforms
ctxText.textAlign = 'left';              // Ensure left alignment
ctxText.textBaseline = 'top';            // Ensure top baseline
ctxText.direction = 'ltr';               // Left-to-right
```

### 2. Capture & Use Computed Styles (H2)
**Location**: `js/paint.js` lines ~18381-18393 (save), ~6631-6645 (render)

**Save**: Capture all computed styles from preview:
```javascript
const computedStyle = window.getComputedStyle(textBox);
const fontSize = parseFloat(computedStyle.fontSize) || 16;
const fontFamily = computedStyle.fontFamily || 'Arial, sans-serif';
const fontWeight = computedStyle.fontWeight || 'normal';
const letterSpacing = computedStyle.letterSpacing || 'normal';
const lineHeight = computedStyle.lineHeight || 'normal';
// Also capture border and padding from wrapper
const borderWidth = parseFloat(wrapperStyle.borderTopWidth) || 2;
const padding = parseFloat(computedStyle.padding) || 8;
```

**Render**: Use saved values instead of hardcoded:
```javascript
const fontWeight = el.fontWeight || 'normal';
ctxText.font = `${fontWeight} ${el.fontSize || 16}px ${el.fontFamily || 'Arial, sans-serif'}`;
if (el.letterSpacing && el.letterSpacing !== 'normal') {
    ctxText.letterSpacing = el.letterSpacing;
}
const lineHeight = el.lineHeight && el.lineHeight !== 'normal' ? 
    parseFloat(el.lineHeight) : Math.round((el.fontSize || 16) * 1.2);
const padding = el.padding !== undefined ? el.padding : 8;
const borderWidth = el.borderWidth !== undefined ? el.borderWidth : 2;
```

### 3. Debug Mode (H1, H2, H3 validation)
**Location**: `js/paint.js` lines ~6579-6588, ~6638-6658

Enable with `window.__TEXT_DEBUG = true`:
- Logs canvas state (textAlign, textBaseline, direction, transform matrix)
- Logs coordinate calculations
- Draws red dashed guide line at text start X position
- Logs border/padding values

## Files Modified
- `js/paint.js` - Main implementation (save, render, debug)
- `TEXT_DEBUG_MODE.md` - User documentation for debug mode
- `IMPLEMENTATION_SUMMARY.md` - This file

## Testing Instructions

1. **Enable debug mode**:
   ```javascript
   window.__TEXT_DEBUG = true
   ```

2. **Create new text**:
   - Add text on a fresh image
   - Check that preview and final render are pixel-identical
   - Red guide line should align with text left edge
   - Console should show `textAlign: 'left'` and identity transform

3. **Load existing project**:
   - Old text elements should render correctly (uses defaults for missing style fields)
   - New text elements should render with exact precision

4. **Verify no regressions**:
   - Labels/tags still render correctly
   - Undo/redo still works
   - Save/load preserves text positions

## Edge Cases Handled
- Legacy text elements without saved font metrics (fallback to defaults)
- Legacy text elements without saved border/padding (fallback to 2px/8px)
- HiDPI displays (transform reset handles scaling issues)
- Letter spacing support (graceful fallback if browser doesn't support)
- Line height calculations (supports both px values and 'normal')

## Next Steps
User should test with `window.__TEXT_DEBUG = true` and report:
1. Whether text now aligns with its box
2. Console logs showing the state
3. Any remaining misalignment issues (with screenshot if possible)

