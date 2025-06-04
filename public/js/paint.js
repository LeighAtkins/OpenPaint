// Define global variables for use by project-manager.js
window.IMAGE_LABELS = ['front', 'side', 'back', 'cushion'];
window.currentImageLabel = 'front';
window.vectorStrokesByImage = {};
window.strokeVisibilityByImage = {};
window.strokeLabelVisibility = {};
window.strokeMeasurements = {}; // This variable should be accessible globally
window.imageScaleByLabel = {};
window.imagePositionByLabel = {};
window.lineStrokesByImage = {}; // <--- NOTE: This should now be global due to previous fix
window.labelsByImage = {};      // <--- NOTE: This should now be global due to previous fix
window.originalImages = {};
window.imageTags = {};          // <--- NEW: Store image tags
window.isLoadingProject = false; // <-- Re-adding this line

// Control point dragging variables
let isDraggingControlPoint = false;
let draggedControlPointInfo = null; // { strokeLabel, pointIndex, startPos }
window.folderStructure = {      // <--- NEW: Add folder structure support
    "root": {
        id: "root",
        name: "Root",
        type: "folder",
        parentId: null,
        children: []
    }
};
window.selectedStrokeByImage = {}; // Single stroke selection (kept for backward compatibility)
window.multipleSelectedStrokesByImage = {}; // NEW: Multiple stroke selection support
// Add counters for each image label type to ensure uniqueness
window.labelCounters = {
    front: 0,
    side: 0,
    back: 0,
    cushion: 0
};

// Global variables and initialization
window.vectorStrokesByImage = {};
window.lineStrokesByImage = {};
window.selectedStrokeByImage = {};
window.multipleSelectedStrokesByImage = {};
window.customLabelPositions = {};
window.calculatedLabelOffsets = {};
window.strokeVisibilityByImage = {};
window.strokeLabelVisibility = {};
window.selectedStrokeInEditMode = null; // Track which stroke is in edit mode
window.lastClickTime = 0; // For tracking double-clicks
window.lastCanvasClickTime = 0; // For tracking double-clicks on canvas
window.clickDelay = 300; // Milliseconds to wait for double-click

