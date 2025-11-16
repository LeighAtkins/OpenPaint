/**
 * Cloudflare Worker for receiving feedback about strokes and images
 * Endpoint: /api/feedback
 * 
 * Accepts: { 
 *   projectId?: string,
 *   imageLabel: string,
 *   viewpoint?: string,
 *   measurementCode: string,
 *   stroke: { points: Array<{x, y, t}>, width: number, source: string },
 *   labels?: string[],
 *   meta?: object
 * }
 * Returns: { success: boolean, feedbackId: string }
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // Route to /api/feedback endpoint
    if (url.pathname !== '/api/feedback' && url.pathname !== '/') {
      return new Response('Not Found', { status: 404 });
    }

    // CORS headers for Vercel frontend
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
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
      const { projectId, imageLabel, viewpoint, measurementCode, stroke, labels, meta, imageHash, imageBase64 } = body;

      // Validate required fields
      if (!imageLabel || !measurementCode || !stroke || !stroke.points) {
        return new Response(
          JSON.stringify({ error: 'imageLabel, measurementCode, and stroke.points are required' }),
          { 
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        );
      }
      
      // Store image data in R2 if available (for future training)
      let imageStorageKey = null;
      if (imageBase64 && imageHash) {
        try {
          // Store compressed image in R2 for training data
          // Key format: images/<hash>.jpg
          imageStorageKey = `images/${imageHash}.jpg`;
          
          // Convert base64 to buffer (handle both raw base64 and data URL format)
          let base64Data = imageBase64;
          if (imageBase64.includes(',')) {
            base64Data = imageBase64.split(',')[1];
          }
          
          const binaryString = atob(base64Data);
          const imageBuffer = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            imageBuffer[i] = binaryString.charCodeAt(i);
          }
          
          if (env.SOFA_REFERENCE) {
            await env.SOFA_REFERENCE.put(imageStorageKey, imageBuffer, {
              httpMetadata: {
                contentType: 'image/jpeg',
                cacheControl: 'public, max-age=31536000'
              }
            });
          }
        } catch (e) {
          console.warn('Failed to store image in R2:', e);
          // Continue without image storage
        }
      }

      // Normalize and validate stroke data
      const normalizedStroke = normalizeStrokeData(stroke, meta?.canvas);
      if (!normalizedStroke) {
        return new Response(
          JSON.stringify({ error: 'Invalid stroke data' }),
          { 
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        );
      }

      // Derive metadata
      const metadata = deriveStrokeMetadata(normalizedStroke);
      
      // Create feedback entry
      const feedbackId = `feedback-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const feedbackEntry = {
        id: feedbackId,
        projectId: projectId || 'unknown',
        imageLabel,
        viewpoint: viewpoint || 'unknown',
        measurementCode,
        stroke: normalizedStroke,
        labels: labels || [],
        metadata,
        imageHash: imageHash || null,
        imageStorageKey: imageStorageKey || null, // Reference to R2 storage
        meta: {
          ...meta,
          userAgent: request.headers.get('user-agent'),
          timestamp: new Date().toISOString(),
          source: stroke.source || 'manual'
        }
      };

      // Store raw feedback in KV
      const feedbackKey = `feedback:${measurementCode}:${viewpoint || 'unknown'}:${feedbackId}`;
      try {
        console.log(`[Feedback Worker] Attempting to store feedback entry: ${feedbackKey}`);
        console.log(`[Feedback Worker] KV namespace available:`, !!env.SOFA_TAGS);
        const kvResult = await env.SOFA_TAGS.put(feedbackKey, JSON.stringify(feedbackEntry));
        console.log(`[Feedback Worker] KV put result:`, kvResult);
        console.log(`[Feedback Worker] Stored feedback entry: ${feedbackKey}`);
        
        // Verify it was stored
        const verify = await env.SOFA_TAGS.get(feedbackKey);
        console.log(`[Feedback Worker] Verification read:`, verify ? 'SUCCESS' : 'FAILED - key not found');
      } catch (kvError) {
        console.error(`[Feedback Worker] Failed to store feedback in KV:`, kvError);
        console.error(`[Feedback Worker] Error details:`, {
          message: kvError.message,
          stack: kvError.stack,
          name: kvError.name
        });
        return new Response(
          JSON.stringify({ 
            error: 'Failed to store feedback',
            message: kvError.message 
          }),
          { 
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        );
      }

      // Update index for promotion job
      const indexKey = `feedback:index:${measurementCode}:${viewpoint || 'unknown'}`;
      try {
        const existingIndex = await env.SOFA_TAGS.get(indexKey, { type: 'json' }) || { count: 0, lastUpdated: null, feedbackIds: [] };
        existingIndex.count += 1;
        existingIndex.lastUpdated = new Date().toISOString();
        existingIndex.feedbackIds.push(feedbackId);
        // Keep only last 1000 IDs to prevent unbounded growth
        if (existingIndex.feedbackIds.length > 1000) {
          existingIndex.feedbackIds = existingIndex.feedbackIds.slice(-1000);
        }
        await env.SOFA_TAGS.put(indexKey, JSON.stringify(existingIndex));
        console.log(`[Feedback Worker] Updated index: ${indexKey}, count: ${existingIndex.count}`);
      } catch (indexError) {
        console.error(`[Feedback Worker] Failed to update index:`, indexError);
        // Don't fail the request if index update fails, but log it
      }

      // Final verification before returning
      const finalVerify = await env.SOFA_TAGS.get(feedbackKey);
      const indexVerify = await env.SOFA_TAGS.get(indexKey, { type: 'json' });
      
      return new Response(
        JSON.stringify({ 
          success: true, 
          feedbackId,
          message: 'Feedback received and stored',
          kv: {
            feedbackKey,
            indexKey,
            stored: !!finalVerify,
            indexCount: indexVerify?.count || 0
          }
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    } catch (error) {
      console.error('Feedback error:', error);
      return new Response(
        JSON.stringify({ 
          error: 'Feedback submission failed',
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
 * Normalize stroke data to 0-1 coordinates
 * @param {Object} stroke - Stroke data with points
 * @param {{width: number, height: number}} canvas - Canvas dimensions
 * @returns {Object|null} Normalized stroke or null if invalid
 */
