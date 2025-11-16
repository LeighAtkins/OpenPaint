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
   * Create the NL tag input UI
   */
  function createNLTagUI() {
    // Check if already exists
    if (document.getElementById('nlTagInputContainer')) {
      return;
    }

    const container = document.createElement('div');
    container.id = 'nlTagInputContainer';
    container.className = 'px-3 py-2 bg-white border-b border-slate-200';

    // Input box
    const inputGroup = document.createElement('div');
    inputGroup.className = 'mb-2';
    
    const label = document.createElement('label');
    label.setAttribute('for', 'nlTagInput');
    label.className = 'block text-[10px] text-slate-500 mb-1';
    label.textContent = 'Describe this view (e.g., "square arm high back sofa 2 arms")';
    
    const input = document.createElement('input');
    input.id = 'nlTagInput';
    input.type = 'text';
    input.className = 'w-full px-2 py-1.5 border border-slate-300 rounded-md text-[12px] focus:outline-none focus:ring-2 focus:ring-primary-300';
    input.placeholder = 'Type description...';
    
    inputGroup.appendChild(label);
    inputGroup.appendChild(input);
    container.appendChild(inputGroup);

    // Chip preview container
    const chipsContainer = document.createElement('div');
    chipsContainer.id = 'nlTagChips';
    chipsContainer.className = 'flex flex-wrap gap-1 mb-2 min-h-[24px]';
    container.appendChild(chipsContainer);

    // Quick suggestions (top 3 predicted facets)
    const suggestionsContainer = document.createElement('div');
    suggestionsContainer.id = 'nlTagSuggestions';
    suggestionsContainer.className = 'flex flex-wrap gap-1 mb-2 text-[10px]';
    container.appendChild(suggestionsContainer);

    // Recent combos dropdown
    const recentContainer = document.createElement('div');
    recentContainer.id = 'nlTagRecent';
    recentContainer.className = 'hidden mb-2';
    
    const recentLabel = document.createElement('div');
    recentLabel.className = 'text-[10px] text-slate-500 mb-1';
    recentLabel.textContent = 'Recent:';
    recentContainer.appendChild(recentLabel);
    
    const recentList = document.createElement('div');
    recentList.id = 'nlTagRecentList';
    recentList.className = 'flex flex-col gap-1';
    recentContainer.appendChild(recentList);
    
    container.appendChild(recentContainer);

    // Insert before imagePanelContent
    const imagePanelContent = document.getElementById('imagePanelContent');
    if (imagePanelContent) {
      imagePanelContent.insertBefore(container, imagePanelContent.firstChild);
    } else {
      // Fallback: append to imagePanel
      const imagePanel = document.getElementById('imagePanel');
      if (imagePanel) {
        imagePanel.appendChild(container);
      }
    }

    // Setup event handlers
    setupInputHandlers(input, chipsContainer, suggestionsContainer, recentContainer, recentList);
  }

  /**
   * Setup input event handlers
   */
  function setupInputHandlers(input, chipsContainer, suggestionsContainer, recentContainer, recentList) {
    let currentParsedResult = null;
    let suggestionIndex = -1;

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

    // Keyboard shortcuts
    input.addEventListener('keydown', async (e) => {
      // Enter: confirm and save
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const text = input.value.trim();
        if (text && currentParsedResult) {
          await saveTags(text, currentParsedResult);
          input.value = '';
          chipsContainer.innerHTML = '';
          suggestionsContainer.innerHTML = '';
          currentParsedResult = null;
          suggestionIndex = -1;
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

    // Load existing tags when image changes
    if (typeof window.switchToImage === 'function') {
      const originalSwitchToImage = window.switchToImage;
      window.switchToImage = function(...args) {
        originalSwitchToImage.apply(this, args);
        setTimeout(() => {
          loadTagsForCurrentImage(input, chipsContainer);
        }, 100);
      };
    }

    // Initial load
    setTimeout(() => {
      loadTagsForCurrentImage(input, chipsContainer);
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
   * Load tags for current image
   */
  async function loadTagsForCurrentImage(input, chipsContainer) {
    const imageLabel = window.currentImageLabel;
    if (!imageLabel || !window.imageTags || !window.imageTags[imageLabel]) {
      input.value = '';
      chipsContainer.innerHTML = '';
      return;
    }

    const tags = window.imageTags[imageLabel];
    
    // Reconstruct description from facets if available
    if (tags.facets) {
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
      }
    } else if (tags.viewpoint) {
      // Fallback to just viewpoint
      input.value = tags.viewpoint;
      input.dispatchEvent(new Event('input'));
    }
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

    // Add to recent combos
    addToRecentCombo(text, parsedResult);

    console.log('[NL Tag UI] Saved tags:', {
      imageLabel,
      viewpoint: parsedResult.viewpoint,
      facets: parsedResult.facets
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
      if (document.getElementById('imagePanel') && window.nlTagParser) {
        createNLTagUI();
        loadRecentCombos();
        console.log('[NL Tag UI] Initialized');
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

