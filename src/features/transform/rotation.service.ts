/**
 * Rotation Service
 * Handles proper rotation of images and their associated elements (strokes, labels)
 * with consistent label handling to fix rotation bug
 */

import { useTransformStore } from './store';
import { useCanvasStore } from '../canvas/store';
import { useGalleryStore } from '../gallery/store';
import type { TransformConfig, TransformCallbacks } from './types';
import type { Point, Dimensions } from '../store/types';

export class RotationService {
  private callbacks: TransformCallbacks = {};
  private config: TransformConfig = {
    rotationIncrement: 90,
    rotateStrokes: true,
    rotateLabels: true,
    animationDuration: 200,
    animated: false,
  };

  /**
   * Configure rotation service
   */
  configure(config: Partial<TransformConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Set callbacks for transform events
   */
  setCallbacks(callbacks: TransformCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Get canvas dimensions from canvas store or DOM fallback
   */
  getCanvasDimensions(): Dimensions {
    // Try canvas store first
    const storeDimensions = useCanvasStore.getState().getDimensions();
    if (storeDimensions.width > 0 && storeDimensions.height > 0) {
      return storeDimensions;
    }

    // Fallback to DOM
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    if (!canvas) {
      console.warn('[RotationService] Canvas not found, using fallback dimensions');
      return { width: 800, height: 600 };
    }
    return {
      width: canvas.width,
      height: canvas.height,
    };
  }

  /**
   * Get current image label from gallery store
   */
  getCurrentImageLabel(): string | null {
    return useGalleryStore.getState().activeImageLabel;
  }

  /**
   * Rotate an image left by configured increment
   */
  rotateLeft(imageLabel: string): void {
    this.rotate(imageLabel, -this.config.rotationIncrement, this.getCanvasDimensions());
  }

  /**
   * Rotate an image right by configured increment
   */
  rotateRight(imageLabel: string): void {
    this.rotate(imageLabel, this.config.rotationIncrement, this.getCanvasDimensions());
  }

  /**
   * Rotate an image by a specific angle
   */
  rotate(imageLabel: string, degrees: number, canvasDimensions?: Dimensions): void {
    const dimensions = canvasDimensions || this.getCanvasDimensions();

    this.callbacks.onTransformStart?.(imageLabel, 'rotate');

    useTransformStore.getState().rotateImage(imageLabel, degrees, dimensions);

    this.callbacks.onTransformComplete?.(imageLabel, 'rotate', degrees);
    this.callbacks.onRedrawRequired?.(imageLabel);
    this.callbacks.onThumbnailUpdateRequired?.(imageLabel);
  }

  /**
   * Flip an image horizontally
   */
  flipHorizontal(imageLabel: string): void {
    const dimensions = this.getCanvasDimensions();

    this.callbacks.onTransformStart?.(imageLabel, 'flipH');

    useTransformStore.getState().flipImageHorizontal(imageLabel, dimensions);

    this.callbacks.onTransformComplete?.(imageLabel, 'flipH', 1);
    this.callbacks.onRedrawRequired?.(imageLabel);
    this.callbacks.onThumbnailUpdateRequired?.(imageLabel);
  }

  /**
   * Flip an image vertically
   */
  flipVertical(imageLabel: string): void {
    const dimensions = this.getCanvasDimensions();

    this.callbacks.onTransformStart?.(imageLabel, 'flipV');

    useTransformStore.getState().flipImageVertical(imageLabel, dimensions);

    this.callbacks.onTransformComplete?.(imageLabel, 'flipV', 1);
    this.callbacks.onRedrawRequired?.(imageLabel);
    this.callbacks.onThumbnailUpdateRequired?.(imageLabel);
  }

  /**
   * Get current rotation in degrees
   */
  getRotationDegrees(imageLabel: string): number {
    return useTransformStore.getState().getRotationDegrees(imageLabel);
  }

  /**
   * Set rotation center for an image
   */
  setRotationCenter(imageLabel: string, center: Point): void {
    useTransformStore.getState().setRotationCenter(imageLabel, center);
  }

  /**
   * Check if a transform is in progress
   */
  isTransforming(): boolean {
    return useTransformStore.getState().isTransforming;
  }

  /**
   * Get transform history
   */
  getTransformHistory(imageLabel?: string) {
    return useTransformStore.getState().getTransformHistory(imageLabel);
  }

  /**
   * Clear transform history
   */
  clearHistory(imageLabel?: string): void {
    useTransformStore.getState().clearHistory(imageLabel);
  }
}

// Export singleton instance
export const rotationService = new RotationService();

// ═══════════════════════════════════════════════════════════════════════════
// SELECTORS
// ═══════════════════════════════════════════════════════════════════════════

export const selectRotationForImage =
  (imageLabel: string) => (state: ReturnType<typeof useTransformStore.getState>) =>
    state.rotationByImage.get(imageLabel);

export const selectRotationDegreesForImage =
  (imageLabel: string) => (state: ReturnType<typeof useTransformStore.getState>) =>
    state.getRotationDegrees(imageLabel);

export const selectIsTransforming = (state: ReturnType<typeof useTransformStore.getState>) =>
  state.isTransforming;

export const selectTransformHistory = (state: ReturnType<typeof useTransformStore.getState>) =>
  state.transformHistory;
