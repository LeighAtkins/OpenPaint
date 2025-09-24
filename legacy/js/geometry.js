/**
 * Geometry functions for coordinate space conversions
 * Handles conversions between imageSpace, canvasSpace, and normalized offsets
 */
(function() {
    'use strict';

    /**
     * Convert image space point to canvas device pixels
     * @param {Object} P_img - Point in image space {x, y}
     * @param {Object} T - Transform object {scale, panX, panY, dpr}
     * @returns {Object} Point in canvas space {x, y}
     */
    window.toCanvas = function(P_img, T) {
        if (!P_img || typeof P_img.x !== 'number' || typeof P_img.y !== 'number') {
            console.warn('[GEOMETRY] Invalid image point:', P_img);
            return { x: 0, y: 0 };
        }

        const sx = T.scale * T.dpr;
        const tx = Math.round(T.panX * T.dpr); // Snap to device pixel
        const ty = Math.round(T.panY * T.dpr);

        // Convert to device pixels
        const Xd = Math.round(P_img.x * sx + tx);
        const Yd = Math.round(P_img.y * sx + ty);

        return { x: Xd, y: Yd };
    };

    /**
     * Convert canvas space point to image space
     * @param {Object} P_canvas - Point in canvas space {x, y}
     * @param {Object} T - Transform object {scale, panX, panY, dpr}
     * @returns {Object} Point in image space {x, y}
     */
    window.toImage = function(P_canvas, T) {
        if (!P_canvas || typeof P_canvas.x !== 'number' || typeof P_canvas.y !== 'number') {
            console.warn('[GEOMETRY] Invalid canvas point:', P_canvas);
            return { x: 0, y: 0 };
        }

        const sx = T.scale * T.dpr;
        const tx = Math.round(T.panX * T.dpr);
        const ty = Math.round(T.panY * T.dpr);

        const xi = (P_canvas.x - tx) / sx;
        const yi = (P_canvas.y - ty) / sx;

        return { x: xi, y: yi };
    };

    /**
     * Convert pixel offset to normalized offset
     * @param {number} dx_px - X offset in pixels
     * @param {number} dy_px - Y offset in pixels
     * @param {Object} normRef - Normalization reference {w, h}
     * @returns {Object} Normalized offset {dx_norm, dy_norm}
     */
    window.pixelOffsetToNorm = function(dx_px, dy_px, normRef) {
        if (!normRef || !normRef.w || !normRef.h) {
            console.warn('[GEOMETRY] Invalid normRef:', normRef);
            return { dx_norm: 0, dy_norm: 0 };
        }

        return {
            dx_norm: dx_px / normRef.w,
            dy_norm: dy_px / normRef.h
        };
    };

    /**
     * Convert normalized offset to pixel offset
     * @param {number} dx_norm - Normalized X offset
     * @param {number} dy_norm - Normalized Y offset
     * @param {Object} normRef - Normalization reference {w, h}
     * @returns {Object} Pixel offset {dx, dy}
     */
    window.normToPixelOffset = function(dx_norm, dy_norm, normRef) {
        if (!normRef || !normRef.w || !normRef.h) {
            console.warn('[GEOMETRY] Invalid normRef:', normRef);
            return { dx: 0, dy: 0 };
        }

        return {
            dx: dx_norm * normRef.w,
            dy: dy_norm * normRef.h
        };
    };

    /**
     * Compute anchor center in image space from stroke points
     * @param {Object} stroke - Stroke object with points array
     * @returns {Object} Anchor center {x, y} in image space
     */
    window.computeAnchorCenterImage = function(stroke) {
        if (!stroke || !stroke.points || !Array.isArray(stroke.points) || stroke.points.length === 0) {
            console.warn('[GEOMETRY] Invalid stroke for anchor computation:', stroke);
            return { x: 0, y: 0 };
        }

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        for (const p of stroke.points) {
            if (typeof p.x === 'number' && typeof p.y === 'number') {
                minX = Math.min(minX, p.x);
                minY = Math.min(minY, p.y);
                maxX = Math.max(maxX, p.x);
                maxY = Math.max(maxY, p.y);
            }
        }

        if (minX === Infinity || minY === Infinity) {
            console.warn('[GEOMETRY] No valid points in stroke');
            return { x: 0, y: 0 };
        }

        return {
            x: (minX + maxX) / 2,
            y: (minY + maxY) / 2
        };
    };

    /**
     * Place label using anchor center and normalized offset
     * @param {string} labelId - Label identifier
     * @param {Object} anchorCenterImage - Anchor center in image space {x, y}
     * @param {Object} offsetNorm - Normalized offset {dx_norm, dy_norm}
     * @param {Object} normRef - Normalization reference {w, h}
     * @param {Object} T - Transform object
     * @returns {Object} Canvas position {x, y}
     */
    window.placeLabel = function(labelId, anchorCenterImage, offsetNorm, normRef, T) {
        if (!anchorCenterImage || !offsetNorm || !normRef || !T) {
            console.warn('[GEOMETRY] Invalid parameters for label placement:', {
                labelId, anchorCenterImage, offsetNorm, normRef, T
            });
            return { x: 0, y: 0 };
        }

        // Convert normalized offset to pixel offset
        const pixelOffset = window.normToPixelOffset(offsetNorm.dx_norm, offsetNorm.dy_norm, normRef);

        // Add offset to anchor center
        const P_img = {
            x: anchorCenterImage.x + pixelOffset.dx,
            y: anchorCenterImage.y + pixelOffset.dy
        };

        // Convert to canvas space
        return window.toCanvas(P_img, T);
    };

    /**
     * Compute deterministic scale for fit mode
     * @param {Object} imageNatural - Natural image dimensions {w, h}
     * @param {Object} viewportCss - Viewport dimensions {w, h}
     * @param {string} mode - Fit mode: 'width', 'height', 'contain'
     * @returns {number} Scale factor
     */
    window.computeScaleForFit = function(imageNatural, viewportCss, mode) {
        if (!imageNatural || !viewportCss) {
            console.warn('[GEOMETRY] Invalid dimensions for fit calculation');
            return 1.0;
        }

        const { w: iw, h: ih } = imageNatural;
        const { w: vw, h: vh } = viewportCss;

        if (mode === 'width') {
            return vw / iw;
        } else if (mode === 'height') {
            return vh / ih;
        } else {
            // contain (default)
            return Math.min(vw / iw, vh / ih);
        }
    };

    /**
     * Persistence guard - check if offsets can be safely persisted
     * @param {Object} session - Session object
     * @returns {boolean} Whether persistence is safe
     */
    window.canPersistOffsets = function(session) {
        if (!session || session.phase !== 'Stable') {
            return false;
        }

        // Roundtrip check at center of canvas
        const T = session.T;
        const testPoint = { x: 100, y: 100 };

        try {
            const roundtrip = window.toImage(window.toCanvas(testPoint, T), T);
            const err = Math.hypot(roundtrip.x - testPoint.x, roundtrip.y - testPoint.y);
            return err <= 0.25; // CSS px tolerance
        } catch (e) {
            console.warn('[GEOMETRY] Roundtrip check failed:', e);
            return false;
        }
    };

    // Export for debugging
    window._geometryDebug = {
        toCanvas: window.toCanvas,
        toImage: window.toImage,
        pixelOffsetToNorm: window.pixelOffsetToNorm,
        normToPixelOffset: window.normToPixelOffset,
        computeAnchorCenterImage: window.computeAnchorCenterImage,
        placeLabel: window.placeLabel,
        computeScaleForFit: window.computeScaleForFit,
        canPersistOffsets: window.canPersistOffsets
    };

})();
