describe('Drawing Workflows Integration Tests', () => {
  let canvas, ctx;

  beforeEach(() => {
    // Setup DOM
    document.body.innerHTML = `
      <canvas id="canvas" width="800" height="600"></canvas>
      <button id="drawingModeToggle">Freehand</button>
      <div id="strokeVisibilityControls"></div>
      <input id="brushSize" type="range" value="5" min="1" max="20">
      <select id="unitSelector">
        <option value="inch">Inches</option>
        <option value="cm">Centimeters</option>
      </select>
      <div id="strokeCounter">Lines: 0</div>
    `;

    canvas = document.getElementById('canvas');
    ctx = canvas.getContext('2d');

    // Initialize required globals
    window.currentImageLabel = 'front';
    window.lineStrokesByImage = { front: [] };
    window.vectorStrokesByImage = { front: {} };
    window.strokeVisibilityByImage = { front: {} };
    window.strokeMeasurements = { front: {} };
    window.strokeLabelVisibility = { front: {} };
    window.imageScaleByLabel = { front: 1.0 };
    window.imagePositionByLabel = { front: { x: 0, y: 0 } };
    window.originalImageDimensions = { front: { width: 800, height: 600 } };

    // Initialize paint app state
    window.paintApp = {
      state: {
        currentImageLabel: 'front',
        drawingMode: 'freehand',
      },
      uiState: {
        drawingMode: 'freehand',
        isDrawing: false,
      },
    };

    // TODO: These tests need rewriting — paint.js was split into manager classes in src/modules/

    // Mock stroke management functions
    window.generateUniqueStrokeName = vi.fn(baseName => {
      if (!baseName) return 'A1';
      const currentStrokes = window.lineStrokesByImage[window.currentImageLabel] || [];
      if (!currentStrokes.includes(baseName)) return baseName;
      let counter = 1;
      let newName = `${baseName}(${counter})`;
      while (currentStrokes.includes(newName)) {
        counter++;
        newName = `${baseName}(${counter})`;
      }
      return newName;
    });

    window.renameStroke = vi.fn((oldName, newName) => {
      const uniqueName = window.generateUniqueStrokeName(newName);
      const currentImage = window.currentImageLabel;
      const strokeIndex = window.lineStrokesByImage[currentImage].indexOf(oldName);
      if (strokeIndex > -1) {
        window.lineStrokesByImage[currentImage][strokeIndex] = uniqueName;
      }
      if (window.vectorStrokesByImage[currentImage][oldName]) {
        window.vectorStrokesByImage[currentImage][uniqueName] =
          window.vectorStrokesByImage[currentImage][oldName];
        delete window.vectorStrokesByImage[currentImage][oldName];
      }
      if (window.strokeMeasurements[currentImage][oldName]) {
        window.strokeMeasurements[currentImage][uniqueName] =
          window.strokeMeasurements[currentImage][oldName];
        delete window.strokeMeasurements[currentImage][oldName];
      }
      if (window.strokeLabelVisibility[currentImage][oldName] !== undefined) {
        window.strokeLabelVisibility[currentImage][uniqueName] =
          window.strokeLabelVisibility[currentImage][oldName];
        delete window.strokeLabelVisibility[currentImage][oldName];
      }
      return uniqueName;
    });

    window.toggleStrokeVisibility = vi.fn((strokeLabel, isVisible) => {
      const currentImage = window.currentImageLabel;
      if (window.strokeVisibilityByImage[currentImage]) {
        window.strokeVisibilityByImage[currentImage][strokeLabel] = isVisible;
      }
    });

    window.deleteStroke = vi.fn(strokeLabel => {
      const currentImage = window.currentImageLabel;
      const strokeIndex = window.lineStrokesByImage[currentImage].indexOf(strokeLabel);
      if (strokeIndex > -1) {
        window.lineStrokesByImage[currentImage].splice(strokeIndex, 1);
      }
      delete window.vectorStrokesByImage[currentImage][strokeLabel];
      delete window.strokeMeasurements[currentImage][strokeLabel];
      delete window.strokeLabelVisibility[currentImage][strokeLabel];
      delete window.strokeVisibilityByImage[currentImage][strokeLabel];
    });

    // Mock measurement parsing functions
    window.parseAndSaveMeasurement = vi.fn((strokeLabel, input) => {
      if (!input || typeof input !== 'string') return false;
      const validPatterns = [
        /^(\d+(?:\.\d+)?)\s*"$/,
        /^(\d+(?:\.\d+)?)\s*inches?$/i,
        /^(\d+(?:\.\d+)?)\s*cm$/i,
        /^(\d+)\s+(\d+\/\d+)"$/,
        /^(\d+(?:\.\d+)?)\s*meters?$/i,
        /^(\d+(?:\.\d+)?)\s*mm$/i,
        /^(\d+(?:\.\d+)?)\s*ft$/i,
        /^(\d+(?:\.\d+)?)\s*yards?$/i,
      ];
      const isValid = validPatterns.some(pattern => pattern.test(input));
      if (!isValid) return false;
      let inches = 0;
      let cm = 0;
      if (input.includes('"') || input.toLowerCase().includes('inch')) {
        const match = input.match(/(\d+(?:\.\d+)?)/);
        inches = match ? parseFloat(match[1]) : 0;
        cm = inches * 2.54;
      } else if (input.toLowerCase().includes('cm')) {
        const match = input.match(/(\d+(?:\.\d+)?)/);
        cm = match ? parseFloat(match[1]) : 0;
        inches = cm / 2.54;
      }
      const inchWhole = Math.floor(inches);
      const inchFraction = parseFloat((inches - inchWhole).toFixed(2));
      window.strokeMeasurements[window.currentImageLabel][strokeLabel] = {
        inchWhole,
        inchFraction,
        cm: parseFloat(cm.toFixed(2)),
      };
      return true;
    });

    window.findClosestFraction = vi.fn(decimal => {
      const fractions = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875];
      let closest = 0;
      let minDiff = Math.abs(decimal - 0);
      fractions.forEach(fraction => {
        const diff = Math.abs(decimal - fraction);
        if (diff < minDiff) {
          minDiff = diff;
          closest = fraction;
        }
      });
      return closest;
    });

    window.convertUnits = vi.fn((from, value) => {
      if (from === 'inch') return value * 2.54;
      if (from === 'cm') return value / 2.54;
      return value;
    });

    window.getMeasurementString = vi.fn(strokeLabel => {
      const measurement = window.strokeMeasurements[window.currentImageLabel][strokeLabel];
      if (!measurement) return null;
      const unitSelector = document.getElementById('unitSelector');
      const unit = unitSelector ? unitSelector.value : 'inch';
      if (unit === 'cm') {
        return `${measurement.cm} cm`;
      } else {
        let result = measurement.inchWhole.toString();
        if (measurement.inchFraction > 0) {
          const fractionMap = {
            0.125: '1/8',
            0.25: '1/4',
            0.375: '3/8',
            0.5: '1/2',
            0.625: '5/8',
            0.75: '3/4',
            0.875: '7/8',
          };
          const rounded = window.findClosestFraction(measurement.inchFraction);
          const closestFraction = fractionMap[rounded];
          if (closestFraction) result += ` ${closestFraction}`;
        }
        return result + '"';
      }
    });
  });

  describe('Straight Line Drawing Workflow', () => {
    test('should handle measurement input after line creation', () => {
      // Create a stroke first
      window.lineStrokesByImage.front.push('A1');
      window.vectorStrokesByImage.front.A1 = {
        points: [
          { x: 100, y: 200 },
          { x: 400, y: 200 },
        ],
        type: 'straight',
        color: '#000000',
        width: 5,
      };

      // Simulate measurement input
      const measurementInput = '24 inches';
      const result = window.parseAndSaveMeasurement('A1', measurementInput);

      expect(result).toBe(true);
      expect(window.strokeMeasurements.front.A1).toBeDefined();
      expect(window.strokeMeasurements.front.A1.inchWhole).toBe(24);
      expect(window.strokeMeasurements.front.A1.cm).toBeCloseTo(60.96, 2);
    });
  });

  describe('Multi-Image Workflow', () => {
    test('should maintain independent strokes per image', () => {
      // Setup multiple images
      const images = ['front', 'side'];
      images.forEach(label => {
        window.lineStrokesByImage[label] = [];
        window.vectorStrokesByImage[label] = {};
        window.strokeMeasurements[label] = {};
        window.strokeVisibilityByImage[label] = {};
      });

      // Draw on first image
      window.currentImageLabel = 'front';
      window.lineStrokesByImage.front.push('A1');
      window.vectorStrokesByImage.front.A1 = {
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        type: 'straight',
        color: '#ff0000',
        width: 5,
      };
      window.strokeMeasurements.front.A1 = {
        inchWhole: 24,
        inchFraction: 0,
        cm: 60.96,
      };

      // Switch to second image
      window.currentImageLabel = 'side';
      window.lineStrokesByImage.side.push('A1');
      window.vectorStrokesByImage.side.A1 = {
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
        ],
        type: 'straight',
        color: '#00ff00',
        width: 3,
      };
      window.strokeMeasurements.side.A1 = {
        inchWhole: 12,
        inchFraction: 0,
        cm: 30.48,
      };

      // Verify independence
      expect(window.strokeMeasurements.front.A1.inchWhole).toBe(24);
      expect(window.strokeMeasurements.side.A1.inchWhole).toBe(12);
      expect(window.vectorStrokesByImage.front.A1.points[1].x).toBe(100);
      expect(window.vectorStrokesByImage.side.A1.points[1].x).toBe(50);
      expect(window.vectorStrokesByImage.front.A1.color).toBe('#ff0000');
      expect(window.vectorStrokesByImage.side.A1.color).toBe('#00ff00');
    });
  });

  describe('Stroke Visibility Management', () => {
    beforeEach(() => {
      // Create test strokes
      ['A1', 'A2', 'B1'].forEach(label => {
        window.lineStrokesByImage.front.push(label);
        window.vectorStrokesByImage.front[label] = {
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 100 },
          ],
          type: 'straight',
          color: '#000000',
          width: 5,
        };
        window.strokeVisibilityByImage.front[label] = true;
      });
    });

    test('should toggle individual stroke visibility', () => {
      // Initially all visible
      expect(window.strokeVisibilityByImage.front.A1).toBe(true);

      // Hide A1
      window.toggleStrokeVisibility('A1', false);
      expect(window.strokeVisibilityByImage.front.A1).toBe(false);

      // Others should remain visible
      expect(window.strokeVisibilityByImage.front.A2).toBe(true);
      expect(window.strokeVisibilityByImage.front.B1).toBe(true);
    });

    test('should handle bulk visibility operations', () => {
      // Hide all strokes
      Object.keys(window.strokeVisibilityByImage.front).forEach(label => {
        window.toggleStrokeVisibility(label, false);
      });

      // Verify all hidden
      expect(window.strokeVisibilityByImage.front.A1).toBe(false);
      expect(window.strokeVisibilityByImage.front.A2).toBe(false);
      expect(window.strokeVisibilityByImage.front.B1).toBe(false);

      // Show all strokes
      Object.keys(window.strokeVisibilityByImage.front).forEach(label => {
        window.toggleStrokeVisibility(label, true);
      });

      // Verify all visible
      expect(window.strokeVisibilityByImage.front.A1).toBe(true);
      expect(window.strokeVisibilityByImage.front.A2).toBe(true);
      expect(window.strokeVisibilityByImage.front.B1).toBe(true);
    });
  });

  describe('Stroke Editing Workflow', () => {
    beforeEach(() => {
      // Create a test stroke
      window.lineStrokesByImage.front.push('A1');
      window.vectorStrokesByImage.front.A1 = {
        points: [
          { x: 100, y: 100 },
          { x: 300, y: 100 },
        ],
        type: 'straight',
        color: '#000000',
        width: 5,
      };
      window.strokeMeasurements.front.A1 = {
        inchWhole: 12,
        inchFraction: 0,
        cm: 30.48,
      };
    });

    test('should rename stroke while preserving data', () => {
      const newName = window.renameStroke('A1', 'CustomLength');

      expect(newName).toBe('CustomLength');
      expect(window.lineStrokesByImage.front).toContain('CustomLength');
      expect(window.lineStrokesByImage.front).not.toContain('A1');

      // Verify data was transferred
      const vectorData = window.vectorStrokesByImage.front.CustomLength;
      expect(vectorData).toBeDefined();
      expect(vectorData.points).toHaveLength(2);
      expect(vectorData.color).toBe('#000000');

      const measurementData = window.strokeMeasurements.front.CustomLength;
      expect(measurementData).toBeDefined();
      expect(measurementData.inchWhole).toBe(12);
    });

    test('should delete stroke and clean up all references', () => {
      expect(window.lineStrokesByImage.front).toContain('A1');

      window.deleteStroke('A1');

      expect(window.lineStrokesByImage.front).not.toContain('A1');
      expect(window.vectorStrokesByImage.front.A1).toBeUndefined();
      expect(window.strokeMeasurements.front.A1).toBeUndefined();
    });
  });

  describe('Unit Conversion Workflow', () => {
    beforeEach(() => {
      // Setup measurement data
      window.strokeMeasurements.front.A1 = {
        inchWhole: 24,
        inchFraction: 0.5,
        cm: 62.23,
      };
      window.strokeMeasurements.front.A2 = {
        inchWhole: 36,
        inchFraction: 0,
        cm: 91.44,
      };
    });

    test('should display measurements in selected unit', () => {
      const unitSelector = document.getElementById('unitSelector');

      // Test inches display
      unitSelector.value = 'inch';
      const inchString = window.getMeasurementString('A1');
      expect(inchString).toContain('24');
      expect(inchString).toContain('1/2');

      // Test centimeters display
      unitSelector.value = 'cm';
      const cmString = window.getMeasurementString('A1');
      expect(cmString).toContain('62.23');
      expect(cmString).toContain('cm');
    });

    test('should convert between units correctly', () => {
      expect(window.convertUnits('inch', 12)).toBeCloseTo(30.48, 2);
      expect(window.convertUnits('cm', 30.48)).toBeCloseTo(12, 2);
    });
  });
});
