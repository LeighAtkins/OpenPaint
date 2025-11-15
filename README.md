# OpenPaint

A web-based drawing and annotation tool designed for email communication of measurements and specifications.

## Features

- Drawing functionality with adjustable brush size and color
- Support for straight lines and freehand drawing
- Measurement labeling and annotation
- Multiple image support with folder organization
- Copy and paste images from clipboard (supports JPG and PNG)
- Import images and folders from your file system
- Save and load projects (preserves measurements, annotations, and folder structure)
- Zoom and pan functionality for detailed work
- Clean and responsive interface
- **AI-Powered Furniture Dimensioning** (NEW)
  - Automatic silhouette detection using REMBG background removal
  - One-click calibration with real-world measurements
  - Generate professional dimensioned drawings
  - Support for front and top view furniture images
  - Export AI-generated SVG files

## Project Structure

```
OpenPaint/
├── app.js               # Express server setup
├── index.html           # Main application HTML
├── package.json         # Project dependencies
├── public/              # Client-facing assets
│   ├── css/             # Stylesheets
│   └── js/              # Client-side JavaScript
│       ├── paint.js     # Core drawing functionality
│       └── project-manager.js  # Project save/load functionality
├── src/                 # Source code directory
├── backend/             # Backend-specific code
├── uploads/             # Temporary storage for uploaded files
└── tests/               # Test files
```

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment variables (for AI features):
```bash
# Required for AI-powered dimensioning
CF_ACCOUNT_ID=your_cloudflare_account_id
CF_IMAGES_API_TOKEN=your_cloudflare_images_api_token
CF_ACCOUNT_HASH=your_cloudflare_account_hash
AI_WORKER_URL=https://your-worker.your-subdomain.workers.dev
AI_WORKER_KEY=your_worker_secret_key
```

3. Start the server:
```bash
npm start
```

4. Open your browser and navigate to `http://localhost:3000`

## Usage

### Basic Drawing
- Draw using your mouse (freehand mode)
- Use straight line mode for precise measurements
- Adjust brush color using the color picker
- Change brush size using the slider
- Clear canvas with the Clear button

### Images and Organization
- Paste images using Ctrl+V (Windows) or Command+V (Mac)
- Drag and drop image files or folders onto the canvas
- Navigate between images using the sidebar
- Organize images in folders for better management

### Measurements and Annotations
- Add measurements to lines by clicking on them
- Drag labels to reposition them
- Edit measurements and labels through the edit dialog
- Toggle visibility of specific measurements

### Project Management
- Save your project with all measurements and organization using the Save Project button
- Load existing projects with the Load Project button

### AI-Powered Dimensioning
1. **Upload an image** of furniture (sofa, chair, etc.) using the Upload Images button
2. **Click "🤖 Generate Sofa Basics"** in the Drawing Tools panel
3. **Calibrate the measurement** by entering the real-world width of the furniture
4. **Review the AI-generated dimensions** in the preview modal
5. **Accept or Save** the dimensions to add them as a separate AI layer
6. **Toggle AI layer visibility** in the stroke list to show/hide AI dimensions

**Supported Views:**
- Front view: Generates overall width, seat width, and back height
- Top view: Generates overall width and depth
- Works best with furniture images that have clear silhouettes

## Development

- Use `npm run lint` to check code quality
- Contributions are welcome through pull requests

## License

This project is licensed under the MIT License - see the LICENSE file for details.
