const DEFAULT_READY_TIMEOUT_MS = 5000;
const DEFAULT_READY_POLL_MS = 100;

function resolveImageRegistryEnabled() {
  if (typeof window === 'undefined') return false;
  if (typeof window.__IMAGE_REGISTRY_ENABLED__ === 'boolean') {
    return window.__IMAGE_REGISTRY_ENABLED__;
  }
  return window.location?.hostname === 'localhost';
}

function isLocalDevHost() {
  if (typeof window === 'undefined') return false;
  return window.location?.hostname === 'localhost';
}

class ImageRegistry {
  constructor() {
    this.enabled = resolveImageRegistryEnabled();
    this.projectManager = null;
    this.registered = new Map();
    this.ready = false;
    this.readyReason = null;
    this.readyTimestamp = null;
    this._readyPromise = new Promise(resolve => {
      this._resolveReady = resolve;
    });
    this._watcherStarted = false;

    if (this.enabled) {
      this.start();
    } else {
      this._markReady('disabled');
    }
  }

  isEnabled() {
    return this.enabled;
  }

  bindProjectManager(projectManager) {
    this.projectManager = projectManager;
  }

  start() {
    if (this._watcherStarted || !this.enabled) return;
    this._watcherStarted = true;
    this._startReadyWatcher();
  }

  whenReady() {
    return this._readyPromise;
  }

  reset() {
    this.registered.clear();
  }

  async registerImage(viewId, imageUrl, filename, options = {}) {
    if (!this.enabled) {
      return { status: 'disabled' };
    }

    const normalizedOptions = typeof options === 'string' ? { source: options } : options || {};
    const source = normalizedOptions.source || 'unknown';

    await this.whenReady();

    if (!viewId || !imageUrl) {
      console.warn('[ImageRegistry] registerImage called with missing data', { viewId, imageUrl });
      return { status: 'invalid' };
    }

    const existing = this.registered.get(viewId);
    const isSameUrl = existing && existing.url === imageUrl;
    if (isSameUrl) {
      console.log('[ImageRegistry] registerImage deduped', { viewId, source });
      return { status: 'deduped' };
    }

    const isUpdate = Boolean(existing);
    this.registered.set(viewId, {
      url: imageUrl,
      filename,
      source,
      updatedAt: new Date().toISOString(),
    });

    console.log('[ImageRegistry] registerImage', { viewId, source });

    if (this.projectManager?.addImage) {
      await this.projectManager.addImage(viewId, imageUrl, {
        refreshBackground: Boolean(normalizedOptions.refreshBackground),
      });
    }

    const hasAddImageToSidebar = typeof window.addImageToSidebar === 'function';
    if (hasAddImageToSidebar && !isUpdate) {
      window.addImageToSidebar(imageUrl, viewId, filename);
    }

    const galleryHasView = this._galleryHasView(viewId);
    const allowDirectGalleryAdd =
      !hasAddImageToSidebar || (this.readyReason === 'timeout' && !galleryHasView);

    if (allowDirectGalleryAdd) {
      this._ensureGalleryEntry(viewId, imageUrl, filename, normalizedOptions);
    } else if (isUpdate && galleryHasView) {
      this._updateGalleryEntry(viewId, imageUrl, filename, normalizedOptions);
    }

    if (isUpdate) {
      this._updateLegacySidebar(viewId, imageUrl, filename);
    }

    this._assertRegistration(viewId, imageUrl);

    return { status: isUpdate ? 'updated' : 'registered' };
  }

  _startReadyWatcher() {
    const startedAt = Date.now();
    const poll = () => {
      if (this.ready) return;

      if (window.addImageToSidebar && window.addImageToSidebar.__galleryHooked) {
        this._markReady('hook');
        return;
      }

      const elapsed = Date.now() - startedAt;
      if (elapsed > DEFAULT_READY_TIMEOUT_MS) {
        console.error('[ImageRegistry] Ready timeout: gallery hook not detected.');
        if (isLocalDevHost() || window.__DEBUG__) {
          console.trace('[ImageRegistry] Ready timeout stack');
        }
        this._markReady('timeout');
        return;
      }

      setTimeout(poll, DEFAULT_READY_POLL_MS);
    };

    poll();
  }

