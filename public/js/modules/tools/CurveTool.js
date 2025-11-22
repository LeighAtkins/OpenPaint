// Curve Tool (Point-based curved line)
import { BaseTool } from './BaseTool.js';
import { PathUtils } from '../utils/PathUtils.js';
import { FabricControls } from '../utils/FabricControls.js';

export class CurveTool extends BaseTool {
    constructor(canvasManager) {
        super(canvasManager);
        this.points = [];
        this.previewPath = null;
        this.pointMarkers = []; // Visual markers for clicked points
        this.strokeColor = '#3b82f6'; // Default to bright blue
        this.strokeWidth = 2;
        this.isDrawing = false;
        this.dashPattern = []; // Dash pattern for curves

        // Bind event handlers
        this.onMouseDown = this.onMouseDown.bind(this);
        this.onMouseMove = this.onMouseMove.bind(this);
        this.onDoubleClick = this.onDoubleClick.bind(this);
        this.onKeyDown = this.onKeyDown.bind(this);
    }

    activate() {
        super.activate();
        if (!this.canvas) {
            console.error('CurveTool: Canvas not available');
            return;
        }
        // Keep selection enabled so objects can be dragged
        // We'll prevent drawing when clicking on objects in onMouseDown
        this.canvas.selection = true;
        this.canvas.defaultCursor = 'crosshair';
        this.canvas.on('mouse:down', this.onMouseDown);
        this.canvas.on('mouse:move', this.onMouseMove);
        this.canvas.on('mouse:dblclick', this.onDoubleClick);
        
        // Listen for ESC key to cancel
        document.addEventListener('keydown', this.onKeyDown);
        
        console.log(`CurveTool activated: color=${this.strokeColor}, width=${this.strokeWidth}`);
    }

    deactivate() {
        super.deactivate();
        this.cancelDrawing();
        this.canvas.selection = true;
        this.canvas.defaultCursor = 'default';
        this.canvas.off('mouse:down', this.onMouseDown);
        this.canvas.off('mouse:move', this.onMouseMove);
        this.canvas.off('mouse:dblclick', this.onDoubleClick);
        document.removeEventListener('keydown', this.onKeyDown);
    }

    onMouseDown(o) {
        if (!this.isActive) return;
        
        // Don't start drawing if this is a pan gesture (Alt, Shift, or touch gesture)
        const evt = o.e;
        if (evt.altKey || evt.shiftKey || this.canvas.isGestureActive) {
            console.log('[CurveTool] Ignoring mousedown - pan gesture detected');
            return;
        }
        
        // Don't start drawing if clicking on an existing object (allow dragging/moving)
        // Exception: label text objects (evented: false) should allow drawing through
        if (o.target && o.target.evented !== false) {
            return;
        }
        
        const pointer = this.canvas.getPointer(o.e);
        this.points.push({ x: pointer.x, y: pointer.y });
        
        // Add visual marker for the point
        const marker = new fabric.Circle({
            left: pointer.x,
            top: pointer.y,
            radius: 3,
            fill: this.strokeColor,
            originX: 'center',
            originY: 'center',
            selectable: false,
            evented: false,
            hasControls: false,
            hasBorders: false
        });
        this.canvas.add(marker);
        this.pointMarkers.push(marker);
        
        this.isDrawing = true;
        
        // If we have at least 2 points, create/update the curve preview
        if (this.points.length >= 2) {
            this.updatePreview();
        }
        
        this.canvas.renderAll();
    }

    onMouseMove(o) {
        if (!this.isDrawing || this.points.length === 0) return;
        
        const pointer = this.canvas.getPointer(o.e);
        
        // Update preview with current mouse position as temporary point
        if (this.points.length >= 1) {
            this.updatePreview(pointer);
        }
    }

    onDoubleClick(o) {
        if (!this.isActive) return;
        this.completeCurve();
    }

    onKeyDown(e) {
        if (!this.isActive) return;
        
        // ESC cancels current drawing
        if (e.key === 'Escape') {
            this.cancelDrawing();
        }
        // Enter completes the curve
        else if (e.key === 'Enter' && this.points.length >= 2) {
            this.completeCurve();
        }
    }

