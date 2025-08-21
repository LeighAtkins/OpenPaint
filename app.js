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
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// Middleware setup
// Serve static files from public directory
app.use(express.static('public'));
// Serve static files from root directory
app.use(express.static('./'));
// Parse JSON request bodies
app.use(express.json({ limit: '50mb' }));

// Route handlers
// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
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

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
});

// Start the server
app.listen(port, () => {
    console.log(`OpenPaint app listening at http://localhost:${port}`);
});
