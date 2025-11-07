export const config = {
  runtime: 'edge',
};

function cors(headers: HeadersInit = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
    'Cache-Control': 'public, max-age=31536000, immutable',
    ...headers,
  } as HeadersInit;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors() });
  }
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: cors() });
  }

  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return new Response('Bad Request: missing file', { status: 400, headers: cors() });
    }

    const CF_WORKER_URL = process.env.CF_WORKER_URL;
    const CF_API_KEY = process.env.CF_API_KEY || 'dev-secret';

    if (!CF_WORKER_URL) {
      // Fallback passthrough: echo original file (no-op removal), keeps pipeline working in dev
      console.log('[REMBG] CF_WORKER_URL not set, returning original file');
      return new Response(file.stream(), {
        status: 200,
        headers: cors({ 'Content-Type': file.type || 'image/png' }),
      });
    }

    // Step 1: Get direct upload URL from Cloudflare worker
    const uploadUrl = `${CF_WORKER_URL}/images/direct-upload`;
    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'X-API-Key': CF_API_KEY,
      },
    });

    if (!uploadRes.ok) {
      console.error('[REMBG] Failed to get upload URL:', uploadRes.status);
      return new Response('Failed to get upload URL', { status: 502, headers: cors() });
    }

    const uploadData = await uploadRes.json<any>();
    const { uploadURL, id: imageId } = uploadData.result || uploadData;

    // Step 2: Upload file to Cloudflare Images
    const fileUploadRes = await fetch(uploadURL, {
      method: 'POST',
      body: file,
    });

    if (!fileUploadRes.ok) {
      console.error('[REMBG] Failed to upload file:', fileUploadRes.status);
      return new Response('Failed to upload file', { status: 502, headers: cors() });
    }

    // Step 3: Request background removal
    const removeUrl = `${CF_WORKER_URL}/remove-background`;
    const removeRes = await fetch(removeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': CF_API_KEY,
      },
      body: JSON.stringify({ imageId, return: 'bytes' }),
    });

    if (!removeRes.ok) {
      const txt = await removeRes.text().catch(() => '');
      console.error('[REMBG] Background removal failed:', removeRes.status, txt);
      return new Response(`Background removal failed: ${removeRes.status}`, { status: 502, headers: cors() });
    }

    // Return the processed image
    const contentType = removeRes.headers.get('content-type') || 'image/png';
    const body = await removeRes.arrayBuffer();

    return new Response(body, {
      status: 200,
      headers: cors({ 'Content-Type': contentType }),
    });
  } catch (e: any) {
    console.error('[REMBG] Error:', e);
    return new Response(`Server error: ${e?.message || e}`, { status: 500, headers: cors() });
  }
}

