// Main Entry Point
import { CanvasManager } from './CanvasManager.js';
import { ToolManager } from './tools/ToolManager.js';
import { ProjectManager } from './ProjectManager.js';
import { HistoryManager } from './HistoryManager.js';
import { StrokeMetadataManager } from './StrokeMetadataManager.js';
import { setupDebugHelpers } from './DebugHelpers.js';
import { TagManager } from './TagManager.js';
import { UploadManager } from './UploadManager.js';

class App {
    constructor() {
        this.canvasManager = new CanvasManager('canvas');
        this.historyManager = new HistoryManager(this.canvasManager);
        this.toolManager = new ToolManager(this.canvasManager);
        this.metadataManager = new StrokeMetadataManager();
        this.tagManager = new TagManager(this.canvasManager, this.metadataManager);
        this.projectManager = new ProjectManager(this.canvasManager, this.historyManager);
        this.uploadManager = new UploadManager(this.projectManager);

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
            brushSizeSlider.addEventListener('input', (e) => {
                const width = parseInt(e.target.value, 10);
                this.toolManager.updateSettings({ width: width });
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
                    'dotted': [2, 5], // Dotted line option
                    'custom': [5, 5] // Default custom pattern
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
        
            // Make metadata manager available globally for compatibility
            window.metadataManager = this.metadataManager;
            window.vectorStrokesByImage = this.metadataManager.vectorStrokesByImage;
            window.strokeVisibilityByImage = this.metadataManager.strokeVisibilityByImage;
            window.strokeLabelVisibility = this.metadataManager.strokeLabelVisibility;
            window.strokeMeasurements = this.metadataManager.strokeMeasurements;
            
            // Make project manager available globally for image switching
            window.projectManager = this.projectManager;
            window.app = this; // Make app available globally
            
            // Setup debug helpers
            setupDebugHelpers(this);
    }
    
    setupKeyboardShortcuts() {
        // Tab key cycles through drawing modes: Straight Line -> Curved Line -> Select -> Straight Line
        document.addEventListener('keydown', (e) => {
            // Don't cycle if typing in an input/textarea or if text tool is active
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
                return;
            }
            
            // Don't cycle if text tool is active (user might be typing)
            if (this.toolManager.activeTool === this.toolManager.tools.text) {
                return;
            }
            
            if (e.key === 'Tab') {
                e.preventDefault();
                
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
        });
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
}

// Start the app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});
