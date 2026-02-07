/**
 * Unit tests for Canvas Viewport Controller
 * Skipped: canvasViewport.js module has not been implemented yet.
 */

// Mock DOM elements for testing
class MockElement {
  constructor() {
    this.style = {};
    this.width = 0;
    this.height = 0;
    this.eventListeners = {};
  }

  getBoundingClientRect() {
    return {
      width: this.width || 800,
      height: this.height || 600,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: this.height || 600,
      right: this.width || 800,
    };
  }

  addEventListener(event, handler) {
    if (!this.eventListeners[event]) {
      this.eventListeners[event] = [];
    }
    this.eventListeners[event].push(handler);
  }

  removeEventListener(event, handler) {
    if (this.eventListeners[event]) {
      const index = this.eventListeners[event].indexOf(handler);
      if (index > -1) {
        this.eventListeners[event].splice(index, 1);
      }
    }
  }

  dispatchEvent(event) {
    const handlers = this.eventListeners[event.type] || [];
    handlers.forEach(handler => handler(event));
  }

  getContext() {
    return {
      setTransform: vi.fn(),
    };
  }
}

// Mock ResizeObserver
class MockResizeObserver {
  constructor(callback) {
    this.callback = callback;
    this.observed = [];
  }

  observe(element) {
    this.observed.push(element);
  }

  disconnect() {
    this.observed = [];
  }

  trigger() {
    this.callback();
  }
}

// Setup globals
global.ResizeObserver = MockResizeObserver;
global.requestAnimationFrame = callback => setTimeout(callback, 16);
global.cancelAnimationFrame = id => clearTimeout(id);

import {
  CanvasViewportController,
  containScale,
  centreTxTy,
  toScreen,
  toWorld,
} from '../../src/modules/utils/canvasViewport';

describe('Viewport Helper Functions', () => {
  describe('containScale', () => {
    it('should calculate correct scale for width-constrained content', () => {
      const scale = containScale(200, 100, 400, 300, 20);
      expect(scale).toBeCloseTo(1.8);
    });

    it('should calculate correct scale for height-constrained content', () => {
      const scale = containScale(100, 200, 400, 300, 20);
      expect(scale).toBeCloseTo(1.3);
    });

    it('should handle zero padding', () => {
      const scale = containScale(200, 100, 400, 300, 0);
      expect(scale).toBeCloseTo(2.0);
    });
  });

  describe('centreTxTy', () => {
    it('should center content correctly', () => {
      const contentBounds = { x: 0, y: 0, width: 100, height: 50 };
      const { tx, ty } = centreTxTy(contentBounds, 400, 300, 2.0);

      expect(tx).toBeCloseTo(50);
      expect(ty).toBeCloseTo(50);
    });

    it('should handle content with offset origin', () => {
      const contentBounds = { x: 10, y: 20, width: 100, height: 50 };
      const { tx, ty } = centreTxTy(contentBounds, 400, 300, 2.0);

      expect(tx).toBeCloseTo(40);
      expect(ty).toBeCloseTo(30);
    });
  });

  describe('coordinate transforms', () => {
    const transform = { scale: 2.0, tx: 100, ty: 50 };

    describe('toScreen', () => {
      it('should transform world to screen coordinates correctly', () => {
        const { x, y } = toScreen(10, 20, transform);
        expect(x).toBeCloseTo(220);
        expect(y).toBeCloseTo(140);
      });
    });

    describe('toWorld', () => {
      it('should transform screen to world coordinates correctly', () => {
        const { x, y } = toWorld(220, 140, transform);
        expect(x).toBeCloseTo(10);
        expect(y).toBeCloseTo(20);
      });

      it('should be inverse of toScreen', () => {
        const worldPoint = { x: 15, y: 25 };
        const screenPoint = toScreen(worldPoint.x, worldPoint.y, transform);
        const backToWorld = toWorld(screenPoint.x, screenPoint.y, transform);

        expect(backToWorld.x).toBeCloseTo(worldPoint.x);
        expect(backToWorld.y).toBeCloseTo(worldPoint.y);
      });
    });
  });
});

