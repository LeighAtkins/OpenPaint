# Image Gallery Modularization Summary

## Extracted Modules

### 1. Image Gallery Management (`/public/js/image-gallery.js`)
**Lines Extracted:** 4608-6039 (~1431 lines from index.html)

**Functionality:**
- Image gallery initialization with horizontal scroll navigation
- Thumbnail creation and management
- Drag-and-drop reordering
- Image deletion
- Navigation controls (prev/next buttons, dots, keyboard)
- Intersection Observer for active image detection
- Canvas control integration (rotate left/right buttons)
- Image name/type input handlers
- Panel visibility and positioning management
- Integration with ProjectManager and mini-stepper

**Public API:**
```javascript
window.imageGallery = {
    initialize(),
    addImage(imageData, index),
    navigateToImage(index),
    clearGallery(),
    getData(),
    getCurrentIndex()
}

// Legacy compatibility
window.addImageToGallery(imageData, index)
window.addImageToGalleryCompat(imageData)
```

**Dependencies:**
- `window.projectManager` - for view switching
- `window.switchToImage()` - legacy image switching
- `window.paintApp` - paint application state
- `window.transformImageData()` - coordinate transformations (still in index.html)
- `window.rotateImage()` - exposed globally for rotate controls
- `window.updateActivePill()` - mini-stepper integration
- `window.updatePills()` - mini-stepper integration
- `window.getTagBasedFilename()` - for caption generation
- `window.redrawCanvasWithVisibility()` - canvas redraw
- `window.drawAllStrokes()` - fallback canvas redraw

---

### 2. Scroll Select System (`/public/js/scroll-select-system.js`)
**Lines Extracted:** 6886-7016 (~130 lines from index.html)

**Functionality:**
- Auto/manual scroll-to-select toggle
- LocalStorage persistence of user preference
- Center-based image alignment detection
- Tolerance calculation for centered items
- Integration with sidebar image list
- Automatic image switching on scroll

**Public API:**
```javascript
window.scrollSelectSystem = {
    loadState(),
    persistState(enabled),
    setEnabled(enabled, source),
    isEnabled(),
    getAlignedContainer(imageList),
    syncSelection(),
    initialize()
}

// Legacy compatibility
window.syncSelectionToCenteredThumbnail()
```

**Dependencies:**
- `window.projectManager.switchView()` - for image switching
- `window.updateActivePill()` - mini-stepper sync
- `window.updateImageListPadding()` - padding updates

**Configuration:**
- `SCROLL_SELECT_STORAGE_KEY`: 'scrollSelectEnabled'
- `SCROLL_SWITCH_DEBOUNCE_MS`: 70ms
- `MIN_CENTER_TOLERANCE`: 8px
- `MAX_CENTER_TOLERANCE`: 48px

---

### 3. Image List Padding (`/public/js/image-list-padding.js`)
**Lines Extracted:** 6851-6884 (~34 lines from index.html)

**Functionality:**
- Dynamic padding calculation for vertical centering
- Responsive resize handling with debounce
- Fallback to CSS calc() when no containers exist

**Public API:**
```javascript
window.updateImageListPadding()
```

**Dependencies:** None

**Behavior:**
- Calculates padding as: `(listHeight / 2) - (itemHeight / 2)`
- Falls back to `calc(30vh - 5rem)` if no `.image-container` found
- Debounces resize events (150ms)

---

### 4. Mini Stepper Navigation (`/public/js/mini-stepper.js`)
**Lines Extracted:** 7022-7904 (~882 lines from index.html)

**Functionality:**
- Bottom navigation pill system
- Auto-centering of active pill
- Scroll-based pill selection
- Image list centering observer
- Pill-to-image synchronization
- Dynamic pill generation from multiple sources
- Intersection Observer for both pills and images
- Sidebar active state management
- Programmatic scroll detection and suppression

**Public API:**
```javascript
window.updateActivePill()
window.updateActiveImageInSidebar()
window.ensureImageListObserver()
```

**Dependencies:**
- `window.projectManager` - view management
- `window.switchToImage()` - image switching
- `window.originalImages` - image state source
- `window.scrollSelectSystem.getAlignedContainer()` - scroll alignment
- `window.updateImageListPadding()` - padding updates
- `window.syncSelectionToCenteredThumbnail()` - scroll sync
- `imageGalleryData` - global gallery data (optional)

