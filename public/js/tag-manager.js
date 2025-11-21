// Tag Manager for OpenPaint
// Handles the furniture/sofa tagging system

// console.log('TAG-MANAGER.JS LOADED - Version ' + new Date().toISOString());

// Define the tag hierarchy and conditions
window.TAG_MODEL = {
  // Category 0: Furniture Type (always shown)
  furnitureType: {
    id: 'furnitureType',
    name: 'Furniture Type',
    required: true, // At least one selection required
    type: 'checkbox', // MODIFIED: Allow multiple selections
    condition: null, // Always shown
    options: [
      { id: 'sofa', name: 'Sofa' },
      { id: 'ottoman', name: 'Ottoman' },
      { id: 'chaise', name: 'Chaise' },
      { id: 'cushionOnly', name: 'Cushion Only' },
      { id: 'diningChair', name: 'Dining Chair' }
    ]
  },
    
  // Category 1: View Type (always shown)
  viewType: {
    id: 'viewType',
    name: 'View Type',
    required: true, // At least one selection required
    type: 'radio', // Only one selection allowed
    condition: null, // Always shown
    options: [
      { id: 'front', name: 'Front' },
      { id: 'back', name: 'Back' },
      { id: 'side', name: 'Side' },
      { id: 'arm', name: 'Arm' },
      { id: 'ear', name: 'Ear' },
      { id: 'top', name: 'Top' },
      { id: 'angle', name: 'Angle' },
      { id: 'seatBack', name: 'Seat Back' },
      { id: 'blank', name: 'Blank' }
    ]
  },
    
  // Category 2: Cushion Type (MODIFIED condition and options)
  cushionType: {
    id: 'cushionType',
    name: 'Cushion Type',
    required: false,
    type: 'radio',
    condition: { category: 'furnitureType', value: 'cushionOnly', type: 'checkbox' }, // MODIFIED
    options: [
      { id: 'rectangleSquare', name: 'Rectangle/Square' }, // MODIFIED: Replaced 'boxed'
      { id: 'lShaped', name: 'L-Shaped' },
      { id: 'tShaped', name: 'T-Shaped' }
    ]
  },
    
  // Category 3: Arm Type (MODIFIED condition for Sofa->Side)
  armType: {
    id: 'armType',
    name: 'Arm Type',
    required: false,
    type: 'radio',
    condition: { // MODIFIED: Sofa AND Side view
      conjunction: 'AND',
      conditions: [
        { category: 'furnitureType', value: 'sofa', type: 'checkbox' }, // furnitureType is now checkbox
        { category: 'viewType', value: 'side' }
      ]
    },
    options: [
      { id: 'armless', name: 'Armless' },
      { id: 'barrel', name: 'Barrel' },
      { id: 'belgianRolled', name: 'Belgian Rolled' },
      { id: 'bullet', name: 'Bullet' },
      { id: 'englishRolled', name: 'English Rolled' },
      { id: 'finSlope', name: 'Fin Slope' },
      { id: 'flare', name: 'Flare' },
      { id: 'key', name: 'Key' },
      { id: 'nose', name: 'Nose' },
      { id: 'round', name: 'Round' },
      { id: 'roundedCorner', name: 'Rounded Corner' },
      { id: 'slope', name: 'Slope' },
      { id: 'square', name: 'Square' },
      { id: 'thinKnifeEdge', name: 'Thin (Knife Edge)' },
      { id: 'trackSlope', name: 'Track Slope' },
      { id: 'wedge', name: 'Wedge' },
      { id: 'squareArm', name: 'Square Arm' }
    ]
  },
    
  // Category 4: Back Type (shown only if Back is selected in viewType)
  backType: {
    id: 'backType',
    name: 'Back Type',
    required: false,
    type: 'radio',
    condition: { category: 'viewType', value: 'back' },
    options: [
      { id: 'armless', name: 'Armless' },
      { id: 'barrel', name: 'Barrel' },
      { id: 'high', name: 'High' },
      { id: 'roll', name: 'Roll' },
      { id: 'round', name: 'Round' },
      { id: 'sectional', name: 'Sectional' },
      { id: 'short', name: 'Short' },
      { id: 'thinKnifeEdge', name: 'Thin (Knife Edge)' },
      { id: 'wing', name: 'Wing' }
    ]
  },
    
  // Category 5: Seat Back Type (shown only if Seat Back is selected in viewType)
  seatBackType: {
    id: 'seatBackType',
    name: 'Seat Back Type',
    required: false,
    type: 'radio',
    condition: { category: 'viewType', value: 'seatBack' },
    options: [
      { id: 'curved', name: 'Curved' },
      { id: 'straight', name: 'Straight' },
      { id: 'wedged', name: 'Wedged' }
    ]
  },
    
  // Category 6: Cushion Style (shown only if Cushion is selected in viewType)
  cushionStyle: {
    id: 'cushionStyle',
    name: 'Cushion Style',
    required: false,
    type: 'radio',
    condition: { category: 'furnitureType', value: 'cushionOnly' },
    options: [
      { id: 'bolster', name: 'Bolster' },
      { id: 'boxed', name: 'Boxed' },
      { id: 'cornerCushion', name: 'Corner Cushion' },
      { id: 'halfKnife', name: 'Half Knife' },
      { id: 'halfWedge', name: 'Half Wedge' },
      { id: 'hexagon', name: 'Hexagon' },
      { id: 'knife', name: 'Knife' },
      { id: 'oval', name: 'Oval' },
      { id: 'round', name: 'Round' },
      { id: 'rounded', name: 'Rounded' },
      { id: 'wedge', name: 'Wedge' }
    ]
  },
    
  // Category 7: Ottoman Style (shown only if Ottoman is selected in furnitureType)
  ottomanStyle: {
    id: 'ottomanStyle',
    name: 'Ottoman Style',
    required: false,
    type: 'radio',
    condition: { category: 'furnitureType', value: 'ottoman' },
    options: [
      { id: 'onePieceSnug', name: '1-piece Snug' },
      { id: 'twoPieceSkirt', name: '2-piece Skirt' },
      { id: 'longSkirt', name: 'Long Skirt' },
      { id: 'round', name: 'Round' }
    ]
  },
    
  // Category 8: Dining Chair Style (shown only if Dining Chair is selected in furnitureType)
  diningChairStyle: {
    id: 'diningChairStyle',
    name: 'Dining Chair Style',
    required: false,
    type: 'radio',
    condition: { category: 'furnitureType', value: 'diningChair' },
    options: [
      { id: 'cornerPleats', name: 'Corner Pleats' },
      { id: 'midSkirt', name: 'Mid-skirt' },
      { id: 'snug', name: 'Snug' },
      { id: 'squareArm', name: 'Square Arm' }
    ]
  },

  // NEW Category: Cushion Detail
  cushionDetail: {
    id: 'cushionDetail',
    name: 'Cushion Detail',
    required: false,
    type: 'radio',
    condition: {
      conjunction: 'AND',
      conditions: [
        { category: 'furnitureType', value: 'cushionOnly', type: 'checkbox' },
        { category: 'cushionUse', value: 'seat', type: 'checkbox' }
      ]
    },
    options: [
      { id: 'big', name: 'Big' },
      { id: 'medium', name: 'Medium' },
      { id: 'small', name: 'Small' }
    ]
  },

  // NEW Category: Cushion Use
  cushionUse: {
    id: 'cushionUse',
    name: 'Cushion Use',
    required: false,
    type: 'checkbox', // Allow multiple selections
    condition: { category: 'furnitureType', value: 'cushionOnly', type: 'checkbox' }, // MODIFIED
    options: [
      { id: 'seat', name: 'Seat' },
      { id: 'back', name: 'Back' },
      { id: 'accent', name: 'Accent' }
    ]
  }
};

