/**
 * Main application server for OpenPaint
 * Handles file operations, static file serving, and API endpoints
 */

const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const crypto = require('crypto');
const app = express();
const {
    isDbConfigured,
    ensureSchema,
    createOrUpdateProject,
    getProjectBySlug
} = require('./api/db');
const { spawn } = require('child_process');
const port = process.env.PORT || 3000;

// AI Worker configuration with startup logging
const AI_WORKER_URL = (process.env.AI_WORKER_URL || "http://localhost:8787")
  .replace(/^\s*-\s*/, "") // strip accidental "- "
  .trim();
const AI_WORKER_KEY = (process.env.AI_WORKER_KEY || "").trim();

// Cloudflare Images configuration
const CF_ACCOUNT_ID = (process.env.CF_ACCOUNT_ID || "").trim();
const CF_IMAGES_API_TOKEN = (process.env.CF_IMAGES_API_TOKEN || "").trim();
const CF_ACCOUNT_HASH = (process.env.CF_ACCOUNT_HASH || "").trim();

console.log("[AI Relay] Using AI_WORKER_URL:", JSON.stringify(AI_WORKER_URL));
console.log("[AI Relay] Has KEY:", AI_WORKER_KEY ? "yes" : "no");
console.log("[Cloudflare Images] Account ID:", CF_ACCOUNT_ID ? "configured" : "missing");
console.log("[Cloudflare Images] API Token:", CF_IMAGES_API_TOKEN ? "configured" : "missing");
console.log("[Cloudflare Images] Account Hash:", CF_ACCOUNT_HASH ? "configured" : "missing");

function joinUrl(base, path) {
  return `${String(base).replace(/\/+$/, "")}/${String(path).replace(/^\/+/, "")}`;
}

// In-memory storage for shared projects (in production, use a database)
const sharedProjects = new Map();

// Ensure uploads directory exists
// In Vercel's serverless environment, use /tmp for writable storage
const uploadDir = process.env.VERCEL ? '/tmp/uploads' : path.join(__dirname, 'uploads');
try {
    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
        console.log('Created uploads directory:', uploadDir);
    }
} catch (err) {
    console.warn('Could not create uploads directory:', err.message);
    console.warn('File uploads may not work properly');
}

// Set up multer for handling file uploads
const storage = multer.diskStorage({
    destination: function(req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function(req, file, cb) {
        // Use a timestamp to ensure unique filenames
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 200 * 1024 * 1024 } // 200MB limit
});

// Middleware setup
// Serve static files from public directory
app.use(express.static('public'));
// Serve static files from root directory
app.use(express.static('./'));
// Serve uploaded files under /uploads
app.use('/uploads', express.static(uploadDir));
// Parse JSON request bodies (increase limit for large projects)
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ extended: true, limit: '200mb' }));

// Route handlers
app.get("/health", (req, res) => res.json({ ok: true, ts: Date.now() }));

app.get('/version', (req, res) => {
  res.json({ commit: process.env.VERCEL_GIT_COMMIT_SHA || null, ts: Date.now() });
});

app.post('/ai/echo', (req, res) => {
  res.json({ got: Object.keys(req.body || {}), sample: req.body?.imageUrl || null });
});

app.get("/env-check", (req, res) => {
  res.json({
    AI_WORKER_URL: (process.env.AI_WORKER_URL || "").trim(),
    HAS_AI_WORKER_KEY: Boolean((process.env.AI_WORKER_KEY || "").trim()),
    ROUTES_MOUNTED: true
  });
});

// Minimal test endpoint to check if Express works at all
app.get("/test", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});
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
            expiresAt: shareOptions.expiresAt ? new Date(shareOptions.expiresAt) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            isPublic: shareOptions.isPublic || false,
            allowEditing: shareOptions.allowEditing || false,
            measurements: shareOptions.measurements || {}
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
            expiresAt: shareRecord.expiresAt
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
                measurements: shareRecord.measurements
            }
        });
    } catch (error) {
        console.error('Error retrieving shared project:', error);
        return res.status(500).json({ success: false, message: 'Server error retrieving shared project' });
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
            shareId: shareId
        };

        if (!Array.isArray(shareRecord.submissions)) {
            shareRecord.submissions = [];
        }
        shareRecord.submissions.push(submission);

        if (isDbConfigured()) {
            await createOrUpdateProject({ slug: shareId, title: null, data: shareRecord, editToken: null });
        } else {
            sharedProjects.set(shareId, shareRecord);
        }

        console.log(`Received measurements for share ${shareId}: ${submissionId} (db=${isDbConfigured()})`);

        return res.json({
            success: true,
            submissionId: submissionId,
            message: 'Measurements submitted successfully'
        });
    } catch (error) {
        console.error('Error submitting measurements:', error);
        return res.status(500).json({ success: false, message: 'Server error submitting measurements' });
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
            if (!dbRow) return res.status(404).json({ success: false, message: 'Shared project not found' });
            if (dbRow.edit_token !== editToken) return res.status(403).json({ success: false, message: 'Invalid edit token' });
            shareRecord = dbRow.data;
        } else {
            shareRecord = sharedProjects.get(shareId);
            if (!shareRecord) return res.status(404).json({ success: false, message: 'Shared project not found' });
            if (shareRecord.editToken && shareRecord.editToken !== editToken) {
                return res.status(403).json({ success: false, message: 'Invalid edit token' });
            }
        }

        const measurements = shareRecord.measurements || {};
        
        return res.json({ 
            success: true, 
            measurements: measurements,
            totalSubmissions: Object.keys(measurements).length
        });
    } catch (error) {
        console.error('Error retrieving measurements:', error);
        return res.status(500).json({ success: false, message: 'Server error retrieving measurements' });
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
            fileName: req.file.originalname
        });
    } catch (error) {
        console.error('Error handling project upload:', error);
        return res.status(500).json({ success: false, message: 'Server error handling upload' });
    }
});

