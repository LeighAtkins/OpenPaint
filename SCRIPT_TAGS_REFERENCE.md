# Script Tags Reference for Modularized Files

## Add These Script Tags to index.html

Add these tags near the end of the `<body>` section, **before** the closing `</body>` tag, in this exact order:

```html
<!-- Image Management Modules (Modularized from index.html) -->
<script src="js/image-list-padding.js"></script>
<script src="js/scroll-select-system.js"></script>
<script src="js/image-gallery.js"></script>
<script src="js/mini-stepper.js"></script>
```

## Recommended Placement

Insert after the existing paint.js/project-manager scripts and before any inline `<script>` blocks that use these modules:

```html
<!-- Core Application Scripts -->
<script src="js/paint.js"></script>
<script src="js/project-manager.js"></script>
<script src="js/tag-manager.js"></script>

<!-- Image Management Modules (NEW) -->
<script src="js/image-list-padding.js"></script>
<script src="js/scroll-select-system.js"></script>
<script src="js/image-gallery.js"></script>
<script src="js/mini-stepper.js"></script>

<!-- Remaining inline scripts from index.html -->
<script>
    // Transformation functions, etc.
</script>
```

## Code to Remove from index.html

Once the script tags are added, you can remove the following sections from index.html:

### 1. Image List Padding (Lines ~6851-6884)
```html
<script>
    function updateImageListPadding() {
        // ...
    }
    window.updateImageListPadding = updateImageListPadding;

    let __imageListPaddingResizeTimeout = null;
    window.addEventListener('resize', () => {
        // ...
    });
</script>
```

### 2. Scroll Select System (Lines ~6886-7016)
```html
<script>
    const SCROLL_SELECT_STORAGE_KEY = 'scrollSelectEnabled';
    const SCROLL_SWITCH_DEBOUNCE_MS = 70;

    function loadScrollSelectState() {
        // ...
    }

    // ... all scroll select functions

    initScrollSelectToggle();
</script>
```

### 3. Mini Stepper (Lines ~7022-7904)
```html
<script>
    if (typeof window.__miniStepperProgrammaticScrollUntil !== 'number') {
        window.__miniStepperProgrammaticScrollUntil = 0;
    }

    (function initMiniStepper() {
        // ... entire IIFE
    })();
</script>
```

### 4. Image Gallery (Lines ~4608-6039)
```html
<script>
    // Enhanced Image Gallery with Horizontal Scroll Navigation
    let currentImageIndex = 0;
    let imageGalleryData = [];
    let intersectionObserver = null;

    function initializeImageGallery() {
        // ...
    }

    // ... all gallery functions

    initializeImageGallery();

    // Reveal UI once initialization is complete
    document.documentElement.classList.remove('app-loading');
</script>
```

**Note:** The `document.documentElement.classList.remove('app-loading');` line is now in `image-gallery.js`, so remove it from index.html if it appears multiple times.

## Verification Steps

After adding the script tags and removing the inline code:

1. **Check Console:** Open browser DevTools → Console
   - Should see: `[Gallery] ...`, `[ImageList] ...`, `[ScrollSelect] ...` messages
   - No errors about undefined functions

2. **Test Gallery:**
   - Upload images → thumbnails appear in right panel
   - Drag thumbnails → reordering works
   - Click thumbnails → switches to that image

3. **Test Scroll Select:**
   - Toggle Auto/Manual mode in UI
   - Scroll sidebar → auto-switches image (in Auto mode)
   - Reload page → toggle state persists

4. **Test Mini Stepper:**
   - Pills appear at bottom with numbers
   - Active pill highlighted
   - Click pill → switches image
   - Scroll sidebar → pill updates

5. **Test Padding:**
   - Resize window → padding adjusts
   - First item centers in sidebar

## Troubleshooting

### Error: "Cannot read property 'switchView' of undefined"
**Solution:** Ensure `project-manager.js` loads before the new modules

### Error: "updateActivePill is not a function"
**Solution:** Check that `mini-stepper.js` is loaded

### Gallery thumbnails not appearing
**Solution:** Verify `image-gallery.js` loads after `project-manager.js`

### Scroll select not working
**Solution:** Check that `scroll-select-system.js` loads before `mini-stepper.js`
