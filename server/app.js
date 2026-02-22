import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { registerR2Routes } from './r2-routes.js';
import { createClient } from '@supabase/supabase-js';
import { isR2Configured, createPresignedUploadUrl, getR2PublicUrl } from './r2-storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// MOS / Gemini env vars
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || '').trim();
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

// Measurement-guide Worker (Cloudflare R2 proxy)
const WORKER_BASE_URL = (
  process.env.MEASUREMENT_GUIDE_WORKER_URL ||
  process.env.CF_WORKER_URL ||
  process.env.AI_WORKER_URL ||
  ''
)
  .trim()
  .replace(/\/+$/, '');
const WORKER_API_KEY = (
  process.env.MEASUREMENT_GUIDE_WORKER_API_KEY ||
  process.env.AI_WORKER_KEY ||
  ''
).trim();

const app = express();

function parseSetCookie(setCookieHeaders = []) {
  const jar = {};
  setCookieHeaders.forEach(value => {
    if (!value || typeof value !== 'string') return;
    const firstPart = value.split(';')[0] || '';
    const eqIdx = firstPart.indexOf('=');
    if (eqIdx <= 0) return;
    const name = firstPart.slice(0, eqIdx).trim();
    const cookieValue = firstPart.slice(eqIdx + 1).trim();
    if (!name) return;
    jar[name] = cookieValue;
  });
  return jar;
}

function mergeCookieJar(target, incoming) {
  Object.entries(incoming || {}).forEach(([key, value]) => {
    target[key] = value;
  });
  return target;
}

function buildCookieHeader(jar) {
  return Object.entries(jar || {})
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

function getSetCookieArray(headers) {
  if (!headers) return [];
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const single = headers.get?.('set-cookie');
  return single ? [single] : [];
}

function normalizeCwCredentials(override = {}) {
  const baseUrl = (
    override.baseUrl ||
    process.env.CW_BASE_URL ||
    'https://cw40.comfort-works.com'
  ).trim();
  const username = (override.username || process.env.CW_USERNAME || '').trim();
  const password = (override.password || process.env.CW_PASSWORD || '').trim();
  return { baseUrl, username, password };
}

async function createCwSession(credentialsOverride = {}) {
  const creds = normalizeCwCredentials(credentialsOverride);
  if (!creds.username || !creds.password) {
    const err = new Error('Missing CW credentials (username/password)');
    err.code = 'CW_MISSING_CREDENTIALS';
    throw err;
  }

  const cookieJar = {};
  const loginUrl = `${creds.baseUrl.replace(/\/+$/, '')}/dashboard/login/`;

  const loginPageRes = await fetch(loginUrl, {
    method: 'GET',
    redirect: 'manual',
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'user-agent': 'OpenPaint-CW-Serverless/1.0',
    },
  });

  mergeCookieJar(cookieJar, parseSetCookie(getSetCookieArray(loginPageRes.headers)));
  const csrfToken = cookieJar.csrftoken;
  if (!csrfToken) {
    const err = new Error('Failed to fetch CSRF token from CW login page');
    err.code = 'CW_CSRF_MISSING';
    throw err;
  }

  const form = new URLSearchParams();
  form.set('csrfmiddlewaretoken', csrfToken);
  form.set('username', creds.username);
  form.set('password', creds.password);
  form.set('next', '');

  const loginRes = await fetch(loginUrl, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'content-type': 'application/x-www-form-urlencoded',
      cookie: buildCookieHeader(cookieJar),
      origin: creds.baseUrl,
      referer: loginUrl,
      'user-agent': 'OpenPaint-CW-Serverless/1.0',
    },
    body: form.toString(),
  });

  mergeCookieJar(cookieJar, parseSetCookie(getSetCookieArray(loginRes.headers)));
  const loginStatus = loginRes.status;
  const loginLocation = loginRes.headers.get('location') || '';
  const isRedirect = loginStatus === 301 || loginStatus === 302;
  const hasSession = Boolean(cookieJar.sessionid);

  if (!isRedirect || !hasSession) {
    const bodySnippet = (await loginRes.text().catch(() => '')).slice(0, 500);
    const err = new Error('CW login failed');
    err.code = 'CW_LOGIN_FAILED';
    err.details = {
      status: loginStatus,
      location: loginLocation,
      hasSession,
      bodySnippet,
    };
    throw err;
  }

  return {
    baseUrl: creds.baseUrl,
    csrfToken: cookieJar.csrftoken || csrfToken,
    cookieJar,
    loginStatus,
    loginLocation,
  };
}

