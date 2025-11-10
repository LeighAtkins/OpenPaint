/**
 * Canvas Viewport Controller
 * 
 * Centralizes all viewport transform math and eliminates coordinate drift.
 * Provides a single source of truth for:
 * - DPR-aware canvas sizing
 * - World <-> Client coordinate transforms
 * - Lock state for maintaining focus during resizes
 * - RAF-batched resize handling
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface ViewportTransform {
  scale: number;
  tx: number; // translate X in world units
  ty: number; // translate Y in world units
}

export interface LockState {
  kind: 'locked';
  frameCenter: { x: number; y: number }; // world coordinates
}

export interface UnlockState {
  kind: 'unlocked';
}

export type ViewportLockState = LockState | UnlockState;

export interface ViewportBounds {
  width: number;
  height: number;
  x: number;
  y: number;
}

export interface UseCanvasViewportProps {
  containerRef: React.RefObject<HTMLElement>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  frameBounds?: ViewportBounds; // The content bounds to fit
  padding?: number; // Padding around content when fitting
}

export interface UseCanvasViewportReturn {
  transform: ViewportTransform;
  dpr: number;
  lockState: ViewportLockState;
  
  // Transform methods
  clientToWorld: (clientX: number, clientY: number) => { x: number; y: number };
  worldToClient: (worldX: number, worldY: number) => { x: number; y: number };
  
  // Lock methods
  setLock: (state: ViewportLockState) => void;
  zoomToFrame: (bounds: ViewportBounds) => void;
  
  // Layout scheduling
  scheduleLayout: () => void;
}

/**
 * Calculate contain-fit scale for given content bounds within viewport
 */
function containScale(
  contentWidth: number,
  contentHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  padding: number = 0
): number {
  const availableWidth = Math.max(1, viewportWidth - 2 * padding);
  const availableHeight = Math.max(1, viewportHeight - 2 * padding);
  
  const scaleX = availableWidth / Math.max(1, contentWidth);
  const scaleY = availableHeight / Math.max(1, contentHeight);
  
  return Math.min(scaleX, scaleY);
}

/**
 * Calculate translation to center content in viewport
 */
function centreTxTy(
  contentBounds: ViewportBounds,
  viewportWidth: number,
  viewportHeight: number,
  scale: number
): { tx: number; ty: number } {
  const scaledWidth = contentBounds.width * scale;
  const scaledHeight = contentBounds.height * scale;
  
  const tx = (viewportWidth - scaledWidth) / 2 / scale - contentBounds.x;
  const ty = (viewportHeight - scaledHeight) / 2 / scale - contentBounds.y;
  
  return { tx, ty };
}

/**
 * Calculate translation to focus a specific point at viewport center
 */
function focusTxTy(
  focusPoint: { x: number; y: number },
  viewportWidth: number,
  viewportHeight: number,
  scale: number
): { tx: number; ty: number } {
  const tx = viewportWidth / 2 / scale - focusPoint.x;
  const ty = viewportHeight / 2 / scale - focusPoint.y;
  
  return { tx, ty };
}

/**
 * Transform world coordinates to screen coordinates
 */
function toScreen(
  worldX: number,
  worldY: number,
  transform: ViewportTransform
): { x: number; y: number } {
  return {
    x: (worldX + transform.tx) * transform.scale,
    y: (worldY + transform.ty) * transform.scale
  };
}

/**
 * Transform screen coordinates to world coordinates
 */
function toWorld(
  screenX: number,
  screenY: number,
  transform: ViewportTransform
): { x: number; y: number } {
  return {
    x: screenX / transform.scale - transform.tx,
    y: screenY / transform.scale - transform.ty
  };
}

