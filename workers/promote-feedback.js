/**
 * Cloudflare Worker for promoting feedback into production stroke suggestions
 * Endpoint: /api/promote-feedback
 * 
 * This worker runs on a cron schedule to aggregate feedback entries and
 * promote them into production stroke keys used by draw-bot.js
 * 
 * Cron trigger: Runs daily at 2 AM UTC
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // Route to /api/promote-feedback endpoint
    if (url.pathname !== '/api/promote-feedback' && url.pathname !== '/') {
      return new Response('Not Found', { status: 404 });
    }

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
    };

    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Only accept POST or GET (GET for manual trigger)
    if (request.method !== 'POST' && request.method !== 'GET') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed. Use POST or GET.' }),
        { 
          status: 405,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    try {
      const result = await promoteFeedback(env.SOFA_TAGS);

      return new Response(
        JSON.stringify({
          success: true,
          ...result
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    } catch (error) {
      console.error('Promotion error:', error);
      return new Response(
        JSON.stringify({ 
          error: 'Promotion failed',
          message: error.message 
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }
  },

  // Cron trigger handler (runs daily at 2 AM UTC)
  async scheduled(event, env, ctx) {
    ctx.waitUntil(promoteFeedback(env.SOFA_TAGS));
  }
};

/**
 * Promote feedback entries into production stroke suggestions
 * @param {KVNamespace} kvNamespace - SOFA_TAGS KV namespace
 * @returns {Promise<Object>} Promotion results
 */
async function promoteFeedback(kvNamespace) {
  const promoted = [];
  const skipped = [];
  const errors = [];

  // Get all index keys
  // Note: KV doesn't support listing, so we maintain a manifest
  const manifestKey = 'feedback:manifest';
  let manifest = null;
  
  try {
    const manifestData = await kvNamespace.get(manifestKey, { type: 'json' });
    console.log('[Promote] Manifest data:', manifestData);
    if (manifestData && manifestData.indexKeys) {
      manifest = manifestData.indexKeys;
      console.log(`[Promote] Found manifest with ${manifest.length} index keys:`, manifest);
    } else {
      console.warn('[Promote] Manifest exists but has no indexKeys');
    }
  } catch (e) {
    console.warn('[Promote] No feedback manifest found:', e.message);
  }

  // If no manifest, try to discover index keys by pattern
  // Since KV doesn't support wildcards, we'll need to maintain the manifest
  // For now, we'll process known patterns or rely on manual manifest updates
  
  // Process each index key
  const indexKeys = manifest || [];
  console.log(`[Promote] Processing ${indexKeys.length} index keys`);
  
  for (const indexKey of indexKeys) {
    try {
      console.log(`[Promote] Processing index key: ${indexKey}`);
      const index = await kvNamespace.get(indexKey, { type: 'json' });
      console.log(`[Promote] Index data for ${indexKey}:`, index ? { count: index.count, feedbackIds: index.feedbackIds?.length } : 'not found');
      if (!index || !index.feedbackIds || index.feedbackIds.length === 0) {
        skipped.push({ key: indexKey, reason: 'No feedback entries' });
        console.log(`[Promote] Skipping ${indexKey}: No feedback entries`);
        continue;
      }

      // Extract measurement code and viewpoint from index key
      // Format: feedback:index:<measurementCode>:<viewpoint>
      const parts = indexKey.split(':');
      if (parts.length < 4) {
        skipped.push({ key: indexKey, reason: 'Invalid key format' });
        continue;
      }

      const measurementCode = parts[2];
      const viewpoint = parts[3];

      // Need at least 3 samples to promote
      if (index.count < 3) {
        skipped.push({ 
          key: indexKey, 
          reason: `Insufficient samples (${index.count} < 3)` 
        });
        continue;
      }

      // Fetch feedback entries
      const feedbackEntries = [];
      for (const feedbackId of index.feedbackIds.slice(-50)) { // Process last 50
        const feedbackKey = `feedback:${measurementCode}:${viewpoint}:${feedbackId}`;
        try {
          const entry = await kvNamespace.get(feedbackKey, { type: 'json' });
          if (entry && entry.stroke && entry.stroke.points) {
            // Include image hash/storage key for visual validation
            feedbackEntries.push({
              ...entry,
              hasImage: !!(entry.imageHash || entry.imageStorageKey)
            });
          }
        } catch (e) {
          console.warn(`Failed to fetch feedback ${feedbackId}:`, e);
        }
      }
      
      // Prefer entries with image data for better quality promotion
      feedbackEntries.sort((a, b) => {
        if (a.hasImage && !b.hasImage) return -1;
        if (!a.hasImage && b.hasImage) return 1;
        return 0;
      });

      if (feedbackEntries.length === 0) {
        skipped.push({ key: indexKey, reason: 'No valid feedback entries' });
        continue;
      }

      // Aggregate strokes: average points and width
      const aggregated = aggregateStrokes(feedbackEntries);

      // Create production stroke key
      const productionKey = `stroke:${measurementCode}:${viewpoint}`;
      
      // Check if production stroke already exists
      const existing = await kvNamespace.get(productionKey, { type: 'json' });
      
      // Calculate confidence based on sample count
      const confidence = Math.min(0.95, 0.5 + (index.count / 100));

      const productionStroke = {
        id: existing?.id || `promoted-${Date.now()}`,
        measurementCode,
        viewpoint,
        points: aggregated.points,
        width: aggregated.width,
        confidence,
        sampleCount: index.count,
        lastUpdated: new Date().toISOString(),
        promotedAt: new Date().toISOString()
      };

      // Store in production
      await kvNamespace.put(productionKey, JSON.stringify(productionStroke));

      promoted.push({
        key: productionKey,
        measurementCode,
        viewpoint,
        sampleCount: index.count,
        confidence
      });

      console.log(`Promoted ${productionKey} from ${index.count} samples`);
    } catch (error) {
      console.error(`Error processing ${indexKey}:`, error);
      errors.push({ key: indexKey, error: error.message });
    }
  }

  return {
    promoted: promoted.length,
    skipped: skipped.length,
    errors: errors.length,
    details: {
      promoted,
      skipped: skipped.slice(0, 10), // Limit output
      errors: errors.slice(0, 10)
    }
  };
}

