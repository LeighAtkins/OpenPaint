/**
 * Canvas feature constants
 * Default values for viewport and canvas dimensions
 */

import type { Dimensions, ViewportState } from '../store/types';

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT VALUES
// ═══════════════════════════════════════════════════════════════════════════

export const DEFAULT_VIEWPORT: ViewportState = {
  zoom: 1,
  panOffset: { x: 0, y: 0 },
  isPanning: false,
};

export const DEFAULT_DIMENSIONS: Dimensions = {
  width: 800,
  height: 600,
};

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 10;
export const ZOOM_STEP = 0.1;