/**
 * API endpoint for background removal - proxies to Cloudflare Worker
 * Accepts JSON with imageUrl or base64 data
 * Returns processed image from AI Worker
 */
app.post('/api/remove-background', async (req, res) => {
  try {
    const base = process.env.CF_WORKER_URL || AI_WORKER_URL || '';
    if (!base) {
      return res
        .status(500)
        .set('content-type', 'application/json; charset=utf-8')
        .json({
          ok: false,
          error: 'missing-CF_WORKER_URL',
          message: 'Set CF_WORKER_URL to your Worker base URL'
        });
    }
    const url = `${base.replace(/\/$/, '')}/remove-background`;
    const headers = { 'content-type': 'application/json' };
    if (req.headers['x-api-key']) {
      headers['x-api-key'] = String(req.headers['x-api-key']);
    }

    const bodyText = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
    let upstream;
    try {
      upstream = await fetch(url, {
        method: 'POST',
        headers,
        body: bodyText
      });
    } catch (e) {
      return res
        .status(502)
        .set('content-type', 'application/json; charset=utf-8')
        .json({
          ok: false,
          error: 'fetch-exception',
          message: e.message
        });
    }

    const ct = upstream.headers.get('content-type') || 'application/octet-stream';
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status).set('content-type', ct).send(buf);
  } catch (err) {
    res
      .status(500)
      .set('content-type', 'application/json; charset=utf-8')
      .json({
        ok: false,
        error: 'proxy-exception',
        message: String(err)
      });
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
            if (!dbRow) return res.status(404).json({ success: false, message: 'Shared project not found' });
            if (dbRow.edit_token !== editToken) return res.status(403).json({ success: false, message: 'Invalid edit token' });
            shareRecord = dbRow.data;
        } else {
            shareRecord = sharedProjects.get(shareId);
            if (!shareRecord) return res.status(404).json({ success: false, message: 'Shared project not found' });
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
            if (typeof shareOptions.allowEditing === 'boolean') shareRecord.allowEditing = shareOptions.allowEditing;
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
        return res.status(500).json({ success: false, message: 'Server error updating shared project' });
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
app.post("/ai/generate-svg", async (req, res) => {
  try {
    const r = await fetch(joinUrl(AI_WORKER_URL, "/generate-svg"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": AI_WORKER_KEY
      },
      body: JSON.stringify(req.body)
    });
    const text = await r.text();
    return res.status(r.status).type("application/json").send(text);
  } catch (e) {
    console.error("[AI Relay] /generate-svg failed:", e);
    return res.status(502).json({ error: "Relay fetch failed", detail: String(e) });
  }
});

/**
 * Assist with measurement calculation
 */
app.post("/ai/assist-measurement", async (req, res) => {
  try {
    if (!req.body || !req.body.units || !req.body.stroke) {
      return res.status(400).json({ error: "Invalid input: units and stroke required" });
    }

    const target = joinUrl(AI_WORKER_URL, "/assist-measurement");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);

    let r, text;
    try {
      r = await fetch(target, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": AI_WORKER_KEY,
          "X-Request-ID": crypto.randomUUID(),
        },
        body: JSON.stringify(req.body),
        signal: controller.signal,
      });
      text = await r.text();
    } catch (e) {
      clearTimeout(timer);
      console.error("[AI Relay] Fetch failed:", e);
      return res.status(502).json({ error: "Relay fetch failed", detail: String(e) });
    }
    clearTimeout(timer);

    if (!r.ok) {
      console.error("[AI Relay] Worker error:", r.status, text);
      return res.status(r.status).type("application/json").send(text);
    }

    return res.type("application/json").send(text);
  } catch (e) {
    console.error("[AI Relay] Route crash:", e);
    return res.status(500).json({ error: "Relay crashed", detail: String(e) });
  }
});

