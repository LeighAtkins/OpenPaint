/**
 * OpenPaint — Single Vite Entry Point
 *
 * This is the ONLY runtime entry point. All application code is imported
 * through this file. No other <script> tags load runtime code.
 */

// ── 0. Pre-render CSS configuration (runs synchronously on import) ──────────
// Must happen before any CSS renders to prevent FOUC
(function preRender() {
  document.documentElement.classList.add('app-loading');
  const windowWidth = window.innerWidth || 1920;
  const isMobile = windowWidth <= 768;
  const toolbarMode = isMobile ? 'compact' : 'full';
  document.documentElement.setAttribute('data-toolbar-mode', toolbarMode);
  document.documentElement.setAttribute('data-toolbar-initial', toolbarMode);
})();

// Suppress autofill extension errors
window.addEventListener('error', event => {
  if (event.message && event.message.includes('autofill.bundle.js')) {
    event.preventDefault();
  }
});

// ── 1. Vendor libraries (must load before app modules) ──────────────────────
import { fabric } from 'fabric';

(globalThis as any).fabric = fabric;

// ── 2. TypeScript utilities ─────────────────────────────────────────────────
import { logger } from '@/utils/errors';
import { env } from '@/utils/env';
import { initializeRotationControls } from '@/features';

// ── 3. Type declarations ────────────────────────────────────────────────────
declare global {
  interface Window {
    app?: any;
    paintApp?: any;
    PDFLib?: any;
    JSZip?: any;
    saveAs?: any;
    metadataManager?: any;
    projectManager?: any;
    vectorStrokesByImage?: any;
    strokeVisibilityByImage?: any;
    strokeLabelVisibility?: any;
    strokeMeasurements?: any;
    // UI globals
    showStatusMessage?: any;
    hideStatusMessage?: any;
    updateImageListPadding?: any;
    syncSelectionToCenteredThumbnail?: any;
    updateActivePill?: any;
    scrollToSelectEnabled?: any;
    originalImages?: any;
    originalImageDimensions?: any;
    currentImageLabel?: any;
    textBgEnabled?: any;
    saveAllImages?: any;
    showPDFExportDialog?: any;
    resizeCanvas?: any;
    shareProject?: any;
    updateSharedProject?: any;
    saveFabricProject?: any;
    updateStrokeVisibilityControls?: any;
    aiExports?: any;
    exportAIEnhancedSVG?: any;
    assistMeasurement?: any;
    enhanceAnnotations?: any;
    saveCurrentCaptureFrameForLabel?: any;
    __TEXT_DEBUG?: boolean;
  }
}

// ── 4. Extracted inline scripts (from index.html) ───────────────────────────
import { initToolbarSizing } from './modules/ui/toolbar-sizing.js';
import { initToolbarReady } from './modules/ui/toolbar-ready.js';
import { initPanelRelocation } from './modules/ui/panel-relocation.js';
import { initFrameCaptureToggle } from './modules/ui/frame-capture-toggle.js';
import { initPdfExport } from './modules/ui/pdf-export-inline.js';
import { initToolbarController } from './modules/ui/toolbar-controller.js';
import { initScrollSelectSystem } from './modules/ui/scroll-select-init.js';
import { initStatusMessageHandler } from './modules/ui/status-message-handler.js';
import { initAIExport } from './modules/ai/ai-export-loader.js';

// ── 5. Standalone UI modules ─────────────────────────────────────────────────
import './modules/ui/toolbar-layout.js';
import './modules/ui/frame-capture-visibility.js';
import './modules/ui/toolbar-init.js';
import './modules/ui/smart-labels.js';
import './modules/ui/panel-management.js';
import './modules/ui/capture-frame.js';
import './modules/ui/image-gallery.js';
import './modules/ui/scroll-select-system.js';
import './modules/ui/mini-stepper.js';
import './modules/ui/status-message.js';
import './modules/utils/transform';
import './modules/utils/geometry';
import './modules/utils/migration';
import './modules/ai/ai-integration.js';

// ── 6. Core application ────────────────────────────────────────────────────
// The App class from modules/main.js is the heart of the application.
// It creates all managers (CanvasManager, ToolManager, ProjectManager, etc.)
// and wires up the entire UI.

const CONTEXT = 'OpenPaint';

async function bootstrap(): Promise<void> {
  logger.info(CONTEXT, 'Bootstrapping OpenPaint...');
  logger.info(CONTEXT, `Environment: ${env.isDevelopment ? 'development' : 'production'}`);

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    await new Promise<void>(resolve => {
      document.addEventListener('DOMContentLoaded', () => resolve());
    });
  }

  // ── Run pre-DOM-ready UI init ──
  initToolbarSizing();
  initToolbarReady();
  initPanelRelocation();
  initFrameCaptureToggle();

  // ── Initialize the core App (from modules/main.js) ──
  // The App class self-initializes on DOMContentLoaded via its own listener.
  // We import it here so Vite bundles it; its DOMContentLoaded listener
  // will fire since the DOM is already ready at this point.
  await import('./modules/main.js');

  // ── Post-app initialization ──
  // These run after the App has initialized and set window.app

  // Initialize PDF export (uses pdf-lib npm package)
  initPdfExport();

  // Initialize toolbar controller (wires up arrow toggles, dash patterns, etc.)
  initToolbarController();

  // Initialize scroll-select system and mini-stepper
  initScrollSelectSystem();

  // Initialize status message handler
  initStatusMessageHandler();

  // Initialize AI export (async, non-blocking)
  initAIExport().catch((error: unknown) => {
    console.warn('[AI Export] Non-critical init failure:', error);
  });

  // ── TypeScript enhancements ──
  try {
    initializeRotationControls();
    logger.info(CONTEXT, 'Rotation controls initialized');
  } catch (error) {
    logger.error(CONTEXT, 'Failed to initialize rotation controls', error);
  }

  // Enhanced error handling
  window.addEventListener('error', event => {
    logger.error(CONTEXT, 'Global error caught', {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      error: event.error,
    });
  });

  window.addEventListener('unhandledrejection', event => {
    logger.error(CONTEXT, 'Unhandled promise rejection', event.reason);
    event.preventDefault();
  });

  // Expose TypeScript utilities
  if (!window.paintApp) {
    window.paintApp = {} as any;
  }
  (window.paintApp as any).ts = {
    logger,
    env,
    version: '2.0.0',
  };

  // Development helpers
  if (env.isDevelopment) {
    (window as any).__openpaint_ts_dev = {
      logger,
      env,
      getState: () => ({
        appPresent: !!window.app,
      }),
    };
    logger.debug(CONTEXT, 'Development helpers exposed at window.__openpaint_ts_dev');
  }

  // Remove loading class
  document.documentElement.classList.remove('app-loading');

  logger.info(CONTEXT, 'Bootstrap complete');
}

// ── Start ──
bootstrap().catch(error => {
  console.error('OpenPaint bootstrap failed:', error);
});
