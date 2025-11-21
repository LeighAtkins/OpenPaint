// Line Tool
import { BaseTool } from './BaseTool.js';

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
        // Keep selection enabled so objects can be dragged
        // We'll prevent drawing when clicking on objects in onMouseDown
        this.canvas.selection = true;
        this.canvas.on('mouse:down', this.onMouseDown);
        this.canvas.on('mouse:move', this.onMouseMove);
        this.canvas.on('mouse:up', this.onMouseUp);
        this.canvas.defaultCursor = 'crosshair';
    }

    deactivate() {
        super.deactivate();
        this.canvas.selection = true;
        this.canvas.off('mouse:down', this.onMouseDown);
        this.canvas.off('mouse:move', this.onMouseMove);
        this.canvas.off('mouse:up', this.onMouseUp);
        this.canvas.defaultCursor = 'default';
    }

    onMouseDown(o) {
        if (!this.isActive) return;
        
        // Don't start drawing if this is a pan gesture (Alt, Shift, or touch gesture)
        const evt = o.e;
        if (evt.altKey || evt.shiftKey || this.canvas.isGestureActive) {
            console.log('[LineTool] Ignoring mousedown - pan gesture detected');
            return;
        }
        
        // Don't start drawing if clicking on an existing object (allow dragging/moving)
        // Exception: label text objects (evented: false) should allow drawing through
        if (o.target && o.target.evented !== false) {
            return;
        }
        
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

