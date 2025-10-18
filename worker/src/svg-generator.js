/**
 * SVG Generator
 * Rule-based SVG generation from stroke data
 */

import { simplifyPath, computeLength, getMidpoint, createSmoothPath } from './geometry.js';
import { placeLabelGreedy, estimateLabelSize } from './placement.js';
import { sanitizeSVG, sanitizeColor, sanitizeNumber, validateViewBox } from './sanitizer.js';

/**
 * Generate SVG from stroke input
 * @param {Object} input - GenerateSVGInput
 * @returns {Object} GenerateSVGOutput
 */
export async function generateSVG(input) {
    const { image, units, strokes, styleGuide = {} } = input;
    
    // Validate image dimensions
    if (!validateViewBox(image.width, image.height)) {
        throw new Error('Invalid image dimensions');
    }
    
    const vectors = [];
    const occupiedRects = [];
    const measurements = [];
    
    // Merge style guide with defaults
    const style = mergeStyleGuide(styleGuide, image);
    
    // Create SVG header
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${image.width} ${image.height}" width="${image.width}" height="${image.height}">`;
    
    // Add definitions (markers, etc.)
    svg += createDefs(style);
    
    // Process each stroke
    for (const stroke of strokes) {
        const result = processStroke(stroke, units, style, occupiedRects, image);
        svg += result.svg;
        vectors.push(result.vector);
        
        if (result.measurement) {
            measurements.push(result.measurement);
        }
    }
    
    svg += '</svg>';
    
    // Sanitize final SVG
    const sanitized = sanitizeSVG(svg);
    
    // Create summary
    const summary = {
        measurements,
        counts: {
            lines: vectors.filter(v => v.type === 'line').length,
            arrows: vectors.filter(v => v.style.marker === 'arrow').length,
            labels: measurements.length
        }
    };
    
    return {
        svg: sanitized,
        vectors,
        summary
    };
}

/**
 * Create SVG definitions
 * @param {Object} style - Style guide
 * @returns {string} SVG defs markup
 */
function createDefs(style) {
    const marker = style.markers?.arrow || {};
    const markerWidth = sanitizeNumber(marker.markerWidth, 1, 20, 6);
    const markerHeight = sanitizeNumber(marker.markerHeight, 1, 20, 6);
    const refX = sanitizeNumber(marker.refX, 0, 20, 10);
    const refY = sanitizeNumber(marker.refY, 0, 20, 5);
    const path = marker.path || 'M 0 0 L 10 5 L 0 10 z';
    
    return `<defs>
        <marker id="arrow-end" markerWidth="${markerWidth}" markerHeight="${markerHeight}" 
                refX="${refX}" refY="${refY}" orient="auto" markerUnits="strokeWidth">
            <path d="${path}" fill="currentColor"/>
        </marker>
    </defs>`;
}

/**
 * Process a single stroke
 * @param {Object} stroke - Stroke data
 * @param {Object} units - Unit configuration
 * @param {Object} style - Style guide
 * @param {Array} occupiedRects - Occupied rectangles for label placement
 * @param {Object} image - Image info
 * @returns {Object} SVG markup and vector data
 */
function processStroke(stroke, units, style, occupiedRects, image) {
    const simplified = simplifyPath(stroke.points, 1.0);
    const color = sanitizeColor(stroke.color);
    const width = sanitizeNumber(stroke.width, 0.5, 50, 2);
    
    let svg = '';
    let vector = {
        id: stroke.id,
        type: 'path',
        points: simplified,
        style: {
            color,
            width,
            marker: 'none'
        }
    };
    let measurement = null;
    
    // Handle different stroke types
    if (stroke.type === 'straight' || stroke.type === 'arrow') {
        const result = processStraightLine(stroke, simplified, color, width, units, style, occupiedRects, image);
        svg = result.svg;
        vector.type = 'line';
        vector.style.marker = result.hasArrow ? 'arrow' : 'none';
        measurement = result.measurement;
        if (result.label) {
            vector.label = result.label;
        }
    } else if (stroke.type === 'curved' || stroke.type === 'curved-arrow') {
        const result = processCurvedLine(stroke, simplified, color, width, style);
        svg = result.svg;
        vector.style.marker = result.hasArrow ? 'arrow' : 'none';
    } else {
        // Freehand path
        svg = processFreehandPath(simplified, color, width, style);
    }
    
    return { svg, vector, measurement };
}