// Order of categories to display
window.TAG_CATEGORY_ORDER = [
  'furnitureType',
  'cushionUse',
  'viewType',
  'ottomanStyle',
  'diningChairStyle',
  'armType',
  'backType',
  'seatBackType',
  'cushionType',
  'cushionStyle',
  'cushionDetail'
];

// Initialize the global image tags object if it doesn't exist
window.imageTags = window.imageTags || {};

// Function to get visible categories based on current selections
function getVisibleCategories(selections) {
  if (!selections) return ['furnitureType', 'viewType']; // Default categories
    
  // Always show furniture type and view type
  const visibleCategories = ['furnitureType', 'viewType'];
    
  // Check each category to see if its condition is met
  for (const categoryId of window.TAG_CATEGORY_ORDER) {
    // Skip the two base categories which are always visible
    if (categoryId === 'furnitureType' || categoryId === 'viewType') {
      continue;
    }

    const category = window.TAG_MODEL[categoryId];
    if (!category) continue; // Should not happen if TAG_MODEL and TAG_CATEGORY_ORDER are in sync

    let conditionMet = !category.condition; // If no condition, it's met

    if (category.condition) {
      if (category.condition.conjunction === 'AND') {
        conditionMet = true; // Assume true, set to false if any sub-condition fails
        for (const subCondition of category.condition.conditions) {
          const selectedValue = selections[subCondition.category];
          if (subCondition.type === 'checkbox') {
            // For checkboxes, selectedValue must be an array including the condition value
            if (!Array.isArray(selectedValue) || !selectedValue.includes(subCondition.value)) {
              conditionMet = false;
              break;
            }
          } else {
            // For radio/select, selectedValue must match exactly
            if (selectedValue !== subCondition.value) {
              conditionMet = false;
              break;
            }
          }
        }
      } else {
        // Original single condition logic (radio/select based)
        const selectedValue = selections[category.condition.category];
        if (category.condition.type === 'checkbox') { // Though single conditions for checkboxes are less common now
          conditionMet = Array.isArray(selectedValue) && selectedValue.includes(category.condition.value);
        } else {
          conditionMet = selectedValue === category.condition.value;
        }
      }
    }
        
    if (conditionMet) {
      visibleCategories.push(categoryId);
    }
  }
    
  return visibleCategories;
}

// Function to generate filename from tags
function generateFilenameFromTags(originalFilename, tags) {
  if (!tags || Object.keys(tags).length === 0) {
    return originalFilename; // No tags, return original filename
  }
    
  // Start with furniture type if available
  let parts = [];
    
  // Extract base name without extension
  const baseNameMatch = originalFilename.match(/^(.*?)(?:\.[^.]*)?$/);
  const baseName = baseNameMatch ? baseNameMatch[1] : originalFilename;
    
  // Extract extension if any
  const extensionMatch = originalFilename.match(/(\.[^.]*)$/);
  const extension = extensionMatch ? extensionMatch[1] : '';
    
  // Add furniture type
  if (tags.furnitureType) {
    parts.push(window.TAG_MODEL.furnitureType.options.find(opt => opt.id === tags.furnitureType)?.name || tags.furnitureType);
  }
    
  // Add view type
  if (tags.viewType) {
    parts.push(window.TAG_MODEL.viewType.options.find(opt => opt.id === tags.viewType)?.name || tags.viewType);
  }
    
  // Add conditional categories if they exist
  for (const categoryId of window.TAG_CATEGORY_ORDER.slice(2)) { // Skip furniture type and view type
    if (tags[categoryId]) {
      const category = window.TAG_MODEL[categoryId];
      const option = category.options.find(opt => opt.id === tags[categoryId]);
      if (option) {
        parts.push(option.name);
      }
    }
  }
    
  // Combine parts with underscores and add original name
  const tagPrefix = parts.join('_');
    
  // Only add original name if it's not just a number (likely an auto-generated name)
  const finalName = /^\d+$/.test(baseName) ? tagPrefix : `${tagPrefix}_${baseName}`;
    
  return finalName + extension;
}