async function submitCwMeasureForm({ formId, payload = {}, credentialsOverride = {} }) {
  const session = await createCwSession(credentialsOverride);
  const targetUrl = `${session.baseUrl.replace(/\/+$/, '')}/order-management/measure-tool/measure-form/save-measure-form/${encodeURIComponent(formId)}/`;

  const body = {
    ...(payload && typeof payload === 'object' ? payload : {}),
    form_ID: String(payload?.form_ID || formId),
  };

  const upstreamRes = await fetch(targetUrl, {
    method: 'POST',
    headers: {
      accept: '*/*',
      'content-type': 'text/plain;charset=UTF-8',
      cookie: buildCookieHeader(session.cookieJar),
      origin: session.baseUrl,
      referer: `${session.baseUrl.replace(/\/+$/, '')}/dashboard/`,
      'x-csrftoken': session.csrfToken,
      'x-requested-with': 'XMLHttpRequest',
      'user-agent': 'OpenPaint-CW-Serverless/1.0',
    },
    body: JSON.stringify(body),
  });

  const rawText = await upstreamRes.text().catch(() => '');
  let parsed = null;
  try {
    parsed = rawText ? JSON.parse(rawText) : null;
  } catch {
    parsed = null;
  }

  return {
    ok: upstreamRes.ok,
    status: upstreamRes.status,
    body: parsed || rawText,
    session: {
      loginStatus: session.loginStatus,
      loginLocation: session.loginLocation,
      hasSessionId: Boolean(session.cookieJar.sessionid),
    },
  };
}

// Try to load security middleware (optional - graceful fallback)
let securityMiddleware;
try {
  securityMiddleware = await import('./security-middleware.js');
} catch (e) {
  console.log('[Security] Middleware not available, running without security hardening');
}

// Basic middleware
app.set('trust proxy', true);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
registerR2Routes(app, '/storage/r2');
registerR2Routes(app, '/api/storage/r2');

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

// Apply security middleware if available
if (securityMiddleware && securityMiddleware.applySecurityMiddleware) {
  securityMiddleware.applySecurityMiddleware(app);
}

// In-memory storage (use database in production)
const projects = new Map();
const sharedProjects = new Map();

// ============== API ROUTES ==============

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

async function handlePdfRender(req, res) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  res.setHeader('X-Pdf-Request-Id', requestId);
  try {
    const [
      { pdfRenderRequestSchema, sanitizePdfFilename },
      { renderPdfFromRequest, resolvePdfRendererMode },
    ] = await Promise.all([import('./pdf/schema.js'), import('./pdf/service.js')]);

    const parsed = pdfRenderRequestSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        code: 'PDF_RENDER_BAD_REQUEST',
        requestId,
        errors: parsed.error.issues,
      });
    }

    const payload = parsed.data;
    const mode = resolvePdfRendererMode(payload.options?.renderer);
    const pdfBuffer = await renderPdfFromRequest(payload, mode);

    const filename = sanitizePdfFilename(
      payload.options?.filename || payload.report?.projectName || 'openpaint-report.pdf'
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('X-Pdf-Renderer', mode);
    res.setHeader('X-Pdf-Duration-Ms', String(Date.now() - startedAt));
    console.log('[PDF] Render success', {
      requestId,
      mode,
      source: payload.source,
      pageSize: payload.options?.pageSize,
      durationMs: Date.now() - startedAt,
    });
    return res.status(200).send(pdfBuffer);
  } catch (error) {
    const code = error?.code || 'PDF_RENDER_FAILED';
    console.error('[PDF] Render failed:', {
      requestId,
      code,
      durationMs: Date.now() - startedAt,
      error,
    });
    if (code === 'PDF_RENDERER_UNSUPPORTED' || code === 'PDF_RENDERER_MISSING_DEPENDENCY') {
      return res
        .status(501)
        .json({ success: false, code, requestId, message: error.details || error.message });
    }
    return res.status(500).json({
      success: false,
      code,
      requestId,
      message: 'Failed to render PDF',
    });
  }
}

