// Stroke Metadata Manager
// Handles attaching labels, measurements, visibility flags to Fabric objects

export class StrokeMetadataManager {
  constructor() {
    // Mirror legacy data structures for compatibility
    this.vectorStrokesByImage = {};
    this.strokeVisibilityByImage = {};
    this.strokeLabelVisibility = {};
    this.strokeMeasurements = {};
    this.customLabelPositions = {};
    this.calculatedLabelOffsets = {};
  }

  // Attach metadata to a Fabric object
  attachMetadata(obj, imageLabel, strokeLabel) {
    if (!obj) return;

    // Store reference in legacy structure
    if (!this.vectorStrokesByImage[imageLabel]) {
      this.vectorStrokesByImage[imageLabel] = {};
    }
    this.vectorStrokesByImage[imageLabel][strokeLabel] = obj;
    console.log(
      `[StrokeMetadata] Stored ${strokeLabel} in vectorStrokesByImage[${imageLabel}], type=${obj.type}`
    );

    // Also update legacy window.lineStrokesByImage for tag prediction system compatibility
    window.lineStrokesByImage = window.lineStrokesByImage || {};
    if (!window.lineStrokesByImage[imageLabel]) {
      window.lineStrokesByImage[imageLabel] = [];
    }
    // Add stroke label to array if not already present
    if (!window.lineStrokesByImage[imageLabel].includes(strokeLabel)) {
      window.lineStrokesByImage[imageLabel].push(strokeLabel);
    }

    // Store metadata directly on Fabric object
    obj.strokeMetadata = {
      imageLabel: imageLabel,
      strokeLabel: strokeLabel,
      visible: true,
      labelVisible: true,
    };

    // Initialize visibility maps
    if (!this.strokeVisibilityByImage[imageLabel]) {
      this.strokeVisibilityByImage[imageLabel] = {};
    }
    if (!this.strokeLabelVisibility[imageLabel]) {
      this.strokeLabelVisibility[imageLabel] = {};
    }

    this.strokeVisibilityByImage[imageLabel][strokeLabel] = true;
    this.strokeLabelVisibility[imageLabel][strokeLabel] = true;

    // Update visibility controls when new stroke is added
    setTimeout(() => {
      // Ensure the stroke elements panel is expanded
      const elementsBody = document.getElementById('elementsBody');
      if (elementsBody && elementsBody.classList.contains('hidden')) {
        elementsBody.classList.remove('hidden');
        elementsBody.style.maxHeight = 'none';

        // Update toggle button icon
        const toggleBtn = document.getElementById('toggleStrokePanel');
        if (toggleBtn) {
          const svg = toggleBtn.querySelector('svg path');
          if (svg) {
            svg.setAttribute('d', 'M19 9l-7 7-7-7'); // Down arrow
          }
        }
      }

      this.updateStrokeVisibilityControls();
    }, 50);

    // Set flag to auto-focus measurement input for this new stroke
    this._shouldAutoFocus = true;
  }

  // Get metadata for an object
  getMetadata(obj) {
    return obj.strokeMetadata || null;
  }

  // Set visibility for a stroke
  setStrokeVisibility(imageLabel, strokeLabel, visible) {
    if (!this.strokeVisibilityByImage[imageLabel]) {
      this.strokeVisibilityByImage[imageLabel] = {};
    }
    this.strokeVisibilityByImage[imageLabel][strokeLabel] = visible;

    // Update Fabric object if it exists
    const obj = this.vectorStrokesByImage[imageLabel]?.[strokeLabel];
    if (obj) {
      obj.visible = visible;
      obj.strokeMetadata.visible = visible;
    }
  }

  // Set label visibility for a stroke
  setLabelVisibility(imageLabel, strokeLabel, visible) {
    if (!this.strokeLabelVisibility[imageLabel]) {
      this.strokeLabelVisibility[imageLabel] = {};
    }
    this.strokeLabelVisibility[imageLabel][strokeLabel] = visible;

    // Update Fabric object if it exists
    const obj = this.vectorStrokesByImage[imageLabel]?.[strokeLabel];
    if (obj && obj.strokeMetadata) {
      obj.strokeMetadata.labelVisible = visible;
    }
  }

