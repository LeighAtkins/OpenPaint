/**
 * Drawing Zustand Store
 * Manages strokes, measurements, and canvas UI state (no legacy sync)
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { DrawingStore, DrawingState } from './types';
import type {
  Stroke,
  Point,
  Measurement,
  LabelPosition,
  RelativeLabelPosition,
  ViewportState,
  DrawingTool,
} from '../store/types';

// ═══════════════════════════════════════════════════════════════════════════
// INITIAL STATE
// ═══════════════════════════════════════════════════════════════════════════

const initialUIState = {
  currentTool: 'pencil' as DrawingTool,
  isDrawing: false,
  selectedStrokeIds: [] as string[],
  brushColor: '#000000',
  brushWidth: 2,
  brushOpacity: 1,
};

const initialViewport: ViewportState = {
  zoom: 1,
  panOffset: { x: 0, y: 0 },
  isPanning: false,
};

const initialState: DrawingState = {
  strokesByImage: new Map(),
  strokeOrderByImage: new Map(),
  labelPositionsByImage: new Map(),
  relativeLabelPositionsByImage: new Map(),
  measurementsByImage: new Map(),
  uiState: initialUIState,
  viewportByImage: new Map(),
  isDirty: false,
};

// ═══════════════════════════════════════════════════════════════════════════
// STORE CREATION
// ═══════════════════════════════════════════════════════════════════════════

export const useDrawingStore = create<DrawingStore>()(
  subscribeWithSelector((set, get) => ({
    ...initialState,

    // ═══════════════════════════════════════════════════════════════════════
    // STROKE OPERATIONS
    // ═══════════════════════════════════════════════════════════════════════

    addStroke: (imageLabel: string, stroke: Stroke) => {
      set(state => {
        const newStrokesByImage = new Map(state.strokesByImage);
        const imageStrokes = new Map(newStrokesByImage.get(imageLabel) || new Map());
        imageStrokes.set(stroke.id, stroke);
        newStrokesByImage.set(imageLabel, imageStrokes);

        const newStrokeOrder = new Map(state.strokeOrderByImage);
        const order = [...(newStrokeOrder.get(imageLabel) || [])];
        if (!order.includes(stroke.id)) {
          order.push(stroke.id);
        }
        newStrokeOrder.set(imageLabel, order);

        return {
          strokesByImage: newStrokesByImage,
          strokeOrderByImage: newStrokeOrder,
          isDirty: true,
        };
      });
    },

    updateStroke: (imageLabel: string, strokeId: string, updates: Partial<Stroke>) => {
      set(state => {
        const imageStrokes = state.strokesByImage.get(imageLabel);
        if (!imageStrokes) return state;

        const stroke = imageStrokes.get(strokeId);
        if (!stroke) return state;

        const newStrokesByImage = new Map(state.strokesByImage);
        const newImageStrokes = new Map(imageStrokes);
        newImageStrokes.set(strokeId, { ...stroke, ...updates });
        newStrokesByImage.set(imageLabel, newImageStrokes);

        return {
          strokesByImage: newStrokesByImage,
          isDirty: true,
        };
      });
    },

    removeStroke: (imageLabel: string, strokeId: string) => {
      set(state => {
        const newStrokesByImage = new Map(state.strokesByImage);
        const imageStrokes = newStrokesByImage.get(imageLabel);
        if (imageStrokes) {
          const newImageStrokes = new Map(imageStrokes);
          newImageStrokes.delete(strokeId);
          newStrokesByImage.set(imageLabel, newImageStrokes);
        }

        const newStrokeOrder = new Map(state.strokeOrderByImage);
        const order = newStrokeOrder.get(imageLabel);
        if (order) {
          newStrokeOrder.set(
            imageLabel,
            order.filter(id => id !== strokeId)
          );
        }

        // Also remove associated label positions and measurements
        const newLabelPositions = new Map(state.labelPositionsByImage);
        const imageLabelPositions = newLabelPositions.get(imageLabel);
        if (imageLabelPositions) {
          const newImageLabelPositions = new Map(imageLabelPositions);
          newImageLabelPositions.delete(strokeId);
          newLabelPositions.set(imageLabel, newImageLabelPositions);
        }

        return {
          strokesByImage: newStrokesByImage,
          strokeOrderByImage: newStrokeOrder,
          labelPositionsByImage: newLabelPositions,
          isDirty: true,
        };
      });
    },

    getStroke: (imageLabel: string, strokeId: string) => {
      const imageStrokes = get().strokesByImage.get(imageLabel);
      return imageStrokes?.get(strokeId);
    },

    getStrokesForImage: (imageLabel: string) => {
      const state = get();
      const imageStrokes = state.strokesByImage.get(imageLabel);
      const order = state.strokeOrderByImage.get(imageLabel) || [];

      if (!imageStrokes) return [];

      return order.map(id => imageStrokes.get(id)).filter((s): s is Stroke => s !== undefined);
    },

    // ═══════════════════════════════════════════════════════════════════════
    // LABEL POSITION OPERATIONS
    // ═══════════════════════════════════════════════════════════════════════

    setLabelPosition: (imageLabel: string, strokeId: string, position: LabelPosition) => {
      set(state => {
        const newLabelPositions = new Map(state.labelPositionsByImage);
        const imagePositions = new Map(newLabelPositions.get(imageLabel) || new Map());
        imagePositions.set(strokeId, position);
        newLabelPositions.set(imageLabel, imagePositions);

        return {
          labelPositionsByImage: newLabelPositions,
          isDirty: true,
        };
      });
    },

    setRelativeLabelPosition: (
      imageLabel: string,
      strokeId: string,
      position: RelativeLabelPosition
    ) => {
      set(state => {
        const newRelativePositions = new Map(state.relativeLabelPositionsByImage);
        const imagePositions = new Map(newRelativePositions.get(imageLabel) || new Map());
        imagePositions.set(strokeId, position);
        newRelativePositions.set(imageLabel, imagePositions);

        return {
          relativeLabelPositionsByImage: newRelativePositions,
          isDirty: true,
        };
      });
    },

    getLabelPosition: (imageLabel: string, strokeId: string) => {
      return get().labelPositionsByImage.get(imageLabel)?.get(strokeId);
    },

    getRelativeLabelPosition: (imageLabel: string, strokeId: string) => {
      return get().relativeLabelPositionsByImage.get(imageLabel)?.get(strokeId);
    },

    // ═══════════════════════════════════════════════════════════════════════
    // MEASUREMENT OPERATIONS
    // ═══════════════════════════════════════════════════════════════════════

    addMeasurement: (imageLabel: string, measurement: Measurement) => {
      set(state => {
        const newMeasurements = new Map(state.measurementsByImage);
        const imageMeasurements = new Map(newMeasurements.get(imageLabel) || new Map());
        imageMeasurements.set(measurement.id, measurement);
        newMeasurements.set(imageLabel, imageMeasurements);

        return {
          measurementsByImage: newMeasurements,
          isDirty: true,
        };
      });
    },

    updateMeasurement: (
      imageLabel: string,
      measurementId: string,
      updates: Partial<Measurement>
    ) => {
      set(state => {
        const imageMeasurements = state.measurementsByImage.get(imageLabel);
        if (!imageMeasurements) return state;

        const measurement = imageMeasurements.get(measurementId);
        if (!measurement) return state;

        const newMeasurements = new Map(state.measurementsByImage);
        const newImageMeasurements = new Map(imageMeasurements);
        newImageMeasurements.set(measurementId, { ...measurement, ...updates });
        newMeasurements.set(imageLabel, newImageMeasurements);

        return {
          measurementsByImage: newMeasurements,
          isDirty: true,
        };
      });
    },

    removeMeasurement: (imageLabel: string, measurementId: string) => {
      set(state => {
        const newMeasurements = new Map(state.measurementsByImage);
        const imageMeasurements = newMeasurements.get(imageLabel);
        if (imageMeasurements) {
          const newImageMeasurements = new Map(imageMeasurements);
          newImageMeasurements.delete(measurementId);
          newMeasurements.set(imageLabel, newImageMeasurements);
        }

        return {
          measurementsByImage: newMeasurements,
          isDirty: true,
        };
      });
    },

    // ═══════════════════════════════════════════════════════════════════════
    // UI STATE OPERATIONS
    // ═══════════════════════════════════════════════════════════════════════

    setCurrentTool: (tool: DrawingTool) => {
      set(state => ({
        uiState: { ...state.uiState, currentTool: tool },
      }));
    },

    setIsDrawing: (isDrawing: boolean) => {
      set(state => ({
        uiState: { ...state.uiState, isDrawing },
      }));
    },

    setSelectedStrokes: (strokeIds: string[]) => {
      set(state => ({
        uiState: { ...state.uiState, selectedStrokeIds: strokeIds },
      }));
    },

    setBrushSettings: (color?: string, width?: number, opacity?: number) => {
      set(state => ({
        uiState: {
          ...state.uiState,
          ...(color !== undefined && { brushColor: color }),
          ...(width !== undefined && { brushWidth: width }),
          ...(opacity !== undefined && { brushOpacity: opacity }),
        },
      }));
    },

    // ═══════════════════════════════════════════════════════════════════════
    // VIEWPORT OPERATIONS
    // ═══════════════════════════════════════════════════════════════════════

    setViewport: (imageLabel: string, viewport: Partial<ViewportState>) => {
      set(state => {
        const newViewportByImage = new Map(state.viewportByImage);
        const current = newViewportByImage.get(imageLabel) || initialViewport;
        newViewportByImage.set(imageLabel, { ...current, ...viewport });

        return { viewportByImage: newViewportByImage };
      });
    },

    getViewport: (imageLabel: string) => {
      return get().viewportByImage.get(imageLabel) || initialViewport;
    },

    // ═══════════════════════════════════════════════════════════════════════
    // DIRTY STATE
    // ═══════════════════════════════════════════════════════════════════════

    setDirty: (dirty: boolean) => set({ isDirty: dirty }),

    // ═══════════════════════════════════════════════════════════════════════
    // BATCH OPERATIONS
    // ═══════════════════════════════════════════════════════════════════════

    clearImageData: (imageLabel: string) => {
      set(state => {
        const newStrokesByImage = new Map(state.strokesByImage);
        newStrokesByImage.delete(imageLabel);

        const newStrokeOrder = new Map(state.strokeOrderByImage);
        newStrokeOrder.delete(imageLabel);

        const newLabelPositions = new Map(state.labelPositionsByImage);
        newLabelPositions.delete(imageLabel);

        const newRelativePositions = new Map(state.relativeLabelPositionsByImage);
        newRelativePositions.delete(imageLabel);

        const newMeasurements = new Map(state.measurementsByImage);
        newMeasurements.delete(imageLabel);

        const newViewport = new Map(state.viewportByImage);
        newViewport.delete(imageLabel);

        return {
          strokesByImage: newStrokesByImage,
          strokeOrderByImage: newStrokeOrder,
          labelPositionsByImage: newLabelPositions,
          relativeLabelPositionsByImage: newRelativePositions,
          measurementsByImage: newMeasurements,
          viewportByImage: newViewport,
          isDirty: true,
        };
      });
    },

    clearAllData: () => {
      set({
        ...initialState,
        isDirty: true,
      });
    },

    // ═══════════════════════════════════════════════════════════════════════
    // TRANSFORM OPERATIONS
    // ═══════════════════════════════════════════════════════════════════════

    transformStrokes: (imageLabel: string, transformFn: (point: Point) => Point) => {
      set(state => {
        const imageStrokes = state.strokesByImage.get(imageLabel);
        if (!imageStrokes) return state;

        const newStrokesByImage = new Map(state.strokesByImage);
        const newImageStrokes = new Map<string, Stroke>();

        imageStrokes.forEach((stroke, strokeId) => {
          const transformedPoints = stroke.points.map(transformFn);
          newImageStrokes.set(strokeId, {
            ...stroke,
            points: transformedPoints,
          });
        });

        newStrokesByImage.set(imageLabel, newImageStrokes);

        return {
          strokesByImage: newStrokesByImage,
          isDirty: true,
        };
      });
    },
  }))
);

// ═══════════════════════════════════════════════════════════════════════════
// SELECTORS
// ═══════════════════════════════════════════════════════════════════════════

export const selectStrokesForImage = (imageLabel: string) => (state: DrawingStore) =>
  state.getStrokesForImage(imageLabel);

export const selectSelectedStrokes = (state: DrawingStore) => state.uiState.selectedStrokeIds;

export const selectIsDirty = (state: DrawingStore) => state.isDirty;
