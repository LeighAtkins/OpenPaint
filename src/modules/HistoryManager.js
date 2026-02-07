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

  init() {
    // Listen for object modifications to auto-save state
    const canvas = this.canvasManager.fabricCanvas;
    if (canvas) {
      // Debounce saveState to prevent multiple rapid saves
      let saveTimeout = null;
      const shouldTrackTarget = target =>
        !target?.excludeFromExport && !target?.isTag && !target?.isConnectorLine;

      const debouncedSave = e => {
        if (saveTimeout) clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
          const target = e?.target;
          if (!shouldTrackTarget(target)) {
            return;
          }
          this.saveState();
        }, 100);
      };

      canvas.on('object:modified', debouncedSave);
      canvas.on('object:added', debouncedSave);
      canvas.on('object:removed', debouncedSave);

      // Save initial state
      setTimeout(() => {
        this.saveState();
      }, 100);
    }

    // Setup keyboard shortcuts
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
    if (this.undoStack.length <= 1) {
      console.log('[History] Cannot undo - at oldest state');
      return;
    }

    console.log('[History] Undo triggered');
    this.locked = true;

    try {
      // Pop current state and push to redo
      const currentState = this.undoStack.pop();
      this.redoStack.push(currentState);

      // Get previous state
      const prevStateStr = this.undoStack[this.undoStack.length - 1];
      const prevState = JSON.parse(prevStateStr);
      this.lastStateSignature = prevState?.signature || this.buildStateSignature(prevState?.canvas);

      // Restore canvas
      this.canvasManager.loadFromJSON(prevState.canvas, () => {
        try {
          // Restore metadata if available
          if (prevState.metadata && window.app?.metadataManager) {
            window.app.metadataManager.vectorStrokesByImage =
              prevState.metadata.vectorStrokesByImage || {};
            window.app.metadataManager.strokeVisibilityByImage =
              prevState.metadata.strokeVisibilityByImage || {};
            window.app.metadataManager.strokeLabelVisibility =
              prevState.metadata.strokeLabelVisibility || {};
            window.app.metadataManager.strokeMeasurements =
              prevState.metadata.strokeMeasurements || {};
            window.app.metadataManager.customLabelPositions =
              prevState.metadata.customLabelPositions || {};
            window.app.metadataManager.calculatedLabelOffsets =
              prevState.metadata.calculatedLabelOffsets || {};
          }

          // Rebuild metadata and recreate tags
          this.restoreAfterHistoryChange();

          console.log('[History] Undo completed successfully');
        } catch (err) {
          console.error('[History] Error during undo restoration:', err);
        } finally {
          this.locked = false;
          this.updateUI();
        }
      });
    } catch (err) {
      console.error('[History] Error during undo:', err);
      this.locked = false;
      this.updateUI();
    }
  }

  redo() {
    if (this.redoStack.length === 0) {
      console.log('[History] Cannot redo - no future states');
      return;
    }

    console.log('[History] Redo triggered');
    this.locked = true;

    try {
      const nextStateStr = this.redoStack.pop();
      this.undoStack.push(nextStateStr);
      const nextState = JSON.parse(nextStateStr);
      this.lastStateSignature = nextState?.signature || this.buildStateSignature(nextState?.canvas);

      // Restore canvas
      this.canvasManager.loadFromJSON(nextState.canvas, () => {
        try {
          // Restore metadata if available
          if (nextState.metadata && window.app?.metadataManager) {
            window.app.metadataManager.vectorStrokesByImage =
              nextState.metadata.vectorStrokesByImage || {};
            window.app.metadataManager.strokeVisibilityByImage =
              nextState.metadata.strokeVisibilityByImage || {};
            window.app.metadataManager.strokeLabelVisibility =
              nextState.metadata.strokeLabelVisibility || {};
            window.app.metadataManager.strokeMeasurements =
              nextState.metadata.strokeMeasurements || {};
            window.app.metadataManager.customLabelPositions =
              nextState.metadata.customLabelPositions || {};
            window.app.metadataManager.calculatedLabelOffsets =
              nextState.metadata.calculatedLabelOffsets || {};
          }

          // Rebuild metadata and recreate tags
          this.restoreAfterHistoryChange();

          console.log('[History] Redo completed successfully');
        } catch (err) {
          console.error('[History] Error during redo restoration:', err);
        } finally {
          this.locked = false;
          this.updateUI();
        }
      });
    } catch (err) {
      console.error('[History] Error during redo:', err);
      this.locked = false;
      this.updateUI();
    }
  }

  restoreAfterHistoryChange() {
    const currentViewId = window.app?.projectManager?.currentViewId || 'front';
    console.log('[History] Restoring state for view:', currentViewId);

    try {
      // Rebuild metadata from canvas objects to ensure live references
      if (window.app?.metadataManager && this.canvasManager.fabricCanvas) {
        console.log('[History] Rebuilding metadata from canvas');
        window.app.metadataManager.rebuildMetadataFromCanvas(
          currentViewId,
          this.canvasManager.fabricCanvas
        );
      }

      // Recreate tags for all strokes
      if (window.app?.tagManager) {
        console.log('[History] Recreating tags');
        window.app.tagManager.recreateTagsForImage(currentViewId);
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

      // Update stroke visibility controls
      if (window.app?.metadataManager?.updateStrokeVisibilityControls) {
        console.log('[History] Updating stroke visibility controls');
        window.app.metadataManager.updateStrokeVisibilityControls();
      }

      // Update next tag display
      setTimeout(() => {
        if (window.updateNextTagDisplay) {
          console.log('[History] Updating next tag display');
          window.updateNextTagDisplay();
        }
      }, 50);
    } catch (err) {
      console.error('[History] Error in restoreAfterHistoryChange:', err);
    }
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
