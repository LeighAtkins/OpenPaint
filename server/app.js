import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

if (process.env.NODE_ENV === 'production') {
  dotenv.config({ path: '.env' });
} else {
  dotenv.config({ path: '.env.local', override: false });
  dotenv.config({ path: '.env.development', override: false });
  dotenv.config({ path: '.env', override: false });
}

const { registerR2Routes } = await import('./r2-routes.js');
const { isR2Configured, createPresignedUploadUrl, getR2PublicUrl } =
  await import('./r2-storage.js');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// MOS / Gemini env vars
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || '').trim();
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

// Helper functions for wallet/auth
let supabaseAdmin = null;

function getSupabaseAdmin() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  if (!supabaseAdmin) {
    supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  }
  return supabaseAdmin;
}

function isSupabaseAdminConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function getBearerToken(req) {
  const authHeader = String(req.headers?.authorization || '');
  if (!authHeader.toLowerCase().startsWith('bearer ')) return null;
  return authHeader.slice(7).trim() || null;
}

async function getCloudAuthUser(req, operation = 'bootstrap') {
  if (!isSupabaseAdminConfigured()) {
    return { user: null };
  }

  const token = getBearerToken(req);
  if (!token) {
    return {
      error: {
        statusCode: 401,
        body: {
          error: { code: 'auth_required', message: 'Authorization bearer token is required' },
        },
      },
    };
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return {
      error: {
        statusCode: 401,
        body: {
          error: {
            code: error?.code || 'invalid_jwt',
            message: error?.message || 'Invalid auth token',
          },
        },
      },
    };
  }

  return { user: data.user };
}

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

function getPublicOrigin(req) {
  const forwardedProto = String(req.get('x-forwarded-proto') || '')
    .split(',')[0]
    .trim();
  const protocol = forwardedProto || req.protocol || 'https';
  return `${protocol}://${req.get('host')}`;
}

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

// Share project API (supports both /api/* and stripped /* paths)
const createShareProjectHandler = async (req, res) => {
  try {
    const { projectData, title = null, shareOptions = {} } = req.body || {};

    if (!projectData || typeof projectData !== 'object') {
      return res.status(400).json({ success: false, message: 'Project data is required' });
    }

    const shareId = crypto.randomBytes(12).toString('hex');
    const editToken = crypto.randomBytes(16).toString('hex');
    const createdAt = new Date().toISOString();
    const expiresAt = shareOptions.expiresAt
      ? new Date(shareOptions.expiresAt).toISOString()
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const shareRecord = {
      id: shareId,
      editToken,
      projectData,
      createdAt,
      expiresAt,
      isPublic: shareOptions.isPublic || false,
      allowEditing: shareOptions.allowEditing || false,
      measurements: shareOptions.measurements || {},
    };

    sharedProjects.set(shareId, shareRecord);

    return res.json({
      success: true,
      shareId,
      editToken,
      shareUrl: `${getPublicOrigin(req)}/shared/${shareId}`,
      expiresAt,
      title,
    });
  } catch (error) {
    console.error('Error creating share link:', error);
    return res.status(500).json({ success: false, message: 'Server error creating share link' });
  }
};

const getSharedProjectHandler = async (req, res) => {
  try {
    const { shareId } = req.params;
    const shareRecord = sharedProjects.get(shareId);

    if (!shareRecord) {
      return res.status(404).json({ success: false, message: 'Shared project not found' });
    }

    if (shareRecord.expiresAt && new Date() > new Date(shareRecord.expiresAt)) {
      sharedProjects.delete(shareId);
      return res.status(410).json({ success: false, message: 'Shared project has expired' });
    }

    return res.json({
      success: true,
      projectData: shareRecord.projectData,
      shareInfo: {
        id: shareRecord.id,
        createdAt: shareRecord.createdAt,
        expiresAt: shareRecord.expiresAt,
        allowEditing: shareRecord.allowEditing,
        measurements: shareRecord.measurements,
      },
    });
  } catch (error) {
    console.error('Error retrieving shared project:', error);
    return res
      .status(500)
      .json({ success: false, message: 'Server error retrieving shared project' });
  }
};

