// Project Manager
// Handles views (images) and their associated canvas states

export class ProjectManager {
  constructor(canvasManager, historyManager) {
    this.canvasManager = canvasManager;
    this.historyManager = historyManager;

    // Project Data
    this.currentViewId = 'front';
    this.views = {
      front: { id: 'front', image: null, canvasData: null, metadata: null },
      side: { id: 'side', image: null, canvasData: null, metadata: null },
      back: { id: 'back', image: null, canvasData: null, metadata: null },
      cushion: { id: 'cushion', image: null, canvasData: null, metadata: null },
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
      return;
    }

    console.log(`Switching to view: ${viewId}`);

    // 1. Save current state
    this.saveCurrentViewState();

    // 2. Clear history for the new view (or we could maintain separate history stacks per view)
    this.historyManager.clear();

    // 3. Switch context
    this.currentViewId = viewId;
    const view = this.views[viewId];

    // 4. Clear canvas
    this.canvasManager.clear();

    // 5. Load background image if exists
    if (view.image) {
      await this.setBackgroundImage(view.image);
    }

    // 6. Restore canvas objects (strokes/text)
    if (view.canvasData) {
      this.canvasManager.loadFromJSON(view.canvasData, () => {
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

        // Recreate tags after metadata is rebuilt (tags are not serialized)
        if (window.app?.tagManager) {
          window.app.tagManager.recreateTagsForImage(viewId);
        }
      });
    } else {
      // Clear metadata for this view if no saved data
      if (window.app?.metadataManager) {
        window.app.metadataManager.clearImageMetadata(viewId);
      }
      this.historyManager.saveState();
    }
  }

  saveCurrentViewState() {
    const json = this.canvasManager.toJSON();
    if (this.views[this.currentViewId]) {
      this.views[this.currentViewId].canvasData = json;

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
      this.views[viewId] = { id: viewId, image: null, canvasData: null, metadata: null };
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

          const canvasWidth = canvas.width;
          const canvasHeight = canvas.height;
          const imgWidth = img.width;
          const imgHeight = img.height;

          console.log(
            `[Image Debug] Canvas: ${canvasWidth}x${canvasHeight} (aspect: ${(canvasWidth / canvasHeight).toFixed(3)})\n` +
              `[Image Debug] Image:  ${imgWidth}x${imgHeight} (aspect: ${(imgWidth / imgHeight).toFixed(3)})`
          );

          let scale = 1;
          let left = canvasWidth / 2;
          let top = canvasHeight / 2;

          switch (fitMode) {
            case 'fit-width':
              scale = canvasWidth / imgWidth;
              console.log(
                `[Image Fit Width] Canvas: ${canvasWidth}x${canvasHeight}, Image: ${imgWidth}x${imgHeight}, Scale: ${scale.toFixed(3)}`
              );
              break;

            case 'fit-height':
              scale = canvasHeight / imgHeight;
              console.log(
                `[Image Fit Height] Canvas: ${canvasWidth}x${canvasHeight}, Image: ${imgWidth}x${imgHeight}, Scale: ${scale.toFixed(3)}`
              );
              break;

            case 'fit-canvas':
              scale = Math.min(canvasWidth / imgWidth, canvasHeight / imgHeight);
              console.log(
                `[Image Fit Canvas] Canvas: ${canvasWidth}x${canvasHeight}, Image: ${imgWidth}x${imgHeight}, Scale: ${scale.toFixed(3)}`
              );
              break;

            case 'actual-size':
              scale = 1;
              console.log(
                `[Image Actual Size] Canvas: ${canvasWidth}x${canvasHeight}, Image: ${imgWidth}x${imgHeight}, Scale: 1.000`
              );
              break;

            default:
              // Default to fit canvas
              scale = Math.min(canvasWidth / imgWidth, canvasHeight / imgHeight);
              console.log(
                `[Image Default] Canvas: ${canvasWidth}x${canvasHeight}, Image: ${imgWidth}x${imgHeight}, Scale: ${scale.toFixed(3)}`
              );
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
}
