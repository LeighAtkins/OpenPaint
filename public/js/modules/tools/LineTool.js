// Line Tool
import { BaseTool } from './BaseTool.js';
import { FabricControls } from '../utils/FabricControls.js';

export class LineTool extends BaseTool {
    constructor(canvasManager) {
        super(canvasManager);
        this.line = null;
        this.isDrawing = false;
        this.startX = 0;
        this.startY = 0;
        this.strokeColor = '#3b82f6'; // Default to bright blue
        this.strokeWidth = 2;
        this.dashPattern = []; // Empty = solid line
        
        // Bind event handlers
        this.onMouseDown = this.onMouseDown.bind(this);
        this.onMouseMove = this.onMouseMove.bind(this);
        this.onMouseUp = this.onMouseUp.bind(this);
    }

    activate() {
        super.activate();
        if (!this.canvas) {
            console.error('LineTool: Canvas not available');
            return;
        }
        
        // Disable group selection box while drawing to prevent accidental selection
        this.canvas.selection = false;
        
        // Disable events on all objects to preserve crosshair cursor and prevent dragging
        // Store original evented, selectable, and perPixelTargetFind states for full restoration
        this.originalEventedStates = new Map();
        this.originalSelectableStates = new Map();
        this.originalPerPixelTargetFindStates = new Map();
        this.canvas.forEachObject(obj => {
            // Skip label text objects (they should remain non-interactive)
            if (obj.evented === false && obj.selectable === false) {
                return;
            }
            this.originalEventedStates.set(obj, obj.evented);
            this.originalSelectableStates.set(obj, obj.selectable);
            this.originalPerPixelTargetFindStates.set(obj, obj.perPixelTargetFind);
            obj.set('evented', false);
            obj.set('selectable', false);
            obj.set('perPixelTargetFind', false);
        });

        // Listen for new objects being added and disable their events
        this.onObjectAdded = this.onObjectAdded.bind(this);
        this.canvas.on('object:added', this.onObjectAdded);
        
        this.canvas.on('mouse:down', this.onMouseDown);
        this.canvas.on('mouse:move', this.onMouseMove);
        this.canvas.on('mouse:up', this.onMouseUp);
        this.canvas.defaultCursor = 'crosshair';
        this.canvas.renderAll();
    }

    deactivate() {
        super.deactivate();

        // Restore original evented, selectable, and perPixelTargetFind states for all objects
        if (this.originalEventedStates) {
            this.originalEventedStates.forEach((originalEvented, obj) => {
                const originalSelectable = this.originalSelectableStates.get(obj);
                const originalPerPixelTargetFind = this.originalPerPixelTargetFindStates.get(obj);
                obj.set('evented', originalEvented);
                obj.set('selectable', originalSelectable !== undefined ? originalSelectable : true);
                obj.set('perPixelTargetFind', originalPerPixelTargetFind !== undefined ? originalPerPixelTargetFind : false);
            });
            this.originalEventedStates.clear();
        }
        if (this.originalSelectableStates) {
            this.originalSelectableStates.clear();
        }
        if (this.originalPerPixelTargetFindStates) {
            this.originalPerPixelTargetFindStates.clear();
        }

        this.canvas.selection = true;
        this.canvas.off('object:added', this.onObjectAdded);
        this.canvas.off('mouse:down', this.onMouseDown);
        this.canvas.off('mouse:move', this.onMouseMove);
        this.canvas.off('mouse:up', this.onMouseUp);
        this.canvas.defaultCursor = 'default';
        this.canvas.renderAll();
    }

    onObjectAdded(e) {
        const obj = e.target;
        // Disable events on newly added objects (except label text)
        if (obj && (obj.evented !== false || obj.selectable !== false)) {
            // Store the original states if we haven't seen this object before
            if (!this.originalEventedStates.has(obj)) {
                this.originalEventedStates.set(obj, obj.evented); // Store current evented state
                this.originalSelectableStates.set(obj, obj.selectable); // Store current selectable state
                this.originalPerPixelTargetFindStates.set(obj, obj.perPixelTargetFind); // Store perPixelTargetFind state
            }
            obj.set('evented', false);
            obj.set('selectable', false);
            obj.set('perPixelTargetFind', false);
        }
    }