  // Set measurement for a stroke
  // Expects measurement object with structure: {inchWhole: number, inchFraction: number, cm: number}
  setMeasurement(imageLabel, strokeLabel, measurement) {
    if (!this.strokeMeasurements[imageLabel]) {
      this.strokeMeasurements[imageLabel] = {};
    }

    // Validate measurement structure
    if (measurement && typeof measurement === 'object') {
      // Ensure proper structure
      const validatedMeasurement = {
        inchWhole: typeof measurement.inchWhole === 'number' ? measurement.inchWhole : 0,
        inchFraction: typeof measurement.inchFraction === 'number' ? measurement.inchFraction : 0,
        cm: typeof measurement.cm === 'number' ? measurement.cm : 0,
      };
      this.strokeMeasurements[imageLabel][strokeLabel] = validatedMeasurement;
    } else {
      this.strokeMeasurements[imageLabel][strokeLabel] = measurement;
    }

    // Update UI after setting measurement
    this.updateStrokeVisibilityControls();
  }

  // Get measurement for a stroke
  // Returns measurement object: {inchWhole: number, inchFraction: number, cm: number} or null
  getMeasurement(imageLabel, strokeLabel) {
    return this.strokeMeasurements[imageLabel]?.[strokeLabel] || null;
  }

  // Generate next label (A1, A2, B1, etc.) - integrates with tag prediction system
  getNextLabel(imageLabel, mode = 'letters+numbers') {
    // First, try to use the tag prediction system from index.html
    if (window.calculateNextTag) {
      try {
        const tag = window.calculateNextTag();
        if (tag && this.isValidTag(tag, mode)) {
          // Use the predicted tag and update the display
          this.updateTagPredictionAfterUse(imageLabel, tag);
          return tag;
        }
      } catch (e) {
        console.warn('Error calling calculateNextTag:', e);
      }
    }

    // Fallback: check nextTagDisplay directly
    const nextTagDisplay = document.getElementById('nextTagDisplay');
    if (nextTagDisplay) {
      const tag = nextTagDisplay.textContent.trim().toUpperCase();
      if (tag && this.isValidTag(tag, mode)) {
        // Use the predicted tag and update the display
        this.updateTagPredictionAfterUse(imageLabel, tag);
        return tag;
      }
    }

    // Fallback: calculate next tag
    const existing = Object.keys(this.vectorStrokesByImage[imageLabel] || {});

    if (mode === 'letters') {
      // Letters only mode
      if (existing.length === 0) return 'A';

      const letters = existing
        .filter(label => /^[A-Z]$/.test(label))
        .map(label => label.charCodeAt(0))
        .sort((a, b) => a - b);

      if (letters.length === 0) return 'A';

      // Find first gap or next letter
      for (let i = 0; i < 26; i++) {
        const letterCode = 65 + i; // A = 65
        if (!letters.includes(letterCode)) {
          return String.fromCharCode(letterCode);
        }
      }
      return String.fromCharCode(letters[letters.length - 1] + 1);
    } else {
      // Letters + numbers mode
      if (existing.length === 0) return 'A1';

      // Find highest label
      let maxNum = 0;
      let maxLetter = 'A';

      existing.forEach(label => {
        const match = label.match(/^([A-Z])(\d+)$/);
        if (match) {
          const letter = match[1];
          const num = parseInt(match[2], 10);
          if (num > maxNum || (num === maxNum && letter > maxLetter)) {
            maxNum = num;
            maxLetter = letter;
          }
        }
      });

      // Increment
      if (maxNum < 99) {
        return `${maxLetter}${maxNum + 1}`;
      } else {
        // Move to next letter
        const nextLetter = String.fromCharCode(maxLetter.charCodeAt(0) + 1);
        return `${nextLetter}1`;
      }
    }
  }

  isValidTag(tag, mode = 'letters+numbers') {
    if (mode === 'letters') {
      return /^[A-Z]$/.test(tag);
    } else {
      return /^[A-Z]\d+$/.test(tag);
    }
  }

