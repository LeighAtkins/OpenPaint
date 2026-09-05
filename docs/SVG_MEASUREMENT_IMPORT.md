# SVG Measurement Import Feature

## Overview

This feature automatically converts measurement lines from SVG guides into OpenPaint's native vector+measurement system when adding guide models to a project.

## What Was Implemented

### 1. SVG Measurement Parser (`src/modules/ui/svg-measurement-parser.js`)

A new module that:
- Parses SVG guide files to extract measurement lines
- Identifies measurement elements by ID pattern (`mA1cm`, `mB1cm`, etc.)
- Extracts line coordinates from `<line>`, `<polyline>`, and `<path>` elements
- Parses connector circles (`cA1cm`, `cB1cm`) and label boxes (`bA1cm`, `bB1cm`)
- Groups related elements by measurement label (A1, B1, C1, etc.)

### 2. Coordinate Transformation

Creates a coordinate transformer that:
- Maps SVG viewBox coordinates to canvas pixel coordinates
- Accounts for background image scaling and positioning
- Maintains aspect ratio and proper alignment
- Ensures vector overlays match exactly with the rasterized guide image

### 3. Measurement Import Function

Added `importSvgMeasurements()` in `measurement-guide-flash.js` that:
- Fetches the raw SVG (not the rasterized version)
- Parses measurement data using the parser
- Transforms coordinates to match the canvas
- Creates Fabric.js Line objects for each measurement
- Registers measurements in OpenPaint's metadata system
- Adds measurements to `lineStrokesByImage` data structure
- Makes measurements fully editable and draggable

### 4. Integration with "Add Selected Models"

Modified `addGuideAsNewImage()` to:
- Add the rasterized guide as a background image (existing behavior)
- Wait for the background to load
- Automatically import SVG measurements as vector strokes
- Display success message with count of imported measurements
- Handle errors gracefully without breaking the image import

## How It Works

```
User clicks "Add Selected Models"
    ↓
1. Rasterize SVG → Add as background image
    ↓
2. Fetch raw SVG from API
    ↓
3. Parse SVG → Extract measurement lines (mA1cm, mB1cm, etc.)
    ↓
4. Transform SVG coordinates → Canvas coordinates
    ↓
5. Create Fabric.js Line objects
    ↓
6. Add to canvas and register in metadata
    ↓
Result: Editable vector measurements overlay on guide image
```

## SVG Element ID Patterns

The parser recognizes these patterns:

- **`m<Label><unit>`** - Measurement lines (e.g., `mA1cm`, `mB2cm`)
- **`c<Label><unit>`** - Connector circles (e.g., `cA1cm`, `cB2cm`)
- **`b<Label><unit>`** - Label boxes (e.g., `bA1cm`, `bB2cm`)

Where:
- `<Label>` = A1, A2, B1, B2, C1, C2, etc.
- `<unit>` = cm or in

## Testing Instructions

1. **Start the development server:**
   ```bash
   npm run dev
   ```

2. **Open the measurement guide gallery:**
   - Click the guide icon or press the hotkey (Backslash)
   - Switch to "Select Mode"

3. **Add a guide model:**
   - Browse available guides
   - Click to select one or more guides
   - Click "Add Selected Models"

4. **Verify the import:**
   - The guide image should appear as background
   - Measurement lines should overlay on top
   - Lines should be red (#ef4444) and editable
   - Labels should match SVG IDs (A1, B1, C2, etc.)
   - Lines should align perfectly with guide indicators

5. **Test editability:**
   - Use Select tool to drag line endpoints
   - Lines should move and resize normally
   - Save and reload project - measurements should persist

## Files Modified

- `src/modules/ui/measurement-guide-flash.js` - Added import logic
- Created `src/modules/ui/svg-measurement-parser.js` - Parser module

## Configuration Options

The `addGuideAsNewImage()` function accepts options:

```javascript
{
  switchToNew: true,          // Switch to new image after adding
  importMeasurements: true    // Import SVG measurements (default: true)
}
```

To disable measurement import:

```javascript
await addGuideAsNewImage(code, view, { importMeasurements: false });
```

## Future Enhancements

Potential improvements:

1. **Tag Import** - Import connector circles and label boxes as interactive tags
2. **Measurement Values** - Parse text elements to pre-populate measurement values
3. **Line Styles** - Match SVG stroke styles (color, dash patterns, width)
4. **Curved Lines** - Support polyline and complex path measurements
5. **Batch Import** - Import measurements for multiple views simultaneously
6. **UI Toggle** - Add option in gallery UI to enable/disable measurement import

## Troubleshooting

### Measurements not appearing

- Check browser console for errors
- Verify guide SVG has measurement elements (IDs starting with 'm')
- Ensure background image has loaded (wait 500ms delay is built-in)
- Check that you're viewing the correct image/view

### Misaligned measurements

- Verify SVG viewBox matches image dimensions
- Check background image scaling in canvas
- Ensure coordinate transformer is using correct bgImage object

### Import fails silently

- Check `/api/measurement-guides/svg` endpoint returns valid SVG
- Verify CORS settings allow SVG fetch
- Check network tab for failed requests

## Technical Notes

- **Fabric.js Global**: Uses global `fabric` object (loaded via script tag)
- **Async Import**: Measurements import runs asynchronously with 500ms delay
- **View Check**: Only imports measurements when viewing the target image
- **Error Handling**: Import failures don't block guide image addition
- **Metadata Registration**: Uses StrokeMetadataManager for stroke tracking

## Related Files

- `svgMerge/` - Reference implementation for SVG editing patterns
- `src/modules/MeasurementSystem.js` - Measurement value management
- `src/modules/tools/LineTool.ts` - Line creation and editing
- `api/measurement-guides/svg.js` - SVG API endpoint
