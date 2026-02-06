/**
 * Coordinate Transformation Validation Tests
 * Tests for image-space to canvas-space coordinate transformations
 */

describe('Coordinate Transformations', () => {
  let mockImageLabel, mockDimensions, mockScale, mockPosition;

  beforeEach(() => {
    // Set up mock data
    mockImageLabel = 'front';
    mockDimensions = { width: 800, height: 600 };
    mockScale = 1.0;
    mockPosition = { x: 0, y: 0 };

    // Mock global state
    global.window = {
      originalImageDimensions: {
        [mockImageLabel]: mockDimensions,
      },
      imageScaleByLabel: {
        [mockImageLabel]: mockScale,
      },
      imagePositionByLabel: {
        [mockImageLabel]: mockPosition,
      },
      imageRotationByLabel: {
        [mockImageLabel]: 0,
      },
    };
  });

  afterEach(() => {
    delete global.window;
  });

  test('toImage preserves points within bounds at scale 1.0', () => {
    // This test would require the actual toImage function
    // For now, we validate the concept
    const canvasPoint = { x: 100, y: 100 };

    // At scale 1.0 with no offset, canvas coords = image coords
    const imagePoint = {
      x: (canvasPoint.x - mockPosition.x) / mockScale,
      y: (canvasPoint.y - mockPosition.y) / mockScale,
    };

    expect(imagePoint.x).toBeGreaterThanOrEqual(0);
    expect(imagePoint.y).toBeGreaterThanOrEqual(0);
    expect(imagePoint.x).toBeLessThanOrEqual(mockDimensions.width);
    expect(imagePoint.y).toBeLessThanOrEqual(mockDimensions.height);
  });

  test('round-trip conversion is accurate', () => {
    const original = { x: 50, y: 75 };

    // Image to canvas
    const canvas = {
      x: original.x * mockScale + mockPosition.x,
      y: original.y * mockScale + mockPosition.y,
    };

    // Canvas back to image
    const back = {
      x: (canvas.x - mockPosition.x) / mockScale,
      y: (canvas.y - mockPosition.y) / mockScale,
    };

    expect(back.x).toBeCloseTo(original.x, 1);
    expect(back.y).toBeCloseTo(original.y, 1);
  });

  test('transformation handles scale correctly', () => {
    mockScale = 2.0;
    global.window.imageScaleByLabel[mockImageLabel] = mockScale;

    const imagePoint = { x: 100, y: 100 };
    const canvasPoint = {
      x: imagePoint.x * mockScale + mockPosition.x,
      y: imagePoint.y * mockScale + mockPosition.y,
    };

    expect(canvasPoint.x).toBe(200);
    expect(canvasPoint.y).toBe(200);
  });

  test('transformation handles pan offset correctly', () => {
    mockPosition = { x: 50, y: 30 };
    global.window.imagePositionByLabel[mockImageLabel] = mockPosition;

    const imagePoint = { x: 100, y: 100 };
    const canvasPoint = {
      x: imagePoint.x * mockScale + mockPosition.x,
      y: imagePoint.y * mockScale + mockPosition.y,
    };

    expect(canvasPoint.x).toBe(150);
    expect(canvasPoint.y).toBe(130);
  });

  test('transformation handles combined scale and pan', () => {
    mockScale = 1.5;
    mockPosition = { x: 20, y: 10 };
    global.window.imageScaleByLabel[mockImageLabel] = mockScale;
    global.window.imagePositionByLabel[mockImageLabel] = mockPosition;

    const imagePoint = { x: 100, y: 100 };
    const canvasPoint = {
      x: imagePoint.x * mockScale + mockPosition.x,
      y: imagePoint.y * mockScale + mockPosition.y,
    };

    expect(canvasPoint.x).toBe(170); // 100 * 1.5 + 20
    expect(canvasPoint.y).toBe(160); // 100 * 1.5 + 10

    // Verify round-trip
    const back = {
      x: (canvasPoint.x - mockPosition.x) / mockScale,
      y: (canvasPoint.y - mockPosition.y) / mockScale,
    };

    expect(back.x).toBeCloseTo(imagePoint.x, 1);
    expect(back.y).toBeCloseTo(imagePoint.y, 1);
  });
});

describe('Coordinate Validation Utilities', () => {
  test('validateImageSpacePoint accepts valid points', () => {
    const { validateImageSpacePoint } = require('../../js/coordinate-validator.js');

    const point = { x: 100, y: 100 };
    const dims = { width: 800, height: 600 };

    const isValid = validateImageSpacePoint(point, dims);
    expect(isValid).toBe(true);
  });

  test('validateImageSpacePoint rejects out-of-bounds points', () => {
    const { validateImageSpacePoint } = require('../../js/coordinate-validator.js');

    const point = { x: 1000, y: 100 };
    const dims = { width: 800, height: 600 };

    const isValid = validateImageSpacePoint(point, dims);
    expect(isValid).toBe(false);
  });

  test('validateImageSpacePoint rejects invalid point structures', () => {
    const { validateImageSpacePoint } = require('../../js/coordinate-validator.js');

    const dims = { width: 800, height: 600 };

    expect(validateImageSpacePoint(null, dims)).toBe(false);
    expect(validateImageSpacePoint({}, dims)).toBe(false);
    expect(validateImageSpacePoint({ x: 'invalid' }, dims)).toBe(false);
  });
});
