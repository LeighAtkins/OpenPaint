// Project Manager
// Handles views (images) and their associated canvas states

export class ProjectManager {
  constructor(canvasManager, historyManager) {
    this.canvasManager = canvasManager;
    this.historyManager = historyManager;

    // Project Data
    this.currentViewId = 'front';
    this.views = {
      front: { id: 'front', image: null, canvasData: null, metadata: null, rotation: 0 },
      side: { id: 'side', image: null, canvasData: null, metadata: null, rotation: 0 },
      back: { id: 'back', image: null, canvasData: null, metadata: null, rotation: 0 },
      cushion: { id: 'cushion', image: null, canvasData: null, metadata: null, rotation: 0 },
    };
  }

  init() {
    console.log('ProjectManager initialized');
    // Load the initial view
    this.switchView('front');
  }

  // Switch to a different view (image)
  async switchView(viewId) {
    if (!this.views[viewId]) {
      console.warn(`View ${viewId} does not exist.`);
      return;
    }

    // If already on this view, don't clear everything
    if (this.currentViewId === viewId) {
      console.log(`Already on view: ${viewId}, refreshing image only`);
      const view = this.views[viewId];
      if (view.image) {
        await this.setBackgroundImage(view.image);
      }
      if (typeof view.rotation === 'number') {
        this.canvasManager.setRotationDegrees(view.rotation);
        this.updateThumbnailRotation(viewId, view.rotation);
      }
      return;
    }

    console.log(`Switching to view: ${viewId}`);

    // Capture current viewport state to maintain continuity across image switches
    // This prevents "shifting the frame" when scrolling through images
    const currentViewportState = this.canvasManager.getViewportState();

    // 1. Save current state
    this.saveCurrentViewState();

    // 2. Clear history for the new view (or we could maintain separate history stacks per view)
    this.historyManager.clear();

    // 3. Switch context
    this.currentViewId = viewId;
    const view = this.views[viewId];

    // Apply rotation for the new view
    if (typeof view.rotation === 'number') {
      this.canvasManager.setRotationDegrees(view.rotation);
      this.updateThumbnailRotation(viewId, view.rotation);
    }

    // 4. Clear canvas
    this.canvasManager.clear();

    // 5. Load background image if exists
    if (view.image) {
      await this.setBackgroundImage(view.image);
    }

    // 6. Restore canvas objects (strokes/text)
    if (view.canvasData) {
      // Sanitize canvas data and fix image URLs before loading
      let sanitizedData = this.sanitizeCanvasJSON(view.canvasData);

      // If we have a saved image data URL, replace the blob URL in backgroundImage
      if (sanitizedData.backgroundImage && view.image) {
        sanitizedData.backgroundImage.src = view.image;
        console.log(`[Load] Replaced background image URL for ${viewId}`);
      }

      this.canvasManager.loadFromJSON(sanitizedData, async () => {
        // Restore metadata for this view
        if (view.metadata && window.app?.metadataManager) {
          window.app.metadataManager.vectorStrokesByImage[viewId] =
            view.metadata.vectorStrokesByImage || {};
          window.app.metadataManager.strokeVisibilityByImage[viewId] =
            view.metadata.strokeVisibilityByImage || {};
          window.app.metadataManager.strokeLabelVisibility[viewId] =
            view.metadata.strokeLabelVisibility || {};

          // Deserialize measurements with validation
          this.deserializeMeasurements(viewId, view.metadata.strokeMeasurements || {});
        }

        // After loading, update history initial state
        this.historyManager.saveState();

        // Rebuild metadata from canvas objects to ensure live references
        if (window.app?.metadataManager) {
          window.app.metadataManager.rebuildMetadataFromCanvas(
            viewId,
            this.canvasManager.fabricCanvas
          );
        }

        // Recreate custom controls for lines and curves
        const FabricControls =
          window.FabricControls || (await import('./utils/FabricControls.js')).FabricControls;

        const objects = this.canvasManager.fabricCanvas.getObjects();
        objects.forEach(obj => {
          if (obj.type === 'line' && obj.strokeMetadata) {
            FabricControls.createLineControls(obj);
          } else if (obj.type === 'path' && obj.customPoints) {
            FabricControls.createCurveControls(obj);
          }
        });

        // Recreate tags for all strokes with visible labels
        if (window.app?.tagManager && window.app?.metadataManager) {
          const strokes = window.app.metadataManager.vectorStrokesByImage[viewId] || {};
          const labelVisibility = window.app.metadataManager.strokeLabelVisibility[viewId] || {};

          console.log(`[Load] Recreating tags for ${Object.keys(strokes).length} strokes`);

          Object.entries(strokes).forEach(([strokeLabel, strokeObj]) => {
            const isLabelVisible = labelVisibility[strokeLabel] !== false;
            if (isLabelVisible) {
              window.app.tagManager.createTag(strokeLabel, viewId, strokeObj);
            }
          });
        }

        // Restore viewport state to maintain continuity
        this.canvasManager.setViewportState(currentViewportState);
      });
    } else {
      // Clear metadata for this view if no saved data
      if (window.app?.metadataManager) {
        window.app.metadataManager.clearImageMetadata(viewId);
      }

      // Restore viewport state to maintain continuity
      this.canvasManager.setViewportState(currentViewportState);

      this.historyManager.saveState();
    }
  }

