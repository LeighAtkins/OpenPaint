/**
 * Canvas UI Module
 * Exports canvas store and provides initialization functions
 */

import { useCanvasStore, type CanvasState, type CanvasActions } from './store';
import type { DrawingTool } from '../store/types';

export type { CanvasState, CanvasActions };

/**
 * Get current canvas tool
 */
export function getCurrentTool(): DrawingTool {
  return useCanvasStore.getState().currentTool;
}

/**
 * Set current canvas tool
 */
export function setCurrentTool(tool: DrawingTool): void {
  useCanvasStore.getState().setCurrentTool(tool);
}

/**
 * Check if currently drawing
 */
export function isDrawing(): boolean {
  return useCanvasStore.getState().isDrawing;
}

/**
 * Set drawing state
 */
export function setIsDrawing(isDrawing: boolean): void {
  useCanvasStore.getState().setIsDrawing(isDrawing);
}

/**
 * Get brush settings
 */
export function getBrushSettings(): CanvasState['brushSettings'] {
  return useCanvasStore.getState().brushSettings;
}

/**
 * Set brush settings
 */
export function setBrushSettings(settings: Partial<CanvasState['brushSettings']>): void {
  useCanvasStore.getState().setBrushSettings(settings);
}

/**
 * Reset to default tool
 */
export function resetTool(): void {
  useCanvasStore.getState().setCurrentTool('select');
}
