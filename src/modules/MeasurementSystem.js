// Measurement System
// Handles measurement operations with inch/fraction/cm conversions

export class MeasurementSystem {
  // Constants
  static INCHES_TO_CM = 2.54;
  static FRACTION_VALUES = [
    0, 0.0625, 0.125, 0.1875, 0.25, 0.3125, 0.375, 0.4375, 0.5, 0.5625, 0.625, 0.6875, 0.75, 0.8125,
    0.875, 0.9375,
  ];
  static FRACTION_DISPLAY = {
    0: '0',
    0.0625: '1/16',
    0.125: '1/8',
    0.1875: '3/16',
    0.25: '1/4',
    0.3125: '5/16',
    0.375: '3/8',
    0.4375: '7/16',
    0.5: '1/2',
    0.5625: '9/16',
    0.625: '5/8',
    0.6875: '11/16',
    0.75: '3/4',
    0.8125: '13/16',
    0.875: '7/8',
    0.9375: '15/16',
  };

  // Constructor
  constructor(metadataManager) {
    this.metadataManager = metadataManager;
    this.currentUnit = 'inches'; // 'inches' or 'cm'
    this.currentInchDisplayMode = 'decimal'; // 'decimal' or 'fraction'
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

  setInchDisplayMode(mode) {
    this.currentInchDisplayMode = mode === 'fraction' ? 'fraction' : 'decimal';
  }

  getInchDisplayMode() {
    return this.currentInchDisplayMode;
  }

  roundFraction(inchFraction) {
    const numericFraction = Number(inchFraction || 0);
    return this.findClosestFraction(Number.isFinite(numericFraction) ? numericFraction : 0);
  }

  toMeasurementParts(inchWhole, inchFraction) {
    const whole = Math.max(0, parseInt(String(inchWhole || 0), 10) || 0);
    const fraction = this.roundFraction(inchFraction);
    return {
      inchWhole: whole,
      inchFraction: fraction,
      totalInches: whole + fraction,
    };
  }

  formatFractionString(inchWhole, inchFraction, includeUnit = true) {
    const { inchWhole: whole, inchFraction: fraction } = this.toMeasurementParts(
      inchWhole,
      inchFraction
    );
    const suffix = includeUnit ? '"' : '';
    const fractionLabel = MeasurementSystem.FRACTION_DISPLAY[fraction] || '0';

    if (whole === 0 && fraction === 0) return `0${suffix}`;
    if (whole === 0) return `${fractionLabel}${suffix}`;
    if (fraction === 0) return `${whole}${suffix}`;
    return `${whole} ${fractionLabel}${suffix}`;
  }

  formatDecimalInches(totalInches, includeUnit = true, decimalPlaces = 2) {
    const numericValue = Number(totalInches || 0);
    const safeDecimalPlaces = Math.max(0, Number(decimalPlaces) || 0);
    const normalized = Number.isFinite(numericValue)
      ? numericValue.toFixed(safeDecimalPlaces).replace(/\.?0+$/, '')
      : '0';
    return includeUnit ? `${normalized}"` : normalized;
  }

  formatInchValue(inchWhole, inchFraction, options = {}) {
    const includeUnit = options.includeUnit !== false;
    const mode =
      options.mode === 'fraction' || options.mode === 'decimal'
        ? options.mode
        : this.currentInchDisplayMode;
    const parts = this.toMeasurementParts(inchWhole, inchFraction);

    if (mode === 'fraction') {
      return this.formatFractionString(parts.inchWhole, parts.inchFraction, includeUnit);
    }

    return this.formatDecimalInches(parts.totalInches, includeUnit, options.decimalPlaces);
  }

  formatCentimeterValue(cmValue, options = {}) {
    const includeUnit = options.includeUnit !== false;
    const decimalPlaces = Math.max(0, Number(options.decimalPlaces) || 0);
    const trimTrailingZeros = options.trimTrailingZeros !== false;
    const numericValue = Number(cmValue || 0);
    const formatted = Number.isFinite(numericValue) ? numericValue.toFixed(decimalPlaces) : '0';
    const normalized = trimTrailingZeros ? formatted.replace(/\.?0+$/, '') : formatted;
    return includeUnit ? `${normalized} cm` : normalized;
  }

  // Format measurement for display
  formatMeasurement(inchWhole, inchFraction, options = {}) {
    const includeUnit = options.includeUnit !== false;
    if (this.currentUnit === 'inches') {
      return this.formatInchValue(inchWhole, inchFraction, { includeUnit });
    } else {
      const cm =
        typeof options.cmValue === 'number' && Number.isFinite(options.cmValue)
          ? options.cmValue
          : this.convertToCm(inchWhole, inchFraction);
      return this.formatCentimeterValue(cm, {
        includeUnit,
        decimalPlaces: options.decimalPlaces ?? 1,
      });
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
    const { totalInches } = this.toMeasurementParts(inchWhole, inchFraction);
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

  parseMeasurementInput(value, unit = this.currentUnit) {
    const raw = String(value || '').trim();
    if (!raw) return null;

    let totalInches = null;
    let exactCmInput = null;
    const normalizedUnit = unit === 'inch' ? 'inches' : unit;
    const hasExplicitInchMarker = /(?:"|in|inch|inches)\s*$/i.test(raw);
    const hasFractionToken = /\d+\s*\/\s*\d+/.test(raw);

    const cmMatch = raw.match(/^\s*([\d.]+)\s*(cm|centimeter|centimeters)\s*$/i);
    if (cmMatch?.[1]) {
      const cm = parseFloat(cmMatch[1]);
      if (Number.isFinite(cm) && cm >= 0) {
        totalInches = cm / MeasurementSystem.INCHES_TO_CM;
        exactCmInput = cm;
      }
    }

    if (totalInches === null) {
      const inchMatch = raw.match(
        /^\s*(?:(\d+)\s+)?(\d+\s*\/\s*\d+|\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)?\s*$/i
      );
      const shouldTreatAsInches =
        Boolean(inchMatch) &&
        (normalizedUnit !== 'cm' || hasExplicitInchMarker || hasFractionToken);
      if (shouldTreatAsInches && inchMatch) {
        const whole = parseInt(inchMatch[1] || '0', 10) || 0;
        const fractionToken = String(inchMatch[2] || '').replace(/\s+/g, '');
        let fraction = 0;
        if (fractionToken.includes('/')) {
          const [numeratorRaw, denominatorRaw] = fractionToken.split('/');
          const numerator = parseInt(numeratorRaw, 10);
          const denominator = parseInt(denominatorRaw, 10);
          if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0) {
            fraction = numerator / denominator;
          } else {
            return null;
          }
        } else {
          const numeric = parseFloat(fractionToken);
          if (!Number.isFinite(numeric)) return null;
          if (inchMatch[1]) {
            fraction = numeric;
          } else {
            totalInches = numeric;
          }
        }
        if (totalInches === null) {
          totalInches = whole + fraction;
        }
      }
    }

    if (totalInches === null) {
      const plainNumber = parseFloat(raw);
      if (Number.isFinite(plainNumber) && plainNumber >= 0) {
        if (normalizedUnit === 'cm') {
          totalInches = plainNumber / MeasurementSystem.INCHES_TO_CM;
          exactCmInput = plainNumber;
        } else {
          totalInches = plainNumber;
        }
      }
    }

    if (!Number.isFinite(totalInches) || totalInches === null || totalInches < 0) {
      return null;
    }

    const inchWhole = Math.floor(totalInches);
    const inchFraction = this.findClosestFraction(totalInches - inchWhole);
    // When the input was a CM value, preserve the exact value instead of
    // recalculating from the fraction-rounded inches (avoids rounding error
    // e.g. 129 cm → 50 13/16" → 129.06 cm).
    const cm = exactCmInput !== null ? exactCmInput : this.convertToCm(inchWhole, inchFraction);
    return {
      inchWhole,
      inchFraction,
      cm: parseFloat(cm.toFixed(4)),
      totalInches: parseFloat((inchWhole + inchFraction).toFixed(4)),
    };
  }

  formatInchInputValue(inchWhole, inchFraction) {
    return this.formatInchValue(inchWhole, inchFraction, { includeUnit: false });
  }

  // Get formatted measurement string for a stroke
  getMeasurementString(imageLabel, strokeLabel) {
    const measurement = this.getMeasurement(imageLabel, strokeLabel);
    if (!measurement) {
      return '';
    }

    return this.formatMeasurement(measurement.inchWhole, measurement.inchFraction, {
      cmValue: measurement.cm,
    });
  }

  // Set measurement for a stroke
  setMeasurement(imageLabel, strokeLabel, inchWhole, inchFraction, options = {}) {
    const { inchWhole: whole, inchFraction: fraction } = this.toMeasurementParts(
      inchWhole,
      inchFraction
    );
    const cm =
      typeof options.cmValue === 'number' && Number.isFinite(options.cmValue)
        ? options.cmValue
        : this.convertToCm(whole, fraction);
    const measurement = {
      inchWhole: whole,
      inchFraction: fraction,
      cm: parseFloat(cm.toFixed(4)),
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
      MeasurementSystem.FRACTION_VALUES.includes(this.roundFraction(measurement.inchFraction))
    );
  }

  // Get all measurements for an image as formatted list
  getFormattedMeasurementsList(imageLabel) {
    const measurements = this.metadataManager.strokeMeasurements[imageLabel] || {};
    const result = [];

    for (const [strokeLabel, measurement] of Object.entries(measurements)) {
      if (this.validateMeasurement(measurement)) {
        const formatted = this.formatMeasurement(measurement.inchWhole, measurement.inchFraction, {
          cmValue: measurement.cm,
        });
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