  saveCurrentViewState() {
    const json = this.canvasManager.toJSON();
    if (this.views[this.currentViewId]) {
      this.views[this.currentViewId].canvasData = json;
      this.views[this.currentViewId].rotation = this.canvasManager.getRotationDegrees();

      // Also save metadata for this view
      if (window.app?.metadataManager) {
        this.views[this.currentViewId].metadata = {
          vectorStrokesByImage: JSON.parse(
            JSON.stringify(
              window.app.metadataManager.vectorStrokesByImage[this.currentViewId] || {}
            )
          ),
          strokeVisibilityByImage: JSON.parse(
            JSON.stringify(
              window.app.metadataManager.strokeVisibilityByImage[this.currentViewId] || {}
            )
          ),
          strokeLabelVisibility: JSON.parse(
            JSON.stringify(
              window.app.metadataManager.strokeLabelVisibility[this.currentViewId] || {}
            )
          ),
          strokeMeasurements: this.serializeMeasurements(this.currentViewId),
        };
      }
    }
  }

  // Serialize measurements for a view (deep copy)
  serializeMeasurements(viewId) {
    if (!window.app?.metadataManager?.strokeMeasurements) {
      return {};
    }

    const measurements = window.app.metadataManager.strokeMeasurements[viewId] || {};
    return JSON.parse(JSON.stringify(measurements));
  }

  // Deserialize measurements for a view
  deserializeMeasurements(viewId, measurements) {
    if (!window.app?.metadataManager) {
      return;
    }

    if (!measurements || typeof measurements !== 'object') {
      return;
    }

    // Validate and restore each measurement
    window.app.metadataManager.strokeMeasurements[viewId] = {};

    for (const [strokeLabel, measurement] of Object.entries(measurements)) {
      // Ensure proper structure
      if (measurement && typeof measurement === 'object') {
        window.app.metadataManager.strokeMeasurements[viewId][strokeLabel] = {
          inchWhole: typeof measurement.inchWhole === 'number' ? measurement.inchWhole : 0,
          inchFraction: typeof measurement.inchFraction === 'number' ? measurement.inchFraction : 0,
          cm: typeof measurement.cm === 'number' ? measurement.cm : 0,
        };
      }
    }
  }

  // Add or update an image for a view
  async addImage(viewId, imageUrl, options = {}) {
    const { refreshBackground = true } = options;

    if (!this.views[viewId]) {
      // Create new view if it doesn't exist
      this.views[viewId] = {
        id: viewId,
        image: null,
        canvasData: null,
        metadata: null,
        rotation: 0,
      };
    }

    this.views[viewId].image = imageUrl;

    // Only refresh background if explicitly requested and this is the current view
    // This prevents flicker during batch uploads
    if (refreshBackground && this.currentViewId === viewId) {
      await this.setBackgroundImage(imageUrl);
    }
  }

