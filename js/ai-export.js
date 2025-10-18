/**
 * AI Export Functions
 * Handles communication with AI Worker (or mock) for SVG generation
 */

import { MockAIWorker } from './ai-worker-mock.js';
import { createWorkerPayload } from './coordinate-validator.js';
import { DEFAULT_STYLE_GUIDE } from './ai-style-guide.js';

// Use mock worker for local development, real Worker for production
const USE_MOCK = !window.location.hostname.includes('vercel.app') && !window.location.hostname.includes('workers.dev');
const mockWorker = new MockAIWorker();

/**
 * Export AI-enhanced SVG for current image
 * @param {Object} options - Export options
 * @returns {Promise<Object>} GenerateSVGOutput
 */
export async function exportAIEnhancedSVG(options = {}) {
    const imageLabel = options.imageLabel || window.currentImageLabel;
    const prompt = options.prompt || '';
    const styleGuide = options.styleGuide || null;
    
    console.log('[AI Export] Starting export for image:', imageLabel);
    
    // Create validated payload
    const { payload, errors } = createWorkerPayload(imageLabel, {
        units: options.units,
        prompt,
        styleGuide
    });
    
    if (errors.length > 0) {
        console.warn('[AI Export] Validation errors:', errors);
    }
    
    if (!payload) {
        throw new Error('Failed to create valid payload: ' + errors.map(e => e.error || e.type).join(', '));
    }
    
    if (payload.strokes.length === 0) {
        throw new Error('No strokes to export');
    }
    
    console.log('[AI Export] Payload created:', {
        strokes: payload.strokes.length,
        dimensions: `${payload.image.width}x${payload.image.height}`,
        units: payload.units.name
    });
    
    // Call Worker or mock
    let result;
    try {
        if (USE_MOCK) {
            console.log('[AI Export] Using mock worker');
            result = await mockWorker.generateSVG(payload);
        } else {
            console.log('[AI Export] Calling production worker');
            result = await callWorkerAPI('/ai/generate-svg', payload);
        }
        
        console.log('[AI Export] Success:', {
            svgLength: result.svg.length,
            vectorCount: result.vectors.length,
            measurements: result.summary.measurements.length
        });
        
        return result;
    } catch (error) {
        console.error('[AI Export] Failed:', error);
        throw error;
    }
}

/**
 * Assist with measurement for a specific stroke
 * @param {string} strokeLabel - Stroke identifier
 * @param {Object} options - Options
 * @returns {Promise<Object>} AssistMeasurementOutput
 */
export async function assistMeasurement(strokeLabel, options = {}) {
    const imageLabel = options.imageLabel || window.currentImageLabel;
    
    // Get stroke data
    const stroke = window.vectorStrokesByImage?.[imageLabel]?.[strokeLabel];
    if (!stroke) {
        throw new Error(`Stroke ${strokeLabel} not found`);
    }
    
    // Prepare payload
    const payload = {
        units: options.units || { name: 'cm', pxPerUnit: 37.8 },
        stroke: {
            id: strokeLabel,
            type: stroke.type,
            points: stroke.points,
            color: stroke.color,
            width: stroke.width
        },
        styleGuide: options.styleGuide || null
    };
    
    // Call Worker or mock
    if (USE_MOCK) {
        return await mockWorker.assistMeasurement(payload);
    } else {
        return await callWorkerAPI('/ai/assist-measurement', payload);
    }
}

/**
 * Enhance annotation placement
 * @param {Object} options - Options
 * @returns {Promise<Object>} EnhancePlacementOutput
 */
export async function enhanceAnnotations(options = {}) {
    const imageLabel = options.imageLabel || window.currentImageLabel;
    
    // Create payload
    const { payload, errors } = createWorkerPayload(imageLabel, {
        styleGuide: options.styleGuide
    });
    
    if (!payload) {
        throw new Error('Failed to create valid payload');
    }
    
    // Simplify payload for placement (don't need units)
    const placementPayload = {
        image: payload.image,
        strokes: payload.strokes,
        styleGuide: payload.styleGuide
    };
    
    // Call Worker or mock
    if (USE_MOCK) {
        return await mockWorker.enhanceAnnotations(placementPayload);
    } else {
        return await callWorkerAPI('/ai/enhance-placement', placementPayload);
    }
}

/**
 * Call AI Worker API via Express relay
 * @param {string} endpoint - API endpoint path
 * @param {Object} payload - Request payload
 * @returns {Promise<Object>} Response data
 */
async function callWorkerAPI(endpoint, payload) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5 second timeout
    
    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload),
            signal: controller.signal
        });
        
        clearTimeout(timeout);
        
        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(error.error || `HTTP ${response.status}`);
        }
        
        const result = await response.json();
        
        // Check for fallback flag (Worker failed, use manual export)
        if (result.fallback) {
            throw new Error('Worker unavailable, use manual export');
        }
        
        return result;
    } catch (error) {
        clearTimeout(timeout);
        
        if (error.name === 'AbortError') {
            throw new Error('Request timeout - Worker took too long');
        }
        
        throw error;
    }
}

/**
 * Convert SVG string to PNG blob
 * @param {string} svgString - SVG markup
 * @param {number} width - Output width
 * @param {number} height - Output height
 * @returns {Promise<Blob>} PNG blob
 */
export async function svgToPNG(svgString, width, height) {
    return new Promise((resolve, reject) => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const img = new Image();
        
        // Set canvas size
        canvas.width = width || 800;
        canvas.height = height || 600;
        
        img.onload = () => {
            ctx.drawImage(img, 0, 0);
            canvas.toBlob(blob => {
                if (blob) {
                    resolve(blob);
                } else {
                    reject(new Error('Failed to create PNG blob'));
                }
            }, 'image/png');
        };
        
        img.onerror = () => {
            reject(new Error('Failed to load SVG'));
        };
        
        // Create data URL from SVG
        const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(svgBlob);
        img.src = url;
        
        // Clean up after load
        img.onload = () => {
            URL.revokeObjectURL(url);
            ctx.drawImage(img, 0, 0);
            canvas.toBlob(blob => {
                if (blob) {
                    resolve(blob);
                } else {
                    reject(new Error('Failed to create PNG blob'));
                }
            }, 'image/png');
        };
    });
}

/**
 * Download blob as file
 * @param {Blob|string} data - Blob or string data
 * @param {string} filename - Download filename
 * @param {string} mimeType - MIME type
 */
export function downloadBlob(data, filename, mimeType) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

