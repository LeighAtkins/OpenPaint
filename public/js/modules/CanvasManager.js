// Canvas Manager
// Handles Fabric.js canvas initialization, resizing, zoom/pan

export class CanvasManager {
    constructor(canvasId) {
        this.canvasId = canvasId;
        this.fabricCanvas = null;
    }

    init() {
        // fabric is loaded globally via CDN in index.html
        if (typeof fabric === 'undefined') {
            console.error('Fabric.js library not found!');
            return;
        }

        // Ensure canvas element exists
        const canvasEl = document.getElementById(this.canvasId);
        if (!canvasEl) {
            console.error(`Canvas element with id "${this.canvasId}" not found!`);
            return;
        }

        // Set initial dimensions before creating Fabric canvas
        const width = window.innerWidth;
        const height = window.innerHeight;
        
        this.fabricCanvas = new fabric.Canvas(this.canvasId, {
            width: width,
            height: height,
            isDrawingMode: false, // Managed by ToolManager
            selection: true,
            preserveObjectStacking: true,
            backgroundColor: '#ffffff' // Default white background
        });

        console.log(`Fabric Canvas initialized: ${width}x${height}`);
        
        // Initialize zoom/pan events
        this.initZoomPan();
        
        // Initialize keyboard shortcuts
        this.initKeyboardShortcuts();
        
        // Listen for path creation (freehand drawing) to attach metadata and save history
        this.fabricCanvas.on('path:created', (e) => {
            const path = e.path;
            if (path) {
                // Make path selectable for moving/deleting
                path.set({
                    selectable: true,
                    evented: true
                });
                
                if (window.app && window.app.metadataManager && window.app.projectManager) {
                    // Attach metadata (label) to the path
                    const imageLabel = window.app.projectManager.currentViewId || 'front';
                    
                    // Set currentImageLabel for tag prediction system
                    window.currentImageLabel = imageLabel;
                    
                    const strokeLabel = window.app.metadataManager.getNextLabel(imageLabel);
                    window.app.metadataManager.attachMetadata(path, imageLabel, strokeLabel);
                    console.log(`Freehand path created with label: ${strokeLabel}`);
                    
                    // Create tag for the stroke
                    if (window.app.tagManager) {
                        setTimeout(() => {
                            window.app.tagManager.createTagForStroke(strokeLabel, imageLabel, path);
                        }, 100);
                    }
                    
                    // Small delay to ensure path is fully created before saving history
                    setTimeout(() => {
                        if (window.app && window.app.historyManager) {
                            window.app.historyManager.saveState();
                        }
                    }, 50);
                }
            }
        });
        
        // Ensure canvas is visible
        canvasEl.style.display = 'block';
    }
    
    initKeyboardShortcuts() {
        // Delete key handler
        document.addEventListener('keydown', (e) => {
            // Don't delete if typing in an input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
                return;
            }
            
            if ((e.key === 'Delete' || e.key === 'Backspace') && this.fabricCanvas) {
                const activeObjects = this.fabricCanvas.getActiveObjects();
                if (activeObjects.length > 0) {
                    e.preventDefault();
                    activeObjects.forEach(obj => {
                        this.fabricCanvas.remove(obj);
                    });
                    this.fabricCanvas.discardActiveObject();
                    this.fabricCanvas.requestRenderAll();
                    
                    // Trigger history save
                    if (window.app && window.app.historyManager) {
                        window.app.historyManager.saveState();
                    }
                }
            }
        });
    }

    resize() {
        if (!this.fabricCanvas) return;
        
        const container = document.getElementById('canvas-container');
        if (container) {
            this.fabricCanvas.setWidth(container.clientWidth);
            this.fabricCanvas.setHeight(container.clientHeight);
        } else {
             this.fabricCanvas.setWidth(window.innerWidth);
             this.fabricCanvas.setHeight(window.innerHeight);
        }
        this.fabricCanvas.renderAll();
    }

    initZoomPan() {
        if (!this.fabricCanvas) return;

        this.fabricCanvas.on('mouse:wheel', (opt) => {
            const delta = opt.e.deltaY;
            let zoom = this.fabricCanvas.getZoom();
            zoom *= 0.999 ** delta;
            if (zoom > 20) zoom = 20;
            if (zoom < 0.01) zoom = 0.01;
            
            this.fabricCanvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
            opt.e.preventDefault();
            opt.e.stopPropagation();
        });
        
        // Panning logic can be added here (e.g., Alt+Drag or Middle Click)
        let isDragging = false;
        let lastPosX;
        let lastPosY;

        this.fabricCanvas.on('mouse:down', (opt) => {
            const evt = opt.e;
            if (evt.altKey === true) {
                this.fabricCanvas.isDrawingMode = false; // Temporarily disable drawing
                isDragging = true;
                this.fabricCanvas.selection = false;
                lastPosX = evt.clientX;
                lastPosY = evt.clientY;
            }
        });

        this.fabricCanvas.on('mouse:move', (opt) => {
            if (isDragging) {
                const e = opt.e;
                const vpt = this.fabricCanvas.viewportTransform;
                vpt[4] += e.clientX - lastPosX;
                vpt[5] += e.clientY - lastPosY;
                this.fabricCanvas.requestRenderAll();
                lastPosX = e.clientX;
                lastPosY = e.clientY;
            }
        });

        this.fabricCanvas.on('mouse:up', (opt) => {
            if (isDragging) {
                this.fabricCanvas.setViewportTransform(this.fabricCanvas.viewportTransform);
                isDragging = false;
                this.fabricCanvas.selection = true;
                // Restore drawing mode state if needed (ToolManager should handle this ideally)
            }
        });
    }
    
    clear() {
        this.fabricCanvas.clear();
        this.fabricCanvas.setBackgroundColor('#ffffff', this.fabricCanvas.renderAll.bind(this.fabricCanvas));
    }
    
    // Helper to get JSON export
    toJSON() {
        return this.fabricCanvas.toJSON();
    }
    
    // Helper to load from JSON
    loadFromJSON(json, callback) {
        this.fabricCanvas.loadFromJSON(json, () => {
            this.fabricCanvas.renderAll();
            if (callback) callback();
        });
    }
}

