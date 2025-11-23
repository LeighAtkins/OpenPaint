// Main Entry Point
import { CanvasManager } from './CanvasManager.js';
import { ToolManager } from './tools/ToolManager.js';
import { ProjectManager } from './ProjectManager.js';
import { HistoryManager } from './HistoryManager.js';
import { StrokeMetadataManager } from './StrokeMetadataManager.js';
import { setupDebugHelpers } from './DebugHelpers.js';
import { TagManager } from './TagManager.js?v=cachebust15';
import { UploadManager } from './UploadManager.js';
import { MeasurementSystem } from './MeasurementSystem.js';
import { MeasurementDialog } from './MeasurementDialog.js';
import { MeasurementExporter } from './MeasurementExporter.js';

class App {
    constructor() {
        this.canvasManager = new CanvasManager('canvas');
        this.historyManager = new HistoryManager(this.canvasManager);
        this.toolManager = new ToolManager(this.canvasManager);
        this.metadataManager = new StrokeMetadataManager();
        this.tagManager = new TagManager(this.canvasManager, this.metadataManager);
        this.projectManager = new ProjectManager(this.canvasManager, this.historyManager);
        this.uploadManager = new UploadManager(this.projectManager);

        // Measurement system
        this.measurementSystem = new MeasurementSystem(this.metadataManager);
        this.measurementDialog = new MeasurementDialog(this.measurementSystem);
        this.measurementExporter = new MeasurementExporter(this.measurementSystem, this.projectManager);

        this.init();
    }

    init() {
        console.log('OpenPaint (Fabric.js) Initializing...');
        
        // Wait a tick to ensure DOM is fully ready
        setTimeout(() => {
            // Initialize managers
            this.canvasManager.init();
            
            // Resize immediately after init
            this.canvasManager.resize();
            
            // Initialize other managers
            this.toolManager.init();
            this.historyManager.init();
            this.projectManager.init();
            this.uploadManager.init();
            
        // Initialize drawing mode toggle button label
        const drawingModeToggle = document.getElementById('drawingModeToggle');
        if (drawingModeToggle) {
            this.updateToggleLabel(drawingModeToggle, 'Straight Line');
        }
        
        // Set default color to bright blue and activate first color button
        const firstColorBtn = document.querySelector('[data-color="#3b82f6"]');
        if (firstColorBtn) {
            firstColorBtn.classList.add('active', 'transform', 'scale-110');
        }
        
        // Initialize color picker to default color
        const colorPicker = document.getElementById('colorPicker');
        if (colorPicker) {
            colorPicker.value = '#3b82f6';
        }
            
            // Setup label rendering on object changes
            if (this.canvasManager.fabricCanvas) {
                this.canvasManager.fabricCanvas.on('object:added', (e) => {
                    // Ensure new objects are selectable (except label text)
                    const obj = e.target;
                    if (obj && obj.evented !== false && !obj.isTag) {
                        obj.set({
                            selectable: true,
                            evented: true
                        });
                    }
                });
                this.canvasManager.fabricCanvas.on('object:removed', (e) => {
                    // If a stroke is removed, remove its tag
                    const obj = e.target;
                    if (obj && obj.strokeMetadata) {
                        this.tagManager.removeTag(obj.strokeMetadata.strokeLabel);
                    }
                });
            }
            
            // Setup UI bindings
            this.setupUI();
            
            // Add Tab key handler to cycle through drawing modes
            this.setupKeyboardShortcuts();
            
            // Add resize listener
            window.addEventListener('resize', () => {
                this.canvasManager.resize();
            });
            
            console.log('OpenPaint initialization complete');
            
            // Debug: Verify canvas is accessible
            const canvasEl = document.getElementById('canvas');
            if (canvasEl) {
                console.log(`Canvas element found: ${canvasEl.offsetWidth}x${canvasEl.offsetHeight}`);
                console.log(`Canvas computed style: display=${window.getComputedStyle(canvasEl).display}, z-index=${window.getComputedStyle(canvasEl).zIndex}`);
            } else {
                console.error('Canvas element not found in DOM!');
            }
        }, 0);
    }

