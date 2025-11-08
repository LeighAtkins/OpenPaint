/**
 * Coordinate Validation Utilities for AI Worker Integration
 * Validates and serializes stroke data in image-space coordinates
 */

/**
 * Validate that a point is within image bounds
 * @param {{x: number, y: number}} point - Point in image-space
 * @param {{width: number, height: number}} imageDims - Image dimensions
 * @returns {boolean} True if point is valid
 */
export function validateImageSpacePoint(point, imageDims) {
    if (!point || typeof point.x !== 'number' || typeof point.y !== 'number') {
        return false;
    }
    return point.x >= 0 && point.x <= imageDims.width && 
           point.y >= 0 && point.y <= imageDims.height;
}

/**
 * Validate an array of points
 * @param {Array<{x: number, y: number}>} points - Points array
 * @param {{width: number, height: number}} imageDims - Image dimensions
 * @returns {{valid: boolean, invalidIndices: number[]}}
 */
export function validatePointsArray(points, imageDims) {
    if (!Array.isArray(points) || points.length === 0) {
        return { valid: false, invalidIndices: [] };
    }
    
    const invalidIndices = [];
    for (let i = 0; i < points.length; i++) {
        if (!validateImageSpacePoint(points[i], imageDims)) {
            invalidIndices.push(i);
        }
    }
    
    return {
        valid: invalidIndices.length === 0,
        invalidIndices
    };
}

/**
 * Serialize strokes for AI Worker payload with validation
 * @param {string} imageLabel - Image label to extract strokes from
 * @returns {{strokes: Array, errors: Array}} Validated strokes and any errors
 */
export function serializeStrokesForWorker(imageLabel) {
    const strokes = [];
    const errors = [];
    
    // Get image dimensions for validation
    const imageDims = window.originalImageDimensions?.[imageLabel];
    if (!imageDims) {
        errors.push({ type: 'missing_dimensions', imageLabel });
        return { strokes, errors };
    }
    
    // Get vector strokes for this image
    const vectorData = window.vectorStrokesByImage?.[imageLabel];
    if (!vectorData || typeof vectorData !== 'object') {
        errors.push({ type: 'missing_strokes', imageLabel });
        return { strokes, errors };
    }
    
    // Process each stroke
    for (const [strokeLabel, stroke] of Object.entries(vectorData)) {
        // Validate stroke structure
        if (!stroke || !stroke.points || !Array.isArray(stroke.points)) {
            errors.push({ 
                type: 'invalid_stroke_structure', 
                strokeLabel, 
                reason: 'Missing or invalid points array' 
            });
            continue;
        }
        
        // Validate points are in bounds
        const validation = validatePointsArray(stroke.points, imageDims);
        if (!validation.valid) {
            errors.push({
                type: 'points_out_of_bounds',
                strokeLabel,
                invalidIndices: validation.invalidIndices,
                imageDims
            });
            // Continue anyway but log the error
        }
        
        // Serialize stroke in AI Worker format
        const serialized = {
            id: strokeLabel,
            type: stroke.type || 'freehand',
            points: stroke.points.map(p => ({ x: p.x, y: p.y })), // Deep copy
            color: stroke.color || '#000000',
            width: stroke.width || 5
        };
        
        // Add optional fields
        if (stroke.arrowSettings) {
            serialized.arrowSettings = {
                startArrow: stroke.arrowSettings.startArrow || false,
                endArrow: stroke.arrowSettings.endArrow || false,
                arrowSize: stroke.arrowSettings.arrowSize || 15
            };
        }
        
        strokes.push(serialized);
    }
    
    return { strokes, errors };
}

/**
 * Validate coordinate transformation parameters
 * @param {string} imageLabel - Image label
 * @returns {{valid: boolean, params: Object|null, error: string|null}}
 */
export function validateTransformParams(imageLabel) {
    const scale = window.imageScaleByLabel?.[imageLabel];
    const position = window.imagePositionByLabel?.[imageLabel];
    const dimensions = window.originalImageDimensions?.[imageLabel];
    const rotation = window.imageRotationByLabel?.[imageLabel];
    
    if (typeof scale !== 'number' || scale <= 0) {
        return { valid: false, params: null, error: 'Invalid or missing scale' };
    }
    
    if (!position || typeof position.x !== 'number' || typeof position.y !== 'number') {
        return { valid: false, params: null, error: 'Invalid or missing position' };
    }
    
    if (!dimensions || typeof dimensions.width !== 'number' || typeof dimensions.height !== 'number') {
        return { valid: false, params: null, error: 'Invalid or missing dimensions' };
    }
    
    return {
        valid: true,
        params: {
            scale,
            position: { x: position.x, y: position.y },
            dimensions: { width: dimensions.width, height: dimensions.height },
            rotation: rotation || 0
        },
        error: null
    };
}

/**
 * Create complete AI Worker payload for an image
 * @param {string} imageLabel - Image label
 * @param {Object} options - Additional options
 * @returns {{payload: Object|null, errors: Array}}
 */
export function createWorkerPayload(imageLabel, options = {}) {
    const errors = [];
    
    // Validate transform params
    const transformValidation = validateTransformParams(imageLabel);
    if (!transformValidation.valid) {
        errors.push({ type: 'transform_validation', error: transformValidation.error });
        return { payload: null, errors };
    }
    
    // Serialize strokes
    const { strokes, errors: strokeErrors } = serializeStrokesForWorker(imageLabel);
    errors.push(...strokeErrors);
    
    if (strokes.length === 0) {
        errors.push({ type: 'no_strokes', imageLabel });
    }
    
    // Build payload
    const payload = {
        image: {
            width: transformValidation.params.dimensions.width,
            height: transformValidation.params.dimensions.height,
            rotation: transformValidation.params.rotation
        },
        units: options.units || { name: 'cm', pxPerUnit: 37.8 },
        strokes,
        prompt: options.prompt || '',
        styleGuide: options.styleGuide || null
    };
    
    return { payload, errors };
}

