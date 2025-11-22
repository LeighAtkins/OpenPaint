/**
 * Image List Padding Module
 * Dynamically adjusts image list padding to center items vertically
 */
(function() {
    'use strict';

    let resizeTimeout = null;

    /**
     * Update image list padding to center items
     */
    function updateImageListPadding() {
        const imageList = document.getElementById('imageList');
        if (!imageList) return;

        const sampleContainer = imageList.querySelector('.image-container');
        if (!sampleContainer) {
            // Fall back to default padding if no samples
            imageList.style.paddingTop = 'calc(30vh - 5rem)';
            imageList.style.paddingBottom = 'calc(30vh - 5rem)';
            return;
        }

        const listHeight = imageList.getBoundingClientRect().height;
        const itemHeight = sampleContainer.getBoundingClientRect().height;

        if (!listHeight || !itemHeight) return;

        const padding = Math.max(0, (listHeight / 2) - (itemHeight / 2));

        imageList.style.paddingTop = `${padding}px`;
        imageList.style.paddingBottom = `${padding}px`;
    }

    /**
     * Handle window resize with debounce
     */
    function handleResize() {
        if (resizeTimeout) {
            clearTimeout(resizeTimeout);
        }
        resizeTimeout = setTimeout(() => {
            resizeTimeout = null;
            updateImageListPadding();
        }, 150);
    }

    // Expose public API
    window.updateImageListPadding = updateImageListPadding;

    // Listen for resize events
    window.addEventListener('resize', handleResize);

    // Initial call
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', updateImageListPadding);
    } else {
        updateImageListPadding();
    }
})();
