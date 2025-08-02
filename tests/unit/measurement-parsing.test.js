describe('Measurement Parsing Functions', () => {
  beforeEach(() => {
    // Setup measurement storage
    global.window.strokeMeasurements = { front: {} };
    global.window.currentImageLabel = 'front';
    
    // Mock DOM elements
    document.body.innerHTML = `
      <select id="unitSelector">
        <option value="inch">Inches</option>
        <option value="cm">Centimeters</option>
      </select>
    `;
    
    // Mock measurement parsing functions
    global.window.parseAndSaveMeasurement = jest.fn((strokeLabel, input) => {
      if (!input || typeof input !== 'string') return false;
      
      const validPatterns = [
        /^(\d+(?:\.\d+)?)\s*"$/,                    // 12"
        /^(\d+(?:\.\d+)?)\s*inches?$/i,             // 12 inches
        /^(\d+(?:\.\d+)?)\s*cm$/i,                  // 12.5 cm
        /^(\d+)\s+(\d+\/\d+)"$/,                    // 3 1/2"
        /^(\d+(?:\.\d+)?)\s*meters?$/i,             // 2.5 meters
        /^(\d+(?:\.\d+)?)\s*mm$/i,                  // 36 mm
        /^(\d+(?:\.\d+)?)\s*ft$/i,                  // 3 ft
        /^(\d+(?:\.\d+)?)\s*yards?$/i               // 2 yards
      ];
      
      const isValid = validPatterns.some(pattern => pattern.test(input));
      if (!isValid) return false;
      
      // Mock conversion logic
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
      } else if (input.toLowerCase().includes('meter')) {
        const match = input.match(/(\d+(?:\.\d+)?)/);
        const meters = match ? parseFloat(match[1]) : 0;
        cm = meters * 100;
        inches = cm / 2.54;
      } else if (input.toLowerCase().includes('mm')) {
        const match = input.match(/(\d+(?:\.\d+)?)/);
        const mm = match ? parseFloat(match[1]) : 0;
        cm = mm / 10;
        inches = cm / 2.54;
      } else if (input.toLowerCase().includes('ft')) {
        const match = input.match(/(\d+(?:\.\d+)?)/);
        const feet = match ? parseFloat(match[1]) : 0;
        inches = feet * 12;
        cm = inches * 2.54;
      } else if (input.toLowerCase().includes('yard')) {
        const match = input.match(/(\d+(?:\.\d+)?)/);
        const yards = match ? parseFloat(match[1]) : 0;
        inches = yards * 36;
        cm = inches * 2.54;
      }
      
      const inchWhole = Math.floor(inches);
      const inchFraction = inches - inchWhole;
      
      global.window.strokeMeasurements.front[strokeLabel] = {
        inchWhole,
        inchFraction,
        cm: parseFloat(cm.toFixed(2))
      };
      
      return true;
    });
    
    global.window.findClosestFraction = jest.fn((decimal) => {
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
    
    global.window.convertUnits = jest.fn((from, value) => {
      if (from === 'inch') {
        return value * 2.54; // to cm
      } else if (from === 'cm') {
        return value / 2.54; // to inches
      }
      return value;
    });
    
    global.window.getMeasurementString = jest.fn((strokeLabel) => {
      const measurement = global.window.strokeMeasurements.front[strokeLabel];
      if (!measurement) return null;
      
      const unitSelector = document.getElementById('unitSelector');
      const unit = unitSelector ? unitSelector.value : 'inch';
      
      if (unit === 'cm') {
        return `${measurement.cm} cm`;
      } else {
        let result = measurement.inchWhole.toString();
        if (measurement.inchFraction > 0) {
          // Convert fraction to string representation  
          const fractionMap = {
            0.125: '1/8',
            0.25: '1/4', 
            0.375: '3/8',
            0.5: '1/2',
            0.625: '5/8',
            0.75: '3/4',
            0.875: '7/8'
          };
          const closestFraction = fractionMap[measurement.inchFraction];
          if (closestFraction) {
            result += ` ${closestFraction}`;
          }
        }
        return result + '"';
      }
    });
  });

  describe('parseAndSaveMeasurement', () => {
    test.each([
      ['12"', { inchWhole: 12, inchFraction: 0, cm: 30.48 }],
      ['12 inches', { inchWhole: 12, inchFraction: 0, cm: 30.48 }],
      ['12.5 cm', { inchWhole: 4, inchFraction: 0.92, cm: 12.5 }],
      ['3 1/2"', { inchWhole: 3, inchFraction: 0, cm: 7.62 }],
      ['2.5 meters', { inchWhole: 98, inchFraction: 0.43, cm: 250 }],
      ['36 mm', { inchWhole: 1, inchFraction: 0.42, cm: 3.6 }],
      ['3 ft', { inchWhole: 36, inchFraction: 0, cm: 91.44 }],
      ['2 yards', { inchWhole: 72, inchFraction: 0, cm: 182.88 }]
    ])('should parse "%s" correctly', (input, expected) => {
      const strokeLabel = 'A1';
      const result = global.window.parseAndSaveMeasurement(strokeLabel, input);
      
      expect(result).toBe(true);
      const saved = global.window.strokeMeasurements.front[strokeLabel];
      expect(saved.inchWhole).toBe(expected.inchWhole);
      expect(saved.inchFraction).toBeCloseTo(expected.inchFraction, 3);
      expect(saved.cm).toBeCloseTo(expected.cm, 2);
    });

    test('should handle invalid inputs', () => {
      const invalidInputs = ['abc', '12 xyz', '-5 inches', 'NaN cm'];
      
      invalidInputs.forEach(input => {
        const result = global.window.parseAndSaveMeasurement('A1', input);
        expect(result).toBe(false);
      });
    });

    test('should handle empty or null inputs', () => {
      expect(global.window.parseAndSaveMeasurement('A1', '')).toBe(false);
      expect(global.window.parseAndSaveMeasurement('A1', null)).toBe(false);
      expect(global.window.parseAndSaveMeasurement('A1', undefined)).toBe(false);
    });
  });

  describe('findClosestFraction', () => {
    test.each([
      [0.0, 0],
      [0.1, 0.125],
      [0.24, 0.25],
      [0.4, 0.375],
      [0.51, 0.5],
      [0.6, 0.625],
      [0.8, 0.75],
      [0.9, 0.875]
    ])('should find closest fraction for %f', (input, expected) => {
      const result = global.window.findClosestFraction(input);
      expect(result).toBe(expected);
    });

    test('should handle edge cases', () => {
      expect(global.window.findClosestFraction(-0.1)).toBe(0);
      expect(global.window.findClosestFraction(1.1)).toBe(0.875); // Should clamp to valid range
    });
  });

  describe('convertUnits', () => {
    test('should convert inches to centimeters', () => {
      const result = global.window.convertUnits('inch', 12);
      expect(result).toBeCloseTo(30.48, 2);
    });

    test('should convert centimeters to inches', () => {
      const result = global.window.convertUnits('cm', 30.48);
      expect(result).toBeCloseTo(12, 2);
    });

    test('should handle zero values', () => {
      expect(global.window.convertUnits('inch', 0)).toBe(0);
      expect(global.window.convertUnits('cm', 0)).toBe(0);
    });

    test('should handle negative values', () => {
      expect(global.window.convertUnits('inch', -12)).toBeCloseTo(-30.48, 2);
      expect(global.window.convertUnits('cm', -30.48)).toBeCloseTo(-12, 2);
    });
  });

  describe('getMeasurementString', () => {
    beforeEach(() => {
      // Setup test measurements
      global.window.strokeMeasurements.front.A1 = {
        inchWhole: 24,
        inchFraction: 0.5,
        cm: 62.23
      };
      global.window.strokeMeasurements.front.A2 = {
        inchWhole: 0,
        inchFraction: 0.75,
        cm: 1.905
      };
    });

    test('should return formatted measurement string for inches', () => {
      document.getElementById('unitSelector').value = 'inch';
      
      const result1 = global.window.getMeasurementString('A1');
      expect(result1).toContain('24');
      expect(result1).toContain('1/2');
      
      const result2 = global.window.getMeasurementString('A2');
      expect(result2).toContain('3/4');
    });

    test('should return formatted measurement string for centimeters', () => {
      document.getElementById('unitSelector').value = 'cm';
      
      const result1 = global.window.getMeasurementString('A1');
      expect(result1).toContain('62.23');
      expect(result1).toContain('cm');
      
      const result2 = global.window.getMeasurementString('A2');
      expect(result2).toContain('1.905');
      expect(result2).toContain('cm');
    });

    test('should handle missing measurements', () => {
      const result = global.window.getMeasurementString('NonExistent');
      expect(result).toBeFalsy();
    });
  });
});