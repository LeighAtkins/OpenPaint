/**
 * Cloudflare Worker for AI-enhanced SVG generation
 * Main entry point
 */

import { generateSVG, generateDimensionSVG } from './svg-generator.js';
import { computeLength, getMidpoint } from './geometry.js';
import { extractSilhouetteFromRembg } from './silhouette.js';
import { computePxPerUnit } from './calibration.js';
import { generateBasicDimensions } from './dimensions.js';

/**
 * Helper function to create CORS headers
 * @param {string} origin - Origin to allow (default: '*')
 * @returns {Object} CORS headers
 */
function cors(origin = '*') {
    return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, X-Request-ID'
    };
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const origin = request.headers.get('Origin') || '*';
        
        // Handle preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: cors(origin) });
        }
        
        // Public health check (no auth required)
        if (url.pathname === '/health') {
            return new Response(JSON.stringify({ 
                status: 'ok', 
                version: '1.0.0'
            }), {
                headers: { 
                    'Content-Type': 'application/json', 
                    ...cors(origin) 
                }
            });
        }
        
        // Auth check for all protected endpoints
        const key = request.headers.get('X-API-Key');
        if (!key || key !== env.AI_WORKER_KEY) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401,
                headers: { 
                    'Content-Type': 'application/json', 
                    ...cors(origin) 
                }
            });
        }
        
        // Route handling
        try {
            if (url.pathname === '/generate-svg' && request.method === 'POST') {
                return await handleGenerateSVG(request, origin);
            }
            
            if (url.pathname === '/assist-measurement' && request.method === 'POST') {
                return await handleAssistMeasurement(request, origin);
            }
            
            if (url.pathname === '/enhance-placement' && request.method === 'POST') {
                return await handleEnhancePlacement(request, origin);
            }
            
            if (url.pathname === '/generate-svg' && request.method === 'POST') {
                try {
                    const body = await request.json();
                    const out = await generateSVG(body);
                    if (out?.error) return json(out, 400);
                    return json(out, 200);
                } catch (e) {
                    console.error("generate-svg error:", e);
                    return json({ error: { code: "internal_error", message: String(e) } }, 500);
                }
            }
            
            if (url.pathname === '/analyze-and-dimension' && request.method === 'POST') {
                return await handleAnalyzeAndDimension(request, origin);
            }
            
            return new Response(JSON.stringify({ error: 'Not Found' }), {
                status: 404,
                headers: { 
                    'Content-Type': 'application/json', 
                    ...cors(origin) 
                }
            });
        } catch (error) {
            console.error('Worker error:', error);
            return new Response(JSON.stringify({ 
                error: 'Internal Server Error',
                message: error.message 
            }), {
                status: 500,
                headers: { 
                    'Content-Type': 'application/json', 
                    ...cors(origin) 
                }
            });
        }
    }
};

/**
 * Handle generate-svg endpoint
 */
async function handleGenerateSVG(request, origin) {
    const input = await request.json();
    
    // Validate input
    if (!input.image || !input.strokes || !Array.isArray(input.strokes)) {
        return new Response(JSON.stringify({ 
            error: 'Invalid input: image and strokes required' 
        }), {
            status: 400,
            headers: { 
                'Content-Type': 'application/json', 
                ...cors(origin) 
            }
        });
    }
    
    const startTime = Date.now();
    const result = await generateSVG(input);
    const duration = Date.now() - startTime;
    
    console.log(`Generated SVG in ${duration}ms: ${result.vectors.length} vectors`);
    
    return new Response(JSON.stringify(result), {
        headers: { 
            'Content-Type': 'application/json',
            'X-Processing-Time': `${duration}ms`,
            ...cors(origin)
        }
    });
}

/**
 * Handle assist-measurement endpoint
 */
async function handleAssistMeasurement(request, origin) {
    const input = await request.json();
    
    if (!input.units || !input.stroke) {
        return new Response(JSON.stringify({ 
            error: 'Invalid input: units and stroke required' 
        }), {
            status: 400,
            headers: { 
                'Content-Type': 'application/json', 
                ...cors(origin) 
            }
        });
    }
    
    const { stroke, units, styleGuide = {} } = input;
    
    // Compute measurement
    const length = computeLength(stroke.points);
    const value = units.pxPerUnit ? length / units.pxPerUnit : length;
    const formatted = `${value.toFixed(2)} ${units.name}`;
    
    // Find midpoint for label
    const mid = getMidpoint(stroke.points);
    const labelPos = { x: mid.x + 10, y: mid.y - 10 };
    
    const result = {
        value,
        formatted,
        labelPos,
        fontSize: styleGuide.fonts?.size || 14,
        color: styleGuide.colors?.measure || '#0B84F3'
    };
    
    return new Response(JSON.stringify(result), {
        headers: { 
            'Content-Type': 'application/json', 
            ...cors(origin) 
        }
    });
}

