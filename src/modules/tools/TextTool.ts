// Text Tool
/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-misused-promises, @typescript-eslint/prefer-regexp-exec, @typescript-eslint/unbound-method, prefer-rest-params */
import { BaseTool } from './BaseTool.js';

declare const fabric: any;

interface CanvasMouseEvent {
  e: MouseEvent;
  target?: any;
}

export class TextTool extends BaseTool {
  textColor: string;
  fontSize: number;
  fontFamily: string;
  strokeWidth: number;
  backgroundEnabled: boolean;
  activeTextObject: any | null;
  skipNextClick: boolean;

  constructor(canvasManager: any) {
    super(canvasManager);
    this.textColor = '#000000';
    this.fontSize = 24;
    this.fontFamily = 'Nunito';
    this.strokeWidth = 1;
    this.backgroundEnabled = false;
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.activeTextObject = null;
    this.skipNextClick = false;
  }

  override activate() {
    super.activate();
    this.canvas.selection = false;
    this.canvas.defaultCursor = 'text';
    this.skipNextClick = false;
    this.canvas.off('mouse:down', this.onMouseDown);
    document.removeEventListener('keydown', this.onKeyDown, true);
    this.canvas.on('mouse:down', this.onMouseDown);
    document.addEventListener('keydown', this.onKeyDown, true);
  }

  override deactivate() {
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

  onKeyDown(e: KeyboardEvent) {
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

  onMouseDown(o: CanvasMouseEvent) {
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
        // which calls handleEditingExited and sets skipNextClick
        activeText.exitEditing();
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

  createNewText(o: CanvasMouseEvent) {
    const pointer = this.canvas.getPointer(o.e);
    const backgroundEnabled = window.textBgEnabled !== false;
    this.backgroundEnabled = backgroundEnabled;
    const text = new fabric.IText('', {
      left: pointer.x,
      top: pointer.y,
      fontFamily: this.fontFamily,
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

    void this.enterEditingWithSyncedFont(text);

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

  editExistingText(textObj: any) {
    this.activeTextObject = textObj;
    void this.enterEditingWithSyncedFont(textObj);

    const onEditingExited = () => {
      textObj.off('editing:exited', onEditingExited);
      this.handleEditingExited(textObj, false);
    };
    textObj.on('editing:exited', onEditingExited);
  }

  handleEditingExited(text: any, isNewText: boolean) {
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
    this.skipNextClick = !isNewText;
    this.canvas.requestRenderAll();

    if (isNewText) {
      this.returnToPreviousTool();
    }
  }

  returnToPreviousTool() {
    if (!window.app || !window.app.toolManager) return;

    const toolManager = window.app.toolManager;
    const previousTool = toolManager.previousToolName || 'line';

    if (previousTool === 'text') {
      toolManager.previousToolName = null;
      toolManager.selectTool('line');
      return;
    }

    toolManager.selectTool(previousTool);
    toolManager.previousToolName = null;
  }

  setColor(color: string) {
    this.textColor = color;
    const activeObj = this.canvas.getActiveObject();
    if (activeObj && (activeObj.type === 'i-text' || activeObj.type === 'text')) {
      activeObj.set('fill', color);
      activeObj.set('stroke', 'transparent');
      activeObj.set('strokeWidth', 0);
      this.canvas.requestRenderAll();
    }
  }

  setFontSize(size: number | string) {
    this.fontSize = typeof size === 'number' ? size : parseInt(size, 10);
    const activeObj = this.canvas.getActiveObject();
    if (activeObj && (activeObj.type === 'i-text' || activeObj.type === 'text')) {
      activeObj.set('fontSize', this.fontSize);
      this.syncTextMetrics(activeObj);
      this.canvas.requestRenderAll();
    }
  }

  setFontFamily(fontFamily: string) {
    this.fontFamily = fontFamily;
    const activeObj = this.canvas.getActiveObject();
    if (activeObj && (activeObj.type === 'i-text' || activeObj.type === 'text')) {
      activeObj.set('fontFamily', this.fontFamily);
      this.syncTextMetrics(activeObj);
      this.canvas.requestRenderAll();
    }
  }

  syncTextMetrics(textObj: any) {
    if (!textObj) return;

    if (typeof textObj.initDimensions === 'function') {
      textObj.initDimensions();
    }
    if (typeof textObj.setCoords === 'function') {
      textObj.setCoords();
    }

    const applyTextareaStyle = () => {
      if (!textObj.hiddenTextarea) return;
      textObj.hiddenTextarea.style.fontFamily = textObj.fontFamily || this.fontFamily;
      textObj.hiddenTextarea.style.fontSize = `${textObj.fontSize || this.fontSize}px`;
      textObj.hiddenTextarea.style.lineHeight = String(textObj.lineHeight || 1.16);
      textObj.hiddenTextarea.style.fontWeight = String(textObj.fontWeight || 'normal');
      textObj.hiddenTextarea.style.fontStyle = String(textObj.fontStyle || 'normal');
    };

    applyTextareaStyle();

    const fontSet = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (!fontSet || typeof fontSet.load !== 'function') {
      this.canvas.requestRenderAll();
      return;
    }

    const fontSize = Number(textObj.fontSize || this.fontSize || 24);
    const family = String(textObj.fontFamily || this.fontFamily || 'sans-serif');
    void fontSet
      .load(`${fontSize}px "${family}"`)
      .then(() => {
        if (typeof textObj.initDimensions === 'function') {
          textObj.initDimensions();
        }
        if (typeof textObj.setCoords === 'function') {
          textObj.setCoords();
        }
        applyTextareaStyle();
        this.canvas.requestRenderAll();
      })
      .catch(() => {
        this.canvas.requestRenderAll();
      });
  }

  async enterEditingWithSyncedFont(textObj: any) {
    if (!textObj) return;

    await this.ensureFontReady(
      textObj.fontFamily || this.fontFamily,
      textObj.fontSize || this.fontSize
    );

    textObj.enterEditing();
    textObj.selectAll();
    this.syncTextMetrics(textObj);

    const focusTextarea = () => {
      if (textObj.hiddenTextarea) {
        textObj.hiddenTextarea.focus();
        textObj.hiddenTextarea.style.fontFamily = textObj.fontFamily || this.fontFamily;
        textObj.hiddenTextarea.style.fontSize = `${textObj.fontSize || this.fontSize}px`;
        textObj.hiddenTextarea.style.lineHeight = String(textObj.lineHeight || 1.16);
        textObj.hiddenTextarea.style.fontWeight = String(textObj.fontWeight || 'normal');
        textObj.hiddenTextarea.style.fontStyle = String(textObj.fontStyle || 'normal');
      }
    };

    focusTextarea();
    requestAnimationFrame(focusTextarea);
  }

  async ensureFontReady(fontFamily: string, fontSize: number) {
    const fontSet = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (!fontSet || typeof fontSet.load !== 'function') {
      return;
    }

    try {
      await fontSet.load(`${fontSize || 24}px "${fontFamily || this.fontFamily}"`);
    } catch {
      // Best effort only.
    }
  }

  setWidth() {
    // Text stroke is disabled; brush size does not affect text appearance.
  }
}
