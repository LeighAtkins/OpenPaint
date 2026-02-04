// History Manager
// Handles Undo/Redo functionality

export class HistoryManager {
  constructor(canvasManager) {
    this.canvasManager = canvasManager;
    this.undoStack = [];
    this.redoStack = [];
    this.maxHistory = 50;
    this.locked = false; // Lock during undo/redo operations
    this.lastStateSignature = null;
  }

  sanitizeCanvasJSON(canvasJSON) {
    if (!canvasJSON || typeof canvasJSON !== 'object') return canvasJSON;
    const visited = new Set();
    const sanitize = value => {
      if (!value || typeof value !== 'object') return value;
      if (visited.has(value)) return value;
      visited.add(value);

      if (Array.isArray(value)) {
        value.forEach(sanitize);
        return value;
      }

      Object.keys(value).forEach(key => {
        const current = value[key];
        if (key === 'textBaseline' && current === 'alphabetical') {
          value[key] = 'alphabetic';
        } else if (current && typeof current === 'object') {
          sanitize(current);
        }
      });

      return value;
    };

    return sanitize(canvasJSON);
  }

  init() {
    // Listen for object modifications to auto-save state
    const canvas = this.canvasManager.fabricCanvas;
    if (canvas) {
      const shouldTrackTarget = target =>
        !target?.excludeFromExport && !target?.isTag && !target?.isConnectorLine;

      canvas.on('object:modified', e => {
        if (!shouldTrackTarget(e?.target)) return;
        this.saveState();
      });
      canvas.on('object:added', e => {
        if (!shouldTrackTarget(e?.target)) return;
        this.saveState();
      });
      canvas.on('object:removed', e => {
        if (!shouldTrackTarget(e?.target)) return;
        this.saveState();
      });

      // Save initial state
      setTimeout(() => {
        this.saveState();
      }, 100);
    }

    this.setupKeyboardShortcuts();
  }

  setupKeyboardShortcuts() {
    document.addEventListener('keydown', e => {
      const isUndo = (e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey;
      const isRedo = (e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey));

      if (!isUndo && !isRedo) return;

      const activeTool = window.app?.toolManager?.activeTool;
      if (isUndo && typeof activeTool?.handleUndo === 'function') {
        const handled = activeTool.handleUndo();
        if (handled) {
          e.preventDefault();
          return;
        }
      }

      e.preventDefault();
      if (isUndo) {
        this.undo();
      } else if (isRedo) {
        this.redo();
      }
    });
  }

  saveState(options = {}) {
    if (this.locked) return;
    const force = options?.force === true;
    const reason = options?.reason || 'auto';
    if (!force && this.shouldSkipAutoSave()) return;

    const canvas = this.canvasManager?.fabricCanvas;
    if (canvas) {
      canvas.getObjects().forEach(obj => {
        if (obj?.arrowSettings && obj?.strokeMetadata) {
          obj.strokeMetadata.arrowSettings = JSON.parse(JSON.stringify(obj.arrowSettings));
        }
      });
    }

    // Save both Fabric canvas state and metadata
    const canvasJSON = this.sanitizeCanvasJSON(this.canvasManager.toJSON());
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

    const signature = this.buildStateSignature(canvasJSON);

    if (this.lastStateSignature && this.lastStateSignature === signature) {
      return;
    }

    const state = {
      canvas: canvasJSON,
      metadata: metadata,
      timestamp: Date.now(),
      signature: signature,
    };

    const json = JSON.stringify(state);

    this.undoStack.push(json);
    this.lastStateSignature = signature;

    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }

    this.redoStack = []; // Clear redo stack on new change
    this.updateUI();
  }

  buildStateSignature(canvasJSON) {
    try {
      return JSON.stringify(canvasJSON, (key, value) => {
        if (key === 'tagOffset') return undefined;
        return value;
      });
    } catch (err) {
      console.warn('[History] Failed to serialize state signature', err);
      return null;
    }
  }

  shouldSkipAutoSave() {
    const activeTool = window.app?.toolManager?.activeTool;
    if (activeTool?.isDrawing) {
      return true;
    }
    return false;
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
    if (prevState?.canvas) {
      prevState.canvas = this.sanitizeCanvasJSON(prevState.canvas);
    }
    this.lastStateSignature = prevState?.signature || this.buildStateSignature(prevState?.canvas);

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

      if (this.canvasManager?.fabricCanvas && window.app?.arrowManager) {
        const objects = this.canvasManager.fabricCanvas.getObjects() || [];
        objects.forEach(obj => {
          if (!obj) return;
          if (!obj.arrowSettings && obj.strokeMetadata?.arrowSettings) {
            obj.arrowSettings = obj.strokeMetadata.arrowSettings;
          }
          if (obj.arrowSettings) {
            window.app.arrowManager.attachArrowRendering(obj);
            obj.dirty = true;
          }
        });

        this.canvasManager.fabricCanvas.requestRenderAll();
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
    if (nextState?.canvas) {
      nextState.canvas = this.sanitizeCanvasJSON(nextState.canvas);
    }
    this.lastStateSignature = nextState?.signature || this.buildStateSignature(nextState?.canvas);

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

      if (this.canvasManager?.fabricCanvas && window.app?.arrowManager) {
        const objects = this.canvasManager.fabricCanvas.getObjects() || [];
        objects.forEach(obj => {
          if (!obj) return;
          if (!obj.arrowSettings && obj.strokeMetadata?.arrowSettings) {
            obj.arrowSettings = obj.strokeMetadata.arrowSettings;
          }
          if (obj.arrowSettings) {
            window.app.arrowManager.attachArrowRendering(obj);
            obj.dirty = true;
          }
        });

        this.canvasManager.fabricCanvas.requestRenderAll();
      }

      this.locked = false;
      this.updateUI();
    });
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.lastStateSignature = null;
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
