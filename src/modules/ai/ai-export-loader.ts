// AI export module loader

interface AIExportModule {
  exportAIEnhancedSVG: typeof window.exportAIEnhancedSVG;
  assistMeasurement: typeof window.assistMeasurement;
  enhanceAnnotations: typeof window.enhanceAnnotations;
}

export async function initAIExport(): Promise<void> {
  try {
    console.log('[AI Export] Starting to load AI export module...');
    const module = (await import('./ai-export')) as AIExportModule;
    console.log('[AI Export] Module loaded, exports:', Object.keys(module));

    const { exportAIEnhancedSVG, assistMeasurement, enhanceAnnotations } = module;

    // Make functions available globally
    window.exportAIEnhancedSVG = exportAIEnhancedSVG;
    window.assistMeasurement = assistMeasurement;
    window.enhanceAnnotations = enhanceAnnotations;

    // Initialize AI exports storage
    if (!window.aiExports) {
      window.aiExports = {};
    }

    console.log('[AI Export] Functions loaded and available globally');
    console.log('[AI Export] window.exportAIEnhancedSVG:', typeof window.exportAIEnhancedSVG);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error('[AI Export] Failed to load AI export module:', errorMessage);
    if (errorStack) {
      console.error('[AI Export] Error stack:', errorStack);
    }
    // Create stub functions to prevent errors
    window.exportAIEnhancedSVG = () =>
      Promise.reject(new Error(`AI Export module failed to load: ${errorMessage}`));
    window.assistMeasurement = () =>
      Promise.reject(new Error(`AI Export module failed to load: ${errorMessage}`));
    window.enhanceAnnotations = () =>
      Promise.reject(new Error(`AI Export module failed to load: ${errorMessage}`));
  }
}
