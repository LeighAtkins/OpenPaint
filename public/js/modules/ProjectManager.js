// Project Manager
// Handles views (images) and their associated canvas states

export class ProjectManager {
    constructor(canvasManager, historyManager) {
        this.canvasManager = canvasManager;
        this.historyManager = historyManager;
        
        // Project Data
        this.currentViewId = 'front';
        this.views = {
            'front': { id: 'front', image: null, canvasData: null, metadata: null },
            'side': { id: 'side', image: null, canvasData: null, metadata: null },
            'back': { id: 'back', image: null, canvasData: null, metadata: null },
            'cushion': { id: 'cushion', image: null, canvasData: null, metadata: null }
        };
    }
    
    init() {
        console.log('ProjectManager initialized');
        // Load the initial view
        this.switchView('front');
    }
    
    // Switch to a different view (image)
    async switchView(viewId) {
        if (!this.views[viewId]) {
            console.warn(`View ${viewId} does not exist.`);
            return;
        }
        
        // If already on this view, don't clear everything
        if (this.currentViewId === viewId) {
            console.log(`Already on view: ${viewId}, refreshing image only`);
            const view = this.views[viewId];
            if (view.image) {
                await this.setBackgroundImage(view.image);
            }
            return;
        }
        
        console.log(`Switching to view: ${viewId}`);
        
        // 1. Save current state
        this.saveCurrentViewState();
        
        // 2. Clear history for the new view (or we could maintain separate history stacks per view)
        this.historyManager.clear();
        
        // 3. Switch context
        this.currentViewId = viewId;
        const view = this.views[viewId];
        
        // 4. Clear canvas
        this.canvasManager.clear();
        
        // 5. Load background image if exists
        if (view.image) {
            await this.setBackgroundImage(view.image);
        }
        
        // 6. Restore canvas objects (strokes/text)
        if (view.canvasData) {
            this.canvasManager.loadFromJSON(view.canvasData, () => {
                // Restore metadata for this view
                if (view.metadata && window.app?.metadataManager) {
                    window.app.metadataManager.vectorStrokesByImage[viewId] = view.metadata.vectorStrokesByImage || {};
                    window.app.metadataManager.strokeVisibilityByImage[viewId] = view.metadata.strokeVisibilityByImage || {};
                    window.app.metadataManager.strokeLabelVisibility[viewId] = view.metadata.strokeLabelVisibility || {};
                    window.app.metadataManager.strokeMeasurements[viewId] = view.metadata.strokeMeasurements || {};
                }
                
                // After loading, update history initial state
                this.historyManager.saveState();
            });
        } else {
            // Clear metadata for this view if no saved data
            if (window.app?.metadataManager) {
                window.app.metadataManager.clearImageMetadata(viewId);
            }
            this.historyManager.saveState();
        }
    }
    
    saveCurrentViewState() {
        const json = this.canvasManager.toJSON();
        if (this.views[this.currentViewId]) {
            this.views[this.currentViewId].canvasData = json;
            
            // Also save metadata for this view
            if (window.app?.metadataManager) {
                this.views[this.currentViewId].metadata = {
                    vectorStrokesByImage: JSON.parse(JSON.stringify(window.app.metadataManager.vectorStrokesByImage[this.currentViewId] || {})),
                    strokeVisibilityByImage: JSON.parse(JSON.stringify(window.app.metadataManager.strokeVisibilityByImage[this.currentViewId] || {})),
                    strokeLabelVisibility: JSON.parse(JSON.stringify(window.app.metadataManager.strokeLabelVisibility[this.currentViewId] || {})),
                    strokeMeasurements: JSON.parse(JSON.stringify(window.app.metadataManager.strokeMeasurements[this.currentViewId] || {}))
                };
            }
        }
    }
    
    // Add or update an image for a view
    async addImage(viewId, imageUrl, options = {}) {
        const { refreshBackground = true } = options;
        
        if (!this.views[viewId]) {
            // Create new view if it doesn't exist
            this.views[viewId] = { id: viewId, image: null, canvasData: null, metadata: null };
        }
        
        this.views[viewId].image = imageUrl;
        
        // Only refresh background if explicitly requested and this is the current view
        // This prevents flicker during batch uploads
        if (refreshBackground && this.currentViewId === viewId) {
            await this.setBackgroundImage(imageUrl);
        }
    }
    
    async setBackgroundImage(url, fitMode = 'fit-canvas') {
        return new Promise((resolve) => {
            fabric.Image.fromURL(url, (img) => {
                const canvas = this.canvasManager.fabricCanvas;
                if (!canvas) return resolve();
                
                const canvasWidth = canvas.width;
                const canvasHeight = canvas.height;
                const imgWidth = img.width;
                const imgHeight = img.height;
                
                let scale = 1;
                let left = canvasWidth / 2;
                let top = canvasHeight / 2;
                
                switch (fitMode) {
                    case 'fit-width':
                        scale = canvasWidth / imgWidth;
                        console.log(`[Image Fit Width] Canvas: ${canvasWidth}x${canvasHeight}, Image: ${imgWidth}x${imgHeight}, Scale: ${scale.toFixed(3)}`);
                        break;
                        
                    case 'fit-height':
                        scale = canvasHeight / imgHeight;
                        console.log(`[Image Fit Height] Canvas: ${canvasWidth}x${canvasHeight}, Image: ${imgWidth}x${imgHeight}, Scale: ${scale.toFixed(3)}`);
                        break;
                        
                    case 'fit-canvas':
                        scale = Math.min(canvasWidth / imgWidth, canvasHeight / imgHeight);
                        console.log(`[Image Fit Canvas] Canvas: ${canvasWidth}x${canvasHeight}, Image: ${imgWidth}x${imgHeight}, Scale: ${scale.toFixed(3)}`);
                        break;
                        
                    case 'actual-size':
                        scale = 1;
                        console.log(`[Image Actual Size] Canvas: ${canvasWidth}x${canvasHeight}, Image: ${imgWidth}x${imgHeight}, Scale: 1.000`);
                        break;
                        
                    default:
                        // Default to fit canvas
                        scale = Math.min(canvasWidth / imgWidth, canvasHeight / imgHeight);
                        console.log(`[Image Default] Canvas: ${canvasWidth}x${canvasHeight}, Image: ${imgWidth}x${imgHeight}, Scale: ${scale.toFixed(3)}`);
                        break;
                }
                
                img.set({
                    originX: 'center',
                    originY: 'center',
                    left: left,
                    top: top,
                    scaleX: scale,
                    scaleY: scale,
                    selectable: false,
                    evented: false
                });
                
                canvas.setBackgroundImage(img, canvas.requestRenderAll.bind(canvas));
                resolve();
            }, { crossOrigin: 'anonymous' });
        });
    }
    
    
    getViewList() {
        return Object.keys(this.views);
    }

    deleteImage(viewId) {
        if (!this.views[viewId]) {
            console.warn(`View ${viewId} does not exist.`);
            return;
        }

        // Remove from views
        delete this.views[viewId];

        // If we deleted the current view, switch to another one
        if (this.currentViewId === viewId) {
            const remainingViews = Object.keys(this.views);
            if (remainingViews.length > 0) {
                this.switchView(remainingViews[0]);
            } else {
                // No views left, clear canvas
                this.currentViewId = null;
                this.canvasManager.clear();
                if (this.canvasManager.fabricCanvas) {
                    this.canvasManager.fabricCanvas.setBackgroundImage(null, this.canvasManager.fabricCanvas.requestRenderAll.bind(this.canvasManager.fabricCanvas));
                }
            }
        }
        
        console.log(`Deleted view: ${viewId}`);
    }
}
