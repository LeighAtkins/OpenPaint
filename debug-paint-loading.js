// Debug script to help diagnose paint.js loading issues
console.log('🔍 [DEBUG] Paint.js loading diagnostic starting...');

// Check if core globals are available
const checkGlobals = () => {
  const requiredGlobals = [
    'paintApp',
    'vectorStrokesByImage', 
    'strokeVisibilityByImage',
    'currentImageLabel',
    'addImageToSidebar',
    'redrawCanvasWithVisibility',
    'updateStrokeVisibilityControls'
  ];
  
  const missing = [];
  const available = [];
  
  requiredGlobals.forEach(global => {
    if (typeof window[global] !== 'undefined') {
      available.push(global);
    } else {
      missing.push(global);
    }
  });
  
  console.log('✅ [DEBUG] Available globals:', available);
  if (missing.length > 0) {
    console.log('❌ [DEBUG] Missing globals:', missing);
  }
  
  return missing.length === 0;
};

// Check DOM elements
const checkDOMElements = () => {
  const requiredElements = [
    'canvas',
    'colorPicker',
    'brushSize',
    'clear',
    'save'
  ];
  
  const missing = [];
  const available = [];
  
  requiredElements.forEach(id => {
    const element = document.getElementById(id);
    if (element) {
      available.push(id);
    } else {
      missing.push(id);
    }
  });
  
  console.log('✅ [DEBUG] Available DOM elements:', available);
  if (missing.length > 0) {
    console.log('❌ [DEBUG] Missing DOM elements:', missing);
  }
  
  return missing.length === 0;
};

// Check viewport system
const checkViewportSystem = () => {
  console.log('🎮 [DEBUG] Viewport system status:');
  console.log('  - ViewportFeatureFlags:', typeof window.ViewportFeatureFlags);
  console.log('  - CanvasViewportController:', typeof window.CanvasViewportController);
  
  if (window.ViewportFeatureFlags) {
    const flags = window.ViewportFeatureFlags.getAllFeatureFlags();
    console.log('  - Feature flags:', flags);
  }
  
  if (window.paintApp && window.paintApp.state && window.paintApp.state.viewportController) {
    console.log('  - Viewport controller instance:', !!window.paintApp.state.viewportController);
  }
};

// Check script loading errors
const checkScriptErrors = () => {
  // Monitor for script errors
  window.addEventListener('error', (event) => {
    if (event.filename && (event.filename.includes('paint.js') || event.filename.includes('viewport'))) {
      console.error('🚨 [DEBUG] Script error detected:', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno
      });
    }
  });
  
  // Monitor for unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    console.error('🚨 [DEBUG] Unhandled promise rejection:', event.reason);
  });
};

// Run diagnostics
const runDiagnostics = () => {
  console.log('🔍 [DEBUG] Running paint.js diagnostics...');
  
  const globalsReady = checkGlobals();
  const domReady = checkDOMElements();
  
  checkViewportSystem();
  
  if (globalsReady && domReady) {
    console.log('✅ [DEBUG] Paint.js appears to be loaded correctly!');
  } else {
    console.log('❌ [DEBUG] Paint.js has loading issues - see details above');
  }
  
  // Additional checks
  console.log('📊 [DEBUG] Additional info:');
  console.log('  - Document ready state:', document.readyState);
  console.log('  - Scripts in head:', document.head.querySelectorAll('script').length);
  console.log('  - Paint.js script found:', !!document.querySelector('script[src*="paint.js"]'));
  console.log('  - Viewport scripts found:', document.querySelectorAll('script[src*="viewport"]').length);
};

// Set up monitoring
checkScriptErrors();

// Run diagnostics when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(runDiagnostics, 1000); // Wait a bit for scripts to load
  });
} else {
  setTimeout(runDiagnostics, 1000);
}

// Expose for manual testing
window.runPaintDiagnostics = runDiagnostics;

console.log('🔍 [DEBUG] Diagnostic script loaded. Run window.runPaintDiagnostics() to check status.');
