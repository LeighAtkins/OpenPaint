// Debug Helpers for Fabric.js Canvas
// Provides console functions to inspect canvas state

export function setupDebugHelpers(app) {
    // Debug function to inspect current canvas state
    window.debugCanvasState = function() {
        console.log('=== CANVAS STATE DEBUG ===');
        const canvas = app.canvasManager.fabricCanvas;
        if (!canvas) {
            console.error('Canvas not initialized');
            return;
        }
        
        console.log(`Canvas size: ${canvas.width}x${canvas.height}`);
        console.log(`Zoom: ${canvas.getZoom()}`);
        console.log(`Objects: ${canvas.getObjects().length}`);
        
        const objects = canvas.getObjects();
        objects.forEach((obj, idx) => {
            const metadata = obj.strokeMetadata || {};
            console.log(`  [${idx}] ${obj.type}:`, {
                label: metadata.strokeLabel || 'no label',
                visible: metadata.visible !== false,
                position: { left: obj.left, top: obj.top }
            });
        });
        
        // Metadata state
        if (app.metadataManager) {
            console.log('Metadata:');
            console.log('  vectorStrokesByImage:', Object.keys(app.metadataManager.vectorStrokesByImage));
            console.log('  strokeMeasurements:', app.metadataManager.strokeMeasurements);
        }
        
        // History state
        if (app.historyManager) {
            console.log(`History: ${app.historyManager.undoStack.length} undo, ${app.historyManager.redoStack.length} redo`);
        }
    };
    
    // Debug function to list all strokes for current image
    window.debugStrokes = function(imageLabel) {
        const label = imageLabel || app.projectManager?.currentViewId || 'front';
        console.log(`=== STROKES FOR ${label} ===`);
        
        if (app.metadataManager) {
            const strokes = app.metadataManager.vectorStrokesByImage[label] || {};
            const keys = Object.keys(strokes);
            console.log(`Total strokes: ${keys.length}`);
            
            keys.forEach(key => {
                const obj = strokes[key];
                const measurement = app.metadataManager.getMeasurement(label, key);
                console.log(`  ${key}:`, {
                    type: obj?.type,
                    visible: app.metadataManager.strokeVisibilityByImage[label]?.[key] !== false,
                    measurement: measurement || 'none'
                });
            });
        }
    };
    
    // Debug function to test drawing
    window.testDraw = function() {
        console.log('Testing draw...');
        app.toolManager.selectTool('pencil');
        console.log('Switched to pencil tool. Try drawing on canvas.');
    };
    
    console.log('Debug helpers loaded. Use:');
    console.log('  debugCanvasState() - Inspect canvas state');
    console.log('  debugStrokes(label) - List strokes for image');
    console.log('  testDraw() - Switch to pencil tool');
}

