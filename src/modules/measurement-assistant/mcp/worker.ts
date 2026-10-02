import { getGuideCoverage } from './guide-roles';
// Generated Worker bindings are ambient declarations, not a runtime module.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../../../../mcp/worker-env.d.ts" />
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  DraftService,
  hashCapability,
  type DraftStorage,
  type MeasurementDraft,
} from './project-service';
import { GuideService, type AvailableGuide } from './guide-service';
import { createMeasurementMcpServer, type McpServices } from './server';
import { downloadInputImage, validateImageUrl, readBoundedBody } from './image-input';
import { escapeXml, renderPlacementSvg } from '../svg-preview';
import { bytesToBase64, cropSvg, renderSvgPng } from './raster-preview';
import { exportNativeMeasurementPdf } from '../native-pdf-export';
import { DurableObject } from 'cloudflare:workers';
import { consumeDailyBudget } from './usage-budget';
import {
  fetchMaskEvidence,
  normalizeMaskInput,
  renderMaskOverlay,
  type MaskEvidence,
} from './mask-service';

/** Each daily resource budget has its own strongly consistent counter. */
export class UsageBudget extends DurableObject {
  async consume(amount: number, limit: number): Promise<boolean> {
    return consumeDailyBudget(this.ctx.storage, amount, limit);
  }
  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}
async function claimBudget(env: RuntimeEnv, resource: string, amount: number, limit: number) {
  const counter = env.USAGE_BUDGET.getByName(
    `${resource}:${new Date().toISOString().slice(0, 10)}`
  );
  if (!(await counter.consume(amount, limit)))
    throw new Error('SofaPaint daily capacity reached. Please try again tomorrow.');
}

