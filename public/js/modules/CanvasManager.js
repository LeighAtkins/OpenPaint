// Canvas Manager
// Handles Fabric.js canvas initialization, resizing, zoom/pan

export class CanvasManager {
  constructor(canvasId) {
    this.canvasId = canvasId;
    this.fabricCanvas = null;

    // Resize state
    this.pendingResizeFrame = null;
    this.pendingResizeWidth = null;
    this.pendingResizeHeight = null;
    this.lastCanvasSize = { width: 0, height: 0 };

    // Resize overlay for smooth transitions
    this.resizeOverlayCanvas = null;
    this.resizeOverlayCleanupId = null;

    // Store capture frame in image-relative coordinates to prevent drift
    // These are ratios (0-1) of the background image dimensions
    this.captureFrameImageRatios = null;

    // Debounce stroke scaling to prevent glitches from rapid resizes
    this.strokeScalingTimeout = null;
    this.pendingStrokeScale = null;
    this.lastResizeTime = null;
    this.consecutiveResizeCount = 0;
    this.isResizing = false;
    this.originalCanvasSize = { width: 0, height: 0 };
    this.originalObjectStates = new Map();
  }

  init() {
    // fabric is loaded globally via CDN in index.html
    if (typeof fabric === 'undefined') {
      console.error('Fabric.js library not found!');
      return;
    }

    // Ensure canvas element exists
    const canvasEl = document.getElementById(this.canvasId);
    if (!canvasEl) {
      console.error(`Canvas element with id "${this.canvasId}" not found!`);
      return;
    }

    // Calculate initial dimensions (same logic as resize to prevent warping)
    const availableSize = this.calculateAvailableSize();
    const width = availableSize.width;
    const height = availableSize.height;

    console.log(`[CanvasManager] Initializing with size: ${width}x${height}`);

    this.fabricCanvas = new fabric.Canvas(this.canvasId, {
      width: width,
      height: height,
      isDrawingMode: false, // Managed by ToolManager
      selection: true,
      preserveObjectStacking: true,
      backgroundColor: '#ffffff', // Default white background
    });

    // Store initial size
    this.lastCanvasSize = { width, height };

    // Selection state is managed by tools (SelectTool enables, drawing tools disable as needed)
    // Don't set a default here - let tools control it

    this.fabricCanvas.on('mouse:down', opt => {
      const evt = opt.e;
      // Check if Ctrl key is pressed (or Meta key for Mac)
      if (evt.ctrlKey || evt.metaKey) {
        this.fabricCanvas.selection = true;
        // If we are in drawing mode, we might need to temporarily disable it?
        // Fabric handles this: if isDrawingMode is true, selection is disabled.
        // So we need to temporarily disable drawing mode if it's on.
        if (this.fabricCanvas.isDrawingMode) {
          this.fabricCanvas.isDrawingMode = false;
          this.fabricCanvas._tempDrawingMode = true; // Flag to restore later
        }
      } else {
        // If not Ctrl, ensure selection is false unless we are in Select tool
        // We need to check the active tool.
        // Accessing ToolManager from here is tricky.
        // Better: ToolManager sets selection=true/false.
        // But for the shortcut, we override.
        // If we are NOT in select tool (which sets selection=true), disable selection
        // We can check isDrawingMode.
        // If isDrawingMode is false, we might be in Select tool OR just idle.
        // Let's assume ToolManager manages the default state.
        // We only want to ENABLE it if Ctrl is pressed.
        // Actually, the requirement is "Add a shortcut to 'select' by ctrl + click dragging".
        // This implies that normally (without Ctrl), we are drawing.
        // So we just need to enable selection when Ctrl is down.
      }
    });

    this.fabricCanvas.on('mouse:up', opt => {
      // Restore state if we changed it
      if (this.fabricCanvas._tempDrawingMode) {
        this.fabricCanvas.isDrawingMode = true;
        this.fabricCanvas.selection = false;
        delete this.fabricCanvas._tempDrawingMode;
      } else if (!this.fabricCanvas.isDrawingMode) {
        // If we were not in drawing mode, check if we should disable selection
        // If the active tool is NOT select, we should probably disable selection?
        // But we don't know the active tool here easily.
        // Let's just rely on the key up event?
        // Mouse up is safer for the drag operation end.
        // If we enabled selection just for this drag, disable it now?
        // But standard behavior is: hold Ctrl to select.
        // If I release mouse but keep Ctrl, I should still be able to select?
        // Fabric updates selection property dynamically? No.
      }
    });

    console.log(`Fabric Canvas initialized: ${width}x${height}`);

    // Set original canvas size after initialization
    this.originalCanvasSize = { width: width, height: height };

    // Initialize zoom/pan events
    this.initZoomPan();

    // Initialize keyboard shortcuts
    this.initKeyboardShortcuts();

    // Listen for path creation (freehand drawing) to attach metadata and save history
    this.fabricCanvas.on('path:created', e => {
      const path = e.path;
      if (path) {
        // Make path selectable for moving/deleting
        path.set({
          selectable: true,
          evented: true,
        });

        if (window.app && window.app.metadataManager && window.app.projectManager) {
          // Attach metadata (label) to the path
          const imageLabel = window.app.projectManager.currentViewId || 'front';

          // Set currentImageLabel for tag prediction system
          window.currentImageLabel = imageLabel;

          const strokeLabel = window.app.metadataManager.getNextLabel(imageLabel);
          window.app.metadataManager.attachMetadata(path, imageLabel, strokeLabel);
          console.log(`Freehand path created with label: ${strokeLabel}`);

          // Create tag for the stroke
          if (window.app.tagManager) {
            setTimeout(() => {
              window.app.tagManager.createTagForStroke(strokeLabel, imageLabel, path);
            }, 100);
          }

          // Small delay to ensure path is fully created before saving history
          setTimeout(() => {
            if (window.app && window.app.historyManager) {
              window.app.historyManager.saveState();
            }
          }, 50);
        }
      }
    });

    // Listen for object removal to update stroke list
    this.fabricCanvas.on('object:removed', e => {
      const obj = e.target;
      if (obj && window.app && window.app.metadataManager) {
        // We need to check if this object has metadata and remove it
        // Or simply refresh the list.
        // Since metadata is attached to the object, if the object is gone,
        // we should probably remove it from our tracking or at least update the UI.

        // However, StrokeMetadataManager tracks strokes by image label.
        // If we delete an object, we should probably remove it from the manager too.
        // But the manager usually iterates over canvas objects to build the list.
        // So calling updateStrokeVisibilityControls() should be enough if it re-scans.

        // Let's check updateStrokeVisibilityControls implementation.
        // It iterates over canvas objects. So refreshing is correct.

        // Debounce the update to avoid multiple refreshes when deleting multiple objects
        if (this._updateTimeout) clearTimeout(this._updateTimeout);
        this._updateTimeout = setTimeout(() => {
          window.app.metadataManager.updateStrokeVisibilityControls();
        }, 50);
      }
    });

    // Ensure canvas is visible
    canvasEl.style.display = 'block';
  }

