// Define core application structure for better state management
window.paintApp = {
    config: {
        IMAGE_LABELS: ['front', 'side', 'back', 'cushion'],
        MAX_HISTORY: 50,  // Maximum number of states to store
        ANCHOR_SIZE: 4,
        CLICK_AREA: 10,
        clickDelay: 300, // Milliseconds to wait for double-click
        defaultScale: 1.0,
        defaultPosition: { x: 0, y: 0 },
        INCHES_TO_CM: 2.54, // Conversion factor from inches to centimeters
        DEFAULT_LABEL_START: 'A1', // Starting label for strokes
        FRACTION_VALUES: [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875] // Common fractions for inch display
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
        originalImageDimensions: {}, // Added missing originalImageDimensions
        imageTags: {},
        isLoadingProject: false,
        isDefocusingOperationInProgress: false,
        folderStructure: {
            "root": {
                id: "root",
                name: "Root",
                type: "folder",
                parentId: null,
                children: []
            }
        },
        selectedStrokeByImage: {},
        multipleSelectedStrokesByImage: {},
        labelCounters: {
            front: 0,
            side: 0,
            back: 0,
            cushion: 0
        },
        customLabelPositions: {},
        calculatedLabelOffsets: {},
        selectedStrokeInEditMode: null,
        lastClickTime: 0,
        lastCanvasClickTime: 0,
        orderedImageLabels: []
    },
    uiState: {
        // Control point dragging
        isDraggingControlPoint: false,
        draggedControlPointInfo: null, // { strokeLabel, pointIndex, startPos }
        // Image drag and drop
        draggedImageItem: null,
        // Keyboard state
        isShiftPressed: false
    }
};

// Maintain backward compatibility by keeping global references
// These will be gradually migrated to use the paintApp structure
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
window.originalImageDimensions = window.paintApp.state.originalImageDimensions; // Backward compatibility
window.imageTags = window.paintApp.state.imageTags;
window.isLoadingProject = window.paintApp.state.isLoadingProject;
window.isDefocusingOperationInProgress = window.paintApp.state.isDefocusingOperationInProgress;
window.folderStructure = window.paintApp.state.folderStructure;
window.selectedStrokeByImage = window.paintApp.state.selectedStrokeByImage;
window.multipleSelectedStrokesByImage = window.paintApp.state.multipleSelectedStrokesByImage;
window.labelCounters = window.paintApp.state.labelCounters;

// Control point dragging variables (to be migrated)
let isDraggingControlPoint = window.paintApp.uiState.isDraggingControlPoint;
let draggedControlPointInfo = window.paintApp.uiState.draggedControlPointInfo;

// Additional backward compatibility references
window.customLabelPositions = window.paintApp.state.customLabelPositions;
window.calculatedLabelOffsets = window.paintApp.state.calculatedLabelOffsets;
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
    arrowSize: 15,
    arrowStyle: 'triangular' // Options: 'triangular', 'filled', 'curved'
};

window.paintApp.uiState.draggingAnchor = false;
window.paintApp.uiState.dragCurveStroke = null; // The stroke being modified
window.paintApp.uiState.dragAnchorIndex = -1;   // Which control point is being dragged

