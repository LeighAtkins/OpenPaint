/**
 * AI Drawing Bot Integration
 * Handles communication with Cloudflare Workers for viewpoint classification and stroke suggestions
 */

console.log('[aiDrawBot] Script file loaded and executing...');
console.log('[aiDrawBot] Window object available:', typeof window !== 'undefined');

try {
window.aiDrawBot = {
    // Configuration - will be set from environment or defaults
    config: {
        classifierWorkerUrl: 'https://sofa-classify.sofapaint-api.workers.dev/api/sofa-classify',
        drawBotWorkerUrl: 'https://draw-bot.sofapaint-api.workers.dev/api/draw-bot',
        feedbackWorkerUrl: 'https://feedback.sofapaint-api.workers.dev/api/feedback',
        authToken: null
    },

    /**
     * Capture image snapshot as base64 for classification
     * @param {string} imageUrl - Image URL or data URL
     * @returns {Promise<{imageBase64: string, imageHash: string}>}
     */
    async captureImageSnapshot(imageUrl) {
        try {
            // If already a data URL, extract base64
            if (imageUrl.startsWith('data:')) {
                const base64 = imageUrl.split(',')[1];
                const hash = await this.hashString(base64);
                return { imageBase64: base64, imageHash: hash };
            }

            // Convert image URL to data URL
            const img = new Image();
            img.crossOrigin = 'Anonymous';
            
            return new Promise((resolve, reject) => {
                img.onload = async () => {
                    try {
                        const canvas = document.createElement('canvas');
                        canvas.width = img.width;
                        canvas.height = img.height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0);
                        
                        // Use JPEG with quality 0.7 for smaller size
                        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
                        const base64 = dataUrl.split(',')[1];
                        const hash = await this.hashString(base64);
                        resolve({ imageBase64: base64, imageHash: hash });
                    } catch (e) {
                        console.warn('[aiDrawBot] Failed to capture snapshot, using URL:', e);
                        resolve({ imageBase64: null, imageHash: null, imageUrl });
                    }
                };
                img.onerror = () => {
                    console.warn('[aiDrawBot] Failed to load image for snapshot');
                    resolve({ imageBase64: null, imageHash: null, imageUrl });
                };
                img.src = imageUrl;
            });
        } catch (error) {
            console.warn('[aiDrawBot] Error capturing snapshot:', error);
            return { imageBase64: null, imageHash: null, imageUrl };
        }
    },

    /**
     * Simple hash function for image deduplication
     * @param {string} str - String to hash
     * @returns {Promise<string>} Hash string
     */
    async hashString(str) {
        if (typeof crypto !== 'undefined' && crypto.subtle) {
            const encoder = new TextEncoder();
            const data = encoder.encode(str);
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        }
        // Fallback: simple hash
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(16);
    },

    /**
     * Classify an image's viewpoint using the Cloudflare Worker
     * @param {string} imageUrl - URL or base64 string of the image
     * @param {string} imageLabel - Label identifier for the image
     * @returns {Promise<{tags: string[], confidence: number, viewpoint?: string}>}
     */
    async classifyImage(imageUrl, imageLabel) {
        try {
            // Capture image snapshot for better classification
            const snapshot = await this.captureImageSnapshot(imageUrl);
            
            const response = await fetch(this.config.classifierWorkerUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(this.config.authToken && { 'x-api-key': this.config.authToken })
                },
                body: JSON.stringify({
                    imageUrl: snapshot.imageUrl || imageUrl,
                    imageBase64: snapshot.imageBase64,
                    imageHash: snapshot.imageHash,
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
            window.imageTags[imageLabel].imageHash = snapshot.imageHash;

            return result;
        } catch (error) {
            console.error('[aiDrawBot] Classification error:', error);
            throw error;
        }
    },

    /**
     * Predict measurements for an image based on viewpoint
     * @param {string} viewpointTag - Viewpoint tag (e.g., "front-center", "front-arm")
     * @param {string} imageLabel - Current image label
     * @param {{width: number, height: number}} viewport - Canvas viewport dimensions
     * @returns {Promise<Array<{code: string, stroke: object, confidence: number}>>}
     */
    async predictMeasurements(viewpointTag, imageLabel, viewport) {
        try {
            // Get image snapshot for context
            const imageUrl = window.originalImages?.[imageLabel];
            const snapshot = imageUrl ? await this.captureImageSnapshot(imageUrl) : null;
            
            const response = await fetch(this.config.drawBotWorkerUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(this.config.authToken && { 'x-api-key': this.config.authToken })
                },
                body: JSON.stringify({
                    action: 'predict',
                    viewpointTag: viewpointTag,
                    imageLabel: imageLabel,
                    imageHash: snapshot?.imageHash,
                    imageBase64: snapshot?.imageBase64,
                    viewport: viewport || { width: 800, height: 600 }
                })
            });

            if (!response.ok) {
                if (response.status === 404) {
                    return []; // No predictions found
                }
                throw new Error(`Prediction failed: ${response.statusText}`);
            }

            const result = await response.json();
            return result.predictions || [];
        } catch (error) {
            console.error('[aiDrawBot] Prediction error:', error);
            return [];
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
                    action: 'suggest',
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
     * Queue feedback about a stroke for later submission
     * @param {Object} event - Feedback event with source, imageLabel, measurementCode, viewpoint, stroke, etc.
     */
    async queueFeedback(event) {
        // Check if feedback is enabled
        const feedbackEnabled = document.getElementById('aiFeedbackEnabled');
        if (feedbackEnabled && !feedbackEnabled.checked) {
            console.log('[aiDrawBot] Feedback disabled, skipping queue');
            return;
        }

        if (!window.aiFeedbackQueue) {
            window.aiFeedbackQueue = [];
        }

        // Capture image snapshot for visual context
        const imageUrl = window.originalImages?.[event.imageLabel];
        const snapshot = imageUrl ? await this.captureImageSnapshot(imageUrl) : null;

        // Build payload from event
        const payload = {
            projectId: event.projectId || document.getElementById('projectName')?.value || 'unknown',
            imageLabel: event.imageLabel,
            viewpoint: event.viewpoint || (window.imageTags?.[event.imageLabel]?.viewpoint) || 'unknown',
            measurementCode: event.measurementCode,
            stroke: {
                points: event.stroke?.points || [],
                width: event.stroke?.width || 2,
                source: event.source || 'manual'
            },
            labels: event.labels || [],
            imageHash: snapshot?.imageHash,
            imageBase64: snapshot?.imageBase64, // Include compressed image for training
            meta: {
                ...event.meta,
            }
        };

        // Add canvas dimensions if available
        const canvas = document.getElementById('canvas');
        if (canvas && !payload.meta.canvas) {
            payload.meta.canvas = {
                width: canvas.width,
                height: canvas.height
            };
        }

        // Add to queue with retry metadata
        window.aiFeedbackQueue.push({
            payload,
            attempts: 0,
            lastAttempt: null,
            queuedAt: new Date().toISOString()
        });

        // Persist to localStorage
        try {
            localStorage.setItem('aiFeedbackQueue', JSON.stringify(window.aiFeedbackQueue));
        } catch (e) {
            console.warn('[aiDrawBot] Failed to persist feedback queue:', e);
        }

        // Trigger flush if not already scheduled
        if (!window.aiFeedbackFlushScheduled) {
            scheduleFeedbackFlush();
        }

        console.log('[aiDrawBot] Queued feedback:', payload);
    },

    /**
     * Submit feedback about a stroke (for dataset enrichment)
     * @param {string} imageLabel - Image label
     * @param {string} measurementCode - Measurement code
     * @param {string} viewpointTag - Viewpoint tag
     * @param {Object} strokeData - The actual stroke data that was used
     */
    async submitFeedback(imageLabel, measurementCode, viewpointTag, strokeData) {
        this.queueFeedback({
            imageLabel,
            measurementCode,
            viewpoint: viewpointTag,
            stroke: strokeData,
            source: 'manual'
        });
    },

    /**
     * Flush queued feedback to the server
     */
    async flushFeedbackQueue() {
        if (!window.aiFeedbackQueue || window.aiFeedbackQueue.length === 0) {
            return { sent: 0, failed: 0, remaining: 0 };
        }

        const feedbackWorkerUrl = this.config.feedbackWorkerUrl || 
            'https://feedback.sofapaint-api.workers.dev/api/feedback';

        let sent = 0;
        let failed = 0;
        const maxRetries = 3;
        const retryDelay = 1000; // 1 second

        // Process queue
        const remaining = [];
        for (const item of window.aiFeedbackQueue) {
            // Skip if too many attempts
            if (item.attempts >= maxRetries) {
                console.warn('[aiDrawBot] Dropping feedback after max retries:', item.payload);
                failed++;
                continue;
            }

            // Skip if recently attempted (exponential backoff)
            if (item.lastAttempt) {
                const timeSinceLastAttempt = Date.now() - new Date(item.lastAttempt).getTime();
                const backoffDelay = retryDelay * Math.pow(2, item.attempts);
                if (timeSinceLastAttempt < backoffDelay) {
                    remaining.push(item);
                    continue;
                }
            }

            try {
                const response = await fetch(feedbackWorkerUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(this.config.authToken && { 'x-api-key': this.config.authToken })
                    },
                    body: JSON.stringify(item.payload)
                });

                if (response.ok) {
                    const result = await response.json().catch(() => ({}));
                    sent++;
                    console.log('[aiDrawBot] Feedback sent successfully:', {
                        measurementCode: item.payload.measurementCode,
                        feedbackId: result.feedbackId,
                        response: result
                    });
                } else {
                    const errorText = await response.text().catch(() => response.statusText);
                    item.attempts++;
                    item.lastAttempt = new Date().toISOString();
                    remaining.push(item);
                    console.warn('[aiDrawBot] Feedback submission failed:', {
                        status: response.status,
                        statusText: response.statusText,
                        error: errorText,
                        payload: item.payload
                    });
                }
            } catch (error) {
                item.attempts++;
                item.lastAttempt = new Date().toISOString();
                remaining.push(item);
                console.error('[aiDrawBot] Feedback submission error:', {
                    error: error.message,
                    stack: error.stack,
                    payload: item.payload
                });
            }
        }

        // Update queue
        window.aiFeedbackQueue = remaining;

        // Persist updated queue
        try {
            if (remaining.length > 0) {
                localStorage.setItem('aiFeedbackQueue', JSON.stringify(remaining));
            } else {
                localStorage.removeItem('aiFeedbackQueue');
            }
        } catch (e) {
            console.warn('[aiDrawBot] Failed to persist feedback queue:', e);
        }

        // Limit queue size (drop oldest if exceeds 1000)
        if (window.aiFeedbackQueue.length > 1000) {
            window.aiFeedbackQueue = window.aiFeedbackQueue.slice(-1000);
        }

        return { sent, failed, remaining: remaining.length };
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
                window.aiDrawBot.config.feedbackWorkerUrl = `${config.workerBaseUrl}/api/feedback`;
            }
            if (config.workerAuthToken) {
                window.aiDrawBot.config.authToken = config.workerAuthToken;
            }
        } catch (e) {
            console.warn('[aiDrawBot] Failed to parse worker config:', e);
        }
    }
}