const submitSharedMeasurementsHandler = async (req, res) => {
  try {
    const { shareId } = req.params;
    const { measurements, customerInfo = {} } = req.body || {};

    if (!measurements || typeof measurements !== 'object') {
      return res.status(400).json({ success: false, message: 'Valid measurements are required' });
    }

    const shareRecord = sharedProjects.get(shareId);
    if (!shareRecord) {
      return res.status(404).json({ success: false, message: 'Shared project not found' });
    }

    if (shareRecord.expiresAt && new Date() > new Date(shareRecord.expiresAt)) {
      return res.status(410).json({ success: false, message: 'Shared project has expired' });
    }

    const submissionId = crypto.randomBytes(8).toString('hex');
    const submission = {
      id: submissionId,
      measurements,
      customerInfo,
      submittedAt: new Date().toISOString(),
      shareId,
    };

    if (!Array.isArray(shareRecord.submissions)) {
      shareRecord.submissions = [];
    }
    shareRecord.submissions.push(submission);

    return res.json({
      success: true,
      submissionId,
      message: 'Measurements submitted successfully',
    });
  } catch (error) {
    console.error('Error submitting measurements:', error);
    return res
      .status(500)
      .json({ success: false, message: 'Server error submitting measurements' });
  }
};

const updateSharedProjectHandler = async (req, res) => {
  try {
    const { shareId } = req.params;
    const { editToken, projectData, title = null, shareOptions = {} } = req.body || {};
    const shareRecord = sharedProjects.get(shareId);

    if (!shareRecord) {
      return res.status(404).json({ success: false, message: 'Shared project not found' });
    }

    if (!editToken) {
      return res.status(400).json({ success: false, message: 'editToken is required' });
    }

    if (shareRecord.editToken && shareRecord.editToken !== editToken) {
      return res.status(403).json({ success: false, message: 'Invalid edit token' });
    }

    if (projectData && typeof projectData === 'object') {
      shareRecord.projectData = projectData;
    }
    if (title) {
      shareRecord.title = title;
    }
    if (shareOptions && typeof shareOptions === 'object') {
      shareRecord.measurements = shareOptions.measurements || shareRecord.measurements || {};
      shareRecord.allowEditing =
        typeof shareOptions.allowEditing === 'boolean'
          ? shareOptions.allowEditing
          : shareRecord.allowEditing;
      if (shareOptions.expiresAt) {
        shareRecord.expiresAt = new Date(shareOptions.expiresAt).toISOString();
      }
    }

    return res.json({
      success: true,
      shareId,
      shareUrl: `${getPublicOrigin(req)}/shared/${shareId}`,
      expiresAt: shareRecord.expiresAt,
    });
  } catch (error) {
    console.error('Error updating shared project:', error);
    return res
      .status(500)
      .json({ success: false, message: 'Server error updating shared project' });
  }
};