    updatePreview(tempPoint = null) {
        // Remove old preview
        if (this.previewPath) {
            this.canvas.remove(this.previewPath);
            this.previewPath = null;
        }

        if (this.points.length < 2) return;

        // Create path string for smooth curve through points
        const allPoints = tempPoint ? [...this.points, tempPoint] : this.points;
        const pathString = PathUtils.createSmoothPath(allPoints);

        // Create preview path
        this.previewPath = new fabric.Path(pathString, {
            stroke: this.strokeColor,
            strokeWidth: this.strokeWidth,
            fill: '',
            strokeDashArray: this.dashPattern.length > 0 ? this.dashPattern : null,
            selectable: false,
            evented: false,
            hasControls: false,
            hasBorders: false,
            opacity: tempPoint ? 0.6 : 1.0 // Dimmer if temporary
        });

        this.canvas.add(this.previewPath);
        this.canvas.renderAll();
    }

    completeCurve() {
        if (this.points.length < 2) {
            this.cancelDrawing();
            return;
        }

        // Calculate curve length to prevent tiny accidental curves
        let totalLength = 0;
        for (let i = 1; i < this.points.length; i++) {
            const dx = this.points[i].x - this.points[i-1].x;
            const dy = this.points[i].y - this.points[i-1].y;
            totalLength += Math.sqrt(dx * dx + dy * dy);
        }
        
        const minStrokeLength = 10; // pixels (larger for curves)
        if (totalLength < minStrokeLength) {
            console.log(`[CurveTool] Curve too short (${totalLength.toFixed(1)}px < ${minStrokeLength}px) - cancelling`);
            this.cancelDrawing();
            return;
        }
        
        console.log(`[CurveTool] Valid curve created (${totalLength.toFixed(1)}px)`);

        // Remove preview and markers
        if (this.previewPath) {
            this.canvas.remove(this.previewPath);
            this.previewPath = null;
        }
        this.pointMarkers.forEach(marker => this.canvas.remove(marker));
        this.pointMarkers = [];

        // Create final curve path
        const pathString = PathUtils.createSmoothPath(this.points);
        const curve = new fabric.Path(pathString, {
            stroke: this.strokeColor,
            strokeWidth: this.strokeWidth,
            fill: '',
            strokeDashArray: this.dashPattern.length > 0 ? this.dashPattern : null,
            selectable: true,
            evented: true
        });

        this.canvas.add(curve);
        
        // Store original points for editing
        curve.customPoints = [...this.points];
        
        // Add custom controls
        FabricControls.createCurveControls(curve);
        
        curve.setCoords();

        // Attach metadata (label) to the curve
        if (window.app && window.app.metadataManager && window.app.projectManager) {
            const imageLabel = window.app.projectManager.currentViewId || 'front';
            
            // Set currentImageLabel for tag prediction system
            window.currentImageLabel = imageLabel;
            
            const strokeLabel = window.app.metadataManager.getNextLabel(imageLabel);
            window.app.metadataManager.attachMetadata(curve, imageLabel, strokeLabel);
            console.log(`Curve created with label: ${strokeLabel}`);

            // Create tag for the curve
            if (window.app.tagManager) {
                setTimeout(() => {
                    window.app.tagManager.createTagForStroke(strokeLabel, imageLabel, curve);
                }, 50);
            }
        }

        // Save state after drawing completes
        if (window.app && window.app.historyManager) {
            window.app.historyManager.saveState();
        }

        // Reset for next curve
        this.points = [];
        this.isDrawing = false;
        this.canvas.renderAll();
    }

    cancelDrawing() {
        // Remove preview
        if (this.previewPath) {
            this.canvas.remove(this.previewPath);
            this.previewPath = null;
        }

        // Remove point markers
        this.pointMarkers.forEach(marker => this.canvas.remove(marker));
        this.pointMarkers = [];

        // Reset state
        this.points = [];
        this.isDrawing = false;
        this.canvas.renderAll();
    }

    setColor(color) {
        this.strokeColor = color;
    }

    setWidth(width) {
        this.strokeWidth = parseInt(width, 10);
    }
    
    setDashPattern(pattern) {
        // Update dash pattern for curves
        // Note: Curves use Path objects, dash patterns are applied via strokeDashArray
        this.dashPattern = pattern || [];
        // Update preview if drawing
        if (this.previewPath && this.points.length >= 2) {
            this.previewPath.set('strokeDashArray', this.dashPattern.length > 0 ? this.dashPattern : null);
            this.canvas.renderAll();
        }
    }
}

