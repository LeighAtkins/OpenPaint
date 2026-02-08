/**
 * Coordinate Validation Utilities for AI Worker Integration
 * Validates and serializes stroke data in image-space coordinates
 */

type ImagePoint = {
  x: number;
  y: number;
};

type ImageDimensions = {
  width: number;
  height: number;
};

type ArrowSettings = {
  startArrow?: boolean;
  endArrow?: boolean;
  arrowSize?: number;
};

type VectorStroke = {
  points: ImagePoint[];
  type?: string;
  color?: string;
  width?: number;
  arrowSettings?: ArrowSettings;
};

type SerializedArrowSettings = {
  startArrow: boolean;
  endArrow: boolean;
  arrowSize: number;
};

type SerializedStroke = {
  id: string;
  type: string;
  points: ImagePoint[];
  color: string;
  width: number;
  arrowSettings?: SerializedArrowSettings;
};

type ValidationError = {
  type: string;
  [key: string]: unknown;
};

type TransformParams = {
  scale: number;
  position: ImagePoint;
  dimensions: ImageDimensions;
  rotation: number;
};

type TransformValidation = {
  valid: boolean;
  params: TransformParams | null;
  error: string | null;
};

type WorkerPayload = {
  image: {
    width: number;
    height: number;
    rotation: number;
  };
  units: {
    name: string;
    pxPerUnit: number;
  };
  strokes: SerializedStroke[];
  prompt: string;
  styleGuide: unknown | null;
};

type WorkerPayloadOptions = {
  units?: {
    name: string;
    pxPerUnit: number;
  };
  prompt?: string;
  styleGuide?: unknown | null;
};

declare global {
  interface Window {
    originalImageDimensions?: Record<string, ImageDimensions>;
    vectorStrokesByImage?: Record<string, Record<string, VectorStroke>>;
    imageScaleByLabel?: Record<string, number>;
    imagePositionByLabel?: Record<string, ImagePoint>;
    imageRotationByLabel?: Record<string, number>;
  }
}

/**
 * Validate that a point is within image bounds
 * @param point - Point in image-space
 * @param imageDims - Image dimensions
 * @returns True if point is valid
 */
export function validateImageSpacePoint(point: ImagePoint, imageDims: ImageDimensions): boolean {
  if (!point || typeof point.x !== 'number' || typeof point.y !== 'number') {
    return false;
  }
  return point.x >= 0 && point.x <= imageDims.width && point.y >= 0 && point.y <= imageDims.height;
}

/**
 * Validate an array of points
 * @param points - Points array
 * @param imageDims - Image dimensions
 * @returns Validity and invalid indices
 */
export function validatePointsArray(
  points: ImagePoint[],
  imageDims: ImageDimensions
): { valid: boolean; invalidIndices: number[] } {
  if (!Array.isArray(points) || points.length === 0) {
    return { valid: false, invalidIndices: [] };
  }

  const invalidIndices = [];
  for (let i = 0; i < points.length; i++) {
    if (!validateImageSpacePoint(points[i], imageDims)) {
      invalidIndices.push(i);
    }
  }

  return {
    valid: invalidIndices.length === 0,
    invalidIndices,
  };
}

/**
 * Serialize strokes for AI Worker payload with validation
 * @param imageLabel - Image label to extract strokes from
 * @returns Validated strokes and any errors
 */
