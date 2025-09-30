/**
 * Canvas Viewport Controller (Vanilla JS)
 * 
 * Centralizes all viewport transform math and eliminates coordinate drift.
 * Provides a single source of truth for:
 * - DPR-aware canvas sizing
 * - World <-> Client coordinate transforms
 * - Lock state for maintaining focus during resizes
 * - RAF-batched resize handling
 */

/**
 * Calculate contain-fit scale for given content bounds within viewport
 */
function containScale(contentWidth, contentHeight, viewportWidth, viewportHeight, padding = 0) {
  const availableWidth = Math.max(1, viewportWidth - 2 * padding);
  const availableHeight = Math.max(1, viewportHeight - 2 * padding);
  
  const scaleX = availableWidth / Math.max(1, contentWidth);
  const scaleY = availableHeight / Math.max(1, contentHeight);
  
  return Math.min(scaleX, scaleY);
}

/**
 * Calculate translation to center content in viewport
 */
function centreTxTy(contentBounds, viewportWidth, viewportHeight, scale) {
  const scaledWidth = contentBounds.width * scale;
  const scaledHeight = contentBounds.height * scale;
  
  const tx = (viewportWidth - scaledWidth) / 2 / scale - contentBounds.x;
  const ty = (viewportHeight - scaledHeight) / 2 / scale - contentBounds.y;
  
  return { tx, ty };
}

/**
 * Calculate translation to focus a specific point at viewport center
 */
function focusTxTy(focusPoint, viewportWidth, viewportHeight, scale) {
  const tx = viewportWidth / 2 / scale - focusPoint.x;
  const ty = viewportHeight / 2 / scale - focusPoint.y;
  
  return { tx, ty };
}

/**
 * Transform world coordinates to screen coordinates
 */
function toScreen(worldX, worldY, transform) {
  return {
    x: (worldX + transform.tx) * transform.scale,
    y: (worldY + transform.ty) * transform.scale
  };
}

/**
 * Transform screen coordinates to world coordinates
 */
function toWorld(screenX, screenY, transform) {
  return {
    x: screenX / transform.scale - transform.tx,
    y: screenY / transform.scale - transform.ty
  };
}

/**
 * Canvas Viewport Controller Class
 */
class CanvasViewportController {
  constructor(containerElement, canvasElement, options = {}) {
    this.container = containerElement;
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.overlay = null;
    this.overlayCtx = null;
    
    this.frameBounds = options.frameBounds || null;
    this.padding = options.padding || 20;
    
    // State
    this.transform = { scale: 1, tx: 0, ty: 0 };
    this.dpr = window.devicePixelRatio || 1;
    this.lockState = { kind: 'unlocked' };
    
    // RAF batching
    this.rafId = null;
    this.resizeObserver = null;
    
    // Event listeners
    this.boundHandlers = {
      visualViewportResize: () => this.scheduleLayout(),
      dprChange: () => this.scheduleLayout()
    };
    
    this.init();
  }
  
  init() {
    // ResizeObserver for container size changes
    if (window.ResizeObserver) {
      this.resizeObserver = new ResizeObserver(() => {
        this.scheduleLayout();
      });
      this.resizeObserver.observe(this.container);
    } else {
      // Fallback for older browsers
      window.addEventListener('resize', this.boundHandlers.visualViewportResize);
    }
    
    // Visual viewport listener for mobile
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', this.boundHandlers.visualViewportResize);
    }
    
    // DPR change detection
    const mediaQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mediaQuery.addEventListener('change', this.boundHandlers.dprChange);
    this.mediaQuery = mediaQuery;
    
