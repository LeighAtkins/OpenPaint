/**
 * Main application server for OpenPaint
 * Handles file operations, static file serving, and API endpoints
 */

import dotenv from 'dotenv';
if (process.env.NODE_ENV === 'production') {
  dotenv.config({ path: '.env' });
} else {
  dotenv.config({ path: '.env.local', override: false });
  dotenv.config({ path: '.env.development', override: false });
  dotenv.config({ path: '.env', override: false });
}
import express from 'express';
import path from 'path';
import multer from 'multer';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import {
  isDbConfigured,
  ensureSchema,
  createOrUpdateProject,
  getProjectBySlug,
} from './server/db.js';
import cwMeasurementsHandler from './api/integrations/cw/measurements/[formId].js';
import measurementGuideCodesHandler from './api/measurement-guides/codes.js';
import measurementGuideSvgHandler from './api/measurement-guides/svg.js';
import { spawn } from 'child_process';
import { createClient } from '@supabase/supabase-js';
const { registerR2Routes } = await import('./server/r2-routes.js');
const { isR2Configured, createPresignedUploadUrl, getR2PublicUrl } =
  await import('./server/r2-storage.js');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

function getPublicOrigin(req) {
  const forwardedProto = String(req.get('x-forwarded-proto') || '')
    .split(',')[0]
    .trim();
  const protocol = forwardedProto || req.protocol || 'https';
  return `${protocol}://${req.get('host')}`;
}

// AI Worker configuration with startup logging
const AI_WORKER_URL = (process.env.AI_WORKER_URL || 'http://localhost:8787')
  .replace(/^\s*-\s*/, '') // strip accidental "- "
  .trim();
const AI_WORKER_KEY = (process.env.AI_WORKER_KEY || '').trim();
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const CLOUDINARY_CLOUD_NAME = (process.env.CLOUDINARY_CLOUD_NAME || '').trim();
const CLOUDINARY_UPLOAD_PRESET = (process.env.CLOUDINARY_UPLOAD_PRESET || '').trim();
const CLOUDINARY_UPLOAD_FOLDER = (process.env.CLOUDINARY_UPLOAD_FOLDER || '').trim();

// Cloudflare Images configuration
const CF_ACCOUNT_ID = (process.env.CF_ACCOUNT_ID || '').trim();
const CF_IMAGES_API_TOKEN = (process.env.CF_IMAGES_API_TOKEN || '').trim();
const CF_ACCOUNT_HASH = (process.env.CF_ACCOUNT_HASH || '').trim();

console.log('[AI Relay] Using AI_WORKER_URL:', JSON.stringify(AI_WORKER_URL));
console.log('[AI Relay] Has KEY:', AI_WORKER_KEY ? 'yes' : 'no');
console.log('[Cloudflare Images] Account ID:', CF_ACCOUNT_ID ? 'configured' : 'missing');
console.log('[Cloudflare Images] API Token:', CF_IMAGES_API_TOKEN ? 'configured' : 'missing');
console.log('[Cloudflare Images] Account Hash:', CF_ACCOUNT_HASH ? 'configured' : 'missing');

// Supabase client configuration (public env fallback)
const SUPABASE_CLIENT_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY =
  process.env.VITE_SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
let supabaseClient = null;

if (SUPABASE_CLIENT_URL && SUPABASE_SERVICE_KEY) {
  supabaseClient = createClient(SUPABASE_CLIENT_URL, SUPABASE_SERVICE_KEY);
  console.log('[Supabase] Client initialized');
} else {
  console.warn('[Supabase] Missing URL or key, Supabase features disabled');
}

function joinUrl(base, path) {
  return `${String(base).replace(/\/+$/, '')}/${String(path).replace(/^\/+/, '')}`;
}

function parseSetCookie(setCookieHeaders = []) {
  const jar = {};
  setCookieHeaders.forEach(value => {
    if (!value || typeof value !== 'string') return;
    const [pair] = value.split(';');
    const eqIndex = pair.indexOf('=');
    if (eqIndex <= 0) return;
    const name = pair.slice(0, eqIndex).trim();
    const cookieValue = pair.slice(eqIndex + 1).trim();
    if (!name) return;
    jar[name] = cookieValue;
  });
  return jar;
}

function mergeCookieJar(target, incoming) {
  Object.entries(incoming || {}).forEach(([name, value]) => {
    target[name] = value;
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
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }
  const single = headers.get?.('set-cookie');
  if (!single) return [];
  return [single];
}

async function createCwSession(credentialsOverride = {}) {
  const baseUrl = (
    credentialsOverride.baseUrl ||
    process.env.CW_BASE_URL ||
    'https://cw40.comfort-works.com'
  ).trim();
  const username = (credentialsOverride.username || process.env.CW_USERNAME || '').trim();
  const password = (credentialsOverride.password || process.env.CW_PASSWORD || '').trim();

  if (!username || !password) {
    const err = new Error('Missing CW_USERNAME or CW_PASSWORD');
    err.code = 'CW_MISSING_CREDENTIALS';
    throw err;
  }

  const jar = {};
  const loginPageUrl = joinUrl(baseUrl, '/dashboard/login/');

  const loginPageRes = await fetch(loginPageUrl, {
    method: 'GET',
    redirect: 'manual',
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'user-agent': 'OpenPaint CW Relay/1.0',
    },
  });

  mergeCookieJar(jar, parseSetCookie(getSetCookieArray(loginPageRes.headers)));
  const csrfToken = jar.csrftoken;
  if (!csrfToken) {
    const err = new Error('Unable to obtain CSRF token from login page');
    err.code = 'CW_CSRF_MISSING';
    throw err;
  }

  const loginForm = new URLSearchParams();
  loginForm.set('csrfmiddlewaretoken', csrfToken);
  loginForm.set('username', username);
  loginForm.set('password', password);
  loginForm.set('next', '');

  const loginRes = await fetch(loginPageUrl, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'content-type': 'application/x-www-form-urlencoded',
      cookie: buildCookieHeader(jar),
      origin: baseUrl,
      referer: loginPageUrl,
      'user-agent': 'OpenPaint CW Relay/1.0',
    },
    body: loginForm.toString(),
  });

  mergeCookieJar(jar, parseSetCookie(getSetCookieArray(loginRes.headers)));

  const loginStatus = loginRes.status;
  const loginLocation = loginRes.headers.get('location') || '';
  const success = loginStatus === 302 || loginStatus === 301;

  if (!success || !jar.sessionid) {
    const bodyText = await loginRes.text().catch(() => '');
    const err = new Error('CW login failed');
    err.code = 'CW_LOGIN_FAILED';
    err.details = {
      status: loginStatus,
      location: loginLocation,
      hasSessionId: Boolean(jar.sessionid),
      bodySnippet: bodyText.slice(0, 500),
    };
    throw err;
  }

  return {
    baseUrl,
    cookieJar: jar,
    csrfToken: jar.csrftoken || csrfToken,
  };
}

async function submitCwMeasureForm({ formId, payload, credentialsOverride = {} }) {
  const session = await createCwSession(credentialsOverride);
  const targetUrl = joinUrl(
    session.baseUrl,
    `/order-management/measure-tool/measure-form/save-measure-form/${encodeURIComponent(formId)}/`
  );

  const bodyPayload =
    payload && typeof payload === 'object'
      ? { ...payload, form_ID: String(payload.form_ID || formId) }
      : { form_ID: String(formId) };

  const response = await fetch(targetUrl, {
    method: 'POST',
    headers: {
      accept: '*/*',
      'content-type': 'text/plain;charset=UTF-8',
      cookie: buildCookieHeader(session.cookieJar),
      origin: session.baseUrl,
      referer: joinUrl(session.baseUrl, '/dashboard/'),
      'x-csrftoken': session.csrfToken,
      'x-requested-with': 'XMLHttpRequest',
      'user-agent': 'OpenPaint CW Relay/1.0',
    },
    body: JSON.stringify(bodyPayload),
  });

  const rawText = await response.text().catch(() => '');
  let parsedBody = null;
  try {
    parsedBody = rawText ? JSON.parse(rawText) : null;
  } catch {
    parsedBody = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    body: parsedBody || rawText,
    rawText,
  };
}

// In-memory storage for shared projects (in production, use a database)
const sharedProjects = new Map();
const cloudProjects = new Map();
const cloudProjectAssets = new Map();
// In-memory storage for projects (used by /api/projects/* routes)
const projects = new Map();

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
        body: makeCloudErrorResponse(
          operation,
          { code: 'auth_required', message: 'Authorization bearer token is required' },
          401
        ),
      },
    };
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return {
      error: {
        statusCode: 401,
        body: makeCloudErrorResponse(
          operation,
          { code: error?.code || 'invalid_jwt', message: error?.message || 'Invalid auth token' },
          401
        ),
      },
    };
  }

  return { user: data.user };
}

function getCloudProjectOwnerId(record) {
  return record?.data?._meta?.ownerId || null;
}

function canAccessCloudProject(record, userId) {
  if (!isSupabaseAdminConfigured()) return true;
  if (!userId) return false;
  const ownerId = getCloudProjectOwnerId(record);
  if (!ownerId) return true;
  return ownerId === userId;
}

function createEmptyCloudSyncState() {
  return {
    manifest: {
      manifestVersion: 1,
      updatedAt: new Date().toISOString(),
      viewOrder: [],
      views: {},
      metadata: {},
    },
    viewStates: {},
    assets: {},
  };
}

