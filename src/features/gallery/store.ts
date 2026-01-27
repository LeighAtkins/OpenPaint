/**
 * Gallery Zustand Store
 * Manages image gallery state (no legacy sync)
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { GalleryStore, GalleryState } from './types';
import type { ImageItem } from '../store/types';

// ═══════════════════════════════════════════════════════════════════════════
// INITIAL STATE
// ═══════════════════════════════════════════════════════════════════════════

const initialState: GalleryState = {
  images: new Map(),
  imageOrder: [],
  activeImageLabel: null,
  isLoading: false,
  error: null,
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normalize rotation to 0-360 range
 */
function normalizeRotation(degrees: number): number {
  const normalized = degrees % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

// ═══════════════════════════════════════════════════════════════════════════
// STORE CREATION
// ═══════════════════════════════════════════════════════════════════════════

export const useGalleryStore = create<GalleryStore>()(
  subscribeWithSelector((set, get) => ({
    // Initial state
    ...initialState,

    // ═══════════════════════════════════════════════════════════════════════
    // ACTIONS
    // ═══════════════════════════════════════════════════════════════════════

    addImage: (image: ImageItem) => {
      set(state => {
        const newImages = new Map(state.images);
        newImages.set(image.label, image);
        const newOrder = state.imageOrder.includes(image.label)
          ? state.imageOrder
          : [...state.imageOrder, image.label];

        return {
          images: newImages,
          imageOrder: newOrder,
          // Set as active if first image
          activeImageLabel: state.activeImageLabel || image.label,
        };
      });
    },

    removeImage: (label: string) => {
      set(state => {
        const newImages = new Map(state.images);
        newImages.delete(label);
        const newOrder = state.imageOrder.filter(l => l !== label);

        // Update active image if needed
        let newActive = state.activeImageLabel;
        if (state.activeImageLabel === label) {
          const currentIndex = state.imageOrder.indexOf(label);
          newActive = newOrder[Math.min(currentIndex, newOrder.length - 1)] || null;
        }

        return {
          images: newImages,
          imageOrder: newOrder,
          activeImageLabel: newActive,
        };
      });
    },

    setActiveImage: (label: string) => {
      const state = get();
      if (!state.images.has(label)) {
        console.warn(`[GalleryStore] Image with label "${label}" not found`);
        return;
      }

      set({ activeImageLabel: label });
    },

    reorderImages: (fromIndex: number, toIndex: number) => {
      set(state => {
        const newOrder = [...state.imageOrder];
        const moved = newOrder.splice(fromIndex, 1)[0];
        if (moved !== undefined) {
          newOrder.splice(toIndex, 0, moved);
        }
        return { imageOrder: newOrder };
      });
    },

    updateImage: (label: string, updates: Partial<ImageItem>) => {
      set(state => {
        const image = state.images.get(label);
        if (!image) return state;

        const newImages = new Map(state.images);
        newImages.set(label, {
          ...image,
          ...updates,
          updatedAt: Date.now(),
        });

        return { images: newImages };
      });
    },

    rotateImage: (label: string, degrees: number) => {
      const state = get();
      const image = state.images.get(label);
      if (!image) {
        console.warn(`[GalleryStore] Cannot rotate: image "${label}" not found`);
        return;
      }

      const newRotation = normalizeRotation(image.rotation + degrees);

      set(state => {
        const newImages = new Map(state.images);
        newImages.set(label, {
          ...image,
          rotation: newRotation,
          updatedAt: Date.now(),
        });
        return { images: newImages };
      });
    },

    clearGallery: () => {
      set({
        images: new Map(),
        imageOrder: [],
        activeImageLabel: null,
        error: null,
      });
    },

    setLoading: (loading: boolean) => set({ isLoading: loading }),
    setError: (error: string | null) => set({ error }),

    // ═══════════════════════════════════════════════════════════════════════
    // GETTERS
    // ═══════════════════════════════════════════════════════════════════════

    getImage: (label: string) => get().images.get(label),

    getCurrentImage: () => {
      const state = get();
      return state.activeImageLabel ? state.images.get(state.activeImageLabel) : undefined;
    },

    getOrderedImages: () => {
      const state = get();
      return state.imageOrder
        .map(label => state.images.get(label))
        .filter((img): img is ImageItem => img !== undefined);
    },
  }))
);

// ═══════════════════════════════════════════════════════════════════════════
// SELECTORS
// ═══════════════════════════════════════════════════════════════════════════

export const selectActiveImage = (state: GalleryStore) =>
  state.activeImageLabel ? state.images.get(state.activeImageLabel) : undefined;

export const selectImageCount = (state: GalleryStore) => state.images.size;

export const selectImageByLabel = (label: string) => (state: GalleryStore) =>
  state.images.get(label);

export const selectOrderedImages = (state: GalleryStore) =>
  state.imageOrder
    .map(label => state.images.get(label))
    .filter((img): img is ImageItem => img !== undefined);

export const selectNavigationState = (state: GalleryStore) => {
  const currentIndex = state.activeImageLabel
    ? state.imageOrder.indexOf(state.activeImageLabel)
    : -1;

  return {
    enabled: state.imageOrder.length > 1,
    currentIndex,
    totalCount: state.imageOrder.length,
    canGoPrevious: currentIndex > 0,
    canGoNext: currentIndex < state.imageOrder.length - 1,
  };
};
