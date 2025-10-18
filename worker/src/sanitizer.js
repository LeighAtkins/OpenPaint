/**
 * SVG sanitization utilities
 * Ensures generated SVG is safe and doesn't contain malicious content
 */

/**
 * Sanitize SVG markup
 * @param {string} svg - SVG markup to sanitize
 * @returns {string} Sanitized SVG
 */
export function sanitizeSVG(svg) {
    // Remove script tags and event handlers
    let sanitized = svg.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    
    // Remove event handler attributes
    sanitized = sanitized.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '');
    
    // Remove javascript: protocol
    sanitized = sanitized.replace(/javascript:/gi, '');
    
    // Remove data: URIs (except for safe image types)
    sanitized = sanitized.replace(/data:(?!image\/(png|jpg|jpeg|gif|svg\+xml))[^"']*/gi, '');
    
    // Escape any remaining potentially dangerous content
    sanitized = escapeXMLEntities(sanitized);
    
    return sanitized;
}

/**
 * Escape XML entities in text content
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeXMLEntities(text) {
    // Only escape text content within tags, not the tags themselves
    return text.replace(/>([^<]+)</g, (match, content) => {
        const escaped = content
            .replace(/&(?!(amp|lt|gt|quot|apos);)/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
        return `>${escaped}<`;
    });
}

/**
 * Validate SVG viewBox
 * @param {number} width - Width
 * @param {number} height - Height
 * @returns {boolean} True if valid
 */
export function validateViewBox(width, height) {
    return (
        typeof width === 'number' &&
        typeof height === 'number' &&
        width > 0 &&
        width <= 10000 &&
        height > 0 &&
        height <= 10000 &&
        isFinite(width) &&
        isFinite(height)
    );
}

/**
 * Sanitize color value
 * @param {string} color - Color value
 * @returns {string} Sanitized color
 */
export function sanitizeColor(color) {
    // Allow hex colors, rgb(), rgba(), named colors
    if (/^#[0-9A-Fa-f]{3,8}$/.test(color)) {
        return color;
    }
    if (/^rgba?\([^)]+\)$/.test(color)) {
        return color;
    }
    // Named colors (basic set)
    const namedColors = ['black', 'white', 'red', 'green', 'blue', 'yellow', 'orange', 'purple', 'gray', 'transparent'];
    if (namedColors.includes(color.toLowerCase())) {
        return color;
    }
    // Default to black if invalid
    return '#000000';
}

/**
 * Sanitize numeric value
 * @param {number} value - Numeric value
 * @param {number} min - Minimum allowed
 * @param {number} max - Maximum allowed
 * @param {number} defaultValue - Default if invalid
 * @returns {number} Sanitized value
 */
export function sanitizeNumber(value, min = 0, max = 10000, defaultValue = 0) {
    if (typeof value !== 'number' || !isFinite(value)) {
        return defaultValue;
    }
    return Math.max(min, Math.min(max, value));
}