function ensureCloudSyncState(record) {
  if (!record || typeof record !== 'object') return createEmptyCloudSyncState();
  const data = record.data && typeof record.data === 'object' ? record.data : {};
  const manifest = data.manifest && typeof data.manifest === 'object' ? data.manifest : {};
  return {
    manifest: {
      manifestVersion: Number(manifest.manifestVersion) || 1,
      updatedAt: manifest.updatedAt || new Date().toISOString(),
      viewOrder: Array.isArray(manifest.viewOrder) ? manifest.viewOrder : [],
      views: manifest.views && typeof manifest.views === 'object' ? manifest.views : {},
      metadata: manifest.metadata && typeof manifest.metadata === 'object' ? manifest.metadata : {},
    },
    viewStates: data.viewStates && typeof data.viewStates === 'object' ? data.viewStates : {},
    assets: data.assets && typeof data.assets === 'object' ? data.assets : {},
  };
}

function makeCloudOperationResponse(operation, payload = {}) {
  return {
    status: 'ok',
    operation,
    requestId: crypto.randomBytes(8).toString('hex'),
    timestamp: new Date().toISOString(),
    data: payload,
  };
}

function makeCloudErrorResponse(operation, error, statusCode = 500) {
  return {
    status: 'error',
    operation,
    statusCode,
    requestId: crypto.randomBytes(8).toString('hex'),
    timestamp: new Date().toISOString(),
    error,
  };
}

async function getCloudProjectRecord(projectId) {
  if (isSupabaseAdminConfigured()) {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('cloud_projects')
      .select('*')
      .eq('id', projectId)
      .single();
    if (error) return { error };
    return { record: data };
  }

  return { record: cloudProjects.get(projectId) || null };
}

async function persistCloudProjectRecord(projectId, updatedRecord) {
  if (isSupabaseAdminConfigured()) {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from('cloud_projects')
      .update({
        title: updatedRecord.title,
        data: updatedRecord.data,
        expires_at: updatedRecord.expires_at,
        updated_at: updatedRecord.updated_at,
      })
      .eq('id', projectId);
    if (error) return { error };
    return { ok: true };
  }

  cloudProjects.set(projectId, updatedRecord);
  return { ok: true };
}

// Ensure uploads directory exists
// In serverless environments (Vercel), use /tmp as it's the only writable directory
const isVercelServerless = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME;
const uploadDir = isVercelServerless ? '/tmp/uploads' : path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  console.log('Created uploads directory:', uploadDir);
}

// Set up multer for handling file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Use a timestamp to ensure unique filenames
    cb(null, Date.now() + '-' + file.originalname);
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB limit
});

// Middleware setup
// IMPORTANT: Handle index.html FIRST via catch-all route to prevent static middleware from serving cached version
// This must be BEFORE static middleware
app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  // Read and inject environment variables into index.html
  const indexPath = path.join(__dirname, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');

  // Inject window.__ENV with public Supabase config (anon key only, not service key)
  const envScript = `<script>
    window.__ENV = {
      VITE_SUPABASE_URL: "${process.env.VITE_SUPABASE_URL || ''}",
      VITE_SUPABASE_ANON_KEY: "${process.env.VITE_SUPABASE_ANON_KEY || ''}"
    };
  </script>`;

  // Insert before closing </head> tag
  html = html.replace('</head>', `${envScript}\n</head>`);

  res.send(html);
});

// Serve static files from public directory
app.use(express.static('public'));
// Serve static files from root directory (but index.html is handled by route above)
app.use(express.static('./'));
// Serve uploaded files under /uploads
app.use('/uploads', express.static(uploadDir));
// Parse JSON request bodies (increase limit for large projects)
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ extended: true, limit: '200mb' }));

registerR2Routes(app, '/api/storage/r2');

// Route handlers
app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

app.get('/version', (req, res) => {
  res.json({ commit: process.env.VERCEL_GIT_COMMIT_SHA || null, ts: Date.now() });
});

app.post('/ai/echo', (req, res) => {
  res.json({ got: Object.keys(req.body || {}), sample: req.body?.imageUrl || null });
});

app.get('/env-check', (req, res) => {
  res.json({
    AI_WORKER_URL: (process.env.AI_WORKER_URL || '').trim(),
    HAS_AI_WORKER_KEY: Boolean((process.env.AI_WORKER_KEY || '').trim()),
    ROUTES_MOUNTED: true,
  });
});

// Minimal test endpoint to check if Express works at all
app.get('/test', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============== PROJECT CRUD API ROUTES ==============

// API Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/api/pdf/render', async (req, res) => {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  res.setHeader('X-Pdf-Request-Id', requestId);
  try {
    const [
      { pdfRenderRequestSchema, sanitizePdfFilename },
      { renderPdfFromRequest, resolvePdfRendererMode },
    ] = await Promise.all([import('./server/pdf/schema.js'), import('./server/pdf/service.js')]);

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
});

