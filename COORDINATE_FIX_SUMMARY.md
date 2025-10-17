# Coordinate & Text Alignment Fix

## Problem
When loading saved projects, text elements and label positions were not aligning correctly with their background strokes. The coordinates would be mismatched after loading.

## Root Cause
The project save/load system was not persisting:
1. **`customLabelPositions`** - User-dragged label positions
2. **`calculatedLabelOffsets`** - Auto-calculated label offsets  
3. **`textElementsByImage`** - Text overlay elements

Additionally, older projects stored offsets in legacy absolute `{x, y}` format instead of the newer normalized format expected by `normalizeMaybeStore()`.

## Solution

### 1. Save Process (`saveProject()`)
**File: `js/project-manager.js` lines 428-454**

Added serialization for:
- `customLabelPositions` (per image label, per stroke label)
- `calculatedLabelOffsets` (per image label, per stroke label)
- `customLabelRotationStamps` (rotation tracking)
- `textElementsByImage` (text overlays per image)

All structures are deep-cloned and saved in their normalized format.

### 2. Load Process (`loadProject()`)
**File: `js/project-manager.js` lines 757-791**

Added restoration logic to:
- Initialize window globals if missing (`window.calculatedLabelOffsets`, `window.paintApp.state.textElementsByImage`)
- Restore all offset and text structures from saved project data
- Preserve normalized format through load process

### 3. Migration for Legacy Projects (`migrateProject()`)
**File: `js/project-manager.js` lines 187-231**

Added automatic migration that:
- Detects legacy offset format (offsets with `x`, `y` but no `kind` field)
- Converts legacy offsets to normalized format using image width as reference:
  ```javascript
  {
    kind: 'norm',
    dx_norm: x / imageWidth,
    dy_norm: y / imageWidth,
    normRef: 'width'
  }
  ```
- Applies to both `customLabelPositions` and `calculatedLabelOffsets`
- Logs conversions for debugging

## Format Details

### Normalized Offset Format
The system now consistently uses normalized offsets that scale with image dimensions:

```javascript
{
  kind: 'norm',          // Format identifier
  dx_norm: 0.123,        // X offset as fraction of reference dimension
  dy_norm: -0.456,       // Y offset as fraction of reference dimension
  normRef: 'width'       // Reference dimension (width, height, or diag)
}
```

### Legacy Format (Auto-Converted)
Old projects had simple pixel offsets:
```javascript
{
  x: -54.29,
  y: -176.45
}
```

These are now automatically converted during load via `migrateProject()`.

## Testing

To verify the fix:
1. Load the provided Lee Sofa project archive
2. Check that all label positions align with their strokes
3. Check that all text overlays appear in correct positions
4. Run `window.runCoordinateSystemTests()` in console
5. Verify no console errors about coordinate mismatches
6. Save and reload the project to ensure round-trip stability

## Files Modified
- `js/project-manager.js` - All changes (save, load, migration)

## Related Systems
This fix integrates with:
- **paint.js**: `normalizeMaybeStore()`, `denormMaybeFetch()` - offset format conversion
- **paint.js**: `window.paintApp.state.textElementsByImage` - text overlay storage
- **paint.js**: `customLabelPositions`, `calculatedLabelOffsets` - label positioning system
- **paint.js**: Coordinate transformation system (image ↔ canvas coordinates)