**Configuration:**
```javascript
const cfg = {
    activeClasses: "bg-slate-900 text-white scale-105 shadow-md",
    inactiveClasses: "bg-white text-slate-600 border border-slate-300",
    pillSize: "w-8 h-8",
    threshold: 0.3
}
```

**Features:**
- Multiple data source fallbacks (sidebar → ProjectManager → galleryData → DOM)
- Programmatic scroll flags to prevent scroll-loop feedback
- Mutation observers for dynamic content
- Reduced motion support
- Custom events: `mini-step-change`, `mini-step-click`

---

## Script Tag Order for index.html

Add these script tags in the following order (after existing core scripts but before closing `</body>`):

```html
<!-- Image Management Modules -->
<script src="js/image-list-padding.js"></script>
<script src="js/scroll-select-system.js"></script>
<script src="js/image-gallery.js"></script>
<script src="js/mini-stepper.js"></script>
```

**Rationale for Order:**
1. `image-list-padding.js` - No dependencies, provides utility function
2. `scroll-select-system.js` - Uses padding utility, no gallery dependency
3. `image-gallery.js` - Uses scroll-select and padding, main gallery logic
4. `mini-stepper.js` - Depends on all above modules, orchestrates navigation

---

## Remaining Code in index.html

The following large blocks remain in index.html and are **intentionally not extracted** due to tight coupling with paint.js:

### Image Transformation System (Lines ~5148-5928, ~780 lines)
**Functions:**
- `window.rotateImage(index, degrees)` - Main rotation function
- `flipImage(index, direction)` - Main flip function
- `transformImageData(label, type, value, w, h)` - Coordinate transformation
- `updateCanvasWithNewImage(src)` - Canvas update helper
- `rotateCoordinates(x, y, deg, w, h, center, keep)` - Math utility
- `flipCoordinates(x, y, dir, w, h)` - Math utility
- `rotateOffsetVector(x, y, deg)` - Vector rotation
- `flipOffsetVector(x, y, dir)` - Vector flip
- `calculateDrawingCentroid(vectorStrokes, label)` - Centroid calculation
- `rotatePoint(point, center, deg)` - Point rotation
- `getStrokeMidpointImageSpace(src, imgLabel, strokeLabel)` - Midpoint getter
- `testCoordinateTransformations()` - Test harness

**Why Not Extracted:**
- Deep integration with `window.paintApp.state`
- Direct manipulation of `window.vectorStrokesByImage`
- Requires access to `window.customLabelPositions`
- Modifies `window.imageRotationByLabel`
- Complex state synchronization with paint.js
- Would require extensive refactoring to modularize properly

**Recommendation:** Extract to `image-transformations.js` in a future refactoring pass that also modularizes paint.js state management.

---

## Module Dependencies Graph

```
image-list-padding.js (no deps)
        ↓
scroll-select-system.js
        ↓
image-gallery.js ←─────┐
        ↓              │
mini-stepper.js ───────┘
        ↓
[Both depend on transformation functions still in index.html]
```

---

## Breaking Changes

None - all modules maintain backward compatibility through:
- Legacy function exports (`window.addImageToGallery`, etc.)
- Preserved global state access patterns
- Maintained event-driven architecture
- Fallback mechanisms for missing dependencies

---

## Testing Checklist

- [ ] Image gallery thumbnails render correctly
- [ ] Thumbnail drag-and-drop reordering works
- [ ] Image deletion prompts and removes images
- [ ] Keyboard navigation (arrow keys) functions
- [ ] Rotate left/right controls work
- [ ] Image name/type inputs save changes
- [ ] Gallery panel positioning stays within viewport
- [ ] Scroll-to-select auto mode works
- [ ] Manual mode disables auto-selection
- [ ] Toggle persists across page reloads
- [ ] Image list padding centers items
- [ ] Padding updates on window resize
- [ ] Mini stepper pills generate for all images
- [ ] Active pill highlights correctly
- [ ] Clicking pill switches image
- [ ] Sidebar thumbnails highlight active image
- [ ] Scroll snapping works smoothly
- [ ] No scroll feedback loops occur
- [ ] Programmatic scrolls don't trigger selection
- [ ] Mutation observers detect new images

---

## File Sizes

- `image-gallery.js`: ~28 KB (813 lines)
- `scroll-select-system.js`: ~6 KB (177 lines)
- `image-list-padding.js`: ~2 KB (60 lines)
- `mini-stepper.js`: ~40 KB (834 lines)

**Total:** ~76 KB of modularized code extracted from index.html
