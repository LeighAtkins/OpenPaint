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
      guideView,
      imagePartLabel,
      imageR2Key,
      imageDataUrl,
      imageWidth,
      imageHeight,
      requestedRoles = ['W', 'H'],
      units = 'cm',
      thinkingLevel = 'low',
      templateId,
    } = req.body;

    const resolveGuideView = ({
      viewId: rawViewId,
      guideView: rawGuideView,
      imagePartLabel: rawLabel,
    }) => {
      const explicit = String(rawGuideView || '')
        .trim()
        .toLowerCase();
      if (explicit === 'front' || explicit === 'back' || explicit === 'side') return explicit;

      const hint = `${String(rawViewId || '')} ${String(rawLabel || '')}`.toLowerCase();
      if (hint.includes('back') || hint.includes('rear')) return 'back';
      if (
        hint.includes('side') ||
        hint.includes('left') ||
        hint.includes('right') ||
        hint.includes('arm')
      ) {
        return 'side';
      }
      return 'front';
    };

    const normalizeRoleToken = value =>
      String(value || '')
        .trim()
        .replace(/[^a-z0-9-]/gi, '')
        .toUpperCase();

    const canonicalRoleToken = value => {
      const token = normalizeRoleToken(value);
      if (!token) return '';
      const strippedUnits = token.replace(/(?:CM|MM|IN)\d*$/i, '');
      return strippedUnits || token;
    };

    const parseGuideRolesFromSvg = svgText => {
      if (!svgText || typeof svgText !== 'string') return [];
      const out = new Set();

      const idRegex = /\sid="([^"]+)"/gi;
      let idMatch;
      while ((idMatch = idRegex.exec(svgText)) !== null) {
        const raw = String(idMatch[1] || '')
          .replace(/^mos\d+_/, '')
          .trim();
        if (/^[mbc][a-z0-9_-]+$/i.test(raw)) {
          const token = raw
            .slice(1)
            .replace(/_(label|text)$/i, '')
            .replace(/[^a-z0-9-]/gi, '');
          const canonical = canonicalRoleToken(token);
          if (canonical && canonical.length <= 20 && !/^\d+$/.test(canonical)) out.add(canonical);
        }
      }

      const textRegex = /<text[^>]*>([^<]+)<\/text>/gi;
      let textMatch;
      while ((textMatch = textRegex.exec(svgText)) !== null) {
        const canonical = canonicalRoleToken(textMatch[1] || '');
        if (canonical && canonical.length <= 20 && !/^\d+$/.test(canonical)) out.add(canonical);
      }

      return Array.from(out);
    };

    const roleTokenFromId = value => {
      const id = String(value || '')
        .replace(/^mos\d+_/, '')
        .trim();
      if (!/^[mbc][a-z0-9_-]+$/i.test(id)) return '';
      const token = id
        .slice(1)
        .replace(/_(label|text)$/i, '')
        .replace(/(?:CM|MM|IN)\d*$/i, '')
        .replace(/[^a-z0-9-]/gi, '');
      return canonicalRoleToken(token);
    };

    const parseTemplateRoleMap = svgText => {
      const lineIds = new Set();
      const measureIds = new Set();
      const lineIdByRole = new Map();

      if (!svgText || typeof svgText !== 'string') {
        return { lineIds, measureIds, lineIdByRole };
      }

      const lineRegex = /<line\b[^>]*\sid="([^"]+)"[^>]*>/gi;
      let match;
      while ((match = lineRegex.exec(svgText)) !== null) {
        const id = String(match[1] || '').trim();
        if (!id) continue;
        lineIds.add(id);
        measureIds.add(id);
        const role = roleTokenFromId(id);
        if (role && !lineIdByRole.has(role)) {
          lineIdByRole.set(role, id);
        }
      }

      const groupRegex = /<g\b[^>]*\sid="([^"]+)"[^>]*>/gi;
      let groupMatch;
      while ((groupMatch = groupRegex.exec(svgText)) !== null) {
        const id = String(groupMatch[1] || '').trim();
        if (!id) continue;
        const role = roleTokenFromId(id);
        if (!role) continue;
        measureIds.add(id);
        if (!lineIdByRole.has(role)) {
          lineIdByRole.set(role, id);
        }
      }

      return { lineIds, measureIds, lineIdByRole };
    };

    const parseRoleGeometryHints = (svgText, selectedRoles) => {
      const hints = new Map();
      if (!svgText || typeof svgText !== 'string') return hints;

      const groupRegex = /<g\b[^>]*\sid="([^"]+)"[^>]*>([\s\S]*?)<\/g>/gi;
      let groupMatch;
      while ((groupMatch = groupRegex.exec(svgText)) !== null) {
        const groupId = String(groupMatch[1] || '').trim();
        const role = roleTokenFromId(groupId);
        if (!role || !selectedRoles.includes(role) || hints.has(role)) continue;
        const body = String(groupMatch[2] || '');

        if (/<path\b/i.test(body)) {
          hints.set(role, 'curved path');
          continue;
        }

        const lineMatch = body.match(
          /<line\b[^>]*\bx1="([^"]+)"[^>]*\by1="([^"]+)"[^>]*\bx2="([^"]+)"[^>]*\by2="([^"]+)"/i
        );
        if (lineMatch) {
          const x1 = Number.parseFloat(lineMatch[1]);
          const y1 = Number.parseFloat(lineMatch[2]);
          const x2 = Number.parseFloat(lineMatch[3]);
          const y2 = Number.parseFloat(lineMatch[4]);
          if ([x1, y1, x2, y2].every(Number.isFinite)) {
            const dx = Math.abs(x2 - x1);
            const dy = Math.abs(y2 - y1);
            hints.set(
              role,
              dx < 1 ? 'vertical line' : dy < 1 ? 'horizontal line' : 'diagonal line'
            );
            continue;
          }
        }

        const polylineMatch = body.match(/<polyline\b[^>]*\bpoints="([^"]+)"/i);
        if (polylineMatch) {
          const pts = String(polylineMatch[1] || '')
            .trim()
            .split(/\s+/)
            .map(pair => pair.split(',').map(Number))
            .filter(
              pair => pair.length === 2 && Number.isFinite(pair[0]) && Number.isFinite(pair[1])
            );
          if (pts.length >= 2) {
            const first = pts[0];
            const last = pts[pts.length - 1];
            const dx = Math.abs(last[0] - first[0]);
            const dy = Math.abs(last[1] - first[1]);
            hints.set(
              role,
              dx < 1 ? 'vertical line' : dy < 1 ? 'horizontal line' : 'diagonal line'
            );
            continue;
          }
        }

        hints.set(role, 'line');
      }

      return hints;
    };

    const setAttr = (tag, attr, value) => {
      const rounded = Number(value.toFixed(2));
      const attrRegex = new RegExp(`\\b${attr}="[^"]*"`, 'i');
      if (attrRegex.test(tag)) {
        return tag.replace(attrRegex, `${attr}="${rounded}"`);
      }
      return tag
        .replace(/\/>$/, ` ${attr}="${rounded}" />`)
        .replace(/>$/, ` ${attr}="${rounded}">`);
    };

    const updateLineById = (svgText, id, coords) => {
      const idEscaped = String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const lineRegex = new RegExp(`<line\\b[^>]*\\bid="${idEscaped}"[^>]*\\/?>`, 'i');
      const lineTagMatch = svgText.match(lineRegex);
      if (!lineTagMatch) return svgText;

      let updatedTag = lineTagMatch[0];
      updatedTag = setAttr(updatedTag, 'x1', coords.x1);
      updatedTag = setAttr(updatedTag, 'y1', coords.y1);
      updatedTag = setAttr(updatedTag, 'x2', coords.x2);
      updatedTag = setAttr(updatedTag, 'y2', coords.y2);

      return svgText.replace(lineRegex, updatedTag);
    };

    const stripSvgTextNodes = svgText =>
      String(svgText || '')
        .replace(/<text\b[\s\S]*?<\/text>/gi, '')
        .replace(/<tspan\b[\s\S]*?<\/tspan>/gi, '');

    const ensureCanonicalSvgRoot = svgText => {
      const source = String(svgText || '');
      if (!/<svg[\s>]/i.test(source)) return source;
      return source.replace(
        /<svg\b[^>]*>/i,
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">'
      );
    };

    const extractLineOpsFromSvg = (svgText, allowedLineIds) => {
      const ops = [];
      if (!svgText || typeof svgText !== 'string') return ops;

      const lineRegex = /<line\b[^>]*>/gi;
      let match;
      while ((match = lineRegex.exec(svgText)) !== null) {
        const lineTag = match[0];
        const attr = name => {
          const m = lineTag.match(new RegExp(`\\b${name}="([^"]+)"`, 'i'));
          return m ? m[1] : '';
        };
        const id = String(attr('id') || '').trim();
        if (!allowedLineIds.has(id)) continue;
        const x1 = Number.parseFloat(attr('x1'));
        const y1 = Number.parseFloat(attr('y1'));
        const x2 = Number.parseFloat(attr('x2'));
        const y2 = Number.parseFloat(attr('y2'));
        if (![x1, y1, x2, y2].every(Number.isFinite)) continue;
        ops.push({ id, x1, y1, x2, y2 });
      }

      return ops;
    };

    const extractGroupOpsFromSvg = (svgText, selectedRoles) => {
      if (!svgText || typeof svgText !== 'string') return [];

      const parsePathPoints = d => {
        const values = (String(d || '').match(/-?\d*\.?\d+/g) || [])
          .map(Number)
          .filter(Number.isFinite);
        const points = [];
        for (let i = 0; i + 1 < values.length; i += 2) {
          points.push({ x: values[i], y: values[i + 1] });
        }
        return points;
      };

      const parseViewBoxBounds = text => {
        const vb = String(text).match(/viewBox="([^"]+)"/i)?.[1] || '';
        const nums = vb
          .trim()
          .split(/[\s,]+/)
          .map(Number)
          .filter(n => Number.isFinite(n));
        if (nums.length === 4 && nums[2] > 0 && nums[3] > 0) {
          return { minX: nums[0], minY: nums[1], width: nums[2], height: nums[3] };
        }
        return null;
      };

      const groupRegex = /<g\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/g>/gi;
      const rawOps = [];
      let groupMatch;
      while ((groupMatch = groupRegex.exec(svgText)) !== null) {
        const groupId = String(groupMatch[1] || '').trim();
        const role = roleTokenFromId(groupId);
        if (!role || !selectedRoles.includes(role)) continue;

        const groupBody = String(groupMatch[2] || '');

        const lineMatch = groupBody.match(
          /<line\b[^>]*\bx1="([^"]+)"[^>]*\by1="([^"]+)"[^>]*\bx2="([^"]+)"[^>]*\by2="([^"]+)"[^>]*>/i
        );
        if (lineMatch) {
          const x1 = Number.parseFloat(lineMatch[1]);
          const y1 = Number.parseFloat(lineMatch[2]);
          const x2 = Number.parseFloat(lineMatch[3]);
          const y2 = Number.parseFloat(lineMatch[4]);
          if ([x1, y1, x2, y2].every(Number.isFinite)) {
            rawOps.push({ id: groupId, role, x1, y1, x2, y2 });
            continue;
          }
        }

        const polylineMatch = groupBody.match(/<polyline\b[^>]*\bpoints="([^"]+)"[^>]*>/i);
        if (polylineMatch) {
          const pointsRaw = String(polylineMatch[1] || '').trim();
          const points = pointsRaw
            .split(/\s+/)
            .map(pair => pair.split(',').map(Number))
            .filter(
              pair => pair.length === 2 && Number.isFinite(pair[0]) && Number.isFinite(pair[1])
            );
          if (points.length >= 2) {
            const first = points[0];
            const last = points[points.length - 1];
            rawOps.push({
              id: groupId,
              role,
              x1: first[0],
              y1: first[1],
              x2: last[0],
              y2: last[1],
            });
            continue;
          }
        }

        const pathMatch = groupBody.match(/<path\b[^>]*\bd="([^"]+)"[^>]*>/i);
        if (pathMatch) {
          const pts = parsePathPoints(pathMatch[1]);
          if (pts.length >= 2) {
            const first = pts[0];
            const last = pts[pts.length - 1];
            rawOps.push({
              id: groupId,
              role,
              x1: first.x,
              y1: first.y,
              x2: last.x,
              y2: last.y,
            });
            continue;
          }
        }
      }

      if (!rawOps.length) return [];

      const boundsFromVb = parseViewBoxBounds(svgText);
      const allX = rawOps.flatMap(op => [op.x1, op.x2]);
      const allY = rawOps.flatMap(op => [op.y1, op.y2]);
      const inferredMinX = Math.min(...allX);
      const inferredMaxX = Math.max(...allX);
      const inferredMinY = Math.min(...allY);
      const inferredMaxY = Math.max(...allY);

      const minX = boundsFromVb?.minX ?? inferredMinX;
      const minY = boundsFromVb?.minY ?? inferredMinY;
      const width = boundsFromVb?.width ?? Math.max(1, inferredMaxX - inferredMinX);
      const height = boundsFromVb?.height ?? Math.max(1, inferredMaxY - inferredMinY);

      const toMosX = x => Math.max(0, Math.min(1000, ((x - minX) / width) * 1000));
      const toMosY = y => Math.max(0, Math.min(1000, ((y - minY) / height) * 1000));

      return rawOps.map(op => ({
        id: op.id,
        role: op.role,
        x1: toMosX(op.x1),
        y1: toMosY(op.y1),
        x2: toMosX(op.x2),
        y2: toMosY(op.y2),
      }));
    };

    const classifyOrientation = op => {
      const dx = Math.abs(Number(op?.x2) - Number(op?.x1));
      const dy = Math.abs(Number(op?.y2) - Number(op?.y1));
      if (dx < 2) return 'vertical';
      if (dy < 2) return 'horizontal';
      return 'diagonal';
    };

    const buildRoleAnchorsFromTemplate = (svgText, selectedRoles) => {
      const anchors = new Map();
      const templateOps = extractGroupOpsFromSvg(svgText, selectedRoles);
      for (const op of templateOps) {
        if (!op?.role || anchors.has(op.role)) continue;
        const vx = Number(op.x2) - Number(op.x1);
        const vy = Number(op.y2) - Number(op.y1);
        const len = Math.max(1, Math.hypot(vx, vy));
        anchors.set(op.role, {
          x: (Number(op.x1) + Number(op.x2)) / 2,
          y: (Number(op.y1) + Number(op.y2)) / 2,
          orientation: classifyOrientation(op),
          vx: vx / len,
          vy: vy / len,
        });
      }
      return anchors;
    };

    const buildLinesOnlyMosSvg = ops => {
      const lines = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">'];
      for (const op of ops) {
        lines.push(
          `  <line id="m${op.role}" class="mos-line" x1="${Number(op.x1.toFixed(2))}" y1="${Number(op.y1.toFixed(2))}" x2="${Number(op.x2.toFixed(2))}" y2="${Number(op.y2.toFixed(2))}" stroke="#DF6868" stroke-width="1.5" fill="none" />`
        );
      }
      lines.push('</svg>');
      return lines.join('\n');
    };

    const applyOpsToTemplate = ({
      templateSvg,
      selectedRoles,
      ops,
      measureIds,
      lineIdByRole,
      roleAnchors,
    }) => {
      if (!templateSvg || typeof templateSvg !== 'string') {
        return { svgText: '', errors: ['Template SVG unavailable'], missingRoles: selectedRoles };
      }

      const selectedSet = new Set(selectedRoles);
      const validOps = [];
      const unknownIds = [];

      for (const op of Array.isArray(ops) ? ops : []) {
        const id = String(op?.id || '').trim();
        const roleFromField = canonicalRoleToken(op?.role || '');
        const roleFromId = roleTokenFromId(id);
        const role = selectedSet.has(roleFromField)
          ? roleFromField
          : selectedSet.has(roleFromId)
            ? roleFromId
            : '';

        if (!role) {
          if (id) unknownIds.push(id);
          continue;
        }

        if (id && measureIds && !measureIds.has(id) && !lineIdByRole.has(role)) {
          unknownIds.push(id);
          continue;
        }

        const x1 = Number(op.x1);
        const y1 = Number(op.y1);
        const x2 = Number(op.x2);
        const y2 = Number(op.y2);
        if (![x1, y1, x2, y2].every(Number.isFinite)) continue;

        validOps.push({
          id: lineIdByRole.get(role) || id || `m${role}`,
          role,
          x1: Math.max(0, Math.min(1000, x1)),
          y1: Math.max(0, Math.min(1000, y1)),
          x2: Math.max(0, Math.min(1000, x2)),
          y2: Math.max(0, Math.min(1000, y2)),
        });
      }

      const rolesFromOps = new Set(validOps.map(op => op.role));
      const missingRoles = selectedRoles.filter(role => !lineIdByRole.has(role));
      const errors = [];
      if (missingRoles.length > 0) {
        errors.push(`Template missing required roles: ${missingRoles.join(', ')}`);
      }

      // Remap role assignment by template anchor proximity to prevent role drift (e.g. A1/C1 swaps).
      const remappedOps = [];
      const anchors = roleAnchors || new Map();
      const candidates = validOps.map(op => ({
        ...op,
        mx: (op.x1 + op.x2) / 2,
        my: (op.y1 + op.y2) / 2,
        orientation: classifyOrientation(op),
      }));

      const unusedIdx = new Set(candidates.map((_, idx) => idx));
      for (const role of selectedRoles) {
        const anchor = anchors.get(role);
        if (!anchor) continue;

        let bestIdx = -1;
        let bestScore = Number.POSITIVE_INFINITY;
        for (const idx of unusedIdx) {
          const c = candidates[idx];
          const dx = c.mx - anchor.x;
          const dy = c.my - anchor.y;
          const dist = Math.hypot(dx, dy);
          const orientationPenalty = c.orientation === anchor.orientation ? 0 : 220;
          const score = dist + orientationPenalty;
          if (score < bestScore) {
            bestScore = score;
            bestIdx = idx;
          }
        }

        if (bestIdx >= 0) {
          const chosen = candidates[bestIdx];
          remappedOps.push({
            ...chosen,
            role,
            id: lineIdByRole.get(role) || chosen.id,
          });
          unusedIdx.delete(bestIdx);
        }
      }

      const finalOps = remappedOps.length > 0 ? remappedOps : validOps;

      for (const op of finalOps) {
        const anchor = anchors.get(op.role);
        if (!anchor) continue;

        const mx = (op.x1 + op.x2) / 2;
        const my = (op.y1 + op.y2) / 2;
        const baseLen = Math.max(32, Math.hypot(op.x2 - op.x1, op.y2 - op.y1));

        let dx = op.x2 - op.x1;
        let dy = op.y2 - op.y1;

        if (anchor.orientation === 'horizontal') {
          dx = baseLen;
          dy = 0;
        } else if (anchor.orientation === 'vertical') {
          dx = 0;
          dy = baseLen;
        } else {
          const avx = Number(anchor.vx) || 0;
          const avy = Number(anchor.vy) || 0;
          if (Math.abs(avx) > 0.01 || Math.abs(avy) > 0.01) {
            dx = avx * baseLen;
            dy = avy * baseLen;
          }
          if (Math.abs(dx) < 2) dx = dx >= 0 ? 18 : -18;
          if (Math.abs(dy) < 2) dy = dy >= 0 ? 18 : -18;
        }

        op.x1 = Math.max(0, Math.min(1000, mx - dx / 2));
        op.y1 = Math.max(0, Math.min(1000, my - dy / 2));
        op.x2 = Math.max(0, Math.min(1000, mx + dx / 2));
        op.y2 = Math.max(0, Math.min(1000, my + dy / 2));
      }

      const appliedRoleSet = new Set();
      for (const op of finalOps) {
        const dx = Math.abs(op.x2 - op.x1);
        const dy = Math.abs(op.y2 - op.y1);
        if (dx < 0.1 && dy < 0.1) {
          op.x2 = op.x2 >= 999.5 ? op.x2 - 1 : op.x2 + 1;
        }
        appliedRoleSet.add(op.role);
      }
      const output = buildLinesOnlyMosSvg(finalOps);

      return {
        svgText: output,
        errors,
        missingRoles,
        appliedRoles: Array.from(appliedRoleSet),
        ignoredUnknownIds: Array.from(new Set(unknownIds)),
        rolesFromOps: Array.from(rolesFromOps),
      };
    };

    const autoRepairMosSvg = svgText => {
      if (!svgText || typeof svgText !== 'string') return '';

      let repaired = svgText;

      repaired = repaired.replace(/<script[\s\S]*?<\/script>/gi, '');
      repaired = repaired.replace(/\son\w+\s*=\s*"[^"]*"/gi, '');
      repaired = repaired.replace(/\son\w+\s*=\s*'[^']*'/gi, '');
      repaired = repaired.replace(/javascript\s*:/gi, '');

      if (/<svg[\s>]/i.test(repaired)) {
        if (/viewBox="[^"]*"/i.test(repaired)) {
          repaired = repaired.replace(/viewBox="[^"]*"/i, 'viewBox="0 0 1000 1000"');
        } else {
          repaired = repaired.replace(/<svg\b/i, '<svg viewBox="0 0 1000 1000"');
        }
      }

      repaired = repaired.replace(/(x1|y1|x2|y2|x|y|cx|cy)="([^"]+)"/gi, (_match, attr, raw) => {
        const n = Number.parseFloat(String(raw));
        if (!Number.isFinite(n)) return `${attr}="0"`;
        const clamped = Math.max(0, Math.min(1000, n));
        const normalized = Number(clamped.toFixed(2));
        return `${attr}="${normalized}"`;
      });

      repaired = repaired.replace(/<line\b[^>]*>/gi, tag => {
        const read = name => {
          const m = tag.match(new RegExp(`${name}="([^\"]+)"`, 'i'));
          return m ? Number.parseFloat(m[1]) : Number.NaN;
        };
        const x1 = read('x1');
        const y1 = read('y1');
        const x2 = read('x2');
        const y2 = read('y2');
        if (![x1, y1, x2, y2].every(Number.isFinite)) return tag;
        if (Math.abs(x2 - x1) >= 0.1 || Math.abs(y2 - y1) >= 0.1) return tag;

        const nudgedX2 = x2 >= 999.5 ? x2 - 1 : x2 + 1;
        return tag.replace(/x2="([^"]+)"/i, `x2="${Number(nudgedX2.toFixed(2))}"`);
      });

      return repaired;
    };

    const formatHintList = (items, limit = 24) => {
      if (!Array.isArray(items) || items.length === 0) return 'none';
      const visible = items.slice(0, limit);
      const suffix = items.length > limit ? ` (+${items.length - limit} more)` : '';
      return `${visible.join(', ')}${suffix}`;
    };

    const buildTemplatePromptContext = svgText => {
      if (!svgText || typeof svgText !== 'string') return '';

      const groupIds = [];
      const lineIds = [];
      const textHints = [];

      const groupRegex = /<g\b[^>]*\sid="([^"]+)"[^>]*>/gi;
      let groupMatch;
      while ((groupMatch = groupRegex.exec(svgText)) !== null && groupIds.length < 24) {
        groupIds.push(groupMatch[1]);
      }

      const lineRegex = /<line\b[^>]*\sid="([^"]+)"[^>]*>/gi;
      let lineMatch;
      while ((lineMatch = lineRegex.exec(svgText)) !== null && lineIds.length < 40) {
        lineIds.push(lineMatch[1]);
      }

      const textRegexWithId = /<text\b[^>]*\sid="([^"]+)"[^>]*>([^<]*)<\/text>/gi;
      let textMatchWithId;
      while ((textMatchWithId = textRegexWithId.exec(svgText)) !== null && textHints.length < 24) {
        const rawValue = String(textMatchWithId[2] || '').trim();
        const canonical = canonicalRoleToken(rawValue);
        const safeRole = canonical || rawValue || '?';
        textHints.push(`${textMatchWithId[1]}:${safeRole}`);
      }

      const viewBoxMatch = svgText.match(/viewBox="([^"]+)"/i);
      const viewBox = viewBoxMatch?.[1] || '0 0 1000 1000';

      return [
        'TEMPLATE BLUEPRINT (compact):',
        `- viewBox: ${viewBox}`,
        `- group ids: ${formatHintList(groupIds)}`,
        `- line ids: ${formatHintList(lineIds)}`,
        `- text id/role hints: ${formatHintList(textHints)}`,
      ].join('\n');
    };

    const traceId = crypto.randomUUID().slice(0, 8);
    const logPrefix = `[MOS Generate ${traceId}]`;
    res.setHeader('x-mos-trace-id', traceId);
    const requestStartMs = Date.now();
    const phaseDurations = {};
    const debugState = {
      traceId,
      request: {
        viewId: String(viewId || 'front'),
        guideView: String(guideView || ''),
        imagePartLabel: String(imagePartLabel || ''),
        templateId: String(templateId || ''),
        requestedRoles: Array.isArray(requestedRoles) ? requestedRoles : [],
        hasImageDataUrl: Boolean(imageDataUrl),
        hasImageR2Key: Boolean(imageR2Key),
      },
      template: {
        attempted: false,
        fetched: false,
        bytes: 0,
      },
      image: {
        mimeType: '',
        preparedBytes: 0,
      },
      gemini: {
        attempts: [],
      },
      pipeline: {
        selectedRoles: [],
        templateRoles: [],
        rolesApplied: [],
        missingRoles: [],
      },
    };
    const markPhase = (phase, startMs) => {
      phaseDurations[phase] = Date.now() - startMs;
    };

    console.log(
      `${logPrefix} start template=${templateId || 'none'} view=${String(viewId || 'front')} guideView=${String(guideView || '')} imagePartLabel=${String(imagePartLabel || '')}`
    );

    // --- Fetch reference template SVG from Cloudflare Worker (if templateId provided) ---
    let referenceSvgText = null;
    const resolvedGuideView = resolveGuideView({
      viewId,
      guideView,
      imagePartLabel,
    });
    if (templateId && WORKER_BASE_URL) {
      debugState.template.attempted = true;
      const templateFetchStartMs = Date.now();
      try {
        const svgUrl = `${WORKER_BASE_URL}/measurement-guides/svg?code=${encodeURIComponent(templateId)}&view=${encodeURIComponent(resolvedGuideView)}`;
        const svgRes = await fetch(svgUrl, {
          method: 'GET',
          headers: {
            'x-api-key': WORKER_API_KEY || 'dev-secret',
            accept: 'image/svg+xml,application/json',
          },
        });
        if (svgRes.ok) {
          referenceSvgText = await svgRes.text();
          debugState.template.fetched = true;
          debugState.template.bytes = referenceSvgText.length;
          markPhase('templateFetchMs', templateFetchStartMs);
          console.log(
            `${logPrefix} fetched template view=${resolvedGuideView} bytes=${referenceSvgText.length} in ${phaseDurations.templateFetchMs}ms`
          );
        } else {
          markPhase('templateFetchMs', templateFetchStartMs);
          console.warn(
            `${logPrefix} template fetch failed status=${svgRes.status} in ${phaseDurations.templateFetchMs}ms`
          );
        }
      } catch (refErr) {
        markPhase('templateFetchMs', templateFetchStartMs);
        console.warn(
          `${logPrefix} template fetch error in ${phaseDurations.templateFetchMs}ms: ${refErr.message}`
        );
      }
    }

    const normalizedRequestedRoles = Array.from(
      new Set(
        (Array.isArray(requestedRoles) ? requestedRoles : [])
          .map(role => canonicalRoleToken(role))
          .filter(Boolean)
      )
    );

    const templateRoles = parseGuideRolesFromSvg(referenceSvgText);
    const effectiveRolesRaw = normalizedRequestedRoles.length
      ? normalizedRequestedRoles
      : templateRoles.length
        ? templateRoles
        : ['W', 'H'];
    const effectiveRoles = effectiveRolesRaw.slice(0, 8);
    debugState.pipeline.selectedRoles = [...effectiveRoles];
    debugState.pipeline.templateRoles = [...templateRoles];
    const templatePromptContext = buildTemplatePromptContext(referenceSvgText);
    const templateRoleMap = parseTemplateRoleMap(referenceSvgText);
    const roleGeometryHints = parseRoleGeometryHints(referenceSvgText, effectiveRoles);
    const roleAnchors = buildRoleAnchorsFromTemplate(referenceSvgText, effectiveRoles);
    const roleHintsText = effectiveRoles
      .map(role => `${role}: ${roleGeometryHints.get(role) || 'line'}`)
      .join(', ');

    if (!templateId || !referenceSvgText) {
      return res.status(422).json({
        success: false,
        error: 'Template SVG is required for MOS generation.',
      });
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

    const imagePrepStartMs = Date.now();
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

      try {
        const sharp = (await import('sharp')).default;
        const rawBuffer = Buffer.from(imageBase64, 'base64');
        const maxEdge = process.env.VERCEL ? 768 : 1024;
        const longestEdge = Math.max(Number(imageWidth) || 0, Number(imageHeight) || 0);
        if (longestEdge > maxEdge || rawBuffer.length > 900000) {
          const resized = await sharp(rawBuffer)
            .resize(maxEdge, maxEdge, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: process.env.VERCEL ? 78 : 85 })
            .toBuffer();
          imageBase64 = resized.toString('base64');
          imageMimeType = 'image/jpeg';
        }
      } catch {
        // Keep original data URL bytes when sharp is unavailable.
      }
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
    markPhase('imagePrepMs', imagePrepStartMs);
    debugState.image.mimeType = imageMimeType;
    debugState.image.preparedBytes = Math.round((imageBase64?.length || 0) * 0.75);

    console.log(
      `${logPrefix} roles=${effectiveRoles.join(',')} templateRoles=${templateRoles.length} imageMime=${imageMimeType} imageBytes=${Math.round((imageBase64?.length || 0) * 0.75)} imagePrep=${phaseDurations.imagePrepMs}ms`
    );

    // --- Build Gemini prompt ---
    const rolesStr = effectiveRoles.join(', ');

    let systemPrompt;
    let fallbackPrompt;
    if (referenceSvgText) {
      systemPrompt = `You are a measurement overlay generator for product images.
Your task is to analyse the provided image and return measurement line geometry operations.

IMPORTANT: Do not return SVG. Do not return numeric measurements. Do not output text labels.
Use only existing template line ids.

${templatePromptContext}

RULES:
1. Allowed roles: ${rolesStr}
2. Return one line op per requested role whenever possible.
3. Each op MUST target an existing template line id.
4. All coordinates MUST be in range [0, 1000].
5. Lines MUST NOT be zero-length.
6. Do not return extra roles.
7. Preserve role geometry semantics from template: ${roleHintsText}

Return ONLY a JSON object with this exact structure:
{
  "ops": [
    {"role":"A1","x1":120,"y1":700,"x2":890,"y2":700}
  ]
}`;
      fallbackPrompt = `You are a measurement overlay generator for product images.
Your task is to analyse the provided image and return measurement line geometry ops.

ROLE TOKENS:
${rolesStr}

RULES:
1. Return JSON with key "ops" only.
2. Use only existing line ids from the template blueprint.
3. Do not include text labels or SVG.
4. All coordinates must be within [0, 1000].
5. No zero-length lines.
6. Preserve role geometry semantics from template: ${roleHintsText}

Return ONLY a JSON object with this exact structure:
{
  "ops": [
    {"role":"A1","x1":120,"y1":700,"x2":890,"y2":700}
  ]
}`;
    } else {
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
      fallbackPrompt = systemPrompt;
    }

    // --- Validation repair loop (max 3 attempts) ---
    const MAX_ATTEMPTS = process.env.VERCEL ? 2 : 3;
    let lastSvg = null;
    let lastErrors = null;
    let usage = null;
    let lastAttemptMode = 'template';
    let lastAppliedRoles = [];
    let lastMissingRoles = [];
    let lastSemanticErrors = [];
    let lastParsedOpsCount = 0;
    let lastFallbackOpsCount = 0;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const parts = [];

      const promptText = attempt === 1 ? systemPrompt : fallbackPrompt;
      parts.push({ text: promptText });
      parts.push({
        inlineData: {
          mimeType: imageMimeType,
          data: imageBase64,
        },
      });

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

      const geminiRequestStartMs = Date.now();
      const geminiAttemptMode = attempt === 1 ? 'template' : 'fallback';
      lastAttemptMode = geminiAttemptMode;
      const attemptDebug = {
        attempt,
        mode: geminiAttemptMode,
        sentImageInline: true,
        sentTemplateContext: Boolean(referenceSvgText),
        responseStatus: 0,
        parsedOpsCount: 0,
        fallbackOpsCount: 0,
        responseHasSvgField: false,
        responseSnippet: '',
      };
      const geminiAbort = new AbortController();
      const timeoutMs = process.env.VERCEL ? 24000 : 28000;
      const geminiTimeout = setTimeout(() => geminiAbort.abort(), timeoutMs);
      let geminiResponse;
      try {
        geminiResponse = await fetch(GEMINI_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': GEMINI_API_KEY,
          },
          body: JSON.stringify(geminiBody),
          signal: geminiAbort.signal,
        });
      } catch (fetchErr) {
        markPhase(`geminiAttempt${attempt}Ms`, geminiRequestStartMs);
        if (fetchErr?.name === 'AbortError') {
          console.warn(
            `${logPrefix} Gemini timeout attempt=${attempt} mode=${geminiAttemptMode} after ${phaseDurations[`geminiAttempt${attempt}Ms`]}ms`
          );
          lastSvg = '';
          lastErrors = ['Gemini timeout'];
          debugState.gemini.attempts.push({
            ...attemptDebug,
            timeout: true,
          });
          continue;
        }
        throw fetchErr;
      } finally {
        clearTimeout(geminiTimeout);
      }

      markPhase(`geminiAttempt${attempt}Ms`, geminiRequestStartMs);
      console.log(
        `${logPrefix} Gemini attempt=${attempt} status=${geminiResponse.status} mode=${geminiAttemptMode} in ${phaseDurations[`geminiAttempt${attempt}Ms`]}ms`
      );
      attemptDebug.responseStatus = geminiResponse.status;

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
      let semanticErrors = [];
      let missingRoles = [];
      let appliedRoles = [];
      try {
        const candidate = geminiData.candidates?.[0];
        const textContent = candidate?.content?.parts?.[0]?.text || '';
        attemptDebug.responseSnippet = String(textContent || '').slice(0, 240);

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

        const parsedOps = Array.isArray(parsed?.ops) ? parsed.ops : [];
        const fallbackOps =
          typeof parsed?.svg === 'string' ? extractGroupOpsFromSvg(parsed.svg, effectiveRoles) : [];
        attemptDebug.responseHasSvgField = typeof parsed?.svg === 'string';
        attemptDebug.parsedOpsCount = parsedOps.length;
        attemptDebug.fallbackOpsCount = fallbackOps.length;
        lastParsedOpsCount = parsedOps.length;
        lastFallbackOpsCount = fallbackOps.length;
        const ops = parsedOps.length ? parsedOps : fallbackOps;

        const applied = applyOpsToTemplate({
          templateSvg: referenceSvgText,
          selectedRoles: effectiveRoles,
          ops,
          measureIds: templateRoleMap.measureIds,
          lineIdByRole: templateRoleMap.lineIdByRole,
          roleAnchors,
        });

        svgText = applied.svgText;
        semanticErrors = applied.errors || [];
        missingRoles = applied.missingRoles || [];
        appliedRoles = applied.appliedRoles || [];
        lastSemanticErrors = semanticErrors;
        lastMissingRoles = missingRoles;
        lastAppliedRoles = appliedRoles;
        debugState.pipeline.rolesApplied = [...appliedRoles];
        debugState.pipeline.missingRoles = [...missingRoles];
      } catch (parseErr) {
        console.error(
          `[MOS Generate] Failed to parse Gemini response (attempt ${attempt}):`,
          parseErr
        );
      }

      if (!svgText) {
        lastErrors = ['No usable geometry ops found in Gemini response'];
        lastSvg = '';
        debugState.gemini.attempts.push(attemptDebug);
        continue;
      }

      lastSvg = svgText;

      let syntaxErrors = validateMosSvg(svgText);
      let errors = [...semanticErrors, ...syntaxErrors];

      if (errors.length > 0) {
        const repairedSvg = autoRepairMosSvg(svgText);
        if (repairedSvg && repairedSvg !== svgText) {
          const canonicalRepairedSvg = ensureCanonicalSvgRoot(repairedSvg);
          const repairedSyntaxErrors = validateMosSvg(canonicalRepairedSvg);
          const combinedRepairedErrors = [...semanticErrors, ...repairedSyntaxErrors];
          if (combinedRepairedErrors.length === 0) {
            svgText = canonicalRepairedSvg;
            lastSvg = svgText;
            errors = [];
            console.log(`${logPrefix} attempt=${attempt} autoRepair=applied`);
          } else {
            errors = combinedRepairedErrors;
            lastSvg = canonicalRepairedSvg;
          }
        }
      }

      if (appliedRoles.length === 0) {
        errors = [...errors, 'No role vectors were extracted from model response'];
      }

      if (errors.length === 0) {
        debugState.gemini.attempts.push(attemptDebug);
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
                roles: effectiveRoles,
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

        console.log(`${logPrefix} success attempt=${attempt} roles=${rolesStr}`);
        markPhase('totalMs', requestStartMs);
        console.log(`${logPrefix} total=${phaseDurations.totalMs}ms`);

        return res.json({
          success: true,
          traceId,
          svg: svgText,
          r2Key,
          r2Url,
          supabaseId,
          attempt,
          attemptMode: geminiAttemptMode,
          templateUsed: true,
          resolvedGuideView,
          rolesApplied: appliedRoles,
          missingRoles,
          debug: {
            attemptMode: geminiAttemptMode,
            parsedOpsCount: lastParsedOpsCount,
            fallbackOpsCount: lastFallbackOpsCount,
            semanticErrors,
            stageAnswers: {
              imageSentToGemini: true,
              templateSvgFetched: debugState.template.fetched,
              modelReturnedSvgText: attemptDebug.responseHasSvgField,
              rolesMappedToVectors: appliedRoles.length > 0,
            },
            trace: debugState,
          },
          usage,
        });
      }

      lastErrors = errors;
      debugState.gemini.attempts.push(attemptDebug);
      console.log(
        `${logPrefix} attempt=${attempt} validationErrors=${errors.length} details=${errors.slice(0, 3).join(' | ')}`
      );
    }

    markPhase('totalMs', requestStartMs);
    console.error(
      `${logPrefix} failed after ${MAX_ATTEMPTS} attempts total=${phaseDurations.totalMs}ms`
    );
    if (!lastSvg && Array.isArray(lastErrors) && lastErrors.includes('Gemini timeout')) {
      return res.status(504).json({
        success: false,
        traceId,
        error: 'Generation timed out while contacting Gemini. Try fewer roles or a smaller image.',
      });
    }
    return res.status(422).json({
      success: false,
      traceId,
      error: `SVG validation failed after ${MAX_ATTEMPTS} attempts`,
      rawSvg: lastSvg,
      validationErrors: lastErrors,
      attemptMode: lastAttemptMode,
      templateUsed: true,
      resolvedGuideView,
      rolesApplied: lastAppliedRoles,
      missingRoles: lastMissingRoles,
      debug: {
        parsedOpsCount: lastParsedOpsCount,
        fallbackOpsCount: lastFallbackOpsCount,
        semanticErrors: lastSemanticErrors,
        stageAnswers: {
          imageSentToGemini: true,
          templateSvgFetched: debugState.template.fetched,
          modelReturnedSvgText: debugState.gemini.attempts.some(a => a.responseHasSvgField),
          rolesMappedToVectors: lastAppliedRoles.length > 0,
        },
        trace: debugState,
      },
    });
  } catch (error) {
    console.error('[MOS Generate] Unexpected error:', error);
    return res.status(500).json({
      success: false,
      traceId,
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