  async setBackgroundImage(url, fitMode = 'fit-canvas') {
    console.log(`\n[Image Debug] ===== SET BACKGROUND IMAGE =====`);
    console.log(`[Image Debug] URL: ${url?.substring?.(0, 50)}...`);
    console.log(`[Image Debug] Fit mode: ${fitMode}`);

    return new Promise(resolve => {
      fabric.Image.fromURL(
        url,
        img => {
          const canvas = this.canvasManager.fabricCanvas;
          if (!canvas) {
            console.log('[Image Debug] ❌ No canvas available');
            return resolve();
          }

          // Get capture frame dimensions
          const captureFrame = document.getElementById('captureFrame');
          let frameWidth, frameHeight, frameLeft, frameTop;

          if (captureFrame) {
            const rect = captureFrame.getBoundingClientRect();
            frameWidth = rect.width;
            frameHeight = rect.height;
            frameLeft = rect.left;
            frameTop = rect.top;
          } else {
            // Fallback to canvas dimensions if no frame
            frameWidth = canvas.width;
            frameHeight = canvas.height;
            frameLeft = 0;
            frameTop = 0;
          }

          const imgWidth = img.width;
          const imgHeight = img.height;

          console.log(
            `[Image Debug] Frame: ${frameWidth}x${frameHeight} at (${frameLeft},${frameTop})\n` +
              `[Image Debug] Image: ${imgWidth}x${imgHeight}`
          );

          let scale = 1;

          // Center based on frame center
          let left = frameLeft + frameWidth / 2;
          let top = frameTop + frameHeight / 2;

          switch (fitMode) {
            case 'fit-width':
              scale = frameWidth / imgWidth;
              console.log(`[Image Fit Width] Scale: ${scale.toFixed(3)}`);
              break;

            case 'fit-height':
              scale = frameHeight / imgHeight;
              console.log(`[Image Fit Height] Scale: ${scale.toFixed(3)}`);
              break;

            case 'fit-canvas':
              scale = Math.min(frameWidth / imgWidth, frameHeight / imgHeight);
              console.log(`[Image Fit Canvas] Scale: ${scale.toFixed(3)}`);
              break;

            case 'actual-size':
              scale = 1;
              console.log(`[Image Actual Size] Scale: 1.000`);
              break;

            default:
              // Default to fit canvas (frame)
              scale = Math.min(frameWidth / imgWidth, frameHeight / imgHeight);
              console.log(`[Image Default] Scale: ${scale.toFixed(3)}`);
              break;
          }

          img.set({
            originX: 'center',
            originY: 'center',
            left: left,
            top: top,
            scaleX: scale,
            scaleY: scale,
            selectable: false,
            evented: false,
          });

          console.log(
            `[Image Debug] Applied settings:\n` +
              `  Position: (${left}, ${top})\n` +
              `  Scale: ${scale.toFixed(3)}x${scale.toFixed(3)}\n` +
              `  Scaled size: ${(imgWidth * scale).toFixed(1)}x${(imgHeight * scale).toFixed(1)}`
          );

          canvas.setBackgroundImage(img, canvas.requestRenderAll.bind(canvas));

          // Save fit mode for this view so resize can use it
          if (this.currentViewId && this.views[this.currentViewId]) {
            this.views[this.currentViewId].fitMode = fitMode;
            console.log(
              `[Image Debug] Saved fit mode '${fitMode}' for view: ${this.currentViewId}`
            );
          }

          console.log('[Image Debug] ✓ Background image set and rendered');
          console.log('[Image Debug] ===== BACKGROUND IMAGE SET COMPLETE =====\n');

          resolve();
        },
        { crossOrigin: 'anonymous' }
      );
    });
  }

  getViewList() {
    return Object.keys(this.views);
  }

  rotateCurrentView(deltaDegrees) {
    const view = this.views[this.currentViewId];
    if (!view) return;
    const nextRotation = this.canvasManager.rotateCanvasObjects(deltaDegrees);
    view.rotation = nextRotation;
    this.updateThumbnailRotation(this.currentViewId, nextRotation);
  }

  updateThumbnailRotation(viewId, rotationDegrees) {
    const normalized = ((rotationDegrees % 360) + 360) % 360;
    const needsScale = normalized === 90 || normalized === 270;
    const scale = needsScale ? 0.9 : 1;
    const targets = document.querySelectorAll('.image-thumbnail, .image-container');
    targets.forEach(container => {
      const label =
        container.dataset?.label ||
        container.getAttribute('title') ||
        container.dataset?.imageIndex ||
        container.id;
      if (label !== viewId) return;

      let preview = container;
      if (container.classList.contains('image-container')) {
        preview =
          container.querySelector('.image-thumbnail') ||
          container.querySelector('.image-thumb') ||
          container.querySelector('img') ||
          container.querySelector('canvas');
        if (!preview) return;
      }

      preview.style.transform = `rotate(${normalized}deg) scale(${scale})`;
      preview.style.transformOrigin = '50% 50%';
      preview.dataset.rotation = String(normalized);
      if (preview.classList && preview.classList.contains('image-thumbnail')) {
        preview.style.overflow = 'hidden';
      }
    });
  }

  deleteImage(viewId) {
    if (!this.views[viewId]) {
      console.warn(`View ${viewId} does not exist.`);
      return;
    }

    // Remove from views
    delete this.views[viewId];

    // If we deleted the current view, switch to another one
    if (this.currentViewId === viewId) {
      const remainingViews = Object.keys(this.views);
      if (remainingViews.length > 0) {
        this.switchView(remainingViews[0]);
      } else {
        // No views left, clear canvas
        this.currentViewId = null;
        this.canvasManager.clear();
        if (this.canvasManager.fabricCanvas) {
          this.canvasManager.fabricCanvas.setBackgroundImage(
            null,
            this.canvasManager.fabricCanvas.requestRenderAll.bind(this.canvasManager.fabricCanvas)
          );
        }
      }
    }

    console.log(`Deleted view: ${viewId}`);
  }

