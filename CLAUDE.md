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

## CSS and Styling

### Tailwind CSS v4 Configuration

This project uses **Tailwind CSS v4.1.16** with a CSS-based configuration approach (not JavaScript config).

**Important Architecture Notes:**
- Tailwind v4 uses `@theme` directive for custom colors (different from v3's config approach)
- Custom colors must be defined in the CSS source file, not just in `tailwind.config.js`
- The config file is used for content paths and safelist only

### Build Process

```bash
# Build Tailwind CSS (required after CSS changes)
npm run build:css

# This runs on Vercel deployments automatically via vercel-build script
```

**Source and Output Files:**
- **Source**: `css/tailwind.src.css` - Contains `@import` and `@theme` directives
- **Output**: `css/tailwind.build.css` - Compiled CSS loaded by `index.html`
- **Mobile**: `css/mobile.css` - Mobile-specific overrides (loaded after tailwind.build.css)

### Custom Color Tokens

Custom colors are defined in `css/tailwind.src.css` using the `@theme` directive:

```css
@import "tailwindcss";

@theme {
  --color-primary-500: rgb(59 130 246);   /* Blue for primary actions */
  --color-primary-600: rgb(37 99 235);    /* Darker blue for hover */
  --color-primary-700: rgb(29 78 216);    /* Even darker for active */
  --color-success-500: rgb(16 185 129);   /* Green for success actions */
  --color-success-600: rgb(5 150 105);    /* Darker green for hover */
}
```

These generate utility classes automatically:
- `bg-primary-500`, `hover:bg-primary-600`, `active:bg-primary-700`
- `bg-success-500`, `hover:bg-success-600`
- `text-primary-500`, `border-primary-500`, etc.

### Production Safelist

The `tailwind.config.js` safelist prevents critical classes from being purged in production:

```javascript
safelist: [
  'flex', 'items-center', 'gap-1', 'px-3', 'py-1',
  'bg-primary-500', 'hover:bg-primary-600', 'active:bg-primary-700',
  'text-white', 'text-xs', 'rounded-lg', 'shadow-sm',
  // ... other critical classes
]
```

**Why safelist is needed:**
- Canvas control buttons are dynamically styled
- Classes must survive Tailwind's production purge process
- Prevents intermittent rendering issues in Vercel deployments

### Common Issues and Solutions

#### Issue: Buttons Have No Background Color
**Symptoms:** HTML has `bg-primary-500` class but button appears unstyled

**Root Cause:** Custom color utilities not generated because:
1. Colors not defined in `@theme` directive in `css/tailwind.src.css`, OR
2. CSS not rebuilt after changes to source file

**Solution:**
```bash
# Rebuild CSS to regenerate utilities
npm run build:css

# Verify colors exist in output
grep "bg-primary-500" css/tailwind.build.css
```

#### Issue: Classes Work Locally But Not in Production
**Symptoms:** Styles work in development but break after Vercel deployment

**Root Cause:** Tailwind purged classes that weren't detected in content scan

**Solution:**
1. Add critical classes to safelist in `tailwind.config.js`
2. Ensure content paths include all HTML/JS files
3. Rebuild and redeploy

#### Issue: Changes to tailwind.src.css Not Appearing
**Symptoms:** Modified color tokens but UI unchanged

**Solution:**
```bash
# Must rebuild CSS after any changes to source
npm run build:css

# Hard refresh browser (Ctrl+Shift+R or Cmd+Shift+R)
```

### Mobile Responsive Overrides

Mobile-specific styles are in `css/mobile.css` with breakpoint at `768px`:

```css
@media (max-width: 768px) {
  /* Mobile overrides here */
  #canvasControls.floating-panel.fixed {
    bottom: 10rem !important;  /* Desktop: 5rem, Mobile: 10rem */
  }
}
```

**Key mobile adjustments:**
- Canvas controls positioned higher to avoid mobile browser UI
- Circular floating panels for Images/Elements (Facebook Messenger style)
- Touch-optimized button sizes (min 44px)
- Reduced spacing and compact layouts

### Visibility Guard

The `public/boot/visibility-check.js` script monitors critical UI elements:

```javascript
// Checks #copyCanvasBtn on DOM ready
// Logs warnings if button missing or hidden
// Helps diagnose production rendering issues
```

Loaded in `index.html` before app scripts to catch early initialization problems.

### CSS File Structure

```
css/
├── tailwind.src.css      ← Source file with @theme (edit this)
├── tailwind.build.css    ← Compiled output (auto-generated, don't edit)
├── mobile.css            ← Mobile overrides (edit as needed)
├── index.css             ← Legacy global styles
└── styles.css            ← Additional component styles
```

**Best Practices:**
- Always edit `tailwind.src.css` for color changes, never `tailwind.build.css`
- Run `npm run build:css` after modifying source file
- Test mobile responsive breakpoints at 768px width
- Use browser DevTools to verify computed styles match expectations
- Check console for visibility guard warnings in production