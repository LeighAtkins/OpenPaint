/**
 * Gallery feature types
 */

import type { ImageItem } from '../store/types';

// ═══════════════════════════════════════════════════════════════════════════
// GALLERY STATE
// ═══════════════════════════════════════════════════════════════════════════

export interface GalleryState {
  /** All images in the gallery, keyed by label */
  images: Map<string, ImageItem>;
  /** Ordered array of image labels (display order) */
  imageOrder: string[];
  /** Currently active/displayed image label */
  activeImageLabel: string | null;
  /** Loading state */
  isLoading: boolean;
  /** Error message if any */
  error: string | null;
}

export interface GalleryActions {
  /** Add a new image to the gallery */
  addImage: (image: ImageItem) => void;
  /** Remove an image from the gallery */
  removeImage: (label: string) => void;
  /** Set the active image */
  setActiveImage: (label: string) => void;
  /** Reorder images */
  reorderImages: (fromIndex: number, toIndex: number) => void;
  /** Update image properties */
  updateImage: (label: string, updates: Partial<ImageItem>) => void;
  /** Apply rotation to an image */
  rotateImage: (label: string, degrees: number) => void;
  /** Clear all images */
  clearGallery: () => void;
  /** Set loading state */
  setLoading: (loading: boolean) => void;
  /** Set error */
  setError: (error: string | null) => void;
  /** Get image by label */
  getImage: (label: string) => ImageItem | undefined;
  /** Get current image */
  getCurrentImage: () => ImageItem | undefined;
  /** Get all images in order */
  getOrderedImages: () => ImageItem[];
}

export type GalleryStore = GalleryState & GalleryActions;

// ═══════════════════════════════════════════════════════════════════════════
// GALLERY EVENTS
// ═══════════════════════════════════════════════════════════════════════════

export type GalleryEventType =
  | 'gallery:image-added'
  | 'gallery:image-removed'
  | 'gallery:image-updated'
  | 'gallery:active-changed'
  | 'gallery:reordered'
  | 'gallery:cleared';

export interface GalleryEvent {
  type: GalleryEventType;
  payload: {
    label?: string;
    image?: ImageItem;
    fromIndex?: number;
    toIndex?: number;
  };
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// THUMBNAIL TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface ThumbnailConfig {
  /** Maximum width for thumbnails */
  maxWidth: number;
  /** Maximum height for thumbnails */
  maxHeight: number;
  /** JPEG quality (0-1) */
  quality: number;
  /** Whether to maintain aspect ratio */
  maintainAspectRatio: boolean;
}

export const DEFAULT_THUMBNAIL_CONFIG: ThumbnailConfig = {
  maxWidth: 120,
  maxHeight: 90,
  quality: 0.8,
  maintainAspectRatio: true,
};

// ═══════════════════════════════════════════════════════════════════════════
// NAVIGATION TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface NavigationState {
  /** Whether navigation is enabled */
  enabled: boolean;
  /** Current index in image order */
  currentIndex: number;
  /** Total count of images */
  totalCount: number;
  /** Can navigate to previous */
  canGoPrevious: boolean;
  /** Can navigate to next */
  canGoNext: boolean;
}

export interface NavigationActions {
  /** Navigate to previous image */
  goToPrevious: () => void;
  /** Navigate to next image */
  goToNext: () => void;
  /** Navigate to specific index */
  goToIndex: (index: number) => void;
}