export function useCanvasViewport({
  containerRef,
  canvasRef,
  frameBounds,
  padding = 20
}: UseCanvasViewportProps): UseCanvasViewportReturn {
  const [transform, setTransform] = useState<ViewportTransform>({
    scale: 1,
    tx: 0,
    ty: 0
  });
  
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1);
  const [lockState, setLockState] = useState<ViewportLockState>({ kind: 'unlocked' });
  
  // RAF batching
  const rafIdRef = useRef<number | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  
  /**
   * Core layout computation - called when container size or DPR changes
   */
  const computeLayout = useCallback(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    
    if (!container || !canvas) return;
    
    const containerRect = container.getBoundingClientRect();
    const viewportWidth = containerRect.width;
    const viewportHeight = containerRect.height;
    
    if (viewportWidth <= 0 || viewportHeight <= 0) return;
    
    // Update canvas bitmap size with DPR
    const currentDpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(viewportWidth * currentDpr);
    canvas.height = Math.round(viewportHeight * currentDpr);
    
    // Ensure CSS size matches container exactly
    canvas.style.width = `${viewportWidth}px`;
    canvas.style.height = `${viewportHeight}px`;
    canvas.style.position = 'absolute';
    canvas.style.left = '0';
    canvas.style.top = '0';
    
    setDpr(currentDpr);
    
    // Compute new transform
    let newTransform: ViewportTransform;
    
    if (lockState.kind === 'locked') {
      // Maintain locked focus at viewport center
      const { tx, ty } = focusTxTy(
        lockState.frameCenter,
        viewportWidth,
        viewportHeight,
        transform.scale
      );
      
      newTransform = {
        scale: transform.scale,
        tx,
        ty
      };
    } else if (frameBounds) {
      // Auto-fit content with contain scaling
      const scale = containScale(
        frameBounds.width,
        frameBounds.height,
        viewportWidth,
        viewportHeight,
        padding
      );
      
      const { tx, ty } = centreTxTy(
        frameBounds,
        viewportWidth,
        viewportHeight,
        scale
      );
      
      newTransform = { scale, tx, ty };
    } else {
      // No content bounds - center at origin
      newTransform = {
        scale: 1,
        tx: viewportWidth / 2,
        ty: viewportHeight / 2
      };
    }
    
    setTransform(newTransform);
    
    // Apply single transform to canvas context
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.setTransform(
        currentDpr * newTransform.scale, 0,
        0, currentDpr * newTransform.scale,
        currentDpr * newTransform.tx,
        currentDpr * newTransform.ty
      );
    }
  }, [containerRef, canvasRef, frameBounds, padding, lockState, transform.scale]);
  
  /**
   * RAF-batched layout scheduling
   */
  const scheduleLayout = useCallback(() => {
    if (rafIdRef.current !== null) return; // Already scheduled
    
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      computeLayout();
    });
  }, [computeLayout]);
  
  /**
   * Transform methods
   */
  const clientToWorld = useCallback((clientX: number, clientY: number) => {
    return toWorld(clientX, clientY, transform);
  }, [transform]);
  
  const worldToClient = useCallback((worldX: number, worldY: number) => {
    return toScreen(worldX, worldY, transform);
  }, [transform]);
  
  /**
   * Lock state management
   */
  const setLock = useCallback((state: ViewportLockState) => {
    setLockState(state);
    // Trigger relayout to apply lock behavior
    scheduleLayout();
  }, [scheduleLayout]);
  
  /**
   * Zoom to specific frame bounds
   */
  const zoomToFrame = useCallback((bounds: ViewportBounds) => {
    const container = containerRef.current;
    if (!container) return;
    
    const containerRect = container.getBoundingClientRect();
    const scale = containScale(
      bounds.width,
      bounds.height,
      containerRect.width,
      containerRect.height,
      padding
    );
    
    const { tx, ty } = centreTxTy(
      bounds,
      containerRect.width,
      containerRect.height,
      scale
    );
    
    setTransform({ scale, tx, ty });
    scheduleLayout();
  }, [containerRef, padding, scheduleLayout]);
  
  /**
   * Setup observers and listeners
   */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    
    // ResizeObserver for container size changes
    resizeObserverRef.current = new ResizeObserver(() => {
      scheduleLayout();
    });
    
    resizeObserverRef.current.observe(container);
    
    // Visual viewport listener for mobile
    const handleVisualViewportResize = () => {
      scheduleLayout();
    };
    
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleVisualViewportResize);
    }
    
    // DPR change detection
    const handleDprChange = () => {
      scheduleLayout();
    };
    
    const mediaQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mediaQuery.addEventListener('change', handleDprChange);
    
    // Initial layout
    scheduleLayout();
    
    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
      }
      
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleVisualViewportResize);
      }
      
      mediaQuery.removeEventListener('change', handleDprChange);
      
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [containerRef, scheduleLayout]);
  
  return {
    transform,
    dpr,
    lockState,
    clientToWorld,
    worldToClient,
    setLock,
    zoomToFrame,
    scheduleLayout
  };
}

// Export helper functions for testing
export {
  containScale,
  centreTxTy,
  focusTxTy,
  toScreen,
  toWorld
};
