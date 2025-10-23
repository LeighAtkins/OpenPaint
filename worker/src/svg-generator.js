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
    const { image, units, strokes, styleGuide = {} } = input || {};
    
    // Validate image dimensions
    if (!image || !Number.isFinite(image.width) || !Number.isFinite(image.height) || 
        image.width <= 0 || image.height <= 0) {
        return {
            svg: "",
            vectors: [],
            summary: { measurements: [], counts: { lines: 0, arrows: 0, labels: 0 } },
            error: { code: "invalid_image", message: "Invalid image dimensions" }
        };
    }
    
    if (!Array.isArray(strokes) || strokes.length === 0) {
        return {
            svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${image.width} ${image.height}" width="${image.width}" height="${image.height}"></svg>`,
            vectors: [],
            summary: { measurements: [], counts: { lines: 0, arrows: 0, labels: 0 } }
        };
    }
    
    if (!validateViewBox(image.width, image.height)) {
        return {
            svg: "",
            vectors: [],
            summary: { measurements: [], counts: { lines: 0, arrows: 0, labels: 0 } },
            error: { code: "invalid_viewbox", message: "Invalid image viewBox" }
        };
    }
    
    // Filter/clean strokes
    const cleaned = strokes
        .filter(s => s && Array.isArray(s.points))
        .map(s => ({ 
            ...s, 
            points: s.points.filter(p => Number.isFinite(p?.x) && Number.isFinite(p?.y)) 
        }))
        .filter(s => s.points.length >= 2);
    
    const vectors = [];
    const occupiedRects = [];
    const measurements = [];
    
    // Merge style guide with defaults
    const style = mergeStyleGuide(styleGuide, image);
    
    // Create SVG header
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${image.width} ${image.height}" width="${image.width}" height="${image.height}">`;
    
    // Add definitions (markers, etc.)
    svg += createDefs(style);
    
    // Process each cleaned stroke
    for (const stroke of cleaned) {
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
    if (units && Number.isFinite(units.pxPerUnit) && units.pxPerUnit > 0) {
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

/**
 * Generate SVG for dimensions with labels
 * @param {Array} dimensions - Array of dimension objects
 * @param {Object} image - Image info with width, height
 * @param {Object} styleGuide - Style guide configuration
 * @returns {string} SVG markup for dimensions
 */
export function generateDimensionSVG(dimensions, image, styleGuide = {}) {
    const style = mergeStyleGuide(styleGuide, image);
    let svg = '';
    
    // Add dimension lines and labels
    for (const dim of dimensions) {
        if (!dim.points || dim.points.length < 2) continue;
        
        const start = dim.points[0];
        const end = dim.points[1];
        
        // Draw dimension line
        svg += `<line x1="${start.x.toFixed(2)}" y1="${start.y.toFixed(2)}" `;
        svg += `x2="${end.x.toFixed(2)}" y2="${end.y.toFixed(2)}" `;
        svg += `stroke="${style.colors.measure}" stroke-width="${style.stroke.baseWidth}" `;
        svg += `stroke-linecap="round" marker-end="url(#arrow-end)" />`;
        
        // Add ticks at endpoints
        const tickSize = style.fonts.size * 0.5;
        svg += generateDimensionTicks(start, end, tickSize, style.colors.measure);
        
        // Add label
        const label = dim.formatted || `${dim.value.toFixed(1)} ${dim.unit}`;
        const midX = (start.x + end.x) / 2;
        const midY = (start.y + end.y) / 2;
        
        svg += generateDimensionLabel(midX, midY, label, style);
    }
    
    return svg;
}

/**
 * Generate dimension ticks at endpoints
 * @param {Object} start - Start point
 * @param {Object} end - End point
 * @param {number} tickSize - Size of ticks
 * @param {string} color - Tick color
 * @returns {string} SVG markup for ticks
 */
function generateDimensionTicks(start, end, tickSize, color) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    
    if (length === 0) return '';
    
    // Perpendicular direction for ticks
    const perpX = -dy / length;
    const perpY = dx / length;
    
    const halfTick = tickSize / 2;
    
    let svg = '';
    
    // Start tick
    svg += `<line x1="${(start.x - perpX * halfTick).toFixed(2)}" y1="${(start.y - perpY * halfTick).toFixed(2)}" `;
    svg += `x2="${(start.x + perpX * halfTick).toFixed(2)}" y2="${(start.y + perpY * halfTick).toFixed(2)}" `;
    svg += `stroke="${color}" stroke-width="2" stroke-linecap="round" />`;
    
    // End tick
    svg += `<line x1="${(end.x - perpX * halfTick).toFixed(2)}" y1="${(end.y - perpY * halfTick).toFixed(2)}" `;
    svg += `x2="${(end.x + perpX * halfTick).toFixed(2)}" y2="${(end.y + perpY * halfTick).toFixed(2)}" `;
    svg += `stroke="${color}" stroke-width="2" stroke-linecap="round" />`;
    
    return svg;
}

/**
 * Generate dimension label with background
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {string} text - Label text
 * @param {Object} style - Style configuration
 * @returns {string} SVG markup for label
 */
function generateDimensionLabel(x, y, text, style) {
    const fontSize = style.fonts.size;
    const fontFamily = style.fonts.family;
    const textColor = style.colors.labelText;
    const bgColor = '#ffffff';
    const borderColor = '#cccccc';
    
    // Estimate text width (rough approximation)
    const textWidth = text.length * fontSize * 0.6;
    const textHeight = fontSize;
    const padding = 4;
    
    const rectX = x - textWidth / 2 - padding;
    const rectY = y - textHeight / 2 - padding;
    const rectWidth = textWidth + padding * 2;
    const rectHeight = textHeight + padding * 2;
    
    let svg = '';
    
    // Background rectangle
    svg += `<rect x="${rectX.toFixed(2)}" y="${rectY.toFixed(2)}" `;
    svg += `width="${rectWidth.toFixed(2)}" height="${rectHeight.toFixed(2)}" `;
    svg += `fill="${bgColor}" stroke="${borderColor}" stroke-width="1" rx="4" />`;
    
    // Text
    svg += `<text x="${x.toFixed(2)}" y="${(y + fontSize / 3).toFixed(2)}" `;
    svg += `fill="${textColor}" font-family="${fontFamily}" `;
    svg += `font-size="${fontSize}" text-anchor="middle" dominant-baseline="middle">`;
    svg += text;
    svg += '</text>';
    
    return svg;
}

