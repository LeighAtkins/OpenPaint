# Legacy Compatibility and Background Removal Fixes

## Overview

This document outlines the critical fixes implemented to resolve background removal issues and maintain compatibility with legacy files in the OpenPaint application. These changes ensure that existing projects continue to work properly while new functionality operates correctly.

## Issues Addressed

### 1. Curved Lines Double-Click Functionality
**Problem**: `ReferenceError: imageX is not defined` when double-clicking curved lines that overlap.

**Root Cause**: The `findNearestPointOnStroke` function was using undefined variables (`imageX`, `imageY`, `scale`) instead of the unified coordinate transformation system.

**Solution**: Updated the function to use proper coordinate transformations.

### 2. Background Removal HTTP2 Protocol Errors
**Problem**: `net::ERR_HTTP2_PROTOCOL_ERROR` when loading processed images from Cloudflare Images, causing lines to disappear.

**Root Cause**: Direct usage of Cloudflare Images URLs with `pasteImageFromUrl` was causing CORS and HTTP2 protocol issues.

**Solution**: Enhanced the background removal pipeline to fetch and convert URLs to blobs before processing.

### 3. Lines Disappearing After Background Removal
**Problem**: Stroke data was being lost during the background removal process on legacy files.

**Root Cause**: The image replacement process was not properly preserving stroke data during the transition.

**Solution**: Implemented comprehensive stroke data preservation in the `replaceImagePreservingOffsets` function.

## Technical Changes Made

### File: `js/paint.js`

#### 1. Fixed `findNearestPointOnStroke` Function (Lines 14358-14442)

**Before:**
```javascript
// Used undefined variables
const prevCanvasX = imageX + (prevPoint.x * scale);
const prevCanvasY = imageY + (prevPoint.y * scale);
```

**After:**
```javascript
// Use unified coordinate transformation system
const prevTransformed = imageToCanvasCoords(prevPoint.x, prevPoint.y, transformParams);
const prevCanvasX = prevTransformed.x;
const prevCanvasY = prevTransformed.y;
```

**Key Changes:**
- Replaced undefined `imageX`, `imageY`, `scale` variables
- Used `imageToCanvasCoords()` for consistent coordinate transformation
- Used `canvasToImageCoords()` for inverse transformation
- Leveraged `getTransformationParams(currentImageLabel)` for unified system

#### 2. Enhanced Background Removal Pipeline (Lines 370-427)

**Before:**
```javascript
if (cutoutUrl.startsWith('http')) {
    // Direct usage - caused HTTP2 errors
    await pasteImageFromUrl(cutoutUrl, label, { preserveCanvasScale: true, preserveBasis: 'width' });
}
```

**After:**
```javascript
if (cutoutUrl.startsWith('http')) {
    // Fetch first to convert to blob, avoiding CORS/HTTP2 issues
    const response = await fetch(cutoutUrl, { 
        mode: 'cors',
        cache: 'no-cache'
    });
    const blob = await response.blob();
    
    // Use centralized handler or fallback
    if (typeof window.onBackgroundRemoved === 'function') {
        await window.onBackgroundRemoved(label, blob);
    } else {
        const dataUrl = await rembg_blobToDataURL(blob);
        await pasteImageFromUrl(dataUrl, label, { preserveCanvasScale: true, preserveBasis: 'width' });
    }
}
```

**Key Changes:**
- Added explicit fetch of processed image URLs
- Convert HTTP URLs to blobs before processing
- Added comprehensive error handling with fallback
- Enhanced logging for debugging
- Use centralized `window.onBackgroundRemoved` handler when available

#### 3. Stroke Data Preservation (Lines 9740-9814)

**Existing Implementation (Already Present):**
```javascript
// CRITICAL FIX: Preserve stroke data before image replacement
const preservedStrokeData = {
    vectorStrokes: window.vectorStrokesByImage[label] ? JSON.parse(JSON.stringify(window.vectorStrokesByImage[label])) : {},
    lineStrokes: window.lineStrokesByImage[label] ? [...(window.lineStrokesByImage[label] || [])] : [],
    strokeVisibility: window.strokeVisibilityByImage[label] ? JSON.parse(JSON.stringify(window.strokeVisibilityByImage[label])) : {},
    strokeLabelVisibility: window.strokeLabelVisibility[label] ? JSON.parse(JSON.stringify(window.strokeLabelVisibility[label])) : {},
    strokeMeasurements: window.strokeMeasurements[label] ? JSON.parse(JSON.stringify(window.strokeMeasurements[label])) : {}
};

// ... image processing ...

// CRITICAL FIX: Restore stroke data after image replacement
if (preservedStrokeData.vectorStrokes && Object.keys(preservedStrokeData.vectorStrokes).length > 0) {
    window.vectorStrokesByImage[label] = preservedStrokeData.vectorStrokes;
}
// ... restore all other stroke data ...
```

