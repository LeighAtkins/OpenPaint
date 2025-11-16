/**
 * Cloudflare Worker for classifying sofa images by viewpoint
 * Endpoint: /api/sofa-classify
 * 
 * Accepts: { imageUrl?: string, imageBase64?: string }
 * Returns: { tags: string[], confidence: number, viewpoint?: string }
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // Route to /api/sofa-classify endpoint
    if (url.pathname !== '/api/sofa-classify' && url.pathname !== '/') {
      return new Response('Not Found', { status: 404 });
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
      const { imageUrl, imageBase64, imageHash, imageLabel } = body;

      if (!imageUrl && !imageBase64) {
        return new Response(
          JSON.stringify({ error: 'Either imageUrl or imageBase64 is required' }),
          { 
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        );
      }

      // Use imageHash for deduplication if available
      // For now, use simple rule-based classification
      // TODO: Enhance with Cloudflare AI Vision or exemplar matching
      const classification = await classifySofaViewpoint(
        imageUrl || imageBase64,
        imageHash,
        imageLabel,
        env.SOFA_TAGS,
        env.SOFA_REFERENCE
      );

      return new Response(
        JSON.stringify(classification),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    } catch (error) {
      console.error('Classification error:', error);
      return new Response(
        JSON.stringify({ 
          error: 'Classification failed',
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
 * Classify sofa viewpoint using exemplar matching from KV
 * 
 * @param {string} imageInput - Image URL or base64 string
 * @param {string} imageHash - SHA-256 hash of the image for deduplication
 * @param {string} imageLabel - Image label identifier
 * @param {KVNamespace} kvNamespace - SOFA_TAGS KV namespace
 * @param {R2Bucket} r2Bucket - SOFA_REFERENCE R2 bucket
 * @returns {Promise<{tags: string[], confidence: number, viewpoint?: string}>}
 */
async function classifySofaViewpoint(imageInput, imageHash, imageLabel, kvNamespace, r2Bucket) {
  // Check if we've classified this image before (by hash)
  if (imageHash) {
    const cachedKey = `classification:hash:${imageHash}`;
    try {
      const cached = await kvNamespace.get(cachedKey, { type: 'json' });
      if (cached) {
        console.log('Returning cached classification for hash:', imageHash);
        return cached;
      }
    } catch (e) {
      console.warn('Failed to check cache:', e);
    }
  }
  // Try to fetch exemplar metadata from KV
  // Key format: "exemplar:<viewpoint>:<arm-shape>:<back-height>"
  // Example: "exemplar:front-arm:round-arm:high-back"
  
  // For initial implementation, return a basic classification
  // This will be enhanced with actual exemplar matching
  
  // Check if we have any exemplars stored
  const exemplarKeys = await listExemplarKeys(kvNamespace);
  
  if (exemplarKeys.length === 0) {
    // No exemplars yet - return default/fallback classification
    return {
      tags: ['unknown'],
      confidence: 0.0,
      viewpoint: 'unknown'
    };
  }

  // TODO: Implement actual image comparison/feature matching
  // For now, return a placeholder that can be tested
  // In production, this would:
  // 1. Fetch reference images from R2
  // 2. Compare features (color histograms, edge detection, etc.)
  // 3. Use Cloudflare AI Vision for more sophisticated matching
  
  const result = {
    tags: ['front-center', 'round-arm', 'high-back'],
    confidence: 0.75,
    viewpoint: 'front-center'
  };
  
  // Cache the result by hash if available
  if (imageHash) {
    const cachedKey = `classification:hash:${imageHash}`;
    try {
      await kvNamespace.put(cachedKey, JSON.stringify(result), { expirationTtl: 86400 * 30 }); // 30 days
    } catch (e) {
      console.warn('Failed to cache classification:', e);
    }
  }
  
  return result;
}

/**
 * List all exemplar keys from KV
 * 
 * @param {KVNamespace} kvNamespace 
 * @returns {Promise<string[]>}
 */
async function listExemplarKeys(kvNamespace) {
  // KV doesn't have a native list operation, so we'll need to maintain
  // a manifest key that lists all exemplar keys
  // For now, return empty array - will be populated as exemplars are added
  try {
    const manifest = await kvNamespace.get('exemplar:manifest');
    if (manifest) {
      return JSON.parse(manifest);
    }
  } catch (error) {
    console.error('Error fetching exemplar manifest:', error);
  }
  return [];
}

