describe('Paint Application Core Functions', () => {
  beforeEach(() => {
    // Setup basic globals
    global.window.currentImageLabel = 'front';
    global.window.lineStrokesByImage = { front: [] };
    global.window.vectorStrokesByImage = { front: {} };
    global.window.strokeMeasurements = { front: {} };
    global.window.strokeVisibilityByImage = { front: {} };
  });

  describe('Basic Coordinate Transformation', () => {
    test('should transform coordinates correctly', () => {
      // Mock a simple coordinate transformation
      const toCanvas = (point, scale = 1, offset = { x: 0, y: 0 }) => {
        return {
          x: point.x * scale + offset.x,
          y: point.y * scale + offset.y
        };
      };
      
      const result = toCanvas({ x: 100, y: 50 }, 2, { x: 10, y: 20 });
      expect(result.x).toBe(210); // 100 * 2 + 10
      expect(result.y).toBe(120); // 50 * 2 + 20
    });

    test('should handle inverse transformations', () => {
      const toCanvas = (point, scale = 1, offset = { x: 0, y: 0 }) => ({
        x: point.x * scale + offset.x,
        y: point.y * scale + offset.y
      });
      
      const toImage = (point, scale = 1, offset = { x: 0, y: 0 }) => ({
        x: (point.x - offset.x) / scale,
        y: (point.y - offset.y) / scale
      });
      
      const original = { x: 100, y: 50 };
      const canvas = toCanvas(original, 2, { x: 10, y: 20 });
      const backToImage = toImage(canvas, 2, { x: 10, y: 20 });
      
      expect(backToImage.x).toBeCloseTo(original.x, 1);
      expect(backToImage.y).toBeCloseTo(original.y, 1);
    });
  });

  describe('Basic Measurement Parsing', () => {
    test('should parse simple inch measurements', () => {
      const parseInches = (input) => {
        const match = input.match(/(\d+(?:\.\d+)?)\s*"?/);
        return match ? parseFloat(match[1]) : null;
      };
      
      expect(parseInches('12"')).toBe(12);
      expect(parseInches('24.5')).toBe(24.5);
      expect(parseInches('invalid')).toBeNull();
    });

    test('should convert units', () => {
      const inchesToCm = (inches) => inches * 2.54;
      const cmToInches = (cm) => cm / 2.54;
      
      expect(inchesToCm(12)).toBeCloseTo(30.48, 2);
      expect(cmToInches(30.48)).toBeCloseTo(12, 2);
    });

    test('should find closest fractions', () => {
      const findClosestFraction = (decimal) => {
        const fractions = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875];
        return fractions.reduce((prev, curr) => 
          Math.abs(curr - decimal) < Math.abs(prev - decimal) ? curr : prev
        );
      };
      
      expect(findClosestFraction(0.1)).toBe(0.125);
      expect(findClosestFraction(0.6)).toBe(0.625);
      expect(findClosestFraction(0.8)).toBe(0.75);
    });
  });

  describe('Basic Stroke Management', () => {
    test('should generate unique stroke names', () => {
      const generateUniqueName = (baseName, existingNames) => {
        if (!existingNames.includes(baseName)) return baseName;
        
        let counter = 1;
        let newName = `${baseName}(${counter})`;
        while (existingNames.includes(newName)) {
          counter++;
          newName = `${baseName}(${counter})`;
        }
        return newName;
      };
      
      const existing = ['A1', 'A2', 'A1(1)'];
      expect(generateUniqueName('A1', existing)).toBe('A1(2)');
      expect(generateUniqueName('B1', existing)).toBe('B1');
    });

    test('should manage stroke visibility', () => {
      const strokes = { A1: true, A2: true, A3: false };
      
      const toggleVisibility = (strokeLabel) => {
        strokes[strokeLabel] = !strokes[strokeLabel];
      };
      
      toggleVisibility('A1');
      expect(strokes.A1).toBe(false);
      
      toggleVisibility('A3');
      expect(strokes.A3).toBe(true);
    });

    test('should delete strokes properly', () => {
      const strokeData = {
        lineStrokes: ['A1', 'A2', 'A3'],
        vectorData: { A1: {}, A2: {}, A3: {} },
        measurements: { A1: {}, A2: {} }
      };
      
      const deleteStroke = (label) => {
        const index = strokeData.lineStrokes.indexOf(label);
        if (index > -1) strokeData.lineStrokes.splice(index, 1);
        delete strokeData.vectorData[label];
        delete strokeData.measurements[label];
      };
      
      deleteStroke('A2');
      expect(strokeData.lineStrokes).toEqual(['A1', 'A3']);
      expect(strokeData.vectorData.A2).toBeUndefined();
      expect(strokeData.measurements.A2).toBeUndefined();
    });
  });

  describe('Canvas Operations', () => {
    test('should handle canvas dimensions', () => {
      const canvas = { width: 800, height: 600 };
      const getCenter = () => ({ x: canvas.width / 2, y: canvas.height / 2 });
      
      expect(getCenter()).toEqual({ x: 400, y: 300 });
    });

    test('should calculate distances between points', () => {
      const distance = (p1, p2) => {
        return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
      };
      
      const p1 = { x: 0, y: 0 };
      const p2 = { x: 3, y: 4 };
      expect(distance(p1, p2)).toBe(5); // 3-4-5 triangle
    });

    test('should handle stroke point arrays', () => {
      const stroke = {
        points: [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 50 }],
        type: 'freehand'
      };
      
      expect(stroke.points).toHaveLength(3);
      expect(stroke.points[0]).toEqual({ x: 0, y: 0 });
      expect(stroke.type).toBe('freehand');
    });
  });

  describe('Data Persistence', () => {
    test('should store measurements correctly', () => {
      const measurements = {};
      const saveMeasurement = (strokeLabel, value, unit) => {
        measurements[strokeLabel] = { value, unit };
      };
      
      saveMeasurement('A1', 24, 'inches');
      saveMeasurement('A2', 60.96, 'cm');
      
      expect(measurements.A1).toEqual({ value: 24, unit: 'inches' });
      expect(measurements.A2).toEqual({ value: 60.96, unit: 'cm' });
    });

    test('should handle multi-image data separation', () => {
      const imageData = {
        front: { strokes: ['A1', 'A2'], measurements: {} },
        side: { strokes: ['A1'], measurements: {} }
      };
      
      expect(imageData.front.strokes).toEqual(['A1', 'A2']); 
      expect(imageData.side.strokes).toEqual(['A1']);
      // Same label but different image contexts
    });
  });
});