  // Update tag prediction after a tag is used
  updateTagPredictionAfterUse(imageLabel, usedTag) {
    // Update the global labelsByImage to track the used tag
    window.labelsByImage = window.labelsByImage || {};
    window.labelsByImage[imageLabel] = usedTag;

    // Ensure lineStrokesByImage is updated for tag prediction
    window.lineStrokesByImage = window.lineStrokesByImage || {};
    if (!window.lineStrokesByImage[imageLabel]) {
      window.lineStrokesByImage[imageLabel] = [];
    }
    if (!window.lineStrokesByImage[imageLabel].includes(usedTag)) {
      window.lineStrokesByImage[imageLabel].push(usedTag);
    }

    // Update currentImageLabel for tag prediction system
    window.currentImageLabel = imageLabel;

    // Update the next tag display
    if (window.updateNextTagDisplay) {
      window.updateNextTagDisplay();
    } else {
      // Fallback: calculate and update manually
      const nextTagDisplay = document.getElementById('nextTagDisplay');
      if (nextTagDisplay && window.calculateNextTag) {
        const nextTag = window.calculateNextTag();
        nextTagDisplay.textContent = nextTag;
      }
    }
  }

  // Focus the measurement input for a specific stroke (called when clicking tags)
  // Focus the measurement input for a specific stroke (called when clicking tags)
  focusMeasurementInput(strokeLabel) {
    // Find the measurement span for this stroke
    const strokesList = document.getElementById('strokesList');
    if (!strokesList) return;

    const strokeItems = strokesList.querySelectorAll('.stroke-visibility-item');

    for (const item of strokeItems) {
      if (item.dataset.stroke === strokeLabel) {
        const measurementSpan = item.querySelector('.stroke-measurement');
        if (measurementSpan) {
          // Ensure panel is visible
          const elementsBody = document.getElementById('elementsBody');
          if (elementsBody && elementsBody.classList.contains('hidden')) {
            elementsBody.classList.remove('hidden');
            elementsBody.style.maxHeight = 'none';
          }

          // Scroll to the stroke item
          item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

          // Enable editing
          setTimeout(() => {
            const originalValue = measurementSpan.textContent;
            measurementSpan.contentEditable = 'true';
            measurementSpan.focus();

            // Select all text
            const range = document.createRange();
            range.selectNodeContents(measurementSpan);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
          }, 100);
        }
        break;
      }
    }
  }

