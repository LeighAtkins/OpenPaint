const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const app = express();
const port = 3000;

// Set up multer for handling file uploads
const storage = multer.diskStorage({
    destination: function(req, file, cb) {
        const uploadDir = path.join(__dirname, 'uploads');
        // Create directory if it doesn't exist
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
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

// Serve static files from public directory
app.use(express.static('public'));
// Serve static files from root directory
app.use(express.static('./'));
app.use(express.json());

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// API endpoint for uploading project files
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

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
});

app.listen(port, () => {
    console.log(`OpenPaint app listening at http://localhost:${port}`);
});
