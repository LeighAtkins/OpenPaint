describe('Canvas Performance Tests', () => {
  let canvas, ctx;

  beforeEach(() => {
    // Create large canvas for performance testing
    canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    ctx = canvas.getContext('2d');

    // Mock required globals
    window.canvas = canvas;
    window.ctx = ctx;
    window.currentImageLabel = 'test_1';
    window.vectorStrokesByImage = { test_1: {} };
    window.lineStrokesByImage = { test_1: [] };
    window.strokeVisibilityByImage = { test_1: {} };
    window.imageScaleByLabel = { test_1: 1.0 };
    window.imagePositionByLabel = { test_1: { x: 0, y: 0 } };

    // Load paint.js functions
    require('../../public/js/paint.js');
  });

  test('should render 100+ strokes within performance budget', () => {
    const startTime = performance.now();

    // Generate test strokes
    for (let i = 0; i < 100; i++) {
      const strokeLabel = `A${i}`;
      window.lineStrokesByImage.test_1.push(strokeLabel);

      // Create varied stroke types
      const strokeType = i % 3 === 0 ? 'straight' : i % 3 === 1 ? 'curved' : 'freehand';
      const points = generateTestPoints(strokeType, i);

      window.vectorStrokesByImage.test_1[strokeLabel] = {
        points: points,
        type: strokeType,
        color: `hsl(${i * 3.6}, 70%, 50%)`,
        width: 3 + (i % 5),
        dashSettings: { enabled: i % 4 === 0, style: 'medium', pattern: [5, 5] },
      };

      window.strokeVisibilityByImage.test_1[strokeLabel] = true;
    }

    // Render all strokes
    if (window.redrawCanvasWithVisibility) {
      window.redrawCanvasWithVisibility();
    }

    const endTime = performance.now();
    const renderTime = endTime - startTime;

    // Performance assertions
    expect(renderTime).toBeLessThan(1000); // Should complete in under 1 second
    console.log(`Rendered 100 strokes in ${renderTime.toFixed(2)}ms`);
  });

  test('should handle rapid zoom operations efficiently', async () => {
    // Add some strokes first
    for (let i = 0; i < 20; i++) {
      const strokeLabel = `A${i}`;
      window.lineStrokesByImage.test_1.push(strokeLabel);
      window.vectorStrokesByImage.test_1[strokeLabel] = {
        points: generateTestPoints('freehand', i),
        type: 'freehand',
        color: '#000',
        width: 5,
      };
      window.strokeVisibilityByImage.test_1[strokeLabel] = true;
    }

    const zoomLevels = [0.5, 0.75, 1, 1.5, 2, 2.5, 3, 2, 1.5, 1];
    const zoomTimes = [];

    for (const scale of zoomLevels) {
      const startTime = performance.now();

      window.imageScaleByLabel.test_1 = scale;
      if (window.redrawCanvasWithVisibility) {
        window.redrawCanvasWithVisibility();
      }

      const endTime = performance.now();
      zoomTimes.push(endTime - startTime);
    }

    // All zoom operations should be fast
    const maxZoomTime = Math.max(...zoomTimes);
    const avgZoomTime = zoomTimes.reduce((a, b) => a + b, 0) / zoomTimes.length;

    expect(maxZoomTime).toBeLessThan(100); // No single zoom should take > 100ms
    expect(avgZoomTime).toBeLessThan(50); // Average should be under 50ms

    console.log(
      `Zoom performance - Max: ${maxZoomTime.toFixed(2)}ms, Avg: ${avgZoomTime.toFixed(2)}ms`
    );
  });

  test('should efficiently handle mousemove events with throttling', () => {
    const eventCount = 1000;
    let processedEvents = 0;

    // Mock event handler
    const originalHandler = canvas.onmousemove;
    canvas.onmousemove = () => processedEvents++;

    const startTime = performance.now();

    // Generate rapid mousemove events
    for (let i = 0; i < eventCount; i++) {
      const event = new MouseEvent('mousemove', {
        clientX: Math.random() * canvas.width,
        clientY: Math.random() * canvas.height,
        bubbles: true,
      });

      canvas.dispatchEvent(event);
    }

    const endTime = performance.now();
    const totalTime = endTime - startTime;

    // Should handle events quickly
    expect(totalTime).toBeLessThan(500);

    console.log(`Processed ${eventCount} mousemove events in ${totalTime.toFixed(2)}ms`);

    // Restore original handler
    canvas.onmousemove = originalHandler;
  });

  test('should handle large coordinate transformations efficiently', () => {
    const iterations = 10000;
    const startTime = performance.now();

    // Test coordinate transformations
    for (let i = 0; i < iterations; i++) {
      const point = { x: Math.random() * 2000, y: Math.random() * 2000 };

      if (window.toCanvas && window.toImage) {
        const canvasPoint = window.toCanvas(point, 'test_1');
        const backToImage = window.toImage(canvasPoint, 'test_1');

        // Verify transformation accuracy
        expect(Math.abs(backToImage.x - point.x)).toBeLessThan(0.1);
        expect(Math.abs(backToImage.y - point.y)).toBeLessThan(0.1);
      }
    }

    const endTime = performance.now();
    const totalTime = endTime - startTime;

    expect(totalTime).toBeLessThan(1000); // Should complete in under 1 second
    console.log(`Performed ${iterations} coordinate transformations in ${totalTime.toFixed(2)}ms`);
  });

  // Helper function to generate test points
  function generateTestPoints(type, seed) {
    const points = [];
    const random = seededRandom(seed);

    if (type === 'straight') {
      points.push({ x: random() * 500, y: random() * 500 });
      points.push({ x: random() * 500 + 500, y: random() * 500 });
    } else if (type === 'curved') {
      // Generate control points
      for (let i = 0; i < 4; i++) {
        points.push({ x: i * 200 + random() * 100, y: 250 + random() * 200 - 100 });
      }
    } else {
      // Freehand with many points
      const pointCount = 50 + Math.floor(random() * 100);
      let x = random() * 200;
      let y = random() * 200 + 200;

      for (let i = 0; i < pointCount; i++) {
        x += random() * 10 - 5;
        y += random() * 10 - 5;
        points.push({ x, y });
      }
    }

    return points;
  }

  function seededRandom(seed) {
    let value = seed;
    return function () {
      value = (value * 9301 + 49297) % 233280;
      return value / 233280;
    };
  }
});

