import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { registerR2Routes } from './r2-routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
