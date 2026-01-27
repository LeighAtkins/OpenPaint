/**
 * OpenPaint Feature Modules
 *
 * This module exports all feature stores and services for the TypeScript-based
 * state management system. These modules are designed to work alongside the
 * legacy JavaScript code during the migration period.
 *
 * Usage:
 * ```typescript
 * import { useGalleryStore, useDrawingStore, rotationService } from '@/features';
 *
 * // In a component or effect
 * const activeImage = useGalleryStore(state => state.getCurrentImage());
 * rotationService.rotateRight(imageLabel, { width: 800, height: 600 });
 * ```
 */

// Shared types
export * from './store';

// Gallery feature
export {
  useGalleryStore,
  selectActiveImage,
  selectImageCount,
  selectImageByLabel,
  selectOrderedImages,
  selectNavigationState,
  galleryController,
} from './gallery';

export type {
  GalleryState,
  GalleryActions,
  GalleryStore,
  GalleryEvent,
  GalleryEventType,
  ThumbnailConfig,
  NavigationState,
  NavigationActions,
} from './gallery';

// Drawing feature (strokes, measurements, labels)
export {
  useDrawingStore,
  selectStrokesForImage,
  selectSelectedStrokes,
  selectIsDirty,
} from './drawing';

export type {
  DrawingState,
  DrawingActions,
  DrawingStore,
  StrokeCreationOptions,
  InProgressStroke,
  DrawingEvent,
  DrawingEventType,
} from './drawing';

// Canvas feature
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
  getCurrentTool,
  setCurrentTool,
  isDrawing,
  setIsDrawing,
  getBrushSettings,
  setBrushSettings,
  resetTool,
} from './canvas';

export type { CanvasState, CanvasActions, CanvasStore } from './canvas';

// Transform feature
export {
  useTransformStore,
  rotationService,
  RotationService,
  selectRotationForImage,
  selectRotationDegreesForImage,
  selectIsTransforming,
  selectTransformHistory,
  normalizeAngle,
  normalizeRadians,
  degreesToRadians,
  radiansToDegrees,
  initializeRotationControls,
  cleanupRotationControls,
} from './transform';

export type {
  TransformState,
  TransformActions,
  TransformStore,
  TransformEvent,
  TransformEventType,
  TransformCallbacks,
  TransformConfig,
} from './transform';