// Initialize feedback queue from localStorage
if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
        const stored = localStorage.getItem('aiFeedbackQueue');
        if (stored) {
            window.aiFeedbackQueue = JSON.parse(stored);
        }
    } catch (e) {
        console.warn('[aiDrawBot] Failed to load feedback queue from localStorage:', e);
    }
}

// Schedule feedback flush function
function scheduleFeedbackFlush() {
    if (window.aiFeedbackFlushScheduled) return;
    window.aiFeedbackFlushScheduled = true;

    // Use requestIdleCallback if available, otherwise setTimeout
    if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(() => {
            window.aiFeedbackFlushScheduled = false;
            if (window.aiDrawBot && window.aiFeedbackQueue && window.aiFeedbackQueue.length > 0) {
                window.aiDrawBot.flushFeedbackQueue();
            }
        }, { timeout: 5000 });
    } else {
        setTimeout(() => {
            window.aiFeedbackFlushScheduled = false;
            if (window.aiDrawBot && window.aiFeedbackQueue && window.aiFeedbackQueue.length > 0) {
                window.aiDrawBot.flushFeedbackQueue();
            }
        }, 2000);
    }
}

// Signal that aiDrawBot is ready
console.log('[aiDrawBot] Initialization complete, window.aiDrawBot available:', typeof window.aiDrawBot !== 'undefined');
if (typeof window !== 'undefined' && window.dispatchEvent) {
    try {
        window.dispatchEvent(new CustomEvent('aiDrawBotReady'));
        console.log('[aiDrawBot] Dispatched aiDrawBotReady event');
    } catch (e) {
        console.error('[aiDrawBot] Failed to dispatch event:', e);
    }
} else {
    console.warn('[aiDrawBot] Cannot dispatch event - window or dispatchEvent not available');
}
} catch (error) {
    console.error('[aiDrawBot] Fatal error during initialization:', error);
    throw error;
}

