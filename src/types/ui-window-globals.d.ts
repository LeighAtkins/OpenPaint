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
    updateActiveImageInSidebar?: () => void;
    projectManager?: ProjectManagerLike;
    paintApp?: PaintAppLike | any;
    currentImageLabel?: string;
    originalImages?: Record<string, string | Blob | undefined>;
    __suppressScrollSelectUntil?: number;
    __imageListProgrammaticScrollUntil?: number;
    __miniStepperProgrammaticScrollUntil?: number;
    __miniStepperLastAutoScrollLabel?: string;
    __imageListCenteringObserver?: IntersectionObserver | null;
    __pillCenteringObserver?: IntersectionObserver | null;
    createPanelToggle?: (panelId: string, contentId: string, buttonId: string) => void;
    createSidebarToggle?: (panelId: string, contentId: string, buttonId: string) => void;
  }
}

export {};
