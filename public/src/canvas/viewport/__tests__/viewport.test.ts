/**
 * Unit tests for viewport transform mathematics
 */

import {
  containScale,
  centreTxTy,
  focusTxTy,
  toScreen,
  toWorld,
  ViewportTransform,
  ViewportBounds
} from '../useCanvasViewport';

describe('containScale', () => {
  it('should calculate correct scale for width-constrained content', () => {
    // Content: 200x100, Viewport: 400x300, Padding: 20
    // Available: 360x260
    // Scale X: 360/200 = 1.8, Scale Y: 260/100 = 2.6
    // Should pick min: 1.8
    const scale = containScale(200, 100, 400, 300, 20);
    expect(scale).toBeCloseTo(1.8);
  });

  it('should calculate correct scale for height-constrained content', () => {
    // Content: 100x200, Viewport: 400x300, Padding: 20
    // Available: 360x260
    // Scale X: 360/100 = 3.6, Scale Y: 260/200 = 1.3
    // Should pick min: 1.3
    const scale = containScale(100, 200, 400, 300, 20);
    expect(scale).toBeCloseTo(1.3);
  });

  it('should handle zero padding', () => {
    const scale = containScale(200, 100, 400, 300, 0);
    expect(scale).toBeCloseTo(2.0); // min(400/200, 300/100) = min(2, 3) = 2
  });

  it('should handle edge cases gracefully', () => {
    // Zero content dimensions should not crash
    const scale1 = containScale(0, 100, 400, 300, 0);
    expect(scale1).toBeCloseTo(3.0); // 300/100

    // Very small viewport
    const scale2 = containScale(100, 100, 10, 10, 0);
    expect(scale2).toBeCloseTo(0.1);
  });
});

describe('centreTxTy', () => {
  it('should center content correctly', () => {
    const contentBounds: ViewportBounds = {
      x: 0,
      y: 0,
      width: 100,
      height: 50
    };
    
    const { tx, ty } = centreTxTy(contentBounds, 400, 300, 2.0);
    
    // Scaled content: 200x100
    // Viewport center: 200, 150
    // Content center should be at viewport center
    // tx = (400 - 200) / 2 / 2 - 0 = 50
    // ty = (300 - 100) / 2 / 2 - 0 = 50
    expect(tx).toBeCloseTo(50);
    expect(ty).toBeCloseTo(50);
  });

  it('should handle content with offset origin', () => {
    const contentBounds: ViewportBounds = {
      x: 10,
      y: 20,
      width: 100,
      height: 50
    };
    
    const { tx, ty } = centreTxTy(contentBounds, 400, 300, 2.0);
    
    // Should account for content offset
    expect(tx).toBeCloseTo(40); // 50 - 10
    expect(ty).toBeCloseTo(30); // 50 - 20
  });
});

describe('focusTxTy', () => {
  it('should focus point at viewport center', () => {
    const focusPoint = { x: 100, y: 75 };
    const { tx, ty } = focusTxTy(focusPoint, 400, 300, 2.0);
    
    // Viewport center: (200, 150) in screen coords
    // World center: (200/2, 150/2) = (100, 75) in world coords
    // tx = 100 - 100 = 0
    // ty = 75 - 75 = 0
    expect(tx).toBeCloseTo(0);
    expect(ty).toBeCloseTo(0);
  });

  it('should handle different scales', () => {
    const focusPoint = { x: 50, y: 25 };
    const { tx, ty } = focusTxTy(focusPoint, 400, 300, 1.0);
    
    // tx = 400/2/1 - 50 = 200 - 50 = 150
    // ty = 300/2/1 - 25 = 150 - 25 = 125
    expect(tx).toBeCloseTo(150);
    expect(ty).toBeCloseTo(125);
  });
});

describe('coordinate transforms', () => {
  const transform: ViewportTransform = {
    scale: 2.0,
    tx: 100,
    ty: 50
  };

  describe('toScreen', () => {
    it('should transform world to screen coordinates correctly', () => {
      const { x, y } = toScreen(10, 20, transform);
      
      // screen = (world + translate) * scale
      // x = (10 + 100) * 2 = 220
      // y = (20 + 50) * 2 = 140
      expect(x).toBeCloseTo(220);
      expect(y).toBeCloseTo(140);
    });

    it('should handle origin correctly', () => {
      const { x, y } = toScreen(0, 0, transform);
      expect(x).toBeCloseTo(200); // (0 + 100) * 2
      expect(y).toBeCloseTo(100); // (0 + 50) * 2
    });
  });

  describe('toWorld', () => {
    it('should transform screen to world coordinates correctly', () => {
      const { x, y } = toWorld(220, 140, transform);
      
      // world = screen / scale - translate
      // x = 220 / 2 - 100 = 10
      // y = 140 / 2 - 50 = 20
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

  describe('round trip precision', () => {
    it('should maintain precision through multiple transforms', () => {
      const originalPoints = [
        { x: 0, y: 0 },
        { x: 123.456, y: 789.012 },
        { x: -50.5, y: 100.25 }
      ];

      originalPoints.forEach(point => {
        const screen = toScreen(point.x, point.y, transform);
        const world = toWorld(screen.x, screen.y, transform);
        
        expect(world.x).toBeCloseTo(point.x, 10); // 10 decimal places
        expect(world.y).toBeCloseTo(point.y, 10);
      });
    });
  });
});

describe('deterministic results', () => {
  it('should produce consistent results for standard sizes', () => {
    // Test common canvas sizes
    const testCases = [
      { content: { width: 800, height: 600 }, viewport: { width: 1024, height: 768 } },
      { content: { width: 1920, height: 1080 }, viewport: { width: 800, height: 600 } },
      { content: { width: 400, height: 300 }, viewport: { width: 400, height: 300 } }
    ];

    testCases.forEach(({ content, viewport }) => {
      const scale1 = containScale(content.width, content.height, viewport.width, viewport.height, 20);
      const scale2 = containScale(content.width, content.height, viewport.width, viewport.height, 20);
      
      expect(scale1).toBe(scale2);
      expect(typeof scale1).toBe('number');
      expect(isFinite(scale1)).toBe(true);
      expect(scale1).toBeGreaterThan(0);
    });
  });

  it('should handle floating point edge cases', () => {
    // Test with numbers that might cause floating point issues
    const scale = containScale(1/3, 1/7, 1000, 700, 0);
    
    expect(isFinite(scale)).toBe(true);
    expect(scale).toBeGreaterThan(0);
  });
});