/**
 * Enhance annotation placement
 */
app.post("/ai/enhance-placement", async (req, res) => {
  try {
    if (!req.body || !req.body.image || !Array.isArray(req.body.strokes)) {
      return res.status(400).json({ error: "Invalid input: image and strokes required" });
    }

    const target = joinUrl(AI_WORKER_URL, "/enhance-placement");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);

    let r, text;
    try {
      r = await fetch(target, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": AI_WORKER_KEY,
          "X-Request-ID": crypto.randomUUID(),
        },
        body: JSON.stringify(req.body),
        signal: controller.signal,
      });
      text = await r.text();
    } catch (e) {
      clearTimeout(timer);
      console.error("[AI Relay] Fetch failed:", e);
      return res.status(502).json({ error: "Relay fetch failed", detail: String(e) });
    }
    clearTimeout(timer);

    if (!r.ok) {
      console.error("[AI Relay] Worker error:", r.status, text);
      return res.status(r.status).type("application/json").send(text);
    }

    return res.type("application/json").send(text);
  } catch (e) {
    console.error("[AI Relay] Route crash:", e);
    return res.status(500).json({ error: "Relay crashed", detail: String(e) });
  }
});

/**
 * AI Analyze and Dimension Relay Endpoint
 * Forwards requests to Cloudflare Worker for furniture dimensioning
 */
app.post('/ai/analyze-and-dimension', async (req, res) => {
  try { 
    console.log('[AI Relay] analyze req keys:', Object.keys(req.body || {})); 
  } catch (_){}
  try {
    const r = await fetch(joinUrl((process.env.AI_WORKER_URL || '').trim(), '/analyze-and-dimension'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': (process.env.AI_WORKER_KEY || '').trim()
      },
      body: JSON.stringify(req.body || {})
    });
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
        message: 'Cloudflare Images not configured. Missing CF_ACCOUNT_ID or CF_IMAGES_API_TOKEN.' 
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
        'Authorization': `Bearer ${CF_IMAGES_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        requireSignedURLs: false,
        metadata: {
          key: imageKey,
          purpose: 'ai-furniture-dimensioning'
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Cloudflare Images] Upload URL generation failed:', response.status, errorText);
      return res.status(502).json({ 
        success: false, 
        message: 'Failed to generate upload URL',
        detail: errorText
      });
    }

    const data = await response.json();
    
    if (!data.success) {
      console.error('[Cloudflare Images] API error:', data.errors);
      return res.status(502).json({ 
        success: false, 
        message: 'Cloudflare Images API error',
        errors: data.errors
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
      deliveryUrl: deliveryUrl
    });

  } catch (error) {
    console.error('Error generating presigned upload URL:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error generating upload URL',
      detail: error.message 
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
});

// export for Vercel
module.exports = app;

// keep local server only when run directly
if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, "0.0.0.0", () => {
    console.log(`OpenPaint app listening at http://localhost:${port}`);
  });
}

// Serve static files with proper MIME types
app.get('/js/:filename(*)', (req, res) => {
  const filePath = path.join(__dirname, 'js', req.params.filename);
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.sendFile(filePath, (err) => {
    if (err) {
      console.error('[Static] Failed to serve JS file:', req.path, err.message);
      res.status(404).send('File not found');
    }
  });
});

app.get('/css/:filename(*)', (req, res) => {
  const filePath = path.join(__dirname, 'css', req.params.filename);
  res.setHeader('Content-Type', 'text/css; charset=utf-8');
  res.sendFile(filePath, (err) => {
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

// Specific route for ai-export.js to test
app.get('/js/ai-export.js', (req, res) => {
  const filePath = path.join(__dirname, 'js', 'ai-export.js');
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.sendFile(filePath, (err) => {
    if (err) {
      console.error('[Static] Failed to serve ai-export.js:', err.message);
      res.status(404).send('File not found');
    }
  });
});

app.get('/test-coordinate-system.js', (req, res) => {
  const filePath = path.join(__dirname, 'test-coordinate-system.js');
  res.setHeader('Content-Type', 'application/javascript');
  res.sendFile(filePath);
});

app.get('/src/:filename(*)', (req, res) => {
  const filePath = path.join(__dirname, 'src', req.params.filename);
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.sendFile(filePath, (err) => {
    if (err) {
      console.error('[Static] Failed to serve src file:', req.path, err.message);
      res.status(404).send('File not found');
    }
  });
});

// SPA fallback (last route)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Export for Vercel
module.exports = app;
