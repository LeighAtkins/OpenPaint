describe('Stroke Management Functions', () => {
  beforeEach(() => {
    // Setup stroke data structures
    global.window.currentImageLabel = 'front';
    global.window.lineStrokesByImage = { front: ['A1', 'A2', 'B0'] };
    global.window.vectorStrokesByImage = { front: {} };
    global.window.strokeVisibilityByImage = { front: { A1: true, A2: true, B0: true } };
    global.window.strokeMeasurements = { front: {} };
    global.window.strokeLabelVisibility = { front: {} };
    
    // Mock stroke management functions
    global.window.generateUniqueStrokeName = jest.fn((baseName) => {
      if (!baseName) return 'A1';
      
      const currentStrokes = global.window.lineStrokesByImage[global.window.currentImageLabel] || [];
      if (!currentStrokes.includes(baseName)) {
        return baseName;
      }
      
      let counter = 1;
      let newName = `${baseName}(${counter})`;
      while (currentStrokes.includes(newName)) {
        counter++;
        newName = `${baseName}(${counter})`;
      }
      
      return newName;
    });
    
    global.window.renameStroke = jest.fn((oldName, newName) => {
      const uniqueName = global.window.generateUniqueStrokeName(newName);
      const currentImage = global.window.currentImageLabel;
      
      // Update lineStrokesByImage
      const strokeIndex = global.window.lineStrokesByImage[currentImage].indexOf(oldName);
      if (strokeIndex > -1) {
        global.window.lineStrokesByImage[currentImage][strokeIndex] = uniqueName;
      }
      
      // Update vectorStrokesByImage
      if (global.window.vectorStrokesByImage[currentImage][oldName]) {
        global.window.vectorStrokesByImage[currentImage][uniqueName] = 
          global.window.vectorStrokesByImage[currentImage][oldName];
        delete global.window.vectorStrokesByImage[currentImage][oldName];
      }
      
      // Update strokeMeasurements
      if (global.window.strokeMeasurements[currentImage][oldName]) {
        global.window.strokeMeasurements[currentImage][uniqueName] = 
          global.window.strokeMeasurements[currentImage][oldName];
        delete global.window.strokeMeasurements[currentImage][oldName];
      }
      
      // Update strokeLabelVisibility
      if (global.window.strokeLabelVisibility[currentImage][oldName] !== undefined) {
        global.window.strokeLabelVisibility[currentImage][uniqueName] = 
          global.window.strokeLabelVisibility[currentImage][oldName];
        delete global.window.strokeLabelVisibility[currentImage][oldName];
      }
      
      return uniqueName;
    });
    
    global.window.toggleStrokeVisibility = jest.fn((strokeLabel, isVisible) => {
      const currentImage = global.window.currentImageLabel;
      if (global.window.strokeVisibilityByImage[currentImage]) {
        global.window.strokeVisibilityByImage[currentImage][strokeLabel] = isVisible;
      }
    });
    
    global.window.deleteStroke = jest.fn((strokeLabel) => {
      const currentImage = global.window.currentImageLabel;
      
      // Remove from lineStrokesByImage
      const strokeIndex = global.window.lineStrokesByImage[currentImage].indexOf(strokeLabel);
      if (strokeIndex > -1) {
        global.window.lineStrokesByImage[currentImage].splice(strokeIndex, 1);
      }
      
      // Remove from vectorStrokesByImage
      delete global.window.vectorStrokesByImage[currentImage][strokeLabel];
      
      // Remove from strokeMeasurements
      delete global.window.strokeMeasurements[currentImage][strokeLabel];
      
      // Remove from strokeLabelVisibility
      delete global.window.strokeLabelVisibility[currentImage][strokeLabel];
      
      // Remove from strokeVisibilityByImage
      delete global.window.strokeVisibilityByImage[currentImage][strokeLabel];
    });
    
    global.window.toggleLabelVisibility = jest.fn((strokeLabel) => {
      const currentImage = global.window.currentImageLabel;
      if (!global.window.strokeLabelVisibility[currentImage]) {
        global.window.strokeLabelVisibility[currentImage] = {};
      }
      
      const currentVisibility = global.window.strokeLabelVisibility[currentImage][strokeLabel];
      global.window.strokeLabelVisibility[currentImage][strokeLabel] = !currentVisibility;
    });
  });

  describe('generateUniqueStrokeName', () => {
    test('should generate unique names when conflicts exist', () => {
      expect(global.window.generateUniqueStrokeName('A1')).toBe('A1(1)');
      expect(global.window.generateUniqueStrokeName('NewName')).toBe('NewName');
      
      // Add the generated name and test again
      global.window.lineStrokesByImage.front.push('A1(1)');
      expect(global.window.generateUniqueStrokeName('A1')).toBe('A1(2)');
    });

    test('should handle empty input', () => {
      expect(global.window.generateUniqueStrokeName('')).toBe('A1');
    });

    test('should handle null or undefined input', () => {
      expect(global.window.generateUniqueStrokeName(null)).toBe('A1');
      expect(global.window.generateUniqueStrokeName(undefined)).toBe('A1');
    });

    test('should generate sequential unique names', () => {
      // Add multiple conflicts
      global.window.lineStrokesByImage.front.push('TestName');
      global.window.lineStrokesByImage.front.push('TestName(1)');
      global.window.lineStrokesByImage.front.push('TestName(2)');
      
      expect(global.window.generateUniqueStrokeName('TestName')).toBe('TestName(3)');
    });
  });

  describe('renameStroke', () => {
    beforeEach(() => {
      // Setup vector data and measurements
      global.window.vectorStrokesByImage.front.A1 = { 
        points: [{ x: 0, y: 0 }, { x: 100, y: 100 }], 
        color: '#000000',
        width: 5
      };
      global.window.strokeMeasurements.front.A1 = { 
        inchWhole: 12, 
        inchFraction: 0, 
        cm: 30.48 
      };
      global.window.strokeLabelVisibility.front.A1 = true;
    });

    test('should rename stroke and update all references', () => {
      const newName = global.window.renameStroke('A1', 'CustomName');
      
      expect(newName).toBe('CustomName');
      expect(global.window.lineStrokesByImage.front).toContain('CustomName');
      expect(global.window.lineStrokesByImage.front).not.toContain('A1');
      expect(global.window.vectorStrokesByImage.front.CustomName).toBeDefined();
      expect(global.window.vectorStrokesByImage.front.A1).toBeUndefined();
      expect(global.window.strokeMeasurements.front.CustomName).toBeDefined();
      expect(global.window.strokeMeasurements.front.A1).toBeUndefined();
    });

    test('should handle name conflicts by generating unique name', () => {
      const newName = global.window.renameStroke('A1', 'A2'); // A2 already exists
      
      expect(newName).toBe('A2(1)');
      expect(global.window.lineStrokesByImage.front).toContain('A2(1)');
      expect(global.window.lineStrokesByImage.front).not.toContain('A1');
    });

    test('should handle renaming non-existent stroke', () => {
      const newName = global.window.renameStroke('NonExistent', 'NewName');
      
      expect(newName).toBe('NewName');
      // Should not throw error or cause issues
    });
  });

  describe('toggleStrokeVisibility', () => {
    test('should toggle stroke visibility correctly', () => {
      // Initially visible
      expect(global.window.strokeVisibilityByImage.front.A1).toBe(true);
      
      // Hide stroke
      global.window.toggleStrokeVisibility('A1', false);
      expect(global.window.strokeVisibilityByImage.front.A1).toBe(false);
      
      // Show stroke
      global.window.toggleStrokeVisibility('A1', true);
      expect(global.window.strokeVisibilityByImage.front.A1).toBe(true);
    });

    test('should handle non-existent strokes', () => {
      // Should not throw error
      expect(() => {
        global.window.toggleStrokeVisibility('NonExistent', false);
      }).not.toThrow();
    });

    test('should work with different image labels', () => {
      // Setup another image
      global.window.strokeVisibilityByImage.side = { A1: true };
      
      const originalImageLabel = global.window.currentImageLabel;
      global.window.currentImageLabel = 'side';
      
      global.window.toggleStrokeVisibility('A1', false);
      expect(global.window.strokeVisibilityByImage.side.A1).toBe(false);
      
      // Original should be unchanged
      expect(global.window.strokeVisibilityByImage.front.A1).toBe(true);
      
      global.window.currentImageLabel = originalImageLabel;
    });
  });

  describe('deleteStroke', () => {
    beforeEach(() => {
      // Setup complete stroke data
      global.window.vectorStrokesByImage.front.A1 = { 
        points: [{ x: 0, y: 0 }, { x: 100, y: 100 }],
        color: '#000000',
        width: 5
      };
      global.window.strokeMeasurements.front.A1 = { 
        inchWhole: 12, 
        inchFraction: 0, 
        cm: 30.48 
      };
      global.window.strokeLabelVisibility.front.A1 = true;
    });

    test('should delete stroke and all associated data', () => {
      expect(global.window.lineStrokesByImage.front).toContain('A1');
      
      global.window.deleteStroke('A1');
      
      expect(global.window.lineStrokesByImage.front).not.toContain('A1');
      expect(global.window.vectorStrokesByImage.front.A1).toBeUndefined();
      expect(global.window.strokeMeasurements.front.A1).toBeUndefined();
      expect(global.window.strokeLabelVisibility.front.A1).toBeUndefined();
    });

    test('should handle deleting non-existent stroke', () => {
      expect(() => {
        global.window.deleteStroke('NonExistent');
      }).not.toThrow();
    });

    test('should not affect other strokes', () => {
      const originalA2Data = { 
        points: [{ x: 50, y: 50 }, { x: 150, y: 150 }],
        color: '#ff0000',
        width: 3
      };
      global.window.vectorStrokesByImage.front.A2 = originalA2Data;
      
      global.window.deleteStroke('A1');
      
      expect(global.window.lineStrokesByImage.front).toContain('A2');
      expect(global.window.vectorStrokesByImage.front.A2).toEqual(originalA2Data);
    });
  });

  describe('toggleLabelVisibility', () => {
    test('should toggle label visibility correctly', () => {
      // Set initial state
      global.window.strokeLabelVisibility.front.A1 = true;
      
      global.window.toggleLabelVisibility('A1');
      expect(global.window.strokeLabelVisibility.front.A1).toBe(false);
      
      global.window.toggleLabelVisibility('A1');
      expect(global.window.strokeLabelVisibility.front.A1).toBe(true);
    });

    test('should initialize label visibility if not set', () => {
      delete global.window.strokeLabelVisibility.front.A1;
      
      global.window.toggleLabelVisibility('A1');
      expect(global.window.strokeLabelVisibility.front.A1).toBe(true); // Should be toggled from undefined (falsy)
    });
  });
});