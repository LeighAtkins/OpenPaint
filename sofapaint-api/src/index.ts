// src/index.ts

export interface Env {
	CF_ACCOUNT_ID: string;        // e.g. "665aca072a7cddbc216be6b25a6fd951"
	ALLOWED_ORIGINS: string;      // e.g. "https://sofapaint.vercel.app,https://leighatkins.github.io"
	ACCOUNT_HASH: string;         // from imagedelivery.net/<HASH>/<id>/...
	IMAGES_API_TOKEN: string;     // secret (Images:Edit at Account scope)
	IMAGES: any;                  // Images binding ([images] binding = "IMAGES" in wrangler.toml)
  }
  
  const cors = (env: Env, origin: string | null) => {
	const allow = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
	const ok = origin && allow.includes(origin);
	return {
	  "access-control-allow-origin": ok ? (origin as string) : (allow[0] || "*"),
	  "access-control-allow-headers": "content-type, x-api-key, authorization",
	  "access-control-allow-methods": "GET,POST,OPTIONS",
	};
  };
  
  const json = (env: Env, origin: string | null, body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
	  status,
	  headers: { "content-type": "application/json", ...cors(env, origin) },
	});
  
  export default {
	async fetch(req: Request, env: Env): Promise<Response> {
	  const url = new URL(req.url);
	  const origin = req.headers.get("origin");
  
	  // CORS preflight
	  if (req.method === "OPTIONS") {
		return new Response(null, { headers: cors(env, origin) });
	  }
  
	  // Simple health check
	  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
		return json(env, origin, { ok: true, service: "sofapaint-api", time: new Date().toISOString() });
	  }
  
	  // Temporary gate (replace with JWT/HMAC later)
	  if (req.headers.get("x-api-key") !== "dev-secret") {
		return json(env, origin, { error: "unauthorized" }, 401);
	  }
  
	  // 1) Issue a Direct Creator Upload URL for Cloudflare Images
	  if (req.method === "POST" && url.pathname === "/images/direct-upload") {
		const endpoint = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/images/v2/direct_upload`;
		const r = await fetch(endpoint, {
		  method: "POST",
		  headers: { Authorization: `Bearer ${env.IMAGES_API_TOKEN}` },
		  body: new FormData(), // optionally append metadata / requireSignedURLs here
		});
		const data = await r.json();
		return json(env, origin, data, r.ok ? 200 : 400);
	  }
  
	  // 2) Background removal via Images binding (segment=foreground)
	  // Body: { imageId: string, return?: "url" | "bytes" }
	  if (req.method === "POST" && url.pathname === "/remove-background") {
		try {
		  const { imageId, return: ret = "url" } = await req.json() as { imageId?: string; return?: "url" | "bytes" };
		  if (!imageId) return json(env, origin, { error: "missing_imageId" }, 400);
  
		  // Fetch original from Images delivery (public variant)
		  const sourceUrl = `https://imagedelivery.net/${env.ACCOUNT_HASH}/${imageId}/public`;
		  const src = await fetch(sourceUrl);
		  if (!src.ok || !src.body) {
			return json(env, origin, { error: "fetch_source_failed", status: src.status }, 502);
		  }
  
		  // Transform with background removal -> transparent PNG
		  const transformed = await env.IMAGES
			.input(src.body)
			.transform({ segment: "foreground" })   // ONLY transform options here
			.output({ format: "image/png" });       // MIME type here (not "png")
  
		  // Return PNG bytes directly?
		  if (ret === "bytes") {
			const resp = await transformed.response(); // Response with image/png
			const headers = cors(env, origin);
			resp.headers.set("access-control-allow-origin", headers["access-control-allow-origin"]);
			resp.headers.set("access-control-allow-headers", headers["access-control-allow-headers"]);
			resp.headers.set("access-control-allow-methods", headers["access-control-allow-methods"]);
			return resp;
		  }
  
		  // Re-upload the cutout to Images to get a permanent URL
		  const cutoutResp = await transformed.response();
		  const ab = await cutoutResp.arrayBuffer();
		  const blob = new Blob([ab], { type: "image/png" });
  
		  const form = new FormData();
		  form.append("file", blob, `${imageId}-cutout.png`);
  
		  const up = await fetch(
			`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/images/v1`,
			{ method: "POST", headers: { Authorization: `Bearer ${env.IMAGES_API_TOKEN}` }, body: form }
		  );
  
		  const upJson = await up.json<any>();
		  if (!up.ok || upJson?.success === false) {
			return json(env, origin, { error: "reupload_failed", status: up.status, details: upJson }, 502);
		  }
  
		  const newId = upJson.result?.id;
		  const cutoutUrl = `https://imagedelivery.net/${env.ACCOUNT_HASH}/${newId}/public`;
		  return json(env, origin, { id: newId, cutoutUrl, processed: true, success: true });
		} catch (e: any) {
		  return json(env, origin, { error: "exception", message: e?.message || String(e) }, 500);
		}
	  }
  
	  return json(env, origin, { error: "not_found" }, 404);
	},
  } satisfies ExportedHandler<Env>;
  