/**
 * Aggregate multiple strokes into a single representative stroke
 * @param {Array} feedbackEntries - Array of feedback entries
 * @returns {Object} Aggregated stroke data
 */
function aggregateStrokes(feedbackEntries) {
  if (feedbackEntries.length === 0) {
    return { points: [], width: 2 };
  }

  if (feedbackEntries.length === 1) {
    const entry = feedbackEntries[0];
    return {
      points: entry.stroke.points || [],
      width: entry.stroke.width || 2
    };
  }

  // For multiple entries, average the points
  // Simple approach: use the median-length stroke and average width
  const strokes = feedbackEntries.map(e => ({
    points: e.stroke.points || [],
    width: e.stroke.width || 2,
    length: calculateStrokeLength(e.stroke.points || [])
  }));

  // Sort by length and pick median
  strokes.sort((a, b) => a.length - b.length);
  const medianIndex = Math.floor(strokes.length / 2);
  const medianStroke = strokes[medianIndex];

  // Average width
  const avgWidth = strokes.reduce((sum, s) => sum + s.width, 0) / strokes.length;

  return {
    points: medianStroke.points,
    width: avgWidth
  };
}

/**
 * Calculate approximate length of a stroke
 * @param {Array} points - Array of {x, y} points
 * @returns {number} Total length
 */
function calculateStrokeLength(points) {
  if (points.length < 2) return 0;
  
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i-1].x;
    const dy = points[i].y - points[i-1].y;
    length += Math.sqrt(dx * dx + dy * dy);
  }
  return length;
}