export function serializeStrokesForWorker(imageLabel: string): {
  strokes: SerializedStroke[];
  errors: ValidationError[];
} {
  const strokes: SerializedStroke[] = [];
  const errors: ValidationError[] = [];

  // Get image dimensions for validation
  const imageDims = window.originalImageDimensions?.[imageLabel];
  if (!imageDims) {
    errors.push({ type: 'missing_dimensions', imageLabel });
    return { strokes, errors };
  }

  // Get vector strokes for this image
  const vectorData = window.vectorStrokesByImage?.[imageLabel];
  if (!vectorData || typeof vectorData !== 'object') {
    errors.push({ type: 'missing_strokes', imageLabel });
    return { strokes, errors };
  }

  // Process each stroke
  for (const [strokeLabel, stroke] of Object.entries(vectorData)) {
    // Validate stroke structure
    if (!stroke || !stroke.points || !Array.isArray(stroke.points)) {
      errors.push({
        type: 'invalid_stroke_structure',
        strokeLabel,
        reason: 'Missing or invalid points array',
      });
      continue;
    }

    // Validate points are in bounds
    const validation = validatePointsArray(stroke.points, imageDims);
    if (!validation.valid) {
      errors.push({
        type: 'points_out_of_bounds',
        strokeLabel,
        invalidIndices: validation.invalidIndices,
        imageDims,
      });
      // Continue anyway but log the error
    }

    // Serialize stroke in AI Worker format
    const serialized: SerializedStroke = {
      id: strokeLabel,
      type: stroke.type || 'freehand',
      points: stroke.points.map(point => ({ x: point.x, y: point.y })),
      color: stroke.color || '#000000',
      width: stroke.width || 5,
    };

    // Add optional fields
    if (stroke.arrowSettings) {
      serialized.arrowSettings = {
        startArrow: stroke.arrowSettings.startArrow || false,
        endArrow: stroke.arrowSettings.endArrow || false,
        arrowSize: stroke.arrowSettings.arrowSize || 15,
      };
    }

    strokes.push(serialized);
  }

  return { strokes, errors };
}

/**
 * Validate coordinate transformation parameters
 * @param imageLabel - Image label
 * @returns Validation result and params
 */
export function validateTransformParams(imageLabel: string): TransformValidation {
  const scale = window.imageScaleByLabel?.[imageLabel];
  const position = window.imagePositionByLabel?.[imageLabel];
  const dimensions = window.originalImageDimensions?.[imageLabel];
  const rotation = window.imageRotationByLabel?.[imageLabel];

  if (typeof scale !== 'number' || scale <= 0) {
    return { valid: false, params: null, error: 'Invalid or missing scale' };
  }

  if (!position || typeof position.x !== 'number' || typeof position.y !== 'number') {
    return { valid: false, params: null, error: 'Invalid or missing position' };
  }

  if (
    !dimensions ||
    typeof dimensions.width !== 'number' ||
    typeof dimensions.height !== 'number'
  ) {
    return { valid: false, params: null, error: 'Invalid or missing dimensions' };
  }

  return {
    valid: true,
    params: {
      scale,
      position: { x: position.x, y: position.y },
      dimensions: { width: dimensions.width, height: dimensions.height },
      rotation: rotation || 0,
    },
    error: null,
  };
}

/**
 * Create complete AI Worker payload for an image
 * @param imageLabel - Image label
 * @param options - Additional options
 * @returns Worker payload and any errors
 */
export function createWorkerPayload(
  imageLabel: string,
  options: WorkerPayloadOptions = {}
): { payload: WorkerPayload | null; errors: ValidationError[] } {
  const errors: ValidationError[] = [];

  // Validate transform params
  const transformValidation = validateTransformParams(imageLabel);
  if (!transformValidation.valid || !transformValidation.params) {
    errors.push({ type: 'transform_validation', error: transformValidation.error });
    return { payload: null, errors };
  }

  // Serialize strokes
  const { strokes, errors: strokeErrors } = serializeStrokesForWorker(imageLabel);
  errors.push(...strokeErrors);

  if (strokes.length === 0) {
    errors.push({ type: 'no_strokes', imageLabel });
  }

  // Build payload
  const payload: WorkerPayload = {
    image: {
      width: transformValidation.params.dimensions.width,
      height: transformValidation.params.dimensions.height,
      rotation: transformValidation.params.rotation,
    },
    units: options.units || { name: 'cm', pxPerUnit: 37.8 },
    strokes,
    prompt: options.prompt || '',
    styleGuide: options.styleGuide || null,
  };

  return { payload, errors };
}
