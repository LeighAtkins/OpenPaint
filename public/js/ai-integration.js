/**
 * AI Integration Module for OpenPaint
 * Handles AI-powered furniture dimensioning with Cloudflare Images and Worker
 */

// AI Integration state
window.aiIntegration = {
  isGenerating: false,
  currentImageId: null,
  currentImageUrl: null,
  lastResult: null
};

/**
 * Upload image to Cloudflare Images and get signed URL
 * @param {Blob} imageBlob - Image blob to upload
 * @returns {Promise<{imageId: string, deliveryUrl: string}>}
 */
async function uploadImageToCloudflare(imageBlob) {
  try {
    // Get presigned upload URL
    const presignResponse = await fetch('/api/storage/presign', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!presignResponse.ok) {
      const error = await presignResponse.json();
      throw new Error(error.message || 'Failed to get upload URL');
    }

    const { uploadUrl, imageId, deliveryUrl } = await presignResponse.json();

    // Upload image to Cloudflare Images
    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      body: imageBlob,
      headers: {
        'Content-Type': imageBlob.type || 'image/jpeg'
      }
    });

    if (!uploadResponse.ok) {
      throw new Error('Failed to upload image to Cloudflare Images');
    }

    console.log('[AI Integration] Image uploaded successfully:', imageId);
    return { imageId, deliveryUrl };

  } catch (error) {
    console.error('[AI Integration] Upload failed:', error);
    throw error;
  }
}

/**
 * Get signed image URL for existing image
 * @param {string} imageId - Cloudflare Images ID
 * @returns {string} Delivery URL
 */
function getSignedImageUrl(imageId) {
  const CF_ACCOUNT_HASH = window.paintApp?.config?.CF_ACCOUNT_HASH;
  if (!CF_ACCOUNT_HASH) {
    throw new Error('CF_ACCOUNT_HASH not configured');
  }
  return `https://imagedelivery.net/${CF_ACCOUNT_HASH}/${imageId}/public`;
}

/**
 * Check if image is loaded and ready for AI processing
 * @returns {boolean}
 */
function isImageReadyForAI() {
  const currentImage = window.paintApp?.state?.originalImages?.[window.paintApp?.state?.currentImageLabel];
  return currentImage && currentImage.naturalWidth && currentImage.naturalHeight;
}

/**
 * Get current image dimensions
 * @returns {{width: number, height: number} | null}
 */
function getCurrentImageDimensions() {
  const currentImage = window.paintApp?.state?.originalImages?.[window.paintApp?.state?.currentImageLabel];
  if (!currentImage) return null;
  
  return {
    width: currentImage.naturalWidth || currentImage.width,
    height: currentImage.naturalHeight || currentImage.height
  };
}

/**
 * Get current image as blob
 * @returns {Promise<Blob>}
 */
async function getCurrentImageAsBlob() {
  const currentImage = window.paintApp?.state?.originalImages?.[window.paintApp?.state?.currentImageLabel];
  if (!currentImage) {
    throw new Error('No image loaded');
  }

  // Convert image to blob
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  canvas.width = currentImage.naturalWidth || currentImage.width;
  canvas.height = currentImage.naturalHeight || currentImage.height;
  
  ctx.drawImage(currentImage, 0, 0);
  
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Failed to convert image to blob'));
      }
    }, 'image/jpeg', 0.9);
  });
}

/**
 * Generate sofa basics using AI
 * Main entry point for AI dimensioning
 */
async function generateSofaBasics() {
  try {
    // Check if image is ready
    if (!isImageReadyForAI()) {
      showAIMessage('Please load an image first', 'error');
      return;
    }

    // Check if already generating
    if (window.aiIntegration.isGenerating) {
      showAIMessage('AI generation already in progress', 'warning');
      return;
    }

    window.aiIntegration.isGenerating = true;
    showAIMessage('Preparing image for AI analysis...', 'info');

    // Get image dimensions
    const dimensions = getCurrentImageDimensions();
    if (!dimensions) {
      throw new Error('Could not get image dimensions');
    }

    // Upload image to Cloudflare Images
    const imageBlob = await getCurrentImageAsBlob();
    const { imageId, deliveryUrl } = await uploadImageToCloudflare(imageBlob);
    
    window.aiIntegration.currentImageId = imageId;
    window.aiIntegration.currentImageUrl = deliveryUrl;

    showAIMessage('Image uploaded. Opening calibration dialog...', 'info');

    // Show calibration dialog
    showCalibrationDialog(dimensions);

  } catch (error) {
    console.error('[AI Integration] Generate sofa basics failed:', error);
    showAIMessage(`Error: ${error.message}`, 'error');
    window.aiIntegration.isGenerating = false;
  }
}

/**
 * Show calibration dialog
 * @param {{width: number, height: number}} dimensions - Image dimensions
 */
