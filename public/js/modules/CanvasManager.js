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
        
        // Panning logic: Alt+Drag, Shift+Drag, or two-finger touch
        let isDragging = false;
        let lastPosX;
        let lastPosY;
        
        // Touch gesture state
        let touchGestureState = {
            isTwoFingerPan: false,
            isPinchZoom: false,
            lastTwoFingerCenter: null,
            lastTwoFingerDistance: null,
            activeTouches: new Map()
        };

        this.fabricCanvas.on('mouse:down', (opt) => {
            const evt = opt.e;
            if (evt.altKey === true || evt.shiftKey === true) {
                console.log('[PAN] Starting pan gesture with', evt.altKey ? 'Alt' : 'Shift');
                this.fabricCanvas.isDrawingMode = false; // Temporarily disable drawing
                isDragging = true;
                this.fabricCanvas.selection = false;
                lastPosX = evt.clientX;
                lastPosY = evt.clientY;
                
                // Set grabbing cursor
                this.fabricCanvas.upperCanvasEl.style.cursor = 'grabbing';
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
                console.log('[PAN] Ending pan gesture');
                this.fabricCanvas.setViewportTransform(this.fabricCanvas.viewportTransform);
                isDragging = false;
                this.fabricCanvas.selection = true;
                
                // Restore cursor based on current shift state
                const evt = opt.e;
                if (evt.shiftKey) {
                    this.fabricCanvas.upperCanvasEl.style.cursor = 'grab';
                } else {
                    this.fabricCanvas.upperCanvasEl.style.cursor = 'default';
                }
                
                // Restore drawing mode state if needed (ToolManager should handle this ideally)
            }
        });

        // Touch gesture helpers
        const getTwoFingerCenter = (touches) => {
            if (touches.length < 2) return null;
            const touch1 = touches[0];
            const touch2 = touches[1];
            return {
                x: (touch1.clientX + touch2.clientX) / 2,
                y: (touch1.clientY + touch2.clientY) / 2
            };
        };

        const getTwoFingerDistance = (touches) => {
            if (touches.length < 2) return null;
            const touch1 = touches[0];
            const touch2 = touches[1];
            const dx = touch1.clientX - touch2.clientX;
            const dy = touch1.clientY - touch2.clientY;
            return Math.sqrt(dx * dx + dy * dy);
        };

        // Touch event handlers for two-finger pan
        const canvasElement = this.fabricCanvas.upperCanvasEl;
        
        canvasElement.addEventListener('touchstart', (e) => {
            // Update active touches
            for (let i = 0; i < e.touches.length; i++) {
                const touch = e.touches[i];
                touchGestureState.activeTouches.set(touch.identifier, {
                    x: touch.clientX,
                    y: touch.clientY
                });
            }

            if (e.touches.length === 2) {
                console.log('[GESTURE] Starting two-finger gesture (pan/zoom)');
                // Two finger gesture detected - start both pan and pinch tracking
                touchGestureState.isTwoFingerPan = true;
                touchGestureState.isPinchZoom = true;
                touchGestureState.lastTwoFingerCenter = getTwoFingerCenter(e.touches);
                touchGestureState.lastTwoFingerDistance = getTwoFingerDistance(e.touches);
                
                // Disable Fabric.js drawing and selection during gesture
                this.fabricCanvas.isDrawingMode = false;
                this.fabricCanvas.selection = false;
                
                // Set a global flag that tools can check
                this.fabricCanvas.isGestureActive = true;
                
                e.preventDefault(); // Prevent default two-finger behaviors
            }
        }, { passive: false });

        canvasElement.addEventListener('touchmove', (e) => {
            if ((touchGestureState.isTwoFingerPan || touchGestureState.isPinchZoom) && e.touches.length === 2) {
                const currentCenter = getTwoFingerCenter(e.touches);
                const currentDistance = getTwoFingerDistance(e.touches);
                
                // Handle pinch-to-zoom
                if (touchGestureState.isPinchZoom && touchGestureState.lastTwoFingerDistance && currentDistance) {
                    const zoomRatio = currentDistance / touchGestureState.lastTwoFingerDistance;
                    let currentZoom = this.fabricCanvas.getZoom();
                    let newZoom = currentZoom * zoomRatio;
                    
                    // Clamp zoom levels
                    if (newZoom > 20) newZoom = 20;
                    if (newZoom < 0.01) newZoom = 0.01;
                    
                    if (Math.abs(zoomRatio - 1) > 0.01) { // Only zoom if significant change
                        console.log('[ZOOM] Pinch zoom:', (zoomRatio - 1 > 0 ? 'in' : 'out'), 'ratio:', zoomRatio.toFixed(3));
                        
                        // Get canvas-relative coordinates for zoom center
                        const canvasEl = this.fabricCanvas.upperCanvasEl;
                        const rect = canvasEl.getBoundingClientRect();
                        const zoomPoint = {
                            x: currentCenter.x - rect.left,
                            y: currentCenter.y - rect.top
                        };
                        
                        this.fabricCanvas.zoomToPoint(zoomPoint, newZoom);
                        touchGestureState.lastTwoFingerDistance = currentDistance;
                    }
                }
                
                // Handle two-finger pan (only if not zooming significantly)
                if (touchGestureState.isTwoFingerPan && touchGestureState.lastTwoFingerCenter && currentCenter) {
                    const deltaX = currentCenter.x - touchGestureState.lastTwoFingerCenter.x;
                    const deltaY = currentCenter.y - touchGestureState.lastTwoFingerCenter.y;
                    
                    // Only pan if movement is significant and not primarily a zoom gesture
                    if (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1) {
                        console.log('[PAN] Two-finger pan delta:', deltaX.toFixed(1), deltaY.toFixed(1));
                        
                        // Update viewport transform
                        const vpt = this.fabricCanvas.viewportTransform;
                        vpt[4] += deltaX;
                        vpt[5] += deltaY;
                        this.fabricCanvas.requestRenderAll();
                        
                        touchGestureState.lastTwoFingerCenter = currentCenter;
                    }
                }
                
                e.preventDefault();
            }
        }, { passive: false });

        canvasElement.addEventListener('touchend', (e) => {
            // Remove ended touches from active touches
            for (let i = 0; i < e.changedTouches.length; i++) {
                const touch = e.changedTouches[i];
                touchGestureState.activeTouches.delete(touch.identifier);
            }

            // If we were in two-finger mode and now have less than 2 touches, exit gesture mode
            if ((touchGestureState.isTwoFingerPan || touchGestureState.isPinchZoom) && e.touches.length < 2) {
                console.log('[GESTURE] Ending two-finger gesture (pan/zoom)');
                touchGestureState.isTwoFingerPan = false;
                touchGestureState.isPinchZoom = false;
                touchGestureState.lastTwoFingerCenter = null;
                touchGestureState.lastTwoFingerDistance = null;
                
                // Restore Fabric.js state
                this.fabricCanvas.setViewportTransform(this.fabricCanvas.viewportTransform);
                this.fabricCanvas.selection = true;
                
                // Delay clearing gesture flag to prevent residual drawing events
                setTimeout(() => {
                    this.fabricCanvas.isGestureActive = false;
                }, 100);
                
                // Drawing mode will be restored by ToolManager if needed
            }
        }, { passive: false });

        canvasElement.addEventListener('touchcancel', (e) => {
            // Reset touch state on cancel
            touchGestureState.activeTouches.clear();
            touchGestureState.isTwoFingerPan = false;
            touchGestureState.isPinchZoom = false;
            touchGestureState.lastTwoFingerCenter = null;
            touchGestureState.lastTwoFingerDistance = null;
            
            // Restore Fabric.js state
            this.fabricCanvas.selection = true;
            
            // Delay clearing gesture flag to prevent residual drawing events
            setTimeout(() => {
                this.fabricCanvas.isGestureActive = false;
            }, 100);
        }, { passive: false });

        // Keyboard event listeners for cursor feedback on shift key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Shift' && !isDragging) {
                console.log('[PAN] Shift key pressed - showing grab cursor');
                this.fabricCanvas.upperCanvasEl.style.cursor = 'grab';
            }
        });

        document.addEventListener('keyup', (e) => {
            if (e.key === 'Shift' && !isDragging) {
                console.log('[PAN] Shift key released - restoring default cursor');
                this.fabricCanvas.upperCanvasEl.style.cursor = 'default';
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

