// Upload Manager
// Handles file selection, drag/drop, paste uploads, and HEIC conversion via Cloudflare Worker

import { imageRegistry } from './ImageRegistry.js';

const DEFAULT_HEIC_WORKER_URL = 'https://YOUR-CLOUDFLARE-WORKER.example.com/convert';
const VIEW_PREFERENCE = ['front', 'side', 'back', 'cushion'];

export class UploadManager {
  constructor(projectManager) {
    this.projectManager = projectManager;
    this.heicWorkerUrl =
      window.HEIC_WORKER_URL || document.body?.dataset?.heicWorkerUrl || DEFAULT_HEIC_WORKER_URL;
    this.isHandlingUpload = false;
  }

  init() {
    this.setupUploadButton();
    this.setupDragAndDrop();
    this.setupPasteListener();
  }

  setupUploadButton() {
    const uploadButton = document.getElementById('paste');
    if (!uploadButton) {
      console.warn('[UploadManager] Upload button (#paste) not found.');
      return;
    }

    // Check if paint_backup.js already bound an upload handler
    // to prevent double file picker dialog
    if (uploadButton.__uploadBound) {
      console.log('[UploadManager] Upload button already bound by legacy system, skipping.');
    } else {
      uploadButton.__uploadBound = true;
      uploadButton.addEventListener('click', () => this.openFileDialog());
    }

    // Also bind the secondary upload button if it exists
    const secondaryButton = document.getElementById('paste-secondary');
    if (secondaryButton && !secondaryButton.__uploadBound) {
      secondaryButton.__uploadBound = true;
      secondaryButton.addEventListener('click', () => this.openFileDialog());
    }
  }

  setupDragAndDrop() {
    const dropTargets = [document.getElementById('canvas'), document.body].filter(Boolean);
    dropTargets.forEach(target => {
      target.addEventListener('dragover', e => {
        e.preventDefault();
        e.stopPropagation();
        target.classList.add('drag-over');
      });

      target.addEventListener('dragleave', () => {
        target.classList.remove('drag-over');
      });

      target.addEventListener('drop', e => {
        e.preventDefault();
        e.stopPropagation();
        target.classList.remove('drag-over');
        if (e.dataTransfer?.files?.length) {
          this.handleFiles(e.dataTransfer.files);
        }
      });
    });
  }

  setupPasteListener() {
    document.addEventListener('paste', e => {
      if (e.clipboardData?.files?.length) {
        this.handleFiles(e.clipboardData.files);
      }
    });
  }

  openFileDialog() {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'image/*,.heic,.heif';
    input.addEventListener('change', e => {
      if (e.target.files?.length) {
        this.handleFiles(e.target.files);
      }
    });
    input.click();
  }

  async handleFiles(fileList) {
    if (this.isHandlingUpload) {
      this.showStatus('Upload already in progress. Please wait...', 'info');
      return;
    }

    const files = Array.from(fileList || []);
    if (!files.length) return;

    if (window.app && !window.app.hasUploadedFirstImage) {
      window.app.hasUploadedFirstImage = true;
      if (typeof performance !== 'undefined' && performance.mark) {
        performance.mark('app-first-upload');
        if (performance.measure) {
          try {
            performance.measure('first-paint->first-upload', 'app-first-paint', 'app-first-upload');
            window.app?.logPerfMeasure?.('first-paint->first-upload');
          } catch (error) {
            console.warn('[Perf] Measure first upload failed', error);
          }
        }
      }
      window.dispatchEvent(new CustomEvent('firstupload'));
    }

    this.isHandlingUpload = true;

    this.showStatus(`Uploading ${files.length} image${files.length > 1 ? 's' : ''}...`, 'info');

    // Remember the current view before uploads to preserve it
    const currentViewBeforeUpload = this.projectManager.currentViewId;
    const hasExistingImage = !!this.projectManager.views?.[currentViewBeforeUpload]?.image;

    const results = [];

    for (const file of files) {
      try {
        const viewId = await this.processFile(file, {
          preserveCurrentView: hasExistingImage, // Only preserve if we already have an image
          currentViewBeforeUpload,
        });
        results.push({ file, viewId, success: true });
      } catch (error) {
        console.error('[UploadManager] Failed to process file:', file.name, error);
        this.showStatus(`Failed to process ${file.name}: ${error.message}`, 'error');
        results.push({ file, error, success: false });
      }
    }

    this.isHandlingUpload = false;

    const successCount = results.filter(r => r.success).length;
    if (successCount) {
      this.showStatus(
        `Uploaded ${successCount} image${successCount > 1 ? 's' : ''} successfully.`,
        'success'
      );
    }

    // Ensure we're still on the view we started with (unless no image was loaded before)
    if (hasExistingImage && this.projectManager.currentViewId !== currentViewBeforeUpload) {
      console.log(`[UploadManager] Restoring original view: ${currentViewBeforeUpload}`);
      await this.projectManager.switchView(currentViewBeforeUpload);
    }
  }

