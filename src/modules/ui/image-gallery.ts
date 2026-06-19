/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-misused-promises, @typescript-eslint/prefer-regexp-exec, @typescript-eslint/unbound-method, prefer-rest-params */
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/**
 * Image Gallery Management Module
 * Handles horizontal scrolling image gallery with thumbnails, navigation, and image transformations
 * Single authoritative owner of the gallery + paint.js (addImageToSidebar) interop.
 */
export function initImageGalleryModule() {
  'use strict';

  // Gallery state (local closure; synced to window.imageGalleryData for external readers)
  let currentImageIndex = 0;
  let imageGalleryData = window.imageGalleryData || [];
  window.imageGalleryData = imageGalleryData;
  let intersectionObserver = null;
  const compareSelectedLabels = new Set();
  const compareStaticCanvases = [];
  let compareDragActive = false;

  function syncImageGalleryDataRef() {
    window.imageGalleryData = imageGalleryData;
  }

  /**
   * Initialize image gallery functionality
   */
  function initializeImageGallery() {
    const imageGallery = document.getElementById('imageGallery');

    if (!imageGallery) return;

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
      if (!document.getElementById('imagePanel')?.classList.contains('hidden')) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          navigateToImage(currentImageIndex - 1);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          navigateToImage(currentImageIndex + 1);
        }
      }
    });

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
    syncImageGalleryDataRef();
    syncCompareSelectionStyles();
    updateMultiViewStage();

    // Persist order for save/load consistency
    try {
      window.orderedImageLabels = imageGalleryData
        .map(item => item?.original?.label || item?.label || item?.name || '')
        .filter(Boolean);
    } catch (e) {
      console.warn('[Gallery] Failed to update orderedImageLabels after add:', e);
    }
    if (
      !window.__initialGallerySyncDone &&
      imageGalleryData.length === 1 &&
      !window.__isLoadingProject &&
      !window.__deferredImageHydrationInProgress
    ) {
      window.__initialGallerySyncDone = true;
      navigateToImage(0);
      console.log('[Gallery] Auto-selected first image');
    }

    // Trigger mini-stepper update if function exists
    if (typeof window.updatePills === 'function') {
      setTimeout(() => {
        try {
          window.updatePills();
          console.log('[Gallery] Updated mini-stepper pills');
        } catch (e) {
          console.warn('[Gallery] Error updating pills:', e);
        }
      }, 100);
    }
    if (typeof window.updateActivePill === 'function') {
      setTimeout(() => {
        try {
          window.updateActivePill();
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

    syncCompareSelectionStyles();
    updateMultiViewStage();
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
    thumbnail.addEventListener('click', event => {
      if (event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        toggleCompareSelection(index);
        return;
      }
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

    thumbnail.addEventListener('mousedown', event => {
      if (!event.shiftKey || event.button !== 0) return;
      compareDragActive = true;
      toggleCompareSelection(index, true);
    });

    thumbnail.addEventListener('mouseenter', event => {
      if (!compareDragActive || !event.shiftKey) return;
      toggleCompareSelection(index, true);
    });

    // Drag and drop handlers
    thumbnail.addEventListener('dragstart', e => {
      if (e.shiftKey) {
        e.preventDefault();
        return;
      }
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

  function getImageLabelAtIndex(index) {
    const imageData = imageGalleryData[index];
    return (
      imageData?.original?.label || imageData?.label || imageData?.name || imageData?.filename || ''
    );
  }

  function toggleCompareSelectionByLabel(label, forceSelected) {
    if (!label) return;
    const shouldSelect =
      typeof forceSelected === 'boolean' ? forceSelected : !compareSelectedLabels.has(label);
    if (shouldSelect) {
      if (!compareSelectedLabels.has(label) && compareSelectedLabels.size >= 4) {
        const oldest = compareSelectedLabels.values().next().value;
        compareSelectedLabels.delete(oldest);
      }
      compareSelectedLabels.add(label);
    } else {
      compareSelectedLabels.delete(label);
    }
    syncCompareSelectionStyles();
    updateMultiViewStage();
  }

  function toggleCompareSelection(index, forceSelected) {
    const label = getImageLabelAtIndex(index);
    if (!label) return;
    toggleCompareSelectionByLabel(label, forceSelected);
  }

  function clearCompareSelection() {
    compareSelectedLabels.clear();
    syncCompareSelectionStyles();
    updateMultiViewStage();
  }

  // Attach a compare toggle to a visible .image-container card in #imageList.
  // (The app runs in vertical-list mode; #imageGallery/.image-thumbnail is hidden.)
  function ensureContainerCompareToggle(container) {
    if (!container) return;
    const label = container.dataset.label;
    if (!label) return;
    let toggle = container.querySelector('.thumbnail-compare-toggle');
    if (!toggle) {
      toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'thumbnail-compare-toggle';
      toggle.textContent = '+';
      toggle.title = 'Add to comparison';
      toggle.setAttribute('aria-label', `Compare image ${label}`);
      toggle.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        toggleCompareSelectionByLabel(label);
      });
      container.appendChild(toggle);
    }
    toggle.dataset.compareLabel = label;
  }

  // Visible thumbnails are created asynchronously by paint.js (addImageToSidebar),
  // the hook fallback, and project loads. Watch #imageList so every .image-container
  // gets a toggle regardless of who created it.
  function watchImageListForCompareToggles() {
    const imageList = document.getElementById('imageList');
    if (!imageList || imageList.dataset.compareWatcher === '1') return;
    imageList.dataset.compareWatcher = '1';
    const ensureAll = () => {
      imageList.querySelectorAll('.image-container').forEach(ensureContainerCompareToggle);
      syncCompareSelectionStyles();
    };
    ensureAll();
    const observer = new MutationObserver(ensureAll);
    observer.observe(imageList, { childList: true, subtree: false });
  }

  function syncCompareSelectionStyles() {
    document.querySelectorAll('.image-thumbnail, .image-container').forEach(thumb => {
      const label = thumb.dataset.label || getImageLabelAtIndex(Number(thumb.dataset.imageIndex));
      const selected = Boolean(label && compareSelectedLabels.has(label));
      thumb.classList.toggle('compare-selected', selected);
      const toggle = thumb.querySelector('.thumbnail-compare-toggle');
      if (toggle) {
        toggle.textContent = selected ? '✓' : '+';
        toggle.title = selected ? 'Remove from comparison' : 'Add to comparison';
        toggle.setAttribute('aria-pressed', String(selected));
      }
    });
    const deselectBtn = document.getElementById('compareDeselectAll');
    if (deselectBtn) {
      const hasSelection = compareSelectedLabels.size > 0;
      deselectBtn.style.display = hasSelection ? 'inline-flex' : 'none';
    }
  }

  function wireCompareDeselectButton() {
    const btn = document.getElementById('compareDeselectAll');
    if (!btn || btn.dataset.wired === '1') return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', () => {
      clearCompareSelection();
    });
  }

  function disposeCompareCanvases() {
    while (compareStaticCanvases.length) {
      const canvas = compareStaticCanvases.pop();
      try {
        canvas?.dispose?.();
      } catch (error) {
        console.warn('[MultiView] Failed to dispose compare canvas', error);
      }
    }
  }

  function getCompareStage() {
    let stage = document.getElementById('multiViewStage');
    const wrapper = document.getElementById('main-canvas-wrapper');
    if (!stage && wrapper) {
      stage = document.createElement('div');
      stage.id = 'multiViewStage';
      stage.setAttribute('aria-label', 'Image comparison view');
      wrapper.appendChild(stage);
    }
    return stage;
  }

  // The stroke/image panels are position:fixed overlays; #main-canvas-wrapper
  // spans the full width, so the stage must be inset to sit BETWEEN them.
  function applyMultiViewStageInsets() {
    const stage = document.getElementById('multiViewStage');
    if (!stage) return;
    const leftPanel = document.getElementById('strokePanel');
    const rightPanel = document.getElementById('imagePanel');
    const leftInset = leftPanel ? Math.max(0, leftPanel.offsetWidth) : 0;
    const rightInset = rightPanel ? Math.max(0, rightPanel.offsetWidth) : 0;
    stage.style.left = `${leftInset}px`;
    stage.style.right = `${rightInset}px`;
  }

  function getViewForLabel(label) {
    return (
      window.projectManager?.views?.[label] || window.app?.projectManager?.views?.[label] || null
    );
  }

  function cloneCanvasData(data) {
    if (!data || typeof data !== 'object') return null;
    try {
      return JSON.parse(JSON.stringify(data));
    } catch {
      return null;
    }
  }

  function fitStaticCanvasToContent(staticCanvas) {
    const bounds = [];
    const background = staticCanvas.backgroundImage;
    if (background?.getBoundingRect) {
      bounds.push(background.getBoundingRect(true, true));
    }
    staticCanvas.getObjects().forEach(obj => {
      if (!obj?.visible || obj?.isCurveDrawingMarker || obj?.isMosCurveArrowDecorator) return;
      if (obj.getBoundingRect) bounds.push(obj.getBoundingRect(true, true));
    });
    if (!bounds.length) return;

    const left = Math.min(...bounds.map(rect => rect.left));
    const top = Math.min(...bounds.map(rect => rect.top));
    const right = Math.max(...bounds.map(rect => rect.left + rect.width));
    const bottom = Math.max(...bounds.map(rect => rect.top + rect.height));
    const width = Math.max(1, right - left);
    const height = Math.max(1, bottom - top);
    const canvasWidth = Math.max(1, Number(staticCanvas.width) || 1);
    const canvasHeight = Math.max(1, Number(staticCanvas.height) || 1);
    const padding = 4;
    const scale = Math.min(
      (canvasWidth - padding * 2) / width,
      (canvasHeight - padding * 2) / height,
      8
    );
    const zoom = Number.isFinite(scale) && scale > 0 ? scale : 1;
    const panX = (canvasWidth - width * zoom) / 2 - left * zoom;
    const panY = (canvasHeight - height * zoom) / 2 - top * zoom;
    staticCanvas.setViewportTransform([zoom, 0, 0, zoom, panX, panY]);
    staticCanvas.requestRenderAll();
  }

  function loadImageAsBackground(staticCanvas, src, savedPlacement) {
    return new Promise(resolve => {
      if (!src || !window.fabric?.Image?.fromURL) {
        resolve();
        return;
      }
      window.fabric.Image.fromURL(
        src,
        img => {
          if (!img) {
            resolve();
            return;
          }
          if (
            savedPlacement &&
            Number.isFinite(savedPlacement.left) &&
            Number.isFinite(savedPlacement.scaleX)
          ) {
            img.set({
              left: savedPlacement.left,
              top: savedPlacement.top,
              originX: savedPlacement.originX || 'left',
              originY: savedPlacement.originY || 'top',
              scaleX: savedPlacement.scaleX,
              scaleY: savedPlacement.scaleY,
              angle: savedPlacement.angle || 0,
              flipX: savedPlacement.flipX || false,
              flipY: savedPlacement.flipY || false,
            });
          } else {
            img.set({
              originX: 'center',
              originY: 'center',
              left: staticCanvas.width / 2,
              top: staticCanvas.height / 2,
            });
            const scale = Math.min(
              staticCanvas.width / (img.width || 1),
              staticCanvas.height / (img.height || 1)
            );
            img.scale(Number.isFinite(scale) && scale > 0 ? scale : 1);
          }
          staticCanvas.setBackgroundImage(img, () => {
            staticCanvas.requestRenderAll();
            resolve();
          });
        },
        { crossOrigin: 'anonymous' }
      );
    });
  }

  async function renderComparePane(pane, label) {
    const wrap = pane.querySelector('.multiview-canvas-wrap');
    const canvasEl = pane.querySelector('canvas');
    if (!wrap || !canvasEl || !window.fabric?.StaticCanvas) return;

    const rect = wrap.getBoundingClientRect();
    const width = Math.max(240, Math.floor(rect.width || 240));
    const height = Math.max(180, Math.floor(rect.height || 180));
    canvasEl.width = width;
    canvasEl.height = height;

    const staticCanvas = new window.fabric.StaticCanvas(canvasEl, {
      width,
      height,
      selection: false,
      backgroundColor: '#ffffff',
      renderOnAddRemove: false,
    });
    compareStaticCanvases.push(staticCanvas);
    pane.__staticCanvas = staticCanvas;

    const view = getViewForLabel(label);
    const canvasData = cloneCanvasData(view?.canvasData || view?.canvasJSON || null);
    // Extract saved background placement before filtering — non-current views
    // have their backgroundImage stripped during switchView, but the placement
    // data (left/top/scaleX/scaleY) is needed to align the fallback image
    // with the stroke objects.
    const savedBg = canvasData?.backgroundImage;
    // Keep strokes/measurements visible: only drop known pure-UI chrome that
    // would never belong in a read-only comparison snapshot.
    if (canvasData?.objects) {
      canvasData.objects = canvasData.objects.filter(
        obj => !obj?.isCurveDrawingMarker && !obj?.isMosCurveArrowDecorator
      );
    }

    await new Promise(resolve => {
      if (!canvasData) {
        resolve();
        return;
      }
      staticCanvas.loadFromJSON(canvasData, () => resolve());
    });

    if (!staticCanvas.backgroundImage && view?.image) {
      await loadImageAsBackground(staticCanvas, view.image, savedBg);
    }

    staticCanvas.getObjects().forEach(obj => {
      obj.set({
        selectable: false,
        evented: false,
      });
      if (obj.strokeMetadata?.visible === false) {
        obj.visible = false;
      }
      // Re-attach arrow rendering — the custom _render override is lost
      // during JSON serialization so arrows won't draw without this.
      if (obj.arrowSettings && window.app?.arrowManager) {
        try {
          window.app.arrowManager.attachArrowRendering(obj);
        } catch {
          // Arrow rendering is best-effort for snapshots
        }
      }
    });

    fitStaticCanvasToContent(staticCanvas);
    staticCanvas.renderOnAddRemove = true;
    staticCanvas.requestRenderAll();
  }

  function updateMultiViewStage() {
    const stage = getCompareStage();
    if (!stage) return;
    const labels = Array.from(compareSelectedLabels).filter(label =>
      Boolean(getViewForLabel(label))
    );
    const active = labels.length >= 2;
    document.body.classList.toggle('multiview-active', active);
    disposeCompareCanvases();

    if (!active) {
      stage.innerHTML = '';
      return;
    }

    // Place the stage between the fixed sidebars before measuring/rendering.
    applyMultiViewStageInsets();

    // Persist the current view so its latest strokes are in canvasData.
    try {
      window.app?.projectManager?.saveCurrentViewState?.();
    } catch (error) {
      console.warn('[MultiView] saveCurrentViewState failed', error);
    }

    const count = Math.min(labels.length, 4);
    stage.innerHTML = `
      <div class="multiview-actions">
        <button type="button" class="mv-btn mv-close" title="Close comparison" aria-label="Close comparison">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="multiview-grid count-${count}">
        ${labels
          .slice(0, 4)
          .map(
            label => `
              <section class="multiview-pane" data-compare-label="${label}">
                <div class="multiview-canvas-wrap"><canvas></canvas></div>
              </section>
            `
          )
          .join('')}
      </div>
    `;

    requestAnimationFrame(() => {
      stage.querySelectorAll('.multiview-pane').forEach(pane => {
        renderComparePane(pane, pane.dataset.compareLabel).catch(error => {
          console.warn('[MultiView] Failed to render pane', error);
        });
      });
      wireMultiViewActions(stage);
    });
  }

  function wireMultiViewActions(stage) {
    const closeBtn = stage.querySelector('.mv-close');
    if (closeBtn && closeBtn.dataset.wired !== '1') {
      closeBtn.dataset.wired = '1';
      closeBtn.addEventListener('click', () => clearCompareSelection());
    }
  }

  async function captureCompareGrid() {
    const stage = document.getElementById('multiViewStage');
    if (!stage) return;
    const panes = Array.from(stage.querySelectorAll('.multiview-pane'));
    if (!panes.length) return;

    const stageRect = stage.getBoundingClientRect();

    const out = document.createElement('canvas');
    const dpr = window.devicePixelRatio || 1;
    out.width = Math.max(1, Math.round(stageRect.width * dpr));
    out.height = Math.max(1, Math.round(stageRect.height * dpr));
    const ctx = out.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);

    for (const pane of panes) {
      const paneRect = pane.getBoundingClientRect();
      const source = pane.querySelector('canvas');
      if (!source || source.width === 0 || source.height === 0) continue;

      const dx = Math.round((paneRect.left - stageRect.left) * dpr);
      const dy = Math.round((paneRect.top - stageRect.top) * dpr);
      const dw = Math.round(paneRect.width * dpr);
      const dh = Math.round(paneRect.height * dpr);
      ctx.drawImage(source, 0, 0, source.width, source.height, dx, dy, dw, dh);
    }

    const blobPromise = new Promise(resolve => {
      out.toBlob(b => resolve(b), 'image/png');
    });

    const ClipboardItemConstructor = window.ClipboardItem;
    if (navigator.clipboard && ClipboardItemConstructor) {
      try {
        await navigator.clipboard.write([
          new ClipboardItemConstructor({
            'image/png': blobPromise,
          }),
        ]);
        window.app?.projectManager?.showStatusMessage?.(
          'Comparison copied to clipboard!',
          'success'
        );
      } catch {
        const blob = await blobPromise;
        if (blob) {
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.download = `comparison-${Date.now()}.png`;
          link.href = url;
          link.click();
          URL.revokeObjectURL(url);
        }
      }
    } else {
      const blob = await blobPromise;
      if (blob) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = `comparison-${Date.now()}.png`;
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);
      }
    }
  }

  /**
   * Delete image function
   */
  function deleteImage(index) {
    if (confirm(`Delete "${imageGalleryData[index]?.name}"?`)) {
      console.log(`[Gallery] Deleting image at index ${index}`);
      const deletedLabel = getImageLabelAtIndex(index);

      // Remove from data array
      imageGalleryData.splice(index, 1);
      if (deletedLabel) {
        compareSelectedLabels.delete(deletedLabel);
      }

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
      syncCompareSelectionStyles();
      updateMultiViewStage();
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
    syncCompareSelectionStyles();

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

    updateMultiViewStage();
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

    updateActiveImage(index);

    if (options.scroll) {
      // Suppress scroll-select while we realign the list to avoid auto-switch oscillation.
      // Use short suppression for instant scrolls to allow rapid sequential switching.
      const suppressMs = options.smooth === true ? 400 : 80;
      window.__suppressScrollSelectUntil = Date.now() + suppressMs;
      window.__imageListProgrammaticScrollUntil = Date.now() + suppressMs;
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
   * Clear image gallery
   */
  function clearImageGallery() {
    const imageGallery = document.getElementById('imageGallery');
    const imageDots = document.getElementById('imageDots');

    if (imageGallery) imageGallery.innerHTML = '';
    if (imageDots) imageDots.innerHTML = '';

    imageGalleryData = [];
    window.orderedImageLabels = [];
    currentImageIndex = 0;
    clearCompareSelection();
    syncImageGalleryDataRef();
  }

  /**
   * Helper to check if device is mobile
   */
  function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    );
  }

  function installImageGalleryGlobals() {
    syncImageGalleryDataRef();
    window.imageGallery = {
      addImage: addImageToGallery,
      clearGallery: clearImageGallery,
      syncToLabel: syncToLabel,
      getData: () => imageGalleryData,
      syncLegacyImages: syncLegacyImagesToGallery,
      captureCompareGrid,
    };
    window.addImageToGallery = addImageToGallery;
    window.addImageToGalleryCompat = function addImageToGalleryCompat(imageData) {
      const label = imageData?.original?.label || imageData?.label || imageData?.name || '';
      const existingIndex = imageGalleryData.findIndex(item => {
        const existingLabel = item?.original?.label || item?.label || item?.name || '';
        return Boolean(label) && existingLabel === label;
      });
      const index = existingIndex >= 0 ? existingIndex : imageGalleryData.length;
      addImageToGallery(imageData, index);
    };
  }

  function ensureLegacyImageContainer(imageUrl, label) {
    const imageList = document.getElementById('imageList');
    if (!imageList) {
      console.error('[COMPAT] imageList element not found!');
      return false;
    }
    if (!imageUrl || !label) {
      console.warn('[COMPAT] Missing imageUrl or label for legacy container');
      return false;
    }

    const existing = imageList.querySelector(`[data-label="${label}"]`);
    if (existing) return true;

    const container = document.createElement('button');
    container.type = 'button';
    container.draggable = true;
    container.className =
      'image-container group w-full text-left relative flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 transition-colors snap-center';
    container.dataset.label = label;
    container.dataset.originalImageUrl = imageUrl;

    const img = document.createElement('img');
    img.src = imageUrl;
    img.className = 'pasted-image w-full h-40 rounded-lg object-contain bg-slate-100 shadow-sm';
    img.alt = `${label} view`;
    container.appendChild(img);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-image-btn opacity-0 group-hover:opacity-100 transition-opacity';
    deleteBtn.title = 'Delete image';
    deleteBtn.textContent = '×';
    deleteBtn.style.cssText =
      'position: absolute; top: 6px; right: 6px; cursor: pointer; background: rgba(255, 255, 255, 0.9); border: 1px solid rgb(204, 204, 204); border-radius: 50%; width: 20px; height: 20px; font-size: 12px; font-weight: bold; font-family: Arial, sans-serif; display: flex; align-items: center; justify-content: center; z-index: 10; color: rgb(102, 102, 102); line-height: 1; padding: 0px; margin: 0px; text-align: center;';
    deleteBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (confirm('Delete this image?')) {
        container.remove();
        if (window.projectManager && typeof window.projectManager.deleteImage === 'function') {
          window.projectManager.deleteImage(label);
        }
        if (typeof window.updatePills === 'function') window.updatePills();
        if (typeof window.updateActivePill === 'function') window.updateActivePill();
        if (typeof updateImageListPadding === 'function') updateImageListPadding();
      }
    });
    container.appendChild(deleteBtn);

    container.onclick = () => {
      if (window.projectManager && typeof window.projectManager.switchView === 'function') {
        window.projectManager.switchView(label);
      }
      container.setAttribute('aria-selected', 'true');
      container.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      if (!window.__scrollSelectDrivenSwitch) {
        window.__imageListProgrammaticScrollUntil = Date.now() + 400;
      }
    };
    imageList.appendChild(container);
    console.log(`[COMPAT] Manually added legacy container for "${label}"`);

    const knownRotation = Number(window.projectManager?.views?.[label]?.rotation);
    if (window.projectManager?.updateThumbnailRotation) {
      window.projectManager.updateThumbnailRotation(
        label,
        Number.isFinite(knownRotation) ? knownRotation : 0
      );
    }
    if (typeof window.ensureImageListObserver === 'function') {
      window.ensureImageListObserver();
    } else {
      window.__pendingImageListObserverInit = true;
    }
    if (typeof updateImageListPadding === 'function') updateImageListPadding();
    if (typeof initImageListCenteringObserver === 'function') {
      if (!window.__imageListCenteringObserver) initImageListCenteringObserver();
      if (window.__imageListCenteringObserver) {
        window.__imageListCenteringObserver.observe(container);
      }
    }

    setTimeout(() => {
      const allContainers = Array.from(imageList.querySelectorAll('.image-container'));
      const isFirst = allContainers.length === 1 && allContainers[0] === container;
      if (isFirst && !window.__isLoadingProject && !window.__deferredImageHydrationInProgress) {
        console.log(`[COMPAT] First image "${label}" added, centering and switching to it`);
        window.__suppressScrollSelectUntil = Date.now() + 400;
        window.__imageListProgrammaticScrollUntil = Date.now() + 400;
        container.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        if (
          window.projectManager &&
          typeof window.projectManager.switchView === 'function' &&
          window.projectManager.currentViewId === label
        ) {
          window.projectManager.switchView(label);
        }
      }
      if (typeof window.updatePills === 'function') window.updatePills();
      if (typeof window.updateActivePill === 'function') window.updateActivePill();
    }, 100);

    return true;
  }

  // Compat addImageToSidebar: bridges paint.js/legacy callers into the gallery +
  // #imageList. Replaced by the [HOOK] wrapper once paint.js defines its own.
  function installCompatAddImageToSidebar() {
    window.addImageToSidebar = function (imageUrl, label, filename) {
      console.log('[COMPAT] addImageToSidebar called with:', {
        imageUrl: imageUrl?.substring?.(0, 50) || imageUrl,
        label,
        filename,
      });

      ensureLegacyImageContainer(imageUrl, label);

      if (label && imageUrl) {
        window.originalImages = window.originalImages || {};
        window.originalImages[label] = imageUrl;
        if (!window.originalImageDimensions) window.originalImageDimensions = {};
        if (!window.originalImageDimensions[label]) {
          const dimImg = new Image();
          dimImg.onload = () => {
            window.originalImageDimensions[label] = { width: dimImg.width, height: dimImg.height };
          };
          dimImg.onerror = () => {
            window.originalImageDimensions[label] = { width: 0, height: 0 };
          };
          dimImg.src = imageUrl;
        }
        if (window.projectManager?.views?.[label]) {
          window.projectManager.views[label].image = imageUrl;
        }
        if (window.projectManager?.updateThumbnailRotation) {
          const knownRotation = Number(window.projectManager?.views?.[label]?.rotation);
          window.projectManager.updateThumbnailRotation(
            label,
            Number.isFinite(knownRotation) ? knownRotation : 0
          );
        }
      }

      if (imageUrl) {
        const alreadyExists = imageGalleryData.some(
          img =>
            img &&
            (img.original?.label === label ||
              img.label === label ||
              (img.src === imageUrl &&
                (img.name === filename ||
                  img.name === label ||
                  img.original?.filename === filename)))
        );
        if (!alreadyExists) {
          const index = imageGalleryData.length;
          const imageData = {
            src: imageUrl,
            url: imageUrl,
            name: filename || label || `Image ${index + 1}`,
            label: label,
            filename: filename,
          };
          addImageToGallery(imageData, index);
          if (
            label &&
            window.projectManager &&
            window.projectManager.currentViewId === label &&
            typeof window.projectManager.setBackgroundImage === 'function' &&
            !window.__isLoadingProject &&
            !window.__deferredImageHydrationInProgress
          ) {
            requestAnimationFrame(() => {
              window.projectManager.setBackgroundImage(imageUrl);
            });
          }
          if (
            imageGalleryData.length === 1 &&
            label &&
            window.projectManager &&
            typeof window.projectManager.switchView === 'function' &&
            !window.__isLoadingProject &&
            !window.__deferredImageHydrationInProgress
          ) {
            setTimeout(() => {
              if (window.projectManager.currentViewId === label) {
                window.__suppressScrollSelectUntil = Date.now() + 1200;
                window.projectManager.switchView(label, true);
              }
            }, 0);
          }
          return index;
        }
        return -1;
      }
      return -1;
    };
    window.addImageToSidebar.__isCompat = true;

    window.switchToImage = function (imageIndexOrLabel) {
      if (typeof imageIndexOrLabel === 'number') {
        navigateToImage(imageIndexOrLabel);
        return;
      }
      if (typeof imageIndexOrLabel === 'string') {
        const trimmed = imageIndexOrLabel.trim();
        const asNumber = Number(trimmed);
        if (trimmed !== '' && Number.isFinite(asNumber)) {
          navigateToImage(Math.trunc(asNumber));
          return;
        }
        if (window.projectManager && typeof window.projectManager.switchView === 'function') {
          window.projectManager.switchView(trimmed);
        } else if (window.switchToImageLegacy && typeof window.switchToImageLegacy === 'function') {
          window.switchToImageLegacy(trimmed);
        }
      }
    };

    window.updateImageList = function () {
      console.log('[COMPAT] updateImageList called - handled by gallery system');
    };

    window.clearImageSidebar = function () {
      clearImageGallery();
    };
  }

  function installDebugHelpers() {
    window.debugPaintState = function () {
      console.log('=== PAINT.JS STATE DEBUG ===');
      if (window.paintApp && window.paintApp.state) {
        console.log('Current image label:', window.paintApp.state.currentImageLabel);
      }
      if (window.vectorStrokesByImage) {
        const labels = Object.keys(window.vectorStrokesByImage);
        console.log('vectorStrokesByImage labels:', labels);
      }
      console.log('imageGalleryData length:', imageGalleryData.length);
      console.log('currentImageIndex:', currentImageIndex);
    };

    window.addTestTriangle = function () {
      let targetLabel = 'blank_canvas';
      if (imageGalleryData[currentImageIndex]?.original?.label) {
        targetLabel = imageGalleryData[currentImageIndex].original.label;
      }
      const mockStroke = {
        points: [
          { x: 300, y: 200 },
          { x: 200, y: 400 },
          { x: 400, y: 400 },
          { x: 300, y: 200 },
        ],
        color: '#ff0000',
        thickness: 3,
        type: 'freehand',
      };
      if (window.vectorStrokesByImage) {
        if (!window.vectorStrokesByImage[targetLabel])
          window.vectorStrokesByImage[targetLabel] = {};
        window.vectorStrokesByImage[targetLabel]['test_triangle'] = mockStroke;
      }
      if (window.redrawCanvasWithVisibility) window.redrawCanvasWithVisibility();
    };
  }

  function syncLegacyImagesToGallery() {
    if (window.__isLoadingProject || window.__deferredImageHydrationInProgress) return;
    const imageList = document.getElementById('imageList');
    if (!imageList) return;
    const imageContainers = imageList.querySelectorAll('.image-container');
    imageContainers.forEach((container, index) => {
      const img = container.querySelector('img');
      const label = container.dataset.label;
      if (img && img.src) {
        const imageData = {
          src: img.src,
          url: img.src,
          name:
            container.querySelector('.image-label')?.textContent || label || `Image ${index + 1}`,
          label: label,
        };
        const existingIndex = imageGalleryData.findIndex(item => {
          const existingLabel = item?.original?.label || item?.label || item?.name;
          return (label && existingLabel === label) || item?.src === img.src;
        });
        if (existingIndex === -1) {
          addImageToGallery(imageData, imageGalleryData.length);
        }
      }
    });
    if (typeof updateImageListPadding === 'function') updateImageListPadding();
  }

  function clearDemoImages() {
    imageGalleryData = imageGalleryData.filter(
      item => !item.name?.includes('Demo Image') && !item.name?.includes('Blank Canvas')
    );
    syncImageGalleryDataRef();
    const counter = document.getElementById('imageCounter');
    if (counter) {
      counter.textContent = imageGalleryData.length > 0 ? `${imageGalleryData.length} images` : '';
    }
  }

  // ── Init sequence ──
  initializeImageGallery();
  installImageGalleryGlobals();
  installCompatAddImageToSidebar();
  installDebugHelpers();
  setTimeout(() => {
    syncLegacyImagesToGallery();
    const imageList = document.getElementById('imageList');
    if (imageList && imageList.querySelectorAll('.image-container').length > 0) {
      if (typeof initImageListCenteringObserver === 'function') initImageListCenteringObserver();
    }
  }, 0);
  setTimeout(watchImageListForCompareToggles, 0);
  wireCompareDeselectButton();
  document.documentElement.classList.remove('app-loading');
  console.log('[Gallery] image-gallery module initialized (single owner)');
}
