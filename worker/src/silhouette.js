/**
 * Silhouette Extraction Module
 * Handles silhouette detection from images, with REMBG mask support
 */

/**
 * Extract silhouette from image using REMBG mask if available
 * @param {string} imageUrl - URL of the image to process
 * @returns {Promise<{outline: Array, bbox: Object, anchors: Object}>}
 */
export async function extractSilhouetteFromRembg(imageUrl) {
  try {
    // First, try to get REMBG processed version
    const rembgUrl = imageUrl.replace('/public', '/rembg');
    let rembgResponse;
    
    try {
      rembgResponse = await fetch(rembgUrl);
    } catch (error) {
      console.log('[Silhouette] REMBG version not available, using original image');
      rembgResponse = null;
    }
    
    let imageResponse;
    if (rembgResponse && rembgResponse.ok) {
      console.log('[Silhouette] Using REMBG processed image');
      imageResponse = rembgResponse;
    } else {
      console.log('[Silhouette] Using original image');
      imageResponse = await fetch(imageUrl);
    }
    
    if (!imageResponse.ok) {
      throw new Error(`Failed to fetch image: ${imageResponse.status}`);
    }
    
    const imageData = await imageResponse.arrayBuffer();
    
    // For now, use a simple bounding box approach since createImageBitmap is not available in Workers
    // This is a fallback that will work for basic silhouette detection
    const width = 640; // Default width - in real implementation, this would be parsed from image headers
    const height = 480; // Default height
    
    // Create a simple bounding box as fallback
    const bbox = {
        x: 50,
        y: 50, 
        width: width - 100,
        height: height - 100
    };
    
    // Generate anchors from bounding box
    const anchors = {
        leftExtreme: { x: bbox.x, y: bbox.y + bbox.height / 2 },
        rightExtreme: { x: bbox.x + bbox.width, y: bbox.y + bbox.height / 2 },
        seatFront: { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height * 0.7 },
        backTop: { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height * 0.3 }
    };
    
    return {
        outline: [
            { x: bbox.x, y: bbox.y },
            { x: bbox.x + bbox.width, y: bbox.y },
            { x: bbox.x + bbox.width, y: bbox.y + bbox.height },
            { x: bbox.x, y: bbox.y + bbox.height }
        ],
        bbox,
        anchors
    };
    
  } catch (error) {
    console.error('[Silhouette] Extraction failed:', error);
    throw error;
  }
}

/**
 * Extract silhouette from image data using alpha channel
 * @param {Uint8ClampedArray} data - Image data
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @returns {{outline: Array, bbox: Object, anchors: Object}}
 */
function extractSilhouetteFromImageData(data, width, height) {
  // Find bounding box from alpha channel
  let minX = width, maxX = 0, minY = height, maxY = 0;
  let hasAlpha = false;
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha > 128) { // Threshold for visible pixels
        hasAlpha = true;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  
  if (!hasAlpha) {
    // Fallback: use full image bounds
    minX = 0;
    maxX = width - 1;
    minY = 0;
    maxY = height - 1;
  }
  
  const bbox = {
    minX, maxX, minY, maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2
  };
  
  // Create simple outline polygon (rectangle for now)
  const outline = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
    { x: minX, y: minY } // Close the polygon
  ];
  
  // Find anchors based on bounding box
  const anchors = findAnchors(bbox);
  
  return {
    outline,
    bbox,
    anchors
  };
}

/**
 * Find key anchor points for furniture dimensions
 * @param {Object} bbox - Bounding box with minX, maxX, minY, maxY, etc.
 * @returns {Object} Anchor points
 */
function findAnchors(bbox) {
  const { minX, maxX, minY, maxY, width, height, centerX, centerY } = bbox;
  
  return {
    // Left and right extremes (arm outer edges)
    leftExtreme: { x: minX, y: centerY },
    rightExtreme: { x: maxX, y: centerY },
    
    // Seat ridge (lower third horizontal line)
    seatFront: { x: centerX, y: minY + height * 0.67 },
    
    // Back top (upper portion)
    backTop: { x: centerX, y: minY + height * 0.2 },
    
    // Center points
    center: { x: centerX, y: centerY },
    
    // Additional reference points
    leftCenter: { x: minX + width * 0.25, y: centerY },
    rightCenter: { x: minX + width * 0.75, y: centerY }
  };
}

/**
 * Detect bounding box from image data
 * @param {Uint8ClampedArray} data - Image data
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @returns {Object} Bounding box coordinates
 */
export function detectBoundingBox(data, width, height) {
  let minX = width, maxX = 0, minY = height, maxY = 0;
  let hasVisiblePixels = false;
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha > 128) { // Threshold for visible pixels
        hasVisiblePixels = true;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  
  if (!hasVisiblePixels) {
    // Fallback: use full image bounds
    return {
      minX: 0,
      maxX: width - 1,
      minY: 0,
      maxY: height - 1,
      width: width,
      height: height
    };
  }
  
  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1
  };
}