function showCalibrationDialog(dimensions) {
  const dialog = document.getElementById('ai-calibration-dialog');
  if (!dialog) {
    console.error('[AI Integration] Calibration dialog not found');
    return;
  }

  // Update detected width display
  const detectedWidthEl = dialog.querySelector('#detected-width-pixels');
  if (detectedWidthEl) {
    detectedWidthEl.textContent = `${dimensions.width}px`;
  }

  // Reset form
  const form = dialog.querySelector('#calibration-form');
  if (form) {
    form.reset();
    form.querySelector('input[name="real-width"]').value = '';
    form.querySelector('select[name="unit"]').value = 'cm';
  }

  // Show dialog
  dialog.showModal();
}

/**
 * Handle calibration form submission
 * @param {Event} event - Form submit event
 */
async function handleCalibrationSubmit(event) {
  event.preventDefault();
  
  const form = event.target;
  const formData = new FormData(form);
  
  const realWidth = parseFloat(formData.get('real-width'));
  const unit = formData.get('unit');
  
  if (!realWidth || realWidth <= 0) {
    showAIMessage('Please enter a valid width value', 'error');
    return;
  }

  try {
    // Close calibration dialog
    const dialog = document.getElementById('ai-calibration-dialog');
    dialog.close();

    showAIMessage('Generating AI dimensions...', 'info');

    // Prepare payload for Worker
    const dimensions = getCurrentImageDimensions();
    const payload = {
      image: {
        width: dimensions.width,
        height: dimensions.height
      },
      imageUrl: window.aiIntegration.currentImageUrl,
      calibration: {
        name: 'overall_width',
        pixels: dimensions.width, // Use full width as detected width
        real: realWidth,
        unit: unit
      },
      view: 'front', // Default to front view for now
      options: {
        detectSilhouette: true,
        detectPanels: true
      }
    };

    // Call AI analyze-and-dimension endpoint
    const response = await fetch('/ai/analyze-and-dimension', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || error.message || 'AI analysis failed');
    }

    const result = await response.json();
    window.aiIntegration.lastResult = result;

    // Show preview modal
    showPreviewModal(result);

  } catch (error) {
    console.error('[AI Integration] Calibration failed:', error);
    showAIMessage(`Error: ${error.message}`, 'error');
  } finally {
    window.aiIntegration.isGenerating = false;
  }
}

/**
 * Show preview modal with AI results
 * @param {Object} result - AI analysis result
 */
function showPreviewModal(result) {
  const modal = document.getElementById('ai-preview-modal');
  if (!modal) {
    console.error('[AI Integration] Preview modal not found');
    return;
  }

  // Update status text
  const statusEl = modal.querySelector('#ai-status-text');
  if (statusEl && result.derived) {
    statusEl.textContent = `Calibrated: 1 ${result.derived.unit} = ${result.derived.pxPerUnit.toFixed(1)} px`;
  }

  // Update dimension summary
  const summaryEl = modal.querySelector('#ai-dimension-summary');
  if (summaryEl && result.summary && result.summary.dims) {
    const dims = result.summary.dims;
    summaryEl.innerHTML = dims.map(dim => 
      `<div><strong>${dim.id.replace('_', ' ').toUpperCase()}:</strong> ${dim.value} ${dim.unit}</div>`
    ).join('');
  }

  // Store SVG for preview
  if (result.svg) {
    modal.dataset.svg = result.svg;
  }

  // Show modal
  modal.showModal();
}

/**
 * Handle preview modal actions
 * @param {string} action - Action to perform
 */
async function handlePreviewAction(action) {
  const modal = document.getElementById('ai-preview-modal');
  const result = window.aiIntegration.lastResult;
  
  if (!result) {
    showAIMessage('No AI result available', 'error');
    return;
  }

  try {
    switch (action) {
      case 'accept':
        await acceptAIResult(result);
        modal.close();
        showAIMessage('AI dimensions added to canvas', 'success');
        break;
        
      case 'save':
        await acceptAIResult(result);
        await saveAIResult(result);
        modal.close();
        showAIMessage('AI dimensions saved to project', 'success');
        break;
        
      case 'download-svg':
        downloadAISVG(result);
        break;
        
      case 'cancel':
        modal.close();
        break;
        
      default:
        console.warn('[AI Integration] Unknown preview action:', action);
    }
  } catch (error) {
    console.error('[AI Integration] Preview action failed:', error);
    showAIMessage(`Error: ${error.message}`, 'error');
  }
}

/**
 * Accept AI result and add to canvas
 * @param {Object} result - AI analysis result
 */