// Export functions to the window object for use in other scripts
window.getVisibleCategories = getVisibleCategories;
window.generateFilenameFromTags = generateFilenameFromTags;

// Function to get a readable tag name
window.getTagDisplayName = function(categoryId, tagId) {
  if (!window.TAG_MODEL[categoryId]) return tagId;
    
  const option = window.TAG_MODEL[categoryId].options.find(opt => opt.id === tagId);
  return option ? option.name : tagId;
};

// Function to create a tag selection dialog
window.createTagSelectionDialog = function(imageLabel, existingTags, onSave) {
  // Create overlay div to block interactions with the rest of the page
  const overlay = document.createElement('div');
  overlay.className = 'tag-dialog-overlay';
  document.body.appendChild(overlay);
    
  // Create base dialog
  const dialog = document.createElement('div');
  dialog.className = 'tag-dialog';
  dialog.innerHTML = `
        <div class="tag-dialog-header">
            <h3>Image Tags for ${imageLabel}</h3>
            <button class="tag-dialog-close">✖</button>
        </div>
        <div class="tag-dialog-content">
            <div class="tag-categories"></div>
        </div>
        <div class="tag-dialog-footer">
            <button class="tag-dialog-save">Save Tags</button>
            <button class="tag-dialog-cancel">Cancel</button>
            <button class="tag-dialog-clear-all">Clear All Tags</button>
        </div>
    `;
  document.body.appendChild(dialog);
    
  // Get content container
  const categoriesContainer = dialog.querySelector('.tag-categories');
    
  // Close button handler
  const closeButton = dialog.querySelector('.tag-dialog-close');
  const cancelButton = dialog.querySelector('.tag-dialog-cancel');
  const clearAllButton = dialog.querySelector('.tag-dialog-clear-all');
  closeButton.addEventListener('click', closeDialog);
  cancelButton.addEventListener('click', closeDialog);
  clearAllButton.addEventListener('click', () => {
    for (const key in selections) {
      delete selections[key];
    }
    // console.log('[Tag Dialog] Cleared all selections.');
    renderCategories();
  });
    
  // Save button
  const saveButton = dialog.querySelector('.tag-dialog-save');
    
  // Clone existing tags or create new ones
  const selections = existingTags ? JSON.parse(JSON.stringify(existingTags)) : {};
    
  // Get initial visible categories
  const visibleCategories = getVisibleCategories(selections);
    
  // Function to render tag categories
  function renderCategories() {
    // Clear container
    categoriesContainer.innerHTML = '';
        
    // Get updated visible categories based on current selections
    const visibleCategories = window.getVisibleCategories(selections);
        
    // Create form groups for each visible category
    for (const categoryId of window.TAG_CATEGORY_ORDER) {
      const category = window.TAG_MODEL[categoryId];
            
      // Skip non-visible categories
      if (!visibleCategories.includes(categoryId)) continue;
            
      // Create category container
      const categoryContainer = document.createElement('div');
      categoryContainer.className = 'tag-category';
      categoryContainer.innerHTML = `
                <div class="tag-category-header">
                    <h4>${category.name}</h4>
                    ${category.required ? '<span class="required">*</span>' : ''}
                </div>
                <div class="tag-category-options" data-category="${categoryId}"></div>
            `;
            
      // Add to main container
      categoriesContainer.appendChild(categoryContainer);
            
      // Get options container
      const optionsContainer = categoryContainer.querySelector('.tag-category-options');
            
      // MODIFICATION: Filter viewType options if 'Cushion Only' is selected for furnitureType
      let currentOptions = category.options;
      if (categoryId === 'viewType' && Array.isArray(selections.furnitureType) && selections.furnitureType.includes('cushionOnly')) {
        const allowedViewTypes = ['top', 'angle', 'side'];
        currentOptions = category.options.filter(opt => allowedViewTypes.includes(opt.id));
      }
      // END MODIFICATION

      // Render options based on type
      if (category.type === 'radio') {
        // For radio buttons (single selection)
        currentOptions.forEach(option => {
          const optionContainer = document.createElement('div');
          optionContainer.className = 'tag-option';
                    
          const radioId = `${categoryId}-${option.id}`;
                    
          optionContainer.innerHTML = `
                        <input type="radio" id="${radioId}" name="${categoryId}" value="${option.id}" 
                            ${selections[categoryId] === option.id ? 'checked' : ''}>
                        <label for="${radioId}">${option.name}</label>
                    `;
                    
          // Add to options
          optionsContainer.appendChild(optionContainer);
                    
          // Add change listener
          const radioInput = optionContainer.querySelector('input');
          radioInput.addEventListener('change', function() {
            if (this.checked) {
              selections[categoryId] = option.id;
              // console.log(`[Tag Dialog] Selected ${category.name}: ${option.name}`);
                            
              // Re-render categories for conditional logic
              renderCategories();
            }
          });
        });
      } else if (category.type === 'checkbox') {
        // For checkboxes (multiple selection)
        currentOptions.forEach(option => {
          const optionContainer = document.createElement('div');
          optionContainer.className = 'tag-option';
                    
          const checkboxId = `${categoryId}-${option.id}`;
          const isChecked = Array.isArray(selections[categoryId]) && 
                                     selections[categoryId].includes(option.id);
                    
          optionContainer.innerHTML = `
                        <input type="checkbox" id="${checkboxId}" name="${categoryId}" value="${option.id}" 
                            ${isChecked ? 'checked' : ''}>
                        <label for="${checkboxId}">${option.name}</label>
                    `;
                    
          // Add to options
          optionsContainer.appendChild(optionContainer);
                    
          // Add change listener
          const checkboxInput = optionContainer.querySelector('input');
          checkboxInput.addEventListener('change', function() {
            // Initialize as array if needed
            if (!selections[categoryId] || !Array.isArray(selections[categoryId])) {
              selections[categoryId] = [];
            }
                        
            if (this.checked) {
              // Add to selections if not already there
              if (!selections[categoryId].includes(option.id)) {
                selections[categoryId].push(option.id);
              }
            } else {
              // Remove from selections
              selections[categoryId] = selections[categoryId].filter(id => id !== option.id);
              // If the array becomes empty, delete the key to reflect no selection for this category
              if (selections[categoryId].length === 0) {
                delete selections[categoryId];
              }
            }
                        
            // console.log(`[Tag Dialog] Updated ${category.name}:`, selections[categoryId]);
                        
            // Re-render categories for conditional logic
            renderCategories();
          });
        });
      } else {
        // Default to simple select
        const selectElement = document.createElement('select');
        selectElement.className = 'tag-select';
        selectElement.name = categoryId;
                
        // Add placeholder option if not required
        if (!category.required) {
          const placeholderOption = document.createElement('option');
          placeholderOption.value = '';
          placeholderOption.textContent = 'Select...';
          placeholderOption.selected = !selections[categoryId];
          selectElement.appendChild(placeholderOption);
        }
                
        // Add options
        currentOptions.forEach(option => {
          const optionElement = document.createElement('option');
          optionElement.value = option.id;
          optionElement.textContent = option.name;
          optionElement.selected = selections[categoryId] === option.id;
          selectElement.appendChild(optionElement);
        });
                
        // Add to container
        optionsContainer.appendChild(selectElement);
                
        // Add change listener
        selectElement.addEventListener('change', function() {
          if (this.value) {
            selections[categoryId] = this.value;
          } else {
            delete selections[categoryId];
          }
          // console.log(`[Tag Dialog] Selected ${category.name}: ${this.options[this.selectedIndex].text}`);
                    
          // Re-render categories for conditional logic
          renderCategories();
        });
      }
    }
  }
    
  // Handle save button click
  saveButton.addEventListener('click', () => {
    // Validate that required selections are made
    let isValid = true;
    let missingCategories = [];
        
    // Get the currently visible categories based on the current selections
    const visibleCategories = window.getVisibleCategories(selections);
        
    for (const categoryId of window.TAG_CATEGORY_ORDER) {
      const category = window.TAG_MODEL[categoryId];
      // Skip non-visible categories
      if (!visibleCategories.includes(categoryId)) continue;
            
      // Check if required selection is missing
      if (category.required && !selections[categoryId]) {
        isValid = false;
        missingCategories.push(category.name);
      }
    }
        
    if (!isValid) {
      alert(`Please select required fields: ${missingCategories.join(', ')}`);
      return;
    }
        
    // Save selections
    // console.log(`[Tag Dialog] Saving tags for ${imageLabel}:`, selections);
        
    // Run callback with selections
    if (typeof onSave === 'function') {
      onSave(selections);
    }
        
    // Close dialog
    closeDialog();
  });
    
  function closeDialog() {
    document.body.removeChild(dialog);
    document.body.removeChild(overlay);
  }
    
  // Initial render of categories
  renderCategories();
    
  // Return dialog for external manipulation if needed
  return {
    dialog,
    overlay,
    close: closeDialog
  };
};