document.addEventListener('DOMContentLoaded', () => {
    // Initialize unit selectors
    const unitSelector = document.getElementById('unitSelector');
    unitSelector.addEventListener('change', updateMeasurementDisplay);
    
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
        cmValue.value = (totalInches * 2.54).toFixed(1);
    });
    
    inchFraction.addEventListener('change', () => {
        const whole = parseInt(inchWhole.value) || 0;
        const fraction = parseFloat(inchFraction.value) || 0;
        const totalInches = whole + fraction;
        
        // Update cm value
        cmValue.value = (totalInches * 2.54).toFixed(1);
    });
    
    cmValue.addEventListener('change', () => {
        const cm = parseFloat(cmValue.value) || 0;
        const inches = cm / 2.54;
        
        // Update inch values
        inchWhole.value = Math.floor(inches);
        
        // Find closest fraction
        const fractionPart = inches - Math.floor(inches);
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
        
        inchFraction.value = closestFraction;
        
        // Show inch inputs, hide cm inputs
        document.getElementById('inchInputs').style.display = 'flex';
        document.getElementById('cmInputs').style.display = 'none';
    });
    
    const canvas = document.getElementById('canvas');
    // Expose canvas globally for project management
    window.canvas = canvas;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); // Add willReadFrequently hint
    const colorPicker = document.getElementById('colorPicker');
    const brushSize = document.getElementById('brushSize');
    const clearButton = document.getElementById('clear');
    const saveButton = document.getElementById('save');
    const pasteButton = document.getElementById('paste');
    const strokeCounter = document.getElementById('strokeCounter');
    const imageList = document.getElementById('imageList');
    const drawingModeToggle = document.getElementById('drawingModeToggle');
    
    // Draggable sidebars
    const strokeSidebar = document.getElementById('strokeSidebar');
    const imageSidebar = document.getElementById('imageSidebar');
    const strokeSidebarHeader = document.getElementById('strokeSidebarHeader');
    const imageSidebarHeader = document.getElementById('imageSidebarHeader');

    // Undo/Redo functionality
    const MAX_HISTORY = 50;  // Maximum number of states to store
    const IMAGE_LABELS = ['front', 'side', 'back', 'cushion'];
    let currentImageIndex = 0;
    let imageStates = {}; // Store states for each image
    lineStrokesByImage = {}; // Track strokes for each image
    let strokeVisibilityByImage = {}; // Track visibility of each stroke
    let strokeDataByImage = {}; // Store additional data for each stroke
    labelsByImage = {}; // Track current label for each image
    let undoStackByImage = {}; // Separate undo stack for each image
    let redoStackByImage = {}; // Separate redo stack for each image
    let pastedImages = [];  // Store all pasted images
    let isDrawingOrPasting = false;  // Flag to prevent saving states while drawing
    let strokeInProgress = false;  // Track if we're in the middle of a stroke
    let currentStroke = null;  // Store the state before current stroke
    let originalImageDimensions = {}; // Store original image dimensions for scaling
    let imagePositionByLabel = {}; // Track position offset for each image
    let isShiftPressed = false; // Track if Shift key is pressed for image movement
    let calculatedLabelOffsets = {}; // Store automatically calculated label offsets

    // Initialize states for default images
    IMAGE_LABELS.forEach(label => {
        lineStrokesByImage[label] = [];
        strokeVisibilityByImage[label] = {}; // Initialize stroke visibility
        strokeDataByImage[label] = {}; // Initialize stroke data
        labelsByImage[label] = 'A1';  // Start from A1 instead of A0
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

    let currentImageLabel = IMAGE_LABELS[0]; // Start with 'front'

    // Make addImageToSidebar available globally for the project manager
    window.addImageToSidebar = addImageToSidebar;
    function addImageToSidebar(imageUrl, label, filename) {
        // *** ADDED LOG ***
        console.log(`[addImageToSidebar] Called for label: ${label}, imageUrl: ${imageUrl ? imageUrl.substring(0,30) + '...' : 'null'}`);

        const container = document.createElement('div');
        container.className = 'image-container';
        container.dataset.label = label;
        container.dataset.originalImageUrl = imageUrl; // Store the original image URL for later restoration
        
        // Display the tag-based filename if available, otherwise display the label
        // MODIFIED: Use getTagBasedFilename immediately if available
        let displayName = label.split('_')[0]; // Default fallback
        // if (typeof window.getTagBasedFilename === 'function') {
        //     const tagBasedName = window.getTagBasedFilename(label, displayName); // Use default as fallback
        //     if (tagBasedName) {
        //         displayName = tagBasedName;
        //     }
        // }
        
        // Create image label (name display)
        const labelElement = document.createElement('div');
        labelElement.className = 'image-label';
        labelElement.textContent = displayName.charAt(0).toUpperCase() + displayName.slice(1);
        
        // Create tags container
        const tagsContainer = document.createElement('div');
        tagsContainer.className = 'image-tags';
        tagsContainer.dataset.label = label;
        
        // Add edit tags button
        const editTagsButton = document.createElement('button');
        editTagsButton.className = 'edit-tags-button';
        editTagsButton.textContent = 'Edit Tags';
        editTagsButton.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent container click
            
            // Show tag dialog
            if (window.showTagDialogForImage) {
                window.showTagDialogForImage(label);
            } else {
                console.error('[addImageToSidebar] showTagDialogForImage function not found!');
            }
        });
        
        // Add click handler to tags container to edit tags
        tagsContainer.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent container click
            
            // Show tag dialog
            if (window.showTagDialogForImage) {
                window.showTagDialogForImage(label);
            } else {
                console.error('[addImageToSidebar] showTagDialogForImage function not found!');
            }
        });
        
        // Create stroke count display
        const strokesElement = document.createElement('div');
        strokesElement.className = 'image-strokes';
        strokesElement.textContent = 'Strokes: 0';
        
        // Create scale display
        const scaleElement = document.createElement('div');
        scaleElement.className = 'image-scale';
        scaleElement.id = `scale-${label}`;
        
        // Create the image element
        const img = document.createElement('img');
        img.src = imageUrl;
        img.className = 'pasted-image';
        img.alt = `${label} view`;
        
        // Add all elements to container
        container.appendChild(img);
        container.appendChild(labelElement);
        container.appendChild(tagsContainer); // Add tags container
        container.appendChild(strokesElement);
        container.appendChild(scaleElement);
        container.appendChild(editTagsButton); // Add edit tags button
        
        // Set up click handler for switching images
        container.onclick = () => {
            // Store current state before switching
            saveState();
            
            // Switch to the new image
            switchToImage(label);
        };
        
        // Finally add to the sidebar
        document.getElementById('imageList').appendChild(container);
        console.log(`[addImageToSidebar] Successfully appended container for ${label}. #imageList children: ${document.getElementById('imageList').children.length}`);
        
        // Update the stroke count
        updateSidebarStrokeCounts();
    }
    

    // Store the original images for each view
    window.originalImages = window.originalImages || {};
    
    // --- MODIFIED Function Signature and Logic --- 
    function pasteImageFromUrl(url, label) {
        // Wrap in a Promise
        return new Promise((resolve, reject) => {
            console.log(`[pasteImageFromUrl] Pasting image for ${label}: ${url.substring(0, 30)}...`);
        
        const img = new Image();
        img.onload = () => {
            // Store the original image for this view
                window.originalImages[label] = url;
                
                // Ensure the object exists before setting properties
                if (!window.originalImageDimensions) {
                    window.originalImageDimensions = {};
                }
            
            // Store original dimensions for scaling
                window.originalImageDimensions[label] = {
                width: img.width,
                height: img.height
            };
                
                // Log dimensions for debugging
                console.log(`[pasteImageFromUrl] Stored dimensions for ${label}: ${img.width}x${img.height}`);
            
            // Clear the canvas first
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            // Apply current scale factor
                const scale = window.imageScaleByLabel[label] || 1.0; // Use passed-in label
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
                console.log(`[pasteImageFromUrl] Drawing image for ${label} at Canvas(${x.toFixed(1)}, ${y.toFixed(1)}) Scale: ${scale * 100}%`);
            ctx.drawImage(img, x, y, scaledWidth, scaledHeight);
            
            // Update the scale display in the sidebar
                const scaleElement = document.getElementById(`scale-${label}`);
            if (scaleElement) {
                scaleElement.textContent = `Scale: ${Math.round(scale * 100)}%`;
            }
            
            // Save this as the base state for this image
            const newState = getCanvasState();
                imageStates[label] = cloneImageData(newState); // Use passed-in label
                console.log(`[pasteImageFromUrl] State saved into imageStates[${label}]`);
                
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
                    console.log(`[pasteImageFromUrl] Initialized undo stack for ${label}`);
                }
            
                // Update the scale buttons to show active state if this is the current view
                if (label === currentImageLabel) {
            updateScaleButtonsActiveState();
                }
                
                console.log(`[pasteImageFromUrl] Image loaded and state saved for ${label}`);
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
        const currentLabel = labelsByImage[imageLabel];
        const letter = currentLabel[0];
        const number = parseInt(currentLabel.slice(1)) + 1;
        if (number > 9) {
            return String.fromCharCode(letter.charCodeAt(0) + 1) + '0';
        }
        return letter + number;
    }

    // Make updateStrokeCounter available globally
    window.updateStrokeCounter = updateStrokeCounter;
    function updateStrokeCounter() {
        const strokeCount = lineStrokesByImage[currentImageLabel]?.length || 0;
        strokeCounter.textContent = `Lines: ${strokeCount}`;
        
        // Update visibility controls
        updateStrokeVisibilityControls();
    }
    
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
        console.log(`[getMeasurementString] Called for ${strokeLabel} in ${currentImageLabel} view`);
        
        // Check if we have measurements for this image
        if (!window.strokeMeasurements[currentImageLabel]) {
            console.log(`[getMeasurementString] No measurements found for ${currentImageLabel}`);
            return '';
        }
        
        const measurement = window.strokeMeasurements[currentImageLabel][strokeLabel];
        console.log(`[getMeasurementString] Measurement data for ${strokeLabel}:`, measurement);
        
        if (!measurement) {
            console.log(`[getMeasurementString] No measurement found for ${strokeLabel}`);
            return '';
        }
        
        const unit = document.getElementById('unitSelector').value;
        console.log(`[getMeasurementString] Current unit: ${unit}`);
        
        if (unit === 'inch') {
            const whole = measurement.inchWhole || 0;
            const fraction = measurement.inchFraction || 0;
            
            // Format as 1 1/4" etc.
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
            
            const result = `${whole}${fractionStr}"`;
            console.log(`[getMeasurementString] Returning inch format: ${result}`);
            return result;
        } else {
            // CM with one decimal
            const result = `${measurement.cm.toFixed(1)} cm`;
            console.log(`[getMeasurementString] Returning cm format: ${result}`);
            return result;
        }
    }
    
    // Function to convert between units
    function convertUnits(from, value) {
        if (from === 'inch') {
            // Convert inch to cm
            return value * 2.54;
        } else {
            // Convert cm to inch
            return value / 2.54;
        }
    }
    
    // Function to update all measurements when unit changes
    function updateMeasurementDisplay() {
        window.currentUnit = document.getElementById('unitSelector').value;
        console.log(`[updateMeasurementDisplay] Unit changed to: ${window.currentUnit}`);
        updateStrokeVisibilityControls(); // Update the list to show new units
        redrawCanvasWithVisibility(); // Redraw canvas labels with new units
    }

    // Function to update stroke visibility controls
    // Make updateStrokeVisibilityControls available globally
    window.updateStrokeVisibilityControls = updateStrokeVisibilityControls;
            
    // *** NEW HELPER FUNCTION for creating and configuring measureText ***
    function createEditableMeasureText(strokeLabel, isSelected, parentItem) {
        const measureText = document.createElement('span');
        measureText.className = 'stroke-measurement';

        const currentFormattedMeasurement = getMeasurementString(strokeLabel) || '';
        measureText.textContent = currentFormattedMeasurement;
        console.log(`[createEditableMeasureText] Initial for ${strokeLabel}: "${currentFormattedMeasurement}"`);

        // SAFETY CHECK: Make sure we don't append to parentItem if it's undefined or null
        if (isSelected && (parentItem === undefined || parentItem === null)) {
            console.log(`[createEditableMeasureText] INFO: parentItem is null/undefined for stroke ${strokeLabel}. Caller will handle DOM insertion.`);
        }

        if (isSelected) {
            measureText.contentEditable = "true";
            measureText.dataset.originalMeasurementString = currentFormattedMeasurement;
            measureText.dataset.selectedMeasurement = "true";

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
                
            const shouldAutoFocus = isNewlyCreated || (isSelected && !window.isScalingOrZooming && !window.isMovingImage && !hasActiveMeasurementFocus);

            console.log(`[createEditableMeasureText] Focus logic for ${strokeLabel}: isNewlyCreated=${isNewlyCreated}, isSelected=${isSelected}, isScalingOrZooming=${!!window.isScalingOrZooming}, isMovingImage=${!!window.isMovingImage}, hasActiveMeasurementFocus=${hasActiveMeasurementFocus}, shouldAutoFocus=${shouldAutoFocus}`);

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
            measureText.contentEditable = "false";
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
            measureText.contentEditable = "false"; // Always make it non-editable on blur

            if (wasEditable) {
                if (measureText.dataset.escapeReverted === 'true') {
                    measureText.removeAttribute('data-escape-reverted');
                    console.log(`[measureText blur - ESCAPE] Reverted ${strokeLabel} to: \"${measureText.dataset.originalMeasurementString}\".`);
                    // Text content is already visually reverted by keydown. No further action needed here.
                } else {
                    const newText = measureText.textContent;
                    const originalText = measureText.dataset.originalMeasurementString || '';
                    
                    if (newText !== originalText) {
                        console.log(`[measureText blur - CHANGED] For ${strokeLabel}. Old: \"${originalText}\", New: \"${newText}\". Parsing.`);
                        const parseSuccess = parseAndSaveMeasurement(strokeLabel, newText);
                        if (parseSuccess) {
                            measureText.textContent = getMeasurementString(strokeLabel) || '';
                            console.log(`[measureText blur - PARSE SUCCESS] ${strokeLabel} updated to: "${measureText.textContent}".`);
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
                        console.log(`[measureText blur - UNCHANGED] For ${strokeLabel}. Value: \"${newText}\".`);
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

    function updateStrokeVisibilityControls() {
        // IMPORTANT: Debug the current state of measurements
        console.log('[updateStrokeVisibilityControls] START - Current window.strokeMeasurements:',
            window.strokeMeasurements[currentImageLabel] ? JSON.stringify(window.strokeMeasurements[currentImageLabel]) : 'undefined');
        
        // Log the currently selected stroke and edit mode
        console.log(`[updateStrokeVisibilityControls] Initial state - selectedStroke: ${selectedStrokeByImage[currentImageLabel]}, multipleSelected: ${multipleSelectedStrokesByImage[currentImageLabel] ? JSON.stringify(multipleSelectedStrokesByImage[currentImageLabel]) : 'undefined'}, Edit mode: ${window.selectedStrokeInEditMode}`);

        // --- Synchronization Logic --- 
        const currentSelectionArray = multipleSelectedStrokesByImage[currentImageLabel] || [];
        if (currentSelectionArray.length === 1) {
            if (selectedStrokeByImage[currentImageLabel] !== currentSelectionArray[0]) {
                console.warn(`[updateStrokeVisibilityControls] Correcting selectedStrokeByImage. Was: ${selectedStrokeByImage[currentImageLabel]}, multiple was: ${JSON.stringify(currentSelectionArray)}. Setting to: ${currentSelectionArray[0]}`);
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
        console.log(`[updateStrokeVisibilityControls] State AFTER sync - selectedStroke: ${selectedStrokeByImage[currentImageLabel]}, multipleSelected: ${multipleSelectedStrokesByImage[currentImageLabel] ? JSON.stringify(multipleSelectedStrokesByImage[currentImageLabel]) : 'undefined'}`);
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
        
        if (strokes.length === 0) {
            strokesList.innerHTML = '<p>No strokes to display</p>';
            return;
        }
        
        // Current unit
        const unit = document.getElementById('unitSelector').value;
        
        // Preserve existing stroke measurements before processing strokes
        const existingMeasurements = window.strokeMeasurements[currentImageLabel] || {};
        console.log('[updateStrokeVisibilityControls] Existing measurements:', JSON.stringify(existingMeasurements));
        
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
        
        // Create visibility toggle for each stroke
        strokes.forEach(strokeLabel => {
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
                console.log(`[updateStrokeVisibilityControls] Initializing empty measurements for ${currentImageLabel}`);
            }
            
            // ENHANCED preservation code: Check if measurement exists in the existing measurements
            if (existingMeasurements[strokeLabel]) {
                const existingMeasurement = existingMeasurements[strokeLabel];
                // More detailed check for valid measurement data
                if (existingMeasurement.inchWhole !== undefined || 
                    existingMeasurement.inchFraction !== undefined || 
                    existingMeasurement.cm !== undefined) {
                    
                    // Use the existing measurement from before this function was called
                    console.log(`[updateStrokeVisibilityControls] PRESERVING existing measurement for ${strokeLabel}:`, 
                        JSON.stringify(existingMeasurement));
                    
                    // Ensure we're not losing data by making a deep copy
                    window.strokeMeasurements[currentImageLabel][strokeLabel] = JSON.parse(JSON.stringify(existingMeasurement));
                    
                    // Log successful preservation
                    console.log(`[updateStrokeVisibilityControls] ✓ Successfully preserved measurement for ${strokeLabel}`);
                } else {
                    console.log(`[updateStrokeVisibilityControls] Found incomplete measurement for ${strokeLabel}:`, 
                        JSON.stringify(existingMeasurement));
                }
            }
            // Only set default if no measurement exists at all
            else if (window.strokeMeasurements[currentImageLabel][strokeLabel] === undefined) {
                window.strokeMeasurements[currentImageLabel][strokeLabel] = {
                    inchWhole: 0,
                    inchFraction: 0,
                    cm: 0.0
                };
                console.log(`[updateStrokeVisibilityControls] Setting default measurement for ${strokeLabel}`);
            } else {
                console.log(`[updateStrokeVisibilityControls] Using existing measurement for ${strokeLabel}:`, 
                    JSON.stringify(window.strokeMeasurements[currentImageLabel][strokeLabel]));
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
                console.log(`Styling item ${strokeLabel} for edit mode.`);
                item.style.backgroundColor = '#FFF3E0';
                item.style.borderLeft = '5px solid #FF9800';
                item.style.boxShadow = '0 3px 8px rgba(255, 152, 0, 0.3)';
                
                // Remove edit mode indicator creation
            } else {
                item.style.removeProperty('background-color');
                item.style.removeProperty('border-left');
                item.style.removeProperty('box-shadow');
                // Remove edit mode indicator removal
            }
            
            // Make all parts of the item selectable (except checkbox and buttons)
            item.addEventListener('click', (e) => {
                // Don't trigger selection if clicking a button or checkbox
                if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') {
                    return;
                }
                
                const now = Date.now();
                const timeSinceLastClick = now - window.lastClickTime;
                const clickedLabel = strokeLabel; // Store for timeout use
                
                // Check if this is a double-click
                if (timeSinceLastClick < window.clickDelay && selectedStrokeByImage[currentImageLabel] === clickedLabel) {
                    // Double-click detected
                    console.log('Double-click on stroke item:', clickedLabel);
                    if (window.singleClickTimeout) {
                        clearTimeout(window.singleClickTimeout); // Cancel single-click action
                        window.singleClickTimeout = null;
                    }
                    
                    window.selectedStrokeInEditMode = clickedLabel;
                    
                    // Make sure the item stays selected when entering edit mode
                    multipleSelectedStrokesByImage[currentImageLabel] = [clickedLabel];
                    selectedStrokeByImage[currentImageLabel] = clickedLabel;
                    
                    // Update UI for all items by refreshing the list
                    // This will correctly apply edit mode styling and focus
                    updateStrokeVisibilityControls(); 
                    
                    console.log('Entered edit mode for stroke:', clickedLabel);
                    
                    hideSelectionActionsPanel(); 
                    redrawCanvasWithVisibility();
                } else {
                    // Single-click or click on a different item
                    // Delay single-click action to allow for double-click
                    if (window.singleClickTimeout) {
                        clearTimeout(window.singleClickTimeout);
                    }
                    window.singleClickTimeout = setTimeout(() => {
                        console.log('Single-click action for stroke item:', clickedLabel);
                        // Clear edit mode if a different item is single-clicked
                        if (window.selectedStrokeInEditMode && window.selectedStrokeInEditMode !== clickedLabel) {
                            const prevEditItem = document.querySelector(`.stroke-visibility-item[data-stroke="${window.selectedStrokeInEditMode}"]`);
                            if (prevEditItem) {
                                prevEditItem.dataset.editMode = 'false';
                                prevEditItem.style.removeProperty('background-color');
                                prevEditItem.style.removeProperty('border-left');
                                prevEditItem.style.removeProperty('box-shadow');
                                // Remove edit mode indicator removal
                            }
                            window.selectedStrokeInEditMode = null;
                        }

                        // Standard single-click selection logic (multi-select aware)
                        const isCtrlPressed = e.ctrlKey || e.metaKey;
                        const isShiftPressed = e.shiftKey;
                        let currentSelection = multipleSelectedStrokesByImage[currentImageLabel] || [];
                        const itemIndex = sortedStrokeLabels.indexOf(clickedLabel);

                        if (isShiftPressed && lastSelectedStrokeIndex !== -1 && itemIndex !== -1) {
                            // Range selection
                            const start = Math.min(lastSelectedStrokeIndex, itemIndex);
                            const end = Math.max(lastSelectedStrokeIndex, itemIndex);
                            const rangeSelection = sortedStrokeLabels.slice(start, end + 1);
                            
                            if (isCtrlPressed) {
                                // Add range to current selection (toggle if already present)
                                rangeSelection.forEach(strokeId => {
                                    if (currentSelection.includes(strokeId)) {
                                        currentSelection = currentSelection.filter(id => id !== strokeId);
                                    } else {
                                        currentSelection.push(strokeId);
                                    }
                                });
                            } else {
                                // Replace selection with range
                                currentSelection = rangeSelection;
                            }
                        } else if (isCtrlPressed) {
                            // Toggle selection for the clicked item
                            if (currentSelection.includes(clickedLabel)) {
                                currentSelection = currentSelection.filter(id => id !== clickedLabel);
                            } else {
                                currentSelection.push(clickedLabel);
                            }
                            lastSelectedStrokeIndex = itemIndex;
                        } else {
                            // Single item selection (replace)
                            if (currentSelection.includes(clickedLabel) && currentSelection.length === 1) {
                                // Deselect if clicking the only selected item
                                console.log('Deselecting stroke:', clickedLabel);
                                currentSelection = []; 
                                window.selectedStrokeInEditMode = null; // Also exit edit mode
                            } else {
                                currentSelection = [clickedLabel];
                                window.selectedStrokeInEditMode = null; // Exit edit mode on new single selection
                            }
                            lastSelectedStrokeIndex = itemIndex;
                        }

                        multipleSelectedStrokesByImage[currentImageLabel] = currentSelection;
                        selectedStrokeByImage[currentImageLabel] = currentSelection.length === 1 ? currentSelection[0] : null;
                        
                        // Update UI to reflect selection (and remove edit mode if it was on this item)
                        document.querySelectorAll('.stroke-visibility-item').forEach(el => {
                            const sLabel = el.dataset.stroke;
                            if (currentSelection.includes(sLabel)) {
                                el.dataset.selected = 'true';
                                if (window.selectedStrokeInEditMode === sLabel && currentSelection.length > 1) {
                                   // If it was in edit mode but now part of multi-select, exit edit mode
                                   el.dataset.editMode = 'false';
                                   window.selectedStrokeInEditMode = null;
                                } else if (window.selectedStrokeInEditMode === sLabel && currentSelection.length === 1 && !isCtrlPressed && !isShiftPressed) {
                                    // If it was in edit mode, and it's still the only selected, keep edit mode
                                     el.dataset.editMode = 'true';
                                } else {
                                     el.dataset.editMode = 'false'; // Default to not edit mode
                                }

                            } else {
                                el.dataset.selected = 'false';
                                el.dataset.editMode = 'false'; // Ensure not in edit mode if not selected
                            }
                        });

                        if (selectedStrokeByImage[currentImageLabel] && !window.selectedStrokeInEditMode) {
                             // If single selected and NOT in edit mode, ensure edit mode is false
                             const selectedItem = document.querySelector(`.stroke-visibility-item[data-stroke="${selectedStrokeByImage[currentImageLabel]}"]`);
                             if (selectedItem) selectedItem.dataset.editMode = 'false';
                        }


                        updateSelectionActionsPanel();
                        redrawCanvasWithVisibility();
                        window.singleClickTimeout = null;
                    }, window.clickDelay);
                }
                window.lastClickTime = now;
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
            strokeName.style.color = strokeColor;
            strokeName.setAttribute('data-original-name', strokeLabel); // Store original name

            // Make strokeName editable
            strokeName.contentEditable = "false"; // Initially not editable
            strokeName.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent item selection click
                if (strokeName.contentEditable === "true") return; // Already editing
                strokeName.contentEditable = "true";
                strokeName.setAttribute('data-original-name', strokeName.textContent); // Update before editing
                strokeName.focus();
                document.execCommand('selectAll', false, null); // Select all text for easy replacement
            });

            strokeName.addEventListener('blur', (e) => {
                if (strokeName.contentEditable === "true") {
                    const originalName = strokeName.getAttribute('data-original-name');
                    const newName = strokeName.textContent.trim();
                    strokeName.contentEditable = "false";
                    if (newName && newName !== originalName) {
                        const actualNewName = renameStroke(originalName, newName);
                        // renameStroke updates global structures, updateStrokeVisibilityControls will redraw with actual name
                        saveState(true, false, true);
                        updateStrokeVisibilityControls(); // This will re-render the list
                        redrawCanvasWithVisibility();
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
                    strokeName.contentEditable = "false";
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
                if (strokeName.contentEditable === "true") return; 

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
            editBtn.innerHTML = '✏️';
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
            labelToggleBtn.innerHTML = isLabelVisible ? '🏷️' : ' 🏷️ '; // Show label icon, strikethrough if hidden
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
                console.log(`[updateStrokeVisibilityControls] Found newly created stroke ${strokeLabel}, will focus on it`);
                // Clear the flag so we don't focus multiple times in other functions
                window.newlyCreatedStroke = null;
                
                // Use setTimeout to ensure the DOM has been updated
                setTimeout(() => {
                    if (document.body.contains(measureTextElement)) {
                        console.log(`[updateStrokeVisibilityControls] Focusing on ${strokeLabel}`);
                        measureTextElement.contentEditable = "true";
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
        });
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
        
        console.log(`[showMeasurementDialog] Opening for ${strokeLabel} in ${currentImageLabel} view`);
        console.log(`[showMeasurementDialog] Current window.strokeMeasurements:`, 
            JSON.stringify(window.strokeMeasurements[currentImageLabel]));
        
        // Get current measurement
        const measurement = window.strokeMeasurements[currentImageLabel]?.[strokeLabel] || {
            inchWhole: 0,
            inchFraction: 0,
            cm: 0.0
        };
        
        console.log(`[showMeasurementDialog] Using measurement:`, measurement);
        
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
            console.log(`[showMeasurementDialog] Saving measurement for ${strokeLabel} in ${currentImageLabel}:`, {
                inchWhole: finalInchWhole,
                inchFraction: finalInchFraction,
                cm: finalCmValue
            });
            
            // Save only to window.strokeMeasurements
            window.strokeMeasurements[currentImageLabel][strokeLabel] = {
                inchWhole: finalInchWhole,
                inchFraction: finalInchFraction,
                cm: finalCmValue
            };
            
            // Add debug log to verify global state after saving
            console.log(`[showMeasurementDialog] Verification - window.strokeMeasurements[${currentImageLabel}]:`, 
                JSON.stringify(window.strokeMeasurements[currentImageLabel]));
            
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
        
        console.log(`[showStrokeEditDialog] Opening for ${strokeLabel} in ${currentImageLabel} view`);
        console.log(`[showStrokeEditDialog] Current window.strokeMeasurements:`, 
            JSON.stringify(window.strokeMeasurements[currentImageLabel]));
        
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
                    console.log(`Stroke name automatically adjusted to ${finalName} to avoid duplicates`);
                    
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
            
            console.log(`[showStrokeEditDialog] Saved measurement for ${finalName}:`, 
                window.strokeMeasurements[currentImageLabel][finalName]);
            
            // Call optional callback
            if (typeof config.onSave === 'function') {
                config.onSave(finalName);
            }
            
            // Close dialog
            document.body.removeChild(overlay);
            
            // Update UI and redraw
            updateStrokeVisibilityControls();
            redrawCanvasWithVisibility();
            
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
        console.log('[DEPRECATED] showEditDialog is deprecated, use showStrokeEditDialog instead');
        return showStrokeEditDialog(strokeLabel, {
            showNameField: true,
            title: `Edit Stroke ${strokeLabel}`
        });
    }
    
    // Function to display a measurement edit dialog (DEPRECATED - use showStrokeEditDialog)
    function showMeasurementDialog(strokeLabel) {
        console.log('[DEPRECATED] showMeasurementDialog is deprecated, use showStrokeEditDialog instead');
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
        
        // Return the actual name used for the stroke (either the original or the uniquified version)
        return uniqueNewName;
    }
    
    // Function to toggle stroke visibility
    function toggleStrokeVisibility(strokeLabel, isVisible) {
        console.log(`Toggling visibility of stroke ${strokeLabel} to ${isVisible}`);
        
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
                console.log(`Vector data missing for ${strokeLabel}, attempting recovery`);
                
                // Try to recover vector data from the undo stack
                for (let i = undoStackByImage[currentImageLabel].length - 1; i >= 0; i--) {
                    const action = undoStackByImage[currentImageLabel][i];
                    if (action.label === strokeLabel) {
                        if (action.vectorData) {
                            vectorStrokesByImage[currentImageLabel][strokeLabel] = action.vectorData;
                            console.log(`Recovered vector data for ${strokeLabel}`);
                            break;
                        }
                    }
                }
                
                // If we still couldn't recover the vector data, create a basic one
                // This is especially important for straight lines
                if (!vectorStrokesByImage[currentImageLabel][strokeLabel]) {
                    console.log(`Creating default vector data for ${strokeLabel}`);
                    
                    // Look for color and properties in the undo stack
                    let strokeColor = "#000000";
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
                        type: isLine ? 'straight' : 'freehand'
                    };
                }
            }
        };

        // *** Add redraw call here ***
        redrawCanvasWithVisibility();
    }
    
    // Store for currently selected stroke in each image
    let selectedStrokeByImage = {};
    
    // Initialize stroke label visibility for each image (default to visible)
    IMAGE_LABELS.forEach(label => {
        strokeLabelVisibility[label] = {};
        selectedStrokeByImage[label] = null; // Initialize with no selection
    });
    
    // Store for label custom positions (user-dragged positions)
    let customLabelPositions = {};
    
    // Flag to track if we're dragging a label
    let isDraggingLabel = false;
    let draggedLabelStroke = null;
    let dragStartX = 0;
    let dragStartY = 0;
    
    // Initialize custom label positions for each image
    IMAGE_LABELS.forEach(label => {
        customLabelPositions[label] = {};
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
        console.log(`--- redrawCanvasWithVisibility called for: ${currentImageLabel} ---`);
        
        // Clear performance cache for new render cycle
        ARROW_PERFORMANCE_CACHE.clearCache();
        
        // ADDED: Ensure originalImageDimensions exists and has an entry for this label
        if (!window.originalImageDimensions) {
            window.originalImageDimensions = {};
        }
        
        // ADDED: If we don't have dimensions for this label but we're trying to draw strokes,
        // create default dimensions based on the canvas size to prevent coordinates from being lost
        if (!window.originalImageDimensions[currentImageLabel] && 
            vectorStrokesByImage[currentImageLabel] && 
            Object.keys(vectorStrokesByImage[currentImageLabel]).length > 0) {
            
            console.log(`Creating default dimensions for ${currentImageLabel} to preserve strokes`);
            window.originalImageDimensions[currentImageLabel] = {
                width: canvas.width,
                height: canvas.height
            };
            console.log(`Set dimensions to match canvas: ${canvas.width}x${canvas.height}`);
        }
        
        // Reset label positions and stroke paths for this redraw
        currentLabelPositions = [];
        currentStrokePaths = [];
        
        // Create a copy of custom label positions for tracking which ones were actually used
        const usedCustomPositions = {};
        
        // Get current scale and position from stored values
        const scale = window.imageScaleByLabel[currentImageLabel] || 1.0;
        console.log(`[redrawCanvasWithVisibility] Using scale=${scale} for ${currentImageLabel}`);
        
        // Double-check scale against UI for consistency
        const scaleEl = document.getElementById('scaleButton');
        if (scaleEl) {
            const scaleText = scaleEl.textContent;
            const scaleMatch = scaleText.match(/Scale: (\d+)%/);
            if (scaleMatch && scaleMatch[1]) {
                const uiScale = parseInt(scaleMatch[1]) / 100;
                console.log(`[redrawCanvasWithVisibility] UI shows scale=${uiScale} for ${currentImageLabel}`);
                if (uiScale !== scale) {
                    console.warn(`[redrawCanvasWithVisibility] WARNING: Scale mismatch! Variable: ${scale}, UI: ${uiScale}`);
                    // Don't automatically update as that would create infinite loop with updateScale
                    // Just warn about the inconsistency
                }
            }
        }
        
        const position = imagePositionByLabel[currentImageLabel] || { x: 0, y: 0 };
        console.log(`[redrawCanvasWithVisibility] Using position: x=${position.x}, y=${position.y} for ${currentImageLabel}`);
        
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
            ctx.fillStyle = 'white'; // Add white background fill
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Use default scale and center position when no image
            const canvasCenterX = canvas.width / 2;
            const canvasCenterY = canvas.height / 2;
            
            // Apply the position offset to the center coordinates
            const imageX = canvasCenterX + position.x;
            const imageY = canvasCenterY + position.y;
            
            applyVisibleStrokes(scale, imageX, imageY);
        }
    }
        
    // Function to draw the image and apply strokes
    function drawImageAndStrokes(img, scale, imageX, imageY) {
        console.log(`[drawImageAndStrokes] Called with scale=${scale}`);
        console.log(`[drawImageAndStrokes] Current window.imageScaleByLabel[${currentImageLabel}] = ${window.imageScaleByLabel[currentImageLabel]}`);
            
        // CRITICAL FIX: Ensure scale parameter matches the global scale value
        if (scale !== window.imageScaleByLabel[currentImageLabel]) {
            console.error(`[drawImageAndStrokes] CRITICAL SCALE MISMATCH! Parameter scale=${scale} but global scale=${window.imageScaleByLabel[currentImageLabel]}. Fixing...`);
            scale = window.imageScaleByLabel[currentImageLabel]; // Use the global scale value always
            
            // Recalculate image position based on correct scale
            const centerX = (canvas.width - img.width * scale) / 2;
            const centerY = (canvas.height - img.height * scale) / 2;
            const position = imagePositionByLabel[currentImageLabel] || { x: 0, y: 0 };
            imageX = centerX + position.x;
            imageY = centerY + position.y;
        }
        
        // Clear the canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Get dimensions
        const imgWidth = img.width;
        const imgHeight = img.height;
        
        // Calculate scaled dimensions
        const scaledWidth = imgWidth * scale;
        const scaledHeight = imgHeight * scale;
            
            // Draw the image with scaling and positioning
        ctx.drawImage(img, imageX, imageY, scaledWidth, scaledHeight);
            
        // Apply visible strokes
        applyVisibleStrokes(scale, imageX, imageY);
        }
        
    // Function to apply visible strokes - moved outside redrawCanvasWithVisibility to be globally accessible
        function applyVisibleStrokes(scale, imageX, imageY) {
            console.log(`\n--- applyVisibleStrokes ---`); // ADDED LOG
            console.log(`  Target Label: ${currentImageLabel}`); // ADDED LOG
            console.log(`  Scale: ${scale}, ImageX: ${imageX}, ImageY: ${imageY}`); // ADDED LOG
        console.log(`[applyVisibleStrokes] Current window.imageScaleByLabel[${currentImageLabel}] = ${window.imageScaleByLabel[currentImageLabel]}`);
        
        // CRITICAL FIX: Ensure scale parameter matches the global scale value
        if (scale !== window.imageScaleByLabel[currentImageLabel]) {
            console.error(`[applyVisibleStrokes] CRITICAL SCALE MISMATCH! Parameter scale=${scale} but global scale=${window.imageScaleByLabel[currentImageLabel]}. Fixing...`);
            scale = window.imageScaleByLabel[currentImageLabel]; // Use the global scale value always
        }
        
            // Apply each visible stroke using vector data if available
            const strokes = vectorStrokesByImage[currentImageLabel] || {};
            const strokeOrder = lineStrokesByImage[currentImageLabel] || [];
            const visibility = strokeVisibilityByImage[currentImageLabel] || {};

            // *** ADDED LOGGING ***
            console.log(`  Stroke Order (${strokeOrder.length}): [${strokeOrder.join(', ')}]`);
            console.log(`  Vector Strokes Available (${Object.keys(strokes).length}):`, Object.keys(strokes));
            console.log(`  Visibility States:`, JSON.stringify(visibility));
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
                    console.log(`Original image dimensions: ${imageWidth}x${imageHeight}`);
                }
            }
            
            // Check if this is a blank canvas (no image, using canvas dimensions)
            const dims = window.originalImageDimensions ? window.originalImageDimensions[currentImageLabel] : undefined;
            const isBlankCanvas = !window.originalImages || !window.originalImages[currentImageLabel] || 
                                 (dims && dims.width === canvas.width && dims.height === canvas.height);
            
            if (isBlankCanvas) {
                console.log(`Applying strokes in BLANK CANVAS MODE`);
            }
            
            // Calculate canvas center for scaling in blank canvas mode
            const canvasCenter = {
                x: canvas.width / 2,
                y: canvas.height / 2
            };
            
            // Retrieve the correct stroke data for the current image
            strokeOrder.forEach((strokeLabel) => {
                const isVisible = visibility[strokeLabel];
                // *** ADDED LOGGING ***
                console.log(`\n  Processing Stroke: ${strokeLabel}`);
                console.log(`    Is Visible? ${isVisible}`);
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
                console.log(`    Vector Data Found: ${vectorData.points.length} points, type: ${vectorData.type}, color: ${vectorData.color}, width: ${vectorData.width}`);
                // *** END LOGGING ***
                
                console.log(`\nDrawing stroke ${strokeLabel}:`);
                console.log(`Using scale: ${scale}, imageX: ${imageX}, imageY: ${imageY}`);
                            
                            // Transform the first point
                            const firstPoint = vectorData.points[0];
                // In blank canvas mode, the points are already in canvas coordinates
                let transformedFirstX, transformedFirstY;
                
                if (isBlankCanvas) {
                    // Apply both scaling and position offset in blank canvas mode
                    const position = imagePositionByLabel[currentImageLabel] || { x: 0, y: 0 };
                    // Scale from canvas center
                    const scaledX = (firstPoint.x - canvasCenter.x) * scale + canvasCenter.x;
                    const scaledY = (firstPoint.y - canvasCenter.y) * scale + canvasCenter.y;
                    // Then apply position offset
                    transformedFirstX = scaledX + position.x;
                    transformedFirstY = scaledY + position.y;
                    console.log(`BLANK CANVAS: Using scaled and adjusted coordinates for first point: (${transformedFirstX}, ${transformedFirstY})`);
                } else {
                    transformedFirstX = imageX + (firstPoint.x * scale);
                    transformedFirstY = imageY + (firstPoint.y * scale);
                    console.log(`First point transformation:
                        Original (relative to image): (${firstPoint.x}, ${firstPoint.y})
                        Scaled: (${firstPoint.x * scale}, ${firstPoint.y * scale})
                        Final (canvas position): (${transformedFirstX}, ${transformedFirstY})`);
                }
                
                // Check if this is an arrow line and pre-calculate adjusted points
                const isArrowLine = vectorData.type === 'arrow';
                let actualStartX = transformedFirstX;
                let actualStartY = transformedFirstY;
                let originalStartPoint = {x: transformedFirstX, y: transformedFirstY};
                let originalEndPoint = null;
                
                if (isArrowLine && vectorData.points.length >= 2) {
                    // Calculate the transformed end point first
                    const lastPoint = vectorData.points[vectorData.points.length - 1];
                    let transformedLastX, transformedLastY;
                    
                    if (isBlankCanvas) {
                        const position = imagePositionByLabel[currentImageLabel] || { x: 0, y: 0 };
                        const scaledX = (lastPoint.x - canvasCenter.x) * scale + canvasCenter.x;
                        const scaledY = (lastPoint.y - canvasCenter.y) * scale + canvasCenter.y;
                        transformedLastX = scaledX + position.x;
                        transformedLastY = scaledY + position.y;
                    } else {
                        transformedLastX = imageX + (lastPoint.x * scale);
                        transformedLastY = imageY + (lastPoint.y * scale);
                    }
                    
                    originalEndPoint = {x: transformedLastX, y: transformedLastY};
                    
                    // Calculate adjusted start and end points for the line shaft
                    if (vectorData.arrowSettings) {
                        const brushSizeForStroke = vectorData.width || 5;
                        const baseArrowSize = Math.max(vectorData.arrowSettings.arrowSize || 15, brushSizeForStroke * 2);
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
                ctx.beginPath();
                ctx.moveTo(actualStartX, actualStartY);
                strokePath.push({x: actualStartX, y: actualStartY});
                            
                            // Check if this is a straight line
                            const isStraightLine = vectorData.type === 'straight' || 
                                (vectorData.points.length === 2 && !vectorData.type);
                            
                            // Check if this is a curved line
                            const isCurvedLine = vectorData.type === 'curved' || vectorData.type === 'curved-arrow';
                            
                            // Check if this is a curved arrow specifically
                            const isCurvedArrow = vectorData.type === 'curved-arrow';
                            
                            if (isStraightLine && vectorData.points.length >= 2) {
                                const lastPoint = vectorData.points[vectorData.points.length - 1];
                            let transformedLastX, transformedLastY;
                            
                            if (isBlankCanvas) {
                                // Apply both scaling and position offset in blank canvas mode
                                const position = imagePositionByLabel[currentImageLabel] || { x: 0, y: 0 };
                                // Scale from canvas center
                                const scaledX = (lastPoint.x - canvasCenter.x) * scale + canvasCenter.x;
                                const scaledY = (lastPoint.y - canvasCenter.y) * scale + canvasCenter.y;
                                // Then apply position offset
                                transformedLastX = scaledX + position.x;
                                transformedLastY = scaledY + position.y;
                                console.log(`BLANK CANVAS: Using scaled and adjusted coordinates for last point: (${transformedLastX}, ${transformedLastY})`);
                            } else {
                                transformedLastX = imageX + (lastPoint.x * scale);
                                transformedLastY = imageY + (lastPoint.y * scale);
                                console.log(`Last point transformation:
                                    Original (relative to image): (${lastPoint.x}, ${lastPoint.y})
                                    Scaled: (${lastPoint.x * scale}, ${lastPoint.y * scale})
                                    Final (canvas position): (${transformedLastX}, ${transformedLastY})`);
                            }
                            
                                ctx.lineTo(transformedLastX, transformedLastY);
                            strokePath.push({x: transformedLastX, y: transformedLastY});
                            } else if (isArrowLine && vectorData.points.length >= 2) {
                                // For arrow lines, use the pre-calculated original end point and calculate adjusted end point
                                let adjustedEndX = originalEndPoint.x;
                                let adjustedEndY = originalEndPoint.y;
                                
                                if (vectorData.arrowSettings) {
                                    // Get arrow settings to calculate end point adjustment
                                    const brushSizeForStroke = vectorData.width || 5;
                                    const baseArrowSize = Math.max(vectorData.arrowSettings.arrowSize || 15, brushSizeForStroke * 2);
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
                                
                                // Store the original endpoints for arrowhead drawing
                                strokePath.originalStart = originalStartPoint;
                                strokePath.originalEnd = originalEndPoint;
                            } else if (isCurvedLine) {
                                // For curved lines, draw smooth spline using stored interpolated points
                                console.log(`Drawing curved line with ${vectorData.points.length} interpolated points`);
                                
                                // Calculate curve shortening for arrows if this is a curved arrow
                                let startIndex = 0;
                                let endIndex = vectorData.points.length - 1;
                                
                                if (isCurvedArrow && vectorData.arrowSettings && vectorData.points.length >= 2) {
                                    const brushSizeForStroke = vectorData.width || 5;
                                    const baseArrowSize = Math.max(vectorData.arrowSettings.arrowSize || 15, brushSizeForStroke * 2);
                                    const scale = window.imageScaleByLabel[currentImageLabel] || 1;
                                    const scaledArrowSize = baseArrowSize * scale;
                                    
                                    // Calculate shortening distance (80% of arrow size for clean appearance)
                                    const shorteningDistance = scaledArrowSize * 0.8;
                                    
                                    // Find how many points to skip from start for start arrow
                                    if (vectorData.arrowSettings.startArrow) {
                                        let accumulatedDistance = 0;
                                        for (let i = 1; i < vectorData.points.length && accumulatedDistance < shorteningDistance; i++) {
                                            const prevPoint = vectorData.points[i - 1];
                                            const currentPoint = vectorData.points[i];
                                            
                                            // Calculate distance between consecutive points in image space
                                            const dx = currentPoint.x - prevPoint.x;
                                            const dy = currentPoint.y - prevPoint.y;
                                            const segmentDistance = Math.sqrt(dx * dx + dy * dy) * scale;
                                            
                                            accumulatedDistance += segmentDistance;
                                            if (accumulatedDistance >= shorteningDistance) {
                                                startIndex = i - 1;
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
                                            
                                            // Calculate distance between consecutive points in image space
                                            const dx = nextPoint.x - currentPoint.x;
                                            const dy = nextPoint.y - currentPoint.y;
                                            const segmentDistance = Math.sqrt(dx * dx + dy * dy) * scale;
                                            
                                            accumulatedDistance += segmentDistance;
                                            if (accumulatedDistance >= shorteningDistance) {
                                                endIndex = i + 1;
                                                break;
                                            }
                                        }
                                    }
                                    
                                    console.log(`Curve shortening: startIndex=${startIndex}, endIndex=${endIndex}, total points=${vectorData.points.length}`);
                                }
                                
                                // Draw the curve using the calculated start and end indices
                                let isFirstPoint = true;
                                for (let i = startIndex; i <= endIndex; i++) {
                                    const point = vectorData.points[i];
                                    let transformedX, transformedY;
                                    
                                    if (isBlankCanvas) {
                                        const position = imagePositionByLabel[currentImageLabel] || { x: 0, y: 0 };
                                        const scaledX = (point.x - canvasCenter.x) * scale + canvasCenter.x;
                                        const scaledY = (point.y - canvasCenter.y) * scale + canvasCenter.y;
                                        transformedX = scaledX + position.x;
                                        transformedY = scaledY + position.y;
                                    } else {
                                        transformedX = imageX + (point.x * scale);
                                        transformedY = imageY + (point.y * scale);
                                    }
                                    
                                    if (isFirstPoint) {
                                        ctx.moveTo(transformedX, transformedY);
                                        strokePath.push({x: transformedX, y: transformedY});
                                        isFirstPoint = false;
                                    } else {
                                        ctx.lineTo(transformedX, transformedY);
                                        strokePath.push({x: transformedX, y: transformedY});
                                    }
                                }
                            } else {
                                // For freehand drawing, draw straight lines between all points
                                for (let i = 1; i < vectorData.points.length; i++) {
                                    const point = vectorData.points[i];
                                let transformedX, transformedY;
                                
                                if (isBlankCanvas) {
                                    // Apply both scaling and position offset in blank canvas mode
                                    const position = imagePositionByLabel[currentImageLabel] || { x: 0, y: 0 };
                                    // Scale from canvas center
                                    const scaledX = (point.x - canvasCenter.x) * scale + canvasCenter.x;
                                    const scaledY = (point.y - canvasCenter.y) * scale + canvasCenter.y;
                                    // Then apply position offset
                                    transformedX = scaledX + position.x;
                                    transformedY = scaledY + position.y;
                                } else {
                                    transformedX = imageX + (point.x * scale);
                                    transformedY = imageY + (point.y * scale);
                                }
                                
                                ctx.lineTo(transformedX, transformedY);
                                strokePath.push({x: transformedX, y: transformedY});
                            }
                        }
                        
                        // Store the path for this stroke (for label positioning)
                        currentStrokePaths.push({
                            label: strokeLabel,
                            path: strokePath,
                    width: (vectorData.width || 5) * scale,
                    color: vectorData.color
                        });
                        
                        // Set stroke style
                ctx.strokeStyle = vectorData.color;
                ctx.lineWidth = (vectorData.width || 5) * scale;
                        ctx.lineCap = 'round';
                        ctx.lineJoin = 'round';
                        
                // --- Add Glow Effect for Selected Stroke ---
                const isSelected = selectedStrokeByImage[currentImageLabel] === strokeLabel;
                            if (isSelected) {
                    ctx.save(); // Save context state before applying shadow
                    ctx.shadowColor = '#ffffff'; // White glow
                    ctx.shadowBlur = 15; // Adjust blur amount as needed
                    ctx.shadowOffsetX = 0;
                    ctx.shadowOffsetY = 0;
                    // console.log(`    Applying glow to selected stroke: ${strokeLabel}`);
                }
                // --- End Glow Effect ---

                ctx.stroke();

                // --- Reset Glow Effect ---
                if (isSelected) {
                    ctx.restore(); // Restore context state to remove shadow
                }
                // --- End Reset Glow Effect ---
                
                                 // --- Draw Arrowheads for Arrow Lines ---
                 if (isArrowLine && vectorData.arrowSettings && strokePath.length >= 2) {
                     const startPoint = strokePath.originalStart;
                     const endPoint = strokePath.originalEnd;
                     
                     // Create a temporary settings object with brush size-aware scaling
                     const brushSizeForStroke = vectorData.width || 5;
                     const baseArrowSize = Math.max(vectorData.arrowSettings.arrowSize || 15, brushSizeForStroke * 2);
                     
                     const scaledArrowSettings = {
                         ...vectorData.arrowSettings,
                         arrowSize: baseArrowSize // Let drawArrowhead handle the final scaling
                     };
                     
                     // Draw arrowheads using the transformed coordinates and stroke color
                     drawArrowhead(startPoint, endPoint, scaledArrowSettings, vectorData.color);
                 }
                // --- End Arrowheads ---
                
                // --- Draw Arrowheads for Curved Arrows ---
                if (isCurvedArrow && vectorData.arrowSettings && vectorData.points.length >= 2) {
                    const brushSizeForStroke = vectorData.width || 5;
                    const baseArrowSize = Math.max(vectorData.arrowSettings.arrowSize || 15, brushSizeForStroke * 2);
                    const scale = window.imageScaleByLabel[currentImageLabel] || 1;
                    const scaledArrowSize = baseArrowSize * scale;
                    
                    // Calculate proper tangent directions from the curve points
                    let startTangent = null;
                    let endTangent = null;
                    let startPoint = null;
                    let endPoint = null;
                    
                    // Calculate start tangent (direction from first to second point)
                    if (vectorData.points.length >= 2) {
                        const firstPoint = vectorData.points[0];
                        const secondPoint = vectorData.points[1];
                        
                        // Transform first point to canvas coordinates
                        let startX, startY;
                        if (isBlankCanvas) {
                            const position = imagePositionByLabel[currentImageLabel] || { x: 0, y: 0 };
                            const scaledX = (firstPoint.x - canvasCenter.x) * scale + canvasCenter.x;
                            const scaledY = (firstPoint.y - canvasCenter.y) * scale + canvasCenter.y;
                            startX = scaledX + position.x;
                            startY = scaledY + position.y;
                        } else {
                            startX = imageX + (firstPoint.x * scale);
                            startY = imageY + (firstPoint.y * scale);
                        }
                        
                        // Transform second point to canvas coordinates
                        let secondX, secondY;
                        if (isBlankCanvas) {
                            const position = imagePositionByLabel[currentImageLabel] || { x: 0, y: 0 };
                            const scaledX = (secondPoint.x - canvasCenter.x) * scale + canvasCenter.x;
                            const scaledY = (secondPoint.y - canvasCenter.y) * scale + canvasCenter.y;
                            secondX = scaledX + position.x;
                            secondY = scaledY + position.y;
                        } else {
                            secondX = imageX + (secondPoint.x * scale);
                            secondY = imageY + (secondPoint.y * scale);
                        }
                        
                        // Calculate start tangent: second - first (forward direction)
                        const dx = secondX - startX;
                        const dy = secondY - startY;
                        const length = Math.sqrt(dx * dx + dy * dy);
                        if (length > 0) {
                            startTangent = { x: dx / length, y: dy / length };
                        }
                        startPoint = { x: startX, y: startY };
                    }
                    
                    // Calculate end tangent (direction from second-to-last to last point)
                    if (vectorData.points.length >= 2) {
                        const lastPoint = vectorData.points[vectorData.points.length - 1];
                        const secondLastPoint = vectorData.points[vectorData.points.length - 2];
                        
                        // Transform last point to canvas coordinates
                        let endX, endY;
                        if (isBlankCanvas) {
                            const position = imagePositionByLabel[currentImageLabel] || { x: 0, y: 0 };
                            const scaledX = (lastPoint.x - canvasCenter.x) * scale + canvasCenter.x;
                            const scaledY = (lastPoint.y - canvasCenter.y) * scale + canvasCenter.y;
                            endX = scaledX + position.x;
                            endY = scaledY + position.y;
                        } else {
                            endX = imageX + (lastPoint.x * scale);
                            endY = imageY + (lastPoint.y * scale);
                        }
                        
                        // Transform second-to-last point to canvas coordinates
                        let secondLastX, secondLastY;
                        if (isBlankCanvas) {
                            const position = imagePositionByLabel[currentImageLabel] || { x: 0, y: 0 };
                            const scaledX = (secondLastPoint.x - canvasCenter.x) * scale + canvasCenter.x;
                            const scaledY = (secondLastPoint.y - canvasCenter.y) * scale + canvasCenter.y;
                            secondLastX = scaledX + position.x;
                            secondLastY = scaledY + position.y;
                        } else {
                            secondLastX = imageX + (secondLastPoint.x * scale);
                            secondLastY = imageY + (secondLastPoint.y * scale);
                        }
                        
                        // Calculate end tangent: last - second-to-last (forward direction)
                        const dx = endX - secondLastX;
                        const dy = endY - secondLastY;
                        const length = Math.sqrt(dx * dx + dy * dy);
                        if (length > 0) {
                            endTangent = { x: dx / length, y: dy / length };
                        }
                        endPoint = { x: endX, y: endY };
                        
                        console.log(`End tangent calculation for curved arrow:`, { 
                            endTangent, 
                            endPoint: { x: endX, y: endY },
                            secondLastPoint: { x: secondLastX, y: secondLastY },
                            dx, dy, length 
                        });
                    }
                    
                    // Draw arrowheads using calculated tangents
                    ctx.save();
                    ctx.fillStyle = vectorData.color;
                    ctx.strokeStyle = vectorData.color;
                    
                    if (vectorData.arrowSettings.startArrow && startTangent && startPoint) {
                        // Start arrow points backward (opposite to tangent direction)
                        const startAngle = Math.atan2(-startTangent.y, -startTangent.x);
                        drawSingleArrowhead(startPoint.x, startPoint.y, startAngle, scaledArrowSize, vectorData.arrowSettings.arrowStyle);
                    }
                    
                    if (vectorData.arrowSettings.endArrow && endTangent && endPoint) {
                        // End arrow points forward (same as tangent direction)
                        const endAngle = Math.atan2(endTangent.y, endTangent.x);
                        drawSingleArrowhead(endPoint.x, endPoint.y, endAngle, scaledArrowSize, vectorData.arrowSettings.arrowStyle);
                    }
                    
                    ctx.restore();
                }
                // --- End Curved Arrow Arrowheads ---

                // --- Draw Control Point Indicators for Arrows (ONLY in Edit Mode) ---
                if (isArrowLine && vectorData.points.length >= 2 && 
                    window.selectedStrokeInEditMode === strokeLabel) {
                    console.log(`Drawing arrow endpoint indicators for ${strokeLabel} (IN EDIT MODE)`);
                    
                    // Draw control points at start and end of arrow
                    const startPoint = vectorData.points[0];
                    const endPoint = vectorData.points[vectorData.points.length - 1];
                    
                    [startPoint, endPoint].forEach((point, index) => {
                        let transformedX, transformedY;
                        
                        if (isBlankCanvas) {
                            const position = imagePositionByLabel[currentImageLabel] || { x: 0, y: 0 };
                            const scaledX = (point.x - canvasCenter.x) * scale + canvasCenter.x;
                            const scaledY = (point.y - canvasCenter.y) * scale + canvasCenter.y;
                            transformedX = scaledX + position.x;
                            transformedY = scaledY + position.y;
                        } else {
                            transformedX = imageX + (point.x * scale);
                            transformedY = imageY + (point.y * scale);
                        }
                        
                        // Draw arrow endpoint control indicator
                        ctx.save();
                        ctx.beginPath();
                        
                        // Enhanced appearance for control points in edit mode
                        let pointRadius = 8 * scale;
                        let fillColor = '#ffffff';
                        let strokeColor = vectorData.color;
                        let lineWidth = 3;
                        
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
                
                // --- Draw Control Point Indicators for Curved Lines (ONLY in Edit Mode) ---
                if (isCurvedLine && vectorData.controlPoints && vectorData.controlPoints.length > 0 && 
                    window.selectedStrokeInEditMode === strokeLabel) {
                    console.log(`Drawing control point indicators for curved line ${strokeLabel} (IN EDIT MODE)`);
                    
                    // Draw small circles at each original control point
                    vectorData.controlPoints.forEach((controlPoint, index) => {
                        let transformedX, transformedY;
                        
                        if (isBlankCanvas) {
                            // Apply both scaling and position offset in blank canvas mode
                            const position = imagePositionByLabel[currentImageLabel] || { x: 0, y: 0 };
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
                        
                        // Draw control point indicator (enhanced for edit mode)
                        ctx.save();
                        ctx.beginPath();
                        
                        // Enhanced appearance for control points in edit mode
                        let pointRadius = 8 * scale;
                        let fillColor = '#ffffff';
                        let strokeColor = vectorData.color;
                        let lineWidth = 3;
                        
                        // Add a subtle glow effect for control points in edit mode
                        ctx.shadowColor = vectorData.color;
                        ctx.shadowBlur = 8;
                        ctx.shadowOffsetX = 0;
                        ctx.shadowOffsetY = 0;
                        
                        ctx.arc(transformedX, transformedY, pointRadius, 0, Math.PI * 2);
                        ctx.fillStyle = fillColor;
                        ctx.fill();
                        ctx.strokeStyle = strokeColor;
                        ctx.lineWidth = lineWidth;
                        ctx.stroke();
                        ctx.restore();
                    });
                }
                // --- End Control Point Indicators ---
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
                    const measurement = getMeasurementString(strokeLabel);
                    const labelText = measurement ? `${strokeLabel}=${measurement}` : strokeLabel;

                    let anchorPointCanvas; // Anchor point in canvas coordinates
                    let anchorPointImage;  // Anchor point in image coordinates

                    if (vectorData.points.length > 0) {
                        const midIndex = Math.floor(vectorData.points.length / 2);
                        const midPointRelative = vectorData.points[midIndex]; // This is in image coordinates
                        anchorPointImage = { x: midPointRelative.x, y: midPointRelative.y };
                        
                        try {
                            // Convert image anchor to canvas anchor for routines that need canvas coords (e.g., initial optimal placement)
                            anchorPointCanvas = { 
                                x: (anchorPointImage.x * scale) + imageX, 
                                y: (anchorPointImage.y * scale) + imageY 
                            };
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

                    ctx.font = '28px Arial';
                    const labelColor = vectorData.color || '#000';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'bottom';

                    const metrics = ctx.measureText(labelText);
                    const labelWidth = metrics.width + 12; 
                    const labelHeight = 48; 
                    
                    // Initial labelRect definition (using canvas anchor for width/height context)
                    // This rect's x,y might be adjusted by optimal placement or stored offsets.
                    const labelRectForSizing = {
                        width: labelWidth,
                        height: labelHeight,
                        // x, y will be determined by finalPosition
                        strokeLabel: strokeLabel
                    };

                    let finalPositionCanvas; // This will be the top-left of the label in CANVAS coordinates
                    let imageSpaceOffset; // This will store the {x, y} offset in IMAGE SPACE

                    if (customLabelPositions[currentImageLabel]?.[strokeLabel]) {
                        imageSpaceOffset = customLabelPositions[currentImageLabel][strokeLabel]; // Already in image space
                        // console.log(`    Using custom image-space offset for ${strokeLabel}:`, imageSpaceOffset);
                    } else if (calculatedLabelOffsets[currentImageLabel]?.[strokeLabel]) {
                        imageSpaceOffset = calculatedLabelOffsets[currentImageLabel][strokeLabel]; // Already in image space
                        // console.log(`    Using calculated image-space offset for ${strokeLabel}:`, imageSpaceOffset);
                            } else {
                        // console.log(`    Calculating new optimal position for ${strokeLabel}`);
                         if (typeof findOptimalLabelPosition !== 'function') {
                             console.error("     findOptimalLabelPosition function is not defined! Using default position.");
                            // Fallback canvas offset (relative to canvas anchor)
                            const fallbackCanvasX = anchorPointCanvas.x - labelWidth / 2;
                            const fallbackCanvasY = anchorPointCanvas.y - labelHeight - 15;
                            const canvasSpaceFallbackOffset = { 
                                x: fallbackCanvasX - anchorPointCanvas.x, 
                                y: fallbackCanvasY - anchorPointCanvas.y 
                            };
                            // Convert canvas offset to image space for storage
                            imageSpaceOffset = { 
                                x: canvasSpaceFallbackOffset.x / scale, 
                                y: canvasSpaceFallbackOffset.y / scale 
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
                                    x: initialLabelAnchorCanvas.x - labelRectForSizing.width / 2, 
                                    y: initialLabelAnchorCanvas.y - labelRectForSizing.height - 10 // Reduced vertical offset
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

                                // Convert canvas-space offset to image-space for storage
                                imageSpaceOffset = {
                                    x: canvasSpaceOptimalOffset.x / scale,
                                    y: canvasSpaceOptimalOffset.y / scale
                                };
                                // console.log(`    Calculated optimal canvas offset for ${strokeLabel}:`, canvasSpaceOptimalOffset, `-> image offset:`, imageSpaceOffset);
                             } catch(err) {
                                console.error(`      Error in findOptimalLabelPosition for ${strokeLabel}:`, err);
                                const fallbackCanvasX = anchorPointCanvas.x - labelWidth / 2;
                                const fallbackCanvasY = anchorPointCanvas.y - labelHeight - 15;
                                const canvasSpaceFallbackOffset = { 
                                    x: fallbackCanvasX - anchorPointCanvas.x, 
                                    y: fallbackCanvasY - anchorPointCanvas.y 
                                };
                                imageSpaceOffset = { 
                                    x: canvasSpaceFallbackOffset.x / scale, 
                                    y: canvasSpaceFallbackOffset.y / scale 
                                };
                            }
                        }
                        // Store the newly calculated (or fallback) image-space offset
                         if (!calculatedLabelOffsets[currentImageLabel]) calculatedLabelOffsets[currentImageLabel] = {};
                        calculatedLabelOffsets[currentImageLabel][strokeLabel] = imageSpaceOffset;
                        // console.log(`    Stored calculated image-space offset for ${strokeLabel}:`, imageSpaceOffset);
                    }

                    // Now, calculate the final canvas position for drawing using the image-space anchor and image-space offset
                    const finalLabelImageX = anchorPointImage.x + imageSpaceOffset.x;
                    const finalLabelImageY = anchorPointImage.y + imageSpaceOffset.y;

                    finalPositionCanvas = {
                        x: (finalLabelImageX * scale) + imageX,
                        y: (finalLabelImageY * scale) + imageY
                    };
                    // console.log(`    Final Canvas Position for ${strokeLabel}:`, finalPositionCanvas, `(from ImagePos: ${finalLabelImageX.toFixed(1)},${finalLabelImageY.toFixed(1)})`);

                    currentLabelPositions.push({ 
                        ...labelRectForSizing, 
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
                               labelColor
                           );
                         } catch(err) {
                            console.error(`      Error in drawLabelConnector for ${strokeLabel}:`, err);
                         }
                     } else {
                         console.warn("     drawLabelConnector function is not defined!");
                     }

                    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
                    ctx.fillRect(finalPositionCanvas.x, finalPositionCanvas.y, labelWidth, labelHeight);

                    ctx.strokeStyle = labelColor;
                    ctx.lineWidth = 1;
                    ctx.strokeRect(finalPositionCanvas.x, finalPositionCanvas.y, labelWidth, labelHeight);

                    ctx.fillStyle = labelColor;
                    const textX = finalPositionCanvas.x + labelWidth / 2;
                    const textY = finalPositionCanvas.y + labelHeight - 7; 
                    ctx.fillText(labelText, textX, textY);
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

    function saveState(force = false, incrementLabel = true, updateStrokeList = true, isDrawingOrPasting = false, strokeInProgress = false) {
        console.log('[Save State Called]', 'force='+force, 'incrementLabel='+incrementLabel, 'updateStrokeList='+updateStrokeList, 'isDrawingOrPasting='+isDrawingOrPasting, 'strokeInProgress='+strokeInProgress);
        
        // Log current state of measurements to verify they're captured
        console.log(`[saveState] Current strokeMeasurements for ${currentImageLabel}:`, 
            JSON.stringify(window.strokeMeasurements[currentImageLabel]));
            
        // Track current scale and position to ensure they're preserved
        if (window.imageScaleByLabel && window.imageScaleByLabel[currentImageLabel] !== undefined) {
            console.log(`[saveState] Current scale for ${currentImageLabel}: ${window.imageScaleByLabel[currentImageLabel]}`);
        } else {
            console.warn(`[saveState] No scale found for ${currentImageLabel}!`);
        }
        
        if (window.imagePositionByLabel && window.imagePositionByLabel[currentImageLabel]) {
            console.log(`[saveState] Current position for ${currentImageLabel}: x=${window.imagePositionByLabel[currentImageLabel].x}, y=${window.imagePositionByLabel[currentImageLabel].y}`);
        } else {
            console.warn(`[saveState] No position found for ${currentImageLabel}!`);
        }

        // Get current state
        const currentState = getCanvasState();

        // Initialize if first save for this image
        if (!imageStates[currentImageLabel]) {
            imageStates[currentImageLabel] = cloneImageData(currentState);
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
            console.log(`[Save State] Entering stroke update block.`);
            
            // Get the suggested next label
            const suggestedLabel = labelsByImage[currentImageLabel];
            console.log(`[Save State] Suggested next label = "${suggestedLabel}" from labelsByImage[${currentImageLabel}]`);
            
            // *** FIX: Ensure the new stroke gets a UNIQUE label ***
            strokeLabel = generateUniqueStrokeName(suggestedLabel);
            console.log(`[Save State] Assigned UNIQUE strokeLabel = "${strokeLabel}"`);
            
            // Always increment the label counter based on the original suggested label for the next stroke
            const nextLabel = getNextLabel(currentImageLabel); // Uses the value in labelsByImage
            labelsByImage[currentImageLabel] = nextLabel;
            console.log(`[Save State] Incremented labelsByImage[${currentImageLabel}] to "${nextLabel}"`);
            
            // Auto-select the newly created stroke to ensure it gets focus
            selectedStrokeByImage[currentImageLabel] = strokeLabel;
            console.log(`[Save State] Auto-selected newly created stroke: ${strokeLabel}`);
            
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
                console.log(`[Save State] Initializing lineStrokesByImage[${currentImageLabel}] as []`);
                lineStrokesByImage[currentImageLabel] = []; // Initialize if it doesn't exist
            }
            
            // Check if unique stroke label already exists before pushing (shouldn't happen with generateUniqueStrokeName)
            const labelAlreadyExists = lineStrokesByImage[currentImageLabel].includes(strokeLabel);
            
            console.log(`[Save State] BEFORE push: lineStrokesByImage[${currentImageLabel}] =`, JSON.parse(JSON.stringify(lineStrokesByImage[currentImageLabel])));
            
            if (!labelAlreadyExists && updateStrokeList) {
                lineStrokesByImage[currentImageLabel].push(strokeLabel); // Push the unique label
                console.log(`[Save State] AFTER push: lineStrokesByImage[${currentImageLabel}] =`, JSON.parse(JSON.stringify(lineStrokesByImage[currentImageLabel])));
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
            console.log(`[Save State] Moved vector data from ${tempStrokeKey} to ${strokeLabel}`);
        } else if (strokeLabel) {
            console.warn(`[Save State] No temporary vector data found at ${tempStrokeKey} for stroke ${strokeLabel}`);
            // Attempt to find vector data if it somehow got assigned to the suggested label during draw (fallback)
            const suggestedLabel = labelsByImage[currentImageLabel]; // Get the label *before* incrementing
             if (vectorStrokesByImage[currentImageLabel] && vectorStrokesByImage[currentImageLabel][suggestedLabel]) {
                console.log(`[Save State] Fallback: Found data under suggested label ${suggestedLabel}`);
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
            calculatedLabelOffsets: calculatedLabelOffsets[currentImageLabel] ? JSON.parse(JSON.stringify(calculatedLabelOffsets[currentImageLabel])) : {}
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
        console.log(`Attempting to undo in ${currentImageLabel} workspace`);
        console.log(`Current undo stack: ${undoStackByImage[currentImageLabel]?.length || 0} items`);
        console.log(`Current strokes: ${lineStrokesByImage[currentImageLabel]?.join(', ') || 'none'}`);
        
        const currentStack = undoStackByImage[currentImageLabel];
        if (currentStack && currentStack.length > 1) { // Keep at least one state (initial)
            // Get the state we're undoing from
            const lastAction = currentStack.pop();
            console.log(`Undoing action of type: ${lastAction.type}, label: ${lastAction.label || 'none'}`);
            
            // Add to redo stack
            redoStackByImage[currentImageLabel] = redoStackByImage[currentImageLabel] || [];
            redoStackByImage[currentImageLabel].push(lastAction);
            console.log(`Added to redo stack, now has ${redoStackByImage[currentImageLabel].length} items`);
            
            // Skip certain state types when undoing
            if (lastAction.type === 'pre-stroke') {
                console.log('Skipping pre-stroke state');
                // If we encounter a pre-stroke state, undo again to get to the previous complete state
                if (currentStack.length > 1) {
                    return undo();
                }
            }
            
            // Handle snapshot type (created when switching views)
            if (lastAction.type === 'snapshot') {
                console.log('Restoring from snapshot state');
                // If we have stored strokes in the snapshot, restore them
                if (lastAction.strokes) {
                    lineStrokesByImage[currentImageLabel] = [...(lastAction.strokes || [])];
                    console.log(`Restored strokes: ${lineStrokesByImage[currentImageLabel].join(', ')}`);
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
                    console.log(`Removed stroke: ${removedStroke}`);
                    
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
                        console.log(`Removed measurement data for stroke: ${removedStroke}`);
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
                        console.log(`All strokes undone, reset label counter to A1`);
                    } else {
                // Set the next label to be the one we just removed
                if (lastAction.label) {
                    labelsByImage[currentImageLabel] = lastAction.label;
                    console.log(`Reset label counter to: ${lastAction.label}`);
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
                // Restore the canvas state
                const stateToRestore = cloneImageData(previousState.state);
                imageStates[currentImageLabel] = stateToRestore;
                restoreCanvasState(stateToRestore);
                currentStroke = cloneImageData(stateToRestore);
                console.log('Canvas state restored');

                // Restore label positions if they exist in the state
                if (previousState.customLabelPositions) {
                    customLabelPositions[currentImageLabel] = JSON.parse(JSON.stringify(previousState.customLabelPositions));
                } else {
                    // If not in state, ensure it's at least an empty object to prevent errors
                    customLabelPositions[currentImageLabel] = {}; 
                }
                if (previousState.calculatedLabelOffsets) {
                    calculatedLabelOffsets[currentImageLabel] = JSON.parse(JSON.stringify(previousState.calculatedLabelOffsets));
                } else {
                    calculatedLabelOffsets[currentImageLabel] = {};
                }

            } else {
                console.log('Warning: No valid previous state found');
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
            
            // For delete-stroke undo operations, ensure a complete redraw to avoid visual glitches
            if (lastAction && lastAction.type === 'delete-strokes') {
                // Short delay to ensure all state is updated before final redraw
                setTimeout(() => {
                    redrawCanvasWithVisibility();
                }, 50);
            }
        } else if (currentStack && currentStack.length === 1) {
            // We're at the initial state
            console.log('At initial state, resetting workspace');
            const initialState = currentStack[0];
            
            // Clear all stroke data
            lineStrokesByImage[currentImageLabel] = [];
            strokeVisibilityByImage[currentImageLabel] = {};
            strokeLabelVisibility[currentImageLabel] = {};
            vectorStrokesByImage[currentImageLabel] = {};
            strokeDataByImage[currentImageLabel] = {};
            
            // Reset label counter
            labelsByImage[currentImageLabel] = 'A1';  // Reset to A1
            
            if (initialState && initialState.state) {
                imageStates[currentImageLabel] = cloneImageData(initialState.state);
                restoreCanvasState(initialState.state);
                currentStroke = cloneImageData(initialState.state);

                // Restore label positions if they exist in the initial state
                if (initialState.customLabelPositions) {
                    customLabelPositions[currentImageLabel] = JSON.parse(JSON.stringify(initialState.customLabelPositions));
                } else {
                    customLabelPositions[currentImageLabel] = {};
                }
                if (initialState.calculatedLabelOffsets) {
                    calculatedLabelOffsets[currentImageLabel] = JSON.parse(JSON.stringify(initialState.calculatedLabelOffsets));
                } else {
                    calculatedLabelOffsets[currentImageLabel] = {};
                }

            } else if (window.originalImages[currentImageLabel]) {
                // If we have the original image, redraw it
                console.log('Redrawing from original image');
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
        } else {
            console.log('No undo history available for this workspace');
        }
    }
    
    function redo() {
        console.log(`Attempting to redo in ${currentImageLabel} workspace`);
        console.log(`Current redo stack: ${redoStackByImage[currentImageLabel]?.length || 0} items`);
        
        const redoStack = redoStackByImage[currentImageLabel];
        if (redoStack && redoStack.length > 0) {
            // Get the action to redo
            const actionToRedo = redoStack.pop();
            console.log(`Redoing action of type: ${actionToRedo.type}, label: ${actionToRedo.label || 'none'}`);
            
            // Add back to undo stack
            undoStackByImage[currentImageLabel].push(actionToRedo);
            
            // Handle delete-strokes action
            if (actionToRedo.type === 'delete-strokes') {
                // Delete strokes again
                actionToRedo.strokes.forEach(strokeLabel => {
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
                    
                    // Remove from line strokes
                    if (lineStrokesByImage[actionToRedo.image]) {
                        lineStrokesByImage[actionToRedo.image] = lineStrokesByImage[actionToRedo.image].filter(label => label !== strokeLabel);
                    }
                });
                
                // Clear selection
                multipleSelectedStrokesByImage[actionToRedo.image] = [];
                selectedStrokeByImage[actionToRedo.image] = null;
            }
            // Handle stroke type actions (freehand strokes, straight lines, and curved lines)
            else if ((actionToRedo.type === 'line' || actionToRedo.type === 'stroke' || actionToRedo.type === 'curve') && actionToRedo.label) {
                // Add the stroke back to the list
                lineStrokesByImage[currentImageLabel] = lineStrokesByImage[currentImageLabel] || [];
                lineStrokesByImage[currentImageLabel].push(actionToRedo.label);
                console.log(`Added stroke back: ${actionToRedo.label}`);
                
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
                            color: actionToRedo.color || "#000000",
                            width: 5,
                            type: strokeType,
                            // For curved lines, add dummy control points
                            controlPoints: strokeType === 'curved' ? [
                                { x: canvas.width/2 - 50, y: canvas.height/2 },
                                { x: canvas.width/2 + 50, y: canvas.height/2 }
                            ] : undefined
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
                    console.log(`Restored measurement data for stroke: ${actionToRedo.label}`);
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
                    console.log(`Set next label to: ${nextLabel}`);
                } else {
                    // Fallback to the standard next label function
                labelsByImage[currentImageLabel] = getNextLabel(currentImageLabel);
                console.log(`Set next label to: ${labelsByImage[currentImageLabel]}`);
                }
            }
            
            // Restore the state
            if (actionToRedo.state) {
                const stateToRestore = cloneImageData(actionToRedo.state);
                imageStates[currentImageLabel] = stateToRestore;
                restoreCanvasState(stateToRestore);
                currentStroke = cloneImageData(stateToRestore);
                console.log('Canvas state restored for redo');

                // Restore label positions if they exist in the action
                if (actionToRedo.customLabelPositions) {
                    customLabelPositions[currentImageLabel] = JSON.parse(JSON.stringify(actionToRedo.customLabelPositions));
                } else {
                     // If not in state, ensure it's at least an empty object to prevent errors
                    customLabelPositions[currentImageLabel] = {};
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
        } else {
            console.log('No redo actions available for this workspace');
        }
    }

    // Save initial blank state
//    saveState();

    // Set canvas size
    function resizeCanvas() {
        // Account for the sidebars and gaps in our calculation (approximately 420px for sidebars + gaps)
        const sidebarSpace = 440;
        const maxWidth = Math.min(window.innerWidth - sidebarSpace, 1000);  // Cap at 1000px width
        const maxHeight = Math.min(window.innerHeight - 100, 800);  // Cap at 800px height
        
        // Save current state before resizing
        const oldState = imageStates[currentImageLabel];
        
        // Resize the canvas
        canvas.width = maxWidth;
        canvas.height = maxHeight;
        
        // Set default canvas styles
        canvas.style.cursor = 'crosshair';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        // Restore the image after resize
        if (oldState) {
            // Try to restore from saved state first
            try {
                restoreCanvasState(oldState);
                currentStroke = cloneImageData(oldState);
            } catch (e) {
                // If that fails, redraw from original image
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
                    };
                    img.src = window.originalImages[currentImageLabel];
                } else if (!currentStroke) {
                    // Initialize blank state if needed
                    currentStroke = getCanvasState();
                }
            }
        }
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Drawing state
    let isDrawing = false;
    let lastX = 0;
    let lastY = 0;
    let points = [];
    let lastVelocity = 0;
    
    // Click vs drag detection
    let mouseDownPosition = null;
    const MINIMUM_DRAG_DISTANCE = 3; // pixels
    
    // Curved line defocus tracking
    let curveJustCompleted = false;

    // Drawing mode state
    let drawingMode = 'freehand'; // Options: 'freehand', 'straight', 'curved', 'arrow'
    let straightLineStart = null; // For straight line mode - start point
    let curvedLinePoints = []; // For curved line mode - array of control points
    let arrowLineStart = null; // For arrow line mode - start point
    let arrowSettings = { // Arrow customization settings
        startArrow: false,
        endArrow: true,
        arrowSize: 15,
        arrowStyle: 'triangular' // Options: 'triangular', 'filled', 'curved'
    };
    
    // Performance optimization constants for arrow rendering
    const ARROW_PERFORMANCE_CACHE = {
        // Pre-calculated trigonometry for 30-degree arrowheads
        ARROW_TAN_30: Math.tan(Math.PI / 6), // ~0.577
        
        // Cached values updated during render cycles
        lastBrushSize: null,
        lastScale: null,
        cachedScaledArrowSize: null,
        cachedBrushSize: null,
        
        // Update cache when scale or brush size changes
        updateCache: function(brushSize, scale, baseArrowSize) {
            if (this.lastBrushSize !== brushSize || this.lastScale !== scale) {
                this.lastBrushSize = brushSize;
                this.lastScale = scale;
                this.cachedScaledArrowSize = Math.max(baseArrowSize, brushSize * 2) * scale;
            }
            return this.cachedScaledArrowSize;
        },
        
        // Clear cache at start of new render cycle
        clearCache: function() {
            this.cachedBrushSize = null;
        }
    };
    
    let lastDrawnPoint = null;

    // Helper function to get transformed coordinates (image space from canvas space)
    function getTransformedCoords(canvasX, canvasY) {
        const scale = window.imageScaleByLabel[currentImageLabel] || 1;
        const position = imagePositionByLabel[currentImageLabel] || { x: 0, y: 0 };
        
        // Calculate the image position on canvas (CORRECTED LOGIC)
        let imageX, imageY;
        
        // *** ADDED DETAILED LOGGING ***
        console.log(`getTransformedCoords START for ${currentImageLabel}`);
        // Explicitly use the window property to avoid scope issues
        // *** MODIFIED CHECK ***
        const dimensionsObject = window.originalImageDimensions;
        // console.log(`  All Dimensions:`, JSON.stringify(dimensionsObject));
        const dims = dimensionsObject ? dimensionsObject[currentImageLabel] : undefined;
        console.log(`  Current Dim Check: dims =`, dims);
        // *** END MODIFIED CHECK ***

        // Check if this is a blank canvas without an image
        const noImageLoaded = !window.originalImages || !window.originalImages[currentImageLabel];
        
        // For blank canvas drawing, need to convert canvas coordinates to "image" coordinates
        // by undoing scaling and position offset
        if (noImageLoaded || (dims && dims.width === canvas.width && dims.height === canvas.height)) {
            console.log(`getTransformedCoords: BLANK CANVAS MODE - Applying inverse scaling and offset`);
            // Calculate canvas center for scaling
            const canvasCenter = {
                x: canvas.width / 2,
                y: canvas.height / 2
            };
            
            // First remove position offset
            const positionAdjustedX = canvasX - position.x;
            const positionAdjustedY = canvasY - position.y;
            
            // Then apply inverse scaling from center
            const imgX = ((positionAdjustedX - canvasCenter.x) / scale) + canvasCenter.x;
            const imgY = ((positionAdjustedY - canvasCenter.y) / scale) + canvasCenter.y;
            
            console.log(`  Removing offset: (${positionAdjustedX}, ${positionAdjustedY})`);
            console.log(`  Inverse scaling: (${imgX}, ${imgY})`);
            
            return { x: imgX, y: imgY };
        }

        // Use loaded dimensions if available, otherwise fallback to canvas center
        if (dims && dims.width > 0 && dims.height > 0) {
            const centerX = (canvas.width - dims.width * scale) / 2;
            const centerY = (canvas.height - dims.height * scale) / 2;
            imageX = centerX + position.x;
            imageY = centerY + position.y;
            console.log(`getTransformedCoords: Using image dims ${dims.width}x${dims.height}. Calculated imageX=${imageX}, imageY=${imageY}`);
        } else {
            // Fallback if dimensions aren't loaded (should ideally not happen after load)
            imageX = canvas.width / 2 + position.x;
            imageY = canvas.height / 2 + position.y;
            console.warn(`getTransformedCoords: Dimensions not found for ${currentImageLabel}. Falling back to canvas center calculation. imageX=${imageX}, imageY=${imageY}`);
        }
        
        // Transform from canvas coordinates to image-relative coordinates
        const imgX = (canvasX - imageX) / scale;
        const imgY = (canvasY - imageY) / scale;
        
        console.log(`getTransformedCoords RESULT: Canvas(${canvasX}, ${canvasY}) -> Image(${imgX.toFixed(1)}, ${imgY.toFixed(1)})`);
        return { x: imgX, y: imgY };
    }

    // Helper function to deselect all strokes and clear edit mode
    function deselectAllStrokes() {
        console.log('Deselecting all strokes');
        
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

    // Helper function to handle defocus clicks (single clicks that don't create strokes)
    function handleDefocusClick() {
        console.log('Single click detected - defocusing measurements');
        
        // Handle curve completion defocus
        if (curveJustCompleted) {
            console.log('First click after curve completion - clearing flag');
            curveJustCompleted = false;
            redrawCanvasWithVisibility();
            return; // Just clear the flag and exit
        }
        
        // For curved lines, handle special defocus behavior
        if (drawingMode === 'curved' && curvedLinePoints.length > 0) {
            console.log('Curved line in progress - clearing curved line state');
            curvedLinePoints = [];
            redrawCanvasWithVisibility();
            return; // First click after curved line just clears the curve state
        }
        
        // Defocus any active measurement inputs (including stroke visibility items)
        const activeElement = document.activeElement;
        if (activeElement && (
            (activeElement.classList && activeElement.classList.contains('measure-text')) ||
            activeElement.contentEditable === 'true' ||
            activeElement.tagName === 'INPUT' ||
            activeElement.tagName === 'TEXTAREA'
        )) {
            console.log('Defocusing active input element:', activeElement.className || activeElement.tagName);
            activeElement.blur();
        }
        
        // Also defocus any selected stroke measurements that might be focused
        const allMeasureTexts = document.querySelectorAll('.measure-text[contenteditable="true"]');
        allMeasureTexts.forEach(element => {
            if (element !== activeElement) {
                console.log('Defocusing additional measurement element');
                element.blur();
            }
        });
        
        // Clear any drawing artifacts (like dots from incomplete freehand strokes)
        redrawCanvasWithVisibility();
        
        // Optionally clear selections (but keep them for now to maintain selection state)
        // This can be uncommented if you want clicks to also clear selections:
        // if (window.selectedStrokeByImage && window.currentImageLabel) {
        //     window.selectedStrokeByImage[window.currentImageLabel] = null;
        //     if (window.multipleSelectedStrokesByImage) {
        //         window.multipleSelectedStrokesByImage[window.currentImageLabel] = [];
        //     }
        //     updateStrokeVisibilityControls();
        //     redrawCanvasWithVisibility();
        // }
    }

    // Helper function to get canvas coordinates from image coordinates
    function getCanvasCoords(imageX_relative, imageY_relative) {
        // *** ADDED DETAILED LOGGING ***
        console.log(`--- getCanvasCoords Called (Label Anchor?) ---`);
        console.log(`  Input Relative Coords: x=${imageX_relative}, y=${imageY_relative}`);

        const scale = window.imageScaleByLabel[currentImageLabel] || 1;
        const position = imagePositionByLabel[currentImageLabel] || { x: 0, y: 0 };
        console.log(`  Using: scale=${scale}, position=`, position);

        // Check if this is a blank canvas without an image
        const noImageLoaded = !window.originalImages || !window.originalImages[currentImageLabel];
        
        // Calculate the image position on canvas (TOP-LEFT CORNER)
        // *** MODIFIED CHECK ***
        const dimensionsObject = window.originalImageDimensions; // Use window property
        console.log(`  Checking Dimensions: dims object =`, dimensionsObject);
        const dims = dimensionsObject ? dimensionsObject[currentImageLabel] : undefined;
        console.log(`  Checking Dimensions: dims for ${currentImageLabel} =`, dims);
        // *** END MODIFIED CHECK ***
        
        // For blank canvas drawing, use the canvas coordinates directly but apply the offset
        if (noImageLoaded || (dims && dims.width === canvas.width && dims.height === canvas.height)) {
            console.log(`getCanvasCoords: BLANK CANVAS MODE - Applying scale and offset to coordinates`);
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
            console.log(`  Scaled Coords: x=${scaledX}, y=${scaledY}`);
            console.log(`  Final Canvas Coords: x=${finalX}, y=${finalY}`);
            console.log(`---------------------------------------------`);
            return { x: finalX, y: finalY };
        }

        let canvasImageTopLeftX, canvasImageTopLeftY;

        if (dims && dims.width > 0 && dims.height > 0) {
            const centerX = (canvas.width - dims.width * scale) / 2;
            const centerY = (canvas.height - dims.height * scale) / 2;
            canvasImageTopLeftX = centerX + position.x;
            canvasImageTopLeftY = centerY + position.y;
            console.log(`  Calculated TopLeft: x=${canvasImageTopLeftX}, y=${canvasImageTopLeftY} (Using Dims)`);
        } else {
            // Fallback (should not happen after load ideally)
            canvasImageTopLeftX = canvas.width / 2 + position.x;
            canvasImageTopLeftY = canvas.height / 2 + position.y;
            console.warn(`getCanvasCoords: Dimensions not found for ${currentImageLabel}. Falling back. TopLeft: x=${canvasImageTopLeftX}, y=${canvasImageTopLeftY}`);
        }

        // Transform from image-relative coordinates to canvas coordinates
        const canvasX = (imageX_relative * scale) + canvasImageTopLeftX;
        const canvasY = (imageY_relative * scale) + canvasImageTopLeftY;
        console.log(`  Final Canvas Coords: x=${canvasX}, y=${canvasY}`);
        console.log(`---------------------------------------------`);
        // *** END DETAILED LOGGING ***

        return { x: canvasX, y: canvasY };
    }

    // Drawing function for freehand mode
    function draw(e) {
        if (!isDrawing) return;
        
        const canvasX = e.offsetX;
        const canvasY = e.offsetY;

        // Get image coordinates for storing in the points array
        // This transforms from canvas coordinates to image-relative coordinates
        const { x: imgX, y: imgY } = getTransformedCoords(canvasX, canvasY);

        // *** Add Log Here ***
        console.log(`Draw Move: Canvas(${canvasX}, ${canvasY}) -> Image(${imgX.toFixed(1)}, ${imgY.toFixed(1)})`);

        // Calculate time delta for velocity
        const currentPoint = {
            x: imgX,    // Store image-relative X
            y: imgY,    // Store image-relative Y
            canvasX: canvasX, // Store canvas X for drawing
            canvasY: canvasY, // Store canvas Y for drawing
            time: Date.now()
        };
        
        console.log(`Adding point at canvas: (${canvasX}, ${canvasY}), image-relative: (${imgX}, ${imgY})`);
        
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

        // Set drawing styles
        ctx.strokeStyle = colorPicker.value;
        ctx.lineWidth = dynamicWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();

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
                type: 'freehand'
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
         const baseArrowSize = Math.max(arrowSettings.arrowSize || 15, brushSizeValue * 2);
         const scaledArrowSize = baseArrowSize * scale;
         
         // Calculate line direction
         const dx = endPoint.x - startPoint.x;
         const dy = endPoint.y - startPoint.y;
         const lineLength = Math.sqrt(dx * dx + dy * dy);
         
         let adjustedStartX = startPoint.x;
         let adjustedStartY = startPoint.y;
         let adjustedEndX = endPoint.x;
         let adjustedEndY = endPoint.y;
         
         if (lineLength > 0) {
             const unitX = dx / lineLength;
             const unitY = dy / lineLength;
             const shortening = scaledArrowSize * 0.8; // Same shortening as final render
             
             // Adjust start point if start arrow is enabled
             if (arrowSettings.startArrow) {
                 adjustedStartX = startPoint.x + shortening * unitX;
                 adjustedStartY = startPoint.y + shortening * unitY;
             }
             
             // Adjust end point if end arrow is enabled
             if (arrowSettings.endArrow) {
                 adjustedEndX = endPoint.x - shortening * unitX;
                 adjustedEndY = endPoint.y - shortening * unitY;
             }
         }
         
         // Draw the arrow line shaft with adjusted endpoints
         ctx.save();
         ctx.strokeStyle = colorPicker.value;
         ctx.lineWidth = parseInt(brushSize.value) * scale;
         ctx.lineCap = 'round';
         ctx.setLineDash([]);
         
         ctx.beginPath();
         ctx.moveTo(adjustedStartX, adjustedStartY);
         ctx.lineTo(adjustedEndX, adjustedEndY);
         ctx.stroke();
         
         // Draw arrowheads at original endpoints (not adjusted)
         drawArrowhead(startPoint, endPoint, arrowSettings, colorPicker.value);
         
         ctx.restore();
     }
    
         // Function to calculate and draw arrowheads (optimized for performance)
     function drawArrowhead(startPoint, endPoint, settings, strokeColor = null) {
         const { startArrow, endArrow, arrowSize, arrowStyle } = settings;
         const scale = window.imageScaleByLabel[currentImageLabel] || 1;
         
         // Cache DOM query result - only query once per render cycle
         const brushSize = ARROW_PERFORMANCE_CACHE.cachedBrushSize || 
                          (ARROW_PERFORMANCE_CACHE.cachedBrushSize = parseInt(document.getElementById('brushSize').value) || 5);
         
         // Use performance cache to avoid redundant calculations
         const scaledArrowSize = ARROW_PERFORMANCE_CACHE.updateCache(brushSize, scale, arrowSize);
        
        // Calculate line angle and direction
        const dx = endPoint.x - startPoint.x;
        const dy = endPoint.y - startPoint.y;
        const lineLength = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);
        
        // Calculate shortened line endpoints so arrowheads become the true endpoints
        let adjustedStartPoint = { ...startPoint };
        let adjustedEndPoint = { ...endPoint };
        
        if (lineLength > 0) {
            const unitX = dx / lineLength;
            const unitY = dy / lineLength;
            
            // Shorten line from start if start arrow is enabled
            if (startArrow) {
                adjustedStartPoint.x = startPoint.x + (scaledArrowSize * 0.8) * unitX;
                adjustedStartPoint.y = startPoint.y + (scaledArrowSize * 0.8) * unitY;
            }
            
            // Shorten line from end if end arrow is enabled  
            if (endArrow) {
                adjustedEndPoint.x = endPoint.x - (scaledArrowSize * 0.8) * unitX;
                adjustedEndPoint.y = endPoint.y - (scaledArrowSize * 0.8) * unitY;
            }
        }
        
        // Set context properties once for all arrowheads
        ctx.save();
        const arrowColor = strokeColor || colorPicker.value;
        ctx.fillStyle = arrowColor;
        ctx.strokeStyle = arrowColor;
        ctx.lineWidth = brushSize * scale;
        
        // Draw arrowheads without redundant context operations
        if (startArrow) {
            drawSingleArrowhead(startPoint.x, startPoint.y, angle + Math.PI, scaledArrowSize, arrowStyle);
        }
        
        if (endArrow) {
            drawSingleArrowhead(endPoint.x, endPoint.y, angle, scaledArrowSize, arrowStyle);
        }
        
        ctx.restore();
        
        // Return the adjusted endpoints so the line can be drawn to the arrowhead bases
        return {
            adjustedStartPoint,
            adjustedEndPoint
        };
    }
    
         // Function to draw a single arrowhead
     function drawSingleArrowhead(x, y, angle, size, style) {
         const arrowAngle = Math.PI / 6; // 30 degrees
         
         ctx.save();
         ctx.translate(x, y);
         ctx.rotate(angle);
         
         // Always use filled arrowheads with fixed outline thickness
         ctx.lineWidth = 1; // Fixed thin outline
         
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
        
        // Draw the straight line
        ctx.beginPath();
        ctx.moveTo(startPoint.x, startPoint.y);
        ctx.lineTo(endPoint.x, endPoint.y);
        
        // Set drawing styles
        ctx.strokeStyle = colorPicker.value;
        const scale = window.imageScaleByLabel[currentImageLabel] || 1.0;
        ctx.lineWidth = parseInt(brushSize.value) * scale;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
        
        // Draw a small circle at the end point
        ctx.beginPath();
        const endRadius = parseInt(brushSize.value) * scale / 2;
        ctx.arc(endPoint.x, endPoint.y, endRadius, 0, Math.PI * 2);
        ctx.fillStyle = colorPicker.value;
        ctx.fill();
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

        // Clear the canvas to the last saved state
        if (currentStroke) {
            restoreCanvasState(currentStroke);
        }

        const scale = window.imageScaleByLabel[currentImageLabel] || 1.0;
        
        // Create preview points (include mouse position if provided)
        let previewPoints = [...controlPoints];
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
            ctx.arc(cp.canvasX, cp.canvasY, pointRadius, 0, Math.PI * 2);
            ctx.fillStyle = colorPicker.value;
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.stroke();
        });

        if (previewPoints.length === 1) {
            // Just one point - draw a thin white line to mouse if mouse position provided
            if (mousePos) {
                ctx.beginPath();
                ctx.moveTo(previewPoints[0].canvasX, previewPoints[0].canvasY);
                ctx.lineTo(mousePos.x, mousePos.y);
                ctx.strokeStyle = 'rgba(240, 240, 240, 0.7)'; // Near white with transparency
                ctx.lineWidth = Math.max(1, parseInt(brushSize.value) * scale * 0.6); // Thinner than regular
                ctx.lineCap = 'round';
                ctx.stroke();
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
                
                // Use near-white with transparency and thinner line for preview
                ctx.strokeStyle = 'rgba(240, 240, 240, 0.7)'; // Near white with 70% opacity
                ctx.lineWidth = Math.max(1, parseInt(brushSize.value) * scale * 0.6); // 60% of regular thickness
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.stroke();
            }
        }
    }
    
    // Get arrow control elements
    const arrowControls = document.getElementById('arrowControls');
    const startArrowCheckbox = document.getElementById('startArrow');
    const endArrowCheckbox = document.getElementById('endArrow');
    
    // Drawing mode toggle event listener
    drawingModeToggle.addEventListener('click', () => {
        if (drawingMode === 'freehand') {
            drawingMode = 'straight';
            drawingModeToggle.textContent = 'Straight Line';
            drawingModeToggle.classList.remove('curved-mode', 'arrow-mode');
            drawingModeToggle.classList.add('straight-mode');
            arrowControls.style.display = 'none';
        } else if (drawingMode === 'straight') {
            drawingMode = 'curved';
            drawingModeToggle.textContent = 'Curved Line';
            drawingModeToggle.classList.remove('straight-mode', 'arrow-mode');
            drawingModeToggle.classList.add('curved-mode');
            arrowControls.style.display = 'flex'; // Show arrow controls in curved mode
        } else if (drawingMode === 'curved') {
            drawingMode = 'arrow';
            drawingModeToggle.textContent = 'Arrow Line';
            drawingModeToggle.classList.remove('curved-mode', 'straight-mode');
            drawingModeToggle.classList.add('arrow-mode');
            arrowControls.style.display = 'flex';
        } else {
            drawingMode = 'freehand';
            drawingModeToggle.textContent = 'Freehand';
            drawingModeToggle.classList.remove('curved-mode', 'straight-mode', 'arrow-mode');
            arrowControls.style.display = 'none';
        }
        
        // Clear any temporary drawing state when switching modes
        straightLineStart = null;
        curvedLinePoints = [];
        arrowLineStart = null; // Clear arrow line state
        console.log(`Drawing mode changed to: ${drawingMode}`);
    });
    
    // Arrow control event listeners
    startArrowCheckbox.addEventListener('change', () => {
        arrowSettings.startArrow = startArrowCheckbox.checked;
        console.log(`Start arrow: ${arrowSettings.startArrow}`);
    });
    
    endArrowCheckbox.addEventListener('change', () => {
        arrowSettings.endArrow = endArrowCheckbox.checked;
        console.log(`End arrow: ${arrowSettings.endArrow}`);
    });

    // Mouse drag variables for image movement
    let isDraggingImage = false;
    let lastMouseX = 0;
    let lastMouseY = 0;
    let hoveredCanvasLabelInfo = null; // NEW: To store info about the label currently hovered on canvas
    
    // Helper function to find if a point is inside a label
    function findLabelAtPoint(x, y) {
        for (const label of currentLabelPositions) {
            if (x >= label.x && x <= label.x + label.width &&
                y >= label.y && y <= label.y + label.height) {
                return label;
            }
        }
        return null;
    }
    
    // Mouse event listeners
    canvas.addEventListener('mousedown', (e) => {
        // First, check if we should be dragging the image (shift key pressed)
        if (isShiftPressed) {
            isDraggingImage = true;
            lastMouseX = e.offsetX;
            lastMouseY = e.offsetY;
            canvas.style.cursor = 'grabbing';
            return;
        }

        // Check for double-click on stroke on canvas (for entering edit mode)
        // BUT FIRST: If we're in curved drawing mode with control points, prioritize curve finalization
        const now = Date.now();
        if (now - window.lastCanvasClickTime < window.clickDelay) {
            // Priority 1: If in curved mode with control points, finalize the curve (don't enter edit mode)
            if (drawingMode === 'curved' && curvedLinePoints.length >= 2) {
                console.log('Canvas Mousedown: Double-click detected while drawing curve - will finalize curve via dblclick handler');
                window.lastCanvasClickTime = 0; // Reset to prevent edit mode logic
                window.lastClickedCanvasLabel = null;
                // Let the dblclick handler manage curve finalization
                return;
            }
            
            // Priority 2: Normal edit mode logic (only if not finalizing a curve)
            const clickedLabelForDoubleClick = findLabelAtPoint(e.offsetX, e.offsetY);
            if (clickedLabelForDoubleClick && window.lastClickedCanvasLabel === clickedLabelForDoubleClick.strokeLabel) {
                console.log(`Canvas Mousedown: Double-click detected on label ${clickedLabelForDoubleClick.strokeLabel}`);
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
        

        // First, check if we're clicking on a control point (ONLY if in edit mode)
        if (window.selectedStrokeInEditMode) {
            const controlPointAtClick = findControlPointAtPosition(e.offsetX, e.offsetY);
            if (controlPointAtClick && controlPointAtClick.strokeLabel === window.selectedStrokeInEditMode) {
                console.log(`Canvas Mousedown: Clicked on control point ${controlPointAtClick.pointIndex} of stroke ${controlPointAtClick.strokeLabel} (IN EDIT MODE)`);
                
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
                } else {
                    // For curved line control points
                    draggedControlPointInfo = {
                        strokeLabel: controlPointAtClick.strokeLabel,
                        pointIndex: controlPointAtClick.pointIndex,
                        startCanvasX: e.offsetX,
                        startCanvasY: e.offsetY,
                        startImageCoords: { ...vectorStrokesByImage[currentImageLabel][controlPointAtClick.strokeLabel].controlPoints[controlPointAtClick.pointIndex] },
                        type: 'curved'
                    };
                }
                
                canvas.style.cursor = 'grabbing';
                e.preventDefault();
                return;
            }
        }

        // Second, check if we're clicking on a label
        const hoveredLabel = findLabelAtPoint(e.offsetX, e.offsetY);
        window.lastClickedCanvasLabel = hoveredLabel ? hoveredLabel.strokeLabel : null;

        if (hoveredLabel) {
            // This is a single click on a label, not a double click (double click is handled above and returns)
            const currentlyHoveredStroke = hoveredLabel.strokeLabel;
            console.log(`Canvas Mousedown: Single click on canvas label: ${currentlyHoveredStroke}.`);
            console.log(`Canvas Mousedown: Selection BEFORE update for ${window.currentImageLabel}:`, window.multipleSelectedStrokesByImage[window.currentImageLabel] ? JSON.parse(JSON.stringify(window.multipleSelectedStrokesByImage[window.currentImageLabel])) : 'undefined');

            // Clear curved line preview state if we're selecting a label while in curved mode
            if (drawingMode === 'curved' && curvedLinePoints.length > 0) {
                console.log('Canvas Mousedown: Clearing curved line preview state due to label selection');
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

                console.log(`Canvas Mousedown: Selection AFTER update for ${window.currentImageLabel}:`, JSON.parse(JSON.stringify(window.multipleSelectedStrokesByImage[window.currentImageLabel])));
                console.log(`Canvas Mousedown: Focused/Selected stroke is now ${currentlyHoveredStroke}`);

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
                }
                 if (typeof updateSelectionActionsPanel === 'function') updateSelectionActionsPanel();
            }
            
            // Then, allow label dragging to proceed
            isDraggingLabel = true;
            draggedLabelStroke = hoveredLabel; // Store the whole hoveredLabel object
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
                console.log(`Canvas Mousedown: Clicked on stroke ${strokeAtPoint.label} (type: ${strokeAtPoint.type})`);
                
                // Only clear curved line preview state if we're not actively building a curve
                // This allows curved lines to connect to existing strokes
                if (drawingMode === 'curved' && curvedLinePoints.length > 0) {
                    console.log('Canvas Mousedown: Preserving curved line state for potential stroke connection');
                    // Don't clear curvedLinePoints - let the curved line logic handle stroke snapping
                } else if (drawingMode === 'curved') {
                    console.log('Canvas Mousedown: Clearing curved line preview state due to stroke selection');
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
                        console.log(`Canvas Mousedown: Selected stroke ${strokeAtPoint.label} by clicking on it`);
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
                    console.log(`Canvas Mousedown: Drawing mode active or curved line in progress, not updating selection. Allowing drawing to start from stroke ${strokeAtPoint.label}`);
                }
                // IMPORTANT: Allow drawing to start from this stroke
                // Only prevent drawing if we're in edit mode for THIS specific stroke
                if (window.selectedStrokeInEditMode === strokeAtPoint.label) {
                    console.log(`Canvas Mousedown: Preventing drawing - stroke ${strokeAtPoint.label} is in edit mode`);
                    e.preventDefault();
                    return;
                }
                // If not in edit mode, fall through to allow drawing to start
            }
        }
        
        // If edit mode is active AND the click was NOT on the label of the stroke in edit mode, clear edit mode.
        if (window.selectedStrokeInEditMode && (!hoveredLabel || window.selectedStrokeInEditMode !== hoveredLabel.strokeLabel)) { 
            const prevEditStrokeLabel = window.selectedStrokeInEditMode;
            window.selectedStrokeInEditMode = null;
            // Optionally clear selection too, or just exit edit mode visuals
            // window.multipleSelectedStrokesByImage[window.currentImageLabel] = [];
            // window.selectedStrokeByImage[window.currentImageLabel] = null;
            
            hideSelectionActionsPanel(); 
            if (typeof window.redrawCanvasWithVisibility === 'function') window.redrawCanvasWithVisibility();
            if (typeof window.updateStrokeVisibilityControls === 'function') window.updateStrokeVisibilityControls();
            console.log(`Canvas Mousedown: Clicked outside, exited edit mode for stroke: ${prevEditStrokeLabel}`);
        }

        // Allow drawing even if clicking on an existing stroke (unlike before where we would select the stroke)
        // Prepare the vector stroke object
            if (!vectorStrokesByImage[currentImageLabel]) {
                vectorStrokesByImage[currentImageLabel] = {};
        }

        // Note: Double-click detection for curved line finalization is now handled above in the general double-click logic
    
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

        // Start drawing
        isDrawing = true;
        isDrawingOrPasting = true;
        strokeInProgress = true;
        points = [];
        lastVelocity = 0;
        lastDrawnPoint = null;
        [lastX, lastY] = [e.offsetX, e.offsetY];
        
        // Store mousedown position for click vs drag detection
        mouseDownPosition = { x: e.offsetX, y: e.offsetY };
        
        // --- FIX: Clear temporary drawing data --- 
        const tempStrokeKey = '_drawingStroke';
        if (vectorStrokesByImage[currentImageLabel] && vectorStrokesByImage[currentImageLabel][tempStrokeKey]) {
            delete vectorStrokesByImage[currentImageLabel][tempStrokeKey];
            console.log("Cleared temporary drawing data for key:", tempStrokeKey);
        }
        // --- END FIX ---
        
        if (drawingMode === 'straight') {
            // For straight line, just store the start point
            straightLineStart = { x: e.offsetX, y: e.offsetY };
        } else if (drawingMode === 'arrow') {
            // For arrow line, just store the start point
            arrowLineStart = { x: e.offsetX, y: e.offsetY };
        } else if (drawingMode === 'curved') {
            // For curved line, collect control points
            const { x: imgX, y: imgY } = getTransformedCoords(e.offsetX, e.offsetY);
            const controlPoint = {
                x: imgX,             // Image space X
                y: imgY,             // Image space Y
                canvasX: e.offsetX,  // Canvas space X
                canvasY: e.offsetY,  // Canvas space Y
                time: Date.now()
            };
            
            curvedLinePoints.push(controlPoint);
            console.log(`Added control point ${curvedLinePoints.length} at (${e.offsetX}, ${e.offsetY})`);
            
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
        }
    });
    
    canvas.addEventListener('mousemove', (e) => {
        const x = e.offsetX;
        const y = e.offsetY;

        let newHoveredLabelInfo = null;
        if (!isDrawing && !isDraggingImage && !isDraggingLabel) {
            newHoveredLabelInfo = findLabelAtPoint(x, y);
        }

        // Update cursor and visual hover state only if hovered label changed
        if ((hoveredCanvasLabelInfo?.strokeLabel !== newHoveredLabelInfo?.strokeLabel) || 
            (!hoveredCanvasLabelInfo && newHoveredLabelInfo) || 
            (hoveredCanvasLabelInfo && !newHoveredLabelInfo)) {
            
            hoveredCanvasLabelInfo = newHoveredLabelInfo;

            if (hoveredCanvasLabelInfo) {
                canvas.style.cursor = 'pointer'; // Pointer to indicate clickability for focus
                 console.log(`Canvas Mousemove: Hovering over label ${hoveredCanvasLabelInfo.strokeLabel}`);
                // Optional: Trigger a redraw if you want to visually highlight the label on hover
                // This requires redrawCanvasWithVisibility to check for hoveredCanvasLabelInfo
                // For now, cursor change is the primary feedback.
                // window.redrawCanvasWithVisibility(); 
            } else if (!isDrawing && !isDraggingImage && !isDraggingLabel) {
                canvas.style.cursor = isShiftPressed ? 'grab' : 'crosshair';
                // Optional: If exiting a hover, redraw to remove highlight
                // window.redrawCanvasWithVisibility();
            }
        }
        
        // Change cursor when hovering over labels or control points (this part might be redundant if covered above but acts as fallback)
        if (!isDraggingLabel && !isDraggingImage && !isDrawing && !isDraggingControlPoint) {
            const currentHover = findLabelAtPoint(x, y); // Re-check for safety, though newHoveredLabelInfo is better
            const controlPointHover = findControlPointAtPosition(x, y);
            
            if (controlPointHover) {
                if(canvas.style.cursor !== 'grab' && canvas.style.cursor !== 'grabbing') canvas.style.cursor = 'grab';
            } else if (currentHover) {
                if(canvas.style.cursor !== 'pointer' && canvas.style.cursor !== 'grabbing') canvas.style.cursor = 'pointer';
            } else {
                 if(canvas.style.cursor === 'pointer' || canvas.style.cursor === 'grab') canvas.style.cursor = isShiftPressed ? 'grab' : 'crosshair';
            }
        }
        
        // Handle control point dragging
        if (isDraggingControlPoint && draggedControlPointInfo) {
            const deltaX = e.offsetX - draggedControlPointInfo.startCanvasX;
            const deltaY = e.offsetY - draggedControlPointInfo.startCanvasY;
            
            // Convert delta to image space
            const scale = window.imageScaleByLabel[currentImageLabel] || 1;
            const deltaImageX = deltaX / scale;
            const deltaImageY = deltaY / scale;
            
            const vectorData = vectorStrokesByImage[currentImageLabel][draggedControlPointInfo.strokeLabel];
            
            if (draggedControlPointInfo.type === 'arrow' && vectorData) {
                // Handle arrow endpoint dragging
                const endpointIndex = draggedControlPointInfo.arrayIndex;
                const endpoint = vectorData.points[endpointIndex];
                
                // Update endpoint position
                endpoint.x = draggedControlPointInfo.startImageCoords.x + deltaImageX;
                endpoint.y = draggedControlPointInfo.startImageCoords.y + deltaImageY;
                
                console.log(`Updated arrow endpoint ${draggedControlPointInfo.pointIndex} to image:(${endpoint.x.toFixed(1)}, ${endpoint.y.toFixed(1)})`);
                
                // Redraw immediately to show the updated arrow
                redrawCanvasWithVisibility();
            } else if (draggedControlPointInfo.type === 'curved' && vectorData && vectorData.controlPoints) {
                // Handle curved line control point dragging
                const controlPoint = vectorData.controlPoints[draggedControlPointInfo.pointIndex];
                
                // Update image space coordinates
                controlPoint.x = draggedControlPointInfo.startImageCoords.x + deltaImageX;
                controlPoint.y = draggedControlPointInfo.startImageCoords.y + deltaImageY;
                
                // CRITICAL FIX: Update canvas space coordinates directly from current mouse position
                // Since we're dragging, the mouse position IS the correct canvas coordinate
                controlPoint.canvasX = e.offsetX;
                controlPoint.canvasY = e.offsetY;
                
                // Regenerate the curved line with updated control points
                const newSplinePoints = generateCatmullRomSpline(vectorData.controlPoints, 50);
                
                // CRITICAL FIX: Convert spline canvas coordinates to image coordinates for storage
                vectorData.points = newSplinePoints.map(splinePoint => {
                    const { x: imgX, y: imgY } = getTransformedCoords(splinePoint.x, splinePoint.y);
                    return {
                        x: imgX,  // Image coordinate
                        y: imgY,  // Image coordinate
                        time: Date.now()
                    };
                });
                
                console.log(`Updated control point ${draggedControlPointInfo.pointIndex} to image:(${controlPoint.x.toFixed(1)}, ${controlPoint.y.toFixed(1)}) canvas:(${controlPoint.canvasX.toFixed(1)}, ${controlPoint.canvasY.toFixed(1)})`);
                
                // Redraw immediately to show the updated curve
                redrawCanvasWithVisibility();
            }
            return;
        }
        
        // Handle label dragging
        if (isDraggingLabel) {
            const currentX = e.offsetX;
            const currentY = e.offsetY;

            // Calculate canvas delta from the last position
            const deltaX = currentX - dragStartX;
            const deltaY = currentY - dragStartY;
            
            // Update start position for next move event
            dragStartX = currentX;
            dragStartY = currentY;
            
            // Ensure customLabelPositions structure exists
            if (!customLabelPositions[currentImageLabel]) customLabelPositions[currentImageLabel] = {};
            
            // Get the anchor point for the dragged label's stroke (current canvas coords)
            const strokeName = draggedLabelStroke.strokeLabel; // Use the actual stroke name (string)
            const vectorData = vectorStrokesByImage[currentImageLabel]?.[strokeName];

            if (vectorData && vectorData.points.length > 0) {
                const midIndex = Math.floor(vectorData.points.length / 2);
                const midPointRelative = vectorData.points[midIndex];
                const anchorPoint = getCanvasCoords(midPointRelative.x, midPointRelative.y);

                // Get the current offset (custom or calculated) or calculate if first time dragging
                let currentOffset = customLabelPositions[currentImageLabel][strokeName] || 
                                    calculatedLabelOffsets[currentImageLabel]?.[strokeName];

                if (!currentOffset) {
                    // Calculate initial offset based on current drawn position if neither exists
                    const currentLabelRect = currentLabelPositions.find(l => l.strokeLabel === strokeName);
                    if (currentLabelRect) {
                        currentOffset = {
                            x: currentLabelRect.x - anchorPoint.x,
                            y: currentLabelRect.y - anchorPoint.y
                        };
                         console.log(`Initialized drag offset from current rect for ${strokeName}:`, currentOffset);
                    } else {
                        // Fallback if label wasn't found in current positions (shouldn't happen)
                        currentOffset = { x: 0, y: 0 }; 
                        console.warn(`Could not find current rect for ${strokeName} during drag start.`);
                    }
                } else {
                    // Clone the offset object if it came from calculatedLabelOffsets 
                    // to avoid modifying the original calculated offset
                    currentOffset = { ...currentOffset };
                }

                // Update the relative offset by the canvas delta
                // Convert canvas delta to image space delta
                const scale = window.imageScaleByLabel[currentImageLabel] || 1.0;
                const imageDeltaX = deltaX / scale;
                const imageDeltaY = deltaY / scale;

                currentOffset.x += imageDeltaX;
                currentOffset.y += imageDeltaY;
                
                // Store the updated offset in customLabelPositions (always overwrites calculated)
                customLabelPositions[currentImageLabel][strokeName] = currentOffset;
                 console.log(`Storing updated custom offset for ${strokeName}:`, currentOffset);

                // Remove canvas boundary clamping
                // pos.x = Math.max(10, Math.min(canvas.width - labelToMove.width - 10, pos.x));
                // pos.y = Math.max(10, Math.min(canvas.height - labelToMove.height - 10, pos.y));
                
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
                // For straight line, just draw a preview
                if (straightLineStart) {
                    const endPoint = { x: e.offsetX, y: e.offsetY };
                    drawStraightLinePreview(straightLineStart, endPoint);
                }
            } else if (drawingMode === 'arrow') {
                // For arrow line, draw a preview with arrowheads
                if (arrowLineStart) {
                    const endPoint = { x: e.offsetX, y: e.offsetY };
                    drawArrowLinePreview(arrowLineStart, endPoint);
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
    });
    
    canvas.addEventListener('mouseup', (e) => {
        // Check if we were drawing when mouseup occurred
        const wasDrawing = isDrawing;
        
        if (isDraggingControlPoint) {
            isDraggingControlPoint = false;
            
            // Save state to enable undo/redo
            if (draggedControlPointInfo) {
                saveState(true, false); // Save without incrementing label
                console.log(`Finished dragging control point ${draggedControlPointInfo.pointIndex} of stroke ${draggedControlPointInfo.strokeLabel}`);
            }
            
            draggedControlPointInfo = null;
            canvas.style.cursor = 'pointer';
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
            
            // Deselect all strokes when shift-drag ends
            console.log('Shift-drag canvas completed - deselecting all strokes');
            deselectAllStrokes();
            
            return;
        }
        
        if (isDrawing) {
            let strokeWasCreated = false;
            
            // For straight line, finalize the line
            if (drawingMode === 'straight' && straightLineStart) {
                const endPoint = { x: e.offsetX, y: e.offsetY };
                
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

                    // Get transformed coordinates
                    const startTransformed = getTransformedCoords(straightLineStart.x, straightLineStart.y);
                    const endTransformed = getTransformedCoords(endPoint.x, endPoint.y);

                    console.log(`Straight line from canvas (${straightLineStart.x}, ${straightLineStart.y}) -> image (${startTransformed.x}, ${startTransformed.y})`);
                    console.log(`Straight line to canvas (${endPoint.x}, ${endPoint.y}) -> image (${endTransformed.x}, ${endTransformed.y})`);

                    // Create a vector representation under the temporary key
                    vectorStrokesByImage[currentImageLabel][tempStrokeKey] = {
                        points: [
                            { x: startTransformed.x, y: startTransformed.y },
                            { x: endTransformed.x, y: endTransformed.y }
                        ],
                        color: strokeColor,
                        width: strokeWidth,
                        type: 'straight'
                    };
                    console.log(`Stored straight line data temporarily under ${tempStrokeKey}`);
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
            } else if (drawingMode === 'arrow' && arrowLineStart) {
                const endPoint = { x: e.offsetX, y: e.offsetY };
                
                // Calculate movement distance from mousedown
                const dragDistance = mouseDownPosition ? 
                    Math.sqrt(Math.pow(endPoint.x - mouseDownPosition.x, 2) + Math.pow(endPoint.y - mouseDownPosition.y, 2)) : 0;

                // Only save the arrow if user actually dragged (not just clicked)
                if (dragDistance > MINIMUM_DRAG_DISTANCE) {
                    strokeWasCreated = true;

                    // Check if end point is on another stroke
                    const endPointStrokeData = checkForStrokeAtPoint(endPoint.x, endPoint.y);

                    // Store vector data temporarily
                    const tempStrokeKey = '_drawingStroke';
                    const strokeColor = colorPicker.value;
                    const strokeWidth = parseInt(brushSize.value);

                    // Initialize if needed
                    if (!vectorStrokesByImage[currentImageLabel]) {
                        vectorStrokesByImage[currentImageLabel] = {};
                    }

                    // Get transformed coordinates
                    const startTransformed = getTransformedCoords(arrowLineStart.x, arrowLineStart.y);
                    const endTransformed = getTransformedCoords(endPoint.x, endPoint.y);

                    console.log(`Arrow line from canvas (${arrowLineStart.x}, ${arrowLineStart.y}) -> image (${startTransformed.x}, ${startTransformed.y})`);
                    console.log(`Arrow line to canvas (${endPoint.x}, ${endPoint.y}) -> image (${endTransformed.x}, ${endTransformed.y})`);

                    // Create a vector representation under the temporary key
                    vectorStrokesByImage[currentImageLabel][tempStrokeKey] = {
                        points: [
                            { x: startTransformed.x, y: startTransformed.y },
                            { x: endTransformed.x, y: endTransformed.y }
                        ],
                        color: strokeColor,
                        width: strokeWidth,
                        type: 'arrow',
                        arrowSettings: { ...arrowSettings } // Store arrow settings
                    };
                    console.log(`Stored arrow line data temporarily under ${tempStrokeKey}`);

                    // Draw the final arrow
                    drawArrowLinePreview(arrowLineStart, endPoint);

                    // If end point overlaps with another line, draw a glowing circle
                    if (endPointStrokeData) {
                        const scale = window.imageScaleByLabel[currentImageLabel] || 1.0;
                        const baseRadius = parseInt(brushSize.value) / 2;
                        const scaledRadius = baseRadius * scale;
                        const glowPadding = 5;

                        ctx.beginPath();
                        ctx.arc(endPoint.x, endPoint.y, scaledRadius + glowPadding, 0, Math.PI * 2);

                        const gradient = ctx.createRadialGradient(
                            endPoint.x, endPoint.y, scaledRadius / 2,
                            endPoint.x, endPoint.y, scaledRadius + glowPadding
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
                    
                    // Save state after arrow completion
                    saveState(true, true);
                    
                    // Update UI
                    updateStrokeVisibilityControls();
                    redrawCanvasWithVisibility();
                }

                // Reset arrow line start
                arrowLineStart = null;
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
            if (!strokeWasCreated) {
                console.log('Single click detected - calling handleDefocusClick()');
                handleDefocusClick();
            }
        }
    
        // Reset drawing state
        isDrawing = false;
        isDrawingOrPasting = false;
        strokeInProgress = false;
        mouseDownPosition = null;
    });
    
    canvas.addEventListener('mouseout', () => {
        if (isDraggingControlPoint) {
            isDraggingControlPoint = false;
            
            // Save state when leaving canvas
            if (draggedControlPointInfo) {
                saveState(true, false);
                console.log(`Control point dragging interrupted (mouse left canvas) for stroke ${draggedControlPointInfo.strokeLabel}`);
            }
            
            draggedControlPointInfo = null;
            canvas.style.cursor = 'crosshair';
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
    });
    
    // Track shift key for image movement
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Shift') {
            isShiftPressed = true;
            if (!isDrawing && !isDraggingImage) {
                canvas.style.cursor = 'grab';
            }
        }
    });
    
    document.addEventListener('keyup', (e) => {
        if (e.key === 'Shift') {
            isShiftPressed = false;
            if (!isDrawing && !isDraggingImage) {
                canvas.style.cursor = 'crosshair';
            }
        }
    });
    
    // Function to switch to a different image
    // Make switchToImage available globally
    window.switchToImage = switchToImage;
    function switchToImage(label) {
        if (currentImageLabel === label && !window.isLoadingProject) { // Allow forcing a switch during project load
            console.log(`[switchToImage] Already on ${label}, no switch needed unless loading project.`);
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
        
        console.log(`Switching from ${currentImageLabel} to ${label}`);
        
        // Save current state before switching (if not loading, during load state is managed by project-manager)
        if (!window.isLoadingProject) {
        const currentStrokes = [...(lineStrokesByImage[currentImageLabel] || [])];
        const currentState = getCanvasState();
        undoStackByImage[currentImageLabel].push({
            state: cloneImageData(currentState),
            type: 'snapshot',
            strokes: currentStrokes
        });
        }
        
        // Update current image label
        currentImageLabel = label;
        
        // Ensure we have properly initialized position and scale for this label
        if (window.imageScaleByLabel[label] === undefined) {
            console.log(`[switchToImage] No scale found for ${label}, initializing to default scale (1.0)`);
            window.imageScaleByLabel[label] = 1.0; // Default scale
        } else {
            console.log(`[switchToImage] Using scale ${window.imageScaleByLabel[label]} for ${label}`);
        }
        
        if (!imagePositionByLabel[label]) {
            console.log(`[switchToImage] No position found for ${label}, initializing to default position (0,0)`);
            imagePositionByLabel[label] = { x: 0, y: 0 }; // Default position
        } else {
            console.log(`[switchToImage] Using position (${imagePositionByLabel[label].x}, ${imagePositionByLabel[label].y}) for ${label}`);
        }
        
        // Restore state for the new image
        if (imageStates[label]) {
            // *** MODIFICATION START: Revert to simple state restoration ***
            console.log(`[switchToImage] Found existing state for ${label}, restoring directly.`);
            restoreCanvasState(imageStates[label]);
            
            // UI Updates after restoring state
            updateActiveImageInSidebar();
            updateStrokeCounter();
            updateStrokeVisibilityControls(); 
            updateScaleUI();
            // Explicit redraw AFTER restoring state and UI updates
            console.log(`[switchToImage] Explicitly calling redraw after restoring state for ${label}`);
            redrawCanvasWithVisibility();
            // *** MODIFICATION END ***

        } else if (window.originalImages[label]) {
            console.log(`No state exists for ${label}, pasting original image: ${window.originalImages[label].substring(0, 30)}...`);
            pasteImageFromUrl(window.originalImages[label], label)
                .then(() => {
                    console.log(`[switchToImage] pasteImageFromUrl COMPLETED for ${label}. Now updating UI.`);
                    // Update UI elements first
                    updateActiveImageInSidebar();
                    updateStrokeCounter();
                    updateStrokeVisibilityControls();
                    updateScaleUI(); 
                    // Explicitly redraw AFTER all UI updates and state changes triggered by them
                    console.log(`[switchToImage] Explicitly calling final redraw for ${label}`);
                    redrawCanvasWithVisibility(); 
                })
                .catch(err => {
                    console.error(`[switchToImage] Error during pasteImageFromUrl for ${label}:`, err);
                    // Fallback UI updates even on error
                    updateActiveImageInSidebar();
                    updateStrokeCounter();
                    updateStrokeVisibilityControls();
                    updateScaleUI();
                });
        } else {
            console.log(`No state or image found for ${label}, clearing canvas`);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            // UI Updates for blank canvas
        updateActiveImageInSidebar();
        updateStrokeCounter();
        updateStrokeVisibilityControls();
            updateScaleUI(); // This calls redrawCanvasWithVisibility (will draw strokes on blank)
        }
        
        // *** ADDED: Clear selection in the new/target image view ***
        if (selectedStrokeByImage[currentImageLabel] !== undefined) {
            console.log(`[switchToImage] Clearing selection for new image: ${currentImageLabel}`);
            selectedStrokeByImage[currentImageLabel] = null;
        }
        // *** END ADDED ***
    }
    
    function updateActiveImageInSidebar() {
        // Update which image is active in the sidebar
        document.querySelectorAll('.image-container').forEach(container => {
            if (container.dataset.label === currentImageLabel) {
                container.classList.add('active');
            } else {
                container.classList.remove('active');
            }
        });
    }
    
    // Handle Ctrl+Z for undo and Ctrl+Y for redo
    document.addEventListener('keydown', (e) => {
        // Handle undo (Ctrl+Z)
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !isDrawingOrPasting) {
            e.preventDefault();
            console.log('Ctrl+Z pressed, executing undo');
            
            // Make sure we have valid undo stacks
            if (!undoStackByImage[currentImageLabel]) {
                undoStackByImage[currentImageLabel] = [];
                console.log(`Created new undo stack for ${currentImageLabel}`);
            }
            
            // Make sure we have valid stroke lists
            if (!lineStrokesByImage[currentImageLabel]) {
                lineStrokesByImage[currentImageLabel] = [];
                console.log(`Created new stroke list for ${currentImageLabel}`);
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
            console.log('Ctrl+Y pressed, executing redo');
            
            // Make sure we have valid redo stacks
            if (!redoStackByImage[currentImageLabel]) {
                redoStackByImage[currentImageLabel] = [];
                console.log(`Created new redo stack for ${currentImageLabel}`);
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
    
    // Save canvas
    saveButton.addEventListener('click', () => {
        const projectName = document.getElementById('projectName').value || 'New Sofa';
        const unit = document.getElementById('unitSelector').value || 'inch';
        
        // Create filename using project name, view, and unit
        // Replace spaces with underscores
        const sanitizedName = projectName.replace(/\s+/g, '_');
        
        // Get the base label without the unique identifier for a friendlier filename
        const baseLabel = currentImageLabel.split('_')[0];
        
        const filename = `${sanitizedName}_${baseLabel}_${unit}.png`;
        
        const link = document.createElement('a');
        link.download = filename;
        link.href = canvas.toDataURL();
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
        window.labelCounters[baseLabel] = (window.labelCounters[baseLabel] || 0) + 1;
        
        // Create a unique label by appending the counter
        const uniqueLabel = `${baseLabel}_${window.labelCounters[baseLabel]}`;
        console.log(`Created unique label: ${uniqueLabel} from filename: ${filename}`);
        
        return uniqueLabel;
    }
    
    // Handle file drop
    const handleFiles = (files) => {
        console.log('[handleFiles] Processing files:', files); // Add log
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

        sortedFiles.forEach((file, index) => {
            if (file.type.indexOf('image') !== -1) {
                console.log(`[handleFiles] Processing image file: ${file.name}`); // Add log
                const url = URL.createObjectURL(file);
                const label = getLabelFromFilename(file.name); // This now generates unique labels like 'front_1', 'front_2'
                const filename = file.name.replace(/\.[^/.]+$/, "");

                if (index === 0) {
                    firstImageLabel = label; 
                }

                // Initialize structures for the new unique label
                initializeNewImageStructures(label); // Ensures all necessary states are ready

                let displayName = filename;
                if (window.getTagBasedFilename && typeof window.getTagBasedFilename === 'function') {
                    displayName = window.getTagBasedFilename(label, filename);
                }
                console.log(`[handleFiles] Adding to sidebar: URL created for ${file.name}, label=${label}, displayName=${displayName}`);
                
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
                console.log(`[handleFiles] Skipping non-image file: ${file.name}`);
            }
        });

        Promise.all(loadPromises)
            .then(() => {
                console.log('[handleFiles] All image processing promises resolved.');
                if (firstImageLabel) {
                    console.log(`[handleFiles] Switching to first image: ${firstImageLabel}`);
                    // REMOVED: currentImageLabel = firstImageLabel; 
                    switchToImage(firstImageLabel); // switchToImage will handle setting currentImageLabel
                } else {
                    console.log('[handleFiles] No first image label identified, or no image files were processed.');
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
        // Remove active class from all scale buttons
        document.querySelectorAll('.scale-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        
        // Add active class to the current scale button
        const currentScale = window.imageScaleByLabel[currentImageLabel];
        const activeButton = document.querySelector(`.scale-btn[data-scale="${currentScale}"]`);
        if (activeButton) {
            activeButton.classList.add('active');
        }
    }
    
    function updateImageScale(newScale) {
        // Update scale for current image
        const oldScale = window.imageScaleByLabel[currentImageLabel];
        console.log(`[updateImageScale] Changing scale for ${currentImageLabel} from ${oldScale} to ${newScale}`);
        
        // Store the old scale for potential restoration on error
        const previousScale = oldScale;
        
        // Update the scale in the global tracking object
        window.imageScaleByLabel[currentImageLabel] = newScale;
        
        // Update UI to reflect the new scale BEFORE redrawing
        updateScaleUI();
        
            // Save current state before redrawing
        saveState(true, false, false);
            
        // Set flag to prevent auto-focus during zoom operations
        window.isScalingOrZooming = true;
            
        // Redraw the canvas (image and/or strokes)
        try {
            redrawCanvasWithVisibility();
        } catch (error) {
            console.error('[updateImageScale] Error during redraw:', error);
            
            // Restore previous scale on error
            window.imageScaleByLabel[currentImageLabel] = previousScale;
            updateScaleUI();
        } finally {
            // Clear the flag after redraw completes
            window.isScalingOrZooming = false;
            
            // Deselect all strokes after zoom operation
            deselectAllStrokes();
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
                        
                        console.log(`Changed color of stroke ${strokeLabel} to ${color}`);
                    }
                }
                    } else if (selectedStrokeByImage[currentImageLabel]) {
            // If there's a selected stroke but not in edit mode, show a message to the user
            console.log("Double-click a stroke to enter edit mode before changing colors");
            
            // Show a status message to the user
            const statusMessage = document.getElementById('statusMessage');
            if (statusMessage) {
                statusMessage.textContent = "Double-click a stroke to enter edit mode first";
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
                    
                    console.log(`Changed thickness of stroke ${strokeLabel} to ${size}`);
                }
            }
        } else if (selectedStrokeByImage[currentImageLabel]) {
            // If there's a selected stroke but not in edit mode, show a message to the user
            console.log("Double-click a stroke to enter edit mode before changing thickness");
            
            // Show a status message to the user
            const statusMessage = document.getElementById('statusMessage');
            if (statusMessage) {
                statusMessage.textContent = "Double-click a stroke to enter edit mode first";
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
        
        console.log(`[moveImage] Moving image ${currentImageLabel} by (${deltaX}, ${deltaY})`);
        console.log(`[moveImage] Position was (${oldPos.x}, ${oldPos.y}), now is (${imagePositionByLabel[currentImageLabel].x}, ${imagePositionByLabel[currentImageLabel].y})`);
        
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
        
        // Zoom controls (work during curved line creation too)
        if (e.key === 'q' || e.key === 'Q') {
            // Zoom out - find the next smaller scale
            const currentScale = window.imageScaleByLabel[currentImageLabel];
            const scales = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
            let nextScale = 0.1; // Minimum scale
            
            for (let i = scales.length - 1; i >= 0; i--) {
                if (scales[i] < currentScale) {
                    nextScale = scales[i];
                    break;
                }
            }
            
            // When in curved line creation mode, preserve control points after zoom
            const isCurvedLineInProgress = drawingMode === 'curved' && curvedLinePoints.length > 0;
            console.log(`[Zoom Out] Current mode: ${drawingMode}, points: ${curvedLinePoints.length}, in progress: ${isCurvedLineInProgress}`);
            
            updateImageScale(nextScale);
            
            // Deselect all strokes when zooming
            deselectAllStrokes();
            
            // After zoom, the control points are automatically preserved since they're stored in image coordinates
            if (isCurvedLineInProgress) {
                console.log('[Zoom Out] Curved line creation in progress - control points preserved during zoom');
            }
            // UI is now updated by updateImageScale
        } else if (e.key === 'e' || e.key === 'E') {
            // Zoom in - find the next larger scale
            const currentScale = window.imageScaleByLabel[currentImageLabel];
            const scales = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
            let nextScale = 2; // Maximum scale
            
            for (let i = 0; i < scales.length; i++) {
                if (scales[i] > currentScale) {
                    nextScale = scales[i];
                    break;
                }
            }
            
            // When in curved line creation mode, preserve control points after zoom
            const isCurvedLineInProgress = drawingMode === 'curved' && curvedLinePoints.length > 0;
            console.log(`[Zoom In] Current mode: ${drawingMode}, points: ${curvedLinePoints.length}, in progress: ${isCurvedLineInProgress}`);
            
            updateImageScale(nextScale);
            
            // Deselect all strokes when zooming
            deselectAllStrokes();
            
            // After zoom, the control points are automatically preserved since they're stored in image coordinates
            if (isCurvedLineInProgress) {
                console.log('[Zoom In] Curved line creation in progress - control points preserved during zoom');
            }
            // UI is now updated by updateImageScale
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
            scaleButton.textContent = `Scale: ${Math.round(scale * 100)}% ▼`;
        }
        
        // ADDED: Update the sidebar thumbnail scale display for the current image
        const sidebarScaleElement = document.getElementById(`scale-${currentImageLabel}`);
        if (sidebarScaleElement) {
            sidebarScaleElement.textContent = `Scale: ${Math.round(scale * 100)}%`;
            console.log(`[updateScaleUI] Updated sidebar scale display for ${currentImageLabel} to ${Math.round(scale * 100)}%`);
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
            element.style.top = (element.offsetTop - pos2) + "px";
            element.style.left = (element.offsetLeft - pos1) + "px";
            
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
    
    // Make both sidebars draggable
    makeDraggable(strokeSidebar, strokeSidebarHeader);
    makeDraggable(imageSidebar, imageSidebarHeader);
    
    // DRAG AND DROP SETUP - MODIFIED TO USE DOCUMENT LISTENERS
    function setupDragAndDrop() {
        const docBody = document.body; // Target body or document for broader event capture

        docBody.addEventListener('dragover', (e) => {
            // Check if the target is the canvas or related to our app area
            if (e.target === canvas || canvas.contains(e.target)) {
                e.preventDefault();
                e.stopPropagation();
                canvas.classList.add('drag-over');
                 console.log('[Drag and Drop] dragover event on canvas target.');
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
                console.log('[Drag and Drop] dragleave event.');
            }
        });

        docBody.addEventListener('drop', (e) => {
            if (e.target === canvas || canvas.contains(e.target)) {
                e.preventDefault();
                e.stopPropagation();
                canvas.classList.remove('drag-over');
                console.log('[Drag and Drop] drop event on canvas target.');
                
                const files = e.dataTransfer.files;
                if (files && files.length > 0) {
                    console.log(`[Drag and Drop] ${files.length} files dropped.`);
                    handleFiles(files);
                } else {
                    console.log('[Drag and Drop] No files found in drop event.');
                }
            } else {
                 console.log('[Drag and Drop] drop event on non-canvas target, ignoring.');
            }
        });
        console.log('[setupDragAndDrop] Drag and drop listeners initialized on document body, targeting canvas.');
    }

    // Call setupDragAndDrop on DOMContentLoaded
    setupDragAndDrop();
    
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
        const MAX_DISTANCE = 150; // Maximum distance from anchor point
        const MIN_DISTANCE = 30;  // Minimum distance from anchor point

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
        
        // Normalize distance penalty (0-0.4) - further means bigger penalty
        const distancePenalty = Math.min(0.4, (distance / 300) * 0.4);
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
    
    // Function to draw a connector line between the label and the stroke
    function drawLabelConnector(labelRect, anchorPoint, strokeColor) {
        // Don't use the provided anchorPoint - we'll find the best one based on the stroke
        // Just keep it as a fallback if we can't find the stroke info
        const originalAnchorPoint = anchorPoint;
        
        // Find the closest point on the label to connect to
        const labelCenter = {
            x: labelRect.x + labelRect.width / 2,
            y: labelRect.y + labelRect.height / 2
        };
        
        // Determine the exit point from the label using 9-point anchoring
        // Define all 9 possible anchor points on the label
        const anchorPoints = [
            // Top row
            { x: labelRect.x, y: labelRect.y }, // Top-left
            { x: labelCenter.x, y: labelRect.y }, // Top-center
            { x: labelRect.x + labelRect.width, y: labelRect.y }, // Top-right
            
            // Middle row
            { x: labelRect.x, y: labelCenter.y }, // Middle-left
            { x: labelCenter.x, y: labelCenter.y }, // Center
            { x: labelRect.x + labelRect.width, y: labelCenter.y }, // Middle-right
            
            // Bottom row
            { x: labelRect.x, y: labelRect.y + labelRect.height }, // Bottom-left
            { x: labelCenter.x, y: labelRect.y + labelRect.height }, // Bottom-center
            { x: labelRect.x + labelRect.width, y: labelRect.y + labelRect.height } // Bottom-right
        ];
        
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
            console.log(`[drawLabelConnector] PathInfo for ${strokeLabel}:`, 
                        JSON.stringify({
                            length: strokePathInfo.path.length,
                            first: strokePathInfo.path[0],
                            last: strokePathInfo.path[strokePathInfo.path.length - 1]
                        }));
            
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
                
                console.log(`[drawLabelConnector] Using calculated midpoint for straight line: (${middlePoint.x}, ${middlePoint.y})`);
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
                
                console.log(`[drawLabelConnector] Using true geometric midpoint for freehand: (${middlePoint.x.toFixed(1)}, ${middlePoint.y.toFixed(1)})`);
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
            
            console.log(`[drawLabelConnector] Distances for ${strokeLabel} - Start: ${distToStart.toFixed(2)}, Middle: ${distToMiddle.toFixed(2)}, End: ${distToEnd.toFixed(2)}`);
            
            // Find the closest point
            let closestPoint = middlePoint;
            let minDist = distToMiddle;
            let anchorType = "middle";
            
            if (distToStart < minDist) {
                closestPoint = startPoint;
                minDist = distToStart;
                anchorType = "start";
            }
            
            if (distToEnd < minDist) {
                closestPoint = endPoint;
                anchorType = "end";
            }
            
            console.log(`[drawLabelConnector] Using ${anchorType} anchor for ${strokeLabel} at: (${closestPoint.x}, ${closestPoint.y})`);
            
            // Use the closest point instead of the original anchor
            anchorPoint = closestPoint;
        } else {
            console.log(`[drawLabelConnector] No path info found for ${strokeLabel}, using original anchor: (${originalAnchorPoint.x}, ${originalAnchorPoint.y})`);
            // Use the original point since we don't have path info
            anchorPoint = originalAnchorPoint;
        }
        
        // Draw the connecting line
        ctx.beginPath();
        ctx.moveTo(exitPoint.x, exitPoint.y);
        ctx.lineTo(anchorPoint.x, anchorPoint.y);
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]); // Dotted line
        ctx.stroke();
        ctx.setLineDash([]); // Reset to solid line
        
        // If we're using a midpoint anchor, draw a small circle to indicate the connection point
        if (strokePathInfo && strokePathInfo.path && strokePathInfo.path.length > 1) {
            const startPoint = strokePathInfo.path[0];
            const endPoint = strokePathInfo.path[strokePathInfo.path.length - 1];
            
            // Determine which point is being used as anchor
            let anchorType = "unknown";
            if (Math.abs(anchorPoint.x - startPoint.x) < 0.01 && Math.abs(anchorPoint.y - startPoint.y) < 0.01) {
                anchorType = "start";
            } else if (Math.abs(anchorPoint.x - endPoint.x) < 0.01 && Math.abs(anchorPoint.y - endPoint.y) < 0.01) {
                anchorType = "end";
            } else {
                anchorType = "middle";
            }
            
            console.log(`[drawLabelConnector] Anchor type: ${anchorType} for ${strokeLabel}`);
            
            // For midpoints, draw a more prominent indicator
            if (anchorType === "middle") {
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
        // Only check for selected strokes in edit mode
        if (!window.selectedStrokeInEditMode) return null;
        
        const vectorData = vectorStrokesByImage[currentImageLabel]?.[window.selectedStrokeInEditMode];
        if (!vectorData) return null;
        
        // Check for curved line control points
        if (vectorData.type === 'curved' && vectorData.controlPoints) {
            return findCurvedControlPoint(x, y, vectorData);
        }
        
        // Check for arrow endpoints
        if (vectorData.type === 'arrow' && vectorData.points && vectorData.points.length >= 2) {
            return findArrowEndpoint(x, y, vectorData);
        }
        
        return null;
    }

    // Helper function to find curved line control points
    function findCurvedControlPoint(x, y, vectorData) {
        
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
        
        // Check each control point
        for (let i = 0; i < vectorData.controlPoints.length; i++) {
            const controlPoint = vectorData.controlPoints[i];
            let transformedX, transformedY;
            
            if (isBlankCanvas) {
                const canvasCenter = { x: canvas.width / 2, y: canvas.height / 2 };
                const position = imagePositionByLabel[currentImageLabel] || { x: 0, y: 0 };
                const scaledX = (controlPoint.x - canvasCenter.x) * scale + canvasCenter.x;
                const scaledY = (controlPoint.y - canvasCenter.y) * scale + canvasCenter.y;
                transformedX = scaledX + position.x;
                transformedY = scaledY + position.y;
            } else {
                transformedX = imageX + (controlPoint.x * scale);
                transformedY = imageY + (controlPoint.y * scale);
            }
            
            // Check if click is within control point radius
            const pointRadius = 6 * scale; // Use the larger radius for selected control points
            const distance = Math.sqrt((x - transformedX) ** 2 + (y - transformedY) ** 2);
            
            if (distance <= pointRadius + 5) { // Add 5px padding for easier selection
                return {
                    strokeLabel: window.selectedStrokeInEditMode,
                    pointIndex: i,
                    canvasX: transformedX,
                    canvasY: transformedY,
                    type: 'curved'
                };
            }
        }
        
        return null;
    }

    // Helper function to find arrow endpoints
    function findArrowEndpoint(x, y, vectorData) {
        
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
        
        // Check arrow start and end points
        const startPoint = vectorData.points[0];
        const endPoint = vectorData.points[vectorData.points.length - 1];
        const endpoints = [startPoint, endPoint];
        
        for (let i = 0; i < endpoints.length; i++) {
            const point = endpoints[i];
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
    console.log('[DOMContentLoaded] Checking initial window.strokeMeasurements:', window.strokeMeasurements);
    
    // THIS IS THE FIX: Instead of creating a new variable, we're just referencing the window object
    // There was a previous change to set strokeMeasurements = window.strokeMeasurements
    // But it seems that code was not applied correctly
    
    // CHECK: Log the current values to verify they're equal
    console.log('[DOMContentLoaded] Current window.strokeMeasurements keys:', 
        Object.keys(window.strokeMeasurements));
    
    // Ensure all IMAGE_LABELS have an entry in strokeMeasurements
    IMAGE_LABELS.forEach(label => {
        if (!window.strokeMeasurements[label]) {
            window.strokeMeasurements[label] = {};
            console.log(`[DOMContentLoaded] Initialized empty measurements for ${label}`);
        } else {
            console.log(`[DOMContentLoaded] Found existing measurements for ${label}:`, 
                JSON.stringify(window.strokeMeasurements[label]));
        }
    });

    // Handle paste from clipboard
    document.addEventListener('paste', (e) => {
        console.log('[Paste Handler] Paste event triggered on document.'); // Log trigger
        const items = e.clipboardData.items;
        let imageFoundAndProcessed = false; // Flag to track if any image was processed in this event

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.type.indexOf('image') !== -1) {
                console.log(`[Paste Handler] Image item found at index ${i}. Type: ${item.type}`);
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
                window.labelCounters[baseLabelForPasted] = (window.labelCounters[baseLabelForPasted] || 0) + 1;
                const newImageLabel = `${baseLabelForPasted}_paste_${window.labelCounters[baseLabelForPasted]}`;
                
                console.log(`[Paste Handler] Assigned new unique label: ${newImageLabel}`);
                
                // Initialize all necessary structures for this new image
                initializeNewImageStructures(newImageLabel);

                let displayName = `Pasted ${baseLabelForPasted}`;
                if (window.getTagBasedFilename && typeof window.getTagBasedFilename === 'function') {
                    displayName = window.getTagBasedFilename(newImageLabel, displayName);
                }
                console.log(`[Paste Handler] Display name for ${newImageLabel}: ${displayName}`);
                
                addImageToSidebar(url, newImageLabel, displayName);
                
                if (!pastedImages.includes(url)) pastedImages.push(url);
                window.originalImages[newImageLabel] = url;
                
                // pasteImageFromUrl will handle setting imageStates, undoStack, etc.
                // and also drawing the image.
                // It's important to switch to the newly pasted image if we want it to be active.
                // However, if pasting multiple, we might only want to switch to the first one.
                // For now, let's switch to each as it's processed.
                pasteImageFromUrl(url, newImageLabel).then(() => {
                    console.log(`[Paste Handler] Successfully processed and displayed pasted image: ${newImageLabel}`);
                    currentImageLabel = newImageLabel; 
                    switchToImage(newImageLabel); // This will also update UI elements
                }).catch(err => {
                    console.error(`[Paste Handler] Error in pasteImageFromUrl for ${newImageLabel}:`, err);
                });
                
                imageFoundAndProcessed = true;
                // REMOVED THE BREAK STATEMENT TO ALLOW MULTIPLE IMAGE PASTING
            }
        }

        if (!imageFoundAndProcessed) {
            console.log('[Paste Handler] No image data found in clipboard items or failed to process.');
        }
    });

    // Initialize new image structures for default labels
    IMAGE_LABELS.forEach(label => {
        initializeNewImageStructures(label);
    });

    // Initialize new image structures
    function initializeNewImageStructures(label) {
        // THIS FUNCTION NEEDS TO BE ROBUST
        console.log(`[initializeNewImageStructures] Initializing for new label: ${label}`);
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
        if (!window.calculatedLabelOffsets) window.calculatedLabelOffsets = {}; // Ensure this is initialized

        window.imageScaleByLabel[label] = 1.0;
        window.imagePositionByLabel[label] = { x: 0, y: 0 };
        window.lineStrokesByImage[label] = [];
        window.vectorStrokesByImage[label] = {};
        window.strokeVisibilityByImage[label] = {};
        window.strokeLabelVisibility[label] = {};
        window.labelsByImage[label] = 'A1'; // Default initial stroke label for a new image
        window.undoStackByImage[label] = [];
        window.redoStackByImage[label] = [];
        window.imageStates[label] = null;
        window.originalImageDimensions[label] = { width: 0, height: 0 };
        window.customLabelPositions[label] = {}; // Initialize for the new label
        window.calculatedLabelOffsets[label] = {}; // Initialize for the new label

        // Initialize with default tags, robustly checking for TAG_MODEL
        const baseViewType = label.split('_')[0]; // e.g., 'front' from 'front_1' or 'front' itself
        let defaultViewTagId = 'front'; // Fallback default view type ID

        if (window.TAG_MODEL && window.TAG_MODEL.viewType && window.TAG_MODEL.viewType.options && Array.isArray(window.TAG_MODEL.viewType.options)) {
            const foundOption = window.TAG_MODEL.viewType.options.find(opt => opt.id === baseViewType || (opt.name && opt.name.toLowerCase() === baseViewType));
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
        console.log(`[initializeNewImageStructures] Initialized tags for ${label}:`, JSON.stringify(window.imageTags[label]));
    }

    // *** NEW FUNCTION: Parse and save measurement string ***
    function parseAndSaveMeasurement(strokeLabel, newString) {
        console.log(`[parseAndSaveMeasurement] For ${strokeLabel}, received: \"${newString}\". Unit selector value: ${document.getElementById('unitSelector').value}`);
        let successfullyParsedAndSaved = false; // Flag to indicate if an update happened

        if (!newString && newString !== "0") { // Allow "0" to clear/reset measurement
            console.warn("[parseAndSaveMeasurement] Empty string received (and not '0'), attempting to clear measurement.");
            if (window.strokeMeasurements[currentImageLabel] && window.strokeMeasurements[currentImageLabel][strokeLabel]) {
                // Clear the specific measurement
                delete window.strokeMeasurements[currentImageLabel][strokeLabel]; 
                // Or reset to default if preferred:
                // window.strokeMeasurements[currentImageLabel][strokeLabel] = { inchWhole: 0, inchFraction: 0, cm: 0.0 };
                successfullyParsedAndSaved = true;
                console.log(`[parseAndSaveMeasurement] Cleared measurement for ${strokeLabel}.`);
            } else {
                console.log(`[parseAndSaveMeasurement] No existing measurement to clear for ${strokeLabel}.`);
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
                    console.log(`[parseAndSaveMeasurement] Parsed as CM: ${totalCm}cm -> ${totalInches} inches. Explicit unit: ${explicitUnitMatched}`);
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
                    console.log(`[parseAndSaveMeasurement] Parsed as Meters: ${meterMatch[1]}m -> ${totalInches} inches`);
                } else if (mmMatch && mmMatch[1]) {
                    totalInches = parseFloat(mmMatch[1]) / 25.4;
                    explicitUnitMatched = true;
                    console.log(`[parseAndSaveMeasurement] Parsed as Millimeters: ${mmMatch[1]}mm -> ${totalInches} inches`);
                } else if (feetMatch && feetMatch[1]) {
                    totalInches = parseFloat(feetMatch[1]) * 12;
                    explicitUnitMatched = true;
                    console.log(`[parseAndSaveMeasurement] Parsed as Feet: ${feetMatch[1]}${feetMatch[2]} -> ${totalInches} inches`);
                } else if (yardMatch && yardMatch[1]) {
                    totalInches = parseFloat(yardMatch[1]) * 36;
                    explicitUnitMatched = true;
                    console.log(`[parseAndSaveMeasurement] Parsed as Yards: ${yardMatch[1]}${yardMatch[2]} -> ${totalInches} inches`);
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
                        console.log(`[parseAndSaveMeasurement] Parsed as Inches (with marker): ${newString} -> ${totalInches}\"`);
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
                        console.log(`[parseAndSaveMeasurement] Parsed as plain number (inches): ${totalInches}\"`);
                    } else { // cm
                        totalCm = plainNumber;
                        totalInches = totalCm / 2.54;
                        console.log(`[parseAndSaveMeasurement] Parsed as plain number (cm): ${totalCm}cm -> ${totalInches} inches`);
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
            const inchFractionDecimal = totalInches - inchWhole;
            const inchFraction = findClosestFraction(inchFractionDecimal);
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
            console.log(`[parseAndSaveMeasurement] Updated measurement for ${strokeLabel}:`, 
                JSON.stringify(window.strokeMeasurements[currentImageLabel][strokeLabel]));
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
        console.log(`Entering edit mode for stroke: ${strokeLabel}`);
        
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
        
        // Get current scale and position for coordinate transforms (MATCH checkForStrokeAtPoint exactly)
        const scale = window.imageScaleByLabel[currentImageLabel] || 1;
        
        // Calculate image position for coordinate transforms
        let imageWidth = canvas.width;
        let imageHeight = canvas.height;
        let imageX, imageY;
        
        // Try to get original image dimensions if available (MATCH checkForStrokeAtPoint exactly)
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
        
        let nearestPoint = null;
        let minDistance = Number.MAX_VALUE;
        
        // Check each segment of the stroke
        for (let i = 0; i < vectorData.points.length; i++) {
            const point = vectorData.points[i];
            
            // Transform point to canvas coordinates
            const pointCanvasX = imageX + (point.x * scale);
            const pointCanvasY = imageY + (point.y * scale);
            
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
                const prevCanvasX = imageX + (prevPoint.x * scale);
                const prevCanvasY = imageY + (prevPoint.y * scale);
                
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
                        // Convert back to image space
                        const projImageX = (projCanvasX - imageX) / scale;
                        const projImageY = (projCanvasY - imageY) / scale;
                        nearestPoint = {
                            x: projImageX,
                            y: projImageY,
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
    canvas.addEventListener('dblclick', (e) => {
        e.preventDefault(); // Prevent default double-click behavior
        
        if (drawingMode === 'curved' && curvedLinePoints.length >= 2) {
            console.log(`Finalizing curve with ${curvedLinePoints.length} control points`);
            
            // Check if the double-click is on another stroke for snapping
            const strokeAtPoint = checkForStrokeAtPoint(e.offsetX, e.offsetY);
            let finalControlPoints = [...curvedLinePoints];
            
            if (strokeAtPoint) {
                console.log(`Double-click detected on stroke ${strokeAtPoint.label}, attempting to snap curve endpoint`);
                console.log(`Double-click coordinates: (${e.offsetX}, ${e.offsetY})`);
                
                // Find the nearest point on the target stroke
                const nearestPoint = findNearestPointOnStroke(e.offsetX, e.offsetY, strokeAtPoint.label);
                
                if (nearestPoint) {
                    console.log(`Nearest point found: distance ${nearestPoint.distance.toFixed(2)}px, imageSpace: (${nearestPoint.x.toFixed(2)}, ${nearestPoint.y.toFixed(2)}), canvasSpace: (${nearestPoint.canvasX.toFixed(2)}, ${nearestPoint.canvasY.toFixed(2)})`);
                    
                    if (nearestPoint.distance <= 20) { // 20 pixel snap tolerance
                        console.log(`✅ Snapping curve endpoint to stroke ${strokeAtPoint.label} at distance ${nearestPoint.distance.toFixed(2)}px`);
                        
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
                        console.log(`❌ Stroke detected but too far for snapping (distance: ${nearestPoint.distance.toFixed(2)}px > 20px tolerance)`);
                    }
                } else {
                    console.log(`❌ Could not find nearest point on stroke ${strokeAtPoint.label}`);
                }
            }
            
            // Generate spline points using Catmull-Rom algorithm with final control points
            const splinePoints = generateCatmullRomSpline(finalControlPoints, 50);
            
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
            
            console.log(`Generated ${finalPoints.length} interpolated points for smooth curve`);
            
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
                timestamp: Date.now()
            };
            
            // Clear the control points for next curve
            curvedLinePoints = [];
            console.log('Cleared control points for next curve');
            
            // Mark that a curve was just completed (needs one defocus click)
            curveJustCompleted = true;
            console.log('Set curveJustCompleted flag - next single click will defocus');
            
            // Save the completed curved stroke
            saveState(true, true);
            
            // Update UI and clear any preview state
            updateStrokeVisibilityControls();
            redrawCanvasWithVisibility();
            
            console.log('Curved line finalized and saved');
        } else if (drawingMode === 'curved') {
            console.log('Double-click in curved mode, but need at least 2 control points to create a curve');
        }
    });
}); // Correctly close DOMContentLoaded