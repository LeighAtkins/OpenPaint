/**
 * Main application server for OpenPaint
 * Handles file operations, static file serving, and API endpoints
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { spawn } = require('child_process');
const dotenv = require('dotenv');
dotenv.config();
const app = express();
const port = process.env.PORT || 3000;

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
app.use(cors());

// Parse JSON request bodies with higher limit (for base64 images)
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ limit: '25mb', extended: true }));

// Serve static files from public directory
app.use(express.static('public'));
// Serve static files from root directory
app.use(express.static('./'));

// Serve uploaded files with proper handling for URL-encoded filenames
app.use('/uploads', express.static(uploadDir));

// Route handlers
// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
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

        // Process image with Python rembg
        await processImageWithRembg(inputPath, outputPath);

        // Return the processed image URL (URL-encoded to handle special characters)
        const processedFilename = path.basename(outputPath);
        const processedImageUrl = `/uploads/${encodeURIComponent(processedFilename)}`;
        const originalFilename = req.file.filename;
        const originalImageUrl = `/uploads/${encodeURIComponent(originalFilename)}`;

        // Include a backward-compatible alias `url` used by older test pages
        res.json({
            success: true,
            original: originalImageUrl,
            processed: processedImageUrl,
            url: processedImageUrl
        });

    } catch (error) {
        console.error('Error processing image:', error);
        res.status(500).json({ success: false, message: 'Failed to process image' });
    }
});

/**
 * Python rembg processing function using inline script execution
 */
async function processImageWithRembg(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        // Create a temporary Python script file to avoid command line issues
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

        print(f"Input path: {input_path}")
        print(f"Output path: {output_path}")

        # Check if input file exists
        if not os.path.exists(input_path):
            print(f"Error: Input file does not exist: {input_path}", file=sys.stderr)
            sys.exit(1)

        # Get file size
        file_size = os.path.getsize(input_path)
        print(f"Input file size: {file_size} bytes")

        # Read input image
        with open(input_path, 'rb') as f:
            input_data = f.read()

        print(f"Input data size: {len(input_data)} bytes")

        # Try to identify image format using PIL
        try:
            image = Image.open(io.BytesIO(input_data))
            print(f"Image format: {image.format}")
            print(f"Image size: {image.size}")
            print(f"Image mode: {image.mode}")
            image.close()
        except Exception as format_error:
            print(f"Error identifying image format: {str(format_error)}", file=sys.stderr)
            # Continue anyway - rembg might handle it

        print("Processing image with rembg...")

        # Remove background
        output_data = remove(input_data)

        print(f"Output data size: {len(output_data)} bytes")

        # Ensure output directory exists
        output_dir = os.path.dirname(output_path)
        if output_dir and not os.path.exists(output_dir):
            os.makedirs(output_dir, exist_ok=True)

        # Save output
        with open(output_path, 'wb') as f:
            f.write(output_data)

        print(f"Background removed successfully. Output saved to: {output_path}")

    except Exception as e:
        print(f"Error processing image: {str(e)}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python script.py <input_path> <output_path>", file=sys.stderr)
        sys.exit(1)
    main()
`;

        // Write the Python script to a temporary file
        const tempScriptPath = path.join(__dirname, 'temp_rembg_script.py');
        fs.writeFileSync(tempScriptPath, pythonScript);

        // Use Python 3 to run the script
        const pythonProcess = spawn('python3', [tempScriptPath, inputPath, outputPath], {
            stdio: 'inherit'
        });

        let hasError = false;

        pythonProcess.on('close', (code) => {
            // Clean up temporary script
            try {
                if (fs.existsSync(tempScriptPath)) {
                    fs.unlinkSync(tempScriptPath);
                }
            } catch (cleanupError) {
                console.warn('Failed to clean up temporary script:', cleanupError);
            }

            if (code === 0 && !hasError) {
                resolve();
            } else {
                reject(new Error(`Python process exited with code ${code}`));
            }
        });

        pythonProcess.on('error', (error) => {
            hasError = true;
            // Clean up temporary script
            try {
                if (fs.existsSync(tempScriptPath)) {
                    fs.unlinkSync(tempScriptPath);
                }
            } catch (cleanupError) {
                console.warn('Failed to clean up temporary script:', cleanupError);
            }
            reject(error);
        });
    });
}

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
});

// Start the server
app.listen(port, () => {
    console.log(`OpenPaint app listening at http://localhost:${port}`);
});
