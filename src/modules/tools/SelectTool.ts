// Select Tool (for moving/deleting objects)
// @ts-nocheck
import { BaseTool } from './BaseTool.js';

interface FabricObjectLike {
  evented?: boolean;
  selectable?: boolean;
  strokeMetadata?: {
    imageLabel?: string;
  };
  imageLabel?: string;
}

interface CanvasLike {
  isDrawingMode: boolean;
  selection: boolean;
  defaultCursor: string;
  forEachObject: (callback: (obj: FabricObjectLike) => void) => void;
  renderAll: () => void;
}

interface CaptureTabState {
  activeTabId?: string;
  masterTabId?: string;
  lastNonMasterId?: string;
  tabs?: Array<{ id: string; type?: string }>;
}

declare global {
  interface Window {
    app?: {
      projectManager?: {
        currentViewId?: string;
      };
    };
    ensureCaptureTabsForLabel?: (label: string) => CaptureTabState | null;
    captureMasterDrawTargetByLabel?: Record<string, string | undefined>;
  }
}

export class SelectTool extends BaseTool {
  declare canvas: CanvasLike | null;

  activate(): void {
    super.activate();
    if (!this.canvas) {
      console.error('SelectTool: Canvas not available');
      return;
    }

    const canvas = this.canvas;

    // Enable selection and object manipulation
    canvas.isDrawingMode = false;
    canvas.selection = true;
    canvas.defaultCursor = 'default';

    const currentView = window.app?.projectManager?.currentViewId ?? 'front';
    const baseView = currentView.split('::tab:')[0];
    const state = window.ensureCaptureTabsForLabel?.(baseView) ?? null;
    const isMasterView =
      !!state && (state.activeTabId === state.masterTabId || state.activeTabId === 'master');
    const primaryTabId = state?.tabs?.find(tab => tab.type !== 'master')?.id;
    const targetTabId = isMasterView
      ? (window.captureMasterDrawTargetByLabel?.[baseView] ??
        state?.lastNonMasterId ??
        primaryTabId)
      : state?.activeTabId;
    const targetScopeLabel =
      targetTabId && targetTabId !== 'master' ? `${baseView}::tab:${targetTabId}` : baseView;
    const allowLegacyBase = !!primaryTabId && targetTabId === primaryTabId;

    // Enable object controls for all objects (except label text)
    canvas.forEachObject(obj => {
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

    canvas.renderAll();
    console.log('SelectTool activated');
  }

  deactivate(): void {
    super.deactivate();
    // Selection stays enabled, just mark as inactive
  }
}