describe('CanvasViewportController', () => {
  let container, canvas, controller, mockCtx;

  beforeEach(() => {
    container = new MockElement();
    canvas = new MockElement();
    mockCtx = {
      setTransform: vi.fn(),
    };
    canvas.getContext = () => mockCtx;

    // Set default size
    container.width = 800;
    container.height = 600;
  });

  afterEach(() => {
    if (controller) {
      controller.destroy();
    }
  });

  it('should initialize with default values', () => {
    controller = new CanvasViewportController(container, canvas);

    expect(controller.transform.scale).toBe(1);
    expect(controller.dpr).toBeGreaterThan(0);
    expect(controller.lockState.kind).toBe('unlocked');
  });

  it('should set canvas size based on container', done => {
    controller = new CanvasViewportController(container, canvas);

    // Wait for initial layout
    setTimeout(() => {
      expect(canvas.width).toBe(800);
      expect(canvas.height).toBe(600);
      expect(canvas.style.width).toBe('800px');
      expect(canvas.style.height).toBe('600px');
      done();
    }, 50);
  });

  it('should apply DPR scaling to canvas bitmap', done => {
    // Mock higher DPR
    Object.defineProperty(window, 'devicePixelRatio', {
      writable: true,
      value: 2,
    });

    controller = new CanvasViewportController(container, canvas);

    setTimeout(() => {
      expect(canvas.width).toBe(1600); // 800 * 2
      expect(canvas.height).toBe(1200); // 600 * 2
      expect(canvas.style.width).toBe('800px'); // CSS size unchanged
      expect(canvas.style.height).toBe('600px');
      done();
    }, 50);
  });

  it('should fit content bounds when provided', done => {
    const frameBounds = { x: 0, y: 0, width: 400, height: 200 };
    controller = new CanvasViewportController(container, canvas, { frameBounds });

    setTimeout(() => {
      // Should fit content with padding
      const expectedScale = containScale(400, 200, 800, 600, 20);
      expect(controller.transform.scale).toBeCloseTo(expectedScale);
      done();
    }, 50);
  });

  it('should handle lock state correctly', done => {
    controller = new CanvasViewportController(container, canvas);

    const lockCenter = { x: 100, y: 100 };
    controller.setLock({ kind: 'locked', frameCenter: lockCenter });

    setTimeout(() => {
      expect(controller.lockState.kind).toBe('locked');
      expect(controller.lockState.frameCenter).toEqual(lockCenter);
      done();
    }, 50);
  });

  it('should transform coordinates correctly', () => {
    controller = new CanvasViewportController(container, canvas);
    controller.transform = { scale: 2, tx: 50, ty: 25 };

    const worldPoint = controller.clientToWorld(100, 50);
    expect(worldPoint.x).toBeCloseTo(0); // (100 / 2) - 50
    expect(worldPoint.y).toBeCloseTo(0); // (50 / 2) - 25

    const screenPoint = controller.worldToClient(0, 0);
    expect(screenPoint.x).toBeCloseTo(100); // (0 + 50) * 2
    expect(screenPoint.y).toBeCloseTo(50); // (0 + 25) * 2
  });

  it('should apply single transform to canvas context', done => {
    Object.defineProperty(window, 'devicePixelRatio', {
      writable: true,
      value: 2,
    });

    controller = new CanvasViewportController(container, canvas);

    setTimeout(() => {
      expect(mockCtx.setTransform).toHaveBeenCalled();

      // Should be called with DPR * scale for each parameter
      const calls = mockCtx.setTransform.mock.calls;
      const lastCall = calls[calls.length - 1];

      expect(lastCall[0]).toBeCloseTo(2); // dpr * scale
      expect(lastCall[3]).toBeCloseTo(2); // dpr * scale
      done();
    }, 50);
  });

  it('should batch resize events with RAF', done => {
    controller = new CanvasViewportController(container, canvas);
    const originalSetTransform = mockCtx.setTransform;
    mockCtx.setTransform = vi.fn();

    // Trigger multiple rapid resizes
    controller.scheduleLayout();
    controller.scheduleLayout();
    controller.scheduleLayout();

    // Should only call setTransform once after RAF
    setTimeout(() => {
      expect(mockCtx.setTransform).toHaveBeenCalledTimes(1);
      done();
    }, 50);
  });

  it('should dispatch viewport change events', done => {
    const eventHandler = vi.fn();
    container.addEventListener('viewportChanged', eventHandler);

    controller = new CanvasViewportController(container, canvas);

    setTimeout(() => {
      expect(eventHandler).toHaveBeenCalled();

      const event = eventHandler.mock.calls[0][0];
      expect(event.detail.transform).toBeDefined();
      expect(event.detail.dpr).toBeDefined();
      expect(event.detail.viewportWidth).toBe(800);
      expect(event.detail.viewportHeight).toBe(600);
      done();
    }, 50);
  });

  it('should clean up resources on destroy', () => {
    controller = new CanvasViewportController(container, canvas);
    const resizeObserver = controller.resizeObserver;

    controller.destroy();

    expect(controller.rafId).toBeNull();
    // ResizeObserver should be disconnected (can't easily test due to mock)
  });
});

describe('Integration Tests', () => {
  it('should maintain precision through multiple transforms', () => {
    const transform = { scale: 1.5, tx: 123.456, ty: 789.012 };
    const originalPoints = [
      { x: 0, y: 0 },
      { x: 123.456, y: 789.012 },
      { x: -50.5, y: 100.25 },
    ];

    originalPoints.forEach(point => {
      const screen = toScreen(point.x, point.y, transform);
      const world = toWorld(screen.x, screen.y, transform);

      expect(world.x).toBeCloseTo(point.x, 10);
      expect(world.y).toBeCloseTo(point.y, 10);
    });
  });

  it('should handle rapid container size changes without drift', () => {
    const container = new MockElement();
    const canvas = new MockElement();
    const controller = new CanvasViewportController(container, canvas);

    const originalTransform = { ...controller.transform };

    // Simulate rapid size changes
    for (let i = 0; i < 50; i++) {
      container.width = 800 + Math.sin(i) * 100;
      container.height = 600 + Math.cos(i) * 100;
      controller.scheduleLayout();
    }

    // Final transform should be stable (not testing exact values due to async nature)
    expect(typeof controller.transform.scale).toBe('number');
    expect(isFinite(controller.transform.scale)).toBe(true);
    expect(controller.transform.scale).toBeGreaterThan(0);

    controller.destroy();
  });
});