// Function to show tag dialog from sidebar
window.showTagDialogForImage = function(imageLabel, callback) {
  // Get existing tags or default
  const existingTags = window.imageTags[imageLabel] || {};
    
  // Create dialog
  window.createTagSelectionDialog(imageLabel, existingTags, (newTags) => {
    // Save tags
    window.imageTags[imageLabel] = newTags;
        
    // Update display name in sidebar ONLY if no custom name is set
    const labelElement = document.querySelector(`.image-container[data-label="${imageLabel}"] .image-label`);
    if (labelElement) {
      // Check if there's a custom name - if so, preserve it
      const hasCustomName = window.customImageNames && window.customImageNames[imageLabel];
            
      if (!hasCustomName) {
        // Update to tag-based name only if no custom name exists
        if (labelElement._updateDisplay) {
          labelElement._updateDisplay();
        } else {
          // Fallback for older elements
          const filename = getTagBasedFilename(imageLabel, imageLabel.split('_')[0]);
          const newText = filename ? filename.charAt(0).toUpperCase() + filename.slice(1) : imageLabel;
          labelElement.textContent = newText;
        }
      }
    }
    // Silently skip if label element doesn't exist (e.g., default labels without images, or during reordering)
        
    // Call the callback if provided (for updating display from paint.js)
    if (callback && typeof callback === 'function') {
      callback();
    }
  });
};

