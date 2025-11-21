/**
 * UI Controller for OpenPaint
 * Integrates Tweakpane and Pickr for modern UI controls
 */

// Initialize Tweakpane for brush settings
function initBrushControls() {
  // Container for the Tweakpane UI
  const container = document.createElement('div');
  container.id = 'brush-controls';
  container.className = 'fixed right-4 top-20 z-50';
  document.body.appendChild(container);
    
  // Initialize brush parameters
  const brushParams = {
    size: parseInt(document.getElementById('brushSize').value) || 5,
    color: document.getElementById('colorPicker').value || '#1a73e8',
    mode: 'freehand' // Default drawing mode
  };
    
  // Create Tweakpane instance
  const pane = new Tweakpane.Pane({
    container: container,
    title: 'Brush Settings'
  });
    
  // Add brush size slider
  pane.addInput(brushParams, 'size', {
    min: 1,
    max: 50,
    step: 1,
  }).on('change', (ev) => {
    // Update brush size
    const brushSizeInput = document.getElementById('brushSize');
    brushSizeInput.value = ev.value;
        
    // Dispatch an input event to trigger any existing event listeners
    const inputEvent = new Event('input', { bubbles: true });
    brushSizeInput.dispatchEvent(inputEvent);
  });
    
  // Add drawing mode selector
  pane.addInput(brushParams, 'mode', {
    options: {
      Freehand: 'freehand',
      'Straight Line': 'straight'
    }
  }).on('change', (ev) => {
    const modeToggle = document.getElementById('drawingModeToggle');
    if (ev.value === 'straight') {
      modeToggle.classList.add('straight-mode');
      modeToggle.textContent = 'Straight Line';
    } else {
      modeToggle.classList.remove('straight-mode');
      modeToggle.textContent = 'Freehand';
    }
        
    // Simulate a click on the drawing mode toggle
    modeToggle.click();
  });
    
  // Return the pane instance for further modification
  return pane;
}

// Initialize Pickr color picker
function initColorPicker() {
  // Get the original color picker
  const colorPickerInput = document.getElementById('colorPicker');
  const initialColor = colorPickerInput.value || '#1a73e8';
    
  // Create a container for Pickr
  const container = document.createElement('div');
  container.id = 'color-picker-container';
  document.querySelector('.toolbar').appendChild(container);
    
  // Initialize Pickr
  const pickr = Pickr.create({
    el: container,
    theme: 'classic',
    useAsButton: true,
    swatches: [
      '#1a73e8',
      '#34a853',
      '#ea4335',
      '#fbbc04',
      '#9c27b0',
      '#e67c00',
      '#00796b',
      '#000000'
    ],
    components: {
      preview: true,
      opacity: true,
      hue: true,
      interaction: {
        hex: true,
        rgba: true,
        hsla: false,
        hsva: false,
        cmyk: false,
        input: true,
        clear: false,
        save: true
      }
    },
    defaultRepresentation: 'HEX'
  });
    
  // Set the initial color
  pickr.setColor(initialColor);
    
  // Handle color selection
  pickr.on('save', (color) => {
    const hexColor = color.toHEXA().toString();
        
    // Update original color picker
    colorPickerInput.value = hexColor;
        
    // Dispatch an input event to trigger any existing event listeners
    const inputEvent = new Event('input', { bubbles: true });
    colorPickerInput.dispatchEvent(inputEvent);
        
    // Apply active class to the matching color button if it exists
    const colorButtons = document.querySelectorAll('.color-btn');
    colorButtons.forEach(btn => {
      btn.classList.remove('active');
      if (btn.dataset.color.toLowerCase() === hexColor.toLowerCase()) {
        btn.classList.add('active');
      }
    });
        
    pickr.hide();
  });
    
  // Return the pickr instance for further modification
  return pickr;
}

// Initialize the UI when the DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  // Wait for Tweakpane and Pickr to be loaded
  setTimeout(() => {
    if (window.Tweakpane && window.Pickr) {
      const brushPane = initBrushControls();
      const colorPicker = initColorPicker();
            
      // Make them available globally
      window.brushPane = brushPane;
      window.colorPicker = colorPicker;
            
      console.log('UI controls initialized successfully');
    } else {
      console.error('Tweakpane or Pickr libraries not loaded');
    }
  }, 500);
}); 