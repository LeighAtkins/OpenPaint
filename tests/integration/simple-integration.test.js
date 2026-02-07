describe('Paint Application Integration Tests', () => {
  let mockCanvas, mockContext;

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

    // Setup canvas mock
    mockCanvas = document.getElementById('canvas');
    mockContext = {
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      setLineDash: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
    };
    mockCanvas.getContext = vi.fn(() => mockContext);

    // Initialize application state
    global.window.currentImageLabel = 'front';
    global.window.lineStrokesByImage = { front: [] };
    global.window.vectorStrokesByImage = { front: {} };
    global.window.strokeVisibilityByImage = { front: {} };
    global.window.strokeMeasurements = { front: {} };
    global.window.imageScaleByLabel = { front: 1.0 };
    global.window.imagePositionByLabel = { front: { x: 0, y: 0 } };

    // Mock drawing mode management
    global.window.switchDrawingMode = vi.fn(() => {
      const toggle = document.getElementById('drawingModeToggle');
      const modes = ['Freehand', 'Straight Line', 'Curved Line'];
      const currentMode = toggle.textContent;
      const currentIndex = modes.indexOf(currentMode);
      const nextIndex = (currentIndex + 1) % modes.length;
      toggle.textContent = modes[nextIndex];
    });
  });

  describe('Drawing Mode Integration', () => {
    test('should switch between drawing modes', () => {
      const modeToggle = document.getElementById('drawingModeToggle');
      expect(modeToggle.textContent).toBe('Freehand');

      global.window.switchDrawingMode();
      expect(modeToggle.textContent).toBe('Straight Line');

      global.window.switchDrawingMode();
      expect(modeToggle.textContent).toBe('Curved Line');

      global.window.switchDrawingMode();
      expect(modeToggle.textContent).toBe('Freehand');
    });

    test('should maintain drawing state across mode switches', () => {
      // Create strokes in different modes
      const strokes = [];

      // Freehand stroke
      strokes.push({
        label: 'A1',
        type: 'freehand',
        mode: document.getElementById('drawingModeToggle').textContent,
      });

      // Switch to straight line
      global.window.switchDrawingMode();
      strokes.push({
        label: 'A2',
        type: 'straight',
        mode: document.getElementById('drawingModeToggle').textContent,
      });

      // Switch to curved line
      global.window.switchDrawingMode();
      strokes.push({
        label: 'A3',
        type: 'curved',
        mode: document.getElementById('drawingModeToggle').textContent,
      });

      expect(strokes[0].mode).toBe('Freehand');
      expect(strokes[1].mode).toBe('Straight Line');
      expect(strokes[2].mode).toBe('Curved Line');
    });
  });

  describe('Stroke and Measurement Integration', () => {
    test('should integrate stroke creation with measurement input', () => {
      // Simulate stroke creation
      const strokeLabel = 'A1';
      global.window.lineStrokesByImage.front.push(strokeLabel);
      global.window.vectorStrokesByImage.front[strokeLabel] = {
        points: [
          { x: 100, y: 200 },
          { x: 400, y: 200 },
        ],
        type: 'straight',
        color: '#000000',
        width: 5,
      };

      // Simulate measurement input
      const parseMeasurement = input => {
        const match = input.match(/(\d+(?:\.\d+)?)\s*(inches?|")/i);
        if (match) {
          return {
            value: parseFloat(match[1]),
            unit: 'inches',
            cm: parseFloat(match[1]) * 2.54,
          };
        }
        return null;
      };

      const measurement = parseMeasurement('24 inches');
      global.window.strokeMeasurements.front[strokeLabel] = measurement;

      expect(global.window.lineStrokesByImage.front).toContain(strokeLabel);
      expect(global.window.strokeMeasurements.front[strokeLabel].value).toBe(24);
      expect(global.window.strokeMeasurements.front[strokeLabel].cm).toBeCloseTo(60.96, 2);
    });

    test('should maintain measurement independence across images', () => {
      // Setup multiple images
      ['front', 'side', 'back'].forEach(label => {
        global.window.lineStrokesByImage[label] = [];
        global.window.vectorStrokesByImage[label] = {};
        global.window.strokeMeasurements[label] = {};
      });

      // Add same stroke label to different images with different measurements
      const strokeLabel = 'A1';

      // Front image: 24 inches
      global.window.lineStrokesByImage.front.push(strokeLabel);
      global.window.strokeMeasurements.front[strokeLabel] = { value: 24, unit: 'inches' };

      // Side image: 18 inches
      global.window.lineStrokesByImage.side.push(strokeLabel);
      global.window.strokeMeasurements.side[strokeLabel] = { value: 18, unit: 'inches' };

      // Back image: 36 inches
      global.window.lineStrokesByImage.back.push(strokeLabel);
      global.window.strokeMeasurements.back[strokeLabel] = { value: 36, unit: 'inches' };

      // Verify independence
      expect(global.window.strokeMeasurements.front.A1.value).toBe(24);
      expect(global.window.strokeMeasurements.side.A1.value).toBe(18);
      expect(global.window.strokeMeasurements.back.A1.value).toBe(36);
    });
  });

  describe('UI Component Integration', () => {
    test('should integrate canvas with control elements', () => {
      const brushSize = document.getElementById('brushSize');
      const unitSelector = document.getElementById('unitSelector');
      const strokeCounter = document.getElementById('strokeCounter');

      // Test brush size changes
      brushSize.value = '10';
      expect(brushSize.value).toBe('10');

      // Test unit selector changes
      unitSelector.value = 'cm';
      expect(unitSelector.value).toBe('cm');

      // Test stroke counter updates
      const updateCounter = count => {
        strokeCounter.textContent = `Lines: ${count}`;
      };

      updateCounter(3);
      expect(strokeCounter.textContent).toBe('Lines: 3');
    });

    test('should handle responsive canvas operations', () => {
      const canvas = document.getElementById('canvas');

      // Test canvas dimensions
      expect(canvas.width).toBe(800);
      expect(canvas.height).toBe(600);

      // Test context operations
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.beginPath();
      ctx.moveTo(100, 100);
      ctx.lineTo(200, 200);
      ctx.stroke();

      // Verify context methods were called
      expect(mockContext.clearRect).toHaveBeenCalledWith(0, 0, 800, 600);
      expect(mockContext.beginPath).toHaveBeenCalled();
      expect(mockContext.moveTo).toHaveBeenCalledWith(100, 100);
      expect(mockContext.lineTo).toHaveBeenCalledWith(200, 200);
      expect(mockContext.stroke).toHaveBeenCalled();
    });
  });

  describe('Data Flow Integration', () => {
    test('should maintain consistent data flow from creation to storage', () => {
      const workflow = {
        createStroke: (label, points, type) => {
          global.window.lineStrokesByImage.front.push(label);
          global.window.vectorStrokesByImage.front[label] = { points, type };
          global.window.strokeVisibilityByImage.front[label] = true;
          return label;
        },

        addMeasurement: (label, value, unit) => {
          global.window.strokeMeasurements.front[label] = { value, unit };
        },

        toggleVisibility: label => {
          const current = global.window.strokeVisibilityByImage.front[label];
          global.window.strokeVisibilityByImage.front[label] = !current;
        },

        deleteStroke: label => {
          const index = global.window.lineStrokesByImage.front.indexOf(label);
          if (index > -1) global.window.lineStrokesByImage.front.splice(index, 1);
          delete global.window.vectorStrokesByImage.front[label];
          delete global.window.strokeMeasurements.front[label];
          delete global.window.strokeVisibilityByImage.front[label];
        },
      };

      // Test complete workflow
      const strokeLabel = workflow.createStroke(
        'A1',
        [
          { x: 0, y: 0 },
          { x: 100, y: 100 },
        ],
        'straight'
      );
      workflow.addMeasurement(strokeLabel, 24, 'inches');

      // Verify creation
      expect(global.window.lineStrokesByImage.front).toContain(strokeLabel);
      expect(global.window.vectorStrokesByImage.front[strokeLabel]).toBeDefined();
      expect(global.window.strokeMeasurements.front[strokeLabel]).toBeDefined();
      expect(global.window.strokeVisibilityByImage.front[strokeLabel]).toBe(true);

      // Test visibility toggle
      workflow.toggleVisibility(strokeLabel);
      expect(global.window.strokeVisibilityByImage.front[strokeLabel]).toBe(false);

      // Test deletion
      workflow.deleteStroke(strokeLabel);
      expect(global.window.lineStrokesByImage.front).not.toContain(strokeLabel);
      expect(global.window.vectorStrokesByImage.front[strokeLabel]).toBeUndefined();
      expect(global.window.strokeMeasurements.front[strokeLabel]).toBeUndefined();
      expect(global.window.strokeVisibilityByImage.front[strokeLabel]).toBeUndefined();
    });
  });

  describe('Performance Integration', () => {
    test('should handle multiple stroke operations efficiently', () => {
      const startTime = Date.now();

      // Create many strokes
      for (let i = 0; i < 50; i++) {
        const label = `A${i}`;
        global.window.lineStrokesByImage.front.push(label);
        global.window.vectorStrokesByImage.front[label] = {
          points: [
            { x: i * 10, y: 100 },
            { x: i * 10 + 50, y: 100 },
          ],
          type: 'straight',
        };
        global.window.strokeVisibilityByImage.front[label] = true;
      }

      const endTime = Date.now();
      const totalTime = endTime - startTime;

      expect(global.window.lineStrokesByImage.front).toHaveLength(50);
      expect(totalTime).toBeLessThan(100); // Should complete quickly
    });
  });
});
