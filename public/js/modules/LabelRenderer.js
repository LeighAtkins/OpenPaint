// Label Renderer
// Renders labels (A1, A2, etc.) next to strokes on the canvas

export class LabelRenderer {
    constructor(canvasManager, metadataManager) {
        this.canvasManager = canvasManager;
        this.metadataManager = metadataManager;
        this.labelObjects = new Map(); // Map of stroke label -> Fabric text object
        this.updatePending = false; // Debounce flag
    }
    
    // Render labels for all visible strokes
    renderLabels() {
        const canvas = this.canvasManager.fabricCanvas;
        if (!canvas) return;
        
        // Clear existing labels
        this.clearLabels();
        
        const currentViewId = window.app?.projectManager?.currentViewId || 'front';
        const strokes = this.metadataManager.vectorStrokesByImage[currentViewId] || {};
        
        Object.entries(strokes).forEach(([strokeLabel, fabricObj]) => {
            // Check visibility
            const isVisible = this.metadataManager.strokeVisibilityByImage[currentViewId]?.[strokeLabel] !== false;
            const isLabelVisible = this.metadataManager.strokeLabelVisibility[currentViewId]?.[strokeLabel] !== false;
            
            if (!isVisible || !isLabelVisible || !fabricObj) return;
            
            // Get object bounds
            const bounds = fabricObj.getBoundingRect();
            const centerX = bounds.left + bounds.width / 2;
            const centerY = bounds.top + bounds.height / 2;
            
            // Create label text (non-interactive overlay)
            // Note: Fabric.js may show a warning about 'alphabetical' textBaseline,
            // but this is harmless - Fabric.js uses it internally and it still works
            const labelText = new fabric.Text(strokeLabel, {
                left: centerX + 15, // Offset to the right
                top: centerY - 10,  // Offset upward slightly
                fontSize: 14,
                fill: '#000000',
                fontFamily: 'Arial',
                selectable: false,
                evented: false,
                hasControls: false,
                hasBorders: false,
                excludeFromExport: false
            });
            
            canvas.add(labelText);
            this.labelObjects.set(strokeLabel, labelText);
        });
        
        canvas.renderAll();
    }
    
    // Clear all labels
    clearLabels() {
        const canvas = this.canvasManager.fabricCanvas;
        if (!canvas) return;
        
        this.labelObjects.forEach(labelObj => {
            canvas.remove(labelObj);
        });
        this.labelObjects.clear();
    }
    
    // Update labels (call after objects change)
    update() {
        // Debounce rapid updates
        if (this.updatePending) return;
        
        this.updatePending = true;
        requestAnimationFrame(() => {
            this.renderLabels();
            this.updatePending = false;
        });
    }
}