app.post('/api/share-project', createShareProjectHandler);
app.post('/share-project', createShareProjectHandler);
app.get('/api/shared/:shareId', getSharedProjectHandler);
app.get('/shared/:shareId', getSharedProjectHandler);
app.post('/api/shared/:shareId/measurements', submitSharedMeasurementsHandler);
app.post('/shared/:shareId/measurements', submitSharedMeasurementsHandler);
app.patch('/api/shared/:shareId', updateSharedProjectHandler);
app.patch('/shared/:shareId', updateSharedProjectHandler);

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

    /** Walk from startIdx (just past the opening <g ...>) to find the matching </g>, handling nesting. */
    const extractGroupBody = (svgText, startIdx) => {
      let depth = 1;
      let i = startIdx;
      while (i < svgText.length && depth > 0) {
        if (svgText.startsWith('<g', i) && /^<g[\s>]/.test(svgText.slice(i, i + 3))) depth++;
        else if (svgText.startsWith('</g>', i)) depth--;
        if (depth > 0) i++;
        else break;
      }
      return svgText.slice(startIdx, i);
    };

    const ROLE_SEMANTICS = {
      // Front view - A series (widths and heights along back/seat)
      A1: 'top rail / back width',
      A2: 'seat rail width',
      A3: 'back height (seat to top rail)',
      A4: 'lower frame width',
      A5: 'additional front height',
      // Front view - B series (arm connectors, typically diagonal)
      B1: 'inner arm connector (left)',
      B2: 'outer arm connector (right)',
      // Front view - C series (arm/cushion heights)
      C1: 'arm top width (right)',
      C2: 'arm mid width (right)',
      C3: 'arm height (right)',
      C4: 'leg height (front right)',
      C5: 'additional arm/cushion dimension',
      // Front view - D series (overall dimensions)
      D: 'overall width at base',
      D1: 'depth dimension 1',
      D2: 'depth dimension 2',
      D3: 'depth dimension 3',
      // Front view - E series (curves)
      E1: 'arm curve / roll profile',
      E2: 'arm curve secondary',
      // Back view - F/G/H/J/L series
      F1: 'back panel width 1',
      F2: 'back panel width 2',
      F3: 'back panel width 3',
      F5: 'back panel width 5',
      F6: 'back panel width 6',
      G: 'back rail width',
      G1: 'back cross-member 1',
      G2: 'back cross-member 2',
      H1: 'back frame height 1',
      H2: 'back frame height 2',
      H3: 'back frame height 3',
      J1: 'back pillar height 1',
      J2: 'back pillar height 2',
      J3: 'back pillar height 3',
      L1: 'leg span 1',
      L2: 'leg span 2',
      L3: 'leg span 3',
      L4: 'leg span 4',
      L5: 'leg span 5',
      L7: 'leg span 7',
      L8: 'leg span 8',
      // Side view additions
      A6: 'side height 6',
      A7: 'side height 7',
      E3: 'arm curve 3',
      E4: 'arm curve 4',
      F: 'frame height (front)',
      F4: 'frame height 4',
      G3: 'seat depth 3',
      G4: 'seat depth 4',
      G5: 'seat depth 5',
      G6: 'seat depth 6',
      G7: 'seat depth 7',
      G8: 'seat depth 8',
      H4: 'arm height 4',
      H5: 'arm height 5',
      H6: 'arm height 6',
      H7: 'arm height 7',
      // Modular sections
      M1: 'module width 1',
      M2: 'module width 2',
      M3: 'module width 3',
      M4: 'module width 4',
      M5: 'module width 5',
      M6: 'module width 6',
      M7: 'module width 7',
      // Simple products (cushions, ottomans)
      W: 'width',
      H: 'height',
      W1: 'width (top)',
      W2: 'width (bottom)',
      T: 'thickness',
      X: 'cushion inset',
      Y: 'cushion length',
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

      const openTagRegex = /<g\b[^>]*\sid="([^"]+)"[^>]*>/gi;
      let groupMatch;
      while ((groupMatch = openTagRegex.exec(svgText)) !== null) {
        const groupId = String(groupMatch[1] || '').trim();
        const role = roleTokenFromId(groupId);
        if (!role || !selectedRoles.includes(role) || hints.has(role)) continue;
        const body = extractGroupBody(svgText, groupMatch.index + groupMatch[0].length);

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

      const openTagRegex = /<g\b[^>]*\bid="([^"]+)"[^>]*>/gi;
      const rawOps = [];
      let groupMatch;
      while ((groupMatch = openTagRegex.exec(svgText)) !== null) {
        const groupId = String(groupMatch[1] || '').trim();
        const role = roleTokenFromId(groupId);
        if (!role || !selectedRoles.includes(role)) continue;

        const groupBody = extractGroupBody(svgText, groupMatch.index + groupMatch[0].length);

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
          const orientationPenalty = c.orientation === anchor.orientation ? 0 : 80;
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

    const describeRegion = (mx, my) => {
      const col = mx < 333 ? 'left' : mx < 667 ? 'center' : 'right';
      const row = my < 333 ? 'top' : my < 667 ? 'middle' : 'bottom';
      return `${row}-${col}`;
    };

    const buildRichTemplateContext = (svgText, selectedRoles, geometryHints) => {
      if (!svgText || typeof svgText !== 'string' || !selectedRoles?.length) return '';

      const templateOps = extractGroupOpsFromSvg(svgText, selectedRoles);
      if (!templateOps.length) return '';

      const lines = ['TEMPLATE ROLES:'];
      for (const op of templateOps) {
        const mx = Math.round((op.x1 + op.x2) / 2);
        const my = Math.round((op.y1 + op.y2) / 2);
        const region = describeRegion(mx, my);
        const geoType = geometryHints?.get(op.role) || `${classifyOrientation(op)} line`;
        const sem = ROLE_SEMANTICS[op.role] || '';
        const semStr = sem ? ` \u2014 ${sem}` : '';
        lines.push(`  ${op.role}: ${geoType}, ${region} region${semStr}`);
      }
      return lines.join('\n');
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
    const effectiveRoles = effectiveRolesRaw.slice(0, 16);
    debugState.pipeline.selectedRoles = [...effectiveRoles];
    debugState.pipeline.templateRoles = [...templateRoles];
    const roleGeometryHints = parseRoleGeometryHints(referenceSvgText, effectiveRoles);
    const richTemplateContext = buildRichTemplateContext(
      referenceSvgText,
      effectiveRoles,
      roleGeometryHints
    );
    const templateRoleMap = parseTemplateRoleMap(referenceSvgText);
    const roleAnchors = buildRoleAnchorsFromTemplate(referenceSvgText, effectiveRoles);

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

COORDINATE SPACE: 0\u20131000 on both axes (normalised to image dimensions).

${richTemplateContext}

RULES:
1. Return one op per requested role. Allowed roles: ${rolesStr}
2. Each op has {role, x1, y1, x2, y2} in [0, 1000].
3. Analyse the photo to find where each physical feature is located.
4. Coordinates MUST match the actual feature position and angle in the photo — do NOT copy template coordinates.
5. Use template data only as a guide for which roles to measure and their general meaning.
6. Diagonal and curved roles should follow the actual angle/curve of the feature in the photo.
7. Lines MUST NOT be zero-length.
8. Do not add extra roles beyond those listed.

Return ONLY a JSON object with this exact structure:
{
  "ops": [
    {"role":"A1","x1":120,"y1":700,"x2":890,"y2":700}
  ]
}`;
      fallbackPrompt = `You are a measurement overlay generator for product images.
Your task is to analyse the provided image and return measurement line geometry ops.

COORDINATE SPACE: 0\u20131000 on both axes.
Allowed roles: ${rolesStr}

RULES:
1. Return JSON with key "ops" only.
2. Each op has {role, x1, y1, x2, y2} in [0, 1000].
3. No zero-length lines.
4. Place each line where the corresponding physical feature appears in the photo.

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
      const timeoutMs = process.env.VERCEL ? 50000 : 55000;
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

// ── Wallet & Pets System ─────────────────────────────────────────────────────
// NOTE: Routes defined WITHOUT /api prefix because Vercel strips /api from requests

const COINS_PER_REWARD = 5;
const DAILY_COIN_CAP = 100;
const EARN_COOLDOWN_MS = 5 * 60 * 1000;

const MIN_DRAWN_MARKS_FOR_REWARD = 1;
const MIN_NEW_MARKS_FOR_REWARD = 2;

function countArray(value) {
  return Array.isArray(value) ? value.length : 0;
}

function countMetadataBucketEntries(bucket) {
  if (!bucket || typeof bucket !== 'object') return 0;
  let total = 0;
  for (const key of Object.keys(bucket)) {
    total += countArray(bucket[key]);
  }
  return total;
}

function countCanvasDrawObjects(canvasJSON) {
  const objects = Array.isArray(canvasJSON?.objects) ? canvasJSON.objects : [];
  let total = 0;
  for (const obj of objects) {
    const type = String(obj?.type || '').toLowerCase();
    if (!type) continue;
    if (type === 'image') continue;
    total += 1;
  }
  return total;
}

function getSaveQualification(projectData) {
  if (!projectData || typeof projectData !== 'object') {
    return { qualifying: true, hasImage: true, drawnMarks: MIN_DRAWN_MARKS_FOR_REWARD };
  }

  const views = projectData.views || {};
  const viewKeys = Object.keys(views);

  const hasImage = viewKeys.some(k => {
    const v = views[k];
    return Boolean(
      v &&
      (v.image ||
        v.backgroundImage ||
        v.imageData ||
        v.imageUrl ||
        v.imageDataURL ||
        v.canvasJSON?.backgroundImage?.src)
    );
  });

  const drawnMarks = viewKeys.reduce((sum, k) => {
    const v = views[k] || {};
    const legacyStrokes = countArray(v.vectorStrokes) + countArray(v.lineStrokes);
    const metadataStrokes = countMetadataBucketEntries(v.metadata?.vectorStrokesByImage);
    const metadataLines =
      countMetadataBucketEntries(v.metadata?.lineStrokesByImage) +
      countMetadataBucketEntries(v.metadata?.strokeSequenceByImage);
    const canvasObjects = countCanvasDrawObjects(v.canvasJSON);
    return sum + legacyStrokes + metadataStrokes + metadataLines + canvasObjects;
  }, 0);

  return {
    qualifying: hasImage && drawnMarks >= MIN_DRAWN_MARKS_FOR_REWARD,
    hasImage,
    drawnMarks,
  };
}

function parseRewardIdempotencyKey(idempotencyKey) {
  const raw = String(idempotencyKey || '');
  if (!raw) return null;

  const pipe = raw.split('|');
  if (pipe.length >= 6 && pipe[0] === 'reward') {
    const rewardType = pipe[1];
    const projectId = pipe[3] || '';
    const drawnMarks = Number(pipe[5]);
    return {
      rewardType,
      projectId,
      drawnMarks: Number.isFinite(drawnMarks) ? drawnMarks : null,
    };
  }

  const legacy = raw.split(':');
  if (legacy.length >= 3) {
    return {
      rewardType: 'cloud_save',
      projectId: legacy[1] || '',
      drawnMarks: null,
    };
  }

  return null;
}

function buildRewardIdempotencyKey(userId, rewardType, projectId, saveTimestamp, drawnMarks) {
  const safeProjectId = String(projectId || 'unknown');
  const safeTimestamp = String(saveTimestamp || new Date().toISOString());
  const marks = Number.isFinite(Number(drawnMarks)) ? String(Number(drawnMarks)) : '0';
  return `reward|${rewardType}|${userId}|${safeProjectId}|${safeTimestamp}|${marks}`;
}

const PET_CATALOG = [
  { id: 'cat-1', name: 'Tabby Cat', type: 'cat', cost: 50 },
  { id: 'cat-2', name: 'Tuxedo Cat', type: 'cat', cost: 50 },
  { id: 'cat-3', name: 'Ginger Cat', type: 'cat', cost: 75 },
  { id: 'cat-4', name: 'Siamese Cat', type: 'cat', cost: 75 },
  { id: 'cat-5', name: 'Calico Cat', type: 'cat', cost: 100 },
  { id: 'cat-6', name: 'Black Cat', type: 'cat', cost: 100 },
  { id: 'dog-1', name: 'Golden Retriever', type: 'dog', cost: 50 },
  { id: 'dog-2', name: 'Akita', type: 'dog', cost: 50 },
  { id: 'dog-3', name: 'Great Dane', type: 'dog', cost: 75 },
  { id: 'dog-4', name: 'Schnauzer', type: 'dog', cost: 75 },
  { id: 'dog-5', name: 'Saint Bernard', type: 'dog', cost: 100 },
  { id: 'dog-6', name: 'Siberian Husky', type: 'dog', cost: 100 },
];

async function getWalletRequestContext(req, res, operation) {
  const authResult = await getCloudAuthUser(req, operation);
  if (authResult.error) {
    res.status(authResult.error.statusCode).json(authResult.error.body);
    return null;
  }

  const userId = authResult.user?.id || null;
  const supabase = getSupabaseAdmin();
  if (!userId || !supabase) {
    res.status(503).json({
      success: false,
      message: 'Wallet service unavailable',
    });
    return null;
  }

  return { userId, supabase };
}

// GET /wallet — returns balance, equipped pet, unlocked pets, catalog
const handleWalletGet = async (req, res) => {
  try {
    const context = await getWalletRequestContext(req, res, 'wallet');
    if (!context) return;
    const { userId, supabase } = context;

    const { data: wallet } = await supabase
      .from('wallets')
      .select('balance, equipped_pet')
      .eq('user_id', userId)
      .maybeSingle();

    let balance = 0;
    let equippedPet = null;

    if (wallet) {
      balance = wallet.balance;
      equippedPet = wallet.equipped_pet;
    } else {
      await supabase.from('wallets').insert({ user_id: userId, balance: 0 });
    }

    const { data: pets } = await supabase
      .from('pet_inventory')
      .select('pet_id')
      .eq('user_id', userId);

    return res.json({
      success: true,
      balance,
      equippedPet,
      unlockedPets: (pets || []).map(p => p.pet_id),
      catalog: PET_CATALOG,
    });
  } catch (error) {
    console.error('[Wallet] GET error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load wallet' });
  }
};
app.get('/wallet', handleWalletGet);
app.get('/api/wallet', handleWalletGet);

// POST /wallet/earn — earn coins on qualifying cloud save
const handleWalletEarn = async (req, res) => {
  try {
    const context = await getWalletRequestContext(req, res, 'wallet_earn');
    if (!context) return;
    const { userId, supabase } = context;
    const { projectId, saveTimestamp, projectData, rewardType = 'cloud_save' } = req.body;

    if (!projectId || !saveTimestamp) {
      return res
        .status(400)
        .json({ success: false, message: 'projectId and saveTimestamp required' });
    }

    const effectiveRewardType = rewardType === 'pdf_export' ? 'pdf_export' : 'cloud_save';

    const { data: wallet } = await supabase
      .from('wallets')
      .select('balance')
      .eq('user_id', userId)
      .maybeSingle();

    if (!wallet) {
      await supabase.from('wallets').insert({ user_id: userId, balance: 0 });
    }

    let qualification = { qualifying: true, hasImage: true, drawnMarks: 0 };
    if (effectiveRewardType === 'cloud_save') {
      qualification = getSaveQualification(projectData);
      if (!qualification.qualifying) {
        return res.json({
          success: true,
          earned: 0,
          balance: wallet?.balance || 0,
          reason: 'not_qualifying',
          rewardType: effectiveRewardType,
          debug: {
            hasImage: qualification.hasImage,
            drawnMarks: qualification.drawnMarks,
            minDrawnMarks: MIN_DRAWN_MARKS_FOR_REWARD,
          },
        });
      }
    }

    const { data: lastTx } = await supabase
      .from('coin_transactions')
      .select('created_at')
      .eq('user_id', userId)
      .eq('reason', effectiveRewardType)
      .gt('amount', 0)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastTx) {
      const elapsed = Date.now() - new Date(lastTx.created_at).getTime();
      if (elapsed < EARN_COOLDOWN_MS) {
        return res.json({
          success: true,
          earned: 0,
          balance: wallet?.balance || 0,
          reason: effectiveRewardType === 'pdf_export' ? 'pdf_cooldown' : 'cooldown',
          rewardType: effectiveRewardType,
        });
      }
    }

    if (effectiveRewardType === 'cloud_save') {
      const { data: recentProjectTxs } = await supabase
        .from('coin_transactions')
        .select('idempotency_key')
        .eq('user_id', userId)
        .eq('reason', 'cloud_save')
        .gt('amount', 0)
        .order('created_at', { ascending: false })
        .limit(200);

      let previousMarks = null;
      for (const tx of recentProjectTxs || []) {
        const parsed = parseRewardIdempotencyKey(tx?.idempotency_key);
        if (parsed?.projectId === projectId) {
          previousMarks = parsed.drawnMarks;
          break;
        }
      }

      if (Number.isFinite(previousMarks)) {
        const addedMarks = qualification.drawnMarks - previousMarks;
        if (addedMarks < MIN_NEW_MARKS_FOR_REWARD) {
          return res.json({
            success: true,
            earned: 0,
            balance: wallet?.balance || 0,
            reason: 'insufficient_new_marks',
            rewardType: effectiveRewardType,
            debug: {
              drawnMarks: qualification.drawnMarks,
              previousDrawnMarks: previousMarks,
              addedMarks,
              minAddedMarks: MIN_NEW_MARKS_FOR_REWARD,
            },
          });
        }
      }
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const { data: todayTxs } = await supabase
      .from('coin_transactions')
      .select('amount')
      .eq('user_id', userId)
      .gt('amount', 0)
      .gte('created_at', todayStart.toISOString());

    const todayTotal = (todayTxs || []).reduce((s, t) => s + t.amount, 0);
    if (todayTotal >= DAILY_COIN_CAP) {
      return res.json({
        success: true,
        earned: 0,
        balance: wallet?.balance || 0,
        reason: 'daily_cap',
      });
    }

    const idempotencyKey = buildRewardIdempotencyKey(
      userId,
      effectiveRewardType,
      projectId,
      saveTimestamp,
      qualification.drawnMarks
    );
    const { error: txError } = await supabase.from('coin_transactions').insert({
      user_id: userId,
      amount: COINS_PER_REWARD,
      reason: effectiveRewardType,
      idempotency_key: idempotencyKey,
    });

    if (txError) {
      if (txError.code === '23505') {
        return res.json({
          success: true,
          earned: 0,
          balance: wallet?.balance || 0,
          reason: 'already_earned',
          rewardType: effectiveRewardType,
        });
      }
      throw txError;
    }

    await supabase.rpc('increment_wallet_balance', {
      p_user_id: userId,
      p_amount: COINS_PER_REWARD,
    });

    const { data: updated } = await supabase
      .from('wallets')
      .select('balance')
      .eq('user_id', userId)
      .single();

    return res.json({
      success: true,
      earned: COINS_PER_REWARD,
      balance: updated?.balance || 0,
      rewardType: effectiveRewardType,
    });
  } catch (error) {
    console.error('[Wallet] Earn error:', error);
    return res.status(500).json({ success: false, message: 'Failed to earn coins' });
  }
};
app.post('/wallet/earn', handleWalletEarn);
app.post('/api/wallet/earn', handleWalletEarn);

// POST /wallet/spend — purchase a pet
const handleWalletSpend = async (req, res) => {
  try {
    const context = await getWalletRequestContext(req, res, 'wallet_spend');
    if (!context) return;
    const { userId, supabase } = context;
    const { petId } = req.body;

    if (!petId) {
      return res.status(400).json({ success: false, message: 'petId is required' });
    }

    const catalogEntry = PET_CATALOG.find(p => p.id === petId);
    if (!catalogEntry) {
      return res.status(400).json({ success: false, message: 'Invalid petId' });
    }

    const { data: existing } = await supabase
      .from('pet_inventory')
      .select('pet_id')
      .eq('user_id', userId)
      .eq('pet_id', petId)
      .maybeSingle();

    if (existing) {
      return res.status(400).json({ success: false, message: 'Pet already owned' });
    }

    const { data: deducted } = await supabase.rpc('decrement_wallet_balance', {
      p_user_id: userId,
      p_amount: catalogEntry.cost,
    });

    if (!deducted) {
      return res.status(400).json({ success: false, message: 'Insufficient balance' });
    }

    await supabase.from('coin_transactions').insert({
      user_id: userId,
      amount: -catalogEntry.cost,
      reason: `purchase_pet:${petId}`,
    });

    await supabase.from('pet_inventory').insert({ user_id: userId, pet_id: petId });

    const { data: wallet } = await supabase
      .from('wallets')
      .select('balance')
      .eq('user_id', userId)
      .single();

    return res.json({ success: true, petId, balance: wallet?.balance || 0 });
  } catch (error) {
    console.error('[Wallet] Spend error:', error);
    return res.status(500).json({ success: false, message: 'Failed to purchase pet' });
  }
};
app.post('/wallet/spend', handleWalletSpend);
app.post('/api/wallet/spend', handleWalletSpend);

// POST /pets/equip — equip or unequip a pet
const handlePetEquip = async (req, res) => {
  try {
    const context = await getWalletRequestContext(req, res, 'pets_equip');
    if (!context) return;
    const { userId, supabase } = context;
    const { petId } = req.body;

    if (petId) {
      const { data: owned } = await supabase
        .from('pet_inventory')
        .select('pet_id')
        .eq('user_id', userId)
        .eq('pet_id', petId)
        .maybeSingle();

      if (!owned) {
        return res.status(400).json({ success: false, message: 'Pet not owned' });
      }
    }

    await supabase
      .from('wallets')
      .update({ equipped_pet: petId || null, updated_at: new Date().toISOString() })
      .eq('user_id', userId);

    return res.json({ success: true, equippedPet: petId || null });
  } catch (error) {
    console.error('[Pets] Equip error:', error);
    return res.status(500).json({ success: false, message: 'Failed to equip pet' });
  }
};
app.post('/pets/equip', handlePetEquip);
app.post('/api/pets/equip', handlePetEquip);

// Test endpoint to verify API is working
app.get('/api/test', (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

// Simple wallet test that doesn't require auth
const handleWalletTest = (req, res) => {
  res.json({ ok: true, wallet: 'working' });
};
app.get('/wallet-test', handleWalletTest);
app.get('/api/wallet-test', handleWalletTest);

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
