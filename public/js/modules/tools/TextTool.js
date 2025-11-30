// Text Tool
import { BaseTool } from './BaseTool.js';

export class TextTool extends BaseTool {
  constructor(canvasManager) {
    super(canvasManager);
    this.textColor = '#000000';
    this.fontSize = 20;
    this.onMouseDown = this.onMouseDown.bind(this);
  }

  activate() {
    super.activate();
    this.canvas.selection = false;
    this.canvas.defaultCursor = 'text';
    this.canvas.on('mouse:down', this.onMouseDown);
  }

  deactivate() {
    super.deactivate();
    this.canvas.selection = true;
    this.canvas.defaultCursor = 'default';
    this.canvas.off('mouse:down', this.onMouseDown);
  }

  onMouseDown(o) {
    if (!this.isActive) return;

    // If clicking on existing text object, don't create new one
    if (o.target && (o.target.type === 'i-text' || o.target.type === 'text')) {
      return;
    }

    const pointer = this.canvas.getPointer(o.e);
    const text = new fabric.IText('Type here...', {
      left: pointer.x,
      top: pointer.y,
      fontFamily: 'Arial',
      fill: this.textColor,
      fontSize: this.fontSize,
      selectable: true,
      evented: true,
    });

    this.canvas.add(text);
    this.canvas.setActiveObject(text);
    text.enterEditing();
    text.selectAll();

    // Attach metadata for visibility tracking
    if (window.app && window.app.metadataManager && window.app.projectManager) {
      const currentViewId = window.app.projectManager.currentViewId || 'front';
      window.app.metadataManager.attachTextMetadata(text, currentViewId);
    }

    // When editing exits, save state and revert to drawing mode
    const onEditingExited = () => {
      // Save state after text is created/edited
      if (window.app && window.app.historyManager) {
        window.app.historyManager.saveState();
      }

      // Revert to drawing mode (straight line)
      if (window.app && window.app.toolManager) {
        window.app.toolManager.selectTool('line');

        // Update button label if drawingModeToggle exists
        const drawingModeToggle = document.getElementById('drawingModeToggle');
        if (drawingModeToggle && window.app.updateToggleLabel) {
          window.app.updateToggleLabel(drawingModeToggle, 'Straight Line');
        }
      }

      // Remove this listener to avoid multiple calls
      text.off('editing:exited', onEditingExited);
    };

    text.on('editing:exited', onEditingExited);
  }

  setColor(color) {
    this.textColor = color;
    const activeObj = this.canvas.getActiveObject();
    if (activeObj && (activeObj.type === 'i-text' || activeObj.type === 'text')) {
      activeObj.set('fill', color);
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
}