  initKeyboardShortcuts() {
    // Delete key handler
    document.addEventListener('keydown', e => {
      // Don't delete if typing in an input
      // Don't delete if typing in an input
      const isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
      const isContentEditable = e.target.isContentEditable;

      if (isInput || isContentEditable) {
        return;
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && this.fabricCanvas) {
        const activeObjects = this.fabricCanvas.getActiveObjects();
        console.log(`[Delete] Key pressed, found ${activeObjects.length} active objects`);
        console.log(`[Delete] canvas.selection = ${this.fabricCanvas.selection}`);

        if (activeObjects.length > 0) {
          e.preventDefault();
          activeObjects.forEach(obj => {
            // Clean up stroke metadata before removing from canvas
            if (obj.strokeMetadata) {
              const strokeLabel = obj.strokeMetadata.strokeLabel;
              const imageLabel = obj.strokeMetadata.imageLabel;

              // Remove from metadata manager
              if (window.app?.metadataManager) {
                const metadata = window.app.metadataManager;
                if (metadata.vectorStrokesByImage[imageLabel]) {
                  delete metadata.vectorStrokesByImage[imageLabel][strokeLabel];
                }
                if (metadata.strokeVisibilityByImage[imageLabel]) {
                  delete metadata.strokeVisibilityByImage[imageLabel][strokeLabel];
                }
                if (metadata.strokeLabelVisibility[imageLabel]) {
                  delete metadata.strokeLabelVisibility[imageLabel][strokeLabel];
                }
                if (metadata.strokeMeasurements[imageLabel]) {
                  delete metadata.strokeMeasurements[imageLabel][strokeLabel];
                }
              }

              // Remove tag
              if (window.app?.tagManager) {
                window.app.tagManager.removeTag(strokeLabel);
              }
            }

            this.fabricCanvas.remove(obj);
          });
          this.fabricCanvas.discardActiveObject();
          this.fabricCanvas.requestRenderAll();

          // Update visibility panel after metadata cleanup
          if (window.app?.metadataManager) {
            window.app.metadataManager.updateStrokeVisibilityControls();
          }

          // Trigger history save
          if (window.app && window.app.historyManager) {
            window.app.historyManager.saveState();
          }
        }
      }
    });
  }

  /**
   * Calculate available canvas size (works before fabricCanvas is initialized)
   */
  calculateAvailableSize() {
    const margin = 16;
    const isVisible = el => el && el.offsetParent !== null;

    let leftReserve = 0;
    ['toolsPanel', 'strokePanel'].forEach(id => {
      const el = document.getElementById(id);
      if (isVisible(el)) {
        const elRect = el.getBoundingClientRect();
        leftReserve = Math.max(leftReserve, elRect.width + margin);
      }
    });

    let rightReserve = 0;
    ['imagePanel'].forEach(id => {
      const el = document.getElementById(id);
      if (isVisible(el)) {
        const elRect = el.getBoundingClientRect();
        rightReserve = Math.max(rightReserve, elRect.width + margin);
      }
    });

    let topReserve = 0;
    const topToolbar = document.getElementById('topToolbar');
    if (isVisible(topToolbar)) {
      topReserve = topToolbar.getBoundingClientRect().height;
    }

    // Sanitize canvas dimensions to prevent negative values
    const width = Math.max(0, window.innerWidth - leftReserve - rightReserve);
    const height = Math.max(0, window.innerHeight - topReserve);

    // Enhanced minimum size constraints - be smarter about when to enforce large minimums
    const hasBackgroundImage = this.fabricCanvas && this.fabricCanvas.backgroundImage;
    const hasStrokes = this.fabricCanvas && this.fabricCanvas.getObjects().length > 0;

    // Only enforce large minimums when canvas is completely empty
    // If there are strokes (but no bg image), allow more flexible resizing
    let minWidth, minHeight;

    if (hasBackgroundImage) {
      // With background image: small minimums, let image content determine size
      minWidth = 300;
      minHeight = 200;
    } else if (hasStrokes) {
      // With strokes but no image: moderate minimums, allow resizing but prevent too small
      minWidth = 400;
      minHeight = 300;
    } else {
      // Completely empty: larger minimums for comfortable drawing space
      minWidth = 800;
      minHeight = 600;
    }

    return {
      width: Math.max(minWidth, width),
      height: Math.max(minHeight, height),
    };
  }

