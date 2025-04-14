// Define global variables for use by project-manager.js
window.IMAGE_LABELS = ['front', 'side', 'back', 'cushion'];
window.currentImageLabel = 'front';
window.vectorStrokesByImage = {};
window.strokeVisibilityByImage = {};
window.strokeLabelVisibility = {};
window.strokeMeasurements = {};
window.imageScaleByLabel = {};
window.imagePositionByLabel = {};
window.lineStrokesByImage = {};
window.labelsByImage = {};
window.originalImages = {};

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
    const ctx = canvas.getContext('2d');
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
    let lineStrokesByImage = {}; // Track strokes for each image
    let strokeVisibilityByImage = {}; // Track visibility of each stroke
    let strokeDataByImage = {}; // Store additional data for each stroke
    let labelsByImage = {}; // Track current label for each image
    let undoStackByImage = {}; // Separate undo stack for each image
    let redoStackByImage = {}; // Separate redo stack for each image
    let pastedImages = [];  // Store all pasted images
    let isDrawingOrPasting = false;  // Flag to prevent saving states while drawing
    let strokeInProgress = false;  // Track if we're in the middle of a stroke
    let currentStroke = null;  // Store the state before current stroke
    let imageScaleByLabel = {}; // Track scale factor for each image (default 1.0 = 100%)
    let originalImageDimensions = {}; // Store original image dimensions for scaling
    let imagePositionByLabel = {}; // Track position offset for each image
    let isShiftPressed = false; // Track if Shift key is pressed for image movement

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
        imageScaleByLabel[label] = 1.0;
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
    function addImageToSidebar(imageUrl, label) {
        const container = document.createElement('div');
        container.className = 'image-container';
        container.dataset.label = label;
        container.dataset.originalImageUrl = imageUrl; // Store the original image URL for later restoration
        
        const labelElement = document.createElement('div');
        labelElement.className = 'image-label';
        labelElement.textContent = label.charAt(0).toUpperCase() + label.slice(1);
        
        const strokesElement = document.createElement('div');
        strokesElement.className = 'image-strokes';
        strokesElement.textContent = 'Strokes: 0';
        
        const scaleElement = document.createElement('div');
        scaleElement.className = 'image-scale';
        scaleElement.textContent = `Scale: ${Math.round(imageScaleByLabel[label] * 100)}%`;
        scaleElement.id = `scale-${label}`;
        
        const img = document.createElement('img');
        img.src = imageUrl;
        img.className = 'pasted-image';
        img.alt = `${label} view`;
        
        container.appendChild(img);
        container.appendChild(labelElement);
        container.appendChild(strokesElement);
        container.appendChild(scaleElement);
        
        container.onclick = () => {
            // Don't do anything if already on this view
            if (currentImageLabel === label) {
                return;
            }
            
            console.log(`Switching from ${currentImageLabel} to ${label}`);
            
            // Ensure we have undo stacks for both workspaces
            undoStackByImage[currentImageLabel] = undoStackByImage[currentImageLabel] || [];
            undoStackByImage[label] = undoStackByImage[label] || [];
            
            // Ensure we have redo stacks for both workspaces
            redoStackByImage[currentImageLabel] = redoStackByImage[currentImageLabel] || [];
            redoStackByImage[label] = redoStackByImage[label] || [];
            
            // Ensure we have stroke lists for both workspaces
            lineStrokesByImage[currentImageLabel] = lineStrokesByImage[currentImageLabel] || [];
            lineStrokesByImage[label] = lineStrokesByImage[label] || [];
            
            // Ensure we have stroke visibility for both workspaces
            strokeVisibilityByImage[currentImageLabel] = strokeVisibilityByImage[currentImageLabel] || {};
            strokeVisibilityByImage[label] = strokeVisibilityByImage[label] || {};
            
            // Save current state before switching
            saveState(true, false);
            
            // Switch to the new image
            switchToImage(label);
        };
        
        imageList.appendChild(container);
    }
    

    // Store the original images for each view
    window.originalImages = window.originalImages || {};
    
    function pasteImageFromUrl(url) {
        console.log(`Pasting image for ${currentImageLabel}: ${url.substring(0, 30)}...`);
        
        const img = new Image();
        img.onload = () => {
            // Store the original image for this view
            window.originalImages[currentImageLabel] = url;
            
            // Store original dimensions for scaling
            originalImageDimensions[currentImageLabel] = {
                width: img.width,
                height: img.height
            };
            
            // Clear the canvas first
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            // Apply current scale factor
            const scale = imageScaleByLabel[currentImageLabel];
            const scaledWidth = img.width * scale;
            const scaledHeight = img.height * scale;
            
            // Calculate base position (center of the canvas)
            const centerX = (canvas.width - scaledWidth) / 2;
            const centerY = (canvas.height - scaledHeight) / 2;
            
            // Apply position offset
            const offsetX = imagePositionByLabel[currentImageLabel].x;
            const offsetY = imagePositionByLabel[currentImageLabel].y;
            
            // Calculate final position
            const x = centerX + offsetX;
            const y = centerY + offsetY;
            
            // Draw the image with scaling and positioning
            ctx.drawImage(img, x, y, scaledWidth, scaledHeight);
            console.log(`Image drawn for ${currentImageLabel} at scale ${scale * 100}%`);
            
            // Update the scale display in the sidebar
            const scaleElement = document.getElementById(`scale-${currentImageLabel}`);
            if (scaleElement) {
                scaleElement.textContent = `Scale: ${Math.round(scale * 100)}%`;
            }
            
            // Save this as the base state for this image
            const newState = getCanvasState();
            imageStates[currentImageLabel] = cloneImageData(newState);
            currentStroke = cloneImageData(newState);
            
            // Initialize the undo stack
            undoStackByImage[currentImageLabel] = [{
                state: cloneImageData(newState),
                type: 'initial',
                label: null
            }];
            
            // Update the scale buttons to show active state
            updateScaleButtonsActiveState();
            
            console.log(`State saved for ${currentImageLabel}`);
            console.log(`Current image states: ${Object.keys(imageStates).join(', ')}`);
            console.log(`Current original images: ${Object.keys(window.originalImages).join(', ')}`);
        };
        img.src = url;
    }

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
    
    // Measurement data for strokes
    let strokeMeasurements = {};
    
    // Initialize measurement data store
    IMAGE_LABELS.forEach(label => {
        strokeMeasurements[label] = {};
    });
    
    // Function to get formatted measurement string
    function getMeasurementString(strokeLabel) {
        const measurement = strokeMeasurements[currentImageLabel]?.[strokeLabel];
        if (!measurement) return '';
        
        const unit = document.getElementById('unitSelector').value;
        
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
            
            return `${whole}${fractionStr}"`;
        } else {
            // CM with one decimal
            return `${measurement.cm.toFixed(1)} cm`;
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
        const unit = document.getElementById('unitSelector').value;
        const inchWhole = document.getElementById('inchWhole');
        const inchFraction = document.getElementById('inchFraction');
        const cmValue = document.getElementById('cmValue');
        
        // Convert values when switching between units
        if (unit === 'inch') {
            // Converting from cm to inches
            const cm = parseFloat(cmValue.value) || 0;
            const inches = cm / 2.54;
            
            // Update inch values
            inchWhole.value = Math.floor(inches);
            
            // Find closest fraction
            const fractionPart = inches - Math.floor(inches);
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
                if (parseFloat(f.value) === fractionPart) {
                    option.selected = true;
                }
                inchFraction.appendChild(option);
            });
            
            // Show inch inputs, hide cm inputs
            document.getElementById('inchInputs').style.display = 'flex';
            document.getElementById('cmInputs').style.display = 'none';
        } else {
            // Converting from inches to cm
            const whole = parseInt(inchWhole.value) || 0;
            const fraction = parseFloat(inchFraction.value) || 0;
            const totalInches = whole + fraction;
            
            // Update cm value with one decimal point
            cmValue.value = (totalInches * 2.54).toFixed(1);
            
            // Show cm inputs, hide inch inputs
            document.getElementById('inchInputs').style.display = 'none';
            document.getElementById('cmInputs').style.display = 'flex';
        }
        
        // Update the stroke visibility display to show new units
        updateStrokeVisibilityControls();
        
        // Redraw the canvas with updated measurement format in labels
        redrawCanvasWithVisibility();
    }

    // Function to update stroke visibility controls
    // Make updateStrokeVisibilityControls available globally
    window.updateStrokeVisibilityControls = updateStrokeVisibilityControls;
    function updateStrokeVisibilityControls() {
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
        
        if (strokes.length === 0) {
            strokesList.innerHTML = '<p>No strokes to display</p>';
            return;
        }
        
        // Current unit
        const unit = document.getElementById('unitSelector').value;
        
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
            if (strokeMeasurements[currentImageLabel] === undefined) {
                strokeMeasurements[currentImageLabel] = {};
            }
            if (strokeMeasurements[currentImageLabel][strokeLabel] === undefined) {
                strokeMeasurements[currentImageLabel][strokeLabel] = {
                    inchWhole: 0,
                    inchFraction: 0,
                    cm: 0.0
                };
            }
            
            const isVisible = strokeVisibilityByImage[currentImageLabel][strokeLabel];
            const isLabelVisible = strokeLabelVisibility[currentImageLabel][strokeLabel];
            const measurement = getMeasurementString(strokeLabel);
            const isSelected = selectedStrokeByImage[currentImageLabel] === strokeLabel;
            
            const item = document.createElement('div');
            item.className = 'stroke-visibility-item';
            item.dataset.stroke = strokeLabel;
            item.dataset.selected = isSelected ? 'true' : 'false';
            
            // Make all parts of the item selectable (except checkbox and buttons)
            item.addEventListener('click', (e) => {
                // Don't trigger selection if clicking a button or checkbox
                if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') {
                    return;
                }
                
                // Toggle selection (if already selected, deselect it)
                const isCurrentlySelected = selectedStrokeByImage[currentImageLabel] === strokeLabel;
                
                // Clear previous selection from UI
                document.querySelectorAll('.stroke-visibility-item').forEach(el => {
                    el.dataset.selected = 'false';
                });
                
                if (isCurrentlySelected) {
                    // Deselect if already selected
                    selectedStrokeByImage[currentImageLabel] = null;
                    item.dataset.selected = 'false';
                } else {
                    // Select if not already selected
                    selectedStrokeByImage[currentImageLabel] = strokeLabel;
                    item.dataset.selected = 'true';
                
                // Update the measurement input with the selected stroke's measurement
                    if (typeof updateMeasurementInputWithStroke === 'function') {
                    updateMeasurementInputWithStroke(strokeLabel);
                }
                }
                
                // Make sure stroke is visible when selected
                if (selectedStrokeByImage[currentImageLabel] === strokeLabel) {
                    // Ensure the stroke is visible when selected
                    strokeVisibilityByImage[currentImageLabel][strokeLabel] = true;
                    checkbox.checked = true;
                }
                
                // Redraw the canvas to show the selected stroke with glow effect
                redrawCanvasWithVisibility();
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
            
            // Add a small icon to indicate stroke type (optional)
            if (strokeType === 'straight') {
                strokeName.title = 'Straight Line';
            } else {
                strokeName.title = 'Freehand Stroke';
            }
            
            // Make stroke name label clickable for selection as well
            strokeName.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent double handling with the item click
                
                // Toggle selection 
                const isCurrentlySelected = selectedStrokeByImage[currentImageLabel] === strokeLabel;
                
                // Clear previous selection from UI
                document.querySelectorAll('.stroke-visibility-item').forEach(el => {
                    el.dataset.selected = 'false';
                });
                
                if (isCurrentlySelected) {
                    // Deselect if already selected
                    selectedStrokeByImage[currentImageLabel] = null;
                    item.dataset.selected = 'false';
                } else {
                    // Select if not already selected
                    selectedStrokeByImage[currentImageLabel] = strokeLabel;
                    item.dataset.selected = 'true';
                }
                
                // Make sure stroke is visible when selected
                if (selectedStrokeByImage[currentImageLabel] === strokeLabel) {
                    // Ensure the stroke is visible when selected
                    strokeVisibilityByImage[currentImageLabel][strokeLabel] = true;
                    checkbox.checked = true;
                }
                
                // Redraw the canvas to show the selected stroke with glow effect
                redrawCanvasWithVisibility();
            });
            
            // Create measurement text
            const measureText = document.createElement('span');
            measureText.className = 'stroke-measurement';
            measureText.textContent = measurement ? `= ${measurement}` : '';
            
            // Create edit button
            const editBtn = document.createElement('button');
            editBtn.className = 'stroke-edit-btn';
            editBtn.innerHTML = '✏️';
            editBtn.title = 'Edit Stroke';
            editBtn.onclick = (e) => {
                e.stopPropagation(); // Prevent triggering the item's click event
                showEditDialog(strokeLabel);
            };
            
            // Create label toggle button
            const labelToggleBtn = document.createElement('button');
            labelToggleBtn.className = 'stroke-label-toggle';
            labelToggleBtn.classList.toggle('active', isLabelVisible);
            labelToggleBtn.innerHTML = isLabelVisible ? '👁️' : '👁️‍🗨️';
            labelToggleBtn.title = isLabelVisible ? 'Hide Label on Canvas' : 'Show Label on Canvas';
            labelToggleBtn.onclick = (e) => {
                e.stopPropagation(); // Prevent triggering the item's click event
                toggleLabelVisibility(strokeLabel);
            };
            
            // Add elements to container
            labelContainer.appendChild(strokeName);
            labelContainer.appendChild(measureText);
            labelContainer.appendChild(labelToggleBtn);
            labelContainer.appendChild(editBtn);
            
            // Build the complete item
            item.appendChild(checkbox);
            item.appendChild(labelContainer);
            
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
            toggleBtn.innerHTML = isLabelVisible ? '👁️' : '👁️‍🗨️';
            toggleBtn.title = isLabelVisible ? 'Hide Label on Canvas' : 'Show Label on Canvas';
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
        
        // Get current measurement
        const measurement = strokeMeasurements[currentImageLabel][strokeLabel] || {
            inchWhole: 0,
            inchFraction: 0,
            cm: 0.0
        };
        
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
            if (strokeMeasurements[currentImageLabel] === undefined) {
                strokeMeasurements[currentImageLabel] = {};
            }
            
            strokeMeasurements[currentImageLabel][strokeLabel] = {
                inchWhole: finalInchWhole,
                inchFraction: finalInchFraction,
                cm: finalCmValue
            };
            
            // Close dialog
            document.body.removeChild(overlay);
            
            // Update the UI
            updateStrokeVisibilityControls();
            
            // Redraw with the new measurement
            redrawCanvasWithVisibility();
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
    
    // Function to show edit dialog for a stroke
    function showEditDialog(strokeLabel) {
        // Create a modal overlay
        const overlay = document.createElement('div');
        overlay.className = 'measurement-overlay';
        document.body.appendChild(overlay);
        
        // Create a modal dialog
        const dialog = document.createElement('div');
        dialog.className = 'measurement-dialog';
        
        // Get current measurements
        const measurement = strokeMeasurements[currentImageLabel][strokeLabel] || {
            inchWhole: 0,
            inchFraction: 0,
            cm: 0.0
        };
        
        // Title
        const title = document.createElement('h3');
        title.textContent = `Edit Stroke ${strokeLabel}`;
        dialog.appendChild(title);
        
        // Create name edit field
        const nameContainer = document.createElement('div');
        nameContainer.className = 'name-container';
        
        const nameLabel = document.createElement('div');
        nameLabel.textContent = 'Label:';
        nameContainer.appendChild(nameLabel);
        
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.value = strokeLabel;
        nameInput.placeholder = 'Label';
        nameContainer.appendChild(nameInput);
        
        dialog.appendChild(nameContainer);
        
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
            const newName = nameInput.value.trim();
            const wholeValue = parseInt(wholeInput.value) || 0;
            const fractionValue = parseFloat(fractionSelect.value) || 0;
            const cmValue = parseFloat(cmInput.value) || 0;
            
            // Update name if changed
            let finalName = strokeLabel;
            if (newName !== strokeLabel && newName !== '') {
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
            
            // Always save both units
            strokeMeasurements[currentImageLabel][finalName] = {
                inchWhole: wholeValue,
                inchFraction: fractionValue,
                cm: cmValue
            };
            
            // Close dialog
            document.body.removeChild(overlay);
            
            // Update UI
            updateStrokeVisibilityControls();
            
            // Redraw to show updated measurements
            redrawCanvasWithVisibility();
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
    };         
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
        console.log(`  Image available: ${!!window.originalImages[currentImageLabel]}`);
        const strokesForLog = vectorStrokesByImage[currentImageLabel] || {}; // Use a different name for logging clarity
        console.log(`  Strokes available: ${Object.keys(strokesForLog).length}`);
        
        // Reset label positions and stroke paths for this redraw
        currentLabelPositions = [];
        currentStrokePaths = [];
        
        // Create a copy of custom label positions for tracking which ones were actually used
        const usedCustomPositions = {};
        
        // We need to rebuild the canvas from scratch using individual stroke data
        const strokes = lineStrokesByImage[currentImageLabel] || [];
        
        // Start with a blank canvas or the original image if available
        if (window.originalImages && window.originalImages[currentImageLabel]) {
            // Check if we already have this image in the cache
            const imageUrl = window.originalImages[currentImageLabel];
            
            if (imageCache[imageUrl]) {
                // Use cached image immediately
                drawImageAndStrokes(imageCache[imageUrl]);
            } else {
                // Load the image and cache it
                const img = new Image();
                img.onload = () => {
                    // Add to cache
                    imageCache[imageUrl] = img;
                    drawImageAndStrokes(img);
                };
                img.src = imageUrl;
                
                // If the image is already cached in the browser, it might be immediately available
                if (img.complete) {
                    imageCache[imageUrl] = img;
                    drawImageAndStrokes(img);
                } else {
                    // If the image isn't immediately available,
                    // still draw the strokes on a blank canvas so they don't disappear
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    
                    // Use default scale (1) and center position when no image is available yet
                    const canvasCenterX = canvas.width / 2;
                    const canvasCenterY = canvas.height / 2;
                    applyVisibleStrokes(1, canvasCenterX, canvasCenterY);
                }
            }
        } else {
            // Otherwise start with a blank canvas
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            // Use default scale (1) and center position when no image
            const canvasCenterX = canvas.width / 2;
            const canvasCenterY = canvas.height / 2;
            applyVisibleStrokes(1, canvasCenterX, canvasCenterY);
        }
        
        function drawImageAndStrokes(img) {
            // Clear only once
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            // Apply scale
            const scale = imageScaleByLabel[currentImageLabel];
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
            
            // Draw the image with scaling and positioning
            ctx.drawImage(img, x, y, scaledWidth, scaledHeight);
            
            // Then apply visible strokes
            applyVisibleStrokes(scale, x, y);
        }
        
        function applyVisibleStrokes(scale, imageX, imageY) {
            // Apply each visible stroke using vector data if available
            const strokes = vectorStrokesByImage[currentImageLabel] || {};
            const strokeOrder = lineStrokesByImage[currentImageLabel] || [];
            const visibility = strokeVisibilityByImage[currentImageLabel] || {};
            
            // Retrieve the correct stroke data for the current image
            strokeOrder.forEach(strokeLabel => {
                const isVisible = visibility[strokeLabel];
                if (!isVisible) return; // Skip invisible strokes
                
                const isSelected = selectedStrokeByImage[currentImageLabel] === strokeLabel;
                
                // Check if we have vector data for this stroke
                if (strokes[strokeLabel]) {
                    
                    // Get the vector data for this stroke
                    const vectorData = strokes[strokeLabel];
                    const strokeColor = vectorData.color || "#000000";
                    const strokeWidth = vectorData.width || 5;
                    
                    // Draw using vector points
                    if (vectorData.points && vectorData.points.length > 0) {
                        // If the stroke is selected, draw a glowing effect first
                        if (isSelected) {
                            ctx.beginPath();
                            
                            // Transform the first point
                            const firstPoint = vectorData.points[0];
                            const transformedFirstX = imageX + (firstPoint.x * scale);
                            const transformedFirstY = imageY + (firstPoint.y * scale);
                            
                            ctx.moveTo(transformedFirstX, transformedFirstY);
                            
                            // Check if this is a straight line
                            const isStraightLine = vectorData.type === 'straight' || 
                                (vectorData.points.length === 2 && !vectorData.type);
                            
                            if (isStraightLine && vectorData.points.length >= 2) {
                                // For straight lines, just draw a line from first to last point
                                const lastPoint = vectorData.points[vectorData.points.length - 1];
                                const transformedLastX = imageX + (lastPoint.x * scale);
                                const transformedLastY = imageY + (lastPoint.y * scale);
                                
                                // Draw stroke with proper width
                                ctx.lineTo(transformedLastX, transformedLastY);
                            } else {
                                // For freehand drawing, draw straight lines between all points
                                // This avoids any curve calculation issues
                                for (let i = 1; i < vectorData.points.length; i++) {
                                    const point = vectorData.points[i];
                                    // Transform the point coordinates based on image scale and position
                                    const transformedX = imageX + (point.x * scale);
                                    const transformedY = imageY + (point.y * scale);
                                    
                                    ctx.lineTo(transformedX, transformedY);
                                }
                            }
                            
                            // Draw the glow effect
                            ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';  // White glow
                            ctx.lineWidth = (strokeWidth + 6) * scale;  // Wider than the main stroke
                            ctx.lineCap = 'round';
                            ctx.lineJoin = 'round';
                            ctx.stroke();
                            
                            // Add a colored glow closer to the stroke
                            ctx.beginPath();
                            
                            // Redraw the same path
                            ctx.moveTo(transformedFirstX, transformedFirstY);
                            
                            if (isStraightLine && vectorData.points.length >= 2) {
                                // For straight lines, just draw a line from first to last point
                                const lastPoint = vectorData.points[vectorData.points.length - 1];
                                const transformedLastX = imageX + (lastPoint.x * scale);
                                const transformedLastY = imageY + (lastPoint.y * scale);
                                
                                // Draw stroke with proper width
                                ctx.lineTo(transformedLastX, transformedLastY);
                            } else {
                                // For freehand drawing, draw straight lines between all points
                                for (let i = 1; i < vectorData.points.length; i++) {
                                    const point = vectorData.points[i];
                                    const transformedX = imageX + (point.x * scale);
                                    const transformedY = imageY + (point.y * scale);
                                    
                                    ctx.lineTo(transformedX, transformedY);
                                }
                            }
                            
                            // Create a color glow based on the stroke color
                            const rgbMatch = strokeColor.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
                            let glowColor = strokeColor;
                            if (rgbMatch) {
                                const r = parseInt(rgbMatch[1], 16);
                                const g = parseInt(rgbMatch[2], 16);
                                const b = parseInt(rgbMatch[3], 16);
                                glowColor = `rgba(${r}, ${g}, ${b}, 0.5)`;
                            }
                            
                            ctx.strokeStyle = glowColor;
                            ctx.lineWidth = (strokeWidth + 3) * scale;  // Slightly wider than the main stroke
                            ctx.stroke();
                        }
                        
                        // Draw the main stroke
                        ctx.beginPath();
                        
                        // Transform the first point
                        const firstPoint = vectorData.points[0];
                        const transformedFirstX = imageX + (firstPoint.x * scale);
                        const transformedFirstY = imageY + (firstPoint.y * scale);
                        
                        ctx.moveTo(transformedFirstX, transformedFirstY);
                        
                        // Store stroke path for label placement
                        const strokePath = [];
                        strokePath.push({x: transformedFirstX, y: transformedFirstY});
                        
                        // Check if this is a straight line (just 2 points) or it has 'type: straight'
                        const isStraightLine = vectorData.type === 'straight' || 
                            (vectorData.points.length === 2 && !vectorData.type);
                        
                        if (isStraightLine && vectorData.points.length >= 2) {
                            // For straight lines, just draw a line from first to last point
                            const lastPoint = vectorData.points[vectorData.points.length - 1];
                            const transformedLastX = imageX + (lastPoint.x * scale);
                            const transformedLastY = imageY + (lastPoint.y * scale);
                            
                            // Draw stroke with proper width
                            ctx.lineTo(transformedLastX, transformedLastY);
                            
                            // Update stroke path for label placement
                            strokePath.push({x: transformedLastX, y: transformedLastY});
                        } else {
                            // Draw straight lines through the rest of the points for freehand drawing
                            // We're deliberately not using curves to maintain consistency with the draw function
                            for (let i = 1; i < vectorData.points.length; i++) {
                                const point = vectorData.points[i];
                                // Transform the point coordinates based on image scale and position
                                const transformedX = imageX + (point.x * scale);
                                const transformedY = imageY + (point.y * scale);
                                
                                // Draw a straight line to this point
                                ctx.lineTo(transformedX, transformedY);
                                
                                // Record the point for label placement
                                strokePath.push({x: transformedX, y: transformedY});
                            }
                        }
                        
                        // Store the path for this stroke (for label positioning)
                        currentStrokePaths.push({
                            label: strokeLabel,
                            path: strokePath,
                            width: strokeWidth * scale,
                            color: strokeColor
                        });
                        
                        // Set stroke style
                        ctx.strokeStyle = strokeColor;
                        ctx.lineWidth = strokeWidth * scale; // Scale line width
                        ctx.lineCap = 'round';
                        ctx.lineJoin = 'round';
                        ctx.stroke();
                        
                        // Draw a dot for a single point
                        if (vectorData.points.length === 1) {
                            // Draw glow for selected dot
                            if (isSelected) {
                                ctx.beginPath();
                                ctx.arc(transformedFirstX, transformedFirstY, ((strokeWidth/2) + 3) * scale, 0, Math.PI * 2);
                                ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
                                ctx.fill();
                                
                                // Create a color glow based on the stroke color
                                const rgbMatch = strokeColor.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
                                let glowColor = strokeColor;
                                if (rgbMatch) {
                                    const r = parseInt(rgbMatch[1], 16);
                                    const g = parseInt(rgbMatch[2], 16);
                                    const b = parseInt(rgbMatch[3], 16);
                                    glowColor = `rgba(${r}, ${g}, ${b}, 0.5)`;
                                }
                                
                                ctx.beginPath();
                                ctx.arc(transformedFirstX, transformedFirstY, ((strokeWidth/2) + 1.5) * scale, 0, Math.PI * 2);
                                ctx.fillStyle = glowColor;
                                ctx.fill();
                                
                                // If it's a straight line, also draw glow around the end point
                                if (isStraightLine && vectorData.points.length >= 2) {
                                    const lastPoint = vectorData.points[vectorData.points.length - 1];
                                    const transformedLastX = imageX + (lastPoint.x * scale);
                                    const transformedLastY = imageY + (lastPoint.y * scale);
                                    
                                    ctx.beginPath();
                                    ctx.arc(transformedLastX, transformedLastY, ((strokeWidth/2) + 3) * scale, 0, Math.PI * 2);
                                    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
                                    ctx.fill();
                                    
                                    ctx.beginPath();
                                    ctx.arc(transformedLastX, transformedLastY, ((strokeWidth/2) + 1.5) * scale, 0, Math.PI * 2);
                                    ctx.fillStyle = glowColor;
                                    ctx.fill();
                                }
                            }
                            
                            // Draw the main dot
                            ctx.beginPath();
                            ctx.arc(transformedFirstX, transformedFirstY, (strokeWidth/2) * scale, 0, Math.PI * 2);
                            ctx.fillStyle = strokeColor;
                            ctx.fill();
                        }
                        
                        // Draw label near the stroke if enabled
                        if (strokeLabelVisibility[currentImageLabel][strokeLabel]) {
                            // Find a good position for the label that's near the stroke
                            const strokeInfo = currentStrokePaths.find(p => p.label === strokeLabel);
                            
                            if (!strokeInfo || !strokeInfo.path.length) {
                                return; // Skip if we can't find the path
                            }
                            
                            // Find the best point to place the label (prefer middle of the stroke)
                            let bestPoint;
                            if (strokeInfo.path.length >= 3) {
                                // Use a point near the middle of the path for longer strokes
                                const middleIndex = Math.floor(strokeInfo.path.length / 2);
                                bestPoint = strokeInfo.path[middleIndex];
                            } else {
                                // Use the first point for shorter strokes, with a small offset
                                bestPoint = {
                                    x: strokeInfo.path[0].x + 5,
                                    y: strokeInfo.path[0].y - 5
                                };
                            }
                            
                            // Create label text and measure it
                            const measurement = getMeasurementString(strokeLabel);
                            const labelText = `${strokeLabel}${measurement ? ` = ${measurement}` : ''}`;
                            
                            // Set a larger font size (200% larger)
                            const fontSize = 24; // Original was 12px
                            ctx.font = `${fontSize}px Arial`;
                            
                            // Measure text for background
                            const textWidth = ctx.measureText(labelText).width;
                            const textHeight = fontSize * 1.2; // Approximate text height
                            
                            // Determine initial position (offset slightly from the best point)
                            const padding = 4;
                            const initialX = bestPoint.x + 10;  // Initial offset
                            const initialY = bestPoint.y - 15;  // Initial offset
                            
                            // Create initial label rectangle
                            const labelRect = {
                                x: initialX,
                                y: initialY - textHeight,
                                width: textWidth + (padding * 2),
                                height: textHeight + (padding * 2),
                                strokeLabel: strokeLabel
                            };
                            
                            // Check if there's a custom position for this label
                            let finalLabelRect;
                            if (customLabelPositions[currentImageLabel] && 
                                customLabelPositions[currentImageLabel][strokeLabel]) {
                                // Use custom position while respecting canvas boundaries
                                const customPos = customLabelPositions[currentImageLabel][strokeLabel];
                                finalLabelRect = {
                                    ...labelRect,
                                    x: Math.max(10, Math.min(canvas.width - labelRect.width - 10, customPos.x)),
                                    y: Math.max(10, Math.min(canvas.height - labelRect.height - 10, customPos.y))
                                };
                                
                                // Mark this custom position as used
                                usedCustomPositions[strokeLabel] = true;
                            } else {
                                // Check for direct overlaps with existing labels
                                let overlappingLabels = [];
                                let overlapWithLines = false;
                                
                                // Initial position
                                const initialRect = {
                                    ...labelRect,
                                    x: Math.max(10, Math.min(canvas.width - labelRect.width - 10, initialX)),
                                    y: Math.max(10, Math.min(canvas.height - labelRect.height - 10, initialY - textHeight))
                                };
                                
                                // Check for overlaps with existing labels
                                for (const existingLabel of currentLabelPositions) {
                                    if (rectsOverlap(initialRect, existingLabel)) {
                                        overlappingLabels.push(existingLabel);
                                    }
                                }
                                
                                // Check for overlaps with stroke lines
                                for (const path of currentStrokePaths) {
                                    if (path.label !== strokeLabel) { // Don't check against our own path
                                        for (let i = 1; i < path.path.length; i++) {
                                            const p1 = path.path[i-1];
                                            const p2 = path.path[i];
                                            if (rectIntersectsLine(initialRect, p1, p2, path.width)) {
                                                overlapWithLines = true;
                                                break;
                                            }
                                        }
                                    }
                                    if (overlapWithLines) break;
                                }
                                
                                // Determine if we need to find a new position
                                if (overlappingLabels.length > 0 || overlapWithLines) {
                                    // Find a position that doesn't overlap
                                    finalLabelRect = findOptimalLabelPosition(labelRect, bestPoint, strokeInfo);
                                } else {
                                    // Use the initial position if no overlaps
                                    finalLabelRect = initialRect;
                                }
                            }
                            
                            // Add important information to the label rect for interaction
                            finalLabelRect.strokeLabel = strokeLabel;
                            finalLabelRect.strokeInfo = strokeInfo;
                            finalLabelRect.anchorPoint = bestPoint;
                            
                            // Draw background with glow for selected stroke
                            ctx.fillStyle = isSelected ? 'rgba(255, 255, 200, 0.9)' : 'white';
                            ctx.fillRect(finalLabelRect.x, finalLabelRect.y, finalLabelRect.width, finalLabelRect.height);
                            
                            // Draw border in stroke color with different style for selected
                            ctx.strokeStyle = strokeColor;
                            ctx.lineWidth = isSelected ? 2 : 1;
                            ctx.strokeRect(finalLabelRect.x, finalLabelRect.y, finalLabelRect.width, finalLabelRect.height);
                            
                            // Draw text in stroke color
                            ctx.fillStyle = strokeColor;
                            ctx.fillText(labelText, finalLabelRect.x + padding, finalLabelRect.y + textHeight);
                            
                            // Draw a connection line from the label to the stroke
                            drawLabelConnector(finalLabelRect, bestPoint, strokeColor);
                            
                            // Store the label position to avoid overlaps
                            currentLabelPositions.push(finalLabelRect);
                        }
                    }
                } 
                // Fallback to pixel data if vector data is not available
                else if (strokeDataByImage[currentImageLabel] && 
                         strokeDataByImage[currentImageLabel][strokeLabel]) {
                    // This is legacy code for strokes created before the vector system
                    const strokeData = strokeDataByImage[currentImageLabel][strokeLabel];
                    
                    if (strokeData.preState && strokeData.postState) {
                        // Get the difference between pre and post states
                        const preData = strokeData.preState.data;
                        const postData = strokeData.postState.data;
                        
                        // Draw over the current state
                        for (let i = 0; i < preData.length; i += 4) {
                            // If the pixel changed between pre and post states, apply it
                            if (preData[i] !== postData[i] || 
                                preData[i + 1] !== postData[i + 1] || 
                                preData[i + 2] !== postData[i + 2] || 
                                preData[i + 3] !== postData[i + 3] &&
                                postData[i + 3] > 0) { // Only if it has alpha
                                
                                // Calculate position for this pixel
                                const pixelX = i % (canvas.width * 4) / 4;
                                const pixelY = Math.floor(i / (canvas.width * 4));
                                
                                // Draw the pixel directly
                                if (postData[i + 3] > 0) { // Only if visible
                                    ctx.fillStyle = `rgba(${postData[i]}, ${postData[i+1]}, ${postData[i+2]}, ${postData[i+3]/255})`;
                                    ctx.fillRect(pixelX, pixelY, 1, 1);
                                }
                            }
                        }
                    }
                }
            });
            
            // Save the now-combined state
            const newState = getCanvasState();
            imageStates[currentImageLabel] = cloneImageData(newState);
        }
    }

    function cloneImageData(imageData) {
        return new ImageData(
            new Uint8ClampedArray(imageData.data),
            imageData.width,
            imageData.height
        );
    }

    function saveState(force = false, incrementLabel = true) {
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
        if (!isDrawingOrPasting && !strokeInProgress && incrementLabel) {
            strokeLabel = labelsByImage[currentImageLabel];
            
            // Always increment the label after a successful stroke
            labelsByImage[currentImageLabel] = getNextLabel(currentImageLabel);
            
            // Only add to strokes list if it's not already there
            if (!lineStrokesByImage[currentImageLabel].includes(strokeLabel)) {
            lineStrokesByImage[currentImageLabel].push(strokeLabel);
            }
            
            // Initialize visibility for this stroke (default to visible)
            strokeVisibilityByImage[currentImageLabel] = strokeVisibilityByImage[currentImageLabel] || {};
            strokeVisibilityByImage[currentImageLabel][strokeLabel] = true;
            
            // Initialize label visibility for the stroke (default to visible)
            strokeLabelVisibility[currentImageLabel] = strokeLabelVisibility[currentImageLabel] || {};
            strokeLabelVisibility[currentImageLabel][strokeLabel] = true;
            
            // Initialize data for this stroke
            strokeDataByImage[currentImageLabel] = strokeDataByImage[currentImageLabel] || {};
            strokeDataByImage[currentImageLabel][strokeLabel] = {
                preState: currentStroke ? cloneImageData(currentStroke) : null,
                postState: cloneImageData(currentState)
            };
        }

        // Save new state and add to undo stack
        imageStates[currentImageLabel] = cloneImageData(currentState);
        
        // Determine the type of stroke
        let strokeType = 'other';
        if (force && strokeLabel) {
            strokeType = 'stroke';
            
            // Check for vector data to determine if it's a freehand or straight line
            if (vectorStrokesByImage[currentImageLabel] && 
                vectorStrokesByImage[currentImageLabel][strokeLabel]) {
                const vectorData = vectorStrokesByImage[currentImageLabel][strokeLabel];
                if (vectorData.type === 'straight') {
                    strokeType = 'line';
                } else if (vectorData.type === 'freehand') {
                    strokeType = 'stroke';
                }
            }
        }
        
        // Add to undo stack with stroke info
        const undoAction = {
            state: cloneImageData(currentState),
            type: strokeType,
            label: strokeLabel,
            color: colorPicker.value, // Store the current color
            width: parseInt(brushSize.value) // Store the current brush width
        };
        
        // Store vector data with the undo action if available
        if (strokeLabel && vectorStrokesByImage[currentImageLabel] && 
            vectorStrokesByImage[currentImageLabel][strokeLabel]) {
            undoAction.vectorData = JSON.parse(JSON.stringify(vectorStrokesByImage[currentImageLabel][strokeLabel]));
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
            
            if (lastAction.type === 'line' || lastAction.type === 'stroke') {
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
            
            // Ensure we have a valid previous state
            if (previousState && previousState.state) {
                // Restore the canvas state
                const stateToRestore = cloneImageData(previousState.state);
                imageStates[currentImageLabel] = stateToRestore;
                restoreCanvasState(stateToRestore);
                currentStroke = cloneImageData(stateToRestore);
                console.log('Canvas state restored');
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
            } else if (window.originalImages[currentImageLabel]) {
                // If we have the original image, redraw it
                console.log('Redrawing from original image');
                const img = new Image();
                img.onload = () => {
                    // Clear the canvas first
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    
                    // Get the current scale
                    const scale = imageScaleByLabel[currentImageLabel];
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
            
            // Handle stroke type actions (both freehand strokes and straight lines)
            if ((actionToRedo.type === 'line' || actionToRedo.type === 'stroke') && actionToRedo.label) {
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
                    
                    // If no vector data saved in the action, but we're redoing a line/stroke,
                    // try to recreate basic vector data to ensure label display
                    if (!actionToRedo.vectorData && 
                        (actionToRedo.type === 'line' || actionToRedo.type === 'stroke')) {
                        // Create minimal vector data to ensure label display
                        vectorStrokesByImage[currentImageLabel][actionToRedo.label] = {
                            points: [
                                { x: canvas.width/2 - 50, y: canvas.height/2 }, // Dummy points
                                { x: canvas.width/2 + 50, y: canvas.height/2 }
                            ],
                            color: actionToRedo.color || "#000000",
                            width: 5,
                            type: actionToRedo.type === 'line' ? 'straight' : 'freehand'
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
    saveState();

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
                        const scale = imageScaleByLabel[currentImageLabel];
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

    // Drawing mode state
    let drawingMode = 'freehand'; // Options: 'freehand', 'straight'
    let straightLineStart = null; // For straight line mode - start point
    let lastDrawnPoint = null;

    // Helper function to get transformed coordinates (image space from canvas space)
    function getTransformedCoords(canvasX, canvasY) {
        const scale = imageScaleByLabel[currentImageLabel] || 1;
        const position = imagePositionByLabel[currentImageLabel] || { x: 0, y: 0 };
        // Ensure scale is not zero to avoid division by zero
        if (scale === 0) {
            console.error("Image scale is zero, cannot transform coordinates.");
            return { x: canvasX, y: canvasY }; // Return untransformed coords as fallback
        }
        return {
            x: (canvasX - position.x) / scale,
            y: (canvasY - position.y) / scale
        };
    }

    // Helper function to get canvas coordinates from image coordinates
    function getCanvasCoords(imageX, imageY) {
        const scale = imageScaleByLabel[currentImageLabel] || 1;
        const position = imagePositionByLabel[currentImageLabel] || { x: 0, y: 0 };
        return {
            x: (imageX * scale) + position.x,
            y: (imageY * scale) + position.y
        };
    }

    // Drawing function for freehand mode
    function draw(e) {
        if (!isDrawing) return;
        
        // Get raw canvas coordinates for drawing operations
        const canvasX = e.offsetX;
        const canvasY = e.offsetY;
        // Get image coordinates for storing in the points array and calculating velocity
        const { x: imgX, y: imgY } = getTransformedCoords(canvasX, canvasY);

        // Calculate time delta for velocity
        const currentPoint = {
            x: imgX,    // Store image X
            y: imgY,    // Store image Y
            canvasX: canvasX, // Store canvas X for drawing
            canvasY: canvasY, // Store canvas Y for drawing
            time: Date.now()
        };
        
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
        const dynamicWidth = baseWidth * velocityFactor;

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
        const currentStrokeLabel = labelsByImage[currentImageLabel];
        
        // Initialize if needed
        if (!vectorStrokesByImage[currentImageLabel]) {
            vectorStrokesByImage[currentImageLabel] = {};
        }
        
        // Get the current image position and scale for converting to relative coordinates
        const scale = imageScaleByLabel[currentImageLabel] || 1.0;
        const offsetX = imagePositionByLabel[currentImageLabel]?.x || 0;
        const offsetY = imagePositionByLabel[currentImageLabel]?.y || 0;
        const centerX = (canvas.width - (originalImageDimensions[currentImageLabel]?.width || 0) * scale) / 2;
        const centerY = (canvas.height - (originalImageDimensions[currentImageLabel]?.height || 0) * scale) / 2;
        const imageX = centerX + offsetX;
        const imageY = centerY + offsetY;
        
        // Convert the points to image-relative coordinates
        // We only need to store the image space coordinates for persistence
        const relativePoints = points.map(point => ({
            x: (point.x - imageX) / scale,
            y: (point.y - imageY) / scale,
            time: point.time
        }));
        
        // Create or update the vector representation with image-relative coordinates
        if (!vectorStrokesByImage[currentImageLabel][currentStrokeLabel]) {
            vectorStrokesByImage[currentImageLabel][currentStrokeLabel] = {
                points: relativePoints,
                color: colorPicker.value,
                width: baseWidth,
                type: 'freehand'
            };
        } else {
            // Just update the points if the vector data already exists
            vectorStrokesByImage[currentImageLabel][currentStrokeLabel].points = relativePoints;
        }
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
        ctx.lineWidth = parseInt(brushSize.value);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
        
        // Draw a single small circle at each endpoint (but don't make them separate strokes)
        ctx.beginPath();
        ctx.arc(startPoint.x, startPoint.y, parseInt(brushSize.value) / 2, 0, Math.PI * 2);
        ctx.arc(endPoint.x, endPoint.y, parseInt(brushSize.value) / 2, 0, Math.PI * 2);
        ctx.fillStyle = colorPicker.value;
        ctx.fill();
        
        // For final line (not just preview), ensure we save this state
        if (!isDrawing) {
            currentState = getCanvasState();
        }
    }
    
    // Drawing mode toggle event listener
    drawingModeToggle.addEventListener('click', () => {
        if (drawingMode === 'freehand') {
            drawingMode = 'straight';
            drawingModeToggle.textContent = 'Straight Line';
            drawingModeToggle.classList.add('straight-mode');
        } else {
            drawingMode = 'freehand';
            drawingModeToggle.textContent = 'Freehand';
            drawingModeToggle.classList.remove('straight-mode');
        }
    });

    // Mouse drag variables for image movement
    let isDraggingImage = false;
    let lastMouseX = 0;
    let lastMouseY = 0;
    
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
        const x = e.offsetX;
        const y = e.offsetY;
        
        // Check if clicked on a label
        const clickedLabel = findLabelAtPoint(x, y);
        if (clickedLabel) {
            // Toggle selection of the corresponding stroke
            const strokeLabel = clickedLabel.strokeLabel;
            const isCurrentlySelected = selectedStrokeByImage[currentImageLabel] === strokeLabel;
            
            // Update selection state
            if (isCurrentlySelected) {
                // Deselect if already selected
                selectedStrokeByImage[currentImageLabel] = null;
            } else {
                // Select if not already selected
                selectedStrokeByImage[currentImageLabel] = strokeLabel;
                
                // When selecting a stroke, ensure it's visible
                if (strokeVisibilityByImage[currentImageLabel] === undefined) {
                    strokeVisibilityByImage[currentImageLabel] = {};
                }
                strokeVisibilityByImage[currentImageLabel][strokeLabel] = true;
            }
            
            // Start dragging the label if it's selected
            if (selectedStrokeByImage[currentImageLabel] === strokeLabel) {
                isDraggingLabel = true;
                draggedLabelStroke = strokeLabel;
                dragStartX = x;
                dragStartY = y;
                
                // Set cursor to indicate dragging
                canvas.style.cursor = 'grabbing';
            }
            
            // Update the sidebar to show selection
            updateStrokeVisibilityControls();
            
            // Redraw canvas to reflect selection
            redrawCanvasWithVisibility();
            return;
        }
        
        // Try to detect if user clicked on a stroke directly, rather than its label
        const strokeData = checkForStrokeAtPoint(x, y);
        if (strokeData) {
            // Draw a white connector circle to anchor the start point instead of selecting the line
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
            [lastX, lastY] = [x, y];
            
            // Draw a glowing white connector circle at the start point
            ctx.beginPath();
            ctx.arc(x, y, parseInt(brushSize.value) / 2 + 5, 0, Math.PI * 2);
            
            // Create a white glow effect with a radial gradient
            const gradient = ctx.createRadialGradient(
                x, y, parseInt(brushSize.value) / 4,
                x, y, parseInt(brushSize.value) / 2 + 5
            );
            gradient.addColorStop(0, 'white');
            gradient.addColorStop(0.7, 'rgba(255, 255, 255, 0.8)');
            gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
            
            ctx.fillStyle = gradient;
            ctx.fill();
            
            // Then draw the colored dot for the actual start point
            ctx.beginPath();
            ctx.arc(x, y, parseInt(brushSize.value) / 2, 0, Math.PI * 2);
            ctx.fillStyle = colorPicker.value;
            ctx.fill();
            
            if (drawingMode === 'straight') {
                // For straight line, store the start point
                straightLineStart = { x: x, y: y };
            } else {
                // For freehand, add first point
                const firstPoint = {
                    x: x,
                    y: y,
                    time: Date.now()
                };
                points.push(firstPoint);
                lastDrawnPoint = firstPoint;
            }
            return;
        }
        
        // Handle image dragging with Shift key
        if (isShiftPressed) {
            isDraggingImage = true;
            lastMouseX = e.offsetX;
            lastMouseY = e.offsetY;
            canvas.style.cursor = 'grabbing';
            return;
        }
    
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
        
        if (drawingMode === 'straight') {
            // For straight line, just store the start point
            straightLineStart = { x: e.offsetX, y: e.offsetY };
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
            ctx.arc(e.offsetX, e.offsetY, parseInt(brushSize.value) / 2, 0, Math.PI * 2);
            ctx.fillStyle = colorPicker.value;
            ctx.fill();
        }
    });
    
    canvas.addEventListener('mousemove', (e) => {
        const x = e.offsetX;
        const y = e.offsetY;
        
        // Change cursor when hovering over labels
        if (!isDraggingLabel && !isDraggingImage && !isDrawing) {
            const hoveredLabel = findLabelAtPoint(x, y);
            canvas.style.cursor = hoveredLabel ? 'grab' : (isShiftPressed ? 'grab' : 'crosshair');
        }
        
        // Handle label dragging
        if (isDraggingLabel) {
            // Calculate movement delta
            const deltaX = x - dragStartX;
            const deltaY = y - dragStartY;
            
            // Update drag start position for next move
            dragStartX = x;
            dragStartY = y;
            
            // Ensure we have a position record for this label
            if (!customLabelPositions[currentImageLabel]) {
                customLabelPositions[currentImageLabel] = {};
            }
            
            // Find the current label position
            const labelToMove = currentLabelPositions.find(l => l.strokeLabel === draggedLabelStroke);
            if (labelToMove) {
                // Create or update the custom position
                if (!customLabelPositions[currentImageLabel][draggedLabelStroke]) {
                    customLabelPositions[currentImageLabel][draggedLabelStroke] = {
                        x: labelToMove.x,
                        y: labelToMove.y
                    };
                }
                
                // Update the position with the movement delta
                const pos = customLabelPositions[currentImageLabel][draggedLabelStroke];
                pos.x += deltaX;
                pos.y += deltaY;
                
                // Ensure the label stays within canvas bounds
                pos.x = Math.max(10, Math.min(canvas.width - labelToMove.width - 10, pos.x));
                pos.y = Math.max(10, Math.min(canvas.height - labelToMove.height - 10, pos.y));
                
                // Redraw with the new position
                redrawCanvasWithVisibility();
            }
            return;
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
            } else {
                // Normal freehand drawing
            draw(e);
            }
        }
    });
    
    canvas.addEventListener('mouseup', (e) => {
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
            // For straight line, finalize the line
            if (drawingMode === 'straight' && straightLineStart) {
                const endPoint = { x: e.offsetX, y: e.offsetY };
                
                // Only save the line if the start and end points are different
                if (Math.abs(straightLineStart.x - endPoint.x) > 2 || 
                    Math.abs(straightLineStart.y - endPoint.y) > 2) {
                    
                    // Check if end point is on another stroke
                    const endPointStrokeData = checkForStrokeAtPoint(endPoint.x, endPoint.y);
                    
                    // Save the vector data for the straight line
                    const newStrokeLabel = labelsByImage[currentImageLabel];
                    const strokeColor = colorPicker.value;
                    const strokeWidth = parseInt(brushSize.value);
                    
                    // Initialize if needed
                    if (!vectorStrokesByImage[currentImageLabel]) {
                        vectorStrokesByImage[currentImageLabel] = {};
                    }
                    
                    // Get the current image position and scale
                    const scale = imageScaleByLabel[currentImageLabel];
                    const offsetX = imagePositionByLabel[currentImageLabel]?.x || 0;
                    const offsetY = imagePositionByLabel[currentImageLabel]?.y || 0;
                    
                    let imageX, imageY;
                    
                    // If we have an image, calculate coordinates relative to it
                    if (window.originalImages && window.originalImages[currentImageLabel] && 
                        originalImageDimensions[currentImageLabel]?.width) {
                        const centerX = (canvas.width - (originalImageDimensions[currentImageLabel].width || 0) * scale) / 2;
                        const centerY = (canvas.height - (originalImageDimensions[currentImageLabel].height || 0) * scale) / 2;
                        imageX = centerX + offsetX;
                        imageY = centerY + offsetY;
                    } else {
                        // Without an image, use canvas center as reference point
                        imageX = canvas.width / 2;
                        imageY = canvas.height / 2;
                    }
                    
                    // Convert from canvas coordinates to image-relative coordinates
                    const relativeStartX = (straightLineStart.x - imageX) / scale;
                    const relativeStartY = (straightLineStart.y - imageY) / scale;
                    const relativeEndX = (endPoint.x - imageX) / scale;
                    const relativeEndY = (endPoint.y - imageY) / scale;
                    
                    // Create a vector representation of the straight line with just start and end points
                    // Store coordinates relative to the image, not absolute canvas coordinates
                    vectorStrokesByImage[currentImageLabel][newStrokeLabel] = {
                        points: [
                            { x: relativeStartX, y: relativeStartY },
                            { x: relativeEndX, y: relativeEndY }
                        ],
                        color: strokeColor,
                        width: strokeWidth,
                        type: 'straight'
                    };
                    
                    // Ensure the stroke is added to the list of strokes
                    if (!lineStrokesByImage[currentImageLabel].includes(newStrokeLabel)) {
                        lineStrokesByImage[currentImageLabel].push(newStrokeLabel);
                    }
                    
                    // Make sure visibility is set
                    strokeVisibilityByImage[currentImageLabel] = strokeVisibilityByImage[currentImageLabel] || {};
                    strokeVisibilityByImage[currentImageLabel][newStrokeLabel] = true;
                    
                    // Ensure label visibility is set
                    strokeLabelVisibility[currentImageLabel] = strokeLabelVisibility[currentImageLabel] || {};
                    strokeLabelVisibility[currentImageLabel][newStrokeLabel] = true;
                    
                    // Draw the final line
                    drawStraightLinePreview(straightLineStart, endPoint);
                    
                    // If end point overlaps with another line, draw a glowing circle
                    if (endPointStrokeData) {
                        // Draw a glowing white connector circle at the end point
                        ctx.beginPath();
                        ctx.arc(endPoint.x, endPoint.y, parseInt(brushSize.value) / 2 + 5, 0, Math.PI * 2);
                        
                        // Create a white glow effect with a radial gradient
                        const gradient = ctx.createRadialGradient(
                            endPoint.x, endPoint.y, parseInt(brushSize.value) / 4,
                            endPoint.x, endPoint.y, parseInt(brushSize.value) / 2 + 5
                        );
                        gradient.addColorStop(0, 'white');
                        gradient.addColorStop(0.7, 'rgba(255, 255, 255, 0.8)');
                        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
                        
                        ctx.fillStyle = gradient;
                        ctx.fill();
                        
                        // Then draw the colored dot for the actual end point
                        ctx.beginPath();
                        ctx.arc(endPoint.x, endPoint.y, parseInt(brushSize.value) / 2, 0, Math.PI * 2);
                        ctx.fillStyle = strokeColor;
                        ctx.fill();
                    }
                }
                
                // Reset straight line start
                straightLineStart = null;
            } else if (drawingMode === 'freehand' && points.length > 0) {
                // Handle freehand drawing completion
                const newStrokeLabel = labelsByImage[currentImageLabel];
                const strokeColor = colorPicker.value;
                const strokeWidth = parseInt(brushSize.value);
                
                // Make sure the vector data is finalized
                if (!vectorStrokesByImage[currentImageLabel]) {
                    vectorStrokesByImage[currentImageLabel] = {};
                }
                
                // Only add the stroke if it has valid points
                if (points.length > 1) {
                    // Get the current image position and scale
                    const scale = imageScaleByLabel[currentImageLabel];
                    const offsetX = imagePositionByLabel[currentImageLabel]?.x || 0;
                    const offsetY = imagePositionByLabel[currentImageLabel]?.y || 0;
                    
                    let imageX, imageY;
                    
                    // If we have an image, calculate coordinates relative to it
                    if (window.originalImages && window.originalImages[currentImageLabel] && 
                        originalImageDimensions[currentImageLabel]?.width) {
                        const centerX = (canvas.width - (originalImageDimensions[currentImageLabel].width || 0) * scale) / 2;
                        const centerY = (canvas.height - (originalImageDimensions[currentImageLabel].height || 0) * scale) / 2;
                        imageX = centerX + offsetX;
                        imageY = centerY + offsetY;
                    } else {
                        // Without an image, use canvas center as reference point
                        imageX = canvas.width / 2;
                        imageY = canvas.height / 2;
                    }
                    
                    // Convert all points from canvas coordinates to image-relative coordinates
                    const relativePoints = points.map(point => ({
                        x: (point.x - imageX) / scale,
                        y: (point.y - imageY) / scale,
                        time: point.time
                    }));
                    
                    // Ensure the vector data is properly stored with image-relative coordinates
                    vectorStrokesByImage[currentImageLabel][newStrokeLabel] = {
                        points: relativePoints,
                        color: strokeColor,
                        width: strokeWidth,
                        type: 'freehand'
                    };
                    
                    // Ensure the stroke is added to the list of strokes
                    if (!lineStrokesByImage[currentImageLabel].includes(newStrokeLabel)) {
                        lineStrokesByImage[currentImageLabel].push(newStrokeLabel);
                    }
                    
                    // Make sure visibility is set
                    strokeVisibilityByImage[currentImageLabel] = strokeVisibilityByImage[currentImageLabel] || {};
                    strokeVisibilityByImage[currentImageLabel][newStrokeLabel] = true;
                    
                    // Ensure label visibility is set
                    strokeLabelVisibility[currentImageLabel] = strokeLabelVisibility[currentImageLabel] || {};
                    strokeLabelVisibility[currentImageLabel][newStrokeLabel] = true;
                }
                
                    // Check if the last point of the freehand stroke is on another stroke
                    if (points.length > 0) {
                        const lastPoint = points[points.length - 1];
                        const endPointStrokeData = checkForStrokeAtPoint(lastPoint.x, lastPoint.y);
                        
                        // If end point overlaps with another line, draw a glowing circle
                        if (endPointStrokeData) {
                            // Draw a glowing white connector circle at the end point
                            ctx.beginPath();
                            ctx.arc(lastPoint.x, lastPoint.y, parseInt(brushSize.value) / 2 + 5, 0, Math.PI * 2);
                            
                            // Create a white glow effect with a radial gradient
                            const gradient = ctx.createRadialGradient(
                                lastPoint.x, lastPoint.y, parseInt(brushSize.value) / 4,
                                lastPoint.x, lastPoint.y, parseInt(brushSize.value) / 2 + 5
                            );
                            gradient.addColorStop(0, 'white');
                            gradient.addColorStop(0.7, 'rgba(255, 255, 255, 0.8)');
                            gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
                            
                            ctx.fillStyle = gradient;
                            ctx.fill();
                            
                            // Then draw the colored dot for the actual end point
                            ctx.beginPath();
                            ctx.arc(lastPoint.x, lastPoint.y, parseInt(brushSize.value) / 2, 0, Math.PI * 2);
                            ctx.fillStyle = colorPicker.value;
                            ctx.fill();
                        }
                    }
                
                // Reset points array for next stroke
                points = [];
                lastVelocity = 0;
                lastDrawnPoint = null;
            }
            
            isDrawing = false;
            isDrawingOrPasting = false;
            strokeInProgress = false;
            
            // Make sure the current state is captured
            const finalState = getCanvasState();
            
            // Save state immediately after stroke completion and increment label
            saveState(true, true);
            
            // Update the sidebar visibility controls
            updateStrokeVisibilityControls();
            
            // Force redraw to show labels immediately
            redrawCanvasWithVisibility();
        }
    });
    
    canvas.addEventListener('mouseout', () => {
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
        if (currentImageLabel === label) return;
        
        console.log(`Switching from ${currentImageLabel} to ${label}`);
        
        // Save current state before switching
        const currentStrokes = [...(lineStrokesByImage[currentImageLabel] || [])];
        const currentState = getCanvasState();
        
        // Create a snapshot state that includes the strokes list
        undoStackByImage[currentImageLabel].push({
            state: cloneImageData(currentState),
            type: 'snapshot',
            strokes: currentStrokes
        });
        
        // Update current image label
        currentImageLabel = label;
        
        // Restore state for the new image
        if (imageStates[label]) {
            restoreCanvasState(imageStates[label]);
        } else if (window.originalImages[label]) {
            // If no state exists but we have the original image, paste it
            console.log(`No state exists for ${label}, pasting original image`);
            pasteImageFromUrl(window.originalImages[label]);
        } else {
            // Clear canvas if no state or original image exists
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        
        // Update UI
        updateActiveImageInSidebar();
        updateStrokeCounter();
        updateStrokeVisibilityControls();
        
        // Update scale UI to reflect the current image's scale
        updateScaleUI();
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
        
        // Clear the selected stroke
        selectedStrokeByImage[currentImageLabel] = null;
        
        // Instead of just clearing the canvas, redraw the original image if available
        if (window.originalImages[currentImageLabel]) {
            const img = new Image();
            img.onload = () => {
                // Clear the canvas first
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                
                // Get the current scale
                const scale = imageScaleByLabel[currentImageLabel];
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
                
                // Update UI
                updateStrokeCounter();
                updateStrokeVisibilityControls();
                
                // Make sure scale indicator stays up to date
                const scaleElement = document.getElementById(`scale-${currentImageLabel}`);
                if (scaleElement) {
                    scaleElement.textContent = `Scale: ${Math.round(scale * 100)}%`;
                }
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
            
            // Update UI
            updateStrokeCounter();
            updateStrokeVisibilityControls();
        }
    });
    
    // Save canvas
    saveButton.addEventListener('click', () => {
        const projectName = document.getElementById('projectName').value || 'New Sofa';
        const unit = document.getElementById('unitSelector').value || 'inch';
        
        // Create filename using project name, view, and unit
        // Replace spaces with underscores
        const sanitizedName = projectName.replace(/\s+/g, '_');
        const filename = `${sanitizedName}_${currentImageLabel}_${unit}.png`;
        
        const link = document.createElement('a');
        link.download = filename;
        link.href = canvas.toDataURL();
        link.click();
    });
    
    // Determine the best label for an image based on its filename
    function getLabelFromFilename(filename) {
        filename = filename.toLowerCase();
        
        if (filename.includes('front')) {
            return 'front';
        } else if (filename.includes('side')) {
            return 'side';
        } else if (filename.includes('back')) {
            return 'back';
        } else if (filename.includes('cushion')) {
            return 'cushion';
        } else {
            // If no matching keywords, find next available label
            for (const label of IMAGE_LABELS) {
                if (!window.originalImages[label]) {
                    return label;
                }
            }
            return IMAGE_LABELS[0]; // Default to front if all are taken
        }
    }
    
    // Handle file drop
    const handleFiles = (files) => {
        // Convert FileList to Array for easier manipulation
        const fileArray = Array.from(files);
        
        // Sort files to prioritize ones with matching keywords
        const sortedFiles = fileArray.sort((a, b) => {
            const aName = a.name.toLowerCase();
            const bName = b.name.toLowerCase();
            
            // Define priority order for keywords
            const keywordOrder = ['front', 'side', 'back', 'cushion'];
            
            // Find the first keyword that matches for each file
            const aKeyword = keywordOrder.find(keyword => aName.includes(keyword)) || '';
            const bKeyword = keywordOrder.find(keyword => bName.includes(keyword)) || '';
            
            // Get the index of each keyword
            const aIndex = keywordOrder.indexOf(aKeyword);
            const bIndex = keywordOrder.indexOf(bKeyword);
            
            // Sort by keyword index (if both have matching keywords)
            if (aIndex >= 0 && bIndex >= 0) {
                return aIndex - bIndex;
            }
            
            // Prioritize files with matching keywords
            if (aIndex >= 0) return -1;
            if (bIndex >= 0) return 1;
            
            // Sort alphabetically for files without matching keywords
            return aName.localeCompare(bName);
        });
        
        // Process each file
        sortedFiles.forEach(file => {
            if (file.type.indexOf('image') !== -1) {
                const url = URL.createObjectURL(file);
                const label = getLabelFromFilename(file.name);
                
                console.log(`Processing file ${file.name} as ${label}`);
                
                // Add to sidebar (replace existing if the label is already taken)
                const existingContainer = document.querySelector(`.image-container[data-label="${label}"]`);
                if (existingContainer) {
                    existingContainer.remove();
                }
                
                addImageToSidebar(url, label);
                
                // Store the image URL
                if (!pastedImages.includes(url)) {
                    pastedImages.push(url);
                }
                window.originalImages[label] = url;
                
                // Clear any previous state for this label
                imageStates[label] = null;
                undoStackByImage[label] = [];
                lineStrokesByImage[label] = [];
                labelsByImage[label] = 'A1';
                
                // If this is the first image, switch to it and paste it
                if (pastedImages.length === 1 || label === 'front') {
                    currentImageLabel = label;
                    pasteImageFromUrl(url);
                }
            }
        });
        
        // Update UI
        updateStrokeCounter();
        updateSidebarStrokeCounts();
        updateActiveImageInSidebar();
        updateStrokeVisibilityControls();
    };
    
    // Set up drag and drop events
    const setupDragAndDrop = () => {
        const dropZone = canvas;
        
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.add('drag-over');
        });
        
        dropZone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('drag-over');
        });
        
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('drag-over');
            
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                handleFiles(e.dataTransfer.files);
            }
        });
    };
    
    // Initialize drag and drop
    setupDragAndDrop();
    
    // Handle paste from clipboard
    document.addEventListener('paste', (e) => {
        const items = e.clipboardData.items;
        for (let item of items) {
            if (item.type.indexOf('image') !== -1) {
                const blob = item.getAsFile();
                const url = URL.createObjectURL(blob);
                
                // Assign to the first available label
                let label;
                for (const availableLabel of IMAGE_LABELS) {
                    if (!window.originalImages[availableLabel]) {
                        label = availableLabel;
                        break;
                    }
                }
                
                // If all labels are taken, use the current label
                if (!label) {
                    label = currentImageLabel;
                }
                
                // Add to sidebar
                const existingContainer = document.querySelector(`.image-container[data-label="${label}"]`);
                if (existingContainer) {
                    existingContainer.remove();
                }
                
                addImageToSidebar(url, label);
                
                // Store the image URL
                if (!pastedImages.includes(url)) {
                    pastedImages.push(url);
                }
                window.originalImages[label] = url;
                
                // Switch to this image and paste it
                currentImageLabel = label;
                
                // Clear any previous state for this label
                imageStates[label] = null;
                undoStackByImage[label] = [];
                lineStrokesByImage[label] = [];
                labelsByImage[label] = 'A1';
                
                // Paste the image
                pasteImageFromUrl(url);
                
                // Update UI
                updateStrokeCounter();
                updateSidebarStrokeCounts();
                updateActiveImageInSidebar();
                updateStrokeVisibilityControls();
            }
        }
    });
    
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
        const currentScale = imageScaleByLabel[currentImageLabel];
        const activeButton = document.querySelector(`.scale-btn[data-scale="${currentScale}"]`);
        if (activeButton) {
            activeButton.classList.add('active');
        }
    }
    
    function updateImageScale(newScale) {
        if (!window.originalImages[currentImageLabel]) {
            console.log('No image to scale');
            return; // No image to scale
        }
        
        // Update scale for current image
        const oldScale = imageScaleByLabel[currentImageLabel];
        imageScaleByLabel[currentImageLabel] = newScale;
        
        // Redraw the image with the new scale
        const img = new Image();
        img.onload = () => {
            // Save current state before redrawing
            const previousState = getCanvasState();
            undoStackByImage[currentImageLabel].push({
                state: cloneImageData(previousState),
                type: 'scale',
                label: null
            });
            
            // Clear canvas
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            // Apply scale
            const scale = imageScaleByLabel[currentImageLabel];
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
            
            // Draw the image with scaling and positioning
            ctx.drawImage(img, x, y, scaledWidth, scaledHeight);
            
            // Redraw all strokes using vector data with proper scaling and positioning
            redrawCanvasWithVisibility();
            
            // Update the scale display in the sidebar
            const scaleElement = document.getElementById(`scale-${currentImageLabel}`);
            if (scaleElement) {
                scaleElement.textContent = `Scale: ${Math.round(scale * 100)}%`;
            }
            
            // Update UI
            updateScaleButtonsActiveState();
        };
        img.src = originalImages[currentImageLabel];
    }
    
    // Initialize scale option click handlers
    document.querySelectorAll('.scale-option').forEach(option => {
        option.addEventListener('click', () => {
            const scale = parseFloat(option.dataset.scale);
            if (!isNaN(scale)) {
                updateImageScale(scale);
                // Update dropdown button text
                const scaleButton = document.getElementById('scaleButton');
                if (scaleButton) {
                    scaleButton.textContent = `Scale: ${Math.round(scale * 100)}% ▼`;
                }
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
        });
    });
    
    // Function to move the image and its strokes
    function moveImage(deltaX, deltaY) {
        if (!window.originalImages[currentImageLabel]) {
            return; // No image to move
        }
        
        // Update position offset
        imagePositionByLabel[currentImageLabel].x += deltaX;
        imagePositionByLabel[currentImageLabel].y += deltaY;
        
        // Redraw the image with updated position
        const img = new Image();
        img.onload = () => {
            // Save current state before moving
            const currentState = getCanvasState();
            undoStackByImage[currentImageLabel].push({
                state: cloneImageData(currentState),
                type: 'move',
                label: null
            });
            
            // Clear canvas
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            // Apply scale
            const scale = imageScaleByLabel[currentImageLabel];
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
            
            // Draw the image with updated position
            ctx.drawImage(img, x, y, scaledWidth, scaledHeight);
            
            // Redraw all strokes using vector data with proper positioning
            redrawCanvasWithVisibility();
        };
        img.src = originalImages[currentImageLabel];
    }
    
    // Handle WASD and zoom keyboard controls
    document.addEventListener('keydown', (e) => {
        // Don't process if user is typing in an input field
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            return;
        }
        
        // Zoom controls
        if (e.key === 'q' || e.key === 'Q') {
            // Zoom out - find the next smaller scale
            const currentScale = imageScaleByLabel[currentImageLabel];
            const scales = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
            let nextScale = 0.1; // Minimum scale
            
            for (let i = scales.length - 1; i >= 0; i--) {
                if (scales[i] < currentScale) {
                    nextScale = scales[i];
                    break;
                }
            }
            
            updateImageScale(nextScale);
            const scaleButton = document.getElementById('scaleButton');
            if (scaleButton) {
                scaleButton.textContent = `Scale: ${Math.round(nextScale * 100)}% ▼`;
            }
        } else if (e.key === 'e' || e.key === 'E') {
            // Zoom in - find the next larger scale
            const currentScale = imageScaleByLabel[currentImageLabel];
            const scales = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
            let nextScale = 2; // Maximum scale
            
            for (let i = 0; i < scales.length; i++) {
                if (scales[i] > currentScale) {
                    nextScale = scales[i];
                    break;
                }
            }
            
            updateImageScale(nextScale);
            const scaleButton = document.getElementById('scaleButton');
            if (scaleButton) {
                scaleButton.textContent = `Scale: ${Math.round(nextScale * 100)}% ▼`;
            }
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
        const scale = imageScaleByLabel[currentImageLabel];
        const scaleButton = document.getElementById('scaleButton');
        if (scaleButton) {
            scaleButton.textContent = `Scale: ${Math.round(scale * 100)}% ▼`;
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
    
    // Adjust canvas size when window resizes to account for sidebars
    window.addEventListener('resize', () => {
        resizeCanvas();
        
        // Check if sidebars are overlapping canvas and adjust if needed
        const canvasRect = canvas.getBoundingClientRect();
        const imageSidebarRect = imageSidebar.getBoundingClientRect();
        const strokeSidebarRect = strokeSidebar.getBoundingClientRect();
        
        // If image sidebar is overlapping canvas on the right
        if (imageSidebarRect.left < canvasRect.right) {
            imageSidebar.style.left = 'auto';
            imageSidebar.style.right = '20px';
        }
        
        // If stroke sidebar is overlapping canvas on the left
        if (strokeSidebarRect.right > canvasRect.left) {
            strokeSidebar.style.left = '20px';
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
                candidateRect.x = Math.max(10, Math.min(canvas.width - labelRect.width - 10, candidateRect.x));
                candidateRect.y = Math.max(10, Math.min(canvas.height - labelRect.height - 10, candidateRect.y));
                
                // Count how many existing labels this position would overlap with
                let impactCount = 0;
                for (const existingLabel of currentLabelPositions) {
                    if (rectsOverlap(candidateRect, existingLabel)) {
                        impactCount++;
                    }
                }
                
                // Score this position
                const score = evaluateLabelPosition(candidateRect, anchorPoint, strokeInfo);
                
                // Prioritize positions with minimal impact on other labels
                if (impactCount < bestImpactCount || 
                    (impactCount === bestImpactCount && score > bestScore)) {
                    bestImpactCount = impactCount;
                    bestScore = score;
                    bestRect = { ...candidateRect };
                }
                
                // If we found a position that affects no other labels and has a good score, prioritize it
                if (impactCount === 0 && score > 0.6) {
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
        // Find the closest point on the label to connect to
        const labelCenter = {
            x: labelRect.x + labelRect.width / 2,
            y: labelRect.y + labelRect.height / 2
        };
        
        // Determine the exit point from the label (closest edge to the anchor)
        let exitPoint;
        
        // Try to exit from the nearest edge to create a shorter, cleaner line
        if (Math.abs(labelCenter.x - anchorPoint.x) > Math.abs(labelCenter.y - anchorPoint.y)) {
            // Exit from left or right side
            const x = (anchorPoint.x < labelCenter.x) ? labelRect.x : (labelRect.x + labelRect.width);
            const y = labelCenter.y;
            exitPoint = {x, y};
        } else {
            // Exit from top or bottom side
            const x = labelCenter.x;
            const y = (anchorPoint.y < labelCenter.y) ? labelRect.y : (labelRect.y + labelRect.height);
            exitPoint = {x, y};
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
        const scale = imageScaleByLabel[currentImageLabel] || 1;
        
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
    
    // Expose necessary functions globally for project-manager.js to use
    window.addImageToSidebar = addImageToSidebar;
    window.switchToImage = switchToImage;
    window.updateStrokeCounter = updateStrokeCounter;
    window.updateStrokeVisibilityControls = updateStrokeVisibilityControls;
    window.redrawCanvasWithVisibility = redrawCanvasWithVisibility;
    window.updateScaleUI = updateScaleUI;
})