app.post('/pdf/render', handlePdfRender);
app.post('/api/pdf/render', handlePdfRender);

// Environment info
app.get('/env', (req, res) => {
  res.json({
    REMBG_ORIGIN: process.env.REMBG_ORIGIN ? 'configured' : 'missing',
    NODE_ENV: process.env.NODE_ENV || 'development',
    security: securityMiddleware ? 'enabled' : 'disabled',
  });
});

// Save project
app.post('/projects/save', (req, res) => {
  try {
    const { projectData, projectId } = req.body;
    if (!projectData) {
      return res.status(400).json({ success: false, message: 'Project data required' });
    }

    const id = projectId || crypto.randomBytes(8).toString('hex');
    const record = {
      id,
      data: projectData,
      savedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    projects.set(id, record);
    console.log(`[Projects] Saved project ${id}`);

    res.json({ success: true, projectId: id, savedAt: record.savedAt });
  } catch (error) {
    console.error('[Projects] Save error:', error);
    res.status(500).json({ success: false, message: 'Failed to save project' });
  }
});

// Load project
app.get('/projects/:projectId', (req, res) => {
  try {
    const { projectId } = req.params;
    const record = projects.get(projectId);

    if (!record) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    res.json({ success: true, project: record });
  } catch (error) {
    console.error('[Projects] Load error:', error);
    res.status(500).json({ success: false, message: 'Failed to load project' });
  }
});

// List projects
app.get('/projects', (req, res) => {
  try {
    const projectList = Array.from(projects.values()).map(p => ({
      id: p.id,
      savedAt: p.savedAt,
      updatedAt: p.updatedAt,
    }));
    res.json({ success: true, projects: projectList });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to list projects' });
  }
});

// Share project (create shareable link)
app.post('/projects/:projectId/share', (req, res) => {
  try {
    const { projectId } = req.params;
    const project = projects.get(projectId);

    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    const shareId = crypto.randomBytes(6).toString('hex');
    sharedProjects.set(shareId, {
      projectId,
      shareId,
      sharedAt: new Date().toISOString(),
      data: project.data,
    });

    res.json({
      success: true,
      shareId,
      shareUrl: `/share/${shareId}`,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to share project' });
  }
});

// Get shared project
app.get('/share/:shareId', (req, res) => {
  try {
    const { shareId } = req.params;
    const shared = sharedProjects.get(shareId);

    if (!shared) {
      return res.status(404).json({ success: false, message: 'Shared project not found' });
    }

    res.json({ success: true, project: shared });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to get shared project' });
  }
});

// Proxy to remove background service
app.post('/remove-background', async (req, res) => {
  return res.status(410).json({
    success: false,
    message: 'Background removal has been removed. Use the Privacy Erase tool instead.',
  });
});

// Direct upload proxy
app.post('/images/direct-upload', async (req, res) => {
  try {
    const origin = process.env.REMBG_ORIGIN || 'https://sofapaint-api.leigh-atkins.workers.dev';
    const response = await fetch(`${origin}/images/direct-upload`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'dev-secret' },
      body: JSON.stringify(req.body),
    });
    res.status(response.status).json(await response.json());
  } catch (error) {
    console.error('[Upload] Error:', error);
    res.status(500).json({ success: false, message: 'Upload failed' });
  }
});

// CW serverless preview integration: login + post measurement payload to existing form.
app.post('/integrations/cw/test-save/:formId', async (req, res) => {
  const startedAt = Date.now();
  const { formId } = req.params;

  try {
    if (!formId) {
      return res.status(400).json({
        success: false,
        code: 'CW_FORM_ID_REQUIRED',
        message: 'formId is required',
      });
    }

    const credentialsOverride = {
      baseUrl: req.body?.baseUrl,
      username: req.body?.username,
      password: req.body?.password,
    };

    const result = await submitCwMeasureForm({
      formId,
      payload: req.body?.payload || {},
      credentialsOverride,
    });

    return res.status(result.ok ? 200 : 502).json({
      success: result.ok,
      code: result.ok ? 'CW_SUBMIT_OK' : 'CW_SUBMIT_FAILED',
      formId: String(formId),
      durationMs: Date.now() - startedAt,
      upstreamStatus: result.status,
      session: result.session,
      upstreamBody: result.body,
    });
  } catch (error) {
    console.error('[CW Integration] serverless test-save failed:', {
      code: error?.code,
      message: error?.message,
      details: error?.details || null,
    });

    return res.status(500).json({
      success: false,
      code: error?.code || 'CW_INTEGRATION_ERROR',
      message: error?.message || 'CW integration failed',
      details: error?.details || null,
      formId: String(formId || ''),
      durationMs: Date.now() - startedAt,
    });
  }
});

app.get('/integrations/cw/health', (req, res) => {
  const baseUrl = (process.env.CW_BASE_URL || 'https://cw40.comfort-works.com').trim();
  res.json({
    ok: true,
    baseUrl,
    hasEnvUsername: Boolean((process.env.CW_USERNAME || '').trim()),
    hasEnvPassword: Boolean((process.env.CW_PASSWORD || '').trim()),
  });
});

// Legacy endpoints (without /api prefix) for backwards compatibility
app.post('/upload-project', (req, res) => {
  const { projectData } = req.body;
  if (!projectData)
    return res.status(400).json({ success: false, message: 'Project data required' });
  const id = crypto.randomBytes(8).toString('hex');
  projects.set(id, { id, data: projectData, savedAt: new Date().toISOString() });
  res.json({ success: true, projectId: id });
});

app.get('/env', (req, res) => {
  res.json({ NODE_ENV: process.env.NODE_ENV || 'development' });
});

// ---------------------------------------------------------------------------
// MOS v1 — Gemini-powered measurement overlay generation
// ---------------------------------------------------------------------------

function validateMosSvg(svgText) {
  const errors = [];

  if (!svgText || typeof svgText !== 'string') {
    errors.push('SVG text is empty or not a string');
    return errors;
  }

  if (!/<svg[\s>]/i.test(svgText)) {
    errors.push('No <svg> root element found');
    return errors;
  }

  const vbMatch = svgText.match(/viewBox="([^"]+)"/);
  if (!vbMatch) {
    errors.push('Missing viewBox attribute');
  } else {
    const parts = vbMatch[1]
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) {
      errors.push(`Invalid viewBox: "${vbMatch[1]}"`);
    } else if (parts[2] !== 1000 || parts[3] !== 1000) {
      errors.push(`viewBox width/height must be 1000 1000, got ${parts[2]} ${parts[3]}`);
    }
  }

  const coordAttrs = ['x1', 'y1', 'x2', 'y2', 'x', 'y', 'cx', 'cy'];
  for (const attr of coordAttrs) {
    const regex = new RegExp(`${attr}="([^"]+)"`, 'g');
    let match;
    while ((match = regex.exec(svgText)) !== null) {
      const val = parseFloat(match[1]);
      if (isNaN(val) || val < 0 || val > 1000) {
        errors.push(`${attr}="${match[1]}" is out of range [0, 1000]`);
      }
    }
  }

  const lineRegex = /<line[^>]+x1="([^"]+)"[^>]+y1="([^"]+)"[^>]+x2="([^"]+)"[^>]+y2="([^"]+)"/g;
  let lineMatch;
  while ((lineMatch = lineRegex.exec(svgText)) !== null) {
    const x1 = parseFloat(lineMatch[1]);
    const y1 = parseFloat(lineMatch[2]);
    const x2 = parseFloat(lineMatch[3]);
    const y2 = parseFloat(lineMatch[4]);
    if (Math.abs(x2 - x1) < 0.1 && Math.abs(y2 - y1) < 0.1) {
      errors.push(`Zero-length line at (${x1}, ${y1})`);
    }
  }

  if (/on\w+\s*=/i.test(svgText)) {
    errors.push('SVG contains event handler attributes');
  }
  if (/javascript\s*:/i.test(svgText)) {
    errors.push('SVG contains javascript: URI');
  }
  if (/<script/i.test(svgText)) {
    errors.push('SVG contains <script> element');
  }

  return errors;
}

async function handleMosGenerate(req, res) {
  try {
    if (!GEMINI_API_KEY) {
      return res.status(503).json({
        success: false,
        error: 'Gemini API key not configured. Set GEMINI_API_KEY env var.',
      });
    }

    const {
      projectId,
      viewId,
      imageR2Key,
      imageDataUrl,
      imageWidth,
      imageHeight,
      requestedRoles = ['W', 'H'],
      units = 'cm',
      thinkingLevel = 'low',
      templateId,
    } = req.body;

    // --- Fetch reference template SVG from Cloudflare Worker (if templateId provided) ---
    let referenceSvgText = null;
    if (templateId && WORKER_BASE_URL) {
      try {
        const guideView = viewId || 'front';
        const svgUrl = `${WORKER_BASE_URL}/measurement-guides/svg?code=${encodeURIComponent(templateId)}&view=${encodeURIComponent(guideView)}`;
        const svgRes = await fetch(svgUrl, {
          method: 'GET',
          headers: {
            'x-api-key': WORKER_API_KEY || 'dev-secret',
            accept: 'image/svg+xml,application/json',
          },
        });
        if (svgRes.ok) {
          referenceSvgText = await svgRes.text();
          console.log(
            `[MOS Generate] Fetched reference SVG for templateId="${templateId}", view="${guideView}" (${referenceSvgText.length} bytes)`
          );
        } else {
          console.warn(
            `[MOS Generate] Reference SVG fetch failed (${svgRes.status}) for templateId="${templateId}"`
          );
        }
      } catch (refErr) {
        console.warn('[MOS Generate] Failed to fetch reference SVG:', refErr.message);
      }
    }

    if (!imageR2Key && !imageDataUrl) {
      return res.status(400).json({
        success: false,
        error: 'Either imageR2Key or imageDataUrl is required.',
      });
    }

    if (!imageWidth || !imageHeight) {
      return res.status(400).json({
        success: false,
        error: 'imageWidth and imageHeight are required.',
      });
    }

    // --- Prepare image bytes for Gemini ---
    let imageBase64;
    let imageMimeType = 'image/jpeg';

    if (imageDataUrl) {
      const match = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) {
        return res.status(400).json({
          success: false,
          error: 'Invalid imageDataUrl format. Expected data:mime;base64,...',
        });
      }
      imageMimeType = match[1];
      imageBase64 = match[2];
    } else if (imageR2Key) {
      const publicUrl = getR2PublicUrl(imageR2Key);
      const imgResponse = await fetch(publicUrl);
      if (!imgResponse.ok) {
        return res.status(400).json({
          success: false,
          error: `Failed to fetch image from R2: ${imgResponse.status}`,
        });
      }
      const buffer = Buffer.from(await imgResponse.arrayBuffer());

      try {
        const sharp = (await import('sharp')).default;
        const MAX_EDGE = 1024;
        const longestEdge = Math.max(imageWidth, imageHeight);
        if (longestEdge > MAX_EDGE) {
          const resized = await sharp(buffer)
            .resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 85 })
            .toBuffer();
          imageBase64 = resized.toString('base64');
          imageMimeType = 'image/jpeg';
        } else {
          imageBase64 = buffer.toString('base64');
          if (buffer[0] === 0xff && buffer[1] === 0xd8) imageMimeType = 'image/jpeg';
          else if (buffer[0] === 0x89 && buffer[1] === 0x50) imageMimeType = 'image/png';
        }
      } catch {
        imageBase64 = buffer.toString('base64');
      }
    }

    // --- Build Gemini prompt ---
    const rolesStr = requestedRoles.join(', ');

    let systemPrompt;
    if (referenceSvgText) {
      // Template-guided prompt: use the reference SVG as structural template
      systemPrompt = `You are a measurement overlay generator for product images.
Your task is to analyse the provided image and generate an SVG measurement overlay
by adapting the REFERENCE TEMPLATE SVG below to match the product in the photo.

REFERENCE TEMPLATE SVG:
The following SVG is a reference template for this product type.
You MUST use the same element IDs, grouping structure, and line types.
Adapt the x1/y1/x2/y2 coordinates and text label positions to match where the product edges appear in the provided photo.

${referenceSvgText}

RULES:
1. The SVG MUST use viewBox="0 0 1000 1000" — coordinates are normalised to the image.
2. Keep ALL element IDs, group (<g>) structure, class names, and measurement roles from the template.
3. Only change coordinate attributes (x1, y1, x2, y2, x, y, cx, cy) and text positions to fit the product in the photo.
4. Generate measurement lines for these roles: ${rolesStr}
5. Units: ${units}
6. All coordinates MUST be in range [0, 1000]. No negative values. No values > 1000.
7. Lines MUST NOT be zero-length (x1,y1 must differ from x2,y2).
8. Place lines along the edges/dimensions of the main object in the image.

Return ONLY a JSON object with this exact structure:
{
  "svg": "<svg xmlns=\\"http://www.w3.org/2000/svg\\" viewBox=\\"0 0 1000 1000\\">...</svg>"
}`;
    } else {
      // Generic prompt (no template available)
      systemPrompt = `You are a measurement overlay generator for product images.
Your task is to analyse the provided image and generate an SVG measurement overlay.

RULES:
1. The SVG MUST use viewBox="0 0 1000 1000" — coordinates are normalised to the image.
2. Generate measurement lines for these roles: ${rolesStr}
3. Units: ${units}
4. Each measurement line MUST be a <line> element with attributes x1, y1, x2, y2.
5. Each measurement MUST have a <text> label near the midpoint of the line.
6. Use stroke="#DF6868" stroke-width="1.5" for lines.
7. Use fill="#DF6868" font-size="14" font-family="Arial" for labels.
8. All coordinates MUST be in range [0, 1000]. No negative values. No values > 1000.
9. Lines MUST NOT be zero-length (x1,y1 must differ from x2,y2).
10. Place lines along the edges/dimensions of the main object in the image.
11. Give each element a unique id attribute.

Return ONLY a JSON object with this exact structure:
{
  "svg": "<svg xmlns=\\"http://www.w3.org/2000/svg\\" viewBox=\\"0 0 1000 1000\\">...</svg>"
}`;
    }

    // --- Validation repair loop (max 3 attempts) ---
    const MAX_ATTEMPTS = 3;
    let lastSvg = null;
    let lastErrors = null;
    let usage = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const parts = [];

      if (attempt === 1) {
        parts.push({ text: systemPrompt });
        parts.push({
          inlineData: {
            mimeType: imageMimeType,
            data: imageBase64,
          },
        });
      } else {
        parts.push({
          text: `The previous SVG had validation errors. Please fix them and return a corrected version.

ERRORS:
${lastErrors.join('\n')}

PREVIOUS SVG:
${lastSvg}

Return ONLY a JSON object with: { "svg": "<corrected SVG>" }`,
        });
      }

      const geminiBody = {
        contents: [{ parts }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.2,
        },
      };

      if (thinkingLevel !== 'low') {
        geminiBody.generationConfig.thinkingConfig = {
          thinkingBudget: thinkingLevel === 'high' ? 8192 : 4096,
        };
      }

      const geminiResponse = await fetch(GEMINI_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': GEMINI_API_KEY,
        },
        body: JSON.stringify(geminiBody),
      });

      if (!geminiResponse.ok) {
        const errText = await geminiResponse.text();
        console.error(`[MOS Generate] Gemini API error (attempt ${attempt}):`, errText);

        if (geminiResponse.status === 413 || geminiResponse.status === 429) {
          return res.status(geminiResponse.status).json({
            success: false,
            error: `Gemini API error: ${geminiResponse.status}`,
            rawResponse: errText.slice(0, 500),
          });
        }

        return res.status(502).json({
          success: false,
          error: `Gemini API returned ${geminiResponse.status}`,
        });
      }

      const geminiData = await geminiResponse.json();

      if (geminiData.usageMetadata) {
        usage = {
          promptTokenCount: geminiData.usageMetadata.promptTokenCount || 0,
          totalTokenCount: geminiData.usageMetadata.totalTokenCount || 0,
        };
      }

      let svgText = null;
      try {
        const candidate = geminiData.candidates?.[0];
        const textContent = candidate?.content?.parts?.[0]?.text || '';

        let parsed;
        try {
          parsed = JSON.parse(textContent);
        } catch {
          const stripped = textContent
            .replace(/```(?:json|xml|svg)?\n?/g, '')
            .replace(/```\s*$/g, '')
            .trim();
          const jsonMatch = stripped.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            parsed = JSON.parse(jsonMatch[0]);
          }
        }

        svgText = parsed?.svg;
      } catch (parseErr) {
        console.error(
          `[MOS Generate] Failed to parse Gemini response (attempt ${attempt}):`,
          parseErr
        );
      }

      if (!svgText) {
        lastErrors = ['No SVG found in Gemini response'];
        lastSvg = '';
        continue;
      }

      lastSvg = svgText;

      const errors = validateMosSvg(svgText);

      if (errors.length === 0) {
        let r2Key = null;
        let r2Url = null;
        let supabaseId = null;

        if (isR2Configured()) {
          try {
            const timestamp = Date.now();
            const uuid = crypto.randomUUID();
            r2Key = `mos-overlays/${timestamp}-${uuid}.svg`;

            const { uploadUrl, publicUrl } = await createPresignedUploadUrl({
              key: r2Key,
              contentType: 'image/svg+xml',
              expiresIn: 600,
            });

            await fetch(uploadUrl, {
              method: 'PUT',
              headers: { 'Content-Type': 'image/svg+xml' },
              body: svgText,
            });

            r2Url = publicUrl;
          } catch (r2Err) {
            console.error('[MOS Generate] R2 upload failed:', r2Err);
          }
        }

        if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && projectId) {
          try {
            const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
            const { data, error: sbErr } = await supabaseAdmin
              .from('mos_overlays')
              .insert({
                project_id: projectId,
                view_id: viewId || 'front',
                svg_text: svgText,
                r2_key: r2Key,
                roles: requestedRoles,
                units,
                generated_by: GEMINI_MODEL,
                attempt_count: attempt,
              })
              .select('id')
              .single();

            if (!sbErr && data) {
              supabaseId = data.id;
            }
          } catch (sbErr) {
            console.error('[MOS Generate] Supabase insert failed:', sbErr);
          }
        }

        console.log(`[MOS Generate] Success on attempt ${attempt} for ${rolesStr}`);

        return res.json({
          success: true,
          svg: svgText,
          r2Key,
          r2Url,
          supabaseId,
          attempt,
          usage,
        });
      }

      lastErrors = errors;
      console.log(`[MOS Generate] Attempt ${attempt} had ${errors.length} validation errors`);
    }

    console.error(`[MOS Generate] Failed after ${MAX_ATTEMPTS} attempts`);
    return res.status(422).json({
      success: false,
      error: `SVG validation failed after ${MAX_ATTEMPTS} attempts`,
      rawSvg: lastSvg,
      validationErrors: lastErrors,
    });
  } catch (error) {
    console.error('[MOS Generate] Unexpected error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error generating measurement overlay',
    });
  }
}

app.post('/measurements/generate', handleMosGenerate);
app.post('/api/measurements/generate', handleMosGenerate);

// Error handler
app.use((err, req, res, next) => {
  console.error('[Error]', err);
  res.status(500).json({ success: false, message: 'Server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found', path: req.url });
});

export default app;
