/**
 * Cloudflare Worker for suggesting drawing strokes based on measurement codes and viewpoints
 * Endpoint: /api/draw-bot
 * 
 * Accepts: { measurementCode: string, viewpointTag: string, imageLabel: string, viewport: { width: number, height: number } }
 * Returns: { strokeId: string, measurementCode: string, viewpoint: string, confidence: number, points: Array<{x, y, t}>, width: number }
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // Route to /api/draw-bot endpoint or root
    // Support both /api/draw-bot and / paths for flexibility
    const isValidPath = url.pathname === '/api/draw-bot' || 
                        url.pathname === '/' || 
                        url.pathname === '/api/draw-bot/';
    
    if (!isValidPath) {
      return new Response(
        JSON.stringify({ error: 'Not Found', path: url.pathname }),
        { 
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // CORS headers for Vercel frontend
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Only accept POST requests
    if (request.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed. Use POST.' }),
        { 
          status: 405,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    try {
      const body = await request.json();
      const { action, measurementCode, viewpointTag, imageLabel, viewport, imageHash, imageBase64 } = body;

      // Handle prediction action
      if (action === 'predict') {
        if (!viewpointTag) {
          return new Response(
            JSON.stringify({ error: 'viewpointTag is required for prediction' }),
            { 
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            }
          );
        }

        const predictions = await predictMeasurements(
          viewpointTag,
          imageHash,
          imageBase64,
          viewport,
          env.SOFA_TAGS
        );

        return new Response(
          JSON.stringify({ predictions }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        );
      }

      // Handle suggestion action (default)
      if (!measurementCode || !viewpointTag) {
        return new Response(
          JSON.stringify({ error: 'measurementCode and viewpointTag are required' }),
          { 
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        );
      }

      // Fetch matching strokes from KV
      const suggestion = await getStrokeSuggestion(
        measurementCode,
        viewpointTag,
        viewport,
        env.SOFA_TAGS
      );

      if (!suggestion) {
        return new Response(
          JSON.stringify({ error: 'No matching strokes found' }),
          { 
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        );
      }

      return new Response(
        JSON.stringify(suggestion),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    } catch (error) {
      console.error('Stroke suggestion error:', error);
      return new Response(
        JSON.stringify({ 
          error: 'Suggestion failed',
          message: error.message 
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }
  }
};

/**
 * Predict measurements for a viewpoint
 * 
 * @param {string} viewpointTag - Viewpoint tag
 * @param {string} imageHash - Image hash for context
 * @param {string} imageBase64 - Image base64 data
 * @param {{width: number, height: number}} viewport - Viewport dimensions
 * @param {KVNamespace} kvNamespace - SOFA_TAGS KV namespace
 * @returns {Promise<Array<{code: string, stroke: object, confidence: number}>>}
 */
async function predictMeasurements(viewpointTag, imageHash, imageBase64, viewport, kvNamespace) {
  const predictions = [];
  
  // Common measurement codes for sofas
  const commonCodes = ['A1', 'A2', 'A3', 'A4', 'A5'];
  
  // Try to find strokes for each code
  for (const code of commonCodes) {
    const key = `stroke:${code}:${viewpointTag}`;
    try {
      const strokeData = await kvNamespace.get(key, { type: 'json' });
      if (strokeData) {
        // Scale points to viewport
        const scaled = scaleStrokeToViewport(strokeData, viewport);
        
        predictions.push({
          code,
          stroke: scaled,
          confidence: strokeData.confidence || 0.8
        });
      }
    } catch (e) {
      console.warn(`Failed to fetch stroke for ${code}:`, e);
    }
  }
  
  // Sort by confidence (highest first)
  predictions.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
  
  return predictions;
}

/**
 * Get stroke suggestion based on measurement code and viewpoint
 * 
 * @param {string} measurementCode - Measurement code (e.g., "A1", "A2")
 * @param {string} viewpointTag - Viewpoint tag (e.g., "front-center", "front-arm")
 * @param {{width: number, height: number}} viewport - Viewport dimensions for scaling
 * @param {KVNamespace} kvNamespace - SOFA_TAGS KV namespace
 * @returns {Promise<{strokeId, measurementCode, viewpoint, confidence, points, width} | null>}
 */
async function getStrokeSuggestion(measurementCode, viewpointTag, viewport, kvNamespace) {
  // Construct key for lookup: "stroke:<measurementCode>:<viewpointTag>"
  const key = `stroke:${measurementCode}:${viewpointTag}`;
  
  try {
    const strokeData = await kvNamespace.get(key, { type: 'json' });
    
    if (!strokeData) {
      // Try to find a similar stroke (fallback to any measurement code match)
      const fallbackKey = `stroke:${measurementCode}:*`;
      // KV doesn't support wildcards, so we'll need to maintain an index
      // For now, return null if exact match not found
      return null;
    }

    // Scale points to viewport dimensions
    // Points are stored normalized (0-1), so scale them
    const scaled = scaleStrokeToViewport(strokeData, viewport);

    return {
      strokeId: strokeData.id || `suggested-${Date.now()}`,
      measurementCode: strokeData.measurementCode || measurementCode,
      viewpoint: strokeData.viewpoint || viewpointTag,
      confidence: strokeData.confidence || 0.8,
      points: scaled.points,
      width: scaled.width
    };
  } catch (error) {
    console.error('Error fetching stroke suggestion:', error);
    return null;
  }
}

function clamp01(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function clampPositive(value, fallback = 0) {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.max(0, value);
}

function scaleStrokeToViewport(strokeData, viewport) {
  const widthPx = Math.max(1, viewport?.width || 800);
  const heightPx = Math.max(1, viewport?.height || 600);
  const minDim = Math.max(1, Math.min(widthPx, heightPx));

  const normalizedPoints = Array.isArray(strokeData.points) ? strokeData.points : [];
  const scaledPoints = normalizedPoints.map(point => ({
    x: clamp01(point?.x) * widthPx,
    y: clamp01(point?.y) * heightPx,
    t: point?.t ?? 0
  }));

  const normalizedWidth = clampPositive(strokeData.width || 0.01, 0.01);
  const widthRatio = normalizedWidth <= 1 ? normalizedWidth : normalizedWidth / minDim;
  const scaledWidth = Math.max(1, widthRatio * minDim);

  return {
    points: scaledPoints,
    width: scaledWidth
  };
}

