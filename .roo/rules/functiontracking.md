---
description: 
globs: 
alwaysApply: true
---

# Your rule content

- [app.js](mdc:app.js) [paint.js](mdc:public/js/paint.js) [tasks.md](mdc:.roo/rules/tasks.md) [index.html](mdc:index.html)
- This file tracks the status and modification history of key functions during the development session.
 # Function Tracking Log

### `redrawCanvasWithVisibility()`
*   **Status:** Modified (Label positioning logic updated). Needs testing for offset behavior (panning/zooming). Undo/redo/saving not yet updated for offsets.
*   **Start Line:** ~1300
*   **Connections:** Calls `applyVisibleStrokes`, `drawImageAndStrokes`, `findOptimalLabelPosition` (indirectly via label drawing), `getCanvasCoords`, `drawLabelConnector`. Called by various event handlers and undo/redo.
*   **Change History (This Session):**
    *   [Previous Turn] - Updated label drawing to use relative offsets (`customLabelPositions`, `calculatedLabelOffsets`) instead of recalculating optimal position on every redraw.

### `findOptimalLabelPosition()`
*   **Status:** Modified (Canvas boundary constraints commented out). Functionality seems okay based on previous tests, but interaction with new offset system needs verification.
*   **Start Line:** ~3320
*   **Connections:** Called by `redrawCanvasWithVisibility`. Calls `evaluateLabelPosition`, `rectsOverlap`.
*   **Change History (This Session):**
    *   [Previous Session] - Commented out canvas boundary constraints to allow labels off-screen.
    *   [Previous Turn] - (Implicitly) Now used only to calculate the *initial* offset if none is stored.

### `draw()`
*   **Status:** Modified (Line width scaling fixed). Seems functional.
*   **Start Line:** ~2040
*   **Connections:** Called by mousemove listener (freehand). Calls `getTransformedCoords`. Updates `vectorStrokesByImage`.
*   **Change History (This Session):**
    *   [Previous Session] - Added image scale multiplication to `dynamicWidth` calculation.

### `drawStraightLinePreview()`
*   **Status:** Modified (Line width and endpoint scaling fixed). Seems functional.
*   **Start Line:** ~2148
*   **Connections:** Called by mousemove listener (straight line mode).
*   **Change History (This Session):**
    *   [Previous Session] - Added image scale multiplication to `ctx.lineWidth` and arc radius calculations.

### Label Dragging Logic (`mousedown`, `mousemove`)
*   **Status:** Modified (Uses relative offsets, clamping removed). Needs testing.
*   **Start Line:** `mousedown` ~2223, `mousemove` ~2348
*   **Connections:** Updates `customLabelPositions`. Calls `redrawCanvasWithVisibility`, `getCanvasCoords`, `findLabelAtPoint`.
*   **Change History (This Session):**
    *   [Previous Turn] - Reworked to calculate and store relative offsets in `customLabelPositions` instead of absolute canvas coordinates. Removed canvas clamping.

### `clearButton` Handler
*   **Status:** Modified (Clears label offsets). Needs testing.
*   **Start Line:** ~2650
*   **Connections:** Clears various state variables including `customLabelPositions` and `calculatedLabelOffsets`.
*   **Change History (This Session):**
    *   [Previous Turn] - Added clearing logic for `customLabelPositions` and `calculatedLabelOffsets`.
// ... existing code ...
### `clearButton` Handler
*   **Status:** Modified (Clears label offsets). Needs testing.
*   **Start Line:** ~2650
*   **Connections:** Clears various state variables including `customLabelPositions` and `calculatedLabelOffsets`.
*   **Change History (This Session):**
    *   [Previous Turn] - Added clearing logic for `customLabelPositions` and `calculatedLabelOffsets`.

### `getTransformedCoords()`
*   **Status:** Stable.
*   **Start Line:** ~1945
*   **Connections:** Called by `draw()`, `mousedown` listener. Uses `imageScaleByLabel`, `imagePositionByLabel`, `originalImageDimensions`.
*   **Change History (This Session):** None.

### `getCanvasCoords()`
*   **Status:** Stable.
*   **Start Line:** ~1975
*   **Connections:** Called by `redrawCanvasWithVisibility`, label dragging logic. Uses `imageScaleByLabel`, `imagePositionByLabel`, `originalImageDimensions`.
*   **Change History (This Session):** None.

### `saveState()`
*   **Status:** Potentially needs update for label offsets in undo/redo.
*   **Start Line:** ~1780
*   **Connections:** Called by `mousedown`, `mouseup`, `mouseout`, `clearButton` handler, `switchToImage`, `moveImage`, `updateImageScale`, loading logic. Manages `undoStackByImage`, `redoStackByImage`, `imageStates`, `lineStrokesByImage`, `vectorStrokesByImage`, etc.
*   **Change History (This Session):** None yet (but planned for offset saving).

### `undo()` / `redo()`
*   **Status:** Potentially needs update for label offsets.
*   **Start Line:** `undo` ~1880, `redo` ~2040
*   **Connections:** Called by Ctrl+Z/Ctrl+Y listeners. Manipulate `undoStackByImage`, `redoStackByImage`, `lineStrokesByImage`, `vectorStrokesByImage`, `imageStates`, `labelsByImage`. Call `restoreCanvasState`, `redrawCanvasWithVisibility`.
*   **Change History (This Session):** None yet (but planned for offset handling).

