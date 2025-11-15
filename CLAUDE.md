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