// Save project
app.post('/api/projects/save', (req, res) => {
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

// Load project by ID
app.get('/api/projects/:projectId', (req, res) => {
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

// List all projects
app.get('/api/projects', (req, res) => {
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

// Cloudinary config for unsigned uploads
app.get('/api/cloudinary/config', (req, res) => {
  return res.json({
    success: Boolean(CLOUDINARY_CLOUD_NAME && CLOUDINARY_UPLOAD_PRESET),
    cloudName: CLOUDINARY_CLOUD_NAME || null,
    uploadPreset: CLOUDINARY_UPLOAD_PRESET || null,
    folder: CLOUDINARY_UPLOAD_FOLDER || null,
  });
});

// Cloud project save/load via Supabase (anyone-with-link)
app.post('/api/cloud-projects', async (req, res) => {
  try {
    const authResult = await getCloudAuthUser(req, 'save');
    if (authResult.error) {
      return res.status(authResult.error.statusCode).json(authResult.error.body);
    }

    const authUserId = authResult.user?.id || null;
    const { projectData, title = null, expiresAt = null } = req.body || {};
    if (!projectData || typeof projectData !== 'object') {
      return res.status(400).json({ success: false, message: 'Project data is required' });
    }

    const projectId = crypto.randomBytes(12).toString('hex');
    const editToken = crypto.randomBytes(16).toString('hex');
    const now = new Date().toISOString();
    const expiry = expiresAt ? new Date(expiresAt).toISOString() : null;

    const record = {
      id: projectId,
      title,
      data: {
        ...projectData,
        _meta: {
          ...(projectData._meta || {}),
          ownerId: authUserId || projectData?._meta?.ownerId || null,
        },
      },
      edit_token: editToken,
      created_at: now,
      updated_at: now,
      expires_at: expiry,
    };

    if (isSupabaseAdminConfigured()) {
      const supabase = getSupabaseAdmin();
      const { error } = await supabase.from('cloud_projects').insert(record);
      if (error) throw error;
    } else {
      cloudProjects.set(projectId, record);
    }

    return res.json({
      success: true,
      projectId,
      editToken,
      shareUrl: `${getPublicOrigin(req)}/open/${projectId}`,
      createdAt: now,
      expiresAt: expiry,
    });
  } catch (error) {
    console.error('Error creating cloud project:', error);
    return res.status(500).json({ success: false, message: 'Server error creating project' });
  }
});

app.get('/api/cloud-projects/list/:userId', async (req, res) => {
  try {
    const authResult = await getCloudAuthUser(req, 'list');
    if (authResult.error) {
      return res.status(authResult.error.statusCode).json(authResult.error.body);
    }

    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({ success: false, message: 'userId is required' });
    }

    if (authResult.user?.id && authResult.user.id !== userId) {
      return res
        .status(403)
        .json(
          makeCloudErrorResponse('list', { code: 'forbidden', message: 'Not authorized' }, 403)
        );
    }

    let rows = [];
    if (isSupabaseAdminConfigured()) {
      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase
        .from('cloud_projects')
        .select('id, title, updated_at, created_at, data')
        .order('updated_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      rows = data || [];
    } else {
      rows = Array.from(cloudProjects.values());
    }

    const projects = rows
      .filter(row => {
        const ownerId = row?.data?._meta?.ownerId || null;
        return ownerId === userId;
      })
      .map(row => ({
        id: row.id,
        name: row.title || row?.data?.manifest?.projectName || 'Untitled Project',
        updated_at: row.updated_at || row.created_at || new Date().toISOString(),
        created_at: row.created_at || row.updated_at || new Date().toISOString(),
      }));

    return res.json({ status: 'ok', operation: 'list', data: { projects } });
  } catch (error) {
    console.error('Error listing cloud projects:', error);
    return res.status(500).json(
      makeCloudErrorResponse('list', {
        code: 'list_failed',
        message: error?.message || 'Server error listing cloud projects',
      })
    );
  }
});

app.get('/api/cloud-projects/:projectId', async (req, res) => {
  try {
    const authResult = await getCloudAuthUser(req, 'load');
    if (authResult.error) {
      return res.status(authResult.error.statusCode).json(authResult.error.body);
    }

    const { projectId } = req.params;
    let record = null;

    if (isSupabaseAdminConfigured()) {
      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase
        .from('cloud_projects')
        .select('*')
        .eq('id', projectId)
        .single();
      if (error) throw error;
      record = data;
    } else {
      record = cloudProjects.get(projectId);
    }

    if (!record) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    if (!canAccessCloudProject(record, authResult.user?.id || null)) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    if (record.expires_at && new Date() > new Date(record.expires_at)) {
      if (!isSupabaseAdminConfigured()) {
        cloudProjects.delete(projectId);
      }
      return res.status(410).json({ success: false, message: 'Project link has expired' });
    }

    return res.json({
      success: true,
      projectData: record.data,
      projectInfo: {
        id: record.id,
        createdAt: record.created_at,
        expiresAt: record.expires_at,
        title: record.title,
      },
    });
  } catch (error) {
    console.error('Error retrieving cloud project:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving project' });
  }
});

app.patch('/api/cloud-projects/:projectId', async (req, res) => {
  try {
    const authResult = await getCloudAuthUser(req, 'bootstrap');
    if (authResult.error) {
      return res.status(authResult.error.statusCode).json(authResult.error.body);
    }

    const { projectId } = req.params;
    const { editToken, projectData, title = null, expiresAt = null } = req.body || {};

    if (!editToken) {
      return res.status(400).json({ success: false, message: 'editToken is required' });
    }

    let record = null;
    if (isSupabaseAdminConfigured()) {
      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase
        .from('cloud_projects')
        .select('*')
        .eq('id', projectId)
        .single();
      if (error) throw error;
      record = data;
    } else {
      record = cloudProjects.get(projectId);
    }

    if (!record) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }
    if (!canAccessCloudProject(record, authResult.user?.id || null)) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    if (record.edit_token && record.edit_token !== editToken) {
      return res.status(403).json({ success: false, message: 'Invalid edit token' });
    }

    const updatedRecord = {
      ...record,
      title: title ?? record.title,
      data: projectData && typeof projectData === 'object' ? projectData : record.data,
      expires_at: expiresAt ? new Date(expiresAt).toISOString() : record.expires_at,
      updated_at: new Date().toISOString(),
    };

    if (isSupabaseAdminConfigured()) {
      const supabase = getSupabaseAdmin();
      const { error } = await supabase
        .from('cloud_projects')
        .update({
          title: updatedRecord.title,
          data: updatedRecord.data,
          expires_at: updatedRecord.expires_at,
          updated_at: updatedRecord.updated_at,
        })
        .eq('id', projectId);
      if (error) throw error;
    } else {
      cloudProjects.set(projectId, updatedRecord);
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Error updating cloud project:', error);
    return res.status(500).json({ success: false, message: 'Server error updating project' });
  }
});

app.get('/api/cloud-projects/:projectId/bootstrap', async (req, res) => {
  try {
    const authResult = await getCloudAuthUser(req, 'assets_exists');
    if (authResult.error) {
      return res.status(authResult.error.statusCode).json(authResult.error.body);
    }

    const { projectId } = req.params;
    const sinceVersion = Number(req.query.manifestVersion || 0) || 0;

    const { record, error } = await getCloudProjectRecord(projectId);
    if (error) {
      return res
        .status(404)
        .json(
          makeCloudErrorResponse('bootstrap', { code: error.code, message: error.message }, 404)
        );
    }
    if (!record) {
      return res
        .status(404)
        .json(
          makeCloudErrorResponse(
            'bootstrap',
            { code: 'not_found', message: 'Project not found' },
            404
          )
        );
    }

    if (!canAccessCloudProject(record, authResult.user?.id || null)) {
      return res
        .status(403)
        .json(
          makeCloudErrorResponse('bootstrap', { code: 'forbidden', message: 'Not authorized' }, 403)
        );
    }

    const syncState = ensureCloudSyncState(record);
    const manifestVersion = Number(syncState.manifest.manifestVersion) || 1;
    const shouldSendViews = manifestVersion > sinceVersion;

    return res.json(
      makeCloudOperationResponse('bootstrap', {
        projectId,
        manifestVersion,
        manifest: syncState.manifest,
        viewStates: shouldSendViews ? syncState.viewStates : {},
        requiredAssetHashes: Object.keys(syncState.assets || {}),
      })
    );
  } catch (error) {
    console.error('[Cloud Bootstrap] Error:', error);
    return res.status(500).json(
      makeCloudErrorResponse('bootstrap', {
        code: 'bootstrap_failed',
        message: error?.message || 'Failed to bootstrap cloud project',
      })
    );
  }
});

// ── Wallet & Pets System ─────────────────────────────────────────────────────

const COINS_PER_REWARD = 5;
const DAILY_COIN_CAP = 100;
const EARN_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

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

// GET /api/wallet — returns balance, equipped pet, unlocked pets, catalog
app.get('/api/wallet', async (req, res) => {
  try {
    const authResult = await getCloudAuthUser(req, 'wallet');
    if (authResult.error) {
      return res.status(authResult.error.statusCode).json(authResult.error.body);
    }
    const userId = authResult.user.id;
    const supabase = getSupabaseAdmin();

    // Auto-create wallet on first access
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

    // Fetch unlocked pets
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
});

// POST /api/wallet/earn — earn coins on qualifying cloud save
app.post('/api/wallet/earn', async (req, res) => {
  try {
    const authResult = await getCloudAuthUser(req, 'wallet_earn');
    if (authResult.error) {
      return res.status(authResult.error.statusCode).json(authResult.error.body);
    }
    const userId = authResult.user.id;
    const { projectId, saveTimestamp, projectData, rewardType = 'cloud_save' } = req.body;

    if (!projectId || !saveTimestamp) {
      return res
        .status(400)
        .json({ success: false, message: 'projectId and saveTimestamp required' });
    }

    const effectiveRewardType = rewardType === 'pdf_export' ? 'pdf_export' : 'cloud_save';

    const supabase = getSupabaseAdmin();

    // Auto-create wallet if needed
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

    // Cooldown check: 5 minutes between rewards of same type
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
        const currentBalance = wallet?.balance || 0;
        return res.json({
          success: true,
          earned: 0,
          balance: currentBalance,
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

    // Daily cap check: 100 coins/day
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
      const currentBalance = wallet?.balance || 0;
      return res.json({ success: true, earned: 0, balance: currentBalance, reason: 'daily_cap' });
    }

    const idempotencyKey = buildRewardIdempotencyKey(
      userId,
      effectiveRewardType,
      projectId,
      saveTimestamp,
      qualification.drawnMarks
    );

    // Insert transaction (will fail silently on duplicate idempotency key)
    const { error: txError } = await supabase.from('coin_transactions').insert({
      user_id: userId,
      amount: COINS_PER_REWARD,
      reason: effectiveRewardType,
      idempotency_key: idempotencyKey,
    });

    if (txError) {
      // Duplicate idempotency key = already earned for this save
      if (txError.code === '23505') {
        const currentBalance = wallet?.balance || 0;
        return res.json({
          success: true,
          earned: 0,
          balance: currentBalance,
          reason: 'already_earned',
          rewardType: effectiveRewardType,
        });
      }
      throw txError;
    }

    // Increment balance atomically
    await supabase.rpc('increment_wallet_balance', {
      p_user_id: userId,
      p_amount: COINS_PER_REWARD,
    });

    // Fetch updated balance
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
});

// POST /api/wallet/spend — purchase a pet
app.post('/api/wallet/spend', async (req, res) => {
  try {
    const authResult = await getCloudAuthUser(req, 'wallet_spend');
    if (authResult.error) {
      return res.status(authResult.error.statusCode).json(authResult.error.body);
    }
    const userId = authResult.user.id;
    const { petId } = req.body;

    if (!petId) {
      return res.status(400).json({ success: false, message: 'petId is required' });
    }

    const catalogEntry = PET_CATALOG.find(p => p.id === petId);
    if (!catalogEntry) {
      return res.status(400).json({ success: false, message: 'Invalid petId' });
    }

    const supabase = getSupabaseAdmin();

    // Check not already owned
    const { data: existing } = await supabase
      .from('pet_inventory')
      .select('pet_id')
      .eq('user_id', userId)
      .eq('pet_id', petId)
      .maybeSingle();

    if (existing) {
      return res.status(400).json({ success: false, message: 'Pet already owned' });
    }

    // Atomic deduction
    const { data: deducted } = await supabase.rpc('decrement_wallet_balance', {
      p_user_id: userId,
      p_amount: catalogEntry.cost,
    });

    if (!deducted) {
      return res.status(400).json({ success: false, message: 'Insufficient balance' });
    }

    // Record transaction
    await supabase.from('coin_transactions').insert({
      user_id: userId,
      amount: -catalogEntry.cost,
      reason: `purchase_pet:${petId}`,
    });

    // Add to inventory
    await supabase.from('pet_inventory').insert({ user_id: userId, pet_id: petId });

    // Fetch updated balance
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
});

// POST /api/pets/equip — equip or unequip a pet
app.post('/api/pets/equip', async (req, res) => {
  try {
    const authResult = await getCloudAuthUser(req, 'pets_equip');
    if (authResult.error) {
      return res.status(authResult.error.statusCode).json(authResult.error.body);
    }
    const userId = authResult.user.id;
    const { petId } = req.body; // null to unequip

    const supabase = getSupabaseAdmin();

    if (petId) {
      // Validate ownership
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

    // Update equipped pet
    await supabase
      .from('wallets')
      .update({ equipped_pet: petId || null, updated_at: new Date().toISOString() })
      .eq('user_id', userId);

    return res.json({ success: true, equippedPet: petId || null });
  } catch (error) {
    console.error('[Pets] Equip error:', error);
    return res.status(500).json({ success: false, message: 'Failed to equip pet' });
  }
});

app.post('/api/cloud-assets/exists', async (req, res) => {
  try {
    const authResult = await getCloudAuthUser(req, 'asset_upload');
    if (authResult.error) {
      return res.status(authResult.error.statusCode).json(authResult.error.body);
    }

    const { projectId, hashes } = req.body || {};
    if (!projectId) {
      return res
        .status(400)
        .json(
          makeCloudErrorResponse(
            'assets_exists',
            { code: 'project_id_required', message: 'projectId is required' },
            400
          )
        );
    }

    if (!Array.isArray(hashes)) {
      return res
        .status(400)
        .json(
          makeCloudErrorResponse(
            'assets_exists',
            { code: 'invalid_hashes', message: 'hashes must be an array' },
            400
          )
        );
    }

    const { record, error } = await getCloudProjectRecord(projectId);
    if (error || !record) {
      return res
        .status(404)
        .json(
          makeCloudErrorResponse(
            'assets_exists',
            { code: 'not_found', message: 'Project not found' },
            404
          )
        );
    }

    if (!canAccessCloudProject(record, authResult.user?.id || null)) {
      return res
        .status(403)
        .json(
          makeCloudErrorResponse(
            'assets_exists',
            { code: 'forbidden', message: 'Not authorized' },
            403
          )
        );
    }

    const syncState = ensureCloudSyncState(record);
    const missing = hashes.filter(hash => !syncState.assets?.[hash]);
    return res.json(
      makeCloudOperationResponse('assets_exists', {
        projectId,
        missing,
      })
    );
  } catch (error) {
    console.error('[Cloud Assets Exists] Error:', error);
    return res.status(500).json(
      makeCloudErrorResponse('assets_exists', {
        code: 'assets_exists_failed',
        message: error?.message || 'Failed checking cloud assets',
      })
    );
  }
});

app.put('/api/cloud-assets/:hash', async (req, res) => {
  try {
    const authResult = await getCloudAuthUser(req, 'asset_upload');
    if (authResult.error) {
      return res.status(authResult.error.statusCode).json(authResult.error.body);
    }

    const { hash } = req.params;
    const {
      projectId,
      dataBase64,
      contentType = 'application/octet-stream',
      sizeBytes = null,
    } = req.body || {};

    if (!projectId || !hash) {
      return res
        .status(400)
        .json(
          makeCloudErrorResponse(
            'asset_upload',
            { code: 'invalid_input', message: 'projectId and hash are required' },
            400
          )
        );
    }

    const { record, error } = await getCloudProjectRecord(projectId);
    if (error || !record) {
      return res
        .status(404)
        .json(
          makeCloudErrorResponse(
            'asset_upload',
            { code: 'not_found', message: 'Project not found' },
            404
          )
        );
    }

    if (!canAccessCloudProject(record, authResult.user?.id || null)) {
      return res
        .status(403)
        .json(
          makeCloudErrorResponse(
            'asset_upload',
            { code: 'forbidden', message: 'Not authorized' },
            403
          )
        );
    }

    const syncState = ensureCloudSyncState(record);
    if (syncState.assets?.[hash]) {
      return res.json(
        makeCloudOperationResponse('asset_upload', {
          projectId,
          hash,
          alreadyExisted: true,
        })
      );
    }

    if (!dataBase64 || typeof dataBase64 !== 'string') {
      return res
        .status(400)
        .json(
          makeCloudErrorResponse(
            'asset_upload',
            { code: 'missing_data', message: 'dataBase64 is required' },
            400
          )
        );
    }

    const now = new Date().toISOString();
    syncState.assets[hash] = {
      hash,
      contentType,
      sizeBytes: Number(sizeBytes) || null,
      dataBase64,
      createdAt: now,
      updatedAt: now,
    };
    cloudProjectAssets.set(`${projectId}:${hash}`, syncState.assets[hash]);

    const updatedRecord = {
      ...record,
      data: {
        ...(record.data || {}),
        ...syncState,
      },
      updated_at: now,
    };

    const persistResult = await persistCloudProjectRecord(projectId, updatedRecord);
    if (persistResult.error) {
      return res.status(500).json(
        makeCloudErrorResponse('asset_upload', {
          code: persistResult.error.code,
          message: persistResult.error.message,
        })
      );
    }

    return res.json(
      makeCloudOperationResponse('asset_upload', {
        projectId,
        hash,
        alreadyExisted: false,
      })
    );
  } catch (error) {
    console.error('[Cloud Asset Upload] Error:', error);
    return res.status(500).json(
      makeCloudErrorResponse('asset_upload', {
        code: 'asset_upload_failed',
        message: error?.message || 'Failed uploading cloud asset',
      })
    );
  }
});

app.get('/api/cloud-assets/:hash', async (req, res) => {
  try {
    const authResult = await getCloudAuthUser(req, 'view_patch');
    if (authResult.error) {
      return res.status(authResult.error.statusCode).json(authResult.error.body);
    }

    const { hash } = req.params;
    const projectId = String(req.query.projectId || '');
    if (!hash || !projectId) {
      return res
        .status(400)
        .json(
          makeCloudErrorResponse(
            'asset_upload',
            { code: 'invalid_input', message: 'projectId and hash are required' },
            400
          )
        );
    }

    const { record, error } = await getCloudProjectRecord(projectId);
    if (error || !record) {
      return res
        .status(404)
        .json(
          makeCloudErrorResponse(
            'asset_upload',
            { code: 'not_found', message: 'Project not found' },
            404
          )
        );
    }

    if (!canAccessCloudProject(record, authResult.user?.id || null)) {
      return res
        .status(403)
        .json(
          makeCloudErrorResponse(
            'asset_upload',
            { code: 'forbidden', message: 'Not authorized' },
            403
          )
        );
    }

    const syncState = ensureCloudSyncState(record);
    const asset = syncState.assets?.[hash] || cloudProjectAssets.get(`${projectId}:${hash}`);
    if (!asset) {
      return res
        .status(404)
        .json(
          makeCloudErrorResponse(
            'asset_upload',
            { code: 'not_found', message: 'Asset not found' },
            404
          )
        );
    }

    return res.json(
      makeCloudOperationResponse('asset_upload', {
        projectId,
        hash,
        contentType: asset.contentType || 'application/octet-stream',
        sizeBytes: asset.sizeBytes || null,
        dataBase64: asset.dataBase64,
      })
    );
  } catch (error) {
    console.error('[Cloud Asset Get] Error:', error);
    return res.status(500).json(
      makeCloudErrorResponse('asset_upload', {
        code: 'asset_get_failed',
        message: error?.message || 'Failed retrieving cloud asset',
      })
    );
  }
});

app.patch('/api/cloud-projects/:projectId/views/:viewId', async (req, res) => {
  try {
    const authResult = await getCloudAuthUser(req, 'manifest_patch');
    if (authResult.error) {
      return res.status(authResult.error.statusCode).json(authResult.error.body);
    }

    const { projectId, viewId } = req.params;
    const { baseVersion = 0, viewState } = req.body || {};

    if (!viewState || typeof viewState !== 'object') {
      return res
        .status(400)
        .json(
          makeCloudErrorResponse(
            'view_patch',
            { code: 'invalid_view_state', message: 'viewState object is required' },
            400
          )
        );
    }

    const { record, error } = await getCloudProjectRecord(projectId);
    if (error || !record) {
      return res
        .status(404)
        .json(
          makeCloudErrorResponse(
            'view_patch',
            { code: 'not_found', message: 'Project not found' },
            404
          )
        );
    }

    if (!canAccessCloudProject(record, authResult.user?.id || null)) {
      return res
        .status(403)
        .json(
          makeCloudErrorResponse(
            'view_patch',
            { code: 'forbidden', message: 'Not authorized' },
            403
          )
        );
    }

    const syncState = ensureCloudSyncState(record);
    const currentViewVersion = Number(syncState.viewStates?.[viewId]?.version || 0);
    if (Number(baseVersion) !== currentViewVersion) {
      return res.status(409).json(
        makeCloudErrorResponse(
          'view_patch',
          {
            code: 'conflict',
            message: `View version mismatch. expected=${currentViewVersion} received=${baseVersion}`,
          },
          409
        )
      );
    }

    const nextVersion = currentViewVersion + 1;
    const now = new Date().toISOString();
    syncState.viewStates[viewId] = {
      version: nextVersion,
      updatedAt: now,
      state: viewState,
    };

    syncState.manifest.views = syncState.manifest.views || {};
    syncState.manifest.views[viewId] = {
      ...(syncState.manifest.views[viewId] || {}),
      latestViewVersion: nextVersion,
      updatedAt: now,
    };

    const updatedRecord = {
      ...record,
      data: {
        ...(record.data || {}),
        ...syncState,
      },
      updated_at: now,
    };

    const persistResult = await persistCloudProjectRecord(projectId, updatedRecord);
    if (persistResult.error) {
      return res.status(500).json(
        makeCloudErrorResponse('view_patch', {
          code: persistResult.error.code,
          message: persistResult.error.message,
        })
      );
    }

    return res.json(
      makeCloudOperationResponse('view_patch', {
        projectId,
        viewId,
        viewVersion: nextVersion,
      })
    );
  } catch (error) {
    console.error('[Cloud View Patch] Error:', error);
    return res.status(500).json(
      makeCloudErrorResponse('view_patch', {
        code: 'view_patch_failed',
        message: error?.message || 'Failed updating view state',
      })
    );
  }
});

app.patch('/api/cloud-projects/:projectId/manifest', async (req, res) => {
  try {
    const authResult = await getCloudAuthUser(req, 'load');
    if (authResult.error) {
      return res.status(authResult.error.statusCode).json(authResult.error.body);
    }

    const { projectId } = req.params;
    const { baseManifestVersion = 0, patch = {} } = req.body || {};

    const { record, error } = await getCloudProjectRecord(projectId);
    if (error || !record) {
      return res
        .status(404)
        .json(
          makeCloudErrorResponse(
            'manifest_patch',
            { code: 'not_found', message: 'Project not found' },
            404
          )
        );
    }

    if (!canAccessCloudProject(record, authResult.user?.id || null)) {
      return res
        .status(403)
        .json(
          makeCloudErrorResponse(
            'manifest_patch',
            { code: 'forbidden', message: 'Not authorized' },
            403
          )
        );
    }

    const syncState = ensureCloudSyncState(record);
    const currentVersion = Number(syncState.manifest?.manifestVersion || 1);
    if (Number(baseManifestVersion) !== currentVersion) {
      return res.status(409).json(
        makeCloudErrorResponse(
          'manifest_patch',
          {
            code: 'conflict',
            message: `Manifest version mismatch. expected=${currentVersion} received=${baseManifestVersion}`,
          },
          409
        )
      );
    }

    const nextVersion = currentVersion + 1;
    const now = new Date().toISOString();
    syncState.manifest = {
      ...syncState.manifest,
      ...(patch && typeof patch === 'object' ? patch : {}),
      manifestVersion: nextVersion,
      updatedAt: now,
    };

    const updatedRecord = {
      ...record,
      data: {
        ...(record.data || {}),
        ...syncState,
      },
      updated_at: now,
    };

    const persistResult = await persistCloudProjectRecord(projectId, updatedRecord);
    if (persistResult.error) {
      return res.status(500).json(
        makeCloudErrorResponse('manifest_patch', {
          code: persistResult.error.code,
          message: persistResult.error.message,
        })
      );
    }

    return res.json(
      makeCloudOperationResponse('manifest_patch', {
        projectId,
        manifestVersion: nextVersion,
        manifest: syncState.manifest,
      })
    );
  } catch (error) {
    console.error('[Cloud Manifest Patch] Error:', error);
    return res.status(500).json(
      makeCloudErrorResponse('manifest_patch', {
        code: 'manifest_patch_failed',
        message: error?.message || 'Failed updating manifest',
      })
    );
  }
});

// Share a project (create shareable link)
app.post('/api/projects/:projectId/share', (req, res) => {
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

// CW integration smoke test: login + save-measure-form for an existing form ID
app.post('/api/integrations/cw/test-save/:formId', async (req, res) => {
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
      payload: req.body?.payload || req.body || {},
      credentialsOverride,
    });

    return res.status(result.ok ? 200 : 502).json({
      success: result.ok,
      code: result.ok ? 'CW_SUBMIT_OK' : 'CW_SUBMIT_FAILED',
      formId: String(formId),
      upstreamStatus: result.status,
      durationMs: Date.now() - startedAt,
      upstreamBody: result.body,
    });
  } catch (error) {
    console.error('[CW Integration] test-save failed:', error);
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

app.get('/api/integrations/cw/health', (req, res) => {
  const baseUrl = (process.env.CW_BASE_URL || 'https://cw40.comfort-works.com').trim();
  return res.json({
    ok: true,
    baseUrl,
    hasEnvUsername: Boolean((process.env.CW_USERNAME || '').trim()),
    hasEnvPassword: Boolean((process.env.CW_PASSWORD || '').trim()),
  });
});

// Local dev parity route for the Vercel-style CW measurements handler.
app.all('/api/integrations/cw/measurements/:formId', async (req, res) => {
  req.query = {
    ...(req.query || {}),
    formId: String(req.params?.formId || '').trim(),
  };
  return cwMeasurementsHandler(req, res);
});

// Measurement Guides API routes
app.get('/api/measurement-guides/codes', async (req, res) => {
  return measurementGuideCodesHandler(req, res);
});

app.get('/api/measurement-guides/svg', async (req, res) => {
  return measurementGuideSvgHandler(req, res);
});

// ============== END PROJECT CRUD API ROUTES ==============

/**
 * API endpoint for creating a shareable URL for a project
 * Accepts project data and returns a unique share ID
 */
app.post('/api/share-project', async (req, res) => {
  try {
    const { projectData, title = null, shareOptions = {} } = req.body;

    if (!projectData) {
      return res.status(400).json({ success: false, message: 'Project data is required' });
    }

    // Generate a unique slug (url-safe) and edit token
    const shareId = crypto.randomBytes(12).toString('hex');
    const editToken = crypto.randomBytes(16).toString('hex');

    const shareRecord = {
      id: shareId,
      editToken,
      projectData,
      createdAt: new Date(),
      expiresAt: shareOptions.expiresAt
        ? new Date(shareOptions.expiresAt)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      isPublic: shareOptions.isPublic || false,
      allowEditing: shareOptions.allowEditing || false,
      measurements: shareOptions.measurements || {},
    };

    if (isDbConfigured()) {
      await ensureSchema();
      await createOrUpdateProject({ slug: shareId, title, data: shareRecord, editToken });
    } else {
      sharedProjects.set(shareId, shareRecord);
    }

    console.log(`Created share link: ${shareId} (db=${isDbConfigured()})`);

    return res.json({
      success: true,
      shareId,
      editToken,
      shareUrl: `${getPublicOrigin(req)}/shared/${shareId}`,
      expiresAt: shareRecord.expiresAt,
    });
  } catch (error) {
    console.error('Error creating share link:', error);
    return res.status(500).json({ success: false, message: 'Server error creating share link' });
  }
});

/**
 * API endpoint for retrieving a shared project
 * Returns project data for a given share ID
 */
app.get('/api/shared/:shareId', async (req, res) => {
  try {
    const { shareId } = req.params;
    let shareRecord;

    if (isDbConfigured()) {
      await ensureSchema();
      const row = await getProjectBySlug(shareId);
      if (row) shareRecord = row.data;
    } else {
      shareRecord = sharedProjects.get(shareId);
    }

    if (!shareRecord) {
      return res.status(404).json({ success: false, message: 'Shared project not found' });
    }

    if (shareRecord.expiresAt && new Date() > new Date(shareRecord.expiresAt)) {
      if (!isDbConfigured()) {
        sharedProjects.delete(shareId);
      }
      return res.status(410).json({ success: false, message: 'Shared project has expired' });
    }

    console.log(`Accessed share link: ${shareId}`);

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
});

/**
 * API endpoint for submitting customer measurements
 * Accepts measurement data for a shared project
 */
app.post('/api/shared/:shareId/measurements', async (req, res) => {
  try {
    const { shareId } = req.params;
    const { measurements, customerInfo = {} } = req.body;

    // Validate measurements (basic validation)
    if (!measurements || typeof measurements !== 'object') {
      return res.status(400).json({ success: false, message: 'Valid measurements are required' });
    }

    let shareRecord;

    if (isDbConfigured()) {
      await ensureSchema();
      const row = await getProjectBySlug(shareId);
      if (!row) {
        return res.status(404).json({ success: false, message: 'Shared project not found' });
      }
      shareRecord = row.data;
    } else {
      shareRecord = sharedProjects.get(shareId);
      if (!shareRecord) {
        return res.status(404).json({ success: false, message: 'Shared project not found' });
      }
    }

    // Check if the share has expired
    if (shareRecord.expiresAt && new Date() > new Date(shareRecord.expiresAt)) {
      return res.status(410).json({ success: false, message: 'Shared project has expired' });
    }

    // Store the measurements with timestamp
    const submissionId = crypto.randomBytes(8).toString('hex');
    const submission = {
      id: submissionId,
      measurements: measurements,
      customerInfo: customerInfo,
      submittedAt: new Date(),
      shareId: shareId,
    };

    if (!Array.isArray(shareRecord.submissions)) {
      shareRecord.submissions = [];
    }
    shareRecord.submissions.push(submission);

    if (isDbConfigured()) {
      await createOrUpdateProject({
        slug: shareId,
        title: null,
        data: shareRecord,
        editToken: null,
      });
    } else {
      sharedProjects.set(shareId, shareRecord);
    }

    console.log(
      `Received measurements for share ${shareId}: ${submissionId} (db=${isDbConfigured()})`
    );

    return res.json({
      success: true,
      submissionId: submissionId,
      message: 'Measurements submitted successfully',
    });
  } catch (error) {
    console.error('Error submitting measurements:', error);
    return res
      .status(500)
      .json({ success: false, message: 'Server error submitting measurements' });
  }
});

/**
 * API endpoint for retrieving submitted measurements for a share
 * Requires editToken to access
 */
app.get('/api/shared/:shareId/measurements', async (req, res) => {
  try {
    const { shareId } = req.params;
    const { editToken } = req.query;

    if (!editToken) {
      return res.status(400).json({ success: false, message: 'editToken is required' });
    }

    let shareRecord = null;

    if (isDbConfigured()) {
      await ensureSchema();
      const dbRow = await getProjectBySlug(shareId);
      if (!dbRow)
        return res.status(404).json({ success: false, message: 'Shared project not found' });
      if (dbRow.edit_token !== editToken)
        return res.status(403).json({ success: false, message: 'Invalid edit token' });
      shareRecord = dbRow.data;
    } else {
      shareRecord = sharedProjects.get(shareId);
      if (!shareRecord)
        return res.status(404).json({ success: false, message: 'Shared project not found' });
      if (shareRecord.editToken && shareRecord.editToken !== editToken) {
        return res.status(403).json({ success: false, message: 'Invalid edit token' });
      }
    }

    const measurements = shareRecord.measurements || {};
    const submissions = shareRecord.submissions || [];

    return res.json({
      success: true,
      measurements: measurements,
      submissions: submissions,
      totalSubmissions: submissions.length,
    });
  } catch (error) {
    console.error('Error retrieving measurements:', error);
    return res
      .status(500)
      .json({ success: false, message: 'Server error retrieving measurements' });
  }
});

// ---------------------------------------------------------------------------
// MOS v1 — Gemini-powered measurement overlay generation
// ---------------------------------------------------------------------------

const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || '').trim();
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

/**
 * POST /api/measurements/generate
 *
 * Accepts an image (via R2 key or base64 data URL), calls Gemini to generate
 * a measurement overlay SVG, validates the result, stores in R2, and returns
 * the SVG + metadata.
 *
 * Body: see MosGenerateRequest in types.ts
 */
app.post('/api/measurements/generate', async (req, res) => {
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

    const ROLE_SEMANTICS = {
      A1: 'top rail / back width',
      A2: 'seat rail width',
      A3: 'back height (seat to top rail)',
      A4: 'lower frame width',
      A5: 'additional front height',
      B1: 'inner arm connector (left)',
      B2: 'outer arm connector (right)',
      C1: 'arm top width (right)',
      C2: 'arm mid width (right)',
      C3: 'arm height (right)',
      C4: 'leg height (front right)',
      C5: 'additional arm/cushion dimension',
      D: 'overall width at base',
      D1: 'depth dimension 1',
      D2: 'depth dimension 2',
      D3: 'depth dimension 3',
      E1: 'arm curve / roll profile',
      E2: 'arm curve secondary',
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
      M1: 'module width 1',
      M2: 'module width 2',
      M3: 'module width 3',
      M4: 'module width 4',
      M5: 'module width 5',
      M6: 'module width 6',
      M7: 'module width 7',
      W: 'width',
      H: 'height',
      W1: 'width (top)',
      W2: 'width (bottom)',
      T: 'thickness',
      X: 'cushion inset',
      Y: 'cushion length',
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
    const requestStartMs = Date.now();
    const phaseDurations = {};
    const markPhase = (phase, startMs) => {
      phaseDurations[phase] = Date.now() - startMs;
    };

    console.log(
      `${logPrefix} start template=${templateId || 'none'} view=${String(viewId || 'front')} guideView=${String(guideView || '')} imagePartLabel=${String(imagePartLabel || '')}`
    );

    // --- Fetch reference template SVG from Cloudflare Worker (if templateId provided) ---
    const workerBase = (
      process.env.MEASUREMENT_GUIDE_WORKER_URL ||
      process.env.CF_WORKER_URL ||
      AI_WORKER_URL ||
      ''
    )
      .trim()
      .replace(/\/+$/, '');
    const workerApiKey = (
      process.env.MEASUREMENT_GUIDE_WORKER_API_KEY ||
      AI_WORKER_KEY ||
      'dev-secret'
    ).trim();

    let referenceSvgText = null;
    const resolvedGuideView = resolveGuideView({
      viewId,
      guideView,
      imagePartLabel,
    });
    if (templateId && workerBase) {
      const templateFetchStartMs = Date.now();
      try {
        const svgUrl = `${workerBase}/measurement-guides/svg?code=${encodeURIComponent(templateId)}&view=${encodeURIComponent(resolvedGuideView)}`;
        const svgRes = await fetch(svgUrl, {
          method: 'GET',
          headers: {
            'x-api-key': workerApiKey,
            accept: 'image/svg+xml,application/json',
          },
        });
        if (svgRes.ok) {
          referenceSvgText = await svgRes.text();
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
    const richTemplateContext = buildRichTemplateContext(referenceSvgText, effectiveRoles);

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
      // Extract base64 from data URL
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
      // Fetch from R2 public URL
      const publicUrl = getR2PublicUrl(imageR2Key);
      const imgResponse = await fetch(publicUrl);
      if (!imgResponse.ok) {
        return res.status(400).json({
          success: false,
          error: `Failed to fetch image from R2: ${imgResponse.status}`,
        });
      }
      const buffer = Buffer.from(await imgResponse.arrayBuffer());

      // Resize with Sharp if available
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
          // Try to detect MIME from first bytes
          if (buffer[0] === 0xff && buffer[1] === 0xd8) imageMimeType = 'image/jpeg';
          else if (buffer[0] === 0x89 && buffer[1] === 0x50) imageMimeType = 'image/png';
        }
      } catch {
        // Sharp not available — use raw buffer
        imageBase64 = buffer.toString('base64');
      }
    }
    markPhase('imagePrepMs', imagePrepStartMs);

    console.log(
      `${logPrefix} roles=${effectiveRoles.join(',')} templateRoles=${templateRoles.length} imageMime=${imageMimeType} imageBytes=${Math.round((imageBase64?.length || 0) * 0.75)} imagePrep=${phaseDurations.imagePrepMs}ms`
    );

    // --- Build Gemini prompt ---
    const rolesStr = effectiveRoles.join(', ');

    let systemPrompt;
    let fallbackPrompt;
    if (referenceSvgText) {
      systemPrompt = `You are a measurement overlay generator for product images.
Your task is to analyse the provided image and generate an SVG measurement overlay.

COORDINATE SPACE: 0\u20131000 on both axes (normalised to image dimensions).

${richTemplateContext}

RULES:
1. The SVG MUST use viewBox="0 0 1000 1000".
2. Generate measurement lines for these roles: ${rolesStr}
3. Analyse the photo to find where each physical feature is located.
4. Coordinates MUST match the actual feature position and angle in the photo — do NOT copy template coordinates.
5. Use template data only as a guide for which roles to measure and their general meaning.
6. Units: ${units}
7. All coordinates MUST be in range [0, 1000]. No negative values. No values > 1000.
8. Lines MUST NOT be zero-length (x1,y1 must differ from x2,y2).
9. Diagonal and curved roles should follow the actual angle/curve of the feature in the photo.
10. Do not add extra roles beyond those listed.

Return ONLY a JSON object with this exact structure:
{
  "svg": "<svg xmlns=\\"http://www.w3.org/2000/svg\\" viewBox=\\"0 0 1000 1000\\">...</svg>"
}`;
      fallbackPrompt = `You are a measurement overlay generator for product images.
Your task is to analyse the provided image and generate an SVG measurement overlay.

COORDINATE SPACE: 0\u20131000 on both axes.
Allowed roles: ${rolesStr}

RULES:
1. The SVG MUST use viewBox="0 0 1000 1000".
2. Generate one <line> and one nearby <text> label for each role token.
3. Units: ${units}
4. All coordinates must be within [0, 1000].
5. No zero-length lines.
6. Place each line where the corresponding physical feature appears in the photo.

Return ONLY a JSON object with this exact structure:
{
  "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1000 1000\">...</svg>"
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

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const parts = [];

      if (attempt === 1 || !lastSvg || process.env.VERCEL) {
        const promptText = attempt === 1 ? systemPrompt : fallbackPrompt;
        parts.push({
          text: promptText,
        });
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

      // Add thinking config if supported
      if (thinkingLevel !== 'low') {
        geminiBody.generationConfig.thinkingConfig = {
          thinkingBudget: thinkingLevel === 'high' ? 8192 : 4096,
        };
      }

      const geminiRequestStartMs = Date.now();
      const geminiAttemptMode =
        attempt === 1 ? 'template' : !lastSvg || process.env.VERCEL ? 'fallback' : 'repair';
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

      if (!geminiResponse.ok) {
        const errText = await geminiResponse.text();
        console.error(`[MOS Generate] Gemini API error (attempt ${attempt}):`, errText);

        // If 413 or too large, retry with smaller image
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

      // Extract usage metrics
      if (geminiData.usageMetadata) {
        usage = {
          promptTokenCount: geminiData.usageMetadata.promptTokenCount || 0,
          totalTokenCount: geminiData.usageMetadata.totalTokenCount || 0,
        };
      }

      // Extract SVG from response
      let svgText = null;
      try {
        const candidate = geminiData.candidates?.[0];
        const textContent = candidate?.content?.parts?.[0]?.text || '';

        // Try parsing as JSON first
        let parsed;
        try {
          parsed = JSON.parse(textContent);
        } catch {
          // Fallback: strip markdown fences and try again
          const stripped = textContent
            .replace(/```(?:json|xml|svg)?\n?/g, '')
            .replace(/```\s*$/g, '')
            .trim();
          // Try to find JSON object
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

      // --- Validate the SVG ---
      let errors = validateMosSvg(svgText);

      if (errors.length > 0) {
        const repairedSvg = autoRepairMosSvg(svgText);
        if (repairedSvg && repairedSvg !== svgText) {
          const repairedErrors = validateMosSvg(repairedSvg);
          if (repairedErrors.length === 0) {
            svgText = repairedSvg;
            lastSvg = svgText;
            errors = [];
            console.log(`${logPrefix} attempt=${attempt} autoRepair=applied`);
          } else {
            errors = repairedErrors;
            lastSvg = repairedSvg;
          }
        }
      }

      if (errors.length === 0) {
        // Valid! Store in R2 if configured
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

            // Upload the SVG
            await fetch(uploadUrl, {
              method: 'PUT',
              headers: { 'Content-Type': 'image/svg+xml' },
              body: svgText,
            });

            r2Url = publicUrl;
          } catch (r2Err) {
            console.error('[MOS Generate] R2 upload failed:', r2Err);
            // Non-fatal — still return the SVG
          }
        }

        // Store metadata in Supabase if configured
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
          svg: svgText,
          r2Key,
          r2Url,
          supabaseId,
          attempt,
          usage,
        });
      }

      // Validation failed — prepare for retry
      lastErrors = errors;
      console.log(`${logPrefix} attempt=${attempt} validationErrors=${errors.length}`);
    }

    markPhase('totalMs', requestStartMs);
    console.error(
      `${logPrefix} failed after ${MAX_ATTEMPTS} attempts total=${phaseDurations.totalMs}ms`
    );
    if (!lastSvg && Array.isArray(lastErrors) && lastErrors.includes('Gemini timeout')) {
      return res.status(504).json({
        success: false,
        error: 'Generation timed out while contacting Gemini. Try fewer roles or a smaller image.',
      });
    }
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
});

/**
 * Validate an MOS SVG string. Returns array of error strings (empty = valid).
 */
function validateMosSvg(svgText) {
  const errors = [];

  // Check it's valid XML
  if (!svgText || typeof svgText !== 'string') {
    errors.push('SVG text is empty or not a string');
    return errors;
  }

  // Check for root <svg> element
  if (!/<svg[\s>]/i.test(svgText)) {
    errors.push('No <svg> root element found');
    return errors;
  }

  // Check viewBox
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

  // Check all coordinates are in range [0, 1000]
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

  // Check for zero-length lines
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

  // Check for dangerous content
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

/**
 * Serve the shared project viewer page
 */
app.get('/shared/:shareId', (req, res) => {
  // Serve the shared project page; the page will fetch via /api/shared/:shareId
  res.sendFile(path.join(__dirname, 'shared.html'));
});

/**
 * Serve the editor for cloud-saved projects
 */
app.get('/open/:projectId', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

/**
 * Serve the production team view page
 */
app.get('/production/:shareId', (req, res) => {
  const productionPath = path.join(__dirname, 'public/production.html');
  if (fs.existsSync(productionPath)) {
    return res.sendFile(productionPath);
  }
  return res.sendFile(path.join(__dirname, 'shared.html'));
});

/**
 * API endpoint for uploading project files
 * Accepts a project ZIP file and stores it in the uploads directory
 */
app.post('/api/upload-project', upload.single('projectFile'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    // Just return the file path - client will handle extraction
    return res.json({
      success: true,
      filePath: req.file.path,
      fileName: req.file.originalname,
    });
  } catch (error) {
    console.error('Error handling project upload:', error);
    return res.status(500).json({ success: false, message: 'Server error handling upload' });
  }
});

/**
 * API endpoint for background removal - proxies to CF Worker
 */
app.post('/api/remove-background', async (req, res) => {
  return res.status(410).set('content-type', 'application/json; charset=utf-8').json({
    ok: false,
    error: 'feature-removed',
    message: 'Background removal service has been removed. Use the Privacy Erase tool instead.',
  });
});

/**
 * API endpoint for Cloudflare Images direct upload
 * Proxies to CF Worker to get upload URL
 */
app.post('/api/images/direct-upload', async (req, res) => {
  try {
    const base = process.env.CF_WORKER_URL || AI_WORKER_URL || '';
    if (!base) {
      return res.status(500).set('content-type', 'application/json; charset=utf-8').json({
        ok: false,
        error: 'missing-CF_WORKER_URL',
        message: 'Set CF_WORKER_URL to your Worker base URL',
      });
    }
    const url = `${base.replace(/\/$/, '')}/images/direct-upload`;
    const headers = {};
    if (req.headers['x-api-key']) headers['x-api-key'] = String(req.headers['x-api-key']);

    let upstream;
    try {
      upstream = await fetch(url, { method: 'POST', headers });
    } catch (e) {
      return res
        .status(502)
        .set('content-type', 'application/json; charset=utf-8')
        .json({ ok: false, error: 'fetch-exception', message: e.message });
    }

    const text = await upstream.text().catch(() => '<no body>');
    if (!upstream.ok) {
      return res
        .status(502)
        .set('content-type', 'application/json; charset=utf-8')
        .json({
          ok: false,
          error: 'upstream-failed',
          status: upstream.status,
          body: text.slice(0, 500),
        });
    }

    try {
      return res
        .status(200)
        .set('content-type', 'application/json; charset=utf-8')
        .json(JSON.parse(text));
    } catch {
      return res
        .status(200)
        .set('content-type', upstream.headers.get('content-type') || 'application/json')
        .send(text);
    }
  } catch (err) {
    return res
      .status(500)
      .set('content-type', 'application/json; charset=utf-8')
      .json({ ok: false, error: 'proxy-exception', message: String(err) });
  }
});

/**
 * Update an existing shared project (requires editToken)
 */
app.patch('/api/shared/:shareId', async (req, res) => {
  try {
    const { shareId } = req.params;
    const { editToken, projectData, title = null, shareOptions = {} } = req.body || {};

    if (!editToken) {
      return res.status(400).json({ success: false, message: 'editToken is required' });
    }

    let dbRow = null;
    let shareRecord = null;

    if (isDbConfigured()) {
      await ensureSchema();
      dbRow = await getProjectBySlug(shareId);
      if (!dbRow)
        return res.status(404).json({ success: false, message: 'Shared project not found' });
      if (dbRow.edit_token !== editToken)
        return res.status(403).json({ success: false, message: 'Invalid edit token' });
      shareRecord = dbRow.data;
    } else {
      shareRecord = sharedProjects.get(shareId);
      if (!shareRecord)
        return res.status(404).json({ success: false, message: 'Shared project not found' });
      if (shareRecord.editToken && shareRecord.editToken !== editToken) {
        return res.status(403).json({ success: false, message: 'Invalid edit token' });
      }
    }

    // Apply updates
    if (projectData && typeof projectData === 'object') {
      shareRecord.projectData = projectData;
    }
    if (shareOptions && typeof shareOptions === 'object') {
      if (shareOptions.expiresAt) shareRecord.expiresAt = new Date(shareOptions.expiresAt);
      if (typeof shareOptions.isPublic === 'boolean') shareRecord.isPublic = shareOptions.isPublic;
      if (typeof shareOptions.allowEditing === 'boolean')
        shareRecord.allowEditing = shareOptions.allowEditing;
    }

    // Persist
    if (isDbConfigured()) {
      await createOrUpdateProject({ slug: shareId, title, data: shareRecord, editToken });
    } else {
      sharedProjects.set(shareId, shareRecord);
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Error updating shared project:', error);
    return res
      .status(500)
      .json({ success: false, message: 'Server error updating shared project' });
  }
});

/**
 * AI Worker Relay Endpoints
 * These endpoints relay requests to the Cloudflare Worker for AI-enhanced SVG generation
 */

// AI Worker configuration is now at the top of the file

// Rate limiting for AI endpoints
const aiRequestCounts = new Map();
const AI_RATE_LIMIT = 10; // requests per minute
const AI_RATE_WINDOW = 60 * 1000; // 1 minute

function checkAIRateLimit(ip) {
  const now = Date.now();
  const record = aiRequestCounts.get(ip) || { count: 0, resetTime: now + AI_RATE_WINDOW };

  if (now > record.resetTime) {
    record.count = 0;
    record.resetTime = now + AI_RATE_WINDOW;
  }

  record.count++;
  aiRequestCounts.set(ip, record);

  return record.count <= AI_RATE_LIMIT;
}

/**
 * Generate AI-enhanced SVG from strokes (stroke cleanup)
 */
app.post('/ai/generate-svg', async (req, res) => {
  try {
    const r = await fetch(joinUrl(AI_WORKER_URL, '/generate-svg'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': AI_WORKER_KEY,
      },
      body: JSON.stringify(req.body),
    });
    const text = await r.text();
    return res.status(r.status).type('application/json').send(text);
  } catch (e) {
    console.error('[AI Relay] /generate-svg failed:', e);
    return res.status(502).json({ error: 'Relay fetch failed', detail: String(e) });
  }
});

/**
 * Assist with measurement calculation
 */
app.post('/ai/assist-measurement', async (req, res) => {
  try {
    if (!req.body || !req.body.units || !req.body.stroke) {
      return res.status(400).json({ error: 'Invalid input: units and stroke required' });
    }

    const target = joinUrl(AI_WORKER_URL, '/assist-measurement');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);

    let r, text;
    try {
      r = await fetch(target, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': AI_WORKER_KEY,
          'X-Request-ID': crypto.randomUUID(),
        },
        body: JSON.stringify(req.body),
        signal: controller.signal,
      });
      text = await r.text();
    } catch (e) {
      clearTimeout(timer);
      console.error('[AI Relay] Fetch failed:', e);
      return res.status(502).json({ error: 'Relay fetch failed', detail: String(e) });
    }
    clearTimeout(timer);

    if (!r.ok) {
      console.error('[AI Relay] Worker error:', r.status, text);
      return res.status(r.status).type('application/json').send(text);
    }

    return res.type('application/json').send(text);
  } catch (e) {
    console.error('[AI Relay] Route crash:', e);
    return res.status(500).json({ error: 'Relay crashed', detail: String(e) });
  }
});

/**
 * Enhance annotation placement
 */
app.post('/ai/enhance-placement', async (req, res) => {
  try {
    if (!req.body || !req.body.image || !Array.isArray(req.body.strokes)) {
      return res.status(400).json({ error: 'Invalid input: image and strokes required' });
    }

    const target = joinUrl(AI_WORKER_URL, '/enhance-placement');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);

    let r, text;
    try {
      r = await fetch(target, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': AI_WORKER_KEY,
          'X-Request-ID': crypto.randomUUID(),
        },
        body: JSON.stringify(req.body),
        signal: controller.signal,
      });
      text = await r.text();
    } catch (e) {
      clearTimeout(timer);
      console.error('[AI Relay] Fetch failed:', e);
      return res.status(502).json({ error: 'Relay fetch failed', detail: String(e) });
    }
    clearTimeout(timer);

    if (!r.ok) {
      console.error('[AI Relay] Worker error:', r.status, text);
      return res.status(r.status).type('application/json').send(text);
    }

    return res.type('application/json').send(text);
  } catch (e) {
    console.error('[AI Relay] Route crash:', e);
    return res.status(500).json({ error: 'Relay crashed', detail: String(e) });
  }
});

/**
 * AI Analyze and Dimension Relay Endpoint
 * Forwards requests to Cloudflare Worker for furniture dimensioning
 */
app.post('/ai/analyze-and-dimension', async (req, res) => {
  try {
    console.log('[AI Relay] analyze req keys:', Object.keys(req.body || {}));
  } catch (_) {}
  try {
    const r = await fetch(
      joinUrl((process.env.AI_WORKER_URL || '').trim(), '/analyze-and-dimension'),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': (process.env.AI_WORKER_KEY || '').trim(),
        },
        body: JSON.stringify(req.body || {}),
      }
    );
    const text = await r.text();
    console.log('[AI Relay] analyze status:', r.status);
    return res.status(r.status).type('application/json').send(text);
  } catch (e) {
    console.error('[AI Relay] /analyze-and-dimension failed:', e);
    return res.status(502).json({ error: 'Relay fetch failed', detail: String(e) });
  }
});

/**
 * Cloudflare Images Storage Presign Endpoint
 * Generates presigned upload URLs for AI image processing
 */
app.post('/api/storage/presign', async (req, res) => {
  try {
    // Validate Cloudflare Images configuration
    if (!CF_ACCOUNT_ID || !CF_IMAGES_API_TOKEN) {
      return res.status(500).json({
        success: false,
        message: 'Cloudflare Images not configured. Missing CF_ACCOUNT_ID or CF_IMAGES_API_TOKEN.',
      });
    }

    // Generate unique image key
    const timestamp = Date.now();
    const uuid = crypto.randomUUID();
    const imageKey = `ai-uploads/${timestamp}-${uuid}`;

    // Call Cloudflare Images Direct Creator Upload API
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/images/v2/direct_upload`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CF_IMAGES_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requireSignedURLs: false,
        metadata: {
          key: imageKey,
          purpose: 'ai-furniture-dimensioning',
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        '[Cloudflare Images] Upload URL generation failed:',
        response.status,
        errorText
      );
      return res.status(502).json({
        success: false,
        message: 'Failed to generate upload URL',
        detail: errorText,
      });
    }

    const data = await response.json();

    if (!data.success) {
      console.error('[Cloudflare Images] API error:', data.errors);
      return res.status(502).json({
        success: false,
        message: 'Cloudflare Images API error',
        errors: data.errors,
      });
    }

    const { uploadURL, id: imageId } = data.result;
    const deliveryUrl = `https://imagedelivery.net/${CF_ACCOUNT_HASH}/${imageId}/public`;

    console.log(`[Cloudflare Images] Generated presign for key: ${imageKey}, imageId: ${imageId}`);

    return res.json({
      success: true,
      key: imageKey,
      uploadUrl: uploadURL,
      imageId: imageId,
      deliveryUrl: deliveryUrl,
    });
  } catch (error) {
    console.error('Error generating presigned upload URL:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error generating upload URL',
      detail: error.message,
    });
  }
});

/**
 * API endpoint for saving project to Supabase
 * Handles direct database persistence via Supabase client
 */
app.post('/api/projects/:projectId/save', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { data, userId } = req.body;

    if (!data) {
      return res.status(400).json({
        success: false,
        message: 'Project data required',
      });
    }

    console.log(`[Save API] Saving project ${projectId} to Supabase`);
    console.log('[Save API] Project data:', {
      name: data.name,
      hasImages: Object.keys(data.images || {}).length,
      hasStrokes: Object.keys(data.strokes || {}).length,
      hasMeasurements: Object.keys(data.measurements || {}).length,
    });

    // Try Supabase save if client is available
    if (supabaseClient) {
      const projectRecord = {
        id: projectId || crypto.randomUUID(),
        user_id: userId || null,
        name: data.name || 'Untitled Project',
        description: data.description || null,
        data: data,
        updated_at: new Date().toISOString(),
      };

      const { data: savedProject, error } = await supabaseClient
        .from('projects')
        .upsert(projectRecord, { onConflict: 'id' })
        .select()
        .single();

      if (error) {
        console.error('[Save API] Supabase error:', error);
        return res.status(500).json({
          success: false,
          message: 'Failed to save to Supabase',
          error: error.message,
        });
      }

      console.log('[Save API] Saved to Supabase:', savedProject.id);
      return res.json({
        success: true,
        message: 'Saved to Supabase',
        projectId: savedProject.id,
        savedAt: savedProject.updated_at,
      });
    }

    // Fallback: return success but note Supabase is not configured
    console.log('[Save API] Supabase not configured, returning success anyway');
    return res.json({
      success: true,
      message: 'Supabase not configured - save acknowledged',
      projectId: projectId || crypto.randomUUID(),
    });
  } catch (error) {
    console.error('[Save API] Error saving to Supabase:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to save to Supabase',
      error: error.message,
    });
  }
});

/**
 * API endpoint for loading project from Supabase
 */
app.get('/api/projects/:projectId/load', async (req, res) => {
  try {
    const { projectId } = req.params;

    if (!supabaseClient) {
      return res.status(503).json({
        success: false,
        message: 'Supabase not configured',
      });
    }

    const { data: project, error } = await supabaseClient
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .single();

    if (error) {
      console.error('[Load API] Supabase error:', error);
      return res.status(404).json({
        success: false,
        message: 'Project not found',
        error: error.message,
      });
    }

    return res.json({
      success: true,
      project: project,
    });
  } catch (error) {
    console.error('[Load API] Error loading from Supabase:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to load project',
      error: error.message,
    });
  }
});

/**
 * API endpoint for listing user projects from Supabase
 */
app.get('/api/projects/list/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    if (!supabaseClient) {
      return res.status(503).json({
        success: false,
        message: 'Supabase not configured',
      });
    }

    const { data: projects, error } = await supabaseClient
      .from('projects')
      .select('id, name, description, created_at, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('[List API] Supabase error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to list projects',
        error: error.message,
      });
    }

    return res.json({
      success: true,
      projects: projects || [],
    });
  } catch (error) {
    console.error('[List API] Error listing projects:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to list projects',
      error: error.message,
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ success: false, message: 'Server error' });
});

// export for Vercel
export default app;

// keep local server only when run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = process.env.PORT || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`OpenPaint app listening at http://localhost:${port}`);
  });
}