  /**
   * Show resize overlay to maintain visual continuity during canvas resize
   */
  showResizeOverlay(targetWidth, targetHeight) {
    const canvasEl = this.fabricCanvas?.lowerCanvasEl;
    if (!canvasEl || !canvasEl.parentElement) return;

    const canvasRect = canvasEl.getBoundingClientRect();

    if (!this.resizeOverlayCanvas) {
      this.resizeOverlayCanvas = document.createElement('canvas');
      this.resizeOverlayCanvas.style.pointerEvents = 'none';
      this.resizeOverlayCanvas.style.position = 'absolute';
      const zIndex = parseInt(window.getComputedStyle(canvasEl).zIndex || '0', 10) || 0;
      this.resizeOverlayCanvas.style.zIndex = String(zIndex + 1);
      canvasEl.parentElement.appendChild(this.resizeOverlayCanvas);
    }

    const parentRect = canvasEl.parentElement.getBoundingClientRect();
    this.resizeOverlayCanvas.style.left = `${canvasRect.left - parentRect.left}px`;
    this.resizeOverlayCanvas.style.top = `${canvasRect.top - parentRect.top}px`;

    this.resizeOverlayCanvas.width = Math.max(1, Math.floor(canvasRect.width));
    this.resizeOverlayCanvas.height = Math.max(1, Math.floor(canvasRect.height));

    const overlayCtx = this.resizeOverlayCanvas.getContext('2d');
    overlayCtx.clearRect(0, 0, this.resizeOverlayCanvas.width, this.resizeOverlayCanvas.height);
    try {
      overlayCtx.drawImage(
        canvasEl,
        0,
        0,
        this.resizeOverlayCanvas.width,
        this.resizeOverlayCanvas.height
      );
    } catch (_) {
      // Ignore drawImage failures (e.g., tainted canvas)
    }

    this.resizeOverlayCanvas.style.width = `${targetWidth}px`;
    this.resizeOverlayCanvas.style.height = `${targetHeight}px`;
  }

  /**
   * Hide resize overlay after redraw completes
   */
  hideResizeOverlay() {
    if (this.resizeOverlayCleanupId) {
      cancelAnimationFrame(this.resizeOverlayCleanupId);
    }

    this.resizeOverlayCleanupId = requestAnimationFrame(() => {
      this.resizeOverlayCleanupId = null;
      if (this.resizeOverlayCanvas && this.resizeOverlayCanvas.parentElement) {
        this.resizeOverlayCanvas.parentElement.removeChild(this.resizeOverlayCanvas);
      }
      this.resizeOverlayCanvas = null;
    });
  }

  /**
   * Calculate available canvas size considering sidebars and panels
   * (Wrapper for calculateAvailableSize for consistency)
   */
  getAvailableCanvasSize() {
    return this.calculateAvailableSize();
  }

  /**
   * Update capture frame position and size during resize
   */
  updateCaptureFrameOnResize(targetWidth, targetHeight) {
    const captureFrame = document.getElementById('captureFrame');
    if (!captureFrame) {
      console.log('[Frame Debug] No capture frame element found');
      return;
    }

    const currentImageLabel = window.app?.projectManager?.currentViewId || 'default';

    // If no image label, we're dealing with stroke-only canvas
    const isStrokeOnlyCanvas = !window.app?.projectManager?.currentViewId;

    // Check if manual ratios are saved for this image
    const savedRatios = window.manualFrameRatios && window.manualFrameRatios[currentImageLabel];

    if (savedRatios) {
      // Frame was manually resized - apply saved ratios to current canvas size
      const frameWidth = targetWidth * savedRatios.widthRatio;
      const frameHeight = targetHeight * savedRatios.heightRatio;
      const frameLeft = targetWidth * savedRatios.leftRatio;
      const frameTop = targetHeight * savedRatios.topRatio;

      // Ensure frame stays within canvas bounds
      const maxLeft = Math.max(0, targetWidth - frameWidth);
      const maxTop = Math.max(0, targetHeight - frameHeight);
      const boundedLeft = Math.max(0, Math.min(maxLeft, frameLeft));
      const boundedTop = Math.max(0, Math.min(maxTop, frameTop));

      captureFrame.style.width = `${frameWidth}px`;
      captureFrame.style.height = `${frameHeight}px`;
      captureFrame.style.left = `${boundedLeft}px`;
      captureFrame.style.top = `${boundedTop}px`;
    } else {
      // No manual resize - prefer larger frame size (800x600) when possible
      let frameWidth = 800;
      let frameHeight = 600;

      // SIMPLIFIED LOGIC: Always use fixed 800x600 unless canvas is too small
      // If canvas is smaller, use 80% of canvas size but never smaller than 400x300
      if (targetWidth < 850 || targetHeight < 650) {
        frameWidth = Math.max(400, Math.floor(targetWidth * 0.8));
        frameHeight = Math.max(300, Math.floor(targetHeight * 0.8));

        // Maintain 4:3 aspect ratio
        const aspectRatio = 4 / 3;
        if (frameWidth / frameHeight > aspectRatio) {
          frameWidth = frameHeight * aspectRatio;
        } else {
          frameHeight = frameWidth / aspectRatio;
        }
      }
      // Otherwise keep default 800x600

      // Center the frame on the canvas
      let frameLeft = (targetWidth - frameWidth) / 2;
      let frameTop = (targetHeight - frameHeight) / 2;

      // Clamp frame to stay fully inside canvas bounds
      frameWidth = Math.min(frameWidth, targetWidth);
      frameHeight = Math.min(frameHeight, targetHeight);
      frameLeft = Math.max(0, Math.min(frameLeft, targetWidth - frameWidth));
      frameTop = Math.max(0, Math.min(frameTop, targetHeight - frameHeight));

      captureFrame.style.width = `${frameWidth}px`;
      captureFrame.style.height = `${frameHeight}px`;
      captureFrame.style.left = `${frameLeft}px`;
      captureFrame.style.top = `${frameTop}px`;
    }
  }