/**
 * Process straight line stroke
 */
function processStraightLine(stroke, points, color, width, units, style, occupiedRects, image) {
    const start = points[0];
    const end = points[points.length - 1];
    const hasArrow = stroke.type === 'arrow' || stroke.arrowSettings?.endArrow;
    
    const cap = style.stroke?.cap || 'round';
    
    let svg = `<line x1="${start.x.toFixed(2)}" y1="${start.y.toFixed(2)}" `;
    svg += `x2="${end.x.toFixed(2)}" y2="${end.y.toFixed(2)}" `;
    svg += `stroke="${color}" stroke-width="${width}" stroke-linecap="${cap}" `;
    if (hasArrow) {
        svg += `marker-end="url(#arrow-end)" `;
    }
    svg += '/>';
    
    let measurement = null;
    let label = null;
    
    // Add measurement label if units provided
    if (units && units.pxPerUnit) {
        const length = Math.hypot(end.x - start.x, end.y - start.y);
        const value = length / units.pxPerUnit;
        const formatted = `${value.toFixed(2)} ${units.name}`;
        
        const mid = getMidpoint([start, end]);
        const fontSize = style.fonts?.size || 14;
        const labelSize = estimateLabelSize(formatted, fontSize);
        const labelPos = placeLabelGreedy(mid, occupiedRects, image, labelSize);
        
        const textColor = style.colors?.labelText || '#111111';
        const fontFamily = style.fonts?.family || 'Arial, sans-serif';
        
        svg += `<text x="${labelPos.x.toFixed(2)}" y="${labelPos.y.toFixed(2)}" `;
        svg += `fill="${textColor}" font-family="${fontFamily}" `;
        svg += `font-size="${fontSize}" text-anchor="middle">`;
        svg += formatted;
        svg += '</text>';
        
        measurement = {
            id: stroke.id,
            value,
            units: units.name
        };
        
        label = {
            text: formatted,
            x: labelPos.x,
            y: labelPos.y
        };
    }
    
    return { svg, hasArrow, measurement, label };
}

/**
 * Process curved line stroke
 */
function processCurvedLine(stroke, points, color, width, style) {
    const hasArrow = stroke.type === 'curved-arrow' || stroke.arrowSettings?.endArrow;
    const pathData = createSmoothPath(points);
    const cap = style.stroke?.cap || 'round';
    const join = style.stroke?.join || 'round';
    
    let svg = `<path d="${pathData}" stroke="${color}" stroke-width="${width}" `;
    svg += `fill="none" stroke-linecap="${cap}" stroke-linejoin="${join}" `;
    if (hasArrow) {
        svg += `marker-end="url(#arrow-end)" `;
    }
    svg += '/>';
    
    return { svg, hasArrow };
}

/**
 * Process freehand path stroke
 */
function processFreehandPath(points, color, width, style) {
    const pathData = points.map((p, i) => 
        `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`
    ).join(' ');
    
    const cap = style.stroke?.cap || 'round';
    const join = style.stroke?.join || 'round';
    
    let svg = `<path d="${pathData}" stroke="${color}" stroke-width="${width}" `;
    svg += `fill="none" stroke-linecap="${cap}" stroke-linejoin="${join}" />`;
    
    return svg;
}

/**
 * Merge user style guide with defaults
 */
function mergeStyleGuide(userStyle, image) {
    const defaults = {
        colors: {
            primary: '#222222',
            measure: '#0B84F3',
            callout: '#F39C12',
            labelText: '#111111'
        },
        stroke: {
            baseWidth: 2,
            cap: 'round',
            join: 'round'
        },
        fonts: {
            family: 'Inter, Arial, sans-serif',
            size: 14
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
    
    // Deep merge
    const merged = JSON.parse(JSON.stringify(defaults));
    if (userStyle) {
        if (userStyle.colors) Object.assign(merged.colors, userStyle.colors);
        if (userStyle.stroke) Object.assign(merged.stroke, userStyle.stroke);
        if (userStyle.fonts) Object.assign(merged.fonts, userStyle.fonts);
        if (userStyle.markers) Object.assign(merged.markers, userStyle.markers);
    }
    
    return merged;
}

