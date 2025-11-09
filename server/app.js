const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Ensure global fetch availability (Node 22.x should have it, but add polyfill as safeguard)
if (typeof fetch === 'undefined') {
    global.fetch = (...args) =>
        import('node-fetch').then(({ default: f }) => f(...args));
}

const app = express();

// Middleware
app.set('trust proxy', true);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    next();
});

// Route handlers - ALL WITHOUT /api PREFIX

// Handlers extracted for dual-path mounting during routing migration
async function directUploadHandler(req, res) {
    try {
        const base = process.env.CF_WORKER_URL || '';
        if (!base) {
            console.error('[Proxy] Missing CF_WORKER_URL');
            return res.status(500).json({
                ok: false,
                error: 'missing-CF_WORKER_URL',
                message: 'Set CF_WORKER_URL to your Worker base URL'
            });
        }
        const origin = base.replace(/\/$/, '');
        const targetUrl = `${origin}/images/direct-upload`;

        const headers = {};
        if (req.headers && req.headers['x-api-key']) {
            headers['x-api-key'] = String(req.headers['x-api-key']);
        }

        console.log('[Proxy] direct-upload target:', targetUrl);
        console.log('[Proxy] x-api-key header present:', Boolean(headers['x-api-key']));

        let upstream;
        try {
            upstream = await fetch(targetUrl, { method: 'POST', headers });
        } catch (netErr) {
            console.error('[Proxy] fetch exception:', {
                name: netErr.name,
                message: netErr.message
            });
            return res.status(502).json({
                ok: false,
                error: 'fetch-exception',
                message: netErr.message
            });
        }

        const status = upstream.status;
        const text = await upstream.text().catch(() => '<no body>');
        console.log('[Proxy] upstream status:', status);

        if (!upstream.ok) {
            console.error('[Proxy] upstream non-OK:', status, text.slice(0, 500));
            return res.status(502).json({
                ok: false,
                error: 'upstream-failed',
                status,
                body: text.slice(0, 500)
            });
        }

        try {
            const json = JSON.parse(text);
            return res.status(200).json(json);
        } catch {
            return res
                .status(200)
                .set('content-type', upstream.headers.get('content-type') || 'application/json')
                .send(text);
        }
    } catch (err) {
        console.error('[Proxy] /images/direct-upload exception:', { message: err.message });
        return res.status(500).json({
            ok: false,
            error: 'proxy-exception',
            message: String(err)
        });
    }
}

async function removeBackgroundHandler(req, res) {
    try {
        const base = process.env.CF_WORKER_URL || '';
        if (!base) {
            console.error('[Proxy] Missing CF_WORKER_URL');
            return res.status(500).json({
                ok: false,
                error: 'missing-CF_WORKER_URL'
            });
        }
        const origin = base.replace(/\/$/, '');
        const targetUrl = `${origin}/remove-background`;

        const headers = { 'content-type': 'application/json' };
        if (req.headers['x-api-key']) {
            headers['x-api-key'] = String(req.headers['x-api-key']);
        }

        const bodyText = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
        let upstream;
        try {
            upstream = await fetch(targetUrl, {
                method: 'POST',
                headers,
                body: bodyText
            });
        } catch (netErr) {
            console.error('[Proxy] remove-bg fetch exception:', netErr.message);
            return res.status(502).json({
                ok: false,
                error: 'fetch-exception',
                message: netErr.message
            });
        }

        const ct = upstream.headers.get('content-type') || 'application/octet-stream';
        const buf = Buffer.from(await upstream.arrayBuffer());
        if (!upstream.ok) {
            console.error('[Proxy] remove-bg upstream error:', targetUrl, upstream.status);
        }
        res.status(upstream.status).setHeader('content-type', ct).send(buf);
    } catch (err) {
        console.error('[Proxy] /remove-background exception:', err.message);
        res.status(500).json({
            ok: false,
            error: 'proxy-exception',
            message: String(err)
        });
    }
}

function envHandler(req, res) {
    try {
        const val = process.env.CF_WORKER_URL || '';
        res.status(200).json({
            CF_WORKER_URL: val ? 'configured' : 'missing',
            CF_WORKER_URL_value_preview: val || '<empty>',
            NODE_ENV: process.env.NODE_ENV || 'development'
        });
    } catch (err) {
        console.error('[Env] Exception', err);
        res.status(500).json({
            ok: false,
            error: 'env-handler-exception',
            message: String(err)
        });
    }
}

// Proxy direct upload to Cloudflare Worker (dual-path mounting)
app.post(['/api/images/direct-upload', '/images/direct-upload'], directUploadHandler);

// Proxy background removal (dual-path mounting)
app.post(['/api/remove-background', '/remove-background'], removeBackgroundHandler);

// Debug endpoint to check environment variables (dual-path mounting)
app.get(['/api/_env', '/_env'], envHandler);

/**
 * API endpoint for creating a shareable URL for a project
 * Accepts project data and returns a unique share ID
 */
