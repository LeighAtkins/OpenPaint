/**
 * Local deterministic mock for AI Worker
 * Provides rule-based SVG generation for testing without deploying Worker
 */

import { DEFAULT_STYLE_GUIDE, computeStrokeWidth, computeFontSize } from './ai-style-guide.js';

export class MockAIWorker {
    /**
     * Generate SVG from strokes (mock implementation)
     * @param {Object} input - GenerateSVGInput
     * @returns {Promise<Object>} GenerateSVGOutput
     */
    async generateSVG(input) {
        console.log('[Mock Worker] Generating SVG for', input.strokes.length, 'strokes');
        
        const { image, units, strokes, styleGuide = {} } = input;
        const style = this._mergeStyles(styleGuide, image);
        
        const svg = this._createSVG(image, strokes, units, style);
        const vectors = this._createVectors(strokes, units, image);
        const summary = this._createSummary(vectors, units);
        
        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 100));
        
        return { svg, vectors, summary };
    }
    
    /**
     * Assist with measurement (mock implementation)
     * @param {Object} input - AssistMeasurementInput
     * @returns {Promise<Object>} AssistMeasurementOutput
     */
    async assistMeasurement(input) {
        console.log('[Mock Worker] Assisting measurement for stroke', input.stroke.id);
        
        const { stroke, units } = input;
        const length = this._computeLength(stroke.points);
        const value = units.pxPerUnit ? length / units.pxPerUnit : length;
        const formatted = `${value.toFixed(2)} ${units.name}`;
        
        // Find midpoint for label
        const mid = this._getMidpoint(stroke.points);
        const labelPos = { x: mid.x + 10, y: mid.y - 10 };
        
        await new Promise(resolve => setTimeout(resolve, 50));
        
        return {
            value,
            formatted,
            labelPos,
            fontSize: 14,
            color: DEFAULT_STYLE_GUIDE.colors.measure
        };
    }
    
    /**
     * Enhance placement (mock implementation)
     * @param {Object} input - EnhancePlacementInput
     * @returns {Promise<Object>} EnhancePlacementOutput
     */
    async enhanceAnnotations(input) {
        console.log('[Mock Worker] Enhancing placement for', input.strokes.length, 'strokes');
        
        // Simple mock: just return vectors with slight position adjustments
        const vectors = input.strokes.map(stroke => ({
            id: stroke.id,
            type: stroke.type === 'straight' || stroke.type === 'arrow' ? 'line' : 'path',
            points: stroke.points,
            style: {
                color: stroke.color,
                width: stroke.width,
                marker: stroke.type === 'arrow' ? 'arrow' : 'none'
            }
        }));
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
        return { vectorsUpdated: vectors };
    }
    
    // Private helper methods
    
    _mergeStyles(userStyle, image) {
        const base = { ...DEFAULT_STYLE_GUIDE };
        if (userStyle.colors) Object.assign(base.colors, userStyle.colors);
        if (userStyle.stroke) Object.assign(base.stroke, userStyle.stroke);
        if (userStyle.fonts) Object.assign(base.fonts, userStyle.fonts);
        
        // Compute dynamic sizes
        base.stroke.baseWidth = computeStrokeWidth(image.width, image.height);
        base.fonts.size = computeFontSize(image.width, image.height);
        
        return base;
    }
    
    _createSVG(image, strokes, units, style) {
        let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${image.width} ${image.height}" width="${image.width}" height="${image.height}">`;
        
        // Add defs for markers
        svg += '<defs>';
        svg += `<marker id="arrow-end" markerWidth="${style.markers.arrow.markerWidth}" markerHeight="${style.markers.arrow.markerHeight}" refX="${style.markers.arrow.refX}" refY="${style.markers.arrow.refY}" orient="auto" markerUnits="strokeWidth">`;
        svg += `<path d="${style.markers.arrow.path}" fill="currentColor"/>`;
        svg += '</marker>';
        svg += '</defs>';
        
        // Process each stroke
        for (const stroke of strokes) {
            const simplified = this._simplifyPoints(stroke.points);
            
            if (stroke.type === 'straight' || stroke.type === 'arrow') {
                const start = simplified[0];
                const end = simplified[simplified.length - 1];
                const hasArrow = stroke.type === 'arrow' || stroke.arrowSettings?.endArrow;
                
                svg += `<line x1="${start.x.toFixed(2)}" y1="${start.y.toFixed(2)}" x2="${end.x.toFixed(2)}" y2="${end.y.toFixed(2)}" `;
                svg += `stroke="${stroke.color}" stroke-width="${stroke.width}" `;
                svg += `stroke-linecap="${style.stroke.cap}" `;
                if (hasArrow) {
                    svg += `marker-end="url(#arrow-end)" `;
                }
                svg += '/>';
                
                // Add measurement label if units provided
                if (units && units.pxPerUnit) {
                    const length = Math.hypot(end.x - start.x, end.y - start.y);
                    const measurement = (length / units.pxPerUnit).toFixed(2);
                    const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
                    
                    svg += `<text x="${mid.x.toFixed(2)}" y="${(mid.y - 10).toFixed(2)}" `;
                    svg += `fill="${style.colors.labelText}" font-family="${style.fonts.family}" `;
                    svg += `font-size="${style.fonts.size}" text-anchor="middle">`;
                    svg += `${measurement} ${units.name}</text>`;
                }
            } else if (stroke.type === 'curved' || stroke.type === 'curved-arrow') {
                // Curved path with smooth curves
                const pathData = this._createSmoothPath(simplified);
                svg += `<path d="${pathData}" stroke="${stroke.color}" stroke-width="${stroke.width}" `;
                svg += `fill="none" stroke-linecap="${style.stroke.cap}" stroke-linejoin="${style.stroke.join}" `;
                if (stroke.type === 'curved-arrow' || stroke.arrowSettings?.endArrow) {
                    svg += `marker-end="url(#arrow-end)" `;
                }
                svg += '/>';
            } else {
                // Freehand path
                const pathData = simplified.map((p, i) => 
                    `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`
                ).join(' ');
                svg += `<path d="${pathData}" stroke="${stroke.color}" stroke-width="${stroke.width}" `;
                svg += `fill="none" stroke-linecap="${style.stroke.cap}" stroke-linejoin="${style.stroke.join}" />`;
            }
        }
        
        svg += '</svg>';
        return svg;
    }
    
    _createVectors(strokes, units, image) {
        return strokes.map(stroke => {
            const simplified = this._simplifyPoints(stroke.points);
            const vector = {
                id: stroke.id,
                type: (stroke.type === 'straight' || stroke.type === 'arrow') ? 'line' : 'path',
                points: simplified,
                style: {
                    color: stroke.color,
                    width: stroke.width,
                    marker: (stroke.type === 'arrow' || stroke.arrowSettings?.endArrow) ? 'arrow' : 'none'
                }
            };
            
            // Add measurement label for straight lines
            if (vector.type === 'line' && units && units.pxPerUnit) {
                const length = this._computeLength(simplified);
                const measurement = (length / units.pxPerUnit).toFixed(2);
                const mid = this._getMidpoint(simplified);
                
                vector.label = {
                    text: `${measurement} ${units.name}`,
                    x: mid.x,
                    y: mid.y - 10
                };
            }
            
            return vector;
        });
    }
    
    _createSummary(vectors, units) {
        const measurements = vectors
            .filter(v => v.label)
            .map(v => ({
                id: v.id,
                value: parseFloat(v.label.text),
                units: units.name
            }));
        
        return {
            measurements,
            counts: {
                lines: vectors.filter(v => v.type === 'line').length,
                arrows: vectors.filter(v => v.style.marker === 'arrow').length,
                labels: measurements.length
            }
        };
    }
    
    _simplifyPoints(points, tolerance = 1.0) {
        if (points.length <= 2) return points;
        
        // Simple Douglas-Peucker implementation
        const simplified = [points[0]];
        let prevPoint = points[0];
        
        for (let i = 1; i < points.length - 1; i++) {
            const dist = Math.hypot(points[i].x - prevPoint.x, points[i].y - prevPoint.y);
            if (dist > tolerance) {
                simplified.push(points[i]);
                prevPoint = points[i];
            }
        }
        
        simplified.push(points[points.length - 1]);
        return simplified;
    }
    
    _createSmoothPath(points) {
        if (points.length < 2) return '';
        if (points.length === 2) {
            return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
        }
        
        // Create smooth curve using quadratic bezier
        let path = `M ${points[0].x} ${points[0].y}`;
        for (let i = 1; i < points.length - 1; i++) {
            const xc = (points[i].x + points[i + 1].x) / 2;
            const yc = (points[i].y + points[i + 1].y) / 2;
            path += ` Q ${points[i].x} ${points[i].y}, ${xc} ${yc}`;
        }
        path += ` L ${points[points.length - 1].x} ${points[points.length - 1].y}`;
        return path;
    }
    
    _computeLength(points) {
        let total = 0;
        for (let i = 1; i < points.length; i++) {
            total += Math.hypot(points[i].x - points[i-1].x, points[i].y - points[i-1].y);
        }
        return total;
    }
    
    _getMidpoint(points) {
        if (points.length === 0) return { x: 0, y: 0 };
        if (points.length === 1) return { ...points[0] };
        
        const start = points[0];
        const end = points[points.length - 1];
        return {
            x: (start.x + end.x) / 2,
            y: (start.y + end.y) / 2
        };
    }
}

