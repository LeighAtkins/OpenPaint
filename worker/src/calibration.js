/**
 * Calibration Module
 * Handles pixel-to-real-world unit conversion
 */

/**
 * Compute pixels per unit from calibration data
 * @param {Object} calibration - Calibration object with name, pixels, real, unit
 * @returns {{pxPerUnit: number, unit: string}}
 */
export function computePxPerUnit(calibration) {
  const { name, pixels, real, unit } = calibration;
  
  if (!real || real <= 0) {
    throw new Error('Invalid calibration data: real value required');
  }
  
  let pxPerUnit;
  
  switch (name) {
    case 'overall_width':
      // For overall width, if pixels is null, we'll use a default width
      // In a real implementation, this would come from silhouette detection
      const detectedPixels = pixels || 500; // Default fallback
      pxPerUnit = detectedPixels / real;
      break;
      
    case 'custom':
      if (Array.isArray(pixels)) {
        // Custom line with start/end points [x1, y1, x2, y2]
        const [x1, y1, x2, y2] = pixels;
        const pixelDistance = Math.hypot(x2 - x1, y2 - y1);
        pxPerUnit = pixelDistance / real;
      } else {
        // Custom line with pixel length
        pxPerUnit = pixels / real;
      }
      break;
      
    default:
      throw new Error(`Unknown calibration type: ${name}`);
  }
  
  if (pxPerUnit <= 0 || !isFinite(pxPerUnit)) {
    throw new Error('Invalid calibration result: pxPerUnit must be positive and finite');
  }
  
  return {
    pxPerUnit,
    unit: unit || 'cm'
  };
}

/**
 * Format dimension value according to unit
 * @param {number} value - Dimension value
 * @param {string} unit - Unit (cm, mm, in)
 * @returns {string} Formatted dimension string
 */
export function formatDimension(value, unit) {
  if (!isFinite(value) || value < 0) {
    return '0';
  }
  
  switch (unit) {
    case 'cm':
      return `${value.toFixed(1)} cm`;
      
    case 'mm':
      return `${Math.round(value)} mm`;
      
    case 'in':
      return formatInches(value);
      
    default:
      return `${value.toFixed(1)} ${unit}`;
  }
}

/**
 * Format inches with fractions
 * @param {number} inches - Value in inches
 * @returns {string} Formatted inches string
 */
function formatInches(inches) {
  if (inches >= 36) {
    // Convert to feet and inches
    const feet = Math.floor(inches / 12);
    const remainingInches = inches % 12;
    if (remainingInches === 0) {
      return `${feet}'`;
    } else {
      return `${feet}' ${formatInches(remainingInches)}`;
    }
  }
  
  // Convert to fraction
  const whole = Math.floor(inches);
  const fraction = inches - whole;
  
  if (fraction === 0) {
    return `${whole}"`;
  }
  
  // Find closest fraction (1/8 or 1/16)
  const fractionMap = {
    0.125: '1/8',
    0.25: '1/4',
    0.375: '3/8',
    0.5: '1/2',
    0.625: '5/8',
    0.75: '3/4',
    0.875: '7/8'
  };
  
  // Find closest fraction
  let closestFraction = '';
  let minDiff = Infinity;
  
  for (const [decimal, frac] of Object.entries(fractionMap)) {
    const diff = Math.abs(fraction - parseFloat(decimal));
    if (diff < minDiff) {
      minDiff = diff;
      closestFraction = frac;
    }
  }
  
  if (whole === 0) {
    return `${closestFraction}"`;
  } else {
    return `${whole} ${closestFraction}"`;
  }
}

/**
 * Convert between units
 * @param {number} value - Value to convert
 * @param {string} fromUnit - Source unit
 * @param {string} toUnit - Target unit
 * @returns {number} Converted value
 */
export function convertUnits(value, fromUnit, toUnit) {
  if (fromUnit === toUnit) return value;
  
  // Convert to cm first
  let valueInCm;
  switch (fromUnit) {
    case 'cm':
      valueInCm = value;
      break;
    case 'mm':
      valueInCm = value / 10;
      break;
    case 'in':
      valueInCm = value * 2.54;
      break;
    default:
      throw new Error(`Unknown source unit: ${fromUnit}`);
  }
  
  // Convert from cm to target unit
  switch (toUnit) {
    case 'cm':
      return valueInCm;
    case 'mm':
      return valueInCm * 10;
    case 'in':
      return valueInCm / 2.54;
    default:
      throw new Error(`Unknown target unit: ${toUnit}`);
  }
}
