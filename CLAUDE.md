# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Development Commands

```bash
# Start the Express server (port 3000)
npm start

# Start Vite dev server (with HMR)
npm run dev

# Lint code (src/ only)
npm run lint

# Fix lint issues automatically
npm run lint:fix

# Run tests
npm test

# TypeScript type checking
npm run type-check

# Full validation (type-check + lint + test)
npm run validate

# Build for production
npm run build

# Deploy to Vercel
npm run deploy
```

## Application Architecture

OpenPaint is a web-based drawing and annotation tool for creating measurement documents and annotated images.

- **Backend**: Node.js Express server (`app.js`) — also deploys as Vercel serverless functions via `/api/`
- **Frontend**: Vanilla JavaScript (migrating to TypeScript), uses Fabric.js for canvas
- **Build**: Vite bundles from `src/main.ts` as the single entrypoint
- **Deployment**: Vercel (production), Express (local dev)

### Canonical Source of Truth

- **`src/`** is the canonical module tree. All application code lives here.
- `src/main.ts` is the single runtime entrypoint.
- Legacy JS modules live in `src/modules/` and are imported through the Vite build — they are gradually being converted to TypeScript.
- `public/` contains only static assets (images, icons, fonts). No application logic.

### Core Manager Classes

| Class | Responsibility |
|---|---|
| `CanvasManager` | Fabric.js canvas lifecycle, zoom/pan, background images, viewport transforms |
| `ToolManager` | Tool selection and switching |
| `StrokeMetadataManager` | Stroke data storage, visibility, labels |
| `HistoryManager` | Undo/redo |
| `ProjectManager` | Save/load projects as ZIP (JSZip + FileSaver.js) |
| `TagManager` | Image tagging and folder organization |
| `UploadManager` | File upload handling, HEIC conversion |
| `MeasurementSystem` | Measurement tracking and label positioning |

### Drawing Tools

`SelectTool`, `PencilTool`, `LineTool`, `CurveTool`, `ArrowTool`, `TextTool`, `ShapeTool`, `FrameTool` — all extend `BaseTool`.

### State Architecture

Three-layer model:
1. **Manager classes** — `window.app.canvasManager`, `window.app.toolManager`, etc.
2. **Window globals** (legacy) — `window.vectorStrokesByImage`, `window.strokeVisibilityByImage`, etc.
3. **Fabric.js objects** — canvas objects with metadata in `obj.customData`

### Critical Data Structures

Five stroke data structures that MUST be preserved during image operations (replacement, background removal, etc.):
- `vectorStrokesByImage` — per-image vector stroke arrays
- `lineStrokesByImage` — per-image line stroke arrays
- `strokeVisibilityByImage` — per-image visibility flags
- `strokeLabelVisibility` — label show/hide state
- `strokeMeasurements` — measurement values per stroke

### Measurement Label Positioning

Labels use a **normalized offset format** for resolution-independent positioning:
```javascript
{ kind: 'norm', dx_norm: float, dy_norm: float, normRef: 'width' | 'height' | 'diag' }
```
Legacy format `{ x: pixels, y: pixels }` is auto-converted via `migrateProject()`.

Related storage maps: `customLabelPositions`, `calculatedLabelOffsets`, `customLabelRotationStamps`, `textElementsByImage`.

### Three Save Modes

1. **Guest Quick Use** — No login, no server calls. Client-side image export (PNG/JPEG). Fast path.
2. **Customer Measurement Export** — PDF export (HTML-to-PDF via Puppeteer) + ZIP bundle (project.json + assets). Optional anonymous share link.
3. **Power User Projects** — Supabase Auth (planned, behind `ENABLE_AUTH` feature flag). Project library with cloud persistence.

### Feature Flags

- `ENABLE_AUTH` — Controls login UI and authenticated project features (not yet implemented)
- `ENABLE_CLOUD_SHARE` — Controls anonymous JSON cloud storage and share links

### Key Features

- **Drawing System**: Freehand, straight lines, Bezier curves, arrows, shapes, text
- **Image Management**: Multiple images with folder organization and tagging
- **Measurements**: Line measurements with customizable labels and drag-to-reposition
- **Project Persistence**: Save/load as ZIP; share via URL; PDF export (planned)
- **Canvas Operations**: Zoom, pan, viewport management per image
- **AI Integration**: Cloudflare Worker for SVG generation, measurement assistance, label placement
- **HEIC Support**: Client-side conversion via `heic2any` library

### AI Worker Integration

```
Browser → Express relay (adds X-API-Key) → Cloudflare Worker → Returns SVG/measurements
```
- Mock mode runs automatically on localhost (no API keys needed for dev)
- Rate limited: 10 requests/minute per IP
- SVG output is sanitized (strips scripts, event handlers, javascript: URIs)

### File Upload Handling

- Server accepts uploads to `/api/upload-project` endpoint
- Files stored in `uploads/` directory locally, `/tmp/uploads/` on Vercel (ephemeral)
- Client handles ZIP extraction and project restoration

### Development Guidelines

- **TypeScript first**: New code must be TypeScript. Legacy JS is converted slice-by-slice.
- **No frameworks**: Vanilla JS/TS + Fabric.js for canvas. No React, Vue, Angular, etc.
- **Backend**: Standard Express.js patterns with Node.js built-in modules
- **API Format**: JSON for request/response bodies
- **Client Libraries**: Browser APIs, JSZip, FileSaver.js, Fabric.js, heic2any

### Coding Conventions

- 2-space indentation
- `camelCase` for modules and functions
- `PascalCase` for classes
- `kebab-case` for test files
- Conventional Commits for commit messages (`feat:`, `fix:`, `refactor:`, etc.)

### Debug Helpers

- `window.__TEXT_DEBUG = true` — Enables red guide lines for text alignment and console logs of canvas text state, transform matrix, border/padding values.

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

### Background Removal Pipeline

When replacing images (e.g., background removal), always:
1. Use the unified coordinate transformation system (`imageToCanvasCoords`, `canvasToImageCoords`, `getTransformationParams`)
2. Preserve all five stroke data structures listed above
3. Fetch background removal URLs as blobs before processing (avoids CORS/HTTP2 errors)

Use `window.onBackgroundRemoved` handler for the replacement flow.
