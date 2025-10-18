/**
 * Default style guide for AI-generated SVG exports
 * Provides consistent styling across all AI Worker outputs
 */

export const DEFAULT_STYLE_GUIDE = {
    colors: {
        primary: '#222222',
        measure: '#0B84F3',
        callout: '#F39C12',
        labelText: '#111111',
        labelBackground: '#FFFFFF',
        labelBorder: '#222222'
    },
    stroke: {
        baseWidth: 2,
        cap: 'round',
        join: 'round'
    },
    fonts: {
        family: 'Inter, Segoe UI, Arial, sans-serif',
        size: 14,
        weight: 'normal'
    },
    labels: {
        box: {
            padding: 4,
            background: '#FFFFFF',
            borderColor: '#222222',
            borderWidth: 1,
            radius: 4
        },
        offset: 8,
        minWidth: 40,
        minHeight: 20
    },
    markers: {
        arrow: {
            markerWidth: 6,
            markerHeight: 6,
            refX: 10,
            refY: 5,
            path: 'M 0 0 L 10 5 L 0 10 z'
        }
    }
};

/**
 * Compute dynamic stroke width based on image dimensions
 * @param {number} imageWidth - Image width in pixels
 * @param {number} imageHeight - Image height in pixels
 * @returns {number} Computed stroke width
 */
export function computeStrokeWidth(imageWidth, imageHeight) {
    const minDim = Math.min(imageWidth, imageHeight);
    return Math.max(1, Math.min(minDim / 400, 3));
}

/**
 * Compute dynamic font size based on image dimensions
 * @param {number} imageWidth - Image width in pixels
 * @param {number} imageHeight - Image height in pixels
 * @returns {number} Computed font size
 */
export function computeFontSize(imageWidth, imageHeight) {
    const minDim = Math.min(imageWidth, imageHeight);
    return Math.max(12, Math.min(minDim / 60, 18));
}

/**
 * Merge user style guide with defaults
 * @param {Object} userStyle - User-provided style overrides
 * @returns {Object} Merged style guide
 */
export function mergeStyleGuide(userStyle) {
    if (!userStyle) return { ...DEFAULT_STYLE_GUIDE };
    
    return {
        colors: { ...DEFAULT_STYLE_GUIDE.colors, ...(userStyle.colors || {}) },
        stroke: { ...DEFAULT_STYLE_GUIDE.stroke, ...(userStyle.stroke || {}) },
        fonts: { ...DEFAULT_STYLE_GUIDE.fonts, ...(userStyle.fonts || {}) },
        labels: {
            ...DEFAULT_STYLE_GUIDE.labels,
            ...(userStyle.labels || {}),
            box: {
                ...DEFAULT_STYLE_GUIDE.labels.box,
                ...(userStyle.labels?.box || {})
            }
        },
        markers: { ...DEFAULT_STYLE_GUIDE.markers, ...(userStyle.markers || {}) }
    };
}

