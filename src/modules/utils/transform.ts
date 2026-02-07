/**
 * Transform T - Single Source of Truth for coordinate transformations
 * Handles scale, pan, and device pixel ratio for stable coordinate mapping
 */

export interface TransformState {
  scale: number;
  panX: number;
  panY: number;
  dpr: number;
}

interface TransformSessionState {
  phase: 'Stable' | 'Mutating' | 'Desynced';
  stableTicks: number;
  lastHash: string;
  fit: { mode: string; basisDim: string; naturalW: number; naturalH: number } | null;
  T: TransformState;
}

interface TransformWindow extends Window {
  labelReprojectDebug?: () => boolean;
  redrawCanvasWithVisibility?: () => void;
}

const win = window as TransformWindow;

// Transform T state
const T: TransformState = {
  scale: 1.0, // CSS pixels per image pixel
  panX: 0, // CSS pixels
  panY: 0, // CSS pixels
  dpr: 1, // devicePixelRatio
};

// Session state for persistence guard
const session: TransformSessionState = {
  phase: 'Stable', // 'Stable' | 'Mutating' | 'Desynced'
  stableTicks: 0,
  lastHash: '',
  fit: null, // {mode, basisDim, naturalW, naturalH}
  T: { ...T }, // Last committed T
};

// Transform hash for stability detection
function getTransformHash(): string {
  const obj = {
    scale: +T.scale.toFixed(6),
    panX: +T.panX.toFixed(1),
    panY: +T.panY.toFixed(1),
    dpr: +T.dpr.toFixed(3),
  };
  return JSON.stringify(obj);
}

// Update session stability
function updateStability(): void {
  const currentHash = getTransformHash();
  if (currentHash === session.lastHash) {
    session.stableTicks++;
    if (session.stableTicks >= 2 && session.phase !== 'Stable') {
      session.phase = 'Stable';
      session.T = { ...T };
      if (win.labelReprojectDebug?.()) {
        console.log('[TRANSFORM] Session became Stable');
      }
    }
  } else {
    session.stableTicks = 0;
    session.phase = 'Mutating';
    session.lastHash = currentHash;
  }
}

// Get current transform (read-only)
export function getCurrentTransform(): TransformState {
  return { ...T };
}

// Set transform with validation
export function setTransform(newT: Partial<TransformState>): TransformState {
  const oldT = { ...T };

  // Update values with validation
  if (typeof newT.scale === 'number' && newT.scale > 0) {
    T.scale = Math.max(0.01, Math.min(100, newT.scale)); // Clamp to reasonable range
  }
  if (typeof newT.panX === 'number') {
    T.panX = newT.panX;
  }
  if (typeof newT.panY === 'number') {
    T.panY = newT.panY;
  }
  if (typeof newT.dpr === 'number' && newT.dpr > 0) {
    T.dpr = newT.dpr;
  }

  // Update stability
  updateStability();

  // Trigger redraw if transform changed
  if (JSON.stringify(oldT) !== JSON.stringify(T)) {
    win.redrawCanvasWithVisibility?.();
  }

  return { ...T };
}

// Get session state
export function getTransformSession(): {
  phase: TransformSessionState['phase'];
  stableTicks: number;
  canPersist: boolean;
  T: TransformState;
} {
  return {
    phase: session.phase,
    stableTicks: session.stableTicks,
    canPersist: session.phase === 'Stable',
    T: { ...session.T },
  };
}

// Initialize DPR
T.dpr = typeof window.devicePixelRatio === 'number' ? window.devicePixelRatio : 1;
