/**
 * Type definitions and schemas for AI Worker integration
 * These JSDoc types provide contracts for data exchange between frontend and Worker
 */

export interface AIPoint {
  x: number;
  y: number;
}

export interface AIArrowSettings {
  startArrow: boolean;
  endArrow: boolean;
  arrowSize: number;
}

export interface AIStrokeInput {
  /** Unique stroke identifier (e.g., 'A1', 'B2') */
  id: string;
  /** Stroke type */
  type: 'freehand' | 'straight' | 'arrow' | 'curved' | 'curved-arrow';
  /** Array of points in image-space coordinates */
  points: AIPoint[];
  /** Hex color string (e.g., '#3b82f6') */
  color: string;
  /** Stroke width in pixels */
  width: number;
  /** Optional arrow configuration */
  arrowSettings?: AIArrowSettings;
}

export interface AIImageInfo {
  /** Image width in pixels */
  width: number;
  /** Image height in pixels */
  height: number;
  /** Image rotation in degrees (0-360) */
  rotation?: number;
}

export interface AIUnits {
  /** Unit name */
  name: 'cm' | 'in' | 'mm' | 'ft' | 'px';
  /** Pixels per unit for measurement conversion */
  pxPerUnit?: number;
}

export interface AIColorScheme {
  primary: string;
  measure: string;
  callout: string;
  labelText: string;
  labelBackground: string;
  labelBorder: string;
}

export interface AIStrokeStyle {
  baseWidth: number;
  cap: 'round' | 'butt' | 'square';
  join: 'round' | 'bevel' | 'miter';
}

export interface AIFontStyle {
  family: string;
  size: number;
  weight: string;
}

export interface AILabelBox {
  padding: number;
  background: string;
  borderColor: string;
  borderWidth: number;
  radius: number;
}

export interface AILabelStyle {
  box: AILabelBox;
  offset: number;
  minWidth: number;
  minHeight: number;
}

export interface AIMarkerStyle {
  arrow: {
    markerWidth: number;
    markerHeight: number;
    refX: number;
    refY: number;
    path: string;
  };
}

export interface AIStyleGuide {
  colors: AIColorScheme;
  stroke: AIStrokeStyle;
  fonts: AIFontStyle;
  labels: AILabelStyle;
  markers: AIMarkerStyle;
}

export interface GenerateSVGInput {
  image: AIImageInfo;
  units: AIUnits;
  strokes: AIStrokeInput[];
  prompt?: string;
  styleGuide?: Partial<AIStyleGuide> | null;
}

export interface AILabelOutput {
  text: string;
  x: number;
  y: number;
}

export interface AIVectorStyle {
  color: string;
  width: number;
  marker?: 'arrow' | 'none';
}

export interface AIVectorOutput {
  id: string;
  type: 'line' | 'path' | 'text';
  points: AIPoint[];
  label?: AILabelOutput;
  style: AIVectorStyle;
}

export interface AIMeasurement {
  id: string;
  value: number;
  units: string;
}

export interface AICounts {
  lines: number;
  arrows?: number;
  labels?: number;
}

export interface AISummary {
  measurements: AIMeasurement[];
  counts: AICounts;
}

export interface GenerateSVGOutput {
  svg: string;
  vectors: AIVectorOutput[];
  summary: AISummary;
}

export interface AssistMeasurementInput {
  units: AIUnits;
  stroke: AIStrokeInput;
  styleGuide?: Partial<AIStyleGuide> | null;
}

export interface AssistMeasurementOutput {
  value: number;
  formatted: string;
  labelPos: AIPoint;
  fontSize: number;
  color?: string;
}

export interface EnhancePlacementInput {
  image: AIImageInfo;
  strokes: AIStrokeInput[];
  styleGuide?: Partial<AIStyleGuide> | null;
}

export interface EnhancePlacementOutput {
  vectorsUpdated: AIVectorOutput[];
  svg?: string;
}