    onMouseDown(o) {
        if (!this.isActive) return;

        // Don't start drawing if this is a pan gesture (Alt, Shift, or touch gesture)
        const evt = o.e;
        if (evt.altKey || evt.shiftKey || this.canvas.isGestureActive) {
            console.log('[LineTool] Ignoring mousedown - modifier key or gesture detected');
            return;
        }

        // Strict draw-only mode: all modifier keys just ignore the click
        // Ctrl, Shift, Alt are already handled above or reserved for other features

        // Enforce draw-only mode: disable all object interactions before drawing
        // (objects may have been made interactive after previous drawing)
        this.canvas.forEachObject(obj => {
            if (obj.evented !== false || obj.selectable !== false || obj.perPixelTargetFind !== false) {
                // Update the tracking maps in case this is a new or re-enabled object
                if (!this.originalEventedStates.has(obj)) {
                    this.originalEventedStates.set(obj, obj.evented);
                    this.originalSelectableStates.set(obj, obj.selectable);
                    this.originalPerPixelTargetFindStates.set(obj, obj.perPixelTargetFind);
                }
                obj.set('evented', false);
                obj.set('selectable', false);
                obj.set('perPixelTargetFind', false);
            }
        });

        // Temporarily disable selection to prevent new line from being selected during drawing
        this.canvas.selection = false;

        this.isDrawing = true;
        const pointer = this.canvas.getPointer(o.e);
        this.startX = pointer.x;
        this.startY = pointer.y;

        const points = [this.startX, this.startY, this.startX, this.startY];
        this.line = new fabric.Line(points, {
            strokeWidth: this.strokeWidth,
            stroke: this.strokeColor,
            originX: 'center',
            originY: 'center',
            strokeDashArray: this.dashPattern.length > 0 ? this.dashPattern : null,
            selectable: false, // Not selectable during drawing
            evented: false // Not interactive during drawing
        });

        // Apply arrow settings if available
        if (window.app && window.app.arrowManager) {
            window.app.arrowManager.applyArrows(this.line);
        }

        this.canvas.add(this.line);
    }

    onMouseMove(o) {
        if (!this.isDrawing) return;
        const pointer = this.canvas.getPointer(o.e);
        this.line.set({ x2: pointer.x, y2: pointer.y });
        this.canvas.requestRenderAll();
    }

    onMouseUp(o) {
        if (!this.isDrawing) return;
        
        // Don't complete drawing if this is the end of a touch gesture
        if (this.canvas.isGestureActive) {
            console.log('[LineTool] Ignoring mouseup - touch gesture ending');
            this.isDrawing = false;
            
            // Clean up the line that was created during the gesture
            if (this.line) {
                this.canvas.remove(this.line);
                this.line = null;
            }
            
            // Re-enable selection
            this.canvas.selection = true;
            this.canvas.requestRenderAll();
            return;
        }
        
        this.isDrawing = false;
        
        // Calculate stroke length to prevent tiny accidental strokes
        const endPointer = this.canvas.getPointer(o.e);
        const deltaX = endPointer.x - this.startX;
        const deltaY = endPointer.y - this.startY;
        const strokeLength = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        const minStrokeLength = 5; // pixels
        
        if (strokeLength < minStrokeLength) {
            console.log(`[LineTool] Stroke too short (${strokeLength.toFixed(1)}px < ${minStrokeLength}px) - removing`);
            // Remove the line if it's too short
            this.canvas.remove(this.line);
            this.line = null;
            
            // Re-enable selection for the canvas
            this.canvas.selection = true;
            this.canvas.requestRenderAll();
            return;
        }
        
        console.log(`[LineTool] Valid stroke created (${strokeLength.toFixed(1)}px)`);
        
        // Make line selectable and interactive now that drawing is complete
        this.line.set({
            selectable: true,
            evented: true
        });
        
        // Add custom controls
        FabricControls.createLineControls(this.line);
        
        this.line.setCoords();
        
        // Re-enable selection for the canvas
        this.canvas.selection = true;
        
        this.canvas.requestRenderAll();
        
        // Attach metadata (label) to the line
        if (window.app && window.app.metadataManager && window.app.projectManager) {
            const imageLabel = window.app.projectManager.currentViewId || 'front';
            
            // Set currentImageLabel for tag prediction system
            window.currentImageLabel = imageLabel;
            
            const strokeLabel = window.app.metadataManager.getNextLabel(imageLabel);
            window.app.metadataManager.attachMetadata(this.line, imageLabel, strokeLabel);
            console.log(`Line created with label: ${strokeLabel}`);
            
            // Create tag for the stroke
            if (window.app.tagManager) {
                setTimeout(() => {
                    window.app.tagManager.createTagForStroke(strokeLabel, imageLabel, this.line);
                }, 50);
            }
        }
        
        // Save state after drawing completes
        if (window.app && window.app.historyManager) {
            window.app.historyManager.saveState();
        }
    }
    
    setColor(color) {
        this.strokeColor = color;
    }
    
    setWidth(width) {
        this.strokeWidth = parseInt(width, 10);
    }
    
    setDashPattern(pattern) {
        this.dashPattern = pattern || [];
        // Update existing line if drawing
        if (this.line && this.isDrawing) {
            this.line.set('strokeDashArray', this.dashPattern.length > 0 ? this.dashPattern : null);
            this.canvas.requestRenderAll();
        }
    }
}

