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

### Option 1: Local Development

1. Install dependencies:
```bash
npm install
```

2. Install Python dependencies for background removal:
```bash
pip install -r requirements.txt
```

3. Start the server:
```bash
npm start
```

4. Open your browser and navigate to `http://localhost:3000`

5. **Test background removal:** Visit `http://localhost:3000/test-rembg-endpoint.html` to test the background removal API

### Option 2: Docker (Recommended)

1. Ensure Docker and Docker Compose are installed on your system

2. Build and start the application:
```bash
docker-compose up --build
```

3. Open your browser and navigate to `http://localhost:3000`

4. **Test background removal:** Visit `http://localhost:3000/test-rembg-endpoint.html` to test the background removal API

#### Docker Commands

- **Build the image:**
```bash
docker-compose build
```

- **Start the application:**
```bash
docker-compose up
```

- **Start in background:**
```bash
docker-compose up -d
```

- **Stop the application:**
```bash
docker-compose down
```

- **View logs:**
```bash
docker-compose logs
```

- **Rebuild and restart:**
```bash
docker-compose up --build --force-recreate
```

#### Docker Features

- **Background Removal**: Integrated Python rembg for automatic background removal from images
- **Persistent Storage**: Uploads are mounted as volumes for data persistence
- **Health Checks**: Automatic health monitoring of the application
- **Production Ready**: Optimized for production deployment

### Background Removal Setup

OpenPaint includes integrated background removal functionality using Python's rembg library:

- **Docker**: Automatically included and configured
- **Local**: Install Python dependencies with `pip install -r requirements.txt`

The background removal API endpoint `/api/remove-background` accepts image uploads and returns processed images with transparent backgrounds.

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

## Development

- Use `npm run lint` to check code quality
- Contributions are welcome through pull requests

## License

This project is licensed under the MIT License - see the LICENSE file for details.