// Initialize tags for standard images
document.addEventListener('DOMContentLoaded', () => {
  function initializeCoreTagData() {
    // Ensure critical global variables from paint.js are ready
    if (typeof window.IMAGE_LABELS === 'undefined' || 
            typeof window.imageTags === 'undefined' || 
            typeof window.currentImageLabel === 'undefined') {
      console.warn('[TAG-MANAGER] Core paint.js globals (IMAGE_LABELS, imageTags, currentImageLabel) not ready, retrying in 100ms...');
      setTimeout(initializeCoreTagData, 100);
      return;
    }
    console.log('[TAG-MANAGER] Core paint.js globals are ready.');

    // Initialize with default tags if none exist for the standard labels
    window.IMAGE_LABELS.forEach(label => {
      if (!window.imageTags[label]) {
        window.imageTags[label] = {
          furnitureType: 'sofa', // Default to sofa
          viewType: label // Use the label as the view type
        };
      }
    });
    console.log('[TAG-MANAGER] Default tags initialized for standard labels.');

    // Now that core data is ready, set up UI-dependent parts
    initializeTagUI();
  }

  function initializeTagUI() {
    // Add tag button functionality
    const addTagsButton = document.getElementById('addTags');
    if (addTagsButton) {
      addTagsButton.addEventListener('click', () => {
        const currentLabel = window.currentImageLabel;
        if (!currentLabel) {
          console.error('[TAG-MANAGER] currentImageLabel is not defined when trying to add tags.');
          return;
        }
        const existingTags = window.imageTags[currentLabel] || {};
        window.createTagSelectionDialog(currentLabel, existingTags, (newTags) => {
          window.imageTags[currentLabel] = newTags;
          updateTagsDisplay(currentLabel); // This function also needs to be robust
          // console.log(`[TAG-MANAGER] Updated tags for ${currentLabel}:`, newTags);
        });
      });
    } else {
      console.log('[TAG-MANAGER] addTags button not found (removed from UI).');
    }

    // Attempt to hook into addImageToSidebar from paint.js
    attemptHookToAddImageToSidebar();
    // Initial call to display tags for any images already loaded by paint.js
    addTagButtonsToImages(); 
  }

  function addTagButtonsToImages() {
    if (typeof window.IMAGE_LABELS === 'undefined') { // Redundant check, but safe
      console.warn('[TAG-MANAGER] addTagButtonsToImages: window.IMAGE_LABELS not ready, deferring.');
      setTimeout(addTagButtonsToImages, 200);
      return;
    }
    const imageContainers = document.querySelectorAll('.image-container');
    imageContainers.forEach(container => {
      const label = container.dataset.label;
      if (!label) return;
      if (!container.querySelector('.image-tags')) {
        const tagsContainer = document.createElement('div');
        tagsContainer.className = 'image-tags';
        tagsContainer.dataset.label = label;
        container.appendChild(tagsContainer);
      }
      updateTagsDisplay(label);
    });
  }

  function updateTagsDisplay(label) {
    // Check if core objects are ready
    if (
      typeof window.imageTags === 'undefined' || 
            !window.imageTags[label] // Ensure tags for this specific label exist
    ) {
      console.warn(`[TAG-MANAGER] updateTagsDisplay: Critical objects not ready for label ${label}, deferring.`);
      setTimeout(() => updateTagsDisplay(label), 200);
      return;
    }

    // console.log(`[updateTagsDisplay] Looking for label element and tags container with selector: .image-container[data-label="${label}"]`);
        
    // Find the label element in the sidebar
    const container = document.querySelector(`.image-container[data-label="${label}"]`);
        
    if (!container) {
      console.warn(`[updateTagsDisplay] Could not find container for label: ${label}`);
      return; 
    }
        
    // Remove tag controls (edit/focus) — no longer used

    // Update the label text
    const labelElement = container.querySelector('.image-label');
    if (labelElement) {
      const tagText = generateFilenameFromTags(label, window.imageTags[label]);
      labelElement.textContent = tagText;
      // console.log(`[updateTagsDisplay] Updated label text for ${label} to: ${tagText}`);
    }
    // Silently skip if label element doesn't exist (e.g., default labels without images, or during reordering)
  }

  function showEditDialog(label) {
    // console.log(`[showEditDialog] Showing edit dialog for ${label}`);
        
    // Show tag dialog if it exists
    if (window.showTagDialogForImage) {
      window.showTagDialogForImage(label);
    } else {
      console.error('[showEditDialog] showTagDialogForImage function not found!');
      alert('Tag editing functionality is not available.');
    }
  }

  function enterFocusMode(label) {
    // console.log(`[enterFocusMode] Entering focus mode for label: ${label}`);

    const imageLabelBeforeSwitch = window.currentImageLabel;
    let selectionOfTargetImageBeforeFocus = [];

    // Store the selection of the image that is *about to be focused* if it's already loaded
    // This is so we can restore its specific selection later.
    if (typeof window.multipleSelectedStrokesByImage === 'object' && window.multipleSelectedStrokesByImage[label]) {
      selectionOfTargetImageBeforeFocus = [...window.multipleSelectedStrokesByImage[label]];
    }

    window.preFocusState = {
      imageLabelToRestoreTo: imageLabelBeforeSwitch,      // The image that was active *before* focus mode started on 'label'
      selectionToRestoreOnTarget: selectionOfTargetImageBeforeFocus, // The selection 'label' had *before* we selected all its strokes
      focusedImageLabel: label                            // The image that is now in focus
    };
    // console.log(`[enterFocusMode] Stored preFocusState:`, JSON.parse(JSON.stringify(window.preFocusState)));

    // Switch to the clicked image (if not already active)
    if (typeof window.switchToImage === 'function' && window.currentImageLabel !== label) {
      // console.log(`[enterFocusMode] Switching to image: ${label}`);
      window.switchToImage(label); // This sets window.currentImageLabel to label
    } else if (window.currentImageLabel !== label) {
      console.warn(`[enterFocusMode] window.switchToImage is not a function, cannot switch to image: ${label}. Focus may not work as expected.`);
      return; 
    }
    // At this point, window.currentImageLabel should be === label

    // Select all strokes for the target image `label`
    if (typeof window.lineStrokesByImage === 'object' && window.lineStrokesByImage[label]) {
      const strokesToSelect = [...window.lineStrokesByImage[label]];
      if (typeof window.multipleSelectedStrokesByImage === 'object') {
        window.multipleSelectedStrokesByImage[label] = strokesToSelect;
        // console.log(`[enterFocusMode] Set multipleSelectedStrokesByImage for ${label} to:`, strokesToSelect);
      }
      if (typeof window.selectedStrokeByImage === 'object') {
        window.selectedStrokeByImage[label] = strokesToSelect.length === 1 ? strokesToSelect[0] : null;
      }
      if (typeof window.selectedStrokeInEditMode !== 'undefined') {
        window.selectedStrokeInEditMode = null; // Exit any stroke-specific edit mode
      }
    } else {
      console.warn(`[enterFocusMode] lineStrokesByImage not available for label: ${label}. Clearing selection.`);
      if (typeof window.multipleSelectedStrokesByImage === 'object') window.multipleSelectedStrokesByImage[label] = [];
      if (typeof window.selectedStrokeByImage === 'object') window.selectedStrokeByImage[label] = null;
    }

    // Trigger UI Update in paint.js
    if (typeof window.redrawCanvasWithVisibility === 'function') {
      // console.log(`[enterFocusMode] Calling redrawCanvasWithVisibility for ${label}`);
      window.redrawCanvasWithVisibility();
    } else {
      console.warn('[enterFocusMode] window.redrawCanvasWithVisibility is not a function.');
    }
    if (typeof window.updateStrokeVisibilityControls === 'function') {
      // console.log(`[enterFocusMode] Calling updateStrokeVisibilityControls for ${label}`);
      window.updateStrokeVisibilityControls();
    } else {
      console.warn('[enterFocusMode] window.updateStrokeVisibilityControls is not a function.');
    }
        
    // Add a focus mode indicator to the UI
    const existingIndicator = document.querySelector('.focus-mode-indicator');
    if (existingIndicator) {
      existingIndicator.remove();
    }
        
    const focusIndicator = document.createElement('div');
    focusIndicator.className = 'focus-mode-indicator';
    focusIndicator.innerHTML = `
            <div style="position: fixed; top: 10px; right: 10px; background: rgba(0,0,0,0.7); color: white; padding: 8px; border-radius: 4px; z-index: 1000">
                Focus Mode: ${label} (ESC to exit)
            </div>
        `;
    document.body.appendChild(focusIndicator);
    // console.log(`[enterFocusMode] Added focus mode indicator to the DOM`);
        
    // Add ESC key handler for exiting focus mode
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        // console.log('[enterFocusMode] ESC key pressed, exiting focus mode');
        exitFocusMode();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
  }

  function exitFocusMode() {
    // console.log('[exitFocusMode] Exiting focus mode');
        
    const indicator = document.querySelector('.focus-mode-indicator');
    if (indicator) {
      indicator.remove();
      // console.log('[exitFocusMode] Removed focus mode indicator');
    } else {
      console.warn('[exitFocusMode] Focus mode indicator not found');
    }

    const state = window.preFocusState;
    if (!state) {
      console.warn('[exitFocusMode] No pre-focus state found.');
      // Minimal cleanup if something went wrong: ensure current image selection is cleared if it was somehow marked as focused
      const currentLabel = window.currentImageLabel;
      if (typeof window.multipleSelectedStrokesByImage === 'object' && window.multipleSelectedStrokesByImage[currentLabel]) {
        // Assuming focus mode means all strokes were selected, so on exit, clear this.
        window.multipleSelectedStrokesByImage[currentLabel] = [];
      }
      if (typeof window.selectedStrokeByImage === 'object') {
        window.selectedStrokeByImage[currentLabel] = null;
      }
      if (typeof window.redrawCanvasWithVisibility === 'function') window.redrawCanvasWithVisibility();
      if (typeof window.updateStrokeVisibilityControls === 'function') window.updateStrokeVisibilityControls();
      return;
    }

    const focusedLabel = state.focusedImageLabel; // The image that was in focus (e.g., 'front_1')
    const originalSelectionOnFocusedImage = state.selectionToRestoreOnTarget; // The selection 'front_1' had *before* focus
    const imageToSwitchBackTo = state.imageLabelToRestoreTo; // The image that was active *before* 'front_1' was focused

    // 1. Restore original selection on the image that WAS focused.
    // This should happen whether we switch back to another image or if 'focusedLabel' was already 'imageToSwitchBackTo'.
    if (typeof window.multipleSelectedStrokesByImage === 'object') {
      window.multipleSelectedStrokesByImage[focusedLabel] = originalSelectionOnFocusedImage ? [...originalSelectionOnFocusedImage] : [];
    }
    if (typeof window.selectedStrokeByImage === 'object') {
      window.selectedStrokeByImage[focusedLabel] = (originalSelectionOnFocusedImage && originalSelectionOnFocusedImage.length === 1) ? originalSelectionOnFocusedImage[0] : null;
    }
    // console.log(`[exitFocusMode] Restored selection on previously focused image ${focusedLabel} to:`, originalSelectionOnFocusedImage);

    // 2. Switch back to the image that was active before focus mode began, if it's different from the one that was focused.
    //    And if the one that was focused is still the current one.
    if (typeof window.switchToImage === 'function' && window.currentImageLabel === focusedLabel && focusedLabel !== imageToSwitchBackTo) {
      // console.log(`[exitFocusMode] Switching back to originally active image: ${imageToSwitchBackTo}`);
      window.switchToImage(imageToSwitchBackTo);
      // After switchToImage, window.currentImageLabel is imageToSwitchBackTo.
      // Its selection state should be inherently correct from its own history or how switchToImage loads it.
    } else if (window.currentImageLabel !== focusedLabel && window.currentImageLabel !== imageToSwitchBackTo) {
      // This means the user manually switched away from the focused image.
      // We should still switch back to the *original* image before focus mode started.
      if (typeof window.switchToImage === 'function' && window.currentImageLabel !== imageToSwitchBackTo) {
        // console.log(`[exitFocusMode] User manually switched. Switching back to original image: ${imageToSwitchBackTo}`);
        window.switchToImage(imageToSwitchBackTo);
      }
    }
    // If focusedLabel === imageToSwitchBackTo, no switch is needed. The selection on it has been restored.
    // If switchToImage is not a function, we can't switch, selection on focusedLabel is restored.

    window.preFocusState = null;

    // Trigger UI Update (will apply to the now window.currentImageLabel)
    if (typeof window.redrawCanvasWithVisibility === 'function') {
      window.redrawCanvasWithVisibility();
    } else {
      console.warn('[exitFocusMode] window.redrawCanvasWithVisibility is not a function.');
    }
    if (typeof window.updateStrokeVisibilityControls === 'function') {
      window.updateStrokeVisibilityControls();
    } else {
      console.warn('[exitFocusMode] window.updateStrokeVisibilityControls is not a function.');
    }
        
    // The escHandler should have removed itself.
    // console.log('[exitFocusMode] Focus mode exited.');
  }

  function attemptHookToAddImageToSidebar() {
    if (typeof window.addImageToSidebar === 'function') {
      const originalAddImageToSidebar = window.addImageToSidebar;
      if (originalAddImageToSidebar.isHookedByTagManager) {
        console.log('[TAG-MANAGER] addImageToSidebar already hooked.');
        return;
      }
            
      // Check if this is the paint.js version (not the compatibility layer)
      if (originalAddImageToSidebar.toString().includes('image-container') || 
                originalAddImageToSidebar.toString().includes('dataset.label')) {
                
        window.addImageToSidebar = function(imageUrl, label, filename) {
          const result = originalAddImageToSidebar(imageUrl, label, filename);
          setTimeout(() => {
            // Ensure imageTags for the new label is initialized before updating display
            if (!window.imageTags[label]) {
              const baseLabel = label.split('_')[0];
              window.imageTags[label] = {
                furnitureType: 'sofa', 
                viewType: baseLabel 
              };
              console.log(`[TAG-MANAGER hooked addImageToSidebar] Initialized tags for new image ${label}`);
            }
            updateTagsDisplay(label);
          }, 150); 
          return result;
        };
        window.addImageToSidebar.isHookedByTagManager = true; // Mark as hooked
        console.log('[TAG-MANAGER] Successfully hooked into window.addImageToSidebar.');
                
        // After hooking, refresh tags for any images that might have been added before the hook was ready
        setTimeout(() => {
          console.log('[TAG-MANAGER] Post-hook refresh of tags for existing images.');
          addTagButtonsToImages();
        }, 600);
                
        // Mark tag manager as ready
        if (window.AppInit) {
          window.AppInit.markReady('tagManager');
        }
      } else {
        console.log('[TAG-MANAGER] Found compatibility layer addImageToSidebar, waiting for paint.js version...');
        setTimeout(attemptHookToAddImageToSidebar, 100);
      }
    } else {
      console.warn('[TAG-MANAGER] window.addImageToSidebar not ready for hooking, retrying...');
      setTimeout(attemptHookToAddImageToSidebar, 200);
    }
  }
    
  // Add a timeout to prevent infinite retries
  let hookTimeout = setTimeout(() => {
    console.error('[TAG-MANAGER] Failed to hook addImageToSidebar after 10 seconds. Tag functionality may be limited.');
  }, 10000);
    
  // Clear timeout if hook succeeds
  const originalAttemptHook = attemptHookToAddImageToSidebar;
  attemptHookToAddImageToSidebar = function() {
    const result = originalAttemptHook.apply(this, arguments);
    if (window.addImageToSidebar && window.addImageToSidebar.isHookedByTagManager) {
      clearTimeout(hookTimeout);
    }
    return result;
  };

  let hooked = false;

  function waitFor(cond, timeout = 10000, interval = 50) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const id = setInterval(() => {
        if (cond()) { clearInterval(id); resolve(); }
        else if (Date.now() - start > timeout) { clearInterval(id); reject(new Error('timeout')); }
      }, interval);
    });
  }

  function doHook(detail) {
    if (hooked) return;
    const addImageToSidebar = detail?.addImageToSidebar || window.addImageToSidebar;
    if (typeof addImageToSidebar === 'function') {
      // Start tag initialization
      console.log('[TAG-MANAGER] Hooked successfully');
      initializeCoreTagData();
      hooked = true;
    }
  }

  window.addEventListener('paint:ready', (evt) => doHook(evt.detail));

  /* Safety net if event fired before listener registered */
  waitFor(() => typeof window.addImageToSidebar === 'function')
    .then(() => window.dispatchEvent(new CustomEvent('paint:ready', {
      detail: { addImageToSidebar: window.addImageToSidebar,
        calculateNextTagFrom: window.calculateNextTagFrom }
    })))
    .catch(() => console.warn('[TAG-MANAGER] fallback wait timed out'));
});

