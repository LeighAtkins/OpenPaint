# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Development Commands

```bash
# Start the application
npm start

# Lint code (check for style/quality issues)
npm run lint

# Fix lint issues automatically
npm run lint:fix

# Install dependencies
npm install
```

## Application Architecture

OpenPaint is a web-based drawing and annotation tool built with:

- **Backend**: Node.js Express server (`app.js`) handling file uploads and static serving
- **Frontend**: Vanilla JavaScript client-side application with no frameworks
- **Main Client Files**:
  - `public/js/paint.js` - Core drawing functionality, event handling, and canvas operations
  - `public/js/project-manager.js` - Project save/load functionality using ZIP format
  - `public/js/arrow_functions.js` - Arrow drawing utilities
  - `public/js/tag-manager.js` - Image organization and tagging

### Core State Management

The application uses a centralized state object `window.paintApp` with:
- `config` - Application constants and settings
- `state` - Drawing state, images, measurements, and project data
- `uiState` - UI interaction state (drawing mode, selections, etc.)

### Key Features

- **Drawing System**: Supports freehand, straight lines, curves, and arrows
- **Image Management**: Multiple images with folder organization and tagging
- **Measurements**: Line measurements with customizable labels and positioning
- **Project Persistence**: Save/load projects as ZIP files containing images and metadata
- **Canvas Operations**: Zoom, pan, and viewport management per image

### File Upload Handling

- Server accepts uploads to `/api/upload-project` endpoint
- Files stored in `uploads/` directory with timestamp prefixes
- Client handles ZIP extraction and project restoration

### Development Guidelines

- **No Frameworks**: Use vanilla JavaScript only - no React, Vue, Angular, etc.
- **Backend**: Standard Express.js patterns with Node.js built-in modules
- **API Format**: JSON for request/response bodies
- **Client Libraries**: Browser APIs, JSZip for ZIP handling, FileSaver.js for downloads

### Code Organization

- Drawing operations are centralized in `paint.js` with the `paintApp` namespace
- Project data is stored in structured objects by image label
- Event handling uses modern browser APIs with proper cleanup
- Multiple backup files exist in `public/js/` - use `paint.js` as the main file
- **Active code is in `public/js/modules/`** - the `src/modules/` directory is for TypeScript migration and is NOT used by the running app

### Fabric.js Zoom Implementation (IMPORTANT)

When implementing zoom with Fabric.js, **do NOT call `applyViewportTransform()` after `zoomToPoint()`**. The `zoomToPoint()` method already sets the correct viewport transform. Calling `applyViewportTransform()` afterward will corrupt the transform and cause the canvas to drift.

**Correct pattern:**
```javascript
this.fabricCanvas.zoomToPoint({ x: mouseX, y: mouseY }, zoom);
this.zoomLevel = zoom;
// Compute panX/panY so applyViewportTransform would reproduce this transform
if (this.fabricCanvas.viewportTransform) {
  const vpt = this.fabricCanvas.viewportTransform;
  let centerX = this.fabricCanvas.width / 2;
  let centerY = this.fabricCanvas.height / 2;
  // Use background image center if available
  const bgImage = this.fabricCanvas.backgroundImage;
  if (bgImage && typeof bgImage.getCenterPoint === 'function') {
    const bgCenter = bgImage.getCenterPoint();
    if (typeof bgCenter?.x === 'number' && typeof bgCenter?.y === 'number') {
      centerX = bgCenter.x;
      centerY = bgCenter.y;
    }
  }
  // Subtract the center offset that applyViewportTransform adds
  this.panX = vpt[4] - centerX * (1 - zoom);
  this.panY = vpt[5] - centerY * (1 - zoom);
}
```

**Why this matters:** The `applyViewportTransform()` function adds `centerX*(1-zoom)` to panX when building the transform matrix. If you save `viewportTransform[4]` directly to panX (which already contains a zoom offset from `zoomToPoint`), then call `applyViewportTransform()`, the center offset gets applied twice, causing drift.