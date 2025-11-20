// Select Tool (for moving/deleting objects)
import { BaseTool } from './BaseTool.js';

export class SelectTool extends BaseTool {
    constructor(canvasManager) {
        super(canvasManager);
    }

    activate() {
        super.activate();
        if (!this.canvas) {
            console.error('SelectTool: Canvas not available');
            return;
        }
        
        // Enable selection and object manipulation
        this.canvas.isDrawingMode = false;
        this.canvas.selection = true;
        this.canvas.defaultCursor = 'default';
        
        // Enable object controls for all objects (except label text)
        this.canvas.forEachObject(obj => {
            // Skip label text objects (they have evented: false)
            if (obj.evented === false && obj.selectable === false) {
                return; // Skip label objects
            }
            obj.selectable = true;
            obj.evented = true;
        });
        
        this.canvas.renderAll();
        console.log('SelectTool activated');
    }

    deactivate() {
        super.deactivate();
        // Selection stays enabled, just mark as inactive
    }
}