  /**
   * Apply resize with debouncing and smooth transitions
   */
  applyResize() {
    if (!this.fabricCanvas || this.isResizing) {
      return;
    }
    if (this.pendingResizeWidth === null || this.pendingResizeHeight === null) {
      return;
    }

    this.isResizing = true;

    const targetWidth = this.pendingResizeWidth;
    const targetHeight = this.pendingResizeHeight;

    const sizeChanged =
      this.lastCanvasSize.width !== targetWidth || this.lastCanvasSize.height !== targetHeight;

    // Get background image info if available
    const bgImage = this.fabricCanvas.backgroundImage;

    // Show overlay before resize for smooth transition
    if (sizeChanged) {
      this.showResizeOverlay(targetWidth, targetHeight);
    }

    // Update Fabric.js canvas dimensions
    this.fabricCanvas.setWidth(targetWidth);
    this.fabricCanvas.setHeight(targetHeight);

    // CRITICAL FIX: Remove all CSS constraints that cause canvas stretching/shrinking issues
    // These style overrides ensure the canvas displays at its actual size, not hardcoded sizes
    const canvasEl = this.fabricCanvas.lowerCanvasEl;
    if (canvasEl) {
      canvasEl.style.minWidth = 'unset';
      canvasEl.style.minHeight = 'unset';
      canvasEl.style.maxWidth = 'unset';
      canvasEl.style.maxHeight = 'unset';
      // Clear any hardcoded width/height from HTML that prevents dynamic sizing
      canvasEl.style.width = `${targetWidth}px`;
      canvasEl.style.height = `${targetHeight}px`;
    }
    const upperCanvasEl = this.fabricCanvas.upperCanvasEl;
    if (upperCanvasEl) {
      upperCanvasEl.style.minWidth = 'unset';
      upperCanvasEl.style.minHeight = 'unset';
      upperCanvasEl.style.maxWidth = 'unset';
      upperCanvasEl.style.maxHeight = 'unset';
      // Clear any hardcoded width/height from HTML that prevents dynamic sizing
      upperCanvasEl.style.width = `${targetWidth}px`;
      upperCanvasEl.style.height = `${targetHeight}px`;
    }

    // Also clear styles on the original canvas element to remove hardcoded dimensions from HTML
    const originalCanvasEl = document.getElementById(this.canvasId);
    if (originalCanvasEl) {
      originalCanvasEl.style.width = `${targetWidth}px`;
      originalCanvasEl.style.height = `${targetHeight}px`;
    }

    // Store old size for stroke scaling calculations BEFORE updating
    const oldCanvasWidth = this.lastCanvasSize.width;
    const oldCanvasHeight = this.lastCanvasSize.height;

    // Update last known size
    this.lastCanvasSize = { width: targetWidth, height: targetHeight };

    // Recalculate background image fit if one exists

    if (bgImage && sizeChanged) {
      // Get current fit mode from project manager if available
      const currentViewId = window.app?.projectManager?.currentViewId;
      const savedFitMode =
        window.app?.projectManager?.views?.[currentViewId]?.fitMode || 'fit-canvas';

      // Recalculate scale based on new canvas size
      const imgWidth = bgImage.width;
      const imgHeight = bgImage.height;
      let scale = 1;

      switch (savedFitMode) {
        case 'fit-width':
          scale = targetWidth / imgWidth;
          break;
        case 'fit-height':
          scale = targetHeight / imgHeight;
          break;
        case 'fit-canvas':
          scale = Math.min(targetWidth / imgWidth, targetHeight / imgHeight);
          break;
        case 'actual-size':
          scale = 1;
          break;
        default:
          scale = Math.min(targetWidth / imgWidth, targetHeight / imgHeight);
      }

      const oldScale = bgImage.scaleX;
      const oldLeft = bgImage.left;
      const oldTop = bgImage.top;

      // Calculate scaled dimensions
      const scaledWidth = imgWidth * scale;
      const scaledHeight = imgHeight * scale;

      // Center the image in the canvas
      // Since originX/originY are 'center', left/top should be canvas center
      const centerX = targetWidth / 2;
      const centerY = targetHeight / 2;

      // Update scale AND position to center the image
      bgImage.set({
        scaleX: scale,
        scaleY: scale,
        left: centerX,
        top: centerY,
      });

      // CRITICAL: Transform all stroke objects to maintain position relative to background image
      // Calculate the transformation delta
      const scaleRatio = scale / oldScale;

      // Transform all objects (strokes, arrows, tags, etc.) except the background image
      const objects = this.fabricCanvas.getObjects();
      let transformedCount = 0;
      objects.forEach(obj => {
        // Skip only the background image itself
        if (obj === bgImage) return;

        // Calculate new position relative to background image center
        // 1. Get position relative to old background center
        const relX = obj.left - oldLeft;
        const relY = obj.top - oldTop;

        // 2. Scale the relative position
        const newRelX = relX * scaleRatio;
        const newRelY = relY * scaleRatio;

        // 3. Add new background center
        const newLeft = centerX + newRelX;
        const newTop = centerY + newRelY;

        // Update object position and scale
        obj.set({
          left: newLeft,
          top: newTop,
          scaleX: (obj.scaleX || 1) * scaleRatio,
          scaleY: (obj.scaleY || 1) * scaleRatio,
        });

        obj.setCoords(); // Update object coordinates for interactions
        transformedCount++;
      });

      // Transform capture frame to stick with the background image
      const captureFrame = document.getElementById('captureFrame');
      if (captureFrame) {
        const oldFrameLeft = parseFloat(captureFrame.style.left) || 0;
        const oldFrameTop = parseFloat(captureFrame.style.top) || 0;
        const oldFrameWidth = parseFloat(captureFrame.style.width) || 0;
        const oldFrameHeight = parseFloat(captureFrame.style.height) || 0;

        // Store frame ratios relative to OLD image if not already stored
        // This prevents cumulative drift by always calculating from the same reference
        if (!this.captureFrameImageRatios) {
          // Calculate frame center relative to old image center
          const frameCenterX = oldFrameLeft + oldFrameWidth / 2;
          const frameCenterY = oldFrameTop + oldFrameHeight / 2;

          // Position relative to old background center
          const relX = frameCenterX - oldLeft;
          const relY = frameCenterY - oldTop;

          // Convert to ratios of the OLD image's scaled size
          const oldScaledWidth = imgWidth * oldScale;
          const oldScaledHeight = imgHeight * oldScale;

          this.captureFrameImageRatios = {
            // Frame center position as ratio of image size (-0.5 to 0.5 for centered)
            centerXRatio: relX / oldScaledWidth,
            centerYRatio: relY / oldScaledHeight,
            // Frame size as ratio of image size
            widthRatio: oldFrameWidth / oldScaledWidth,
            heightRatio: oldFrameHeight / oldScaledHeight,
          };
        }

        // Calculate NEW frame position from stored ratios and NEW image position
        const newScaledWidth = imgWidth * scale;
        const newScaledHeight = imgHeight * scale;

        // Calculate frame size from ratios
        const newFrameWidth = newScaledWidth * this.captureFrameImageRatios.widthRatio;
        const newFrameHeight = newScaledHeight * this.captureFrameImageRatios.heightRatio;

        // Calculate frame center position
        const frameCenterX = centerX + newScaledWidth * this.captureFrameImageRatios.centerXRatio;
        const frameCenterY = centerY + newScaledHeight * this.captureFrameImageRatios.centerYRatio;

        // Calculate top-left position from center
        const newFrameLeft = frameCenterX - newFrameWidth / 2;
        const newFrameTop = frameCenterY - newFrameHeight / 2;

        // Round to whole pixels to prevent sub-pixel jitter
        const roundedLeft = Math.round(newFrameLeft);
        const roundedTop = Math.round(newFrameTop);
        const roundedWidth = Math.round(newFrameWidth);
        const roundedHeight = Math.round(newFrameHeight);

        // Update frame position and size
        captureFrame.style.left = `${roundedLeft}px`;
        captureFrame.style.top = `${roundedTop}px`;
        captureFrame.style.width = `${roundedWidth}px`;
        captureFrame.style.height = `${roundedHeight}px`;
      }
    } else if (sizeChanged) {
      // For stroke-only canvas: Apply simple proportional scaling
      console.log(
        `[CanvasManager] Stroke-only canvas resize: ${oldCanvasWidth}x${oldCanvasHeight} -> ${targetWidth}x${targetHeight}`
      );

      // Scale from original positions to prevent accumulation
      if (oldCanvasWidth > 0 && oldCanvasHeight > 0) {
        // Initialize original canvas size and object states if not set
        if (this.originalCanvasSize.width === 0) {
          this.originalCanvasSize = { width: oldCanvasWidth, height: oldCanvasHeight };

          this.fabricCanvas.getObjects().forEach(obj => {
            if (!this.originalObjectStates.has(obj)) {
              this.originalObjectStates.set(obj, {
                left: obj.left,
                top: obj.top,
                scaleX: obj.scaleX || 1,
                scaleY: obj.scaleY || 1,
                strokeWidth: obj.strokeWidth || 1,
              });
            }
          });
        }

        // Calculate scale factors from ORIGINAL canvas size
        const scaleX = targetWidth / this.originalCanvasSize.width;
        const scaleY = targetHeight / this.originalCanvasSize.height;

        // Guard against NaN values from invalid dimensions during window drag
        if (
          Number.isNaN(scaleX) ||
          Number.isNaN(scaleY) ||
          !isFinite(scaleX) ||
          !isFinite(scaleY)
        ) {
          console.warn(
            `[CanvasManager] Invalid scale factors: ${scaleX}, ${scaleY} - aborting resize`
          );
          this.updateCaptureFrameOnResize(targetWidth, targetHeight);
          return;
        }

        const uniformScale = Math.min(scaleX, scaleY);

        // Skip scaling if change is very small to prevent precision issues
        const scaleChange = Math.abs(uniformScale - 1.0);
        if (scaleChange < 0.05) {
          console.log(
            `[CanvasManager] Skipping tiny scale change: ${uniformScale.toFixed(3)} (${scaleChange.toFixed(3)} < 0.05)`
          );
          this.updateCaptureFrameOnResize(targetWidth, targetHeight);
          return;
        }

        const objects = this.fabricCanvas.getObjects();

        console.log(
          `[CanvasManager] Scaling ${objects.length} objects from original by ${uniformScale.toFixed(3)} (canvas: ${scaleX.toFixed(3)}x, ${scaleY.toFixed(3)}y)`
        );

        // Disable rendering during batch updates to prevent flicker
        this.fabricCanvas.renderOnAddRemove = false;

        objects.forEach(obj => {
          // Get or store original state for new objects
          if (!this.originalObjectStates.has(obj)) {
            this.originalObjectStates.set(obj, {
              left: obj.left,
              top: obj.top,
              scaleX: obj.scaleX || 1,
              scaleY: obj.scaleY || 1,
              strokeWidth: obj.strokeWidth || 1,
            });
          }

          const original = this.originalObjectStates.get(obj);

          // Scale from original positions and sizes
          const updates = {
            left: original.left * scaleX,
            top: original.top * scaleY,
            scaleX: original.scaleX * uniformScale,
            scaleY: original.scaleY * uniformScale,
          };

          // Scale strokeWidth for line and path objects (but not tags)
          if (!obj.isTag && obj.strokeWidth && (obj.type === 'line' || obj.type === 'path')) {
            updates.strokeWidth = original.strokeWidth * uniformScale;
          }

          obj.set(updates);
          obj.setCoords();
        });

        // Re-enable rendering and render all changes at once
        this.fabricCanvas.renderOnAddRemove = true;
        this.fabricCanvas.requestRenderAll();
      }

      // Update capture frame
      this.updateCaptureFrameOnResize(targetWidth, targetHeight);

      // Original stroke scaling logic disabled to prevent drift:
      /*const oldWidth = oldCanvasWidth;
      const oldHeight = oldCanvasHeight;
      
      // Only scale if we had a previous size and it's different
      if (oldWidth > 0 && oldHeight > 0) {
        const scaleX = targetWidth / oldWidth;
        const scaleY = targetHeight / oldHeight;
        
        // Use uniform scaling to maintain proportions (take average of both scales)
        const uniformScale = Math.sqrt(scaleX * scaleY);
        
        // Only transform if scale change is significant (avoid micro-adjustments)  
        // But also prevent extreme scaling that could cause glitches
        const scaleChange = Math.abs(uniformScale - 1.0);
        
        // Debounce rapid stroke scaling to prevent glitch accumulation
        if (this.strokeScalingTimeout) {
          clearTimeout(this.strokeScalingTimeout);
        }
        
        this.pendingStrokeScale = { uniformScale, scaleChange, targetWidth, targetHeight };
        
        this.strokeScalingTimeout = setTimeout(() => {
          const { uniformScale: scale, scaleChange: change, targetWidth: newWidth, targetHeight: newHeight } = this.pendingStrokeScale;
          
          if (change > 0.02 && change < 0.5) {
            // Transform all objects to fit the new canvas size
            const objects = this.fabricCanvas.getObjects();
            
            // Safety check: if we have objects but dimensions are invalid, skip scaling
            if (objects.length > 0 && (oldWidth <= 0 || oldHeight <= 0 || newWidth <= 0 || newHeight <= 0)) {
              console.warn(`[CanvasManager] Skipping scaling - invalid dimensions: old=${oldWidth}x${oldHeight}, new=${newWidth}x${newHeight}`);
              this.strokeScalingTimeout = null;
              this.pendingStrokeScale = null;
              return;
            }
            
            console.log(`[CanvasManager] Scaling ${objects.length} objects by ${scale.toFixed(3)}x`);
          
            objects.forEach(obj => {
              // Scale position relative to canvas center for ALL objects (including tags)
              const oldCenterX = oldWidth / 2;
              const oldCenterY = oldHeight / 2;
              const newCenterX = newWidth / 2;
              const newCenterY = newHeight / 2;
              
              // Get position relative to old canvas center
              const relX = obj.left - oldCenterX;
              const relY = obj.top - oldCenterY;
              
              // Scale the relative position and add to new center
              const newLeft = newCenterX + (relX * scale);
              const newTop = newCenterY + (relY * scale);
            
            // Update object position 
            const updates = {
              left: newLeft,
              top: newTop,
            };
            
              // Only scale size for non-tag objects
              if (!obj.isTag) {
                const currentScaleX = obj.scaleX || 1;
                const currentScaleY = obj.scaleY || 1;
                const newScaleX = currentScaleX * scale;
                const newScaleY = currentScaleY * scale;
                
                // Prevent extreme scaling that could cause glitches
                // Clamp scale between 0.1x and 10x
                updates.scaleX = Math.max(0.1, Math.min(10, newScaleX));
                updates.scaleY = Math.max(0.1, Math.min(10, newScaleY));
                
                // For stroke objects, also scale stroke width with similar limits
                if (obj.strokeWidth && (obj.type === 'line' || obj.type === 'path')) {
                  const currentStrokeWidth = obj.strokeWidth;
                  const newStrokeWidth = currentStrokeWidth * scale;
                  // Clamp stroke width between 0.5px and 50px
                  updates.strokeWidth = Math.max(0.5, Math.min(50, newStrokeWidth));
                }
              }
            
            obj.set(updates);
            obj.setCoords(); // Update object coordinates for interactions
            });
            
            // Also update capture frame for stroke-only canvas  
            this.updateCaptureFrameOnResize(newWidth, newHeight);
          }
          
          // Clear timeout after processing
          this.strokeScalingTimeout = null;
          this.pendingStrokeScale = null;
        }, 150); // 150ms debounce delay to prevent rapid glitch accumulation
      }
      */ // End of disabled stroke scaling logic
    }

    // Redraw canvas
    this.fabricCanvas.renderAll();

    // Hide overlay after redraw
    if (sizeChanged) {
      this.hideResizeOverlay();
    }

    // Clear pending resize
    this.pendingResizeWidth = null;
    this.pendingResizeHeight = null;
    this.isResizing = false;
  }

