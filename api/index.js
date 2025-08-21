/**
 * Vercel Serverless Function for OpenPaint
 * This is the main entry point for the Vercel deployment
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const {
	isDbConfigured,
	ensureSchema,
	createOrUpdateProject,
	getProjectBySlug
} = require('./db');

// In-memory storage for shared projects (in production, use a database)
const sharedProjects = new Map();

// Middleware setup
// Parse JSON request bodies
app.use(express.json({ limit: '50mb' }));

// CORS headers
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    next();
});

// Route handlers
// API routes only - static files are served by Vercel

// Root route - serve index.html
app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, '../index.html');
    fs.readFile(indexPath, 'utf8', (err, data) => {
        if (err) {
            console.error('Error reading index.html:', err);
            return res.status(500).send('Error loading page');
        }
        res.setHeader('Content-Type', 'text/html');
        res.send(data);
    });
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

        // Prefer DB when configured; otherwise fall back to in-memory map
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

        // Persist update when DB is configured; otherwise keep in-memory
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
 * Serve the shared project viewer page
 */
app.get('/shared/:shareId', (req, res) => {
    // Serve the shared project page; the page will fetch via /api/shared/:shareId
    res.sendFile(path.join(__dirname, '../shared.html'));
});

/**
 * API endpoint for uploading project files (simplified for serverless)
 * Accepts project data directly instead of file uploads
 */
app.post('/api/upload-project', (req, res) => {
    try {
        const { projectData } = req.body;
        
        if (!projectData) {
            return res.status(400).json({ success: false, message: 'Project data is required' });
        }
        
        // For serverless, we'll just acknowledge the upload
        return res.json({ 
            success: true, 
            message: 'Project data received successfully'
        });
    } catch (error) {
        console.error('Error handling project upload:', error);
        return res.status(500).json({ success: false, message: 'Server error handling upload' });
    }
});







// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ 
        success: false, 
        message: 'Server error',
        error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
    });
});

// Export the Express app for Vercel
module.exports = app;
