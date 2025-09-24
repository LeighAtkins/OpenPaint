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

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

3. Open your browser and navigate to `http://localhost:3000`

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

# in README.md
[![ci](https://github.com/LeighAtkins/OpenPaint/actions/workflows/test.yml/badge.svg?branch=migration/ts-react-bun)](https://github.com/LeighAtkins/OpenPaint/actions/workflows/test.yml)
