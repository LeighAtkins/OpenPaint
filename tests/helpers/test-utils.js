// Shared test utilities

export const MockImageData = {
  create: (width = 100, height = 100) => {
    return {
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    };
  },
};

export const TestDataBuilder = {
  stroke: (overrides = {}) => ({
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ],
    type: 'straight',
    color: '#000000',
    width: 5,
    dashSettings: { enabled: false, style: 'solid', pattern: [] },
    ...overrides,
  }),

  measurement: (overrides = {}) => ({
    inchWhole: 12,
    inchFraction: 0,
    cm: 30.48,
    ...overrides,
  }),

  image: (label, overrides = {}) => ({
    label,
    url: `blob:test-${label}`,
    width: 800,
    height: 600,
    scale: 1,
    position: { x: 0, y: 0 },
    ...overrides,
  }),

  curvedStroke: (overrides = {}) => ({
    points: [
      { x: 100, y: 100 },
      { x: 200, y: 50 },
      { x: 300, y: 150 },
      { x: 400, y: 100 },
    ],
    type: 'curved',
    color: '#000000',
    width: 5,
    controlPoints: [
      { x: 100, y: 100 },
      { x: 200, y: 50 },
      { x: 300, y: 150 },
      { x: 400, y: 100 },
    ],
    ...overrides,
  }),

  freehandStroke: (pointCount = 10, overrides = {}) => {
    const points = [];
    for (let i = 0; i < pointCount; i++) {
      points.push({
        x: i * 10,
        y: 100 + Math.sin(i * 0.5) * 20,
      });
    }

    return {
      points,
      type: 'freehand',
      color: '#000000',
      width: 5,
      ...overrides,
    };
  },
};

export const waitFor = (condition, timeout = 5000) => {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const check = () => {
      if (condition()) {
        resolve();
      } else if (Date.now() - startTime > timeout) {
        reject(new Error('Timeout waiting for condition'));
      } else {
        setTimeout(check, 50);
      }
    };

    check();
  });
};

export const simulateDrawing = (canvas, points, options = {}) => {
  const { delay = 10, pressure = 1.0, pointerType = 'mouse' } = options;

  const events = [];

  // Mouse down
  events.push(
    new MouseEvent('mousedown', {
      clientX: points[0].x,
      clientY: points[0].y,
      offsetX: points[0].x,
      offsetY: points[0].y,
      pressure: pressure,
      pointerType: pointerType,
      bubbles: true,
    })
  );

  // Mouse moves
  for (let i = 1; i < points.length; i++) {
    events.push(
      new MouseEvent('mousemove', {
        clientX: points[i].x,
        clientY: points[i].y,
        offsetX: points[i].x,
        offsetY: points[i].y,
        pressure: pressure,
        pointerType: pointerType,
        bubbles: true,
      })
    );
  }

  // Mouse up
  const lastPoint = points[points.length - 1];
  events.push(
    new MouseEvent('mouseup', {
      clientX: lastPoint.x,
      clientY: lastPoint.y,
      offsetX: lastPoint.x,
      offsetY: lastPoint.y,
      pressure: 0,
      pointerType: pointerType,
      bubbles: true,
    })
  );

  // Dispatch events with delay
  return events.reduce((promise, event, index) => {
    return promise.then(() => {
      canvas.dispatchEvent(event);
      return new Promise(resolve => setTimeout(resolve, delay));
    });
  }, Promise.resolve());
};

export const MockCanvas = {
  create: (width = 800, height = 600) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    // Mock additional methods that might be needed
    canvas.getBoundingClientRect = jest.fn(() => ({
      left: 0,
      top: 0,
      width: width,
      height: height,
      right: width,
      bottom: height,
    }));

    return canvas;
  },
};

export const TestHelpers = {
  // Generate test points for different stroke types
  generateStraightLinePoints: (startX, startY, endX, endY) => [
    { x: startX, y: startY },
    { x: endX, y: endY },
  ],

  generateCurvePoints: (centerX, centerY, radius, segments = 20) => {
    const points = [];
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      points.push({
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
      });
    }
    return points;
  },

  generateFreehandPoints: (startX, startY, length = 100, variation = 20) => {
    const points = [{ x: startX, y: startY }];
    let currentX = startX;
    let currentY = startY;

    for (let i = 1; i < length; i++) {
      currentX += Math.random() * 4 - 2;
      currentY += Math.random() * variation - variation / 2;
      points.push({ x: currentX, y: currentY });
    }

    return points;
  },

  // Measurement conversion helpers
  inchesToCm: inches => inches * 2.54,
  cmToInches: cm => cm / 2.54,

  // Color helpers
  hexToRgb: hex => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? {
          r: parseInt(result[1], 16),
          g: parseInt(result[2], 16),
          b: parseInt(result[3], 16),
        }
      : null;
  },

  // DOM helpers
  createMockElement: (tag, attributes = {}) => {
    const element = document.createElement(tag);
    Object.entries(attributes).forEach(([key, value]) => {
      element.setAttribute(key, value);
    });
    return element;
  },

  // Coordinate helpers
  distance: (p1, p2) => {
    return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
  },

  midpoint: (p1, p2) => ({
    x: (p1.x + p2.x) / 2,
    y: (p1.y + p2.y) / 2,
  }),

  // Timing helpers
  delay: ms => new Promise(resolve => setTimeout(resolve, ms)),

  // Random data generators
  randomColor: () => {
    const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#000000'];
    return colors[Math.floor(Math.random() * colors.length)];
  },

  randomPoint: (width = 800, height = 600) => ({
    x: Math.random() * width,
    y: Math.random() * height,
  }),
};

// Export default object for CommonJS compatibility
module.exports = {
  MockImageData,
  TestDataBuilder,
  waitFor,
  simulateDrawing,
  MockCanvas,
  TestHelpers,
};
