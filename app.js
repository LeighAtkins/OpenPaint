/**
 * Main application server for OpenPaint
 * Handles file operations, static file serving, and API endpoints
 */

import dotenv from 'dotenv';
dotenv.config({ path: process.env.NODE_ENV === 'production' ? '.env' : '.env.development' });
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
import { spawn } from 'child_process';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

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
      data: projectData,
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
      shareUrl: `${req.protocol}://${req.get('host')}/open/${projectId}`,
      createdAt: now,
      expiresAt: expiry,
    });
  } catch (error) {
    console.error('Error creating cloud project:', error);
    return res.status(500).json({ success: false, message: 'Server error creating project' });
  }
});

app.get('/api/cloud-projects/:projectId', async (req, res) => {
  try {
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
      shareUrl: `${req.protocol}://${req.get('host')}/shared/${shareId}`,
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
  res.sendFile(path.join(__dirname, 'public/production.html'));
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
