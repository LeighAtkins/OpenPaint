// Select Tool (for moving/deleting objects)
import { BaseTool } from './BaseTool.js';

export class SelectTool extends BaseTool {
  constructor(canvasManager) {
    super(canvasManager);
  }

  activate() {
    super.activate();
    if (!this.canvas) {
      console.error('SelectTool: Canvas not available');
      return;
    }

    // Enable selection and object manipulation
    this.canvas.isDrawingMode = false;
    this.canvas.selection = true;
    this.canvas.defaultCursor = 'default';

    const currentView = window.app?.projectManager?.currentViewId || 'front';
    const baseView = typeof currentView === 'string' ? currentView.split('::tab:')[0] : currentView;
    const state = window.ensureCaptureTabsForLabel?.(baseView) || null;
    const isMasterView =
      !!state && (state.activeTabId === state.masterTabId || state.activeTabId === 'master');
    const primaryTabId = state?.tabs?.find(tab => tab.type !== 'master')?.id;
    const targetTabId = isMasterView
      ? window.captureMasterDrawTargetByLabel?.[baseView] || state?.lastNonMasterId || primaryTabId
      : state?.activeTabId;
    const targetScopeLabel =
      targetTabId && targetTabId !== 'master' ? `${baseView}::tab:${targetTabId}` : baseView;
    const allowLegacyBase = !!primaryTabId && targetTabId === primaryTabId;

    // Enable object controls for all objects (except label text)
    this.canvas.forEachObject(obj => {
      // Skip label text objects (they have evented: false)
      if (obj.evented === false && obj.selectable === false) {
        return; // Skip label objects
      }
      if (isMasterView) {
        const objectLabel = obj?.strokeMetadata?.imageLabel || obj?.imageLabel;
        const isTargetObject = objectLabel
          ? objectLabel.includes('::tab:')
            ? objectLabel === targetScopeLabel
            : allowLegacyBase && objectLabel === baseView
          : false;
        obj.selectable = isTargetObject;
        obj.evented = isTargetObject;
        return;
      }
      obj.selectable = true;
      obj.evented = true;
    });

    this.canvas.renderAll();
    console.log('SelectTool activated');
  }

  deactivate() {
    super.deactivate();
    // Selection stays enabled, just mark as inactive
  }
}