  // Update the stroke visibility controls panel
  updateStrokeVisibilityControls() {
    console.log('[StrokeMetadata] updateStrokeVisibilityControls called');
    const controlsContainer = document.getElementById('strokeVisibilityControls');
    if (!controlsContainer) {
      console.warn('[StrokeMetadata] strokeVisibilityControls container not found!');
      return;
    }

    // Set flag to prevent infinite loop with MutationObserver
    this.isUpdatingControls = true;

    // Setup MutationObserver if not already done
    if (!this.controlsObserver) {
      this.controlsObserver = new MutationObserver(mutations => {
        if (!this.isUpdatingControls) {
          // Ignore mutations from contentEditable elements (user typing in measurement field)
          const isEditableChange = mutations.some(mutation => {
            let node = mutation.target;
            while (node && node !== controlsContainer) {
              if (node.contentEditable === 'true') return true;
              node = node.parentNode;
            }
            return false;
          });

          if (!isEditableChange) {
            // If change was not triggered by us (e.g. legacy code), re-apply our UI
            // Debounce to avoid rapid updates
            if (this.observerTimer) clearTimeout(this.observerTimer);
            this.observerTimer = setTimeout(() => {
              this.updateStrokeVisibilityControls();
            }, 50);
          }
        }
      });
      this.controlsObserver.observe(controlsContainer, { childList: true, subtree: true });
    }

    const currentViewId = window.app?.projectManager?.currentViewId || 'front';
    const strokes = this.vectorStrokesByImage[currentViewId] || {};
    console.log(
      `[StrokeMetadata] vectorStrokesByImage[${currentViewId}]:`,
      Object.keys(strokes),
      strokes
    );

    // Create strokesList container if it doesn't exist
    let strokesList = controlsContainer.querySelector('#strokesList');
    if (!strokesList) {
      controlsContainer.innerHTML = '<div id="strokesList"></div>';
      strokesList = controlsContainer.querySelector('#strokesList');
    } else {
      strokesList.innerHTML = '';
    }

    // Add text elements header
    const textHeader = document.createElement('h4');
    textHeader.style.margin = '10px 0px 6px';
    textHeader.style.fontSize = '13px';
    textHeader.style.color = 'rgb(71, 85, 105)';
    textHeader.textContent = 'Text Elements';
    strokesList.appendChild(textHeader);

    const noTextMsg = document.createElement('p');
    noTextMsg.style.margin = '0px 0px 8px';
    noTextMsg.textContent = 'No text elements';
    strokesList.appendChild(noTextMsg);

    const hr = document.createElement('hr');
    hr.style.margin = '10px 0px';
    strokesList.appendChild(hr);

    // If no strokes, just show text elements section
    if (Object.keys(strokes).length === 0) {
      controlsContainer.style.display = 'block';
      setTimeout(() => {
        this.isUpdatingControls = false;
      }, 0);
      return;
    }

    controlsContainer.style.display = 'block';

    // Add controls for each stroke
    Object.entries(strokes).forEach(([strokeLabel, strokeObj]) => {
      const strokeItem = document.createElement('div');
      strokeItem.className = 'stroke-visibility-item group';
      strokeItem.dataset.stroke = strokeLabel;
      strokeItem.dataset.selected = 'false';
      strokeItem.dataset.editMode = 'false';
      strokeItem.style.position = 'relative';

      // Checkbox
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = `visibility-${strokeLabel}`;
      const strokeVisible = this.strokeVisibilityByImage[currentViewId]?.[strokeLabel] !== false;
      checkbox.checked = strokeVisible;

      checkbox.addEventListener('change', e => {
        const newVisibility = e.target.checked;
        this.setStrokeVisibility(currentViewId, strokeLabel, newVisibility);
        if (window.app?.tagManager) {
          window.app.tagManager.updateTagVisibility(strokeLabel, currentViewId, newVisibility);
        }
        if (window.app?.canvasManager?.fabricCanvas) {
          window.app.canvasManager.fabricCanvas.renderAll();
        }
      });

      strokeItem.appendChild(checkbox);

      // Label container
      const labelContainer = document.createElement('div');
      labelContainer.className = 'stroke-label-container';

      // Stroke name
      const strokeName = document.createElement('span');
      strokeName.className = 'stroke-name';
      strokeName.dataset.originalName = strokeLabel;
      strokeName.contentEditable = 'false';
      strokeName.title = 'Straight Line';
      strokeName.style.borderColor = 'rgb(59, 130, 246)';
      strokeName.style.color = 'rgb(59, 130, 246)';
      strokeName.textContent = strokeLabel;

      // Label toggle button (🏷️)
      const labelToggleBtn = document.createElement('button');
      labelToggleBtn.className = 'stroke-label-toggle-btn';
      const labelVisible = this.strokeLabelVisibility[currentViewId]?.[strokeLabel] !== false;
      labelToggleBtn.title = labelVisible ? 'Hide Label' : 'Show Label';
      labelToggleBtn.textContent = '🏷️';

      labelToggleBtn.addEventListener('click', () => {
        const newVisibility = !labelVisible;
        this.setLabelVisibility(currentViewId, strokeLabel, newVisibility);
        if (window.app?.tagManager) {
          window.app.tagManager.updateTagVisibility(strokeLabel, currentViewId, newVisibility);
        }
        this.updateStrokeVisibilityControls();
      });

      // Measurement display (contenteditable)
      const measurementSpan = document.createElement('span');
      measurementSpan.className = 'stroke-measurement';
      measurementSpan.title = 'Click to edit measurement';
      measurementSpan.contentEditable = 'false';
      measurementSpan.style.cursor = 'pointer';

      const measurementString = this.getMeasurementString(currentViewId, strokeLabel);

      if (measurementString) {
        measurementSpan.textContent = measurementString;
      } else {
        measurementSpan.textContent = '';
        measurementSpan.classList.add('empty-measurement');
      }

      // Click to edit measurement
      let originalMeasurement = '';
      measurementSpan.addEventListener('click', () => {
        if (measurementSpan.contentEditable === 'true') return; // Already editing

        originalMeasurement = measurementSpan.textContent;
        measurementSpan.classList.remove('empty-measurement');

        measurementSpan.contentEditable = 'true';
        measurementSpan.focus();

        // Select all text
        const range = document.createRange();
        range.selectNodeContents(measurementSpan);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      });

      measurementSpan.addEventListener('blur', () => {
        measurementSpan.contentEditable = 'false';
        const newValue = measurementSpan.textContent.trim();

        if (newValue !== originalMeasurement) {
          const success = this.parseAndSaveMeasurement(currentViewId, strokeLabel, newValue);
          if (!success) {
            // Restore original if parsing failed
            measurementSpan.textContent = originalMeasurement;
            if (!originalMeasurement) {
              measurementSpan.classList.add('empty-measurement');
            }
          }
        } else {
          // No change, restore empty class if it was empty
          if (!newValue) {
            measurementSpan.classList.add('empty-measurement');
          }
        }
      });

      measurementSpan.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          measurementSpan.blur();
        } else if (e.key === 'Escape') {
          measurementSpan.textContent = originalMeasurement;
          if (!originalMeasurement) {
            measurementSpan.classList.add('empty-measurement');
          }
          measurementSpan.blur();
        }
      });

