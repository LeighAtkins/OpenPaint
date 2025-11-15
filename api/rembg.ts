export const config = {
  runtime: 'edge',
};

function cors(headers: HeadersInit = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
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

    const REMBG_URL = process.env.REMBG_URL;
    if (!REMBG_URL) {
      // Fallback passthrough: echo original file (no-op removal), keeps pipeline working in dev
      return new Response(file.stream(), {
        status: 200,
        headers: cors({ 'Content-Type': file.type || 'image/png' }),
      });
    }

    // Forward to external rembg service
    const outRes = await fetch(REMBG_URL, {
      method: 'POST',
      body: (() => { const f = new FormData(); f.append('file', file, 'input.png'); return f; })(),
    });
    if (!outRes.ok) {
      const txt = await outRes.text().catch(() => '');
      return new Response(`Upstream error: ${outRes.status} ${txt.slice(0,200)}`, { status: 502, headers: cors() });
    }
    const contentType = outRes.headers.get('content-type') || 'image/png';
    const body = await outRes.arrayBuffer();
    return new Response(body, {
      status: 200,
      headers: cors({ 'Content-Type': contentType }),
    });
  } catch (e: any) {
    return new Response(`Server error: ${e?.message || e}`, { status: 500, headers: cors() });
  }
}