  async processFile(file, options = {}) {
    const { preserveCurrentView = false, currentViewBeforeUpload = null } = options;
    const perfId = `${file.name}-${Date.now()}`;
    const canMark = typeof performance !== 'undefined' && performance.mark;

    if (canMark) {
      performance.mark(`upload-start:${perfId}`);
    }

    let workingFile = file;

    if (this.isHeicFile(file)) {
      if (canMark) {
        performance.mark(`upload-heic-start:${perfId}`);
      }
      workingFile = await this.convertHeicFile(file);
      if (canMark && performance.measure) {
        try {
          performance.mark(`upload-heic-end:${perfId}`);
          performance.measure(
            'upload-heic-convert',
            `upload-heic-start:${perfId}`,
            `upload-heic-end:${perfId}`
          );
          window.app?.logPerfMeasure?.('upload-heic-convert');
        } catch (error) {
          console.warn('[Perf] Measure HEIC convert failed', error);
        }
      }
    }

    const objectUrl = URL.createObjectURL(workingFile);
    const viewId = this.getViewIdFromFilename(workingFile.name);
    const hadExistingImage = !!this.projectManager.views?.[viewId]?.image;
    const isCurrentView = this.projectManager.currentViewId === viewId;

    const displayName = this.formatDisplayName(workingFile.name, viewId);

    const useRegistry = typeof imageRegistry?.isEnabled === 'function' && imageRegistry.isEnabled();

    if (useRegistry) {
      if (canMark) {
        performance.mark(`upload-register-start:${perfId}`);
      }

      await imageRegistry.registerImage(viewId, objectUrl, displayName, {
        source: 'upload',
        refreshBackground: isCurrentView,
        mimeType: workingFile.type,
        originalFilename: workingFile.name,
        uploadedAt: new Date().toISOString(),
      });

      if (canMark && performance.measure) {
        try {
          performance.mark(`upload-register-end:${perfId}`);
          performance.measure(
            'upload-register',
            `upload-register-start:${perfId}`,
            `upload-register-end:${perfId}`
          );
          window.app?.logPerfMeasure?.('upload-register');
        } catch (error) {
          console.warn('[Perf] Measure upload register failed', error);
        }
      }
    } else {
      if (canMark) {
        performance.mark(`upload-project-start:${perfId}`);
      }

      // Add image to ProjectManager (but don't switch views automatically)
      await this.projectManager.addImage(viewId, objectUrl, {
        refreshBackground: isCurrentView, // Only refresh if this is the current view
      });

      if (canMark && performance.measure) {
        try {
          performance.mark(`upload-project-end:${perfId}`);
          performance.measure(
            'upload-project-add',
            `upload-project-start:${perfId}`,
            `upload-project-end:${perfId}`
          );
          window.app?.logPerfMeasure?.('upload-project-add');
        } catch (error) {
          console.warn('[Perf] Measure project add failed', error);
        }
      }

      if (canMark) {
        performance.mark(`upload-gallery-start:${perfId}`);
      }

      // Add to new gallery system
      if (typeof window.addImageToGalleryCompat === 'function') {
        window.addImageToGalleryCompat({
          src: objectUrl,
          name: displayName,
          original: {
            label: viewId,
            filename: workingFile.name,
            type: workingFile.type,
            uploadedAt: new Date().toISOString(),
          },
        });
      }

      if (canMark && performance.measure) {
        try {
          performance.mark(`upload-gallery-end:${perfId}`);
          performance.measure(
            'upload-gallery-add',
            `upload-gallery-start:${perfId}`,
            `upload-gallery-end:${perfId}`
          );
          window.app?.logPerfMeasure?.('upload-gallery-add');
        } catch (error) {
          console.warn('[Perf] Measure gallery add failed', error);
        }
      }

      if (canMark) {
        performance.mark(`upload-sidebar-start:${perfId}`);
      }

      // Also add to legacy sidebar system (for imageList and mini-stepper)
      if (typeof window.addImageToSidebar === 'function') {
        window.addImageToSidebar(objectUrl, viewId, displayName);
      }

      if (canMark && performance.measure) {
        try {
          performance.mark(`upload-sidebar-end:${perfId}`);
          performance.measure(
            'upload-sidebar-add',
            `upload-sidebar-start:${perfId}`,
            `upload-sidebar-end:${perfId}`
          );
          window.app?.logPerfMeasure?.('upload-sidebar-add');
        } catch (error) {
          console.warn('[Perf] Measure sidebar add failed', error);
        }
      }
    }

    if (canMark) {
      performance.mark(`upload-switch-start:${perfId}`);
    }

    // Only switch to this view if:
    // 1. It's a new image (not replacing existing)
    // 2. We're not preserving the current view (i.e., no image was loaded before)
    // 3. It's different from the current view
    if (!hadExistingImage && !preserveCurrentView && this.projectManager.currentViewId !== viewId) {
      // Only switch if we don't have any images loaded yet
      const hasAnyImages = Object.values(this.projectManager.views).some(v => v.image);
      if (!hasAnyImages) {
        await this.projectManager.switchView(viewId);
      }
    } else if (isCurrentView) {
      // If we're already on this view, just ensure the image is displayed
      await this.projectManager.setBackgroundImage(objectUrl);
    }

    if (canMark && performance.measure) {
      try {
        performance.mark(`upload-switch-end:${perfId}`);
        performance.measure(
          'upload-view-refresh',
          `upload-switch-start:${perfId}`,
          `upload-switch-end:${perfId}`
        );
        window.app?.logPerfMeasure?.('upload-view-refresh');
      } catch (error) {
        console.warn('[Perf] Measure view refresh failed', error);
      }
    }

    if (canMark && performance.measure) {
      try {
        performance.mark(`upload-end:${perfId}`);
        performance.measure('upload-total', `upload-start:${perfId}`, `upload-end:${perfId}`);
        window.app?.logPerfMeasure?.('upload-total');
      } catch (error) {
        console.warn('[Perf] Measure upload total failed', error);
      }
    }

    // Release object URL after Fabric loads it - DISABLED to prevent ERR_FILE_NOT_FOUND when switching views
    // The browser will clean up blob URLs when the page is unloaded
    // setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);

    return viewId;
  }

