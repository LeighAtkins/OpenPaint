# Per-Image Tag Resize Fix

## Problem
The per-image tag resizing functionality was not working because the code was using inconsistent references to the current image label and stroke data.

## Root Cause
1. **Wrong currentImageLabel reference**: The code was using `window.paintApp.state.currentImageLabel` instead of the global `window.currentImageLabel`
2. **Wrong stroke data location**: The code was looking for strokes in `window.paintApp.state.vectorStrokesByImage` instead of the global `window.vectorStrokesByImage`

## Changes Made

### 1. Fixed `adjustAllTagSizes` function (lines 326, 361-363)
- Changed `window.paintApp?.state?.currentImageLabel` to `window.currentImageLabel`
- Changed `window.paintApp?.state?.vectorStrokesByImage` to `window.vectorStrokesByImage`

### 2. Fixed `getTagSize` function (line 5704)
- Changed `window.paintApp?.state?.currentImageLabel` to `window.currentImageLabel`

### 3. Fixed `updateTagSizeDisplay` function (lines 308-309)
- Changed `window.paintApp?.state?.currentImageLabel` to `window.currentImageLabel`

## Testing
1. Load the application
2. Add an image to the canvas
3. Draw some strokes with labels (A, B, C, etc.)
4. Use the per-image tag size controls (+ and - buttons)
5. Verify that tag sizes change for all strokes on the current image
6. Switch to a different image and repeat the test

## Expected Behavior
- ✅ Tag size controls should be visible in the UI
- ✅ Clicking + should increase all tag sizes on current image
- ✅ Clicking - should decrease all tag sizes on current image
- ✅ Tag sizes should persist when switching between images
- ✅ Each image should have independent tag sizes

## Debug Information
Check browser console for these debug logs:
- `[PER-IMAGE-BUTTON]` - Button click events
- `[TAG-SIZE-ADJUST]` - Size adjustment logic
- `[GET-TAG-SIZE]` - Tag size retrieval
