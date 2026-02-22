/**
 * MOS v1 — Measurement Overlay System types
 *
 * Coordinate convention:
 *   MOS space  = 0–1000 on both axes (normalised to background image bounds)
 *   Canvas space = Fabric.js canvas coordinates (pixels, affected by zoom/pan)
 */

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export interface MosPoint {
  /** 0–1000 normalised X */
  x: number;
  /** 0–1000 normalised Y */
  y: number;
}

export interface CanvasPoint {
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// Individual overlay element
// ---------------------------------------------------------------------------

export type MosElementKind = 'measureLine' | 'label' | 'leader' | 'shapeHint';

export type MosEditMode = 'endpoint' | 'translate' | 'label-drag' | 'readonly';

export interface MosEndpoint {
  point: MosPoint;
  /** Fabric object ID once rendered on canvas */
  fabricObjectId?: string;
}

export interface MosLabelData {
  text: string;
  /** Centre of label in MOS coords */
  cx: number;
  cy: number;
  rotation: number;
}

export interface MosStyle {
  strokeColor?: string;
  strokeWidth?: number;
  arrowStyle?: 'open' | 'filled' | 'none';
}

export interface MeasurementOverlayElement {
  /** Unique ID: `mos${overlayIndex}_${originalId}` */
  id: string;
  /** Original element ID after prefix rewrite */
  opId: string;
  kind: MosElementKind;
  editMode: MosEditMode;
  endpoints: MosEndpoint[];
  label?: MosLabelData;
  style?: MosStyle;
  /** IDs of all Fabric objects created for this element */
  fabricObjectIds: string[];
  dirty: boolean;
}

// ---------------------------------------------------------------------------
// Overlay (one imported/generated SVG)
// ---------------------------------------------------------------------------

export interface MeasurementOverlay {
  /** Unique overlay ID */
  id: string;
  /** View this overlay belongs to (front/side/back/cushion) */
  viewId: string;
  /** Monotonically incrementing index for ID prefixing */
  overlayIndex: number;
  /** Original SVG text (sanitised) */
  svgText: string;
  /** All elements parsed from the SVG */
  elements: Map<string, MeasurementOverlayElement>;
  /** R2 object key if stored */
  sourceR2Key?: string;
  /** Supabase row ID if persisted */
  supabaseId?: string;
  /** Whether any element has been modified since last save */
  dirty: boolean;
}

// ---------------------------------------------------------------------------
// Store (all overlays for the current project)
// ---------------------------------------------------------------------------

export interface MeasurementOverlayStore {
  byId: Map<string, MeasurementOverlay>;
  /** Ordered overlay IDs for render order */
  order: string[];
  /** Currently selected overlay ID */
  activeId: string | null;
  /** Next overlay index (monotonically incrementing, never reused) */
  nextOverlayIndex: number;
}

// ---------------------------------------------------------------------------
// Image rect used for coordinate transforms
// ---------------------------------------------------------------------------

export interface ImageRect {
  /** Canvas-space left of image top-left corner */
  left: number;
  /** Canvas-space top of image top-left corner */
  top: number;
  /** Displayed width in canvas pixels */
  width: number;
  /** Displayed height in canvas pixels */
  height: number;
}

// ---------------------------------------------------------------------------
// Sanitiser config
// ---------------------------------------------------------------------------

export const MOS_ALLOWED_ELEMENTS = new Set([
  'svg',
  'g',
  'line',
  'polyline',
  'polygon',
  'path',
  'rect',
  'circle',
  'ellipse',
  'text',
  'tspan',
  'defs',
  'marker',
  'style',
  'clipPath',
  'use',
]);

export const MOS_ALLOWED_ATTRIBUTES = new Set([
  // Structural
  'id',
  'class',
  'viewBox',
  'xmlns',
  'xmlns:xlink',
  // Geometry — line
  'x1',
  'y1',
  'x2',
  'y2',
  // Geometry — rect/image
  'x',
  'y',
  'width',
  'height',
  'rx',
  'ry',
  // Geometry — circle/ellipse
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  // Geometry — path
  'd',
  // Geometry — polyline/polygon
  'points',
  // Presentation
  'fill',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'opacity',
  'fill-opacity',
  'stroke-opacity',
  'fill-rule',
  'clip-rule',
  'font-size',
  'font-family',
  'font-weight',
  'font-style',
  'text-anchor',
  'dominant-baseline',
  'text-decoration',
  'letter-spacing',
  // Transform
  'transform',
  // Marker/ref
  'marker-start',
  'marker-mid',
  'marker-end',
  'markerWidth',
  'markerHeight',
  'refX',
  'refY',
  'orient',
  'markerUnits',
  // Clip/use
  'clip-path',
  'href',
  'xlink:href',
  // Style (inline)
  'style',
  // data-* attributes are handled separately (all allowed with prefix check)
]);

// ---------------------------------------------------------------------------
// Gemini generate request/response
// ---------------------------------------------------------------------------

export interface MosGenerateRequest {
  projectId?: string;
  viewId?: string;
  imageR2Key?: string;
  imageDataUrl?: string;
  imageWidth: number;
  imageHeight: number;
  templateId?: string;
  requestedRoles: string[];
  units: 'cm' | 'mm' | 'in';
  mediaResolution?: 'HIGH' | 'MEDIUM' | 'LOW';
  thinkingLevel?: 'low' | 'medium' | 'high';
}

export interface MosGenerateResponse {
  success: boolean;
  svg?: string;
  r2Key?: string;
  r2Url?: string;
  supabaseId?: string;
  attempt?: number;
  usage?: { promptTokenCount: number; totalTokenCount: number };
  error?: string;
  rawSvg?: string;
  validationErrors?: string[];
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface MosImageRectChangedEvent {
  imageRect: ImageRect;
}

// ---------------------------------------------------------------------------
// Custom data marker on Fabric objects
// ---------------------------------------------------------------------------

export interface MosFabricCustomData {
  layerType: 'mos-overlay';
  overlayId: string;
  elementId: string;
  kind: MosElementKind;
  endpointIndex?: number;
}
