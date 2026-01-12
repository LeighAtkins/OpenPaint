describe.skip('Drawing Workflows Integration Tests', () => {
  let canvas, ctx;

  beforeEach(async () => {
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

    // Load the paint.js functions
    await import('../../public/js/paint.js');
  });

  describe('Straight Line Drawing Workflow', () => {
    test('should create straight line with measurement input', async () => {
      // Given: Switch to straight line mode
      const modeToggle = document.getElementById('drawingModeToggle');
      modeToggle.click(); // Switch to straight line
      expect(modeToggle.textContent).toBe('Straight Line');

      // When: Draw a line from point A to point B
      const mousedown = new MouseEvent('mousedown', {
        clientX: 100,
        clientY: 200,
        offsetX: 100,
        offsetY: 200,
        bubbles: true,
      });
      const mouseup = new MouseEvent('mouseup', {
        clientX: 400,
        clientY: 200,
        offsetX: 400,
        offsetY: 200,
        bubbles: true,
      });

      canvas.dispatchEvent(mousedown);
      await new Promise(resolve => setTimeout(resolve, 10));
      canvas.dispatchEvent(mouseup);

      // Then: Verify line creation
      expect(window.lineStrokesByImage.front).toHaveLength(1);
      expect(window.lineStrokesByImage.front[0]).toBe('A1');

      // Verify vector data
      const vectorData = window.vectorStrokesByImage.front.A1;
      expect(vectorData).toBeDefined();
      expect(vectorData.type).toBe('straight');
      expect(vectorData.points).toHaveLength(2);
      expect(vectorData.points[0].x).toBeCloseTo(100, 1);
      expect(vectorData.points[0].y).toBeCloseTo(200, 1);
      expect(vectorData.points[1].x).toBeCloseTo(400, 1);
      expect(vectorData.points[1].y).toBeCloseTo(200, 1);
    });

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
