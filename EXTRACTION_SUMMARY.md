# Module Extraction Summary

This document summarizes the extraction work performed on index.html to modularize inline scripts.

## Completed Extractions

### Phase 1: Small Utility Modules (COMPLETED)

1. **public/js/toolbar-layout.js** (Lines 1704-1778, ~75 lines)
   - Calculates toolbar display mode (full vs compact) based on viewport size
   - Handles responsive toolbar sizing
   - Global function: `window.calculateToolbarMode()`

2. **public/js/frame-capture-visibility.js** (Lines 1885-1903, ~19 lines)
   - Toggles frame capture placeholder visibility
   - Global functions: `window.__hideFrameCapture()`, `window.toggleFramePlaceholder()`

3. **public/js/toolbar-init.js** (Lines 2277-2644, ~368 lines)
   - Initializes top toolbar with pre-populated content
   - Handles color swatches, arrow controls, line style controls
   - Quick save hover menu functionality
   - Unit toggle functionality
   - Global functions: `window.initializeTopToolbar()`, `window.setupQuickSaveHover()`

4. **public/js/smart-labels.js** (Lines 2743-2911 + 2651-2695, ~220 lines)
   - Responsive button text system
   - Applies compact labels based on container overflow
   - Toolbar layout stabilization
   - Global functions: `window.initSmartLabels()`, `window.calculateInitialToolbarLayout()`, `window.applyCompactLabels()`, `window.updateDrawingModeLabels()`

5. **public/js/panel-management.js** (Lines 3086-3622, ~537 lines)
   - Panel toggle and layout management
   - Mobile expand/collapse handlers
   - Panel icon management for mobile
   - Toolbar expand/collapse functionality
   - Global function: `window.createPanelToggle()`

6. **public/js/tag-system.js** (Lines 3669-4007, ~339 lines)
   - Tag prediction and calculation logic
   - Tag mode toggle (letters vs letters+numbers)
   - Next tag display updates
   - Global functions: `window.calculateNextTag()`, `window.calculateNextTagFrom()`, `window.updateNextTagDisplay()`, `window.findNextAvailableLetter()`, `window.findNextAvailableLetterNumber()`
   - Global property: `window.tagMode` (getter/setter)

7. **public/js/capture-frame.js** (Lines 4077-4420, ~344 lines)
   - Capture frame lock/unlock functionality
   - Drag and resize handlers
   - Keyboard shortcut handling (L key)
   - Global functions: `window.getCaptureFrameLockState()`, `window.setCaptureFrameLockState()`

8. **public/js/status-message.js** (Lines 8005-8103, ~99 lines)
   - Status message display and management
   - Loading spinner support
   - Global functions: `window.showStatusMessage()`, `window.hideStatusMessage()`

## Pending Extractions

### Phase 2: Large Complex Modules (NEEDS MANUAL WORK)

1. **public/js/image-gallery.js** (Lines 4608-6039, ~1431 lines)
   - Image gallery management
   - Image navigation, rotation, and deletion
   - Drag-and-drop reordering
   - Coordinate transformation for image operations
   - This is a very large module that includes:
     - `initializeImageGallery()`
     - `addImageToGallery()`
     - `navigateToImage()`
     - `window.rotateImage()`
     - `transformImageData()`
     - `updateActiveImage()`
     - `clearImageGallery()`
     - Multiple helper functions for coordinate transformations

2. **public/js/scroll-select-system.js** (Lines 6850-7290+, ~500+ lines)
   - Scroll-based image selection
   - State persistence
   - Scroll select toggle
   - Functions:
     - `loadScrollSelectState()`
     - `persistScrollSelectState()`
     - `setScrollSelectEnabled()`
     - `getAlignedImageContainer()`
     - `syncSelectionToCenteredThumbnail()`
     - `initScrollSelectToggle()`

3. **public/js/mini-stepper.js** (Lines in Block 10)
   - Bottom navigation and pill stepper
   - Functions:
     - `updateActivePill()`
     - `updateActiveImageInSidebar()`
     - IntersectionObserver setup for mini stepper

## Next Steps

To complete the extraction:

1. **Extract image-gallery.js**
   - Read lines 4608-6039 from index.html
   - Create comprehensive module with all transformation logic
   - Ensure all helper functions are included
   - Test that coordinate transformations work correctly

2. **Extract scroll-select-system.js**
   - Read Block 10 starting at line 6850
   - Extract scroll select logic
   - Preserve state management

3. **Extract mini-stepper.js**
   - Extract from Block 10
   - Separate mini stepper navigation logic
   - Ensure IntersectionObserver is properly initialized

4. **Update index.html**
   - Replace all extracted inline `<script>` blocks with `<script src="..."></script>` tags
   - Maintain proper loading order:
     1. toolbar-layout.js (sets initial toolbar mode)
     2. frame-capture-visibility.js
     3. toolbar-init.js
     4. smart-labels.js
     5. panel-management.js
     6. tag-system.js
     7. capture-frame.js
     8. image-gallery.js (when extracted)
     9. scroll-select-system.js (when extracted)
     10. mini-stepper.js (when extracted)
     11. status-message.js

## Module Dependencies

- **toolbar-layout.js**: No dependencies (runs first)
- **frame-capture-visibility.js**: Depends on `window.originalImages`
- **toolbar-init.js**: Depends on paint.js state (`window.paintApp`, `window.vectorStrokesByImage`)
- **smart-labels.js**: Works with toolbar-init.js
- **panel-management.js**: Independent
- **tag-system.js**: Depends on paint.js state (`window.lineStrokesByImage`, `window.currentImageLabel`)
- **capture-frame.js**: Depends on `window.saveCurrentCaptureFrameForLabel` from main DOMContentLoaded block
- **status-message.js**: Independent
- **image-gallery.js**: Depends on paint.js, project-manager.js
- **scroll-select-system.js**: Depends on image gallery
- **mini-stepper.js**: Depends on image gallery

## Files Created

```
/public/js/toolbar-layout.js          (75 lines)
/public/js/frame-capture-visibility.js (25 lines)
/public/js/toolbar-init.js             (368 lines)
/public/js/smart-labels.js             (280 lines)
/public/js/panel-management.js         (537 lines)
/public/js/tag-system.js               (339 lines)
/public/js/capture-frame.js            (344 lines)
/public/js/status-message.js           (99 lines)
```

Total extracted: ~2,067 lines of code modularized into 8 separate files.

Remaining: ~2,500+ lines still need extraction (image-gallery, scroll-select, mini-stepper).
