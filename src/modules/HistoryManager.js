// History Manager
// Handles Undo/Redo functionality

export class HistoryManager {
  constructor(canvasManager) {
    this.canvasManager = canvasManager;
    this.undoStack = [];
    this.redoStack = [];
    this.maxHistory = 50;
    this.locked = false; // Lock during undo/redo operations
  }

  init() {
    // Listen for object modifications to auto-save state
    const canvas = this.canvasManager.fabricCanvas;
    if (canvas) {
      canvas.on('object:modified', () => this.saveState());
      canvas.on('object:added', () => this.saveState());
      canvas.on('object:removed', () => this.saveState());

      // Save initial state
      setTimeout(() => {
        this.saveState();
      }, 100);
    }
  }

  saveState() {
    if (this.locked) return;

    // Save both Fabric canvas state and metadata
    const canvasJSON = this.canvasManager.toJSON();
    const metadata = window.app?.metadataManager
      ? {
          vectorStrokesByImage: JSON.parse(
            JSON.stringify(window.app.metadataManager.vectorStrokesByImage)
          ),
          strokeVisibilityByImage: JSON.parse(
            JSON.stringify(window.app.metadataManager.strokeVisibilityByImage)
          ),
          strokeLabelVisibility: JSON.parse(
            JSON.stringify(window.app.metadataManager.strokeLabelVisibility)
          ),
          strokeMeasurements: JSON.parse(
            JSON.stringify(window.app.metadataManager.strokeMeasurements)
          ),
          customLabelPositions: JSON.parse(
            JSON.stringify(window.app.metadataManager.customLabelPositions)
          ),
          calculatedLabelOffsets: JSON.parse(
            JSON.stringify(window.app.metadataManager.calculatedLabelOffsets)
          ),
        }
      : {};

    const state = {
      canvas: canvasJSON,
      metadata: metadata,
      timestamp: Date.now(),
    };

    const json = JSON.stringify(state);

    // Don't save duplicate states
    if (this.undoStack.length > 0 && this.undoStack[this.undoStack.length - 1] === json) {
      return;
    }

    this.undoStack.push(json);

    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }

    this.redoStack = []; // Clear redo stack on new change
    this.updateUI();
  }

  undo() {
    if (this.undoStack.length <= 1) return; // Need at least one state to stay on

    this.locked = true;

    // Pop current state and push to redo
    const currentState = this.undoStack.pop();
    this.redoStack.push(currentState);

    // Get previous state
    const prevStateStr = this.undoStack[this.undoStack.length - 1];
    const prevState = JSON.parse(prevStateStr);

    // Restore canvas
    this.canvasManager.loadFromJSON(prevState.canvas, () => {
      // Restore metadata if available
      if (prevState.metadata && window.app?.metadataManager) {
        window.app.metadataManager.vectorStrokesByImage =
          prevState.metadata.vectorStrokesByImage || {};
        window.app.metadataManager.strokeVisibilityByImage =
          prevState.metadata.strokeVisibilityByImage || {};
        window.app.metadataManager.strokeLabelVisibility =
          prevState.metadata.strokeLabelVisibility || {};
        window.app.metadataManager.strokeMeasurements = prevState.metadata.strokeMeasurements || {};
        window.app.metadataManager.customLabelPositions =
          prevState.metadata.customLabelPositions || {};
        window.app.metadataManager.calculatedLabelOffsets =
          prevState.metadata.calculatedLabelOffsets || {};
      }

      this.locked = false;
      this.updateUI();
    });
  }

  redo() {
    if (this.redoStack.length === 0) return;

    this.locked = true;

    const nextStateStr = this.redoStack.pop();
    this.undoStack.push(nextStateStr);
    const nextState = JSON.parse(nextStateStr);

    // Restore canvas
    this.canvasManager.loadFromJSON(nextState.canvas, () => {
      // Restore metadata if available
      if (nextState.metadata && window.app?.metadataManager) {
        window.app.metadataManager.vectorStrokesByImage =
          nextState.metadata.vectorStrokesByImage || {};
        window.app.metadataManager.strokeVisibilityByImage =
          nextState.metadata.strokeVisibilityByImage || {};
        window.app.metadataManager.strokeLabelVisibility =
          nextState.metadata.strokeLabelVisibility || {};
        window.app.metadataManager.strokeMeasurements = nextState.metadata.strokeMeasurements || {};
        window.app.metadataManager.customLabelPositions =
          nextState.metadata.customLabelPositions || {};
        window.app.metadataManager.calculatedLabelOffsets =
          nextState.metadata.calculatedLabelOffsets || {};
      }

      this.locked = false;
      this.updateUI();
    });
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.updateUI();
  }

  updateUI() {
    // Update Undo/Redo button states if they exist
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');

    if (undoBtn) undoBtn.disabled = this.undoStack.length <= 1;
    if (redoBtn) redoBtn.disabled = this.redoStack.length === 0;
  }
}
