import type { MeasurementSplitWorkspaceState } from '../modules/ui/measurement-split-workspace';

interface ScrollSelectSystemApi {
  loadState: () => boolean;
  persistState: (enabled: boolean) => void;
  setEnabled: (enabled: boolean, source?: string) => void;
  isEnabled: () => boolean;
  getAlignedContainer: (imageList: HTMLElement) => {
    container: HTMLElement;
    distance: number;
    tolerance: number;
    center: number;
  } | null;
  syncSelection: () => void;
  initialize: () => void;
}

interface ProjectManagerLike {
  currentViewId?: string;
  views?: Record<string, { image?: string | Blob | null } | undefined>;
  switchView?: (label: string) => void | Promise<void>;
}

interface PaintAppLike {
  state?: {
    currentImageLabel?: string;
  };
}

declare global {
  interface Window {
    scrollToSelectEnabled?: boolean;
    scrollSelectSystem?: ScrollSelectSystemApi;
    updateImageListPadding?: () => void;
    syncSelectionToCenteredThumbnail?: () => void;
    updateActivePill?: (options?: { animate?: boolean }) => void;
    updatePills?: () => HTMLButtonElement[];
    updateActiveImageInSidebar?: () => void;
    projectManager?: ProjectManagerLike;
    paintApp?: PaintAppLike | any;
    currentImageLabel?: string;
    switchToImage?: (label: string | number) => void;
    captureTabsByLabel?: Record<string, any>;
    ensureCaptureTabsForLabel?: (label: string) => any;
    setActiveCaptureTab?: (label: string, tabId: string, options?: { skipSave?: boolean }) => void;
    initializeCaptureFrameForImageAspect?: (
      label: string,
      imageWidth: number,
      imageHeight: number
    ) => boolean;
    __openpaintResetCaptureResizeAnchor?: () => void;
    createCaptureTabForLabel?: (label?: string) => void;
    deleteCaptureTabForLabel?: (label: string, tabId: string) => void;
    originalImages?: Record<string, string | Blob | undefined>;
    __suppressScrollSelectUntil?: number;
    __imageListProgrammaticScrollUntil?: number;
    __miniStepperProgrammaticScrollUntil?: number;
    __miniStepperLastAutoScrollLabel?: string;
    __imageListCenteringObserver?: IntersectionObserver | null;
    __pillCenteringObserver?: IntersectionObserver | null;
    createPanelToggle?: (panelId: string, contentId: string, buttonId: string) => void;
    createSidebarToggle?: (panelId: string, contentId: string, buttonId: string) => void;
    getMeasurementSplitWorkspaceState?: () => MeasurementSplitWorkspaceState;
    openMeasurementSplitWorkspace?: (viewId: string) => boolean;
    closeMeasurementSplitWorkspace?: () => boolean;
    resetMeasurementSplitWorkspace?: () => void;
    mountMeasurementSplitStrokePanel?: () => boolean;
    restoreMeasurementSplitStrokePanel?: () => boolean;
    isMeasurementSplitWorkspaceActive?: () => boolean;
    shouldAllowMeasurementSplitEdit?: (scopeLabel: string, strokeLabel?: string) => boolean;
    renderCwMeasurementWorkspacePane?: () => void;
  }
}

export {};
