/**
 * Canvas Store
 * Handles viewport state (zoom, pan) and canvas dimensions (no legacy sync)
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { DrawingTool, Point, Dimensions, ViewportState } from '../store/types';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_VIEWPORT: ViewportState = {
  zoom: 1,
  panOffset: { x: 0, y: 0 },
  isPanning: false,
};

const DEFAULT_DIMENSIONS: Dimensions = {
  width: 800,
  height: 600,
};

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;
const ZOOM_STEP = 0.1;

// ═══════════════════════════════════════════════════════════════════════════
// STATE TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface CanvasState {
  // Canvas dimensions
  dimensions: Dimensions;
  // Viewport state per image
  viewportByImage: Map<string, ViewportState>;
  // Canvas ready state
  isReady: boolean;
  canvasId: string;
  // UI state
  currentTool: DrawingTool;
  isDrawing: boolean;
  brushSettings: {
    color: string;
    width: number;
    opacity: number;
  };
}

export interface CanvasActions {
  // Dimension operations
  setDimensions: (dimensions: Dimensions) => void;
  getDimensions: () => Dimensions;

  // Viewport operations
  setViewport: (imageLabel: string, viewport: Partial<ViewportState>) => void;
  getViewport: (imageLabel: string) => ViewportState;
  resetViewport: (imageLabel: string) => void;

  // Zoom operations
  zoomIn: (imageLabel: string, factor?: number) => void;
  zoomOut: (imageLabel: string, factor?: number) => void;
  setZoom: (imageLabel: string, zoom: number) => void;
  getZoom: (imageLabel: string) => number;

  // Pan operations
  setPan: (imageLabel: string, offset: Point) => void;
  getPan: (imageLabel: string) => Point;
  resetPan: (imageLabel: string) => void;

  // Canvas state
  setReady: (ready: boolean) => void;
  setCanvasId: (id: string) => void;

  // UI state
  setCurrentTool: (tool: DrawingTool) => void;
  setIsDrawing: (isDrawing: boolean) => void;
  setBrushSettings: (settings: Partial<CanvasState['brushSettings']>) => void;

  // Coordinate transforms
  canvasToImage: (point: Point, imageLabel: string) => Point;
  imageToCanvas: (point: Point, imageLabel: string) => Point;
}

export type CanvasStore = CanvasState & CanvasActions;

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

// ═══════════════════════════════════════════════════════════════════════════
// STORE CREATION
// ═══════════════════════════════════════════════════════════════════════════

export const useCanvasStore = create<CanvasStore>()(
  subscribeWithSelector((set, get) => ({
    // Initial state
    dimensions: DEFAULT_DIMENSIONS,
    viewportByImage: new Map(),
    isReady: false,
    canvasId: 'canvas',
    currentTool: 'pencil',
    isDrawing: false,
    brushSettings: {
      color: '#000000',
      width: 2,
      opacity: 1,
    },

    // Dimension operations
    setDimensions: (dimensions): void => {
      set({ dimensions });
    },
    getDimensions: (): Dimensions => get().dimensions,

    // Viewport operations
    setViewport: (imageLabel: string, viewport: Partial<ViewportState>): void => {
      set(state => {
        const newViewportByImage = new Map(state.viewportByImage);
        const current = newViewportByImage.get(imageLabel) ?? DEFAULT_VIEWPORT;
        newViewportByImage.set(imageLabel, { ...current, ...viewport });
        return { viewportByImage: newViewportByImage };
      });
    },

    getViewport: (imageLabel: string): ViewportState => {
      return get().viewportByImage.get(imageLabel) ?? DEFAULT_VIEWPORT;
    },

    resetViewport: (imageLabel: string): void => {
      set(state => {
        const newViewportByImage = new Map(state.viewportByImage);
        newViewportByImage.set(imageLabel, DEFAULT_VIEWPORT);
        return { viewportByImage: newViewportByImage };
      });
    },

    // Zoom operations
    zoomIn: (imageLabel: string, factor = ZOOM_STEP): void => {
      const state = get();
      const current = state.viewportByImage.get(imageLabel) ?? DEFAULT_VIEWPORT;
      const newZoom = clampZoom(current.zoom + factor);

      set(state => {
        const newViewportByImage = new Map(state.viewportByImage);
        newViewportByImage.set(imageLabel, { ...current, zoom: newZoom });
        return { viewportByImage: newViewportByImage };
      });
    },

    zoomOut: (imageLabel: string, factor = ZOOM_STEP): void => {
      const state = get();
      const current = state.viewportByImage.get(imageLabel) ?? DEFAULT_VIEWPORT;
      const newZoom = clampZoom(current.zoom - factor);

      set(state => {
        const newViewportByImage = new Map(state.viewportByImage);
        newViewportByImage.set(imageLabel, { ...current, zoom: newZoom });
        return { viewportByImage: newViewportByImage };
      });
    },

    setZoom: (imageLabel: string, zoom: number): void => {
      set(state => {
        const newViewportByImage = new Map(state.viewportByImage);
        const current = newViewportByImage.get(imageLabel) ?? DEFAULT_VIEWPORT;
        newViewportByImage.set(imageLabel, { ...current, zoom: clampZoom(zoom) });
        return { viewportByImage: newViewportByImage };
      });
    },

    getZoom: (imageLabel: string): number => {
      const viewport = get().viewportByImage.get(imageLabel);
      return viewport?.zoom ?? 1;
    },

    // Pan operations
    setPan: (imageLabel: string, offset: Point): void => {
      set(state => {
        const newViewportByImage = new Map(state.viewportByImage);
        const current = newViewportByImage.get(imageLabel) ?? DEFAULT_VIEWPORT;
        newViewportByImage.set(imageLabel, { ...current, panOffset: offset });
        return { viewportByImage: newViewportByImage };
      });
    },

    getPan: (imageLabel: string): Point => {
      const viewport = get().viewportByImage.get(imageLabel);
      return viewport?.panOffset ?? { x: 0, y: 0 };
    },

    resetPan: (imageLabel: string): void => {
      set(state => {
        const newViewportByImage = new Map(state.viewportByImage);
        const current = newViewportByImage.get(imageLabel) ?? DEFAULT_VIEWPORT;
        newViewportByImage.set(imageLabel, { ...current, panOffset: { x: 0, y: 0 } });
        return { viewportByImage: newViewportByImage };
      });
    },

    // Canvas state
    setReady: (ready: boolean): void => {
      set({ isReady: ready });
    },
    setCanvasId: (id: string): void => {
      set({ canvasId: id });
    },

    // UI state
    setCurrentTool: (tool: DrawingTool): void => {
      const state = get();
      if (state.currentTool !== tool) {
        set({ currentTool: tool });
      }
    },

    setIsDrawing: (isDrawing: boolean): void => {
      set({ isDrawing });
    },

    setBrushSettings: (settings: Partial<CanvasState['brushSettings']>): void => {
      set(state => ({
        brushSettings: { ...state.brushSettings, ...settings },
      }));
    },

    // Coordinate transforms
    canvasToImage: (point: Point, imageLabel: string): Point => {
      const state = get();
      const viewport = state.viewportByImage.get(imageLabel) ?? DEFAULT_VIEWPORT;
      const { zoom, panOffset } = viewport;

      return {
        x: (point.x - panOffset.x) / zoom,
        y: (point.y - panOffset.y) / zoom,
      };
    },

    imageToCanvas: (point: Point, imageLabel: string): Point => {
      const state = get();
      const viewport = state.viewportByImage.get(imageLabel) ?? DEFAULT_VIEWPORT;
      const { zoom, panOffset } = viewport;

      return {
        x: point.x * zoom + panOffset.x,
        y: point.y * zoom + panOffset.y,
      };
    },
  }))
);

// ═══════════════════════════════════════════════════════════════════════════
// SELECTORS
// ═══════════════════════════════════════════════════════════════════════════

export const selectDimensions = (state: CanvasStore) => state.dimensions;

export const selectViewportForImage = (imageLabel: string) => (state: CanvasStore) =>
  state.getViewport(imageLabel);

export const selectZoomForImage = (imageLabel: string) => (state: CanvasStore) =>
  state.getZoom(imageLabel);

export const selectPanForImage = (imageLabel: string) => (state: CanvasStore) =>
  state.getPan(imageLabel);

export const selectIsReady = (state: CanvasStore) => state.isReady;

export const selectCurrentTool = (state: CanvasStore) => state.currentTool;

export const selectIsDrawing = (state: CanvasStore) => state.isDrawing;

export const selectBrushSettings = (state: CanvasStore) => state.brushSettings;

// Legacy compatibility alias
export const useCanvasUIStore = useCanvasStore;