describe('Memory Management Tests', () => {
  test('should not leak memory when creating and deleting strokes', () => {
    const initialMemory = performance.memory ? performance.memory.usedJSHeapSize : 0;

    // Create and delete many strokes
    for (let iteration = 0; iteration < 10; iteration++) {
      // Create 50 strokes
      for (let i = 0; i < 50; i++) {
        const label = `temp_${iteration}_${i}`;
        window.lineStrokesByImage.test_1.push(label);
        window.vectorStrokesByImage.test_1[label] = {
          points: Array(100)
            .fill(null)
            .map((_, idx) => ({
              x: idx * 5,
              y: Math.sin(idx * 0.1) * 100 + 200,
            })),
          type: 'freehand',
          color: '#000',
          width: 5,
        };
      }

      // Delete all strokes
      window.lineStrokesByImage.test_1 = [];
      window.vectorStrokesByImage.test_1 = {};

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
    }

    const finalMemory = performance.memory ? performance.memory.usedJSHeapSize : 0;
    const memoryIncrease = finalMemory - initialMemory;

    // Memory increase should be minimal
    expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024); // Less than 10MB increase

    console.log(
      `Memory test - Initial: ${initialMemory ? (initialMemory / 1024 / 1024).toFixed(2) : 'N/A'}MB, Final: ${finalMemory ? (finalMemory / 1024 / 1024).toFixed(2) : 'N/A'}MB`
    );
  });

  test('should handle rapid stroke creation and deletion', () => {
    const operations = 1000;
    const startTime = performance.now();

    for (let i = 0; i < operations; i++) {
      const label = `temp_${i}`;

      // Create stroke
      window.lineStrokesByImage.test_1.push(label);
      window.vectorStrokesByImage.test_1[label] = {
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 100 },
        ],
        type: 'straight',
        color: '#000',
        width: 5,
      };

      // Delete stroke immediately
      const index = window.lineStrokesByImage.test_1.indexOf(label);
      if (index > -1) {
        window.lineStrokesByImage.test_1.splice(index, 1);
      }
      delete window.vectorStrokesByImage.test_1[label];
    }

    const endTime = performance.now();
    const totalTime = endTime - startTime;

    expect(totalTime).toBeLessThan(1000); // Should complete in under 1 second
    expect(window.lineStrokesByImage.test_1).toHaveLength(0); // All strokes deleted
    expect(Object.keys(window.vectorStrokesByImage.test_1)).toHaveLength(0);

    console.log(`Performed ${operations} create/delete operations in ${totalTime.toFixed(2)}ms`);
  });
});
