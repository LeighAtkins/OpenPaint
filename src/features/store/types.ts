/**
 * Shared normalized types for the OpenPaint application
 * These types serve as the source of truth across all features
 */

// ═══════════════════════════════════════════════════════════════════════════
// CORE PRIMITIVES
// ═══════════════════════════════════════════════════════════════════════════

export interface Point {
  x: number;
  y: number;
}

export interface Dimensions {
  width: number;
  height: number;
}

export interface BoundingBox extends Point, Dimensions {}

// ═══════════════════════════════════════════════════════════════════════════
// IMAGE TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface ImageItem {
  /** Unique identifier for the image */
  id: string;
  /** Display label (used as key in legacy global maps) */
  label: string;
  /** Human-readable name */
  name: string;
  /** Full-resolution source URL or data URL */
  src: string;
  /** Thumbnail URL for gallery display */
  thumbnail: string;
  /** Original image dimensions */
  width: number;
  height: number;
  /** Current rotation in degrees (0, 90, 180, 270) normalized to [0, 360) */
  rotation: number;
  /** Image type/category (e.g., 'photo', 'scan', etc.) */
  type?: string;
  /** Whether this is a blank canvas (no underlying bitmap) */
  isBlankCanvas: boolean;
  /** Creation timestamp */
  createdAt: number;
  /** Last modified timestamp */
  updatedAt: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// STROKE TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type StrokeType = 'freehand' | 'straight' | 'curved' | 'arrow';

export interface Stroke {
  /** Unique identifier for the stroke */
  id: string;
  /** Label of the image this stroke belongs to */
  imageLabel: string;
  /** Array of points defining the stroke path */
  points: Point[];
  /** Stroke color (hex or rgba) */
  color: string;
  /** Stroke width in pixels */
  width: number;
  /** Stroke type */
  type: StrokeType;
  /** Optional dash pattern [dash, gap] */
  dashPattern?: [number, number];
  /** Whether this stroke has an arrow head */
  hasArrow?: boolean;
  /** Arrow head style */
  arrowStyle?: 'triangle' | 'open' | 'closed';
  /** Creation timestamp */
  createdAt: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// LABEL & MEASUREMENT TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface LabelPosition {
  /** ID of the stroke this label is attached to */
  strokeId: string;
  /** Normalized X offset from default position (-1 to 1) */
  dx_norm: number;
  /** Normalized Y offset from default position (-1 to 1) */
  dy_norm: number;
}

export interface RelativeLabelPosition {
  /** ID of the stroke this label is attached to */
  strokeId: string;
  /** Position along the stroke as percentage (0-1) */
  percentageAlongLine: number;
  /** Perpendicular distance from stroke in pixels */
  perpendicularDistance: number;
}

export interface Measurement {
  /** Unique identifier */
  id: string;
  /** ID of the stroke this measurement belongs to */
  strokeId: string;
  /** Label of the image */
  imageLabel: string;
  /** Display text (e.g., "12.5 cm") */
  displayText: string;
  /** Raw numeric value */
  value: number;
  /** Unit of measurement */
  unit: 'px' | 'cm' | 'in' | 'mm';
  /** Position relative to stroke */
  position: LabelPosition | RelativeLabelPosition;
  /** Font size in pixels */
  fontSize: number;
  /** Whether this measurement is visible */
  visible: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// CANVAS STATE TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type DrawingTool =
  | 'select'
  | 'pencil'
  | 'brush'
  | 'eraser'
  | 'line'
  | 'arrow'
  | 'rectangle'
  | 'circle'
  | 'text'
  | 'pan'
  | 'zoom';

export interface ViewportState {
  /** Current zoom level (1.0 = 100%) */
  zoom: number;
  /** Pan offset from center */
  panOffset: Point;
  /** Whether currently panning */
  isPanning: boolean;
}

export interface CanvasUIState {
  /** Currently selected tool */
  currentTool: DrawingTool;
  /** Currently drawing */
  isDrawing: boolean;
  /** Selected stroke IDs */
  selectedStrokeIds: string[];
  /** Brush settings */
  brushColor: string;
  brushWidth: number;
  brushOpacity: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// TRANSFORM TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type TransformType = 'rotate' | 'flipH' | 'flipV';

export interface RotationState {
  /** Cumulative rotation in radians */
  radiansTotal: number;
  /** Rotation center point */
  center: Point;
  /** Last rotation delta applied */
  lastDelta: number;
}

export interface TransformMeta {
  /** Image label being transformed */
  imageLabel: string;
  /** Type of transform */
  type: TransformType;
  /** Transform value (degrees for rotation, direction for flip) */
  value: number;
  /** Canvas dimensions at time of transform */
  canvasDimensions: Dimensions;
  /** Timestamp */
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// LEGACY BRIDGE TYPES (for migration)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Maps legacy global variable names to our normalized types
 */
export interface LegacyGlobals {
  /** window.vectorStrokesByImage */
  vectorStrokesByImage: Record<string, Record<string, LegacyStroke>>;
  /** window.lineStrokesByImage */
  lineStrokesByImage: Record<string, string[]>;
  /** window.imageRotationByLabel */
  imageRotationByLabel: Record<string, number>;
  /** window.customLabelPositions */
  customLabelPositions: Record<string, Record<string, Point>>;
  /** window.calculatedLabelOffsets */
  calculatedLabelOffsets: Record<string, Record<string, Point>>;
  /** window.imageGalleryData */
  imageGalleryData: LegacyImageData[];
  /** window.currentImageLabel */
  currentImageLabel: string;
  /** window.originalImages */
  originalImages: Record<string, HTMLImageElement>;
  /** window.originalImageDimensions */
  originalImageDimensions: Record<string, Dimensions>;
}

export interface LegacyStroke {
  points: Point[];
  color?: string;
  width?: number;
  type?: string;
  [key: string]: unknown;
}

export interface LegacyImageData {
  src: string;
  name: string;
  original?: {
    label?: string;
    type?: string;
    isBlankCanvas?: boolean;
    [key: string]: unknown;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY TYPES
// ═══════════════════════════════════════════════════════════════════════════

/** Deep partial type for partial updates */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/** Extract the type from a Record */
export type RecordValue<R> = R extends Record<string, infer V> ? V : never;
