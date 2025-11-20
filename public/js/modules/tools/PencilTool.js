// Pencil Tool (Freehand)
import { BaseTool } from './BaseTool.js';

export class PencilTool extends BaseTool {
    constructor(canvasManager) {
        super(canvasManager);
        this.brushColor = '#3b82f6'; // Default to bright blue
        this.brushWidth = 2;
    }

    activate() {
        super.activate();
        if (!this.canvas) {
            console.error('PencilTool: Canvas not available');
            return;
        }
        // Disable selection when drawing
        this.canvas.selection = false;
        this.canvas.isDrawingMode = true;
        this.canvas.freeDrawingBrush = new fabric.PencilBrush(this.canvas);
        this.canvas.freeDrawingBrush.color = this.brushColor;
        this.canvas.freeDrawingBrush.width = this.brushWidth;
        console.log(`PencilTool activated: color=${this.brushColor}, width=${this.brushWidth}`);
    }
    
    deactivate() {
        super.deactivate();
        if (this.canvas) {
            this.canvas.isDrawingMode = false;
            // Re-enable selection when leaving drawing mode
            this.canvas.selection = true;
        }
    }
    
    setColor(color) {
        this.brushColor = color;
        if (this.isActive && this.canvas.freeDrawingBrush) {
            this.canvas.freeDrawingBrush.color = color;
        }
    }
    
    setWidth(width) {
        this.brushWidth = parseInt(width, 10);
        if (this.isActive && this.canvas.freeDrawingBrush) {
            this.canvas.freeDrawingBrush.width = this.brushWidth;
        }
    }
}

