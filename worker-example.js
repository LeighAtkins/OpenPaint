// Example Cloudflare Worker for HEIC Conversion
// This is a minimal example that you can customize

/**
 * Cloudflare Worker entry point
 * Deploy this to Cloudflare Workers to enable HEIC conversion
 */
export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // Only accept POST requests
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { 
        status: 405,
        headers: {
          'Access-Control-Allow-Origin': '*',
        }
      });
    }

    try {
      // Get the uploaded file from FormData
      const formData = await request.formData();
      const file = formData.get('file');

      if (!file || !(file instanceof File)) {
        return jsonResponse(
          { error: 'No file provided. Please upload a file.' },
          400
        );
      }

      // Check if it's a HEIC/HEIF file
      const fileName = file.name.toLowerCase();
      const fileType = (file.type || '').toLowerCase();
      const isHeic = 
        fileType === 'image/heic' || 
        fileType === 'image/heif' ||
        fileName.endsWith('.heic') ||
        fileName.endsWith('.heif');

      if (!isHeic) {
        return jsonResponse(
          { error: 'File is not a HEIC/HEIF image. Please upload a .heic or .heif file.' },
          400
        );
      }

      // Convert HEIC to JPEG
      // NOTE: You'll need to implement actual conversion here
      // See CLOUDFLARE_SETUP.md for options
      const convertedBlob = await convertHeicToJpeg(file, env);

      // Return the converted image
      const outputFileName = fileName.replace(/\.heic?$/i, '.jpg');
      
      return new Response(convertedBlob, {
        headers: {
          'Content-Type': 'image/jpeg',
          'Access-Control-Allow-Origin': '*',
          'Content-Disposition': `inline; filename="${outputFileName}"`,
          'Cache-Control': 'public, max-age=3600',
        },
      });
    } catch (error) {
      console.error('[Worker] Conversion error:', error);
      
      return jsonResponse(
        { 
          error: 'Conversion failed', 
          message: error instanceof Error ? error.message : 'Unknown error',
          details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        },
        500
      );
    }
  },
};

/**
 * Convert HEIC file to JPEG
 * 
 * IMPLEMENTATION OPTIONS:
 * 
 * Option 1: Use a third-party service (e.g., Cloudinary)
 * Option 2: Use a WASM-based converter bundled for Workers
 * Option 3: Proxy to another conversion service
 * 
 * @param {File} file - The HEIC file to convert
 * @param {Object} env - Worker environment variables
 * @returns {Promise<Blob>} - The converted JPEG image
 */
async function convertHeicToJpeg(file, env) {
  // OPTION 1: Use Cloudinary (requires CLOUDINARY_CLOUD_NAME and CLOUDINARY_UPLOAD_PRESET in env)
  if (env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_UPLOAD_PRESET) {
    return await convertViaCloudinary(file, env);
  }

  // OPTION 2: Use a WASM converter (you'll need to bundle this)
  // return await convertViaWasm(file);

  // OPTION 3: Use ImageKit or another service
  // return await convertViaImageKit(file, env);

  // Fallback: Return error if no conversion method configured
  throw new Error(
    'HEIC conversion not configured. ' +
    'Please set up CLOUDINARY_CLOUD_NAME and CLOUDINARY_UPLOAD_PRESET in Worker environment variables, ' +
    'or implement another conversion method. See CLOUDFLARE_SETUP.md for details.'
  );
}

/**
 * Convert HEIC via Cloudinary
 * Requires: CLOUDINARY_CLOUD_NAME and CLOUDINARY_UPLOAD_PRESET in env
 */
async function convertViaCloudinary(file, env) {
  const cloudinaryUrl = `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/image/upload`;
  
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', env.CLOUDINARY_UPLOAD_PRESET);
  formData.append('format', 'jpg'); // Convert to JPEG
  formData.append('quality', 'auto:good'); // Good quality, auto optimization

  const response = await fetch(cloudinaryUrl, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Cloudinary upload failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  
  // Fetch the converted image
  const imageResponse = await fetch(data.secure_url);
  if (!imageResponse.ok) {
    throw new Error(`Failed to fetch converted image: ${imageResponse.status}`);
  }

  return await imageResponse.blob();
}

/**
 * Helper to return JSON responses with CORS headers
 */
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