  async shareProject() {
    let originalText = '';
    try {
      // Show loading state
      const shareBtn = document.getElementById('shareProjectBtn');
      if (shareBtn) originalText = shareBtn.textContent;
      if (shareBtn) {
        shareBtn.textContent = 'Creating Share Link...';
        shareBtn.disabled = true;
      }

      // Prepare images as data URLs for portability across tabs

      // Prepare images as data URLs for portability across tabs

      // Strategy 1: Sync from window.imageGalleryData
      let galleryData = window.imageGalleryData;

      // Strategy 2: Try getter if direct access fails
      if (
        (!galleryData || galleryData.length === 0) &&
        window.imageGallery &&
        typeof window.imageGallery.getData === 'function'
      ) {
        galleryData = window.imageGallery.getData();
      }

      // Strategy 3: Scrape DOM if data is still missing
      if (!galleryData || galleryData.length === 0) {
        const thumbnails = document.querySelectorAll('.image-thumbnail');
        if (thumbnails.length > 0) {
          galleryData = [];
          thumbnails.forEach((thumb, index) => {
            const style = thumb.style.backgroundImage; // url("...")
            const title = thumb.title || thumb.getAttribute('title');
            let src = '';
            if (style && style.includes('url')) {
              src = style.slice(style.indexOf('url(') + 4, style.lastIndexOf(')'));
              if (src.startsWith('"') || src.startsWith("'")) {
                src = src.slice(1, -1);
              }
            }
            if (src) {
              galleryData.push({
                src: src,
                name: title || `image_${index}`,
                original: { label: title || `image_${index}` },
              });
            }
          });
        }
      }

      // Apply found data
      if (galleryData && galleryData.length > 0) {
        window.originalImages = window.originalImages || {};
        galleryData.forEach(item => {
          const label =
            item.original?.label || item.name || 'image_' + Math.random().toString(36).substr(2, 9);
          // Always update if we have a source
          if (item.src) {
            if (!window.originalImages[label]) {
              window.originalImages[label] = item.src;
            }
          }
        });
      }

      async function toDataUrl(src) {
        try {
          const resp = await fetch(src);
          const blob = await resp.blob();
          return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        } catch (e) {
          console.error('Failed to convert to Data URL:', src);
          return null;
        }
      }
      async function convertOriginalImages(images) {
        const result = {};
        const labels = Object.keys(images || {});
        for (const label of labels) {
          const src = images[label];
          if (!src) continue;
          if (typeof src === 'string' && src.startsWith('data:')) {
            result[label] = src;
          } else {
            const dataUrl = await toDataUrl(src);
            if (dataUrl) {
              result[label] = dataUrl;
            }
          }
        }
        return result;
      }

      const originalImagesForShare = await convertOriginalImages(window.originalImages || {});

      // Determine robust image label list
      let labelsFromOrder =
        Array.isArray(window.orderedImageLabels) && window.orderedImageLabels.length
          ? window.orderedImageLabels.slice()
          : [];
      const labelsFromTags = Object.keys(window.imageTags || {});
      const labelsFromImages = Object.keys(window.originalImages || {});
      const labelsFromState =
        window.paintApp && window.paintApp.state && Array.isArray(window.paintApp.state.imageLabels)
          ? window.paintApp.state.imageLabels
          : [];

      // Fallback to ProjectManager views if globals are empty
      if (
        labelsFromOrder.length === 0 &&
        labelsFromTags.length === 0 &&
        labelsFromImages.length === 0 &&
        labelsFromState.length === 0
      ) {
        if (this.views) {
          labelsFromOrder = Object.keys(this.views);
        }
      }

      const imageLabels = labelsFromOrder.length
        ? labelsFromOrder
        : labelsFromTags.length
          ? labelsFromTags
          : labelsFromImages.length
            ? labelsFromImages
            : labelsFromState;

      let currentImageLabel =
        (window.paintApp && window.paintApp.state && window.paintApp.state.currentImageLabel) ||
        imageLabels[0] ||
        null;

      // Fallback to ProjectManager current view
      if (!currentImageLabel && this.currentViewId) {
        currentImageLabel = this.currentViewId;
      }

      // Collect project data for sharing
      const projectData = {
        currentImageLabel,
        imageLabels,
        originalImages: originalImagesForShare,
        originalImageDimensions: window.originalImageDimensions || {},
        strokes: window.vectorStrokesByImage || {},
        strokeVisibility: window.strokeVisibilityByImage || {},
        strokeSequence: window.lineStrokesByImage || {},
        strokeMeasurements: window.strokeMeasurements || {},
        strokeLabelVisibility: window.strokeLabelVisibility || {},
        imageScales: window.paintApp?.state?.imageScaleByLabel || {},
        imagePositions: window.paintApp?.state?.imagePositionByLabel || {},
        customImageNames: window.customImageNames || {},
      };

      // Include custom label positions and rotation stamps for accurate label placement
      try {
        projectData.customLabelPositions = {};
        imageLabels.forEach(label => {
          projectData.customLabelPositions[label] =
            window.customLabelPositions && window.customLabelPositions[label]
              ? JSON.parse(JSON.stringify(window.customLabelPositions[label]))
              : {};
        });
        if (window.customLabelOffsetsRotationByImageAndStroke) {
          projectData.customLabelRotationStamps = {};
          imageLabels.forEach(label => {
            projectData.customLabelRotationStamps[label] = window
              .customLabelOffsetsRotationByImageAndStroke[label]
              ? JSON.parse(JSON.stringify(window.customLabelOffsetsRotationByImageAndStroke[label]))
              : {};
          });
        }
      } catch (e) {
        // best-effort; ignore if deep copy fails
      }

      // Share options
      const shareOptions = {
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
        isPublic: true,
        allowEditing: false,
        measurements: {},
      };

      // Convert Blob URLs to Data URLs for sharing
      const processedProjectData = await this.convertBlobsToDataUrls(projectData);

      // Send to backend
      const response = await fetch('/api/share-project', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: document.getElementById('projectName')?.value || 'OpenPaint Project',
          projectData: processedProjectData,
          shareOptions: shareOptions,
        }),
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.message || 'Failed to create share link');
      }

      // Show share dialog
      this.showShareDialog(result.shareUrl, result.expiresAt);

      // Show success message
      this.showStatusMessage('Share link created successfully!', 'success');

      // Persist share info for future updates
      try {
        window.lastShareId = result.shareId;
        window.lastEditToken = result.editToken;
        if (window.localStorage) {
          localStorage.setItem('openpaint:lastShareId', result.shareId);
          localStorage.setItem('openpaint:lastEditToken', result.editToken);
        }
      } catch (e) {
        // ignore storage errors
      }
    } catch (error) {
      console.error('Error creating share link:', error);

      this.showStatusMessage('Failed to create share link: ' + error.message, 'error');
    } finally {
      // Restore button state
      const shareBtn = document.getElementById('shareProjectBtn');
      if (shareBtn) {
        shareBtn.textContent = originalText || 'Share';
        shareBtn.disabled = false;
      }
    }
  }

  async updateSharedProject() {
    try {
      const shareId =
        window.lastShareId ||
        (window.localStorage && localStorage.getItem('openpaint:lastShareId'));
      const editToken =
        window.lastEditToken ||
        (window.localStorage && localStorage.getItem('openpaint:lastEditToken'));
      if (!shareId || !editToken) {
        const msg = 'No existing share info found. Create a share link first.';
        this.showStatusMessage(msg, 'error');
        return;
      }

      const btn = document.getElementById('updateShareBtn');
      if (btn) {
        btn.textContent = 'Updating...';
        btn.disabled = true;
      }

      // Strategy 1: Sync from window.imageGalleryData
      let galleryData = window.imageGalleryData;

      // Strategy 2: Try getter if direct access fails
      if (
        (!galleryData || galleryData.length === 0) &&
        window.imageGallery &&
        typeof window.imageGallery.getData === 'function'
      ) {
        galleryData = window.imageGallery.getData();
      }

      // Strategy 3: Scrape DOM if data is still missing
      if (!galleryData || galleryData.length === 0) {
        const thumbnails = document.querySelectorAll('.image-thumbnail');
        if (thumbnails.length > 0) {
          galleryData = [];
          thumbnails.forEach((thumb, index) => {
            const style = thumb.style.backgroundImage;
            const title = thumb.title || thumb.getAttribute('title');
            let src = '';
            if (style && style.includes('url')) {
              src = style.slice(style.indexOf('url(') + 4, style.lastIndexOf(')'));
              if (src.startsWith('"') || src.startsWith("'")) {
                src = src.slice(1, -1);
              }
            }
            if (src) {
              galleryData.push({
                src: src,
                name: title || `image_${index}`,
                original: { label: title || `image_${index}` },
              });
            }
          });
        }
      }

      // Apply found data
      if (galleryData && galleryData.length > 0) {
        window.originalImages = window.originalImages || {};
        galleryData.forEach(item => {
          const label =
            item.original?.label || item.name || 'image_' + Math.random().toString(36).substr(2, 9);
          if (item.src && !window.originalImages[label]) {
            window.originalImages[label] = item.src;
          }
        });
      }

      const projectData = {
        currentImageLabel: window.paintApp?.state?.currentImageLabel,
        imageLabels: window.paintApp?.state?.imageLabels || [],
        originalImages: window.originalImages || {},
        originalImageDimensions: window.originalImageDimensions || {},
        strokes: window.vectorStrokesByImage || {},
        strokeVisibility: window.strokeVisibilityByImage || {},
        strokeSequence: window.lineStrokesByImage || {},
        strokeMeasurements: window.strokeMeasurements || {},
        strokeLabelVisibility: window.strokeLabelVisibility || {},
        imageScales: window.paintApp?.state?.imageScaleByLabel || {},
        imagePositions: window.paintApp?.state?.imagePositionByLabel || {},
        customImageNames: window.customImageNames || {},
      };

      const response = await fetch(`/api/shared/${shareId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          editToken,
          title: document.getElementById('projectName')?.value || null,
          projectData,
          shareOptions: {},
        }),
      });
      const result = await response.json();
      if (!result.success) {
        throw new Error(result.message || 'Failed to update shared project');
      }

      this.showStatusMessage('Shared project updated.', 'success');
    } catch (error) {
      console.error('Error updating shared project:', error);
      this.showStatusMessage('Failed to update share: ' + error.message, 'error');
    } finally {
      const btn = document.getElementById('updateShareBtn');
      if (btn) {
        btn.textContent = 'Update Share';
        btn.disabled = false;
      }
    }
  }

  showShareDialog(shareUrl, expiresAt) {
    // Create modal dialog
    const modal = document.createElement('div');
    modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            font-family: Arial, sans-serif;
        `;

    const dialog = document.createElement('div');
    dialog.style.cssText = `
            background: white;
            border-radius: 15px;
            padding: 30px;
            max-width: 600px;
            width: 90%;
            box-shadow: 0 20px 40px rgba(0,0,0,0.2);
            max-height: 90vh;
            overflow-y: auto;
        `;

    const expiryDate = new Date(expiresAt).toLocaleDateString();
    const editToken =
      window.lastEditToken ||
      (window.localStorage && localStorage.getItem('openpaint:lastEditToken'));
    // Construct production URL
    const productionUrl =
      shareUrl.replace('/shared/', '/production/') + (editToken ? `?editToken=${editToken}` : '');

    dialog.innerHTML = `
            <h2 style="color: #2c3e50; margin: 0 0 20px 0; font-size: 1.5em;">🔗 Project Shared Successfully</h2>
            
            <div style="margin-bottom: 25px;">
                <h3 style="font-size: 1.1em; color: #007bff; margin-bottom: 10px;">👤 Customer Link</h3>
                <p style="color: #666; font-size: 0.9em; margin-bottom: 10px;">
                    Share this link with your customer to collect measurements:
                </p>
                <div style="background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 10px; display: flex; gap: 10px;">
                    <input type="text" value="${shareUrl}" readonly style="flex: 1; border: none; background: transparent; font-family: monospace; font-size: 13px; outline: none;">
                    <button class="copy-btn" data-target="${shareUrl}" style="background: #e9ecef; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; font-size: 12px;">Copy</button>
                </div>
            </div>

            <div style="margin-bottom: 25px; padding-top: 20px; border-top: 1px solid #eee;">
                <h3 style="font-size: 1.1em; color: #dc3545; margin-bottom: 10px;">🏭 Production Team Link</h3>
                <p style="color: #666; font-size: 0.9em; margin-bottom: 10px;">
                    Use this <strong>internal</strong> link to view the project and submitted measurements. <br>
                    <span style="color: #dc3545; font-size: 0.85em;">⚠️ Do not share this with customers.</span>
                </p>
                <div style="background: #fff5f5; border: 1px solid #ffeeba; border-radius: 8px; padding: 10px; display: flex; gap: 10px;">
                    <input type="text" value="${productionUrl}" readonly style="flex: 1; border: none; background: transparent; font-family: monospace; font-size: 13px; outline: none; color: #dc3545;">
                    <button class="copy-btn" data-target="${productionUrl}" style="background: #ffeeba; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; font-size: 12px; color: #856404;">Copy</button>
                </div>
            </div>
            
            <div style="display: flex; gap: 10px; margin-bottom: 20px;">
                <button id="openCustomerBtn" style="flex: 1; background: #007bff; color: white; border: none; padding: 12px; border-radius: 8px; cursor: pointer; font-weight: 600;">
                    Open Customer View
                </button>
                <button id="openProductionBtn" style="flex: 1; background: #6c757d; color: white; border: none; padding: 12px; border-radius: 8px; cursor: pointer; font-weight: 600;">
                    Open Production View
                </button>
            </div>
            
            <p style="color: #666; font-size: 12px; margin-bottom: 20px; text-align: center;">
                ⏰ Link expires: ${expiryDate}
            </p>
            
            <div style="text-align: center;">
                <button id="closeModalBtn" style="background: transparent; color: #666; border: 1px solid #ccc; padding: 8px 20px; border-radius: 8px; cursor: pointer;">
                    Close
                </button>
            </div>
        `;

    modal.appendChild(dialog);
    document.body.appendChild(modal);

    // Event listeners
    modal.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const text = btn.dataset.target;
        try {
          await navigator.clipboard.writeText(text);
          const originalText = btn.textContent;
          btn.textContent = 'Copied!';
          setTimeout(() => (btn.textContent = originalText), 2000);
        } catch (err) {
          console.error('Failed to copy:', err);
        }
      });
    });

    document
      .getElementById('openCustomerBtn')
      .addEventListener('click', () => window.open(shareUrl, '_blank'));
    document
      .getElementById('openProductionBtn')
      .addEventListener('click', () => window.open(productionUrl, '_blank'));

    document.getElementById('closeModalBtn').addEventListener('click', () => {
      document.body.removeChild(modal);
    });

    modal.addEventListener('click', e => {
      if (e.target === modal) document.body.removeChild(modal);
    });
  }

  showStatusMessage(message, type = 'info') {
    // Simple toast implementation if not available elsewhere
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: ${type === 'error' ? '#ef4444' : type === 'success' ? '#22c55e' : '#3b82f6'};
            color: white;
            padding: 10px 20px;
            border-radius: 8px;
            z-index: 10000;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            font-family: system-ui, -apple-system, sans-serif;
            opacity: 0;
            transition: opacity 0.3s ease;
        `;
    document.body.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
    });

    // Remove after 3 seconds
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => document.body.removeChild(toast), 300);
    }, 3000);
  }

  async convertBlobsToDataUrls(data) {
    if (!data) return data;

    // Helper to convert a single blob URL
    const blobUrlToDataUrl = async blobUrl => {
      try {
        const response = await fetch(blobUrl);
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } catch (e) {
        console.warn('Failed to convert blob URL:', blobUrl, e);
        return blobUrl; // Return original if conversion fails
      }
    };

    // Deep clone to avoid mutating original
    const clone = JSON.parse(JSON.stringify(data));

    // Recursive traversal
    const traverse = async obj => {
      if (!obj || typeof obj !== 'object') return;

      for (const key in obj) {
        const value = obj[key];
        if (typeof value === 'string' && value.startsWith('blob:')) {
          obj[key] = await blobUrlToDataUrl(value);
        } else if (typeof value === 'object') {
          await traverse(value);
        }
      }
    };

    await traverse(clone);
    return clone;
  }

  getCanvasCustomProps() {
    return [
      'strokeMetadata',
      'isTag',
      'isTagText',
      'labelVisible',
      'visible',
      'connectedTo',
      'tagLabel',
      'isConnectorLine',
      'perPixelTargetFind',
    ];
  }

  sanitizeCanvasJSON(canvasData) {
    if (!canvasData || typeof canvasData !== 'object') {
      return canvasData;
    }

    const validTextBaselines = ['top', 'hanging', 'middle', 'alphabetic', 'ideographic', 'bottom'];

    const sanitizeObject = obj => {
      if (!obj || typeof obj !== 'object') return obj;

      if (Array.isArray(obj)) {
        return obj.map(item => sanitizeObject(item));
      }

      const sanitized = { ...obj };

      if (sanitized.textBaseline && !validTextBaselines.includes(sanitized.textBaseline)) {
        console.warn(
          `[Sanitize] Invalid textBaseline "${sanitized.textBaseline}", replacing with "alphabetic"`
        );
        sanitized.textBaseline = 'alphabetic';
      }

      for (const key in sanitized) {
        if (typeof sanitized[key] === 'object') {
          sanitized[key] = sanitizeObject(sanitized[key]);
        }
      }

      return sanitized;
    };

    return sanitizeObject(canvasData);
  }

  async getProjectData() {
    this.saveCurrentViewState();

    const projectNameInput = document.getElementById('projectName');
    const projectName = projectNameInput?.value?.trim() || 'OpenPaint Project';
    const fabricCanvas = this.canvasManager?.fabricCanvas;
    const metadataManager = window.app?.metadataManager;
    const customProps = this.getCanvasCustomProps();

    console.log('[Save] Gathering project data');

    const deepClone = obj => {
      if (!obj) return {};
      try {
        return JSON.parse(JSON.stringify(obj));
      } catch (e) {
        console.warn('[Save] Failed to clone object', e);
        return {};
      }
    };

    const projectData = {
      version: '2.0-fabric',
      projectName,
      name: projectName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      currentViewId: this.currentViewId,
      views: {},
    };

    const viewIds = Object.keys(this.views || {});
    console.log('[Save] Views to persist:', viewIds);

    for (const viewId of viewIds) {
      const view = this.views[viewId] || {};
      const entry = {
        canvasJSON: null,
        imageDataURL: null,
        imageUrl: view.image || null,
        metadata: {},
      };

      if (viewId === this.currentViewId && fabricCanvas) {
        console.log(`[Save] Capturing live canvas for view ${viewId}`);
        entry.canvasJSON = fabricCanvas.toJSON(customProps);
      } else {
        entry.canvasJSON = view.canvasData || null;
      }

      if (view.image) {
        try {
          console.log(`[Save] Embedding image for view ${viewId}`);
          entry.imageDataURL = await this.fetchImageAsDataURL(view.image);
        } catch (err) {
          console.warn(`[Save] Could not capture image for ${viewId}:`, err);
        }
      }

      if (metadataManager) {
        entry.metadata = {
          vectorStrokesByImage: deepClone(metadataManager.vectorStrokesByImage?.[viewId]),
          strokeVisibilityByImage: deepClone(metadataManager.strokeVisibilityByImage?.[viewId]),
          strokeLabelVisibility: deepClone(metadataManager.strokeLabelVisibility?.[viewId]),
          strokeMeasurements: deepClone(metadataManager.strokeMeasurements?.[viewId]),
        };
      } else if (view.metadata) {
        entry.metadata = deepClone(view.metadata);
      }

      projectData.views[viewId] = entry;
    }

    return projectData;
  }

  async saveProject() {
    const projectNameInput = document.getElementById('projectName');
    const projectName = projectNameInput?.value?.trim() || 'OpenPaint Project';
    const downloadName = `${projectName.replace(/\s+/g, '_')}_fabric.json`;

    try {
      console.log('[Save] Starting saveProject');
      if (!this.canvasManager?.fabricCanvas) {
        this.showStatusMessage('Canvas not ready; cannot save.', 'error');
        console.error('[Save] fabricCanvas missing');
        return;
      }

      const projectData = await this.getProjectData();

      await this.downloadProjectData(projectData, downloadName);

      const authManager = window.app?.authManager;
      const cloudManager = window.app?.cloudProjectManager;
      const user = authManager?.getUser ? authManager.getUser() : null;

      if (user && cloudManager?.saveProject) {
        const result = await cloudManager.saveProject(projectData);
        if (result?.error) {
          console.error('[Save] Cloud save failed:', result.error);
          this.showStatusMessage('Project saved locally. Cloud save failed.', 'error');
          return;
        }
        this.showStatusMessage('Project saved locally and to cloud.', 'success');
      } else {
        this.showStatusMessage('Project saved locally.', 'success');
      }
    } catch (error) {
      console.error('[Save] Failed to save project:', error);
      this.showStatusMessage('Failed to save project: ' + error.message, 'error');
    }
  }

  async fetchImageAsDataURL(url) {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async downloadProjectData(projectData, fileName) {
    const jsonStr = JSON.stringify(projectData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName || 'project_fabric.json';
    a.click();
    URL.revokeObjectURL(url);
    console.log('[Save] Downloaded project as:', fileName);
  }

  async loadProject(file) {
    try {
      console.log('[Load] Loading project file:', file.name);

      const text = await file.text();
      const projectData = JSON.parse(text);

      console.log('[Load] Parsed project data:', projectData.projectName || projectData.name);

      if (!projectData.version || !projectData.version.startsWith('2.0')) {
        this.showStatusMessage(
          'This appears to be a legacy project format. Please use the legacy loader.',
          'error'
        );
        console.error('[Load] Unsupported project version:', projectData.version);
        return;
      }

      if (!projectData.views) {
        this.showStatusMessage('Invalid project format: missing views', 'error');
        return;
      }

      // Update project name
      const projectNameInput = document.getElementById('projectName');
      if (projectNameInput && projectData.projectName) {
        projectNameInput.value = projectData.projectName;
      }

      // Clear existing views and recreate from saved data
      this.views = {};

      // Load each view
      const viewIds = Object.keys(projectData.views);
      console.log('[Load] Loading views:', viewIds);

      for (const viewId of viewIds) {
        const viewData = projectData.views[viewId];

        this.views[viewId] = {
          id: viewId,
          image: null,
          canvasData: viewData.canvasJSON,
          metadata: viewData.metadata || {},
        };

        // Restore image from data URL if available
        if (viewData.imageDataURL) {
          this.views[viewId].image = viewData.imageDataURL;
          console.log(`[Load] Restored image for view ${viewId} from data URL`);
        } else if (viewData.imageUrl) {
          this.views[viewId].image = viewData.imageUrl;
          console.log(`[Load] Using image URL for view ${viewId}`);
        }

        // Register view with legacy system for compatibility
        if (this.views[viewId].image && window.addImageToSidebar) {
          const label = viewId;
          const filename = `${projectData.projectName || 'Project'} - ${viewId}`;
          console.log(`[Load] Registering view ${viewId} with legacy system`);
          window.addImageToSidebar(this.views[viewId].image, label, filename);
        }
      }

      // Switch to the saved current view or first view
      const targetView = projectData.currentViewId || viewIds[0];
      if (targetView && this.views[targetView]) {
        console.log(`[Load] Switching to view: ${targetView}`);
        await this.switchView(targetView);
      }

      this.showStatusMessage('Project loaded successfully', 'success');
      console.log('[Load] Project load complete');
    } catch (error) {
      console.error('[Load] Failed to load project:', error);
      this.showStatusMessage('Failed to load project: ' + error.message, 'error');
    }
  }

  promptLoadProject() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async e => {
      const file = e.target.files[0];
      if (file) {
        await this.loadProject(file);
      }
    };
    input.click();
  }
}