    // Initial layout
    this.scheduleLayout();
  }
  
  destroy() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', this.boundHandlers.visualViewportResize);
    }
    
    if (this.mediaQuery) {
      this.mediaQuery.removeEventListener('change', this.boundHandlers.dprChange);
    }
    
    window.removeEventListener('resize', this.boundHandlers.visualViewportResize);
    
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
    }
  }
  
  /**
   * RAF-batched layout scheduling
   */
  scheduleLayout() {
    if (this.rafId !== null) return; // Already scheduled
    
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.computeLayout();
    });
  }
  
  /**
   * Core layout computation - called when container size or DPR changes
   */
  computeLayout() {
    const containerRect = this.container.getBoundingClientRect();
    const margin = 16;
    const isVisible = (el) => el && el.offsetParent !== null;

    let leftReserve = 0;
    ['toolsPanel', 'strokePanel'].forEach((id) => {
      const el = document.getElementById(id);
      if (isVisible(el)) {
        const elRect = el.getBoundingClientRect();
        leftReserve = Math.max(leftReserve, Math.ceil(elRect.right) + margin);
      }
    });

    let rightReserve = 0;
    ['projectPanel', 'imagePanel'].forEach((id) => {
      const el = document.getElementById(id);
      if (isVisible(el)) {
        const elRect = el.getBoundingClientRect();
        rightReserve = Math.max(rightReserve, Math.ceil(window.innerWidth - elRect.left) + margin);
      }
    });

    let reservedTop = 0;
    const topToolbar = document.getElementById('topToolbar');
    if (isVisible(topToolbar)) {
      const toolbarRect = topToolbar.getBoundingClientRect();
      reservedTop = Math.max(reservedTop, Math.ceil(toolbarRect.bottom));
    }

    let reservedBottom = 16;
    const bottomControls = document.getElementById('canvasControls');
    if (isVisible(bottomControls)) {
      const controlsRect = bottomControls.getBoundingClientRect();
      reservedBottom = Math.max(reservedBottom, Math.ceil(window.innerHeight - controlsRect.top));
    }

    const widthByWindow = Math.max(320, Math.floor(window.innerWidth - leftReserve - rightReserve));
    const heightByWindow = Math.max(240, Math.floor(window.innerHeight - reservedTop - reservedBottom));

    const viewportWidth = Math.max(containerRect.width, widthByWindow);
    const viewportHeight = Math.max(containerRect.height, heightByWindow);

    if (viewportWidth <= 0 || viewportHeight <= 0) return;

    // Update canvas bitmap size with DPR
    const currentDpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(viewportWidth * currentDpr);
    this.canvas.height = Math.round(viewportHeight * currentDpr);

    // Ensure CSS size matches viewport exactly
    this.canvas.style.width = `${viewportWidth}px`;
    this.canvas.style.height = `${viewportHeight}px`;
    this.canvas.style.position = 'absolute';
    this.canvas.style.left = '0';
    this.canvas.style.top = '0';
    
    this.dpr = currentDpr;
    
    // Compute new transform
    let newTransform;
    
    if (this.lockState.kind === 'locked') {
      // Maintain locked focus at viewport center
      const { tx, ty } = focusTxTy(
        this.lockState.frameCenter,
        viewportWidth,
        viewportHeight,
        this.transform.scale
      );
      
      newTransform = {
        scale: this.transform.scale,
        tx,
        ty
      };
    } else if (this.frameBounds) {
      // Auto-fit content with contain scaling, capped to 4:3 viewport area
      const paddedWidth = Math.max(1, viewportWidth - this.padding * 2);
      const paddedHeight = Math.max(1, viewportHeight - this.padding * 2);
      const aspect = paddedWidth / paddedHeight;
      const targetAspect = 4 / 3;

      let constrainedWidth = paddedWidth;
      let constrainedHeight = paddedHeight;

      if (aspect > targetAspect) {
        constrainedWidth = paddedHeight * targetAspect;
      } else {
        constrainedHeight = paddedWidth / targetAspect;
      }

      const scale = containScale(
        this.frameBounds.width,
        this.frameBounds.height,
        constrainedWidth,
        constrainedHeight,
        0
      );
      
      const { tx, ty } = centreTxTy(
        this.frameBounds,
        viewportWidth,
        viewportHeight,
        scale
      );
      
      newTransform = { scale, tx, ty };
    } else {
      // No content bounds - apply 4:3 aspect ratio constraint and center
      const aspectTarget = 4 / 3;
      let constrainedWidth = viewportWidth;
      let constrainedHeight = viewportHeight;

      // Constrain to 4:3 aspect ratio
      if (constrainedWidth / constrainedHeight > aspectTarget) {
        constrainedWidth = constrainedHeight * aspectTarget;
      } else {
        constrainedHeight = constrainedWidth / aspectTarget;
      }

      // Use 1:1 scale for blank canvas (no zoom)
      const scale = 1.0;
      
      // Center the constrained 4:3 area within the full viewport
      const tx = (viewportWidth - constrainedWidth) / 2 / scale;
      const ty = (viewportHeight - constrainedHeight) / 2 / scale;

      newTransform = {
        scale: scale,
        tx: tx,
        ty: ty
      };

      // Canvas element stays full viewport size (set earlier in computeLayout)
      // The transform centers the 4:3 drawing area within it
      console.log(`[VIEWPORT] Blank canvas: viewport ${viewportWidth}x${viewportHeight}, 4:3 drawing area ${Math.round(constrainedWidth)}x${Math.round(constrainedHeight)} centered via transform`);
    }
    
    this.transform = newTransform;
    
    // Apply single transform to canvas context
    this.ctx.setTransform(
      currentDpr * newTransform.scale, 0,
      0, currentDpr * newTransform.scale,
      currentDpr * newTransform.tx,
      currentDpr * newTransform.ty
    );

    if (!this.frameBounds && typeof window.redrawCanvasWithVisibility === 'function') {
      window.redrawCanvasWithVisibility();
      this.removeOverlay();
    }
    
    // Dispatch custom event for other parts of the app
    this.container.dispatchEvent(new CustomEvent('viewportChanged', {
      detail: {
        transform: this.transform,
        dpr: this.dpr,
        viewportWidth,
        viewportHeight
      }
    }));
  }
  
  /**
   * Transform methods
   */
  clientToWorld(clientX, clientY) {
    return toWorld(clientX, clientY, this.transform);
  }
  
  worldToClient(worldX, worldY) {
    return toScreen(worldX, worldY, this.transform);
  }

  /**
   * Copy current canvas pixels into overlay canvas for resize transitions
   */
  duplicateContextToOverlay() {
    if (!this.overlay) {
      this.overlay = document.createElement('canvas');
      this.overlay.style.pointerEvents = 'none';
      this.overlay.style.position = 'absolute';
      this.overlay.style.left = '0';
      this.overlay.style.top = '0';
      const zIndex = parseInt(window.getComputedStyle(this.canvas).zIndex || '0', 10) || 0;
      this.overlay.style.zIndex = String(zIndex + 1);
      this.container.appendChild(this.overlay);
      this.overlayCtx = this.overlay.getContext('2d');
    }

    const dpr = window.devicePixelRatio || 1;
    this.overlay.width = this.canvas.width;
    this.overlay.height = this.canvas.height;
    this.overlay.style.width = `${this.canvas.width / dpr}px`;
    this.overlay.style.height = `${this.canvas.height / dpr}px`;

    try {
      this.overlayCtx.setTransform(1, 0, 0, 1, 0, 0);
      this.overlayCtx.clearRect(0, 0, this.overlay.width, this.overlay.height);
      this.overlayCtx.drawImage(this.canvas, 0, 0);
    } catch (_) {
      this.overlayCtx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    }
  }

  /**
   * Remove overlay after layout completes
   */
  removeOverlay() {
    if (this.overlay && this.overlay.parentElement) {
      this.overlay.parentElement.removeChild(this.overlay);
    }
    this.overlay = null;
    this.overlayCtx = null;
  }
  
  /**
   * Lock state management
   */
  setLock(state) {
    this.lockState = state;
    this.scheduleLayout();
  }
  
  /**
   * Zoom to specific frame bounds
   */
  zoomToFrame(bounds) {
    const containerRect = this.container.getBoundingClientRect();
    const scale = containScale(
      bounds.width,
      bounds.height,
      containerRect.width,
      containerRect.height,
      this.padding
    );
    
    const { tx, ty } = centreTxTy(
      bounds,
      containerRect.width,
      containerRect.height,
      scale
    );
    
    this.transform = { scale, tx, ty };
    this.scheduleLayout();
  }
  
  /**
   * Update frame bounds (for dynamic content)
   */
  setFrameBounds(bounds) {
    this.frameBounds = bounds;
    this.scheduleLayout();
  }
  
  /**
   * Get current state
   */
  getState() {
    return {
      transform: { ...this.transform },
      dpr: this.dpr,
      lockState: { ...this.lockState }
    };
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CanvasViewportController,
    containScale,
    centreTxTy,
    focusTxTy,
    toScreen,
    toWorld
  };
} else {
  // Browser global
  window.CanvasViewportController = CanvasViewportController;
  window.ViewportHelpers = {
    containScale,
    centreTxTy,
    focusTxTy,
    toScreen,
    toWorld
  };
}