/**
 * Handle enhance-placement endpoint
 */
async function handleEnhancePlacement(request, origin) {
    const input = await request.json();
    
    if (!input.image || !input.strokes || !Array.isArray(input.strokes)) {
        return new Response(JSON.stringify({ 
            error: 'Invalid input: image and strokes required' 
        }), {
            status: 400,
            headers: { 
                'Content-Type': 'application/json', 
                ...cors(origin) 
            }
        });
    }
    
    // For now, return strokes as-is (basic implementation)
    // Future: implement force-directed placement
    const vectorsUpdated = input.strokes.map(stroke => ({
        id: stroke.id,
        type: (stroke.type === 'straight' || stroke.type === 'arrow') ? 'line' : 'path',
        points: stroke.points,
        style: {
            color: stroke.color,
            width: stroke.width,
            marker: (stroke.type === 'arrow' || stroke.arrowSettings?.endArrow) ? 'arrow' : 'none'
        }
    }));
    
    const result = { vectorsUpdated };
    
    return new Response(JSON.stringify(result), {
        headers: { 
            'Content-Type': 'application/json', 
            ...cors(origin) 
        }
    });
}

/**
 * Handle analyze-and-dimension endpoint
 */
async function handleAnalyzeAndDimension(request, origin) {
    const input = await request.json();
    
    // Validate input
    if (!input.image || !input.imageUrl || !input.calibration) {
        return new Response(JSON.stringify({ 
            error: 'Invalid input: image, imageUrl, and calibration required' 
        }), {
            status: 400,
            headers: { 
                'Content-Type': 'application/json', 
                ...cors(origin) 
            }
        });
    }
    
    try {
        const { image, imageUrl, calibration, view = 'front', options = {} } = input;
        
        console.log('[Analyze] Processing image:', imageUrl);
        console.log('[Analyze] View:', view, 'Options:', options);
        
        // Extract silhouette
        const silhouette = await extractSilhouetteFromRembg(imageUrl);
        console.log('[Analyze] Silhouette extracted:', silhouette.bbox);
        
        // Compute calibration
        const { pxPerUnit, unit } = computePxPerUnit(calibration);
        console.log('[Analyze] Calibration:', pxPerUnit, 'px per', unit);
        
        // Generate dimensions
        const dimensions = generateBasicDimensions(silhouette.anchors, pxPerUnit, unit, view);
        console.log('[Analyze] Generated', dimensions.length, 'dimensions');
        
        // Generate SVG
        const dimensionSVG = generateDimensionSVG(dimensions, image, input.styleGuide);
        
        // Create vectors for frontend
        const vectors = dimensions.map(dim => ({
            id: dim.id,
            type: 'line',
            points: dim.points,
            style: {
                color: '#0B84F3',
                width: 2,
                marker: 'arrow'
            },
            label: dim.formatted
        }));
        
        // Create summary
        const summary = {
            dims: dimensions.map(dim => ({
                id: dim.id,
                value: dim.value,
                unit: dim.unit
            })),
            notes: [
                `Calibrated: 1 ${unit} = ${pxPerUnit.toFixed(1)} px`,
                `View: ${view}`,
                `Dimensions: ${dimensions.length}`
            ]
        };
        
        const result = {
            svg: dimensionSVG,
            vectors,
            derived: {
                pxPerUnit,
                unit,
                kDepthUsed: view === '3q' ? 0.7 : null
            },
            summary
        };
        
        console.log('[Analyze] Result generated:', summary);
        
        return new Response(JSON.stringify(result), {
            headers: { 
                'Content-Type': 'application/json', 
                ...cors(origin) 
            }
        });
        
    } catch (error) {
        console.error('[Analyze] Error:', error);
        return new Response(JSON.stringify({ 
            error: 'Analysis failed', 
            message: error.message 
        }), {
            status: 500,
            headers: { 
                'Content-Type': 'application/json', 
                ...cors(origin) 
            }
        });
    }
}

