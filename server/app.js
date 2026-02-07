import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

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
