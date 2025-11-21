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

// In-memory storage for shared projects (in production, use a database)
const sharedProjects = new Map();

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  console.log('Created uploads directory');
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
// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/env-check', (req, res) => {
  res.json({
    AI_WORKER_URL: (process.env.AI_WORKER_URL || '').trim(),
    HAS_AI_WORKER_KEY: Boolean((process.env.AI_WORKER_KEY || '').trim()),
    ROUTES_MOUNTED: true
  });
});

// Minimal test endpoint to check if Express works at all
app.get('/test', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
 * API endpoint for background removal using integrated Python rembg
 * Accepts multipart form-data with field name 'image'
 * Returns JSON containing URLs to both original and processed images
 */
app.post('/api/remove-background', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image uploaded (field name should be "image")' });
    }

    const inputPath = req.file.path;
    const outputPath = path.join(uploadDir, `processed_${req.file.filename}`);

    await processImageWithRembg(inputPath, outputPath);

    const processedFilename = path.basename(outputPath);
    const processedImageUrl = `/uploads/${encodeURIComponent(processedFilename)}`;
    const originalFilename = req.file.filename;
    const originalImageUrl = `/uploads/${encodeURIComponent(originalFilename)}`;

    return res.json({
      success: true,
      original: originalImageUrl,
      processed: processedImageUrl,
      url: processedImageUrl
    });
  } catch (error) {
    console.error('Error processing image:', error);
    return res.status(500).json({ success: false, message: 'Failed to process image' });
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

// AI Worker configuration with startup logging
const AI_WORKER_URL = (process.env.AI_WORKER_URL || 'http://localhost:8787')
  .replace(/^\s*-\s*/, '') // strip accidental "- "
  .trim();
const AI_WORKER_KEY = (process.env.AI_WORKER_KEY || '').trim();

console.log('[AI Relay] Using AI_WORKER_URL:', JSON.stringify(AI_WORKER_URL));
console.log('[AI Relay] Has KEY:', AI_WORKER_KEY ? 'yes' : 'no');

function joinUrl(base, path) {
  return `${base.replace(/\/+$/, '')}/${String(path).replace(/^\/+/, '')}`;
}

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
 * Generate AI-enhanced SVG from strokes
 */
app.post('/ai/generate-svg', async (req, res) => {
  try {
    if (!req.body || !req.body.image || !Array.isArray(req.body.strokes)) {
      return res.status(400).json({ error: 'Invalid input: image and strokes required' });
    }

    const target = joinUrl(AI_WORKER_URL, '/generate-svg');
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
  app.listen(port, '0.0.0.0', () => {
    console.log(`OpenPaint app listening at http://localhost:${port}`);
  });
}

/**
 * Python rembg processing function using inline script execution
 */
async function processImageWithRembg(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const fs = require('fs');
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
    py.on('error', (err) => { failed = true; try { fs.unlinkSync(tempScriptPath); } catch (_) {} reject(err); });
    py.on('close', (code) => {
      try { fs.unlinkSync(tempScriptPath); } catch (_) {}
      if (!failed && code === 0) return resolve();
      reject(new Error(`Python process exited with code ${code}`));
    });
  });
}

// Export for Vercel
module.exports = app;
