// Define core application structure for better state management

// Simple debug logging function
function debugLog(...args) {
  // For now, just use console.log - can be enhanced later
  console.log(...args);
}
// Disable legacy measurement overlay rendering in favor of unified tag renderer
window.disableLegacyMeasurementOverlay = true;

// Load viewport controller modules (safely)
(function loadViewportModules() {
  try {
    // Load feature flags first
    const featureFlagsScript = document.createElement('script');
    featureFlagsScript.src = 'src/canvas/viewport/featureFlags.js';
    featureFlagsScript.onload = function() {
      console.log('[VIEWPORT] Feature flags loaded');
            
      // Initialize feature flags after script loads
      setTimeout(() => {
        try {
          if (window.ViewportFeatureFlags) {
            window.ViewportFeatureFlags.initFeatureFlags();
            console.log('[VIEWPORT] Feature flags initialized');
          } else {
            console.warn('[VIEWPORT] ViewportFeatureFlags not available, using legacy system');
          }
        } catch (e) {
          console.warn('[VIEWPORT] Error initializing feature flags, using legacy system:', e);
        }
      }, 10);
            
      // Load viewport controller after feature flags are ready
      const viewportScript = document.createElement('script');
      viewportScript.src = 'src/canvas/viewport/canvasViewport.js';
      viewportScript.onload = function() {
        console.log('[VIEWPORT] Controller loaded');
      };
      viewportScript.onerror = function(error) {
        console.warn('[VIEWPORT] Controller failed to load, using legacy system:', error);
      };
      document.head.appendChild(viewportScript);
    };
    featureFlagsScript.onerror = function(error) {
      console.warn('[VIEWPORT] Feature flags failed to load, using legacy system:', error);
    };
    document.head.appendChild(featureFlagsScript);
  } catch (e) {
    console.warn('[VIEWPORT] Failed to initialize viewport modules, using legacy system:', e);
  }
})();
window.paintApp = {
  config: {
    IMAGE_LABELS: ['front', 'side', 'back', 'cushion', 'blank_canvas'],
    MAX_HISTORY: 50,  // Maximum number of states to store
    ANCHOR_SIZE: 4,
    CLICK_AREA: 10,
    clickDelay: 300, // Milliseconds to wait for double-click
    defaultScale: 1.0,
    defaultPosition: { x: 0, y: 0 },
    INCHES_TO_CM: 2.54, // Conversion factor from inches to centimeters
    DEFAULT_LABEL_START: 'A1', // Starting label for strokes
    DEFAULT_TAG_SIZE: 20, // Default font size for tags in pixels
    MIN_TAG_SIZE: 8, // Minimum tag size in pixels
    MAX_TAG_SIZE: 32, // Maximum tag size in pixels
    TAG_SIZE_STEP: 2, // Size increment/decrement step
    FRACTION_VALUES: [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875], // Common fractions for inch display
    MINIMUM_DRAG_DISTANCE: 3 // pixels - minimum distance to detect drag vs click
  },
  state: {
    currentImageLabel: 'front',
    vectorStrokesByImage: {},
    strokeVisibilityByImage: {},
    strokeLabelVisibility: {},
    strokeMeasurements: {},
    imageScaleByLabel: {},
    imagePositionByLabel: {},
    lineStrokesByImage: {},
    labelsByImage: {},
    originalImages: {},
    originalImageDimensions: {},
    imageTags: {},
    isLoadingProject: false,
    isDefocusingOperationInProgress: false,
    // New viewport controller instance
    viewportController: null,
    // DOM element references for centralized access
    domElements: {},
    // Event listener management
    listenersBound: false,
    eventListeners: new AbortController(),
    folderStructure: {
      'root': {
        id: 'root',
        name: 'Root',
        type: 'folder',
        parentId: null,
        children: []
      }
    },
    selectedStrokeByImage: {},
    multipleSelectedStrokesByImage: {},
    labelCounters: {
      front: { regular: 1, paste: 1 },
      side: { regular: 1, paste: 1 },
      back: { regular: 1, paste: 1 },
      cushion: { regular: 1, paste: 1 }
    },
    imageLabels: [],
    customLabelPositions: {},
    calculatedLabelOffsets: {},
    clearedMassiveOffsets: {}, // Track which labels have had massive offsets cleared to prevent repeated clearing
    selectedStrokeInEditMode: null,
    lastClickTime: 0,
    lastCanvasClickTime: 0,
    orderedImageLabels: [],
    imageLabels: [],
    // Text elements per image label (moved from uiState since it's persistent data)
    textElementsByImage: {},
    // View to piece mapping for grouped PDF export
    viewPieceMapping: {},
    // Piece definitions for grouped PDF
    pieces: {}
  },
  uiState: {
    // Control point dragging
    isDraggingControlPoint: false,
    draggedControlPointInfo: null, // { strokeLabel, pointIndex, startPos }
    // Image drag and drop
    draggedImageItem: null,
    // Keyboard state
    isShiftPressed: false,
    // Drawing state variables
    isDrawing: false,
    lastX: 0,
    lastY: 0,
    points: [],
    lastVelocity: 0,
    mouseDownPosition: null,
    curveJustCompleted: false,
    drawingMode: 'straight', // Options: 'freehand', 'straight', 'curved', 'arrow', 'text'
    previousDrawingMode: 'straight', // Track previous drawing mode for text exit
    straightLineStart: null,
    curvedLinePoints: [],
    lastDrawnPoint: null,
    // Label dragging state
    isDraggingLabel: false,
    draggedLabelStroke: null, // Store stroke label string
    dragStartX: 0,
    dragStartY: 0
  }
};

// Maintain backward compatibility by keeping global references
// These will be gradually migrated to use the paintApp structure
// Moved to DOMContentLoaded event handler to ensure proper initialization
window.isDefocusingOperationInProgress = window.paintApp.state.isDefocusingOperationInProgress;
window.folderStructure = window.paintApp.state.folderStructure;
window.selectedStrokeByImage = window.paintApp.state.selectedStrokeByImage;
window.multipleSelectedStrokesByImage = window.paintApp.state.multipleSelectedStrokesByImage;
window.labelCounters = window.paintApp.state.labelCounters;

// Control point dragging variables (to be migrated)
let isDraggingControlPoint = window.paintApp.uiState.isDraggingControlPoint;
let draggedControlPointInfo = window.paintApp.uiState.draggedControlPointInfo;

// Label dragging variables (migrated to uiState)
let isDraggingLabel = window.paintApp.uiState.isDraggingLabel;
let draggedLabelStroke = window.paintApp.uiState.draggedLabelStroke;
let dragStartX = window.paintApp.uiState.dragStartX;
let dragStartY = window.paintApp.uiState.dragStartY;

// Additional backward compatibility references
window.customLabelPositions = window.paintApp.state.customLabelPositions;
window.calculatedLabelOffsets = window.paintApp.state.calculatedLabelOffsets;
window.clearedMassiveOffsets = window.paintApp.state.clearedMassiveOffsets;
window.selectedStrokeInEditMode = window.paintApp.state.selectedStrokeInEditMode;
window.lastClickTime = window.paintApp.state.lastClickTime;
window.lastCanvasClickTime = window.paintApp.state.lastCanvasClickTime;
window.clickDelay = window.paintApp.config.clickDelay;
let draggedImageItem = window.paintApp.uiState.draggedImageItem;
window.orderedImageLabels = window.paintApp.state.orderedImageLabels;

// Add arrow settings and curved line state to the UI state structure
window.paintApp.uiState.arrowSettings = {
  startArrow: false,  // Off by default (Priority 1 requirement)
  endArrow: false,    // Off by default (Priority 1 requirement)
  arrowSize: null,    // null means use proportional sizing based on stroke width
  arrowStyle: 'triangular' // Options: 'triangular', 'filled', 'curved'
};

// Add dash offset tracking for continuous freehand patterns
window.paintApp.uiState.dashOffset = 0;

// Add dash settings for dotted/dashed lines
window.paintApp.uiState.dashSettings = {
  enabled: false,     // Solid lines by default
  style: 'solid',     // 'solid', 'small', 'medium', 'large', 'dot-dash', 'custom'
  pattern: [],        // Canvas dash array - empty for solid
  dashLength: 5,      // Base dash length (scales with line width)
  gapLength: 5        // Base gap length (scales with line width)
};

window.paintApp.uiState.draggingAnchor = false;
window.paintApp.uiState.dragCurveStroke = null; // The stroke being modified
window.paintApp.uiState.dragAnchorIndex = -1;   // Which control point is being dragged

// Backward compatibility references
let arrowSettings = window.paintApp.uiState.arrowSettings;
let dashSettings = window.paintApp.uiState.dashSettings;
let dashOffset = window.paintApp.uiState.dashOffset;
let draggingAnchor = window.paintApp.uiState.draggingAnchor;

// PERFORMANCE OPTIMIZATIONS: Cache variables and functions
let mouseMoveThrottled = false;
let cachedControlPoints = new Map(); // Cache for transformed control point coordinates
let cachedLabelPositions = new Map(); // Cache for transformed label positions
let cacheInvalidated = true; // Flag to track when cache needs updating

// PERFORMANCE: Cache invalidation helper - call when view changes (pan/zoom) or strokes change

// JSON validation helper function
function isValidJSON(jsonString) {
  try {
    JSON.parse(jsonString);
    return true;
  } catch (e) {
    return false;
  }
}

// Safe JSON parsing with fallback
function safeJsonParse(jsonString, fallback = null) {
  if (!jsonString || jsonString.trim() === '') {
    return fallback;
  }
  try {
    return JSON.parse(jsonString);
  } catch (e) {
    console.error('JSON parsing error:', e.message, 'Input:', jsonString);
    return fallback;
  }
}

function invalidateInteractiveElementCache() {
  cacheInvalidated = true;
  cachedControlPoints.clear();
  cachedLabelPositions.clear();
//         console.log('[PERF] Interactive element cache invalidated');
}

// Safe number formatter to avoid toFixed on undefined or non-numbers
function fmt(n, p = 1) {
  return (typeof n === 'number' && isFinite(n)) ? n.toFixed(p) : String(n);
}
let dragCurveStroke = window.paintApp.uiState.dragCurveStroke;
let dragAnchorIndex = window.paintApp.uiState.dragAnchorIndex;
const ANCHOR_SIZE = window.paintApp.config.ANCHOR_SIZE;
const CLICK_AREA = window.paintApp.config.CLICK_AREA;

document.addEventListener('DOMContentLoaded', () => {
  // Initialize global variables from paintApp state
  window.IMAGE_LABELS = window.paintApp.config.IMAGE_LABELS;
  window.currentImageLabel = window.paintApp.state.currentImageLabel;
  window.vectorStrokesByImage = window.paintApp.state.vectorStrokesByImage;
  window.strokeVisibilityByImage = window.paintApp.state.strokeVisibilityByImage;
  window.strokeLabelVisibility = window.paintApp.state.strokeLabelVisibility;
  window.strokeMeasurements = window.paintApp.state.strokeMeasurements;
  window.imageScaleByLabel = window.paintApp.state.imageScaleByLabel;
  window.imagePositionByLabel = window.paintApp.state.imagePositionByLabel;
  window.lineStrokesByImage = window.paintApp.state.lineStrokesByImage;
  window.labelsByImage = window.paintApp.state.labelsByImage;
  window.originalImages = window.paintApp.state.originalImages;
  window.originalImageDimensions = window.paintApp.state.originalImageDimensions;
  window.imageTags = window.paintApp.state.imageTags;
  window.isLoadingProject = window.paintApp.state.isLoadingProject;
  window.tagSizesByImage = window.tagSizesByImage || {};
    
  // Initialize unit selectors
  const unitSelector = document.getElementById('unitSelector');
  unitSelector.addEventListener('change', updateMeasurementDisplay);
    
  // Initialize show measurements toggle
  const toggleShowMeasurements = document.getElementById('toggleShowMeasurements');
  if (toggleShowMeasurements) {
    toggleShowMeasurements.addEventListener('change', () => {
      // Redraw canvas to update label display
      redrawCanvasWithVisibility();
    });
  }
    
  // Initialize the measurement inputs
  const inchWhole = document.getElementById('inchWhole');
  const inchFraction = document.getElementById('inchFraction');
  const cmValue = document.getElementById('cmValue');
    
  // Handle unit conversion when changing values
  inchWhole.addEventListener('change', () => {
    const whole = parseInt(inchWhole.value) || 0;
    const fraction = parseFloat(inchFraction.value) || 0;
    const totalInches = whole + fraction;
        
    // Update cm value
    cmValue.value = (totalInches * window.paintApp.config.INCHES_TO_CM).toFixed(1);
  });
    
  inchFraction.addEventListener('change', () => {
    const whole = parseInt(inchWhole.value) || 0;
    const fraction = parseFloat(inchFraction.value) || 0;
    const totalInches = whole + fraction;
        
    // Update cm value
    cmValue.value = (totalInches * window.paintApp.config.INCHES_TO_CM).toFixed(1);
  });
    
  cmValue.addEventListener('change', () => {
    const cm = parseFloat(cmValue.value) || 0;
    const inches = cm / window.paintApp.config.INCHES_TO_CM;
        
    // Update inch values
    inchWhole.value = Math.floor(inches);
        
    // Find closest fraction
    const fractionPart = inches - Math.floor(inches);
    const fractions = window.paintApp.config.FRACTION_VALUES;
    let closestFraction = 0;
    let minDiff = 1;
        
    for (const fraction of fractions) {
      const diff = Math.abs(fractionPart - fraction);
      if (diff < minDiff) {
        minDiff = diff;
        closestFraction = fraction;
      }
    }
        
    inchFraction.value = closestFraction;
        
    // Show inch inputs, hide cm inputs
    document.getElementById('inchInputs').style.display = 'flex';
    document.getElementById('cmInputs').style.display = 'none';
  });
    
  // Add event listener for standalone Save as PDF button
  const saveAsPdfButton = document.getElementById('saveAsPdf');
  if (saveAsPdfButton) {
    saveAsPdfButton.addEventListener('click', () => {
      const projectName = document.getElementById('projectName').value || 'Untitled Project';
      showPDFExportDialog(projectName);
    });
  }
  // Remove Background (server REMBG) - toolbar button
  const removeBgBtn = document.getElementById('removeBgClientTop');
  if (removeBgBtn) {
    if (!removeBgBtn.__removeBgBound) {
      removeBgBtn.__removeBgBound = true;
      removeBgBtn.addEventListener('click', async () => {
        try {
          const label = window.paintApp.state.currentImageLabel || 'front';
          const srcUrl = (window.originalImages && window.originalImages[label]) || null;
          const canvasEl = window.paintApp.state.domElements.canvas;
          removeBgBtn.disabled = true;
          const oldText = removeBgBtn.textContent;
          removeBgBtn.textContent = 'Processing ⏳';

          let blob;
          if (srcUrl) {
            try {
              const r = await fetch(srcUrl, { cache: 'no-store' });
              blob = await r.blob();
            } catch (_) {}
          }
          if (!blob && canvasEl) {
            blob = await new Promise(resolve => canvasEl.toBlob(resolve, 'image/png'));
          }
          if (!blob) throw new Error('No image to process');

          // Step 1: Get direct upload URL from Cloudflare Worker
          const uploadResp = await fetch('/api/images/direct-upload', { 
            method: 'POST',
            headers: { 'x-api-key': 'dev-secret' }
          });
          const uploadData = await uploadResp.json();
          if (!uploadData.success || !uploadData.result?.uploadURL) {
            throw new Error('Failed to get upload URL');
          }

          // Step 2: Upload image directly to Cloudflare Images
          const formData = new FormData();
          formData.append('file', blob, 'image.png');
          const imageUploadResp = await fetch(uploadData.result.uploadURL, {
            method: 'POST',
            body: formData
          });
          const imageUploadData = await imageUploadResp.json();
          if (!imageUploadData.success || !imageUploadData.result?.id) {
            throw new Error('Failed to upload image');
          }

          // Step 3: Remove background using Cloudflare Images (robust parsing)
          const bgRemoveResp = await fetch('/api/remove-background', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': 'dev-secret'
            },
            body: JSON.stringify({
              imageId: imageUploadData.result.id,
              return: 'url'
            })
          });
          const ct = (bgRemoveResp.headers.get('content-type') || '').toLowerCase();
          if (!bgRemoveResp.ok) {
            if (ct.includes('application/json')) {
              const errJson = await bgRemoveResp.json().catch(() => ({}));
              throw new Error(errJson.message || JSON.stringify(errJson));
            }
            if (ct.startsWith('text/')) {
              const text = await bgRemoveResp.text();
              throw new Error(text.slice(0, 300));
            }
            const ab = await bgRemoveResp.arrayBuffer().catch(() => null);
            throw new Error(`RemoveBG HTTP ${bgRemoveResp.status}: ${ct || 'unknown'} (${ab ? ab.byteLength : 'no'} bytes)`);
          }
          let cutoutUrl;
          if (ct.includes('application/json')) {
            const bgRemoveData = await bgRemoveResp.json();
            if (!bgRemoveData.success || !bgRemoveData.cutoutUrl) {
              throw new Error(bgRemoveData.message || 'Background removal failed');
            }
            cutoutUrl = bgRemoveData.cutoutUrl;
          } else if (ct.startsWith('image/')) {
            const blobOut = await bgRemoveResp.blob();
            cutoutUrl = URL.createObjectURL(blobOut);
          } else if (ct.startsWith('text/')) {
            const text = await bgRemoveResp.text();
            throw new Error(`Unexpected text from remove-background: ${text.slice(0, 300)}`);
          } else {
            const buf = await bgRemoveResp.arrayBuffer();
            const blobOut = new Blob([buf]);
            cutoutUrl = URL.createObjectURL(blobOut);
          }

          // Step 4: Apply the processed image
          // If cutoutUrl is already a URL (from JSON response), fetch it first to avoid CORS/HTTP2 issues
          // If it's a blob URL (from binary response), we need to fetch it
          if (cutoutUrl.startsWith('http')) {
            // cutoutUrl is already a URL from the API response - fetch it first to convert to blob
            try {
              console.log('[BG-REMOVE] Fetching processed image from:', cutoutUrl);
              const response = await fetch(cutoutUrl, { 
                mode: 'cors',
                cache: 'no-cache'
              });
                            
              if (!response.ok) {
                throw new Error(`Failed to fetch processed image: ${response.status} ${response.statusText}`);
              }
                            
              const blob = await response.blob();
              console.log('[BG-REMOVE] Successfully fetched processed image blob:', blob.size, 'bytes');
                            
              // Use centralized background removal handler if available
              if (typeof window.onBackgroundRemoved === 'function') {
                await window.onBackgroundRemoved(label, blob);
              } else {
                // Fallback to direct paste
                const dataUrl = await rembg_blobToDataURL(blob);
                if (typeof pasteImageFromUrl === 'function') {
                  await pasteImageFromUrl(dataUrl, label, { preserveCanvasScale: true, preserveBasis: 'width' });
                }
              }
            } catch (fetchError) {
              console.error('[BG-REMOVE] Failed to fetch processed image from URL:', fetchError);
              // Try direct URL as fallback
              console.log('[BG-REMOVE] Attempting direct URL fallback...');
              if (typeof pasteImageFromUrl === 'function') {
                await pasteImageFromUrl(cutoutUrl, label, { preserveCanvasScale: true, preserveBasis: 'width' });
              }
            }
          } else {
            // cutoutUrl is a blob URL - fetch it to get the blob
            try {
              const response = await fetch(cutoutUrl);
              const blob = await response.blob();
                            
              // Use centralized background removal handler if available
              if (typeof window.onBackgroundRemoved === 'function') {
                await window.onBackgroundRemoved(label, blob);
              } else {
                // Fallback to direct paste
                const dataUrl = await rembg_blobToDataURL(blob);
                if (typeof pasteImageFromUrl === 'function') {
                  await pasteImageFromUrl(dataUrl, label, { preserveCanvasScale: true, preserveBasis: 'width' });
                }
              }
            } catch (fetchErr) {
              console.error('[RemoveBG] Failed to fetch blob URL:', fetchErr);
              throw new Error('Failed to process background removal result');
            }
          }
          // Keep UI scale text and canvas in sync after replace
          try { if (label === window.currentImageLabel && typeof updateScaleUI === 'function') updateScaleUI(); } catch(_) {}
          try { if (typeof redrawCanvasWithVisibility === 'function') redrawCanvasWithVisibility(); } catch(_) {}
          if (!window.originalImages) window.originalImages = {};
          // Only set originalImages if we used the fallback path
          if (typeof window.onBackgroundRemoved !== 'function') {
            window.originalImages[label] = cutoutUrl;
          }
        } catch (e) {
          console.error('[RemoveBG]', e);
          alert('Remove background failed: ' + e.message);
        } finally {
          removeBgBtn.disabled = false;
          removeBgBtn.textContent = 'Remove BG';
        }
      });
    }
  }
    
  // Initialize DOM elements in state object for centralized access
  window.paintApp.state.domElements.canvas = document.getElementById('canvas');
  window.paintApp.state.domElements.ctx = window.paintApp.state.domElements.canvas.getContext('2d', { willReadFrequently: true });
  window.paintApp.state.domElements.colorPicker = document.getElementById('colorPicker');
  window.paintApp.state.domElements.brushSize = document.getElementById('brushSize');
  window.paintApp.state.domElements.clearButton = document.getElementById('clear');
  window.paintApp.state.domElements.saveButton = document.getElementById('save');
  window.paintApp.state.domElements.copyButton = document.getElementById('copy');
  window.paintApp.state.domElements.copyCanvasBtn = document.getElementById('copyCanvasBtn');
  window.paintApp.state.domElements.pasteButton = document.getElementById('paste');
    
  // Initialize viewport controller if feature flag is enabled
  (function initViewportController() {
    // Wait for viewport modules to load
    const checkAndInit = () => {
      if (window.ViewportFeatureFlags && window.CanvasViewportController) {
        const useNewViewport = window.ViewportFeatureFlags.getFeatureFlag('USE_NEW_VIEWPORT');
                
        if (useNewViewport) {
          console.log('[VIEWPORT] Initializing new viewport controller');
                    
          const canvas = window.paintApp.state.domElements.canvas;
          const container = canvas.parentElement;
                    
          if (container && canvas) {
            // Create viewport controller for blank canvas mode
            // For blank canvas, we want 1:1 coordinate mapping (no scaling)
            window.paintApp.state.viewportController = new window.CanvasViewportController(
              container,
              canvas,
              {
                padding: 0,
                frameBounds: null // null means no auto-scaling, use identity transform
              }
            );
                        
            // Listen for viewport changes to update legacy state
            container.addEventListener('viewportChanged', (event) => {
              const { transform, dpr } = event.detail;
                            
              // Update legacy scale and position for backward compatibility
              if (window.currentImageLabel) {
                window.imageScaleByLabel[window.currentImageLabel] = transform.scale;
                window.imagePositionByLabel[window.currentImageLabel] = {
                  x: transform.tx,
                  y: transform.ty
                };
              }
                            
              // Log viewport changes if debugging is enabled
              if (window.ViewportFeatureFlags.getFeatureFlag('LOG_VIEWPORT_CHANGES')) {
                console.log('[VIEWPORT] Transform updated:', {
                  scale: transform.scale.toFixed(3),
                  tx: transform.tx.toFixed(1),
                  ty: transform.ty.toFixed(1),
                  dpr: dpr.toFixed(2)
                });
              }
            });
                        
            console.log('[VIEWPORT] Controller initialized successfully');
          } else {
            console.warn('[VIEWPORT] Could not find canvas container for viewport controller');
          }
        } else {
          console.log('[VIEWPORT] Using legacy resize system (new viewport disabled)');
        }
      } else {
        // Modules not loaded yet, try again
        setTimeout(checkAndInit, 100);
      }
    };
        
    checkAndInit();
  })();
    
  // Debug DOM element loading
  console.log('[PAINT.JS] DOM elements found:', {
    brushSize: !!window.paintApp.state.domElements.brushSize,
    clearButton: !!window.paintApp.state.domElements.clearButton,
    saveButton: !!window.paintApp.state.domElements.saveButton,
    copyButton: !!window.paintApp.state.domElements.copyButton,
    pasteButton: !!window.paintApp.state.domElements.pasteButton
  });
  window.paintApp.state.domElements.strokeCounter = document.getElementById('strokeCounter');
  window.paintApp.state.domElements.imageList = document.getElementById('imageList');
  window.paintApp.state.domElements.drawingModeToggle = document.getElementById('drawingModeToggle');
  window.paintApp.state.domElements.textModeToggle = document.getElementById('textModeToggle');
  window.paintApp.state.domElements.strokeSidebar = document.getElementById('strokePanel');
  window.paintApp.state.domElements.imageSidebar = document.getElementById('imagePanel');
  window.paintApp.state.domElements.strokeSidebarHeader = document.getElementById('strokePanel');
  window.paintApp.state.domElements.imageSidebarHeader = document.getElementById('imagePanel');
    
  // Create backward compatibility references
  const canvas = window.paintApp.state.domElements.canvas;
  const ctx = window.paintApp.state.domElements.ctx;
  const colorPicker = window.paintApp.state.domElements.colorPicker;
  const brushSize = window.paintApp.state.domElements.brushSize;
  // Enforce consistent slider attributes to match original OpenPaint
  if (brushSize) {
    if (!brushSize.min || Number(brushSize.min) < 1) brushSize.min = '1';
    if (!brushSize.max || Number(brushSize.max) < 50) brushSize.max = '50';
    if (!brushSize.value) brushSize.value = '5';
  }
  const clearButton = window.paintApp.state.domElements.clearButton;
  const saveButton = window.paintApp.state.domElements.saveButton;

  // Sync slider UI with brush size and color
  const updateBrushSliderAccent = () => {
    if (brushSize) {
      const currentColor = (colorPicker && colorPicker.value) ? colorPicker.value : '#3b82f6';
      // Always use the actual color, but add shadow for white
      brushSize.style.setProperty('--accent', currentColor);
            
      // Add drop shadow for white color to make it visible
      if (currentColor === '#ffffff' || currentColor === 'white' || currentColor === 'rgb(255, 255, 255)') {
        brushSize.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.3)';
      } else {
        brushSize.style.boxShadow = 'none';
      }
    }
  };
  // cache these unless you dynamically change attributes later
  const MIN = Number.isFinite(+brushSize.min) ? +brushSize.min : 0;
  const MAX = Number.isFinite(+brushSize.max) ? +brushSize.max : 100;

  const updateBrushSliderFill = () => {
    if (!brushSize) return;

    const val = Number(brushSize.value);
    const lo = Math.min(MIN, MAX);
    const hi = Math.max(MIN, MAX);
    const range = Math.max(hi - lo, 1); // avoid /0

    const pRaw = (val - lo) / range;
    // Prevent tiny FP rounding from stopping short of 100%
    const p = (val >= hi) ? 1 : Math.min(1, Math.max(0, pRaw));

    // Keep both variables for compatibility with older CSS
    brushSize.style.setProperty('--p', String(p));
    brushSize.style.setProperty('--filled', (p === 1) ? '100%' : `${(p * 100).toFixed(2)}%`);

    // optional: keep ARIA in sync for screen readers
    brushSize.setAttribute('aria-valuenow', String(val));
  };
  updateBrushSliderAccent();
  updateBrushSliderFill();
  const copyButton = window.paintApp.state.domElements.copyButton;

  // Update color of stroke currently in edit mode when the color picker changes
  if (colorPicker) {
    const applyEditedStrokeColor = () => {
      const img = window.currentImageLabel;
      const edited = window.selectedStrokeInEditMode;
      if (!img || !edited) return;
      if (!window.vectorStrokesByImage || !window.vectorStrokesByImage[img] || !window.vectorStrokesByImage[img][edited]) return;

      // Apply new color to the vector data of the edited stroke
      const vectorData = window.vectorStrokesByImage[img][edited];
      vectorData.color = colorPicker.value;

      // Persist and refresh UI
      try { saveState(true, false, false); } catch(_) {}
      try { redrawCanvasWithVisibility(); } catch(_) {}
      try { updateStrokeVisibilityControls(); } catch(_) {}
    };

    // Support both direct color input and programmatic swatch changes (which dispatch 'change')
    colorPicker.addEventListener('input', applyEditedStrokeColor);
    colorPicker.addEventListener('change', applyEditedStrokeColor);

    // Keep slider accent in sync with chosen color
    colorPicker.addEventListener('input', () => {
      updateBrushSliderAccent();
    });
    colorPicker.addEventListener('change', () => {
      updateBrushSliderAccent();
    });
  }
  const pasteButton = window.paintApp.state.domElements.pasteButton;
  const strokeCounter = window.paintApp.state.domElements.strokeCounter;
  const imageList = window.paintApp.state.domElements.imageList;
  const drawingModeToggle = window.paintApp.state.domElements.drawingModeToggle;
  const textModeToggle = window.paintApp.state.domElements.textModeToggle;
  const strokeSidebar = window.paintApp.state.domElements.strokeSidebar;
  const imageSidebar = window.paintApp.state.domElements.imageSidebar;
  const strokeSidebarHeader = window.paintApp.state.domElements.strokeSidebarHeader;
  const imageSidebarHeader = window.paintApp.state.domElements.imageSidebarHeader;
    
  // Overlay used during canvas resize to keep previous render visible until redraw completes
  let resizeOverlayCanvas = null;
  let resizeOverlayCleanupId = null;


  function showResizeOverlay(targetWidth, targetHeight) {
    const canvasEl = window.paintApp?.state?.domElements?.canvas;
    if (!canvasEl || !canvasEl.parentElement) return;

    const canvasRect = canvasEl.getBoundingClientRect();

    if (!resizeOverlayCanvas) {
      resizeOverlayCanvas = document.createElement('canvas');
      resizeOverlayCanvas.style.pointerEvents = 'none';
      resizeOverlayCanvas.style.position = 'absolute';
      const zIndex = parseInt(window.getComputedStyle(canvasEl).zIndex || '0', 10) || 0;
      resizeOverlayCanvas.style.zIndex = String(zIndex + 1);
      canvasEl.parentElement.appendChild(resizeOverlayCanvas);
    }

    const parentRect = canvasEl.parentElement.getBoundingClientRect();
    resizeOverlayCanvas.style.left = `${canvasRect.left - parentRect.left}px`;
    resizeOverlayCanvas.style.top = `${canvasRect.top - parentRect.top}px`;

    resizeOverlayCanvas.width = Math.max(1, Math.floor(canvasRect.width));
    resizeOverlayCanvas.height = Math.max(1, Math.floor(canvasRect.height));

    const overlayCtx = resizeOverlayCanvas.getContext('2d');
    overlayCtx.clearRect(0, 0, resizeOverlayCanvas.width, resizeOverlayCanvas.height);
    try {
      overlayCtx.drawImage(canvasEl, 0, 0, resizeOverlayCanvas.width, resizeOverlayCanvas.height);
    } catch (_) {
      // Ignore drawImage failures (e.g., tainted canvas) and leave overlay blank
    }

    resizeOverlayCanvas.style.width = `${targetWidth}px`;
    resizeOverlayCanvas.style.height = `${targetHeight}px`;
  }

  function hideResizeOverlay() {
    if (resizeOverlayCleanupId) {
      cancelAnimationFrame(resizeOverlayCleanupId);
    }

    resizeOverlayCleanupId = requestAnimationFrame(() => {
      resizeOverlayCleanupId = null;
      if (resizeOverlayCanvas && resizeOverlayCanvas.parentElement) {
        resizeOverlayCanvas.parentElement.removeChild(resizeOverlayCanvas);
      }
      resizeOverlayCanvas = null;
    });
  }
    
  // Expose canvas globally for project management
  window.canvas = canvas;
    
  // Set up drag-and-drop for the image list container
  imageList.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  });
    
  imageList.addEventListener('drop', (e) => {
    e.preventDefault();
        
    // If dropped on the imageList itself (not on a specific container), append to end
    if (draggedImageItem && e.target === imageList) {
      imageList.appendChild(draggedImageItem);
    }
  });

  // === REMBG Safety Shim (additive, opt-in, no side effects when disabled) ===
  function rembg_isShimEnabled() {
    try {
      var v = (typeof process !== 'undefined' && process && process.env && process.env.NEXT_PUBLIC_REMBG_SAFESHIM) || globalThis.NEXT_PUBLIC_REMBG_SAFESHIM;
      return String(v) === '1';
    } catch (_) { return false; }
  }

  function rembg_debug() {
    try {
      var dbg = (typeof process !== 'undefined' && process && process.env && process.env.NEXT_PUBLIC_REMBG_SAFESHIM_DEBUG) || globalThis.NEXT_PUBLIC_REMBG_SAFESHIM_DEBUG;
      if (String(dbg) === '1') {
        // eslint-disable-next-line no-console
        console.log.apply(console, arguments);
      }
    } catch (_) {}
  }

  // Helper to convert blob to data URL (for background removal flow)
  async function rembg_blobToDataURL(blob) {
    return await new Promise((resolve, reject) => {
      try {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      } catch (e) {
        reject(e);
      }
    });
  }

  // === LABEL REPROJECTION FEATURE FLAG ===
  function labelReprojectEnabled() {
    try {
      var v = (typeof process !== 'undefined' && process && process.env && process.env.NEXT_PUBLIC_LABEL_REPROJECT) || globalThis.NEXT_PUBLIC_LABEL_REPROJECT;
      return String(v) === '1';
    } catch (_) { return false; }
  }
  function labelReprojectDebug() {
    try {
      var v = (typeof process !== 'undefined' && process && process.env && process.env.NEXT_PUBLIC_LABEL_REPROJECT_DEBUG) || globalThis.NEXT_PUBLIC_LABEL_REPROJECT_DEBUG;
      return String(v) === '1';
    } catch (_) { return false; }
  }

  function labelNormEnabled() {
    try {
      var v = (typeof process !== 'undefined' && process && process.env && process.env.NEXT_PUBLIC_LABEL_NORM) || globalThis.NEXT_PUBLIC_LABEL_NORM;
      return String(v) === '1';
    } catch (_) { return false; }
  }

  function labelStrictEnabled() {
    try {
      var v = (typeof process !== 'undefined' && process && process.env && process.env.NEXT_PUBLIC_LABEL_REPROJECT_STRICT) || globalThis.NEXT_PUBLIC_LABEL_REPROJECT_STRICT;
      return String(v) === '1';
    } catch (_) { return false; }
  }

  function labelSkipRebaseEnabled() {
    try {
      var v = (typeof process !== 'undefined' && process && process.env && process.env.NEXT_PUBLIC_LABEL_REPROJECT_SKIP_REBASE) || globalThis.NEXT_PUBLIC_LABEL_REPROJECT_SKIP_REBASE;
      return String(v) === '1';
    } catch (_) { return false; }
  }

  function rembg_blobToDataURL(blob) {
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function() { resolve(reader.result); };
      reader.onerror = function(err) { reject(err); };
      reader.readAsDataURL(blob);
    });
  }

  async function rembg_createImageSafe(dataUrl) {
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = dataUrl;
    await img.decode();
    return img;
  }

  async function rembg_useBitmapSafely(outBlob) {
    var dataUrl = await rembg_blobToDataURL(outBlob);
    var img = await rembg_createImageSafe(dataUrl);
    return { img: img, width: img.naturalWidth || img.width, height: img.naturalHeight || img.height };
  }

  // Undo/Redo functionality - use values from paintApp structure
  const MAX_HISTORY = window.paintApp.config.MAX_HISTORY;
  const IMAGE_LABELS = window.paintApp.config.IMAGE_LABELS;
    
  // Add missing state variables to paintApp.state and use references
  window.paintApp.state.currentImageIndex = 0;
  window.paintApp.state.imageStates = {};
  window.paintApp.state.undoStackByImage = {};
  window.paintApp.state.redoStackByImage = {};
  window.paintApp.state.pastedImages = [];
  window.paintApp.state.isDrawingOrPasting = false;
  window.paintApp.state.strokeInProgress = false;
  window.paintApp.state.currentStroke = null;
  window.paintApp.state.strokeDataByImage = {};
    
  // Use references to the paintApp state instead of shadowing variables
  let currentImageIndex = window.paintApp.state.currentImageIndex;
  let imageStates = window.paintApp.state.imageStates;
  let undoStackByImage = window.paintApp.state.undoStackByImage;
  let redoStackByImage = window.paintApp.state.redoStackByImage;
  let pastedImages = window.paintApp.state.pastedImages;
  let isDrawingOrPasting = window.paintApp.state.isDrawingOrPasting;
  let strokeInProgress = window.paintApp.state.strokeInProgress;
  let currentStroke = window.paintApp.state.currentStroke;
  let strokeDataByImage = window.paintApp.state.strokeDataByImage;
    
  // Add UI state variables to paintApp.uiState
  window.paintApp.uiState.isShiftPressed = false;
  let isShiftPressed = window.paintApp.uiState.isShiftPressed;

  // Initialize states for default images
  IMAGE_LABELS.forEach(label => {
    lineStrokesByImage[label] = [];
    strokeVisibilityByImage[label] = {}; // Initialize stroke visibility
    strokeDataByImage[label] = {}; // Initialize stroke data
    labelsByImage[label] = window.paintApp.config.DEFAULT_LABEL_START;  // Start from A1 instead of A0
    undoStackByImage[label] = [];
    redoStackByImage[label] = [];  // Initialize redo stack
    imageStates[label] = null;
    // Initialize scale to 100% (1.0)
    window.imageScaleByLabel[label] = 1.0;
    originalImageDimensions[label] = { width: 0, height: 0 };
    // Initialize position offset to center (0, 0)
    imagePositionByLabel[label] = { x: 0, y: 0 };
    // Initialize with a blank state when the image is first created
    const blankState = ctx.createImageData(canvas.width, canvas.height);
    imageStates[label] = blankState;
    undoStackByImage[label].push({
      state: cloneImageData(blankState),
      type: 'initial',
      label: null
    });
  });

  // Use the currentImageLabel from paintApp.state instead of redeclaring
  window.paintApp.state.currentImageLabel = IMAGE_LABELS[0]; // Start with 'front'
  let currentImageLabel = window.paintApp.state.currentImageLabel;
    
  // ADDED: Initialize dimensions for default image labels to prevent NORMALIZE-TO-PIXELS errors
  if (!window.originalImageDimensions) {
    window.originalImageDimensions = {};
  }
    
  // Set default dimensions for common image labels that may not have actual images
  const canvasElement = document.getElementById('canvas');
  if (canvasElement && !window.originalImageDimensions[currentImageLabel]) {
    window.originalImageDimensions[currentImageLabel] = {
      width: canvasElement.width,
      height: canvasElement.height
    };
    console.log(`[INIT] Set default dimensions for ${currentImageLabel}: ${canvasElement.width}x${canvasElement.height}`);
  }

  // Helper: user-facing image name (custom > tag-based > base label)
  if (!window.getUserFacingImageName) {
    window.getUserFacingImageName = function(label) {
      if (window.customImageNames && window.customImageNames[label]) {
        return window.customImageNames[label];
      }
      if (typeof window.getTagBasedFilename === 'function') {
        const tagBased = window.getTagBasedFilename(label, (label || '').split('_')[0]);
        if (tagBased && tagBased !== label) return tagBased;
      }
      return (label || '').split('_')[0];
    };
  }

  // Make addImageToSidebar available globally for the project manager
  window.addImageToSidebar = addImageToSidebar;
  function addImageToSidebar(imageUrl, label, filename) {
    // *** ADDED LOG ***
    //         console.log(`[addImageToSidebar] Called for label: ${label}, imageUrl: ${imageUrl ? imageUrl.substring(0,30) + '...' : 'null'}`);

    const container = document.createElement('button');
    container.type = 'button';
    container.className = 'image-container group w-full text-left relative flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 transition-colors snap-center';
    container.dataset.label = label;
    container.dataset.originalImageUrl = imageUrl; // Store the original image URL for later restoration
    container.draggable = true; // Enable drag-and-drop
        
    // Determine display name: custom name > tag-based name > fallback
    function getDisplayName() {
      return window.getUserFacingImageName(label);
    }
        
    // Create image label (name display) - clickable for inline editing
    const labelElement = document.createElement('div');
    labelElement.className = 'hidden';
    labelElement.title = '';
        
    function updateLabelText() {
      const displayName = getDisplayName();
      labelElement.textContent = displayName.charAt(0).toUpperCase() + displayName.slice(1);
    }
        
    updateLabelText();
        
    // Add inline rename functionality
    labelElement.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent container click
            
      const currentName = getDisplayName();
      const input = document.createElement('input');
      input.type = 'text';
      input.value = currentName;
      input.className = 'text-xs font-medium bg-white border border-primary-400 rounded px-1 py-0.5 w-full outline-none';
            
      // Replace label with input
      labelElement.style.display = 'none';
      labelElement.parentNode.insertBefore(input, labelElement);
      input.focus();
      input.select();
            
      function finishEditing(save = true) {
        if (save && input.value.trim() && input.value.trim() !== currentName) {
          // Save custom name
          if (!window.customImageNames) window.customImageNames = {};
          window.customImageNames[label] = input.value.trim();
          updateLabelText();
        }
                
        // Remove input, show label
        input.remove();
        labelElement.style.display = '';
      }
            
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          finishEditing(true);
        } else if (e.key === 'Escape') {
          finishEditing(false);
        }
      });
            
      input.addEventListener('blur', () => finishEditing(true));
    });
        
    // Store reference for updates from tag manager
    labelElement._updateDisplay = updateLabelText;
        
    // Tags button removed
        
    // Remove stroke count display in compact list
    const strokesElement = document.createElement('div');
    strokesElement.className = 'hidden';
        
    // Create scale display
    const scaleElement = document.createElement('div');
    scaleElement.className = 'hidden';
    scaleElement.id = `scale-${label}`;
        
    // Create the image element
    const img = document.createElement('img');
    img.src = imageUrl; // will be replaced by a generated thumbnail including vectors
    img.className = 'pasted-image w-full h-40 rounded-lg object-contain bg-slate-100 shadow-sm';
    img.alt = `${label} view`;
        
    // Create delete button
    const deleteButton = document.createElement('button');
    deleteButton.className = 'delete-image-btn opacity-0 group-hover:opacity-100 transition-opacity';
    deleteButton.textContent = '×';
    deleteButton.title = 'Delete image';
    deleteButton.style.cssText = `
            position: absolute;
            top: 6px;
            right: 6px;
            cursor: pointer;
            background: rgba(255, 255, 255, 0.9);
            border: 1px solid #ccc;
            border-radius: 50%;
            width: 20px;
            height: 20px;
            font-size: 12px;
            font-weight: bold;
            font-family: Arial, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10;
            color: #666;
            line-height: 1;
            padding: 0;
            margin: 0;
            text-align: center;
        `;
        
    // Delete button hover effect
    deleteButton.addEventListener('mouseenter', () => {
      deleteButton.style.background = '#ff4444';
      deleteButton.style.color = 'white';
      deleteButton.style.borderColor = '#ff4444';
    });
        
    deleteButton.addEventListener('mouseleave', () => {
      deleteButton.style.background = 'rgba(255, 255, 255, 0.9)';
      deleteButton.style.color = '#666';
      deleteButton.style.borderColor = '#ccc';
    });
        
    // Delete button click handler
    deleteButton.addEventListener('click', async (e) => {
      e.stopPropagation(); // Prevent container click (switchToImage)
            
      const confirmMsg = `Are you sure you want to delete image "${label}" and all its associated strokes and data? You can undo this with Ctrl+Z.`;
      if (!confirm(confirmMsg)) {
        return;
      }
            
      // Perform deletion (await because it converts blob URLs to data URLs)
      await deleteImage(label, container);
    });
        
    // Add all elements to container
    // Layout: [thumb] [x]
    container.appendChild(img);

    // Generate a high-quality thumbnail that includes current vectors
    try {
      generateImageThumbnail(label, 320).then((dataUrl) => {
        if (dataUrl) {
          img.src = dataUrl;
        } else if (imageUrl) {
          img.src = imageUrl;
        }
      }).catch(() => { /* ignore */ });
    } catch (_) { /* ignore */ }
    container.appendChild(deleteButton);
        
    // Set up click handler: switch image and auto-scroll this item to center
    container.onclick = () => {
      saveState();
      switchToImage(label);
      const list = document.getElementById('imageList');
      if (list) {
        const listRect = list.getBoundingClientRect();
        const elRect = container.getBoundingClientRect();
        const delta = (elRect.top - listRect.top) + (elRect.height / 2) - (listRect.height / 2);
        // Suppress scroll-driven switching during this smooth scroll
        window.__imageListProgrammaticScrollUntil = Date.now() + 250;
        list.scrollBy({ top: delta, behavior: 'smooth' });
      }
    };

    // Store reference to container for selection updates
    container._label = label;
        
    // Add drag-and-drop event listeners
    container.addEventListener('dragstart', (e) => {
      draggedImageItem = container;
      e.dataTransfer.setData('text/plain', label);
      e.dataTransfer.effectAllowed = 'move';
      container.classList.add('dragging');
    });
        
    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
            
      if (draggedImageItem && draggedImageItem !== container) {
        // Determine if we should insert before or after based on mouse position
        const rect = container.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
                
        // Remove any existing drag-over classes
        container.classList.remove('drag-over-before', 'drag-over-after');
                
        if (e.clientY < midpoint) {
          container.classList.add('drag-over-before');
        } else {
          container.classList.add('drag-over-after');
        }
      }
    });
        
    container.addEventListener('dragleave', (e) => {
      container.classList.remove('drag-over-before', 'drag-over-after');
    });
        
    container.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
            
      container.classList.remove('drag-over-before', 'drag-over-after');
            
      if (draggedImageItem && draggedImageItem !== container) {
        const imageList = document.getElementById('imageList');
        const rect = container.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
                
        if (e.clientY < midpoint) {
          // Insert before this container
          imageList.insertBefore(draggedImageItem, container);
        } else {
          // Insert after this container
          imageList.insertBefore(draggedImageItem, container.nextSibling);
        }
      }
    });
        
    container.addEventListener('dragend', (e) => {
      container.classList.remove('dragging');
      document.querySelectorAll('.image-container').forEach(el => {
        el.classList.remove('drag-over-before', 'drag-over-after');
      });
      draggedImageItem = null;
            
      // Update ordered image labels after drag-and-drop reordering
      updateOrderedImageLabelsArray();
            
      // Update the ordered image labels array after reordering
      updateOrderedImageLabelsArray();
    });
        
    // Finally add to the sidebar
    document.getElementById('imageList').appendChild(container);
    if (typeof window.observeImageContainer === 'function') window.observeImageContainer(container);
        
    // Observe snapping/visibility for active-name box
    ensureImageSnapObserver();
    //         console.log(`[addImageToSidebar] Successfully appended container for ${label}. #imageList children: ${document.getElementById('imageList').children.length}`);
        
    // Update the ordered image labels array
    updateOrderedImageLabelsArray();
        
    // Update the stroke count
    updateSidebarStrokeCounts();
  }
    
  // Helper function to convert any image URL to a data URL
  async function imageUrlToDataUrl(imageUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'Anonymous'; // Handle CORS if needed
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const dataUrl = canvas.toDataURL('image/png');
          resolve(dataUrl);
        } catch (e) {
          console.error('[imageUrlToDataUrl] Error converting:', e);
          resolve(imageUrl); // Fallback to original URL
        }
      };
      img.onerror = () => {
        console.error('[imageUrlToDataUrl] Failed to load image');
        resolve(imageUrl); // Fallback to original URL
      };
      img.src = imageUrl;
    });
  }
    
  // Function to restore a deleted image from undo data
  function restoreDeletedImage(imageData) {
    const label = imageData.label;
    console.log(`[restoreDeletedImage] Restoring image: ${label}`);
        
    // Use originalImageUrl (data URL) for restoration
    const imageUrl = imageData.originalImageUrl || imageData.originalImage;
        
    // Restore all data structures
    window.imageScaleByLabel[label] = imageData.imageScale;
    window.imagePositionByLabel[label] = imageData.imagePosition ? {...imageData.imagePosition} : {x: 0, y: 0};
    window.lineStrokesByImage[label] = imageData.lineStrokes ? [...imageData.lineStrokes] : [];
    window.vectorStrokesByImage[label] = imageData.vectorStrokes ? JSON.parse(JSON.stringify(imageData.vectorStrokes)) : {};
    window.strokeVisibilityByImage[label] = imageData.strokeVisibility ? {...imageData.strokeVisibility} : {};
    window.strokeLabelVisibility[label] = imageData.strokeLabelVisibility ? {...imageData.strokeLabelVisibility} : {};
    window.strokeMeasurements[label] = imageData.strokeMeasurements ? JSON.parse(JSON.stringify(imageData.strokeMeasurements)) : {};
    window.labelsByImage[label] = imageData.labelsByImage;
    window.undoStackByImage[label] = imageData.undoStack ? [...imageData.undoStack] : [];
    window.redoStackByImage[label] = imageData.redoStack ? [...imageData.redoStack] : [];
    window.imageStates[label] = imageData.imageState;
    window.originalImages[label] = imageUrl; // Use the persistent data URL
    window.originalImageDimensions[label] = imageData.originalImageDimensions ? {...imageData.originalImageDimensions} : null;
    window.imageTags[label] = (imageData.imageTags && Array.isArray(imageData.imageTags)) ? [...imageData.imageTags] : [];
    window.customImageNames[label] = imageData.customImageName;
    window.selectedStrokeByImage[label] = null;
    window.multipleSelectedStrokesByImage[label] = [];
        
    // Restore custom label positions
    Object.keys(imageData.customLabelPositions || {}).forEach(key => {
      window.customLabelPositions[key] = JSON.parse(JSON.stringify(imageData.customLabelPositions[key]));
      syncLabelOffsetsToStorage(key, window.customLabelPositions[key]);
    });
        
    // Restore calculated label offsets
    Object.keys(imageData.calculatedLabelOffsets || {}).forEach(key => {
      window.calculatedLabelOffsets[key] = JSON.parse(JSON.stringify(imageData.calculatedLabelOffsets[key]));
    });
        
    // Restore to pastedImages if it had a URL
    if (imageUrl && !pastedImages.includes(imageUrl)) {
      pastedImages.push(imageUrl);
    }
        
    // Re-create the DOM container by calling addImageToSidebar
    const imageList = document.getElementById('imageList');
    if (imageList && imageUrl) {
      // Call addImageToSidebar to recreate the thumbnail (params: imageUrl, label)
      addImageToSidebar(imageUrl, label);
            
      // Move the newly added container to its original position
      if (typeof imageData.containerIndex === 'number' && imageData.containerIndex >= 0) {
        const containers = Array.from(imageList.querySelectorAll('.image-container'));
        const restoredContainer = containers.find(c => c.dataset.label === label);
                
        if (restoredContainer && imageData.containerIndex < containers.length - 1) {
          // Remove from current position (end of list)
          restoredContainer.remove();
                    
          // Insert at original position
          const targetContainer = containers[imageData.containerIndex];
          if (targetContainer) {
            imageList.insertBefore(restoredContainer, targetContainer);
            console.log(`[restoreDeletedImage] Moved image to original position: index ${imageData.containerIndex}`);
          }
        }
      }
            
      // Update the ordered array
      updateOrderedImageLabelsArray();
            
      // If this was the current image, switch back to it
      if (imageData.wasCurrentImage) {
        setTimeout(() => {
          switchToImage(label);
        }, 100);
      }
    }
        
    updateStrokeCounter();
    updateStrokeVisibilityControls();
    console.log(`[restoreDeletedImage] Successfully restored image: ${label}`);
  }
    
  // Function to delete an image and clean up all associated data
  async function deleteImage(label, container) {
    //         console.log(`[deleteImage] Deleting image: ${label}`);
        
    // Convert blob/object URL to data URL for persistence
    const originalImageUrl = container.dataset.originalImageUrl;
    let persistentImageUrl = originalImageUrl;
        
    // If it's a blob URL, convert to data URL so it persists
    if (originalImageUrl && originalImageUrl.startsWith('blob:')) {
      console.log('[deleteImage] Converting blob URL to data URL for undo persistence');
      persistentImageUrl = await imageUrlToDataUrl(originalImageUrl);
    }
        
    // Save all image data for undo BEFORE deletion
    const imageData = {
      type: 'delete-image',
      label: label,
      imageScale: window.imageScaleByLabel[label],
      imagePosition: window.imagePositionByLabel[label] ? {...window.imagePositionByLabel[label]} : null,
      lineStrokes: window.lineStrokesByImage[label] ? [...window.lineStrokesByImage[label]] : [],
      vectorStrokes: window.vectorStrokesByImage[label] ? JSON.parse(JSON.stringify(window.vectorStrokesByImage[label])) : {},
      strokeVisibility: window.strokeVisibilityByImage[label] ? {...window.strokeVisibilityByImage[label]} : {},
      strokeLabelVisibility: window.strokeLabelVisibility[label] ? {...window.strokeLabelVisibility[label]} : {},
      strokeMeasurements: window.strokeMeasurements[label] ? JSON.parse(JSON.stringify(window.strokeMeasurements[label])) : {},
      labelsByImage: window.labelsByImage[label],
      undoStack: window.undoStackByImage[label] ? [...window.undoStackByImage[label]] : [],
      redoStack: window.redoStackByImage[label] ? [...window.redoStackByImage[label]] : [],
      imageState: window.imageStates[label],
      originalImage: window.originalImages[label],
      originalImageDimensions: window.originalImageDimensions[label] ? {...window.originalImageDimensions[label]} : null,
      imageTags: (window.imageTags && window.imageTags[label] && Array.isArray(window.imageTags[label])) ? [...window.imageTags[label]] : [],
      customImageName: window.customImageNames[label],
      containerHTML: container.outerHTML, // Save full container HTML for DOM restoration
      containerIndex: Array.from(container.parentElement.children).indexOf(container), // Save position
      originalImageUrl: persistentImageUrl, // Use converted data URL instead of blob URL
      wasCurrentImage: currentImageLabel === label
    };
        
    // Save custom label positions for this image
    imageData.customLabelPositions = {};
    Object.keys(window.customLabelPositions || {}).forEach(key => {
      if (key.startsWith(`${label}_`)) {
        imageData.customLabelPositions[key] = JSON.parse(JSON.stringify(window.customLabelPositions[key]));
      }
    });
        
    // Save calculated label offsets for this image
    imageData.calculatedLabelOffsets = {};
    Object.keys(window.calculatedLabelOffsets || {}).forEach(key => {
      if (key.startsWith(`${label}_`)) {
        imageData.calculatedLabelOffsets[key] = JSON.parse(JSON.stringify(window.calculatedLabelOffsets[key]));
      }
    });
        
    // Push to undo stack (use a global undo stack for image deletions)
    if (!window.globalUndoStack) {
      window.globalUndoStack = [];
    }
    window.globalUndoStack.push(imageData);
        
    // Clear global redo stack when new action is performed
    window.globalRedoStack = [];
        
    console.log(`[deleteImage] Saved undo data for image: ${label}`);
        
    // Remove from DOM
    container.remove();
        
    // Update the ordered image labels array after deletion
    updateOrderedImageLabelsArray();
        
    // Clean up data structures
    delete window.imageScaleByLabel[label];
    delete window.imagePositionByLabel[label];
    delete window.lineStrokesByImage[label];
    delete window.vectorStrokesByImage[label];
    delete window.strokeVisibilityByImage[label];
    delete window.strokeLabelVisibility[label];
    delete window.strokeMeasurements[label];
    delete window.labelsByImage[label];
    delete window.undoStackByImage[label];
    delete window.redoStackByImage[label];
    delete window.imageStates[label];
    delete window.originalImages[label];
    delete window.originalImageDimensions[label];
    if (window.imageTags && window.imageTags[label]) {
      delete window.imageTags[label];
    }
    delete window.customLabelPositions[label];
    delete window.calculatedLabelOffsets[label];
    delete window.customImageNames[label]; // Clean up custom names
    // Clear the persistence flags for this image label
    Object.keys(window.clearedMassiveOffsets).forEach(key => {
      if (key.startsWith(`${label}_`)) {
        delete window.clearedMassiveOffsets[key];
      }
    });
    delete window.selectedStrokeByImage[label];
    delete window.multipleSelectedStrokesByImage[label];
        
    // Remove from pastedImages array if present (use persistentImageUrl already declared above)
    if (persistentImageUrl) {
      pastedImages = pastedImages.filter(url => url !== persistentImageUrl);
    }
        
    // Handle currentImageLabel if it was the deleted image
    if (currentImageLabel === label) {
      const imageListEl = document.getElementById('imageList');
      let nextLabelToSwitch = null;
            
      if (imageListEl.children.length > 0) {
        // Switch to the first available image
        nextLabelToSwitch = imageListEl.children[0].dataset.label;
      }
            
      if (nextLabelToSwitch) {
        switchToImage(nextLabelToSwitch);
      } else {
        // No images left
        currentImageLabel = null;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        updateStrokeCounter(); // Will show 0
        updateStrokeVisibilityControls(); // Will show "no strokes"
        updateActiveImageInSidebar();
      }
    }
        
    // Exit edit mode if the deleted image had a stroke in edit mode
    if (window.selectedStrokeInEditMode) {
      const editModeImageLabel = window.selectedStrokeInEditMode.split('_')[0];
      if (editModeImageLabel === label) {
        window.selectedStrokeInEditMode = null;
      }
    }
        
    // Update UI
    updateSidebarStrokeCounts();
        
    //         console.log(`[deleteImage] Successfully deleted image: ${label}`);
  }
    
  // Function to update the ordered image labels array based on current DOM order
  function updateOrderedImageLabelsArray() {
    const imageListEl = document.getElementById('imageList');
    if (imageListEl) {
      const currentOrder = window.orderedImageLabels ? [...window.orderedImageLabels] : [];
      window.orderedImageLabels = Array.from(imageListEl.children)
        .map(container => container.dataset.label)
        .filter(label => label); // Ensure only valid labels are included
            
      // Log for debugging image order discrepancies
      if (JSON.stringify(currentOrder) !== JSON.stringify(window.orderedImageLabels)) {
        //                 console.log('[updateOrderedImageLabelsArray] Order changed from:', currentOrder, 'to:', window.orderedImageLabels);
      }
    } else {
      console.warn('[updateOrderedImageLabelsArray] imageList element not found!');
    }
  }

  // Ensure scroll-snap tracker to sync sticky name box
  let __imageSnapObserverSetup = false;
  window.__imageSnapIO = window.__imageSnapIO || null;
  function ensureImageSnapObserver() {
    if (__imageSnapObserverSetup) return;
    const list = document.getElementById('imageList');
    const nameBox = document.getElementById('currentImageNameBox');
    if (!list || !nameBox) return;

    const updateNameBox = (activeLabel) => {
      if (!activeLabel) return;
      const name = (typeof window.getUserFacingImageName === 'function')
        ? window.getUserFacingImageName(activeLabel)
        : (activeLabel || '');
      nameBox.value = name;
      nameBox.dataset.label = activeLabel;
    };

    // Manual rename from sticky box
    nameBox.addEventListener('change', () => {
      const lbl = nameBox.dataset.label;
      const val = nameBox.value.trim();
      if (!lbl) return;
      if (!window.customImageNames) window.customImageNames = {};
      if (val.length > 0) window.customImageNames[lbl] = val; else delete window.customImageNames[lbl];
      // No visible per-item label anymore, nothing else to update here
    });

    // Scroll-based closest-to-center tracking
    let ticking = false;
    const handleScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        // Suppress switching if we're in a programmatic smooth scroll window
        const now = Date.now();
        if (window.__imageListProgrammaticScrollUntil && now < window.__imageListProgrammaticScrollUntil) {
          ticking = false;
          return;
        }

        const listRect = list.getBoundingClientRect();
        const anchorY = listRect.height / 2; // center guideline
        let best = null;
        let bestDist = Infinity;
        list.querySelectorAll('.image-container').forEach(el => {
          const r = el.getBoundingClientRect();
          const center = (r.top - listRect.top) + r.height / 2;
          const dist = Math.abs(center - anchorY);
          if (dist < bestDist) { bestDist = dist; best = el; }
        });
        if (best) updateNameBox(best.getAttribute('data-label'));
        // Switch main canvas image when crossing center with hysteresis (no save during scroll)
        if (best && typeof window.switchToImage === 'function') {
          const newLabel = best.getAttribute('data-label');
          if (window.currentImageLabel !== newLabel) {
            // Compute current element distance to center
            const currentEl = list.querySelector(`.image-container[data-label="${window.currentImageLabel}"]`);
            let currentDist = Infinity;
            if (currentEl) {
              const rr = currentEl.getBoundingClientRect();
              const currCenter = (rr.top - listRect.top) + rr.height / 2;
              currentDist = Math.abs(currCenter - anchorY);
            }
            const threshold = 12; // require new candidate to be clearly closer than current
            if (bestDist + threshold < currentDist) {
              window.switchToImage(newLabel);
            }
          }
        }
        ticking = false;
      });
    };

    list.addEventListener('scroll', handleScroll, { passive: true });
    // Also run on resize to keep center detection accurate
    window.addEventListener('resize', handleScroll, { passive: true });

    // Initialize to first element - scroll it to center BEFORE running handleScroll
    const first = list.querySelector('.image-container');
    if (first) {
      // Get label from data attribute or from imageGalleryData
      let firstLabel = first.getAttribute('data-label');
      if (!firstLabel && window.imageGalleryData && window.imageGalleryData.length > 0) {
        const firstImage = window.imageGalleryData[0];
        firstLabel = firstImage?.name || firstImage?.label;
      }
            
      if (firstLabel) {
        updateNameBox(firstLabel);
                
        // Suppress scroll detection during initialization
        window.__imageListProgrammaticScrollUntil = Date.now() + 200;
                
        // Scroll first image to center position
        first.scrollIntoView({ behavior: 'auto', block: 'center' });
                
        // Explicitly switch to first image after scroll completes
        setTimeout(() => {
          if (window.switchToImage) {
            console.log('[INIT] Explicitly switching to first image:', firstLabel);
            window.switchToImage(firstLabel);
          } else {
            handleScroll();
          }
        }, 100);
      } else {
        handleScroll();
      }
    } else {
      handleScroll();
    }

    // Optional helper for future additions (no IO needed now)
    window.observeImageContainer = function(_) { /* no-op with scroll tracker */ };

    __imageSnapObserverSetup = true;
  }

  // Store the original images for each view
  window.originalImages = window.originalImages || {};
    
  // Initialize custom image names storage
  window.customImageNames = window.customImageNames || {};
    
  // Initialize custom label absolute positions map
  if (!window.customLabelAbsolutePositions) window.customLabelAbsolutePositions = {};
    
  // --- MODIFIED Function Signature and Logic --- 
  // Optional opts:
  // - preserveCanvasScale: boolean. If true and previous dimensions exist for this label,
  //   the function adjusts imageScaleByLabel so the on-canvas size remains visually
  //   consistent after replacing the image (e.g., after background removal that changes
  //   pixel dimensions). Defaults to false for backwards compatibility.
  // - preserveBasis: 'width' | 'height' | 'max' | 'min' (default: 'width').
  function pasteImageFromUrl(url, label, opts) {
    // Wrap in a Promise
    return new Promise((resolve, reject) => {
      //             console.log(`[pasteImageFromUrl] Pasting image for ${label}: ${url.substring(0, 30)}...`);
        
      // LABEL REPROJECTION: capture pre-replace canvas centers for this image
      let __preCenters = null;
      try {
        if (labelReprojectEnabled()) {
          __preCenters = capturePreReplaceLabelCenters(label);
          if (!window.__labelReprojectPreCenters) window.__labelReprojectPreCenters = {};
          window.__labelReprojectPreCenters[label] = __preCenters;
          if (labelReprojectDebug()) console.log(`[LABEL-REPROJECT] capture pre centers: ${Object.keys(__preCenters||{}).length} for ${label}`);
        }
      } catch (_) {}
        
      const img = new Image();
      try { img.crossOrigin = 'anonymous'; } catch (_) {}
      img.onload = () => {
        // **NEW**: Record image dimensions for offset tracking
        if (img.naturalWidth && img.naturalHeight) {
          lastImageDims[label] = { w: img.naturalWidth, h: img.naturalHeight };
        }

        // Before mutating globals, capture previous dimensions and scale (if any)
        const prevDims = (window.originalImageDimensions && window.originalImageDimensions[label]) || null;
        const prevScale = (window.imageScaleByLabel && window.imageScaleByLabel[label] != null)
          ? window.imageScaleByLabel[label]
          : 1.0;

        // Optionally preserve the visual on-canvas size if the underlying pixel
        // dimensions change (common after background removal/cropping)
        const preserve = opts && opts.preserveCanvasScale;
        const basis = (opts && opts.preserveBasis) || 'width';

        // Store the original image URL for this view
        window.originalImages[label] = url;
                
        // Ensure the dimensions map exists
        if (!window.originalImageDimensions) {
          window.originalImageDimensions = {};
        }
            
        // If requested, adjust the stored scale so that the drawn size remains the same
        // after the replacement image loads.
        if (preserve && prevDims && img && img.width > 0 && img.height > 0) {
          let ratioW = prevDims.width / img.width;
          let ratioH = prevDims.height / img.height;
          let ratio = ratioW; // default: preserve by width
          if (basis === 'height') ratio = ratioH;
          else if (basis === 'max') ratio = Math.max(ratioW, ratioH);
          else if (basis === 'min') ratio = Math.min(ratioW, ratioH);

          let newScale = prevScale * (isFinite(ratio) && ratio > 0 ? ratio : 1);
          // Clamp to avoid extreme values if something goes wrong
          const MIN_SCALE = 0.02; // 2%
          const MAX_SCALE = 20;   // 2000%
          if (newScale < MIN_SCALE) newScale = MIN_SCALE;
          if (newScale > MAX_SCALE) newScale = MAX_SCALE;
          if (!window.imageScaleByLabel) window.imageScaleByLabel = {};
          window.imageScaleByLabel[label] = newScale;
          // Keep UI in sync if this is the active image
          if (typeof updateScaleUI === 'function' && label === currentImageLabel) {
            try { updateScaleUI(); } catch (_) {}
          }
        }

        // Store new dimensions for future operations
        window.originalImageDimensions[label] = {
          width: img.width,
          height: img.height
        };
                
        // Log dimensions for debugging
        console.log(`[pasteImageFromUrl] Stored dimensions for ${label}: ${img.width}x${img.height}`);

        // If we replaced the image (e.g., remove BG) while preserving canvas scale,
        // previously calculated image-space label offsets need to be rebased so that
        // their visual (canvas-space) displacement stays consistent. Since we adjusted
        // the scale by `ratio`, divide the stored image-space offsets by the same ratio.
        // Preserve user-defined custom positions as-is.
        try {
          if (opts && opts.preserveCanvasScale && prevDims) {
            // Determine the ratio that was used to adjust scale above
            let ratioW = prevDims.width / img.width;
            let ratioH = prevDims.height / img.height;
            let ratioUsed = ratioW;
            const basisForOffsets = (opts && opts.preserveBasis) || 'width';
            if (basisForOffsets === 'height') ratioUsed = ratioH;
            else if (basisForOffsets === 'max') ratioUsed = Math.max(ratioW, ratioH);
            else if (basisForOffsets === 'min') ratioUsed = Math.min(ratioW, ratioH);

            if (isFinite(ratioUsed) && ratioUsed > 0) {
              if (window.calculatedLabelOffsets && window.calculatedLabelOffsets[label]) {
                const map = window.calculatedLabelOffsets[label];
                const keys = Object.keys(map);
                // Always shadow-only: do not persist rebased values; reprojection will commit authoritative offsets
                if (!window.__shadowRebasedOffset) window.__shadowRebasedOffset = {};
                window.__shadowRebasedOffset[label] = window.__shadowRebasedOffset[label] || {};
                keys.forEach(k => {
                  const off = map[k];
                  const px = normalizeToPixels(off, label) || { x: 0, y: 0 };
                  const rebased = { x: px.x / ratioUsed, y: px.y / ratioUsed };
                  window.__shadowRebasedOffset[label][k] = rebased;
                  if (labelReprojectDebug()) console.log('[REBASE] skipped (shadow-only)', { imageId: label, labelId: k, ratio: ratioUsed.toFixed(4) });
                });
              }
            }

            // Also clear any cached label positions so redraw recomputes
            if (typeof invalidateInteractiveElementCache === 'function') {
              invalidateInteractiveElementCache();
            }
          }
        } catch (_) {}
            
            
        // Clear the canvas first
        ctx.clearRect(0, 0, canvas.width, canvas.height);
            
        // Apply current scale factor
        const scale = window.imageScaleByLabel[label] || 1.0; // Use passed-in label (may be adjusted above)
        const scaledWidth = img.width * scale;
        const scaledHeight = img.height * scale;
            
        // Calculate base position (center of the canvas)
        const centerX = (canvas.width - scaledWidth) / 2;
        const centerY = (canvas.height - scaledHeight) / 2;
            
        // Apply position offset
        const position = imagePositionByLabel[label] || { x: 0, y: 0 }; // Use passed-in label
        const offsetX = position.x;
        const offsetY = position.y;
            
        // Calculate final position
        const x = centerX + offsetX;
        const y = centerY + offsetY;
            
        // Draw the image with scaling and positioning
        //                 console.log(`[pasteImageFromUrl] Drawing image for ${label} at Canvas(${x.toFixed(1)}, ${y.toFixed(1)}) Scale: ${scale * 100}%`);
        ctx.drawImage(img, x, y, scaledWidth, scaledHeight);
            
        // Update the scale display in the sidebar
        const scaleElement = document.getElementById(`scale-${label}`);
        if (scaleElement) {
          scaleElement.textContent = `Scale: ${Math.round(scale * 100)}%`;
        }
            
        // Save this as the base state for this image
        const newState = getCanvasState();
        imageStates[label] = cloneImageData(newState); // Use passed-in label
        //                 console.log(`[pasteImageFromUrl] State saved into imageStates[${label}]`);
                
        // If this is the currently active label, update currentStroke
        if (label === currentImageLabel) {
          currentStroke = cloneImageData(newState);
        }
            
        // Initialize the undo stack if needed
        if (!undoStackByImage[label] || undoStackByImage[label].length === 0) {
          undoStackByImage[label] = [{
            state: cloneImageData(newState),
            type: 'initial',
            label: null
          }];
          //                     console.log(`[pasteImageFromUrl] Initialized undo stack for ${label}`);
        }
            
        // Update the scale buttons and main scale text if this is the current view
        if (label === currentImageLabel) {
          updateScaleButtonsActiveState();
          try { if (typeof updateScaleUI === 'function') updateScaleUI(); } catch(_) {}
        }

        // LABEL REPROJECTION: after we updated dims/scale, reproject label offsets to preserve canvas positions
        try {
          if (labelReprojectEnabled() && window.__labelReprojectPreCenters && window.__labelReprojectPreCenters[label]) {
            // session bump for transactional fencing
            bumpImageSession(label);
            applyPostReplaceReprojection(label);
            // Trigger a redraw so that ABS_LOCK_ONCE and/or committed offsets take effect
            try { if (typeof redrawCanvasWithVisibility === 'function') redrawCanvasWithVisibility(); } catch(_) {}

            // Validate coordinate stability after background removal
            if (window.__shadowRebasedOffset && window.__shadowRebasedOffset[label]) {
              console.log(`[COORD-FIX] Background removal coordinate validation for ${label}`);
              Object.keys(window.__shadowRebasedOffset[label]).forEach(strokeLabel => {
                validateCoordinateStability(label, strokeLabel);
              });
            }
          }
        } catch (_) {}
                
        //                 console.log(`[pasteImageFromUrl] Image loaded and state saved for ${label}`);
                
        // Trigger resize to recalculate fit scale for the newly loaded image
        if (label === currentImageLabel && typeof window.resizeCanvas === 'function') {
          window.resizeCanvas();
        }
                
        resolve(); // Resolve the promise
      };
            
      img.onerror = (err) => {
        console.error(`[pasteImageFromUrl] Error loading image for ${label}:`, err);
        reject(err); // Reject the promise on error
      };
            
      img.src = url;
    });
  }
  // --- END MODIFIED Function ---

  function getNextLabel(imageLabel) {
    // Use the simplified tag system from index.html
    if (typeof window.calculateNextTag === 'function') {
      const nextTag = window.calculateNextTag();
      console.log('[getNextLabel] Using smart tag system, next tag:', nextTag);
      // Update the display after using the tag
      if (typeof window.updateNextTagDisplay === 'function') {
        setTimeout(() => window.updateNextTagDisplay(), 100);
      }
      return nextTag;
    }
        
    console.log('[getNextLabel] Smart tag system not available, using fallback');
    // Fallback to simple A, B, C... if the new system isn't available
    const currentLabel = labelsByImage[imageLabel];
    if (!currentLabel || typeof currentLabel !== 'string' || currentLabel.length === 0) {
      console.log('[getNextLabel] No current label, returning A');
      return 'A';
    }
        
    const letter = currentLabel[0];
    const nextLetter = String.fromCharCode(letter.charCodeAt(0) + 1);
    console.log('[getNextLabel] Fallback logic, current:', currentLabel, 'next:', nextLetter);
    return nextLetter;
  }

  // Make updateStrokeCounter available globally
  window.updateStrokeCounter = updateStrokeCounter;
  function updateStrokeCounter() {
    const strokeCount = window.paintApp.state.lineStrokesByImage[window.paintApp.state.currentImageLabel]?.length || 0;
    strokeCounter.textContent = `Lines: ${strokeCount}`;
        
    // Update visibility controls
    updateStrokeVisibilityControls();
        
    // Update next tag display
    if (typeof window.updateNextTagDisplay === 'function') {
      window.updateNextTagDisplay();
    }
  }
    
  // PERFORMANCE FIX: Throttled updateStrokeVisibilityControls to prevent excessive UI rebuilds
  let updateStrokeVisibilityControlsThrottled = false;
  const originalUpdateStrokeVisibilityControls = updateStrokeVisibilityControls;
    
  window.updateStrokeVisibilityControls = function() {
    // Skip during loading to prevent side effects
    if (window.isLoadingProject) {
      console.log('[updateStrokeVisibilityControls] Skipped during project loading');
      return;
    }
        
    // Throttle rapid calls
    if (!updateStrokeVisibilityControlsThrottled) {
      updateStrokeVisibilityControlsThrottled = true;
      requestAnimationFrame(() => {
        updateStrokeVisibilityControlsThrottled = false;
        if (typeof originalUpdateStrokeVisibilityControls === 'function') {
          originalUpdateStrokeVisibilityControls();
        }
      });
    }
  };
    
  // PERFORMANCE FIX: Coalesce multiple redrawCanvasWithVisibility calls during loading
  let redrawCanvasThrottled = false;
  let redrawCanvasFrameId = null;
  const originalRedrawCanvasWithVisibility = window.redrawCanvasWithVisibility;
    
  window.redrawCanvasWithVisibility = function() {
    // Skip excessive redraws during loading
    if (window.isLoadingProject) {
      console.log('[redrawCanvasWithVisibility] Skipped during project loading');
      return;
    }
        
    // Coalesce multiple rapid calls into single frame
    if (redrawCanvasFrameId) {
      cancelAnimationFrame(redrawCanvasFrameId);
    }
        
    redrawCanvasFrameId = requestAnimationFrame(() => {
      redrawCanvasFrameId = null;
      if (typeof originalRedrawCanvasWithVisibility === 'function') {
        originalRedrawCanvasWithVisibility();
      }
    });
  };
    
  function updateSidebarStrokeCounts() {
    // Update stroke counts in the sidebar
    const imageContainers = document.querySelectorAll('.image-container');
    imageContainers.forEach(container => {
      const label = container.dataset.label;
      if (label) {
        const strokesElement = container.querySelector('.image-strokes');
        if (strokesElement) {
          const strokes = lineStrokesByImage[label] || [];
          strokesElement.textContent = `Strokes: ${strokes.length}`;
        }
      }
    });
        
    // Also update visibility controls when sidebar is updated
    updateStrokeVisibilityControls();
  }

  function getCanvasState() {
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  function restoreCanvasState(state) {
    if (!state) return;
    // If the saved bitmap doesn't match the current canvas size, re-render instead of anchoring at (0,0)
    if (state.width !== canvas.width || state.height !== canvas.height) {
      redrawCanvasWithVisibility();
      return;
    }
    ctx.putImageData(state, 0, 0);
  }
    
  // Initialize measurement data store
  IMAGE_LABELS.forEach(label => {
    if (!window.strokeMeasurements[label]) {
      window.strokeMeasurements[label] = {};
    }
  });
    
  // Function to get formatted measurement string
  function getMeasurementString(strokeLabel) {
    // Add detailed logging
    //         console.log(`[getMeasurementString] Called for ${strokeLabel} in ${currentImageLabel} view`);
        
    // Check if we have measurements for this image
    if (!window.strokeMeasurements[currentImageLabel]) {
      //             console.log(`[getMeasurementString] No measurements found for ${currentImageLabel}`);
      return '';
    }
        
    const measurement = window.strokeMeasurements[currentImageLabel][strokeLabel];
    //         console.log(`[getMeasurementString] Measurement data for ${strokeLabel}:`, measurement);
        
    if (!measurement) {
      //             console.log(`[getMeasurementString] No measurement found for ${strokeLabel}`);
      return '';
    }
        
    const unit = document.getElementById('unitSelector').value;
    //         console.log(`[getMeasurementString] Current unit: ${unit}`);
        
    if (unit === 'inch') {
      const whole = measurement.inchWhole || 0;
      const fraction = measurement.inchFraction || 0;
            
      // Format as 1 1/4" etc.
      let fractionStr = '';
      if (fraction > 0) {
        // Convert stored decimal fraction to the nearest common
        // eighth-based fraction for display.
        const rounded = findClosestFraction(fraction);
        const fractionMap = {
          0.125: '1/8',
          0.25: '1/4',
          0.375: '3/8',
          0.5: '1/2',
          0.625: '5/8',
          0.75: '3/4',
          0.875: '7/8'
        };
        if (fractionMap[rounded]) {
          fractionStr = ' ' + fractionMap[rounded];
        }
      }
            
      const result = `${whole}${fractionStr}"`;
      //             console.log(`[getMeasurementString] Returning inch format: ${result}`);
      return result;
    } else {
      // CM with one decimal
      const result = `${measurement.cm.toFixed(1)} cm`;
      //             console.log(`[getMeasurementString] Returning cm format: ${result}`);
      return result;
    }
  }
    
  // Function to convert between units
  function convertUnits(from, value) {
    if (from === 'inch') {
      // Convert inch to cm
      return value * window.paintApp.config.INCHES_TO_CM;
    } else {
      // Convert cm to inch
      return value / window.paintApp.config.INCHES_TO_CM;
    }
  }
    
  // Function to update all measurements when unit changes
  function updateMeasurementDisplay() {
    window.currentUnit = document.getElementById('unitSelector').value;
    //         console.log(`[updateMeasurementDisplay] Unit changed to: ${window.currentUnit}`);
    updateStrokeVisibilityControls(); // Update the list to show new units
    redrawCanvasWithVisibility(); // Redraw canvas labels with new units
  }
    
  // Make function globally available for HTML onchange handlers
  window.updateMeasurementDisplay = updateMeasurementDisplay;

  // Function to generate a comprehensive list of all measurements
  function generateMeasurementsList() {
    const projectName = document.getElementById('projectName').value || 'Untitled Project';
    const currentUnit = document.getElementById('unitSelector').value;
        
    let measurementsList = `${projectName} - Measurements List\n`;
    measurementsList += `Generated on: ${new Date().toLocaleDateString()}\n`;
    measurementsList += `Unit: ${currentUnit === 'inch' ? 'Inches' : 'Centimeters'}\n`;
    measurementsList += `${'='.repeat(50)}\n\n`;
        
    // Get all images that have measurements
    const imageLabels = Object.keys(window.strokeMeasurements || {});
        
    if (imageLabels.length === 0) {
      measurementsList += 'No measurements found in this project.\n';
      showMeasurementsDialog(measurementsList);
      return;
    }
        
    imageLabels.forEach(imageLabel => {
      const measurements = window.strokeMeasurements[imageLabel];
      if (!measurements) return;
            
      const strokeLabels = Object.keys(measurements);
      if (strokeLabels.length === 0) return;
            
      // Capitalize and format image label
      const imageName = imageLabel.charAt(0).toUpperCase() + imageLabel.slice(1);
      measurementsList += `${imageName} Image:\n`;
      measurementsList += `${'-'.repeat(imageName.length + 7)}\n`;
            
      strokeLabels.forEach(strokeLabel => {
        const measurement = measurements[strokeLabel];
        if (!measurement) return;
                
        let measurementString = '';
        if (currentUnit === 'inch') {
          const whole = measurement.inchWhole || 0;
          const fraction = measurement.inchFraction || 0;
                    
          let fractionStr = '';
          if (fraction > 0) {
            const fractionMap = {
              0.125: '1/8',
              0.25: '1/4',
              0.375: '3/8',
              0.5: '1/2',
              0.625: '5/8',
              0.75: '3/4',
              0.875: '7/8'
            };
            fractionStr = ' ' + fractionMap[fraction];
          }
          measurementString = `${whole}${fractionStr}"`;
        } else {
          measurementString = `${measurement.cm.toFixed(1)} cm`;
        }
                
        measurementsList += `  ${strokeLabel}: ${measurementString}\n`;
      });
            
      measurementsList += '\n';
    });
        
    showMeasurementsDialog(measurementsList);
  }
    
  // Function to view submitted measurements from shared projects
  async function viewSubmittedMeasurements() {
    const shareId = prompt('Enter the share ID to view submitted measurements:');
    if (!shareId) return;
        
    const editToken = prompt('Enter the edit token for this share:');
    if (!editToken) return;
        
    try {
      const response = await fetch(`/api/shared/${shareId}/measurements?editToken=${encodeURIComponent(editToken)}`);
      const result = await response.json();
            
      if (!result.success) {
        alert('Error: ' + result.message);
        return;
      }
            
      const measurements = result.measurements;
      const totalSubmissions = result.totalSubmissions;
            
      if (totalSubmissions === 0) {
        alert('No submitted measurements found for this share.');
        return;
      }
            
      let measurementsList = `Submitted Measurements for Share: ${shareId}\n`;
      measurementsList += `Total Submissions: ${totalSubmissions}\n`;
      measurementsList += `Generated on: ${new Date().toLocaleDateString()}\n`;
      measurementsList += `${'='.repeat(50)}\n\n`;
            
      Object.entries(measurements).forEach(([submissionId, submission]) => {
        measurementsList += `Submission ID: ${submissionId}\n`;
        measurementsList += `Submitted: ${new Date(submission.submittedAt).toLocaleString()}\n`;
                
        if (submission.customerInfo) {
          measurementsList += `Customer: ${submission.customerInfo.name || 'Anonymous'}`;
          if (submission.customerInfo.email) {
            measurementsList += ` (${submission.customerInfo.email})`;
          }
          measurementsList += '\n';
        }
                
        measurementsList += 'Measurements:\n';
        measurementsList += `${'-'.repeat(12)}\n`;
                
        Object.entries(submission.measurements).forEach(([imageLabel, imageMeasurements]) => {
          measurementsList += `  ${imageLabel}:\n`;
          Object.entries(imageMeasurements).forEach(([strokeLabel, measurement]) => {
            measurementsList += `    ${strokeLabel}: ${measurement.value}\n`;
          });
        });
                
        measurementsList += '\n';
      });
            
      showMeasurementsDialog(measurementsList);
            
    } catch (error) {
      console.error('Error fetching submitted measurements:', error);
      alert('Error fetching submitted measurements. Please check the console for details.');
    }
  }
    
  // Function to display measurements in a modal dialog
  function showMeasurementsDialog(measurementsList) {
    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'measurement-overlay';
    overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.5);
            z-index: 9999;
            display: flex;
            justify-content: center;
            align-items: center;
        `;
        
    // Create dialog
    const dialog = document.createElement('div');
    dialog.className = 'measurement-dialog';
    dialog.style.cssText = `
            background-color: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
            width: 600px;
            max-width: 90%;
            max-height: 80vh;
            overflow-y: auto;
        `;
        
    // Create content
    dialog.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <h3 style="margin: 0; color: #333;">Measurements List</h3>
                <button onclick="this.closest('.measurement-overlay').remove()" style="background: none; border: none; font-size: 18px; cursor: pointer; color: #666;">&times;</button>
            </div>
            <div style="margin-bottom: 20px; position: relative;">
                <textarea readonly style="width: 100%; height: 400px; font-family: monospace; padding: 10px; border: 1px solid #ddd; border-radius: 4px; resize: vertical; font-size: 12px; background-color: #f9f9f9;">${measurementsList}</textarea>
            </div>
            <div style="display: flex; justify-content: flex-end; gap: 10px;">
                <button onclick="copyMeasurementsToClipboard(this)" style="padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; background-color: #4CAF50; color: white;">Copy to Clipboard</button>
                <button onclick="downloadMeasurementsFile()" style="padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; background-color: #2196F3; color: white;">Download as Text</button>
                <button onclick="this.closest('.measurement-overlay').remove()" style="padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; background-color: #f0f0f0; color: #333;">Close</button>
            </div>
        `;
        
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
        
    // Store measurements for copy/download functions
    window.currentMeasurementsList = measurementsList;
  }
    
  // Function to copy measurements to clipboard
  window.copyMeasurementsToClipboard = function(button) {
    navigator.clipboard.writeText(window.currentMeasurementsList).then(() => {
      const originalText = button.textContent;
      button.textContent = 'Copied!';
      button.style.backgroundColor = '#45a049';
      setTimeout(() => {
        button.textContent = originalText;
        button.style.backgroundColor = '#4CAF50';
      }, 2000);
    }).catch(err => {
      console.error('Failed to copy measurements:', err);
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = window.currentMeasurementsList;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
            
      const originalText = button.textContent;
      button.textContent = 'Copied!';
      setTimeout(() => {
        button.textContent = originalText;
      }, 2000);
    });
  };
    
  // Function to download measurements as text file
  window.downloadMeasurementsFile = function() {
    const projectName = document.getElementById('projectName').value || 'Untitled Project';
    const fileName = `${projectName}_Measurements.txt`;
        
    const blob = new Blob([window.currentMeasurementsList], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
        
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Function to save all images as individual PNG files
  function saveAllImages() {
    const projectName = document.getElementById('projectName').value || 'Untitled Project';
        
    // Check both possible storage locations for images
    const originalImages = window.originalImages || window.paintApp.state.originalImages || {};
    const originalImageLabels = Object.keys(originalImages);
        
    if (originalImageLabels.length === 0) {
      alert('No images found to save. Please upload some images first.');
      return;
    }
        
    // Show image selection dialog instead of processing all immediately
    showImageSelectionDialog(originalImageLabels, projectName);
  }
    
  // Function to generate thumbnail for an image
  function generateImageThumbnail(imageLabel, size = 200) {
    return new Promise((resolve) => {
      const originalImages = window.originalImages || window.paintApp.state.originalImages || {};
      const originalImageUrl = originalImages[imageLabel];
            
      if (!originalImageUrl) {
        resolve(null);
        return;
      }
            
      const img = new Image();
      img.onload = () => {
        // Create high-resolution thumbnail canvas
        const thumbCanvas = document.createElement('canvas');
        const thumbCtx = thumbCanvas.getContext('2d');
                
        // Use higher resolution for better quality
        const pixelRatio = window.devicePixelRatio || 1;
        const highResSize = size * pixelRatio;
                
        thumbCanvas.width = highResSize;
        thumbCanvas.height = highResSize;
        thumbCanvas.style.width = size + 'px';
        thumbCanvas.style.height = size + 'px';
                
        // Scale context for high DPI displays
        thumbCtx.scale(pixelRatio, pixelRatio);
                
        // Enable better image rendering
        thumbCtx.imageSmoothingEnabled = true;
        thumbCtx.imageSmoothingQuality = 'high';
                
        // Calculate scaling to fit image in square thumbnail
        const scale = Math.min(size / img.width, size / img.height);
        const scaledWidth = img.width * scale;
        const scaledHeight = img.height * scale;
        const offsetX = (size - scaledWidth) / 2;
        const offsetY = (size - scaledHeight) / 2;
                
        // Draw image with better quality
        thumbCtx.fillStyle = '#f0f0f0';
        thumbCtx.fillRect(0, 0, size, size);
        thumbCtx.drawImage(img, offsetX, offsetY, scaledWidth, scaledHeight);
                
        // Draw visible strokes with better quality
        const vectorStrokes = window.vectorStrokesByImage[imageLabel] || {};
        const strokeVisibility = window.strokeVisibilityByImage[imageLabel] || {};
        const strokeOrder = window.lineStrokesByImage[imageLabel] || [];
                
        // Draw strokes in proper order
        strokeOrder.forEach(strokeLabel => {
          if (strokeVisibility[strokeLabel] !== false && vectorStrokes[strokeLabel]) {
            const vectorData = vectorStrokes[strokeLabel];
            if (vectorData && vectorData.points && vectorData.points.length >= 2) {
              thumbCtx.strokeStyle = vectorData.color || '#ea4335';
              thumbCtx.lineWidth = Math.max(1, 3 * scale); // Scale line width appropriately
              thumbCtx.lineCap = 'round';
              thumbCtx.lineJoin = 'round';
                            
              thumbCtx.beginPath();
              const firstPoint = vectorData.points[0];
              thumbCtx.moveTo(
                offsetX + firstPoint.x * scale,
                offsetY + firstPoint.y * scale
              );
                            
              for (let i = 1; i < vectorData.points.length; i++) {
                const point = vectorData.points[i];
                thumbCtx.lineTo(
                  offsetX + point.x * scale,
                  offsetY + point.y * scale
                );
              }
              thumbCtx.stroke();
                            
              // Draw arrow heads if applicable
              if (vectorData.type === 'arrow' || vectorData.type === 'curved-arrow') {
                const lastPoint = vectorData.points[vectorData.points.length - 1];
                const secondLastPoint = vectorData.points[vectorData.points.length - 2];
                if (lastPoint && secondLastPoint) {
                  const arrowSize = Math.max(4, 8 * scale);
                  drawArrowHead(thumbCtx, 
                    { x: offsetX + secondLastPoint.x * scale, y: offsetY + secondLastPoint.y * scale },
                    { x: offsetX + lastPoint.x * scale, y: offsetY + lastPoint.y * scale },
                    arrowSize, vectorData.color || '#ea4335'
                  );
                }
              }
            }
          }
        });
                
        resolve(thumbCanvas.toDataURL('image/png', 0.9));
      };
            
      img.onerror = () => resolve(null);
      img.src = originalImageUrl;
    });
  }
    
  // Helper function to draw arrow heads for thumbnails
  function drawArrowHead(ctx, from, to, size, color) {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
        
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(
      to.x - size * Math.cos(angle - Math.PI / 6),
      to.y - size * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      to.x - size * Math.cos(angle + Math.PI / 6),
      to.y - size * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
    
  // Function to show image selection dialog
  async function showImageSelectionDialog(imageLabels, projectName) {
    // Create overlay
    const overlay = document.createElement('div');
    overlay.id = 'imageSelectionOverlay';
    overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.7);
            z-index: 10000;
            display: flex;
            justify-content: center;
            align-items: center;
        `;
        
    // Create dialog
    const dialog = document.createElement('div');
    dialog.style.cssText = `
            background-color: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
            width: 700px;
            max-width: 90%;
            max-height: 85vh;
            overflow-y: auto;
        `;
        
    // Initial dialog content with loading state
    dialog.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <h3 style="margin: 0; color: #333;">Select Images to Export</h3>
                <button onclick="this.closest('#imageSelectionOverlay').remove()" style="background: none; border: none; font-size: 18px; cursor: pointer; color: #666;">&times;</button>
            </div>
            
            <!-- Export Mode Selection -->
            <div style="margin-bottom: 25px; padding: 15px; background: #f9f9f9; border-radius: 6px;">
                <h4 style="margin: 0 0 10px 0; color: #333;">Export Mode</h4>
                <label style="display: block; margin-bottom: 8px; cursor: pointer;">
                    <input type="radio" name="exportMode" value="screenView" checked style="margin-right: 8px;">
                    <strong>Screen View</strong> - Export exactly what you see on canvas (recommended)
                </label>
                <label style="display: block; cursor: pointer;">
                    <input type="radio" name="exportMode" value="productionOutput" style="margin-right: 8px;">
                    <strong>Production Output</strong> - Export with measurement labels overlaid on lines
                </label>
            </div>
            
            <!-- Export Method Selection -->
            <div style="margin-bottom: 25px; padding: 15px; background: #e8f5e9; border-radius: 6px;">
                <h4 style="margin: 0 0 10px 0; color: #333;">Export Method</h4>
                <label style="display: block; margin-bottom: 8px; cursor: pointer;">
                    <input type="radio" name="exportMethod" value="individual" checked style="margin-right: 8px;">
                    <strong>📁 Individual Downloads</strong> - Download each file separately (works everywhere)
                </label>
                <label style="display: block; margin-bottom: 8px; cursor: pointer; ${!('showDirectoryPicker' in window) ? 'opacity: 0.5;' : ''}">
                    <input type="radio" name="exportMethod" value="folder" ${!('showDirectoryPicker' in window) ? 'disabled' : ''} style="margin-right: 8px;">
                    <strong>📂 Save to Folder</strong> - Choose a folder to save all files ${!('showDirectoryPicker' in window) ? '(Not supported in this browser)' : '(Modern browsers)'}
                </label>
                <label style="display: block; cursor: pointer;">
                    <input type="radio" name="exportMethod" value="zip" style="margin-right: 8px;">
                    <strong>📦 ZIP File</strong> - Bundle all images into one ZIP file
                </label>
            </div>
            
            <!-- Images Section -->
            <div style="margin-bottom: 20px;">
                <h4 style="margin: 0 0 15px 0; color: #333;">Select Images</h4>
                <div id="imagesContainer" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 15px;">
                    <div style="text-align: center; padding: 20px; color: #666;">
                        Loading thumbnails...
                    </div>
                </div>
            </div>
            
            <!-- Action Buttons -->
            <div style="margin-top: 25px; padding-top: 20px; border-top: 1px solid #eee; display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <label style="margin-right: 15px; cursor: pointer;">
                        <input type="checkbox" id="selectAll" checked onchange="
                            const checkboxes = document.querySelectorAll('#imageSelectionOverlay input[type=checkbox][id^=img_]');
                            checkboxes.forEach(cb => cb.checked = this.checked);
                            updateThumbnailBorders();
                        "> Select All
                    </label>
                </div>
                <div>
                    <button onclick="handleExportImages('${projectName.replace(/'/g, "\\'").replace(/"/g, '&quot;')}')" style="padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; background-color: #4CAF50; color: white; font-weight: bold; margin-right: 10px;">Export Images</button>
                    <button onclick="showPDFExportDialog('${projectName.replace(/'/g, "\\'").replace(/"/g, '&quot;')}')" style="padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; background-color: #2196F3; color: white; font-weight: bold; margin-right: 10px;">Save as PDF</button>
                    <button onclick="this.closest('#imageSelectionOverlay').remove()" style="padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; background-color: #f0f0f0; color: #333;">Cancel</button>
                </div>
            </div>
        `;
        
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
        
    // Generate thumbnails and update the images container
    const imagesContainer = document.getElementById('imagesContainer');
    imagesContainer.innerHTML = '';
        
    for (const label of imageLabels) {
      // Use user-facing image name (custom > tag-based > base label)
      let imageName = (typeof window.getUserFacingImageName === 'function')
        ? window.getUserFacingImageName(label)
        : (window.getTagBasedFilename ? window.getTagBasedFilename(label, label.split('_')[0]) : label);
      imageName = imageName.charAt(0).toUpperCase() + imageName.slice(1);
            
      // Create image item container
      const imageItem = document.createElement('div');
      imageItem.style.cssText = `
                border: 2px solid #4CAF50;
                border-radius: 8px;
                padding: 15px;
                text-align: center;
                cursor: pointer;
                transition: border-color 0.2s;
                background: white;
            `;
      imageItem.dataset.label = label;
            
      // Add click to toggle functionality
      imageItem.onclick = () => {
        const checkbox = imageItem.querySelector('input[type="checkbox"]');
        checkbox.checked = !checkbox.checked;
        updateThumbnailBorders();
      };
            
      imageItem.innerHTML = `
                <div style="margin-bottom: 10px;">
                    <div style="width: 120px; height: 120px; margin: 0 auto; background: #f0f0f0; border-radius: 4px; display: flex; align-items: center; justify-content: center; overflow: hidden;">
                        <div style="color: #999; font-size: 12px;">Loading...</div>
                    </div>
                </div>
                <div style="margin-bottom: 8px;">
                    <input type="checkbox" id="img_${label}" value="${label}" checked style="margin-right: 8px; transform: scale(1.2);">
                    <label for="img_${label}" style="font-weight: bold; color: #333; cursor: pointer;">${imageName}</label>
                </div>
                <div style="font-size: 12px; color: #666;">${label}</div>
            `;
            
      imagesContainer.appendChild(imageItem);
            
      // Generate thumbnail
      generateImageThumbnail(label, 200).then(thumbnailDataUrl => {
        const thumbnailContainer = imageItem.querySelector('div > div');
        if (thumbnailDataUrl) {
          thumbnailContainer.innerHTML = `
                        <img src="${thumbnailDataUrl}" style="width: 100%; height: 100%; object-fit: contain; border-radius: 4px;">
                    `;
        } else {
          thumbnailContainer.innerHTML = `
                        <div style="color: #999; font-size: 12px;">No preview</div>
                    `;
        }
      });
            
      // Update border color when checkbox changes
      const checkbox = imageItem.querySelector('input[type="checkbox"]');
      checkbox.onchange = () => {
        updateThumbnailBorders();
      };
    }
        
    // Function to update thumbnail borders based on selection
    window.updateThumbnailBorders = function() {
      const imageItems = document.querySelectorAll('#imagesContainer > div');
      imageItems.forEach(item => {
        const checkbox = item.querySelector('input[type="checkbox"]');
        item.style.borderColor = checkbox.checked ? '#4CAF50' : '#ddd';
      });
    };
  }
    
  // Function to select/deselect all images
  window.selectAllImages = function(selectAll) {
    const checkboxes = document.querySelectorAll('#imageCheckboxes input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
      checkbox.checked = selectAll;
    });
    updateSelectedCount();
  };
  // Function to update selected count
  function updateSelectedCount() {
    const checkboxes = document.querySelectorAll('#imageCheckboxes input[type="checkbox"]');
    const checkedCount = Array.from(checkboxes).filter(cb => cb.checked).length;
    const countElement = document.getElementById('selectedCount');
    if (countElement) {
      countElement.textContent = `${checkedCount} selected`;
    }
        
    // Add change listeners to update count
    checkboxes.forEach(checkbox => {
      checkbox.removeEventListener('change', updateSelectedCount); // Remove existing listener
      checkbox.addEventListener('change', updateSelectedCount);
    });
  }
    
  // Function to save selected images
  window.saveSelectedImages = function(projectName) {
    const checkboxes = document.querySelectorAll('#imageSelectionOverlay input[type="checkbox"][id^="img_"]:checked');
    const selectedLabels = Array.from(checkboxes).map(cb => cb.value);
        
    if (selectedLabels.length === 0) {
      alert('Please select at least one image to save.');
      return;
    }
        
    // Get export mode
    const exportModeRadio = document.querySelector('#imageSelectionOverlay input[name="exportMode"]:checked');
    console.log('[Debug] Export mode radio element:', exportModeRadio);
    console.log('[Debug] Export mode radio value:', exportModeRadio ? exportModeRadio.value : 'none found');
        
    // Check all radio buttons for debugging
    const allRadios = document.querySelectorAll('#imageSelectionOverlay input[name="exportMode"]');
    console.log('[Debug] All export mode radios:', allRadios);
    allRadios.forEach((radio, index) => {
      console.log(`[Debug] Radio ${index}: value="${radio.value}", checked=${radio.checked}`);
    });
        
    const exportMode = exportModeRadio ? exportModeRadio.value : 'screenView';
        
    // Close selection dialog
    const overlay = document.getElementById('imageSelectionOverlay');
    if (overlay) {
      overlay.remove();
    }
        
    // Start the save process with selected images
    processSaveImages(selectedLabels, projectName, exportMode);
  };
    
  // New function to handle different export methods
  window.handleExportImages = function(projectName) {
    const checkboxes = document.querySelectorAll('#imageSelectionOverlay input[type="checkbox"][id^="img_"]:checked');
    const selectedLabels = Array.from(checkboxes).map(cb => cb.value);
        
    if (selectedLabels.length === 0) {
      alert('Please select at least one image to export.');
      return;
    }
        
    // Get export mode (Screen View or Production Output)
    const exportModeRadio = document.querySelector('#imageSelectionOverlay input[name="exportMode"]:checked');
    const exportMode = exportModeRadio ? exportModeRadio.value : 'screenView';
        
    // Get export method (Individual, Folder, or ZIP)
    const exportMethodRadio = document.querySelector('#imageSelectionOverlay input[name="exportMethod"]:checked');
    const exportMethod = exportMethodRadio ? exportMethodRadio.value : 'individual';
        
    console.log(`[Export] Selected ${selectedLabels.length} images, mode: ${exportMode}, method: ${exportMethod}`);
        
    // Close selection dialog
    const overlay = document.getElementById('imageSelectionOverlay');
    if (overlay) {
      overlay.remove();
    }
        
    // Route to appropriate export method
    switch (exportMethod) {
      case 'individual':
        processSaveImages(selectedLabels, projectName, exportMode);
        break;
      case 'folder':
        processSaveToFolder(selectedLabels, projectName, exportMode);
        break;
      case 'zip':
        processSaveToZip(selectedLabels, projectName, exportMode);
        break;
      default:
        console.error('Unknown export method:', exportMethod);
        processSaveImages(selectedLabels, projectName, exportMode); // Fallback to individual
    }
  };
    
  // Function to detect canvas viewport bounds
  function detectCanvasViewport(imageLabel) {
    const canvas = document.getElementById('canvas');
    const originalImages = window.originalImages || window.paintApp.state.originalImages || {};
    const originalImageDimensions = window.originalImageDimensions || window.paintApp.state.originalImageDimensions || {};
        
    const imageDimensions = originalImageDimensions[imageLabel];
    const scale = window.paintApp.state.imageScaleByLabel[imageLabel] || 1;
    const position = window.paintApp.state.imagePositionByLabel[imageLabel] || { x: 0, y: 0 };
        
    if (!imageDimensions) {
      // Return full canvas if no image dimensions
      return {
        x: 0,
        y: 0,
        width: canvas.width,
        height: canvas.height
      };
    }
        
    // Calculate image bounds on canvas
    const scaledWidth = imageDimensions.width * scale;
    const scaledHeight = imageDimensions.height * scale;
        
    // Calculate image position (centered by default, then adjusted by position offset)
    const centerX = (canvas.width - scaledWidth) / 2;
    const centerY = (canvas.height - scaledHeight) / 2;
    const imageX = centerX + position.x;
    const imageY = centerY + position.y;
        
    // Return the viewport bounds that show the image
    return {
      x: Math.max(0, imageX),
      y: Math.max(0, imageY),
      width: Math.min(canvas.width - Math.max(0, imageX), scaledWidth),
      height: Math.min(canvas.height - Math.max(0, imageY), scaledHeight),
      imageX: imageX,
      imageY: imageY,
      scaledWidth: scaledWidth,
      scaledHeight: scaledHeight,
      scale: scale
    };
  }
    
  // Function to crop canvas to viewport bounds
  function cropToViewport(sourceCanvas, viewportBounds) {
    const croppedCanvas = document.createElement('canvas');
    const croppedCtx = croppedCanvas.getContext('2d');
        
    croppedCanvas.width = viewportBounds.width;
    croppedCanvas.height = viewportBounds.height;
        
    // Copy the viewport area from source canvas
    croppedCtx.drawImage(
      sourceCanvas,
      viewportBounds.x, viewportBounds.y, viewportBounds.width, viewportBounds.height,
      0, 0, viewportBounds.width, viewportBounds.height
    );
        
    return croppedCanvas;
  }
    
  // Placeholder for PDF export dialog
  window.showPDFExportDialog = async function(projectName) {
    // Get all stroke measurements for the PDF from all images
    const allMeasurements = [];
    let measurementIndex = 0;
        
    // Iterate through all images and their strokes
    for (const imageLabel in window.vectorStrokesByImage) {
      const imageStrokes = window.vectorStrokesByImage[imageLabel] || {};
      const strokeOrder = window.lineStrokesByImage[imageLabel] || [];
            
      strokeOrder.forEach(strokeLabel => {
        const vectorData = imageStrokes[strokeLabel];
        if (vectorData && strokeLabel && strokeLabel.trim()) {
          const measurement = {
            id: measurementIndex++,
            imageLabel: imageLabel,
            strokeLabel: strokeLabel,
            label: strokeLabel,
            value: vectorData.measurement || 'N/A',
            unit: vectorData.unit || window.currentUnit || 'inch',
            color: vectorData.color || '#000000',
            editable: true
          };
          allMeasurements.push(measurement);
        }
      });
    }

    // Create PDF export dialog
    const dialogOverlay = document.createElement('div');
    dialogOverlay.id = 'pdfExportOverlay';
    dialogOverlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.5);
            z-index: 10000;
            display: flex;
            justify-content: center;
            align-items: center;
        `;

    dialogOverlay.innerHTML = `
            <div style="background: white; border-radius: 8px; width: 90%; max-width: 800px; max-height: 90vh; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
                <div style="padding: 20px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center;">
                    <h3 style="margin: 0; color: #333;">Export PDF - ${projectName}</h3>
                    <button onclick="this.closest('#pdfExportOverlay').remove()" style="background: none; border: none; font-size: 24px; cursor: pointer; color: #666;">&times;</button>
                </div>
                
                <div style="padding: 20px; overflow-y: auto; max-height: calc(90vh - 160px);">
                    <div style="margin-bottom: 20px;">
                        <label style="display: block; margin-bottom: 10px; font-weight: bold; color: #333;">PDF Layout:</label>
                        <select id="pdfLayoutSelect" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
                            <option value="customer-form" selected>Customer Measurement Form</option>
                        </select>
                    </div>

                    <div style="margin-bottom: 20px; padding: 15px; background: #f9f9f9; border-radius: 4px;">
                        <label style="display: flex; align-items: center; margin-bottom: 10px; cursor: pointer;">
                            <input type="checkbox" id="includeImagesWithoutMeasurements" style="margin-right: 8px;" checked>
                            <span style="font-weight: bold; color: #333;">Include images without measurements</span>
                        </label>
                        <p style="margin: 5px 0 0 24px; font-size: 12px; color: #666;">
                            When checked, images without measurement lines will be included with a "No measurements" note.
                        </p>
                    </div>

                    <div id="measurementsSection" style="margin-bottom: 20px;">
                        <h4 style="margin-bottom: 15px; color: #333;">Measurements (${allMeasurements.length} items):</h4>
                        <div style="max-height: 300px; overflow-y: auto; border: 1px solid #ddd; border-radius: 4px;">
                            <table style="width: 100%; border-collapse: collapse;">
                                <thead style="background-color: #f5f5f5; position: sticky; top: 0;">
                                    <tr>
                                        <th style="padding: 10px; border-bottom: 1px solid #ddd; text-align: left; width: 60px;">Label</th>
                                        <th style="padding: 10px; border-bottom: 1px solid #ddd; text-align: left;">Measurement</th>
                                        <th style="padding: 10px; border-bottom: 1px solid #ddd; text-align: left; width: 80px;">Unit</th>
                                        <th style="padding: 10px; border-bottom: 1px solid #ddd; text-align: center; width: 60px;">Include</th>
                                    </tr>
                                </thead>
                                <tbody id="measurementsTableBody">
                                    ${allMeasurements.map((measurement, index) => `
                                        <tr style="border-bottom: 1px solid #eee;">
                                            <td style="padding: 8px;">
                                                <input type="text" value="${measurement.label}" 
                                                       data-measurement-id="${measurement.id}" 
                                                       data-field="label"
                                                       style="width: 100%; padding: 4px; border: 1px solid #ccc; border-radius: 2px; font-size: 14px;">
                                            </td>
                                            <td style="padding: 8px;">
                                                <input type="text" value="${measurement.value}" 
                                                       data-measurement-id="${measurement.id}" 
                                                       data-field="value"
                                                       style="width: 100%; padding: 4px; border: 1px solid #ccc; border-radius: 2px; font-size: 14px;">
                                            </td>
                                            <td style="padding: 8px;">
                                                <select data-measurement-id="${measurement.id}" 
                                                        data-field="unit"
                                                        style="width: 100%; padding: 4px; border: 1px solid #ccc; border-radius: 2px; font-size: 14px;">
                                                    <option value="inch" ${measurement.unit === 'inch' ? 'selected' : ''}>inch</option>
                                                    <option value="cm" ${measurement.unit === 'cm' ? 'selected' : ''}>cm</option>
                                                    <option value="ft" ${measurement.unit === 'ft' ? 'selected' : ''}>ft</option>
                                                    <option value="mm" ${measurement.unit === 'mm' ? 'selected' : ''}>mm</option>
                                                </select>
                                            </td>
                                            <td style="padding: 8px; text-align: center;">
                                                <input type="checkbox" checked 
                                                       data-measurement-id="${measurement.id}" 
                                                       data-field="include"
                                                       style="transform: scale(1.2);">
                                            </td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                        ${allMeasurements.length === 0 ? '<p style="color: #666; font-style: italic; text-align: center; padding: 20px;">No measurements found. Create some labeled strokes first.</p>' : ''}
                    </div>

                    <div style="margin-bottom: 20px;">
                        <h4 style="margin-bottom: 10px; color: #333;">PDF Options:</h4>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px;">
                            <label style="display: flex; align-items: center; gap: 8px;">
                                <input type="checkbox" id="includeProjectName" checked style="transform: scale(1.2);">
                                Include project name as title
                            </label>
                            <label style="display: flex; align-items: center; gap: 8px;">
                                <input type="checkbox" id="includeTimestamp" checked style="transform: scale(1.2);">
                                Include creation timestamp
                            </label>
                            <label style="display: flex; align-items: center; gap: 8px;">
                                <input type="checkbox" id="includeImageLabels" checked style="transform: scale(1.2);">
                                Show image labels
                            </label>
                        </div>
                    </div>

                    <div style="margin-bottom: 20px; padding: 15px; background: #e3f2fd; border-radius: 4px; border-left: 4px solid #2196F3;">
                        <h4 style="margin-top: 0; margin-bottom: 15px; color: #333;">Unit Selection:</h4>
                        <p style="margin: 0 0 15px 0; font-size: 14px; color: #666;">
                            Choose the unit for all measurements in the PDF. This will also update your project's unit setting.
                        </p>
                        <div style="display: flex; gap: 20px; align-items: center;">
                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                <input type="radio" name="pdfUnit" value="inch" ${window.currentUnit === 'inch' ? 'checked' : ''} style="transform: scale(1.3);">
                                <span style="font-weight: 500;">Inches</span>
                            </label>
                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                <input type="radio" name="pdfUnit" value="cm" ${window.currentUnit === 'cm' ? 'checked' : ''} style="transform: scale(1.3);">
                                <span style="font-weight: 500;">Centimeters</span>
                            </label>
                        </div>
                        <p style="margin: 10px 0 0 0; font-size: 12px; color: #666; font-style: italic;">
                            Current project unit: ${window.currentUnit === 'inch' ? 'Inches' : 'Centimeters'}
                        </p>
                    </div>

                    <div id="previewSection" style="margin-bottom: 20px; padding: 15px; background-color: #f9f9f9; border-radius: 4px;">
                        <h4 style="margin-top: 0; margin-bottom: 10px; color: #333;">Preview:</h4>
                        <div id="previewContent" style="font-size: 14px; color: #666;">
                            <p>Click "Preview PDF" to see how your document will look.</p>
                        </div>
                        <button id="previewPDFBtn" style="padding: 8px 16px; border: 1px solid #2196F3; border-radius: 4px; background: white; color: #2196F3; cursor: pointer; margin-top: 10px;">
                            Preview PDF
                        </button>
                    </div>
                </div>
                
                <div style="padding: 20px; border-top: 1px solid #eee; display: flex; justify-content: flex-end; gap: 10px;">
                    <button onclick="generatePDF('${projectName.replace(/'/g, "\\'").replace(/"/g, '&quot;')}')" style="padding: 12px 24px; border: none; border-radius: 4px; cursor: pointer; background-color: #4CAF50; color: white; font-weight: bold;">
                        Generate PDF
                    </button>
                    <button onclick="this.closest('#pdfExportOverlay').remove()" style="padding: 12px 24px; border: 1px solid #ccc; border-radius: 4px; cursor: pointer; background-color: white; color: #333;">
                        Cancel
                    </button>
                </div>
            </div>
        `;

    document.body.appendChild(dialogOverlay);

    // Add event listeners for real-time preview updates
    const layoutSelect = document.getElementById('pdfLayoutSelect');
    const previewBtn = document.getElementById('previewPDFBtn');
        
    layoutSelect.addEventListener('change', updateMeasurementsVisibility);
    previewBtn.addEventListener('click', showPDFPreview);

    // Update measurements section visibility based on layout
    function updateMeasurementsVisibility() {
      const measurementsSection = document.getElementById('measurementsSection');
      const layoutValue = layoutSelect.value;
      measurementsSection.style.display = layoutValue === 'images-only' ? 'none' : 'block';
    }

    // Initialize visibility
    updateMeasurementsVisibility();
  };

  // PDF Preview Function
  window.showPDFPreview = function() {
    const previewContent = document.getElementById('previewContent');
        
    // Get all images with measurements
    const imageContainers = document.querySelectorAll('.image-container');
    const imagesWithMeasurements = [];
    let totalMeasurements = 0;
        
    for (const container of imageContainers) {
      const imageLabel = container.dataset.label;
      if (!imageLabel) continue;
            
      const strokeMeasurements = window.strokeMeasurements[imageLabel] || {};
      const strokeLabels = Object.keys(strokeMeasurements);
            
      if (strokeLabels.length > 0) {
        imagesWithMeasurements.push({
          label: imageLabel,
          measurementCount: strokeLabels.length
        });
        totalMeasurements += strokeLabels.length;
      }
    }
        
    let previewText = '<div style="font-family: Arial, sans-serif; line-height: 1.5;">';
        
    previewText += '<strong>Document Format:</strong> Customer Measurement Form<br>';
    previewText += `<strong>Pages:</strong> ${imagesWithMeasurements.length} (one per image with measurements)<br>`;
    previewText += `<strong>Total Measurement Fields:</strong> ${totalMeasurements} fillable fields<br><br>`;
        
    if (imagesWithMeasurements.length === 0) {
      previewText += '<em style="color: #f44336;">No images with measurements found. Please add measurements to your images first.</em><br><br>';
    } else {
      previewText += '<strong>Images to be included:</strong><ul>';
      imagesWithMeasurements.forEach(img => {
        previewText += `<li><strong>${img.label}</strong> - ${img.measurementCount} measurement field${img.measurementCount > 1 ? 's' : ''}</li>`;
      });
      previewText += '</ul>';
    }
        
    previewText += '<strong>Each page will contain:</strong><ul>';
    previewText += '<li>Project name and image identifier</li>';
    previewText += '<li>Date generated</li>';
    previewText += '<li>Full-size image centered on page</li>';
    previewText += '<li><strong>Fillable measurement form</strong> with empty boxes for:</li>';
    previewText += '<ul><li>Inches measurement (customer fills in)</li>';
    previewText += '<li>Centimeters measurement (customer fills in)</li></ul>';
    previewText += '<li>Instructions for customers</li>';
    previewText += '</ul>';
        
    previewText += '<br><em>This format allows customers to print the PDF and write their measurements directly into the form fields.</em>';
        
    previewText += '</div>';
        
    previewContent.innerHTML = previewText;
  };

  window.showAssignViewsToGroupsDialog = function() {
    const existingDialog = document.getElementById('assignGroupsOverlay');
    if (existingDialog) {
      existingDialog.remove();
    }

    const dialogOverlay = document.createElement('div');
    dialogOverlay.id = 'assignGroupsOverlay';
    dialogOverlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10000; display: flex; justify-content: center; align-items: center;';
    
    const imageLabels = window.paintApp?.state?.orderedImageLabels || [];
    if (imageLabels.length === 0) {
      alert('No images found. Please upload images first.');
      return;
    }

    const viewMapping = window.paintApp.state.viewPieceMapping || {};
    const pieces = window.paintApp.state.pieces || {};
    const piecesList = Object.keys(pieces);

    const imageRows = imageLabels.map(label => {
      const mapping = viewMapping[label] || { pieceId: '', type: 'frame', cushionIndex: 1 };
      
      return `
        <tr style="border-bottom: 1px solid #eee;">
          <td style="padding: 8px; font-weight: 500;">${label}</td>
          <td style="padding: 8px;">
            <select class="piece-select" data-image="${label}" style="width: 100%; padding: 4px; border: 1px solid #ccc; border-radius: 4px;">
              <option value="">${piecesList.length === 0 ? '-- Create groups first --' : '-- No group --'}</option>
              ${piecesList.map(pieceId => `<option value="${pieceId}" ${mapping.pieceId === pieceId ? 'selected' : ''}>${pieces[pieceId].name}</option>`).join('')}
            </select>
          </td>
          <td style="padding: 8px;">
            <select class="type-select" data-image="${label}" style="width: 100%; padding: 4px; border: 1px solid #ccc; border-radius: 4px;">
              <option value="frame" ${mapping.type === 'frame' ? 'selected' : ''}>Frame</option>
              <option value="cushion" ${mapping.type === 'cushion' ? 'selected' : ''}>Cushion</option>
              <option value="detail" ${mapping.type === 'detail' ? 'selected' : ''}>Detail</option>
            </select>
          </td>
          <td style="padding: 8px;">
            <input type="number" min="1" max="10" class="cushion-index" data-image="${label}" value="${mapping.cushionIndex || 1}" style="width: 60px; padding: 4px; border: 1px solid #ccc; border-radius: 4px;" ${mapping.type !== 'cushion' ? 'disabled' : ''}>
          </td>
        </tr>
      `;
    }).join('');

    dialogOverlay.innerHTML = `
      <div style="background: white; border-radius: 8px; max-width: 800px; width: 90%; max-height: 90vh; overflow-y: auto; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
        <div style="padding: 20px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center;">
          <h3 style="margin: 0; color: #333; font-size: 20px;">Assign Views to Groups</h3>
          <button onclick="this.closest('#assignGroupsOverlay').remove()" style="background: none; border: none; font-size: 24px; cursor: pointer; color: #999;">&times;</button>
        </div>
        
        <div style="padding: 20px;">
          <p style="margin: 0 0 15px 0; color: #666; font-size: 14px;">
            Group related images together (e.g., frame + cushions) to display them on the same PDF page.
          </p>

          ${piecesList.length === 0 ? `
            <div style="padding: 20px; background: #fff3cd; border: 1px solid #ffc107; border-radius: 4px; margin-bottom: 20px;">
              <p style="margin: 0 0 10px 0; font-weight: 500;">No groups defined yet</p>
              <p style="margin: 0 0 10px 0; font-size: 14px;">Create groups like "Left Section", "Right Section", etc. to organize your sofa images.</p>
              <button id="createGroupBtn" style="padding: 8px 16px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 500;">
                Create Groups
              </button>
            </div>
          ` : `
            <div style="margin-bottom: 15px;">
              <button id="editGroupsBtn" style="padding: 6px 12px; background: #2196F3; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">
                Edit Groups
              </button>
            </div>
          `}

          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="background: #f5f5f5; border-bottom: 2px solid #ddd;">
                <th style="padding: 10px; text-align: left; font-weight: 600;">Image</th>
                <th style="padding: 10px; text-align: left; font-weight: 600;">Group</th>
                <th style="padding: 10px; text-align: left; font-weight: 600;">Type</th>
                <th style="padding: 10px; text-align: left; font-weight: 600;">Cushion #</th>
              </tr>
            </thead>
            <tbody>
              ${imageRows}
            </tbody>
          </table>
        </div>

        <div style="padding: 20px; border-top: 1px solid #eee; display: flex; justify-content: flex-end; gap: 10px;">
          <button id="saveAssignmentsBtn" style="padding: 12px 24px; border: none; border-radius: 4px; cursor: pointer; background-color: #4CAF50; color: white; font-weight: bold;">
            Save Assignments
          </button>
          <button onclick="this.closest('#assignGroupsOverlay').remove()" style="padding: 12px 24px; border: 1px solid #ccc; border-radius: 4px; cursor: pointer; background-color: white; color: #333;">
            Cancel
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(dialogOverlay);

    const typeSelects = dialogOverlay.querySelectorAll('.type-select');
    typeSelects.forEach(select => {
      select.addEventListener('change', (e) => {
        const imageLabel = e.target.dataset.image;
        const cushionInput = dialogOverlay.querySelector(`.cushion-index[data-image="${imageLabel}"]`);
        cushionInput.disabled = e.target.value !== 'cushion';
      });
    });

    const createGroupBtn = dialogOverlay.querySelector('#createGroupBtn');
    if (createGroupBtn) {
      createGroupBtn.addEventListener('click', () => {
        showCreateGroupsDialog();
      });
    }

    const editGroupsBtn = dialogOverlay.querySelector('#editGroupsBtn');
    if (editGroupsBtn) {
      editGroupsBtn.addEventListener('click', () => {
        showCreateGroupsDialog();
      });
    }

    const saveBtn = dialogOverlay.querySelector('#saveAssignmentsBtn');
    saveBtn.addEventListener('click', () => {
      const pieceSelects = dialogOverlay.querySelectorAll('.piece-select');
      const newMapping = {};
      
      pieceSelects.forEach(select => {
        const imageLabel = select.dataset.image;
        const pieceId = select.value;
        const type = dialogOverlay.querySelector(`.type-select[data-image="${imageLabel}"]`).value;
        const cushionIndex = parseInt(dialogOverlay.querySelector(`.cushion-index[data-image="${imageLabel}"]`).value) || 1;
        
        if (pieceId) {
          newMapping[imageLabel] = { pieceId, type, cushionIndex };
        }
      });

      window.paintApp.state.viewPieceMapping = newMapping;
      console.log('[Group Assignment] Saved view mapping:', newMapping);
      
      dialogOverlay.remove();
      alert('View assignments saved successfully!');
    });
  };

  function showCreateGroupsDialog() {
    const existingDialog = document.getElementById('createGroupsOverlay');
    if (existingDialog) {
      existingDialog.remove();
    }

    const dialogOverlay = document.createElement('div');
    dialogOverlay.id = 'createGroupsOverlay';
    dialogOverlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 10001; display: flex; justify-content: center; align-items: center;';

    const pieces = window.paintApp.state.pieces || {};
    const piecesList = Object.entries(pieces);

    const pieceRows = piecesList.map(([id, piece]) => `
      <div style="display: flex; gap: 10px; margin-bottom: 10px; align-items: center;">
        <input type="text" value="${piece.name}" data-piece-id="${id}" class="piece-name-input" style="flex: 1; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
        <button class="delete-piece-btn" data-piece-id="${id}" style="padding: 6px 12px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer;">Delete</button>
      </div>
    `).join('');

    dialogOverlay.innerHTML = `
      <div style="background: white; border-radius: 8px; max-width: 500px; width: 90%; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
        <div style="padding: 20px; border-bottom: 1px solid #eee;">
          <h3 style="margin: 0; color: #333; font-size: 18px;">Manage Groups</h3>
          <p style="margin: 10px 0 0 0; color: #666; font-size: 14px;">Create groups like "Left Section", "Right Section", "Chaise", etc.</p>
        </div>
        
        <div style="padding: 20px;">
          <div id="piecesList">
            ${pieceRows}
          </div>
          
          <button id="addPieceBtn" style="width: 100%; padding: 10px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 500; margin-top: 10px;">
            + Add New Group
          </button>
        </div>

        <div style="padding: 20px; border-top: 1px solid #eee; display: flex; justify-content: flex-end; gap: 10px;">
          <button id="saveGroupsBtn" style="padding: 12px 24px; border: none; border-radius: 4px; cursor: pointer; background-color: #4CAF50; color: white; font-weight: bold;">
            Save Groups
          </button>
          <button onclick="this.closest('#createGroupsOverlay').remove()" style="padding: 12px 24px; border: 1px solid #ccc; border-radius: 4px; cursor: pointer; background-color: white; color: #333;">
            Cancel
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(dialogOverlay);

    const piecesList = dialogOverlay.querySelector('#piecesList');
    const addPieceBtn = dialogOverlay.querySelector('#addPieceBtn');

    addPieceBtn.addEventListener('click', () => {
      const newId = 'piece_' + Date.now();
      const newRow = document.createElement('div');
      newRow.style.cssText = 'display: flex; gap: 10px; margin-bottom: 10px; align-items: center;';
      newRow.innerHTML = `
        <input type="text" value="New Group" data-piece-id="${newId}" class="piece-name-input" style="flex: 1; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
        <button class="delete-piece-btn" data-piece-id="${newId}" style="padding: 6px 12px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer;">Delete</button>
      `;
      piecesList.appendChild(newRow);
      
      newRow.querySelector('.delete-piece-btn').addEventListener('click', () => {
        newRow.remove();
      });
      
      newRow.querySelector('input').focus();
      newRow.querySelector('input').select();
    });

    dialogOverlay.querySelectorAll('.delete-piece-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.closest('div').remove();
      });
    });

    const saveGroupsBtn = dialogOverlay.querySelector('#saveGroupsBtn');
    saveGroupsBtn.addEventListener('click', () => {
      const inputs = dialogOverlay.querySelectorAll('.piece-name-input');
      const newPieces = {};
      
      inputs.forEach(input => {
        const id = input.dataset.pieceId;
        const name = input.value.trim();
        if (name) {
          newPieces[id] = { name };
        }
      });

      window.paintApp.state.pieces = newPieces;
      console.log('[Group Management] Saved groups:', newPieces);
      
      dialogOverlay.remove();
      
      const assignDialog = document.getElementById('assignGroupsOverlay');
      if (assignDialog) {
        assignDialog.remove();
        window.showAssignViewsToGroupsDialog();
      } else {
        alert('Groups saved successfully!');
      }
    });
  }

  async function captureImageForPDF(imageLabel, canvas) {
    try {
      if (window.paintApp.state.currentImageLabel !== imageLabel) {
        window.switchToImage(imageLabel);
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      let sourceCanvas = canvas;
      const captureEl = document.getElementById('captureFrame');
      if (captureEl) {
        const canvasRect = canvas.getBoundingClientRect();
        const frameRect = captureEl.getBoundingClientRect();
        const left = Math.max(frameRect.left, canvasRect.left);
        const top = Math.max(frameRect.top, canvasRect.top);
        const right = Math.min(frameRect.right, canvasRect.right);
        const bottom = Math.min(frameRect.bottom, canvasRect.bottom);
        const cssWidth = Math.max(0, right - left);
        const cssHeight = Math.max(0, bottom - top);
        if (cssWidth > 0 && cssHeight > 0) {
          const scalePx = canvas.width / canvasRect.width;
          const viewportBounds = {
            x: Math.round((left - canvasRect.left) * scalePx),
            y: Math.round((top - canvasRect.top) * scalePx),
            width: Math.round(cssWidth * scalePx),
            height: Math.round(cssHeight * scalePx)
          };
          sourceCanvas = cropToViewport(canvas, viewportBounds);
        }
      }

      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d');
      const scale = 2;
      tempCanvas.width = sourceCanvas.width * scale;
      tempCanvas.height = sourceCanvas.height * scale;
      tempCtx.scale(scale, scale);
      tempCtx.drawImage(sourceCanvas, 0, 0);
      
      return {
        dataUrl: tempCanvas.toDataURL('image/jpeg', 0.8),
        aspectRatio: sourceCanvas.width / sourceCanvas.height
      };
    } catch (error) {
      console.warn(`Could not capture image ${imageLabel}:`, error);
      return null;
    }
  }

  // Enhanced Customer Measurement Form PDF Generation Function
  window.generatePDF = async function(projectName) {
    try {
      // Get selected unit from PDF dialog
      const selectedUnitElement = document.querySelector('input[name="pdfUnit"]:checked');
      const selectedUnit = selectedUnitElement ? selectedUnitElement.value : window.currentUnit || 'inch';
            
      // Update project unit system to match PDF selection
      if (selectedUnit !== window.currentUnit) {
        document.getElementById('unitSelector').value = selectedUnit;
        window.currentUnit = selectedUnit;
        updateMeasurementDisplay(); // Update the project display
        console.log(`[PDF] Updated project unit to: ${selectedUnit}`);
      }
            
      // Check for jsPDF availability (version 2.5.1 UMD exposes as window.jspdf.jsPDF)
      const jsPDFConstructor = window.jspdf?.jsPDF || window.jsPDF;
      if (typeof jsPDFConstructor === 'undefined') {
        console.error('[PDF] jsPDF not found. Available:', {
          'window.jspdf': window.jspdf,
          'window.jsPDF': window.jsPDF,
          'window.jspdf?.jsPDF': window.jspdf?.jsPDF
        });
        alert('PDF library not loaded. Please refresh the page and try again.');
        return;
      }

      const jsPDF = jsPDFConstructor;
      const pdf = new jsPDF('p', 'mm', 'a4');
            
      // Debug AcroForm availability
      console.log('[PDF Debug] jsPDFConstructor:', jsPDFConstructor);
      console.log('[PDF Debug] jsPDF.AcroForm:', jsPDF.AcroForm);
      console.log('[PDF Debug] Available AcroForm classes:', jsPDF.AcroForm ? Object.keys(jsPDF.AcroForm) : 'Not available');
      console.log('[PDF Debug] Selected unit for PDF:', selectedUnit);
            
      // Get user preference for including images without measurements
      const includeImagesWithoutMeasurements = document.getElementById('includeImagesWithoutMeasurements')?.checked || false;
            
      // Get all images with their corresponding measurements
      const images = [];
      const imageContainers = document.querySelectorAll('.image-container');
            
      for (const container of imageContainers) {
        const imageLabel = container.dataset.label;
        if (!imageLabel) continue;
                
        const imageElement = container.querySelector('img');
        if (!imageElement) continue;
                
        // Get measurements for this image
        const strokeMeasurements = window.strokeMeasurements[imageLabel] || {};
        const strokeLabels = Object.keys(strokeMeasurements);
                
        // Debug logging
        console.log(`[PDF Debug] Image: ${imageLabel}, strokeMeasurements:`, strokeMeasurements);
        console.log('[PDF Debug] strokeLabels:', strokeLabels);
                
        // Include image if it has measurements OR if user wants images without measurements  
        if (strokeLabels.length > 0 || includeImagesWithoutMeasurements) {
          const measurementFields = strokeLabels.map(strokeLabel => {
            const measurementData = strokeMeasurements[strokeLabel];
            console.log(`[PDF Debug] Processing ${strokeLabel}:`, measurementData);
            return {
              label: strokeLabel,
              measurement: measurementData
            };
          });
                    
          images.push({
            label: imageLabel,
            measurements: measurementFields,
            hasMeasurements: strokeLabels.length > 0
          });
        }
      }
            
      if (images.length === 0) {
        if (includeImagesWithoutMeasurements) {
          alert('No images found to include in PDF.');
        } else {
          alert('No images with measurements found. Check "Include images without measurements" or add some measurements first.');
        }
        return;
      }

      const viewMapping = window.paintApp.state.viewPieceMapping || {};
      const pieces = window.paintApp.state.pieces || {};
      const hasGrouping = Object.keys(viewMapping).length > 0 && Object.keys(pieces).length > 0;

      let groups = [];
      if (hasGrouping) {
        const groupedImages = {};
        const ungroupedImages = [];

        images.forEach(imageData => {
          const mapping = viewMapping[imageData.label];
          if (mapping && mapping.pieceId && pieces[mapping.pieceId]) {
            if (!groupedImages[mapping.pieceId]) {
              groupedImages[mapping.pieceId] = {
                pieceId: mapping.pieceId,
                pieceName: pieces[mapping.pieceId].name,
                frame: null,
                cushions: [],
                details: []
              };
            }
            
            if (mapping.type === 'frame') {
              groupedImages[mapping.pieceId].frame = imageData;
            } else if (mapping.type === 'cushion') {
              groupedImages[mapping.pieceId].cushions.push({
                ...imageData,
                cushionIndex: mapping.cushionIndex || 1
              });
            } else if (mapping.type === 'detail') {
              groupedImages[mapping.pieceId].details.push(imageData);
            }
          } else {
            ungroupedImages.push(imageData);
          }
        });

        Object.values(groupedImages).forEach(group => {
          group.cushions.sort((a, b) => a.cushionIndex - b.cushionIndex);
        });

        groups = [...Object.values(groupedImages), ...ungroupedImages.map(img => ({ ungrouped: true, image: img }))];
        console.log('[PDF] Using grouped layout:', groups);
      } else {
        groups = images.map(img => ({ ungrouped: true, image: img }));
        console.log('[PDF] Using ungrouped layout');
      }
            
      // Store original state to restore later
      const canvas = document.getElementById('canvas');
      const originalImageLabel = window.paintApp.state.currentImageLabel;
            
      let isFirstPage = true;
      let globalRadioAdded = false;
            
      // Create pages based on groups
      for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
                
        if (!isFirstPage) {
          pdf.addPage();
        }
                
        let yPosition = 20;
                
        // Add global unit selection radio buttons only on first page
        if (isFirstPage && !globalRadioAdded) {
          // Global header
          pdf.setFontSize(18);
          pdf.setFont(undefined, 'bold');
          pdf.text(`${projectName} - Measurement Form`, 20, yPosition);
          yPosition += 8;
                    
          pdf.setFontSize(10);
          pdf.setFont(undefined, 'normal');
          pdf.text(`Date: ${new Date().toLocaleDateString()}`, 20, yPosition);
          yPosition += 10;
                    
          // Compact global unit selection
          const RadioButton = jsPDF.AcroForm.RadioButton;
                    
          // Create radio button group
          const radioGroup = new RadioButton();
          radioGroup.fieldName = 'units_global';
          pdf.addField(radioGroup);
                    
          // Compact unit selection layout - text first, then buttons inline
          pdf.setFontSize(11);
          pdf.setFont(undefined, 'bold');
          pdf.text('UNIT SELECTION (applies to entire form):', 20, yPosition);
                    
          const radioY = yPosition;
                    
          // Position radio buttons inline after the text
          const inchesOption = radioGroup.createOption('Inches');
          inchesOption.x = 135;
          inchesOption.y = radioY - 2;
          inchesOption.width = 3;
          inchesOption.height = 3;
                    
          const cmOption = radioGroup.createOption('CM');
          cmOption.x = 170;
          cmOption.y = radioY - 2;
          cmOption.width = 3;
          cmOption.height = 3;
                    
          // Set appearance for radio buttons (mandatory for proper display)
          radioGroup.setAppearance(jsPDF.AcroForm.Appearance.RadioButton.Circle);
                    
          // Pre-select based on chosen unit
          if (selectedUnit === 'inch') {
            inchesOption.appearanceState = 'On';
            cmOption.appearanceState = 'Off';
            radioGroup.value = 'Inches';
          } else {
            inchesOption.appearanceState = 'Off';
            cmOption.appearanceState = 'On';
            radioGroup.value = 'CM';
          }
                    
          // Radio button labels positioned next to buttons
          pdf.setFontSize(10);
          pdf.setFont(undefined, 'normal');
          pdf.text('Inches', 140, yPosition);
          pdf.text('Centimeters', 175, yPosition);
          yPosition += 5;
                    
          // Instruction text on next line
          pdf.setFontSize(9);
          pdf.setFont(undefined, 'italic');
          pdf.setTextColor(100, 100, 100);
          pdf.text('Select your preferred unit. All measurements will display in the selected unit.', 20, yPosition);
          pdf.setTextColor(0, 0, 0);
          pdf.setFont(undefined, 'normal');
          yPosition += 10;
                    
          globalRadioAdded = true;
        }
                
        isFirstPage = false;

        if (group.ungrouped) {
          const imageData = group.image;
          pdf.setFontSize(14);
          pdf.setFont(undefined, 'bold');
          const titleName = (typeof window.getUserFacingImageName === 'function') ? window.getUserFacingImageName(imageData.label) : imageData.label;
          pdf.text(`${titleName}`, 20, yPosition);
          yPosition += 8;

          const captured = await captureImageForPDF(imageData.label, canvas);
          if (captured) {
            const maxWidth = 170;
            const maxHeight = 120;
            let imgWidth = maxWidth;
            let imgHeight = maxWidth / captured.aspectRatio;
            if (imgHeight > maxHeight) {
              imgHeight = maxHeight;
              imgWidth = maxHeight * captured.aspectRatio;
            }
            const imgX = (210 - imgWidth) / 2;
            pdf.addImage(captured.dataUrl, 'JPEG', imgX, yPosition, imgWidth, imgHeight);
            yPosition += imgHeight + 15;
          } else {
            pdf.setFontSize(12);
            pdf.setFont(undefined, 'italic');
            pdf.text('[Image could not be captured]', 20, yPosition);
            yPosition += 20;
          }
        } else {
          pdf.setFontSize(14);
          pdf.setFont(undefined, 'bold');
          pdf.text(group.pieceName, 20, yPosition);
          yPosition += 8;

          const leftColumnWidth = 125;
          const rightColumnX = 135;
          let leftY = yPosition;
          let rightY = yPosition;

          if (group.frame) {
            const captured = await captureImageForPDF(group.frame.label, canvas);
            if (captured) {
              const maxWidth = leftColumnWidth - 10;
              const maxHeight = 80;
              let imgWidth = maxWidth;
              let imgHeight = maxWidth / captured.aspectRatio;
              if (imgHeight > maxHeight) {
                imgHeight = maxHeight;
                imgWidth = maxHeight * captured.aspectRatio;
              }
              pdf.addImage(captured.dataUrl, 'JPEG', 20, leftY, imgWidth, imgHeight);
              leftY += imgHeight + 5;
            }
          }

          if (group.cushions.length > 0) {
            pdf.setFontSize(10);
            pdf.setFont(undefined, 'bold');
            pdf.text('Cushions:', 20, leftY);
            leftY += 6;

            const cushionsPerRow = 3;
            const cushionSize = 30;
            const cushionGap = 5;

            for (let ci = 0; ci < group.cushions.length; ci++) {
              const cushion = group.cushions[ci];
              const captured = await captureImageForPDF(cushion.label, canvas);
              if (captured) {
                const col = ci % cushionsPerRow;
                const row = Math.floor(ci / cushionsPerRow);
                const cushionX = 20 + col * (cushionSize + cushionGap);
                const cushionY = leftY + row * (cushionSize + cushionGap + 8);
                pdf.addImage(captured.dataUrl, 'JPEG', cushionX, cushionY, cushionSize, cushionSize);
                pdf.setFontSize(8);
                pdf.setFont(undefined, 'normal');
                pdf.text(`#${cushion.cushionIndex}`, cushionX + cushionSize/2, cushionY + cushionSize + 4, { align: 'center' });
              }
            }
            leftY += Math.ceil(group.cushions.length / cushionsPerRow) * (cushionSize + cushionGap + 8) + 5;
          }

          if (group.frame && group.frame.measurements && group.frame.measurements.length > 0) {
            pdf.setFontSize(10);
            pdf.setFont(undefined, 'bold');
            pdf.text('Frame Measurements', rightColumnX, rightY);
            rightY += 6;

            const TextField = jsPDF.AcroForm.TextField;
            group.frame.measurements.forEach(measurement => {
              pdf.setFontSize(9);
              pdf.setFont(undefined, 'normal');
              pdf.text(`${measurement.label}:`, rightColumnX, rightY);
              
              const textField = new TextField();
              textField.fieldName = `measurement_${group.frame.label}_${measurement.label}`;
              textField.Rect = [rightColumnX + 35, rightY - 3, 25, 5];
              textField.fontSize = 8;
              
              let measurementValue = '';
              if (measurement.measurement) {
                const data = measurement.measurement;
                if (data.inchWhole !== undefined) {
                  if (selectedUnit === 'inch') {
                    const inches = data.inchWhole + (data.inchFraction || 0);
                    measurementValue = `${inches}`;
                  } else {
                    const cm = data.cm || 0;
                    measurementValue = `${cm.toFixed(1)}`;
                  }
                }
              }
              textField.value = measurementValue;
              pdf.addField(textField);
              rightY += 6;
            });
            rightY += 4;
          }

          const allCushionMeasurements = group.cushions.flatMap(c => c.measurements || []);
          if (allCushionMeasurements.length > 0) {
            pdf.setFontSize(10);
            pdf.setFont(undefined, 'bold');
            pdf.text('Cushion Measurements', rightColumnX, rightY);
            rightY += 6;

            const TextField = jsPDF.AcroForm.TextField;
            group.cushions.forEach(cushion => {
              if (cushion.measurements && cushion.measurements.length > 0) {
                cushion.measurements.forEach(measurement => {
                  pdf.setFontSize(9);
                  pdf.setFont(undefined, 'normal');
                  pdf.text(`${measurement.label}:`, rightColumnX, rightY);
                  
                  const textField = new TextField();
                  textField.fieldName = `measurement_${cushion.label}_${measurement.label}`;
                  textField.Rect = [rightColumnX + 35, rightY - 3, 25, 5];
                  textField.fontSize = 8;
                  
                  let measurementValue = '';
                  if (measurement.measurement) {
                    const data = measurement.measurement;
                    if (data.inchWhole !== undefined) {
                      if (selectedUnit === 'inch') {
                        const inches = data.inchWhole + (data.inchFraction || 0);
                        measurementValue = `${inches}`;
                      } else {
                        const cm = data.cm || 0;
                        measurementValue = `${cm.toFixed(1)}`;
                      }
                    }
                  }
                  textField.value = measurementValue;
                  pdf.addField(textField);
                  rightY += 6;
                });
              }
            });
          }

          yPosition = Math.max(leftY, rightY) + 10;
        }

        const imageData = group.ungrouped ? group.image : (group.frame || group.cushions[0] || { label: 'unknown', measurements: [] });
                
        // Measurements form section (only for ungrouped views)
        if (group.ungrouped && imageData.hasMeasurements && imageData.measurements.length > 0) {
          pdf.setFontSize(14);
          pdf.setFont(undefined, 'bold');
          pdf.text('MEASUREMENTS', 20, yPosition);
          yPosition += 8;
                    
          pdf.setFontSize(9);
          pdf.setFont(undefined, 'normal');
          pdf.text('Fill in measurements for each labeled dimension:', 20, yPosition);
          yPosition += 12;
                    
          // Create measurements in columns - 4x4 (16) max per page
          const measurements = imageData.measurements;
          let numColumns, itemsPerColumn;
                    
          // Determine column layout - prioritize fitting 16 items (4x4) per page
          if (measurements.length <= 8) {
            numColumns = 2;
            itemsPerColumn = Math.ceil(measurements.length / 2);
          } else if (measurements.length <= 12) {
            numColumns = 3;
            itemsPerColumn = Math.ceil(measurements.length / 3);
          } else {
            numColumns = 4;
            itemsPerColumn = 4; // Force 4 rows max for first page
          }
                    
          // Column positions - tighter spacing for 4 columns
          const columnWidths = [20, 65, 110, 155]; // Base X positions for up to 4 columns
          const columnXPositions = columnWidths.slice(0, numColumns);
          const itemsPerPage = Math.max(1, numColumns * itemsPerColumn);
          let maxFieldBottom = yPosition;
          let currentPageIndex = 0;
                    
          for (let j = 0; j < measurements.length; j++) {
            const measurement = measurements[j];
            const pageIndex = Math.floor(j / itemsPerPage);

            if (pageIndex > currentPageIndex) {
              pdf.addPage();
              yPosition = 20;
              pdf.setFontSize(14);
              pdf.setFont(undefined, 'bold');
              pdf.text('MEASUREMENTS (continued)', 20, yPosition);
              yPosition += 15;
              pdf.setFontSize(9);
              pdf.setFont(undefined, 'normal');
              pdf.text('Fill in measurements for each labeled dimension:', 20, yPosition);
              yPosition += 12;
              currentPageIndex = pageIndex;
              maxFieldBottom = Math.max(maxFieldBottom, yPosition);
            }

            const indexInPage = j % itemsPerPage;
            const columnIndex = Math.floor(indexInPage / itemsPerColumn);
            const rowIndex = indexInPage % itemsPerColumn;

            const baseX = columnXPositions[columnIndex] ?? columnXPositions[columnXPositions.length - 1] ?? 20;
            const currentY = yPosition + (rowIndex * 15);
                        
            // Check if we need a new page (fallback for unexpected overflow)
            let finalCurrentY = currentY;
            if (currentY > 270) {
              pdf.addPage();
              yPosition = 20;
              pdf.setFontSize(14);
              pdf.setFont(undefined, 'bold');
              pdf.text('MEASUREMENTS (continued)', 20, yPosition);
              yPosition += 15;
              pdf.setFontSize(9);
              pdf.setFont(undefined, 'normal');
              pdf.text('Fill in measurements for each labeled dimension:', 20, yPosition);
              yPosition += 12;
              finalCurrentY = yPosition;
              maxFieldBottom = Math.max(maxFieldBottom, yPosition);
            }
                        
            // Measurement label with overflow handling
            pdf.setFontSize(10);
            pdf.setFont(undefined, 'bold');
                        
            // Check if label is too long to fit before input field (estimate 5 chars per mm)
            const labelText = `${measurement.label}:`;
            const availableWidth = 40; // Space available for label in mm
            const estimatedLabelWidth = labelText.length * 1.8; // Rough estimate
                        
            let fieldY, inputX;
            if (estimatedLabelWidth > availableWidth) {
              // Long label: put on separate line, input field below
              pdf.text(labelText, baseX, finalCurrentY);
              fieldY = finalCurrentY + 5; // Input field below label
              inputX = baseX; // Align input with label start
            } else {
              // Short label: put input field inline
              pdf.text(labelText, baseX, finalCurrentY);
              fieldY = finalCurrentY - 3;
              inputX = baseX + estimatedLabelWidth + 2; // Input field after label
            }
                        
            const fieldWidth = 25;
            const fieldHeight = 6;
                        
            // Create measurement field with single unit value
            const TextField = jsPDF.AcroForm.TextField;
            const textField = new TextField();
            textField.fieldName = `measurement_${imageData.label}_${measurement.label}`;
            textField.Rect = [inputX, fieldY, fieldWidth, fieldHeight];
            textField.fontSize = 9;
                        
            let measurementValue = '';
            if (measurement.measurement) {
              const data = measurement.measurement;
              if (data.inchWhole !== undefined) {
                if (selectedUnit === 'inch') {
                  // Show only inch value
                  const inches = data.inchWhole + (data.inchFraction || 0);
                  measurementValue = `${inches}`;
                } else {
                  // Show only cm value
                  const cm = data.cm || 0;
                  measurementValue = `${cm.toFixed(1)}`;
                }
                                
                console.log(`[PDF Debug] Measurement ${measurement.label}: selected unit="${selectedUnit}", value="${measurementValue}"`);
              }
            }
                        
            textField.value = measurementValue;
            pdf.addField(textField);

            const fieldBottom = (Number.isFinite(fieldY) ? fieldY + fieldHeight : finalCurrentY + fieldHeight);
            maxFieldBottom = Math.max(maxFieldBottom, fieldBottom);
          }
                    
          // Update yPosition to after all measurements (account for layout and potential extra pages)
          yPosition = maxFieldBottom + 10;
                    
        } else if (group.ungrouped) {
          // No measurements for this ungrouped image
          pdf.setFontSize(14);
          pdf.setFont(undefined, 'bold');
          pdf.text('NO MEASUREMENTS', 20, yPosition);
          yPosition += 8;
                    
          pdf.setFontSize(10);
          pdf.setFont(undefined, 'normal');
          pdf.text('This image does not have measurement lines defined.', 20, yPosition);
          yPosition += 6;
          pdf.text('Use this page for reference or add measurements as needed.', 20, yPosition);
          yPosition += 15;
        }
                
        // Instructions at bottom of page
        if (yPosition < 250) {
          yPosition = Math.max(yPosition + 10, 260);
          pdf.setFontSize(8);
          pdf.setFont(undefined, 'italic');
          const unitName = selectedUnit === 'inch' ? 'inches' : 'centimeters';
          pdf.text(`Instructions: All measurements are displayed in ${unitName} as selected. The radio button above shows your choice.`, 20, yPosition);
          pdf.text('Each label corresponds to a measurement line shown in the image above. Values can be edited as needed.', 20, yPosition + 4);
        }
      }
            
      // Restore original image
      if (originalImageLabel && originalImageLabel !== window.paintApp.state.currentImageLabel) {
        window.switchToImage(originalImageLabel);
      }
            
      // Save the PDF
      const fileName = `${projectName.replace(/[^a-z0-9]/gi, '_')}_measurement_form_${new Date().toISOString().split('T')[0]}.pdf`;
      pdf.save(fileName);
            
      // Close the dialog
      const overlay = document.getElementById('pdfExportOverlay');
      if (overlay) {
        overlay.remove();
      }
            
      if (typeof window.projectManager?.showStatusMessage === 'function') {
        window.projectManager.showStatusMessage(`Measurement form PDF "${fileName}" generated successfully!`, 'success');
      } else {
        alert(`Measurement form PDF "${fileName}" generated successfully!`);
      }
            
    } catch (error) {
      console.error('Error generating PDF:', error);
      alert('Error generating PDF. Please check the console for details.');
    }
  };

  // Simplified stroke drawing for screen view export
  function drawStrokeSimplified(ctx, vectorData, imageX, imageY, scale) {
    if (!vectorData.points || vectorData.points.length === 0) return;
        
    // Set stroke properties
    ctx.strokeStyle = vectorData.color || '#ea4335';
    ctx.lineWidth = Math.max(1, (vectorData.width || 5));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
        
    // Set dash pattern if enabled
    if (vectorData.dashSettings && vectorData.dashSettings.enabled && vectorData.dashSettings.pattern.length > 0) {
      ctx.setLineDash(vectorData.dashSettings.pattern);
    } else {
      ctx.setLineDash([]);
    }
        
    // Draw the stroke
    ctx.beginPath();
        
    // Simple coordinate transformation: scale point and add image offset
    const firstPoint = vectorData.points[0];
    ctx.moveTo(
      imageX + firstPoint.x * scale,
      imageY + firstPoint.y * scale
    );
        
    for (let i = 1; i < vectorData.points.length; i++) {
      const point = vectorData.points[i];
      ctx.lineTo(
        imageX + point.x * scale,
        imageY + point.y * scale
      );
    }
    ctx.stroke();
        
    // Draw arrows if needed
    if (vectorData.type === 'arrow' || vectorData.type === 'curved-arrow') {
      const lastPoint = vectorData.points[vectorData.points.length - 1];
      const secondLastPoint = vectorData.points[vectorData.points.length - 2];
      if (lastPoint && secondLastPoint) {
        const arrowSize = Math.max(8, 15);
        drawArrowHeadSimplified(ctx, 
          { x: imageX + secondLastPoint.x * scale, y: imageY + secondLastPoint.y * scale },
          { x: imageX + lastPoint.x * scale, y: imageY + lastPoint.y * scale },
          arrowSize, vectorData.color || '#ea4335'
        );
      }
    }
  }

  // Simplified arrow drawing
  function drawArrowHeadSimplified(ctx, from, to, size, color) {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
        
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(
      to.x - size * Math.cos(angle - Math.PI / 6),
      to.y - size * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      to.x - size * Math.cos(angle + Math.PI / 6),
      to.y - size * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Simplified label drawing for screen view export
  function drawLabelSimplified(ctx, strokeLabel, vectorData, imageX, imageY, scale, imageLabel) {
    // Get custom label positions
    const customLabelPositions = window.customLabelPositions || {};
    const imagePositions = customLabelPositions[imageLabel] || {};
        
    if (imagePositions[strokeLabel]) {
      // Use custom position (already in canvas coordinates)
      const customPos = imagePositions[strokeLabel];
      drawLabelAtPosition(ctx, strokeLabel, customPos.x, customPos.y);
    } else if (vectorData.points && vectorData.points.length > 0) {
      // Calculate default position from stroke midpoint
      const midIndex = Math.floor(vectorData.points.length / 2);
      const midPoint = vectorData.points[midIndex];
      const labelX = imageX + midPoint.x * scale;
      const labelY = imageY + midPoint.y * scale - 10; // Offset above the line
            
      drawLabelAtPosition(ctx, strokeLabel, labelX, labelY);
    }
  }

  // Helper to draw label at specific position
  function drawLabelAtPosition(ctx, text, x, y) {
    ctx.save();
    const tagSize = getTagSize(text);
    ctx.font = `bold ${tagSize}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
        
    // Measure text
    const metrics = ctx.measureText(text);
    const textWidth = metrics.width;
    const textHeight = tagSize;
        
    // Draw background
    ctx.fillStyle = 'white';
    ctx.fillRect(x - textWidth/2 - 4, y - textHeight/2 - 2, textWidth + 8, textHeight + 4);
        
    // Draw border
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - textWidth/2 - 4, y - textHeight/2 - 2, textWidth + 8, textHeight + 4);
        
    // Draw text
    ctx.fillStyle = '#333';
    ctx.fillText(text, x, y);
        
    ctx.restore();
  }
    
  // Function to process saving selected images
  function processSaveImages(selectedLabels, projectName, exportMode = 'screenView') {
    console.log(`[Export Mode] Processing individual downloads with mode: ${exportMode}`);
        
    // Show enhanced progress dialog for individual downloads
    showEnhancedSaveProgress('Preparing individual downloads...', 0, selectedLabels.length, 'individual');
        
    if (exportMode === 'screenView') {
      console.log('[Export Mode] Using Screen View processing for individual downloads');
      // For screen view, process images sequentially with individual downloads
      processImagesSequentiallyForIndividualDownloads(selectedLabels, projectName, false);
    } else {
      console.log('[Export Mode] Using Production Output processing for individual downloads');
      // For production output, use canvas switching with clean measurement rendering for individual downloads
      processImagesSequentiallyForIndividualDownloads(selectedLabels, projectName, true);
    }
  }

  // Helper function to generate unique filenames when there are duplicates
  function generateUniqueFilename(baseFilename, extension, usedFilenames) {
    let finalName = `${baseFilename}.${extension}`;
    let counter = 1;
        
    while (usedFilenames.has(finalName)) {
      finalName = `${baseFilename}_${counter}.${extension}`;
      counter++;
    }
        
    return finalName;
  }
    
  // Function to save images to a folder using File System Access API
  async function processSaveToFolder(selectedLabels, projectName, exportMode = 'screenView') {
    try {
      console.log(`[Folder Export] Starting folder export for ${selectedLabels.length} images`);
            
      // Show directory picker
      const directoryHandle = await window.showDirectoryPicker();
            
      // Show enhanced progress dialog
      showEnhancedSaveProgress('Saving to folder...', 0, selectedLabels.length, 'folder');
            
      const canvas = document.getElementById('canvas');
      const originalImageLabel = window.paintApp.state.currentImageLabel;
      const usedFilenames = new Set();
      let successCount = 0;
            
      for (let i = 0; i < selectedLabels.length; i++) {
        const imageLabel = selectedLabels[i];
                
        try {
          updateEnhancedSaveProgress(`Saving ${imageLabel}...`, i, selectedLabels.length);
                    
          // Switch to the target image
          if (window.paintApp.state.currentImageLabel !== imageLabel) {
            window.switchToImage(imageLabel);
            await new Promise(resolve => setTimeout(resolve, 500));
          }
                    
          // Determine source content: crop to capture frame if present
          let sourceCanvas = canvas;
          const captureEl = document.getElementById('captureFrame');
          if (captureEl) {
            const canvasRect = canvas.getBoundingClientRect();
            const frameRect = captureEl.getBoundingClientRect();
            const left = Math.max(frameRect.left, canvasRect.left);
            const top = Math.max(frameRect.top, canvasRect.top);
            const right = Math.min(frameRect.right, canvasRect.right);
            const bottom = Math.min(frameRect.bottom, canvasRect.bottom);
            const cssWidth = Math.max(0, right - left);
            const cssHeight = Math.max(0, bottom - top);
            if (cssWidth > 0 && cssHeight > 0) {
              const scalePx = canvas.width / canvasRect.width;
              const viewportBounds = {
                x: Math.round((left - canvasRect.left) * scalePx),
                y: Math.round((top - canvasRect.top) * scalePx),
                width: Math.round(cssWidth * scalePx),
                height: Math.round(cssHeight * scalePx)
              };
              sourceCanvas = cropToViewport(canvas, viewportBounds);
            }
          }
                    
          // Capture the (possibly cropped) content with high resolution and white background
          const tempCanvas = document.createElement('canvas');
          const tempCtx = tempCanvas.getContext('2d');
          const scale = 2; // High resolution export
          tempCanvas.width = sourceCanvas.width * scale;
          tempCanvas.height = sourceCanvas.height * scale;
          tempCtx.fillStyle = 'white';
          tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
          tempCtx.scale(scale, scale);
          tempCtx.drawImage(sourceCanvas, 0, 0);
                    
          // Convert to blob
          const blob = await new Promise(resolve => tempCanvas.toBlob(resolve, 'image/png'));
                    
          // Generate unique filename using proper image name and project name
          let imageName = (typeof window.getUserFacingImageName === 'function')
            ? window.getUserFacingImageName(imageLabel)
            : imageLabel;
                    
          // Include project name in filename
          const safeProjectName = projectName.replace(/[^\w\s]/gi, '').replace(/\s+/g, '_');
          const baseFilename = `${safeProjectName}_${imageName}`;
          const filename = generateUniqueFilename(baseFilename, 'png', usedFilenames);
          usedFilenames.add(filename);
                    
          // Save to directory
          const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
                    
          successCount++;
          console.log(`[Folder Export] Saved ${filename}`);
                    
        } catch (error) {
          console.error(`[Folder Export] Error saving ${imageLabel}:`, error);
        }
      }
            
      // Restore original image
      if (originalImageLabel && window.paintApp.state.currentImageLabel !== originalImageLabel) {
        window.switchToImage(originalImageLabel);
      }
            
      hideEnhancedSaveProgress();
      alert(`Successfully saved ${successCount} of ${selectedLabels.length} images to folder!`);
            
    } catch (error) {
      hideEnhancedSaveProgress();
      if (error.name === 'AbortError') {
        console.log('[Folder Export] User cancelled directory selection');
        return; // User cancelled, don't show error
      }
      console.error('[Folder Export] Error:', error);
      alert(`Error saving to folder: ${error.message}`);
    }
  }
    
  // Function to save images as ZIP file
  async function processSaveToZip(selectedLabels, projectName, exportMode = 'screenView') {
    try {
      if (typeof JSZip === 'undefined') {
        throw new Error('JSZip library is not loaded. Cannot create ZIP file.');
      }
            
      console.log(`[ZIP Export] Starting ZIP export for ${selectedLabels.length} images`);
            
      showEnhancedSaveProgress('Creating ZIP file...', 0, selectedLabels.length, 'zip');
            
      const zip = new JSZip();
      const canvas = document.getElementById('canvas');
      const originalImageLabel = window.paintApp.state.currentImageLabel;
      const usedFilenames = new Set();
      let successCount = 0;
            
      for (let i = 0; i < selectedLabels.length; i++) {
        const imageLabel = selectedLabels[i];
                
        try {
          updateEnhancedSaveProgress(`Processing ${imageLabel}...`, i, selectedLabels.length);
                    
          // Switch to the target image
          if (window.paintApp.state.currentImageLabel !== imageLabel) {
            window.switchToImage(imageLabel);
            await new Promise(resolve => setTimeout(resolve, 500));
          }
                    
          // Determine source content: crop to capture frame if present
          let sourceCanvas = canvas;
          const captureEl = document.getElementById('captureFrame');
          if (captureEl) {
            const canvasRect = canvas.getBoundingClientRect();
            const frameRect = captureEl.getBoundingClientRect();
            const left = Math.max(frameRect.left, canvasRect.left);
            const top = Math.max(frameRect.top, canvasRect.top);
            const right = Math.min(frameRect.right, canvasRect.right);
            const bottom = Math.min(frameRect.bottom, canvasRect.bottom);
            const cssWidth = Math.max(0, right - left);
            const cssHeight = Math.max(0, bottom - top);
            if (cssWidth > 0 && cssHeight > 0) {
              const scalePx = canvas.width / canvasRect.width;
              const viewportBounds = {
                x: Math.round((left - canvasRect.left) * scalePx),
                y: Math.round((top - canvasRect.top) * scalePx),
                width: Math.round(cssWidth * scalePx),
                height: Math.round(cssHeight * scalePx)
              };
              sourceCanvas = cropToViewport(canvas, viewportBounds);
            }
          }
                    
          // Capture the (possibly cropped) content with high resolution and white background
          const tempCanvas = document.createElement('canvas');
          const tempCtx = tempCanvas.getContext('2d');
          const scale = 2;
          tempCanvas.width = sourceCanvas.width * scale;
          tempCanvas.height = sourceCanvas.height * scale;
          tempCtx.fillStyle = 'white';
          tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
          tempCtx.scale(scale, scale);
          tempCtx.drawImage(sourceCanvas, 0, 0);
                    
          // Convert to blob
          const blob = await new Promise(resolve => tempCanvas.toBlob(resolve, 'image/png'));
                    
          // Generate unique filename using proper image name and project name
          let imageName = (typeof window.getUserFacingImageName === 'function')
            ? window.getUserFacingImageName(imageLabel)
            : imageLabel;
                    
          // Include project name in filename
          const safeProjectName = projectName.replace(/[^\w\s]/gi, '').replace(/\s+/g, '_');
          const baseFilename = `${safeProjectName}_${imageName}`;
          const filename = generateUniqueFilename(baseFilename, 'png', usedFilenames);
          usedFilenames.add(filename);
                    
          // Add to ZIP
          zip.file(filename, blob);
          successCount++;
                    
        } catch (error) {
          console.error(`[ZIP Export] Error processing ${imageLabel}:`, error);
        }
      }
            
      // Generate ZIP file
      updateEnhancedSaveProgress('Generating ZIP file...', selectedLabels.length, selectedLabels.length);
            
      const content = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      });
            
      // Download ZIP file
      const safeProjectName = projectName.replace(/[^\w\s]/gi, '').replace(/\s+/g, '_');
      const dateString = new Date().toISOString().split('T')[0];
      const zipFilename = `${safeProjectName}_images_${dateString}.zip`;
            
      const link = document.createElement('a');
      link.href = URL.createObjectURL(content);
      link.download = zipFilename;
      link.click();
            
      // Clean up
      setTimeout(() => URL.revokeObjectURL(link.href), 100);
            
      // Restore original image
      if (originalImageLabel && window.paintApp.state.currentImageLabel !== originalImageLabel) {
        window.switchToImage(originalImageLabel);
      }
            
      hideEnhancedSaveProgress();
      alert(`Successfully created ZIP file with ${successCount} of ${selectedLabels.length} images!`);
            
    } catch (error) {
      hideEnhancedSaveProgress();
      console.error('[ZIP Export] Error:', error);
      alert(`Error creating ZIP file: ${error.message}`);
    }
  }
  // New function for sequential screen view processing
  async function processImagesSequentiallyForScreenView(selectedLabels, projectName, isProductionOutput = false) {
    const canvas = document.getElementById('canvas');
    const originalImageLabel = window.paintApp.state.currentImageLabel;
    const savedImages = [];
    const usedFilenames = new Set(); // Track used filenames to avoid duplicates
        
    for (let i = 0; i < selectedLabels.length; i++) {
      const imageLabel = selectedLabels[i];
            
      const modeLabel = isProductionOutput ? 'Production Output' : 'Screen View Export';
      console.log(`[${modeLabel}] Processing ${imageLabel} (${i + 1}/${selectedLabels.length})`);
            
      // Switch to the target image using the proper switchToImage function
      if (window.paintApp.state.currentImageLabel !== imageLabel) {
        window.switchToImage(imageLabel);
        // Wait for rendering to complete
        await new Promise(resolve => setTimeout(resolve, 500));
      }
            
      // Determine source content: crop to capture frame if present
      let sourceCanvas = canvas;
      const captureEl = document.getElementById('captureFrame');
      if (captureEl) {
        const canvasRect = canvas.getBoundingClientRect();
        const frameRect = captureEl.getBoundingClientRect();
        const left = Math.max(frameRect.left, canvasRect.left);
        const top = Math.max(frameRect.top, canvasRect.top);
        const right = Math.min(frameRect.right, canvasRect.right);
        const bottom = Math.min(frameRect.bottom, canvasRect.bottom);
        const cssWidth = Math.max(0, right - left);
        const cssHeight = Math.max(0, bottom - top);
        if (cssWidth > 0 && cssHeight > 0) {
          const scalePx = canvas.width / canvasRect.width;
          const viewportBounds = {
            x: Math.round((left - canvasRect.left) * scalePx),
            y: Math.round((top - canvasRect.top) * scalePx),
            width: Math.round(cssWidth * scalePx),
            height: Math.round(cssHeight * scalePx)
          };
          sourceCanvas = cropToViewport(canvas, viewportBounds);
        }
      }
            
      // Capture the (possibly cropped) content at higher resolution with white background
      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d');
      const scale = 2;
      tempCanvas.width = sourceCanvas.width * scale;
      tempCanvas.height = sourceCanvas.height * scale;
      tempCtx.fillStyle = 'white';
      tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
      tempCtx.scale(scale, scale);
      tempCtx.drawImage(sourceCanvas, 0, 0);
            
      // Convert to blob and save
      const fileFormat = isProductionOutput ? 'image/jpeg' : 'image/png';
      const quality = isProductionOutput ? 0.85 : 0.9;
      const fileExtension = isProductionOutput ? 'jpg' : 'png';
      const blob = await new Promise(resolve => tempCanvas.toBlob(resolve, fileFormat, quality));
            
      // Generate unique filename using proper image name and project name
      let imageName = (typeof window.getUserFacingImageName === 'function')
        ? window.getUserFacingImageName(imageLabel)
        : imageLabel;
            
      // Include project name in filename
      const safeProjectName = projectName.replace(/[^\w\s]/gi, '').replace(/\s+/g, '_');
      const baseFilename = `${safeProjectName}_${imageName}`;
      const filename = generateUniqueFilename(baseFilename, fileExtension, usedFilenames);
      usedFilenames.add(filename);
            
      savedImages.push({
        blob: blob,
        name: filename
      });
            
      // Update progress
      updateSaveProgress(i + 1, selectedLabels.length, `Processing ${imageLabel}...`);
    }
        
    // Switch back to original image
    if (originalImageLabel && originalImageLabel !== selectedLabels[selectedLabels.length - 1]) {
      window.paintApp.state.currentImageLabel = originalImageLabel;
      window.redrawCanvasWithVisibility();
    }
        
    // Create ZIP file
    createImagesZip(savedImages, projectName);
  }
    
  // Enhanced function for individual downloads (no ZIP)
  async function processImagesSequentiallyForIndividualDownloads(selectedLabels, projectName, isProductionOutput = false) {
    const canvas = document.getElementById('canvas');
    const originalImageLabel = window.paintApp.state.currentImageLabel;
    const usedFilenames = new Set();
    let successCount = 0;
        
    try {
      for (let i = 0; i < selectedLabels.length; i++) {
        const imageLabel = selectedLabels[i];
                
        try {
          const modeLabel = isProductionOutput ? 'Production Output' : 'Screen View Export';
          console.log(`[${modeLabel}] Processing ${imageLabel} (${i + 1}/${selectedLabels.length}) for individual download`);
                    
          // Update progress
          updateEnhancedSaveProgress(`Downloading ${imageLabel}...`, i, selectedLabels.length);
                    
          // Switch to the target image
          if (window.paintApp.state.currentImageLabel !== imageLabel) {
            window.switchToImage(imageLabel);
            await new Promise(resolve => setTimeout(resolve, 500));
          }
                    
          // Determine source content: crop to capture frame if present
          let sourceCanvas = canvas;
          const captureEl = document.getElementById('captureFrame');
          if (captureEl) {
            const canvasRect = canvas.getBoundingClientRect();
            const frameRect = captureEl.getBoundingClientRect();
            const left = Math.max(frameRect.left, canvasRect.left);
            const top = Math.max(frameRect.top, canvasRect.top);
            const right = Math.min(frameRect.right, canvasRect.right);
            const bottom = Math.min(frameRect.bottom, canvasRect.bottom);
            const cssWidth = Math.max(0, right - left);
            const cssHeight = Math.max(0, bottom - top);
            if (cssWidth > 0 && cssHeight > 0) {
              const scalePx = canvas.width / canvasRect.width;
              const viewportBounds = {
                x: Math.round((left - canvasRect.left) * scalePx),
                y: Math.round((top - canvasRect.top) * scalePx),
                width: Math.round(cssWidth * scalePx),
                height: Math.round(cssHeight * scalePx)
              };
              sourceCanvas = cropToViewport(canvas, viewportBounds);
            }
          }
                    
          // Capture the (possibly cropped) content with high resolution and white background
          const tempCanvas = document.createElement('canvas');
          const tempCtx = tempCanvas.getContext('2d');
          const scale = 2; // High resolution export
          tempCanvas.width = sourceCanvas.width * scale;
          tempCanvas.height = sourceCanvas.height * scale;
          tempCtx.fillStyle = 'white';
          tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
          tempCtx.scale(scale, scale);
          tempCtx.drawImage(sourceCanvas, 0, 0);
                    
          // Generate unique filename using proper image name and project name
          let imageName = (typeof window.getUserFacingImageName === 'function')
            ? window.getUserFacingImageName(imageLabel)
            : imageLabel;
                    
          // Include project name in filename
          const safeProjectName = projectName.replace(/[^\w\s]/gi, '').replace(/\s+/g, '_');
          const baseFilename = `${safeProjectName}_${imageName}`;
                    
          const fileExtension = isProductionOutput ? 'jpg' : 'png';
          const filename = generateUniqueFilename(baseFilename, fileExtension, usedFilenames);
          usedFilenames.add(filename);
                    
          // Convert to data URL and trigger download
          const fileFormat = isProductionOutput ? 'image/jpeg' : 'image/png';
          const quality = isProductionOutput ? 0.85 : 0.9;
          const dataUrl = tempCanvas.toDataURL(fileFormat, quality);
                    
          // Create download link
          const link = document.createElement('a');
          link.href = dataUrl;
          link.download = filename;
          link.click();
                    
          successCount++;
          console.log(`[Individual Download] Downloaded ${filename}`);
                    
          // Small delay between downloads to prevent browser blocking
          await new Promise(resolve => setTimeout(resolve, 150));
                    
        } catch (error) {
          console.error(`[Individual Download] Error processing ${imageLabel}:`, error);
        }
      }
            
    } finally {
      // Always restore original image and hide progress
      if (originalImageLabel && window.paintApp.state.currentImageLabel !== originalImageLabel) {
        window.switchToImage(originalImageLabel);
      }
            
      hideEnhancedSaveProgress();
            
      if (successCount > 0) {
        alert(`Successfully downloaded ${successCount} of ${selectedLabels.length} images!`);
      } else {
        alert('No images were downloaded. Please try again.');
      }
    }
  }



  // Original parallel processing function for production output
  function processImagesParallel(selectedLabels, projectName, exportMode) {
    // Get the correct image storage location
    const originalImages = window.originalImages || window.paintApp.state.originalImages || {};
    const originalImageDimensions = window.originalImageDimensions || window.paintApp.state.originalImageDimensions || {};
        
    // Create a temporary canvas for rendering each image
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
        
    const savedImages = [];
    const usedFilenames = new Set(); // Track used filenames to avoid duplicates
    let currentIndex = 0;
        
    // Process each image sequentially
    function processNextImage() {
      if (currentIndex >= selectedLabels.length) {
        // All images processed, create ZIP
        createImagesZip(savedImages, projectName);
        return;
      }
            
      const imageLabel = selectedLabels[currentIndex];
      updateSaveProgress(currentIndex + 1, selectedLabels.length, `Processing ${imageLabel} image...`);
            
      // Get the original image URL
      const originalImageUrl = originalImages[imageLabel];
      if (!originalImageUrl) {
        currentIndex++;
        processNextImage();
        return;
      }
            
      // Get image dimensions and scale
      const imageDimensions = originalImageDimensions[imageLabel];
      const scale = window.paintApp.state.imageScaleByLabel[imageLabel] || 1;
      const position = window.paintApp.state.imagePositionByLabel[imageLabel] || { x: 0, y: 0 };
            
      if (!imageDimensions) {
        currentIndex++;
        processNextImage();
        return;
      }
            
      // Create image object from URL
      const img = new Image();
      img.onload = function() {
        let exportWidth, exportHeight, exportScale;
        // Production Output Mode: Full image with overlaid labels
        const originalWidth = imageDimensions.width;
        const originalHeight = imageDimensions.height;
        const maxDimension = 1600;
                    
        if (originalWidth > originalHeight) {
          exportWidth = Math.min(originalWidth, maxDimension);
          exportHeight = (originalHeight * exportWidth) / originalWidth;
        } else {
          exportHeight = Math.min(originalHeight, maxDimension);
          exportWidth = (originalWidth * exportHeight) / originalHeight;
        }
                    
        exportScale = exportWidth / originalWidth;
                    
        tempCanvas.width = exportWidth;
        tempCanvas.height = exportHeight;
        tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
                    
        // Draw the full image at export size
        tempCtx.drawImage(img, 0, 0, exportWidth, exportHeight);
                
        // Draw all visible strokes for this image
        // Use window variables directly (they contain the loaded project data)
        const baseImageType = imageLabel.split('_')[0]; // front_7 -> front
                
        // Try different sources for stroke data using window variables
        const baseTypeStrokes = window.vectorStrokesByImage[baseImageType] || {};
        const fullLabelStrokes = window.vectorStrokesByImage[imageLabel] || {};
                
        // Use the location that has strokes (prioritize full label, then base type)
        let vectorStrokes = {};
        let strokeSource = '';
        let strokeVisibility = {};
                
        if (Object.keys(fullLabelStrokes).length > 0) {
          vectorStrokes = fullLabelStrokes;
          strokeSource = imageLabel;
          strokeVisibility = window.strokeVisibilityByImage[imageLabel] || {};
        } else if (Object.keys(baseTypeStrokes).length > 0) {
          vectorStrokes = baseTypeStrokes;
          strokeSource = baseImageType;
          strokeVisibility = window.strokeVisibilityByImage[baseImageType] || {};
        }
                
        console.log(`[Save Images] Processing ${imageLabel} - Using stroke source: ${strokeSource} with ${Object.keys(vectorStrokes).length} strokes`);
                
        // Production Output Mode: Original behavior with overlaid labels
        Object.keys(vectorStrokes).forEach(strokeLabel => {
          if (strokeVisibility[strokeLabel] !== false) {
            const vectorData = vectorStrokes[strokeLabel];
            if (vectorData && vectorData.points && vectorData.points.length > 0) {
              console.log(`[Save Images] Drawing stroke ${strokeLabel} with ${vectorData.points.length} points, color: ${vectorData.color}`);
              // Draw the stroke on the temp canvas using export scale
              drawStrokeOnCanvas(tempCtx, vectorData, exportScale, 0, 0, imageLabel, false, { x: exportWidth/2, y: exportHeight/2 });
                                
              // Draw measurement label overlaid on line
              const labelVisibility = window.strokeLabelVisibility[imageLabel] || {};
              if (labelVisibility[strokeLabel] !== false) {
                drawMeasurementLabelForExport(tempCtx, strokeLabel, vectorData, exportScale, imageLabel);
              }
            }
          }
        });
                
        // Convert canvas to blob with compression for email use
        tempCanvas.toBlob((blob) => {
          if (blob) {
            // Use proper image name and include project name
            let imageName = (typeof window.getUserFacingImageName === 'function')
              ? window.getUserFacingImageName(imageLabel)
              : imageLabel;
                        
            // Include project name in filename
            const safeProjectName = projectName.replace(/[^\w\s]/gi, '').replace(/\s+/g, '_');
            imageName = `${safeProjectName}_${imageName}`;
            imageName = imageName.charAt(0).toUpperCase() + imageName.slice(1);
            const baseFilename = imageName;
            const filename = generateUniqueFilename(baseFilename, 'jpg', usedFilenames);
            usedFilenames.add(filename);
                        
            savedImages.push({
              name: filename,
              blob: blob
            });
          }
                    
          currentIndex++;
          // Process next image immediately (no delay)
          processNextImage();
        }, 'image/jpeg', 0.85); // Use JPEG with 85% quality for smaller file size
      };
            
      // Handle image load error
      img.onerror = function() {
        console.error(`Failed to load image: ${imageLabel}`);
        currentIndex++;
        processNextImage();
      };
            
      // Set the image source to trigger loading
      img.src = originalImageUrl;
    }
        
    // Start processing
    processNextImage();
  }
    
  // Helper function to draw a stroke on a canvas (optimized for export)
  function drawStrokeOnCanvas(ctx, vectorData, scale, imageX, imageY, currentImageLabel, isBlankCanvas, canvasCenter) {
    if (!vectorData.points || vectorData.points.length === 0) return;
        
    console.log(`[drawStrokeOnCanvas] Drawing with scale: ${scale}, first point: (${vectorData.points[0].x}, ${vectorData.points[0].y})`);
        
    // Set stroke properties
    ctx.strokeStyle = vectorData.color;
    ctx.lineWidth = Math.max(2, (vectorData.width || 5) * scale); // Ensure minimum line width of 2px
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
        
    // Set dash pattern if enabled
    if (vectorData.dashSettings && vectorData.dashSettings.enabled && vectorData.dashSettings.pattern.length > 0) {
      const scaledPattern = vectorData.dashSettings.pattern.map(dash => Math.max(1, dash * scale));
      ctx.setLineDash(scaledPattern);
      ctx.lineDashOffset = 0;
    } else {
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }
        
    // Draw the stroke
    ctx.beginPath();
        
    // Scale all points directly from their stored coordinates
    const firstPoint = vectorData.points[0];
    const transformedFirstX = firstPoint.x * scale;
    const transformedFirstY = firstPoint.y * scale;
        
    console.log(`[drawStrokeOnCanvas] Moving to: (${transformedFirstX}, ${transformedFirstY})`);
    ctx.moveTo(transformedFirstX, transformedFirstY);
        
    // Draw remaining points efficiently
    for (let i = 1; i < vectorData.points.length; i++) {
      const point = vectorData.points[i];
      const transformedX = point.x * scale;
      const transformedY = point.y * scale;
      ctx.lineTo(transformedX, transformedY);
    }
        
    ctx.stroke();
        
    // Draw arrow heads if this is a straight line with arrow settings
    if (vectorData.type === 'straight' && vectorData.arrowSettings && vectorData.points.length >= 2) {
      const startPoint = {
        x: vectorData.points[0].x * scale,
        y: vectorData.points[0].y * scale
      };
      const endPoint = {
        x: vectorData.points[vectorData.points.length - 1].x * scale,
        y: vectorData.points[vectorData.points.length - 1].y * scale
      };
            
      drawArrowheadForExport(ctx, startPoint, endPoint, vectorData.arrowSettings, vectorData.width || 5, vectorData.color, scale);
    }
        
    console.log('[drawStrokeOnCanvas] Stroke drawn successfully');
  }
    
  // Helper function to draw arrow heads for export (simplified version)
  function drawArrowheadForExport(ctx, startPoint, endPoint, arrowSettings, strokeWidth, strokeColor, scale) {
    if (!arrowSettings || (!arrowSettings.startArrow && !arrowSettings.endArrow)) return;
        
    const dx = endPoint.x - startPoint.x;
    const dy = endPoint.y - startPoint.y;
    const lineLength = Math.sqrt(dx * dx + dy * dy);
        
    if (lineLength === 0) return;
        
    const angle = Math.atan2(dy, dx);
    const baseArrowSize = Math.max(arrowSettings.arrowSize || (strokeWidth * 2), strokeWidth * 2);
    const scaledArrowSize = baseArrowSize * scale;
    const arrowTan30 = Math.tan(Math.PI / 6); // ~0.577
        
    // Set context properties for arrows
    ctx.save();
    ctx.fillStyle = strokeColor;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth * scale;
    ctx.setLineDash([]); // Reset dash pattern for arrows
        
    // Draw start arrow
    if (arrowSettings.startArrow) {
      ctx.save();
      ctx.translate(startPoint.x, startPoint.y);
      ctx.rotate(angle + Math.PI);
            
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-scaledArrowSize, -scaledArrowSize * arrowTan30);
      ctx.lineTo(-scaledArrowSize, scaledArrowSize * arrowTan30);
      ctx.closePath();
      ctx.fill();
            
      ctx.restore();
    }
        
    // Draw end arrow
    if (arrowSettings.endArrow) {
      ctx.save();
      ctx.translate(endPoint.x, endPoint.y);
      ctx.rotate(angle);
            
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-scaledArrowSize, -scaledArrowSize * arrowTan30);
      ctx.lineTo(-scaledArrowSize, scaledArrowSize * arrowTan30);
      ctx.closePath();
      ctx.fill();
            
      ctx.restore();
    }
        
    ctx.restore();
  }
    
  // Helper function to draw stroke for screen view export
  function drawStrokeForScreenView(ctx, vectorData, viewport, imageLabel) {
    if (!vectorData.points || vectorData.points.length === 0) return;
        
    // Set stroke properties
    ctx.strokeStyle = vectorData.color;
    ctx.lineWidth = Math.max(1, (vectorData.width || 5) * viewport.scale);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
        
    // Set dash pattern if enabled
    if (vectorData.dashSettings && vectorData.dashSettings.enabled && vectorData.dashSettings.pattern.length > 0) {
      const scaledPattern = vectorData.dashSettings.pattern.map(dash => Math.max(1, dash * viewport.scale));
      ctx.setLineDash(scaledPattern);
      ctx.lineDashOffset = 0;
    } else {
      ctx.setLineDash([]);
    }
        
    // Draw the stroke
    ctx.beginPath();
        
    // Transform points from image space to viewport space
    const transformedPoints = vectorData.points.map(point => ({
      x: (point.x * viewport.scale + viewport.imageX) - viewport.x,
      y: (point.y * viewport.scale + viewport.imageY) - viewport.y
    }));
        
    // Only draw if any part of the stroke is visible in viewport
    const hasVisiblePoints = transformedPoints.some(p => 
      p.x >= -50 && p.x <= viewport.width + 50 && 
            p.y >= -50 && p.y <= viewport.height + 50
    );
        
    if (hasVisiblePoints) {
      ctx.moveTo(transformedPoints[0].x, transformedPoints[0].y);
      for (let i = 1; i < transformedPoints.length; i++) {
        ctx.lineTo(transformedPoints[i].x, transformedPoints[i].y);
      }
      ctx.stroke();
            
      // Draw arrow heads if this is a straight line with arrow settings
      if (vectorData.type === 'straight' && vectorData.arrowSettings && transformedPoints.length >= 2) {
        const startPoint = transformedPoints[0];
        const endPoint = transformedPoints[transformedPoints.length - 1];
        drawArrowheadForExport(ctx, startPoint, endPoint, vectorData.arrowSettings, vectorData.width || 5, vectorData.color, viewport.scale);
      }
    }
  }
    
  // Helper function to draw label for screen view export
  function drawLabelForScreenView(ctx, strokeLabel, vectorData, viewport, imageLabel) {
    // Get custom label position if it exists
    const customPositions = window.customLabelPositions[imageLabel] || {};
    const calculatedOffsets = window.calculatedLabelOffsets[imageLabel] || {};
        
    let labelPosition = null;
    if (customPositions[strokeLabel]) {
      labelPosition = customPositions[strokeLabel];
    } else if (calculatedOffsets[strokeLabel]) {
      labelPosition = calculatedOffsets[strokeLabel];
    }
        
    if (!labelPosition && vectorData.points && vectorData.points.length >= 2) {
      // Default to midpoint if no custom position
      const firstPoint = vectorData.points[0];
      const lastPoint = vectorData.points[vectorData.points.length - 1];
      labelPosition = {
        x: (firstPoint.x + lastPoint.x) / 2,
        y: (firstPoint.y + lastPoint.y) / 2 - 30 // Default offset above stroke
      };
    }
        
    if (!labelPosition) return;
        
    // Transform label position from image space to viewport space
    const labelX = (labelPosition.x * viewport.scale + viewport.imageX) - viewport.x;
    const labelY = (labelPosition.y * viewport.scale + viewport.imageY) - viewport.y;
        
    // Only draw if label is visible in viewport
    if (labelX >= -100 && labelX <= viewport.width + 100 && 
            labelY >= -50 && labelY <= viewport.height + 50) {
      // Disable legacy overlay if unified renderer is active
      if (window.disableLegacyMeasurementOverlay) {
        return;
      }
            
      // Get measurement text
      const measurements = window.strokeMeasurements[imageLabel] || {};
      const measurement = measurements[strokeLabel];
            
      let measurementText = '';
      if (measurement) {
        if (measurement.inchWhole || measurement.inchFraction) {
          let fractionStr = '';
          if (measurement.inchFraction) {
            fractionStr = ` ${measurement.inchFraction}`;
          }
          measurementText = `${measurement.inchWhole}${fractionStr}"`;
        } else if (measurement.cm) {
          measurementText = `${measurement.cm}cm`;
        }
      }
            
      const labelText = measurementText ? `${strokeLabel}=${measurementText}` : strokeLabel;
            
      // Set font properties scaled for viewport
      ctx.save();
      const tagSize = getTagSize(strokeLabel);
      const fontSize = Math.max(12, tagSize * viewport.scale);
      ctx.font = `${fontSize}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
            
      // Measure text for background
      const metrics = ctx.measureText(labelText);
      const textWidth = metrics.width;
      const textHeight = fontSize;
      const padding = 6 * viewport.scale;
            
      // Draw background rectangle
      ctx.fillStyle = 'white';
      ctx.fillRect(
        labelX - textWidth/2 - padding,
        labelY - textHeight/2 - padding,
        textWidth + padding * 2,
        textHeight + padding * 2
      );
            
      // Draw border
      ctx.strokeStyle = '#ccc';
      ctx.lineWidth = 1;
      ctx.strokeRect(
        labelX - textWidth/2 - padding,
        labelY - textHeight/2 - padding,
        textWidth + padding * 2,
        textHeight + padding * 2
      );
            
      // Draw text
      ctx.fillStyle = '#333';
      if (!window.disableLegacyMeasurementOverlay) {
        ctx.fillText(labelText, labelX, labelY);
      }
            
      ctx.restore();
    }
  }
    
  // Helper function to draw measurement labels for export
  function drawMeasurementLabelForExport(ctx, strokeLabel, vectorData, scale, imageLabel) {
    // Get the measurement text
    const measurements = window.strokeMeasurements[imageLabel] || {};
    const measurement = measurements[strokeLabel];
        
    let measurementText = '';
    if (measurement) {
      // For production output, always convert to CM
      if (measurement.cm) {
        measurementText = `${measurement.cm}cm`;
      } else if (measurement.inchWhole || measurement.inchFraction) {
        // Convert inches to CM
        const totalInches = (measurement.inchWhole || 0) + (measurement.inchFraction || 0);
        const cm = (totalInches * window.paintApp.config.INCHES_TO_CM).toFixed(1);
        measurementText = `${cm}cm`;
      }
    }
        
    const labelText = measurementText ? `${strokeLabel}=${measurementText}` : strokeLabel;
        
    // Calculate label position (at the middle of the stroke)
    if (vectorData.points && vectorData.points.length >= 2) {
      const firstPoint = vectorData.points[0];
      const lastPoint = vectorData.points[vectorData.points.length - 1];
            
      // Calculate midpoint
      const midX = (firstPoint.x + lastPoint.x) / 2 * scale;
      const midY = (firstPoint.y + lastPoint.y) / 2 * scale;
            
      // Set font properties for clean, professional text
      ctx.save();
      const tagSize = getTagSize(strokeLabel);
      ctx.font = `${Math.max(16, tagSize * scale)}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
            
      // Measure text for white background
      const metrics = ctx.measureText(labelText);
      const textWidth = metrics.width;
      const textHeight = Math.max(16, 22 * scale);
      const padding = 4 * scale;
            
      // Draw white background rectangle
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(
        midX - textWidth/2 - padding,
        midY - textHeight/2 - padding,
        textWidth + padding * 2,
        textHeight + padding * 2
      );
            
      // Draw black text on white background
      ctx.fillStyle = '#000000';
      ctx.fillText(labelText, midX, midY);
            
      ctx.restore();
    }
  }
    
  // Function to show save progress dialog
  function showSaveAllImagesProgress(totalImages) {
    const overlay = document.createElement('div');
    overlay.id = 'saveAllImagesOverlay';
    overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.7);
            z-index: 10000;
            display: flex;
            justify-content: center;
            align-items: center;
        `;
        
    const dialog = document.createElement('div');
    dialog.style.cssText = `
            background-color: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
            width: 400px;
            max-width: 90%;
            text-align: center;
        `;
        
    dialog.innerHTML = `
            <h3 style="margin: 0 0 20px 0; color: #333;">Saving All Images</h3>
            <div id="saveProgressText" style="margin-bottom: 20px; color: #666;">Preparing to save ${totalImages} images...</div>
            <div style="width: 100%; background-color: #f0f0f0; border-radius: 10px; overflow: hidden;">
                <div id="saveProgressBar" style="width: 0%; height: 20px; background-color: #4CAF50; transition: width 0.3s ease;"></div>
            </div>
            <div style="margin-top: 15px; font-size: 12px; color: #999;">Please wait while we process your images...</div>
        `;
        
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  }
    
  // Function to update save progress
  function updateSaveProgress(current, total, message) {
    const progressText = document.getElementById('saveProgressText');
    const progressBar = document.getElementById('saveProgressBar');
        
    if (progressText) {
      progressText.textContent = `${message} (${current}/${total})`;
    }
        
    if (progressBar) {
      const percentage = (current / total) * 100;
      progressBar.style.width = percentage + '%';
    }
  }
    
  // Enhanced progress dialog for different export methods
  function showEnhancedSaveProgress(message, current, total, method = 'individual') {
    const overlay = document.createElement('div');
    overlay.id = 'enhancedSaveProgressOverlay';
    overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.7);
            z-index: 10001;
            display: flex;
            justify-content: center;
            align-items: center;
        `;
        
    const dialog = document.createElement('div');
    dialog.style.cssText = `
            background-color: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
            width: 450px;
            max-width: 90%;
            text-align: center;
        `;
        
    // Get method-specific icons and labels
    const methodInfo = {
      individual: { icon: '📁', label: 'Individual Downloads' },
      folder: { icon: '📂', label: 'Saving to Folder' },
      zip: { icon: '📦', label: 'Creating ZIP File' }
    };
        
    const info = methodInfo[method] || methodInfo.individual;
    const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
        
    dialog.innerHTML = `
            <div style="font-size: 24px; margin-bottom: 10px;">${info.icon}</div>
            <h3 style="margin: 0 0 20px 0; color: #333;">${info.label}</h3>
            <div id="enhancedProgressText" style="margin-bottom: 20px; color: #666; font-weight: 500;">${message}</div>
            <div style="width: 100%; background-color: #f0f0f0; border-radius: 10px; overflow: hidden; margin-bottom: 15px;">
                <div id="enhancedProgressBar" style="width: ${percentage}%; height: 24px; background: linear-gradient(90deg, #4CAF50, #45a049); transition: width 0.3s ease; border-radius: 10px;"></div>
            </div>
            <div id="enhancedProgressPercentage" style="font-size: 18px; font-weight: bold; color: #333; margin-bottom: 10px;">${percentage}%</div>
            <div id="enhancedProgressCount" style="font-size: 14px; color: #999;">${current} of ${total} completed</div>
        `;
        
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  }
  // Update enhanced progress dialog
  function updateEnhancedSaveProgress(message, current, total) {
    const progressText = document.getElementById('enhancedProgressText');
    const progressBar = document.getElementById('enhancedProgressBar');
    const progressPercentage = document.getElementById('enhancedProgressPercentage');
    const progressCount = document.getElementById('enhancedProgressCount');
        
    if (progressText) {
      progressText.textContent = message;
    }
        
    if (progressBar && total > 0) {
      const percentage = Math.round((current / total) * 100);
      progressBar.style.width = percentage + '%';
            
      if (progressPercentage) {
        progressPercentage.textContent = percentage + '%';
      }
    }
        
    if (progressCount) {
      progressCount.textContent = `${current} of ${total} completed`;
    }
  }
    
  // Hide enhanced progress dialog
  function hideEnhancedSaveProgress() {
    const overlay = document.getElementById('enhancedSaveProgressOverlay');
    if (overlay) {
      document.body.removeChild(overlay);
    }
  }
    
  // Function to create and download ZIP file with all images
  function createImagesZip(savedImages, projectName) {
    updateSaveProgress(savedImages.length, savedImages.length, 'Creating ZIP file...');
        
    const zip = new JSZip();
        
    // Add each image to the ZIP
    savedImages.forEach(imageData => {
      zip.file(imageData.name, imageData.blob);
    });
        
    // Generate and download ZIP
    zip.generateAsync({ type: 'blob' }).then(function(content) {
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${projectName}_All_Images.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
            
      // Close progress dialog
      const overlay = document.getElementById('saveAllImagesOverlay');
      if (overlay) {
        overlay.remove();
      }
    }).catch(function(err) {
      console.error('Error creating ZIP:', err);
      alert('Error creating ZIP file. Please try again.');
            
      // Close progress dialog
      const overlay = document.getElementById('saveAllImagesOverlay');
      if (overlay) {
        overlay.remove();
      }
    });
  }

  // Make functions globally accessible
  window.generateMeasurementsList = generateMeasurementsList;
  window.viewSubmittedMeasurements = viewSubmittedMeasurements;
  window.saveAllImages = saveAllImages;

  // Function to update stroke visibility controls
  // Make updateStrokeVisibilityControls available globally
  window.updateStrokeVisibilityControls = updateStrokeVisibilityControls;
            
  // *** NEW HELPER FUNCTION for creating and configuring measureText ***
  function createEditableMeasureText(strokeLabel, isSelected, parentItem) {
    const measureText = document.createElement('span');
    measureText.className = 'stroke-measurement';

    const currentFormattedMeasurement = getMeasurementString(strokeLabel) || '';
    measureText.textContent = currentFormattedMeasurement;
    //         console.log(`[createEditableMeasureText] Initial for ${strokeLabel}: "${currentFormattedMeasurement}"`);

    // SAFETY CHECK: Make sure we don't append to parentItem if it's undefined or null
    if (isSelected && (parentItem === undefined || parentItem === null)) {
      //             console.log(`[createEditableMeasureText] INFO: parentItem is null/undefined for stroke ${strokeLabel}. Caller will handle DOM insertion.`);
    }

    if (isSelected) {
      measureText.contentEditable = 'true';
      measureText.dataset.originalMeasurementString = currentFormattedMeasurement;
      measureText.dataset.selectedMeasurement = 'true';

      // Check if this is a newly created stroke that should auto-focus
      const isNewlyCreated = window.newlyCreatedStroke &&
                window.newlyCreatedStroke.label === strokeLabel &&
                window.newlyCreatedStroke.image === currentImageLabel &&
                (Date.now() - window.newlyCreatedStroke.timestamp) < 2000; // Within last 2 seconds

      // Auto-focus for newly created strokes OR when explicitly requested (but not during zoom/scale operations)
      // Also check if the document has an active focused element that is a measurement field to avoid interrupting user interactions
      const hasActiveMeasurementFocus = document.activeElement && 
                document.activeElement.classList && 
                document.activeElement.classList.contains('stroke-measurement');
                
      const shouldAutoFocus = isNewlyCreated || (!window.isDefocusingOperationInProgress && isSelected && !window.isScalingOrZooming && !window.isMovingImage && !hasActiveMeasurementFocus);

      //             console.log(`[createEditableMeasureText] Focus logic for ${strokeLabel}: isNewlyCreated=${isNewlyCreated}, isSelected=${isSelected}, isScalingOrZooming=${!!window.isScalingOrZooming}, isMovingImage=${!!window.isMovingImage}, hasActiveMeasurementFocus=${hasActiveMeasurementFocus}, isDefocusingOperationInProgress=${!!window.isDefocusingOperationInProgress}, shouldAutoFocus=${shouldAutoFocus}`);

      if (shouldAutoFocus) {
        // Focus and select all text for newly created or explicitly selected strokes
        setTimeout(() => {
          if (document.body.contains(measureText)) {
            measureText.focus();
            const selection = window.getSelection();
            if (selection) {
              const range = document.createRange();
              range.selectNodeContents(measureText);
              selection.removeAllRanges();
              selection.addRange(range);
            }
          }
        }, 0);
      }
    } else {
      measureText.contentEditable = 'false';
    }

    measureText.addEventListener('keydown', (event) => {
      if (measureText.contentEditable !== 'true') return;

      // Handle navigation keys when editing measurements
      if (document.activeElement === measureText) {
        const navigationKeys = ['w', 'a', 's', 'd', 'q', 'e', 'W', 'A', 'S', 'D', 'Q', 'E'];
                
        if (navigationKeys.includes(event.key)) {
          event.stopPropagation(); // Prevent the key from reaching global handlers
          event.preventDefault(); // Prevent default behavior
          return;
        }
      }

      if (event.key === 'Enter' && !event.ctrlKey && !event.shiftKey) {
        event.preventDefault();
        measureText.blur();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        measureText.textContent = measureText.dataset.originalMeasurementString || '';
        measureText.dataset.escapeReverted = 'true'; // Flag for blur handler
        measureText.blur();
      } else if ((event.ctrlKey || event.shiftKey) && event.key === 'Enter') {
        event.preventDefault(); // Disallow newlines
      }
    });

    // Add input filtering to prevent WASD/QE interference when editing measurements
    measureText.addEventListener('input', (event) => {
      if (measureText.contentEditable !== 'true') return;
            
      // Only filter when this specific element has focus to avoid blocking global shortcuts
      if (document.activeElement === measureText) {
        // Only allow numbers, fractions, spaces, and basic punctuation
        const allowedPattern = /^[0-9\s\.\-\/'"]*$/;
        const currentText = measureText.textContent;
                
        if (!allowedPattern.test(currentText)) {
          // Remove any invalid characters
          const filteredText = currentText.replace(/[^0-9\s\.\-\/'"]/g, '');
          measureText.textContent = filteredText;
                    
          // Restore cursor position to end
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(measureText);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
    });

    measureText.addEventListener('blur', () => {
      const wasEditable = measureText.dataset.originalMeasurementString !== undefined;
      measureText.contentEditable = 'false'; // Always make it non-editable on blur

      if (wasEditable) {
        if (measureText.dataset.escapeReverted === 'true') {
          measureText.removeAttribute('data-escape-reverted');
          //                     console.log(`[measureText blur - ESCAPE] Reverted ${strokeLabel} to: \"${measureText.dataset.originalMeasurementString}\".`);
          // Text content is already visually reverted by keydown. No further action needed here.
        } else {
          const newText = measureText.textContent;
          const originalText = measureText.dataset.originalMeasurementString || '';
                    
          if (newText !== originalText) {
            //                         console.log(`[measureText blur - CHANGED] For ${strokeLabel}. Old: \"${originalText}\", New: \"${newText}\". Parsing.`);
            const parseSuccess = parseAndSaveMeasurement(strokeLabel, newText);
            if (parseSuccess) {
              measureText.textContent = getMeasurementString(strokeLabel) || '';
              //                             console.log(`[measureText blur - PARSE SUCCESS] ${strokeLabel} updated to: "${measureText.textContent}".`);
              // Calls to update UI are now here, after successful parse and visual update of measureText
              updateStrokeVisibilityControls();
              setTimeout(() => { // Defer canvas redraw to next tick
                redrawCanvasWithVisibility();
              }, 0);
            } else {
              // Parse failed, revert to original text
              measureText.textContent = measureText.dataset.originalMeasurementString || '';
              console.warn(`[measureText blur - PARSE FAILED] For ${strokeLabel} with \"${newText}\". Reverting to \"${originalText}\".`);
            }
          } else {
            //                         console.log(`[measureText blur - UNCHANGED] For ${strokeLabel}. Value: \"${newText}\".`);
          }
        }
      }
      measureText.removeAttribute('data-original-measurement-string');

      // DO NOT CALL updateStrokeVisibilityControls() or redrawCanvasWithVisibility() here.
      // The click handler on the new item (if any) or other actions will trigger the necessary redraws.
      // This specific blur event should only finalize the edit of *this* item.
    });
    return measureText;
  }
  // *** END NEW HELPER FUNCTION ***

  // Helper function to create individual stroke visibility control elements
  function createStrokeVisibilityControl(strokeLabel, context) {
    const { unit, sortedStrokeLabels, existingMeasurements, strokesList } = context;
        
    // Initialize visibility if not set
    if (strokeVisibilityByImage[currentImageLabel] === undefined) {
      strokeVisibilityByImage[currentImageLabel] = {};
    }
    if (strokeVisibilityByImage[currentImageLabel][strokeLabel] === undefined) {
      strokeVisibilityByImage[currentImageLabel][strokeLabel] = true;
    }
            
    // Initialize label visibility if not set
    if (strokeLabelVisibility[currentImageLabel] === undefined) {
      strokeLabelVisibility[currentImageLabel] = {};
    }
    if (strokeLabelVisibility[currentImageLabel][strokeLabel] === undefined) {
      strokeLabelVisibility[currentImageLabel][strokeLabel] = true; // Labels visible by default
    }
            
    // Initialize measurement if not set
    if (window.strokeMeasurements[currentImageLabel] === undefined) {
      window.strokeMeasurements[currentImageLabel] = {};
      //             console.log(`[createStrokeVisibilityControl] Initializing empty measurements for ${currentImageLabel}`);
    }
            
    // ENHANCED preservation code: Check if measurement exists in the existing measurements
    if (existingMeasurements[strokeLabel]) {
      const existingMeasurement = existingMeasurements[strokeLabel];
      // More detailed check for valid measurement data
      if (existingMeasurement.inchWhole !== undefined || 
                    existingMeasurement.inchFraction !== undefined || 
                    existingMeasurement.cm !== undefined) {
                    
        // Use the existing measurement from before this function was called
        //                 console.log(`[createStrokeVisibilityControl] PRESERVING existing measurement for ${strokeLabel}:`, 
        //                         JSON.stringify(existingMeasurement));
                    
        // Ensure we're not losing data by making a deep copy
        window.strokeMeasurements[currentImageLabel][strokeLabel] = JSON.parse(JSON.stringify(existingMeasurement));
                    
        // Log successful preservation
        //                 console.log(`[createStrokeVisibilityControl] � Successfully preserved measurement for ${strokeLabel}`);
      } else {
        //                 console.log(`[createStrokeVisibilityControl] Found incomplete measurement for ${strokeLabel}:`, 
        //                         JSON.stringify(existingMeasurement));
      }
    }
    // Only set default if no measurement exists at all
    else if (window.strokeMeasurements[currentImageLabel][strokeLabel] === undefined) {
      window.strokeMeasurements[currentImageLabel][strokeLabel] = {
        inchWhole: 0,
        inchFraction: 0,
        cm: 0.0
      };
      //             console.log(`[createStrokeVisibilityControl] Setting default measurement for ${strokeLabel}`);
    } else {
      //             console.log(`[createStrokeVisibilityControl] Using existing measurement for ${strokeLabel}:`, 
      //                     JSON.stringify(window.strokeMeasurements[currentImageLabel][strokeLabel]));
    }
            
    const isVisible = strokeVisibilityByImage[currentImageLabel][strokeLabel];
    const isLabelVisible = strokeLabelVisibility[currentImageLabel][strokeLabel];
    const measurement = getMeasurementString(strokeLabel);
            
    // Check if this stroke is selected in the multi-selection array
    const isMultiSelected = multipleSelectedStrokesByImage[currentImageLabel].includes(strokeLabel);
    // Also check the legacy single selection for backward compatibility
    const isSingleSelected = selectedStrokeByImage[currentImageLabel] === strokeLabel;
    // Combined selection state
    const isSelected = isMultiSelected || isSingleSelected;
            
    // Check if this stroke is in edit mode
    const isInEditMode = window.selectedStrokeInEditMode === strokeLabel;
            
    const item = document.createElement('div');
    item.className = 'stroke-visibility-item';
    item.dataset.stroke = strokeLabel;
    item.dataset.selected = isSelected ? 'true' : 'false';
    item.dataset.editMode = isInEditMode ? 'true' : 'false';
            
    // Apply/Remove visual styling for edit mode
    if (isInEditMode) {
      //                 console.log(`Styling item ${strokeLabel} for edit mode.`);
      item.style.backgroundColor = '#FFF3E0';
      item.style.borderLeft = '5px solid #FF9800';
      item.style.boxShadow = '0 3px 8px rgba(255, 152, 0, 0.3)';
    } else {
      item.style.removeProperty('background-color');
      item.style.removeProperty('border-left');
      item.style.removeProperty('box-shadow');
    }
            
    // Make all parts of the item selectable (except checkbox and buttons)
    item.addEventListener('click', (e) => {
      console.log('🔄 [STROKE ITEM] Clicked:', strokeLabel, 'Target:', e.target.tagName, e.target.className);
                
      // Don't trigger selection if clicking a button or checkbox
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') {
        console.log('🔄 [STROKE ITEM] Click ignored - clicked on', e.target.tagName);
        return;
      }
                
      // Prevent event bubbling to canvas and stop default behavior
      e.preventDefault();
      e.stopPropagation();
                
      const clickedLabel = strokeLabel;
      console.log('🔄 [STROKE ITEM] Processing click for:', clickedLabel);
                
      // IMMEDIATE SINGLE-CLICK response - SIMPLIFIED (like canvas tag selection)
      // Clear edit mode if a different item is single-clicked
      if (window.selectedStrokeInEditMode && window.selectedStrokeInEditMode !== clickedLabel) {
        const prevEditItem = document.querySelector(`.stroke-visibility-item[data-stroke="${window.selectedStrokeInEditMode}"]`);
        if (prevEditItem) {
          prevEditItem.dataset.editMode = 'false';
          prevEditItem.style.removeProperty('background-color');
          prevEditItem.style.removeProperty('border-left');
          prevEditItem.style.removeProperty('box-shadow');
        }
        window.selectedStrokeInEditMode = null;
      }
                
      // Simple single selection (just like canvas tags)
      const currentSelection = [clickedLabel];
      window.selectedStrokeInEditMode = null; // Exit edit mode on new single selection
                
      console.log('🔄 [STROKE ITEM] Setting selection to:', currentSelection);
                
      // Update selection state immediately
      multipleSelectedStrokesByImage[currentImageLabel] = currentSelection;
      selectedStrokeByImage[currentImageLabel] = clickedLabel;
                
      console.log('🔄 [STROKE ITEM] Updated global state:', {
        multiple: multipleSelectedStrokesByImage[currentImageLabel],
        single: selectedStrokeByImage[currentImageLabel]
      });
                
      // Update UI to reflect selection immediately
      document.querySelectorAll('.stroke-visibility-item').forEach(el => {
        const sLabel = el.dataset.stroke;
        if (sLabel === clickedLabel) {
          el.dataset.selected = 'true';
          el.dataset.editMode = 'false'; // Clear edit mode for immediate selection
          console.log('🔄 [STROKE ITEM] Set selected=true for:', sLabel);
        } else {
          el.dataset.selected = 'false';
          el.dataset.editMode = 'false';
        }
      });
                
      console.log('🔄 [STROKE ITEM] Calling updateSelectionActionsPanel and redraw...');
                
      // Update UI immediately for snappy response
      updateSelectionActionsPanel();
      redrawCanvasWithVisibility();
                
      console.log('🔄 [STROKE ITEM] Click handling completed');
    });
            
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `visibility-${strokeLabel}`;
    checkbox.checked = isVisible;
    checkbox.addEventListener('change', () => toggleStrokeVisibility(strokeLabel, checkbox.checked));
            
    const labelContainer = document.createElement('div');
    labelContainer.className = 'stroke-label-container';
            
    // Find the stroke color from the undo stack or vector data
    let strokeColor = '#000';
    let strokeType = 'freehand'; // Default type
            
    if (vectorStrokesByImage[currentImageLabel] && 
                vectorStrokesByImage[currentImageLabel][strokeLabel]) {
      const vectorData = vectorStrokesByImage[currentImageLabel][strokeLabel];
      strokeColor = vectorData.color || '#000';
      strokeType = vectorData.type || 'freehand';
    } else {
      for (let i = undoStackByImage[currentImageLabel].length - 1; i >= 0; i--) {
        const action = undoStackByImage[currentImageLabel][i];
        if (action.label === strokeLabel && action.color) {
          strokeColor = action.color;
          // Try to determine stroke type from action
          if (action.type === 'line') {
            strokeType = 'straight';
          }
          break;
        }
      }
    }
            
    // Create the stroke name element with color matching the stroke
    const strokeName = document.createElement('span');
    strokeName.className = 'stroke-name';
    strokeName.textContent = strokeLabel;
    strokeName.style.borderColor = strokeColor;
    // Use matching text color for all colors except yellow/white which should be black for readability
    (function applyStrokeNameTextColor() {
      const c = (strokeColor || '').toLowerCase();
      const isWhite = c === '#ffffff' || c === 'white' || c === 'rgb(255, 255, 255)' || c === 'rgba(255, 255, 255, 1)';
      const isYellow = c === '#ffff00' || c === 'yellow' || c === 'rgb(255, 255, 0)' || c === 'rgba(255, 255, 0, 1)';
      const textColor = (isWhite || isYellow) ? '#000000' : strokeColor;
      strokeName.style.color = textColor;
    })();
    strokeName.setAttribute('data-original-name', strokeLabel); // Store original name

    // Make strokeName editable
    strokeName.contentEditable = 'false'; // Initially not editable
    strokeName.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent item selection click
      if (strokeName.contentEditable === 'true') return; // Already editing
      strokeName.contentEditable = 'true';
      strokeName.setAttribute('data-original-name', strokeName.textContent); // Update before editing
      strokeName.focus();
      document.execCommand('selectAll', false, null); // Select all text for easy replacement
    });

    strokeName.addEventListener('blur', (e) => {
      if (strokeName.contentEditable === 'true') {
        const originalName = strokeName.getAttribute('data-original-name');
        const newName = strokeName.textContent.trim();
        strokeName.contentEditable = 'false';
        if (newName && newName !== originalName) {
          const actualNewName = renameStroke(originalName, newName);
          // renameStroke updates global structures, updateStrokeVisibilityControls will redraw with actual name
          saveState(true, false, true);
          updateStrokeVisibilityControls(); // This will re-render the list
          redrawCanvasWithVisibility();
          // Update next tag display after renaming
          if (typeof window.updateNextTagDisplay === 'function') {
            window.updateNextTagDisplay();
          }
        } else {
          strokeName.textContent = originalName; // Revert if empty or unchanged
        }
      }
    });

    strokeName.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault(); // Prevent newline
        strokeName.blur(); // Trigger blur to save
      }
      if (e.key === 'Escape') {
        strokeName.textContent = strokeName.getAttribute('data-original-name');
        strokeName.contentEditable = 'false';
        strokeName.blur(); // Remove focus
      }
    });
            
    // Add a small icon to indicate stroke type (optional)
    if (strokeType === 'straight') {
      strokeName.title = 'Straight Line';
    } else {
      strokeName.title = 'Freehand Stroke';
    }
            
    // Make stroke name label clickable for selection as well
    strokeName.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent double handling with the item click
                
      // If already editing name, do nothing here (blur will handle save)
      if (strokeName.contentEditable === 'true') return; 

      const isCurrentlySelected = selectedStrokeByImage[currentImageLabel] === strokeLabel;
                
      if (isCurrentlySelected) {
        // If it's already selected, and we are clicking the name, 
        // it means we want to edit the name (handled by separate blur/keydown on strokeName)
        // or just re-affirm selection. For now, let selection logic be primary.
        // If measurement was active, this click doesn't change that.
      } else {
        selectedStrokeByImage[currentImageLabel] = strokeLabel; // Select
      }
                
      // Refresh the UI to reflect the new selection state
      updateStrokeVisibilityControls();
      redrawCanvasWithVisibility();
    });
            
    // Create measurement text
    const measureText = createEditableMeasureText(strokeLabel, isSelected, null);
            
    // Create edit button
    const editBtn = document.createElement('button');
    editBtn.className = 'stroke-edit-btn';
    editBtn.innerHTML = '�️';
    editBtn.title = 'Edit Stroke';
    editBtn.onclick = (e) => {
      e.stopPropagation(); // Prevent triggering the item's click event
      showStrokeEditDialog(strokeLabel, {
        showNameField: true,
        title: `Edit Stroke ${strokeLabel}`
      });
    };
            
    // Create delete button (x)
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'stroke-delete-btn';
    deleteBtn.innerHTML = '&times;';
    deleteBtn.title = 'Delete this stroke';
    deleteBtn.onclick = (e) => {
      e.stopPropagation(); // Prevent triggering the item's click event
      deleteStroke(strokeLabel);
    };
            
    // Create label toggle button
    const labelToggleBtn = document.createElement('button');
    labelToggleBtn.className = 'stroke-label-toggle-btn';
    // Use stable unicode for label/tag icon to avoid mojibake
    const tagIcon = '\uD83C\uDFF7\uFE0F';
    labelToggleBtn.textContent = tagIcon;
    labelToggleBtn.title = isLabelVisible ? 'Hide Label' : 'Show Label';
    labelToggleBtn.onclick = (e) => {
      e.stopPropagation();
      toggleLabelVisibility(strokeLabel);
    };
            
    labelContainer.appendChild(strokeName); // Add stroke name first
    labelContainer.appendChild(labelToggleBtn);

    // Correctly use the helper function for measureText
    const measureTextElement = createEditableMeasureText(strokeLabel, isSelected, labelContainer);
            
    // Make sure we only append if not already appended (which happens in createEditableMeasureText for newly created strokes)
    if (!measureTextElement.parentNode) {
      labelContainer.appendChild(measureTextElement);
    }
            
    // If this is the selected stroke or newly created stroke, focus on it
    // Check if this is the newly created stroke
    const isNewlyCreated = window.newlyCreatedStroke && 
                                  window.newlyCreatedStroke.label === strokeLabel && 
                                  window.newlyCreatedStroke.image === currentImageLabel &&
                                  (Date.now() - window.newlyCreatedStroke.timestamp) < 2000; // Within last 2 seconds
            
    // Only auto-focus for newly created strokes, not for existing selected strokes
    if (isNewlyCreated) {
      //             console.log(`[createStrokeVisibilityControl] Found newly created stroke ${strokeLabel}, will focus on it`);
      // Clear the flag so we don't focus multiple times in other functions
      window.newlyCreatedStroke = null;
                
      // Use setTimeout to ensure the DOM has been updated
      setTimeout(() => {
        if (document.body.contains(measureTextElement)) {
          //                     console.log(`[createStrokeVisibilityControl] Focusing on ${strokeLabel}`);
          measureTextElement.contentEditable = 'true';
          measureTextElement.dataset.originalMeasurementString = measureTextElement.textContent || '';
          measureTextElement.focus();
                        
          // Select all text
          const selection = window.getSelection();
          if (selection) {
            const range = document.createRange();
            range.selectNodeContents(measureTextElement);
            selection.removeAllRanges();
            selection.addRange(range);
          }
        }
      }, 0);
    }

    // Build the complete item
    item.appendChild(checkbox);
    item.appendChild(labelContainer);
    item.appendChild(deleteBtn);
            
    // Add to stroke list
    strokesList.appendChild(item);
        
    return item;
  }

  function updateStrokeVisibilityControls() {
    // IMPORTANT: Debug the current state of measurements
    //         console.log('[updateStrokeVisibilityControls] START - Current window.strokeMeasurements:',
    //             window.strokeMeasurements[currentImageLabel] ? JSON.stringify(window.strokeMeasurements[currentImageLabel]) : 'undefined');
        
    // Log the currently selected stroke and edit mode
    //         console.log(`[updateStrokeVisibilityControls] Initial state - selectedStroke: ${selectedStrokeByImage[currentImageLabel]}, multipleSelected: ${multipleSelectedStrokesByImage[currentImageLabel] ? JSON.stringify(multipleSelectedStrokesByImage[currentImageLabel]) : 'undefined'}, Edit mode: ${window.selectedStrokeInEditMode}`);

    // --- Synchronization Logic --- 
    const currentSelectionArray = multipleSelectedStrokesByImage[currentImageLabel] || [];
    if (currentSelectionArray.length === 1) {
      if (selectedStrokeByImage[currentImageLabel] !== currentSelectionArray[0]) {
        //                console.warn(`[updateStrokeVisibilityControls] Correcting selectedStrokeByImage. Was: ${selectedStrokeByImage[currentImageLabel]}, multiple was: ${JSON.stringify(currentSelectionArray)}. Setting to: ${currentSelectionArray[0]}`);
        selectedStrokeByImage[currentImageLabel] = currentSelectionArray[0];
      }
    } else if (currentSelectionArray.length > 1) {
      // If multiple are selected, ensure selectedStrokeByImage is one of them (e.g., the first) or null.
      // For simplicity, if it's not in the array, set it to the first element.
      if (!currentSelectionArray.includes(selectedStrokeByImage[currentImageLabel])) {
        console.warn(`[updateStrokeVisibilityControls] Correcting selectedStrokeByImage for multi-select. Was: ${selectedStrokeByImage[currentImageLabel]}, multiple was: ${JSON.stringify(currentSelectionArray)}. Setting to: ${currentSelectionArray[0] || null}`);
        selectedStrokeByImage[currentImageLabel] = currentSelectionArray[0] || null;
      }
    } else { // 0 selected in multipleSelectedStrokesByImage
      if (selectedStrokeByImage[currentImageLabel] !== null) {
        console.warn(`[updateStrokeVisibilityControls] Correcting selectedStrokeByImage. Was: ${selectedStrokeByImage[currentImageLabel]}, multiple was empty. Setting to: null`);
        selectedStrokeByImage[currentImageLabel] = null;
      }
    }
    //         console.log(`[updateStrokeVisibilityControls] State AFTER sync - selectedStroke: ${selectedStrokeByImage[currentImageLabel]}, multipleSelected: ${multipleSelectedStrokesByImage[currentImageLabel] ? JSON.stringify(multipleSelectedStrokesByImage[currentImageLabel]) : 'undefined'}`);
    // --- End Synchronization Logic ---

    const controlsContainer = document.getElementById('strokeVisibilityControls');
    controlsContainer.innerHTML = ''; // Clear existing controls
        
    // Add a separator at the top
    const topSeparator = document.createElement('hr');
    controlsContainer.appendChild(topSeparator);
        
    // Display current unit
    const unitDisplay = document.createElement('div');
    unitDisplay.className = 'current-unit-display';
    unitDisplay.textContent = `Current Unit: ${document.getElementById('unitSelector').value === 'inch' ? 'Inches' : 'Centimeters'}`;
    controlsContainer.appendChild(unitDisplay);
        
    // Add another separator
    const separator = document.createElement('hr');
    controlsContainer.appendChild(separator);
        
    // Create strokes list
    const strokesList = document.createElement('div');
    strokesList.id = 'strokesList';
    controlsContainer.appendChild(strokesList);
        
    // Get strokes for current image
    const strokes = lineStrokesByImage[currentImageLabel] || [];
        
    // Create a sorted array of stroke labels we can use for index-based operations
    const sortedStrokeLabels = Object.keys(lineStrokesByImage[currentImageLabel] || {});
        
    // Text elements section
    const textHeader = document.createElement('h4');
    textHeader.textContent = 'Text Elements';
    textHeader.style.margin = '10px 0 6px 0';
    textHeader.style.fontSize = '13px';
    textHeader.style.color = '#475569';
    strokesList.appendChild(textHeader);

    const currentLabel = window.paintApp.state.currentImageLabel || window.currentImageLabel || 'front';
    const textElementsByImage = window.paintApp.state.textElementsByImage || {};
    const textList = textElementsByImage[currentLabel] || [];
    if (textList.length === 0) {
      const p = document.createElement('p');
      p.textContent = 'No text elements';
      p.style.margin = '0 0 8px 0';
      strokesList.appendChild(p);
    } else {
      textList.forEach((el, idx) => {
        const item = document.createElement('div');
        item.className = 'stroke-visibility-item';
                
        // Visibility checkbox
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = el.visible !== false;
        checkbox.addEventListener('change', () => {
          el.visible = checkbox.checked;
          redrawCanvasWithVisibility();
        });
                
        // Background toggle checkbox
        const bgCheckbox = document.createElement('input');
        bgCheckbox.type = 'checkbox';
        bgCheckbox.checked = el.hasWhiteBackground === true;
        bgCheckbox.title = 'Toggle white background';
        bgCheckbox.style.marginLeft = '4px';
        bgCheckbox.addEventListener('change', () => {
          el.hasWhiteBackground = bgCheckbox.checked;
          try { saveState(true, false, false); } catch(_) {}
          redrawCanvasWithVisibility();
        });
                
        // Create input field for inline editing
        const labelEl = document.createElement('input');
        labelEl.type = 'text';
        labelEl.value = el.text || '';
        labelEl.style.marginLeft = '8px';
        labelEl.style.width = '120px'; // Fixed width instead of flex: 1
        labelEl.style.border = 'none';
        labelEl.style.background = 'transparent';
        labelEl.style.fontSize = '13px';
        labelEl.style.padding = '2px 4px';
        labelEl.title = 'Edit text here';
                
        // Save on blur or Enter
        labelEl.addEventListener('blur', () => {
          const newText = labelEl.value.trim();
          if (newText && newText !== el.text) {
            el.text = newText;
            try { saveState(true, false, false); } catch(_) {}
            try { redrawCanvasWithVisibility(); } catch(_) {}
          }
        });
                
        labelEl.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            labelEl.blur();
          } else if (ev.key === 'Escape') {
            labelEl.value = el.text;
            labelEl.blur();
          }
        });
                
        const del = document.createElement('button');
        del.textContent = '×';
        del.title = 'Delete text';
        del.addEventListener('click', () => {
          textList.splice(idx, 1);
          redrawCanvasWithVisibility();
          updateStrokeVisibilityControls();
          try { saveState(true, false, false); } catch(_) {}
        });
                
        item.appendChild(checkbox);
        item.appendChild(bgCheckbox);
        item.appendChild(labelEl);
        item.appendChild(del);
        strokesList.appendChild(item);
      });
    }

    // Divider before strokes
    const divider = document.createElement('hr');
    divider.style.margin = '10px 0';
    strokesList.appendChild(divider);
        
    if (strokes.length === 0) {
      const p2 = document.createElement('p');
      p2.textContent = 'No strokes to display';
      strokesList.appendChild(p2);
      return;
    }
        
    // Current unit
    const unit = document.getElementById('unitSelector').value;
        
    // Preserve existing stroke measurements before processing strokes
    const existingMeasurements = window.strokeMeasurements[currentImageLabel] || {};
    //         console.log('[updateStrokeVisibilityControls] Existing measurements:', JSON.stringify(existingMeasurements));
        
    // Initialize multi-selection array if needed
    if (!multipleSelectedStrokesByImage[currentImageLabel]) {
      multipleSelectedStrokesByImage[currentImageLabel] = [];
    }
        
    // Add stroke actions panel if any strokes are selected
    const selectedCount = multipleSelectedStrokesByImage[currentImageLabel].length;
    if (selectedCount > 0) {
      const actionsPanel = document.createElement('div');
      actionsPanel.className = 'stroke-actions-panel';
            
      // Empty action buttons container - we now use direct interaction with strokes
      const buttonsContainer = document.createElement('div');
      buttonsContainer.className = 'stroke-actions-buttons';
            
      actionsPanel.appendChild(buttonsContainer);
      strokesList.appendChild(actionsPanel);
    }
        
    // Create visibility toggle for each stroke using the extracted helper function
    const context = {
      unit,
      sortedStrokeLabels,
      existingMeasurements,
      strokesList
    };
        
    strokes.forEach(strokeLabel => {
      createStrokeVisibilityControl(strokeLabel, context);
    });
  }
    
  // Helper function to get dash pattern based on style and line width
  function getDashPattern(style, dashLength, gapLength, lineWidth = 1) {
    // Use a more generous base scale to make dashes more visible
    const baseScale = Math.max(2, lineWidth * 0.8);
        
    switch (style) {
      case 'solid':
        return [];
      case 'small':
        return [6 * baseScale, 4 * baseScale];
      case 'medium':
        return [12 * baseScale, 8 * baseScale];
      case 'large':
        return [20 * baseScale, 12 * baseScale];
      case 'dot-dash':
        return [4 * baseScale, 6 * baseScale, 12 * baseScale, 6 * baseScale];
      case 'custom':
        return [dashLength * baseScale, gapLength * baseScale];
      default:
        return [];
    }
  }

  // Helper function to update stroke type based on arrow settings
  function updateStrokeTypeBasedOnArrows(vectorData) {
    const hasArrows = vectorData.arrowSettings && (vectorData.arrowSettings.startArrow || vectorData.arrowSettings.endArrow);
        
    if (vectorData.type === 'straight' && hasArrows) {
      vectorData.type = 'arrow';
    } else if (vectorData.type === 'arrow' && !hasArrows) {
      vectorData.type = 'straight';
    } else if (vectorData.type === 'curved' && hasArrows) {
      vectorData.type = 'curved-arrow';
    } else if (vectorData.type === 'curved-arrow' && !hasArrows) {
      vectorData.type = 'curved';
    }
  }
    
  // Function to toggle label visibility on canvas
  function toggleLabelVisibility(strokeLabel) {
    // Only toggle the label visibility, not the stroke visibility
    strokeLabelVisibility[currentImageLabel][strokeLabel] = !strokeLabelVisibility[currentImageLabel][strokeLabel];
        
    // Update the UI button appearance
    const toggleBtn = document.querySelector(`.stroke-visibility-item[data-stroke="${strokeLabel}"] .stroke-label-toggle`);
    if (toggleBtn) {
      const isLabelVisible = strokeLabelVisibility[currentImageLabel][strokeLabel];
      toggleBtn.innerHTML = isLabelVisible ? '🏷️' : ' 🏷️ '; // Show label icon, strikethrough if hidden
      toggleBtn.title = isLabelVisible ? 'Hide Label' : 'Show Label';
      toggleBtn.classList.toggle('active', isLabelVisible);
    }
        
    // Redraw the canvas with updated label visibility
    // This should not affect the stroke visibility
    redrawCanvasWithVisibility();
  }
    
  // Function to update measurement input with selected stroke's value
  // Function to display a measurement edit dialog
  function showMeasurementDialog(strokeLabel) {
    // Create a modal overlay
    const overlay = document.createElement('div');
    overlay.className = 'measurement-overlay';
    document.body.appendChild(overlay);
        
    // Create a modal dialog
    const dialog = document.createElement('div');
    dialog.className = 'measurement-dialog';
        
    //         console.log(`[showMeasurementDialog] Opening for ${strokeLabel} in ${currentImageLabel} view`);
    //         console.log(`[showMeasurementDialog] Current window.strokeMeasurements:`, 
    //             JSON.stringify(window.strokeMeasurements[currentImageLabel]));
        
    // Get current measurement
    const measurement = window.strokeMeasurements[currentImageLabel]?.[strokeLabel] || {
      inchWhole: 0,
      inchFraction: 0,
      cm: 0.0
    };
    //         console.log(`[showMeasurementDialog] Using measurement:`, measurement);
        
    // Title
    const title = document.createElement('h3');
    title.textContent = `Edit Measurement for ${strokeLabel}`;
    dialog.appendChild(title);
        
    // Measurement inputs
    const inputsContainer = document.createElement('div');
    inputsContainer.className = 'measurement-dialog-inputs';
        
    // Inch inputs
    const inchContainer = document.createElement('div');
    inchContainer.className = 'inch-container';
        
    const inchLabel = document.createElement('div');
    inchLabel.textContent = 'Inches:';
    inchContainer.appendChild(inchLabel);
        
    const inchInputs = document.createElement('div');
    inchInputs.className = 'inch-inputs';
        
    const wholeInput = document.createElement('input');
    wholeInput.type = 'number';
    wholeInput.min = '0';
    wholeInput.value = measurement.inchWhole || 0;
    wholeInput.id = 'dialog-inch-whole';
        
    const fractionSelect = document.createElement('select');
    fractionSelect.id = 'dialog-inch-fraction';
    const fractions = [
      {value: '0', text: '0'},
      {value: '0.125', text: '1/8'},
      {value: '0.25', text: '1/4'},
      {value: '0.375', text: '3/8'},
      {value: '0.5', text: '1/2'},
      {value: '0.625', text: '5/8'},
      {value: '0.75', text: '3/4'},
      {value: '0.875', text: '7/8'}
    ];
        
    fractions.forEach(f => {
      const option = document.createElement('option');
      option.value = f.value;
      option.textContent = f.text;
      if (parseFloat(f.value) === measurement.inchFraction) {
        option.selected = true;
      }
      fractionSelect.appendChild(option);
    });
        
    inchInputs.appendChild(wholeInput);
    inchInputs.appendChild(fractionSelect);
    inchContainer.appendChild(inchInputs);
        
    // CM inputs
    const cmContainer = document.createElement('div');
    cmContainer.className = 'cm-container';
        
    const cmLabel = document.createElement('div');
    cmLabel.textContent = 'Centimeters:';
    cmContainer.appendChild(cmLabel);
        
    const cmInput = document.createElement('input');
    cmInput.type = 'number';
    cmInput.min = '0';
    cmInput.step = '0.1';
    cmInput.value = measurement.cm ? measurement.cm.toFixed(1) : '0.0';
    cmInput.id = 'dialog-cm';
    cmContainer.appendChild(cmInput);
        
    // Add inputs to container
    inputsContainer.appendChild(inchContainer);
    inputsContainer.appendChild(cmContainer);
    dialog.appendChild(inputsContainer);
        
    // Add buttons
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'button-container';
        
    const saveButton = document.createElement('button');
    saveButton.textContent = 'Save';
    saveButton.onclick = () => {
      // Get values from inputs
      const wholeValue = parseInt(wholeInput.value) || 0;
      const fractionValue = parseFloat(fractionSelect.value) || 0;
      const cmValue = parseFloat(cmInput.value) || 0;
            
      // Determine which unit was changed last and use that value
      const currentUnit = document.getElementById('unitSelector').value;
      let finalCmValue, finalInchWhole, finalInchFraction;
            
      if (currentUnit === 'inch') {
        finalInchWhole = wholeValue;
        finalInchFraction = fractionValue;
        finalCmValue = convertUnits('inch', wholeValue + fractionValue);
      } else {
        finalCmValue = cmValue;
        // Calculate inch equivalent
        const inches = convertUnits('cm', cmValue);
        finalInchWhole = Math.floor(inches);
        finalInchFraction = findClosestFraction(inches - finalInchWhole);
      }
            
      // Update the measurement
      if (window.strokeMeasurements[currentImageLabel] === undefined) {
        window.strokeMeasurements[currentImageLabel] = {};
      }
            
      // Add debug log before saving the measurement
      //             console.log(`[showMeasurementDialog] Saving measurement for ${strokeLabel} in ${currentImageLabel}:`, {
      //                 inchWhole: finalInchWhole,
      //                 inchFraction: finalInchFraction,
      //                 cm: finalCmValue
      //             });
            
      // Save only to window.strokeMeasurements
      window.strokeMeasurements[currentImageLabel][strokeLabel] = {
        inchWhole: finalInchWhole,
        inchFraction: finalInchFraction,
        cm: finalCmValue
      };
            
      // Add debug log to verify global state after saving
      //             console.log(`[showMeasurementDialog] Verification - window.strokeMeasurements[${currentImageLabel}]:`, 
      //                 JSON.stringify(window.strokeMeasurements[currentImageLabel]));
            
      // Close dialog
      document.body.removeChild(overlay);
            
      // Update the UI to reflect changes
      redrawCanvasWithVisibility();
      updateStrokeVisibilityControls();
            
      // Save state to ensure measurement is preserved (important!)
      saveState(true, false, true);
    };
        
    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel';
    cancelButton.onclick = () => {
      document.body.removeChild(overlay);
    };
        
    buttonContainer.appendChild(saveButton);
    buttonContainer.appendChild(cancelButton);
    dialog.appendChild(buttonContainer);
        
    overlay.appendChild(dialog);
  }
    
  // Helper function to find the closest fraction
  function findClosestFraction(fractionPart) {
    const fractions = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875];
    let closestFraction = 0;
    let minDiff = 1;
        
    for (const fraction of fractions) {
      const diff = Math.abs(fractionPart - fraction);
      if (diff < minDiff) {
        minDiff = diff;
        closestFraction = fraction;
      }
    }
        
    return closestFraction;
  }
    
  // Unified function that combines measurement and stroke name editing
  function showStrokeEditDialog(strokeLabel, options = {}) {
    // Default options
    const config = {
      showNameField: true,
      title: `Edit Stroke ${strokeLabel}`,
      onSave: null,  // Optional callback
      ...options
    };
        
    // Create a modal overlay
    const overlay = document.createElement('div');
    overlay.className = 'measurement-overlay';
    document.body.appendChild(overlay);
        
    // Create a modal dialog
    const dialog = document.createElement('div');
    dialog.className = 'measurement-dialog';
        
    // Get current measurements
    const measurement = window.strokeMeasurements[currentImageLabel]?.[strokeLabel] || {
      inchWhole: 0,
      inchFraction: 0,
      cm: 0.0
    };
        
    //         console.log(`[showStrokeEditDialog] Opening for ${strokeLabel} in ${currentImageLabel} view`);
    //         console.log(`[showStrokeEditDialog] Current window.strokeMeasurements:`, 
    //             JSON.stringify(window.strokeMeasurements[currentImageLabel]));
        
    // Title
    const title = document.createElement('h3');
    title.textContent = config.title;
    dialog.appendChild(title);
        
    // Create name edit field (if enabled)
    let nameInput = null;
    if (config.showNameField) {
      const nameContainer = document.createElement('div');
      nameContainer.className = 'name-container';
        
      const nameLabel = document.createElement('div');
      nameLabel.textContent = 'Label:';
      nameContainer.appendChild(nameLabel);
        
      nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.value = strokeLabel;
      nameInput.placeholder = 'Label';
      nameContainer.appendChild(nameInput);
        
      dialog.appendChild(nameContainer);
    }
        
    // Measurement inputs
    const inputsContainer = document.createElement('div');
    inputsContainer.className = 'measurement-dialog-inputs';
        
    // Inch inputs
    const inchContainer = document.createElement('div');
    inchContainer.className = 'inch-container';
        
    const inchLabel = document.createElement('div');
    inchLabel.textContent = 'Inches:';
    inchContainer.appendChild(inchLabel);
        
    const inchInputs = document.createElement('div');
    inchInputs.className = 'inch-inputs';
        
    const wholeInput = document.createElement('input');
    wholeInput.type = 'number';
    wholeInput.min = '0';
    wholeInput.value = measurement.inchWhole || 0;
    wholeInput.id = 'dialog-inch-whole';
        
    const fractionSelect = document.createElement('select');
    fractionSelect.id = 'dialog-inch-fraction';
    const fractions = [
      {value: '0', text: '0'},
      {value: '0.125', text: '1/8'},
      {value: '0.25', text: '1/4'},
      {value: '0.375', text: '3/8'},
      {value: '0.5', text: '1/2'},
      {value: '0.625', text: '5/8'},
      {value: '0.75', text: '3/4'},
      {value: '0.875', text: '7/8'}
    ];
        
    fractions.forEach(f => {
      const option = document.createElement('option');
      option.value = f.value;
      option.textContent = f.text;
      if (parseFloat(f.value) === measurement.inchFraction) {
        option.selected = true;
      }
      fractionSelect.appendChild(option);
    });
        
    inchInputs.appendChild(wholeInput);
    inchInputs.appendChild(fractionSelect);
    inchContainer.appendChild(inchInputs);
        
    // CM inputs
    const cmContainer = document.createElement('div');
    cmContainer.className = 'cm-container';
        
    const cmLabel = document.createElement('div');
    cmLabel.textContent = 'Centimeters:';
    cmContainer.appendChild(cmLabel);
        
    const cmInput = document.createElement('input');
    cmInput.type = 'number';
    cmInput.min = '0';
    cmInput.step = '0.1';
    cmInput.value = measurement.cm ? measurement.cm.toFixed(1) : '0.0';
    cmInput.id = 'dialog-cm';
    cmContainer.appendChild(cmInput);
        
    // Sync between inch and cm inputs
    wholeInput.addEventListener('change', () => {
      const wholeValue = parseInt(wholeInput.value) || 0;
      const fractionValue = parseFloat(fractionSelect.value) || 0;
      const cmValue = convertUnits('inch', wholeValue + fractionValue);
      cmInput.value = cmValue.toFixed(1);
    });
        
    fractionSelect.addEventListener('change', () => {
      const wholeValue = parseInt(wholeInput.value) || 0;
      const fractionValue = parseFloat(fractionSelect.value) || 0;
      const cmValue = convertUnits('inch', wholeValue + fractionValue);
      cmInput.value = cmValue.toFixed(1);
    });
        
    cmInput.addEventListener('change', () => {
      const cmValue = parseFloat(cmInput.value) || 0;
      const inches = convertUnits('cm', cmValue);
      const wholeValue = Math.floor(inches);
      const fractionValue = findClosestFraction(inches - wholeValue);
            
      wholeInput.value = wholeValue;
      fractionSelect.value = fractionValue.toString();
    });
        
    // Add inputs to container
    inputsContainer.appendChild(inchContainer);
    inputsContainer.appendChild(cmContainer);
    dialog.appendChild(inputsContainer);
        
    // Add buttons
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'button-container';
        
    const saveButton = document.createElement('button');
    saveButton.textContent = 'Save';
    saveButton.onclick = () => {
      // Get values
      const newName = nameInput ? nameInput.value.trim() : strokeLabel;
      const wholeValue = parseInt(wholeInput.value) || 0;
      const fractionValue = parseFloat(fractionSelect.value) || 0;
      const cmValue = parseFloat(cmInput.value) || 0;
            
      // Determine which unit was changed last and use that value
      const currentUnit = document.getElementById('unitSelector').value;
      let finalCmValue, finalInchWhole, finalInchFraction;
            
      if (currentUnit === 'inch') {
        finalInchWhole = wholeValue;
        finalInchFraction = fractionValue;
        finalCmValue = convertUnits('inch', wholeValue + fractionValue);
      } else {
        finalCmValue = cmValue;
        // Calculate inch equivalent
        const inches = convertUnits('cm', cmValue);
        finalInchWhole = Math.floor(inches);
        finalInchFraction = findClosestFraction(inches - finalInchWhole);
      }
            
      // Update name if changed and name field is shown
      let finalName = strokeLabel;
      if (config.showNameField && newName !== strokeLabel && newName !== '') {
        // The unique name generation is handled inside renameStroke
        finalName = renameStroke(strokeLabel, newName);
                
        // Show feedback if name was modified to make it unique
        if (finalName !== newName) {
          //                     console.log(`Stroke name automatically adjusted to ${finalName} to avoid duplicates`);
                    
          // Create and show a temporary notification
          const notification = document.createElement('div');
          notification.style.position = 'fixed';
          notification.style.bottom = '20px';
          notification.style.left = '50%';
          notification.style.transform = 'translateX(-50%)';
          notification.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
          notification.style.color = 'white';
          notification.style.padding = '10px 20px';
          notification.style.borderRadius = '4px';
          notification.style.zIndex = '10000';
          notification.textContent = `Renamed to ${finalName} to avoid duplicates`;
                    
          document.body.appendChild(notification);
                    
          // Remove after 3 seconds
          setTimeout(() => {
            document.body.removeChild(notification);
          }, 3000);
        }
      }
            
      // Ensure window.strokeMeasurements is properly initialized
      if (!window.strokeMeasurements[currentImageLabel]) {
        window.strokeMeasurements[currentImageLabel] = {};
      }
            
      // Save measurements
      window.strokeMeasurements[currentImageLabel][finalName] = {
        inchWhole: finalInchWhole,
        inchFraction: finalInchFraction,
        cm: finalCmValue
      };
            
      //             console.log(`[showStrokeEditDialog] Saved measurement for ${finalName}:`, 
      //                 window.strokeMeasurements[currentImageLabel][finalName]);
            
      // Call optional callback
      if (typeof config.onSave === 'function') {
        config.onSave(finalName);
      }
            
      // Close dialog
      document.body.removeChild(overlay);
            
      // Update UI and redraw
      updateStrokeVisibilityControls();
      redrawCanvasWithVisibility();
            
      // Update next tag display if stroke was renamed
      if (finalName !== strokeLabel && typeof window.updateNextTagDisplay === 'function') {
        window.updateNextTagDisplay();
      }
            
      // Save state to ensure measurements are preserved
      saveState(true, false, true);
    };
        
    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel';
    cancelButton.onclick = () => {
      document.body.removeChild(overlay);
    };
        
    buttonContainer.appendChild(saveButton);
    buttonContainer.appendChild(cancelButton);
    dialog.appendChild(buttonContainer);
        
    overlay.appendChild(dialog);
  }
    
  // Function to show edit dialog for a stroke (DEPRECATED - use showStrokeEditDialog)
  function showEditDialog(strokeLabel) {
    //         console.log('[DEPRECATED] showEditDialog is deprecated, use showStrokeEditDialog instead');
    return showStrokeEditDialog(strokeLabel, {
      showNameField: true,
      title: `Edit Stroke ${strokeLabel}`
    });
  }
    
  // Function to display a measurement edit dialog (DEPRECATED - use showStrokeEditDialog)
  function showMeasurementDialog(strokeLabel) {
    //         console.log('[DEPRECATED] showMeasurementDialog is deprecated, use showStrokeEditDialog instead');
    return showStrokeEditDialog(strokeLabel, {
      showNameField: false,
      title: `Edit Measurement for ${strokeLabel}`
    });
  }
    
  // Function to generate a unique stroke name
  function generateUniqueStrokeName(baseName) {
    // If the name is empty or undefined, use a default name
    if (!baseName || baseName.trim() === '') {
      baseName = 'A1';
    }
        
    // If the base name doesn't already exist, we can use it as is
    if (!lineStrokesByImage[currentImageLabel] || 
            !lineStrokesByImage[currentImageLabel].includes(baseName)) {
      return baseName;
    }
        
    // Name already exists, so we need to add a number
    // Extract the base part and any existing numbering
    const match = baseName.match(/^(.+?)(?:\((\d+)\))?$/);
    if (!match) {
      // If the regex didn't match for some reason, append (1) to the name
      return `${baseName}(1)`;
    }
        
    const base = match[1];
    let counter = 1;
        
    // If there was already a number, start from the next one
    if (match[2]) {
      counter = parseInt(match[2]) + 1;
    }
        
    // Keep incrementing until we find a unique name
    let newName;
    do {
      newName = `${base}(${counter})`;
      counter++;
    } while (lineStrokesByImage[currentImageLabel].includes(newName));
        
    return newName;
  }
    
  // Function to rename a stroke
  function renameStroke(oldName, newName) {
    if (oldName === newName) return;
        
    // Generate a unique name if needed - this ensures the new name won't conflict
    // with any existing stroke names, including itself
    const uniqueNewName = generateUniqueStrokeName(newName);
        
    // Find the stroke color from the undo stack or vector data to maintain color after rename
    let strokeColor = '#000';
    if (vectorStrokesByImage[currentImageLabel] && 
            vectorStrokesByImage[currentImageLabel][oldName]) {
      strokeColor = vectorStrokesByImage[currentImageLabel][oldName].color || '#000';
    } else {
      for (let i = undoStackByImage[currentImageLabel].length - 1; i >= 0; i--) {
        const action = undoStackByImage[currentImageLabel][i];
        if (action.label === oldName && action.color) {
          strokeColor = action.color;
          // Try to determine stroke type from action
          if (action.type === 'line') {
            strokeType = 'straight';
          }
          break;
        }
      }
    }
        
    // Update all relevant data structures
    if (lineStrokesByImage[currentImageLabel]) {
      const index = lineStrokesByImage[currentImageLabel].indexOf(oldName);
      if (index !== -1) {
        lineStrokesByImage[currentImageLabel][index] = uniqueNewName;
      }
    }
        
    // Update visibility
    if (strokeVisibilityByImage[currentImageLabel] && 
            strokeVisibilityByImage[currentImageLabel][oldName] !== undefined) {
      const isVisible = strokeVisibilityByImage[currentImageLabel][oldName];
      strokeVisibilityByImage[currentImageLabel][uniqueNewName] = isVisible;
      delete strokeVisibilityByImage[currentImageLabel][oldName];
    }
        
    // Update label visibility
    if (strokeLabelVisibility[currentImageLabel] && 
            strokeLabelVisibility[currentImageLabel][oldName] !== undefined) {
      const isLabelVisible = strokeLabelVisibility[currentImageLabel][oldName];
      strokeLabelVisibility[currentImageLabel][uniqueNewName] = isLabelVisible;
      delete strokeLabelVisibility[currentImageLabel][oldName];
    }
        
    // Update stroke data
    if (strokeDataByImage[currentImageLabel] && 
            strokeDataByImage[currentImageLabel][oldName]) {
      strokeDataByImage[currentImageLabel][uniqueNewName] = 
                strokeDataByImage[currentImageLabel][oldName];
      delete strokeDataByImage[currentImageLabel][oldName];
    }
        
    // Update vector data
    if (vectorStrokesByImage[currentImageLabel] && 
            vectorStrokesByImage[currentImageLabel][oldName]) {
      vectorStrokesByImage[currentImageLabel][uniqueNewName] = 
                vectorStrokesByImage[currentImageLabel][oldName];
      delete vectorStrokesByImage[currentImageLabel][oldName];
    }
        
    // Update measurements
    if (strokeMeasurements[currentImageLabel] && 
            strokeMeasurements[currentImageLabel][oldName]) {
      strokeMeasurements[currentImageLabel][uniqueNewName] = 
                strokeMeasurements[currentImageLabel][oldName];
      delete strokeMeasurements[currentImageLabel][oldName];
    }
        
    // Update custom label positions
    if (customLabelPositions[currentImageLabel] && 
            customLabelPositions[currentImageLabel][oldName]) {
      customLabelPositions[currentImageLabel][uniqueNewName] = 
                customLabelPositions[currentImageLabel][oldName];
      delete customLabelPositions[currentImageLabel][oldName];
    }
        
    // Update next label if needed
    if (labelsByImage[currentImageLabel] === oldName) {
      labelsByImage[currentImageLabel] = uniqueNewName;
    }
        
    // Update any references in the undo/redo stacks
    if (undoStackByImage[currentImageLabel]) {
      undoStackByImage[currentImageLabel].forEach(action => {
        if (action.label === oldName) {
          action.label = uniqueNewName;
        }
      });
    }
        
    if (redoStackByImage[currentImageLabel]) {
      redoStackByImage[currentImageLabel].forEach(action => {
        if (action.label === oldName) {
          action.label = uniqueNewName;
        }
      });
    }
        
    // Update selection states if the renamed stroke was selected
    if (selectedStrokeByImage[currentImageLabel] === oldName) {
      selectedStrokeByImage[currentImageLabel] = uniqueNewName;
    }
        
    if (multipleSelectedStrokesByImage[currentImageLabel] && 
            multipleSelectedStrokesByImage[currentImageLabel].includes(oldName)) {
      const index = multipleSelectedStrokesByImage[currentImageLabel].indexOf(oldName);
      multipleSelectedStrokesByImage[currentImageLabel][index] = uniqueNewName;
    }
        
    if (window.selectedStrokeInEditMode === oldName) {
      window.selectedStrokeInEditMode = uniqueNewName;
    }
        
    // Return the actual name used for the stroke (either the original or the uniquified version)
    return uniqueNewName;
  }
    
  // Function to toggle stroke visibility
  function toggleStrokeVisibility(strokeLabel, isVisible) {
    //         console.log(`Toggling visibility of stroke ${strokeLabel} to ${isVisible}`);
        
    // Update visibility state
    strokeVisibilityByImage[currentImageLabel][strokeLabel] = isVisible;
        
    // Make sure the stroke data is still available and not accidentally cleared
    if (isVisible) {
      // Initialize vectorStrokesByImage for this image if it doesn't exist
      if (!vectorStrokesByImage[currentImageLabel]) {
        vectorStrokesByImage[currentImageLabel] = {};
      }
            
      // If we're making a stroke visible, ensure we still have vector data
      if (!vectorStrokesByImage[currentImageLabel][strokeLabel]) {
        //                 console.log(`Vector data missing for ${strokeLabel}, attempting recovery`);
                
        // Try to recover vector data from the undo stack
        for (let i = undoStackByImage[currentImageLabel].length - 1; i >= 0; i--) {
          const action = undoStackByImage[currentImageLabel][i];
          if (action.label === strokeLabel) {
            if (action.vectorData) {
              vectorStrokesByImage[currentImageLabel][strokeLabel] = action.vectorData;
              //                             console.log(`Recovered vector data for ${strokeLabel}`);
              break;
            }
          }
        }
                
        // If we still couldn't recover the vector data, create a basic one
        // This is especially important for straight lines
        if (!vectorStrokesByImage[currentImageLabel][strokeLabel]) {
          //                     console.log(`Creating default vector data for ${strokeLabel}`);
                    
          // Look for color and properties in the undo stack
          let strokeColor = '#000000';
          let strokeWidth = 5;
          let isLine = false;
                    
          for (let i = undoStackByImage[currentImageLabel].length - 1; i >= 0; i--) {
            const action = undoStackByImage[currentImageLabel][i];
            if (action.label === strokeLabel) {
              if (action.color) strokeColor = action.color;
              if (action.width) strokeWidth = action.width;
              if (action.type === 'line' || action.type === 'straight') isLine = true;
              break;
            }
          }
                    
          // Create a simple vector representation (placeholder)
          vectorStrokesByImage[currentImageLabel][strokeLabel] = {
            points: isLine ? [{x: 0, y: 0}, {x: 1, y: 1}] : [{x: 0, y: 0}],
            color: strokeColor,
            width: strokeWidth,
            type: isLine ? 'straight' : 'freehand',
            dashSettings: { enabled: false, style: 'solid', pattern: [], dashLength: 5, gapLength: 5 } // Default dash settings
          };
                    
          // Clear stored centroid and fixed label positions for blank canvas when new drawing is made
          if (currentImageLabel === 'blank_canvas' && window.originalDrawingCentroids) {
            delete window.originalDrawingCentroids[currentImageLabel];
            console.log(`[Transform] Cleared stored centroid for ${currentImageLabel} - new drawing detected`);
                        
          }
        }
      }
    }

    // *** Add redraw call here ***
    redrawCanvasWithVisibility();
  }
    
  // Store for currently selected stroke in each image
  let selectedStrokeByImage = {};
    
  // Initialize stroke label visibility for each image (default to visible)
  IMAGE_LABELS.forEach(label => {
    strokeLabelVisibility[label] = {};
    selectedStrokeByImage[label] = null; // Initialize with no selection
        
    // CRITICAL FIX: Also initialize the global state version
    if (!window.paintApp.state.selectedStrokeByImage[label]) {
      window.paintApp.state.selectedStrokeByImage[label] = null;
    }
    if (!window.paintApp.state.multipleSelectedStrokesByImage[label]) {
      window.paintApp.state.multipleSelectedStrokesByImage[label] = [];
    }
  });
    
  // Store for label custom positions (user-dragged positions)
  let customLabelPositions = {};
    
  // Flag to track if we're dragging a label
  let isDraggingLabel = false;
  let draggedLabelStroke = null;
  let dragStartX = 0;
  let dragStartY = 0;
    
  // Text dragging state
  const TEXT_DRAG_THRESHOLD = 5;
  let textDragPending = false;
  let textDragPendingElement = null;
  let textDragStartCanvasX = 0;
  let textDragStartCanvasY = 0;
  let isDraggingTextElement = false;
  let draggedTextElement = null;
  let dragStartTextX = 0;
  let dragStartTextY = 0;
    
  // Initialize custom label positions for each image
  IMAGE_LABELS.forEach(label => {
    customLabelPositions[label] = {};
    if (!window.customLabelAbsolutePositions) window.customLabelAbsolutePositions = {};
    window.customLabelAbsolutePositions[label] = {}; // Initialize absolute positions for this image
  });
    
  // Cache for loaded images to prevent flickering
  const imageCache = {};
    
  // Store for label positions to prevent overlapping
  let currentLabelPositions = [];
    
  // Store for stroke paths to avoid overlapping with lines
  let currentStrokePaths = [];
    
  // Function to redraw canvas respecting stroke visibility
  // Make redrawCanvasWithVisibility available globally
  window.redrawCanvasWithVisibility = redrawCanvasWithVisibility;
  function redrawCanvasWithVisibility() {
    //        console.log(`--- redrawCanvasWithVisibility called for: ${currentImageLabel} ---`);
        
    // PERFORMANCE: Invalidate interactive element cache before redraw
    invalidateInteractiveElementCache();
        
    // Clear performance cache for new render cycle (if available)
    try {
      if (ARROW_PERFORMANCE_CACHE && ARROW_PERFORMANCE_CACHE.clearCache) {
        ARROW_PERFORMANCE_CACHE.clearCache();
      }
    } catch (e) {
      // ARROW_PERFORMANCE_CACHE not yet initialized, skip for now
    }
        
    // ADDED: Ensure originalImageDimensions exists and has an entry for this label
    if (!window.originalImageDimensions) {
      window.originalImageDimensions = {};
    }
        
    // ADDED: If we don't have dimensions for this label but we're trying to draw strokes,
    // create default dimensions based on the canvas size to prevent coordinates from being lost
    if (!window.originalImageDimensions[currentImageLabel] && 
            vectorStrokesByImage[currentImageLabel] && 
            Object.keys(vectorStrokesByImage[currentImageLabel]).length > 0) {
            
      //             console.log(`Creating default dimensions for ${currentImageLabel} to preserve strokes`);
      window.originalImageDimensions[currentImageLabel] = {
        width: canvas.width,
        height: canvas.height
      };
      //             console.log(`Set dimensions to match canvas: ${canvas.width}x${canvas.height}`);
    }
        
    // Reset label positions and stroke paths for this redraw
    currentLabelPositions = [];
    currentStrokePaths = [];
        
    // Create a copy of custom label positions for tracking which ones were actually used
    const usedCustomPositions = {};
        
    // Get current scale and position from stored values
    const scale = window.imageScaleByLabel[currentImageLabel] || 1.0;
    //         console.log(`[redrawCanvasWithVisibility] Using scale=${scale} for ${currentImageLabel}`);
        
    // Double-check scale against UI for consistency
    const scaleEl = document.getElementById('scaleButton');
    if (scaleEl) {
      const scaleText = scaleEl.textContent;
      const scaleMatch = scaleText.match(/Scale: (\d+)%/);
      if (scaleMatch && scaleMatch[1]) {
        const uiScale = parseInt(scaleMatch[1]) / 100;
        const scaleDifference = Math.abs(uiScale - scale);
        // Gate warning behind debug only to avoid noisy false-positives during strict mode
        if (scaleDifference > 0.01 && labelReprojectDebug()) {
          console.warn(`[redrawCanvasWithVisibility] WARNING: Scale mismatch! Variable: ${scale}, UI: ${uiScale}`);
        }
      }
    }
        
    const position = imagePositionByLabel[currentImageLabel] || { x: 0, y: 0 };
    //         console.log(`[redrawCanvasWithVisibility] Using position: x=${position.x}, y=${position.y} for ${currentImageLabel}`);
        
    // We need to rebuild the canvas from scratch using individual stroke data
    const strokes = lineStrokesByImage[currentImageLabel] || [];
        
    // Start with a blank canvas or the original image if available
    if (window.originalImages && window.originalImages[currentImageLabel]) {
      // Check if we already have this image in the cache
      const imageUrl = window.originalImages[currentImageLabel];
            
      if (imageCache[imageUrl]) {
        // Use cached image immediately
        const img = imageCache[imageUrl];
                
        // Calculate center of canvas for positioning
        const centerX = (canvas.width - img.width * scale) / 2;
        const centerY = (canvas.height - img.height * scale) / 2;
                
        // Get final position with offset
        const imageX = centerX + position.x;
        const imageY = centerY + position.y;
                
        drawImageAndStrokes(img, scale, imageX, imageY);
      } else {
        // Load the image and cache it
        const img = new Image();
        try { img.crossOrigin = 'anonymous'; } catch (_) {}
        img.onload = () => {
          // Add to cache
          imageCache[imageUrl] = img;
                    
          // Calculate center of canvas for positioning
          const centerX = (canvas.width - img.width * scale) / 2;
          const centerY = (canvas.height - img.height * scale) / 2;
                    
          // Get final position with offset
          const imageX = centerX + position.x;
          const imageY = centerY + position.y;
                    
          drawImageAndStrokes(img, scale, imageX, imageY);
        };
        img.src = imageUrl;
                
        // If the image is already cached in the browser, it might be immediately available
        if (img.complete) {
          imageCache[imageUrl] = img;
                    
          // Calculate center of canvas for positioning
          const centerX = (canvas.width - img.width * scale) / 2;
          const centerY = (canvas.height - img.height * scale) / 2;
                    
          // Get final position with offset
          const imageX = centerX + position.x;
          const imageY = centerY + position.y;
                    
          drawImageAndStrokes(img, scale, imageX, imageY);
        } else {
          // If the image isn't immediately available,
          // still draw the strokes on a blank canvas so they don't disappear
          ctx.clearRect(0, 0, canvas.width, canvas.height);
                    
          // Use default scale and center position when no image is available yet
          const canvasCenterX = canvas.width / 2;
          const canvasCenterY = canvas.height / 2;
          applyVisibleStrokes(scale, canvasCenterX + position.x, canvasCenterY + position.y);
        }
      }
    } else {
      // Otherwise start with a blank canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);
            
      // Fill entire canvas with light gray background
      ctx.fillStyle = '#f8f9fa';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
            
      // Draw centered 4:3 drawing frame (like a mat board)
      const aspectRatio = 4 / 3;
      let frameWidth, frameHeight;
            
      // Calculate 4:3 frame that fits within canvas
      if (canvas.width / canvas.height > aspectRatio) {
        // Canvas is wider than 4:3, constrain by height
        frameHeight = canvas.height;
        frameWidth = frameHeight * aspectRatio;
      } else {
        // Canvas is taller than 4:3, constrain by width
        frameWidth = canvas.width;
        frameHeight = frameWidth / aspectRatio;
      }
            
      // Center the frame
      const frameX = (canvas.width - frameWidth) / 2;
      const frameY = (canvas.height - frameHeight) / 2;
            
      // Draw white drawing area
      ctx.fillStyle = 'white';
      ctx.fillRect(frameX, frameY, frameWidth, frameHeight);
            
      // Optional: Draw border around frame
      ctx.strokeStyle = '#dee2e6';
      ctx.lineWidth = 2;
      ctx.strokeRect(frameX, frameY, frameWidth, frameHeight);
            
      // Use default scale and center position when no image
      const canvasCenterX = canvas.width / 2;
      const canvasCenterY = canvas.height / 2;
            
      // Apply the position offset to the center coordinates
      const imageX = canvasCenterX + position.x;
      const imageY = canvasCenterY + position.y;
            
      applyVisibleStrokes(scale, imageX, imageY);
            
      // Draw text elements even when no image is loaded
      try {
        const currentLabelForText = window.paintApp.state.currentImageLabel || window.currentImageLabel || 'front';
        const textElementsByImage = window.paintApp.state.textElementsByImage || {};
        const textList = textElementsByImage[currentLabelForText] || [];
        
        console.log('[TEXT DEBUG] Current label for rendering:', currentLabelForText);
        console.log('[TEXT DEBUG] window.currentImageLabel:', window.currentImageLabel);  
        console.log('[TEXT DEBUG] paintApp.state.currentImageLabel:', window.paintApp.state.currentImageLabel);
        console.log('[TEXT DEBUG] Text elements by image keys:', Object.keys(textElementsByImage));
        console.log('[TEXT DEBUG] Text list length for', currentLabelForText + ':', textList.length);
        if (Object.keys(textElementsByImage).length > 0) {
          Object.keys(textElementsByImage).forEach(key => {
            console.log('[TEXT DEBUG] Label', key, 'has', textElementsByImage[key].length, 'text elements');
          });
        }
        if (Array.isArray(textList) && textList.length > 0) {
          const ctxText = ctx;
          textList.forEach(el => {
            if (!el || el.visible === false || typeof el.text !== 'string') return;
                        
            // Apply coordinate transformation to handle image rotation and scaling
            // Convert from image space to canvas space using the transformation system
            let canvasCoords;
            const transformParams = getTransformationParams(currentLabelForText);
            
            console.log('[TEXT TRANSFORM DEBUG] Element:', el.id, 'useCanvasCoords:', el.useCanvasCoords);
            console.log('[TEXT TRANSFORM DEBUG] Original coords:', el.x, el.y);
            console.log('[TEXT TRANSFORM DEBUG] Transform params:', {
              rotation: transformParams.rotation,
              scale: transformParams.scale,
              hasImage: transformParams.hasImage
            });
            
            if (el.useCanvasCoords) {
              // For elements created in canvas coordinates, we need to handle rotation
              if (transformParams.rotation !== 0) {
                // Apply rotation around canvas center for text elements
                const canvasCenterX = canvas.width / 2;
                const canvasCenterY = canvas.height / 2;
                
                // Get position relative to canvas center
                const dx = el.x - canvasCenterX;
                const dy = el.y - canvasCenterY;
                
                // Apply rotation around center
                const cos = Math.cos(transformParams.rotation);
                const sin = Math.sin(transformParams.rotation);
                const rotatedX = dx * cos - dy * sin;
                const rotatedY = dx * sin + dy * cos;
                
                // Convert back to canvas coordinates
                canvasCoords = {
                  x: canvasCenterX + rotatedX,
                  y: canvasCenterY + rotatedY
                };
                console.log('[TEXT TRANSFORM DEBUG] Direct rotation around center:', el.x, el.y, '->', canvasCoords.x.toFixed(1), canvasCoords.y.toFixed(1));
              } else {
                // No rotation, use coordinates directly
                canvasCoords = { x: el.x, y: el.y };
                console.log('[TEXT TRANSFORM DEBUG] No rotation, using direct coords:', canvasCoords.x, canvasCoords.y);
              }
            } else {
              // For elements created in image space, transform to canvas space
              canvasCoords = imageToCanvasCoords(el.x, el.y, transformParams);
              console.log('[TEXT TRANSFORM DEBUG] Image->Canvas:', el.x, el.y, '->', canvasCoords.x, canvasCoords.y);
            }
                        
            ctxText.save();
                    
            // CRITICAL: Lock canvas text state to prevent inheritance from previous drawing operations
            ctxText.setTransform(1, 0, 0, 1, 0, 0); // Reset any transforms
            ctxText.textAlign = 'left';              // Ensure left alignment (not center/right)
            ctxText.textBaseline = 'top';            // Ensure top baseline
            ctxText.direction = 'ltr';               // Left-to-right
                    
            console.log('[RENDER TEXT DEBUG 1]', {
              id: el.id,
              useCanvasCoords: el.useCanvasCoords,
              savedCoords: { x: el.x, y: el.y },
              canvasCoords: { x: canvasCoords.x, y: canvasCoords.y },
              savedSize: { width: el.width, height: el.height }
            });
                    
            // Saved coordinates and dimensions represent the wrapper box (including border)
            // Use saved values from preview to ensure exact match (no hardcoded values)
            const wrapperWidth = el.width || 154;
            const wrapperHeight = el.height || 44;
            const padding = el.padding !== undefined ? el.padding : 8;
            const borderWidth = el.borderWidth !== undefined ? el.borderWidth : 2;
                    
            // Draw border (the wrapper's border)
            ctxText.strokeStyle = '#3b82f6';
            ctxText.lineWidth = borderWidth;
            ctxText.strokeRect(
              canvasCoords.x + borderWidth/2,
              canvasCoords.y + borderWidth/2,
              wrapperWidth - borderWidth,
              wrapperHeight - borderWidth
            );
                    
            // Draw white background if enabled (inside the border, this is where textBox background would be)
            if (el.hasWhiteBackground) {
              ctxText.fillStyle = 'rgba(255, 255, 255, 0.95)';
              ctxText.fillRect(
                canvasCoords.x + borderWidth,
                canvasCoords.y + borderWidth,
                wrapperWidth - borderWidth * 2,
                wrapperHeight - borderWidth * 2
              );
              console.log('[RENDER BG 1]', { 
                x: canvasCoords.x + borderWidth, 
                y: canvasCoords.y + borderWidth,
                w: wrapperWidth - borderWidth * 2,
                h: wrapperHeight - borderWidth * 2
              });
            }
                    
            // Draw text with padding inside the box (using saved computed styles)
            // Build font string with weight to match preview exactly
            const fontWeight = el.fontWeight || 'normal';
            ctxText.font = `${fontWeight} ${el.fontSize || 16}px ${el.fontFamily || 'Arial, sans-serif'}`;
            ctxText.fillStyle = el.color || '#1f2937';
                    
            // Apply letter spacing if supported (modern browsers)
            if (el.letterSpacing && el.letterSpacing !== 'normal') {
              ctxText.letterSpacing = el.letterSpacing;
            }
                    
            // Available width for text = wrapper width - (border on each side) - (padding on each side)
            const maxWidth = Math.max(20, wrapperWidth - borderWidth * 2 - padding * 2);
            // Use saved line height if available, otherwise calculate from fontSize
            const lineHeight = el.lineHeight && el.lineHeight !== 'normal' ? 
              parseFloat(el.lineHeight) : 
              Math.round((el.fontSize || 16) * 1.2);
            const lines = wrapCanvasText(ctxText, el.text, maxWidth);
            const totalHeight = lines.length * lineHeight;
                    
            // Text starts at: wrapper left + border width + padding
            const textStartX = canvasCoords.x + borderWidth + padding;
            const textStartY = canvasCoords.y + borderWidth + padding;
                    
            console.log('[RENDER TEXT 1]', { 
              x: textStartX, 
              y: textStartY, 
              maxWidth, 
              lines: lines.length,
              wrapperWidth,
              availableWidth: wrapperWidth - borderWidth * 2 - padding * 2
            });
                    
            let drawY = textStartY;
            lines.forEach(line => {
              ctxText.fillText(line, textStartX, drawY, maxWidth);
              drawY += lineHeight;
            });
            ctxText.restore();
          });
        }
      } catch (_) {}
    }
  }
        
  // Function to draw the image and apply strokes
  function drawImageAndStrokes(img, scale, imageX, imageY) {
    //         console.log(`[drawImageAndStrokes] Called with scale=${scale}`);
    //         console.log(`[drawImageAndStrokes] Current window.imageScaleByLabel[${currentImageLabel}] = ${window.imageScaleByLabel[currentImageLabel]}`);
            
    // CRITICAL FIX: Ensure scale parameter matches the global scale value
    if (scale !== window.imageScaleByLabel[currentImageLabel]) {
      if (window.__DEBUG__) console.warn(`[drawImageAndStrokes] Scale mismatch. Param=${scale} global=${window.imageScaleByLabel[currentImageLabel]}. Correcting.`);
      scale = window.imageScaleByLabel[currentImageLabel]; // Use the global scale value always
            
      // Recalculate image position based on correct scale
      const centerX = (canvas.width - img.width * scale) / 2;
      const centerY = (canvas.height - img.height * scale) / 2;
      const position = imagePositionByLabel[currentImageLabel] || { x: 0, y: 0 };
      imageX = centerX + position.x;
      imageY = centerY + position.y;
    }
        
    // Stamp the active transform used for this draw and update session stability
    try {
      const params = getTransformationParams(currentImageLabel);
      const thash = getTransformHash(params);
      window.__activeDrawMatrixHashByLabel[currentImageLabel] = thash;
      window.__lastActiveDrawParamsByLabel[currentImageLabel] = params;
      // compute anchor hash for stability checks
      const ahash = computeAnchorHash(currentImageLabel);
      if (window.__lastAnchorHashByLabel[currentImageLabel] !== ahash) {
        window.__anchorsVersionByLabel[currentImageLabel] = (window.__anchorsVersionByLabel[currentImageLabel] || 0) + 1;
        window.__lastAnchorHashByLabel[currentImageLabel] = ahash;
      }
      onSessionDrawTick(currentImageLabel, thash, window.__lastAnchorHashByLabel[currentImageLabel]);
      if (labelReprojectDebug()) console.log('[XFORM] activeDrawHash=', thash, 'anchorsVer=', window.__anchorsVersionByLabel[currentImageLabel]||0);
    } catch (_) {}
        
    // Clear the canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Ensure opaque white background so saved/loaded images don't have transparency outside the image
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Get dimensions
    const imgWidth = img.width;
    const imgHeight = img.height;
        
    // Calculate scaled dimensions
    const scaledWidth = imgWidth * scale;
    const scaledHeight = imgHeight * scale;
        
    // Attempt to commit any pending reprojection now that the active draw transform is stamped
    try { if (labelReprojectEnabled()) tryCommitPendingReprojectionForLabel(currentImageLabel); } catch(_) {}
        
    // Check if there's rotation to apply
    const rotation = window.imageRotationByLabel ? (window.imageRotationByLabel[currentImageLabel] || 0) : 0;
        
    if (rotation !== 0) {
      // Save context state
      ctx.save();
            
      // Calculate center of the image for rotation
      const imageCenterX = imageX + scaledWidth / 2;
      const imageCenterY = imageY + scaledHeight / 2;
            
      // Apply rotation transformation
      ctx.translate(imageCenterX, imageCenterY);
      ctx.rotate(rotation);
      ctx.translate(-imageCenterX, -imageCenterY);
            
      // Draw the image with rotation, scaling and positioning
      ctx.drawImage(img, imageX, imageY, scaledWidth, scaledHeight);
            
      // Apply visible strokes and labels WITHIN the rotated coordinate system
      // IMPORTANT: Since the canvas context is rotated here, avoid applying rotation again in math
      // by signaling applyVisibleStrokes that the context is already rotated
      applyVisibleStrokes(scale, imageX, imageY, true);
            
      // Restore context state after drawing everything
      ctx.restore();
    } else {
      // Draw the image without rotation
      ctx.drawImage(img, imageX, imageY, scaledWidth, scaledHeight);
            
      // Apply visible strokes and labels normally (no rotation)
      applyVisibleStrokes(scale, imageX, imageY);
    }

    // After strokes, draw text elements for the current image
    try {
      const currentLabelForText = window.paintApp.state.currentImageLabel || window.currentImageLabel || 'front';
      const textElementsByImage = window.paintApp.state.textElementsByImage || {};
      const textList = textElementsByImage[currentLabelForText] || [];
      if (Array.isArray(textList) && textList.length > 0) {
        const ctxText = ctx;
        textList.forEach(el => {
          if (!el || el.visible === false || typeof el.text !== 'string') return;
                    
          // Use canvas coordinates directly (no transformation)
          // This ensures text appears exactly where it was placed
          const canvasCoords = el.useCanvasCoords ? 
            { x: el.x, y: el.y } : 
            (window.worldToClient ? window.worldToClient(el.x, el.y) : { x: el.x, y: el.y });
                    
          // Debug rotation info
          const currentLabel = window.paintApp.state.currentImageLabel || window.currentImageLabel || 'front';
          const rotationValue = window.imageRotationByLabel ? (window.imageRotationByLabel[currentLabel] || 0) : 0;
          const rotationDegrees = (rotationValue * 180 / Math.PI).toFixed(1);
          
          console.log('[RENDER TEXT DEBUG] Element:', el.id, 'stored coords:', {x: el.x, y: el.y}, 'canvas coords:', canvasCoords, 'size:', {width: el.width, height: el.height});
          console.log('[RENDER TEXT DEBUG] Rotation debug:', {
            currentLabel: currentLabel,
            textLabel: currentLabelForText,
            rotationRadians: rotationValue,
            rotationDegrees: rotationDegrees,
            useCanvasCoords: el.useCanvasCoords,
            imageRotationByLabel: window.imageRotationByLabel
          });
                    
          ctxText.save();
                    
          // CRITICAL: Lock canvas text state to prevent inheritance from previous drawing operations
          ctxText.setTransform(1, 0, 0, 1, 0, 0); // Reset any transforms
          ctxText.textAlign = 'left';              // Ensure left alignment (not center/right)
          ctxText.textBaseline = 'top';            // Ensure top baseline
          ctxText.direction = 'ltr';               // Left-to-right
                    
          // Debug: Log current text rendering state
          if (window.__TEXT_DEBUG) {
            const transform = ctxText.getTransform?.() || { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
            console.log('[TEXT STATE]', {
              textAlign: ctxText.textAlign,
              textBaseline: ctxText.textBaseline,
              direction: ctxText.direction,
              transform: { a: transform.a, b: transform.b, c: transform.c, d: transform.d, e: transform.e, f: transform.f }
            });
          }
                    
          // Saved coordinates and dimensions represent the wrapper box (including border)
          // Use saved values from preview to ensure exact match (no hardcoded values)
          const wrapperWidth = el.width || 154;
          const wrapperHeight = el.height || 44;
          const padding = el.padding !== undefined ? el.padding : 8;
          const borderWidth = el.borderWidth !== undefined ? el.borderWidth : 2;
                    
          // Saved x,y represent the outer edge of the container (including border)
          // The border is drawn with its stroke centered on the rectangle edge
          // So we need to inset by borderWidth/2 to keep it inside the container bounds
                    
          // Draw border (the wrapper's border) using fillRect for precise pixel control
          ctxText.fillStyle = '#3b82f6';
          // Top border
          ctxText.fillRect(canvasCoords.x, canvasCoords.y, wrapperWidth, borderWidth);
          // Bottom border
          ctxText.fillRect(canvasCoords.x, canvasCoords.y + wrapperHeight - borderWidth, wrapperWidth, borderWidth);
          // Left border
          ctxText.fillRect(canvasCoords.x, canvasCoords.y, borderWidth, wrapperHeight);
          // Right border
          ctxText.fillRect(canvasCoords.x + wrapperWidth - borderWidth, canvasCoords.y, borderWidth, wrapperHeight);
                    
          // Draw white background if enabled (inside the border)
          if (el.hasWhiteBackground) {
            ctxText.fillStyle = 'rgba(255, 255, 255, 0.95)';
            ctxText.fillRect(
              canvasCoords.x + borderWidth,
              canvasCoords.y + borderWidth,
              wrapperWidth - borderWidth * 2,
              wrapperHeight - borderWidth * 2
            );
          }
                    
          // Draw text with padding inside the box (using saved computed styles)
          // Build font string with weight to match preview exactly
          const fontWeight = el.fontWeight || 'normal';
          ctxText.font = `${fontWeight} ${el.fontSize || 16}px ${el.fontFamily || 'Arial, sans-serif'}`;
          ctxText.fillStyle = el.color || '#1f2937';
                    
          // Apply letter spacing if supported (modern browsers)
          if (el.letterSpacing && el.letterSpacing !== 'normal') {
            ctxText.letterSpacing = el.letterSpacing;
          }
                    
          // Available width for text = wrapper width - (border on each side) - (padding on each side)
          const maxWidth = Math.max(20, wrapperWidth - borderWidth * 2 - padding * 2);
          // Use saved line height if available, otherwise calculate from fontSize
          const lineHeight = el.lineHeight && el.lineHeight !== 'normal' ? 
            parseFloat(el.lineHeight) : 
            Math.round((el.fontSize || 16) * 1.2);
          const lines = wrapCanvasText(ctxText, el.text, maxWidth);
          const totalHeight = lines.length * lineHeight;
                    
          // Text starts at: wrapper left + border width + padding
          const textStartX = canvasCoords.x + borderWidth + padding;
          const textStartY = canvasCoords.y + borderWidth + padding;
                    
          // Debug: Draw red guide line at text start X
          if (window.__TEXT_DEBUG) {
            ctxText.save();
            ctxText.strokeStyle = 'red';
            ctxText.lineWidth = 1;
            ctxText.setLineDash([5, 5]);
            ctxText.beginPath();
            ctxText.moveTo(textStartX, canvasCoords.y);
            ctxText.lineTo(textStartX, canvasCoords.y + wrapperHeight);
            ctxText.stroke();
            ctxText.setLineDash([]);
            ctxText.restore();
                        
            console.log('[TEXT POSITION]', {
              canvasX: canvasCoords.x,
              borderWidth,
              padding,
              textStartX,
              calculation: `${canvasCoords.x} + ${borderWidth} + ${padding} = ${textStartX}`
            });
          }
                    
          let drawY = textStartY;
          lines.forEach(line => {
            ctxText.fillText(line, textStartX, drawY, maxWidth);
            drawY += lineHeight;
          });
          ctxText.restore();
        });
      }
    } catch (_) {}
  }
        
  // Function to apply visible strokes - moved outside redrawCanvasWithVisibility to be globally accessible
  function drawSingleStroke(ctx, strokeLabel, vectorData, scale, imageX, imageY, currentImageLabel, isBlankCanvas, canvasCenter) {
    // Get transformation parameters for this image
    const transformParams = getTransformationParams(currentImageLabel);
    
    // Debug: Log transformation parameters for strokes
    if (Math.abs(transformParams.rotation) > 0.1) {
      console.log(`[STROKE-PARAMS] ${strokeLabel} - Scale:${transformParams.scale} Rotation:${(transformParams.rotation * 180 / Math.PI).toFixed(1)}° Position:(${transformParams.position.x},${transformParams.position.y}) Dimensions:${transformParams.dimensions.width}x${transformParams.dimensions.height}`);
    }
            
    // Transform the first point using unified coordinate system
    const firstPoint = vectorData.points[0];
    const transformedFirst = imageToCanvasCoords(firstPoint.x, firstPoint.y, transformParams);
    let transformedFirstX = transformedFirst.x;
    let transformedFirstY = transformedFirst.y;
            
    // Check if this is an arrow line and pre-calculate adjusted points
    const isArrowLine = vectorData.type === 'arrow' || (vectorData.type === 'straight' && vectorData.arrowSettings && (vectorData.arrowSettings.startArrow || vectorData.arrowSettings.endArrow));
    let actualStartX = transformedFirstX;
    let actualStartY = transformedFirstY;
    let originalStartPoint = {x: transformedFirstX, y: transformedFirstY};
    let originalEndPoint = null;
            
    if (isArrowLine && vectorData.points.length >= 2) {
      // Calculate the transformed end point using unified coordinate system
      const lastPoint = vectorData.points[vectorData.points.length - 1];
      const transformedLast = imageToCanvasCoords(lastPoint.x, lastPoint.y, transformParams);
      const transformedLastX = transformedLast.x;
      const transformedLastY = transformedLast.y;
                
      originalEndPoint = {x: transformedLastX, y: transformedLastY};
                
      // Calculate adjusted start and end points for the line shaft
      if (vectorData.arrowSettings) {
        const brushSizeForStroke = vectorData.width || 5;
        const baseArrowSize = Math.max(vectorData.arrowSettings.arrowSize || (brushSizeForStroke * 2), brushSizeForStroke * 2);
        const scaledArrowSize = baseArrowSize * scale;
                    
        // Calculate line direction
        const dx = originalEndPoint.x - originalStartPoint.x;
        const dy = originalEndPoint.y - originalStartPoint.y;
        const lineLength = Math.sqrt(dx * dx + dy * dy);
                    
        if (lineLength > 0) {
          const unitX = dx / lineLength;
          const unitY = dy / lineLength;
          const shortening = scaledArrowSize * 0.8; // How much to shorten from each end
                        
          // Adjust start point if start arrow is enabled
          if (vectorData.arrowSettings.startArrow) {
            actualStartX = originalStartPoint.x + shortening * unitX;
            actualStartY = originalStartPoint.y + shortening * unitY;
          }
        }
      }
    }
            
    const strokePath = [];
            
    // Save the current context state before applying clipping
    ctx.save();
            
    // For blank canvas mode, clip drawing to canvas boundaries to prevent overflow on large monitors
    if (isBlankCanvas) {
      ctx.beginPath();
      ctx.rect(0, 0, canvas.width, canvas.height);
      ctx.clip();
      console.log(`[Clip] Applied viewport clipping: 0,0 to ${canvas.width},${canvas.height} for stroke ${strokeLabel}`);
    }
            
    ctx.beginPath();
    ctx.moveTo(actualStartX, actualStartY);
    strokePath.push({x: actualStartX, y: actualStartY});
            
    if (isBlankCanvas) {
      console.log(`[Clip] Drawing stroke ${strokeLabel} starting at (${actualStartX.toFixed(1)}, ${actualStartY.toFixed(1)})`);
    }
            
    // Check if this is a straight line
    const isStraightLine = vectorData.type === 'straight' || 
                (vectorData.points.length === 2 && !vectorData.type);
            
    // Check if this is a curved line
    const isCurvedLine = vectorData.type === 'curved' || vectorData.type === 'curved-arrow';
            
    // Check if this is a curved arrow specifically
    const isCurvedArrow = vectorData.type === 'curved-arrow';
            
    if (isArrowLine && vectorData.points.length >= 2) {
      // For arrow lines, use the pre-calculated original end point and calculate adjusted end point
      let adjustedEndX = originalEndPoint.x;
      let adjustedEndY = originalEndPoint.y;
                
      if (vectorData.arrowSettings) {
        // Get arrow settings to calculate end point adjustment
        const brushSizeForStroke = vectorData.width || 5;
        const baseArrowSize = Math.max(vectorData.arrowSettings.arrowSize || (brushSizeForStroke * 2), brushSizeForStroke * 2);
        const scaledArrowSize = baseArrowSize * scale;
                    
        // Calculate line direction
        const dx = originalEndPoint.x - originalStartPoint.x;
        const dy = originalEndPoint.y - originalStartPoint.y;
        const lineLength = Math.sqrt(dx * dx + dy * dy);
                    
        if (lineLength > 0) {
          const unitX = dx / lineLength;
          const unitY = dy / lineLength;
          const shortening = scaledArrowSize * 0.8; // How much to shorten from each end
                        
          // Shorten line from end if end arrow is enabled
          if (vectorData.arrowSettings.endArrow) {
            adjustedEndX = originalEndPoint.x - shortening * unitX;
            adjustedEndY = originalEndPoint.y - shortening * unitY;
          }
        }
      }
                
      // Draw line to adjusted end point
      ctx.lineTo(adjustedEndX, adjustedEndY);
      strokePath.push({x: adjustedEndX, y: adjustedEndY});
                
      // Store the original endpoints for arrowhead drawing (with safety check)
      if (originalStartPoint && originalEndPoint) {
        strokePath.originalStart = originalStartPoint;
        strokePath.originalEnd = originalEndPoint;
      }
    } else if (isCurvedLine) {
      // For curved lines, draw smooth spline using stored interpolated points
      //                 console.log(`Drawing curved line with ${vectorData.points.length} interpolated points`);
                
      // Calculate curve shortening for arrows if this is a curved arrow
      let startIndex = 0;
      let endIndex = vectorData.points.length - 1;
                
      if (isCurvedArrow && vectorData.arrowSettings && vectorData.points.length >= 2) {
        const brushSizeForStroke = vectorData.width || 5;
        const baseArrowSize = Math.max(vectorData.arrowSettings.arrowSize || (brushSizeForStroke * 2), brushSizeForStroke * 2);
        const scale = window.paintApp.state.imageScaleByLabel[currentImageLabel] || 1;
        const scaledArrowSize = baseArrowSize * scale;
                    
        // Use improved shortening calculation for dense curves
        const baseArrowSizeInPixels = baseArrowSize; // Use base size without scaling
        const shorteningDistance = baseArrowSizeInPixels * 0.4;
                    
        // For very dense curves (>100 points), use percentage-based shortening as fallback
        const isDenseCurve = vectorData.points.length > 100;
        const minShorteningPercent = 0.05; // At least 5% of points
                    
        // Find how many points to skip from start for start arrow
        if (vectorData.arrowSettings.startArrow) {
          let accumulatedDistance = 0;
          for (let i = 1; i < vectorData.points.length && accumulatedDistance < shorteningDistance; i++) {
            const prevPoint = vectorData.points[i - 1];
            const currentPoint = vectorData.points[i];
                            
            // Calculate distance between consecutive points in unscaled image space
            const dx = currentPoint.x - prevPoint.x;
            const dy = currentPoint.y - prevPoint.y;
            const segmentDistance = Math.sqrt(dx * dx + dy * dy);
                            
            accumulatedDistance += segmentDistance;
            if (accumulatedDistance >= shorteningDistance || 
                                (isDenseCurve && i >= vectorData.points.length * minShorteningPercent)) {
              startIndex = i;
              break;
            }
          }
        }
                    
        // Find how many points to skip from end for end arrow
        if (vectorData.arrowSettings.endArrow) {
          let accumulatedDistance = 0;
          for (let i = vectorData.points.length - 2; i >= 0 && accumulatedDistance < shorteningDistance; i--) {
            const currentPoint = vectorData.points[i];
            const nextPoint = vectorData.points[i + 1];
                            
            // Calculate distance between consecutive points in unscaled image space
            const dx = nextPoint.x - currentPoint.x;
            const dy = nextPoint.y - currentPoint.y;
            const segmentDistance = Math.sqrt(dx * dx + dy * dy);
                            
            accumulatedDistance += segmentDistance;
            if (accumulatedDistance >= shorteningDistance ||
                                (isDenseCurve && i <= vectorData.points.length * (1 - minShorteningPercent))) {
              endIndex = i;
              break;
            }
          }
        }
                    
        //                     console.log(`Curve shortening: startIndex=${startIndex}, endIndex=${endIndex}, total points=${vectorData.points.length}`);
      }
                
      // Draw the curve using the calculated start and end indices
      let isFirstPoint = true;
      for (let i = startIndex; i <= endIndex; i++) {
        const point = vectorData.points[i];
        const transformed = imageToCanvasCoords(point.x, point.y, transformParams);
                    
        if (isFirstPoint) {
          ctx.moveTo(transformed.x, transformed.y);
          strokePath.push({x: transformed.x, y: transformed.y});
          isFirstPoint = false;
        } else {
          ctx.lineTo(transformed.x, transformed.y);
          strokePath.push({x: transformed.x, y: transformed.y});
        }
      }
    } else {
      // For freehand drawing, draw straight lines between all points
      for (let i = 1; i < vectorData.points.length; i++) {
        const point = vectorData.points[i];
        const transformed = imageToCanvasCoords(point.x, point.y, transformParams);
                    
        ctx.lineTo(transformed.x, transformed.y);
        strokePath.push({x: transformed.x, y: transformed.y});
      }
    }
            
    // Set stroke style
    ctx.strokeStyle = vectorData.color;
    ctx.lineWidth = (vectorData.width || 5) * scale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
            
    // Set dash pattern if enabled
    if (vectorData.dashSettings && vectorData.dashSettings.enabled && vectorData.dashSettings.pattern.length > 0) {
      const scaledPattern = vectorData.dashSettings.pattern.map(dash => dash * scale);
      ctx.setLineDash(scaledPattern);
      ctx.lineDashOffset = 0; // Always start completed strokes with no offset
    } else {
      ctx.setLineDash([]); // Solid line
      ctx.lineDashOffset = 0; // Reset offset for solid lines too
    }
            
    // --- Add Shadow Effect for White Strokes Only ---
    const isWhiteStroke = vectorData.color === '#ffffff' || vectorData.color === 'white' || vectorData.color === 'rgb(255, 255, 255)';
    const isSelected = window.paintApp.state.selectedStrokeByImage[currentImageLabel] === strokeLabel;
            
    if (isWhiteStroke || isSelected) {
      ctx.save(); // Save context state before applying shadow
                
      if (isWhiteStroke) {
        ctx.shadowColor = 'rgba(0, 0, 0, 0.6)'; // Strong dark shadow for white strokes
        ctx.shadowBlur = 6; // Stronger shadow blur
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 2;
      }
                
      if (isSelected) {
        ctx.shadowColor = '#007bff'; // Blue glow for selected (visible on white background)
        ctx.shadowBlur = 15; // Stronger glow for selected
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        // console.log(`    Applying glow to selected stroke: ${strokeLabel}`);
      }
    }
    // --- End Shadow/Glow Effect ---

    ctx.stroke();

    // --- Reset Shadow/Glow Effect ---
    if (isWhiteStroke || isSelected) {
      ctx.restore(); // Restore context state to remove shadow
    }
    // --- End Reset Shadow/Glow Effect ---
            
    // Restore the context state (removes clipping region for blank canvas)
    ctx.restore();
            
    // Reset dash pattern to solid
    ctx.setLineDash([]);
            
    // Draw decorations and control points
    drawStrokeDecorations(ctx, strokeLabel, vectorData, strokePath, isArrowLine, isCurvedArrow, isCurvedLine, isStraightLine, isBlankCanvas, canvasCenter, scale, imageX, imageY, currentImageLabel);
            
    return strokePath;
  }

  function drawStrokeDecorations(ctx, strokeLabel, vectorData, strokePath, isArrowLine, isCurvedArrow, isCurvedLine, isStraightLine, isBlankCanvas, canvasCenter, scale, imageX, imageY, currentImageLabel) {
    // Get transformation parameters for consistent coordinate transformations
    const transformParams = getTransformationParams(currentImageLabel);
             
    // --- Draw Arrowheads for Arrow Lines ---
    if (isArrowLine && vectorData.arrowSettings && strokePath.length >= 2) {
      const startPoint = strokePath.originalStart;
      const endPoint = strokePath.originalEnd;
                 
      // Safety check: ensure both points are valid before drawing arrowheads
      if (startPoint && endPoint && startPoint.x !== undefined && endPoint.x !== undefined) {
        // Create a temporary settings object with brush size-aware scaling
        const brushSizeForStroke = vectorData.width || 5;
        const baseArrowSize = Math.max(vectorData.arrowSettings.arrowSize || (brushSizeForStroke * 2), brushSizeForStroke * 2);
                     
        const scaledArrowSettings = {
          ...vectorData.arrowSettings,
          arrowSize: baseArrowSize // Let drawArrowhead handle the final scaling
        };
                     
        // Draw arrowheads using the transformed coordinates and stroke color
        drawArrowhead(startPoint, endPoint, scaledArrowSettings, vectorData.width || 5, vectorData.color);
      } else {
        console.warn(`Skipping arrowheads for ${strokeLabel}: invalid points`, { startPoint, endPoint });
      }
    }
    // --- End Arrowheads ---
             
    // --- Draw Arrowheads for Curved Arrows ---
    if (isCurvedArrow && vectorData.arrowSettings && vectorData.points.length >= 2) {
      const brushSizeForStroke = vectorData.width || 5;
      const baseArrowSize = Math.max(vectorData.arrowSettings.arrowSize || (brushSizeForStroke * 2), brushSizeForStroke * 2);
      // Use the scale parameter passed to the function, not fetched separately
      const scaledArrowSize = baseArrowSize * scale;
                 
      // For dense curves, use a more robust shortening approach
      let startIndex = 0;
      let endIndex = vectorData.points.length - 1;
                 
      // Convert arrow size to image coordinate space for shortening calculation
      // Increase shortening distance to prevent line overlay on arrows
      const shorteningDistance = (baseArrowSize + (brushSizeForStroke * 2)) / scale;
                 
      // For very dense curves (>100 points), use percentage-based shortening as fallback
      const isDenseCurve = vectorData.points.length > 100;
      const minShorteningPercent = 0.05; // At least 5% of points
                 
      // Find start index for start arrow
      if (vectorData.arrowSettings.startArrow) {
        let accumulatedDistance = 0;
        for (let i = 1; i < vectorData.points.length && accumulatedDistance < shorteningDistance; i++) {
          const prevPoint = vectorData.points[i - 1];
          const currentPoint = vectorData.points[i];
          const dx = currentPoint.x - prevPoint.x;
          const dy = currentPoint.y - prevPoint.y;
          const segmentDistance = Math.sqrt(dx * dx + dy * dy);
          accumulatedDistance += segmentDistance;
                         
          if (accumulatedDistance >= shorteningDistance || 
                             (isDenseCurve && i >= vectorData.points.length * minShorteningPercent)) {
            startIndex = i;
            break;
          }
        }
      }
                 
      // Find end index for end arrow
      if (vectorData.arrowSettings.endArrow) {
        let accumulatedDistance = 0;
        for (let i = vectorData.points.length - 2; i >= 0 && accumulatedDistance < shorteningDistance; i--) {
          const currentPoint = vectorData.points[i];
          const nextPoint = vectorData.points[i + 1];
          const dx = nextPoint.x - currentPoint.x;
          const dy = nextPoint.y - currentPoint.y;
          const segmentDistance = Math.sqrt(dx * dx + dy * dy);
          accumulatedDistance += segmentDistance;
                         
          if (accumulatedDistance >= shorteningDistance ||
                             (isDenseCurve && i <= vectorData.points.length * (1 - minShorteningPercent))) {
            endIndex = i;
            break;
          }
        }
      }
                 
      // Calculate proper tangent directions from the shortened curve points
      let startTangent = null;
      let endTangent = null;
      let startPoint = null;
      let endPoint = null;
                 
      // Calculate start tangent using shortened curve endpoints (use same transformation as curve drawing)
      if (vectorData.points.length >= 2) {
        const firstPoint = vectorData.points[0]; // Use original first point for arrow positioning
        // For dense curves, look further ahead for better tangent direction
        const lookAheadDistance = Math.min(10, vectorData.points.length - startIndex - 1);
        const secondPoint = vectorData.points[Math.min(10, vectorData.points.length - 1)]; // Use early point for tangent direction
                     
        // Transform first and second points to canvas coordinates using unified system
        const startTransformed = imageToCanvasCoords(firstPoint.x, firstPoint.y, transformParams);
        const startX = startTransformed.x;
        const startY = startTransformed.y;
                     
        const secondTransformed = imageToCanvasCoords(secondPoint.x, secondPoint.y, transformParams);
        const secondX = secondTransformed.x;
        const secondY = secondTransformed.y;
                     
        // Calculate start tangent: second - first (forward direction)
        const dx = secondX - startX;
        const dy = secondY - startY;
        const length = Math.sqrt(dx * dx + dy * dy);
        if (length > 0) {
          startTangent = { x: dx / length, y: dy / length };
        }
        startPoint = { x: startX, y: startY };
      }
                 
      // Calculate end tangent using shortened curve endpoints (use same transformation as curve drawing)
      if (vectorData.points.length >= 2) {
        const lastPoint = vectorData.points[vectorData.points.length - 1]; // Use original last point for arrow positioning
        // For dense curves, look further back for better tangent direction
        const lookBackDistance = Math.min(10, endIndex);
        const secondLastPoint = vectorData.points[Math.max(0, vectorData.points.length - 11)]; // Use late point for tangent direction
                     
        // Transform last and second-to-last points to canvas coordinates using unified system
        const endTransformed = imageToCanvasCoords(lastPoint.x, lastPoint.y, transformParams);
        const endX = endTransformed.x;
        const endY = endTransformed.y;
                     
        const secondLastTransformed = imageToCanvasCoords(secondLastPoint.x, secondLastPoint.y, transformParams);
        const secondLastX = secondLastTransformed.x;
        const secondLastY = secondLastTransformed.y;
                     
        // Calculate end tangent: last - second-to-last (forward direction)
        const dx = endX - secondLastX;
        const dy = endY - secondLastY;
        const length = Math.sqrt(dx * dx + dy * dy);
        if (length > 0) {
          endTangent = { x: dx / length, y: dy / length };
        }
        endPoint = { x: endX, y: endY };
                     
        //                      console.log(`End tangent calculation for curved arrow:`, { 
        //                          endTangent, 
        //                          endPoint: { x: endX, y: endY },
        //                          secondLastPoint: { x: secondLastX, y: secondLastY },
        //                          dx, dy, length 
        //                      });
      }
                 
      // Draw arrowheads using calculated tangents
      ctx.save();
      ctx.fillStyle = vectorData.color;
      ctx.strokeStyle = vectorData.color;
                 
      if (vectorData.arrowSettings.startArrow && startTangent && startPoint) {
        // Start arrow points backward (opposite to tangent direction)
        const startAngle = Math.atan2(-startTangent.y, -startTangent.x);
                     
        // HACKY FIX: For thick strokes, make arrowhead larger and extend it forward to connect with line end
        const strokeWidth = vectorData.width || 5;
        let adjustedStartPoint = { ...startPoint };
        let adjustedArrowSize = scaledArrowSize;
                     
        // If stroke is thick (>10), extend arrowhead forward to connect with the visible line end
        if (strokeWidth > 10) {
          // Move arrowhead forward by half the stroke width to connect with line end
          const forwardDistance = (strokeWidth * scale) * 0.5;
          adjustedStartPoint.x = startPoint.x + (-startTangent.x) * forwardDistance;
          adjustedStartPoint.y = startPoint.y + (-startTangent.y) * forwardDistance;
                         
          // Make arrowhead larger to compensate for the forward movement
          adjustedArrowSize = scaledArrowSize * 1.3; // 30% larger
        }
                     
        // Scale arrow size to match the scaled coordinates
        drawSingleArrowhead(adjustedStartPoint.x, adjustedStartPoint.y, startAngle, adjustedArrowSize, vectorData.arrowSettings.arrowStyle);
      }
                 
      if (vectorData.arrowSettings.endArrow && endTangent && endPoint) {
        // End arrow points forward (same as tangent direction)
        const endAngle = Math.atan2(endTangent.y, endTangent.x);
                     
        // HACKY FIX: For thick strokes, make arrowhead larger and extend it forward to connect with line end
        const strokeWidth = vectorData.width || 5;
        let adjustedEndPoint = { ...endPoint };
        let adjustedArrowSize = scaledArrowSize;
                     
        // If stroke is thick (>10), extend arrowhead forward to connect with the visible line end
        if (strokeWidth > 10) {
          // Move arrowhead forward by half the stroke width to connect with line end
          const forwardDistance = (strokeWidth * scale) * 0.5;
          adjustedEndPoint.x = endPoint.x + endTangent.x * forwardDistance;
          adjustedEndPoint.y = endPoint.y + endTangent.y * forwardDistance;
                         
          // Make arrowhead larger to compensate for the forward movement
          adjustedArrowSize = scaledArrowSize * 1.3; // 30% larger
        }
                     
        // Scale arrow size to match the scaled coordinates
        drawSingleArrowhead(adjustedEndPoint.x, adjustedEndPoint.y, endAngle, adjustedArrowSize, vectorData.arrowSettings.arrowStyle);
      }
                 
      ctx.restore();
    }
    // --- End Curved Arrow Arrowheads ---

    // --- Draw Control Point Indicators for Arrows (ONLY in Edit Mode) ---
    if (isArrowLine && vectorData.points.length >= 2 && 
                 window.selectedStrokeInEditMode === strokeLabel) {
      //                  console.log(`Drawing arrow endpoint indicators for ${strokeLabel} (IN EDIT MODE)`);
                 
      // Draw control points at start and end of arrow
      const startPoint = vectorData.points[0];
      const endPoint = vectorData.points[vectorData.points.length - 1];
                 
      [startPoint, endPoint].forEach((point, index) => {
        const transformed = imageToCanvasCoords(point.x, point.y, transformParams);
        const transformedX = transformed.x;
        const transformedY = transformed.y;
                     
        // Draw arrow endpoint control indicator
        ctx.save();
        ctx.beginPath();
                     
        // Enhanced appearance for control points in edit mode
        let pointRadius = Math.max(6, 8 * Math.min(scale, 1)); // Scale down only, minimum size
        let fillColor = '#ffffff';
        let strokeColor = vectorData.color;
        let lineWidth = Math.max(2, 3 * Math.min(scale, 1)); // Scale line width too
                     
        // Add a subtle glow effect for control points in edit mode
        ctx.shadowColor = vectorData.color;
        ctx.shadowBlur = 8;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
                     
        // Make endpoints square to distinguish from curved line control points
        const halfSize = pointRadius / 2;
        ctx.rect(transformedX - halfSize, transformedY - halfSize, pointRadius, pointRadius);
        ctx.fillStyle = fillColor;
        ctx.fill();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
        ctx.restore();
      });
    }
             
    // --- Draw Control Point Indicators for Curved Lines ---
    if (isCurvedLine && vectorData.controlPoints && vectorData.controlPoints.length > 0) {
      // Only show control points for selected strokes or strokes in edit mode
      const shouldShowControlPoints = (window.paintApp.state.selectedStrokeByImage[currentImageLabel] === strokeLabel || 
                                                window.selectedStrokeInEditMode === strokeLabel);
                 
      if (shouldShowControlPoints) {
        //                      console.log(`Drawing control point indicators for curved line ${strokeLabel}`);
                     
        // Draw small circles at each original control point
        vectorData.controlPoints.forEach((controlPoint, index) => {
          // Use the same transformation logic as the stroke rendering for consistency
          let transformedX, transformedY;
                         
          if (isBlankCanvas) {
            // Apply both scaling and position offset in blank canvas mode
            const position = window.paintApp.state.imagePositionByLabel[currentImageLabel] || { x: 0, y: 0 };
            // Scale from canvas center
            const scaledX = (controlPoint.x - canvasCenter.x) * scale + canvasCenter.x;
            const scaledY = (controlPoint.y - canvasCenter.y) * scale + canvasCenter.y;
            // Then apply position offset
            transformedX = scaledX + position.x;
            transformedY = scaledY + position.y;
          } else {
            transformedX = imageX + (controlPoint.x * scale);
            transformedY = imageY + (controlPoint.y * scale);
          }
                         
          // Draw control point indicator (enhanced for draggability)
          ctx.save();
          ctx.beginPath();
                         
          // Enhanced appearance for control points
          let pointRadius = Math.max(6, (window.paintApp.config.ANCHOR_SIZE || 8) * Math.min(scale, 1)); // Scale down only, minimum size
          let fillColor, strokeColor, lineWidth;
                         
          // Check if this is the anchor being dragged
          if (draggingAnchor && dragCurveStroke === strokeLabel && dragAnchorIndex === index) {
            fillColor = '#ff0000'; // Red when dragging
            strokeColor = '#ffffff';
            lineWidth = 2;
            pointRadius = pointRadius + 2; // Make it slightly larger when dragging
          } else if (window.selectedStrokeInEditMode === strokeLabel) {
            fillColor = '#00ff00'; // Green when in edit mode
            strokeColor = '#ffffff';
            lineWidth = 2;
          } else {
            fillColor = '#4CAF50'; // Brighter green when just selected
            strokeColor = '#ffffff';
            lineWidth = 1;
          }
                         
          ctx.arc(transformedX, transformedY, pointRadius, 0, Math.PI * 2);
          ctx.fillStyle = fillColor;
          ctx.fill();
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = lineWidth;
          ctx.stroke();
          ctx.restore();
        });
      }
    }
             
    // --- Draw Control Point Indicators for Straight Lines ---
    if (isStraightLine && vectorData.points && vectorData.points.length >= 2) {
      // Only show control points for selected strokes or strokes in edit mode
      const shouldShowControlPoints = (window.paintApp.state.selectedStrokeByImage[currentImageLabel] === strokeLabel || 
                                                window.selectedStrokeInEditMode === strokeLabel);
                 
      if (shouldShowControlPoints) {
        //                      console.log(`Drawing anchor point indicators for straight line ${strokeLabel}`);
                     
        // Draw anchor points at start and end of straight line
        const startPoint = vectorData.points[0];
        const endPoint = vectorData.points[vectorData.points.length - 1];
                     
        [startPoint, endPoint].forEach((point, index) => {
          const transformed = imageToCanvasCoords(point.x, point.y, transformParams);
          const transformedX = transformed.x;
          const transformedY = transformed.y;
                         
          // Draw anchor point indicator
          ctx.save();
          ctx.beginPath();
                         
          // Enhanced appearance for anchor points
          let pointRadius = Math.max(6, (window.paintApp.config.ANCHOR_SIZE || 8) * Math.min(scale, 1)); // Scale down only, minimum size
          let fillColor, strokeColor, lineWidth;
                         
          // Check if this is the anchor being dragged
          if (isDraggingControlPoint && draggedControlPointInfo && 
                             draggedControlPointInfo.strokeLabel === strokeLabel && 
                             draggedControlPointInfo.pointIndex === (index === 0 ? 'start' : 'end')) {
            fillColor = '#ff0000'; // Red when dragging
            strokeColor = '#ffffff';
            lineWidth = 2;
            pointRadius = pointRadius + 2; // Make it slightly larger when dragging
          } else if (window.selectedStrokeInEditMode === strokeLabel) {
            fillColor = '#2196F3'; // Blue when in edit mode
            strokeColor = '#ffffff';
            lineWidth = 2;
          } else {
            fillColor = '#2196F3'; // Blue for straight line anchors
            strokeColor = '#ffffff';
            lineWidth = 1;
          }
                         
          // Make straight line anchors square to distinguish from curved line control points
          const halfSize = pointRadius / 2;
          ctx.rect(transformedX - halfSize, transformedY - halfSize, pointRadius, pointRadius);
          ctx.fillStyle = fillColor;
          ctx.fill();
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = lineWidth;
          ctx.stroke();
          ctx.restore();
        });
      }
    }
    // --- End Control Point Indicators ---
  }

function applyVisibleStrokes(scale, imageX, imageY, contextRotated) {
  // Set a scoped flag to inform coordinate transforms that context is pre-rotated
  const prevCtxRotatedFlag = window.__renderContextRotatedForStrokes;
  window.__renderContextRotatedForStrokes = !!contextRotated;
    //             console.log(`\n--- applyVisibleStrokes ---`); // ADDED LOG
    //             console.log(`  Target Label: ${currentImageLabel}`); // ADDED LOG
    //             console.log(`  Scale: ${scale}, ImageX: ${imageX}, ImageY: ${imageY}`); // ADDED LOG
    //         console.log(`[applyVisibleStrokes] Current window.imageScaleByLabel[${currentImageLabel}] = ${window.imageScaleByLabel[currentImageLabel]}`);
        
    // CRITICAL FIX: Ensure scale parameter matches the global scale value
    if (scale !== window.imageScaleByLabel[currentImageLabel]) {
      if (window.__DEBUG__) console.warn(`[applyVisibleStrokes] Scale mismatch. Param=${scale} global=${window.imageScaleByLabel[currentImageLabel]}. Correcting.`);
      scale = window.imageScaleByLabel[currentImageLabel]; // Use the global scale value always
    }
        
    // Apply each visible stroke using vector data if available
    // SAFETY CHECK: Ensure vectorStrokesByImage is properly initialized
    if (!vectorStrokesByImage[currentImageLabel]) {
      console.warn(`[applyVisibleStrokes] vectorStrokesByImage[${currentImageLabel}] was undefined, initializing...`);
      vectorStrokesByImage[currentImageLabel] = {};
    }
            
    const strokes = vectorStrokesByImage[currentImageLabel] || {};
    const strokeOrder = lineStrokesByImage[currentImageLabel] || [];
    const visibility = strokeVisibilityByImage[currentImageLabel] || {};

    // *** ADDED LOGGING ***
    //             console.log(`  Stroke Order (${strokeOrder.length}): [${strokeOrder.join(', ')}]`);
    //             console.log(`  Vector Strokes Available (${Object.keys(strokes).length}):`, Object.keys(strokes));
    //             console.log(`  Visibility States:`, JSON.stringify(visibility));
    // *** END LOGGING ***

    // Get the current image dimensions and scale
    let imageWidth = canvas.width;
    let imageHeight = canvas.height;
            
    // Try to get original image dimensions if available
    if (window.originalImages && window.originalImages[currentImageLabel]) {
      const cachedImg = imageCache[window.originalImages[currentImageLabel]];
      if (cachedImg) {
        imageWidth = cachedImg.width;
        imageHeight = cachedImg.height;
        //                     console.log(`Original image dimensions: ${imageWidth}x${imageHeight}`);
      }
    }
            
    // Check if this is a blank canvas (no image, using canvas dimensions)
    const dims = window.originalImageDimensions ? window.originalImageDimensions[currentImageLabel] : undefined;
    const isBlankCanvas = !window.originalImages || !window.originalImages[currentImageLabel] || 
                                 (dims && dims.width === canvas.width && dims.height === canvas.height);
            
    if (isBlankCanvas) {
      //                 console.log(`Applying strokes in BLANK CANVAS MODE`);
    }
            
    // Calculate canvas center for scaling in blank canvas mode
    const canvasCenter = {
      x: canvas.width / 2,
      y: canvas.height / 2
    };
            
    // Draw strokes using the dedicated stroke rendering function
    strokeOrder.forEach((strokeLabel) => {
      const isVisible = visibility[strokeLabel];
      // *** ADDED LOGGING ***
      //                 console.log(`\n  Processing Stroke: ${strokeLabel}`);
      //                 console.log(`    Is Visible? ${isVisible}`);
      // *** END LOGGING ***

      if (!isVisible) return; // Skip invisible strokes
                
      const vectorData = strokes[strokeLabel];
      // *** ADDED LOGGING ***
      if (!vectorData) {
        console.warn(`    Vector data MISSING for ${strokeLabel}! Skipping draw.`);
        return;
      } 
      if (!vectorData.points || vectorData.points.length === 0) {
        console.warn(`    Vector data for ${strokeLabel} has NO POINTS! Skipping draw.`);
        return;
      }
      //                 console.log(`    Vector Data Found: ${vectorData.points.length} points, type: ${vectorData.type}, color: ${vectorData.color}, width: ${vectorData.width}`);
      // *** END LOGGING ***
                
      // Use the existing drawSingleStroke function
      const strokePath = drawSingleStroke(ctx, strokeLabel, vectorData, scale, imageX, imageY, currentImageLabel, isBlankCanvas, canvasCenter);
                        
      // Store the path for this stroke (for label positioning)
      if (strokePath) {
        currentStrokePaths.push({
          label: strokeLabel,
          path: strokePath,
          width: (vectorData.width || 5) * scale,
          color: vectorData.color
        });
      }
    });
            
    // --- Start of Label Drawing Logic (Add inside applyVisibleStrokes, after strokes are drawn) ---
    // console.log(`--- Redraw: Drawing Labels for ${currentImageLabel} ---`);

    // Keep track of label positions to avoid overlap in this redraw cycle
    currentLabelPositions = [];
    const usedCustomPositions = {}; // Track which custom positions were applied

    strokeOrder.forEach((strokeLabel) => {
      const isStrokeVisible = visibility[strokeLabel];

      // Ensure strokeLabelVisibility is initialized for the image
      if (!strokeLabelVisibility[currentImageLabel]) {
        strokeLabelVisibility[currentImageLabel] = {};
      }
      // Default label visibility to true if not set
      const isLabelVisible = strokeLabelVisibility[currentImageLabel][strokeLabel] !== undefined
        ? strokeLabelVisibility[currentImageLabel][strokeLabel]
        : true; // Default to true if the key doesn't exist yet

      const vectorData = strokes[strokeLabel];

      if (isStrokeVisible && isLabelVisible && vectorData && vectorData.points.length > 0) {
        // Determine shape and build label text rules
        const shape = (window.paintApp?.state?.labelShape) || 'square';
        const measurement = getMeasurementString(strokeLabel);
        const showMeasurements = document.getElementById('toggleShowMeasurements') ? document.getElementById('toggleShowMeasurements').checked : true;
        console.log(`[ShowMeasurements] Checkbox checked: ${showMeasurements}, Measurement: ${measurement}, Label: ${strokeLabel}`);
                    
        // Build label text based on measurement visibility (same for both circle and square)
        let labelText;
        if (showMeasurements && measurement) {
          // Show measurement: "A1=0""
          labelText = `${strokeLabel}=${measurement}`;
        } else {
          // Hide measurement: just "A1"
          labelText = strokeLabel;
        }

        let anchorPointCanvas; // Anchor point in canvas coordinates
        let anchorPointImage;  // Anchor point in image coordinates

        if (vectorData.points.length > 0) {
          // Use robust anchor computation that returns the true geometric midpoint for straight/two-point lines
          const anchorImg = getStrokeAnchorPoint(strokeLabel, currentImageLabel);
          anchorPointImage = { x: anchorImg.x, y: anchorImg.y };
                        
          try {
            // Convert image anchor to canvas anchor for routines that need canvas coords (e.g., initial optimal placement)
            // Use toCanvas for proper coordinate transformation (handles center-based scaling for blank canvas)
            // IMPORTANT: Use the same transformParams here as we use later for final position calculation
            const transformParams = getTransformationParams(currentImageLabel);
            if (window.__renderContextRotatedForStrokes) transformParams.__renderContextRotated = true;
            anchorPointCanvas = imageToCanvasCoords(anchorPointImage.x, anchorPointImage.y, transformParams);
            if (!anchorPointCanvas || isNaN(anchorPointCanvas.x) || isNaN(anchorPointCanvas.y)) {
              console.error(`      Error calculating canvas coords for label anchor for ${strokeLabel}. Image anchor:`, anchorPointImage);
              anchorPointCanvas = { x: canvas.width / 2, y: canvas.height / 2 }; // Fallback
            }
          } catch (err) {
            console.error(`      Error in converting image anchor to canvas for ${strokeLabel}:`, err);
            anchorPointCanvas = { x: canvas.width / 2, y: canvas.height / 2 }; // Fallback
          }
        } else {
          // Fallback if no points, though the earlier check should prevent this
          anchorPointImage = { x: 0, y: 0}; 
          anchorPointCanvas = { x: canvas.width / 2, y: canvas.height / 2 };
        }

        const tagSize = getTagSize(strokeLabel);
        ctx.font = `${tagSize}px Arial`;
        // Use grey outline for white strokes, black text for all
        const isWhiteStroke = vectorData.color === '#ffffff' || vectorData.color === 'white' || vectorData.color === 'rgb(255, 255, 255)';
        const labelOutlineColor = isWhiteStroke ? '#666666' : (vectorData.color || '#000');
        const labelTextColor = '#000000'; // Black text for all tags
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';

        const metrics = ctx.measureText(labelText);
        const labelHeight = 48; 
        const labelWidth = Math.max(metrics.width + 12, labelHeight); // ensure at least a square for short text
                    
        // Initial labelRect definition (center-based reference)
        // We will treat (x, y) as the CENTER of the label for placement and connector math
        const labelRectForSizing = {
          width: labelWidth,
          height: labelHeight,
          // x, y will be assigned as the CENTER position of the tag
          strokeLabel: strokeLabel
        };

        let finalPositionCanvas; // This will be the top-left of the label in CANVAS coordinates
        let imageSpaceOffset; // This will store the {x, y} offset in IMAGE SPACE
                    
        // Check for custom positions in both local and window storage
        const localCustomExists = customLabelPositions[currentImageLabel]?.[strokeLabel];
        const windowCustomExists = window.customLabelPositions[currentImageLabel]?.[strokeLabel];
                    
        if (!localCustomExists && windowCustomExists) {
          // Sync from window to local storage
          if (!customLabelPositions[currentImageLabel]) customLabelPositions[currentImageLabel] = {};
          customLabelPositions[currentImageLabel][strokeLabel] = windowCustomExists;
        }

        // Prefer rotation-stable relative position if available
        const relativePos = window.customLabelRelativePositions
                        && window.customLabelRelativePositions[currentImageLabel]
          ? window.customLabelRelativePositions[currentImageLabel][strokeLabel]
          : null;
        if (relativePos) {
          const absFromRelative = window.convertRelativeToAbsolutePosition(strokeLabel, relativePos, currentImageLabel);
          if (absFromRelative) {
            imageSpaceOffset = absFromRelative;
            // Sync into custom maps so persistence/export see the updated absolute offset
            if (!customLabelPositions[currentImageLabel]) customLabelPositions[currentImageLabel] = {};
            customLabelPositions[currentImageLabel][strokeLabel] = imageSpaceOffset;
            if (!window.customLabelPositions[currentImageLabel]) window.customLabelPositions[currentImageLabel] = {};
            window.customLabelPositions[currentImageLabel][strokeLabel] = imageSpaceOffset;
          }
        }
        if (!imageSpaceOffset && customLabelPositions[currentImageLabel]?.[strokeLabel]) {
          // Convert to pixels if normalized
          const raw = customLabelPositions[currentImageLabel][strokeLabel];
          imageSpaceOffset = normalizeToPixels(raw, currentImageLabel) || raw; // px
          
          // Check for massive offsets in custom positions too (legacy projects)
          if (imageSpaceOffset) {
            const offsetKey = `${currentImageLabel}_${strokeLabel}`;
            const offsetMagnitude = Math.sqrt((imageSpaceOffset.x||0) * (imageSpaceOffset.x||0) + (imageSpaceOffset.y||0) * (imageSpaceOffset.y||0));
            const dims = window.originalImageDimensions && window.originalImageDimensions[currentImageLabel];
            const maxReasonableOffset = dims ? Math.max(dims.width, dims.height) * 1.5 : 500;
            
            if (offsetMagnitude > maxReasonableOffset && !window.clearedMassiveOffsets[offsetKey]) {
              console.log(`[Label] Clearing massive custom offset for ${currentImageLabel} ${strokeLabel}: (${fmt(imageSpaceOffset.x)}, ${fmt(imageSpaceOffset.y)}) magnitude: ${fmt(offsetMagnitude)} (max: ${fmt(maxReasonableOffset)})`);
              delete customLabelPositions[currentImageLabel][strokeLabel];
              delete window.customLabelPositions[currentImageLabel]?.[strokeLabel];
              window.clearedMassiveOffsets[offsetKey] = true;
              imageSpaceOffset = null; // Force recalculation
            }
          }
        } else if (!imageSpaceOffset && calculatedLabelOffsets[currentImageLabel]?.[strokeLabel]) {
          const raw = calculatedLabelOffsets[currentImageLabel][strokeLabel];
          imageSpaceOffset = normalizeToPixels(raw, currentImageLabel) || raw; // px
                        
          // Check for massive offsets that are likely from legacy buggy calculations
          // This applies to both blank canvas and images (especially rotated legacy projects)
          const offsetKey = `${currentImageLabel}_${strokeLabel}`;
          const offsetMagnitude = Math.sqrt((imageSpaceOffset.x||0) * (imageSpaceOffset.x||0) + (imageSpaceOffset.y||0) * (imageSpaceOffset.y||0));
          const dims = window.originalImageDimensions && window.originalImageDimensions[currentImageLabel];
          const maxReasonableOffset = dims ? Math.max(dims.width, dims.height) * 1.5 : 500; // Allow up to 1.5x image dimension
          
          if (offsetMagnitude > maxReasonableOffset && !window.clearedMassiveOffsets[offsetKey]) {
            console.log(`[Label] Clearing massive offset for ${currentImageLabel} ${strokeLabel}: (${fmt(imageSpaceOffset.x)}, ${fmt(imageSpaceOffset.y)}) magnitude: ${fmt(offsetMagnitude)} (max: ${fmt(maxReasonableOffset)})`);
            delete calculatedLabelOffsets[currentImageLabel][strokeLabel];
            delete customLabelPositions[currentImageLabel]?.[strokeLabel];
            delete window.customLabelPositions[currentImageLabel]?.[strokeLabel];
            window.clearedMassiveOffsets[offsetKey] = true; // Mark as cleared to prevent repeated clearing
            imageSpaceOffset = null; // Force recalculation
          } else if (offsetMagnitude <= maxReasonableOffset) {
            if (currentImageLabel === 'blank_canvas') {
              console.log(`[Label] Preserving reasonable offset for blank canvas ${strokeLabel}: (${fmt(imageSpaceOffset.x)}, ${fmt(imageSpaceOffset.y)}) magnitude: ${fmt(offsetMagnitude)}`);
            }
          }
          // console.log(`    Using calculated image-space offset for ${strokeLabel}:`, imageSpaceOffset);
        }
                    
        if (!imageSpaceOffset) {
          // console.log(`    Calculating new optimal position for ${strokeLabel}`);
          if (typeof findOptimalLabelPosition !== 'function') {
            console.error('     findOptimalLabelPosition function is not defined! Using default position.');
            // Fallback canvas offset (relative to canvas anchor)
            const fallbackCanvasX = anchorPointCanvas.x - labelWidth / 2;
            const fallbackCanvasY = anchorPointCanvas.y - labelHeight - 15;
            const canvasSpaceFallbackOffset = { 
              x: fallbackCanvasX - anchorPointCanvas.x, 
              y: fallbackCanvasY - anchorPointCanvas.y 
            };
            // Convert canvas offset to image space using proper inverse transform
            const fallbackLabelTopLeftImg = getTransformedCoords(fallbackCanvasX, fallbackCanvasY);
            imageSpaceOffset = { 
              x: fallbackLabelTopLeftImg.x - anchorPointImage.x, 
              y: fallbackLabelTopLeftImg.y - anchorPointImage.y 
            };
          } else {
            try {
              const strokePathInfo = currentStrokePaths.find(p => p.label === strokeLabel);
              // Use the start of the actual drawn path on canvas as anchor for initial guess
              let initialLabelAnchorCanvas;
              if (strokePathInfo && strokePathInfo.path && strokePathInfo.path.length > 0) {
                // Calculate a better representative point for the stroke
                // For freehand strokes, use the midpoint of the path
                const path = strokePathInfo.path;
                if (path.length > 1) {
                  // Find the geometric midpoint of the path
                  let midpointIndex = Math.floor(path.length / 2);
                  initialLabelAnchorCanvas = { 
                    x: path[midpointIndex].x, 
                    y: path[midpointIndex].y 
                  };
                                        
                  // For straight lines, can also consider using the midpoint between first and last points
                  if (vectorData.type === 'straight' && path.length >= 2) {
                    initialLabelAnchorCanvas = {
                      x: (path[0].x + path[path.length - 1].x) / 2,
                      y: (path[0].y + path[path.length - 1].y) / 2
                    };
                  }
                } else {
                  // Fall back to the first point if only one point exists
                  initialLabelAnchorCanvas = { x: path[0].x, y: path[0].y };
                }
              } else {
                // Fallback to the calculated anchorPointCanvas if no path info
                initialLabelAnchorCanvas = anchorPointCanvas;
              }

              // Initial guess based on where the stroke actually appears on canvas
              // Position above or to the side of the stroke point
              const initialGuessRectCanvas = { 
                ...labelRectForSizing, 
                // Center above anchor by 10px
                x: initialLabelAnchorCanvas.x, 
                y: initialLabelAnchorCanvas.y - (labelRectForSizing.height / 2) - 10
              };

              // findOptimalLabelPosition should search relative to the stroke's actual canvas position
              const optimalRectCanvas = findOptimalLabelPosition(
                initialGuessRectCanvas, 
                initialLabelAnchorCanvas, // <<< KEY CHANGE HERE
                { 
                  label: strokeLabel, 
                  path: strokePathInfo?.path || [], 
                  width: strokePathInfo?.width || (vectorData.width || 5) * scale 
                }
              );
                                
              // The offset derived from optimalRect is in canvas space
              const canvasSpaceOptimalOffset = {
                x: optimalRectCanvas.x - anchorPointCanvas.x,
                y: optimalRectCanvas.y - anchorPointCanvas.y
              };

              // Always store offsets in image space using proper inverse transform
              // This ensures consistent behavior during rotations and center-based scaling
              const labelTopLeftImg = getTransformedCoords(optimalRectCanvas.x, optimalRectCanvas.y);
              imageSpaceOffset = {
                x: labelTopLeftImg.x - anchorPointImage.x,
                y: labelTopLeftImg.y - anchorPointImage.y
              };
              console.log(`[Label] Storing image-space offset for ${strokeLabel}:`, imageSpaceOffset);
              // console.log(`    Calculated optimal canvas offset for ${strokeLabel}:`, canvasSpaceOptimalOffset, `-> image offset:`, imageSpaceOffset);
            } catch(err) {
              console.error(`      Error in findOptimalLabelPosition for ${strokeLabel}:`, err);
              const fallbackCanvasX = anchorPointCanvas.x - labelWidth / 2;
              const fallbackCanvasY = anchorPointCanvas.y - labelHeight - 15;
              const canvasSpaceFallbackOffset = { 
                x: fallbackCanvasX - anchorPointCanvas.x, 
                y: fallbackCanvasY - anchorPointCanvas.y 
              };
              // Convert error fallback canvas position to image space using proper inverse transform
              const errorFallbackLabelTopLeftImg = getTransformedCoords(fallbackCanvasX, fallbackCanvasY);
              imageSpaceOffset = { 
                x: errorFallbackLabelTopLeftImg.x - anchorPointImage.x, 
                y: errorFallbackLabelTopLeftImg.y - anchorPointImage.y 
              };
              console.log(`[Label] Using error fallback position with proper inverse transform for ${strokeLabel}:`, imageSpaceOffset);
            }
          }
          // **NEW**: Check persistence guard before saving calculated offsets
          if (window.checkPersistenceGuard(currentImageLabel, 'calculate_offset')) {
            // Store the newly calculated (or fallback) image-space offset
            if (!calculatedLabelOffsets[currentImageLabel]) calculatedLabelOffsets[currentImageLabel] = {};
            calculatedLabelOffsets[currentImageLabel][strokeLabel] = imageSpaceOffset;
          }
                        
          // For blank canvas, mark this offset as preserved to prevent future recalculation
          if (currentImageLabel === 'blank_canvas') {
            const offsetKey = `${currentImageLabel}_${strokeLabel}`;
            window.clearedMassiveOffsets[offsetKey] = true;
            const offsetMagnitude = Math.sqrt(imageSpaceOffset.x * imageSpaceOffset.x + imageSpaceOffset.y * imageSpaceOffset.y);
            console.log(`[Label] Stored new reasonable offset for blank canvas ${strokeLabel}: (${imageSpaceOffset.x.toFixed(1)}, ${imageSpaceOffset.y.toFixed(1)}) magnitude: ${offsetMagnitude.toFixed(1)} - now preserved`);
          }
          // console.log(`    Stored calculated image-space offset for ${strokeLabel}:`, imageSpaceOffset);
        }

        // Now, calculate the final canvas position for drawing using the image-space anchor and image-space offset
        console.log(`[OFFSET-DEBUG] ${strokeLabel} - FINAL OFFSET BEING USED:`, imageSpaceOffset);
        console.log(`[OFFSET-DEBUG] ${strokeLabel} - Anchor point:`, anchorPointImage);
                    
        // If an absolute tag center exists, prefer it to avoid drift relative to changing midpoints
        const absCenter = (window.customLabelAbsolutePositions && window.customLabelAbsolutePositions[currentImageLabel])
          ? window.customLabelAbsolutePositions[currentImageLabel][strokeLabel]
          : null;
        let finalLabelImageX, finalLabelImageY;
        if (absCenter && typeof absCenter.x === 'number' && typeof absCenter.y === 'number') {
          finalLabelImageX = absCenter.x;
          finalLabelImageY = absCenter.y;
        } else {
          finalLabelImageX = anchorPointImage.x + imageSpaceOffset.x;
          finalLabelImageY = anchorPointImage.y + imageSpaceOffset.y;
        }

        // Use imageToCanvasCoords for coordinate transformation (rotation = 0, so no rotation applied)
        const transformParams = getTransformationParams(currentImageLabel);
        
        finalPositionCanvas = imageToCanvasCoords(finalLabelImageX, finalLabelImageY, transformParams);
        // ABS_LOCK_ONCE: if an absolute lock exists for this stroke, override for this frame
        try {
          const lock = window.__labelAbsLockOnce && window.__labelAbsLockOnce[currentImageLabel] && window.__labelAbsLockOnce[currentImageLabel][strokeLabel];
          if (lock && typeof lock.x === 'number' && typeof lock.y === 'number') {
            finalPositionCanvas = { x: lock.x, y: lock.y };
            // Clear only when session is Stable; else keep until stable
            const sess = getImageSession(currentImageLabel);
            if (sess.phase === 'Stable') {
              delete window.__labelAbsLockOnce[currentImageLabel][strokeLabel];
              if (Object.keys(window.__labelAbsLockOnce[currentImageLabel]).length === 0) delete window.__labelAbsLockOnce[currentImageLabel];
            }
            if (labelReprojectDebug()) console.log(`[LABEL-REPROJECT] ABS_LOCK_${getImageSession(currentImageLabel).phase==='Stable'?'CLEARED':'UNTIL_STABLE'} for ${strokeLabel}`);
          }
        } catch(_) {}
        console.log(`[Label] Final position for ${strokeLabel}: Canvas(${fmt(finalPositionCanvas.x)}, ${fmt(finalPositionCanvas.y)}) | Anchor: Image(${fmt(anchorPointImage.x)}, ${fmt(anchorPointImage.y)}) + Offset: (${fmt(imageSpaceOffset.x)}, ${fmt(imageSpaceOffset.y)}) [Rotation: ${(transformParams.rotation * 180 / Math.PI).toFixed(1)}° - Position rotates, text stays upright]`);
        // console.log(`    Final Canvas Position for ${strokeLabel}:`, finalPositionCanvas, `(from ImagePos: ${finalLabelImageX.toFixed(1)},${finalLabelImageY.toFixed(1)})`);

        currentLabelPositions.push({ 
          ...labelRectForSizing, 
          // Store the center
          x: finalPositionCanvas.x, 
          y: finalPositionCanvas.y, 
          strokeLabel: strokeLabel 
        });

        // Draw the connector line FIRST, so it's behind the label
        if (typeof drawLabelConnector === 'function') {
          try {
            // drawLabelConnector expects the labelRect and anchorPoint in canvas coordinates
            drawLabelConnector(
              { ...labelRectForSizing, x: finalPositionCanvas.x, y: finalPositionCanvas.y }, 
              anchorPointCanvas, // Use the canvas anchor for visual connection
              labelOutlineColor
            );
          } catch(err) {
            console.error(`      Error in drawLabelConnector for ${strokeLabel}:`, err);
          }
        } else {
          console.warn('     drawLabelConnector function is not defined!');
        }

        // Draw with center-based reference: finalPositionCanvas is the center of the tag
        const rectX = finalPositionCanvas.x - labelWidth / 2;
        const rectY = finalPositionCanvas.y - labelHeight / 2;

        // Shape toggle (already determined above as 'shape')
        const unitsSelect = document.getElementById('unitsSelect');
        const units = unitsSelect ? (unitsSelect.value === 'cm' ? 'cm' : 'in') : 'in';

        if (shape === 'circle') {
          // Circle or rounded pill depending on length
          const radius = Math.max(10, (labelHeight / 2));
          ctx.fillStyle = 'white';
          const tm = ctx.measureText(labelText);
          const textFitsInCircle = tm.width <= radius * 1.6; // heuristic: two chars fit in circle

          // Counter-rotate the entire label (shape + text) so the tag never flips
          // BUT: Skip counter-rotation for blank canvas (no image) - labels should stay fixed
          const currentRotation = window.imageRotationByLabel ? (window.imageRotationByLabel[currentImageLabel] || 0) : 0;
          const shouldCounterRotate = transformParams.hasImage && currentRotation !== 0;
          ctx.save();
          ctx.translate(finalPositionCanvas.x, finalPositionCanvas.y);
          if (shouldCounterRotate) ctx.rotate(-currentRotation);
          window.__skipTextCounterRotate = true;

          if (textFitsInCircle) {
            ctx.beginPath();
            ctx.arc(0, 0, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = labelOutlineColor;
            ctx.lineWidth = 1;
            ctx.stroke();
          } else {
            // Draw pill (oblong) to contain text
            const pillW = Math.max(tm.width + 14, radius * 2);
            const pillH = radius * 2;
            const x = -pillW / 2;
            const y = -pillH / 2;
            const r = pillH / 2;
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.lineTo(x + pillW - r, y);
            ctx.arc(x + pillW - r, y + r, r, -Math.PI / 2, Math.PI / 2);
            ctx.lineTo(x + r, y + pillH);
            ctx.arc(x + r, y + r, r, Math.PI / 2, -Math.PI / 2);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = labelOutlineColor;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
          // Label text centered (includes measurement if enabled)
          ctx.fillStyle = labelTextColor;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(labelText, 0, 0);
          window.__skipTextCounterRotate = false;
          ctx.restore();
        } else {
          // Counter-rotate the entire square label so the box stays horizontal
          // BUT: Skip counter-rotation for blank canvas (no image) - labels should stay fixed
          const currentRotation = window.imageRotationByLabel ? (window.imageRotationByLabel[currentImageLabel] || 0) : 0;
          const shouldCounterRotate = transformParams.hasImage && currentRotation !== 0;
          ctx.save();
          ctx.translate(finalPositionCanvas.x, finalPositionCanvas.y);
          if (shouldCounterRotate) ctx.rotate(-currentRotation);
          window.__skipTextCounterRotate = true;

          ctx.fillStyle = 'white';
          ctx.fillRect(-labelWidth / 2, -labelHeight / 2, labelWidth, labelHeight);
          ctx.strokeStyle = labelOutlineColor;
          ctx.lineWidth = 1;
          ctx.strokeRect(-labelWidth / 2, -labelHeight / 2, labelWidth, labelHeight);
          // Center tag text inside the square
          ctx.fillStyle = labelTextColor;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(labelText, 0, 0);
          window.__skipTextCounterRotate = false;
          ctx.restore();
        }

        // Measurement text is already included in labelText for square mode.
        // Do not render separate black measurement overlay.
      } else {
        // ... existing code ...
      }
    });
    // console.log(`--- Redraw: Finished Drawing Labels ---`);
    // --- End of Label Drawing Logic ---
            
    // Save the now-combined state
    const newState = getCanvasState();
    imageStates[currentImageLabel] = cloneImageData(newState);
  }

  function cloneImageData(imageData) {
    return new ImageData(
      new Uint8ClampedArray(imageData.data),
      imageData.width,
      imageData.height
    );
  }

  // Shared with viewer: convert measurement string/number to desired units
  function formatMeasurementForUnits(raw, units) {
    if (typeof raw === 'string') {
      if (units === 'in') return raw;
      const num = parseFloat(raw);
      if (Number.isFinite(num)) return `${(num * 2.54).toFixed(1)} cm`;
      return raw;
    }
    if (typeof raw === 'number') {
      return units === 'cm' ? `${(raw * 2.54).toFixed(1)} cm` : `${raw.toFixed(2)} in`;
    }
    if (raw && typeof raw === 'object' && ('value' in raw)) {
      return formatMeasurementForUnits(raw.value, units);
    }
    return '';
  }

  // Normalize rotation delta to prevent wrap-around issues
  function normalizeDelta(delta) {
    const twoPi = Math.PI * 2;
    delta = ((delta + Math.PI) % twoPi + twoPi) % twoPi - Math.PI; // (-π, π]
    return Math.abs(delta) < 1e-9 ? 0 : delta;
  }

  function saveState(force = false, incrementLabel = true, updateStrokeList = true, isDrawingOrPasting = false, strokeInProgress = false) {
    // PERFORMANCE FIX: Don't save state during project loading to prevent side effects
    if (window.isLoadingProject) {
      console.log('[Save State] Skipped during project loading');
      return;
    }
        
    // Safety check: Ensure currentImageLabel is valid and undoStackByImage is initialized
    if (!currentImageLabel) {
      console.warn('[Save State] No currentImageLabel, skipping save');
      return;
    }
        
    // Ensure undoStackByImage is initialized for the current image
    if (!undoStackByImage[currentImageLabel]) {
      undoStackByImage[currentImageLabel] = [];
    }
    //         console.log('[Save State Called]', 'force='+force, 'incrementLabel='+incrementLabel, 'updateStrokeList='+updateStrokeList, 'isDrawingOrPasting='+isDrawingOrPasting, 'strokeInProgress='+strokeInProgress);
        
    // Log current state of measurements to verify they're captured
    //         console.log(`[saveState] Current strokeMeasurements for ${currentImageLabel}:`, 
    //             JSON.stringify(window.strokeMeasurements[currentImageLabel]));
            
    // Track current scale and position to ensure they're preserved
    if (window.imageScaleByLabel && window.imageScaleByLabel[currentImageLabel] !== undefined) {
      //             console.log(`[saveState] Current scale for ${currentImageLabel}: ${window.imageScaleByLabel[currentImageLabel]}`);
    } else {
      console.warn(`[saveState] No scale found for ${currentImageLabel}!`);
    }
        
    if (window.imagePositionByLabel && window.imagePositionByLabel[currentImageLabel]) {
      //             console.log(`[saveState] Current position for ${currentImageLabel}: x=${window.imagePositionByLabel[currentImageLabel].x}, y=${window.imagePositionByLabel[currentImageLabel].y}`);
    } else {
      console.warn(`[saveState] No position found for ${currentImageLabel}!`);
    }

    // Get current state
    const currentState = getCanvasState();

    // Initialize if first save for this image
    if (!imageStates[currentImageLabel]) {
      imageStates[currentImageLabel] = cloneImageData(currentState);
      // Ensure undoStackByImage is initialized for this image label
      if (!undoStackByImage[currentImageLabel]) {
        undoStackByImage[currentImageLabel] = [];
      }
      undoStackByImage[currentImageLabel].push({
        state: cloneImageData(currentState),
        type: 'initial',
        label: null
      });
      updateStrokeCounter();
      return;
    }

    // Only save if we're not in the middle of a stroke or if forced
    if (!force && strokeInProgress) return;

    // Don't save if it's identical to the last state
    const lastState = imageStates[currentImageLabel];
    if (lastState && !force) {
      const currentData = currentState.data;
      const lastData = lastState.data;
      let identical = true;
      for (let i = 0; i < currentData.length; i += 4) {
        if (currentData[i] !== lastData[i] ||
                    currentData[i + 1] !== lastData[i + 1] ||
                    currentData[i + 2] !== lastData[i + 2] ||
                    currentData[i + 3] !== lastData[i + 3]) {
          identical = false;
          break;
        }
      }
      if (identical) return;
    }

    // For line strokes, assign the next label before saving
    let strokeLabel = null;
    if (!isDrawingOrPasting && !strokeInProgress && incrementLabel && updateStrokeList) {
      // *** ADDED DETAILED LOGS ***
      //             console.log(`[Save State] Entering stroke update block.`);
            
      // Get the suggested next label with priority:
      // 1) labelsByImage (immediate next)
      // 2) manualTagByImage (manual sequence mode)
      // 3) getNextLabel (gap-filling mode)
      const suggestedLabel = labelsByImage[currentImageLabel] || 
                                  (window.manualTagByImage && window.manualTagByImage[currentImageLabel]) ||
                                  getNextLabel(currentImageLabel);
      //             console.log(`[Save State] Suggested next label = "${suggestedLabel}" from labelsByImage[${currentImageLabel}]`);
            
      // *** FIX: Ensure the new stroke gets a UNIQUE label ***
      strokeLabel = generateUniqueStrokeName(suggestedLabel);
      //             console.log(`[Save State] Assigned UNIQUE strokeLabel = "${strokeLabel}"`);
            
      // Auto-select the newly created stroke to ensure it gets focus
      selectedStrokeByImage[currentImageLabel] = strokeLabel;
      //             console.log(`[Save State] Auto-selected newly created stroke: ${strokeLabel}`);
            
      // Also add to multi-selection array for action panel
      if (!multipleSelectedStrokesByImage[currentImageLabel]) {
        multipleSelectedStrokesByImage[currentImageLabel] = [];
      }
      // Clear any previous selections and add only this stroke
      multipleSelectedStrokesByImage[currentImageLabel] = [strokeLabel];
            
      // Set the newly created stroke flag for focus handling
      window.newlyCreatedStroke = {
        label: strokeLabel,
        image: currentImageLabel,
        timestamp: Date.now()
      };
            
      // Only add the *unique* stroke label to the strokes list
      if (!lineStrokesByImage[currentImageLabel]) {
        //                 console.log(`[Save State] Initializing lineStrokesByImage[${currentImageLabel}] as []`);
        lineStrokesByImage[currentImageLabel] = []; // Initialize if it doesn't exist
      }
            
      // Check if unique stroke label already exists before pushing (shouldn't happen with generateUniqueStrokeName)
      const labelAlreadyExists = lineStrokesByImage[currentImageLabel].includes(strokeLabel);
            
      //             console.log(`[Save State] BEFORE push: lineStrokesByImage[${currentImageLabel}] =`, JSON.parse(JSON.stringify(lineStrokesByImage[currentImageLabel])));
            
      if (!labelAlreadyExists && updateStrokeList) {
        lineStrokesByImage[currentImageLabel].push(strokeLabel); // Push the unique label
        //                 console.log(`[Save State] AFTER push: lineStrokesByImage[${currentImageLabel}] =`, JSON.parse(JSON.stringify(lineStrokesByImage[currentImageLabel])));
                
        // NOW increment the label counter after the stroke is pushed
        let nextLabel;
                
        // Check if this was a manually-set tag (user typed it in)
        if (window.manualTagByImage && window.manualTagByImage[currentImageLabel] === strokeLabel) {
          // User manually set this tag (e.g., D7) - increment from it without gap-filling
          if (typeof window.calculateNextTagFrom === 'function') {
            nextLabel = window.calculateNextTagFrom(strokeLabel);
                        
            // Check if the incremented tag already exists (e.g., filling gap F6 → F7, but F7 exists)
            // Keep incrementing until we find one that doesn't exist
            const existingStrokes = lineStrokesByImage[currentImageLabel] || [];
            const baseTags = existingStrokes.map(tag => tag.replace(/\(\d+\)$/, ''));
            while (baseTags.includes(nextLabel)) {
              nextLabel = window.calculateNextTagFrom(nextLabel);
            }
                        
            console.log(`[Save State] Manual tag ${strokeLabel} used, next available: ${nextLabel}`);
            // Keep the manual tag flag pointing to the next tag to continue the sequence
            window.manualTagByImage[currentImageLabel] = nextLabel;
          } else {
            nextLabel = getNextLabel(currentImageLabel);
            delete window.manualTagByImage[currentImageLabel];
          }
        } else {
          // Normal flow - use gap-filling logic
          nextLabel = getNextLabel(currentImageLabel);
        }
                
        labelsByImage[currentImageLabel] = nextLabel;
        //                 console.log(`[Save State] Incremented labelsByImage[${currentImageLabel}] to "${nextLabel}"`);
      } else {
        // This case should ideally not be reached if generateUniqueStrokeName works correctly
        console.warn(`[Save State] Generated unique stroke label "${strokeLabel}" already exists? Not pushing again.`);
      }
            
      // Initialize visibility, data etc. using the unique strokeLabel
      strokeVisibilityByImage[currentImageLabel] = strokeVisibilityByImage[currentImageLabel] || {};
      strokeVisibilityByImage[currentImageLabel][strokeLabel] = true;
            
      strokeLabelVisibility[currentImageLabel] = strokeLabelVisibility[currentImageLabel] || {};
      strokeLabelVisibility[currentImageLabel][strokeLabel] = true;
            
      strokeDataByImage[currentImageLabel] = strokeDataByImage[currentImageLabel] || {};
      strokeDataByImage[currentImageLabel][strokeLabel] = {
        preState: currentStroke ? cloneImageData(currentStroke) : null,
        postState: cloneImageData(currentState)
      };
    }

    // --- FIX: Handle temporary vector data --- 
    const tempStrokeKey = '_drawingStroke';
    let drawnVectorData = null;
    if (strokeLabel && vectorStrokesByImage[currentImageLabel] && vectorStrokesByImage[currentImageLabel][tempStrokeKey]) {
      drawnVectorData = JSON.parse(JSON.stringify(vectorStrokesByImage[currentImageLabel][tempStrokeKey]));
      // Assign the drawn data to the final unique stroke label
      vectorStrokesByImage[currentImageLabel][strokeLabel] = drawnVectorData;
      // Remove the temporary data
      delete vectorStrokesByImage[currentImageLabel][tempStrokeKey];

      // **NEW**: Invalidate anchor cache when stroke is completed
      window.invalidateAnchorCache(currentImageLabel);
      //             console.log(`[Save State] Moved vector data from ${tempStrokeKey} to ${strokeLabel}`);
    } else if (strokeLabel) {
      console.warn(`[Save State] No temporary vector data found at ${tempStrokeKey} for stroke ${strokeLabel}`);
      // Attempt to find vector data if it somehow got assigned to the suggested label during draw (fallback)
      const suggestedLabel = labelsByImage[currentImageLabel]; // Get the label *before* incrementing
      if (vectorStrokesByImage[currentImageLabel] && vectorStrokesByImage[currentImageLabel][suggestedLabel]) {
        //                 console.log(`[Save State] Fallback: Found data under suggested label ${suggestedLabel}`);
        drawnVectorData = JSON.parse(JSON.stringify(vectorStrokesByImage[currentImageLabel][suggestedLabel]));
        vectorStrokesByImage[currentImageLabel][strokeLabel] = drawnVectorData;
        // Optionally delete the data under suggestedLabel if it shouldn't be there
        // delete vectorStrokesByImage[currentImageLabel][suggestedLabel]; 
      }
    }
    // --- END FIX ---

    // Save new state and add to undo stack
    imageStates[currentImageLabel] = cloneImageData(currentState);
        
    // Determine the type of stroke
    let strokeType = 'other';
    if (force && strokeLabel) {
      strokeType = 'stroke';
            
      // Check for vector data to determine if it's a freehand, straight line, or curved line
      // Use the vector data we just potentially moved
      if (drawnVectorData) { 
        if (drawnVectorData.type === 'straight') {
          strokeType = 'line';
        } else if (drawnVectorData.type === 'freehand') {
          strokeType = 'stroke';
        } else if (drawnVectorData.type === 'curved') {
          strokeType = 'curve';
        }
      }
    }
        
    // Add to undo stack with stroke info
    const undoAction = {
      state: cloneImageData(currentState),
      type: strokeType,
      label: strokeLabel, // Use the unique label
      color: colorPicker.value, 
      width: parseInt(brushSize.value),
      // Store deep copies of label offset data for the current image
      customLabelPositions: customLabelPositions[currentImageLabel] ? JSON.parse(JSON.stringify(customLabelPositions[currentImageLabel])) : {},
      calculatedLabelOffsets: calculatedLabelOffsets[currentImageLabel] ? JSON.parse(JSON.stringify(calculatedLabelOffsets[currentImageLabel])) : {},
      rotationStamps: window.customLabelOffsetsRotationByImageAndStroke && window.customLabelOffsetsRotationByImageAndStroke[currentImageLabel]
        ? JSON.parse(JSON.stringify(window.customLabelOffsetsRotationByImageAndStroke[currentImageLabel]))
        : {},
      // CRITICAL FIX: Store complete vector data for all strokes to enable undo of control point modifications
      allVectorData: vectorStrokesByImage[currentImageLabel] ? JSON.parse(JSON.stringify(vectorStrokesByImage[currentImageLabel])) : {}
    };
        
    // Store vector data with the undo action if available
    // Use the data retrieved from the temporary key
    if (drawnVectorData) {
      undoAction.vectorData = drawnVectorData; 
    }
        
    undoStackByImage[currentImageLabel].push(undoAction);
        
    // Remove oldest state if we've reached max history
    if (undoStackByImage[currentImageLabel].length >= MAX_HISTORY) {
      undoStackByImage[currentImageLabel].shift();
    }

    // Clear redo stack when a new action is performed
    redoStackByImage[currentImageLabel] = [];

    updateStrokeCounter();
    updateSidebarStrokeCounts();
  }

  function undo() {
    //         console.log(`Attempting to undo in ${currentImageLabel} workspace`);
    //         console.log(`Current undo stack: ${undoStackByImage[currentImageLabel]?.length || 0} items`);
    //         console.log(`Current strokes: ${lineStrokesByImage[currentImageLabel]?.join(', ') || 'none'}`);
        
    // Check global undo stack first for image deletions
    if (window.globalUndoStack && window.globalUndoStack.length > 0) {
      const lastGlobalAction = window.globalUndoStack[window.globalUndoStack.length - 1];
            
      if (lastGlobalAction.type === 'delete-image') {
        const imageData = window.globalUndoStack.pop();
        console.log(`[undo] Restoring deleted image: ${imageData.label}`);
                
        // Restore the image to the gallery
        restoreDeletedImage(imageData);
                
        // Push to global redo stack
        if (!window.globalRedoStack) {
          window.globalRedoStack = [];
        }
        window.globalRedoStack.push(imageData);
        return;
      }
    }
        
    const currentStack = undoStackByImage[currentImageLabel];
    if (currentStack && currentStack.length > 1) { // Keep at least one state (initial)
      // Get the state we're undoing from
      const lastAction = currentStack.pop();
      //             console.log(`Undoing action of type: ${lastAction.type}, label: ${lastAction.label || 'none'}`);
            
      // Add to redo stack
      redoStackByImage[currentImageLabel] = redoStackByImage[currentImageLabel] || [];
      redoStackByImage[currentImageLabel].push(lastAction);
      //             console.log(`Added to redo stack, now has ${redoStackByImage[currentImageLabel].length} items`);
            
      // Skip certain state types when undoing
      if (lastAction.type === 'pre-stroke') {
        //                 console.log('Skipping pre-stroke state');
        // If we encounter a pre-stroke state, undo again to get to the previous complete state
        if (currentStack.length > 1) {
          return undo();
        }
      }
            
      // Handle snapshot type (created when switching views)
      if (lastAction.type === 'snapshot') {
        //                 console.log('Restoring from snapshot state');
        // If we have stored strokes in the snapshot, restore them
        if (lastAction.strokes) {
          lineStrokesByImage[currentImageLabel] = [...(lastAction.strokes || [])];
          //                     console.log(`Restored strokes: ${lineStrokesByImage[currentImageLabel].join(', ')}`);
        }
                
        // Continue to next undo action if possible
        if (currentStack.length > 1) {
          return undo();
        }
      }
            
      // Get the state we're going back to
      const previousState = currentStack[currentStack.length - 1];
            
      if (lastAction.type === 'line' || lastAction.type === 'stroke' || lastAction.type === 'curve') {
        // Remove the last stroke and its label
        if (lineStrokesByImage[currentImageLabel] && lineStrokesByImage[currentImageLabel].length > 0) {
          const removedStroke = lineStrokesByImage[currentImageLabel].pop();
          //                     console.log(`Removed stroke: ${removedStroke}`);
                    
          // Also remove from visibility tracking
          if (strokeVisibilityByImage[currentImageLabel] && strokeVisibilityByImage[currentImageLabel][removedStroke]) {
            delete strokeVisibilityByImage[currentImageLabel][removedStroke];
          }
                    
          // Also remove from label visibility tracking
          if (strokeLabelVisibility[currentImageLabel] && strokeLabelVisibility[currentImageLabel][removedStroke]) {
            // Save label visibility in lastAction for possible redo
            lastAction.labelVisible = strokeLabelVisibility[currentImageLabel][removedStroke];
            delete strokeLabelVisibility[currentImageLabel][removedStroke];
          }
                    
          // Also remove from stroke data tracking
          if (strokeDataByImage[currentImageLabel] && strokeDataByImage[currentImageLabel][removedStroke]) {
            delete strokeDataByImage[currentImageLabel][removedStroke];
          }
                    
          // Remove measurements tracking
          if (strokeMeasurements[currentImageLabel] && strokeMeasurements[currentImageLabel][removedStroke]) {
            // Save measurement data in lastAction for possible redo
            lastAction.measurementData = strokeMeasurements[currentImageLabel][removedStroke];
            delete strokeMeasurements[currentImageLabel][removedStroke];
            //                         console.log(`Removed measurement data for stroke: ${removedStroke}`);
          }
                    
          // Remove vector stroke data
          if (vectorStrokesByImage[currentImageLabel] && vectorStrokesByImage[currentImageLabel][removedStroke]) {
            // Save vector data in lastAction for possible redo
            lastAction.vectorData = vectorStrokesByImage[currentImageLabel][removedStroke];
            delete vectorStrokesByImage[currentImageLabel][removedStroke];
          }
                
          // If this was the last stroke, reset to A1
          if (lineStrokesByImage[currentImageLabel].length === 0) {
            labelsByImage[currentImageLabel] = 'A1';
            //                         console.log(`All strokes undone, reset label counter to A1`);
          } else {
            // Set the next label to be the one we just removed
            if (lastAction.label) {
              labelsByImage[currentImageLabel] = lastAction.label;
              //                     console.log(`Reset label counter to: ${lastAction.label}`);
            }
          }
        }
      }
            
      // Handle delete-strokes action
      if (lastAction.type === 'delete-strokes') {
        // Create a local map of the current visibility state to preserve it
        const currentVisibility = {};
        if (strokeVisibilityByImage[lastAction.image]) {
          // Save current visibility state of all existing strokes
          Object.keys(strokeVisibilityByImage[lastAction.image]).forEach(strokeId => {
            currentVisibility[strokeId] = strokeVisibilityByImage[lastAction.image][strokeId];
          });
        }

        // Restore the exact, full order of strokes as it was before the deletion
        if (lastAction.strokes) { // lastAction.strokes is now preDeleteStrokeOrder
          lineStrokesByImage[lastAction.image] = [...lastAction.strokes];
        } else {
          // Fallback if preDeleteStrokeOrder wasn't captured (should not happen ideally)
          lineStrokesByImage[lastAction.image] = [];
        }

        // Ensure strokeVisibilityByImage exists for this image
        if (!strokeVisibilityByImage[lastAction.image]) {
          strokeVisibilityByImage[lastAction.image] = {};
        }

        // First, preserve visibility for all non-deleted strokes
        lineStrokesByImage[lastAction.image].forEach(strokeLabel => {
          // If it wasn't one of the deleted strokes and has current visibility, preserve it
          if (lastAction.deletedStrokeLabels && !lastAction.deletedStrokeLabels.includes(strokeLabel)) {
            if (currentVisibility[strokeLabel] !== undefined) {
              strokeVisibilityByImage[lastAction.image][strokeLabel] = currentVisibility[strokeLabel];
            } else {
              // If not in current visibility map, default to visible
              strokeVisibilityByImage[lastAction.image][strokeLabel] = true;
            }
          }
        });

        // Now restore data ONLY for the strokes that were part of this specific delete action
        if (lastAction.deletedStrokeLabels) {
          lastAction.deletedStrokeLabels.forEach(strokeLabel => {
            // Restore vector data
            if (lastAction.vectorData && lastAction.vectorData[strokeLabel]) {
              if (!vectorStrokesByImage[lastAction.image]) {
                vectorStrokesByImage[lastAction.image] = {};
              }
              vectorStrokesByImage[lastAction.image][strokeLabel] = JSON.parse(JSON.stringify(lastAction.vectorData[strokeLabel]));
            }
                        
            // Restore visibility - explicitly ensuring it's set to visible
            if (!strokeVisibilityByImage[lastAction.image]) {
              strokeVisibilityByImage[lastAction.image] = {};
            }
            // Use the saved visibility if available, otherwise default to visible
            strokeVisibilityByImage[lastAction.image][strokeLabel] = 
                            (lastAction.visibility && lastAction.visibility[strokeLabel] !== undefined) 
                              ? lastAction.visibility[strokeLabel] 
                              : true;
                        
            // Restore label visibility with similar logic
            if (!strokeLabelVisibility[lastAction.image]) {
              strokeLabelVisibility[lastAction.image] = {};
            }
            strokeLabelVisibility[lastAction.image][strokeLabel] = 
                            (lastAction.labelVisibility && lastAction.labelVisibility[strokeLabel] !== undefined)
                              ? lastAction.labelVisibility[strokeLabel]
                              : true;
                        
            // Restore measurements
            if (lastAction.measurements && lastAction.measurements[strokeLabel]) {
              if (!strokeMeasurements[lastAction.image]) {
                strokeMeasurements[lastAction.image] = {};
              }
              strokeMeasurements[lastAction.image][strokeLabel] = JSON.parse(JSON.stringify(lastAction.measurements[strokeLabel]));
            }
                        
            // Restore custom label positions (CRITICAL!)
            if (lastAction.labelOffsets && lastAction.labelOffsets[strokeLabel]) {
              const posKey = `${lastAction.image}_${strokeLabel}`;
              if (!window.customLabelPositions) {
                window.customLabelPositions = {};
              }
              window.customLabelPositions[posKey] = JSON.parse(JSON.stringify(lastAction.labelOffsets[strokeLabel]));
                            
              // Also sync to localStorage
              syncLabelOffsetsToStorage(posKey, window.customLabelPositions[posKey]);
            }
          });
        }
                
        // Restore selection to the previously selected (and now restored) strokes
        if (lastAction.deletedStrokeLabels && lastAction.deletedStrokeLabels.length > 0) {
          multipleSelectedStrokesByImage[lastAction.image] = [...lastAction.deletedStrokeLabels];
          if (lastAction.deletedStrokeLabels.length === 1) {
            selectedStrokeByImage[lastAction.image] = lastAction.deletedStrokeLabels[0];
          } else {
            selectedStrokeByImage[lastAction.image] = null; 
          }
        } else {
          multipleSelectedStrokesByImage[lastAction.image] = [];
          selectedStrokeByImage[lastAction.image] = null;
        }
                
        // Set current image to the image the strokes belong to if different
        if (currentImageLabel !== lastAction.image) {
          switchToImage(lastAction.image);
        }
      }
            
      // Ensure we have a valid previous state
      if (previousState && previousState.state) {
        // CRITICAL FIX: Restore vector data for control point undo functionality
        if (previousState.allVectorData) {
          vectorStrokesByImage[currentImageLabel] = JSON.parse(JSON.stringify(previousState.allVectorData));
          // **NEW**: Invalidate anchor cache when vector data is restored from undo
          window.invalidateAnchorCache(currentImageLabel);
          //                     console.log('Vector data restored for undo');
        }
                
        // Restore the canvas state
        const stateToRestore = cloneImageData(previousState.state);
        imageStates[currentImageLabel] = stateToRestore;
        restoreCanvasState(stateToRestore);
        currentStroke = cloneImageData(stateToRestore);
        //                 console.log('Canvas state restored');

        // Restore label positions if they exist in the state
        if (previousState.customLabelPositions) {
          customLabelPositions[currentImageLabel] = JSON.parse(JSON.stringify(previousState.customLabelPositions));
          // SYNC FIX: Also restore to window.customLabelPositions
          if (!window.customLabelPositions[currentImageLabel]) {
            window.customLabelPositions[currentImageLabel] = {};
          }
          window.customLabelPositions[currentImageLabel] = JSON.parse(JSON.stringify(previousState.customLabelPositions));
        } else {
          // If not in state, ensure it's at least an empty object to prevent errors
          customLabelPositions[currentImageLabel] = {};
          if (!window.customLabelPositions[currentImageLabel]) {
            window.customLabelPositions[currentImageLabel] = {};
          }
        }
        if (previousState.calculatedLabelOffsets) {
          calculatedLabelOffsets[currentImageLabel] = JSON.parse(JSON.stringify(previousState.calculatedLabelOffsets));
        } else {
          calculatedLabelOffsets[currentImageLabel] = {};
        }
        // Restore rotation stamps if they exist in the state
        if (previousState.rotationStamps) {
          if (!window.customLabelOffsetsRotationByImageAndStroke) {
            window.customLabelOffsetsRotationByImageAndStroke = {};
          }
          window.customLabelOffsetsRotationByImageAndStroke[currentImageLabel] = JSON.parse(JSON.stringify(previousState.rotationStamps));
        } else {
          if (!window.customLabelOffsetsRotationByImageAndStroke) {
            window.customLabelOffsetsRotationByImageAndStroke = {};
          }
          window.customLabelOffsetsRotationByImageAndStroke[currentImageLabel] = {};
        }

      } else {
        //                 console.log('Warning: No valid previous state found');
        // Create a blank state if needed
        const blankState = ctx.createImageData(canvas.width, canvas.height);
        imageStates[currentImageLabel] = blankState;
        restoreCanvasState(blankState);
        currentStroke = cloneImageData(blankState);
      }
            
      updateStrokeCounter();
      updateStrokeVisibilityControls();
      updateSidebarStrokeCounts();
            
      // Force redraw after any undo operation to ensure visual consistency
      redrawCanvasWithVisibility();
            
      // Clear the manual next tag override so it recalculates based on existing strokes
      if (window.labelsByImage && window.labelsByImage[currentImageLabel]) {
        delete window.labelsByImage[currentImageLabel];
      }
            
      // If in manual sequence mode, recalculate the flag based on remaining strokes
      if (window.manualTagByImage && window.manualTagByImage[currentImageLabel] && typeof window.calculateNextTagFrom === 'function') {
        const remainingStrokes = lineStrokesByImage[currentImageLabel] || [];
        if (remainingStrokes.length > 0) {
          // Get base tags and filter to manual sequence
          const baseTags = remainingStrokes.map(tag => tag.replace(/\(\d+\)$/, ''));
          const currentManualTag = window.manualTagByImage[currentImageLabel];
          const manualLetter = currentManualTag.match(/^([A-Z])/)?.[1];
          const manualTags = baseTags.filter(tag => tag.match(/^([A-Z])/)?.[1] === manualLetter);
                    
          if (manualTags.length > 0) {
            // Sort and look for gaps
            const sorted = manualTags.sort((a, b) => {
              const matchA = a.match(/^([A-Z])(\d+)$/);
              const matchB = b.match(/^([A-Z])(\d+)$/);
              if (!matchA || !matchB) return a.localeCompare(b);
              return parseInt(matchA[2]) - parseInt(matchB[2]);
            });
                        
            let foundGap = null;
            for (let i = 0; i < sorted.length - 1; i++) {
              const match = sorted[i].match(/^([A-Z])(\d+)$/);
              const nextMatch = sorted[i + 1].match(/^([A-Z])(\d+)$/);
              if (match && nextMatch && parseInt(nextMatch[2]) > parseInt(match[2]) + 1) {
                foundGap = match[1] + (parseInt(match[2]) + 1);
                break;
              }
            }
                        
            if (foundGap) {
              window.manualTagByImage[currentImageLabel] = foundGap;
              console.log(`[undo] Found gap in manual sequence: ${foundGap}`);
            } else {
              const lastTag = sorted[sorted.length - 1];
              const nextManualTag = window.calculateNextTagFrom(lastTag);
              window.manualTagByImage[currentImageLabel] = nextManualTag;
              console.log(`[undo] No gaps, recalculated: ${lastTag} → ${nextManualTag}`);
            }
          } else {
            delete window.manualTagByImage[currentImageLabel];
            console.log('[undo] No manual tags found, cleared flag');
          }
        } else {
          delete window.manualTagByImage[currentImageLabel];
          console.log('[undo] No strokes left, cleared manual flag');
        }
      }
            
      // Update next tag display after any undo operation
      if (typeof window.updateNextTagDisplay === 'function') {
        window.updateNextTagDisplay();
      }
            
      // For delete-stroke undo operations, ensure a complete redraw to avoid visual glitches
      if (lastAction && lastAction.type === 'delete-strokes') {
        // Short delay to ensure all state is updated before final redraw
        setTimeout(() => {
          redrawCanvasWithVisibility();
        }, 50);
      }
    } else if (currentStack && currentStack.length === 1) {
      // We're at the initial state
      //             console.log('At initial state, resetting workspace');
      const initialState = currentStack[0];
            
      // Clear all stroke data
      lineStrokesByImage[currentImageLabel] = [];
      strokeVisibilityByImage[currentImageLabel] = {};
      strokeLabelVisibility[currentImageLabel] = {};
      vectorStrokesByImage[currentImageLabel] = {};
      strokeDataByImage[currentImageLabel] = {};

      // **NEW**: Clear anchor cache when clearing strokes
      window.invalidateAnchorCache(currentImageLabel);
            
      // Reset label counter
      labelsByImage[currentImageLabel] = 'A1';  // Reset to A1
            
      if (initialState && initialState.state) {
        imageStates[currentImageLabel] = cloneImageData(initialState.state);
        restoreCanvasState(initialState.state);
        currentStroke = cloneImageData(initialState.state);

        // Restore label positions if they exist in the initial state
        if (initialState.customLabelPositions) {
          customLabelPositions[currentImageLabel] = JSON.parse(JSON.stringify(initialState.customLabelPositions));
          // SYNC FIX: Also restore to window.customLabelPositions
          if (!window.customLabelPositions[currentImageLabel]) {
            window.customLabelPositions[currentImageLabel] = {};
          }
          window.customLabelPositions[currentImageLabel] = JSON.parse(JSON.stringify(initialState.customLabelPositions));
        } else {
          customLabelPositions[currentImageLabel] = {};
          if (!window.customLabelPositions[currentImageLabel]) {
            window.customLabelPositions[currentImageLabel] = {};
          }
        }
        if (initialState.calculatedLabelOffsets) {
          calculatedLabelOffsets[currentImageLabel] = JSON.parse(JSON.stringify(initialState.calculatedLabelOffsets));
        } else {
          calculatedLabelOffsets[currentImageLabel] = {};
        }

      } else if (window.originalImages[currentImageLabel]) {
        // If we have the original image, redraw it
        //                 console.log('Redrawing from original image');
        const img = new Image();
        img.onload = () => {
          // Clear the canvas first
          ctx.clearRect(0, 0, canvas.width, canvas.height);
                    
          // Get the current scale
          const scale = window.imageScaleByLabel[currentImageLabel];
          const scaledWidth = img.width * scale;
          const scaledHeight = img.height * scale;
                    
          // Calculate base position (center of canvas)
          const centerX = (canvas.width - scaledWidth) / 2;
          const centerY = (canvas.height - scaledHeight) / 2;
                    
          // Apply position offset
          const offsetX = imagePositionByLabel[currentImageLabel].x;
          const offsetY = imagePositionByLabel[currentImageLabel].y;
                    
          // Calculate final position
          const x = centerX + offsetX;
          const y = centerY + offsetY;
                    
          // Draw the original image with scale and position
          ctx.drawImage(img, x, y, scaledWidth, scaledHeight);
                    
          // Save this as the new state
          const newState = getCanvasState();
          imageStates[currentImageLabel] = cloneImageData(newState);
          currentStroke = cloneImageData(newState);
        };
        img.src = window.originalImages[currentImageLabel];
      }
            
      updateStrokeCounter();
      updateStrokeVisibilityControls();
      updateSidebarStrokeCounts();
            
      // Force redraw to ensure visual consistency
      redrawCanvasWithVisibility();
            
      // Update next tag display to reflect the restored stroke state
      if (typeof window.updateNextTagDisplay === 'function') {
        window.updateNextTagDisplay();
      }
    } else {
      //             console.log('No undo history available for this workspace');
    }
  }
    
  function redo() {
    //         console.log(`Attempting to redo in ${currentImageLabel} workspace`);
    //         console.log(`Current redo stack: ${redoStackByImage[currentImageLabel]?.length || 0} items`);
        
    // Check global redo stack first for image deletions
    if (window.globalRedoStack && window.globalRedoStack.length > 0) {
      const lastGlobalAction = window.globalRedoStack[window.globalRedoStack.length - 1];
            
      if (lastGlobalAction.type === 'delete-image') {
        const imageData = window.globalRedoStack.pop();
        console.log(`[redo] Re-deleting image: ${imageData.label}`);
                
        // Find the image container to delete again
        const imageList = document.getElementById('imageList');
        if (imageList) {
          const containers = imageList.querySelectorAll('.image-container');
          containers.forEach(container => {
            if (container.dataset.label === imageData.label) {
              // Delete the image again (this will push to globalUndoStack)
              deleteImage(imageData.label, container);
            }
          });
        }
        return;
      }
    }
        
    const redoStack = redoStackByImage[currentImageLabel];
    if (redoStack && redoStack.length > 0) {
      // Get the action to redo
      const actionToRedo = redoStack.pop();
      //             console.log(`Redoing action of type: ${actionToRedo.type}, label: ${actionToRedo.label || 'none'}`);
            
      // Add back to undo stack
      undoStackByImage[currentImageLabel].push(actionToRedo);
            
      // Handle delete-strokes action
      if (actionToRedo.type === 'delete-strokes') {
        // Delete strokes again (only the ones that were originally deleted)
        if (actionToRedo.deletedStrokeLabels) {
          actionToRedo.deletedStrokeLabels.forEach(strokeLabel => {
            // Remove from vector data
            if (vectorStrokesByImage[actionToRedo.image] && vectorStrokesByImage[actionToRedo.image][strokeLabel]) {
              delete vectorStrokesByImage[actionToRedo.image][strokeLabel];
            }
                    
            // Remove from visibility tracking
            if (strokeVisibilityByImage[actionToRedo.image] && strokeVisibilityByImage[actionToRedo.image][strokeLabel]) {
              delete strokeVisibilityByImage[actionToRedo.image][strokeLabel];
            }
                    
            // Remove from label visibility tracking
            if (strokeLabelVisibility[actionToRedo.image] && strokeLabelVisibility[actionToRedo.image][strokeLabel]) {
              delete strokeLabelVisibility[actionToRedo.image][strokeLabel];
            }
                    
            // Remove from measurements
            if (strokeMeasurements[actionToRedo.image] && strokeMeasurements[actionToRedo.image][strokeLabel]) {
              delete strokeMeasurements[actionToRedo.image][strokeLabel];
            }
                        
            // Remove custom label positions (CRITICAL!)
            const posKey = `${actionToRedo.image}_${strokeLabel}`;
            if (window.customLabelPositions && window.customLabelPositions[posKey]) {
              delete window.customLabelPositions[posKey];
              localStorage.removeItem(`labelOffset_${posKey}`);
            }
            if (window.calculatedLabelOffsets && window.calculatedLabelOffsets[posKey]) {
              delete window.calculatedLabelOffsets[posKey];
            }
                    
            // Remove from line strokes
            if (lineStrokesByImage[actionToRedo.image]) {
              lineStrokesByImage[actionToRedo.image] = lineStrokesByImage[actionToRedo.image].filter(label => label !== strokeLabel);
            }
          });
        }
                
        // Clear selection
        multipleSelectedStrokesByImage[actionToRedo.image] = [];
        selectedStrokeByImage[actionToRedo.image] = null;
                
        // Clear the manual next tag override so it recalculates based on existing strokes
        if (window.labelsByImage && window.labelsByImage[actionToRedo.image]) {
          delete window.labelsByImage[actionToRedo.image];
        }
                
        // If in manual sequence mode, recalculate the flag based on remaining strokes
        if (window.manualTagByImage && window.manualTagByImage[actionToRedo.image] && typeof window.calculateNextTagFrom === 'function') {
          const remainingStrokes = lineStrokesByImage[actionToRedo.image] || [];
          if (remainingStrokes.length > 0) {
            // Get base tags and filter to manual sequence
            const baseTags = remainingStrokes.map(tag => tag.replace(/\(\d+\)$/, ''));
            const currentManualTag = window.manualTagByImage[actionToRedo.image];
            const manualLetter = currentManualTag.match(/^([A-Z])/)?.[1];
            const manualTags = baseTags.filter(tag => tag.match(/^([A-Z])/)?.[1] === manualLetter);
                        
            if (manualTags.length > 0) {
              // Sort and look for gaps
              const sorted = manualTags.sort((a, b) => {
                const matchA = a.match(/^([A-Z])(\d+)$/);
                const matchB = b.match(/^([A-Z])(\d+)$/);
                if (!matchA || !matchB) return a.localeCompare(b);
                return parseInt(matchA[2]) - parseInt(matchB[2]);
              });
                            
              let foundGap = null;
              for (let i = 0; i < sorted.length - 1; i++) {
                const match = sorted[i].match(/^([A-Z])(\d+)$/);
                const nextMatch = sorted[i + 1].match(/^([A-Z])(\d+)$/);
                if (match && nextMatch && parseInt(nextMatch[2]) > parseInt(match[2]) + 1) {
                  foundGap = match[1] + (parseInt(match[2]) + 1);
                  break;
                }
              }
                            
              if (foundGap) {
                window.manualTagByImage[actionToRedo.image] = foundGap;
                console.log(`[redo] Found gap in manual sequence: ${foundGap}`);
              } else {
                const lastTag = sorted[sorted.length - 1];
                const nextManualTag = window.calculateNextTagFrom(lastTag);
                window.manualTagByImage[actionToRedo.image] = nextManualTag;
                console.log(`[redo] No gaps, recalculated: ${lastTag} → ${nextManualTag}`);
              }
            } else {
              delete window.manualTagByImage[actionToRedo.image];
              console.log('[redo] No manual tags found, cleared flag');
            }
          } else {
            delete window.manualTagByImage[actionToRedo.image];
            console.log('[redo] No strokes left, cleared manual flag');
          }
        }
                
        // Update next tag display when redoing a deletion
        if (typeof window.updateNextTagDisplay === 'function') {
          window.updateNextTagDisplay();
        }
      }
      // Handle stroke type actions (freehand strokes, straight lines, and curved lines)
      else if ((actionToRedo.type === 'line' || actionToRedo.type === 'stroke' || actionToRedo.type === 'curve') && actionToRedo.label) {
        // Add the stroke back to the list
        lineStrokesByImage[currentImageLabel] = lineStrokesByImage[currentImageLabel] || [];
        lineStrokesByImage[currentImageLabel].push(actionToRedo.label);
        //                 console.log(`Added stroke back: ${actionToRedo.label}`);
                
        // Restore stroke visibility
        strokeVisibilityByImage[currentImageLabel] = strokeVisibilityByImage[currentImageLabel] || {};
        strokeVisibilityByImage[currentImageLabel][actionToRedo.label] = true;
                
        // Restore stroke data if we have it
        if (actionToRedo.strokeData) {
          strokeDataByImage[currentImageLabel] = strokeDataByImage[currentImageLabel] || {};
          strokeDataByImage[currentImageLabel][actionToRedo.label] = actionToRedo.strokeData;
        }
                
        // Restore vector data if we have it
        if (actionToRedo.vectorData) {
          vectorStrokesByImage[currentImageLabel] = vectorStrokesByImage[currentImageLabel] || {};
          vectorStrokesByImage[currentImageLabel][actionToRedo.label] = actionToRedo.vectorData;
          // **NEW**: Invalidate anchor cache when vector data is restored from redo
          window.invalidateAnchorCache(currentImageLabel);
                    
          // If no vector data saved in the action, but we're redoing a line/stroke/curve,
          // try to recreate basic vector data to ensure label display
          if (!actionToRedo.vectorData && 
                        (actionToRedo.type === 'line' || actionToRedo.type === 'stroke' || actionToRedo.type === 'curve')) {
            // Create minimal vector data to ensure label display
            let strokeType = 'freehand';
            if (actionToRedo.type === 'line') strokeType = 'straight';
            else if (actionToRedo.type === 'curve') strokeType = 'curved';
                        
            vectorStrokesByImage[currentImageLabel][actionToRedo.label] = {
              points: [
                { x: canvas.width/2 - 50, y: canvas.height/2 }, // Dummy points
                { x: canvas.width/2 + 50, y: canvas.height/2 }
              ],
              color: actionToRedo.color || '#000000',
              width: 5,
              type: strokeType,
              // For curved lines, add dummy control points
              controlPoints: strokeType === 'curved' ? [
                { x: canvas.width/2 - 50, y: canvas.height/2 },
                { x: canvas.width/2 + 50, y: canvas.height/2 }
              ] : undefined,
              dashSettings: { enabled: false, style: 'solid', pattern: [], dashLength: 5, gapLength: 5 } // Default dash settings
            };
          }
        }
                
        // Restore label visibility if we have it
        if (actionToRedo.labelVisible !== undefined) {
          strokeLabelVisibility[currentImageLabel] = strokeLabelVisibility[currentImageLabel] || {};
          strokeLabelVisibility[currentImageLabel][actionToRedo.label] = actionToRedo.labelVisible;
        } else {
          // Default to visible for new strokes and redone strokes without saved value
          strokeLabelVisibility[currentImageLabel] = strokeLabelVisibility[currentImageLabel] || {};
          strokeLabelVisibility[currentImageLabel][actionToRedo.label] = true;
        }
                
        // Restore measurement data if we have it
        if (actionToRedo.measurementData) {
          strokeMeasurements[currentImageLabel] = strokeMeasurements[currentImageLabel] || {};
          strokeMeasurements[currentImageLabel][actionToRedo.label] = actionToRedo.measurementData;
          //                     console.log(`Restored measurement data for stroke: ${actionToRedo.label}`);
        }
                
        // Update the next label - make sure it's one higher than the redone label
        const numPart = parseInt(actionToRedo.label.slice(1));
        if (!isNaN(numPart)) {
          const letterPart = actionToRedo.label[0];
          const nextNum = numPart + 1;
          const nextLabel = nextNum > 9 
            ? String.fromCharCode(letterPart.charCodeAt(0) + 1) + '0' 
            : letterPart + nextNum;
          labelsByImage[currentImageLabel] = nextLabel;
          //                     console.log(`Set next label to: ${nextLabel}`);
        } else {
          // Fallback to the standard next label function
          labelsByImage[currentImageLabel] = getNextLabel(currentImageLabel);
          //                 console.log(`Set next label to: ${labelsByImage[currentImageLabel]}`);
        }
      }
            
      // Restore the state
      if (actionToRedo.state) {
        const stateToRestore = cloneImageData(actionToRedo.state);
        imageStates[currentImageLabel] = stateToRestore;
        restoreCanvasState(stateToRestore);
        currentStroke = cloneImageData(stateToRestore);
        //                 console.log('Canvas state restored for redo');

        // Restore label positions if they exist in the action
        if (actionToRedo.customLabelPositions) {
          customLabelPositions[currentImageLabel] = JSON.parse(JSON.stringify(actionToRedo.customLabelPositions));
          // SYNC FIX: Also restore to window.customLabelPositions
          if (!window.customLabelPositions[currentImageLabel]) {
            window.customLabelPositions[currentImageLabel] = {};
          }
          window.customLabelPositions[currentImageLabel] = JSON.parse(JSON.stringify(actionToRedo.customLabelPositions));
        } else {
          // If not in state, ensure it's at least an empty object to prevent errors
          customLabelPositions[currentImageLabel] = {};
          if (!window.customLabelPositions[currentImageLabel]) {
            window.customLabelPositions[currentImageLabel] = {};
          }
        }
        if (actionToRedo.calculatedLabelOffsets) {
          calculatedLabelOffsets[currentImageLabel] = JSON.parse(JSON.stringify(actionToRedo.calculatedLabelOffsets));
        } else {
          calculatedLabelOffsets[currentImageLabel] = {};
        }
      }
            
      // Update all UI elements
      updateStrokeCounter();
      updateStrokeVisibilityControls();
      updateSidebarStrokeCounts();
            
      // Force redraw with visibility to ensure labels appear immediately
      redrawCanvasWithVisibility();
            
      // Update next tag display to reflect the redone stroke state
      if (typeof window.updateNextTagDisplay === 'function') {
        window.updateNextTagDisplay();
      }
    } else {
      //             console.log('No redo actions available for this workspace');
    }
  }

  // Save initial blank state
  //    saveState();

  // Set canvas size
  let pendingResizeFrame = null;
  let pendingResizeWidth = null;
  let pendingResizeHeight = null;

  function getAvailableCanvasSize() {
    const parent = canvas.parentElement;
    const rect = parent ? parent.getBoundingClientRect() : null;
    const margin = 16;
    const isVisible = (el) => el && el.offsetParent !== null;

    let leftReserve = 0;
    ['toolsPanel', 'strokePanel'].forEach((id) => {
      const el = document.getElementById(id);
      if (isVisible(el)) {
        const elRect = el.getBoundingClientRect();
        leftReserve = Math.max(leftReserve, Math.ceil(elRect.right) + margin);
      }
    });

    let rightReserve = 0;
    ['projectPanel', 'imagePanel'].forEach((id) => {
      const el = document.getElementById(id);
      if (isVisible(el)) {
        const elRect = el.getBoundingClientRect();
        rightReserve = Math.max(rightReserve, Math.ceil(window.innerWidth - elRect.left) + margin);
      }
    });

    let reservedTop = 0;
    const topToolbar = document.getElementById('topToolbar');
    if (isVisible(topToolbar)) {
      const toolbarRect = topToolbar.getBoundingClientRect();
      reservedTop = Math.max(reservedTop, Math.ceil(toolbarRect.bottom));
    }

    let reservedBottom = 16;
    const bottomControls = document.getElementById('canvasControls');
    if (isVisible(bottomControls)) {
      const controlsRect = bottomControls.getBoundingClientRect();
      reservedBottom = Math.max(reservedBottom, Math.ceil(window.innerHeight - controlsRect.top));
    }

    const widthByWindow = Math.max(320, Math.floor(window.innerWidth - leftReserve - rightReserve));
    const heightByWindow = Math.max(240, Math.floor(window.innerHeight - reservedTop - reservedBottom));

    const widthFromParent = rect ? Math.max(1, Math.floor(rect.width)) : 0;
    const heightFromParent = rect ? Math.max(1, Math.floor(rect.height)) : 0;

    const width = Math.max(1, widthByWindow || widthFromParent);
    const height = Math.max(1, heightByWindow || heightFromParent);

    return {
      width,
      height,
      leftReserve,
      rightReserve,
      reservedTop,
      reservedBottom
    };
  }

  function applyResize(width, height) {
    // Always use legacy resize system for consistency
    // The new viewport controller causes coordinate mismatches when switching between
    // blank canvas and canvas with strokes
    const viewportController = window.paintApp.state.viewportController;
    if (viewportController && viewportController.removeOverlay) {
      viewportController.removeOverlay();
    }
        
    // Legacy resize system
    canvas.style.cursor = 'crosshair';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const available = getAvailableCanvasSize();
    console.log(`[applyResize] Called with available: ${available.width}x${available.height}`);

    // Canvas should fill the entire available space (no 4:3 constraint on canvas element)
    let targetWidth = typeof width === 'number' ? width : available.width;
    let targetHeight = typeof height === 'number' ? height : available.height;
        
    targetWidth = Math.max(1, targetWidth);
    targetHeight = Math.max(1, targetHeight);

    const previousSize = window.__lastCanvasSize || { width: canvas.width, height: canvas.height };
    const sizeChanged = previousSize.width !== targetWidth || previousSize.height !== targetHeight;

    if (sizeChanged) {
      showResizeOverlay(targetWidth, targetHeight);
    }

    // Update canvas dimensions (bitmap and CSS) BEFORE recalculating fit scale
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    canvas.style.width = `${targetWidth}px`;
    canvas.style.height = `${targetHeight}px`;
    canvas.style.left = '0px';
    canvas.style.top = '0px';
    canvas.style.position = 'fixed';
        
    // Force browser to recognize the new dimensions
    canvas.style.maxWidth = 'none';
    canvas.style.maxHeight = 'none';
    canvas.style.minWidth = `${targetWidth}px`;
    canvas.style.minHeight = `${targetHeight}px`;

    console.log(`[applyResize] Set canvas dimensions: ${targetWidth}x${targetHeight}, actual: ${canvas.clientWidth}x${canvas.clientHeight}`);

    window.__lastCanvasSize = { width: targetWidth, height: targetHeight };

    // Update capture frame to maintain size and position
    const captureFrame = document.getElementById('captureFrame');
    if (captureFrame) {
      const current = currentImageLabel;
      const savedRatios = window.manualFrameRatios && window.manualFrameRatios[current];
            
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
                
        console.log(`[applyResize] Scaled manual frame: ${frameWidth.toFixed(1)}x${frameHeight.toFixed(1)} (${(savedRatios.widthRatio * 100).toFixed(1)}% x ${(savedRatios.heightRatio * 100).toFixed(1)}%) at (${boundedLeft.toFixed(1)}, ${boundedTop.toFixed(1)})`);
      } else {
        // No manual resize - use legacy default 800x600 or fit to canvas
        let frameWidth = 800;  // Legacy default
        let frameHeight = 600; // Legacy default
                
        // If canvas is smaller than 800x600, scale down to fit
        if (targetWidth < 800 || targetHeight < 600) {
          const aspectRatio = 4 / 3;
          if (targetWidth / targetHeight > aspectRatio) {
            frameHeight = targetHeight * 0.9;
            frameWidth = frameHeight * aspectRatio;
          } else {
            frameWidth = targetWidth * 0.9;
            frameHeight = frameWidth / aspectRatio;
          }
        }
                
        // Center the frame on the canvas
        const frameLeft = (targetWidth - frameWidth) / 2;
        const frameTop = (targetHeight - frameHeight) / 2;
                
        captureFrame.style.width = `${frameWidth}px`;
        captureFrame.style.height = `${frameHeight}px`;
        captureFrame.style.left = `${frameLeft}px`;
        captureFrame.style.top = `${frameTop}px`;
                
        console.log(`[applyResize] Legacy default frame: ${frameWidth.toFixed(1)}x${frameHeight.toFixed(1)} at (${frameLeft.toFixed(1)}, ${frameTop.toFixed(1)})`);
      }
    }
        
    // Recalculate and apply fit scale for current image to maintain proper zoom level
    const isCaptureLocked = captureFrame?.classList.contains('locked');

    const current = currentImageLabel;
    if (current && window.originalImageDimensions?.[current]) {
      const { width: imgWidth, height: imgHeight } = window.originalImageDimensions[current];
      if (imgWidth > 0 && imgHeight > 0 && (!isCaptureLocked || sizeChanged)) {
        // Store old scale to detect changes
        const oldScale = window.imageScaleByLabel[current] || 1.0;
                
        const savedSession = window.getFitSession ? window.getFitSession(current) : null;
        const fitMode = savedSession?.mode || 'fit-width';
        const { scale, position } = calculateFitScale(fitMode);

        window.imageScaleByLabel[current] = scale;
        window.imagePositionByLabel[current] = { ...position };

        console.log(`[applyResize] Canvas: ${targetWidth}x${targetHeight}, Image: ${imgWidth}x${imgHeight}, Mode: ${fitMode}, Scale: ${oldScale.toFixed(3)} → ${scale.toFixed(3)}, Pos: (${position.x.toFixed(1)}, ${position.y.toFixed(1)})`);
      }
    }

    redrawCanvasWithVisibility();

    const newState = getCanvasState();
    imageStates[currentImageLabel] = cloneImageData(newState);
    currentStroke = cloneImageData(newState);

    if (sizeChanged) {
      hideResizeOverlay();
    }

    pendingResizeWidth = null;
    pendingResizeHeight = null;
  }

  function resizeCanvas() {
    const { width, height } = getAvailableCanvasSize();
    pendingResizeWidth = width;
    pendingResizeHeight = height;

    if (!pendingResizeFrame) {
      pendingResizeFrame = requestAnimationFrame(() => {
        pendingResizeFrame = null;
        applyResize(pendingResizeWidth, pendingResizeHeight);
      });
    }
  }

  // Expose resizeCanvas globally so project manager can call it after loading
  window.resizeCanvas = resizeCanvas;
    
  applyResize();
  window.addEventListener('resize', resizeCanvas);

  // Drawing state - use references to uiState for centralized management
  let isDrawing = window.paintApp.uiState.isDrawing;
  let lastX = window.paintApp.uiState.lastX;
  let lastY = window.paintApp.uiState.lastY;
  let points = window.paintApp.uiState.points;
  let lastVelocity = window.paintApp.uiState.lastVelocity;
  let mouseDownPosition = window.paintApp.uiState.mouseDownPosition;
  let curveJustCompleted = window.paintApp.uiState.curveJustCompleted;
  let drawingMode = window.paintApp.uiState.drawingMode;
  let previousDrawingMode = window.paintApp.state.previousDrawingMode;
  let straightLineStart = window.paintApp.uiState.straightLineStart;
  let curvedLinePoints = window.paintApp.uiState.curvedLinePoints;
  let lastDrawnPoint = window.paintApp.uiState.lastDrawnPoint;
    
  // Click vs drag detection constant - use reference to config
  const MINIMUM_DRAG_DISTANCE = window.paintApp.config.MINIMUM_DRAG_DISTANCE;
    
  // Performance optimization constants for arrow rendering
  const ARROW_PERFORMANCE_CACHE = {
    // Pre-calculated trigonometry for 30-degree arrowheads
    ARROW_TAN_30: Math.tan(Math.PI / 6), // ~0.577
        
    // Clear cache at start of new render cycle (kept for compatibility)
    clearCache: function() {
      // No longer needed but kept for compatibility
    }
  };

  // F3: Centralized coordinate transform utilities
    
  // New viewport-aware coordinate transform helpers
  window.clientToWorld = function clientToWorld(clientX, clientY) {
    // Always use legacy system for coordinate transforms
    return canvasToImageCoords(clientX, clientY);
  };
    
  // Special coordinate transformation for text that always applies rotation
  function imageToCanvasCoords_ForText(imageX, imageY, params = null) {
    if (!params) params = getTransformationParams();
    
    const { scale, position, dimensions, hasImage } = params;
    // FORCE rotation to be applied for text - ignore any stroke rendering flags
    const rotation = params.rotation || 0;
    
    console.log('[TEXT COORD DEBUG] Applying rotation:', (rotation * 180 / Math.PI).toFixed(1) + '°', 'for text coords');
    
    // For blank canvas (no image), use center-based scaling
    if (!hasImage || !dimensions) {
      const canvasCenter = { x: canvas.width / 2, y: canvas.height / 2 };
      
      // Apply scaling from center, then add position offset
      let scaledX = (imageX - canvasCenter.x) * scale + canvasCenter.x;
      let scaledY = (imageY - canvasCenter.y) * scale + canvasCenter.y;
      
      // Apply rotation if needed
      if (rotation !== 0) {
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        const dx = scaledX - canvasCenter.x;
        const dy = scaledY - canvasCenter.y;
        scaledX = canvasCenter.x + (dx * cos - dy * sin);
        scaledY = canvasCenter.y + (dx * sin + dy * cos);
      }
      
      return {
        x: scaledX + position.x,
        y: scaledY + position.y
      };
    }
    
    // CENTER-BASED TRANSFORMATION for images
    const canvasCenterX = canvas.width / 2;
    const canvasCenterY = canvas.height / 2;
    const panX = position.x || 0;
    const panY = position.y || 0;
    
    const imageCenterX = dimensions.width / 2;
    const imageCenterY = dimensions.height / 2;
    
    // 1. Translate to image center
    const relativeX = (imageX - imageCenterX) * scale;
    const relativeY = (imageY - imageCenterY) * scale;
    
    // 2. Apply rotation
    let rotatedX = relativeX;
    let rotatedY = relativeY;
    if (rotation !== 0) {
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      rotatedX = relativeX * cos - relativeY * sin;
      rotatedY = relativeX * sin + relativeY * cos;
    }
    
    // 3. Translate to canvas center and add pan offset
    const canvasX = canvasCenterX + rotatedX + panX;
    const canvasY = canvasCenterY + rotatedY + panY;
    
    return { x: canvasX, y: canvasY };
  }

  window.worldToClient = function worldToClient(worldX, worldY) {
    // Use special text coordinate transformation that always applies rotation
    const result = imageToCanvasCoords_ForText(worldX, worldY);
    const params = getTransformationParams();
    const rotationDegrees = (params.rotation * 180 / Math.PI).toFixed(1);
    console.log('[WORLD-TO-CLIENT DEBUG] Input:', {x: worldX, y: worldY}, 'Output:', result, 'Rotation:', rotationDegrees + '°');
    return result;
  };
    
  // Enhanced coordinate transform that works with both systems
  window.getPointerCoords = function getPointerCoords(event) {
    // Always use legacy system for coordinate transforms
    const canvasCoords = { x: event.offsetX, y: event.offsetY };
    const imageCoords = getTransformedCoords(canvasCoords.x, canvasCoords.y);
    
        
    return {
      client: canvasCoords,
      world: imageCoords,
      canvas: canvasCoords,
      image: imageCoords
    };
  };
    
  window.toCanvas = function toCanvas(imagePoint, imgLabel = currentImageLabel) {
    const scale = window.imageScaleByLabel[imgLabel] || 1.0;
    const position = imagePositionByLabel[imgLabel] || { x: 0, y: 0 };
    const dimensionsObject = window.originalImageDimensions;
    const dims = dimensionsObject ? dimensionsObject[imgLabel] : undefined;
    const noImageLoaded = !window.originalImages || !window.originalImages[imgLabel];
    const rotation = window.imageRotationByLabel ? (window.imageRotationByLabel[imgLabel] || 0) : 0;
        
    // console.log(`[toCanvas] INPUT: imagePoint(${imagePoint.x}, ${imagePoint.y}), imgLabel=${imgLabel}`);
    // console.log(`[toCanvas] scale=${scale}, position=(${position.x}, ${position.y}), rotation=${rotation}`);
    // console.log(`[toCanvas] dims=`, dims, `noImageLoaded=${noImageLoaded}`);
        
    if (noImageLoaded || (dims && dims.width === canvas.width && dims.height === canvas.height)) {
      // For blank canvas, use canvas center as origin with offset and scale
      const canvasCenter = { x: canvas.width / 2, y: canvas.height / 2 };
            
      // Apply scaling from center, then add position offset
      let scaledX = (imagePoint.x - canvasCenter.x) * scale + canvasCenter.x;
      let scaledY = (imagePoint.y - canvasCenter.y) * scale + canvasCenter.y;
            
      // Apply rotation if needed
      if (rotation !== 0) {
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        const dx = scaledX - canvasCenter.x;
        const dy = scaledY - canvasCenter.y;
        scaledX = canvasCenter.x + (dx * cos - dy * sin);
        scaledY = canvasCenter.y + (dx * sin + dy * cos);
      }
            
      const result = {
        x: scaledX + position.x,
        y: scaledY + position.y
      };
      // console.log(`[toCanvas] BLANK CANVAS mode: result=(${result.x}, ${result.y})`);
      return result;
    } else {
      // For images, calculate canvas position considering scale and pan
      // CRITICAL FIX: Use the exact same logic as redrawCanvasWithVisibility
      let imageX, imageY;
      let imageWidth, imageHeight;
            
      // Try to get the actual cached image to use its dimensions
      const imageUrl = window.originalImages[imgLabel];
      const cachedImg = imageUrl ? imageCache[imageUrl] : null;
            
      if (cachedImg) {
        // Use the same logic as redrawCanvasWithVisibility
        imageWidth = cachedImg.width;
        imageHeight = cachedImg.height;
        const centerX = (canvas.width - imageWidth * scale) / 2;
        const centerY = (canvas.height - imageHeight * scale) / 2;
        imageX = centerX + position.x;
        imageY = centerY + position.y;
        // console.log(`[toCanvas] Using cached image dims (${imageWidth}x${imageHeight}): centerX=${centerX}, centerY=${centerY}, imageX=${imageX}, imageY=${imageY}`);
      } else if (dims && dims.width > 0 && dims.height > 0) {
        // Fallback to stored dimensions
        imageWidth = dims.width;
        imageHeight = dims.height;
        const centerX = (canvas.width - imageWidth * scale) / 2;
        const centerY = (canvas.height - imageHeight * scale) / 2;
        imageX = centerX + position.x;
        imageY = centerY + position.y;
        // console.log(`[toCanvas] Using stored dims (${imageWidth}x${imageHeight}): centerX=${centerX}, centerY=${centerY}, imageX=${imageX}, imageY=${imageY}`);
      } else {
        imageX = canvas.width / 2 + position.x;
        imageY = canvas.height / 2 + position.y;
        imageWidth = canvas.width;
        imageHeight = canvas.height;
        // console.log(`[toCanvas] Fallback dims: imageX=${imageX}, imageY=${imageY}`);
      }
            
      // Apply scaling first
      let transformedX = imagePoint.x * scale;
      let transformedY = imagePoint.y * scale;
            
      // Apply rotation around image center if needed
      if (rotation !== 0) {
        const imageCenterX = imageWidth * scale / 2;
        const imageCenterY = imageHeight * scale / 2;
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        const dx = transformedX - imageCenterX;
        const dy = transformedY - imageCenterY;
        transformedX = imageCenterX + (dx * cos - dy * sin);
        transformedY = imageCenterY + (dx * sin + dy * cos);
      }
            
      const result = {
        x: imageX + transformedX,
        y: imageY + transformedY
      };
      // console.log(`[toCanvas] IMAGE mode: result=(${result.x}, ${result.y})`);
      return result;
    }
  };
    
  function toImage(canvasPoint, imgLabel = currentImageLabel) {
    const scale = window.imageScaleByLabel[imgLabel] || 1.0;
    const position = imagePositionByLabel[imgLabel] || { x: 0, y: 0 };
    const dimensionsObject = window.originalImageDimensions;
    const dims = dimensionsObject ? dimensionsObject[imgLabel] : undefined;
    const noImageLoaded = !window.originalImages || !window.originalImages[imgLabel];
        
    if (noImageLoaded || (dims && dims.width === canvas.width && dims.height === canvas.height)) {
      // For blank canvas, use canvas center as origin with offset and scale
      const canvasCenter = { x: canvas.width / 2, y: canvas.height / 2 };
      const positionAdjustedX = canvasPoint.x - position.x;
      const positionAdjustedY = canvasPoint.y - position.y;
      return {
        x: ((positionAdjustedX - canvasCenter.x) / scale) + canvasCenter.x,
        y: ((positionAdjustedY - canvasCenter.y) / scale) + canvasCenter.y
      };
    } else {
      // For images, calculate position considering scale and pan
      let imageX, imageY;
      if (dims && dims.width > 0 && dims.height > 0) {
        const centerX = (canvas.width - dims.width * scale) / 2;
        const centerY = (canvas.height - dims.height * scale) / 2;
        imageX = centerX + position.x;
        imageY = centerY + position.y;
      } else {
        imageX = canvas.width / 2 + position.x;
        imageY = canvas.height / 2 + position.y;
      }
            
      const relativeX = (canvasPoint.x - imageX) / scale;
      const relativeY = (canvasPoint.y - imageY) / scale;
      return { x: relativeX, y: relativeY };
    }
  }

  // *** UNIFIED COORDINATE TRANSFORMATION FUNCTIONS ***
  // These functions provide consistent coordinate transformations throughout the application
    
  /**
     * Get transformation parameters for the current image
     * @param {string} imageLabel - The image label to get parameters for
     * @returns {Object} Transformation parameters
     */
  function getTransformationParams(imageLabel = null) {
    const label = imageLabel || currentImageLabel;
    const scale = window.imageScaleByLabel[label] || 1;
    const position = imagePositionByLabel[label] || { x: 0, y: 0 };
    const dimensions = window.originalImageDimensions?.[label];
    const hasImage = !!(window.originalImages && window.originalImages[label]);
    // RESTORED: Include rotation so vectors and labels move with image content
    const rotation = window.imageRotationByLabel ? (window.imageRotationByLabel[label] || 0) : 0;
        
    return {
      scale,
      position,
      dimensions,
      hasImage,
      label,
      rotation
    };
  }

  // Make getTransformationParams available globally
  window.getTransformationParams = getTransformationParams;
  
  // Debug function to test text rotation
  window.debugTextRotation = function() {
    const currentLabel = window.paintApp.state.currentImageLabel || window.currentImageLabel || 'front';
    const currentRotation = window.imageRotationByLabel ? (window.imageRotationByLabel[currentLabel] || 0) : 0;
    const rotationDegrees = (currentRotation * 180 / Math.PI).toFixed(1);
    
    console.log('=== TEXT ROTATION DEBUG ===');
    console.log('Current image label:', currentLabel);
    console.log('Current rotation (radians):', currentRotation);
    console.log('Current rotation (degrees):', rotationDegrees);
    console.log('imageRotationByLabel object:', window.imageRotationByLabel);
    
    // Test rotation by applying 90 degrees for clearer visual difference
    const testRotation = 90 * Math.PI / 180;
    if (!window.imageRotationByLabel) window.imageRotationByLabel = {};
    window.imageRotationByLabel[currentLabel] = testRotation;
    
    console.log('Applied 90° test rotation');
    console.log('New rotation value:', window.imageRotationByLabel[currentLabel]);
    
    // Trigger redraw
    if (typeof redrawCanvasWithVisibility === 'function') {
      redrawCanvasWithVisibility();
    }
    
    return {
      label: currentLabel,
      oldRotation: currentRotation,
      newRotation: testRotation,
      rotationDegrees: 90
    };
  };
  
  // Function to convert existing text elements to use image coordinates
  window.convertTextToImageCoords = function(targetLabel = null) {
    const currentLabel = targetLabel || window.paintApp.state.currentImageLabel || window.currentImageLabel || 'front';
    const textElements = window.paintApp.state.textElementsByImage?.[currentLabel];
    
    if (!textElements || textElements.length === 0) {
      console.log('No text elements found for', currentLabel);
      return;
    }
    
    const transformParams = window.getTransformationParams ? window.getTransformationParams(currentLabel) : null;
    if (!transformParams || !transformParams.hasImage) {
      console.log('No image found for', currentLabel, transformParams);
      return;
    }
    
    let converted = 0;
    textElements.forEach(element => {
      if (element.useCanvasCoords) {
        console.log('[CONVERT] Converting element', element.id, 'from canvas to image coords');
        console.log('[CONVERT] Original coords:', element.x, element.y);
        
        // Convert canvas coordinates to image coordinates
        const imageCoords = window.canvasToImageCoords ? 
          window.canvasToImageCoords(element.x, element.y, transformParams) : 
          {x: element.x, y: element.y};
        
        element.x = imageCoords.x;
        element.y = imageCoords.y;
        element.useCanvasCoords = false;
        converted++;
        
        console.log('[CONVERT] New image coords:', element.x, element.y);
      }
    });
    
    console.log(`[CONVERT] Converted ${converted} text elements to image coordinates`);
    
    // Trigger redraw
    if (typeof redrawCanvasWithVisibility === 'function') {
      redrawCanvasWithVisibility();
    }
    
    return {
      label: currentLabel,
      converted: converted,
      total: textElements.length
    };
  };
  
  // Function to convert ALL text elements across all images
  window.convertAllTextToImageCoords = function() {
    if (!window.paintApp.state.textElementsByImage) {
      console.log('No text elements found');
      return { totalConverted: 0, totalImages: 0 };
    }
    
    let totalConverted = 0;
    let totalImages = 0;
    
    Object.keys(window.paintApp.state.textElementsByImage).forEach(imageLabel => {
      console.log(`[CONVERT ALL] Processing image: ${imageLabel}`);
      const result = window.convertTextToImageCoords(imageLabel);
      if (result) {
        totalConverted += result.converted;
        totalImages++;
      }
    });
    
    console.log(`[CONVERT ALL] Total: ${totalConverted} text elements converted across ${totalImages} images`);
    return { totalConverted, totalImages };
  };
  
  // Auto-fix text elements on initialization
  window.autoFixTextRotation = function() {
    console.log('[AUTO-FIX] Checking for text elements that need rotation fix...');
    
    // Wait for paint app to be ready
    if (!window.paintApp || !window.paintApp.state) {
      console.log('[AUTO-FIX] Paint app not ready, will retry in 1 second');
      setTimeout(window.autoFixTextRotation, 1000);
      return;
    }
    
    // Convert all text elements to use image coordinates
    const result = window.convertAllTextToImageCoords();
    
    if (result.totalConverted > 0) {
      console.log(`[AUTO-FIX] ✅ Fixed ${result.totalConverted} text elements for rotation`);
    } else {
      console.log('[AUTO-FIX] ✅ All text elements already using correct coordinates');
    }
  };
  
  // Function to force fix a specific text element that keeps reverting
  window.forceFixTextElement = function(elementId) {
    const currentLabel = window.paintApp.state.currentImageLabel || window.currentImageLabel || 'front';
    const textElements = window.paintApp.state.textElementsByImage?.[currentLabel];
    
    if (!textElements) {
      console.log('No text elements found for', currentLabel);
      return;
    }
    
    const element = textElements.find(el => el.id === elementId);
    if (!element) {
      console.log('Element not found:', elementId);
      return;
    }
    
    console.log('[FORCE FIX] Element before:', {
      id: element.id,
      useCanvasCoords: element.useCanvasCoords,
      coords: {x: element.x, y: element.y}
    });
    
    if (element.useCanvasCoords) {
      const transformParams = window.getTransformationParams ? window.getTransformationParams(currentLabel) : null;
      if (transformParams && transformParams.hasImage) {
        const imageCoords = window.canvasToImageCoords ? 
          window.canvasToImageCoords(element.x, element.y, transformParams) : 
          {x: element.x, y: element.y};
        
        element.x = imageCoords.x;
        element.y = imageCoords.y;
        element.useCanvasCoords = false;
        
        console.log('[FORCE FIX] Element after:', {
          id: element.id,
          useCanvasCoords: element.useCanvasCoords,
          coords: {x: element.x, y: element.y}
        });
        
        // Trigger redraw
        if (typeof redrawCanvasWithVisibility === 'function') {
          redrawCanvasWithVisibility();
        }
        
        return { fixed: true, element: element };
      }
    }
    
    console.log('[FORCE FIX] Element already using image coords or no image found');
    return { fixed: false, element: element };
  };
    
  /**
     * Convert image-space coordinates to canvas coordinates using center-based transformation
     * @param {number} imageX - X coordinate in image space
     * @param {number} imageY - Y coordinate in image space  
     * @param {Object} params - Transformation parameters (optional, will get current if not provided)
     * @returns {Object} Canvas coordinates {x, y}
     */
  function imageToCanvasCoords(imageX, imageY, params = null) {
    if (!params) params = getTransformationParams();
        
    const { scale, position, dimensions, hasImage } = params;
    // If we're drawing while the canvas context is already rotated, skip applying rotation in math
    // to avoid double rotation of vectors/anchors
    const rotation = (window.__renderContextRotatedForStrokes || params.__renderContextRotated) ? 0 : (params.rotation || 0);
    
    // Debug rotation suppression for text coordinates (only in development)
    if (false && (window.__renderContextRotatedForStrokes || params.__renderContextRotated) && params.rotation !== 0) {
      console.log('[ROTATION DEBUG] Rotation suppressed - renderContextRotated flag is true, rotation would be:', (params.rotation * 180 / Math.PI).toFixed(1) + '°');
    }
        
    // For blank canvas (no image), use center-based scaling
    if (!hasImage || !dimensions) {
      const canvasCenter = { x: canvas.width / 2, y: canvas.height / 2 };
            
      // Apply scaling from center, then add position offset
      let scaledX = (imageX - canvasCenter.x) * scale + canvasCenter.x;
      let scaledY = (imageY - canvasCenter.y) * scale + canvasCenter.y;
            
      // Apply rotation if needed
      if (rotation !== 0) {
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        const dx = scaledX - canvasCenter.x;
        const dy = scaledY - canvasCenter.y;
        scaledX = canvasCenter.x + (dx * cos - dy * sin);
        scaledY = canvasCenter.y + (dx * sin + dy * cos);
      }
            
      return {
        x: scaledX + position.x,
        y: scaledY + position.y
      };
    }
        
    // CENTER-BASED TRANSFORMATION for images (fixes rotation drift)
    // 1. Image center in original image space
    const imageCenterX = dimensions.width / 2;
    const imageCenterY = dimensions.height / 2;
    
    // 2. Recenter point relative to image center and apply uniform scale
    const dx = (imageX - imageCenterX) * scale;
    const dy = (imageY - imageCenterY) * scale;
    
    // 3. Apply rotation around origin (scaled image center)
    let rotatedX = dx;
    let rotatedY = dy;
    if (rotation !== 0) {
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      rotatedX = dx * cos - dy * sin;
      rotatedY = dx * sin + dy * cos;
      
    }
    
    // 4. Translate to canvas center and add pan offset
    const canvasCenterX = canvas.width / 2;
    const canvasCenterY = canvas.height / 2;
    const panX = position.x || 0;
    const panY = position.y || 0;
    
    const finalX = canvasCenterX + panX + rotatedX;
    const finalY = canvasCenterY + panY + rotatedY;
    
    
    return {
      x: finalX,
      y: finalY
    };
  }
    
  /**
     * Convert canvas coordinates to image-space coordinates
     * @param {number} canvasX - X coordinate in canvas space
     * @param {number} canvasY - Y coordinate in canvas space
     * @param {Object} params - Transformation parameters (optional, will get current if not provided)
     * @returns {Object} Image-space coordinates {x, y}
     */
  function canvasToImageCoords(canvasX, canvasY, params = null) {
    if (!params) params = getTransformationParams();
        
    const { scale, position, dimensions, hasImage, rotation } = params;
        
    // For blank canvas (no image), use center-based inverse scaling
    if (!hasImage || !dimensions) {
      const canvasCenter = { x: canvas.width / 2, y: canvas.height / 2 };
            
      // Remove position offset first
      let transformedX = canvasX - position.x;
      let transformedY = canvasY - position.y;
            
      // Apply inverse rotation if needed
      if (rotation !== 0) {
        const cos = Math.cos(-rotation); // Negative for inverse rotation
        const sin = Math.sin(-rotation);
        const dx = transformedX - canvasCenter.x;
        const dy = transformedY - canvasCenter.y;
        transformedX = canvasCenter.x + (dx * cos - dy * sin);
        transformedY = canvasCenter.y + (dx * sin + dy * cos);
      }
            
      // Apply inverse scaling from center
      return {
        x: (transformedX - canvasCenter.x) / scale + canvasCenter.x,
        y: (transformedY - canvasCenter.y) / scale + canvasCenter.y
      };
    }
        
    // CENTER-BASED INVERSE TRANSFORMATION for images
    // 1. Remove canvas center and pan offset
    const canvasCenterX = canvas.width / 2;
    const canvasCenterY = canvas.height / 2;
    const panX = position.x || 0;
    const panY = position.y || 0;
    
    const relativeX = canvasX - canvasCenterX - panX;
    const relativeY = canvasY - canvasCenterY - panY;
    
    // 2. Apply inverse rotation
    let unrotatedX = relativeX;
    let unrotatedY = relativeY;
    if (rotation !== 0) {
      const cos = Math.cos(-rotation); // Negative for inverse
      const sin = Math.sin(-rotation);
      unrotatedX = relativeX * cos - relativeY * sin;
      unrotatedY = relativeX * sin + relativeY * cos;
    }
    
    // 3. Inverse scale and add back image center
    const imageCenterX = dimensions.width / 2;
    const imageCenterY = dimensions.height / 2;
    
    const imageX = unrotatedX / scale + imageCenterX;
    const imageY = unrotatedY / scale + imageCenterY;
        
    return { x: imageX, y: imageY };
  }

  // Make canvasToImageCoords available globally
  window.canvasToImageCoords = canvasToImageCoords;
    
  /**
     * Legacy wrapper for backward compatibility
     * @deprecated Use canvasToImageCoords instead
     */
  function getTransformedCoords(canvasX, canvasY) {
    return canvasToImageCoords(canvasX, canvasY);
  }

  // --- LABEL REPROJECTION UTILITIES ---
  // Capture and preserve label canvas centers across image replacement
  window.__labelReprojectPreCenters = window.__labelReprojectPreCenters || {};
  window.__labelReprojectPreHash = window.__labelReprojectPreHash || {}; // { [label]: hash }
  window.__labelReprojectPending = window.__labelReprojectPending || {}; // { [label]: { offsets: { [stroke]: {x,y} } } }
  window.__labelAbsLockOnce = window.__labelAbsLockOnce || {};           // { [label]: { [stroke]: {x,y} } }
  window.__activeDrawMatrixHashByLabel = window.__activeDrawMatrixHashByLabel || {}; // { [label]: string }
  window.__lastActiveDrawParamsByLabel = window.__lastActiveDrawParamsByLabel || {}; // debug aid
  window.__labelOffsetWriteKeys = window.__labelOffsetWriteKeys || new Set(); // write-once keys
  window.__imageSessionByLabel = window.__imageSessionByLabel || {}; // { [label]: { id, phase, stableTicks, lastSig } }
  window.__anchorsVersionByLabel = window.__anchorsVersionByLabel || {}; // { [label]: number }
  window.__lastAnchorHashByLabel = window.__lastAnchorHashByLabel || {}; // { [label]: string }
  window.__shadowRebasedOffset = window.__shadowRebasedOffset || {}; // { [label]: { [stroke]: {x,y} } }

  function getTransformHash(params) {
    try {
      const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
      const obj = {
        label: params.label,
        scale: +params.scale,
        posX: +(params.position?.x || 0),
        posY: +(params.position?.y || 0),
        rot: +params.rotation,
        w: +(params.dimensions?.width || 0),
        h: +(params.dimensions?.height || 0),
        hasImage: !!params.hasImage,
        dpr: +dpr
      };
      return JSON.stringify(obj);
    } catch (_) {
      return Math.random().toString(36).slice(2);
    }
  }

  function tryCommitPendingReprojectionForLabel(imageLabel) {
    const pending = window.__labelReprojectPending && window.__labelReprojectPending[imageLabel];
    if (!pending || !pending.offsets) return;
    // Verify current active draw matrix hash matches recomputed params
    const paramsNow = getTransformationParams(imageLabel);
    const activeHash = window.__activeDrawMatrixHashByLabel[imageLabel];
    const thisHash = getTransformHash(paramsNow);
    // Require session to be Stable and hash match
    const sess = getImageSession(imageLabel);
    if (sess.phase === 'Stable' && activeHash && activeHash === thisHash) {
      // Commit offsets
      const offsets = pending.offsets;
      Object.keys(offsets).forEach(strokeLabel => {
        const off = offsets[strokeLabel];
        if (!off) return;
        const writeKey = `${imageLabel}:${strokeLabel}:${sess.id}`;
        if (window.__labelOffsetWriteKeys.has(writeKey)) return;

        // **FIX**: Check for shadow rebased offsets first (from background removal)
        let finalOffset = off;
        const shadowRebased = window.__shadowRebasedOffset &&
                                window.__shadowRebasedOffset[imageLabel] &&
                                window.__shadowRebasedOffset[imageLabel][strokeLabel];
        if (shadowRebased && typeof shadowRebased.x === 'number' && typeof shadowRebased.y === 'number') {
          finalOffset = shadowRebased;
          if (labelReprojectDebug()) console.log('[COMMIT] Using shadow rebased offset', { imageLabel, strokeLabel, shadowRebased });
        }

        // **NEW**: Check persistence guard before committing reprojected offsets
        if (window.checkPersistenceGuard(imageLabel, 'reproject_commit')) {
          // Prefer updating custom slot if it exists
          if (!window.customLabelPositions) window.customLabelPositions = {};
          if (!window.customLabelPositions[imageLabel]) window.customLabelPositions[imageLabel] = {};
          const userHadCustom = !!(window.customLabelPositions[imageLabel] && window.customLabelPositions[imageLabel][strokeLabel]);
          if (userHadCustom) {
            window.customLabelPositions[imageLabel][strokeLabel] = normalizeMaybeStore(finalOffset, imageLabel);
          } else {
            if (!window.calculatedLabelOffsets) window.calculatedLabelOffsets = {};
            if (!window.calculatedLabelOffsets[imageLabel]) window.calculatedLabelOffsets[imageLabel] = {};
            window.calculatedLabelOffsets[imageLabel][strokeLabel] = normalizeMaybeStore(finalOffset, imageLabel);
          }
        }
        window.__labelOffsetWriteKeys.add(writeKey);
        if (labelReprojectDebug()) console.log('[COMMIT] calculatedLabelOffsets persisted', { imageLabel, strokeLabel, sessionId: sess.id });
      });
      // Clear pending and any absolute locks
      delete window.__labelReprojectPending[imageLabel];
      // Clear ABS lock only after Stable commit
      if (window.__labelAbsLockOnce && window.__labelAbsLockOnce[imageLabel]) delete window.__labelAbsLockOnce[imageLabel];
      // Clear shadow rebase shim after successful reproject commit
      if (window.__shadowRebasedOffset && window.__shadowRebasedOffset[imageLabel]) delete window.__shadowRebasedOffset[imageLabel];
      if (labelReprojectDebug()) console.log(`[LABEL-REPROJECT] Committed ${Object.keys(offsets).length} offsets for ${imageLabel}`);
    } else {
      // Keep pending; absolute locks will keep visuals stable for this frame
      if (labelReprojectDebug()) console.log('[BLOCK] offset_write_blocked', { imageLabel, reason: (sess.phase!=='Stable'?'not_stable':'matrix_mismatch') });
    }
  }

  function validateCoordinateStability(imageLabel, strokeLabel) {
    try {
      const calculatedOffsets = window.calculatedLabelOffsets?.[imageLabel]?.[strokeLabel];
      const customPositions = window.customLabelPositions?.[imageLabel]?.[strokeLabel];

      if (calculatedOffsets || customPositions) {
        const offset = calculatedOffsets || customPositions;
        const anchor = getStrokeAnchorPoint(strokeLabel, imageLabel);

        if (anchor && offset) {
          const canvasPos = imageToCanvasCoords(anchor.x + offset.x, anchor.y + offset.y, getTransformationParams(imageLabel));
          console.log(`[COORD-VALIDATION] ${strokeLabel}: Anchor(${anchor.x.toFixed(1)},${anchor.y.toFixed(1)}) + Offset(${offset.x.toFixed(1)},${offset.y.toFixed(1)}) = Canvas(${canvasPos.x.toFixed(1)},${canvasPos.y.toFixed(1)})`);
        }
      }
    } catch (e) {
      console.warn('[COORD-VALIDATION] Error validating coordinates:', e);
    }
  }

  function getImageSession(label) {
    const sess = window.__imageSessionByLabel[label] || { id: 0, phase: 'Loading', stableTicks: 0, lastSig: '' };
    window.__imageSessionByLabel[label] = sess;
    return sess;
  }

  function bumpImageSession(label) {
    const sess = getImageSession(label);
    sess.id += 1;
    sess.phase = 'Computing';
    sess.stableTicks = 0;
    sess.lastSig = '';
    // reset write-once guard for this session
    // note: we do not clear previous keys, they are keyed by session id
    if (labelReprojectDebug()) console.log('[SESSION] bump', label, '->', sess.id);
  }

  function onSessionDrawTick(label, transformHash, anchorHash) {
    const sess = getImageSession(label);
    const sig = `${transformHash}|${anchorHash||''}`;
    if (sess.phase === 'Computing') sess.phase = 'WaitingStable';
    if (sess.phase === 'WaitingStable') {
      if (sig === sess.lastSig) {
        sess.stableTicks += 1;
        if (sess.stableTicks >= 2) {
          sess.phase = 'Stable';
          if (labelReprojectDebug()) console.log('[STABLE]', { label, sessionId: sess.id, ticks: sess.stableTicks });
        }
      } else {
        sess.lastSig = sig;
        sess.stableTicks = 1; // current tick counts as first
      }
    }
  }

  function computeAnchorHash(label) {
    try {
      const strokes = (window.lineStrokesByImage && window.lineStrokesByImage[label]) || [];
      const vectors = (window.vectorStrokesByImage && window.vectorStrokesByImage[label]) || {};
      const parts = [];
      strokes.forEach(s => {
        const v = vectors[s];
        if (!v || !v.points || v.points.length === 0) return;
        const a = getStrokeAnchorPoint(s, label);
        // round for stable hash
        parts.push(`${s}:${a.x.toFixed(1)}:${a.y.toFixed(1)}`);
      });
      return parts.join('|');
    } catch (_) { return ''; }
  }

  function isTransformDesynced(label) {
    try {
      const params = getTransformationParams(label);
      const scaleButton = document.getElementById('scaleButton');
      if (!scaleButton) return false;
      const m = scaleButton.textContent && scaleButton.textContent.match(/Scale: (\d+)%/);
      if (!m) return false;
      const ui = parseInt(m[1], 10) / 100;
      return Math.abs((params.scale || 1) - ui) > 1e-6;
    } catch (_) { return false; }
  }

  function getOffsetForStroke(imageLabel, strokeLabel) {
    // If shadow rebase exists during non-stable session, use it (visual only, not persisted)
    try {
      const sess = window.__imageSessionByLabel && window.__imageSessionByLabel[imageLabel];
      if (sess && sess.phase !== 'Stable') {
        const shadow = window.__shadowRebasedOffset && window.__shadowRebasedOffset[imageLabel] && window.__shadowRebasedOffset[imageLabel][strokeLabel];
        if (shadow && typeof shadow.x === 'number' && typeof shadow.y === 'number') {
          if (labelReprojectDebug()) console.log('[LOCK] using shadow rebase offset', { imageLabel, strokeLabel, shadow });
          return { x: shadow.x, y: shadow.y };
        }
      }
    } catch(_) {}
    // Prefer rotation-stable relative position
    const relMap = window.customLabelRelativePositions && window.customLabelRelativePositions[imageLabel];
    if (relMap && relMap[strokeLabel] && typeof window.convertRelativeToAbsolutePosition === 'function') {
      const absOffset = window.convertRelativeToAbsolutePosition(strokeLabel, relMap[strokeLabel], imageLabel);
      if (absOffset && typeof absOffset.x === 'number' && typeof absOffset.y === 'number') {
        return { x: absOffset.x, y: absOffset.y };
      }
    }
    // User-defined custom offset
    const customMap = (window.customLabelPositions && window.customLabelPositions[imageLabel]) || null;
    if (customMap && customMap[strokeLabel]) {
      const off = customMap[strokeLabel];
      const px = normalizeToPixels(off, imageLabel);
      if (px) return px;
    }
    // Calculated offset
    const calcMap = (window.calculatedLabelOffsets && window.calculatedLabelOffsets[imageLabel]) || null;
    if (calcMap && calcMap[strokeLabel]) {
      const off = calcMap[strokeLabel];
      const px = normalizeToPixels(off, imageLabel);
      if (px) return px;
    }
    // Default small offset upwards
    return { x: 10, y: -48 };
  }

  function normalizeToPixels(off, imageLabel) {
    if (!off) return null;
    if (typeof off.x === 'number' && typeof off.y === 'number') return { x: off.x, y: off.y };
    if (typeof off.dx_norm === 'number' && typeof off.dy_norm === 'number') {
      const dims = window.originalImageDimensions && window.originalImageDimensions[imageLabel];
      console.log(`[NORMALIZE-TO-PIXELS] imageLabel: ${imageLabel}, dims:`, dims);
      if (!dims || !dims.width || !dims.height) {
        console.log('[NORMALIZE-TO-PIXELS] Missing dimensions, returning {x: 0, y: 0}');
        return { x: 0, y: 0 };
      }
      const ref = (off.normRef === 'height') ? dims.height : (off.normRef === 'diag') ? Math.hypot(dims.width, dims.height) : dims.width;
      const result = { x: off.dx_norm * ref, y: off.dy_norm * ref };
      console.log(`[NORMALIZE-TO-PIXELS] ref: ${ref}, result:`, result);
      return result;
    }
    return null;
  }

  // Expose normalizeToPixels on window for use in project-manager.js
  window.normalizeToPixels = normalizeToPixels;

  function normalizeMaybeStore(off, imageLabel) {
    if (!off) return off;
    const dims = window.originalImageDimensions && window.originalImageDimensions[imageLabel];
    const refPx = (dims && dims.width) ? dims.width : 1; // normalize by width; avoid divide-by-zero
    const x = (typeof off.x === 'number' && isFinite(off.x)) ? off.x : 0;
    const y = (typeof off.y === 'number' && isFinite(off.y)) ? off.y : 0;
    return { kind: 'norm', dx_norm: x / refPx, dy_norm: y / refPx, normRef: 'width' };
  }

  function computeLabelCanvasCenter(imageLabel, strokeLabel) {
    try {
      // If an absolute tag center exists, prefer it
      const absCenter = (window.customLabelAbsolutePositions && window.customLabelAbsolutePositions[imageLabel])
        ? window.customLabelAbsolutePositions[imageLabel][strokeLabel]
        : null;

      const params = getTransformationParams(imageLabel);
      if (absCenter && typeof absCenter.x === 'number' && typeof absCenter.y === 'number') {
        const pt = imageToCanvasCoords(absCenter.x, absCenter.y, params);
        return pt && isFinite(pt.x) && isFinite(pt.y) ? pt : null;
      }

      // Otherwise compute from anchor + offset
      const anchor = getStrokeAnchorPoint(strokeLabel, imageLabel);
      if (!anchor || !isFinite(anchor.x) || !isFinite(anchor.y)) return null;

      const off = getOffsetForStroke(imageLabel, strokeLabel);
      const imgX = anchor.x + off.x;
      const imgY = anchor.y + off.y;
      const pt2 = imageToCanvasCoords(imgX, imgY, params);
      return pt2 && isFinite(pt2.x) && isFinite(pt2.y) ? pt2 : null;
    } catch (e) {
      if (labelReprojectDebug()) console.warn('[LABEL-REPROJECT] computeLabelCanvasCenter error for', imageLabel, strokeLabel, e);
      return null;
    }
  }

  function capturePreReplaceLabelCenters(imageLabel) {
    const map = {};
    try {
      const strokeOrder = (window.lineStrokesByImage && window.lineStrokesByImage[imageLabel]) || [];
      const vectors = (window.vectorStrokesByImage && window.vectorStrokesByImage[imageLabel]) || {};
      const labels = strokeOrder.length > 0 ? strokeOrder : Object.keys(vectors);
      // Stamp current transform hash used before replacement
      window.__labelReprojectPreHash[imageLabel] = getTransformHash(getTransformationParams(imageLabel));
      labels.forEach(lbl => {
        if (!vectors[lbl] || !vectors[lbl].points || vectors[lbl].points.length === 0) return;
        const center = computeLabelCanvasCenter(imageLabel, lbl);
        if (center) map[lbl] = center;
      });
    } catch (e) {
      if (labelReprojectDebug()) console.warn('[LABEL-REPROJECT] capturePreReplaceLabelCenters error for', imageLabel, e);
    }
    return map;
  }

  function applyPostReplaceReprojection(imageLabel) {
    try {
      const pre = window.__labelReprojectPreCenters && window.__labelReprojectPreCenters[imageLabel];
      if (!pre || Object.keys(pre).length === 0) return;

      const paramsNew = getTransformationParams(imageLabel);
      const dims = paramsNew.dimensions;
      const hashNow = getTransformHash(paramsNew);
      const activeHash = window.__activeDrawMatrixHashByLabel[imageLabel];
      const margin = 2;
      if (labelReprojectDebug()) {
        console.log('[XFORM]', {
          old: window.__labelReprojectPreHash[imageLabel],
          new: hashNow,
          draw: activeHash,
          scale: paramsNew.scale,
          pos: paramsNew.position,
          rot: paramsNew.rotation,
          dpr: (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1
        });
      }

      // If matrix mismatch, or strict parity fails, or session not stable, enqueue ABS_LOCK and defer
      const sess = getImageSession(imageLabel);
      const mismatch = !activeHash || activeHash !== hashNow;
      const parityFail = labelStrictEnabled() && isTransformDesynced(imageLabel);
      const defer = mismatch || parityFail || sess.phase !== 'Stable';
      const pending = {};

      Object.keys(pre).forEach(strokeLabel => {
        const Lc = pre[strokeLabel];
        if (!Lc) return;
        // Map desired canvas center back to image space under new transform
        const Limg = canvasToImageCoords(Lc.x, Lc.y, paramsNew);
        const anchorNew = getStrokeAnchorPoint(strokeLabel, imageLabel) || { x: 0, y: 0 };
        let dx = Limg.x - anchorNew.x;
        let dy = Limg.y - anchorNew.y;

        // Optional clamp to keep label center within image bounds
        if (dims && dims.width > 0 && dims.height > 0) {
          let finalX = anchorNew.x + dx;
          let finalY = anchorNew.y + dy;
          finalX = Math.max(margin, Math.min(dims.width - margin, finalX));
          finalY = Math.max(margin, Math.min(dims.height - margin, finalY));
          dx = finalX - anchorNew.x;
          dy = finalY - anchorNew.y;
        }

        pending[strokeLabel] = { x: dx, y: dy };

        if (defer) {
          // Place absolutely for this frame
          if (!window.__labelAbsLockOnce[imageLabel]) window.__labelAbsLockOnce[imageLabel] = {};
          window.__labelAbsLockOnce[imageLabel][strokeLabel] = { x: Lc.x, y: Lc.y };
        }
      });

      // Either persist immediately or hold pending until draw matrix stabilizes
      if (defer) {
        window.__labelReprojectPending[imageLabel] = { offsets: pending };
        if (labelReprojectDebug()) {
          const reason = mismatch ? 'matrix_mismatch' : (parityFail ? 'TransformDesync' : 'not_stable');
          console.log('[BLOCK] offset_write_blocked', { imageLabel, reason });
          console.log('[LABEL-REPROJECT] Defer committing offsets; applying ABS_LOCK_UNTIL_STABLE');
        }
      } else {
        // Commit directly
        Object.keys(pending).forEach(strokeLabel => {
          // Check if we have shadow rebased offsets to use instead
          let finalOffset = pending[strokeLabel];
          const shadowRebased = window.__shadowRebasedOffset &&
                                        window.__shadowRebasedOffset[imageLabel] &&
                                        window.__shadowRebasedOffset[imageLabel][strokeLabel];
          if (shadowRebased && typeof shadowRebased.x === 'number' && typeof shadowRebased.y === 'number') {
            finalOffset = shadowRebased;
            if (labelReprojectDebug()) console.log('[COMMIT] Using shadow rebased offset (immediate)', { imageLabel, strokeLabel, shadowRebased });
          }

          // **NEW**: Check persistence guard before immediate commit
          if (window.checkPersistenceGuard(imageLabel, 'immediate_commit')) {
            if (!window.customLabelPositions) window.customLabelPositions = {};
            if (!window.customLabelPositions[imageLabel]) window.customLabelPositions[imageLabel] = {};
            const userHadCustom = !!(window.customLabelPositions[imageLabel] && window.customLabelPositions[imageLabel][strokeLabel]);
            const storedVal = normalizeMaybeStore(finalOffset, imageLabel);
            const writeKey = `${imageLabel}:${strokeLabel}:${sess.id}`;
            if (!window.__labelOffsetWriteKeys.has(writeKey)) {
              if (userHadCustom) {
                window.customLabelPositions[imageLabel][strokeLabel] = storedVal;
              } else {
                if (!window.calculatedLabelOffsets) window.calculatedLabelOffsets = {};
                if (!window.calculatedLabelOffsets[imageLabel]) window.calculatedLabelOffsets[imageLabel] = {};
                window.calculatedLabelOffsets[imageLabel][strokeLabel] = storedVal;
              }
              window.__labelOffsetWriteKeys.add(writeKey);
            }
          }
          if (labelReprojectDebug()) {
            // Sanity check pixel error
            const anchorNew = getStrokeAnchorPoint(strokeLabel, imageLabel) || { x: 0, y: 0 };
            const fwd = imageToCanvasCoords(anchorNew.x + finalOffset.x, anchorNew.y + finalOffset.y, paramsNew);
            const Lc = pre[strokeLabel];
            const err = Lc && fwd ? Math.hypot((fwd.x - Lc.x), (fwd.y - Lc.y)) : null;
            console.log('[REPROJECT]', strokeLabel, {
              Lc_before: pre[strokeLabel], A_new: anchorNew, d_new: finalOffset, err: err != null ? err.toFixed(3) : 'n/a'
            });
          }
          if (labelReprojectDebug()) console.log('[COMMIT] calculatedLabelOffsets persisted', { imageLabel, strokeLabel, sessionId: sess.id });
        });
        if (labelReprojectDebug()) console.log(`[LABEL-REPROJECT] Committed ${Object.keys(pending).length} offsets immediately`);
        // Cleanup shadow rebase shim after successful commit
        if (window.__shadowRebasedOffset && window.__shadowRebasedOffset[imageLabel]) delete window.__shadowRebasedOffset[imageLabel];
      }

      // Clear pre-centers for this image
      delete window.__labelReprojectPreCenters[imageLabel];
      delete window.__labelReprojectPreHash[imageLabel];

      // Invalidate caches so redraw uses updated offsets
      try { invalidateInteractiveElementCache(); } catch (_) {}
    } catch (e) {
      if (labelReprojectDebug()) console.warn('[LABEL-REPROJECT] applyPostReplaceReprojection error for', imageLabel, e);
    }
  }

  // Helper function to deselect all strokes and clear edit mode
  function deselectAllStrokes() {
    //         console.log('Deselecting all strokes');
        
    // Clear selection state
    if (window.selectedStrokeByImage && window.currentImageLabel) {
      window.selectedStrokeByImage[window.currentImageLabel] = null;
    }
        
    if (window.multipleSelectedStrokesByImage && window.currentImageLabel) {
      window.multipleSelectedStrokesByImage[window.currentImageLabel] = [];
    }
        
    // Clear edit mode
    window.selectedStrokeInEditMode = null;
        
    // Defocus any active measurement inputs
    const measureTextElements = document.querySelectorAll('.stroke-measurement');
    measureTextElements.forEach(element => {
      if (element.contentEditable === 'true') {
        element.blur();
      }
    });
        
    // Update UI to reflect deselection
    updateStrokeVisibilityControls();
    redrawCanvasWithVisibility();
  }

  // Function to intelligently restore cursor based on current mouse position
  function restoreCursorAfterDrag(x, y) {
    // Check if we're hovering over a control point
    const controlPointAtPosition = findControlPointAtPosition(x, y);
    if (controlPointAtPosition && window.selectedStrokeInEditMode === controlPointAtPosition.strokeLabel) {
      canvas.style.cursor = 'grab';
      return;
    }
        
    // Check if we're hovering over a label - transform coordinates to match label positioning
    const currentImageLabel = window.currentImageLabel || window.paintApp?.state?.currentImageLabel || 'front';
    const transformParams = getTransformationParams(currentImageLabel);
    const imageCoords = canvasToImageCoords(x, y, transformParams);
    const canvasFromImage = imageToCanvasCoords(imageCoords.x, imageCoords.y, transformParams);
    const labelAtPosition = findLabelAtPoint(canvasFromImage.x, canvasFromImage.y);
    if (labelAtPosition) {
      canvas.style.cursor = 'pointer';
      return;
    }
        
    // Default cursor based on mode
    canvas.style.cursor = isShiftPressed ? 'grab' : 'crosshair';
  }

  // Helper function to restore previous drawing mode after text mode exit (made global for createTextBox)
  window.restorePreviousDrawingMode = function() {
    // Restore the drawing mode from before entering text mode
    drawingMode = previousDrawingMode;
    window.paintApp.uiState.drawingMode = previousDrawingMode;
        
    // Update UI to reflect the restored mode
    textModeToggle.classList.remove('text-mode-active');
        
    // Update drawing mode toggle classes based on restored mode
    drawingModeToggle.classList.remove('straight-mode', 'curved-mode');
    if (previousDrawingMode === 'straight') {
      drawingModeToggle.classList.add('straight-mode');
      arrowControls.style.display = 'flex';
      canvas.style.cursor = 'crosshair';
    } else if (previousDrawingMode === 'curved') {
      drawingModeToggle.classList.add('curved-mode');
      arrowControls.style.display = 'flex';
      canvas.style.cursor = 'crosshair';
    } else if (previousDrawingMode === 'freehand') {
      // No mode class for freehand
      arrowControls.style.display = 'none';
      canvas.style.cursor = 'crosshair';
    }
  };

  // Helper function to handle defocus clicks (single clicks that don't create strokes)
  function handleDefocusClick() {
    //         console.log('Single click detected - defocusing measurements');
        
    // Ensure newly created stroke flag is cleared to prevent re-focus
    // from a previous stroke creation when updateStrokeVisibilityControls is called.
    window.newlyCreatedStroke = null;

    // CURVE_DEFOCUS_FIX_3: Handle curve completion defocus: first click after curve finalization
    if (curveJustCompleted) {
      //             console.log('First click after curve completion - clearing flag and deselecting.');
      curveJustCompleted = false; // Clear the flag
      // Set flag to prevent re-focusing during defocus operation
      window.isDefocusingOperationInProgress = true;
      try {
        deselectAllStrokes(); // Deselect the just-completed curve (and any other selections)
      } finally {
        window.isDefocusingOperationInProgress = false;
      }
      // If this function was called from mousedown because curveJustCompleted was true,
      // the mousedown handler will see that handleDefocusClick processed it and will return,
      // preventing a new stroke from starting.
      return; // Indicate that the click was consumed by this specific defocus logic.
    }
        
    // For any other single click on the canvas that doesn't start a new stroke,
    // (e.g., called from mouseup when a drag wasn't long enough to create a stroke,
    // AND curveJustCompleted was already false)
    // ensure everything is deselected.
    //         console.log('General defocus click (not related to immediate curve completion) - deselecting all strokes.');
        
    // Defocus any active measurement inputs (including stroke visibility items)
    // This is generally good practice before wider UI updates.
    const activeElement = document.activeElement;
    if (activeElement && (
      (activeElement.classList && activeElement.classList.contains('measure-text')) ||
            activeElement.contentEditable === 'true' ||
            activeElement.tagName === 'INPUT' ||
            activeElement.tagName === 'TEXTAREA'
    )) {
      //             console.log('Defocusing active input element:', activeElement.className || activeElement.tagName);
      activeElement.blur();
    }
        
    // Also defocus any selected stroke measurements that might be focused
    // (though deselectAllStrokes should also handle this by making them non-editable)
    const allMeasureTexts = document.querySelectorAll('.stroke-measurement[contenteditable="true"]');
    allMeasureTexts.forEach(element => {
      if (element !== activeElement) {
        //                 console.log('Defocusing additional measurement element');
        element.blur();
      }
    });

    // Set flag to prevent re-focusing during defocus operation
    window.isDefocusingOperationInProgress = true;
    try {
      deselectAllStrokes(); // This handles clearing all selections, edit mode, 
      // and triggers UI updates (updateStrokeVisibilityControls and redrawCanvasWithVisibility).
    } finally {
      window.isDefocusingOperationInProgress = false;
    }
  }

  // Helper function to get canvas coordinates from image coordinates
  window.getCanvasCoords = function getCanvasCoords(imageX_relative, imageY_relative) {
    // *** ADDED DETAILED LOGGING ***
    //         console.log(`--- getCanvasCoords Called (Label Anchor?) ---`);
    //         console.log(`  Input Relative Coords: x=${imageX_relative}, y=${imageY_relative}`);

    const scale = window.imageScaleByLabel[currentImageLabel] || 1;
    const position = imagePositionByLabel[currentImageLabel] || { x: 0, y: 0 };
    //         console.log(`  Using: scale=${scale}, position=`, position);

    // Check if this is a blank canvas without an image
    const noImageLoaded = !window.originalImages || !window.originalImages[currentImageLabel];
        
    // Calculate the image position on canvas (TOP-LEFT CORNER)
    // *** MODIFIED CHECK ***
    const dimensionsObject = window.originalImageDimensions; // Use window property
    //         console.log(`  Checking Dimensions: dims object =`, dimensionsObject);
    const dims = dimensionsObject ? dimensionsObject[currentImageLabel] : undefined;
    //         console.log(`  Checking Dimensions: dims for ${currentImageLabel} =`, dims);
    // *** END MODIFIED CHECK ***
        
    // For blank canvas drawing, use the canvas coordinates directly but apply the offset
    if (noImageLoaded || (dims && dims.width === canvas.width && dims.height === canvas.height)) {
      //             console.log(`getCanvasCoords: BLANK CANVAS MODE - Applying scale and offset to coordinates`);
      // Apply both scaling and position offset in blank canvas mode
      const canvasCenter = {
        x: canvas.width / 2,
        y: canvas.height / 2
      };
      // Scale from center and add position offset
      const scaledX = (imageX_relative - canvasCenter.x) * scale + canvasCenter.x;
      const scaledY = (imageY_relative - canvasCenter.y) * scale + canvasCenter.y;
      const finalX = scaledX + position.x;
      const finalY = scaledY + position.y;
      //             console.log(`  Scaled Coords: x=${scaledX}, y=${scaledY}`);
      //             console.log(`  Final Canvas Coords: x=${finalX}, y=${finalY}`);
      //             console.log(`---------------------------------------------`);
      return { x: finalX, y: finalY };
    }

    let canvasImageTopLeftX, canvasImageTopLeftY;

    if (dims && dims.width > 0 && dims.height > 0) {
      const centerX = (canvas.width - dims.width * scale) / 2;
      const centerY = (canvas.height - dims.height * scale) / 2;
      canvasImageTopLeftX = centerX + position.x;
      canvasImageTopLeftY = centerY + position.y;
      //             console.log(`  Calculated TopLeft: x=${canvasImageTopLeftX}, y=${canvasImageTopLeftY} (Using Dims)`);
    } else {
      // Fallback (should not happen after load ideally)
      canvasImageTopLeftX = canvas.width / 2 + position.x;
      canvasImageTopLeftY = canvas.height / 2 + position.y;
      console.warn(`getCanvasCoords: Dimensions not found for ${currentImageLabel}. Falling back. TopLeft: x=${canvasImageTopLeftX}, y=${canvasImageTopLeftY}`);
    }

    // Transform from image-relative coordinates to canvas coordinates
    const canvasX = (imageX_relative * scale) + canvasImageTopLeftX;
    const canvasY = (imageY_relative * scale) + canvasImageTopLeftY;
    //         console.log(`  Final Canvas Coords: x=${canvasX}, y=${canvasY}`);
    //         console.log(`---------------------------------------------`);
    // *** END DETAILED LOGGING ***

    return { x: canvasX, y: canvasY };
  };

  // Relative positioning functions for custom labels
  // Convert absolute offset to relative line positioning (percentage along line + perpendicular distance)
  window.convertAbsoluteToRelativePosition = function(strokeName, absoluteOffset, imageLabel = null) {
    const currentImg = imageLabel || currentImageLabel;
    const vectorData = vectorStrokesByImage[currentImg]?.[strokeName];
        
    if (!vectorData || !vectorData.points || vectorData.points.length < 2) {
      console.warn(`[REL-POS] No vector data found for stroke ${strokeName}`);
      return null;
    }
        
    const points = vectorData.points;
    let bestProjection = null;
    let minDistance = Infinity;
        
    // Find the closest point on the line to the absolute offset position
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];
            
      // Vector from p1 to p2
      const lineVec = { x: p2.x - p1.x, y: p2.y - p1.y };
      const lineLength = Math.sqrt(lineVec.x * lineVec.x + lineVec.y * lineVec.y);
            
      if (lineLength === 0) continue; // Skip zero-length segments
            
      // Normalize line vector
      const lineUnit = { x: lineVec.x / lineLength, y: lineVec.y / lineLength };
            
      // Vector from p1 to offset position (relative to stroke anchor)
      const strokeAnchor = getStrokeAnchorPoint(strokeName, currentImg);
      const offsetPos = { 
        x: strokeAnchor.x + absoluteOffset.x, 
        y: strokeAnchor.y + absoluteOffset.y 
      };
      const toOffset = { x: offsetPos.x - p1.x, y: offsetPos.y - p1.y };
            
      // Project onto line segment
      const projection = Math.max(0, Math.min(lineLength, 
        toOffset.x * lineUnit.x + toOffset.y * lineUnit.y));
            
      // Point on line segment
      const projPoint = {
        x: p1.x + lineUnit.x * projection,
        y: p1.y + lineUnit.y * projection
      };
            
      // Distance from offset position to projection point
      const distanceToLine = Math.sqrt(
        Math.pow(offsetPos.x - projPoint.x, 2) + 
                Math.pow(offsetPos.y - projPoint.y, 2)
      );
            
      if (distanceToLine < minDistance) {
        minDistance = distanceToLine;
                
        // Calculate cumulative distance along stroke up to this segment
        let cumulativeDistance = 0;
        for (let j = 0; j < i; j++) {
          const seg = { 
            x: points[j + 1].x - points[j].x, 
            y: points[j + 1].y - points[j].y 
          };
          cumulativeDistance += Math.sqrt(seg.x * seg.x + seg.y * seg.y);
        }
        cumulativeDistance += projection;
                
        // Calculate total stroke length
        let totalLength = 0;
        for (let j = 0; j < points.length - 1; j++) {
          const seg = { 
            x: points[j + 1].x - points[j].x, 
            y: points[j + 1].y - points[j].y 
          };
          totalLength += Math.sqrt(seg.x * seg.x + seg.y * seg.y);
        }
                
        // Calculate perpendicular direction (which side of line)
        const perpVec = { x: -lineUnit.y, y: lineUnit.x }; // 90° rotation
        const toOffsetFromProj = {
          x: offsetPos.x - projPoint.x,
          y: offsetPos.y - projPoint.y
        };
        const perpendicular = toOffsetFromProj.x * perpVec.x + toOffsetFromProj.y * perpVec.y;
                
        bestProjection = {
          percentageAlongLine: totalLength > 0 ? cumulativeDistance / totalLength : 0.5,
          perpendicularDistance: perpendicular,
          segmentIndex: i,
          projectionOnSegment: projection
        };
      }
    }
        
    return bestProjection;
  };
    
  // Convert relative line positioning back to absolute offset
  window.convertRelativeToAbsolutePosition = function(strokeName, relativePosition, imageLabel = null) {
    const currentImg = imageLabel || currentImageLabel;
    const vectorData = vectorStrokesByImage[currentImg]?.[strokeName];
        
    if (!vectorData || !vectorData.points || vectorData.points.length < 2) {
      console.warn(`[REL-POS] No vector data found for stroke ${strokeName}`);
      return { x: 0, y: 0 };
    }
        
    const points = vectorData.points;
    const percentage = relativePosition.percentageAlongLine;
    const perpDistance = relativePosition.perpendicularDistance;
    const storedSegmentIndex = typeof relativePosition.segmentIndex === 'number' ? relativePosition.segmentIndex : null;
    const storedProjection = typeof relativePosition.projectionOnSegment === 'number' ? relativePosition.projectionOnSegment : null;
        
    // Calculate total stroke length
    let totalLength = 0;
    const segmentLengths = [];
    for (let i = 0; i < points.length - 1; i++) {
      const seg = { 
        x: points[i + 1].x - points[i].x, 
        y: points[i + 1].y - points[i].y 
      };
      const segLength = Math.sqrt(seg.x * seg.x + seg.y * seg.y);
      segmentLengths.push(segLength);
      totalLength += segLength;
    }
        
    // Prefer original segment/t if provided to avoid drift; otherwise compute from percentage of total length
    let targetSegment = 0;
    let distanceInSegment = 0;
    if (storedSegmentIndex !== null && storedProjection !== null && storedSegmentIndex >= 0 && storedSegmentIndex < segmentLengths.length) {
      targetSegment = storedSegmentIndex;
      // Clamp projection to current segment length (segments can slightly change after transforms)
      const segLen = segmentLengths[targetSegment] || 0;
      distanceInSegment = Math.max(0, Math.min(segLen, storedProjection));
    } else {
      const targetDistance = percentage * totalLength;
      let cumulativeDistance = 0;
      for (let i = 0; i < segmentLengths.length; i++) {
        if (cumulativeDistance + segmentLengths[i] >= targetDistance) {
          targetSegment = i;
          distanceInSegment = targetDistance - cumulativeDistance;
          break;
        }
        cumulativeDistance += segmentLengths[i];
      }
    }
        
    // Handle edge case where percentage >= 1.0
    if (targetSegment >= segmentLengths.length) {
      targetSegment = segmentLengths.length - 1;
      distanceInSegment = segmentLengths[targetSegment];
    }
        
    // Get segment points
    const p1 = points[targetSegment];
    const p2 = points[targetSegment + 1];
        
    // Calculate position along segment
    const lineVec = { x: p2.x - p1.x, y: p2.y - p1.y };
    const lineLength = segmentLengths[targetSegment];
        
    if (lineLength === 0) {
      // Zero-length segment, use p1
      const strokeAnchor = getStrokeAnchorPoint(strokeName, currentImg);
      return { x: p1.x - strokeAnchor.x, y: p1.y - strokeAnchor.y };
    }
        
    const lineUnit = { x: lineVec.x / lineLength, y: lineVec.y / lineLength };
    const pointOnLine = {
      x: p1.x + lineUnit.x * distanceInSegment,
      y: p1.y + lineUnit.y * distanceInSegment
    };
        
    // Add perpendicular offset
    const perpVec = { x: -lineUnit.y, y: lineUnit.x }; // 90° rotation
    const finalPoint = {
      x: pointOnLine.x + perpVec.x * perpDistance,
      y: pointOnLine.y + perpVec.y * perpDistance
    };
        
    // Convert to offset relative to stroke anchor
    const strokeAnchor = getStrokeAnchorPoint(strokeName, currentImg);
    return {
      x: finalPoint.x - strokeAnchor.x,
      y: finalPoint.y - strokeAnchor.y
    };
  };
    
  // **NEW**: Cached anchor centers for stable label positioning
  // Cache computed anchor centers to avoid recalculation and ensure stability
  if (!window._anchorCenterCache) {
    window._anchorCenterCache = {}; // { [imageLabel]: { [strokeLabel]: {x, y, version} } }
    window._anchorCenterVersion = {}; // { [imageLabel]: number }
  }

  // Invalidate anchor cache for a specific image when strokes change
  window.invalidateAnchorCache = function(imageLabel) {
    if (window._anchorCenterCache[imageLabel]) {
      delete window._anchorCenterCache[imageLabel];
      window._anchorCenterVersion[imageLabel] = (window._anchorCenterVersion[imageLabel] || 0) + 1;
      if (window.labelReprojectDebug && labelReprojectDebug()) {
        console.log(`[ANCHOR-CACHE] Invalidated cache for ${imageLabel}`);
      }
    }
  };

  // Get cached anchor center or compute new one
  window.getCachedAnchorCenter = function(strokeLabel, imageLabel) {
    const imgLabel = imageLabel || currentImageLabel;
    const vectorData = vectorStrokesByImage[imgLabel]?.[strokeLabel];
        
    if (!vectorData || !vectorData.points || vectorData.points.length === 0) {
      return { x: 0, y: 0 };
    }
        
    // Check cache first
    const cacheKey = `${imgLabel}:${strokeLabel}`;
    const cached = window._anchorCenterCache[imgLabel]?.[strokeLabel];
    const currentVersion = window._anchorCenterVersion[imgLabel] || 0;

    if (cached && cached.version === currentVersion) {
      return { x: cached.x, y: cached.y };
    }

    // Compute new anchor center using geometry function
    const anchorCenter = window.computeAnchorCenterImage(vectorData);

    // Cache the result
    if (!window._anchorCenterCache[imgLabel]) {
      window._anchorCenterCache[imgLabel] = {};
    }
    window._anchorCenterCache[imgLabel][strokeLabel] = {
      x: anchorCenter.x,
      y: anchorCenter.y,
      version: currentVersion
    };

    if (window.labelReprojectDebug && labelReprojectDebug()) {
      console.log(`[ANCHOR-CACHE] Computed new anchor for ${cacheKey}: (${anchorCenter.x.toFixed(1)}, ${anchorCenter.y.toFixed(1)})`);
    }

    return anchorCenter;
  };

  // Helper function to get stroke anchor point (now uses cached version)
  function getStrokeAnchorPoint(strokeName, imageLabel = null) {
    return window.getCachedAnchorCenter(strokeName, imageLabel);
  }

  // Drawing function for freehand mode
  function draw(e) {
    if (!isDrawing) return;
        
    // Use new coordinate system if available
    const coords = window.getPointerCoords(e);
    const canvasX = coords.canvas.x;
    const canvasY = coords.canvas.y;

    // Get world coordinates for storing in the points array
    // This transforms from canvas coordinates to world-relative coordinates
    const { x: imgX, y: imgY } = coords.world;

    // *** Add Log Here ***
    //         console.log(`Draw Move: Canvas(${canvasX}, ${canvasY}) -> Image(${imgX.toFixed(1)}, ${imgY.toFixed(1)})`);

    // Calculate time delta for velocity
    const currentPoint = {
      x: imgX,    // Store image-relative X
      y: imgY,    // Store image-relative Y
      canvasX: canvasX, // Store canvas X for drawing
      canvasY: canvasY, // Store canvas Y for drawing
      time: Date.now()
    };
        
    //         console.log(`Adding point at canvas: (${canvasX}, ${canvasY}), image-relative: (${imgX}, ${imgY})`);
        
    // Use the correct previous point for time delta calculations
    const prevPoint = points.length > 0 ? points[points.length - 1] : 
      { x: imgX, y: imgY, canvasX: lastX, canvasY: lastY, time: currentPoint.time - 10 };
    const timeDelta = currentPoint.time - prevPoint.time || 1;

    // Calculate velocity (pixels per millisecond)
    const distance = Math.sqrt(
      Math.pow(currentPoint.x - prevPoint.x, 2) + 
            Math.pow(currentPoint.y - prevPoint.y, 2)
    );
    const velocity = distance / timeDelta;

    // Smooth velocity for more natural strokes
    const smoothingFactor = 0.3; // Higher = more smoothing
    const smoothedVelocity = lastVelocity * (1 - smoothingFactor) + velocity * smoothingFactor;
    lastVelocity = smoothedVelocity;

    // Calculate dynamic width based on velocity
    // Faster = thinner, slower = thicker, with limits
    const baseWidth = parseInt(brushSize.value);
    const velocityFactor = Math.max(0.4, Math.min(1.2, 1 - smoothedVelocity * 0.1));
    const scale = window.imageScaleByLabel[currentImageLabel] || 1.0;
    const dynamicWidth = baseWidth * velocityFactor * scale;

    // Add point to array
    points.push(currentPoint);

    // Always start from the last drawn point in canvas coordinates
    ctx.beginPath();
        
    // Use canvas coordinates directly for drawing
    if (points.length === 1) {
      // This is the first point after mousedown, draw from lastX/lastY
      ctx.moveTo(lastX, lastY);
      ctx.lineTo(canvasX, canvasY);
    } else {
      // We have multiple points
      ctx.moveTo(prevPoint.canvasX, prevPoint.canvasY);
      ctx.lineTo(canvasX, canvasY);
    }

    // Check if we need shadow for white lines
    const isWhiteLine = colorPicker.value === '#ffffff' || colorPicker.value === 'white' || colorPicker.value === 'rgb(255, 255, 255)';
        
    // Draw shadow first if needed (behind the line)
    if (isWhiteLine) {
      ctx.save();
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)'; // Shadow color
      ctx.lineWidth = dynamicWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowColor = 'transparent'; // No shadow on shadow
      ctx.setLineDash([]); // Shadow is always solid
            
      ctx.stroke();
      ctx.restore();
    }
        
    // Draw the actual line on top
    ctx.strokeStyle = colorPicker.value;
    ctx.lineWidth = dynamicWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
        
    // Set dash pattern if enabled
    if (dashSettings && dashSettings.enabled && dashSettings.pattern.length > 0) {
      const scaledPattern = dashSettings.pattern.map(dash => dash * scale);
      ctx.setLineDash(scaledPattern);
      ctx.lineDashOffset = -window.paintApp.uiState.dashOffset;
            
      // Calculate segment length and update dash offset for continuity
      const segmentLength = Math.sqrt(
        Math.pow(canvasX - lastX, 2) + Math.pow(canvasY - lastY, 2)
      );
      window.paintApp.uiState.dashOffset += segmentLength;
    } else {
      ctx.setLineDash([]); // Solid line
    }
        
    ctx.stroke();
        
    // Reset dash pattern and offset to defaults
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;

    // Update the last drawn point coordinates
    lastX = canvasX;
    lastY = canvasY;
        
    // Store vector data for the freehand stroke
    // --- FIX: Use a temporary key for the stroke being drawn --- 
    const tempStrokeKey = '_drawingStroke';
        
    // Initialize if needed
    if (!vectorStrokesByImage[currentImageLabel]) {
      vectorStrokesByImage[currentImageLabel] = {};
    }
        
    // We already have image-relative coordinates from the getTransformedCoords call above
    // Just use the current points array directly to build the vector data
    // We only need the x, y coordinates (which are already image-relative)
    const relativePoints = points.map(point => ({
      x: point.x,  // Already image-relative X
      y: point.y,  // Already image-relative Y
      time: point.time
    }));
        
    // Create or update the vector representation under the temporary key
    if (!vectorStrokesByImage[currentImageLabel][tempStrokeKey]) {
      vectorStrokesByImage[currentImageLabel][tempStrokeKey] = {
        points: relativePoints,
        color: colorPicker.value,
        width: baseWidth, // Store the base width without scaling
        type: 'freehand',
        dashSettings: { ...dashSettings } // Store dash settings for dotted lines
      };
    } else {
      // Just update the points if the vector data already exists
      vectorStrokesByImage[currentImageLabel][tempStrokeKey].points = relativePoints;
    }
  } // End of draw function
    
  // Function to draw arrow line preview
  function drawArrowLinePreview(startPoint, endPoint) {
    if (!startPoint || !endPoint) return;
         
    // Clear canvas and redraw everything
    redrawCanvasWithVisibility();
         
    // Calculate adjusted endpoints for the line (same logic as final rendering)
    const scale = window.imageScaleByLabel[currentImageLabel] || 1;
    const brushSizeValue = parseInt(brushSize.value) || 5;
    const baseArrowSize = Math.max(arrowSettings.arrowSize || (brushSizeValue * 2), brushSizeValue * 2);
    const scaledArrowSize = baseArrowSize * scale;
         
    // Calculate line direction
    const dx = endPoint.x - startPoint.x;
    const dy = endPoint.y - startPoint.y;
    const lineLength = Math.sqrt(dx * dx + dy * dy);
         
    let adjustedStartX = startPoint.x;
    let adjustedStartY = startPoint.y;
    let adjustedEndX = endPoint.x;
    let adjustedEndY = endPoint.y;
         
    // Only apply shortening logic if arrows are actually enabled (match final rendering)
    if (lineLength > 0 && arrowSettings && (arrowSettings.startArrow || arrowSettings.endArrow)) {
      const unitX = dx / lineLength;
      const unitY = dy / lineLength;
      // Calculate shortening distance - reduce to make connection solid
      const shorteningDistance = scaledArrowSize * 0.4;
             
      // Shorten start point inward if start arrow is enabled
      if (arrowSettings.startArrow) {
        adjustedStartX = startPoint.x + shorteningDistance * unitX;
        adjustedStartY = startPoint.y + shorteningDistance * unitY;
      }
             
      // Shorten end point inward if end arrow is enabled
      if (arrowSettings.endArrow) {
        adjustedEndX = endPoint.x - shorteningDistance * unitX;
        adjustedEndY = endPoint.y - shorteningDistance * unitY;
      }
    }
         
    // Draw the arrow line shaft with adjusted endpoints
    ctx.save();
    ctx.strokeStyle = colorPicker.value;
    ctx.lineWidth = parseInt(brushSize.value) * scale;
    ctx.lineCap = 'round';
        
    // Add shadow for white lines
    const isWhiteLine = colorPicker.value === '#ffffff' || colorPicker.value === 'white' || colorPicker.value === 'rgb(255, 255, 255)';
    if (isWhiteLine) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.6)'; // Strong dark shadow for white lines
      ctx.shadowBlur = 6; // Stronger shadow blur
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;
    }
         
    // Set dash pattern if enabled
    if (dashSettings && dashSettings.enabled && dashSettings.pattern.length > 0) {
      const scaledPattern = dashSettings.pattern.map(dash => dash * scale);
      ctx.setLineDash(scaledPattern);
    } else {
      ctx.setLineDash([]); // Solid line
    }
         
    ctx.beginPath();
    ctx.moveTo(adjustedStartX, adjustedStartY);
    ctx.lineTo(adjustedEndX, adjustedEndY);
    ctx.stroke();
         
    // Reset dash pattern to solid for arrowheads
    ctx.setLineDash([]);
         
    // Draw arrowheads at original endpoints (not adjusted)
    const currentBrushSize = parseInt(brushSize.value) || 5;
    drawArrowhead(startPoint, endPoint, arrowSettings, currentBrushSize, colorPicker.value);
         
    ctx.restore();
  }
    
  // Function to calculate and draw arrowheads (optimized for performance)
  function drawArrowhead(startPoint, endPoint, settings, strokeActualWidth, strokeColor = null) {
    const { startArrow, endArrow, arrowSize, arrowStyle } = settings;
    const scale = window.imageScaleByLabel[currentImageLabel] || 1;
         
    // Calculate the effective arrow size based on the stroke's own width and arrowSize setting
    // If no explicit arrowSize is set, use proportional sizing based on stroke width
    const baseArrowSize = arrowSize || (strokeActualWidth * 2);
    const effectiveBaseSize = Math.max(baseArrowSize, strokeActualWidth * 2);
    const scaledArrowSize = effectiveBaseSize * scale;
        
    // Calculate line angle and direction
    const dx = endPoint.x - startPoint.x;
    const dy = endPoint.y - startPoint.y;
    const lineLength = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);
        
    // Calculate EXTENDED line endpoints beyond arrowheads to prevent stroke overlay
    let extendedStartPoint = { ...startPoint };
    let extendedEndPoint = { ...endPoint };
        
    if (lineLength > 0) {
      const unitX = dx / lineLength;
      const unitY = dy / lineLength;
            
      // Calculate extension distance: arrow size + extra padding for thick strokes
      const extensionDistance = scaledArrowSize + (strokeActualWidth * scale * 2);
            
      // Extend line backward from start if start arrow is enabled
      if (startArrow) {
        extendedStartPoint.x = startPoint.x - extensionDistance * unitX;
        extendedStartPoint.y = startPoint.y - extensionDistance * unitY;
      }
            
      // Extend line forward from end if end arrow is enabled  
      if (endArrow) {
        extendedEndPoint.x = endPoint.x + extensionDistance * unitX;
        extendedEndPoint.y = endPoint.y + extensionDistance * unitY;
      }
    }
        
    // Set context properties once for all arrowheads
    ctx.save();
    const arrowColor = strokeColor || colorPicker.value;
    ctx.fillStyle = arrowColor;
    ctx.strokeStyle = arrowColor;
    ctx.lineWidth = strokeActualWidth * scale;
        
    // Draw arrowheads at the ORIGINAL endpoints (not extended)
    if (startArrow) {
      drawSingleArrowhead(startPoint.x, startPoint.y, angle + Math.PI, scaledArrowSize, arrowStyle);
    }
        
    if (endArrow) {
      drawSingleArrowhead(endPoint.x, endPoint.y, angle, scaledArrowSize, arrowStyle);
    }
        
    ctx.restore();
        
    // Return the EXTENDED endpoints so the line is drawn beyond the arrowheads
    return {
      adjustedStartPoint: extendedStartPoint,
      adjustedEndPoint: extendedEndPoint
    };
  }
    
  // Function to draw a single arrowhead
  function drawSingleArrowhead(x, y, angle, size, style) {
    const arrowAngle = Math.PI / 6; // 30 degrees
         
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
         
    // Check if arrow is white and add shadow
    const currentFillStyle = ctx.fillStyle;
    const isWhiteArrow = currentFillStyle === '#ffffff' || currentFillStyle === 'white' || currentFillStyle === 'rgb(255, 255, 255)';
         
    // Use appropriate line width - keep it thin but visible
    ctx.lineWidth = 1; // Fixed thin outline for consistency
         
    // For white arrows, draw shadow first, then the arrow on top
    if (isWhiteArrow) {
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.6)'; // Strong dark shadow for white arrows
      ctx.shadowBlur = 6; // Stronger shadow blur
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;
             
      // Draw shadow version
      if (style === 'triangular') {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-size, -size * ARROW_PERFORMANCE_CACHE.ARROW_TAN_30);
        ctx.lineTo(-size, size * ARROW_PERFORMANCE_CACHE.ARROW_TAN_30);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (style === 'filled') {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-size, -size * ARROW_PERFORMANCE_CACHE.ARROW_TAN_30);
        ctx.lineTo(-size, size * ARROW_PERFORMANCE_CACHE.ARROW_TAN_30);
        ctx.closePath();
        ctx.fill();
      } else if (style === 'curved') {
        const curveSize = size * 0.7;
        ctx.beginPath();
        ctx.quadraticCurveTo(-curveSize, -curveSize * 0.5, -size, -size * ARROW_PERFORMANCE_CACHE.ARROW_TAN_30);
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(-curveSize, curveSize * 0.5, -size, size * ARROW_PERFORMANCE_CACHE.ARROW_TAN_30);
        ctx.stroke();
      }
             
      ctx.restore(); // Remove shadow
    }
         
    if (style === 'triangular') {
      // Filled triangular arrowhead with thin outline
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-size, -size * ARROW_PERFORMANCE_CACHE.ARROW_TAN_30);
      ctx.lineTo(-size, size * ARROW_PERFORMANCE_CACHE.ARROW_TAN_30);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (style === 'filled') {
      // Solid filled triangular arrowhead (no outline)
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-size, -size * ARROW_PERFORMANCE_CACHE.ARROW_TAN_30);
      ctx.lineTo(-size, size * ARROW_PERFORMANCE_CACHE.ARROW_TAN_30);
      ctx.closePath();
      ctx.fill();
    } else if (style === 'curved') {
      // Curved arrowhead with fixed thickness
      const curveSize = size * 0.7;
      ctx.lineWidth = 2; // Fixed thickness for curved style
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(-curveSize, -curveSize * 0.5, -size, -size * ARROW_PERFORMANCE_CACHE.ARROW_TAN_30);
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(-curveSize, curveSize * 0.5, -size, size * ARROW_PERFORMANCE_CACHE.ARROW_TAN_30);
      ctx.stroke();
    }
         
    ctx.restore();
  }
    
  // Function to draw straight line preview
  function drawStraightLinePreview(startPoint, endPoint) {
    // Clear the canvas to the last saved state
    if (currentStroke) {
      restoreCanvasState(currentStroke);
    }
        
    // Calculate extended endpoints if arrows are enabled (same logic as final rendering)
    let drawStartPoint = { ...startPoint };
    let drawEndPoint = { ...endPoint };
        
    const scale = window.imageScaleByLabel[currentImageLabel] || 1.0;
    const brushSizeValue = parseInt(brushSize.value) || 5;
        
    if (arrowSettings && (arrowSettings.startArrow || arrowSettings.endArrow)) {
      // Calculate line direction
      const dx = endPoint.x - startPoint.x;
      const dy = endPoint.y - startPoint.y;
      const lineLength = Math.sqrt(dx * dx + dy * dy);
            
      if (lineLength > 0) {
        const unitX = dx / lineLength;
        const unitY = dy / lineLength;
                
        // Calculate shortening distance to match final rendering (arrows should not extend line)
        const baseArrowSize = Math.max(arrowSettings.arrowSize || (brushSizeValue * 2), brushSizeValue * 2);
        const arrowSize = baseArrowSize * scale;
        const shorteningDistance = arrowSize * 0.4; // Reduced to make connection solid
                
        // Shorten line from start if start arrow is enabled
        if (arrowSettings.startArrow) {
          drawStartPoint.x = startPoint.x + shorteningDistance * unitX;
          drawStartPoint.y = startPoint.y + shorteningDistance * unitY;
        }
                
        // Shorten line from end if end arrow is enabled
        if (arrowSettings.endArrow) {
          drawEndPoint.x = endPoint.x - shorteningDistance * unitX;
          drawEndPoint.y = endPoint.y - shorteningDistance * unitY;
        }
      }
    }
        
    // Draw the straight line with extended endpoints
    ctx.beginPath();
    ctx.moveTo(drawStartPoint.x, drawStartPoint.y);
    ctx.lineTo(drawEndPoint.x, drawEndPoint.y);
        
    // Set drawing styles
    ctx.strokeStyle = colorPicker.value;
    ctx.lineWidth = brushSizeValue * scale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
        
    // Add shadow for white lines
    const isWhiteLine = colorPicker.value === '#ffffff' || colorPicker.value === 'white' || colorPicker.value === 'rgb(255, 255, 255)';
    if (isWhiteLine) {
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.6)'; // Strong dark shadow for white lines
      ctx.shadowBlur = 6; // Stronger shadow blur
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;
    }
        
    // Set dash pattern if enabled
    if (dashSettings && dashSettings.enabled && dashSettings.pattern.length > 0) {
      const scaledPattern = dashSettings.pattern.map(dash => dash * scale);
      ctx.setLineDash(scaledPattern);
    } else {
      ctx.setLineDash([]); // Solid line
    }
        
    ctx.stroke();
        
    // Reset shadow for white lines
    if (isWhiteLine) {
      ctx.restore();
    }

    // Draw tiny no-shadow connectors at ends to eliminate shadow gap at arrow bases
    if (arrowSettings && (arrowSettings.startArrow || arrowSettings.endArrow)) {
      const dx = endPoint.x - startPoint.x;
      const dy = endPoint.y - startPoint.y;
      const len = Math.sqrt(dx*dx + dy*dy);
      if (len > 0) {
        const ux = dx / len;
        const uy = dy / len;
        const connectorLength = Math.min((brushSizeValue * scale) * 1.25, (arrowSettings.arrowSize ? arrowSettings.arrowSize * scale * 0.5 : brushSizeValue * scale * 0.6));
        ctx.save();
        ctx.shadowColor = 'transparent';
        ctx.setLineDash([]);
        ctx.strokeStyle = colorPicker.value;
        ctx.lineWidth = brushSizeValue * scale;
        ctx.lineCap = 'round';
        ctx.beginPath();
        if (arrowSettings.startArrow) {
          ctx.moveTo(drawStartPoint.x, drawStartPoint.y);
          ctx.lineTo(drawStartPoint.x - connectorLength * ux, drawStartPoint.y - connectorLength * uy);
        }
        if (arrowSettings.endArrow) {
          ctx.moveTo(drawEndPoint.x, drawEndPoint.y);
          ctx.lineTo(drawEndPoint.x + connectorLength * ux, drawEndPoint.y + connectorLength * uy);
        }
        ctx.stroke();
        ctx.restore();
      }
    }
        
    // Reset dash pattern to solid
    ctx.setLineDash([]);
        
    // Draw arrows at ORIGINAL endpoints (not extended)
    if (arrowSettings && arrowSettings.startArrow) {
      // Calculate angle from start to end for start arrow
      const startAngle = Math.atan2(endPoint.y - startPoint.y, endPoint.x - startPoint.x);
      const baseArrowSize = Math.max(arrowSettings.arrowSize || (brushSizeValue * 2), brushSizeValue * 2);
      const arrowSize = baseArrowSize * scale;
      ctx.fillStyle = colorPicker.value;
      ctx.strokeStyle = colorPicker.value;
      drawSingleArrowhead(startPoint.x, startPoint.y, startAngle, arrowSize, 'triangular');
    }
    if (arrowSettings && arrowSettings.endArrow) {
      // Calculate angle from end to start for end arrow (reversed)
      const endAngle = Math.atan2(startPoint.y - endPoint.y, startPoint.x - endPoint.x);
      const baseArrowSize = Math.max(arrowSettings.arrowSize || (brushSizeValue * 2), brushSizeValue * 2);
      const arrowSize = baseArrowSize * scale;
      ctx.fillStyle = colorPicker.value;
      ctx.strokeStyle = colorPicker.value;
      drawSingleArrowhead(endPoint.x, endPoint.y, endAngle, arrowSize, 'triangular');
    }
  }
    
  // Helper function to ensure control points have fresh canvas coordinates
  function refreshControlPointCanvasCoords(controlPoints, imgLabel = currentImageLabel) {
    return controlPoints.map(cp => {
      const canvasCoords = toCanvas({ x: cp.x, y: cp.y }, imgLabel);
      return {
        ...cp,
        canvasX: canvasCoords.x,
        canvasY: canvasCoords.y
      };
    });
  }

  // Helper function to establish the same transformation context as applyVisibleStrokes
  function getTransformationContext(imgLabel = currentImageLabel) {
    const scale = window.imageScaleByLabel[imgLabel] || 1.0;
    const position = imagePositionByLabel[imgLabel] || { x: 0, y: 0 };
        
    // Determine if this is blank canvas mode
    const dims = window.originalImageDimensions ? window.originalImageDimensions[imgLabel] : undefined;
    const noImageLoaded = !window.originalImages || !window.originalImages[imgLabel];
    const isBlankCanvas = noImageLoaded || (dims && dims.width === canvas.width && dims.height === canvas.height);
        
    let imageX, imageY;
        
    if (isBlankCanvas) {
      // For blank canvas mode - use canvas center + position offset
      imageX = canvas.width / 2 + position.x;
      imageY = canvas.height / 2 + position.y;
    } else {
      // For actual images - use the same logic as redrawCanvasWithVisibility
      const imageUrl = window.originalImages[imgLabel];
      const cachedImg = imageUrl ? imageCache[imageUrl] : null;
            
      if (cachedImg) {
        const centerX = (canvas.width - cachedImg.width * scale) / 2;
        const centerY = (canvas.height - cachedImg.height * scale) / 2;
        imageX = centerX + position.x;
        imageY = centerY + position.y;
      } else if (dims && dims.width > 0 && dims.height > 0) {
        const centerX = (canvas.width - dims.width * scale) / 2;
        const centerY = (canvas.height - dims.height * scale) / 2;
        imageX = centerX + position.x;
        imageY = centerY + position.y;
      } else {
        imageX = canvas.width / 2 + position.x;
        imageY = canvas.height / 2 + position.y;
      }
    }
        
    return { scale, imageX, imageY, isBlankCanvas, canvasCenter: { x: canvas.width / 2, y: canvas.height / 2 } };
  }

  // Helper function to transform image-space point to canvas-space using the same logic as applyVisibleStrokes
  function transformImagePointToCanvas(imagePoint, transformContext) {
    const { scale, imageX, imageY, isBlankCanvas, canvasCenter } = transformContext;
    const position = imagePositionByLabel[currentImageLabel] || { x: 0, y: 0 };
        
    if (isBlankCanvas) {
      // Apply both scaling and position offset in blank canvas mode
      const scaledX = (imagePoint.x - canvasCenter.x) * scale + canvasCenter.x;
      const scaledY = (imagePoint.y - canvasCenter.y) * scale + canvasCenter.y;
      return {
        x: scaledX + position.x,
        y: scaledY + position.y
      };
    } else {
      return {
        x: imageX + (imagePoint.x * scale),
        y: imageY + (imagePoint.y * scale)
      };
    }
  }

  // Catmull-Rom spline algorithm for smooth curves
  function generateCatmullRomSpline(controlPoints, resolution = 50) {
    if (controlPoints.length < 2) return [];
    if (controlPoints.length === 2) {
      // Linear interpolation for 2 points
      const result = [];
      for (let i = 0; i <= resolution; i++) {
        const t = i / resolution;
        const x = controlPoints[0].canvasX + t * (controlPoints[1].canvasX - controlPoints[0].canvasX);
        const y = controlPoints[0].canvasY + t * (controlPoints[1].canvasY - controlPoints[0].canvasY);
        result.push({ x, y });
      }
      return result;
    }

    const splinePoints = [];
        
    // Create phantom points for proper curve behavior
    const points = [...controlPoints];
    const firstPoint = { ...points[0] };
    const lastPoint = { ...points[points.length - 1] };
    points.unshift(firstPoint); // Add phantom start point
    points.push(lastPoint);     // Add phantom end point

    // Generate curve segments between each pair of control points
    for (let i = 1; i < points.length - 2; i++) {
      const p0 = points[i - 1];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2];

      // Generate points along this segment
      for (let j = 0; j <= resolution; j++) {
        const t = j / resolution;
        const t2 = t * t;
        const t3 = t2 * t;

        // Catmull-Rom basis functions
        const x = 0.5 * (
          (2 * p1.canvasX) +
                    (-p0.canvasX + p2.canvasX) * t +
                    (2 * p0.canvasX - 5 * p1.canvasX + 4 * p2.canvasX - p3.canvasX) * t2 +
                    (-p0.canvasX + 3 * p1.canvasX - 3 * p2.canvasX + p3.canvasX) * t3
        );

        const y = 0.5 * (
          (2 * p1.canvasY) +
                    (-p0.canvasY + p2.canvasY) * t +
                    (2 * p0.canvasY - 5 * p1.canvasY + 4 * p2.canvasY - p3.canvasY) * t2 +
                    (-p0.canvasY + 3 * p1.canvasY - 3 * p2.canvasY + p3.canvasY) * t3
        );

        splinePoints.push({ x, y });
      }
    }

    return splinePoints;
  }
  // Function to draw curved line preview
  function drawCurvedLinePreview(controlPoints, mousePos = null) {
    if (controlPoints.length === 0) return;

    // Clear canvas and redraw everything to ensure clean preview (match drawArrowLinePreview approach)
    redrawCanvasWithVisibility();

    const scale = window.imageScaleByLabel[currentImageLabel] || 1.0;
        
    // Create preview points (include mouse position if provided)
    // First, refresh all existing control points to have current canvas coordinates
    let previewPoints = refreshControlPointCanvasCoords(controlPoints);
    if (mousePos && controlPoints.length > 0) {
      const { x: imgX, y: imgY } = getTransformedCoords(mousePos.x, mousePos.y);
      previewPoints.push({
        x: imgX,
        y: imgY,
        canvasX: mousePos.x,
        canvasY: mousePos.y,
        time: Date.now()
      });
    }

    // Draw control points as small circles (no connecting lines)
    controlPoints.forEach(cp => {
      ctx.beginPath();
      const pointRadius = 4 * scale;
      // Use current canvas coordinates for drawing, recalculated from image coordinates
      const canvasCoords = toCanvas({ x: cp.x, y: cp.y }, currentImageLabel);
      ctx.arc(canvasCoords.x, canvasCoords.y, pointRadius, 0, Math.PI * 2);
      ctx.fillStyle = colorPicker.value;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    if (previewPoints.length === 1) {
      // Just one point - draw a thin line to mouse if mouse position provided
      if (mousePos) {
        ctx.beginPath();
        // Use current canvas coordinates for drawing, recalculated from image coordinates
        const startCanvasCoords = toCanvas({ x: previewPoints[0].x, y: previewPoints[0].y }, currentImageLabel);
        ctx.moveTo(startCanvasCoords.x, startCanvasCoords.y);
        ctx.lineTo(mousePos.x, mousePos.y);
                
        // Use actual color picker value with transparency
        const currentColor = colorPicker.value;
        const isWhiteLine = currentColor === '#ffffff' || currentColor === 'white' || currentColor === 'rgb(255, 255, 255)';
        ctx.strokeStyle = isWhiteLine ? 'rgba(255, 255, 255, 0.9)' : 'rgba(240, 240, 240, 0.7)';
        ctx.lineWidth = Math.max(1, parseInt(brushSize.value) * scale * 0.6); // Thinner than regular
        ctx.lineCap = 'round';
                
        // Add shadow for white lines
        if (isWhiteLine) {
          ctx.save();
          ctx.shadowColor = 'rgba(0, 0, 0, 0.6)'; // Strong dark shadow for white lines
          ctx.shadowBlur = 6; // Stronger shadow blur
          ctx.shadowOffsetX = 2;
          ctx.shadowOffsetY = 2;
        }
                
        // Set dash pattern if enabled
        if (dashSettings && dashSettings.enabled && dashSettings.pattern.length > 0) {
          const scaledPattern = dashSettings.pattern.map(dash => dash * scale);
          ctx.setLineDash(scaledPattern);
        } else {
          ctx.setLineDash([]); // Solid line
        }
                
        ctx.stroke();
                
        // Reset shadow for white lines
        if (isWhiteLine) {
          ctx.restore();
        }
                
        // Reset dash pattern to solid
        ctx.setLineDash([]);
      }
    } else {
      // Generate and draw the spline curve
      const splinePoints = generateCatmullRomSpline(previewPoints, 30);
            
      if (splinePoints.length > 1) {
        ctx.beginPath();
        ctx.moveTo(splinePoints[0].x, splinePoints[0].y);
                
        for (let i = 1; i < splinePoints.length; i++) {
          ctx.lineTo(splinePoints[i].x, splinePoints[i].y);
        }
                
        // Use actual color picker value with transparency and thinner line for preview
        const currentColor = colorPicker.value;
        const isWhiteLine = currentColor === '#ffffff' || currentColor === 'white' || currentColor === 'rgb(255, 255, 255)';
        ctx.strokeStyle = isWhiteLine ? 'rgba(255, 255, 255, 0.9)' : 'rgba(240, 240, 240, 0.7)';
        ctx.lineWidth = Math.max(1, parseInt(brushSize.value) * scale * 0.6); // 60% of regular thickness
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
                
        // Add shadow for white lines
        if (isWhiteLine) {
          ctx.save();
          ctx.shadowColor = 'rgba(0, 0, 0, 0.6)'; // Strong dark shadow for white lines
          ctx.shadowBlur = 6; // Stronger shadow blur
          ctx.shadowOffsetX = 2;
          ctx.shadowOffsetY = 2;
        }
                
        // Set dash pattern if enabled
        if (dashSettings && dashSettings.enabled && dashSettings.pattern.length > 0) {
          const scaledPattern = dashSettings.pattern.map(dash => dash * scale);
          ctx.setLineDash(scaledPattern);
        } else {
          ctx.setLineDash([]); // Solid line
        }
                
        ctx.stroke();
                
        // Reset shadow for white lines
        if (isWhiteLine) {
          ctx.restore();
        }
                
        // Reset dash pattern to solid
        ctx.setLineDash([]);
      }
    }
  }
    
  // Get arrow control elements
  const arrowControls = document.getElementById('arrowControls');
  const startArrowToggle = document.getElementById('startArrow');
  const endArrowToggle = document.getElementById('endArrow');
    
  // Helper function to update toggle button visual state
  function updateArrowToggleState(toggle, isEnabled) {
    if (isEnabled) {
      toggle.style.backgroundColor = '#4CAF50';
      toggle.style.color = 'white';
    } else {
      toggle.style.backgroundColor = '#f0f0f0';
      toggle.style.color = '#666';
    }
  }
    
  // Initialize toolbar arrow toggle states
  updateArrowToggleState(startArrowToggle, arrowSettings.startArrow);
  updateArrowToggleState(endArrowToggle, arrowSettings.endArrow);
    
  // Drawing mode toggle event listener
  drawingModeToggle.addEventListener('click', () => {
    if (drawingMode === 'freehand') {
      drawingMode = 'straight';
      drawingModeToggle.classList.remove('curved-mode');
      drawingModeToggle.classList.add('straight-mode');
      arrowControls.style.display = 'flex'; // Show arrow controls for straight lines
      // Update smart labels
      if (typeof window.updateDrawingModeLabels === 'function') {
        window.updateDrawingModeLabels(false); // false = not freehand
      }
    } else if (drawingMode === 'straight') {
      drawingMode = 'curved';
      drawingModeToggle.classList.remove('straight-mode');
      drawingModeToggle.classList.add('curved-mode');
      arrowControls.style.display = 'flex'; // Show arrow controls in curved mode
      // Update smart labels for curved mode
      if (typeof window.updateDrawingModeLabels === 'function') {
        window.updateDrawingModeLabels('curved'); // 'curved' = curved mode
      }
    } else if (drawingMode === 'curved') {
      drawingMode = 'freehand';
      drawingModeToggle.classList.remove('curved-mode', 'straight-mode');
      arrowControls.style.display = 'none';
      // Update smart labels
      if (typeof window.updateDrawingModeLabels === 'function') {
        window.updateDrawingModeLabels(true); // true = freehand
      }
    }
        
    // Clear any temporary drawing state when switching modes
    straightLineStart = null;
    curvedLinePoints = [];
    //         console.log(`Drawing mode changed to: ${drawingMode}`);
  });

  // Text mode toggle event listener
  textModeToggle.addEventListener('click', () => {
    if (drawingMode === 'text') {
      // Exit text mode, restore previous drawing mode
      restorePreviousDrawingMode();
    } else {
      // Store current mode before entering text mode
      previousDrawingMode = drawingMode;
      window.paintApp.state.previousDrawingMode = drawingMode;
            
      // Enter text mode
      drawingMode = 'text';
      window.paintApp.uiState.drawingMode = 'text';
      textModeToggle.classList.add('text-mode-active');
      drawingModeToggle.classList.remove('straight-mode', 'curved-mode');
      arrowControls.style.display = 'none';
      canvas.style.cursor = 'text';
    }
        
    // Clear any temporary drawing state when switching modes
    straightLineStart = null;
    curvedLinePoints = [];
    console.log(`Drawing mode changed to: ${drawingMode}`);
  });
    
  // Add hover effects to toolbar arrow toggles
  [startArrowToggle, endArrowToggle].forEach(toggle => {
    toggle.addEventListener('mouseenter', () => {
      if (toggle.style.backgroundColor === 'rgb(76, 175, 80)') {
        toggle.style.backgroundColor = '#45a049';
      } else {
        toggle.style.backgroundColor = '#e0e0e0';
      }
    });
        
    toggle.addEventListener('mouseleave', () => {
      const isStart = toggle === startArrowToggle;
      const isEnabled = isStart ? arrowSettings.startArrow : arrowSettings.endArrow;
      updateArrowToggleState(toggle, isEnabled);
    });
  });
    
  // Arrow control event listeners
  startArrowToggle.addEventListener('click', () => {
    arrowSettings.startArrow = !arrowSettings.startArrow;
    updateArrowToggleState(startArrowToggle, arrowSettings.startArrow);
    //         console.log(`Start arrow: ${arrowSettings.startArrow}`);
        
    // If a stroke is in edit mode, also update that stroke
    if (window.selectedStrokeInEditMode && vectorStrokesByImage[currentImageLabel] && vectorStrokesByImage[currentImageLabel][window.selectedStrokeInEditMode]) {
      const vectorData = vectorStrokesByImage[currentImageLabel][window.selectedStrokeInEditMode];
      const supportsArrows = vectorData.type === 'straight' || vectorData.type === 'arrow' || 
                                 vectorData.type === 'curved' || vectorData.type === 'curved-arrow';
            
      if (supportsArrows) {
        // Ensure arrowSettings exists
        if (!vectorData.arrowSettings) {
          vectorData.arrowSettings = { arrowSize: arrowSettings.arrowSize, arrowStyle: arrowSettings.arrowStyle, startArrow: false, endArrow: false };
        }
                
        // Update the stroke's arrow setting
        vectorData.arrowSettings.startArrow = arrowSettings.startArrow;
                
        // Update stroke type
        updateStrokeTypeBasedOnArrows(vectorData);
                
        // Save state and redraw
        saveState(true, false, false);
        redrawCanvasWithVisibility();
                
        //                 console.log(`Updated start arrow for edited stroke ${window.selectedStrokeInEditMode}:`, vectorData.arrowSettings.startArrow);
      }
    }
  });
    
  endArrowToggle.addEventListener('click', () => {
    arrowSettings.endArrow = !arrowSettings.endArrow;
    updateArrowToggleState(endArrowToggle, arrowSettings.endArrow);
    //         console.log(`End arrow: ${arrowSettings.endArrow}`);
        
    // If a stroke is in edit mode, also update that stroke
    if (window.selectedStrokeInEditMode && vectorStrokesByImage[currentImageLabel] && vectorStrokesByImage[currentImageLabel][window.selectedStrokeInEditMode]) {
      const vectorData = vectorStrokesByImage[currentImageLabel][window.selectedStrokeInEditMode];
      const supportsArrows = vectorData.type === 'straight' || vectorData.type === 'arrow' || 
                                 vectorData.type === 'curved' || vectorData.type === 'curved-arrow';
            
      if (supportsArrows) {
        // Ensure arrowSettings exists
        if (!vectorData.arrowSettings) {
          vectorData.arrowSettings = { arrowSize: arrowSettings.arrowSize, arrowStyle: arrowSettings.arrowStyle, startArrow: false, endArrow: false };
        }
                
        // Update the stroke's arrow setting
        vectorData.arrowSettings.endArrow = arrowSettings.endArrow;
                
        // Update stroke type
        updateStrokeTypeBasedOnArrows(vectorData);
                
        // Save state and redraw
        saveState(true, false, false);
        redrawCanvasWithVisibility();
                
        //                 console.log(`Updated end arrow for edited stroke ${window.selectedStrokeInEditMode}:`, vectorData.arrowSettings.endArrow);
      }
    }
  });

  // Get dash control elements
  const dashStyleSelect = document.getElementById('dashStyleSelect');
  const customDashControls = document.getElementById('customDashControls');
  const dashLengthInput = document.getElementById('dashLengthInput');
  const gapLengthInput = document.getElementById('gapLengthInput');
    
  // Helper function to update dash settings based on style
  function updateDashSettings() {
    const style = dashStyleSelect.value;
    dashSettings.style = style;
    dashSettings.enabled = style !== 'solid';
        
    if (style === 'custom') {
      dashSettings.dashLength = parseInt(dashLengthInput.value) || 5;
      dashSettings.gapLength = parseInt(gapLengthInput.value) || 5;
      customDashControls.style.display = 'flex';
    } else {
      customDashControls.style.display = 'none';
    }
        
    // Update the pattern using the helper function (use default brush size for pattern calculation)
    const currentBrushSize = parseInt(document.getElementById('brushSize').value) || 5;
    dashSettings.pattern = getDashPattern(style, dashSettings.dashLength, dashSettings.gapLength, currentBrushSize);
        
        
    // If a stroke is in edit mode, also update that stroke
    if (window.selectedStrokeInEditMode && vectorStrokesByImage[currentImageLabel] && vectorStrokesByImage[currentImageLabel][window.selectedStrokeInEditMode]) {
      const vectorData = vectorStrokesByImage[currentImageLabel][window.selectedStrokeInEditMode];
            
      // Ensure dashSettings exists and update it
      if (!vectorData.dashSettings) {
        vectorData.dashSettings = { enabled: false, style: 'solid', pattern: [], dashLength: 5, gapLength: 5 };
      }
            
      vectorData.dashSettings = { ...dashSettings };
            
      // Save state and redraw
      saveState(true, false, false);
      redrawCanvasWithVisibility();
    }
  }
    
  // Dash control event listeners
  dashStyleSelect.addEventListener('change', updateDashSettings);
  dashLengthInput.addEventListener('input', updateDashSettings);
  gapLengthInput.addEventListener('input', updateDashSettings);

  // Get fit control elements
  const fitModeSelect = document.getElementById('fitModeSelect');
  const applyFitCurrentButton = document.getElementById('applyFitCurrent');
  const applyFitAllButton = document.getElementById('applyFitAll');
    
  // Fit mode functions
  // **NEW**: Label Offset Model for Resolution Changes
  // Handles v1 (px) and v2 (normalized) offset formats with reprojection
  window.__labelOffsetVersion = 2; // 1 = px, 2 = normalized
    
  // Storage shape: calculatedLabelOffsets[imageLabel][tag] = Offset
  // Offset v1: { kind:'px', x, y }
  // Offset v2: { kind:'norm', dx_norm, dy_norm, normRef:[w,h] }
    
  const lastImageDims = Object.create(null); // label -> {w,h}
    
  /** Convert px -> normalized (v2) */
  function pxToNorm(offPx, w, h) {
    return {
      kind: 'norm',
      dx_norm: offPx.x / w,
      dy_norm: offPx.y / h,
      normRef: [w, h],
      version: 2
    };
  }
    
  /** Convert normalized (v2) -> px for target dims */
  function normToPx(offNorm, newW, newH) {
    return {
      kind: 'px',
      x: offNorm.dx_norm * newW,
      y: offNorm.dy_norm * newH,
      version: 1
    };
  }
    
  /** Ensure an offset object is normalized (migrates legacy px) */
  function ensureNorm(off, w, h) {
    if (!off) return null;
    if (off.kind === 'norm' && off.version === 2) return off;
    // migrate v1 (px) to v2
    return pxToNorm({ x: off.x, y: off.y }, w, h);
  }
    
  /** Reproject all stored offsets for a label to new image dimensions */
  function reprojectAllOffsetsForLabel(label, oldW, oldH, newW, newH) {
    const table = (window.calculatedLabelOffsets && window.calculatedLabelOffsets[label]) || {};
    for (const tag of Object.keys(table)) {
      // 1) normalize (idempotent)
      const norm = ensureNorm(table[tag], oldW, oldH);
      // 2) compute px for new dims
      const px = normToPx(norm, newW, newH);
      // 3) keep both forms for compatibility
      table[tag] = {
        ...px,
        norm: norm,          // handy for debugging
        version: 1
      };
    }
    if (window.calculatedLabelOffsets) {
      window.calculatedLabelOffsets[label] = table;
    }
    console.debug('[REPROJECT] label=%s old=%sx%s new=%sx%s (tags=%d)',
      label, oldW, oldH, newW, newH, Object.keys(table).length);
  }
    
  /** Freeze & restore canvas transform across a bitmap swap */
  function withFrozenTransform(fn) {
    const T = {
      scale: window.currentScale ?? 1,
      panX: window.currentPanX ?? 0,
      panY: window.currentPanY ?? 0,
      dpr:  window.devicePixelRatio || 1
    };
    const prevFreeze = window.__transformFrozen;
    window.__transformFrozen = true;
    try {
      return fn(T);
    } finally {
      window.__transformFrozen = prevFreeze || false;
      if (typeof window.redrawCanvasWithVisibility === 'function') {
        window.redrawCanvasWithVisibility();
      }
    }
  }
    
  /** Optional: force BG-removed bitmap back to original dimensions */
  async function toOriginalSize(blob, origW, origH) {
    const bmp = await createImageBitmap(blob);
    if (bmp.width === origW && bmp.height === origH) return blob;
        
    const c = document.createElement('canvas');
    c.width = origW; c.height = origH;
    const g = c.getContext('2d', { alpha: true });
    g.clearRect(0, 0, origW, origH);
        
    const s = Math.min(origW / bmp.width, origH / bmp.height);
    const dw = Math.round(bmp.width * s);
    const dh = Math.round(bmp.height * s);
    const dx = Math.round((origW - dw) / 2);
    const dy = Math.round((origH - dh) / 2);
        
    g.drawImage(bmp, dx, dy, dw, dh);
        
    return await new Promise((res) => c.toBlob(res, 'image/png'));
  }
    
  /** Public entry: replace the image while keeping label alignment. */
  window.replaceImagePreservingOffsets = async function({ label, newBlob, reason='replace' }) {
    const dims = lastImageDims[label] || { w: window.currentImageWidth, h: window.currentImageHeight };
    const oldW = dims?.w || 0, oldH = dims?.h || 0;
        
    // **CRITICAL FIX**: Preserve stroke data before image replacement
    const preservedStrokeData = {
      vectorStrokes: window.vectorStrokesByImage[label] ? JSON.parse(JSON.stringify(window.vectorStrokesByImage[label])) : {},
      lineStrokes: window.lineStrokesByImage[label] ? [...(window.lineStrokesByImage[label] || [])] : [],
      strokeVisibility: window.strokeVisibilityByImage[label] ? JSON.parse(JSON.stringify(window.strokeVisibilityByImage[label])) : {},
      strokeLabelVisibility: window.strokeLabelVisibility[label] ? JSON.parse(JSON.stringify(window.strokeLabelVisibility[label])) : {},
      strokeMeasurements: window.strokeMeasurements[label] ? JSON.parse(JSON.stringify(window.strokeMeasurements[label])) : {}
    };
        
    // If enabled, force-resize the incoming bitmap to the old intrinsic size
    let processedBlob = newBlob;
    if (window.flags?.BG_REMOVED_FORCE_ORIGINAL_SIZE ?? true) {
      try {
        processedBlob = await toOriginalSize(newBlob, oldW, oldH);
        console.debug('[SIZE-PIN] Forced BG-removed bitmap to %dx%d', oldW, oldH);
      } catch (e) {
        console.warn('[SIZE-PIN] Failed to force size; continuing with native dims', e);
      }
    }
        
    // Inspect incoming blob dims
    const bmp = await createImageBitmap(processedBlob);
    const newW = bmp.width, newH = bmp.height;
        
    await withFrozenTransform(async () => {
      // If size changed and we didn't pin size, reproject offsets
      if ((newW !== oldW || newH !== oldH) && !(window.flags?.BG_REMOVED_FORCE_ORIGINAL_SIZE ?? true)) {
        reprojectAllOffsetsForLabel(label, oldW, oldH, newW, newH);
      } else {
        // Still normalize stored offsets to be future-proof
        const table = (window.calculatedLabelOffsets && window.calculatedLabelOffsets[label]) || {};
        for (const tag of Object.keys(table)) {
          table[tag] = {
            ...normToPx(ensureNorm(table[tag], oldW, oldH), newW, newH),
            version: 1
          };
        }
      }
            
      // Swap bitmap via existing pipeline
      // Convert blob to data URL to avoid blob URL timing issues
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(processedBlob);
      });
            
      await window.pasteImageFromUrl(dataUrl, label, {
        preserveCanvasScale: true,
        preserveBasis: 'width'
      });
    });
        
    // **CRITICAL FIX**: Restore stroke data after image replacement
    if (preservedStrokeData.vectorStrokes && Object.keys(preservedStrokeData.vectorStrokes).length > 0) {
      window.vectorStrokesByImage[label] = preservedStrokeData.vectorStrokes;
      console.debug('[REPLACE] Restored %d vector strokes for %s', Object.keys(preservedStrokeData.vectorStrokes).length, label);
    }
    if (preservedStrokeData.lineStrokes && preservedStrokeData.lineStrokes.length > 0) {
      window.lineStrokesByImage[label] = preservedStrokeData.lineStrokes;
      console.debug('[REPLACE] Restored %d line strokes for %s', preservedStrokeData.lineStrokes.length, label);
    }
    if (preservedStrokeData.strokeVisibility && Object.keys(preservedStrokeData.strokeVisibility).length > 0) {
      window.strokeVisibilityByImage[label] = preservedStrokeData.strokeVisibility;
      console.debug('[REPLACE] Restored stroke visibility for %s', label);
    }
    if (preservedStrokeData.strokeLabelVisibility && Object.keys(preservedStrokeData.strokeLabelVisibility).length > 0) {
      window.strokeLabelVisibility[label] = preservedStrokeData.strokeLabelVisibility;
      console.debug('[REPLACE] Restored stroke label visibility for %s', label);
    }
    if (preservedStrokeData.strokeMeasurements && Object.keys(preservedStrokeData.strokeMeasurements).length > 0) {
      window.strokeMeasurements[label] = preservedStrokeData.strokeMeasurements;
      console.debug('[REPLACE] Restored stroke measurements for %s', label);
    }
        
    lastImageDims[label] = { w: newW, h: newH };
    console.debug('[REPLACE] %s ? %s (%sx%s) reason=%s',
      label, label, newW, newH, reason);
  };
    
  /** Hook into existing BG-removal completion */
  window.onBackgroundRemoved = async function(label, blob) {
    // Centralized path
    await window.replaceImagePreservingOffsets({ label, newBlob: blob, reason: 'bg-removed' });
  };
    
  /** Migrate offsets table at startup to normalized form (idempotent) */
  function migrateOffsetsToNorm() {
    const map = window.calculatedLabelOffsets || {};
    for (const label of Object.keys(map)) {
      const dims = lastImageDims[label] || { w: window.currentImageWidth, h: window.currentImageHeight };
      const { w, h } = dims;
      const table = map[label];
      for (const tag of Object.keys(table)) {
        table[tag] = ensureNorm(table[tag], w, h); // becomes v2
      }
    }
    console.debug('[MIGRATE] Offsets normalized (v2) for %d images', Object.keys(map).length);
  }

  // **NEW**: Initialize offset system
  function initializeOffsetSystem() {
    // Record initial dims for current image if known
    if (window.currentImageLabel && window.originalImages) {
      const img = window.originalImages[window.currentImageLabel];
      if (img?.width && img?.height) {
        lastImageDims[window.currentImageLabel] = { w: img.width, h: img.height };
      }
    }
    if (window.flags?.LABEL_OFFSETS_NORM ?? true) {
      migrateOffsetsToNorm();
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeOffsetSystem);
  } else {
    initializeOffsetSystem();
  }
    
  // **NEW**: Persistence guard for offset stability
  // Prevent saving offsets during unstable transform states
  window.checkPersistenceGuard = function(imageLabel, operation = 'save') {
    const session = window.getTransformSession();
    if (!session) {
      console.warn(`[PERSISTENCE-GUARD] No session available for ${imageLabel}`);
      return false;
    }

    if (session.phase !== 'Stable') {
      console.log(`[PERSISTENCE-GUARD] ${operation}_blocked: Transform not stable (${session.phase}) for ${imageLabel}`);
      return false;
    }

    // Check roundtrip accuracy
    const canPersist = window.canPersistOffsets(session);
    if (!canPersist) {
      console.log(`[PERSISTENCE-GUARD] ${operation}_blocked: Roundtrip error too high for ${imageLabel}`);
    }

    return canPersist;
  };

  // **NEW**: Feature flags for offset handling
  if (!window.flags) {
    window.flags = {
      LABEL_OFFSETS_NORM: true,
      BG_REMOVED_FORCE_ORIGINAL_SIZE: true
    };
  }

  // **NEW**: Session persistence for fit modes
  // Store fit mode preferences per image for consistent behavior
  if (!window._fitSessions) {
    window._fitSessions = {}; // { [imageLabel]: { mode, naturalW, naturalH, basisDim } }
  }

  window.saveFitSession = function(imageLabel, fitMode, natural) {
    if (!imageLabel || !natural) return;

    window._fitSessions[imageLabel] = {
      mode: fitMode,
      naturalW: natural.width,
      naturalH: natural.height,
      timestamp: Date.now()
    };

    if (window.labelReprojectDebug && labelReprojectDebug()) {
      console.log(`[FIT-SESSION] Saved: ${imageLabel} -> ${fitMode} (${natural.width}x${natural.height})`);
    }
  };

  window.getFitSession = function(imageLabel) {
    return window._fitSessions[imageLabel] || null;
  };

  // **NEW**: Deterministic fit calculation using Transform T and session persistence
  function calculateFitScale(fitMode) {
    const imageDimensions = window.originalImageDimensions[currentImageLabel];
    if (!imageDimensions || !imageDimensions.width || !imageDimensions.height) {
      console.warn('No image dimensions available for fit calculation');
      return { scale: 1.0, position: { x: 0, y: 0 } };
    }

    // Get canvas viewport dimensions (CSS pixels)
    const canvasRect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
    let viewportWidth = canvasRect ? canvasRect.width : canvas.width;
    let viewportHeight = canvasRect ? canvasRect.height : canvas.height;

    // Handle UI panels that reserve space (project panel, tools, etc.)
    let offsetX = 0, offsetY = 0;
    if (canvasRect) {
      const margin = 16;
      const isVisible = (el) => el && el.offsetParent !== null;

      const leftPanels = ['toolsPanel', 'strokePanel'];
      let leftReserve = 0;
      leftPanels.forEach(id => {
        const el = document.getElementById(id);
        if (isVisible(el)) {
          const rect = el.getBoundingClientRect();
          leftReserve = Math.max(leftReserve, rect.right + margin);
        }
      });

      const rightPanels = ['projectPanel', 'imagePanel'];
      let rightReserve = 0;
      rightPanels.forEach(id => {
        const el = document.getElementById(id);
        if (isVisible(el)) {
          const rect = el.getBoundingClientRect();
          rightReserve = Math.max(rightReserve, (window.innerWidth - rect.left) + margin);
        }
      });

      let topReserve = 0;
      const toolbar = document.getElementById('topToolbar');
      if (isVisible(toolbar)) {
        const rect = toolbar.getBoundingClientRect();
        topReserve = Math.max(topReserve, rect.bottom + margin);
      }

      let bottomReserve = 0;
      const bottomPanel = document.getElementById('canvasControls');
      if (isVisible(bottomPanel)) {
        const rect = bottomPanel.getBoundingClientRect();
        bottomReserve = Math.max(bottomReserve, (window.innerHeight - rect.top) + margin);
      }

      const availableWidth = Math.min(
        window.innerWidth,
        Math.max(320, window.innerWidth - leftReserve - rightReserve)
      );
      const availableHeight = Math.min(
        window.innerHeight,
        Math.max(240, window.innerHeight - topReserve - bottomReserve)
      );

      const usingReservedViewport = (availableWidth < window.innerWidth) || (availableHeight < window.innerHeight);

      if (usingReservedViewport) {
        viewportWidth = availableWidth;
        viewportHeight = availableHeight;

        const canvasCenterX = canvasRect.left + canvasRect.width / 2;
        const canvasCenterY = canvasRect.top + canvasRect.height / 2;
        const targetCenterX = Math.max(leftReserve, 0) + viewportWidth / 2;
        const targetCenterY = Math.max(topReserve, 0) + viewportHeight / 2;

        offsetX = targetCenterX - canvasCenterX;
        offsetY = targetCenterY - canvasCenterY;
      }
    }

    // Handle capture frame if present
    const captureEl = document.getElementById('captureFrame');
    if (captureEl && canvasRect) {
      const frameRect = captureEl.getBoundingClientRect();
      const left = Math.max(frameRect.left, canvasRect.left);
      const top = Math.max(frameRect.top, canvasRect.top);
      const right = Math.min(frameRect.right, canvasRect.right);
      const bottom = Math.min(frameRect.bottom, canvasRect.bottom);
      const cssWidth = Math.max(0, right - left);
      const cssHeight = Math.max(0, bottom - top);

      if (cssWidth > 0 && cssHeight > 0) {
        // Use capture frame for scaling calculations
        viewportWidth = cssWidth;
        viewportHeight = cssHeight;

        // Center relative to the capture frame center instead of full canvas center
        const frameCenterX = (left + right) / 2;
        const frameCenterY = (top + bottom) / 2;
        const canvasCenterX = canvasRect.left + canvasRect.width / 2;
        const canvasCenterY = canvasRect.top + canvasRect.height / 2;
        offsetX = frameCenterX - canvasCenterX;
        offsetY = frameCenterY - canvasCenterY;

        console.log(`[FIT] Using capture frame: ${cssWidth}x${cssHeight}, offsets: (${offsetX.toFixed(1)}, ${offsetY.toFixed(1)})`);
      }
    }

    // Use deterministic fit calculation from geometry.js
    const imageNatural = { w: imageDimensions.width, h: imageDimensions.height };
    const viewportCss = { w: viewportWidth, h: viewportHeight };

    let scale = window.computeScaleForFit(imageNatural, viewportCss, fitMode);

    // Clamp scale to reasonable bounds
    const sizeClamp = Math.max(0.01, Math.min(100, scale));
    const widthScaleLimit = viewportCss.w > 0 ? viewportCss.w / imageNatural.w : Infinity;
    const heightScaleLimit = viewportCss.h > 0 ? viewportCss.h / imageNatural.h : Infinity;
    const containScale = Math.min(widthScaleLimit, heightScaleLimit, sizeClamp);
    scale = Number.isFinite(containScale) && containScale > 0 ? containScale : sizeClamp;

    console.log(`[FIT] ${fitMode}: ${imageNatural.w}x${imageNatural.h} ? ${viewportCss.w}x${viewportCss.h} = scale ${scale.toFixed(3)}`);

    // Always center the image in the full canvas viewport
    // Get actual canvas dimensions for centering
    const canvasRectForCentering = canvas.getBoundingClientRect();
    const canvasWidth = canvasRectForCentering ? canvasRectForCentering.width : canvas.width;
    const canvasHeight = canvasRectForCentering ? canvasRectForCentering.height : canvas.height;
        
    // Calculate scaled image dimensions
    const scaledImageWidth = imageDimensions.width * scale;
    const scaledImageHeight = imageDimensions.height * scale;
        
    // Compute centered top-left and pan offset relative to centered position
    const defaultCenterX = (canvasWidth - scaledImageWidth) / 2;
    const defaultCenterY = (canvasHeight - scaledImageHeight) / 2;
    const topLeftX = defaultCenterX + offsetX;
    const topLeftY = defaultCenterY + offsetY;

    // Clamp so the image stays within canvas bounds during extreme resizes
    const minTopLeftX = Math.min(0, canvasWidth - scaledImageWidth);
    const maxTopLeftX = Math.max(0, canvasWidth - scaledImageWidth);
    const minTopLeftY = Math.min(0, canvasHeight - scaledImageHeight);
    const maxTopLeftY = Math.max(0, canvasHeight - scaledImageHeight);

    const clampedTopLeftX = Math.min(Math.max(topLeftX, minTopLeftX), maxTopLeftX);
    const clampedTopLeftY = Math.min(Math.max(topLeftY, minTopLeftY), maxTopLeftY);

    const finalOffsetX = clampedTopLeftX - defaultCenterX;
    const finalOffsetY = clampedTopLeftY - defaultCenterY;

    if (clampedTopLeftX !== topLeftX || clampedTopLeftY !== topLeftY) {
      console.log(`[FIT] Clamped viewport: requestedTopLeft(${topLeftX.toFixed(1)}, ${topLeftY.toFixed(1)}) -> clamped(${clampedTopLeftX.toFixed(1)}, ${clampedTopLeftY.toFixed(1)})`);
    }

    console.log(`[FIT] Centering image in full canvas: canvas(${canvasWidth}x${canvasHeight}) scaled(${scaledImageWidth.toFixed(1)}x${scaledImageHeight.toFixed(1)}) topLeft(${clampedTopLeftX.toFixed(1)}, ${clampedTopLeftY.toFixed(1)}) panOffset(${finalOffsetX.toFixed(1)}, ${finalOffsetY.toFixed(1)})`);

    // Return offset relative to centered position
    return { scale, position: { x: finalOffsetX, y: finalOffsetY } };
  }
    
  function applyFitMode(fitMode) {
    if (!currentImageLabel) {
      console.warn('No current image selected');
      return;
    }
        
    const { scale, position } = calculateFitScale(fitMode);
        
    // **NEW**: Use Transform T system for deterministic updates
    const currentT = window.getCurrentTransform();
    const newT = {
      scale: scale,
      panX: position.x,
      panY: position.y,
      dpr: currentT.dpr
    };

    window.setTransform(newT);

    // Save fit session for persistence
    const imageDimensions = window.originalImageDimensions[currentImageLabel];
    if (imageDimensions) {
      window.saveFitSession(currentImageLabel, fitMode, imageDimensions);
    }
        
    // Save state for undo/redo
    saveState(true, false, false);
        
    // Update UI scale text before redraw to keep it in sync
    try { if (typeof updateScaleUI === 'function') updateScaleUI(); } catch(_) {}
    // Redraw with new scale and position
    redrawCanvasWithVisibility();
        
    console.log(`Applied ${fitMode} to current image ${currentImageLabel}: scale=${scale.toFixed(2)}, position=(${position.x.toFixed(1)}, ${position.y.toFixed(1)})`);
  }
    
  function applyFitModeToAll(fitMode) {
    if (!window.originalImageDimensions || Object.keys(window.originalImageDimensions).length === 0) {
      console.warn('No images loaded');
      return;
    }
        
    let appliedCount = 0;
    const currentLabel = currentImageLabel; // Store current image to restore later
        
    // Apply fit mode to all images
    Object.keys(window.originalImageDimensions).forEach(label => {
      if (window.originalImageDimensions[label] && window.originalImageDimensions[label].width > 0) {
        // Temporarily set current image to calculate fit for this specific image
        const originalCurrentLabel = currentImageLabel;
        currentImageLabel = label;
                
        const { scale, position } = calculateFitScale(fitMode);
                
        // Update the scale and position for this image
        window.imageScaleByLabel[label] = scale;
        window.imagePositionByLabel[label] = { ...position };
                
        appliedCount++;
        console.log(`Applied ${fitMode} to image ${label}: scale=${scale.toFixed(2)}`);
                
        // Restore current image label
        currentImageLabel = originalCurrentLabel;
      }
    });
        
    // Restore the original current image
    currentImageLabel = currentLabel;
        
    // Save state for undo/redo
    saveState(true, false, false);
        
    // Update UI for current image and redraw
    try { if (typeof updateScaleUI === 'function') updateScaleUI(); } catch(_) {}
    // Redraw with new scale and position for current image
    redrawCanvasWithVisibility();
        
    console.log(`Applied ${fitMode} to ${appliedCount} images`);
  }
    
  // Fit control event listeners (with null checks since buttons were removed)
  if (applyFitCurrentButton) {
    applyFitCurrentButton.addEventListener('click', () => {
      applyFitMode(fitModeSelect.value);
    });
  }
    
  if (applyFitAllButton) {
    applyFitAllButton.addEventListener('click', () => {
      applyFitModeToAll(fitModeSelect.value);
    });
  }
    
  // Apply fit mode when selection changes (for immediate feedback on current image)
  if (fitModeSelect) {
    fitModeSelect.addEventListener('change', () => {
      if (fitModeSelect.value !== 'none') {
        applyFitMode(fitModeSelect.value);
      }
    });
  }

  // PERFORMANCE OPTIMIZATIONS: Cache variables moved to top of file for early initialization

  // Signal readiness for external modules (e.g., tag-manager) to avoid hook races
  try { window.paintReady = window.paintReady || Promise.resolve(true); } catch (_) {}

  // PERFORMANCE: Optimized throttled mousemove handler
  function handleMouseMoveThrottled(x, y) {
    // Early exit if dragging - these operations don't need expensive hover detection
    if (isDraggingImage || isDraggingLabel || isDraggingControlPoint || isDraggingTextElement || isDrawing) {
      return;
    }

    // PERFORMANCE: Update cached coordinates only when needed
    if (cacheInvalidated) {
      updateInteractiveElementCache();
      cacheInvalidated = false;
    }

    // Check if hovering over text element first
    const hoveredTextElement = findTextElementAtPoint(x, y);

    // PERFORMANCE: Use cached positions for faster hover detection
    const newHoveredLabelInfo = findLabelAtPointOptimized(x, y);
        
    // Update cursor and visual hover state only if hovered label changed
    if (hoveredTextElement) {
      updateCursor('move', 'hovering text element');
    } else if ((hoveredCanvasLabelInfo?.strokeLabel !== newHoveredLabelInfo?.strokeLabel) || 
            (!hoveredCanvasLabelInfo && newHoveredLabelInfo) || 
            (hoveredCanvasLabelInfo && !newHoveredLabelInfo)) {
            
      hoveredCanvasLabelInfo = newHoveredLabelInfo;

      if (hoveredCanvasLabelInfo) {
        updateCursor('pointer', `hovering label ${hoveredCanvasLabelInfo.strokeLabel}`);
      } else {
        updateCursor('default', 'canvas default');
      }
    }
        
    // PERFORMANCE: Only check control points if in edit mode (avoid expensive calculations when not needed)
    if (window.selectedStrokeInEditMode) {
      const controlPointHover = findControlPointAtPositionOptimized(x, y);
            
      if (controlPointHover) {
        if(canvas.style.cursor !== 'grab' && canvas.style.cursor !== 'grabbing') {
          updateCursor('grab', `control point ${controlPointHover.type} ${controlPointHover.pointIndex}`);
        }
      } else {
        // Reset cursor when not hovering over control points but still in edit mode
        if (canvas.style.cursor === 'grab' && !hoveredCanvasLabelInfo) {
          updateCursor('default', 'edit mode no hover');
        }
      }
    }
  }

  // PERFORMANCE: Update cache for interactive elements
  function updateInteractiveElementCache() {
    const startTime = performance.now();
        
    // Update cached label positions
    cachedLabelPositions.clear();
    if (currentLabelPositions && currentLabelPositions.length > 0) {
      for (const label of currentLabelPositions) {
        cachedLabelPositions.set(label.strokeLabel, {
          x: label.x,
          y: label.y,
          width: label.width,
          height: label.height,
          strokeLabel: label.strokeLabel
        });
      }
    }

    // Update cached control points for selected/edit mode strokes
    cachedControlPoints.clear();
    const strokeToCheck = window.selectedStrokeInEditMode || window.selectedStrokeByImage[currentImageLabel];
    if (strokeToCheck) {
      const vectorData = vectorStrokesByImage[currentImageLabel]?.[strokeToCheck];
      if (vectorData) {
        if ((vectorData.type === 'curved' || vectorData.type === 'curved-arrow') && vectorData.controlPoints) {
          cacheControlPointsForStroke(strokeToCheck, vectorData);
        } else if ((vectorData.type === 'straight' || vectorData.type === 'arrow') && vectorData.points?.length >= 2) {
          cacheEndpointsForStroke(strokeToCheck, vectorData);
        }
      }
    }
        
    const endTime = performance.now();
    //         console.log(`[PERF] Cache update took ${(endTime - startTime).toFixed(2)}ms`);
  }

  // PERFORMANCE: Cache control points for curved strokes
  function cacheControlPointsForStroke(strokeLabel, vectorData) {
    const transformContext = getTransformationContext(currentImageLabel);
        
    for (let i = 0; i < vectorData.controlPoints.length; i++) {
      const controlPoint = vectorData.controlPoints[i];
      const canvasCoords = transformImagePointToCanvas({ x: controlPoint.x, y: controlPoint.y }, transformContext);
            
      const scale = transformContext.scale;
      const baseRadius = 8;
      const scaledRadius = Math.max(8, baseRadius * scale) + 5; // Add 5px padding
            
      cachedControlPoints.set(`${strokeLabel}_${i}`, {
        x: canvasCoords.x,
        y: canvasCoords.y,
        radius: scaledRadius,
        strokeLabel: strokeLabel,
        pointIndex: i,
        type: 'curved'
      });
    }
  }

  // PERFORMANCE: Cache endpoints for straight/arrow strokes
  function cacheEndpointsForStroke(strokeLabel, vectorData) {
    // Use unified coordinate transformation system
    const transformParams = getTransformationParams(currentImageLabel);
    const scale = transformParams.scale;
        
    const endpoints = [
      { point: vectorData.points[0], index: 'start' },
      { point: vectorData.points[vectorData.points.length - 1], index: 'end' }
    ];
        
    for (const { point, index } of endpoints) {
      const transformed = imageToCanvasCoords(point.x, point.y, transformParams);
      const transformedX = transformed.x;
      const transformedY = transformed.y;
            
      const baseRadius = ANCHOR_SIZE || 8;
      const scaledRadius = Math.max(8, baseRadius * scale) + 5; // Add 5px padding
            
      cachedControlPoints.set(`${strokeLabel}_${index}`, {
        x: transformedX,
        y: transformedY,
        radius: scaledRadius,
        strokeLabel: strokeLabel,
        pointIndex: index,
        type: vectorData.type
      });
    }
  }

  // PERFORMANCE: Optimized label detection using cached positions
  function findLabelAtPointOptimized(x, y) {
    for (const [strokeLabel, labelInfo] of cachedLabelPositions) {
      // Center-anchored labels: convert to top-left for hit test
      const left = labelInfo.x - labelInfo.width / 2;
      const top = labelInfo.y - labelInfo.height / 2;
      if (x >= left && x <= left + labelInfo.width &&
                y >= top && y <= top + labelInfo.height) {
        return labelInfo;
      }
    }
    return null;
  }

  // PERFORMANCE: Optimized control point detection using cached positions
  function findControlPointAtPositionOptimized(x, y) {
    for (const [key, controlPoint] of cachedControlPoints) {
      const distance = Math.sqrt((x - controlPoint.x) ** 2 + (y - controlPoint.y) ** 2);
      if (distance <= controlPoint.radius) {
        return {
          strokeLabel: controlPoint.strokeLabel,
          pointIndex: controlPoint.pointIndex,
          canvasX: controlPoint.x,
          canvasY: controlPoint.y,
          type: controlPoint.type
        };
      }
    }
    return null;
  }

  // Mouse drag variables for image movement
  let isDraggingImage = false;
  let lastMouseX = 0;
  let lastMouseY = 0;
  let hoveredCanvasLabelInfo = null; // NEW: To store info about the label currently hovered on canvas
    
  // Helper function to find if a point is inside a label
  function findLabelAtPoint(x, y) {
    for (const label of currentLabelPositions) {
      // Simple rectangular hit test using the final canvas positions
      // The currentLabelPositions already contains the final rotated canvas coordinates
      const left = label.x - label.width / 2;
      const top = label.y - label.height / 2;
      const right = label.x + label.width / 2;
      const bottom = label.y + label.height / 2;
      
      const isHit = x >= left && x <= right && y >= top && y <= bottom;
      
      if (isHit) {
        return label;
      }
    }
    
    return null;
  }
    
  // Centralized canvas event binding function
  function bindCanvasListeners() {
    if (window.paintApp.state.listenersBound) {
      console.log('[Event] Canvas listeners already bound, skipping');
      return;
    }
        
    const { eventListeners } = window.paintApp.state;
    console.log('[Event] Binding canvas listeners with AbortController');
    console.log('[Event] Canvas element:', canvas);
    console.log('[Event] Canvas ID:', canvas.id);
        
    // Canvas pointer events (works for both mouse and touch)
    canvas.addEventListener('pointerdown', onCanvasMouseDown, { signal: eventListeners.signal });
    canvas.addEventListener('pointermove', onCanvasMouseMove, { signal: eventListeners.signal });
    canvas.addEventListener('pointerup', onCanvasMouseUp, { signal: eventListeners.signal });
    canvas.addEventListener('pointercancel', onCanvasMouseOut, { signal: eventListeners.signal });
    canvas.addEventListener('pointerleave', onCanvasMouseOut, { signal: eventListeners.signal });
    canvas.addEventListener('dblclick', onCanvasDoubleClick, { signal: eventListeners.signal });
    canvas.addEventListener('wheel', onCanvasWheel, { signal: eventListeners.signal, passive: true });
    canvas.addEventListener('scalechange', onCanvasScaleChange, { signal: eventListeners.signal });
    // canvas.addEventListener('contextmenu', onCanvasRightClick, { signal: eventListeners.signal }); // Disabled to allow browser context menu
    console.log('[Event] Pointer and context menu listeners bound to canvas (supports touch + mouse)');
        

        
    // Allow standard browser context menu on canvas for image operations
        
    // Window mouse events for global dragging
    window.addEventListener('mousemove', onWindowMouseMove, { signal: eventListeners.signal });
    window.addEventListener('mouseup', onWindowMouseUp, { signal: eventListeners.signal });
        
    window.paintApp.state.listenersBound = true;
    console.warn('[PAINT.JS] Event listeners bound successfully');
        
    // Debug panel visibility
    const toolsPanel = document.getElementById('toolsPanel');
    if (toolsPanel) {
      console.log('[PAINT.JS] Tools panel found, visibility:', {
        display: getComputedStyle(toolsPanel).display,
        visibility: getComputedStyle(toolsPanel).visibility,
        opacity: getComputedStyle(toolsPanel).opacity,
        position: getComputedStyle(toolsPanel).position,
        top: getComputedStyle(toolsPanel).top,
        left: getComputedStyle(toolsPanel).left
      });
    } else {
      console.warn('[PAINT.JS] Tools panel not found!');
    }
  }

  // Canvas event handlers
  function onCanvasMouseDown(e) {
    // Check if this is a right-click (button 2) - prevent default context menu
    if (e.button === 2) {
      // Prevent default browser context menu
      e.preventDefault();
      e.stopPropagation();
      return;
    }
        
    // First, check if we should be dragging the image (shift key pressed)
    if (isShiftPressed) {
      isDraggingImage = true;
      lastMouseX = e.offsetX;
      lastMouseY = e.offsetY;
      canvas.style.cursor = 'grabbing';
            
      // CRITICAL FIX: Don't exit edit mode when panning - preserve the edit state
      //             console.log('Canvas Mousedown: Starting image drag (shift+click) - preserving edit mode');
      return;
    }

    // CURVE_DEFOCUS_FIX_2: Handle defocus click immediately if a curve was just completed
    // This ensures the first single click after curve finalization only deselects
    // and does not start a new drawing operation.
    // BUT: Don't treat stroke tag clicks as defocus clicks - check if clicking on canvas labels/tags
    const isClickOnStrokeTag = e.target.closest('.stroke-visibility-item') !== null;
        
    // Check if clicking on a canvas label (stroke tag drawn on canvas)
    // Use new coordinate system if available
    const coords = window.getPointerCoords(e);
    // Transform coordinates to match how labels are positioned
    const currentImageLabel = window.currentImageLabel || window.paintApp?.state?.currentImageLabel || 'front';
    const transformParams = getTransformationParams(currentImageLabel);
    const canvasFromImage = imageToCanvasCoords(coords.image.x, coords.image.y, transformParams);
    
    const clickedCanvasLabel = findLabelAtPoint(canvasFromImage.x, canvasFromImage.y);
    const isClickOnCanvasLabel = clickedCanvasLabel !== null;
        
    // Check if clicking on a text element
    console.log('[TEXT CHECK] About to call findTextElementAtPoint at:', coords.canvas.x, coords.canvas.y);
    const clickedTextElement = findTextElementAtPoint(coords.canvas.x, coords.canvas.y);
    const isClickOnTextElement = clickedTextElement !== null;
    console.log('[TEXT CHECK] Result:', isClickOnTextElement, clickedTextElement);
        
    if (curveJustCompleted && !isClickOnStrokeTag && !isClickOnCanvasLabel) {
      handleDefocusClick(); // This will set curveJustCompleted to false and deselect.
            
      // ROBUST_FIX: Set multiple flags to definitively prevent any drawing logic from executing
      isDrawing = false;
      isDrawingOrPasting = false;
      strokeInProgress = false;
            
      e.preventDefault();   // Prevent any further mousedown processing (like starting a new stroke).
      e.stopPropagation();  // Stop event from bubbling up
      e.stopImmediatePropagation(); // Stop any other event handlers on the same element
      //             console.log('Canvas Mousedown: CURVE_DEFOCUS_FIX - Definitively stopped all drawing flags and event propagation');
      return;               // Stop further execution of this mousedown handler.
    } else if (curveJustCompleted && (isClickOnStrokeTag || isClickOnCanvasLabel)) {
      // If it's a stroke tag click (sidebar or canvas label), just clear the flag without defocusing
      curveJustCompleted = false;
    } else {
    }

    // Check for double-click on stroke on canvas (for entering edit mode)
    // BUT FIRST: If we're in curved drawing mode with control points, prioritize curve finalization
    const now = Date.now();
    const timeSinceLastClick = now - window.lastCanvasClickTime;
    if (timeSinceLastClick < window.clickDelay) {
      // Priority 1: If in curved mode with control points, finalize the curve (don't enter edit mode)
      if (drawingMode === 'curved' && curvedLinePoints.length >= 2) {
        //                 console.log('Canvas Mousedown: Double-click detected while drawing curve - will finalize curve via dblclick handler');
        window.lastCanvasClickTime = 0; // Reset to prevent edit mode logic
        window.lastClickedCanvasLabel = null;
        // Let the dblclick handler manage curve finalization
        return;
      }
            
      // Priority 2a: Text element clicks are now handled by single-click below (removed old double-click handler)
      // Check moved to avoid duplicate edit boxes
      const clickedTextForDoubleClick = null;  // Disabled - using single-click handler instead
      if (false && clickedTextForDoubleClick) {
        // Convert world coordinates to canvas coordinates for text box positioning
        const canvasCoords = window.worldToClient ? 
          window.worldToClient(clickedTextForDoubleClick.element.x, clickedTextForDoubleClick.element.y) : 
          { x: clickedTextForDoubleClick.element.x, y: clickedTextForDoubleClick.element.y };
                
        // Create beautiful editable text box with Tailwind-like styling
        const editBox = document.createElement('div');
        editBox.contentEditable = true;
        editBox.textContent = clickedTextForDoubleClick.element.text;
        editBox.style.cssText = `
                    position: absolute;
                    left: ${canvasCoords.x}px;
                    top: ${canvasCoords.y}px;
                    min-width: 120px;
                    min-height: 40px;
                    width: ${Math.max(120, clickedTextForDoubleClick.element.width)}px;
                    height: ${Math.max(40, clickedTextForDoubleClick.element.height)}px;
                    padding: 12px 16px;
                    border: 3px solid #3b82f6;
                    border-radius: 8px;
                    background: rgba(255, 255, 255, 0.98);
                    backdrop-filter: blur(10px);
                    font-family: ${clickedTextForDoubleClick.element.fontFamily || 'Arial, sans-serif'};
                    font-size: ${clickedTextForDoubleClick.element.fontSize || 16}px;
                    color: ${clickedTextForDoubleClick.element.color || '#1f2937'};
                    resize: none;
                    overflow: hidden;
                    z-index: 1000;
                    outline: none;
                    cursor: text;
                    box-shadow: 0 8px 32px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.08);
                    user-select: text;
                    transition: all 0.2s ease;
                `;

        // Add resize handles
        const resizeHandles = ['nw', 'ne', 'se', 'sw'];
        resizeHandles.forEach(handle => {
          const handleEl = document.createElement('div');
          handleEl.className = `resize-handle resize-handle-${handle}`;
          handleEl.style.cssText = `
                        position: absolute;
                        width: 12px;
                        height: 12px;
                        background: #3b82f6;
                        border: 2px solid white;
                        border-radius: 50%;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                        cursor: ${handle}-resize;
                        z-index: 1001;
                    `;

          switch(handle) {
            case 'nw':
              handleEl.style.top = '-6px';
              handleEl.style.left = '-6px';
              break;
            case 'ne':
              handleEl.style.top = '-6px';
              handleEl.style.right = '-6px';
              break;
            case 'se':
              handleEl.style.bottom = '-6px';
              handleEl.style.right = '-6px';
              break;
            case 'sw':
              handleEl.style.bottom = '-6px';
              handleEl.style.left = '-6px';
              break;
          }

          // Make resize handles functional
          handleEl.addEventListener('mousedown', (ev) => {
            ev.stopPropagation();
            ev.preventDefault();
                        
            const startX = ev.clientX;
            const startY = ev.clientY;
            const startWidth = editBox.offsetWidth;
            const startHeight = editBox.offsetHeight;
            const startLeft = editBox.offsetLeft;
            const startTop = editBox.offsetTop;

            const handleResizeMove = (moveEv) => {
              const deltaX = moveEv.clientX - startX;
              const deltaY = moveEv.clientY - startY;

              switch(handle) {
                case 'se':
                  editBox.style.width = Math.max(120, startWidth + deltaX) + 'px';
                  editBox.style.height = Math.max(40, startHeight + deltaY) + 'px';
                  break;
                case 'sw':
                  editBox.style.width = Math.max(120, startWidth - deltaX) + 'px';
                  editBox.style.height = Math.max(40, startHeight + deltaY) + 'px';
                  editBox.style.left = (startLeft + deltaX) + 'px';
                  break;
                case 'ne':
                  editBox.style.width = Math.max(120, startWidth + deltaX) + 'px';
                  editBox.style.height = Math.max(40, startHeight - deltaY) + 'px';
                  editBox.style.top = (startTop + deltaY) + 'px';
                  break;
                case 'nw':
                  editBox.style.width = Math.max(120, startWidth - deltaX) + 'px';
                  editBox.style.height = Math.max(40, startHeight - deltaY) + 'px';
                  editBox.style.left = (startLeft + deltaX) + 'px';
                  editBox.style.top = (startTop + deltaY) + 'px';
                  break;
              }
            };

            const handleResizeUp = () => {
              document.removeEventListener('mousemove', handleResizeMove);
              document.removeEventListener('mouseup', handleResizeUp);
            };

            document.addEventListener('mousemove', handleResizeMove);
            document.addEventListener('mouseup', handleResizeUp);
          });

          editBox.appendChild(handleEl);
        });

        // Add drag handle
        const dragHandle = document.createElement('div');
        dragHandle.className = 'drag-handle';
        dragHandle.textContent = '⋮⋮';
        dragHandle.style.cssText = `
                    position: absolute;
                    top: 0;
                    right: 0;
                    width: 20px;
                    height: 20px;
                    background: #3b82f6;
                    color: white;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 10px;
                    cursor: move;
                    border-radius: 0 8px 0 4px;
                    z-index: 1001;
                    user-select: none;
                    pointer-events: auto;
                `;
        editBox.appendChild(dragHandle);

        // Make drag handle draggable
        dragHandle.addEventListener('mousedown', (ev) => {
          // Clear any text selection immediately
          if (window.getSelection) {
            window.getSelection().removeAllRanges();
          }

          initialLeft = editBox.offsetLeft;
          initialTop = editBox.offsetTop;
          editDragStart = {
            mx: ev.clientX,
            my: ev.clientY
          };
          isDragging = true;
          editBox.style.cursor = 'move';
          editBox.style.userSelect = 'none';
          document.body.style.userSelect = 'none';
                    
          document.addEventListener('mousemove', handleEditMove);
          document.addEventListener('mouseup', handleEditUp);
          ev.preventDefault();
          ev.stopPropagation();
        });
                
        document.body.appendChild(editBox);
        setTimeout(() => {
          editBox.focus();
          // Position cursor at end of text instead of selecting all
          const range = document.createRange();
          const sel = window.getSelection();
          range.selectNodeContents(editBox);
          range.collapse(false); // Collapse to end
          sel.removeAllRanges();
          sel.addRange(range);
        }, 50);
                
        // Save on blur or Enter
        const saveEdit = () => {
          const newText = editBox.textContent.trim();
          if (newText) {
            clickedTextForDoubleClick.element.text = newText;
            clickedTextForDoubleClick.element.width = editBox.offsetWidth;
            clickedTextForDoubleClick.element.height = editBox.offsetHeight;

            // Update world coordinates based on final position
            const finalX = editBox.offsetLeft;
            const finalY = editBox.offsetTop;
                        
            const finalWorldCoords = window.clientToWorld ?
              window.clientToWorld(finalX, finalY) :
              { x: finalX, y: finalY };
            clickedTextForDoubleClick.element.x = finalWorldCoords.x;
            clickedTextForDoubleClick.element.y = finalWorldCoords.y;

            try { saveState(true, false, false); } catch(_) {}
            try { redrawCanvasWithVisibility(); } catch(_) {}
            try { updateStrokeVisibilityControls(); } catch(_) {}
          }
          editBox.remove();
        };
                
        editBox.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            saveEdit();
          } else if (ev.key === 'Escape') {
            editBox.remove();
          }
        });
                
        // Delay adding the click-outside handler to prevent immediate close from double-click
        setTimeout(() => {
          document.addEventListener('click', (ev) => {
            if (!editBox.contains(ev.target)) {
              saveEdit();
            }
          }, { once: true });
        }, 100);
                
        // Make draggable from anywhere in the box
        let editDragStart = null;
        let isDragging = false;
        let initialLeft = 0;
        let initialTop = 0;

        const handleEditMove = (ev) => {
          if (!editDragStart || !isDragging) return;
          ev.preventDefault();
                    
          const dx = ev.clientX - editDragStart.mx;
          const dy = ev.clientY - editDragStart.my;
                    
          // Use requestAnimationFrame for smooth updates (with fallback)
          if (window.requestAnimationFrame) {
            requestAnimationFrame(() => {
              editBox.style.left = (initialLeft + dx) + 'px';
              editBox.style.top = (initialTop + dy) + 'px';
            });
          } else {
            // Fallback for older browsers
            editBox.style.left = (initialLeft + dx) + 'px';
            editBox.style.top = (initialTop + dy) + 'px';
          }
        };

        const handleEditUp = () => {
          if (isDragging) {
            isDragging = false;
            editBox.style.cursor = 'text';
            editBox.style.userSelect = 'text';
            document.body.style.userSelect = '';
          }
          editDragStart = null;
          document.removeEventListener('mousemove', handleEditMove);
          document.removeEventListener('mouseup', handleEditUp);
        };

        editBox.addEventListener('mousedown', (ev) => {
          // Don't start drag if clicking on resize handles or drag handle
          if (ev.target.classList.contains('resize-handle') ||
                        ev.target.classList.contains('drag-handle')) {
            return;
          }

          // Clear any text selection immediately
          if (window.getSelection) {
            window.getSelection().removeAllRanges();
          }

          initialLeft = editBox.offsetLeft;
          initialTop = editBox.offsetTop;
          editDragStart = {
            mx: ev.clientX,
            my: ev.clientY
          };
          isDragging = true;
          editBox.style.cursor = 'move';
          editBox.style.userSelect = 'none';
          document.body.style.userSelect = 'none';
                    
          document.addEventListener('mousemove', handleEditMove);
          document.addEventListener('mouseup', handleEditUp);
          ev.preventDefault();
          ev.stopPropagation();
        });
                
        window.lastCanvasClickTime = 0;
        window.lastClickedTextElementId = null;
        e.preventDefault();
        return;
      }
            
      // Priority 2b: Normal edit mode logic for strokes (only if not finalizing a curve)
      const currentImageLabel = window.currentImageLabel || window.paintApp?.state?.currentImageLabel || 'front';
      const transformParams = getTransformationParams(currentImageLabel);
      const canvasFromImage = imageToCanvasCoords(coords.image.x, coords.image.y, transformParams);
      const clickedLabelForDoubleClick = findLabelAtPoint(canvasFromImage.x, canvasFromImage.y);
      if (clickedLabelForDoubleClick && window.lastClickedCanvasLabel === clickedLabelForDoubleClick.strokeLabel) {
        window.selectedStrokeInEditMode = clickedLabelForDoubleClick.strokeLabel;
                
        // Ensure it's also selected in the normal selection models
        window.selectedStrokeByImage[window.currentImageLabel] = clickedLabelForDoubleClick.strokeLabel;
        if (window.multipleSelectedStrokesByImage && window.multipleSelectedStrokesByImage[window.currentImageLabel]) {
          window.multipleSelectedStrokesByImage[window.currentImageLabel] = [clickedLabelForDoubleClick.strokeLabel];
        }

        if (typeof window.updateStrokeVisibilityControls === 'function') window.updateStrokeVisibilityControls();
        if (typeof window.redrawCanvasWithVisibility === 'function') window.redrawCanvasWithVisibility();
                
        window.lastCanvasClickTime = 0; // Reset for next double click
        window.lastClickedCanvasLabel = null;
        e.preventDefault(); // Prevent other mousedown actions like starting a drag or new stroke
        return;
      }
    }
    window.lastCanvasClickTime = now;
        
    // Track last clicked text element for double-click detection
    if (isClickOnTextElement) {
      window.lastClickedTextElementId = clickedTextElement.element.id;
    } else {
      window.lastClickedTextElementId = null;
    }
        

    // First, check if we're clicking on a control point (ONLY if in edit mode)
    if (window.selectedStrokeInEditMode) {
      const controlPointAtClick = findControlPointAtPosition(coords.canvas.x, coords.canvas.y);
      if (controlPointAtClick && controlPointAtClick.strokeLabel === window.selectedStrokeInEditMode) {
        //                 console.log(`Canvas Mousedown: Clicked on control point ${controlPointAtClick.pointIndex} of stroke ${controlPointAtClick.strokeLabel} (IN EDIT MODE)`);
                
        // Start dragging the control point or arrow endpoint
        isDraggingControlPoint = true;
                
        if (controlPointAtClick.type === 'arrow') {
          // For arrow endpoints, store initial position differently
          const vectorData = vectorStrokesByImage[currentImageLabel][controlPointAtClick.strokeLabel];
          const isStart = controlPointAtClick.pointIndex === 'start';
          const pointIndex = isStart ? 0 : vectorData.points.length - 1;
                    
          draggedControlPointInfo = {
            strokeLabel: controlPointAtClick.strokeLabel,
            pointIndex: controlPointAtClick.pointIndex,
            arrayIndex: pointIndex,
            startCanvasX: e.offsetX,
            startCanvasY: e.offsetY,
            startImageCoords: { ...vectorData.points[pointIndex] },
            type: 'arrow'
          };
        } else if (controlPointAtClick.type === 'straight') {
          // For straight line endpoints
          const vectorData = vectorStrokesByImage[currentImageLabel][controlPointAtClick.strokeLabel];
          const isStart = controlPointAtClick.pointIndex === 'start';
          const pointIndex = isStart ? 0 : vectorData.points.length - 1;
                    
          draggedControlPointInfo = {
            strokeLabel: controlPointAtClick.strokeLabel,
            pointIndex: controlPointAtClick.pointIndex,
            arrayIndex: pointIndex,
            startCanvasX: e.offsetX,
            startCanvasY: e.offsetY,
            startImageCoords: { ...vectorData.points[pointIndex] },
            type: 'straight'
          };
        } else if (controlPointAtClick.type === 'curved') {
          // For curved line control points - FIXED: use the unified system
          const vectorData = vectorStrokesByImage[currentImageLabel][controlPointAtClick.strokeLabel];
          draggedControlPointInfo = {
            strokeLabel: controlPointAtClick.strokeLabel,
            pointIndex: controlPointAtClick.pointIndex,
            startCanvasX: e.offsetX,
            startCanvasY: e.offsetY,
            startImageCoords: { ...vectorData.controlPoints[controlPointAtClick.pointIndex] },
            type: 'curved'
          };
                    
          // CRITICAL FIX: Also set the old curved line variables for compatibility
          draggingAnchor = true;
          dragCurveStroke = controlPointAtClick.strokeLabel;
          dragAnchorIndex = controlPointAtClick.pointIndex;
        }
                
        canvas.style.cursor = 'grabbing';
        e.preventDefault();
        return;
      }
    }

    // Second, check if we're clicking on a label - use same coordinate transformation as main click detection
    const hoveredLabel = findLabelAtPoint(canvasFromImage.x, canvasFromImage.y);
    window.lastClickedCanvasLabel = hoveredLabel ? hoveredLabel.strokeLabel : null;

    if (hoveredLabel) {
      // This is a single click on a label, not a double click (double click is handled above and returns)
      const currentlyHoveredStroke = hoveredLabel.strokeLabel;
      //             console.log(`Canvas Mousedown: Single click on canvas label: ${currentlyHoveredStroke}.`);
      //             console.log(`Canvas Mousedown: Selection BEFORE update for ${window.currentImageLabel}:`, window.multipleSelectedStrokesByImage[window.currentImageLabel] ? JSON.parse(JSON.stringify(window.multipleSelectedStrokesByImage[window.currentImageLabel])) : 'undefined');

      // Clear curved line preview state if we're selecting a label while in curved mode
      if (drawingMode === 'curved' && curvedLinePoints.length > 0) {
        //                 console.log('Canvas Mousedown: Clearing curved line preview state due to label selection');
        curvedLinePoints = [];
        // Redraw to clear any lingering preview
        if (typeof window.redrawCanvasWithVisibility === 'function') {
          window.redrawCanvasWithVisibility();
        }
      }

      if (window.selectedStrokeByImage && window.multipleSelectedStrokesByImage) {
        // Ensure the array for the current image exists
        if (!window.multipleSelectedStrokesByImage[window.currentImageLabel]) {
          window.multipleSelectedStrokesByImage[window.currentImageLabel] = [];
        }

        // Explicitly clear the existing selection for the current image to ensure exclusivity
        window.multipleSelectedStrokesByImage[window.currentImageLabel] = []; 
                
        // Add only the newly clicked stroke
        window.multipleSelectedStrokesByImage[window.currentImageLabel].push(currentlyHoveredStroke);
                
        // Update the primary selected stroke variable
        window.selectedStrokeByImage[window.currentImageLabel] = currentlyHoveredStroke;

        //                 console.log(`Canvas Mousedown: Selection AFTER update for ${window.currentImageLabel}:`, JSON.parse(JSON.stringify(window.multipleSelectedStrokesByImage[window.currentImageLabel])));
        //                 console.log(`Canvas Mousedown: Focused/Selected stroke is now ${currentlyHoveredStroke}`);

        // If NOT already in edit mode for this stroke, do not enter it on single click.
        // Only select it. Edit mode for canvas labels will be via double-click (handled above).
        if (window.selectedStrokeInEditMode === currentlyHoveredStroke) {
          // If it was already in edit mode, clicking it again (single) might keep it or exit.
          // For now, let's say a single click on an already-in-edit-mode label keeps it selected.
        } else {
          window.selectedStrokeInEditMode = null; // Ensure single click on a label does not *enter* edit mode for other strokes
        }

        if (typeof window.redrawCanvasWithVisibility === 'function') {
          window.redrawCanvasWithVisibility();
        }
        if (typeof window.updateStrokeVisibilityControls === 'function') {
          window.updateStrokeVisibilityControls();
                    
          // CRITICAL FIX: After canvas label click, explicitly focus the measurement input
          // This ensures measurement editing works on all images, not just the first
          setTimeout(() => {
            const measurementInput = document.querySelector(`.stroke-visibility-item[data-stroke="${currentlyHoveredStroke}"] .stroke-measurement`);
            if (measurementInput && measurementInput.contentEditable === 'true') {
              measurementInput.focus();
              // Select all text for easy editing
              const selection = window.getSelection();
              if (selection) {
                const range = document.createRange();
                range.selectNodeContents(measurementInput);
                selection.removeAllRanges();
                selection.addRange(range);
              }
            }
          }, 100); // Small delay to ensure DOM is updated
        }
        if (typeof updateSelectionActionsPanel === 'function') updateSelectionActionsPanel();
      }
            
      // Then, allow label dragging to proceed
      isDraggingLabel = true;
      draggedLabelStroke = hoveredLabel.strokeLabel; // Store just the stroke label string
      dragStartX = e.offsetX;
      dragStartY = e.offsetY;
      canvas.style.cursor = 'grabbing'; // Cursor for dragging
      e.preventDefault(); // Prevent drawing from starting if a label is clicked
      return; // Important to return after handling label click + potential drag start
    }
        
    // Check if we clicked directly on a stroke (not a label)
    if (!hoveredLabel) {
      const strokeAtPoint = checkForStrokeAtPoint(e.offsetX, e.offsetY);
      if (strokeAtPoint) {
        //                 console.log(`Canvas Mousedown: Clicked on stroke ${strokeAtPoint.label} (type: ${strokeAtPoint.type})`);
                
        // Only clear curved line preview state if we're not actively building a curve
        // This allows curved lines to connect to existing strokes
        if (drawingMode === 'curved' && curvedLinePoints.length > 0) {
          //                     console.log('Canvas Mousedown: Preserving curved line state for potential stroke connection');
          // Don't clear curvedLinePoints - let the curved line logic handle stroke snapping
        } else if (drawingMode === 'curved') {
          //                     console.log('Canvas Mousedown: Clearing curved line preview state due to stroke selection');
          curvedLinePoints = [];
          // Redraw to clear any lingering preview
          if (typeof window.redrawCanvasWithVisibility === 'function') {
            window.redrawCanvasWithVisibility();
          }
        }
                
        // Only update selection if NOT in drawing mode AND not actively creating a curved line
        if (!isDrawing && !strokeInProgress && !(drawingMode === 'curved' && curvedLinePoints.length > 0)) {
          if (window.selectedStrokeByImage && window.multipleSelectedStrokesByImage) {
            // Clear existing selection for this image
            if (!window.multipleSelectedStrokesByImage[window.currentImageLabel]) {
              window.multipleSelectedStrokesByImage[window.currentImageLabel] = [];
            }
            window.multipleSelectedStrokesByImage[window.currentImageLabel] = [strokeAtPoint.label];
            window.selectedStrokeByImage[window.currentImageLabel] = strokeAtPoint.label;
            //                         console.log(`Canvas Mousedown: Selected stroke ${strokeAtPoint.label} by clicking on it`);
            // Update UI
            if (typeof window.redrawCanvasWithVisibility === 'function') {
              window.redrawCanvasWithVisibility();
            }
            if (typeof window.updateStrokeVisibilityControls === 'function') {
              window.updateStrokeVisibilityControls();
            }
            if (typeof updateSelectionActionsPanel === 'function') {
              updateSelectionActionsPanel();
            }
          }
        } else {
          // In drawing mode or curved line creation: do NOT update selection, just allow drawing to start from this point
          //                     console.log(`Canvas Mousedown: Drawing mode active or curved line in progress, not updating selection. Allowing drawing to start from stroke ${strokeAtPoint.label}`);
        }
        // IMPORTANT: Allow drawing to start from this stroke
        // Only prevent drawing if we're in edit mode for THIS specific stroke
        if (window.selectedStrokeInEditMode === strokeAtPoint.label) {
          //                     console.log(`Canvas Mousedown: Preventing drawing - stroke ${strokeAtPoint.label} is in edit mode`);
          e.preventDefault();
          return;
        }
        // If not in edit mode, fall through to allow drawing to start
      }
    }
        
    // If edit mode is active AND the click was NOT on the label of the stroke in edit mode, clear edit mode.
    // CRITICAL FIX: Do NOT exit edit mode during shift+click panning
    if (window.selectedStrokeInEditMode && !isShiftPressed && (!hoveredLabel || window.selectedStrokeInEditMode !== hoveredLabel.strokeLabel)) { 
      const prevEditStrokeLabel = window.selectedStrokeInEditMode;
      window.selectedStrokeInEditMode = null;
      // Optionally clear selection too, or just exit edit mode
      // window.multipleSelectedStrokesByImage[window.currentImageLabel] = [];
      // window.selectedStrokeByImage[window.currentImageLabel] = null;
            
      hideSelectionActionsPanel(); 
      if (typeof window.redrawCanvasWithVisibility === 'function') window.redrawCanvasWithVisibility();
      if (typeof window.updateStrokeVisibilityControls === 'function') window.updateStrokeVisibilityControls();
      //             console.log(`Canvas Mousedown: Clicked outside, exited edit mode for stroke: ${prevEditStrokeLabel}`);
            
      // CRITICAL FIX: Prevent drawing from starting when exiting edit mode
      e.preventDefault();
      return;
    }

    // Allow drawing even if clicking on an existing stroke (unlike before where we would select the stroke)
    // Prepare the vector stroke object
    if (!vectorStrokesByImage[currentImageLabel]) {
      vectorStrokesByImage[currentImageLabel] = {};
    }

    // Note: Double-click detection for curved line finalization is now handled above in the general double-click logic
    
    // CURVE_DEFOCUS_FIX_GUARD: Add a definitive check before starting any drawing logic
    // If curveJustCompleted was true at the start of this mousedown, it should have been handled and cleared
    // but we add this as an extra safety check
    if (curveJustCompleted) {
      //             console.log('Canvas Mousedown: CURVE_DEFOCUS_FIX_GUARD - curveJustCompleted is STILL true, this should not happen. Aborting drawing.');
      return;
    }
        
    console.log('[DRAW CHECK] Pre-checks - drawingMode:', drawingMode, 'isClickOnTextElement:', isClickOnTextElement);
        
    // Check for text element clicks FIRST, before any drawing mode logic
    if (isClickOnTextElement) {
      // Clicked on existing text element - set up drag regardless of mode
      const now = Date.now();
      const last = window.lastTextClickTime || 0;

      if (window.lastClickedTextElementId === clickedTextElement.element.id && (now - last) <= window.paintApp.config.clickDelay) {
        debugLog('[TEXT]', 'double-click detected', clickedTextElement.element.id);
        openTextEditor(clickedTextElement.element);
        window.lastTextClickTime = 0;
        window.lastClickedTextElementId = null;
        e.preventDefault();
        return;
      }
                
      debugLog('[TEXT]', 'click detected; pending drag setup for element', clickedTextElement.element.id);
      updateCursor('grab', 'text click - pending drag');

      textDragPending = true;
      textDragPendingElement = clickedTextElement;
      textDragStartCanvasX = coords.canvas.x;
      textDragStartCanvasY = coords.canvas.y;
      dragStartTextX = clickedTextElement.element.x;
      dragStartTextY = clickedTextElement.element.y;

      window.lastTextClickTime = now;
      window.lastClickedTextElementId = clickedTextElement.element.id;
            
      e.preventDefault();
      return;
    } else if (drawingMode === 'text') {
      // For text mode, create a text box at the click position
      console.log('[TEXT MODE] About to call createTextBox at:', coords.canvas.x, coords.canvas.y);
      console.log('[TEXT MODE] createTextBox function exists?', typeof createTextBox);
      createTextBox(coords.canvas.x, coords.canvas.y);
      console.log('[TEXT MODE] createTextBox called');
            
      // Mode will be restored when text box is committed or cancelled
      return; // Don't proceed with drawing logic
    }
        
    // NOW proceed with drawing mode logic - initialize drawing state
    console.log('[DRAW CHECK] Proceeding to drawing mode logic - drawingMode:', drawingMode);
    
    // Handle drawing (default when Shift is not pressed)
    // Save the state before starting a new stroke
    if (!strokeInProgress) {
      const currentState = getCanvasState();
      currentStroke = cloneImageData(currentState);
      // Save the state before we start drawing
      undoStackByImage[currentImageLabel].push({
        state: cloneImageData(currentState),
        type: 'pre-stroke',
        label: null
      });
    }
        
    // Check if this is a blank canvas and prevent drawing outside canvas boundaries
    const dims = window.originalImageDimensions ? window.originalImageDimensions[currentImageLabel] : undefined;
    const isBlankCanvas = !window.originalImages || !window.originalImages[currentImageLabel] || 
                             (dims && dims.width === canvas.width && dims.height === canvas.height);
        
    if (isBlankCanvas) {
      // Constrain drawing to canvas boundaries
      if (e.offsetX < 0 || e.offsetX >= canvas.width || e.offsetY < 0 || e.offsetY >= canvas.height) {
        console.log(`[Input] Drawing prevented outside canvas bounds: (${e.offsetX}, ${e.offsetY}) not in 0-${canvas.width-1} x 0-${canvas.height-1}`);
        return;
      }
    }
        
    // Start drawing
    isDrawing = true;
    isDrawingOrPasting = true;
    strokeInProgress = true;
    points = [];
    lastVelocity = 0;
        
    // Reset dash offset for continuous freehand dash patterns
    window.paintApp.uiState.dashOffset = 0;
    lastDrawnPoint = null;
    [lastX, lastY] = [coords.canvas.x, coords.canvas.y];
        
    // Store mousedown position for click vs drag detection
    mouseDownPosition = { x: coords.canvas.x, y: coords.canvas.y };
        
    // --- FIX: Clear temporary drawing data --- 
    const tempStrokeKey = '_drawingStroke';
    if (vectorStrokesByImage[currentImageLabel] && vectorStrokesByImage[currentImageLabel][tempStrokeKey]) {
      delete vectorStrokesByImage[currentImageLabel][tempStrokeKey];
      //             console.log("Cleared temporary drawing data for key:", tempStrokeKey);
    }
    // --- END FIX ---
        
    if (drawingMode === 'straight') {
      // For straight line (now using arrow line implementation), store the start point
      straightLineStart = { x: coords.canvas.x, y: coords.canvas.y };
    } else if (drawingMode === 'curved') {
      // For curved line, collect control points
      const { x: imgX, y: imgY } = coords.world;
      const controlPoint = {
        x: imgX,                    // World space X
        y: imgY,                    // World space Y
        canvasX: coords.canvas.x,   // Canvas space X
        canvasY: coords.canvas.y,   // Canvas space Y
        time: Date.now()
      };
      curvedLinePoints.push(controlPoint);
      //             console.log(`Added control point ${curvedLinePoints.length} at (${e.offsetX}, ${e.offsetY})`);
            
      // Draw a visual indicator for the control point
      ctx.beginPath();
      const scale = window.imageScaleByLabel[currentImageLabel] || 1.0;
      const pointRadius = 4 * scale;
      ctx.arc(e.offsetX, e.offsetY, pointRadius, 0, Math.PI * 2);
      ctx.fillStyle = colorPicker.value;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
            
      // Prevent normal drawing mode from activating
      isDrawing = false;
      isDrawingOrPasting = false;
      strokeInProgress = false;
    } else {
      // GUARD: Don't start drawing if text is being dragged or drag is pending
      if (textDragPending || isDraggingTextElement) {
        console.log('[DRAW GUARD] Blocking draw - text drag in progress');
        return;
      }
            
      // For freehand, add first point
      const { x: imgX, y: imgY } = getTransformedCoords(e.offsetX, e.offsetY);
      const firstPoint = {
        x: imgX,             // Image space X
        y: imgY,             // Image space Y
        canvasX: e.offsetX,  // Canvas space X
        canvasY: e.offsetY,  // Canvas space Y
        time: Date.now()
      };
      points.push(firstPoint);
        
      // Draw a dot at the start point (important for single clicks)
      ctx.beginPath();
      const scale = window.imageScaleByLabel[currentImageLabel] || 1.0;
      const dotRadius = parseInt(brushSize.value) * scale / 2;
      ctx.arc(e.offsetX, e.offsetY, dotRadius, 0, Math.PI * 2);
      ctx.fillStyle = colorPicker.value;
      ctx.fill();
            
      isDrawing = true;
      isDrawingOrPasting = true;
    }
  }
    
  // PERFORMANCE: Throttled mousemove event handler using requestAnimationFrame
  function onCanvasMouseMove(e) {
    const coords = window.getPointerCoords(e);
    const x = coords.canvas.x;
    const y = coords.canvas.y;

    // PERFORMANCE: Throttle mousemove events using requestAnimationFrame
    if (!mouseMoveThrottled) {
      mouseMoveThrottled = true;
      requestAnimationFrame(() => {
        mouseMoveThrottled = false;
                
        // Handle curved line anchor dragging (LEGACY SYSTEM - FIXED)
        if (draggingAnchor && dragCurveStroke && dragAnchorIndex >= 0) {
          const vectorData = vectorStrokesByImage[currentImageLabel][dragCurveStroke];
          if (vectorData && vectorData.controlPoints && vectorData.controlPoints[dragAnchorIndex]) {
            const controlPoint = vectorData.controlPoints[dragAnchorIndex];
                        
            // Update the control point position in world space - this is the source of truth
            const { x: imgX, y: imgY } = coords.world;
            controlPoint.x = imgX;
            controlPoint.y = imgY;
                        
            // Regenerate curve if we have the function
            if (typeof generateCatmullRomSpline === 'function') {
              const refreshedControlPoints = refreshControlPointCanvasCoords(vectorData.controlPoints);
              const newSplinePoints = generateCatmullRomSpline(refreshedControlPoints, 50);
                            
              // CRITICAL FIX: Convert spline canvas coordinates to world coordinates for storage
              vectorData.points = newSplinePoints.map(splinePoint => {
                const worldCoords = window.clientToWorld(splinePoint.x, splinePoint.y);
                return {
                  x: worldCoords.x,  // World coordinate
                  y: worldCoords.y,  // World coordinate
                  time: Date.now()
                };
              });
            }
                        
            // Redraw the canvas
            redrawCanvasWithVisibility();
            // PERFORMANCE: Invalidate cache after control point drag
            invalidateInteractiveElementCache();
          }
          return;
        }
                
        // Handle text element drag activation and dragging
        if (textDragPending && textDragPendingElement) {
          const dxCanvas = x - textDragStartCanvasX;
          const dyCanvas = y - textDragStartCanvasY;
          const dragDist = Math.hypot(dxCanvas, dyCanvas);

          if (dragDist >= TEXT_DRAG_THRESHOLD) {
            isDraggingTextElement = true;
            draggedTextElement = textDragPendingElement;
            dragStartX = textDragStartCanvasX;
            dragStartY = textDragStartCanvasY;
            dragStartTextX = draggedTextElement.element.x;
            dragStartTextY = draggedTextElement.element.y;

            textDragPending = false;
            textDragPendingElement = null;
            updateCursor('grabbing', 'text drag activated');
            debugLog('[TEXT]', 'drag activated', { id: draggedTextElement.element.id, distance: dragDist.toFixed(2) });
          }
        }

        if (isDraggingTextElement && draggedTextElement) {
          // For new text elements (useCanvasCoords), work directly in canvas space
          // For old text elements, convert to world coordinates
          if (draggedTextElement.element.useCanvasCoords) {
            // Direct canvas coordinate dragging (new system)
            const dxCanvas = x - dragStartX;
            const dyCanvas = y - dragStartY;
                        
            draggedTextElement.element.x = dragStartTextX + dxCanvas;
            draggedTextElement.element.y = dragStartTextY + dyCanvas;
                        
            debugLog('[TEXT]', 'dragging (canvas coords)', { 
              id: draggedTextElement.element.id, 
              dx: dxCanvas.toFixed(2), 
              dy: dyCanvas.toFixed(2) 
            });
          } else {
            // World coordinate dragging (old system, for backwards compatibility)
            const worldCurrent = window.clientToWorld ? window.clientToWorld(x, y) : { x, y };
            const worldStart = window.clientToWorld ? window.clientToWorld(dragStartX, dragStartY) : { x: dragStartX, y: dragStartY };
                        
            // Calculate delta in world coordinates
            const dxWorld = worldCurrent.x - worldStart.x;
            const dyWorld = worldCurrent.y - worldStart.y;
                        
            // Apply the delta to the original text position
            draggedTextElement.element.x = dragStartTextX + dxWorld;
            draggedTextElement.element.y = dragStartTextY + dyWorld;
                        
            debugLog('[TEXT]', 'dragging (world coords)', { 
              id: draggedTextElement.element.id, 
              dx: dxWorld.toFixed(2), 
              dy: dyWorld.toFixed(2) 
            });
          }
                    
          redrawCanvasWithVisibility();
          return;
        }

        // PERFORMANCE: Use optimized hover detection
        handleMouseMoveThrottled(x, y);
      });
    }
        
    // Handle control point dragging
    if (isDraggingControlPoint && draggedControlPointInfo) {
      const deltaX = coords.canvas.x - draggedControlPointInfo.startCanvasX;
      const deltaY = coords.canvas.y - draggedControlPointInfo.startCanvasY;
            
      // Convert delta to world space using new coordinate system
      const worldDelta = window.clientToWorld(deltaX, deltaY);
      const worldOrigin = window.clientToWorld(0, 0);
      const deltaImageX = worldDelta.x - worldOrigin.x;
      const deltaImageY = worldDelta.y - worldOrigin.y;
            
      const vectorData = vectorStrokesByImage[currentImageLabel][draggedControlPointInfo.strokeLabel];
            
      if (draggedControlPointInfo.type === 'arrow' && vectorData) {
        // Handle arrow endpoint dragging
        const endpointIndex = draggedControlPointInfo.arrayIndex;
        const endpoint = vectorData.points[endpointIndex];
                
        // Update endpoint position
        endpoint.x = draggedControlPointInfo.startImageCoords.x + deltaImageX;
        endpoint.y = draggedControlPointInfo.startImageCoords.y + deltaImageY;
                
        //                 console.log(`Updated arrow endpoint ${draggedControlPointInfo.pointIndex} to image:(${endpoint.x.toFixed(1)}, ${endpoint.y.toFixed(1)})`);
                
        // Redraw immediately to show the updated arrow
        redrawCanvasWithVisibility();
      } else if (draggedControlPointInfo.type === 'straight' && vectorData) {
        // Handle straight line endpoint dragging
        const endpointIndex = draggedControlPointInfo.arrayIndex;
        const endpoint = vectorData.points[endpointIndex];
                
        // Update endpoint position
        endpoint.x = draggedControlPointInfo.startImageCoords.x + deltaImageX;
        endpoint.y = draggedControlPointInfo.startImageCoords.y + deltaImageY;
                
        //                 console.log(`Updated straight line endpoint ${draggedControlPointInfo.pointIndex} to image:(${endpoint.x.toFixed(1)}, ${endpoint.y.toFixed(1)})`);
                
        // Redraw immediately to show the updated line
        redrawCanvasWithVisibility();
      } else if ((draggedControlPointInfo.type === 'curved' || draggedControlPointInfo.type === 'curved-arrow') && vectorData && vectorData.controlPoints) {
        // Handle curved line control point dragging
        const controlPoint = vectorData.controlPoints[draggedControlPointInfo.pointIndex];
                
        // Update image space coordinates - this is the source of truth
        controlPoint.x = draggedControlPointInfo.startImageCoords.x + deltaImageX;
        controlPoint.y = draggedControlPointInfo.startImageCoords.y + deltaImageY;
                
        // Note: No longer storing canvas coordinates as they become stale after pan/scale
                
        // Regenerate the curved line with updated control points
        const refreshedControlPoints = refreshControlPointCanvasCoords(vectorData.controlPoints);
        const newSplinePoints = generateCatmullRomSpline(refreshedControlPoints, 50);
                
        // CRITICAL FIX: Convert spline canvas coordinates to world coordinates for storage
        vectorData.points = newSplinePoints.map(splinePoint => {
          const worldCoords = window.clientToWorld(splinePoint.x, splinePoint.y);
          return {
            x: worldCoords.x,  // World coordinate
            y: worldCoords.y,  // World coordinate
            time: Date.now()
          };
        });
                
        //                 console.log(`Updated control point ${draggedControlPointInfo.pointIndex} to image:(${controlPoint.x.toFixed(1)}, ${controlPoint.y.toFixed(1)})`);
                
        // Redraw immediately to show the updated curve
        redrawCanvasWithVisibility();
      }
      return;
    }
        
    // Handle label dragging
    if (isDraggingLabel) {
      const currentX = e.offsetX;
      const currentY = e.offsetY;

      // Convert both start and current positions from canvas space to image space
      // This ensures correct coordinate transformation accounting for rotation, scale, and translation
      const startImageCoords = getTransformedCoords(dragStartX, dragStartY);
      const currentImageCoords = getTransformedCoords(currentX, currentY);
      
      // Compute delta in image space (this is what we'll add to the offset)
      const deltaImageX = currentImageCoords.x - startImageCoords.x;
      const deltaImageY = currentImageCoords.y - startImageCoords.y;
            
      // console.log(`[DRAG] Label drag - img delta: (${deltaImageX.toFixed(2)}, ${deltaImageY.toFixed(2)}) for stroke: ${draggedLabelStroke}`);
            
      // Update start position for next move event
      dragStartX = currentX;
      dragStartY = currentY;
            
      // Ensure customLabelPositions structure exists
      if (!window.customLabelPositions[window.currentImageLabel]) window.customLabelPositions[window.currentImageLabel] = {};
            
      // Get the anchor point for the dragged label's stroke (current canvas coords)
      const strokeName = draggedLabelStroke; // Use the stroke label string directly
      const vectorData = window.vectorStrokesByImage[window.currentImageLabel]?.[strokeName];

      if (vectorData && vectorData.points.length > 0) {
        // Use robust anchor computation for dragging as well, so custom offsets stay relative to true center
        const midPointRelative = getStrokeAnchorPoint(strokeName, window.currentImageLabel);
        const anchorPoint = getCanvasCoords(midPointRelative.x, midPointRelative.y);
                
        console.log('[DRAG] Stroke points:', vectorData.points.length, 'midPoint:', midPointRelative, 'anchor:', anchorPoint);

        // Get the current offset (custom or calculated) or calculate if first time dragging
        let currentOffsetRaw = window.customLabelPositions[window.currentImageLabel][strokeName] || 
                                    window.calculatedLabelOffsets[window.currentImageLabel]?.[strokeName];

        // Convert to pixels if normalized
        let currentOffset;
        if (!currentOffsetRaw) {
          // Calculate initial offset based on current drawn position if neither exists (convert to image space)
          const currentLabelRect = currentLabelPositions.find(l => l.strokeLabel === strokeName);
          if (currentLabelRect) {
            const currentLabelCenterImg = getTransformedCoords(currentLabelRect.x, currentLabelRect.y);
            currentOffset = {
              x: currentLabelCenterImg.x - midPointRelative.x,
              y: currentLabelCenterImg.y - midPointRelative.y
            };
          } else {
            // Fallback if label wasn't found in current positions (shouldn't happen)
            currentOffset = { x: 0, y: 0 }; 
            console.warn(`Could not find current rect for ${strokeName} during drag start.`);
          }
        } else {
          // Convert normalized offset to pixels, or clone if already in pixel format
          const pixelOffset = normalizeToPixels(currentOffsetRaw, window.currentImageLabel);
          if (pixelOffset && (pixelOffset.x !== 0 || pixelOffset.y !== 0)) {
            currentOffset = { x: pixelOffset.x, y: pixelOffset.y };
          } else if (currentOffsetRaw && typeof currentOffsetRaw.x === 'number' && typeof currentOffsetRaw.y === 'number') {
            // Use raw pixel offset if normalization failed but we have pixel values
            currentOffset = { x: currentOffsetRaw.x, y: currentOffsetRaw.y };
          } else {
            // Fallback to zero offset
            currentOffset = { x: 0, y: 0 };
          }
          console.log(`[DRAG] Converted offset for ${strokeName}:`, currentOffsetRaw, '->', currentOffset);
        }

        // Apply image-space delta for consistent dragging
        currentOffset.x += deltaImageX;
        currentOffset.y += deltaImageY;
                
        console.log(`[DRAG] New image-space offset for ${strokeName}: (${currentOffset.x.toFixed(1)}, ${currentOffset.y.toFixed(1)})`);
                
        // During drag operations, store the pixel offset directly to avoid normalization issues
        // We'll store the raw pixel offset which should work consistently
        const offsetToStore = { x: currentOffset.x, y: currentOffset.y };
                
        // Store the pixel offset directly (don't normalize during drag)
        window.customLabelPositions[window.currentImageLabel][strokeName] = offsetToStore;
        // Additionally store absolute tag center in image space to avoid re-centering to stroke midpoint
        if (!window.customLabelAbsolutePositions[window.currentImageLabel]) window.customLabelAbsolutePositions[window.currentImageLabel] = {};
        window.customLabelAbsolutePositions[window.currentImageLabel][strokeName] = {
          x: midPointRelative.x + currentOffset.x,
          y: midPointRelative.y + currentOffset.y
        };
                
        // Redraw with the new position
        redrawCanvasWithVisibility();
      }
      return; // Return early as we handled label dragging
    }
        
    if (isDraggingImage) {
      // Calculate the distance moved
      const deltaX = e.offsetX - lastMouseX;
      const deltaY = e.offsetY - lastMouseY;
            
      // Update last positions
      lastMouseX = e.offsetX;
      lastMouseY = e.offsetY;
            
      // Move the image
      moveImage(deltaX, deltaY);
      return;
    }
        
    // Handle drawing based on mode
    if (isDrawing) {
      if (drawingMode === 'straight') {
        // For straight line (using arrow line implementation), draw a preview with optional arrowheads
        if (straightLineStart) {
          const endPoint = { x: e.offsetX, y: e.offsetY };
          drawArrowLinePreview(straightLineStart, endPoint);
        }
      } else {
        // Normal freehand drawing
        draw(e);
      }
    }
        
    // Handle curved line preview when not actively drawing but have control points
    if (!isDrawing && !isDraggingImage && !isDraggingLabel && drawingMode === 'curved' && curvedLinePoints.length > 0) {
      const mousePos = { x: e.offsetX, y: e.offsetY };
      drawCurvedLinePreview(curvedLinePoints, mousePos);
    }
  }
    
  function onCanvasMouseUp(e) {
    // Check if this is a right-click (button 2) - don't process in mouseup
    if (e.button === 2) {
      e.preventDefault();
      e.stopPropagation();
      return; // Don't process right-clicks in mouseup
    }
        
    // Check if we were drawing when mouseup occurred
    const wasDrawing = isDrawing;
        
    // Handle curved line anchor dragging cleanup
    if (draggingAnchor) {
      draggingAnchor = false;
      if (dragCurveStroke) {
        //                 console.log(`Finished dragging anchor ${dragAnchorIndex} of curve ${dragCurveStroke}`);
        // Save state for undo/redo
        saveState(true, false); // Save without incrementing label
      }
      dragCurveStroke = null;
      dragAnchorIndex = -1;
            
      // CRITICAL FIX: Restore cursor intelligently based on current mouse position
      restoreCursorAfterDrag(e.offsetX, e.offsetY);
      return;
    }
        
    if (isDraggingControlPoint) {
      isDraggingControlPoint = false;
            
      // Save state to enable undo/redo
      if (draggedControlPointInfo) {
        saveState(true, false); // Save without incrementing label
        //                 console.log(`Finished dragging control point ${draggedControlPointInfo.pointIndex} of stroke ${draggedControlPointInfo.strokeLabel}`);
      }
            
      draggedControlPointInfo = null;
            
      // CRITICAL FIX: Restore cursor intelligently based on current mouse position
      restoreCursorAfterDrag(e.offsetX, e.offsetY);
      return;
    }
        
    if (isDraggingLabel) {
      isDraggingLabel = false;
      draggedLabelStroke = null;
            
      // Save state to enable undo/redo for label position changes
      saveState(true, false); // Save without incrementing label
            
      // IMPROVED: Restore cursor intelligently based on current mouse position
      restoreCursorAfterDrag(e.offsetX, e.offsetY);
      return;
    }
        
    // Handle text element dragging cleanup
    if (isDraggingTextElement) {
      const finishedElementId = draggedTextElement?.element?.id;
      isDraggingTextElement = false;
      draggedTextElement = null;
      textDragPending = false;
      textDragPendingElement = null;
            
      // Note: Text elements are managed separately; no canvas state save needed
      // saveState(true, false);  // REMOVED: Was creating phantom stroke entries
      restoreCursorAfterDrag(e.offsetX, e.offsetY);
      debugLog('[TEXT]', 'drag finished', finishedElementId);
      return;
    }

    if (textDragPending && textDragPendingElement) {
      const pendingElement = textDragPendingElement;
      textDragPending = false;
      textDragPendingElement = null;

      debugLog('[TEXT]', 'click without drag, opening editor', pendingElement.element.id);
      openTextEditor(pendingElement.element);
      e.preventDefault();
      return;
    }
        
    if (isDraggingImage) {
      isDraggingImage = false;
      canvas.style.cursor = isShiftPressed ? 'grab' : 'crosshair';
            
      // Deselect all strokes when shift-drag ends
      //             console.log('Shift-drag canvas completed - deselecting all strokes');
      deselectAllStrokes();
            
      return;
    }
        
    if (isDrawing) {
      let strokeWasCreated = false;
            
      // For straight line, finalize the line
      if (drawingMode === 'straight' && straightLineStart) {
        // Use new coordinate system
        const coords = window.getPointerCoords(e);
        const endPoint = { x: coords.canvas.x, y: coords.canvas.y };
                
        // Calculate movement distance from mousedown
        const dragDistance = mouseDownPosition ? 
          Math.sqrt(Math.pow(endPoint.x - mouseDownPosition.x, 2) + Math.pow(endPoint.y - mouseDownPosition.y, 2)) : 0;

        // Only save the line if user actually dragged (not just clicked)
        if (dragDistance > MINIMUM_DRAG_DISTANCE) {
          strokeWasCreated = true;

          // Check if end point is on another stroke - but don't stop drawing
          const endPointStrokeData = checkForStrokeAtPoint(endPoint.x, endPoint.y);

          // --- MODIFIED: Store vector data temporarily ---
          const tempStrokeKey = '_drawingStroke';
          const strokeColor = colorPicker.value;
          const strokeWidth = parseInt(brushSize.value);

          // Initialize if needed
          if (!vectorStrokesByImage[currentImageLabel]) {
            vectorStrokesByImage[currentImageLabel] = {};
          }

          // Get world coordinates for both start and end points
          const startWorldCoords = window.clientToWorld(straightLineStart.x, straightLineStart.y);
          const endWorldCoords = coords.world;

          //                     console.log(`Straight line from canvas (${straightLineStart.x}, ${straightLineStart.y}) -> image (${startTransformed.x}, ${startTransformed.y})`);
          //                     console.log(`Straight line to canvas (${endPoint.x}, ${endPoint.y}) -> image (${endTransformed.x}, ${endTransformed.y})`);

          // Create a vector representation under the temporary key
          vectorStrokesByImage[currentImageLabel][tempStrokeKey] = {
            points: [
              { x: startWorldCoords.x, y: startWorldCoords.y },
              { x: endWorldCoords.x, y: endWorldCoords.y }
            ],
            color: strokeColor,
            width: strokeWidth,
            type: 'straight',
            arrowSettings: { ...arrowSettings }, // Store arrow settings (unified with arrow line)
            dashSettings: { ...dashSettings } // Store dash settings for dotted lines
          };
          //                     console.log(`Stored straight line data temporarily under ${tempStrokeKey}`);
          // --- END MODIFICATION ---

          // Draw the final line
          drawStraightLinePreview(straightLineStart, endPoint);

          // If end point overlaps with another line, draw a glowing circle
          if (endPointStrokeData) {
            const scale = window.imageScaleByLabel[currentImageLabel] || 1.0;
            const baseRadius = parseInt(brushSize.value) / 2;
            const scaledRadius = baseRadius * scale;
            const glowPadding = 5; // Keep glow padding fixed

            ctx.beginPath();
            // Use scaled radius + fixed padding for glow circle
            ctx.arc(endPoint.x, endPoint.y, scaledRadius + glowPadding, 0, Math.PI * 2);

            // Create a white glow effect with a radial gradient using scaled radii
            const gradient = ctx.createRadialGradient(
              endPoint.x, endPoint.y, scaledRadius / 2, // Inner radius (scaled)
              endPoint.x, endPoint.y, scaledRadius + glowPadding // Outer radius (scaled + padding)
            );
            gradient.addColorStop(0, 'white');
            gradient.addColorStop(0.7, 'rgba(255, 255, 255, 0.8)');
            gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

            ctx.fillStyle = gradient;
            ctx.fill();

            // Then draw the colored dot for the actual end point
            ctx.beginPath();
            ctx.arc(endPoint.x, endPoint.y, scaledRadius, 0, Math.PI * 2);
            ctx.fillStyle = strokeColor;
            ctx.fill();
          }
                    
          // Save state after straight line completion
          saveState(true, true);
                    
          // Update UI
          updateStrokeVisibilityControls();
          redrawCanvasWithVisibility();
        }

        // Reset straight line start
        straightLineStart = null;
      } else if (drawingMode === 'freehand' && points.length > 0) {
        // Handle freehand drawing completion
                
        // Calculate movement distance from mousedown
        const currentPos = { x: e.offsetX, y: e.offsetY };
        const dragDistance = mouseDownPosition ? 
          Math.sqrt(Math.pow(currentPos.x - mouseDownPosition.x, 2) + Math.pow(currentPos.y - mouseDownPosition.y, 2)) : 0;

        // Only save freehand strokes if user actually dragged (not just clicked)
        if (dragDistance > MINIMUM_DRAG_DISTANCE && points.length > 0) {
          strokeWasCreated = true;
                    
          // Check if the last point of the freehand stroke is on another stroke
          if (points.length > 0) {
            const lastPoint = points[points.length - 1];
            // Need canvas coords for check
            const endPointStrokeData = checkForStrokeAtPoint(lastPoint.canvasX, lastPoint.canvasY);

            // If end point overlaps with another line, draw a glowing circle
            if (endPointStrokeData) {
              const scale = window.imageScaleByLabel[currentImageLabel] || 1.0;
              const baseRadius = parseInt(brushSize.value) / 2;
              const scaledRadius = baseRadius * scale;
              const glowPadding = 5; // Keep glow padding fixed

              ctx.beginPath();
              // Use scaled radius + padding for glow circle
              ctx.arc(lastPoint.canvasX, lastPoint.canvasY, scaledRadius + glowPadding, 0, Math.PI * 2);

              // Create a white glow effect with a radial gradient using scaled radii
              const gradient = ctx.createRadialGradient(
                lastPoint.canvasX, lastPoint.canvasY, scaledRadius / 2, // Inner radius (scaled)
                lastPoint.canvasX, lastPoint.canvasY, scaledRadius + glowPadding // Outer radius (scaled + padding)
              );
              gradient.addColorStop(0, 'white');
              gradient.addColorStop(0.7, 'rgba(255, 255, 255, 0.8)');
              gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

              ctx.fillStyle = gradient;
              ctx.fill();

              // Then draw the colored dot for the actual end point
              ctx.beginPath();
              ctx.arc(lastPoint.canvasX, lastPoint.canvasY, scaledRadius, 0, Math.PI * 2);
              ctx.fillStyle = colorPicker.value;
              ctx.fill();
            }
          }
                    
          // Save state after freehand stroke completion
          saveState(true, true);

          // Update the sidebar visibility controls
          updateStrokeVisibilityControls();

          // Force redraw to show labels immediately
          redrawCanvasWithVisibility();
                    
          // The focus will happen automatically in updateStrokeVisibilityControls and createEditableMeasureText
          // because we've set selectedStrokeByImage[currentImageLabel] and window.newlyCreatedStroke in saveState
        }

        // Reset points array for next stroke (always do this)
        points = [];
        lastVelocity = 0;
        lastDrawnPoint = null;
      }

      // If no stroke was created, handle defocus
      // CURVE_DEFOCUS_FIX_5: Only call handleDefocusClick if curveJustCompleted wasn't true
      // (when mousedown was called) because if it was, mousedown already handled the defocus.
      // The curveJustCompleted flag would have been cleared by handleDefocusClick if it was true during mousedown.
      // So, if wasDrawing is true but strokeWasCreated is false, it means it was a click/short drag.
      // If curveJustCompleted is *still* true here, it means something unusual happened,
      // but the primary check in mousedown should cover the intended scenario.
      // We rely on `wasDrawing` to indicate that `mousedown` intended to start a drawing operation.
      if (!strokeWasCreated && wasDrawing) { // Check if it was an attempt to draw that didn't result in a stroke
        //                 console.log('Short click/drag on mouseup, and not a curve defocus handled by mousedown - calling handleDefocusClick() from mouseup');
        handleDefocusClick(); // This will now handle general defocus if curveJustCompleted is false
      }
    }
    
    // Reset drawing state
    isDrawing = false;
    isDrawingOrPasting = false;
    strokeInProgress = false;
    mouseDownPosition = null;
  }
    
  function onCanvasMouseOut() {
    // CRITICAL FIX: Do NOT interrupt control point dragging when mouse leaves canvas
    // Allow the drag to continue until mouseup occurs, enabling dragging outside canvas bounds
    if (isDraggingControlPoint) {
      //             console.log(`Control point dragging continues outside canvas bounds for stroke ${draggedControlPointInfo?.strokeLabel}`);
      // Don't interrupt the drag - let it continue until mouseup
      return;
    }
        
    if (isDraggingLabel) {
      isDraggingLabel = false;
      draggedLabelStroke = null;
      canvas.style.cursor = 'grab';
      return;
    }
        
    if (isDraggingImage) {
      isDraggingImage = false;
      canvas.style.cursor = isShiftPressed ? 'grab' : 'crosshair';
      return;
    }
        
    if (isDrawing) {
      isDrawing = false;
      isDrawingOrPasting = false;
      strokeInProgress = false;
            
      // For straight line, cancel the operation if mouse leaves canvas
      if (drawingMode === 'straight') {
        // If we have a valid start point, restore to previous state
        if (straightLineStart && currentStroke) {
          restoreCanvasState(currentStroke);
        }
        straightLineStart = null;
      }
            
      // Save state immediately after stroke completion and increment label
      saveState(true, true);
            
      // Force redraw to show labels immediately
      redrawCanvasWithVisibility();
    }
        
    // Reset cursor when mouse leaves canvas (unless in specific drag states handled above)
    updateCursor('default', 'mouse left canvas');
  }
    
  // F1 & F2: Enhanced Window-Level Event Handling with Centralized Cursor Management
    
  // Centralized cursor management (F2)
  function updateCursor(state, context = '') {
    //         console.log(`[Cursor] Setting cursor to '${state}' (context: ${context})`);
        
    switch (state) {
      case 'grab':
        document.body.style.cursor = 'grab';
        canvas.style.cursor = 'grab';
        break;
      case 'grabbing':
        document.body.style.cursor = 'grabbing';
        canvas.style.cursor = 'grabbing';
        break;
      case 'pointer':
        document.body.style.cursor = 'pointer';
        canvas.style.cursor = 'pointer';
        break;
      case 'crosshair':
        document.body.style.cursor = 'crosshair';
        canvas.style.cursor = 'crosshair';
        break;
      case 'default':
      default:
        document.body.style.cursor = 'default';
        canvas.style.cursor = isShiftPressed ? 'grab' : 'crosshair';
        break;
    }
  }

  // F1: Window-level drag handlers with improved event handling
  function onWindowMouseMove(e) {
    // Continue control point dragging even when mouse is outside canvas
    if (isDraggingControlPoint && draggedControlPointInfo) {
      // Get canvas bounding rect to convert page coordinates to canvas coordinates
      const rect = canvas.getBoundingClientRect();
      const canvasX = e.clientX - rect.left;
      const canvasY = e.clientY - rect.top;
            
      // F2: Use centralized cursor management
      updateCursor('grabbing', 'window drag');
            
      // Continue the drag operation using the same logic as the canvas mousemove handler
      const vectorData = vectorStrokesByImage[currentImageLabel][draggedControlPointInfo.strokeLabel];
      if (vectorData && vectorData.controlPoints && vectorData.controlPoints[draggedControlPointInfo.pointIndex]) {
        // Update the control point position in image space
        const { x: imgX, y: imgY } = getTransformedCoords(canvasX, canvasY);
        vectorData.controlPoints[draggedControlPointInfo.pointIndex].x = imgX;
        vectorData.controlPoints[draggedControlPointInfo.pointIndex].y = imgY;
                
        // Regenerate curve if we have the function
        if (typeof generateCatmullRomSpline === 'function') {
          // CRITICAL FIX: Use refreshed control points with current canvas coordinates
          const refreshedControlPoints = refreshControlPointCanvasCoords(vectorData.controlPoints);
          const newSplinePoints = generateCatmullRomSpline(refreshedControlPoints, 50);
                    
          // CRITICAL FIX: Convert spline canvas coordinates to image coordinates for storage
          vectorData.points = newSplinePoints.map(splinePoint => {
            const { x: imgX, y: imgY } = getTransformedCoords(splinePoint.x, splinePoint.y);
            return {
              x: imgX,  // Image coordinate
              y: imgY,  // Image coordinate
              time: Date.now()
            };
          });
        }
                
        // Live preview update
        redrawCanvasWithVisibility();
      }
      return;
    }
        
    // Continue legacy curved line anchor dragging even when mouse is outside canvas
    if (draggingAnchor && dragCurveStroke && dragAnchorIndex >= 0) {
      // Get canvas bounding rect to convert page coordinates to canvas coordinates
      const rect = canvas.getBoundingClientRect();
      const canvasX = e.clientX - rect.left;
      const canvasY = e.clientY - rect.top;
            
      // F2: Use centralized cursor management
      updateCursor('grabbing', 'legacy drag');
            
      // Continue the drag operation using the same logic as the canvas mousemove handler
      const vectorData = vectorStrokesByImage[currentImageLabel][dragCurveStroke];
      if (vectorData && vectorData.controlPoints && vectorData.controlPoints[dragAnchorIndex]) {
        // Update the control point position in image space
        const { x: imgX, y: imgY } = getTransformedCoords(canvasX, canvasY);
        vectorData.controlPoints[dragAnchorIndex].x = imgX;
        vectorData.controlPoints[dragAnchorIndex].y = imgY;
                
        // Regenerate curve if we have the function
        if (typeof generateCatmullRomSpline === 'function') {
          // CRITICAL FIX: Use refreshed control points with current canvas coordinates
          const refreshedControlPoints = refreshControlPointCanvasCoords(vectorData.controlPoints);
          const newSplinePoints = generateCatmullRomSpline(refreshedControlPoints, 50);
                    
          // CRITICAL FIX: Convert spline canvas coordinates to image coordinates for storage
          vectorData.points = newSplinePoints.map(splinePoint => {
            const { x: imgX, y: imgY } = getTransformedCoords(splinePoint.x, splinePoint.y);
            return {
              x: imgX,  // Image coordinate
              y: imgY,  // Image coordinate
              time: Date.now()
            };
          });
        }
                
        // Live preview update
        redrawCanvasWithVisibility();
      }
      return;
    }
  }

  function onWindowMouseUp(e) {
    // F1: Handle control point dragging completed anywhere on window
    if (isDraggingControlPoint) {
      isDraggingControlPoint = false;
            
      // Save state to enable undo/redo
      if (draggedControlPointInfo) {
        saveState(true, false); // Save without incrementing label
        //                 console.log(`Completed control point drag for stroke ${draggedControlPointInfo.strokeLabel}`);
      }
            
      draggedControlPointInfo = null;
            
      // F1 & F2: Use canvas bounds to decide cursor restoration
      const rect = canvas.getBoundingClientRect();
      const canvasX = e.clientX - rect.left;
      const canvasY = e.clientY - rect.top;
      const isOverCanvas = (canvasX >= 0 && canvasX <= canvas.width && canvasY >= 0 && canvasY <= canvas.height);
            
      if (isOverCanvas) {
        // Use restoreCursorAfterDrag for proper cursor restoration
        restoreCursorAfterDrag(canvasX, canvasY);
      } else {
        // Outside canvas - set cursor based on shift state
        canvas.style.cursor = isShiftPressed ? 'grab' : 'crosshair';
        document.body.style.cursor = 'default';
      }
      return;
    }
        
    // F1: Handle legacy curved line anchor dragging completed anywhere on window
    if (draggingAnchor) {
      draggingAnchor = false;
      if (dragCurveStroke) {
        //                 console.log(`Completed curved line anchor drag for ${dragCurveStroke}`);
        // Save state for undo/redo
        saveState(true, false); // Save without incrementing label
      }
      dragCurveStroke = null;
      dragAnchorIndex = -1;
            
      // F1 & F2: Use canvas bounds to decide cursor restoration
      const rect = canvas.getBoundingClientRect();
      const canvasX = e.clientX - rect.left;
      const canvasY = e.clientY - rect.top;
      const isOverCanvas = (canvasX >= 0 && canvasX <= canvas.width && canvasY >= 0 && canvasY <= canvas.height);
            
      if (isOverCanvas) {
        // Use restoreCursorAfterDrag for proper cursor restoration
        restoreCursorAfterDrag(canvasX, canvasY);
      } else {
        // Outside canvas - set cursor based on shift state
        canvas.style.cursor = isShiftPressed ? 'grab' : 'crosshair';
        document.body.style.cursor = 'default';
      }
      return;
    }
  }
    
  // Track shift key for image movement
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') {
      isShiftPressed = true;
      if (!isDrawing && !isDraggingImage) {
        updateCursor('grab', 'shift pressed');
      }
    }
  });
    
  document.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') {
      isShiftPressed = false;
      if (!isDrawing && !isDraggingImage) {
        updateCursor('crosshair', 'shift released');
      }
    }
  });

  // Tab key cycling through drawing modes
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      // Only cycle if not focused on an input element
      if (document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
        e.preventDefault(); // Prevent default tab behavior
                
        // Cycle through modes: straight → curved → freehand → straight
        if (drawingMode === 'straight') {
          drawingMode = 'curved';
          drawingModeToggle.classList.remove('straight-mode');
          drawingModeToggle.classList.add('curved-mode');
          arrowControls.style.display = 'flex';
          // Update smart labels for curved mode
          if (typeof window.updateDrawingModeLabels === 'function') {
            window.updateDrawingModeLabels('curved');
          }
        } else if (drawingMode === 'curved') {
          drawingMode = 'freehand';
          drawingModeToggle.classList.remove('curved-mode', 'straight-mode');
          arrowControls.style.display = 'none';
          // Update smart labels for freehand mode
          if (typeof window.updateDrawingModeLabels === 'function') {
            window.updateDrawingModeLabels(true);
          }
        } else if (drawingMode === 'freehand') {
          drawingMode = 'straight';
          drawingModeToggle.classList.remove('curved-mode');
          drawingModeToggle.classList.add('straight-mode');
          arrowControls.style.display = 'flex';
          // Update smart labels for straight mode
          if (typeof window.updateDrawingModeLabels === 'function') {
            window.updateDrawingModeLabels(false);
          }
        }
                
        // Clear any temporary drawing state when switching modes
        straightLineStart = null;
        curvedLinePoints = [];
      }
    }
  });

  // F4: Listen for scale change events to update anchor visibility immediately
  function onCanvasScaleChange(e) {
    const { newScale, oldScale, imageLabel } = e.detail;
    //         console.log(`[F4 Scale Event] Scale changed from ${oldScale} to ${newScale} for ${imageLabel}`);
        
    // Force immediate anchor position recalculation if we're in edit mode
    if (window.selectedStrokeInEditMode) {
      //             console.log(`[F4 Scale Event] Updating anchor positions for edit mode stroke: ${window.selectedStrokeInEditMode}`);
      // Anchor positions will be recalculated during the next redraw
    }
  }

  // Right-click handler for copying cropped canvas
  // function onCanvasRightClick(e) {
  //     e.preventDefault();
  //     copyCurrentViewToClipboard();
  // }

  // Function to show Chrome-style copy icon feedback
  function showCopyIconFeedback() {
    // Create a temporary copy icon element
    const copyIcon = document.createElement('div');
    copyIcon.innerHTML = '📋';
    copyIcon.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            font-size: 48px;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            border-radius: 8px;
            padding: 16px;
            z-index: 10000;
            pointer-events: none;
            animation: copyIconFade 1s ease-out forwards;
        `;
        
    // Add CSS animation if not already present
    if (!document.getElementById('copyIconStyles')) {
      const style = document.createElement('style');
      style.id = 'copyIconStyles';
      style.textContent = `
                @keyframes copyIconFade {
                    0% { opacity: 0; transform: translate(-50%, -50%) scale(0.5); }
                    20% { opacity: 1; transform: translate(-50%, -50%) scale(1.2); }
                    80% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
                    100% { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
                }
            `;
      document.head.appendChild(style);
    }
        
    document.body.appendChild(copyIcon);
        
    // Remove after animation completes
    setTimeout(() => {
      if (copyIcon.parentNode) {
        copyIcon.parentNode.removeChild(copyIcon);
      }
    }, 1000);
  }

  // Copy current view (respecting capture frame) to clipboard
  async function copyCurrentViewToClipboard() {
    try {
      // Get the capture frame if it exists
      const captureFrame = document.getElementById('captureFrame');
      let sourceCanvas = canvas;
      let cropData = null;

      if (captureFrame) {
        const frameRect = captureFrame.getBoundingClientRect();
        const canvasRect = canvas.getBoundingClientRect();
                
        // Check if frame overlaps with canvas
        if (frameRect.left < canvasRect.right && frameRect.right > canvasRect.left &&
                    frameRect.top < canvasRect.bottom && frameRect.bottom > canvasRect.top) {
                    
          // Calculate crop area in canvas pixel coordinates using precise px scale
          const scalePx = canvas.width / canvasRect.width;
          const left = Math.max(frameRect.left, canvasRect.left);
          const top = Math.max(frameRect.top, canvasRect.top);
          const right = Math.min(frameRect.right, canvasRect.right);
          const bottom = Math.min(frameRect.bottom, canvasRect.bottom);
          const winW = Math.max(window.innerWidth, 1);
          const winH = Math.max(window.innerHeight, 1);
          const pixelLeft = Math.round((left - canvasRect.left) * scalePx);
          const pixelTop = Math.round((top - canvasRect.top) * scalePx);
          const pixelWidth = Math.round((right - left) * scalePx);
          const pixelHeight = Math.round((bottom - top) * scalePx);

          cropData = {
            x: pixelLeft,
            y: pixelTop,
            width: pixelWidth,
            height: pixelHeight,
            windowWidth: winW,
            windowHeight: winH,
            relativeLeft: left / winW,
            relativeTop: top / winH,
            relativeWidth: (right - left) / winW,
            relativeHeight: (bottom - top) / winH
          };
        }
      }

      // Create a temporary canvas for the cropped area
      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d');
            
      if (cropData) {
        tempCanvas.width = cropData.width;
        tempCanvas.height = cropData.height;
                
        // Copy the cropped region from the main canvas
        const imageData = ctx.getImageData(cropData.x, cropData.y, cropData.width, cropData.height);
        tempCtx.putImageData(imageData, 0, 0);
      } else {
        // Copy the entire canvas
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        tempCtx.drawImage(canvas, 0, 0);
      }

      // Convert to blob and copy to clipboard
      const blob = await new Promise(resolve => tempCanvas.toBlob(resolve, 'image/png'));
            
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob })
        ]);
                
        // Show Chrome-style copy icon feedback
        showCopyIconFeedback();
                
        // Also show status message
        if (typeof window.projectManager?.showStatusMessage === 'function') {
          window.projectManager.showStatusMessage('Image copied to clipboard!', 'success');
        } else {
          alert('Image copied to clipboard!');
        }
      } else {
        console.warn('[Copy] Clipboard API not supported');
        if (typeof window.projectManager?.showStatusMessage === 'function') {
          window.projectManager.showStatusMessage('Clipboard not supported in this browser', 'error');
        } else {
          alert('Clipboard not supported in this browser');
        }
      }
    } catch (error) {
      console.error('[Copy] Failed to copy to clipboard:', error);
      if (typeof window.projectManager?.showStatusMessage === 'function') {
        window.projectManager.showStatusMessage('Failed to copy image', 'error');
      } else {
        alert('Failed to copy image');
      }
    }
  }
    
  // Function to switch to a different image
  // Make switchToImage available globally
  window.switchToImage = switchToImage;
  function switchToImage(label) {
    // Start a new session for this image to fence writes until stable
    try { bumpImageSession(label); } catch(_) {}
    if (currentImageLabel === label && !window.isLoadingProject) { // Allow forcing a switch during project load
      //             console.log(`[switchToImage] Already on ${label}, no switch needed unless loading project.`);
      // Even if not switching, ensure UI is consistent if forced by project load
      if (window.isLoadingProject) {
        updateActiveImageInSidebar();
        updateStrokeCounter();
        updateStrokeVisibilityControls();
        updateScaleUI();
        redrawCanvasWithVisibility(); // Explicit redraw might be needed
      }
      return;
    }
        
    //         console.log(`Switching from ${currentImageLabel} to ${label}`);
        
    // Save current state before switching (if not loading, during load state is managed by project-manager)
    if (!window.isLoadingProject) {
      const currentStrokes = [...(lineStrokesByImage[currentImageLabel] || [])];
      const currentState = getCanvasState();
      // Ensure per-image undo stack exists
      if (!undoStackByImage[currentImageLabel]) undoStackByImage[currentImageLabel] = [];
      undoStackByImage[currentImageLabel].push({
        state: cloneImageData(currentState),
        type: 'snapshot',
        strokes: currentStrokes
      });
    }
        
    // Before switching, persist the current capture frame position/size per image (if available)
    try {
      const prevLabel = currentImageLabel;
      if (prevLabel && typeof window.getComputedStyle === 'function') {
        const frameEl = document.getElementById('captureFrame');
        if (frameEl) {
          const rect = frameEl.getBoundingClientRect();
          const winW = Math.max(window.innerWidth, 1);
          const winH = Math.max(window.innerHeight, 1);
          window.captureFrameByLabel = window.captureFrameByLabel || {};
          window.captureFrameByLabel[prevLabel] = {
            left: Math.round(rect.left),
            top: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            windowWidth: winW,
            windowHeight: winH,
            relativeLeft: rect.left / winW,
            relativeTop: rect.top / winH,
            relativeWidth: rect.width / winW,
            relativeHeight: rect.height / winH
          };
        }
      }
    } catch (e) { /* no-op */ }

    // Update current image label
    currentImageLabel = label;
    // CRITICAL FIX: Update the global window.currentImageLabel used by canvas event handlers
    window.currentImageLabel = label;
    window.paintApp.state.currentImageLabel = label;
        
    // Ensure we have properly initialized position and scale for this label
    if (window.imageScaleByLabel[label] === undefined) {
      //             console.log(`[switchToImage] No scale found for ${label}, initializing to default scale (1.0)`);
      window.imageScaleByLabel[label] = 1.0; // Default scale
    } else {
      //             console.log(`[switchToImage] Using scale ${window.imageScaleByLabel[label]} for ${label}`);
    }
        
    if (!imagePositionByLabel[label]) {
      //             console.log(`[switchToImage] No position found for ${label}, initializing to default position (0,0)`);
      imagePositionByLabel[label] = { x: 0, y: 0 }; // Default position
    } else {
      //             console.log(`[switchToImage] Using position (${imagePositionByLabel[label].x}, ${imagePositionByLabel[label].y}) for ${label}`);
    }
        
    // Restore capture frame for the new image (default to centered 800x600 if none)
    try {
      if (typeof window.applyCaptureFrameForLabel === 'function') {
        window.applyCaptureFrameForLabel(label);
      }
    } catch (e) { /* no-op */ }

    // Restore state for the new image
    if (imageStates[label]) {
      // *** MODIFICATION START: Revert to simple state restoration ***
      //             console.log(`[switchToImage] Found existing state for ${label}, restoring directly.`);
      restoreCanvasState(imageStates[label]);
            
      // UI Updates after restoring state
      updateActiveImageInSidebar();
      updateStrokeCounter();
      updateStrokeVisibilityControls(); 
      updateScaleUI();
      // Update next tag display
      if (typeof window.updateNextTagDisplay === 'function') {
        window.updateNextTagDisplay();
      }
      // Trigger resize to recalculate fit scale when switching to an image
      if (typeof window.resizeCanvas === 'function') {
        window.resizeCanvas();
      }
            
      // Explicit redraw AFTER restoring state and UI updates
      //             console.log(`[switchToImage] Explicitly calling redraw after restoring state for ${label}`);
      redrawCanvasWithVisibility();
      // *** MODIFICATION END ***

    } else if (window.originalImages[label]) {
      //             console.log(`No state exists for ${label}, pasting original image: ${window.originalImages[label].substring(0, 30)}...`);
      pasteImageFromUrl(window.originalImages[label], label)
        .then(() => {
          //                     console.log(`[switchToImage] pasteImageFromUrl COMPLETED for ${label}. Now updating UI.`);
          // Update UI elements first
          updateActiveImageInSidebar();
          updateStrokeCounter();
          updateStrokeVisibilityControls();
          updateScaleUI();
          // Update next tag display
          if (typeof window.updateNextTagDisplay === 'function') {
            window.updateNextTagDisplay();
          } 
          // Explicitly redraw AFTER all UI updates and state changes triggered by them
          //                     console.log(`[switchToImage] Explicitly calling final redraw for ${label}`);
          redrawCanvasWithVisibility(); 
        })
        .catch(err => {
          console.error(`[switchToImage] Error during pasteImageFromUrl for ${label}:`, err);
          // Fallback UI updates even on error
          updateActiveImageInSidebar();
          updateStrokeCounter();
          updateStrokeVisibilityControls();
          updateScaleUI();
          // Update next tag display
          if (typeof window.updateNextTagDisplay === 'function') {
            window.updateNextTagDisplay();
          }
        });
    } else {
      //             console.log(`No state or image found for ${label}, clearing canvas`);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // UI Updates for blank canvas
      updateActiveImageInSidebar();
      updateStrokeCounter();
      updateStrokeVisibilityControls();
      updateScaleUI(); // This calls redrawCanvasWithVisibility (will draw strokes on blank)
      // Update next tag display
      if (typeof window.updateNextTagDisplay === 'function') {
        window.updateNextTagDisplay();
      }
    }
        
    // *** ADDED: Clear selection and edit mode for the new/target image view ***
    if (selectedStrokeByImage[currentImageLabel] !== undefined) {
      //             console.log(`[switchToImage] Clearing selection for new image: ${currentImageLabel}`);
      selectedStrokeByImage[currentImageLabel] = null;
    }
    // Clear edit mode to prevent stale references to strokes from other images
    if (window.selectedStrokeInEditMode) {
      //             console.log(`[switchToImage] Clearing edit mode for ${window.selectedStrokeInEditMode} when switching to ${currentImageLabel}`);
      window.selectedStrokeInEditMode = null;
      window.paintApp.state.selectedStrokeInEditMode = null;
    }
    // *** END ADDED ***
  }
    
  function updateActiveImageInSidebar() {
    // Update which image is active in the sidebar
    document.querySelectorAll('.image-container').forEach(container => {
      if (container.dataset.label === currentImageLabel) {
        container.classList.add('active');
        container.setAttribute('aria-selected', 'true');
      } else {
        container.classList.remove('active');
        container.setAttribute('aria-selected', 'false');
      }
    });
  }
    
  // Handle Ctrl+Z for undo and Ctrl+Y for redo
  document.addEventListener('keydown', (e) => {
    // Handle undo (Ctrl+Z)
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !isDrawingOrPasting) {
      e.preventDefault();
      //             console.log('Ctrl+Z pressed, executing undo');
            
      // Make sure we have valid undo stacks
      if (!undoStackByImage[currentImageLabel]) {
        undoStackByImage[currentImageLabel] = [];
        //                 console.log(`Created new undo stack for ${currentImageLabel}`);
      }
            
      // Make sure we have valid stroke lists
      if (!lineStrokesByImage[currentImageLabel]) {
        lineStrokesByImage[currentImageLabel] = [];
        //                 console.log(`Created new stroke list for ${currentImageLabel}`);
      }
            
      // Make sure we have valid redo stacks
      if (!redoStackByImage[currentImageLabel]) {
        redoStackByImage[currentImageLabel] = [];
      }
            
      // Force a redraw after undo to ensure visual consistency
      const performUndo = async () => {
        undo();
        // Small delay to ensure state is updated
        await new Promise(resolve => setTimeout(resolve, 10));
        // Force redraw by restoring current state
        if (imageStates[currentImageLabel]) {
          restoreCanvasState(imageStates[currentImageLabel]);
        }
        // Update visibility controls after undo
        updateStrokeVisibilityControls();
      };
            
      performUndo();
    }
        
    // Handle redo (Ctrl+Y)
    if ((e.ctrlKey || e.metaKey) && e.key === 'y' && !isDrawingOrPasting) {
      e.preventDefault();
      //             console.log('Ctrl+Y pressed, executing redo');
            
      // Make sure we have valid redo stacks
      if (!redoStackByImage[currentImageLabel]) {
        redoStackByImage[currentImageLabel] = [];
        //                 console.log(`Created new redo stack for ${currentImageLabel}`);
      }
            
      // Force a redraw after redo to ensure visual consistency
      const performRedo = async () => {
        redo();
        // Small delay to ensure state is updated
        await new Promise(resolve => setTimeout(resolve, 10));
                
        // Force redraw with visibility to ensure labels appear immediately
        redrawCanvasWithVisibility();
                
        // Make sure we restore proper label visibility settings for any redone strokes
        if (lineStrokesByImage[currentImageLabel]?.length > 0) {
          const strokes = lineStrokesByImage[currentImageLabel];
          for (const strokeLabel of strokes) {
            // Make sure label visibility is initialized properly
            if (strokeLabelVisibility[currentImageLabel] === undefined) {
              strokeLabelVisibility[currentImageLabel] = {};
            }
            if (strokeLabelVisibility[currentImageLabel][strokeLabel] === undefined) {
              strokeLabelVisibility[currentImageLabel][strokeLabel] = true;
            }
          }
        }
                
        // Update all UI elements to ensure synchronized state
        updateStrokeCounter();
        updateStrokeVisibilityControls();
        updateSidebarStrokeCounts();
      };
            
      performRedo();
    }

    // Handle copy (Ctrl+C) to copy current view (cropped to capture frame)
    if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !isDrawingOrPasting) {
      const t = e.target;
      const isEditable = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (!isEditable) {
        e.preventDefault();
        copyCurrentViewToClipboard();
      }
    }
        
    // Handle Delete key to remove selected strokes
    if (e.key === 'Delete' && !isDrawingOrPasting) {
      const activeElement = document.activeElement;
      const selectedStrokes = multipleSelectedStrokesByImage[currentImageLabel] || [];
            
      // Special case: Allow stroke deletion even when a measurement field is focused
      if (activeElement && 
                activeElement.classList.contains('stroke-measurement') && 
                activeElement.isContentEditable) {
        // If measurement field is focused AND strokes are selected, delete strokes instead of text
        if (selectedStrokes.length > 0) {
          //                     console.log('Delete key pressed while measurement focused, deleting selected strokes:', selectedStrokes);
          e.preventDefault(); // Prevent deleting text in the measurement field
          deleteSelectedStrokes();
        }
        return;
      }
            
      // Apply stricter guards for other input elements
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return; // Let the Delete key work normally in these fields
      }
            
      // Don't delete strokes if user is editing a stroke name
      if (e.target.classList.contains('stroke-name')) {
        return; // Let the Delete key work normally in stroke name fields
      }
            
      // Don't delete strokes if user is editing other contentEditable elements (excluding measurement fields)
      if (e.target.isContentEditable && !e.target.classList.contains('stroke-measurement')) {
        return; // Let the Delete key work normally in other editable fields
      }
            
      // If focus is on canvas/body or non-input element AND strokes are selected
      if (selectedStrokes.length > 0) {
        //                 console.log('Delete key pressed, deleting selected strokes:', selectedStrokes);
        e.preventDefault();
        deleteSelectedStrokes();
      }
    }
  });
    
  // Clear canvas (but keep the background image)
  clearButton.addEventListener('click', () => {
    // Save the current state before clearing
    const currentState = getCanvasState();
    undoStackByImage[currentImageLabel].push({
      state: cloneImageData(currentState),
      type: 'clear',
      label: null
    });
        
    // Clear the selected stroke and edit mode
    selectedStrokeByImage[currentImageLabel] = null;
    window.selectedStrokeInEditMode = null;
        
    // Reset edit mode in the UI
    document.querySelectorAll('.stroke-visibility-item').forEach(el => {
      el.dataset.editMode = 'false';
    });
        
    // Instead of just clearing the canvas, redraw the original image if available
    if (window.originalImages[currentImageLabel]) {
      const img = new Image();
      img.onload = () => {
        // Clear the canvas first
        ctx.clearRect(0, 0, canvas.width, canvas.height);
                
        // Get the current scale
        const scale = window.imageScaleByLabel[currentImageLabel];
        const scaledWidth = img.width * scale;
        const scaledHeight = img.height * scale;
                
        // Calculate base position (center of canvas)
        const centerX = (canvas.width - scaledWidth) / 2;
        const centerY = (canvas.height - scaledHeight) / 2;
                
        // Apply position offset
        const offsetX = imagePositionByLabel[currentImageLabel].x;
        const offsetY = imagePositionByLabel[currentImageLabel].y;
                
        // Calculate final position
        const x = centerX + offsetX;
        const y = centerY + offsetY;
                
        // Draw the original image with scale and position
        ctx.drawImage(img, x, y, scaledWidth, scaledHeight);
                
        // Save this as the new state
        const newState = getCanvasState();
        imageStates[currentImageLabel] = cloneImageData(newState);
        currentStroke = cloneImageData(newState);
                
        // Reset other states
        lineStrokesByImage[currentImageLabel] = [];
        labelsByImage[currentImageLabel] = 'A1';  // Reset to A1
                
        // Clear visibility controls
        strokeVisibilityByImage[currentImageLabel] = {};
        strokeDataByImage[currentImageLabel] = {};
                
        // Clear label position offsets
        if (customLabelPositions[currentImageLabel]) {
          delete customLabelPositions[currentImageLabel];
        }
        if (calculatedLabelOffsets[currentImageLabel]) {
          delete calculatedLabelOffsets[currentImageLabel];
        }
                
        // Update UI
        updateStrokeCounter();
      };
      img.src = originalImages[currentImageLabel];
    } else {
      // If no original image, just clear the canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);
            
      // Reset state for this image
      const blankState = getCanvasState();
      imageStates[currentImageLabel] = blankState;
      currentStroke = cloneImageData(blankState);
      lineStrokesByImage[currentImageLabel] = [];
      labelsByImage[currentImageLabel] = 'A1';  // Reset to A1
            
      // Clear visibility controls
      strokeVisibilityByImage[currentImageLabel] = {};
      strokeDataByImage[currentImageLabel] = {};
            
      // Clear label position offsets
      if (customLabelPositions[currentImageLabel]) {
        delete customLabelPositions[currentImageLabel];
      }
      if (calculatedLabelOffsets[currentImageLabel]) {
        delete calculatedLabelOffsets[currentImageLabel];
      }
            
      // Update UI
      updateStrokeCounter();
    }
  });
    
  // Copy current view via button (cropped to capture frame if present)
  if (copyButton) {
    copyButton.addEventListener('click', () => {
      copyCurrentViewToClipboard();
    });
    console.log('[PAINT.JS] Copy button event listener added');
  } else {
    console.warn('[PAINT.JS] Copy button not found!');
  }
    
  // Canvas copy button (in bottom controls)
  const copyCanvasBtn = window.paintApp.state.domElements.copyCanvasBtn;
  if (copyCanvasBtn) {
    copyCanvasBtn.addEventListener('click', () => {
      copyCurrentViewToClipboard();
    });
    console.log('[PAINT.JS] Canvas copy button event listener added');
  } else {
    console.warn('[PAINT.JS] Canvas copy button not found!');
  }
    
  // Save canvas (cropped to capture frame if present, otherwise full canvas) with opaque white background
  saveButton.addEventListener('click', () => {
    const projectName = document.getElementById('projectName').value || 'New Sofa';
    const unit = document.getElementById('unitSelector').value || 'inch';

    const sanitizedName = projectName.replace(/\s+/g, '_');
    const baseLabel = currentImageLabel.split('_')[0];
    const filename = `${sanitizedName}_${baseLabel}_${unit}.png`;

    const captureEl = document.getElementById('captureFrame');
    let dataUrl;

    if (captureEl) {
      const canvasRect = canvas.getBoundingClientRect();
      const frameRect = captureEl.getBoundingClientRect();

      // Compute intersection of frame with canvas in CSS pixels
      const left = Math.max(frameRect.left, canvasRect.left);
      const top = Math.max(frameRect.top, canvasRect.top);
      const right = Math.min(frameRect.right, canvasRect.right);
      const bottom = Math.min(frameRect.bottom, canvasRect.bottom);

      const cssWidth = Math.max(0, right - left);
      const cssHeight = Math.max(0, bottom - top);

      if (cssWidth > 0 && cssHeight > 0) {
        // Convert to canvas pixel coordinates
        const scale = canvas.width / canvasRect.width;
        const viewportBounds = {
          x: Math.round((left - canvasRect.left) * scale),
          y: Math.round((top - canvasRect.top) * scale),
          width: Math.round(cssWidth * scale),
          height: Math.round(cssHeight * scale)
        };

        // Crop from the current canvas content
        const cropped = cropToViewport(canvas, viewportBounds);

        // Ensure white background (in case any transparency slipped through)
        const out = document.createElement('canvas');
        out.width = viewportBounds.width;
        out.height = viewportBounds.height;
        const outCtx = out.getContext('2d');
        outCtx.fillStyle = 'white';
        outCtx.fillRect(0, 0, out.width, out.height);
        outCtx.drawImage(cropped, 0, 0);
        dataUrl = out.toDataURL('image/png', 0.95);
      }
    }

    // Fallback to full canvas if no capture frame or invalid bounds
    if (!dataUrl) {
      dataUrl = canvas.toDataURL('image/png', 0.95);
    }

    const link = document.createElement('a');
    link.download = filename;
    link.href = dataUrl;
    link.click();
  });
    
  // Determine the best label for an image based on its filename
  function getLabelFromFilename(filename) {
    filename = filename.toLowerCase();
    let baseLabel = '';
        
    if (filename.includes('front')) {
      baseLabel = 'front';
    } else if (filename.includes('side')) {
      baseLabel = 'side';
    } else if (filename.includes('back')) {
      baseLabel = 'back';
    } else if (filename.includes('cushion')) {
      baseLabel = 'cushion';
    } else {
      // If no matching keywords, find next available label
      for (const label of IMAGE_LABELS) {
        baseLabel = label;
        break;
      }
      if (!baseLabel) baseLabel = IMAGE_LABELS[0]; // Default to front if all are taken
    }
        
    // Increment the counter for this label type
    if (!window.labelCounters[baseLabel]) {
      window.labelCounters[baseLabel] = { regular: 1, paste: 1 };
    }
        
    const counter = window.labelCounters[baseLabel].regular;
    const uniqueLabel = `${baseLabel}_${counter}`;
    window.labelCounters[baseLabel].regular = counter + 1;
    //         console.log(`Created unique label: ${uniqueLabel} from filename: ${filename}`);
        
    return uniqueLabel;
  }
    
  // Handle file drop
  const handleFiles = (files) => {
    //         console.log('[handleFiles] Processing files:', files); // Add log
    const fileArray = Array.from(files);
    const sortedFiles = fileArray.sort((a, b) => {
      const aName = a.name.toLowerCase();
      const bName = b.name.toLowerCase();
      const keywordOrder = ['front', 'side', 'back', 'cushion'];
      const aKeyword = keywordOrder.find(keyword => aName.includes(keyword)) || '';
      const bKeyword = keywordOrder.find(keyword => bName.includes(keyword)) || '';
      const aIndex = keywordOrder.indexOf(aKeyword);
      const bIndex = keywordOrder.indexOf(bKeyword);
      if (aIndex >= 0 && bIndex >= 0) return aIndex - bIndex;
      if (aIndex >= 0) return -1;
      if (bIndex >= 0) return 1;
      return aName.localeCompare(bName);
    });
        
    let firstImageLabel = null;
    const loadPromises = [];
    const actualNewImageLabels = []; // Track the actual labels created

    sortedFiles.forEach((file, index) => {
      if (file.type.indexOf('image') !== -1) {
        //                 console.log(`[handleFiles] Processing image file: ${file.name}`); // Add log
        const url = URL.createObjectURL(file);
        const label = getLabelFromFilename(file.name); // This now generates unique labels like 'front_1', 'front_2'
        const filename = file.name.replace(/\.[^/.]+$/, '');

        // Track the actual label created
        actualNewImageLabels.push(label);

        if (index === 0) {
          firstImageLabel = label; 
        }

        // Initialize structures for the new unique label
        initializeNewImageStructures(label); // Ensures all necessary states are ready

        let displayName = filename;
        if (window.getTagBasedFilename && typeof window.getTagBasedFilename === 'function') {
          displayName = window.getTagBasedFilename(label, filename);
        }
        //                 console.log(`[handleFiles] Adding to sidebar: URL created for ${file.name}, label=${label}, displayName=${displayName}`);
                
        addImageToSidebar(url, label, displayName);
        if (!pastedImages.includes(url)) pastedImages.push(url);
        window.originalImages[label] = url;
                
        // No need to initialize imageStates, undoStackByImage etc. here as initializeNewImageStructures handles it

        const promise = pasteImageFromUrl(url, label)
          .catch(err => {
            console.error(`[handleFiles] Error loading image ${label} via pasteImageFromUrl:`, err);
          });
        loadPromises.push(promise);
      } else {
        //                 console.log(`[handleFiles] Skipping non-image file: ${file.name}`);
      }
    });

    Promise.all(loadPromises)
      .then(() => {
        //                 console.log('[handleFiles] All image processing promises resolved.');
                
        // Apply default fit mode to all newly loaded images (AFTER they've loaded)
        if (actualNewImageLabels.length > 0) {
          const currentLabel = currentImageLabel; // Store current image
                    
          console.log(`[handleFiles] Applying smart fit mode to ${actualNewImageLabels.length} newly loaded images:`, actualNewImageLabels);
                    
          actualNewImageLabels.forEach(label => {
            if (window.originalImageDimensions[label] && window.originalImageDimensions[label].width > 0) {
              const dimensions = window.originalImageDimensions[label];
              // Use fit-height for tall images (height > width), fit-width for wide images
              const fitMode = dimensions.height > dimensions.width ? 'fit-height' : 'fit-width';
              console.log(`[handleFiles] Image ${label} dimensions: ${dimensions.width}x${dimensions.height}, applying ${fitMode}`);
                            
              // Ensure canvas matches its container before computing fit (so fit uses actual canvas area)
              if (typeof resizeCanvas === 'function') resizeCanvas();
                            
              // Temporarily set current image to calculate fit for this specific image
              currentImageLabel = label;
              const { scale, position } = calculateFitScale(fitMode);
                            
              // Update the scale and position for this image
              window.imageScaleByLabel[label] = scale;
              window.imagePositionByLabel[label] = { ...position };
                            
              console.log(`� Auto-applied ${fitMode} to ${label}: scale=${scale.toFixed(2)}`);
            } else {
              console.log(`❌ Skipping ${label} - no valid dimensions:`, window.originalImageDimensions[label]);
            }
          });
                    
          // Restore the original current image label
          currentImageLabel = currentLabel;
                    
          // Redraw canvas to show the applied fit mode and sync scale UI
          if (currentImageLabel) {
            try { if (typeof updateScaleUI === 'function') updateScaleUI(); } catch(_) {}
            redrawCanvasWithVisibility();
          }
        }
                
        // Update the ordered image labels array after initial load
        updateOrderedImageLabelsArray();
                
        if (firstImageLabel) {
          //                     console.log(`[handleFiles] Switching to first image: ${firstImageLabel}`);
          // REMOVED: currentImageLabel = firstImageLabel; 
          switchToImage(firstImageLabel); // switchToImage will handle setting currentImageLabel
        } else {
          //                     console.log('[handleFiles] No first image label identified, or no image files were processed.');
          // If no images were processed, still ensure UI is consistent
          redrawCanvasWithVisibility();
          updateStrokeCounter();
          updateSidebarStrokeCounts();
          updateActiveImageInSidebar();
          updateStrokeVisibilityControls();
          updateScaleUI();
        }
      })
      .catch(err => {
        console.error('[handleFiles] Error processing one or more images:', err);
      });
  };
    
  // Handle paste button click
  pasteButton.addEventListener('click', () => {
    // Create an input element for file selection
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.accept = 'image/*';
        
    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        handleFiles(e.target.files);
      }
    });
        
    // Trigger file selection dialog
    fileInput.click();
  });
    
  // Initialize the stroke visibility controls
  updateStrokeVisibilityControls();
    
  // Handle image scaling
  function updateScaleButtonsActiveState() {
    // Remove active class from all scale buttons and dropdown options
    document.querySelectorAll('.scale-btn').forEach(btn => {
      btn.classList.remove('active');
    });
    document.querySelectorAll('.scale-option').forEach(option => {
      option.classList.remove('active');
    });
        
    // Add active class to the current scale button
    const currentScale = window.imageScaleByLabel[currentImageLabel];
    const activeButton = document.querySelector(`.scale-btn[data-scale="${currentScale}"]`);
    if (activeButton) {
      activeButton.classList.add('active');
    }
        
    // Add active class to the current scale dropdown option
    const activeOption = document.querySelector(`.scale-option[data-scale="${currentScale}"]`);
    if (activeOption) {
      activeOption.classList.add('active');
    }
  }
    
  function updateImageScale(newScale) {
    // Update scale for current image
    const oldScale = window.imageScaleByLabel[currentImageLabel];
    //         console.log(`[updateImageScale] Changing scale for ${currentImageLabel} from ${oldScale} to ${newScale}`);
        
    // Store the old scale for potential restoration on error
    const previousScale = oldScale;
        
    // Update the scale in the global tracking object
    window.imageScaleByLabel[currentImageLabel] = newScale;
        
    // PERFORMANCE: Invalidate cache when scale changes
    invalidateInteractiveElementCache();
        
    // Update UI to reflect the new scale BEFORE redrawing
    updateScaleUI();
        
    // Save current state before redrawing
    saveState(true, false, false);
            
    // F6: Set flag BEFORE any operations to prevent measurement span mutation
    window.isScalingOrZooming = true;
    //         console.log('[F6] Set isScalingOrZooming = true before zoom operations');
        
    // F4: Emit scale change event for anchor redraw
    const scaleChangeEvent = new CustomEvent('scalechange', {
      detail: { 
        newScale, 
        oldScale: previousScale,
        imageLabel: currentImageLabel 
      }
    });
    canvas.dispatchEvent(scaleChangeEvent);
            
    // Redraw the canvas (image and/or strokes)
    try {
      redrawCanvasWithVisibility();
    } catch (error) {
      console.error('[updateImageScale] Error during redraw:', error);
            
      // Restore previous scale on error
      window.imageScaleByLabel[currentImageLabel] = previousScale;
      updateScaleUI();
    } finally {
      // CRITICAL FIX: Don't deselect strokes during curved line creation
      const isCurvedLineInProgress = drawingMode === 'curved' && curvedLinePoints.length > 0;
      if (!isCurvedLineInProgress) {
        // Deselect all strokes BEFORE clearing the isScalingOrZooming flag
        // This ensures auto-focus logic in createEditableMeasureText is suppressed
        deselectAllStrokes();
      } else {
        //                 console.log('[updateImageScale] Curved line creation in progress - preserving state, not deselecting');
      }
            
      // F6: Clear the flag LAST after all operations complete, including deselection
      //             console.log('[F6] Clearing isScalingOrZooming flag after zoom operations AND deselection.');
      window.isScalingOrZooming = false;
    }
  }
    
  // Initialize scale option click handlers
  document.querySelectorAll('.scale-option').forEach(option => {
    option.addEventListener('click', () => {
      const scale = parseFloat(option.dataset.scale);
      if (!isNaN(scale)) {
        updateImageScale(scale);
        // No need to update button text here as it's handled by updateScaleUI in updateImageScale
      }
    });
  });
    
  // Working rotation function that properly manages rotation state
  window.rotateImage = function(imageIndex, degrees) {
    // Get current image label from the global state
    const currentLabel = window.currentImageLabel;
    if (!currentLabel) {
      console.warn('[rotateImage] No current image label found');
      return;
    }
        
    // Guard against duplicate invocations in quick succession (e.g., double-wired click)
    if (!window.__rotateClickGuard) window.__rotateClickGuard = { lastTs: 0, lastLabel: null };
    const __now = Date.now();
    if (window.__rotateClickGuard.lastLabel === currentLabel && (__now - window.__rotateClickGuard.lastTs) < 120) {
      if (window.__DEBUG__) console.log('[rotateImage] Suppressed duplicate rotate within 120ms');
      return;
    }
    window.__rotateClickGuard.lastTs = __now;
    window.__rotateClickGuard.lastLabel = currentLabel;

    // Initialize rotation state if it doesn't exist
    if (!window.imageRotationByLabel) {
      window.imageRotationByLabel = {};
    }
    if (!window.imageRotationByLabel[currentLabel]) {
      window.imageRotationByLabel[currentLabel] = 0;
    }
        
    // Update the global rotation state
    const currentRotation = window.imageRotationByLabel[currentLabel];
    const normalizedDelta = (degrees * Math.PI) / 180; // Convert to radians
    let newRotation = currentRotation + normalizedDelta;
    
    // Normalize rotation to keep it within -2π to 2π range using modulo to prevent infinite loops
    const TWO_PI = Math.PI * 2;
    newRotation = ((newRotation % TWO_PI) + TWO_PI) % TWO_PI;
    
    // Convert to -π to π range for consistency with typical rotation handling
    if (newRotation > Math.PI) {
      newRotation -= TWO_PI;
    }
    
    // Use the normal rotation system for images and labels
    if (!window.imageRotationByLabel) window.imageRotationByLabel = {};
    window.imageRotationByLabel[currentLabel] = newRotation;
    console.log(`[rotateImage] Updated rotation to ${(newRotation * 180 / Math.PI).toFixed(1)}° using standard coordinate transformation system`);
        
    const finalRotation = window.imageRotationByLabel[currentLabel] || 0;
    console.log(`[rotateImage] Applied ${degrees}° rotation to ${currentLabel}, final rotation: ${(finalRotation * 180 / Math.PI).toFixed(1)}°`);
    
    // IMPORTANT: Do not mutate vector stroke points here.
    // The render pipeline applies rotation via imageToCanvasCoords/canvasToImageCoords.
    // Mutating points would double-transform and push vectors off the capture frame.
        
    // For now, just update the rotation state and let coordinate transformation handle it
    // The coordinate transformation will apply the rotation when drawing
    
    // IMPORTANT: Invalidate anchor cache when rotation changes so labels recalculate positions
    if (typeof window.invalidateAnchorCache === 'function') {
      window.invalidateAnchorCache(currentLabel);
      console.log(`[rotateImage] Invalidated anchor cache for ${currentLabel} due to rotation change`);
    }
        
    // Save state and redraw
    if (typeof window.saveState === 'function') {
      window.saveState();
    }
    if (typeof window.redrawCanvasWithVisibility === 'function') {
      window.redrawCanvasWithVisibility();
    }
  };
    
  // Debug function to test rotation
  window.testRotation = function() {
    const currentLabel = window.currentImageLabel;
    if (!currentLabel) {
      console.warn('No current image to test rotation');
      return;
    }
        
    console.log('=== ROTATION TEST ===');
    console.log('Current image label:', currentLabel);
    console.log('Current rotation:', window.imageRotationByLabel?.[currentLabel] || 0);
        
    // Test coordinate transformation
    const testPoint = { x: 100, y: 100 };
    const params = getTransformationParams(currentLabel);
    console.log('Transformation params:', params);
        
    const transformed = imageToCanvasCoords(testPoint.x, testPoint.y, params);
    console.log('Test point:', testPoint);
    console.log('Transformed point:', transformed);
        
    // Test 90 degree rotation
    console.log('Testing 90° rotation...');
    window.rotateImage(0, 90);
        
    const newParams = getTransformationParams(currentLabel);
    console.log('New rotation:', newParams.rotation);
        
    const newTransformed = imageToCanvasCoords(testPoint.x, testPoint.y, newParams);
    console.log('After 90° rotation:', newTransformed);
        
    console.log('=== END ROTATION TEST ===');
  };
    
  // Working transform function that handles rotation and flip
  window.transformImageData = function(imageLabel, operation, value, width, height) {
    if (!imageLabel) {
      // Fallback to current image label
      imageLabel = window.currentImageLabel;
      if (!imageLabel) {
        console.warn('[transformImageData] No image label provided and no current image');
        return;
      }
    }
        
    if (operation === 'rotate') {
      // Delegate solely to rotateImage; avoid mutating vector points to prevent double-rotation
      window.rotateImage(0, value);
    } else if (operation === 'flip') {
      // Simple flip implementation
      const canvas = document.getElementById('canvas');
      if (!canvas) {
        console.warn('[transformImageData] Canvas not found for flip');
        return;
      }
            
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
            
      if (window.vectorStrokesByImage && window.vectorStrokesByImage[imageLabel]) {
        const strokes = window.vectorStrokesByImage[imageLabel];
        Object.keys(strokes).forEach(strokeLabel => {
          const stroke = strokes[strokeLabel];
          if (stroke && stroke.points) {
            stroke.points = stroke.points.map(point => {
              if (value === 'horizontal') {
                return { x: centerX + (centerX - point.x), y: point.y };
              } else if (value === 'vertical') {
                return { x: point.x, y: centerY + (centerY - point.y) };
              }
              return point;
            });
          }
        });
                
        console.log(`[transformImageData] Flipped ${Object.keys(strokes).length} strokes ${value}`);
                
        // Save state and redraw
        if (typeof window.saveState === 'function') {
          window.saveState();
        }
        if (typeof window.redrawCanvasWithVisibility === 'function') {
          window.redrawCanvasWithVisibility();
        }
      }
    }
  };
    
  // Initialize color palette buttons
  const colorButtons = document.querySelectorAll('.color-btn');
  colorButtons.forEach(button => {
    button.addEventListener('click', () => {
      // Remove active class from all buttons
      colorButtons.forEach(btn => btn.classList.remove('active'));
            
      // Add active class to clicked button
      button.classList.add('active');
            
      // Set the drawing color
      const color = button.dataset.color;
      colorPicker.value = color;
      updateBrushSliderAccent();
            
      // Check if we have a stroke in edit mode
      if (window.selectedStrokeInEditMode) {
        const strokeLabel = window.selectedStrokeInEditMode;
                
        if (vectorStrokesByImage[currentImageLabel] && vectorStrokesByImage[currentImageLabel][strokeLabel]) {
          // Only change if different
          if (vectorStrokesByImage[currentImageLabel][strokeLabel].color !== color) {
            vectorStrokesByImage[currentImageLabel][strokeLabel].color = color;
                        
            // Push a single undo state for the color change
            saveState(true, false, false);
            redrawCanvasWithVisibility();
            updateStrokeVisibilityControls();
                        
            // Ensure the edit mode is still visible after updateStrokeVisibilityControls
            const editItem = document.querySelector(`.stroke-visibility-item[data-stroke="${strokeLabel}"]`);
            if (editItem) {
              editItem.dataset.editMode = 'true';
              editItem.setAttribute('data-edit-mode', 'true');
                            
              // Apply the orange styling directly to make it very visible
              editItem.style.backgroundColor = '#FFF3E0';
              editItem.style.borderLeft = '5px solid #FF9800';
              editItem.style.boxShadow = '0 3px 8px rgba(255, 152, 0, 0.3)';
                            
              // Remove edit mode indicator removal
            }
                        
            //                         console.log(`Changed color of stroke ${strokeLabel} to ${color}`);
          }
        }
      } else if (selectedStrokeByImage[currentImageLabel]) {
        // If there's a selected stroke but not in edit mode, show a message to the user
        //             console.log("Double-click a stroke to enter edit mode before changing colors");
            
        // Show a status message to the user
        const statusMessage = document.getElementById('statusMessage');
        if (statusMessage) {
          statusMessage.textContent = 'Double-click a stroke to enter edit mode first';
          statusMessage.classList.add('visible');
          // Hide message after a few seconds
          setTimeout(() => {
            statusMessage.classList.remove('visible');
          }, 3000);
        }
      }
      // If no stroke is in edit mode, the color is just set for new strokes
    });
  });
    
  // Add brush size input event listener
  brushSize.addEventListener('input', () => {
    const size = parseInt(brushSize.value);
    // Update progress (0..1) for Option A CSS
    const min = Number(brushSize.min) || 0;
    const max = Number(brushSize.max) || 100;
    const range = Math.max(max - min, 1);
    let p = (size >= max) ? 1 : Math.min(1, Math.max(0, (size - min) / range));
    // Keep both variables for compatibility with older CSS
    brushSize.style.setProperty('--p', String(p));
    brushSize.style.setProperty('--filled', (p === 1) ? '100%' : `${(p * 100).toFixed(2)}%`);
    brushSize.setAttribute('aria-valuenow', String(size));
        
    // Check if we have a stroke in edit mode
    if (window.selectedStrokeInEditMode) {
      const strokeLabel = window.selectedStrokeInEditMode;
            
      if (vectorStrokesByImage[currentImageLabel] && vectorStrokesByImage[currentImageLabel][strokeLabel]) {
        // Only change if different
        if (vectorStrokesByImage[currentImageLabel][strokeLabel].width !== size) {
          vectorStrokesByImage[currentImageLabel][strokeLabel].width = size;
                    
          // Push a single undo state for the thickness change
          saveState(true, false, false);
          redrawCanvasWithVisibility();
          updateStrokeVisibilityControls();
                    
          // Ensure the edit mode is still visible after updateStrokeVisibilityControls
          const editItem = document.querySelector(`.stroke-visibility-item[data-stroke="${strokeLabel}"]`);
          if (editItem) {
            editItem.dataset.editMode = 'true';
            editItem.setAttribute('data-edit-mode', 'true');
                        
            // Remove edit mode indicator removal
            if (!editItem.querySelector('.edit-mode-indicator')) {
              const editIndicator = document.createElement('div');
              editIndicator.className = 'edit-mode-indicator';
              editIndicator.innerHTML = '✏️ Edit Mode';
              editIndicator.style.position = 'absolute';
              editIndicator.style.top = '3px';
              editIndicator.style.right = '26px';
              editIndicator.style.fontSize = '10px';
              editIndicator.style.color = '#ff6600';
              editIndicator.style.fontWeight = 'bold';
              editItem.appendChild(editIndicator);
            }
          }
                    
          //                     console.log(`Changed thickness of stroke ${strokeLabel} to ${size}`);
        }
      }
    } else if (selectedStrokeByImage[currentImageLabel]) {
      // If there's a selected stroke but not in edit mode, show a message to the user
      //             console.log("Double-click a stroke to enter edit mode before changing thickness");
            
      // Show a status message to the user
      const statusMessage = document.getElementById('statusMessage');
      if (statusMessage) {
        statusMessage.textContent = 'Double-click a stroke to enter edit mode first';
        statusMessage.classList.add('visible');
        // Hide message after a few seconds
        setTimeout(() => {
          statusMessage.classList.remove('visible');
        }, 3000);
      }
    }
    // If no stroke is in edit mode, the thickness is just set for new strokes
  });
    
  // Function to move the image and its strokes
  function moveImage(deltaX, deltaY) {
    // Update position offset
    if (!imagePositionByLabel[currentImageLabel]) {
      imagePositionByLabel[currentImageLabel] = { x: 0, y: 0 };
    }
        
    // Store the old position (for debugging)
    const oldPos = { x: imagePositionByLabel[currentImageLabel].x, y: imagePositionByLabel[currentImageLabel].y };
        
    // Update the position
    imagePositionByLabel[currentImageLabel].x += deltaX;
    imagePositionByLabel[currentImageLabel].y += deltaY;
        
    // PERFORMANCE: Invalidate cache when position changes
    invalidateInteractiveElementCache();
        
    //         console.log(`[moveImage] Moving image ${currentImageLabel} by (${deltaX}, ${deltaY})`);
    //         console.log(`[moveImage] Position was (${oldPos.x}, ${oldPos.y}), now is (${imagePositionByLabel[currentImageLabel].x}, ${imagePositionByLabel[currentImageLabel].y})`);
        
    // Save current state before redrawing, using same pattern as updateImageScale
    // But don't save for small movements to avoid spamming undo stack during continuous dragging
    if (Math.abs(deltaX) > 20 || Math.abs(deltaY) > 20) {
      saveState(true, false, false);
    }
            
    // Set flag to prevent auto-focus during move operations
    window.isMovingImage = true;
            
    try {
      // Redraw the canvas (image and/or strokes) with updated position
      redrawCanvasWithVisibility();
    } finally {
      // Clear the flag after redraw completes
      window.isMovingImage = false;
            
      // Deselect all strokes after move operation
      deselectAllStrokes();
    }
  }
    
  // Handle WASD and zoom keyboard controls
  document.addEventListener('keydown', (e) => {
    // Don't process if user is typing in an input field
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      return;
    }
        
    // Don't process if user is editing a stroke name or measurement
    if (e.target.isContentEditable || 
            e.target.classList.contains('stroke-name') || 
            e.target.classList.contains('stroke-measurement')) {
      return;
    }
        
    // F5: Enhanced zoom controls with refined stroke-in-progress guards
    if (e.key === 'q' || e.key === 'Q') {
      e.preventDefault(); // Prevent any default browser behavior
            
      // F5: Refined guards - only block if stroke creation has actually progressed
      let shouldBlockZoom = false;
            
      if (drawingMode === 'freehand') {
        // Block only if mouse is down AND we have points (actual drawing has started)
        shouldBlockZoom = isDrawing && (points && points.length > 0);
      } else if (drawingMode === 'straight' || drawingMode === 'arrow') {
        // Block only if first point is placed AND actively positioning second point
        shouldBlockZoom = straightLineStart !== null && isDrawing;
      } else if (drawingMode === 'curved') {
        // Block if at least one control point is placed (positioning subsequent points)
        shouldBlockZoom = curvedLinePoints && curvedLinePoints.length > 0;
      }
                
      if (shouldBlockZoom) {
        //                 console.log(`[F5 Zoom Guard] Blocking zoom during active stroke creation - mode: ${drawingMode}, drawing: ${isDrawing}, progress detected`);
        return; // Block zoom during active stroke creation
      }
            
      // Zoom out - find the next smaller scale
      const currentScale = window.imageScaleByLabel[currentImageLabel];
      const scales = [0.1, 0.15, 0.2, 0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
      let nextScale = 0.1; // Minimum scale
            
      for (let i = scales.length - 1; i >= 0; i--) {
        if (scales[i] < currentScale) {
          nextScale = scales[i];
          break;
        }
      }
            
      //             console.log(`[Zoom Out] Applying zoom from ${currentScale} to ${nextScale}`);
      updateImageScale(nextScale);
            
    } else if (e.key === 'e' || e.key === 'E') {
      e.preventDefault(); // Prevent any default browser behavior
            
      // F5: Refined guards - only block if stroke creation has actually progressed
      let shouldBlockZoom = false;
            
      if (drawingMode === 'freehand') {
        // Block only if mouse is down AND we have points (actual drawing has started)
        shouldBlockZoom = isDrawing && (points && points.length > 0);
      } else if (drawingMode === 'straight' || drawingMode === 'arrow') {
        // Block only if first point is placed AND actively positioning second point
        shouldBlockZoom = straightLineStart !== null && isDrawing;
      } else if (drawingMode === 'curved') {
        // Block if at least one control point is placed (positioning subsequent points)
        shouldBlockZoom = curvedLinePoints && curvedLinePoints.length > 0;
      }
                
      if (shouldBlockZoom) {
        //                 console.log(`[F5 Zoom Guard] Blocking zoom during active stroke creation - mode: ${drawingMode}, drawing: ${isDrawing}, progress detected`);
        return; // Block zoom during active stroke creation
      }
            
      // Zoom in - find the next larger scale
      const currentScale = window.imageScaleByLabel[currentImageLabel];
      const scales = [0.1, 0.15, 0.2, 0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
      let nextScale = 5; // Maximum scale
            
      for (let i = 0; i < scales.length; i++) {
        if (scales[i] > currentScale) {
          nextScale = scales[i];
          break;
        }
      }
            
      //             console.log(`[Zoom In] Applying zoom from ${currentScale} to ${nextScale}`);
      updateImageScale(nextScale);
    }
        
    // Movement controls with inverted W/S as requested
    const moveStep = 10; // Pixels to move per keypress
        
    if (e.key === 'w' || e.key === 'W') {
      moveImage(0, moveStep); // Move DOWN (inverted)
    } else if (e.key === 'd' || e.key === 'D') {
      moveImage(-moveStep, 0); // Move left
    } else if (e.key === 's' || e.key === 'S') {
      moveImage(0, -moveStep); // Move UP (inverted)
    } else if (e.key === 'a' || e.key === 'A') {
      moveImage(moveStep, 0); // Move right
    }
  });
    
  // Update active scale option on image change
  function updateScaleUI() {
    updateScaleButtonsActiveState();
        
    // Update dropdown button text
    const scale = window.imageScaleByLabel[currentImageLabel] || 1.0;
    const scaleButton = document.getElementById('scaleButton');
    if (scaleButton) {
      const pct = Math.round(scale * 100);
      scaleButton.innerHTML = `Scale: ${pct}% <svg class="inline w-3 h-3 -mt-0.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M5.25 7.5l4.5 4.5 4.5-4.5H5.25z"/></svg>`;
    }
        
    // ADDED: Update the sidebar thumbnail scale display for the current image
    const sidebarScaleElement = document.getElementById(`scale-${currentImageLabel}`);
    if (sidebarScaleElement) {
      sidebarScaleElement.textContent = `Scale: ${Math.round(scale * 100)}%`;
      //             console.log(`[updateScaleUI] Updated sidebar scale display for ${currentImageLabel} to ${Math.round(scale * 100)}%`);
    }
  }
    
  updateScaleUI();
    
  // Make sidebars draggable
  function makeDraggable(element, handle) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        
    handle.onmousedown = dragMouseDown;
        
    function dragMouseDown(e) {
      e.preventDefault();
      // Get the mouse cursor position at startup
      pos3 = e.clientX;
      pos4 = e.clientY;
      document.onmouseup = closeDragElement;
      // Call a function whenever the cursor moves
      document.onmousemove = elementDrag;
    }
        
    function elementDrag(e) {
      e.preventDefault();
      // Calculate the new cursor position
      pos1 = pos3 - e.clientX;
      pos2 = pos4 - e.clientY;
      pos3 = e.clientX;
      pos4 = e.clientY;
      // Set the element's new position
      element.style.top = (element.offsetTop - pos2) + 'px';
      element.style.left = (element.offsetLeft - pos1) + 'px';
            
      // Remove right position if we're dragging the image sidebar
      if (element === imageSidebar) {
        element.style.right = 'auto';
      }
    }
        
    function closeDragElement() {
      // Stop moving when mouse button is released
      document.onmouseup = null;
      document.onmousemove = null;
    }
  }
    
  // Make both sidebars draggable (handled by new UI controller script)
  // makeDraggable(strokeSidebar, strokeSidebarHeader);
  // makeDraggable(imageSidebar, imageSidebarHeader);
    
  // DRAG AND DROP SETUP - MODIFIED TO USE DOCUMENT LISTENERS
  function setupDragAndDrop() {
    const docBody = document.body; // Target body or document for broader event capture

    docBody.addEventListener('dragover', (e) => {
      // Check if the target is the canvas or related to our app area
      if (e.target === canvas || canvas.contains(e.target)) {
        e.preventDefault();
        e.stopPropagation();
        canvas.classList.add('drag-over');
        //                  console.log('[Drag and Drop] dragover event on canvas target.');
      } else {
        // If dragging over other parts of the document, ensure default is not prevented
        // unless we specifically want to handle drops elsewhere. For now, only canvas.
        canvas.classList.remove('drag-over'); // Ensure it's removed if not over canvas
      }
    });

    docBody.addEventListener('dragleave', (e) => {
      // Check if leaving the canvas area or a related child
      if (e.target === canvas || canvas.contains(e.target) || !document.body.contains(e.relatedTarget) || !canvas.contains(e.relatedTarget)) {
        e.preventDefault();
        e.stopPropagation();
        canvas.classList.remove('drag-over');
        //                 console.log('[Drag and Drop] dragleave event.');
      }
    });

    docBody.addEventListener('drop', (e) => {
      if (e.target === canvas || canvas.contains(e.target)) {
        e.preventDefault();
        e.stopPropagation();
        canvas.classList.remove('drag-over');
        //                 console.log('[Drag and Drop] drop event on canvas target.');
                
        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
          //                     console.log(`[Drag and Drop] ${files.length} files dropped.`);
          handleFiles(files);
        } else {
          //                     console.log('[Drag and Drop] No files found in drop event.');
        }
      } else {
        //                  console.log('[Drag and Drop] drop event on non-canvas target, ignoring.');
      }
    });
    //         console.log('[setupDragAndDrop] Drag and drop listeners initialized on document body, targeting canvas.');
  }

  // Call setupDragAndDrop on DOMContentLoaded
  setupDragAndDrop();
    
  // MOUSE WHEEL ZOOM FUNCTIONALITY
  function onCanvasWheel(e) {
    // Note: Cannot call preventDefault() in passive listener
    // The wheel event is marked passive: true for performance
    e.stopPropagation(); // Prevent event bubbling
        
    // Guard against zooming during stroke creation (same as Q/E key guards)
    let shouldBlockZoom = false;
        
    if (drawingMode === 'freehand') {
      shouldBlockZoom = isDrawing && (points && points.length > 0);
    } else if (drawingMode === 'straight' || drawingMode === 'arrow') {
      shouldBlockZoom = straightLineStart !== null && isDrawing;
    } else if (drawingMode === 'curved') {
      shouldBlockZoom = curvedLinePoints && curvedLinePoints.length > 0;
    }
        
    if (shouldBlockZoom) {
      //             console.log(`[Mouse Wheel Zoom Guard] Blocking zoom during active stroke creation.`);
      return;
    }
        
    // Get mouse position for zoom centering
    const mouseX = e.offsetX;
    const mouseY = e.offsetY;
        
    // Convert mouse position to image coordinates before zoom
    const imagePointBeforeZoom = toImage({ x: mouseX, y: mouseY });
        
    // Determine zoom direction and find next scale
    const currentScale = window.imageScaleByLabel[currentImageLabel];
    const scales = [0.1, 0.15, 0.2, 0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
    let nextScale = currentScale;
        
    if (e.deltaY < 0) {
      // Zoom in (mouse wheel up/forward)
      for (let i = 0; i < scales.length; i++) {
        if (scales[i] > currentScale) {
          nextScale = scales[i];
          break;
        }
      }
    } else if (e.deltaY > 0) {
      // Zoom out (mouse wheel down/backward)
      for (let i = scales.length - 1; i >= 0; i--) {
        if (scales[i] < currentScale) {
          nextScale = scales[i];
          break;
        }
      }
    }
        
    // Only proceed if we found a different scale
    if (nextScale !== currentScale) {
      //             console.log(`[Mouse Wheel Zoom] Zooming from ${currentScale} to ${nextScale} centered at (${mouseX}, ${mouseY})`);
            
      // Store current position before zoom
      const currentPosition = imagePositionByLabel[currentImageLabel] || { x: 0, y: 0 };
            
      // Calculate what the position adjustment should be for zoom centering
      const scaleRatio = nextScale / currentScale;
      const canvasCenter = { x: canvas.width / 2, y: canvas.height / 2 };
      
      // Calculate position adjustment to keep mouse point centered
      const deltaX = (mouseX - canvasCenter.x - currentPosition.x) * (1 - scaleRatio);
      const deltaY = (mouseY - canvasCenter.y - currentPosition.y) * (1 - scaleRatio);
      
      // Apply both scale and position changes atomically
      window.imageScaleByLabel[currentImageLabel] = nextScale;
      
      // Initialize image position if not set
      if (!imagePositionByLabel[currentImageLabel]) {
        imagePositionByLabel[currentImageLabel] = { x: 0, y: 0 };
      }
      
      // Adjust position for zoom centering
      imagePositionByLabel[currentImageLabel].x += deltaX;
      imagePositionByLabel[currentImageLabel].y += deltaY;
      
      // Update UI and redraw once with both changes applied
      updateScaleUI();
      redrawCanvasWithVisibility();
    }
  }
    
  // Adjust canvas size when window resizes to account for sidebars
  window.addEventListener('resize', () => {
    resizeCanvas();
        
    // Check if sidebars are overlapping canvas and adjust if needed
    const canvasRect = canvas.getBoundingClientRect();
    const imageSidebar = document.getElementById('imageSidebar'); // Get elements directly
    const strokeSidebar = document.getElementById('strokeSidebar');

    if (imageSidebar && strokeSidebar) { // Check if elements exist
      const imageSidebarRect = imageSidebar.getBoundingClientRect();
      const strokeSidebarRect = strokeSidebar.getBoundingClientRect();
            
      // If image sidebar is overlapping canvas on the right
      if (imageSidebarRect.left < canvasRect.right && imageSidebarRect.right > canvasRect.left) { // Added check for actual overlap
        imageSidebar.style.left = 'auto'; // Reset left
        imageSidebar.style.right = '20px';
      }
            
      // If stroke sidebar is overlapping canvas on the left
      if (strokeSidebarRect.right > canvasRect.left && strokeSidebarRect.left < canvasRect.right) { // Added check for actual overlap
        strokeSidebar.style.left = '20px';
      }
    }
  });

  // Function to find an optimal position for a label
  function findOptimalLabelPosition(labelRect, anchorPoint, strokeInfo) {
    // Parameters for positioning
    const MAX_TRIES = 12;
    const MAX_DISTANCE = 500; // Increased maximum distance from anchor point for more freedom
    const MIN_DISTANCE = 10;  // Reduced minimum distance from anchor point

    // Create a copy of the initial rect
    let bestRect = { ...labelRect };
    let bestScore = -Infinity;
        
    // Keep track of how many other labels each position would impact
    let bestImpactCount = Infinity;
        
    // Check if the stroke is a horizontal line (for straight line strokes)
    let isHorizontalLine = false;
    if (strokeInfo && strokeInfo.path && strokeInfo.path.length >= 2) {
      const p1 = strokeInfo.path[0];
      const p2 = strokeInfo.path[strokeInfo.path.length - 1];
            
      // Calculate angle of the line
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;
            
      // Check if it's approximately horizontal (within 15 degrees)
      isHorizontalLine = Math.abs(angle) < 15 || Math.abs(angle) > 165;
    }
        
    // Try different positions in a radial pattern
    for (let angle = 0; angle < 360; angle += 30) {
      for (let distance = MIN_DISTANCE; distance <= MAX_DISTANCE; distance += 20) {
        const radians = angle * (Math.PI / 180);
        const offsetX = Math.cos(radians) * distance;
        const offsetY = Math.sin(radians) * distance;
                
        const candidateRect = {
          ...labelRect,
          x: anchorPoint.x + offsetX,
          y: anchorPoint.y + offsetY - labelRect.height,
        };
                
        // Ensure the label stays within canvas bounds
        // candidateRect.x = Math.max(10, Math.min(canvas.width - labelRect.width - 10, candidateRect.x));
        // candidateRect.y = Math.max(10, Math.min(canvas.height - labelRect.height - 10, candidateRect.y));
                
        // Count how many existing labels this position would overlap with
        let impactCount = 0;
        for (const existingLabel of currentLabelPositions) {
          if (rectsOverlap(candidateRect, existingLabel)) {
            impactCount++;
          }
        }
                
        // Score this position
        let score = evaluateLabelPosition(candidateRect, anchorPoint, strokeInfo);
                
        // For horizontal lines, boost the score for bottom-center positions (180 degrees)
        if (isHorizontalLine && angle === 180) {
          score += 0.3; // Significant boost for bottom-center position
        }
                
        // Prioritize positions with minimal impact on other labels
        if (impactCount < bestImpactCount || 
                    (impactCount === bestImpactCount && score > bestScore)) {
          bestImpactCount = impactCount;
          bestScore = score;
          bestRect = { ...candidateRect };
        }
                
        // If we found a position that affects no other labels and has a good score, prioritize it
        if (impactCount === 0 && score > 0.6) {
          // For horizontal lines, if this is the bottom-center position and it's good, immediately return it
          if (isHorizontalLine && angle === 180 && score > 0.8) {
            return candidateRect;
          }
          return bestRect;
        }
      }
    }
        
    return bestRect;
  }
    
  // Function to evaluate how good a label position is (0-1, higher is better)
  function evaluateLabelPosition(rect, anchorPoint, strokeInfo) {
    let score = 1.0; // Start with perfect score
        
    // Distance from anchor point (penalize being too far away)
    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;
    const distance = Math.sqrt(
      Math.pow(centerX - anchorPoint.x, 2) + 
            Math.pow(centerY - anchorPoint.y, 2)
    );
        
    // Normalize distance penalty (0-0.2) - reduced penalty to allow more freedom
    const distancePenalty = Math.min(0.2, (distance / 500) * 0.2);
    score -= distancePenalty;
        
    // Prefer positions to the right or above (slight preference)
    if (rect.x + rect.width < anchorPoint.x || rect.y > anchorPoint.y) {
      score -= 0.1; // Small penalty for less preferred positions
    }
        
    // Severe penalty for overlapping with any other label
    for (const otherRect of currentLabelPositions) {
      if (rectsOverlap(rect, otherRect)) {
        // Apply even higher penalty for overlapping with user-positioned labels
        const isUserPositioned = customLabelPositions[currentImageLabel] && 
                                         customLabelPositions[currentImageLabel][otherRect.strokeLabel];
                
        score -= isUserPositioned ? 0.7 : 0.5; // Higher penalty for user-positioned labels
      }
    }
        
    // Severe penalty for overlapping with lines
    for (const path of currentStrokePaths) {
      if (path.label !== strokeInfo.label) { // Don't check against our own path
        for (let i = 1; i < path.path.length; i++) {
          const p1 = path.path[i-1];
          const p2 = path.path[i];
          if (rectIntersectsLine(rect, p1, p2, path.width)) {
            score -= 0.6; // Major penalty for overlapping lines
            break;
          }
        }
      }
    }
        
    // Penalty for being too close to edge of canvas
    const edgeMargin = 20;
    if (rect.x < edgeMargin || rect.y < edgeMargin || 
            rect.x + rect.width > canvas.width - edgeMargin || 
            rect.y + rect.height > canvas.height - edgeMargin) {
      score -= 0.2; // Minor penalty for being too close to edge
    }
        
    return Math.max(0, score); // Ensure score is not negative
  }
    
  // Function to check if a rectangle intersects with a line segment
  function rectIntersectsLine(rect, p1, p2, lineWidth = 1) {
    // Expand rectangle slightly to account for line width
    const expandedRect = {
      x: rect.x - lineWidth/2,
      y: rect.y - lineWidth/2,
      width: rect.width + lineWidth,
      height: rect.height + lineWidth
    };
        
    // Check if either endpoint is inside the rectangle
    if (pointInRect(p1, expandedRect) || pointInRect(p2, expandedRect)) {
      return true;
    }
        
    // Check if the line intersects any of the rectangle's edges
    const rectLines = [
      {p1: {x: expandedRect.x, y: expandedRect.y}, p2: {x: expandedRect.x + expandedRect.width, y: expandedRect.y}},
      {p1: {x: expandedRect.x + expandedRect.width, y: expandedRect.y}, p2: {x: expandedRect.x + expandedRect.width, y: expandedRect.y + expandedRect.height}},
      {p1: {x: expandedRect.x + expandedRect.width, y: expandedRect.y + expandedRect.height}, p2: {x: expandedRect.x, y: expandedRect.y + expandedRect.height}},
      {p1: {x: expandedRect.x, y: expandedRect.y + expandedRect.height}, p2: {x: expandedRect.x, y: expandedRect.y}}
    ];
        
    for (const rectLine of rectLines) {
      if (lineIntersectsLine(p1, p2, rectLine.p1, rectLine.p2)) {
        return true;
      }
    }
        
    return false;
  }
    
  // Function to check if a point is inside a rectangle
  function pointInRect(point, rect) {
    return (
      point.x >= rect.x &&
            point.x <= rect.x + rect.width &&
            point.y >= rect.y &&
            point.y <= rect.y + rect.height
    );
  }
    
  // Function to check if two line segments intersect
  function lineIntersectsLine(l1p1, l1p2, l2p1, l2p2) {
    // Calculate direction vectors
    const v1 = {x: l1p2.x - l1p1.x, y: l1p2.y - l1p1.y};
    const v2 = {x: l2p2.x - l2p1.x, y: l2p2.y - l2p1.y};
        
    // Calculate determinant
    const det = v1.x * v2.y - v1.y * v2.x;
        
    // Lines are parallel if determinant is zero
    if (Math.abs(det) < 0.0001) return false;
        
    // Calculate vector from l1p1 to l2p1
    const v3 = {x: l2p1.x - l1p1.x, y: l2p1.y - l1p1.y};
        
    // Calculate intersection parameters
    const t1 = (v3.x * v2.y - v3.y * v2.x) / det;
    const t2 = (v3.x * v1.y - v3.y * v1.x) / det;
        
    // Check if intersection point is within both line segments
    return (t1 >= 0 && t1 <= 1 && t2 >= 0 && t2 <= 1);
  }

  // Function to calculate the intersection point of two line segments
  function lineIntersection(x1, y1, x2, y2, x3, y3, x4, y4) {
    // Calculate direction vectors
    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
        
    // Lines are parallel if denominator is zero
    if (Math.abs(denom) < 0.0001) return null;
        
    // Calculate intersection parameters
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
        
    // Check if intersection point is within both line segments
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
      return {
        x: x1 + t * (x2 - x1),
        y: y1 + t * (y2 - y1)
      };
    }
        
    return null; // No intersection within segments
  }
    
  // Calculate where a line intersects with a rotated rectangle
  function calculateCurveRectangleIntersection(startPoint, rectCenter, rectWidth, rectHeight, rotation) {
    // Define rectangle corners in local space (relative to center)
    const halfWidth = rectWidth / 2;
    const halfHeight = rectHeight / 2;
    const corners = [
      { x: -halfWidth, y: -halfHeight }, // top-left
      { x: halfWidth, y: -halfHeight },  // top-right
      { x: halfWidth, y: halfHeight },   // bottom-right
      { x: -halfWidth, y: halfHeight }   // bottom-left
    ];
    
    // Rotate corners and translate to world space
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const rotatedCorners = corners.map(corner => ({
      x: rectCenter.x + (corner.x * cos - corner.y * sin),
      y: rectCenter.y + (corner.x * sin + corner.y * cos)
    }));
    
    // Define the four edges of the rotated rectangle
    const edges = [
      [rotatedCorners[0], rotatedCorners[1]], // top edge
      [rotatedCorners[1], rotatedCorners[2]], // right edge  
      [rotatedCorners[2], rotatedCorners[3]], // bottom edge
      [rotatedCorners[3], rotatedCorners[0]]  // left edge
    ];
    
    // Extend line from startPoint through rectCenter to find intersection
    // Calculate direction vector from start to center
    const dx = rectCenter.x - startPoint.x;
    const dy = rectCenter.y - startPoint.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    
    if (length < 0.001) {
      // Start point is too close to center, return center
      return rectCenter;
    }
    
    // Normalize direction vector
    const dirX = dx / length;
    const dirY = dy / length;
    
    // Extend line far beyond the rectangle to ensure intersection
    const extensionLength = Math.max(rectWidth, rectHeight) * 2;
    const extendedPoint = {
      x: startPoint.x + dirX * (length + extensionLength),
      y: startPoint.y + dirY * (length + extensionLength)
    };
    
    // Find intersection with each edge
    let closestIntersection = null;
    let closestDistance = Infinity;
    
    for (const [edgeStart, edgeEnd] of edges) {
      const intersection = lineIntersection(
        startPoint.x, startPoint.y, 
        extendedPoint.x, extendedPoint.y,
        edgeStart.x, edgeStart.y,
        edgeEnd.x, edgeEnd.y
      );
      
      if (intersection) {
        // Calculate distance from start point to intersection
        const distToIntersection = Math.sqrt(
          Math.pow(intersection.x - startPoint.x, 2) + 
          Math.pow(intersection.y - startPoint.y, 2)
        );
        
        // Use the closest intersection point that's closer than the center
        if (distToIntersection < length && distToIntersection < closestDistance) {
          closestDistance = distToIntersection;
          closestIntersection = intersection;
        }
      }
    }
    
    // Return closest intersection or center as fallback
    return closestIntersection || rectCenter;
  }

  // Function to draw a connector line between the label and the stroke
  function drawLabelConnector(labelRect, anchorPoint, strokeColor) {
    // Don't use the provided anchorPoint - we'll find the best one based on the stroke
    // Just keep it as a fallback if we can't find the stroke info
    const originalAnchorPoint = anchorPoint;
        
    // labelRect.x,y is the CENTER now (center-anchored labels)
    const labelCenter = { x: labelRect.x, y: labelRect.y };
    const rectX = labelCenter.x - labelRect.width / 2;
    const rectY = labelCenter.y - labelRect.height / 2;
    
    // Get current rotation to rotate anchor points to match visual label orientation
    const currentImageLabel = window.currentImageLabel || window.paintApp?.state?.currentImageLabel || 'front';
    const transformParams = getTransformationParams(currentImageLabel);
    const rotation = transformParams.hasImage && transformParams.rotation ? transformParams.rotation : 0;
    
    // Calculate 9 anchor points in local (unrotated) space relative to center
    const localAnchorPoints = [
      // Top row
      { x: -labelRect.width / 2, y: -labelRect.height / 2 }, // Top-left
      { x: 0, y: -labelRect.height / 2 }, // Top-center
      { x: labelRect.width / 2, y: -labelRect.height / 2 }, // Top-right
            
      // Middle row
      { x: -labelRect.width / 2, y: 0 }, // Middle-left
      { x: 0, y: 0 }, // Center
      { x: labelRect.width / 2, y: 0 }, // Middle-right
            
      // Bottom row
      { x: -labelRect.width / 2, y: labelRect.height / 2 }, // Bottom-left
      { x: 0, y: labelRect.height / 2 }, // Bottom-center
      { x: labelRect.width / 2, y: labelRect.height / 2 } // Bottom-right
    ];
    
    // Rotate anchor points and translate to world position
    const anchorPoints = localAnchorPoints.map(point => {
      if (Math.abs(rotation) < 0.001) {
        // No rotation - use direct translation
        return {
          x: labelCenter.x + point.x,
          y: labelCenter.y + point.y
        };
      } else {
        // Apply rotation around label center
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        const rotatedX = point.x * cos - point.y * sin;
        const rotatedY = point.x * sin + point.y * cos;
        return {
          x: labelCenter.x + rotatedX,
          y: labelCenter.y + rotatedY
        };
      }
    });
        
    // Find closest anchor point to the stroke anchor point
    let closestDist = Infinity;
    let exitPoint = anchorPoints[0];
        
    anchorPoints.forEach(point => {
      const dist = Math.sqrt(
        Math.pow(point.x - anchorPoint.x, 2) + 
                Math.pow(point.y - anchorPoint.y, 2)
      );
            
      if (dist < closestDist) {
        closestDist = dist;
        exitPoint = point;
      }
    });
        
    // For the stroke side, use three possible anchor points and find the closest
    // This requires stroke info which we can get from currentStrokePaths
    const strokeLabel = labelRect.strokeLabel;
    const strokePathInfo = currentStrokePaths.find(p => p.label === strokeLabel);
        
    if (strokePathInfo && strokePathInfo.path && strokePathInfo.path.length > 1) {
      // Debug the path structure to see all points
      //             console.log(`[drawLabelConnector] PathInfo for ${strokeLabel}:`, 
      //                         JSON.stringify({
      //                             length: strokePathInfo.path.length,
      //                             first: strokePathInfo.path[0],
      //                             last: strokePathInfo.path[strokePathInfo.path.length - 1]
      //                         }));
            
      // Use start, middle, and end points of the stroke
      const startPoint = strokePathInfo.path[0]; // First point
      const endPoint = strokePathInfo.path[strokePathInfo.path.length - 1]; // Last point
            
      // For straight lines or freehand strokes, calculate a true midpoint
      let middlePoint;
            
      if (strokePathInfo.path.length === 2) {
        // For straight lines, we need to make the midpoint very clearly defined
                
        // Step 1: Calculate the geometric midpoint
        middlePoint = {
          x: (startPoint.x + endPoint.x) / 2,
          y: (startPoint.y + endPoint.y) / 2
        };
                
        // For straight lines, we'll use the exact geometric midpoint
        // without any offset to ensure accuracy
        const lineLength = Math.sqrt(
          Math.pow(endPoint.x - startPoint.x, 2) + 
                    Math.pow(endPoint.y - startPoint.y, 2)
        );
                
        //                 console.log(`[drawLabelConnector] Using calculated midpoint for straight line: (${middlePoint.x}, ${middlePoint.y})`);
      } else {
        // For freehand, calculate the true geometric midpoint based on path length
        // First, calculate the total path length
        let totalLength = 0;
        let segmentLengths = [];
                
        for (let i = 1; i < strokePathInfo.path.length; i++) {
          const p1 = strokePathInfo.path[i-1];
          const p2 = strokePathInfo.path[i];
          const segmentLength = Math.sqrt(
            Math.pow(p2.x - p1.x, 2) + 
                        Math.pow(p2.y - p1.y, 2)
          );
          segmentLengths.push(segmentLength);
          totalLength += segmentLength;
        }
                
        // Find the midpoint by distance (not by index)
        let currentLength = 0;
        let midpointIdx = 0;
        let midpointFraction = 0;
                
        // Find the segment that contains the midpoint
        for (let i = 0; i < segmentLengths.length; i++) {
          if (currentLength + segmentLengths[i] >= totalLength / 2) {
            midpointIdx = i;
            midpointFraction = (totalLength / 2 - currentLength) / segmentLengths[i];
            break;
          }
          currentLength += segmentLengths[i];
        }
                
        // Calculate the actual midpoint by interpolating between points
        const p1 = strokePathInfo.path[midpointIdx];
        const p2 = strokePathInfo.path[midpointIdx + 1];
                
        middlePoint = {
          x: p1.x + (p2.x - p1.x) * midpointFraction,
          y: p1.y + (p2.y - p1.y) * midpointFraction
        };
                
        //                 console.log(`[drawLabelConnector] Using true geometric midpoint for freehand: (${middlePoint.x.toFixed(1)}, ${middlePoint.y.toFixed(1)})`);
      }
            
      // Calculate distances to each point
      const distToStart = Math.sqrt(
        Math.pow(exitPoint.x - startPoint.x, 2) + 
                Math.pow(exitPoint.y - startPoint.y, 2)
      );
      const distToMiddle = Math.sqrt(
        Math.pow(exitPoint.x - middlePoint.x, 2) + 
                Math.pow(exitPoint.y - middlePoint.y, 2)
      );
      const distToEnd = Math.sqrt(
        Math.pow(exitPoint.x - endPoint.x, 2) + 
                Math.pow(exitPoint.y - endPoint.y, 2)
      );
            
      //             console.log(`[drawLabelConnector] Distances for ${strokeLabel} - Start: ${distToStart.toFixed(2)}, Middle: ${distToMiddle.toFixed(2)}, End: ${distToEnd.toFixed(2)}`);
            
      // Find the closest point
      let closestPoint = middlePoint;
      let minDist = distToMiddle;
      let anchorType = 'middle';
            
      if (distToStart < minDist) {
        closestPoint = startPoint;
        minDist = distToStart;
        anchorType = 'start';
      }
            
      if (distToEnd < minDist) {
        closestPoint = endPoint;
        anchorType = 'end';
      }
            
      //             console.log(`[drawLabelConnector] Using ${anchorType} anchor for ${strokeLabel} at: (${closestPoint.x}, ${closestPoint.y})`);
            
      // Use the closest point instead of the original anchor
      anchorPoint = closestPoint;
    } else {
      //             console.log(`[drawLabelConnector] No path info found for ${strokeLabel}, using original anchor: (${originalAnchorPoint.x}, ${originalAnchorPoint.y})`);
      // Use the original point since we don't have path info
      anchorPoint = originalAnchorPoint;
    }
        
    // Draw a curved connecting line that intersects exactly with the rotated label edge
    const curveIntersection = calculateCurveRectangleIntersection(
      anchorPoint, 
      labelCenter, 
      labelRect.width, 
      labelRect.height, 
      rotation
    );
    
    if (curveIntersection) {
      // Draw straight line from stroke anchor to exact edge intersection
      ctx.beginPath();
      ctx.moveTo(anchorPoint.x, anchorPoint.y);
      ctx.lineTo(curveIntersection.x, curveIntersection.y);
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]); // Dotted line
      ctx.stroke();
      ctx.setLineDash([]); // Reset to solid line
    } else {
      // Fallback to straight line if intersection calculation fails
      ctx.beginPath();
      ctx.moveTo(exitPoint.x, exitPoint.y);
      ctx.lineTo(anchorPoint.x, anchorPoint.y);
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]); // Dotted line
      ctx.stroke();
      ctx.setLineDash([]); // Reset to solid line
    }
        
    // If we're using a midpoint anchor, draw a small circle to indicate the connection point
    if (strokePathInfo && strokePathInfo.path && strokePathInfo.path.length > 1) {
      const startPoint = strokePathInfo.path[0];
      const endPoint = strokePathInfo.path[strokePathInfo.path.length - 1];
            
      // Determine which point is being used as anchor
      let anchorType = 'unknown';
      if (Math.abs(anchorPoint.x - startPoint.x) < 0.01 && Math.abs(anchorPoint.y - startPoint.y) < 0.01) {
        anchorType = 'start';
      } else if (Math.abs(anchorPoint.x - endPoint.x) < 0.01 && Math.abs(anchorPoint.y - endPoint.y) < 0.01) {
        anchorType = 'end';
      } else {
        anchorType = 'middle';
      }
      //             console.log(`[drawLabelConnector] Anchor type: ${anchorType} for ${strokeLabel}`);
            
      // For midpoints, draw a more prominent indicator
      if (anchorType === 'middle') {
        // Draw a small filled circle for the midpoint
        const radius = 3;
        ctx.beginPath();
        ctx.arc(anchorPoint.x, anchorPoint.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = strokeColor;
        ctx.fill();
                
        // Add a white halo for better visibility
        ctx.beginPath();
        ctx.arc(anchorPoint.x, anchorPoint.y, radius + 2, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.lineWidth = 2;
        ctx.stroke();
                
        // Then add a colored border
        ctx.beginPath();
        ctx.arc(anchorPoint.x, anchorPoint.y, radius + 2, 0, Math.PI * 2);
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }
    
  // Helper function to check if two rectangles overlap
  function rectsOverlap(rect1, rect2) {
    return (
      rect1.x < rect2.x + rect2.width &&
            rect1.x + rect1.width > rect2.x &&
            rect1.y < rect2.y + rect2.height &&
            rect1.y + rect1.height > rect2.y
    );
  }
    
  // Helper function to check if a point is on or near a stroke
  function checkForStrokeAtPoint(x, y) {
    // Only check visible strokes
    const strokes = lineStrokesByImage[currentImageLabel] || [];
        
    // Get current image scale and position for coordinate transforms
    const scale = window.imageScaleByLabel[currentImageLabel] || 1;
        
    // Calculate image position for coordinate transforms
    let imageWidth = canvas.width;
    let imageHeight = canvas.height;
    let imageX, imageY;
        
    // Try to get original image dimensions if available
    if (window.originalImages && window.originalImages[currentImageLabel]) {
      const cachedImg = imageCache[window.originalImages[currentImageLabel]];
      if (cachedImg) {
        imageWidth = cachedImg.width;
        imageHeight = cachedImg.height;
                
        // Calculate position based on image dimensions
        imageX = (canvas.width - imageWidth * scale) / 2 + 
                        (imagePositionByLabel[currentImageLabel]?.x || 0);
        imageY = (canvas.height - imageHeight * scale) / 2 + 
                        (imagePositionByLabel[currentImageLabel]?.y || 0);
      } else {
        // Image not yet loaded, use canvas center as reference
        imageX = canvas.width / 2 + (imagePositionByLabel[currentImageLabel]?.x || 0);
        imageY = canvas.height / 2 + (imagePositionByLabel[currentImageLabel]?.y || 0);
      }
    } else {
      // No image, use canvas center as reference point
      imageX = canvas.width / 2 + (imagePositionByLabel[currentImageLabel]?.x || 0);
      imageY = canvas.height / 2 + (imagePositionByLabel[currentImageLabel]?.y || 0);
    }
        
    // Adjust max distance based on scale
    const baseMaxDistance = 10; // Base distance in pixels for hit detection
    const scaledMaxDistance = baseMaxDistance / scale;
        
    // Special handling for straight lines which are more prone to detection issues
    let closestMatch = null;
    let closestDistance = Number.MAX_VALUE;
        
    // First pass - check all strokes to find the closest one
    for (const strokeLabel of strokes) {
      const isVisible = strokeVisibilityByImage[currentImageLabel] && 
                              strokeVisibilityByImage[currentImageLabel][strokeLabel];
      if (!isVisible) continue;
            
      // Check vector data
      if (vectorStrokesByImage[currentImageLabel] && 
                vectorStrokesByImage[currentImageLabel][strokeLabel]) {
                
        const vectorData = vectorStrokesByImage[currentImageLabel][strokeLabel];
        if (!vectorData.points || vectorData.points.length === 0) continue;
                
        const strokeWidth = (vectorData.width || 5) * scale;
        const maxDistance = Math.max(strokeWidth + 5, baseMaxDistance); // Add padding for easier selection
                
        // For straight lines, check if point is near the line
        if (vectorData.type === 'straight' || vectorData.points.length === 2) {
          const p1 = vectorData.points[0];
          const p2 = vectorData.points[vectorData.points.length - 1];
                    
          // Transform the coordinates based on image scale and position
          const x1 = imageX + (p1.x * scale);
          const y1 = imageY + (p1.y * scale);
          const x2 = imageX + (p2.x * scale);
          const y2 = imageY + (p2.y * scale);
                    
          // Calculate distance to this line
          const distance = pointDistanceToLine(x, y, x1, y1, x2, y2);
                    
          // If this is closer than our previous closest line, update
          if (distance <= maxDistance && distance < closestDistance) {
            closestDistance = distance;
            closestMatch = { label: strokeLabel, type: 'straight', distance };
          }
        } else if (vectorData.type === 'curved') {
          // For curved lines, check each segment of the interpolated curve
          for (let i = 1; i < vectorData.points.length; i++) {
            const p1 = vectorData.points[i-1];
            const p2 = vectorData.points[i];
                        
            // Transform the coordinates based on image scale and position
            const x1 = imageX + (p1.x * scale);
            const y1 = imageY + (p1.y * scale);
            const x2 = imageX + (p2.x * scale);
            const y2 = imageY + (p2.y * scale);
                        
            // Calculate distance to this curve segment
            const distance = pointDistanceToLine(x, y, x1, y1, x2, y2);
                        
            // If this is closer than our previous closest segment, update
            if (distance <= maxDistance && distance < closestDistance) {
              closestDistance = distance;
              closestMatch = { label: strokeLabel, type: 'curved', distance };
            }
          }
        } else {
          // For freehand, check each segment
          for (let i = 1; i < vectorData.points.length; i++) {
            const p1 = vectorData.points[i-1];
            const p2 = vectorData.points[i];
                        
            // Transform the coordinates based on image scale and position
            const x1 = imageX + (p1.x * scale);
            const y1 = imageY + (p1.y * scale);
            const x2 = imageX + (p2.x * scale);
            const y2 = imageY + (p2.y * scale);
                        
            // Calculate distance to this segment
            const distance = pointDistanceToLine(x, y, x1, y1, x2, y2);
                        
            // If this is closer than our previous closest segment, update
            if (distance <= maxDistance && distance < closestDistance) {
              closestDistance = distance;
              closestMatch = { label: strokeLabel, type: 'freehand', distance };
            }
          }
        }
      }
    }
        
    return closestMatch;
  }
    
  // Helper function to calculate the distance from a point to a line
  function pointDistanceToLine(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
        
    // If the line is actually a point
    if (len < 0.0001) {
      return Math.sqrt((px - x1) * (px - x1) + (py - y1) * (py - y1));
    }
        
    // Calculate the projection of point onto line
    const projection = ((px - x1) * dx + (py - y1) * dy) / len;
        
    // If the projection is outside the line segment
    if (projection < 0 || projection > len) {
      // Check distance to endpoints
      const d1 = Math.sqrt((px - x1) * (px - x1) + (py - y1) * (py - y1));
      const d2 = Math.sqrt((px - x2) * (px - x2) + (py - y2) * (py - y2));
      return Math.min(d1, d2);
    }
        
    // Calculate the actual distance to the line
    const projX = x1 + (projection * dx) / len;
    const projY = y1 + (projection * dy) / len;
    const distance = Math.sqrt((px - projX) * (px - projX) + (py - projY) * (py - projY));
    return distance;
  }

  // Helper function to check if a point is near a control point
  function findControlPointAtPosition(x, y) {
    // Check for selected strokes or strokes in edit mode
    const selectedStroke = window.selectedStrokeByImage[currentImageLabel];
    const editModeStroke = window.selectedStrokeInEditMode;
        
    // Priority: edit mode stroke first, then selected stroke
    const strokeToCheck = editModeStroke || selectedStroke;
    if (!strokeToCheck) return null;
        
    const vectorData = vectorStrokesByImage[currentImageLabel]?.[strokeToCheck];
    if (!vectorData) return null;
        
    // Check for curved line control points (including curved arrows)
    if ((vectorData.type === 'curved' || vectorData.type === 'curved-arrow') && vectorData.controlPoints) {
      return findCurvedControlPoint(x, y, vectorData);
    }
        
    // Check for arrow endpoints
    if (vectorData.type === 'arrow' && vectorData.points && vectorData.points.length >= 2) {
      return findArrowEndpoint(x, y, vectorData);
    }
        
    // Check for straight line endpoints
    if (vectorData.type === 'straight' && vectorData.points && vectorData.points.length >= 2) {
      return findStraightLineEndpoint(x, y, vectorData);
    }
        
    return null;
  }

  // Helper function to find curved line control points
  function findCurvedControlPoint(x, y, vectorData) {
    //         console.log(`=== CURVED CONTROL POINT DETECTION ===`);
    //         console.log(`Mouse position: (${x}, ${y})`);
    //         console.log(`Control points count: ${vectorData.controlPoints?.length || 0}`);
        
    // Get the same transformation context as applyVisibleStrokes
    const transformContext = getTransformationContext(currentImageLabel);
    //         console.log(`Transform context: scale=${transformContext.scale}, imageX=${transformContext.imageX}, imageY=${transformContext.imageY}, isBlankCanvas=${transformContext.isBlankCanvas}`);
        
    // Check each control point
    for (let i = 0; i < vectorData.controlPoints.length; i++) {
      const controlPoint = vectorData.controlPoints[i];
            
      // Transform using the same logic as applyVisibleStrokes
      const canvasCoords = transformImagePointToCanvas({ x: controlPoint.x, y: controlPoint.y }, transformContext);
      const canvasX = canvasCoords.x;
      const canvasY = canvasCoords.y;
      //             console.log(`CP ${i}: Computed current canvas coords (${canvasX}, ${canvasY}) from image (${controlPoint.x}, ${controlPoint.y})`);
            
      // Check if click is within control point radius (SCALE-AWARE)
      const scale = transformContext.scale;
      const baseRadius = 8; // Base radius
      const scaledRadius = Math.max(8, baseRadius * scale); // Never smaller than 8px
      const distance = Math.sqrt((x - canvasX) ** 2 + (y - canvasY) ** 2);
            
      //             console.log(`CP ${i}: Distance ${distance.toFixed(1)}, scaled radius ${scaledRadius.toFixed(1)} (scale: ${scale})`);
            
      if (distance <= scaledRadius + 5) { // Add 5px padding for easier selection
        const strokeToCheck = window.selectedStrokeInEditMode || window.selectedStrokeByImage[currentImageLabel];
        //                 console.log(`=== CONTROL POINT HIT DETECTED ===`);
        //                 console.log(`Stroke: ${strokeToCheck}, Point index: ${i}`);
        return {
          strokeLabel: strokeToCheck,
          pointIndex: i,
          canvasX: canvasX,
          canvasY: canvasY,
          type: 'curved'
        };
      }
    }
        
    //         console.log(`No control point hit detected`);
    return null;
  }

  // Helper function to find straight line endpoints
  function findStraightLineEndpoint(x, y, vectorData) {
    // Get current scale and position for coordinate transforms
    const scale = window.imageScaleByLabel[currentImageLabel] || 1;
        
    // Calculate image position for coordinate transforms
    let imageX, imageY;
    const isBlankCanvas = !window.originalImages || !window.originalImages[currentImageLabel];
        
    if (isBlankCanvas) {
      const canvasCenter = { x: canvas.width / 2, y: canvas.height / 2 };
      const position = imagePositionByLabel[currentImageLabel] || { x: 0, y: 0 };
      imageX = canvasCenter.x + position.x;
      imageY = canvasCenter.y + position.y;
    } else {
      const cachedImg = imageCache[window.originalImages[currentImageLabel]];
      if (cachedImg) {
        const imageWidth = cachedImg.width;
        const imageHeight = cachedImg.height;
        imageX = (canvas.width - imageWidth * scale) / 2 + 
                        (imagePositionByLabel[currentImageLabel]?.x || 0);
        imageY = (canvas.height - imageHeight * scale) / 2 + 
                        (imagePositionByLabel[currentImageLabel]?.y || 0);
      } else {
        imageX = canvas.width / 2 + (imagePositionByLabel[currentImageLabel]?.x || 0);
        imageY = canvas.height / 2 + (imagePositionByLabel[currentImageLabel]?.y || 0);
      }
    }
        
    // Check start and end points
    const startPoint = vectorData.points[0];
    const endPoint = vectorData.points[vectorData.points.length - 1];
        
    const endpoints = [
      { point: startPoint, index: 'start' },
      { point: endPoint, index: 'end' }
    ];
        
    for (const { point, index } of endpoints) {
      let transformedX, transformedY;
            
      if (isBlankCanvas) {
        const canvasCenter = { x: canvas.width / 2, y: canvas.height / 2 };
        const position = imagePositionByLabel[currentImageLabel] || { x: 0, y: 0 };
        const scaledX = (point.x - canvasCenter.x) * scale + canvasCenter.x;
        const scaledY = (point.y - canvasCenter.y) * scale + canvasCenter.y;
        transformedX = scaledX + position.x;
        transformedY = scaledY + position.y;
      } else {
        transformedX = imageX + (point.x * scale);
        transformedY = imageY + (point.y * scale);
      }
            
      // Check if click is within endpoint radius (SCALE-AWARE)
      const baseRadius = ANCHOR_SIZE || 8;
      const scaledRadius = Math.max(8, baseRadius * scale); // Never smaller than 8px
      const distance = Math.sqrt((x - transformedX) ** 2 + (y - transformedY) ** 2);
            
      if (distance <= scaledRadius + 5) { // Add 5px padding for easier selection
        const strokeToCheck = window.selectedStrokeInEditMode || window.selectedStrokeByImage[currentImageLabel];
        return {
          strokeLabel: strokeToCheck,
          pointIndex: index,
          canvasX: transformedX,
          canvasY: transformedY,
          type: 'straight'
        };
      }
    }
        
    return null;
  }

  // Helper function to find arrow endpoints
  function findArrowEndpoint(x, y, vectorData) {
    // Use unified coordinate transformation system
    const transformParams = getTransformationParams(currentImageLabel);
    const scale = transformParams.scale;
        
    // Check arrow start and end points
    const startPoint = vectorData.points[0];
    const endPoint = vectorData.points[vectorData.points.length - 1];
    const endpoints = [startPoint, endPoint];
        
    for (let i = 0; i < endpoints.length; i++) {
      const point = endpoints[i];
      const transformed = imageToCanvasCoords(point.x, point.y, transformParams);
      const transformedX = transformed.x;
      const transformedY = transformed.y;
            
      // Check if click is within endpoint radius (using square hit area)
      const pointRadius = 8 * scale;
      const halfSize = pointRadius / 2;
            
      if (x >= transformedX - halfSize && x <= transformedX + halfSize &&
                y >= transformedY - halfSize && y <= transformedY + halfSize) {
        return {
          strokeLabel: window.selectedStrokeInEditMode,
          pointIndex: i === 0 ? 'start' : 'end',
          canvasX: transformedX,
          canvasY: transformedY,
          type: 'arrow'
        };
      }
    }
        
    return null;
  }
    
  // Expose necessary functions globally for project-manager.js to use
  window.addImageToSidebar = addImageToSidebar;
  window.switchToImage = switchToImage;
  window.updateStrokeCounter = updateStrokeCounter;
  window.updateStrokeVisibilityControls = updateStrokeVisibilityControls;
  window.redrawCanvasWithVisibility = redrawCanvasWithVisibility;
  window.updateScaleUI = updateScaleUI;
    
  // *** ADDED: Expose function globally ***
  window.pasteImageFromUrl = pasteImageFromUrl;
    
  // Initial saveState call that won't increment labels or add to stroke list
  saveState(false, false, false);

  // IMPORTANT: We need to ensure the local strokeMeasurements is the same as window.strokeMeasurements
  //     console.log('[DOMContentLoaded] Checking initial window.strokeMeasurements:', window.strokeMeasurements);
    
  // THIS IS THE FIX: Instead of creating a new variable, we're just referencing the window object
  // There was a previous change to set strokeMeasurements = window.strokeMeasurements
  // But it seems that code was not applied correctly
    
  // CHECK: Log the current values to verify they're equal
  //     console.log('[DOMContentLoaded] Current window.strokeMeasurements keys:', 
  //         Object.keys(window.strokeMeasurements));
    
  // Ensure all IMAGE_LABELS have an entry in strokeMeasurements
  IMAGE_LABELS.forEach(label => {
    if (!window.strokeMeasurements[label]) {
      window.strokeMeasurements[label] = {};
      //             console.log(`[DOMContentLoaded] Initialized empty measurements for ${label}`);
    } else {
      //             console.log(`[DOMContentLoaded] Found existing measurements for ${label}:`, 
      //                 JSON.stringify(window.strokeMeasurements[label]));
    }
  });

  // Handle paste from clipboard
  document.addEventListener('paste', (e) => {
    //         console.log('[Paste Handler] Paste event triggered on document.'); // Log trigger
    const items = e.clipboardData.items;
    let imageFoundAndProcessed = false; // Flag to track if any image was processed in this event

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.indexOf('image') !== -1) {
        //                 console.log(`[Paste Handler] Image item found at index ${i}. Type: ${item.type}`);
        e.preventDefault(); 
        e.stopPropagation();

        const blob = item.getAsFile();
        if (!blob) {
          console.error('[Paste Handler] Could not get file from clipboard item.');
          continue; 
        }
        const url = URL.createObjectURL(blob);
                
        // Generate a unique label for the new image
        const baseLabelForPasted = currentImageLabel.split('_')[0] || 'image'; // Use current view's base
        if (!window.labelCounters[baseLabelForPasted]) {
          window.labelCounters[baseLabelForPasted] = { regular: 1, paste: 1 };
        }

        const pasteCounter = window.labelCounters[baseLabelForPasted].paste;
        const newImageLabel = `${baseLabelForPasted}_paste_${pasteCounter}`;
        window.labelCounters[baseLabelForPasted].paste = pasteCounter + 1;
                
        //                 console.log(`[Paste Handler] Assigned new unique label: ${newImageLabel}`);
                
        // Initialize all necessary structures for this new image
        initializeNewImageStructures(newImageLabel);

        let displayName = `Pasted ${baseLabelForPasted}`;
        if (window.getTagBasedFilename && typeof window.getTagBasedFilename === 'function') {
          displayName = window.getTagBasedFilename(newImageLabel, displayName);
        }
        //                 console.log(`[Paste Handler] Display name for ${newImageLabel}: ${displayName}`);
                
        addImageToSidebar(url, newImageLabel, displayName);
                
        if (!pastedImages.includes(url)) pastedImages.push(url);
        window.originalImages[newImageLabel] = url;
                
        // CRITICAL: Update current image label IMMEDIATELY before async operations
        // This ensures tag calculations use the correct image label
        currentImageLabel = newImageLabel;
        window.currentImageLabel = newImageLabel;
        window.paintApp.state.currentImageLabel = newImageLabel;
                
        // pasteImageFromUrl will handle setting imageStates, undoStack, etc.
        // and also drawing the image.
        // It's important to switch to the newly pasted image if we want it to be active.
        // However, if pasting multiple, we might only want to switch to the first one.
        // For now, let's switch to each as it's processed.
        pasteImageFromUrl(url, newImageLabel).then(() => {
          //                     console.log(`[Paste Handler] Successfully processed and displayed pasted image: ${newImageLabel}`);
                    
          // Apply default fit mode to newly pasted image - choose based on image dimensions
          const originalCurrentLabel = currentImageLabel;
                    
          if (window.originalImageDimensions[newImageLabel] && window.originalImageDimensions[newImageLabel].width > 0) {
            const dimensions = window.originalImageDimensions[newImageLabel];
            // Use fit-height for tall images (height > width), fit-width for wide images
            const fitMode = dimensions.height > dimensions.width ? 'fit-height' : 'fit-width';
            console.log(`[Paste Handler] Image ${newImageLabel} dimensions: ${dimensions.width}x${dimensions.height}, applying ${fitMode}`);
                        
            // Ensure canvas matches its container before computing fit (so fit uses actual canvas area)
            if (typeof resizeCanvas === 'function') resizeCanvas();
                        
            // Temporarily set current image to calculate fit for this specific image
            currentImageLabel = newImageLabel;
            const { scale, position } = calculateFitScale(fitMode);
                        
            // Update the scale and position for this image
            window.imageScaleByLabel[newImageLabel] = scale;
            window.imagePositionByLabel[newImageLabel] = { ...position };
                        
            console.log(`Auto-applied ${fitMode} to pasted image ${newImageLabel}: scale=${scale.toFixed(2)}`);
                        
            // Restore original current label
            currentImageLabel = originalCurrentLabel;
          }
                    
          // Switch to the newly pasted image (will update all state variables)
          switchToImage(newImageLabel);
                    
          // CRITICAL FIX: Update UI scale and force redraw immediately after auto-scaling
          // This prevents scale mismatch warnings and ensures scaling is visually applied
          updateScaleUI();
          redrawCanvasWithVisibility();
        }).catch(err => {
          console.error(`[Paste Handler] Error in pasteImageFromUrl for ${newImageLabel}:`, err);
        });
                
        imageFoundAndProcessed = true;
        // REMOVED THE BREAK STATEMENT TO ALLOW MULTIPLE IMAGE PASTING
      }
    }

    if (!imageFoundAndProcessed) {
      //             console.log('[Paste Handler] No image data found in clipboard items or failed to process.');
    }
  });

  // Initialize new image structures for default labels
  IMAGE_LABELS.forEach(label => {
    initializeNewImageStructures(label);
  });

  // Initialize new image structures
  function initializeNewImageStructures(label) {
    // THIS FUNCTION NEEDS TO BE ROBUST
    //         console.log(`[initializeNewImageStructures] Initializing for new label: ${label}`);
    if (!window.imageScaleByLabel) window.imageScaleByLabel = {};
    if (!window.imagePositionByLabel) window.imagePositionByLabel = {};
    if (!window.lineStrokesByImage) window.lineStrokesByImage = {};
    if (!window.vectorStrokesByImage) window.vectorStrokesByImage = {};
    if (!window.strokeVisibilityByImage) window.strokeVisibilityByImage = {};
    if (!window.strokeLabelVisibility) window.strokeLabelVisibility = {};
    if (!window.labelsByImage) window.labelsByImage = {};
    if (!window.undoStackByImage) window.undoStackByImage = {};
    if (!window.redoStackByImage) window.redoStackByImage = {};
    if (!window.imageStates) window.imageStates = {};
    if (!window.originalImageDimensions) window.originalImageDimensions = {};
    if (!window.imageTags) window.imageTags = {};
    if (!window.customLabelPositions) window.customLabelPositions = {}; // Ensure this is initialized
    if (!window.customLabelRelativePositions) window.customLabelRelativePositions = {}; // Store relative line positioning
    if (!window.calculatedLabelOffsets) window.calculatedLabelOffsets = {}; // Ensure this is initialized
    if (!window.customLabelAbsolutePositions) window.customLabelAbsolutePositions = {};
    window.customLabelAbsolutePositions[label] = {}; // Initialize absolute positions for this image

    window.imageScaleByLabel[label] = 1.0;
    window.imagePositionByLabel[label] = { x: 0, y: 0 };
    window.lineStrokesByImage[label] = [];
    window.vectorStrokesByImage[label] = {};
    window.strokeVisibilityByImage[label] = {};
    window.strokeLabelVisibility[label] = {};
    window.customLabelRelativePositions[label] = {}; // Initialize relative positions for this image
    window.labelsByImage[label] = 'A1'; // Default initial stroke label for a new image
    window.undoStackByImage[label] = [];
    window.redoStackByImage[label] = [];
    window.imageStates[label] = null;
    window.originalImageDimensions[label] = { width: 0, height: 0 };
    window.customLabelPositions[label] = {}; // Initialize for the new label
        
    // CRITICAL FIX: Initialize selection state for new images
    if (!window.paintApp.state.selectedStrokeByImage) window.paintApp.state.selectedStrokeByImage = {};
    if (!window.paintApp.state.multipleSelectedStrokesByImage) window.paintApp.state.multipleSelectedStrokesByImage = {};
    window.paintApp.state.selectedStrokeByImage[label] = null;
    window.paintApp.state.multipleSelectedStrokesByImage[label] = [];
    window.calculatedLabelOffsets[label] = {}; // Initialize for the new label

    // Initialize with default tags, robustly checking for TAG_MODEL
    const baseViewType = label.split('_')[0]; // e.g., 'front' from 'front_1' or 'front' itself
    let defaultViewTagId = 'front'; // Fallback default view type ID

    // Common view type mappings for labels that don't match TAG_MODEL exactly
    const viewTypeMappings = {
      'cushion': 'top',  // Map 'cushion' to 'top' view
      'detail': 'angle', // Map 'detail' to 'angle' view
      'interior': 'front', // Map 'interior' to 'front' view
      'blank': 'front'   // Map 'blank' to 'front' view (most common use case)
    };

    if (window.TAG_MODEL && window.TAG_MODEL.viewType && window.TAG_MODEL.viewType.options && Array.isArray(window.TAG_MODEL.viewType.options)) {
      // First try direct match
      let foundOption = window.TAG_MODEL.viewType.options.find(opt => opt.id === baseViewType || (opt.name && opt.name.toLowerCase() === baseViewType));
            
      // If no direct match, try mapping
      if (!foundOption && viewTypeMappings[baseViewType]) {
        const mappedViewType = viewTypeMappings[baseViewType];
        foundOption = window.TAG_MODEL.viewType.options.find(opt => opt.id === mappedViewType);
        if (foundOption) {
          console.log(`[initializeNewImageStructures] Mapped view type '${baseViewType}' to '${mappedViewType}'`);
        }
      }
            
      if (foundOption && foundOption.id) {
        defaultViewTagId = foundOption.id;
      } else {
        console.warn(`[initializeNewImageStructures] Could not find a matching viewType ID for base '${baseViewType}' in TAG_MODEL. Defaulting to '${defaultViewTagId}'.`);
      }
    } else {
      console.warn('[initializeNewImageStructures] window.TAG_MODEL.viewType.options not fully available for default tag initialization. Using basic defaults for viewType.');
    }

    window.imageTags[label] = {
      furnitureType: 'sofa', // Default furniture type ID
      viewType: defaultViewTagId
    };
    //         console.log(`[initializeNewImageStructures] Initialized tags for ${label}:`, JSON.stringify(window.imageTags[label]));
  }

  // *** NEW FUNCTION: Parse and save measurement string ***
  function parseAndSaveMeasurement(strokeLabel, newString) {
    //         console.log(`[parseAndSaveMeasurement] For ${strokeLabel}, received: \"${newString}\". Unit selector value: ${document.getElementById('unitSelector').value}`);
    let successfullyParsedAndSaved = false; // Flag to indicate if an update happened

    if (!newString && newString !== '0') { // Allow "0" to clear/reset measurement
      console.warn("[parseAndSaveMeasurement] Empty string received (and not '0'), attempting to clear measurement.");
      if (window.strokeMeasurements[currentImageLabel] && window.strokeMeasurements[currentImageLabel][strokeLabel]) {
        // Clear the specific measurement
        delete window.strokeMeasurements[currentImageLabel][strokeLabel]; 
        // Or reset to default if preferred:
        // window.strokeMeasurements[currentImageLabel][strokeLabel] = { inchWhole: 0, inchFraction: 0, cm: 0.0 };
        successfullyParsedAndSaved = true;
        //                 console.log(`[parseAndSaveMeasurement] Cleared measurement for ${strokeLabel}.`);
      } else {
        //                 console.log(`[parseAndSaveMeasurement] No existing measurement to clear for ${strokeLabel}.`);
        // No actual change, so UI refresh might not be strictly needed from here
        // but the blur handler will call updateStrokeVisibilityControls anyway.
        return false; // Indicate no save occurred
      }
    } else {
      // ... (rest of the parsing logic from the previous version) ...
      let totalInches = null;
      let totalCm = null;
      let explicitUnitMatched = false;

      // Try to parse as cm first - UNIT MUST BE PRESENT
      const cmRegex = /^\s*([\d.]+)\s*(cm|centimeter|centimeters)\s*$/i;
      const cmMatch = newString.match(cmRegex);
      if (cmMatch && cmMatch[1]) {
        totalCm = parseFloat(cmMatch[1]);
        if (!isNaN(totalCm)) {
          totalInches = totalCm / 2.54;
          explicitUnitMatched = true; // Unit was present
          //                     console.log(`[parseAndSaveMeasurement] Parsed as CM: ${totalCm}cm -> ${totalInches} inches. Explicit unit: ${explicitUnitMatched}`);
        }
      }

      if (totalInches === null) { // Only proceed if not parsed as CM yet
        // UNIT MUST BE PRESENT for these too
        const meterRegex = /^\s*([\d.]+)\s*(m|meter|meters)\s*$/i;
        const mmRegex = /^\s*([\d.]+)\s*(mm|millimeter|millimeters)\s*$/i;
        // Feet regex: number, optional space, then ft, foot, feet, or '. Allow optional space before unit.
        const feetRegex = /^\s*([\d.]+)\s*(ft|foot|feet|')\s*$/i;
        const yardRegex = /^\s*([\d.]+)\s*(yd|yard|yards)\s*$/i;
                
        // Inch regex: covers various forms like 12, 12.5, 12 1/2, 12", 12.5", 12 1/2", 12in, 12 inch
        // It should try to identify if an inch-specific marker (", in, inch, inches, or a fraction indicating inches) is present.
        const inchRegex = /^\s*(\d+)?(?:\s*(\d+\/\d+|[.\d]+))?\s*(\"|in|inch|inches)\s*$/i; // Requires inch marker
        const inchFractionOnlyRegex = /^\s*(\d+)\s+(\d+)\s*\/\s*(\d+)\s*$/i; // e.g. "12 3/4" (no unit marker, implies inches if currentUnit is inch)
        const inchDecimalOnlyRegex = /^\s*(\d+\.\d+)\s*$/i; // e.g. "12.5" (no unit marker)
        const inchWholeOnlyRegex = /^\s*(\d+)\s*$/i; // e.g. "12" (no unit marker) - this is the ambiguous one

        const meterMatch = newString.match(meterRegex);
        const mmMatch = newString.match(mmRegex);
        const feetMatch = newString.match(feetRegex);
        const yardMatch = newString.match(yardRegex);
        const inchMatchWithMarker = newString.match(inchRegex);

        if (meterMatch && meterMatch[1]) {
          totalInches = parseFloat(meterMatch[1]) * 39.3701;
          explicitUnitMatched = true;
          //                     console.log(`[parseAndSaveMeasurement] Parsed as Meters: ${meterMatch[1]}m -> ${totalInches} inches`);
        } else if (mmMatch && mmMatch[1]) {
          totalInches = parseFloat(mmMatch[1]) / 25.4;
          explicitUnitMatched = true;
          //                     console.log(`[parseAndSaveMeasurement] Parsed as Millimeters: ${mmMatch[1]}mm -> ${totalInches} inches`);
        } else if (feetMatch && feetMatch[1]) {
          totalInches = parseFloat(feetMatch[1]) * 12;
          explicitUnitMatched = true;
          //                     console.log(`[parseAndSaveMeasurement] Parsed as Feet: ${feetMatch[1]}${feetMatch[2]} -> ${totalInches} inches`);
        } else if (yardMatch && yardMatch[1]) {
          totalInches = parseFloat(yardMatch[1]) * 36;
          explicitUnitMatched = true;
          //                     console.log(`[parseAndSaveMeasurement] Parsed as Yards: ${yardMatch[1]}${yardMatch[2]} -> ${totalInches} inches`);
        } else if (inchMatchWithMarker && (inchMatchWithMarker[1] || inchMatchWithMarker[2])) {
          explicitUnitMatched = true; // Inch marker was present
          let wholeInches = 0;
          let fractionalPart = 0;
          if (inchMatchWithMarker[1]) { wholeInches = parseInt(inchMatchWithMarker[1], 10); }
          if (inchMatchWithMarker[2]) {
            if (inchMatchWithMarker[2].includes('/')) {
              const parts = inchMatchWithMarker[2].split('/');
              if (parts.length === 2 && !isNaN(parseInt(parts[0],10)) && parseInt(parts[1],10) !== 0) {
                fractionalPart = parseInt(parts[0], 10) / parseInt(parts[1], 10);
              } else { totalInches = NaN; /* Mark as invalid */ }
            } else {
              fractionalPart = parseFloat(inchMatchWithMarker[2]);
            }
          }
          if (!isNaN(totalInches)) { // if not marked invalid by bad fraction
            totalInches = wholeInches + fractionalPart;
            //                         console.log(`[parseAndSaveMeasurement] Parsed as Inches (with marker): ${newString} -> ${totalInches}\"`);
          }
        }
      }

      // Fallback: if no explicit unit marker was found and still not parsed, try to parse as a plain number (current unit sensitive)
      if (totalInches === null && !explicitUnitMatched) { 
        const plainNumber = parseFloat(newString);
        if (!isNaN(plainNumber)) {
          const currentUnit = document.getElementById('unitSelector').value;
          if (currentUnit === 'inch') {
            totalInches = plainNumber;
            //                         console.log(`[parseAndSaveMeasurement] Parsed as plain number (inches): ${totalInches}\"`);
          } else { // cm
            totalCm = plainNumber;
            totalInches = totalCm / 2.54;
            //                         console.log(`[parseAndSaveMeasurement] Parsed as plain number (cm): ${totalCm}cm -> ${totalInches} inches`);
          }
        }
      }

      // If parsing failed, or totalInches is NaN or negative, revert or do nothing
      if (totalInches === null || isNaN(totalInches) || totalInches < 0) {
        console.warn(`[parseAndSaveMeasurement] Failed to parse \"${newString}\" or result is invalid. No update.`);
        // The blur handler will call updateStrokeVisibilityControls to revert visual text if needed.
        return false; // Indicate no save
      }

      // Convert totalInches to whole and fractional part for storage
      const inchWhole = Math.floor(totalInches);
      // Store the raw decimal portion rounded to two decimals. This
      // preserves precision for later formatting while avoiding tiny
      // floating point errors like 0.9212598425 for 12.5cm.
      const inchFraction = parseFloat((totalInches - inchWhole).toFixed(2));
      const finalCm = totalInches * 2.54;

      if (!window.strokeMeasurements[currentImageLabel]) {
        window.strokeMeasurements[currentImageLabel] = {};
      }
      window.strokeMeasurements[currentImageLabel][strokeLabel] = {
        inchWhole: inchWhole,
        inchFraction: inchFraction,
        cm: parseFloat(finalCm.toFixed(4)) // Store cm with precision
      };
      successfullyParsedAndSaved = true;
      //             console.log(`[parseAndSaveMeasurement] Updated measurement for ${strokeLabel}:`, 
      //                 JSON.stringify(window.strokeMeasurements[currentImageLabel][strokeLabel]));
    }

    if (successfullyParsedAndSaved) {
      // REMOVED: saveState(true, false, false); 
      // REMOVED: updateStrokeVisibilityControls(); 
      // REMOVED: redrawCanvasWithVisibility();
      return true; // Indicate successful save
    } 
    return false; // Indicate no save or failed parse
  }

  // Helper function to find the closest fraction
  function findClosestFraction(fractionPart) {
    const fractions = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875];
    let closestFraction = 0;
    let minDiff = 1;
        
    for (const fraction of fractions) {
      const diff = Math.abs(fractionPart - fraction);
      if (diff < minDiff) {
        minDiff = diff;
        closestFraction = fraction;
      }
    }
        
    return closestFraction;
  }

  // Function to delete selected strokes with undo capability
  function deleteSelectedStrokes() {
    const currentSelectedStrokesArray = multipleSelectedStrokesByImage[currentImageLabel] || [];
    if (currentSelectedStrokesArray.length === 0) return;

    // Store the full stroke order BEFORE deletion for undo
    const preDeleteStrokeOrder = lineStrokesByImage[currentImageLabel] ? [...lineStrokesByImage[currentImageLabel]] : [];

    // Store original state for the specific strokes being deleted
    const deletedStrokeLabels = JSON.parse(JSON.stringify(currentSelectedStrokesArray)); // These are the ones being actively deleted
    const originalVectorData = {};
    const originalVisibility = {};
    const originalLabelVisibility = {};
    const originalMeasurements = {};

    // Save original data for potential undo (for the deleted strokes)
    const originalLabelOffsets = {};
    deletedStrokeLabels.forEach(strokeLabel => {
      if (vectorStrokesByImage[currentImageLabel] && vectorStrokesByImage[currentImageLabel][strokeLabel]) {
        originalVectorData[strokeLabel] = JSON.parse(JSON.stringify(vectorStrokesByImage[currentImageLabel][strokeLabel]));
      }
      if (strokeVisibilityByImage[currentImageLabel]) {
        originalVisibility[strokeLabel] = strokeVisibilityByImage[currentImageLabel][strokeLabel];
      }
      if (strokeLabelVisibility[currentImageLabel]) {
        originalLabelVisibility[strokeLabel] = strokeLabelVisibility[currentImageLabel][strokeLabel];
      }
      if (strokeMeasurements[currentImageLabel]) {
        originalMeasurements[strokeLabel] = JSON.parse(JSON.stringify(strokeMeasurements[currentImageLabel][strokeLabel] || {}));
      }
      // Save custom label positions (CRITICAL for undo!)
      const posKey = `${currentImageLabel}_${strokeLabel}`;
      if (window.customLabelPositions && window.customLabelPositions[posKey]) {
        originalLabelOffsets[strokeLabel] = JSON.parse(JSON.stringify(window.customLabelPositions[posKey]));
      } else if (window.calculatedLabelOffsets && window.calculatedLabelOffsets[posKey]) {
        originalLabelOffsets[strokeLabel] = JSON.parse(JSON.stringify(window.calculatedLabelOffsets[posKey]));
      }
    });

    // Remove strokes from all data structures
    deletedStrokeLabels.forEach(strokeLabel => {
      // Remove from vector data
      if (vectorStrokesByImage[currentImageLabel] && vectorStrokesByImage[currentImageLabel][strokeLabel]) {
        delete vectorStrokesByImage[currentImageLabel][strokeLabel];
      }
            
      // Remove from visibility tracking
      if (strokeVisibilityByImage[currentImageLabel] && strokeVisibilityByImage[currentImageLabel][strokeLabel]) {
        delete strokeVisibilityByImage[currentImageLabel][strokeLabel];
      }
            
      // Remove from label visibility tracking
      if (strokeLabelVisibility[currentImageLabel] && strokeLabelVisibility[currentImageLabel][strokeLabel]) {
        delete strokeLabelVisibility[currentImageLabel][strokeLabel];
      }
            
      // Remove from measurements
      if (strokeMeasurements[currentImageLabel] && strokeMeasurements[currentImageLabel][strokeLabel]) {
        delete strokeMeasurements[currentImageLabel][strokeLabel];
      }
            
      // Remove from line strokes
      if (lineStrokesByImage[currentImageLabel]) {
        lineStrokesByImage[currentImageLabel] = lineStrokesByImage[currentImageLabel].filter(label => label !== strokeLabel);
      }
    });
        
    // Clear selection
    multipleSelectedStrokesByImage[currentImageLabel] = [];
    selectedStrokeByImage[currentImageLabel] = null;

    // Create undo state
    const deleteAction = {
      type: 'delete-strokes',
      strokes: preDeleteStrokeOrder, // This is the full order before deletion
      deletedStrokeLabels: deletedStrokeLabels, // These are the specific strokes that were deleted
      vectorData: originalVectorData,
      visibility: originalVisibility,
      labelVisibility: originalLabelVisibility,
      measurements: originalMeasurements,
      labelOffsets: originalLabelOffsets, // CRITICAL: Save label positions!
      image: currentImageLabel
    };
        
    // Push to undo stack
    undoStackByImage[currentImageLabel] = undoStackByImage[currentImageLabel] || [];
    undoStackByImage[currentImageLabel].push(deleteAction);
        
    // Clear redo stack
    redoStackByImage[currentImageLabel] = [];

    // Update canvas and sidebar
    // REMOVE: saveState(true, false, false); // This was causing a double state for delete undo
    redrawCanvasWithVisibility();
    updateStrokeVisibilityControls();
        
    // Clear the manual next tag override so it recalculates based on existing strokes
    if (window.labelsByImage && window.labelsByImage[currentImageLabel]) {
      delete window.labelsByImage[currentImageLabel];
    }
        
    // If in manual sequence mode, recalculate the flag based on remaining strokes
    if (window.manualTagByImage && window.manualTagByImage[currentImageLabel] && typeof window.calculateNextTagFrom === 'function') {
      const remainingStrokes = lineStrokesByImage[currentImageLabel] || [];
      if (remainingStrokes.length > 0) {
        // Get base tags (remove (n) suffixes)
        const baseTags = remainingStrokes.map(tag => tag.replace(/\(\d+\)$/, ''));
                
        // Filter to only tags that match the manual sequence pattern (same letter)
        const currentManualTag = window.manualTagByImage[currentImageLabel];
        const manualLetter = currentManualTag.match(/^([A-Z])/)?.[1];
        const manualTags = baseTags.filter(tag => tag.match(/^([A-Z])/)?.[1] === manualLetter);
                
        if (manualTags.length > 0) {
          // Sort numerically
          const sorted = manualTags.sort((a, b) => {
            const matchA = a.match(/^([A-Z])(\d+)$/);
            const matchB = b.match(/^([A-Z])(\d+)$/);
            if (!matchA || !matchB) return a.localeCompare(b);
            const [, , numA] = matchA;
            const [, , numB] = matchB;
            return parseInt(numA) - parseInt(numB);
          });
                    
          // Look for gaps in the sequence
          let foundGap = null;
          for (let i = 0; i < sorted.length - 1; i++) {
            const match = sorted[i].match(/^([A-Z])(\d+)$/);
            const nextMatch = sorted[i + 1].match(/^([A-Z])(\d+)$/);
            if (match && nextMatch) {
              const num = parseInt(match[2]);
              const nextNum = parseInt(nextMatch[2]);
              if (nextNum > num + 1) {
                // Found a gap! Return the missing tag
                foundGap = match[1] + (num + 1);
                break;
              }
            }
          }
                    
          if (foundGap) {
            window.manualTagByImage[currentImageLabel] = foundGap;
            console.log(`[deleteSelectedStrokes] Found gap in manual sequence: ${foundGap}`);
          } else {
            // No gaps, increment from last
            const lastTag = sorted[sorted.length - 1];
            const nextManualTag = window.calculateNextTagFrom(lastTag);
            window.manualTagByImage[currentImageLabel] = nextManualTag;
            console.log(`[deleteSelectedStrokes] No gaps, recalculated manual flag: ${lastTag} → ${nextManualTag}`);
          }
        } else {
          // No manual tags found, clear flag
          delete window.manualTagByImage[currentImageLabel];
          console.log('[deleteSelectedStrokes] No manual tags found, cleared flag');
        }
      } else {
        // No strokes left, clear manual flag
        delete window.manualTagByImage[currentImageLabel];
        console.log('[deleteSelectedStrokes] No strokes left, cleared manual flag');
      }
    }
        
    // Update next tag display to reflect the new stroke state
    if (typeof window.updateNextTagDisplay === 'function') {
      window.updateNextTagDisplay();
    }
        
    // showStatusMessage(`Deleted ${originalStrokes.length} stroke${originalStrokes.length > 1 ? 's' : ''}`, 2000);
  }

  // Function to delete a single stroke by label
  function deleteStroke(strokeLabel) {
    // Select only this stroke
    multipleSelectedStrokesByImage[currentImageLabel] = [strokeLabel];
    selectedStrokeByImage[currentImageLabel] = strokeLabel;
        
    // Use the common delete function
    deleteSelectedStrokes();
  }

  // Helper functions for selection actions panel
  function updateSelectionActionsPanel() {
    const selectedStrokes = multipleSelectedStrokesByImage[currentImageLabel] || [];
    const actionsPanel = document.querySelector('.stroke-actions-panel');
        
    if (selectedStrokes.length > 0) {
      // Create panel if it doesn't exist
      if (!actionsPanel) {
        const strokesList = document.getElementById('strokesList');
        if (strokesList) {
          const newPanel = document.createElement('div');
          newPanel.className = 'stroke-actions-panel';
                    
          // Empty action buttons container
          const buttonsContainer = document.createElement('div');
          buttonsContainer.className = 'stroke-actions-buttons';
                    
          newPanel.appendChild(buttonsContainer);
          strokesList.prepend(newPanel); // Add to top of strokes list
        }
      } else {
        // Update existing panel
        // Remove update to selection count display
      }
    } else {
      // Hide panel if no strokes are selected
      hideSelectionActionsPanel();
    }
  }

  function hideSelectionActionsPanel() {
    const actionsPanel = document.querySelector('.stroke-actions-panel');
    if (actionsPanel) {
      actionsPanel.remove();
    }
  }

  // Helper function to enter edit mode for a stroke
  function enterEditMode(strokeLabel) {
    //         console.log(`Entering edit mode for stroke: ${strokeLabel}`);
        
    // Set the global edit mode variable
    window.selectedStrokeInEditMode = strokeLabel;
        
    // Update UI to show edit mode
  }

  // Handle curved line preview when not actively drawing but have control points
  if (!isDrawing && !isDraggingImage && !isDraggingLabel && drawingMode === 'curved' && curvedLinePoints.length > 0) {
    const mousePos = { x: e.offsetX, y: e.offsetY };
    drawCurvedLinePreview(curvedLinePoints, mousePos);
  }

  // Helper function to find the nearest point on a stroke to a given coordinate
  function findNearestPointOnStroke(canvasX, canvasY, strokeLabel) {
    const vectorData = vectorStrokesByImage[currentImageLabel]?.[strokeLabel];
    if (!vectorData || !vectorData.points || vectorData.points.length === 0) {
      return null;
    }
        
    // Use unified coordinate transformation system
    const transformParams = getTransformationParams(currentImageLabel);
        
    let nearestPoint = null;
    let minDistance = Number.MAX_VALUE;
        
    // Check each segment of the stroke
    for (let i = 0; i < vectorData.points.length; i++) {
      const point = vectorData.points[i];
            
      // Transform point to canvas coordinates using unified system
      const transformed = imageToCanvasCoords(point.x, point.y, transformParams);
      const pointCanvasX = transformed.x;
      const pointCanvasY = transformed.y;
            
      // Calculate distance to this point
      const distance = Math.sqrt(
        Math.pow(canvasX - pointCanvasX, 2) + 
                Math.pow(canvasY - pointCanvasY, 2)
      );
            
      if (distance < minDistance) {
        minDistance = distance;
        nearestPoint = {
          x: point.x, // Image space coordinates
          y: point.y,
          canvasX: pointCanvasX, // Canvas space coordinates
          canvasY: pointCanvasY,
          distance: distance
        };
      }
            
      // Also check line segments between points
      if (i > 0) {
        const prevPoint = vectorData.points[i - 1];
        const prevTransformed = imageToCanvasCoords(prevPoint.x, prevPoint.y, transformParams);
        const prevCanvasX = prevTransformed.x;
        const prevCanvasY = prevTransformed.y;
                
        // Find closest point on line segment
        const segmentLength = Math.sqrt(
          Math.pow(pointCanvasX - prevCanvasX, 2) + 
                    Math.pow(pointCanvasY - prevCanvasY, 2)
        );
                
        if (segmentLength > 0) {
          // Calculate projection of click point onto line segment
          const t = Math.max(0, Math.min(1, 
            ((canvasX - prevCanvasX) * (pointCanvasX - prevCanvasX) + 
                         (canvasY - prevCanvasY) * (pointCanvasY - prevCanvasY)) / 
                        (segmentLength * segmentLength)
          ));
                    
          const projCanvasX = prevCanvasX + t * (pointCanvasX - prevCanvasX);
          const projCanvasY = prevCanvasY + t * (pointCanvasY - prevCanvasY);
                    
          const projDistance = Math.sqrt(
            Math.pow(canvasX - projCanvasX, 2) + 
                        Math.pow(canvasY - projCanvasY, 2)
          );
                    
          if (projDistance < minDistance) {
            minDistance = projDistance;
            // Convert back to image space using inverse transformation
            const projImageCoords = canvasToImageCoords(projCanvasX, projCanvasY, transformParams);
            nearestPoint = {
              x: projImageCoords.x,
              y: projImageCoords.y,
              canvasX: projCanvasX,
              canvasY: projCanvasY,
              distance: projDistance
            };
          }
        }
      }
    }
        
    return nearestPoint;
  }

  // Double-click handler for finalizing curved lines
  function onCanvasDoubleClick(e) {
    e.preventDefault(); // Prevent default double-click behavior
        
    if (drawingMode === 'curved' && curvedLinePoints.length >= 2) {
      //             console.log(`Finalizing curve with ${curvedLinePoints.length} control points`);
            
      // Check if the double-click is on another stroke for snapping
      const strokeAtPoint = checkForStrokeAtPoint(e.offsetX, e.offsetY);
      let finalControlPoints = [...curvedLinePoints];
            
      if (strokeAtPoint) {
        //                 console.log(`Double-click detected on stroke ${strokeAtPoint.label}, attempting to snap curve endpoint`);
        //                 console.log(`Double-click coordinates: (${e.offsetX}, ${e.offsetY})`);
                
        // Find the nearest point on the target stroke
        const nearestPoint = findNearestPointOnStroke(e.offsetX, e.offsetY, strokeAtPoint.label);
                
        if (nearestPoint) {
          //                     console.log(`Nearest point found: distance ${nearestPoint.distance.toFixed(2)}px, imageSpace: (${nearestPoint.x.toFixed(2)}, ${nearestPoint.y.toFixed(2)}), canvasSpace: (${nearestPoint.canvasX.toFixed(2)}, ${nearestPoint.canvasY.toFixed(2)})`);
                    
          if (nearestPoint.distance <= 20) { // 20 pixel snap tolerance
            //                         console.log(`� Snapping curve endpoint to stroke ${strokeAtPoint.label} at distance ${nearestPoint.distance.toFixed(2)}px`);
                        
            // Replace the last control point with the snapped point
            finalControlPoints[finalControlPoints.length - 1] = {
              x: nearestPoint.x,
              y: nearestPoint.y,
              canvasX: nearestPoint.canvasX,
              canvasY: nearestPoint.canvasY,
              time: Date.now(),
              snappedTo: strokeAtPoint.label // Mark this point as snapped
            };
          } else {
            //                         console.log(`❌ Stroke detected but too far for snapping (distance: ${nearestPoint.distance.toFixed(2)}px > 20px tolerance)`);
          }
        } else {
          //                     console.log(`❌ Could not find nearest point on stroke ${strokeAtPoint.label}`);
        }
      }
            
      // Generate spline points using Catmull-Rom algorithm with final control points
      const refreshedFinalControlPoints = refreshControlPointCanvasCoords(finalControlPoints);
      const splinePoints = generateCatmullRomSpline(refreshedFinalControlPoints, 50);
            
      let finalPoints;
      if (splinePoints.length < 2) {
        console.warn('Not enough spline points generated, falling back to control points');
        finalPoints = finalControlPoints.map(cp => ({
          x: cp.x, y: cp.y, canvasX: cp.canvasX, canvasY: cp.canvasY, time: cp.time || Date.now()
        }));
      } else {
        finalPoints = splinePoints.map((sp, index) => {
          const { x: imgX, y: imgY } = getTransformedCoords(sp.x, sp.y);
          return {
            x: imgX, y: imgY, canvasX: sp.x, canvasY: sp.y, time: Date.now() + index
          };
        });
      }
            
      //             console.log(`Generated ${finalPoints.length} interpolated points for smooth curve`);
            
      // Create a stroke from the interpolated points
      const tempStrokeKey = '_drawingStroke';
      const strokeColor = colorPicker.value;
      const strokeWidth = parseInt(brushSize.value);
            
      // Initialize if needed
      if (!vectorStrokesByImage[currentImageLabel]) {
        vectorStrokesByImage[currentImageLabel] = {};
      }
            
      // Store the curved line as vector data using interpolated spline points
      vectorStrokesByImage[currentImageLabel][tempStrokeKey] = {
        points: finalPoints, // Use interpolated spline points, not control points
        color: strokeColor,
        width: strokeWidth,
        type: (arrowSettings.startArrow || arrowSettings.endArrow) ? 'curved-arrow' : 'curved', // Create curved arrow if arrows are enabled
        controlPoints: [...finalControlPoints], // Store final control points (with potential snapping)
        arrowSettings: (arrowSettings.startArrow || arrowSettings.endArrow) ? { ...arrowSettings } : undefined, // Include arrow settings if arrows are enabled
        dashSettings: { ...dashSettings }, // Store dash settings for dotted lines
        timestamp: Date.now()
      };
            
      // Clear the control points for next curve
      curvedLinePoints = [];
      //             console.log('Cleared control points for next curve');
            
      // CURVE_DEFOCUS_FIX_4: Mark that a curve was just completed (needs one defocus click)
      curveJustCompleted = true;
      //             console.log('Set curveJustCompleted flag - next single click will defocus');
            
      // Save the completed curved stroke
      saveState(true, true);
            
      // Update UI and clear any preview state
      updateStrokeVisibilityControls();
      redrawCanvasWithVisibility();
            
      //             console.log('Curved line finalized and saved');
    } else if (drawingMode === 'curved') {
      //             console.log('Double-click in curved mode, but need at least 2 control points to create a curve');
    }
  }

  // Initialize canvas event listeners
  bindCanvasListeners();
  console.log('[Event] Canvas listeners bound successfully');
    
  // Initialize per-picture tag size controls
  const currentTagSizeDisplay = document.getElementById('currentTagSize');
  const decreaseAllTagSizeBtn = document.getElementById('decreaseAllTagSize');
  const increaseAllTagSizeBtn = document.getElementById('increaseAllTagSize');
    
  // Debug: Check if buttons were found
  console.log('[PER-IMAGE-INIT] Elements found:', {
    currentTagSizeDisplay: !!currentTagSizeDisplay,
    decreaseAllTagSizeBtn: !!decreaseAllTagSizeBtn,
    increaseAllTagSizeBtn: !!increaseAllTagSizeBtn
  });
    
  const updateTagSizeDisplay = () => {
    if (currentTagSizeDisplay && window.currentImageLabel) {
      const currentImageLabel = window.currentImageLabel;
            
      // Check if there are any tag sizes set for this image
      const existingSizes = window.tagSizesByImage?.[currentImageLabel];
      if (existingSizes && Object.keys(existingSizes).length > 0) {
        // Show the size of the first tag (they should all be the same for per-image adjustment)
        const firstTagSize = Object.values(existingSizes)[0];
        currentTagSizeDisplay.textContent = firstTagSize;
      } else {
        // Show default size
        currentTagSizeDisplay.textContent = window.paintApp?.config?.DEFAULT_TAG_SIZE || 20;
      }
    }
  };
    
  const adjustAllTagSizes = (adjustment) => {
    try {
      const currentImageLabel = window.currentImageLabel || window.paintApp?.state?.currentImageLabel;
      if (!currentImageLabel) {
        console.log('[TAG-SIZE-ADJUST] No current image label');
        return;
      }
            
      // Since paintApp.state doesn't have images object, use window.tagSizesByImage for per-image sizes
      if (!window.tagSizesByImage) {
        window.tagSizesByImage = {};
      }
      if (!window.tagSizesByImage[currentImageLabel]) {
        window.tagSizesByImage[currentImageLabel] = {};
      }
            
      // Determine current size - check if any strokes have sizes set
      let currentSize;
      const existingStrokeSizes = Object.values(window.tagSizesByImage[currentImageLabel]);
      if (existingStrokeSizes.length > 0) {
        // Use the first tag's size as current image size
        currentSize = existingStrokeSizes[0];
      } else {
        // Use default size
        currentSize = window.paintApp?.config?.DEFAULT_TAG_SIZE || 20;
      }
            
      const newSize = Math.max(
        window.paintApp?.config?.MIN_TAG_SIZE || 8, 
        Math.min(window.paintApp?.config?.MAX_TAG_SIZE || 32, currentSize + adjustment)
      );
            
      // Update ALL individual tag sizes for this image to the new size
      // Get all strokes for current image
      const strokesForImage = window.vectorStrokesByImage?.[currentImageLabel];
      console.log(`[TAG-SIZE-ADJUST] Debug: strokesForImage for ${currentImageLabel}:`, strokesForImage);
      console.log('[TAG-SIZE-ADJUST] Debug: vectorStrokesByImage structure:', window.vectorStrokesByImage);
            
      if (strokesForImage && typeof strokesForImage === 'object') {
        const strokeKeys = Object.keys(strokesForImage);
        console.log('[TAG-SIZE-ADJUST] Debug: Found stroke keys:', strokeKeys);
        strokeKeys.forEach(strokeLabel => {
          window.tagSizesByImage[currentImageLabel][strokeLabel] = newSize;
          console.log(`[TAG-SIZE-ADJUST] Debug: Set ${strokeLabel} to size ${newSize}`);
        });
      } else {
        // If no strokes exist yet, just set a base size for new strokes
        console.log(`[TAG-SIZE-ADJUST] No strokes found for ${currentImageLabel}, setting base size`);
      }
            
      // Update display
      updateTagSizeDisplay();
            
      // Redraw canvas to show new tag sizes
      if (typeof redrawCanvasWithVisibility === 'function') {
        redrawCanvasWithVisibility();
      }
            
      console.log(`[TAG-SIZE-ADJUST] Adjusted all tag sizes on ${currentImageLabel} from ${currentSize} to ${newSize}`);
    } catch (error) {
      console.error('[TAG-SIZE-ADJUST] Error adjusting tag sizes:', error);
    }
  };
    
  // Add event listeners
  if (decreaseAllTagSizeBtn) {
    decreaseAllTagSizeBtn.addEventListener('click', () => {
      console.log('[PER-IMAGE-BUTTON] Decrease button clicked');
      adjustAllTagSizes(-window.paintApp.config.TAG_SIZE_STEP);
    });
  } else {
    console.warn('[PER-IMAGE-BUTTON] Decrease button not found');
  }
    
  if (increaseAllTagSizeBtn) {
    increaseAllTagSizeBtn.addEventListener('click', () => {
      console.log('[PER-IMAGE-BUTTON] Increase button clicked');
      adjustAllTagSizes(window.paintApp.config.TAG_SIZE_STEP);
    });
  } else {
    console.warn('[PER-IMAGE-BUTTON] Increase button not found');
  }
    
  // Update display when switching images
  const paintAppRedrawCanvasWithVisibility = window.paintApp?.redrawCanvasWithVisibility;
  if (paintAppRedrawCanvasWithVisibility) {
    window.paintApp.redrawCanvasWithVisibility = function() {
      updateTagSizeDisplay();
      return paintAppRedrawCanvasWithVisibility.call(this);
    };
  }
    
  // Initial display update
  updateTagSizeDisplay();
    
  console.log('[PER-IMAGE-INIT] Tag size controls initialized');
}); // Correctly close DOMContentLoaded

// COOPERATIVE ROTATION FIX: Integrate working rotation solution
// This fix addresses the reported rotation issues:
// 1. "stroke tag is text rotating when it should not" - text stays horizontal
// 2. "when I use an image the vector rotates 180 not 90" - proper rotation increments
(function initializeCooperativeRotationFix() {
  debugLog('[ROTATION-FIX] Initializing cooperative rotation solution...');
  
  // Enhanced text rendering that keeps labels horizontal during rotation
  const originalFillText = window.CanvasRenderingContext2D.prototype.fillText;
  const originalStrokeText = window.CanvasRenderingContext2D.prototype.strokeText;
  
  // Counter-rotate text to keep it horizontal and readable
  window.CanvasRenderingContext2D.prototype.fillText = function(text, x, y) {
    if (window.__skipTextCounterRotate) {
      return originalFillText.call(this, text, x, y);
    }
    // Only apply fix to actual labels (not measurements or coordinates)
    if (typeof text === 'string' && text.length > 0 && 
        !text.match(/^\d+$/) && // not just numbers
        !text.match(/^[\d.,]+$/) && // not measurements  
        text !== '0') { // not zero
        
      // Save current transform
      this.save();
      
      // Get current transform matrix
      const transform = this.getTransform();
      
      // Check if there's any rotation applied
      if (Math.abs(transform.b) > 0.01 || Math.abs(transform.a - 1) > 0.01) {
        // Calculate the rotation angle
        const rotation = Math.atan2(transform.b, transform.a);
        
        // Apply counter-rotation to keep text horizontal
        this.translate(x, y);
        this.rotate(-rotation);
        
        debugLog(`[ROTATION-FIX] Counter-rotating label "${text}" by ${(-rotation * 180 / Math.PI).toFixed(1)}° to stay horizontal`);
        
        // Draw text at origin (we already translated)
        const result = originalFillText.call(this, text, 0, 0);
        
        // Restore transform
        this.restore();
        
        return result;
      }
    }
    
    // For non-label text or no rotation, use original behavior
    return originalFillText.call(this, text, x, y);
  };
  
  // Same logic for stroke text
  window.CanvasRenderingContext2D.prototype.strokeText = function(text, x, y) {
    if (window.__skipTextCounterRotate) {
      return originalStrokeText.call(this, text, x, y);
    }
    if (typeof text === 'string' && text.length > 0 && 
        !text.match(/^\d+$/) && 
        !text.match(/^[\d.,]+$/) && 
        text !== '0') {
        
      this.save();
      const transform = this.getTransform();
      
      if (Math.abs(transform.b) > 0.01 || Math.abs(transform.a - 1) > 0.01) {
        const rotation = Math.atan2(transform.b, transform.a);
        this.translate(x, y);
        this.rotate(-rotation);
        
        const result = originalStrokeText.call(this, text, 0, 0);
        this.restore();
        return result;
      }
    }
    
    return originalStrokeText.call(this, text, x, y);
  };
  
  debugLog('[ROTATION-FIX] ✅ Cooperative rotation fix initialized - labels will stay horizontal during rotation');
})();

// Function to get tag size for a specific stroke
function getTagSize(strokeLabel) {
  try {
    // Get the current image label safely
    const imageLabel = window.currentImageLabel || window.paintApp?.state?.currentImageLabel;
    if (!imageLabel) {
      console.log(`[GET-TAG-SIZE] No image label, using default size: ${window.paintApp?.config?.DEFAULT_TAG_SIZE || 20}`);
      return window.paintApp?.config?.DEFAULT_TAG_SIZE || 20;
    }
        
    // Check individual tag sizes first
    if (window.tagSizesByImage && typeof window.tagSizesByImage === 'object' && 
            window.tagSizesByImage[imageLabel] && typeof window.tagSizesByImage[imageLabel] === 'object' &&
            window.tagSizesByImage[imageLabel][strokeLabel]) {
      const size = window.tagSizesByImage[imageLabel][strokeLabel];
      console.log(`[GET-TAG-SIZE] Using individual size: ${size} for ${strokeLabel} on ${imageLabel}`);
      return size;
    }
        
    // Final fallback to default
    const defaultSize = window.paintApp?.config?.DEFAULT_TAG_SIZE || 20;
    console.log(`[GET-TAG-SIZE] Using final default size: ${defaultSize} for ${strokeLabel} on ${imageLabel}`);
    return defaultSize;
  } catch (error) {
    console.error(`[GET-TAG-SIZE] Error getting tag size for ${strokeLabel}:`, error);
    return window.paintApp?.config?.DEFAULT_TAG_SIZE || 20;
  }
}

// ===== ROTATION TEST HARNESS =====
// Comprehensive test system for debugging custom label rotation behavior

// Debug flag - set to true for verbose logging
const ROT_DEBUG = false;

// Helper Functions
function normalizeDelta(d) {
  const t = Math.PI * 2;
  d = ((d + Math.PI) % t + t) % t - Math.PI;
  return Math.abs(d) < 1e-9 ? 0 : d;
}

function rotateVec(v, delta) {
  const c = Math.cos(delta), s = Math.sin(delta);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
function add(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
function dist(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return Math.hypot(dx, dy); }
function approx(a, b, eps = 0.75) { return dist(a, b) <= eps; }

function getEps(img) {
  const z = (window.imageScaleByLabel?.[img]) || 1;
  return Math.max(0.5, 0.75 * z);
}

function getStrokeMidpointImage(img, stroke) {
  const v = (window.vectorStrokesByImage?.[img]?.[stroke]) || null;
  if (!v || !v.points || v.points.length < 1) return null;
  const mid = v.points[Math.floor(v.points.length / 2)];
  return { x: mid.x, y: mid.y };
}

function getImageSpaceOffset(img, stroke) {
  const cust = window.customLabelPositions?.[img]?.[stroke];
  if (cust && typeof cust.x === 'number' && typeof cust.y === 'number') return { ...cust };
  const calc = window.calculatedLabelOffsets?.[img]?.[stroke];
  if (calc && typeof calc.x === 'number' && typeof calc.y === 'number') return { ...calc };
  return { x: 0, y: 0 }; // fallback
}

function labelCanvasPosition(img, stroke) {
  // Use the same math as render: anchor → image-space offset → toCanvas
  const anchorImg = getStrokeMidpointImage(img, stroke);
  if (!anchorImg) return null;
  const offImg = getImageSpaceOffset(img, stroke);
  const finalImg = { x: anchorImg.x + offImg.x, y: anchorImg.y + offImg.y };
    
  // Use the same coordinate transformation function as rendering (toCanvas)
  if (typeof window.toCanvas === 'function') {
    const finalCanvas = window.toCanvas(finalImg, img);
    return { x: finalCanvas.x, y: finalCanvas.y };
  } else if (typeof window.getCanvasCoords === 'function') {
    const finalCanvas = window.getCanvasCoords(finalImg.x, finalImg.y);
    return { x: finalCanvas.x, y: finalCanvas.y };
  } else {
    throw new Error('toCanvas or getCanvasCoords function not available');
  }
}

function getRotationMeta(img) {
  const meta = window.lastRotationMeta?.[img];
  if (!meta || !meta.centerCanvas) return null;
  return { center: { ...meta.centerCanvas }, delta: normalizeDelta(meta.delta || 0) };
}

function snapshotCustomOffsets(img) {
  const pos = window.customLabelPositions?.[img] || {};
  const result = {};
  for (const [stroke, off] of Object.entries(pos)) {
    if (off && typeof off.x === 'number' && typeof off.y === 'number') {
      result[stroke] = { x: off.x, y: off.y };
    }
  }
  return result;
}

function snapshotRotationStamps(img) {
  const stamps = window.customLabelOffsetsRotationByImageAndStroke?.[img] || {};
  const result = {};
  for (const [stroke, stamp] of Object.entries(stamps)) {
    if (typeof stamp === 'number') {
      result[stroke] = stamp;
    }
  }
  return result;
}

// Async rotation wrapper with proper completion waiting
async function rotateFn90CCW(realImageLabel) {
  return new Promise(resolve => {
    const done = () => requestAnimationFrame(() => requestAnimationFrame(resolve));
        
    // Find the current image index for the rotation
    let imageIndex = -1;
    if (window.imageGalleryData) {
      // Try multiple matching strategies
      imageIndex = window.imageGalleryData.findIndex(img => {
        // Strategy 1: Match original.label
        if (img.original?.label === realImageLabel) return true;
                
        // Strategy 2: Match derived label from name
        const derivedLabel = img.name?.toLowerCase().replace(/\s+/g, '_') || 'unknown';
        if (derivedLabel === realImageLabel) return true;
                
        // Strategy 3: Check for blank_canvas specifically
        if (realImageLabel === 'blank_canvas' && (
          img.name === 'Blank Canvas' ||
                    img.original?.isBlankCanvas === true ||
                    derivedLabel === 'blank_canvas'
        )) return true;
                
        return false;
      });
            
      console.log(`[ROT-TEST] Image search: label=${realImageLabel}, index=${imageIndex}`);
      console.log('[ROT-TEST] Gallery data:', window.imageGalleryData?.map((img, i) => ({
        index: i,
        name: img.name,
        originalLabel: img.original?.label,
        isBlankCanvas: img.original?.isBlankCanvas,
        derivedLabel: img.name?.toLowerCase().replace(/\s+/g, '_'),
        matchesTarget: [
          img.original?.label === realImageLabel,
          (img.name?.toLowerCase().replace(/\s+/g, '_') || 'unknown') === realImageLabel,
          realImageLabel === 'blank_canvas' && (img.name === 'Blank Canvas' || img.original?.isBlankCanvas === true)
        ]
      })));
    }
        
    if (imageIndex >= 0 && typeof window.rotateImage === 'function') {
      try {
        console.log(`[ROT-TEST] Calling window.rotateImage(${imageIndex}, -90)`);
        window.rotateImage(imageIndex, -90);
        done();
      } catch (error) {
        console.error('[ROT-TEST] Rotation failed:', error);
        done();
      }
    } else if (imageIndex >= 0 && typeof window.transformImageData === 'function') {
      // Try alternative: direct transform call if rotateImage not available
      try {
        console.log('[ROT-TEST] Trying direct transformImageData call');
        window.transformImageData(realImageLabel, 'rotate', -90, 800, 800);
        done();
      } catch (error) {
        console.error('[ROT-TEST] Direct transform failed:', error);
        done();
      }
    } else if (typeof window.transformImageData === 'function') {
      // Fallback: try direct transform even without image index
      try {
        console.log('[ROT-TEST] Fallback: trying direct transform without image index');
        window.transformImageData(realImageLabel, 'rotate', -90, 800, 800);
        done();
      } catch (error) {
        console.error('[ROT-TEST] Fallback transform failed:', error);
        done();
      }
    } else {
      console.error(`[ROT-TEST] Could not find image or rotation functions. Label: ${realImageLabel}, Index: ${imageIndex}, rotateImage: ${typeof window.rotateImage}, transformImageData: ${typeof window.transformImageData}`);
      done();
    }
  });
}

// Main Test Functions

// Core 90° CCW rotation test
window.run90DegCCWTest = async function(imageLabel, strokes, rotateFn) {
  const img = imageLabel;
  const eps = getEps(img);

  // Precondition checks
  if (typeof window.toCanvas !== 'function' && typeof window.getCanvasCoords !== 'function') {
    return { pass: false, reason: 'toCanvas or getCanvasCoords function not available' };
  }

  // Snapshot pre-rotation state
  const pre = {};
  const preOffsets = snapshotCustomOffsets(img);
  const preStamps = snapshotRotationStamps(img);
    
  for (const s of strokes) {
    pre[s] = labelCanvasPosition(img, s);
    if (!pre[s]) return { pass: false, reason: `No position for ${s} pre-rotation` };
  }

  // Execute rotation
  try {
    await rotateFn();
  } catch (error) {
    return { pass: false, reason: `Rotation failed: ${error.message}` };
  }

  // Read rotation meta (authoritative)
  const meta = getRotationMeta(img);
  if (!meta) return { pass: false, reason: `Missing lastRotationMeta for ${img}` };
    
  const { center, delta } = meta;
  if (Math.abs(delta + Math.PI/2) > 1e-6) {
    return { pass: false, reason: `delta expected -90deg, got ${(delta*180/Math.PI).toFixed(2)}deg` };
  }

  // Snapshot post-rotation state and compute expectations
  const postOffsets = snapshotCustomOffsets(img);
  const postStamps = snapshotRotationStamps(img);
  const results = [];
    
  for (const s of strokes) {
    const post = labelCanvasPosition(img, s);
    if (!post) return { pass: false, reason: `No position for ${s} post-rotation` };

    // Compute expectation: rotate around center reported by transform
    const vPre = sub(pre[s], center);
    const vExp = rotateVec(vPre, delta);
    const exp = add(center, vExp);

    const okPos = approx(post, exp, eps);
    const okRadius = Math.abs(dist(pre[s], center) - dist(post, center)) <= eps;

    // Check custom offset mutation
    const offsetMutated = preOffsets[s] && postOffsets[s] && 
            !approx(preOffsets[s], postOffsets[s], 1e-6);

    // Check stamp advancement
    const stampAdvanced = preStamps[s] !== undefined && postStamps[s] !== undefined &&
            Math.abs(normalizeDelta(postStamps[s] - preStamps[s]) - delta) <= 1e-6;

    if (ROT_DEBUG || !(okPos && okRadius)) {
      console[(okPos && okRadius) ? 'log' : 'error'](
        `[ROT-TEST] ${s} post=${JSON.stringify(post)} exp=${JSON.stringify(exp)} ` +
                `radiusPre=${dist(pre[s], center).toFixed(2)} radiusPost=${dist(post, center).toFixed(2)} ` +
                `offsetMutated=${offsetMutated} stampAdvanced=${stampAdvanced}`
      );
    }

    results.push({ 
      stroke: s, 
      okPos, 
      okRadius, 
      offsetMutated,
      stampAdvanced,
      post, 
      exp,
      center,
      eps
    });
  }

  const allPass = results.every(r => r.okPos && r.okRadius);
    
  // Compact summary unless debug mode
  if (!ROT_DEBUG && !allPass) {
    console.error(`[ROT-TEST] FAIL: ${results.filter(r => !r.okPos || !r.okRadius).length}/${results.length} strokes failed position/radius test`);
  }
    
  return { pass: allPass, details: results, center, delta: delta * 180 / Math.PI };
};

// Four-step cycle test (4 × -90° = 360° = back to start)
window.runFourStepCycleTest = async function(imageLabel, strokes = ['A1', 'A2', 'A3', 'A4']) {
  const img = imageLabel;
  const eps = getEps(img);

  // Snapshot baseline positions
  const baseline = {};
  for (const s of strokes) {
    baseline[s] = labelCanvasPosition(img, s);
    if (!baseline[s]) return { pass: false, reason: `No baseline position for ${s}` };
  }

  const results = [];
    
  // Perform 4 rotations
  for (let step = 1; step <= 4; step++) {
    const result = await window.run90DegCCWTest(img, strokes, () => rotateFn90CCW(img));
    results.push({ step, result });
        
    if (!result.pass) {
      return { 
        pass: false, 
        reason: `Step ${step} failed: ${result.details?.find(d => !d.okPos || !d.okRadius)?.stroke || 'unknown'}`,
        stepResults: results
      };
    }
  }

  // Check return to baseline
  const final = {};
  const baselineErrors = [];
    
  for (const s of strokes) {
    final[s] = labelCanvasPosition(img, s);
    if (!final[s]) return { pass: false, reason: `No final position for ${s}` };
        
    const backToBaseline = approx(final[s], baseline[s], eps);
    if (!backToBaseline) {
      baselineErrors.push({
        stroke: s,
        baseline: baseline[s],
        final: final[s],
        distance: dist(final[s], baseline[s])
      });
    }
  }

  const cycleComplete = baselineErrors.length === 0;
    
  if (!ROT_DEBUG && !cycleComplete) {
    console.error(`[ROT-TEST] CYCLE FAIL: ${baselineErrors.length}/${strokes.length} strokes not back to baseline`);
    baselineErrors.forEach(err => 
      console.error(`  ${err.stroke}: off by ${err.distance.toFixed(2)}px`)
    );
  }

  return { 
    pass: cycleComplete, 
    stepResults: results,
    baselineErrors,
    eps
  };
};

// Initialize cross baseline pattern for testing
window.initCrossBaseline = function(imageLabel) {
  const img = imageLabel;
    
  // Ensure we're on the correct image
  if (window.currentImageLabel !== img) {
    console.warn(`[ROT-TEST] Switching from ${window.currentImageLabel} to ${img}`);
    // Note: In a full implementation, we'd switch images here
  }

  // Clear existing strokes for this image to start fresh
  if (window.vectorStrokesByImage && window.vectorStrokesByImage[img]) {
    window.vectorStrokesByImage[img] = {};
  }
  if (window.lineStrokesByImage && window.lineStrokesByImage[img]) {
    window.lineStrokesByImage[img] = [];
  }
  if (window.customLabelPositions && window.customLabelPositions[img]) {
    window.customLabelPositions[img] = {};
  }
  if (window.calculatedLabelOffsets && window.calculatedLabelOffsets[img]) {
    window.calculatedLabelOffsets[img] = {};
  }

  // Create cross pattern strokes (A1-A4) programmatically
  const canvas = document.getElementById('canvas');
  if (!canvas) {
    throw new Error('Canvas not found');
  }
    
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const armLength = 100; // pixels
    
  const strokes = {
    'A1': { start: { x: centerX, y: centerY }, end: { x: centerX + armLength, y: centerY } }, // Right
    'A2': { start: { x: centerX, y: centerY }, end: { x: centerX, y: centerY - armLength } }, // Up  
    'A3': { start: { x: centerX, y: centerY }, end: { x: centerX - armLength, y: centerY } }, // Left
    'A4': { start: { x: centerX, y: centerY }, end: { x: centerX, y: centerY + armLength } }  // Down
  };

  // Initialize data structures if needed
  if (!window.vectorStrokesByImage) window.vectorStrokesByImage = {};
  if (!window.vectorStrokesByImage[img]) window.vectorStrokesByImage[img] = {};
  if (!window.lineStrokesByImage) window.lineStrokesByImage = {};
  if (!window.lineStrokesByImage[img]) window.lineStrokesByImage[img] = [];

  // Create vector data for each stroke
  Object.entries(strokes).forEach(([label, stroke]) => {
    window.vectorStrokesByImage[img][label] = {
      type: 'straight',
      points: [
        { x: stroke.start.x, y: stroke.start.y },
        { x: stroke.end.x, y: stroke.end.y }
      ],
      color: '#000000',
      width: 3
    };
    window.lineStrokesByImage[img].push(label);
  });

  // Update label counter
  if (window.labelsByImage) {
    window.labelsByImage[img] = 'A5'; // Next available label
  }

  // **NEW**: Invalidate anchor cache when loading test data
  window.invalidateAnchorCache(img);

  // Trigger a redraw to make strokes visible and calculate positions
  if (typeof window.redrawCanvasWithVisibility === 'function') {
    window.redrawCanvasWithVisibility();
  }

  console.log(`[ROT-TEST] Created cross baseline pattern with strokes: ${Object.keys(strokes).join(', ')}`);
  return { strokes: Object.keys(strokes), center: { x: centerX, y: centerY } };
};
// Global debug helper to test rotation harness
window.testRotationHarness = async function(imageLabel = null) {
  const img = imageLabel || window.currentImageLabel || 'blank_canvas';
    
  console.log(`[ROT-TEST] Testing rotation harness for image: ${img}`);
    
  // Initialize baseline if needed
  const baseline = window.initCrossBaseline(img);
  console.log('[ROT-TEST] Baseline created:', baseline);
    
  // Wait a frame for rendering
  await new Promise(resolve => requestAnimationFrame(resolve));
    
  // Run single rotation test
  const singleResult = await window.run90DegCCWTest(
    img, 
    baseline.strokes, 
    () => rotateFn90CCW(img)
  );
    
  console.log('[ROT-TEST] Single rotation result:', singleResult);
    
  // Run full cycle test
  const cycleResult = await window.runFourStepCycleTest(img, baseline.strokes);
  console.log('[ROT-TEST] Four-step cycle result:', cycleResult);
    
  return { single: singleResult, cycle: cycleResult };
};

// Synchronization helper to ensure custom positions are stored in both locations
window.syncCustomLabelPositions = function(imageLabel) {
  const img = imageLabel || window.currentImageLabel;
    
  // Ensure both storage locations exist
  if (!window.customLabelPositions) window.customLabelPositions = {};
  if (!window.customLabelPositions[img]) window.customLabelPositions[img] = {};
    
  // Sync from local to global (if local variable is accessible)
  // Note: This function is called from window scope, so we need to find another way to sync
  console.log(`[SYNC] Custom positions synchronization for ${img} - window storage initialized`);
};

// Debug function to find where custom positions are stored
window.debugCustomPositionSources = function(imageLabel) {
  const img = imageLabel || window.currentImageLabel;
  console.log(`[DEBUG] ===== Investigating custom position sources for ${img} =====`);
    
  // Check window.customLabelPositions
  console.log('[DEBUG] window.customLabelPositions:', window.customLabelPositions);
  if (window.customLabelPositions) {
    console.log('[DEBUG] Keys in window.customLabelPositions:', Object.keys(window.customLabelPositions));
    for (const [key, value] of Object.entries(window.customLabelPositions)) {
      console.log(`[DEBUG] window.customLabelPositions[${key}]:`, value);
    }
  }
    
  // Check paintApp.state.customLabelPositions
  if (window.paintApp?.state?.customLabelPositions) {
    console.log('[DEBUG] paintApp.state.customLabelPositions:', window.paintApp.state.customLabelPositions);
    for (const [key, value] of Object.entries(window.paintApp.state.customLabelPositions)) {
      console.log(`[DEBUG] paintApp.state.customLabelPositions[${key}]:`, value);
    }
  }
    
  // Check global variables that might contain custom positions
  console.log('[DEBUG] Checking globals for custom position patterns...');
    
  // Check for any variable containing custom position-like data
  const globalsToCheck = ['customPositions', 'labelPositions', 'strokePositions', 'customOffsets'];
  globalsToCheck.forEach(name => {
    if (window[name]) {
      console.log(`[DEBUG] Found global '${name}':`, window[name]);
    }
  });
    
  // Force a label calculation to see where the values come from
  console.log('[DEBUG] Triggering label calculation to trace sources...');
  if (window.redrawCanvas) {
    window.redrawCanvas();
  }
};

// Test function to verify custom label rotation fix
window.testCustomLabelRotationFix = async function(imageLabel) {
  const img = imageLabel || window.currentImageLabel || 'blank_canvas';
  console.log(`[TEST] ===== Testing Custom Label Rotation Fix for ${img} =====`);
    
  // Step 1: Create some test strokes with custom positions
  const baseline = window.initCrossBaseline ? window.initCrossBaseline(img) : null;
  if (!baseline) {
    console.log('[TEST] Creating simple cross pattern for testing...');
    // Create a simple cross if initCrossBaseline doesn't exist
    if (!window.vectorStrokesByImage) window.vectorStrokesByImage = {};
    if (!window.vectorStrokesByImage[img]) window.vectorStrokesByImage[img] = {};
        
    const center = { x: 400, y: 300 };
    window.vectorStrokesByImage[img] = {
      'A1': [center, { x: center.x + 100, y: center.y }],        // Right
      'A2': [center, { x: center.x, y: center.y - 100 }],        // Up
      'A3': [center, { x: center.x - 100, y: center.y }],        // Left  
      'A4': [center, { x: center.x, y: center.y + 100 }]         // Down
    };
  }
    
  // Step 2: Manually set custom positions (simulating user drag)
  console.log('[TEST] Setting custom positions to simulate user dragging labels...');
    
  if (!window.customLabelPositions) window.customLabelPositions = {};
  if (!window.customLabelPositions[img]) window.customLabelPositions[img] = {};
    
  // Set custom positions that are offset from stroke endpoints
  const customOffsets = {
    'A1': { x: -50, y: 70 },
    'A2': { x: 45, y: -40 },
    'A3': { x: -55, y: -145 },
    'A4': { x: -125, y: -45 }
  };
    
  for (const [label, offset] of Object.entries(customOffsets)) {
    window.customLabelPositions[img][label] = offset;
    console.log(`[TEST] Set custom position for ${label}:`, offset);
  }
    
  // Step 3: Force a redraw to apply the custom positions
  if (window.redrawCanvas) {
    window.redrawCanvas();
    await new Promise(resolve => requestAnimationFrame(resolve));
  }
    
  // Step 4: Record positions before rotation
  console.log('[TEST] Recording label positions before rotation...');
  const beforeRotation = {};
  for (const label of Object.keys(customOffsets)) {
    const pos = window.labelCanvasPosition ? window.labelCanvasPosition(img, label) : null;
    beforeRotation[label] = pos;
    console.log(`[TEST] Before: ${label} at (${pos?.x?.toFixed(1) || 'N/A'}, ${pos?.y?.toFixed(1) || 'N/A'})`);
  }
    
  // Step 5: Perform one rotation
  console.log('[TEST] Performing rotation...');
  if (window.rotateImage || window.transformImageData) {
    try {
      if (window.rotateImage) {
        await window.rotateImage();
      } else {
        await window.transformImageData(img, 'rotate', -90);
      }
            
      await new Promise(resolve => {
        requestAnimationFrame(() => {
          requestAnimationFrame(resolve);
        });
      });
    } catch (error) {
      console.error('[TEST] Rotation failed:', error);
      return { success: false, error };
    }
  } else {
    console.error('[TEST] No rotation function available');
    return { success: false, error: 'No rotation function' };
  }
    
  // Step 6: Record positions after rotation
  console.log('[TEST] Recording label positions after rotation...');
  const afterRotation = {};
  const results = [];
    
  for (const label of Object.keys(customOffsets)) {
    const pos = window.labelCanvasPosition ? window.labelCanvasPosition(img, label) : null;
    afterRotation[label] = pos;
        
    const before = beforeRotation[label];
    const after = pos;
    const moved = before && after ? Math.sqrt(Math.pow(after.x - before.x, 2) + Math.pow(after.y - before.y, 2)) : 0;
    const rotated = moved > 10; // Consider it rotated if moved more than 10 pixels
        
    results.push({
      label,
      beforePos: before,
      afterPos: after,
      distance: moved,
      rotated
    });
        
    console.log(`[TEST] After:  ${label} at (${pos?.x?.toFixed(1) || 'N/A'}, ${pos?.y?.toFixed(1) || 'N/A'}) [moved: ${moved.toFixed(1)}px, rotated: ${rotated}]`);
  }
    
  // Step 7: Analyze results
  const rotatedLabels = results.filter(r => r.rotated);
  const success = rotatedLabels.length === results.length;
    
  console.log('[TEST] ===== TEST RESULTS =====');
  console.log(`[TEST] Labels that rotated: ${rotatedLabels.length}/${results.length}`);
  console.log(`[TEST] Fix successful: ${success ? 'YES' : 'NO'}`);
    
  if (success) {
    console.log('[TEST] � SUCCESS: All custom labels rotated with their strokes!');
  } else {
    console.log('[TEST] ❌ FAILURE: Some labels did not rotate properly');
    const failedLabels = results.filter(r => !r.rotated);
    failedLabels.forEach(result => {
      console.log(`[TEST] - ${result.label}: only moved ${result.distance.toFixed(1)}px`);
    });
  }
    
  return {
    success,
    rotatedLabels: rotatedLabels.length,
    totalLabels: results.length,
    results
  };
};

// Direct fix for custom label rotation issue (legacy function)
window.fixCustomLabelRotation = function(imageLabel) {
  console.log('[FIX] Legacy fix function called - running new test instead...');
  return window.testCustomLabelRotationFix(imageLabel);
};

// Create custom label positions test to demonstrate the rotation bug
window.runCustomLabelRotationTest = async function(imageLabel = 'Image 1') {
  const img = imageLabel;
  console.log(`[CUSTOM-ROT-TEST] Starting custom label rotation test for ${img}`);
    
  // Initialize the cross pattern
  const baseline = window.initCrossBaseline(img);
  console.log('[CUSTOM-ROT-TEST] Initialized cross pattern:', baseline);
    
  // Now programmatically create custom label positions
  // This simulates the user dragging labels to custom positions
  const canvas = document.getElementById('canvas');
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const customOffset = 50; // pixels away from calculated position
    
  // Initialize custom positions if not exists
  if (!window.customLabelPositions) window.customLabelPositions = {};
  if (!window.customLabelPositions[img]) window.customLabelPositions[img] = {};
    
  // Create custom positions for each label - offset from their calculated positions
  const customPositions = {
    'A1': { x: centerX + 120, y: centerY - customOffset }, // Right stroke, label moved up-right
    'A2': { x: centerX + customOffset, y: centerY - 120 }, // Up stroke, label moved up-right  
    'A3': { x: centerX - 120, y: centerY + customOffset }, // Left stroke, label moved down-left
    'A4': { x: centerX - customOffset, y: centerY + 120 }  // Down stroke, label moved down-left
  };
    
  // Set the custom positions
  for (const [label, pos] of Object.entries(customPositions)) {
    window.customLabelPositions[img][label] = pos;
  }
    
  console.log('[CUSTOM-ROT-TEST] Set custom label positions:', customPositions);
    
  // Force redraw to show the custom positions
  if (window.redrawCanvas) {
    window.redrawCanvas();
  }
    
  // Wait a moment for the redraw
  await new Promise(resolve => {
    requestAnimationFrame(() => {
      requestAnimationFrame(resolve);
    });
  });
    
  // Now test the current positions before rotation
  const beforeRotation = {};
  for (const label of ['A1', 'A2', 'A3', 'A4']) {
    const pos = labelCanvasPosition(img, label);
    beforeRotation[label] = pos;
    console.log(`[CUSTOM-ROT-TEST] Before rotation - ${label}: (${pos?.x.toFixed(1)}, ${pos?.y.toFixed(1)})`);
  }
    
  // Perform one 90-degree CCW rotation
  console.log('[CUSTOM-ROT-TEST] Performing 90-degree CCW rotation...');
  await rotateFn90CCW(img);
    
  // Wait for rotation to complete
  await new Promise(resolve => {
    requestAnimationFrame(() => {
      requestAnimationFrame(resolve);
    });
  });
    
  // Check positions after rotation
  const afterRotation = {};
  const bugDemonstration = [];
    
  for (const label of ['A1', 'A2', 'A3', 'A4']) {
    const pos = labelCanvasPosition(img, label);
    afterRotation[label] = pos;
        
    const before = beforeRotation[label];
    const after = pos;
        
    if (before && after) {
      // For custom labels, we expect them to have rotated with their strokes
      // But the bug is that they DON'T rotate - they stay in their original positions
      const didMove = dist(before, after) > 1; // 1px tolerance
            
      bugDemonstration.push({
        label,
        beforePos: before,
        afterPos: after,
        moved: didMove,
        distance: dist(before, after)
      });
            
      console.log(`[CUSTOM-ROT-TEST] After rotation - ${label}: (${after.x.toFixed(1)}, ${after.y.toFixed(1)}) [moved: ${didMove}, distance: ${dist(before, after).toFixed(1)}px]`);
    }
  }
    
  // Analyze the bug
  const customLabelsDidNotRotate = bugDemonstration.filter(item => !item.moved);
  const bugDetected = customLabelsDidNotRotate.length > 0;
    
  if (bugDetected) {
    console.error(`[CUSTOM-ROT-TEST] BUG DETECTED! ${customLabelsDidNotRotate.length}/4 custom labels did not rotate with their strokes:`);
    customLabelsDidNotRotate.forEach(item => {
      console.error(`  ${item.label}: stayed at (${item.beforePos.x.toFixed(1)}, ${item.beforePos.y.toFixed(1)}) instead of rotating`);
    });
  } else {
    console.log('[CUSTOM-ROT-TEST] All custom labels rotated correctly (this would indicate the bug is fixed)');
  }
    
  return {
    bugDetected,
    beforeRotation,
    afterRotation,
    customLabelsAffected: customLabelsDidNotRotate,
    allLabels: bugDemonstration
  };
};

/**
 * Find text element at a given canvas point
 */
function findTextElementAtPoint(canvasX, canvasY) {
  const currentImageLabel = window.paintApp?.state?.currentImageLabel || window.currentImageLabel || 'front';
  const textElements = window.paintApp?.state?.textElementsByImage?.[currentImageLabel] || [];
    
    
  for (let i = textElements.length - 1; i >= 0; i--) {
    const el = textElements[i];
    if (!el.visible) continue;
        
    // Use canvas coordinates directly if available (new system), otherwise convert from world coords (old system)
    const canvasCoords = el.useCanvasCoords ? 
      { x: el.x, y: el.y } :
      (window.worldToClient ? 
        window.worldToClient(el.x, el.y) : 
        { x: el.x, y: el.y });
        
        
    // Check if point is within text element bounds
    if (canvasX >= canvasCoords.x && 
            canvasX <= canvasCoords.x + el.width &&
            canvasY >= canvasCoords.y && 
            canvasY <= canvasCoords.y + el.height) {
      return { element: el, index: i };
    }
  }
    
  return null;
}

/**
 * Open text editor for an existing text element (used for double-click editing)
 */
function openTextEditor(targetElement) {
  try {
    const currentImageLabel = window.paintApp?.state?.currentImageLabel || window.currentImageLabel || 'front';
    const textElements = window.paintApp?.state?.textElementsByImage?.[currentImageLabel] || [];
    const textElement = textElements.find(el => el.id === targetElement.id);

    if (!textElement) {
      console.warn('[OPEN TEXT EDITOR] Text element not found for id', targetElement.id);
      return;
    }

    // Use canvas coordinates directly if available
    const canvasCoords = textElement.useCanvasCoords ?
      { x: textElement.x, y: textElement.y } :
      (window.worldToClient ?
        window.worldToClient(textElement.x, textElement.y) :
        { x: textElement.x, y: textElement.y });

    const editBox = document.createElement('div');
    editBox.contentEditable = true;
    editBox.textContent = textElement.text || '';
    editBox.style.cssText = `
            position: absolute;
            left: ${canvasCoords.x}px;
            top: ${canvasCoords.y}px;
            min-width: 120px;
            min-height: 40px;
            width: ${Math.max(150, textElement.width || 150)}px;
            height: ${Math.max(40, textElement.height || 40)}px;
            padding: 12px 16px;
            border: 3px solid #3b82f6;
            border-radius: 8px;
            background: rgba(255, 255, 255, 0.98);
            backdrop-filter: blur(8px);
            font-family: ${textElement.fontFamily || "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"};
            font-size: ${textElement.fontSize || 14}px;
            font-weight: 500;
            color: ${textElement.color || '#1f2937'};
            outline: none;
            cursor: text;
            user-select: text;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
            transition: all 0.2s ease;
            z-index: 1001;
        `;
        
    const saveAndClose = () => {
      const newText = editBox.textContent.trim();
            
      // Save in canvas coordinates (matching the new system)
      const canvas = document.getElementById('canvas');
      const canvasRect = canvas.getBoundingClientRect();
      const editBoxRect = editBox.getBoundingClientRect();
      const canvasRelativeX = editBoxRect.left - canvasRect.left;
      const canvasRelativeY = editBoxRect.top - canvasRect.top;

      textElement.text = newText || textElement.text;
      textElement.x = canvasRelativeX;
      textElement.y = canvasRelativeY;
      textElement.width = editBox.offsetWidth;
      textElement.height = editBox.offsetHeight;
      textElement.useCanvasCoords = true; // Flag to use canvas coordinates

      // Note: Text elements are managed separately; no canvas state save needed
      // saveState(true, false);  // REMOVED: Was creating phantom stroke entries
            
      if (typeof redrawCanvasWithVisibility === 'function') {
        redrawCanvasWithVisibility();
      }
      if (typeof updateStrokeVisibilityControls === 'function') {
        updateStrokeVisibilityControls();
      }
      editBox.remove();
    };

    // Auto-resize height as content grows
    const autoResize = () => {
      editBox.style.height = 'auto';
      editBox.style.height = Math.max(40, editBox.scrollHeight) + 'px';
    };
        
    editBox.addEventListener('input', autoResize);
        
    editBox.addEventListener('keydown', (ev) => {
      // Prevent arrow keys from propagating to sidebar navigation
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(ev.key)) {
        ev.stopPropagation();
      }
            
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        saveAndClose();
      } else if (ev.key === 'Escape') {
        editBox.remove();
      }
    });
        
    editBox.addEventListener('blur', () => {
      setTimeout(() => {
        if (document.body.contains(editBox)) {
          saveAndClose();
        }
      }, 50);
    });
        
    document.body.appendChild(editBox);
        
    setTimeout(() => {
      editBox.focus();
      if (window.getSelection && window.getSelection().selectAllChildren) {
        window.getSelection().selectAllChildren(editBox);
      }
    }, 0);
  } catch (error) {
    console.error('[OPEN TEXT EDITOR] Failed to open editor', error);
  }
}

/**
 * Helper function to wrap text for canvas rendering
 */
function wrapCanvasText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = words[0];

  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    const width = ctx.measureText(currentLine + ' ' + word).width;
    if (width < maxWidth) {
      currentLine += ' ' + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  lines.push(currentLine);
  return lines;
}

/**
 * Share Project Functionality
 * Creates shareable URLs for customer measurement collection
 */
window.shareProject = async function() {
  let originalText = '';
  try {
    // Show loading state
    const shareBtn = document.getElementById('shareProjectBtn');
    if (shareBtn) originalText = shareBtn.textContent;
    shareBtn.textContent = 'Creating Share Link...';
    shareBtn.disabled = true;
        
    // Prepare images as data URLs for portability across tabs
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
          if (dataUrl) result[label] = dataUrl;
        }
      }
      return result;
    }

    const originalImagesForShare = await convertOriginalImages(window.originalImages || {});

    // Determine robust image label list
    const labelsFromOrder = Array.isArray(window.orderedImageLabels) && window.orderedImageLabels.length ? window.orderedImageLabels.slice() : [];
    const labelsFromTags = Object.keys(window.imageTags || {});
    const labelsFromImages = Object.keys(window.originalImages || {});
    const labelsFromState = (window.paintApp && window.paintApp.state && Array.isArray(window.paintApp.state.imageLabels)) ? window.paintApp.state.imageLabels : [];
    const imageLabels = (labelsFromOrder.length ? labelsFromOrder
      : (labelsFromTags.length ? labelsFromTags
        : (labelsFromImages.length ? labelsFromImages
          : labelsFromState)));
    const currentImageLabel = (window.paintApp && window.paintApp.state && window.paintApp.state.currentImageLabel) || imageLabels[0] || null;

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
      imageScales: window.paintApp.state.imageScaleByLabel || {},
      imagePositions: window.paintApp.state.imagePositionByLabel || {},
      customImageNames: window.customImageNames || {}
    };

    // Include custom label positions and rotation stamps for accurate label placement
    try {
      projectData.customLabelPositions = {};
      imageLabels.forEach(label => {
        projectData.customLabelPositions[label] = (window.customLabelPositions && window.customLabelPositions[label])
          ? JSON.parse(JSON.stringify(window.customLabelPositions[label]))
          : {};
      });
      if (window.customLabelOffsetsRotationByImageAndStroke) {
        projectData.customLabelRotationStamps = {};
        imageLabels.forEach(label => {
          projectData.customLabelRotationStamps[label] = window.customLabelOffsetsRotationByImageAndStroke[label]
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
      measurements: {}
    };
        
    // Send to backend
    const response = await fetch('/api/share-project', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: (document.getElementById('projectName')?.value || 'OpenPaint Project'),
        projectData: projectData,
        shareOptions: shareOptions
      })
    });
        
    const result = await response.json();
        
    if (!result.success) {
      throw new Error(result.message || 'Failed to create share link');
    }
        
    // Show share dialog
    showShareDialog(result.shareUrl, result.expiresAt);
        
    // Show success message
    if (typeof window.projectManager?.showStatusMessage === 'function') {
      window.projectManager.showStatusMessage('Share link created successfully!', 'success');
    }

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
        
    if (typeof window.projectManager?.showStatusMessage === 'function') {
      window.projectManager.showStatusMessage('Failed to create share link: ' + error.message, 'error');
    } else {
      alert('Failed to create share link: ' + error.message);
    }
  } finally {
    // Restore button state
    const shareBtn = document.getElementById('shareProjectBtn');
    if (shareBtn) {
      shareBtn.textContent = originalText || 'Share Project';
      shareBtn.disabled = false;
    }
  }
};

// Update an existing shared project using saved editToken
window.updateSharedProject = async function() {
  try {
    const shareId = window.lastShareId || (window.localStorage && localStorage.getItem('openpaint:lastShareId'));
    const editToken = window.lastEditToken || (window.localStorage && localStorage.getItem('openpaint:lastEditToken'));
    if (!shareId || !editToken) {
      const msg = 'No existing share info found. Create a share link first.';
      if (typeof window.projectManager?.showStatusMessage === 'function') {
        window.projectManager.showStatusMessage(msg, 'error');
      } else {
        alert(msg);
      }
      return;
    }

    const btn = document.getElementById('updateShareBtn');
    const originalText = btn ? btn.textContent : '';
    if (btn) { btn.textContent = 'Updating...'; btn.disabled = true; }

    const projectData = {
      currentImageLabel: window.paintApp.state.currentImageLabel,
      imageLabels: window.paintApp.state.imageLabels || [],
      originalImages: window.originalImages || {},
      originalImageDimensions: window.originalImageDimensions || {},
      strokes: window.vectorStrokesByImage || {},
      strokeVisibility: window.strokeVisibilityByImage || {},
      strokeSequence: window.lineStrokesByImage || {},
      strokeMeasurements: window.strokeMeasurements || {},
      strokeLabelVisibility: window.strokeLabelVisibility || {},
      imageScales: window.paintApp.state.imageScaleByLabel || {},
      imagePositions: window.paintApp.state.imagePositionByLabel || {},
      customImageNames: window.customImageNames || {}
    };

    const response = await fetch(`/api/shared/${shareId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        editToken,
        title: (document.getElementById('projectName')?.value || null),
        projectData,
        shareOptions: {}
      })
    });
    const result = await response.json();
    if (!result.success) {
      throw new Error(result.message || 'Failed to update shared project');
    }

    if (typeof window.projectManager?.showStatusMessage === 'function') {
      window.projectManager.showStatusMessage('Shared project updated.', 'success');
    }
  } catch (error) {
    console.error('Error updating shared project:', error);
    if (typeof window.projectManager?.showStatusMessage === 'function') {
      window.projectManager.showStatusMessage('Failed to update share: ' + error.message, 'error');
    } else {
      alert('Failed to update share: ' + error.message);
    }
  } finally {
    const btn = document.getElementById('updateShareBtn');
    if (btn) { btn.textContent = 'Update Share'; btn.disabled = false; }
  }
};

/**
 * Show share dialog with the generated URL
 */
function showShareDialog(shareUrl, expiresAt) {
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
        max-width: 500px;
        width: 90%;
        box-shadow: 0 20px 40px rgba(0,0,0,0.2);
    `;
    
  const expiryDate = new Date(expiresAt).toLocaleDateString();
    
  dialog.innerHTML = `
        <h2 style="color: #2c3e50; margin: 0 0 20px 0; font-size: 1.5em;">?? Project Share Link Created</h2>
        
        <p style="color: #555; margin-bottom: 20px;">
            Share this link with your customers to collect their measurements:
        </p>
        
        <div style="background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 15px; margin-bottom: 20px;">
            <input 
                type="text" 
                id="shareUrlInput" 
                value="${shareUrl}" 
                readonly 
                style="width: 100%; border: none; background: transparent; font-family: monospace; font-size: 14px; outline: none;"
            >
        </div>
        
        <div style="display: flex; gap: 10px; margin-bottom: 20px;">
            <button 
                id="copyUrlBtn" 
                style="flex: 1; background: #007bff; color: white; border: none; padding: 12px; border-radius: 8px; cursor: pointer; font-weight: 600;"
            >
                ?? Copy Link
            </button>
            <button 
                id="openUrlBtn" 
                style="flex: 1; background: #28a745; color: white; border: none; padding: 12px; border-radius: 8px; cursor: pointer; font-weight: 600;"
            >
                ?? Open Link
            </button>
        </div>
        
        <p style="color: #666; font-size: 12px; margin-bottom: 20px;">
            ? Link expires: ${expiryDate}
        </p>
        
        <div style="text-align: center;">
            <button 
                id="closeModalBtn" 
                style="background: #6c757d; color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer;"
            >
                Close
            </button>
        </div>
    `;
    
  modal.appendChild(dialog);
  document.body.appendChild(modal);
    
  // Event listeners
  document.getElementById('copyUrlBtn').addEventListener('click', async () => {
    const input = document.getElementById('shareUrlInput');
    input.select();
        
    try {
      await navigator.clipboard.writeText(shareUrl);
      const btn = document.getElementById('copyUrlBtn');
      const originalText = btn.textContent;
      btn.textContent = '� Copied!';
      btn.style.background = '#28a745';
            
      setTimeout(() => {
        btn.textContent = originalText;
        btn.style.background = '#007bff';
      }, 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
      document.execCommand('copy');
    }
  });
    
  document.getElementById('openUrlBtn').addEventListener('click', () => {
    window.open(shareUrl, '_blank');
  });
    
  document.getElementById('closeModalBtn').addEventListener('click', () => {
    document.body.removeChild(modal);
  });
    
  // Close on background click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
    }
  });
    
  // Auto-select URL text
  setTimeout(() => {
    document.getElementById('shareUrlInput').select();
  }, 100);
}

// Helper function to find text element at a point (x, y are in canvas coordinates)
// Note: Duplicate function removed - using the one defined earlier around line 17547

// Helper function to wrap text for canvas rendering
function wrapCanvasText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = words[0];

  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    const width = ctx.measureText(currentLine + ' ' + word).width;
    if (width < maxWidth) {
      currentLine += ' ' + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  lines.push(currentLine);
  return lines;
}

// Text box creation function
function createTextBox(x, y) {
  // Store the original click position (where text content should appear)
  const contentX = x;
  const contentY = y;
        
  // Create container for text box and controls
  const container = document.createElement('div');
  container.className = 'text-box-container';
  // Store content position as data attribute for saving later
  container.dataset.contentX = contentX;
  container.dataset.contentY = contentY;
  container.style.cssText = `
            position: absolute;
            left: ${x}px;
            top: ${y}px;
            z-index: 1000;
        `;
    
  // Create text box wrapper with resize handles
  const textBoxWrapper = document.createElement('div');
  textBoxWrapper.style.cssText = `
        position: relative;
        min-width: 100px;
        min-height: 30px;
        width: 150px;
        height: auto;
        border: 2px solid #3b82f6;
        border-radius: 4px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        box-sizing: border-box;
    `;
    
  // Create contenteditable text box
  const textBox = document.createElement('div');
  textBox.className = 'text-box';
  textBox.contentEditable = true;
    
  // Background is now controlled per-element in the stroke visibility controls
  // Default: transparent background (hasWhiteBackground = false)
  textBox.style.cssText = `
        padding: 8px;
        background: transparent;
        font-family: Arial, sans-serif;
        font-size: 16px;
        color: #1f2937;
        overflow: auto;
        outline: none;
        box-sizing: border-box;
        cursor: text;
        user-select: text;
        min-height: 30px;
        word-wrap: break-word;
    `;
    
  // Add placeholder text
  textBox.textContent = 'Type here...';
    
  textBoxWrapper.appendChild(textBox);
  container.appendChild(textBoxWrapper);
    
  // Remove placeholder on focus
  textBox.addEventListener('focus', () => {
    if (textBox.textContent === 'Type here...') {
      textBox.textContent = '';
    }
  });
    
  // Auto-resize height as content grows
  const autoResize = () => {
    if (textBox.textContent.trim() && textBox.textContent !== 'Type here...') {
      const currentHeight = textBox.scrollHeight;
      if (currentHeight > 30) {
        textBoxWrapper.style.height = 'auto';
      }
    }
  };
    
  textBox.addEventListener('input', autoResize);
    
  // Handle keydown events
  textBox.addEventListener('keydown', (e) => {
    // Prevent arrow keys from propagating to sidebar navigation
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.stopPropagation();
    }
        
    if (e.key === 'Escape') {
      if (typeof window.restorePreviousDrawingMode === 'function') {
        window.restorePreviousDrawingMode();
      }
      container.remove();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      saveTextElement();
      container.remove();
            
      if (typeof window.restorePreviousDrawingMode === 'function') {
        window.restorePreviousDrawingMode();
      }
      return;
    }
  });
    
  // Add to document body (overlay above canvas)
  document.body.appendChild(container);

  // Make the entire wrapper draggable (user can drag from anywhere)
  let dragStart = null;
  let isDragging = false;
    
  textBoxWrapper.addEventListener('mousedown', (ev) => {
    // Allow dragging from wrapper, but not from text box itself when typing
    if (ev.target === textBoxWrapper || ev.target.closest('.text-box') === null) {
      dragStart = { mx: ev.clientX, my: ev.clientY, x: container.offsetLeft, y: container.offsetTop };
      isDragging = false;
    }
  });
    
  const handleMouseMove = (ev) => {
    if (!dragStart) return;
        
    const dx = ev.clientX - dragStart.mx;
    const dy = ev.clientY - dragStart.my;
        
    // Only start dragging if moved more than 3 pixels (prevents accidental drags while clicking)
    if (!isDragging && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
      isDragging = true;
    }
        
    if (isDragging) {
      container.style.left = (dragStart.x + dx) + 'px';
      container.style.top = (dragStart.y + dy) + 'px';
    }
  };
    
  const handleMouseUp = () => {
    dragStart = null;
    isDragging = false;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };
    
  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', handleMouseUp);

  // Save text element when user finishes editing
  const saveTextElement = () => {
    const label = window.paintApp.state.currentImageLabel || window.currentImageLabel || 'front';
    if (!window.paintApp.state.textElementsByImage) {
      window.paintApp.state.textElementsByImage = {};
    }
    if (!window.paintApp.state.textElementsByImage[label]) {
      window.paintApp.state.textElementsByImage[label] = [];
    }
    const text = textBox.textContent.trim();
        
    if (text && text !== 'Type here...') {
      // Get canvas element
      const canvas = document.getElementById('canvas');
      const canvasRect = canvas.getBoundingClientRect();
            
      // Get the wrapper's position and size (the blue bordered box)
      // getBoundingClientRect() includes the border, but we need to render it ourselves on canvas
      const wrapperRect = textBoxWrapper.getBoundingClientRect();
            
      // The wrapper has a 2px border that's rendered by CSS INSIDE the bounding rect
      // When we draw on canvas, we need to match this exactly
      // Save the outer edge position (which matches the wrapper's visual position)
      const canvasRelativeX = wrapperRect.left - canvasRect.left;
      const canvasRelativeY = wrapperRect.top - canvasRect.top;
            
      console.log('[SAVE TEXT DEBUG] wrapperRect:', {left: wrapperRect.left, top: wrapperRect.top, width: wrapperRect.width, height: wrapperRect.height});
      console.log('[SAVE TEXT DEBUG] canvasRect:', {left: canvasRect.left, top: canvasRect.top});
      console.log('[SAVE TEXT DEBUG] Calculated canvas coords:', {x: canvasRelativeX, y: canvasRelativeY});
            
      // Capture computed styles from the preview textBox to ensure exact rendering match
      const computedStyle = window.getComputedStyle(textBox);
      const fontSize = parseFloat(computedStyle.fontSize) || 16;
      const fontFamily = computedStyle.fontFamily || 'Arial, sans-serif';
      const fontWeight = computedStyle.fontWeight || 'normal';
      const letterSpacing = computedStyle.letterSpacing || 'normal';
      const lineHeight = computedStyle.lineHeight || 'normal';
      const color = computedStyle.color || '#1f2937';
            
      // Also capture computed border and padding from wrapper
      const wrapperStyle = window.getComputedStyle(textBoxWrapper);
      const borderWidth = parseFloat(wrapperStyle.borderTopWidth) || 2;
      const padding = parseFloat(computedStyle.padding) || 8;
            
      console.log('[SAVE TEXT DEBUG] Computed styles:', {
        fontSize, fontFamily, fontWeight, letterSpacing, lineHeight, color,
        borderWidth, padding
      });
            
      // Determine coordinate space based on whether there's an image
      const transformParams = window.getTransformationParams ? window.getTransformationParams(label) : null;
      let textX, textY, useCanvasCoords;
      
      console.log('[SAVE TEXT DEBUG] Transform params:', transformParams);
      console.log('[SAVE TEXT DEBUG] Has image check:', transformParams && transformParams.hasImage);
      
      if (transformParams && transformParams.hasImage) {
        // For images, convert canvas coordinates to image space so text rotates with image
        const imageCoords = window.canvasToImageCoords ? window.canvasToImageCoords(canvasRelativeX, canvasRelativeY, transformParams) : {x: canvasRelativeX, y: canvasRelativeY};
        textX = imageCoords.x;
        textY = imageCoords.y;
        useCanvasCoords = false;
        console.log('[SAVE TEXT DEBUG] Image mode: Canvas coords', canvasRelativeX, canvasRelativeY, '-> Image coords', textX.toFixed(1), textY.toFixed(1));
      } else {
        // For blank canvas, use canvas coordinates
        textX = canvasRelativeX;
        textY = canvasRelativeY;
        useCanvasCoords = true;
        console.log('[SAVE TEXT DEBUG] Canvas mode: Using canvas coords', textX, textY);
      }
      
      const data = {
        id: 'text_' + Date.now(),
        x: textX,
        y: textY,
        width: wrapperRect.width,
        height: wrapperRect.height,
        text: text,
        fontSize: fontSize,
        fontFamily: fontFamily,
        fontWeight: fontWeight,
        letterSpacing: letterSpacing,
        lineHeight: lineHeight,
        color: color,
        borderWidth: borderWidth,
        padding: padding,
        hasWhiteBackground: false, // Default: transparent background (user can toggle in stroke visibility controls)
        visible: true,
        useCanvasCoords: useCanvasCoords
      };
      window.paintApp.state.textElementsByImage[label].push(data);
      try { saveState(true, false, false); } catch(_) {}
      try { redrawCanvasWithVisibility(); } catch(_) {}
      try { updateStrokeVisibilityControls(); } catch(_) {}
    }
  };
    
  // Focus the text box
  setTimeout(() => {
    textBox.focus();
    if (window.getSelection && window.getSelection().selectAllChildren) {
      window.getSelection().selectAllChildren(textBox);
    }
  }, 50);
}

// Ensure file terminates cleanly; prevents "Unexpected end of input" if a prior block failed to auto-close


/**
 * AI Export Integration
 * Handles AI-enhanced SVG generation and preview
 */
(function initAIExport() {
  const aiExportBtn = document.getElementById('exportAISVG');
  if (!aiExportBtn) {
    console.warn('[AI Export] Button not found');
    return;
  }
    
  aiExportBtn.addEventListener('click', async () => {
    try {
      console.log('[AI Export] Starting export...');
      aiExportBtn.disabled = true;
      aiExportBtn.textContent = 'Generating...';
            
      // Get current units
      const units = {
        name: window.currentUnit || 'cm',
        pxPerUnit: window.pxPerUnit || 37.8
      };
            
      const result = await window.exportAIEnhancedSVG({ units });
      showAIPreview(result);
    } catch (error) {
      console.error('[AI Export] Failed:', error);
      alert('AI export failed: ' + error.message + '\n\nPlease use manual export instead.');
    } finally {
      aiExportBtn.disabled = false;
      const longLabel = aiExportBtn.querySelector('.label-long');
      const shortLabel = aiExportBtn.querySelector('.label-short');
      if (longLabel) longLabel.textContent = 'AI SVG Export';
      if (shortLabel) shortLabel.textContent = 'AI SVG';
    }
  });
    
  function showAIPreview(result) {
    const modal = document.getElementById('aiPreviewModal');
    const container = document.getElementById('aiPreviewContainer');
        
    if (!modal || !container) {
      console.error('[AI Export] Modal elements not found');
      return;
    }
        
    // Insert SVG
    container.innerHTML = result.svg;
    modal.classList.remove('hidden');
        
    // Get current image dimensions for PNG export
    const imageLabel = window.currentImageLabel;
    const dims = window.originalImageDimensions?.[imageLabel];
        
    // Wire up buttons
    const acceptBtn = document.getElementById('aiAccept');
    const saveBtn = document.getElementById('aiSaveToProject');
    const downloadSVGBtn = document.getElementById('aiDownloadSVG');
    const downloadPNGBtn = document.getElementById('aiDownloadPNG');
    const cancelBtn = document.getElementById('aiCancel');
        
    // Remove old listeners by cloning
    const newAcceptBtn = acceptBtn.cloneNode(true);
    const newSaveBtn = saveBtn.cloneNode(true);
    const newDownloadSVGBtn = downloadSVGBtn.cloneNode(true);
    const newDownloadPNGBtn = downloadPNGBtn.cloneNode(true);
    const newCancelBtn = cancelBtn.cloneNode(true);
        
    acceptBtn.parentNode.replaceChild(newAcceptBtn, acceptBtn);
    saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
    downloadSVGBtn.parentNode.replaceChild(newDownloadSVGBtn, downloadSVGBtn);
    downloadPNGBtn.parentNode.replaceChild(newDownloadPNGBtn, downloadPNGBtn);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
        
    newAcceptBtn.onclick = () => {
      console.log('[AI Export] Accepting AI vectors (not yet implemented)');
      // Future: Replace current annotations with AI vectors
      modal.classList.add('hidden');
    };
        
    newSaveBtn.onclick = () => {
      // Save AI export to project
      if (!window.aiExports) window.aiExports = {};
      window.aiExports[imageLabel] = {
        svg: result.svg,
        vectors: result.vectors,
        summary: result.summary,
        timestamp: new Date().toISOString()
      };
      console.log('[AI Export] Saved to project');
      alert('AI export saved to project');
      modal.classList.add('hidden');
    };
        
    newDownloadSVGBtn.onclick = () => {
      const filename = `${imageLabel || 'export'}-ai.svg`;
      window.downloadBlob(result.svg, filename, 'image/svg+xml');
      console.log('[AI Export] Downloaded SVG:', filename);
    };
        
    newDownloadPNGBtn.onclick = async () => {
      try {
        const width = dims?.width || 800;
        const height = dims?.height || 600;
        const png = await window.svgToPNG(result.svg, width, height);
        const filename = `${imageLabel || 'export'}-ai.png`;
        window.downloadBlob(png, filename, 'image/png');
        console.log('[AI Export] Downloaded PNG:', filename);
      } catch (error) {
        console.error('[AI Export] PNG export failed:', error);
        alert('PNG export failed: ' + error.message);
      }
    };
        
    newCancelBtn.onclick = () => {
      modal.classList.add('hidden');
    };
  }
    
  console.log('[AI Export] Initialized');
})();

// Cache bust: 20250912170000