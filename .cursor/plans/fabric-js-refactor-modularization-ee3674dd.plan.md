<!-- ee3674dd-2f0b-4720-b535-53c4f6440b4f c2a58e58-6832-47c1-91a5-12adf97f4b4f -->
# Fix Image Selection & HEIC Loading

1.  **Fix Batch Upload Selection**:

    -   Ensure only the **first** image of a batch upload is displayed and scrolled to.
    -   Prevent subsequent images in the batch from hijacking the view.
    -   Verify that copying a *new* single image (not part of a batch) correctly switches to that image.

2.  **Fix Scroll-to-Select**:

    -   Ensure that when an image "locks" (snaps) in the sidebar during scrolling, it becomes the active view on the canvas.
    -   Verify the IntersectionObserver logic correctly identifies the "locked" image.

3.  **Add HEIC Loading Indicator**:

    -   Implement a visible loading indicator specifically for HEIC files while they are being converted/loaded.
    -   Ensure this indicator is shown immediately upon upload start and removed once processing is complete.

4.  **Verify Logic**:

    -   Test batch upload (first image selected).
    -   Test single image copy (new image selected).
    -   Test scrolling (snapped image selected).

### To-dos

- [ ] Update index.html to include Fabric.js and link new module entry point.
- [ ] Implement CanvasManager with Zoom/Pan support.
- [ ] Implement ToolManager and basic PencilTool.
- [ ] Implement LineTool and ArrowTool.
- [ ] Implement TextTool.
- [ ] Implement ProjectManager for multiple views/images.
- [ ] Implement HistoryManager for Undo/Redo.
- [ ] Wire up UI events in main.js.
- [ ] Remove legacy paint.js and cleanup index.html.
- [ ] Ensure observer initialized once before use
- [ ] Link scroll snap completion to selection
- [ ] Observe new image containers automatically
- [ ] Test snap & batch upload selection