function normalizeStrokeData(stroke, canvas) {
  if (!stroke.points || stroke.points.length < 2) {
    return null;
  }

  const canvasWidth = canvas?.width || 800;
  const canvasHeight = canvas?.height || 600;
  const smallerDim = Math.min(canvasWidth, canvasHeight);

  // Normalize points to 0-1 range
  const normalizedPoints = stroke.points.map(point => ({
    x: point.x / canvasWidth,
    y: point.y / canvasHeight,
    t: point.t || 0
  }));

  // Normalize width relative to smaller dimension
  const normalizedWidth = stroke.width / smallerDim;

  return {
    points: normalizedPoints,
    width: normalizedWidth,
    source: stroke.source || 'manual'
  };
}

/**
 * Derive metadata from normalized stroke
 * @param {Object} normalizedStroke - Normalized stroke data
 * @returns {Object} Metadata object
 */
function deriveStrokeMetadata(normalizedStroke) {
  const points = normalizedStroke.points;
  
  // Calculate bounding box
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const bbox = {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys)
  };

  // Calculate approximate length
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i-1].x;
    const dy = points[i].y - points[i-1].y;
    length += Math.sqrt(dx * dx + dy * dy);
  }

  // Calculate average angle (simplified)
  const angles = [];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i-1].x;
    const dy = points[i].y - points[i-1].y;
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    angles.push(angle);
  }
  const avgAngle = angles.length > 0 
    ? angles.reduce((a, b) => a + b, 0) / angles.length 
    : 0;

  return {
    bbox,
    length,
    avgAngle,
    pointCount: points.length
  };
}

