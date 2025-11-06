/**
 * Canvas Viewport Controller
 *
 * Centralizes all viewport transform math and eliminates coordinate drift.
 * Provides a single source of truth for:
 * - DPR-aware canvas sizing
 * - World <-> Client coordinate transforms
 * - Lock state for maintaining focus during resizes
 * - RAF-batched resize handling
 *
 * NOTE: This file is legacy/unused code. The project uses vanilla JavaScript.
 * React types removed to fix Vercel build errors.
 */

// import { useCallback, useEffect, useRef, useState } from 'react';

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
  containerRef: { current: HTMLElement | null };
  canvasRef: { current: HTMLCanvasElement | null };
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

/**
 * LEGACY/UNUSED: This function is not implemented as it uses React hooks.
 * The project uses vanilla JavaScript only.
 *
 * Original implementation removed to fix TypeScript build errors.
 * Helper functions (containScale, centreTxTy, etc.) are still exported below.
 */
export function useCanvasViewport({
  containerRef,
  canvasRef,
  frameBounds,
  padding = 20
}: UseCanvasViewportProps): UseCanvasViewportReturn {
  throw new Error('useCanvasViewport is legacy code and should not be called. This project uses vanilla JavaScript, not React.');
}

// Export helper functions for testing
export {
  containScale,
  centreTxTy,
  focusTxTy,
  toScreen,
  toWorld
};
