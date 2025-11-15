/**
 * AI Drawing Bot Integration
 * Handles communication with Cloudflare Workers for viewpoint classification and stroke suggestions
 */

window.aiDrawBot = {
    // Configuration - will be set from environment or defaults
    config: {
        classifierWorkerUrl: 'https://sofa-classify.sofapaint-api.workers.dev/api/sofa-classify',
        drawBotWorkerUrl: 'https://draw-bot.sofapaint-api.workers.dev/api/draw-bot',
        authToken: null
    },

    /**
     * Classify an image's viewpoint using the Cloudflare Worker
     * @param {string} imageUrl - URL or base64 string of the image
     * @param {string} imageLabel - Label identifier for the image
     * @returns {Promise<{tags: string[], confidence: number, viewpoint?: string}>}
     */
    async classifyImage(imageUrl, imageLabel) {
        try {
            const response = await fetch(this.config.classifierWorkerUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(this.config.authToken && { 'x-api-key': this.config.authToken })
                },
                body: JSON.stringify({
                    imageUrl: imageUrl,
                    imageLabel: imageLabel
                })
            });

            if (!response.ok) {
                throw new Error(`Classification failed: ${response.statusText}`);
            }

            const result = await response.json();
            
            // Store classification result in imageTags
            if (!window.imageTags) window.imageTags = {};
            if (!window.imageTags[imageLabel]) window.imageTags[imageLabel] = {};
            
            window.imageTags[imageLabel].viewpoint = result.viewpoint || result.tags[0];
            window.imageTags[imageLabel].tags = result.tags;
            window.imageTags[imageLabel].confidence = result.confidence;
            window.imageTags[imageLabel].classifiedAt = new Date().toISOString();

            return result;
        } catch (error) {
            console.error('[aiDrawBot] Classification error:', error);
            throw error;
        }
    },

    /**
     * Get stroke suggestions based on measurement code and viewpoint
     * @param {string} measurementCode - Measurement code (e.g., "A1", "A2")
     * @param {string} viewpointTag - Viewpoint tag (e.g., "front-center", "front-arm")
     * @param {string} imageLabel - Current image label
     * @param {{width: number, height: number}} viewport - Canvas viewport dimensions
     * @returns {Promise<{strokeId, measurementCode, viewpoint, confidence, points, width} | null>}
     */
    async getStrokeSuggestion(measurementCode, viewpointTag, imageLabel, viewport) {
        try {
            const response = await fetch(this.config.drawBotWorkerUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(this.config.authToken && { 'x-api-key': this.config.authToken })
                },
                body: JSON.stringify({
                    measurementCode: measurementCode,
                    viewpointTag: viewpointTag,
                    imageLabel: imageLabel,
                    viewport: viewport || { width: 800, height: 600 }
                })
            });

            if (!response.ok) {
                if (response.status === 404) {
                    return null; // No matching strokes found
                }
                throw new Error(`Suggestion failed: ${response.statusText}`);
            }

            const result = await response.json();
            return result;
        } catch (error) {
            console.error('[aiDrawBot] Suggestion error:', error);
            return null;
        }
    },

    /**
     * Render a ghost stroke suggestion on the canvas
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     * @param {Array<{x, y, t}>} points - Stroke points
     * @param {number} width - Stroke width
     * @param {string} imageLabel - Image label for transform calculations
     */
    renderGhostStroke(ctx, points, width, imageLabel) {
        if (!points || points.length < 2) return;

        ctx.save();
        ctx.strokeStyle = 'rgba(100, 150, 255, 0.5)'; // Semi-transparent blue
        ctx.lineWidth = width || 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.setLineDash([5, 5]); // Dashed line for ghost effect

        // Apply image transforms if available
        const scale = window.imageScaleByLabel?.[imageLabel] || 1.0;
        const position = window.imagePositionByLabel?.[imageLabel] || { x: 0, y: 0 };
        const originalDims = window.originalImageDimensions?.[imageLabel] || { width: 800, height: 600 };

        ctx.beginPath();
        const startPoint = points[0];
        const canvasX = (startPoint.x / originalDims.width) * originalDims.width * scale + position.x + (ctx.canvas.width - originalDims.width * scale) / 2;
        const canvasY = (startPoint.y / originalDims.height) * originalDims.height * scale + position.y + (ctx.canvas.height - originalDims.height * scale) / 2;
        ctx.moveTo(canvasX, canvasY);

        for (let i = 1; i < points.length; i++) {
            const point = points[i];
            const x = (point.x / originalDims.width) * originalDims.width * scale + position.x + (ctx.canvas.width - originalDims.width * scale) / 2;
            const y = (point.y / originalDims.height) * originalDims.height * scale + position.y + (ctx.canvas.height - originalDims.height * scale) / 2;
            ctx.lineTo(x, y);
        }

        ctx.stroke();
        ctx.restore();
    },

    /**
     * Convert a suggested stroke into a real stroke and add it to the drawing
     * @param {Array<{x, y, t}>} points - Stroke points
     * @param {number} width - Stroke width
     * @param {string} imageLabel - Image label
     * @param {string} measurementCode - Measurement code for the stroke
     */
    acceptSuggestion(points, width, imageLabel, measurementCode) {
        if (!points || points.length < 2) {
            console.warn('[aiDrawBot] Cannot accept suggestion: insufficient points');
            return;
        }

        // Convert points to canvas coordinates
        const scale = window.imageScaleByLabel?.[imageLabel] || 1.0;
        const position = window.imagePositionByLabel?.[imageLabel] || { x: 0, y: 0 };
        const originalDims = window.originalImageDimensions?.[imageLabel] || { width: 800, height: 600 };
        const canvas = document.getElementById('canvas');
        if (!canvas) return;

        const canvasPoints = points.map(point => {
            const x = (point.x / originalDims.width) * originalDims.width * scale + position.x + (canvas.width - originalDims.width * scale) / 2;
            const y = (point.y / originalDims.height) * originalDims.height * scale + position.y + (canvas.height - originalDims.height * scale) / 2;
            return { x, y, t: point.t || 0 };
        });

        // Create a vector stroke object matching the app's format
        const stroke = {
            points: canvasPoints,
            width: width || 2,
            color: window.currentColor || '#000000',
            measurement: measurementCode || 'A1',
            source: 'ai-suggestion',
            timestamp: Date.now()
        };

        // Add to vector strokes
        if (!window.vectorStrokesByImage) window.vectorStrokesByImage = {};
        if (!window.vectorStrokesByImage[imageLabel]) {
            window.vectorStrokesByImage[imageLabel] = [];
        }
        window.vectorStrokesByImage[imageLabel].push(stroke);

        // Update label counter if needed
        if (window.labelsByImage && window.labelsByImage[imageLabel]) {
            // Increment label counter logic here if needed
        }

        // Redraw canvas
        if (typeof window.redrawCanvasWithVisibility === 'function') {
            window.redrawCanvasWithVisibility(imageLabel);
        }

        // Save state for undo/redo
        if (typeof window.saveState === 'function') {
            window.saveState();
        }

        console.log('[aiDrawBot] Accepted suggestion and added stroke');
    },

    /**
     * Submit feedback about a stroke (for dataset enrichment)
     * @param {string} imageLabel - Image label
     * @param {string} measurementCode - Measurement code
     * @param {string} viewpointTag - Viewpoint tag
     * @param {Object} strokeData - The actual stroke data that was used
     */
    async submitFeedback(imageLabel, measurementCode, viewpointTag, strokeData) {
        // TODO: Implement feedback endpoint in Worker
        // For now, just log it
        console.log('[aiDrawBot] Feedback submitted:', {
            imageLabel,
            measurementCode,
            viewpointTag,
            strokeData
        });
    }
};

// Initialize configuration from environment if available
if (typeof window !== 'undefined' && window.location) {
    // Check for config in a meta tag or global variable
    const configMeta = document.querySelector('meta[name="worker-config"]');
    if (configMeta) {
        try {
            const config = JSON.parse(configMeta.content);
            if (config.workerBaseUrl) {
                window.aiDrawBot.config.classifierWorkerUrl = `${config.workerBaseUrl}/api/sofa-classify`;
                window.aiDrawBot.config.drawBotWorkerUrl = `${config.workerBaseUrl}/api/draw-bot`;
            }
            if (config.workerAuthToken) {
                window.aiDrawBot.config.authToken = config.workerAuthToken;
            }
        } catch (e) {
            console.warn('[aiDrawBot] Failed to parse worker config:', e);
        }
    }
}

