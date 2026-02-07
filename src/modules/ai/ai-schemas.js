/**
 * Type definitions and schemas for AI Worker integration
 * These JSDoc types provide contracts for data exchange between frontend and Worker
 */

/**
 * @typedef {Object} AIStrokeInput
 * @property {string} id - Unique stroke identifier (e.g., 'A1', 'B2')
 * @property {'freehand'|'straight'|'arrow'|'curved'|'curved-arrow'} type - Stroke type
 * @property {Array<{x:number,y:number}>} points - Array of points in image-space coordinates
 * @property {string} color - Hex color string (e.g., '#3b82f6')
 * @property {number} width - Stroke width in pixels
 * @property {AIArrowSettings} [arrowSettings] - Optional arrow configuration
 */

/**
 * @typedef {Object} AIArrowSettings
 * @property {boolean} startArrow - Whether to show arrow at start
 * @property {boolean} endArrow - Whether to show arrow at end
 * @property {number} arrowSize - Arrow size in pixels
 */

/**
 * @typedef {Object} AIImageInfo
 * @property {number} width - Image width in pixels
 * @property {number} height - Image height in pixels
 * @property {number} [rotation] - Image rotation in degrees (0-360)
 */

/**
 * @typedef {Object} AIUnits
 * @property {'cm'|'in'|'mm'|'ft'|'px'} name - Unit name
 * @property {number} [pxPerUnit] - Pixels per unit for measurement conversion
 */

/**
 * @typedef {Object} AIStyleGuide
 * @property {AIColorScheme} colors - Color scheme
 * @property {AIStrokeStyle} stroke - Stroke styling
 * @property {AIFontStyle} fonts - Font styling
 * @property {AILabelStyle} labels - Label styling
 */

/**
 * @typedef {Object} AIColorScheme
 * @property {string} primary - Primary color
 * @property {string} measure - Measurement color
 * @property {string} callout - Callout color
 * @property {string} labelText - Label text color
 */

/**
 * @typedef {Object} AIStrokeStyle
 * @property {number} baseWidth - Base stroke width
 * @property {'round'|'butt'|'square'} cap - Line cap style
 * @property {'round'|'bevel'|'miter'} join - Line join style
 */

/**
 * @typedef {Object} AIFontStyle
 * @property {string} family - Font family
 * @property {number} size - Font size in pixels
 */

/**
 * @typedef {Object} AILabelStyle
 * @property {AILabelBox} box - Label box styling
 * @property {number} offset - Label offset from anchor point
 */

/**
 * @typedef {Object} AILabelBox
 * @property {number} padding - Internal padding
 * @property {string} background - Background color
 * @property {string} borderColor - Border color
 * @property {number} borderWidth - Border width
 * @property {number} radius - Border radius
 */

/**
 * @typedef {Object} GenerateSVGInput
 * @property {AIImageInfo} image - Image information
 * @property {AIUnits} units - Unit configuration
 * @property {AIStrokeInput[]} strokes - Array of strokes to convert
 * @property {string} [prompt] - Optional natural language prompt
 * @property {AIStyleGuide} [styleGuide] - Optional style overrides
 */

/**
 * @typedef {Object} AIVectorOutput
 * @property {string} id - Original stroke ID
 * @property {'line'|'path'|'text'} type - SVG element type
 * @property {Array<{x:number,y:number}>} points - Simplified points
 * @property {AILabelOutput} [label] - Optional label information
 * @property {AIVectorStyle} style - Style information
 */

/**
 * @typedef {Object} AILabelOutput
 * @property {string} text - Label text content
 * @property {number} x - Label X position
 * @property {number} y - Label Y position
 */

/**
 * @typedef {Object} AIVectorStyle
 * @property {string} color - Stroke color
 * @property {number} width - Stroke width
 * @property {'arrow'|'none'} [marker] - Marker type
 */

/**
 * @typedef {Object} AIMeasurement
 * @property {string} id - Stroke ID
 * @property {number} value - Measurement value
 * @property {string} units - Unit name
 */

/**
 * @typedef {Object} AISummary
 * @property {AIMeasurement[]} measurements - Array of measurements
 * @property {AICounts} counts - Element counts
 */

/**
 * @typedef {Object} AICounts
 * @property {number} lines - Number of lines
 * @property {number} [arrows] - Number of arrows
 * @property {number} [labels] - Number of labels
 */

/**
 * @typedef {Object} GenerateSVGOutput
 * @property {string} svg - Complete SVG markup
 * @property {AIVectorOutput[]} vectors - Sidecar vector data for round-trip editing
 * @property {AISummary} summary - Summary information
 */

/**
 * @typedef {Object} AssistMeasurementInput
 * @property {AIUnits} units - Unit configuration
 * @property {AIStrokeInput} stroke - Single stroke to measure
 * @property {AIStyleGuide} [styleGuide] - Optional style overrides
 */

/**
 * @typedef {Object} AssistMeasurementOutput
 * @property {number} value - Computed measurement value
 * @property {string} formatted - Formatted measurement string (e.g., "12.5 cm")
 * @property {{x:number,y:number}} labelPos - Suggested label position
 * @property {number} fontSize - Suggested font size
 * @property {string} [color] - Suggested color
 */

/**
 * @typedef {Object} EnhancePlacementInput
 * @property {AIImageInfo} image - Image information
 * @property {AIStrokeInput[]} strokes - Array of strokes
 * @property {AIStyleGuide} [styleGuide] - Optional style overrides
 */

/**
 * @typedef {Object} EnhancePlacementOutput
 * @property {AIVectorOutput[]} vectorsUpdated - Vectors with updated positions
 * @property {string} [svg] - Optional complete SVG
 */

// Export empty object to make this a module
export {};
