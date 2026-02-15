/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-misused-promises, @typescript-eslint/prefer-regexp-exec, @typescript-eslint/unbound-method, prefer-rest-params */
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/**
 * Image Gallery Management Module
 * Handles horizontal scrolling image gallery with thumbnails, navigation, and image transformations
 */
(function () {
  'use strict';

  // Gallery state
  let currentImageIndex = 0;
  window.imageGalleryData = window.imageGalleryData || [];
  let intersectionObserver = null;

  /**
   * Initialize image gallery functionality
   */
  function initializeImageGallery() {
    const imageGallery = document.getElementById('imageGallery');
    const imageDots = document.getElementById('imageDots');
    const prevButton = document.getElementById('prevImage');
    const nextButton = document.getElementById('nextImage');
    const imagePosition = document.getElementById('imagePosition');
    const imageCounter = document.getElementById('imageCounter');

    if (!imageGallery) return;

    // Navigation button functionality
    prevButton?.addEventListener('click', () => navigateToImage(currentImageIndex - 1));
    nextButton?.addEventListener('click', () => navigateToImage(currentImageIndex + 1));

    // Intersection Observer for active image detection
    intersectionObserver = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const imageIndex = parseInt(entry.target.dataset.imageIndex);
            if (!isNaN(imageIndex)) {
              updateActiveImage(imageIndex);
            }
          }
        });
      },
      {
        root: imageGallery,
        threshold: 0.6,
        rootMargin: '0px',
      }
    );

    // Keyboard navigation
    document.addEventListener('keydown', e => {
      // Don't process arrow keys if user is typing in an input field
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }

      // Don't process if user is editing a contentEditable element
      if (
        e.target.isContentEditable ||
        e.target.classList.contains('stroke-name') ||
        e.target.classList.contains('stroke-measurement')
      ) {
        return;
      }

      // Only handle keyboard navigation if image panel is visible
      if (!document.getElementById('imagePanel').classList.contains('hidden')) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          navigateToImage(currentImageIndex - 1);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          navigateToImage(currentImageIndex + 1);
        }
      }
    });

    // Canvas Controls: wire rotate/flip buttons to current image
    // MIGRATED TO TYPESCRIPT - Rotation controls now handled by @/features/transform/controls.ts
    // and initialized in src/main.ts via initializeRotationControls()
    /*
        const rotateLeftCtrl = document.getElementById('rotateLeftCtrl');
        const rotateRightCtrl = document.getElementById('rotateRightCtrl');
        function getCurrentImageIndex() {
            const label = window.paintApp?.state?.currentImageLabel;
            if (!label) return currentImageIndex || 0;
            const idx = imageGalleryData.findIndex(i => (i.label || i.original?.label) === label);
            return idx >= 0 ? idx : (currentImageIndex || 0);
        }
        function rotateFallback(deg) {
            const label = window.paintApp?.state?.currentImageLabel || 'blank_canvas';
            const c = document.getElementById('canvas');
            const w = c?.width || 800;
            const h = c?.height || 600;
            if (typeof window.transformImageData === 'function') {
                window.transformImageData(label, 'rotate', deg, w, h);
                if (window.redrawCanvasWithVisibility) window.redrawCanvasWithVisibility();
            }
        }
        rotateLeftCtrl?.addEventListener('click', () => {
            const idx = getCurrentImageIndex();
            if (imageGalleryData[idx]) {
                window.rotateImage?.(idx, -90);
            } else {
                rotateFallback(-90);
            }
        });
        rotateRightCtrl?.addEventListener('click', () => {
            const idx = getCurrentImageIndex();
            if (imageGalleryData[idx]) {
                window.rotateImage?.(idx, 90);
            } else {
                rotateFallback(90);
            }
        });
        */

    // Name/type inputs wiring
    const nameInput = document.getElementById('imageNameInput');
    const typeSelect = document.getElementById('imageTypeSelect');
    nameInput?.addEventListener('change', e => {
      const val = e.target.value || '';
      const idx = currentImageIndex;
      if (imageGalleryData[idx]) {
        imageGalleryData[idx].name = val;
        // Update caption under the thumbnail (if present)
        const gallery = document.getElementById('imageGallery');
        const card = gallery?.children[idx];
        const caption = card?.querySelector('.thumb-caption');
        if (caption) caption.textContent = val;
      }
    });
    typeSelect?.addEventListener('change', e => {
      const val = e.target.value || '';
      const idx = currentImageIndex;
      if (imageGalleryData[idx]) {
        imageGalleryData[idx].original = imageGalleryData[idx].original || {};
        imageGalleryData[idx].original.type = val;
      }
    });
  }

  /**
   * Add image to gallery
   */
  function addImageToGallery(imageData, index) {
    console.log(`[Gallery] Adding image to gallery at index ${index}:`, imageData);

    const imageGallery = document.getElementById('imageGallery');
    const imageDots = document.getElementById('imageDots');

    if (!imageGallery || !imageDots) {
      console.error('[Gallery] imageGallery or imageDots element not found');
      return;
    }

    // Handle different image data formats from external scripts
    let imageSrc, imageName;
    if (typeof imageData === 'string') {
      // Simple string URL
      imageSrc = imageData;
      imageName = `Image ${index + 1}`;
    } else if (imageData && typeof imageData === 'object') {
      // Object with src/url and name properties
      imageSrc = imageData.src || imageData.url || imageData.dataUrl || imageData.blob;
      imageName = imageData.name || imageData.filename || imageData.title || `Image ${index + 1}`;
    } else {
      console.warn('[Gallery] Invalid image data format:', imageData);
      return;
    }
    if (!imageSrc) {
      console.warn('[Gallery] Missing image src, skipping:', imageData);
      return;
    }

    // Handle cases where imageData already has an 'original' property to avoid nesting
    let originalData = imageData;
    if (imageData && imageData.original && typeof imageData.original === 'object') {
      // If imageData already has an original property, use that instead
      originalData = imageData.original;
      console.log('[Gallery] Using nested original data to avoid double nesting');
    }

    // Compute caption; hide for blank canvas
    let displayName = '';
    try {
      if (!(originalData && originalData.isBlankCanvas)) {
        const lbl = originalData?.label;
        if (lbl && typeof window.getTagBasedFilename === 'function') {
          const base = lbl.split('_')[0];
          displayName = window.getTagBasedFilename(lbl, base) || imageName || '';
        } else {
          displayName = imageName || '';
        }
      }
    } catch (e) {
      displayName = imageName || '';
    }

    const existingThumb = imageGallery.querySelector(
      `.image-thumbnail[data-image-index="${index}"]`
    );
    if (existingThumb) {
      existingThumb.dataset.imageSrc = imageSrc;
      existingThumb.dataset.label =
        originalData?.label || imageData?.label || imageData?.name || imageName || '';
      existingThumb.style.backgroundImage = `url(${imageSrc})`;
      if (displayName) existingThumb.title = displayName;
      else existingThumb.removeAttribute('title');

      const existingCard = existingThumb.parentElement;
      let caption = existingCard?.querySelector('.thumb-caption');
      if (!caption && existingCard) {
        caption = document.createElement('div');
        caption.className =
          'thumb-caption text-[11px] text-slate-500 font-medium truncate max-w-[120px]';
        existingCard.appendChild(caption);
      }
      if (caption) caption.textContent = displayName || '';

      let dot = imageDots.querySelector(`.nav-dot[data-image-index="${index}"]`);
      if (!dot) {
        dot = document.createElement('div');
        dot.className = 'nav-dot';
        dot.dataset.imageIndex = index;
        dot.addEventListener('click', () => navigateToImage(index));
        imageDots.appendChild(dot);
      }
      console.log('[Gallery] Updated existing thumbnail at index:', index);
    }

    // Create image thumbnail
    let thumbnail = existingThumb;
    let card = existingThumb ? existingThumb.parentElement : null;
    if (!thumbnail) {
      thumbnail = document.createElement('div');
      thumbnail.className = 'image-thumbnail';
      thumbnail.dataset.imageIndex = index;
      thumbnail.dataset.imageSrc = imageSrc;
      thumbnail.dataset.label =
        originalData?.label || imageData?.label || imageData?.name || imageName || '';
      thumbnail.style.backgroundImage = `url(${imageSrc})`;
      thumbnail.title = imageName;
      thumbnail.draggable = true;
    }

    // Add hover controls (delete only)
    if (!existingThumb) {
      const controls = createThumbnailControls(index);
      // Strip rotate/flip from controls
      controls.querySelectorAll('.rotate-btn, .flip-btn').forEach(el => el.remove());
      thumbnail.appendChild(controls);
    }

    // Add all event listeners using helper function
    if (!existingThumb) addThumbnailEventListeners(thumbnail, index);

    // Wrap thumbnail in a small card with optional caption
    if (!card) {
      card = document.createElement('div');
      card.className = 'flex flex-col items-center gap-1';
      card.dataset.imageIndex = index;
      card.appendChild(thumbnail);
      const caption = document.createElement('div');
      caption.className =
        'thumb-caption text-[11px] text-slate-500 font-medium truncate max-w-[120px]';
      caption.textContent = displayName || '';
      card.appendChild(caption);
      if (displayName) thumbnail.title = displayName;
      else thumbnail.removeAttribute('title');
      imageGallery.appendChild(card);
    }

    console.log(`[Gallery] Created thumbnail element:`, thumbnail);
    console.log(`[Gallery] Gallery element children count:`, imageGallery.children.length);

    // Create navigation dot
    if (!existingThumb) {
      const dot = document.createElement('div');
      dot.className = 'nav-dot';
      dot.dataset.imageIndex = index;
      dot.addEventListener('click', () => navigateToImage(index));
      imageDots.appendChild(dot);
    }

    // Observe thumbnail for intersection
    if (intersectionObserver && !existingThumb) {
      intersectionObserver.observe(thumbnail);
    }

    const normalizedData = {
      src: imageSrc,
      name: imageName,
      original: originalData,
    };

    // Update gallery data
    imageGalleryData[index] = normalizedData;
    updateGalleryControls();

    // Persist order for save/load consistency
    try {
      window.orderedImageLabels = imageGalleryData
        .map(item => item?.original?.label || item?.label || item?.name || '')
        .filter(Boolean);
    } catch (e) {
      console.warn('[Gallery] Failed to update orderedImageLabels after add:', e);
    }
    if (!window.__initialGallerySyncDone && imageGalleryData.length === 1) {
      window.__initialGallerySyncDone = true;
      navigateToImage(0);
      console.log('[Gallery] Auto-selected first image');
    }

    // Trigger mini-stepper update if function exists
    if (typeof updatePills === 'function') {
      setTimeout(() => {
        try {
          updatePills();
          console.log('[Gallery] Updated mini-stepper pills');
        } catch (e) {
          console.warn('[Gallery] Error updating pills:', e);
        }
      }, 100);
    }
    if (typeof updateActivePill === 'function') {
      setTimeout(() => {
        try {
          updateActivePill();
          console.log('[Gallery] Updated active pill');
        } catch (e) {
          console.warn('[Gallery] Error updating active pill:', e);
        }
      }, 150);
    }

    console.log('[Gallery] Added image:', normalizedData);

    // Ensure the image panel is visible when adding any image
    const imagePanel = document.getElementById('imagePanel');
    const imagePanelContent = document.getElementById('imagePanelContent');
    if (imagePanel) {
      // Remove any hidden classes
      imagePanel.classList.remove('hidden');

      // Ensure the content is also visible (not collapsed)
      if (imagePanelContent) {
        imagePanelContent.classList.remove('hidden');

        // Ensure content has proper max-height for expansion
        if (
          imagePanelContent.style.maxHeight === '0px' ||
          imagePanelContent.style.maxHeight === '0'
        ) {
          imagePanelContent.style.maxHeight = 'none';
        }
      }

      // Don't set display:block as it can interfere with drag positioning
      if (imagePanel.style.display === 'none' && !isMobileDevice()) {
        imagePanel.style.display = '';
      }

      // Ensure the panel is positioned within the visible viewport
      const rect = imagePanel.getBoundingClientRect();
      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;

      // Check if panel is completely off-screen or has invalid dimensions
      const isOffScreen =
        rect.right < 0 || rect.left > windowWidth || rect.bottom < 0 || rect.top > windowHeight;
      const hasInvalidSize = rect.width === 0 || rect.height === 0;

      // Also check if panel is mostly off-screen (more than 80% hidden)
      const visibleWidth = Math.max(0, Math.min(rect.right, windowWidth) - Math.max(rect.left, 0));
      const visibleHeight = Math.max(
        0,
        Math.min(rect.bottom, windowHeight) - Math.max(rect.top, 0)
      );
      const visibleArea = visibleWidth * visibleHeight;
      const totalArea = rect.width * rect.height;
      const isMostlyHidden = totalArea > 0 && visibleArea / totalArea < 0.2;

      if (isOffScreen || hasInvalidSize || isMostlyHidden) {
        console.log('[Gallery] Panel is off-screen or invalid, resetting position');

        // Reset to default position (right side, vertically centered)
        imagePanel.style.position = 'fixed';
        imagePanel.style.right = '1rem';
        imagePanel.style.left = 'auto';
        imagePanel.style.top = 'clamp(1rem, 50vh - 20rem, calc(100vh - 40rem - 1rem))';
        imagePanel.style.bottom = 'auto';
        imagePanel.style.transform = '';
      }
    }
  }

  /**
   * Navigate to specific image
   */
  function navigateToImage(index) {
    const imageGallery = document.getElementById('imageGallery');
    if (!imageGallery || index < 0 || index >= imageGalleryData.length) return;

    const targetThumbnail = imageGallery.querySelector(`[data-image-index="${index}"]`);
    if (targetThumbnail) {
      targetThumbnail.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',
      });
    }

    // Get the image data and find corresponding legacy image
    const imageData = imageGalleryData[index];
    if (!window.__isLoadingProject && imageData && imageData.original && imageData.original.label) {
      const label = imageData.original.label;
      console.log(`[Gallery] Switching to image with label: ${label}`);

      // Try to switch using new ProjectManager system first
      if (window.projectManager && typeof window.projectManager.switchView === 'function') {
        window.projectManager.switchView(label);
        console.log(`[Gallery] Called projectManager.switchView(${label})`);
      } else if (window.switchToImage && typeof window.switchToImage === 'function') {
        // Fallback to legacy system
        window.switchToImage(label);
        console.log(`[Gallery] Called switchToImage(${label})`);
      } else {
        console.warn('[Gallery] No image switching function available');
      }
    }

    updateActiveImage(index);

    // Update image name/type inputs to match current image
    const nameInput = document.getElementById('imageNameInput');
    const typeSelect = document.getElementById('imageTypeSelect');
    const data = imageGalleryData[index];
    if (nameInput && data) nameInput.value = data.name || '';
    if (typeSelect && data && data.original && data.original.type)
      typeSelect.value = data.original.type;
    else if (typeSelect) typeSelect.value = '';
  }

  /**
   * Reorder images in the gallery
   */
  function reorderImages(fromIndex, toIndex) {
    console.log(`[Gallery] Reordering image from ${fromIndex} to ${toIndex}`);

    // Reorder the data array
    const movedImage = imageGalleryData.splice(fromIndex, 1)[0];
    imageGalleryData.splice(toIndex, 0, movedImage);

    // Rebuild the gallery UI
    rebuildGalleryUI();

    // Update active image index if needed
    if (currentImageIndex === fromIndex) {
      currentImageIndex = toIndex;
    } else if (currentImageIndex > fromIndex && currentImageIndex <= toIndex) {
      currentImageIndex--;
    } else if (currentImageIndex < fromIndex && currentImageIndex >= toIndex) {
      currentImageIndex++;
    }

    updateActiveImage(currentImageIndex);

    // Persist order for save/load consistency
    try {
      window.orderedImageLabels = imageGalleryData
        .map(item => item?.original?.label || item?.label || item?.name || '')
        .filter(Boolean);
    } catch (e) {
      console.warn('[Gallery] Failed to update orderedImageLabels after reorder:', e);
    }
  }

  /**
   * Rebuild the entire gallery UI after reordering
   */
  function rebuildGalleryUI() {
    const imageGallery = document.getElementById('imageGallery');
    const imageDots = document.getElementById('imageDots');

    if (!imageGallery || !imageDots) return;

    // Clear existing thumbnails and dots
    imageGallery.innerHTML = '';
    imageDots.innerHTML = '';

    // Rebuild with new order
    imageGalleryData.forEach((imageData, index) => {
      // Create thumbnail
      const thumbnail = document.createElement('div');
      thumbnail.className = 'image-thumbnail';
      thumbnail.dataset.imageIndex = index;
      thumbnail.dataset.label =
        imageData?.original?.label ||
        imageData?.label ||
        imageData?.name ||
        imageData?.filename ||
        '';
      thumbnail.style.backgroundImage = `url(${imageData.src})`;
      thumbnail.title = imageData.name;
      thumbnail.draggable = true;

      // Add hover controls (delete only)
      const controls = createThumbnailControls(index);
      controls.querySelectorAll('.rotate-btn, .flip-btn').forEach(el => el.remove());
      thumbnail.appendChild(controls);

      // Add all event listeners (click, drag, etc.)
      addThumbnailEventListeners(thumbnail, index);

      imageGallery.appendChild(thumbnail);

      // Create dot
      const dot = document.createElement('div');
      dot.className = 'nav-dot';
      dot.dataset.imageIndex = index;
      dot.addEventListener('click', () => navigateToImage(index));
      imageDots.appendChild(dot);

      // Observe for intersection
      if (intersectionObserver) {
        intersectionObserver.observe(thumbnail);
      }
    });

    updateGalleryControls();
  }

  /**
   * Create thumbnail control buttons (delete only)
   */
  function createThumbnailControls(index) {
    const controlsContainer = document.createElement('div');

    // Delete control (separate, top-left)
    const deleteControl = document.createElement('div');
    deleteControl.className = 'delete-control';

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'control-btn delete-btn';
    deleteBtn.innerHTML = '&times;';
    deleteBtn.setAttribute('aria-label', `Delete image ${index + 1}`);
    deleteBtn.title = 'Delete image';
    deleteBtn.addEventListener('click', e => {
      e.stopPropagation();
      deleteImage(index);
    });

    deleteControl.appendChild(deleteBtn);
    controlsContainer.appendChild(deleteControl);

    return controlsContainer;
  }

  /**
   * Helper function to add all event listeners to a thumbnail
   */
  function addThumbnailEventListeners(thumbnail, index) {
    // Click handler - switch to the image using ProjectManager
    thumbnail.addEventListener('click', () => {
      const imageData = imageGalleryData[index];
      if (imageData && imageData.original && imageData.original.label) {
        const label = imageData.original.label;
        console.log(`[Gallery] Thumbnail clicked, switching to label: ${label}`);

        // Use ProjectManager to switch views
        if (window.projectManager && typeof window.projectManager.switchView === 'function') {
          window.projectManager.switchView(label);
        } else {
          // Fallback to gallery navigation
          navigateToImage(index);
        }
      } else {
        // Fallback to gallery navigation if no label
        navigateToImage(index);
      }
    });

    // Drag and drop handlers
    thumbnail.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', index);
      thumbnail.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    thumbnail.addEventListener('dragend', () => {
      thumbnail.classList.remove('dragging');
      // Clear scroll interval when drag ends
      if (window.dragScrollInterval) {
        clearInterval(window.dragScrollInterval);
        window.dragScrollInterval = null;
      }
    });

    thumbnail.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      thumbnail.classList.add('drag-over');
    });

    thumbnail.addEventListener('dragleave', () => {
      thumbnail.classList.remove('drag-over');
    });

    thumbnail.addEventListener('drop', e => {
      e.preventDefault();
      thumbnail.classList.remove('drag-over');

      // Clear scroll interval when drop happens
      if (window.dragScrollInterval) {
        clearInterval(window.dragScrollInterval);
        window.dragScrollInterval = null;
      }

      const draggedIndex = parseInt(e.dataTransfer.getData('text/plain'));
      const targetIndex = index;

      if (draggedIndex !== targetIndex) {
        reorderImages(draggedIndex, targetIndex);
      }
    });
  }

  /**
   * Delete image function
   */
  function deleteImage(index) {
    if (confirm(`Delete "${imageGalleryData[index]?.name}"?`)) {
      console.log(`[Gallery] Deleting image at index ${index}`);

      // Remove from data array
      imageGalleryData.splice(index, 1);

      // Rebuild UI
      rebuildGalleryUI();

      // Adjust current index if needed
      if (currentImageIndex >= index) {
        currentImageIndex = Math.max(0, currentImageIndex - 1);
      }

      // Update active image
      if (imageGalleryData.length > 0) {
        updateActiveImage(Math.min(currentImageIndex, imageGalleryData.length - 1));
      }
    }
  }

  /**
   * Update active image highlighting
   */
  function updateActiveImage(index) {
    currentImageIndex = index;

    // Update thumbnail highlighting
    document.querySelectorAll('.image-thumbnail').forEach((thumb, idx) => {
      thumb.classList.toggle('active', idx === index);
    });

    // Update navigation dots
    document.querySelectorAll('.nav-dot').forEach((dot, idx) => {
      dot.classList.toggle('active', idx === index);
    });

    // Sync inputs to current image
    const data = imageGalleryData[index];
    const nameEl = document.getElementById('imageNameInput');
    const typeEl = document.getElementById('imageTypeSelect');
    if (nameEl && data) nameEl.value = data.name || '';
    if (typeEl && data && data.original) typeEl.value = data.original.type || '';

    updateGalleryControls();
  }

  /**
   * Sync gallery UI to a label without switching views
   */
  function syncToLabel(label, options = {}) {
    if (!label) return false;
    const imageGallery = document.getElementById('imageGallery');
    if (!imageGallery) return false;
    const index = imageGalleryData.findIndex(
      item => item?.original?.label === label || item?.label === label
    );
    if (index < 0) return false;

    // Suppress scroll-select while we realign the list to avoid auto-switch oscillation
    window.__suppressScrollSelectUntil = Date.now() + 1200;
    window.__imageListProgrammaticScrollUntil = Date.now() + 1200;

    updateActiveImage(index);

    if (options.scroll) {
      const targetThumbnail = imageGallery.querySelector(`[data-image-index="${index}"]`);
      if (targetThumbnail) {
        targetThumbnail.scrollIntoView({
          behavior: options.smooth === true ? 'smooth' : 'auto',
          block: 'nearest',
          inline: 'center',
        });
      }
    }
    return true;
  }

  /**
   * Update gallery controls and counters
   */
  function updateGalleryControls() {
    const prevButton = document.getElementById('prevImage');
    const nextButton = document.getElementById('nextImage');
    const imagePosition = document.getElementById('imagePosition');
    const imageCounter = document.getElementById('imageCounter');

    const totalImages = imageGalleryData.length;

    if (prevButton && nextButton) {
      prevButton.disabled = currentImageIndex <= 0;
      nextButton.disabled = currentImageIndex >= totalImages - 1;
    }

    if (imagePosition) {
      imagePosition.textContent = `${currentImageIndex + 1} / ${totalImages}`;
    }

    if (imageCounter) {
      imageCounter.textContent = totalImages > 0 ? `${totalImages} images` : '';
    }
  }

  /**
   * Clear image gallery
   */
  function clearImageGallery() {
    const imageGallery = document.getElementById('imageGallery');
    const imageDots = document.getElementById('imageDots');

    if (imageGallery) imageGallery.innerHTML = '';
    if (imageDots) imageDots.innerHTML = '';

    imageGalleryData = [];
    currentImageIndex = 0;
    updateGalleryControls();
  }

  /**
   * Helper to check if device is mobile
   */
  function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    );
  }

  // Expose public API
  window.imageGallery = {
    initialize: initializeImageGallery,
    addImage: addImageToGallery,
    navigateToImage: navigateToImage,
    clearGallery: clearImageGallery,
    syncToLabel: syncToLabel,
    getData: () => imageGalleryData,
    getCurrentIndex: () => currentImageIndex,
  };

  // Legacy compatibility
  window.addImageToGallery = addImageToGallery;
  window.addImageToGalleryCompat = function addImageToGalleryCompat(imageData) {
    const index = imageGalleryData.length;
    addImageToGallery(imageData, index);
  };

  // Auto-initialize on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeImageGallery);
  } else {
    initializeImageGallery();
  }

  // Reveal UI once initialization is complete
  document.documentElement.classList.remove('app-loading');
})();