async function acceptAIResult(result) {
  if (!result.vectors || !Array.isArray(result.vectors)) {
    throw new Error('No AI vectors to add');
  }

  const currentLabel = window.paintApp?.state?.currentImageLabel;
  if (!currentLabel) {
    throw new Error('No current image label');
  }

  // Convert AI vectors to OpenPaint stroke format
  const aiStrokes = result.vectors.map((vector, index) => ({
    id: `ai-${Date.now()}-${index}`,
    type: vector.type === 'line' ? 'straight' : 'freehand',
    points: vector.points || [],
    color: vector.style?.color || '#0B84F3',
    width: vector.style?.width || 2,
    label: vector.label || '',
    isAI: true,
    aiLayer: 'AI Basics'
  }));

  // Add to stroke storage
  if (!window.paintApp.state.vectorStrokesByImage[currentLabel]) {
    window.paintApp.state.vectorStrokesByImage[currentLabel] = [];
  }
  
  window.paintApp.state.vectorStrokesByImage[currentLabel].push(...aiStrokes);

  // Set visibility
  if (!window.paintApp.state.strokeVisibilityByImage[currentLabel]) {
    window.paintApp.state.strokeVisibilityByImage[currentLabel] = {};
  }
  
  aiStrokes.forEach(stroke => {
    window.paintApp.state.strokeVisibilityByImage[currentLabel][stroke.id] = true;
  });

  // Update UI
  if (typeof window.updateStrokeVisibilityControls === 'function') {
    window.updateStrokeVisibilityControls();
  }
  
  if (typeof window.redrawCanvasWithVisibility === 'function') {
    window.redrawCanvasWithVisibility();
  }
}

/**
 * Save AI result to project
 * @param {Object} result - AI analysis result
 */
async function saveAIResult(result) {
  const currentLabel = window.paintApp?.state?.currentImageLabel;
  if (!currentLabel) {
    throw new Error('No current image label');
  }

  // Save SVG file
  if (result.svg) {
    const svgBlob = new Blob([result.svg], { type: 'image/svg+xml' });
    const svgUrl = URL.createObjectURL(svgBlob);
    
    // Trigger download
    const link = document.createElement('a');
    link.href = svgUrl;
    link.download = `ai-latest-${currentLabel}.svg`;
    link.click();
    
    URL.revokeObjectURL(svgUrl);
  }

  // Save JSON metadata
  if (result.vectors) {
    const metadata = {
      timestamp: new Date().toISOString(),
      imageLabel: currentLabel,
      vectors: result.vectors,
      derived: result.derived,
      summary: result.summary
    };
    
    const jsonBlob = new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' });
    const jsonUrl = URL.createObjectURL(jsonBlob);
    
    const link = document.createElement('a');
    link.href = jsonUrl;
    link.download = `ai-latest-${currentLabel}.json`;
    link.click();
    
    URL.revokeObjectURL(jsonUrl);
  }
}

/**
 * Download AI SVG
 * @param {Object} result - AI analysis result
 */
function downloadAISVG(result) {
  if (!result.svg) {
    showAIMessage('No SVG available to download', 'error');
    return;
  }

  const svgBlob = new Blob([result.svg], { type: 'image/svg+xml' });
  const svgUrl = URL.createObjectURL(svgBlob);
  
  const link = document.createElement('a');
  link.href = svgUrl;
  link.download = `ai-dimensions-${Date.now()}.svg`;
  link.click();
  
  URL.revokeObjectURL(svgUrl);
}

/**
 * Show AI message to user
 * @param {string} message - Message to show
 * @param {string} type - Message type (info, success, warning, error)
 */
function showAIMessage(message, type = 'info') {
  console.log(`[AI Integration] ${type.toUpperCase()}: ${message}`);
  
  // Try to use existing toast/notification system
  if (typeof window.showStatusMessage === 'function') {
    window.showStatusMessage(message, type);
  } else {
    // Fallback to alert for now
    if (type === 'error') {
      alert(`Error: ${message}`);
    }
  }
}

/**
 * Clean up existing strokes with AI (stroke-only flow)
 * @param {Array} strokes - Array of stroke objects
 * @param {Object} image - Image dimensions
 * @param {Object} units - Unit configuration (optional)
 * @returns {Promise<Object>} Cleaned SVG and vectors
 */
async function cleanupStrokesWithAI(strokes, image, units = null) {
  try {
    const response = await fetch('/ai/generate-svg', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        image: image,
        strokes: strokes,
        units: units,
        styleGuide: {
          colors: {
            stroke: '#0B84F3',
            labelText: '#111111',
            labelBg: '#FFFFFF'
          },
          fonts: {
            family: 'Arial, sans-serif',
            size: 14
          }
        }
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'AI stroke cleanup failed');
    }

    return await response.json();
  } catch (error) {
    console.error('Stroke cleanup failed:', error);
    throw error;
  }
}

// Export functions to global scope
window.generateSofaBasics = generateSofaBasics;
window.handleCalibrationSubmit = handleCalibrationSubmit;
window.handlePreviewAction = handlePreviewAction;
window.cleanupStrokesWithAI = cleanupStrokesWithAI;

// Set up event listeners when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const generateButton = document.getElementById('generateSofaBasics');
  if (generateButton) {
    generateButton.addEventListener('click', generateSofaBasics);
    console.log('[AI Integration] Generate button event listener attached');
  } else {
    console.warn('[AI Integration] Generate button not found');
  }
});

console.log('[AI Integration] Module loaded successfully');

// Mark AI integration as ready
if (window.AppInit) {
  window.AppInit.markReady('ai');
}