// Backward compatibility references
let arrowSettings = window.paintApp.uiState.arrowSettings;
let draggingAnchor = window.paintApp.uiState.draggingAnchor;
let dragCurveStroke = window.paintApp.uiState.dragCurveStroke;
let dragAnchorIndex = window.paintApp.uiState.dragAnchorIndex;
const ANCHOR_SIZE = window.paintApp.config.ANCHOR_SIZE;
const CLICK_AREA = window.paintApp.config.CLICK_AREA;

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
        labelsByImage[label] = 'A1';  // Start from A1 instead of A0
        undoStackByImage[label] = [];
        redoStackByImage[label] = [];  // Initialize redo stack
        imageStates[label] = null;
        // Initialize scale to 100% (1.0)
        window.imageScaleByLabel[label] = 1.0;
        window.paintApp.state.originalImageDimensions[label] = { width: 0, height: 0 };
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

    // Make addImageToSidebar available globally for the project manager
    window.addImageToSidebar = addImageToSidebar;
    function addImageToSidebar(imageUrl, label, filename) {
        // *** ADDED LOG ***
        console.log(`[addImageToSidebar] Called for label: ${label}, imageUrl: ${imageUrl ? imageUrl.substring(0,30) + '...' : 'null'}`);

        const container = document.createElement('div');
        container.className = 'image-container';
        container.dataset.label = label;
        container.dataset.originalImageUrl = imageUrl; // Store the original image URL for later restoration
        container.draggable = true; // Enable drag-and-drop
        
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
        
        // Create delete button
        const deleteButton = document.createElement('button');
        deleteButton.className = 'delete-image-btn';
        deleteButton.innerHTML = '×';
        deleteButton.title = 'Delete image';
        deleteButton.style.cssText = `
            position: absolute;
            top: 5px;
            right: 5px;
            cursor: pointer;
            background: rgba(255, 255, 255, 0.9);
            border: 1px solid #ccc;
            border-radius: 50%;
            width: 20px;
            height: 20px;
            font-size: 14px;
            font-weight: bold;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10;
            color: #666;
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
        deleteButton.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent container click (switchToImage)
            
            const confirmMsg = `Are you sure you want to delete image "${label}" and all its associated strokes and data? This action cannot be undone directly through the undo stack for image deletion.`;
            if (!confirm(confirmMsg)) {
                return;
            }
            
            // Perform deletion
            deleteImage(label, container);
        });
        
        // Add all elements to container
        container.appendChild(img);
        container.appendChild(labelElement);
        container.appendChild(tagsContainer); // Add tags container
        container.appendChild(strokesElement);
        container.appendChild(scaleElement);
        container.appendChild(editTagsButton); // Add edit tags button
        container.appendChild(deleteButton); // Add delete button
        
        // Set up click handler for switching images
        container.onclick = () => {
            // Store current state before switching
            saveState();
            
            // Switch to the new image
            switchToImage(label);
        };
        
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
            
            // Update the ordered image labels array after reordering
            updateOrderedImageLabelsArray();
        });
        
        // Finally add to the sidebar
        document.getElementById('imageList').appendChild(container);
        console.log(`[addImageToSidebar] Successfully appended container for ${label}. #imageList children: ${document.getElementById('imageList').children.length}`);
        
        // Update the ordered image labels array
        updateOrderedImageLabelsArray();
        
        // Update the stroke count
        updateSidebarStrokeCounts();
    }
    
    // Function to delete an image and clean up all associated data
    function deleteImage(label, container) {
        console.log(`[deleteImage] Deleting image: ${label}`);
        
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
        delete window.imageTags[label];
        delete window.customLabelPositions[label];
        delete window.calculatedLabelOffsets[label];
        delete window.selectedStrokeByImage[label];
        delete window.multipleSelectedStrokesByImage[label];
        
        // Remove from pastedImages array if present
        const originalImageUrl = container.dataset.originalImageUrl;
        if (originalImageUrl) {
            pastedImages = pastedImages.filter(url => url !== originalImageUrl);
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
        
        console.log(`[deleteImage] Successfully deleted image: ${label}`);
    }
    
    // Function to update the ordered image labels array based on current DOM order
    function updateOrderedImageLabelsArray() {
        const imageListEl = document.getElementById('imageList');
        if (imageListEl) {
            window.orderedImageLabels = Array.from(imageListEl.children)
                .map(container => container.dataset.label)
                .filter(label => label); // Ensure only valid labels are included
            console.log('[paint.js] Updated orderedImageLabels:', JSON.stringify(window.orderedImageLabels));
        }
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
        const strokeCount = window.paintApp.state.lineStrokesByImage[window.paintApp.state.currentImageLabel]?.length || 0;
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
                
            const shouldAutoFocus = isNewlyCreated || (!window.isDefocusingOperationInProgress && isSelected && !window.isScalingOrZooming && !window.isMovingImage && !hasActiveMeasurementFocus);

            console.log(`[createEditableMeasureText] Focus logic for ${strokeLabel}: isNewlyCreated=${isNewlyCreated}, isSelected=${isSelected}, isScalingOrZooming=${!!window.isScalingOrZooming}, isMovingImage=${!!window.isMovingImage}, hasActiveMeasurementFocus=${hasActiveMeasurementFocus}, isDefocusingOperationInProgress=${!!window.isDefocusingOperationInProgress}, shouldAutoFocus=${shouldAutoFocus}`);

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
    
// Define core application structure for better state management
window.paintApp = {
    config: {
        IMAGE_LABELS: ['front', 'side', 'back', 'cushion'],
        MAX_HISTORY: 50,  // Maximum number of states to store
        ANCHOR_SIZE: 4,
        CLICK_AREA: 10,
        clickDelay: 300, // Milliseconds to wait for double-click
        defaultScale: 1.0,
        defaultPosition: { x: 0, y: 0 },
        INCHES_TO_CM: 2.54, // Conversion factor from inches to centimeters
        DEFAULT_LABEL_START: 'A1', // Starting label for strokes
        FRACTION_VALUES: [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875] // Common fractions for inch display
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
        originalImageDimensions: {}, // Added missing originalImageDimensions
        imageTags: {},
        isLoadingProject: false,
        isDefocusingOperationInProgress: false,
        folderStructure: {
            "root": {
                id: "root",
                name: "Root",
                type: "folder",
                parentId: null,
                children: []
            }
        },
        selectedStrokeByImage: {},
        multipleSelectedStrokesByImage: {},
        labelCounters: {
            front: 0,
            side: 0,
            back: 0,
            cushion: 0
        },
        customLabelPositions: {},
        calculatedLabelOffsets: {},
        selectedStrokeInEditMode: null,
        lastClickTime: 0,
        lastCanvasClickTime: 0,
        orderedImageLabels: []
    },
    uiState: {
        // Control point dragging
        isDraggingControlPoint: false,
        draggedControlPointInfo: null, // { strokeLabel, pointIndex, startPos }
        // Image drag and drop
        draggedImageItem: null,
        // Keyboard state
        isShiftPressed: false
    }
};

// Maintain backward compatibility by keeping global references
// These will be gradually migrated to use the paintApp structure
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
window.originalImageDimensions = window.paintApp.state.originalImageDimensions; // Backward compatibility
window.imageTags = window.paintApp.state.imageTags;
window.isLoadingProject = window.paintApp.state.isLoadingProject;
window.isDefocusingOperationInProgress = window.paintApp.state.isDefocusingOperationInProgress;
window.folderStructure = window.paintApp.state.folderStructure;
window.selectedStrokeByImage = window.paintApp.state.selectedStrokeByImage;
window.multipleSelectedStrokesByImage = window.paintApp.state.multipleSelectedStrokesByImage;
window.labelCounters = window.paintApp.state.labelCounters;

// Control point dragging variables (to be migrated)
let isDraggingControlPoint = window.paintApp.uiState.isDraggingControlPoint;
let draggedControlPointInfo = window.paintApp.uiState.draggedControlPointInfo;

// Additional backward compatibility references
window.customLabelPositions = window.paintApp.state.customLabelPositions;
window.calculatedLabelOffsets = window.paintApp.state.calculatedLabelOffsets;
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
    arrowSize: 15,
    arrowStyle: 'triangular' // Options: 'triangular', 'filled', 'curved'
};

window.paintApp.uiState.draggingAnchor = false;
window.paintApp.uiState.dragCurveStroke = null; // The stroke being modified
window.paintApp.uiState.dragAnchorIndex = -1;   // Which control point is being dragged

// Backward compatibility references
let arrowSettings = window.paintApp.uiState.arrowSettings;
let draggingAnchor = window.paintApp.uiState.draggingAnchor;
let dragCurveStroke = window.paintApp.uiState.dragCurveStroke;
let dragAnchorIndex = window.paintApp.uiState.dragAnchorIndex;
const ANCHOR_SIZE = window.paintApp.config.ANCHOR_SIZE;
const CLICK_AREA = window.paintApp.config.CLICK_AREA;

