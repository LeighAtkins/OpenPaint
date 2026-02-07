/**
 * Image List Padding Module
 * Dynamically adjusts image list padding to center items vertically
 */
(function () {
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

    const padding = Math.max(0, listHeight / 2 - itemHeight / 2);

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

  // Listen for DOM changes in the image list
  function setupMutationObserver() {
    const imageList = document.getElementById('imageList');
    if (!imageList) return;

    const observer = new MutationObserver(mutations => {
      // Check if nodes were added or removed
      let shouldUpdate = false;
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          shouldUpdate = true;
          break;
        }
      }

      if (shouldUpdate) {
        // Small delay to ensure layout is stable
        setTimeout(updateImageListPadding, 50);
      }
    });

    observer.observe(imageList, { childList: true });
  }

  // Scroll to active item
  function scrollToActiveItem() {
    const imageList = document.getElementById('imageList');
    if (!imageList) return;

    const activeItem =
      imageList.querySelector('.image-container[aria-selected="true"]') ||
      imageList.querySelector('.image-container'); // Fallback to first item

    if (activeItem) {
      activeItem.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  // Expose public API
  // window.updateStrokesListPadding = updateStrokesListPadding; // Removed in favor of CSS flexbox

  // Initialize
  function init() {
    setupMutationObserver();

    // Initial updates
    updateImageListPadding();

    // Small delay to ensure layout is stable before scrolling
    setTimeout(scrollToActiveItem, 100);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