    setupUI() {
        // Undo/Redo
        const undoBtn = document.getElementById('undoBtn');
        const redoBtn = document.getElementById('redoBtn');
        
        if (undoBtn) undoBtn.addEventListener('click', () => this.historyManager.undo());
        if (redoBtn) redoBtn.addEventListener('click', () => this.historyManager.redo());

        // Tools
        const drawingModeToggle = document.getElementById('drawingModeToggle');
        const textModeToggle = document.getElementById('textModeToggle');
        const clearBtn = document.getElementById('clear');
        
        if (drawingModeToggle) {
            drawingModeToggle.addEventListener('click', () => {
                // Cycle through: Straight Line -> Curved Line -> Select -> Straight Line
                const currentTool = this.toolManager.activeTool;
                if (currentTool === this.toolManager.tools.line) {
                    // Straight Line -> Curved Line
                    this.toolManager.selectTool('curve');
                    this.updateToggleLabel(drawingModeToggle, 'Curved Line');
                } else if (currentTool === this.toolManager.tools.curve) {
                    // Curved Line -> Select
                    this.toolManager.selectTool('select');
                    this.updateToggleLabel(drawingModeToggle, 'Select');
                } else {
                    // Select (or any other tool) -> Straight Line
                    this.toolManager.selectTool('line');
                    this.updateToggleLabel(drawingModeToggle, 'Straight Line');
                }
            });
        }
        
        if (textModeToggle) {
            textModeToggle.addEventListener('click', () => {
                this.toolManager.selectTool('text');
            });
        }
        
        // Arrows - select Arrow tool
        const startArrowBtn = document.getElementById('startArrow');
        const endArrowBtn = document.getElementById('endArrow');

        const selectArrowTool = () => {
            this.toolManager.selectTool('arrow');
            // Update drawing mode toggle label if needed
            const drawingModeToggle = document.getElementById('drawingModeToggle');
            if (drawingModeToggle) {
                // Don't change the label, just switch to arrow tool
            }
        };

        if (startArrowBtn) startArrowBtn.addEventListener('click', selectArrowTool);
        if (endArrowBtn) endArrowBtn.addEventListener('click', selectArrowTool);

        // Clear
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (confirm('Are you sure you want to clear the canvas?')) {
                    this.canvasManager.clear();
                    this.historyManager.saveState();
                }
            });
        }

        // Color Picker
        const colorPicker = document.getElementById('colorPicker');
        const colorButtons = document.querySelectorAll('[data-color]');
        
        if (colorPicker) {
            colorPicker.addEventListener('input', (e) => {
                this.toolManager.updateSettings({ color: e.target.value });
            });
        }
        
        colorButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const color = btn.getAttribute('data-color');
                this.toolManager.updateSettings({ color: color });
                if (colorPicker) colorPicker.value = color;
                
                // Update active state
                colorButtons.forEach(b => b.classList.remove('active', 'transform', 'scale-110'));
                btn.classList.add('active', 'transform', 'scale-110');
            });
        });
        
        // Line width/thickness control
        const brushSizeSlider = document.getElementById('brushSize');
        if (brushSizeSlider) {
            const updateSliderVisual = (val) => {
                const min = parseFloat(brushSizeSlider.min) || 1;
                const max = parseFloat(brushSizeSlider.max) || 50;
                const p = (val - min) / (max - min);
                brushSizeSlider.style.setProperty('--p', p);
            };

            // Initialize visual state
            updateSliderVisual(parseFloat(brushSizeSlider.value) || 5);

            brushSizeSlider.addEventListener('input', (e) => {
                const width = parseInt(e.target.value, 10);
                this.toolManager.updateSettings({ width: width });
                updateSliderVisual(width);
            });
        }
        
        // Dash style control (dotted lines)
        const dashStyleSelect = document.getElementById('dashStyleSelect');
        if (dashStyleSelect) {
            dashStyleSelect.addEventListener('change', (e) => {
                const style = e.target.value;
                const patterns = {
                    'solid': [],
                    'small': [5, 5],
                    'medium': [10, 5],
                    'large': [15, 5],
                    'dot-dash': [5, 5, 1, 5],
                    'dotted': [2, 5],
                    'custom': [5, 5]
                };
                
                const pattern = patterns[style] || [];
                
                // Apply to all tools that support dash patterns
                if (this.toolManager.activeTool && this.toolManager.activeTool.setDashPattern) {
                    this.toolManager.activeTool.setDashPattern(pattern);
                }
                
                // Apply to all line-based tools
                if (this.toolManager.tools.line) {
                    this.toolManager.tools.line.setDashPattern(pattern);
                }
                if (this.toolManager.tools.curve) {
                    this.toolManager.tools.curve.setDashPattern(pattern);
                }
                if (this.toolManager.tools.arrow) {
                    this.toolManager.tools.arrow.setDashPattern(pattern);
                }
            });
        }
        
        // Image fit mode control
        const fitModeSelect = document.getElementById('fitModeSelect');
        if (fitModeSelect) {
            fitModeSelect.addEventListener('change', () => {
                const fitMode = fitModeSelect.value;
                console.log(`[ImageFit] Applying fit mode: ${fitMode}`);
                this.applyImageFitMode(fitMode);
            });
        }
        
        // Setup keyboard shortcuts and help system
        this.setupKeyboardControls();
        
        // Create help hint
        this.createHelpHint();
        
        // Setup unit toggle buttons
        this.setupUnitToggle();
        
        // Make metadata manager available globally for compatibility
        window.metadataManager = this.metadataManager;
        window.vectorStrokesByImage = this.metadataManager.vectorStrokesByImage;
        window.strokeVisibilityByImage = this.metadataManager.strokeVisibilityByImage;
        window.strokeLabelVisibility = this.metadataManager.strokeLabelVisibility;
        window.strokeMeasurements = this.metadataManager.strokeMeasurements;
        
        // Make project manager available globally for image switching
        window.projectManager = this.projectManager;
        window.app = this;
        
        // Setup debug helpers
        setupDebugHelpers(this);
    }
    
    setupUnitToggle() {
        const unitToggle = document.getElementById('unitToggleBtn');
        const unitToggleSecondary = document.getElementById('unitToggleBtnSecondary');
        const unitSelector = document.getElementById('unitSelector');
        
        // Initialize currentUnit state
        this.currentUnit = 'inch';
        
        // Sync initial state
        if (unitSelector) {
            // Force reset to inch to avoid browser form restoration issues
            unitSelector.value = 'inch';
            
            const unitLabel = 'inches';
            if (unitToggle) unitToggle.textContent = unitLabel;
            if (unitToggleSecondary) unitToggleSecondary.textContent = unitLabel;
        }
        
        const toggleUnits = () => {
            // Toggle between inch and cm using our state
            this.currentUnit = this.currentUnit === 'inch' ? 'cm' : 'inch';
            
            // Sync selector if it exists
            if (unitSelector) {
                unitSelector.value = this.currentUnit;
            }
            
            // Update button labels
            const unitLabel = this.currentUnit === 'inch' ? 'inches' : 'cm';
            if (unitToggle) unitToggle.textContent = unitLabel;
            if (unitToggleSecondary) unitToggleSecondary.textContent = unitLabel;
            
            // Refresh all measurement displays
            if (this.metadataManager) {
                this.metadataManager.refreshAllMeasurements();
            }
        };
        
        if (unitToggle) {
            unitToggle.addEventListener('click', toggleUnits);
        }
        
        if (unitToggleSecondary) {
            unitToggleSecondary.addEventListener('click', toggleUnits);
        }
        
        // Also listen for direct changes to unit selector
        if (unitSelector) {
            unitSelector.addEventListener('change', () => {
                this.currentUnit = unitSelector.value;
                const unitLabel = this.currentUnit === 'inch' ? 'inches' : 'cm';
                if (unitToggle) unitToggle.textContent = unitLabel;
                if (unitToggleSecondary) unitToggleSecondary.textContent = unitLabel;
                
                if (this.metadataManager) {
                    this.metadataManager.refreshAllMeasurements();
                }
            });
        }
        
        // Setup Show Measurements toggle
        const showMeasurementsCheckbox = document.getElementById('toggleShowMeasurements');
        if (showMeasurementsCheckbox) {
            showMeasurementsCheckbox.addEventListener('change', (e) => {
                const showMeasurements = e.target.checked;
                console.log(`[ShowMeasurements] Toggle: ${showMeasurements}`);
                
                // Update all tags to show/hide measurements
                if (this.tagManager) {
                    this.tagManager.setShowMeasurements(showMeasurements);
                }
            });
            
            // Set initial state
            if (this.tagManager) {
                this.tagManager.setShowMeasurements(showMeasurementsCheckbox.checked);
            }
        }
    }
    
    setupKeyboardShortcuts() {
        // Tab key cycles through drawing modes: Straight Line -> Curved Line -> Select -> Straight Line
        // Tab key cycles through drawing modes: Straight Line -> Curved Line -> Select -> Straight Line
        // Use capture phase to ensure we catch it before anything else
        window.addEventListener('keydown', (e) => {
            // Don't cycle if typing in an input/textarea or if text tool is active
            // Exception: Allow cycling if the target is a measurement span (user wants to tab out of it)
            const isMeasurement = e.target.classList && e.target.classList.contains('stroke-measurement');
            if ((e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) && !isMeasurement) {
                return;
            }
            
            // Don't cycle if text tool is active (user might be typing)
            if (this.toolManager.activeTool === this.toolManager.tools.text) {
                return;
            }
            
            if (e.key === 'Tab') {
                // Prevent default tab behavior (focus switching)
                e.preventDefault();
                e.stopPropagation();
                
                // Blur any active element to ensure focus doesn't get stuck
                if (document.activeElement && document.activeElement !== document.body) {
                    document.activeElement.blur();
                }
                
                const currentTool = this.toolManager.activeTool;
                const drawingModeToggle = document.getElementById('drawingModeToggle');
                
                if (currentTool === this.toolManager.tools.line) {
                    // Straight Line -> Curved Line
                    this.toolManager.selectTool('curve');
                    if (drawingModeToggle) {
                        this.updateToggleLabel(drawingModeToggle, 'Curved Line');
                    }
                } else if (currentTool === this.toolManager.tools.curve) {
                    // Curved Line -> Select
                    this.toolManager.selectTool('select');
                    if (drawingModeToggle) {
                        this.updateToggleLabel(drawingModeToggle, 'Select');
                    }
                } else {
                    // Select (or any other tool) -> Straight Line
                    this.toolManager.selectTool('line');
                    if (drawingModeToggle) {
                        this.updateToggleLabel(drawingModeToggle, 'Straight Line');
                    }
                }
            }
        }, true); // Use capture phase
    }
    
    updateToggleLabel(button, text) {
        const longSpan = button.querySelector('.label-long');
        const shortSpan = button.querySelector('.label-short');
        if (longSpan) longSpan.textContent = text;
        if (shortSpan) {
            // Set short label based on text
            if (text === 'Straight Line') {
                shortSpan.textContent = 'Straight';
            } else if (text === 'Curved Line') {
                shortSpan.textContent = 'Curved';
            } else if (text === 'Select') {
                shortSpan.textContent = 'Select';
            } else {
                shortSpan.textContent = text;
            }
        }
    }
    
    applyImageFitMode(fitMode) {
        const currentView = this.projectManager.views[this.projectManager.currentViewId];
        
        if (!currentView || !currentView.image) {
            console.warn('No current image available for fit mode');
            return;
        }
        
        // Simply call the project manager's setBackgroundImage with the fit mode
        this.projectManager.setBackgroundImage(currentView.image, fitMode);
    }
    
    setupKeyboardControls() {
        // Create +/- buttons for resizing capture frame
        this.captureFrameScale = 1.0;
        
        document.addEventListener('keydown', (e) => {
            // Don't interfere if typing in input fields
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
                return;
            }
            
            // Handle capture frame resize shortcuts
            let scaleChange = 0;
            
            if (e.key === '+' || e.key === '=') {
                scaleChange = 0.1; // Increase by 10%
            } else if (e.key === '-') {
                scaleChange = -0.1; // Decrease by 10%
            }
            
            if (scaleChange !== 0) {
                e.preventDefault();
                this.resizeCaptureFrameProportionally(scaleChange);
                return;
            }
            
            // Handle help menu toggle
            if (e.key === 'h' || e.key === 'H') {
                e.preventDefault();
                this.toggleHelpMenu();
            }
        });
    }
    
    resizeCaptureFrameProportionally(scaleChange) {
        const captureFrame = document.getElementById('captureFrame');
        if (!captureFrame) return;
        
        this.captureFrameScale = Math.max(0.2, Math.min(3.0, this.captureFrameScale + scaleChange));
        
        const baseWidth = 800;
        const baseHeight = 600;
        const aspectRatio = 4 / 3;
        
        const newWidth = baseWidth * this.captureFrameScale;
        const newHeight = baseHeight * this.captureFrameScale;
        
        // Ensure frame fits within viewport
        const maxWidth = window.innerWidth * 0.9;
        const maxHeight = window.innerHeight * 0.9;
        
        let frameWidth = newWidth;
        let frameHeight = newHeight;
        
        if (frameWidth > maxWidth) {
            frameWidth = maxWidth;
            frameHeight = frameWidth / aspectRatio;
            this.captureFrameScale = frameWidth / baseWidth;
        }
        
        if (frameHeight > maxHeight) {
            frameHeight = maxHeight;
            frameWidth = frameHeight * aspectRatio;
            this.captureFrameScale = frameHeight / baseHeight;
        }
        
        // Center the frame
        const left = (window.innerWidth - frameWidth) / 2;
        const top = (window.innerHeight - frameHeight) / 2;
        
        // Apply the new size and position
        captureFrame.style.left = `${left}px`;
        captureFrame.style.top = `${top}px`;
        captureFrame.style.width = `${frameWidth}px`;
        captureFrame.style.height = `${frameHeight}px`;
        
        // Save the new capture frame position for the current image
        if (window.saveCurrentCaptureFrameForLabel) {
            window.saveCurrentCaptureFrameForLabel(this.projectManager.currentViewId);
        }
        
        console.log(`[CaptureFrame] Proportional resize: ${(this.captureFrameScale * 100).toFixed(0)}% (${frameWidth.toFixed(0)}x${frameHeight.toFixed(0)})`);
    }
    
    createHelpHint() {
        // Create help hint in bottom right corner
        const helpHint = document.createElement('div');
        helpHint.id = 'helpHint';
        helpHint.innerHTML = 'Press <kbd>H</kbd> for help';
        helpHint.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: rgba(0, 0, 0, 0.7);
            color: white;
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 12px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            z-index: 1000;
            pointer-events: none;
        `;
        
        // Style the kbd element
        const kbd = helpHint.querySelector('kbd');
        if (kbd) {
            kbd.style.cssText = `
                background: rgba(255, 255, 255, 0.2);
                border: 1px solid rgba(255, 255, 255, 0.3);
                border-radius: 3px;
                padding: 2px 4px;
                font-size: 11px;
                font-weight: bold;
            `;
        }
        
        document.body.appendChild(helpHint);
    }
    
    createHelpMenu() {
        const helpOverlay = document.createElement('div');
        helpOverlay.id = 'helpOverlay';
        helpOverlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
        `;
        
        const helpMenu = document.createElement('div');
        helpMenu.style.cssText = `
            background: white;
            border-radius: 12px;
            padding: 30px;
            max-width: 500px;
            max-height: 80vh;
            overflow-y: auto;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
        `;
        
        helpMenu.innerHTML = `
            <h2 style="margin-top: 0; margin-bottom: 20px; color: #333; font-size: 24px; font-weight: 600;">Keyboard Shortcuts</h2>
            
            <div style="margin-bottom: 20px;">
                <h3 style="color: #555; font-size: 16px; margin-bottom: 10px; font-weight: 600;">Drawing Tools</h3>
                <div style="display: grid; grid-template-columns: auto 1fr; gap: 8px 16px; font-size: 14px;">
                    <kbd>Tab</kbd><span>Cycle through drawing modes (Line → Curve → Select)</span>
                </div>
            </div>
            
            <div style="margin-bottom: 20px;">
                <h3 style="color: #555; font-size: 16px; margin-bottom: 10px; font-weight: 600;">Capture Frame</h3>
                <div style="display: grid; grid-template-columns: auto 1fr; gap: 8px 16px; font-size: 14px;">
                    <kbd>+</kbd><span>Increase capture frame size</span>
                    <kbd>-</kbd><span>Decrease capture frame size</span>
                </div>
            </div>
            
            <div style="margin-bottom: 20px;">
                <h3 style="color: #555; font-size: 16px; margin-bottom: 10px; font-weight: 600;">General</h3>
                <div style="display: grid; grid-template-columns: auto 1fr; gap: 8px 16px; font-size: 14px;">
                    <kbd>H</kbd><span>Show/hide this help menu</span>
                </div>
            </div>
            
            <div style="text-align: center; margin-top: 25px;">
                <button id="closeHelp" style="
                    background: #3b82f6;
                    color: white;
                    border: none;
                    padding: 10px 20px;
                    border-radius: 6px;
                    font-size: 14px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: background 0.2s;
                ">Close</button>
            </div>
        `;
        
        // Style all kbd elements
        const kbdElements = helpMenu.querySelectorAll('kbd');
        kbdElements.forEach(kbd => {
            kbd.style.cssText = `
                background: #f3f4f6;
                border: 1px solid #d1d5db;
                border-radius: 4px;
                padding: 2px 6px;
                font-size: 12px;
                font-weight: bold;
                color: #374151;
                font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            `;
        });
        
        helpOverlay.appendChild(helpMenu);
        document.body.appendChild(helpOverlay);
        
        // Close help menu handlers
        const closeBtn = helpMenu.querySelector('#closeHelp');
        closeBtn.addEventListener('click', () => {
            document.body.removeChild(helpOverlay);
        });
        
        // Close on overlay click
        helpOverlay.addEventListener('click', (e) => {
            if (e.target === helpOverlay) {
                document.body.removeChild(helpOverlay);
            }
        });
        
        // Close on Escape key
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                document.body.removeChild(helpOverlay);
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);
    }
    
    toggleHelpMenu() {
        const existingOverlay = document.getElementById('helpOverlay');
        if (existingOverlay) {
            document.body.removeChild(existingOverlay);
        } else {
            this.createHelpMenu();
        }
    }
}

// Start the app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});