app.post('/share-project', async (req, res) => {
    try {
        const { projectData, title = null, shareOptions = {} } = req.body;

        if (!projectData) {
            return res.status(400).json({ success: false, message: 'Project data is required' });
        }

        // Generate a unique share ID
        const shareId = crypto.randomBytes(16).toString('hex');
        
        // Generate edit token for future updates
        const editToken = crypto.randomBytes(32).toString('hex');

        // Store the project data (in a real app, this would go to a database)
        // For now, we'll use a simple in-memory store
        if (!global.sharedProjects) {
            global.sharedProjects = new Map();
        }

        const shareRecord = {
            shareId,
            editToken,
            projectData,
            title,
            shareOptions,
            createdAt: new Date().toISOString(),
            lastAccessed: new Date().toISOString()
        };

        global.sharedProjects.set(shareId, shareRecord);

        const proto = (req.get('x-forwarded-proto') || req.protocol);
        res.json({
            success: true,
            shareId,
            editToken,
            shareUrl: `${proto}://${req.get('host')}/shared/${shareId}`,
            message: 'Project shared successfully'
        });

    } catch (error) {
        console.error('Error sharing project:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to share project',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

/**
 * Update an existing shared project (requires editToken)
 */
app.patch('/shared/:shareId', async (req, res) => {
    try {
        const { shareId } = req.params;
        const { editToken, projectData, title = null, shareOptions = {} } = req.body || {};

        if (!editToken) {
            return res.status(400).json({ success: false, message: 'Edit token is required' });
        }

        if (!global.sharedProjects) {
            return res.status(404).json({ success: false, message: 'Shared project not found' });
        }

        const shareRecord = global.sharedProjects.get(shareId);
        if (!shareRecord) {
            return res.status(404).json({ success: false, message: 'Shared project not found' });
        }

        if (shareRecord.editToken !== editToken) {
            return res.status(403).json({ success: false, message: 'Invalid edit token' });
        }

        // Update the project data
        shareRecord.projectData = projectData;
        shareRecord.title = title;
        shareRecord.shareOptions = shareOptions;
        shareRecord.lastAccessed = new Date().toISOString();

        global.sharedProjects.set(shareId, shareRecord);

        const proto = (req.get('x-forwarded-proto') || req.protocol);
        res.json({
            success: true,
            message: 'Project updated successfully',
            shareId,
            shareUrl: `${proto}://${req.get('host')}/shared/${shareId}`
        });

    } catch (error) {
        console.error('Error updating shared project:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update project',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

/**
 * API endpoint for retrieving a shared project
 * Returns project data for a given share ID
 */
app.get('/shared/:shareId', async (req, res) => {
    try {
        const { shareId } = req.params;
        let shareRecord;

        if (isDbConfigured()) {
            // Database implementation would go here
            shareRecord = await getSharedProjectFromDb(shareId);
        } else {
            // Fallback to in-memory store
            if (!global.sharedProjects) {
                return res.status(404).json({ success: false, message: 'Shared project not found' });
            }
            shareRecord = global.sharedProjects.get(shareId);
        }

        if (!shareRecord) {
            return res.status(404).json({ success: false, message: 'Shared project not found' });
        }

        // Update last accessed time
        shareRecord.lastAccessed = new Date().toISOString();
        if (global.sharedProjects) {
            global.sharedProjects.set(shareId, shareRecord);
        }

        res.json({
            success: true,
            shareId,
            projectData: shareRecord.projectData,
            title: shareRecord.title,
            shareOptions: shareRecord.shareOptions,
            createdAt: shareRecord.createdAt,
            lastAccessed: shareRecord.lastAccessed
        });

    } catch (error) {
        console.error('Error retrieving shared project:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve project',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

/**
 * API endpoint for submitting customer measurements
 * Accepts measurement data for a shared project
 */
app.post('/shared/:shareId/measurements', async (req, res) => {
    try {
        const { shareId } = req.params;
        const { measurements, customerInfo = {} } = req.body;

        // Validate measurements (basic validation)
        if (!measurements || typeof measurements !== 'object') {
            return res.status(400).json({ 
                success: false, 
                message: 'Valid measurements object is required' 
            });
        }

        // Store measurements (in a real app, this would go to a database)
        if (!global.projectMeasurements) {
            global.projectMeasurements = new Map();
        }

        const measurementRecord = {
            shareId,
            measurements,
            customerInfo,
            submittedAt: new Date().toISOString(),
            id: crypto.randomBytes(8).toString('hex')
        };

        global.projectMeasurements.set(measurementRecord.id, measurementRecord);

        res.json({
            success: true,
            message: 'Measurements submitted successfully',
            measurementId: measurementRecord.id,
            submittedAt: measurementRecord.submittedAt
        });

    } catch (error) {
        console.error('Error submitting measurements:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to submit measurements',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

/**
 * API endpoint for uploading project files (simplified for serverless)
 * Accepts project data directly instead of file uploads
 */
app.post('/upload-project', (req, res) => {
    try {
        const { projectData } = req.body;
        
        if (!projectData) {
            return res.status(400).json({ success: false, message: 'Project data is required' });
        }

        // In a real implementation, you would save the project data to a database
        // For now, we'll just return a success response
        res.json({
            success: true,
            message: 'Project uploaded successfully',
            projectId: crypto.randomBytes(8).toString('hex')
        });

    } catch (error) {
        console.error('Error uploading project:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to upload project',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

// Helper functions
function isDbConfigured() {
    // Check if database is configured
    return false; // For now, always use in-memory storage
}

async function getSharedProjectFromDb(shareId) {
    // Database implementation would go here
    return null;
}

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        success: false,
        message: 'Server error',
        error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
    });
});

// Catch-all route for any unmatched paths
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found', path: req.url });
});

module.exports = app;
