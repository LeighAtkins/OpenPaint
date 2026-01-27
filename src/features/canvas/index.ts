/**
 * Canvas feature exports
 */

// Export store (includes types)
export {
  useCanvasStore,
  useCanvasUIStore,
  selectDimensions,
  selectViewportForImage,
  selectZoomForImage,
  selectPanForImage,
  selectIsReady,
  selectCurrentTool,
  selectIsDrawing,
  selectBrushSettings,
  type CanvasState,
  type CanvasActions,
  type CanvasStore,
} from './store';

// Export UI helpers
export {
  getCurrentTool,
  setCurrentTool,
  isDrawing,
  setIsDrawing,
  getBrushSettings,
  setBrushSettings,
  resetTool,
} from './ui';

// Export type constants
export { DEFAULT_VIEWPORT, DEFAULT_DIMENSIONS, MIN_ZOOM, MAX_ZOOM, ZOOM_STEP } from './types';