### `switchToImage()`
*   **Status:** Stable.
*   **Start Line:** ~2565
*   **Connections:** Called by image sidebar clicks, loading logic. Calls `saveState`, `restoreCanvasState` (indirectly via `pasteImageFromUrl` or `redrawCanvasWithVisibility`), `updateActiveImageInSidebar`, `updateStrokeCounter`, `updateStrokeVisibilityControls`, `updateScaleUI`.
*   **Change History (This Session):** None.

### `pasteImageFromUrl()`
*   **Status:** Stable.
*   **Start Line:** ~205
*   **Connections:** Called by `handleFiles`, paste listener, `switchToImage` (if no state exists). Manages `originalImages`, `originalImageDimensions`, `imageStates`, `undoStackByImage`. Calls `getCanvasState`.
*   **Change History (This Session):** None.

### `addImageToSidebar()`
*   **Status:** Stable.
*   **Start Line:** ~135
*   **Connections:** Called by `handleFiles`, paste listener, loading logic. Modifies DOM (adds image container). Sets up `onclick` handler which calls `saveState`, `switchToImage`.
*   **Change History (This Session):** None.

### `updateStrokeVisibilityControls()`
*   **Status:** Stable.
*   **Start Line:** ~435
*   **Connections:** Called by many functions (undo/redo, switch image, load, etc.). Reads `lineStrokesByImage`, `strokeVisibilityByImage`, `strokeLabelVisibility`, `strokeMeasurements`, `selectedStrokeByImage`. Modifies DOM (builds stroke list). Sets up event listeners (`toggleStrokeVisibility`, `toggleLabelVisibility`, `showEditDialog`, selection logic).
*   **Change History (This Session):** None.

### `moveImage()`
*   **Status:** Stable.
*   **Start Line:** ~3030
*   **Connections:** Called by mouse dragging (Shift key), WASD keys. Updates `imagePositionByLabel`. Calls `saveState`, `redrawCanvasWithVisibility`.
*   **Change History (This Session):** None.

### `updateImageScale()`
*   **Status:** Stable.
*   **Start Line:** ~2980
*   **Connections:** Called by scale buttons, Q/E keys. Updates `imageScaleByLabel`. Calls `saveState`, `redrawCanvasWithVisibility`, `updateScaleButtonsActiveState`.
*   **Change History (This Session):** None.

### `handleFiles()`
*   **Status:** Stable.
*   **Start Line:** ~2760
*   **Connections:** Called by file drop (`setupDragAndDrop`) and paste button click. Manages `pastedImages`, `originalImages`. Calls `getLabelFromFilename`, `addImageToSidebar`, `pasteImageFromUrl`.
*   **Change History (This Session):** None.

### `setupDragAndDrop()`
*   **Status:** Stable.
*   **Start Line:** ~2825
*   **Connections:** Called on DOMContentLoaded. Sets up canvas event listeners (`dragover`, `dragleave`, `drop`). Calls `handleFiles`.
*   **Change History (This Session):** None.

### `checkForStrokeAtPoint()`
*   **Status:** Stable.
*   **Start Line:** ~3555
*   **Connections:** Called by `mousedown` listener. Uses `vectorStrokesByImage`, `strokeVisibilityByImage`, `imageScaleByLabel`, `imagePositionByLabel`. Calls `pointDistanceToLine`.
*   **Change History (This Session):** None.

### `drawLabelConnector()`
*   **Status:** Stable.
*   **Start Line:** ~3495
*   **Connections:** Called by `redrawCanvasWithVisibility`. Draws the dotted line.
*   **Change History (This Session):** None.


---

## `public/js/project-manager.js`

### `saveProject()`
*   **Status:** Stable.
*   **Start Line:** ~25
*   **Connections:** Called by Save Project button. Reads all relevant window state (`vectorStrokesByImage`, `strokeVisibilityByImage`, etc.). Uses JSZip to create a downloadable file. Calls `showStatusMessage`.
*   **Change History (This Session):** None.

### `loadProject()`
*   **Status:** Stable (but complex interactions with `paint.js`).
*   **Start Line:** ~255
*   **Connections:** Called by Load Project button. Reads ZIP file using JSZip. Parses `project.json`. Updates all relevant window state. Calls `addImageToSidebar`, `switchToImage`, `redrawCanvasWithVisibility`, `updateStrokeCounter`, `updateStrokeVisibilityControls`, `updateScaleUI`, `showStatusMessage`.
*   **Change History (This Session):** None.

---

## `app.js` (Node.js/Express)

### `POST /api/upload-project`
*   **Status:** Very basic (currently unused by client).
*   **Start Line:** ~37
*   **Connections:** Handles POST requests to `/api/upload-project`. Uses `multer` for file storage. Returns file path (client doesn't use this endpoint for loading currently).
*   **Change History (This Session):** None.

---
*Self-maintained log during pair programming session.* 