      // Auto-focus this measurement field if it's the newest stroke (just added)
      // We'll check if this is the last stroke in the list
      const allStrokes = Object.keys(strokes);
      const isNewestStroke = allStrokes[allStrokes.length - 1] === strokeLabel;

      console.log(
        `[Auto-Focus DEBUG] Stroke: ${strokeLabel}, isNewest: ${isNewestStroke}, shouldAutoFocus: ${this._shouldAutoFocus}`
      );

      // Auto-focus logic removed to allow immediate deletion via keyboard
      if (isNewestStroke && this._shouldAutoFocus) {
        this._shouldAutoFocus = false;
      }

      // Review toggle button (★)
      const reviewBtn = document.createElement('button');
      reviewBtn.className = 'stroke-review-toggle-btn';
      reviewBtn.title = 'Mark for review';
      reviewBtn.style.fontSize = '14px';
      reviewBtn.style.padding = '2px 6px';
      reviewBtn.style.borderRadius = '3px';
      reviewBtn.style.border = 'none';
      reviewBtn.style.cursor = 'pointer';
      reviewBtn.style.transition = '0.2s';
      reviewBtn.textContent = '★';

      // Delete button (×)
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'delete-image-btn opacity-0 group-hover:opacity-100 transition-opacity';
      deleteBtn.title = 'Delete this stroke';
      // Removed absolute positioning
      deleteBtn.style.cursor = 'pointer';
      deleteBtn.style.background = 'rgba(255, 255, 255, 0.9)';
      deleteBtn.style.border = '1px solid rgb(204, 204, 204)';
      deleteBtn.style.borderRadius = '50%';
      deleteBtn.style.width = '20px';
      deleteBtn.style.height = '20px';
      deleteBtn.style.fontSize = '12px';
      deleteBtn.style.fontWeight = 'bold';
      deleteBtn.style.fontFamily = 'Arial, sans-serif';
      deleteBtn.style.display = 'flex';
      deleteBtn.style.alignItems = 'center';
      deleteBtn.style.justifyContent = 'center';
      deleteBtn.style.color = 'rgb(102, 102, 102)';
      deleteBtn.style.lineHeight = '1';
      deleteBtn.style.padding = '0px';
      deleteBtn.style.margin = '0px 0px 0px 4px'; // Add left margin
      deleteBtn.style.textAlign = 'center';
      deleteBtn.textContent = '×';

      // Add all elements to label container
      labelContainer.appendChild(strokeName);
      labelContainer.appendChild(labelToggleBtn);
      labelContainer.appendChild(measurementSpan);
      labelContainer.appendChild(reviewBtn);
      labelContainer.appendChild(deleteBtn); // Append delete button here

      strokeItem.appendChild(labelContainer);
      // Removed appending deleteBtn to strokeItem