type RuntimeEnv = Omit<SofaPaintMcpEnv, 'LOCAL_DEVELOPMENT'> & {
  MCP_ACCESS_TOKEN?: string;
  OPENAI_DOMAIN_CHALLENGE?: string;
  LOCAL_DEVELOPMENT: string;
  SOFA_MASK_SERVICE_URL?: string;
  SOFA_MASK_API_TOKEN?: string;
  SOFA_MASK_MODEL_SHA256?: string;
};
const objectKey = (id: string) => `drafts/${id}/project.json`;
function createServices(env: RuntimeEnv, origin: string): McpServices {
  const storage: DraftStorage = {
    async read(id) {
      const object = await env.DRAFTS.get(objectKey(id));
      return object ? { draft: await object.json<MeasurementDraft>(), version: object.etag } : null;
    },
    async write(draft, version) {
      if (!version) await claimBudget(env, 'projects', 1, 500);
      const object = await env.DRAFTS.put(objectKey(draft.id), JSON.stringify(draft), {
        onlyIf: version ? { etagMatches: version } : { etagDoesNotMatch: '*' },
        httpMetadata: { contentType: 'application/json' },
        customMetadata: { expiresAt: String(draft.expiresAt) },
      });
      return object !== null;
    },
  };
  const drafts = new DraftService(storage);
  const guides = new GuideService({
    async localCatalogue() {
      const response = await env.GUIDES.fetch(new Request('https://guides.local/catalogue.json'));
      if (!response.ok) throw new Error('Guide catalogue is unavailable.');
      return response.json<AvailableGuide[]>();
    },
    async localSvg(path) {
      const response = await env.GUIDES.fetch(new Request(`https://guides.local${path}`));
      if (!response.ok) throw new Error('Guide is unavailable.');
      return new TextDecoder().decode(await readBoundedBody(response.body, 2 * 1024 * 1024));
    },
    async remoteKeys() {
      const listing = await env.MEASUREMENT_GUIDES.list({
        prefix: 'measurement-guides/',
        limit: 1000,
      });
      return listing.objects.map(object => object.key);
    },
    async remoteSvg(key) {
      const object = await env.MEASUREMENT_GUIDES.get(key);
      if (!object || object.size > 2 * 1024 * 1024) return null;
      return object.text();
    },
  });
  const previewUrl = (id: string, imageId: string, token: string) =>
    `${origin}/projects/${id}/preview/${imageId}.svg?key=${token}`;
  return {
    drafts,
    guides,
    previewUrl,
    async segmentImage(id, token, imageId) {
      const { draft } = await drafts.read(id, token);
      const image = draft.images.find(item => item.id === imageId);
      if (!image) throw new Error('Unknown project photo.');
      if (image.width * image.height > 12000000)
        throw new Error('Mask review supports photos up to 12 megapixels.');
      if (!env.SOFA_MASK_SERVICE_URL || !env.SOFA_MASK_API_TOKEN || !env.SOFA_MASK_MODEL_SHA256)
        throw new Error('The masking service is not configured for this deployment.');
      const key = `drafts/${id}/masks/${imageId}-${env.SOFA_MASK_MODEL_SHA256}`;
      const [cached, photo] = await Promise.all([
        env.DRAFTS.get(`${key}.json`),
        env.DRAFTS.get(image.storageKey),
      ]);
      if (!photo) throw new Error('Original photo unavailable.');
      const bytes = new Uint8Array(await photo.arrayBuffer());
      let evidence: MaskEvidence;
      if (cached) evidence = await cached.json<MaskEvidence>();
      else {
        await claimBudget(env, 'mask-inferences', 1, 500);
        evidence = await fetchMaskEvidence(bytes, image, {
          url: env.SOFA_MASK_SERVICE_URL,
          token: env.SOFA_MASK_API_TOKEN,
          modelSha256: env.SOFA_MASK_MODEL_SHA256,
          local: env.LOCAL_DEVELOPMENT === 'true',
        });
        await env.DRAFTS.put(`${key}.json`, JSON.stringify(evidence), {
          httpMetadata: { contentType: 'application/json' },
          customMetadata: { expiresAt: String(draft.expiresAt) },
        });
      }
      const raster = await env.DRAFTS.get(`${key}.png`);
      if (raster)
        return { evidence, preview: bytesToBase64(new Uint8Array(await raster.arrayBuffer())) };
      await claimBudget(env, 'renders', 1, 3000);
      const font = await env.GUIDES.fetch(new Request('https://guides.local/preview-font.ttf'));
      if (!font.ok) throw new Error('Preview font unavailable.');
      const url = `data:${image.mimeType};base64,${bytesToBase64(bytes)}`;
      const rendered = await renderSvgPng(
        renderMaskOverlay(evidence, url),
        new Uint8Array(await font.arrayBuffer()),
        Math.min(800, image.width)
      );
      await env.DRAFTS.put(`${key}.png`, rendered, {
        httpMetadata: { contentType: 'image/png' },
        customMetadata: { expiresAt: String(draft.expiresAt) },
      });
      return { evidence, preview: bytesToBase64(rendered) };
    },
    async confirmReview(id, token, revision, report) {
      const { draft } = await drafts.read(id, token);
      if (draft.revision !== revision) throw new Error('Drawing changed during review.');
      for (const image of draft.images) {
        for (const suffix of ['', '-detail']) {
          const object = await env.DRAFTS.get(`drafts/${id}/reviews/${image.id}${suffix}.json`);
          const stamp = object ? await object.json<{ revision: number }>() : null;
          if (stamp?.revision !== revision)
            throw new Error(
              `Review the full overlay and an annotated close-up for ${image.id} at the current revision before confirming.`
            );
        }
      }
      await env.DRAFTS.put(
        `drafts/${id}/reviews/confirmed.json`,
        JSON.stringify({ revision, report }),
        { customMetadata: { expiresAt: String(draft.expiresAt) } }
      );
    },
    async assertGrounded(id, token, imageId) {
      const { draft } = await drafts.read(id, token);
      if (!draft.images.some(image => image.id === imageId))
        throw new Error('Unknown project photo.');
      const detail = await env.DRAFTS.head(`drafts/${id}/reviews/${imageId}-original-detail.json`);
      if (!detail)
        throw new Error(
          `Inspect the original photo ${imageId} with review_measurement_drawing, includeDrawing=false and a close-up region of area <= 0.5 before planning its landmarks.`
        );
    },
    async assertReviewed(id, token, imageId) {
      const { draft } = await drafts.read(id, token);
      const confirmed = await env.DRAFTS.get(`drafts/${id}/reviews/confirmed.json`);
      const confirmation = confirmed ? await confirmed.json<{ revision: number }>() : null;
      if (confirmation?.revision !== draft.revision)
        throw new Error(
          'Run check_measurement_drawing, inspect close-ups and call confirm_measurement_review for every current line before exporting.'
        );
      const review = await env.DRAFTS.get(`drafts/${id}/reviews/${imageId}.json`);
      const stamp = review ? await review.json<{ revision: number }>() : null;
      if (!stamp || stamp.revision !== draft.revision)
        throw new Error(
          'Inspect this image with review_measurement_drawing at the current revision before exporting.'
        );
    },
    async exportPdf(id, token, options) {
      const { draft } = await drafts.read(id, token);
      if (!draft.placement) throw new Error('Draw and review the project before exporting a PDF.');
      for (const image of draft.images) await this.assertReviewed(id, token, image.id);
      if (draft.placement.measurements.length > 250)
        throw new Error('PDF export supports at most 250 measurement lines.');
      const fingerprint = (
        await hashCapability(JSON.stringify({ ...options, renderer: 'sofapaint-native-tags-v3' }))
      ).slice(0, 16);
      const filename = `sofapaint-${options.fillable ? 'fillable' : 'printable'}-${draft.revision}-${fingerprint}.pdf`;
      const storageKey = `drafts/${id}/exports/${filename}`;
      if (!(await env.DRAFTS.head(storageKey))) {
        await claimBudget(env, 'pdfs', 1, 500);
        const bytes = await exportNativeMeasurementPdf(
          draft.placement,
          draft.images,
          async image => {
            const rendered = await env.DRAFTS.get(
              `drafts/${id}/reviews/${image.id}-${draft.revision}-tags-v2.png`
            );
            if (!rendered) throw new Error('Review each full photo again before PDF export.');
            return new Uint8Array(await rendered.arrayBuffer());
          },
          options,
          new URL('/api/pdf/render', env.EDITOR_URL).href
        );
        // Rendering must not publish a stale revision if the user corrected a line concurrently.
        if ((await drafts.read(id, token)).draft.revision !== draft.revision)
          throw new Error(
            'Draft changed while rendering; review the updated drawing and export again.'
          );
        await env.DRAFTS.put(storageKey, bytes, {
          httpMetadata: { contentType: 'application/pdf' },
          customMetadata: { expiresAt: String(draft.expiresAt) },
        });
      }
      return {
        url: `${origin}/projects/${id}/exports/${filename}?key=${token}`,
        filename,
        fillable: options.fillable,
        revision: draft.revision,
      };
    },
    async renderGuide(svg, width = 900) {
      await claimBudget(env, 'renders', 1, 3000);
      const font = await env.GUIDES.fetch(new Request('https://guides.local/preview-font.ttf'));
      if (!font.ok) throw new Error('Preview font unavailable.');
      return bytesToBase64(
        await renderSvgPng(svg, new Uint8Array(await font.arrayBuffer()), width)
      );
    },
    async reviewImage(id, token, imageId, region, includeDrawing = true) {
      const { draft } = await drafts.read(id, token);
      const image = draft.images.find(item => item.id === imageId);
      if (!image || (includeDrawing && !draft.placement)) throw new Error('Drawing unavailable.');
      if (image.width * image.height > 12000000)
        throw new Error('Visual review supports photos up to 12 megapixels.');
      // Repeated full-photo reviews reuse the immutable revision render rather
      // than allocating another decoded photo and WASM raster in a warm Worker.
      if (!region && includeDrawing) {
        const cached = await env.DRAFTS.get(
          `drafts/${id}/reviews/${imageId}-${draft.revision}-tags-v2.png`
        );
        if (cached) {
          await env.DRAFTS.put(
            `drafts/${id}/reviews/${imageId}.json`,
            JSON.stringify({ revision: draft.revision }),
            { customMetadata: { expiresAt: String(draft.expiresAt) } }
          );
          return bytesToBase64(new Uint8Array(await cached.arrayBuffer()));
        }
      }
      const object = await env.DRAFTS.get(image.storageKey);
      if (!object) throw new Error('Image unavailable.');
      const photoUrl = `data:${image.mimeType};base64,${bytesToBase64(new Uint8Array(await object.arrayBuffer()))}`;
      const svg = includeDrawing
        ? renderPlacementSvg(draft.placement, image.id, { ...image, url: photoUrl })
        : `<svg xmlns="http://www.w3.org/2000/svg" width="${image.width}" height="${image.height}" viewBox="0 0 ${image.width} ${image.height}"><image href="${escapeXml(photoUrl)}" width="${image.width}" height="${image.height}"/></svg>`;
      // Never enlarge the embedded full photo to render a tiny crop: that makes
      // the underlying JPEG bitmap several times larger and can exhaust Workers memory.
      await claimBudget(env, 'renders', 1, 3000);
      const font = await env.GUIDES.fetch(new Request('https://guides.local/preview-font.ttf'));
      if (!font.ok) throw new Error('Preview font unavailable.');
      const result = await renderSvgPng(
        region ? cropSvg(svg, region) : svg,
        new Uint8Array(await font.arrayBuffer()),
        Math.min(800, image.width * (region?.width || 1))
      );
      // A crop alone cannot stand in for reviewing the complete photo.
      if (!region && includeDrawing) {
        await env.DRAFTS.put(
          `drafts/${id}/reviews/${imageId}-${draft.revision}-tags-v2.png`,
          result,
          {
            httpMetadata: { contentType: 'image/png' },
            customMetadata: { expiresAt: String(draft.expiresAt) },
          }
        );
        await env.DRAFTS.put(
          `drafts/${id}/reviews/${imageId}.json`,
          JSON.stringify({ revision: draft.revision }),
          {
            customMetadata: { expiresAt: String(draft.expiresAt) },
          }
        );
      }
      if (region && includeDrawing && region.width * region.height <= 0.5) {
        await env.DRAFTS.put(
          `drafts/${id}/reviews/${imageId}-detail.json`,
          JSON.stringify({ revision: draft.revision, region }),
          { customMetadata: { expiresAt: String(draft.expiresAt) } }
        );
      }
      if (region && !includeDrawing && region.width * region.height <= 0.5) {
        await env.DRAFTS.put(
          `drafts/${id}/reviews/${imageId}-original-detail.json`,
          JSON.stringify({ region }),
          { customMetadata: { expiresAt: String(draft.expiresAt) } }
        );
      }
      return bytesToBase64(result);
    },
    async addImage(id, token, fileUrl, view, revision) {
      const existing = await drafts.read(id, token);
      if (existing.draft.revision !== revision || existing.draft.images.length >= 10)
        throw new Error('Draft changed or image limit reached.');
      const url = validateImageUrl(
        fileUrl,
        env.ALLOWED_IMAGE_HOSTS.split(',')
          .map(host => host.trim())
          .filter(Boolean),
        env.LOCAL_DEVELOPMENT === 'true'
      );
      let input = await downloadInputImage(url);
      if (env.SOFA_MASK_SERVICE_URL && env.SOFA_MASK_API_TOKEN && env.SOFA_MASK_MODEL_SHA256) {
        input = await normalizeMaskInput(input.bytes, {
          url: env.SOFA_MASK_SERVICE_URL,
          token: env.SOFA_MASK_API_TOKEN,
          modelSha256: env.SOFA_MASK_MODEL_SHA256,
          local: env.LOCAL_DEVELOPMENT === 'true',
        });
      }
      await claimBudget(env, 'upload-bytes', input.bytes.byteLength, 1024 * 1024 * 1024);
      const imageId = crypto.randomUUID();
      const storageKey = `drafts/${id}/images/${imageId}`;
      await env.DRAFTS.put(storageKey, input.bytes, {
        httpMetadata: { contentType: input.mimeType },
        customMetadata: { expiresAt: String(existing.draft.expiresAt) },
      });
      try {
        return await drafts.addImage(
          id,
          token,
          {
            id: imageId,
            view,
            width: input.width,
            height: input.height,
            mimeType: input.mimeType,
            storageKey,
          },
          revision
        );
      } catch (error) {
        await env.DRAFTS.delete(storageKey);
        throw error;
      }
    },
    describe(draft, token) {
      const editor = new URL(env.EDITOR_URL);
      editor.hash = new URLSearchParams({
        measurementDraft: `${origin}/projects/${draft.id}`,
        key: token,
      }).toString();
      return {
        projectId: draft.id,
        revision: draft.revision,
        expiresAt: new Date(draft.expiresAt).toISOString(),
        editorUrl: editor.href,
        images: draft.images.map(image => ({
          id: image.id,
          view: image.view,
          width: image.width,
          height: image.height,
          mimeType: image.mimeType,
          src: `${origin}/projects/${draft.id}/images/${image.id}?key=${token}`,
          previewUrl: draft.placement ? previewUrl(draft.id, image.id, token) : null,
        })),
        placement: draft.placement,
        landmarkPlan: draft.landmarkPlan,
        reliabilityVersion: draft.reliabilityVersion,
        guideCoverage: draft.placement ? getGuideCoverage(draft.placement) : [],
        unresolvedSurfaces:
          draft.placement?.surfaces.filter(surface => surface.status !== 'covered') || [],
      };
    },
  };
}
function privateHeaders(origin: string | null, env: RuntimeEnv): Headers {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin',
  });
  if (
    origin &&
    env.ALLOWED_ORIGINS.split(',')
      .map(value => value.trim())
      .includes(origin)
  ) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Authorization,Content-Type,MCP-Protocol-Version');
  }
  return headers;
}
async function serveProject(
  request: Request,
  env: RuntimeEnv,
  services: McpServices,
  path: RegExpMatchArray
): Promise<Response> {
  const url = new URL(request.url);
  const token =
    request.headers.get('Authorization')?.replace(/^Bearer /, '') ||
    url.searchParams.get('key') ||
    '';
  const { draft } = await services.drafts.read(path[1], token);
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  if (!path[2]) return Response.json(services.describe(draft, token));
  if (path[2] === 'exports') {
    const pdf = await env.DRAFTS.get(`drafts/${draft.id}/exports/${path[3]}`);
    if (!pdf) return new Response('PDF unavailable', { status: 404 });
    return new Response(pdf.body, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${path[3]}"`,
      },
    });
  }
  const image = draft.images.find(item => item.id === path[3]);
  if (!image) return new Response('Image unavailable', { status: 404 });
  const object = await env.DRAFTS.get(image.storageKey);
  if (!object) return new Response('Image unavailable', { status: 404 });
  if (path[2] === 'images')
    return new Response(object.body, { headers: { 'Content-Type': image.mimeType } });
  if (!draft.placement) return new Response('Drawing unavailable', { status: 404 });
  const download = url.searchParams.has('download');
  const imageUrl = `data:${image.mimeType};base64,${arrayBufferToBase64(await object.arrayBuffer())}`;
  return new Response(renderPlacementSvg(draft.placement, image.id, { ...image, url: imageUrl }), {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Content-Security-Policy':
        "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
      ...(download
        ? { 'Content-Disposition': 'attachment; filename="sofapaint-measurements.svg"' }
        : {}),
    },
  });
}
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return bytesToBase64(new Uint8Array(buffer));
}
export default {
  async fetch(request: Request, env: RuntimeEnv): Promise<Response> {
    const url = new URL(request.url);
    const headers = privateHeaders(request.headers.get('Origin'), env);
    let response: Response;
    try {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
      if (url.pathname === '/.well-known/openai-apps-challenge' && request.method === 'GET')
        return new Response(env.OPENAI_DOMAIN_CHALLENGE || 'Not configured', {
          status: env.OPENAI_DOMAIN_CHALLENGE ? 200 : 404,
          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
        });
      if (url.pathname === '/health')
        return Response.json({ ok: true, service: 'sofapaint-mcp' }, { headers });
      if (
        !(
          await env.REQUEST_LIMIT.limit({ key: request.headers.get('CF-Connecting-IP') || 'local' })
        ).success
      )
        return new Response('Request limit reached', { status: 429, headers });
      await claimBudget(env, 'requests', 1, 20000);
      const origin = request.headers.get('Origin');
      if (
        origin &&
        !env.ALLOWED_ORIGINS.split(',')
          .map(value => value.trim())
          .includes(origin)
      )
        return new Response('Origin not permitted', { status: 403, headers });
      const services = createServices(env, url.origin);
      const projectPath =
        /^\/projects\/([a-f0-9-]{36})(?:\/(?:(images|preview)\/([a-f0-9-]{36})(?:\.svg)?|(exports)\/(sofapaint-(?:fillable|printable)-\d+-[a-f0-9]{16}\.pdf)))?$/.exec(
          url.pathname
        );
      if (projectPath) {
        if (projectPath[4]) {
          projectPath[2] = projectPath[4];
          projectPath[3] = projectPath[5];
        }
        response = await serveProject(request, env, services, projectPath);
      } else if (
        url.pathname === '/public/mcp' ||
        url.pathname === '/mcp' ||
        url.pathname.startsWith('/mcp/')
      ) {
        const publicAccess = url.pathname === '/public/mcp' && env.PUBLIC_MCP_ENABLED === 'true';
        if (!publicAccess && !env.MCP_ACCESS_TOKEN)
          return new Response('MCP access is not configured', { status: 503, headers });
        const supplied =
          request.headers.get('Authorization')?.replace(/^Bearer /, '') ||
          url.pathname.slice('/mcp/'.length);
        if (
          !publicAccess &&
          (await hashCapability(supplied)) !== (await hashCapability(env.MCP_ACCESS_TOKEN!))
        )
          return new Response('Unauthorized', { status: 401, headers });
        const server = createMeasurementMcpServer(services);
        const transport = new WebStandardStreamableHTTPServerTransport({
          enableJsonResponse: true,
        });
        await server.connect(transport);
        try {
          const body =
            request.method === 'POST'
              ? new TextDecoder().decode(await readBoundedBody(request.body, 1024 * 1024))
              : undefined;
          response = await transport.handleRequest(
            new Request(`${url.origin}/mcp`, {
              method: request.method,
              headers: request.headers,
              ...(body !== undefined ? { body } : {}),
            })
          );
        } finally {
          await server.close();
        }
      } else response = new Response('Not found', { status: 404 });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Measurement request failed.';
      response = Response.json(
        { error: message },
        {
          status: message.includes('daily capacity')
            ? 429
            : message.includes('access expired')
              ? 404
              : 400,
        }
      );
    }
    const result = new Response(response.body, response);
    headers.forEach((value, name) => result.headers.set(name, value));
    return result;
  },
  async scheduled(_event: ScheduledController, env: RuntimeEnv): Promise<void> {
    // Persist the scan cursor so active drafts cannot starve expired entries later in the bucket.
    const saved = await env.DRAFTS.get('maintenance/cleanup-cursor');
    let cursor = saved ? await saved.text() : undefined;
    for (let page = 0; page < 5; page++) {
      const listing = await env.DRAFTS.list({
        prefix: 'drafts/',
        include: ['customMetadata'],
        limit: 1000,
        ...(cursor ? { cursor } : {}),
      });
      const expired = listing.objects
        .filter(object => Number(object.customMetadata?.expiresAt) <= Date.now())
        .map(object => object.key);
      if (expired.length) await env.DRAFTS.delete(expired);
      cursor = listing.truncated ? listing.cursor : undefined;
      if (!cursor) break;
    }
    if (cursor) await env.DRAFTS.put('maintenance/cleanup-cursor', cursor);
    else await env.DRAFTS.delete('maintenance/cleanup-cursor');
  },
} satisfies ExportedHandler<RuntimeEnv>;
