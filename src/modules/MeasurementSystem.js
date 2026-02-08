// Measurement System
// Handles measurement operations with inch/fraction/cm conversions

export class MeasurementSystem {
  // Constants
  static INCHES_TO_CM = 2.54;
  static FRACTION_VALUES = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875];
  static FRACTION_DISPLAY = {
    0: '0',
    0.125: '1/8',
    0.25: '1/4',
    0.375: '3/8',
    0.5: '1/2',
    0.625: '5/8',
    0.75: '3/4',
    0.875: '7/8',
  };

  // Constructor
  constructor(metadataManager) {
    this.metadataManager = metadataManager;
    this.currentUnit = 'inches'; // 'inches' or 'cm'
  }

  // Set display unit
  setUnit(unit) {
    const normalizedUnit = unit === 'inch' ? 'inches' : unit;
    if (normalizedUnit !== 'inches' && normalizedUnit !== 'cm') {
      console.warn(`Invalid unit: ${unit}. Defaulting to inches.`);
      this.currentUnit = 'inches';
      return;
    }
    this.currentUnit = normalizedUnit;
  }

  // Get current unit
  getUnit() {
    return this.currentUnit;
  }

  // Format measurement for display
  formatMeasurement(inchWhole, inchFraction) {
    if (this.currentUnit === 'inches') {
      const fraction = MeasurementSystem.FRACTION_DISPLAY[inchFraction] || '0';
      if (inchWhole === 0 && inchFraction === 0) {
        return '0"';
      } else if (inchWhole === 0) {
        return `${fraction}"`;
      } else if (inchFraction === 0) {
        return `${inchWhole}"`;
      } else {
        return `${inchWhole} ${fraction}"`;
      }
    } else {
      const cm = this.convertToCm(inchWhole, inchFraction);
      return `${cm.toFixed(1)} cm`;
    }
  }

  // Find the closest fraction to a decimal part
  findClosestFraction(decimalPart) {
    let closest = 0;
    let minDiff = Math.abs(decimalPart);

    for (const fraction of MeasurementSystem.FRACTION_VALUES) {
      const diff = Math.abs(decimalPart - fraction);
      if (diff < minDiff) {
        minDiff = diff;
        closest = fraction;
      }
    }

    return closest;
  }

  // Convert inches to cm
  convertToCm(inchWhole, inchFraction) {
    const totalInches = inchWhole + inchFraction;
    return totalInches * MeasurementSystem.INCHES_TO_CM;
  }

  // Convert cm to inches (returns {inchWhole, inchFraction})
  convertFromCm(cm) {
    const totalInches = cm / MeasurementSystem.INCHES_TO_CM;
    const inchWhole = Math.floor(totalInches);
    const decimalPart = totalInches - inchWhole;
    const inchFraction = this.findClosestFraction(decimalPart);

    return { inchWhole, inchFraction };
  }

  // Get formatted measurement string for a stroke
  getMeasurementString(imageLabel, strokeLabel) {
    const measurement = this.getMeasurement(imageLabel, strokeLabel);
    if (!measurement) {
      return '';
    }

    return this.formatMeasurement(measurement.inchWhole, measurement.inchFraction);
  }

  // Set measurement for a stroke
  setMeasurement(imageLabel, strokeLabel, inchWhole, inchFraction) {
    const cm = this.convertToCm(inchWhole, inchFraction);
    const measurement = {
      inchWhole: inchWhole,
      inchFraction: inchFraction,
      cm: cm,
    };

    this.metadataManager.setMeasurement(imageLabel, strokeLabel, measurement);
  }

  // Get measurement for a stroke
  getMeasurement(imageLabel, strokeLabel) {
    return this.metadataManager.getMeasurement(imageLabel, strokeLabel);
  }

  // Validate measurement data structure
  validateMeasurement(measurement) {
    if (!measurement) return false;

    return (
      typeof measurement.inchWhole === 'number' &&
      typeof measurement.inchFraction === 'number' &&
      typeof measurement.cm === 'number' &&
      measurement.inchWhole >= 0 &&
      MeasurementSystem.FRACTION_VALUES.includes(measurement.inchFraction)
    );
  }

  // Get all measurements for an image as formatted list
  getFormattedMeasurementsList(imageLabel) {
    const measurements = this.metadataManager.strokeMeasurements[imageLabel] || {};
    const result = [];

    for (const [strokeLabel, measurement] of Object.entries(measurements)) {
      if (this.validateMeasurement(measurement)) {
        const formatted = this.formatMeasurement(measurement.inchWhole, measurement.inchFraction);
        result.push({
          label: strokeLabel,
          measurement: formatted,
          inchWhole: measurement.inchWhole,
          inchFraction: measurement.inchFraction,
          cm: measurement.cm,
        });
      }
    }

    // Sort by label
    result.sort((a, b) => a.label.localeCompare(b.label));

    return result;
  }

  // Clear all measurements for an image
  clearMeasurements(imageLabel) {
    if (this.metadataManager.strokeMeasurements[imageLabel]) {
      delete this.metadataManager.strokeMeasurements[imageLabel];
    }
  }
}
