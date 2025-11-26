const fs = require('fs');
const path = 'index.html';

try {
    let content = fs.readFileSync(path, 'utf8');

    // The pattern we found in the file
    // We look for .image-thumbnail.active and the garbage following it
    const pattern = /\.image-thumbnail\.active \{[\s\S]*?const windowWidth = window\.innerWidth;/;
    
    // Check if pattern exists
    if (!pattern.test(content)) {
        console.error('Pattern not found!');
        
        // Debug
        const index = content.indexOf('.image-thumbnail.active {');
        if (index !== -1) {
            console.log('Found .image-thumbnail.active { at index:', index);
            console.log('Context:', content.substring(index, index + 200));
        } else {
            console.log('.image-thumbnail.active { not found.');
        }
        
        process.exit(1);
    }

    const replacement = `.image-thumbnail.active {
            border-color: #3b82f6;
            box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2), 0 10px 25px -3px rgba(0, 0, 0, 0.15);
            transform: scale(1.05);
        }

        .image-thumbnail.dragging {
            opacity: 0.5;
            transform: rotate(5deg);
            z-index: 1000;
        }

        .image-thumbnail.drag-over {
            border-color: #10b981;
            box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.5);
            transform: translateY(-1px) scale(1.05);
        }

        /* --- UI Z-Index Hierarchy --- */
        #canvas {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            z-index: 0;
            cursor: crosshair;
            background: #f8f9fa;
            touch-action: none;
        }

        .canvas-container {
            z-index: 10;
            position: fixed !important;
            top: 0;
            left: 0;
            width: 100vw !important;
            height: 100vh !important;
            pointer-events: none;
        }

        .canvas-container .upper-canvas {
            z-index: 11;
            pointer-events: auto;
        }

        .canvas-container .lower-canvas {
            z-index: 10;
        }

        #frame-capture {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            min-height: 100vh;
            z-index: 20;
            display: flex;
            align-items: center;
            justify-content: center;
            pointer-events: none;
        }

        #frame-content {
            pointer-events: auto;
        }

        #navigation-container {
            z-index: 40 !important;
        }

        #topToolbar {
            z-index: 50;
        }

        /* Floating Panels */
        .floating-panel {
            z-index: 60;
            position: fixed;
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(12px);
            border: 1px solid rgba(226, 232, 240, 0.8);
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
            transition: all 0.2s ease-out;
        }

        .floating-panel:hover {
            background: rgba(255, 255, 255, 0.99);
        }

        /* Only apply hover transform to main panels, not side panels */
        #projectPanel:hover,
        #toolsPanel:hover,
        #canvasControls:hover {
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
            transform: translateY(-1px);
        }

        .floating-panel.dragging {
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
            transform: none !important;
            transition: none !important;
        }

        /* Panel toggle icons (Mobile) */
        .panel-toggle-icon {
            z-index: 65;
        }

        /* Overlays & Dialogs */
        #captureOverlay {
            z-index: 70;
            backdrop-filter: none;
        }

        .capture-frame {
            background: transparent;
            transition: none !important;
        }

        .capture-frame.locked {
            cursor: default;
        }

        .capture-frame.unlocked {
            cursor: move;
        }

        .capture-frame.dragging {
            transition: none !important;
        }

        .resize-handle {
            position: absolute;
            opacity: 0;
            transition: opacity 0.2s ease, transform 0.2s ease;
        }

        .capture-frame.unlocked:hover .resize-handle,
        .capture-frame.unlocked .resize-handle:hover {
            opacity: 1;
        }

        .resize-handle:hover {
            transform: scale(1.3);
            background: #3b82f6 !important;
            border-color: white !important;
        }

        #measurementDialogOverlay {
            z-index: 100;
        }

        #lockPopup {
            z-index: 110;
        }

        #aiPreviewModal {
            z-index: 120;
        }

        #scaleDropdown {
            z-index: 130;
        }

        /* Visibility States */
        .floating-panel.minimized {
            width: auto !important;
            height: auto !important;
        }

        .floating-panel.hidden,
        .hidden {
            display: none !important;
        }

        #darkOverlay {
            transition: none;
        }
    </style>
    <script>
        // STEP 3: JS fallback - Re-check sizing after fonts load and on resize
        // This updates the global data-toolbar-mode attribute (no DOM rewrites)
        (function () {
            let resizeTimer = null;
            let isCalculating = false;

            const calculateToolbarMode = () => {
                // Prevent concurrent calculations
                if (isCalculating) return;
                isCalculating = true;

                const toolbarWrap = document.getElementById('toolbarWrap') || document.querySelector('.toolbar-wrap');
                if (!toolbarWrap) {
                    isCalculating = false;
                    return;
                }

                const windowWidth = window.innerWidth;`;

    const newContent = content.replace(pattern, replacement);
    
    fs.writeFileSync(path, newContent, 'utf8');
    console.log('Successfully patched index.html');

} catch (err) {
    console.error('Error:', err);
    process.exit(1);
}