/**
 * Python rembg processing function using inline script execution
 */
async function processImageWithRembg(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    // fs is already imported at the top level
    const tempScriptPath = path.join(__dirname, 'temp_rembg_script.py');
    const pythonScript = `
import sys
import os
from rembg import remove
from PIL import Image
import io

def main():
    try:
        input_path = sys.argv[1]
        output_path = sys.argv[2]

        if not os.path.exists(input_path):
            print(f"Input file does not exist: {input_path}", file=sys.stderr)
            sys.exit(1)

        with open(input_path, 'rb') as f:
            input_data = f.read()

        try:
            Image.open(io.BytesIO(input_data))
        except Exception:
            pass

        output_data = remove(input_data)

        out_dir = os.path.dirname(output_path)
        if out_dir and not os.path.exists(out_dir):
            os.makedirs(out_dir, exist_ok=True)

        with open(output_path, 'wb') as f:
            f.write(output_data)

    except Exception as e:
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python script.py <input_path> <output_path>", file=sys.stderr)
        sys.exit(1)
    main()
`;

    fs.writeFileSync(tempScriptPath, pythonScript);

    const py = spawn('python3', [tempScriptPath, inputPath, outputPath], { stdio: 'inherit' });
    let failed = false;
    py.on('error', err => {
      failed = true;
      try {
        fs.unlinkSync(tempScriptPath);
      } catch (_) {}
      reject(err);
    });
    py.on('close', code => {
      try {
        fs.unlinkSync(tempScriptPath);
      } catch (_) {}
      if (!failed && code === 0) return resolve();
      reject(new Error(`Python process exited with code ${code}`));
    });
  });
}

