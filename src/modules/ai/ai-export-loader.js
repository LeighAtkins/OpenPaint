// AI export module loader

export async function initAIExport() {
  try {
    console.log('[AI Export] Starting to load AI export module...');
    const module = await import('./ai-export.js');
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
    console.error('[AI Export] Failed to load AI export module:', error);
    console.error('[AI Export] Error stack:', error.stack);
    // Create stub functions to prevent errors
    window.exportAIEnhancedSVG = () =>
      Promise.reject(new Error('AI Export module failed to load: ' + error.message));
    window.assistMeasurement = () =>
      Promise.reject(new Error('AI Export module failed to load: ' + error.message));
    window.enhanceAnnotations = () =>
      Promise.reject(new Error('AI Export module failed to load: ' + error.message));
  }
}
