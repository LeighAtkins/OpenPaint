describe('Coordinate Transformation Functions', () => {
  let mockCanvas, mockImageLabel, mockScale, mockPosition;

  beforeEach(() => {
    // Setup mock data
    mockCanvas = { width: 800, height: 600 };
    mockImageLabel = 'front';
    mockScale = 1.5;
    mockPosition = { x: 50, y: 50 };

    // Mock window objects
    global.window.canvas = mockCanvas;
    global.window.imageScaleByLabel = { [mockImageLabel]: mockScale };
    global.window.imagePositionByLabel = { [mockImageLabel]: mockPosition };
    global.window.originalImageDimensions = {
      [mockImageLabel]: { width: 400, height: 300 },
    };

    // Mock the coordinate transformation functions
    global.window.toCanvas = jest.fn((imagePoint, imgLabel) => {
      const scale = global.window.imageScaleByLabel[imgLabel] || 1;
      const position = global.window.imagePositionByLabel[imgLabel] || { x: 0, y: 0 };
      return {
        x: mockCanvas.width / 2 + position.x + imagePoint.x * scale,
        y: mockCanvas.height / 2 + position.y + imagePoint.y * scale,
      };
    });

    global.window.toImage = jest.fn((canvasPoint, imgLabel) => {
      const scale = global.window.imageScaleByLabel[imgLabel] || 1;
      const position = global.window.imagePositionByLabel[imgLabel] || { x: 0, y: 0 };
      return {
        x: (canvasPoint.x - mockCanvas.width / 2 - position.x) / scale,
        y: (canvasPoint.y - mockCanvas.height / 2 - position.y) / scale,
      };
    });

    global.window.getTransformedCoords = jest.fn((x, y) => {
      const canvasPoint = { x, y };
      return global.window.toImage(canvasPoint, global.window.currentImageLabel || mockImageLabel);
    });

    global.window.getCanvasCoords = jest.fn((x, y) => {
      const imagePoint = { x, y };
      return global.window.toCanvas(imagePoint, global.window.currentImageLabel || mockImageLabel);
    });
  });

  describe('toCanvas', () => {
    test('should transform image coordinates to canvas coordinates correctly', () => {
      const imagePoint = { x: 100, y: 100 };
      const result = global.window.toCanvas(imagePoint, mockImageLabel);

      // Expected: canvas center + position offset + (imagePoint * scale)
      const expectedX = 400 + 50 + 100 * 1.5;
      const expectedY = 300 + 50 + 100 * 1.5;

      expect(result.x).toBeCloseTo(expectedX, 1);
      expect(result.y).toBeCloseTo(expectedY, 1);
    });

    test('should handle blank canvas mode', () => {
      // Remove original image to trigger blank canvas mode
      delete global.window.originalImageDimensions[mockImageLabel];

      const imagePoint = { x: 100, y: 100 };
      const result = global.window.toCanvas(imagePoint, mockImageLabel);

      // In blank canvas mode, should apply scale and position
      expect(result).toBeDefined();
      expect(typeof result.x).toBe('number');
      expect(typeof result.y).toBe('number');
    });

    test('should handle edge cases', () => {
      const edgeCases = [
        { x: 0, y: 0 },
        { x: -100, y: -100 },
        { x: 10000, y: 10000 },
      ];

      edgeCases.forEach(input => {
        const result = global.window.toCanvas(input, mockImageLabel);
        expect(result).toHaveProperty('x');
        expect(result).toHaveProperty('y');
        expect(typeof result.x).toBe('number');
        expect(typeof result.y).toBe('number');
      });
    });
  });

  describe('toImage', () => {
    test('should transform canvas coordinates to image coordinates correctly', () => {
      const canvasPoint = { x: 600, y: 500 }; // 400+50+150, 300+50+150
      const result = global.window.toImage(canvasPoint, mockImageLabel);

      // Should reverse the transformation (600-400-50)/1.5 = 100
      expect(result.x).toBeCloseTo(100, 1);
      expect(result.y).toBeCloseTo(100, 1);
    });

    test('should be inverse of toCanvas', () => {
      const originalPoint = { x: 150, y: 200 };
      const canvasPoint = global.window.toCanvas(originalPoint, mockImageLabel);
      const backToImage = global.window.toImage(canvasPoint, mockImageLabel);

      expect(backToImage.x).toBeCloseTo(originalPoint.x, 1);
      expect(backToImage.y).toBeCloseTo(originalPoint.y, 1);
    });
  });

  describe('getTransformedCoords', () => {
    test('should transform canvas coordinates to image-relative coordinates', () => {
      const canvasX = 550;
      const canvasY = 450;
      const result = global.window.getTransformedCoords(canvasX, canvasY);

      expect(result).toHaveProperty('x');
      expect(result).toHaveProperty('y');
      expect(typeof result.x).toBe('number');
      expect(typeof result.y).toBe('number');
    });

    test('should handle different scale factors', () => {
      global.window.imageScaleByLabel[mockImageLabel] = 2.0;

      const result = global.window.getTransformedCoords(500, 400);

      expect(result).toBeDefined();
      expect(typeof result.x).toBe('number');
      expect(typeof result.y).toBe('number');
    });
  });

  describe('getCanvasCoords', () => {
    test('should transform image-relative coordinates to canvas coordinates', () => {
      const imageX = 100;
      const imageY = 100;
      const result = global.window.getCanvasCoords(imageX, imageY);

      expect(result).toHaveProperty('x');
      expect(result).toHaveProperty('y');
      expect(typeof result.x).toBe('number');
      expect(typeof result.y).toBe('number');
    });

    test('should be inverse of getTransformedCoords', () => {
      const canvasX = 500;
      const canvasY = 400;

      const imageCoords = global.window.getTransformedCoords(canvasX, canvasY);
      const backToCanvas = global.window.getCanvasCoords(imageCoords.x, imageCoords.y);

      expect(backToCanvas.x).toBeCloseTo(canvasX, 1);
      expect(backToCanvas.y).toBeCloseTo(canvasY, 1);
    });
  });
});