  /**
   * Debounced resize method - queues resize with requestAnimationFrame
   */
  resize() {
    if (!this.fabricCanvas || this.isResizing) {
      return;
    }

    const { width, height } = this.getAvailableCanvasSize();

    // Prevent unnecessary resizes if size hasn't changed significantly
    const currentWidth = this.fabricCanvas.getWidth();
    const currentHeight = this.fabricCanvas.getHeight();
    const widthDiff = Math.abs(currentWidth - width);
    const heightDiff = Math.abs(currentHeight - height);

    // Only resize if change is significant (more than 10px) to prevent micro-adjustments
    if (widthDiff < 10 && heightDiff < 10) {
      return;
    }

    // Additional protection: prevent rapid consecutive resizes while keeping UI responsive
    const now = Date.now();
    if (this.lastResizeTime && now - this.lastResizeTime < 250) {
      console.log(
        `[CanvasManager] Blocking resize - only ${now - this.lastResizeTime}ms since last (need 250ms)`
      );
      return;
    }

    // Reset counter and update time
    this.consecutiveResizeCount = 0;
    this.lastResizeTime = now;

    this.pendingResizeWidth = width;
    this.pendingResizeHeight = height;

    // Debounce resize calls to prevent multiple rapid calls
    if (!this.pendingResizeFrame) {
      this.pendingResizeFrame = requestAnimationFrame(() => {
        this.pendingResizeFrame = null;
        this.applyResize();
      });
    }
  }