  isHeicFile(file) {
    const mime = (file.type || '').toLowerCase();
    const ext = this.getFileExtension(file.name);
    return mime === 'image/heic' || mime === 'image/heif' || ext === 'heic' || ext === 'heif';
  }

  async convertHeicFile(file) {
    if (!this.heicWorkerUrl || this.heicWorkerUrl.includes('YOUR-CLOUDFLARE-WORKER')) {
      throw new Error('HEIC conversion service not configured.');
    }

    // Show loading message with spinner
    this.showStatus(`Converting ${file.name}...`, 'loading');

    const formData = new FormData();
    formData.append('file', file, file.name);

    try {
      const response = await fetch(this.heicWorkerUrl, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const message = await this.safeReadError(response);
        throw new Error(`HEIC conversion failed (${response.status}): ${message}`);
      }

      const convertedBlob = await response.blob();
      const targetExtension = convertedBlob.type === 'image/png' ? '.png' : '.jpg';
      const convertedName = this.replaceExtension(file.name, targetExtension);

      // Show success message briefly
      this.showStatus(`Converted ${file.name} successfully`, 'success');

      return new File([convertedBlob], convertedName, { type: convertedBlob.type || 'image/jpeg' });
    } catch (error) {
      // Show error message
      this.showStatus(`Failed to convert ${file.name}`, 'error');
      throw error;
    }
  }

  async safeReadError(response) {
    try {
      const data = await response.json();
      return data?.message || response.statusText;
    } catch (err) {
      return response.statusText;
    }
  }

  getViewIdFromFilename(filename = '') {
    const name = filename.toLowerCase();

    // Try to find a keyword match, but make it unique if that view already has an image
    for (const keyword of VIEW_PREFERENCE) {
      if (name.includes(keyword)) {
        // If this view doesn't have an image yet, use it
        if (!this.projectManager.views?.[keyword]?.image) {
          return keyword;
        }
        // Otherwise, create a unique variant (e.g., front-1, front-2)
        let counter = 1;
        let candidate = `${keyword}-${counter}`;
        while (this.projectManager.views?.[candidate]?.image) {
          counter++;
          candidate = `${keyword}-${counter}`;
        }
        return candidate;
      }
    }

    // No keyword match - find empty preset or create unique ID
    const emptyPreset = VIEW_PREFERENCE.find(id => !this.projectManager.views?.[id]?.image);
    if (emptyPreset) return emptyPreset;

    // Create unique ID from filename
    const baseName = filename.replace(/\.[^/.]+$/, '') || 'image';
    let slug = baseName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    if (!slug) slug = 'image';

    let candidate = slug;
    let counter = 1;
    while (this.projectManager.views?.[candidate]?.image) {
      candidate = `${slug}-${counter++}`;
    }
    return candidate;
  }

  formatDisplayName(filename, viewId) {
    const base = filename.replace(/\.[^/.]+$/, '');
    if (base) return base;
    return viewId.charAt(0).toUpperCase() + viewId.slice(1);
  }

  getFileExtension(filename = '') {
    const parts = filename.toLowerCase().split('.');
    return parts.length > 1 ? parts.pop() : '';
  }

  replaceExtension(filename, newExtension) {
    return filename.replace(/\.[^/.]+$/, newExtension);
  }

  showStatus(message, type = 'info') {
    if (typeof window.showStatusMessage === 'function') {
      window.showStatusMessage(message, type);
    } else if (typeof window.projectManager?.showStatusMessage === 'function') {
      window.projectManager.showStatusMessage(message, type);
    } else {
      console.log(`[${type.toUpperCase()}] ${message}`);
    }
  }
}