## Legacy Compatibility Considerations

### 1. Coordinate Transformation System
**Critical**: Always use the unified coordinate transformation system:
- `imageToCanvasCoords(x, y, transformParams)` - Convert image coordinates to canvas coordinates
- `canvasToImageCoords(x, y, transformParams)` - Convert canvas coordinates to image coordinates
- `getTransformationParams(imageLabel)` - Get transformation parameters for an image

**Why**: Legacy files may have different image scales, positions, and transformations. The unified system ensures consistent behavior across all images.

### 2. Stroke Data Preservation
**Critical**: When replacing images (especially during background removal), always preserve stroke data:
- `vectorStrokesByImage[label]` - Vector stroke data
- `lineStrokesByImage[label]` - Line stroke data
- `strokeVisibilityByImage[label]` - Stroke visibility settings
- `strokeLabelVisibility[label]` - Label visibility settings
- `strokeMeasurements[label]` - Measurement data

**Why**: Legacy files contain valuable stroke data that must be preserved during image operations.

### 3. Background Removal Pipeline
**Critical**: Use the enhanced background removal pipeline:
- Fetch processed images as blobs before using them
- Use `window.onBackgroundRemoved` handler when available
- Implement proper error handling with fallbacks
- Add comprehensive logging for debugging

**Why**: Direct URL usage can cause CORS and HTTP2 protocol errors, especially with Cloudflare Images.

### 4. Image State Management
**Critical**: Maintain proper image state during operations:
- Preserve `originalImages[label]` references
- Maintain `imageScaleByLabel[label]` values
- Keep `imagePositionByLabel[label]` coordinates
- Update `lastImageDims[label]` dimensions

**Why**: Legacy files rely on these state variables for proper rendering and interaction.

## Testing Checklist for Legacy Compatibility

### Before Deploying Changes:
- [ ] Test background removal on new images
- [ ] Test background removal on legacy files with existing strokes
- [ ] Verify curved lines double-click works with overlapping lines
- [ ] Check that stroke data is preserved after background removal
- [ ] Ensure coordinate transformations work correctly
- [ ] Test with different image scales and positions
- [ ] Verify undo/redo functionality still works
- [ ] Check that project save/load preserves all data

### Legacy File Testing:
- [ ] Load existing projects with multiple images
- [ ] Test background removal on each image in the project
- [ ] Verify all strokes remain visible and interactive
- [ ] Check that measurements and labels are preserved
- [ ] Test editing existing strokes after background removal
- [ ] Verify project export functionality

## Maintenance Guidelines

### When Adding New Features:
1. **Always use the unified coordinate system** - Don't create new coordinate transformation logic
2. **Preserve stroke data** - Any image replacement must preserve existing stroke data
3. **Test with legacy files** - Ensure new features work with existing projects
4. **Add comprehensive logging** - Include debug information for troubleshooting
5. **Implement error handling** - Provide fallbacks for network and processing errors

### When Modifying Existing Functions:
1. **Check for coordinate dependencies** - Ensure all coordinate calculations use the unified system
2. **Verify stroke data handling** - Don't accidentally clear or modify stroke data
3. **Test edge cases** - Include overlapping lines, different scales, and various image types
4. **Maintain backward compatibility** - Don't break existing functionality

### Code Review Checklist:
- [ ] Uses unified coordinate transformation system
- [ ] Preserves stroke data during image operations
- [ ] Includes proper error handling
- [ ] Has comprehensive logging for debugging
- [ ] Tested with both new and legacy files
- [ ] Maintains backward compatibility

## Troubleshooting Common Issues

### Lines Disappearing After Background Removal:
1. Check if `replaceImagePreservingOffsets` is being called
2. Verify stroke data preservation is working
3. Check console for HTTP2 or CORS errors
4. Ensure `window.onBackgroundRemoved` handler is available

### Curved Lines Double-Click Not Working:
1. Verify `findNearestPointOnStroke` uses unified coordinate system
2. Check for undefined variables in coordinate calculations
3. Ensure `getTransformationParams` is being called correctly
4. Test with different image scales and positions

### HTTP2 Protocol Errors:
1. Check if background removal pipeline fetches URLs as blobs
2. Verify CORS mode is set correctly in fetch requests
3. Ensure proper error handling with fallbacks
4. Check Cloudflare Images API configuration

## Conclusion

These changes ensure that the OpenPaint application maintains full compatibility with legacy files while providing robust background removal functionality. The key principles are:

1. **Use the unified coordinate transformation system**
2. **Preserve stroke data during all image operations**
3. **Implement comprehensive error handling**
4. **Test thoroughly with both new and legacy files**

Following these guidelines will ensure that future changes maintain compatibility and don't break existing functionality.