// Function to generate a filename from tags
window.getTagBasedFilename = function(imageLabel, fallbackName) {
  // Get the tags for this image
  const tags = window.imageTags[imageLabel];
    
  // If no tags, use fallback
  if (!tags || Object.keys(tags).length === 0) {
    return fallbackName || imageLabel;
  }
    
  // Start building filename parts
  const parts = [];
    
  // Add furniture type if present
  if (tags.furnitureType) {
    const furnitureTypeIds = Array.isArray(tags.furnitureType) ? tags.furnitureType : [tags.furnitureType];
    const furnitureTypeNames = furnitureTypeIds.map(id => {
      const option = window.TAG_MODEL.furnitureType.options.find(opt => opt.id === id);
      return option ? option.name : id;
    }).filter(name => name); // Filter out any undefined names if an ID wasn't found

    if (furnitureTypeNames.length > 0) {
      parts.push(furnitureTypeNames.join(', '));
    }
  }
    
  // Add view type if present
  if (tags.viewType) {
    const viewType = window.TAG_MODEL.viewType.options.find(opt => opt.id === tags.viewType);
    if (viewType) {
      parts.push(viewType.name);
    }
  }
    
  // Add cushion type if present
  if (tags.cushionType) {
    const cushionType = window.TAG_MODEL.cushionType.options.find(opt => opt.id === tags.cushionType);
    if (cushionType) {
      parts.push(cushionType.name + ' Cushion');
    }
  }
    
  // Add arm type if present
  if (tags.armType) {
    const armType = window.TAG_MODEL.armType.options.find(opt => opt.id === tags.armType);
    if (armType) {
      parts.push(armType.name + ' Arm');
    }
  }
    
  // Add back type if present
  if (tags.backType) {
    const backType = window.TAG_MODEL.backType.options.find(opt => opt.id === tags.backType);
    if (backType) {
      parts.push(backType.name + ' Back');
    }
  }
    
  // Add seat back type if present
  if (tags.seatBackType) {
    const seatBackType = window.TAG_MODEL.seatBackType.options.find(opt => opt.id === tags.seatBackType);
    if (seatBackType) {
      parts.push(seatBackType.name + ' Seat Back');
    }
  }
    
  // Add dining chair type if present
  if (tags.diningChairType) {
    const diningChairType = window.TAG_MODEL.diningChairType.options.find(opt => opt.id === tags.diningChairType);
    if (diningChairType) {
      parts.push(diningChairType.name);
    }
  }
    
  // Add ottoman type if present
  if (tags.ottomanType) {
    const ottomanType = window.TAG_MODEL.ottomanType.options.find(opt => opt.id === tags.ottomanType);
    if (ottomanType) {
      parts.push(ottomanType.name);
    }
  }
    
  // If we have parts, join them and return
  if (parts.length > 0) {
    return parts.join(' - ');
  }
    
  // Fallback to the base name if no tags were used
  return fallbackName || imageLabel;
};

