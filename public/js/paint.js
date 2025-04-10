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
    });
    
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    const colorPicker = document.getElementById('colorPicker');
    const brushSize = document.getElementById('brushSize');
    const clearButton = document.getElementById('clear');
    const saveButton = document.getElementById('save');
    const pasteButton = document.getElementById('paste');
    const strokeCounter = document.getElementById('strokeCounter');
    const imageList = document.getElementById('imageList');
    
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
    const originalImages = {};
    
    function pasteImageFromUrl(url) {
        console.log(`Pasting image for ${currentImageLabel}: ${url.substring(0, 30)}...`);
        
        const img = new Image();
        img.onload = () => {
            // Store the original image for this view
            originalImages[currentImageLabel] = url;
            
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
            console.log(`Current original images: ${Object.keys(originalImages).join(', ')}`);
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

    function updateStrokeCounter() {
        const strokeCount = lineStrokesByImage[currentImageLabel]?.length || 0;
        const displayLabel = currentImageLabel.charAt(0).toUpperCase() + currentImageLabel.slice(1);
        strokeCounter.textContent = `${displayLabel} Lines: ${strokeCount}`;
        
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
            
            const item = document.createElement('div');
            item.className = 'stroke-visibility-item';
            item.dataset.stroke = strokeLabel;
            item.dataset.selected = 'false';
            
            // Make item selectable
            item.addEventListener('click', (e) => {
                // Don't trigger selection if clicking a button or checkbox
                if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') {
                    return;
                }
                
                // Toggle selection
                const isSelected = item.dataset.selected === 'true';
                item.dataset.selected = isSelected ? 'false' : 'true';
                
                // Update the measurement input with the selected stroke's measurement
                if (!isSelected) {
                    updateMeasurementInputWithStroke(strokeLabel);
                }
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
            if (vectorStrokesByImage[currentImageLabel] && 
                vectorStrokesByImage[currentImageLabel][strokeLabel]) {
                strokeColor = vectorStrokesByImage[currentImageLabel][strokeLabel].color || '#000';
            } else {
                for (let i = undoStackByImage[currentImageLabel].length - 1; i >= 0; i--) {
                    const action = undoStackByImage[currentImageLabel][i];
                    if (action.label === strokeLabel && action.color) {
                        strokeColor = action.color;
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
            
            // Create measurement text
            const measureText = document.createElement('span');
            measureText.className = 'stroke-measurement';
            measureText.textContent = measurement ? `= ${measurement}` : '';
            
            // Create edit button
            const editBtn = document.createElement('button');
            editBtn.className = 'stroke-edit-btn';
            editBtn.innerHTML = '✏️';
            editBtn.title = 'Edit Stroke';
            editBtn.onclick = () => showEditDialog(strokeLabel);
            
            // Create label toggle button
            const labelToggleBtn = document.createElement('button');
            labelToggleBtn.className = 'stroke-label-toggle';
            labelToggleBtn.classList.toggle('active', isLabelVisible);
            labelToggleBtn.innerHTML = isLabelVisible ? '👁️' : '👁️‍🗨️';
            labelToggleBtn.title = isLabelVisible ? 'Hide Label on Canvas' : 'Show Label on Canvas';
            labelToggleBtn.onclick = () => toggleLabelVisibility(strokeLabel);
            
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
        strokeLabelVisibility[currentImageLabel][strokeLabel] = !strokeLabelVisibility[currentImageLabel][strokeLabel];
        
        // Update the UI
        updateStrokeVisibilityControls();
        
        // Redraw the canvas with updated label visibility
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
            if (newName !== strokeLabel && newName !== '') {
                renameStroke(strokeLabel, newName);
            }
            
            // Always save both units
            strokeMeasurements[currentImageLabel][newName || strokeLabel] = {
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
    
    // Function to rename a stroke
    function renameStroke(oldName, newName) {
        if (oldName === newName) return;
        
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
                    break;
                }
            }
        }
        
        // Update all relevant data structures
        if (lineStrokesByImage[currentImageLabel]) {
            const index = lineStrokesByImage[currentImageLabel].indexOf(oldName);
            if (index !== -1) {
                lineStrokesByImage[currentImageLabel][index] = newName;
            }
        }
        
        // Update visibility
        if (strokeVisibilityByImage[currentImageLabel] && 
            strokeVisibilityByImage[currentImageLabel][oldName] !== undefined) {
            const isVisible = strokeVisibilityByImage[currentImageLabel][oldName];
            strokeVisibilityByImage[currentImageLabel][newName] = isVisible;
            delete strokeVisibilityByImage[currentImageLabel][oldName];
        }
        
        // Update label visibility
        if (strokeLabelVisibility[currentImageLabel] && 
            strokeLabelVisibility[currentImageLabel][oldName] !== undefined) {
            const isLabelVisible = strokeLabelVisibility[currentImageLabel][oldName];
            strokeLabelVisibility[currentImageLabel][newName] = isLabelVisible;
            delete strokeLabelVisibility[currentImageLabel][oldName];
        }
        
        // Update stroke data
        if (strokeDataByImage[currentImageLabel] && 
            strokeDataByImage[currentImageLabel][oldName]) {
            strokeDataByImage[currentImageLabel][newName] = 
                strokeDataByImage[currentImageLabel][oldName];
            delete strokeDataByImage[currentImageLabel][oldName];
        }
        
        // Update vector data
        if (vectorStrokesByImage[currentImageLabel] && 
            vectorStrokesByImage[currentImageLabel][oldName]) {
            vectorStrokesByImage[currentImageLabel][newName] = 
                vectorStrokesByImage[currentImageLabel][oldName];
            delete vectorStrokesByImage[currentImageLabel][oldName];
        }
        
        // Update measurements
        if (strokeMeasurements[currentImageLabel] && 
            strokeMeasurements[currentImageLabel][oldName]) {
            strokeMeasurements[currentImageLabel][newName] = 
                strokeMeasurements[currentImageLabel][oldName];
            delete strokeMeasurements[currentImageLabel][oldName];
        }
        
        // Update next label if needed
        if (labelsByImage[currentImageLabel] === oldName) {
            labelsByImage[currentImageLabel] = newName;
        }
        
        // Update any references in the undo/redo stacks
        if (undoStackByImage[currentImageLabel]) {
            undoStackByImage[currentImageLabel].forEach(action => {
                if (action.label === oldName) {
                    action.label = newName;
                }
            });
        }
        
        if (redoStackByImage[currentImageLabel]) {
            redoStackByImage[currentImageLabel].forEach(action => {
                if (action.label === oldName) {
                    action.label = newName;
                }
            });
        }
        
        // Force redraw to update label names on the canvas
        redrawCanvasWithVisibility();
    }
    
    // Function to toggle stroke visibility
    function toggleStrokeVisibility(strokeLabel, isVisible) {
        console.log(`Toggling visibility of stroke ${strokeLabel} to ${isVisible}`);
        
        // Update visibility state
        strokeVisibilityByImage[currentImageLabel][strokeLabel] = isVisible;
        
        // Redraw canvas with updated visibility
        redrawCanvasWithVisibility();
    }
    
    // Store vector stroke data for each stroke
    let vectorStrokesByImage = {};
    
    // Initialize vector stroke storage for each image label
    IMAGE_LABELS.forEach(label => {
        vectorStrokesByImage[label] = {};
    });
    
    // Store for stroke measurement labels visibility
    let strokeLabelVisibility = {};
    
    // Initialize stroke label visibility for each image (default to visible)
    IMAGE_LABELS.forEach(label => {
        strokeLabelVisibility[label] = {};
    });
    
    // Cache for loaded images to prevent flickering
    const imageCache = {};
    
    // Function to redraw canvas respecting stroke visibility
    function redrawCanvasWithVisibility() {
        // We need to rebuild the canvas from scratch using individual stroke data
        const strokes = lineStrokesByImage[currentImageLabel] || [];
        
        // Start with a blank canvas or the original image if available
        if (originalImages && originalImages[currentImageLabel]) {
            // Check if we already have this image in the cache
            const imageUrl = originalImages[currentImageLabel];
            
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
                }
            }
        } else {
            // Otherwise start with a blank canvas
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            applyVisibleStrokes(1, 0, 0);
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
            strokes.forEach(strokeLabel => {
                const isVisible = strokeVisibilityByImage[currentImageLabel][strokeLabel];
                if (!isVisible) return;
                
                // Check if we have vector data for this stroke
                if (vectorStrokesByImage[currentImageLabel] && 
                    vectorStrokesByImage[currentImageLabel][strokeLabel]) {
                    
                    // Get the vector data for this stroke
                    const vectorData = vectorStrokesByImage[currentImageLabel][strokeLabel];
                    const strokeColor = vectorData.color || "#000000";
                    const strokeWidth = vectorData.width || 5;
                    
                    // Draw using vector points
                    if (vectorData.points && vectorData.points.length > 0) {
                        ctx.beginPath();
                        
                        // Transform the first point
                        const firstPoint = vectorData.points[0];
                        const transformedFirstX = imageX + (firstPoint.x * scale);
                        const transformedFirstY = imageY + (firstPoint.y * scale);
                        
                        ctx.moveTo(transformedFirstX, transformedFirstY);
                        
                        // Draw curves through the rest of the points
                        let lastDrawnPoint = {x: transformedFirstX, y: transformedFirstY};
                        
                        for (let i = 1; i < vectorData.points.length; i++) {
                            const point = vectorData.points[i];
                            // Transform the point coordinates based on image scale and position
                            const transformedX = imageX + (point.x * scale);
                            const transformedY = imageY + (point.y * scale);
                            
                            if (i === 1 || !vectorData.points[i-1]) {
                                ctx.lineTo(transformedX, transformedY);
                            } else {
                                const prev = vectorData.points[i-1];
                                const transformedPrevX = imageX + (prev.x * scale);
                                const transformedPrevY = imageY + (prev.y * scale);
                                
                                const mid = {
                                    x: (transformedPrevX + transformedX) / 2,
                                    y: (transformedPrevY + transformedY) / 2
                                };
                                ctx.quadraticCurveTo(transformedPrevX, transformedPrevY, mid.x, mid.y);
                            }
                            
                            lastDrawnPoint = {x: transformedX, y: transformedY};
                        }
                        
                        // Set stroke style
                        ctx.strokeStyle = strokeColor;
                        ctx.lineWidth = strokeWidth * scale; // Scale line width
                        ctx.lineCap = 'round';
                        ctx.lineJoin = 'round';
                        ctx.stroke();
                        
                        // Draw a dot for a single point
                        if (vectorData.points.length === 1) {
                            ctx.beginPath();
                            ctx.arc(transformedFirstX, transformedFirstY, (strokeWidth/2) * scale, 0, Math.PI * 2);
                            ctx.fillStyle = strokeColor;
                            ctx.fill();
                        }
                        
                        // Draw label near the stroke if enabled
                        if (strokeLabelVisibility[currentImageLabel][strokeLabel]) {
                            // Find a good position for the label (near the start of the stroke)
                            const labelX = transformedFirstX + 10; // Offset to not cover the stroke
                            const labelY = transformedFirstY - 10; 
                            
                            // Draw a white background for the label
                            const measurement = getMeasurementString(strokeLabel);
                            const labelText = `${strokeLabel}${measurement ? ` = ${measurement}` : ''}`;
                            
                            // Measure text for background
                            ctx.font = '12px Arial';
                            const textWidth = ctx.measureText(labelText).width;
                            
                            // Draw background
                            ctx.fillStyle = 'white';
                            ctx.fillRect(labelX - 3, labelY - 12, textWidth + 6, 16);
                            
                            // Draw border in stroke color
                            ctx.strokeStyle = strokeColor;
                            ctx.lineWidth = 1;
                            ctx.strokeRect(labelX - 3, labelY - 12, textWidth + 6, 16);
                            
                            // Draw text in stroke color
                            ctx.fillStyle = strokeColor;
                            ctx.fillText(labelText, labelX, labelY);
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

        // Remove oldest state if we've reached max history
        if (undoStackByImage[currentImageLabel].length >= MAX_HISTORY) {
            undoStackByImage[currentImageLabel].shift();
        }

        // For line strokes, assign the next label before saving
        let strokeLabel = null;
        if (!isDrawingOrPasting && !strokeInProgress && incrementLabel) {
            strokeLabel = labelsByImage[currentImageLabel];
            labelsByImage[currentImageLabel] = getNextLabel(currentImageLabel);
            lineStrokesByImage[currentImageLabel].push(strokeLabel);
            
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
            
            // Store vector data for the stroke - crucial for proper scaling and movement
            vectorStrokesByImage[currentImageLabel] = vectorStrokesByImage[currentImageLabel] || {};
            
            // Get image scale and position
            const imageScale = imageScaleByLabel[currentImageLabel];
            
            // Calculate the image position on the canvas
            let imageX = 0, imageY = 0;
            
            if (originalImageDimensions[currentImageLabel].width > 0) {
                // Calculate base position (center of canvas)
                const centerX = (canvas.width - originalImageDimensions[currentImageLabel].width * imageScale) / 2;
                const centerY = (canvas.height - originalImageDimensions[currentImageLabel].height * imageScale) / 2;
                
                // Apply position offset
                const offsetX = imagePositionByLabel[currentImageLabel].x;
                const offsetY = imagePositionByLabel[currentImageLabel].y;
                
                // Calculate final position
                imageX = centerX + offsetX;
                imageY = centerY + offsetY;
            }
            
            // Convert all points to be relative to the image
            const relativePoints = points.map(point => {
                return {
                    x: (point.x - imageX) / imageScale,
                    y: (point.y - imageY) / imageScale,
                    time: point.time
                };
            });
            
            // Store the vector data with relative coordinates
            vectorStrokesByImage[currentImageLabel][strokeLabel] = {
                points: relativePoints,
                color: colorPicker.value,
                width: parseInt(brushSize.value)
            };
        }

        // Save the completed stroke
        undoStackByImage[currentImageLabel].push({
            state: cloneImageData(currentState),
            type: isDrawingOrPasting ? 'image' : 'line',
            label: strokeLabel,
            color: colorPicker.value // Store the current color
        });

        // Clear redo stack when a new action is performed
        redoStackByImage[currentImageLabel] = [];

        imageStates[currentImageLabel] = cloneImageData(currentState);
        currentStroke = cloneImageData(currentState);
        updateStrokeCounter();
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
            
            if (lastAction.type === 'line') {
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
                }
                
                // Set the next label to be the one we just removed
                if (lastAction.label) {
                    labelsByImage[currentImageLabel] = lastAction.label;
                    console.log(`Reset label counter to: ${lastAction.label}`);
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
            updateSidebarStrokeCounts();
        } else if (currentStack && currentStack.length === 1) {
            // We're at the initial state
            console.log('At initial state, resetting workspace');
            const initialState = currentStack[0];
            if (initialState && initialState.state) {
                imageStates[currentImageLabel] = cloneImageData(initialState.state);
                restoreCanvasState(initialState.state);
                currentStroke = cloneImageData(initialState.state);
            } else if (originalImages[currentImageLabel]) {
                // If we have the original image, redraw it
                console.log('Redrawing from original image');
                const img = new Image();
                img.onload = () => {
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    const x = (canvas.width - img.width) / 2;
                    const y = (canvas.height - img.height) / 2;
                    ctx.drawImage(img, x, y);
                    
                    // Save this new state
                    const newState = getCanvasState();
                    imageStates[currentImageLabel] = cloneImageData(newState);
                    currentStroke = cloneImageData(newState);
                };
                img.src = originalImages[currentImageLabel];
            }
            
            // Reset stroke tracking
            lineStrokesByImage[currentImageLabel] = [];  // Clear line labels
            labelsByImage[currentImageLabel] = 'A1';  // Reset label counter to A1
            updateStrokeCounter();
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
            
            // Skip certain state types when redoing
            if (actionToRedo.type === 'pre-stroke' || actionToRedo.type === 'snapshot') {
                console.log(`Skipping ${actionToRedo.type} state`);
                // Skip these types and continue to next redo action if possible
                if (redoStack.length > 0) {
                    return redo();
                }
                return;
            }
            
            // Add back to undo stack
            undoStackByImage[currentImageLabel].push(actionToRedo);
            
            // Handle line type actions
            if (actionToRedo.type === 'line' && actionToRedo.label) {
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
                
                // Update the next label
                labelsByImage[currentImageLabel] = getNextLabel(currentImageLabel);
                console.log(`Set next label to: ${labelsByImage[currentImageLabel]}`);
            }
            
            // Restore the state
            if (actionToRedo.state) {
                const stateToRestore = cloneImageData(actionToRedo.state);
                imageStates[currentImageLabel] = stateToRestore;
                restoreCanvasState(stateToRestore);
                currentStroke = cloneImageData(stateToRestore);
                console.log('Canvas state restored for redo');
            }
            
            updateStrokeCounter();
            updateSidebarStrokeCounts();
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
                if (originalImages[currentImageLabel]) {
                    const img = new Image();
                    img.onload = () => {
                        ctx.clearRect(0, 0, canvas.width, canvas.height);
                        const x = (canvas.width - img.width) / 2;
                        const y = (canvas.height - img.height) / 2;
                        ctx.drawImage(img, x, y);
                        
                        // Redraw any strokes if needed
                        // This would require storing stroke data separately
                        
                        // Save this new state
                        const newState = getCanvasState();
                        imageStates[currentImageLabel] = cloneImageData(newState);
                        currentStroke = cloneImageData(newState);
                    };
                    img.src = originalImages[currentImageLabel];
                }
            }
        } else if (!currentStroke) {
            // Initialize blank state if needed
            currentStroke = getCanvasState();
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

    // Drawing functions
    let lastDrawnPoint = null;

    function interpolatePoints(p1, p2) {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const numPoints = Math.max(Math.ceil(distance / 2), 1); // More frequent interpolation
        
        const points = [];
        for (let i = 0; i <= numPoints; i++) {
            points.push({
                x: p1.x + (dx * i) / numPoints,
                y: p1.y + (dy * i) / numPoints,
                time: p1.time + ((p2.time - p1.time) * i) / numPoints
            });
        }
        return points;
    }

    function draw(e) {
        // Only draw if we're in drawing mode
        if (!isDrawing) return;
        
        // Make sure we have points to work with
        if (points.length === 0) {
            // If no points exist, add the current point as the first one
            const firstPoint = {
                x: e.offsetX,
                y: e.offsetY,
                time: Date.now()
            };
            points.push(firstPoint);
            lastDrawnPoint = firstPoint;
            
            // Draw a dot for the first point
            ctx.beginPath();
            ctx.arc(e.offsetX, e.offsetY, parseInt(brushSize.value) / 2, 0, Math.PI * 2);
            ctx.fillStyle = colorPicker.value;
            ctx.fill();
            return;
        }

        const currentPoint = {
            x: e.offsetX,
            y: e.offsetY,
            time: Date.now()
        };

        // Calculate velocity for dynamic line width
        const prevPoint = points[points.length - 1];
        const distance = Math.sqrt(
            Math.pow(currentPoint.x - prevPoint.x, 2) +
            Math.pow(currentPoint.y - prevPoint.y, 2)
        );
        const timeDiff = currentPoint.time - prevPoint.time || 1;
        const velocity = distance / timeDiff;

        // Smooth out velocity changes
        const smoothedVelocity = velocity * 0.2 + (lastVelocity || 0) * 0.8;
        lastVelocity = smoothedVelocity;

        // Calculate dynamic width based on velocity
        // Faster = thinner, slower = thicker, with limits
        const baseWidth = parseInt(brushSize.value);
        const velocityFactor = Math.max(0.4, Math.min(1.2, 1 - smoothedVelocity * 0.1));
        const dynamicWidth = baseWidth * velocityFactor;

        // Add point to array
        points.push(currentPoint);

        // Always start from the last drawn point
        ctx.beginPath();
        if (lastDrawnPoint) {
            ctx.moveTo(lastDrawnPoint.x, lastDrawnPoint.y);
        } else {
            ctx.moveTo(prevPoint.x, prevPoint.y);
        }

        // Draw the line segments
        for (let i = Math.max(0, points.length - 3); i < points.length; i++) {
            const point = points[i];
            if (i === 0 || !points[i - 1]) {
                ctx.lineTo(point.x, point.y);
            } else {
                const prev = points[i - 1];
                const mid = {
                    x: (prev.x + point.x) / 2,
                    y: (prev.y + point.y) / 2
                };
                ctx.quadraticCurveTo(prev.x, prev.y, mid.x, mid.y);
            }
        }

        // Connect to the current point
        ctx.lineTo(currentPoint.x, currentPoint.y);

        // Set drawing styles
        ctx.strokeStyle = colorPicker.value;
        ctx.lineWidth = dynamicWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();

        lastDrawnPoint = currentPoint;
    }

    // Mouse drag variables for image movement
    let isDraggingImage = false;
    let lastMouseX = 0;
    let lastMouseY = 0;
    
    // Mouse event listeners
    canvas.addEventListener('mousedown', (e) => {
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
        
        // Add first point
        const firstPoint = {
            x: e.offsetX,
            y: e.offsetY,
            time: Date.now()
        };
        points.push(firstPoint);
        lastDrawnPoint = firstPoint;
        
        // Draw a dot at the start point (important for single clicks)
        ctx.beginPath();
        ctx.arc(e.offsetX, e.offsetY, parseInt(brushSize.value) / 2, 0, Math.PI * 2);
        ctx.fillStyle = colorPicker.value;
        ctx.fill();
    });
    
    canvas.addEventListener('mousemove', (e) => {
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
        
        // Normal drawing if not dragging image
        if (isDrawing) {
            draw(e);
        }
    });
    
    canvas.addEventListener('mouseup', (e) => {
        if (isDraggingImage) {
            isDraggingImage = false;
            canvas.style.cursor = isShiftPressed ? 'grab' : 'crosshair';
            return;
        }
        
        if (isDrawing) {
            isDrawing = false;
            isDrawingOrPasting = false;
            strokeInProgress = false;
            // Save state immediately after stroke completion and increment label
            saveState(true, true);
            // Force redraw to show labels immediately
            redrawCanvasWithVisibility();
        }
    });
    
    canvas.addEventListener('mouseout', () => {
        if (isDraggingImage) {
            isDraggingImage = false;
            canvas.style.cursor = isShiftPressed ? 'grab' : 'crosshair';
            return;
        }
        
        if (isDrawing) {
            isDrawing = false;
            isDrawingOrPasting = false;
            strokeInProgress = false;
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
        } else if (originalImages[label]) {
            // If no state exists but we have the original image, paste it
            console.log(`No state exists for ${label}, pasting original image`);
            pasteImageFromUrl(originalImages[label]);
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
                // Force redraw by restoring current state
                if (imageStates[currentImageLabel]) {
                    restoreCanvasState(imageStates[currentImageLabel]);
                }
                // Update visibility controls after redo
                updateStrokeVisibilityControls();
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
        
        // Instead of just clearing the canvas, redraw the original image if available
        if (originalImages[currentImageLabel]) {
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
                if (!originalImages[label]) {
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
                originalImages[label] = url;
                
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
                    if (!originalImages[availableLabel]) {
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
                originalImages[label] = url;
                
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
                break;
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
        if (!originalImages[currentImageLabel]) {
            console.log('No image to scale');
            return;
        }
        
        // Update scale for current image
        const oldScale = imageScaleByLabel[currentImageLabel];
        imageScaleByLabel[currentImageLabel] = newScale;
        
        // Redraw the image with the new scale
        const img = new Image();
        img.onload = () => {
            // Save the current state before redrawing
            const previousState = getCanvasState();
            undoStackByImage[currentImageLabel].push({
                state: cloneImageData(previousState),
                type: 'scale',
                label: null
            });
            
            // Clear the canvas
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            // Calculate the scaled dimensions
            const originalWidth = originalImageDimensions[currentImageLabel].width;
            const originalHeight = originalImageDimensions[currentImageLabel].height;
            const scaledWidth = originalWidth * newScale;
            const scaledHeight = originalHeight * newScale;
            
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
                scaleElement.textContent = `Scale: ${Math.round(newScale * 100)}%`;
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
        if (!originalImages[currentImageLabel]) {
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
});
