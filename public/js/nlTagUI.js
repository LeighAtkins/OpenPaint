/**
 * Natural Language Tagging UI Component
 * Provides input box, chip preview, and keyboard shortcuts for sofa tagging
 */

(function() {
  'use strict';

  let recentCombos = [];
  const MAX_RECENT_COMBOS = 5;

  /**
   * Load recent combos from localStorage
   */
  function loadRecentCombos() {
    try {
      const stored = localStorage.getItem('nlTagRecentCombos');
      if (stored) {
        recentCombos = JSON.parse(stored);
      }
    } catch (e) {
      console.warn('[NL Tag UI] Failed to load recent combos:', e);
      recentCombos = [];
    }
  }

  /**
   * Save recent combos to localStorage
   */
  function saveRecentCombos() {
    try {
      localStorage.setItem('nlTagRecentCombos', JSON.stringify(recentCombos));
    } catch (e) {
      console.warn('[NL Tag UI] Failed to save recent combos:', e);
    }
  }

  /**
   * Add a combo to recent list
   */
  function addToRecentCombo(text, parsedResult) {
    // Remove if already exists
    recentCombos = recentCombos.filter(c => c.text !== text);
    // Add to front
    recentCombos.unshift({ text, parsedResult, timestamp: Date.now() });
    // Keep only last MAX_RECENT_COMBOS
    if (recentCombos.length > MAX_RECENT_COMBOS) {
      recentCombos = recentCombos.slice(0, MAX_RECENT_COMBOS);
    }
    saveRecentCombos();
  }

  /**
   * Create the NL tag UI - integrates with existing Image name field
   */
  function createNLTagUI() {
    // Check if already initialized
    if (window.__nlTagUIInitialized) {
      return;
    }

    const nameBox = document.getElementById('currentImageNameBox');
    if (!nameBox) {
      console.warn('[NL Tag UI] currentImageNameBox not found, retrying...');
      setTimeout(createNLTagUI, 100);
      return;
    }

    // Find the container that holds the image name box
    const nameBoxContainer = nameBox.closest('.px-3.bg-white.border-b');
    if (!nameBoxContainer) {
      console.warn('[NL Tag UI] Could not find name box container');
      return;
    }

    // Update placeholder to indicate tagging capability
    nameBox.placeholder = 'Describe this view (e.g., "square arm high back sofa 2 arms")';

    // Create chips container below the input
    let chipsContainer = document.getElementById('nlTagChips');
    if (!chipsContainer) {
      chipsContainer = document.createElement('div');
      chipsContainer.id = 'nlTagChips';
      chipsContainer.className = 'flex flex-wrap gap-1 mt-1 min-h-[20px]';
      nameBoxContainer.appendChild(chipsContainer);
    }

    // Create suggestions container
    let suggestionsContainer = document.getElementById('nlTagSuggestions');
    if (!suggestionsContainer) {
      suggestionsContainer = document.createElement('div');
      suggestionsContainer.id = 'nlTagSuggestions';
      suggestionsContainer.className = 'flex flex-wrap gap-1 mt-1 text-[10px]';
      nameBoxContainer.appendChild(suggestionsContainer);
    }

    // Recent combos dropdown (hidden by default)
    let recentContainer = document.getElementById('nlTagRecent');
    if (!recentContainer) {
      recentContainer = document.createElement('div');
      recentContainer.id = 'nlTagRecent';
      recentContainer.className = 'hidden mt-2';
      
      const recentLabel = document.createElement('div');
      recentLabel.className = 'text-[10px] text-slate-500 mb-1 font-medium';
      recentLabel.textContent = 'Recent:';
      recentContainer.appendChild(recentLabel);
      
      const recentList = document.createElement('div');
      recentList.id = 'nlTagRecentList';
      recentList.className = 'flex flex-col gap-1';
      recentContainer.appendChild(recentList);
      
      nameBoxContainer.appendChild(recentContainer);
    }

    // Setup event handlers using the existing nameBox
    setupInputHandlers(nameBox, chipsContainer, suggestionsContainer, recentContainer, recentContainer.querySelector('#nlTagRecentList'));

    window.__nlTagUIInitialized = true;
    console.log('[NL Tag UI] Initialized - Integrated with Image name field');
  }

  /**
   * Setup input event handlers
   */
  function setupInputHandlers(input, chipsContainer, suggestionsContainer, recentContainer, recentList) {
    let currentParsedResult = null;
    let suggestionIndex = -1;
    let lastLoadedImageLabel = null; // Track which image we last loaded tags for

    // Debounce parsing
    let parseTimeout = null;
    input.addEventListener('input', async (e) => {
      clearTimeout(parseTimeout);
      const text = e.target.value.trim();
      
      parseTimeout = setTimeout(async () => {
        if (!text) {
          chipsContainer.innerHTML = '';
          suggestionsContainer.innerHTML = '';
          currentParsedResult = null;
          return;
        }

        if (window.nlTagParser) {
          const parsed = await window.nlTagParser.parseTags(text);
          currentParsedResult = parsed;
          
          // Update chips
          updateChips(chipsContainer, parsed);
          
          // Update suggestions (top 3)
          updateSuggestions(suggestionsContainer, parsed, text);
        }
      }, 150);
    });

    // Save tags on blur/change (when user finishes editing)
    input.addEventListener('blur', async () => {
      const text = input.value.trim();
      if (text && currentParsedResult) {
        await saveTags(text, currentParsedResult);
      }
    });

    // Also save on change event (for compatibility with existing paint.js handler)
    input.addEventListener('change', async () => {
      const text = input.value.trim();
      if (text && currentParsedResult) {
        await saveTags(text, currentParsedResult);
      }
    });

    // Keyboard shortcuts
    input.addEventListener('keydown', async (e) => {
      // Enter: confirm and save (but don't clear - keep the value)
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const text = input.value.trim();
        if (text && currentParsedResult) {
          await saveTags(text, currentParsedResult);
          // Don't clear - keep the value visible
          input.blur(); // Move focus away
        }
      }
      
      // Escape: clear
      if (e.key === 'Escape') {
        input.value = '';
        chipsContainer.innerHTML = '';
        suggestionsContainer.innerHTML = '';
        currentParsedResult = null;
        suggestionIndex = -1;
      }
      
      // Tab: cycle through suggestions
      if (e.key === 'Tab' && suggestionsContainer.children.length > 0) {
        e.preventDefault();
        suggestionIndex = (suggestionIndex + 1) % suggestionsContainer.children.length;
        const suggestionEl = suggestionsContainer.children[suggestionIndex];
        if (suggestionEl) {
          suggestionEl.focus();
        }
      }
      
      // 1/2/3: apply top suggestions
      if (e.key >= '1' && e.key <= '3') {
        const idx = parseInt(e.key) - 1;
        const suggestionEl = suggestionsContainer.children[idx];
        if (suggestionEl) {
          e.preventDefault();
          suggestionEl.click();
        }
      }
    });

    // Show recent combos on focus
    input.addEventListener('focus', () => {
      loadRecentCombos();
      updateRecentCombos(recentList, recentContainer);
    });

    // Watch for external updates to the input (from paint.js updateNameBox)
    // Use MutationObserver to detect when value changes programmatically
    let lastInputValue = input.value;
    const checkInputValue = () => {
      if (input.value !== lastInputValue) {
        lastInputValue = input.value;
        // If value changed externally, parse and show chips
        if (input.value.trim() && window.nlTagParser) {
          window.nlTagParser.parseTags(input.value).then(parsed => {
            if (parsed) {
              currentParsedResult = parsed;
              updateChips(chipsContainer, parsed);
              updateSuggestions(suggestionsContainer, parsed, input.value);
            }
          });
        } else {
          chipsContainer.innerHTML = '';
          suggestionsContainer.innerHTML = '';
          currentParsedResult = null;
        }
      }
    };
    
    // Check periodically for external value changes
    setInterval(checkInputValue, 200);

    // Load existing tags when image changes
    if (typeof window.switchToImage === 'function') {
      const originalSwitchToImage = window.switchToImage;
      window.switchToImage = function(...args) {
        originalSwitchToImage.apply(this, args);
        setTimeout(() => {
          const newImageLabel = window.currentImageLabel;
          // Only reload if image actually changed
          if (newImageLabel !== lastLoadedImageLabel) {
            lastInputValue = ''; // Reset to trigger check
            loadTagsForCurrentImage(input, chipsContainer, () => {
              lastLoadedImageLabel = newImageLabel;
              lastInputValue = input.value; // Update tracked value
            });
          }
        }, 100);
      };
    }

    // Initial load
    setTimeout(() => {
      loadTagsForCurrentImage(input, chipsContainer, () => {
        lastLoadedImageLabel = window.currentImageLabel;
        lastInputValue = input.value; // Update tracked value
      });
    }, 500);
  }

  /**
   * Update chip display
   */
  function updateChips(container, parsedResult) {
    if (!parsedResult || !window.nlTagParser) {
      container.innerHTML = '';
      return;
    }

    const chips = window.nlTagParser.generateChips(parsedResult);
    container.innerHTML = '';
    
    chips.forEach(chip => {
      const chipEl = document.createElement('span');
      chipEl.className = 'inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium';
      
      // Color coding by type
      const colors = {
        viewpoint: 'bg-blue-100 text-blue-800',
        category: 'bg-purple-100 text-purple-800',
        arms: 'bg-green-100 text-green-800',
        armStyle: 'bg-yellow-100 text-yellow-800',
        back: 'bg-pink-100 text-pink-800',
        'cushion-seat': 'bg-indigo-100 text-indigo-800',
        'cushion-back': 'bg-indigo-100 text-indigo-800',
        seats: 'bg-teal-100 text-teal-800',
        orientation: 'bg-orange-100 text-orange-800',
        extra: 'bg-gray-100 text-gray-800'
      };
      
      chipEl.className += ' ' + (colors[chip.type] || colors.extra);
      chipEl.textContent = chip.label;
      container.appendChild(chipEl);
    });
  }

  /**
   * Update suggestions display
   */
  function updateSuggestions(container, parsedResult, inputText) {
    if (!parsedResult || !window.nlTagParser) {
      container.innerHTML = '';
      return;
    }

    const chips = window.nlTagParser.generateChips(parsedResult);
    container.innerHTML = '';
    
    // Show top 3 chips as quick suggestions
    const top3 = chips.slice(0, 3);
    top3.forEach((chip, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'px-2 py-0.5 rounded text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-700';
      btn.textContent = `${idx + 1}. ${chip.label}`;
      btn.title = `Press ${idx + 1} to apply`;
      btn.addEventListener('click', () => {
        // Apply suggestion (could extend input or auto-fill)
        const input = document.getElementById('nlTagInput');
        if (input) {
          input.value = inputText + ' ' + chip.label;
          input.dispatchEvent(new Event('input'));
        }
      });
      container.appendChild(btn);
    });
  }

  /**
   * Update recent combos display
   */
  function updateRecentCombos(listContainer, container) {
    loadRecentCombos();
    listContainer.innerHTML = '';
    
    if (recentCombos.length === 0) {
      container.classList.add('hidden');
      return;
    }
    
    container.classList.remove('hidden');
    
    recentCombos.forEach(combo => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'text-left px-2 py-1 rounded text-[10px] bg-slate-50 hover:bg-slate-100 text-slate-600';
      btn.textContent = combo.text;
      btn.addEventListener('click', () => {
        const input = document.getElementById('nlTagInput');
        if (input) {
          input.value = combo.text;
          input.dispatchEvent(new Event('input'));
          input.focus();
        }
      });
      listContainer.appendChild(btn);
    });
  }

  /**
   * Extract base description (without viewpoint) from full description
   */
  function extractBaseDescription(fullDescription) {
    if (!fullDescription) return '';
    
    // List of viewpoint terms to remove from the end
    const viewpointTerms = [
      'front', 'front-center', 'front-arm', 'front arm', 'arm front',
      'side-arm', 'side arm', 'side', 'side view', 'side facing',
      'back', 'back view', 'back facing', 'rear',
      'top', 'top view', 'top down', 'overhead', 'above',
      '3/4', 'three quarter', 'three-quarter', '3 quarter', 'three quarters'
    ];
    
    let base = fullDescription.trim();
    
    // Remove viewpoint terms from the end (with or without leading dash/hyphen)
    for (const term of viewpointTerms) {
      // Match at end: "description - front" or "description front"
      const patterns = [
        new RegExp(`\\s*-\\s*${term}\\s*$`, 'i'),
        new RegExp(`\\s+${term}\\s*$`, 'i')
      ];
      
      for (const pattern of patterns) {
        if (pattern.test(base)) {
          base = base.replace(pattern, '').trim();
          break;
        }
      }
    }
    
    return base;
  }

  /**
   * Load tags for current image
   */
  async function loadTagsForCurrentImage(input, chipsContainer, onComplete) {
    const imageLabel = window.currentImageLabel;
    
    // Don't clear input - let paint.js updateNameBox handle it
    // Just clear chips
    chipsContainer.innerHTML = '';
    
    if (!imageLabel) {
      if (onComplete) onComplete();
      return;
    }

    // Wait a bit for paint.js to update the nameBox value
    setTimeout(async () => {
      const currentValue = input.value.trim();
      
      // If there's already a value in the box (from paint.js updateNameBox), use it
      if (currentValue) {
        // Parse it to show chips
        if (window.nlTagParser) {
          const parsed = await window.nlTagParser.parseTags(currentValue);
          updateChips(chipsContainer, parsed);
        }
        if (onComplete) onComplete();
        return;
      }

      // Otherwise, check if this image has existing tags
      const tags = window.imageTags?.[imageLabel];
      
      if (tags && tags.facets) {
        // Reconstruct description from facets if available
        const parts = [];
        if (tags.facets.category) parts.push(tags.facets.category);
        if (tags.facets.armStyle) parts.push(tags.facets.armStyle + ' arm');
        if (tags.facets.back) parts.push(tags.facets.back + ' back');
        if (tags.facets.arms) parts.push(tags.facets.arms);
        if (tags.facets.cushions?.seat) parts.push(tags.facets.cushions.seat + ' cushion');
        if (tags.facets.seats) parts.push(tags.facets.seats + ' seats');
        if (tags.facets.orientation) parts.push(tags.facets.orientation);
        if (tags.facets.extras && tags.facets.extras.length > 0) {
          parts.push(...tags.facets.extras);
        }
        
        const description = parts.join(' ');
        if (description) {
          input.value = description;
          input.dispatchEvent(new Event('input'));
        } else if (tags.viewpoint) {
          // Fallback to just viewpoint
          input.value = tags.viewpoint;
          input.dispatchEvent(new Event('input'));
        }
      } else {
        // No tags for this image - check for base description from previous image
        try {
          const lastBaseDescription = localStorage.getItem('nlTagLastBaseDescription');
          if (lastBaseDescription) {
            input.value = lastBaseDescription;
            // Trigger input event to show chips
            input.dispatchEvent(new Event('input'));
          }
        } catch (e) {
          console.warn('[NL Tag UI] Failed to load base description:', e);
        }
      }
      
      if (onComplete) onComplete();
    }, 150); // Wait for paint.js to update
  }

  /**
   * Save tags to imageTags and update viewpoint
   */
  async function saveTags(text, parsedResult) {
    const imageLabel = window.currentImageLabel;
    if (!imageLabel) {
      console.warn('[NL Tag UI] No current image label');
      return;
    }

    // Initialize imageTags if needed
    if (!window.imageTags) window.imageTags = {};
    if (!window.imageTags[imageLabel]) window.imageTags[imageLabel] = {};

    // Save viewpoint
    if (parsedResult.viewpoint) {
      window.imageTags[imageLabel].viewpoint = parsedResult.viewpoint;
      
      // Update viewpoint dropdown if it exists
      const viewpointSelect = document.getElementById('aiViewpointSelect');
      if (viewpointSelect) {
        viewpointSelect.value = parsedResult.viewpoint;
        viewpointSelect.dispatchEvent(new Event('change'));
      }
    }

    // Save facets
    window.imageTags[imageLabel].facets = parsedResult.facets;
    window.imageTags[imageLabel].freeform = parsedResult.freeform;

    // Also save to customImageNames (for compatibility with existing image name system)
    if (!window.customImageNames) window.customImageNames = {};
    window.customImageNames[imageLabel] = text;

    // Extract and save base description (without viewpoint) for next image
    const baseDescription = extractBaseDescription(text);
    if (baseDescription) {
      try {
        localStorage.setItem('nlTagLastBaseDescription', baseDescription);
      } catch (e) {
        console.warn('[NL Tag UI] Failed to save base description:', e);
      }
    }

    // Add to recent combos
    addToRecentCombo(text, parsedResult);

    console.log('[NL Tag UI] Saved tags:', {
      imageLabel,
      viewpoint: parsedResult.viewpoint,
      facets: parsedResult.facets,
      baseDescription: baseDescription,
      customName: text
    });

    // Update chips in image thumbnail
    updateImageThumbnailChips(imageLabel, parsedResult);
  }

  /**
   * Update chips display in image thumbnail
   */
  function updateImageThumbnailChips(imageLabel, parsedResult) {
    const container = document.querySelector(`[data-label="${imageLabel}"]`);
    if (!container) return;

    // Find or create chips container in thumbnail
    let chipsContainer = container.querySelector('.nl-tag-chips');
    if (!chipsContainer) {
      chipsContainer = document.createElement('div');
      chipsContainer.className = 'nl-tag-chips flex flex-wrap gap-1 mt-1';
      container.appendChild(chipsContainer);
    }

    chipsContainer.innerHTML = '';
    
    if (parsedResult && window.nlTagParser) {
      const chips = window.nlTagParser.generateChips(parsedResult);
      chips.slice(0, 3).forEach(chip => { // Show max 3 chips in thumbnail
        const chipEl = document.createElement('span');
        chipEl.className = 'inline-flex items-center px-1 py-0.5 rounded text-[8px] bg-slate-100 text-slate-600';
        chipEl.textContent = chip.label;
        chipsContainer.appendChild(chipEl);
      });
    }
  }

  /**
   * Initialize NL Tag UI
   */
  function init() {
    // Wait for DOM and nlTagParser
    function tryInit() {
      if (document.getElementById('currentImageNameBox') && window.nlTagParser) {
        createNLTagUI();
        loadRecentCombos();
        console.log('[NL Tag UI] Initialized - Integrated with Image name field');
      } else {
        setTimeout(tryInit, 100);
      }
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', tryInit);
    } else {
      tryInit();
    }
  }

  // Export to window
  window.nlTagUI = {
    init,
    saveTags,
    updateImageThumbnailChips
  };

  // Auto-init
  init();
})();

