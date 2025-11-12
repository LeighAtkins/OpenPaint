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

## Common Project Issues

### Tailwind CSS Build Not Generating Utility Classes

**Problem**: The Tailwind CSS build process wasn't generating all the utility classes used in the HTML. The old input file (`css/tailwind.css`) was a pre-built CSS file instead of a proper Tailwind v4 input file, so when the build ran, it just copied the old CSS without generating new classes like:

- `bottom-16` (for positioning)
- `bg-blue-700`, `bg-blue-800` (for button hover/active states)
- `bg-green-600`, `bg-green-700` (for Save button colors)
- `bg-gray-600`, `bg-gray-700` (for other button colors)

This resulted in invisible panels and buttons with incorrect colors.

**Solution**:

1. **Created proper Tailwind v4 input file** at `css/tailwind.input.css`:
   ```css
   @import "tailwindcss";
   ```

2. **Updated the build script** in `package.json`:
   ```json
   "build:css": "npx --yes @tailwindcss/cli -i \"./css/tailwind.input.css\" -o \"./css/tailwind.build.css\" --minify"
   ```

3. **Rebuild CSS** to generate all utility classes:
   ```bash
   npm run build:css
   ```

**Note**: Tailwind v4 requires a proper input file with the `@import "tailwindcss"` directive. It scans the codebase (configured in `tailwind.config.js`) and generates only the utility classes that are actually used in the HTML files.