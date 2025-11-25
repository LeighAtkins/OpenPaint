/**
 * OpenPaint TypeScript Entry Point
 * 
 * This is the main entry point for the new TypeScript application.
 * During migration, this will run alongside the existing JavaScript modules.
 */

import { logger } from '@/utils/errors';
import { env } from '@/utils/env';

const CONTEXT = 'OpenPaintTS';

// Type definitions for the existing JavaScript app
declare global {
  interface Window {
    app?: any;
    paintApp?: any;
    // Legacy compatibility
    metadataManager?: any;
    projectManager?: any;
    vectorStrokesByImage?: any;
    strokeVisibilityByImage?: any;
    strokeLabelVisibility?: any;
    strokeMeasurements?: any;
  }
}

class OpenPaintApp {
  private initialized = false;

  constructor() {
    logger.info(CONTEXT, 'OpenPaint TypeScript layer initializing...');
    this.checkEnvironment();
  }

  private checkEnvironment(): void {
    logger.info(CONTEXT, `Environment: ${env.isDevelopment ? 'development' : 'production'}`);
    logger.info(CONTEXT, `Supabase configured: ${env.supabase.url ? 'yes' : 'no'}`);
    
    if (env.isDevelopment) {
      logger.debug(CONTEXT, 'Development mode - enhanced logging enabled');
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn(CONTEXT, 'Already initialized');
      return;
    }

    try {
      logger.info(CONTEXT, 'Starting TypeScript application initialization...');

      // Wait for DOM to be ready
      if (document.readyState !== 'complete') {
        await new Promise(resolve => {
          window.addEventListener('load', resolve);
        });
      }

      // Wait for the existing JavaScript app to initialize first
      await this.waitForLegacyApp();

      // Initialize TypeScript features on top of existing app
      this.initializeTypeScriptFeatures();

      this.initialized = true;
      logger.info(CONTEXT, 'TypeScript application initialized successfully');

    } catch (error) {
      logger.error(CONTEXT, 'Failed to initialize TypeScript application', error);
      throw error;
    }
  }

  private async waitForLegacyApp(): Promise<void> {
    const maxWaitTime = 10000; // 10 seconds
    const checkInterval = 100; // 100ms
    const startTime = Date.now();

    return new Promise((resolve) => {
      const checkLegacyApp = (): void => {
        if (window.app) {
          logger.info(CONTEXT, 'Legacy JavaScript app found - proceeding with integration');
          resolve();
          return;
        }

        if (Date.now() - startTime > maxWaitTime) {
          logger.warn(CONTEXT, 'Legacy app not found - proceeding with TypeScript-only mode');
          resolve();
          return;
        }

        setTimeout(checkLegacyApp, checkInterval);
      };

      checkLegacyApp();
    });
  }

  private initializeTypeScriptFeatures(): void {
    // Add TypeScript enhancements to the existing app
    this.enhanceErrorHandling();
    this.addTypeScriptUtilities();
    
    // Make TypeScript services available globally for development
    if (env.isDevelopment) {
      this.exposeDevelopmentHelpers();
    }
  }

  private enhanceErrorHandling(): void {
    // Enhance global error handling with our typed error system
    window.addEventListener('error', (event) => {
      logger.error(CONTEXT, 'Global error caught', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: event.error
      });
    });

    window.addEventListener('unhandledrejection', (event) => {
      logger.error(CONTEXT, 'Unhandled promise rejection', event.reason);
      event.preventDefault(); // Prevent console spam
    });
  }

  private addTypeScriptUtilities(): void {
    // Add our TypeScript utilities to the global scope for the migration period
    if (!window.paintApp) {
      window.paintApp = {};
    }

    window.paintApp.ts = {
      logger,
      env,
      version: '2.0.0-migration'
    };

    logger.debug(CONTEXT, 'TypeScript utilities added to window.paintApp.ts');
  }

  private exposeDevelopmentHelpers(): void {
    // Development-only helpers
    (window as any).__openpaint_ts_dev = {
      logger,
      env,
      reinitialize: () => this.initialize(),
      getState: () => ({
        initialized: this.initialized,
        legacyAppPresent: !!window.app
      })
    };

    logger.debug(CONTEXT, 'Development helpers exposed at window.__openpaint_ts_dev');
  }
}

// Auto-initialize when this module loads
const app = new OpenPaintApp();

// Initialize immediately in a way that doesn't block the main thread
Promise.resolve().then(() => {
  return app.initialize();
}).catch((error) => {
  console.error('OpenPaint TypeScript initialization failed:', error);
});

// Export for potential manual initialization
export { OpenPaintApp };
export default app;