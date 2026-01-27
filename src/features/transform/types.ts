/**
 * Transform feature types
 */

import type {
  Point,
  Dimensions,
  TransformType,
  RotationState,
  TransformMeta,
} from '../store/types';

// ═══════════════════════════════════════════════════════════════════════════
// TRANSFORM STATE
// ═══════════════════════════════════════════════════════════════════════════

export interface TransformState {
  /** Rotation state per image */
  rotationByImage: Map<string, RotationState>;
  /** Transform history for undo support */
  transformHistory: TransformMeta[];
  /** Maximum history size */
  maxHistorySize: number;
  /** Whether a transform is in progress */
  isTransforming: boolean;
}

export interface TransformActions {
  // Rotation operations
  rotateImage: (imageLabel: string, degrees: number, canvasDimensions: Dimensions) => void;
  setRotationCenter: (imageLabel: string, center: Point) => void;
  getRotation: (imageLabel: string) => RotationState | undefined;
  getRotationDegrees: (imageLabel: string) => number;

  // Flip operations
  flipImageHorizontal: (imageLabel: string, canvasDimensions: Dimensions) => void;
  flipImageVertical: (imageLabel: string, canvasDimensions: Dimensions) => void;

  // History operations
  recordTransform: (meta: TransformMeta) => void;
  getTransformHistory: (imageLabel?: string) => TransformMeta[];
  clearHistory: (imageLabel?: string) => void;

  // Transform state
  setIsTransforming: (transforming: boolean) => void;

  // Coordinate transforms
  rotatePoint: (point: Point, degrees: number, center: Point) => Point;
  flipPointHorizontal: (point: Point, width: number) => Point;
  flipPointVertical: (point: Point, height: number) => Point;
}

export type TransformStore = TransformState & TransformActions;

// ═══════════════════════════════════════════════════════════════════════════
// ROTATION UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normalize angle to [0, 360) range
 */
export function normalizeAngle(degrees: number): number {
  const normalized = degrees % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

/**
 * Normalize radians to [-PI, PI) range
 */
export function normalizeRadians(radians: number): number {
  while (radians > Math.PI) radians -= 2 * Math.PI;
  while (radians <= -Math.PI) radians += 2 * Math.PI;
  return radians;
}

/**
 * Convert degrees to radians
 */
export function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Convert radians to degrees
 */
export function radiansToDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

// ═══════════════════════════════════════════════════════════════════════════
// TRANSFORM EVENTS
// ═══════════════════════════════════════════════════════════════════════════

export type TransformEventType =
  | 'transform:started'
  | 'transform:completed'
  | 'transform:cancelled'
  | 'rotation:applied'
  | 'flip:applied';

export interface TransformEvent {
  type: TransformEventType;
  payload: {
    imageLabel: string;
    transformType: TransformType;
    value: number;
    center?: Point;
    dimensions?: Dimensions;
  };
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// TRANSFORM CALLBACKS
// ═══════════════════════════════════════════════════════════════════════════

export interface TransformCallbacks {
  onTransformStart?: (imageLabel: string, transformType: TransformType) => void;
  onTransformComplete?: (imageLabel: string, transformType: TransformType, value: number) => void;
  onRedrawRequired?: (imageLabel: string) => void;
  onThumbnailUpdateRequired?: (imageLabel: string) => void;
}

// ═══════════════════════════════════════════════════════════════════════════
// TRANSFORM CONFIG
// ═══════════════════════════════════════════════════════════════════════════

export interface TransformConfig {
  /** Default rotation increment in degrees */
  rotationIncrement: number;
  /** Whether to rotate strokes with image */
  rotateStrokes: boolean;
  /** Whether to rotate labels with image */
  rotateLabels: boolean;
  /** Animation duration for transforms (ms) */
  animationDuration: number;
  /** Whether transforms are animated */
  animated: boolean;
}

export const DEFAULT_TRANSFORM_CONFIG: TransformConfig = {
  rotationIncrement: 90,
  rotateStrokes: true,
  rotateLabels: true,
  animationDuration: 200,
  animated: false,
};
