/**
 * Canvas Viewport Controller
 *
 * Pure functions for viewport math and a controller class that
 * sizes a <canvas> to its container, applies DPR scaling, and
 * optionally fits content bounds with padding.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Transform {
  scale: number;
  tx: number;
  ty: number;
}

export interface ContentBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface LockState {
  kind: 'unlocked' | 'locked';
  frameCenter?: Point;
}

export interface ViewportOptions {
  frameBounds?: ContentBounds;
  padding?: number;
}

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/**
 * Compute the largest uniform scale that fits content (with padding)
 * inside a viewport, without exceeding the viewport in either axis.
 */
export function containScale(
  contentW: number,
  contentH: number,
  viewportW: number,
  viewportH: number,
  padding: number
): number {
  return Math.min((viewportW - 2 * padding) / contentW, (viewportH - 2 * padding) / contentH);
}

/**
 * Compute translate values that centre content bounds in a viewport
 * at the given scale.
 */
export function centreTxTy(
  contentBounds: ContentBounds,
  viewportW: number,
  viewportH: number,
  scale: number
): Pick<Transform, 'tx' | 'ty'> {
  const tx = (viewportW - contentBounds.width * scale) / (2 * scale) - contentBounds.x;
  const ty = (viewportH - contentBounds.height * scale) / (2 * scale) - contentBounds.y;
  return { tx, ty };
}

/**
 * Convert a world-space point to screen-space.
 */
export function toScreen(worldX: number, worldY: number, transform: Transform): Point {
  return {
    x: (worldX + transform.tx) * transform.scale,
    y: (worldY + transform.ty) * transform.scale,
  };
}

/**
 * Convert a screen-space point to world-space.
 */
export function toWorld(screenX: number, screenY: number, transform: Transform): Point {
  return {
    x: screenX / transform.scale - transform.tx,
    y: screenY / transform.scale - transform.ty,
  };
}

// ---------------------------------------------------------------------------
// Controller class
// ---------------------------------------------------------------------------

export class CanvasViewportController {
  transform: Transform;
  dpr: number;
  lockState: LockState;
  resizeObserver: ResizeObserver;
  rafId: number | null;

  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private options: ViewportOptions;

  constructor(container: HTMLElement, canvas: HTMLCanvasElement, options?: ViewportOptions) {
    this.container = container;
    this.canvas = canvas;
    this.options = options ?? {};

    this.transform = { scale: 1, tx: 0, ty: 0 };
    this.dpr = (typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1) || 1;
    this.lockState = { kind: 'unlocked' };
    this.rafId = null;

    this.resizeObserver = new ResizeObserver(() => {
      this.scheduleLayout();
    });
    this.resizeObserver.observe(this.container);

    this.scheduleLayout();
  }

  /** Schedule a layout pass on the next animation frame (batched). */
  scheduleLayout(): void {
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.performLayout();
    });
  }

  /** Convert client/screen coordinates to world coordinates. */
  clientToWorld(x: number, y: number): Point {
    return toWorld(x, y, this.transform);
  }

  /** Convert world coordinates to client/screen coordinates. */
  worldToClient(x: number, y: number): Point {
    return toScreen(x, y, this.transform);
  }

  /** Update the lock state (e.g. lock viewport to a frame centre). */
  setLock(state: LockState): void {
    this.lockState = state;
    this.scheduleLayout();
  }

  /** Tear down: cancel pending RAF and disconnect ResizeObserver. */
  destroy(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.resizeObserver.disconnect();
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private performLayout(): void {
    const rect = this.container.getBoundingClientRect();
    const cssW = rect.width;
    const cssH = rect.height;

    // Set canvas bitmap size (DPR-scaled) and CSS size
    this.canvas.width = cssW * this.dpr;
    this.canvas.height = cssH * this.dpr;
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;

    // Fit content bounds if provided
    const fb = this.options.frameBounds;
    const padding = this.options.padding ?? 20;
    if (fb) {
      this.transform.scale = containScale(fb.width, fb.height, cssW, cssH, padding);
      const { tx, ty } = centreTxTy(fb, cssW, cssH, this.transform.scale);
      this.transform.tx = tx;
      this.transform.ty = ty;
    }

    // Apply combined DPR + viewport transform to the 2D context
    const ctx = this.canvas.getContext('2d');
    if (ctx) {
      const s = this.dpr * this.transform.scale;
      ctx.setTransform(
        s,
        0,
        0,
        s,
        this.transform.tx * this.dpr * this.transform.scale,
        this.transform.ty * this.dpr * this.transform.scale
      );
    }

    // Dispatch event on the container
    this.container.dispatchEvent(
      new CustomEvent('viewportChanged', {
        detail: {
          transform: { ...this.transform },
          dpr: this.dpr,
          viewportWidth: cssW,
          viewportHeight: cssH,
        },
      })
    );
  }
}
