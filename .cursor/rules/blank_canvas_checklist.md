# Blank Canvas Checklist

This document tracks the progress of implementing and verifying functionality for drawing on a blank canvas.

## Core Drawing Functionality

- [x] Blank canvas detection (`redrawCanvasWithVisibility` function - "BLANK CANVAS MODE")
- [x] Drawing strokes on blank canvas
- [x] Labels appear correctly for strokes
- [x] Stroke thickness adapts to zoom level
- [x] Panning with WASD keys works on blank canvas
- [x] Zooming with Q/E keys works on blank canvas

## Navigation Features (Difficulty: Medium, Dependency: Core Drawing)

- [x] Check if `moveImage` function is being called when pressing WASD on blank canvas
  - Debug by adding console logs to the `moveImage` function
  - Verify delta values are being applied correctly to `imagePositionByLabel`
  - Confirm `redrawCanvasWithVisibility` is being called after position update

- [x] Verify that `updateImageScale` function is working with zoom keys (Q/E)
  - Check if scale values are being properly updated in `imageScaleByLabel`
  - Confirm that `redrawCanvasWithVisibility` is called after scale changes
  - Verify UI updates correctly to show current scale

## Coordinate Transformation (Difficulty: Hard, Dependency: Navigation Features)

- [x] Confirm `getCanvasCoords` and `getTransformedCoords` handle blank canvas correctly
  - Add console logs to see input/output values during transformation
  - Verify position offsets are properly considered for blank canvas

## Persistence (Difficulty: Medium, Dependency: Navigation Features)

- [x] Verify scale and position are saved with project
  - Check if `imagePositionByLabel` and `imageScaleByLabel` are included in project data
  - Confirm values are correctly loaded when reopening project
  - Added additional pre-setting of scales and positions before image loading

## UI Integration (Difficulty: Low, Dependency: Navigation Features)

- [ ] Scale controls in UI update and reflect blank canvas scale
- [ ] Position indicators show correct position on blank canvas (if applicable)

## Testing Procedure

1. Start with a new blank canvas
2. Draw several strokes 
3. Test zooming with Q/E keys
4. Test panning with WASD keys
5. Verify strokes move with panning
6. Verify labels move with strokes
7. Save project and reload to check persistence

## Known Issues

- ~~Panning with WASD keys doesn't appear to work on blank canvas~~ Fixed
- ~~Need to verify zoom functionality with Q/E keys on blank canvas~~ Fixed - Implemented proper scaling in blank canvas mode
- ~~Scale is not preserved when loading a project~~ Fixed - Added explicit scale pre-setting during project loading 