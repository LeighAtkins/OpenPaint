// Text Tool
import { BaseTool } from './BaseTool.js';

export class TextTool extends BaseTool {
  constructor(canvasManager) {
    super(canvasManager);
    this.textColor = '#000000';
    this.fontSize = 20;
    this.strokeWidth = 1;
    this.backgroundEnabled = false;
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.activeTextObject = null;
    this.skipNextClick = false;
  }

  activate() {
    super.activate();
    this.canvas.selection = false;
    this.canvas.defaultCursor = 'text';
    this.canvas.on('mouse:down', this.onMouseDown);
    document.addEventListener('keydown', this.onKeyDown, true);
  }

  deactivate() {
    super.deactivate();
    this.canvas.selection = true;
    this.canvas.defaultCursor = 'default';
    this.canvas.off('mouse:down', this.onMouseDown);
    document.removeEventListener('keydown', this.onKeyDown, true);

    // Exit editing if still active when switching tools
    if (this.activeTextObject && this.activeTextObject.isEditing) {
      this.activeTextObject.exitEditing();
    }
    this.activeTextObject = null;
    this.skipNextClick = false;
  }

  onKeyDown(e) {
    if (!this.activeTextObject || !this.activeTextObject.isEditing) {
      return;
    }

    e.stopPropagation();

    // Enter confirms text, Shift+Enter inserts newline
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.activeTextObject.exitEditing();
      this.canvas.requestRenderAll();
    }
  }

  onMouseDown(o) {
    if (!this.isActive) return;

    // Skip this click if flagged (we just exited editing)
    if (this.skipNextClick) {
      this.skipNextClick = false;
      return;
    }

    // If clicking on the text we're currently editing, let Fabric handle it
    if (this.activeTextObject && o.target === this.activeTextObject) {
      return;
    }

    // If we have an active text (editing or not), finalize it first
    if (this.activeTextObject) {
      const activeText = this.activeTextObject;
      if (activeText.isEditing) {
        // exitEditing() triggers editing:exited event synchronously,
        // which calls handleEditingExited -> returnToPreviousTool -> deactivates this tool
        activeText.exitEditing();
        // After exitEditing, tool may have been switched - check if still active
        if (!this.isActive) return;
      }
      // Check if activeTextObject was cleared by the event handler
      if (this.activeTextObject && activeText && activeText.text !== undefined) {
        if (!activeText.text.trim()) {
          this.activeTextObject = null;
        } else {
          return;
        }
      }
    }

    // Double-check we're still the active tool before creating new text
    if (!this.isActive) return;

    // If clicking on existing text object, edit it
    if (o.target && (o.target.type === 'i-text' || o.target.type === 'text')) {
      this.editExistingText(o.target);
      return;
    }

    // Create new text at click position
    this.createNewText(o);
  }

  createNewText(o) {
    const pointer = this.canvas.getPointer(o.e);
    const backgroundEnabled = window.textBgEnabled !== false;
    this.backgroundEnabled = backgroundEnabled;
    const text = new fabric.IText('', {
      left: pointer.x,
      top: pointer.y,
      fontFamily: 'Arial',
      fill: this.textColor,
      fontSize: this.fontSize,
      selectable: true,
      evented: true,
      borderColor: '#3b82f6',
      editingBorderColor: '#3b82f6',
      padding: 5,
      stroke: 'transparent',
      strokeWidth: 0,
      backgroundColor: backgroundEnabled ? '#ffffff' : 'transparent',
      hoverCursor: 'text',
    });

    this.canvas.add(text);
    this.canvas.setActiveObject(text);
    this.activeTextObject = text;

    // Enter editing mode FIRST so cursor appears immediately
    text.enterEditing();
    text.selectAll();
    // Ensure hidden textarea gets focus - try immediately and with a small delay
    // in case Fabric.js hasn't fully set it up yet
    if (text.hiddenTextarea) {
      text.hiddenTextarea.focus();
    }
    requestAnimationFrame(() => {
      if (text.hiddenTextarea) {
        text.hiddenTextarea.focus();
      }
    });

    // Attach metadata for visibility tracking (has 50ms delay, runs in background)
    if (window.app && window.app.metadataManager && window.app.projectManager) {
      const currentViewId = window.app.projectManager.currentViewId || 'front';
      window.app.metadataManager.attachTextMetadata(text, currentViewId);
    }

    // Handle when editing exits
    const onEditingExited = () => {
      text.off('editing:exited', onEditingExited);
      this.handleEditingExited(text, true);
    };
    text.on('editing:exited', onEditingExited);
  }

  editExistingText(textObj) {
    this.activeTextObject = textObj;
    textObj.enterEditing();
    textObj.selectAll();
    if (textObj.hiddenTextarea) {
      textObj.hiddenTextarea.focus();
    }

    const onEditingExited = () => {
      textObj.off('editing:exited', onEditingExited);
      this.handleEditingExited(textObj, false);
    };
    textObj.on('editing:exited', onEditingExited);
  }

  handleEditingExited(text, isNewText) {
    // Handle empty text - remove it
    const isEmpty = text.text.trim() === '';
    if (isEmpty) {
      // Remove from metadata manager if it was a new text
      if (isNewText && window.app && window.app.metadataManager) {
        window.app.metadataManager.removeTextMetadata(text);
      }
      this.canvas.remove(text);
    } else {
      // Save state after text is created/edited
      if (window.app && window.app.historyManager) {
        window.app.historyManager.saveState();
      }
    }

    this.activeTextObject = null;
    this.canvas.requestRenderAll();
    this.returnToPreviousTool();
  }

  returnToPreviousTool() {
    if (!window.app || !window.app.toolManager) return;

    const toolManager = window.app.toolManager;
    const previousTool = toolManager.previousToolName || 'line';

    // Map tool names to toggle labels
    const toolLabels = {
      line: 'Straight Line',
      curve: 'Curved Line',
      select: 'Select',
    };

    // Switch to previous tool
    toolManager.selectTool(previousTool);

    // Update toggle label
    const drawingModeToggle = document.getElementById('drawingModeToggle');
    if (drawingModeToggle && window.app.updateToggleLabel) {
      const label = toolLabels[previousTool] || 'Straight Line';
      window.app.updateToggleLabel(drawingModeToggle, label);
    }

    // Clear previous tool reference
    toolManager.previousToolName = null;
  }

  setColor(color) {
    this.textColor = color;
    const activeObj = this.canvas.getActiveObject();
    if (activeObj && (activeObj.type === 'i-text' || activeObj.type === 'text')) {
      activeObj.set('fill', color);
      activeObj.set('stroke', 'transparent');
      activeObj.set('strokeWidth', 0);
      this.canvas.requestRenderAll();
    }
  }

  setFontSize(size) {
    this.fontSize = parseInt(size, 10);
    const activeObj = this.canvas.getActiveObject();
    if (activeObj && (activeObj.type === 'i-text' || activeObj.type === 'text')) {
      activeObj.set('fontSize', this.fontSize);
      this.canvas.requestRenderAll();
    }
  }

  setWidth() {
    // Text stroke is disabled; brush size does not affect text appearance.
  }
}