app.get('/css/:filename(*)', (req, res) => {
  const filePath = path.join(__dirname, 'css', req.params.filename);
  res.setHeader('Content-Type', 'text/css; charset=utf-8');
  res.sendFile(filePath, err => {
    if (err) {
      console.error('[Static] Failed to serve CSS file:', req.path, err.message);
      res.status(404).send('File not found');
    }
  });
});

app.get('/diagnostics-overlay.js', (req, res) => {
  const filePath = path.join(__dirname, 'diagnostics-overlay.js');
  res.setHeader('Content-Type', 'application/javascript');
  res.sendFile(filePath);
});

app.get('/test-coordinate-system.js', (req, res) => {
  const filePath = path.join(__dirname, 'test-coordinate-system.js');
  res.setHeader('Content-Type', 'application/javascript');
  res.sendFile(filePath);
});

app.get('/src/:filename(*)', (req, res) => {
  const filePath = path.join(__dirname, 'src', req.params.filename);
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.sendFile(filePath, err => {
    if (err) {
      console.error('[Static] Failed to serve src file:', req.path, err.message);
      res.status(404).send('File not found');
    }
  });
});

// SPA fallback (last route)
app.get('*', (req, res) => {
  // Disable caching for index.html during development
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  // Read and inject environment variables into index.html
  const indexPath = path.join(__dirname, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');

  // Inject window.__ENV with public Supabase config (anon key only, not service key)
  const envScript = `<script>
    window.__ENV = {
      VITE_SUPABASE_URL: "${process.env.VITE_SUPABASE_URL || ''}",
      VITE_SUPABASE_ANON_KEY: "${process.env.VITE_SUPABASE_ANON_KEY || ''}"
    };
  </script>`;

  // Insert before closing </head> tag
  html = html.replace('</head>', `${envScript}\n</head>`);

  res.send(html);
});
