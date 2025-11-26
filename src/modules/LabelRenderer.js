// Label Renderer
// Renders labels (A1, A2, etc.) next to strokes on the canvas

export class LabelRenderer {
  constructor(canvasManager, metadataManager) {
    this.canvasManager = canvasManager;
    this.metadataManager = metadataManager;
    this.labelObjects = new Map(); // Map of stroke label -> Fabric text object
    this.updatePending = false; // Debounce flag
  }

  // Render labels for all visible strokes
  renderLabels() {
    const canvas = this.canvasManager.fabricCanvas;
    if (!canvas) return;

    // Clear existing labels
    this.clearLabels();

    const currentViewId = window.app?.projectManager?.currentViewId || 'front';
    const strokes = this.metadataManager.vectorStrokesByImage[currentViewId] || {};

    Object.entries(strokes).forEach(([strokeLabel, fabricObj]) => {
      // Check visibility
      const isVisible =
        this.metadataManager.strokeVisibilityByImage[currentViewId]?.[strokeLabel] !== false;
      const isLabelVisible =
        this.metadataManager.strokeLabelVisibility[currentViewId]?.[strokeLabel] !== false;

      if (!isVisible || !isLabelVisible || !fabricObj) return;

      // Calculate label position (top-left of object's bounding box)
      const bounds = fabricObj.getBoundingRect();
      const labelText = new fabric.Text(strokeLabel, {
        left: bounds.left,
        top: bounds.top - 20,
        fontSize: 14,
        fontFamily: 'Arial',
        fill: '#000',
        backgroundColor: '#fff',
        selectable: false,
        evented: false,
        hasControls: false,
        hasBorders: false,
        excludeFromExport: false,
      });

      canvas.add(labelText);
      this.labelObjects.set(strokeLabel, labelText);
    });

    canvas.renderAll();
  }

  // Clear all labels
  clearLabels() {
    const canvas = this.canvasManager.fabricCanvas;
    if (!canvas) return;

    this.labelObjects.forEach(labelObj => {
      canvas.remove(labelObj);
    });
    this.labelObjects.clear();
  }

  // Update labels (call after objects change)
  update() {
    // Debounce rapid updates
    if (this.updatePending) return;

    this.updatePending = true;
    requestAnimationFrame(() => {
      this.renderLabels();
      this.updatePending = false;
    });
  }
}
