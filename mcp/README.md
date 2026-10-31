# SofaPaint MCP connection

This is a private test connection. ChatGPT supplies photo observations and feature coordinates using its own vision; the Worker validates the seam graph, stores the original photos in R2, and renders editable measurement drawings. No separate paid vision API is called.

## Local check

1. Set `MCP_ACCESS_TOKEN` to a random 64-character hex secret in ignored `mcp/.dev.vars`. Set `LOCAL_DEVELOPMENT=true` there only for local testing.
2. Run `npm run mcp:dev` and the normal editor (`npm run dev`).
3. Run `node scripts/smoke-measurement-mcp.ts` against the running Worker. This checks the real HTTP MCP transport, local R2 photo storage, drawing placement and embedded-photo SVG preview.
4. MCP clients use `http://127.0.0.1:8789/mcp` with `Authorization: Bearer <secret>`. ChatGPT's hosted connector needs a reachable HTTPS deployment.

## Deploy and connect privately

1. Sign into Cloudflare with `npx wrangler login`.
2. Create the `sofapaint-mcp-drafts` R2 bucket. The existing `openpaint-measurement-guides` bucket supplies full furniture guides; local SVG components are bundled separately.
3. Set the public editor URL and allowed editor origins in `mcp/wrangler.jsonc`; keep `LOCAL_DEVELOPMENT=false`. Set `VITE_MEASUREMENT_MCP_ORIGIN` to the Worker HTTPS origin when building the editor. The deployed editor must include this handoff code.
4. Run `npx wrangler secret put MCP_ACCESS_TOKEN --config mcp/wrangler.jsonc`, then `npm run mcp:deploy`.
5. Open ChatGPT Settings → Security and login and enable Developer mode where your account supports it; then open ChatGPT Plugins and use the plus button to add the deployed HTTPS MCP endpoint. The observed Free account does not expose these controls; account/workspace availability must be checked before connecting. For the private test, a connector without bearer-header configuration can use `https://<worker>/mcp/<secret>`. Treat this complete URL as a password; do not publish it or include it in screenshots.
6. Upload front, back and side photos and ask ChatGPT to identify the furniture category, retrieve the closest guide, and place connected seam-to-seam measurements on the original photos. Open the returned editor link to adjust or save the drawing.

## Tools

- `start_measurement_project`: accept the ChatGPT photo handoff and classify observed construction.
- `add_project_image`: attach another angle to the same draft.
- `get_measurement_project`: read current revision, images and placements.
- `find_measurement_guides` / `get_measurement_guide`: retrieve existing guide SVGs.
- `generate_measurement_drawing`: validate and render shared feature endpoints and surface paths.
- `update_measurement`: correct existing features or paths using optimistic revisions.
- `review_measurement_drawing`: inspect the original photo or actual drawing as a PNG, including endpoint close-ups.
- `export_measurement_drawing`: download an SVG containing the original photo and annotations after current-revision visual review.

Drafts expire after 24 hours. Each supports at most 10 photos, 20 MB per photo and 80 million pixels. HTTP requests are limited to 60 per minute per IP. Hourly cleanup scans and removes expired R2 objects. These controls bound individual requests; public release still needs account quotas, aggregate storage limits, authentication/OAuth and budget monitoring.

Invisible surfaces and uncertain endpoints must be reported, never invented. This integration does not determine real-world dimension values. Exporting or saving in the editor creates the user's durable copy; the draft is temporary.

## Current limits

The personal MCP endpoint is deployed at `https://sofapaint-mcp.sofapaint-api.workers.dev/mcp` (bearer authentication required) and connected to a personal ChatGPT account; public app-directory submission, OAuth, and complete Vercel-to-Cloudflare migration remain separate work. Live photo handoff, guide PNGs and three-view review PNGs are verified. Drawing quality still depends on the assistant grounding and correcting its coordinates; the server does not detect upholstery seams automatically. Manual line edits save their current geometry; they do not send corrections back to the temporary MCP draft or automatically move other lines sharing an endpoint.

ChatGPT attachments can use its regional Azure download host `oaisdmntprseasia.blob.core.windows.net`, which is explicitly included in `ALLOWED_IMAGE_HOSTS` alongside OpenAI content hosts. Do not allow all of `blob.core.windows.net`: unrelated Azure storage accounts must remain rejected. Rejection messages include only the hostname, never the signed URL.

## Placement quality and visual review

Guide reads now include an actual rendered PNG in MCP image content, not only SVG text. The CS3B-SLA-HB2 and CS3B-RA-HB families include reviewed per-view role definitions; guide spans cannot silently become arm contours, and front/side/back roles cannot be exchanged. Other families still require interpretation from their rendered diagrams.

After generating or correcting a drawing, call `review_measurement_drawing` for each complete photo, then request normalized close-up regions for difficult endpoints. The PNG retains the original photo coordinate system. Crops return their normalized region so coordinates can be mapped back correctly. Each export requires a full-photo review at the current project revision; crop-only reviews do not satisfy it. A revision change invalidates earlier reviews.

The renderer runs locally in Workers using resvg WebAssembly and an OFL-licensed Roboto font; it makes no extra vision-provider API calls. Preview images are at most 1200px wide and limited in aspect ratio. Close-up output width is capped at the native cropped photo width so small crops never upscale the entire embedded photo in WebAssembly memory. Photo review supports source photos up to 12 megapixels to bound decoding memory. This is a review workflow, not automatic proof of seam accuracy: the assistant must inspect and correct its output. Schema checks cannot detect a guessed point on carpet.

For rolled arms, G1 follows the arm top, G2 follows the boundary beneath the curve, and H1/H2 share G2 endpoints and end at the hem. Back widths L1/L2/L3/L4 distinguish upper arm joins, widest rolled arms, lower arm joins and hem. User-supplied diagrams and boundary corrections take precedence over an approximate category match; preserve explicitly approved lines.
