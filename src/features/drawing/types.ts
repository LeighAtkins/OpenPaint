/**
 * Drawing feature types
 */

import type {
  Stroke,
  StrokeType,
  Point,
  Measurement,
  LabelPosition,
  RelativeLabelPosition,
  CanvasUIState,
  ViewportState,
  DrawingTool,
} from '../store/types';

// ═══════════════════════════════════════════════════════════════════════════
// DRAWING STATE
// ═══════════════════════════════════════════════════════════════════════════

export interface DrawingState {
  /** All strokes keyed by image label, then stroke ID */
  strokesByImage: Map<string, Map<string, Stroke>>;
  /** Stroke order per image (for z-index) */
  strokeOrderByImage: Map<string, string[]>;
  /** Custom label positions per image */
  labelPositionsByImage: Map<string, Map<string, LabelPosition>>;
  /** Relative label positions (rotation-resistant) */
  relativeLabelPositionsByImage: Map<string, Map<string, RelativeLabelPosition>>;
  /** Measurements per image */
  measurementsByImage: Map<string, Map<string, Measurement>>;
  /** Canvas UI state */
  uiState: CanvasUIState;
  /** Viewport state per image */
  viewportByImage: Map<string, ViewportState>;
  /** Whether any changes are unsaved */
  isDirty: boolean;
}

export interface DrawingActions {
  // Stroke operations
  addStroke: (imageLabel: string, stroke: Stroke) => void;
  updateStroke: (imageLabel: string, strokeId: string, updates: Partial<Stroke>) => void;
  removeStroke: (imageLabel: string, strokeId: string) => void;
  getStroke: (imageLabel: string, strokeId: string) => Stroke | undefined;
  getStrokesForImage: (imageLabel: string) => Stroke[];

  // Label position operations
  setLabelPosition: (imageLabel: string, strokeId: string, position: LabelPosition) => void;
  setRelativeLabelPosition: (
    imageLabel: string,
    strokeId: string,
    position: RelativeLabelPosition
  ) => void;
  getLabelPosition: (imageLabel: string, strokeId: string) => LabelPosition | undefined;
  getRelativeLabelPosition: (
    imageLabel: string,
    strokeId: string
  ) => RelativeLabelPosition | undefined;

  // Measurement operations
  addMeasurement: (imageLabel: string, measurement: Measurement) => void;
  updateMeasurement: (
    imageLabel: string,
    measurementId: string,
    updates: Partial<Measurement>
  ) => void;
  removeMeasurement: (imageLabel: string, measurementId: string) => void;

  // UI state operations
  setCurrentTool: (tool: DrawingTool) => void;
  setIsDrawing: (isDrawing: boolean) => void;
  setSelectedStrokes: (strokeIds: string[]) => void;
  setBrushSettings: (color?: string, width?: number, opacity?: number) => void;

  // Viewport operations
  setViewport: (imageLabel: string, viewport: Partial<ViewportState>) => void;
  getViewport: (imageLabel: string) => ViewportState;

  // Dirty state
  setDirty: (dirty: boolean) => void;

  // Batch operations
  clearImageData: (imageLabel: string) => void;
  clearAllData: () => void;

  // Transform operations (applied to all strokes for an image)
  transformStrokes: (imageLabel: string, transformFn: (point: Point) => Point) => void;
}

export type DrawingStore = DrawingState & DrawingActions;

// ═══════════════════════════════════════════════════════════════════════════
// STROKE CREATION
// ═══════════════════════════════════════════════════════════════════════════

export interface StrokeCreationOptions {
  type: StrokeType;
  color: string;
  width: number;
  dashPattern?: [number, number];
  hasArrow?: boolean;
  arrowStyle?: 'triangle' | 'open' | 'closed';
}

export interface InProgressStroke {
  id: string;
  imageLabel: string;
  points: Point[];
  options: StrokeCreationOptions;
  startTime: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// DRAWING EVENTS
// ═══════════════════════════════════════════════════════════════════════════

export type DrawingEventType =
  | 'stroke:started'
  | 'stroke:point-added'
  | 'stroke:completed'
  | 'stroke:updated'
  | 'stroke:removed'
  | 'measurement:added'
  | 'measurement:updated'
  | 'measurement:removed'
  | 'tool:changed'
  | 'selection:changed';

export interface DrawingEvent {
  type: DrawingEventType;
  payload: {
    imageLabel?: string;
    strokeId?: string;
    stroke?: Stroke;
    point?: Point;
    tool?: DrawingTool;
    selectedIds?: string[];
  };
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT VALUES
// ═══════════════════════════════════════════════════════════════════════════

export const DEFAULT_UI_STATE: CanvasUIState = {
  currentTool: 'pencil',
  isDrawing: false,
  selectedStrokeIds: [],
  brushColor: '#000000',
  brushWidth: 2,
  brushOpacity: 1,
};

export const DEFAULT_VIEWPORT: ViewportState = {
  zoom: 1,
  panOffset: { x: 0, y: 0 },
  isPanning: false,
};
