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

        // Enable selection only when Ctrl is pressed or in Select mode
        this.fabricCanvas.selection = false; // Default to false (drawing mode)

        this.fabricCanvas.on('mouse:down', (opt) => {
            const evt = opt.e;
            // Check if Ctrl key is pressed (or Meta key for Mac)
            if (evt.ctrlKey || evt.metaKey) {
                this.fabricCanvas.selection = true;
                // If we are in drawing mode, we might need to temporarily disable it?
                // Fabric handles this: if isDrawingMode is true, selection is disabled.
                // So we need to temporarily disable drawing mode if it's on.
                if (this.fabricCanvas.isDrawingMode) {
                    this.fabricCanvas.isDrawingMode = false;
                    this.fabricCanvas._tempDrawingMode = true; // Flag to restore later
                }
            } else {
                // If not Ctrl, ensure selection is false unless we are in Select tool
                // We need to check the active tool. 
                // Accessing ToolManager from here is tricky.
                // Better: ToolManager sets selection=true/false.
                // But for the shortcut, we override.
                
                // If we are NOT in select tool (which sets selection=true), disable selection
                // We can check isDrawingMode.
                // If isDrawingMode is false, we might be in Select tool OR just idle.
                // Let's assume ToolManager manages the default state.
                // We only want to ENABLE it if Ctrl is pressed.
                
                // Actually, the requirement is "Add a shortcut to 'select' by ctrl + click dragging".
                // This implies that normally (without Ctrl), we are drawing.
                // So we just need to enable selection when Ctrl is down.
            }
        });

        this.fabricCanvas.on('mouse:up', (opt) => {
             // Restore state if we changed it
             if (this.fabricCanvas._tempDrawingMode) {
                 this.fabricCanvas.isDrawingMode = true;
                 this.fabricCanvas.selection = false;
                 delete this.fabricCanvas._tempDrawingMode;
             } else if (!this.fabricCanvas.isDrawingMode) {
                 // If we were not in drawing mode, check if we should disable selection
                 // If the active tool is NOT select, we should probably disable selection?
                 // But we don't know the active tool here easily.
                 
                 // Let's just rely on the key up event?
                 // Mouse up is safer for the drag operation end.
                 
                 // If we enabled selection just for this drag, disable it now?
                 // But standard behavior is: hold Ctrl to select.
                 // If I release mouse but keep Ctrl, I should still be able to select?
                 // Fabric updates selection property dynamically? No.
             }
        });
        
        // Better approach: Listen to keydown/keyup for Ctrl
        // This is global.
        document.addEventListener('keydown', (e) => {
            if ((e.key === 'Control' || e.key === 'Meta') && this.fabricCanvas) {
                // If currently drawing, disable drawing mode temporarily
                if (this.fabricCanvas.isDrawingMode) {
                    this.fabricCanvas.isDrawingMode = false;
                    this.fabricCanvas._tempDrawingMode = true;
                }
                this.fabricCanvas.selection = true;
                this.fabricCanvas.defaultCursor = 'default';
                this.fabricCanvas.hoverCursor = 'move';
                // Make objects selectable? They usually are, just evented=false in some tools.
                // We might need to update objects to be selectable.
                this.fabricCanvas.forEachObject(obj => {
                    if (!obj.isTag && !obj.lockMovementX) { // Don't unlock locked stuff
                        obj.selectable = true;
                        obj.evented = true;
                    }
                });
            }
        });

        document.addEventListener('keyup', (e) => {
            if ((e.key === 'Control' || e.key === 'Meta') && this.fabricCanvas) {
                // Check if multi-select was made BEFORE disabling selection
                const activeObj = this.fabricCanvas.getActiveObject();
                const hasMultiSelection = activeObj && activeObj.type === 'activeSelection';

                this.fabricCanvas.selection = false; // Disable selection box

                if (this.fabricCanvas._tempDrawingMode) {
                    this.fabricCanvas.isDrawingMode = true;
                    delete this.fabricCanvas._tempDrawingMode;
                }

                // Auto-switch to Select tool if multi-select was made while in drawing mode
                if (hasMultiSelection) {
                    // Multi-selection exists, switch to Select tool for manipulation
                    if (window.app && window.app.toolManager) {
                        console.log('[CanvasManager] Auto-switching to Select tool after multi-select');
                        window.app.toolManager.selectTool('select');
                    }
                } else {
                    // No multi-selection made - restore drawing tool's object event states
                    // Objects should be unselectable/unevented if we're in a drawing tool
                    if (window.app && window.app.toolManager) {
                        const activeTool = window.app.toolManager.activeTool;
                        if (activeTool && (activeTool.constructor.name === 'LineTool' || activeTool.constructor.name === 'CurveTool')) {
                            // We're in a drawing tool, restore the strict draw-only mode
                            this.fabricCanvas.forEachObject(obj => {
                                if (!obj.isTag && !obj.lockMovementX) {
                                    obj.selectable = false;
                                    obj.evented = false;
                                }
                            });
                            console.log('[CanvasManager] Restored draw-only mode (no multi-select made)');
                        }
                    }
                }
            }
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
        
        // Listen for object removal to update stroke list
        this.fabricCanvas.on('object:removed', (e) => {
            const obj = e.target;
            if (obj && window.app && window.app.metadataManager) {
                // We need to check if this object has metadata and remove it
                // Or simply refresh the list.
                // Since metadata is attached to the object, if the object is gone, 
                // we should probably remove it from our tracking or at least update the UI.
                
                // However, StrokeMetadataManager tracks strokes by image label.
                // If we delete an object, we should probably remove it from the manager too.
                // But the manager usually iterates over canvas objects to build the list.
                // So calling updateStrokeVisibilityControls() should be enough if it re-scans.
                
                // Let's check updateStrokeVisibilityControls implementation.
                // It iterates over canvas objects. So refreshing is correct.
                
                // Debounce the update to avoid multiple refreshes when deleting multiple objects
                if (this._updateTimeout) clearTimeout(this._updateTimeout);
                this._updateTimeout = setTimeout(() => {
                    window.app.metadataManager.updateStrokeVisibilityControls();
                }, 50);
            }
        });
        
        // Ensure canvas is visible
        canvasEl.style.display = 'block';
    }
    
    initKeyboardShortcuts() {
        // Delete key handler
        document.addEventListener('keydown', (e) => {
            // Don't delete if typing in an input
            // Don't delete if typing in an input
            const isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
            const isContentEditable = e.target.isContentEditable;
            
            if (isInput || isContentEditable) {
                return;
            }
            
            if ((e.key === 'Delete' || e.key === 'Backspace') && this.fabricCanvas) {
                const activeObjects = this.fabricCanvas.getActiveObjects();
                if (activeObjects.length > 0) {
                    e.preventDefault();
                    activeObjects.forEach(obj => {
                        // Clean up stroke metadata before removing from canvas
                        if (obj.strokeMetadata) {
                            const strokeLabel = obj.strokeMetadata.strokeLabel;
                            const imageLabel = obj.strokeMetadata.imageLabel;

                            // Remove from metadata manager
                            if (window.app?.metadataManager) {
                                const metadata = window.app.metadataManager;
                                if (metadata.vectorStrokesByImage[imageLabel]) {
                                    delete metadata.vectorStrokesByImage[imageLabel][strokeLabel];
                                }
                                if (metadata.strokeVisibilityByImage[imageLabel]) {
                                    delete metadata.strokeVisibilityByImage[imageLabel][strokeLabel];
                                }
                                if (metadata.strokeLabelVisibility[imageLabel]) {
                                    delete metadata.strokeLabelVisibility[imageLabel][strokeLabel];
                                }
                                if (metadata.strokeMeasurements[imageLabel]) {
                                    delete metadata.strokeMeasurements[imageLabel][strokeLabel];
                                }
                            }

                            // Remove tag
                            if (window.app?.tagManager) {
                                window.app.tagManager.removeTag(strokeLabel);
                            }
                        }

                        this.fabricCanvas.remove(obj);
                    });
                    this.fabricCanvas.discardActiveObject();
                    this.fabricCanvas.requestRenderAll();

                    // Update visibility panel after metadata cleanup
                    if (window.app?.metadataManager) {
                        window.app.metadataManager.updateStrokeVisibilityControls();
                    }

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

        // Update tag connectors when strokes are moved (including multi-select)
        // Note: Tags are non-selectable, so only strokes trigger this handler
        this.fabricCanvas.on('object:moving', (e) => {
            const movingObj = e.target;

            if (!window.app?.tagManager) return;

            // Handle both single objects and multi-selections (activeSelection)
            if (movingObj.type === 'activeSelection') {
                // Multiple strokes are selected and being moved
                const objects = movingObj.getObjects();
                const tagManager = window.app.tagManager;

                // Update connectors for all strokes in the selection
                objects.forEach(obj => {
                    // Handle lines, paths (curves), and groups (arrows), but skip tags
                    if ((obj.type === 'line' || obj.type === 'path' || obj.type === 'group') && !obj.isTag) {
                        // Find the tag associated with this stroke
                        for (const [strokeLabel, tagObj] of tagManager.tagObjects.entries()) {
                            if (tagObj.connectedStroke === obj) {
                                tagManager.updateConnector(strokeLabel);
                                break;
                            }
                        }
                    }
                });
            } else if ((movingObj.type === 'line' || movingObj.type === 'path' || movingObj.type === 'group') && !movingObj.isTag) {
                // Single stroke being moved - find and update its tag's connector
                const tagManager = window.app.tagManager;
                for (const [strokeLabel, tagObj] of tagManager.tagObjects.entries()) {
                    if (tagObj.connectedStroke === movingObj) {
                        tagManager.updateConnector(strokeLabel);
                        break;
                    }
                }
            }

            // Request render to ensure connectors and tags display correctly
            this.fabricCanvas.requestRenderAll();
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