  _markReady(reason) {
    if (this.ready) return;
    this.ready = true;
    this.readyReason = reason;
    this.readyTimestamp = new Date().toISOString();
    console.log(`[ImageRegistry] Ready (${reason}) at ${this.readyTimestamp}`);
    this._resolveReady(true);
  }

  _galleryHasView(viewId) {
    const galleryData =
      (window.imageGallery && typeof window.imageGallery.getData === 'function'
        ? window.imageGallery.getData()
        : window.imageGalleryData) || [];

    return galleryData.some(item => {
      const label = item?.original?.label || item?.label || item?.name;
      return label === viewId;
    });
  }

  _ensureGalleryEntry(viewId, imageUrl, filename, options) {
    const existingIndex = this._findGalleryIndex(viewId);
    if (existingIndex >= 0) {
      this._updateGalleryEntry(viewId, imageUrl, filename, options, existingIndex);
      return;
    }

    const imageData = this._buildGalleryData(viewId, imageUrl, filename, options);

    if (typeof window.addImageToGalleryCompat === 'function') {
      window.addImageToGalleryCompat(imageData);
      return;
    }

    if (window.imageGallery && typeof window.imageGallery.addImage === 'function') {
      const index = (window.imageGallery.getData?.() || []).length;
      window.imageGallery.addImage(imageData, index);
      return;
    }

    console.warn('[ImageRegistry] Gallery not available to register image', { viewId });
  }

  _updateGalleryEntry(viewId, imageUrl, filename, options, existingIndex) {
    const index = existingIndex ?? this._findGalleryIndex(viewId);
    if (index < 0) return;

    const galleryData =
      (window.imageGallery && typeof window.imageGallery.getData === 'function'
        ? window.imageGallery.getData()
        : window.imageGalleryData) || [];

    const imageData = this._buildGalleryData(viewId, imageUrl, filename, options);
    galleryData[index] = {
      ...galleryData[index],
      ...imageData,
      original: {
        ...(galleryData[index]?.original || {}),
        ...(imageData.original || {}),
      },
    };

    const gallery = document.getElementById('imageGallery');
    if (!gallery) return;

    const thumbnail = gallery.querySelector(`[data-image-index="${index}"]`);
    if (thumbnail) {
      thumbnail.style.backgroundImage = `url(${imageUrl})`;
      thumbnail.title = filename || viewId;
    }

    const caption = thumbnail?.parentElement?.querySelector('.thumb-caption');
    if (caption && filename) {
      caption.textContent = filename;
    }
  }

  _updateLegacySidebar(viewId, imageUrl, filename) {
    const container = document.querySelector(`#imageList [data-label="${viewId}"]`);
    if (!container) return;

    const img = container.querySelector('img');
    if (img && imageUrl) {
      img.src = imageUrl;
    }

    if (filename) {
      container.setAttribute('title', filename);
    }
  }

  _buildGalleryData(viewId, imageUrl, filename, options) {
    return {
      src: imageUrl,
      url: imageUrl,
      name: filename || viewId,
      label: viewId,
      original: {
        label: viewId,
        filename: options.originalFilename || filename,
        type: options.mimeType,
        uploadedAt: options.uploadedAt,
      },
    };
  }

  _findGalleryIndex(viewId) {
    const galleryData =
      (window.imageGallery && typeof window.imageGallery.getData === 'function'
        ? window.imageGallery.getData()
        : window.imageGalleryData) || [];

    return galleryData.findIndex(item => {
      const label = item?.original?.label || item?.label || item?.name;
      return label === viewId;
    });
  }

  _assertRegistration(viewId, imageUrl) {
    const viewImage = this.projectManager?.views?.[viewId]?.image;
    if (!viewImage) {
      console.warn('[ImageRegistry] ProjectManager missing image for view', { viewId });
    } else if (viewImage !== imageUrl) {
      console.warn('[ImageRegistry] ProjectManager image mismatch', { viewId });
    }

    if (!this._galleryHasView(viewId)) {
      console.warn('[ImageRegistry] Gallery missing image for view', { viewId });
    }
  }
}

export const imageRegistry = new ImageRegistry();
export const isImageRegistryEnabled = () => imageRegistry.isEnabled();
