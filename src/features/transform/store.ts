/**
 * Transform Store (canvas-aware)
 * Manages rotation state per image (degrees) without legacy sync
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { TransformState, TransformStore } from './types';
import type { Point, Dimensions, RotationState } from '../store/types';
import { normalizeAngle, radiansToDegrees } from './types';

/**
 * Initial state
 */
const initialState: TransformState = {
  rotationByImage: new Map(),
  transformHistory: [],
  maxHistorySize: 50,
  isTransforming: false,
};

/**
 * Transform store (canvas-aware)
 */
export const useTransformStore = create<TransformStore>()(
  subscribeWithSelector((set, get) => ({
    ...initialState,

    // Rotation operations
    rotateImage: (imageLabel: string, degrees: number, canvasDimensions: Dimensions) => {
      const state = get();
      const existing = state.rotationByImage.get(imageLabel);
      const radians = (degrees * Math.PI) / 180;

      const newRotationState: RotationState = existing
        ? {
            ...existing,
            radiansTotal: existing.radiansTotal + radians,
            lastDelta: radians,
          }
        : {
            radiansTotal: radians,
            center: {
              x: canvasDimensions.width / 2,
              y: canvasDimensions.height / 2,
            },
            lastDelta: radians,
          };

      const newRotationByImage = new Map(state.rotationByImage);
      newRotationByImage.set(imageLabel, newRotationState);

      set({ rotationByImage: newRotationByImage });
    },

    setRotationCenter: (imageLabel: string, center: Point) =>
      set(state => {
        const newRotationByImage = new Map(state.rotationByImage);
        const existing = newRotationByImage.get(imageLabel) || {
          radiansTotal: 0,
          center,
          lastDelta: 0,
        };
        newRotationByImage.set(imageLabel, {
          ...existing,
          center,
          lastDelta: existing.lastDelta,
        });
        return { rotationByImage: newRotationByImage };
      }),

    getRotation: (imageLabel: string) => {
      const rotation = get().rotationByImage.get(imageLabel);
      return rotation;
    },

    getRotationDegrees: (imageLabel: string) => {
      const rotation = get().rotationByImage.get(imageLabel);
      if (!rotation) return 0;
      return normalizeAngle(radiansToDegrees(rotation.radiansTotal));
    },

    // Flip operations
    flipImageHorizontal: (_imageLabel: string, _canvasDimensions: Dimensions) => {
      console.warn('flipImageHorizontal not yet implemented');
    },

    flipImageVertical: (_imageLabel: string, _canvasDimensions: Dimensions) => {
      console.warn('flipImageVertical not yet implemented');
    },

    // History operations
    recordTransform: meta =>
      set(state => {
        const newHistory = [...state.transformHistory, meta];
        while (newHistory.length > state.maxHistorySize) {
          newHistory.shift();
        }
        return { transformHistory: newHistory };
      }),

    getTransformHistory: (imageLabel?: string) => {
      const history = get().transformHistory;
      return imageLabel ? history.filter(h => h.imageLabel === imageLabel) : history;
    },

    clearHistory: (imageLabel?: string) =>
      set(state => {
        if (imageLabel) {
          return {
            transformHistory: state.transformHistory.filter(h => h.imageLabel !== imageLabel),
          };
        }
        return { transformHistory: [] };
      }),

    // Transform state
    setIsTransforming: (isTransforming: boolean) => set({ isTransforming }),

    // Coordinate transforms
    rotatePoint: (point: Point, degrees: number, center: Point): Point => {
      const radians = (degrees * Math.PI) / 180;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);

      const dx = point.x - center.x;
      const dy = point.y - center.y;

      return {
        x: center.x + dx * cos - dy * sin,
        y: center.y + dx * sin + dy * cos,
      };
    },

    flipPointHorizontal: (point: Point, width: number): Point => {
      return {
        x: width - point.x,
        y: point.y,
      };
    },

    flipPointVertical: (point: Point, height: number): Point => {
      return {
        x: point.x,
        y: height - point.y,
      };
    },

    // Canvas dimensions getter
    getCanvasDimensions: (_imageLabel: string): Dimensions => {
      const canvas = document.getElementById('canvas') as HTMLCanvasElement;
      if (!canvas) {
        console.warn('[TransformStore] Canvas not found, using fallback dimensions');
        return { width: 800, height: 600 };
      }
      return {
        width: canvas.width,
        height: canvas.height,
      };
    },
  }))
);