  initZoomPan() {
    if (!this.fabricCanvas) return;

    this.fabricCanvas.on('mouse:wheel', opt => {
      const delta = opt.e.deltaY;
      let zoom = this.fabricCanvas.getZoom();
      zoom *= 0.999 ** delta;
      if (zoom > 20) zoom = 20;
      if (zoom < 0.01) zoom = 0.01;

      this.fabricCanvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
      opt.e.preventDefault();
      opt.e.stopPropagation();
    });

    // Panning logic: Alt+Drag, Shift+Drag, or two-finger touch
    let isDragging = false;
    let lastPosX;
    let lastPosY;

    // Touch gesture state
    let touchGestureState = {
      isTwoFingerPan: false,
      isPinchZoom: false,
      lastTwoFingerCenter: null,
      lastTwoFingerDistance: null,
      activeTouches: new Map(),
    };

    this.fabricCanvas.on('mouse:down', opt => {
      const evt = opt.e;
      if (evt.altKey === true || evt.shiftKey === true) {
        console.log('[PAN] Starting pan gesture with', evt.altKey ? 'Alt' : 'Shift');
        this.fabricCanvas.isDrawingMode = false; // Temporarily disable drawing
        isDragging = true;
        this.fabricCanvas.selection = false;
        lastPosX = evt.clientX;
        lastPosY = evt.clientY;

        // Set grabbing cursor
        this.fabricCanvas.upperCanvasEl.style.cursor = 'grabbing';
      }
    });

    this.fabricCanvas.on('mouse:move', opt => {
      if (isDragging) {
        const e = opt.e;
        const vpt = this.fabricCanvas.viewportTransform;
        vpt[4] += e.clientX - lastPosX;
        vpt[5] += e.clientY - lastPosY;
        this.fabricCanvas.requestRenderAll();
        lastPosX = e.clientX;
        lastPosY = e.clientY;
      }
    });

    this.fabricCanvas.on('mouse:up', opt => {
      if (isDragging) {
        console.log('[PAN] Ending pan gesture');
        this.fabricCanvas.setViewportTransform(this.fabricCanvas.viewportTransform);
        isDragging = false;
        this.fabricCanvas.selection = true;

        // Restore cursor based on current shift state
        const evt = opt.e;
        if (evt.shiftKey) {
          this.fabricCanvas.upperCanvasEl.style.cursor = 'grab';
        } else {
          this.fabricCanvas.upperCanvasEl.style.cursor = 'default';
        }

        // Restore drawing mode state if needed (ToolManager should handle this ideally)
      }
    });

    // Update tag connectors when strokes are moved (including multi-select)
    // Note: Tags are non-selectable, so only strokes trigger this handler
    this.fabricCanvas.on('object:moving', e => {
      const movingObj = e.target;

      if (!window.app?.tagManager) return;

      // Handle both single objects and multi-selections (activeSelection)
      if (movingObj.type === 'activeSelection') {
        // Multiple strokes are selected and being moved
        const objects = movingObj.getObjects();
        const tagManager = window.app.tagManager;

        // Update connectors for all strokes in the selection
        objects.forEach(obj => {
          // Handle lines, paths (curves), and groups (arrows), but skip tags
          if ((obj.type === 'line' || obj.type === 'path' || obj.type === 'group') && !obj.isTag) {
            // Find the tag associated with this stroke
            for (const [strokeLabel, tagObj] of tagManager.tagObjects.entries()) {
              if (tagObj.connectedStroke === obj) {
                tagManager.updateConnector(strokeLabel);
                break;
              }
            }
          }
        });
      } else if (
        (movingObj.type === 'line' || movingObj.type === 'path' || movingObj.type === 'group') &&
        !movingObj.isTag
      ) {
        // Single stroke being moved - find and update its tag's connector
        const tagManager = window.app.tagManager;
        for (const [strokeLabel, tagObj] of tagManager.tagObjects.entries()) {
          if (tagObj.connectedStroke === movingObj) {
            tagManager.updateConnector(strokeLabel);
            break;
          }
        }
      }

      // Request render to ensure connectors and tags display correctly
      this.fabricCanvas.requestRenderAll();
    });

    // Touch gesture helpers
    const getTwoFingerCenter = touches => {
      if (touches.length < 2) return null;
      const touch1 = touches[0];
      const touch2 = touches[1];
      return {
        x: (touch1.clientX + touch2.clientX) / 2,
        y: (touch1.clientY + touch2.clientY) / 2,
      };
    };

    const getTwoFingerDistance = touches => {
      if (touches.length < 2) return null;
      const touch1 = touches[0];
      const touch2 = touches[1];
      const dx = touch1.clientX - touch2.clientX;
      const dy = touch1.clientY - touch2.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    // Touch event handlers for two-finger pan
    const canvasElement = this.fabricCanvas.upperCanvasEl;

    canvasElement.addEventListener(
      'touchstart',
      e => {
        // Update active touches
        for (let i = 0; i < e.touches.length; i++) {
          const touch = e.touches[i];
          touchGestureState.activeTouches.set(touch.identifier, {
            x: touch.clientX,
            y: touch.clientY,
          });
        }

        if (e.touches.length === 2) {
          console.log('[GESTURE] Starting two-finger gesture (pan/zoom)');
          // Two finger gesture detected - start both pan and pinch tracking
          touchGestureState.isTwoFingerPan = true;
          touchGestureState.isPinchZoom = true;
          touchGestureState.lastTwoFingerCenter = getTwoFingerCenter(e.touches);
          touchGestureState.lastTwoFingerDistance = getTwoFingerDistance(e.touches);

          // Disable Fabric.js drawing and selection during gesture
          this.fabricCanvas.isDrawingMode = false;
          this.fabricCanvas.selection = false;

          // Set a global flag that tools can check
          this.fabricCanvas.isGestureActive = true;

          e.preventDefault(); // Prevent default two-finger behaviors
        }
      },
      { passive: false }
    );

    canvasElement.addEventListener(
      'touchmove',
      e => {
        if (
          (touchGestureState.isTwoFingerPan || touchGestureState.isPinchZoom) &&
          e.touches.length === 2
        ) {
          const currentCenter = getTwoFingerCenter(e.touches);
          const currentDistance = getTwoFingerDistance(e.touches);

          // Handle pinch-to-zoom
          if (
            touchGestureState.isPinchZoom &&
            touchGestureState.lastTwoFingerDistance &&
            currentDistance
          ) {
            const zoomRatio = currentDistance / touchGestureState.lastTwoFingerDistance;
            let currentZoom = this.fabricCanvas.getZoom();
            let newZoom = currentZoom * zoomRatio;

            // Clamp zoom levels
            if (newZoom > 20) newZoom = 20;
            if (newZoom < 0.01) newZoom = 0.01;

            if (Math.abs(zoomRatio - 1) > 0.01) {
              // Only zoom if significant change
              console.log(
                '[ZOOM] Pinch zoom:',
                zoomRatio - 1 > 0 ? 'in' : 'out',
                'ratio:',
                zoomRatio.toFixed(3)
              );

              // Get canvas-relative coordinates for zoom center
              const canvasEl = this.fabricCanvas.upperCanvasEl;
              const rect = canvasEl.getBoundingClientRect();
              const zoomPoint = {
                x: currentCenter.x - rect.left,
                y: currentCenter.y - rect.top,
              };

              this.fabricCanvas.zoomToPoint(zoomPoint, newZoom);
              touchGestureState.lastTwoFingerDistance = currentDistance;
            }
          }

          // Handle two-finger pan (only if not zooming significantly)
          if (
            touchGestureState.isTwoFingerPan &&
            touchGestureState.lastTwoFingerCenter &&
            currentCenter
          ) {
            const deltaX = currentCenter.x - touchGestureState.lastTwoFingerCenter.x;
            const deltaY = currentCenter.y - touchGestureState.lastTwoFingerCenter.y;

            // Only pan if movement is significant and not primarily a zoom gesture
            if (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1) {
              console.log('[PAN] Two-finger pan delta:', deltaX.toFixed(1), deltaY.toFixed(1));

              // Update viewport transform
              const vpt = this.fabricCanvas.viewportTransform;
              vpt[4] += deltaX;
              vpt[5] += deltaY;
              this.fabricCanvas.requestRenderAll();

              touchGestureState.lastTwoFingerCenter = currentCenter;
            }
          }

          e.preventDefault();
        }
      },
      { passive: false }
    );

    canvasElement.addEventListener(
      'touchend',
      e => {
        // Remove ended touches from active touches
        for (let i = 0; i < e.changedTouches.length; i++) {
          const touch = e.changedTouches[i];
          touchGestureState.activeTouches.delete(touch.identifier);
        }

        // If we were in two-finger mode and now have less than 2 touches, exit gesture mode
        if (
          (touchGestureState.isTwoFingerPan || touchGestureState.isPinchZoom) &&
          e.touches.length < 2
        ) {
          console.log('[GESTURE] Ending two-finger gesture (pan/zoom)');
          touchGestureState.isTwoFingerPan = false;
          touchGestureState.isPinchZoom = false;
          touchGestureState.lastTwoFingerCenter = null;
          touchGestureState.lastTwoFingerDistance = null;

          // Restore Fabric.js state
          this.fabricCanvas.setViewportTransform(this.fabricCanvas.viewportTransform);
          this.fabricCanvas.selection = true;

          // Delay clearing gesture flag to prevent residual drawing events
          setTimeout(() => {
            this.fabricCanvas.isGestureActive = false;
          }, 100);

          // Drawing mode will be restored by ToolManager if needed
        }
      },
      { passive: false }
    );

    canvasElement.addEventListener(
      'touchcancel',
      e => {
        // Reset touch state on cancel
        touchGestureState.activeTouches.clear();
        touchGestureState.isTwoFingerPan = false;
        touchGestureState.isPinchZoom = false;
        touchGestureState.lastTwoFingerCenter = null;
        touchGestureState.lastTwoFingerDistance = null;

        // Restore Fabric.js state
        this.fabricCanvas.selection = true;

        // Delay clearing gesture flag to prevent residual drawing events
        setTimeout(() => {
          this.fabricCanvas.isGestureActive = false;
        }, 100);
      },
      { passive: false }
    );

    // Keyboard event listeners for cursor feedback on shift key
    document.addEventListener('keydown', e => {
      if (e.key === 'Shift' && !isDragging) {
        console.log('[PAN] Shift key pressed - showing grab cursor');
        this.fabricCanvas.upperCanvasEl.style.cursor = 'grab';
      }
    });

    document.addEventListener('keyup', e => {
      if (e.key === 'Shift' && !isDragging) {
        console.log('[PAN] Shift key released - restoring default cursor');
        this.fabricCanvas.upperCanvasEl.style.cursor = 'default';
      }
    });
  }

  clear() {
    this.fabricCanvas.clear();
    this.fabricCanvas.setBackgroundColor(
      '#ffffff',
      this.fabricCanvas.renderAll.bind(this.fabricCanvas)
    );
  }

  // Helper to get JSON export
  toJSON() {
    return this.fabricCanvas.toJSON();
  }

  // Helper to load from JSON
  loadFromJSON(json, callback) {
    this.fabricCanvas.loadFromJSON(json, () => {
      this.fabricCanvas.renderAll();
      if (callback) callback();
    });
  }
}