// PERFORMANCE FIX: Simplified initialization without polling
(function() {
  // Ensure updateTagsDisplay is globally available
  if (typeof window.updateTagsDisplay !== 'function' && typeof updateTagsDisplay === 'function') {
    window.updateTagsDisplay = updateTagsDisplay;
  }

  // Simplified catch-up refresh mechanism
  function performCatchupRefresh() {
    if (Array.isArray(window.__pendingTagRefresh) && typeof window.updateTagsDisplay === 'function') {
      console.log('[TAG-MANAGER] Performing catch-up refresh for', window.__pendingTagRefresh.length, 'labels');
      window.__pendingTagRefresh.forEach(label => {
        if (window.imageTags && window.imageTags[label]) {
          try { 
            window.updateTagsDisplay(label); 
          } catch (e) {
            console.warn(`[TAG-MANAGER] Error in catch-up refresh for ${label}:`, e);
          }
        }
      });
      window.__pendingTagRefresh = null;
    }
  }

  // Single initialization point - no polling
  function initializeTagManager() {
    if (typeof window.updateTagsDisplay === 'function') {
      performCatchupRefresh();
    } else {
      // Wait for paint.js to load using requestIdleCallback
      if (window.requestIdleCallback) {
        requestIdleCallback(() => {
          if (typeof window.updateTagsDisplay === 'function') {
            performCatchupRefresh();
          }
        }, { timeout: 2000 });
      } else {
        setTimeout(() => {
          if (typeof window.updateTagsDisplay === 'function') {
            performCatchupRefresh();
          }
        }, 1000);
      }
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeTagManager);
  } else {
    initializeTagManager();
  }
})(); 