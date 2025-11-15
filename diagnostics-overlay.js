/**
 * Diagnostics overlay for coordinate system debugging
 * Shows transform state, coordinate validation, and debugging information
 */
(function() {
    'use strict';

    let overlayVisible = false;
    let overlayElement = null;

    // Create diagnostics overlay
    function createOverlay() {
        if (overlayElement) return overlayElement;

        overlayElement = document.createElement('div');
        overlayElement.id = 'diagnostics-overlay';
        overlayElement.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            background: rgba(0, 0, 0, 0.9);
            color: #00ff00;
            font-family: monospace;
            font-size: 12px;
            padding: 10px;
            border-radius: 5px;
            max-width: 400px;
            max-height: 600px;
            overflow-y: auto;
            z-index: 10000;
            display: none;
            white-space: pre-wrap;
        `;

        document.body.appendChild(overlayElement);
        return overlayElement;
    }

    // Update overlay content
    function updateOverlay() {
        if (!overlayVisible || !overlayElement) return;

        const content = [];

        // Transform T state
        if (window.getCurrentTransform) {
            const T = window.getCurrentTransform();
            content.push('=== TRANSFORM T ===');
            content.push(`Scale: ${T.scale.toFixed(3)}`);
            content.push(`Pan: (${T.panX.toFixed(1)}, ${T.panY.toFixed(1)})`);
            content.push(`DPR: ${T.dpr.toFixed(3)}`);
        }

        // Session state
        if (window.getTransformSession) {
            const session = window.getTransformSession();
            content.push('\n=== SESSION ===');
            content.push(`Phase: ${session.phase}`);
            content.push(`Stable Ticks: ${session.stableTicks}`);
            content.push(`Can Persist: ${session.canPersist}`);
        }

        // Roundtrip test
        if (window.getCurrentTransform) {
            const T = window.getCurrentTransform();
            const testPoint = { x: 100, y: 100 };

            try {
                const roundtrip = window.toImage(window.toCanvas(testPoint, T), T);
                const err = Math.hypot(roundtrip.x - testPoint.x, roundtrip.y - testPoint.y);
                content.push('\n=== ROUNDTRIP TEST ===');
                content.push(`Error: ${err.toFixed(3)}px`);
                content.push(`Status: ${err <= 0.25 ? 'PASS' : 'FAIL'}`);
            } catch (e) {
                content.push('\n=== ROUNDTRIP TEST ===');
                content.push(`Error: FAILED - ${e.message}`);
            }
        }

        // Current image info
        if (window.currentImageLabel && window.originalImageDimensions) {
            const dims = window.originalImageDimensions[window.currentImageLabel];
            if (dims) {
                content.push('\n=== CURRENT IMAGE ===');
                content.push(`Label: ${window.currentImageLabel}`);
                content.push(`Dimensions: ${dims.width}x${dims.height}`);
            }
        }

        // Fit session
        if (window.currentImageLabel && window.getFitSession) {
            const fitSession = window.getFitSession(window.currentImageLabel);
            if (fitSession) {
                content.push('\n=== FIT SESSION ===');
                content.push(`Mode: ${fitSession.mode}`);
                content.push(`Natural: ${fitSession.naturalW}x${fitSession.naturalH}`);
            }
        }

        // Label validation
        if (window.currentImageLabel && window.calculatedLabelOffsets) {
            const offsets = window.calculatedLabelOffsets[window.currentImageLabel];
            if (offsets && Object.keys(offsets).length > 0) {
                content.push('\n=== LABEL OFFSETS ===');
                Object.keys(offsets).forEach(label => {
                    const offset = offsets[label];
                    if (offset && typeof offset.x === 'number') {
                        content.push(`${label}: (${offset.x.toFixed(1)}, ${offset.y.toFixed(1)})`);
                    }
                });
            }
        }

        overlayElement.textContent = content.join('\n');
    }

    // Toggle overlay visibility
    window.toggleDiagnosticsOverlay = function() {
        overlayVisible = !overlayVisible;

        if (overlayVisible) {
            createOverlay();
            overlayElement.style.display = 'block';
            updateOverlay();

            // Update every 100ms
            if (!window._diagnosticsInterval) {
                window._diagnosticsInterval = setInterval(updateOverlay, 100);
            }
        } else {
            if (overlayElement) {
                overlayElement.style.display = 'none';
            }
            if (window._diagnosticsInterval) {
                clearInterval(window._diagnosticsInterval);
                window._diagnosticsInterval = null;
            }
        }

        console.log(`[DIAGNOSTICS] Overlay ${overlayVisible ? 'shown' : 'hidden'}`);
    };

    // Keyboard shortcut to toggle (Ctrl+Shift+D)
    document.addEventListener('keydown', function(e) {
        if (e.ctrlKey && e.shiftKey && e.key === 'D') {
            e.preventDefault();
            window.toggleDiagnosticsOverlay();
        }
    });

    // Export for debugging
    window._diagnosticsDebug = {
        toggle: window.toggleDiagnosticsOverlay,
        update: updateOverlay,
        isVisible: () => overlayVisible
    };

    console.log('[DIAGNOSTICS] Overlay system ready. Press Ctrl+Shift+D to toggle.');

})();