      deleteBtn.addEventListener('click', () => {
        // Delete stroke from canvas
        if (window.app?.canvasManager?.fabricCanvas) {
          window.app.canvasManager.fabricCanvas.remove(strokeObj);
        }

        // Remove from metadata
        if (this.vectorStrokesByImage[currentViewId]) {
          delete this.vectorStrokesByImage[currentViewId][strokeLabel];
        }
        if (this.strokeVisibilityByImage[currentViewId]) {
          delete this.strokeVisibilityByImage[currentViewId][strokeLabel];
        }
        if (this.strokeLabelVisibility[currentViewId]) {
          delete this.strokeLabelVisibility[currentViewId][strokeLabel];
        }
        if (this.strokeMeasurements[currentViewId]) {
          delete this.strokeMeasurements[currentViewId][strokeLabel];
        }

        // Remove tag
        if (window.app?.tagManager) {
          window.app.tagManager.removeTag(strokeLabel);
        }

        // Refresh UI
        this.updateStrokeVisibilityControls();
        if (window.app?.canvasManager?.fabricCanvas) {
          window.app.canvasManager.fabricCanvas.renderAll();
        }
      });

      strokeItem.appendChild(deleteBtn);
      strokesList.appendChild(strokeItem);
    });

    // Reset flag after update
    setTimeout(() => {
      this.isUpdatingControls = false;
    }, 0);
  }

  // Clear metadata for an image
  clearImageMetadata(imageLabel) {
    delete this.vectorStrokesByImage[imageLabel];
    delete this.strokeVisibilityByImage[imageLabel];
    delete this.strokeLabelVisibility[imageLabel];
    delete this.strokeMeasurements[imageLabel];
    delete this.customLabelPositions[imageLabel];
    delete this.calculatedLabelOffsets[imageLabel];

    // Update controls after clearing
    this.updateStrokeVisibilityControls();
  }
  // Helper to find closest 1/8th fraction
  findClosestFraction(fraction) {
    const eighths = Math.round(fraction * 8);
    return eighths / 8;
  }

  // Parse and save measurement string
  // Returns true if update occurred, false otherwise
  parseAndSaveMeasurement(imageLabel, strokeLabel, newString) {
    let successfullyParsedAndSaved = false;

    if (!newString && newString !== '0') {
      // Allow "0" to clear/reset measurement
      if (this.strokeMeasurements[imageLabel] && this.strokeMeasurements[imageLabel][strokeLabel]) {
        delete this.strokeMeasurements[imageLabel][strokeLabel];
        successfullyParsedAndSaved = true;
      } else {
        return false;
      }
    } else {
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
          explicitUnitMatched = true;
        }
      }

      if (totalInches === null) {
        const meterRegex = /^\s*([\d.]+)\s*(m|meter|meters)\s*$/i;
        const mmRegex = /^\s*([\d.]+)\s*(mm|millimeter|millimeters)\s*$/i;
        const feetRegex = /^\s*([\d.]+)\s*(ft|foot|feet|')\s*$/i;
        const yardRegex = /^\s*([\d.]+)\s*(yd|yard|yards)\s*$/i;
        const inchRegex = /^\s*(\d+)?(?:\s*(\d+\/\d+|[.\d]+))?\s*(\"|in|inch|inches)\s*$/i;
        const inchMatchWithMarker = newString.match(inchRegex);

        const meterMatch = newString.match(meterRegex);
        const mmMatch = newString.match(mmRegex);
        const feetMatch = newString.match(feetRegex);
        const yardMatch = newString.match(yardRegex);

        if (meterMatch && meterMatch[1]) {
          totalInches = parseFloat(meterMatch[1]) * 39.3701;
          explicitUnitMatched = true;
        } else if (mmMatch && mmMatch[1]) {
          totalInches = parseFloat(mmMatch[1]) / 25.4;
          explicitUnitMatched = true;
        } else if (feetMatch && feetMatch[1]) {
          totalInches = parseFloat(feetMatch[1]) * 12;
          explicitUnitMatched = true;
        } else if (yardMatch && yardMatch[1]) {
          totalInches = parseFloat(yardMatch[1]) * 36;
          explicitUnitMatched = true;
        } else if (inchMatchWithMarker && (inchMatchWithMarker[1] || inchMatchWithMarker[2])) {
          explicitUnitMatched = true;
          let wholeInches = 0;
          let fractionalPart = 0;
          if (inchMatchWithMarker[1]) {
            wholeInches = parseInt(inchMatchWithMarker[1], 10);
          }
          if (inchMatchWithMarker[2]) {
            if (inchMatchWithMarker[2].includes('/')) {
              const parts = inchMatchWithMarker[2].split('/');
              if (
                parts.length === 2 &&
                !isNaN(parseInt(parts[0], 10)) &&
                parseInt(parts[1], 10) !== 0
              ) {
                fractionalPart = parseInt(parts[0], 10) / parseInt(parts[1], 10);
              } else {
                totalInches = NaN;
              }
            } else {
              fractionalPart = parseFloat(inchMatchWithMarker[2]);
            }
          }
          if (!isNaN(totalInches)) {
            totalInches = wholeInches + fractionalPart;
          }
        }
      }

      // Fallback: if no explicit unit marker, try to parse as plain number based on current unit
      if (totalInches === null && !explicitUnitMatched) {
        const plainNumber = parseFloat(newString);
        if (!isNaN(plainNumber)) {
          const currentUnit = window.app?.currentUnit || 'inch';
          if (currentUnit === 'inch') {
            totalInches = plainNumber;
          } else {
            totalCm = plainNumber;
            totalInches = totalCm / 2.54;
          }
        }
      }

      if (totalInches === null || isNaN(totalInches) || totalInches < 0) {
        console.warn(`Failed to parse "${newString}"`);
        return false;
      }

      const inchWhole = Math.floor(totalInches);
      const inchFraction = parseFloat((totalInches - inchWhole).toFixed(2));
      const finalCm = totalInches * 2.54;

      if (!this.strokeMeasurements[imageLabel]) {
        this.strokeMeasurements[imageLabel] = {};
      }
      this.strokeMeasurements[imageLabel][strokeLabel] = {
        inchWhole: inchWhole,
        inchFraction: inchFraction,
        cm: parseFloat(finalCm.toFixed(4)),
      };
      successfullyParsedAndSaved = true;
    }

    if (successfullyParsedAndSaved) {
      // Update UI
      this.updateStrokeVisibilityControls();

      // Notify TagManager to update tag text
      if (window.app?.tagManager) {
        window.app.tagManager.updateTagText(strokeLabel, imageLabel);
      }

      return true;
    }
    return false;
  }

  // Refresh all measurement displays (e.g., when units change)
  refreshAllMeasurements() {
    // Refresh sidebar UI
    this.updateStrokeVisibilityControls();

    // Refresh all tag texts on canvas
    if (window.app?.tagManager) {
      const currentViewId = window.app?.projectManager?.currentViewId || 'front';
      const strokes = this.vectorStrokesByImage[currentViewId] || {};

      Object.keys(strokes).forEach(strokeLabel => {
        window.app.tagManager.updateTagText(strokeLabel, currentViewId);
      });
    }
  }

  // Get formatted measurement string
  getMeasurementString(imageLabel, strokeLabel) {
    const measurement = this.getMeasurement(imageLabel, strokeLabel);
    if (!measurement) return '';

    const unit = window.app?.currentUnit || 'inch';

    if (unit === 'inch') {
      const whole = measurement.inchWhole || 0;
      const fraction = measurement.inchFraction || 0;

      // Don't display zero measurements
      if (whole === 0 && fraction === 0) {
        return '';
      }

      let fractionStr = '';
      if (fraction > 0) {
        const rounded = this.findClosestFraction(fraction);
        const fractionMap = {
          0.125: '1/8',
          0.25: '1/4',
          0.375: '3/8',
          0.5: '1/2',
          0.625: '5/8',
          0.75: '3/4',
          0.875: '7/8',
        };
        if (fractionMap[rounded]) {
          fractionStr = ' ' + fractionMap[rounded];
        }
      }

      return `${whole}${fractionStr}"`;
    } else {
      const cm = measurement.cm || 0;

      // Don't display zero measurements
      if (cm === 0) {
        return '';
      }

      return `${cm.toFixed(1)} cm`;
    }
  }
}
