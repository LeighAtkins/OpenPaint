/**
 * Feature Flag System for Canvas Viewport
 * 
 * Allows runtime switching between old and new viewport implementations
 * for emergency rollbacks and gradual migration.
 */

const VIEWPORT_FEATURE_FLAGS = {
  // Main viewport controller flag
  USE_NEW_VIEWPORT: false, // Set to false to use legacy system - DISABLED due to coordinate mismatch issues
  
  // Individual feature flags for granular control
  USE_DPR_AWARE_SIZING: true,
  USE_RAF_BATCHED_RESIZE: true,
  USE_SINGLE_TRANSFORM: true,
  USE_LOCK_STATE: true,
  
  // Debug flags
  DEBUG_VIEWPORT: false, // Show debug panel
  LOG_VIEWPORT_CHANGES: false, // Console log viewport changes
  ENABLE_VIEWPORT_TESTS: false // Enable runtime tests
};

/**
 * Get feature flag value with environment override
 */
function getFeatureFlag(flagName, defaultValue = false) {
  // Check URL parameters for development override
  const urlParams = new URLSearchParams(window.location.search);
  const urlOverride = urlParams.get(`flag_${flagName.toLowerCase()}`);
  
  if (urlOverride !== null) {
    return urlOverride === 'true' || urlOverride === '1';
  }
  
  // Check localStorage for persistent override
  const storageKey = `viewport_flag_${flagName}`;
  const storedValue = localStorage.getItem(storageKey);
  
  if (storedValue !== null) {
    return storedValue === 'true';
  }
  
  // Use configured value or default
  return VIEWPORT_FEATURE_FLAGS[flagName] !== undefined 
    ? VIEWPORT_FEATURE_FLAGS[flagName] 
    : defaultValue;
}

/**
 * Set feature flag value (persisted to localStorage)
 */
function setFeatureFlag(flagName, value) {
  const storageKey = `viewport_flag_${flagName}`;
  localStorage.setItem(storageKey, String(value));
  
  // Log change in development
  if (getFeatureFlag('LOG_VIEWPORT_CHANGES')) {
    console.log(`[VIEWPORT-FLAG] ${flagName} = ${value}`);
  }
}

/**
 * Reset all feature flags to defaults
 */
function resetFeatureFlags() {
  Object.keys(VIEWPORT_FEATURE_FLAGS).forEach(flagName => {
    const storageKey = `viewport_flag_${flagName}`;
    localStorage.removeItem(storageKey);
  });
  
  console.log('[VIEWPORT-FLAG] All flags reset to defaults');
}

/**
 * Get all current feature flag values
 */
function getAllFeatureFlags() {
  const flags = {};
  Object.keys(VIEWPORT_FEATURE_FLAGS).forEach(flagName => {
    flags[flagName] = getFeatureFlag(flagName);
  });
  return flags;
}

/**
 * Debug helper to toggle flags at runtime
 */
function createFeatureFlagDebugPanel() {
  if (!getFeatureFlag('DEBUG_VIEWPORT')) return null;
  
  const panel = document.createElement('div');
  panel.id = 'viewport-debug-panel';
  panel.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    background: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 10px;
    border-radius: 5px;
    font-family: monospace;
    font-size: 12px;
    z-index: 10000;
    max-width: 300px;
  `;
  
  const title = document.createElement('div');
  title.textContent = 'Viewport Debug Panel';
  title.style.fontWeight = 'bold';
  title.style.marginBottom = '10px';
  panel.appendChild(title);
  
  // Add toggle for each flag
  Object.keys(VIEWPORT_FEATURE_FLAGS).forEach(flagName => {
    const row = document.createElement('div');
    row.style.marginBottom = '5px';
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `flag-${flagName}`;
    checkbox.checked = getFeatureFlag(flagName);
    checkbox.addEventListener('change', () => {
      setFeatureFlag(flagName, checkbox.checked);
      // Reload page to apply changes
      if (flagName === 'USE_NEW_VIEWPORT') {
        window.location.reload();
      }
    });
    
    const label = document.createElement('label');
    label.htmlFor = `flag-${flagName}`;
    label.textContent = flagName;
    label.style.marginLeft = '5px';
    label.style.cursor = 'pointer';
    
    row.appendChild(checkbox);
    row.appendChild(label);
    panel.appendChild(row);
  });
  
  // Reset button
  const resetBtn = document.createElement('button');
  resetBtn.textContent = 'Reset All';
  resetBtn.style.cssText = 'margin-top: 10px; padding: 5px; width: 100%;';
  resetBtn.addEventListener('click', () => {
    resetFeatureFlags();
    window.location.reload();
  });
  panel.appendChild(resetBtn);
  
  return panel;
}

/**
 * Initialize feature flag system
 */
function initFeatureFlags() {
  // Create debug panel if enabled
  if (getFeatureFlag('DEBUG_VIEWPORT')) {
    const panel = createFeatureFlagDebugPanel();
    if (panel) {
      document.body.appendChild(panel);
    }
  }
  
  // Log current flags in development
  if (getFeatureFlag('LOG_VIEWPORT_CHANGES')) {
    console.log('[VIEWPORT-FLAG] Current flags:', getAllFeatureFlags());
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getFeatureFlag,
    setFeatureFlag,
    resetFeatureFlags,
    getAllFeatureFlags,
    initFeatureFlags
  };
} else {
  // Browser global
  window.ViewportFeatureFlags = {
    getFeatureFlag,
    setFeatureFlag,
    resetFeatureFlags,
    getAllFeatureFlags,
    initFeatureFlags
  };
}
